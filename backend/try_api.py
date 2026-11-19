"""Проверка ИИ в примере без регистрации (/try): POST /api/try/evaluate.

Пример (frontend/src/data/example) проверял ответ только ключевыми словами в браузере, и пересказ своими
словами получал «не назван»: в живом прогоне 07.10 вердикты модели по пунктам совпали с известной правдой
в 41 из 42 случаев, ключевые слова — в 23. Теперь ответ на вопрос примера проверяет тот же протокол, что
и настоящий билет: oral_api.judge_answer (промпт D, повтор при обрыве, oral.validate_evaluation — пункт
с ошибкой становится wrong, «не знаю» ничего не называет). Переспрос выбирает браузер. Ответ на вопрос
экзаменатора проверяет тот же промпт по одному пункту, что у настоящего билета (/api/oral/check с only,
oral.build_check_prompt): иначе верный ответ на переспрос в примере никогда не засчитывался — ключевые
слова дают самое большее «упомянут» (PUB-2). Модель зовётся не больше двух раз на ответ: протокол ответа
и ответ на переспрос; оба вызова — в тех же потолках и пределах.

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

Ответ на вопрос экзаменатора: тело {"question_id", "point_id", "transcript"} — id пункта из копии примера
и текст ответа на переспрос. Вопрос экзаменатора и то, что на него должно прозвучать, клиент не присылает:
сервер берёт их из своей копии (followup пункта) и даёт модели, как /api/oral/check настоящего билета.
Ответ: {"mode": "ai", "status": covered | partial | missing | wrong} или те же {"mode": "keywords",
"reason": …}; бюджет FOLLOWUP_TIMEOUT_SECONDS = 4,5 с, как у быстрой проверки билета. Пустой ответ и
«не знаю» — missing без модели; пункт, которого у вопроса нет, — 400.

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
# Ответ на вопрос экзаменатора: быстрая проверка одного пункта, бюджет как у /api/oral/check (4,5 с).
FOLLOWUP_TIMEOUT_SECONDS = 4.5
GUARD_SECONDS = 0.5  # жёсткий потолок поверх бюджета протокола
MAX_BODY_BYTES = 32 * 1024
TRANSCRIPT_CHARS = 4000
DEFAULT_DAILY_CAP = 400
DEFAULT_SHARED_DAILY_CAP = 60
# A hall on one address (the final of 20.11: the jury and the stand's QR cards behind one Wi-Fi) — every visitor there
# shares this limit, and a run of the example is two calls. Was «12/10 minutes;40/day»: six runs in ten minutes for the
# whole room. The day's own cap (TRY_AI_DAILY_CAP) still bounds what the example can spend.
DEFAULT_CLIENT_LIMIT = "80/10 minutes;400/day"
# Who checks an answer of the example (19.11: Gemini's main model timed out all afternoon and the example fell to key
# words, «ИИ не успел проверить ответ»; the owner: «по умолчанию ставь glm, там токенов куча»):
#   1. the server's extra provider (agents/base.py extra_provider), when the server has one — alone, for its share of
#      the time; an answer that does not pass the same checks as any other is not taken;
#   2. then the example's own Gemini keys for their share of what is left;
#   3. then Groq as the spare, at most DEFAULT_GROQ_SPARE_CAP answers a day (the app's own spare is the same key);
#   4. then key words, as before.
DEFAULT_GROQ_SPARE_CAP = 150
EXTRA_SHARE_SECONDS = 4.5
FOLLOWUP_EXTRA_SHARE_SECONDS = 2.5
GEMINI_SHARE_SECONDS = 4.0
FOLLOWUP_GEMINI_SHARE_SECONDS = 2.5
MIN_SPARE_SECONDS = 1.2
CACHE_ENTRIES = 64
# Протокол ответа — id вопроса и ответ; ответ на вопрос экзаменатора — ещё id пункта. Других полей нет.
BODY_KEYS = frozenset({"question_id", "transcript", "point_id"})
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
            followup = point.get("followup")
            asked = followup.get("question") if isinstance(followup, dict) else None
            expected = followup.get("expected") if isinstance(followup, dict) else None
            if not isinstance(asked, str) or not asked.strip() or len(asked) > oral_api.FOLLOWUP_QUESTION_CHARS:
                raise ValueError(f"example copy: bad follow-up question in {qid}")
            if not isinstance(expected, str) or not expected.strip() or len(expected) > oral_api.FOLLOWUP_EXPECTED_CHARS:
                raise ValueError(f"example copy: bad follow-up answer in {qid}")
            points.append({
                "id": point["id"],
                "title": _one_line(title),
                "essential": essential,
                "source_quote": _one_line(quote),
                "followup": {"question": _one_line(asked), "expected": _one_line(expected)},
            })
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


def groq_spare_cap() -> int:
    """TRY_GROQ_DAILY_CAP (по умолчанию 150): сколько ответов в сутки пример может взять у запасного Groq; 0 — ни одного."""
    return _env_count("TRY_GROQ_DAILY_CAP", DEFAULT_GROQ_SPARE_CAP)


class _GroqSpare:
    """Сколько раз за сутки (по тихоокеанскому дню, как у потолков примера) запасной Groq ответил примеру."""

    def __init__(self) -> None:
        self.day: date | None = None
        self.answers = 0

    def _roll(self) -> None:
        today = pacific_day(_now())
        if self.day != today:
            self.day, self.answers = today, 0

    def key(self) -> str:
        """Ключ запасного Groq, пока его доля на сегодня не вышла; иначе пусто."""
        self._roll()
        key = os.getenv("GROQ_API_KEY", "").strip()
        return key if key and self.answers < groq_spare_cap() else ""

    def note(self) -> None:
        self._roll()
        self.answers += 1

    def reset(self) -> None:
        self.day, self.answers = None, 0


_groq_spare = _GroqSpare()


class _ExampleAgent(BaseAgent):
    """Агент примера: считает ответы, которые дал запасной Groq (его доля в сутки ограничена)."""

    async def run(self, *args: Any, **kwargs: Any) -> str:
        meta = kwargs.get("meta")
        if not isinstance(meta, dict):
            meta = {}
            kwargs["meta"] = meta
        try:
            return await super().run(*args, **kwargs)
        finally:
            if meta.get("provider") == "groq":
                _groq_spare.note()


def extra_agent() -> BaseAgent | None:
    """Дополнительный провайдер сервера один, без Gemini и Groq: его пример спрашивает первым. None — на сервере его нет."""
    if ai_base.extra_provider() is None:
        return None
    return _ExampleAgent(api_key="", gemini_api_keys=[], extra=True)


def example_agent(pool: "Pool") -> BaseAgent:
    """Ключи пула примера и запасной Groq в пределах его доли на сутки. Дополнительный провайдер здесь не участвует:
    его спрашивают отдельно и раньше (extra_agent)."""
    return _ExampleAgent(api_key=_groq_spare.key(), gemini_api_keys=pool.keys, extra=False)


def _shares(first: BaseAgent | None, spent: float, total: float, gemini_share: float) -> tuple[float, float]:
    """(бюджет, доля Gemini) для ключей примера и запасного после попытки дополнительного провайдера."""
    budget = total - spent if first is not None else total
    return budget, min(gemini_share, budget * 0.6)


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
    _groq_spare.reset()
    _protocols.clear()
    _example, _example_failure_reported = None, False


# ── POST /api/try/evaluate ──────────────────────────────────────────────────────


def _fields(body: dict) -> tuple[str, str, str | None]:
    """id вопроса, ответ и — для ответа на вопрос экзаменатора — id пункта; любое другое поле (пункты,
    лекции, вопрос) — 400."""
    if set(body) - BODY_KEYS:
        raise oral_api._bad()
    question_id = body.get("question_id")
    if not isinstance(question_id, str):
        raise oral_api._bad()
    if not _QUESTION_ID_RE.match(question_id):
        raise HTTPException(status_code=404, detail=UNKNOWN_QUESTION_DETAIL)
    point_id = body.get("point_id")
    if point_id is not None and (not isinstance(point_id, str) or not _POINT_ID_RE.match(point_id)):
        raise oral_api._bad()
    transcript = body.get("transcript")
    if not isinstance(transcript, str):
        raise oral_api._bad()
    if len(transcript) > TRANSCRIPT_CHARS:
        raise HTTPException(status_code=413, detail=TOO_LONG_DETAIL)
    if not transcript.strip():
        raise oral_api._bad()
    return question_id, transcript, point_id


def _reason_of(exc: AIError) -> str:
    return {"ai_busy": "busy", "ai_timeout": "timeout", "ai_unconfigured": "no_key"}.get(exc.code, "failed")


def _log(question_id: str, mode: str, why: str, pool: Pool | None, transcript: str, started: float) -> None:
    ms = int((time.monotonic() - started) * 1000)
    where = pool.name if pool else "none"
    print(f"Try evaluate: {question_id} {mode} ({why}) key={where} chars={len(transcript)} ms={ms}")


def _keywords(reason: str) -> dict:
    _calls.note_keywords()
    return {"mode": "keywords", "reason": reason}


async def _judge_followup(question: ExampleQuestion, points: list[dict], point_id: str, transcript: str, started: float) -> dict:
    """Ответ на вопрос экзаменатора о пункте point_id: статус пункта промптом C по одному пункту, как у
    /api/oral/check с only, — или «проверьте ключевыми словами» с причиной. Вопрос экзаменатора и то, что на
    него должно прозвучать, сервер берёт из своей копии (followup пункта), как настоящий билет — из эталона.
    Без них модель не знала, о чём спросили: ответ словами самого пункта («Совершенно неэластичный и
    совершенно эластичный спрос.» на «Какие крайние случаи…?») читался как повтор пункта — «не назван»
    (живая проверка жюри 11.10)."""
    where = f"{question.id}/{point_id}"
    if not oral.words(transcript) or oral.says_dont_know(transcript):
        # «Не знаю» — ответ кнопки: пункт не назван, без модели.
        _log(where, "ai", "dont_know", None, transcript, started)
        return {"mode": "ai", "status": "missing"}
    key = _protocol_key(where, transcript)
    cached = _cached_protocol(key)
    if cached is not None:
        _log(where, "ai", "cached", None, transcript, started)
        return {"mode": "ai", "status": cached["status"]}
    pool = current_pool()
    if pool is None:
        _log(where, "keywords", "no_key", None, transcript, started)
        return _keywords("no_key")
    if not _calls.take(pool):
        _log(where, "keywords", "day_cap", pool, transcript, started)
        return _keywords("day_cap")
    asked = next(point for point in points if point["id"] == point_id)["followup"]
    ids = [point["id"] for point in points]

    async def judged(agent: BaseAgent, budget: float, gemini_share: float | None) -> str | None:
        """Статус пункта от модели этого агента, или None — ответ оборван или не разобран."""
        meta: dict = {}
        raw = await asyncio.wait_for(
            oral_api._run_model(
                oral.build_check_prompt(point_id),
                oral.build_check_input(
                    question.text,
                    points,
                    transcript,
                    only=point_id,
                    followup_question=asked["question"],
                    followup_expected=asked["expected"],
                ),
                budget=budget,
                agent=agent,
                thinking="off",
                temperature=0,
                max_tokens=oral_api.CHECK_MAX_TOKENS,
                json_mode=True,
                meta=meta,
                use_cache=False,
                **({} if gemini_share is None else {"gemini_timeout": gemini_share}),
            ),
            timeout=budget + GUARD_SECONDS,
        )
        statuses = None if oral_api._cut_off(meta) else oral.validate_statuses(oral_api._parsed(raw), ids, point_id)
        return None if statuses is None else statuses[point_id]

    asked_at = time.monotonic()
    first = extra_agent()
    if first is not None:
        try:
            status = await judged(first, FOLLOWUP_EXTRA_SHARE_SECONDS, None)
        except Exception as exc:  # текст исключения может цитировать ответ: в журнал — только класс
            status = None
            print(f"Try evaluate: the extra provider gave no status ({type(exc).__name__})")
        if status is not None:
            _keep_protocol(key, {"status": status})
            _log(where, "ai", "extra", pool, transcript, started)
            return {"mode": "ai", "status": status}
    budget, gemini_share = _shares(first, time.monotonic() - asked_at, FOLLOWUP_TIMEOUT_SECONDS, FOLLOWUP_GEMINI_SHARE_SECONDS)
    if budget < MIN_SPARE_SECONDS:
        _log(where, "keywords", "timeout", pool, transcript, started)
        return _keywords("timeout")
    try:
        status = await judged(example_agent(pool), budget, gemini_share)
    except asyncio.TimeoutError:
        reason = why = "timeout"
    except AIError as exc:
        reason = why = _reason_of(exc)
        if reason in ("busy", "no_key"):
            _calls.give_back(pool)  # до модели не дошло или 429: квота не потрачена
    except Exception as exc:  # текст исключения может цитировать ответ: в журнал — только класс
        reason, why = "failed", f"failed: {type(exc).__name__}"
    else:
        if status is not None:
            _keep_protocol(key, {"status": status})
            _log(where, "ai", "model", pool, transcript, started)
            return {"mode": "ai", "status": status}
        reason = why = "failed"
    _log(where, "keywords", why, pool, transcript, started)
    return _keywords(reason)


@router.post(TRY_EVALUATE_PATH)
@limiter.limit(client_limit, key_func=visitor_ip_key)
async def try_evaluate(request: Request):
    """Протокол ответа на вопрос примера моделью — или честное «проверьте ключевыми словами»; с point_id —
    статус пункта по ответу на вопрос экзаменатора. См. модуль."""
    started = time.monotonic()
    body = await oral_api._read_json(request, MAX_BODY_BYTES)
    question_id, transcript, point_id = _fields(body)
    example = example_questions()
    if example is None:
        _log(question_id, "keywords", "failed", None, transcript, started)
        return _keywords("failed")
    question = example.get(question_id)
    if question is None:
        raise HTTPException(status_code=404, detail=UNKNOWN_QUESTION_DETAIL)
    points = [dict(point) for point in question.points]
    if point_id is not None:
        if all(point["id"] != point_id for point in points):
            raise oral_api._bad()
        return await _judge_followup(question, points, point_id, transcript, started)

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
    # Сначала дополнительный провайдер сервера, если он есть; затем ключи примера и запасной Groq (см. выше).
    asked_at = time.monotonic()
    first = extra_agent()
    if first is not None:
        try:
            result = await asyncio.wait_for(
                oral_api.judge_answer(question.text, points, transcript, budget=EXTRA_SHARE_SECONDS, agent=first, use_cache=False),
                timeout=EXTRA_SHARE_SECONDS + GUARD_SECONDS,
            )
        except Exception as exc:  # текст исключения может цитировать ответ: в журнал — только класс
            print(f"Try evaluate: the extra provider gave no protocol ({type(exc).__name__})")
        else:
            _keep_protocol(key, result)
            _log(question.id, "ai", "extra", pool, transcript, started)
            return {"mode": "ai", "evaluation": result}
    budget, gemini_share = _shares(first, time.monotonic() - asked_at, TIMEOUT_SECONDS, GEMINI_SHARE_SECONDS)
    if budget < MIN_SPARE_SECONDS:
        _log(question.id, "keywords", "timeout", pool, transcript, started)
        return _keywords("timeout")
    try:
        result = await asyncio.wait_for(
            oral_api.judge_answer(
                question.text, points, transcript, budget=budget, agent=example_agent(pool), use_cache=False,
                gemini_timeout=gemini_share,
            ),
            timeout=budget + GUARD_SECONDS,
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
