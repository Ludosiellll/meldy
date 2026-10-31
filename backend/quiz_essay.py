"""«Развёрнутый ответ» контрольной: проверка по лекциям (выпуск 48, docs/kinds/CONTRACT.md §3.4).

POST /api/quiz/essay-check {attempt_id, item_id} (20/мин на пользователя). Только автор экзамена попытки: задание
читается функцией quiz_essay_task токеном автора (чужая попытка — 404 там же). Ответ сверяется с лекциями, которые
автор выбрал у вопроса (test_items.material_ids), движком экзаменатора (oral_api): пункты ответа с цитатами, которые
проверяет код (_rubric_from_model), затем протокол (judge_answer). Итог — «полно» (каждый главный пункт назван),
«частично» (назван хотя бы один пункт), «нет»; цитата — лекции к первому главному пункту, которого нет в ответе
(или к первому пункту, когда ответ полный). Оценка сохраняется quiz_essay_mark с source «ai»; слово автора потом
её меняет.

Стоимость: пункты ответа — AI_COSTS["answerPoints"], протокол — AI_COSTS["answer"], как у устного ответа; списание
с автора. Пункты одного вопроса держатся в памяти процесса (по автору, вопросу, тексту вопроса и лекциям) шесть
часов: тридцать участников одной контрольной — одни пункты. Сбой модели возвращает единицы.

Ошибки ({"detail": "<по-русски>", "code"}): 400 формат; 401 без входа; 404 не найдено (не автор); 409 unanswered
(участник ничего не написал), no_lectures (у вопроса нет лекций — оценивает автор), not_in_lectures (в лекциях нет
ответа на вопрос); 422 no_text (в лекциях нет текста), rubric_unverifiable; 429 ai_limit; 502 / 504 модель.
"""

from __future__ import annotations

import asyncio
import hashlib
import re
import time
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

import oral
import oral_api
import quota
from agents.base import AIError
from plans import AI_COSTS
from ratelimit import limiter, user_or_ip_key
from supabase_rest import SupabaseRest, SupabaseRestError, bearer_token

router = APIRouter()

_UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
QUOTE_CHARS = 600
ESSAY_CHARS = oral_api.EVALUATE_TRANSCRIPT_CHARS
POINTS_TTL_SECONDS = 6 * 3600
POINTS_CACHE_MAX = 200

NOT_FOUND_DETAIL = "Ответ не найден."
UNANSWERED_DETAIL = "Участник ничего не написал — проверять нечего."
NO_LECTURES_DETAIL = "У вопроса не выбраны лекции. Оцените ответ сами."
NOT_IN_LECTURES_DETAIL = "В выбранных лекциях нет ответа на этот вопрос. Оцените ответ сами."
READ_FAILED_DETAIL = "Не удалось прочитать ответ. Повторите через минуту."
SAVE_FAILED_DETAIL = "Проверка прошла, но оценка не сохранилась. Повторите."

# (автор, вопрос, текст вопроса, лекции) → (момент, пункты)
_points_cache: dict[tuple, tuple[float, list[dict]]] = {}


def _error(status: int, code: str, detail: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"detail": detail, "code": code})


def verdict_of(points: list[dict], evaluation: dict) -> tuple[str, str | None]:
    """«full» | «partial» | «none» и цитата лекции по статусам пунктов протокола.

    Главные пункты (essential) решают: все названы (covered) — полно. Без главных — все пункты. Хоть один пункт
    назван или назван наполовину — частично; иначе нет. Цитата — к первому главному пункту, которого нет в ответе
    (не covered), иначе к первому пункту.
    """
    statuses = {p.get("id"): p.get("status") for p in evaluation.get("points", []) if isinstance(p, dict)}
    main = [p for p in points if p.get("essential")] or list(points)
    covered = [p for p in main if statuses.get(p["id"]) == "covered"]
    some = [p for p in points if statuses.get(p["id"]) in ("covered", "partial")]
    if main and len(covered) == len(main) and not any(statuses.get(p["id"]) == "wrong" for p in points):
        verdict = "full"
    elif some:
        verdict = "partial"
    else:
        verdict = "none"
    missed = next((p for p in main if statuses.get(p["id"]) != "covered"), None)
    source = missed if verdict != "full" and missed is not None else (points[0] if points else None)
    quote = " ".join(str(source.get("source_quote") or "").split())[:QUOTE_CHARS] if source else ""
    return verdict, quote or None


def _cache_key(user: str, item_id: str, stem: str, material_ids: list[str]) -> tuple:
    return (user, item_id, hashlib.sha256(stem.encode("utf-8")).hexdigest(), tuple(material_ids))


def _cached_points(key: tuple) -> list[dict] | None:
    hit = _points_cache.get(key)
    if hit is None:
        return None
    at, points = hit
    if time.monotonic() - at > POINTS_TTL_SECONDS:
        _points_cache.pop(key, None)
        return None
    return points


def _remember_points(key: tuple, points: list[dict]) -> None:
    if len(_points_cache) >= POINTS_CACHE_MAX:
        oldest = min(_points_cache, key=lambda k: _points_cache[k][0])
        _points_cache.pop(oldest, None)
    _points_cache[key] = (time.monotonic(), points)


async def build_points(token: str, stem: str, lectures: "oral_api.ExamLectures") -> list[dict]:
    """Пункты ответа с проверенными цитатами из лекций (движок эталона устного ответа); списание answerPoints."""
    selection = await asyncio.to_thread(oral.select_fragments, stem, lectures.materials, [], corpus=lectures.corpus)
    if not selection.fragments or not selection.materials:
        raise AIError(422, "no_text", oral_api.NO_TEXT_DETAIL)
    charge = await quota.reserve(token, "answerPoints", AI_COSTS["answerPoints"])
    async with quota.refund_on_failure(charge):
        rubric, _model = await oral_api._rubric_from_model(selection, stem, use_cache=True)
    raw = rubric.get("points") if isinstance(rubric, dict) else None
    points: list[dict] = []
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict) or not isinstance(item.get("id"), str) or not str(item.get("title") or "").strip():
            continue
        points.append({
            "id": item["id"],
            "title": " ".join(str(item["title"]).split())[: oral_api.POINT_TITLE_CHARS],
            "essential": bool(item.get("essential", False)),
            "source_quote": " ".join(str(item.get("source_quote") or "").split())[: oral_api.POINT_QUOTE_CHARS],
        })
    return points


async def judge(stem: str, points: list[dict], text: str, request: Request) -> dict:
    """Протокол ответа по пунктам (judge_answer); списание answer, сбой — возврат."""
    charge = await quota.charge(request, "answer", AI_COSTS["answer"])
    async with quota.refund_on_failure(charge):
        return await oral_api.judge_answer(stem, points, text)


@router.post("/api/quiz/essay-check")
@limiter.limit("20/minute", key_func=user_or_ip_key)
async def essay_check(request: Request):
    body = await oral_api._read_json(request)
    attempt_id, item_id = body.get("attempt_id"), body.get("item_id")
    if not isinstance(attempt_id, str) or not _UUID_RE.match(attempt_id) or not isinstance(item_id, str) or not _UUID_RE.match(item_id):
        raise HTTPException(status_code=400, detail=oral_api.BAD_BODY_DETAIL)
    token = bearer_token(request)
    user = oral_api._user_id(request) or token
    async with SupabaseRest(token) as db:
        try:
            task = await db.rpc("quiz_essay_task", {"p_attempt_id": attempt_id, "p_item_id": item_id})
        except SupabaseRestError as exc:
            if exc.status in (400, 404) or exc.code in ("P0002", "PGRST116"):
                return _error(404, "not_found", NOT_FOUND_DETAIL)
            raise HTTPException(status_code=502, detail=READ_FAILED_DETAIL) from None
        if not isinstance(task, dict):
            return _error(404, "not_found", NOT_FOUND_DETAIL)
        text = str(task.get("text") or "").strip()
        stem = " ".join(str(task.get("stem") or "").split())[: oral_api.QUESTION_CHARS]
        material_ids = [m for m in (task.get("material_ids") or []) if isinstance(m, str) and _UUID_RE.match(m)]
        if not text:
            return _error(409, "unanswered", UNANSWERED_DETAIL)
        if not material_ids:
            return _error(409, "no_lectures", NO_LECTURES_DETAIL)
        key = _cache_key(user, item_id, stem, material_ids)
        points = _cached_points(key)
        if points is None:
            try:
                lectures = await oral_api.load_exam_lectures(db, material_ids)
            except SupabaseRestError:
                raise HTTPException(status_code=502, detail=READ_FAILED_DETAIL) from None
            if not lectures.materials:
                return _error(422, "no_text", oral_api.NO_TEXT_DETAIL)
            points = await build_points(token, stem, lectures)  # AIError: the app's handler answers with its code
            if not points:
                return _error(409, "not_in_lectures", NOT_IN_LECTURES_DETAIL)
            _remember_points(key, points)
        evaluation = await judge(stem, points, text[:ESSAY_CHARS], request)
        verdict, quote = verdict_of(points, evaluation)
        try:
            mark = await db.rpc("quiz_essay_mark", {
                "p_attempt_id": attempt_id, "p_item_id": item_id, "p_verdict": verdict, "p_quote": quote, "p_source": "ai",
            })
        except SupabaseRestError:
            raise HTTPException(status_code=502, detail=SAVE_FAILED_DETAIL) from None
    statuses = {p.get("id"): p.get("status") for p in evaluation.get("points", []) if isinstance(p, dict)}
    return {
        "verdict": verdict,
        "quote": quote,
        "source": "ai",
        "mark": mark if isinstance(mark, dict) else None,
        "points": [{"title": p["title"], "essential": p["essential"], "status": statuses.get(p["id"], "unrated")} for p in points],
    }


def _reset_for_tests() -> Any:
    _points_cache.clear()
