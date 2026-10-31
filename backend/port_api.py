"""Тест наружу и тест из лекции (выпуск 49).

POST /api/tests/export {format: gift | moodle | aiken | kahoot, title, items} — файл теста (bank_export.py): имя, тип,
байты (base64), сколько вопросов вошло и какие не вошли (номер и причина). Без ИИ и без базы: вопросы присылает
студия, которая их уже прочитала (свои вопросы автора). 30 в минуту на пользователя.

POST /api/tests/from-lecture {material_id} — самопроверка лекции как вопросы теста: у каждого цитата лекции и сверка
ключа (lecture_items.py). Читается своим токеном пользователя (RLS: своя лекция или открытая ему); модель не
вызывается — вопросы и фрагменты уже есть в лекции, единиц не тратит. 20 в минуту.

POST /api/tests/generate — новые вопросы из лекции {material_id}, из текста {text} или из файла (multipart: file;
PDF, DOCX, PPTX, TXT, MD, HTML): раздел «Тест» анализа (CoordinatorAgent.run_section, те же фрагменты S01…), затем
цитата и сверка ключа. Стоит столько же, сколько «Тест заново» у лекции: AI_COSTS["analysisSection"] (вид
«testGenerate»), списывается с автора; ответ из кэша сервера возвращает единицы, сбой модели — тоже, как у
/api/analyze/section (main._paid_by_real_calls); ни одного вопроса с цитатой — единицы возвращаются. 5 в минуту,
20 в день, как /api/analyze/section.

Ошибки — {"detail": "<по-русски>", "code"}: 400 bad_request, 404 not_found, 413 too_big, 415 unsupported, 422
no_text / no_quiz / no_items, 429 ai_limit, 502 / 504 модель.
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import json
import os
import re
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

import bank_export
import lecture_items
import quota
from agents import base as ai_base
from agents.base import AIError, BaseAgent
from agents.coordinator import CoordinatorAgent
from plans import AI_COSTS
from ratelimit import limiter, user_or_ip_key
from supabase_rest import SupabaseRest, bearer_token
from uploads import AI_UNAVAILABLE_DETAIL, ai_configured, read_upload_with_limit
from utils import build_source_chunks

router = APIRouter()

EXPORT_PATH = "/api/tests/export"
FROM_LECTURE_PATH = "/api/tests/from-lecture"
GENERATE_PATH = "/api/tests/generate"

EXPORT_BODY_BYTES = 12 * 1024 * 1024  # 2000 вопросов по 4000 знаков кириллицей с вариантами
JSON_BODY_BYTES = 1_300_000  # текст до TEXT_MAX_CHARS
TEXT_MAX_CHARS = 300_000  # как /api/analyze/section
TEXT_MIN_CHARS = 200  # букв и цифр: меньше — теста не составить
FILE_EXTENSIONS = (".pdf", ".docx", ".pptx", ".txt", ".md", ".html", ".htm")
COUNTS = (5, 10, 15, 20)
GENERATE_KIND = "testGenerate"
READ_TIMEOUT_SECONDS = 8.0
_UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")

BAD_REQUEST_DETAIL = "Не удалось прочитать запрос. Обновите страницу и попробуйте ещё раз."
TOO_BIG_DETAIL = "Слишком большой запрос."
NOT_FOUND_DETAIL = "Лекция не найдена."
NO_QUIZ_DETAIL = "У этой лекции нет самопроверки. Создайте её на странице лекции."
NO_TEXT_DETAIL = "Текста слишком мало, чтобы составить вопросы. Нужен хотя бы абзац."
NO_FILE_TEXT_DETAIL = "В файле почти нет текста. Сканы и картинки здесь не читаются: пришлите файл с текстом."
UNREADABLE_DETAIL = "Не удалось прочитать файл. Сохраните его заново или пришлите в другом формате."
UNSUPPORTED_DETAIL = "Подойдёт PDF, Word (DOCX), PowerPoint (PPTX), TXT, MD или HTML."
TEXT_TOO_LONG_DETAIL = "Текст слишком длинный: максимум 300 000 знаков."
NO_ITEMS_DETAIL = "Ответов ни на один вопрос в тексте не нашлось, поэтому вопросов нет. Единицы вернулись."
READ_FAILED_DETAIL = "Не удалось прочитать лекцию. Повторите через минуту."


def _error(status: int, code: str, detail: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"detail": detail, "code": code})


class _Refused(Exception):
    def __init__(self, status: int, code: str, detail: str) -> None:
        super().__init__(detail)
        self.status, self.code, self.detail = status, code, detail


async def _json(request: Request, limit: int) -> dict:
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > limit:
        raise _Refused(413, "too_big", TOO_BIG_DETAIL)
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > limit:
            raise _Refused(413, "too_big", TOO_BIG_DETAIL)
        chunks.append(chunk)
    try:
        body = json.loads(b"".join(chunks))
    except (ValueError, UnicodeDecodeError):
        raise _Refused(400, "bad_request", BAD_REQUEST_DETAIL) from None
    if not isinstance(body, dict):
        raise _Refused(400, "bad_request", BAD_REQUEST_DETAIL)
    return body


# ── экспорт ─────────────────────────────────────────────────────────────────────


@router.post(EXPORT_PATH)
@limiter.limit("30/minute", key_func=user_or_ip_key)
async def export_test(request: Request):
    """Тест → файл GIFT, Moodle XML, Aiken или таблица Kahoot."""
    try:
        body = await _json(request, EXPORT_BODY_BYTES)
        fmt, title, items = body.get("format"), body.get("title"), body.get("items")
        if fmt not in bank_export.FORMATS or not isinstance(items, list) or not all(isinstance(i, dict) for i in items):
            raise _Refused(400, "bad_request", BAD_REQUEST_DETAIL)
        try:
            done = await asyncio.to_thread(bank_export.export, fmt, str(title or ""), items)
        except (bank_export.ExportError, TypeError, ValueError):
            raise _Refused(400, "bad_request", BAD_REQUEST_DETAIL) from None
    except _Refused as refused:
        return _error(refused.status, refused.code, refused.detail)
    return {
        "name": done.name,
        "mime": done.mime,
        "data": base64.b64encode(done.data).decode("ascii"),
        "count": done.count,
        "total": len(items),
        "skipped": done.skipped,
        "pictures_lost": done.pictures_lost,
    }


# ── лекция ──────────────────────────────────────────────────────────────────────


async def _material(request: Request, material_id: Any, columns: str) -> dict:
    if not isinstance(material_id, str) or not _UUID_RE.match(material_id):
        raise _Refused(400, "bad_request", BAD_REQUEST_DETAIL)
    try:
        async with SupabaseRest(bearer_token(request), timeout=READ_TIMEOUT_SECONDS) as db:
            row = await db.select_one("materials", {"select": columns, "id": f"eq.{material_id}"})
    except Exception as exc:
        print(f"Lecture read failed: {type(exc).__name__}")
        raise _Refused(502, "read_failed", READ_FAILED_DETAIL) from None
    if not isinstance(row, dict):
        raise _Refused(404, "not_found", NOT_FOUND_DETAIL)
    return row


def _jsonish(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except ValueError:
            return None
    return value


def _quiz_list(value: Any) -> list:
    value = _jsonish(value)
    if isinstance(value, dict):
        value = value.get("quiz")
    return value if isinstance(value, list) else []


def _sources(summary: Any, text: Any) -> list[dict]:
    """Фрагменты лекции: сохранённые при анализе (summary_json.grounding.sources), иначе — из её текста тем же правилом."""
    grounding = summary.get("grounding") if isinstance(summary, dict) else None
    sources = grounding.get("sources") if isinstance(grounding, dict) else None
    if isinstance(sources, list):
        kept = [s for s in sources[:lecture_items.MAX_FRAGMENTS]
                if isinstance(s, dict) and isinstance(s.get("id"), str) and isinstance(s.get("text"), str)]
        if kept:
            return kept
    return build_source_chunks(text[:TEXT_MAX_CHARS]) if isinstance(text, str) else []


def _lecture_items(row: dict, where: str) -> tuple[list[dict], int]:
    """Самопроверка лекции → вопросы с цитатой (в потоке: quiz_json и фрагменты пишет клиент, их размер не ограничен)."""
    quiz = _quiz_list(row.get("quiz_json"))[:lecture_items.MAX_QUESTIONS]
    return lecture_items.items_from_quiz(quiz, _sources(_jsonish(row.get("summary_json")), row.get("original_text")), where)


@router.post(FROM_LECTURE_PATH)
@limiter.limit("20/minute", key_func=user_or_ip_key)
async def from_lecture(request: Request):
    """Самопроверка лекции → вопросы теста с цитатой лекции (без модели, без единиц)."""
    try:
        body = await _json(request, 4096)
        row = await _material(request, body.get("material_id"), "title,quiz_json,summary_json,original_text")
        if not _quiz_list(row.get("quiz_json")):
            raise _Refused(422, "no_quiz", NO_QUIZ_DETAIL)
        title = " ".join(str(row.get("title") or "").split())[:200]
        items, dropped = await asyncio.to_thread(_lecture_items, row, lecture_items.source_label("lecture", title))
    except _Refused as refused:
        return _error(refused.status, refused.code, refused.detail)
    return {"title": title, "items": items, "dropped": dropped}


# ── генерация ───────────────────────────────────────────────────────────────────


def _letters(text: str) -> int:
    return sum(1 for char in text if char.isalnum())


def _count(value: Any) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return 10
    return number if number in COUNTS else 10


async def _file_text(request: Request) -> tuple[str, str, int]:
    """Текст файла из multipart (file, count): (текст, название, сколько вопросов)."""
    try:
        form = await request.form(max_files=1, max_fields=4)
    except Exception:
        raise _Refused(400, "bad_request", BAD_REQUEST_DETAIL) from None
    upload = form.get("file")
    if upload is None or isinstance(upload, str):
        raise _Refused(400, "bad_request", BAD_REQUEST_DETAIL)
    name = str(getattr(upload, "filename", "") or "file.txt")
    extension = os.path.splitext(name)[1].lower()
    if extension not in FILE_EXTENSIONS:
        raise _Refused(415, "unsupported", UNSUPPORTED_DETAIL)
    try:
        contents = await read_upload_with_limit(upload)  # type: ignore[arg-type]
    except HTTPException as exc:
        raise _Refused(413, "too_big", str(exc.detail)) from None
    from parser import FileTooLarge, UnsupportedFormat, extract_text

    try:
        # parser.extract_text checks a DOCX or PPTX archive's sizes before unpacking and reads a PDF's first pages only
        text = await asyncio.to_thread(extract_text, contents, name)
    except UnsupportedFormat as exc:
        raise _Refused(415, "unsupported", str(exc) or UNSUPPORTED_DETAIL) from None
    except FileTooLarge as exc:
        raise _Refused(413, "too_big", str(exc)) from None
    except Exception as exc:
        print(f"Test file read failed: {type(exc).__name__}")
        raise _Refused(422, "unreadable", UNREADABLE_DETAIL) from None
    text = (text or "")[:TEXT_MAX_CHARS]
    if _letters(text) < TEXT_MIN_CHARS:
        raise _Refused(422, "no_text", NO_FILE_TEXT_DETAIL)
    title = os.path.splitext(name.rsplit("/", 1)[-1])[0][:200]
    return text, title, _count(form.get("count"))


@contextlib.asynccontextmanager
async def _paid_by_real_calls(charge: "quota.Charge", label: str):
    """Как main._paid_by_real_calls: сбой — единицы назад; ответ целиком из кэша сервера (ни одного настоящего вызова
    модели) — тоже; иначе единицы остаются."""
    calls = ai_base.count_calls()
    async with quota.refund_on_failure(charge, keep=False):
        yield charge
    if calls.real:
        charge.keep()
        return
    if charge.units:
        print(f"{label}: the answer came from the cache, the units go back")
    charge.refund_unpaid_soon()
    await charge.wait_refund()


@router.post(GENERATE_PATH)
@limiter.limit("5/minute;20/day", key_func=user_or_ip_key)
async def generate_test(request: Request):
    """Вопросы из лекции, текста или файла: у каждого фраза-источник и сверка ключа; списывает лимит ИИ автора."""
    recording = False
    try:
        if (request.headers.get("content-type") or "").lower().startswith("multipart/form-data"):
            text, title, count = await _file_text(request)
            where = lecture_items.source_label("file", title)
        else:
            body = await _json(request, JSON_BODY_BYTES)
            count = _count(body.get("count"))
            if body.get("material_id") is not None:
                row = await _material(request, body.get("material_id"), "title,original_text,summary_json")
                text = row.get("original_text")[:TEXT_MAX_CHARS] if isinstance(row.get("original_text"), str) else ""
                title = " ".join(str(row.get("title") or "").split())[:200]
                summary = _jsonish(row.get("summary_json"))
                recording = isinstance(summary, dict) and summary.get("recognized") == "recording"
                where = lecture_items.source_label("lecture", title)
            else:
                text = body.get("text") if isinstance(body.get("text"), str) else ""
                title = ""
                where = lecture_items.source_label("text")
                if len(text) > TEXT_MAX_CHARS:
                    raise _Refused(413, "too_big", TEXT_TOO_LONG_DETAIL)
            if _letters(text) < TEXT_MIN_CHARS:
                raise _Refused(422, "no_text", NO_TEXT_DETAIL)
            text = text[:TEXT_MAX_CHARS]
        if not ai_configured():
            raise _Refused(503, "ai_unconfigured", AI_UNAVAILABLE_DETAIL)
    except _Refused as refused:
        return _error(refused.status, refused.code, refused.detail)

    charge = await quota.charge(request, GENERATE_KIND, AI_COSTS["analysisSection"])
    async with _paid_by_real_calls(charge, "Test generate"):
        coordinator = CoordinatorAgent(api_key=os.getenv("GROQ_API_KEY", ""))
        section = await coordinator.run_section(
            "quiz", text, {"quiz_count": count, "quiz_difficulty": "mixed", "quiz_type": "multiple"}, recording=recording,
        )
        result = section.get("result") if isinstance(section, dict) else None
        chunks = (section.get("grounding") or {}).get("sources") or build_source_chunks(text)
        items, dropped = await asyncio.to_thread(lecture_items.items_from_quiz, _quiz_list(result), chunks, where)
        if not items:
            # Единицы возвращаются (refund_on_failure), и ответ модели уходит из кэша процесса: иначе «Тест заново»
            # лекции с тем же текстом отдал бы его бесплатно.
            BaseAgent.forget(coordinator.raws.get("quiz"))
            raise AIError(422, "no_items", NO_ITEMS_DETAIL)
    return {"title": title, "items": items, "dropped": dropped, "units": charge.units}
