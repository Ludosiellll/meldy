"""Распознавание сканов и фото страниц (OCR) через Gemini.

Когда включается. PDF, у которого текстового слоя нет или он крошечный: меньше
OCR_MIN_TOTAL_CHARS непробельных знаков на весь файл или меньше OCR_MIN_CHARS_PER_PAGE на
страницу в среднем. Фото JPG/PNG распознаются всегда. Без ключа Gemini распознавать нечем:
текст файла остаётся как есть (как до появления распознавания).

Чего стоит. Единиц дневного лимита распознавание не тратит. От перегрузки его держат лимит на
пользователя (OCR_RATE_LIMIT, счётчик общего limiter из ratelimit.py) и предел страниц в
файле (OCR_MAX_PAGES).

Как устроено. Файл уходит в Gemini байтами прямо в запросе (без Files API). PDF длиннее
OCR_CHUNK_PAGES страниц режется на куски (PyPDF2), одновременно идут не больше
OCR_PARALLEL_CHUNKS кусков. Ответ, обрезанный по MAX_TOKENS (или отклонённый всеми моделями),
— кусок делится пополам и распознаётся заново, вплоть до одной страницы. Куски склеиваются
с отметками «[Стр. 1–15]». Ключи и модели — GEMINI_API_KEY и GEMINI_MODELS, как у всего
приложения; thinking выключен, где модель это позволяет. Один запрос идёт не дольше
OCR_REQUEST_TIMEOUT_SECONDS (по умолчанию 120 с), всё распознавание файла — не дольше
OCR_TOTAL_TIMEOUT_SECONDS (180 с: анализ после него укладывается в 6 минут ожидания
клиента). Текст провайдера и исключений наружу не уходит.
"""

from __future__ import annotations

import asyncio
import io
import os
import random
import re
import time
from dataclasses import dataclass
from typing import Any, Optional

from fastapi import HTTPException
from google.genai import types
from limits import parse as parse_limit

from agents.base import (
    AIError,
    SAFETY_SETTINGS,
    THINKING_ALLOWANCE,
    classify_error,
    gemini_keys,
    gemini_models_env,
    get_genai_client,
    model_skipped,
    skip_model,
    split_outer_fence,
    thinking_plan,
)
from parser import clean_extracted_text, pdf_page_count
from ratelimit import limiter

OCR_NOTICE = "Текст распознан со скана — сверьте формулы и числа с оригиналом."
OCR_STATUS_MESSAGE = "Распознаём текст со скана. Это может занять несколько минут."

OCR_MIN_TOTAL_CHARS = 200
OCR_MIN_CHARS_PER_PAGE = 80
OCR_MAX_PAGES = 60
OCR_CHUNK_PAGES = 15
OCR_PARALLEL_CHUNKS = 2
OCR_RATE_LIMIT = "6/minute"
OCR_INLINE_MAX_BYTES = 15 * 1024 * 1024
OCR_TOKENS_PER_PAGE = 4096
OCR_IMAGE_OUTPUT_TOKENS = 8192
OCR_OUTPUT_TOKEN_CAP = 65536
# gemini-2.0, 1.x и gemma не думают и отвечают не длиннее 8192 токенов.
OCR_NO_THINKING_OUTPUT_CAP = 8192
# Низкая температура для переписывания; у gemini-3 Google советует не менять её (1.0 по умолчанию).
OCR_TEMPERATURE = 0.1
MIN_ATTEMPT_SECONDS = 0.05

IMAGE_TYPES = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png"}

OCR_PROMPT = """Перед тобой страницы учебного материала: скан или фотография лекции, конспекта, доски или учебника.
Перепиши весь текст дословно, на языке оригинала, в порядке чтения.
Правила:
- Заголовок — отдельной строкой; абзацы, нумерованные и маркированные списки — как в оригинале.
- Таблица — строками, ячейки через « | ».
- Формулы — в LaTeX: внутри строки $...$, отдельной строкой $$...$$.
- Неразборчивое место отметь [неразборчиво]. Не угадывай, не дописывай и не исправляй текст.
- Только текст страниц: без вступления, пояснений и комментариев, без обёртки ```.
- Если на страницах нет текста, ответь пустой строкой."""

OCR_EMPTY_DETAIL = "На скане не удалось распознать текст. Проверьте, что страницы читаются, или загрузите файл с текстом."
OCR_BUSY_DETAIL = "Сервис распознавания сканов сейчас занят. Подождите минуту и попробуйте ещё раз."
OCR_TIMEOUT_DETAIL = "Распознавание скана заняло слишком много времени. Попробуйте файл с меньшим числом страниц."
OCR_FAILED_DETAIL = "Не удалось распознать скан. Попробуйте ещё раз."

INCOMPLETE_NOTE = "распознана не полностью"
UNREADABLE_NOTE = "не распознана"
MARKER_LINE_RE = re.compile(r"^\[(?:Стр\.|Фото)[^\]\n]*\]$")

_REFUSED = {"SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "BLOCKED", "OTHER", "IMAGE_SAFETY", "LANGUAGE"}
_OCR_LIMIT = parse_limit(OCR_RATE_LIMIT)


def _plural(count: int, forms: tuple[str, str, str]) -> str:
    tail = count % 100
    if 11 <= tail <= 14:
        return forms[2]
    if count % 10 == 1:
        return forms[0]
    if 2 <= count % 10 <= 4:
        return forms[1]
    return forms[2]


def too_many_pages_detail(pages: int) -> str:
    return (
        f"В скане {pages} {_plural(pages, ('страница', 'страницы', 'страниц'))}, а распознать за раз можно "
        f"до {OCR_MAX_PAGES}. Разделите PDF на части и загрузите их по очереди."
    )


def rate_limit_detail() -> str:
    amount = _OCR_LIMIT.amount
    return (
        f"Слишком много сканов подряд: за минуту можно распознать {amount} "
        f"{_plural(amount, ('файл', 'файла', 'файлов'))}. Подождите минуту и повторите."
    )


class OcrError(Exception):
    """Распознавание не начато или ничего не дало: слишком много страниц, лимит, пусто.

    ``code`` — код события error в потоке анализа (too_large | busy | no_text), ``status`` —
    HTTP-статус для обычных запросов, ``detail`` — текст для экрана.
    """

    def __init__(self, status: int, code: str, detail: str, retry_after: Optional[int] = None):
        super().__init__(detail)
        self.status = status
        self.code = code
        self.detail = detail
        self.retry_after = retry_after

    def http_exception(self) -> HTTPException:
        headers = {"Retry-After": str(self.retry_after)} if self.retry_after else None
        return HTTPException(status_code=self.status, detail=self.detail, headers=headers)


def _env_seconds(name: str, default: float) -> float:
    try:
        value = float(os.getenv(name, "").strip() or default)
    except ValueError:
        return default
    return value if value > 0 else default


def ocr_request_timeout_seconds() -> float:
    return _env_seconds("OCR_REQUEST_TIMEOUT_SECONDS", 120.0)


def ocr_total_timeout_seconds() -> float:
    return _env_seconds("OCR_TOTAL_TIMEOUT_SECONDS", 180.0)


def ocr_available() -> bool:
    return bool(gemini_keys())


def _extension(filename: str) -> str:
    name = (filename or "").rsplit("/", 1)[-1]
    return name.rsplit(".", 1)[-1].lower() if "." in name else ""


def image_mime(filename: str, content_type: Optional[str] = None, data: Optional[bytes] = None) -> Optional[str]:
    """image/jpeg или image/png для фото страницы, иначе None.

    Решают сами байты, если по ним видно формат: клиент пережимает фото в JPEG и оставляет
    прежнее имя («photo.png» с JPEG внутри). Затем заявленный тип, затем расширение.
    """
    if data is not None:
        if data.startswith(b"\xff\xd8\xff"):
            return "image/jpeg"
        if data.startswith(b"\x89PNG\r\n\x1a\n"):
            return "image/png"
    if content_type in ("image/jpeg", "image/png"):
        return content_type
    return IMAGE_TYPES.get(_extension(filename))


def _visible_chars(text: str) -> int:
    return len("".join((text or "").split()))


def text_layer_is_thin(text: str, pages: Optional[int]) -> bool:
    """Пустой или крошечный текстовый слой: меньше 200 знаков всего или меньше 80 на страницу."""
    chars = _visible_chars(text)
    if chars < OCR_MIN_TOTAL_CHARS:
        return True
    return bool(pages) and chars < OCR_MIN_CHARS_PER_PAGE * pages


def scan_pages(contents: bytes, filename: str, text: str) -> Optional[int]:
    """Сколько страниц распознать: PDF с пустым или крошечным текстовым слоем, и ключ Gemini есть.

    None — распознавать не нужно или нечем: текст файла остаётся как есть. Так же остаётся
    длинный PDF с частью текста (больше OCR_MAX_PAGES страниц, но слой не пустой).
    OcrError 413 — скан без текста длиннее OCR_MAX_PAGES страниц.
    Синхронная (PyPDF2 читает файл): вызывать в потоке-исполнителе.
    """
    if _extension(filename) != "pdf" or not ocr_available():
        return None
    pages = pdf_page_count(contents)
    if not pages or not text_layer_is_thin(text, pages):
        return None
    if pages > OCR_MAX_PAGES:
        if _visible_chars(text) >= OCR_MIN_TOTAL_CHARS:
            return None
        raise OcrError(413, "too_large", too_many_pages_detail(pages))
    return pages


def check_ocr_rate(key: Optional[str]) -> None:
    """Засчитывает файл в лимит распознавания пользователя; сверх лимита — OcrError 429.

    Счётчик живёт в том же хранилище, что и лимиты маршрутов (limiter из ratelimit.py):
    limiter.enabled = False в тестах выключает и его, limiter.reset() обнуляет.
    """
    if not key or not limiter.enabled:
        return
    try:
        allowed = limiter.limiter.hit(_OCR_LIMIT, key, "ocr")
    except Exception as exc:  # хранилище лимитов недоступно: распознавание не блокируем
        print(f"OCR rate limit check failed: {type(exc).__name__}")
        return
    if allowed:
        return
    retry_after = 60
    try:
        reset_at, _remaining = limiter.limiter.get_window_stats(_OCR_LIMIT, key, "ocr")
        retry_after = max(1, int(reset_at - time.time()) + 1)
    except Exception:
        pass
    raise OcrError(429, "busy", rate_limit_detail(), retry_after=retry_after)


def has_recognised_text(text: str) -> bool:
    """В ответе есть текст, а не только отметки страниц и [неразборчиво]."""
    lines = [line for line in (text or "").splitlines() if not MARKER_LINE_RE.match(line.strip())]
    return bool(re.search(r"\w", "\n".join(lines).replace("[неразборчиво]", "")))


async def recognize_scan(contents: bytes, pages: int, *, rate_key: Optional[str]) -> str:
    """Текст скана PDF (pages — из scan_pages). OcrError 429/422, AIError 429/502/503/504."""
    check_ocr_rate(rate_key)
    text = await recognize_pdf(contents, pages)
    if not has_recognised_text(text):
        raise OcrError(422, "no_text", OCR_EMPTY_DETAIL)
    return text


async def recognize_photo(data: bytes, mime_type: str, *, rate_key: Optional[str]) -> str:
    """Текст фото страницы. OcrError 429/422, AIError 429/502/503/504."""
    check_ocr_rate(rate_key)
    text = await recognize_image(data, mime_type)
    if not has_recognised_text(text):
        raise OcrError(422, "no_text", OCR_EMPTY_DETAIL)
    return text


# ── Распознавание ───────────────────────────────────────────────────────────────


@dataclass
class _Run:
    """Срок всего распознавания и что случалось с попытками (для итоговой ошибки)."""

    deadline: float
    rate_limited: bool = False
    timed_out: bool = False

    def remaining(self) -> float:
        return self.deadline - asyncio.get_running_loop().time()

    def note(self, kind: str) -> None:
        if kind == "rate_limited":
            self.rate_limited = True
        elif kind == "timeout":
            self.timed_out = True

    def error(self) -> AIError:
        if not gemini_keys():
            return AIError.unconfigured()
        if self.rate_limited:
            return AIError.busy(OCR_BUSY_DETAIL)
        if self.timed_out:
            return AIError.timeout(OCR_TIMEOUT_DETAIL)
        return AIError.failed(OCR_FAILED_DETAIL)


@dataclass(frozen=True)
class _Piece:
    start: int  # первая страница (с нуля)
    end: int  # после последней
    text: str
    note: Optional[str] = None


def _new_run() -> _Run:
    return _Run(deadline=asyncio.get_running_loop().time() + ocr_total_timeout_seconds())


async def recognize_pdf(contents: bytes, pages: int) -> str:
    """Текст всех страниц PDF: кусками по OCR_CHUNK_PAGES, не больше OCR_PARALLEL_CHUNKS сразу."""
    run = _new_run()
    ranges = [(start, min(start + OCR_CHUNK_PAGES, pages)) for start in range(0, pages, OCR_CHUNK_PAGES)]
    gate = asyncio.Semaphore(OCR_PARALLEL_CHUNKS)

    async def chunk(start: int, end: int) -> list[_Piece]:
        async with gate:
            return await _recognize_pages(contents, start, end, pages, run)

    try:
        async with asyncio.TaskGroup() as group:
            tasks = [group.create_task(chunk(start, end)) for start, end in ranges]
    except BaseExceptionGroup as failure:  # первая ошибка куска; остальные куски уже отменены
        raise _first_error(failure) from None
    return _join([piece for task in tasks for piece in task.result()])


async def recognize_image(data: bytes, mime_type: str) -> str:
    run = _new_run()
    text, complete = await _ocr_any_model(data, mime_type, None, run)
    text = _clean_answer(text)
    if not complete:
        note = "[Фото распознано не полностью]" if text else "[Фото не распознано]"
        text = f"{text}\n\n{note}".strip()
    return text


def _first_error(failure: BaseException) -> BaseException:
    while isinstance(failure, BaseExceptionGroup) and failure.exceptions:
        failure = failure.exceptions[0]
    return failure


def _pdf_slice(contents: bytes, start: int, end: int) -> bytes:
    from PyPDF2 import PdfReader, PdfWriter

    reader = PdfReader(io.BytesIO(contents))
    writer = PdfWriter()
    for index in range(start, end):
        writer.add_page(reader.pages[index])
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


async def _recognize_pages(contents: bytes, start: int, end: int, total: int, run: _Run) -> list[_Piece]:
    count = end - start
    if start == 0 and end == total:
        data = contents  # весь файл одним куском: пересобирать незачем
    else:
        data = await asyncio.to_thread(_pdf_slice, contents, start, end)
    complete = False
    text = ""
    if len(data) <= OCR_INLINE_MAX_BYTES or count == 1:
        text, complete = await _ocr_any_model(data, "application/pdf", count, run)
        text = _clean_answer(text)
    if complete:
        return [_Piece(start, end, text)]
    if count > 1:
        middle = start + count // 2
        left = await _recognize_pages(contents, start, middle, total, run)
        return left + await _recognize_pages(contents, middle, end, total, run)
    return [_Piece(start, end, text, INCOMPLETE_NOTE if text else UNREADABLE_NOTE)]


def _marker(start: int, end: int) -> str:
    first, last = start + 1, end
    return f"[Стр. {first}]" if first == last else f"[Стр. {first}–{last}]"


def _join(pieces: list[_Piece]) -> str:
    """Куски по порядку; при нескольких кусках у каждого — отметка страниц."""
    marked = len(pieces) > 1
    blocks: list[str] = []
    for piece in pieces:
        lines: list[str] = []
        if piece.note:
            lines.append(f"[Стр. {piece.start + 1}: {piece.note}]")
        elif marked and piece.text:
            lines.append(_marker(piece.start, piece.end))
        if piece.text:
            lines.append(piece.text)
        if lines:
            blocks.append("\n".join(lines))
    return clean_extracted_text("\n\n".join(blocks))


def _clean_answer(text: str) -> str:
    fenced = split_outer_fence(text or "")
    return clean_extracted_text(fenced[1] if fenced is not None else (text or ""))


def _output_tokens(model: str, pages: Optional[int], allowance: int) -> int:
    no_thinking = thinking_plan(model, "off").label == "none"
    cap = OCR_NO_THINKING_OUTPUT_CAP if no_thinking else OCR_OUTPUT_TOKEN_CAP
    wanted = OCR_IMAGE_OUTPUT_TOKENS if pages is None else OCR_TOKENS_PER_PAGE * max(1, pages)
    return min(cap, wanted + allowance)


def _is_gemini3(model: str) -> bool:
    return model.lower().rsplit("/", 1)[-1].startswith("gemini-3")


def _finish_reason(response: Any) -> Optional[str]:
    candidates = getattr(response, "candidates", None) or []
    if candidates:
        value = getattr(candidates[0], "finish_reason", None)
        if value is None:
            return None
        name = getattr(value, "name", None)
        return name if isinstance(name, str) and name else str(value).rsplit(".", 1)[-1]
    feedback = getattr(response, "prompt_feedback", None)
    if feedback is not None and getattr(feedback, "block_reason", None) is not None:
        return "BLOCKED"
    return None


def _response_text(response: Any) -> str:
    try:
        text = getattr(response, "text", None)
    except Exception:
        text = None
    return text if isinstance(text, str) else ""


async def _generate(
    client: Any, model: str, data: bytes, mime_type: str, pages: Optional[int], thinking_config: Any, allowance: int, timeout: float
) -> tuple[str, Optional[str]]:
    config: dict[str, Any] = {
        "max_output_tokens": _output_tokens(model, pages, allowance),
        "response_mime_type": "text/plain",
        "safety_settings": SAFETY_SETTINGS,
        "http_options": types.HttpOptions(timeout=max(1, int(timeout * 1000))),
    }
    if not _is_gemini3(model):
        config["temperature"] = OCR_TEMPERATURE
    if thinking_config is not None:
        config["thinking_config"] = thinking_config
    response = await asyncio.wait_for(
        client.aio.models.generate_content(
            model=model,
            contents=[types.Part.from_bytes(data=data, mime_type=mime_type), OCR_PROMPT],
            config=types.GenerateContentConfig(**config),
        ),
        timeout=timeout,
    )
    return _response_text(response), _finish_reason(response)


async def _ocr_any_model(data: bytes, mime_type: str, pages: Optional[int], run: _Run) -> tuple[str, bool]:
    """(текст, полный ли он) от первой модели, что ответила. Ключи — в случайном порядке, модели —
    по GEMINI_MODELS. Неполный: обрезан по MAX_TOKENS или отклонён всеми моделями. Ни одного
    ответа — AIError (занят, срок вышел, сбой)."""
    keys = gemini_keys()
    if not keys:
        raise AIError.unconfigured()
    order = list(enumerate(keys))
    random.shuffle(order)
    models = gemini_models_env()
    refused = empty = False
    settled: set[str] = set()  # модель ответила по существу (пусто или отказ): другой ключ ответ не изменит
    for key_index, key in order:
        for model in models:
            if model in settled or model_skipped("gemini", key, model):
                continue
            if run.remaining() <= MIN_ATTEMPT_SECONDS:
                run.note("timeout")
                raise run.error()
            answer = await _ocr_model(key, key_index, model, data, mime_type, pages, run)
            if answer is None:
                continue
            text, finish = answer
            finish_name = (finish or "").upper()
            if finish_name in ("MAX_TOKENS", "LENGTH") or (finish_name in _REFUSED and text.strip()):
                return text, False
            if finish_name in _REFUSED:
                refused = True
                settled.add(model)
                continue
            if not text.strip():
                empty = True  # пустые страницы или сбой модели: спросим следующую
                settled.add(model)
                continue
            return text, True
    if empty:
        return "", True
    if refused:
        return "", False
    raise run.error()


async def _ocr_model(
    key: str, key_index: int, model: str, data: bytes, mime_type: str, pages: Optional[int], run: _Run
) -> Optional[tuple[str, Optional[str]]]:
    """Ответ одной модели или None. Модель, что отвергла настройку thinking, спрашивается ещё раз без неё."""
    plan = thinking_plan(model, "off")
    attempts: list[tuple[Any, int]] = [(plan.config, plan.allowance)]
    index = 0
    while index < len(attempts):
        config, allowance = attempts[index]
        index += 1
        left = run.remaining()
        if left <= MIN_ATTEMPT_SECONDS:
            run.note("timeout")
            return None
        try:
            return await _generate(
                get_genai_client(key), model, data, mime_type, pages, config, allowance,
                timeout=min(left, ocr_request_timeout_seconds()),
            )
        except Exception as exc:
            kind = classify_error(exc)
            run.note(kind)
            print(f"OCR gemini call failed: key#{key_index} model={model} kind={kind} {type(exc).__name__}")
            if kind in ("not_found", "permission"):
                skip_model("gemini", key, model)
                return None
            if kind == "invalid_argument" and config is not None and len(attempts) == 1 and "thinking" in str(exc).lower():
                # Без настройки модель думает по умолчанию: запас, чтобы мысли не съели ответ.
                attempts.append((None, THINKING_ALLOWANCE))
                continue
            return None
    return None
