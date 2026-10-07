"""«Ответ вслух» API: эталон с цитатами, которые сверяет код, быстрая проверка и протокол.

Контракт сборки §5. Пути объявлены полностью (/api/oral/...), main.py подключает router
без префикса. Сессию проверяет общий middleware (без неё — 401), лимиты считаются по
пользователю (user_or_ip_key). Ошибки — {"detail": "<по-русски>"} (+ "code"), без текста
провайдеров и исключений. Ни один ответ не содержит оценки или балла: их считает формула
на клиенте по статусам пунктов.

POST /api/oral/rubric (20/мин). Эталон вопроса экзамена: чтение строки вопроса и строки
oral_rubrics (кэш по пользователю, question_hash, source_key, версии). Промах — лекции
экзамена, подбор фрагментов, модель (температура 0, 1800 токенов, JSON, thinking low,
30 с), проверка каждой цитаты кодом. Меньше трёх проверенных пунктов — один повтор, затем
422 rubric_unverifiable. Вопрос, которого по разметке нет в лекциях, — 409 not_in_lectures
без модели. Два одновременных запроса одного эталона (розыгрыш билета, экран билета,
шпаргалка) делят один вызов модели; общая задача ещё раз читает кэш прямо перед списанием,
так что эталон, сохранённый тем временем, не оплачивается второй раз. Ключ эталона —
oral.rubric_key (тот же у шпаргалки, oral_sheet.py). Запись — токеном пользователя (RLS),
вставка с пропуском дубликата и перечитыванием сохранённой строки; force перезаписывает
сохранённую строку. 422 rubric_unverifiable оставляет строку oral_rubric_failures по ключу (по ней
автор может пригласить группу, exam_shares.py); эталон-заглушка копии из ссылки группы (без пунктов,
unverifiable) отвечает 422 сразу, без модели и единиц.

POST /api/oral/check (40/мин). Быстрая проверка (fast, 200 токенов, бюджет
ORAL_CHECK_TIMEOUT_SECONDS = 2,5 с → 504). Статусы вне перечня и пропущенные пункты —
missing; переспрос (ask) выбирает сервер по правилу §7.5, а не модель.

POST /api/oral/evaluate (10/мин). Протокол (температура 0,2, 1500 токенов, thinking low,
15 с): каждый пункт ровно один раз, отрывки ответа — текст самой расшифровки. Ответ,
оборванный на пределе длины, не принимается (его JSON можно починить, но пункты, до
которых модель не дошла, подняли бы оценку): один повтор с 2500 токенами и просьбой
писать короче, если до конца 15 с осталось ≥ 5 с, иначе 502. Главный пункт без статуса —
тоже 502; пропущенный второстепенный — unrated.
"""

from __future__ import annotations

import asyncio
import functools
import hashlib
import json
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

from fastapi import APIRouter, HTTPException, Request

import oral
import quota
from agents.base import AIError, BaseAgent, parse_model_json
from plans import AI_COSTS
from ratelimit import limiter, user_or_ip_key
from supabase_rest import SupabaseRest, SupabaseRestError, bearer_token

router = APIRouter()

RUBRIC_TIMEOUT_SECONDS = 30.0
RUBRIC_MAX_TOKENS = 1800
CHECK_MAX_TOKENS = 200
DEFAULT_CHECK_TIMEOUT_SECONDS = 2.5
EVALUATE_TIMEOUT_SECONDS = 15.0
EVALUATE_MAX_TOKENS = 1500
EVALUATE_RETRY_MAX_TOKENS = 2500
EVALUATE_RETRY_MIN_SECONDS = 5.0  # меньше осталось из 15 с — повтор не успеет, сразу 502
GUARD_SECONDS = 0.1  # жёсткий потолок поверх бюджета BaseAgent
MAX_BODY_BYTES = 64 * 1024
QUESTION_CHARS = 1000
CHECK_TRANSCRIPT_CHARS = 4000
EVALUATE_TRANSCRIPT_CHARS = 6000
POINT_TITLE_CHARS = 200
POINT_QUOTE_CHARS = 300
FOLLOWUP_QUESTION_CHARS = 200
IN_FILTER_CHUNK = 50
RUBRIC_VERSION = 1
MODEL_CHARS = 80
RUBRIC_CONFLICT = "user_id,question_hash,source_key,rubric_version"

QUESTION_NOT_FOUND_DETAIL = "Вопрос не найден"
NOT_IN_LECTURES_DETAIL = "Этого вопроса нет в ваших лекциях — оценить ответ не по чему."
RUBRIC_UNVERIFIABLE_DETAIL = (
    "Не получилось собрать пункты ответа, где каждый подтверждён цитатой из ваших лекций. "
    "Ответьте на другой вопрос."
)
NO_TEXT_DETAIL = "В лекциях этого экзамена нет текста"
# Причина видна студенту: экзамен без лекций и лекции без текста исправляются по-разному.
NO_LECTURES_DETAIL = "К экзамену не выбраны лекции"
BAD_BODY_DETAIL = "Неверный формат запроса."
BODY_TOO_LARGE_DETAIL = "Запрос слишком большой."
CHECK_TOO_LONG_DETAIL = "Ответ слишком длинный: для проверки можно до 4000 знаков."
EVALUATE_TOO_LONG_DETAIL = "Ответ слишком длинный: для протокола можно до 6000 знаков."
SESSION_EXPIRED_DETAIL = "Сессия истекла. Войдите снова."
READ_FAILED_DETAIL = "Не удалось прочитать вопрос. Повторите через минуту."
EMPTY_ANSWER_VERDICT = "Ответа не было: ни один из пунктов не прозвучал."

_UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_POINT_ID_RE = re.compile(r"^p[1-6]$")
_HASH_RE = re.compile(r"^[0-9a-f]{32}$")
_QUESTION_COLUMNS = "id,exam_id,text,question_hash,coverage,coverage_method,evidence,materials_fingerprint"
_RUBRIC_COLUMNS = "id,rubric,model,created_at"


def check_timeout_seconds() -> float:
    """ORAL_CHECK_TIMEOUT_SECONDS (по умолчанию 2,5 с), читается при каждом вызове."""
    raw = os.getenv("ORAL_CHECK_TIMEOUT_SECONDS", "").strip()
    try:
        value = float(raw) if raw else DEFAULT_CHECK_TIMEOUT_SECONDS
    except ValueError:
        return DEFAULT_CHECK_TIMEOUT_SECONDS
    return value if value > 0 else DEFAULT_CHECK_TIMEOUT_SECONDS


# ── Тело запроса ────────────────────────────────────────────────────────────────


def _bad(detail: str = BAD_BODY_DETAIL) -> HTTPException:
    return HTTPException(status_code=400, detail=detail)


async def _read_json(request: Request, limit: int = MAX_BODY_BYTES) -> dict:
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > limit:
        raise HTTPException(status_code=413, detail=BODY_TOO_LARGE_DETAIL)
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > limit:
            raise HTTPException(status_code=413, detail=BODY_TOO_LARGE_DETAIL)
        chunks.append(chunk)
    try:
        body = json.loads(b"".join(chunks))
    except (ValueError, UnicodeDecodeError):
        raise _bad() from None
    if not isinstance(body, dict):
        raise _bad()
    return body


def _question_field(body: dict) -> str:
    question = body.get("question")
    if not isinstance(question, str) or not question.strip() or len(question) > QUESTION_CHARS:
        raise _bad()
    return " ".join(question.split())


def _transcript_field(body: dict, limit: int, too_long: str) -> str:
    transcript = body.get("transcript")
    if transcript is None:
        return ""
    if not isinstance(transcript, str):
        raise _bad()
    if len(transcript) > limit:
        raise HTTPException(status_code=413, detail=too_long)
    return transcript


def _points_field(raw: Any, *, with_quote: bool) -> list[dict]:
    if not isinstance(raw, list) or not 1 <= len(raw) <= oral.MAX_POINTS:
        raise _bad()
    points: list[dict] = []
    for item in raw:
        if not isinstance(item, dict):
            raise _bad()
        point_id = item.get("id")
        if not isinstance(point_id, str) or not _POINT_ID_RE.match(point_id) or any(p["id"] == point_id for p in points):
            raise _bad()
        title = item.get("title")
        if not isinstance(title, str) or not title.strip() or len(title) > POINT_TITLE_CHARS:
            raise _bad()
        essential = item.get("essential", False)
        if not isinstance(essential, bool):
            raise _bad()
        point = {"id": point_id, "title": " ".join(title.split()), "essential": essential}
        if with_quote:
            quote = item.get("source_quote")
            if quote is None:
                quote = ""
            if not isinstance(quote, str) or len(quote) > POINT_QUOTE_CHARS:
                raise _bad()
            point["source_quote"] = " ".join(quote.split())
        points.append(point)
    return points


# ── Вызов модели ────────────────────────────────────────────────────────────────


async def _run_model(system_prompt: str, user_text: str, *, budget: float, **options: Any) -> str:
    """Текст модели или AIError (429/502/503/504). budget — и бюджет BaseAgent, и жёсткий потолок."""
    agent = BaseAgent(api_key=os.getenv("GROQ_API_KEY", ""))
    try:
        return await asyncio.wait_for(
            agent.run(system_prompt, user_text, timeout=budget, **options), timeout=budget + GUARD_SECONDS
        )
    except asyncio.TimeoutError:
        raise AIError.timeout() from None
    except AIError:
        raise
    except Exception as exc:  # провайдерский текст пользователю не уходит
        print(f"Oral model call failed: {type(exc).__name__}")
        raise AIError.failed() from None


def _parsed(raw: Any) -> Any:
    try:
        return parse_model_json(raw)
    except Exception:
        return None


def _cut_off(meta: dict) -> bool:
    """Ответ оборван на пределе длины (Gemini MAX_TOKENS, Groq length).

    Такой ответ неполон, даже если его JSON удалось починить: BaseAgent отдаёт непустой
    текст и с этой причиной, поэтому решают вызывающие (meta приходит и для ответа из кэша).
    """
    return str(meta.get("finish_reason") or "").strip().upper() in ("MAX_TOKENS", "LENGTH")


# ── POST /api/oral/check ────────────────────────────────────────────────────────


@router.post("/api/oral/check")
@limiter.limit("40/minute;600/day", key_func=user_or_ip_key)
async def oral_check(request: Request):
    """Быстрая проверка ответа по пунктам: статусы и пункт для переспроса (или один пункт с only)."""
    body = await _read_json(request)
    question = _question_field(body)
    points = _points_field(body.get("points"), with_quote=False)
    transcript = _transcript_field(body, CHECK_TRANSCRIPT_CHARS, CHECK_TOO_LONG_DETAIL)
    ids = [point["id"] for point in points]
    only = body.get("only")
    if only is not None and (not isinstance(only, str) or only not in ids):
        raise _bad()
    followup_question = body.get("followup_question")
    if followup_question is not None and (
        not isinstance(followup_question, str) or len(followup_question) > FOLLOWUP_QUESTION_CHARS
    ):
        raise _bad()

    if not oral.words(transcript):
        # Ничего не сказано — ни один пункт не прозвучал; модель не нужна.
        statuses = {point_id: "missing" for point_id in ([only] if only else ids)}
    else:
        meta: dict = {}
        raw = await _run_model(
            oral.build_check_prompt(only),
            oral.build_check_input(question, points, transcript, only=only, followup_question=followup_question),
            budget=check_timeout_seconds(),
            fast=True,
            temperature=0,
            max_tokens=CHECK_MAX_TOKENS,
            json_mode=True,
            meta=meta,
        )
        # Оборванный ответ не читаем: пункты, до которых модель не дошла, стали бы missing.
        statuses = None if _cut_off(meta) else oral.validate_statuses(_parsed(raw), ids, only)
        if statuses is None:
            BaseAgent.forget(raw)
            raise AIError.failed()
    return {"statuses": statuses, "ask": None if only else oral.choose_followup(points, statuses)}


# ── POST /api/oral/evaluate ─────────────────────────────────────────────────────


@router.post("/api/oral/evaluate")
@limiter.limit("10/minute", key_func=user_or_ip_key)
async def oral_evaluate(request: Request):
    """Протокол: статус, отрывок ответа и комментарий по каждому пункту, ошибки, вывод."""
    body = await _read_json(request)
    question = _question_field(body)
    points = _points_field(body.get("points"), with_quote=True)
    transcript = _transcript_field(body, EVALUATE_TRANSCRIPT_CHARS, EVALUATE_TOO_LONG_DETAIL)
    if not oral.words(transcript):
        return {
            "points": [{"id": p["id"], "status": "missing", "student_quote": "", "comment": ""} for p in points],
            "errors": [],
            "verdict": EMPTY_ANSWER_VERDICT,
        }
    # Ответ на билет (быстрые проверки, переспрос и протокол) стоит AI_COSTS["answer"]:
    # списывается здесь, до модели; протокол не получился — единицы возвращаются.
    charge = await quota.charge(request, "answer", AI_COSTS["answer"])
    async with quota.refund_on_failure(charge):
        loop = asyncio.get_running_loop()
        deadline = loop.time() + EVALUATE_TIMEOUT_SECONDS
        user_text = oral.build_evaluate_input(question, points, transcript)
        for attempt in range(2):
            shorter = attempt > 0
            meta: dict = {}
            raw = await _run_model(
                oral.build_evaluate_prompt(shorter=shorter),
                user_text,
                budget=max(0.0, deadline - loop.time()) if shorter else EVALUATE_TIMEOUT_SECONDS,
                temperature=0.2,
                max_tokens=EVALUATE_RETRY_MAX_TOKENS if shorter else EVALUATE_MAX_TOKENS,
                json_mode=True,
                thinking="low",
                meta=meta,
            )
            if not _cut_off(meta):
                break
            # Протокол оборван: пункты, до которых модель не дошла, стали бы unrated, а формула
            # клиента их не считает — оценка выросла бы за счёт пропусков. Такой ответ не
            # отдаём и не держим в кэше; один повтор с запасом длины, если хватает времени.
            BaseAgent.forget(raw)
            print(f"Oral evaluate answer cut off at the length limit (attempt {attempt + 1})")
            if shorter or deadline - loop.time() < EVALUATE_RETRY_MIN_SECONDS:
                raise AIError.failed()
        result = await asyncio.to_thread(oral.validate_evaluation, _parsed(raw), points, transcript)
        if result is None:
            BaseAgent.forget(raw)
            raise AIError.failed()
    return result


# ── POST /api/oral/rubric ───────────────────────────────────────────────────────


@dataclass
class RubricJob:
    token: str
    user_id: str | None
    exam_id: str
    question: dict
    key: str
    material_ids: list[str] | None
    force: bool

    @property
    def question_text(self) -> str:
        return " ".join(str(self.question.get("text") or "").split())[:QUESTION_CHARS]

    @property
    def question_hash(self) -> str:
        return str(self.question.get("question_hash") or "")

    @property
    def evidence(self) -> list:
        evidence = self.question.get("evidence")
        return evidence if isinstance(evidence, list) else []


@dataclass
class ExamLectures:
    """Лекции экзамена, загруженные один раз на задачу шпаргалки: id по порядку, тексты, фрагменты с индексом."""

    material_ids: list[str]
    materials: list[oral.LectureMaterial]
    corpus: oral.Corpus


@dataclass
class BuiltRubric:
    """Итог общей задачи эталона: ответ /api/oral/rubric, created_at строки и списание (None — без списания)."""

    body: dict
    created_at: str | None = None
    charge: quota.Charge | None = None


# Один вызов модели на эталон: (пользователь, question_hash, source_key, режим) → задача.
_flights: dict[tuple, asyncio.Task] = {}


def _flight_done(key: tuple, task: asyncio.Task) -> None:
    if _flights.get(key) is task:
        _flights.pop(key, None)
    if not task.cancelled():
        task.exception()  # исключение получат ожидающие; здесь только помечаем его прочитанным


async def _single_flight(key: tuple, factory: Callable[[], Awaitable[Any]]) -> Any:
    """Ждать общую задачу ключа или начать её. Ушедший клиент задачу не отменяет."""
    loop = asyncio.get_running_loop()
    task = _flights.get(key)
    if task is None or task.done() or task.get_loop() is not loop:
        task = loop.create_task(factory())
        _flights[key] = task
        task.add_done_callback(functools.partial(_flight_done, key))
    return await asyncio.shield(task)


def _user_id(request: Request) -> str | None:
    user = getattr(request.state, "user", None)
    if isinstance(user, dict) and user.get("id"):
        return str(user["id"])
    return None


def _read_error(exc: SupabaseRestError) -> HTTPException:
    if exc.status == 401:
        return HTTPException(status_code=401, detail=SESSION_EXPIRED_DETAIL)
    if exc.status in (400, 403, 404, 406):
        return HTTPException(status_code=404, detail=QUESTION_NOT_FOUND_DETAIL)
    return HTTPException(status_code=503, detail=READ_FAILED_DETAIL)


def _usable_rubric(value: Any) -> bool:
    return (
        isinstance(value, dict)
        and isinstance(value.get("points"), list)
        and value.get("coverage") in ("full", "partial", "none")
    )


def _rubric_response(rubric_id: str | None, rubric: dict, *, cached: bool, saved: bool, job: RubricJob) -> dict:
    return {
        "rubric_id": rubric_id,
        "cached": cached,
        "saved": saved,
        "question_hash": job.question_hash,
        "question": job.question_text,
        "rubric": rubric,
    }


async def _exam_material_ids(db: SupabaseRest, exam_id: str) -> list[str]:
    rows = await db.select(
        "exam_materials", {"select": "material_id", "exam_id": f"eq.{exam_id}", "order": "added_at.asc,material_id.asc"}
    )
    ids = [str(row.get("material_id")) for row in rows if isinstance(row, dict) and row.get("material_id")]
    return [material_id for material_id in dict.fromkeys(ids) if _UUID_RE.match(material_id)]


async def _load_materials(db: SupabaseRest, material_ids: list[str]) -> list[oral.LectureMaterial]:
    rows: list[dict] = []
    for start in range(0, len(material_ids), IN_FILTER_CHUNK):
        chunk = material_ids[start:start + IN_FILTER_CHUNK]
        rows.extend(await db.select("materials", {"select": "id,title,original_text", "id": f"in.({','.join(chunk)})"}))
    by_id = {str(row.get("id")): row for row in rows if isinstance(row, dict)}
    materials: list[oral.LectureMaterial] = []
    for material_id in material_ids:
        row = by_id.get(material_id)
        text = row.get("original_text") if row is not None else None
        if isinstance(text, str) and text.strip():
            materials.append(oral.LectureMaterial(material_id, str(row.get("title") or ""), text))
    return materials


async def load_exam_lectures(db: SupabaseRest, material_ids: list[str]) -> ExamLectures:
    """Тексты лекций (порядок material_ids) и их фрагменты с индексом; резка — в потоке-исполнителе."""
    materials = await _load_materials(db, material_ids) if material_ids else []
    corpus = await asyncio.to_thread(oral.build_corpus, materials)
    return ExamLectures(list(material_ids), materials, corpus)


async def _stored_rubric(db: SupabaseRest, job: RubricJob) -> dict | None:
    params = {
        "select": _RUBRIC_COLUMNS,
        "question_hash": f"eq.{job.question_hash}",
        "source_key": f"eq.{job.key}",
        "rubric_version": f"eq.{RUBRIC_VERSION}",
    }
    if job.user_id:
        params["user_id"] = f"eq.{job.user_id}"
    return await db.select_one("oral_rubrics", params)


def _model_name(meta: dict) -> str:
    model = meta.get("model")
    return str(model)[:MODEL_CHARS] if isinstance(model, str) else ""


async def _rubric_from_model(selection: oral.Selection, question: str, *, use_cache: bool) -> tuple[dict, str]:
    """Проверенный эталон и имя модели. Непригодный ответ — один повтор с напоминанием о цитатах."""
    user_text = oral.build_rubric_input(question, selection)
    failure = "unusable"
    for attempt in range(2):
        meta: dict = {}
        raw = await _run_model(
            oral.build_rubric_prompt(retry=attempt > 0),
            user_text,
            budget=RUBRIC_TIMEOUT_SECONDS,
            temperature=0,
            max_tokens=RUBRIC_MAX_TOKENS,
            json_mode=True,
            thinking="low",
            use_cache=use_cache,
            meta=meta,
        )
        outcome = oral.validate_rubric(_parsed(raw), selection, question)
        if outcome.status == "ok" and outcome.rubric is not None:
            return outcome.rubric, _model_name(meta)
        BaseAgent.forget(raw)
        failure = outcome.status
        print(f"Oral rubric attempt {attempt + 1} rejected: {outcome.status} ({', '.join(outcome.dropped)[:300]})")
    if failure == "unverifiable":
        raise AIError(422, "rubric_unverifiable", RUBRIC_UNVERIFIABLE_DETAIL)
    raise AIError.failed()


async def _store_rubric(
    db: SupabaseRest, job: RubricJob, rubric: dict, model: str, selection: oral.Selection
) -> tuple[str | None, dict, bool, bool, str | None]:
    """(rubric_id, эталон, saved, cached, created_at строки). Сбой записи — saved false, эталон всё равно отдаётся."""
    material_ids = [material["material_id"] for material in selection.materials]
    values = {
        "question_hash": job.question_hash,
        "source_key": job.key,
        "material_id": material_ids[0],
        "material_ids": material_ids,
        "question": job.question_text,
        "rubric": rubric,
        "rubric_version": RUBRIC_VERSION,
        "model": model,
    }
    if job.user_id:
        values["user_id"] = job.user_id
    try:
        if job.force:
            stored = await _stored_rubric(db, job)
            if stored is not None:
                built_at = datetime.now(timezone.utc).isoformat()
                rows = await db.update(
                    "oral_rubrics",
                    {"id": f"eq.{stored['id']}", "select": "id,created_at"},
                    {
                        "rubric": rubric,
                        "model": model,
                        "created_at": built_at,
                        "material_id": material_ids[0],
                        "material_ids": material_ids,
                        "question": job.question_text,
                    },
                    require_rows=True,
                )
                return str(rows[0].get("id") or stored["id"]), rubric, True, False, _created_at(rows[0]) or built_at
        rows = await db.insert("oral_rubrics", values, on_conflict=RUBRIC_CONFLICT, ignore_duplicates=True)
        if rows and rows[0].get("id"):
            return str(rows[0]["id"]), rubric, True, False, _created_at(rows[0])
        # Такой эталон уже сохранил параллельный запрос: отдаём сохранённую строку, а не свою копию.
        stored = await _stored_rubric(db, job)
        if stored is not None and stored.get("id") and _usable_rubric(stored.get("rubric")):
            return str(stored["id"]), stored["rubric"], True, True, _created_at(stored)
    except SupabaseRestError as exc:
        print(f"Oral rubric save failed: {exc.status} {exc.code or ''}".rstrip())
    return None, rubric, False, False, None


def _created_at(row: Any) -> str | None:
    value = row.get("created_at") if isinstance(row, dict) else None
    return value if isinstance(value, str) and value else None


def shared_without_points(rubric: Any) -> bool:
    """Эталон копии экзамена из ссылки группы, у автора которого пункты этого вопроса дважды не прошли
    проверку цитат (exam_shares.is_placeholder): пунктов нет, модель не зовём — 422 rubric_unverifiable."""
    return (
        isinstance(rubric, dict)
        and isinstance(rubric.get("unverifiable"), dict)
        and rubric.get("coverage") == "none"
        and rubric.get("points") == []
    )


async def _note_unverifiable(db: SupabaseRest, job: RubricJob) -> None:
    """Пункты по этому ключу дважды не прошли проверку цитат: строка oral_rubric_failures. По ней автор может
    пригласить группу (exam_shares.py), а вопрос уходит в копию без пунктов. Сбой записи (таблицы ещё нет,
    сеть) ответ не меняет."""
    values = {
        "question_hash": job.question_hash,
        "source_key": job.key,
        "rubric_version": RUBRIC_VERSION,
        "reason": "unverifiable",
    }
    if job.user_id:
        values["user_id"] = job.user_id
    try:
        await db.insert("oral_rubric_failures", values, returning=False, on_conflict=RUBRIC_CONFLICT, ignore_duplicates=True)
    except Exception as exc:  # только журнал: эталона всё равно нет, ответ — 422
        print(f"Oral rubric failure note failed: {type(exc).__name__} {getattr(exc, 'status', '')}".rstrip())


async def _build_rubric(job: RubricJob, lectures: ExamLectures | None = None) -> BuiltRubric:
    """Общая задача эталона. lectures — лекции экзамена, уже загруженные задачей шпаргалки
    (их фрагменты режутся один раз на все вопросы); без них — чтение экзамена и лекций."""
    async with SupabaseRest(job.token) as db:
        corpus: oral.Corpus | None = None
        if lectures is not None:
            material_ids, materials, corpus = lectures.material_ids, lectures.materials, lectures.corpus
        else:
            try:
                if job.material_ids is None:
                    exam, material_ids = await asyncio.gather(
                        db.select_one("exams", {"select": "id", "id": f"eq.{job.exam_id}"}),
                        _exam_material_ids(db, job.exam_id),
                    )
                else:
                    exam = await db.select_one("exams", {"select": "id", "id": f"eq.{job.exam_id}"})
                    material_ids = job.material_ids
                if exam is None:
                    raise HTTPException(status_code=404, detail=QUESTION_NOT_FOUND_DETAIL)
                materials = await _load_materials(db, material_ids) if material_ids else []
            except SupabaseRestError as exc:
                raise _read_error(exc) from None
        if not material_ids:
            raise AIError(422, "no_lectures", NO_LECTURES_DETAIL)
        if not materials:
            raise AIError(422, "no_text", NO_TEXT_DETAIL)
        selection = await asyncio.to_thread(
            oral.select_fragments, job.question_text, materials, job.evidence, corpus=corpus
        )
        if not selection.fragments or not selection.materials:
            # Без общих слов с вопросом берётся начало первой лекции, так что пусто только без текста.
            raise AIError(422, "no_text", NO_TEXT_DETAIL)
        if not job.force:
            # Эталон мог сохраниться, пока шла эта задача (вторая вкладка, розыгрыш билета, шпаргалка):
            # читаем кэш прямо перед списанием, чтобы не платить за него второй раз.
            try:
                stored = await _stored_rubric(db, job)
            except SupabaseRestError as exc:
                raise _read_error(exc) from None
            if stored is not None and stored.get("id") and _usable_rubric(stored.get("rubric")):
                if shared_without_points(stored["rubric"]):
                    raise AIError(422, "rubric_unverifiable", RUBRIC_UNVERIFIABLE_DETAIL)
                body = _rubric_response(str(stored["id"]), stored["rubric"], cached=True, saved=True, job=job)
                return BuiltRubric(body, _created_at(stored))
            if stored is not None:
                job.force = True  # испорченная строка кэша: собрать заново и перезаписать её
        # Новые пункты ответа стоят AI_COSTS["answerPoints"] (сохранённые — бесплатно). Списание здесь,
        # в общей задаче: два одновременных запроса одного эталона платят один раз.
        charge = await quota.reserve(job.token, "answerPoints", AI_COSTS["answerPoints"])
        async with quota.refund_on_failure(charge):
            try:
                rubric, model = await _rubric_from_model(selection, job.question_text, use_cache=not job.force)
            except AIError as exc:
                if exc.code == "rubric_unverifiable":
                    await _note_unverifiable(db, job)
                raise
        rubric_id, rubric, saved, cached, created_at = await _store_rubric(db, job, rubric, model, selection)
        body = _rubric_response(rubric_id, rubric, cached=cached, saved=saved, job=job)
        return BuiltRubric(body, created_at, charge)


@router.post("/api/oral/rubric")
@limiter.limit("20/minute", key_func=user_or_ip_key)
async def oral_rubric(request: Request):
    """Эталон вопроса экзамена из кэша oral_rubrics или от модели с проверкой каждой цитаты."""
    body = await _read_json(request)
    exam_id, question_id, force = body.get("exam_id"), body.get("question_id"), body.get("force", False)
    if not isinstance(exam_id, str) or not isinstance(question_id, str):
        raise _bad()
    if force is None:
        force = False
    if not isinstance(force, bool):
        raise _bad()
    exam_id, question_id = exam_id.strip(), question_id.strip()
    if not _UUID_RE.match(exam_id) or not _UUID_RE.match(question_id):
        raise HTTPException(status_code=404, detail=QUESTION_NOT_FOUND_DETAIL)
    token = bearer_token(request)
    user_id = _user_id(request)

    try:
        async with SupabaseRest(token) as db:
            question = await db.select_one(
                "exam_questions", {"select": _QUESTION_COLUMNS, "id": f"eq.{question_id}", "exam_id": f"eq.{exam_id}"}
            )
            if question is None or not _HASH_RE.match(str(question.get("question_hash") or "")):
                raise HTTPException(status_code=404, detail=QUESTION_NOT_FOUND_DETAIL)
            if question.get("coverage") == "none":
                # По разметке ответа в лекциях нет: модель не зовём, клиент показывает ближайшие фрагменты.
                raise AIError(409, "not_in_lectures", NOT_IN_LECTURES_DETAIL)
            fingerprint = question.get("materials_fingerprint")
            material_ids: list[str] | None = None
            if not (isinstance(fingerprint, str) and fingerprint):
                material_ids = await _exam_material_ids(db, exam_id)
                if not material_ids:
                    raise AIError(422, "no_lectures", NO_LECTURES_DETAIL)
            job = RubricJob(
                token=token,
                user_id=user_id,
                exam_id=exam_id,
                question=question,
                key=oral.rubric_key(question, material_ids or []),
                material_ids=material_ids,
                force=force,
            )
            if not force:
                stored = await _stored_rubric(db, job)
                if stored is not None and stored.get("id") and _usable_rubric(stored.get("rubric")):
                    if shared_without_points(stored["rubric"]):
                        # Копия из ссылки группы: у автора пункты не прошли проверку цитат — без модели и единиц.
                        raise AIError(422, "rubric_unverifiable", RUBRIC_UNVERIFIABLE_DETAIL)
                    return _rubric_response(str(stored["id"]), stored["rubric"], cached=True, saved=True, job=job)
                if stored is not None:
                    job.force = True  # испорченная строка кэша: собрать заново и перезаписать её
    except SupabaseRestError as exc:
        raise _read_error(exc) from None

    flight = (flight_owner(user_id, token), job.question_hash, job.key, "force" if job.force else "build")
    built = await _single_flight(flight, lambda: _build_rubric(job))
    return built.body


def flight_owner(user_id: str | None, token: str) -> str:
    """Владелец общей задачи эталона: пользователь, а без него — отпечаток токена."""
    return user_id or "token:" + hashlib.sha256(token.encode("utf-8")).hexdigest()[:24]


# ── POST /api/oral/transcribe ───────────────────────────────────────────────────

# Кусок устного ответа: тело — сама запись (Content-Type: audio/webm, audio/ogg, audio/mp4 …),
# ?hint= — текст вопроса (термины). Браузер режет запись по паузам, так что кусок — секунды.
TRANSCRIBE_MAX_BYTES = 3 * 1024 * 1024
TRANSCRIBE_MIN_BYTES = 512
TRANSCRIBE_TYPES = frozenset(
    {"audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-wav", "audio/aac", "audio/m4a", "audio/x-m4a"}
)
TRANSCRIBE_TOO_LARGE_DETAIL = "Кусок записи слишком большой."
TRANSCRIBE_TYPE_DETAIL = "Такой формат записи не поддерживается."


@router.post("/api/oral/transcribe")
@limiter.limit("40/minute;3000/day", key_func=user_or_ip_key)
async def oral_transcribe(request: Request):
    """Текст куска записи устного ответа: {"text": "..."} ('' — речи не было). Запись не сохраняется."""
    import stt

    mime = (request.headers.get("content-type") or "").split(";", 1)[0].strip().lower()
    if mime not in TRANSCRIBE_TYPES:
        raise HTTPException(status_code=415, detail=TRANSCRIBE_TYPE_DETAIL)
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > TRANSCRIBE_MAX_BYTES:
        raise HTTPException(status_code=413, detail=TRANSCRIBE_TOO_LARGE_DETAIL)
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > TRANSCRIBE_MAX_BYTES:
            raise HTTPException(status_code=413, detail=TRANSCRIBE_TOO_LARGE_DETAIL)
        chunks.append(chunk)
    data = b"".join(chunks)
    if len(data) < TRANSCRIBE_MIN_BYTES:
        # Меньше полукилобайта — заголовок контейнера без звука: речи не было.
        return {"text": ""}
    hint = request.query_params.get("hint", "")
    text = await stt.transcribe_answer(data, mime, hint if isinstance(hint, str) else "")
    return {"text": text}
