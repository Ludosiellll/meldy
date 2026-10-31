"""Выпуск 49: тест из лекции. Фраза-источник — настоящее предложение лекции, ключ сверен с ней (lecture_items.py);
генератор теста сохраняет source_ids модели (agents/coordinator._clean_quiz, utils.annotate_quiz); маршруты
/api/tests/from-lecture (без модели) и /api/tests/generate (списывает лимит ИИ, как «Тест заново» лекции).
"""
import asyncio
import json
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import lecture_items  # noqa: E402
import port_api  # noqa: E402
from agents.base import BaseAgent  # noqa: E402
from agents.coordinator import CoordinatorAgent, _clean_quiz  # noqa: E402
from plans import AI_COSTS  # noqa: E402
from utils import annotate_quiz, build_source_chunks  # noqa: E402

LECTURE = (
    "Инфляция — это устойчивый рост общего уровня цен в экономике. Её измеряют индексом потребительских цен.\n\n"
    "Центральный банк борется с инфляцией с помощью ключевой ставки. Когда банк повышает ключевую ставку, кредиты "
    "дорожают и спрос снижается.\n\n"
    "Цвета сигнальных знаков: красный — запрет, жёлтый — предупреждение, зелёный — безопасность. Знаки запрета "
    "всегда красного цвета.\n\n"
    "Дефляция — снижение общего уровня цен. Она опасна тем, что люди откладывают покупки."
)
CHUNKS = build_source_chunks(LECTURE)
MATERIAL = "0f000000-0000-4000-8000-0000000000aa"


def quiz_item(question, options, correct, explanation="", source_ids=None):
    item = {"question": question, "options": [f"{'ABCD'[i]}) {o}" for i, o in enumerate(options)], "correct": correct,
            "explanation": explanation}
    if source_ids is not None:
        item["source_ids"] = source_ids
    return item


def in_lecture(quote: str) -> bool:
    body = quote[:-1] if quote.endswith("…") else quote
    return any(body in chunk["text"] for chunk in CHUNKS)


def test_the_phrase_is_a_real_sentence_and_the_key_is_checked_against_it():
    items, dropped = lecture_items.items_from_quiz([
        quiz_item("Чем Центральный банк борется с инфляцией?", ["Ключевой ставкой", "Налогами", "Тарифами"], "A",
                  "Ставка делает кредиты дороже.", ["S02"]),
    ], CHUNKS, lecture_items.source_label("lecture", "Инфляция"))
    assert dropped == 0 and len(items) == 1
    item = items[0]
    assert item["quote"] == "Центральный банк борется с инфляцией с помощью ключевой ставки." and in_lecture(item["quote"])
    assert item["checked"] is True and item["source_id"] == "S02"
    assert item["options"] == ["Ключевой ставкой", "Налогами", "Тарифами"] and item["correct"] == [0]
    assert item["explanation"] == ("Ставка делает кредиты дороже.\n\nИз лекции «Инфляция»: "
                                   "«Центральный банк борется с инфляцией с помощью ключевой ставки.»")


def test_a_wrong_key_is_not_checked_and_an_answer_not_in_the_lecture_is_dropped():
    items, dropped = lecture_items.items_from_quiz([
        # модель отметила неверный вариант: фраза о знаках запрета называет «красный», а не «жёлтый»
        quiz_item("Какого цвета знаки запрета?", ["Жёлтого", "Красного", "Зелёного"], "A"),
        # ответа в лекции нет вовсе
        quiz_item("Кто ввёл индекс цен?", ["Ласпейрес", "Пааше", "Фишер"], "A"),
    ], CHUNKS)
    assert dropped == 1 and len(items) == 1
    assert items[0]["checked"] is False and in_lecture(items[0]["quote"])


def test_a_right_key_finds_the_sentence_that_names_it_alone():
    items, _ = lecture_items.items_from_quiz([quiz_item("Какого цвета знаки запрета?", ["Жёлтого", "Красного", "Зелёного"], "B")], CHUNKS)
    assert items[0]["checked"] is True and items[0]["quote"] == "Знаки запрета всегда красного цвета."


def test_unreadable_questions_are_dropped():
    items, dropped = lecture_items.items_from_quiz(
        [None, quiz_item("", ["а", "б"], "A"), quiz_item("Что?", ["Да"], "A"), quiz_item("Что?", ["Да", "да"], "A"),
         quiz_item("Инфляция — это?", ["Рост цен", "Снижение цен"], "Z")], CHUNKS)
    assert items == [] and dropped == 5


def test_a_long_explanation_is_cut_and_the_quote_never_is():
    text = lecture_items.with_quote("Слово " * 600, "Цитата лекции.", "Из текста")
    assert len(text) <= 2000 and text.endswith("Из текста: «Цитата лекции.»")
    assert lecture_items.source_label("file", "Глава 2") == "Из файла «Глава 2»"


def test_the_quiz_section_keeps_the_models_source_ids():
    parsed = {"quiz": [{"question": "Что?", "options": ["A) Да", "B) Нет"], "correct": "A", "source_ids": ["[s02]", "S99", 5]}]}
    assert _clean_quiz(parsed)["quiz"][0]["source_ids"] == ["S02", "S99"]
    assert "source_ids" not in _clean_quiz({"quiz": [{"question": "Что?", "options": ["A) Да", "B) Нет"], "correct": "A"}]})["quiz"][0]


def test_annotate_quiz_puts_the_models_real_fragment_first():
    items = [{"question": "Чем банк борется с инфляцией?", "options": ["A) Ключевой ставкой", "B) Налогами"], "correct": "A",
              "explanation": "", "source_ids": ["S99", "S02"]},
             {"question": "Что такое дефляция?", "options": ["A) Снижение цен", "B) Рост цен"], "correct": "A",
              "explanation": "", "source_ids": ["S03"]}]  # S03 о знаках: слов вопроса в нём нет — не берётся
    assert annotate_quiz(items, CHUNKS) == 2
    assert items[0]["source_ids"][0] == "S02" and "S99" not in items[0]["source_ids"]
    assert items[1]["source_ids"][0] == "S04" and "S03" not in items[1]["source_ids"]


def test_the_lecture_prompt_asks_for_source_ids():
    from agents.base import build_quiz_prompt

    assert '"source_ids": ["S01"]' in build_quiz_prompt(5)


# ── маршруты ────────────────────────────────────────────────────────────────────

QUIZ = {"quiz": [
    quiz_item("Чем Центральный банк борется с инфляцией?", ["Ключевой ставкой", "Налогами", "Тарифами"], "A", "Ставка.", ["S02"]),
    quiz_item("Кто ввёл индекс цен?", ["Ласпейрес", "Пааше", "Фишер"], "A"),
]}


class FakeDb:
    def __init__(self, row):
        self.row = row
        self.asked = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return None

    async def select_one(self, table, params):
        self.asked.append((table, params))
        return self.row


class FakeCharge:
    def __init__(self, kind, units):
        self.kind, self.units, self.kept, self.refunded = kind, units, False, False

    def keep(self):
        self.kept = True

    async def refund(self):
        self.refunded = True

    def refund_soon(self):
        self.refunded = True

    def refund_unpaid_soon(self):
        self.refunded = True

    async def wait_refund(self):
        return None


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
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-key")
    monkeypatch.setenv("AI_AGENT_STAGGER_SECONDS", "0")
    state = {"row": {"title": "Инфляция", "quiz_json": QUIZ, "summary_json": {"grounding": {"sources": CHUNKS}},
                     "original_text": LECTURE}, "db": None, "charges": [], "prompts": [], "answer": json.dumps(QUIZ, ensure_ascii=False)}

    def make_db(token, timeout=None):
        assert token == "token-a"
        state["db"] = FakeDb(state["row"])
        return state["db"]

    async def fake_charge(request, kind, units):
        charge = FakeCharge(kind, units)
        state["charges"].append(charge)
        return charge

    async def run(self, system_prompt, user_text, **kwargs):
        from agents import base

        base.note_real_call()
        state["prompts"].append(system_prompt)
        return state["answer"]

    BaseAgent._run_cache.clear()
    monkeypatch.setattr(port_api, "SupabaseRest", make_db)
    monkeypatch.setattr(port_api.quota, "charge", fake_charge)
    monkeypatch.setattr(BaseAgent, "run", run)
    client = TestClient(main.app, headers={"Authorization": "Bearer token-a"})
    client.state_ = state
    yield client
    BaseAgent._run_cache.clear()


def test_from_lecture_gives_quoted_questions_without_the_model_or_units(api):
    response = api.post("/api/tests/from-lecture", json={"material_id": MATERIAL})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["title"] == "Инфляция" and body["dropped"] == 1 and len(body["items"]) == 1
    assert body["items"][0]["explanation"].endswith("Из лекции «Инфляция»: «Центральный банк борется с инфляцией с помощью ключевой ставки.»")
    assert api.state_["charges"] == [] and api.state_["prompts"] == []
    assert api.state_["db"].asked == [("materials", {"select": "title,quiz_json,summary_json,original_text", "id": f"eq.{MATERIAL}"})]


def test_from_lecture_refusals(api):
    assert api.post("/api/tests/from-lecture", json={"material_id": "нет"}).status_code == 400
    api.state_["row"] = None
    assert api.post("/api/tests/from-lecture", json={"material_id": MATERIAL}).json()["code"] == "not_found"
    api.state_["row"] = {"title": "Пусто", "quiz_json": None, "summary_json": None, "original_text": ""}
    response = api.post("/api/tests/from-lecture", json={"material_id": MATERIAL})
    assert response.status_code == 422 and response.json()["code"] == "no_quiz"
    assert api.post("/api/tests/from-lecture", json={"material_id": MATERIAL}, headers={"Authorization": ""}).status_code == 401


def test_generate_from_a_lecture_charges_like_a_lecture_section_and_quotes_the_lecture(api):
    response = api.post("/api/tests/generate", json={"material_id": MATERIAL, "count": 5})
    assert response.status_code == 200, response.text
    body = response.json()
    assert len(body["items"]) == 1 and body["dropped"] == 1 and body["items"][0]["checked"] is True
    assert body["items"][0]["explanation"].startswith("Ставка.\n\nИз лекции «Инфляция»: «")
    [charge] = api.state_["charges"]
    assert (charge.kind, charge.units, charge.kept, charge.refunded) == ("testGenerate", AI_COSTS["analysisSection"], True, False)
    assert "из 5 вопросов" in api.state_["prompts"][0] and "[S02]" in api.state_["prompts"][0]


def test_generate_from_text_and_from_a_file(api):
    response = api.post("/api/tests/generate", json={"text": LECTURE, "count": 10})
    assert response.status_code == 200 and response.json()["items"][0]["explanation"].startswith("Ставка.\n\nИз текста: «")
    files = {"file": ("Глава 2.txt", LECTURE.encode("utf-8"), "text/plain")}
    response = api.post("/api/tests/generate", files=files, data={"count": "15"})
    assert response.status_code == 200, response.text
    assert "Из файла «Глава 2»: «" in response.json()["items"][0]["explanation"]
    assert "из 15 вопросов" in api.state_["prompts"][-1]


def test_generate_refunds_when_no_question_checks_against_the_text(api):
    api.state_["answer"] = json.dumps({"quiz": [quiz_item("Кто ввёл индекс цен?", ["Ласпейрес", "Пааше"], "A")]}, ensure_ascii=False)
    response = api.post("/api/tests/generate", json={"text": LECTURE})
    assert response.status_code == 422 and response.json()["code"] == "no_items"
    assert api.state_["charges"][0].refunded is True and api.state_["charges"][0].kept is False


def test_generate_refusals_cost_nothing(api):
    assert api.post("/api/tests/generate", json={"text": "Мало текста."}).json()["code"] == "no_text"
    assert api.post("/api/tests/generate", json={"text": "я" * 300_001}).status_code == 413
    files = {"file": ("лекция.doc", b"x", "application/msword")}
    assert api.post("/api/tests/generate", files=files).json()["code"] == "unsupported"
    files = {"file": ("пусто.txt", "   ".encode(), "text/plain")}
    assert api.post("/api/tests/generate", files=files).json()["code"] == "no_text"
    assert api.state_["charges"] == [] and api.state_["prompts"] == []


def test_generate_without_a_session_is_401(api):
    assert api.post("/api/tests/generate", json={"text": LECTURE}, headers={"Authorization": ""}).status_code == 401


def test_generate_runs_the_lecture_quiz_section_with_its_fragments(api, monkeypatch):
    seen = {}
    real = CoordinatorAgent.run_section

    async def spy(self, name, text, settings=None, *, recording=False):
        seen.update(name=name, settings=settings, recording=recording)
        return await real(self, name, text, settings, recording=recording)

    monkeypatch.setattr(CoordinatorAgent, "run_section", spy)
    api.state_["row"]["summary_json"] = {"recognized": "recording"}
    assert api.post("/api/tests/generate", json={"material_id": MATERIAL, "count": 20}).status_code == 200
    assert seen == {"name": "quiz", "settings": {"quiz_count": 20, "quiz_difficulty": "mixed", "quiz_type": "multiple"}, "recording": True}
    assert asyncio.iscoroutinefunction(port_api.generate_test)
