"""«Почему так?» и название предмета (explain_api.py): формат, ключ как истина, unsure, возврат единицы."""
import json
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import explain_api  # noqa: E402
import quota  # noqa: E402
from agents.base import AIError, BaseAgent  # noqa: E402

QUESTION = "Какой оператор подписывает обработчик на событие?"
OPTIONS = ["=", "+=", "=>", "::"]


class FakeCharge:
    def __init__(self):
        self.kept = False
        self.refunded = False

    def keep(self):
        self.kept = True

    async def refund(self):
        self.refunded = True

    def refund_soon(self):
        self.refunded = True


@pytest.fixture
def api(monkeypatch):
    import main
    from fastapi.testclient import TestClient

    async def fake_user(request):
        if request.headers.get("authorization") != "Bearer token-a":
            raise HTTPException(status_code=401, detail="Требуется войти в аккаунт")
        return {"id": "user-a"}

    monkeypatch.setattr(main, "require_authenticated_user", fake_user)
    monkeypatch.setattr(main.limiter, "enabled", False)
    charges: list = []

    async def fake_reserve(token, kind, units):
        charge = FakeCharge()
        charges.append((kind, units, charge))
        return charge

    monkeypatch.setattr(quota, "reserve", fake_reserve)
    calls: list = []
    answers: list = []

    async def fake_run(agent, system_prompt, user_text, **kwargs):
        calls.append({"system": system_prompt, "text": user_text, **kwargs})
        item = answers[0] if len(answers) == 1 else answers.pop(0)
        if isinstance(item, BaseException):
            raise item
        return item if isinstance(item, str) else json.dumps(item, ensure_ascii=False)

    monkeypatch.setattr(BaseAgent, "run", fake_run)
    monkeypatch.setattr(BaseAgent, "forget", classmethod(lambda cls, raw: None))
    client = TestClient(main.app, headers={"Authorization": "Bearer token-a"})
    client.calls, client.answers, client.charges = calls, answers, charges
    return client


def explain(api, **over):
    body = {"question": QUESTION, "options": OPTIONS, "correct": [1], "chosen": [0], **over}
    return api.post("/api/study/explain", json=body)


def test_the_key_is_given_to_the_model_as_the_truth_and_the_explanation_costs_one_unit(api):
    api.answers.append({"explanation": "Обработчик добавляют к событию оператором «плюс равно»: событие хранит список обработчиков. Простое присваивание заменило бы весь список.", "unsure": False})
    response = explain(api)
    assert response.status_code == 200
    body = response.json()
    assert body["unsure"] is False and body["explanation"].startswith("Обработчик добавляют")
    call = api.calls[0]
    assert "ключом и не обсуждается" in call["system"]
    assert "ВЕРНЫЙ ОТВЕТ (ключ): Б) +=" in call["text"] and "СТУДЕНТ ВЫБРАЛ: А) =" in call["text"]
    assert call["fast"] is True and call["json_mode"] is True
    kind, units, charge = api.charges[0]
    assert (kind, units) == ("answerPoints", 1) and charge.kept and not charge.refunded


def test_a_model_that_cannot_explain_the_key_says_so_and_the_unit_comes_back(api):
    api.answers.append({"explanation": "", "unsure": True})
    response = explain(api)
    assert response.status_code == 200 and response.json() == {"explanation": "", "unsure": True}
    assert api.charges[0][2].refunded and not api.charges[0][2].kept


def test_an_unusable_answer_or_a_failed_model_is_an_error_with_the_unit_back(api):
    api.answers.append({"explanation": "да", "unsure": False})
    assert explain(api).status_code == 502
    assert api.charges[0][2].refunded
    api.answers[:] = [AIError.timeout()]
    assert explain(api).status_code == 504
    assert api.charges[1][2].refunded


def test_the_chosen_option_that_is_the_key_is_not_called_wrong_and_no_choice_is_fine(api):
    api.answers.append({"explanation": "Оба верных варианта описывают один и тот же оператор подписки на событие.", "unsure": False})
    assert explain(api, correct=[1, 2], chosen=[1, 3]).status_code == 200
    assert "СТУДЕНТ ВЫБРАЛ: Г) ::" in api.calls[0]["text"]
    assert explain(api, chosen=None).status_code == 200
    assert "СТУДЕНТ ВЫБРАЛ" not in api.calls[1]["text"]


@pytest.mark.parametrize(
    "over",
    [
        {"question": ""},
        {"options": ["один"]},
        {"options": ["а", ""]},
        {"correct": []},
        {"correct": [9]},
        {"correct": [1, 1]},
        {"correct": [True]},
        {"chosen": "0"},
        {"options": ["x"] * 9},
    ],
)
def test_a_malformed_request_is_400_and_asks_no_model(api, over):
    assert explain(api, **over).status_code == 400
    assert api.calls == [] and api.charges == []


def test_without_a_login_it_is_401(api):
    assert api.post("/api/study/explain", json={}, headers={"Authorization": "Bearer nobody"}).status_code == 401
    assert api.post("/api/exams/suggest-topics", json={"questions": ["Вопрос?"] * 12}, headers={"Authorization": "Bearer nobody"}).status_code == 401
    assert api.calls == []


def title(api, **over):
    body = {"file_name": "01 Таблица, ответ жирным — 12 вопросов.docx", "questions": ["Что такое класс в C#?", "Чем интерфейс отличается от абстрактного класса?", "Что делает оператор using?"], **over}
    return api.post("/api/exams/suggest-title", json=body)


def test_a_title_is_cleaned_and_costs_one_unit(api):
    api.answers.append({"title": "«программирование на C#».  "})
    response = title(api)
    assert response.status_code == 200 and response.json() == {"title": "Программирование на C#"}
    assert "ИМЯ ФАЙЛА: 01 Таблица, ответ жирным — 12 вопросов.docx" in api.calls[0]["text"]
    assert "1. Что такое класс в C#?" in api.calls[0]["text"]
    assert api.charges[0][2].kept


def test_no_title_when_the_model_does_not_know_and_the_unit_comes_back(api):
    api.answers.append({"title": ""})
    assert title(api).json() == {"title": ""}
    assert api.charges[0][2].refunded
    api.answers[:] = [{"title": "x" * 80}]
    assert title(api).json() == {"title": ""}


def test_a_title_needs_at_least_two_questions(api):
    assert title(api, questions=["Один вопрос?"]).status_code == 400
    assert title(api, questions="нет").status_code == 400
    assert api.calls == []


# ── POST /api/exams/suggest-topics ───────────────────────────────────────────────

TOPIC_QUESTIONS = [f"Вопрос {n} о Древней Руси?" for n in range(1, 9)] + [f"Вопрос {n} о Смутном времени?" for n in range(9, 21)]


def topics(api, **over):
    return api.post("/api/exams/suggest-topics", json={"questions": TOPIC_QUESTIONS, **over})


def test_topics_follow_one_another_from_the_first_question_and_cost_one_unit(api):
    api.answers.append({"topics": [{"title": "«древняя Русь».", "from": 1}, {"title": "Смутное время", "from": 9}]})
    response = topics(api)
    assert response.status_code == 200
    assert response.json() == {"topics": [{"title": "Древняя Русь", "from": 1}, {"title": "Смутное время", "from": 9}]}
    assert "1. Вопрос 1 о Древней Руси?" in api.calls[0]["text"] and "20. Вопрос 20 о Смутном времени?" in api.calls[0]["text"]
    assert api.charges[0][2].kept


def test_a_short_part_joins_its_neighbour_and_the_first_topic_starts_at_the_first_question(api):
    # the model starts at 2 and cuts a part of two questions: the first topic is from 1, the short part joins the one before
    api.answers.append({"topics": [{"title": "Смутное время", "from": 11}, {"title": "Древняя Русь", "from": 2}, {"title": "Крещение", "from": 9}]})
    assert topics(api).json() == {"topics": [{"title": "Древняя Русь", "from": 1}, {"title": "Смутное время", "from": 11}]}


def test_no_topics_when_the_questions_are_mixed_or_the_answer_is_unusable_and_the_unit_comes_back(api):
    for answer in (
        {"topics": []},
        {"topics": [{"title": "Одна тема", "from": 1}]},  # one topic is no split
        {"topics": [{"title": "А", "from": 1}, {"title": "Б", "from": 9}]},  # names too short
        {"topics": [{"title": "Русь", "from": 1}, {"title": "русь", "from": 9}]},  # the same name twice
        {"topics": [{"title": "Русь", "from": 1}, {"title": "Смута", "from": 99}]},  # past the list
        {"topics": [{"title": "Русь", "from": 1}, {"title": "Смута", "from": 1}]},  # two parts from one question
        {"topics": [{"title": f"Тема номер {n}", "from": n} for n in range(1, 21)]},  # a part per question
        {"topics": "нет"},
    ):
        api.answers[:] = [answer]
        api.charges.clear()
        assert topics(api).json() == {"topics": []}, answer
        assert api.charges[0][2].refunded


def test_topics_need_a_list_long_enough_and_whole(api):
    assert topics(api, questions=TOPIC_QUESTIONS[:11]).status_code == 400
    assert topics(api, questions=TOPIC_QUESTIONS[:12] + [""]).status_code == 400
    assert topics(api, questions=["Вопрос?"] * 301).status_code == 400
    assert topics(api, questions="нет").status_code == 400
    assert api.calls == []
    # a long list fits the body's size
    api.answers.append({"topics": [{"title": "Первая половина", "from": 1}, {"title": "Вторая половина", "from": 151}]})
    long = topics(api, questions=["Очень длинный вопрос о предмете " + "я" * 200] * 300)
    assert long.status_code == 200 and len(long.json()["topics"]) == 2

