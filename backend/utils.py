import json
import ipaddress
import math
import re
import socket
from typing import Any, Sequence, Union
from urllib.parse import urljoin, urlparse

def repair_json(json_str: str) -> str:
    """Repair truncated or malformed JSON strings by backtracking and closing open structures."""
    json_str = json_str.strip()
    if not json_str:
        return "{}"
        
    # We progressively backtrack from the end to find a cut-off point that can be closed into a valid JSON structure.
    max_backtrack = min(3000, len(json_str))
    
    for trim_len in range(max_backtrack + 1):
        test_str = json_str[:len(json_str) - trim_len].strip()
        if not test_str:
            break
            
        # Strip trailing chars that are invalid before closing brackets
        while test_str and test_str[-1] in (',', ':', '[', '{', '"', '\\', ' ', '\t', '\n', '\r'):
            test_str = test_str[:-1].strip()
            
        if not test_str:
            continue
            
        # Count open structures safely
        state = 'normal'
        stack = []
        i = 0
        valid = True
        
        while i < len(test_str):
            char = test_str[i]
            if state == 'normal':
                if char == '"':
                    state = 'string'
                elif char in ('{', '['):
                    stack.append(char)
                elif char in ('}', ']'):
                    if stack:
                        op = stack.pop()
                        if (char == '}' and op != '{') or (char == ']' and op != '['):
                            valid = False
                            break
                    else:
                        valid = False
                        break
            elif state == 'string':
                if char == '\\':
                    state = 'escape'
                elif char == '"':
                    state = 'normal'
            elif state == 'escape':
                state = 'string'
            i += 1
            
        if not valid or state != 'normal':
            continue
            
        # Close the open brackets/braces
        closed_str = test_str
        for op in reversed(stack):
            if op == '{':
                closed_str += '}'
            elif op == '[':
                closed_str += ']'
                
        try:
            parsed = json.loads(closed_str)
            return closed_str
        except Exception:
            continue
            
    return "{}"

# LaTeX inside JSON strings ------------------------------------------------
#
# A model that puts a formula into a JSON string often keeps LaTeX's single
# backslash: "$\text{COUNT}$", "$\frac{a}{b}$". json.loads reads \t, \f, \b, \r
# and \n as a TAB, a form feed, a backspace, a carriage return and a newline
# («\text» turns into TAB + «ext», KaTeX then shows «extCOUNT»), and refuses the
# whole answer at «\alpha» or «\sum» (not JSON escapes at all). Before json.loads,
# repair_latex_escapes() doubles such a backslash, so the text keeps the command.
#
# Only backslashes inside JSON strings are looked at, and real escapes stay:
# \" \\ \/ and \uXXXX always; \n and \t unless the letters after the backslash
# spell exactly one LaTeX command («\nnot» is a newline and «not», «\neq» is ≠);
# \r before a non-letter («\r\n»). \f and \b followed by a letter are always
# LaTeX: a form feed or a backspace never belongs in a model's text. The
# two-letter \ne and \ni count only inside $…$ (outside a formula «\ne» is as
# likely a new line that starts with «e»).

_LATEX_EDGE_RE = re.compile(r'["\\$]')
_HEX4_RE = re.compile(r"[0-9a-fA-F]{4}")
_ASCII_LETTERS = frozenset("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ")
# Commands that begin with \t (besides every \text…).
_LATEX_T_NAMES = frozenset({
    "tau", "theta", "times", "tilde", "to", "tan", "tanh", "tg", "th", "tag", "tfrac", "tbinom", "tiny",
    "therefore", "thinspace", "thickspace", "thicksim", "thickapprox", "triangle", "triangleleft",
    "triangleright", "trianglelefteq", "trianglerighteq", "triangleq", "triangledown",
    "twoheadrightarrow", "twoheadleftarrow",
})
# Commands that begin with \n.
_LATEX_N_NAMES = frozenset({
    "nu", "neq", "neg", "not", "notin", "nabla", "natural", "nearrow", "nwarrow", "newline", "nolimits",
    "nonumber", "notag", "nexists", "nleq", "ngeq", "nleqslant", "ngeqslant", "nsubseteq", "nsupseteq",
    "nparallel", "nshortparallel", "nrightarrow", "nleftarrow", "nleftrightarrow", "nRightarrow",
    "nLeftarrow", "nLeftrightarrow", "nvdash", "nvDash", "nVdash",
})
_LATEX_N_INLINE = frozenset({"ne", "ni"})


def _letters_at(text: str, start: int) -> str:
    end = start
    while end < len(text) and text[end] in _ASCII_LETTERS:
        end += 1
    return text[start:end]


def _is_latex_command(name: str, formula: int, previous: str) -> bool:
    """Whether a backslash before `name` (its letters; the first one is a JSON escape) starts LaTeX.

    formula: 0 outside a formula of this string, 1 inside $…$, 2 inside $$…$$.
    """
    letter = name[:1]
    if letter in ("b", "f", "r"):
        return len(name) >= 2
    if letter == "t":
        return name in _LATEX_T_NAMES or name.startswith("text")
    if letter == "n":
        if name in _LATEX_N_NAMES:
            return True
        return formula == 1 and name in _LATEX_N_INLINE and previous != "$"
    return False


def repair_latex_escapes(text: str) -> str:
    """The model's JSON text with the backslash of every LaTeX command kept for json.loads.

    Linear; a text without a backslash comes back as it is.
    """
    if not isinstance(text, str) or "\\" not in text:
        return text
    parts: list[str] = []
    last = 0
    in_string = False
    formula = 0
    position = 0
    while True:
        edge = _LATEX_EDGE_RE.search(text, position)
        if edge is None:
            break
        at = edge.start()
        char = text[at]
        if char == '"':
            in_string = not in_string
            formula = 0
            position = at + 1
            continue
        if not in_string:
            position = at + 1
            continue
        if char == "$":
            if text.startswith("$$", at):
                formula = 0 if formula == 2 else 2 if formula == 0 else formula
                position = at + 2
            else:
                formula = 0 if formula == 1 else 1 if formula == 0 else formula
                position = at + 1
            continue
        following = text[at + 1:at + 2]
        if not following:
            break
        if following in ('"', "/"):
            position = at + 2
            continue
        if following == "\\":
            # An escaped backslash; «\\$» is LaTeX's dollar sign, not the edge of a formula.
            position = at + 3 if text.startswith("$", at + 2) else at + 2
            continue
        if following == "u" and _HEX4_RE.fullmatch(text, at + 2, at + 6):
            position = at + 6
            continue
        if following in "bfnrt" and not _is_latex_command(_letters_at(text, at + 1), formula, text[at - 1:at]):
            position = at + 2
            continue
        # LaTeX, or a backslash JSON does not know («\alpha», «\(», «\%»): kept as a backslash.
        parts.append(text[last:at])
        parts.append("\\\\")
        last = at + 1
        position = at + 2
    if not parts:
        return text
    parts.append(text[last:])
    return "".join(parts)


def latex_safe_candidates(text: str) -> list[str]:
    """What json.loads should try, in order: the text with LaTeX backslashes kept, then the text as it is."""
    repaired = repair_latex_escapes(text)
    return [repaired, text] if repaired != text else [text]


def parse_llm_json(raw: str) -> Any:
    """Utility to extract and parse JSON from LLM string output, with auto-repair support."""
    if not isinstance(raw, str):
        raise ValueError("Ответ модели должен быть строкой")
    json_str = raw.strip().lstrip("\ufeff")
    if "```json" in json_str:
        json_str = json_str.split("```json")[1].split("```")[0]
    elif "```" in json_str:
        json_str = json_str.split("```")[1].split("```")[0]
    
    # Try finding the first JSON bracket if surrounded by conversational text
    if not (json_str.startswith('{') or json_str.startswith('[')):
        start = -1
        for char in ('{', '['):
            idx = json_str.find(char)
            if idx != -1 and (start == -1 or idx < start):
                start = idx
        if start != -1:
            json_str = json_str[start:]
            
    json_str = json_str.strip()

    # LaTeX written with one backslash keeps it (repair_latex_escapes); the text as it is comes second.
    primary_error: Exception | None = None
    for candidate in latex_safe_candidates(json_str):
        try:
            return json.loads(candidate)
        except Exception as error:
            primary_error = primary_error or error
    for candidate in latex_safe_candidates(json_str):
        try:
            return json.loads(repair_json(candidate))
        except Exception:
            continue
    raise primary_error


# Source grounding helpers -------------------------------------------------
#
# The model still receives the full extracted document, but these compact,
# numbered excerpts give it stable anchors and let the UI show where a card or
# question came from.  This is deliberately lexical: it is deterministic,
# cheap, and honest about what has (and has not) been verified.
_SOURCE_STOPWORDS = {
    "это", "также", "который", "которая", "которые", "после", "перед",
    "если", "при", "для", "или", "как", "что", "из", "на", "по", "с",
    "и", "в", "во", "к", "у", "о", "об", "до", "не", "ни", "от",
    "the", "and", "for", "with", "that", "this", "from", "are", "was",
}


def _source_tokens(value: str) -> set[str]:
    return {
        token for token in re.findall(r"[a-zа-яё0-9]{3,}", (value or "").lower())
        if token not in _SOURCE_STOPWORDS
    }


SOURCE_CHUNK_CHARS = 850  # the longest source fragment ([S01] …) build_source_chunks makes


def build_source_chunks(text: str, chunk_chars: int = SOURCE_CHUNK_CHARS, max_chunks: int = 80) -> list[dict[str, str]]:
    """Split extracted text into stable, human-readable source fragments.

    The rule never changes for a saved text: summary_json.grounding, the evidence of the list
    check and the answer points name fragments by these ids. A paragraph (text between blank
    lines) up to chunk_chars is one fragment; a longer one is cut by words. Extraction decides
    where the blank lines are (pack_source_blocks for DOCX).
    """
    if not text or not text.strip():
        return []

    paragraphs = [part.strip() for part in re.split(r"\n\s*\n", text) if part.strip()]
    chunks: list[str] = []
    for paragraph in paragraphs:
        if len(paragraph) <= chunk_chars:
            chunks.append(paragraph)
            continue

        words = paragraph.split()
        current: list[str] = []
        current_length = 0
        for word in words:
            if current and current_length + len(word) + 1 > chunk_chars:
                chunks.append(" ".join(current))
                current = []
                current_length = 0
            current.append(word)
            current_length += len(word) + 1
        if current:
            chunks.append(" ".join(current))

    return [
        {"id": f"S{index:02d}", "text": chunk[:chunk_chars].strip()}
        for index, chunk in enumerate(chunks[:max_chunks], start=1)
        if chunk.strip()
    ]


# A document whose paragraphs are known (DOCX) is written as blocks for build_source_chunks: the
# paragraphs of a block on lines of their own, blocks apart by a blank line, each block at most
# SOURCE_CHUNK_CHARS. build_source_chunks then cuts exactly between blocks, so a fragment never ends
# inside a paragraph or a table row: a table goes into one fragment whole when it fits, else row by
# row. Only a single paragraph or row longer than a fragment is still cut by words. A heading (a short
# line without a final stop) after a finished thought opens a block, and a heading or a lead-in line
# («…управляют операторы:») at the end of a full block moves on with what it introduces.
SourceUnit = Union[str, Sequence[str]]  # a paragraph, or a table as its rows
_BLOCK_CLOSERS = " \t»\"'”’)]"
_HEADING_BLOCK_CHARS = 120


def _block_end(line: str) -> str:
    return line.strip().rstrip(_BLOCK_CLOSERS)[-1:]


def _table_row(line: str) -> bool:
    return " | " in line


def _block_heading(line: str) -> bool:
    text = line.strip()
    return bool(text) and len(text) <= _HEADING_BLOCK_CHARS and not _table_row(text) and _block_end(text) not in ".!?…:;,"


def _block_lead(line: str) -> bool:
    return not _table_row(line) and _block_end(line) == ":"


def _finished_thought(line: str) -> bool:
    return _table_row(line) or _block_end(line) in ".!?…"


def _list_item(line: str) -> bool:
    return not _table_row(line) and _block_end(line) in ";,"


def _carried_tail(lines: list[str]) -> int:
    """How many last lines of a full block go on to the next one: from the first heading or lead-in
    of its tail of headings, lead-ins and list items («…операторы:», «START …;») to the end. The
    first line of the block always stays."""
    start = len(lines)
    while start > 1 and (_block_heading(lines[start - 1]) or _block_lead(lines[start - 1]) or _list_item(lines[start - 1])):
        start -= 1
    for index in range(start, len(lines)):
        if _block_heading(lines[index]) or _block_lead(lines[index]):
            return len(lines) - index
    return 0


def _paragraph_lines(text: str) -> list[str]:
    """A paragraph's own lines (soft line breaks), without blank ones: only blocks are apart by a blank line."""
    return [line.rstrip() for line in str(text).split("\n") if line.strip()]


def pack_source_blocks(units: Sequence[SourceUnit], limit: int = SOURCE_CHUNK_CHARS) -> str:
    """The text of paragraphs and tables in blocks that build_source_chunks keeps whole (see above)."""
    blocks: list[list[str]] = []
    current: list[str] = []

    def size(lines: list[str]) -> int:
        return sum(len(line) for line in lines) + max(0, len(lines) - 1)

    def close() -> None:
        nonlocal current
        if current:
            blocks.append(current)
        current = []

    def add(lines: list[str], heading: bool) -> None:
        nonlocal current
        if not lines:
            return
        if current and heading and _finished_thought(current[-1]):
            close()  # a new section begins
        elif current and size(current) + 1 + size(lines) > limit:
            carried = _carried_tail(current)
            moved = current[len(current) - carried:] if carried else []
            if moved and size(moved) + 1 + size(lines) <= limit:
                current = current[: len(current) - carried]
                close()
                current = moved
            else:
                close()
        current = current + lines
        if size(current) > limit:
            close()  # one paragraph or row longer than a fragment stands alone

    for unit in units:
        if isinstance(unit, str):
            lines = _paragraph_lines(unit)
            add(lines, heading=len(lines) == 1 and _block_heading(lines[0]))
            continue
        rows = [row for row in (str(item).strip() for item in unit) if row]
        if size(rows) <= limit:
            add(rows, heading=False)  # the whole table in one fragment
        else:
            for row in rows:
                add([row], heading=False)
    close()
    return "\n\n".join("\n".join(block) for block in blocks)


def build_source_context(chunks: list[dict[str, str]], max_chars: int = 14000) -> str:
    """Format source fragments for a prompt without overflowing the context."""
    parts: list[str] = []
    used = 0
    for chunk in chunks:
        part = f"[{chunk['id']}] {chunk['text']}"
        if parts and used + len(part) + 2 > max_chars:
            break
        parts.append(part)
        used += len(part) + 2
    return "\n\n".join(parts)


def find_source_ids(query: str, chunks: list[dict[str, str]], top_k: int = 2) -> list[str]:
    """Return the best lexical source matches for one generated item."""
    query_tokens = _source_tokens(query)
    if not query_tokens:
        return []

    scored: list[tuple[float, int, str]] = []
    for index, chunk in enumerate(chunks):
        chunk_tokens = _source_tokens(chunk.get("text", ""))
        overlap = query_tokens & chunk_tokens
        if not overlap:
            continue
        # A small bonus for covering several distinct concepts keeps a generic
        # one-word match from beating a genuinely explanatory fragment.
        score = len(overlap) + min(len(overlap), 5) * 0.15
        scored.append((score, index, chunk["id"]))

    scored.sort(key=lambda item: (-item[0], item[1]))
    return [source_id for _, _, source_id in scored[:top_k]]


def annotate_podcast(lines: Any, chunks: list[dict[str, str]]) -> int:
    """Source ids for conversation lines.

    A line whose visual can be checked points at the fragments that back it: a
    chart or timeline at the fragments holding its numbers and dates (the
    model's own id only when it really holds them), a word-for-word quote at
    the fragment it was copied from. Every other line, a paraphrased "fact"
    included, is matched on its text, which is all those ids claim.
    """
    if not isinstance(lines, list):
        return 0
    facts_cache: dict[str, "SourceFacts"] = {}
    cited = 0
    for item in lines:
        if not isinstance(item, dict):
            continue
        ids = visual_source_ids(item.get("visual"), chunks, item.get("source_ids"), facts_cache)
        if not ids and not (isinstance(item.get("visual"), dict) and item["visual"].get("type") in ("chart", "timeline")):
            ids = find_source_ids(str(item.get("text", "")), chunks)
        item["source_ids"] = ids or []
        cited += bool(ids)
    return cited


def enrich_agent_result(name: str, payload: Any, chunks: list[dict[str, str]]) -> Any:
    """Attach deterministic source ids to citable generated items."""
    if not isinstance(payload, dict) or payload.get("error"):
        return payload

    def annotate(items: Any, query_builder) -> int:
        count = 0
        if not isinstance(items, list):
            return count
        for item in items:
            if not isinstance(item, dict):
                continue
            source_ids = find_source_ids(query_builder(item), chunks)
            item["source_ids"] = source_ids
            count += bool(source_ids)
        return count

    cited = 0
    if name == "summarizer":
        cited += annotate(payload.get("terms"), lambda item: f"{item.get('term', '')} {item.get('definition', '')}")
        payload["source_ids"] = find_source_ids(payload.get("content", ""), chunks, top_k=3)
        cited += bool(payload["source_ids"])
    elif name == "flashcards":
        cited += annotate(payload.get("flashcards"), lambda item: f"{item.get('question', '')} {item.get('answer', '')}")
    elif name == "quiz":
        cited += annotate(payload.get("quiz"), lambda item: f"{item.get('question', '')} {item.get('explanation', '')}")
    elif name == "missions":
        cited += annotate(payload.get("missions"), lambda item: f"{item.get('title', '')} {item.get('explanation', '')} {item.get('question', '')}")
    elif name == "podcast":
        cited += annotate_podcast(payload.get("podcast"), chunks)
    elif name == "cheatsheet":
        payload["source_ids"] = find_source_ids(payload.get("content", ""), chunks, top_k=3)
        cited += bool(payload["source_ids"])
    return payload


# Conversation ("Разговор") visuals ------------------------------------------
#
# summary_json.podcast is an array of {speaker, text, source_ids?, visual?}.
# The model output is untrusted, so every visual is rebuilt from scratch with
# only the keys of the shared contract; anything that does not fit the
# contract is dropped (the line itself is kept).
VISUAL_TITLE_MAX = 80
VISUAL_ITEM_MAX = 120
VISUAL_TEXT_MAX = 280
VISUAL_LATEX_MAX = 200
VISUAL_UNIT_MAX = 24
VISUAL_NODE_ID_MAX = 40
PODCAST_SPEAKER_MAX = 40
PODCAST_TEXT_MAX = 2000
PODCAST_MAX_LINES = 40
PODCAST_MAX_SOURCE_IDS = 5

VISUAL_TYPES = (
    "term", "steps", "compare", "formula", "chart",
    "timeline", "diagram", "fact", "question", "scene",
)
VISUAL_ICONS = (
    "brain", "book", "atom", "dna", "globe", "calculator", "chart", "clock",
    "lightbulb", "users", "scale", "cpu", "leaf", "flask", "landmark",
    "music", "heart", "map",
)
_DEFAULT_SPEAKERS = ("Макс", "Софья")
# The UI picks the voice by name, so transliterated host names are mapped back.
_SPEAKER_ALIASES = {
    "макс": "Макс", "max": "Макс", "maks": "Макс",
    "софья": "Софья", "софия": "Софья", "sofia": "Софья", "sofya": "Софья",
    "sophia": "Софья", "sofiya": "Софья",
}


def _visual_text(value: Any, limit: int) -> str:
    """Coerce a model value to one clean line of text no longer than `limit`."""
    if isinstance(value, bool) or value is None:
        return ""
    if isinstance(value, (int, float)):
        if isinstance(value, float) and not math.isfinite(value):
            return ""
        value = str(value)[:limit]
    if not isinstance(value, str):
        return ""
    text = " ".join(value.split())
    if len(text) > limit:
        text = text[: limit - 1].rstrip() + "…"
    return text


def _visual_list(value: Any, limit: int, max_items: int) -> list[str]:
    if not isinstance(value, list):
        return []
    items = [_visual_text(item, limit) for item in value]
    return [item for item in items if item][:max_items]


def _visual_number(value: Any) -> float | int | None:
    """Accept finite numbers and plain numeric strings such as "12,5", "40%" or "12 500".

    "12,500" and "1,234,567" use the comma as a thousands separator; any other
    single comma is a decimal mark.
    """
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        number = value
    elif isinstance(value, str):
        cleaned = re.sub(r"[\s\u00a0\u202f]", "", value.strip())
        if cleaned.endswith("%"):
            cleaned = cleaned[:-1]
        if re.fullmatch(r"[-+]?\d{1,3}(,\d{3})+", cleaned):
            cleaned = cleaned.replace(",", "")
        else:
            cleaned = cleaned.replace(",", ".", 1)
        if not re.fullmatch(r"[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?", cleaned):
            return None
        number = float(cleaned)
    else:
        return None
    try:
        if not math.isfinite(number) or abs(number) > 1e15:
            return None
    except OverflowError:
        return None
    if isinstance(number, float) and number.is_integer():
        return int(number)
    return number


def _clean_latex(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    latex = value.strip()
    for opener, closer in (("$$", "$$"), ("\\[", "\\]"), ("\\(", "\\)"), ("$", "$")):
        if len(latex) >= len(opener) + len(closer) and latex.startswith(opener) and latex.endswith(closer):
            latex = latex[len(opener): len(latex) - len(closer)].strip()
            break
    latex = " ".join(latex.split())
    # An unescaped % starts a KaTeX comment and silently cuts the formula.
    latex = re.sub(r"(?<!\\)%", r"\\%", latex)
    # A cut formula would not render, so an over-long one is rejected instead.
    if not latex or len(latex) > VISUAL_LATEX_MAX:
        return ""
    return latex


def _visual_side(value: Any) -> dict | None:
    if not isinstance(value, dict):
        return None
    label = _visual_text(value.get("label"), VISUAL_TITLE_MAX)
    points = _visual_list(value.get("points"), VISUAL_ITEM_MAX, 4)
    if not label or not points:
        return None
    return {"label": label, "points": points}


def sanitize_visual(visual: Any) -> dict | None:
    """Rebuild one conversation visual per the shared contract, or return None."""
    if not isinstance(visual, dict):
        return None
    kind = visual.get("type")
    kind = kind.strip().lower() if isinstance(kind, str) else ""
    if kind not in VISUAL_TYPES:
        return None

    title = _visual_text(visual.get("title"), VISUAL_TITLE_MAX)

    if kind == "term":
        term = _visual_text(visual.get("term"), VISUAL_TITLE_MAX)
        definition = _visual_text(visual.get("definition"), VISUAL_TEXT_MAX)
        if not term or not definition:
            return None
        return {"type": "term", "term": term, "definition": definition}

    if kind == "steps":
        items = _visual_list(visual.get("items"), VISUAL_ITEM_MAX, 6)
        if not title or len(items) < 2:
            return None
        return {"type": "steps", "title": title, "items": items}

    if kind == "compare":
        left = _visual_side(visual.get("left"))
        right = _visual_side(visual.get("right"))
        if not title or not left or not right:
            return None
        return {"type": "compare", "title": title, "left": left, "right": right}

    if kind == "formula":
        latex = _clean_latex(visual.get("latex"))
        if not title or not latex:
            return None
        result: dict[str, Any] = {"type": "formula", "title": title, "latex": latex}
        legend = []
        raw_legend = visual.get("legend")
        if isinstance(raw_legend, list):
            for entry in raw_legend:
                if not isinstance(entry, dict):
                    continue
                symbol = _visual_text(entry.get("symbol"), VISUAL_TITLE_MAX)
                meaning = _visual_text(entry.get("meaning"), VISUAL_ITEM_MAX)
                if symbol and meaning:
                    legend.append({"symbol": symbol, "meaning": meaning})
                if len(legend) == 5:
                    break
        if legend:
            result["legend"] = legend
        return result

    if kind == "chart":
        raw_data = visual.get("data")
        if not title or not isinstance(raw_data, list):
            return None
        data = []
        for point in raw_data[:8]:
            if not isinstance(point, dict):
                return None
            label = _visual_text(point.get("label"), VISUAL_TITLE_MAX)
            value = _visual_number(point.get("value"))
            # One unreadable value makes the whole chart untrustworthy.
            if not label or value is None:
                return None
            data.append({"label": label, "value": value})
        if len(data) < 2:
            return None
        chart_kind = visual.get("kind")
        chart_kind = chart_kind.strip().lower() if isinstance(chart_kind, str) else ""
        result = {
            "type": "chart",
            "title": title,
            "kind": chart_kind if chart_kind in ("bar", "line") else "bar",
            "data": data,
        }
        unit = _visual_text(visual.get("unit"), VISUAL_UNIT_MAX)
        if unit:
            result["unit"] = unit
        return result

    if kind == "timeline":
        events = []
        raw_events = visual.get("events")
        if isinstance(raw_events, list):
            for event in raw_events:
                if not isinstance(event, dict):
                    continue
                date = _visual_text(event.get("date"), VISUAL_TITLE_MAX)
                label = _visual_text(event.get("label"), VISUAL_ITEM_MAX)
                if date and label:
                    events.append({"date": date, "label": label})
                if len(events) == 6:
                    break
        if not title or len(events) < 2:
            return None
        return {"type": "timeline", "title": title, "events": events}

    if kind == "diagram":
        nodes = []
        seen_ids: set[str] = set()
        raw_nodes = visual.get("nodes")
        if isinstance(raw_nodes, list):
            for node in raw_nodes:
                if not isinstance(node, dict):
                    continue
                node_id = _visual_text(node.get("id"), VISUAL_NODE_ID_MAX)
                label = _visual_text(node.get("label"), VISUAL_TITLE_MAX)
                if not node_id or not label or node_id in seen_ids:
                    continue
                seen_ids.add(node_id)
                nodes.append({"id": node_id, "label": label})
                if len(nodes) == 7:
                    break
        if not title or len(nodes) < 2:
            return None
        edges = []
        seen_edges: set[tuple[str, str]] = set()
        raw_edges = visual.get("edges")
        if isinstance(raw_edges, list):
            for edge in raw_edges:
                if not isinstance(edge, dict):
                    continue
                source = _visual_text(edge.get("from"), VISUAL_NODE_ID_MAX)
                target = _visual_text(edge.get("to"), VISUAL_NODE_ID_MAX)
                if source not in seen_ids or target not in seen_ids or source == target:
                    continue
                if (source, target) in seen_edges:
                    continue
                seen_edges.add((source, target))
                clean_edge = {"from": source, "to": target}
                label = _visual_text(edge.get("label"), VISUAL_TITLE_MAX)
                if label:
                    clean_edge["label"] = label
                edges.append(clean_edge)
                if len(edges) == 10:
                    break
        if not edges:
            return None
        return {"type": "diagram", "title": title, "nodes": nodes, "edges": edges}

    if kind == "fact":
        text = _visual_text(visual.get("text"), VISUAL_TEXT_MAX)
        if not title or not text:
            return None
        return {"type": "fact", "title": title, "text": text}

    if kind == "question":
        question = _visual_text(visual.get("question"), VISUAL_TEXT_MAX)
        answer = _visual_text(visual.get("answer"), VISUAL_TEXT_MAX)
        if not question or not answer:
            return None
        return {"type": "question", "question": question, "answer": answer}

    # kind == "scene"
    icon = visual.get("icon")
    icon = icon.strip().lower() if isinstance(icon, str) else ""
    caption = _visual_text(visual.get("caption"), VISUAL_TEXT_MAX)
    if not title or icon not in VISUAL_ICONS or not caption:
        return None
    return {"type": "scene", "title": title, "icon": icon, "caption": caption}


# Grounding: charts and timelines show numbers and dates as facts, so they are
# kept only when every value and date can be found in the source text.
#
# A number in the source is a run of digits with optional thousands groups
# ("12 500") and a decimal part ("12,5"). A leading minus counts only when it
# stands apart from the previous token ("−40", "до -5"), so ranges such as
# "1941-1945" stay positive.
_SOURCE_NUMBER_RE = re.compile(
    r"(?:(?<![\w.,)\]])[-−–](?=\d))?\d+(?:[ \u00a0\u202f]\d{3}(?!\d))*(?:[.,]\d+)*"
)
_NUMBER_SIGNS = "-−–"
_GROUP_SPACE_RE = re.compile(r"[ \u00a0\u202f]")


def _plain_readings(compact: str) -> set[float]:
    """Values of one number written without spaces.

    A comma or dot groups thousands only before groups of exactly three digits
    ("12,500", "1.234.567"); otherwise the last one is the decimal mark: "12,5"
    is 12.5 and never 125, "3,14" is never 314.
    """
    groups = re.split(r"[.,]", compact)
    texts: set[str] = set()
    if len(groups) == 1:
        texts.add(compact)
    elif groups[0]:
        if all(len(group) == 3 for group in groups[1:]):
            texts.add("".join(groups))
        if groups[-1] and all(len(group) == 3 for group in groups[1:-1]):
            texts.add("".join(groups[:-1]) + "." + groups[-1])
    values: set[float] = set()
    for text in texts:
        try:
            value = float(text)
        except ValueError:
            continue
        if math.isfinite(value):
            values.add(value)
    return values


def _number_readings(token: str) -> set[float]:
    """Every plausible value of a number written in the source.

    "12 500" is 12500, not 12 and 500. A group of four or more digits cannot
    open a grouped number, so "2019 150" is 2019 and 150. Three or more groups
    ("100 200 300") may also be a row of table values, so each group counts as
    well. A sign belongs to the first number of the run.
    """
    negative = token[:1] in _NUMBER_SIGNS
    pieces = _GROUP_SPACE_RE.split(token.lstrip(_NUMBER_SIGNS))
    readings: set[float] = set()

    def add(values: set[float], signed: bool) -> None:
        for value in values:
            readings.add(-value if signed and negative else value)

    signed = True
    while len(pieces) > 1 and len(pieces[0]) > 3:
        add(_plain_readings(pieces[0]), signed)
        signed = False
        pieces = pieces[1:]
    add(_plain_readings("".join(pieces)), signed)
    if len(pieces) >= 3:
        for index, piece in enumerate(pieces):
            add(_plain_readings(piece), signed and index == 0)
    return readings


def _normalize_for_grounding(text: str) -> str:
    return " ".join(re.sub(r"[^\w]+", " ", text.lower().replace("ё", "е")).split())


class SourceFacts:
    """Numbers and normalised text of a source, for checking chart and timeline visuals."""

    def __init__(self, text: str):
        self.numbers: set[float] = set()
        for match in _SOURCE_NUMBER_RE.finditer(text or ""):
            self.numbers |= _number_readings(match.group(0))
        self.normalized = _normalize_for_grounding(text or "")

    def has_number(self, value: float) -> bool:
        """The exact value, sign included, is written in the source."""
        target = float(value)
        return any(abs(target - number) <= 1e-9 * max(1.0, abs(number)) for number in self.numbers)

    def has_date(self, date: str) -> bool:
        """The date starts a word of the source and is not part of a longer number.

        "XIX век" is found in "в XIX веке" and "1885 г." in "в 1885 году", but
        "85" is not found in "1885" and "век" not in "человек". Without a literal
        match every year of the date (three or more digits) must be a number of
        the source: "1853–1856" matches "с 1853 по 1856 год", while "18 век"
        never matches just because 18 appears somewhere.
        """
        normalized = _normalize_for_grounding(date)
        if normalized and re.search(r"(?<!\w)" + re.escape(normalized) + r"(?!\d)", self.normalized):
            return True
        digits = re.findall(r"\d+", date)
        return bool(digits) and all(len(part) >= 3 and self.has_number(float(part)) for part in digits)


def visual_is_grounded(visual: dict, facts: "SourceFacts | None") -> bool:
    """Charts and timelines need every number and date in the source; other visuals pass."""
    kind = visual.get("type")
    if kind == "chart":
        return facts is not None and all(facts.has_number(point["value"]) for point in visual["data"])
    if kind == "timeline":
        return facts is not None and all(facts.has_date(event["date"]) for event in visual["events"])
    return True


QUOTE_MIN_CHARS = 12


def _quote_parts(text: str) -> list[str]:
    """A quote split at ellipses into the parts that must appear in the source in order."""
    parts = (_normalize_for_grounding(part) for part in re.split(r"…|\.\.\.", text or ""))
    return [part for part in parts if part]


def quote_source_ids(text: str, chunks: list[dict[str, str]]) -> list[str]:
    """Fragments a quote was copied from word for word, or [] for a paraphrase.

    Case, ё/е and punctuation are ignored and an ellipsis may skip words. A
    quote may run across the boundary of two neighbouring fragments.
    """
    parts = _quote_parts(text)
    if sum(len(part) for part in parts) < QUOTE_MIN_CHARS:
        return []
    spans: list[tuple[int, int, str]] = []
    joined = ""
    for chunk in chunks:
        normalized = _normalize_for_grounding(chunk.get("text", ""))
        if not normalized:
            continue
        if joined:
            joined += " "
        spans.append((len(joined), len(joined) + len(normalized), chunk["id"]))
        joined += normalized
    start = -1
    position = 0
    for part in parts:
        found = joined.find(part, position)
        if found < 0:
            return []
        if start < 0:
            start = found
        position = found + len(part)
    return [source_id for begin, end, source_id in spans if begin < position and end > start]


def _covering_source_ids(
    checks: list,
    chunks: list[dict[str, str]],
    own_ids: Any,
    facts_cache: "dict[str, SourceFacts]",
) -> list[str]:
    """Fragments that hold every number or date of a chart or timeline.

    The model's own fragment wins when it holds them all, then the first
    fragment that does, then the fewest fragments (up to three) that cover them
    together. [] when they cannot be covered.
    """
    if not checks:
        return []
    everything = set(range(len(checks)))
    order = {chunk["id"]: index for index, chunk in enumerate(chunks)}
    covers: dict[str, set[int]] = {}
    for chunk in chunks:
        source_id = chunk["id"]
        facts = facts_cache.get(source_id)
        if facts is None:
            facts = facts_cache[source_id] = SourceFacts(chunk.get("text", ""))
        covered = {index for index, check in enumerate(checks) if check(facts)}
        if covered:
            covers[source_id] = covered
    own = [source_id for source_id in own_ids if source_id in covers] if isinstance(own_ids, list) else []
    for source_id in own + list(covers):
        if covers[source_id] == everything:
            return [source_id]
    chosen: list[str] = []
    done: set[int] = set()
    while done != everything and len(chosen) < 3:
        best = max(covers, key=lambda source_id: (len(covers[source_id] - done), source_id in own), default=None)
        if best is None or not covers[best] - done:
            break
        chosen.append(best)
        done |= covers[best]
    if done != everything:
        return []
    return sorted(chosen, key=lambda source_id: order[source_id])


def visual_source_ids(
    visual: Any,
    chunks: list[dict[str, str]],
    own_ids: Any = None,
    facts_cache: "dict[str, SourceFacts] | None" = None,
) -> list[str] | None:
    """Fragments behind a visual whose content can be checked, or None.

    Charts and timelines point at the fragments that hold their numbers and
    dates; a quote ("fact") at the fragment it was copied from, or [] for a
    paraphrase. Other visuals make no checkable claim and return None.
    """
    if not isinstance(visual, dict):
        return None
    cache = facts_cache if facts_cache is not None else {}
    kind = visual.get("type")
    if kind == "chart":
        checks = [lambda facts, value=point["value"]: facts.has_number(value) for point in visual.get("data", [])]
        return _covering_source_ids(checks, chunks, own_ids, cache)
    if kind == "timeline":
        checks = [lambda facts, date=event["date"]: facts.has_date(date) for event in visual.get("events", [])]
        return _covering_source_ids(checks, chunks, own_ids, cache)
    if kind == "fact":
        ids = quote_source_ids(str(visual.get("text", "")), chunks)
        own = [source_id for source_id in own_ids if source_id in ids] if isinstance(own_ids, list) else []
        return (own + [source_id for source_id in ids if source_id not in own])[:2]
    return None


def _clean_source_ids(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    ids: list[str] = []
    for item in value:
        if not isinstance(item, str):
            continue
        source_id = item.strip().strip("[]").strip().upper()
        if re.fullmatch(r"S\d{1,3}", source_id) and source_id not in ids:
            ids.append(source_id)
        if len(ids) == PODCAST_MAX_SOURCE_IDS:
            break
    return ids


def sanitize_podcast_lines(lines: Any, source_text: str | None = None) -> list[dict[str, Any]]:
    """Normalise conversation lines; legacy {speaker, text[, source_ids]} pass through.

    Charts and timelines are kept only when their numbers and dates appear in
    source_text; without a source they are dropped (the line stays).
    """
    if not isinstance(lines, list):
        return []
    facts = SourceFacts(source_text) if source_text and source_text.strip() else None
    clean: list[dict[str, Any]] = []
    for line in lines:
        if not isinstance(line, dict):
            continue
        raw_text = line.get("text")
        text = raw_text.strip() if isinstance(raw_text, str) else _visual_text(raw_text, PODCAST_TEXT_MAX)
        if not text:
            continue
        if len(text) > PODCAST_TEXT_MAX:
            text = text[: PODCAST_TEXT_MAX - 1].rstrip() + "…"

        speaker = _visual_text(line.get("speaker"), PODCAST_SPEAKER_MAX)
        speaker = _SPEAKER_ALIASES.get(speaker.lower(), speaker)
        if not speaker:
            # Keep the two voices alternating when the model forgot a name.
            previous = clean[-1]["speaker"] if clean else _DEFAULT_SPEAKERS[1]
            speaker = _DEFAULT_SPEAKERS[0] if previous == _DEFAULT_SPEAKERS[1] else _DEFAULT_SPEAKERS[1]

        item: dict[str, Any] = {"speaker": speaker, "text": text}
        if "source_ids" in line:
            item["source_ids"] = _clean_source_ids(line.get("source_ids"))
        visual = sanitize_visual(line.get("visual"))
        if visual and visual_is_grounded(visual, facts):
            item["visual"] = visual
        clean.append(item)
        if len(clean) == PODCAST_MAX_LINES:
            break
    return clean


def sanitize_podcast_payload(payload: Any, source_text: str | None = None) -> Any:
    """Sanitise a parsed podcast agent result ({"podcast": [...]}) in place of the raw one."""
    if not isinstance(payload, dict) or payload.get("error"):
        return payload
    lines = sanitize_podcast_lines(payload.get("podcast"), source_text)
    if not lines:
        return {"error": "Ответ ИИ пришёл в неверном формате"}
    return {"podcast": lines}


def sanitize_podcast_visuals(items: Any, line_count: int, source_text: str | None = None) -> list[dict[str, Any]]:
    """Keep {index, visual} pairs that point at an existing line; first one per line wins.

    Charts and timelines must be grounded in source_text (see sanitize_podcast_lines).
    """
    if not isinstance(items, list) or line_count <= 0:
        return []
    facts = SourceFacts(source_text) if source_text and source_text.strip() else None
    by_index: dict[int, dict[str, Any]] = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        index = item.get("index")
        if isinstance(index, str) and index.strip().isdigit():
            index = int(index.strip())
        if isinstance(index, bool) or not isinstance(index, int):
            continue
        if index < 0 or index >= line_count or index in by_index:
            continue
        visual = sanitize_visual(item.get("visual"))
        if visual and visual_is_grounded(visual, facts):
            by_index[index] = visual
    return [{"index": index, "visual": by_index[index]} for index in sorted(by_index)]


from typing import List, Dict


# Video hosts: «Ссылка» reads the text of a page, and a video page has none — what was scraped from
# YouTube was its chrome («Sign in to confirm you're not a bot», subscribers, chapters) and still cost
# a lecture (live QA 2026-10-11). main.analyze_url refuses these links before any charge or fetch.
_VIDEO_HOSTS = ("youtube.com", "youtube-nocookie.com", "youtu.be", "rutube.ru", "vkvideo.ru", "vimeo.com", "tiktok.com")
# Hosts where only some pages are videos: VK and OK clips and videos, Dzen videos and shorts.
_VIDEO_PATHS = {
    "vk.com": ("/video", "/clip"),
    "vk.ru": ("/video", "/clip"),
    "ok.ru": ("/video",),
    "dzen.ru": ("/video", "/shorts"),
    "zen.yandex.ru": ("/video", "/shorts"),
}


def _host_matches(hostname: str, domain: str) -> bool:
    return hostname == domain or hostname.endswith("." + domain)


def is_video_link(url: str) -> bool:
    """A link to a video page (YouTube, Rutube, VK Video, Dzen video…), with or without the scheme."""
    text = (url or "").strip()
    if not re.match(r"^[a-z][a-z0-9+.-]*://", text, re.IGNORECASE):
        text = "https://" + text
    try:
        parsed = urlparse(text)
        hostname = (parsed.hostname or "").rstrip(".").lower()
    except ValueError:
        return False
    if not hostname:
        return False
    if any(_host_matches(hostname, domain) for domain in _VIDEO_HOSTS):
        return True
    path = (parsed.path or "/").lower()
    for domain, prefixes in _VIDEO_PATHS.items():
        if _host_matches(hostname, domain):
            if path.startswith(prefixes):
                return True
            # vk.com/wall-1_2?z=video-1_2: a video opened over another page.
            return re.search(r"(?:^|&)z=(?:video|clip)", parsed.query or "", re.IGNORECASE) is not None
    return False


# The text of a web page (scrape_url) as a lecture. The Jina Reader answers in Markdown: its own header,
# links as [text](%-encoded address), images, the infobox as a table, «[↑]» back-links and the reference
# lists. Live QA 2026-10-11: a short Wikipedia article came out as 89 532 characters («около 112 мин» of
# reading) with %-encoded links in the fragments. clean_page_text keeps the text of links and drops their
# addresses, images (a formula drawn as an image keeps its TeX as $…$), lines made only of links (menus,
# breadcrumbs, «see also»), footnote marks, reference lists and reference sections («Примечания»,
# «Литература», «Ссылки»…); headings, list items and table rows («cell | cell», like DOCX) stay as plain
# lines, and the paragraphs go into fragment blocks (pack_source_blocks) before anything counts them.
_REFERENCE_HEADINGS = re.compile(
    r"^(?:примечания|сноски|комментарии|литература|список литературы|библиография|источники|ссылки|"
    r"внешние ссылки|см\.? также|notes|references|bibliography|sources|external links|see also|"
    r"further reading|footnotes)$",
    re.IGNORECASE,
)
_LINK_URL = r"\((?:[^()\s]|\([^()\s]*\))*(?:\s+\"[^\"]*\")?\)"  # (address "title"), one level of ( ) inside
_BRACKETED = r"\[((?:[^\[\]]|\[[^\[\]]*\])*)\]"  # [text], one level of [ ] inside
_IMAGE_RE = re.compile(r"!" + _BRACKETED + _LINK_URL)
_LINKED_IMAGE_RE = re.compile(r"\[\s*!" + _BRACKETED + _LINK_URL + r"\s*\]" + _LINK_URL)
_LINK_RE = re.compile(_BRACKETED + _LINK_URL)
_AUTOLINK_RE = re.compile(r"<(?:https?|ftp)://[^>\s]*>")
_BARE_URL_RE = re.compile(r"\b(?:https?|ftp)://[^\s<>()\[\]]+(?:\([^\s()]*\))?[^\s<>()\[\].,;:!?»\"']*")
# The text of a footnote link: «[10]», «10», «a», «прим. 3».
_FOOTNOTE_TEXT_RE = re.compile(r"^(?:\[?\d{1,3}\]?|[a-zа-я]|прим\.?\s*\d{1,3}|note\s*\d{1,3})$", re.IGNORECASE)
_SYMBOLS_ONLY_RE = re.compile(r"^[\W_]*$")
_FORMULA_ALT_RE = re.compile(r"^(?:Image\s+\d+:\s*)?\{\\displaystyle\s+(.*)\}\s*$", re.DOTALL)
_CODE_SPAN_RE = re.compile(r"`[^`\n]+`")
_KEPT = chr(0)  # a formula or a code span waits here as «KEPT n KEPT» while the line is cleaned
_KEPT_RE = re.compile(_KEPT + r"(\d+)" + _KEPT)
# Wikipedia marks the stress in its first line (U+0301 after «е» in «Теорема»): the mark splits a word.
_STRESS_RE = re.compile("(?<=[А-Яа-яЁё])[" + chr(0x300) + chr(0x301) + "]")
_ITALIC_RE = re.compile(r"(?<![\w\\*])([*_])(?=\S)([^*_\n]*?\S)\1(?![\w*])")
_LIST_MARK_RE = re.compile(r"^\s*(?:[*+-]|(\d{1,3})[.)])\s+")
_HEADING_RE = re.compile(r"^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$")
_SETEXT_RE = re.compile(r"^\s{0,3}(?:=+|-+)\s*$")
_TABLE_SEPARATOR_RE = re.compile(r"^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$")
# Signs of an item of a reference list. A strong one is enough: a back-link, an ISBN, a DOI, an archive
# copy. Weak ones — «— М.:», «486 с.», a publisher, «(англ.)», an author in italics — need a second sign:
# «t = 5 с.» in a list of a physics lecture is not a reference.
_REFERENCE_STRONG_RE = re.compile(r"\[↑\]|\bISBN\b|\bdoi\b|Архивная копия|Дата обращения|\bRetrieved\b")
_REFERENCE_WEAK_RES = (
    re.compile(r"[—–-]\s*(?:М|СПб|Л|К|Мн|Киев|Минск|Новосибирск|Екатеринбург|Казань)\.?\s*[:,]"),
    re.compile(r"\b(?:Изд-во|изд\.|Издательство)|\bPress\b|\bPublications?\b"),
    re.compile(r"\b\d+\s*с\.(?=\s|$|[;,.:)])|\bс\.\s*\d|\bТ\.\s*\d"),
    re.compile(r"\((?:англ|нем|фр|итал|исп|лат)\.\)"),
    re.compile(r"_\[?[A-ZА-ЯЁ][\w-]+,?\s+(?:[A-ZА-ЯЁ]\.\s*){1,2}\]?"),
)


def _reference_item(line: str) -> bool:
    """A list item that reads as a reference (two signs, or one strong sign)."""
    if _REFERENCE_STRONG_RE.search(line):
        return True
    return sum(1 for pattern in _REFERENCE_WEAK_RES if pattern.search(line)) >= 2
_JINA_HEADER_RE = re.compile(r"^(?:Title|URL Source|Published Time|Warning|Description):", re.IGNORECASE)
# A pointer to another article («Основная статья: …»), not text of this one.
_HATNOTE_RE = re.compile(
    r"^(?:основная статья|основные статьи|главная статья|см\.? также|подробнее|main articles?|see also|"
    r"further information)\s*:",
    re.IGNORECASE,
)


def _clean_page_line(line: str, kept: list) -> str:
    """One line of page Markdown as text. Formulas and code spans go to ``kept`` (restored at the end)."""
    def keep(value: str) -> str:
        kept.append(value)
        return f"{_KEPT}{len(kept) - 1}{_KEPT}"

    def image(match: re.Match) -> str:
        formula = _FORMULA_ALT_RE.match(match.group(1).strip())
        return keep("$" + " ".join(formula.group(1).split()) + "$") if formula else " "

    def link(match: re.Match) -> str:
        text = match.group(1).strip()
        bare = text.replace("*", "").replace("_", "").strip()
        if _FOOTNOTE_TEXT_RE.match(bare) or _SYMBOLS_ONLY_RE.match(bare):
            return ""  # «[[10]](…)», «[↑](…)», «[**➤**](…)»: footnotes and back-links
        return text

    line = _CODE_SPAN_RE.sub(lambda match: keep(match.group(0)), line)
    # The Reader drops the space between two links in a row («[теорем](…)[евклидовой](…)»).
    line = re.sub(r"\)(?=!?\[)", ") ", line)
    line = _LINKED_IMAGE_RE.sub(" ", line)
    line = _IMAGE_RE.sub(image, line)
    for _ in range(2):  # a link inside the text of a link
        line = _LINK_RE.sub(link, line)
    line = _AUTOLINK_RE.sub(" ", line)
    line = _BARE_URL_RE.sub(" ", line)
    line = re.sub(r"\*\*|__", "", line)
    line = _ITALIC_RE.sub(r"\2", line)
    line = re.sub(r"\\([\\`*_{}\[\]()#+\-.!|>~])", r"\1", line)  # Markdown escapes
    line = _STRESS_RE.sub("", line)
    # Spaces it also drops: before a dash after a word («Пифагора— одна»), around a formula
    # («чисел$(x,y,z)$»); and the ones a removed footnote leaves before punctuation.
    line = re.sub(r"(?<=[^\s\-–—(«„\"'/])—(?=\s)", " —", line)
    line = re.sub(r"(?<=[^\W_])(?=" + _KEPT + r"\d+" + _KEPT + ")", " ", line)
    line = re.sub(r"(" + _KEPT + r"\d+" + _KEPT + r")(?=[^\W\d_])", r"\1 ", line)
    return re.sub(r"\s+(?=[,.;:!?)»])", "", line)


def _links_only(line: str) -> bool:
    """A line of links and images only (a menu, breadcrumbs, «see also», a picture), not a formula."""
    if "](" not in line:
        return False
    if any(_FORMULA_ALT_RE.match(match.group(1).strip()) for match in _IMAGE_RE.finditer(line)):
        return False
    rest = _LINK_RE.sub("", _IMAGE_RE.sub("", _LINKED_IMAGE_RE.sub("", line)))
    return not re.search(r"[^\W_]", _LIST_MARK_RE.sub("", rest).replace("|", ""))


def _reference_runs(lines: list) -> set:
    """Lines of the lists that are reference lists: at least half of their items are references.

    A list runs over items, blank lines and indented lines; a heading or a paragraph ends it."""
    dropped: set = set()
    run: list = []
    items = references = 0
    in_code = False

    def finish() -> None:
        nonlocal run, items, references
        if items >= 2 and references * 2 >= items:
            dropped.update(run)
        run, items, references = [], 0, 0

    for index, line in enumerate(lines):
        if line.strip().startswith("```"):
            in_code = not in_code
            finish()
            continue
        if in_code:
            continue
        if _LIST_MARK_RE.match(line):
            run.append(index)
            items += 1
            references += _reference_item(line)
        elif not line.strip() or (run and line.startswith((" ", "\t"))):
            if run:
                run.append(index)
        else:
            finish()
    finish()
    return dropped


def clean_page_text(text: str) -> str:
    """Text of a scraped page (Markdown of the Jina Reader or of the local fallback) without the page's
    chrome, addresses of links, images and reference lists, in fragment blocks (pack_source_blocks)."""
    if not isinstance(text, str) or not text.strip():
        return ""
    kept: list = []
    title = ""
    lines = text.replace("\r\n", "\n").replace("\r", "\n").replace(_KEPT, "").split("\n")
    marker = next((index for index, line in enumerate(lines[:40]) if line.strip() == "Markdown Content:"), None)
    header = lines[:marker] if marker is not None else []
    if marker is None:
        while lines and (not lines[0].strip() or _JINA_HEADER_RE.match(lines[0])):
            header.append(lines.pop(0))
    else:
        lines = lines[marker + 1:]
    for line in header:
        if line.lower().startswith("title:"):
            title = " ".join(_clean_page_line(line.split(":", 1)[1], kept).split())

    paragraphs: list = []
    current: list = []
    in_code = False
    skip_level = 0  # inside a reference section: the level of its heading
    dropped = _reference_runs(lines)

    def close() -> None:
        if current:
            paragraphs.append("\n".join(current))
            current.clear()

    for index, raw in enumerate(lines):
        if raw.strip().startswith("```") or in_code:
            if raw.strip().startswith("```"):
                in_code = not in_code
            if not skip_level:
                current.append(raw.rstrip())
            continue
        following = lines[index + 1] if index + 1 < len(lines) else ""
        heading = _HEADING_RE.match(raw)
        level, heading_text = (len(heading.group(1)), heading.group(2)) if heading else (0, "")
        if not heading and raw.strip() and _SETEXT_RE.match(following) and not _LIST_MARK_RE.match(raw):
            level, heading_text = (1 if following.strip().startswith("=") else 2), raw.strip()
        if level:
            if skip_level and level > skip_level:
                continue
            name = " ".join(_clean_page_line(heading_text, kept).split()).strip(" :")
            skip_level = level if _REFERENCE_HEADINGS.match(_KEPT_RE.sub("", name).strip(" .")) else 0
            close()
            if not skip_level and name:
                paragraphs.append(name)
            continue
        if _SETEXT_RE.match(raw) and index > 0 and lines[index - 1].strip():
            continue  # the underline of a setext heading, or a rule
        if skip_level or index in dropped:
            continue
        if not raw.strip():
            close()
            continue
        stripped = raw.strip()
        if _TABLE_SEPARATOR_RE.match(stripped) or _links_only(stripped) or _HATNOTE_RE.match(stripped):
            continue
        item = _LIST_MARK_RE.match(raw)
        if "[↑]" in stripped or "[^" in stripped or (item and _reference_item(stripped)):
            continue  # a footnote with its back-link, an item of a reference list
        cleaned = _clean_page_line(stripped, kept)
        if stripped.startswith("|"):
            cells = [" ".join(cell.split()) for cell in cleaned.strip().strip("|").split("|")]
            cleaned = " | ".join(cell for cell in cells if cell)
        elif item:
            mark = _LIST_MARK_RE.match(cleaned)
            body = cleaned[mark.end():] if mark else cleaned
            cleaned = (f"{item.group(1)}. " if item.group(1) else "- ") + body
        else:
            cleaned = re.sub(r"^(?:>\s?)+", "", cleaned)
        cleaned = " ".join(cleaned.split())
        if re.search(r"[^\W_]", _KEPT_RE.sub("x", cleaned)) and not re.fullmatch(r"(?:[-*]|\d{1,3}\.)", cleaned):
            current.append(cleaned)
    close()
    if title and (not paragraphs or paragraphs[0].split("\n", 1)[0].strip(" |") != title):
        paragraphs.insert(0, title)
    return _KEPT_RE.sub(lambda match: kept[int(match.group(1))], pack_source_blocks(paragraphs)).strip()


def is_safe_public_url(url: str) -> bool:
    """Allow only public HTTP(S) targets; DNS is checked immediately before fetching."""
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            return False
        hostname = parsed.hostname.rstrip(".").lower()
        if hostname == "localhost" or hostname.endswith(".localhost"):
            return False
        try:
            address = ipaddress.ip_address(hostname)
        except ValueError:
            return True
        return address.is_global
    except ValueError:
        return False


async def _assert_public_target(url: str) -> None:
    if not is_safe_public_url(url):
        raise ValueError("Можно анализировать только публичные HTTP/HTTPS-ссылки.")

    hostname = urlparse(url).hostname
    if not hostname:
        raise ValueError("В ссылке не найден адрес сайта.")

    try:
        resolved = await __import__("asyncio").to_thread(
            socket.getaddrinfo, hostname, None, type=socket.SOCK_STREAM
        )
    except socket.gaierror as exc:
        raise ValueError("Не удалось найти сайт по указанному адресу.") from exc

    addresses = {item[4][0] for item in resolved}
    if not addresses or any(not ipaddress.ip_address(address).is_global for address in addresses):
        raise ValueError("Ссылки на локальные и внутренние адреса запрещены.")


async def _get_public_response(client, url: str, max_redirects: int = 3):
    current_url = url
    for _ in range(max_redirects + 1):
        await _assert_public_target(current_url)
        response = await client.get(current_url, timeout=10.0, follow_redirects=False)
        if response.status_code not in (301, 302, 303, 307, 308):
            return response
        location = response.headers.get("location")
        if not location:
            raise ValueError("Сайт вернул некорректное перенаправление.")
        current_url = urljoin(current_url, location)
    raise ValueError("Сайт перенаправляет запрос слишком много раз.")


# Parts of a page that are not its text (the local fallback of scrape_url): navigation, footnote marks,
# reference lists, the table of contents, edit links, categories.
_PAGE_CHROME_TAGS = ["script", "style", "noscript", "nav", "footer", "form", "iframe", "header", "aside", "svg", "button", "menu"]
_PAGE_CHROME_SELECTOR = (
    "sup.reference, .reference, .mw-references-wrap, ol.references, .reflist, .references, .navbox, "
    ".mw-editsection, #toc, .toc, .catlinks, .mw-jump-link, [role=navigation], .noprint, .metadata"
)


def _html_page_markdown(html: str) -> str:
    """Headings, paragraphs, list items, table rows and code of an HTML page as Markdown for
    clean_page_text. The text of an element keeps its own spaces (get_text(strip=True) glued
    «теорем» and «евклидовой» into one word); an item made only of links (a menu) is left out."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    for element in soup(_PAGE_CHROME_TAGS):
        element.decompose()
    for element in soup.select(_PAGE_CHROME_SELECTOR):
        element.decompose()
    body = soup.body if soup.body else soup
    blocks = []
    for element in body.find_all(["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "pre", "tr"]):
        if element.find_parent(["p", "li", "pre", "tr"]) is not None:
            continue  # its text is in the enclosing element
        if element.name == "pre":
            code = element.get_text().strip("\n")
            if code.strip():
                blocks.append(f"```\n{code}\n```")
            continue
        if element.name == "tr":
            cells = [" ".join(cell.get_text().split()) for cell in element.find_all(["td", "th"])]
            if any(cells):
                blocks.append("| " + " | ".join(cells) + " |")
            continue
        text = " ".join(element.get_text().split())
        if not text:
            continue
        links = " ".join(" ".join(link.get_text().split()) for link in element.find_all("a"))
        if element.name in ("p", "li") and links and " ".join(links.split()) == text:
            continue  # a menu item or a line of links
        if element.name.startswith("h"):
            blocks.append("#" * int(element.name[1]) + " " + text)
        elif element.name == "li":
            blocks.append("- " + text)
        else:
            blocks.append(text)
    return "\n\n".join(blocks) or body.get_text(separator="\n", strip=True)


async def scrape_url(url: str) -> str:
    """
    Scrapes a web page using a hybrid workflow:
    1. Remote Jina Reader API (r.jina.ai/{url}) for JS-heavy/dynamic pages.
    2. Fallback to local httpx + BeautifulSoup for static HTML.
    Either way the text goes through clean_page_text: the analysis, its fragments and the reading
    time count the page's own text, without the addresses of links and the reference lists.
    """
    import httpx

    if not url.startswith(("http://", "https://")):
        url = "https://" + url

    await _assert_public_target(url)

    jina_url = f"https://r.jina.ai/{url}"
    try:
        async with httpx.AsyncClient(follow_redirects=False) as client:
            response = await client.get(jina_url, timeout=12.0)
            if response.status_code == 200 and response.text.strip():
                text = response.text
                if "Failed to fetch" not in text and "Error fetching" not in text:
                    cleaned = clean_page_text(text)
                    if cleaned.strip():
                        return cleaned
    except Exception as e:
        print(f"Jina API extraction failed: {e}")

    # Local fallback
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        async with httpx.AsyncClient(follow_redirects=False, headers=headers) as client:
            response = await _get_public_response(client, url)
            if response.status_code != 200:
                raise ValueError(f"HTTP error {response.status_code}")

            html = response.text
            try:
                text = clean_page_text(_html_page_markdown(html))
            except ImportError:
                # RegEx based lightweight fallback if beautifulsoup4 is not yet installed in runtime
                html_clean = re.sub(r'<(script|style|nav|footer|header|form|iframe|aside)[^>]*>([\s\S]*?)<\/\1>', ' ', html, flags=re.IGNORECASE)
                # Strip other tags
                text = re.sub(r'<[^>]+>', ' ', html_clean)
                # Decode basic HTML entities
                text = text.replace('&nbsp;', ' ').replace('&lt;', '<').replace('&gt;', '>').replace('&amp;', '&')
                # Clean up duplicate newlines/whitespaces
                text = re.sub(r'\s+', ' ', text).strip()

            if not text.strip():
                raise ValueError("Извлеченный текст пуст")

            return text
    except Exception as e:
        raise ValueError(f"Не удалось прочитать веб-страницу: {e}")
