"""DOCX банка тестовых вопросов («Тест с вариантами»): блоки документа с оформлением.

Блоки идут в порядке документа: абзац (Para — куски текста с оформлением, номер автонумерации Word,
счётчики картинок, формул и флажков) и таблица (Table — строки ячеек; продолжение объединённой ячейки
помечено, заливка ячейки сохранена). Текст не сплющивается в строку: ключ, отмеченный жирным,
подчёркиванием, выделением, цветом шрифта или заливкой, доходит до разбора (bank_parse.py), а код
остаётся как написан — «#region», «+=», «--», «items?.Count ?? 0».

Обход тела и счётчики автонумерации — те же, что у устного разбора (parser._DocxReader): подкласс
только добавляет оформление, parser.py не меняется, и его _extract_docx возвращает прежний текст.
Буквенная автонумерация («а)», «б)» — russianLower, «a)» — lowerLetter) показывается так же, как в Word.
Надписи Word с вопросами (вёрстка колонками в надписях: строка «N. …» и ещё две строки) читаются абзацами сразу
после абзаца, к которому привязаны; прочие надписи (подписи схем) — как раньше: картинка без текста, флаг has_image.

Безопасность: до python-docx архив проверяется по объявленным размерам распакованных частей
(check_archive: zip-бомба не распаковывается — zipfile не отдаёт больше объявленного размера части),
XML разбирает парсер python-docx без подстановки сущностей (resolve_entities=False), из файла ничего
не исполняется.
"""

from __future__ import annotations

import hashlib
import io
import re
import zipfile
from dataclasses import dataclass, field
from typing import Optional, Union

import parser as docx_text  # backend/parser.py: обход тела и автонумерация (только чтение)
from parser import _W_NS, _w, _w_val

__all__ = [
    "ArchiveTooLarge",
    "Block",
    "Cell",
    "LATIN_LOWER",
    "MAX_ARCHIVE_BYTES",
    "MAX_XML_PART_BYTES",
    "Para",
    "RUSSIAN_LOWER",
    "RichDocxReader",
    "Run",
    "Table",
    "TooComplex",
    "check_archive",
    "check_markup",
    "is_code",
    "read_docx",
]

# Распакованный document.xml банка на 50 вопросов — около 0,2 МБ, на 2000 — около 8 МБ: пределы с запасом.
MAX_XML_PART_BYTES = 40 * 1024 * 1024  # одна часть XML (document.xml, styles.xml…)
MAX_ARCHIVE_BYTES = 96 * 1024 * 1024  # весь архив распакованным (картинки почти не сжимаются: ≈ размер файла)
MAX_ARCHIVE_ENTRIES = 5000
# Разметка, несоразмерная тексту (обзор 2026-11-04: DOCX в 198 КБ с document.xml в 40 МБ из пустых кусков оформления
# разбирался 10 с и брал 626 МБ памяти): считается потоком до разбора по всем частям XML, такой файл не разбирается. Банк на 2000 вопросов —
# десятки тысяч кусков (корпус: до 2311, по 24–70 знаков на кусок); 2 000 000 знаков по 7 на кусок — меньше 300 000.
MAX_DOC_RUNS = 300_000
MAX_DOC_PARAGRAPHS = 300_000
# С этого числа элементов текста должен быть хотя бы байт на 4 элемента (в корпусе — больше байта на элемент).
MARKUP_ELEMENTS = 1_000_000
_SCAN_CHUNK = 1 << 20
# Элементы — по локальному имени при любом префиксе («w:r», «x:r» с тем же пространством имён, «a:r» рисунков).
_SCAN_PREFIX = rb"<(?:[A-Za-z_][\w.\-]*:)?"
_SCAN_RUN_RE = re.compile(_SCAN_PREFIX + rb"r[\s/>]")
_SCAN_PARA_RE = re.compile(_SCAN_PREFIX + rb"p[\s/>]")
_SCAN_STYLE_RE = re.compile(_SCAN_PREFIX + rb"style[\s/>]")
_SCAN_ELEMENT_RE = re.compile(rb"<[A-Za-z_]")
_SCAN_TEXT_RE = re.compile(_SCAN_PREFIX + rb"t(?:\s[^>]*)?>([^<]*)<")
# Стилей в документах Word — сотни; цепочка из 250 000 стилей разбиралась бы ещё до чтения (python-docx).
MAX_DOC_STYLES = 20_000

_M_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math"
_MC_NS = "http://schemas.openxmlformats.org/markup-compatibility/2006"
_W14_NS = "http://schemas.microsoft.com/office/word/2010/wordml"
_V_NS = "urn:schemas-microsoft-com:vml"
_A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
_R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
# Картинки, которые переносятся в вопрос (владелец, 2026-10-14: «картинки он не ест»): то, что браузер показывает сам.
# EMF/WMF (рисунки Word), TIFF — нет: такой вопрос остаётся с флагом has_image, как раньше.
PICTURE_TYPES = {"image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/bmp": "bmp"}
MAX_PICTURE_BYTES = 3 * 1024 * 1024

MONO_FONTS = ("courier", "consolas", "mono", "menlo", "lucida console", "source code", "fira code", "jetbrains")
_OFF = ("0", "false", "off", "none")
# Флажки и галочки шрифтов Wingdings / Symbol в w:sym (коды символов, как их пишет Word).
_SYM_CHECKED = {"F0FE", "F0FD", "F078", "F0FC", "F0FB", "F0D6", "F052", "F0D8"}
_SYM_EMPTY = {"F0A8", "F06F", "F071", "F0A1"}

# Алфавиты автонумерации Word (russianLower пропускает ё, й, ъ, ы, ь) — они же буквы вариантов в ключах.
RUSSIAN_LOWER = "абвгдежзиклмнопрстуфхцчшщэюя"
LATIN_LOWER = "abcdefghijklmnopqrstuvwxyz"
_LETTER_REPEATS = 4  # «аа», «ааа»…: дальше буквенный номер показывается числом (огромный startOverride)
_HEADING_NAME_RE = re.compile(r"(?:heading|заголовок)\s*([1-9])")
_TXBX = f"{{{_W_NS}}}txbxContent"
_MC_FALLBACK = f"{{{_MC_NS}}}Fallback"
# Надпись с вопросами (вёрстка в две колонки надписями): в ней строка с номером вопроса и ещё хотя бы две строки.
# Подписи схем («Вход», «Выход») так не выглядят: их текст по-прежнему не читается, картинка — флаг has_image.
_BOX_QUESTION_RE = re.compile(r"^\s*(?:\d{1,4}\s*[.)]|(?:вопрос|задание|пытанне|question)\s*№?\s*\d|№\s*\d)", re.I)


class ArchiveTooLarge(ValueError):
    """Распакованный архив больше пределов: zip-бомба или документ заведомо длиннее предела знаков."""


@dataclass
class Run:
    """Кусок текста с одним оформлением. Цвета — 'FF0000', 'theme:accent2' или None."""

    text: str
    bold: bool = False
    underline: bool = False
    italic: bool = False
    strike: bool = False
    highlight: Optional[str] = None
    color: Optional[str] = None
    shade: Optional[str] = None
    mono: bool = False
    hyperlink: bool = False


@dataclass
class Para:
    """Абзац: куски текста и номер автонумерации, как его показывает Word («3.», «а)»; '' — без номера)."""

    runs: list[Run] = field(default_factory=list)
    label: str = ""
    list_key: Optional[str] = None
    level: Optional[int] = None
    fmt: Optional[str] = None
    style: str = ""
    shade: Optional[str] = None  # заливка абзаца или его ячейки
    images: list[str] = field(default_factory=list)  # картинки по порядку: id из pictures читателя, "" — не переносится
    formulas: int = 0
    checkbox: Optional[bool] = None  # флажок в абзаце: символ ☑/☐ или элемент управления
    outline: Optional[int] = None  # уровень заголовка Word (1 — «Заголовок 1»), None — обычный текст
    code_blank: bool = False  # пустая строка внутри кода (пустой абзац ячейки между моноширинными)

    @property
    def text(self) -> str:
        return "".join(run.text for run in self.runs)


def is_code(para: Para) -> bool:
    """Весь видимый текст абзаца — моноширинным шрифтом (строка кода)."""
    visible = [run for run in para.runs if run.text.strip()]
    return bool(visible) and all(run.mono for run in visible)


@dataclass
class Cell:
    """Ячейка таблицы: абзацы с текстом (пустые отброшены, кроме пустых строк внутри кода), продолжение
    объединения, ширина в столбцах."""

    paras: list[Para]
    continuation: bool = False
    span: int = 1
    shade: Optional[str] = None

    @property
    def text(self) -> str:
        return "\n".join(p.text for p in self.paras if p.text.strip() or p.code_blank).strip()


@dataclass
class Table:
    """Строки ячеек. numbers — номера строк для «где» (лист XLSX: номер строки Excel), title — «лист 1»."""

    rows: list[list[Cell]]
    numbers: Optional[list[int]] = None
    title: str = ""


Block = Union[Para, Table]


class TooComplex(Exception):
    """В document.xml разметки несоразмерно больше, чем текста (check_markup): файл не разбирается."""


def _xml_part(head: bytes) -> Optional[bool]:
    """По первым байтам части: True — XML в UTF-8 (считаем), False — не XML (картинка), None — XML в UTF-16 или UTF-32
    (Word так не пишет, а побайтовый счёт его не видит: отказ)."""
    if head.startswith((b"\xff\xfe", b"\xfe\xff", b"\x00\x00\xfe\xff", b"<\x00", b"\x00<", b"\x00\x00\x00<")):
        return None
    return head.lstrip(b"\xef\xbb\xbf \t\r\n").startswith(b"<")


def check_markup(contents: bytes) -> None:
    """TooComplex, если во всех частях XML документа вместе (основная часть — как бы она ни называлась, колонтитулы,
    сноски, стили) больше MAX_DOC_RUNS кусков текста, больше MAX_DOC_PARAGRAPHS абзацев, больше MAX_DOC_STYLES стилей
    или больше MARKUP_ELEMENTS элементов при тексте меньше байта на 4 элемента. Элементы считаются по локальному имени
    при любом префиксе пространства имён («w:r», «x:r»). Части читаются потоком по 1 МБ и считаются по байтам (без
    разбора XML): несколько десятых секунды на 40 МБ, отказ — как только предел пройден. Часть XML не в UTF-8 — отказ."""
    runs = paragraphs = styles = elements = text = 0
    with zipfile.ZipFile(io.BytesIO(contents)) as archive:
        for info in archive.infolist():
            if info.is_dir():
                continue
            with archive.open(info) as part:
                tail = b""
                first = True
                while True:
                    chunk = part.read(_SCAN_CHUNK)
                    if first:
                        first = False
                        kind = _xml_part(chunk[:64])
                        if kind is None:
                            raise TooComplex(f"part {info.filename!r} is not UTF-8 XML")
                        if not kind:
                            break  # картинка и прочие не XML
                    data = tail + chunk
                    if chunk:
                        cut = data.rfind(b"<")
                        if cut < 0 or len(data) - cut > 2 * _SCAN_CHUNK:  # долго без «<»: это текст
                            text += len(data)
                            tail = b""
                            continue
                        # окно — до последнего «<» включительно (им кончается текст); с него начнётся следующее
                        window, tail = data[:cut + 1], data[cut:]
                    else:
                        window, tail = data, b""
                    runs += len(_SCAN_RUN_RE.findall(window))
                    paragraphs += len(_SCAN_PARA_RE.findall(window))
                    styles += len(_SCAN_STYLE_RE.findall(window))
                    elements += len(_SCAN_ELEMENT_RE.findall(window))
                    text += sum(len(found) for found in _SCAN_TEXT_RE.findall(window))
                    if runs > MAX_DOC_RUNS or paragraphs > MAX_DOC_PARAGRAPHS or styles > MAX_DOC_STYLES:
                        raise TooComplex(f"runs {runs}, paragraphs {paragraphs}, styles {styles}")
                    if not chunk:
                        break
    if elements > MARKUP_ELEMENTS and text * 4 < elements:
        raise TooComplex(f"elements {elements}, text {text}")


def check_archive(contents: bytes, *, max_part: Optional[int] = None, max_total: Optional[int] = None,
                  every_part: bool = False) -> list[str]:
    """Имена частей архива или ArchiveTooLarge / zipfile.BadZipFile — до того, как что-то распаковано.

    Смотрим объявленные размеры: zipfile не отдаёт больше объявленного (лишнее — ошибка CRC), поэтому
    предел по ним держит и для подделанного архива. Часть XML (.xml, .rels) — до max_part
    (MAX_XML_PART_BYTES), весь архив — до max_total (MAX_ARCHIVE_BYTES), частей — до MAX_ARCHIVE_ENTRIES.
    every_part — до max_part любая часть, как бы она ни называлась (банк: основная часть «word/main.dat» читается
    python-docx по ссылке из _rels/.rels так же, как document.xml).
    """
    max_part = MAX_XML_PART_BYTES if max_part is None else max_part
    max_total = MAX_ARCHIVE_BYTES if max_total is None else max_total
    with zipfile.ZipFile(io.BytesIO(contents)) as archive:
        infos = archive.infolist()
    if len(infos) > MAX_ARCHIVE_ENTRIES:
        raise ArchiveTooLarge(f"{len(infos)} entries")
    total = 0
    for info in infos:
        total += info.file_size
        if (every_part or info.filename.lower().endswith((".xml", ".rels"))) and info.file_size > max_part:
            raise ArchiveTooLarge(f"part {info.file_size} bytes")
    if total > max_total:
        raise ArchiveTooLarge(f"archive {total} bytes")
    return [info.filename for info in infos]


def _on(element) -> bool:
    if element is None:
        return False
    value = element.get(_w("val"))
    return value is None or value.lower() not in _OFF


def _outline_of(p_pr) -> Optional[int]:
    """Уровень заголовка из w:outlineLvl (0 → 1 … 8 → 9); 9 — основной текст — и отсутствие → None."""
    if p_pr is None:
        return None
    value = _w_val(p_pr.find(_w("outlineLvl")))
    if value is None or not value.isdecimal():
        return None
    level = int(value)
    return level + 1 if level <= 8 else 0  # 0: явно «основной текст», перекрывает уровень стиля


def _fill(element) -> Optional[str]:
    """Цвет заливки w:shd (без «auto» и белого) или None."""
    if element is None:
        return None
    fill = (element.get(_w("fill")) or "").upper()
    if fill and fill not in ("AUTO", "FFFFFF"):
        return fill
    return None


_TAG_B, _TAG_B_CS, _TAG_I, _TAG_STRIKE, _TAG_DSTRIKE = _w("b"), _w("bCs"), _w("i"), _w("strike"), _w("dstrike")
_TAG_I_CS, _TAG_RTL, _TAG_CS = _w("iCs"), _w("rtl"), _w("cs")
_TAG_U, _TAG_HIGHLIGHT, _TAG_COLOR, _TAG_SHD, _TAG_FONTS, _TAG_RSTYLE = (
    _w("u"), _w("highlight"), _w("color"), _w("shd"), _w("rFonts"), _w("rStyle")
)
_ATTR_VAL, _ATTR_THEME_COLOR, _ATTR_ASCII, _ATTR_HANSI = _w("val"), _w("themeColor"), _w("ascii"), _w("hAnsi")


def _marks_of(rpr) -> dict:
    """Оформление из w:rPr: только заданные в нём признаки (наследование — у вызывающего).

    Как find() по каждому тегу (берётся первый такой элемент), но за один проход по детям. Жирный и курсив для письма
    справа налево и сложных письменностей (w:bCs, w:iCs) — отдельные признаки bold_cs и italic_cs: Word применяет их
    только к такому тексту (кусок с w:rtl или w:cs, арабские и еврейские буквы), а кириллицу и латиницу показывает по
    w:b и w:i. Файлы колледжа (владелец, 2026-11-04) ставят w:bCs на неверные варианты: в Word они обычные, а читались
    жирными — ключ «1, 2, 3» вместо «1» и вопрос без ключа, когда w:bCs у всех пяти.
    """
    if rpr is None:
        return {}
    first: dict = {}
    for child in rpr:
        first.setdefault(child.tag, child)
    marks: dict = {}
    for tag, key in ((_TAG_B, "bold"), (_TAG_B_CS, "bold_cs"), (_TAG_I, "italic"), (_TAG_I_CS, "italic_cs"),
                     (_TAG_STRIKE, "strike"), (_TAG_DSTRIKE, "strike"), (_TAG_RTL, "rtl"), (_TAG_CS, "cs")):
        element = first.get(tag)
        if element is not None:
            marks[key] = _on(element)
    underline = first.get(_TAG_U)
    if underline is not None:
        marks["underline"] = (underline.get(_ATTR_VAL) or "single").lower() not in _OFF
    highlight = first.get(_TAG_HIGHLIGHT)
    if highlight is not None:
        value = (highlight.get(_ATTR_VAL) or "").lower()
        marks["highlight"] = None if value in ("", "none") else value
    color = first.get(_TAG_COLOR)
    if color is not None:
        value = (color.get(_ATTR_VAL) or "").upper()
        theme = color.get(_ATTR_THEME_COLOR)
        if theme and theme.lower() not in ("text1", "dark1"):
            marks["color"] = "theme:" + theme
        else:
            marks["color"] = None if value in ("", "AUTO", "000000") else value
    shade = _fill(first.get(_TAG_SHD))
    if shade:
        marks["shade"] = shade
    fonts = first.get(_TAG_FONTS)
    if fonts is not None:
        name = (fonts.get(_ATTR_ASCII) or fonts.get(_ATTR_HANSI) or "").lower()
        if name:
            marks["mono"] = any(mono in name for mono in MONO_FONTS)
    rstyle = first.get(_TAG_RSTYLE)
    if rstyle is not None:
        marks["rstyle"] = rstyle.get(_ATTR_VAL)
    return marks


# Буквы письменностей, которые Word оформляет признаками сложных письменностей (w:bCs, w:iCs): иврит, арабское,
# сирийское, тана, деванагари и другие индийские, тайское, лаосское; формы представления арабских и еврейских букв.
_COMPLEX_LETTER_RE = re.compile(r"[\u0590-\u08ff\u0900-\u0dff\u0e00-\u0eff\ufb1d-\ufdff\ufe70-\ufeff]")
_ANY_LETTER_RE = re.compile(r"[^\W\d_]")


def _complex_letters(text: str) -> Optional[str]:
    """Буквы сложной письменности (арабские, еврейские…) в куске: «all» — все буквы такие (кусок Word оформляет по
    w:bCs), «some» — вперемешку с латиницей или кириллицей («A) نص»: каждая часть — по своему признаку), None — нет."""
    if not _COMPLEX_LETTER_RE.search(text):
        return None
    return "all" if all(_COMPLEX_LETTER_RE.match(char) for char in _ANY_LETTER_RE.findall(text)) else "some"


# Стили (styles.xml): учитываются первые MAX_STYLES, цепочка basedOn — до MAX_STYLE_DEPTH от базового стиля (у Word —
# единицы; обзор 2026-11-04: цепочка в 250 000 стилей и 600 кусков на её глубоких стилях разбирались 94 с).
MAX_STYLES = 5000
MAX_STYLE_DEPTH = 32


class _Styles:
    """Оформление знаков и уровень заголовка у стилей абзаца и знака (цепочки basedOn разрешены). Каждый стиль
    разрешается один раз, поверх уже разрешённого базового (без рекурсии); стиль глубже MAX_STYLE_DEPTH и стили сверх
    MAX_STYLES не учитываются, как неизвестные."""

    def __init__(self, doc) -> None:
        self.styles: dict[str, dict] = {}
        self.names: dict[str, str] = {}
        self.based: dict[str, Optional[str]] = {}
        self.outlines: dict[str, Optional[int]] = {}
        self.default_para: Optional[str] = None
        # стиль → (оформление знаков, уровень заголовка (0 — явно «основной текст»), глубина от базового)
        self._resolved: dict[str, tuple[dict, Optional[int], int]] = {}
        try:
            root = doc.styles.element
        except Exception:
            return
        for style in root.iterchildren(_w("style")):
            style_id = style.get(_w("styleId"))
            if not style_id:
                continue
            if len(self.styles) >= MAX_STYLES:
                break
            if style.get(_w("type")) == "paragraph" and style.get(_w("default")) in ("1", "true", "on"):
                self.default_para = style_id
            self.names[style_id] = (_w_val(style.find(_w("name"))) or "").lower()
            self.based[style_id] = _w_val(style.find(_w("basedOn")))
            self.styles[style_id] = _marks_of(style.find(_w("rPr")))
            self.outlines[style_id] = _outline_of(style.find(_w("pPr")))

    def _resolve(self, style_id: Optional[str]) -> tuple[dict, Optional[int], int]:
        """(оформление, уровень, глубина) стиля: вверх по basedOn до разрешённого стиля, базового, неизвестного или
        петли, затем вниз, каждый — поверх своего базового."""
        path: list[str] = []
        seen: set[str] = set()
        current = style_id
        while current and current in self.styles and current not in self._resolved and current not in seen:
            seen.add(current)
            path.append(current)
            current = self.based.get(current)
        entry: tuple[dict, Optional[int], int] = self._resolved.get(current, ({}, None, -1)) if current else ({}, None, -1)
        for sid in reversed(path):
            marks, level, depth = entry
            depth += 1
            if depth >= MAX_STYLE_DEPTH:
                entry = ({}, None, depth)  # слишком глубоко: как неизвестный стиль (и всё, что на нём основано)
            else:
                own_level = self.outlines.get(sid)
                if own_level is None:
                    named = _HEADING_NAME_RE.fullmatch(self.names.get(sid, ""))
                    own_level = int(named.group(1)) if named else level
                entry = ({**marks, **self.styles[sid]}, own_level, depth)
            self._resolved[sid] = entry
        if not style_id or style_id not in self.styles:
            return {}, None, -1
        return self._resolved[style_id]

    def marks(self, style_id: Optional[str]) -> dict:
        return dict(self._resolve(style_id)[0])

    def outline(self, style_id: Optional[str]) -> Optional[int]:
        """Уровень заголовка стиля: outlineLvl по цепочке basedOn, иначе имя «heading N» / «Заголовок N»."""
        return self._resolve(style_id)[1] or None


def _letters(n: int, alphabet: str) -> str:
    """Буквенный номер Word: 1 → «а», 29 → «аа»; слишком большой номер — числом."""
    if n < 1 or n > len(alphabet) * _LETTER_REPEATS:
        return str(n)
    return alphabet[(n - 1) % len(alphabet)] * ((n - 1) // len(alphabet) + 1)


class RichDocxReader(docx_text._DocxReader):
    """Тот же обход и та же автонумерация, что у устного разбора, но блоки хранят куски с оформлением."""

    def __init__(self, doc) -> None:
        super().__init__(doc)
        self._styles = _Styles(doc)
        # картинки абзацев: sha256 содержимого → (тип, байты); одинаковая картинка в разных вопросах — одна
        self.pictures: dict[str, tuple[str, bytes]] = {}
        self._picture_ids: dict[str, str] = {}  # rId → id картинки ("" — не переносится)
        self._lifted: set = set()  # надписи с вопросами, чей текст читается абзацами после абзаца-якоря

    @staticmethod
    def _question_boxes(p) -> list:
        """Надписи абзаца, в которых вопросы (_BOX_QUESTION_RE): их абзацы читаются после него. Копия той же надписи для
        старых версий Word (mc:Fallback) пропускается."""
        boxes = []
        for box in p.iter(_TXBX):
            parent, fallback = box.getparent(), False
            while parent is not None and parent is not p:
                if parent.tag == _MC_FALLBACK:
                    fallback = True
                    break
                parent = parent.getparent()
            if fallback:
                continue
            texts = ["".join(t.text or "" for t in para.iter(f"{{{_W_NS}}}t")) for para in box.iter(docx_text._W_P)]
            texts = [text for text in texts if text.strip()]
            if len(texts) >= 3 and any(_BOX_QUESTION_RE.match(text) for text in texts):
                boxes.append(box)
        return boxes

    def _picture(self, element) -> str:
        """Картинка элемента (w:drawing, w:pict, w:object, mc:AlternateContent) → её id или "" (не переносится:
        тип не из PICTURE_TYPES, больше MAX_PICTURE_BYTES, ссылки нет)."""
        blip = element.find(f".//{{{_A_NS}}}blip")
        rid = blip.get(f"{{{_R_NS}}}embed") if blip is not None else None
        if rid is None:
            data = element.find(f".//{{{_V_NS}}}imagedata")
            rid = data.get(f"{{{_R_NS}}}id") if data is not None else None
        if not rid:
            return ""
        if rid in self._picture_ids:  # одна картинка тысячу раз — хэш один раз
            return self._picture_ids[rid]
        self._picture_ids[rid] = key = self._picture_key(rid)
        return key

    def _picture_key(self, rid: str) -> str:
        try:
            part = self._doc.part.related_parts[rid]
            kind, blob = part.content_type, part.blob
        except (KeyError, AttributeError):
            return ""
        if kind not in PICTURE_TYPES or not blob or len(blob) > MAX_PICTURE_BYTES:
            return ""
        key = hashlib.sha256(blob).hexdigest()
        self.pictures[key] = (kind, blob)
        return key

    def blocks(self) -> list[Block]:
        out: list[Block] = []
        self._walk_rich(self._doc.element.body, out)
        return out

    def _walk_rich(self, parent, out: list[Block]) -> None:
        for child in parent:
            tag = child.tag
            if tag == docx_text._W_P:
                # Пустые абзацы остаются: пустая строка между вопросами — граница блока.
                boxes = self._question_boxes(child) if child.find(f".//{_TXBX}") is not None else []
                self._lifted.update(boxes)
                out.append(self._rich_paragraph(child))
                for box in boxes:  # вопросы в надписях — абзацами после абзаца, к которому надпись привязана
                    out.append(Para())
                    self._walk_rich(box, out)
            elif tag == docx_text._W_TBL:
                out.append(self._rich_table(child))
            elif tag in (docx_text._W_SDT, docx_text._W_CUSTOM_XML):
                content = child.find(docx_text._W_SDT_CONTENT) if tag == docx_text._W_SDT else child
                if content is not None:
                    self._walk_rich(content, out)

    def _rich_table(self, tbl) -> Table:
        rows: list[list[Cell]] = []
        for tr in tbl.iter(docx_text._W_TR):
            if docx_text._nearest_table(tr) is not tbl:
                continue
            cells: list[Cell] = []
            for tc in docx_text._row_cells(tr):
                tc_pr = tc.find(_w("tcPr"))
                span = 1
                shade = None
                if tc_pr is not None:
                    try:
                        span = int(_w_val(tc_pr.find(_w("gridSpan"))) or 1)
                    except ValueError:
                        span = 1
                    shade = _fill(tc_pr.find(_w("shd")))
                paras: list[Para] = []
                blanks = 0  # пустые абзацы после строки кода: остаются, если за ними снова код
                for p in tc.iter(docx_text._W_P):
                    # абзацы вложенной таблицы читаются строками этой ячейки
                    para = self._rich_paragraph(p, cell_shade=shade)
                    if para.text.strip() or para.images or para.formulas:
                        if blanks and is_code(para) and paras and is_code(paras[-1]):
                            paras.extend(Para(code_blank=True) for _ in range(blanks))
                        blanks = 0
                        paras.append(para)
                    elif blanks or (paras and is_code(paras[-1])):
                        blanks += 1
                cells.append(Cell(paras=paras, continuation=docx_text._is_merge_continuation(tc), span=span, shade=shade))
            rows.append(cells)
        return Table(rows=rows)

    def _rich_paragraph(self, p, cell_shade: Optional[str] = None) -> Para:
        p_pr = p.find(_w("pPr"))
        style_id = _w_val(p_pr.find(_w("pStyle"))) if p_pr is not None else None
        style_id = style_id or self._styles.default_para
        para_marks = self._styles.marks(style_id)
        shade = _fill(p_pr.find(_w("shd"))) if p_pr is not None else None
        direct_outline = _outline_of(p_pr)
        outline = direct_outline if direct_outline is not None else self._styles.outline(style_id)
        para = Para(style=self._styles.names.get(style_id or "", ""), shade=shade or cell_shade, outline=outline or None)
        self._collect(p, para, para_marks, hyperlink=False)
        # Автонумерация: те же счётчики, что у устного разбора (пустой нумерованный абзац тоже их сдвигает).
        numbering = self._numbering.paragraph_numbering(p)
        if numbering is not None:
            key, level, numbered = numbering
            counters = self._counters.setdefault(key, {})
            for deeper in [lvl for lvl in counters if lvl > level]:
                del counters[deeper]
            if level in counters:
                counters[level] += 1
            else:
                counters[level] = self._numbering.start_value(key, level)
            fmt = None if key.startswith("style:") else self._numbering.level(key, level).fmt
            para.list_key, para.level, para.fmt = key, level, fmt or ("decimal" if numbered else None)
            if numbered:
                para.label = self._number_prefix(key, level, counters).strip()
            elif fmt in ("russianLower", "russianUpper", "lowerLetter", "upperLetter"):
                alphabet = RUSSIAN_LOWER if fmt.startswith("russian") else LATIN_LOWER
                letter = _letters(counters[level], alphabet)
                para.label = (letter.upper() if fmt.endswith("Upper") else letter) + ")"
        return para

    def _effective(self, base: dict, rpr) -> dict:
        marks = dict(base)
        direct = _marks_of(rpr)
        if "rstyle" in direct:
            marks.update({k: v for k, v in self._styles.marks(direct["rstyle"]).items() if k != "rstyle"})
        marks.update({k: v for k, v in direct.items() if k != "rstyle"})
        return marks

    def _collect(self, element, para: Para, base: dict, hyperlink: bool) -> None:
        for child in element:
            tag = child.tag
            if not isinstance(tag, str):
                continue
            if tag in docx_text._SKIPPED_IN_PARAGRAPH:
                continue
            if tag == _w("r"):
                self._run(child, para, base, hyperlink)
            elif tag == _w("hyperlink"):
                self._collect(child, para, base, True)
            elif tag in (f"{{{_M_NS}}}oMath", f"{{{_M_NS}}}oMathPara"):
                para.formulas += 1
                text = "".join(node.text or "" for node in child.iter(f"{{{_M_NS}}}t"))
                if text:
                    para.runs.append(Run(text=text))
            elif tag == f"{{{_W14_NS}}}checkbox":
                checked = child.find(f"{{{_W14_NS}}}checked")
                para.checkbox = checked is not None and (checked.get(f"{{{_W14_NS}}}val") or "1") not in _OFF
            else:
                self._collect(child, para, base, hyperlink)

    def _run(self, run, para: Para, base: dict, hyperlink: bool) -> None:
        marks = self._effective(base, run.find(_w("rPr")))
        parts: list[str] = []
        for child in run:
            tag = child.tag
            if tag == _w("t"):
                parts.append(child.text or "")
            elif tag in (_w("tab"), _w("ptab")):
                parts.append("\t")
            elif tag in (_w("br"), _w("cr")):
                parts.append("\n")
            elif tag == _w("noBreakHyphen"):
                parts.append("-")
            elif tag == _w("sym"):
                code = (child.get(_w("char")) or "").upper()
                if code in _SYM_CHECKED:
                    parts.append("☑")
                    para.checkbox = True
                elif code in _SYM_EMPTY:
                    parts.append("☐")
                    if para.checkbox is None:
                        para.checkbox = False
            elif tag in (_w("drawing"), _w("pict"), _w("object"), f"{{{_MC_NS}}}AlternateContent"):
                if self._lifted and any(box in self._lifted for box in child.iter(_TXBX)):
                    continue  # надпись с вопросами — не картинка: её текст прочитан абзацами
                if tag != f"{{{_MC_NS}}}AlternateContent" or child.find(f".//{{{_W_NS}}}drawing") is not None \
                        or child.find(f".//{{{_V_NS}}}imagedata") is not None:
                    para.images.append(self._picture(child))
        text = "".join(parts)
        if not text:
            return
        script = "all" if marks.get("rtl") or marks.get("cs") else _complex_letters(text)
        bold, italic = marks.get("bold"), marks.get("italic")
        if script:  # такой текст Word показывает по w:bCs / w:iCs, а без них — по w:b / w:i
            bold_cs, italic_cs = marks.get("bold_cs", bold), marks.get("italic_cs", italic)
            if script == "all":
                bold, italic = bold_cs, italic_cs
            else:  # вперемешку: жирная хоть одна часть — кусок жирный
                bold, italic = bold or bold_cs, italic or italic_cs
        para.runs.append(Run(
            text=text,
            bold=bool(bold),
            underline=bool(marks.get("underline")) and not hyperlink,
            italic=bool(italic),
            strike=bool(marks.get("strike")),
            highlight=marks.get("highlight"),
            color=marks.get("color"),
            shade=marks.get("shade") or para.shade,
            mono=bool(marks.get("mono")),
            hyperlink=hyperlink,
        ))


def read_docx(contents: bytes, pictures: Optional[dict[str, tuple[str, bytes]]] = None) -> list[Block]:
    """Блоки DOCX. Ошибки: ArchiveTooLarge (пределы распаковки), TooComplex (разметка несоразмерна тексту), прочие —
    повреждённый или не тот файл. pictures — словарь, куда сложить картинки абзацев (id → (тип, байты)); без него они
    не возвращаются."""
    check_archive(contents, every_part=True)
    check_markup(contents)
    from docx import Document

    reader = RichDocxReader(Document(io.BytesIO(contents)))
    blocks = reader.blocks()
    if pictures is not None:
        pictures.update(reader.pictures)
    return blocks
