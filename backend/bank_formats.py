"""Банк вопросов из CSV, HTML, PDF и Moodle XML: блоки для разбора по правилам (bank_parse).

CSV — таблица (разделитель «,», «;» или табуляция — тот, что даёт одинаковое число ячеек в строках; кодировка — как у
TXT, bank_parse.decode_text). HTML — абзацы, пункты списков с номерами и буквами, как их показывает браузер, заголовки
(уровень — как у заголовка Word), таблицы; оформление — теги и style: жирный (b, strong, font-weight), подчёркивание,
курсив, цвет, выделение (mark, background), моноширинный (code, pre); флажок и радиокнопка (checked) — отметка варианта;
картинка — флаг has_image (её не скачиваем). PDF — текстовый слой PyPDF2 (уже в зависимостях): строки как у
page.extract_text, жирный и курсив — по имени шрифта («Arial-BoldMT»); PDF без текста — скан, BankError 422 scan_pdf.
Moodle XML — вопросы целиком (multichoice, truefalse, shortanswer, numerical, matching, essay) с ответами из разметки;
выпуск 49: пояснение (generalfeedback, иначе отзыв верного ответа), ordering (порядок — как в файле), лишние правые
элементы соответствия, cloze (встроенные ответы {1:SHORTANSWER:=…} — пропуски; что из них брать, решает bank_parse).

Безопасность: Moodle XML читает defusedxml (выпуск 49), объявление DOCTYPE убрано до разбора; битый файл и HTML разбирает
lxml без подстановки сущностей и без сети; script, style и комментарии не читаются;
PDF — не больше PDF_MAX_PAGES страниц; из файла ничего не исполняется и ничего не скачивается.
"""

from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass, field
from typing import Optional

from bank_docx import Cell, Para, Run, Table

__all__ = ["MoodleQuestion", "PdfScan", "read_csv", "read_html", "read_moodle", "read_pdf"]

MAX_CELLS = 200_000
MAX_COLUMNS = 32
PDF_MAX_PAGES = 300
# Меньше этого числа видимых знаков на страницу в среднем — текста в PDF нет (скан или картинки).
PDF_SCAN_CHARS_PER_PAGE = 20


class PdfScan(ValueError):
    """В PDF нет текстового слоя: скан или страницы-картинки."""


# ── CSV ─────────────────────────────────────────────────────────────────────────


def _csv_rows(text: str, delimiter: str) -> list[list[str]]:
    return list(csv.reader(io.StringIO(text), delimiter=delimiter))


def _delimiter(text: str) -> str:
    """Разделитель, при котором строки начала файла делятся на одинаковое число ячеек (2 и больше)."""
    sample = "\n".join(text.split("\n")[:30])
    best, best_score = ",", -1.0
    for delimiter in (";", "\t", ",", "|"):
        try:
            rows = [row for row in _csv_rows(sample, delimiter) if any(cell.strip() for cell in row)]
        except csv.Error:
            continue
        if not rows:
            continue
        widths = [len(row) for row in rows]
        common = max(set(widths), key=widths.count)
        if common < 2:
            continue
        score = widths.count(common) / len(widths) + common / 100
        if score > best_score:
            best, best_score = delimiter, score
    return best


def _cell(text: str) -> Cell:
    paras = [Para(runs=[Run(text=line.strip())]) for line in text.replace("\r\n", "\n").split("\n") if line.strip()]
    return Cell(paras=paras)


def read_csv(text: str) -> Table:
    """Таблица CSV: строка — строка таблицы; перевод строки внутри ячейки — абзац ячейки. Номера строк — как в файле."""
    rows: list[list[Cell]] = []
    numbers: list[int] = []
    cells = 0
    old_limit = csv.field_size_limit()
    csv.field_size_limit(max(old_limit, 1_000_000))
    try:
        for number, row in enumerate(csv.reader(io.StringIO(text), delimiter=_delimiter(text)), start=1):
            if not any(value.strip() for value in row):
                continue
            row = row[:MAX_COLUMNS]
            cells += len(row)
            if cells > MAX_CELLS:
                raise ValueError("too many cells")
            rows.append([_cell(value) for value in row])
            numbers.append(number)
    finally:
        csv.field_size_limit(old_limit)
    width = max((len(row) for row in rows), default=0)
    rows = [row + [Cell(paras=[]) for _ in range(width - len(row))] for row in rows]
    return Table(rows=rows, numbers=numbers, title="CSV")


# ── HTML ────────────────────────────────────────────────────────────────────────

_BLOCK_TAGS = {"p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6", "pre", "blockquote", "dt", "dd", "section", "article",
               "header", "footer", "main", "fieldset", "legend", "figure", "figcaption", "address", "center", "form", "label"}
_SKIP_TAGS = {"script", "style", "head", "noscript", "template", "svg", "math", "button", "select", "textarea", "iframe"}
_COLORS = {"red": "FF0000", "green": "00B050", "blue": "0070C0", "orange": "FFC000", "purple": "7030A0", "magenta": "FF00FF"}
_STYLE_RE = re.compile(r"([a-z-]+)\s*:\s*([^;]+)", re.I)
_SPACE_RE = re.compile(r"[ \t\r\n\f ]+")


def _style(element) -> dict:
    out: dict = {}
    for name, value in _STYLE_RE.findall(element.get("style") or ""):
        name, value = name.lower(), value.strip().lower()
        if name == "font-weight" and (value in ("bold", "bolder") or value.isdigit() and int(value) >= 600):
            out["bold"] = True
        elif name in ("text-decoration", "text-decoration-line") and "underline" in value:
            out["underline"] = True
        elif name == "font-style" and value in ("italic", "oblique"):
            out["italic"] = True
        elif name == "color":
            color = _color(value)
            if color:
                out["color"] = color
        elif name in ("background", "background-color", "mso-highlight") and not value.startswith(("transparent", "white", "#fff", "none")):
            out["highlight"] = value.split()[0][:20]
        elif name == "font-family" and any(mono in value for mono in ("courier", "consolas", "mono")):
            out["mono"] = True
    return out


def _color(value: str) -> Optional[str]:
    value = value.strip().lower()
    if value.startswith("#") and len(value) in (4, 7):
        hex_value = value[1:] if len(value) == 7 else "".join(char * 2 for char in value[1:])
        return None if hex_value.upper() in ("000000", "FFFFFF") else hex_value.upper()
    match = re.match(r"rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)", value)
    if match:
        hex_value = "".join(f"{min(255, int(part)):02X}" for part in match.groups())
        return None if hex_value in ("000000", "FFFFFF") else hex_value
    return _COLORS.get(value) or (value.upper()[:20] if value not in ("black", "windowtext", "inherit", "auto", "white") else None)


def _tag_marks(tag: str) -> dict:
    return {"b": {"bold": True}, "strong": {"bold": True}, "u": {"underline": True}, "ins": {"underline": True},
            "i": {"italic": True}, "em": {"italic": True}, "s": {"strike": True}, "strike": {"strike": True},
            "del": {"strike": True}, "mark": {"highlight": "yellow"}, "code": {"mono": True}, "tt": {"mono": True},
            "kbd": {"mono": True}, "samp": {"mono": True}, "pre": {"mono": True}}.get(tag, {})


@dataclass
class _ListState:
    kind: str  # "ol" | "ul"
    style: str = "1"
    counter: int = 0


@dataclass
class _HtmlReader:
    out: list = field(default_factory=list)
    current: Optional[Para] = None
    lists: list = field(default_factory=list)

    def open_para(self, label: str = "", level: Optional[int] = None, outline: Optional[int] = None) -> Para:
        self.close_para()
        self.current = Para(label=label, level=level, outline=outline)
        return self.current

    def close_para(self) -> None:
        if self.current is not None:
            para = self.current
            text = para.text
            if text.strip() or para.images or para.checkbox is not None:
                # пробелы по краям абзаца браузер не показывает
                lead = len(text) - len(text.lstrip())
                if lead and para.runs:
                    para.runs[0] = Run(**{**para.runs[0].__dict__, "text": para.runs[0].text.lstrip()})
                self.out.append(para)
            self.current = None

    def text(self, value: Optional[str], marks: dict, pre: bool) -> None:
        if not value:
            return
        if not pre:
            value = _SPACE_RE.sub(" ", value)
        if self.current is None:
            if not value.strip():
                return
            self.open_para()
        para = self.current
        if not pre and para.runs and para.runs[-1].text.endswith(" ") and value.startswith(" "):
            value = value[1:]
        if not para.runs and not pre:
            value = value.lstrip()
        if not value:
            return
        lines = value.split("\n") if pre else [value]
        for k, line in enumerate(lines):
            if k:
                self.close_para()
                self.open_para()
                para = self.current
            if line:
                para.runs.append(Run(text=line, bold=bool(marks.get("bold")), underline=bool(marks.get("underline")),
                                     italic=bool(marks.get("italic")), strike=bool(marks.get("strike")),
                                     highlight=marks.get("highlight"), color=marks.get("color"), mono=bool(marks.get("mono"))))

    def label(self, state: _ListState) -> str:
        state.counter += 1
        n = state.counter
        if state.kind == "ul":
            return ""
        if state.style == "a":
            return _letters(n, "abcdefghijklmnopqrstuvwxyz") + ")"
        if state.style == "A":
            return _letters(n, "ABCDEFGHIJKLMNOPQRSTUVWXYZ") + ")"
        if state.style in ("i", "I"):
            roman = _roman(n)
            return (roman.lower() if state.style == "i" else roman) + "."
        return f"{n}."

    def walk(self, element, marks: dict, pre: bool = False) -> None:
        tag = element.tag.lower() if isinstance(element.tag, str) else ""
        if not tag or tag in _SKIP_TAGS:
            self.text(element.tail, marks, pre) if tag else None
            return
        mine = {**marks, **_tag_marks(tag), **_style(element)}
        if tag == "font" and element.get("color"):
            color = _color(element.get("color"))
            if color:
                mine["color"] = color
        pre = pre or tag == "pre"
        if tag == "table":
            self.close_para()
            self.out.append(self.table(element, mine))
            self.text(element.tail, marks, pre)
            return
        if tag == "br":
            if pre:
                self.text("\n", mine, True)
            else:
                self.close_para()
            self.text(element.tail, marks, pre)
            return
        if tag == "img":
            if self.current is None:
                self.open_para()
            self.current.images.append("")  # картинку из HTML не скачиваем: вопрос получит has_image
            self.text(element.tail, marks, pre)
            return
        if tag == "input" and (element.get("type") or "").lower() in ("checkbox", "radio"):
            if self.current is None:
                self.open_para()
            if self.current.text.strip():
                self.close_para()
                self.open_para()
            self.current.checkbox = element.get("checked") is not None
            self.text(element.tail, marks, pre)
            return
        if tag in ("ol", "ul"):
            self.close_para()
            start = element.get("start")
            state = _ListState(kind=tag, style=(element.get("type") or "1") if tag == "ol" else "")
            if start and start.isdigit():
                state.counter = int(start) - 1
            self.lists.append(state)
            self.children(element, mine, pre)
            self.lists.pop()
            self.close_para()
            self.text(element.tail, marks, pre)
            return
        if tag == "li":
            state = self.lists[-1] if self.lists else _ListState(kind="ul")
            label = self.label(state)
            level = len(self.lists) - 1 if self.lists else 0
            self.open_para(label=label, level=level or None)
            self.children(element, mine, pre)
            self.close_para()
            self.text(element.tail, marks, pre)
            return
        if tag in _BLOCK_TAGS:
            heading = int(tag[1]) if re.fullmatch(r"h[1-6]", tag) else None
            if self.current is not None and self.current.label and not self.current.text.strip() and heading is None:
                pass  # «<li><p>…</p></li>»: первый абзац пункта — продолжение пункта, номер остаётся у него
            else:
                self.close_para()
                if heading is not None:
                    self.open_para(outline=heading)
            self.children(element, mine, pre)
            self.close_para()
            self.text(element.tail, marks, pre)
            return
        self.children(element, mine, pre)
        self.text(element.tail, marks, pre)

    def children(self, element, marks: dict, pre: bool) -> None:
        self.text(element.text, marks, pre)
        for child in element:
            if isinstance(child.tag, str):
                self.walk(child, marks, pre)
            else:  # комментарий, инструкция: только хвост
                self.text(child.tail, marks, pre)

    def table(self, element, marks: dict) -> Table:
        rows: list[list[Cell]] = []
        pending: dict[int, int] = {}  # столбец → сколько ещё строк его занимает rowspan сверху
        for tr in element.iter("tr"):
            if _nearest_table(tr) is not element:
                continue
            cells: list[Cell] = []
            column = 0
            for td in tr:
                if not isinstance(td.tag, str) or td.tag.lower() not in ("td", "th"):
                    continue
                while pending.get(column):
                    pending[column] -= 1
                    cells.append(Cell(paras=[], continuation=True))
                    column += 1
                inner = _HtmlReader()
                inner.children(td, {**marks, **_tag_marks(td.tag.lower()), **_style(td)}, False)
                inner.close_para()
                paras = [block for block in inner.out if isinstance(block, Para)]
                for block in inner.out:  # вложенная таблица — строками этой ячейки
                    if isinstance(block, Table):
                        paras += [Para(runs=[Run(text=" | ".join(cell.text for cell in row if cell.text))]) for row in block.rows]
                span = _int(td.get("colspan"), 1)
                cells.append(Cell(paras=paras, span=span))
                rowspan = _int(td.get("rowspan"), 1)
                if rowspan > 1:
                    pending[column] = rowspan - 1
                column += span
            while pending.get(column):
                pending[column] -= 1
                cells.append(Cell(paras=[], continuation=True))
                column += 1
            if cells:
                rows.append(cells)
        return Table(rows=rows)


def _nearest_table(tr):
    parent = tr.getparent()
    while parent is not None and (not isinstance(parent.tag, str) or parent.tag.lower() != "table"):
        parent = parent.getparent()
    return parent


def _int(value: Optional[str], default: int) -> int:
    try:
        return max(1, min(50, int(value))) if value else default
    except ValueError:
        return default


def _letters(n: int, alphabet: str) -> str:
    return alphabet[(n - 1) % len(alphabet)] * ((n - 1) // len(alphabet) + 1)


def _roman(n: int) -> str:
    out = ""
    for value, digits in ((1000, "M"), (900, "CM"), (500, "D"), (400, "CD"), (100, "C"), (90, "XC"), (50, "L"), (40, "XL"),
                          (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I")):
        while n >= value:
            out += digits
            n -= value
    return out


def read_html(contents: bytes) -> list:
    """Блоки HTML-страницы (Para и Table) в порядке документа."""
    from lxml import html as lxml_html

    parser = lxml_html.HTMLParser(remove_comments=True, remove_pis=True, no_network=True, recover=True, encoding=_html_encoding(contents))
    root = lxml_html.document_fromstring(contents, parser=parser)
    body = root.find("body")
    reader = _HtmlReader()
    reader.children(body if body is not None else root, {}, False)
    reader.close_para()
    return reader.out


def _html_encoding(contents: bytes) -> str:
    head = contents[:4096].decode("ascii", errors="ignore").lower()
    match = re.search(r"charset\s*=\s*[\"']?([a-z0-9_-]+)", head)
    if match:
        name = match.group(1)
        try:
            "".encode(name)
            return name
        except LookupError:
            pass
    try:
        contents.decode("utf-8")
        return "utf-8"
    except UnicodeDecodeError:
        return "cp1251"


# ── PDF (PyPDF2) ────────────────────────────────────────────────────────────────

_BOLD_FONT_RE = re.compile(r"bold|black|heavy|semibold|demi|,b(?![a-z])", re.I)
_ITALIC_FONT_RE = re.compile(r"italic|oblique|,i(?![a-z])", re.I)


def _page_paras(page) -> list[Para]:
    """Строки страницы, как их отдаёт page.extract_text, с жирным и курсивом по имени шрифта (посимвольно сопоставлены
    с кусками визитёра PyPDF2; не сошлись — строки без оформления)."""
    pieces: list[tuple[str, bool, bool]] = []

    def visit(text, cm, tm, font, size):
        if text:
            name = str((font or {}).get("/BaseFont") or "")
            pieces.append((text, bool(_BOLD_FONT_RE.search(name)), bool(_ITALIC_FONT_RE.search(name))))

    text = page.extract_text(visitor_text=visit) or ""
    styled = [(char, bold, italic) for piece, bold, italic in pieces for char in piece if not char.isspace()]
    visible = [char for char in text if not char.isspace()]
    aligned = len(styled) == len(visible) and all(a == b for (a, _, _), b in zip(styled, visible))
    paras: list[Para] = []
    k = 0
    for line in text.split("\n"):
        runs: list[Run] = []
        for char in line:
            bold = italic = False
            if not char.isspace():
                if aligned:
                    _, bold, italic = styled[k]
                k += 1
            if runs and runs[-1].bold == bold and runs[-1].italic == italic:
                runs[-1].text += char
            else:
                runs.append(Run(text=char, bold=bold, italic=italic))
        paras.append(Para(runs=runs))
    return paras


def read_pdf(contents: bytes) -> list[Para]:
    """Строки текстового слоя PDF (абзац — строка; между страницами — пустая строка). PdfScan — текста нет."""
    from PyPDF2 import PdfReader

    reader = PdfReader(io.BytesIO(contents))
    if reader.is_encrypted:
        reader.decrypt("")  # PDF с пустым паролем на открытие читается; с паролем — ошибка, файл не прочитан
    pages = reader.pages
    count = min(len(pages), PDF_MAX_PAGES)
    out: list[Para] = []
    visible = 0
    for index in range(count):
        paras = _page_paras(pages[index])
        visible += sum(len("".join(para.text.split())) for para in paras)
        out += paras + [Para()]
    if visible < max(1, count) * PDF_SCAN_CHARS_PER_PAGE:
        raise PdfScan("no text layer")
    return out


# ── Moodle XML ──────────────────────────────────────────────────────────────────


@dataclass
class MoodleQuestion:
    """Вопрос Moodle XML: вид Moodle, текст, варианты и их доли (fraction), пары соответствия, категория."""

    kind: str
    text: str
    options: list[str] = field(default_factory=list)
    fractions: list[float] = field(default_factory=list)
    single: bool = True
    answers: list[str] = field(default_factory=list)
    pairs: list[tuple[str, str]] = field(default_factory=list)
    tolerances: list[str] = field(default_factory=list)  # numerical: допуск каждого верного ответа (выпуск 48)
    category: Optional[str] = None
    images: int = 0
    # выпуск 49
    explanation: str = ""  # generalfeedback, иначе отзыв первого верного ответа
    extras: list[str] = field(default_factory=list)  # matching: правые элементы без пары (лишние)
    cloze_text: str = ""  # cloze: текст, где на месте каждого встроенного ответа стоит GAP_MARK
    cloze: list[tuple[str, list[tuple[float, str]]]] = field(default_factory=list)  # cloze: (вид, [(доля, ответ)]) по пропускам


_WHOLE_PRE_RE = re.compile(r"^\s*<pre(?:\s[^>]*)?>(.*)</pre>\s*$", re.S | re.I)
_BR_RE = re.compile(r"<br\s*/?>", re.I)


def _html_text(value: Optional[str]) -> tuple[str, int]:
    """Текст из HTML-поля Moodle (абзацы и <br> — строки, <pre> — как написан) и число картинок в нём."""
    if not value or not value.strip():
        return "", 0
    if "<" not in value:
        return value.strip(), 0
    whole_pre = _WHOLE_PRE_RE.match(value)
    if whole_pre and "<img" not in value.lower() and "</pre" not in whole_pre.group(1).lower():  # выпуск 49: поле — код целиком (<pre>): отступы строк сохраняются
        import html as _html

        inner = _BR_RE.sub("\n", whole_pre.group(1))
        return _html.unescape(re.sub(r"<[^>]+>", "", inner)).strip("\n").rstrip(), 0
    blocks = read_html(f"<html><body>{value}</body></html>".encode("utf-8"))
    lines: list[str] = []
    images = 0
    for block in blocks:
        if isinstance(block, Para):
            images += len(block.images)
            if block.text.strip() or block.code_blank:
                lines.append((block.label + " " if block.label else "") + block.text.rstrip())
        else:
            lines += [" | ".join(cell.text for cell in row if cell.text) for row in block.rows]
    return "\n".join(lines).strip(), images


def _fraction(value: Optional[str]) -> float:
    try:
        return float(value or 0)
    except ValueError:
        return 0.0


# Встроенный ответ cloze (Moodle multianswer): {1:SHORTANSWER:=Берлин#верно~%50%Berlin}. Вид — как в Moodle
# (question/type/multianswer, ANSWER_TYPE_DEF_REGEX), ответы через «~», доля «=» или «%50%», отзыв после «#»; «\\»
# экранирует знак. Пропуск в тексте — GAP_MARK (знак из личной области Unicode: в тексте вопроса его не бывает).
GAP_MARK = chr(0xE000)
# «(?<!\\)»: экранированная «\{» встроенный ответ не начинает (иначе каждая такая скобка — просмотр до конца текста).
_CLOZE_RE = re.compile(r"(?<!\\)\{(\d*):([A-Za-z_]{2,40}):((?:\\.|[^\\{}])*)\}", re.S)
_CLOZE_ALT_RE = re.compile(r"^(=|%(-?\d+(?:[.,]\d*)?)%)?(.*)$", re.S)
MAX_CLOZE_EMBEDS = 40
MAX_CLOZE_TEXT = 20_000  # знаков HTML текста cloze: длиннее — не cloze, а открытый вопрос, как раньше


def _cloze_answer(value: str) -> str:
    """Текст встроенного ответа: экранирование снято, HTML — текстом, пробелы — одним."""
    import html as _html

    value = re.sub(r"\\(.)", r"\1", value)
    value = _html_text(value)[0] if "<" in value else _html.unescape(value)
    return " ".join(value.split())


def _cloze_embeds(raw: str) -> tuple[str, list[tuple[str, list[tuple[float, str]]]]]:
    """Текст cloze с GAP_MARK на месте встроенных ответов и их разбор: (вид в верхнем регистре, [(доля, ответ)])."""
    embeds: list[tuple[str, list[tuple[float, str]]]] = []
    if len(raw or "") > MAX_CLOZE_TEXT:
        return raw or "", embeds

    def swap(match: "re.Match[str]") -> str:
        if len(embeds) >= MAX_CLOZE_EMBEDS:
            return match.group(0)
        alternatives: list[tuple[float, str]] = []
        for part in re.split(r"(?<!\\)~", match.group(3)):
            found = _CLOZE_ALT_RE.match(part.strip())
            if not found or not found.group(3).strip():
                continue
            if found.group(1) == "=":
                weight = 100.0
            elif found.group(2):
                weight = float(found.group(2).replace(",", ".") or 0)
            else:
                weight = 0.0
            answer = re.split(r"(?<!\\)#", found.group(3), maxsplit=1)[0]
            alternatives.append((weight, _cloze_answer(answer)))
        embeds.append((match.group(2).upper(), alternatives))
        return GAP_MARK

    text = _CLOZE_RE.sub(swap, raw or "")
    return text, embeds


def _feedback(element) -> str:
    """Текст отзыва (generalfeedback, feedback): HTML — текстом."""
    if element is None:
        return ""
    return _html_text(element.findtext("text"))[0]


PROLOG_SCAN_BYTES = 64 * 1024  # объявление XML, комментарии и DOCTYPE ищутся только в начале файла
MAX_XML_DEPTH = 256  # вложенность элементов: у Moodle — 6–8 уровней; глубже — не вопросы, а ловушка для памяти
MAX_XML_ELEMENTS = 400_000  # у вопроса Moodle — до 30–40 элементов; 2000 вопросов банка — около 80 000


class XmlRefused(ValueError):
    """Файл не читается вовсе: дерево было бы слишком глубоким или слишком большим для памяти."""


class XmlTooDeep(XmlRefused):
    """Элементы вложены глубже MAX_XML_DEPTH."""


class XmlTooBig(XmlRefused):
    """Элементов больше MAX_XML_ELEMENTS."""


def _prolog_end(data: bytes) -> int:
    """Где кончается пролог: BOM, пробелы, <?xml …?> и комментарии в первых PROLOG_SCAN_BYTES байтах (один проход)."""
    limit = min(len(data), PROLOG_SCAN_BYTES)
    at = 3 if data.startswith(b"\xef\xbb\xbf") else 0
    while at < limit:
        if data[at] in (0x20, 0x09, 0x0D, 0x0A):
            at += 1
        elif data.startswith(b"<?", at):
            end = data.find(b"?>", at + 2, limit)
            if end < 0:
                break
            at = end + 2
        elif data.startswith(b"<!--", at):
            end = data.find(b"-->", at + 4, limit)
            if end < 0:
                break
            at = end + 3
        else:
            break
    return at


def _without_doctype(contents: bytes) -> bytes:
    """Файл без объявления DOCTYPE (выпуск 49). Moodle его не пишет; в файле он нужен только для сущностей — внешних
    (чтение файлов и сети) и вложенных («миллиард смехов»). lxml их и так не подставляет, но с ними обрывает разбор и
    теряет вопросы после них; без объявления неизвестная сущность просто пропадает из текста.

    Убирается только DOCTYPE пролога (не «<!DOCTYPE html>» в тексте вопроса), без регулярных выражений: поиск вперёд в
    первых PROLOG_SCAN_BYTES байтах, время линейное. Объявление, которое так не найти (внутренний набор с «]» в
    значении, слишком длинный), остаётся: defusedxml его не примет, а lxml прочтёт файл без DTD и без сети."""
    start = _prolog_end(contents)
    if contents[start:start + 9].upper() != b"<!DOCTYPE":
        return contents
    limit = min(len(contents), start + PROLOG_SCAN_BYTES)
    close = contents.find(b">", start, limit)
    bracket = contents.find(b"[", start, limit)
    if bracket >= 0 and (close < 0 or bracket < close):
        subset_end = contents.find(b"]", bracket, limit)
        close = contents.find(b">", subset_end, limit) if subset_end >= 0 else -1
        if close < 0 or contents[subset_end + 1:close].strip():
            return contents
    elif close < 0:
        return contents
    return contents[:start] + contents[close + 1:]


class _DepthLimited:
    """Сборщик дерева для defusedxml, который останавливает файл глубже MAX_XML_DEPTH (XmlTooDeep) и больше
    MAX_XML_ELEMENTS элементов (XmlTooBig): дерево не растёт сверх этого в памяти."""

    def __init__(self) -> None:
        from xml.etree.ElementTree import TreeBuilder

        self.builder = TreeBuilder()
        self.depth = 0
        self.count = 0

    def start(self, tag, attrs):
        self.depth += 1
        self.count += 1
        if self.depth > MAX_XML_DEPTH:
            raise XmlTooDeep(f"deeper than {MAX_XML_DEPTH}")
        if self.count > MAX_XML_ELEMENTS:
            raise XmlTooBig(f"more than {MAX_XML_ELEMENTS} elements")
        return self.builder.start(tag, attrs)

    def end(self, tag):
        self.depth -= 1
        return self.builder.end(tag)

    def data(self, text):
        return self.builder.data(text)

    def close(self):
        return self.builder.close()


def _moodle_root(contents: bytes):
    """Корень Moodle XML (выпуск 49). Сначала defusedxml (expat без DTD, сущностей и внешних ссылок, вложенность — до
    MAX_XML_DEPTH, элементов — до MAX_XML_ELEMENTS); файл, который так не читается (оборван, битая разметка, неизвестная сущность), — lxml в режиме
    восстановления, тоже без подстановки сущностей, без сети и без огромных деревьев (huge_tree=False): он читает то,
    что можно, как раньше. Слишком глубокий или слишком большой файл не читается вовсе (XmlRefused)."""
    data = _without_doctype(contents)
    try:
        from defusedxml.ElementTree import DefusedXMLParser

        parser = DefusedXMLParser(target=_DepthLimited(), forbid_dtd=True, forbid_entities=True, forbid_external=True)
        parser.feed(data)
        return parser.close()
    except XmlRefused:
        raise
    except Exception as exc:  # ParseError, DTDForbidden…: читаем бережно, как до выпуска 49
        print(f"Moodle XML read with recovery: {type(exc).__name__}")
    from lxml import etree

    parser = etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False, huge_tree=False, recover=True)
    return etree.fromstring(data, parser)


def read_moodle(contents: bytes) -> list[MoodleQuestion]:
    """Вопросы Moodle XML по порядку. Неизвестный вид (перетаскивание…) — открытый вопрос с текстом."""
    root = _moodle_root(contents)
    if root is None:
        raise ValueError("empty xml")
    out: list[MoodleQuestion] = []
    category: Optional[str] = None
    for question in root.iter("question"):
        kind = (question.get("type") or "").lower()
        if kind == "category":
            path = question.findtext("category/text") or ""
            category = path.strip().split("/")[-1].strip() or None
            if category in ("$course$", "$system$", "top", "Default for"):
                category = None
            continue
        if kind == "description":
            continue
        text, images = _html_text(question.findtext("questiontext/text"))
        item = MoodleQuestion(kind=kind, text=text, category=category, images=images)
        if kind in ("multichoice", "truefalse", "shortanswer", "numerical"):
            for answer in question.findall("answer"):
                option, _ = _html_text(answer.findtext("text"))
                item.options.append(option)
                item.fractions.append(_fraction(answer.get("fraction")))
            item.single = (question.findtext("single") or "true").strip().lower() not in ("false", "0")
            if kind in ("shortanswer", "numerical"):
                item.answers = [option for option, fraction in zip(item.options, item.fractions) if fraction >= 100]
                if kind == "numerical":
                    item.tolerances = [(answer.findtext("tolerance") or "").strip()
                                       for answer in question.findall("answer") if _fraction(answer.get("fraction")) >= 100]
                item.options, item.fractions = [], []
        elif kind == "matching":
            for sub in question.findall("subquestion"):
                left, _ = _html_text(sub.findtext("text"))
                right = (sub.findtext("answer/text") or "").strip()
                if left:
                    item.pairs.append((left, right))
                elif right:
                    item.extras.append(right)  # выпуск 49: подвопрос без текста — лишний правый элемент
        elif kind == "ordering":
            # выпуск 49 (qtype_ordering): элементы в верном порядке — в порядке <answer> в файле, как их читает Moodle
            for answer in question.findall("answer"):
                option, _ = _html_text(answer.findtext("text"))
                item.options.append(option)
        elif kind == "cloze":
            raw = question.findtext("questiontext/text") or ""
            marked, item.cloze = _cloze_embeds(raw)  # длиннее MAX_CLOZE_TEXT — без пропусков: открытый вопрос
            if item.cloze:
                item.cloze_text, _ = _html_text(marked)
        item.explanation = _feedback(question.find("generalfeedback"))
        if not item.explanation:
            for answer in question.findall("answer"):
                if _fraction(answer.get("fraction")) >= 100 and kind != "ordering":
                    item.explanation = _feedback(answer.find("feedback"))
                    break
        out.append(item)
    return out
