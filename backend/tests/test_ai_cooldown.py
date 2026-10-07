"""Ф2-минимум (2026-10-07): a (provider, key, model) pair that answered 429 rests and the next pair is
asked at once; a daily quota rests until midnight in Pacific time; every pair resting is ai_busy at once,
without a request; AI_COOLDOWN=0 is the old behaviour. Heavy calls (list check, analysis, answer points,
short lines of the cheat sheet) wait in one line for the process; the quick check and the protocol never do."""
import asyncio
import json
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from starlette.requests import Request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from google.genai import errors as genai_errors  # noqa: E402

from agents import base  # noqa: E402
from agents.base import AI_BUSY_DETAIL, AIError, BaseAgent  # noqa: E402

PROMPT = "Ты помощник. Ответь коротко."
UTC = timezone.utc


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    for name in ("GEMINI_API_KEY", "GEMINI_MODELS", "GEMINI_FAST_MODELS", "GROQ_MODEL", "GROQ_FAST_MODEL",
                 "AI_CACHE_DISABLED", "AI_CALL_TIMEOUT_SECONDS", "MODEL_SKIP_SECONDS", "GEMINI_REQUEST_TIMEOUT_SECONDS"):
        monkeypatch.delenv(name, raising=False)
    BaseAgent._run_cache.clear()
    base._GENAI_CLIENTS.clear()
    base._GROQ_CLIENTS.clear()
    base._MODEL_SKIP.clear()
    monkeypatch.setattr(base.random, "shuffle", lambda items: None)  # keys in the order given
    yield
    BaseAgent._run_cache.clear()
    base._GENAI_CLIENTS.clear()
    base._GROQ_CLIENTS.clear()
    base._MODEL_SKIP.clear()


@pytest.fixture
def clock(monkeypatch):
    """The resting clock (monotonic) and the wall clock (UTC), both under the test's hand."""
    state = {"now": 1000.0, "wall": datetime(2026, 10, 7, 12, 0, tzinfo=UTC)}
    monkeypatch.setattr(base, "_skip_clock", lambda: state["now"])
    monkeypatch.setattr(base, "_wall_clock", lambda: state["wall"])
    return state


def install_gemini(monkeypatch, behaviour, keys="gemini-key-1"):
    """Fake google-genai client: behaviour(key, model) -> (text, finish) | Exception | coroutine."""
    monkeypatch.setenv("GEMINI_API_KEY", keys)
    calls = []

    class FakeClient:
        def __init__(self, api_key=None, **kwargs):
            async def generate_content(*, model, contents, config):
                calls.append({"key": api_key, "model": model})
                result = behaviour(api_key, model)
                if asyncio.iscoroutine(result):
                    result = await result
                if isinstance(result, BaseException):
                    raise result
                text, finish = result
                return SimpleNamespace(text=text, candidates=[SimpleNamespace(finish_reason=finish)])

            self.aio = SimpleNamespace(models=SimpleNamespace(generate_content=generate_content))

    monkeypatch.setattr(base.genai, "Client", FakeClient)
    base._GENAI_CLIENTS.clear()
    return calls


def install_groq(monkeypatch, behaviour):
    calls = []

    class FakeGroq:
        def __init__(self, api_key=None, max_retries=None, **kwargs):
            async def create(**kwargs):
                calls.append(kwargs["model"])
                result = behaviour(kwargs)
                if asyncio.iscoroutine(result):
                    result = await result
                if isinstance(result, BaseException):
                    raise result
                return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=result), finish_reason="stop")])

            self.chat = SimpleNamespace(completions=SimpleNamespace(create=create))

    monkeypatch.setattr(base, "AsyncGroq", FakeGroq)
    base._GROQ_CLIENTS.clear()
    return calls


def run(agent, text, **kwargs):
    return asyncio.run(agent.run(PROMPT, text, use_cache=False, **kwargs))


def quota_error(retry_delay=None, per_day=False):
    """Gemini's free-tier 429 as the API sends it: QuotaFailure (+ RetryInfo) in error.details."""
    period = "PerDay" if per_day else "PerMinute"
    details = [{
        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
        "violations": [{
            "quotaMetric": "generativelanguage.googleapis.com/generate_content_free_tier_requests",
            "quotaId": f"GenerateRequests{period}PerProjectPerModel-FreeTier",
            "quotaDimensions": {"location": "global", "model": "gemini-3.1-flash-lite"},
            "quotaValue": "500",
        }],
    }]
    if retry_delay is not None:
        details.append({"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": retry_delay})
    return genai_errors.ClientError(429, {"error": {"code": 429, "message": "You exceeded your current quota.",
                                                    "status": "RESOURCE_EXHAUSTED", "details": details}})


def groq_rate_limit(retry_after=None):
    import groq

    request = httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions")
    headers = {"retry-after": retry_after} if retry_after is not None else {}
    return groq.RateLimitError("Error code: 429", response=httpx.Response(429, request=request, headers=headers), body=None)


# --- Retry-After / retryDelay ---------------------------------------------------------------------

def test_a_429_rests_that_pair_for_its_retry_delay_and_the_next_calls_skip_it(monkeypatch, clock):
    monkeypatch.setenv("GEMINI_MODELS", "model-a,model-b")
    calls = install_gemini(monkeypatch, lambda key, model: quota_error("30s") if model == "model-a" else ("ок", "STOP"))
    agent = BaseAgent()
    assert run(agent, "один") == "ок"
    assert [call["model"] for call in calls] == ["model-a", "model-b"]
    assert base.pair_resting("gemini", "gemini-key-1", "model-a")
    assert not base.pair_resting("gemini", "gemini-key-1", "model-b")

    assert run(agent, "два") == "ок"
    assert [call["model"] for call in calls[2:]] == ["model-b"]  # the resting pair costs no request
    clock["now"] += 29.5
    run(agent, "три")
    assert [call["model"] for call in calls[3:]] == ["model-b"]
    clock["now"] += 1  # 30.5 s after the 429: asked again (and rests again)
    run(agent, "четыре")
    assert [call["model"] for call in calls[4:]] == ["model-a", "model-b"]


def test_only_the_pair_rests_not_the_provider_nor_the_model_on_another_key(monkeypatch, clock):
    monkeypatch.setenv("GEMINI_MODELS", "model-a")
    calls = install_gemini(
        monkeypatch, lambda key, model: quota_error("45s") if key == "key-1" else ("ок", "STOP"), keys="key-1,key-2"
    )
    agent = BaseAgent()
    assert run(agent, "один") == "ок"
    assert [(call["key"], call["model"]) for call in calls] == [("key-1", "model-a"), ("key-2", "model-a")]
    assert run(agent, "два") == "ок"
    assert [(call["key"], call["model"]) for call in calls[2:]] == [("key-2", "model-a")]
    assert base.pair_resting("gemini", "key-1", "model-a") and not base.pair_resting("gemini", "key-2", "model-a")


def test_groq_retry_after_header_rests_the_groq_pair(monkeypatch, clock):
    calls = install_groq(monkeypatch, lambda kwargs: groq_rate_limit("12"))
    agent = BaseAgent(api_key="groq-key")
    with pytest.raises(AIError) as info:
        run(agent, "один")
    assert (info.value.status_code, info.value.code) == (429, "ai_busy")
    assert calls == ["openai/gpt-oss-120b"]
    with pytest.raises(AIError):
        run(agent, "два")
    assert len(calls) == 1  # still resting: no request
    clock["now"] += 12.5
    with pytest.raises(AIError):
        run(agent, "три")
    assert len(calls) == 2


def test_rest_length_comes_from_the_header_then_retry_info_then_sixty_seconds(clock):
    assert base.cooldown_for(groq_rate_limit("7")) == (7.0, "retry")
    assert base.cooldown_for(groq_rate_limit("0")) == (base.COOLDOWN_MIN_SECONDS, "retry")
    in_two_minutes = (clock["wall"] + timedelta(minutes=2)).strftime("%a, %d %b %Y %H:%M:%S GMT")
    assert base.cooldown_for(groq_rate_limit(in_two_minutes)) == (120.0, "retry")
    assert base.cooldown_for(groq_rate_limit("soon")) == (60.0, "default")
    assert base.cooldown_for(quota_error("33.857677812s")) == (pytest.approx(33.857677812), "retry")
    assert base.cooldown_for(quota_error()) == (60.0, "default")
    assert base.cooldown_for(genai_errors.ClientError(429, {"error": {"code": 429, "status": "RESOURCE_EXHAUSTED"}})) == (60.0, "default")
    assert base.cooldown_for(groq_rate_limit(str(10 ** 9)))[0] == base.COOLDOWN_MAX_SECONDS


# --- a daily quota: until midnight in Pacific time -------------------------------------------------

@pytest.mark.parametrize(
    ("wall", "seconds"),
    [
        (datetime(2026, 10, 7, 12, 0, tzinfo=UTC), 19 * 3600),  # 05:00 PDT → 00:00 PDT = 07:00 UTC
        (datetime(2026, 11, 16, 12, 0, tzinfo=UTC), 20 * 3600),  # 04:00 PST → 00:00 PST = 08:00 UTC
        (datetime(2026, 11, 1, 8, 0, tzinfo=UTC), 24 * 3600),  # 01:00 PDT on the day of 25 hours
        (datetime(2026, 3, 8, 9, 30, tzinfo=UTC), 21.5 * 3600),  # 01:30 PST on the day of 23 hours
    ],
)
def test_a_daily_quota_rests_until_the_next_midnight_in_pacific_time(clock, wall, seconds):
    clock["wall"] = wall
    assert base.cooldown_for(quota_error("20s", per_day=True)) == (seconds, "day")


def test_a_daily_quota_429_rests_the_pair_through_the_whole_call_path(monkeypatch, clock):
    monkeypatch.setenv("GEMINI_MODELS", "model-a,model-b")
    calls = install_gemini(
        monkeypatch, lambda key, model: quota_error("20s", per_day=True) if model == "model-a" else ("ок", "STOP")
    )
    run(BaseAgent(), "один")
    clock["now"] += 19 * 3600 - 1  # 06:59:59 UTC the next day: still the old Pacific day
    run(BaseAgent(), "два")
    assert [call["model"] for call in calls] == ["model-a", "model-b", "model-b"]
    clock["now"] += 2
    run(BaseAgent(), "три")
    assert [call["model"] for call in calls[3:]] == ["model-a", "model-b"]


def test_right_after_midnight_a_daily_quota_rests_like_any_429(clock):
    clock["wall"] = datetime(2026, 10, 8, 7, 5, tzinfo=UTC)  # 00:05 PDT: the reset may still be under way
    assert base.cooldown_for(quota_error("20s", per_day=True)) == (20.0, "retry")
    assert base.cooldown_for(quota_error(per_day=True)) == (60.0, "default")


def test_the_pacific_day_follows_summer_and_winter_time_even_without_the_tz_database():
    assert base.pacific_day_position(datetime(2026, 11, 1, 8, 0, tzinfo=UTC)) == (3600.0, 86400.0)
    since, until = base.pacific_day_position(datetime(2026, 11, 1, 8, 0, tzinfo=UTC))
    assert since + until == 25 * 3600  # 01.11.2026: the United States go back to winter time
    since, until = base.pacific_day_position(datetime(2026, 3, 8, 9, 30, tzinfo=UTC))
    assert since + until == 23 * 3600
    moment = datetime(2026, 1, 1, tzinfo=UTC)
    while moment < datetime(2028, 1, 1, tzinfo=UTC):
        assert base.pacific_day_position(moment, zone=None) == base.pacific_day_position(moment), moment
        moment += timedelta(hours=5, minutes=17)


# --- every pair resting: ai_busy at once ------------------------------------------------------------

def test_every_pair_resting_is_the_usual_ai_busy_at_once_without_a_request(monkeypatch, clock):
    monkeypatch.setenv("GEMINI_MODELS", "model-a,model-b")

    async def hang(*args):
        await asyncio.sleep(5)
        return "поздно", "STOP"

    gemini_calls = install_gemini(monkeypatch, lambda key, model: hang(), keys="key-1,key-2")
    groq_calls = install_groq(monkeypatch, lambda kwargs: hang())
    for key in ("key-1", "key-2"):
        for model in ("model-a", "model-b"):
            base.rest_pair("gemini", key, model, 60)
    base.rest_pair("groq", "groq-key", "openai/gpt-oss-120b", 60)

    meta: dict = {}
    started = time.monotonic()
    with pytest.raises(AIError) as info:
        run(BaseAgent(api_key="groq-key"), "текст", timeout=30, meta=meta)
    assert time.monotonic() - started < 0.5
    assert (info.value.status_code, info.value.code, info.value.detail) == (429, "ai_busy", AI_BUSY_DETAIL)
    assert gemini_calls == [] and groq_calls == []
    assert meta["error"] == "rate_limited" and meta["provider"] is None


def test_resting_gemini_pairs_still_leave_groq(monkeypatch, clock):
    monkeypatch.setenv("GEMINI_MODELS", "model-a")
    gemini_calls = install_gemini(monkeypatch, lambda key, model: ("gemini", "STOP"))
    groq_calls = install_groq(monkeypatch, lambda kwargs: "groq")
    base.rest_pair("gemini", "gemini-key-1", "model-a", 60)
    assert run(BaseAgent(api_key="groq-key"), "текст") == "groq"
    assert gemini_calls == [] and groq_calls == ["openai/gpt-oss-120b"]


def test_the_next_pair_is_asked_at_once_after_a_429(monkeypatch, clock):
    monkeypatch.setenv("GEMINI_MODELS", "model-a")
    calls = install_gemini(
        monkeypatch, lambda key, model: quota_error() if key == "key-1" else ("ок", "STOP"), keys="key-1,key-2"
    )
    started = time.monotonic()
    assert run(BaseAgent(), "текст", timeout=2.5) == "ок"  # the quick check's budget
    assert time.monotonic() - started < 0.5
    assert [call["key"] for call in calls] == ["key-1", "key-2"]
    clock["now"] += 59
    assert base.pair_resting("gemini", "key-1", "model-a")
    clock["now"] += 2  # no RetryInfo: 60 s
    assert not base.pair_resting("gemini", "key-1", "model-a")


# --- the switch -------------------------------------------------------------------------------------

@pytest.mark.parametrize("value", ["0", "off", "false"])
def test_ai_cooldown_0_is_the_old_behaviour(monkeypatch, clock, value):
    monkeypatch.setenv("AI_COOLDOWN", value)
    monkeypatch.setenv("GEMINI_MODELS", "model-a,model-b")
    calls = install_gemini(monkeypatch, lambda key, model: quota_error("30s") if model == "model-a" else ("ок", "STOP"))
    run(BaseAgent(), "один")
    run(BaseAgent(), "два")
    assert [call["model"] for call in calls] == ["model-a", "model-b", "model-a", "model-b"]
    assert base._COOLDOWN == {}
    # A pair put to rest before the switch went off is asked as well.
    base.rest_pair("gemini", "gemini-key-1", "model-b", 600)
    run(BaseAgent(), "три")
    assert [call["model"] for call in calls[4:]] == ["model-a", "model-b"]


def test_ai_cooldown_is_on_unless_switched_off(monkeypatch):
    monkeypatch.delenv("AI_COOLDOWN", raising=False)
    assert base.cooldown_enabled()
    monkeypatch.setenv("AI_COOLDOWN", "1")
    assert base.cooldown_enabled()
    monkeypatch.setenv("AI_COOLDOWN", " 0 ")
    assert not base.cooldown_enabled()


# --- the heavy-call line ----------------------------------------------------------------------------

def test_the_heavy_line_is_first_come_first_served_and_reads_its_limit(monkeypatch):
    monkeypatch.setenv("AI_HEAVY_CONCURRENCY", "2")

    async def scenario():
        started: list[int] = []
        gates = {n: asyncio.Event() for n in range(5)}

        async def job(n):
            async with base.heavy_slot():
                started.append(n)
                await gates[n].wait()

        tasks = [asyncio.create_task(job(n)) for n in range(5)]
        await asyncio.sleep(0.01)
        assert started == [0, 1] and base.heavy_state() == {"limit": 2, "running": 2, "waiting": 3}
        tasks[2].cancel()  # a waiter that leaves takes no slot with it
        await asyncio.sleep(0.01)
        gates[1].set()
        await asyncio.sleep(0.01)
        assert started == [0, 1, 3]
        monkeypatch.setenv("AI_HEAVY_CONCURRENCY", "0")  # no limit: the rest start on the next release
        gates[0].set()
        await asyncio.sleep(0.01)
        assert started == [0, 1, 3, 4]
        gates[3].set()
        gates[4].set()
        await asyncio.gather(*tasks, return_exceptions=True)
        assert base.heavy_state()["running"] == 0 and base.heavy_state()["waiting"] == 0

    asyncio.run(scenario())


def test_ai_heavy_concurrency_defaults_to_six():
    assert base.heavy_concurrency() == 6


def _request(path: str, body: dict) -> Request:
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    sent = {"done": False}

    async def receive():
        if sent["done"]:
            return {"type": "http.disconnect"}
        sent["done"] = True
        return {"type": "http.request", "body": data, "more_body": False}

    scope = {"type": "http", "method": "POST", "path": path, "query_string": b"",
             "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(data)).encode())]}
    return Request(scope, receive)


def test_heavy_calls_wait_in_line_and_the_quick_check_and_protocol_do_not(monkeypatch):
    import exams_map
    import oral
    import oral_api
    import oral_sheet
    from agents.coordinator import CoordinatorAgent

    monkeypatch.setenv("AI_HEAVY_CONCURRENCY", "1")
    monkeypatch.setenv("AI_AGENT_TIMEOUT_SECONDS", "0.3")  # the wait in line is not part of it
    points = [{"id": "p1", "title": "Ключ отношения", "essential": True},
              {"id": "p2", "title": "Внешний ключ", "essential": False}]
    calls: list[str] = []

    async def scenario():
        judge_free = asyncio.Event()

        async def fake_run(agent, system_prompt, user_text, **kwargs):
            if system_prompt == exams_map.JUDGE_PROMPT:
                calls.append("judge")
                await judge_free.wait()
                return json.dumps({"results": []})
            if system_prompt == "АНАЛИЗ":
                calls.append("analysis")
                return json.dumps({"title": "Ключи", "subject": "БД", "content": "Ключ — атрибут.", "terms": []}, ensure_ascii=False)
            if system_prompt.startswith(oral.build_rubric_prompt(retry=False)[:40]):
                calls.append("rubric")
                return "{}"
            if system_prompt == oral_sheet.SHORT_PROMPT:
                calls.append("shorts")
                return json.dumps({"q1p1": "ключ"})
            if system_prompt == oral.build_check_prompt(None):
                calls.append("check")
                return json.dumps({"statuses": {"p1": "covered", "p2": "missing"}})
            if system_prompt == oral.build_evaluate_prompt(shorter=False):
                calls.append("evaluate")
                return json.dumps({"points": [{"id": "p1", "status": "covered", "student_quote": "ключ"},
                                              {"id": "p2", "status": "missing"}], "errors": [], "verdict": "Назван ключ."},
                                  ensure_ascii=False)
            raise AssertionError(f"unexpected prompt {system_prompt[:60]!r}")

        monkeypatch.setattr(BaseAgent, "run", fake_run)
        group = exams_map._Group(key="k", text="Ключи отношения", questions=[], hits=[])
        judge = asyncio.create_task(exams_map._ask_judge(BaseAgent(), [group], None))
        while calls != ["judge"]:
            await asyncio.sleep(0.005)

        lecture = oral.LectureMaterial("m1", "Лекция 1", "Ключ отношения — атрибут, который однозначно определяет кортеж.")
        selection = oral.select_fragments("Ключ отношения", [lecture])
        analysis = asyncio.create_task(CoordinatorAgent("")._run_agent("summarizer", "АНАЛИЗ", "Ключ — атрибут.", []))
        rubric = asyncio.create_task(oral_api._rubric_from_model(selection, "Ключ отношения", use_cache=False))
        shorts = asyncio.create_task(oral_sheet.ask_shorts("ВОПРОС q1: Ключи\nq1p1: Ключ отношения", ["q1p1"]))
        await asyncio.sleep(0.05)
        assert calls == ["judge"]  # three heavy calls wait behind the list check
        assert base.heavy_state() == {"limit": 1, "running": 1, "waiting": 3}

        checked = await oral_api.oral_check.__wrapped__(_request("/api/oral/check", {
            "question": "Ключи отношения", "points": points, "transcript": "Ключ определяет кортеж"}))
        assert checked["statuses"] == {"p1": "covered", "p2": "missing"}
        evaluated = await oral_api.oral_evaluate.__wrapped__(_request("/api/oral/evaluate", {
            "question": "Ключи отношения", "points": [dict(p, source_quote="") for p in points],
            "transcript": "Ключ определяет кортеж"}))
        assert [p["status"] for p in evaluated["points"]] == ["covered", "missing"]
        assert calls == ["judge", "check", "evaluate"]  # the quick check and the protocol never queue

        await asyncio.sleep(0.4)  # longer than the analysis deadline: it has not started yet
        judge_free.set()
        await judge
        status, _ = await analysis
        with pytest.raises(AIError):
            await rubric  # "{}" twice: no usable points (the test is about the order, not the answer)
        await shorts
        assert status != "timeout"
        assert calls[3:6] == ["analysis", "rubric", "shorts"]  # first come, first served
        assert base.heavy_state()["running"] == 0 and base.heavy_state()["waiting"] == 0

    asyncio.run(scenario())
