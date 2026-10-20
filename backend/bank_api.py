"""Банк вопросов сессии (тест с вариантами и открытые вопросы): разбор для предпросмотра — POST /api/exams/parse-bank.

Путь объявлен полностью, main.py подключает router без префикса. Сессию проверяет общий middleware
main.py, как у /api/exams/parse (без неё — 401); лимит — 10 запросов в минуту на пользователя
(user_or_ip_key): клиент шлёт по запросу на файл. Разбор — правила bank_parse.py без ИИ: единиц дневного
лимита не тратит, в базу ничего не пишет (ни SupabaseRest, ни quota здесь не вызываются). Сохраняет клиент.

Форма (multipart): file (DOCX, XLSX, PDF с текстом, TXT, MD, CSV, HTML, Moodle XML до MAX_UPLOAD_BYTES, по умолчанию
15 МБ) или text; необязательно key_mode (auto | first_option | none), key_text (ключ строками «1 – б»), key_file (ключ
отдельным файлом: те же форматы, кроме Moodle XML; берётся раздел варианта теста), key_section (номер раздела файла ключа, выбранный
пользователем), pictures=1 (картинки DOCX переносятся: так просит страница, которая их сохраняет) и format
(auto | test | open). Ответ — словарь bank_parse: предметы, темы, вопросы (с вариантами или открытые),
ключ, флаги, marks, статистика. Ошибки — {"detail": "<по-русски>", "code": "<код>"}: 415 old_doc /
unsupported, 413 too_many / too_much_text / file_too_big, 422 empty_file / unreadable / no_items / scan_pdf,
400 bad_form / both_inputs / no_input / key_text_too_long.
"""

from __future__ import annotations

import asyncio
import functools
import re
from typing import Any

from fastapi import APIRouter, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from starlette.datastructures import UploadFile as StarletteUploadFile
from starlette.exceptions import HTTPException as StarletteHTTPException

from bank_parse import (
    FORMAT_MODES,
    KEY_MODES,
    MAX_KEY_TEXT_CHARS,
    TOO_MUCH_TEXT_DETAIL,
    BankError,
    _user_keys,
    check_file_name,
    parse_bank_file,
    parse_bank_text,
    read_key_file,
)
from ratelimit import limiter, user_or_ip_key
from uploads import read_upload_with_limit

router = APIRouter()

BANK_PATH = "/api/exams/parse-bank"
# Поле текста до 8 МБ доходит до своей проверки (2 000 000 знаков — около 4 МБ кириллицей).
FORM_PART_LIMIT = 8 * 1024 * 1024

AUTH_DETAIL = "Требуется войти в аккаунт"
BAD_FORM_DETAIL = "Не удалось прочитать запрос. Обновите страницу и попробуйте ещё раз."
BOTH_INPUTS_DETAIL = "Отправьте что-то одно: текст теста или файл."
NO_INPUT_DETAIL = "Вставьте текст теста или выберите файл."
KEY_TEXT_TOO_LONG_DETAIL = "Ключ длиннее 30 000 знаков. Оставьте в нём только номера вопросов и ответы."


async def _read_form(request: Request):
    try:
        try:
            return await request.form(max_files=2, max_fields=10, max_part_size=FORM_PART_LIMIT)
        except TypeError:  # Starlette без max_part_size (до 0.40)
            return await request.form(max_files=2, max_fields=10)
    except StarletteHTTPException as exc:
        if "maximum size" in str(exc.detail):  # поле текста больше FORM_PART_LIMIT — заведомо больше предела знаков
            raise BankError(413, "too_much_text", TOO_MUCH_TEXT_DETAIL) from None
        raise BankError(400, "bad_form", BAD_FORM_DETAIL) from None
    except (ValueError, KeyError, UnicodeDecodeError):
        raise BankError(400, "bad_form", BAD_FORM_DETAIL) from None
    except Exception as exc:  # повреждённый multipart
        print(f"Bank form parse failed: {type(exc).__name__}")
        raise BankError(400, "bad_form", BAD_FORM_DETAIL) from None


def _is_upload(value: Any) -> bool:
    return isinstance(value, (UploadFile, StarletteUploadFile))


def _file_name(upload: Any) -> str:
    name = str(getattr(upload, "filename", "") or "")
    return re.split(r"[\\/]", name)[-1].strip()


def _optional_text(value: Any) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise BankError(400, "bad_form", BAD_FORM_DETAIL)
    return value


async def _parse(request: Request) -> dict:
    user = getattr(request.state, "user", None)
    if not (isinstance(user, dict) and user.get("id")):
        raise BankError(401, "auth", AUTH_DETAIL)  # middleware main.py уже ответил бы 401: вторая линия
    form = await _read_form(request)
    prepared = await prepare(request, form)
    # Разбор — чистый CPU (до 2 000 000 знаков): в потоке-исполнителе он не держит цикл событий.
    options = {"key_mode": prepared["key_mode"], "key_text": prepared["key_text"], "format_mode": prepared["format_mode"]}
    if prepared["key_file"] is not None:
        options["key_file"] = prepared["key_file"]
        options["key_section"] = prepared["key_section"]
    if prepared["contents"] is not None:
        return await asyncio.to_thread(functools.partial(parse_bank_file, prepared["contents"], prepared["name"],
                                                         with_pictures=prepared["with_pictures"], **options))
    return await asyncio.to_thread(functools.partial(parse_bank_text, prepared["text"], **options))


async def prepare(request: Request, form) -> dict:
    """Поля формы parse-bank, проверенные: {contents, name, text, key_mode, format_mode, key_text, user_keys, key_file,
    key_section, with_pictures} (файл прочитан с пределом размера; файл ключа — разделы). Ошибки — BankError.
    Её же читает разбор с ИИ (bank_ai.py)."""
    text_value = _optional_text(form.get("text"))
    key_mode = (_optional_text(form.get("key_mode")) or "auto").strip() or "auto"
    format_mode = (_optional_text(form.get("format")) or "auto").strip() or "auto"
    key_text = _optional_text(form.get("key_text"))
    upload = form.get("file")
    if upload is not None and not _is_upload(upload):
        if isinstance(upload, str) and not upload.strip():
            upload = None
        else:
            raise BankError(400, "bad_form", BAD_FORM_DETAIL)
    if key_mode not in KEY_MODES or format_mode not in FORMAT_MODES:
        raise BankError(400, "bad_form", BAD_FORM_DETAIL)
    if key_text is not None and len(key_text) > MAX_KEY_TEXT_CHARS:
        raise BankError(400, "key_text_too_long", KEY_TEXT_TOO_LONG_DETAIL)
    key_upload = form.get("key_file")
    if key_upload is not None and not _is_upload(key_upload):
        if isinstance(key_upload, str) and not key_upload.strip():
            key_upload = None
        else:
            raise BankError(400, "bad_form", BAD_FORM_DETAIL)
    section_text = (_optional_text(form.get("key_section")) or "").strip()
    if section_text and not section_text.isdecimal():
        raise BankError(400, "bad_form", BAD_FORM_DETAIL)
    key_section = int(section_text) if section_text else None
    has_text = bool(text_value and text_value.strip())
    has_file = upload is not None
    if has_text and has_file:
        raise BankError(400, "both_inputs", BOTH_INPUTS_DETAIL)
    if not has_text and not has_file:
        raise BankError(400, "no_input", NO_INPUT_DETAIL)
    prepared: dict = {"contents": None, "name": "", "text": None, "key_mode": key_mode, "format_mode": format_mode,
                      "key_text": key_text, "user_keys": _user_keys(key_text), "key_file": None, "key_section": key_section,
                      "with_pictures": (_optional_text(form.get("pictures")) or "").strip() == "1"}
    if key_upload is not None:
        prepared["key_file"] = await _key_file(key_upload)
    if has_file:
        name = _file_name(upload)
        check_file_name(name)  # .doc и неизвестный формат — 415 сразу, не дожидаясь чтения файла
        try:
            prepared["contents"] = await read_upload_with_limit(upload)
        except HTTPException as exc:
            if exc.status_code == 413:
                raise BankError(413, "file_too_big", str(exc.detail)) from None
            raise
        prepared["name"] = name
    else:
        prepared["text"] = text_value
    return prepared


async def _key_file(upload: Any) -> list[dict]:
    """Файл ключа → разделы read_key_file. Его ошибки — с кодом key_file_* и словами «Файл ключа: …», чтобы клиент
    не принял их за ошибку файла с вопросами."""
    try:
        name = _file_name(upload)
        check_file_name(name)
        try:
            contents = await read_upload_with_limit(upload)
        except HTTPException as exc:
            if exc.status_code == 413:
                raise BankError(413, "file_too_big", str(exc.detail)) from None
            raise
        return await asyncio.to_thread(read_key_file, contents, name)
    except BankError as exc:
        code = exc.code if exc.code.startswith("key_file") or exc.code == "no_keys" else f"key_file_{exc.code}"
        raise BankError(exc.status, code, f"Файл ключа: {exc.detail[:1].lower()}{exc.detail[1:]}") from None


@router.post(BANK_PATH)
@limiter.limit("10/minute", key_func=user_or_ip_key)
async def parse_test_bank(request: Request):
    """Банк вопросов (файл или текст) → предпросмотр: предметы, темы, вопросы, ключи, флаги. Без ИИ, без единиц, в базу не пишет."""
    try:
        return await _parse(request)
    except BankError as exc:
        return JSONResponse(status_code=exc.status, content={"detail": exc.detail, "code": exc.code})
