"""Асинхронный клиент PostgREST (Supabase) от имени пользователя.

Запросы идут с anon-ключом проекта (apikey) и токеном самого пользователя
(Authorization: Bearer …), поэтому действуют политики RLS: сервер видит и меняет
только то, что разрешено этому пользователю. Ключа service_role у backend нет и не
нужно. Синхронный клиент supabase внутри async-обработчиков не используем: он
блокирует цикл событий.

Использование:

    async with rest_for_request(request) as db:
        rows = await db.select("exam_questions", {"select": "id,text", "exam_id": f"eq.{exam_id}"})

Ошибки — SupabaseRestError (status, code). Текст исключения предназначен только для
журнала сервера: в нём нет тела ответа, данных строк и адресов; пользователю его не
показывают. RowLevelDenied — запрос прошёл, но не затронул ни одной строки там, где
строки были обязательны (чужая строка, политика RLS или условие не выполнилось).
"""

from __future__ import annotations

import json
import os
import re
from typing import Any

import httpx
from fastapi import HTTPException, Request

__all__ = [
    "RowLevelDenied",
    "SupabaseRest",
    "SupabaseRestError",
    "bearer_token",
    "rest_for_request",
]

# Тесты подменяют транспорт: supabase_rest._transport = httpx.MockTransport(handler)
_transport: httpx.AsyncBaseTransport | None = None

DEFAULT_TIMEOUT_SECONDS = 8.0
_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class SupabaseRestError(Exception):
    """Ошибка PostgREST или сети. status — HTTP-статус (503 сеть, 504 таймаут), code — код PostgREST/Postgres."""

    def __init__(self, status: int, code: str | None = None, message: str = "") -> None:
        self.status = int(status)
        self.code = code
        super().__init__(message or f"Supabase REST error {self.status}" + (f" ({code})" if code else ""))


class RowLevelDenied(SupabaseRestError):
    """Ни одной строки не затронуто там, где строки были обязательны."""


def bearer_token(request: Request) -> str:
    """Токен пользователя из заголовка Authorization: Bearer …; иначе 401."""
    authorization = request.headers.get("Authorization", "") if request is not None else ""
    scheme, _, token = authorization.partition(" ")
    token = token.strip()
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Требуется войти в аккаунт")
    return token


def rest_for_request(request: Request) -> "SupabaseRest":
    """Клиент от имени автора запроса (используйте через async with)."""
    return SupabaseRest(bearer_token(request))


def _env_timeout() -> float:
    raw = os.getenv("SUPABASE_REST_TIMEOUT_SECONDS", "").strip()
    try:
        value = float(raw) if raw else DEFAULT_TIMEOUT_SECONDS
    except ValueError:
        return DEFAULT_TIMEOUT_SECONDS
    return value if value > 0 else DEFAULT_TIMEOUT_SECONDS


def _base_url() -> str:
    url = (os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL") or "").strip().rstrip("/")
    if not url:
        raise SupabaseRestError(503, "not_configured", "SUPABASE_URL is not set")
    return f"{url}/rest/v1"


def _api_key() -> str:
    key = (
        os.getenv("SUPABASE_KEY")
        or os.getenv("VITE_SUPABASE_ANON_KEY")
        or os.getenv("VITE_SUPABASE_KEY")
        or ""
    ).strip()
    if not key:
        raise SupabaseRestError(503, "not_configured", "SUPABASE_KEY is not set")
    return key


def _checked_name(name: str, kind: str) -> str:
    if not isinstance(name, str) or not _NAME_RE.match(name):
        raise ValueError(f"invalid {kind} name")
    return name


def _params(values: dict[str, Any] | None) -> dict[str, str]:
    return {str(key): str(value) for key, value in (values or {}).items()}


class SupabaseRest:
    """Клиент PostgREST с токеном пользователя. Один httpx.AsyncClient на экземпляр."""

    def __init__(self, token: str, *, timeout: float | None = None) -> None:
        if not token or not str(token).strip():
            raise ValueError("token is required")
        self._token = str(token).strip()
        self._timeout = float(timeout) if timeout is not None and timeout > 0 else _env_timeout()
        self._client: httpx.AsyncClient | None = None

    async def __aenter__(self) -> "SupabaseRest":
        self._http()
        return self

    async def __aexit__(self, *exc_info: object) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        client, self._client = self._client, None
        if client is not None:
            await client.aclose()

    def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=self._timeout, transport=_transport)
        return self._client

    def _headers(self, prefer: list[str] | None = None, *, body: bool = False) -> dict[str, str]:
        headers = {
            "apikey": _api_key(),
            "Authorization": f"Bearer {self._token}",
            "Accept": "application/json",
        }
        if body:
            headers["Content-Type"] = "application/json"
        if prefer:
            headers["Prefer"] = ",".join(prefer)
        return headers

    async def _request(
        self,
        method: str,
        path: str,
        *,
        what: str,
        params: dict[str, str] | None = None,
        payload: Any = None,
        prefer: list[str] | None = None,
    ) -> Any:
        url = f"{_base_url()}/{path}"
        headers = self._headers(prefer, body=payload is not None)
        content = None if payload is None else json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8")
        try:
            response = await self._http().request(method, url, params=params or None, content=content, headers=headers)
        except httpx.TimeoutException:
            raise SupabaseRestError(504, "timeout", f"{what}: timeout") from None
        except httpx.HTTPError:
            raise SupabaseRestError(503, "network", f"{what}: network error") from None

        if response.status_code >= 400:
            code = _error_code(response)
            raise SupabaseRestError(
                response.status_code,
                code,
                f"{what}: HTTP {response.status_code}" + (f" ({code})" if code else ""),
            )
        if response.status_code == 204 or not response.content:
            return None
        try:
            return response.json()
        except ValueError:
            raise SupabaseRestError(502, "invalid_json", f"{what}: invalid JSON") from None

    # ── Чтение ───────────────────────────────────────────────────────────────

    async def select(self, table: str, params: dict[str, str]) -> list[dict]:
        """GET /table с параметрами в синтаксисе PostgREST: {"select": "id,title", "id": "eq.…"}."""
        name = _checked_name(table, "table")
        data = await self._request("GET", name, what=f"select {name}", params=_params(params))
        if data is None:
            return []
        if not isinstance(data, list):
            raise SupabaseRestError(502, "unexpected_shape", f"select {name}: not a list")
        return data

    async def select_one(self, table: str, params: dict[str, str]) -> dict | None:
        """Первая строка выборки или None (limit=1, если не задан)."""
        query = _params(params)
        query.setdefault("limit", "1")
        rows = await self.select(table, query)
        return rows[0] if rows else None

    # ── Запись ───────────────────────────────────────────────────────────────

    async def insert(
        self,
        table: str,
        rows: dict | list[dict],
        *,
        returning: bool = True,
        on_conflict: str | None = None,
        ignore_duplicates: bool = False,
    ) -> list[dict]:
        """POST /table.

        on_conflict без ignore_duplicates — upsert (resolution=merge-duplicates),
        с ignore_duplicates — конфликтующие строки пропускаются и не возвращаются.
        Для списка строк столбцы берутся из всех строк (columns=…), а недостающие
        значения заполняются умолчаниями столбцов (missing=default), а не NULL.
        """
        name = _checked_name(table, "table")
        if isinstance(rows, dict):
            payload: Any = rows
        elif isinstance(rows, list) and all(isinstance(row, dict) for row in rows):
            if not rows:
                return []
            payload = rows
        else:
            raise ValueError("rows must be a dict or a list of dicts")

        params: dict[str, str] = {}
        prefer = ["return=representation" if returning else "return=minimal"]
        if on_conflict:
            params["on_conflict"] = on_conflict
        if ignore_duplicates:
            prefer.append("resolution=ignore-duplicates")
        elif on_conflict:
            prefer.append("resolution=merge-duplicates")
        if isinstance(payload, list):
            columns: dict[str, None] = {}
            for row in payload:
                for key in row:
                    columns.setdefault(str(key), None)
            params["columns"] = ",".join(columns)
            prefer.append("missing=default")

        data = await self._request("POST", name, what=f"insert {name}", params=params, payload=payload, prefer=prefer)
        if not returning or data is None:
            return []
        if isinstance(data, dict):
            return [data]
        if not isinstance(data, list):
            raise SupabaseRestError(502, "unexpected_shape", f"insert {name}: not a list")
        return data

    async def update(
        self,
        table: str,
        filters: dict[str, str],
        values: dict,
        *,
        require_rows: bool = True,
    ) -> list[dict]:
        """PATCH /table?фильтры. Ноль затронутых строк при require_rows — RowLevelDenied."""
        name = _checked_name(table, "table")
        if not filters:
            raise ValueError("update without filters is not allowed")
        if not isinstance(values, dict) or not values:
            raise ValueError("values must be a non-empty dict")
        data = await self._request(
            "PATCH",
            name,
            what=f"update {name}",
            params=_params(filters),
            payload=values,
            prefer=["return=representation"],
        )
        rows = data if isinstance(data, list) else ([data] if isinstance(data, dict) else [])
        if require_rows and not rows:
            raise RowLevelDenied(404, "no_rows", f"update {name}: 0 rows affected")
        return rows

    async def rpc(self, fn: str, args: dict) -> object:
        """POST /rpc/fn с именованными аргументами; возвращает разобранный JSON (или None)."""
        name = _checked_name(fn, "function")
        return await self._request("POST", f"rpc/{name}", what=f"rpc {name}", payload=dict(args or {}))


def _error_code(response: httpx.Response) -> str | None:
    try:
        body = response.json()
    except ValueError:
        return None
    if isinstance(body, dict):
        code = body.get("code")
        if isinstance(code, (str, int)) and str(code).strip():
            return str(code).strip()[:32]
    return None
