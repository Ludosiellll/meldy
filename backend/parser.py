import io
import re
from dataclasses import dataclass, replace
from typing import Optional


def extract_text(contents: bytes, filename: str) -> str:
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else "txt"

    if ext == "pdf":
        return _extract_pdf(contents)
    elif ext == "docx":
        return _extract_docx(contents)
    elif ext in ("html", "htm"):
        return _extract_html(contents)
    elif ext in ("txt", "md"):
        return _extract_text(contents)
    else:
        return _extract_text(contents)


def _extract_pdf(contents: bytes) -> str:
    try:
        from PyPDF2 import PdfReader
        reader = PdfReader(io.BytesIO(contents))
        text_parts = []
        for page in reader.pages:
            page_text = page.extract_text()
            if page_text:
                text_parts.append(page_text)
        return clean_extracted_text("\n\n".join(text_parts))
    except Exception as e:
        raise ValueError(f"Ошибка чтения PDF: {e}")


def _extract_docx(contents: bytes) -> str:
    """Текст DOCX в порядке документа: абзацы и таблицы, с автонумерацией Word.

    - Строка таблицы — одна строка текста: непустые ячейки через « | ».
      Объединённая ячейка (gridSpan, vMerge/hMerge) выводится один раз.
    - Абзац с автонумерацией (numPr у абзаца или его стиля, формат числа decimal*;
      запасной вариант — стиль «List Number») получает номер, как его показывает Word:
      по шаблону уровня w:lvlText, где %k — текущий номер уровня k («%1.» → «3. »,
      «%1.%2.» → «1.2. », «Вопрос %1.» → «Вопрос 4. »). Если шаблона нет или он ссылается
      на уровень не из цифр (буквы, римские), верхний уровень получает «<n>. »,
      вложенные — «<n>) ». Счётчик свой у каждого numId. Маркированные списки номеров не получают.
    """
    try:
        from docx import Document

        doc = Document(io.BytesIO(contents))
        return clean_extracted_text("\n".join(_DocxReader(doc).lines()))
    except Exception as e:
        raise ValueError(f"Ошибка чтения DOCX: {e}")


_W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
_MC_NS = "http://schemas.openxmlformats.org/markup-compatibility/2006"


def _w(tag: str) -> str:
    return f"{{{_W_NS}}}{tag}"


def _w_val(element, attribute: str = "val") -> Optional[str]:
    if element is None:
        return None
    return element.get(_w(attribute))


_W_P, _W_TBL, _W_TR, _W_TC, _W_SDT, _W_SDT_CONTENT, _W_CUSTOM_XML = (
    _w("p"), _w("tbl"), _w("tr"), _w("tc"), _w("sdt"), _w("sdtContent"), _w("customXml")
)
_W_T, _W_TAB, _W_PTAB, _W_BR, _W_CR, _W_NO_BREAK_HYPHEN = (
    _w("t"), _w("tab"), _w("ptab"), _w("br"), _w("cr"), _w("noBreakHyphen")
)
# Поддеревья, текст которых в абзац не входит: удалённые правки, надписи (у Word их
# содержимое ещё и продублировано в mc:Fallback), свойства и сноски-ссылки.
_SKIPPED_IN_PARAGRAPH = {
    _w("del"), _w("moveFrom"), _w("txbxContent"), _w("pPr"), _w("rPr"), _w("instrText"),
    f"{{{_MC_NS}}}Fallback",
}
_LIST_NUMBER_STYLES = {"list number": 0, "list number 2": 1, "list number 3": 2, "list number 4": 3, "list number 5": 4}
_LEVEL_REF = re.compile(r"%([1-9])")


@dataclass(frozen=True)
class _Level:
    """Уровень списка Word. Поля, которых нет в XML, — None (у legal — False)."""

    fmt: Optional[str] = None  # w:numFmt: decimal, bullet, lowerLetter…
    start: Optional[int] = None  # w:start
    text: Optional[str] = None  # w:lvlText: «%1.», «%1.%2.», «Вопрос %1.»
    legal: bool = False  # w:isLgl: все уровни в номере пишутся арабскими цифрами


class _DocxNumbering:
    """Определения списков Word: numId → формат, начальное значение и шаблон каждого уровня."""

    def __init__(self, doc) -> None:
        self._num_to_abstract: dict[str, str] = {}
        self._overrides: dict[str, dict[int, _Level]] = {}
        self._abstract_levels: dict[str, dict[int, _Level]] = {}
        self._abstract_style_link: dict[str, str] = {}
        self._styles: dict[str, dict] = {}
        self._default_style: Optional[str] = None
        self._load_numbering(doc)
        self._load_styles(doc)

    def _load_numbering(self, doc) -> None:
        try:
            root = doc.part.numbering_part.element
        except Exception:
            return
        for abstract in root.findall(_w("abstractNum")):
            abstract_id = _w_val(abstract, "abstractNumId")
            if abstract_id is None:
                continue
            link = abstract.find(_w("numStyleLink"))
            if _w_val(link):
                self._abstract_style_link[abstract_id] = _w_val(link)
            self._abstract_levels[abstract_id] = dict(
                _level_definition(lvl) for lvl in abstract.findall(_w("lvl"))
            )
        for num in root.findall(_w("num")):
            num_id = _w_val(num, "numId")
            abstract_id = _w_val(num.find(_w("abstractNumId")))
            if num_id is None or abstract_id is None:
                continue
            self._num_to_abstract[num_id] = abstract_id
            overrides: dict[int, _Level] = {}
            for override in num.findall(_w("lvlOverride")):
                level = _int(_w_val(override, "ilvl"), 0)
                start = _int(_w_val(override.find(_w("startOverride"))), None)
                lvl = override.find(_w("lvl"))
                definition = _level_definition(lvl)[1] if lvl is not None else _Level()
                if start is not None:
                    definition = replace(definition, start=start)
                overrides[level] = definition
            if overrides:
                self._overrides[num_id] = overrides

    def _load_styles(self, doc) -> None:
        try:
            root = doc.styles.element
        except Exception:
            return
        for style in root.findall(_w("style")):
            style_id = style.get(_w("styleId"))
            if not style_id:
                continue
            if style.get(_w("type")) == "paragraph" and style.get(_w("default")) in ("1", "true", "on"):
                # В русском Word у «Обычного» стиля styleId обычно «a», а не «Normal».
                self._default_style = style_id
            num_pr = style.find(_w("pPr") + "/" + _w("numPr"))
            self._styles[style_id] = {
                "name": (_w_val(style.find(_w("name"))) or "").strip().lower(),
                "based_on": _w_val(style.find(_w("basedOn"))),
                "num_id": _w_val(num_pr.find(_w("numId"))) if num_pr is not None else None,
                "ilvl": _int(_w_val(num_pr.find(_w("ilvl"))), None) if num_pr is not None else None,
            }

    def _style_numbering(self, style_id: Optional[str]) -> tuple[Optional[str], Optional[int], Optional[str]]:
        """(numId, уровень, имя первого стиля) по цепочке basedOn."""
        seen: set[str] = set()
        first_name: Optional[str] = None
        current = style_id
        while current and current not in seen:
            seen.add(current)
            style = self._styles.get(current)
            if style is None:
                break
            if first_name is None:
                first_name = style["name"]
            if style["num_id"] is not None:
                return style["num_id"], style["ilvl"], first_name
            current = style["based_on"]
        return None, None, first_name

    def level(self, num_id: str, level: int) -> _Level:
        """Действующее определение уровня: abstractNum, поверх него lvlOverride; start не None."""
        base = _Level()
        override = self._overrides.get(num_id, {}).get(level)
        abstract_id = self._num_to_abstract.get(num_id)
        for _ in range(4):  # numStyleLink → стиль нумерации → его numId → abstractNum с уровнями
            if abstract_id is None or self._abstract_levels.get(abstract_id):
                break
            linked_num, _, _ = self._style_numbering(self._abstract_style_link.get(abstract_id))
            abstract_id = self._num_to_abstract.get(linked_num) if linked_num else None
        if abstract_id is not None:
            base = self._abstract_levels.get(abstract_id, {}).get(level, base)
        if override is not None:
            base = _Level(
                fmt=override.fmt or base.fmt,
                start=override.start if override.start is not None else base.start,
                text=override.text if override.text is not None else base.text,
                legal=override.legal or base.legal,
            )
        return base if base.start is not None else replace(base, start=1)

    def level_format(self, num_id: str, level: int) -> tuple[Optional[str], int]:
        definition = self.level(num_id, level)
        return definition.fmt, definition.start if definition.start is not None else 1

    def paragraph_numbering(self, p) -> Optional[tuple[str, int, bool]]:
        """(ключ счётчика, уровень, нумерованный ли формат) или None, если абзац не в списке."""
        p_pr = p.find(_w("pPr"))
        num_pr = p_pr.find(_w("numPr")) if p_pr is not None else None
        style_id = _w_val(p_pr.find(_w("pStyle"))) if p_pr is not None else None
        num_id = _w_val(num_pr.find(_w("numId"))) if num_pr is not None else None
        level = _int(_w_val(num_pr.find(_w("ilvl"))), None) if num_pr is not None else None
        style_num, style_level, style_name = self._style_numbering(style_id or self._default_style)
        if num_id is None:
            num_id = style_num
        if level is None:
            level = style_level if style_level is not None else 0
        if num_id is not None:
            if num_id == "0":
                return None  # numId 0 явно снимает нумерацию
            fmt, _ = self.level_format(num_id, level)
            if fmt is None and style_name in _LIST_NUMBER_STYLES:
                return f"style:{style_name}", _LIST_NUMBER_STYLES[style_name], True
            return num_id, level, _decimal_like(fmt)
        if style_name in _LIST_NUMBER_STYLES:
            return f"style:{style_name}", _LIST_NUMBER_STYLES[style_name], True
        return None

    def start_value(self, key: str, level: int) -> int:
        if key.startswith("style:"):
            return 1
        return self.level_format(key, level)[1]


def _level_definition(lvl) -> tuple[int, _Level]:
    level = _int(_w_val(lvl, "ilvl"), 0)
    legal = lvl.find(_w("isLgl"))
    return level, _Level(
        fmt=_w_val(lvl.find(_w("numFmt"))),
        start=_int(_w_val(lvl.find(_w("start"))), None),
        text=_w_val(lvl.find(_w("lvlText"))),
        legal=legal is not None and (_w_val(legal) or "true") not in ("0", "false", "off"),
    )


def _decimal_like(fmt: Optional[str]) -> bool:
    return bool(fmt) and fmt.startswith("decimal")


def _int(value: Optional[str], default):
    try:
        return int(value) if value is not None else default
    except (TypeError, ValueError):
        return default


class _DocxReader:
    """Обходит тело документа по порядку и собирает строки текста."""

    def __init__(self, doc) -> None:
        self._doc = doc
        self._numbering = _DocxNumbering(doc)
        self._counters: dict[str, dict[int, int]] = {}

    def lines(self) -> list[str]:
        out: list[str] = []
        self._walk_blocks(self._doc.element.body, out)
        return out

    def _walk_blocks(self, parent, out: list[str]) -> None:
        for child in parent:
            tag = child.tag
            if tag == _W_P:
                # Пустой нумерованный абзац сдвигает счётчик (как в Word), но строки не даёт.
                text = self._paragraph(child, keep_bare_number=False)
                if text.strip():
                    out.append(text)
            elif tag == _W_TBL:
                out.extend(self._table_rows(child))
            elif tag in (_W_SDT, _W_CUSTOM_XML):
                content = child.find(_W_SDT_CONTENT) if tag == _W_SDT else child
                if content is not None:
                    self._walk_blocks(content, out)

    def _paragraph(self, p, *, keep_bare_number: bool) -> str:
        text = _paragraph_text(p)
        numbering = self._numbering.paragraph_numbering(p)
        if numbering is None:
            return text
        key, level, numbered = numbering
        counters = self._counters.setdefault(key, {})
        for deeper in [lvl for lvl in counters if lvl > level]:
            del counters[deeper]  # верхний уровень начинает вложенные заново
        if level in counters:
            counters[level] += 1
        else:
            counters[level] = self._numbering.start_value(key, level)
        if not numbered:
            return text
        prefix = self._number_prefix(key, level, counters)
        if not text.strip():
            # В ячейке «№» с автонумерацией номер и есть содержимое: «1. | Вопрос».
            return prefix.rstrip() if keep_bare_number else ""
        return f"{prefix}{text.lstrip()}".rstrip()

    def _number_prefix(self, key: str, level: int, counters: dict[int, int]) -> str:
        """Номер абзаца с пробелом после него, как в Word: по шаблону w:lvlText уровня.

        %k заменяется текущим номером уровня k (ещё не начатый уровень — его start).
        Без шаблона или со ссылкой на уровень не из цифр — «<n>. » наверху, «<n>) » глубже.
        Пустой шаблон Word показывает без номера, и здесь номера тоже нет.
        """
        fallback = f"{counters[level]}. " if level == 0 else f"{counters[level]}) "
        if key.startswith("style:"):
            return fallback
        definition = self._numbering.level(key, level)
        if definition.text is None:
            return fallback
        unusable = False

        def number_of(match: re.Match) -> str:
            nonlocal unusable
            referenced = int(match.group(1)) - 1
            if referenced != level and not definition.legal:
                if not _decimal_like(self._numbering.level(key, referenced).fmt):
                    unusable = True
                    return ""
            value = counters.get(referenced)
            return str(value if value is not None else self._numbering.start_value(key, referenced))

        rendered = " ".join(_LEVEL_REF.sub(number_of, definition.text).split())
        if unusable:
            return fallback
        return f"{rendered} " if rendered else ""

    def _table_rows(self, tbl) -> list[str]:
        rows: list[str] = []
        for tr in tbl.iter(_W_TR):
            if _nearest_table(tr) is not tbl:
                continue  # строки вложенных таблиц попадают в текст своей ячейки
            cells: list[str] = []
            for tc in _row_cells(tr):
                if _is_merge_continuation(tc):
                    continue
                cell_text = self._cell_text(tc)
                if cell_text:
                    cells.append(cell_text)
            if cells:
                rows.append(" | ".join(cells))
        return rows

    def _cell_text(self, tc) -> str:
        parts: list[str] = []
        self._collect_cell(tc, parts)
        return " ".join(" ".join(part.split()) for part in parts if part.strip())

    def _collect_cell(self, parent, parts: list[str]) -> None:
        for child in parent:
            tag = child.tag
            if tag == _W_P:
                text = self._paragraph(child, keep_bare_number=True)
                if text.strip():
                    parts.append(text)
            elif tag == _W_TBL:
                parts.extend(self._table_rows(child))
            elif tag in (_W_SDT, _W_CUSTOM_XML):
                content = child.find(_W_SDT_CONTENT) if tag == _W_SDT else child
                if content is not None:
                    self._collect_cell(content, parts)


def _nearest_table(element):
    parent = element.getparent()
    while parent is not None and parent.tag != _W_TBL:
        parent = parent.getparent()
    return parent


def _row_cells(tr) -> list:
    cells = []
    for child in tr:
        if child.tag == _W_TC:
            cells.append(child)
        elif child.tag in (_W_SDT, _W_CUSTOM_XML):
            content = child.find(_W_SDT_CONTENT) if child.tag == _W_SDT else child
            if content is not None:
                cells.extend(c for c in content if c.tag == _W_TC)
    return cells


def _is_merge_continuation(tc) -> bool:
    tc_pr = tc.find(_w("tcPr"))
    if tc_pr is None:
        return False
    for tag in ("vMerge", "hMerge"):
        merge = tc_pr.find(_w(tag))
        if merge is not None and (_w_val(merge) or "continue") != "restart":
            return True
    return False


def _paragraph_text(p) -> str:
    parts: list[str] = []
    _collect_runs(p, parts)
    return "".join(parts)


def _collect_runs(element, parts: list[str]) -> None:
    for child in element:
        tag = child.tag
        if not isinstance(tag, str) or tag in _SKIPPED_IN_PARAGRAPH:
            continue
        if tag == _W_T:
            parts.append(child.text or "")
        elif tag in (_W_TAB, _W_PTAB):
            parts.append("\t")
        elif tag in (_W_BR, _W_CR):
            parts.append("\n")
        elif tag == _W_NO_BREAK_HYPHEN:
            parts.append("-")
        else:
            _collect_runs(child, parts)


def _extract_text(contents: bytes) -> str:
    # BOM must win over heuristic decoding. Without this, UTF-16 files are
    # decoded as CP1251 because CP1251 accepts every byte sequence.
    if contents.startswith((b"\xff\xfe", b"\xfe\xff", b"\xff\xfe\x00\x00", b"\x00\x00\xfe\xff")):
        return clean_extracted_text(contents.decode("utf-16" if not contents.startswith((b"\xff\xfe\x00\x00", b"\x00\x00\xfe\xff")) else "utf-32"))
    if contents.startswith(b"\xef\xbb\xbf"):
        return clean_extracted_text(contents.decode("utf-8-sig"))

    # UTF-16 without a BOM has a high NUL-byte ratio. Detect it before the
    # single-byte fallbacks so it cannot become readable-looking gibberish.
    sample = contents[:4096]
    if sample and sample.count(b"\x00") / len(sample) > 0.20:
        for encoding in ("utf-16-le", "utf-16-be"):
            try:
                return clean_extracted_text(contents.decode(encoding))
            except UnicodeDecodeError:
                pass

    try:
        return clean_extracted_text(contents.decode("utf-8"))
    except UnicodeDecodeError:
        pass

    candidates = []
    for encoding in ("cp1251", "cp866", "latin-1"):
        try:
            decoded = contents.decode(encoding)
            cleaned = clean_extracted_text(decoded)
            if _looks_like_text(cleaned):
                candidates.append((_legacy_decode_score(cleaned), cleaned))
        except UnicodeDecodeError:
            continue
    if candidates:
        return max(candidates, key=lambda item: item[0])[1]
    return clean_extracted_text(contents.decode("utf-8", errors="replace"))


def clean_extracted_text(text: str) -> str:
    """Remove transport/control noise while preserving normal Unicode text."""
    text = text.replace("\ufeff", "")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("\x00", "")
    text = re.sub(r"[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]", "", text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _looks_like_text(text: str) -> bool:
    if not text:
        return False
    replacement_count = text.count("\ufffd")
    if replacement_count > max(2, len(text) // 200):
        return False
    printable = sum(char.isprintable() or char in "\n\t" for char in text)
    return printable / len(text) >= 0.85


def _legacy_decode_score(text: str) -> float:
    """Prefer ordinary Russian text over printable legacy-codec mojibake."""
    if not text:
        return float("-inf")

    normal_cyrillic = sum("А" <= char <= "я" or char in "Ёё" for char in text)
    extended_cyrillic = sum("\u0400" <= char <= "\u052f" for char in text) - normal_cyrillic
    latin_letters = sum(char.isascii() and char.isalpha() for char in text)
    suspicious = sum(
        char in "\u00ad\ufffd" or (char.isprintable() and not char.isspace() and ord(char) < 32)
        for char in text
    )
    common_pairs = sum(
        text.lower().count(pair)
        for pair in ("ст", "но", "ен", "ов", "ни", "ра", "во", "ко", "пр", "то")
    )
    return normal_cyrillic * 3 + common_pairs * 2 + latin_letters - extended_cyrillic * 4 - suspicious * 8


def _extract_html(contents: bytes) -> str:
    try:
        from bs4 import BeautifulSoup
        html_str = _extract_text(contents)
        soup = BeautifulSoup(html_str, "html.parser")
        
        # Remove script and style elements
        for script in soup(["script", "style", "header", "footer", "nav"]):
            script.decompose()
            
        # Get text
        text = soup.get_text(separator="\n")
        
        # Clean up spacing and empty lines
        lines = (line.strip() for line in text.splitlines())
        chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
        text = "\n".join(chunk for chunk in chunks if chunk)
        
        return clean_extracted_text(text)
    except Exception as e:
        raise ValueError(f"Ошибка чтения HTML: {e}")
