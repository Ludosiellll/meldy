"""Выпуск 49: экспорт теста в GIFT, Moodle XML, Aiken и таблицу Kahoot (bank_export.py), обратный путь «экспорт →
импорт» для каждого вида, который формат держит, и маршрут /api/tests/export.
"""
import base64
import io
import sys
import zipfile
from pathlib import Path

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import bank_export  # noqa: E402
from bank_parse import parse_bank_file  # noqa: E402


# ── экспорт ─────────────────────────────────────────────────────────────────────

CODE = "Что выведет код?\nfor i in range(2):\n    print(i)"
ITEMS = [
    {"kind": "single", "stem": "Столица Франции? {скобки} = #1 ~ a:b \\ <b>&</b>", "options": ["Париж", "Лион \"кавычки\"", "Ницца"], "correct": [0],
     "explanation": "Париж — столица с 987 года."},
    {"kind": "single", "stem": "Кит — рыба.", "options": ["Верно", "Неверно"], "correct": [1], "explanation": "Кит — млекопитающее."},
    {"kind": "multiple", "stem": "Чётные числа:", "options": ["2", "3", "4"], "correct": [0, 2]},
    {"kind": "short", "stem": "Автор «Онегина»?", "answers": ["Пушкин", "А. С. Пушкин"], "explanation": "Роман в стихах."},
    {"kind": "number", "stem": "g у поверхности Земли, м/с²?", "answers": ["9.8"], "tolerance": 0.1, "unit": "м/с²",
     "explanation": "Около 9,8."},
    {"kind": "number", "stem": "Корни уравнения x² = 4?", "answers": ["2", "-2"]},
    {"kind": "order", "stem": "Расставьте по порядку.", "options": ["Пётр I", "Екатерина II", "Александр I"], "correct": [0, 1, 2]},
    {"kind": "match", "stem": "Страна — столица.", "options": ["Франция", "Италия"], "answers": ["Париж", "Рим", "Мадрид"],
     "explanation": "Мадрид лишний."},
    {"kind": "cloze", "stem": "Столица Германии — ___.", "answers": ["Берлин\nBerlin"]},
    {"kind": "cloze", "stem": "Вода кипит при ___ °C, а замерзает при ___ °C.", "answers": ["100", "0"], "explanation": "При нормальном давлении."},
    {"kind": "essay", "stem": "Опишите круговорот воды."},
    {"kind": "single", "stem": CODE, "options": ["0 1", "1 2"], "correct": [0], "code": True},
]


def meldy(item: dict) -> tuple:
    """Вопрос разбора, каким его сохранит импорт (importModel.ts), — для сравнения с исходным."""
    kind, text, explanation = item["kind"], item["text"], item.get("explanation", "")
    if kind == "truefalse":
        kind = "single"
    if kind == "open" and item.get("number"):
        return ("number", text, (), (), tuple(item["number"]["answers"]), item["number"]["tolerance"], explanation)
    if kind == "open" and item.get("answer"):
        return ("short", text, (), (), tuple(item["answer"].split("; ")), None, explanation)
    if kind == "open":
        return ("oral", text, (), (), (), None, explanation)
    if kind == "order":
        return ("order", text, tuple(item["options"][i] for i in item["order"]), (), (), None, explanation)
    if kind == "match":
        return ("match", text, tuple(a for a, _ in item["pairs"]), (), tuple(b for _, b in item["pairs"]) + tuple(item.get("extras", [])), None, explanation)
    if kind == "cloze":
        return ("cloze", text, (), (), tuple("\n".join(g) for g in item["gaps"]), None, explanation)
    return (kind, text, tuple(item["options"]), tuple(item["correct"]), (), None, explanation)


def source(row: dict) -> tuple:
    kind = row["kind"]
    tolerance = row.get("tolerance")
    tolerance = None if tolerance in (None, 0) else format(tolerance, "g")
    return (kind, row["stem"], tuple(row.get("options", [])) if kind not in ("number", "cloze", "short", "essay") else (),
            tuple(row.get("correct", [])) if kind in ("single", "multiple") else (), tuple(row.get("answers", [])),
            tolerance, row.get("explanation", ""))


def back(fmt: str, rows: list[dict]) -> tuple[bank_export.Exported, list[tuple]]:
    done = bank_export.export(fmt, "Проверочная по физике", rows)
    name = {"gift": "x.gift", "moodle": "x.xml", "aiken": "x.txt"}[fmt]
    return done, [meldy(item) for item in parse_bank_file(done.data, name)["items"]]


def test_moodle_xml_round_trip_gives_back_every_kind():
    done, items = back("moodle", ITEMS)
    assert done.skipped == [] and done.count == len(ITEMS)
    expected = [source(row) for row in ITEMS]
    expected[10] = ("oral", ITEMS[10]["stem"], (), (), (), None, "")  # эссе Meldy читает устным вопросом, как раньше
    assert items == expected


def test_gift_round_trip_gives_back_what_gift_holds():
    done, items = back("gift", ITEMS)
    assert [(s["number"], s["reason"]) for s in done.skipped] == [
        ("7", "в GIFT нет вопросов на порядок"), ("10", "в GIFT у вопроса может быть только один пропуск")]
    kept = [row for k, row in enumerate(ITEMS) if k not in (6, 9)]
    expected = [source(row) for row in kept]
    # один пропуск в GIFT — краткий ответ с пропуском в тексте (Moodle читает его так же); эссе — устный вопрос
    expected[7] = ("short", "Столица Германии — ___.", (), (), ("Берлин", "Berlin"), None, "")
    expected[8] = ("oral", ITEMS[10]["stem"], (), (), (), None, "")
    assert items == expected


def test_aiken_round_trip_gives_back_single_answer_questions_and_names_the_rest():
    done, items = back("aiken", ITEMS)
    assert items == [source(ITEMS[0])[:6] + ("",), source(ITEMS[1])[:6] + ("",)]  # пояснений в Aiken нет
    reasons = {s["number"]: s["reason"] for s in done.skipped}
    assert reasons["3"] == "в Aiken только вопросы с одним верным ответом"
    assert reasons["12"] == "в Aiken вопрос и варианты пишутся одной строкой, а здесь код в несколько строк"
    assert len(done.skipped) == 10


def test_a_picture_question_and_a_question_without_key_are_not_exported():
    rows = [{"kind": "single", "stem": "Вопрос на картинке", "options": ["Рисунок А", "Рисунок Б"], "correct": [0]},
            {"kind": "single", "stem": "Без ключа?", "options": ["а", "б"], "correct": []},
            {"kind": "single", "stem": "С картинкой и текстом?", "options": ["а", "б"], "correct": [1], "images": {"stem": ["c/x.png"]}}]
    for fmt in bank_export.FORMATS:
        done = bank_export.export(fmt, "Т", rows)
        assert [s["reason"] for s in done.skipped] == [bank_export.WHY_PICTURE, bank_export.WHY_NO_KEY]
        assert done.count == 1 and done.pictures_lost == 1


def test_the_gift_file_is_what_moodle_reads():
    text = bank_export.export("gift", "Физика: 9 класс", ITEMS[:5]).data.decode("utf-8")
    assert text.startswith("// Физика: 9 класс: выгружено из Meldy\n$CATEGORY: Физика: 9 класс\n")
    assert "::Кит — рыба.::Кит — рыба.{FALSE####Кит — млекопитающее.}" in text
    assert "\t~%50%2\n\t~%-100%3\n\t~%50%4" in text
    assert "{#9.8:0.1\n\t####Около 9,8.\n}" in text
    assert "\\{скобки\\} \\= \\#1 \\~ a\\:b \\\\" in text


def test_the_moodle_file_is_valid_xml_with_categories_and_feedback():
    from defusedxml import ElementTree as safe_tree

    root = safe_tree.fromstring(bank_export.export("moodle", "Тест", ITEMS).data)
    kinds = [q.get("type") for q in root.iter("question")]
    assert kinds == ["category", "multichoice", "truefalse", "multichoice", "shortanswer", "numerical", "numerical",
                     "ordering", "matching", "cloze", "cloze", "essay", "multichoice"]
    assert root.find("question/category/text").text == "$course$/top/Тест"
    cloze = [q for q in root.iter("question") if q.get("type") == "cloze"][1]
    assert "{1:SHORTANSWER:=100}" in cloze.findtext("questiontext/text")
    assert cloze.findtext("generalfeedback/text") == "<p>При нормальном давлении.</p>"


def kahoot_cells(data: bytes) -> tuple[str, dict[str, str]]:
    from defusedxml import ElementTree as safe_tree

    ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    book = zipfile.ZipFile(io.BytesIO(data))
    sheet_name = safe_tree.fromstring(book.read("xl/workbook.xml")).find(f"{ns}sheets/{ns}sheet").get("name")
    shared = [("".join(t.text or "" for t in si.iter(f"{ns}t"))) for si in
              safe_tree.fromstring(book.read("xl/sharedStrings.xml")).findall(f"{ns}si")]
    cells = {}
    for cell in safe_tree.fromstring(book.read("xl/worksheets/sheet1.xml")).iter(f"{ns}c"):
        value = cell.find(f"{ns}v")
        if value is None:
            continue
        cells[cell.get("r")] = shared[int(value.text)] if cell.get("t") == "s" else value.text
    return sheet_name, cells


def test_the_kahoot_sheet_follows_their_template():
    rows = ITEMS + [
        {"kind": "single", "stem": "Пять вариантов?", "options": list("абвгд"), "correct": [0]},
        {"kind": "single", "stem": "Длинный " + "очень " * 30, "options": ["а", "б"], "correct": [0]},
        {"kind": "multiple", "stem": "Два верных?", "options": ["а", "б", "в"], "correct": [0, 2]},
    ]
    done = bank_export.export("kahoot", "Викторина", rows)
    name, cells = kahoot_cells(done.data)
    assert name == "Sheet1" and done.name == "Викторина (Kahoot).xlsx"
    assert [cells[f"{col}8"] for col in "BCDEFGH"] == list(bank_export.KAHOOT_HEADERS)
    assert (cells["A9"], cells["B9"], cells["C9"], cells["E9"], cells["G9"], cells["H9"]) == (
        "1", ITEMS[0]["stem"], "Париж", "Ницца", "20", "1")
    assert cells["B10"] == "Кит — рыба." and cells["H10"] == "2"
    assert cells["B11"] == "Чётные числа:" and cells["H11"] == "1,3"
    assert cells["B12"] == "Что выведет код? for i in range(2): print(i)"  # строки — пробелом: Kahoot их не показывает
    assert cells["B13"] == "Два верных?" and cells["H13"] == "1,3" and "A14" not in cells
    reasons = {s["number"]: s["reason"] for s in done.skipped}
    assert reasons["13"] == bank_export.WHY_KAHOOT_OPTIONS and reasons["14"] == bank_export.WHY_KAHOOT_STEM
    assert reasons["4"] == bank_export.WHY_KAHOOT_KIND and done.count == 5


def test_unknown_format_or_kind_is_refused():
    with pytest.raises(bank_export.ExportError):
        bank_export.export("docx", "Т", ITEMS)
    with pytest.raises(bank_export.ExportError):
        bank_export.export("gift", "Т", [{"kind": "riddle", "stem": "?"}])


def test_file_names_are_safe():
    assert bank_export.export("aiken", 'Тест: "1/2" <x>', ITEMS[:1]).name == "Тест 1 2 x (Aiken).txt"
    assert bank_export.export("gift", "   ", ITEMS[:1]).name == "Тест (GIFT).txt"


# ── /api/tests/export ───────────────────────────────────────────────────────────


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
    return TestClient(main.app, headers={"Authorization": "Bearer token-a"})


def test_export_route_returns_the_file_and_what_was_left_out(api):
    response = api.post("/api/tests/export", json={"format": "gift", "title": "Физика", "items": ITEMS})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["name"] == "Физика (GIFT).txt" and body["mime"].startswith("text/plain")
    assert body["count"] == 10 and body["total"] == 12 and len(body["skipped"]) == 2
    assert base64.b64decode(body["data"]).decode("utf-8").startswith("// Физика")


def test_export_route_needs_a_session_and_a_known_format(api):
    assert api.post("/api/tests/export", json={"format": "gift", "items": []}, headers={"Authorization": ""}).status_code == 401
    for body in ({"format": "pdf", "items": []}, {"format": "gift", "items": "x"}, {"format": "gift", "items": [{"kind": "x"}]}):
        response = api.post("/api/tests/export", json=body)
        assert response.status_code == 400 and response.json()["code"] == "bad_request"
