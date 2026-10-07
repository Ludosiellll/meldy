"""Проверка ИИ в примере /try (try_api.py): копия примера без расхождений с frontend, отказ неизвестным
вопросам, длинным ответам и любым пунктам от клиента, свой ключ и общие ключи со своими потолками, пределы
на посетителя по его адресу за прокси HF, честный запасной путь (нет ключа, потолок, 429, сбой, таймаут),
429 ключа примера не охлаждает основные ключи, без Groq, без единиц и без записи в базу, одна строка в
журнал без текста ответа, кэш протокола, сутки по Тихоокеанскому времени, строка в /api/health/deep.

Модель — подменённый BaseAgent.run (или клиент google-genai, где важны ключи и охлаждение).
"""
import asyncio
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx
import pytest
from starlette.requests import Request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import health_deep  # noqa: E402
import oral  # noqa: E402
import quota  # noqa: E402
import supabase_rest  # noqa: E402
import try_api  # noqa: E402
from agents import base  # noqa: E402
from agents.base import AIError, BaseAgent  # noqa: E402
from ratelimit import RATE_LIMIT_DAY_DETAIL, RATE_LIMIT_DETAIL, visitor_ip, visitor_ip_key  # noqa: E402
from test_ai_cooldown import install_gemini, install_groq, quota_error  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
EXAMPLE_DATA = ROOT / "frontend" / "src" / "data" / "example"
REAL_RUN = BaseAgent.run
TRY_ENV = ("GEMINI_API_KEY", "GEMINI_MODELS", "GEMINI_FAST_MODELS", "GROQ_API_KEY", "TRY_GEMINI_API_KEY",
           "TRY_AI_DAILY_CAP", "TRY_AI_DAILY_CAP_SHARED", "TRY_AI_CLIENT_LIMIT", "AI_CACHE_DISABLED")
VISITOR = {"X-Forwarded-For": "203.0.113.5, 10.16.0.9"}  # посетитель, затем адрес прокси HF (дописал nginx)
Q5_ANSWER = "Эластичность — это насколько спрос реагирует на цену: на сколько процентов он меняется, когда цена меняется на процент."


class FakeModel:
    """BaseAgent.run: ответы по очереди (последний повторяется), задержка, запись вызовов и ключей агента."""

    def __init__(self):
        self.answers: list = []
        self.calls: list[dict] = []
        self.delay = 0.0

    def answer(self, *answers):
        self.answers = list(answers)

    async def run(self, agent, system_prompt, user_text, **kwargs):
        self.calls.append({"system": system_prompt, "text": user_text, "keys": agent.own_gemini_keys,
                           "groq": agent.groq_api_key, **kwargs})
        if self.delay:
            await asyncio.sleep(self.delay)
        if not self.answers:
            raise AssertionError("unexpected model call")
        item = self.answers.pop(0) if len(self.answers) > 1 else self.answers[0]
        if isinstance(item, BaseException):
            raise item
        return item if isinstance(item, str) else json.dumps(item, ensure_ascii=False)


def protocol(*statuses, errors=(), verdict="Вы назвали главное."):
    """Ответ модели по пунктам p1, p2… (отрывок — из Q5_ANSWER, чтобы он нашёлся в расшифровке)."""
    points = [
        {"id": f"p{index}", "status": status,
         "student_quote": "" if status == "missing" else "насколько спрос реагирует на цену", "comment": "Сказано своими словами."}
        for index, status in enumerate(statuses, start=1)
    ]
    return {"points": points, "errors": list(errors), "verdict": verdict}


@pytest.fixture
def client(monkeypatch):
    import main
    from fastapi.testclient import TestClient

    async def no_session(request):
        raise AssertionError("/api/try/evaluate must not ask for a session")

    monkeypatch.setattr(main, "require_authenticated_user", no_session)
    monkeypatch.setattr(main.limiter, "enabled", False)
    for name in TRY_ENV:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("SUPABASE_URL", "https://try-test.supabase.invalid")
    monkeypatch.setenv("SUPABASE_KEY", "anon-test-key")
    database: list[httpx.Request] = []

    def record(request: httpx.Request) -> httpx.Response:
        database.append(request)
        return httpx.Response(200, json=[])

    monkeypatch.setattr(supabase_rest, "_transport", httpx.MockTransport(record))
    try_api.reset_state()
    test_client = TestClient(main.app)
    test_client.main = main
    test_client.database = database
    yield test_client
    try_api.reset_state()


@pytest.fixture
def model(monkeypatch):
    fake = FakeModel()

    async def fake_run(agent, system_prompt, user_text, **kwargs):
        return await fake.run(agent, system_prompt, user_text, **kwargs)

    monkeypatch.setattr(BaseAgent, "run", fake_run)
    return fake


def evaluate(client, question_id="q5", transcript=Q5_ANSWER, headers=None, **extra):
    return client.post("/api/try/evaluate", json={"question_id": question_id, "transcript": transcript, **extra},
                       headers=headers or VISITOR)


def example():
    return try_api.example_questions()


# ── Копия примера: одна правда с frontend ────────────────────────────────────────


def _ts_literal(raw: str) -> str:
    return re.sub(r"\\(.)", r"\1", raw)


def frontend_points() -> dict[str, list[dict]]:
    """Пункты вопросов прямо из frontend/src/data/example/questions.ts (порядок, заголовок, главный, цитата)."""
    source = (EXAMPLE_DATA / "questions.ts").read_text(encoding="utf-8")
    literal = r"'((?:[^'\\]|\\.)*)'"
    question_re = re.compile(r"\{\s*id:\s*'(q\d+)',\s*number:\s*(\d+),\s*text:\s*" + literal, re.S)
    point_re = re.compile(r"title:\s*" + literal + r",\s*short:\s*" + literal + r",\s*essential:\s*(true|false),\s*quote:\s*" + literal, re.S)
    found = list(question_re.finditer(source))
    bounds = [match.start() for match in found] + [len(source)]
    questions = {}
    for index, match in enumerate(found):
        block = source[bounds[index]:bounds[index + 1]]
        questions[match.group(1)] = {
            "text": _ts_literal(match.group(3)),
            "points": [
                {"title": _ts_literal(point.group(1)), "essential": point.group(3) == "true", "source_quote": _ts_literal(point.group(4))}
                for point in point_re.finditer(block)
            ],
        }
    # Ни один пункт не потерян регулярным выражением: заголовков столько же, сколько найденных пунктов.
    assert sum(len(item["points"]) for item in questions.values()) == source.count("title: '")
    return questions


def test_the_example_copy_says_exactly_what_the_frontend_example_says():
    copy = example()
    assert copy is not None, "backend/try_example.json is missing or broken"
    frontend = frontend_points()
    answerable = [qid for qid, item in frontend.items() if item["points"]]
    assert list(copy) == answerable == [f"q{n}" for n in range(1, 12)]  # q12 нет ни в одной лекции
    for qid, question in copy.items():
        assert question.text == " ".join(frontend[qid]["text"].split())
        assert [(p["title"], p["essential"], p["source_quote"]) for p in question.points] == [
            (" ".join(p["title"].split()), p["essential"], " ".join(p["source_quote"].split())) for p in frontend[qid]["points"]
        ], f"{qid}: backend/try_example.json drifted — npx vitest run -u src/data/example/serverCopy.test.ts"
        assert [p["id"] for p in question.points] == [f"p{n}" for n in range(1, len(question.points) + 1)]


def test_every_quote_of_the_copy_is_word_for_word_in_a_lecture_of_the_example():
    lectures = " ".join(" ".join(path.read_text(encoding="utf-8").split()) for path in EXAMPLE_DATA.glob("lecture-*.txt"))
    for question in example().values():
        for point in question.points:
            assert point["source_quote"] in lectures, (question.id, point["id"])


def test_the_copy_is_what_the_protocol_accepts_from_a_real_ticket():
    raw = json.loads(try_api.EXAMPLE_FILE.read_text(encoding="utf-8"))
    for question in raw["questions"]:
        assert set(question) == {"id", "number", "text", "lecture", "points"}
        for point in question["points"]:
            assert set(point) == {"id", "title", "essential", "source_quote"}  # ни ключевых слов, ни переспросов
    for question in example().values():
        assert 1 <= len(question.points) <= oral.MAX_POINTS
        assert any(point["essential"] for point in question.points)


@pytest.mark.parametrize("broken", [
    {"v": 2, "questions": []},
    {"v": 1, "questions": []},
    {"v": 1, "questions": [{"id": "q1", "text": "Вопрос", "points": [{"id": "p2", "title": "Т", "essential": True, "source_quote": "Ц"}]}]},
    {"v": 1, "questions": [{"id": "q1", "text": "Вопрос", "points": [{"id": "p1", "title": "Т" * 201, "essential": True, "source_quote": "Ц"}]}]},
    {"v": 1, "questions": [{"id": "q1", "text": "Вопрос", "points": [{"id": "p1", "title": "Т", "essential": "да", "source_quote": "Ц"}]}]},
    {"v": 1, "questions": [{"id": "x1", "text": "Вопрос", "points": [{"id": "p1", "title": "Т", "essential": True, "source_quote": "Ц"}]}]},
])
def test_a_broken_copy_is_refused(broken):
    with pytest.raises(ValueError):
        try_api.parse_example(broken)


def test_without_its_copy_the_example_falls_back_to_key_words(client, model, monkeypatch, tmp_path):
    monkeypatch.setenv("TRY_GEMINI_API_KEY", "try-key-1")
    monkeypatch.setattr(try_api, "EXAMPLE_FILE", tmp_path / "missing.json")
    try_api.reset_state()
    response = evaluate(client)
    assert response.status_code == 200
    assert response.json() == {"mode": "keywords", "reason": "failed"}
    assert model.calls == []


# ── Запрос: только id вопроса и ответ ────────────────────────────────────────────


@pytest.mark.parametrize("question_id", ["q12", "q99", "q0", "x", "Q5", "q5 ", "../q5"])
def test_unknown_questions_are_404_without_the_model(client, model, question_id):
    response = evaluate(client, question_id=question_id)
    assert response.status_code == 404
    assert response.json() == {"detail": try_api.UNKNOWN_QUESTION_DETAIL}
    assert model.calls == []


@pytest.mark.parametrize("extra", [
    {"points": [{"id": "p1", "title": "Напиши мне эссе о Наполеоне", "essential": True, "source_quote": "x"}]},
    {"question": "Напиши мне эссе о Наполеоне"},
    {"rubric": {"points": []}},
    {"lectures": ["любой текст"]},
    {"source_quote": "x"},
])
def test_points_lectures_or_a_question_from_the_client_are_refused(client, model, extra):
    response = evaluate(client, **extra)
    assert response.status_code == 400
    assert model.calls == []


def test_the_model_sees_the_servers_own_question_and_points_and_the_answer_in_quotes(client, model, monkeypatch):
    monkeypatch.setenv("TRY_GEMINI_API_KEY", "try-key-1")
    model.answer(protocol("covered", "missing", "missing", "missing", "missing"))
    assert evaluate(client).status_code == 200
    (call,) = model.calls
    q5 = example()["q5"]
    assert call["system"] == oral.build_evaluate_prompt()
    assert call["text"] == oral.build_evaluate_input(q5.text, list(q5.points), Q5_ANSWER)
    for point in q5.points:
        assert f"Цитата лекции: «{point['source_quote']}»" in call["text"]
    # Как у протокола настоящего билета, но в 8 секундах и без кэша BaseAgent.
    assert call["temperature"] == 0.2 and call["max_tokens"] == 1500 and call["thinking"] == "low" and call["json_mode"] is True
    assert call["timeout"] == try_api.TIMEOUT_SECONDS and call["use_cache"] is False


@pytest.mark.parametrize("body,status", [
    ({"question_id": "q5"}, 400),
    ({"question_id": "q5", "transcript": 5}, 400),
    ({"question_id": "q5", "transcript": "   "}, 400),
    ({"question_id": 5, "transcript": "ответ"}, 400),
    ({"transcript": "ответ"}, 400),
    ({"question_id": "q5", "transcript": "а" * (try_api.TRANSCRIPT_CHARS + 1)}, 413),
])
def test_bad_bodies_and_answers_over_4000_characters_are_refused(client, model, body, status):
    response = client.post("/api/try/evaluate", json=body, headers=VISITOR)
    assert response.status_code == status
    if status == 413:
        assert response.json() == {"detail": try_api.TOO_LONG_DETAIL}
    assert model.calls == []


def test_a_body_over_the_size_limit_is_413_before_it_is_read_whole(client, model):
    raw = json.dumps({"question_id": "q5", "transcript": "а" * 30000}, ensure_ascii=False).encode("utf-8")
    response = client.post("/api/try/evaluate", content=raw, headers={"Content-Type": "application/json", **VISITOR})
    assert response.status_code == 413
    assert model.calls == []


def test_an_answer_of_exactly_4000_characters_is_checked(client, model, monkeypatch):
    monkeypatch.setenv("TRY_GEMINI_API_KEY", "try-key-1")
    model.answer(protocol("missing", "missing", "missing", "missing", "missing"))
    answer = ("эластичность " * 400)[: try_api.TRANSCRIPT_CHARS]
    assert len(answer) == 4000
    assert evaluate(client, transcript=answer).status_code == 200
    assert len(model.calls) == 1


# ── Свой ключ, общие ключи, потолки ──────────────────────────────────────────────


def test_with_its_own_key_the_example_uses_only_that_key_and_never_groq(client, model, monkeypatch):
    monkeypatch.setenv("TRY_GEMINI_API_KEY", " try-key-1 , try-key-2 ")
    monkeypatch.setenv("GEMINI_API_KEY", "main-key")
    monkeypatch.setenv("GROQ_API_KEY", "groq-key")
    model.answer(protocol("covered", "covered", "partial", "missing", "missing"))
    response = evaluate(client)
    assert response.status_code == 200
    body = response.json()
    assert body["mode"] == "ai"
    assert [(p["id"], p["status"]) for p in body["evaluation"]["points"]] == [
        ("p1", "covered"), ("p2", "covered"), ("p3", "partial"), ("p4", "missing"), ("p5", "missing"),
    ]
    assert body["evaluation"]["points"][0]["student_quote"] == "насколько спрос реагирует на цену"
    assert body["evaluation"]["verdict"] == "Вы назвали главное."
    (call,) = model.calls
    assert call["keys"] == ["try-key-1", "try-key-2"] and call["groq"] == ""
    assert try_api.health_view()["key"] == "own" and try_api.health_view()["calls"] == 1


def test_without_its_own_key_the_example_uses_the_main_gemini_keys_without_groq(client, model, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "main-key-1,main-key-2")
    monkeypatch.setenv("GROQ_API_KEY", "groq-key")
    model.answer(protocol("covered", "missing", "missing", "missing", "missing"))
    assert evaluate(client).json()["mode"] == "ai"
    (call,) = model.calls
    assert call["keys"] == ["main-key-1", "main-key-2"] and call["groq"] == ""
    assert try_api.health_view() == {"key": "shared", "day": try_api.health_view()["day"], "calls": 1, "cap": 60, "keywords": 0}


def test_without_any_gemini_key_the_answer_goes_to_key_words(client, model, monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "groq-key")  # Groq у примера не используется
    response = evaluate(client)
    assert response.json() == {"mode": "keywords", "reason": "no_key"}
    assert model.calls == []


def test_the_shared_keys_stop_at_their_own_daily_cap(client, model, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "main-key")
    monkeypatch.setenv("TRY_AI_DAILY_CAP_SHARED", "2")
    model.answer(protocol("covered", "missing", "missing", "missing", "missing"))
    modes = [evaluate(client, transcript=f"{Q5_ANSWER} {n}").json() for n in range(3)]
    assert [m["mode"] for m in modes] == ["ai", "ai", "keywords"]
    assert modes[2]["reason"] == "day_cap"
    assert len(model.calls) == 2
    assert try_api.health_view()["calls"] == 2 and try_api.health_view()["keywords"] == 1


def test_the_own_key_has_its_own_cap_and_the_default_is_400_shared_60(client, model, monkeypatch):
    assert try_api.daily_cap() == 400 and try_api.shared_daily_cap() == 60
    monkeypatch.setenv("TRY_AI_DAILY_CAP", "nonsense")
    assert try_api.daily_cap() == 400
    monkeypatch.setenv("TRY_GEMINI_API_KEY", "try-key-1")
    monkeypatch.setenv("TRY_AI_DAILY_CAP", "1")
    monkeypatch.setenv("TRY_AI_DAILY_CAP_SHARED", "0")
    model.answer(protocol("covered", "missing", "missing", "missing", "missing"))
    assert evaluate(client).json()["mode"] == "ai"
    assert evaluate(client, transcript="Эластичность спроса по цене — отношение процентов.").json() == {"mode": "keywords", "reason": "day_cap"}
    assert len(model.calls) == 1


def test_the_daily_caps_turn_over_at_midnight_in_pacific_time(client, model, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "main-key")
    monkeypatch.setenv("TRY_AI_DAILY_CAP_SHARED", "1")
    now = {"at": datetime(2026, 10, 7, 6, 30, tzinfo=timezone.utc)}  # 23:30 6 октября в Калифорнии (PDT)
    monkeypatch.setattr(try_api, "_now", lambda: now["at"])
    model.answer(protocol("covered", "missing", "missing", "missing", "missing"))
    assert evaluate(client, transcript="Ответ один про эластичность").json()["mode"] == "ai"
    assert evaluate(client, transcript="Ответ два про эластичность").json()["reason"] == "day_cap"
    assert try_api.health_view()["day"] == "2026-10-06"
    now["at"] = datetime(2026, 10, 7, 7, 5, tzinfo=timezone.utc)  # 00:05 7 октября по PDT: новые сутки квот
    assert evaluate(client, transcript="Ответ три про эластичность").json()["mode"] == "ai"
    assert try_api.health_view()["day"] == "2026-10-07"
    assert try_api.pacific_day(datetime(2026, 11, 2, 7, 30, tzinfo=timezone.utc)).isoformat() == "2026-11-01"  # PST: 23:30


# ── Честный запасной путь ────────────────────────────────────────────────────────


@pytest.mark.parametrize("error,reason,counted", [
    (AIError.busy(), "busy", 0),
    (AIError.failed(), "failed", 1),
    (AIError.timeout(), "timeout", 1),
    (RuntimeError("ответ студента: секрет"), "failed", 1),
])
def test_a_model_failure_answers_key_words_with_its_reason(client, model, monkeypatch, error, reason, counted):
    monkeypatch.setenv("TRY_GEMINI_API_KEY", "try-key-1")
    model.answer(error)
    response = evaluate(client)
    assert response.status_code == 200
    assert response.json() == {"mode": "keywords", "reason": reason}
    # 429 не тратит квоту: место в дневном потолке возвращается.
    assert try_api.health_view()["calls"] == counted


@pytest.mark.parametrize("raw", ["", "мусор", "{}", '{"points": []}'])
def test_an_unusable_protocol_is_key_words_failed(client, model, monkeypatch, raw):
    monkeypatch.setenv("TRY_GEMINI_API_KEY", "try-key-1")
    model.answer(raw if raw else AIError.failed())
    assert evaluate(client).json() == {"mode": "keywords", "reason": "failed"}


def test_a_slow_model_is_cut_at_the_time_limit(client, model, monkeypatch):
    monkeypatch.setenv("TRY_GEMINI_API_KEY", "try-key-1")
    monkeypatch.setattr(try_api, "TIMEOUT_SECONDS", 0.2)
    monkeypatch.setattr(try_api, "GUARD_SECONDS", 0.1)
    model.delay = 5.0
    model.answer(protocol("covered", "missing", "missing", "missing", "missing"))
    began = time.monotonic()
    response = evaluate(client)
    assert time.monotonic() - began < 2.0
    assert response.json() == {"mode": "keywords", "reason": "timeout"}


def test_the_default_time_limit_is_8_seconds():
    assert try_api.TIMEOUT_SECONDS == 8.0


# ── Та же оценка, что у настоящего билета ────────────────────────────────────────


def test_an_error_in_a_point_makes_it_wrong_not_covered(client, model, monkeypatch):
    monkeypatch.setenv("TRY_GEMINI_API_KEY", "try-key-1")
    answer = "Эластичность показывает, как спрос реагирует на цену. Если модуль больше единицы, спрос неэластичный."
    model.answer({
        "points": [
            {"id": "p1", "status": "covered", "student_quote": "как спрос реагирует на цену", "comment": "Названо."},
            {"id": "p2", "status": "missing", "student_quote": "", "comment": ""},
            {"id": "p3", "status": "covered", "student_quote": "Если модуль больше единицы", "comment": "Названо."},
            {"id": "p4", "status": "missing", "student_quote": "", "comment": ""},
            {"id": "p5", "status": "missing", "student_quote": "", "comment": ""},
        ],
        "errors": [{"point_id": "p3", "student_quote": "Если модуль больше единицы, спрос неэластичный",
                    "correction": "Если модуль больше единицы, спрос эластичный."}],
        "verdict": "Перепутаны эластичный и неэластичный спрос.",
    })
    body = evaluate(client, transcript=answer).json()
    assert body["mode"] == "ai"
    points = {p["id"]: p for p in body["evaluation"]["points"]}
    assert points["p3"]["status"] == "wrong"
    assert points["p3"]["student_quote"] == "Если модуль больше единицы, спрос неэластичный"
    assert body["evaluation"]["errors"][0]["correction"] == "Если модуль больше единицы, спрос эластичный."


@pytest.mark.parametrize("transcript", ["не знаю", "Ну, не знаю.", "затрудняюсь ответить"])
def test_dont_know_names_nothing_without_the_model_or_the_cap(client, model, monkeypatch, transcript):
    monkeypatch.setenv("TRY_GEMINI_API_KEY", "try-key-1")
    body = evaluate(client, transcript=transcript).json()
    assert body["mode"] == "ai"
    assert [p["status"] for p in body["evaluation"]["points"]] == ["missing"] * 5
    assert body["evaluation"]["verdict"] == "Ответ «не знаю»: ни один из пунктов не прозвучал."
    assert model.calls == [] and try_api.health_view()["calls"] == 0


def test_the_same_answer_again_is_the_same_protocol_without_a_second_call(client, model, monkeypatch):
    monkeypatch.setenv("TRY_GEMINI_API_KEY", "try-key-1")
    model.answer(protocol("covered", "covered", "missing", "missing", "missing"))
    first = evaluate(client).json()
    second = evaluate(client).json()
    assert first == second and first["mode"] == "ai"
    assert len(model.calls) == 1 and try_api.health_view()["calls"] == 1
    # Другой вопрос с тем же текстом — свой протокол.
    model.answer(protocol("missing", "missing", "missing", "missing"))
    assert evaluate(client, question_id="q6").json()["mode"] == "ai"
    assert len(model.calls) == 2


# ── Ключи: 429 ключа примера не охлаждает основные ключи; Groq не зовётся ──────────


def test_a_429_on_the_examples_key_rests_only_that_key(client, monkeypatch):
    monkeypatch.setattr(BaseAgent, "run", REAL_RUN)
    monkeypatch.setattr(base.random, "shuffle", lambda items: None)
    BaseAgent._run_cache.clear()
    base._MODEL_SKIP.clear()
    monkeypatch.setenv("GEMINI_MODELS", "model-a")
    good = json.dumps(protocol("covered", "missing", "missing", "missing", "missing"), ensure_ascii=False)
    calls = install_gemini(monkeypatch, lambda key, model: quota_error(per_day=True) if key == "try-key" else (good, "STOP"),
                           keys="main-key")
    groq_calls = install_groq(monkeypatch, lambda kwargs: good)
    monkeypatch.setenv("GROQ_API_KEY", "groq-key")
    monkeypatch.setenv("TRY_GEMINI_API_KEY", "try-key")

    response = evaluate(client)
    assert response.json() == {"mode": "keywords", "reason": "busy"}
    assert calls == [{"key": "try-key", "model": "model-a"}]  # ни основного ключа, ни Groq
    assert groq_calls == []
    assert base.pair_resting("gemini", "try-key", "model-a") is True
    assert base.pair_resting("gemini", "main-key", "model-a") is False
    # Пока ключ примера отдыхает, пример не стучится в него снова и не трогает основные ключи.
    assert evaluate(client, transcript=f"{Q5_ANSWER} снова").json() == {"mode": "keywords", "reason": "busy"}
    assert len(calls) == 1
    # Студенты идут по основному ключу как ни в чём не бывало.
    text = asyncio.run(BaseAgent(api_key="").run("Промпт", "Текст", use_cache=False))
    assert text == good and calls[-1] == {"key": "main-key", "model": "model-a"}


def test_an_agent_with_its_own_keys_never_reads_gemini_api_key(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "main-key")
    agent = BaseAgent(api_key="", gemini_api_keys=[" try-key ", ""])
    assert agent.own_gemini_keys == ["try-key"] and agent.gemini_keys == ["try-key"]
    assert BaseAgent(api_key="").own_gemini_keys is None and BaseAgent(api_key="").gemini_keys == ["main-key"]


# ── Без единиц и без записи в базу ───────────────────────────────────────────────


def test_no_units_and_no_database_writes_even_for_a_signed_in_visitor(client, monkeypatch, quota_on):
    monkeypatch.setenv("TRY_GEMINI_API_KEY", "try-key-1")

    async def no_charge(*args, **kwargs):
        raise AssertionError("the example must not charge units")

    async def run_and_report(agent, system_prompt, user_text, **kwargs):
        # The call log's observer fires inside the request, as after a real call: a path inside a session
        # would write this call to the user's ai_calls.
        base._record_call("gemini", "model-a", True, 10)
        return json.dumps(protocol("covered", "missing", "missing", "missing", "missing"), ensure_ascii=False)

    spawned = []
    monkeypatch.setattr(quota, "charge", no_charge)
    monkeypatch.setattr(quota, "reserve", no_charge)
    monkeypatch.setattr(quota, "_spawn", lambda coro: (spawned.append(coro), coro.close()))
    monkeypatch.setattr(BaseAgent, "run", run_and_report)
    headers = {**VISITOR, "Authorization": "Bearer some-users-token"}
    assert evaluate(client, headers=headers).json()["mode"] == "ai"
    assert spawned == []
    assert client.database == []


# ── Предел на посетителя по его адресу за прокси HF ──────────────────────────────


def test_a_visitor_gets_12_checks_in_10_minutes_by_their_own_address(client, model, monkeypatch):
    monkeypatch.setenv("TRY_GEMINI_API_KEY", "try-key-1")
    model.answer(protocol("covered", "missing", "missing", "missing", "missing"))
    monkeypatch.setattr(client.main.limiter, "enabled", True)
    client.main.limiter.reset()
    try:
        codes = [evaluate(client, transcript=f"{Q5_ANSWER} {n}").status_code for n in range(12)]
        assert codes == [200] * 12
        limited = evaluate(client, transcript=f"{Q5_ANSWER} 13")
        assert limited.status_code == 429 and limited.json() == {"detail": RATE_LIMIT_DETAIL}
        # Подделанный адрес слева ничего не меняет: прокси HF дописывает настоящий.
        spoofed = evaluate(client, headers={"X-Forwarded-For": "198.51.100.77, 203.0.113.5, 10.16.0.9"})
        assert spoofed.status_code == 429
        # Другой посетитель за тем же прокси HF — свой счёт.
        other = evaluate(client, headers={"X-Forwarded-For": "198.51.100.7, 10.16.0.9"})
        assert other.status_code == 200
    finally:
        client.main.limiter.reset()


def test_a_visitor_gets_40_checks_a_day_and_the_limit_can_be_raised_in_the_space(client, model, monkeypatch):
    assert try_api.client_limit() == "12/10 minutes;40/day"
    monkeypatch.setenv("TRY_AI_CLIENT_LIMIT", "not a limit")
    assert try_api.client_limit() == "12/10 minutes;40/day"
    monkeypatch.setenv("TRY_AI_CLIENT_LIMIT", "100/minute;3/day")
    monkeypatch.setenv("TRY_GEMINI_API_KEY", "try-key-1")
    model.answer(protocol("covered", "missing", "missing", "missing", "missing"))
    monkeypatch.setattr(client.main.limiter, "enabled", True)
    client.main.limiter.reset()
    try:
        codes = [evaluate(client, transcript=f"{Q5_ANSWER} {n}").status_code for n in range(4)]
        assert codes == [200, 200, 200, 429]
        assert evaluate(client).json() == {"detail": RATE_LIMIT_DAY_DETAIL}
    finally:
        client.main.limiter.reset()


def request_with(forwarded: list[str] | None, client_host="127.0.0.1") -> Request:
    headers = [(b"x-forwarded-for", value.encode()) for value in forwarded or []]
    return Request({"type": "http", "method": "POST", "path": "/api/try/evaluate", "headers": headers,
                    "client": (client_host, 5000), "query_string": b""})


@pytest.mark.parametrize("forwarded,expected", [
    (["203.0.113.5, 10.16.0.9"], "203.0.113.5"),  # HF: посетитель, затем прокси (дописал nginx)
    (["198.51.100.1, 203.0.113.5, 10.16.0.9"], "203.0.113.5"),  # то, что прислал сам посетитель, — левее
    (["198.51.100.1", "203.0.113.5, 10.16.0.9"], "203.0.113.5"),  # заголовок в двух строках
    (["172.17.0.1"], "172.17.0.1"),  # nginx без прокси HF (локальный запуск)
    (["2001:db8:1:2::7, 10.16.0.9"], "2001:db8:1:2::7"),
    (["203.0.113.5:51234, 10.16.0.9"], "203.0.113.5"),  # адрес с портом
    (["[2001:db8:1:2::7]:443, 10.16.0.9"], "2001:db8:1:2::7"),
    (["unknown, 10.16.0.9"], "127.0.0.1"),  # не адрес — адрес соединения
    (None, "127.0.0.1"),
])
def test_the_visitor_is_the_address_before_the_hf_proxy(forwarded, expected):
    assert visitor_ip(request_with(forwarded)) == expected


def test_the_visitor_key_groups_ipv6_by_its_64_network():
    assert visitor_ip_key(request_with(["203.0.113.5, 10.16.0.9"])) == "visitor:203.0.113.5"
    assert visitor_ip_key(request_with(["2001:db8:1:2::7, 10.16.0.9"])) == "visitor:2001:db8:1:2::/64"
    assert visitor_ip_key(request_with(["2001:db8:1:2:ffff::1, 10.16.0.9"])) == "visitor:2001:db8:1:2::/64"
    assert visitor_ip_key(request_with(["::ffff:203.0.113.5, 10.16.0.9"])) == "visitor:203.0.113.5"


# ── Журнал и /api/health/deep ────────────────────────────────────────────────────


def test_one_log_line_per_call_without_the_answer_text(client, model, monkeypatch, capsys):
    monkeypatch.setenv("TRY_GEMINI_API_KEY", "try-secret-key")
    model.answer(protocol("covered", "missing", "missing", "missing", "missing"))
    secret = "Мой ответ с личными словами про эластичность"
    evaluate(client, transcript=secret)
    model.answer(AIError.failed())
    evaluate(client, transcript=f"{secret} второй раз")
    out = capsys.readouterr().out
    lines = [line for line in out.splitlines() if line.startswith("Try evaluate")]
    assert len(lines) == 2
    assert "q5 ai (model) key=own" in lines[0] and "q5 keywords (failed) key=own" in lines[1]
    assert "личными" not in out and "try-secret-key" not in out and "203.0.113.5" not in out


def test_deep_health_shows_the_examples_key_kind_and_todays_calls_but_never_the_key(client, model, monkeypatch):
    monkeypatch.setenv("TRY_GEMINI_API_KEY", "try-secret-key")

    async def deep_health():
        return {"ok": True, "checks": {}}

    monkeypatch.setattr(health_deep, "deep_health", deep_health)
    model.answer(protocol("covered", "missing", "missing", "missing", "missing"))
    evaluate(client)
    response = client.get("/api/health/deep")
    assert response.status_code == 200
    body = response.json()
    assert body["try"] == {"key": "own", "day": body["try"]["day"], "calls": 1, "cap": 400, "keywords": 0}
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", body["try"]["day"])
    assert "try-secret-key" not in response.text
    monkeypatch.delenv("TRY_GEMINI_API_KEY")
    assert client.get("/api/health/deep").json()["try"]["key"] == "none"
