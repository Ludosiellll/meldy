"""First-party statistics and error reports (2026-10-05), kept in Meldy's own Supabase.

POST /api/telemetry {"events": [...]}: the browser's batch (frontend/src/lib/telemetry.ts). The path is
public — a signed-out visitor on the landing page or /try sends it too — so the auth middleware in main.py
lets exactly this path through, like /api/health. The batch is checked here (at most 50 events, known
fields only, short values, no server_error from a browser) and forwarded to the RPC log_app_events with
the caller's own token, or with the anon key when there is none. The database sets user_id from the
token itself, clamps every event once more and caps the volume (migration *_app_telemetry.sql). The
answer is 204 whatever happens downstream: statistics never break a page. A body over 32 KB is 413, a
caller over the rate limit gets the shared limiter's 429.

Rate limit: 30 a minute and 2000 a day per account (the token's own subject names the bucket; the
database verifies the token), per browser session for a signed-out visitor (X-Meldy-Session), else per
address; plus 600 a minute per address in all. On the Hugging Face host every visitor may arrive from the
proxy's address, so an address alone would throttle everyone together.

Server errors: report_server_error() — main.py calls it where it gives the user an error id (the global
exception handler, the analysis streams). One server_error event with the route pattern
(/api/exams/{exam_id}/map), the exception class, the code frames (file:line in function) and the error
id. Never the request body, the exception's text (it may quote the user's input), headers or tokens. The
event goes in the background with the request's own token (bind_request() in the auth middleware keeps it
for the request) and never delays the response.

Off switch: TELEMETRY_DISABLED=1 (backend/tests/conftest.py sets it for every test but its own).
"""

from __future__ import annotations

import asyncio
import base64
import contextvars
import json
import math
import os
import re
import time
import traceback
from collections import deque
from typing import Any, Optional

from fastapi import APIRouter, Request
from fastapi.responses import Response
from slowapi.util import get_remote_address

import supabase_rest
from ratelimit import limiter

__all__ = [
    "TELEMETRY_PATH",
    "bind_request",
    "clean_batch",
    "drain_background",
    "report_server_error",
    "route_pattern",
    "router",
    "store_events",
    "telemetry_rate_key",
]

router = APIRouter()

TELEMETRY_PATH = "/api/telemetry"
MAX_BODY_BYTES = 32 * 1024
MAX_EVENTS = 50
RATE_LIMIT = "30/minute;2000/day"
ADDRESS_CEILING = "600/minute"
RPC_TIMEOUT_SECONDS = 3.0
SERVER_ERRORS_PER_MINUTE = 60

CLIENT_KINDS = frozenset({"event", "client_error"})
DEVICES = frozenset({"mobile", "tablet", "desktop"})
PROPS_MAX_KEYS = 12
PROPS_MAX_BYTES = 2048
PROP_TEXT_MAX = 80
MESSAGE_MAX = 500
STACK_MAX = 4000

# The same shapes as the table's CHECK constraints (fullmatch: no trailing newline sneaks through).
_NAME_RE = re.compile(r"[a-z0-9_.:-]{1,60}")
_ROUTE_RE = re.compile(r"/[A-Za-z0-9/:_.{}*-]{0,119}")
_SESSION_RE = re.compile(r"[A-Za-z0-9_-]{1,40}")
_VERSION_RE = re.compile(r"[A-Za-z0-9._+-]{1,40}")
_PROP_KEY_RE = re.compile(r"[a-z0-9_]{1,40}")
_ERROR_ID_RE = re.compile(r"[0-9a-f]{6,32}")
_UUID_RE = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")

_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))


def telemetry_enabled() -> bool:
    return os.getenv("TELEMETRY_DISABLED", "").strip().lower() not in ("1", "true", "yes", "on")


_REPORTED: set[str] = set()


def _report_once(what: str, detail: str) -> None:
    """One server log line per kind of failure for the life of the process (no tokens, no events)."""
    key = f"{what}|{detail}"
    if key in _REPORTED:
        return
    _REPORTED.add(key)
    print(f"Telemetry: {what} ({detail}); further failures of this kind are not logged")


def _failure_kind(exc: BaseException) -> str:
    if isinstance(exc, supabase_rest.SupabaseRestError):
        return f"{exc.status} {exc.code or ''}".strip()
    if isinstance(exc, (asyncio.TimeoutError, TimeoutError)):
        return "timeout"
    return type(exc).__name__


# ── Background tasks ──────────────────────────────────────────────────────────

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
    """Wait for the server errors still being written (tests, shutdown)."""
    while _BACKGROUND:
        await asyncio.gather(*list(_BACKGROUND), return_exceptions=True)


# ── Tokens and keys ───────────────────────────────────────────────────────────


def request_token(request: Any) -> Optional[str]:
    """The token of Authorization: Bearer …, or None (never raises)."""
    headers = getattr(request, "headers", None)
    if headers is None:
        return None
    scheme, _, token = str(headers.get("Authorization", "") or "").partition(" ")
    token = token.strip()
    return token if scheme.lower() == "bearer" and token else None


def _anon_key() -> str:
    return (
        os.getenv("SUPABASE_KEY")
        or os.getenv("VITE_SUPABASE_ANON_KEY")
        or os.getenv("VITE_SUPABASE_KEY")
        or ""
    ).strip()


def _unverified_subject(token: Optional[str]) -> Optional[str]:
    """The sub claim of a JWT, unverified: it only names a rate-limit bucket (the database checks the token)."""
    if not token:
        return None
    parts = token.split(".")
    if len(parts) != 3 or len(parts[1]) > 4096:
        return None
    try:
        payload = json.loads(base64.urlsafe_b64decode(parts[1] + "=" * (-len(parts[1]) % 4)))
    except Exception:
        return None
    sub = payload.get("sub") if isinstance(payload, dict) else None
    return sub if isinstance(sub, str) and _UUID_RE.fullmatch(sub) else None


def telemetry_rate_key(request: Request) -> str:
    """Per account when there is a session, per browser session for a signed-out visitor, else per address."""
    user = getattr(request.state, "user", None)
    if isinstance(user, dict) and user.get("id"):
        return f"user:{user['id']}"
    subject = _unverified_subject(request_token(request))
    if subject:
        return f"user:{subject}"
    session = request.headers.get("X-Meldy-Session", "")
    if _SESSION_RE.fullmatch(session):
        return f"session:{session}"
    return get_remote_address(request)


# ── Checking a batch ──────────────────────────────────────────────────────────


def _short_text(value: Any, limit: int) -> Optional[str]:
    if not isinstance(value, str):
        return None
    text = value.strip()[:limit]
    return text or None


def _matching(value: Any, pattern: re.Pattern) -> Optional[str]:
    return value if isinstance(value, str) and pattern.fullmatch(value) else None


def clean_props(value: Any) -> dict:
    """A flat object of at most 12 short values: booleans, finite numbers, null and strings up to 80 characters."""
    if not isinstance(value, dict):
        return {}
    props: dict[str, Any] = {}
    for key, item in value.items():
        if len(props) >= PROPS_MAX_KEYS:
            break
        if not isinstance(key, str) or not _PROP_KEY_RE.fullmatch(key):
            continue
        if item is None or isinstance(item, bool):
            props[key] = item
        elif isinstance(item, (int, float)):
            if isinstance(item, float) and not math.isfinite(item):
                continue
            props[key] = item
        elif isinstance(item, str):
            props[key] = item[:PROP_TEXT_MAX]
    # The database measures the jsonb text (", " and ": " separators); over 2 KB it would store {}.
    if len(json.dumps(props, ensure_ascii=False, separators=(", ", ": ")).encode("utf-8")) > PROPS_MAX_BYTES:
        return {}
    return props


def clean_event(raw: Any) -> Optional[dict]:
    """One browser event with known fields only, or None when its kind or name does not fit."""
    if not isinstance(raw, dict):
        return None
    kind = raw.get("kind")
    name = _matching(raw.get("name"), _NAME_RE)
    if kind not in CLIENT_KINDS or name is None:
        return None
    event: dict[str, Any] = {"kind": kind, "name": name}
    route = _matching(raw.get("route"), _ROUTE_RE)
    if route:
        event["route"] = route
    session = _matching(raw.get("session"), _SESSION_RE)
    if session:
        event["session"] = session
    device = raw.get("device")
    if device in DEVICES:
        event["device"] = device
    version = _matching(raw.get("app_version"), _VERSION_RE)
    if version:
        event["app_version"] = version
    props = clean_props(raw.get("props"))
    if props:
        event["props"] = props
    if kind == "client_error":
        message = _short_text(raw.get("message"), MESSAGE_MAX)
        if message:
            event["message"] = message
        stack = raw.get("stack")
        if isinstance(stack, str) and stack.strip():
            event["stack"] = stack[:STACK_MAX]
    return event


def clean_batch(body: bytes) -> list[dict]:
    """The checked events of a request body ({"events": [...]}); [] for anything else."""
    try:
        data = json.loads(body)
    except Exception:  # not JSON, wrong encoding, or nested too deep
        return []
    events = data.get("events") if isinstance(data, dict) else None
    if not isinstance(events, list):
        return []
    cleaned = []
    for raw in events[:MAX_EVENTS]:
        event = clean_event(raw)
        if event is not None:
            cleaned.append(event)
    return cleaned


async def _read_body(request: Request) -> Optional[bytes]:
    """The body, or None when it is (or says it is) over 32 KB."""
    declared = request.headers.get("content-length")
    if declared:
        try:
            if int(declared) > MAX_BODY_BYTES:
                return None
        except ValueError:
            return None
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_BODY_BYTES:
            return None
        chunks.append(chunk)
    return b"".join(chunks)


# ── Writing ───────────────────────────────────────────────────────────────────


async def store_events(token: Optional[str], events: list[dict]) -> int:
    """log_app_events with the caller's token (anon key without one); the number stored, 0 on any failure.

    A session token the database refuses (expired, 401) is tried once more with the anon key: the events
    then count without the account rather than not at all.
    """
    if not events:
        return 0
    anon = _anon_key()
    tokens = [token] if token and token != anon else []
    if anon:
        tokens.append(anon)
    for index, attempt in enumerate(tokens):
        try:
            async with supabase_rest.SupabaseRest(attempt, timeout=RPC_TIMEOUT_SECONDS) as db:
                stored = await asyncio.wait_for(
                    db.rpc("log_app_events", {"p_events": events}), timeout=RPC_TIMEOUT_SECONDS + 0.5
                )
        except asyncio.CancelledError:
            raise
        except supabase_rest.SupabaseRestError as exc:
            if exc.status == 401 and index + 1 < len(tokens):
                continue
            _report_once("events not stored", _failure_kind(exc))
            return 0
        except Exception as exc:
            _report_once("events not stored", _failure_kind(exc))
            return 0
        return stored if isinstance(stored, int) and not isinstance(stored, bool) else 0
    return 0


@router.post(TELEMETRY_PATH, status_code=204, include_in_schema=False)
@limiter.limit(ADDRESS_CEILING, key_func=get_remote_address)
@limiter.limit(RATE_LIMIT, key_func=telemetry_rate_key)
async def receive_telemetry(request: Request) -> Response:
    """The browser's batch: 204 whatever happens downstream, 413 over 32 KB."""
    try:
        body = await _read_body(request)
    except Exception:  # the client went away mid-body
        return Response(status_code=204)
    if body is None:
        return Response(status_code=413)
    events = clean_batch(body)
    if events and telemetry_enabled():
        await store_events(request_token(request), events)
    return Response(status_code=204)


# ── Server errors ─────────────────────────────────────────────────────────────

_REQUEST: contextvars.ContextVar[Optional[tuple[Optional[str], Any]]] = contextvars.ContextVar(
    "meldy_telemetry_request", default=None
)
_SERVER_ERROR_TIMES: deque = deque()


def bind_request(request: Any) -> None:
    """Auth middleware: a server error of this request names its route and goes with its token."""
    try:
        _REQUEST.set((request_token(request), getattr(request, "scope", None)))
    except Exception:
        pass


def route_pattern(scope: Any) -> Optional[str]:
    """The matched route's path template (/api/exams/{exam_id}/map), never the path with its ids."""
    route = scope.get("route") if isinstance(scope, dict) else None
    for attribute in ("path_format", "path"):
        value = getattr(route, attribute, None)
        if isinstance(value, str) and _ROUTE_RE.fullmatch(value):
            return value
    return None


def _code_path(filename: str) -> str:
    path = os.path.abspath(filename or "?")
    if path.startswith(_BACKEND_DIR + os.sep):
        return os.path.relpath(path, _BACKEND_DIR)
    marker = "site-packages" + os.sep
    index = path.rfind(marker)
    return path[index + len(marker):] if index >= 0 else os.path.basename(path)


def code_frames(exc: Optional[BaseException]) -> Optional[str]:
    """«main.py:441 in _guarded» lines of the traceback: code positions only, no values, no message."""
    if exc is None or exc.__traceback__ is None:
        return None
    frames = traceback.extract_tb(exc.__traceback__)[-30:]
    text = "\n".join(f"{_code_path(frame.filename)}:{frame.lineno} in {frame.name}" for frame in frames)
    return text[-STACK_MAX:] or None


def exception_name(exc: Optional[BaseException]) -> Optional[str]:
    if exc is None:
        return None
    cls = type(exc)
    module = getattr(cls, "__module__", "") or ""
    name = getattr(cls, "__qualname__", cls.__name__)
    return (name if module in ("builtins", "__main__") else f"{module}.{name}")[:120]


def _server_version() -> Optional[str]:
    return _matching(os.getenv("APP_VERSION", "").strip(), _VERSION_RE)


def _within_budget() -> bool:
    """At most SERVER_ERRORS_PER_MINUTE events a minute: an outage writes a sample, not a flood."""
    now = time.monotonic()
    while _SERVER_ERROR_TIMES and now - _SERVER_ERROR_TIMES[0] > 60:
        _SERVER_ERROR_TIMES.popleft()
    if len(_SERVER_ERROR_TIMES) >= SERVER_ERRORS_PER_MINUTE:
        return False
    _SERVER_ERROR_TIMES.append(now)
    return True


def server_error_event(name: str, error_id: str, exc: Optional[BaseException], scope: Any) -> dict:
    cls = exception_name(exc)
    props: dict[str, Any] = {}
    if isinstance(error_id, str) and _ERROR_ID_RE.fullmatch(error_id):
        props["error_id"] = error_id
    if cls:
        props["exception"] = cls[:PROP_TEXT_MAX]
    event: dict[str, Any] = {
        "kind": "server_error",
        "name": name if _NAME_RE.fullmatch(name or "") else "server_error",
        "props": props,
        "message": cls or name,
    }
    route = route_pattern(scope)
    if route:
        event["route"] = route
    stack = code_frames(exc)
    if stack:
        event["stack"] = stack
    version = _server_version()
    if version:
        event["app_version"] = version
    return event


def report_server_error(name: str, error_id: str, exc: Optional[BaseException] = None, request: Any = None) -> None:
    """Record one server_error in the background; never raises and never waits."""
    try:
        if not telemetry_enabled() or not _within_budget():
            return
        if request is not None:
            token, scope = request_token(request), getattr(request, "scope", None)
        else:
            token, scope = _REQUEST.get() or (None, None)
        _spawn(store_events(token, [server_error_event(name, error_id, exc, scope)]))
    except Exception:
        pass  # an error report must never become a second error
