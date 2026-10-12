"""Adverbs that make a claim stronger than the lecture's: taken out of a lecture material when the lecture never uses them.

Every fact recheck found the same kind of slip: the lecture says a local conflict «грозил втянуть» Europe into war, the
material says it «неизбежно втягивал» (44.9) or «неминуемо втягивало» (44.5); the conflict «моментально перерос» (44.10)
or «мгновенно перерос» (44.7) into a European war; four empires fell «сразу» after the armistice (44.5, 44.7). Three of
them would teach a false fact. The prompt names the habit (agents.base.RETELL_RULE) and it comes back all the same, and a
model that reads the material against the lecture removed true facts too (notes_check.py, 44.10). These words are
different: one of them that the lecture never uses adds nothing but the overstatement, and without it the sentence still
reads («локальный конфликт втягивал в войну всю Европу»).

The word stays when the lecture has it in any form (ADVERBS maps each to its stem), after «не»/«ни» («не сразу»), in a
formula or code, and in a quiz option — a wrong option may need it. A lecture text this module cannot see (empty or very
short) changes nothing.
"""
import re
from typing import Any

import mixed_script

ADVERBS = {
    "неизбежно": "неизбежн",
    "неминуемо": "неминуем",
    "неотвратимо": "неотвратим",
    "непременно": "непременн",
    "мгновенно": "мгновенн",
    "моментально": "моментальн",
    "немедленно": "немедленн",
    "тотчас": "тотчас",
    "сразу": "сразу",
}
MIN_LECTURE_CHARS = 200
SKIP_KEYS = mixed_script.SKIP_KEYS | {"options"}

_ADVERB_RE = re.compile(r"(?<![\w-])(" + "|".join(ADVERBS) + r")(?:[ \t]+же)?(?![\w-])", re.IGNORECASE)
_PREVIOUS_WORD_RE = re.compile(r"([\w-]+)[ \t]*$")
_KEEPING_WORDS = frozenset({"не", "ни"})


def _protected(text: str) -> list[tuple[int, int]]:
    return [(match.start(), match.end()) for match in mixed_script._PROTECTED_RE.finditer(text)]


def soften_text(text: str, lecture: str, removed: list[str]) -> str:
    """``text`` without the adverbs ``lecture`` (in lower case) never uses; what went is added to ``removed``."""
    if not text or not _ADVERB_RE.search(text):
        return text
    protected = _protected(text)
    parts: list[str] = []
    position = 0
    capitalize_at: list[int] = []
    for match in _ADVERB_RE.finditer(text):
        word = match.group(1).lower()
        if ADVERBS[word] in lecture or any(left <= match.start() < right for left, right in protected):
            continue
        previous = _PREVIOUS_WORD_RE.search(text[:match.start()])
        if previous and previous.group(1).lower() in _KEEPING_WORDS:
            continue
        start, end = match.start(), match.end()
        if end < len(text) and text[end] == " ":
            end += 1  # «моментально перерос» → «перерос»
        elif start > 0 and text[start - 1] == " ":
            start -= 1  # «…распалось сразу.» → «…распалось.»
        parts.append(text[position:start])
        if match.group(1)[0].isupper():
            capitalize_at.append(sum(len(part) for part in parts))
        position = end
        removed.append(match.group(0))
    parts.append(text[position:])
    result = "".join(parts)
    if len(parts) > 1:
        result = re.sub(r",[ \t]*,", ",", result)  # «конфликт, неизбежно, втягивал»
    for index in capitalize_at:
        if index < len(result) and result[index].islower():
            result = result[:index] + result[index].upper() + result[index + 1:]
    return result


def soften(payload: Any, lecture: str) -> tuple[Any, list[str]]:
    """(the material without the adverbs the lecture never uses, the adverbs taken out) for a string, list or dict."""
    if not isinstance(lecture, str) or len(lecture.strip()) < MIN_LECTURE_CHARS:
        return payload, []
    lowered = lecture.lower()
    removed: list[str] = []

    def walk(value: Any, key: Any) -> Any:
        if isinstance(value, str):
            return value if key in SKIP_KEYS else soften_text(value, lowered, removed)
        if isinstance(value, dict):
            return {name: walk(item, name) for name, item in value.items()}
        if isinstance(value, list):
            return [walk(item, key) for item in value]
        return value

    return walk(payload, None), removed
