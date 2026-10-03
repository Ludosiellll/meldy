"""Session cache (stale-while-revalidate), /api/health, /api/diagnostics/models, shared routers and limiter."""
import asyncio
import base64
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agents import base  # noqa: E402
from agents.base import BaseAgent  # noqa: E402


def b64(data: dict) -> str:
    return base64.urlsafe_b64encode(json.dumps(data).encode()).decode().rstrip("=")


def jwt(exp: float, sub: str = "user-1") -> str:
    return f"{b64({'alg': 'HS256', 'typ': 'JWT'})}.{b64({'sub': sub, 'exp': int(exp)})}.signature"


class FakeSupabase:
    """httpx transport for /auth/v1/user that counts calls; ``gate`` can hold a call open."""

    def __init__(self):
        self.calls = 0
        self.status = 200
        self.user = {"id": "user-1", "email": "student@example.com"}
        self.gate = None

    async def handler(self, request: httpx.Request) -> httpx.Response:
        self.calls += 1
        assert request.url.path == "/auth/v1/user"
        assert request.headers["authorization"].startswith("Bearer ")
        if self.gate is not None:
            await self.gate.wait()
        if self.status == "network":
            raise httpx.ConnectError("down", request=request)
        if self.status == 200:
            return httpx.Response(200, json=self.user)
        return httpx.Response(self.status, json={"msg": "bad token"})


class Clock:
    def __init__(self, now: float):
        self.now = now

    def __call__(self) -> float:
        return self.now


@pytest.fixture
def auth(monkeypatch):
    import main

    supabase = FakeSupabase()
    mono, wall = Clock(1000.0), Clock(1_800_000_000.0)
    monkeypatch.setattr(main, "_auth_transport", httpx.MockTransport(supabase.handler))
    monkeypatch.setattr(main, "_auth_clock", mono)
    monkeypatch.setattr(main, "_auth_wall_clock", wall)
    monkeypatch.delenv("AUTH_CACHE_MAX_SECONDS", raising=False)
    monkeypatch.delenv("AUTH_REVALIDATE_SECONDS", raising=False)
    main._auth_cache.clear()
    main._auth_revalidations.clear()
    yield SimpleNamespace(main=main, supabase=supabase, mono=mono, wall=wall)
    main._auth_cache.clear()
    main._auth_revalidations.clear()


def request_with(token: str):
    from starlette.requests import Request

    return Request({"type": "http", "method": "GET", "path": "/api/x", "query_string": b"",
                    "headers": [(b"authorization", f"Bearer {token}".encode())]})


async def check(main, token):
    return await main.require_authenticated_user(request_with(token))


async def settle(main):
    tasks = [task for task in main._auth_revalidations.values()]
    if tasks:
        await asyncio.gather(*tasks)


def test_two_requests_within_a_minute_make_one_auth_call(auth):
    token = jwt(auth.wall.now + 3600)

    async def scenario():
        first = await check(auth.main, token)
        auth.mono.now += 30
        second = await check(auth.main, token)
        return first, second

    first, second = asyncio.run(scenario())
    assert first == second == auth.supabase.user
    assert auth.supabase.calls == 1


def test_stale_entry_is_served_at_once_and_revalidated_once_in_the_background(auth):
    token = jwt(auth.wall.now + 3600)

    async def scenario():
        await check(auth.main, token)
        auth.mono.now += 61
        auth.supabase.gate = asyncio.Event()  # the background check hangs until released
        served = await asyncio.wait_for(check(auth.main, token), timeout=1)
        again = await asyncio.wait_for(check(auth.main, token), timeout=1)
        await asyncio.sleep(0)
        in_flight = auth.supabase.calls
        auth.supabase.gate.set()
        await settle(auth.main)
        return served, again, in_flight

    served, again, in_flight = asyncio.run(scenario())
    assert served == again == auth.supabase.user
    assert in_flight == 2  # single flight: one background call for two stale hits
    assert auth.supabase.calls == 2

    async def later():
        auth.mono.now += 30  # the revalidation refreshed the entry
        await check(auth.main, token)

    asyncio.run(later())
    assert auth.supabase.calls == 2


def test_revalidation_401_evicts_the_entry(auth):
    token = jwt(auth.wall.now + 3600)

    async def scenario():
        await check(auth.main, token)
        auth.mono.now += 120
        auth.supabase.status = 401
        served = await check(auth.main, token)
        await settle(auth.main)
        return served

    assert asyncio.run(scenario()) == auth.supabase.user
    assert auth.main._auth_cache == {}
    with pytest.raises(HTTPException) as info:
        asyncio.run(check(auth.main, token))
    assert info.value.status_code == 401
    assert auth.supabase.calls == 3


def test_failed_revalidation_keeps_serving_until_the_maximum_age(auth):
    token = jwt(auth.wall.now + 3600)

    async def scenario():
        await check(auth.main, token)
        auth.mono.now += 100
        auth.supabase.status = "network"
        await check(auth.main, token)
        await settle(auth.main)
        auth.mono.now += 100
        return await check(auth.main, token)

    assert asyncio.run(scenario()) == auth.supabase.user
    auth.mono.now += 101  # 301 s after the last successful check
    with pytest.raises(HTTPException) as info:
        asyncio.run(check(auth.main, token))
    assert info.value.status_code == 503


def test_entries_older_than_the_maximum_are_checked_again(auth):
    token = jwt(auth.wall.now + 3600)
    asyncio.run(check(auth.main, token))
    auth.mono.now += 301
    asyncio.run(check(auth.main, token))
    assert auth.supabase.calls == 2


def test_an_expired_token_is_never_served_from_the_cache(auth):
    token = jwt(auth.wall.now + 30)
    asyncio.run(check(auth.main, token))
    auth.mono.now += 31
    auth.wall.now += 31
    asyncio.run(check(auth.main, token))
    assert auth.supabase.calls == 2
    assert auth.main._auth_cache == {}  # past its exp: not stored again

    already_expired = jwt(auth.wall.now - 1)
    asyncio.run(check(auth.main, already_expired))
    asyncio.run(check(auth.main, already_expired))
    assert auth.supabase.calls == 4


def test_failures_are_never_cached(auth):
    token = jwt(auth.wall.now + 3600)
    auth.supabase.status = 401
    for _ in range(2):
        with pytest.raises(HTTPException) as info:
            asyncio.run(check(auth.main, token))
        assert info.value.status_code == 401
    auth.supabase.status = "network"
    with pytest.raises(HTTPException) as info:
        asyncio.run(check(auth.main, token))
    assert info.value.status_code == 503
    auth.supabase.status = 500
    with pytest.raises(HTTPException) as info:
        asyncio.run(check(auth.main, token))
    assert info.value.status_code == 503
    assert auth.supabase.calls == 4 and auth.main._auth_cache == {}


def test_tokens_without_exp_are_not_cached_and_keys_are_hashes(auth):
    asyncio.run(check(auth.main, "opaque-token"))
    asyncio.run(check(auth.main, "opaque-token"))
    assert auth.supabase.calls == 2
    token = jwt(auth.wall.now + 3600)
    asyncio.run(check(auth.main, token))
    assert token not in json.dumps(list(auth.main._auth_cache.keys()))
    assert all(len(key) == 64 for key in auth.main._auth_cache)


def test_missing_header_is_401_without_calling_supabase(auth):
    from starlette.requests import Request

    request = Request({"type": "http", "method": "GET", "path": "/api/x", "query_string": b"", "headers": []})
    with pytest.raises(HTTPException) as info:
        asyncio.run(auth.main.require_authenticated_user(request))
    assert info.value.status_code == 401 and auth.supabase.calls == 0


def test_cache_through_the_middleware(auth, monkeypatch):
    from fastapi.testclient import TestClient

    monkeypatch.setattr(auth.main.limiter, "enabled", False)
    monkeypatch.setenv("DIAGNOSTICS_USER_IDS", "")
    client = TestClient(auth.main.app)
    headers = {"Authorization": f"Bearer {jwt(auth.wall.now + 3600)}"}
    assert client.get("/api/diagnostics/models", headers=headers).status_code == 403
    assert client.get("/api/diagnostics/models", headers=headers).status_code == 403
    assert auth.supabase.calls == 1
    assert client.get("/api/diagnostics/models").status_code == 401


# --- /api/health ---------------------------------------------------------------------------

def test_health_is_public_and_unchanged(auth, monkeypatch):
    from fastapi.testclient import TestClient

    monkeypatch.setenv("GEMINI_API_KEY", "")
    response = TestClient(auth.main.app).get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "groq_configured": bool(auth.main.GROQ_API_KEY), "gemini_configured": False}
    monkeypatch.setenv("GEMINI_API_KEY", "key")
    assert TestClient(auth.main.app).get("/api/health").json()["gemini_configured"] is True
    assert auth.supabase.calls == 0


# --- /api/diagnostics/models ---------------------------------------------------------------

class FakePager:
    def __init__(self, names):
        self.names = names

    def __aiter__(self):
        async def gen():
            for name in self.names:
                yield SimpleNamespace(name=f"models/{name}", supported_actions=["generateContent"])
            yield SimpleNamespace(name="models/embedding-001", supported_actions=["embedContent"])

        return gen()


def install_diagnostic_fakes(monkeypatch, missing=("gemini-2.0-flash",)):
    calls = []

    class FakeClient:
        def __init__(self, api_key=None, **kwargs):
            async def generate_content(*, model, contents, config):
                calls.append({"key": api_key, "model": model, "config": config, "contents": contents})
                if model in missing:
                    from google.genai import errors

                    raise errors.ClientError(404, {"error": {"code": 404, "message": f"models/{model} not found for key {api_key}", "status": "NOT_FOUND"}})
                await asyncio.sleep(0.001)
                return SimpleNamespace(text='{"ok": true}', candidates=[SimpleNamespace(finish_reason="STOP")])

            async def list_models(config=None):
                return FakePager(["gemini-2.5-flash-lite", "gemini-2.5-flash"])

            self.aio = SimpleNamespace(models=SimpleNamespace(generate_content=generate_content, list=list_models))

    class FakeGroq:
        def __init__(self, api_key=None, **kwargs):
            async def create(**kwargs):
                calls.append({"groq": kwargs["model"]})
                return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content='{"ok": true}'), finish_reason="stop")])

            self.chat = SimpleNamespace(completions=SimpleNamespace(create=create))

    monkeypatch.setattr(base.genai, "Client", FakeClient)
    monkeypatch.setattr(base, "AsyncGroq", FakeGroq)
    base._GENAI_CLIENTS.clear()
    base._GROQ_CLIENTS.clear()
    return calls


@pytest.fixture
def diag(monkeypatch):
    import main
    from fastapi.testclient import TestClient

    async def fake_user(request):
        return {"id": request.headers.get("X-Test-User", "owner-1")}

    monkeypatch.setattr(main, "require_authenticated_user", fake_user)
    monkeypatch.setattr(main.limiter, "enabled", False)
    monkeypatch.setenv("DIAGNOSTICS_USER_IDS", "someone-else, owner-1")
    monkeypatch.setenv("GEMINI_API_KEY", "secret-key-AAAA1111,secret-key-BBBB2222")
    monkeypatch.setenv("GEMINI_MODELS", "gemini-2.5-flash-lite,gemini-2.0-flash")
    monkeypatch.setenv("GEMINI_FAST_MODELS", "gemini-2.5-flash-lite")
    monkeypatch.setattr(main, "GROQ_API_KEY", "groq-secret-CCCC3333")
    BaseAgent._run_cache.clear()
    yield TestClient(main.app)
    base._GENAI_CLIENTS.clear()
    base._GROQ_CLIENTS.clear()
    base._MODEL_SKIP.clear()


def test_diagnostics_is_403_outside_the_owner_list(diag, monkeypatch):
    calls = install_diagnostic_fakes(monkeypatch)
    response = diag.get("/api/diagnostics/models", headers={"X-Test-User": "student-7"})
    assert response.status_code == 403 and response.json() == {"detail": "Недоступно"}
    monkeypatch.setenv("DIAGNOSTICS_USER_IDS", "")
    assert diag.get("/api/diagnostics/models").status_code == 403
    assert calls == []


def test_diagnostics_reports_models_with_error_kinds_only(diag, monkeypatch):
    calls = install_diagnostic_fakes(monkeypatch)
    # A model on the skip list is still called by diagnostics.
    base.skip_model("gemini", "secret-key-AAAA1111", "gemini-2.0-flash")
    response = diag.get("/api/diagnostics/models")
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"checked_at", "gemini", "groq", "agent_fast", "auth_cache", "probe"}
    gemini = body["gemini"]
    assert gemini["configured"] is True and gemini["keys"] == 2
    assert gemini["models_env"] == ["gemini-2.5-flash-lite", "gemini-2.0-flash"]
    assert gemini["fast_models_env"] == ["gemini-2.5-flash-lite"]
    assert gemini["listed"] == ["gemini-2.5-flash-lite", "gemini-2.5-flash"] and gemini["list_error"] is None
    assert gemini["key_checks"] == [{"key_index": 0, "ok": True, "error": None}, {"key_index": 1, "ok": True, "error": None}]
    by_model = {call["model"]: call for call in gemini["calls"]}
    assert by_model["gemini-2.5-flash-lite"]["fast"] is True and by_model["gemini-2.5-flash-lite"]["thinking"] == "off"
    assert by_model["gemini-2.5-flash-lite"]["ok"] is True and by_model["gemini-2.5-flash-lite"]["finish_reason"] == "STOP"
    assert isinstance(by_model["gemini-2.5-flash-lite"]["ms"], int)
    assert by_model["gemini-2.0-flash"] == {"model": "gemini-2.0-flash", "fast": False, "thinking": "none", "ok": False,
                                           "ms": by_model["gemini-2.0-flash"]["ms"], "finish_reason": None, "error": "not_found"}
    assert body["groq"] == {"configured": True, "model": "llama-3.3-70b-versatile", "fast_model": "llama-3.3-70b-versatile",
                            "ok": True, "ms": body["groq"]["ms"], "error": None}
    assert body["agent_fast"]["ok"] is True and body["agent_fast"]["provider"] == "gemini"
    assert body["agent_fast"]["model"] == "gemini-2.5-flash-lite"
    assert body["auth_cache"] == {"max_seconds": 300.0, "revalidate_seconds": 60.0, "entries": body["auth_cache"]["entries"]}
    assert body["probe"] is None
    for secret in ("secret-key", "AAAA1111", "BBBB2222", "CCCC3333", "https://", "not found for key"):
        assert secret not in response.text
    # Diagnostics calls are never cached.
    assert BaseAgent._run_cache == {}
    flash_lite_calls = [call for call in calls if call.get("model") == "gemini-2.5-flash-lite"]
    assert flash_lite_calls[0]["config"].max_output_tokens <= 200 + 2048


def test_diagnostics_oral_probe_reports_latency_percentiles(diag, monkeypatch):
    calls = install_diagnostic_fakes(monkeypatch)
    response = diag.get("/api/diagnostics/models?probe=oral")
    assert response.status_code == 200
    probe = response.json()["probe"]
    assert probe["check"]["n"] == 5 and probe["check"]["errors"] == 0
    assert probe["evaluate"]["n"] == 2 and probe["evaluate"]["errors"] == 0
    for series in probe.values():
        assert isinstance(series["p50_ms"], int) and isinstance(series["p95_ms"], int)
        assert series["p50_ms"] <= series["p95_ms"]
    evaluate_calls = [call for call in calls if "ЭТАЛОН (с цитатами из лекции)" in str(call.get("contents", ""))]
    check_calls = [call for call in calls if "ПУНКТЫ ЭТАЛОНА" in str(call.get("contents", ""))]
    assert len(evaluate_calls) == 2 and len(check_calls) == 5
    assert all(call["config"].max_output_tokens == 1500 + 512 for call in evaluate_calls)  # thinking 'low'
    assert all(call["config"].thinking_config.thinking_budget == 0 for call in check_calls)  # fast: thinking off
    assert all(call["config"].max_output_tokens == 200 for call in check_calls)


def test_percentiles_use_nearest_rank():
    import main

    assert main._percentile_ms([], 50) is None
    assert main._percentile_ms([300, 100, 200, 500, 400], 50) == 300
    assert main._percentile_ms([300, 100, 200, 500, 400], 95) == 500
    assert main._percentile_ms([100, 900], 50) == 100 and main._percentile_ms([100, 900], 95) == 900


# --- shared limiter and the wave-2 routers ------------------------------------------------------

def _mounted(app, router) -> bool:
    """FastAPI >= 0.142 keeps an included router live; older versions copy its routes."""
    for route in app.routes:
        if getattr(route, "original_router", None) is router:
            return True
    paths = {(getattr(route, "path", None), frozenset(getattr(route, "methods", None) or ())) for route in app.routes}
    return all((route.path, frozenset(route.methods or ())) in paths for route in router.routes)


def test_router_modules_are_mounted_and_share_the_limiter(monkeypatch):
    import exams_api
    import main
    import oral_api
    import ratelimit
    import uploads
    from fastapi import APIRouter, FastAPI, Request
    from fastapi.testclient import TestClient
    from slowapi.errors import RateLimitExceeded

    assert main.limiter is ratelimit.limiter and main.app.state.limiter is ratelimit.limiter
    assert main.user_or_ip_key is ratelimit.user_or_ip_key
    assert main.read_upload_with_limit is uploads.read_upload_with_limit
    assert main.exams_router is exams_api.router and main.oral_router is oral_api.router
    assert _mounted(main.app, exams_api.router) and _mounted(main.app, oral_api.router)

    # A route declared in a router module with the shared limiter, mounted like main mounts them.
    router = APIRouter()

    @router.get("/api/test-shared-limit")
    @ratelimit.limiter.limit("1/minute", key_func=ratelimit.user_or_ip_key)
    async def shared_limit_probe(request: Request):
        return {"ok": True}

    app = FastAPI()
    app.state.limiter = main.limiter
    app.add_exception_handler(RateLimitExceeded, ratelimit.rate_limit_exceeded_handler)
    app.include_router(router)
    client = TestClient(app)
    try:
        monkeypatch.setattr(main.limiter, "enabled", False)
        assert [client.get("/api/test-shared-limit").status_code for _ in range(3)] == [200, 200, 200]
        monkeypatch.setattr(main.limiter, "enabled", True)
        main.limiter.reset()
        assert client.get("/api/test-shared-limit").status_code == 200
        limited = client.get("/api/test-shared-limit")
        assert limited.status_code == 429
        assert limited.json() == {"detail": "Слишком много запросов. Подождите минуту и повторите."}
        assert int(limited.headers["retry-after"]) >= 1
    finally:
        main.limiter.reset()
