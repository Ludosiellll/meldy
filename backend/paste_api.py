"""«Быстрая контрольная»: вопросы, вставленные текстом, — разбор для живого предпросмотра (POST /api/tests/paste).

Это тот же разбор, что у импорта экзамена (bank_parse.parse_bank_text), в режиме hand: учитель отмечает ответы сам —
«*» после верного варианта, «+»/«-», строка «Ответ: б» или «(Ответ: б)», и одной отметки хватает. Отдельный путь нужен
предпросмотру: он спрашивает при каждой паузе в наборе, поэтому лимит выше, чем у разбора файлов (60 запросов в минуту
на пользователя против 10), а текст короче (до 60 000 знаков: контрольная, а не банк кафедры).

Тело — JSON {"text": "..."}. Ответ — словарь bank_parse (вопросы, варианты, ключи, флаги, пропущенные строки); текст
без вопросов — 200 с пустым списком items (предпросмотр так и пишет), а не ошибка. Ошибки — {"detail", "code"}:
400 bad_body, 413 too_much_text. Сессию проверяет общий middleware main.py (без неё — 401). Без ИИ, без единиц
лимита, в базу ничего не пишет: сохраняет клиент (container_create, container_items_add, quiz_create).
"""

from __future__ import annotations

import asyncio
import functools

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from bank_parse import BankError, parse_bank_text
from ratelimit import limiter, user_or_ip_key

router = APIRouter()

PASTE_PATH = "/api/tests/paste"
PASTE_MAX_CHARS = 60_000

BAD_BODY_DETAIL = "Не получилось прочитать текст. Обновите страницу и попробуйте ещё раз."
TOO_LONG_DETAIL = "Текст длиннее 60 000 знаков. Для такого теста загрузите файл в «Новый экзамен»."
AUTH_DETAIL = "Требуется войти в аккаунт"


def empty_result() -> dict:
    """Ответ на текст без вопросов: те же ключи, что у разбора, вопросов нет."""
    return {
        "method": "rules",
        "layout": "none",
        "layouts_seen": {},
        "confidence": 0,
        "key_source": {},
        "format_signal": None,
        "format_signals": {},
        "mark_share": 0,
        "marker": None,
        "markers": [],
        "subjects": [],
        "topics": [],
        "skipped": [],
        "warnings": [],
        "items": [],
        "stats": {"items": 0, "with_key": 0, "no_key": 0, "ambiguous": 0, "to_check": 0, "duplicates": 0, "kinds": {},
                  "options": {}, "gaps": [], "key_lists": 0},
    }


def parse_paste(text: str) -> dict:
    """Текст быстрой контрольной → предпросмотр. Без вопросов — empty_result(). Слишком длинный — BankError 413."""
    if len(text) > PASTE_MAX_CHARS:
        raise BankError(413, "too_much_text", TOO_LONG_DETAIL)
    if not text.strip():
        return empty_result()
    try:
        return parse_bank_text(text, hand=True)
    except BankError as exc:
        if exc.code == "no_items":
            return empty_result()
        raise


@router.post(PASTE_PATH)
@limiter.limit("60/minute", key_func=user_or_ip_key)
async def parse_pasted_test(request: Request):
    """Вставленный текст быстрой контрольной → вопросы с ответами для предпросмотра."""
    try:
        user = getattr(request.state, "user", None)
        if not (isinstance(user, dict) and user.get("id")):
            raise BankError(401, "auth", AUTH_DETAIL)  # middleware main.py уже ответил бы 401: вторая линия
        try:
            body = await request.json()
        except Exception:
            raise BankError(400, "bad_body", BAD_BODY_DETAIL) from None
        text = body.get("text") if isinstance(body, dict) else None
        if not isinstance(text, str):
            raise BankError(400, "bad_body", BAD_BODY_DETAIL)
        # Разбор — чистый CPU: в потоке-исполнителе он не держит цикл событий.
        return await asyncio.to_thread(functools.partial(parse_paste, text))
    except BankError as exc:
        return JSONResponse(status_code=exc.status, content={"detail": exc.detail, "code": exc.code})
