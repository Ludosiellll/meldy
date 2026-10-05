"""Streamed chat replies through a chain of free model providers (the voice tutor).

The tutor answers in short spoken turns, so what matters is the time to the first words: the
reply is streamed and the fastest providers go first. Every provider is optional and used only
when its key is set:

- cerebras  — CEREBRAS_API_KEY, CEREBRAS_MODEL (OpenAI-compatible API);
- groq      — GROQ_API_KEY, TUTOR_GROQ_MODEL (else GROQ_MODEL, else the app's Groq default);
- mistral   — MISTRAL_API_KEY, MISTRAL_MODEL;
- openrouter, nvidia — OPENROUTER_API_KEY + OPENROUTER_MODEL, NVIDIA_API_KEY + NVIDIA_MODEL
  (no default model: these two serve only what the owner names);
- gemini    — GEMINI_API_KEY (the app's keys and fast models, thinking off).

TUTOR_PROVIDERS sets the order (comma-separated names); unknown names are ignored. Groq and
Gemini come last by default: the analysis and the oral checks live on their small free quotas.
A provider that answers 429 rests for its Retry-After (5–900 s), else TUTOR_COOLDOWN_SECONDS;
a rejected key or model rests for MODEL_SKIP_SECONDS. Another provider is tried only before the first words: once text has gone
out, a broken stream ends the reply instead of starting a second, different one.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Callable, Optional

import httpx

from agents.base import (
    SAFETY_SETTINGS,
    AIError,
    _record_call,
    classify_error,
    gemini_keys,
    gemini_models,
    get_genai_client,
    groq_model,
    model_skip_seconds,
    thinking_plan,
    types,
)

DEFAULT_ORDER = "cerebras,mistral,groq,gemini,openrouter,nvidia"
DEFAULT_COOLDOWN_SECONDS = 60.0
MIN_COOLDOWN_SECONDS = 5.0
MAX_COOLDOWN_SECONDS = 900.0
DEFAULT_FIRST_TOKEN_SECONDS = 4.0
DEFAULT_IDLE_SECONDS = 12.0
DEFAULT_BUDGET_SECONDS = 30.0

# Reasoning models of the gpt-oss family think before they speak; low effort keeps the pause short.
_REASONING_PREFIXES = ("gpt-oss",)


@dataclass(frozen=True)
class Provider:
    name: str
    kind: str  # "openai" | "gemini"
    base_url: str = ""
    key_env: str = ""
    model_envs: tuple[str, ...] = ()
    default_model: Optional[Callable[[], str]] = None
    # Largest prompt (system + turns), in characters, the provider takes on its free plan.
    max_prompt_chars: int = 60000


def _groq_default() -> str:
    return groq_model()


PROVIDERS: dict[str, Provider] = {
    "cerebras": Provider(
        "cerebras", "openai", "https://api.cerebras.ai/v1", "CEREBRAS_API_KEY", ("CEREBRAS_MODEL",),
        lambda: "gpt-oss-120b",
        # The free plan caps the context at 8192 tokens; ~2.5 characters of Russian per token
        # plus the reply leave about 16 000 characters for the prompt.
        max_prompt_chars=16000,
    ),
    "groq": Provider(
        "groq", "openai", "https://api.groq.com/openai/v1", "GROQ_API_KEY", ("TUTOR_GROQ_MODEL", "GROQ_MODEL"),
        _groq_default,
        # 8000 tokens a minute on the free plan: a long prompt would take the whole minute.
        max_prompt_chars=14000,
    ),
    "mistral": Provider(
        "mistral", "openai", "https://api.mistral.ai/v1", "MISTRAL_API_KEY", ("MISTRAL_MODEL",),
        lambda: "mistral-small-latest",
    ),
    "openrouter": Provider("openrouter", "openai", "https://openrouter.ai/api/v1", "OPENROUTER_API_KEY", ("OPENROUTER_MODEL",)),
    "nvidia": Provider("nvidia", "openai", "https://integrate.api.nvidia.com/v1", "NVIDIA_API_KEY", ("NVIDIA_MODEL",)),
    "gemini": Provider("gemini", "gemini", key_env="GEMINI_API_KEY"),
}

# Tests replace the HTTP transport of the OpenAI-compatible providers.
_transport: Optional[httpx.AsyncBaseTransport] = None
_client: Optional[httpx.AsyncClient] = None

# provider name → monotonic time until which it rests.
_RESTING: dict[str, float] = {}


def _clock() -> float:
    return time.monotonic()


def _env_seconds(name: str, default: float) -> float:
    try:
        value = float(os.getenv(name, "").strip() or default)
    except ValueError:
        return default
    return value if value > 0 else default


def cooldown_seconds() -> float:
    return _env_seconds("TUTOR_COOLDOWN_SECONDS", DEFAULT_COOLDOWN_SECONDS)


def first_token_seconds() -> float:
    return _env_seconds("TUTOR_FIRST_TOKEN_SECONDS", DEFAULT_FIRST_TOKEN_SECONDS)


def idle_seconds() -> float:
    return _env_seconds("TUTOR_IDLE_SECONDS", DEFAULT_IDLE_SECONDS)


def _http() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(transport=_transport, timeout=httpx.Timeout(30.0, connect=5.0))
    return _client


def reset_state() -> None:
    """Forget resting providers and the shared client (tests)."""
    global _client
    _RESTING.clear()
    _client = None


def _key(provider: Provider) -> str:
    if provider.kind == "gemini":
        keys = gemini_keys()
        return keys[0] if keys else ""
    return os.getenv(provider.key_env, "").strip()


def _model(provider: Provider) -> str:
    for env in provider.model_envs:
        value = os.getenv(env, "").strip()
        if value:
            return value
    return provider.default_model() if provider.default_model else ""


def configured_providers() -> list[Provider]:
    """Providers in TUTOR_PROVIDERS order that have a key (and a model for the OpenAI-compatible ones)."""
    names = [name.strip().lower() for name in (os.getenv("TUTOR_PROVIDERS", "") or DEFAULT_ORDER).split(",")]
    chosen: list[Provider] = []
    for name in names:
        provider = PROVIDERS.get(name)
        if provider is None or provider in chosen or not _key(provider):
            continue
        if provider.kind == "openai" and not _model(provider):
            continue
        chosen.append(provider)
    return chosen


def _resting(name: str) -> bool:
    until = _RESTING.get(name)
    if until is None:
        return False
    if _clock() >= until:
        _RESTING.pop(name, None)
        return False
    return True


def _rest(name: str, seconds: float) -> None:
    _RESTING[name] = max(_RESTING.get(name, 0.0), _clock() + seconds)


@dataclass
class _Attempt:
    """What the chain saw, to name the error when no provider answered."""

    rate_limited: bool = False
    timed_out: bool = False
    tried: int = 0
    kinds: list[str] = field(default_factory=list)

    def note(self, kind: str) -> None:
        self.kinds.append(kind)
        if kind == "rate_limited":
            self.rate_limited = True
        elif kind == "timeout":
            self.timed_out = True

    def error(self, configured: bool) -> AIError:
        if not configured:
            return AIError.unconfigured()
        if self.rate_limited:
            return AIError.busy()
        if self.timed_out:
            return AIError.timeout()
        return AIError.failed()


class _ProviderFailed(Exception):
    def __init__(self, kind: str, detail: str = "", retry_after: Optional[float] = None):
        super().__init__(detail or kind)
        self.kind = kind
        self.retry_after = retry_after


def _retry_after(value: Optional[str]) -> Optional[float]:
    """Seconds from a Retry-After header (a number of seconds), clamped; None when absent or a date."""
    try:
        seconds = float((value or "").strip())
    except ValueError:
        return None
    return min(MAX_COOLDOWN_SECONDS, max(MIN_COOLDOWN_SECONDS, seconds))


class StreamBroken(Exception):
    """The reply stopped after some text had already gone out."""


def _status_kind(status: int) -> str:
    if status == 429:
        return "rate_limited"
    if status in (401, 403):
        return "permission"
    if status == 404:
        return "not_found"
    if status in (400, 422):
        return "invalid_argument"
    if status in (408, 504):
        return "timeout"
    return "other"


def _reasoning(model: str) -> bool:
    return model.strip().lower().rsplit("/", 1)[-1].startswith(_REASONING_PREFIXES)


def _openai_body(provider: Provider, model: str, system_prompt: str, turns: list[dict], *, max_tokens: int,
                 temperature: float, reasoning_hint: bool) -> dict:
    messages = [{"role": "system", "content": system_prompt}] + [
        {"role": "assistant" if turn["role"] == "assistant" else "user", "content": turn["content"]} for turn in turns
    ]
    body: dict[str, Any] = {"model": model, "messages": messages, "stream": True, "temperature": temperature,
                            "max_tokens": max_tokens}
    if reasoning_hint and _reasoning(model):
        body["reasoning_effort"] = "low"
        # A reasoning model spends hidden tokens from the same budget as the spoken answer.
        body["max_tokens"] = max_tokens + 512
        if provider.name == "groq":
            body["include_reasoning"] = False
    return body


async def _openai_deltas(provider: Provider, key: str, body: dict) -> AsyncIterator[str]:
    """Text deltas of one streamed chat completion; _ProviderFailed before the first byte of text."""
    url = provider.base_url.rstrip("/") + "/chat/completions"
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json", "Accept": "text/event-stream"}
    try:
        async with _http().stream("POST", url, headers=headers, json=body) as response:
            if response.status_code >= 400:
                raw = (await response.aread())[:400].decode("utf-8", "replace")
                raise _ProviderFailed(_status_kind(response.status_code), raw,
                                      _retry_after(response.headers.get("retry-after")))
            async for line in response.aiter_lines():
                line = line.strip()
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    return
                try:
                    chunk = json.loads(data)
                except ValueError:
                    continue
                if isinstance(chunk, dict) and chunk.get("error"):
                    raise _ProviderFailed("other", str(chunk.get("error"))[:200])
                for choice in (chunk.get("choices") or []) if isinstance(chunk, dict) else []:
                    delta = (choice or {}).get("delta") or {}
                    text = delta.get("content")
                    if isinstance(text, str) and text:
                        yield text
    except _ProviderFailed:
        raise
    except Exception as exc:
        raise _ProviderFailed(classify_error(exc), type(exc).__name__) from exc


async def _gemini_deltas(model: str, key: str, system_prompt: str, turns: list[dict], *, max_tokens: int,
                         temperature: float) -> AsyncIterator[str]:
    plan = thinking_plan(model, "off")
    config: dict[str, Any] = {
        "system_instruction": system_prompt,
        "temperature": temperature,
        "max_output_tokens": max_tokens + plan.allowance,
        "safety_settings": SAFETY_SETTINGS,
    }
    if plan.config is not None:
        config["thinking_config"] = plan.config
    contents = [
        types.Content(role="model" if turn["role"] == "assistant" else "user", parts=[types.Part(text=turn["content"])])
        for turn in turns
    ]
    try:
        stream = await get_genai_client(key).aio.models.generate_content_stream(
            model=model, contents=contents, config=types.GenerateContentConfig(**config),
        )
        async for chunk in stream:
            text = getattr(chunk, "text", None)
            if isinstance(text, str) and text:
                yield text
    except Exception as exc:
        raise _ProviderFailed(classify_error(exc), type(exc).__name__) from exc


def _fit(turns: list[dict], system_prompt: str, limit: int) -> list[dict]:
    """The latest turns that fit ``limit`` characters with the system prompt (the last one always)."""
    room = limit - len(system_prompt)
    kept: list[dict] = []
    for turn in reversed(turns):
        size = len(turn["content"])
        if kept and size > room:
            break
        kept.append(turn)
        room -= size
    kept.reverse()
    return kept


async def _with_first_token(source: AsyncIterator[str], first: float, idle: float, deadline: float) -> AsyncIterator[str]:
    """Pass ``source`` through; time out waiting for the first piece, then between pieces."""
    iterator = source.__aiter__()
    waited_first = False
    try:
        while True:
            left = deadline - _clock()
            if left <= 0:
                raise _ProviderFailed("timeout", "budget")
            limit = min(left, idle if waited_first else first)
            try:
                piece = await asyncio.wait_for(iterator.__anext__(), timeout=limit)
            except StopAsyncIteration:
                return
            except asyncio.TimeoutError as exc:
                raise _ProviderFailed("timeout", "slow") from exc
            waited_first = True
            yield piece
    finally:
        closer = getattr(iterator, "aclose", None)
        if closer is not None:
            try:
                await closer()
            except Exception:
                pass


async def stream_reply(
    system_prompt: str,
    turns: list[dict],
    *,
    max_tokens: int = 320,
    temperature: float = 0.5,
    budget: float = DEFAULT_BUDGET_SECONDS,
    meta: Optional[dict] = None,
) -> AsyncIterator[str]:
    """Text of the reply in pieces as they come, from the first provider that starts answering.

    ``turns`` are {"role": "user" | "assistant", "content": str}, oldest first, the last one the
    student's. Raises AIError (429 busy, 502 failed, 503 unconfigured, 504 timeout) when no
    provider started; StreamBroken when one stopped after some text (the text already sent stays).
    ``meta`` gets provider, model and ms of the answering provider.
    """
    providers = configured_providers()
    attempt = _Attempt()
    started = _clock()
    deadline = started + max(1.0, budget)
    for provider in providers:
        if _resting(provider.name):
            continue
        if deadline - _clock() <= 0.5:
            attempt.note("timeout")
            break
        key = _key(provider)
        models = gemini_models(fast=True)[:2] if provider.kind == "gemini" else [_model(provider)]
        for model in models:
            fitted = _fit(turns, system_prompt, provider.max_prompt_chars)
            hint = True
            while True:
                attempt.tried += 1
                if provider.kind == "gemini":
                    source = _gemini_deltas(model, key, system_prompt, fitted, max_tokens=max_tokens, temperature=temperature)
                else:
                    body = _openai_body(provider, model, system_prompt, fitted, max_tokens=max_tokens,
                                        temperature=temperature, reasoning_hint=hint)
                    source = _openai_deltas(provider, key, body)
                sent = False
                try:
                    async for piece in _with_first_token(source, first_token_seconds(), idle_seconds(), deadline):
                        if not sent:
                            sent = True
                            if isinstance(meta, dict):
                                meta.update(provider=provider.name, model=model, first_ms=int((_clock() - started) * 1000))
                        yield piece
                except _ProviderFailed as failure:
                    kind = failure.kind
                    _record_call(provider.name, model, False, int((_clock() - started) * 1000))
                    print(f"Tutor {provider.name} failed: model={model} kind={kind} {str(failure)[:160]!r}")
                    if sent:
                        raise StreamBroken(kind) from failure
                    attempt.note(kind)
                    if kind == "invalid_argument" and hint and provider.kind == "openai" and _reasoning(model):
                        hint = False  # this provider may not take the reasoning fields: once without them
                        continue
                    if kind == "rate_limited":
                        _rest(provider.name, failure.retry_after or cooldown_seconds())
                    elif kind in ("permission", "not_found"):
                        _rest(provider.name, model_skip_seconds())
                    break
                else:
                    if sent:
                        ms = int((_clock() - started) * 1000)
                        if isinstance(meta, dict):
                            meta["ms"] = ms
                        _record_call(provider.name, model, True, ms)
                        return
                    attempt.note("empty")
                    break
            if _resting(provider.name):
                break
    raise attempt.error(configured=bool(providers))


async def complete(system_prompt: str, turns: list[dict], **options: Any) -> str:
    """The whole reply as one text (for answers that are read as a whole, e.g. JSON).

    A reply broken halfway is no answer: it raises AIError.failed like a provider that never started.
    """
    pieces: list[str] = []
    try:
        async for piece in stream_reply(system_prompt, turns, **options):
            pieces.append(piece)
    except StreamBroken as exc:
        raise AIError.failed() from exc
    text = "".join(pieces)
    if not text.strip():
        raise AIError.failed()
    return text
