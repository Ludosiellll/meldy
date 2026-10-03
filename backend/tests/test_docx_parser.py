import io
import sys
from pathlib import Path

import pytest
from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from parser import extract_text  # noqa: E402


def docx_bytes(doc) -> bytes:
    buffer = io.BytesIO()
    doc.save(buffer)
    return buffer.getvalue()


def extract(doc) -> list[str]:
    return extract_text(docx_bytes(doc), "Вопросы.docx").split("\n")


_next_abstract = [900]


def add_list(
    doc,
    formats: list[str],
    *,
    start_override: int | None = None,
    texts: list[str | None] | None = None,
    legal: frozenset[int] = frozenset(),
    override_text: str | None = None,
) -> str:
    """Новое определение списка: уровни с форматами formats; возвращает numId.

    texts — шаблоны w:lvlText по уровням (None — без шаблона), legal — уровни с w:isLgl,
    override_text — шаблон уровня 0 в lvlOverride самого numId.
    """
    numbering = doc.part.numbering_part.element
    _next_abstract[0] += 1
    abstract_id = str(_next_abstract[0])
    abstract = OxmlElement("w:abstractNum")
    abstract.set(qn("w:abstractNumId"), abstract_id)
    for level, fmt in enumerate(formats):
        lvl = OxmlElement("w:lvl")
        lvl.set(qn("w:ilvl"), str(level))
        start = OxmlElement("w:start")
        start.set(qn("w:val"), "1")
        num_fmt = OxmlElement("w:numFmt")
        num_fmt.set(qn("w:val"), fmt)
        lvl.append(start)
        lvl.append(num_fmt)
        if level in legal:
            lvl.append(OxmlElement("w:isLgl"))
        if texts is not None and level < len(texts) and texts[level] is not None:
            lvl_text = OxmlElement("w:lvlText")
            lvl_text.set(qn("w:val"), texts[level])
            lvl.append(lvl_text)
        abstract.append(lvl)
    first_num = numbering.find(qn("w:num"))
    if first_num is not None:
        first_num.addprevious(abstract)  # abstractNum должны идти до num
    else:
        numbering.append(abstract)
    num_id = str(max([int(n.get(qn("w:numId"))) for n in numbering.findall(qn("w:num"))] + [0]) + 1)
    num = OxmlElement("w:num")
    num.set(qn("w:numId"), num_id)
    ref = OxmlElement("w:abstractNumId")
    ref.set(qn("w:val"), abstract_id)
    num.append(ref)
    if start_override is not None or override_text is not None:
        override = OxmlElement("w:lvlOverride")
        override.set(qn("w:ilvl"), "0")
        if start_override is not None:
            start = OxmlElement("w:startOverride")
            start.set(qn("w:val"), str(start_override))
            override.append(start)
        if override_text is not None:
            lvl = OxmlElement("w:lvl")
            lvl.set(qn("w:ilvl"), "0")
            lvl_text = OxmlElement("w:lvlText")
            lvl_text.set(qn("w:val"), override_text)
            lvl.append(lvl_text)
            override.append(lvl)
        num.append(override)
    numbering.append(num)
    return num_id


def numbered(paragraph, num_id: str, level: int = 0):
    p_pr = paragraph._p.get_or_add_pPr()
    num_pr = OxmlElement("w:numPr")
    ilvl = OxmlElement("w:ilvl")
    ilvl.set(qn("w:val"), str(level))
    num = OxmlElement("w:numId")
    num.set(qn("w:val"), num_id)
    num_pr.append(ilvl)
    num_pr.append(num)
    p_pr.append(num_pr)
    return paragraph


def test_document_order_tables_and_list_number_style():
    doc = Document()
    doc.add_paragraph("Вопросы к экзамену по макроэкономике")
    doc.add_paragraph("Раздел 1. Введение")
    table = doc.add_table(rows=3, cols=2)
    for row, (number, question) in enumerate([("№", "Вопрос"), ("1", "Предмет и метод макроэкономики."), ("2", "Система национальных счетов.")]):
        table.cell(row, 0).text = number
        table.cell(row, 1).text = question
    doc.add_paragraph("Раздел 2. Деньги")
    doc.add_paragraph("Денежный рынок и его структура", style="List Number")
    doc.add_paragraph("Спрос на деньги", style="List Number")
    doc.add_paragraph("Примечание без номера", style="List Bullet")
    doc.add_paragraph("Конец списка")

    assert extract(doc) == [
        "Вопросы к экзамену по макроэкономике",
        "Раздел 1. Введение",
        "№ | Вопрос",
        "1 | Предмет и метод макроэкономики.",
        "2 | Система национальных счетов.",
        "Раздел 2. Деньги",
        "1. Денежный рынок и его структура",
        "2. Спрос на деньги",
        "Примечание без номера",
        "Конец списка",
    ]


def test_merged_cells_are_written_once_and_empty_cells_skipped():
    doc = Document()
    table = doc.add_table(rows=3, cols=3)
    table.cell(0, 0).text = "Билет № 1"
    table.cell(0, 0).merge(table.cell(0, 2))  # по горизонтали
    table.cell(1, 0).text = "Раздел 1"
    table.cell(1, 0).merge(table.cell(2, 0))  # по вертикали
    table.cell(1, 1).text = "1"
    table.cell(1, 2).text = "Предмет макроэкономики"
    table.cell(2, 1).text = "21"
    table.cell(2, 2).text = "Инфляция"
    assert extract(doc) == [
        "Билет № 1",
        "Раздел 1 | 1 | Предмет макроэкономики",
        "21 | Инфляция",
    ]


def test_cell_text_is_one_line():
    doc = Document()
    table = doc.add_table(rows=1, cols=2)
    table.cell(0, 0).text = "5"
    cell = table.cell(0, 1)
    cell.paragraphs[0].text = "Денежно-кредитная политика:"
    cell.add_paragraph("цели и инструменты")
    run = cell.paragraphs[0].add_run()
    run.add_break()
    assert extract(doc) == ["5 | Денежно-кредитная политика: цели и инструменты"]


def test_auto_numbered_cells_and_direct_numbering():
    doc = Document()
    num_id = add_list(doc, ["decimal"])
    table = doc.add_table(rows=2, cols=2)
    for row, question in enumerate(["Предмет и метод макроэкономики.", "ВВП и способы его измерения."]):
        numbered(table.cell(row, 0).paragraphs[0], num_id)  # номер ставит Word, текста в ячейке нет
        table.cell(row, 1).text = question
    assert extract(doc) == ["1. | Предмет и метод макроэкономики.", "2. | ВВП и способы его измерения."]


def test_levels_counters_and_restart():
    doc = Document()
    outline = add_list(doc, ["decimal", "decimal", "bullet"])
    numbered(doc.add_paragraph("Деньги"), outline, 0)
    numbered(doc.add_paragraph("Функции денег"), outline, 1)
    numbered(doc.add_paragraph("Денежные агрегаты"), outline, 1)
    numbered(doc.add_paragraph("маркер внутри"), outline, 2)
    numbered(doc.add_paragraph("Инфляция"), outline, 0)
    numbered(doc.add_paragraph("Виды инфляции"), outline, 1)
    other = add_list(doc, ["decimal"])
    numbered(doc.add_paragraph("Отдельный список"), other)
    continued = add_list(doc, ["decimalZero"], start_override=21)
    numbered(doc.add_paragraph("Двадцать первый вопрос"), continued)
    numbered(doc.add_paragraph("Двадцать второй вопрос"), continued)
    assert extract(doc) == [
        "1. Деньги",
        "1) Функции денег",
        "2) Денежные агрегаты",
        "маркер внутри",
        "2. Инфляция",
        "1) Виды инфляции",
        "1. Отдельный список",
        "21. Двадцать первый вопрос",
        "22. Двадцать второй вопрос",
    ]


def test_multilevel_labels_follow_the_level_text_like_word():
    # Список кафедры «1. / 1.1. / 1.2.»: метки вопросов должны совпасть с распечаткой.
    doc = Document()
    outline = add_list(doc, ["decimal", "decimal"], texts=["%1.", "%1.%2."])
    numbered(doc.add_paragraph("Введение"), outline, 0)
    numbered(doc.add_paragraph("Предмет и метод макроэкономики."), outline, 1)
    numbered(doc.add_paragraph("Система национальных счетов."), outline, 1)
    numbered(doc.add_paragraph("Деньги"), outline, 0)
    numbered(doc.add_paragraph("Функции денег."), outline, 1)
    numbered(doc.add_paragraph("Денежные агрегаты."), outline, 1)
    assert extract(doc) == [
        "1. Введение",
        "1.1. Предмет и метод макроэкономики.",
        "1.2. Система национальных счетов.",
        "2. Деньги",
        "2.1. Функции денег.",
        "2.2. Денежные агрегаты.",
    ]


def test_level_text_with_words_brackets_and_an_override():
    doc = Document()
    worded = add_list(doc, ["decimal"], texts=["Вопрос %1."])
    numbered(doc.add_paragraph("Рынок труда"), worded)
    numbered(doc.add_paragraph("Инфляция"), worded)
    bracket = add_list(doc, ["decimal", "decimal"], texts=["%1)", "(%2)"])
    numbered(doc.add_paragraph("Спрос на деньги"), bracket, 0)
    numbered(doc.add_paragraph("Мотивы спроса"), bracket, 1)
    overridden = add_list(doc, ["decimal"], texts=["%1."], start_override=7, override_text="№ %1.")
    numbered(doc.add_paragraph("Бюджет"), overridden)
    assert extract(doc) == [
        "Вопрос 1. Рынок труда",
        "Вопрос 2. Инфляция",
        "1) Спрос на деньги",
        "(1) Мотивы спроса",
        "№ 7. Бюджет",
    ]


def test_level_text_falls_back_when_it_needs_a_non_decimal_level():
    doc = Document()
    # Верхний уровень римскими цифрами: «I.1.» в метку вопроса не годится.
    roman = add_list(doc, ["upperRoman", "decimal"], texts=["%1.", "%1.%2."])
    numbered(doc.add_paragraph("Раздел без номера в тексте"), roman, 0)
    numbered(doc.add_paragraph("Первый вопрос раздела"), roman, 1)
    # isLgl: Word пишет все уровни арабскими цифрами, и шаблон снова годится.
    legal = add_list(doc, ["upperRoman", "decimal"], texts=["%1.", "%1.%2."], legal=frozenset({1}))
    numbered(doc.add_paragraph("Раздел"), legal, 0)
    numbered(doc.add_paragraph("Вопрос по закону"), legal, 1)
    # Список начат сразу со второго уровня: ещё не начатый первый уровень — его start.
    nested_first = add_list(doc, ["decimal", "decimal"], texts=["%1.", "%1.%2."])
    numbered(doc.add_paragraph("Сразу вложенный"), nested_first, 1)
    # Пустой шаблон Word показывает без номера.
    hidden = add_list(doc, ["decimal"], texts=[""])
    numbered(doc.add_paragraph("Номер скрыт"), hidden)
    assert extract(doc) == [
        "Раздел без номера в тексте",
        "1) Первый вопрос раздела",
        "Раздел",
        "1.1. Вопрос по закону",
        "1.1. Сразу вложенный",
        "Номер скрыт",
    ]


def test_bullets_letters_and_removed_numbering_get_no_number():
    doc = Document()
    letters = add_list(doc, ["lowerLetter"])
    numbered(doc.add_paragraph("буквенный пункт"), letters)
    doc.add_paragraph("маркированный пункт", style="List Bullet")
    plain = doc.add_paragraph("стиль списка, номер снят", style="List Number")
    numbered(plain, "0")
    doc.add_paragraph("Первый настоящий", style="List Number")
    assert extract(doc) == ["буквенный пункт", "маркированный пункт", "стиль списка, номер снят", "1. Первый настоящий"]


def test_list_number_style_name_is_a_fallback_without_numbering_definition():
    doc = Document()
    style = doc.styles["List Number"]
    p_pr = style.element.find(qn("w:pPr"))
    p_pr.remove(p_pr.find(qn("w:numPr")))  # стиль без numPr, как у некоторых генераторов
    doc.add_paragraph("Первый вопрос", style="List Number")
    doc.add_paragraph("Второй вопрос", style="List Number")
    assert extract(doc) == ["1. Первый вопрос", "2. Второй вопрос"]


def test_empty_numbered_paragraph_advances_the_counter_like_word():
    doc = Document()
    doc.add_paragraph("Первый", style="List Number")
    doc.add_paragraph("", style="List Number")
    doc.add_paragraph("Третий", style="List Number")
    assert extract(doc) == ["1. Первый", "3. Третий"]


def test_tracked_changes_hyperlinks_and_content_controls():
    doc = Document()
    paragraph = doc.add_paragraph("Рынок ")
    inserted = OxmlElement("w:ins")
    inserted.set(qn("w:id"), "1")
    inserted.set(qn("w:author"), "Кафедра")
    run = OxmlElement("w:r")
    text = OxmlElement("w:t")
    text.text = "труда"
    run.append(text)
    inserted.append(run)
    paragraph._p.append(inserted)
    deleted = OxmlElement("w:del")
    deleted.set(qn("w:id"), "2")
    deleted.set(qn("w:author"), "Кафедра")
    del_run = OxmlElement("w:r")
    del_text = OxmlElement("w:delText")
    del_text.text = " и капитала"
    del_run.append(del_text)
    deleted.append(del_run)
    paragraph._p.append(deleted)

    linked = doc.add_paragraph("См. ")
    hyperlink = OxmlElement("w:hyperlink")
    link_run = OxmlElement("w:r")
    link_text = OxmlElement("w:t")
    link_text.text = "программу курса"
    link_run.append(link_text)
    hyperlink.append(link_run)
    linked._p.append(hyperlink)

    sdt = OxmlElement("w:sdt")
    content = OxmlElement("w:sdtContent")
    inner = doc.add_paragraph("Вопрос из поля формы")._p
    content.append(inner)  # переносим абзац внутрь элемента управления содержимым
    sdt.append(content)
    doc.element.body.insert(len(doc.element.body) - 1, sdt)

    assert extract(doc) == ["Рынок труда", "См. программу курса", "Вопрос из поля формы"]


def test_russian_default_style_id_is_resolved():
    doc = Document()
    styles = doc.styles.element
    normal = next(s for s in styles.findall(qn("w:style")) if s.get(qn("w:default")) == "1" and s.get(qn("w:type")) == "paragraph")
    normal.set(qn("w:styleId"), "a")  # так называет «Обычный» русский Word
    doc.add_paragraph("Обычный абзац")
    doc.add_paragraph("Номер по стилю", style="List Number")
    assert extract(doc) == ["Обычный абзац", "1. Номер по стилю"]


def test_broken_docx_raises_a_readable_error():
    with pytest.raises(ValueError, match="Ошибка чтения DOCX"):
        extract_text(b"not a zip at all", "x.docx")


def test_other_formats_are_unchanged():
    assert extract_text("Строка 1\r\nСтрока 2".encode("utf-8"), "a.txt") == "Строка 1\nСтрока 2"
    assert extract_text("<html><body><p>Абзац</p><script>x()</script></body></html>".encode("utf-8"), "a.html") == "Абзац"
