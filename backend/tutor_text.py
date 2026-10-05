"""Text of the voice tutor: streamed pieces → spoken sentences, and the lecture references in them.

The reply is voiced sentence by sentence while the model is still writing, so the first sentence
must leave as soon as it is complete. «т. е.», «и т. д.», initials («А. С. Пушкин») and decimal
numbers do not end a sentence. A very long sentence is cut at a comma or a dash so the voice does
not wait for it. References like [S03] or [S03, S07] are taken out of the spoken text and returned
beside it; markdown the model may still produce is removed.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# Words that end with a dot inside a sentence (lower case, without the dot).
_ABBREVIATIONS = frozenset(
    """т е д п др пр см стр г гг в вв рис табл напр им проф акад доц млн млрд тыс руб коп ок англ лат
    греч франц нем ср кв км мин макс сек ч ул обл р зав каф""".split()
)
_REF_RE = re.compile(r"\[\s*S\d{1,3}(?:\s*[,;]\s*S\d{1,3})*\s*\]")
_REF_ID_RE = re.compile(r"S\d{1,3}")
# A reference the model was cut off in the middle of: «… роста [S0».
_OPEN_REF_RE = re.compile(r"\[\s*S[\d\s,;S]*$")
_MARKDOWN_RE = re.compile(r"(\*\*|__|`+|^#+\s*|^>\s*)", re.MULTILINE)
_BULLET_RE = re.compile(r"^\s*(?:[-*•]|\d+[.)])\s+", re.MULTILINE)
_SPACE_RE = re.compile(r"\s+")
_CLOSERS = "»\"'”’)]"
# Where a too long sentence may be cut: after a comma, semicolon, colon or before a dash.
_SOFT_BREAK_RE = re.compile(r"[,;:](?=\s)|\s[—–-](?=\s)")

LONG_SENTENCE_CHARS = 220


@dataclass
class Spoken:
    """One piece to voice: the text as said and the lecture fragments it refers to."""

    text: str
    refs: list[str] = field(default_factory=list)


def refs_of(text: str) -> list[str]:
    """Fragment ids in [S..] references, in order, without repeats."""
    found: list[str] = []
    for group in _REF_RE.findall(text or ""):
        for ref in _REF_ID_RE.findall(group):
            ref = "S" + ref[1:].zfill(2)
            if ref not in found:
                found.append(ref)
    return found


def speakable(text: str) -> str:
    """The text as the voice should say it: no references, no markdown, one line."""
    value = _OPEN_REF_RE.sub("", _REF_RE.sub("", text or ""))
    value = _BULLET_RE.sub("", value)
    value = _MARKDOWN_RE.sub("", value)
    value = value.replace("*", "").replace("_", " ")
    value = _SPACE_RE.sub(" ", value).strip()
    # A reference before the final dot leaves «слово .»: glue the dot back.
    return re.sub(r"\s+([.,!?…:;])", r"\1", value)


def _dot_ends(buffer: str, index: int, segment_start: int) -> bool:
    """Whether the single dot at ``index`` ends a sentence."""
    start = index
    while start > segment_start and buffer[start - 1].isalpha():
        start -= 1
    word = buffer[start:index]
    if word:
        if word.lower() in _ABBREVIATIONS:
            return False
        return not (len(word) == 1 and word.isupper())  # an initial: «А. С. Пушкин»
    before = buffer[segment_start:index].strip()
    return bool(before) and not before.isdigit()  # «3. …» at the start is a list number


def _boundaries(buffer: str, final: bool = False) -> list[int]:
    """Indexes just after each complete sentence in ``buffer``.

    A sentence ends with . ! ? … (closing quotes and brackets go with it) followed by a space, or
    with a blank line. References right after the mark («… роста. [S03]») belong to the sentence:
    while such a reference is not closed yet, the sentence waits for more text.
    """
    ends: list[int] = []
    index = 0
    length = len(buffer)
    segment_start = 0
    while index < length:
        char = buffer[index]
        if char in ".!?…":
            run_end = index + 1
            while run_end < length and buffer[run_end] in ".!?…":
                run_end += 1
            end = run_end
            while end < length and buffer[end] in _CLOSERS:
                end += 1
            if end < length and buffer[end].isspace():
                run = buffer[index:run_end]
                if run != "." or _dot_ends(buffer, index, segment_start):
                    after = end
                    while after < length and buffer[after].isspace():
                        after += 1
                    if after < length and buffer[after] == "[":
                        close = buffer.find("]", after)
                        if close == -1:
                            if not final:
                                break  # the reference is still being written
                        elif _REF_RE.fullmatch(buffer[after:close + 1]):
                            end = close + 1
                    elif after >= length and not final:
                        break  # a reference may still follow this sentence
                    ends.append(end)
                    segment_start = end
            index = end
            continue
        if char == "\n" and index + 1 < length and buffer[index + 1] == "\n":
            ends.append(index + 2)
            segment_start = index + 2
            index += 2
            continue
        index += 1
    return ends


class SentenceSplitter:
    """Feed streamed pieces, get the sentences completed so far; flush() gives the rest."""

    def __init__(self, long_chars: int = LONG_SENTENCE_CHARS):
        self._buffer = ""
        self._long = max(40, long_chars)

    def feed(self, piece: str) -> list[Spoken]:
        self._buffer += piece or ""
        out: list[Spoken] = []
        while True:
            ends = _boundaries(self._buffer)
            if ends:
                cut = ends[0]
            elif len(self._buffer) > self._long:
                cut = self._soft_cut()
                if cut is None:
                    break
            else:
                break
            spoken = self._take(cut)
            if spoken is not None:
                out.append(spoken)
        return out

    def flush(self) -> list[Spoken]:
        out: list[Spoken] = []
        while True:
            ends = _boundaries(self._buffer, final=True)
            if not ends:
                break
            spoken = self._take(ends[0])
            if spoken is not None:
                out.append(spoken)
        spoken = self._take(len(self._buffer))
        if spoken is not None:
            out.append(spoken)
        return out

    def _soft_cut(self) -> int | None:
        """The last comma, semicolon or colon in the first ``long_chars``, else the last dash."""
        punct = dash = None
        for match in _SOFT_BREAK_RE.finditer(self._buffer[: self._long]):
            if self._buffer[match.start()] in ",;:":
                punct = match.end()
            else:
                dash = match.start() + 1
        for cut in (punct, dash):
            if cut is not None and cut >= 40:
                return cut
        return None

    def _take(self, cut: int) -> Spoken | None:
        raw, self._buffer = self._buffer[:cut], self._buffer[cut:]
        text = speakable(raw)
        if not any(ch.isalnum() for ch in text):
            return None
        return Spoken(text=text, refs=refs_of(raw))
