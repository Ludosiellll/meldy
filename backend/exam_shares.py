"""«Группа по ссылке»: однокурсник получает свою копию готового экзамена (план 2026-10-07, «Лента B — группа»).

Снимок, а не общий экзамен: копия — строки самого однокурсника (лекции «только текст», экзамен, его лекции
по порядку, вопросы со сверкой, пункты ответа со строками шпаргалки), поэтому шпаргалка, билеты и сверка
работают у него как у автора, без моделей и без единиц лимита. Журнал, ответы и прогресс автора не уходят.
Миграция — supabase/migrations/20261007110403_exam_shares.sql.

Ссылка. Автор ставит галочку согласия (CONSENT_TEXT) и получает код из 12 знаков (Crockford base32 без
i, l, o, u: около 60 бит) — он показывается один раз, в базе только sha256 кода. Ссылку можно сделать, когда
экзамен готов (plan_copy на снимке автора, тот же расчёт, что при входе): сверка не идёт и сверять нечего
(exams_map.select_targets пуст), а у каждого вопроса «есть»/«частично» пункты ответа записаны или дважды не
прошли проверку цитат (строка oral_rubric_failures: иначе 422 rubric_unverifiable навсегда держал бы
to_write > 0). Такие вопросы идут в копию без пунктов: эталон-заглушка {coverage: none, points: [],
unverifiable: {...}} — лист пишет «В лекциях не нашлось пунктов ответа», билет отвечает 422 без модели.
Копию экзамена, полученную по ссылке, дальше не раздают (политика вставки exam_shares и 409 is_copy).
Новую ссылку не дают и экзамену, у которого сверка не нашла в лекциях ни одного вопроса (все «нет»): копия была бы
пустой — 409 nothing_found, решается по тем же строкам вопросов, без миграции. Входу по уже сделанной ссылке это
не мешает. Автору GET отдаёт и счёт coverage {questions, found}: окно предупреждает, когда нашлось меньше половины.

Вход. exam_share_bundle(code) (DEFINER) отдаёт снимок по белому списку; plan_copy выдаёт новые uuid,
переносит id лекций в evidence, nearest, rubric.materials, rubric.nearest и material_ids, пересчитывает
отпечаток (exams_map.materials_fingerprint) и ключ (oral.rubric_key) — формулу в SQL не повторяем:
сортировки Python и Postgres различаются. Затем самопроверка: копия читается так, как её прочтёт сервер
однокурсника (ключ по строкам, как они лягут в базу, после JSON), — у каждого вопроса, которому нужны пункты,
находится годный эталон, to_write = 0, сверять нечего, отпечаток совпадает с лекциями копии, ни одного
старого id. Хоть одно несовпадение — 409 copy_mismatch, ничего не вставляется. Иначе exam_share_join (INVOKER,
токен однокурсника, одна транзакция): место по ссылке, строки копии, место привязано к копии. Повторный вход —
та же копия (bundle отдаёт только её id; гонку двух вкладок решает блокировка строки ссылки в claim).

Маршруты (полные пути, main.py подключает router без префикса):
- POST /api/exam-shares/preview {code} — без входа (main.PUBLIC_API_PATHS): что за ссылка, для /join (код в теле,
  не в адресе: адреса запросов пишет журнал сервера); автору на его ссылке — ещё link: active | revoked | expired
  (своя строка ссылки его токеном);
- GET  /api/exam-shares?exam_id=       — автор: готовность экзамена, его ссылки и coverage {questions, found};
- POST /api/exam-shares                — автор: {exam_id, consent: true} → код один раз;
- POST /api/exam-shares/{id}/revoke    — автор: отозвать (копии остаются у однокурсников);
- POST /api/exam-shares/join           — однокурсник: {code} → {exam_id, joined}.
Ошибки — {"detail": "<по-русски>", "code": …} (+ счётчики), через общий обработчик AIError в main.py.
"""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import re
import secrets
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Iterable

from fastapi import APIRouter, HTTPException, Request

import oral
import oral_api
import oral_sheet
import supabase_rest
from agents.base import AIError
from exams_map import LOCK_STALE_SECONDS, materials_fingerprint, select_targets
from ratelimit import limiter, user_or_ip_key
from retrieval import material_passages
from supabase_rest import SupabaseRest, SupabaseRestError, bearer_token

__all__ = [
    "CODE_ALPHABET",
    "CODE_LENGTH",
    "CONSENT_TEXT",
    "COPY_VERSION",
    "CopyPlan",
    "MAX_MEMBERS",
    "ShareError",
    "Snapshot",
    "code_hash",
    "is_placeholder",
    "load_author_snapshot",
    "new_code",
    "normalize_code",
    "plan_copy",
    "router",
    "snapshot_from_bundle",
]

router = APIRouter()

CODE_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"  # Crockford base32: без i, l, o, u
CODE_LENGTH = 12
MAX_MEMBERS = 80
LINK_DAYS = 90
COPY_VERSION = 1
READ_TIMEOUT_SECONDS = 30.0  # снимок и копия несут тексты лекций — мегабайты
QUESTION_CHARS = 1000
IN_FILTER_CHUNK = 50
WRITABLE_COVERAGE = ("full", "partial")
CONSENT_TEXT = (
    "Делюсь с группой вопросами, текстом моих лекций и пунктами ответа. Мои ответы и прогресс никто не увидит."
)

EXAM_NOT_FOUND_DETAIL = "Экзамен не найден"
SESSION_EXPIRED_DETAIL = "Сессия истекла. Войдите снова."
READ_FAILED_DETAIL = "Не удалось открыть экзамен по ссылке. Попробуйте через минуту."
UNAVAILABLE_DETAIL = "Пригласить группу пока нельзя. Попробуйте позже."
CONSENT_DETAIL = "Отметьте согласие, чтобы создать ссылку."
BAD_BODY_DETAIL = "Неверный формат запроса."
IS_COPY_DETAIL = (
    "Этот экзамен — копия из ссылки группы. Однокурсников приглашает автор экзамена своей ссылкой."
)
LINK_NOT_FOUND_DETAIL = "Ссылка не найдена. Проверьте, что она скопирована целиком."
LINK_REVOKED_DETAIL = "Автор закрыл эту ссылку. Попросите у него новую."
LINK_EXPIRED_DETAIL = "Срок действия ссылки закончился. Попросите у автора новую."
LINK_FULL_DETAIL = f"По этой ссылке уже вошли {MAX_MEMBERS} человек — мест больше нет."
OWN_LINK_DETAIL = "Это ваша ссылка: экзамен уже у вас."
JOIN_NOT_READY_DETAIL = "Автор сейчас обновляет экзамен. Попробуйте зайти по ссылке позже."
COPY_MISMATCH_DETAIL = "Не получилось подготовить копию экзамена. Попробуйте позже — автор может обновить экзамен."
AUTHOR_COPY_MISMATCH_DETAIL = "Не получилось подготовить копию экзамена для группы. Ссылку пока сделать нельзя — попробуйте позже."
SHARE_NOT_FOUND_DETAIL = "Ссылка не найдена."
NOTHING_FOUND_DETAIL = (
    "В лекциях не нашлось ответа ни на один вопрос — однокурсникам будет не с чем заниматься. "
    "Добавьте лекции по этим темам и сверьте заново, потом приглашайте."
)

_CODE_RE = re.compile(r"^[0-9a-hjkmnp-tv-z]{12}$")
_CODE_JUNK_RE = re.compile(r"[\s\-]+")
_UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_HASH_RE = re.compile(r"^[0-9a-f]{32}$")

_EXAM_COLUMNS = (
    "id,title,kind,exam_date,source_kind,source_text,ticket_layout,mapping_state,mapping_started_at,mapped_at,"
    "mapped_material_ids"
)
_QUESTION_COLUMNS = (
    "id,position,label,section,text,question_hash,coverage,coverage_method,coverage_reason,missing_note,evidence,"
    "nearest,materials_fingerprint,mapping_version,mapped_at"
)
_RUBRIC_COLUMNS = "question_hash,source_key,rubric_version,material_id,material_ids,rubric,created_at,sheet"
_FAILURE_COLUMNS = "question_hash,source_key,rubric_version,failed_at"
_SHARE_COLUMNS = "id,created_at,expires_at,revoked_at,max_members,members"

# SQLSTATE функций миграции → (HTTP-статус, code, detail).
_RPC_ERRORS = {
    "28000": (401, "session", SESSION_EXPIRED_DETAIL),
    "MS001": (404, "link_not_found", LINK_NOT_FOUND_DETAIL),
    "MS002": (410, "link_revoked", LINK_REVOKED_DETAIL),
    "MS003": (410, "link_expired", LINK_EXPIRED_DETAIL),
    "MS004": (409, "link_full", LINK_FULL_DETAIL),
    "MS005": (409, "own_link", OWN_LINK_DETAIL),
    "MS006": (409, "copy_mismatch", COPY_MISMATCH_DETAIL),
}
_MISSING_FUNCTION_CODES = frozenset({"PGRST202", "42883", "PGRST205", "42P01"})


class ShareError(AIError):
    """Отказ: {"detail", "code"} и счётчики (extra) — общий обработчик AIError в main.py."""

    def __init__(self, status: int, code: str, detail: str, **extra: Any) -> None:
        super().__init__(status, code, detail)
        self.extra = extra or None


class _Mismatch(Exception):
    """Самопроверка копии не сошлась (что именно — для журнала сервера)."""


# ── Код ─────────────────────────────────────────────────────────────────────────


def new_code() -> str:
    """12 знаков алфавита, среди них есть и цифра, и буква: адрес /join/<код> статистика сайта пишет шаблоном
    /join/:id (frontend lib/telemetry.routePattern оставляет как есть только сегменты из одних букв)."""
    while True:
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
        if any(char.isdigit() for char in code) and any(char.isalpha() for char in code):
            return code


def code_hash(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def normalize_code(raw: Any) -> str | None:
    """Код из адреса или поля: без пробелов и дефисов, строчными; иначе None."""
    if not isinstance(raw, str):
        return None
    value = _CODE_JUNK_RE.sub("", raw).lower()
    return value if _CODE_RE.match(value) else None


# ── Слова ───────────────────────────────────────────────────────────────────────


def _form(count: int, one: str, few: str, many: str) -> str:
    n = abs(int(count)) % 100
    if 11 <= n <= 14:
        return many
    n %= 10
    if n == 1:
        return one
    if 2 <= n <= 4:
        return few
    return many


def _not_ready(reason: str, detail: str, **counts: int) -> ShareError:
    return ShareError(409, "not_ready", detail, reason=reason, **counts)


def _needs_mapping(count: int) -> ShareError:
    word = _form(count, "вопрос", "вопроса", "вопросов")
    state = "ещё не сверен" if _form(count, "1", "2", "5") == "1" else "ещё не сверены"
    return _not_ready("needs_mapping", f"Сначала сверьте список с лекциями: {count} {word} {state}.", questions=count)


def _needs_sheet(count: int) -> ShareError:
    word = _form(count, "вопроса", "вопросов", "вопросов")
    return _not_ready(
        "needs_sheet", f"Сначала допишите шпаргалку: у {count} {word} ещё нет пунктов ответа.", questions=count
    )


def _foreign_lectures(count: int) -> ShareError:
    word = _form(count, "вопросу", "вопросам", "вопросам")
    return _not_ready(
        "foreign_lectures",
        f"В пунктах ответа к {count} {word} есть цитаты из лекций, которых уже нет в экзамене. "
        "Верните эти лекции в экзамен.",
        questions=count,
    )


# ── Снимок ──────────────────────────────────────────────────────────────────────


@dataclass
class Snapshot:
    """Экзамен автора, как его видит лист: ссылки на лекции по порядку, лекции, вопросы, эталоны, отказы."""

    exam: dict
    links: list[str]  # id лекций экзамена по порядку добавления (все, и без текста)
    materials: dict[str, dict]  # id → {id, title, subject, original_text}
    questions: list[dict]
    rubrics: list[dict]  # только из лекций экзамена (тот же отбор, что у exam_share_bundle)
    failures: dict[tuple[str, str, int], str] = field(default_factory=dict)  # (хеш, ключ, версия) → failed_at
    foreign: set[tuple[str, str]] = field(default_factory=set)  # (хеш, ключ) эталонов и из других лекций


def _uuid(value: Any) -> str | None:
    return value.lower() if isinstance(value, str) and _UUID_RE.match(value) else None


def _text(value: Any) -> str:
    return value if isinstance(value, str) else ""


def _int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str) and value.strip().lstrip("-").isdigit():
        return int(value.strip())
    return None


def _clean_question(raw: Any) -> dict | None:
    if not isinstance(raw, dict) or _uuid(raw.get("id")) is None:
        return None
    evidence, nearest = raw.get("evidence"), raw.get("nearest")
    fingerprint = raw.get("materials_fingerprint")
    return {
        "id": _uuid(raw["id"]),
        "position": _int(raw.get("position")) or 1,
        "label": _text(raw.get("label")),
        "section": _int(raw.get("section")),
        "text": _text(raw.get("text")),
        "question_hash": _text(raw.get("question_hash")),
        "coverage": raw.get("coverage") if raw.get("coverage") in ("full", "partial", "none", "unverified") else None,
        "coverage_method": raw.get("coverage_method") if raw.get("coverage_method") in ("llm", "lexical", "manual") else None,
        "coverage_reason": _text(raw.get("coverage_reason")),
        "missing_note": _text(raw.get("missing_note")),
        "evidence": evidence if isinstance(evidence, list) else [],
        "nearest": nearest if isinstance(nearest, list) else [],
        "materials_fingerprint": fingerprint if isinstance(fingerprint, str) and fingerprint else None,
        "mapping_version": _int(raw.get("mapping_version")),
        "mapped_at": raw.get("mapped_at") if isinstance(raw.get("mapped_at"), str) else None,
    }


def _clean_rubric_row(raw: Any) -> dict | None:
    if not isinstance(raw, dict):
        return None
    question_hash, key = raw.get("question_hash"), raw.get("source_key")
    rubric, created_at = raw.get("rubric"), raw.get("created_at")
    if not isinstance(question_hash, str) or not isinstance(key, str) or not isinstance(rubric, dict):
        return None
    if not isinstance(created_at, str) or not created_at:
        return None
    ids = raw.get("material_ids")
    sheet = raw.get("sheet")
    return {
        "question_hash": question_hash,
        "source_key": key,
        "rubric_version": _int(raw.get("rubric_version")) or 1,
        "material_ids": [mid for mid in (_uuid(value) for value in ids) if mid] if isinstance(ids, list) else [],
        "material_id": _uuid(raw.get("material_id")),
        "rubric": rubric,
        "created_at": created_at,
        "sheet": sheet if isinstance(sheet, dict) else None,
    }


def _clean_material(raw: Any) -> dict | None:
    if not isinstance(raw, dict) or _uuid(raw.get("id")) is None:
        return None
    return {
        "id": _uuid(raw["id"]),
        "title": _text(raw.get("title")),
        "subject": _text(raw.get("subject")),
        "original_text": _text(raw.get("original_text")),
    }


def _clean_exam(raw: Any) -> dict:
    exam = raw if isinstance(raw, dict) else {}
    layout = exam.get("ticket_layout")
    mapped = exam.get("mapped_material_ids")
    return {
        "title": _text(exam.get("title")),
        "kind": exam.get("kind") if exam.get("kind") in ("exam", "credit", "colloquium") else "exam",
        "exam_date": exam.get("exam_date") if isinstance(exam.get("exam_date"), str) else None,
        "source_kind": "file" if exam.get("source_kind") == "file" else "paste",
        "source_text": _text(exam.get("source_text")),
        "ticket_layout": layout if isinstance(layout, dict) else {"mode": "random", "per_ticket": 2},
        "mapping_state": _text(exam.get("mapping_state")) or "none",
        "mapping_started_at": exam.get("mapping_started_at") if isinstance(exam.get("mapping_started_at"), str) else None,
        "mapped_at": exam.get("mapped_at") if isinstance(exam.get("mapped_at"), str) else None,
        "mapped_material_ids": [mid for mid in (_uuid(value) for value in mapped) if mid] if isinstance(mapped, list) else [],
    }


def _snapshot(exam: Any, links: Iterable[Any], materials: Iterable[Any], questions: Iterable[Any],
              rubrics: Iterable[Any], failures: Iterable[Any]) -> Snapshot:
    link_ids = list(dict.fromkeys(mid for mid in (_uuid(value) for value in links) if mid))
    by_id = {row["id"]: row for row in (_clean_material(item) for item in materials) if row}
    cleaned_failures: dict[tuple[str, str, int], str] = {}
    for item in failures:
        if isinstance(item, dict) and isinstance(item.get("question_hash"), str) and isinstance(item.get("source_key"), str):
            key = (item["question_hash"], item["source_key"], _int(item.get("rubric_version")) or 1)
            cleaned_failures[key] = _text(item.get("failed_at"))
    return Snapshot(
        exam=_clean_exam(exam),
        links=link_ids,
        materials={mid: row for mid, row in by_id.items() if mid in set(link_ids)},
        questions=[row for row in (_clean_question(item) for item in questions) if row],
        rubrics=[row for row in (_clean_rubric_row(item) for item in rubrics) if row],
        failures=cleaned_failures,
    )


def snapshot_from_bundle(raw: Any) -> Snapshot:
    """Снимок из ответа exam_share_bundle (отбор эталонов уже сделала база)."""
    if not isinstance(raw, dict) or not isinstance(raw.get("exam"), dict):
        raise ShareError(503, "read_failed", READ_FAILED_DETAIL)

    def items(name: str) -> list:
        value = raw.get(name)
        return value if isinstance(value, list) else []

    links = [item.get("material_id") for item in items("links") if isinstance(item, dict)]
    return _snapshot(raw["exam"], links, items("materials"), items("questions"), items("rubrics"), items("failures"))


def _read_error(exc: SupabaseRestError) -> ShareError:
    if exc.status == 401:
        return ShareError(401, "session", SESSION_EXPIRED_DETAIL)
    if exc.status in (400, 403, 404, 406):
        return ShareError(404, "not_found", EXAM_NOT_FOUND_DETAIL)
    return ShareError(503, "read_failed", READ_FAILED_DETAIL)


async def _chunked(db: SupabaseRest, table: str, column: str, values: list[str], params: dict) -> list[dict]:
    rows: list[dict] = []
    for start in range(0, len(values), IN_FILTER_CHUNK):
        chunk = values[start:start + IN_FILTER_CHUNK]
        query = {**params, column: f"in.({','.join(chunk)})", "order": params.get("order", "id.asc")}
        rows.extend(await oral_sheet._select_pages(db, table, query))
    return rows


async def load_author_snapshot(db: SupabaseRest, exam_id: str, user_id: str | None = None) -> Snapshot:
    """Снимок экзамена автора его же токеном (RLS), с тем же отбором эталонов, что у exam_share_bundle."""
    try:
        exam = await db.select_one("exams", {"select": _EXAM_COLUMNS, "id": f"eq.{exam_id}"})
        if exam is None:
            raise ShareError(404, "not_found", EXAM_NOT_FOUND_DETAIL)
        links = await oral_api._exam_material_ids(db, exam_id)
        questions = await oral_sheet._select_pages(
            db,
            "exam_questions",
            {"select": _QUESTION_COLUMNS, "exam_id": f"eq.{exam_id}", "order": "position.asc,created_at.asc,id.asc"},
        )
        materials = await _chunked(db, "materials", "id", links, {"select": "id,title,subject,original_text"})
        hashes = sorted(
            {q["question_hash"] for q in questions if isinstance(q.get("question_hash"), str) and _HASH_RE.match(q["question_hash"])}
        )
        owner = {"user_id": f"eq.{user_id}"} if user_id else {}
        rubrics = await _chunked(db, "oral_rubrics", "question_hash", hashes, {"select": _RUBRIC_COLUMNS, **owner})
    except SupabaseRestError as exc:
        raise _read_error(exc) from None
    try:
        failures = await _chunked(db, "oral_rubric_failures", "question_hash", hashes, {"select": _FAILURE_COLUMNS, **owner})
    except SupabaseRestError as exc:  # таблицы ещё нет (миграция не применена): отказов не знаем
        print(f"Exam share: rubric failures unreadable ({exc.status} {exc.code or ''})".rstrip())
        failures = []
    snapshot = _snapshot(exam, links, materials, questions, [], failures)
    allowed = set(snapshot.links)
    for raw in rubrics:
        row = _clean_rubric_row(raw)
        if row is None:
            continue
        if row["material_id"] in allowed and set(row["material_ids"]) <= allowed:
            snapshot.rubrics.append(row)
        else:
            snapshot.foreign.add((row["question_hash"], row["source_key"]))
    return snapshot


# ── План копии ─────────────────────────────────────────────────────────────────


@dataclass
class CopyPlan:
    """Копия для exam_share_join и её счёт."""

    payload: dict
    exam_id: str
    questions: int
    lectures: int
    rubrics: int
    without_points: int  # вопросы, чьи пункты у автора не прошли проверку цитат


# Эталон-заглушка копии: у автора пункты этого вопроса дважды не прошли проверку цитат (билет — 422 без модели).
is_placeholder = oral_api.shared_without_points


def _parse_moment(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip().replace("Z", "+00:00")
    if " " in text and "T" not in text:
        text = text.replace(" ", "T", 1)
    try:
        moment = datetime.fromisoformat(text)
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def _mapping_running(exam: dict, now: datetime) -> bool:
    if exam.get("mapping_state") != "running":
        return False
    started = _parse_moment(exam.get("mapping_started_at"))
    return started is None or started > now - timedelta(seconds=LOCK_STALE_SECONDS)


def _fragments(texts: list[tuple[str, str, str]]) -> dict[tuple[str, str], str]:
    """Фрагменты лекций, как их режет сверка (exams_map._build_catalog): (id лекции, S-id) → текст."""
    fragments: dict[tuple[str, str], str] = {}
    for material_id, title, text in texts:
        for passage in material_passages(material_id, title, text):
            fragments[(passage.material_id, passage.source_id)] = passage.text
    return fragments


def _question_text(question: dict) -> str:
    """Текст вопроса, как его хранит эталон (oral_api.RubricJob.question_text)."""
    return " ".join(_text(question.get("text")).split())[:QUESTION_CHARS]


def _needs_points(question: dict) -> bool:
    """Вопрос, который лист считает в to_write, пока у него нет годного эталона (oral_sheet._sheet_response)."""
    return question.get("coverage") in WRITABLE_COVERAGE and bool(_HASH_RE.match(_text(question.get("question_hash"))))


def _translate(value: Any, ids: dict[str, str]) -> Any:
    """Копия JSON, где каждый material_id (и каждый id в material_ids) заменён новым id лекции.

    id, которого нет среди лекций копии, — _Mismatch: старый id не должен попасть в копию.
    """
    if isinstance(value, list):
        return [_translate(item, ids) for item in value]
    if not isinstance(value, dict):
        return copy.deepcopy(value)
    result: dict = {}
    for key, item in value.items():
        if key == "material_id" and isinstance(item, str) and item:
            new = ids.get(item.lower())
            if new is None:
                raise _Mismatch(f"untranslatable material_id in {key}")
            result[key] = new
        elif key == "material_ids" and isinstance(item, list):
            translated = []
            for mid in item:
                new = ids.get(mid.lower()) if isinstance(mid, str) else None
                if new is None:
                    raise _Mismatch("untranslatable id in material_ids")
                translated.append(new)
            result[key] = translated
        else:
            result[key] = _translate(item, ids)
    return result


def _translate_layout(layout: dict, question_ids: dict[str, str]) -> dict:
    """Раскладка билетов копии: id вопросов закреплённых билетов — новые; вопросы, которых нет, выпадают."""
    result = copy.deepcopy(layout) if isinstance(layout, dict) else {"mode": "random", "per_ticket": 2}
    tickets = result.get("tickets")
    if isinstance(tickets, list):
        cleaned = []
        for ticket in tickets:
            if not isinstance(ticket, dict):
                continue
            ticket = dict(ticket)
            raw_ids = ticket.get("question_ids")
            ticket["question_ids"] = [
                question_ids[qid.lower()] for qid in (raw_ids if isinstance(raw_ids, list) else [])
                if isinstance(qid, str) and qid.lower() in question_ids
            ]
            cleaned.append(ticket)
        result["tickets"] = cleaned
    return result


def _placeholder(question: dict, materials: list[dict], failed_at: str) -> dict:
    return {
        "v": 1,
        "question": _question_text(question),
        "coverage": "none",
        "coverage_note": "",
        "fragments_considered": 0,
        "fragments_total": 0,
        "materials": materials,
        "points": [],
        "nearest": [],
        "unverifiable": {"at": failed_at or None, "shared": True},
    }


def plan_copy(snapshot: Snapshot, *, new_id: Callable[[], str] | None = None, now: datetime | None = None) -> CopyPlan:
    """Копия экзамена из снимка автора: готовность (ShareError 409 not_ready), перенос id и самопроверка
    (ShareError 409 copy_mismatch). Только расчёт: ничего не читает и не пишет."""
    make_id = new_id or (lambda: str(uuid.uuid4()))
    moment = now or datetime.now(timezone.utc)
    exam = snapshot.exam
    questions = snapshot.questions
    if not exam.get("title"):
        raise ShareError(404, "not_found", EXAM_NOT_FOUND_DETAIL)
    if not questions:
        raise _not_ready("no_questions", "В экзамене нет вопросов.")
    if _mapping_running(exam, moment):
        raise _not_ready("mapping_running", "Сейчас идёт сверка с лекциями. Пригласить группу можно, когда она закончится.")

    texts = [
        (mid, snapshot.materials[mid]["title"], snapshot.materials[mid]["original_text"])
        for mid in snapshot.links
        if mid in snapshot.materials and snapshot.materials[mid]["original_text"].strip()
    ]
    if not texts:
        raise _not_ready("no_lectures", "К экзамену не добавлены лекции с текстом.")
    text_ids = {mid for mid, _, _ in texts}
    fingerprint = materials_fingerprint((mid, text) for mid, _, text in texts)
    fragments = _fragments(texts)
    targets = select_targets(questions, fingerprint, text_ids, None, False, fragments)
    if targets:
        raise _needs_mapping(len(targets))

    # Эталон каждого вопроса — по ключу листа автора (oral_sheet._load_state).
    by_key: dict[tuple[str, str], dict] = {}
    for row in snapshot.rubrics:
        if row["rubric_version"] == oral_api.RUBRIC_VERSION:
            by_key.setdefault((row["question_hash"], row["source_key"]), row)
    sources: dict[str, tuple[str, dict | None, str]] = {}  # id вопроса → ("rubric" | "failed", строка, failed_at)
    missing = foreign = 0
    for question in questions:
        if not _needs_points(question):
            continue
        key = oral.rubric_key(question, snapshot.links)
        row = by_key.get((question["question_hash"], key))
        if row is not None and oral_api._usable_rubric(row["rubric"]):
            sources[question["id"]] = ("rubric", row, "")
        elif (question["question_hash"], key, oral_api.RUBRIC_VERSION) in snapshot.failures:
            sources[question["id"]] = ("failed", None, snapshot.failures[(question["question_hash"], key, oral_api.RUBRIC_VERSION)])
        elif (question["question_hash"], key) in snapshot.foreign:
            foreign += 1
        else:
            missing += 1
    if missing:
        raise _needs_sheet(missing)
    if foreign:
        raise _foreign_lectures(foreign)

    try:
        plan = _build_copy(snapshot, texts, sources, make_id)
        _verify(plan, snapshot, texts, fragments, sources)
    except _Mismatch as exc:
        print(f"Exam share copy mismatch: {exc}")
        raise ShareError(409, "copy_mismatch", COPY_MISMATCH_DETAIL) from None
    return plan


def _build_copy(
    snapshot: Snapshot,
    texts: list[tuple[str, str, str]],
    sources: dict[str, tuple[str, dict | None, str]],
    make_id: Callable[[], str],
) -> CopyPlan:
    """Строки копии с новыми id. Отпечаток лекций копии считается заново по её id (не переносится)."""
    exam = snapshot.exam
    material_ids = {mid: make_id() for mid, _, _ in texts}
    links = [material_ids[mid] for mid, _, _ in texts]
    member_fingerprint = materials_fingerprint((material_ids[mid], text) for mid, _, text in texts)
    question_ids = {question["id"]: make_id() for question in snapshot.questions}

    copied_questions: list[dict] = []
    for question in snapshot.questions:
        copied_questions.append(
            {
                "id": question_ids[question["id"]],
                "position": question["position"],
                "label": question["label"],
                "section": question["section"],
                "text": question["text"],
                "coverage": question["coverage"],
                "coverage_method": question["coverage_method"],
                "coverage_reason": question["coverage_reason"],
                "missing_note": question["missing_note"],
                "evidence": _translate(question["evidence"], material_ids),
                "nearest": _translate(question["nearest"], material_ids),
                # Сверка копии — по её лекциям: отпечаток пересчитан с новыми id (без отпечатка — ключ по id лекций).
                "materials_fingerprint": member_fingerprint if question["materials_fingerprint"] else None,
                "mapping_version": question["mapping_version"],
                "mapped_at": question["mapped_at"],
            }
        )

    rubrics: dict[tuple[str, str], dict] = {}
    without_points = 0
    for question, copied in zip(snapshot.questions, copied_questions):
        source = sources.get(question["id"])
        if source is None:
            continue
        kind, row, failed_at = source
        key = oral.rubric_key(copied, links)
        slot = (question["question_hash"], key)
        if kind == "failed":
            without_points += 1
            evidence_ids = [item.get("material_id") for item in copied["evidence"] if isinstance(item, dict)]
            first = next((mid for mid in evidence_ids if mid in links), links[0])
            candidate = {
                "material_id": first,
                "material_ids": [first],
                "rubric": _placeholder(question, [], failed_at),
                "rubric_version": oral_api.RUBRIC_VERSION,
                "created_at": None,
                "sheet": None,
            }
        else:
            assert row is not None
            translated_ids = _translate({"material_ids": row["material_ids"]}, material_ids)["material_ids"]
            rubric = _translate(row["rubric"], material_ids)
            first = translated_ids[0] if translated_ids else None
            if first is None:
                named = [item.get("material_id") for item in rubric.get("materials", []) if isinstance(item, dict)]
                first = next((mid for mid in named if mid), None)
            if first is None:
                raise _Mismatch("an answer key without lectures")
            candidate = {
                "material_id": first,
                "material_ids": translated_ids or [first],
                "rubric": rubric,
                "rubric_version": row["rubric_version"],
                "created_at": row["created_at"],
                "sheet": copy.deepcopy(row["sheet"]),
            }
        current = rubrics.get(slot)
        # Два эталона автора, которые в копии получили один ключ, — остаётся более новый (уникальность строки).
        if current is None or (_parse_moment(candidate["created_at"]) or datetime.min.replace(tzinfo=timezone.utc)) > (
            _parse_moment(current["created_at"]) or datetime.min.replace(tzinfo=timezone.utc)
        ):
            rubrics[slot] = {"slot": slot, "question": _question_text(question), **candidate}

    rubric_rows = [
        {
            "id": make_id(),
            "question_hash": slot[0],
            "source_key": slot[1],
            "material_id": item["material_id"],
            "material_ids": item["material_ids"],
            "question": item["question"],
            "rubric": item["rubric"],
            "rubric_version": item["rubric_version"],
            "created_at": item["created_at"],
            "sheet": item["sheet"],
        }
        for slot, item in rubrics.items()
    ]

    mapped = [_parse_moment(question["mapped_at"]) for question in snapshot.questions]
    oldest = min(
        ((moment, question["mapped_at"]) for moment, question in zip(mapped, snapshot.questions) if moment is not None),
        default=None,
    )
    exam_id = make_id()
    payload = {
        "v": COPY_VERSION,
        "exam": {
            "id": exam_id,
            "title": exam["title"],
            "kind": exam["kind"],
            "exam_date": exam["exam_date"],
            "source_kind": exam["source_kind"],
            "source_text": exam["source_text"],
            "ticket_layout": _translate_layout(exam["ticket_layout"], question_ids),
            # Сверено всё (select_targets пуст): как после законченного запуска (exams_map._finalize).
            "mapping_state": "done",
            "mapped_at": oldest[1] if oldest else exam["mapped_at"],
            "mapped_material_ids": links,
        },
        "materials": [
            {"id": material_ids[mid], "title": title, "subject": snapshot.materials[mid]["subject"], "original_text": text}
            for mid, title, text in texts
        ],
        "links": [{"material_id": mid} for mid in links],
        "questions": copied_questions,
        "rubrics": rubric_rows,
    }
    return CopyPlan(
        payload=payload,
        exam_id=exam_id,
        questions=len(copied_questions),
        lectures=len(links),
        rubrics=len(rubric_rows),
        without_points=without_points,
    )


def _verify(
    plan: CopyPlan,
    snapshot: Snapshot,
    texts: list[tuple[str, str, str]],
    fragments: dict[tuple[str, str], str],
    sources: dict[str, tuple[str, dict | None, str]],
) -> None:
    """Самопроверка: копия, прочитанная так, как её прочтёт сервер однокурсника, совпадает с листом автора."""
    serialized = json.dumps(plan.payload, ensure_ascii=False)
    payload = json.loads(serialized)  # как строки придут из базы: только JSON

    # Ни одного старого id: ни лекции, ни вопроса.
    for old in [*snapshot.links, *(question["id"] for question in snapshot.questions)]:
        if old in serialized:
            raise _Mismatch("an id of the author is left in the copy")

    materials = payload["materials"]
    links = [item["material_id"] for item in payload["links"]]
    if links != [item["id"] for item in materials] or len(set(links)) != len(links):
        raise _Mismatch("lectures and their order differ")
    own = set(links)
    # Отпечаток — заново, по лекциям копии, как его посчитает сверка однокурсника.
    fingerprint = materials_fingerprint((item["id"], item["original_text"]) for item in materials if item["original_text"].strip())
    if len(materials) != len(texts):
        raise _Mismatch("lecture count differs")
    renamed = dict(zip((mid for mid, _, _ in texts), links))
    member_fragments = {(renamed[mid], sid): text for (mid, sid), text in fragments.items() if mid in renamed}

    questions = payload["questions"]
    if len(questions) != len(snapshot.questions):
        raise _Mismatch("question count differs")
    rows: dict[tuple[str, str], dict] = {}
    for row in payload["rubrics"]:
        slot = (row["question_hash"], row["source_key"])
        if slot in rows:
            raise _Mismatch("two answer keys with one key")
        if row["material_id"] not in own or not set(row["material_ids"]) <= own:
            raise _Mismatch("an answer key of a lecture outside the copy")
        rows[slot] = row

    to_write = 0
    for author, member in zip(snapshot.questions, questions):
        if member["text"] != author["text"]:
            raise _Mismatch("question text differs")
        if member["materials_fingerprint"] not in (None, fingerprint):
            raise _Mismatch("fingerprint differs")
        if not _needs_points(author):
            continue
        # Ключ — тем же путём, что у листа и билета однокурсника (oral_sheet._load_state, oral_api.oral_rubric).
        key = oral.rubric_key({**member, "question_hash": author["question_hash"]}, links)
        row = rows.get((author["question_hash"], key))
        if row is None or not oral_api._usable_rubric(row["rubric"]):
            to_write += 1
            continue
        kind, source, _ = sources[author["id"]]
        if kind == "failed":
            if not is_placeholder(row["rubric"]):
                raise _Mismatch("an unverifiable question got points")
            continue
        assert source is not None
        if row["rubric"].get("points") != source["rubric"].get("points"):
            raise _Mismatch("answer points differ")
        if row["created_at"] != source["created_at"] or row["sheet"] != source["sheet"]:
            raise _Mismatch("the sheet lines would not be served")
        served = oral_sheet._sheet_state(row["sheet"], row["created_at"])
        if served != oral_sheet._sheet_state(source["sheet"], source["created_at"]):
            raise _Mismatch("the sheet lines would not be served")
    if to_write:
        raise _Mismatch(f"{to_write} question(s) would need points written")

    member_questions = [
        {**member, "question_hash": author["question_hash"]} for author, member in zip(snapshot.questions, questions)
    ]
    if select_targets(member_questions, fingerprint, own, None, False, member_fragments):
        raise _Mismatch("the copy would need mapping")
    layout = payload["exam"]["ticket_layout"]
    known = {question["id"] for question in questions}
    for ticket in layout.get("tickets") or []:
        if not set(ticket.get("question_ids") or []) <= known:
            raise _Mismatch("a ticket points at a question outside the copy")


# ── Маршруты ────────────────────────────────────────────────────────────────────


def _rpc_error(exc: SupabaseRestError) -> ShareError:
    known = _RPC_ERRORS.get(exc.code or "")
    if known is not None:
        status, code, detail = known
        return ShareError(status, code, detail)
    if exc.status == 401:
        return ShareError(401, "session", SESSION_EXPIRED_DETAIL)
    if (exc.code or "") in _MISSING_FUNCTION_CODES:
        print("Exam share: the exam_shares migration is not applied")
        return ShareError(503, "unavailable", UNAVAILABLE_DETAIL)
    return ShareError(503, "read_failed", READ_FAILED_DETAIL)


def _exam_id(value: Any) -> str:
    exam_id = _uuid(value.strip() if isinstance(value, str) else value)
    if exam_id is None:
        raise ShareError(404, "not_found", EXAM_NOT_FOUND_DETAIL)
    return exam_id


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _public_share(row: dict, now: datetime) -> dict:
    expires = _parse_moment(row.get("expires_at"))
    state = "revoked" if row.get("revoked_at") else ("expired" if expires is not None and expires <= now else "active")
    return {
        "id": str(row.get("id") or ""),
        "created_at": row.get("created_at"),
        "expires_at": row.get("expires_at"),
        "revoked_at": row.get("revoked_at"),
        "max_members": _int(row.get("max_members")) or MAX_MEMBERS,
        "members": _int(row.get("members")) or 0,
        "state": state,
    }


async def _is_copy(db: SupabaseRest, exam_id: str) -> bool:
    """Экзамен — копия из ссылки группы (своё членство с этой копией; RLS: только свои строки)."""
    try:
        rows = await db.select("exam_share_members", {"select": "id", "member_exam_id": f"eq.{exam_id}", "limit": "1"})
    except SupabaseRestError as exc:
        if exc.status == 401:
            raise ShareError(401, "session", SESSION_EXPIRED_DETAIL) from None
        return False
    return bool(rows)


async def _shares(db: SupabaseRest, exam_id: str) -> list[dict]:
    try:
        rows = await db.select(
            "exam_shares", {"select": _SHARE_COLUMNS, "exam_id": f"eq.{exam_id}", "order": "created_at.desc", "limit": "20"}
        )
    except SupabaseRestError as exc:
        if exc.status == 401:
            raise ShareError(401, "session", SESSION_EXPIRED_DETAIL) from None
        if (exc.code or "") in _MISSING_FUNCTION_CODES or exc.status == 404:
            return []
        raise ShareError(503, "read_failed", READ_FAILED_DETAIL) from None
    now = _now()
    return [_public_share(row, now) for row in rows if isinstance(row, dict)]


def _readiness(error: ShareError) -> dict:
    return {"code": error.code, "detail": error.detail, **(error.extra or {})}


def _for_author(error: ShareError) -> ShareError:
    """Отказ расчёта копии словами для автора (те же коды; «попробуйте позже, автор обновит» — для однокурсника)."""
    if error.code == "copy_mismatch":
        return ShareError(409, "copy_mismatch", AUTHOR_COPY_MISMATCH_DETAIL)
    return error


def _coverage(snapshot: Snapshot) -> dict:
    """Сколько вопросов сверка нашла в лекциях («есть» или «частично») из всех вопросов экзамена."""
    found = sum(1 for question in snapshot.questions if question.get("coverage") in WRITABLE_COVERAGE)
    return {"questions": len(snapshot.questions), "found": found}


async def _author_plan(snapshot: Snapshot) -> None:
    """Готовность для новой ссылки: расчёт копии (тот же, что при входе), затем — нашла ли сверка хоть что-то.

    Ни одного «есть» или «частично» у сверенного экзамена — копия однокурсника была бы пустой: 409 nothing_found
    (после расчёта, чтобы несверенный экзамен по-прежнему слышал «сначала сверьте»). Вход по ссылке этим не
    проверяется: однокурсник по старой ссылке получает копию, как раньше."""
    try:
        await asyncio.to_thread(plan_copy, snapshot)
    except ShareError as exc:
        raise _for_author(exc) from None
    coverage = _coverage(snapshot)
    if coverage["questions"] and not coverage["found"]:
        raise ShareError(409, "nothing_found", NOTHING_FOUND_DETAIL, **coverage)


@router.get("/api/exam-shares")
@limiter.limit("30/minute", key_func=user_or_ip_key)
async def share_state(request: Request):
    """Автор: готов ли экзамен для группы (тот же расчёт, что при входе) и его ссылки."""
    exam_id = _exam_id(request.query_params.get("exam_id"))
    token = bearer_token(request)
    async with SupabaseRest(token, timeout=READ_TIMEOUT_SECONDS) as db:
        copied = await _is_copy(db, exam_id)
        reason: dict | None = None
        coverage: dict | None = None
        if copied:
            try:
                exam = await db.select_one("exams", {"select": "id", "id": f"eq.{exam_id}"})
            except SupabaseRestError as exc:
                raise _read_error(exc) from None
            if exam is None:
                raise ShareError(404, "not_found", EXAM_NOT_FOUND_DETAIL)
            reason = {"code": "is_copy", "detail": IS_COPY_DETAIL}
        else:
            snapshot = await load_author_snapshot(db, exam_id, oral_api._user_id(request))
            coverage = _coverage(snapshot)
            try:
                await _author_plan(snapshot)
            except ShareError as exc:
                if exc.status_code == 404:
                    raise
                reason = _readiness(exc)
        shares = await _shares(db, exam_id)
    return {
        "exam_id": exam_id,
        "ready": reason is None,
        "copy": copied,
        "reason": reason,
        "consent": CONSENT_TEXT,
        "max_members": MAX_MEMBERS,
        "shares": shares,
        "coverage": coverage,
    }


@router.post("/api/exam-shares")
@limiter.limit("10/minute", key_func=user_or_ip_key)
async def create_share(request: Request):
    """Автор: новая ссылка экзамена после согласия. Код — один раз, в базе только его sha256."""
    body = await oral_api._read_json(request)
    exam_id = _exam_id(body.get("exam_id"))
    if body.get("consent") is not True:
        raise ShareError(400, "consent", CONSENT_DETAIL)
    token = bearer_token(request)
    user_id = oral_api._user_id(request)
    async with SupabaseRest(token, timeout=READ_TIMEOUT_SECONDS) as db:
        if await _is_copy(db, exam_id):
            raise ShareError(409, "is_copy", IS_COPY_DETAIL)
        snapshot = await load_author_snapshot(db, exam_id, user_id)
        await _author_plan(snapshot)
        now = _now()
        for _attempt in range(2):
            code = new_code()
            values = {
                "exam_id": exam_id,
                "code_hash": code_hash(code),
                "consent": CONSENT_TEXT,
                "max_members": MAX_MEMBERS,
                "expires_at": _iso(now + timedelta(days=LINK_DAYS)),
            }
            if user_id:
                values["owner_id"] = user_id
            try:
                rows = await db.insert("exam_shares", values)
            except SupabaseRestError as exc:
                if exc.code == "23505":  # тот же хеш кода — новый код
                    continue
                if exc.status == 401:
                    raise ShareError(401, "session", SESSION_EXPIRED_DETAIL) from None
                if exc.status == 403 or exc.code == "42501":  # политика: не свой экзамен или копия из ссылки
                    raise ShareError(404, "not_found", EXAM_NOT_FOUND_DETAIL) from None
                if (exc.code or "") in _MISSING_FUNCTION_CODES or exc.status == 404:
                    raise ShareError(503, "unavailable", UNAVAILABLE_DETAIL) from None
                raise ShareError(503, "save_failed", "Не удалось создать ссылку. Попробуйте через минуту.") from None
            row = rows[0] if rows and isinstance(rows[0], dict) else {**values, "id": "", "created_at": _iso(now), "members": 0}
            return {"share": _public_share(row, now), "code": code, "path": f"/join/{code}"}
    raise ShareError(503, "save_failed", "Не удалось создать ссылку. Попробуйте через минуту.")


@router.post("/api/exam-shares/{share_id}/revoke")
@limiter.limit("20/minute", key_func=user_or_ip_key)
async def revoke_share(share_id: str, request: Request):
    """Автор закрывает ссылку: по ней больше не войти, копии остаются у однокурсников."""
    share = _uuid(share_id)
    if share is None:
        raise ShareError(404, "link_not_found", SHARE_NOT_FOUND_DETAIL)
    token = bearer_token(request)
    async with SupabaseRest(token) as db:
        try:
            result = await db.rpc("exam_share_revoke", {"p_share_id": share})
        except SupabaseRestError as exc:
            error = _rpc_error(exc)
            if error.code == "link_not_found":
                raise ShareError(404, "link_not_found", SHARE_NOT_FOUND_DETAIL) from None
            raise error from None
    revoked = result.get("revoked_at") if isinstance(result, dict) else None
    return {"id": share, "revoked_at": revoked}


@router.post("/api/exam-shares/preview")
@limiter.limit("120/minute", key_func=user_or_ip_key)  # без входа — по IP: группа за одним NAT открывает разом
async def preview_share(request: Request):
    """Страница приглашения без входа: состояние ссылки и, у живой, название, вид, дата и два счёта.

    POST с кодом в теле, а не в адресе: строка запроса попадает в журналы сервера, тело — нет."""
    try:
        body = await oral_api._read_json(request, limit=1024)
    except HTTPException:
        return {"status": "not_found"}
    code = normalize_code(body.get("code"))
    if code is None:
        return {"status": "not_found"}
    authorization = request.headers.get("Authorization", "")
    token = authorization[7:].strip() if authorization.lower().startswith("bearer ") else ""
    attempts = [token, supabase_rest._api_key()] if token else [supabase_rest._api_key()]
    result: Any = None
    for attempt, bearer in enumerate(attempts):
        try:
            async with SupabaseRest(bearer) as db:
                result = await db.rpc("exam_share_preview", {"p_code": code})
            break
        except SupabaseRestError as exc:
            if exc.status == 401 and attempt + 1 < len(attempts):
                continue  # истёкший токен страницы: как без входа
            raise _rpc_error(exc) from None
    if not isinstance(result, dict):
        return {"status": "not_found"}
    known = ("active", "own", "joined", "revoked", "expired", "full")
    status = result.get("status") if result.get("status") in known else "not_found"
    answer: dict[str, Any] = {"status": status}
    if status in ("active", "own", "joined"):
        answer.update(
            {
                "title": _text(result.get("title"))[:200],
                "kind": result.get("kind") if result.get("kind") in ("exam", "credit", "colloquium") else "exam",
                "exam_date": result.get("exam_date") if isinstance(result.get("exam_date"), str) else None,
            }
        )
        if status != "joined":
            answer["questions"] = _int(result.get("questions")) or 0
            answer["lectures"] = _int(result.get("lectures")) or 0
        if status in ("own", "joined") and _uuid(result.get("exam_id")):
            answer["exam_id"] = _uuid(result.get("exam_id"))
    if status == "own" and token:
        state = await _own_link_state(token, code)
        if state is not None:
            answer["link"] = state
    return answer


async def _own_link_state(token: str, code: str) -> str | None:
    """Ссылка автора на его же странице приглашения: active | revoked | expired; None — строку не прочитать.

    exam_share_preview отвечает «own» раньше, чем смотрит на отзыв и срок, поэтому автор на своей закрытой ссылке
    читал «Однокурсники, которые по ней войдут…». Свою строку ссылки автор читает своим токеном (RLS «read own»):
    миграция не нужна."""
    try:
        async with SupabaseRest(token) as db:
            row = await db.select_one("exam_shares", {"select": "id,revoked_at,expires_at", "code_hash": f"eq.{code_hash(code)}"})
    except SupabaseRestError as exc:
        print(f"Exam share: own link unreadable ({exc.status} {exc.code or ''})".rstrip())
        return None
    if not isinstance(row, dict):
        return None
    return _public_share(row, _now())["state"]


@router.post("/api/exam-shares/join")
@limiter.limit("10/minute", key_func=user_or_ip_key)
async def join_share(request: Request):
    """Однокурсник входит по коду: своя копия экзамена (повторный вход — та же копия)."""
    body = await oral_api._read_json(request)
    code = normalize_code(body.get("code"))
    if code is None:
        raise ShareError(404, "link_not_found", LINK_NOT_FOUND_DETAIL)
    token = bearer_token(request)
    async with SupabaseRest(token, timeout=READ_TIMEOUT_SECONDS) as db:
        try:
            raw = await db.rpc("exam_share_bundle", {"p_code": code})
        except SupabaseRestError as exc:
            raise _rpc_error(exc) from None
        joined = raw.get("joined") if isinstance(raw, dict) else None
        if isinstance(joined, dict) and _uuid(joined.get("exam_id")):
            return {"exam_id": _uuid(joined["exam_id"]), "joined": False}
        snapshot = snapshot_from_bundle(raw)
        try:
            plan = await asyncio.to_thread(plan_copy, snapshot)
        except ShareError as exc:
            if exc.code == "not_ready":
                # Ссылку сделали, когда экзамен был готов; сейчас автор его меняет (новые вопросы, сверка).
                raise ShareError(409, "share_not_ready", JOIN_NOT_READY_DETAIL) from None
            raise
        try:
            result = await db.rpc("exam_share_join", {"p_code": code, "p_copy": plan.payload})
        except SupabaseRestError as exc:
            raise _rpc_error(exc) from None
    exam_id = _uuid(result.get("exam_id")) if isinstance(result, dict) else None
    if exam_id is None:
        raise ShareError(503, "read_failed", READ_FAILED_DETAIL)
    fresh = bool(result.get("joined"))
    answer: dict[str, Any] = {"exam_id": exam_id, "joined": fresh}
    if fresh:
        answer.update({"questions": plan.questions, "lectures": plan.lectures, "without_points": plan.without_points})
    return answer
