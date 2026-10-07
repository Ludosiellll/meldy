"""Разметка вопросов экзамена по лекциям студента: POST /api/exams/{exam_id}/map.

Конвейер (спека «Билеты» 5.1–5.3, контракт §4):
1. Чтение с токеном пользователя (RLS): экзамен, вопросы, exam_materials, materials.
   До потока — 404, 409, 400, 422, 413; затем блокировка условным PATCH экзамена.
2. Отпечаток лекций fp = sha256(",".join(sorted("<id>:<sha256(text)>"))). Вопрос с тем
   же question_hash, fp и MAP_VERSION в любом экзамене пользователя получает готовый
   результат без модели, с его исходной датой mapped_at (событие reused).
3. Кандидаты — BM25 (retrieval.py) по всем фрагментам лекций: топ-6, не больше 3 из
   одной лекции. Нет ни одного общего слова — «нет» без модели (событие lexical).
4. Судья (P3) пачками: 10 вопросов при ключе Gemini, иначе 4 (фрагменты по 450 знаков);
   до 3 пачек сразу со сдвигом 0,8 с, и каждая пачка ждёт места в общей очереди тяжёлых
   вызовов процесса (agents.base.heavy_slot, AI_HEAVY_CONCURRENCY). Проверки честности: метки только из кандидатов
   своего вопроса; «есть»/«частично» без подтверждающей метки — «нет»; пропущенные
   номера — один повтор пачкой вдвое меньше, затем «проверено только по словам»;
   429/502/504 — пачка проверена только по словам (batch_failed).
5. Каждый результат записывается в exam_questions до своего события. В конце
   exams.mapping_state и exams.mapped_at = самая старая отметка экзамена.

Текст доказательства — всегда целый фрагмент лекции (build_source_chunks без потолка),
ближайший фрагмент — его дословная часть до 300 знаков. Текст модели туда не попадает.
Если поиск склеил фрагмент с заголовком раздела и слова вопроса есть в заголовке,
заголовок — отдельный целый фрагмент в доказательствах (перед текстом) или ближайший
фрагмент, когда совпал только он. В пояснениях судьи метки кандидатов [C1]…[C6]
заменяются номерами фрагментов, «Нет …» в начале missing убирается (на экране
«Не хватает: …»).
Готовый результат другого экзамена переиспользуется, только если каждое его
доказательство совпадает с нынешним фрагментом лекции слово в слово.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import os
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, AsyncIterator, Iterable

from agents import base as ai_base
from agents.base import AIError, BaseAgent, parse_model_json
from exams_prompts import JUDGE_PROMPT, JudgeCandidate, JudgeQuestion, build_judge_block
from plans import exam_mapping_cost
from retrieval import STOPWORDS, BM25Index, Hit, Passage, material_passages, stem, terms
from supabase_rest import RowLevelDenied, SupabaseRest, SupabaseRestError

__all__ = [
    "MAP_VERSION",
    "MapError",
    "MappingJob",
    "Verdict",
    "clean_missing",
    "clean_reason",
    "coverage_from_verdict",
    "heading_passages",
    "materials_fingerprint",
    "passage_index",
    "prepare_mapping",
    "release_unstarted",
    "run_mapping",
    "select_targets",
    "validate_judge_answer",
]

MAP_VERSION = 1
LOCK_STALE_SECONDS = 300
MAX_TOTAL_CHARS = 3_000_000
TOP_K = 6
PER_MATERIAL_CAP = 3
GEMINI_BATCH_SIZE = 10
GROQ_BATCH_SIZE = 4
GROQ_FRAGMENT_CHARS = 450
MAX_IN_FLIGHT = 3
STAGGER_SECONDS = 0.8
JUDGE_TIMEOUT_SECONDS = 45.0
JUDGE_MAX_TOKENS = 4096
WRITE_CONCURRENCY = 8
EVIDENCE_LIMIT = 3
NEAREST_LIMIT = 3
NEAREST_EXCERPT_CHARS = 300
NOTE_CHARS = 200
DB_NOTE_CHARS = 400
TITLE_CHARS = 120
MATCHED_WORDS_LIMIT = 8
IN_FILTER_CHUNK = 50
MAX_QUESTION_IDS = 300

EXAM_NOT_FOUND_DETAIL = "Экзамен не найден"
MAPPING_RUNNING_DETAIL = "Сверка с лекциями уже идёт"
NO_QUESTIONS_DETAIL = "В экзамене нет вопросов"
NO_MATERIALS_DETAIL = "К экзамену не добавлены лекции. Добавьте лекции с текстом и повторите."
NO_TEXT_DETAIL = "Ни у одной лекции нет текста. Добавьте лекции с текстом, а не сканы."
TOO_LARGE_DETAIL = "В лекциях экзамена больше 3 000 000 знаков. Уберите часть лекций и повторите."
SESSION_EXPIRED_DETAIL = "Сессия истекла. Войдите снова."
READ_FAILED_DETAIL = "Не удалось прочитать экзамен. Повторите через минуту."
LOCK_FAILED_DETAIL = "Не удалось начать сверку с лекциями. Повторите через минуту."

REASON_NO_OVERLAP = "Ни одного фрагмента с этими словами"
REASON_NO_SUPPORT = "Нет подтверждающего фрагмента"
REASON_NO_ANSWER = "Проверено только по словам: модель не вернула ответ по этому вопросу"
_DEFAULT_REASONS = {
    "full": "Ответ есть во фрагментах лекций",
    "partial": "Во фрагментах лекций есть часть ответа",
    "none": "Во фрагментах лекций нет ответа на этот вопрос",
}
# Пачка, которую модель не проверила: (причина у вопроса, сообщение события batch_failed).
_FAILED_BATCH_TEXTS = {
    429: ("Проверено только по словам: сервис ИИ был занят", "Сервис занят — эти вопросы проверены только по словам"),
    503: ("Проверено только по словам: сервис ИИ недоступен", "ИИ-сервис недоступен — эти вопросы проверены только по словам"),
    504: (
        "Проверено только по словам: сервис ИИ не ответил вовремя",
        "ИИ-сервис не ответил вовремя — эти вопросы проверены только по словам",
    ),
    502: ("Проверено только по словам: сервис ИИ не ответил", "ИИ-сервис не ответил — эти вопросы проверены только по словам"),
}
# Пояснения сервера: клиент сравнивает их дословно (WhyPanel), поэтому их не переписываем.
_FIXED_REASONS = frozenset(
    [REASON_NO_OVERLAP, REASON_NO_SUPPORT, REASON_NO_ANSWER, *_DEFAULT_REASONS.values()]
    + [reason for reason, _ in _FAILED_BATCH_TEXTS.values()]
)
WRITE_FAILED_MESSAGE = "Не удалось сохранить результаты сверки. Уже проверенные вопросы сохранены — повторите через минуту."
INTERNAL_MESSAGE = "Сверка прервалась из-за ошибки на сервере. Уже проверенные вопросы сохранены — повторите через минуту."

_UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_SOURCE_ID_RE = re.compile(r"^S\d{1,4}$")
_LABEL_RE = re.compile(r"[CcСс]\s*(\d{1,2})")
_COVERAGE_WORDS = {
    "full": "full",
    "partial": "partial",
    "none": "none",
    "полностью": "full",
    "есть": "full",
    "частично": "partial",
    "нет": "none",
}

_QUESTION_COLUMNS = (
    "id,position,label,text,question_hash,coverage,coverage_method,coverage_reason,missing_note,"
    "evidence,nearest,materials_fingerprint,mapping_version,mapped_at"
)
_REUSE_COLUMNS = "id,question_hash,coverage,coverage_method,coverage_reason,missing_note,evidence,nearest,mapped_at"

# (material_id, source_id) → текст фрагмента, как его режет build_source_chunks(text, max_chunks=None).
Fragments = dict[tuple[str, str], str]


class MapError(Exception):
    """Отказ до начала потока: status — HTTP-статус, detail — текст для пользователя."""

    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


class _WriteFailed(Exception):
    """Запись результата в exam_questions не удалась (сеть, 5xx, 401)."""


# ── Время ─────────────────────────────────────────────────────────────────────


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _parse_ts(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip().replace("Z", "+00:00")
    if " " in text and "T" not in text:
        text = text.replace(" ", "T", 1)
    try:
        moment = datetime.fromisoformat(text)
    except ValueError:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment


# ── Отпечаток и цели ───────────────────────────────────────────────────────────


def materials_fingerprint(materials: Iterable[tuple[str, str]]) -> str:
    """sha256(",".join(sorted("<id>:<sha256(original_text)>"))) по лекциям с текстом."""
    parts = sorted(
        f"{material_id}:{hashlib.sha256((text or '').encode('utf-8')).hexdigest()}" for material_id, text in materials
    )
    return hashlib.sha256(",".join(parts).encode("utf-8")).hexdigest()


def _evidence_is_current(evidence: Any, material_ids: set[str], fragments: Fragments | None) -> bool:
    """Доказательства есть, ссылаются на лекции экзамена и (если известны фрагменты) совпадают с ними."""
    if not isinstance(evidence, list) or not evidence:
        return False
    for item in evidence:
        if not isinstance(item, dict) or item.get("material_id") not in material_ids:
            return False
        if fragments is not None:
            key = (str(item.get("material_id")), str(item.get("source_id") or ""))
            if fragments.get(key) != item.get("excerpt"):
                return False
    return True


def select_targets(
    questions: list[dict],
    fingerprint: str,
    material_ids: set[str],
    question_ids: list[str] | None,
    force: bool,
    fragments: Fragments | None = None,
) -> list[dict]:
    """Вопросы, которые этот запуск проверяет.

    Без question_ids и force: не размеченные и «проверено только по словам»;
    «частично» и «нет», размеченные по другому набору лекций (или другой версией);
    «есть», у которых доказательство ссылается на лекцию не из экзамена (или уже не
    совпадает с текстом лекции). Новая лекция не отнимает покрытие, поэтому «есть»
    с другим отпечатком не перепроверяется. С question_ids — эти вопросы. Ручные
    отметки не трогаются без force.
    """
    wanted = None if question_ids is None else set(question_ids)
    targets: list[dict] = []
    for question in questions:
        if wanted is not None and question.get("id") not in wanted:
            continue
        coverage = question.get("coverage")
        method = question.get("coverage_method")
        if method == "manual" and coverage is not None and not force:
            continue
        if force or wanted is not None:
            targets.append(question)
            continue
        if coverage is None or coverage == "unverified":
            targets.append(question)
        elif coverage in ("partial", "none"):
            if question.get("materials_fingerprint") != fingerprint or question.get("mapping_version") != MAP_VERSION:
                targets.append(question)
        elif coverage == "full":
            if not _evidence_is_current(question.get("evidence"), material_ids, fragments):
                targets.append(question)
        else:
            targets.append(question)
    return targets


# ── Судья: разбор и проверка ответа ─────────────────────────────────────────────


@dataclass(frozen=True)
class Verdict:
    coverage: str  # full | partial | none
    support: tuple[int, ...]  # номера кандидатов этого вопроса (0 → C1), только существующие
    missing: str
    reason: str


def _as_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    return None


def _note(value: Any, limit: int = NOTE_CHARS) -> str:
    """Строка модели одной строкой, не длиннее limit (обрезка по слову с «…»)."""
    if not isinstance(value, str):
        return ""
    text = " ".join(value.split())
    if len(text) <= limit:
        return text
    cut = text[: limit - 1]
    space = cut.rfind(" ")
    if space >= limit * 0.6:
        cut = cut[:space]
    return cut.rstrip(" ,;:-–—") + "…"


def _support_indices(value: Any, candidate_count: int) -> tuple[int, ...]:
    labels: list[str] = []
    if isinstance(value, list):
        for item in value:
            if isinstance(item, (int, float)) and not isinstance(item, bool):
                labels.append(f"C{int(item)}")
            elif isinstance(item, str):
                labels.append(item)
    elif isinstance(value, str):
        labels.append(value)
    indices: list[int] = []
    for label in labels:
        for match in _LABEL_RE.finditer(label):
            index = int(match.group(1)) - 1
            if 0 <= index < candidate_count and index not in indices:
                indices.append(index)
    return tuple(indices)


def validate_judge_answer(raw: Any, candidate_counts: list[int]) -> tuple[dict[int, Verdict], bool]:
    """Ответ судьи → {номер вопроса в пачке (с 0): Verdict} и признак «ответ полный и чистый».

    Пропускаются: элементы не-объекты, номер вне пачки, повтор номера (берётся первый),
    неизвестное значение coverage. Метки support вне кандидатов своего вопроса удаляются.
    """
    try:
        parsed = parse_model_json(raw)
    except (ValueError, TypeError):
        return {}, False
    if isinstance(parsed, dict):
        items = parsed.get("results")
        if items is None and isinstance(parsed.get("items"), list):
            items = parsed.get("items")
    elif isinstance(parsed, list):
        items = parsed
    else:
        items = None
    if not isinstance(items, list):
        return {}, False
    verdicts: dict[int, Verdict] = {}
    clean = True
    for item in items:
        if not isinstance(item, dict):
            clean = False
            continue
        number = _as_int(item.get("n"))
        if number is None or not 1 <= number <= len(candidate_counts):
            clean = False
            continue
        index = number - 1
        if index in verdicts:
            clean = False
            continue
        coverage = _COVERAGE_WORDS.get(str(item.get("coverage") or "").strip().lower())
        if coverage is None:
            clean = False
            continue
        verdicts[index] = Verdict(
            coverage=coverage,
            support=_support_indices(item.get("support"), candidate_counts[index]),
            missing=_note(item.get("missing")),
            reason=_note(item.get("reason")),
        )
    complete = clean and len(verdicts) == len(candidate_counts)
    return verdicts, complete


# ── Доказательства и ближайшие фрагменты ────────────────────────────────────────


def _title(value: Any) -> str:
    title = " ".join(str(value or "").split())
    return title[:TITLE_CHARS] if title else "Без названия"


def _passage_item(passage: Passage) -> dict:
    return {
        "material_id": passage.material_id,
        "material_title": _title(passage.title),
        "source_id": passage.source_id,
        "excerpt": passage.text,
    }


def evidence_item(hit: Hit) -> dict:
    """Доказательство: целый фрагмент лекции, как его режет build_source_chunks."""
    return _passage_item(hit.passage)


def _excerpt_window(text: str, words: list[str], limit: int = NEAREST_EXCERPT_CHARS) -> str:
    """Дословная часть фрагмента до limit знаков вокруг первого совпавшего слова."""
    if len(text) <= limit:
        return text
    start = 0
    positions = []
    for word in words:
        match = re.search(rf"(?<![0-9A-Za-zА-Яа-яЁё]){re.escape(word)}(?![0-9A-Za-zА-Яа-яЁё])", text)
        if match:
            positions.append(match.start())
    if positions:
        first = min(positions)
        start = max(0, first - 60)
        if start > 0:
            space = text.find(" ", start)
            start = space + 1 if 0 <= space < first else start
    end = min(len(text), start + limit)
    if end < len(text):
        space = text.rfind(" ", start, end)
        if space > start + limit // 2:
            end = space
    return text[start:end].strip()


PassageIndex = dict[tuple[str, int], Passage]  # (material_id, номер фрагмента) → фрагмент


def passage_index(passages: Iterable[Passage]) -> PassageIndex:
    return {(passage.material_id, passage.order): passage for passage in passages}


def heading_passages(hit: Hit, passages: PassageIndex | None) -> tuple[Passage, ...]:
    """Фрагменты-заголовки, которые поиск склеил с фрагментом находки (Hit.heading).

    Это фрагменты того же материала прямо перед находкой; Hit.heading — их тексты через
    перевод строки. Пустой кортеж, если заголовка нет или его не удаётся сопоставить.
    """
    heading = hit.heading
    if not heading or not passages:
        return ()
    found: list[Passage] = []
    end = len(heading)
    order = hit.passage.order - 1
    while True:
        passage = passages.get((hit.passage.material_id, order))
        if passage is None or not passage.text or not heading.endswith(passage.text, 0, end):
            return ()
        found.append(passage)
        end -= len(passage.text)
        if end == 0:
            return tuple(reversed(found))
        if heading[end - 1] != "\n":
            return ()
        end -= 1
        order -= 1


_SURFACE_RE = re.compile(r"[0-9A-Za-zА-Яа-яЁё]+")


def surface_words(text: str, stems: Iterable[str]) -> list[str]:
    """Слова текста в написании лекции, чьи основы входят в stems (как Hit.matched_words)."""
    wanted = set(stems)
    chosen: dict[str, str] = {}
    if not wanted:
        return []
    for surface in _SURFACE_RE.findall(unicodedata.normalize("NFC", text or "")):
        form = surface.lower().replace("ё", "е")
        if len(form) < 2 or form in STOPWORDS or stem(form) not in wanted:
            continue
        current = chosen.get(form)
        if current is None or (current != current.lower() and surface == surface.lower()):
            chosen[form] = surface
    return list(chosen.values())


def _matched_headings(hit: Hit, passages: PassageIndex | None) -> list[Passage]:
    """Заголовки находки, в которых есть слова вопроса (по ним фрагмент и нашёлся)."""
    return [passage for passage in heading_passages(hit, passages) if surface_words(passage.text, hit.matched_stems)]


def nearest_item(hit: Hit, passages: PassageIndex | None = None) -> dict:
    """Ближайший фрагмент: слова вопроса в нём подчёркнуты (matched).

    Если с вопросом совпал только заголовок раздела («Кривая Филлипса» над объяснением),
    показывается сам заголовок — иначе под «совпали слова …» стоял бы текст без этих слов.
    """
    passage = hit.passage
    words = list(hit.matched_words[:MATCHED_WORDS_LIMIT])
    if not words:
        headings = _matched_headings(hit, passages)
        if headings:
            passage = headings[-1]
            words = surface_words(passage.text, hit.matched_stems)[:MATCHED_WORDS_LIMIT]
    return {
        "material_id": passage.material_id,
        "material_title": _title(passage.title),
        "source_id": passage.source_id,
        "excerpt": _excerpt_window(passage.text, words),
        "matched": words,
    }


def _nearest(hits: list[Hit], passages: PassageIndex | None = None) -> list[dict]:
    return [nearest_item(hit, passages) for hit in hits[:NEAREST_LIMIT]]


def _evidence(hits: list[Hit], support: Iterable[int], passages: PassageIndex | None) -> list[dict]:
    """Доказательства: целые фрагменты опорных находок, перед каждым — его заголовок.

    Сначала фрагменты-содержания (до EVIDENCE_LIMIT), на оставшиеся места — заголовки
    разделов, в которых совпали слова вопроса: судья читал «заголовок. текст», и без
    заголовка в доказательстве не было бы слов, по которым вопрос сверен.
    """
    chosen: list[Hit] = []
    seen: set[tuple[str, str]] = set()
    for index in support:
        if not 0 <= index < len(hits):
            continue
        hit = hits[index]
        key = (hit.passage.material_id, hit.passage.source_id)
        if key in seen:
            continue
        seen.add(key)
        chosen.append(hit)
        if len(chosen) >= EVIDENCE_LIMIT:
            break
    room = EVIDENCE_LIMIT - len(chosen)
    headings: list[list[Passage]] = [[] for _ in chosen]
    for position, hit in enumerate(chosen):
        for passage in reversed(_matched_headings(hit, passages)):
            key = (passage.material_id, passage.source_id)
            if room <= 0:
                break
            if key in seen:
                continue
            seen.add(key)
            headings[position].insert(0, passage)
            room -= 1
    evidence: list[dict] = []
    for position, hit in enumerate(chosen):
        evidence.extend(_passage_item(passage) for passage in headings[position])
        evidence.append(evidence_item(hit))
    return evidence


# ── Пояснения судьи: без внутренних меток кандидатов ────────────────────────────

_NOT_WORD = r"(?<![0-9A-Za-zА-Яа-яЁё])"
# Метка кандидата: «[C1]», «[С 2]» (кириллица) или «C3» без пробела (а «С 5 видами» — не метка).
_LABEL = rf"(?:\[\s*[CС]\s?\d{{1,2}}\s*\]|{_NOT_WORD}[CС]\d{{1,2}}(?![0-9A-Za-zА-Яа-яЁё]))"
_LABEL_RUN_RE = re.compile(
    rf"(?:{_NOT_WORD}(?P<prep>[Вв]о?|[Ии]з|[Пп]о)\s+|{_NOT_WORD}(?P<word>[Фф]рагмент[а-яё]*)\s*)?"
    rf"(?P<paren>\(\s*)?(?P<run>{_LABEL}(?:\s*(?:,|и|-|–|—|/)\s*{_LABEL})*)(?(paren)\s*\))"
)
_LABEL_NUMBER_RE = re.compile(r"[CС]\s?(\d{1,2})")
_PREPOSITION_PHRASES = {
    "в": ("во фрагменте", "во фрагментах"),
    "во": ("во фрагменте", "во фрагментах"),
    "из": ("из фрагмента", "из фрагментов"),
    "по": ("по фрагменту", "по фрагментам"),
}
_MISSING_PREFIX_RE = re.compile(
    r"^(?:(?:в|во)\s+(?:лекци\w*|фрагмент\w*(?:\s+\d+)?|материал\w*|тексте)\s+)?"
    r"(?:нет|не\s+хватает|не\s+хватило|недоста[её]т|отсутству\w*"
    r"|не\s+(?:указан|приведен|приведён|назван|раскрыт|описан|рассмотрен|дан|представлен|упомянут)\w*)"
    r"(?:\s*[:—–-]\s*|\s+)",
    re.IGNORECASE,
)
_MISSING_EMPTY_RE = re.compile(r"^(?:нет|ничего|всё есть|все есть|—|-)?[.!]?$", re.IGNORECASE)


class _UnknownLabel(Exception):
    """В пояснении метка, которой нет среди кандидатов вопроса."""


def _fragment_numbers(hits: list[Hit]) -> dict[int, str]:
    """Метка кандидата (0 → C1) → номер фрагмента, как его видит человек («S14» → «14»)."""
    numbers: dict[int, str] = {}
    for index, hit in enumerate(hits):
        digits = hit.passage.source_id[1:] if hit.passage.source_id[:1] == "S" else ""
        if digits.isdigit():
            numbers[index] = str(int(digits))
    return numbers


def _relabel(text: str, numbers: dict[int, str]) -> str:
    """«[C1]», «C2 и C3», «во фрагменте C1» → «(фрагмент 14)», «фрагменты 15 и 16», «во фрагменте 14».

    Метки C1…C6 судья видит только у своего вопроса; человеку они ничего не говорят.
    Метка вне кандидатов — _UnknownLabel (пояснение тогда не показывается).
    """

    def replace(match: re.Match) -> str:
        run = match.group("run")
        labels = list(_LABEL_NUMBER_RE.finditer(run))
        indices = [int(labels[0].group(1)) - 1]
        for previous, label in zip(labels, labels[1:]):
            index = int(label.group(1)) - 1
            if run[previous.end():label.start()].strip(" []") in ("-", "–", "—") and index > indices[-1]:
                indices.extend(range(indices[-1] + 1, index + 1))  # «C1–C3»: кандидаты идут не по порядку фрагментов
            else:
                indices.append(index)
        values: list[str] = []
        for index in dict.fromkeys(indices):
            value = numbers.get(index)
            if value is None:
                raise _UnknownLabel()
            values.append(value)
        listed = values[0] if len(values) == 1 else f"{', '.join(values[:-1])} и {values[-1]}"
        plural = len(values) > 1
        if match.group("word"):
            return f"{match.group('word')} {listed}"
        if match.group("prep"):
            phrase = _PREPOSITION_PHRASES[match.group("prep").lower()][1 if plural else 0]
            if match.group("prep")[0].isupper():
                phrase = phrase[0].upper() + phrase[1:]
            return f"{phrase} {listed}"
        noun = "фрагменты" if plural else "фрагмент"
        before = text[: match.start()].rstrip()
        if not before or before.endswith((".", "!", "?")):
            return f"{noun[0].upper()}{noun[1:]} {listed}"  # подлежащее в начале предложения — без скобок
        if match.group("paren") or run.lstrip().startswith("["):
            return f"({noun} {listed})"
        return f"{noun} {listed}"

    result = _LABEL_RUN_RE.sub(replace, text)
    result = re.sub(r"\s+([,.;:!?)])", r"\1", result)
    return " ".join(result.split())


def _lower_first(text: str) -> str:
    """Первая буква строчной, если это не аббревиатура («Классификации» → «классификации», «ВВП» — как есть)."""
    match = re.match(r"[A-Za-zА-Яа-яЁё]+", text)
    if not match:
        return text
    word = match.group(0)
    if word[0].isupper() and (len(word) == 1 or word[1].islower()):
        return word[0].lower() + text[1:]
    return text


def clean_reason(reason: str, coverage: str, numbers: dict[int, str]) -> str:
    """Пояснение судьи для человека: метки C1…C6 → номера фрагментов; с чужой меткой — общее пояснение."""
    default = _DEFAULT_REASONS.get(coverage, "")
    if not reason:
        return default
    try:
        cleaned = _relabel(reason, numbers)
    except _UnknownLabel:
        return default
    return _note(cleaned) or default


def clean_missing(missing: str, numbers: dict[int, str]) -> str:
    """«Нет классификации видов инфляции» → «классификации видов инфляции» (на экране: «Не хватает: …»)."""
    text = " ".join((missing or "").split())
    if not text:
        return ""
    try:
        text = _relabel(text, numbers)
    except _UnknownLabel:
        return ""
    if _MISSING_EMPTY_RE.match(text):
        return ""
    stripped = _MISSING_PREFIX_RE.sub("", text, count=1).strip(" :—–-")
    if not stripped:
        return ""
    return _note(_lower_first(stripped))


def coverage_from_verdict(
    question_id: str,
    hits: list[Hit],
    verdict: Verdict,
    mapped_at: str,
    passages: PassageIndex | None = None,
) -> dict:
    """Результат вопроса по ответу судьи после проверок сервера.

    passages — все фрагменты лекций экзамена: по ним к доказательству и ближайшему
    фрагменту добавляется заголовок раздела, если слова вопроса совпали только с ним.
    """
    numbers = _fragment_numbers(hits)
    if verdict.coverage in ("full", "partial"):
        evidence = _evidence(hits, verdict.support, passages)
        if evidence:
            return _coverage(
                question_id,
                verdict.coverage,
                "llm",
                clean_reason(verdict.reason, verdict.coverage, numbers),
                "" if verdict.coverage == "full" else clean_missing(verdict.missing, numbers),
                evidence,
                [],
                mapped_at,
            )
        return _coverage(question_id, "none", "llm", REASON_NO_SUPPORT, "", [], _nearest(hits, passages), mapped_at)
    return _coverage(
        question_id,
        "none",
        "llm",
        clean_reason(verdict.reason, "none", numbers),
        clean_missing(verdict.missing, numbers),
        [],
        _nearest(hits, passages),
        mapped_at,
    )


def _coverage(
    question_id: str,
    coverage: str,
    method: str,
    reason: str,
    missing: str,
    evidence: list[dict],
    nearest: list[dict],
    mapped_at: str,
    reused: bool = False,
) -> dict:
    return {
        "question_id": question_id,
        "coverage": coverage,
        "method": method,
        "reason": reason,
        "missing": missing,
        "evidence": evidence,
        "nearest": nearest,
        "mapped_at": mapped_at,
        "reused": reused,
    }


def _unverified(
    question_id: str, hits: list[Hit], reason: str, mapped_at: str, passages: PassageIndex | None = None
) -> dict:
    return _coverage(question_id, "unverified", "lexical", reason, "", [], _nearest(hits, passages), mapped_at)


def _lexical_none(question_id: str, mapped_at: str) -> dict:
    return _coverage(question_id, "none", "lexical", REASON_NO_OVERLAP, "", [], [], mapped_at)


def _db_values(item: dict, fingerprint: str) -> dict:
    return {
        "coverage": item["coverage"],
        "coverage_method": item["method"],
        "coverage_reason": item["reason"][:DB_NOTE_CHARS],
        "missing_note": item["missing"][:DB_NOTE_CHARS],
        "evidence": item["evidence"],
        "nearest": item["nearest"],
        "materials_fingerprint": fingerprint,
        "mapping_version": MAP_VERSION,
        "mapped_at": item["mapped_at"],
    }


# ── Задание разметки ────────────────────────────────────────────────────────────


@dataclass
class MapMaterial:
    id: str
    title: str
    text: str


@dataclass
class MappingJob:
    db: SupabaseRest
    exam_id: str
    questions: list[dict]
    materials: list[MapMaterial]
    skipped: list[dict]
    fingerprint: str
    question_ids: list[str] | None
    force: bool
    started_at: str
    previous_state: str = "none"
    agent: Any = None
    started: bool = False
    tasks: list[asyncio.Task] = field(default_factory=list)
    # Дневной лимит ИИ: units → квитанция списания (quota.Charge) или AILimitExceeded. Задаёт
    # маршрут; None — разметка без списания (тесты конвейера). charge — квитанция этого запуска.
    reserve_units: Any = None
    charge: Any = None


def _read_error(exc: SupabaseRestError) -> MapError:
    if exc.status == 401:
        return MapError(401, SESSION_EXPIRED_DETAIL)
    if exc.status in (400, 403, 404, 406):
        return MapError(404, EXAM_NOT_FOUND_DETAIL)
    return MapError(503, READ_FAILED_DETAIL)


def _chunks(items: list, size: int) -> list[list]:
    return [items[index:index + size] for index in range(0, len(items), size)]


async def _load_materials(db: SupabaseRest, material_ids: list[str]) -> list[dict]:
    rows: list[dict] = []
    for chunk in _chunks(material_ids, IN_FILTER_CHUNK):
        rows.extend(await db.select("materials", {"select": "id,title,original_text", "id": f"in.({','.join(chunk)})"}))
    return rows


async def prepare_mapping(
    db: SupabaseRest,
    exam_id: str,
    question_ids: list[str] | None = None,
    force: bool = False,
) -> MappingJob:
    """Чтение и проверки до потока, затем блокировка. MapError — ответ без потока."""
    if not isinstance(exam_id, str) or not _UUID_RE.match(exam_id):
        raise MapError(404, EXAM_NOT_FOUND_DETAIL)
    try:
        exam = await db.select_one(
            "exams", {"select": "id,mapping_state,mapping_started_at,mapped_at", "id": f"eq.{exam_id}"}
        )
        if exam is None:
            raise MapError(404, EXAM_NOT_FOUND_DETAIL)
        now = _now()
        if exam.get("mapping_state") == "running":
            started = _parse_ts(exam.get("mapping_started_at"))
            if started is not None and started > now - timedelta(seconds=LOCK_STALE_SECONDS):
                raise MapError(409, MAPPING_RUNNING_DETAIL)
        questions, links = await asyncio.gather(
            db.select(
                "exam_questions",
                {"select": _QUESTION_COLUMNS, "exam_id": f"eq.{exam_id}", "order": "position.asc,created_at.asc"},
            ),
            db.select("exam_materials", {"select": "material_id", "exam_id": f"eq.{exam_id}"}),
        )
        if not questions:
            raise MapError(400, NO_QUESTIONS_DETAIL)
        material_ids = list(dict.fromkeys(str(link.get("material_id")) for link in links if link.get("material_id")))
        if not material_ids:
            raise MapError(422, NO_MATERIALS_DETAIL)
        rows = await _load_materials(db, material_ids)
    except SupabaseRestError as exc:
        raise _read_error(exc) from None

    by_id = {str(row.get("id")): row for row in rows}
    materials: list[MapMaterial] = []
    skipped: list[dict] = []
    for material_id in material_ids:
        row = by_id.get(material_id)
        if row is None:
            skipped.append({"id": material_id, "title": "", "reason": "missing"})
            continue
        text = row.get("original_text") if isinstance(row.get("original_text"), str) else ""
        title = _title(row.get("title"))
        if not text.strip():
            skipped.append({"id": material_id, "title": title, "reason": "no_text"})
            continue
        materials.append(MapMaterial(id=material_id, title=title, text=text))
    if not materials:
        raise MapError(422, NO_TEXT_DETAIL)
    if sum(len(material.text) for material in materials) > MAX_TOTAL_CHARS:
        raise MapError(413, TOO_LARGE_DETAIL)

    fingerprint = materials_fingerprint((material.id, material.text) for material in materials)

    started_at = _iso(now)
    stale_before = _iso(now - timedelta(seconds=LOCK_STALE_SECONDS)).split(".")[0] + "Z"
    try:
        await db.update(
            "exams",
            {
                "id": f"eq.{exam_id}",
                "or": f'(mapping_state.neq.running,mapping_started_at.is.null,mapping_started_at.lt."{stale_before}")',
                "select": "id",
            },
            {"mapping_state": "running", "mapping_started_at": started_at},
            require_rows=True,
        )
    except RowLevelDenied:
        raise MapError(409, MAPPING_RUNNING_DETAIL) from None
    except SupabaseRestError as exc:
        raise (MapError(401, SESSION_EXPIRED_DETAIL) if exc.status == 401 else MapError(503, LOCK_FAILED_DETAIL)) from None

    previous = exam.get("mapping_state")
    return MappingJob(
        db=db,
        exam_id=exam_id,
        questions=questions,
        materials=materials,
        skipped=skipped,
        fingerprint=fingerprint,
        question_ids=None if question_ids is None else list(question_ids),
        force=bool(force),
        started_at=started_at,
        previous_state=previous if isinstance(previous, str) and previous else "none",
    )


async def release_unstarted(job: MappingJob) -> None:
    """Страховка ответа, чей поток так и не начался (клиент ушёл сразу): снять блокировку.

    Ничего не проверено, поэтому экзамену возвращается прежнее состояние (зависшая
    чужая блокировка — «failed»). Если поток начался, блокировку снимает он сам.
    """
    if job.started:
        return
    job.started = True
    try:
        state = job.previous_state if job.previous_state != "running" else "failed"
        await job.db.update(
            "exams",
            {"id": f"eq.{job.exam_id}", "mapping_started_at": f"eq.{job.started_at}", "select": "id"},
            {"mapping_state": state},
            require_rows=False,
        )
    except Exception as exc:
        print(f"Exam mapping unstarted release failed: {type(exc).__name__}")
    finally:
        await job.db.aclose()


# ── Поток ───────────────────────────────────────────────────────────────────────


@dataclass
class _Catalog:
    """Все фрагменты лекций экзамена: для поиска, для счётчиков и для сверки доказательств."""

    passages: list[Passage]
    counts: dict[str, int]
    fragments: Fragments
    by_order: PassageIndex = field(default_factory=dict)


@dataclass
class _Group:
    """Вопросы экзамена с одним текстом (question_hash): судья видит их один раз."""

    key: str
    text: str
    questions: list[dict]
    hits: list[Hit] = field(default_factory=list)


@dataclass
class _BatchOutcome:
    index: int
    groups: list[_Group]
    verdicts: dict[int, Verdict]
    error_status: int | None = None
    missing_reasons: dict[int, str] = field(default_factory=dict)


def _group_key(question: dict) -> str:
    value = question.get("question_hash")
    return value if isinstance(value, str) and value else f"id:{question.get('id')}"


def _build_catalog(materials: list[MapMaterial]) -> _Catalog:
    passages: list[Passage] = []
    counts: dict[str, int] = {}
    fragments: Fragments = {}
    for material in materials:
        items = material_passages(material.id, material.title, material.text)
        counts[material.id] = len(items)
        passages.extend(items)
        for item in items:
            fragments[(item.material_id, item.source_id)] = item.text
    return _Catalog(passages=passages, counts=counts, fragments=fragments, by_order=passage_index(passages))


def _search_candidates(passages: list[Passage], groups: list[_Group]) -> None:
    """BM25-кандидаты для групп (в потоке-исполнителе: стемминг и индекс — на CPU)."""
    if not groups:
        return
    index = BM25Index(passages)
    for group in groups:
        hits = index.search(group.text, top_k=TOP_K, per_material_cap=PER_MATERIAL_CAP, exam_stopwords=True)
        if not hits and not terms(group.text, exam_stopwords=True):
            # Вопрос из одних слов-инструкций («Роль и значение.»): ищем по всем словам.
            hits = index.search(group.text, top_k=TOP_K, per_material_cap=PER_MATERIAL_CAP, exam_stopwords=False)
        group.hits = hits


def _usable_source(row: dict, material_ids: set[str], fragments: Fragments) -> bool:
    """Результат другого вопроса годится для повторного использования без модели.

    Только «есть / частично / нет» модели или поиска (ручные и непроверенные — нет);
    каждое доказательство совпадает с нынешним фрагментом лекции целиком, каждый
    ближайший фрагмент — его дословная часть.
    """
    coverage = row.get("coverage")
    evidence = row.get("evidence")
    nearest = row.get("nearest")
    if coverage not in ("full", "partial", "none") or row.get("coverage_method") not in ("llm", "lexical"):
        return False
    if not isinstance(evidence, list) or not isinstance(nearest, list) or _parse_ts(row.get("mapped_at")) is None:
        return False
    if coverage in ("full", "partial"):
        if not evidence or len(evidence) > EVIDENCE_LIMIT or not _evidence_is_current(evidence, material_ids, fragments):
            return False
    elif evidence:
        return False
    if len(nearest) > NEAREST_LIMIT:
        return False
    for item in nearest:
        if not isinstance(item, dict) or item.get("material_id") not in material_ids:
            return False
        source_id = str(item.get("source_id") or "")
        excerpt = item.get("excerpt")
        fragment = fragments.get((str(item.get("material_id")), source_id))
        if not _SOURCE_ID_RE.match(source_id) or fragment is None:
            return False
        if not isinstance(excerpt, str) or len(excerpt) > NEAREST_EXCERPT_CHARS or excerpt not in fragment:
            return False
        matched = item.get("matched", [])
        if not isinstance(matched, list) or not all(isinstance(word, str) for word in matched):
            return False
    return True


async def _find_reusable(job: MappingJob, hashes: list[str], fragments: Fragments) -> dict[str, dict]:
    material_ids = {material.id for material in job.materials}
    found: dict[str, dict] = {}
    for chunk in _chunks(sorted(hashes), IN_FILTER_CHUNK):
        rows = await job.db.select(
            "exam_questions",
            {
                "select": _REUSE_COLUMNS,
                "question_hash": f"in.({','.join(chunk)})",
                "materials_fingerprint": f"eq.{job.fingerprint}",
                "mapping_version": f"eq.{MAP_VERSION}",
                "coverage": "in.(full,partial,none)",
                "coverage_method": "in.(llm,lexical)",
                "order": "mapped_at.desc",
            },
        )
        for row in rows:
            key = row.get("question_hash")
            if isinstance(key, str) and key not in found and _usable_source(row, material_ids, fragments):
                found[key] = row
    return found


def _reused_coverage(question: dict, source: dict, titles: dict[str, str]) -> dict:
    """Готовый результат другого вопроса с тем же текстом: дата и доказательства — его, названия — нынешние."""
    evidence = [
        {
            "material_id": item["material_id"],
            "material_title": titles.get(item["material_id"], _title(item.get("material_title"))),
            "source_id": item["source_id"],
            "excerpt": item["excerpt"],
        }
        for item in source.get("evidence") or []
    ]
    nearest = [
        {
            "material_id": item["material_id"],
            "material_title": titles.get(item["material_id"], _title(item.get("material_title"))),
            "source_id": item["source_id"],
            "excerpt": item["excerpt"],
            "matched": list(item.get("matched") or [])[:MATCHED_WORDS_LIMIT],
        }
        for item in source.get("nearest") or []
    ]
    # Строки, размеченные раньше: метки кандидатов того запуска уже ни с чем не сопоставить.
    reason = _note(source.get("coverage_reason"), DB_NOTE_CHARS)
    if reason not in _FIXED_REASONS:
        reason = clean_reason(reason, source["coverage"], {})
    return _coverage(
        str(question["id"]),
        source["coverage"],
        source["coverage_method"],
        reason,
        clean_missing(_note(source.get("missing_note"), DB_NOTE_CHARS), {}),
        evidence,
        nearest,
        source["mapped_at"],
        reused=True,
    )


async def _write_items(job: MappingJob, pairs: list[tuple[dict, dict]]) -> list[dict]:
    """PATCH каждого результата (до 8 сразу) от имени пользователя; вернёт записанные.

    Вопрос, удалённый или изменённый во время разметки (0 строк по id и хэшу текста),
    пропускается: старый результат не ложится на новый текст. Любая другая ошибка
    записи — _WriteFailed.
    """
    semaphore = asyncio.Semaphore(WRITE_CONCURRENCY)

    async def write(question: dict, item: dict) -> dict | None:
        filters = {"id": f"eq.{question['id']}", "exam_id": f"eq.{job.exam_id}", "select": "id"}
        if isinstance(question.get("question_hash"), str) and question["question_hash"]:
            filters["question_hash"] = f"eq.{question['question_hash']}"
        async with semaphore:
            try:
                await job.db.update("exam_questions", filters, _db_values(item, job.fingerprint), require_rows=True)
            except RowLevelDenied:
                return None
        return item

    results = await asyncio.gather(*(write(question, item) for question, item in pairs), return_exceptions=True)
    written: list[dict] = []
    for result in results:
        if isinstance(result, asyncio.CancelledError):
            raise result
        if isinstance(result, BaseException):
            print(f"Exam mapping write failed: {type(result).__name__} {getattr(result, 'status', '')}")
            raise _WriteFailed() from result
        if result is not None:
            written.append(result)
    return written


def _batch_settings() -> tuple[int, int | None]:
    """(вопросов в пачке, обрезка фрагмента): с ключом Gemini — 10 и целые фрагменты, иначе 4 и 450 знаков."""
    if ai_base.gemini_keys():
        return GEMINI_BATCH_SIZE, None
    return GROQ_BATCH_SIZE, GROQ_FRAGMENT_CHARS


def _failed_texts(status: int | None) -> tuple[str, str]:
    return _FAILED_BATCH_TEXTS.get(status or 502, _FAILED_BATCH_TEXTS[502])


async def _ask_judge(agent: Any, groups: list[_Group], fragment_chars: int | None, use_cache: bool = True) -> dict[int, Verdict]:
    block = build_judge_block(
        [
            JudgeQuestion(
                group.text,
                tuple(JudgeCandidate(hit.passage.title, hit.passage.text, hit.heading) for hit in group.hits),
            )
            for group in groups
        ],
        fragment_chars,
    )
    # A heavy call: it waits in the process-wide line (AI_HEAVY_CONCURRENCY) before its 45 s start.
    async with ai_base.heavy_slot():
        raw = await agent.run(
            JUDGE_PROMPT,
            block,
            temperature=0,
            max_tokens=JUDGE_MAX_TOKENS,
            json_mode=True,
            timeout=JUDGE_TIMEOUT_SECONDS,
            thinking="low",
            use_cache=use_cache,
        )
    verdicts, complete = validate_judge_answer(raw, [len(group.hits) for group in groups])
    if not complete:
        BaseAgent.forget(raw)  # повтор должен спросить модель заново, а не взять тот же ответ из кеша
    return verdicts


async def _judge_batch(
    agent: Any, index: int, groups: list[_Group], fragment_chars: int | None, use_cache: bool = True
) -> _BatchOutcome:
    try:
        verdicts = await _ask_judge(agent, groups, fragment_chars, use_cache)
    except AIError as exc:
        return _BatchOutcome(index, groups, {}, error_status=exc.status_code)
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # сбой не провайдера — пачка проверена только по словам
        print(f"Exam mapping judge failed: {type(exc).__name__}")
        return _BatchOutcome(index, groups, {}, error_status=502)
    missing = [position for position in range(len(groups)) if position not in verdicts]
    missing_reasons: dict[int, str] = {}
    if missing:
        # Один повтор пачкой вдвое меньше; кто не пришёл и тогда — «проверено только по словам».
        half = max(1, len(groups) // 2)
        for chunk in _chunks(missing, half):
            try:
                retried = await _ask_judge(agent, [groups[position] for position in chunk], fragment_chars, use_cache)
            except asyncio.CancelledError:
                raise
            except AIError as exc:
                for position in chunk:
                    missing_reasons[position] = _failed_texts(exc.status_code)[0]
                continue
            except Exception as exc:
                print(f"Exam mapping judge retry failed: {type(exc).__name__}")
                continue
            for local, verdict in retried.items():
                verdicts[chunk[local]] = verdict
    return _BatchOutcome(index, groups, verdicts, missing_reasons=missing_reasons)


async def _judge_all(job: MappingJob, batches: list[list[_Group]], fragment_chars: int | None) -> AsyncIterator[_BatchOutcome]:
    """Пачки в порядке готовности: до MAX_IN_FLIGHT сразу, старты не чаще раза в STAGGER_SECONDS."""
    semaphore = asyncio.Semaphore(MAX_IN_FLIGHT)
    gate = asyncio.Lock()
    loop = asyncio.get_running_loop()
    last_start: list[float | None] = [None]

    async def run(index: int, groups: list[_Group]) -> _BatchOutcome:
        async with semaphore:
            async with gate:
                if last_start[0] is not None:
                    wait = last_start[0] + STAGGER_SECONDS - loop.time()
                    if wait > 0:
                        await asyncio.sleep(wait)
                last_start[0] = loop.time()
            # «Проверить заново» (force) спрашивает модель, а не берёт прежний ответ из кеша процесса.
            return await _judge_batch(job.agent, index, groups, fragment_chars, use_cache=not job.force)

    tasks = [asyncio.ensure_future(run(index, groups)) for index, groups in enumerate(batches, start=1)]
    job.tasks.extend(tasks)
    for next_done in asyncio.as_completed(tasks):
        yield await next_done


def _outcome_items(outcome: _BatchOutcome, mapped_at: str, passages: PassageIndex | None = None) -> list[tuple[dict, dict]]:
    pairs: list[tuple[dict, dict]] = []
    if outcome.error_status is not None:
        reason = _failed_texts(outcome.error_status)[0]
        for group in outcome.groups:
            for question in group.questions:
                pairs.append((question, _unverified(str(question["id"]), group.hits, reason, mapped_at, passages)))
        return pairs
    for position, group in enumerate(outcome.groups):
        verdict = outcome.verdicts.get(position)
        for question in group.questions:
            if verdict is None:
                reason = outcome.missing_reasons.get(position, REASON_NO_ANSWER)
                item = _unverified(str(question["id"]), group.hits, reason, mapped_at, passages)
            else:
                item = coverage_from_verdict(str(question["id"]), group.hits, verdict, mapped_at, passages)
            pairs.append((question, item))
    return pairs


async def _finalize(job: MappingJob, failed: bool) -> tuple[str, dict[str, int], str | None]:
    """Итог по всему экзамену: состояние, счётчики и самая старая отметка → exams."""
    rows = await job.db.select("exam_questions", {"select": "id,coverage,mapped_at", "exam_id": f"eq.{job.exam_id}"})
    counts = {"full": 0, "partial": 0, "none": 0, "unverified": 0}
    oldest: tuple[datetime, str] | None = None
    incomplete = False
    for row in rows:
        coverage = row.get("coverage")
        if coverage in counts:
            counts[coverage] += 1
        if coverage is None or coverage == "unverified":
            incomplete = True
        moment = _parse_ts(row.get("mapped_at"))
        if moment is not None and (oldest is None or moment < oldest[0]):
            oldest = (moment, row["mapped_at"])
    state = "failed" if failed else ("partial" if incomplete else "done")
    oldest_value = oldest[1] if oldest else None
    values: dict[str, Any] = {"mapping_state": state, "mapped_at": oldest_value}
    if not failed:
        # Набор лекций разметки меняется только после законченного запуска: после сбоя
        # клиент по-прежнему видит, что лекции изменились, и предлагает обновить разметку.
        values["mapped_material_ids"] = [material.id for material in job.materials]
    await job.db.update(
        "exams",
        {"id": f"eq.{job.exam_id}", "mapping_started_at": f"eq.{job.started_at}", "select": "id"},
        values,
        require_rows=False,
    )
    return state, counts, oldest_value


async def _release_failed(job: MappingJob) -> None:
    """Снять блокировку после сбоя или обрыва; сначала с итогом по экзамену, иначе только состояние."""
    try:
        await _finalize(job, failed=True)
        return
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        print(f"Exam mapping finalize after failure: {type(exc).__name__}")
    try:
        await job.db.update(
            "exams",
            {"id": f"eq.{job.exam_id}", "mapping_started_at": f"eq.{job.started_at}", "select": "id"},
            {"mapping_state": "failed"},
            require_rows=False,
        )
    except Exception as exc:
        print(f"Exam mapping lock release failed: {type(exc).__name__}")


async def run_mapping(job: MappingJob) -> AsyncIterator[dict]:
    """События разметки. Последнее событие — done или error, после него ничего.

    Дневной лимит: перед судьёй списывается plans.exam_mapping_cost(число вопросов, которые
    уходят модели) — готовые и проверенные только по словам бесплатны. Лимита не хватает —
    событие error с code ai_limit (used, limit, resets_at, pro), модель не вызывается. Модель
    не ответила ни по одному вопросу (сбой, пачки «только по словам») — единицы возвращаются.
    """
    job.started = True
    finished = False
    charge = None
    used_ai = False
    try:
        catalog = await asyncio.to_thread(_build_catalog, job.materials)
        material_ids = {material.id for material in job.materials}
        titles = {material.id: material.title for material in job.materials}
        targets = select_targets(job.questions, job.fingerprint, material_ids, job.question_ids, job.force, catalog.fragments)
        pending = list(targets)

        reused_pairs: list[tuple[dict, dict]] = []
        if pending and not job.force:
            hashes = list(dict.fromkeys(q["question_hash"] for q in pending if isinstance(q.get("question_hash"), str) and q["question_hash"]))
            sources = await _find_reusable(job, hashes, catalog.fragments) if hashes else {}
            remaining = []
            for question in pending:
                source = sources.get(question.get("question_hash") or "")
                if source is None:
                    remaining.append(question)
                    continue
                reused_pairs.append((question, _reused_coverage(question, source, titles)))
            pending = remaining

        groups_by_key: dict[str, _Group] = {}
        for question in pending:
            key = _group_key(question)
            group = groups_by_key.get(key)
            if group is None:
                groups_by_key[key] = _Group(key=key, text=str(question.get("text") or ""), questions=[question])
            else:
                group.questions.append(question)
        groups = list(groups_by_key.values())
        await asyncio.to_thread(_search_candidates, catalog.passages, groups)

        yield {
            "type": "start",
            "questions": len(job.questions),
            "to_check": len(targets),
            "fingerprint": job.fingerprint,
            "materials": [
                {"id": material.id, "title": material.title, "fragments": catalog.counts.get(material.id, 0)}
                for material in job.materials
            ],
            "skipped": job.skipped,
        }

        reused_count = 0
        if reused_pairs:
            written = await _write_items(job, reused_pairs)
            reused_count = len(written)
            if written:
                yield {"type": "reused", "items": written}

        mapped_at = _iso(_now())
        lexical_pairs = [
            (question, _lexical_none(str(question["id"]), mapped_at))
            for group in groups
            if not group.hits
            for question in group.questions
        ]
        if lexical_pairs:
            written = await _write_items(job, lexical_pairs)
            if written:
                yield {"type": "lexical", "items": written}

        judged = [group for group in groups if group.hits]
        if judged and job.reserve_units is not None:
            try:
                charge = job.charge = await job.reserve_units(exam_mapping_cost(len(judged)))
            except AIError as exc:
                if exc.code != "ai_limit":
                    raise
                event = exc.event() if hasattr(exc, "event") else {"type": "error", "code": exc.code, "message": exc.detail}
                yield event
                return
        if judged:
            if job.agent is None:
                job.agent = BaseAgent(api_key=os.getenv("GROQ_API_KEY", ""))
            batch_size, fragment_chars = _batch_settings()
            batches = _chunks(judged, batch_size)
            async with contextlib.aclosing(_judge_all(job, batches, fragment_chars)) as outcomes:
                async for outcome in outcomes:
                    pairs = _outcome_items(outcome, _iso(_now()), catalog.by_order)
                    used_ai = used_ai or any(item["method"] == "llm" for _, item in pairs)
                    written = await _write_items(job, pairs)
                    if outcome.error_status is not None:
                        yield {
                            "type": "batch_failed",
                            "index": outcome.index,
                            "total": len(batches),
                            "question_ids": [str(q["id"]) for group in outcome.groups for q in group.questions],
                            "items": written,
                            "message": _failed_texts(outcome.error_status)[1],
                        }
                    else:
                        yield {"type": "batch", "index": outcome.index, "total": len(batches), "items": written}

        state, counts, oldest = await _finalize(job, failed=False)
        finished = True
        yield {
            "type": "done",
            "state": state,
            "counts": counts,
            "reused": reused_count,
            "oldest_mapped_at": oldest,
            "mapped_at": oldest,
            "used_ai": used_ai,
        }
    except _WriteFailed:
        yield {"type": "error", "message": WRITE_FAILED_MESSAGE}
    except Exception as exc:
        print(f"Exam mapping failed: {type(exc).__name__}")
        yield {"type": "error", "message": INTERNAL_MESSAGE}
    finally:
        if charge is not None and not used_ai:
            # Ни один вопрос не проверила модель: единицы возвращаются (в фоне — finally может
            # идти и после ухода клиента; фон ответа дожидается возврата).
            charge.refund_soon()
        for task in job.tasks:
            if not task.done():
                task.cancel()
        if job.tasks:
            await asyncio.gather(*job.tasks, return_exceptions=True)
        if not finished:
            await _release_failed(job)
        await job.db.aclose()
