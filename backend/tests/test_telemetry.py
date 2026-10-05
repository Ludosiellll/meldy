"""First-party statistics (telemetry_api.py): POST /api/telemetry for signed-out and signed-in visitors,
what a batch keeps, 204 whatever happens downstream, 413 over 32 KB, the limits, the one public path, and
server_error events from the global exception handler and the analysis stream — in the background, with the
route pattern, the exception class and the error id, never the exception's text.

Supabase is a mocked httpx transport (supabase_rest._transport) standing in for the RPC log_app_events of
supabase/migrations/20261005042323_app_telemetry.sql.
"""
import asyncio
import base64
import io
import json
import sys
import time
from pathlib import Path

import httpx
import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import supabase_rest  # noqa: E402
import telemetry_api  # noqa: E402

URL = "https://telemetry-test.supabase.invalid"
ANON = "anon-test-key"
USER_A = "aaaaaaaa-0000-0000-0000-000000000001"
USER_B = "bbbbbbbb-0000-0000-0000-000000000002"


def jwt(sub: str) -> str:
    def part(data: dict) -> str:
        return base64.urlsafe_b64encode(json.dumps(data).encode()).decode().rstrip("=")

    return f"{part({'alg': 'HS256'})}.{part({'sub': sub, 'role': 'authenticated', 'exp': 4102444800})}.signature"


TOKEN_A = jwt(USER_A)
TOKEN_B = jwt(USER_B)


class RpcServer:
    """log_app_events in memory: who called (token) and what came."""

    def __init__(self):
        self.calls: list[tuple[str, list]] = []
        self.fail = None  # an HTTP status, an exception, "slow", or {token: status}

    def batches(self, token=None):
        return [events for who, events in self.calls if token is None or who == token]

    async def handler(self, request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/rest/v1/rpc/log_app_events", request.url.path
        assert request.headers.get("apikey") == ANON
        token = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
        body = json.loads(request.content)
        assert set(body) == {"p_events"}
        self.calls.append((token, body["p_events"]))
        if isinstance(self.fail, BaseException):
            raise self.fail
        if isinstance(self.fail, dict) and token in self.fail:
            return httpx.Response(self.fail[token], json={"code": "PGRST301", "message": "JWT expired"})
        if self.fail == "slow":
            await asyncio.sleep(1.5)
        elif isinstance(self.fail, int):
            return httpx.Response(self.fail, json={"code": "XX000", "message": "internal details"})
        return httpx.Response(200, json=len(body["p_events"]))


@pytest.fixture
def rpc(monkeypatch, telemetry_on):
    server = RpcServer()
    monkeypatch.setenv("SUPABASE_URL", URL)
    monkeypatch.setenv("SUPABASE_KEY", ANON)
    monkeypatch.setattr(supabase_rest, "_transport", httpx.MockTransport(server.handler))
    telemetry_api._REPORTED.clear()
    telemetry_api._SERVER_ERROR_TIMES.clear()
    yield server
    telemetry_api._REPORTED.clear()
    telemetry_api._SERVER_ERROR_TIMES.clear()


@pytest.fixture
def api(rpc, monkeypatch):
    """The real app; a session check that names the user of TOKEN_A / TOKEN_B and counts its calls."""
    import main
    from fastapi.testclient import TestClient

    checks = []

    async def fake_user(request):
        token = request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
        checks.append(token)
        users = {TOKEN_A: USER_A, TOKEN_B: USER_B}
        if token not in users:
            raise HTTPException(status_code=401, detail="Требуется войти в аккаунт")
        return {"id": users[token]}

    monkeypatch.setattr(main, "require_authenticated_user", fake_user)
    monkeypatch.setattr(main.limiter, "enabled", False)
    with TestClient(main.app, raise_server_exceptions=False) as client:
        client.rpc = rpc
        client.checks = checks
        client.main = main
        yield client
        client.portal.call(telemetry_api.drain_background)


def post(client, events, headers=None, raw=None):
    content = raw if raw is not None else json.dumps({"events": events})
    return client.post("/api/telemetry", content=content, headers={"Content-Type": "application/json", **(headers or {})})


def page_view(**extra):
    return {"kind": "event", "name": "page_view", "route": "/try", "session": "sessTest0001", "device": "mobile",
            "app_version": "20261005.1200", **extra}


# ── The public path ─────────────────────────────────────────────────────────────


def test_signed_out_visitor_is_forwarded_with_the_anon_key_without_a_session_check(api):
    response = post(api, [page_view()])
    assert response.status_code == 204 and response.content == b""
    assert api.rpc.calls == [(ANON, [page_view()])]
    assert api.checks == []


def test_signed_in_visitor_is_forwarded_with_their_own_token_without_a_session_check(api):
    response = post(api, [page_view()], headers={"Authorization": f"Bearer {TOKEN_A}"})
    assert response.status_code == 204
    assert api.rpc.calls == [(TOKEN_A, [page_view()])]
    assert api.checks == []  # the database verifies the token itself


def test_only_the_telemetry_path_is_public(api):
    for path in ("/api/telemetry/", "/api/telemetryx", "/api/telemetry/extra"):
        assert api.post(path, content="{}").status_code == 401, path
    assert api.get("/api/telemetry").status_code == 405  # public, but only POST exists
    assert api.rpc.calls == []


def test_an_expired_session_still_counts_without_the_account(api):
    api.rpc.fail = {TOKEN_A: 401}
    response = post(api, [page_view()], headers={"Authorization": f"Bearer {TOKEN_A}"})
    assert response.status_code == 204
    assert [token for token, _ in api.rpc.calls] == [TOKEN_A, ANON]


@pytest.mark.parametrize("failure", [500, 404, 403, httpx.ConnectError("down"), "slow"])
def test_failures_downstream_are_204_and_logged_once(api, failure, monkeypatch, capsys):
    monkeypatch.setattr(telemetry_api, "RPC_TIMEOUT_SECONDS", 0.2)
    api.rpc.fail = failure
    for _ in range(2):
        assert post(api, [page_view()]).status_code == 204
    lines = [line for line in capsys.readouterr().out.splitlines() if line.startswith("Telemetry:")]
    assert len(lines) == 1 and "internal details" not in lines[0]
    assert len(api.rpc.calls) == 2  # an anonymous refusal is not retried


def test_the_off_switch_forwards_nothing(api, monkeypatch):
    monkeypatch.setenv("TELEMETRY_DISABLED", "1")
    assert post(api, [page_view()]).status_code == 204
    assert api.rpc.calls == []


# ── What a batch keeps ──────────────────────────────────────────────────────────


def test_a_batch_is_checked_before_it_is_forwarded(api):
    events = [
        page_view(user_id=USER_B, message="events carry no message", stack="nor a stack", ip="10.0.0.1",
                  props={"partial": False, "n": 3, "ratio": 0.5, "none": None, "long": "x" * 200,
                         "nested": {"a": 1}, "list": [1], "Bad Key": 1, "inf": float("inf"), "last": 1}),
        {"kind": "client_error", "name": "window_error", "message": "  TypeError: a is undefined  ",
         "stack": "s" * 5000, "route": "/exams/1?q=секрет", "session": "bad session!", "device": "phone"},
        {"kind": "server_error", "name": "unhandled", "message": "forged by a browser"},
        {"kind": "event", "name": "Page View"},
        {"kind": "metric", "name": "page_view"},
        {"kind": "event", "name": "x" * 61},
        {"kind": "event", "name": "page_view\n"},
        "not an object",
        None,
    ]
    assert post(api, events).status_code == 204
    [(token, forwarded)] = api.rpc.calls
    assert token == ANON
    assert forwarded[0] == {
        "kind": "event", "name": "page_view", "route": "/try", "session": "sessTest0001", "device": "mobile",
        "app_version": "20261005.1200",
        "props": {"partial": False, "n": 3, "ratio": 0.5, "none": None, "long": "x" * 80, "last": 1},
    }
    assert forwarded[1] == {"kind": "client_error", "name": "window_error", "message": "TypeError: a is undefined",
                            "stack": "s" * 4000}
    assert len(forwarded) == 2


def test_only_the_first_fifty_events_are_looked_at(api):
    events = [{"kind": "event", "name": "bulk", "props": {"i": i}} for i in range(60)]
    assert post(api, events).status_code == 204
    [(_, forwarded)] = api.rpc.calls
    assert [event["props"]["i"] for event in forwarded] == list(range(50))


def test_props_over_two_kilobytes_are_dropped():
    props = {f"key_{i:02d}": "я" * 80 for i in range(12)}  # 12 × (160 bytes of text + key) > 2048
    assert telemetry_api.clean_props(props) == {}
    smaller = {f"key_{i:02d}": "я" * 80 for i in range(11)}
    assert telemetry_api.clean_props(smaller) == smaller
    assert telemetry_api.clean_props({f"k{i}": i for i in range(20)}) == {f"k{i}": i for i in range(12)}


def test_bodies_over_32_kb_are_413_and_anything_unreadable_is_204(api):
    big = json.dumps({"events": [page_view(props={"pad": "x" * 80})] * 400})
    assert len(big.encode()) > telemetry_api.MAX_BODY_BYTES
    assert post(api, None, raw=big).status_code == 413
    for raw in ("not json", "[]", '{"events": {}}', '{"events": "x"}', "[" * 20000, ""):
        assert post(api, None, raw=raw).status_code == 204, raw[:20]
    assert api.rpc.calls == []


def test_a_body_without_content_length_is_still_capped(api):
    def chunks():
        for _ in range(40):
            yield b"x" * 1024

    response = api.post("/api/telemetry", content=chunks(), headers={"Content-Type": "application/json"})
    assert response.status_code == 413 and api.rpc.calls == []


# ── Limits ──────────────────────────────────────────────────────────────────────


def test_rate_limit_per_session_per_account_and_per_address(api, monkeypatch):
    main = api.main
    monkeypatch.setattr(main.limiter, "enabled", True)
    main.limiter.reset()
    try:
        session = {"X-Meldy-Session": "sessLimit0001"}
        statuses = [post(api, [page_view()], headers=session).status_code for _ in range(31)]
        assert statuses[:30] == [204] * 30 and statuses[30] == 429
        assert post(api, [page_view()], headers={"X-Meldy-Session": "sessLimit0002"}).status_code == 204
        statuses = [post(api, [page_view()], headers={"Authorization": f"Bearer {TOKEN_A}"}).status_code
                    for _ in range(31)]
        assert statuses[30] == 429
        assert post(api, [page_view()], headers={"Authorization": f"Bearer {TOKEN_B}"}).status_code == 204
        # A signed-out visitor without a session id is limited by address.
        statuses = [post(api, [page_view()]).status_code for _ in range(31)]
        assert statuses[30] == 429
    finally:
        main.limiter.reset()


def test_rate_limit_keys():
    from starlette.requests import Request

    def request(headers):
        scope = {"type": "http", "method": "POST", "path": "/api/telemetry", "query_string": b"",
                 "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()], "client": ("1.2.3.4", 1)}
        return Request(scope)

    assert telemetry_api.telemetry_rate_key(request({"Authorization": f"Bearer {TOKEN_A}"})) == f"user:{USER_A}"
    assert telemetry_api.telemetry_rate_key(request({"X-Meldy-Session": "abcDEF_123-x"})) == "session:abcDEF_123-x"
    assert telemetry_api.telemetry_rate_key(request({"X-Meldy-Session": "bad session"})) == "1.2.3.4"
    assert telemetry_api.telemetry_rate_key(request({"Authorization": "Bearer not-a-jwt"})) == "1.2.3.4"
    assert telemetry_api.telemetry_rate_key(request({"Authorization": f"Bearer {jwt('not-a-uuid')}"})) == "1.2.3.4"


# ── Server errors ───────────────────────────────────────────────────────────────


def test_an_unhandled_exception_is_reported_in_the_background(api):
    main = api.main

    async def boom(item_id: str):
        raise ValueError(f"secret user text {item_id}")

    main.app.add_api_route("/api/test-telemetry-boom/{item_id}", boom, methods=["GET"])
    route = main.app.router.routes[-1]
    try:
        api.rpc.fail = "slow"
        started = time.monotonic()
        response = api.get("/api/test-telemetry-boom/0f8c3c1e-5d2a-4a3b-9c1d-2e3f4a5b6c7d",
                           headers={"Authorization": f"Bearer {TOKEN_A}"})
        elapsed = time.monotonic() - started
        assert response.status_code == 500
        error_id = response.json()["error_id"]
        assert elapsed < 1.0  # the report did not hold the answer (the RPC takes 1.5 s)
        api.portal.call(telemetry_api.drain_background)
    finally:
        main.app.router.routes.remove(route)
    [(token, [event])] = api.rpc.calls
    assert token == TOKEN_A
    assert event["kind"] == "server_error" and event["name"] == "unhandled"
    assert event["route"] == "/api/test-telemetry-boom/{item_id}"
    assert event["props"] == {"error_id": error_id, "exception": "ValueError"}
    assert event["message"] == "ValueError"
    assert "tests/test_telemetry.py:" in event["stack"] and "in boom" in event["stack"]
    flat = json.dumps(event)
    assert "secret" not in flat and "0f8c3c1e" not in flat


def test_a_failed_analysis_stream_is_reported_with_its_route_and_the_users_token(api, monkeypatch):
    from agents.coordinator import CoordinatorAgent

    async def broken(self, text, **kwargs):
        yield {"type": "grounding", "source_count": 0, "sources": []}
        raise RuntimeError("boom secret https://provider.invalid")

    monkeypatch.setattr(CoordinatorAgent, "process", broken)
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-key")
    response = api.post(
        "/api/analyze",
        files={"file": ("lecture.txt", io.BytesIO("Инфляция — рост цен.".encode()), "text/plain")},
        headers={"Authorization": f"Bearer {TOKEN_B}"},
    )
    events = [json.loads(line[len("data: "):]) for line in response.text.splitlines() if line.startswith("data: ")]
    assert response.status_code == 200 and events[-1]["type"] == "error" and events[-1]["code"] == "internal"
    shown_id = events[-1]["message"].rsplit("Код ошибки: ", 1)[1]
    api.portal.call(telemetry_api.drain_background)
    [(token, [event])] = api.rpc.calls
    assert token == TOKEN_B
    assert event["name"] == "analysis_stream" and event["route"] == "/api/analyze"
    assert event["props"] == {"error_id": shown_id, "exception": "RuntimeError"}
    assert "secret" not in json.dumps(event) and "provider.invalid" not in json.dumps(event)


def test_report_server_error_never_raises_and_keeps_to_its_budget(rpc):
    telemetry_api.report_server_error("unhandled", "abc123abc123", RuntimeError("x"))  # no event loop: dropped quietly

    async def burst():
        for index in range(telemetry_api.SERVER_ERRORS_PER_MINUTE + 5):
            telemetry_api.report_server_error("unhandled", f"{index:012x}")
        await telemetry_api.drain_background()

    telemetry_api._SERVER_ERROR_TIMES.clear()
    asyncio.run(burst())
    assert len(rpc.calls) == telemetry_api.SERVER_ERRORS_PER_MINUTE


def test_server_error_event_shape():
    try:
        {}["missing"]
    except KeyError as exc:
        event = telemetry_api.server_error_event("bad name!", "not-hex", exc, {"route": None})
    assert event["name"] == "server_error" and event["props"] == {"exception": "KeyError"}
    assert "route" not in event and event["message"] == "KeyError"
    assert event["stack"].startswith("tests/test_telemetry.py:")
    assert telemetry_api.exception_name(httpx.ReadTimeout("t")) == "httpx.ReadTimeout"
    assert telemetry_api.route_pattern({"path": "/api/exams/0f8c3c1e"}) is None
    assert telemetry_api.code_frames(None) is None


def test_the_router_is_mounted_with_the_shared_limiter():
    import main
    import ratelimit

    assert main.telemetry_api is telemetry_api
    # FastAPI >= 0.142 keeps an included router live; older versions copy its routes.
    mounted = any(getattr(route, "original_router", None) is telemetry_api.router for route in main.app.routes)
    copied = any(getattr(route, "path", None) == "/api/telemetry" for route in main.app.routes)
    assert mounted or copied
    assert telemetry_api.limiter is ratelimit.limiter
