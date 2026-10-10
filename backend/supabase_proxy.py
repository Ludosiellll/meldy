"""Запасной путь браузера к Supabase через сайт Meldy: /sb/<путь> → SUPABASE_URL/<путь>.

Часть операторов в России не пропускает *.supabase.co. Браузер сначала идёт напрямую, а если
адрес недоступен, — сюда (frontend/src/lib/supabaseRoute.ts). Проксируются только auth/v1,
rest/v1 и storage/v1 одного проекта и три пути функции telegram: GET functions/v1/telegram/file
(файл, пересланный боту, по одноразовому токену: frontend/src/lib/telegram/fileTicket.ts) и POST
functions/v1/telegram/webapp/session и /webapp/link (вход в мини-приложении Telegram:
frontend/src/api/telegramMiniApp.ts); заголовки запроса и ответа — по списку, тело — как есть.
Права те же, что при прямом запросе: anon-ключ и токен пользователя из его же заголовков, RLS
решает в базе. Ключи, токены и тела в журнал не пишутся.

Вход через Google сюда не проходит: Google возвращает браузер на адрес Supabase, заданный в
настройках провайдера.
"""
from __future__ import annotations

import hashlib
import os
from typing import Optional
from urllib.parse import unquote

import httpx
from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse

from slowapi.util import get_remote_address

from ratelimit import limiter

router = APIRouter()

# Тесты подменяют транспорт: supabase_proxy._transport = httpx.MockTransport(handler)
_transport: Optional[httpx.AsyncBaseTransport] = None
_client: Optional[httpx.AsyncClient] = None
_client_transport: Optional[httpx.AsyncBaseTransport] = None

ALLOWED_PREFIXES = ("auth/v1/", "rest/v1/", "storage/v1/")
# The bot's one-time file link (GET only): the bytes of a file forwarded to the bot, by a 60-second token.
FILE_PATH = "functions/v1/telegram/file"
FILE_METHODS = ("GET", "HEAD")
# The Mini App's sign-in (POST only, Telegram_Mini_App_Spec_2026-10-10): Telegram's signed initData → a one-time
# sign-in, and the link of an account signed in inside Telegram. The function checks the signature itself.
WEBAPP_PATHS = ("functions/v1/telegram/webapp/session", "functions/v1/telegram/webapp/link")
WEBAPP_METHODS = ("POST",)
METHODS = ["GET", "HEAD", "POST", "PATCH", "PUT", "DELETE"]
REQUEST_HEADERS = (
    "accept",
    "accept-profile",
    "apikey",
    "authorization",
    "cache-control",
    "content-profile",
    "content-type",
    "prefer",
    "range",
    "range-unit",
    "x-client-info",
    "x-supabase-api-version",
    "x-upsert",
)
RESPONSE_HEADERS = (
    "content-range",
    "content-type",
    "etag",
    "location",
    "preference-applied",
    "x-supabase-api-version",
)
FILE_RESPONSE_HEADERS = RESPONSE_HEADERS + (
    "cache-control",
    "content-disposition",
    "content-security-policy",
    "x-content-type-options",
)
WEBAPP_RESPONSE_HEADERS = RESPONSE_HEADERS + ("cache-control", "x-content-type-options")
TIMEOUT_SECONDS = 30.0
UNREACHABLE_DETAIL = "Сервер Meldy не смог связаться с базой данных. Повторите попытку через минуту."


def _upstream() -> Optional[str]:
    url = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
    return url if url.startswith("https://") else None


def _http() -> httpx.AsyncClient:
    """Один клиент на процесс: соединение с Supabase переиспользуется (без нового TLS на запрос)."""
    global _client, _client_transport
    if _client is None or _client_transport is not _transport:
        _client = httpx.AsyncClient(transport=_transport, timeout=TIMEOUT_SECONDS, follow_redirects=False)
        _client_transport = _transport
    return _client


def _raw_target(request: Request) -> Optional[str]:
    """The path and query after /sb/ exactly as the browser encoded them (PostgREST filters and
    storage names keep their escapes), or None when it is not an allowed Supabase path."""
    raw_path = request.scope.get("raw_path")
    raw = raw_path.decode("latin-1") if isinstance(raw_path, (bytes, bytearray)) else request.url.path
    if not raw.startswith("/sb/"):
        return None
    rest = raw[len("/sb/"):]
    decoded = unquote(rest)
    is_file = decoded == FILE_PATH and request.method in FILE_METHODS
    is_webapp = decoded in WEBAPP_PATHS and request.method in WEBAPP_METHODS
    if not (decoded.startswith(ALLOWED_PREFIXES) or is_file or is_webapp) or ".." in decoded.split("/") or "\\" in decoded:
        return None
    query = request.url.query
    return f"{rest}?{query}" if query else rest


def _caller_key(request: Request) -> str:
    """A signed-in browser by its session token; anonymous ones (the anon key as the bearer) by
    address — behind the HF proxy one address is shared by many people."""
    token = request.headers.get("authorization", "")
    if token[:7].lower() == "bearer " and token[7:].strip() and token[7:].strip() != request.headers.get("apikey", ""):
        return "sb:" + hashlib.sha256(token.encode("utf-8")).hexdigest()[:24]
    return "sb-ip:" + get_remote_address(request)


@router.api_route("/sb/{path:path}", methods=METHODS, include_in_schema=False)
@limiter.limit("600/minute", key_func=_caller_key)
async def supabase_passthrough(request: Request, path: str) -> Response:
    upstream = _upstream()
    target = _raw_target(request)
    if upstream is None or target is None:
        return JSONResponse({"message": "Not found"}, status_code=404)
    headers = {name: value for name, value in request.headers.items() if name.lower() in REQUEST_HEADERS}
    body = await request.body()
    try:
        answer = await _http().request(
            request.method,
            f"{upstream}/{target}",
            headers=headers,
            content=body or None,
        )
    except httpx.HTTPError as exc:
        print(f"Supabase passthrough failed: {type(exc).__name__}")
        return JSONResponse({"message": UNREACHABLE_DETAIL}, status_code=502)
    path_only = target.split("?", 1)[0]
    allowed = FILE_RESPONSE_HEADERS if path_only == FILE_PATH else WEBAPP_RESPONSE_HEADERS if path_only in WEBAPP_PATHS else RESPONSE_HEADERS
    kept = {name: value for name, value in answer.headers.items() if name.lower() in allowed}
    return Response(content=answer.content, status_code=answer.status_code, headers=kept)
