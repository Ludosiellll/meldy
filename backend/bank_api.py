"""Банк вопросов сессии (тест с вариантами и открытые вопросы): разбор для предпросмотра — POST /api/exams/parse-bank.

Путь объявлен полностью, main.py подключает router без префикса. Сессию проверяет общий middleware
main.py, как у /api/exams/parse (без неё — 401); лимит — 30 запросов в минуту и 400 в день на пользователя
(user_or_ip_key, BANK_LIMIT), разборов сразу — 2 у пользователя и 3 всего (ParseSlots, сверх — 429 parse_busy): клиент
шлёт по запросу на файл, а 429 ждёт по Retry-After и повторяет сам. Разбор — правила bank_parse.py без ИИ: единиц дневного
лимита не тратит, в базу ничего не пишет (ни SupabaseRest, ни quota здесь не вызываются). Сохраняет клиент. Разбор идёт
в дочернем процессе (parse_child.py) с пределом времени и памяти: дольше минуты или больше PARSE_MEMORY_BYTES — 413.

Форма (multipart): file (DOCX, XLSX, PDF с текстом, TXT, MD, CSV, HTML, Moodle XML до MAX_UPLOAD_BYTES, по умолчанию
15 МБ) или text; необязательно key_mode (auto | first_option | none), key_text (ключ строками «1 – б»), key_file (ключ
отдельным файлом: те же форматы, кроме Moodle XML; берётся раздел варианта теста), key_section (номер раздела файла ключа, выбранный
пользователем), pictures=1 (картинки DOCX переносятся: так просит страница, которая их сохраняет) и format
(auto | test | open). Ответ — словарь bank_parse: предметы, темы, вопросы (с вариантами или открытые),
ключ, флаги, marks, статистика. Ошибки — {"detail": "<по-русски>", "code": "<код>"}: 415 old_doc /
unsupported, 413 too_many / too_much_text / too_complex / file_too_big / parse_too_long / parse_too_big,
422 empty_file / unreadable / no_items / scan_pdf, 429 parse_busy, 400 bad_form / both_inputs / no_input /
key_text_too_long (у файла ключа — те же с приставкой key_file_).
"""

from __future__ import annotations

import asyncio
import contextlib
import contextvars
import functools
import os
import re
from collections import Counter
from typing import Any, Callable

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
import parse_child
from ratelimit import give_back, limiter, user_or_ip_key
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


# Разбор — работа процессора и памяти (DOCX с разметкой, несоразмерной тексту, отказывается до разбора: bank_docx
# check_markup; остальное — до нескольких секунд и сотен МБ): одновременно не больше PARSE_PER_USER разборов одного
# пользователя и PARSE_AT_ONCE всего, места — по очереди прихода. Сверх — ждём места до PARSE_WAIT_SECONDS, потом 429
# parse_busy с Retry-After: очередь чтения клиента (по 2 файла) подождёт и повторит сама; такой отказ не считается в
# пределе запросов (ratelimit.give_back). Те же места занимают файл ключа и чтение файла для разбора с ИИ (bank_ai.py).
PARSE_PER_USER = 2
PARSE_AT_ONCE = 3
PARSE_WAIT_SECONDS = 15.0
PARSE_POLL_SECONDS = 0.1
PARSE_RETRY_AFTER_SECONDS = 5
PARSE_BUSY_DETAIL = "Сервер разбирает другие файлы. Продолжим через несколько секунд."

# Каждая работа на месте разбора — в дочернем процессе (parse_child.py): не дольше PARSE_SECONDS по часам и не больше
# PARSE_MEMORY_BYTES памяти сверх той, с которой процесс начал. Дольше или больше — процесс убит (процессор и память
# свободны, место отдано сразу), ответ 413 parse_too_long / parse_too_big. Замеры 2026-11-05 на машине с 4 ядрами:
# файлы корпуса разбираются до 0,35 с и 18 МБ, а самый тяжёлый файл, какой пропускают пределы bank_parse и bank_docx
# (2000 вопросов, document.xml 37 МБ в 210 000 кусках), — 8–10 с и 514 МБ (чтение для разбора с ИИ, bank_ai: 16 с и
# 728 МБ). Минута — с запасом на медленный процессор Space (2 vCPU) и три разбора сразу; 1,5 ГБ — вдвое больше самого
# тяжёлого, три разбора сразу — до 4,5 ГБ из 16 ГБ Space. Нет сервера форков (Windows) или BANK_PARSE_IN_CHILD=0 — в
# потоке, как раньше: без пределов.
PARSE_SECONDS = 60.0
PARSE_MEMORY_BYTES = 1536 << 20
PARSE_IN_CHILD = os.getenv("BANK_PARSE_IN_CHILD", "1").strip() != "0"
PARSE_TOO_LONG_DETAIL = "Файл слишком сложный: разбор занял больше минуты. Разбейте его на части или вставьте текст."
PARSE_TOO_BIG_DETAIL = "Файл слишком сложный: на разбор не хватило памяти. Разбейте его на части или вставьте текст."
_thread_said = False


def _say_in_thread(reason: str) -> None:
    global _thread_said
    if not _thread_said:
        _thread_said = True
        print(f"Bank parse: in a thread, without the time and memory limits ({reason})")


def _in_child() -> bool:
    if not PARSE_IN_CHILD:
        _say_in_thread("BANK_PARSE_IN_CHILD=0")
        return False
    if not parse_child.available():
        _say_in_thread("no fork server on this platform")
        return False
    return True


def _run_job(job: parse_child.Job) -> Any:
    """Работа в дочернем процессе; процесс не запустить — в этом потоке, как раньше."""
    try:
        return job.run()
    except parse_child.Unavailable as exc:
        _say_in_thread(f"no child process: {exc}")
        return job.work()


def warm_up() -> None:
    """Сервер форков разбора — при старте приложения (main.py), а не на первом файле: несколько десятых секунды."""
    if _in_child():
        try:
            parse_child.warm_up()
        except Exception as exc:  # the first parse tries again (and parses in a thread if it cannot)
            print(f"Bank parse: the fork server did not start: {type(exc).__name__}: {exc}")


class ParseSlots:
    """Места для разбора: не больше per_user у пользователя и total всего, по очереди прихода: место берёт первый из
    ждущих, кому его можно дать (ждущий, у которого уже per_user разборов, не держит очередь). Счётчики меняются только в
    цикле событий (ожидание — опросом, без примитивов, привязанных к одному циклу). Место занято, пока идёт работа:
    запрос, отменённый посреди разбора, останавливает её процесс сразу и тогда же отпускает место (работа в потоке — без
    процесса — не останавливается: место отпускается, когда поток закончит)."""

    def __init__(self, per_user: int, total: int) -> None:
        self.per_user, self.total = per_user, total
        self.users: Counter[str] = Counter()
        self.busy = 0
        self.waiting: list[tuple[int, str]] = []  # (номер прихода, пользователь)
        self._arrived = 0

    def _turn(self, ticket: int, user: str) -> bool:
        if self.busy >= self.total or self.users[user] >= self.per_user:
            return False
        for waiting, other in self.waiting:
            if waiting == ticket:
                return True
            if self.users[other] < self.per_user:  # пришёл раньше и может начать: его очередь
                return False
        return True

    def _leave(self, user: str) -> None:
        self.busy -= 1
        self.users[user] -= 1
        if self.users[user] <= 0:
            del self.users[user]

    @contextlib.asynccontextmanager
    async def hold(self, user: str, wait: float):
        """Место для разбора пользователя user (ждёт до wait секунд, иначе BankError 429 parse_busy) → run(work):
        работа на этом месте — в дочернем процессе с пределами (BankError 413 parse_too_long / parse_too_big), его ждёт
        поток-исполнитель. work — функция уровня модуля с аргументами (functools.partial): её передаёт pickle."""
        loop = asyncio.get_running_loop()
        deadline = loop.time() + wait
        self._arrived += 1
        ticket = (self._arrived, user)
        self.waiting.append(ticket)
        try:
            while not self._turn(ticket[0], user):
                if loop.time() >= deadline:
                    busy = BankError(429, "parse_busy", PARSE_BUSY_DETAIL)
                    # its own places taken (a user keeps two parses busy): not the server's fault, not given back
                    busy.own_places = self.users[user] >= self.per_user
                    raise busy
                await asyncio.sleep(PARSE_POLL_SECONDS)
        finally:
            self.waiting.remove(ticket)
        self.busy += 1
        self.users[user] += 1
        threads: list[asyncio.Future] = []
        jobs: list[parse_child.Job] = []

        async def run(work: Callable[[], Any]) -> Any:
            if _in_child():
                job = parse_child.Job(work, seconds=PARSE_SECONDS, memory=PARSE_MEMORY_BYTES)
                jobs.append(job)
                work = functools.partial(_run_job, job)
            future = loop.run_in_executor(None, functools.partial(contextvars.copy_context().run, work))
            future.add_done_callback(lambda done: done.cancelled() or done.exception())  # ошибка после отмены — не в лог
            threads.append(future)
            try:
                return await asyncio.shield(future)
            except parse_child.TooLong:
                raise BankError(413, "parse_too_long", PARSE_TOO_LONG_DETAIL) from None
            except parse_child.TooBig:
                raise BankError(413, "parse_too_big", PARSE_TOO_BIG_DETAIL) from None

        try:
            yield run
        finally:
            pending = [future for future in threads if not future.done()]
            if pending:  # запрос отменён посреди работы: процесс убит сейчас (поток без процесса идёт до конца),
                # место — когда работа на самом деле кончится
                for job in jobs:
                    job.stop()
                asyncio.gather(*pending, return_exceptions=True).add_done_callback(lambda _: self._leave(user))
            else:
                self._leave(user)


parse_slots = ParseSlots(PARSE_PER_USER, PARSE_AT_ONCE)


async def _parse(request: Request) -> dict:
    user = getattr(request.state, "user", None)
    if not (isinstance(user, dict) and user.get("id")):
        raise BankError(401, "auth", AUTH_DETAIL)  # middleware main.py уже ответил бы 401: вторая линия
    form = await _read_form(request)
    async with parse_slots.hold(str(user["id"]), PARSE_WAIT_SECONDS) as run:
        prepared = await prepare(request, form, run)
        # Разбор — чистый CPU (до 2 000 000 знаков): в дочернем процессе он не держит ни цикл событий, ни GIL сервера.
        options = {"key_mode": prepared["key_mode"], "key_text": prepared["key_text"], "format_mode": prepared["format_mode"]}
        if prepared["key_file"] is not None:
            options["key_file"] = prepared["key_file"]
            options["key_section"] = prepared["key_section"]
        if prepared["contents"] is not None:
            return await run(functools.partial(parse_bank_file, prepared["contents"], prepared["name"],
                                               with_pictures=prepared["with_pictures"], **options))
        return await run(functools.partial(parse_bank_text, prepared["text"], **options))


async def prepare(request: Request, form, run: Callable[[Callable[[], Any]], Any] = asyncio.to_thread) -> dict:
    """Поля формы parse-bank, проверенные: {contents, name, text, key_mode, format_mode, key_text, user_keys, key_file,
    key_section, with_pictures} (файл прочитан с пределом размера; файл ключа — разделы). Ошибки — BankError.
    Её же читает разбор с ИИ (bank_ai.py). run — где читается файл ключа: место разбора (ParseSlots.hold)."""
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
        prepared["key_file"] = await _key_file(key_upload, run)
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


async def _key_file(upload: Any, run: Callable[[Callable[[], Any]], Any] = asyncio.to_thread) -> list[dict]:
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
        return await run(functools.partial(read_key_file, contents, name))
    except BankError as exc:
        code = exc.code if exc.code.startswith("key_file") or exc.code == "no_keys" else f"key_file_{exc.code}"
        raise BankError(exc.status, code, f"Файл ключа: {exc.detail[:1].lower()}{exc.detail[1:]}") from None


# 30 в минуту: пакет из 24 вариантов (владелец, 2026-11-04) читается за один раз — по 10 в минуту половина файлов получала
# 429. Разбор — правила без ИИ, но это работа процессора: предел остаётся, и 400 в день на пользователя.
BANK_LIMIT = "30/minute;400/day"


@router.post(BANK_PATH)
@limiter.limit(BANK_LIMIT, key_func=user_or_ip_key)
async def parse_test_bank(request: Request):
    """Банк вопросов (файл или текст) → предпросмотр: предметы, темы, вопросы, ключи, флаги. Без ИИ, без единиц, в базу не пишет."""
    try:
        return await _parse(request)
    except BankError as exc:
        return bank_error_response(request, exc, "bank_api.parse_test_bank")


def bank_error_response(request: Request, exc: BankError, endpoint: str) -> JSONResponse:
    """Ответ на BankError. «Сервер занят» (parse_busy) — с Retry-After; если места заняли другие (общий предел
    PARSE_AT_ONCE), запрос не считается в пределе запросов маршрута endpoint («модуль.функция»): ждал не пользователь,
    а сервер. Свои два места заняты самим пользователем — запрос считается, как любой."""
    headers = None
    if exc.code == "parse_busy":
        headers = {"Retry-After": str(PARSE_RETRY_AFTER_SECONDS)}
        if not getattr(exc, "own_places", False):
            give_back(request, endpoint)
    return JSONResponse(status_code=exc.status, content={"detail": exc.detail, "code": exc.code}, headers=headers)
