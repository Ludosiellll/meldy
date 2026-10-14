"""POST /api/exams/parse-bank (bank_api.py): подключение к приложению, 401 без сессии, лимит 10 запросов
в минуту на пользователя, ошибки {"detail", "code"} по-русски, key_mode, key_text, format, форма ответа
предпросмотра (предметы, темы, вопросы с вариантами и открытые) — и ничего не пишется в базу, единицы
не списываются, модель не зовётся.

Supabase — подменённый транспорт httpx, который записывает каждый запрос; quota.charge, quota.reserve
и BaseAgent.run подменены так, что вызов роняет тест.
"""
import asyncio
import re
import sys
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import bank_api  # noqa: E402
import bank_parse  # noqa: E402
import quota  # noqa: E402
import supabase_rest  # noqa: E402
from agents.base import BaseAgent  # noqa: E402
from ratelimit import RATE_LIMIT_DETAIL, limiter, user_or_ip_key  # noqa: E402

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "banks"
PATH = "/api/exams/parse-bank"
TOKENS = {"token-a": "user-a", "token-b": "user-b"}
BANK_TEXT = (
    "Дисциплина: Основы программирования\n"
    "Тема 1. События\n"
    "1. Какой оператор вычитает и сразу присваивает результат?\nа) +=\nб) **-=**\nв) =-\n"
    "2. Что делает директива #region?\nа) **сворачивает блок кода**\nб) удаляет код\n"
    "3. Объясните, что вернёт items?.Count ?? 0, если items равно null.\n"
)
DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def assert_error(response, status: int, code: str, detail: str | None = None) -> None:
    assert response.status_code == status, response.text
    body = response.json()
    assert set(body) == {"detail", "code"} and body["code"] == code
    assert re.search(r"[А-Яа-яЁё]", body["detail"]) and len(body["detail"]) <= 200
    assert not re.search(r"Error|Exception|Traceback|http", body["detail"])
    if detail is not None:
        assert body["detail"] == detail


def fixture_file(name: str, mime: str = "application/octet-stream"):
    return {"file": (name, (FIXTURES / name).read_bytes(), mime)}


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
        raise AssertionError("разбор банка не тратит единиц")

    async def model(*args, **kwargs):
        raise AssertionError("разбор банка не зовёт модель")

    monkeypatch.setattr(main, "require_authenticated_user", fake_user)
    monkeypatch.setattr(main.limiter, "enabled", False)
    monkeypatch.delenv("MAX_UPLOAD_BYTES", raising=False)
    monkeypatch.setattr(supabase_rest, "_transport", httpx.MockTransport(database))
    monkeypatch.setattr(quota, "charge", charged)
    monkeypatch.setattr(quota, "reserve", charged)
    monkeypatch.setattr(BaseAgent, "run", model)
    client = TestClient(main.app, headers={"Authorization": "Bearer token-a"})
    client.sent = sent
    client.main = main
    yield client


# ── Подключение, сессия, лимит ──────────────────────────────────────────────────


def test_route_is_declared_with_its_full_path_and_mounted_in_main(api):
    assert {(route.path, frozenset(route.methods)) for route in bank_api.router.routes} == {(PATH, frozenset({"POST"}))}
    assert api.main.bank_router is bank_api.router
    assert api.post(PATH, data={"text": BANK_TEXT}).status_code == 200  # маршрут живой в приложении


def test_without_a_session_the_answer_is_401_and_nothing_is_read(monkeypatch):
    import main

    sent = []
    monkeypatch.setattr(supabase_rest, "_transport", httpx.MockTransport(lambda request: sent.append(request) or httpx.Response(500)))
    client = TestClient(main.app)
    response = client.post(PATH, data={"text": BANK_TEXT})
    assert response.status_code == 401 and response.json() == {"detail": "Требуется войти в аккаунт"}
    file_response = client.post(PATH, files=fixture_file("01_table_rows_bold.docx", DOCX))
    assert file_response.status_code == 401 and sent == []


def test_the_route_itself_refuses_a_request_without_a_signed_in_user(monkeypatch):
    monkeypatch.setattr(limiter, "enabled", False)
    bare = FastAPI()
    bare.include_router(bank_api.router)  # без middleware main.py
    assert_error(TestClient(bare).post(PATH, data={"text": BANK_TEXT}), 401, "auth", "Требуется войти в аккаунт")


def test_the_limit_is_10_a_minute_per_user(api, monkeypatch):
    limits = {
        name: [(str(limit.limit), limit.key_func) for limit in values]
        for name, values in api.main.limiter._route_limits.items()
        if name.startswith("bank_api.")
    }
    assert limits == {"bank_api.parse_test_bank": [("10 per 1 minute", user_or_ip_key)]}

    monkeypatch.setattr(api.main.limiter, "enabled", True)
    api.main.limiter.reset()
    try:
        for _ in range(10):
            assert api.post(PATH, data={"text": BANK_TEXT}).status_code == 200
        limited = api.post(PATH, data={"text": BANK_TEXT})
        assert limited.status_code == 429 and limited.json()["detail"] == RATE_LIMIT_DETAIL
        other_user = api.post(PATH, data={"text": BANK_TEXT}, headers={"Authorization": "Bearer token-b"})
        assert other_user.status_code == 200
    finally:
        api.main.limiter.reset()


# ── Ответ ───────────────────────────────────────────────────────────────────────


def test_pasted_text_returns_the_preview_and_nothing_is_written_or_charged(api, quota_on):
    response = api.post(PATH, data={"text": BANK_TEXT})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["method"] == "rules" and body["layout"] == "numbered_paragraphs"
    assert body["subjects"] == [{"index": 1, "title": "Основы программирования", "evidence": "heading", "items": 3}]
    assert body["topics"] == [{"index": 1, "title": "Тема 1. События", "subject": 1, "items": 3}]
    assert body["key_source"] == {"bold": 2} and body["format_signal"] == "bold" and body["marker"] is None
    first, second, third = body["items"]
    assert first == {
        "position": 1, "label": "1", "subject": 1, "topic": 1, "kind": "single",
        "text": "Какой оператор вычитает и сразу присваивает результат?", "options": ["+=", "-=", "=-"], "correct": [1],
        "order": [], "pairs": [], "answer": None, "evidence": "bold", "flags": [], "code": True, "where": "строка 3",
        "marks": {"bold": [0, 1, 0]},
    }
    assert second["options"] == ["сворачивает блок кода", "удаляет код"] and second["correct"] == [0]
    assert third["kind"] == "open" and third["options"] == [] and third["correct"] == [] and third["flags"] == []
    assert third["text"] == "Объясните, что вернёт items?.Count ?? 0, если items равно null." and third["marks"] == {"bold": []}
    assert body["stats"] == {"items": 3, "with_key": 2, "no_key": 0, "ambiguous": 0, "to_check": 0, "duplicates": 0,
                             "kinds": {"single": 2, "open": 1}, "options": {"0": 1, "2": 1, "3": 1}, "gaps": [], "key_lists": 0}
    assert body["warnings"] == [] and api.sent == []


def test_docx_txt_md_and_xlsx_files_are_parsed(api):
    owner = api.post(PATH, files=fixture_file("01_table_rows_bold.docx", DOCX)).json()
    assert owner["stats"]["items"] == 12 and owner["key_source"] == {"bold": 12} and len(owner["topics"]) == 3
    assert owner["items"][0]["where"] == "таблица 1, строка 3"
    mytest = api.post(PATH, files=fixture_file("07_mytest_plusminus.txt", "text/plain")).json()
    assert mytest["marker"] == "plus_minus" and mytest["stats"]["items"] == 7
    markdown = api.post(PATH, files={"file": ("Тест.MD", BANK_TEXT.encode(), "text/markdown")}).json()
    assert markdown["key_source"] == {"bold": 2}
    sheet = api.post(PATH, files=fixture_file("11_columns_key.xlsx")).json()
    assert sheet["layout"] == "table_option_columns" and sheet["key_source"] == {"key_column": 12}
    assert sheet["items"][0]["where"] == "лист 1, строка 3"
    session = api.post(PATH, files=fixture_file("20_two_subjects.docx", DOCX)).json()
    assert [(s["title"], s["items"]) for s in session["subjects"]] == [("Основы программирования", 12), ("История Беларуси", 6)]
    assert api.sent == []


def test_key_mode_key_text_and_format_are_passed_to_the_parser(api):
    owner = fixture_file("01_table_rows_bold.docx", DOCX)
    first = api.post(PATH, files=owner, data={"key_mode": "first_option"}).json()
    assert first["key_source"] == {"first_option": 12}
    none = api.post(PATH, files=owner, data={"key_mode": "none"}).json()
    assert none["key_source"] == {} and none["stats"]["no_key"] == 12
    key_text = (FIXTURES / "16_key.txt").read_text(encoding="utf-8")
    keyed = api.post(PATH, files=fixture_file("16_questions_only.docx", DOCX), data={"key_text": key_text}).json()
    assert keyed["key_source"] == {"key_text": 12} and keyed["stats"]["no_key"] == 0
    subpoints = fixture_file("26_open_subpoints.txt", "text/plain")
    auto = api.post(PATH, files=subpoints).json()
    assert auto["stats"]["kinds"] == {"single": 3, "open": 2}
    opened = api.post(PATH, files=subpoints, data={"format": "open"}).json()
    assert opened["stats"]["kinds"] == {"open": 5}
    assert opened["items"][0]["text"] == "Экономические системы:\nа) традиционная;\nб) рыночная;\nв) смешанная."
    as_test = api.post(PATH, files=fixture_file("24_open_list.txt", "text/plain"), data={"format": "test"})
    assert_error(as_test, 422, "no_items", bank_parse.NO_TEST_ITEMS_DETAIL)



def test_a_key_file_beside_the_questions_supplies_the_key_and_its_errors_say_key_file(api):
    """Ключ отдельным файлом (владелец, 2026-10-14): «16_key.txt» рядом с «16_questions_only.docx»."""
    questions = ("16_questions_only.docx", (FIXTURES / "16_questions_only.docx").read_bytes(), DOCX)
    key = ("Ключ.txt", (FIXTURES / "16_key.txt").read_bytes(), "text/plain")
    keyed = api.post(PATH, files={"file": questions, "key_file": key}).json()
    assert keyed["key_source"] == {"key_text": 12} and keyed["key_file"] == {
        "sections": [{"title": "", "variant": None, "count": 12}], "used": 0}
    chosen = api.post(PATH, files={"file": questions, "key_file": key}, data={"key_section": "0"}).json()
    assert chosen["key_file"]["used"] == 0
    empty = api.post(PATH, files={"file": questions, "key_file": ("Ключ.txt", "ответы позже".encode(), "text/plain")})
    assert_error(empty, 422, "no_keys", "Файл ключа: в файле ключа не нашли пар «номер — ответ»: нужна таблица «1 | А» или строки «1 – А».")
    old = api.post(PATH, files={"file": questions, "key_file": ("Ключ.doc", b"\xd0\xcf\x11\xe0", "application/msword")})
    assert old.status_code == 415 and old.json()["code"] == "key_file_old_doc"
    assert api.post(PATH, files={"file": questions}, data={"key_section": "один"}).status_code == 400


RESPONSE_KEYS = {"method", "layout", "layouts_seen", "variant", "confidence", "key_source", "format_signal", "format_signals",
                 "mark_share", "marker", "markers", "subjects", "topics", "skipped", "warnings", "items", "stats"}
ITEM_KEYS = {"position", "label", "subject", "topic", "kind", "text", "options", "correct", "order", "pairs", "answer",
             "evidence", "flags", "code", "where", "marks"}


def test_synthetic_banks_come_back_whole_and_in_the_same_shape(api):
    """Синтетические банки: ключ одной строкой в конце DOCX и код между вопросом и «+»/«-» в TXT — через маршрут
    приходят все вопросы с ключами, код остаётся в тексте вопроса; форма ответа прежняя."""
    keylist = api.post(PATH, files=fixture_file("synthetic/networks_keylist_slice.docx", DOCX))
    assert keylist.status_code == 200, keylist.text
    body = keylist.json()
    assert set(body) == RESPONSE_KEYS and all(set(item) == ITEM_KEYS for item in body["items"])
    assert body["stats"]["items"] == 50 and body["key_source"] == {"key_list": 50} and body["stats"]["to_check"] == 0
    route = next(item for item in body["items"] if item["text"].startswith("Дан фрагмент таблицы маршрутизации"))
    assert "\n0.0.0.0        0.0.0.0          192.168.1.1    192.168.1.10\n" in route["text"] and len(route["options"]) == 5
    plus = api.post(PATH, files=fixture_file("synthetic/os_plus_slice.txt", "text/plain")).json()
    assert set(plus) == RESPONSE_KEYS and plus["marker"] == "plus_minus"
    assert plus["stats"]["items"] == 55 and plus["key_source"] == {"marker": 55} and plus["stats"]["options"] == {"5": 55}
    fork = next(item for item in plus["items"] if "fork();" in item["text"])
    assert fork["text"].splitlines()[1:3] == ["#include <stdio.h>", "#include <unistd.h>"] and len(fork["options"]) == 5
    assert api.sent == []


# ── Ошибки ──────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(("request_kwargs", "status", "code", "detail"), [
    ({"files": {"file": ("Тест.doc", b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\0" * 64, "application/msword")}}, 415, "old_doc",
     "Это файл Word старого формата (.doc). Откройте его в Word, сохраните как DOCX и загрузите снова."),
    ({"files": {"file": ("Тест.pdf", b"%PDF-1.4", "application/pdf")}}, 415, "unsupported",
     "Пока принимаем DOCX, TXT и XLSX. PDF добавим позже — если есть файл Word, загрузите его."),
    ({"files": {"file": ("Тест.xls", b"\xd0\xcf\x11\xe0", "application/vnd.ms-excel")}}, 415, "unsupported", None),
    ({"files": {"file": ("Тест.docx", b"not a zip at all", DOCX)}}, 422, "unreadable",
     "Не удалось прочитать файл. Сохраните его заново в Word как DOCX и попробуйте ещё раз."),
    ({"files": {"file": ("Тест.txt", b"", "text/plain")}}, 422, "empty_file", "Файл пустой. Выберите другой файл."),
    ({"data": {"text": "Просто строка без вопросов"}}, 422, "no_items",
     "Не нашли вопросов. Проверьте, что в файле есть пронумерованные вопросы."),
    ({"data": {"text": "\n".join(f"{n}. Вопрос {n}?" for n in range(1, 2002))}}, 413, "too_many",
     "В файле больше 2000 вопросов. Разделите его на части и загрузите по очереди."),
    ({"files": {"text": (None, "1. Вопрос?\n" + "а" * 2_000_000)}}, 413, "too_much_text", bank_parse.TOO_MUCH_TEXT_DETAIL),
    ({"data": {"text": "1. Вопрос?\n" + "а" * 2_000_000}}, 413, "too_much_text", bank_parse.TOO_MUCH_TEXT_DETAIL),  # поле больше 8 МБ
    ({"data": {"text": BANK_TEXT}, "files": {"file": ("Тест.txt", BANK_TEXT.encode(), "text/plain")}}, 400, "both_inputs", None),
    ({"data": {"text": "   "}}, 400, "no_input", None),
    ({"data": {"text": BANK_TEXT, "key_mode": "teacher"}}, 400, "bad_form", None),
    ({"data": {"text": BANK_TEXT, "format": "essay"}}, 400, "bad_form", None),
    ({"data": {"text": BANK_TEXT, "key_text": "1 – а\n" * 6000}}, 400, "key_text_too_long", None),
])
def test_errors_come_with_a_code_and_a_russian_text(api, request_kwargs, status, code, detail):
    assert_error(api.post(PATH, **request_kwargs), status, code, detail)
    assert api.sent == []


def test_a_file_over_the_upload_limit_is_413_file_too_big(api, monkeypatch):
    monkeypatch.setenv("MAX_UPLOAD_BYTES", "1000")
    response = api.post(PATH, files={"file": ("Тест.txt", ("1. Вопрос?\nа) да\nб) нет\n" * 100).encode(), "text/plain")})
    assert_error(response, 413, "file_too_big", "Файл слишком большой. Максимальный размер: 1000 байт")


def test_old_word_and_pdf_are_refused_before_the_upload_is_read(api, monkeypatch):
    monkeypatch.setenv("MAX_UPLOAD_BYTES", "10")  # файл больше предела, но ответ — про формат
    big_pdf = {"file": ("Тест.pdf", b"%PDF-1.4" + b"0" * 1000, "application/pdf")}
    assert_error(api.post(PATH, files=big_pdf), 415, "unsupported")
    big_doc = {"file": ("Тест.doc", b"\xd0\xcf\x11\xe0" + b"0" * 1000, "application/msword")}
    assert_error(api.post(PATH, files=big_doc), 415, "old_doc")


# ── Без базы, без единиц, вне цикла событий ─────────────────────────────────────


def test_nothing_is_written_to_the_database_and_no_units_are_charged(api, quota_on):
    responses = [
        api.post(PATH, data={"text": BANK_TEXT}),
        api.post(PATH, files=fixture_file("01_table_rows_bold.docx", DOCX), data={"key_mode": "none"}),
        api.post(PATH, files=fixture_file("11_columns_key.xlsx")),
        api.post(PATH, files={"file": ("Тест.docx", b"broken", DOCX)}),
    ]
    assert [response.status_code for response in responses] == [200, 200, 200, 422]
    assert api.sent == []  # ни одного запроса к Supabase: ни записи, ни списания, ни журнала вызовов
    for module in ("bank_api", "bank_parse", "bank_docx"):
        source = (Path(__file__).resolve().parents[1] / f"{module}.py").read_text(encoding="utf-8")
        assert not re.search(r"^\s*(?:import|from)\s+(?:supabase_rest|quota|agents|exams_parse|ocr)\b", source, re.M), module


def test_parsing_runs_off_the_event_loop(api, monkeypatch):
    seen = {}
    real = bank_api.parse_bank_text

    def spy(*args, **kwargs):
        try:
            asyncio.get_running_loop()
            seen["loop"] = True
        except RuntimeError:
            seen["loop"] = False
        return real(*args, **kwargs)

    monkeypatch.setattr(bank_api, "parse_bank_text", spy)
    assert api.post(PATH, data={"text": BANK_TEXT}).status_code == 200
    assert seen == {"loop": False}
