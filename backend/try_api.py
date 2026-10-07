"""Проверка ИИ в примере без регистрации (/try): POST /api/try/evaluate.

Пример (frontend/src/data/example) проверял ответ только ключевыми словами в браузере, и пересказ своими
словами получал «не назван»: в живом прогоне 07.10 вердикты модели по пунктам совпали с известной правдой
в 41 из 42 случаев, ключевые слова — в 23. Теперь ответ на вопрос примера проверяет тот же протокол, что
и настоящий билет: oral_api.judge_answer (промпт D, повтор при обрыве, oral.validate_evaluation — пункт
с ошибкой становится wrong, «не знаю» ничего не называет). Переспрос выбирает браузер; модель зовётся
один раз на ответ.

Путь открыт без входа (main.PUBLIC_API_PATHS), поэтому:
- вопросы, пункты и цитаты лекций сервер берёт только из своей копии примера try_example.json. Её пишет
  frontend из данных самого примера (src/data/example/serverCopy.ts), а serverCopy.test.ts падает при
  любом расхождении. Клиент присылает только id вопроса и текст ответа; тело с любым другим полем
  (пункты, лекции, вопрос) — 400: путь нельзя использовать как бесплатный доступ к модели;
- свой ключ TRY_GEMINI_API_KEY (можно несколько через запятую, как GEMINI_API_KEY) со своим дневным
  потолком TRY_AI_DAILY_CAP (по умолчанию 400 вызовов). Без него — основные ключи Gemini, но не больше
  TRY_AI_DAILY_CAP_SHARED (по умолчанию 60) вызовов в сутки: пример не съедает квоту студентов. Только
  Gemini, без запасного Groq: строка приватности примера называет ровно сервер Meldy и ИИ-сервис Google Gemini.
  429 на ключе примера охлаждает только его пары (агент со своими ключами, agents/base.py): основные
  ключи от него не отдыхают;
- предел на посетителя TRY_AI_CLIENT_LIMIT (по умолчанию 12 за 10 минут и 40 в сутки) — по адресу
  посетителя за прокси Hugging Face (ratelimit.visitor_ip_key); сверх него — общий 429 лимитера;
- единицы не списываются, в базу ничего не пишется (путь вне сессии: журнал вызовов ai_calls не
  привязан); в журнал сервера — одна строка на запрос, без текста ответа и без адреса.

Ответ (200): {"mode": "ai", "evaluation": {points, errors, verdict}} — как у /api/oral/evaluate, или
{"mode": "keywords", "reason": …} — тогда страница проверяет ответ ключевыми словами, как раньше, и пишет
об этом в протоколе. Причины: no_key (ключей Gemini нет), day_cap (дневной потолок), busy (429 модели),
timeout (TIMEOUT_SECONDS = 8 с), failed (сбой модели, непригодный ответ, нет копии примера). Пустой ответ
и «не знаю» — протокол без модели, как у /api/oral/evaluate. Негодный запрос: 400, неизвестный вопрос —
404, ответ длиннее TRANSCRIPT_CHARS — 413.

Счётчики потолков, пределы slowapi и кэш готовых протоколов живут в памяти процесса: Space работает
одним процессом uvicorn, и для него этого достаточно; перезапуск или сон Space их обнуляет. Сутки
потолков — тихоокеанские, как у квот Gemini, которые они берегут (сброс в полночь по Тихоокеанскому
времени).
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import time
from collections import OrderedDict
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from limits import parse_many

import oral
import oral_api
from agents import base as ai_base
from agents.base import AIError, BaseAgent
from ratelimit import limiter, visitor_ip_key

router = APIRouter()

TRY_EVALUATE_PATH = "/api/try/evaluate"
EXAMPLE_FILE = Path(__file__).resolve().parent / "try_example.json"

TIMEOUT_SECONDS = 8.0
GUARD_SECONDS = 0.5  # жёсткий потолок поверх бюджета протокола
MAX_BODY_BYTES = 32 * 1024
TRANSCRIPT_CHARS = 4000
DEFAULT_DAILY_CAP = 400
DEFAULT_SHARED_DAILY_CAP = 60
DEFAULT_CLIENT_LIMIT = "12/10 minutes;40/day"
CACHE_ENTRIES = 64
BODY_KEYS = frozenset({"question_id", "transcript"})
REASONS = ("no_key", "day_cap", "busy", "timeout", "failed")

UNKNOWN_QUESTION_DETAIL = "Такого вопроса в примере нет."
TOO_LONG_DETAIL = f"Ответ слишком длинный: в примере ИИ проверяет ответы до {TRANSCRIPT_CHARS} знаков."

_QUESTION_ID_RE = re.compile(r"^q\d{1,2}$")
_POINT_ID_RE = re.compile(r"^p[1-6]$")


# ── Копия примера ───────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class ExampleQuestion:
    id: str
    text: str
    points: tuple[dict, ...]


def _one_line(value: Any) -> str:
    return " ".join(str(value).split())


def parse_example(data: Any) -> dict[str, ExampleQuestion]:
    """Вопросы копии примера по id; ValueError, если копия не та, что пишет serverCopy.ts."""
    if not isinstance(data, dict) or data.get("v") != 1 or not isinstance(data.get("questions"), list):
        raise ValueError("example copy: not v1")
    questions: dict[str, ExampleQuestion] = {}
    for item in data["questions"]:
        if not isinstance(item, dict):
            raise ValueError("example copy: question is not an object")
        qid, text, raw_points = item.get("id"), item.get("text"), item.get("points")
        if not isinstance(qid, str) or not _QUESTION_ID_RE.match(qid) or qid in questions:
            raise ValueError("example copy: bad question id")
        if not isinstance(text, str) or not text.strip() or len(text) > oral_api.QUESTION_CHARS:
            raise ValueError(f"example copy: bad text of {qid}")
        if not isinstance(raw_points, list) or not 1 <= len(raw_points) <= oral.MAX_POINTS:
            raise ValueError(f"example copy: bad points of {qid}")
        points = []
        for index, point in enumerate(raw_points, start=1):
            if not isinstance(point, dict) or point.get("id") != f"p{index}" or not _POINT_ID_RE.match(point["id"]):
                raise ValueError(f"example copy: bad point id in {qid}")
            title, quote, essential = point.get("title"), point.get("source_quote"), point.get("essential")
            if not isinstance(title, str) or not title.strip() or len(title) > oral_api.POINT_TITLE_CHARS:
                raise ValueError(f"example copy: bad title in {qid}")
            if not isinstance(quote, str) or not quote.strip() or len(quote) > oral_api.POINT_QUOTE_CHARS:
                raise ValueError(f"example copy: bad quote in {qid}")
            if not isinstance(essential, bool):
                raise ValueError(f"example copy: bad essential in {qid}")
            points.append({"id": point["id"], "title": _one_line(title), "essential": essential, "source_quote": _one_line(quote)})
        questions[qid] = ExampleQuestion(id=qid, text=_one_line(text), points=tuple(points))
    if not questions:
        raise ValueError("example copy: no questions")
    return questions


_example: dict[str, ExampleQuestion] | None = None
_example_failure_reported = False


def example_questions() -> dict[str, ExampleQuestion] | None:
    """Копия примера (читается один раз); None — файла нет или он испорчен (одна строка в журнал)."""
    global _example, _example_failure_reported
    if _example is None:
        try:
            _example = parse_example(json.loads(EXAMPLE_FILE.read_text(encoding="utf-8")))
        except (OSError, ValueError) as exc:
            if not _example_failure_reported:
                _example_failure_reported = True
                print(f"Try evaluate: the example copy is unusable ({type(exc).__name__}: {exc})")
            return None
    return _example


# ── Ключи и потолки ─────────────────────────────────────────────────────────────


def _env_count(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    try:
        value = int(raw) if raw else default
    except ValueError:
        return default
    return value if value >= 0 else default


def try_keys() -> list[str]:
    """TRY_GEMINI_API_KEY: ключи отдельного проекта Google для примера, через запятую."""
    return [key.strip() for key in os.getenv("TRY_GEMINI_API_KEY", "").split(",") if key.strip()]


def daily_cap() -> int:
    """TRY_AI_DAILY_CAP (по умолчанию 400): вызовов модели на своём ключе примера за сутки; 0 — ни одного."""
    return _env_count("TRY_AI_DAILY_CAP", DEFAULT_DAILY_CAP)


def shared_daily_cap() -> int:
    """TRY_AI_DAILY_CAP_SHARED (по умолчанию 60): вызовов на основных ключах за сутки, когда своего нет."""
    return _env_count("TRY_AI_DAILY_CAP_SHARED", DEFAULT_SHARED_DAILY_CAP)


def client_limit() -> str:
    """TRY_AI_CLIENT_LIMIT — предел на посетителя в записи slowapi («12/10 minutes;40/day»); читается при
    каждом запросе, негодная запись — значение по умолчанию. Его можно поднять в настройках Space без
    выпуска, например на день показа, когда зал сидит за одним адресом."""
    raw = os.getenv("TRY_AI_CLIENT_LIMIT", "").strip()
    if raw:
        try:
            if list(parse_many(raw)):
                return raw
        except ValueError:
            pass
    return DEFAULT_CLIENT_LIMIT


@dataclass(frozen=True)
class Pool:
    """Чьи ключи проверяют ответ: own — свои ключи примера, shared — основные ключи Gemini."""

    name: str
    keys: list[str]
    cap: int


def current_pool() -> Pool | None:
    own = try_keys()
    if own:
        return Pool("own", own, daily_cap())
    shared = ai_base.gemini_keys()
    if shared:
        return Pool("shared", shared, shared_daily_cap())
    return None


def _now() -> datetime:
    """UTC сейчас (тесты подменяют)."""
    return datetime.now(timezone.utc)


def pacific_day(now: datetime) -> date:
    """Тихоокеанские сутки момента now: день квот Gemini (переходы на летнее и зимнее время учтены)."""
    since, _ = ai_base.pacific_day_position(now)
    midnight = now.astimezone(timezone.utc) - timedelta(seconds=since)  # 07:00 или 08:00 UTC того же числа
    return (midnight + timedelta(hours=12)).date()


class DailyCalls:
    """Вызовы модели примером за тихоокеанские сутки — отдельно по своему ключу и по основным — и ответы
    ключевыми словами. Один процесс, один поток событий: take() и give_back() атомарны."""

    def __init__(self) -> None:
        self.day: date | None = None
        self.calls = {"own": 0, "shared": 0}
        self.keywords = 0

    def _roll(self) -> None:
        today = pacific_day(_now())
        if self.day != today:
            self.day, self.calls, self.keywords = today, {"own": 0, "shared": 0}, 0

    def take(self, pool: Pool) -> bool:
        """Место для вызова модели (True) или потолок суток (False)."""
        self._roll()
        if self.calls[pool.name] >= pool.cap:
            return False
        self.calls[pool.name] += 1
        return True

    def give_back(self, pool: Pool) -> None:
        """Вызов не дошёл до модели (все пары отдыхают после 429, ключ не принят): место возвращается."""
        self.calls[pool.name] = max(0, self.calls[pool.name] - 1)

    def note_keywords(self) -> None:
        self._roll()
        self.keywords += 1

    def view(self, pool: Pool | None) -> dict:
        self._roll()
        return {
            "key": pool.name if pool else "none",
            "day": self.day.isoformat() if self.day else None,
            "calls": self.calls[pool.name] if pool else 0,
            "cap": pool.cap if pool else 0,
            "keywords": self.keywords,
        }

    def reset(self) -> None:
        self.__init__()


_calls = DailyCalls()


def health_view() -> dict:
    """Для /api/health/deep: чей ключ у примера (own, shared, none — никогда сам ключ), сутки, вызовы
    модели и потолок, ответы ключевыми словами."""
    return _calls.view(current_pool())


# ── Готовые протоколы ───────────────────────────────────────────────────────────

# Тот же вопрос и тот же текст ответа («Вставить ответ примера» у вопроса 5) — тот же протокол, без
# нового вызова модели. Свой кэш, а не кэш BaseAgent: ответы примера не вытесняют оттуда ответы студентов.
_protocols: OrderedDict[str, dict] = OrderedDict()


def _protocol_key(question_id: str, transcript: str) -> str:
    return hashlib.sha256(f"{question_id}\n{transcript}".encode("utf-8")).hexdigest()


def _cached_protocol(key: str) -> dict | None:
    found = _protocols.get(key)
    if found is not None:
        _protocols.move_to_end(key)
    return found


def _keep_protocol(key: str, result: dict) -> None:
    _protocols[key] = result
    _protocols.move_to_end(key)
    while len(_protocols) > CACHE_ENTRIES:
        _protocols.popitem(last=False)


def reset_state() -> None:
    """Тесты: потолки суток, кэш протоколов и копия примера — с нуля."""
    global _example, _example_failure_reported
    _calls.reset()
    _protocols.clear()
    _example, _example_failure_reported = None, False


# ── POST /api/try/evaluate ──────────────────────────────────────────────────────


def _fields(body: dict) -> tuple[str, str]:
    """id вопроса и ответ; любое другое поле (пункты, лекции, вопрос) — 400."""
    if set(body) - BODY_KEYS:
        raise oral_api._bad()
    question_id = body.get("question_id")
    if not isinstance(question_id, str):
        raise oral_api._bad()
    if not _QUESTION_ID_RE.match(question_id):
        raise HTTPException(status_code=404, detail=UNKNOWN_QUESTION_DETAIL)
    transcript = body.get("transcript")
    if not isinstance(transcript, str):
        raise oral_api._bad()
    if len(transcript) > TRANSCRIPT_CHARS:
        raise HTTPException(status_code=413, detail=TOO_LONG_DETAIL)
    if not transcript.strip():
        raise oral_api._bad()
    return question_id, transcript


def _reason_of(exc: AIError) -> str:
    return {"ai_busy": "busy", "ai_timeout": "timeout", "ai_unconfigured": "no_key"}.get(exc.code, "failed")


def _log(question_id: str, mode: str, why: str, pool: Pool | None, transcript: str, started: float) -> None:
    ms = int((time.monotonic() - started) * 1000)
    where = pool.name if pool else "none"
    print(f"Try evaluate: {question_id} {mode} ({why}) key={where} chars={len(transcript)} ms={ms}")


def _keywords(reason: str) -> dict:
    _calls.note_keywords()
    return {"mode": "keywords", "reason": reason}


@router.post(TRY_EVALUATE_PATH)
@limiter.limit(client_limit, key_func=visitor_ip_key)
async def try_evaluate(request: Request):
    """Протокол ответа на вопрос примера моделью — или честное «проверьте ключевыми словами». См. модуль."""
    started = time.monotonic()
    body = await oral_api._read_json(request, MAX_BODY_BYTES)
    question_id, transcript = _fields(body)
    example = example_questions()
    if example is None:
        _log(question_id, "keywords", "failed", None, transcript, started)
        return _keywords("failed")
    question = example.get(question_id)
    if question is None:
        raise HTTPException(status_code=404, detail=UNKNOWN_QUESTION_DETAIL)
    points = [dict(point) for point in question.points]

    shortcut = oral_api.dont_know_evaluation(points, transcript)
    if shortcut is not None:
        # «Не знаю» — ответ кнопки, как у настоящего билета: без модели.
        _log(question.id, "ai", "dont_know", None, transcript, started)
        return {"mode": "ai", "evaluation": shortcut}
    key = _protocol_key(question.id, transcript)
    cached = _cached_protocol(key)
    if cached is not None:
        _log(question.id, "ai", "cached", None, transcript, started)
        return {"mode": "ai", "evaluation": cached}

    pool = current_pool()
    if pool is None:
        _log(question.id, "keywords", "no_key", None, transcript, started)
        return _keywords("no_key")
    if not _calls.take(pool):
        _log(question.id, "keywords", "day_cap", pool, transcript, started)
        return _keywords("day_cap")
    # Только ключи пула и без Groq: api_key пустой — запасного провайдера у примера нет.
    agent = BaseAgent(api_key="", gemini_api_keys=pool.keys)
    try:
        result = await asyncio.wait_for(
            oral_api.judge_answer(question.text, points, transcript, budget=TIMEOUT_SECONDS, agent=agent, use_cache=False),
            timeout=TIMEOUT_SECONDS + GUARD_SECONDS,
        )
    except asyncio.TimeoutError:
        reason = why = "timeout"
    except AIError as exc:
        reason = why = _reason_of(exc)
        if reason in ("busy", "no_key"):
            _calls.give_back(pool)  # до модели не дошло или 429: квота не потрачена
    except Exception as exc:  # текст исключения может цитировать ответ: в журнал — только класс
        reason, why = "failed", f"failed: {type(exc).__name__}"
    else:
        _keep_protocol(key, result)
        _log(question.id, "ai", "model", pool, transcript, started)
        return {"mode": "ai", "evaluation": result}
    _log(question.id, "keywords", why, pool, transcript, started)
    return _keywords(reason)
