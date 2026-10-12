"""GET /api/health/deep: one real, tiny call to each service the app depends on.

Public, like /api/health (the auth middleware in main.py lets exactly these two paths through),
so it is built not to cost anything worth abusing:

- the whole answer is kept in memory for CACHE_SECONDS (10 minutes), and requests that arrive
  while a check is running wait for that same check: the providers see at most one round of
  calls per 10 minutes however often the /check page, the keepalive job or anyone else asks;
- the shared rate limiter caps the requests themselves.

Checks (they run side by side, each with its own short time limit):
- gemini: the first model of the configured list (GEMINI_MODELS) that answers a one-word prompt with
  the settings of the app's ordinary calls; a key-level refusal (permission, rate limit) tries the
  next key for the same model, as the app itself would. Every model that failed is listed with its
  code (`tried`), and the answering model is asked once more as the quick checks ask it, thinking
  off (`fast`);
- groq: the main model (GROQ_MODEL, the spare for analysis) and the fast one (GROQ_FAST_MODEL, the
  spare for quick checks), each with its code;
- tts: edge-tts, the engine behind /api/tts, synthesises one short word in the examiner's voice;
- supabase: GET {SUPABASE_URL}/auth/v1/health with the anon key, as the server reaches it.

Each check reports ok, the provider and model, milliseconds and a short code: an error kind of
agents.base.classify_error (timeout, rate_limited, not_found, permission, network, empty, other),
http_<status> for Supabase, or unconfigured; `detail` is the provider's own short code when it gave
one («model_decommissioned», «invalid_argument:thinking»). Keys, URLs and provider error text never
leave here.
"""
import asyncio
import os
import time
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Optional

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

import try_api
from agents import base as ai_base
from ratelimit import limiter

router = APIRouter()

CACHE_SECONDS = 600.0
RATE_LIMIT = "10/minute"

PROMPT = "Проверка связи. Ответь одним словом: да."
AI_MAX_TOKENS = 16
AI_CALL_SECONDS = 8.0
GEMINI_BUDGET_SECONDS = 20.0
GEMINI_MAX_MODELS = 3
GEMINI_MAX_KEYS = 2
# A refusal tied to the key, not the model: the same model may answer with another key.
_KEY_LEVEL_CODES = frozenset({"permission", "rate_limited"})

TTS_TEXT = "Проверка."
# The examiner's voice of /api/tts (EDGE_TTS_VOICES["professor"] in main.py).
TTS_VOICE = "ru-RU-DmitryNeural"
TTS_SECONDS = 10.0

SUPABASE_SECONDS = 5.0

CHECK_ORDER = ("gemini", "groq", "tts", "supabase")

# Tests replace these: the clock of the cache and the transport of the Supabase request.
_clock: Callable[[], float] = time.monotonic
_supabase_transport: Optional[httpx.AsyncBaseTransport] = None

_state: dict[str, Any] = {"result": None, "at": None, "task": None}


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _elapsed_ms(started: float) -> int:
    return max(0, int((time.monotonic() - started) * 1000))


def _check(ok: bool, provider: str, model: Optional[str], ms: int, code: Optional[str], **extra: Any) -> dict[str, Any]:
    result: dict[str, Any] = {"ok": bool(ok), "provider": provider, "model": model, "ms": max(0, int(ms)),
                              "code": None if ok else (code or "other")}
    result.update(extra)
    return result


def _failure(model: str, call: dict) -> dict[str, Any]:
    return {"model": model, "code": call.get("error") or "other", "detail": call.get("detail")}


async def check_gemini() -> dict[str, Any]:
    keys = ai_base.gemini_keys()[:GEMINI_MAX_KEYS]
    models = ai_base.gemini_models_env()[:GEMINI_MAX_MODELS]
    if not keys or not models:
        return _check(False, "Gemini", None, 0, "unconfigured", fallback=False, tried=[])
    started = time.monotonic()
    deadline = started + GEMINI_BUDGET_SECONDS
    code = "other"
    tried: list[dict[str, Any]] = []
    for position, model in enumerate(models):
        for key in keys:
            remaining = deadline - time.monotonic()
            if remaining < 1.0:
                return _check(False, "Gemini", None, _elapsed_ms(started), "timeout", fallback=False, tried=tried)
            # The app's ordinary call: thinking as BaseAgent sends it without a mode.
            call = await ai_base.probe_gemini_call(
                key, model, PROMPT, max_tokens=AI_MAX_TOKENS, json_mode=False, thinking=None,
                timeout=min(AI_CALL_SECONDS, remaining),
            )
            if call.get("ok"):
                ms = call.get("ms", 0)
                fast: Optional[dict[str, Any]] = None
                remaining = deadline - time.monotonic()
                if remaining >= 1.0:
                    quick = await ai_base.probe_gemini_call(
                        key, model, PROMPT, max_tokens=AI_MAX_TOKENS, json_mode=False, thinking="off",
                        timeout=min(AI_CALL_SECONDS, remaining),
                    )
                    fast = {"ok": bool(quick.get("ok")), "code": None if quick.get("ok") else (quick.get("error") or "other"),
                            "detail": quick.get("detail")}
                return _check(True, "Gemini", model, ms, None, fallback=position > 0, tried=tried, fast=fast)
            code = call.get("error") or "other"
            if code not in _KEY_LEVEL_CODES:
                tried.append(_failure(model, call))
                break  # the model itself failed: the next model, not the next key
        else:
            tried.append(_failure(model, {"error": code}))
    return _check(False, "Gemini", None, _elapsed_ms(started), code, fallback=False, tried=tried)


async def _groq_model(key: str, model: str) -> dict[str, Any]:
    call = await ai_base.probe_groq_call(key, model, PROMPT, max_tokens=AI_MAX_TOKENS, json_mode=False,
                                         timeout=AI_CALL_SECONDS)
    ok = bool(call.get("ok"))
    return {"model": model, "ok": ok, "ms": call.get("ms", 0), "code": None if ok else (call.get("error") or "other"),
            "detail": None if ok else call.get("detail")}


async def check_groq() -> dict[str, Any]:
    """Groq is the spare provider: ok when its main model answers; the fast model is reported beside it."""
    key = os.getenv("GROQ_API_KEY", "").strip()
    model = ai_base.groq_model()
    fast_model = ai_base.groq_fast_model()
    if not key:
        return _check(False, "Groq", model, 0, "unconfigured")
    main, fast = await asyncio.gather(_groq_model(key, model), _groq_model(key, fast_model))
    return _check(main["ok"], "Groq", model, main["ms"], main["code"], detail=main["detail"],
                  fast={key: fast[key] for key in ("model", "ok", "code", "detail")})


async def synthesize(text: str, voice: str) -> bytes:
    """The clip of ``text`` from edge-tts on the host /api/tts uses (no cache: the check must reach the service)."""
    import edge_voice

    return await edge_voice.synthesize(text, voice)


def _tts_code(exc: BaseException) -> str:
    if isinstance(exc, (asyncio.TimeoutError, TimeoutError)):
        return "timeout"
    if type(exc).__name__ == "NoAudioReceived":
        return "empty"
    module = type(exc).__module__ or ""
    if isinstance(exc, OSError) or module.startswith("aiohttp") or type(exc).__name__ == "WebSocketError":
        return "network"
    return "other"


async def check_tts() -> dict[str, Any]:
    started = time.monotonic()
    try:
        audio = await asyncio.wait_for(synthesize(TTS_TEXT, TTS_VOICE), timeout=TTS_SECONDS)
    except Exception as exc:  # noqa: BLE001 — reported as a code, never as text
        print(f"Deep health: speech synthesis failed ({type(exc).__name__})")
        return _check(False, "edge-tts", TTS_VOICE, _elapsed_ms(started), _tts_code(exc))
    return _check(bool(audio), "edge-tts", TTS_VOICE, _elapsed_ms(started), "empty")


def _supabase_config() -> tuple[str, str]:
    url = (os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL") or "").strip().rstrip("/")
    key = (os.getenv("SUPABASE_KEY") or os.getenv("VITE_SUPABASE_ANON_KEY") or os.getenv("VITE_SUPABASE_KEY") or "").strip()
    return url, key


async def check_supabase() -> dict[str, Any]:
    url, key = _supabase_config()
    if not url or not key:
        return _check(False, "Supabase", None, 0, "unconfigured")
    started = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=SUPABASE_SECONDS, transport=_supabase_transport) as client:
            response = await client.get(f"{url}/auth/v1/health", headers={"apikey": key})
    except httpx.TimeoutException:
        return _check(False, "Supabase", None, _elapsed_ms(started), "timeout")
    except httpx.HTTPError:
        return _check(False, "Supabase", None, _elapsed_ms(started), "network")
    ok = response.status_code == 200
    return _check(ok, "Supabase", None, _elapsed_ms(started), f"http_{response.status_code}")


CHECKS: dict[str, Callable[[], Awaitable[dict[str, Any]]]] = {
    "gemini": check_gemini,
    "groq": check_groq,
    "tts": check_tts,
    "supabase": check_supabase,
}
_PROVIDERS = {"gemini": "Gemini", "groq": "Groq", "tts": "edge-tts", "supabase": "Supabase"}


async def _guarded(name: str) -> dict[str, Any]:
    try:
        return await CHECKS[name]()
    except Exception as exc:  # noqa: BLE001 — one broken check never hides the others
        print(f"Deep health: {name} check crashed ({type(exc).__name__})")
        return _check(False, _PROVIDERS.get(name, name), None, 0, "other")


async def _run_checks() -> dict[str, Any]:
    results = await asyncio.gather(*[_guarded(name) for name in CHECK_ORDER])
    checks = dict(zip(CHECK_ORDER, results))
    result = {
        "ok": all(check["ok"] for check in checks.values()),
        "checked_at": _now_iso(),
        "checks": checks,
    }
    _state["result"] = result
    _state["at"] = _clock()
    return result


def _view(result: dict[str, Any], age: float, cached: bool) -> dict[str, Any]:
    age_seconds = max(0, int(age))
    return {
        **result,
        "checks": {name: dict(check) for name, check in result["checks"].items()},
        "cached": cached,
        "age_seconds": age_seconds,
        "fresh_in_seconds": max(0, int(CACHE_SECONDS) - age_seconds),
    }


async def deep_health() -> dict[str, Any]:
    """The cached result while it is younger than CACHE_SECONDS, otherwise one shared new check."""
    result, at = _state.get("result"), _state.get("at")
    if result is not None and at is not None and 0 <= _clock() - at < CACHE_SECONDS:
        return _view(result, _clock() - at, cached=True)
    loop = asyncio.get_running_loop()
    task = _state.get("task")
    if task is None or task.done() or task.get_loop() is not loop:
        task = loop.create_task(_run_checks())
        _state["task"] = task
    # A client that goes away does not cancel the check that others wait for.
    fresh = await asyncio.shield(task)
    return _view(fresh, 0, cached=False)


def reset_cache() -> None:
    """Forget the stored result (tests)."""
    _state.update(result=None, at=None, task=None)


@router.get("/api/health/deep")
@limiter.limit(RATE_LIMIT)
async def health_deep(request: Request):
    """Real tiny calls to Gemini, Groq, edge-tts and Supabase; cached 10 minutes. See the module doc.

    Beside the checks, `try` — the /try example's AI check as of this moment (try_api.health_view): whose key
    it uses (own, shared or none; never the key), today's model calls against its cap, and how many answers
    of the day fell back to key words. It costs no call and is never cached.
    """
    body = await deep_health()
    body["try"] = try_api.health_view()
    return JSONResponse(body, headers={"Cache-Control": "no-store"})
