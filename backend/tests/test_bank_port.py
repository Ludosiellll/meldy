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
    real = safe_tree.DefusedXMLParser

    def spy(**kwargs):
        used.append({key: kwargs[key] for key in ("forbid_dtd", "forbid_entities", "forbid_external")})
        return real(**kwargs)

    monkeypatch.setattr(safe_tree, "DefusedXMLParser", spy)
    questions = bank_formats.read_moodle((PORT / "moodle_course_export.xml").read_bytes())
    assert used == [{"forbid_dtd": True, "forbid_entities": True, "forbid_external": True}] and len(questions) == 11


# ── review of r49-port (2026-10-31): time, memory, the prolog only ───────────────


def test_doctype_strip_is_linear_on_adversarial_input():
    """Review #1: «<!DOCTYPE » repeated took 17 s for 100 KB (the regex rescanned from every match, holding the GIL)."""
    import bank_formats

    for unit in (b"<!DOCTYPE ", b"<!DOCTYPE a [", b"<!-- x --><!DOCTYPE "):
        data = b'<?xml version="1.0"?><quiz>' + unit * (200 * 1024 // len(unit))
        started = time.monotonic()
        bank_formats._without_doctype(data)
        assert time.monotonic() - started < 1, unit
    data = b'<?xml version="1.0"?>' + b"<!-- c -->" * 30_000 + b"<quiz/>"  # a long prolog: the scan stops at 64 KB
    started = time.monotonic()
    assert bank_formats._without_doctype(data) == data and time.monotonic() - started < 1
    started = time.monotonic()
    with pytest.raises(BankError):
        parse_bank_file(b'<?xml version="1.0"?><quiz>' + b"<!DOCTYPE " * 20_000, "export.xml")
    assert time.monotonic() - started < 1


def test_cloze_embeds_are_linear_on_escaped_braces():
    """Review #2: every «\\{» started a scan to the end (100 KB took 31 s). The regex skips escaped braces, and a
    cloze text over MAX_CLOZE_TEXT is not read for gaps."""
    import bank_formats

    unit = "\\{1:SA:"
    raw = "{1:SA:" + unit * (200 * 1024 // len(unit))
    started = time.monotonic()
    bank_formats._CLOZE_RE.sub("", raw)  # the regex alone, past the size cap
    bank_formats._cloze_embeds(raw)
    assert time.monotonic() - started < 1
    assert bank_formats._cloze_embeds(raw) == (raw, [])  # too long for a cloze: an open question, as before
    text, embeds = bank_formats._cloze_embeds("Цена \\{1:SA:=x} и {1:SA:=Берлин}.")
    assert embeds == [("SA", [(100.0, "Берлин")])] and text.startswith("Цена \\{1:SA:=x} и ")
    data = ('<?xml version="1.0" encoding="UTF-8"?>\n<quiz><question type="cloze"><questiontext format="html"><text>'
            + raw[:60_000] + "</text></questiontext></question></quiz>").encode()
    started = time.monotonic()
    assert parse_bank_file(data, "export.xml")["items"][0]["kind"] == "open"
    assert time.monotonic() - started < 1


def test_only_the_prologs_doctype_is_removed_not_one_in_question_text():
    """Review #7: «What does <!DOCTYPE html> declare?» lost its words. Only the prolog is touched now."""
    import bank_formats

    doc = (b'<?xml version="1.0" encoding="UTF-8"?>\n<quiz>\n<question type="multichoice"><questiontext format="html"><text>'
           b"<![CDATA[<p>What does &lt;!DOCTYPE html&gt; declare?</p><!DOCTYPE x>]]></text></questiontext>"
           b'<answer fraction="100"><text>HTML5</text></answer><answer fraction="0"><text>XHTML</text></answer></question></quiz>')
    assert bank_formats._without_doctype(doc) == doc
    assert bank_formats.read_moodle(doc)[0].text == "What does <!DOCTYPE html> declare?"
    prolog = b'\xef\xbb\xbf<?xml version="1.0"?>\n<!-- export -->\n<!DOCTYPE quiz [<!ENTITY a "b">]>\n<quiz/>'
    assert bank_formats._without_doctype(prolog) == b'\xef\xbb\xbf<?xml version="1.0"?>\n<!-- export -->\n\n<quiz/>'
    assert bank_formats._without_doctype(b'<!DOCTYPE quiz SYSTEM "x.dtd"><quiz/>') == b"<quiz/>"


def test_a_file_nested_too_deep_is_refused_fast():
    """Review #8: a 12 MB deeply nested file took 633 MB in the defusedxml tree. Deeper than MAX_XML_DEPTH — unreadable."""
    import bank_formats

    n = 300_000
    data = b'<?xml version="1.0"?><quiz>' + b"<a>" * n + b"</a>" * n + b"</quiz>"
    started = time.monotonic()
    with pytest.raises(bank_formats.XmlTooDeep):
        bank_formats.read_moodle(data)
    with pytest.raises(BankError) as raised:
        parse_bank_file(data, "deep.xml")
    assert raised.value.code == "unreadable" and time.monotonic() - started < 2
    ok = ('<?xml version="1.0"?><quiz>' + "<a>" * 200 + "</a>" * 200
          + '<question type="essay"><questiontext><text>Глубоко?</text></questiontext></question></quiz>').encode()
    assert [q.text for q in bank_formats.read_moodle(ok)] == ["Глубоко?"]  # 200 levels are still read
    flat = b'<?xml version="1.0"?><quiz>' + b"<a/>" * (bank_formats.MAX_XML_ELEMENTS + 10) + b"</quiz>"
    started = time.monotonic()
    with pytest.raises(bank_formats.XmlTooBig):
        bank_formats.read_moodle(flat)
    assert time.monotonic() - started < 2


def test_entities_files_and_the_network_are_never_reached(tmp_path):
    """The review's crafted files: an external entity, a parameter entity, an external DTD and a URL, each after a
    5 KB comment (past the old 4 KB head) or right after the declaration, and «]>» inside an entity value."""
    import socket
    import threading

    secret = tmp_path / "secret.txt"
    secret.write_text("SECRET_HOST_CONTENT_12345")
    dtd = tmp_path / "evil.dtd"
    dtd.write_text('<!ENTITY leaked "PARAM_DTD_LOADED">')
    server = socket.socket()
    server.bind(("127.0.0.1", 0))
    server.listen(5)
    server.settimeout(0.5)
    port = server.getsockname()[1]
    hits = []

    def serve():
        try:
            while True:
                conn, _ = server.accept()
                hits.append(conn.recv(100))
                conn.close()
        except OSError:
            pass

    thread = threading.Thread(target=serve, daemon=True)
    thread.start()
    pad = "<!-- <quiz> " + "x" * 5000 + " -->"
    question = '<quiz><question type="essay"><questiontext><text>A&x;B &leaked;</text></questiontext></question></quiz>'
    heads = [
        f'<!DOCTYPE quiz [<!ENTITY x SYSTEM "file://{secret}">]>',
        f'<!DOCTYPE quiz [<!ENTITY % p SYSTEM "file://{dtd}"> %p;]>',
        f'<!DOCTYPE quiz SYSTEM "file://{dtd}">',
        f'<!DOCTYPE quiz [<!ENTITY x SYSTEM "http://127.0.0.1:{port}/ent">]>',
        f'<!DOCTYPE quiz SYSTEM "http://127.0.0.1:{port}/dtd">',
        f'<!DOCTYPE quiz [<!ENTITY y "]>"><!ENTITY x SYSTEM "file://{secret}">]>',
    ]
    for head in heads:
        for before in ("", pad):
            data = f'<?xml version="1.0"?>{before}{head}{question}'.encode()
            try:
                result = parse_bank_file(data, "quiz.xml")
            except BankError:
                continue
            text = str(result)
            assert "SECRET_HOST" not in text and "PARAM_DTD_LOADED" not in text, head
    server.close()
    thread.join(timeout=2)
    assert hits == []


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
