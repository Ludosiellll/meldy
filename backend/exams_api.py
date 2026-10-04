"""«Билеты» API: разбор списка вопросов, импорт лекции «только текст» и разметка по лекциям.

Пути объявлены полностью (/api/exams/..., /api/extract); main.py подключает router без
префикса. Сессию проверяет общий middleware (без неё — 401), лимиты считаются по
пользователю (user_or_ip_key). Ошибки — {"detail": "<по-русски>"} без текста
провайдеров и исключений. Разбор и извлечение текста бесплатны (единиц лимита не тратят)
и обходятся без ИИ, кроме скана: PDF без текстового слоя распознаёт Gemini (ocr.py, свой
лимит на пользователя и предел страниц), а ответ получает ocr: true и pages. Модель
вызывает ещё разметка (/map).
"""

from __future__ import annotations

import asyncio
import json
import re
from typing import Any

from fastapi import APIRouter, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask
from starlette.datastructures import UploadFile as StarletteUploadFile
from starlette.exceptions import HTTPException as StarletteHTTPException

import ocr
from exams_map import MAX_QUESTION_IDS, MapError, prepare_mapping, release_unstarted, run_mapping
from exams_parse import ParseError, parse_question_list
from ocr import OcrError
from parser import PPT_LEGACY_DETAIL, PPTX_NO_TEXT_DETAIL, extract_text
from ratelimit import limiter, user_or_ip_key
from sse import SSE_HEADERS, sse_event, with_keepalive
from supabase_rest import SupabaseRest, bearer_token
from uploads import read_upload_with_limit

router = APIRouter()

LIST_EXTENSIONS = ("docx", "pdf", "txt", "md")
LECTURE_EXTENSIONS = ("pdf", "docx", "pptx", "txt", "md", "html", "htm")
FORM_PART_LIMIT = 4 * 1024 * 1024  # длинный текст доходит до своей проверки (60 000 знаков)
TITLE_GUESS_CHARS = 120
SHORT_TEXT_CHARS = 300

BAD_FORM_DETAIL = "Не удалось прочитать запрос. Обновите страницу и попробуйте ещё раз."
BOTH_INPUTS_DETAIL = "Отправьте что-то одно: текст списка или файл."
NO_INPUT_DETAIL = "Вставьте текст списка или выберите файл."
NO_FILE_DETAIL = "Выберите файл с лекцией."
LIST_FORMAT_DETAIL = "Этот формат не подходит. Загрузите DOCX, PDF, TXT или MD."
LECTURE_FORMAT_DETAIL = "Этот формат не подходит. Загрузите PDF, DOCX, PPTX, TXT, MD или HTML."
EMPTY_FILE_DETAIL = "Файл пустой. Выберите другой файл."
NO_TEXT_DETAIL = "В файле не найден текст: похоже на скан."
UNREADABLE_DETAIL = "Не удалось прочитать файл. Сохраните его заново или выберите другой."
BAD_BODY_DETAIL = "Неверный формат запроса."
SHORT_TEXT_WARNING = "В файле мало текста. Если часть страниц — сканы, их содержимое в разметку не попадёт."

_MARKDOWN_PREFIX_RE = re.compile(r"^(?:#{1,6}|>+)\s*")
_LETTER_RE = re.compile(r"[A-Za-zА-Яа-яЁё]")
_CYRILLIC_RE = re.compile(r"[А-Яа-яЁё]")

TITLE_SCAN_LINES = 30
_TITLE_PREFERRED_RE = re.compile(r"^(?:лекци[яи]|тема|глава)\s*№?\s*\d", re.IGNORECASE)
_TITLE_NUMBER_ONLY_RE = re.compile(r"^(?:лекци[яи]|тема|глава)\s*№?\s*\d{1,3}\s*[.:)]?$", re.IGNORECASE)
# Шапка учебного заведения и грифы (как exams_parse._HEADER_SOFT_RE, плюс то, что бывает только над лекцией).
_TITLE_SKIP_RE = re.compile(
    r"^(?:"
    r"министерств\w*|федеральн\w*|государствен\w*|негосударствен\w*|фгбоу|фгаоу|гбоу|гоу\b|ано\s+во|ч?оу\s+во"
    r"|университет\w*|институт\w*|академи\w*|колледж\w*|техникум\w*|кафедр\w*|факультет\w*|филиал\w*|высш\w+\s+школ\w*"
    r"|утверждаю|утвержд\w*|рассмотрен\w*|одобрен\w*|согласован\w*|рекомендован\w*|допущен\w*"
    r"|(?:по\s+)?(?:учебн\w+\s+)?дисциплин\w*|(?:по\s+)?курсу?\s*[:«\"]"
    r"|(?:для|по)\s+(?:направлени|специальност|студент|обучающ|бакалавр|магистр|аспирант)\w*"
    r"|направлени\w*\s+подготовки|специальност\w*|профиль\b|квалификаци\w*|форма\s+обучени\w*"
    r"|семестр\w*|учебн\w+\s+год\w*|\d\s*курс\b|курс\s*\d"
    r"|(?:составител\w*|автор(?:ы|-составител\w*)?|разработчик\w*|преподавател\w*|лектор|доцент|профессор|ассистент)"
    r"(?:\s*[:,]|\s+[А-ЯЁ]\.|\s+кафедр\w*|\s*$)|ст\.\s*преп\w*"
    r"|(?:стр\.?|страница|с\.|page)\s*\d+|содержание$|оглавление$"
    # Строки, которые ставит сам разбор файла: «Слайд 3» и «Заметки: …» презентации.
    r"|слайд\s*№?\s*\d+\.?$|заметки\s*:"
    r")",
    re.IGNORECASE,
)
_TITLE_SKIP_ANYWHERE_RE = re.compile(
    r"(?:курс|конспект|тексты?|цикл)\s+лекций|учебн\w*\s+(?:пособи|материал|издани)|методическ\w*\s+(?:указани|рекомендаци|материал)",
    re.IGNORECASE,
)
# «Москва 2024», «Москва – 2024 г.», «12.01.2024», «2024/2025 учебный год».
_TITLE_DATE_RE = re.compile(
    r"^(?:[А-ЯЁA-Z][\w.-]*\s*[,–—-]?\s*)?(?:\d{1,2}[./]\d{1,2}[./])?(?:19|20)\d{2}(?:\s*[/–-]\s*\d{2,4})?\s*(?:г\.?|года?|гг\.?)?"
    r"(?:\s+учебн\w+\s+год\w*)?\.?$",
    re.IGNORECASE,
)
# Автор: «И. И. Иванов», «Иванов И. И.», «Иванов Иван Иванович».
_PERSON_RE = re.compile(
    r"^(?:[А-ЯЁ]\.\s*[А-ЯЁ]\.\s*[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?"
    r"|[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?\s+[А-ЯЁ]\.\s*[А-ЯЁ]\."
    r"|[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+(?:ович|евич|ич|овна|евна|ична|инична))[,.]?$"
)
_GENERIC_STEM_RE = re.compile(
    r"^(?:документ|document|doc|файл|file|upload|скан|scan|image|img|untitled|без\s+названия|новый\s+документ|new\s+document"
    r"|лекция|lecture|текст|text)\s*\(?\d*\)?$",
    re.IGNORECASE,
)
_UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


# ── Общие помощники ─────────────────────────────────────────────────────────────


async def _read_form(request: Request):
    try:
        try:
            return await request.form(max_files=4, max_fields=20, max_part_size=FORM_PART_LIMIT)
        except TypeError:  # Starlette без max_part_size (до 0.40)
            return await request.form(max_files=4, max_fields=20)
    except (StarletteHTTPException, ValueError, KeyError, UnicodeDecodeError):
        raise HTTPException(status_code=400, detail=BAD_FORM_DETAIL) from None
    except Exception as exc:  # повреждённый multipart
        print(f"Exams form parse failed: {type(exc).__name__}")
        raise HTTPException(status_code=400, detail=BAD_FORM_DETAIL) from None


def _is_upload(value: Any) -> bool:
    return isinstance(value, (UploadFile, StarletteUploadFile))


def _file_name(upload: Any) -> str:
    name = str(getattr(upload, "filename", "") or "")
    return re.split(r"[\\/]", name)[-1].strip()


def _extension(name: str) -> str:
    return name.rsplit(".", 1)[-1].lower() if "." in name else ""


async def _read_text(
    upload: Any, allowed: tuple[str, ...], format_detail: str, rate_key: str | None = None
) -> tuple[str, str, int | None]:
    """(текст, имя файла, сколько страниц распознано со скана — или None) или HTTPException:
    415 формат, 413 размер или скан длиннее предела страниц, 422 нет текста, 429 лимит
    распознавания или сервис занят, 502/504 распознавание не удалось.

    PDF с пустым или крошечным текстовым слоем распознаётся (ocr.py), если есть ключ Gemini;
    rate_key — ключ лимита распознавания (user_or_ip_key).
    """
    name = _file_name(upload)
    extension = _extension(name)
    if extension == "ppt" and "pptx" in allowed:
        raise HTTPException(status_code=415, detail=PPT_LEGACY_DETAIL)
    if extension not in allowed:
        raise HTTPException(status_code=415, detail=format_detail)
    contents = await read_upload_with_limit(upload)
    if not contents:
        raise HTTPException(status_code=422, detail=EMPTY_FILE_DETAIL)
    try:
        text = await asyncio.to_thread(extract_text, contents, f"upload.{extension}")
    except Exception as exc:  # повреждённый файл: текст исключения пользователю не показываем
        print(f"Exams text extraction failed: {type(exc).__name__}")
        raise HTTPException(status_code=422, detail=UNREADABLE_DETAIL) from None
    if not isinstance(text, str):
        text = ""
    try:
        scanned = await asyncio.to_thread(ocr.scan_pages, contents, f"upload.{extension}", text)
        if scanned is not None:
            text = await ocr.recognize_scan(contents, scanned, rate_key=rate_key)
    except OcrError as exc:
        raise exc.http_exception() from None
    if not text.strip():
        raise HTTPException(status_code=422, detail=PPTX_NO_TEXT_DETAIL if extension == "pptx" else NO_TEXT_DETAIL)
    # Одиночный суррогат (битый текстовый слой PDF) не кодируется в UTF-8: ни JSON, ни база его не примут.
    text = text.encode("utf-8", errors="replace").decode("utf-8")
    return text, name, scanned


def _file_stem(file_name: str) -> str:
    stem = file_name.rsplit(".", 1)[0] if "." in file_name else file_name
    return " ".join(stem.replace("_", " ").split())[:TITLE_GUESS_CHARS]


def _meaningful_stem(stem: str) -> bool:
    """Имя файла, которое что-то говорит: кириллица или несколько слов, не «Документ1»."""
    if not _LETTER_RE.search(stem):
        return False
    if _GENERIC_STEM_RE.match(stem):
        return False
    return bool(_CYRILLIC_RE.search(stem)) or len(stem.split()) >= 2


def _is_title_service_line(line: str) -> bool:
    """Шапка учебного заведения, гриф, автор, город и год — не название лекции. Отметки страниц
    распознанного скана («[Стр. 1–15]») — тоже."""
    return bool(
        ocr.MARKER_LINE_RE.match(line)
        or _TITLE_SKIP_RE.match(line)
        or _TITLE_SKIP_ANYWHERE_RE.search(line)
        or _TITLE_DATE_RE.match(line)
        or _PERSON_RE.match(line)
    )


def _is_plain_title(line: str) -> bool:
    """Обычное название: несколько слов, не заглавными, не предложение с точкой."""
    letters = [char for char in line if char.isalpha()]
    if len(line.split()) < 2 or not letters:
        return False
    if sum(1 for char in letters if char.isupper()) * 10 > len(letters) * 6:
        return False  # «МАКРОЭКОНОМИКА», «ДЕНЕЖНЫЙ РЫНОК» — чаще название курса, чем лекции
    return not line.rstrip(" »\"')").endswith((".", ",", ";", "!"))


def title_guess(text: str, file_name: str) -> str:
    """Название лекции для режима «только текст».

    Смотрим шапку — до 30 непустых строк, пока не начался текст (строка длиннее 120
    знаков). Строки учебного заведения, грифа, автора, города и года пропускаются.
    1) «Лекция 3. …», «Тема 2. …», «Глава 1. …» (номер без названия — вместе со следующей строкой);
    2) первое обычное название в несколько слов;
    3) имя файла, если оно что-то говорит («Лекция 3 Денежный рынок.pdf»);
    4) первая строка шапки (название курса заглавными); 5) имя файла; 6) «Лекция».
    """
    stem = _file_stem(file_name)
    candidates: list[str] = []
    seen = 0
    for raw in (text or "").splitlines():
        line = " ".join(_MARKDOWN_PREFIX_RE.sub("", raw.strip()).replace("**", "").split())
        if not line:
            continue
        seen += 1
        if seen > TITLE_SCAN_LINES:
            break
        if not _LETTER_RE.search(line):
            continue  # номер страницы, год
        if len(line) > TITLE_GUESS_CHARS:
            break  # начался текст лекции
        if _is_title_service_line(line):
            continue
        candidates.append(line)

    for index, line in enumerate(candidates):
        if not _TITLE_PREFERRED_RE.match(line):
            continue
        if _TITLE_NUMBER_ONLY_RE.match(line) and index + 1 < len(candidates):
            topic = candidates[index + 1]
            if not _TITLE_PREFERRED_RE.match(topic):
                return f"{line.rstrip(' .:')}. {topic}"[:TITLE_GUESS_CHARS]
        return line
    for line in candidates:
        if _is_plain_title(line):
            return line
    if _meaningful_stem(stem):
        return stem
    if candidates:
        return candidates[0]
    return stem if _LETTER_RE.search(stem) else "Лекция"


# ── POST /api/exams/parse ───────────────────────────────────────────────────────


@router.post("/api/exams/parse")
@limiter.limit("10/minute", key_func=user_or_ip_key)
async def parse_exam_questions(request: Request):
    """Список вопросов (поле text до 60 000 знаков или файл DOCX/PDF/TXT/MD) → предпросмотр. В базу не пишет."""
    form = await _read_form(request)
    text_value = form.get("text")
    upload = form.get("file")
    if text_value is not None and not isinstance(text_value, str):
        raise HTTPException(status_code=400, detail=BAD_FORM_DETAIL)
    if upload is not None and not _is_upload(upload):
        if isinstance(upload, str) and not upload.strip():
            upload = None
        else:
            raise HTTPException(status_code=400, detail=BAD_FORM_DETAIL)
    has_text = isinstance(text_value, str) and bool(text_value.strip())
    has_file = upload is not None
    if has_text and has_file:
        raise HTTPException(status_code=400, detail=BOTH_INPUTS_DETAIL)
    if not has_text and not has_file:
        raise HTTPException(status_code=400, detail=NO_INPUT_DETAIL)
    scanned = None
    if has_file:
        text, _, scanned = await _read_text(upload, LIST_EXTENSIONS, LIST_FORMAT_DETAIL, user_or_ip_key(request))
    else:
        text = text_value
    try:
        # Разбор — чистый CPU (до 60 000 знаков): в потоке-исполнителе он не держит цикл
        # событий, и чужие потоки разметки и анализа не замирают.
        result = await asyncio.to_thread(parse_question_list, text)
    except ParseError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.detail) from None
    if scanned is not None:
        # Строка о распознавании встаёт к остальным предупреждениям предпросмотра.
        warnings = [*result.get("warnings", []), {"code": "ocr", "message": ocr.OCR_NOTICE}]
        result = {**result, "warnings": warnings, "ocr": True, "pages": scanned}
    return result


# ── POST /api/extract ───────────────────────────────────────────────────────────


@router.post("/api/extract")
@limiter.limit("10/minute", key_func=user_or_ip_key)
async def extract_lecture_text(request: Request):
    """Текст лекции без единиц лимита (режим «только текст»): без ИИ, кроме распознавания скана.

    Распознанный скан: ocr: true и pages в ответе.
    """
    form = await _read_form(request)
    upload = form.get("file")
    if not _is_upload(upload):
        raise HTTPException(status_code=400, detail=NO_FILE_DETAIL)
    text, name, scanned = await _read_text(upload, LECTURE_EXTENSIONS, LECTURE_FORMAT_DETAIL, user_or_ip_key(request))
    warnings: list[str] = []
    if scanned is None and len(text.strip()) < SHORT_TEXT_CHARS:
        warnings.append(SHORT_TEXT_WARNING)
    body: dict[str, Any] = {"text": text, "length": len(text), "title_guess": title_guess(text, name), "warnings": warnings}
    if scanned is not None:
        body.update(ocr=True, pages=scanned)
    return body


# ── POST /api/exams/{exam_id}/map ───────────────────────────────────────────────


def _map_options(raw: bytes) -> tuple[list[str] | None, bool]:
    if not raw or not raw.strip():
        return None, False
    try:
        body = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(status_code=400, detail=BAD_BODY_DETAIL) from None
    if body is None:
        return None, False
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail=BAD_BODY_DETAIL)
    ids = body.get("question_ids")
    if ids is not None:
        if not isinstance(ids, list) or len(ids) > MAX_QUESTION_IDS:
            raise HTTPException(status_code=400, detail=BAD_BODY_DETAIL)
        ids = [value for value in ids if isinstance(value, str) and _UUID_RE.match(value)]
    force = body.get("force") is True
    return ids, force


async def _frames(events):
    try:
        async for event in events:
            yield sse_event(event)
    finally:
        await events.aclose()


@router.post("/api/exams/{exam_id}/map")
@limiter.limit("3/minute", key_func=user_or_ip_key)
async def map_exam(exam_id: str, request: Request):
    """Разметка вопросов экзамена по лекциям — поток SSE (события start … done | error)."""
    question_ids, force = _map_options(await request.body())
    db = SupabaseRest(bearer_token(request))
    try:
        job = await prepare_mapping(db, exam_id, question_ids, force)
    except MapError as exc:
        await db.aclose()
        raise HTTPException(status_code=exc.status, detail=exc.detail) from None
    except BaseException:
        await db.aclose()
        raise
    return StreamingResponse(
        with_keepalive(_frames(run_mapping(job))),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
        # Клиент ушёл раньше, чем поток начался: блокировка не должна висеть 5 минут.
        background=BackgroundTask(release_unstarted, job),
    )
