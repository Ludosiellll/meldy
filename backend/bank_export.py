"""Экспорт теста (выпуск 49): GIFT, Moodle XML, Aiken и таблица для Kahoot — чтобы учитель не был заперт у нас.

Вход — вопросы теста, как их держит test_items (docs/kinds/CONTRACT.md §1): kind, stem, options, correct, answers,
explanation, tolerance, unit, partial, keep_order, code и признак картинок. Выход — файл (имя, тип, байты) и список
вопросов, которые формат не вмещает, с причиной простыми словами («в Aiken только вопросы с одним верным ответом»).

Что куда идёт:
- GIFT (как его пишет и читает Moodle, question/format/gift): один и несколько верных, «Верно / Неверно», краткий ответ,
  число с допуском, соответствие (лишние правые — «= -> …»), пропуск — только один на вопрос (Moodle читает его как
  краткий ответ с пропуском в тексте), развёрнутый ответ — «{}». Порядка в GIFT нет. Пояснение — «####…».
- Moodle XML: все виды: multichoice, truefalse, shortanswer, numerical, matching (лишние правые — подвопросы без текста),
  ordering, cloze ({1:SHORTANSWER:=…} на месте каждого пропуска), essay. Пояснение — generalfeedback.
- Aiken: только один верный ответ (и «Верно / Неверно»), вопрос и варианты — по строке, до 26 вариантов.
- Kahoot: таблица по их шаблону (https://kahoot.com/files/2018/08/KahootQuizTemplate-3.xlsx): лист «Sheet1», заголовки
  в строке 8, вопросы с 9-й, столбцы B–H: вопрос, ответы 1–4, время (20 с), верные («1,3»). Пределы — по справке
  Kahoot (вопрос до 120 знаков, ответ до 75, ответов 2–4): вопрос длиннее, вопрос с пятью вариантами и вопросы без
  вариантов не попадают в таблицу.

Картинки в файлы не переносятся: вопрос, у которого вместо текста картинка («Вопрос на картинке», «Рисунок Б»), не
выгружается; у остальных уходит текст, а в ответе — сколько вопросов потеряли картинки. Единица у числа в GIFT и
Moodle XML не переносится (её нет в GIFT; Moodle хранит единицы иначе).
"""

from __future__ import annotations

import html
import io
import re
from dataclasses import dataclass, field
from typing import Iterable, Optional

FORMATS = ("gift", "moodle", "aiken", "kahoot")
KINDS = ("single", "multiple", "short", "number", "order", "match", "cloze", "essay")
MAX_ITEMS = 2000

PICTURE_STEM = "Вопрос на картинке"
_PICTURE_OPTION_RE = re.compile(r"^Рисунок [А-Я0-9]{1,2}$")
_GAP_RE = re.compile(r"_{3,}")
_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"

KAHOOT_QUESTION_CHARS = 120
KAHOOT_ANSWER_CHARS = 75
KAHOOT_TIME_LIMIT = 20  # секунд: значение примера в шаблоне Kahoot
KAHOOT_HEADERS = (
    "Question - max 95 characters",
    "Answer 1 - max 60 characters",
    "Answer 2 - max 60 characters",
    "Answer 3 - max 60 characters",
    "Answer 4 - max 60 characters",
    "Time limit (sec) - 5,10,20,30,60,90 or 120 secs",
    "Correct answer(s) - choose at least one",
)  # дословно из шаблона Kahoot: импорт узнаёт таблицу по ним

MIME = {
    "gift": "text/plain; charset=utf-8",
    "moodle": "application/xml",
    "aiken": "text/plain; charset=utf-8",
    "kahoot": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}
SUFFIX = {"gift": " (GIFT).txt", "moodle": " (Moodle XML).xml", "aiken": " (Aiken).txt", "kahoot": " (Kahoot).xlsx"}

# Причины (их видит автор у каждого невыгруженного вопроса)
WHY_PICTURE = "вопрос на картинке, а картинки в файл не переносятся"
WHY_NO_KEY = "у вопроса нет верного ответа"
WHY_GIFT_ORDER = "в GIFT нет вопросов на порядок"
WHY_GIFT_GAPS = "в GIFT у вопроса может быть только один пропуск"
WHY_GIFT_ARROW = "в паре соответствия есть «->», а GIFT так отделяет пары"
WHY_AIKEN_KIND = "в Aiken только вопросы с одним верным ответом"
WHY_AIKEN_LINES = "в Aiken вопрос и варианты пишутся одной строкой, а здесь код в несколько строк"
WHY_KAHOOT_KIND = "в Kahoot из таблицы попадают только вопросы с вариантами"
WHY_KAHOOT_OPTIONS = "больше четырёх вариантов, а в Kahoot их до четырёх"
WHY_KAHOOT_STEM = f"вопрос длиннее {KAHOOT_QUESTION_CHARS} знаков (предел Kahoot)"
WHY_KAHOOT_ANSWER = f"вариант длиннее {KAHOOT_ANSWER_CHARS} знаков (предел Kahoot)"


class ExportError(ValueError):
    """Вход не подходит (неизвестный формат или вид, слишком много вопросов)."""


@dataclass
class ExportItem:
    kind: str
    stem: str
    options: list[str] = field(default_factory=list)
    correct: list[int] = field(default_factory=list)
    answers: list[str] = field(default_factory=list)
    explanation: str = ""
    tolerance: Optional[str] = None
    unit: Optional[str] = None
    partial: bool = False
    keep_order: bool = False
    code: bool = False
    pictures: bool = False
    number: str = ""  # номер вопроса, как его видит автор

    @property
    def keyed(self) -> bool:
        return bool(self.correct or self.answers)

    @property
    def truefalse(self) -> bool:
        return self.kind == "single" and [o.strip() for o in self.options] == ["Верно", "Неверно"]


@dataclass
class Exported:
    name: str
    mime: str
    data: bytes
    count: int  # выгружено вопросов
    skipped: list[dict]  # [{"number": "3", "reason": "…"}]
    pictures_lost: int  # выгружено без картинок


def _clean(text: object) -> str:
    return _CONTROL_RE.sub("", str(text or "")).replace("\r\n", "\n").replace("\r", "\n")


def _tolerance(value: object) -> Optional[str]:
    if value is None or value == "":
        return None
    text = str(value).strip()
    if not re.fullmatch(r"\d+(?:\.\d+)?", text):
        try:
            text = format(float(text), "f").rstrip("0").rstrip(".")
        except ValueError:
            return None
    return None if float(text) == 0 else text


def items_from_rows(rows: Iterable[dict]) -> list[ExportItem]:
    """Строки test_items (или вопросы студии) → ExportItem. Неизвестный вид — ExportError."""
    out: list[ExportItem] = []
    for index, row in enumerate(rows, start=1):
        if len(out) >= MAX_ITEMS:
            raise ExportError("too_many")
        kind = str(row.get("kind") or "single")
        if kind not in KINDS:
            raise ExportError(f"kind {kind!r}")
        images = row.get("images") or {}
        pictures = bool(row.get("pictures")) or bool(
            isinstance(images, dict) and (images.get("stem") or any(images.get("options") or [])))
        out.append(ExportItem(
            kind=kind,
            stem=_clean(row.get("stem")).strip(),
            options=[_clean(option).strip() for option in row.get("options") or []],
            correct=[int(i) for i in row.get("correct") or [] if isinstance(i, int) or str(i).isdigit()],
            answers=[_clean(answer) for answer in row.get("answers") or []],
            explanation=_clean(row.get("explanation")).strip(),
            tolerance=_tolerance(row.get("tolerance")),
            unit=(str(row.get("unit")).strip() or None) if row.get("unit") else None,
            partial=bool(row.get("partial")),
            keep_order=bool(row.get("keep_order")),
            code=bool(row.get("code")),
            pictures=pictures,
            number=str(row.get("number") or index),
        ))
    return out


def _picture_only(item: ExportItem) -> bool:
    return item.stem == PICTURE_STEM or any(_PICTURE_OPTION_RE.match(option) for option in item.options)


def _name(title: str, fmt: str) -> str:
    base = " ".join(re.sub(r'[\\/:*?"<>|\x00-\x1f]+', " ", title or "").split()).strip(" .")[:80].strip() or "Тест"
    return base + SUFFIX[fmt]


def _common_skip(item: ExportItem) -> Optional[str]:
    if _picture_only(item):
        return WHY_PICTURE
    if item.kind != "essay" and not item.keyed:
        return WHY_NO_KEY
    return None


# ── GIFT ────────────────────────────────────────────────────────────────────────


def _gift(text: str) -> str:
    """Экранирование GIFT, как в Moodle (repchar): \\ # = ~ { } : и перевод строки."""
    out = text.replace("\\", "\\\\")
    for char in "#=~{}:":
        out = out.replace(char, "\\" + char)
    return out.replace("\n", "\\n")


def _gift_weight(value: float) -> str:
    return f"{value:.5f}".rstrip("0").rstrip(".")


def gift_question(item: ExportItem) -> tuple[Optional[str], Optional[str]]:
    """Текст вопроса GIFT или (None, причина)."""
    general = f"\n\t####{_gift(item.explanation)}" if item.explanation else ""
    name = "::" + _gift(" ".join(item.stem.split())[:60]) + "::"
    stem = _gift(item.stem)
    if item.kind == "single" and item.truefalse:
        tf_general = "####" + _gift(item.explanation) if item.explanation else ""
        return f"{name}{stem}{{{'TRUE' if item.correct == [0] else 'FALSE'}{tf_general}}}", None
    if item.kind in ("single", "multiple"):
        right = set(item.correct)
        lines = []
        if item.kind == "single" and len(right) == 1:
            lines = [("=" if i in right else "~") + _gift(option) for i, option in enumerate(item.options)]
        else:
            share = _gift_weight(100 / len(right))
            lines = [f"~%{share}%" + _gift(option) if i in right else "~%-100%" + _gift(option)
                     for i, option in enumerate(item.options)]
        return f"{name}{stem}{{\n\t" + "\n\t".join(lines) + general + "\n}", None
    if item.kind == "short":
        return f"{name}{stem}{{\n\t" + "\n\t".join("=" + _gift(form) for form in item.answers) + general + "\n}", None
    if item.kind == "number":
        tolerance = f":{item.tolerance}" if item.tolerance else ""
        if len(item.answers) == 1:
            body = f"#{item.answers[0]}{tolerance}"
        else:
            body = "#\n\t" + "\n\t".join(f"={answer}{tolerance}" for answer in item.answers)
        return f"{name}{stem}{{{body}{general}\n}}", None
    if item.kind == "match":
        n = len(item.options)
        if any("->" in text for text in item.options + item.answers):
            return None, WHY_GIFT_ARROW
        lines = [f"={_gift(left)} -> {_gift(right)}" for left, right in zip(item.options, item.answers[:n])]
        lines += [f"= -> {_gift(extra)}" for extra in item.answers[n:]]
        return f"{name}{stem}{{\n\t" + "\n\t".join(lines) + general + "\n}", None
    if item.kind == "cloze":
        runs = list(_GAP_RE.finditer(item.stem))
        if len(runs) != 1 or len(item.answers) != 1:
            return None, WHY_GIFT_GAPS
        run = runs[0]
        forms = " ".join("=" + _gift(form) for form in item.answers[0].split("\n") if form.strip())
        text = _gift(item.stem[:run.start()]) + "{" + forms + general.replace("\n\t", " ") + "}" + _gift(item.stem[run.end():])
        return name + text, None
    if item.kind == "essay":
        return f"{name}{stem}{{{general.strip()}}}", None
    return None, WHY_GIFT_ORDER  # order


def to_gift(items: list[ExportItem], title: str) -> tuple[str, list[dict]]:
    # строка категории в Moodle не раскрывает экранирование: название — как есть, «/» (подкатегория) — дефисом
    category = (title or "Тест").replace("/", "-")
    parts = [f"// {category}: выгружено из Meldy", f"$CATEGORY: {category}", ""]
    skipped: list[dict] = []
    for item in items:
        why = _common_skip(item)
        text = None
        if why is None:
            text, why = gift_question(item)
        if text is None:
            skipped.append({"number": item.number, "reason": why, "at": id(item)})
            continue
        parts += [text, ""]
    return "\n".join(parts) + "\n", skipped


# ── Moodle XML ──────────────────────────────────────────────────────────────────


def _xml(text: str) -> str:
    return html.escape(text, quote=True)


def _html_field(text: str, code: bool = False) -> str:
    """Текст поля как HTML Moodle: код и строки с отступом — <pre>, остальное — абзац с <br> на месте переводов строки."""
    if not text:
        return ""
    if code or re.search(r"(^|\n)[ \t]+\S|\t| {2,}", text):
        return "<pre>" + html.escape(text, quote=False) + "</pre>"
    return "<p>" + html.escape(text, quote=False).replace("\n", "<br>") + "</p>"


def _text(tag: str, value: str, fmt: Optional[str] = "html", indent: str = "    ") -> str:
    attr = f' format="{fmt}"' if fmt else ""
    return f"{indent}<{tag}{attr}>\n{indent}  <text>{_xml(value)}</text>\n{indent}</{tag}>\n"


def _cloze_form(form: str) -> str:
    out = form.replace("\\", "\\\\")
    for char in "}{~#":
        out = out.replace(char, "\\" + char)
    return html.escape(out, quote=False)


def moodle_question(item: ExportItem, index: int) -> tuple[Optional[str], Optional[str]]:
    kinds = {"single": "multichoice", "multiple": "multichoice", "short": "shortanswer", "number": "numerical",
             "match": "matching", "order": "ordering", "cloze": "cloze", "essay": "essay"}
    kind = "truefalse" if item.truefalse else kinds[item.kind]
    head = f"  <question type=\"{kind}\">\n"
    head += f"    <name>\n      <text>{_xml(' '.join(item.stem.split())[:60] or f'Вопрос {index}')}</text>\n    </name>\n"
    body = ""
    if kind == "cloze":
        runs = list(_GAP_RE.finditer(item.stem))
        if not runs or len(runs) != len(item.answers):
            return None, WHY_NO_KEY
        pieces, at = [], 0
        for run, forms in zip(runs, item.answers):
            pieces.append(html.escape(item.stem[at:run.start()], quote=False))
            pieces.append("{1:SHORTANSWER:" + "~".join("=" + _cloze_form(form) for form in forms.split("\n") if form.strip()) + "}")
            at = run.end()
        pieces.append(html.escape(item.stem[at:], quote=False))
        head += _text("questiontext", "<p>" + "".join(pieces).replace("\n", "<br>") + "</p>")
    else:
        head += _text("questiontext", _html_field(item.stem, item.code))
    head += _text("generalfeedback", _html_field(item.explanation))
    head += "    <defaultgrade>1</defaultgrade>\n    <penalty>0.3333333</penalty>\n    <hidden>0</hidden>\n"
    if kind == "truefalse":
        right_true = item.correct == [0]
        body += f'    <answer fraction="{100 if right_true else 0}" format="moodle_auto_format">\n      <text>true</text>\n    </answer>\n'
        body += f'    <answer fraction="{0 if right_true else 100}" format="moodle_auto_format">\n      <text>false</text>\n    </answer>\n'
    elif kind == "multichoice":
        right = set(item.correct)
        single = item.kind == "single" and len(right) == 1
        share = f"{100 / len(right):.5f}".rstrip("0").rstrip(".")
        body += f"    <single>{'true' if single else 'false'}</single>\n"
        body += f"    <shuffleanswers>{'false' if item.keep_order else 'true'}</shuffleanswers>\n"
        body += "    <answernumbering>abc</answernumbering>\n"
        for i, option in enumerate(item.options):
            fraction = ("100" if single else share) if i in right else ("0" if single else "-100")
            body += f'    <answer fraction="{fraction}" format="html">\n      <text>{_xml(_html_field(option, item.code))}</text>\n    </answer>\n'
    elif kind == "shortanswer":
        body += "    <usecase>0</usecase>\n"
        for form in item.answers:
            body += f'    <answer fraction="100" format="moodle_auto_format">\n      <text>{_xml(form)}</text>\n    </answer>\n'
    elif kind == "numerical":
        for answer in item.answers:
            body += (f'    <answer fraction="100" format="moodle_auto_format">\n      <text>{_xml(answer)}</text>\n'
                     f"      <tolerance>{item.tolerance or 0}</tolerance>\n    </answer>\n")
    elif kind == "matching":
        n = len(item.options)
        body += "    <shuffleanswers>true</shuffleanswers>\n"
        for left, right in zip(item.options, item.answers[:n]):
            body += (f'    <subquestion format="html">\n      <text>{_xml(_html_field(left, item.code))}</text>\n'
                     f"      <answer>\n        <text>{_xml(right)}</text>\n      </answer>\n    </subquestion>\n")
        for extra in item.answers[n:]:
            body += (f'    <subquestion format="html">\n      <text></text>\n'
                     f"      <answer>\n        <text>{_xml(extra)}</text>\n      </answer>\n    </subquestion>\n")
    elif kind == "ordering":
        body += ("    <layouttype>VERTICAL</layouttype>\n    <selecttype>ALL</selecttype>\n    <selectcount>0</selectcount>\n"
                 f"    <gradingtype>{'ABSOLUTE_POSITION' if item.partial else 'ALL_OR_NOTHING'}</gradingtype>\n"
                 "    <showgrading>SHOW</showgrading>\n    <numberingstyle>none</numberingstyle>\n")
        for i, option in enumerate(item.options, start=1):
            body += f'    <answer fraction="{i}" format="html">\n      <text>{_xml(_html_field(option, item.code))}</text>\n    </answer>\n'
    elif kind == "essay":
        body += ("    <responseformat>editor</responseformat>\n    <responserequired>1</responserequired>\n"
                 "    <responsefieldlines>15</responsefieldlines>\n    <attachments>0</attachments>\n")
    return head + body + "  </question>\n", None


def to_moodle(items: list[ExportItem], title: str) -> tuple[str, list[dict]]:
    out = ['<?xml version="1.0" encoding="UTF-8"?>\n<quiz>\n']
    out.append(f"  <question type=\"category\">\n    <category>\n      <text>$course$/top/{_xml(title or 'Тест')}</text>\n"
               "    </category>\n  </question>\n")
    skipped: list[dict] = []
    for index, item in enumerate(items, start=1):
        why = _common_skip(item)
        text = None
        if why is None:
            text, why = moodle_question(item, index)
        if text is None:
            skipped.append({"number": item.number, "reason": why, "at": id(item)})
            continue
        out.append(text)
    out.append("</quiz>\n")
    return "".join(out), skipped


# ── Aiken ───────────────────────────────────────────────────────────────────────


def _one_line(text: str, code: bool) -> Optional[str]:
    if "\n" not in text:
        return text
    if code:
        return None
    return " ".join(text.split())


def to_aiken(items: list[ExportItem]) -> tuple[str, list[dict]]:
    out: list[str] = []
    skipped: list[dict] = []
    for item in items:
        why = _common_skip(item)
        if why is None and (item.kind != "single" or len(item.correct) != 1 or len(item.options) > len(_LETTERS)):
            why = WHY_AIKEN_KIND
        lines = None
        if why is None:
            stem = _one_line(item.stem, item.code)
            options = [_one_line(option, item.code) for option in item.options]
            if stem is None or any(option is None for option in options):
                why = WHY_AIKEN_LINES
            else:
                lines = [stem] + [f"{_LETTERS[i]}. {option}" for i, option in enumerate(options)]
                lines.append(f"ANSWER: {_LETTERS[item.correct[0]]}")
        if lines is None:
            skipped.append({"number": item.number, "reason": why, "at": id(item)})
            continue
        out += lines + [""]
    return "\n".join(out), skipped


# ── Kahoot (xlsx по их шаблону) ─────────────────────────────────────────────────


def kahoot_rows(items: list[ExportItem]) -> tuple[list[tuple[str, list[str], str]], list[dict]]:
    """Строки таблицы Kahoot: (вопрос, ответы, верные «1,3») и невыгруженные."""
    rows: list[tuple[str, list[str], str]] = []
    skipped: list[dict] = []
    for item in items:
        why = _common_skip(item)
        if why is None and item.kind not in ("single", "multiple"):
            why = WHY_KAHOOT_KIND
        if why is None and len(item.options) > 4:
            why = WHY_KAHOOT_OPTIONS
        stem = " ".join(item.stem.split())
        options = [" ".join(option.split()) for option in item.options]
        if why is None and len(stem) > KAHOOT_QUESTION_CHARS:
            why = WHY_KAHOOT_STEM
        if why is None and any(len(option) > KAHOOT_ANSWER_CHARS for option in options):
            why = WHY_KAHOOT_ANSWER
        if why is not None:
            skipped.append({"number": item.number, "reason": why, "at": id(item)})
            continue
        rows.append((stem, options, ",".join(str(i + 1) for i in sorted(set(item.correct)))))
    return rows, skipped


def to_kahoot(items: list[ExportItem], title: str) -> tuple[bytes, list[dict]]:
    import xlsxwriter

    rows, skipped = kahoot_rows(items)
    buffer = io.BytesIO()
    book = xlsxwriter.Workbook(buffer, {"in_memory": True, "strings_to_numbers": False, "strings_to_formulas": False,
                                        "strings_to_urls": False})
    sheet = book.add_worksheet("Sheet1")
    title_style = book.add_format({"bold": True, "font_size": 18, "valign": "vcenter"})
    note_style = book.add_format({"text_wrap": True, "valign": "vcenter", "font_color": "#555555"})
    head_style = book.add_format({"bold": True, "text_wrap": True, "valign": "vcenter", "bg_color": "#E9E1F5", "border": 1})
    cell_style = book.add_format({"text_wrap": True, "valign": "vcenter", "border": 1})
    number_style = book.add_format({"align": "center", "valign": "vcenter"})
    for first, last, width in ((0, 0, 12.5), (1, 1, 49.33), (2, 5, 31.83), (6, 6, 26.33), (7, 7, 33.16)):
        sheet.set_column(first, last, width)
    sheet.set_row(1, 57)
    sheet.write_string(1, 1, (title or "Тест")[:200], title_style)
    sheet.merge_range(2, 1, 2, 7, "Таблица для Kahoot: при создании квиза выберите импорт из таблицы и загрузите этот файл.", note_style)
    sheet.merge_range(3, 1, 3, 7, f"Вопрос — до {KAHOOT_QUESTION_CHARS} знаков, ответ — до {KAHOOT_ANSWER_CHARS}, "
                      "ответов от двух до четырёх; в последнем столбце — номера верных через запятую.", note_style)
    sheet.write_string(4, 1, f"Выгружено из Meldy: {len(rows)} из {len(items)} вопросов.", note_style)
    sheet.merge_range(5, 1, 5, 7, "Время на вопрос — 20 секунд, его можно поменять здесь или потом в Kahoot.", note_style)
    sheet.set_row(7, 32)
    for column, header in enumerate(KAHOOT_HEADERS, start=1):
        sheet.write_string(7, column, header, head_style)
    for offset, (stem, options, right) in enumerate(rows):
        row = 8 + offset
        sheet.set_row(row, 32)
        sheet.write_number(row, 0, offset + 1, number_style)
        sheet.write_string(row, 1, stem, cell_style)
        for column in range(4):
            if column < len(options):
                sheet.write_string(row, 2 + column, options[column], cell_style)
            else:
                sheet.write_blank(row, 2 + column, None, cell_style)
        sheet.write_number(row, 6, KAHOOT_TIME_LIMIT, cell_style)
        sheet.write_string(row, 7, right, cell_style)
    book.close()
    return buffer.getvalue(), skipped


def export(fmt: str, title: str, rows: Iterable[dict]) -> Exported:
    """Тест → файл формата fmt (FORMATS)."""
    if fmt not in FORMATS:
        raise ExportError(f"format {fmt!r}")
    items = items_from_rows(rows)
    title = " ".join(_clean(title).split())[:200]
    if fmt == "gift":
        text, skipped = to_gift(items, title)
        data = text.encode("utf-8")
    elif fmt == "moodle":
        text, skipped = to_moodle(items, title)
        data = text.encode("utf-8")
    elif fmt == "aiken":
        text, skipped = to_aiken(items)
        data = text.encode("utf-8")
    else:
        data, skipped = to_kahoot(items, title)
    left_out = {entry.pop("at") for entry in skipped}
    sent = [item for item in items if id(item) not in left_out]
    return Exported(name=_name(title, fmt), mime=MIME[fmt], data=data, count=len(sent), skipped=skipped,
                    pictures_lost=sum(1 for item in sent if item.pictures))
