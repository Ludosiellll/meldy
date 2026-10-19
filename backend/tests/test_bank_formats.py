"""Банк вопросов из CSV, HTML, PDF и Moodle XML (bank_formats.py → bank_parse.parse_bank_file).

Файлы — маленькие, собраны в тесте; PDF — из корпуса fixtures/banks/wild (собран без библиотек, с жирным шрифтом
Helvetica-Bold у ключа) и пустая страница — как скан.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import bank_formats  # noqa: E402
from bank_parse import BankError, parse_bank_file, read_key_file  # noqa: E402

WILD = Path(__file__).resolve().parent / "fixtures" / "banks" / "wild" / "files"


def keys(result):
    return [item["correct"] for item in result["items"]]


def options(result):
    return [item["options"] for item in result["items"]]


# ── CSV ─────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("delimiter", [",", ";", "\t"])
def test_csv_with_any_delimiter_quotes_and_a_line_break_in_a_cell(delimiter):
    rows = [["Вопрос", "Вариант 1", "Вариант 2", "Вариант 3", "Ответ"],
            ['Столица, где "Немига"?', "Минск", "Брест", "Гомель", "1"],
            ["Что выведет код?\nprint(2 + 2)", "4", "22", "ошибку", "1"]]

    def cell(value):
        return '"' + value.replace('"', '""') + '"' if any(char in value for char in (delimiter, '"', "\n")) else value

    text = "\r\n".join(delimiter.join(cell(value) for value in row) for row in rows)
    result = parse_bank_file(text.encode("cp1251" if delimiter == ";" else "utf-8"), "bank.csv")
    assert [item["text"] for item in result["items"]] == ['Столица, где "Немига"?', "Что выведет код?\nprint(2 + 2)"]
    assert options(result) == [["Минск", "Брест", "Гомель"], ["4", "22", "ошибку"]] and keys(result) == [[0], [0]]


def test_csv_header_letters_name_the_options_so_a_latin_key_is_not_read_as_cyrillic():
    text = "Вопрос,Вариант A,Вариант B,Вариант C,Ответ\nСтолица?,Минск,Брест,Гомель,B\nРека?,Днепр,Сож,Неман,C\n"
    result = parse_bank_file(text.encode(), "bank.csv")
    assert keys(result) == [[1], [2]] and all("key_letter_ambiguous" not in item["flags"] for item in result["items"])


def test_a_csv_is_also_a_key_file():
    sections = read_key_file("№;Ответ\n1;б\n2;в\n".encode(), "key.csv")
    assert sections[0]["keys"] == {"1": "б", "2": "в"}


# ── HTML ────────────────────────────────────────────────────────────────────────


def html(body: str) -> bytes:
    return f'<html><head><meta charset="utf-8"><style>p{{color:red}}</style><script>alert(1)</script></head><body>{body}</body></html>'.encode()


def test_html_from_word_with_the_key_in_a_style_colour():
    body = ("<p class=MsoNormal><b>1. Столица?</b></p><p class=MsoNormal>а) <span style='color:red'>Минск</span></p>"
            "<p class=MsoNormal>б) Брест</p><p class=MsoNormal><b>2. Река?</b></p><p>а) Днепр</p><p>б) <span style='color:#ff0000'>Сож</span></p>")
    result = parse_bank_file(html(body), "test.html")
    assert options(result) == [["Минск", "Брест"], ["Днепр", "Сож"]] and keys(result) == [[0], [1]]
    assert result["key_source"] == {"color": 2}


def test_html_nested_lists_number_the_questions_and_letter_the_options():
    body = ('<h2>Тема 1. Природа</h2><ol><li><p>Столица?</p><ol type="a"><li>Минск</li><li><strong>Брест</strong></li></ol></li>'
            '<li>Река?<ol type="A"><li><b>Днепр</b></li><li>Сож</li></ol></li></ol>')
    result = parse_bank_file(html(body), "test.htm")
    assert [(item["label"], item["text"]) for item in result["items"]] == [("1", "Столица?"), ("2", "Река?")]
    assert options(result) == [["Минск", "Брест"], ["Днепр", "Сож"]]
    assert keys(result) == [[1], [0]]
    assert [topic["title"] for topic in result["topics"]] == ["Тема 1. Природа"]


def test_html_table_per_question_and_a_saved_quiz_page_with_checked_radios():
    table = ("<table><tr><td>1.</td><td>Столица?</td></tr><tr><td>а)</td><td><b>Минск</b></td></tr><tr><td>б)</td><td>Брест</td></tr>"
             "</table><table><tr><td>2.</td><td>Река?</td></tr><tr><td>а)</td><td>Днепр</td></tr><tr><td>б)</td><td><b>Сож</b></td></tr></table>")
    assert keys(parse_bank_file(html(table), "test.html")) == [[0], [1]]
    radios = ('<div>1. Столица?</div><label><input type="radio" checked> Минск</label><br><label><input type="radio"> Брест</label>'
              '<div>2. Река?</div><label><input type="radio"> Днепр</label><br><label><input type="radio" checked> Сож</label>')
    result = parse_bank_file(html(radios), "quiz.html")
    assert options(result) == [["Минск", "Брест"], ["Днепр", "Сож"]] and keys(result) == [[0], [1]]


def test_html_scripts_styles_and_pictures():
    body = '<p>1. Что на рисунке?</p><p><img src="https://example.com/x.png"></p><p>а) <b>кот</b></p><p>б) пёс</p><script>1. Не вопрос?</script>'
    result = parse_bank_file(html(body), "test.html")
    assert [item["text"] for item in result["items"]] == ["Что на рисунке?"]
    assert "has_image" in result["items"][0]["flags"]  # картинку по ссылке не скачиваем


# ── Moodle XML ──────────────────────────────────────────────────────────────────

MOODLE = """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE quiz [<!ENTITY secret SYSTEM "file:///etc/hostname">]>
<quiz>
<question type="category"><category><text>$course$/Природа</text></category></question>
<question type="multichoice"><questiontext format="html"><text><![CDATA[<p>Столица?</p>]]></text></questiontext>
 <single>true</single><answer fraction="0"><text>Брест</text></answer><answer fraction="100"><text>Минск &secret;</text></answer></question>
<question type="multichoice"><questiontext format="html"><text>Чётные числа:</text></questiontext><single>false</single>
 <answer fraction="50"><text>2</text></answer><answer fraction="-100"><text>3</text></answer><answer fraction="50"><text>4</text></answer></question>
<question type="truefalse"><questiontext><text>Кит — рыба.</text></questiontext>
 <answer fraction="0"><text>true</text></answer><answer fraction="100"><text>false</text></answer></question>
<question type="shortanswer"><questiontext><text>Высочайшая гора?</text></questiontext>
 <answer fraction="100"><text>Эверест</text></answer><answer fraction="100"><text>Джомолунгма</text></answer></question>
<question type="numerical"><questiontext><text>12 × 12?</text></questiontext><answer fraction="100"><text>144</text></answer></question>
<question type="matching"><questiontext><text>Страна — столица.</text></questiontext>
 <subquestion><text>Франция</text><answer><text>Париж</text></answer></subquestion>
 <subquestion><text>Италия</text><answer><text>Рим</text></answer></subquestion></question>
<question type="description"><questiontext><text>Это пояснение, не вопрос.</text></questiontext></question>
<question type="essay"><questiontext><text>Опишите круговорот воды.</text></questiontext></question>
</quiz>"""


def test_moodle_xml_questions_of_every_common_kind_with_answers_from_the_markup():
    result = parse_bank_file(MOODLE.encode(), "quiz.xml")
    items = result["items"]
    assert [item["kind"] for item in items] == ["single", "multiple", "truefalse", "open", "open", "match", "open"]
    assert items[0]["options"] == ["Брест", "Минск"] and items[0]["correct"] == [1]  # сущность из файла не подставлена
    assert items[1]["correct"] == [0, 2] and items[2]["correct"] == [1]
    assert (items[3]["answer"], items[4]["answer"], items[6]["answer"]) == ("Эверест; Джомолунгма", "144", None)
    assert items[5]["pairs"] == [["Франция", "Париж"], ["Италия", "Рим"]]
    assert set(result["key_source"]) == {"gift"} and [topic["title"] for topic in result["topics"]] == ["Природа"]


def test_an_xml_that_is_not_moodle_is_unreadable():
    with pytest.raises(BankError) as raised:
        parse_bank_file("<?xml version='1.0'?><rss><item>1. Вопрос?</item></rss>".encode(), "feed.xml")
    assert raised.value.code == "unreadable"


# ── PDF ─────────────────────────────────────────────────────────────────────────


def test_a_pdf_with_text_is_read_and_its_bold_font_marks_the_key():
    result = parse_bank_file((WILD / "k09_pdf_bold_font_key.pdf").read_bytes(), "bank.pdf")
    assert result["stats"]["items"] == 8 and result["key_source"] == {"bold": 8}
    assert result["items"][0]["text"] == "Какой город является столицей Беларуси?"
    assert result["items"][0]["where"].startswith("строка")


def test_a_pdf_without_text_is_a_scan_with_a_plain_message():
    from test_bank_api import SCAN_PDF  # noqa: E402

    with pytest.raises(BankError) as raised:
        parse_bank_file(SCAN_PDF, "scan.pdf")
    assert (raised.value.status, raised.value.code) == (422, "scan_pdf")
    assert raised.value.detail == "В этом PDF нет текста — это скан. Пришлите Word или текстовый файл."


def test_pdf_pages_are_capped(monkeypatch):
    monkeypatch.setattr(bank_formats, "PDF_MAX_PAGES", 1)
    paras = bank_formats.read_pdf((WILD / "w143_pdf_text_layer.pdf").read_bytes())
    assert sum(1 for para in paras if para.text.strip()) <= 48  # одна страница из двух
