"""Analysis coordinator: runs the section agents and validates what they return.

Stream contract (main.py relays these events): ``grounding`` first, then one
``agent_start`` per requested section, one ``agent_done`` per section with its
status, and exactly one terminal event: ``results`` (at least one requested core
section is usable) or ``error`` (nothing usable; main.py sends no ``done`` then).

A model answer counts only after validate_section accepted it. An unusable
answer is evicted from the BaseAgent cache and asked once more; a section that
still has nothing usable is reported as ``empty``, never filled with stand-ins.
An accepted answer then goes through mixed_script.check: Latin look-alikes in
Russian words are replaced and remarks in brackets about the source text go; a
word with a real Latin chunk inside, letters of a script the lecture does not
use («Чем植物 клетки») or a remark inside a sentence are asked once more the same
way (a second such answer loses the sentences with them). The check runs on a
cached answer too: the cache keeps the model's raw text, not checked material.

A lecture that came from a recording (``recording``) has the RECORDING_RULE in
every section prompt: its text is speech recognition and may misspell names and
terms.
"""
import asyncio
import json
import os
import re
from typing import Any, AsyncGenerator, Dict, Optional

import mixed_script
from utils import (
    build_source_chunks,
    build_source_context,
    enrich_agent_result,
    sanitize_podcast_payload,
)
from .base import (
    RECORDING_RULE,
    AIError,
    BaseAgent,
    ai_call_timeout_seconds,
    build_cheatsheet_prompt,
    build_flashcards_prompt,
    build_missions_prompt,
    build_podcast_prompt,
    build_quiz_prompt,
    build_summarizer_prompt,
    heavy_slot,
    parse_model_json,
    split_outer_fence,
)

ALL_AGENTS = ("summarizer", "flashcards", "quiz", "cheatsheet", "podcast", "missions")
CORE_SECTIONS = ("summarizer", "flashcards", "quiz")
JSON_SECTIONS = frozenset({"summarizer", "flashcards", "quiz", "podcast", "missions"})

AGENT_LABELS = {
    "summarizer": "Конспект",
    "flashcards": "Карточки",
    "quiz": "Тест",
    "cheatsheet": "Выжимка",
    "podcast": "Разговор",
    "missions": "Миссии",
}

# Per-section failure lines (agent_done.message, results.sections, warnings).
SECTION_MESSAGES = {
    "empty": "Модель вернула пустой ответ",
    "busy": "Сервис ИИ был перегружен",
    "failed": "Модель не ответила",
    "timeout": "Модель не ответила вовремя",
}

# Terminal error when no requested core section is usable.
TERMINAL_MESSAGES = {
    "busy": "Сервис ИИ сейчас занят. Материал не сохранён, лимит не списан. Попробуйте через минуту.",
    "empty": "Не получилось подготовить ни конспект, ни карточки, ни тест. Материал не сохранён, лимит не списан. Попробуйте ещё раз.",
    "failed": "ИИ-сервис сейчас не ответил. Материал не сохранён, лимит не списан. Повторите через минуту.",
    "timeout": "ИИ-сервис сейчас не ответил. Материал не сохранён, лимит не списан. Повторите через минуту.",
}

SECTION_EMPTY_DETAIL = "Модель вернула пустой ответ. Попробуйте ещё раз."

GROUNDING_INSTRUCTION = (
    "\n\nПРОВЕРЯЕМАЯ ОСНОВА:\nНиже приведены фрагменты исходного материала с идентификаторами [S01], [S02] и т.д. "
    "Используй только информацию из исходного текста. Не добавляй факты, которых в нём нет. "
    "Если поле поддерживает source_ids, укажи один или несколько идентификаторов наиболее подходящих фрагментов."
    "\n\nФРАГМЕНТЫ ИСТОЧНИКА:\n"
)

_EMPTY_RESULTS = {
    "summarizer": {"title": "", "subject": "", "content": "", "terms": []},
    "flashcards": {"flashcards": []},
    "quiz": {"quiz": []},
    "cheatsheet": {"content": ""},
    "podcast": {"podcast": []},
    "missions": {"missions": []},
}


def agent_timeout_seconds() -> float:
    """Per-section deadline including the retry (AI_AGENT_TIMEOUT_SECONDS, default 150)."""
    try:
        value = float(os.getenv("AI_AGENT_TIMEOUT_SECONDS", "150") or 150)
    except ValueError:
        return 150.0
    return value if value > 0 else 150.0


def agent_stagger_seconds() -> float:
    """Pause between agent starts, to soften provider rate limits (default 0.8 s)."""
    try:
        value = float(os.getenv("AI_AGENT_STAGGER_SECONDS", "0.8") or 0.8)
    except ValueError:
        return 0.8
    return max(0.0, value)


def _clamp_int(value: Any, default: int, low: int, high: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return default
    return max(low, min(high, number))


def normalize_settings(settings: Optional[dict] = None, **overrides: Any) -> dict:
    """Section settings with known values only (unknown values fall back to defaults)."""
    raw = dict(settings or {})
    raw.update({key: value for key, value in overrides.items() if value is not None})
    detail = raw.get("summary_detail")
    difficulty = raw.get("quiz_difficulty")
    qtype = raw.get("quiz_type")
    return {
        "summary_detail": detail if detail in ("brief", "medium", "detailed") else "medium",
        "flashcard_count": _clamp_int(raw.get("flashcard_count"), 6, 1, 20),
        "quiz_count": _clamp_int(raw.get("quiz_count"), 5, 1, 20),
        "quiz_difficulty": difficulty if difficulty in ("easy", "medium", "hard", "mixed") else "mixed",
        "quiz_type": qtype if qtype in ("multiple", "truefalse") else "multiple",
    }


def build_prompts(settings: dict, source_chunks: list, *, recording: bool = False) -> dict:
    """The prompt of every section with the grounding block; a recorded lecture's ones say what its text is."""
    grounding = (RECORDING_RULE if recording else "") + GROUNDING_INSTRUCTION + build_source_context(source_chunks)
    prompts = {
        "summarizer": build_summarizer_prompt(settings["summary_detail"]),
        "flashcards": build_flashcards_prompt(settings["flashcard_count"]),
        "quiz": build_quiz_prompt(settings["quiz_count"], settings["quiz_difficulty"], settings["quiz_type"]),
        "cheatsheet": build_cheatsheet_prompt(),
        "podcast": build_podcast_prompt(),
        "missions": build_missions_prompt(),
    }
    return {name: prompt + grounding for name, prompt in prompts.items()}


# --- validation -----------------------------------------------------------------------------

def _text(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)
    return ""


def _first_text(item: dict, keys: tuple) -> str:
    for key in keys:
        value = _text(item.get(key))
        if value:
            return value
    return ""


def _parse(raw: Any) -> Any:
    """The model's JSON (code blocks inside string values survive), or None."""
    if isinstance(raw, str):
        if not raw.strip():
            return None
        try:
            return parse_model_json(raw)
        except Exception:
            return None
    return raw


_ITEM_KEYS = ("question", "вопрос", "front", "speaker", "text")


def _looks_like_item(value: dict) -> bool:
    return any(key in value for key in _ITEM_KEYS)


def _section_items(parsed: Any, key: str, aliases: tuple = ()) -> list:
    """The items of a section: a bare list, {key: [...]}, {key: {...: [...]}}, a single item, or the first list."""
    if isinstance(parsed, list):
        return parsed
    if not isinstance(parsed, dict):
        return []
    for name in (key,) + aliases:
        value = parsed.get(name)
        if isinstance(value, list):
            return value
        if isinstance(value, dict):
            if _looks_like_item(value):
                return [value]
            inner = [v for v in value.values() if isinstance(v, list)]
            return inner[0] if inner else []
    if _looks_like_item(parsed):
        return [parsed]
    for value in parsed.values():
        if isinstance(value, list):
            return value
    return []


_LATIN = "ABCDEF"
_CYRILLIC = "АБВГДЕ"
_HOMOGLYPHS = {"А": "A", "В": "B", "С": "C", "Е": "E"}
# A Cyrillic answer letter when the options are not labelled in Cyrillic: homoglyphs
# first (В is Latin B written in Cyrillic), then the Russian order (Б second, Г fourth).
_CYRILLIC_AS_LATIN = {"А": 0, "В": 1, "Б": 1, "С": 2, "Г": 3, "Д": 3}
_LABEL_RE = re.compile(r"^\s*[\(\[]?\s*([A-Za-zА-Яа-яЁё])\s*[\)\]\.:]\s*(.*)$", re.S)
_ANSWER_LETTER_RE = re.compile(r"^\s*[\(\[]?\s*([A-Za-zА-Яа-яЁё])\s*(?:[\)\]\.:]\s*(.*))?$", re.S)
_SPACES_RE = re.compile(r"\s+")


def _norm(text: str) -> str:
    return _SPACES_RE.sub(" ", text).strip().lower().replace("ё", "е")


def _option_texts(raw: Any) -> Optional[list[str]]:
    if isinstance(raw, dict):
        values = list(raw.values())
        keys = [str(key).strip() for key in raw.keys()]
        texts = [_text(value) for value in values]
        if keys and all(len(key) == 1 for key in keys):
            texts = [f"{key}) {text}" for key, text in zip(keys, texts)]
        return texts
    if isinstance(raw, list):
        texts = []
        for item in raw:
            if isinstance(item, dict):
                texts.append(_first_text(item, ("text", "option", "value", "label")))
            else:
                texts.append(_text(item))
        return texts
    return None


def _strip_labels(texts: list[str]) -> tuple[list[str], Optional[str]]:
    """Remove "A) " style labels when every option carries one in sequence."""
    matches = [_LABEL_RE.match(text) for text in texts]
    if not texts or not all(matches):
        return texts, None
    letters = [match.group(1).upper() for match in matches]
    bodies = [match.group(2).strip() for match in matches]
    count = len(texts)
    if letters == list(_LATIN[:count]):
        return bodies, "latin"
    if letters == list(_CYRILLIC[:count]):
        return bodies, "cyrillic"
    if [_HOMOGLYPHS.get(letter, letter) for letter in letters] == list(_LATIN[:count]):
        return bodies, "latin"
    return texts, None


def _letter_index(letter: str, scheme: Optional[str]) -> Optional[int]:
    letter = letter.upper()
    if letter in _LATIN:
        return _LATIN.index(letter)
    if scheme == "cyrillic":
        return _CYRILLIC.index(letter) if letter in _CYRILLIC else None
    return _CYRILLIC_AS_LATIN.get(letter)


def _correct_index(correct: Any, bodies: list[str], originals: list[str], scheme: Optional[str]) -> Optional[int]:
    if isinstance(correct, list) and len(correct) == 1:
        correct = correct[0]
    if isinstance(correct, dict):
        correct = _first_text(correct, ("letter", "option", "text", "value"))
    answer = _text(correct) if not isinstance(correct, (int, float)) or isinstance(correct, bool) else ""
    if not answer:
        return None
    wanted = _norm(answer)
    for index, body in enumerate(bodies):
        if _norm(body) == wanted:
            return index
    for index, original in enumerate(originals):
        if _norm(original) == wanted:
            return index
    match = _ANSWER_LETTER_RE.match(answer)
    if not match:
        return None
    index = _letter_index(match.group(1), scheme)
    if index is None or index >= len(bodies):
        return None
    rest = _norm(match.group(2) or "")
    if rest and rest != _norm(bodies[index]) and any(_norm(body) == rest for body in bodies):
        return None  # "A) <text of another option>": contradictory
    return index


def _clean_choice_item(item: Any, *, min_options: int = 2, max_options: int = 4) -> Optional[dict]:
    """A question with options rebuilt as "A) …" and ``correct`` as the matching Latin letter."""
    if not isinstance(item, dict):
        return None
    question = _first_text(item, ("question", "вопрос", "text"))
    raw_options = None
    for key in ("options", "variants", "choices", "answers", "варианты"):
        if key in item:
            raw_options = item.get(key)
            break
    originals = _option_texts(raw_options)
    if not question or originals is None or not (min_options <= len(originals) <= max_options):
        return None
    if any(not text for text in originals):
        return None
    bodies, scheme = _strip_labels(originals)
    if any(not body for body in bodies):
        return None
    correct = None
    for key in ("correct", "answer", "correct_answer", "right", "правильный_ответ", "ответ"):
        if key in item:
            correct = item.get(key)
            break
    index = _correct_index(correct, bodies, originals, scheme)
    if index is None:
        return None
    return {
        "question": question,
        "options": [f"{_LATIN[i]}) {body}" for i, body in enumerate(bodies)],
        "correct": _LATIN[index],
        "explanation": _first_text(item, ("explanation", "пояснение", "rationale")),
    }


# Public name for other validators (e.g. /api/mistakes/practice in main.py).
clean_choice_question = _clean_choice_item


def _clean_summary(parsed: Any) -> Optional[dict]:
    if isinstance(parsed, list):
        dicts = [item for item in parsed if isinstance(item, dict)]
        if len(dicts) != 1:
            return None
        parsed = dicts[0]
    if not isinstance(parsed, dict):
        return None
    for wrapper in ("summary", "summarizer", "конспект"):
        inner = parsed.get(wrapper)
        if isinstance(inner, dict) and "content" in inner and "content" not in parsed:
            parsed = inner
            break
    content = parsed.get("content")
    if isinstance(content, list):
        content = "\n\n".join(part.strip() for part in content if isinstance(part, str) and part.strip())
    content = content.strip() if isinstance(content, str) else ""
    if not content:
        return None
    terms: list[dict] = []
    raw_terms = parsed.get("terms")
    if isinstance(raw_terms, dict):
        raw_terms = [{"term": key, "definition": value} for key, value in raw_terms.items()]
    if isinstance(raw_terms, list):
        for item in raw_terms:
            if not isinstance(item, dict):
                continue
            term = _first_text(item, ("term", "термин", "name"))
            if term:
                terms.append({"term": term, "definition": _first_text(item, ("definition", "определение", "description"))})
    return {
        "title": _text(parsed.get("title"))[:200],
        "subject": _text(parsed.get("subject"))[:100],
        "content": content,
        "terms": terms,
    }


def _clean_flashcards(parsed: Any) -> Optional[dict]:
    cards = []
    for item in _section_items(parsed, "flashcards", ("cards", "карточки")):
        if not isinstance(item, dict):
            continue
        question = _first_text(item, ("question", "front", "вопрос", "q"))
        answer = _first_text(item, ("answer", "back", "ответ", "a"))
        if question and answer:
            cards.append({"id": len(cards) + 1, "question": question, "answer": answer})
    return {"flashcards": cards} if cards else None


def _clean_quiz(parsed: Any) -> Optional[dict]:
    questions = []
    for item in _section_items(parsed, "quiz", ("questions", "тест", "вопросы")):
        clean = _clean_choice_item(item)
        if clean is not None:
            questions.append({"id": len(questions) + 1, **clean})
    return {"quiz": questions} if questions else None


def _clean_missions(parsed: Any) -> Optional[dict]:
    missions = []
    for item in _section_items(parsed, "missions", ("квесты",)):
        clean = _clean_choice_item(item)
        if clean is None:
            continue
        clean["title"] = _first_text(item, ("title", "название")) or f"Миссия {len(missions) + 1}"
        clean["hint"] = _first_text(item, ("hint", "подсказка"))
        missions.append({"id": len(missions) + 1, **clean})
    return {"missions": missions} if missions else None


# A fence around the whole cheatsheet is a wrapper only for these tags; a ```python block
# (or two code blocks at both ends) is content and stays a code block.
_WRAPPER_FENCE_TAGS = frozenset({"", "markdown", "md", "text", "txt"})


def _clean_cheatsheet(raw: Any) -> Optional[dict]:
    if isinstance(raw, dict):
        content = _first_text(raw, ("content", "cheatsheet"))
        return {"content": content} if content else None
    if not isinstance(raw, str):
        return None
    text = raw.strip()
    fenced = split_outer_fence(text)
    if fenced is not None and fenced[0] in _WRAPPER_FENCE_TAGS:
        text = fenced[1]
    if not text:
        return None
    looks_like_json = text.startswith("{") or text.lower().startswith("```json")
    if not looks_like_json and text.startswith("["):
        # Markdown may start with a link; only a real JSON list is a broken answer.
        try:
            looks_like_json = isinstance(json.loads(text), (list, dict))
        except ValueError:
            looks_like_json = False
    if looks_like_json:
        parsed = _parse(text)
        if isinstance(parsed, dict):
            content = _first_text(parsed, ("cheatsheet", "content"))
            return {"content": content} if content else None
        return None
    return {"content": text}


def _clean_podcast(parsed: Any, source_text: Optional[str]) -> Optional[dict]:
    if isinstance(parsed, list):
        parsed = {"podcast": parsed}
    elif isinstance(parsed, dict) and not isinstance(parsed.get("podcast"), list):
        lines = _section_items(parsed, "podcast", ("dialogue", "lines"))
        parsed = {"podcast": lines}
    if not isinstance(parsed, dict):
        return None
    clean = sanitize_podcast_payload(parsed, source_text=source_text)
    if not isinstance(clean, dict) or clean.get("error") or not clean.get("podcast"):
        return None
    return clean


def validate_section(name: str, raw: Any, *, source_text: Optional[str] = None) -> tuple[Any, str]:
    """(clean payload, "ok") or (None, "empty") for one section's model answer.

    ``raw`` is the model text (or an already parsed object). Rules: summarizer needs
    non-empty content (a single-dict list is unwrapped, terms are optional);
    flashcards need question and answer (front/back, вопрос/ответ accepted); quiz items
    need a question, 2–4 options rebuilt as "A) …" and ``correct`` matching one of them
    (Latin or Cyrillic letter, "A)" or the exact option text); the cheatsheet needs
    non-empty text; the podcast goes through sanitize_podcast_payload. Ids are 1..n.
    """
    if name == "cheatsheet":
        clean = _clean_cheatsheet(raw)
    else:
        parsed = _parse(raw)
        if name == "summarizer":
            clean = _clean_summary(parsed)
        elif name == "flashcards":
            clean = _clean_flashcards(parsed)
        elif name == "quiz":
            clean = _clean_quiz(parsed)
        elif name == "podcast":
            clean = _clean_podcast(parsed, source_text)
        elif name == "missions":
            clean = _clean_missions(parsed)
        else:
            clean = None
    return (clean, "ok") if clean else (None, "empty")


def _status_from_exception(exc: BaseException) -> str:
    if isinstance(exc, (asyncio.TimeoutError, TimeoutError)):
        return "timeout"
    status = getattr(exc, "status_code", None)
    if status == 429:
        return "busy"
    if status == 504:
        return "timeout"
    return "failed"


def _terminal_code(statuses: list[str]) -> str:
    failures = [status for status in statuses if status != "ok"]
    if failures and all(status == "busy" for status in failures):
        return "busy"
    if any(status == "timeout" for status in failures):
        return "timeout"
    if failures and all(status == "empty" for status in failures):
        return "empty"
    return "failed"


def _count_citable(results: dict) -> int:
    count = 0
    for result in results.values():
        if not isinstance(result, dict):
            continue
        if result.get("source_ids"):
            count += 1
        for value in result.values():
            if isinstance(value, list):
                count += sum(1 for item in value if isinstance(item, dict) and item.get("source_ids"))
    return count


class CoordinatorAgent:
    def __init__(self, api_key: str):
        self.base = BaseAgent(api_key)

    async def _run_agent(self, name: str, prompt: str, text: str, source_chunks: list) -> tuple[str, Any]:
        """(status, payload): ok | empty | busy | failed | timeout, within the per-section deadline.

        A heavy call: the section first waits for its place in the process-wide line
        (heavy_slot, AI_HEAVY_CONCURRENCY); its deadline starts once it has one."""
        async with heavy_slot():
            return await self._run_agent_now(name, prompt, text, source_chunks)

    async def _run_agent_now(self, name: str, prompt: str, text: str, source_chunks: list) -> tuple[str, Any]:
        loop = asyncio.get_running_loop()
        deadline_seconds = agent_timeout_seconds()
        deadline = loop.time() + deadline_seconds
        json_mode = name in JSON_SECTIONS
        # The scripts the lecture itself uses are in place in its materials: a lecture about Chinese writes 汉字.
        scripts = mixed_script.scripts_of(text)

        async def attempts() -> tuple[str, Any]:
            for attempt in range(2):
                left = max(0.05, deadline - loop.time())
                raw = await self.base.run(prompt, text, json_mode=json_mode,
                                          timeout=min(ai_call_timeout_seconds(), left))
                payload, status = validate_section(name, raw, source_text=text)
                if status == "ok":
                    # Latin look-alikes in Russian words are replaced silently; a word with a real
                    # Latin chunk inside («национаisticских»), letters of another script («植物») or a
                    # remark about the source inside a sentence ask for the section once more, and a
                    # second such answer loses the sentences with them (mixed_script.py). A cached
                    # answer is checked the same way: one the old check let through is asked again.
                    payload, broken = mixed_script.check(payload, scripts)
                    if broken and attempt == 0:
                        BaseAgent.forget(raw)
                        print(f"Agent {name}: {len(broken)} broken word(s) on attempt 1, asking again")
                        continue
                    if broken:
                        payload, status = validate_section(
                            name, mixed_script.drop_broken(payload, scripts), source_text=text
                        )
                if status == "ok":
                    return "ok", enrich_agent_result(name, payload, source_chunks)
                # Never keep an unusable answer: the retry (and the next run) must ask again.
                BaseAgent.forget(raw)
                print(f"Agent {name}: unusable answer on attempt {attempt + 1}")
            return "empty", None

        try:
            return await asyncio.wait_for(attempts(), timeout=deadline_seconds)
        except Exception as exc:
            status = _status_from_exception(exc)
            # str(TimeoutError()) is empty: log the type, and the status code when there is one.
            print(f"Agent {name} failed: {type(exc).__name__} status={getattr(exc, 'status_code', None)} -> {status}")
            return status, None

    async def process(
        self,
        text: str,
        summary_detail: str = "medium",
        flashcard_count: int = 6,
        quiz_count: int = 5,
        quiz_difficulty: str = "mixed",
        quiz_type: str = "multiple",
        enabled_agents: Optional[list[str]] = None,
        recording: bool = False,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        settings = normalize_settings(
            summary_detail=summary_detail, flashcard_count=flashcard_count, quiz_count=quiz_count,
            quiz_difficulty=quiz_difficulty, quiz_type=quiz_type,
        )
        source_chunks = build_source_chunks(text)
        yield {"type": "grounding", "source_count": len(source_chunks), "sources": source_chunks}

        prompts = build_prompts(settings, source_chunks, recording=recording)
        wanted = (
            {name for name in enabled_agents if isinstance(name, str)}
            if isinstance(enabled_agents, (list, tuple, set)) else set()
        )
        requested = [name for name in ALL_AGENTS if not wanted or name in wanted]
        if not requested:
            requested = ["summarizer"]

        for name in requested:
            yield {"type": "agent_start", "agent": name, "label": AGENT_LABELS[name]}

        stagger = agent_stagger_seconds()

        async def staggered(name: str, delay: float) -> tuple[str, str, Any]:
            if delay > 0:
                await asyncio.sleep(delay)
            status, payload = await self._run_agent(name, prompts[name], text, source_chunks)
            return name, status, payload

        tasks = [asyncio.ensure_future(staggered(name, index * stagger)) for index, name in enumerate(requested)]
        statuses: dict[str, str] = {}
        payloads: dict[str, Any] = {}
        for done_count, next_done in enumerate(asyncio.as_completed(tasks), start=1):
            name, status, payload = await next_done
            statuses[name] = status
            event: dict[str, Any] = {
                "type": "agent_done",
                "agent": name,
                "label": AGENT_LABELS[name],
                "progress": done_count,
                "total": len(requested),
                "status": status,
            }
            if status == "ok":
                payloads[name] = payload
                event["result"] = payload
            else:
                event["message"] = SECTION_MESSAGES[status]
            yield event

        core_requested = [name for name in requested if name in CORE_SECTIONS]
        considered = core_requested or requested
        if not any(statuses.get(name) == "ok" for name in considered):
            code = _terminal_code([statuses.get(name, "failed") for name in requested])
            yield {"type": "error", "code": code, "message": TERMINAL_MESSAGES[code]}
            return

        results: dict[str, Any] = {}
        warnings = []
        sections: dict[str, dict] = {}
        for name in ALL_AGENTS:
            if name not in requested:
                results[name] = json.loads(json.dumps(_EMPTY_RESULTS[name]))
                continue
            status = statuses.get(name, "failed")
            if status == "ok":
                results[name] = payloads[name]
                sections[name] = {"status": "ok"}
            else:
                message = SECTION_MESSAGES[status]
                results[name] = {"error": message}
                sections[name] = {"status": status, "message": message}
                warnings.append({"agent": name, "message": message})

        yield {
            "type": "results",
            **results,
            "warnings": warnings,
            "sections": sections,
            "grounding": {
                "source_count": len(source_chunks),
                "citable_items": _count_citable({name: payloads[name] for name in payloads}),
                "sources": source_chunks,
            },
        }

    async def run_section(self, name: str, text: str, settings: Optional[dict] = None) -> dict:
        """One core section for an already analysed text (the «Досоздать» button).

        Same prompts, grounding block (same S-ids as the saved material), validation and
        eviction as process(). Raises AIError: 429 busy, 504 timeout, 502 failed or empty.
        """
        if name not in CORE_SECTIONS:
            raise ValueError(f"unknown section {name!r}")
        source_chunks = build_source_chunks(text)
        prompts = build_prompts(normalize_settings(settings), source_chunks)
        status, payload = await self._run_agent(name, prompts[name], text, source_chunks)
        if status == "ok":
            return {
                "section": name,
                "status": "ok",
                "result": payload,
                "grounding": {"source_count": len(source_chunks), "sources": source_chunks},
            }
        if status == "busy":
            raise AIError.busy()
        if status == "timeout":
            raise AIError.timeout()
        if status == "empty":
            raise AIError.failed(SECTION_EMPTY_DETAIL)
        raise AIError.failed()
