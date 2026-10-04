"""Распознавание устного ответа на сервере — запасной путь, когда браузер речь не распознаёт.

Браузер присылает кусок записи ответа (webm/ogg/mp4, обычно 3–25 с, режется по паузам),
сервер возвращает текст. Сначала Groq Whisper (whisper-large-v3-turbo, язык ru, подсказка —
текст вопроса, чтобы термины писались правильно), затем Gemini с той же записью. Запись нигде
не сохраняется: байты живут только в памяти этого запроса.

Whisper на тишине и шуме иногда «слышит» титры роликов («Субтитры сделал …», «Продолжение
следует…»): такие фразы отбрасываются, иначе они попали бы в ответ студента.
"""

from __future__ import annotations

import asyncio
import os
import random
import re

from agents.base import AIError, classify_error, gemini_keys, gemini_models, get_genai_client, thinking_plan

GROQ_STT_MODEL_DEFAULT = "whisper-large-v3-turbo"
GROQ_STT_TIMEOUT_SECONDS = 20.0
GEMINI_STT_TIMEOUT_SECONDS = 25.0
HINT_CHARS = 300
TEXT_CHARS = 4000

STT_FAILED_DETAIL = "Не удалось распознать речь. Повторите или продолжите текстом."
STT_UNCONFIGURED_DETAIL = "Распознавание речи на сервере не настроено. Ответьте текстом."

GEMINI_PROMPT = (
    "Это запись устного ответа студента на экзамене (русская речь). Запиши дословно всё, что сказано, "
    "с обычной пунктуацией. Ничего не добавляй, не исправляй и не пересказывай; не пиши пояснений. "
    "Если речи нет или ничего не разобрать, верни пустую строку."
)

# Фразы, которые Whisper «слышит» в тишине: титры, концовки роликов, звуки.
_PHANTOM_RE = re.compile(
    r"(?<!\w)(?:субтитр\w*|редактор\w*\s+субтитр\w*|корректор\w*|dimatorzok|amara\.org|"
    r"продолжение следует|спасибо за (?:просмотр|внимание)|подпиш(?:ись|итесь)\w*|ставьте лайк\w*|"
    r"до (?:новых )?встреч\w*|музыка|аплодисменты|смех)(?!\w)|\[[^\]]*\]|\([^)]*\)",
    re.IGNORECASE,
)
_WORD_RE = re.compile(r"[0-9A-Za-zА-Яа-яЁё]+")


def _norm(text: str) -> str:
    return " ".join(_WORD_RE.findall(text.lower().replace("ё", "е")))


def clean_transcript(text: object) -> str:
    """Текст распознавания без фантомных титров; пустая строка, если от речи ничего не осталось."""
    if not isinstance(text, str):
        return ""
    value = " ".join(text.split())
    if not value:
        return ""
    # Целиком фантом (короткая фраза из титров/звуков, «Субтитры сделал …») — речи не было.
    remaining = _WORD_RE.findall(_PHANTOM_RE.sub(" ", value))
    if not remaining or (_PHANTOM_RE.search(value) and len(_norm(value)) <= 80 and len(remaining) <= 2):
        return ""
    # Фантом в конце настоящего ответа — отрезаем только его.
    tail = re.search(r"[.!?…]\s*([^.!?…]*)$", value)
    if tail and tail.group(1) and _PHANTOM_RE.search(tail.group(1)) and len(_norm(tail.group(1))) <= 60:
        value = value[: tail.start(1)].rstrip()
    return value[:TEXT_CHARS].strip()


def _groq_key() -> str:
    return os.getenv("GROQ_API_KEY", "").strip()


async def _groq_transcribe(data: bytes, mime: str, hint: str) -> str:
    from groq import AsyncGroq

    client = AsyncGroq(api_key=_groq_key(), max_retries=1)
    extension = {"audio/ogg": "ogg", "audio/mp4": "mp4", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav",
                 "audio/aac": "m4a", "audio/m4a": "m4a", "audio/x-m4a": "m4a"}.get(mime, "webm")
    kwargs = {
        "model": os.getenv("GROQ_TRANSCRIPTION_MODEL", "").strip() or GROQ_STT_MODEL_DEFAULT,
        "file": (f"answer.{extension}", data, mime),
        "language": "ru",
        "response_format": "json",
        "temperature": 0,
    }
    if hint:
        kwargs["prompt"] = hint
    response = await asyncio.wait_for(client.audio.transcriptions.create(**kwargs), timeout=GROQ_STT_TIMEOUT_SECONDS)
    if isinstance(response, str):
        return response
    return str(getattr(response, "text", "") or "")


async def _gemini_transcribe(data: bytes, mime: str, hint: str) -> str:
    from google.genai import types

    keys = list(gemini_keys())
    random.shuffle(keys)
    prompt = GEMINI_PROMPT + (f"\nТема вопроса (для правильного написания терминов): {hint}" if hint else "")
    last: Exception | None = None
    for key in keys[:2]:
        client = get_genai_client(key)
        for model in gemini_models(fast=True)[:3]:
            plan = thinking_plan(model, "off")
            config = types.GenerateContentConfig(
                temperature=0,
                max_output_tokens=1024 + plan.allowance,
                thinking_config=plan.config,
            )
            try:
                response = await asyncio.wait_for(
                    client.aio.models.generate_content(
                        model=model,
                        contents=[types.Part.from_bytes(data=data, mime_type=mime), prompt],
                        config=config,
                    ),
                    timeout=GEMINI_STT_TIMEOUT_SECONDS,
                )
            except Exception as exc:  # noqa: BLE001 — следующая модель или ключ
                last = exc
                continue
            text = getattr(response, "text", None)
            if isinstance(text, str):
                return text
    if last is not None:
        raise last
    return ""


async def transcribe_answer(data: bytes, mime: str, hint: str = "") -> str:
    """Текст куска устного ответа ('' — речи не было). AIError, если оба сервиса не справились."""
    hint = " ".join((hint or "").split())[:HINT_CHARS]
    groq_ready = bool(_groq_key())
    gemini_ready = bool(gemini_keys())
    if not groq_ready and not gemini_ready:
        raise AIError(503, "stt_unconfigured", STT_UNCONFIGURED_DETAIL)
    rate_limited = False
    if groq_ready:
        try:
            return clean_transcript(await _groq_transcribe(data, mime, hint))
        except Exception as exc:  # noqa: BLE001 — запасной Gemini
            rate_limited = classify_error(exc) == "rate_limited"
            print(f"STT: Groq failed ({type(exc).__name__}); trying Gemini")
    if gemini_ready:
        try:
            return clean_transcript(await _gemini_transcribe(data, mime, hint))
        except Exception as exc:  # noqa: BLE001
            rate_limited = rate_limited or classify_error(exc) == "rate_limited"
            print(f"STT: Gemini failed ({type(exc).__name__})")
    if rate_limited:
        raise AIError.busy()
    raise AIError(502, "stt_failed", STT_FAILED_DETAIL)
