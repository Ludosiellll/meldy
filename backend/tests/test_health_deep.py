"""GET /api/health/deep: public, real tiny calls (mocked here), 10-minute cache, no secrets in the answer."""
import asyncio
import json
import sys
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import health_deep  # noqa: E402
from agents import base  # noqa: E402

GEMINI_KEYS = "gemini-secret-key-1,gemini-secret-key-2"
GROQ_KEY = "groq-secret-key"
SUPABASE_URL = "https://project-ref.supabase.co"
SUPABASE_KEY = "anon-key-for-tests"


class Providers:
    """Mocked provider calls; each list records the calls made."""

    def __init__(self):
        self.gemini_calls = []
        self.groq_calls = []
        self.tts_calls = []
        self.supabase_requests = []
        self.gemini_answers = {}  # (key, model) -> error kind or None (answers)
        self.groq_error = None
        self.tts_result = b"ID3-audio"
        self.supabase_status = 200
        self.supabase_error = None

    async def gemini(self, key, model, prompt, **kwargs):
        self.gemini_calls.append({"key": key, "model": model, "prompt": prompt, **kwargs})
        error = self.gemini_answers.get((key, model), self.gemini_answers.get(model))
        return {"ok": error is None, "ms": 120, "finish_reason": "STOP" if error is None else None,
                "error": error, "thinking": kwargs.get("thinking")}

    async def groq(self, key, model, prompt, **kwargs):
        self.groq_calls.append({"key": key, "model": model, "prompt": prompt, **kwargs})
        return {"ok": self.groq_error is None, "ms": 80, "finish_reason": None, "error": self.groq_error}

    async def tts(self, text, voice):
        self.tts_calls.append((text, voice))
        if isinstance(self.tts_result, BaseException):
            raise self.tts_result
        return self.tts_result

    def supabase(self, request: httpx.Request) -> httpx.Response:
        self.supabase_requests.append(request)
        if self.supabase_error is not None:
            raise self.supabase_error
        return httpx.Response(self.supabase_status, json={"name": "GoTrue"})


@pytest.fixture
def providers(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", GEMINI_KEYS)
    monkeypatch.setenv("GEMINI_MODELS", "model-a,model-b,model-c,model-d")
    monkeypatch.setenv("GROQ_API_KEY", GROQ_KEY)
    monkeypatch.setenv("GROQ_FAST_MODEL", "groq-fast")
    monkeypatch.setenv("SUPABASE_URL", SUPABASE_URL)
    monkeypatch.setenv("SUPABASE_KEY", SUPABASE_KEY)
    fake = Providers()
    monkeypatch.setattr(base, "probe_gemini_call", fake.gemini)
    monkeypatch.setattr(base, "probe_groq_call", fake.groq)
    monkeypatch.setattr(health_deep, "synthesize", fake.tts)
    monkeypatch.setattr(health_deep, "_supabase_transport", httpx.MockTransport(fake.supabase))
    now = {"t": 1000.0}
    monkeypatch.setattr(health_deep, "_clock", lambda: now["t"])
    fake.clock = now
    health_deep.reset_cache()
    yield fake
    health_deep.reset_cache()


def run(coro):
    return asyncio.run(coro)


@pytest.fixture
def client(providers, monkeypatch):
    import main
    from fastapi.testclient import TestClient

    async def no_session(request):  # any other /api path would ask Supabase; this one must not
        raise AssertionError("the deep health check must not require a session")

    monkeypatch.setattr(main, "require_authenticated_user", no_session)
    main.limiter.reset()
    yield TestClient(main.app)
    main.limiter.reset()


# --- the endpoint -------------------------------------------------------------------------------

def test_deep_health_is_public_and_reports_every_check(client, providers):
    response = client.get("/api/health/deep")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    body = response.json()
    assert body["ok"] is True
    assert body["cached"] is False
    assert body["age_seconds"] == 0
    assert body["fresh_in_seconds"] == 600
    assert body["checked_at"].endswith("Z")
    assert list(body["checks"]) == ["gemini", "groq", "tts", "supabase"]
    assert body["checks"]["gemini"] == {"ok": True, "provider": "Gemini", "model": "model-a", "ms": 120, "code": None,
                                        "fallback": False}
    assert body["checks"]["groq"] == {"ok": True, "provider": "Groq", "model": "groq-fast", "ms": 80, "code": None}
    tts = body["checks"]["tts"]
    assert tts["ok"] is True and tts["provider"] == "edge-tts" and tts["model"] == health_deep.TTS_VOICE and tts["code"] is None
    supabase = body["checks"]["supabase"]
    assert supabase["ok"] is True and supabase["provider"] == "Supabase" and supabase["code"] is None


def test_only_the_deep_path_is_opened_other_health_paths_still_need_a_session(client):
    import main

    async def refuse(request):
        from fastapi import HTTPException
        raise HTTPException(status_code=401, detail="Требуется войти в аккаунт")

    main.require_authenticated_user = refuse  # restored by monkeypatch in the client fixture
    assert client.get("/api/health/deeper").status_code == 401
    assert client.get("/api/health/deep/x").status_code == 401
    assert client.get("/api/diagnostics/models").status_code == 401
    assert client.get("/api/health").status_code == 200
    assert client.get("/api/health/deep").status_code == 200


def test_the_answer_carries_no_keys_urls_or_provider_text(client, providers):
    providers.groq_error = "rate_limited"
    providers.tts_result = RuntimeError(f"edge-tts said: token {GROQ_KEY} at {SUPABASE_URL}")
    providers.supabase_status = 503
    text = client.get("/api/health/deep").text
    for secret in [*GEMINI_KEYS.split(","), GROQ_KEY, SUPABASE_KEY, SUPABASE_URL, "project-ref", "edge-tts said"]:
        assert secret not in text
    body = json.loads(text)
    assert body["ok"] is False
    assert body["checks"]["groq"]["code"] == "rate_limited"
    assert body["checks"]["tts"]["code"] == "other"
    assert body["checks"]["supabase"]["code"] == "http_503"


def test_rate_limited_requests_get_429(client, providers):
    for _ in range(10):
        assert client.get("/api/health/deep").status_code == 200
    response = client.get("/api/health/deep")
    assert response.status_code == 429
    assert response.json()["detail"]
    assert len(providers.gemini_calls) == 1  # and the ten answers came from one round of calls


# --- cache and single flight ----------------------------------------------------------------------

def test_result_is_cached_for_ten_minutes(providers):
    first = run(health_deep.deep_health())
    providers.clock["t"] += 599
    second = run(health_deep.deep_health())
    assert len(providers.gemini_calls) == len(providers.groq_calls) == len(providers.tts_calls) == 1
    assert len(providers.supabase_requests) == 1
    assert first["cached"] is False and second["cached"] is True
    assert second["age_seconds"] == 599 and second["fresh_in_seconds"] == 1
    assert second["checked_at"] == first["checked_at"]
    providers.clock["t"] += 2
    third = run(health_deep.deep_health())
    assert third["cached"] is False
    assert len(providers.gemini_calls) == len(providers.groq_calls) == len(providers.tts_calls) == 2


def test_a_failed_result_is_cached_too(providers):
    providers.groq_error = "timeout"
    assert run(health_deep.deep_health())["ok"] is False
    providers.groq_error = None
    assert run(health_deep.deep_health())["ok"] is False
    assert len(providers.groq_calls) == 1


def test_concurrent_requests_share_one_round_of_calls(providers):
    started = []

    async def slow_gemini(key, model, prompt, **kwargs):
        started.append(model)
        await asyncio.sleep(0.05)
        return {"ok": True, "ms": 50, "finish_reason": "STOP", "error": None, "thinking": "off"}

    base.probe_gemini_call = slow_gemini  # restored by monkeypatch in the providers fixture

    async def many():
        return await asyncio.gather(*[health_deep.deep_health() for _ in range(5)])

    results = run(many())
    assert started == ["model-a"]
    assert len(providers.groq_calls) == 1 and len(providers.tts_calls) == 1
    assert all(result["ok"] for result in results)


def test_a_crashing_check_does_not_hide_the_others(providers, monkeypatch):
    async def broken():
        raise ValueError("boom with gemini-secret-key-1")

    monkeypatch.setitem(health_deep.CHECKS, "groq", broken)
    result = run(health_deep.deep_health())
    assert result["checks"]["groq"] == {"ok": False, "provider": "Groq", "model": None, "ms": 0, "code": "other"}
    assert result["checks"]["gemini"]["ok"] and result["checks"]["tts"]["ok"] and result["checks"]["supabase"]["ok"]
    assert "boom" not in json.dumps(result)


# --- Gemini -------------------------------------------------------------------------------------

def test_gemini_is_a_tiny_call_to_the_first_model(providers):
    result = run(health_deep.check_gemini())
    assert result["ok"] and result["model"] == "model-a" and result["fallback"] is False
    call = providers.gemini_calls[0]
    assert call["key"] == "gemini-secret-key-1"
    assert call["max_tokens"] <= 16 and call["json_mode"] is False and call["thinking"] == "off"
    assert call["timeout"] <= health_deep.AI_CALL_SECONDS


def test_gemini_reports_the_first_model_of_the_list_that_answers(providers):
    providers.gemini_answers = {"model-a": "not_found"}
    result = run(health_deep.check_gemini())
    assert result["ok"] and result["model"] == "model-b" and result["fallback"] is True
    # A retired model is a model problem: the second key is not asked about it.
    assert [(c["key"][-1], c["model"]) for c in providers.gemini_calls] == [("1", "model-a"), ("1", "model-b")]


def test_gemini_tries_the_next_key_when_the_key_is_refused(providers):
    providers.gemini_answers = {("gemini-secret-key-1", "model-a"): "rate_limited"}
    result = run(health_deep.check_gemini())
    assert result["ok"] and result["model"] == "model-a" and result["fallback"] is False
    assert [(c["key"][-1], c["model"]) for c in providers.gemini_calls] == [("1", "model-a"), ("2", "model-a")]


def test_gemini_down_names_the_last_error_and_stops_after_three_models(providers):
    providers.gemini_answers = {"model-a": "timeout", "model-b": "timeout", "model-c": "network", "model-d": None}
    result = run(health_deep.check_gemini())
    assert result == {"ok": False, "provider": "Gemini", "model": None, "ms": result["ms"], "code": "network",
                      "fallback": False}
    assert [c["model"] for c in providers.gemini_calls] == ["model-a", "model-b", "model-c"]


def test_gemini_without_a_key_is_unconfigured(providers, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "")
    result = run(health_deep.check_gemini())
    assert result["ok"] is False and result["code"] == "unconfigured"
    assert providers.gemini_calls == []


# --- Groq, speech, Supabase -----------------------------------------------------------------------

def test_groq_checks_the_fast_model(providers):
    result = run(health_deep.check_groq())
    assert result["ok"] and result["model"] == "groq-fast"
    call = providers.groq_calls[0]
    assert call["key"] == GROQ_KEY and call["model"] == "groq-fast"
    assert call["max_tokens"] <= 16 and call["json_mode"] is False


def test_groq_without_a_key_is_unconfigured(providers, monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", " ")
    result = run(health_deep.check_groq())
    assert result["ok"] is False and result["code"] == "unconfigured"
    assert providers.groq_calls == []


def test_tts_synthesises_one_short_word_in_the_examiner_voice(providers):
    result = run(health_deep.check_tts())
    assert result["ok"] is True
    text, voice = providers.tts_calls[0]
    assert len(text.split()) == 1 and voice == "ru-RU-DmitryNeural"


@pytest.mark.parametrize(
    "outcome, code",
    [(b"", "empty"), (asyncio.TimeoutError(), "timeout"), (ConnectionResetError("reset"), "network"), (ValueError("x"), "other")],
)
def test_tts_failures_become_codes(providers, outcome, code):
    providers.tts_result = outcome
    result = run(health_deep.check_tts())
    assert result["ok"] is False and result["code"] == code


def test_tts_has_a_time_limit(providers, monkeypatch):
    async def hang(text, voice):
        await asyncio.sleep(5)
        return b"late"

    monkeypatch.setattr(health_deep, "synthesize", hang)
    monkeypatch.setattr(health_deep, "TTS_SECONDS", 0.05)
    result = run(health_deep.check_tts())
    assert result["ok"] is False and result["code"] == "timeout"


def test_supabase_is_asked_for_auth_health_with_the_anon_key(providers):
    result = run(health_deep.check_supabase())
    assert result["ok"] is True
    request = providers.supabase_requests[0]
    assert str(request.url) == f"{SUPABASE_URL}/auth/v1/health"
    assert request.headers["apikey"] == SUPABASE_KEY


@pytest.mark.parametrize(
    "status, error, code",
    [(401, None, "http_401"), (503, None, "http_503"), (200, httpx.ConnectTimeout("slow"), "timeout"),
     (200, httpx.ConnectError("refused"), "network")],
)
def test_supabase_failures_become_codes(providers, status, error, code):
    providers.supabase_status = status
    providers.supabase_error = error
    result = run(health_deep.check_supabase())
    assert result["ok"] is False and result["code"] == code


def test_supabase_unconfigured(providers, monkeypatch):
    for name in ("SUPABASE_URL", "VITE_SUPABASE_URL", "SUPABASE_KEY", "VITE_SUPABASE_ANON_KEY", "VITE_SUPABASE_KEY"):
        monkeypatch.delenv(name, raising=False)
    result = run(health_deep.check_supabase())
    assert result["ok"] is False and result["code"] == "unconfigured"
    assert providers.supabase_requests == []
