"""Экзамен на всю сессию по ссылке группы: устные предметы приходят участнику копиями через устный путь (пакет C).

POST /api/containers/{container_id}/oral-sync (полный путь — через prefix роутера; main.py его подключает).
Участник группы получает свои копии устных предметов экзамена тем же путём, что и при входе по ссылке /join:
функции exam_shares.py импортируются, сам файл не меняется. Запросы идут токеном участника (RLS и проверки функций
базы), сервисного ключа у сервера нет и не нужно. Миграция — supabase/migrations/20261009093500_containers.sql.

Для каждого предмета из container_oral_codes (предметы с устной частью, у которых участник ещё без копии, и код
производной ссылки exam_shares для каждого):
- у участника уже есть копия этого экзамена (existing_exam_id, например со старого /join) — container_bind_copy,
  «bound»;
- иначе exam_share_bundle → snapshot_from_bundle → plan_copy → exam_share_join → container_bind_copy — «copied».
  Если bundle отдаёт уже сделанную копию или join отвечает joined: false (копию сделал другой вызов) — та же
  копия, «bound»;
- устная часть автора не готова (plan_copy: not_ready) — «not_ready»: exam_share_join не вызывается, место по
  ссылке не занимается;
- MS002 / MS003 (производная ссылка закрыта или истекла) — «closed»;
- всё остальное — «failed». В журнале сервера — шаг, HTTP-статус и код ошибки, без токена, кода ссылки и данных;
  неожиданное исключение ещё уходит в статистику как server_error (telemetry_api.report_server_error).

Устные предметы без копии участника, которых container_oral_codes не назвала, тоже «closed». Это бывает, когда
у экзамена нет открытой ссылки с согласием (status closed, пустой список) или автор закрыл производную ссылку
предмета в «Пригласить группу». Такие предметы видно по строкам, которые участник читает сам (container_subjects,
свои container_member_exams), и страница экзамена показывает их закрытыми, а не «появятся позже».

Повторный вызов ничего нового не делает: привязанные предметы container_oral_codes не возвращает. Вызовы одного
участника для одного экзамена идут по очереди (замок в процессе). В базе копию по одной ссылке дважды тоже не
сделать: exam_share_claim держит строку ссылки, и повторный join отдаёт ту же копию.

Ответ — OralSyncResponse (frontend/src/types/container.ts, пример — contracts/container/oral_sync.json):
{"container_id", "oral": [{"subject_id", "status", "exam_id"?}]}, предметы по порядку экзамена; exam_id — у
copied и bound. Ошибки — {"detail": "<по-русски>", "code"}: 401 session, 404 not_found (не участник или экзамена
нет), 403 forbidden, 503 unavailable | read_failed. Без входа — 401 от общего middleware main.py. Лимит — 6 вызовов
в минуту на пользователя: клиент зовёт маршрут после входа и когда страница находит предмет без копии.
Спецификация — meldy-notes 10_Project/Exam_Container_Spec_2026-10-09.md §9, решение 24; Concept_3_Architecture.md
§4.2 и §6.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import re
import uuid
from typing import Any, AsyncIterator

from fastapi import APIRouter, Request

import telemetry_api
from exam_shares import (
    EXAM_NOT_FOUND_DETAIL,
    READ_TIMEOUT_SECONDS,
    SESSION_EXPIRED_DETAIL,
    ShareError,
    _rpc_error,
    normalize_code,
    plan_copy,
    snapshot_from_bundle,
)
from ratelimit import limiter, user_or_ip_key
from supabase_rest import SupabaseRest, SupabaseRestError, bearer_token

__all__ = ["BOUND", "CLOSED", "COPIED", "FAILED", "NOT_READY", "router"]

router = APIRouter(prefix="/api/containers")

COPIED = "copied"
BOUND = "bound"
NOT_READY = "not_ready"
CLOSED = "closed"
FAILED = "failed"

FORBIDDEN_DETAIL = "Нет доступа к этому экзамену."
READ_FAILED_DETAIL = "Не удалось открыть устные вопросы экзамена. Попробуйте через минуту."
UNAVAILABLE_DETAIL = "Устные вопросы экзамена пока недоступны. Попробуйте позже."

_UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_MISSING_FUNCTION_CODES = frozenset({"PGRST202", "42883"})
# Отказы устного пути после exam_shares._rpc_error: MS002 — ссылка закрыта, MS003 — истекла.
_CLOSED_CODES = frozenset({"link_revoked", "link_expired"})


def _uuid(value: Any) -> str | None:
    return value.lower() if isinstance(value, str) and _UUID_RE.match(value) else None


def _result(subject_id: str, status: str, exam_id: str | None = None) -> dict:
    row: dict[str, Any] = {"subject_id": subject_id, "status": status}
    if exam_id is not None:
        row["exam_id"] = exam_id
    return row


def _note(step: str, exc: SupabaseRestError) -> None:
    """Строка журнала об отказе базы: шаг, HTTP-статус и код. Без токена, кода ссылки, id и данных."""
    codes = f"{exc.status} {exc.code}" if exc.code else str(exc.status)
    print(f"Container oral sync: {step} failed ({codes})")


def _container_error(exc: SupabaseRestError) -> ShareError:
    """Отказ функции экзамена (SQLSTATE в коде ответа PostgREST) — словами для участника."""
    code = exc.code or ""
    if code == "28000" or exc.status == 401:
        return ShareError(401, "session", SESSION_EXPIRED_DETAIL)
    if code == "P0002":  # не участник (автор, чужой, вышедший или убранный) или экзамена нет
        return ShareError(404, "not_found", EXAM_NOT_FOUND_DETAIL)
    if code == "42501" or exc.status == 403:
        return ShareError(403, "forbidden", FORBIDDEN_DETAIL)
    if code in _MISSING_FUNCTION_CODES:
        print("Container oral sync: the containers migration is not applied")
        return ShareError(503, "unavailable", UNAVAILABLE_DETAIL)
    return ShareError(503, "read_failed", READ_FAILED_DETAIL)


# ── Очередь вызовов одного участника ────────────────────────────────────────────


class _Turn:
    __slots__ = ("lock", "loop", "holders")

    def __init__(self, loop: asyncio.AbstractEventLoop) -> None:
        self.lock = asyncio.Lock()
        self.loop = loop
        self.holders = 0


# (участник, экзамен) → замок; запись живёт, пока её кто-то держит или ждёт.
_turns: dict[tuple[str, str], _Turn] = {}


@contextlib.asynccontextmanager
async def _one_at_a_time(key: tuple[str, str]) -> AsyncIterator[None]:
    """Вызовы с одним ключом идут по очереди: второй видит предметы, которые первый уже привязал."""
    loop = asyncio.get_running_loop()
    turn = _turns.get(key)
    if turn is None or turn.loop is not loop:
        turn = _turns[key] = _Turn(loop)
    turn.holders += 1
    try:
        async with turn.lock:
            yield
    finally:
        turn.holders -= 1
        if turn.holders == 0 and _turns.get(key) is turn:
            del _turns[key]


def _member(request: Request) -> str | None:
    user = getattr(request.state, "user", None)
    if isinstance(user, dict) and user.get("id"):
        return str(user["id"])
    return None


# ── Один предмет ────────────────────────────────────────────────────────────────


async def _bind(db: SupabaseRest, subject_id: str, exam_id: str, status: str) -> dict:
    """Копия участника становится устной частью его предмета (container_bind_copy)."""
    try:
        result = await db.rpc("container_bind_copy", {"p_subject_id": subject_id, "p_exam_id": exam_id})
    except SupabaseRestError as exc:
        error = _container_error(exc)
        if error.status_code == 401:
            raise error from None
        _note("bind", exc)
        return _result(subject_id, FAILED)
    bound = _uuid(result.get("exam_id")) if isinstance(result, dict) else None
    if bound is None:
        print("Container oral sync: bind answered without an exam")
        return _result(subject_id, FAILED)
    return _result(subject_id, status, bound)


def _refused(subject_id: str, step: str, exc: SupabaseRestError) -> dict:
    """Отказ устного пути (exam_share_bundle, exam_share_join): ссылка закрыта или истекла — closed, иначе failed."""
    error = _rpc_error(exc)
    if error.status_code == 401:
        raise error from None
    if error.code in _CLOSED_CODES:
        return _result(subject_id, CLOSED)
    _note(step, exc)
    return _result(subject_id, FAILED)


async def _copy(db: SupabaseRest, subject_id: str, code: str) -> dict:
    """Новая копия — как при входе по ссылке /join (exam_shares.join_share), затем привязка к предмету."""
    try:
        raw = await db.rpc("exam_share_bundle", {"p_code": code})
    except SupabaseRestError as exc:
        return _refused(subject_id, "bundle", exc)
    joined = raw.get("joined") if isinstance(raw, dict) else None
    earlier = _uuid(joined.get("exam_id")) if isinstance(joined, dict) else None
    if earlier is not None:  # копия по этой ссылке уже есть (прошлый вызов не успел её привязать)
        return await _bind(db, subject_id, earlier, BOUND)
    snapshot = snapshot_from_bundle(raw)
    try:
        plan = await asyncio.to_thread(plan_copy, snapshot)
    except ShareError as exc:
        if exc.code == "not_ready":  # join не вызывается: место по ссылке не занято
            return _result(subject_id, NOT_READY)
        raise
    try:
        result = await db.rpc("exam_share_join", {"p_code": code, "p_copy": plan.payload})
    except SupabaseRestError as exc:
        return _refused(subject_id, "join", exc)
    copy_id = _uuid(result.get("exam_id")) if isinstance(result, dict) else None
    if copy_id is None:
        raise ShareError(503, "read_failed", READ_FAILED_DETAIL)
    return await _bind(db, subject_id, copy_id, COPIED if bool(result.get("joined")) else BOUND)


async def _sync_subject(db: SupabaseRest, subject_id: str, entry: dict, request: Request) -> dict:
    """Статус одного предмета. Истёкшая сессия прерывает весь вызов (401); остальное стоит одного предмета."""
    try:
        existing = _uuid(entry.get("existing_exam_id"))
        if existing is not None:
            return await _bind(db, subject_id, existing, BOUND)
        code = normalize_code(entry.get("code"))
        if code is None:
            print("Container oral sync: an oral subject came without a usable code")
            return _result(subject_id, FAILED)
        return await _copy(db, subject_id, code)
    except ShareError as exc:
        if exc.status_code == 401:
            raise
        print(f"Container oral sync: copy refused ({exc.status_code} {exc.code})")
        return _result(subject_id, FAILED)
    except Exception as exc:  # ошибка кода: один предмет «failed», команда видит server_error
        error_id = uuid.uuid4().hex[:12]
        print(f"Container oral sync [{error_id}]: {type(exc).__name__}")
        telemetry_api.report_server_error("container_oral_sync", error_id, exc, request)
        return _result(subject_id, FAILED)


# ── Экзамен целиком ─────────────────────────────────────────────────────────────


async def _oral_codes(db: SupabaseRest, container_id: str) -> list[tuple[str, dict]]:
    """Предметы, у которых участник ещё без копии: (id предмета, строка container_oral_codes)."""
    try:
        raw = await db.rpc("container_oral_codes", {"p_container_id": container_id})
    except SupabaseRestError as exc:
        raise _container_error(exc) from None
    subjects = raw.get("subjects") if isinstance(raw, dict) else None
    if not isinstance(subjects, list):
        print("Container oral sync: oral codes came in an unexpected shape")
        raise ShareError(503, "read_failed", READ_FAILED_DETAIL)
    entries: list[tuple[str, dict]] = []
    seen: set[str] = set()
    for entry in subjects:
        subject_id = _uuid(entry.get("subject_id")) if isinstance(entry, dict) else None
        if subject_id is None or subject_id in seen:
            print("Container oral sync: an oral subject came without a usable id")
            continue
        seen.add(subject_id)
        entries.append((subject_id, entry))
    return entries


async def _withheld(db: SupabaseRest, container_id: str, listed: set[str]) -> tuple[dict[str, int], list[str]]:
    """Порядок устных предметов экзамена и те из них без копии участника, которых container_oral_codes не назвала.

    Предметы участник читает как вступивший, привязки — только свои (RLS «Member exams: read own»). Не прочитать —
    ({}, []): то, что вызов уже сделал, важнее этих строк."""
    try:
        subjects = await db.select(
            "container_subjects",
            {"select": "id", "container_id": f"eq.{container_id}", "exam_id": "not.is.null",
             "order": "position.asc,created_at.asc"},
        )
        bound = await db.select("container_member_exams", {"select": "subject_id", "container_id": f"eq.{container_id}"})
    except SupabaseRestError as exc:
        _note("subjects read", exc)
        return {}, []
    ids = [sid for sid in (_uuid(row.get("id")) for row in subjects if isinstance(row, dict)) if sid]
    have = {sid for sid in (_uuid(row.get("subject_id")) for row in bound if isinstance(row, dict)) if sid}
    order = {sid: index for index, sid in enumerate(dict.fromkeys(ids))}
    return order, [sid for sid in order if sid not in have and sid not in listed]


@router.post("/{container_id}/oral-sync")
@limiter.limit("6/minute", key_func=user_or_ip_key)
async def oral_sync(container_id: str, request: Request):
    """Участник группы: свои копии устных предметов экзамена через устный путь (OralSyncResponse)."""
    container = _uuid(container_id.strip())
    if container is None:
        raise ShareError(404, "not_found", EXAM_NOT_FOUND_DETAIL)
    token = bearer_token(request)
    user_id = _member(request)
    # Без пользователя в request.state (роутер без middleware main.py) — очередь по отпечатку токена, не по нему самому.
    caller = f"user:{user_id}" if user_id else "token:" + hashlib.sha256(token.encode("utf-8")).hexdigest()
    async with _one_at_a_time((caller, container)):
        async with SupabaseRest(token, timeout=READ_TIMEOUT_SECONDS) as db:
            oral: list[dict] = []
            for subject_id, entry in await _oral_codes(db, container):
                oral.append(await _sync_subject(db, subject_id, entry, request))
            order, closed = await _withheld(db, container, {row["subject_id"] for row in oral})
    oral.extend(_result(subject_id, CLOSED) for subject_id in closed)
    if order:
        oral.sort(key=lambda row: order.get(row["subject_id"], len(order)))
    return {"container_id": container, "oral": oral}
