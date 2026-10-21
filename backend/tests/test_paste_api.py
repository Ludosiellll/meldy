"""«Быстрая контрольная»: вопросы, вставленные текстом (paste_api.py, POST /api/tests/paste), и режим hand разбора
(bank_parse.parse_bank_text): нумерация «1.», «1)», «Вопрос 1.»; варианты «а) б) в)», «a) b) c)», «a.», «1) 2) 3)»,
в строку и по одному; «*» после верного варианта (и перед ним), «+»/«-», «Ответ: б», «(Ответ: б)», «Ответ: а, в»;
короткий ответ «Ответ: 2»; вопрос в несколько строк; пустые строки; посторонние строки вокруг; текст без вопросов.
Режим файла (без hand) не меняется: одна «*» в файле — ещё не ключ.
"""
import re
import sys
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import bank_parse  # noqa: E402
import paste_api  # noqa: E402
import quota  # noqa: E402
import supabase_rest  # noqa: E402
from agents.base import BaseAgent  # noqa: E402
from ratelimit import limiter, user_or_ip_key  # noqa: E402

PATH = "/api/tests/paste"
TOKENS = {"token-a": "user-a"}


def parsed(text: str) -> list[dict]:
    return bank_parse.parse_bank_text(text, hand=True)["items"]


def brief(item: dict) -> tuple:
    return (item["text"], item["options"], item["correct"], item["answer"])


# ── Разбор: как учитель пишет в Word и в чате ───────────────────────────────────


def test_a_word_test_with_a_star_an_answer_line_a_short_answer_and_an_unmarked_question():
    items = parsed(
        "1. Какой индикатор краснеет в кислой среде?\n"
        "а) фенолфталеин\nб) лакмус *\nв) метилоранж\n\n"
        "2. Формула серной кислоты?\n"
        "а) HCl   б) H2SO4   в) HNO3\n"
        "Ответ: б\n\n"
        "3. Сколько атомов водорода в молекуле воды?\n"
        "Ответ: 2\n\n"
        "4. Какая кислота есть в желудке?\n"
        "а) соляная   б) уксусная   в) лимонная\n"
    )
    assert [brief(item) for item in items] == [
        ("Какой индикатор краснеет в кислой среде?", ["фенолфталеин", "лакмус", "метилоранж"], [1], None),
        ("Формула серной кислоты?", ["HCl", "H2SO4", "HNO3"], [1], None),
        ("Сколько атомов водорода в молекуле воды?", [], [], "2"),
        ("Какая кислота есть в желудке?", ["соляная", "уксусная", "лимонная"], [], None),
    ]
    assert items[2]["kind"] == "open" and items[2]["evidence"] == "answer_line"
    assert items[3]["flags"] == ["no_key"]


def test_latin_letters_a_glued_star_and_an_english_answer_line():
    items = parsed("1) What is 2+2?\na) 3\nb) 4*\nc) 5\n2) Capital of France?\na) Berlin\nb) Paris\nc) Rome\nAnswer: b\n")
    assert [brief(item) for item in items] == [
        ("What is 2+2?", ["3", "4", "5"], [1], None),
        ("Capital of France?", ["Berlin", "Paris", "Rome"], [1], None),
    ]


def test_a_star_in_a_line_of_variants_and_a_star_before_a_variant():
    items = parsed("1. Формула воды?\nа) H2O*   б) H2O2   в) HO\n\n2. Столица Франции?\n*Париж\nБерлин\nРим\n")
    assert [brief(item) for item in items] == [
        ("Формула воды?", ["H2O", "H2O2", "HO"], [0], None),
        ("Столица Франции?", ["Париж", "Берлин", "Рим"], [0], None),
    ]


def test_uppercase_letters_dotted_letters_and_several_right_answers():
    items = parsed(
        "1. Кто написал «Бородино»?\nА) Пушкин\nБ) Лермонтов\nВ) Толстой\nОтвет: Б\n\n"
        "2. Выберите чётные числа.\nа) 2\nб) 3\nв) 4\nОтвет: а, в\n\n"
        "3. Год Бородинской битвы?\na. 1805\nb. 1812 *\nc. 1825\n"
    )
    assert [brief(item) for item in items] == [
        ("Кто написал «Бородино»?", ["Пушкин", "Лермонтов", "Толстой"], [1], None),
        ("Выберите чётные числа.", ["2", "3", "4"], [0, 2], None),
        ("Год Бородинской битвы?", ["1805", "1812", "1825"], [1], None),
    ]
    assert items[1]["kind"] == "multiple"


def test_a_chat_with_question_words_and_numbered_variants():
    items = parsed(
        "Вопрос 1. Сколько планет в Солнечной системе?\n1) 7\n2) 8 *\n3) 9\n"
        "Вопрос 2. Самая большая планета?\n1) Земля\n2) Юпитер *\n3) Марс\n"
    )
    assert [brief(item) for item in items] == [
        ("Сколько планет в Солнечной системе?", ["7", "8", "9"], [1], None),
        ("Самая большая планета?", ["Земля", "Юпитер", "Марс"], [1], None),
    ]


def test_plus_and_minus_marks_still_work():
    assert [brief(item) for item in parsed("1. 2+2=?\n+ 4\n- 5\n- 3\n")] == [("2+2=?", ["4", "5", "3"], [0], None)]


def test_a_question_of_several_lines_and_the_answer_in_brackets_on_its_own_line():
    items = parsed(
        "1. Прочитайте текст.\nВода кипит при 100 градусах на уровне моря.\nВерно ли утверждение?\nа) верно *\nб) неверно\n\n"
        "2.Сколько будет 2+2?\nа)3 б)4 в)5\n(Ответ: б)\n"
    )
    assert items[0]["text"] == "Прочитайте текст.\nВода кипит при 100 градусах на уровне моря.\nВерно ли утверждение?"
    assert (items[0]["options"], items[0]["correct"]) == (["верно", "неверно"], [0])
    assert brief(items[1]) == ("Сколько будет 2+2?", ["3", "4", "5"], [1], None)
    assert "joined_lines" not in items[1]["flags"]


def test_blank_lines_everywhere_and_a_short_answer_in_words():
    items = parsed("\n\n1. Первый вопрос?\n\nа) да *\n\nб) нет\n\n\n2. Второй вопрос?\nОтвет: сорок два\n\n")
    assert [brief(item) for item in items] == [("Первый вопрос?", ["да", "нет"], [0], None), ("Второй вопрос?", [], [], "сорок два")]


def test_lines_around_the_questions_are_left_out():
    result = bank_parse.parse_bank_text(
        "Контрольная по химии, 9 Б\nВариант 1\nФамилия, имя: ________\n\n"
        "1. Какой газ выделяется при реакции цинка с соляной кислотой?\nа) кислород\nб) водород *\nв) азот\n\nУдачи!\n",
        hand=True,
    )
    assert [brief(item) for item in result["items"]] == [
        ("Какой газ выделяется при реакции цинка с соляной кислотой?", ["кислород", "водород", "азот"], [1], None)
    ]
    assert "Удачи!" in result["skipped"] and "Контрольная по химии, 9 Б" in result["skipped"]


def test_a_star_inside_a_question_is_its_text():
    items = parsed("1. Сколько будет 2*3?\nа) 5\nб) 6 *\nв) 8\n2. Сколько будет 3*3?\nа) 6\nб) 9\nОтвет: б\n")
    assert [brief(item) for item in items] == [
        ("Сколько будет 2*3?", ["5", "6", "8"], [1], None),
        ("Сколько будет 3*3?", ["6", "9"], [1], None),
    ]


def test_without_marks_the_questions_come_without_a_key():
    items = parsed("1. Столица России?\nа) Москва\nб) Казань\n2. Столица Франции?\nа) Лион\nб) Париж\n")
    assert [item["correct"] for item in items] == [[], []]
    assert all("no_key" in item["flags"] for item in items)


def test_a_file_still_needs_two_marked_questions_for_a_star():
    text = "1. Столица Франции?\n*Париж\nБерлин\nРим\n2. Столица России?\nМосква\nКазань\n"
    assert bank_parse.parse_bank_text(text)["items"][0]["correct"] == []
    assert parsed(text)[0]["correct"] == [0]


def test_text_without_questions():
    assert paste_api.parse_paste("Привет, класс! Завтра контрольная.\nНе забудьте тетради.\n")["items"] == []
    assert paste_api.parse_paste("   \n ")["items"] == []


# ── POST /api/tests/paste ─────────────────────────────────────────────────────────


@pytest.fixture
def api(monkeypatch):
    import main

    async def fake_user(request):
        token = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
        if token not in TOKENS:
            raise HTTPException(status_code=401, detail="Требуется войти в аккаунт")
        return {"id": TOKENS[token]}

    sent: list[httpx.Request] = []

    def database(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        return httpx.Response(500, json={"message": "в этом тесте базы нет"})

    async def charged(*args, **kwargs):
        raise AssertionError("разбор текста не тратит единиц")

    async def model(*args, **kwargs):
        raise AssertionError("разбор текста не зовёт модель")

    monkeypatch.setattr(main, "require_authenticated_user", fake_user)
    monkeypatch.setattr(main.limiter, "enabled", False)
    monkeypatch.setattr(supabase_rest, "_transport", httpx.MockTransport(database))
    monkeypatch.setattr(quota, "charge", charged)
    monkeypatch.setattr(quota, "reserve", charged)
    monkeypatch.setattr(BaseAgent, "run", model)
    client = TestClient(main.app, headers={"Authorization": "Bearer token-a"})
    client.sent = sent
    client.main = main
    yield client


def assert_error(response, status: int, code: str) -> None:
    assert response.status_code == status, response.text
    body = response.json()
    assert set(body) == {"detail", "code"} and body["code"] == code
    assert re.search(r"[А-Яа-яЁё]", body["detail"])


def test_the_route_is_mounted_and_answers_the_questions(api):
    assert {(route.path, frozenset(route.methods)) for route in paste_api.router.routes} == {(PATH, frozenset({"POST"}))}
    assert api.main.paste_router is paste_api.router
    response = api.post(PATH, json={"text": "1. Столица Франции?\nа) Берлин\nб) Париж *\n"})
    assert response.status_code == 200
    body = response.json()
    assert [(item["text"], item["options"], item["correct"]) for item in body["items"]] == [("Столица Франции?", ["Берлин", "Париж"], [1])]
    assert api.sent == []  # в базу ничего не пишется


def test_text_without_questions_is_an_empty_list_not_an_error(api):
    response = api.post(PATH, json={"text": "Просто текст без вопросов."})
    assert response.status_code == 200 and response.json()["items"] == []


def test_a_bad_body_and_a_long_text(api):
    assert_error(api.post(PATH, json={"words": "1. Вопрос?"}), 400, "bad_body")
    assert_error(api.post(PATH, content=b"not json", headers={"content-type": "application/json"}), 400, "bad_body")
    assert_error(api.post(PATH, json={"text": "а" * (paste_api.PASTE_MAX_CHARS + 1)}), 413, "too_much_text")


def test_without_a_session_the_answer_is_401(monkeypatch):
    import main

    client = TestClient(main.app)
    response = client.post(PATH, json={"text": "1. Вопрос?\nа) да *\nб) нет\n"})
    assert response.status_code == 401


def test_the_route_itself_refuses_a_request_without_a_signed_in_user(monkeypatch):
    monkeypatch.setattr(limiter, "enabled", False)
    bare = FastAPI()
    bare.include_router(paste_api.router)  # без middleware main.py
    assert_error(TestClient(bare).post(PATH, json={"text": "1. Вопрос?"}), 401, "auth")


def test_the_limit_is_60_a_minute_per_user(api):
    limits = {
        name: [(str(limit.limit), limit.key_func) for limit in values]
        for name, values in api.main.limiter._route_limits.items()
        if name.startswith("paste_api.")
    }
    assert limits == {"paste_api.parse_pasted_test": [("60 per 1 minute", user_or_ip_key)]}
