"""Раскладки, которые разбор узнаёт после «дикого» корпуса (fixtures/banks/wild, bank_eval.py): по тесту на раскладку.

Нумерация «№1.», «Q1.», «Question 1.», «Пытанне 1.», римская, «1 – …», «Вопрос 3» строкой над текстом; вопросы без
номеров подряд; варианты строкой под вопросом, по два в строке, «a<tab>…»; отметки перед вариантом («+в)», «*в)», «☑/☐»,
«[x]», «- [x]»); ключ по вариантам в самом файле; колонтитулы и подписи; «(Ответ: б)» в строке вопроса; подсказка
«Выберите один правильный ответ:»; страница попытки Moodle. И что прежнее не сломано: ключ «1 – б» остаётся ключом.
"""
import io
import sys
from pathlib import Path

import pytest
from docx import Document

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bank_parse import parse_bank_file, parse_bank_text  # noqa: E402

OPTIONS = "а) Минск\nб) **Гомель**\nв) Брест\n"


def stems(result):
    return [item["text"] for item in result["items"]]


def keys(result):
    return [item["correct"] for item in result["items"]]


@pytest.mark.parametrize("first, second", [
    ("№1. Первый вопрос?", "№2. Второй вопрос?"),
    ("№ 1 Первый вопрос?", "№ 2 Второй вопрос?"),
    ("Q1. Первый вопрос?", "Q2. Второй вопрос?"),
    ("Question 1. Первый вопрос?", "Question 2. Второй вопрос?"),
    ("Пытанне 1. Первый вопрос?", "Пытанне 2. Второй вопрос?"),
    ("I. Первый вопрос?", "II. Второй вопрос?"),
    ("1 – Первый вопрос?", "2 – Второй вопрос?"),
])
def test_question_numbers_with_words_signs_roman_numerals_and_dashes(first, second):
    result = parse_bank_text(f"{first}\n{OPTIONS}{second}\n{OPTIONS}")
    assert stems(result) == ["Первый вопрос?", "Второй вопрос?"]
    assert [item["label"] for item in result["items"]] == ["1", "2"]
    assert keys(result) == [[1], [1]]


def test_roman_numbers_go_on_past_three():
    text = "".join(f"{numeral}. Вопрос {n}?\n{OPTIONS}" for n, numeral in enumerate(["I", "II", "III", "IV", "V", "VI", "IX"], 1))
    assert [item["label"] for item in parse_bank_text(text)["items"]] == ["1", "2", "3", "4", "5", "6", "9"]


@pytest.mark.parametrize("blank", ["", "\n"])
def test_a_question_number_on_its_own_line_heads_the_text_below_it(blank):
    text = f"Вопрос 1\nПервый вопрос?\n{OPTIONS}{blank}Вопрос №2\nВторой вопрос?\n1) раз\n2) два\n{blank}"
    result = parse_bank_text(text + "Ответы: 1-б, 2-2")
    assert stems(result) == ["Первый вопрос?", "Второй вопрос?"]
    assert [item["options"] for item in result["items"]] == [["Минск", "Гомель", "Брест"], ["раз", "два"]]
    assert keys(result) == [[1], [1]]


def test_questions_without_numbers_follow_each_other_without_blank_lines():
    result = parse_bank_text(f"Первый вопрос?\n{OPTIONS}Второй вопрос?\n{OPTIONS}Третий вопрос?\n{OPTIONS}")
    assert stems(result) == ["Первый вопрос?", "Второй вопрос?", "Третий вопрос?"]
    assert keys(result) == [[1], [1], [1]]


def test_a_number_with_a_dash_is_not_taken_from_a_key_line():
    result = parse_bank_text(f"1. Первый вопрос?\n{OPTIONS}2. Второй вопрос?\n{OPTIONS}\nОтветы:\n1 – а\n2 – в")
    assert stems(result) == ["Первый вопрос?", "Второй вопрос?"]


def test_options_on_one_line_under_the_question_with_semicolons_or_tabs():
    result = parse_bank_text("1. Столица?\nа) Минск; б) Гомель; в) Брест\n2. Река?\nа) Днепр\tб) Сож\tв) Неман\nОтветы: 1-а, 2-в")
    assert [item["options"] for item in result["items"]] == [["Минск", "Гомель", "Брест"], ["Днепр", "Сож", "Неман"]]
    assert keys(result) == [[0], [2]]


def test_options_two_per_line_are_read_in_letter_order():
    text = "1. Сколько?\nа) 180\t\tв) 360\nб) 270\t\tг) 400\n\n2. Где?\nа) тут  в) там\nб) здесь  г) нигде\n\nОтветы: 1в, 2а"
    result = parse_bank_text(text)
    assert [item["options"] for item in result["items"]] == [["180", "270", "360", "400"], ["тут", "здесь", "там", "нигде"]]
    assert keys(result) == [[2], [0]]


def test_a_letter_and_a_tab_label_an_option():
    result = parse_bank_text("1. Capital?\na\tToronto\nb\t**Ottawa**\nc\tMontreal\n2. Planet?\na\tVenus\nb\t**Mercury**\nc\tMars")
    assert [item["options"] for item in result["items"]] == [["Toronto", "Ottawa", "Montreal"], ["Venus", "Mercury", "Mars"]]
    assert keys(result) == [[1], [1]]


@pytest.mark.parametrize("marked, plain", [("+в) ", "{}) "), ("*в) ", "{}) "), ("☑ в) ", "☐ {}) "), ("[x] ", "[ ] "),
                                           ("- [x] ", "- [ ] ")])
def test_a_mark_before_the_option_is_the_key(marked, plain):
    def option(letter, text):
        return (marked if letter == "в" else plain.format(letter)) + text

    lines = []
    for n in (1, 2):
        lines.append(f"{n}. Вопрос {n}?")
        lines += [option(letter, f"вариант {letter}") for letter in "абвг"]
    result = parse_bank_text("\n".join(lines))
    assert [item["options"] for item in result["items"]] == [["вариант а", "вариант б", "вариант в", "вариант г"]] * 2
    assert keys(result) == [[2], [2]]
    assert set(result["key_source"]) == {"checkbox"}


def test_markdown_task_list_options_under_a_question_without_a_question_mark():
    result = parse_bank_file("1. Отметьте хвойные.\n   - [x] сосна\n   - [ ] берёза\n   - [x] ель\n".encode(), "test.md")
    assert result["items"][0]["options"] == ["сосна", "берёза", "ель"]
    assert result["items"][0]["correct"] == [0, 2] and result["items"][0]["kind"] == "multiple"


def test_keys_of_two_variants_in_one_file_go_to_their_own_variant():
    body = "Вариант 1\n1. Вопрос А?\nа) да\nб) нет\n2. Вопрос Б?\nа) да\nб) нет\n\nВариант 2\n1. Вопрос В?\nа) да\nб) нет\n" \
           "2. Вопрос Г?\nа) да\nб) нет\n\nОтветы\nВариант 1: 1а, 2б\nВариант 2: 1б, 2а\n"
    result = parse_bank_text(body)
    assert keys(result) == [[0], [1], [1], [0]]
    assert [(s["title"], s["evidence"]) for s in result["subjects"]] == [("Вариант 1", "restart"), ("Вариант 2", "restart")]
    one_key = body.replace("Вариант 2: 1б, 2а\n", "")
    assert keys(parse_bank_text(one_key)) == [[0], [1], [], []]  # ключ варианта 1 не достаётся варианту 2


def test_a_key_table_with_a_column_per_variant_inside_the_test_file():
    doc = Document()
    for variant in (1, 2):
        doc.add_paragraph(f"Вариант {variant}")
        for n in (1, 2):
            doc.add_paragraph(f"{n}. Вопрос {variant}.{n}?")
            doc.add_paragraph("а) да")
            doc.add_paragraph("б) нет")
    doc.add_paragraph("Ключ")
    table = doc.add_table(rows=3, cols=3)
    for r, row in enumerate([["№", "Вариант 1", "Вариант 2"], ["1", "а", "б"], ["2", "б", "а"]]):
        for c, text in enumerate(row):
            table.cell(r, c).text = text
    buffer = io.BytesIO()
    doc.save(buffer)
    assert keys(parse_bank_file(buffer.getvalue(), "bank.docx")) == [[0], [1], [1], [0]]


def test_page_furniture_and_signatures_do_not_stick_to_the_last_option():
    text = ("Тест по естествознанию для 9 класса\n\n1. Вопрос один?\nа) раз\nб) два\n\n2\nТест по естествознанию для 9 класса\n\n"
            "в) три\n2. Вопрос два?\nа) раз\nб) два\n\nСтраница 1 из 3\n\n3. Вопрос три?\nа) раз\nб) два\n\n"
            "Составитель: преподаватель ________ П. П. Петров\n")
    result = parse_bank_text(text)
    assert [item["options"] for item in result["items"]] == [["раз", "два", "три"], ["раз", "два"], ["раз", "два"]]


def test_an_answer_in_brackets_at_the_end_of_the_question_line_is_its_key():
    result = parse_bank_text("1. Кто написал «Бородино»? (Ответ: б)\nа) Пушкин\nб) Лермонтов\n2. Сколько? (правильный ответ — а)\nа) 1\nб) 2")
    assert stems(result) == ["Кто написал «Бородино»?", "Сколько?"]
    assert keys(result) == [[1], [0]] and result["key_source"] == {"answer_line": 2}


def test_choose_one_hint_is_not_part_of_the_question():
    result = parse_bank_text("Задание №1. Какой прибор измеряет давление?\nВыберите один правильный ответ:\nа) термометр\nб) **барометр**")
    assert stems(result) == ["Какой прибор измеряет давление?"] and keys(result) == [[1]]


def test_a_moodle_attempt_review_page_copied_as_text():
    lines = []
    for n, (stem, options, right) in enumerate([("Какой газ преобладает?", ["кислород", "азот"], "азот"),
                                                ("Сколько планет?", ["8", "9"], "8")], start=1):
        lines += [f"Вопрос {n}", "Верно", "Баллов: 1,00 из 1,00", "Отметить вопрос", "Текст вопроса", stem, "Выберите один ответ:"]
        lines += [f"{'abcd'[k]}. {option}" for k, option in enumerate(options)]
        lines += ["Отзыв", f"Правильный ответ: {right}"]
    result = parse_bank_text("\n".join(lines))
    assert stems(result) == ["Какой газ преобладает?", "Сколько планет?"]
    assert [item["options"] for item in result["items"]] == [["кислород", "азот"], ["8", "9"]]
    assert keys(result) == [[1], [0]]


# ── Таблицы, надписи, Markdown, формы ───────────────────────────────────────────


def docx_of(build) -> bytes:
    doc = Document()
    build(doc)
    buffer = io.BytesIO()
    doc.save(buffer)
    return buffer.getvalue()


def fill(table, rows, bold=()):
    for r, row in enumerate(rows):
        for c, text in enumerate(row):
            run = table.cell(r, c).paragraphs[0].add_run(text)
            run.bold = (r, c) in bold


def test_options_in_columns_without_a_header_and_a_key_column_of_letters():
    rows = [["1", "Столица?", "Минск", "Гомель", "Брест", "Витебск", "а"], ["2", "Река?", "Днепр", "Сож", "Неман", "Припять", "в"],
            ["3", "Озеро?", "Нарочь", "Освея", "Дривяты", "Лукомльское", "а"]]
    result = parse_bank_file(docx_of(lambda doc: fill(doc.add_table(rows=3, cols=7), rows)), "bank.docx")
    assert [item["options"] for item in result["items"]] == [row[2:6] for row in rows]
    assert keys(result) == [[0], [2], [0]] and result["key_source"] == {"key_column": 3}


def test_a_plus_in_the_key_column_marks_the_option_of_its_row():
    def build(doc):
        rows = [["№", "Вопрос", "Вариант", "Верный"], ["1", "Столица?", "Минск", "+"], ["", "", "Гомель", ""],
                ["2", "Река?", "Днепр", ""], ["", "", "Сож", "+"]]
        table = doc.add_table(rows=5, cols=4)
        fill(table, rows)
        for r in (1, 3):  # № и вопрос объединены вниз
            for c in (0, 1):
                table.cell(r, c).merge(table.cell(r + 1, c))

    result = parse_bank_file(docx_of(build), "bank.docx")
    assert [item["options"] for item in result["items"]] == [["Минск", "Гомель"], ["Днепр", "Сож"]]
    assert keys(result) == [[0], [1]] and "key_invalid" not in result["items"][0]["flags"]


def test_one_small_table_per_question_with_letters_in_the_first_column():
    def build(doc):
        for n, stem in ((1, "Столица?"), (2, "Река?")):
            fill(doc.add_table(rows=3, cols=2), [[f"{n}.", stem], ["а)", "один"], ["б)", "два"]], bold={(2, 1)})
            doc.add_paragraph("")

    result = parse_bank_file(docx_of(build), "bank.docx")
    assert stems(result) == ["Столица?", "Река?"] and keys(result) == [[1], [1]]


def test_statements_with_a_yes_no_answer_column_are_open_questions_with_answers():
    rows = [["№", "Утверждение", "Ответ (да/нет)"], ["1", "Вода кипит при 100 °C.", "да"], ["2", "Кит — рыба.", "нет"]]
    result = parse_bank_file(docx_of(lambda doc: fill(doc.add_table(rows=3, cols=3), rows)), "bank.docx")
    assert [(item["kind"], item["answer"]) for item in result["items"]] == [("open", "да"), ("open", "нет")]


@pytest.mark.parametrize("columns", [1, 2])
def test_a_table_used_as_page_layout_is_read_as_paragraphs(columns):
    def questions(start):
        return [line for n in (start, start + 1) for line in (f"{n}. Вопрос номер {n}?", "а) да", "б) нет")]

    def build(doc):
        table = doc.add_table(rows=1 if columns == 2 else 2, cols=columns)
        cells = [table.cell(0, 0), table.cell(0, 1)] if columns == 2 else [table.cell(0, 0), table.cell(1, 0)]
        for cell, start in zip(cells, (1, 3)):
            for k, line in enumerate(questions(start)):
                paragraph = cell.paragraphs[0] if k == 0 else cell.add_paragraph()
                paragraph.add_run(line).bold = line == "б) нет"

    result = parse_bank_file(docx_of(build), "bank.docx")
    assert stems(result) == [f"Вопрос номер {n}?" for n in range(1, 5)] and keys(result) == [[1]] * 4


W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def text_box(paragraph, lines):
    from xml.sax.saxutils import escape

    from docx.oxml import parse_xml

    inner = "".join(f'<w:p><w:r><w:t xml:space="preserve">{escape(line)}</w:t></w:r></w:p>' for line in lines)
    paragraph._p.append(parse_xml(f'<w:r xmlns:w="{W_NS}" xmlns:v="urn:schemas-microsoft-com:vml"><w:pict><v:shape '
                                  f'type="#_x0000_t202"><v:textbox><w:txbxContent>{inner}</w:txbxContent></v:textbox></v:shape>'
                                  "</w:pict></w:r>"))


def test_questions_in_text_boxes_are_read_and_a_labelled_diagram_is_not():
    def build(doc):
        doc.add_paragraph("Тест")
        text_box(doc.add_paragraph(), ["1. Первый вопрос?", "а) да", "б) нет", "2. Второй вопрос?", "а) да", "б) нет"])
        text_box(doc.add_paragraph(), ["3. Третий вопрос?", "а) да", "б) нет"])
        doc.add_paragraph("4. Что на схеме?")
        text_box(doc.add_paragraph(), ["Вход", "Выход"])  # подписи схемы, а не вопросы
        doc.add_paragraph("а) цикл")
        doc.add_paragraph("б) ветвление")

    result = parse_bank_file(docx_of(build), "bank.docx")
    assert stems(result) == ["Первый вопрос?", "Второй вопрос?", "Третий вопрос?", "Что на схеме?"]
    assert result["items"][3]["options"] == ["цикл", "ветвление"] and "has_image" in result["items"][3]["flags"]
    assert all("has_image" not in item["flags"] for item in result["items"][:3])


def test_markdown_headings_are_topics_only_in_a_markdown_file():
    text = "## Тема 1. Природа\n\n1. Вопрос?\nа) **да**\nб) нет\n\n## Тема 2. Город\n\n2. Вопрос два?\nа) да\nб) **нет**\n"
    result = parse_bank_file(text.encode(), "test.md")
    assert [topic["title"] for topic in result["topics"]] == ["Тема 1. Природа", "Тема 2. Город"]
    assert [item["options"] for item in result["items"]] == [["да", "нет"], ["да", "нет"]] and keys(result) == [[0], [1]]
    code = "1. Что выведет код?\n# comment\nprint(1)\nа) 1\nб) 2\n"
    assert parse_bank_file(code.encode(), "test.txt")["items"][0]["text"] == "Что выведет код?\n# comment\nprint(1)"


def test_a_google_form_with_answers_copied_as_text():
    text = ("Тест по природе\nВсего баллов: 1/2\n* Обязательно\n\nКакой материк самый большой? *\n1/1\nАфрика\nЕвразия\n"
            "Правильный ответ\nЕвразия\n\nКакая планета красная? *\n0/1\nВенера\nМарс\nПравильный ответ\nМарс\n")
    result = parse_bank_text(text)
    assert stems(result) == ["Какой материк самый большой?", "Какая планета красная?"]
    assert [item["options"] for item in result["items"]] == [["Африка", "Евразия"], ["Венера", "Марс"]] and keys(result) == [[1], [1]]


def test_numbered_lines_with_blanks_under_an_instruction_are_questions_not_options():
    text = "Вставьте пропущенное слово.\n1. Столица Франции — ______.\n2. Вода — это H2O и ______.\n3. Мы живём на ______.\n\n" \
           "Ответы:\n1 – Париж\n2 – вода\n3 – Земле"
    result = parse_bank_text(text)
    assert [(item["kind"], item["answer"]) for item in result["items"]] == [("open", "Париж"), ("open", "вода"), ("open", "Земле")]


def test_a_numbered_section_over_its_sub_numbered_questions_is_a_topic():
    text = "1. Природа\n1.1. Вопрос один?\nа) да\nб) **нет**\n2. Человек\n2.1. Вопрос два?\nа) **да**\nб) нет\n"
    result = parse_bank_text(text)
    assert [topic["title"] for topic in result["topics"]] == ["1. Природа", "2. Человек"]
    assert [item["options"] for item in result["items"]] == [["да", "нет"], ["да", "нет"]]
