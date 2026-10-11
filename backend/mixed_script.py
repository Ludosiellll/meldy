"""Русские слова с латинскими буквами внутри — проверка текста, который написала модель.

Модель иногда ставит латинскую букву вместо русской («мaтериал» с латинской a) или вписывает
в русское слово целый кусок латиницы: «рост национаisticских настроений» (конспект живого
прогона 2026-10-11). Проверка стоит после каждого материала лекции — конспекта, карточек,
теста, выжимки и подкаста (coordinator.py, /api/quick-prep, /api/podcast/*):

- латинский двойник русской буквы (a e o p c y x k и заглавные A B E H K M O P C T X Y)
  в слове, остальные буквы которого русские, молча заменяется русской буквой (``check``):
  на экране слово выглядит так же, а поиск и озвучка его теперь узнают;
- слово, в котором латиница — не двойники, а настоящий кусок («национаisticских»), —
  испорченное (``check`` возвращает его): материал просят написать заново один раз, а если
  и второй ответ такой же, предложения с испорченными словами убираются (``drop_broken``) —
  на экран испорченное слово не попадает;
- наоборот, русский двойник внутри латинского слова («Pythоn» с русской о) молча
  становится латинской буквой.

Не трогаются: латинские слова и термины (SQL, Python, LaTeX), латинский термин с русским
окончанием до трёх букв («в Pythonе», «Excelем»), формулы ($…$, $$…$$, \\(…\\), \\[…\\]) и код
(`…`, ```…```), а также поля, где текста для читателя нет (id, source_ids, correct, latex…).
"""

from __future__ import annotations

import re
from typing import Any, Callable

# Латинская буква → русская, которая выглядит так же.
LATIN_TO_CYRILLIC = {
    "a": "а", "e": "е", "o": "о", "p": "р", "c": "с", "y": "у", "x": "х", "k": "к",
    "A": "А", "B": "В", "E": "Е", "H": "Н", "K": "К", "M": "М", "O": "О", "P": "Р", "C": "С",
    "T": "Т", "X": "Х", "Y": "У",
}
CYRILLIC_TO_LATIN = {cyrillic: latin for latin, cyrillic in LATIN_TO_CYRILLIC.items()}

# Поля материалов без текста для читателя: номера, ссылки на фрагменты, буква ответа, тип и
# значок иллюстрации, формула и её обозначения, имена ведущих, концы стрелок схемы.
SKIP_KEYS = frozenset({
    "id", "index", "source_ids", "correct", "type", "icon", "kind", "latex", "symbol", "speaker", "from", "to",
})

# Формулы и код: внутри них латиница рядом с кириллицей бывает по делу ($v_{ср}$, `имяUser`).
_PROTECTED_RE = re.compile(
    r"```[\s\S]*?```|`[^`\n]*`|\$\$[\s\S]*?\$\$|\$[^$\n]+\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]"
)
_WORD_RE = re.compile(r"[A-Za-z\u0400-\u04ff]+")
# Латинский термин и русское окончание: «Pythonе», «SQLем», «Excelом».
_INFLECTED_TERM_RE = re.compile(r"[A-Za-z]{2,}[\u0400-\u04ff]{1,3}")
_SENTENCE_END_RE = re.compile(r"(?<=[.!?…])\s+")
_LETTER_RE = re.compile(r"[^\W\d_]")


def _is_latin(char: str) -> bool:
    return "a" <= char <= "z" or "A" <= char <= "Z"


def _is_cyrillic(char: str) -> bool:
    return "\u0400" <= char <= "\u04ff"


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


def _scan(text: str, on_broken: Callable[[str], None]) -> str:
    """Текст с заменёнными двойниками; о каждом испорченном слове сообщает on_broken."""
    def words(segment: str) -> str:
        def replace(match: re.Match) -> str:
            fixed, broken = _word(match.group(0))
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


def fix_text(text: str) -> tuple[str, list[str]]:
    """(текст с заменёнными двойниками, испорченные слова по порядку, без повторов)."""
    broken: list[str] = []

    def note(word: str) -> None:
        if word not in broken:
            broken.append(word)

    return _scan(text, note), broken


def has_broken_word(text: str) -> bool:
    found: list[str] = []
    _scan(text, found.append)
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


def check(payload: Any) -> tuple[Any, list[str]]:
    """(материал с заменёнными двойниками, испорченные слова) для строки, списка или словаря."""
    broken: list[str] = []

    def on_text(text: str) -> str:
        fixed, words = fix_text(text)
        broken.extend(word for word in words if word not in broken)
        return fixed

    return _walk(payload, None, on_text), broken


def _drop_in_line(line: str) -> str:
    if not has_broken_word(line):
        return line
    kept = [sentence for sentence in _SENTENCE_END_RE.split(line) if not has_broken_word(sentence)]
    text = " ".join(kept)
    # Остались только маркер списка, решётки заголовка или номер — строки больше нет.
    return text if _LETTER_RE.search(text) else ""


def drop_text(text: str) -> str:
    """Текст без предложений, где есть испорченные слова; строка из одной разметки уходит целиком.

    Формулы и код не проверяются, поэтому и не режутся: строки внутри ```…``` и $$…$$ остаются как есть."""
    if not has_broken_word(text):
        return text
    out: list[str] = []
    fence = math = False
    for line in text.split("\n"):
        opens_fence = line.strip().startswith("```")
        opens_math = line.count("$$") % 2 == 1
        if fence or math or opens_fence or opens_math:
            out.append(line)
        else:
            kept = _drop_in_line(line)
            if kept or not line.strip():
                out.append(kept)
        if opens_fence:
            fence = not fence
        elif not fence and opens_math:
            math = not math
    return re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip()


def drop_broken(payload: Any) -> Any:
    """Материал без предложений с испорченными словами. Поле, от которого ничего не осталось,
    становится пустым — проверка раздела (validate_section, sanitize_*) затем убирает карточку,
    вопрос, реплику или иллюстрацию без обязательного текста."""
    return _walk(payload, None, drop_text)
