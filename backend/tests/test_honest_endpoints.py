"""Legacy AI endpoints answer 429/502 instead of stand-ins, and never leak provider text."""
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agents import base  # noqa: E402
from agents.base import AIError, BaseAgent  # noqa: E402

EVALUATE = {"context": "Лекция про инфляцию.", "question": "Что такое инфляция?", "student_answer": "Рост цен."}
MISTAKES = [
    {"id": "m-1", "question": "Что такое инфляция?", "student_answer": "Падение цен", "correct_answer": "Рост цен", "topic": "Экономика"},
    {"id": "m-2", "question": "Что повышает ЦБ?", "student_answer": "Налоги", "correct_answer": "Ставку", "topic": "Экономика"},
]


def evaluation(score=77, grade="5", verdict="Хороший ответ.", **extra):
    return json.dumps({"score": score, "grade": grade, "verdict": verdict, "correct_points": ["Рост цен"],
                       "errors": [], "missing_points": ["Причины"], **extra}, ensure_ascii=False)


def practice_item(**overrides):
    item = {
        "id": 1,
        "mistake_id": "m-1",
        "question": "Как называется устойчивый рост цен?",
        "options": ["A) Инфляция", "B) Дефляция", "C) Девальвация", "D) Стагнация"],
        "correct": "A",
        "explanation": "Прошлая ошибка: падение цен — это дефляция.",
    }
    item.update(overrides)
    return item


@pytest.fixture
def api(monkeypatch):
    import main
    from fastapi.testclient import TestClient

    async def fake_user(request):
        return {"id": "honest-user"}

    monkeypatch.setattr(main, "require_authenticated_user", fake_user)
    monkeypatch.setattr(main.limiter, "enabled", False)
    BaseAgent._run_cache.clear()
    calls = []

    def answer_with(raw):
        async def fake_run(self, system_prompt, user_text, **kwargs):
            calls.append({"system": system_prompt, "user": user_text, **kwargs})
            if isinstance(raw, BaseException):
                raise raw
            return raw

        monkeypatch.setattr(BaseAgent, "run", fake_run)

    client = TestClient(main.app)
    client.answer_with = answer_with
    client.calls = calls
    yield client
    BaseAgent._run_cache.clear()


# --- /api/professor/evaluate ------------------------------------------------------------------

@pytest.mark.parametrize("raw", ["", "не JSON", "{}", json.dumps({"score": 80}), json.dumps({"score": "много", "verdict": "x"}),
                                 json.dumps({"score": 140, "verdict": "x"}), json.dumps({"score": True, "verdict": "x"})])
def test_professor_evaluate_unusable_answer_is_502_without_a_grade(api, raw):
    BaseAgent._run_cache[("old",)] = raw
    api.answer_with(raw)
    response = api.post("/api/professor/evaluate", json=EVALUATE)
    assert response.status_code == 502
    body = response.json()
    assert body == {"detail": "Не удалось оценить ответ. Попробуйте ещё раз.", "code": "ai_failed"}
    assert "score" not in body and "grade" not in body
    assert ("old",) not in BaseAgent._run_cache


def test_professor_evaluate_provider_busy_is_429(api):
    api.answer_with(AIError.busy())
    response = api.post("/api/professor/evaluate", json=EVALUATE)
    assert response.status_code == 429
    assert response.json() == {"detail": "Сервис сейчас занят. Подождите минуту и попробуйте ещё раз.", "code": "ai_busy"}
    assert response.headers["retry-after"] == "60"


def test_professor_evaluate_timeout_is_504(api):
    api.answer_with(AIError.timeout())
    response = api.post("/api/professor/evaluate", json=EVALUATE)
    assert response.status_code == 504 and response.json()["code"] == "ai_timeout"


@pytest.mark.parametrize("score,grade", [(100, "5"), (85, "5"), (84, "4"), (70, "4"), (69, "3"), (50, "3"), (49, "2"), (0, "2"),
                                         ("77", "4"), (84.6, "5"), ("90%", "5")])
def test_professor_evaluate_grade_comes_from_the_score(api, score, grade):
    api.answer_with(evaluation(score=score, grade="5"))
    response = api.post("/api/professor/evaluate", json=EVALUATE)
    assert response.status_code == 200
    body = response.json()
    assert body["grade"] == grade and isinstance(body["score"], int)
    assert body["verdict"] == "Хороший ответ."
    assert body["correct_points"] == ["Рост цен"] and body["missing_points"] == ["Причины"] and body["errors"] == []
    assert api.calls[-1]["json_mode"] is True


def test_professor_evaluate_keeps_a_verdict_with_a_code_block(api):
    verdict = "Цикл описан верно, но пример неполный:\n```python\nfor i in range(3):\n    print(i)\n```\nНе хватает условия выхода."
    api.answer_with(evaluation(score=72, verdict=verdict, missing_points=["```break``` внутри цикла"]))
    response = api.post("/api/professor/evaluate", json=EVALUATE)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["verdict"] == verdict and body["grade"] == "4"
    assert body["missing_points"] == ["```break``` внутри цикла"]


def test_professor_prompt_states_the_bands_the_grade_is_computed_with(api, monkeypatch):
    import main

    prompt = base.build_professor_evaluation_prompt("Лекция.", "Что такое цикл?", "Повторение.", "max")
    upper = 100
    for lowest, grade in base.PROFESSOR_GRADE_BANDS:
        assert f"{lowest}–{upper} — {base.PROFESSOR_GRADE_WORDS[grade]}" in prompt
        assert main.grade_from_score(lowest) == grade and main.grade_from_score(upper) == grade
        upper = lowest - 1
    # The model gives only the score; the verdict must not name a grade.
    assert '"grade"' not in prompt
    assert "Оценку выставит система по баллу" in prompt
    assert "не называй оценку ни цифрой, ни словом" in prompt
    assert "с объяснением оценки" not in prompt

    # One constant: moving a band moves the prompt and the computed grade together.
    monkeypatch.setattr(base, "PROFESSOR_GRADE_BANDS", ((90, "5"), (75, "4"), (60, "3"), (0, "2")))
    prompt = base.build_professor_evaluation_prompt("Лекция.", "Что такое цикл?", "Повторение.")
    assert "90–100 — отлично" in prompt and "60–74 — удовлетворительно" in prompt and "0–59 — неудовлетворительно" in prompt
    assert main.grade_from_score(89) == "4" and main.grade_from_score(59) == "2"

    # The route sends that prompt.
    api.answer_with(evaluation(score=89))
    assert api.post("/api/professor/evaluate", json=EVALUATE).json()["grade"] == "4"
    assert "90–100 — отлично" in api.calls[-1]["system"]


def test_professor_question_is_plain_text_and_honest(api):
    api.answer_with("  Почему ставка влияет на инфляцию?  ")
    response = api.post("/api/professor/question", json={"context": "API отдаёт JSON."})
    assert response.json() == {"question": "Почему ставка влияет на инфляцию?"}
    assert api.calls[-1]["json_mode"] is False
    api.answer_with(AIError.busy())
    response = api.post("/api/professor/question", json={"context": "Лекция."})
    assert response.status_code == 429 and response.json()["code"] == "ai_busy"


# --- /api/mistakes/practice ---------------------------------------------------------------------

def test_mistakes_practice_valid_answer_is_normalised(api):
    api.answer_with(json.dumps({"practice": [
        practice_item(),
        practice_item(id="2", mistake_id="m-2", options=["Налоги", "Ставку", "Курс", "Пошлины"], correct="Ставку"),
    ]}, ensure_ascii=False))
    response = api.post("/api/mistakes/practice", json={"mistakes": MISTAKES})
    assert response.status_code == 200
    practice = response.json()["practice"]
    assert practice[0]["options"][0] == "A) Инфляция" and practice[0]["correct"] == "A"
    assert practice[1]["options"] == ["A) Налоги", "B) Ставку", "C) Курс", "D) Пошлины"] and practice[1]["correct"] == "B"
    for item in practice:
        assert item["mistake_id"] in {"m-1", "m-2"}
        assert any(option.startswith(item["correct"]) for option in item["options"])
    assert "из тестов и устных ответов" in api.calls[-1]["system"]
    assert api.calls[-1]["json_mode"] is True


def test_mistakes_practice_with_code_in_questions_is_accepted(api):
    item = practice_item(
        question="Что выведет код?\n```python\nprint(2 ** 3)\n```",
        options=["A) 8", "B) 6", "C) 9", "D) 5"],
        explanation="Прошлая ошибка: ** — это степень:\n```python\n2 ** 3 == 8\n```",
    )
    api.answer_with(json.dumps({"practice": [item]}, ensure_ascii=False))
    response = api.post("/api/mistakes/practice", json={"mistakes": MISTAKES})
    assert response.status_code == 200, response.text
    practice = response.json()["practice"][0]
    assert practice["question"] == item["question"] and practice["explanation"] == item["explanation"]


@pytest.mark.parametrize("raw", [
    "",
    "не JSON",
    json.dumps({"practice": []}),
    json.dumps({"practice": [practice_item(mistake_id="m-999")]}),
    json.dumps({"practice": [practice_item(mistake_id="")]}),
    json.dumps({"practice": [practice_item(), practice_item(options=["A) 1", "B) 2", "C) 3"])]}),
    json.dumps({"practice": [practice_item(correct="E")]}),
    json.dumps({"practice": [practice_item(explanation="")]}),
    json.dumps({"practice": [practice_item(question=" ")]}),
    json.dumps({"practice": [{k: v for k, v in practice_item().items() if k != "id"}]}),
])
def test_mistakes_practice_invalid_answer_is_502_and_evicted(api, raw):
    BaseAgent._run_cache[("old",)] = raw
    api.answer_with(raw)
    response = api.post("/api/mistakes/practice", json={"mistakes": MISTAKES})
    assert response.status_code == 502
    assert response.json() == {"detail": "Не удалось подготовить вопросы по ошибкам. Попробуйте ещё раз.", "code": "ai_failed"}
    assert ("old",) not in BaseAgent._run_cache


def test_mistakes_practice_busy_and_empty_request(api):
    api.answer_with(AIError.busy())
    assert api.post("/api/mistakes/practice", json={"mistakes": MISTAKES}).status_code == 429
    assert api.post("/api/mistakes/practice", json={"mistakes": []}).status_code == 400


# --- /api/chat ---------------------------------------------------------------------------------

@pytest.mark.parametrize("raw", ["", "   \n"])
def test_chat_empty_reply_is_502_and_evicted(api, raw):
    BaseAgent._run_cache[("old",)] = raw
    api.answer_with(raw)
    response = api.post("/api/chat", json={"message": "Что такое JSON?", "context": "Лекция про JSON.", "history": []})
    assert response.status_code == 502
    assert response.json() == {"detail": "Не удалось получить ответ. Попробуйте ещё раз.", "code": "ai_failed"}
    assert ("old",) not in BaseAgent._run_cache


def test_chat_reply_is_requested_as_plain_text(api):
    api.answer_with("JSON — формат данных.")
    response = api.post("/api/chat", json={"message": "Что такое JSON?", "context": "Лекция про JSON.", "history": []})
    assert response.json() == {"reply": "JSON — формат данных."}
    assert api.calls[-1]["json_mode"] is False


# --- provider text never reaches the browser -----------------------------------------------------

def test_provider_error_text_never_leaks(monkeypatch):
    """Real BaseAgent with a Groq client that fails with a secret-looking message."""
    import main
    from fastapi.testclient import TestClient

    async def fake_user(request):
        return {"id": "leak-user"}

    class FailingGroq:
        def __init__(self, api_key=None, **kwargs):
            async def create(**kwargs):
                raise Exception("secret org_123 https://api.groq.com")

            self.chat = SimpleNamespace(completions=SimpleNamespace(create=create))

    monkeypatch.setattr(main, "require_authenticated_user", fake_user)
    monkeypatch.setattr(main.limiter, "enabled", False)
    monkeypatch.setattr(main, "GROQ_API_KEY", "groq-key")
    monkeypatch.setenv("GROQ_API_KEY", "groq-key")
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setenv("AI_AGENT_STAGGER_SECONDS", "0")
    monkeypatch.setattr(base, "AsyncGroq", FailingGroq)
    base._GROQ_CLIENTS.clear()
    BaseAgent._run_cache.clear()
    client = TestClient(main.app)
    try:
        responses = [
            client.post("/api/chat", json={"message": "Вопрос", "context": "Текст", "history": []}),
            client.post("/api/mistakes/practice", json={"mistakes": MISTAKES}),
            client.post("/api/professor/evaluate", json=EVALUATE),
            client.post("/api/professor/question", json={"context": "Текст"}),
            client.post("/api/analyze/section", json={"section": "quiz", "text": "Инфляция — рост цен."}),
            client.post("/api/quick-prep", json={"context": "Инфляция — рост цен."}),
        ]
    finally:
        base._GROQ_CLIENTS.clear()
    for response in responses:
        assert response.status_code == 502, response.text
        for leak in ("org_123", "https://", "Groq", "groq", "secret"):
            assert leak not in response.text
