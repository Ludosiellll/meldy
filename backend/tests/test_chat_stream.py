"""Ответ репетитора по частям через цепочку бесплатных провайдеров (chat_stream.py).

Провайдеры с API в духе OpenAI — подменённый транспорт httpx, Gemini — подменённый клиент.
"""
import asyncio
import json
import sys
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import chat_stream  # noqa: E402
from agents.base import AIError  # noqa: E402

KEYS = ("CEREBRAS_API_KEY", "GROQ_API_KEY", "MISTRAL_API_KEY", "OPENROUTER_API_KEY", "NVIDIA_API_KEY", "GEMINI_API_KEY")
MODELS = ("CEREBRAS_MODEL", "TUTOR_GROQ_MODEL", "GROQ_MODEL", "MISTRAL_MODEL", "OPENROUTER_MODEL", "NVIDIA_MODEL",
          "TUTOR_PROVIDERS", "GEMINI_MODELS", "GEMINI_FAST_MODELS")


def sse(*pieces: str, done: bool = True) -> bytes:
    lines = [f"data: {json.dumps({'choices': [{'delta': {'content': piece}}]}, ensure_ascii=False)}\n\n" for piece in pieces]
    if done:
        lines.append("data: [DONE]\n\n")
    return "".join(lines).encode("utf-8")


@pytest.fixture
def net(monkeypatch):
    """Сеть провайдеров: ответ по хосту — (статус, тело) или функция; все запросы записываются."""
    for name in KEYS + MODELS:
        monkeypatch.delenv(name, raising=False)
    calls: list[tuple[str, dict]] = []
    replies: dict = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode("utf-8"))
        calls.append((request.url.host, body))
        reply = replies.get(request.url.host, (500, b"{}"))
        if callable(reply):
            return await reply(request, body)
        status, content = reply
        return httpx.Response(status, content=content, headers={"content-type": "text/event-stream"})

    monkeypatch.setattr(chat_stream, "_transport", httpx.MockTransport(handler))
    chat_stream.reset_state()
    yield calls, replies
    chat_stream.reset_state()


def collect(**kwargs):
    async def run():
        pieces = []
        async for piece in chat_stream.stream_reply("Правила.", [{"role": "user", "content": "Привет"}], **kwargs):
            pieces.append(piece)
        return pieces

    return asyncio.run(run())


def test_the_first_provider_with_a_key_answers_in_pieces_and_a_reasoning_model_thinks_briefly(net, monkeypatch):
    calls, replies = net
    monkeypatch.setenv("CEREBRAS_API_KEY", "c-key")
    monkeypatch.setenv("MISTRAL_API_KEY", "m-key")
    replies["api.cerebras.ai"] = (200, sse("Хорошо. ", "Начнём."))
    meta: dict = {}
    assert collect(meta=meta) == ["Хорошо. ", "Начнём."]
    assert [host for host, _ in calls] == ["api.cerebras.ai"]
    body = calls[0][1]
    assert body["model"] == "gpt-oss-120b" and body["stream"] is True and body["reasoning_effort"] == "low"
    assert body["messages"][0] == {"role": "system", "content": "Правила."}
    assert meta["provider"] == "cerebras" and meta["model"] == "gpt-oss-120b" and "ms" in meta


def test_a_busy_provider_hands_over_and_rests(net, monkeypatch):
    calls, replies = net
    monkeypatch.setenv("CEREBRAS_API_KEY", "c-key")
    monkeypatch.setenv("MISTRAL_API_KEY", "m-key")
    replies["api.cerebras.ai"] = (429, b'{"error":"rate"}')
    replies["api.mistral.ai"] = (200, sse("Ответ."))
    assert collect() == ["Ответ."]
    assert collect() == ["Ответ."]
    # The second turn does not knock on the resting provider again.
    assert [host for host, _ in calls] == ["api.cerebras.ai", "api.mistral.ai", "api.mistral.ai"]
    assert "reasoning_effort" not in calls[1][1]  # not a reasoning model


def test_a_busy_provider_rests_as_long_as_it_asks_within_bounds(net, monkeypatch):
    calls, replies = net
    clock = [1000.0]
    monkeypatch.setattr(chat_stream, "_clock", lambda: clock[0])
    monkeypatch.setenv("CEREBRAS_API_KEY", "c-key")
    monkeypatch.setenv("MISTRAL_API_KEY", "m-key")

    async def cerebras(request, body):
        return httpx.Response(429, content=b"{}", headers={"retry-after": "2"})

    replies["api.cerebras.ai"] = cerebras
    replies["api.mistral.ai"] = (200, sse("Ответ."))
    collect()
    clock[0] += chat_stream.MIN_COOLDOWN_SECONDS - 0.5  # «2 s» is raised to the minimum rest
    collect()
    clock[0] += 1.0
    collect()
    assert [host for host, _ in calls] == ["api.cerebras.ai", "api.mistral.ai", "api.mistral.ai", "api.cerebras.ai", "api.mistral.ai"]


def test_a_rejected_key_is_skipped_for_a_while_and_order_comes_from_the_setting(net, monkeypatch):
    calls, replies = net
    monkeypatch.setenv("TUTOR_PROVIDERS", "mistral, groq")
    monkeypatch.setenv("CEREBRAS_API_KEY", "c-key")  # not in the order: never used
    monkeypatch.setenv("MISTRAL_API_KEY", "m-key")
    monkeypatch.setenv("GROQ_API_KEY", "g-key")
    replies["api.mistral.ai"] = (401, b'{"error":"key"}')
    replies["api.groq.com"] = (200, sse("Да."))
    assert collect() == ["Да."]
    assert collect() == ["Да."]
    assert [host for host, _ in calls] == ["api.mistral.ai", "api.groq.com", "api.groq.com"]
    groq_body = calls[1][1]
    assert groq_body["include_reasoning"] is False and groq_body["reasoning_effort"] == "low"


def test_a_restricted_account_rests_like_a_rejected_key(net, monkeypatch):
    calls, replies = net
    monkeypatch.setenv("TUTOR_PROVIDERS", "groq, mistral")
    monkeypatch.setenv("GROQ_API_KEY", "g-key")
    monkeypatch.setenv("MISTRAL_API_KEY", "m-key")
    replies["api.groq.com"] = (400, b'{"error":{"message":"Organization has been restricted.","type":"invalid_request_error","code":"organization_restricted"}}')
    replies["api.mistral.ai"] = (200, sse("Да."))
    assert collect() == ["Да."]
    assert collect() == ["Да."]
    # Asked once (no second try without the reasoning fields), then left alone.
    assert [host for host, _ in calls] == ["api.groq.com", "api.mistral.ai", "api.mistral.ai"]


def test_a_provider_that_refuses_the_reasoning_fields_is_asked_once_more_without_them(net, monkeypatch):
    calls, replies = net
    monkeypatch.setenv("CEREBRAS_API_KEY", "c-key")
    answers = iter([(400, b'{"error":"unknown field reasoning_effort"}'), (200, sse("Готово."))])

    async def cerebras(request, body):
        status, content = next(answers)
        return httpx.Response(status, content=content)

    replies["api.cerebras.ai"] = cerebras
    assert collect() == ["Готово."]
    assert "reasoning_effort" in calls[0][1] and "reasoning_effort" not in calls[1][1]


def test_a_silent_provider_loses_its_turn_after_the_first_token_wait(net, monkeypatch):
    calls, replies = net
    monkeypatch.setenv("TUTOR_FIRST_TOKEN_SECONDS", "0.05")
    monkeypatch.setenv("CEREBRAS_API_KEY", "c-key")
    monkeypatch.setenv("MISTRAL_API_KEY", "m-key")

    async def slow_body():
        await asyncio.sleep(1)
        yield sse("поздно")

    async def cerebras(request, body):
        return httpx.Response(200, content=slow_body())

    replies["api.cerebras.ai"] = cerebras
    replies["api.mistral.ai"] = (200, sse("Вовремя."))
    assert collect() == ["Вовремя."]
    assert [host for host, _ in calls] == ["api.cerebras.ai", "api.mistral.ai"]


def test_a_reply_broken_after_words_is_not_restarted_elsewhere(net, monkeypatch):
    calls, replies = net
    monkeypatch.setenv("CEREBRAS_API_KEY", "c-key")
    monkeypatch.setenv("MISTRAL_API_KEY", "m-key")

    async def broken_body():
        yield sse("Начало ", done=False)
        raise httpx.ReadError("cut")

    async def cerebras(request, body):
        return httpx.Response(200, content=broken_body())

    replies["api.cerebras.ai"] = cerebras
    replies["api.mistral.ai"] = (200, sse("Другой ответ."))
    got: list[str] = []

    async def run():
        async for piece in chat_stream.stream_reply("Правила.", [{"role": "user", "content": "Привет"}]):
            got.append(piece)

    with pytest.raises(chat_stream.StreamBroken):
        asyncio.run(run())
    assert got == ["Начало "]
    assert [host for host, _ in calls] == ["api.cerebras.ai"]


def test_no_keys_is_unconfigured_and_everyone_busy_is_busy(net, monkeypatch):
    calls, replies = net
    with pytest.raises(AIError) as none:
        collect()
    assert none.value.status_code == 503
    monkeypatch.setenv("CEREBRAS_API_KEY", "c-key")
    monkeypatch.setenv("MISTRAL_API_KEY", "m-key")
    replies["api.cerebras.ai"] = (429, b"{}")
    replies["api.mistral.ai"] = (429, b"{}")
    with pytest.raises(AIError) as busy:
        collect()
    assert busy.value.status_code == 429


def test_providers_without_a_named_model_are_not_used(net, monkeypatch):
    calls, replies = net
    monkeypatch.setenv("TUTOR_PROVIDERS", "openrouter,nvidia")
    monkeypatch.setenv("OPENROUTER_API_KEY", "o-key")
    monkeypatch.setenv("NVIDIA_API_KEY", "n-key")
    monkeypatch.setenv("NVIDIA_MODEL", "some/model")
    replies["integrate.api.nvidia.com"] = (200, sse("Ок."))
    assert collect() == ["Ок."]
    assert [host for host, _ in calls] == ["integrate.api.nvidia.com"]


def test_a_small_context_provider_gets_only_the_latest_turns_that_fit(net, monkeypatch):
    calls, replies = net
    monkeypatch.setenv("CEREBRAS_API_KEY", "c-key")
    replies["api.cerebras.ai"] = (200, sse("Ок."))
    turns = [{"role": "user" if i % 2 == 0 else "assistant", "content": f"{i} " + "слово " * 600} for i in range(12)]
    turns.append({"role": "user", "content": "последний вопрос"})

    async def run():
        async for _ in chat_stream.stream_reply("Правила.", turns):
            pass

    asyncio.run(run())
    sent = calls[0][1]["messages"]
    assert sent[-1]["content"] == "последний вопрос"
    assert sum(len(m["content"]) for m in sent) <= chat_stream.PROVIDERS["cerebras"].max_prompt_chars
    assert len(sent) < len(turns) + 1
    assert [m["role"] for m in sent[1:3]] in (["user", "assistant"], ["assistant", "user"])


def test_gemini_streams_with_the_turns_as_user_and_model(net, monkeypatch):
    seen: dict = {}

    class Chunk:
        def __init__(self, text):
            self.text = text

    class Models:
        async def generate_content_stream(self, *, model, contents, config):
            seen.update(model=model, roles=[c.role for c in contents], system=config.system_instruction)

            async def gen():
                for text in ("Первая. ", "Вторая."):
                    yield Chunk(text)

            return gen()

    class Client:
        class aio:  # noqa: N801 - mirrors the SDK
            models = Models()

    monkeypatch.setenv("GEMINI_API_KEY", "gm-key")
    monkeypatch.setenv("GEMINI_FAST_MODELS", "flash-a,flash-b")
    monkeypatch.setattr(chat_stream, "get_genai_client", lambda key: Client())

    async def run():
        turns = [{"role": "user", "content": "раз"}, {"role": "assistant", "content": "два"}, {"role": "user", "content": "три"}]
        return [p async for p in chat_stream.stream_reply("Правила.", turns)]

    assert asyncio.run(run()) == ["Первая. ", "Вторая."]
    assert seen == {"model": "flash-a", "roles": ["user", "model", "user"], "system": "Правила."}


def test_the_default_order_keeps_groq_and_gemini_for_the_core_features(net, monkeypatch):
    for name in ("CEREBRAS_API_KEY", "MISTRAL_API_KEY", "GROQ_API_KEY", "GEMINI_API_KEY"):
        monkeypatch.setenv(name, "k")
    assert [p.name for p in chat_stream.configured_providers()] == ["cerebras", "mistral", "groq", "gemini"]


def test_a_gemini_model_that_refuses_the_lowest_thinking_level_is_asked_with_the_next(net, monkeypatch):
    from google.genai import errors

    seen = []

    class Chunk:
        def __init__(self, text):
            self.text = text

    class Models:
        async def generate_content_stream(self, *, model, contents, config):
            level = config.thinking_config.thinking_level.name if config.thinking_config else None
            seen.append(level)
            if level == "MINIMAL":
                raise errors.ClientError(400, {"error": {"code": 400, "status": "INVALID_ARGUMENT",
                                                         "message": "thinking level not supported"}})

            async def gen():
                yield Chunk("Ответ.")

            return gen()

    class Client:
        class aio:  # noqa: N801 - mirrors the SDK
            models = Models()

    monkeypatch.setenv("GEMINI_API_KEY", "gm-key")
    monkeypatch.setenv("GEMINI_FAST_MODELS", "gemini-3.1-flash-lite")
    monkeypatch.setattr(chat_stream, "get_genai_client", lambda key: Client())
    assert collect() == ["Ответ."]
    assert seen == ["MINIMAL", "LOW"]
