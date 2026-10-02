import json
import ipaddress
import math
import re
import socket
from typing import Any
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
    
    try:
        return json.loads(json_str)
    except Exception as primary_error:
        try:
            repaired = repair_json(json_str)
            return json.loads(repaired)
        except Exception:
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


def build_source_chunks(text: str, chunk_chars: int = 850, max_chunks: int = 80) -> list[dict[str, str]]:
    """Split extracted text into stable, human-readable source fragments."""
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

    A line with a quote ("fact" visual) must point at the fragment the quote came
    from, so its ids are matched on the quote first, then the model's own valid
    ids, then the line text. Other lines are matched on their text.
    """
    if not isinstance(lines, list):
        return 0
    known = {chunk["id"] for chunk in chunks}
    cited = 0
    for item in lines:
        if not isinstance(item, dict):
            continue
        ids: list[str] = []
        visual = item.get("visual")
        if isinstance(visual, dict) and visual.get("type") == "fact":
            ids = find_source_ids(str(visual.get("text", "")), chunks)
            if not ids:
                own = item.get("source_ids")
                ids = [sid for sid in own if isinstance(sid, str) and sid in known][:2] if isinstance(own, list) else []
        if not ids:
            ids = find_source_ids(str(item.get("text", "")), chunks)
        item["source_ids"] = ids
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
_SOURCE_NUMBER_RE = re.compile(r"\d+(?:[ \u00a0\u202f]\d{3})*(?:[.,]\d+)*")


def _number_readings(token: str) -> set[float]:
    """Every plausible value of a number written in the source ("12,5", "12 500", "1,234")."""
    readings: set[float] = set()
    pieces = [token] + re.split(r"[ \u00a0\u202f]", token)
    for piece in pieces:
        compact = re.sub(r"[ \u00a0\u202f]", "", piece)
        if not compact:
            continue
        candidates = {compact.replace(",", "").replace(".", "")}
        separators = [i for i, ch in enumerate(compact) if ch in ",."]
        if separators:
            last = separators[-1]
            whole = re.sub(r"[.,]", "", compact[:last])
            candidates.add(f"{whole}.{compact[last + 1:]}")
            first = separators[0]
            candidates.add(f"{compact[:first]}.{re.sub(r'[.,]', '', compact[first + 1:])}")
        for candidate in candidates:
            try:
                number = float(candidate)
            except ValueError:
                continue
            if math.isfinite(number):
                readings.add(number)
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
        target = abs(float(value))
        return any(abs(target - number) <= 1e-9 * max(1.0, number) for number in self.numbers)

    def has_date(self, date: str) -> bool:
        normalized = _normalize_for_grounding(date)
        if normalized and normalized in self.normalized:
            return True
        digits = re.findall(r"\d+", date)
        return bool(digits) and all(self.has_number(float(part)) for part in digits)


def visual_is_grounded(visual: dict, facts: "SourceFacts | None") -> bool:
    """Charts and timelines need every number and date in the source; other visuals pass."""
    kind = visual.get("type")
    if kind == "chart":
        return facts is not None and all(facts.has_number(point["value"]) for point in visual["data"])
    if kind == "timeline":
        return facts is not None and all(facts.has_date(event["date"]) for event in visual["events"])
    return True


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

def extract_relevant_paragraphs(text: str, query: str, top_k: int = 8, chunk_chars: int = 700) -> str:
    """
    Splits document text into paragraphs/chunks and retrieves the top_k most relevant chunks 
    matching the query using a highly optimized local TF-IDF semantic relevance ranking.
    """
    if not text or not text.strip():
        return ""
        
    # 1. Split text into paragraphs/chunks by double-newlines
    raw_paragraphs = [p.strip() for p in re.split(r'\n\s*\n', text) if p.strip()]
    
    # If paragraphs are too long, split them into chunks of ~chunk_chars characters
    chunks = []
    for p in raw_paragraphs:
        if len(p) <= chunk_chars * 1.5:
            chunks.append(p)
        else:
            words = p.split()
            current_chunk = []
            current_len = 0
            for w in words:
                current_chunk.append(w)
                current_len += len(w) + 1
                if current_len >= chunk_chars:
                    chunks.append(" ".join(current_chunk))
                    current_chunk = []
                    current_len = 0
            if current_chunk:
                chunks.append(" ".join(current_chunk))
                
    if not chunks:
        return text[:25000] # Fallback to start of text

    # 2. Tokenize helper
    def tokenize(s: str) -> List[str]:
        return re.findall(r'[a-zA-Zа-яА-Я0-9]+', s.lower())

    # Tokenize chunks
    chunk_tokens = [tokenize(c) for c in chunks]
    query_tokens = tokenize(query)
    
    if not query_tokens:
        return "\n\n".join(chunks[:top_k])

    # 3. Calculate IDF for each query term across all chunks
    N = len(chunks)
    idf = {}
    for term in query_tokens:
        df = sum(1 for tokens in chunk_tokens if term in tokens)
        idf[term] = math.log((N + 1) / (df + 1)) + 1.0

    # 4. Score each chunk using TF-IDF cosine-like keyword overlap
    scores = []
    for idx, tokens in enumerate(chunk_tokens):
        if not tokens:
            scores.append((idx, 0.0))
            continue
            
        tf = {}
        for term in tokens:
            tf[term] = tf.get(term, 0) + 1
            
        score = 0.0
        for term in query_tokens:
            if term in tf:
                score += (tf[term] / len(tokens)) * idf[term]
                
        unique_matches = sum(1 for term in query_tokens if term in tf)
        if unique_matches > 1:
            score *= (1.0 + 0.15 * unique_matches)
            
        scores.append((idx, score))

    # 5. Sort by relevance score desc and retrieve top_k chunks
    scores.sort(key=lambda x: x[1], reverse=True)
    top_indices = [idx for idx, score in scores[:top_k] if score > 0.0]
    
    if not top_indices:
        return "\n\n".join(chunks[:top_k])

    # Sort matching indices in chronological order of appearance in the original book
    top_indices.sort()
    
    selected_chunks = [chunks[idx] for idx in top_indices]
    return "\n\n".join(selected_chunks)


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


async def scrape_url(url: str) -> str:
    """
    Scrapes a web page using a hybrid workflow:
    1. Remote Jina Reader API (r.jina.ai/{url}) for JS-heavy/dynamic pages.
    2. Fallback to local httpx + BeautifulSoup for static HTML.
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
                    return text
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
                from bs4 import BeautifulSoup
                soup = BeautifulSoup(html, "html.parser")
                
                # Clean up the HTML
                for element in soup(["script", "style", "nav", "footer", "form", "iframe", "header", "aside"]):
                    element.decompose()
                    
                body = soup.body if soup.body else soup
                
                text_lines = []
                # Gather headers, paragraphs and list items to keep formatting structure
                for element in body.find_all(["h1", "h2", "h3", "h4", "h5", "h6", "p", "li"]):
                    el_text = element.get_text(strip=True)
                    if not el_text:
                        continue
                    if element.name in ("h1", "h2", "h3", "h4", "h5", "h6"):
                        text_lines.append(f"\n\n# {el_text}\n")
                    elif element.name == "p":
                        text_lines.append(f"\n{el_text}\n")
                    elif element.name == "li":
                        text_lines.append(f"\n* {el_text}")
                
                text = "".join(text_lines).strip()
                
                if not text:
                    text = body.get_text(separator="\n", strip=True)
            except ImportError:
                # RegEx based lightweight fallback if beautifulsoup4 is not yet installed in runtime
                import re
                # Remove scripts and styles
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



