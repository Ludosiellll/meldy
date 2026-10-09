"""Разбор банка вопросов (bank_parse.py, bank_docx.py).

Корпус: синтетические файлы fixtures/banks с эталоном expected.json (их пересобирает make_corpus.py) — каждый
файл разбирается в эталон: вопросы, варианты, ключи, виды, флаги, тексты дословно, темы, предметы,
предупреждения, пропуски номеров. Дальше — код без изменений, источники ключа, флаги, доли отметок (marks),
предметы и темы, открытые вопросы, format и key_mode, пределы, безопасность разбора файлов и скорость
(банк на 240 вопросов — меньше 0,5 с, сессия 4 × 240 — меньше 1,5 с). Файлы колледжа сюда не кладутся.
"""
import io
import json
import sys
import time
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

import pytest
from docx import Document
from docx.enum.text import WD_COLOR_INDEX
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import RGBColor

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import bank_docx  # noqa: E402
import bank_parse  # noqa: E402
from bank_parse import BankError, parse_bank_file, parse_bank_text  # noqa: E402

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "banks"
SPECS = json.loads((FIXTURES / "expected.json").read_text(encoding="utf-8"))
W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
M_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math"
SIDE_FLAGS = ("has_image", "has_formula", "joined_lines")  # сопутствующие флаги: в эталоне не перечислены


# ── Корпус ──────────────────────────────────────────────────────────────────────


def corpus_problems(spec: dict, result: dict) -> list[str]:
    """Расхождения разбора с эталоном (как check.py прототипа, плюс тексты, номера, темы, предметы)."""
    got, want = result["items"], spec["items"]
    problems = []
    if len(got) != len(want):
        problems.append(f"items {len(got)} != {len(want)}")
    topics_in_file = spec.get("topics_in_file", True) and bool(spec["topics"])
    for g, w in zip(got, want):
        tag = f"№{w['label'] or w['text'][:20]}"
        expected_flags = spec["flags"].get(w["label"], [])
        if w["kind"] in ("single", "multiple", "order") and w["options"] and g["options"] != w["options"]:
            problems.append(f"{tag} options {g['options']} != {w['options']}")
        if w["kind"] in ("single", "multiple") and sorted(g["correct"]) != sorted(w["correct"]) \
                and not set(expected_flags) & {"key_conflict", "no_key", "several_marked"}:
            problems.append(f"{tag} correct {g['correct']} != {w['correct']}")
        if w["kind"] != g["kind"] and not (w["kind"] == "single" and g["kind"] == "truefalse"):
            problems.append(f"{tag} kind {g['kind']} != {w['kind']}")
        if w["kind"] == "open" and (g["options"] or g["correct"] or "no_key" in g["flags"]):
            problems.append(f"{tag} open item with options, key or no_key: {g}")
        if w["kind"] == "order" and w.get("order") and g["order"] != [w["order"].index(p) for p in range(1, len(w["order"]) + 1)]:
            problems.append(f"{tag} order {g['order']} != places {w['order']}")
        if w["kind"] == "open" and w.get("answer") and g["answer"] != w["answer"]:
            problems.append(f"{tag} answer {g['answer']} != {w['answer']}")
        missing = [f for f in expected_flags if f not in g["flags"]]
        extra = [f for f in g["flags"] if f not in expected_flags and f not in SIDE_FLAGS]
        if missing or extra:
            problems.append(f"{tag} flags missing {missing} extra {extra}")
        # формула OMML остаётся в тексте вопроса (флаг has_formula): эталон — текст до неё
        if g["text"] != w["text"] and not ("has_formula" in g["flags"] and g["text"].startswith(w["text"])):
            problems.append(f"{tag} text {g['text']!r} != {w['text']!r}")
        if g["label"] != w["label"]:
            problems.append(f"{tag} label {g['label']!r} != {w['label']!r}")
        if "subject" in w and g["subject"] != w["subject"]:
            problems.append(f"{tag} subject {g['subject']} != {w['subject']}")
        if topics_in_file and g["topic"] != w.get("topic"):
            problems.append(f"{tag} topic {g['topic']} != {w.get('topic')}")
    if topics_in_file and [t["title"] for t in result["topics"]] != spec["topics"]:
        problems.append(f"topics {[t['title'] for t in result['topics']]} != {spec['topics']}")
    if "topic_subjects" in spec and [t["subject"] for t in result["topics"]] != spec["topic_subjects"]:
        problems.append(f"topic subjects {[t['subject'] for t in result['topics']]} != {spec['topic_subjects']}")
    subjects = [{"title": s["title"], "evidence": s["evidence"]} for s in result["subjects"]]
    if subjects != spec.get("subjects", [{"title": None, "evidence": "none"}]):
        problems.append(f"subjects {subjects}")
    if sorted(w["code"] for w in result["warnings"]) != sorted(spec.get("warnings", [])):
        problems.append(f"warnings {result['warnings']}")
    if result["stats"]["gaps"] != spec.get("gaps", []):
        problems.append(f"gaps {result['stats']['gaps']}")
    return problems


def parse_spec(spec: dict) -> dict:
    key_text = None
    if spec["key"].startswith("key_file:"):
        key_text = (FIXTURES / spec["key"].split(":", 1)[1]).read_text(encoding="utf-8")
    contents = (FIXTURES / spec["file"]).read_bytes()
    return parse_bank_file(contents, spec["file"], key_text=key_text, format_mode=spec.get("format", "auto"))


@pytest.mark.parametrize("spec", SPECS, ids=[f"{s['file']}-{s.get('format', 'auto')}" for s in SPECS])
def test_every_corpus_file_parses_to_its_expected_result(spec):
    assert corpus_problems(spec, parse_spec(spec)) == []


def test_corpus_covers_every_layout_key_source_and_the_session_cases():
    files = {spec["file"] for spec in SPECS}
    assert len(files) == 24 and len(SPECS) == 25  # 17 файлов прототипа (без PDF) и 7 файлов сессии
    layouts = {parse_spec(spec)["layout"] for spec in SPECS}
    assert {"table_option_rows", "table_options_in_cell", "table_option_columns", "numbered_paragraphs", "blocks", "gift"} <= layouts
    sources = set()
    for spec in SPECS:
        sources |= set(parse_spec(spec)["key_source"])
    assert {"bold", "underline", "color", "key_column", "key_list", "key_text", "marker", "answer_line", "gift",
            "order_numbers"} <= sources


def test_generator_is_committed_next_to_its_output():
    source = (FIXTURES / "make_corpus.py").read_text(encoding="utf-8")
    assert "expected.json" in source and "def main()" in source
    for spec in SPECS:
        assert (FIXTURES / spec["file"]).is_file()


# ── Помощники: DOCX из шаблона корпуса и маленькие документы python-docx ─────────


def docx_with_body(body: str, prolog: str = "") -> bytes:
    """DOCX с другим телом документа на основе файла корпуса (python-docx на тысячах строк таблицы медленный)."""
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO((FIXTURES / "13_inline_bold.docx").read_bytes())) as source, \
            zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as target:
        for info in source.infolist():
            data = source.read(info.filename)
            if info.filename == "word/document.xml":
                data = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>{prolog}'
                        f'<w:document xmlns:w="{W_NS}" xmlns:m="{M_NS}"><w:body>{body}<w:sectPr/></w:body></w:document>').encode()
            target.writestr(info, data)
    return out.getvalue()


def xml_paragraph(text: str, bold: bool = False) -> str:
    props = "<w:rPr><w:b/></w:rPr>" if bold else ""
    return f'<w:p><w:r>{props}<w:t xml:space="preserve">{escape(text)}</w:t></w:r></w:p>'


def xml_cell(content: str, props: str = "") -> str:
    return f"<w:tc><w:tcPr>{props}</w:tcPr>{content or '<w:p/>'}</w:tc>"


def owner_table(subject: int, items: int, topics: int, options: int = 5) -> str:
    """Таблица как у владельца: «№ | Содержание вопроса | Варианты ответов», строки тем на всю ширину,
    № и вопрос объединены вниз, вариант на строку, правильный (номер вопроса по модулю options) — жирным."""
    rows = ["<w:tr>" + "".join(xml_cell(xml_paragraph(text, bold=True)) for text in
                                ("№", "Содержание вопроса", "Варианты ответов")) + "</w:tr>"]
    number = 0
    for topic in range(1, topics + 1):
        rows.append("<w:tr>" + xml_cell(xml_paragraph(f"Тема {topic}. Раздел {topic} предмета {subject}", bold=True),
                                        '<w:gridSpan w:val="3"/>') + "</w:tr>")
        for _ in range(items // topics):
            number += 1
            for k in range(options):
                first = k == 0
                merge = '<w:vMerge w:val="restart"/>' if first else "<w:vMerge/>"
                rows.append(
                    "<w:tr>"
                    + xml_cell(xml_paragraph(str(number)) if first else "", merge)
                    + xml_cell(xml_paragraph(f"Вопрос {subject}.{number}: что делает строка count += {number}; в цикле?")
                               if first else "", merge)
                    + xml_cell(xml_paragraph(f"вариант {k + 1} к вопросу {subject}.{number}", bold=k == number % options))
                    + "</w:tr>")
    return "<w:tbl><w:tblPr/><w:tblGrid><w:gridCol/><w:gridCol/><w:gridCol/></w:tblGrid>" + "".join(rows) + "</w:tbl>"


def docx_bytes(build) -> bytes:
    doc = Document()
    build(doc)
    buffer = io.BytesIO()
    doc.save(buffer)
    return buffer.getvalue()


def best_seconds(call, repeat: int = 3) -> float:
    """Лучшее время из нескольких прогонов: машина под нагрузкой полного прогона даёт шум."""
    best = None
    for _ in range(repeat):
        started = time.perf_counter()
        call()
        elapsed = time.perf_counter() - started
        best = elapsed if best is None else min(best, elapsed)
    return best


# ── Скорость ────────────────────────────────────────────────────────────────────


def test_a_240_question_bank_parses_in_under_half_a_second():
    contents = docx_with_body(owner_table(1, 240, 8))
    result = parse_bank_file(contents, "C# и .NET.docx")
    assert result["stats"]["items"] == 240 and result["key_source"] == {"bold": 240}
    assert [item["correct"] for item in result["items"]] == [[n % 5] for n in range(1, 241)]
    assert all(item["flags"] == [] and len(item["options"]) == 5 for item in result["items"])
    assert len(result["topics"]) == 8 and result["subjects"] == [{"index": 1, "title": None, "evidence": "none", "items": 240}]
    assert best_seconds(lambda: parse_bank_file(contents, "C# и .NET.docx")) < 0.5


SESSION_SUBJECTS = ("Основы программирования", "Базы данных", "Компьютерные сети", "Операционные системы")


def test_a_960_question_session_of_four_subjects_parses_in_under_one_and_a_half_seconds():
    body = "".join(xml_paragraph(f"Дисциплина: {title}") + owner_table(index, 240, 8)
                   for index, title in enumerate(SESSION_SUBJECTS, start=1))
    contents = docx_with_body(body)
    result = parse_bank_file(contents, "Сессия.docx")
    assert result["stats"]["items"] == 960 and result["key_source"] == {"bold": 960}
    assert result["subjects"] == [{"index": i, "title": title, "evidence": "heading", "items": 240}
                                  for i, title in enumerate(SESSION_SUBJECTS, start=1)]
    assert [topic["subject"] for topic in result["topics"]] == [s for s in range(1, 5) for _ in range(8)]
    assert [topic["index"] for topic in result["topics"]] == list(range(1, 33))
    assert all(item["flags"] == [] for item in result["items"]) and result["stats"]["gaps"] == []
    assert [item["label"] for item in result["items"][235:245]] == ["236", "237", "238", "239", "240", "1", "2", "3", "4", "5"]
    assert result["warnings"] == []
    assert best_seconds(lambda: parse_bank_file(contents, "Сессия.docx")) < 1.5


# ── Код дословно ────────────────────────────────────────────────────────────────

CODE_BANK = """1. Какой оператор вычитает и сразу присваивает результат?
а) +=
б) **-=**
в) =-
г) %=
2. Что делает метод __init__ в Python?
а) **__init__ вызывается при создании объекта**
б) __init__ удаляет объект
3. Какая директива начинает сворачиваемый блок?
а) **#region Helpers**
б) #define TRACE
в) #pragma warning disable
4. Какой оператор уменьшает число на единицу?
а) **--**
б) *
в) ++
г) ~
5. В какой строке есть оператор условного доступа?
а) **Changed?.Invoke(this, e);**
б) Changed.Invoke(this, e);
в) count -= step;
"""


def test_code_survives_verbatim_in_questions_and_options():
    result = parse_bank_text(CODE_BANK)
    assert [item["options"] for item in result["items"]] == [
        ["+=", "-=", "=-", "%="],
        ["__init__ вызывается при создании объекта", "__init__ удаляет объект"],
        ["#region Helpers", "#define TRACE", "#pragma warning disable"],
        ["--", "*", "++", "~"],
        ["Changed?.Invoke(this, e);", "Changed.Invoke(this, e);", "count -= step;"],  # «;» кода не срезается
    ]
    assert [item["correct"] for item in result["items"]] == [[1], [0], [0], [0], [0]]
    assert result["key_source"] == {"bold": 5} and result["marker"] is None
    assert all(item["flags"] == [] for item in result["items"])
    assert [item["code"] for item in result["items"]] == [True, False, True, False, True]
    owner = parse_spec(SPECS[0])  # таблица как у владельца: код в вариантах
    options = {option for item in owner["items"] for option in item["options"]}
    assert {"//", "#", "--", "#region", "+=", "=>", "::", "*", "Func<int>", "Converter<int, int>"} <= options
    assert any(item["text"] == "Что вернёт выражение items?.Count ?? 0, если items равно null?" for item in owner["items"])


def test_open_question_text_keeps_code_and_is_not_cleaned():
    result = parse_spec(next(spec for spec in SPECS if spec["file"] == "23_open_autonumber.docx"))
    texts = [item["text"] for item in result["items"]]
    assert "Что выведет Console.WriteLine(5 / 2); и почему?" in texts
    assert "Что такое __init__ в Python и есть ли похожий метод в C#?" in texts
    assert "Что делает строка count -= step; в цикле while (count > 0)?" in texts
    assert "Зачем нужен #region Helpers и когда без него лучше обойтись?" in texts
    assert all(item["kind"] == "open" and item["options"] == [] and item["marks"] == {} for item in result["items"])


# ── Источники ключа ─────────────────────────────────────────────────────────────


def _shade(run) -> None:
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:fill"), "FFFF00")
    run._r.get_or_add_rPr().append(shd)


MARKERS = {
    "bold": lambda run: setattr(run, "bold", True),
    "underline": lambda run: setattr(run, "underline", True),
    "italic": lambda run: setattr(run, "italic", True),
    "highlight": lambda run: setattr(run.font, "highlight_color", WD_COLOR_INDEX.YELLOW),
    "color": lambda run: setattr(run.font.color, "rgb", RGBColor(0xFF, 0x00, 0x00)),
    "shade": _shade,
}


@pytest.mark.parametrize("signal", sorted(MARKERS))
def test_the_key_is_read_from_each_formatting_signal(signal):
    def build(doc):
        for number in range(1, 5):
            doc.add_paragraph(f"{number}. Вопрос номер {number}?")
            for k in range(4):
                p = doc.add_paragraph(f"{'абвг'[k]}) ")
                run = p.add_run(f"вариант {k + 1} вопроса {number}")
                if k == number % 4:
                    MARKERS[signal](run)

    result = parse_bank_file(docx_bytes(build), "bank.docx")
    assert result["format_signal"] == signal and result["key_source"] == {signal: 4}
    assert [item["correct"] for item in result["items"]] == [[n % 4] for n in range(1, 5)]
    assert list(result["items"][0]["marks"]) == [signal]  # признаки без отметок в документе не приходят
    assert result["items"][0]["marks"][signal] == [0, 1, 0, 0]


def test_checkbox_symbols_mark_the_key():
    def build(doc):
        for number in (1, 2):
            doc.add_paragraph(f"{number}. Вопрос {number}?")
            for k in range(3):
                p = doc.add_paragraph()
                sym = OxmlElement("w:sym")
                sym.set(qn("w:font"), "Wingdings")
                sym.set(qn("w:char"), "F0FE" if k == number else "F0A8")
                p.add_run()._r.append(sym)
                p.add_run(f" вариант {k + 1}")

    result = parse_bank_file(docx_bytes(build), "bank.docx")
    assert result["key_source"] == {"checkbox": 2}
    assert [item["correct"] for item in result["items"]] == [[1], [2]]


def test_key_mode_first_option_and_none_override_the_file_and_key_text_still_applies():
    contents = (FIXTURES / "01_table_rows_bold.docx").read_bytes()
    first = parse_bank_file(contents, "bank.docx", key_mode="first_option")
    assert first["key_source"] == {"first_option": 12}
    assert all(item["correct"] == [0] and "no_key" not in item["flags"] for item in first["items"])
    none = parse_bank_file(contents, "bank.docx", key_mode="none")
    assert none["key_source"] == {} and none["stats"]["no_key"] == 12
    assert all(item["correct"] == [] and item["flags"] == ["no_key"] for item in none["items"])
    assert none["items"][0]["marks"]["bold"] == [1, 0, 0, 0]  # клиент всё равно может взять жирный сам
    keyed = parse_bank_file(contents, "bank.docx", key_mode="none", key_text="1 – б\n2. в")
    assert keyed["key_source"] == {"key_text": 2}
    assert [item["correct"] for item in keyed["items"][:3]] == [[1], [2], []]


def test_key_text_is_a_key_list_and_wins_over_the_file_with_a_conflict_flag():
    contents = (FIXTURES / "05_key_column_inline.docx").read_bytes()
    result = parse_bank_file(contents, "bank.docx", key_text="Ответы:\n1 – в; 2 – в")
    first, second = result["items"][:2]
    assert first["correct"] == [2] and first["evidence"] == "key_text" and "key_conflict" in first["flags"]
    assert second["correct"] == [2] and second["evidence"] == "key_text" and "key_conflict" not in second["flags"]
    assert bank_parse.parse_key_text("Ключ\n1 – б; 2-в\n3. а\n4б") == {"1": "б", "2": "в", "3": "а", "4": "б"}


def test_key_text_that_matches_nothing_is_reported():
    contents = (FIXTURES / "15_pasted_no_key.txt").read_bytes()
    no_pairs = parse_bank_file(contents, "bank.txt", key_text="правильные ответы смотрите в журнале")
    assert [w["code"] for w in no_pairs["warnings"]] == ["key_text_unused"]
    assert no_pairs["warnings"][0]["message"] == bank_parse.KEY_TEXT_NO_PAIRS_WARNING
    no_match = parse_bank_file(contents, "bank.txt", key_text="99 – а")
    assert no_match["warnings"][0]["message"] == bank_parse.KEY_TEXT_NO_MATCH_WARNING
    applied = parse_bank_file(contents, "bank.txt", key_text="1 – в\n2 – б\n3 – б\n4 – а")
    assert applied["warnings"] == [] and applied["key_source"] == {"key_text": 4} and applied["stats"]["no_key"] == 0


# ── Флаги, пропуски номеров, доли отметок ───────────────────────────────────────

FLAGGED = """1. Один вариант?
а) только этот
2. Девять вариантов?
а) 1
б) 2
в) 3
г) 4
д) 5
е) 6
ж) 7
з) 8
и) 9
3. Одинаковые варианты?
а) да
б) да
в) нет
4. Пустой вариант?
а) x;
б) ;
в) z.
"""


def test_validation_flags():
    result = parse_bank_text(FLAGGED)
    assert [item["flags"] for item in result["items"]] == [
        ["few_options", "no_key"], ["many_options", "no_key"], ["no_key", "same_options"], ["no_key", "empty_option"],
    ]
    assert result["stats"]["to_check"] == 4 and result["confidence"] == 0.0
    test_only = parse_bank_text("1. Вопрос без вариантов?\n2. Вопрос?\nа) да\nб) нет\n", format_mode="test")
    assert test_only["items"][0]["kind"] == "unknown" and test_only["items"][0]["flags"] == ["no_options"]


def test_long_texts_are_cut_to_the_database_limits_with_a_flag():
    question = "Очень длинный вопрос " * 220  # больше 4000 знаков
    option = "очень длинный вариант " * 30  # больше 600 знаков
    result = parse_bank_text(f"1. {question}?\nа) **{option.strip()}**\nб) короткий\n")
    item = result["items"][0]
    assert len(item["text"]) <= 4000 and question.startswith(item["text"]) and len(item["options"][0]) <= 600
    assert item["flags"] == ["too_long"] and item["correct"] == [0] and result["stats"]["to_check"] == 1


def test_numbering_gaps_are_reported_per_subject():
    messy = parse_spec(next(spec for spec in SPECS if spec["file"] == "14_messy.docx"))
    assert messy["stats"]["gaps"] == [[8, 8]]
    restart = parse_spec(next(spec for spec in SPECS if spec["file"] == "21_two_tables_restart.docx"))
    assert restart["stats"]["gaps"] == []  # нумерация заново во втором предмете — не пропуск


def test_marks_give_the_share_of_marked_characters_per_option_for_each_signal_in_the_document():
    def build(doc):
        doc.add_paragraph("1. Первый вопрос?")
        doc.add_paragraph("а) ").add_run("alpha").bold = True
        doc.add_paragraph("б) beta")
        doc.add_paragraph("в) gamma")
        doc.add_paragraph("2. Второй вопрос?")
        p = doc.add_paragraph("а) ")
        p.add_run("Stack").bold = True  # 5 из 13 видимых знаков
        p.add_run("Overflow")
        doc.add_paragraph("б) GitHub")
        doc.add_paragraph("в) ").add_run("Habr").underline = True

    result = parse_bank_file(docx_bytes(build), "bank.docx")
    first, second = result["items"]
    assert first["marks"] == {"bold": [1, 0, 0], "underline": [0, 0, 0]}
    assert second["marks"] == {"bold": [0.38, 0, 0], "underline": [0, 0, 1]}
    assert result["format_signal"] == "bold" and result["mark_share"] == 0.6
    assert first["correct"] == [0] and second["correct"] == [] and second["flags"] == ["partial_mark", "no_key"]
    assert isinstance(first["marks"]["bold"][0], int) and isinstance(second["marks"]["bold"][1], int)


@pytest.mark.parametrize(("marked", "letters", "value"), [
    (0, 5, 0), (5, 5, 1), (3, 5, 0.6), (599, 1000, 0.59), (1, 200, 0.01), (2, 3, 0.66), (0, 0, 0),
])
def test_mark_values_round_down_so_the_client_threshold_matches_the_server(marked, letters, value):
    assert bank_parse._mark_value(marked, letters) == value
    if letters:
        assert (value >= bank_parse.MARK_SHARE) == (marked / letters >= bank_parse.MARK_SHARE)


def test_marks_are_trimmed_with_list_punctuation_so_a_short_bold_option_is_still_the_key():
    def build(doc):
        for number in (1, 2):
            p = doc.add_paragraph(f"{number}. Сколько байт в типе? ")
            for k, option in enumerate(("2", "4", "8")):
                p.add_run(f"{'абв'[k]}) ")
                p.add_run(option).bold = k == number
                p.add_run("; " if k < 2 else ".")

    result = parse_bank_file(docx_bytes(build), "bank.docx")
    assert [item["options"] for item in result["items"]] == [["2", "4", "8"]] * 2
    assert [item["correct"] for item in result["items"]] == [[1], [2]]
    assert result["items"][0]["marks"]["bold"] == [0, 1, 0]


# ── Предметы и темы ─────────────────────────────────────────────────────────────


@pytest.mark.parametrize(("line", "title"), [
    ("Дисциплина: Основы программирования", "Основы программирования"),
    ("Учебная дисциплина «Базы данных»", "Базы данных"),
    ("Учебная дисциплина Базы данных", "Базы данных"),
    ("ДИСЦИПЛИНА ОСНОВЫ ПРОГРАММИРОВАНИЯ", "ОСНОВЫ ПРОГРАММИРОВАНИЯ"),
    ("Предмет: История Беларуси", "История Беларуси"),
    ("Предмет «История Беларуси»", "История Беларуси"),
    ("Курс: Компьютерные сети", "Компьютерные сети"),
    ("МДК 01.01 Разработка программных модулей", "МДК 01.01 Разработка программных модулей"),
    ("ПМ.01 Разработка модулей программного обеспечения", "ПМ.01 Разработка модулей программного обеспечения"),
    ("Модуль 2. Базы данных", "Модуль 2. Базы данных"),
    ("Тестовые задания по учебной дисциплине «Основы программирования»", "Основы программирования"),
    ("Модуль 2", None),
    ("Курс 2", None),
    ("Курс лекций по экономике", None),
    ("Дисциплина труда на предприятии", None),
    ("Предмет и метод макроэкономики.", None),
    ("Что изучает дисциплина «Экономика»?", None),
    ("Тема 1. Введение", None),
])
def test_subject_titles_from_discipline_headings(line, title):
    assert bank_parse.subject_title(line) == title


def test_word_heading_levels_make_subjects_when_topics_sit_one_level_lower():
    def build(doc):
        number = 0
        for subject in ("Основы программирования", "Базы данных"):
            doc.add_heading(subject, level=1)
            for topic in ("Введение", "Практика"):
                doc.add_heading(topic, level=2)
                for _ in range(2):
                    number += 1
                    doc.add_paragraph(f"{number}. Вопрос {number}?")
                    doc.add_paragraph("а) ").add_run("да").bold = True
                    doc.add_paragraph("б) нет")

    result = parse_bank_file(docx_bytes(build), "bank.docx")
    assert [(s["title"], s["evidence"], s["items"]) for s in result["subjects"]] == [
        ("Основы программирования", "heading_level", 4), ("Базы данных", "heading_level", 4)]
    assert [(t["title"], t["subject"], t["items"]) for t in result["topics"]] == [
        ("Введение", 1, 2), ("Практика", 1, 2), ("Введение", 2, 2), ("Практика", 2, 2)]
    assert [item["topic"] for item in result["items"]] == [1, 1, 2, 2, 3, 3, 4, 4]


def test_a_merged_table_row_with_a_discipline_code_starts_a_subject():
    def row(cells, merged=False):
        if merged:
            return "<w:tr>" + xml_cell(xml_paragraph(cells, bold=True), '<w:gridSpan w:val="3"/>') + "</w:tr>"
        return "<w:tr>" + "".join(xml_cell(xml_paragraph(text) if text else "") for text in cells) + "</w:tr>"

    rows = [row(("№", "Вопрос", "Варианты ответов"))]
    for code, title in (("МДК 01.01", "Разработка программных модулей"), ("МДК 01.02", "Поддержка программных модулей")):
        rows.append(row(f"{code} {title}", merged=True))
        rows.append(row("Тема 1. Основы", merged=True))
        for number in (1, 2):
            rows.append(row((str(number), f"Вопрос {code} номер {number}?", "верный")))
            rows.append(row(("", "", "неверный")))
    table = "<w:tbl><w:tblPr/><w:tblGrid><w:gridCol/><w:gridCol/><w:gridCol/></w:tblGrid>" + "".join(rows) + "</w:tbl>"
    result = parse_bank_file(docx_with_body(table), "bank.docx", key_mode="first_option")
    assert [(s["title"], s["evidence"]) for s in result["subjects"]] == [
        ("МДК 01.01 Разработка программных модулей", "heading"), ("МДК 01.02 Поддержка программных модулей", "heading")]
    assert [(t["title"], t["subject"]) for t in result["topics"]] == [("Тема 1. Основы", 1), ("Тема 1. Основы", 2)]
    assert [item["subject"] for item in result["items"]] == [1, 1, 2, 2] and result["warnings"] == []


def numbered_questions(first: int, count: int) -> list[str]:
    lines = []
    for number in range(first, first + count):
        lines += [f"{number}. Вопрос номер {number}?", "а) **верно**", "б) неверно"]
    return lines


def test_numbering_restart_after_a_plain_heading_splits_subjects_and_asks():
    text = "\n".join(numbered_questions(1, 3) + ["Микроэкономика"] + numbered_questions(1, 2))
    result = parse_bank_text(text)
    assert [(s["title"], s["evidence"], s["items"]) for s in result["subjects"]] == [
        (None, "restart", 3), ("Микроэкономика", "restart", 2)]
    assert result["warnings"] == [{"code": "subjects_restart", "message": "Похоже, в файле несколько предметов. Разделить?"}]
    assert [item["options"] for item in result["items"]][2] == ["верно", "неверно"]  # заголовок не приклеился к варианту
    assert result["stats"]["items"] == 5 and result["key_source"] == {"bold": 5}


def test_numbering_restart_after_a_topic_heading_is_topic_numbering_not_a_new_subject():
    text = "\n".join(["Тема 1. Введение"] + numbered_questions(1, 3) + ["Тема 2. Практика"] + numbered_questions(1, 3))
    result = parse_bank_text(text)
    assert result["subjects"] == [{"index": 1, "title": None, "evidence": "none", "items": 6}]
    assert [(t["title"], t["subject"], t["items"]) for t in result["topics"]] == [
        ("Тема 1. Введение", 1, 3), ("Тема 2. Практика", 1, 3)]
    assert result["warnings"] == []


def test_more_than_300_topics_are_merged_into_the_last_one_with_a_warning():
    lines = []
    for number in range(1, 311):
        lines += [f"Тема {(number - 1) // 10 + 1}.{(number - 1) % 10 + 1}", f"{number}. Вопрос номер {number}?"]
    result = parse_bank_text("\n".join(lines))
    assert len(result["topics"]) == 300 and result["topics"][-1]["items"] == 11
    assert [item["topic"] for item in result["items"]][-12:] == [299] + [300] * 11
    assert [w["code"] for w in result["warnings"]] == ["topics_merged"]
    assert "310 тем" in result["warnings"][0]["message"]


# ── Открытые вопросы и format ───────────────────────────────────────────────────


def test_a_plain_numbered_exam_list_is_open_questions():
    text = "Вопросы к экзамену\nРаздел 1. Введение\n" + "\n".join(f"{n}. Тема вопроса номер {n} для устного ответа." for n in range(1, 21))
    result = parse_bank_text(text)
    assert result["stats"]["items"] == 20 and result["stats"]["kinds"] == {"open": 20}
    assert all(item["options"] == [] and item["correct"] == [] and item["flags"] == [] for item in result["items"])
    assert result["stats"]["no_key"] == 0 and result["skipped"] == ["Вопросы к экзамену"]
    assert [t["title"] for t in result["topics"]] == ["Раздел 1. Введение"]


def test_a_header_line_ending_with_a_colon_over_a_long_numbered_list_is_not_a_question():
    text = "Перечень вопросов к экзамену:\n" + "\n".join(f"{n}. Вопрос номер {n}." for n in range(1, 13))
    result = parse_bank_text(text)
    assert [item["label"] for item in result["items"]] == [str(n) for n in range(1, 13)]
    assert result["stats"]["kinds"] == {"open": 12}


def test_format_open_turns_gift_options_into_question_text():
    result = parse_bank_file((FIXTURES / "10_gift.txt").read_bytes(), "bank.txt", format_mode="open")
    assert result["stats"]["kinds"] == {"open": 10} and result["key_source"] == {}
    assert result["items"][0]["text"].endswith("\n862 г.\n988 г.\n1054 г.\n1147 г.")


def test_format_test_rejects_a_list_without_options():
    with pytest.raises(BankError) as raised:
        parse_bank_file((FIXTURES / "24_open_list.txt").read_bytes(), "bank.txt", format_mode="test")
    assert (raised.value.status, raised.value.code, raised.value.detail) == (422, "no_items", bank_parse.NO_TEST_ITEMS_DETAIL)


# ── Входные файлы, пределы, безопасность ────────────────────────────────────────


@pytest.mark.parametrize(("name", "contents", "status", "code"), [
    ("Банк.doc", b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\0" * 64, 415, "old_doc"),
    ("Банк.docx", b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\0" * 64, 415, "old_doc"),
    ("Банк.docx", b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + "EncryptedPackage".encode("utf-16-le"), 422, "unreadable"),
    ("Банк.pdf", b"%PDF-1.4", 415, "unsupported"),
    ("Банк.docx", b"%PDF-1.4 renamed", 415, "unsupported"),
    ("Банк.xls", b"anything", 415, "unsupported"),
    ("Банк.csv", b"1;2;3", 415, "unsupported"),
    ("Банк", "1. Вопрос?".encode(), 415, "unsupported"),
    ("Банк.docx", b"not a zip at all", 422, "unreadable"),
    ("Банк.xlsx", b"PK\x03\x04 broken", 422, "unreadable"),
    ("Банк.txt", b"", 422, "empty_file"),
    ("Банк.txt", "Просто текст без вопросов.".encode(), 422, "no_items"),
])
def test_file_kinds_and_broken_files(name, contents, status, code):
    with pytest.raises(BankError) as raised:
        parse_bank_file(contents, name)
    assert (raised.value.status, raised.value.code) == (status, code)


def test_texts_in_windows_1251_and_markdown_files_are_read():
    contents = "1. Сколько дней в неделе?\nа) 5\nб) 7\nОтвет: б\n".encode("cp1251")
    result = parse_bank_file(contents, "Тест.txt")
    assert result["items"][0]["options"] == ["5", "7"] and result["items"][0]["correct"] == [1]
    markdown = parse_bank_file("1. Вопрос?\nа) **да**\nб) нет\n".encode(), "Тест.md")
    assert markdown["items"][0]["correct"] == [0] and markdown["key_source"] == {"bold": 1}


def test_a_word_table_pasted_as_text_is_read_as_a_table():
    rows = ["№\tСодержание вопроса\tВарианты ответов", "Тема 1. Директивы\t\t"]
    for number in (1, 2):
        rows += [f"{number}\tКакая директива номер {number}?\t#region", "\t\t#define", "\t\t#if"]
    result = parse_bank_text("\n".join(rows))
    assert result["layout"] == "table_option_rows" and [t["title"] for t in result["topics"]] == ["Тема 1. Директивы"]
    assert [item["options"] for item in result["items"]] == [["#region", "#define", "#if"]] * 2


def test_more_than_2000_items_or_2_000_000_characters_are_refused():
    with pytest.raises(BankError) as many:
        parse_bank_text("\n".join(f"{n}. Вопрос {n}?" for n in range(1, 2002)))
    assert (many.value.status, many.value.code, many.value.detail) == (
        413, "too_many", "В файле больше 2000 вопросов. Разделите его на части и загрузите по очереди.")
    full = parse_bank_text("\n".join(f"{n}. Вопрос {n}?" for n in range(1, 2001)))
    assert full["stats"]["items"] == 2000 and full["items"][-1]["label"] == "2000" and full["stats"]["gaps"] == []
    year = parse_bank_text("1. В каком году Грюнвальдская битва?\nа) 1385.\n1410. год битвы\nб) 1569.")
    assert year["stats"]["items"] == 1  # «1410.» не продолжает нумерацию: не вопрос
    with pytest.raises(BankError) as long:
        parse_bank_text("а" * 2_000_001)
    assert (long.value.status, long.value.code) == (413, "too_much_text")


def test_long_runs_of_spaces_and_lines_do_not_slow_the_parser_down():
    """Разбор линейный: «[ \\t]+\\n» (parser.clean_extracted_text) и поиск маркера по всей строке были квадратичными."""
    spaced = "1. Вопрос?\nа) x" + " " * 1_000_000 + "+\nб) z (верно)\nв) **y**"
    assert best_seconds(lambda: parse_bank_text(spaced), repeat=1) < 2
    assert best_seconds(lambda: parse_bank_file(spaced.encode(), "bank.txt"), repeat=1) < 2
    wrapped = "1. Вопрос?\nа) начало\n" + "\n".join("хвост" for _ in range(50_000)) + "\nб) конец"
    result = parse_bank_text(wrapped)
    assert len(result["items"][0]["options"][0]) <= 600 and "too_long" in result["items"][0]["flags"]
    with pytest.raises(BankError) as many:
        parse_bank_text("\n".join(f"{n % 9 + 1}. Вопрос?\nа) да\nб) нет\nЗаголовок {n}" for n in range(9000)))
    assert many.value.code == "too_many"


def test_archives_over_the_unpacked_limits_are_not_unpacked(monkeypatch):
    contents = (FIXTURES / "01_table_rows_bold.docx").read_bytes()
    monkeypatch.setattr(bank_docx, "MAX_XML_PART_BYTES", 10_000)
    with pytest.raises(BankError) as part:
        parse_bank_file(contents, "bank.docx")
    assert (part.value.status, part.value.code) == (413, "too_much_text")
    monkeypatch.setattr(bank_docx, "MAX_XML_PART_BYTES", 1_000)
    with pytest.raises(BankError) as xlsx:
        parse_bank_file((FIXTURES / "11_columns_key.xlsx").read_bytes(), "bank.xlsx")
    assert (xlsx.value.status, xlsx.value.code) == (413, "too_much_text")
    monkeypatch.setattr(bank_docx, "MAX_XML_PART_BYTES", 40 * 1024 * 1024)
    monkeypatch.setattr(bank_docx, "MAX_ARCHIVE_BYTES", 50_000)
    with pytest.raises(bank_docx.ArchiveTooLarge):
        bank_docx.check_archive(contents)


def test_a_zip_bomb_is_refused_before_it_is_unpacked():
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as bomb:
        bomb.writestr("[Content_Types].xml", "<Types/>")
        bomb.writestr("word/document.xml", b"<" + b" " * (41 * 1024 * 1024))  # 41 МБ пробелов сжимаются в ~40 КБ
    contents = out.getvalue()
    assert len(contents) < 200_000
    with pytest.raises(BankError) as raised:
        parse_bank_file(contents, "bank.docx")
    assert (raised.value.status, raised.value.code) == (413, "too_much_text")


BILLION_LAUGHS = (
    '<!DOCTYPE w:document [<!ENTITY a "РАЗДУТО">'
    + "".join(f'<!ENTITY {chr(98 + i)} "{("&" + chr(97 + i) + ";") * 10}">' for i in range(8))
    + '<!ENTITY ext SYSTEM "file:///etc/hostname">]>'
)


def test_xml_entities_in_a_docx_are_never_expanded():
    body = ('<w:p><w:r><w:t>1. Вопрос &i; &ext;?</w:t></w:r></w:p>'
            + xml_paragraph("а) да", bold=True) + xml_paragraph("б) нет"))
    started = time.perf_counter()
    try:
        result = parse_bank_file(docx_with_body(body, prolog=BILLION_LAUGHS), "bank.docx")
    except BankError as exc:  # отказ — тоже безопасный исход
        assert exc.code == "unreadable"
    else:
        dumped = json.dumps(result, ensure_ascii=False)
        assert "РАЗДУТО" not in dumped and len(dumped) < 20_000
    assert time.perf_counter() - started < 2


def test_a_declared_entity_is_left_unexpanded_and_the_file_still_parses():
    body = ('<w:p><w:r><w:t>1. Вопрос &boom;?</w:t></w:r></w:p>'
            + xml_paragraph("а) да", bold=True) + xml_paragraph("б) нет"))
    result = parse_bank_file(docx_with_body(body, prolog='<!DOCTYPE w:document [<!ENTITY boom "РАЗДУТО">]>'), "bank.docx")
    assert result["items"][0]["text"] == "Вопрос" and result["items"][0]["correct"] == [0]


def test_xml_entities_in_an_xlsx_are_never_expanded():
    source = (FIXTURES / "11_columns_key.xlsx").read_bytes()
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(source)) as book, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as target:
        for info in book.infolist():
            data = book.read(info.filename)
            if info.filename == "xl/sharedStrings.xml":
                text = data.decode("utf-8")
                head, rest = text.split("?>", 1)
                data = (head + "?>" + BILLION_LAUGHS.replace("w:document", "sst")
                        + rest.replace("<t>Вопрос</t>", "<t>Вопрос &i; &ext;</t>", 1)).encode("utf-8")
            target.writestr(info, data)
    try:
        result = parse_bank_file(out.getvalue(), "bank.xlsx")
    except BankError as exc:
        assert exc.code == "unreadable"
    else:
        assert "РАЗДУТО" not in json.dumps(result, ensure_ascii=False)


def test_xlsx_cells_keep_numbers_line_breaks_and_formula_strings():
    import xlsxwriter

    buffer = io.BytesIO()
    book = xlsxwriter.Workbook(buffer, {"in_memory": True})
    sheet = book.add_worksheet()
    bold = book.add_format({"bold": True})
    red = book.add_format({"font_color": "#FF0000"})
    sheet.write_row(0, 0, ["№", "Вопрос", "Варианты ответов"])
    sheet.write_number(1, 0, 1)
    sheet.write_string(1, 1, "Сколько будет 0 + 0?")
    sheet.write_rich_string(1, 2, "а) 0\n", red, "б) 1", "\nв) 2")  # варианты в одной ячейке через Alt+Enter
    sheet.write_number(2, 0, 2)
    sheet.write_string(2, 1, "Какой оператор вычитает и сразу присваивает результат?")
    sheet.write_rich_string(2, 2, "а) += ", red, "б) -=", " в) =-")  # варианты в строку, ключ красным
    sheet.write_formula(3, 1, '="Вопрос "&"из формулы?"', None, "Вопрос из формулы?")
    sheet.write_number(3, 0, 3)
    sheet.write_string(3, 2, "а) да\nб) нет", bold)
    book.close()
    result = parse_bank_file(buffer.getvalue(), "bank.xlsx")
    items = result["items"]
    assert [item["options"] for item in items] == [["0", "1", "2"], ["+=", "-=", "=-"], ["да", "нет"]]
    assert items[2]["text"] == "Вопрос из формулы?" and items[0]["where"] == "лист 1, строка 2"
    assert result["format_signal"] == "color" and [item["correct"] for item in items] == [[1], [1], []]
    assert items[2]["flags"] == ["no_key"] and items[2]["marks"]["bold"] == [1, 1]  # жирное всё — не ключ
