"""BaseAgent: env models, shared clients, deadlines, thinking budget, cache and sanitised errors."""
import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from google.genai import errors as genai_errors  # noqa: E402

from agents import base  # noqa: E402
from agents.base import (  # noqa: E402
    AI_FAILED_DETAIL,
    AIError,
    BaseAgent,
    build_mistakes_practice_prompt,
)


PROMPT = "Ты помощник. Ответь коротко."
JSON_PROMPT = "Верни ответ в формате JSON."


@pytest.fixture(autouse=True)
def clean_state(monkeypatch):
    for name in ("GEMINI_API_KEY", "GEMINI_MODELS", "GEMINI_FAST_MODELS", "GROQ_MODEL", "GROQ_FAST_MODEL",
                 "GROQ_VISION_MODEL", "AI_CACHE_DISABLED", "AI_CALL_TIMEOUT_SECONDS", "MODEL_SKIP_SECONDS",
                 "GEMINI_REQUEST_TIMEOUT_SECONDS"):
        monkeypatch.delenv(name, raising=False)
    BaseAgent._run_cache.clear()
    BaseAgent._cache_info.clear()
    base._GENAI_CLIENTS.clear()
    base._GROQ_CLIENTS.clear()
    base._MODEL_SKIP.clear()
    yield
    BaseAgent._run_cache.clear()
    BaseAgent._cache_info.clear()
    base._GENAI_CLIENTS.clear()
    base._GROQ_CLIENTS.clear()
    base._MODEL_SKIP.clear()


def install_gemini(monkeypatch, behaviour, keys="gemini-key-1"):
    """Fake google-genai client. behaviour(model, config, contents) -> (text, finish) | Exception | coroutine."""
    monkeypatch.setenv("GEMINI_API_KEY", keys)
    calls, created = [], []

    class FakeClient:
        def __init__(self, api_key=None, **kwargs):
            created.append(api_key)
            self.api_key = api_key

            async def generate_content(*, model, contents, config):
                calls.append({"key": api_key, "model": model, "config": config, "contents": contents})
                result = behaviour(model, config, contents)
                if asyncio.iscoroutine(result):
                    result = await result
                if isinstance(result, BaseException):
                    raise result
                text, finish = result
                return SimpleNamespace(text=text, candidates=[SimpleNamespace(finish_reason=finish)])

            self.aio = SimpleNamespace(models=SimpleNamespace(generate_content=generate_content))

    monkeypatch.setattr(base.genai, "Client", FakeClient)
    base._GENAI_CLIENTS.clear()
    return calls, created


def install_groq(monkeypatch, behaviour):
    """Fake AsyncGroq. behaviour(kwargs) -> (text, finish) | Exception."""
    calls, created = [], []

    class FakeGroq:
        def __init__(self, api_key=None, max_retries=None, **kwargs):
            created.append({"api_key": api_key, "max_retries": max_retries})

            async def create(**kwargs):
                calls.append(kwargs)
                result = behaviour(kwargs)
                if asyncio.iscoroutine(result):
                    result = await result
                if isinstance(result, BaseException):
                    raise result
                text, finish = result
                return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=text), finish_reason=finish)])

            self.chat = SimpleNamespace(completions=SimpleNamespace(create=create))

    monkeypatch.setattr(base, "AsyncGroq", FakeGroq)
    base._GROQ_CLIENTS.clear()
    return calls, created


def run(agent, *args, **kwargs):
    return asyncio.run(agent.run(*args, **kwargs))


def gemini_error(code, status, message="error"):
    cls = genai_errors.ClientError if code < 500 else genai_errors.ServerError
    return cls(code, {"error": {"code": code, "message": message, "status": status}})


# --- empty answers, cache ---------------------------------------------------------------

def test_empty_groq_text_is_a_failure_and_not_cached(monkeypatch):
    calls, _ = install_groq(monkeypatch, lambda kwargs: ("", "stop"))
    agent = BaseAgent(api_key="groq-key")
    for _ in range(2):
        with pytest.raises(AIError) as info:
            run(agent, PROMPT, "текст")
        assert info.value.status_code == 502 and info.value.code == "ai_failed"
    assert len(calls) == 2  # never served from the cache
    assert BaseAgent._run_cache == {}


def test_whitespace_only_gemini_text_is_empty(monkeypatch):
    install_gemini(monkeypatch, lambda model, config, contents: ("   \n", "STOP"))
    with pytest.raises(AIError) as info:
        run(BaseAgent(), PROMPT, "текст")
    assert info.value.code == "ai_failed"
    assert BaseAgent._run_cache == {}


def test_cache_key_separates_temperature_json_mode_fast_and_thinking(monkeypatch):
    counter = {"n": 0}

    def answer(model, config, contents):
        counter["n"] += 1
        return f"ответ {counter['n']}", "STOP"

    calls, _ = install_gemini(monkeypatch, answer)
    agent = BaseAgent()
    first = run(agent, PROMPT, "текст")
    assert run(agent, PROMPT, "текст") == first and len(calls) == 1
    run(agent, PROMPT, "текст", temperature=0)
    run(agent, PROMPT, "текст", json_mode=True)
    run(agent, PROMPT, "текст", fast=True)
    run(agent, PROMPT, "текст", thinking="low")
    run(agent, PROMPT, "текст", max_tokens=100)
    assert len(calls) == 6
    # Each variant is now cached on its own.
    run(agent, PROMPT, "текст", thinking="low")
    run(agent, PROMPT, "текст", fast=True)
    assert len(calls) == 6


def test_use_cache_false_and_env_switch_bypass_read_and_write(monkeypatch):
    calls, _ = install_gemini(monkeypatch, lambda model, config, contents: ("ответ", "STOP"))
    agent = BaseAgent()
    run(agent, PROMPT, "текст", use_cache=False)
    run(agent, PROMPT, "текст", use_cache=False)
    assert len(calls) == 2 and BaseAgent._run_cache == {}

    run(agent, PROMPT, "текст")  # stored
    assert len(calls) == 3
    monkeypatch.setenv("AI_CACHE_DISABLED", "1")
    run(agent, PROMPT, "текст")  # not read
    assert len(calls) == 4
    run(agent, PROMPT, "другой текст")  # not written
    monkeypatch.delenv("AI_CACHE_DISABLED")
    run(agent, PROMPT, "другой текст")
    assert len(calls) == 6


def test_forget_evicts_every_entry_with_that_value(monkeypatch):
    install_gemini(monkeypatch, lambda model, config, contents: ("плохой ответ", "STOP"))
    agent = BaseAgent()
    run(agent, PROMPT, "текст 1")
    run(agent, PROMPT, "текст 2")
    BaseAgent._run_cache[("other",)] = "хороший ответ"
    BaseAgent.forget("плохой ответ")
    assert list(BaseAgent._run_cache.values()) == ["хороший ответ"]
    BaseAgent.forget(None)  # no-op


# --- deadlines and error mapping -----------------------------------------------------------

def test_budget_exhaustion_is_ai_timeout_504(monkeypatch):
    async def slow(model, config, contents):
        await asyncio.sleep(5)
        return "поздно", "STOP"

    install_gemini(monkeypatch, lambda model, config, contents: slow(model, config, contents))
    started = asyncio.run(_timed(BaseAgent(), timeout=0.2))
    error, elapsed = started
    assert isinstance(error, AIError) and error.status_code == 504 and error.code == "ai_timeout"
    assert elapsed < 2


async def _timed(agent, **kwargs):
    loop = asyncio.get_running_loop()
    start = loop.time()
    try:
        await agent.run(PROMPT, "текст", **kwargs)
    except AIError as exc:
        return exc, loop.time() - start
    return None, loop.time() - start


def test_each_gemini_request_gets_a_bounded_http_timeout(monkeypatch):
    calls, _ = install_gemini(monkeypatch, lambda model, config, contents: ("ок", "STOP"))
    monkeypatch.setenv("GEMINI_REQUEST_TIMEOUT_SECONDS", "60")
    run(BaseAgent(), PROMPT, "текст", timeout=30)
    timeout_ms = calls[0]["config"].http_options.timeout
    assert 29000 <= timeout_ms <= 30000


def test_gemini_server_deadline_is_never_under_ten_seconds(monkeypatch):
    # The API answers INVALID_ARGUMENT to an X-Server-Timeout under 10 s: a short budget is kept by
    # the wait around the call, the header asks for 10 s.
    calls, _ = install_gemini(monkeypatch, lambda model, config, contents: ("ок", "STOP"))
    monkeypatch.setenv("GEMINI_REQUEST_TIMEOUT_SECONDS", "60")
    run(BaseAgent(), PROMPT, "текст", timeout=2.5)
    assert calls[0]["config"].http_options.timeout == 10000


def test_a_restricted_groq_account_is_a_permission_failure_not_a_bad_request():
    import groq
    from agents.base import classify_error, provider_error_code

    req = httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions")
    body = {"error": {"message": "Organization has been restricted.", "type": "invalid_request_error", "code": "organization_restricted"}}
    exc = groq.BadRequestError("restricted", response=httpx.Response(400, request=req), body=body)
    assert classify_error(exc) == "permission"
    assert provider_error_code(exc) == "organization_restricted"
    plain = groq.BadRequestError("bad", response=httpx.Response(400, request=req), body={"error": {"code": "model_decommissioned"}})
    assert classify_error(plain) == "invalid_argument"


def test_provider_429_is_busy_by_status_not_by_text(monkeypatch):
    install_gemini(monkeypatch, lambda model, config, contents: gemini_error(429, "RESOURCE_EXHAUSTED"))
    with pytest.raises(AIError) as info:
        run(BaseAgent(), PROMPT, "текст")
    assert info.value.status_code == 429 and info.value.code == "ai_busy"

    BaseAgent._run_cache.clear()
    base.reset_cooldowns()  # the pairs that answered 429 rest; this part asks them again
    install_gemini(monkeypatch, lambda model, config, contents: gemini_error(500, "INTERNAL", "upstream said 429"))
    with pytest.raises(AIError) as info:
        run(BaseAgent(), PROMPT, "текст")
    assert info.value.status_code == 502

    req = httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions")
    import groq

    install_groq(monkeypatch, lambda kwargs: groq.RateLimitError("Error code: 429", response=httpx.Response(429, request=req), body=None))
    monkeypatch.delenv("GEMINI_API_KEY")
    with pytest.raises(AIError) as info:
        run(BaseAgent(api_key="groq-key"), PROMPT, "текст")
    assert info.value.code == "ai_busy"


def test_error_details_never_carry_provider_text(monkeypatch):
    install_gemini(monkeypatch, lambda model, config, contents: RuntimeError("gemini secret https://generativelanguage.googleapis.com key=abc"))
    install_groq(monkeypatch, lambda kwargs: Exception("secret org_123 https://api.groq.com"))
    with pytest.raises(AIError) as info:
        run(BaseAgent(api_key="groq-key"), PROMPT, "текст")
    detail = str(info.value.detail)
    assert detail == AI_FAILED_DETAIL
    for leak in ("org_123", "https://", "Groq", "secret", "GEMINI", "GROQ"):
        assert leak not in detail


def test_no_provider_configured_is_503(monkeypatch):
    with pytest.raises(AIError) as info:
        run(BaseAgent(api_key=""), PROMPT, "текст")
    assert info.value.status_code == 503 and info.value.code == "ai_unconfigured"
    assert "GROQ" not in info.value.detail and "GEMINI" not in info.value.detail


# --- models from the environment ------------------------------------------------------------

def test_gemini_models_come_from_env_in_order(monkeypatch):
    monkeypatch.setenv("GEMINI_MODELS", "model-one, model-two")
    calls, _ = install_gemini(monkeypatch, lambda model, config, contents: ("", "STOP") if model == "model-one" else ("ок", "STOP"))
    assert run(BaseAgent(), PROMPT, "текст") == "ок"
    assert [call["model"] for call in calls] == ["model-one", "model-two"]


def test_fast_calls_use_gemini_fast_models_and_fall_back_to_gemini_models(monkeypatch):
    monkeypatch.setenv("GEMINI_MODELS", "slow-model")
    calls, _ = install_gemini(monkeypatch, lambda model, config, contents: ("ок", "STOP"))
    run(BaseAgent(), PROMPT, "текст", fast=True)
    assert calls[-1]["model"] == "slow-model"
    monkeypatch.setenv("GEMINI_FAST_MODELS", "quick-model")
    run(BaseAgent(), PROMPT, "другой", fast=True)
    assert calls[-1]["model"] == "quick-model"
    run(BaseAgent(), PROMPT, "третий")
    assert calls[-1]["model"] == "slow-model"


def test_groq_models_come_from_env(monkeypatch):
    calls, _ = install_groq(monkeypatch, lambda kwargs: ("ок", "stop"))
    agent = BaseAgent(api_key="groq-key")
    run(agent, PROMPT, "один")
    assert calls[-1]["model"] == "openai/gpt-oss-120b"  # llama-3.3-70b-versatile was retired on 2026-08-16
    run(agent, PROMPT, "два", fast=True)
    assert calls[-1]["model"] == "openai/gpt-oss-20b"  # GROQ_FAST_MODEL unset: the smaller gpt-oss
    monkeypatch.setenv("GROQ_MODEL", "groq-main")
    monkeypatch.setenv("GROQ_FAST_MODEL", "groq-quick")
    run(agent, PROMPT, "три")
    assert calls[-1]["model"] == "groq-main"
    run(agent, PROMPT, "четыре", fast=True)
    assert calls[-1]["model"] == "groq-quick"
    assert calls[-1]["timeout"] <= 90


def test_run_with_images_uses_groq_vision_model_and_sanitised_errors(monkeypatch):
    calls, _ = install_groq(monkeypatch, lambda kwargs: ("оценки", "stop"))
    agent = BaseAgent(api_key="groq-key")
    assert asyncio.run(agent.run_with_images(PROMPT, "фото", ["aGVsbG8="], "image/png")) == "оценки"
    assert calls[-1]["model"] == "llama-3.2-90b-vision-preview"
    monkeypatch.setenv("GROQ_VISION_MODEL", "vision-x")
    asyncio.run(agent.run_with_images(PROMPT, "фото 2", ["aGVsbG8="], "image/png"))
    assert calls[-1]["model"] == "vision-x"

    install_groq(monkeypatch, lambda kwargs: Exception("secret org_123 https://api.groq.com"))
    with pytest.raises(AIError) as info:
        asyncio.run(agent.run_with_images(PROMPT, "фото 3", ["aGVsbG8="], "image/png"))
    assert info.value.detail == AI_FAILED_DETAIL


def test_json_mode_heuristic_and_explicit_override(monkeypatch):
    calls, _ = install_gemini(monkeypatch, lambda model, config, contents: ("{}", "STOP"))
    agent = BaseAgent()
    run(agent, JSON_PROMPT, "a")
    assert calls[-1]["config"].response_mime_type == "application/json"
    run(agent, JSON_PROMPT, "b", json_mode=False)
    assert calls[-1]["config"].response_mime_type == "text/plain"
    run(agent, PROMPT, "c", json_mode=True)
    assert calls[-1]["config"].response_mime_type == "application/json"


def test_groq_json_mode_always_mentions_json(monkeypatch):
    monkeypatch.setenv("GROQ_MODEL", "llama-like-model")
    calls, _ = install_groq(monkeypatch, lambda kwargs: ("{}", "stop"))
    run(BaseAgent(api_key="groq-key"), "Ответь списком.", "текст", json_mode=True)
    assert calls[-1]["response_format"] == {"type": "json_object"}
    assert "json" in calls[-1]["messages"][0]["content"].lower()
    assert "extra_body" not in calls[-1] and calls[-1]["max_tokens"] == 8192


def test_groq_gpt_oss_gets_low_reasoning_room_for_it_and_no_json_mode(monkeypatch):
    """gpt-oss reasons from the same max_tokens; Groq's JSON mode refuses its good answers (400
    json_validate_failed), so the prompt asks for JSON and the parser reads it."""
    calls, _ = install_groq(monkeypatch, lambda kwargs: ('{"ok": true}', "stop"))
    agent = BaseAgent(api_key="groq-key")
    assert run(agent, "Ответь списком.", "текст", json_mode=True, max_tokens=200, fast=True) == '{"ok": true}'
    call = calls[-1]
    assert call["model"] == "openai/gpt-oss-20b"
    assert "response_format" not in call
    assert call["extra_body"] == {"reasoning_effort": "low", "include_reasoning": False}
    assert call["max_tokens"] == 200 + base.GROQ_REASONING_ALLOWANCE
    assert "json" in call["messages"][0]["content"].lower()
    run(agent, PROMPT, "обычный ответ")
    assert calls[-1]["model"] == "openai/gpt-oss-120b" and calls[-1]["extra_body"]["reasoning_effort"] == "low"
    assert base.groq_reasoning_model("openai/gpt-oss-120b") and not base.groq_reasoning_model("llama-3.3-70b-versatile")


# --- clients and the skip list ------------------------------------------------------------------

def test_clients_are_created_once_per_key_and_reused(monkeypatch):
    calls, created = install_gemini(monkeypatch, lambda model, config, contents: ("ок", "STOP"))
    agent = BaseAgent()
    run(agent, PROMPT, "один", use_cache=False)
    run(BaseAgent(), PROMPT, "два", use_cache=False)
    assert created == ["gemini-key-1"]
    assert base.get_genai_client("gemini-key-1") is base.get_genai_client("gemini-key-1")

    monkeypatch.delenv("GEMINI_API_KEY")
    groq_calls, groq_created = install_groq(monkeypatch, lambda kwargs: ("ок", "stop"))
    run(BaseAgent(api_key="groq-key"), PROMPT, "три", use_cache=False)
    run(BaseAgent(api_key="groq-key"), PROMPT, "четыре", use_cache=False)
    assert groq_created == [{"api_key": "groq-key", "max_retries": 1}]
    assert len(groq_calls) == 2


def test_not_found_model_is_skipped_for_ten_minutes_but_diagnostics_still_calls_it(monkeypatch):
    monkeypatch.setenv("GEMINI_MODELS", "retired-model,gemini-2.5-flash")

    def answer(model, config, contents):
        if model == "retired-model":
            return gemini_error(404, "NOT_FOUND", "models/retired-model is not found")
        return "ок", "STOP"

    calls, _ = install_gemini(monkeypatch, answer)
    clock = {"now": 1000.0}
    monkeypatch.setattr(base, "_skip_clock", lambda: clock["now"])
    agent = BaseAgent()
    run(agent, PROMPT, "один", use_cache=False)
    run(agent, PROMPT, "два", use_cache=False)
    assert [call["model"] for call in calls] == ["retired-model", "gemini-2.5-flash", "gemini-2.5-flash"]

    result = asyncio.run(base.probe_gemini_call("gemini-key-1", "retired-model", "ping"))
    assert result["ok"] is False and result["error"] == "not_found"
    assert calls[-1]["model"] == "retired-model"

    clock["now"] += 601
    run(agent, PROMPT, "три", use_cache=False)
    assert calls[-2]["model"] == "retired-model"


def test_permission_error_skips_that_model_for_that_key_only(monkeypatch):
    first = base.gemini_models_env()[0]

    def answer(model, config, contents):
        return gemini_error(403, "PERMISSION_DENIED") if model == first else ("ок", "STOP")

    calls, _ = install_gemini(monkeypatch, answer, keys="key-a")
    run(BaseAgent(), PROMPT, "один", use_cache=False)
    assert base.model_skipped("gemini", "key-a", first)
    assert not base.model_skipped("gemini", "key-b", first)


# --- thinking budget ------------------------------------------------------------------------------

def test_flash_model_gets_low_thinking_budget_and_one_retry_without_it_after_a_400(monkeypatch):
    monkeypatch.setenv("GEMINI_MODELS", "gemini-2.5-flash")

    def answer(model, config, contents):
        if config.thinking_config is not None:
            return gemini_error(400, "INVALID_ARGUMENT", "Thinking budget is not supported for this model.")
        return "ок", "STOP"

    calls, _ = install_gemini(monkeypatch, answer)
    meta = {}
    assert run(BaseAgent(), PROMPT, "текст", thinking="low", max_tokens=1500, meta=meta) == "ок"
    assert len(calls) == 2
    assert calls[0]["config"].thinking_config.thinking_budget == 512
    assert calls[0]["config"].max_output_tokens == 1500 + 512
    assert calls[1]["config"].thinking_config is None
    assert calls[1]["config"].max_output_tokens == 1500 + 2048
    assert meta["thinking"] == "default"


def test_fast_call_turns_thinking_off(monkeypatch):
    monkeypatch.setenv("GEMINI_MODELS", "gemini-2.5-flash,gemini-2.5-pro,gemini-3-flash-preview")
    calls, _ = install_gemini(monkeypatch, lambda model, config, contents: ("", "STOP"))
    with pytest.raises(AIError):
        run(BaseAgent(), PROMPT, "текст", fast=True, max_tokens=200)
    by_model = {call["model"]: call["config"] for call in calls}
    assert by_model["gemini-2.5-flash"].thinking_config.thinking_budget == 0
    assert by_model["gemini-2.5-flash"].max_output_tokens == 200
    assert by_model["gemini-2.5-pro"].thinking_config.thinking_budget == 128
    assert by_model["gemini-3-flash-preview"].thinking_config.thinking_level.name == "MINIMAL"


def test_empty_max_tokens_answer_is_retried_once_with_thinking_off(monkeypatch):
    monkeypatch.setenv("GEMINI_MODELS", "gemini-2.5-flash")
    answers = iter([("", "MAX_TOKENS"), ("готово", "STOP")])
    calls, _ = install_gemini(monkeypatch, lambda model, config, contents: next(answers))
    meta = {}
    assert run(BaseAgent(), PROMPT, "текст", max_tokens=1000, meta=meta) == "готово"
    assert calls[0]["config"].thinking_config is None  # provider default thinking
    assert calls[0]["config"].max_output_tokens == 1000 + 2048
    assert calls[1]["config"].thinking_config.thinking_budget == 0
    assert calls[1]["config"].max_output_tokens == 1000 + 2048
    assert meta["finish_reason"] == "STOP" and meta["thinking"] == "off"


def test_max_tokens_retry_happens_once_then_next_model(monkeypatch):
    monkeypatch.setenv("GEMINI_MODELS", "gemini-2.5-flash,gemini-2.5-flash-lite")
    calls, _ = install_gemini(
        monkeypatch,
        lambda model, config, contents: ("", "MAX_TOKENS") if model == "gemini-2.5-flash" else ("ок", "STOP"),
    )
    assert run(BaseAgent(), PROMPT, "текст") == "ок"
    assert [call["model"] for call in calls] == ["gemini-2.5-flash", "gemini-2.5-flash", "gemini-2.5-flash-lite"]


def test_call_that_cannot_lower_thinking_sends_max_tokens_plus_2048(monkeypatch):
    monkeypatch.setenv("GEMINI_MODELS", "gemini-experimental-x")  # unknown family: no config to lower
    calls, _ = install_gemini(monkeypatch, lambda model, config, contents: ("ок", "STOP"))
    run(BaseAgent(), PROMPT, "текст", fast=True, max_tokens=200)
    assert calls[-1]["config"].thinking_config is None
    assert calls[-1]["config"].max_output_tokens == 200 + 2048

    # An SDK without thinking fields: the same fallback for a 2.5 model.
    monkeypatch.setattr(base, "_HAS_THINKING_BUDGET", False)
    monkeypatch.setenv("GEMINI_MODELS", "gemini-2.5-flash")
    run(BaseAgent(), PROMPT, "другой текст", fast=True, max_tokens=200)
    assert calls[-1]["config"].thinking_config is None
    assert calls[-1]["config"].max_output_tokens == 200 + 2048


def test_meta_reports_provider_model_timing_and_finish_reason(monkeypatch):
    monkeypatch.setenv("GEMINI_MODELS", "gemini-2.5-flash-lite")
    install_gemini(monkeypatch, lambda model, config, contents: ("ок", "STOP"))
    meta = {}
    run(BaseAgent(), PROMPT, "текст", fast=True, meta=meta)
    assert meta["provider"] == "gemini" and meta["model"] == "gemini-2.5-flash-lite"
    assert meta["cached"] is False and meta["finish_reason"] == "STOP" and meta["thinking"] == "off"
    assert isinstance(meta["ms"], int)
    cached_meta = {}
    run(BaseAgent(), PROMPT, "текст", fast=True, meta=cached_meta)
    assert cached_meta["cached"] is True and cached_meta["model"] == "gemini-2.5-flash-lite"

    failing = {}
    monkeypatch.delenv("GEMINI_API_KEY")
    install_groq(monkeypatch, lambda kwargs: ("", "length"))
    with pytest.raises(AIError):
        run(BaseAgent(api_key="groq-key"), PROMPT, "x", meta=failing)
    assert failing["provider"] is None and failing["error"] == "empty"


def test_gemini_falls_back_to_groq(monkeypatch):
    install_gemini(monkeypatch, lambda model, config, contents: gemini_error(503, "UNAVAILABLE", "overloaded"))
    groq_calls, _ = install_groq(monkeypatch, lambda kwargs: ("ответ groq", "stop"))
    meta = {}
    assert run(BaseAgent(api_key="groq-key"), PROMPT, "текст", meta=meta) == "ответ groq"
    assert meta["provider"] == "groq" and len(groq_calls) == 1


def test_mistakes_practice_prompt_names_tests_and_oral_answers():
    prompt = build_mistakes_practice_prompt([{"id": "m1", "question": "Q", "student_answer": "S", "correct_answer": "C", "topic": "T"}])
    assert "из тестов и устных ответов" in prompt
    assert "на устном экзамене" not in prompt


def test_models_without_thinking_get_no_config_and_no_extra_tokens(monkeypatch):
    monkeypatch.setenv("GEMINI_MODELS", "gemini-2.0-flash")
    answers = iter([("", "MAX_TOKENS"), ("лишний вызов", "STOP")])
    calls, _ = install_gemini(monkeypatch, lambda model, config, contents: next(answers))
    with pytest.raises(AIError):
        run(BaseAgent(), PROMPT, "текст")  # default 8192 stays within gemini-2.0-flash's output cap
    assert len(calls) == 1
    assert calls[0]["config"].thinking_config is None and calls[0]["config"].max_output_tokens == 8192


def test_malformed_image_payload_is_a_sanitised_failure(monkeypatch):
    calls, _ = install_gemini(monkeypatch, lambda model, config, contents: ("ок", "STOP"))
    with pytest.raises(AIError) as info:
        asyncio.run(BaseAgent().run_with_images(PROMPT, "фото", ["%%%not-base64"], "image/png"))
    assert info.value.code == "ai_failed" and info.value.detail == AI_FAILED_DETAIL
    assert calls == []


def test_ai_error_shapes_used_by_other_modules():
    error = AIError(422, "rubric_unverifiable", "Не получилось составить эталон.")
    assert (error.status_code, error.code, error.detail) == (422, "rubric_unverifiable", "Не получилось составить эталон.")
    swapped = AIError(409, "Этого вопроса нет в ваших лекциях.", "not_in_lectures")
    assert (swapped.code, swapped.detail) == ("not_in_lectures", "Этого вопроса нет в ваших лекциях.")
    keywords = AIError(status_code=429, code="ai_busy", detail=base.AI_BUSY_DETAIL)
    assert keywords.status_code == 429 and keywords.code == "ai_busy"
    assert (AIError.busy().status_code, AIError.busy().code) == (429, "ai_busy")
    assert (AIError.failed().status_code, AIError.failed().code) == (502, "ai_failed")
    assert (AIError.timeout().status_code, AIError.timeout().code) == (504, "ai_timeout")
    assert (AIError.unconfigured().status_code, AIError.unconfigured().code) == (503, "ai_unconfigured")
