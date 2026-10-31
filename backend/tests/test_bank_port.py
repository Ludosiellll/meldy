"""Выпуск 49: импорт GIFT, Aiken и Moodle XML (пояснения, допуск, соответствие с лишними, пропуски, порядок) и
безопасный разбор XML.

Корпус — tests/fixtures/banks/port: выгрузка курса Moodle 4.x, GIFT, каким его пишет Moodle, GIFT учителя, Aiken и
сломанные файлы (оборванный, битая разметка, сущности, пустой, windows-1251, BOM и CRLF).
"""
import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bank_parse import BankError, parse_bank_file, parse_bank_text  # noqa: E402

PORT = Path(__file__).resolve().parent / "fixtures" / "banks" / "port"


def read(name: str) -> dict:
    return parse_bank_file((PORT / name).read_bytes(), name)


def by_text(result: dict, start: str) -> dict:
    found = [item for item in result["items"] if item["text"].startswith(start)]
    assert len(found) == 1, [item["text"] for item in result["items"]]
    return found[0]


# ── Moodle XML ──────────────────────────────────────────────────────────────────


def test_a_moodle_course_export_keeps_every_kind_its_explanation_and_tolerance():
    result = read("moodle_course_export.xml")
    assert [t["title"] for t in result["topics"]] == ["Тема 1. Пожарная безопасность"]
    kinds = [item["kind"] for item in result["items"]]
    assert kinds == ["single", "multiple", "truefalse", "open", "open", "match", "cloze", "open", "order", "open", "open"]
    single = result["items"][0]
    assert single["options"][0] == "Углекислотным (ОУ)" and single["correct"] == [0]
    assert single["explanation"].startswith("Углекислотный огнетушитель (ОУ) не проводит ток")  # generalfeedback
    tf = result["items"][2]
    assert tf["correct"] == [1] and tf["explanation"].startswith("Лифт может остановиться")  # отзыв верного ответа
    number = result["items"][3]
    assert number["number"] == {"answers": ["90"], "tolerance": "5"} and number["explanation"] == "Полторы минуты."
    match = result["items"][5]
    assert match["pairs"] == [["Красный", "Запрет"], ["Жёлтый", "Предупреждение"], ["Зелёный", "Безопасность"]]
    assert match["extras"] == ["Предписание"] and match["explanation"].startswith("ГОСТ 12.4.026")
    order = result["items"][8]
    assert order["options"][0] == "Сообщить по телефону 101 или 112" and order["order"] == [0, 1, 2, 3]
    assert "explanation" not in result["items"][1]  # пустой generalfeedback и отзыв не верного ответа — не пояснение


def test_a_moodle_cloze_becomes_gaps_and_a_choice_gap_shows_its_choices():
    cloze = by_text(read("moodle_course_export.xml"), "План эвакуации")
    assert cloze["kind"] == "cloze" and cloze["evidence"] == "gift"
    assert cloze["text"] == ("План эвакуации вывешивают на каждом ___. Его пересматривают не реже раза в ___ лет. "
                             "Пути эвакуации на плане — ___ (зелёные / красные / синие) стрелки.")
    assert cloze["gaps"] == [["этаже", "этаже здания"], ["5"], ["зелёные"]]
    assert cloze["explanation"] == "Зелёный цвет на плане значит «путь к выходу»."


def test_a_cloze_that_cannot_be_carried_stays_an_open_question_as_before():
    result = read("moodle_course_export.xml")
    several = by_text(result, "Отметьте первичные средства")  # MULTIRESPONSE: несколько верных в пропуске
    assert several["kind"] == "open" and "gaps" not in several
    assert by_text(result, "Огнетушитель проверяют")["kind"] == "open"  # перетаскивание
    broken = by_text(read("moodle_broken_markup.xml"), "Жгут накладывают")
    assert broken["kind"] == "open"


@pytest.mark.parametrize("name", ["moodle_cp1251.xml", "moodle_bom_crlf.xml"])
def test_moodle_in_windows_1251_or_with_a_bom_and_crlf_reads_the_same(name):
    item = read(name)["items"][0]
    assert item["text"] == "Какой инструктаж проводят при приёме на работу?"
    assert item["options"] == ["Вводный", "Целевой", "Внеплановый"] and item["correct"] == [0]
    assert item["explanation"] == "Вводный инструктаж проводят до начала работы."


def test_a_cut_off_moodle_file_gives_the_questions_before_the_cut():
    result = read("moodle_cut_off.xml")
    assert [item["kind"] for item in result["items"][:4]] == ["single", "multiple", "truefalse", "open"]
    assert result["items"][3]["number"]["tolerance"] == "5"


def test_broken_moodle_markup_reads_what_it_can_and_flags_the_rest():
    result = read("moodle_broken_markup.xml")
    assert by_text(result, "Где хранят аптечку?")["flags"] == ["few_options"]  # второй вариант съела битая разметка
    assert by_text(result, "Пострадавшему с ожогом")["kind"] == "truefalse"


def test_an_empty_moodle_export_has_no_questions():
    with pytest.raises(BankError) as raised:
        read("moodle_empty.xml")
    assert raised.value.code == "no_items"


def test_entities_are_never_expanded_read_or_fetched_and_the_rest_of_the_file_is_read():
    started = time.monotonic()
    result = read("moodle_entities.xml")
    assert time.monotonic() - started < 2  # «миллиард смехов» не раскрыт
    texts = " ".join(item["text"] + " " + " ".join(item["options"]) + " " + str(item.get("answer")) for item in result["items"])
    assert "root:" not in texts and "lol" not in texts  # /etc/passwd не прочитан, сущности не подставлены
    assert by_text(result, "Безопасный вопрос?")["correct"] == [0]


def test_the_moodle_reader_parses_with_defusedxml_first(monkeypatch):
    import bank_formats
    from defusedxml import ElementTree as safe_tree

    used = []
    real = safe_tree.fromstring

    def spy(data, **kwargs):
        used.append(kwargs)
        return real(data, **kwargs)

    monkeypatch.setattr(safe_tree, "fromstring", spy)
    questions = bank_formats.read_moodle((PORT / "moodle_course_export.xml").read_bytes())
    assert used == [{"forbid_dtd": True, "forbid_entities": True, "forbid_external": True}] and len(questions) == 11


# ── GIFT ────────────────────────────────────────────────────────────────────────


def test_gift_as_moodle_writes_it_html_feedback_and_category_path():
    result = read("gift_moodle_export.gift")
    assert [t["title"] for t in result["topics"]] == ["Тема 3. Адресация"]
    mask = by_text(result, "Какая маска")
    assert mask["options"] == ["255.255.255.0", "255.255.0.0", "255.0.0.0"] and mask["correct"] == [0]
    assert mask["explanation"] == "Префикс /24 — это 24 единицы в начале маски."  # «####» сильнее отзыва ответа
    tf = by_text(result, "Адрес IPv6")
    assert tf["kind"] == "truefalse" and tf["correct"] == [0]
    assert tf["explanation"] == "Неверно: у IPv6 — 128 бит, а 32 бита — у IPv4."  # {TRUE#…#…}: более длинный отзыв
    port = by_text(result, "Номер порта HTTPS")
    assert port["number"] == {"answers": ["443"], "tolerance": None} and port["answer"] == "443"
    assert port["explanation"] == "HTTP — 80, HTTPS — 443."
    osi = by_text(result, "Соотнесите протокол")
    assert osi["pairs"] == [["IP", "сетевой"], ["TCP", "транспортный"], ["Ethernet", "канальный"]]


def test_a_teachers_gift_keeps_feedback_ranges_distractors_and_tf_with_feedback():
    result = read("gift_teacher.txt")
    g = by_text(result, "Чему равно ускорение")
    assert g["number"] == {"answers": ["9.8"], "tolerance": "0.1"} and g["explanation"] == "Обычно берут 9,8 м/с²."
    assert by_text(result, "Сколько планет")["number"] == {"answers": ["5.5"], "tolerance": "0.5"}
    assert by_text(result, "Сила измеряется в ___ — единицах СИ.")["answer"] == "ньютонах; Н; ньютон"
    law = by_text(result, "Тело сохраняет скорость")
    assert law["kind"] == "truefalse" and law["correct"] == [0] and law["explanation"] == "Это первый закон Ньютона."
    who = by_text(result, "Соотнесите учёного")
    assert len(who["pairs"]) == 3 and who["extras"] == ["закон Ома"]
    vectors = by_text(result, "Какие из величин")
    assert vectors["kind"] == "multiple" and vectors["correct"] == [0, 1]
    assert vectors["explanation"] == "Да, у скорости есть направление."
    braces = by_text(result, "Запись {x} в задаче")
    assert braces["correct"] == [1] and braces["explanation"].startswith("Фигурные скобки")


def test_broken_gift_skips_what_has_no_answers_and_keeps_the_rest():
    result = read("gift_broken.gift")
    assert result["skipped"][:2] == ["Сколько ног у паука? {=8 ~6 ~10", "Просто строка без ответов — заметка учителя."]
    assert by_text(result, "Столица Беларуси?")["correct"] == [0]
    assert by_text(result, "Соотнесите.")["pairs"] == [["Москва", ""]]  # без пары: при сохранении не перенесётся


def test_a_gift_file_with_one_untitled_question_is_read_as_gift():
    text = "Столица Франции? {=Париж ~Лион}"
    assert parse_bank_file(text.encode(), "one.gift")["items"][0]["correct"] == [0]
    with pytest.raises(BankError):
        parse_bank_file(b"\x00\x01", "bad.gift")


def test_gift_missing_word_has_tidy_spaces_around_the_gap():
    item = parse_bank_text("::a:: Столица Германии — {=Берлин}.\n\n::b:: Вода {=кипит} при 100 °C.")["items"]
    assert [i["text"] for i in item] == ["Столица Германии — ___.", "Вода ___ при 100 °C."]


# ── Aiken ───────────────────────────────────────────────────────────────────────


def test_aiken_reads_statements_too():
    text = "Кит — рыба.\nA. Верно\nB. Неверно\nANSWER: B\n\nСтолица Франции\nA) Париж\nB) Лион\nANSWER: A\n"
    result = parse_bank_text(text)
    assert result["layout"] == "aiken"
    assert [(i["text"], i["correct"]) for i in result["items"]] == [("Кит — рыба.", [1]), ("Столица Франции", [0])]


def test_aiken_from_moodle_and_broken_aiken():
    assert [i["correct"] for i in read("aiken_moodle.txt")["items"]] == [[1], [2], [1]]
    broken = read("aiken_broken.txt")["items"]
    assert "no_key" in broken[0]["flags"] and "key_invalid" in broken[1]["flags"] and broken[2]["correct"] == [1]


def test_numbered_aiken_like_files_stay_with_the_general_reader():
    text = "Question 1. What is 2+2?\nA. 3\nB. 4\nANSWER: B\n\nQuestion 2. Capital of Canada?\nA. Ottawa\nB. Toronto\nANSWER: A\n"
    result = parse_bank_text(text)
    assert result["layout"] != "aiken" and result["items"][0]["text"] == "What is 2+2?"
