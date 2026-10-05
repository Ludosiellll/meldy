"""Legacy AI endpoints answer 429/502 instead of stand-ins, and never leak provider text."""
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agents import base  # noqa: E402
from agents.base import AIError, BaseAgent  # noqa: E402

MISTAKES = [
    {"id": "m-1", "question": "Что такое инфляция?", "student_answer": "Падение цен", "correct_answer": "Рост цен", "topic": "Экономика"},
    {"id": "m-2", "question": "Что повышает ЦБ?", "student_answer": "Налоги", "correct_answer": "Ставку", "topic": "Экономика"},
]


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
            client.post("/api/mistakes/practice", json={"mistakes": MISTAKES}),
            client.post("/api/analyze/section", json={"section": "quiz", "text": "Инфляция — рост цен."}),
            client.post("/api/quick-prep", json={"context": "Инфляция — рост цен."}),
        ]
    finally:
        base._GROQ_CLIENTS.clear()
    for response in responses:
        assert response.status_code == 502, response.text
        for leak in ("org_123", "https://", "Groq", "groq", "secret"):
            assert leak not in response.text
