"""Проверка текста, который написала модель: латиница внутри русских слов, буквы других письменностей и оговорки
об источнике.

Проверка стоит после каждого материала лекции — конспекта, карточек, теста, выжимки и подкаста (coordinator.py,
/api/quick-prep, /api/podcast/*) — и смотрит каждый ответ модели, в том числе взятый из кэша BaseAgent: ответ, который
кэш помнит с прежней версии проверки, проверяется заново и просится ещё раз так же.

Латиница внутри русских слов. Модель иногда ставит латинскую букву вместо русской («мaтериал» с латинской a) или
вписывает в русское слово целый кусок латиницы: «рост национаisticских настроений» (конспект живого прогона
2026-10-11):

- латинский двойник русской буквы (a e o p c y x k и заглавные A B E H K M O P C T X Y)
  в слове, остальные буквы которого русские, молча заменяется русской буквой (``check``):
  на экране слово выглядит так же, а поиск и озвучка его теперь узнают;
- слово, в котором латиница — не двойники, а настоящий кусок («национаisticских»), —
  испорченное (``check`` возвращает его): материал просят написать заново один раз, а если
  и второй ответ такой же, предложения с испорченными словами убираются (``drop_broken``) —
  на экран испорченное слово не попадает;
- наоборот, русский двойник внутри латинского слова («Pythоn» с русской о) молча
  становится латинской буквой.

Буквы других письменностей — иероглифы, кана, хангыль, арабское, еврейское, деванагари, тайское и другие
(``FOREIGN_SCRIPTS``): реплика подкаста живой перепроверки выпуска 44.1 читалась «Чем植物 клетки…». Такие буквы —
испорченное слово, как кусок латиницы, если их письменности нет в тексте самой лекции: лекция о китайском языке пишет
汉字, и её материалы тоже (``scripts_of`` даёт письменности лекции, ``check`` и ``drop_broken`` их пропускают).
Греческие буквы (α, β, λ, Δ) в науке на своём месте: их письменности в списке нет.

Оговорки об источнике: конспект записи той же перепроверки писал «вольтметр (в тексте упомянут как Вт метр)». Скобка,
где сказано только то, как слово было в тексте, расшифровке или записи, молча убирается; такая же оговорка внутри
предложения («который в тексте назван как…») — испорченное слово. Признаки узкие: «в тексте» с «упомянут»,
«назван», «написан», «указан» или «записан» и «как» после них; «в расшифровке» и «в записи» с «как» или кавычкой.
«В тексте Конституции указано…», «в расшифровке генома» и «в записи формулы» не трогаются.

Не трогаются: латинские слова и термины (SQL, Python, LaTeX), латинский термин с русским
окончанием до трёх букв («в Pythonе», «Excelем»), формулы ($…$, $$…$$, \\(…\\), \\[…\\]) и код
(`…`, ```…```), а также поля, где текста для читателя нет (id, source_ids, correct, latex…).
"""

from __future__ import annotations

import bisect
import re
from typing import Any, Callable, Optional

# Латинская буква → русская, которая выглядит так же.
LATIN_TO_CYRILLIC = {
    "a": "а", "e": "е", "o": "о", "p": "р", "c": "с", "y": "у", "x": "х", "k": "к",
    "A": "А", "B": "В", "E": "Е", "H": "Н", "K": "К", "M": "М", "O": "О", "P": "Р", "C": "С",
    "T": "Т", "X": "Х", "Y": "У",
}
CYRILLIC_TO_LATIN = {cyrillic: latin for latin, cyrillic in LATIN_TO_CYRILLIC.items()}

# Письменности, буквы которых в русском материале — сбой модели, если их нет в самой лекции. Диапазоны — блоки
# Юникода; латиницы, кириллицы и греческого здесь нет, как и математических букв (𝐼, ℏ).
FOREIGN_SCRIPTS: dict[str, tuple[tuple[int, int], ...]] = {
    "Armenian": ((0x0530, 0x058F), (0xFB13, 0xFB17)),
    "Hebrew": ((0x0590, 0x05FF), (0xFB1D, 0xFB4F)),
    "Arabic": ((0x0600, 0x06FF), (0x0750, 0x077F), (0x0870, 0x08FF), (0xFB50, 0xFDFF), (0xFE70, 0xFEFF)),
    "Syriac": ((0x0700, 0x074F), (0x0860, 0x086F)),
    "Thaana": ((0x0780, 0x07BF),),
    "NKo": ((0x07C0, 0x07FF),),
    "Devanagari": ((0x0900, 0x097F), (0xA8E0, 0xA8FF)),
    "Bengali": ((0x0980, 0x09FF),),
    "Gurmukhi": ((0x0A00, 0x0A7F),),
    "Gujarati": ((0x0A80, 0x0AFF),),
    "Oriya": ((0x0B00, 0x0B7F),),
    "Tamil": ((0x0B80, 0x0BFF),),
    "Telugu": ((0x0C00, 0x0C7F),),
    "Kannada": ((0x0C80, 0x0CFF),),
    "Malayalam": ((0x0D00, 0x0D7F),),
    "Sinhala": ((0x0D80, 0x0DFF),),
    "Thai": ((0x0E00, 0x0E7F),),
    "Lao": ((0x0E80, 0x0EFF),),
    "Tibetan": ((0x0F00, 0x0FFF),),
    "Myanmar": ((0x1000, 0x109F),),
    "Georgian": ((0x10A0, 0x10FF), (0x1C90, 0x1CBF), (0x2D00, 0x2D2F)),
    "Hangul": ((0x1100, 0x11FF), (0x3130, 0x318F), (0xA960, 0xA97F), (0xAC00, 0xD7FF), (0xFFA0, 0xFFDC)),
    "Ethiopic": ((0x1200, 0x139F), (0x2D80, 0x2DDF)),
    "Cherokee": ((0x13A0, 0x13FF),),
    "Khmer": ((0x1780, 0x17FF),),
    "Mongolian": ((0x1800, 0x18AF),),
    "Han": (
        (0x2E80, 0x2FDF), (0x3005, 0x3007), (0x3021, 0x3029), (0x3038, 0x303C), (0x3400, 0x4DBF), (0x4E00, 0x9FFF),
        (0xF900, 0xFAFF), (0x20000, 0x323AF),
    ),
    "Kana": ((0x3040, 0x30FF), (0x31F0, 0x31FF), (0xFF66, 0xFF9F), (0x1B000, 0x1B16F)),
    "Bopomofo": ((0x3100, 0x312F), (0x31A0, 0x31BF)),
    "Yi": ((0xA000, 0xA4CF),),
}
_SPANS = sorted((start, end, name) for name, spans in FOREIGN_SCRIPTS.items() for start, end in spans)
_SPAN_STARTS = [start for start, _, _ in _SPANS]
_FOREIGN_CLASS = "".join(f"\\U{start:08x}-\\U{end:08x}" for start, end, _ in _SPANS)

# Поля материалов без текста для читателя: номера, ссылки на фрагменты, буква ответа, тип и
# значок иллюстрации, формула и её обозначения, имена ведущих, концы стрелок схемы.
SKIP_KEYS = frozenset({
    "id", "index", "source_ids", "correct", "type", "icon", "kind", "latex", "symbol", "speaker", "from", "to",
})

# Формулы и код: внутри них латиница рядом с кириллицей бывает по делу ($v_{ср}$, `имяUser`).
_PROTECTED_RE = re.compile(
    r"```[\s\S]*?```|`[^`\n]*`|\$\$[\s\S]*?\$\$|\$[^$\n]+\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]"
)
# Слово из латиницы и кириллицы — или подряд идущие знаки других письменностей («植物»).
_WORD_RE = re.compile(rf"[A-Za-z\u0400-\u04ff]+|[{_FOREIGN_CLASS}]+")
# Латинский термин и русское окончание: «Pythonе», «SQLем», «Excelом».
_INFLECTED_TERM_RE = re.compile(r"[A-Za-z]{2,}[\u0400-\u04ff]{1,3}")
_SENTENCE_END_RE = re.compile(r"(?<=[.!?…])\s+")
_LETTER_RE = re.compile(r"[^\W\d_]")

# Оговорка об источнике: где было слово (в тексте, расшифровке, записи) и как его там «назвали».
_SAID = r"(?:упомянут|назван|написан|указан|записан|произнес[её]н|звучит|слышится)[а-яё]*"
_WRONGLY = r"(?:(?:ошибочно|неверно|неправильно)\s+)?"
_IN_TEXT = r"\bв\s+(?:исходном\s+)?тексте(?:\s+лекции)?"
_IN_RECORDING = r"\bв\s+(?:расшифровке|транскрипции|записи)(?:\s+(?:записи|лекции))?"
_QUOTE = "[«\"„]"
# «вольтметр (в тексте упомянут как Вт метр)», «(в записи — «Вт метр»)»: скобка уходит целиком, с пробелом перед ней.
_REMARK_IN_BRACKETS_RE = re.compile(
    rf"[ \t]*\(\s*(?:{_IN_TEXT}\s+{_WRONGLY}{_SAID}\s+как\b"
    rf"|{_IN_TEXT}\s+(?:ошибочно|неверно|неправильно)\s+{_SAID}\s*{_QUOTE}"
    rf"|{_IN_RECORDING}(?:\s+{_WRONGLY}{_SAID})?\s*(?:как\b|{_QUOTE}|[—–:]\s*{_QUOTE}))[^()\n]*\)",
    re.IGNORECASE,
)
# Та же оговорка внутри предложения: «вольтметр, который в тексте назван как «Вт метр», …».
_REMARK_RE = re.compile(
    rf"{_IN_TEXT}\s+{_WRONGLY}{_SAID}\s+как\b|{_IN_RECORDING}\s+{_WRONGLY}{_SAID}\s+(?:как\b|{_QUOTE})"
    rf"|\bв\s+(?:расшифровке|транскрипции)\s+(?:записи|лекции)\b",
    re.IGNORECASE,
)

NO_SCRIPTS: frozenset[str] = frozenset()


def _is_latin(char: str) -> bool:
    return "a" <= char <= "z" or "A" <= char <= "Z"


def _is_cyrillic(char: str) -> bool:
    return "\u0400" <= char <= "\u04ff"


def _script(char: str) -> Optional[str]:
    """Письменность из FOREIGN_SCRIPTS, которой принадлежит знак, или None."""
    code = ord(char)
    index = bisect.bisect_right(_SPAN_STARTS, code) - 1
    if index >= 0 and code <= _SPANS[index][1]:
        return _SPANS[index][2]
    return None


def scripts_of(text: Any) -> frozenset[str]:
    """Письменности из FOREIGN_SCRIPTS, буквы которых есть в тексте лекции: в её материалах они на месте."""
    if not isinstance(text, str):
        return NO_SCRIPTS
    return frozenset(name for char in set(text) if char.isalpha() and (name := _script(char)))


def _foreign(run: str, allowed: frozenset[str]) -> bool:
    """В подряд идущих знаках других письменностей есть буква письменности, которой нет в лекции."""
    return any(char.isalpha() and _script(char) not in allowed for char in run)


def _word(word: str) -> tuple[str, bool]:
    """(слово после замены двойников, испорчено ли оно)."""
    latin = [char for char in word if _is_latin(char)]
    cyrillic = [char for char in word if _is_cyrillic(char)]
    if not latin or not cyrillic:
        return word, False
    # Латинские двойники в русском слове: русских букв не меньше, чем латинских.
    if len(cyrillic) >= len(latin) and all(char in LATIN_TO_CYRILLIC for char in latin):
        return "".join(LATIN_TO_CYRILLIC.get(char, char) for char in word), False
    # Русские двойники внутри латинского слова («Pythоn»): латиница по краям.
    if _is_latin(word[0]) and _is_latin(word[-1]) and all(char in CYRILLIC_TO_LATIN for char in cyrillic):
        return "".join(CYRILLIC_TO_LATIN.get(char, char) for char in word), False
    if _INFLECTED_TERM_RE.fullmatch(word):
        return word, False
    return word, True


def _scan(text: str, on_broken: Callable[[str], None], allowed: frozenset[str] = NO_SCRIPTS) -> str:
    """Текст с заменёнными двойниками и без скобок-оговорок; о каждом испорченном слове сообщает on_broken."""
    def words(segment: str) -> str:
        segment = _REMARK_IN_BRACKETS_RE.sub("", segment)
        for remark in _REMARK_RE.finditer(segment):
            on_broken(remark.group(0))

        def replace(match: re.Match) -> str:
            word = match.group(0)
            if _script(word[0]) is not None:
                if _foreign(word, allowed):
                    on_broken(word)
                return word
            fixed, broken = _word(word)
            if broken:
                on_broken(fixed)
            return fixed

        return _WORD_RE.sub(replace, segment)

    parts: list[str] = []
    position = 0
    for match in _PROTECTED_RE.finditer(text):
        parts.append(words(text[position:match.start()]))
        parts.append(match.group(0))
        position = match.end()
    parts.append(words(text[position:]))
    return "".join(parts)


def fix_text(text: str, allowed: frozenset[str] = NO_SCRIPTS) -> tuple[str, list[str]]:
    """(текст с заменёнными двойниками и без скобок-оговорок, испорченные слова по порядку, без повторов).

    ``allowed`` — письменности лекции (``scripts_of``): их буквы не испорченные."""
    broken: list[str] = []

    def note(word: str) -> None:
        if word not in broken:
            broken.append(word)

    return _scan(text, note, allowed), broken


def has_broken_word(text: str, allowed: frozenset[str] = NO_SCRIPTS) -> bool:
    found: list[str] = []
    _scan(text, found.append, allowed)
    return bool(found)


def _walk(value: Any, key: Any, on_text: Callable[[str], str]) -> Any:
    if isinstance(value, str):
        return value if key in SKIP_KEYS else on_text(value)
    if isinstance(value, dict):
        return {name: _walk(item, name, on_text) for name, item in value.items()}
    if isinstance(value, list):
        # Элементы списка — поле своего ключа: "options", "items", "source_ids".
        return [_walk(item, key, on_text) for item in value]
    return value


def check(payload: Any, allowed: frozenset[str] = NO_SCRIPTS) -> tuple[Any, list[str]]:
    """(материал с заменёнными двойниками и без скобок-оговорок, испорченные слова) для строки, списка или словаря.

    ``allowed`` — письменности лекции (``scripts_of``)."""
    broken: list[str] = []

    def on_text(text: str) -> str:
        fixed, words = fix_text(text, allowed)
        broken.extend(word for word in words if word not in broken)
        return fixed

    return _walk(payload, None, on_text), broken


def _drop_in_line(line: str, allowed: frozenset[str]) -> str:
    if not has_broken_word(line, allowed):
        return line
    kept = [sentence for sentence in _SENTENCE_END_RE.split(line) if not has_broken_word(sentence, allowed)]
    text = " ".join(kept)
    # Остались только маркер списка, решётки заголовка или номер — строки больше нет.
    return text if _LETTER_RE.search(text) else ""


def drop_text(text: str, allowed: frozenset[str] = NO_SCRIPTS) -> str:
    """Текст без предложений, где есть испорченные слова; строка из одной разметки уходит целиком.

    Формулы и код не проверяются, поэтому и не режутся: строки внутри ```…``` и $$…$$ остаются как есть."""
    if not has_broken_word(text, allowed):
        return text
    out: list[str] = []
    fence = math = False
    for line in text.split("\n"):
        opens_fence = line.strip().startswith("```")
        opens_math = line.count("$$") % 2 == 1
        if fence or math or opens_fence or opens_math:
            out.append(line)
        else:
            kept = _drop_in_line(line, allowed)
            if kept or not line.strip():
                out.append(kept)
        if opens_fence:
            fence = not fence
        elif not fence and opens_math:
            math = not math
    return re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip()


def drop_broken(payload: Any, allowed: frozenset[str] = NO_SCRIPTS) -> Any:
    """Материал без предложений с испорченными словами. Поле, от которого ничего не осталось,
    становится пустым — проверка раздела (validate_section, sanitize_*) затем убирает карточку,
    вопрос, реплику или иллюстрацию без обязательного текста."""
    return _walk(payload, None, lambda text: drop_text(text, allowed))
