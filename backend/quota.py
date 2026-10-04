"""Дневной лимит ИИ на сервере и журнал вызовов моделей (2026-10-04).

Списание. Единицы (plans.py) списывает сервер до вызова модели: RPC consume_ai_units
токеном самого пользователя — ключа service_role у backend нет и не нужно. Функция в
базе атомарно прибавляет единицы к строке дня ai_usage (дата UTC), только если сумма не
превысит дневной лимит (FREE 100, PRO 1000), и возвращает номер списания. Отказ —
AILimitExceeded: 429 {"detail", "code": "ai_limit", "used", "limit", "resets_at", "pro"}.
Модель не дала годного ответа (ошибка, таймаут, ничего не сохранено) — Charge.refund():
refund_ai_units возвращает единицы этого списания по его номеру. Номер видит только
сервер, поэтому клиент не может «вернуть» себе единицы сам.

Сбой самой проверки (Supabase недоступен, 5xx, таймаут ~3 с, функции ещё нет в базе)
учёбу не останавливает: действие разрешается, в журнал сервера уходит одна строка на
каждый вид сбоя (fail-open). Явный отказ функции — всегда 429.

Журнал вызовов. BaseAgent сообщает о каждом настоящем (не из кэша) вызове модели:
провайдер, модель, успех, время. Здесь это уходит в log_ai_call токеном пользователя в
фоне, с коротким таймаутом: ответ пользователю журнал не ждёт и не ломает. Токен и вид
действия кладёт в contextvar middleware авторизации (вид — по пути запроса), charge()
уточняет вид и единицы. Единицы в журнале — только у первого удачного вызова действия.

Аварийные выключатели: AI_QUOTA_DISABLED=1 — не списывать, AI_CALL_LOG_DISABLED=1 — не
вести журнал. Тесты выключают оба (backend/tests/conftest.py), кроме своих.
"""

from __future__ import annotations

import asyncio
import contextlib
import contextvars
import hashlib
import os
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import supabase_rest
from agents import base as ai_base
from agents.base import AIError
from plans import AI_COSTS, exam_mapping_cost, professor_exam_cost

__all__ = [
    "AI_LIMIT_DETAIL",
    "AILimitExceeded",
    "Charge",
    "DEMO_LECTURE_SHA256",
    "bind_request",
    "charge",
    "drain_background",
    "exam_mapping_units",
    "is_demo_text",
    "is_demo_upload",
    "kind_from_path",
    "next_reset",
    "professor_exam_units",
    "reserve",
]

AI_LIMIT_DETAIL = "Дневной лимит ИИ на сегодня исчерпан."
QUOTA_TIMEOUT_SECONDS = 3.0
LOG_TIMEOUT_SECONDS = 2.0
KIND_MAX = 40
PROVIDER_MAX = 20
MODEL_MAX = 80

_KIND_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,40}$")
_UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_PATH_JUNK_RE = re.compile(r"[^A-Za-z0-9_]+")

# Встроенный демо-текст анализа (frontend/src/data/demo/lecture.txt) бесплатен: сервер узнаёт его
# по SHA-256 нормализованного текста (без BOM, любые пробелы и переводы строк — один пробел).
# Тест tests/test_quota.py читает файл и сверяет хеш: правка текста без правки хеша — красный тест.
DEMO_LECTURE_SHA256 = "d076e6e3ccb15e3496cb1cbe464de7c7f64461606754845ce977f81e55110359"
DEMO_MAX_BYTES = 64 * 1024


# ── Выключатели и журнал сбоев ─────────────────────────────────────────────────


def _flag(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in ("1", "true", "yes", "on")


def quota_enabled() -> bool:
    return not _flag("AI_QUOTA_DISABLED")


def call_log_enabled() -> bool:
    return not _flag("AI_CALL_LOG_DISABLED")


_REPORTED: set[str] = set()


def _report_once(what: str, detail: str) -> None:
    """Одна строка в журнал сервера на каждый вид сбоя за жизнь процесса (без токенов и текста ответа)."""
    key = f"{what}|{detail}"
    if key in _REPORTED:
        return
    _REPORTED.add(key)
    print(f"AI quota: {what} ({detail}); further failures of this kind are not logged")


def _failure_kind(exc: BaseException) -> str:
    if isinstance(exc, supabase_rest.SupabaseRestError):
        return f"{exc.status} {exc.code or ''}".strip()
    if isinstance(exc, (asyncio.TimeoutError, TimeoutError)):
        return "timeout"
    return type(exc).__name__


# ── Фоновые задачи (возврат единиц после обрыва, журнал вызовов) ─────────────


_BACKGROUND: set[asyncio.Task] = set()


def _spawn(coro) -> Optional[asyncio.Task]:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        coro.close()
        return None
    task = loop.create_task(coro)
    _BACKGROUND.add(task)
    task.add_done_callback(_BACKGROUND.discard)
    return task


async def drain_background() -> None:
    """Дождаться фоновых возвратов и записей журнала (тесты и остановка процесса)."""
    while _BACKGROUND:
        await asyncio.gather(*list(_BACKGROUND), return_exceptions=True)


# ── Время сброса ───────────────────────────────────────────────────────────────


def next_reset(now: Optional[datetime] = None) -> str:
    """Ближайшие 00:00 UTC (новый день счётчика) как «2026-10-05T00:00:00Z»."""
    moment = now or datetime.now(timezone.utc)
    day = moment.astimezone(timezone.utc).date() + timedelta(days=1)
    return f"{day.isoformat()}T00:00:00Z"


def _parse_reset(value: Any) -> Optional[datetime]:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        moment = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def _seconds_until(resets_at: Optional[str]) -> Optional[int]:
    moment = _parse_reset(resets_at)
    if moment is None:
        return None
    return max(1, int((moment - datetime.now(timezone.utc)).total_seconds()) + 1)


def _count(value: Any) -> int:
    if isinstance(value, bool):
        return 0
    try:
        number = int(value)
    except (TypeError, ValueError):
        return 0
    return max(0, number)


# ── Отказ по лимиту ────────────────────────────────────────────────────────────


class AILimitExceeded(AIError):
    """429 ai_limit: дневного лимита не хватает на действие (не сбой провайдера).

    В ответе, кроме detail и code: used и limit дня, resets_at (00:00 UTC), pro и units —
    сколько единиц просило действие.
    """

    def __init__(self, *, used: int, limit: int, resets_at: Optional[str], pro: bool, units: int = 0) -> None:
        super().__init__(429, "ai_limit", AI_LIMIT_DETAIL)
        reset = resets_at if _parse_reset(resets_at) is not None else next_reset()
        self.extra = {"used": used, "limit": limit, "resets_at": reset, "pro": bool(pro), "units": units}
        self.retry_after = _seconds_until(reset)

    def event(self) -> dict:
        """То же для потока SSE: терминальное событие error с кодом ai_limit."""
        return {"type": "error", "code": self.code, "message": self.detail, **self.extra}


# ── Контекст для журнала вызовов ───────────────────────────────────────────────


@dataclass
class _CallContext:
    token: str
    kind: str
    units: int = 0
    units_logged: bool = False


_CALL_CONTEXT: contextvars.ContextVar[Optional[_CallContext]] = contextvars.ContextVar("meldy_ai_call", default=None)


def request_token(request: Any) -> Optional[str]:
    """Токен из Authorization: Bearer … или None (без исключения)."""
    headers = getattr(request, "headers", None)
    if headers is None:
        return None
    scheme, _, token = str(headers.get("Authorization", "") or "").partition(" ")
    token = token.strip()
    return token if scheme.lower() == "bearer" and token else None


def kind_from_path(path: str) -> str:
    """Вид действия для журнала по пути: /api/oral/check → oral_check, /api/exams/<id>/map → exams_map."""
    parts = [part for part in (path or "").split("/") if part and part != "api" and not _UUID_RE.match(part)]
    kind = _PATH_JUNK_RE.sub("_", "_".join(parts)).strip("_")[:KIND_MAX]
    return kind or "api"


def bind_request(request: Any) -> None:
    """Middleware авторизации: вызовы моделей этого запроса пишутся в журнал его пользователя."""
    token = request_token(request)
    if token:
        path = getattr(getattr(request, "url", None), "path", "") or ""
        _CALL_CONTEXT.set(_CallContext(token=token, kind=kind_from_path(path)))


def _bind_call(token: Optional[str], kind: str, units: int) -> None:
    if token:
        _CALL_CONTEXT.set(_CallContext(token=token, kind=kind, units=units))


def _short(value: Any, limit: int) -> Optional[str]:
    if not isinstance(value, str) or not value.strip():
        return None
    return value.strip()[:limit]


def _on_model_call(record: dict) -> None:
    """Наблюдатель BaseAgent: настоящий вызов модели → log_ai_call в фоне."""
    context = _CALL_CONTEXT.get()
    if context is None or not call_log_enabled():
        return
    units = 0
    if record.get("ok") and context.units > 0 and not context.units_logged:
        units = context.units
        context.units_logged = True
    payload = {
        "p_kind": context.kind,
        "p_units": units,
        "p_provider": _short(record.get("provider"), PROVIDER_MAX),
        "p_model": _short(record.get("model"), MODEL_MAX),
        "p_ok": bool(record.get("ok")),
        "p_ms": min(_count(record.get("ms")), 3_600_000),
    }
    _spawn(_post_log(context.token, payload))


async def _post_log(token: str, payload: dict) -> None:
    try:
        async with supabase_rest.SupabaseRest(token, timeout=LOG_TIMEOUT_SECONDS) as db:
            await asyncio.wait_for(db.rpc("log_ai_call", payload), timeout=LOG_TIMEOUT_SECONDS + 0.5)
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        _report_once("call log failed", _failure_kind(exc))


ai_base.add_call_observer(_on_model_call)


# ── Списание и возврат ─────────────────────────────────────────────────────────


@dataclass
class Charge:
    """Списание единиц за одно действие. units — сколько списано в базе (0: бесплатно, выключено или fail-open)."""

    kind: str
    units: int = 0
    charge_id: Optional[str] = None
    token: Optional[str] = field(default=None, repr=False)
    status: Optional[dict] = None
    refunded: bool = False
    kept: bool = False
    _refund_task: Optional[asyncio.Task] = field(default=None, repr=False, compare=False)

    @property
    def reserved(self) -> bool:
        return self.units > 0 and bool(self.charge_id) and bool(self.token) and not self.refunded

    def keep(self) -> None:
        """Результат действия отдан: единицы остаются списанными."""
        self.kept = True

    async def release_unkept(self) -> None:
        """Фон ответа-потока: вернуть единицы, если результат так и не ушёл (клиент ушёл до потока)."""
        if not self.kept:
            await self.refund()

    async def refund(self) -> None:
        """Вернуть единицы этого списания один раз; уже идущий фоновый возврат — дождаться.

        Сбой возврата пишется в журнал сервера и не бросается.
        """
        if self._refund_task is not None:
            await self.wait_refund()
            return
        if not self.reserved:
            return
        self.refunded = True
        await self._send_refund()

    async def wait_refund(self) -> None:
        """Дождаться фонового возврата, если он идёт (фон ответа; сам возврат не начинает)."""
        pending = self._refund_task
        if pending is not None and not pending.done():
            try:
                await asyncio.shield(pending)
            except Exception:
                pass

    def refund_soon(self) -> None:
        """Возврат в фоне: из finally потока, который может быть уже отменён (клиент ушёл)."""
        if not self.reserved or self._refund_task is not None:
            return
        self.refunded = True
        self._refund_task = _spawn(self._send_refund())
        if self._refund_task is None:
            self.refunded = False  # нет цикла событий: вернёт следующий refund()

    async def _send_refund(self) -> None:
        args = {"p_units": self.units, "p_kind": self.kind, "p_charge": self.charge_id}
        try:
            async with supabase_rest.SupabaseRest(self.token, timeout=QUOTA_TIMEOUT_SECONDS) as db:
                await asyncio.wait_for(db.rpc("refund_ai_units", args), timeout=QUOTA_TIMEOUT_SECONDS + 0.5)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            _report_once("refund failed", _failure_kind(exc))


async def reserve(token: Optional[str], kind: str, units: int) -> Charge:
    """Списать units единиц за действие kind от имени владельца token.

    0 единиц — ничего не списывает. Отказ функции — AILimitExceeded (429 ai_limit); сбой
    проверки — Charge без списания (действие разрешено, вид сбоя — одна строка в журнале).
    """
    if not isinstance(kind, str) or not _KIND_RE.match(kind):
        raise ValueError("invalid AI action kind")
    units = _count(units)
    _bind_call(token, kind, units)
    if units == 0 or not quota_enabled():
        return Charge(kind=kind, token=token)
    if not token:
        _report_once("limit check skipped", "no session token")
        return Charge(kind=kind)
    try:
        async with supabase_rest.SupabaseRest(token, timeout=QUOTA_TIMEOUT_SECONDS) as db:
            answer = await asyncio.wait_for(
                db.rpc("consume_ai_units", {"p_units": units, "p_kind": kind}),
                timeout=QUOTA_TIMEOUT_SECONDS + 0.5,
            )
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        _report_once("limit check unavailable, action allowed", _failure_kind(exc))
        return Charge(kind=kind, token=token)
    if isinstance(answer, list) and len(answer) == 1:
        answer = answer[0]
    if not isinstance(answer, dict) or not isinstance(answer.get("allowed"), bool):
        _report_once("limit check unavailable, action allowed", "unexpected answer")
        return Charge(kind=kind, token=token)
    if not answer["allowed"]:
        raise AILimitExceeded(
            used=_count(answer.get("used")),
            limit=_count(answer.get("limit")),
            resets_at=answer.get("resets_at") if isinstance(answer.get("resets_at"), str) else None,
            pro=answer.get("pro") is True,
            units=units,
        )
    charge_id = answer.get("charge_id")
    if not isinstance(charge_id, str) or not charge_id:
        charge_id = None
        _report_once("charge without an id, refunds impossible", "no charge_id")
    return Charge(kind=kind, units=units, charge_id=charge_id, token=token, status=answer)


async def charge(request: Any, kind: str, units: int) -> Charge:
    """Списать единицы за действие этого запроса (токен — из Authorization). См. reserve()."""
    return await reserve(request_token(request), kind, units)


@contextlib.asynccontextmanager
async def refund_on_failure(spent: Charge):
    """Любое исключение внутри блока (ошибка модели, таймаут, негодный ответ) возвращает единицы."""
    try:
        yield spent
    except asyncio.CancelledError:
        spent.refund_soon()
        raise
    except BaseException:
        await spent.refund()
        raise


def cost(kind: str) -> int:
    """Цена действия из plans.AI_COSTS (KeyError для неизвестного вида — ошибка в коде)."""
    return AI_COSTS[kind]


def exam_mapping_units(questions_to_model: int) -> int:
    return exam_mapping_cost(questions_to_model)


def professor_exam_units(length: Any) -> int:
    return professor_exam_cost(length)


# ── Демо-текст ─────────────────────────────────────────────────────────────────


def normalized_text(text: str) -> str:
    return " ".join(text.replace("﻿", "").split())


def is_demo_text(text: Any) -> bool:
    """Это встроенный демо-текст анализа (пробелы и переводы строк не важны)."""
    if not isinstance(text, str) or not text.strip():
        return False
    digest = hashlib.sha256(normalized_text(text).encode("utf-8")).hexdigest()
    return digest == DEMO_LECTURE_SHA256


def is_demo_upload(contents: bytes, filename: str) -> bool:
    """Файл .txt (так браузер отправляет вставленный текст) с демо-текстом внутри."""
    if not isinstance(contents, (bytes, bytearray)) or not contents or len(contents) > DEMO_MAX_BYTES:
        return False
    if not str(filename or "").lower().endswith((".txt", ".md")):
        return False
    try:
        text = bytes(contents).decode("utf-8")
    except UnicodeDecodeError:
        return False
    return is_demo_text(text)
