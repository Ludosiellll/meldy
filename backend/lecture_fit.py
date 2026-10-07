"""Какие лекции подходят к вопросам списка: POST /api/exams/lecture-fit (подсказка редактора экзамена).

Без модели и без единиц дневного лимита, в базу ничего не пишет. Лекции читаются с токеном
пользователя (действует RLS) и с фильтром user_id — только свои. Фрагменты те же, что у сверки
(retrieval.material_passages: build_source_chunks без потолка), индекс BM25 — один на все лекции.
Совпадение слов — не доказательство: подсказка говорит «подходит», есть ли ответ — решает сверка.

Правило «лекция L подходит к вопросу q» (fitting_lectures; откалибровано 07.10.2026 на курсе
«Базы данных» — 3 лекции, 20 вопросов — и на примере /try — 3 лекции, 12 вопросов, — друг другу
помехами, с короткими лекциями других предметов; цифры — в докстроке тестов test_lecture_fit.py):
1. Основы вопроса — retrieval.terms(q, exam_stopwords=True) без FIT_STOPWORDS: порядковых слов
   («Первая и вторая нормальные формы») и глаголов задания («Составьте SQL-запрос…»), которые о
   теме не говорят. Не осталось ни одной — к вопросу не подходит ничего.
2. У каждой лекции берутся её три лучших по BM25 фрагмента (BM25Index.top_per_material), кроме
   плана, оглавления и вопросов для самоконтроля (retrieval.is_plan_text): план называет все темы
   лекции, но не объясняет ни одной. Оценка лекции — оценка лучшего из них.
3. Покрытие лекции — наибольшая среди этих фрагментов доля веса (idf) основ вопроса, найденных в
   фрагменте: короткий фрагмент с общим словом может обогнать по BM25 абзац, где вопрос раскрыт.
   Порог (coverage_floor): 0,5 у вопроса до 5 основ, на 0,05 меньше за каждую следующую, но не
   меньше 0,3: в длинном практическом задании («…для каждой учебной группы выводит число
   студентов…») много слов, которых в лекции и не должно быть.
4. Из лекций с покрытием не ниже порога подходят те, чья оценка не меньше SCORE_SHARE (0,7)
   лучшей из них и покрытие не меньше COVERAGE_SHARE (0,8) лучшего: общее слово («данные»,
   «процесс», «способы записи») не делает подходящей каждую лекцию, где оно есть.
Вопрос, к которому не подошла ни одна лекция, — «без подходящей лекции»: нужной лекции нет среди
проверенных, или этой темы нет в лекциях.

Чтение и потолок. Лекции — все свои или только из material_ids запроса, не больше MAX_LECTURES,
от новых к старым. Текста — не больше MAX_TOTAL_CHARS (3 000 000 знаков, как у сверки): лекция,
которая уже не помещается, не проверяется (skipped, reason «limit»), более старые проверяются,
пока помещаются. Лекция без текста — reason «no_text», id из material_ids, которого пользователь не
видит (удалена или чужая), — «missing».

Кеш. Индекс строится в потоке-исполнителе и живёт CACHE_SECONDS (5 минут) под ключом
(пользователь, отпечаток лекций) — exams_map.materials_fingerprint, sha256 текстов. Редактор
спрашивает снова после каждой правки списка, поэтому каждый вызов читает только id и даты лекций
(RLS), а тексты — когда набор лекций сменился или запись устарела: набор id на те же 5 минут
помнит свой отпечаток. Текст лекции после загрузки не меняется, у новой лекции новый id.
"""

from __future__ import annotations

import asyncio
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Iterable, Sequence

from exams_map import materials_fingerprint
from retrieval import BM25Index, material_passages, stem, terms
from supabase_rest import SupabaseRest, SupabaseRestError

__all__ = [
    "COVERAGE_SHARE",
    "FIT_STOPWORDS",
    "FitError",
    "MAX_LECTURES",
    "MAX_MATERIAL_IDS",
    "MAX_QUESTIONS",
    "MAX_TOTAL_CHARS",
    "QUESTION_CHARS",
    "SCORE_SHARE",
    "coverage_floor",
    "fitting_lectures",
    "lecture_fit",
    "question_terms",
    "reset_cache",
]

MAX_QUESTIONS = 300
QUESTION_CHARS = 600
MAX_MATERIAL_IDS = 500
MAX_LECTURES = 300
MAX_TOTAL_CHARS = 3_000_000
LIST_LIMIT = 2_000  # все лекции пользователя (без material_ids): строк id и дат, не текстов
IN_FILTER_CHUNK = 50
TEXT_CHUNK = 10

PASSAGES_PER_LECTURE = 3
SHORT_QUESTION_TERMS = 5
COVERAGE_FLOOR_SHORT = 0.5
COVERAGE_FLOOR_STEP = 0.05
COVERAGE_FLOOR_MIN = 0.3
SCORE_SHARE = 0.7
COVERAGE_SHARE = 0.8

CACHE_SECONDS = 300.0
CACHE_MAX_ENTRIES = 32
CACHE_MAX_CHARS = 6_000_000  # ~17 МБ индекса на 1 млн знаков: не больше ~100 МБ на все индексы

SESSION_EXPIRED_DETAIL = "Сессия истекла. Войдите снова."
READ_FAILED_DETAIL = "Не удалось прочитать лекции. Повторите через минуту."

# Порядковые слова и глаголы задания: в вопросе они есть, о его теме не говорят (сравниваются основами).
_FIT_STOPWORD_FORMS = (
    "первый второй третий четвертый пятый шестой седьмой восьмой девятый десятый "
    "составьте напишите решите постройте выполните найдите вычислите запишите покажите докажите "
    "используйте включите выведите нарисуйте изобразите рассчитайте заполните преобразуйте дополните оцените"
)
FIT_STOPWORDS: frozenset[str] = frozenset(stem(word) for word in _FIT_STOPWORD_FORMS.split())


class FitError(Exception):
    """Отказ до подсчёта: status — HTTP-статус, detail — текст для пользователя."""

    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


# ── Правило ─────────────────────────────────────────────────────────────────────


def question_terms(text: str) -> list[str]:
    """Основы вопроса без слов-инструкций, порядковых слов и глаголов задания, по порядку и без повторов."""
    return list(dict.fromkeys(term for term in terms(text, exam_stopwords=True) if term not in FIT_STOPWORDS))


def coverage_floor(term_count: int) -> float:
    """Нижняя доля веса основ вопроса в фрагменте: 0,5 до 5 основ, −0,05 за каждую следующую, не меньше 0,3."""
    extra = max(0, term_count - SHORT_QUESTION_TERMS)
    return max(COVERAGE_FLOOR_MIN, COVERAGE_FLOOR_SHORT - COVERAGE_FLOOR_STEP * extra)


def fitting_lectures(index: BM25Index, question: str) -> set[str]:
    """Лекции (material_id), которые подходят к вопросу по правилу из докстроки модуля."""
    query = question_terms(question)
    if not query:
        return set()
    floor = coverage_floor(len(query)) - 1e-9
    # Лекция → (оценка лучшего фрагмента, наибольшее покрытие среди её лучших фрагментов).
    lectures = {
        material_id: (docs[0].score, max(doc.idf_share for doc in docs))
        for material_id, docs in index.top_per_material(query, per_material=PASSAGES_PER_LECTURE, skip_plans=True).items()
    }
    covered = {material_id: value for material_id, value in lectures.items() if value[1] >= floor}
    if not covered:
        return set()
    top_score = max(score for score, _ in covered.values())
    near = {material_id: value for material_id, value in covered.items() if value[0] >= SCORE_SHARE * top_score}
    top_share = max(share for _, share in near.values())
    return {material_id for material_id, (_, share) in near.items() if share >= COVERAGE_SHARE * top_share}


# ── Кеш ─────────────────────────────────────────────────────────────────────────


@dataclass
class _Index:
    index: BM25Index
    chars: int
    expires: float
    lock: threading.Lock = field(default_factory=threading.Lock)


@dataclass(frozen=True)
class _Known:
    """Что дало чтение текстов набора лекций: отпечаток, проверенные лекции по порядку, пропуски, знаки."""

    fingerprint: str
    checked: tuple[str, ...]
    skipped: tuple[tuple[str, str], ...]
    chars: int
    expires: float


_indexes: "OrderedDict[tuple[str, str], _Index]" = OrderedDict()
_known: "OrderedDict[tuple[str, tuple[str, ...]], _Known]" = OrderedDict()


def _clock() -> float:
    return time.monotonic()


def reset_cache() -> None:
    """Тестам: забыть все индексы и наборы."""
    _indexes.clear()
    _known.clear()


def _evict(now: float) -> None:
    for key in [key for key, entry in _indexes.items() if entry.expires <= now]:
        del _indexes[key]
    for key in [key for key, entry in _known.items() if entry.expires <= now]:
        del _known[key]
    while _indexes and (len(_indexes) > CACHE_MAX_ENTRIES or sum(entry.chars for entry in _indexes.values()) > CACHE_MAX_CHARS):
        _indexes.popitem(last=False)
    while len(_known) > CACHE_MAX_ENTRIES * 4:
        _known.popitem(last=False)


def _cached_index(user_id: str, fingerprint: str, now: float) -> _Index | None:
    entry = _indexes.get((user_id, fingerprint))
    if entry is None or entry.expires <= now:
        return None
    _indexes.move_to_end((user_id, fingerprint))
    return entry


# ── Чтение (RLS) ────────────────────────────────────────────────────────────────


def _chunks(items: Sequence[str], size: int) -> list[list[str]]:
    return [list(items[start:start + size]) for start in range(0, len(items), size)]


def _created(value: object) -> datetime:
    if isinstance(value, str) and value.strip():
        try:
            moment = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        except ValueError:
            moment = None
        if moment is not None:
            return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)
    return datetime.min.replace(tzinfo=timezone.utc)


async def _lecture_ids(db: SupabaseRest, user_id: str, material_ids: list[str] | None) -> tuple[list[str], list[tuple[str, str]]]:
    """Свои лекции от новых к старым (не больше MAX_LECTURES) и пропуски: missing — не видна, limit — сверх числа."""
    owner = f"eq.{user_id}"
    if material_ids is None:
        rows = await db.select(
            "materials", {"select": "id,created_at", "user_id": owner, "order": "created_at.desc,id.asc", "limit": str(LIST_LIMIT)}
        )
        missing: list[tuple[str, str]] = []
    else:
        rows = []
        for chunk in _chunks(material_ids, IN_FILTER_CHUNK):
            rows.extend(await db.select("materials", {"select": "id,created_at", "user_id": owner, "id": f"in.({','.join(chunk)})"}))
        seen = {str(row.get("id")) for row in rows}
        missing = [(material_id, "missing") for material_id in material_ids if material_id not in seen]
    found: dict[str, datetime] = {}
    for row in rows:
        material_id = row.get("id")
        if isinstance(material_id, str) and material_id and material_id not in found:
            found[material_id] = _created(row.get("created_at"))
    ordered = sorted(found, key=lambda material_id: (-found[material_id].timestamp(), material_id))
    over = [(material_id, "limit") for material_id in ordered[MAX_LECTURES:]]
    return ordered[:MAX_LECTURES], missing + over


async def _read_texts(db: SupabaseRest, user_id: str, ids: list[str]) -> tuple[list[tuple[str, str]], list[tuple[str, str]], int]:
    """Тексты по порядку под потолком MAX_TOTAL_CHARS: (лекции, пропуски, знаков)."""
    lectures: list[tuple[str, str]] = []
    skipped: list[tuple[str, str]] = []
    total = 0
    for chunk in _chunks(ids, TEXT_CHUNK):
        if total >= MAX_TOTAL_CHARS:
            skipped.extend((material_id, "limit") for material_id in chunk)
            continue
        rows = await db.select(
            "materials", {"select": "id,original_text", "user_id": f"eq.{user_id}", "id": f"in.({','.join(chunk)})"}
        )
        by_id = {str(row.get("id")): row for row in rows}
        for material_id in chunk:
            row = by_id.get(material_id)
            text = row.get("original_text") if row is not None else None
            if row is None:
                skipped.append((material_id, "missing"))
            elif not isinstance(text, str) or not text.strip():
                skipped.append((material_id, "no_text"))
            elif total + len(text) > MAX_TOTAL_CHARS:
                skipped.append((material_id, "limit"))
            else:
                lectures.append((material_id, text))
                total += len(text)
    return lectures, skipped, total


def _build_index(lectures: list[tuple[str, str]]) -> BM25Index:
    passages = []
    for material_id, text in lectures:
        passages.extend(material_passages(material_id, "", text))
    return BM25Index(passages)


# ── Ответ ───────────────────────────────────────────────────────────────────────


def _report(index: _Index | None, known: _Known, skipped: Sequence[tuple[str, str]], questions: Sequence[str]) -> dict:
    """Ответ: по вопросам — подходящие лекции, по лекциям — номера вопросов (с нуля, по порядку запроса)."""
    order = {material_id: position for position, material_id in enumerate(known.checked)}
    per_question: list[list[str]] = []
    memo: dict[str, list[str]] = {}
    if index is not None:
        with index.lock:
            for text in questions:
                if text not in memo:
                    memo[text] = sorted(fitting_lectures(index.index, text), key=order.__getitem__)
                per_question.append(memo[text])
    else:
        per_question = [[] for _ in questions]
    by_lecture: dict[str, list[int]] = {material_id: [] for material_id in known.checked}
    for position, ids in enumerate(per_question):
        for material_id in ids:
            by_lecture[material_id].append(position)
    return {
        "questions": [{"lectures": ids} for ids in per_question],
        "lectures": [{"id": material_id, "questions": by_lecture[material_id]} for material_id in known.checked],
        "unmatched": [position for position, ids in enumerate(per_question) if not ids],
        "skipped": [{"id": material_id, "reason": reason} for material_id, reason in [*skipped, *known.skipped]],
        "checked_chars": known.chars,
        "limit_chars": MAX_TOTAL_CHARS,
    }


def _read_error(exc: SupabaseRestError) -> FitError:
    if exc.status == 401:
        return FitError(401, SESSION_EXPIRED_DETAIL)
    return FitError(503, READ_FAILED_DETAIL)


async def lecture_fit(db: SupabaseRest, user_id: str, questions: Sequence[str], material_ids: Iterable[str] | None = None) -> dict:
    """Подсказка для списка вопросов: какие из своих лекций к каким вопросам подходят (без ИИ, без записи)."""
    wanted = None if material_ids is None else list(dict.fromkeys(material_ids))
    try:
        # Каждый вызов: id и даты своих лекций (RLS). Тексты — только для нового набора или устаревшей записи.
        ids, skipped = await _lecture_ids(db, user_id, wanted)
        now = _clock()
        _evict(now)
        key = (user_id, tuple(ids))
        known = _known.get(key)
        index = None
        if known is not None:
            index = _cached_index(user_id, known.fingerprint, now) if known.checked else None
            if known.checked and index is None:
                known = None  # индекс вытеснен: прочитать тексты заново
        if known is None:
            lectures, text_skipped, chars = await _read_texts(db, user_id, ids)
            fingerprint = materials_fingerprint(lectures)
            now = _clock()
            index = _cached_index(user_id, fingerprint, now) if lectures else None
            if index is None and lectures:
                built = await asyncio.to_thread(_build_index, lectures)
                now = _clock()
                index = _Index(index=built, chars=chars, expires=now + CACHE_SECONDS)
                _indexes[(user_id, fingerprint)] = index
            known = _Known(
                fingerprint=fingerprint,
                checked=tuple(material_id for material_id, _ in lectures),
                skipped=tuple(text_skipped),
                chars=chars,
                expires=index.expires if index is not None else now + CACHE_SECONDS,
            )
            _known[key] = known
            _evict(now)
        else:
            _known.move_to_end(key)
    except SupabaseRestError as exc:
        raise _read_error(exc) from None
    return await asyncio.to_thread(_report, index, known, skipped, list(questions))
