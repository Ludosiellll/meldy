"""Мост Telegram-бота к Space: голосовой ответ на устный вопрос (этап 5, флаг voice; спека бота §4.9, решения 28–29).

POST /api/bot/voice — путь без сессии (main.PUBLIC_API_PATHS). У бота нет токена студента, а у Space нет ключа
service_role и не будет. Вся власть запроса — одноразовый билет в заголовке X-Meldy-Ticket (64 hex), который функция
бота `telegram` получила из базы (bot_voice_ticket) за миг до вызова. Space берёт его ОДИН раз: public.bridge_voice_take
с публичным ключом проекта (роль anon). Билет сгорает, что бы ни ответила база; база считает секунды голоса (потолок
студента и общий стоп на 70 % дневного аудио Groq), у проверки списывает единицы ИИ (answer = 4, раз на попытку) и
отдаёт контекст задания. Функция бота (supabase/functions/_shared/bot/voice.ts) сама скачивает голосовое из Telegram и
приносит байты: Space с Telegram не говорит и токена бота не видит.

Задания (их выбирает билет, не запрос):
- transcribe — тело: голосовое из Telegram (OGG/Opus, audio/ogg, ≤ 20 МБ) → stt.transcribe_answer(data, 'audio/ogg',
  hint = текст вопроса). Пусто — not_recognized; меньше min_words слов (8 у первого голосового ответа) — too_short.
  Единиц нет.
- check — тела нет: текст ответа и пункты эталона — из билета. Быстрая проверка и протокол сайта в одно время (те же
  промпты, модели, бюджеты и разбор, что у /api/oral/check и /api/oral/evaluate: oral, oral_api.judge_answer);
  переспрос выбирает сервер (oral.choose_followup). Единицы списал take; сбой модели, пустой ответ и «не знаю»
  (dont_know, как на сайте — без модели и без единиц) возвращают их: public.bridge_voice_refund тем же билетом.
- followup — тело: голосовое ответа на вопрос экзаменатора → распознавание (hint — вопрос экзаменатора) → проверка
  одного пункта (only) с вопросом и тем, что должно прозвучать. «Не знаю» — missing без модели. Единиц нет.
Ответ — JSON {"status": …}. ok — с результатом; отказы (invalid, used, expired, off, gone, ceiling, stop, limit,
too_short, not_recognized, dont_know, busy, failed) — 200, функция бота говорит их словами §4.9. Запрос без билета
или с битым — 400; тело больше 20 МБ — 413; не audio/ogg у голосового задания — 415; база недоступна — 503.
Журнал — одна строка на вызов: задание, итог, время. Ни звука, ни текста, ни вопроса, ни id, ни билета.
"""

from __future__ import annotations

import asyncio
import json
import re
import time
from typing import Any

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

import oral
import oral_api
import stt
import supabase_rest
from agents import base as ai_base
from agents.base import AIError, BaseAgent
from ratelimit import limiter, visitor_ip_key

router = APIRouter()

BOT_VOICE_PATH = "/api/bot/voice"
TICKET_HEADER = "X-Meldy-Ticket"
MAX_AUDIO_BYTES = 20 * 1024 * 1024  # больше 20 МБ Telegram боту не отдаёт
MIN_AUDIO_BYTES = 512  # меньше — заголовок контейнера без звука (как у /api/oral/transcribe)
AUDIO_MIME = "audio/ogg"
RPC_TIMEOUT_SECONDS = 6.0
TRANSCRIPT_CHARS = oral_api.CHECK_TRANSCRIPT_CHARS  # 4000: больше быстрая проверка сайта не берёт
QUESTION_CHARS = oral_api.QUESTION_CHARS

_TICKET_RE = re.compile(r"^[0-9a-f]{64}$")
_POINT_ID_RE = re.compile(r"^p[1-6]$")
JOBS = ("transcribe", "check", "followup")
TAKE_REFUSALS = ("invalid", "used", "expired", "off", "gone", "ceiling", "stop", "limit")


def _log(job: str | None, status: str, started: float) -> None:
    """Одна строка на вызов: задание, итог, время. Ни текста, ни id, ни билета."""
    print(f"Bot voice: {job or '-'} {status} {int((time.monotonic() - started) * 1000)} ms")


def _reply(status: str, http: int = 200, **fields: Any) -> JSONResponse:
    return JSONResponse(status_code=http, content={"status": status, **fields})


# ── База: два входа для билета, публичным ключом ───────────────────────────────


class BridgeDbError(Exception):
    """База не ответила или ответила ошибкой (без тела ответа, адреса и ключа)."""


async def _rpc(fn: str, args: dict) -> dict:
    """POST /rest/v1/rpc/<fn> с публичным ключом проекта (роль anon): у Space нет и не будет ключа service_role.

    Новый ключ (sb_publishable_…) идёт только в apikey; прежний anon JWT — ещё и в Authorization (как supabase_rest).
    """
    key = supabase_rest._api_key()
    headers = {"apikey": key, "Accept": "application/json", "Content-Type": "application/json"}
    if not key.startswith("sb_"):
        headers["Authorization"] = f"Bearer {key}"
    try:
        async with httpx.AsyncClient(timeout=RPC_TIMEOUT_SECONDS, transport=supabase_rest._transport) as client:
            response = await client.post(f"{supabase_rest._base_url()}/rpc/{fn}", json=args, headers=headers)
    except (httpx.HTTPError, supabase_rest.SupabaseRestError):
        raise BridgeDbError(fn) from None
    if response.status_code >= 400:
        raise BridgeDbError(f"{fn} {response.status_code}")
    try:
        data = response.json()
    except ValueError:
        raise BridgeDbError(f"{fn} json") from None
    if not isinstance(data, dict) or not isinstance(data.get("status"), str):
        raise BridgeDbError(f"{fn} shape")
    return data


async def _refund(ticket: str) -> None:
    """Единицы проверки — назад (тем же билетом, один раз). Сбой возврата не меняет ответ: функция бота, не получив
    результата, ещё раз отпускает попытку (bot_voice_release) — двойного возврата база не допустит."""
    try:
        await _rpc("bridge_voice_refund", {"p_ticket": ticket})
    except BridgeDbError:
        print("Bot voice: refund failed; the bot releases the attempt")


# ── Контекст задания из билета ─────────────────────────────────────────────────


def _points(raw: Any, *, with_quote: bool) -> list[dict] | None:
    """Пункты эталона, как их принимают /api/oral/check и /api/oral/evaluate (oral_api._points_field); None — негодны."""
    if not isinstance(raw, list) or not 1 <= len(raw) <= oral.MAX_POINTS:
        return None
    points: list[dict] = []
    for item in raw:
        if not isinstance(item, dict):
            return None
        point_id, title, essential = item.get("id"), item.get("title"), item.get("essential", False)
        if not isinstance(point_id, str) or not _POINT_ID_RE.match(point_id) or any(p["id"] == point_id for p in points):
            return None
        if not isinstance(title, str) or not title.strip() or len(title) > oral_api.POINT_TITLE_CHARS or not isinstance(essential, bool):
            return None
        point = {"id": point_id, "title": " ".join(title.split()), "essential": essential}
        if with_quote:
            quote = item.get("source_quote") or ""
            if not isinstance(quote, str):
                return None
            point["source_quote"] = " ".join(quote.split())[: oral_api.POINT_QUOTE_CHARS]
        followup = item.get("followup")
        if isinstance(followup, dict):
            point["followup"] = {
                "question": str(followup.get("question") or "")[: oral_api.FOLLOWUP_QUESTION_CHARS],
                "expected": str(followup.get("expected") or "")[: oral_api.FOLLOWUP_EXPECTED_CHARS],
            }
        points.append(point)
    return points


def _one_line(value: Any, limit: int) -> str:
    return " ".join(str(value or "").split())[:limit]


# ── Модели: то, что делают /api/oral/check и /api/oral/evaluate ────────────────


async def quick_check(
    question: str,
    points: list[dict],
    transcript: str,
    *,
    only: str | None = None,
    followup_question: str | None = None,
    followup_expected: str | None = None,
) -> dict[str, str]:
    """Статусы пунктов, как у POST /api/oral/check: тот же промпт и вход, та же модель и бюджет (Gemini по основному
    списку, запасной быстрый Groq), тот же разбор; пустой ответ и «не знаю» — missing без модели. AIError при сбое."""
    ids = [point["id"] for point in points]
    if not oral.words(transcript) or oral.says_dont_know(transcript):
        return {point_id: "missing" for point_id in ([only] if only else ids)}
    meta: dict = {}
    raw = await oral_api._run_model(
        oral.build_check_prompt(only),
        oral.build_check_input(
            question,
            points,
            transcript,
            only=only,
            followup_question=followup_question,
            followup_expected=followup_expected if only else None,
        ),
        budget=oral_api.check_timeout_seconds(),
        gemini_timeout=oral_api.check_gemini_seconds(),
        thinking="off",
        groq_model=ai_base.groq_fast_model(),
        temperature=0,
        max_tokens=oral_api.CHECK_MAX_TOKENS,
        json_mode=True,
        meta=meta,
    )
    statuses = None if oral_api._cut_off(meta) else oral.validate_statuses(oral_api._parsed(raw), ids, only)
    if statuses is None:
        BaseAgent.forget(raw)
        raise AIError.failed()
    return statuses


async def _transcribe(data: bytes, hint: str) -> str:
    """Текст голосового (stt: Groq Whisper, затем Gemini); '' — речи нет. AIError, если не справились оба."""
    if len(data) < MIN_AUDIO_BYTES:
        return ""
    return await stt.transcribe_answer(data, AUDIO_MIME, hint)


async def _read_audio(request: Request) -> bytes | JSONResponse:
    mime = (request.headers.get("content-type") or "").split(";", 1)[0].strip().lower()
    if mime != AUDIO_MIME:
        return _reply("bad_audio", 415)
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > MAX_AUDIO_BYTES:
        return _reply("too_large", 413)
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_AUDIO_BYTES:
            return _reply("too_large", 413)
        chunks.append(chunk)
    return b"".join(chunks)


def _ai_status(exc: BaseException) -> str:
    return "busy" if isinstance(exc, AIError) and exc.status_code == 429 else "failed"


# ── Задания ────────────────────────────────────────────────────────────────────


async def _job_transcribe(request: Request, context: dict) -> JSONResponse:
    audio = await _read_audio(request)
    if isinstance(audio, JSONResponse):
        return audio
    try:
        text = await _transcribe(audio, _one_line(context.get("hint"), stt.HINT_CHARS))
    except AIError as exc:
        return _reply(_ai_status(exc))
    words = len(oral.words(text))
    if words == 0:
        return _reply("not_recognized")
    min_words = context.get("min_words")
    if isinstance(min_words, int) and words < min_words:
        return _reply("too_short", words=words)
    return _reply("ok", text=text, words=words)


async def _job_check(ticket: str, context: dict) -> JSONResponse:
    question = _one_line(context.get("question"), QUESTION_CHARS)
    transcript = str(context.get("transcript") or "")[:TRANSCRIPT_CHARS]
    with_quotes = _points(context.get("points"), with_quote=True)
    if not question or with_quotes is None:
        await _refund(ticket)
        return _reply("failed")
    points = [{key: point[key] for key in ("id", "title", "essential")} for point in with_quotes]
    if oral_api.dont_know_evaluation(with_quotes, transcript) is not None:
        # Пустой ответ и «не знаю» сайт не проверяет моделью и не списывает: единицы назад.
        await _refund(ticket)
        return _reply("dont_know")
    # Быстрая проверка (переспрос) и протокол — по одному тексту, в одно время; сбой одной отменяет другую.
    check_task = asyncio.ensure_future(quick_check(question, points, transcript))
    judge_task = asyncio.ensure_future(oral_api.judge_answer(question, with_quotes, transcript))
    try:
        statuses, protocol = await asyncio.gather(check_task, judge_task)
    except Exception as exc:  # noqa: BLE001 — сбой модели: проверки не было, единицы назад
        for task in (check_task, judge_task):
            task.cancel()
        await _refund(ticket)
        return _reply(_ai_status(exc))
    ask = oral.choose_followup(points, statuses)
    units = context.get("units") if isinstance(context.get("units"), dict) else {}
    return _reply(
        "ok",
        statuses=statuses,
        ask={"point_id": ask} if ask else None,
        protocol=protocol,
        units={"charged": units.get("charged"), "left": units.get("left")},
    )


async def _job_followup(request: Request, context: dict) -> JSONResponse:
    audio = await _read_audio(request)
    if isinstance(audio, JSONResponse):
        return audio
    points = _points(context.get("points"), with_quote=False)
    point_id = context.get("point_id")
    followup = context.get("followup") if isinstance(context.get("followup"), dict) else {}
    if points is None or not isinstance(point_id, str) or point_id not in [point["id"] for point in points]:
        return _reply("failed")
    try:
        text = await _transcribe(audio, _one_line(context.get("hint"), stt.HINT_CHARS))
    except AIError as exc:
        return _reply(_ai_status(exc))
    if not oral.words(text):
        return _reply("not_recognized")
    text = text[:TRANSCRIPT_CHARS]
    try:
        statuses = await quick_check(
            _one_line(context.get("question"), QUESTION_CHARS),
            points,
            text,
            only=point_id,
            followup_question=_one_line(followup.get("question"), oral_api.FOLLOWUP_QUESTION_CHARS) or None,
            followup_expected=_one_line(followup.get("expected"), oral_api.FOLLOWUP_EXPECTED_CHARS) or None,
        )
    except Exception as exc:  # noqa: BLE001
        return _reply(_ai_status(exc), text=text)
    return _reply("ok", text=text, followup_status=statuses.get(point_id, "missing"), judged_by="check")


@router.post(BOT_VOICE_PATH)
@limiter.limit("120/minute", key_func=visitor_ip_key)
async def bot_voice(request: Request):
    """Одно задание голосового ответа по одноразовому билету (см. описание модуля)."""
    started = time.monotonic()
    ticket = (request.headers.get(TICKET_HEADER) or "").strip()
    if not _TICKET_RE.match(ticket):
        _log(None, "no_ticket", started)
        return _reply("invalid", 400)
    try:
        context = await _rpc("bridge_voice_take", {"p_ticket": ticket})
    except BridgeDbError:
        _log(None, "unavailable", started)
        return _reply("unavailable", 503)
    status = context.get("status")
    job = context.get("job") if context.get("job") in JOBS else None
    if status != "ok" or job is None:
        result = status if status in TAKE_REFUSALS else "invalid"
        _log(job, result, started)
        return _reply(result)
    if job == "transcribe":
        response = await _job_transcribe(request, context)
    elif job == "check":
        response = await _job_check(ticket, context)
    else:
        response = await _job_followup(request, context)
    _log(job, response_status(response), started)
    return response


def response_status(response: JSONResponse) -> str:
    """Итог ответа для строки журнала (только слово статуса)."""
    try:
        value = json.loads(bytes(response.body)).get("status")
    except (ValueError, AttributeError):
        return "unknown"
    return value if isinstance(value, str) and re.match(r"^[a-z_]{1,24}$", value) else "unknown"
