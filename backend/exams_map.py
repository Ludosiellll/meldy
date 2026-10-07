"""Разметка вопросов экзамена по лекциям студента: POST /api/exams/{exam_id}/map.

Конвейер (спека «Билеты» 5.1–5.3, контракт §4):
1. Чтение с токеном пользователя (RLS): экзамен, вопросы, exam_materials, materials.
   До потока — 404, 409, 400, 422, 413; затем блокировка условным PATCH экзамена.
2. Отпечаток лекций fp = sha256(",".join(sorted("<id>:<sha256(text)>"))). Вопрос с тем
   же question_hash, fp и MAP_VERSION в любом экзамене пользователя получает готовый
   результат без модели, с его исходной датой mapped_at (событие reused).
3. Кандидаты — BM25 (retrieval.py) по всем фрагментам лекций: топ-6, не больше 3 из
   одной лекции. План лекции, оглавление и вопросы для самоконтроля (retrieval.is_plan_text)
   этих трёх мест не занимают (проходят, только пока у лекции место есть), и такой
   фрагмент от лекции — не больше одного: в плане названы все темы, и без этого правила
   он вытеснял раздел с ответом. Нет ни одного общего слова — «нет» без модели (событие
   lexical).
4. Судья (P3) пачками: 10 вопросов при ключе Gemini, иначе 4 (фрагменты по 450 знаков);
   до 3 пачек сразу со сдвигом 0,8 с, и каждая пачка ждёт места в общей очереди тяжёлых
   вызовов процесса (agents.base.heavy_slot, AI_HEAVY_CONCURRENCY). Метки [C1], [C2], …
   сквозные по пачке (exams_prompts.batch_labels), поэтому метка из списка соседнего
   вопроса — не своя. Проверки честности (validate_judge_answer): опоры только из
   кандидатов своего вопроса; у каждой опоры «есть»/«частично» — дословная цитата от 5 слов
   подряд, и сервер ищет её в названном фрагменте (oral.verify_quote: регистр, ё/е,
   пробелы, знаки, тире и кавычки не важны). Цитата нашлась в другом своём кандидате, и
   только в одном, — опора переносится туда; ни в одном своём — опора отбрасывается.
   «Есть»/«частично» без проверенной опоры (в «нет» такой ответ не превращается) и
   пропущенные номера — один повтор пачкой вдвое меньше, затем «проверено только по
   словам»; 429/502/504 — пачка проверена только по словам (batch_failed).
5. Каждый результат записывается в exam_questions до своего события. В конце
   exams.mapping_state и exams.mapped_at = самая старая отметка экзамена.

Текст доказательства — всегда целый фрагмент лекции (build_source_chunks без потолка),
ближайший фрагмент — его дословная часть до 300 знаков. Текст модели, и цитата тоже,
туда не попадает. От проверенной цитаты остаётся только её место: focus = [начало, конец)
слов цитаты в excerpt (смещения в кодовых точках Unicode, по тексту, как он хранится), —
по нему экран показывает длинный фрагмент вокруг ответа. У строк, размеченных раньше,
focus нет; MAP_VERSION ключ не поднимает (необязательный, при повторном использовании
переносится). Если поиск склеил фрагмент с заголовком раздела и слова вопроса есть
в заголовке, заголовок — отдельный целый фрагмент в доказательствах (перед текстом) или
ближайший фрагмент, когда совпал только он. В пояснениях судьи метки кандидатов
заменяются номерами фрагментов, «Нет …» в начале missing убирается (на экране «Не хватает:
…»). Пояснение «есть»/«частично» без содержания («Вопрос полностью раскрыт в приложенных
фрагментах», generic_reason), с меткой не своего вопроса или пустое не сохраняется: экран
лучше промолчит, чем покажет общую фразу; у «нет» вместо него — общее пояснение сервера.
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
from typing import Any, AsyncIterator, Iterable, Sequence

import oral
from agents import base as ai_base
from agents.base import AIError, BaseAgent, parse_model_json
from exams_prompts import (
    JUDGE_PROMPT,
    JudgeCandidate,
    JudgeQuestion,
    batch_labels,
    build_judge_block,
    candidate_text,
)
from plans import exam_mapping_cost
from retrieval import STOPWORDS, BM25Index, Hit, Passage, material_passages, stem, terms
from supabase_rest import RowLevelDenied, SupabaseRest, SupabaseRestError

__all__ = [
    "MAP_VERSION",
    "JudgeAnswer",
    "MapError",
    "MappingJob",
    "Verdict",
    "clean_missing",
    "clean_reason",
    "coverage_from_verdict",
    "generic_reason",
    "heading_passages",
    "materials_fingerprint",
    "passage_index",
    "prepare_mapping",
    "quote_spans",
    "release_unstarted",
    "run_mapping",
    "select_targets",
    "validate_judge_answer",
]

# Результат с той же версией, тем же question_hash и тем же отпечатком лекций переиспользуется
# без модели. Сквозные метки и цитаты (07.10.2026) версию не поднимали: подъём заставил бы
# следующую сверку каждого экзамена заново проверить и списать все «частично» и «нет», ссылки
# группы ждали бы этой сверки автора (exam_shares.plan_copy требует пустой select_targets), а
# «есть» с чужим доказательством select_targets всё равно не перепроверяет.
MAP_VERSION = 1
LOCK_STALE_SECONDS = 300
MAX_TOTAL_CHARS = 3_000_000
TOP_K = 6
PER_MATERIAL_CAP = 3
PLANS_PER_MATERIAL = 1  # план или оглавление лекции среди кандидатов: не больше одного и вне PER_MATERIAL_CAP
QUOTE_MIN_WORDS = 5  # промпт просит 5–15 слов; длиннее — тоже дословная цитата и годится
QUOTE_MAX_CHARS = 1000  # длиннее любого фрагмента (850 знаков): не цитата
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
# Прежняя разметка сохраняла «есть»/«частично» без опоры как «нет» с этой причиной; новая так
# не делает (REASON_NO_QUOTE), но строки с ней в базе остаются, и клиент её узнаёт.
REASON_NO_SUPPORT = "Нет подтверждающего фрагмента"
REASON_NO_ANSWER = "Проверено только по словам: модель не вернула ответ по этому вопросу"
REASON_NO_QUOTE = "Проверено только по словам: модель не подтвердила ответ цитатой из лекции"
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
    [REASON_NO_OVERLAP, REASON_NO_SUPPORT, REASON_NO_ANSWER, REASON_NO_QUOTE, *_DEFAULT_REASONS.values()]
    + [reason for reason, _ in _FAILED_BATCH_TEXTS.values()]
)
WRITE_FAILED_MESSAGE = "Не удалось сохранить результаты сверки. Уже проверенные вопросы сохранены — повторите через минуту."
INTERNAL_MESSAGE = "Сверка прервалась из-за ошибки на сервере. Уже проверенные вопросы сохранены — повторите через минуту."

_UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_SOURCE_ID_RE = re.compile(r"^S\d{1,4}$")
# Метка в support: «C12», «[C3]», «С7» с кириллицей. Меток в пачке до 60; три цифры — с запасом,
# и «C100» не читается как «C10».
_LABEL_RE = re.compile(r"[CcСс]\s*(\d{1,3})(?!\d)")
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
    support: tuple[int, ...]  # номера кандидатов этого вопроса (0 → первый), только существующие
    missing: str
    reason: str
    # Номера меток кандидатов в пачке по их порядку (C14 → 14): по ним метки в пояснениях
    # становятся номерами фрагментов. Пусто — метки C1…Cn по порядку кандидатов.
    labels: tuple[int, ...] = ()
    # Проверенная цитата каждой опоры (по порядку support): по ней в доказательстве отмечается место
    # ответа (focus). Сама цитата никуда не сохраняется. Пусто — мест нет.
    quotes: tuple[str, ...] = ()


@dataclass
class JudgeAnswer:
    """Ответ судьи на пачку после проверок сервера."""

    verdicts: dict[int, Verdict]  # номер вопроса в пачке (с 0) → Verdict
    complete: bool  # на каждый вопрос годный вердикт, лишнего нет: ответ можно оставить в кеше
    unconfirmed: frozenset[int] = frozenset()  # «есть»/«частично» без проверенной опоры — как пропуск
    moved: int = 0  # опор, перенесённых по цитате на другой свой фрагмент
    dropped: int = 0  # опор, отброшенных: цитаты нет, она короткая или её нет ни в одном своём фрагменте


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


def _label_numbers(value: Any) -> list[int]:
    """Номера меток в значении модели: «C12», «[С3]» (кириллица), «C2 и C5», число 4 (→ C4)."""
    if isinstance(value, bool):
        return []
    if isinstance(value, int):
        return [value]
    if isinstance(value, float):
        return [int(value)] if value.is_integer() else []
    if isinstance(value, str):
        return [int(match.group(1)) for match in _LABEL_RE.finditer(value)]
    return []


def _support_entries(value: Any) -> list[tuple[list[int], Any]]:
    """support модели → [(номера меток, цитата)].

    Ожидается [{"label": "C2", "quote": "…"}]; принимаются и {"C2": "…"}, и метки без цитат
    («C2», 2) — у таких опор цитаты нет, и для «есть»/«частично» они не годятся.
    """
    if isinstance(value, dict):
        items: list[Any] = [{"label": label, "quote": quote} for label, quote in value.items()]
    elif isinstance(value, list):
        items = value
    else:
        items = [] if value is None else [value]
    entries: list[tuple[list[int], Any]] = []
    for item in items:
        if isinstance(item, dict):
            entries.append((_label_numbers(item.get("label")), item.get("quote")))
        else:
            entries.append((_label_numbers(item), None))
    return entries


_QUOTE_MARKS = "«»\"“”„'‘’‚ \t\r\n"
_QUOTE_ELLIPSIS_RE = re.compile(r"^(?:…|\.{3,})\s*|\s*(?:…|\.{3,})$")
_QUOTE_WORD_RE = re.compile(r"\w+")


def _quote_text(value: Any) -> str | None:
    """Цитата модели без кавычек и «…» по краям («…» в конце — след обрезки фрагмента до 450 знаков)."""
    if not isinstance(value, str) or len(value) > QUOTE_MAX_CHARS:
        return None
    text = _QUOTE_ELLIPSIS_RE.sub("", value.strip(_QUOTE_MARKS)).strip(_QUOTE_MARKS)
    return text or None


def _comparable(word: str) -> str:
    return word.lower().replace("ё", "е")


def _quote_words(text: str) -> list[str]:
    """Слова, как их сравнивает oral.verify_quote: \\w+ без регистра, «ё» = «е»."""
    return [_comparable(word) for word in _QUOTE_WORD_RE.findall(unicodedata.normalize("NFC", text))]


def _word_spans(text: str) -> list[tuple[int, int, str]] | None:
    """Слова текста, как их сравнивает oral.verify_quote (\\w+ его NFC-формы, без регистра, «ё» = «е»),
    со смещениями в самом тексте — как он хранится, до NFC.

    NFC собирает «й» из «и» и U+0306: знак с combining class 0 вместе со следующими combining-знаками —
    один кластер, его знаки NFC указывают на начало и конец кластера в исходном тексте. Если по
    кластерам NFC вышла не такой, как целиком (письменности, где знаки собираются через кластер), —
    None: место не отмечается, лучше никакого, чем сдвинутое.
    """
    if unicodedata.is_normalized("NFC", text):
        return [(match.start(), match.end(), _comparable(match.group())) for match in _QUOTE_WORD_RE.finditer(text)]
    starts: list[int] = []
    ends: list[int] = []
    pieces: list[str] = []
    index = 0
    while index < len(text):
        end = index + 1
        while end < len(text) and unicodedata.combining(text[end]):
            end += 1
        piece = unicodedata.normalize("NFC", text[index:end])
        pieces.append(piece)
        starts.extend([index] * len(piece))
        ends.extend([end] * len(piece))
        index = end
    normal = "".join(pieces)
    if normal != unicodedata.normalize("NFC", text):
        return None
    return [
        (starts[match.start()], ends[match.end() - 1], _comparable(match.group()))
        for match in _QUOTE_WORD_RE.finditer(normal)
    ]


def quote_spans(quote: Any, texts: Sequence[str]) -> list[tuple[int, int] | None] | None:
    """Где проверенная цитата в текстах, которые судья читал подряд (заголовки раздела, затем фрагмент).

    Слова цитаты ищутся так же, как их нашла oral.verify_quote в склейке «заголовок. текст»: первое
    место, где они идут подряд (регистр, «ё»/«е», пробелы, переносы, тире, кавычки и знаки не важны).
    Для каждого текста — (начало, конец) его части цитаты: от первого до последнего её слова в этом
    тексте, в кодовых точках самого текста, как он хранится; None — цитата его не задевает. Цитата,
    начатая в заголовке, отмечает фрагмент с его начала. None целиком — цитаты в текстах нет.
    """
    if not isinstance(quote, str):
        return None
    wanted = _quote_words(quote)
    if not wanted:
        return None
    tokens: list[tuple[int, int, int]] = []  # (номер текста, начало, конец)
    words: list[str] = []
    for owner, text in enumerate(texts):
        spans = _word_spans(text or "")
        if spans is None:
            return None
        for start, end, word in spans:
            tokens.append((owner, start, end))
            words.append(word)
    size = len(wanted)
    for first in range(len(words) - size + 1):
        if words[first:first + size] != wanted:
            continue
        found: list[tuple[int, int] | None] = [None] * len(texts)
        for owner, start, end in tokens[first:first + size]:
            current = found[owner]
            found[owner] = (start, end) if current is None else (current[0], end)
        return found
    return None


def _quote_in(quote: str, text: str) -> bool:
    """Цитата — слова текста фрагмента подряд, дословно.

    Сравнение — oral.verify_quote: регистр, «ё»/«е», пробелы и переносы, знаки препинания,
    тире и дефисы, вид кавычек не важны; «…» внутри или слова не подряд — не цитата.
    Короче QUOTE_MIN_WORDS слов цитата годится, только если это весь фрагмент.
    """
    wanted = _quote_words(quote)
    if len(wanted) < QUOTE_MIN_WORDS:
        return bool(wanted) and wanted == _quote_words(text)
    return oral.verify_quote(quote, [("S", text)], max_chars=len(text) + 1) is not None


def _checked_support(
    value: Any, labels: Sequence[int], texts: Sequence[str]
) -> tuple[tuple[int, ...], tuple[str, ...], int, int]:
    """Опоры «есть»/«частично» после проверки цитат: (номера кандидатов, их цитаты, перенесено, отброшено).

    labels и texts — метки и тексты кандидатов вопроса (как их читал судья, без обрезки).
    Опора остаётся у названного своего фрагмента, если цитата в нём есть. Иначе — цитата не
    из него, метка чужая или её нет — опора переходит к своему фрагменту с этой цитатой, если
    такой ровно один, и отбрасывается, если таких нет или их несколько. Без цитаты —
    отбрасывается: метке без цитаты сервер не верит. Цитата опоры — первая, что подтвердила
    её фрагмент: по ней отмечается место ответа (focus).
    """
    own = {label: index for index, label in enumerate(labels)}
    support: list[int] = []
    quotes: list[str] = []
    moved = dropped = 0
    for numbers, raw_quote in _support_entries(value):
        quote = _quote_text(raw_quote)
        if quote is None:
            dropped += 1
            continue
        named = [own[number] for number in dict.fromkeys(numbers) if number in own]
        chosen = next((index for index in named if _quote_in(quote, texts[index])), None)
        if chosen is None:
            found = [index for index in range(len(texts)) if index not in named and _quote_in(quote, texts[index])]
            if len(found) != 1:
                dropped += 1
                continue
            chosen = found[0]
            moved += 1
        if chosen not in support:
            support.append(chosen)
            quotes.append(quote)
    return tuple(support), tuple(quotes), moved, dropped


def validate_judge_answer(raw: Any, questions: Sequence[JudgeQuestion]) -> JudgeAnswer:
    """Ответ судьи на пачку questions (та же пачка, что в build_judge_block) → JudgeAnswer.

    Пропускаются: элементы не-объекты, номер вне пачки, повтор номера (берётся первый),
    неизвестное значение coverage. Метки сквозные по пачке (batch_labels), поэтому метка из
    списка другого вопроса среди своих не найдётся. У «есть»/«частично» каждая опора
    проверяется цитатой (_checked_support); не осталось ни одной — вердикта нет, вопрос в
    unconfirmed и пойдёт на тот же повтор, что пропущенный номер: в «нет» он не превращается.
    «Нет» опор и цитат не требует.
    """
    labels = batch_labels(questions)
    texts = [tuple(candidate_text(candidate) for candidate in question.candidates) for question in questions]
    try:
        parsed = parse_model_json(raw)
    except (ValueError, TypeError):
        return JudgeAnswer({}, False)
    if isinstance(parsed, dict):
        items = parsed.get("results")
        if items is None and isinstance(parsed.get("items"), list):
            items = parsed.get("items")
    elif isinstance(parsed, list):
        items = parsed
    else:
        items = None
    if not isinstance(items, list):
        return JudgeAnswer({}, False)
    verdicts: dict[int, Verdict] = {}
    unconfirmed: set[int] = set()
    moved = dropped = 0
    clean = True
    for item in items:
        if not isinstance(item, dict):
            clean = False
            continue
        number = _as_int(item.get("n"))
        if number is None or not 1 <= number <= len(questions):
            clean = False
            continue
        index = number - 1
        if index in verdicts or index in unconfirmed:
            clean = False
            continue
        coverage = _COVERAGE_WORDS.get(str(item.get("coverage") or "").strip().lower())
        if coverage is None:
            clean = False
            continue
        support: tuple[int, ...] = ()
        quotes: tuple[str, ...] = ()
        if coverage in ("full", "partial"):
            support, quotes, item_moved, item_dropped = _checked_support(item.get("support"), labels[index], texts[index])
            moved += item_moved
            dropped += item_dropped
            if not support:
                unconfirmed.add(index)
                clean = False
                continue
        verdicts[index] = Verdict(
            coverage=coverage,
            support=support,
            missing=_note(item.get("missing")),
            reason=_note(item.get("reason")),
            labels=labels[index],
            quotes=quotes,
        )
    complete = clean and len(verdicts) == len(questions)
    return JudgeAnswer(verdicts, complete, frozenset(unconfirmed), moved, dropped)


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


def _quote_focus(hit: Hit, quote: str | None, passages: PassageIndex | None) -> dict[tuple[str, str], list[int]]:
    """Место проверенной цитаты в доказательствах находки: {(material_id, S-id): [начало, конец)}.

    Судья читал «заголовок. текст» (exams_prompts.candidate_text), и цитата может начаться в
    заголовке раздела. Заголовки, сопоставленные с фрагментами лекции (heading_passages), получают
    свою часть цитаты; несопоставленный заголовок только участвует в поиске.
    """
    if not quote:
        return {}
    heads = list(heading_passages(hit, passages))
    owners: list[Passage | None] = [*heads, hit.passage] if heads else ([None, hit.passage] if hit.heading else [hit.passage])
    spans = quote_spans(quote, [(hit.heading or "") if owner is None else owner.text for owner in owners])
    if spans is None:
        return {}
    return {
        (owner.material_id, owner.source_id): [span[0], span[1]]
        for owner, span in zip(owners, spans)
        if owner is not None and span is not None
    }


def _with_focus(item: dict, focus: list[int] | None) -> dict:
    if focus is not None:
        item["focus"] = focus
    return item


def _evidence(
    hits: list[Hit], support: Iterable[int], passages: PassageIndex | None, quotes: Sequence[str] = ()
) -> list[dict]:
    """Доказательства: целые фрагменты опорных находок, перед каждым — его заголовок.

    Сначала фрагменты-содержания (до EVIDENCE_LIMIT), на оставшиеся места — заголовки
    разделов, в которых совпали слова вопроса: судья читал «заголовок. текст», и без
    заголовка в доказательстве не было бы слов, по которым вопрос сверен. quotes —
    проверенные цитаты опор (по порядку support): по ним у фрагмента есть focus.
    """
    support = tuple(support)
    quote_of: dict[int, str] = {}
    for index, quote in zip(support, quotes):
        quote_of.setdefault(index, quote)
    chosen: list[tuple[Hit, str | None]] = []
    seen: set[tuple[str, str]] = set()
    for index in support:
        if not 0 <= index < len(hits):
            continue
        hit = hits[index]
        key = (hit.passage.material_id, hit.passage.source_id)
        if key in seen:
            continue
        seen.add(key)
        chosen.append((hit, quote_of.get(index)))
        if len(chosen) >= EVIDENCE_LIMIT:
            break
    room = EVIDENCE_LIMIT - len(chosen)
    headings: list[list[Passage]] = [[] for _ in chosen]
    for position, (hit, _) in enumerate(chosen):
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
    for position, (hit, quote) in enumerate(chosen):
        focus = _quote_focus(hit, quote, passages)
        evidence.extend(
            _with_focus(_passage_item(passage), focus.get((passage.material_id, passage.source_id)))
            for passage in headings[position]
        )
        evidence.append(_with_focus(evidence_item(hit), focus.get((hit.passage.material_id, hit.passage.source_id))))
    return evidence


def _focus_of(item: dict) -> list[int] | None:
    """focus доказательства, если он годится для его excerpt: два целых, 0 ≤ начало < конец ≤ длины."""
    value, excerpt = item.get("focus"), item.get("excerpt")
    if not isinstance(value, list) or len(value) != 2 or not isinstance(excerpt, str):
        return None
    start, end = value
    if any(not isinstance(number, int) or isinstance(number, bool) for number in (start, end)):
        return None
    return [start, end] if 0 <= start < end <= len(excerpt) else None


# ── Пояснения судьи: без внутренних меток кандидатов ────────────────────────────

_NOT_WORD = r"(?<![0-9A-Za-zА-Яа-яЁё])"
# Метка кандидата: «[C1]», «[С 27]» (кириллица) или «C34» без пробела (а «С 5 видами» — не метка).
# Меток в пачке до 60 (10 вопросов × 6 кандидатов); три цифры — с запасом.
_LABEL = rf"(?:\[\s*[CС]\s?\d{{1,3}}\s*\]|{_NOT_WORD}[CС]\d{{1,3}}(?![0-9A-Za-zА-Яа-яЁё]))"
_LABEL_RUN_RE = re.compile(
    rf"(?:{_NOT_WORD}(?P<prep>[Вв]о?|[Ии]з|[Пп]о)\s+|{_NOT_WORD}(?P<word>[Фф]рагмент[а-яё]*)\s*)?"
    rf"(?P<paren>\(\s*)?(?P<run>{_LABEL}(?:\s*(?:,|и|-|–|—|/)\s*{_LABEL})*)(?(paren)\s*\))"
)
_LABEL_NUMBER_RE = re.compile(r"[CС]\s?(\d{1,3})")
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
# Слова общего вердикта (формы без регистра, «ё» = «е»). Пояснение только из них ничего не говорит о
# содержании: живой прогон 07.10 — 12 «есть» из 15 с «Вопрос полностью раскрыт в приложенных
# фрагментах». Тот же список — frontend/src/lib/exams/genericReason.ts: строки, сохранённые раньше,
# панель «Почему» тоже не показывает. Точные формы там, где основа задела бы слово по теме:
# «ответ», но не «ответственность»; «тема», но не «температура»; «освещена», но не «освещённость».
_GENERIC_REASON_WORD_RE = re.compile(
    r"в|во|на|о|об|по|и|из|с|со|к|для|это|этот|этом|эти|этих|данн(?:ый|ом|ых|ые)|\d+"
    r"|вопрос\w*|ответ(?:а|е|ом|ы|ов|ам|ах)?|тем(?:а|ы|у|е|ой)"
    r"|фрагмент\w*|материал(?:ы|а|е|ов|ам|ах|ами)?|лекци\w*|текст(?:а|е|ы|ов|ах)?"
    r"|приложенн\w*|предоставленн\w*|представленн\w*"
    r"|полностью|целиком|полн(?:ый|ая|ое|ые|ого|ую|ом|ым|ой|ых)|исчерпывающ\w*|подробн\w*|достаточн\w*"
    r"|раскрыт\w*|раскрыва\w*|освещ(?:ен|ена|ено|ены|ается|аются)|содерж\w*|есть|имеет\w*|имеют\w*"
    r"|присутству\w*|изложен\w*|приведен\w*|дан|дана|дано|даны|описан(?:а|о|ы)?|рассмотрен(?:а|о|ы)?"
    r"|отвеча\w*|часть|части|частичн\w*|информаци\w*|необходим\w*|весь|вся|все|всего"
)


class _UnknownLabel(Exception):
    """В пояснении метка, которой нет среди кандидатов вопроса."""


def _fragment_numbers(hits: list[Hit], labels: Sequence[int] = ()) -> dict[int, str]:
    """Номер метки кандидата (C14 → 14) → номер фрагмента, как его видит человек («S07» → «7»).

    labels — номера меток кандидатов в пачке по порядку кандидатов (Verdict.labels); пусто —
    метки C1…Cn. Меток других вопросов пачки здесь нет.
    """
    pairs = zip(labels, hits) if labels else enumerate(hits, start=1)
    numbers: dict[int, str] = {}
    for label, hit in pairs:
        digits = hit.passage.source_id[1:] if hit.passage.source_id[:1] == "S" else ""
        if digits.isdigit():
            numbers[label] = str(int(digits))
    return numbers


def _relabel(text: str, numbers: dict[int, str]) -> str:
    """«[C1]», «C2 и C3», «во фрагменте C1» → «(фрагмент 14)», «фрагменты 15 и 16», «во фрагменте 14».

    Метки судья видит сквозными по пачке; человеку они ничего не говорят. numbers — метки
    кандидатов своего вопроса (_fragment_numbers). Метка вне них, в том числе метка соседнего
    вопроса, — _UnknownLabel (пояснение тогда не показывается).
    """

    def replace(match: re.Match) -> str:
        run = match.group("run")
        labels = list(_LABEL_NUMBER_RE.finditer(run))
        named = [int(labels[0].group(1))]
        for previous, label in zip(labels, labels[1:]):
            number = int(label.group(1))
            if run[previous.end():label.start()].strip(" []") in ("-", "–", "—") and number > named[-1]:
                named.extend(range(named[-1] + 1, number + 1))  # «C1–C3»: кандидаты идут не по порядку фрагментов
            else:
                named.append(number)
        values: list[str] = []
        for number in dict.fromkeys(named):
            value = numbers.get(number)
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


def generic_reason(text: Any) -> bool:
    """Пояснение — общий вердикт без содержания: каждое его слово из _GENERIC_REASON_WORD_RE.

    «Вопрос полностью раскрыт в приложенных фрагментах», «Ответ есть во фрагментах», «Фрагменты
    содержат ответ», «Материалы содержат исчерпывающий ответ на вопрос» — да; «Свойства ACID
    полностью описаны в тексте» — нет: «свойства» и «ACID» говорят, что именно есть.
    """
    if not isinstance(text, str):
        return False
    words = _QUOTE_WORD_RE.findall(unicodedata.normalize("NFC", text))
    return bool(words) and all(_GENERIC_REASON_WORD_RE.fullmatch(_comparable(word)) for word in words)


def clean_reason(reason: str, coverage: str, numbers: dict[int, str]) -> str:
    """Пояснение судьи для человека: метки кандидатов → номера фрагментов.

    У «есть»/«частично» пояснение без содержания (generic_reason), пустое или с чужой меткой — пустая
    строка: под «Есть в ваших лекциях» экран ничего не покажет, а не «Вопрос полностью раскрыт». У «нет»
    в этих случаях — общее пояснение сервера (на экране его нет, его сравнивают отчёт и шпаргалка).
    """
    default = _DEFAULT_REASONS["none"] if coverage == "none" else ""
    if not reason:
        return default
    try:
        cleaned = _note(_relabel(reason, numbers))
    except _UnknownLabel:
        return default
    if not cleaned or generic_reason(cleaned):
        return default
    return cleaned


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
    «Есть»/«частично» без опоры сюда из validate_judge_answer не попадает; если всё же
    попало — «проверено только по словам», а не «нет»: ложное «нет в лекциях» не лучше
    чужой цитаты.
    """
    numbers = _fragment_numbers(hits, verdict.labels)
    if verdict.coverage in ("full", "partial"):
        evidence = _evidence(hits, verdict.support, passages, verdict.quotes)
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
        return _unverified(question_id, hits, REASON_NO_QUOTE, mapped_at, passages)
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
    """BM25-кандидаты для групп (в потоке-исполнителе: стемминг и индекс — на CPU).

    План лекции или оглавление (retrieval.is_plan_text) не занимает места лекции из
    PER_MATERIAL_CAP (и проходит, только пока у лекции место есть), таких фрагментов от
    лекции не больше PLANS_PER_MATERIAL: в плане названы все темы лекции, и раньше он и
    вступление забирали места раздела с ответом.
    """
    if not groups:
        return
    index = BM25Index(passages)
    settings = {"top_k": TOP_K, "per_material_cap": PER_MATERIAL_CAP, "plans_per_material": PLANS_PER_MATERIAL}
    for group in groups:
        hits = index.search(group.text, exam_stopwords=True, **settings)
        if not hits and not terms(group.text, exam_stopwords=True):
            # Вопрос из одних слов-инструкций («Роль и значение.»): ищем по всем словам.
            hits = index.search(group.text, exam_stopwords=False, **settings)
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
    """Готовый результат другого вопроса с тем же текстом: дата и доказательства — его, названия — нынешние.

    focus доказательства переносится, если он годится для его excerpt (а excerpt — нынешний
    фрагмент лекции, иначе строка не годилась бы); у строк без него focus так и нет.
    """
    evidence = [
        _with_focus(
            {
                "material_id": item["material_id"],
                "material_title": titles.get(item["material_id"], _title(item.get("material_title"))),
                "source_id": item["source_id"],
                "excerpt": item["excerpt"],
            },
            _focus_of(item),
        )
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
    # Строки, размеченные раньше: метки кандидатов того запуска уже ни с чем не сопоставить. Общие
    # пояснения сервера у «есть»/«частично» («Ответ есть во фрагментах лекций») тоже чистятся: экран
    # их не показывает.
    reason = _note(source.get("coverage_reason"), DB_NOTE_CHARS)
    if reason not in _FIXED_REASONS or reason in _DEFAULT_REASONS.values():
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


def _judge_questions(groups: list[_Group]) -> list[JudgeQuestion]:
    """Пачка для судьи: ключ кандидата — (material_id, S-id), по нему одна метка на фрагмент."""
    return [
        JudgeQuestion(
            group.text,
            tuple(
                JudgeCandidate(hit.passage.title, hit.passage.text, hit.heading, (hit.passage.material_id, hit.passage.source_id))
                for hit in group.hits
            ),
        )
        for group in groups
    ]


async def _ask_judge(agent: Any, groups: list[_Group], fragment_chars: int | None, use_cache: bool = True) -> JudgeAnswer:
    questions = _judge_questions(groups)
    block = build_judge_block(questions, fragment_chars)
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
    answer = validate_judge_answer(raw, questions)
    if not answer.complete:
        BaseAgent.forget(raw)  # повтор должен спросить модель заново, а не взять тот же ответ из кеша
    if answer.moved or answer.dropped or answer.unconfirmed:
        # Только счётчики: ни вопросов, ни цитат в журнал сервера не пишем.
        print(f"Exam mapping quotes: moved {answer.moved}, dropped {answer.dropped}, unconfirmed {len(answer.unconfirmed)}")
    return answer


async def _judge_batch(
    agent: Any, index: int, groups: list[_Group], fragment_chars: int | None, use_cache: bool = True
) -> _BatchOutcome:
    try:
        answer = await _ask_judge(agent, groups, fragment_chars, use_cache)
    except AIError as exc:
        return _BatchOutcome(index, groups, {}, error_status=exc.status_code)
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # сбой не провайдера — пачка проверена только по словам
        print(f"Exam mapping judge failed: {type(exc).__name__}")
        return _BatchOutcome(index, groups, {}, error_status=502)
    verdicts = dict(answer.verdicts)
    # «Есть»/«частично» без проверенной цитаты — как пропущенный номер, но со своей причиной.
    missing_reasons: dict[int, str] = {position: REASON_NO_QUOTE for position in answer.unconfirmed}
    missing = [position for position in range(len(groups)) if position not in verdicts]
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
            for local, position in enumerate(chunk):
                if local in retried.verdicts:
                    verdicts[position] = retried.verdicts[local]
                    missing_reasons.pop(position, None)
                elif local in retried.unconfirmed:
                    missing_reasons[position] = REASON_NO_QUOTE
                else:
                    missing_reasons.pop(position, None)  # повтор не ответил вовсе: REASON_NO_ANSWER
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
        elif charge is not None:
            charge.keep()  # итог списания: журнал вызовов пишет единицы, которые остались
        for task in job.tasks:
            if not task.done():
                task.cancel()
        if job.tasks:
            await asyncio.gather(*job.tasks, return_exceptions=True)
        if not finished:
            await _release_failed(job)
        await job.db.aclose()
