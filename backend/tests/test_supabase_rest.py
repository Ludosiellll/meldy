import asyncio
import json
import sys
from pathlib import Path

import httpx
import pytest
from fastapi import HTTPException
from starlette.requests import Request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import supabase_rest  # noqa: E402
from supabase_rest import (  # noqa: E402
    RowLevelDenied,
    SupabaseRest,
    SupabaseRestError,
    bearer_token,
    rest_for_request,
)

URL = "https://project-ref.supabase.co"
ANON = "anon-public-key"
TOKEN = "user-jwt-token"


@pytest.fixture(autouse=True)
def env(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", URL + "/")
    monkeypatch.setenv("SUPABASE_KEY", ANON)
    monkeypatch.delenv("SUPABASE_REST_TIMEOUT_SECONDS", raising=False)
    yield
    supabase_rest._transport = None


def mock(handler):
    calls: list[httpx.Request] = []

    def recording(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return handler(request)

    supabase_rest._transport = httpx.MockTransport(recording)
    return calls


def run(coro):
    return asyncio.run(coro)


def make_request(authorization: str | None) -> Request:
    headers = [] if authorization is None else [(b"authorization", authorization.encode())]
    return Request({"type": "http", "method": "GET", "path": "/api/x", "headers": headers})


def body(request: httpx.Request):
    return json.loads(request.content.decode("utf-8"))


# ── Заголовки и чтение ──────────────────────────────────────────────────────


def test_select_sends_user_token_and_anon_key():
    calls = mock(lambda request: httpx.Response(200, json=[{"id": "q1", "text": "Вопрос"}]))

    async def scenario():
        async with SupabaseRest(TOKEN) as db:
            return await db.select("exam_questions", {"select": "id,text", "exam_id": "eq.e1", "order": "position.asc"})

    assert run(scenario()) == [{"id": "q1", "text": "Вопрос"}]
    request = calls[0]
    assert request.method == "GET"
    assert request.url.path == "/rest/v1/exam_questions"
    assert dict(request.url.params) == {"select": "id,text", "exam_id": "eq.e1", "order": "position.asc"}
    assert request.headers["authorization"] == f"Bearer {TOKEN}"
    assert request.headers["apikey"] == ANON
    assert str(request.url).startswith(URL + "/rest/v1/")


def test_select_one_adds_limit_and_returns_none_when_empty():
    calls = mock(lambda request: httpx.Response(200, json=[]))

    async def scenario():
        async with SupabaseRest(TOKEN) as db:
            return await db.select_one("exams", {"id": "eq.e1"})

    assert run(scenario()) is None
    assert calls[0].url.params["limit"] == "1"


def test_env_is_read_at_call_time(monkeypatch):
    calls = mock(lambda request: httpx.Response(200, json=[]))

    async def scenario():
        async with SupabaseRest(TOKEN) as db:
            await db.select("exams", {})
            monkeypatch.setenv("SUPABASE_URL", "https://other-ref.supabase.co")
            monkeypatch.setenv("SUPABASE_KEY", "rotated-key")
            await db.select("exams", {})

    run(scenario())
    assert calls[0].url.host == "project-ref.supabase.co"
    assert calls[1].url.host == "other-ref.supabase.co"
    assert calls[1].headers["apikey"] == "rotated-key"


def test_missing_configuration_is_a_503_error(monkeypatch):
    for name in ("SUPABASE_URL", "VITE_SUPABASE_URL"):
        monkeypatch.delenv(name, raising=False)
    mock(lambda request: httpx.Response(200, json=[]))

    async def scenario():
        async with SupabaseRest(TOKEN) as db:
            await db.select("exams", {})

    with pytest.raises(SupabaseRestError) as error:
        run(scenario())
    assert error.value.status == 503 and error.value.code == "not_configured"


# ── Запись ──────────────────────────────────────────────────────────────────


def test_insert_returns_rows_with_representation():
    calls = mock(lambda request: httpx.Response(201, json=[{"id": "x1", "title": "Экзамен"}]))

    async def scenario():
        async with SupabaseRest(TOKEN) as db:
            return await db.insert("exams", {"title": "Экзамен"})

    assert run(scenario()) == [{"id": "x1", "title": "Экзамен"}]
    request = calls[0]
    assert request.method == "POST"
    assert request.headers["prefer"] == "return=representation"
    assert request.headers["content-type"] == "application/json"
    assert body(request) == {"title": "Экзамен"}
    assert "on_conflict" not in request.url.params


def test_insert_ignore_duplicates_sets_conflict_headers():
    calls = mock(lambda request: httpx.Response(201, json=[]))

    async def scenario():
        async with SupabaseRest(TOKEN) as db:
            return await db.insert(
                "oral_rubrics",
                {"question_hash": "a" * 32, "source_key": "k" * 40},
                on_conflict="user_id,question_hash,source_key,rubric_version",
                ignore_duplicates=True,
            )

    assert run(scenario()) == []  # конфликтующая строка пропущена — вызывающий перечитает сохранённую
    request = calls[0]
    assert request.url.params["on_conflict"] == "user_id,question_hash,source_key,rubric_version"
    assert request.headers["prefer"].split(",") == ["return=representation", "resolution=ignore-duplicates"]


def test_insert_with_on_conflict_is_an_upsert():
    calls = mock(lambda request: httpx.Response(201, json=[{"id": "r1"}]))

    async def scenario():
        async with SupabaseRest(TOKEN) as db:
            await db.insert("oral_rubrics", {"id": "r1"}, on_conflict="id")

    run(scenario())
    assert calls[0].headers["prefer"].split(",") == ["return=representation", "resolution=merge-duplicates"]


def test_bulk_insert_sends_union_of_columns_and_missing_defaults():
    calls = mock(lambda request: httpx.Response(201, text=""))

    async def scenario():
        async with SupabaseRest(TOKEN) as db:
            return await db.insert(
                "exam_questions",
                [{"position": 1, "text": "Деньги"}, {"position": 2, "text": "Инфляция", "section": 2}],
                returning=False,
            )

    assert run(scenario()) == []
    request = calls[0]
    assert request.url.params["columns"] == "position,text,section"
    assert request.headers["prefer"].split(",") == ["return=minimal", "missing=default"]
    assert body(request)[1]["section"] == 2


def test_empty_bulk_insert_makes_no_request():
    calls = mock(lambda request: httpx.Response(201, json=[]))

    async def scenario():
        async with SupabaseRest(TOKEN) as db:
            return await db.insert("exam_questions", [])

    assert run(scenario()) == []
    assert calls == []


def test_update_patches_with_filters_and_returns_rows():
    calls = mock(lambda request: httpx.Response(200, json=[{"id": "e1", "mapping_state": "running"}]))
    filters = {"id": "eq.e1", "or": "(mapping_state.neq.running,mapping_started_at.lt.2026-10-03T08:00:00Z)"}

    async def scenario():
        async with SupabaseRest(TOKEN) as db:
            return await db.update("exams", filters, {"mapping_state": "running"})

    assert run(scenario()) == [{"id": "e1", "mapping_state": "running"}]
    request = calls[0]
    assert request.method == "PATCH"
    assert dict(request.url.params) == filters
    assert request.headers["prefer"] == "return=representation"
    assert body(request) == {"mapping_state": "running"}


def test_zero_row_patch_is_row_level_denied():
    mock(lambda request: httpx.Response(200, json=[]))

    async def scenario(require_rows: bool):
        async with SupabaseRest(TOKEN) as db:
            return await db.update("exam_questions", {"id": "eq.foreign"}, {"coverage": "full"}, require_rows=require_rows)

    with pytest.raises(RowLevelDenied) as error:
        run(scenario(True))
    assert isinstance(error.value, SupabaseRestError)
    assert run(scenario(False)) == []


def test_update_refuses_to_run_without_filters():
    mock(lambda request: httpx.Response(200, json=[]))

    async def scenario():
        async with SupabaseRest(TOKEN) as db:
            await db.update("exams", {}, {"title": "x"})

    with pytest.raises(ValueError):
        run(scenario())


def test_rpc_posts_named_arguments():
    calls = mock(lambda request: httpx.Response(200, json={"session_id": "s1", "duplicate": False}))

    async def scenario():
        async with SupabaseRest(TOKEN) as db:
            return await db.rpc("record_oral_attempt", {"p_attempt": {"attempt_id": "abc12345"}})

    assert run(scenario()) == {"session_id": "s1", "duplicate": False}
    assert calls[0].url.path == "/rest/v1/rpc/record_oral_attempt"
    assert body(calls[0]) == {"p_attempt": {"attempt_id": "abc12345"}}


def test_rpc_without_content_returns_none():
    mock(lambda request: httpx.Response(204))

    async def scenario():
        async with SupabaseRest(TOKEN) as db:
            return await db.rpc("touch", {})

    assert run(scenario()) is None


# ── Ошибки без утечек ───────────────────────────────────────────────────────


def test_http_errors_keep_status_and_code_without_body():
    secret = {"code": "23505", "message": "duplicate key", "details": "Key (user_id)=(секретный-id) already exists.", "hint": None}
    mock(lambda request: httpx.Response(409, json=secret))

    async def scenario():
        async with SupabaseRest(TOKEN) as db:
            await db.insert("exams", {"title": "x"})

    with pytest.raises(SupabaseRestError) as error:
        run(scenario())
    assert error.value.status == 409 and error.value.code == "23505"
    text = str(error.value)
    assert "секретный" not in text and "duplicate key" not in text and TOKEN not in text and URL not in text


def test_html_error_page_has_no_code():
    mock(lambda request: httpx.Response(502, text="<html>Bad gateway at upstream 10.0.0.5</html>"))

    async def scenario():
        async with SupabaseRest(TOKEN) as db:
            await db.select("exams", {})

    with pytest.raises(SupabaseRestError) as error:
        run(scenario())
    assert error.value.status == 502 and error.value.code is None
    assert "10.0.0.5" not in str(error.value)


def test_network_errors_and_timeouts_are_mapped():
    def failing(exc):
        def handler(request):
            raise exc
        return handler

    async def scenario():
        async with SupabaseRest(TOKEN) as db:
            await db.select("exams", {})

    mock(failing(httpx.ReadTimeout("slow", request=None)))
    with pytest.raises(SupabaseRestError) as error:
        run(scenario())
    assert (error.value.status, error.value.code) == (504, "timeout")

    mock(failing(httpx.ConnectError("refused secret-host", request=None)))
    with pytest.raises(SupabaseRestError) as error:
        run(scenario())
    assert (error.value.status, error.value.code) == (503, "network")
    assert "secret-host" not in str(error.value)


def test_invalid_json_is_a_502():
    mock(lambda request: httpx.Response(200, text="not json"))

    async def scenario():
        async with SupabaseRest(TOKEN) as db:
            await db.select("exams", {})

    with pytest.raises(SupabaseRestError) as error:
        run(scenario())
    assert (error.value.status, error.value.code) == (502, "invalid_json")


def test_names_are_validated():
    mock(lambda request: httpx.Response(200, json=[]))

    async def scenario():
        async with SupabaseRest(TOKEN) as db:
            await db.select("exams?select=*", {})

    with pytest.raises(ValueError):
        run(scenario())


# ── Токен, таймаут, жизненный цикл ──────────────────────────────────────────


def test_bearer_token_from_request():
    assert bearer_token(make_request(f"Bearer {TOKEN}")) == TOKEN
    assert bearer_token(make_request(f"bearer   {TOKEN} ")) == TOKEN
    for header in (None, "", "Basic abc", "Bearer ", "Token abc"):
        with pytest.raises(HTTPException) as error:
            bearer_token(make_request(header))
        assert error.value.status_code == 401
        assert error.value.detail == "Требуется войти в аккаунт"


def test_rest_for_request_uses_the_callers_token():
    calls = mock(lambda request: httpx.Response(200, json=[]))

    async def scenario():
        async with rest_for_request(make_request("Bearer caller-token")) as db:
            await db.select("exams", {})

    run(scenario())
    assert calls[0].headers["authorization"] == "Bearer caller-token"


def test_timeout_from_env_and_argument(monkeypatch):
    assert SupabaseRest(TOKEN)._timeout == 8.0
    monkeypatch.setenv("SUPABASE_REST_TIMEOUT_SECONDS", "2.5")
    assert SupabaseRest(TOKEN)._timeout == 2.5
    monkeypatch.setenv("SUPABASE_REST_TIMEOUT_SECONDS", "soon")
    assert SupabaseRest(TOKEN)._timeout == 8.0
    assert SupabaseRest(TOKEN, timeout=3)._timeout == 3.0
    with pytest.raises(ValueError):
        SupabaseRest("")


def test_context_manager_closes_its_client():
    mock(lambda request: httpx.Response(200, json=[]))

    async def scenario():
        db = SupabaseRest(TOKEN)
        async with db:
            client = db._client
            await db.select("exams", {})
        return db, client

    db, client = run(scenario())
    assert db._client is None and client.is_closed
