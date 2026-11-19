"""The extra provider (agents/base.py extra_provider): off without its settings, first or last by AI_EXTRA_ORDER,
never the only road — a failure rests it and the call goes on to Gemini and Groq."""
import asyncio
import json
import sys
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agents import base  # noqa: E402
from agents.base import AIError, BaseAgent  # noqa: E402

from test_base_agent import install_gemini, install_groq  # noqa: E402

URL = "https://models.example/v1"
KEY = "extra-secret-key"
ENV = ("AI_EXTRA_BASE_URL", "AI_EXTRA_API_KEY", "AI_EXTRA_MODEL", "AI_EXTRA_FAST_MODEL", "AI_EXTRA_ORDER",
       "AI_EXTRA_JSON_MODE", "AI_EXTRA_TIMEOUT", "GEMINI_API_KEY", "GEMINI_MODELS", "GEMINI_FAST_MODELS",
       "GROQ_MODEL", "GROQ_FAST_MODEL", "AI_CACHE_DISABLED", "AI_CALL_TIMEOUT_SECONDS", "AI_COOLDOWN")


@pytest.fixture(autouse=True)
def clean_state(monkeypatch):
    for name in ENV:
        monkeypatch.delenv(name, raising=False)

    def reset():
        BaseAgent._run_cache.clear()
        BaseAgent._cache_info.clear()
        base._GENAI_CLIENTS.clear()
        base._GROQ_CLIENTS.clear()
        base._EXTRA_CLIENTS.clear()
        base._MODEL_SKIP.clear()
        base.reset_cooldowns()

    reset()
    yield
    reset()


def install_extra(monkeypatch, behaviour, *, order=None, model="glm-main", fast=None):
    """A fake service at URL. behaviour(body) -> text | (status, json) | Exception."""
    monkeypatch.setenv("AI_EXTRA_BASE_URL", URL + "/")
    monkeypatch.setenv("AI_EXTRA_API_KEY", KEY)
    monkeypatch.setenv("AI_EXTRA_MODEL", model)
    if fast:
        monkeypatch.setenv("AI_EXTRA_FAST_MODEL", fast)
    if order:
        monkeypatch.setenv("AI_EXTRA_ORDER", order)
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        calls.append({"url": str(request.url), "auth": request.headers.get("authorization"), "body": body})
        result = behaviour(body)
        if isinstance(result, BaseException):
            raise result
        if isinstance(result, tuple):
            return httpx.Response(result[0], json=result[1])
        return httpx.Response(200, json={"choices": [{"message": {"content": result}, "finish_reason": "stop"}]})

    base._EXTRA_CLIENTS[URL] = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return calls


def run(agent, *args, **kwargs):
    return asyncio.run(agent.run(*args, **kwargs))


def test_off_without_all_three_settings(monkeypatch):
    assert base.extra_provider() is None
    monkeypatch.setenv("AI_EXTRA_BASE_URL", URL)
    monkeypatch.setenv("AI_EXTRA_API_KEY", KEY)
    assert base.extra_provider() is None  # no model
    monkeypatch.setenv("AI_EXTRA_MODEL", "glm-main")
    extra = base.extra_provider()
    assert extra is not None and extra.base_url == URL and extra.fast_model == "glm-main" and extra.first is False
    monkeypatch.setenv("AI_EXTRA_BASE_URL", "http://models.example/v1")
    assert base.extra_provider() is None  # only https


def test_last_by_default_gemini_answers_and_the_extra_is_not_asked(monkeypatch):
    gemini_calls, _ = install_gemini(monkeypatch, lambda model, config, contents: ("от gemini", "STOP"))
    extra_calls = install_extra(monkeypatch, lambda body: "от extra")
    meta = {}
    assert run(BaseAgent(), "Система", "Вопрос", meta=meta) == "от gemini"
    assert len(gemini_calls) == 1 and extra_calls == []
    assert meta["provider"] == "gemini"


def test_last_it_is_the_spare_after_gemini_and_groq_failed(monkeypatch):
    install_gemini(monkeypatch, lambda model, config, contents: RuntimeError("down"))
    install_groq(monkeypatch, lambda kwargs: RuntimeError("down too"))
    extra_calls = install_extra(monkeypatch, lambda body: "от extra")
    meta = {}
    assert run(BaseAgent(api_key="groq-key"), "Система", "Вопрос", meta=meta) == "от extra"
    assert meta["provider"] == "extra" and meta["model"] == "glm-main"
    call = extra_calls[0]
    assert call["url"] == URL + "/chat/completions"
    assert call["auth"] == f"Bearer {KEY}"
    assert call["body"]["model"] == "glm-main" and call["body"]["stream"] is False
    assert [m["role"] for m in call["body"]["messages"]] == ["system", "user"]
    assert "response_format" not in call["body"]


def test_first_it_answers_before_gemini_and_the_fast_calls_take_the_fast_model(monkeypatch):
    gemini_calls, _ = install_gemini(monkeypatch, lambda model, config, contents: ("от gemini", "STOP"))
    extra_calls = install_extra(monkeypatch, lambda body: "от extra", order="first", fast="glm-fast")
    assert run(BaseAgent(), "Система", "Вопрос") == "от extra"
    assert run(BaseAgent(), "Система", "Быстрый вопрос", fast=True) == "от extra"
    assert gemini_calls == []
    assert [call["body"]["model"] for call in extra_calls] == ["glm-main", "glm-fast"]


def test_first_a_failure_goes_on_to_gemini_and_rests_the_extra(monkeypatch):
    gemini_calls, _ = install_gemini(monkeypatch, lambda model, config, contents: ("от gemini", "STOP"))
    extra_calls = install_extra(monkeypatch, lambda body: (503, {"error": "down"}), order="first")
    meta = {}
    assert run(BaseAgent(), "Система", "Вопрос один", meta=meta) == "от gemini"
    assert meta["provider"] == "gemini" and len(extra_calls) == 1
    # resting: the next call does not wait on it again
    assert run(BaseAgent(), "Система", "Вопрос два") == "от gemini"
    assert len(extra_calls) == 1 and len(gemini_calls) == 2


def test_first_an_empty_answer_is_a_failure_too(monkeypatch):
    install_gemini(monkeypatch, lambda model, config, contents: ("от gemini", "STOP"))
    extra_calls = install_extra(monkeypatch, lambda body: "   ", order="first")
    assert run(BaseAgent(), "Система", "Вопрос") == "от gemini"
    assert len(extra_calls) == 1


def test_json_mode_is_sent_only_when_switched_on(monkeypatch):
    extra_calls = install_extra(monkeypatch, lambda body: '{"ok": true}', order="first")
    run(BaseAgent(), "Верни JSON.", "Вопрос", json_mode=True)
    assert "response_format" not in extra_calls[0]["body"]
    monkeypatch.setenv("AI_EXTRA_JSON_MODE", "1")
    run(BaseAgent(), "Верни JSON.", "Другой вопрос", json_mode=True)
    assert extra_calls[1]["body"]["response_format"] == {"type": "json_object"}


def test_an_agent_given_its_own_keys_keeps_to_them(monkeypatch):
    """The Groq-only spare of «Подобрать ключи с ИИ» and the /try example's own project: their answers must come
    from the model they name, so the extra provider is not theirs."""
    install_groq(monkeypatch, lambda kwargs: ("от groq", "stop"))
    extra_calls = install_extra(monkeypatch, lambda body: "от extra", order="first")
    assert run(BaseAgent(api_key="groq-key", gemini_api_keys=[]), "Система", "Вопрос") == "от groq"
    assert extra_calls == []


def test_alone_and_down_the_call_fails_without_the_key_in_the_error(monkeypatch, capsys):
    install_extra(monkeypatch, lambda body: (401, {"error": f"bad key {KEY}"}), order="first")
    with pytest.raises(AIError) as raised:
        run(BaseAgent(), "Система", "Вопрос")
    assert KEY not in str(raised.value.detail)
    assert KEY not in capsys.readouterr().out
