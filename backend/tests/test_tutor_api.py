"""Голосовой репетитор «Поговорить о лекции» (tutor_api.py): цели по карточкам, лестница подсказок,
вопрос студента только с цитатой лекции, владение лекцией, лимит за ход.

Supabase — PostgREST в памяти из test_oral_api, модель — подменённый chat_stream.complete.
"""
import json
import sys
from pathlib import Path

import httpx
import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import chat_stream  # noqa: E402
import quota  # noqa: E402
import supabase_rest  # noqa: E402
import tutor_api  # noqa: E402
from agents.base import AIError  # noqa: E402
from test_oral_api import ANON, TOKENS, URL, FakeSupabase  # noqa: E402

LECTURE = "\n\n".join([
    "Инфляция",
    "Инфляция — это устойчивый рост общего уровня цен в экономике. Её измеряют индексом потребительских цен, "
    "который считает статистическая служба каждый месяц по корзине товаров и услуг.",
    "Центральный банк повышает ключевую ставку, чтобы сдержать инфляцию: кредиты дорожают, спрос снижается, "
    "и рост цен замедляется через несколько месяцев.",
    "Безработица бывает фрикционной, структурной и циклической. Естественный уровень безработицы включает "
    "фрикционную и структурную безработицу.",
])
CARDS = [
    {"id": 1, "question": "Какие виды безработицы бывают?", "answer": "Фрикционная, структурная и циклическая.", "source_ids": ["S04"]},
    {"id": 2, "question": "Зачем ЦБ повышает ключевую ставку?", "answer": "Чтобы сдержать инфляцию: кредиты дорожают и спрос снижается.", "source_ids": ["S03"]},
    {"id": 3, "question": "Что такое инфляция?", "answer": "Устойчивый рост общего уровня цен.", "source_ids": []},
]


class Model:
    def __init__(self):
        self.answers = []
        self.calls = []

    async def complete(self, system_prompt, turns, **kwargs):
        self.calls.append({"system": system_prompt, "text": turns[-1]["content"], **kwargs})
        if not self.answers:
            raise AssertionError("unexpected model call")
        item = self.answers.pop(0)
        if isinstance(item, BaseException):
            raise item
        return item if isinstance(item, str) else json.dumps(item, ensure_ascii=False)


class Charges:
    def __init__(self):
        self.taken = []
        self.refunded = []

    async def charge(self, request, kind, units):
        self.taken.append((kind, units))
        charges = self

        class Spent:
            async def refund(self):
                charges.refunded.append((kind, units))

            def refund_soon(self):
                charges.refunded.append((kind, units))

        return Spent()


@pytest.fixture
def api(monkeypatch):
    import main
    from fastapi.testclient import TestClient

    async def fake_user(request):
        token = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
        if token not in TOKENS:
            raise HTTPException(status_code=401, detail="Требуется войти в аккаунт")
        return {"id": TOKENS[token]}

    monkeypatch.setattr(main, "require_authenticated_user", fake_user)
    monkeypatch.setattr(main.limiter, "enabled", False)
    monkeypatch.setenv("SUPABASE_URL", URL)
    monkeypatch.setenv("SUPABASE_KEY", ANON)
    monkeypatch.delenv("TUTOR_DISABLED", raising=False)
    fake = FakeSupabase()
    monkeypatch.setattr(supabase_rest, "_transport", httpx.MockTransport(fake.handler))
    model = Model()
    monkeypatch.setattr(chat_stream, "complete", model.complete)
    charges = Charges()
    monkeypatch.setattr(quota, "charge", charges.charge)
    tutor_api._contexts.clear()
    tutor_api._targets.clear()
    client = TestClient(main.app, headers={"Authorization": "Bearer token-a"})
    client.fake, client.model, client.charges = fake, model, charges
    yield client


def lecture(api, *, user="user-a", text=LECTURE, cards=CARDS):
    material_id = api.fake.material("Макроэкономика", text, user=user)
    api.fake.row("materials", material_id)["flashcards_json"] = cards
    return material_id


def turn(api, material_id, **body):
    return api.post("/api/tutor/turn", json={"material_id": material_id, "history": [], **body})


def test_a_conversation_starts_with_the_lectures_cards_in_lecture_order(api):
    material_id = lecture(api)
    res = api.post("/api/tutor/session", json={"material_id": material_id})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["title"] == "Макроэкономика"
    # Card 3 has no saved fragments: it is searched in the lecture (S02) and comes first.
    assert [t["id"] for t in body["targets"]] == ["c3", "c2", "c1"]
    assert body["targets"][1]["fragments"][0]["source_id"] == "S03"
    assert "ключевую ставку" in body["targets"][1]["fragments"][0]["text"]
    assert api.model.calls == [] and api.charges.taken == []


def test_someone_elses_lecture_no_text_and_no_cards(api):
    foreign = lecture(api, user="user-b")
    assert api.post("/api/tutor/session", json={"material_id": foreign}).status_code == 404
    empty = lecture(api, text="   ")
    res = api.post("/api/tutor/session", json={"material_id": empty})
    assert res.status_code == 422 and "нет текста" in res.json()["detail"]
    bare = lecture(api, cards=[])
    res = api.post("/api/tutor/session", json={"material_id": bare})
    assert res.status_code == 409 and "разберите лекцию" in res.json()["detail"]
    assert api.post("/api/tutor/session", json={"material_id": "not-a-uuid"}).status_code == 400


def test_the_ladder_hint_then_the_lectures_words_then_an_explanation(api):
    material_id = lecture(api)
    api.post("/api/tutor/session", json={"material_id": material_id})
    api.model.answers = [
        {"status": "missing", "intent": "dont_know", "say": "Подумайте: что происходит с кредитами?"},
        {"status": "partial", "intent": "answer", "say": "Почти."},
        {"status": "wrong", "intent": "answer", "say": "Ставка делает кредиты дороже, спрос падает, и цены растут медленнее."},
    ]
    first = turn(api, material_id, kind="answer", target_id="c2", rung=0, utterance="не знаю").json()
    assert (first["move"], first["rung"], first["done"]) == ("nudge", 1, False)
    assert first["say"] == "Подумайте: что происходит с кредитами?"
    second = turn(api, material_id, kind="answer", target_id="c2", rung=1, utterance="что-то с деньгами").json()
    assert (second["move"], second["rung"], second["done"]) == ("quote", 2, False)
    assert second["say"] == "Вот как сказано в лекции. Скажите своими словами."
    assert second["quote"]["source_id"] == "S03" and "ключевую ставку" in second["quote"]["text"]
    assert second["quote"]["text"] in LECTURE.replace("\n\n", " ")
    third = turn(api, material_id, kind="answer", target_id="c2", rung=2, utterance="чтобы курс был выше").json()
    assert (third["move"], third["done"], third["assisted"]) == ("explain", True, True)
    assert third["say"].startswith("Ставка делает кредиты дороже")
    assert api.charges.taken == [("tutorTurn", 1)] * 3 and api.charges.refunded == []
    # The model sees the card, its fragment and the move it must make.
    assert "Ключ ответа: Чтобы сдержать инфляцию" in api.model.calls[0]["text"]
    assert "[S03]" in api.model.calls[0]["text"] and "ХОД, если ответ не covered: намёк" in api.model.calls[0]["text"]
    assert "ХОД, если ответ не covered: объяснение" in api.model.calls[2]["text"]


def test_a_covered_answer_closes_the_card_without_praise_or_scores(api):
    material_id = lecture(api)
    api.post("/api/tutor/session", json={"material_id": material_id})
    api.model.answers = [{"status": "covered", "intent": "answer", "say": "Отлично! Верно: все три вида. Ставлю пятёрку."}]
    body = turn(api, material_id, kind="answer", target_id="c1", rung=0, utterance="фрикционная структурная циклическая").json()
    assert (body["move"], body["done"], body["assisted"]) == ("confirm", True, False)
    assert body["say"] == "Верно: все три вида."


def test_off_topic_is_turned_back_to_the_card(api):
    material_id = lecture(api)
    api.post("/api/tutor/session", json={"material_id": material_id})
    api.model.answers = [{"status": "missing", "intent": "off_topic", "say": "Погода хорошая."}]
    body = turn(api, material_id, kind="answer", target_id="c1", rung=1, utterance="какая сегодня погода").json()
    assert (body["move"], body["rung"], body["done"]) == ("redirect", 1, False)
    assert body["say"] == "Это не по лекции. Вернёмся к вопросу."


def test_a_model_failure_gives_the_unit_back_and_says_so(api):
    material_id = lecture(api)
    api.post("/api/tutor/session", json={"material_id": material_id})
    api.model.answers = [AIError.busy()]
    res = turn(api, material_id, kind="answer", target_id="c1", rung=0, utterance="не помню")
    assert res.status_code == 429
    assert api.charges.taken == [("tutorTurn", 1)] and api.charges.refunded == [("tutorTurn", 1)]


def test_a_question_is_answered_only_with_a_quote_from_the_lecture(api):
    material_id = lecture(api)
    api.post("/api/tutor/session", json={"material_id": material_id})
    api.model.answers = [{"in_lecture": True, "say": "Чтобы сдержать инфляцию.", "quote": "кредиты дорожают, спрос снижается", "source_id": "S03"}]
    body = turn(api, material_id, kind="question", utterance="зачем центральный банк повышает ключевую ставку").json()
    assert body["move"] == "answer" and body["quote"] == {"source_id": "S03", "text": "кредиты дорожают, спрос снижается"}
    # A made-up quote: «в лекции об этом не сказано», with the nearest fragment to read.
    api.model.answers = [{"in_lecture": True, "say": "Чтобы укрепить рубль.", "quote": "ставку повышают ради курса рубля", "source_id": "S03"}]
    body = turn(api, material_id, kind="question", utterance="зачем центральный банк повышает ключевую ставку").json()
    assert body["move"] == "not_in_lecture" and body["say"] == "В лекции об этом не сказано."
    assert body["nearest"]["source_id"] == "S03"


def test_a_question_the_lecture_does_not_cover_costs_nothing(api):
    material_id = lecture(api)
    api.post("/api/tutor/session", json={"material_id": material_id})
    body = turn(api, material_id, kind="question", utterance="расскажите про квантовую механику и бозон хиггса").json()
    assert body["move"] == "not_in_lecture"
    assert api.model.calls == [] and api.charges.taken == []


def test_bad_turns(api):
    material_id = lecture(api)
    api.post("/api/tutor/session", json={"material_id": material_id})
    assert turn(api, material_id, kind="answer", target_id="c9", rung=0, utterance="да").status_code == 409
    assert turn(api, material_id, kind="answer", target_id="x", rung=0, utterance="да").status_code == 400
    assert turn(api, material_id, kind="answer", target_id="c1", rung=3, utterance="да").status_code == 400
    assert turn(api, material_id, kind="answer", target_id="c1", rung=0, utterance="   ").status_code == 400
    assert turn(api, material_id, kind="answer", target_id="c1", rung=0, utterance="а" * 1501).status_code == 413
    assert turn(api, material_id, kind="chat", utterance="привет").status_code == 400
    other = lecture(api, user="user-b")
    assert turn(api, other, kind="question", utterance="что такое инфляция").status_code == 404
    assert api.model.calls == []
