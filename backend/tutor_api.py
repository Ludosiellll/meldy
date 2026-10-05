"""Голосовой репетитор «Поговорить о лекции»: начало разговора и один ход (tutor.py).

POST /api/tutor/session {material_id} — бесплатно. Карточки лекции как цели разговора:
[{id, question, fragments}], название. Лекция читается токеном пользователя, и владелец
сверяется: чужой публичный материал виден, но разговаривать по нему нельзя (404, как «нет»).
Без текста — 422, без карточек — 409 no_cards.

POST /api/tutor/turn — один ход, 1 единица (tutorTurn), возвращается, если модель не ответила.
  {material_id, kind: "answer", target_id, rung: 0..2, utterance, history} — ответ на карточку:
    модель только оценивает реплику (status, intent) и пишет фразу; ход выбирает код
    (tutor.decide): подтверждение, намёк, слова лекции, объяснение, «это не по лекции».
  {material_id, kind: "question", utterance, history} — вопрос студента: ответ принимается
    только с дословной цитатой лекции (oral.verify_quote), иначе «В лекции об этом не сказано»
    и ближайший фрагмент.
Ответ: {move, say, quote: {source_id, text} | null, nearest | null, status, intent, done, rung, assisted}.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Request

import chat_stream
import oral
import quota
import supabase_rest
import tutor
from agents.base import parse_model_json
from plans import AI_COSTS
from ratelimit import limiter, user_or_ip_key

router = APIRouter()

MAX_BODY_BYTES = 16 * 1024
READ_TIMEOUT_SECONDS = 8.0
TURN_BUDGET_SECONDS = 25.0
TURN_MAX_TOKENS = 320
TURN_TEMPERATURE = 0.3

NOT_FOUND_DETAIL = "Лекция не найдена."
NO_TEXT_DETAIL = "У этой лекции нет текста — разговаривать не по чему. Добавьте её текстом: PDF, DOCX, TXT или MD."
NO_CARDS_DETAIL = "Сначала разберите лекцию: репетитор спрашивает по её карточкам."
READ_FAILED_DETAIL = "Не удалось прочитать лекцию. Повторите через минуту."
BAD_BODY_DETAIL = "Неверный формат запроса."
BODY_TOO_LARGE_DETAIL = "Запрос слишком большой."
TOO_LONG_DETAIL = "Реплика слишком длинная: можно до 1500 знаков."
EMPTY_DETAIL = "Скажите или напишите хоть что-нибудь."
UNKNOWN_TARGET_DETAIL = "Этой карточки в лекции больше нет. Начните разговор заново."
DISABLED_DETAIL = "Репетитор сейчас выключен."

_MATERIAL_ID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_TARGET_ID_RE = re.compile(r"^c\d{1,3}$")

_contexts = tutor.ContextCache()
# (user, material) → targets of the cached context (same lifetime as the context).
_targets: dict[tuple[str, str], list[tutor.Target]] = {}


def disabled() -> bool:
    return os.getenv("TUTOR_DISABLED", "").strip().lower() in ("1", "true", "yes", "on")


def _bad(detail: str = BAD_BODY_DETAIL) -> HTTPException:
    return HTTPException(status_code=400, detail=detail)


async def _read_json(request: Request) -> dict:
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail=BODY_TOO_LARGE_DETAIL)
    body = b""
    async for chunk in request.stream():
        body += chunk
        if len(body) > MAX_BODY_BYTES:
            raise HTTPException(status_code=413, detail=BODY_TOO_LARGE_DETAIL)
    try:
        value = json.loads(body)
    except (ValueError, UnicodeDecodeError):
        raise _bad() from None
    if not isinstance(value, dict):
        raise _bad()
    return value


def _user_id(request: Request) -> str:
    user = getattr(request.state, "user", None)
    if not isinstance(user, dict) or not user.get("id"):
        raise HTTPException(status_code=401, detail="Сессия истекла. Войдите снова.")
    return str(user["id"])


def _material_id(body: dict) -> str:
    material_id = body.get("material_id")
    if not isinstance(material_id, str) or not _MATERIAL_ID_RE.match(material_id):
        raise _bad()
    return material_id.lower()


async def _lecture(request: Request, user_id: str, material_id: str) -> tuple[tutor.LectureContext, list[tutor.Target]]:
    """The caller's own lecture (context and cards), from the cache or read with the caller's token."""
    context = _contexts.get(user_id, material_id)
    if context is not None and (user_id, material_id) in _targets:
        return context, _targets[(user_id, material_id)]
    try:
        async with supabase_rest.SupabaseRest(supabase_rest.bearer_token(request), timeout=READ_TIMEOUT_SECONDS) as db:
            row = await db.select_one(
                "materials", {"select": "id,user_id,title,original_text,flashcards_json", "id": f"eq.{material_id}"}
            )
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Tutor lecture read failed: {type(exc).__name__}")
        raise HTTPException(status_code=503, detail=READ_FAILED_DETAIL) from None
    if not isinstance(row, dict) or row.get("user_id") != user_id:
        raise HTTPException(status_code=404, detail=NOT_FOUND_DETAIL)
    text = row.get("original_text")
    if not isinstance(text, str) or not text.strip():
        raise HTTPException(status_code=422, detail=NO_TEXT_DETAIL)
    title = row.get("title") if isinstance(row.get("title"), str) else ""
    context = tutor.build_context(material_id, title, text)
    targets = tutor.targets_from_flashcards(row.get("flashcards_json"), context)
    fingerprint = hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]
    _contexts.put(user_id, material_id, fingerprint, context)
    _targets[(user_id, material_id)] = targets
    # The targets map follows the context cache: drop entries the cache no longer holds.
    if len(_targets) > tutor.CONTEXT_CACHE_ENTRIES * 2:
        for key in list(_targets):
            if _contexts.get(*key) is None:
                _targets.pop(key, None)
    return context, targets


def _utterance(body: dict) -> str:
    value = body.get("utterance")
    if not isinstance(value, str):
        raise _bad()
    value = " ".join(value.split())
    if len(value) > tutor.UTTERANCE_CHARS:
        raise HTTPException(status_code=413, detail=TOO_LONG_DETAIL)
    if not value:
        raise _bad(EMPTY_DETAIL)
    return value


def _passage_view(passage) -> dict:
    return {"source_id": passage.source_id, "text": " ".join(passage.text.split())[: tutor.FRAGMENT_CHARS]}


@router.post("/api/tutor/session")
@limiter.limit("30/minute", key_func=user_or_ip_key)
async def tutor_session(request: Request):
    if disabled():
        raise HTTPException(status_code=503, detail=DISABLED_DETAIL)
    user_id = _user_id(request)
    body = await _read_json(request)
    material_id = _material_id(body)
    # A new conversation reads the lecture again: the cards may have changed since the last one.
    _targets.pop((user_id, material_id), None)
    context, targets = await _lecture(request, user_id, material_id)
    if not targets:
        raise HTTPException(status_code=409, detail=NO_CARDS_DETAIL)
    passages = {passage.source_id: passage for passage in context.passages}
    return {
        "title": context.title,
        "targets": [
            {
                "id": target.id,
                "question": target.question,
                "fragments": [_passage_view(passages[sid]) for sid in target.source_ids if sid in passages],
            }
            for target in targets
        ],
    }


async def _ask_model(system_prompt: str, message: str) -> Any:
    raw = await chat_stream.complete(
        system_prompt,
        [{"role": "user", "content": message}],
        max_tokens=TURN_MAX_TOKENS,
        temperature=TURN_TEMPERATURE,
        budget=TURN_BUDGET_SECONDS,
    )
    return parse_model_json(raw)


@router.post("/api/tutor/turn")
@limiter.limit("20/minute;400/day", key_func=user_or_ip_key)
async def tutor_turn(request: Request):
    if disabled():
        raise HTTPException(status_code=503, detail=DISABLED_DETAIL)
    user_id = _user_id(request)
    body = await _read_json(request)
    material_id = _material_id(body)
    kind = body.get("kind")
    if kind not in ("answer", "question"):
        raise _bad()
    utterance = _utterance(body)
    turns = tutor.clean_history(body.get("history"))
    context, targets = await _lecture(request, user_id, material_id)

    if kind == "answer":
        target_id = body.get("target_id")
        rung = body.get("rung", 0)
        if not isinstance(target_id, str) or not _TARGET_ID_RE.match(target_id) or not isinstance(rung, int) or isinstance(rung, bool) or not 0 <= rung <= 2:
            raise _bad()
        target = next((item for item in targets if item.id == target_id), None)
        if target is None:
            raise HTTPException(status_code=409, detail=UNKNOWN_TARGET_DETAIL)
        charge = await quota.charge(request, "tutorTurn", AI_COSTS["tutorTurn"])
        async with quota.refund_on_failure(charge):
            parsed = await _ask_model(tutor.ANSWER_PROMPT, tutor.answer_message(context, target, turns, utterance, rung))
        status, intent, said = tutor.label(parsed)
        move = tutor.decide(rung, status, intent)
        quote = None
        if move.move == "redirect":
            say = tutor.REDIRECT_LINE
        elif move.move == "quote":
            quote = tutor.best_quote(context, target)
            say = tutor.QUOTE_LINE if quote else (tutor.clean_say(said, tutor.EXPLAIN_WORDS) or tutor.QUOTE_LINE)
        elif move.move == "explain":
            say = tutor.clean_say(said, tutor.EXPLAIN_WORDS)
            quote = tutor.best_quote(context, target)
        else:
            say = tutor.clean_say(said, tutor.SAY_WORDS)
        if not say and move.move == "nudge":
            say = "Подумайте ещё. Что об этом говорится в лекции?"
        if not say and move.move == "confirm":
            say = "Верно."
        if not say and move.move == "explain":
            say = "Вот как это объясняется в лекции."
        return {
            "move": move.move, "say": say, "quote": quote, "nearest": None,
            "status": status, "intent": intent, "done": move.done, "rung": move.rung, "assisted": move.assisted,
        }

    # A question of the student's own: only what a verified quote of the lecture carries.
    last_tutor = next((turn.text for turn in reversed(turns) if turn.role == "tutor"), "")
    passages, covered = tutor.pick_fragments(context, utterance, last_tutor)
    nearest = _passage_view(passages[0]) if passages else None
    if not passages or not covered:
        return {"move": "not_in_lecture", "say": tutor.NOT_IN_LECTURE_LINE, "quote": None, "nearest": nearest,
                "status": None, "intent": "question", "done": False, "rung": 0, "assisted": False}
    charge = await quota.charge(request, "tutorTurn", AI_COSTS["tutorTurn"])
    async with quota.refund_on_failure(charge):
        parsed = await _ask_model(tutor.QUESTION_PROMPT, tutor.question_message(context, passages, turns, utterance))
    answer = parsed if isinstance(parsed, dict) else {}
    say = tutor.clean_say(answer.get("say"), tutor.EXPLAIN_WORDS)
    quote = None
    if answer.get("in_lecture") is True and say:
        source_id = answer.get("source_id") if isinstance(answer.get("source_id"), str) else ""
        found = oral.verify_quote(answer.get("quote"), [(p.source_id, p.text) for p in passages], prefer=[source_id])
        if found is not None:
            ids, text = found
            quote = {"source_id": ids[0], "text": text}
    if quote is None:
        return {"move": "not_in_lecture", "say": tutor.NOT_IN_LECTURE_LINE, "quote": None, "nearest": nearest,
                "status": None, "intent": "question", "done": False, "rung": 0, "assisted": False}
    return {"move": "answer", "say": say, "quote": quote, "nearest": None,
            "status": None, "intent": "question", "done": False, "rung": 0, "assisted": False}
