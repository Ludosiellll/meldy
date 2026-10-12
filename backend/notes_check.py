"""Second reading of the конспект: one more model call compares each of its sentences with the lecture.

The fact rechecks of releases 44.7–44.9 (12.10.2026) found every serious slip of the history lecture in the конспект,
each time in a new form: a case ending that made France declare war on Russia («1 августа войну России объявила
Германия, 3 августа — Франция»), «грозил втянуть» retold as «неизбежно втягивал», the armistice «привело к крушению»
four empires. The prompt already named such forms (agents.base.RETELL_RULE); more prompt text moved the habit from one
section to another, it did not stop it. A reader who holds the lecture next to the конспект finds them at once, so the
конспект is read against the lecture once more: the checker gets the numbered sentences of the конспект (term
definitions too) and the lecture, and returns the smallest fix for each sentence that says something other than the
lecture or more than it.

A fix is applied only when it is still the same sentence: similar words (MIN_LIKENESS), no number that neither the
lecture nor the sentence has, not much longer. A checker that wants to change more than a third of the конспект has
misread something, and then nothing is applied. Any failure — busy, timeout, an answer without the list — leaves the
конспект as it was: the check can bring the конспект closer to the lecture, it never costs the student the material.
The report (what was changed and why) goes to the stream's results event as ``checks``; the page does not read it.

Off unless AI_NOTES_CHECK is on (since release 44.11). The live check of 44.10 (nine runs of three lectures, Gemini
3.5 Flash-Lite as the checker): 11 fixes — one useful («получить новые территории» → «место под солнцем»), two
harmless, three removed what the lecture does say (the mitochondria's own ribosomes; «все организмы состоят из
клеток» twice), two copied speech-recognition errors of a transcript into the конспект («1 вулт», «обратное
сопротивлением»); it missed «моментально перерос», «сербского национализма, усиленного…» and a merged cause. A checker
that removes true facts is worse than none.
"""
import asyncio
import difflib
import math
import os
import re
import time
from dataclasses import dataclass
from typing import Any, Optional

import mixed_script
from agents.base import parse_model_json

DEFAULT_TIMEOUT_SECONDS = 30.0
MIN_BUDGET_SECONDS = 4.0
# The lecture and the конспект go to the checker whole; a longer lecture is not checked.
MAX_LECTURE_CHARS = 150_000
MIN_WORDS = 4
# A fix keeps most of the sentence: «неизбежно втягивал» → «грозил втянуть» is 0.9, a sentence rewritten from scratch
# is under 0.5.
MIN_LIKENESS = 0.5
MAX_SHARE = 0.34
MIN_LIMIT = 4
MAX_TOKENS = 4096

_OFF_VALUES = ("0", "false", "no", "off")


def enabled() -> bool:
    """AI_NOTES_CHECK: off unless set to something other than 0/false/no/off (see the module's note)."""
    return (os.getenv("AI_NOTES_CHECK", "0") or "0").strip().lower() not in _OFF_VALUES


def timeout_seconds() -> float:
    """AI_NOTES_CHECK_TIMEOUT_SECONDS (default 30): the most the check may add to the конспект."""
    try:
        value = float(os.getenv("AI_NOTES_CHECK_TIMEOUT_SECONDS", str(DEFAULT_TIMEOUT_SECONDS)) or DEFAULT_TIMEOUT_SECONDS)
    except ValueError:
        return DEFAULT_TIMEOUT_SECONDS
    return value if value > 0 else DEFAULT_TIMEOUT_SECONDS


# --- sentences -------------------------------------------------------------------------------

@dataclass(frozen=True)
class Unit:
    """One checked piece: a sentence of content (its place in it) or the definition of terms[term]."""
    key: str
    text: str
    start: int = -1
    end: int = -1
    term: int = -1


_HEADING_RE = re.compile(r"^\s{0,3}#{1,6}\s")
_LIST_MARK_RE = re.compile(r"^\s*(?:[-*+•]|\d{1,3}[.)])\s+")
_MATH_RE = re.compile(r"\$\$[\s\S]*?\$\$|\$[^$\n]+\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]")
_BOUNDARY_RE = re.compile(r"([.!?…]+[»\"”')\]]*)\s+(?=[«\"„'(\[*_]*[A-ZА-ЯЁ0-9])")
_WORD_RE = re.compile(r"[^\W\d_]+")
_LAST_WORD_RE = re.compile(r"([^\W\d_]+)$")
# A period after these does not end a sentence: «в 1914 г. Германия», «т. е.», «А. С. Пушкин».
_ABBREVIATIONS = frozenset({
    "г", "гг", "в", "вв", "т", "д", "др", "пр", "см", "рис", "им", "ст", "н", "э", "руб", "тыс", "млн", "млрд",
    "англ", "лат", "греч", "ок", "ср", "стр", "св", "ул", "акад", "проф", "доц", "мин", "сек", "e", "g", "i", "etc",
    "vs", "dr", "mr", "mrs", "st",
})


def _abbreviation_before(line: str, index: int) -> bool:
    if line[index] != ".":
        return False
    found = _LAST_WORD_RE.search(line[:index])
    if not found:
        return False
    word = found.group(1)
    return (len(word) == 1 and word.isupper()) or word.lower() in _ABBREVIATIONS


def _sentence_spans(line: str, start: int) -> list[tuple[int, int]]:
    end = len(line.rstrip())
    if start >= end:
        return []
    protected = [(match.start(), match.end()) for match in _MATH_RE.finditer(line)]
    spans: list[tuple[int, int]] = []
    begin = start
    for match in _BOUNDARY_RE.finditer(line, start, end):
        cut = match.end(1)
        if any(left < cut < right for left, right in protected) or _abbreviation_before(line, match.start(1)):
            continue
        spans.append((begin, cut))
        begin = match.end()
    spans.append((begin, end))
    return [(left, right) for left, right in spans if right > left]


def split_units(content: str) -> list[Unit]:
    """The sentences of a Markdown конспект with their places: headings, tables, code and $$ formulas are not read,
    a list item's marker is not part of its sentence, a sentence under MIN_WORDS words outside formulas is not
    checked."""
    units: list[Unit] = []
    position = 0
    in_fence = False
    in_math = False
    for line in content.splitlines(keepends=True):
        line_start = position
        position += len(line)
        body = line.rstrip("\r\n")
        stripped = body.strip()
        if stripped.startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        if stripped.count("$$") % 2 == 1:
            in_math = not in_math
            continue
        if in_math or not stripped or _HEADING_RE.match(body) or stripped.startswith("|") or stripped.startswith("$$"):
            continue
        mark = _LIST_MARK_RE.match(body)
        offset = mark.end() if mark else len(body) - len(body.lstrip())
        for left, right in _sentence_spans(body, offset):
            text = body[left:right]
            # Words outside formulas: a sentence that is mostly a formula is not retold, so it is not checked.
            if len(_WORD_RE.findall(_MATH_RE.sub(" ", text))) < MIN_WORDS:
                continue
            units.append(Unit(key=str(len(units) + 1), text=text, start=line_start + left, end=line_start + right))
    return units


def term_units(terms: Any) -> list[Unit]:
    units: list[Unit] = []
    if not isinstance(terms, list):
        return units
    for index, item in enumerate(terms):
        if not isinstance(item, dict):
            continue
        definition = item.get("definition")
        if isinstance(definition, str) and len(_WORD_RE.findall(definition)) >= MIN_WORDS:
            units.append(Unit(key=f"T{len(units) + 1}", text=definition.strip(), term=index))
    return units


# --- the checker ------------------------------------------------------------------------------

_RECORDING_NOTE = (
    "\nТекст лекции получен распознаванием речи: имена и термины в нём бывают искажены, и их правильное написание в "
    "конспекте — не ошибка."
)

CHECK_PROMPT = """Ты — внимательный проверяющий. Тебе дают пронумерованные предложения конспекта лекции и саму лекцию.
Найди предложения конспекта, которые говорят не то, что лекция, или больше, чем она:
1. Другой участник, объект или направление действия: кто, кому и что сделал, что на что влияет, что из чего следует.
2. Утверждение сильнее, чем в лекции: «грозил», «мог», «некоторые», «обычно», «одни … другие» стали «неизбежно», «всегда», «все», «любой».
3. Причина, следствие, время или порядок событий, которых в лекции нет: «X привело к Y», «после X сразу Y», «X завершилось Y», когда лекция только называет X и Y рядом.
4. Свойство или факт одного предмета приписан другому, или два утверждения лекции слиты в одно более общее.
5. Число, дата, имя или термин не такие, как в лекции.
Не ошибка: сокращение, пересказ своими словами, пропуск подробностей, другой порядок пунктов, вывод, который делает сама лекция.{recording}

Для каждого такого предложения дай исправление — то же предложение с наименьшей правкой, после которой оно говорит то же, что лекция. Остальные слова, разметку (**…**) и язык предложения сохрани, новых фактов не добавляй. Номер — как в списке: «7» или «T2». Если таких предложений нет, верни пустой список.

Ответ — только JSON без markdown-обёртки:
{{"fixes": [{{"n": "7", "why": "что не так, коротко", "fixed": "исправленное предложение"}}]}}"""


def build_check_prompt(recording: bool = False) -> str:
    return CHECK_PROMPT.format(recording=_RECORDING_NOTE if recording else "")


def build_check_text(units: list[Unit], lecture: str, terms: Any = None) -> str:
    """The конспект first (a long answer is cut at its end, BaseAgent.run), then the lecture."""
    lines = []
    for unit in units:
        if unit.term >= 0 and isinstance(terms, list):
            lines.append(f"[{unit.key}] {terms[unit.term].get('term', '')} — {unit.text}")
        else:
            lines.append(f"[{unit.key}] {unit.text}")
    return "КОНСПЕКТ:\n" + "\n".join(lines) + "\n\nЛЕКЦИЯ:\n" + lecture


def parse_fixes(raw: Any) -> Optional[list[dict]]:
    """[{n, why, fixed}] from the checker's answer; None when it has no list of fixes."""
    try:
        parsed = parse_model_json(raw)
    except ValueError:
        return None
    items = parsed.get("fixes") if isinstance(parsed, dict) else parsed
    if not isinstance(items, list):
        return None
    fixes = []
    for item in items:
        if not isinstance(item, dict):
            continue
        key = str(item.get("n", "")).strip().strip("[]«»\"").upper()
        fixed = item.get("fixed")
        if key and isinstance(fixed, str):
            fixes.append({"n": key, "why": str(item.get("why") or "").strip()[:200], "fixed": fixed})
    return fixes


# --- applying ---------------------------------------------------------------------------------

_ECHOED_NUMBER_RE = re.compile(r"^\[?T?\d{1,3}\]\s*", re.IGNORECASE)
_NUMBER_RE = re.compile(r"\d+(?:[.,]\d+)?")
# Fragment links of the конспект ([S01], [S02, S03]): the page turns them into links to the lecture.
_CITATION_RE = re.compile(r"\s*\[S\d+(?:,\s*S\d+)*\]")
_END_MARKS = ".!?…"


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().lower()


def clean_fixed(fixed: str, original: str, term_name: str = "") -> str:
    """The checker's sentence without what it may have echoed: the number, a list marker, the term's name."""
    text = re.sub(r"\s+", " ", fixed).strip()
    text = _ECHOED_NUMBER_RE.sub("", text)
    text = _LIST_MARK_RE.sub("", text, count=1)
    if term_name:
        for separator in (" — ", " - ", ": ", " – "):
            if text.lower().startswith(term_name.lower() + separator):
                text = text[len(term_name) + len(separator):].strip()
                if text and original[:1].isupper():
                    text = text[0].upper() + text[1:]
                break
    tail = original.rstrip()[-1:]
    if text and tail in _END_MARKS and text[-1] not in _END_MARKS + "»\")":
        text += tail
    citations = "".join(_CITATION_RE.findall(original))
    if citations and not _CITATION_RE.search(text):
        # The sentence keeps its links to the lecture: before its end mark, where the конспект has them.
        body = text.rstrip(_END_MARKS)
        text = body + citations + text[len(body):]
    return text


def refusal(original: str, fixed: str, lecture: str) -> Optional[str]:
    """Why a fix is not applied, or None."""
    if not fixed or _norm(fixed) == _norm(original):
        return "same"
    if len(fixed) > len(original) * 1.6 + 60:
        return "longer"
    if difflib.SequenceMatcher(None, _norm(original), _norm(fixed)).ratio() < MIN_LIKENESS:
        return "rewritten"
    known = set(_NUMBER_RE.findall(lecture)) | set(_NUMBER_RE.findall(original))
    if any(number not in known for number in _NUMBER_RE.findall(_CITATION_RE.sub("", fixed))):
        return "new_number"
    return None


def apply_fixes(payload: dict, units: list[Unit], fixes: list[dict], lecture: str) -> tuple[dict, list[dict], list[dict]]:
    """(payload with the accepted fixes, accepted [{n, why, was, now}], refused [{n, reason}])."""
    by_key = {unit.key: unit for unit in units}
    terms = payload.get("terms") if isinstance(payload.get("terms"), list) else []
    accepted: list[tuple[Unit, str, str]] = []
    refused: list[dict] = []
    seen: set[str] = set()
    for fix in fixes:
        unit = by_key.get(fix["n"])
        if unit is None or fix["n"] in seen:
            refused.append({"n": fix["n"], "reason": "unknown" if unit is None else "repeated"})
            continue
        seen.add(fix["n"])
        term_name = terms[unit.term].get("term", "") if unit.term >= 0 else ""
        fixed = clean_fixed(fix["fixed"], unit.text, term_name if isinstance(term_name, str) else "")
        reason = refusal(unit.text, fixed, lecture)
        if reason:
            refused.append({"n": fix["n"], "reason": reason})
            continue
        accepted.append((unit, fixed, fix["why"]))

    content = payload.get("content", "")
    new_terms = [dict(item) if isinstance(item, dict) else item for item in terms]
    for unit, fixed, _ in sorted(accepted, key=lambda entry: entry[0].start, reverse=True):
        if unit.term >= 0:
            new_terms[unit.term]["definition"] = fixed
        else:
            content = content[:unit.start] + fixed + content[unit.end:]
    result = {**payload, "content": content}
    if "terms" in payload:
        result["terms"] = new_terms
    report = [{"n": unit.key, "why": why, "was": unit.text, "now": fixed} for unit, fixed, why in accepted]
    return result, report, refused


async def verify_summary(
    agent: Any,
    payload: dict,
    lecture: str,
    *,
    recording: bool = False,
    scripts: frozenset = mixed_script.NO_SCRIPTS,
    budget: Optional[float] = None,
) -> tuple[dict, dict]:
    """(the конспект after the check, the report). The payload is the summarizer's checked one (content, terms);
    ``agent`` is the coordinator's BaseAgent; ``budget`` — seconds left for the check (the section's deadline)."""
    started = time.monotonic()
    units = split_units(payload.get("content") or "") + term_units(payload.get("terms"))
    report: dict[str, Any] = {"status": "skipped", "sentences": len(units), "fixed": [], "refused": []}

    def done(status: str, **extra: Any) -> dict:
        report.update(status=status, ms=int((time.monotonic() - started) * 1000), **extra)
        return report

    if not enabled() or not units or len(lecture) > MAX_LECTURE_CHARS:
        return payload, done("skipped")
    seconds = timeout_seconds() if budget is None else min(timeout_seconds(), budget)
    if seconds < MIN_BUDGET_SECONDS:
        return payload, done("no_time")
    meta: dict[str, Any] = {}
    try:
        raw = await asyncio.wait_for(
            agent.run(build_check_prompt(recording), build_check_text(units, lecture, payload.get("terms")),
                      json_mode=True, temperature=0.0, max_tokens=MAX_TOKENS, timeout=seconds, meta=meta),
            timeout=seconds + 1.0,
        )
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # busy, failed, timeout: the конспект stays as it was
        return payload, done("failed", error=type(exc).__name__)
    if meta.get("model"):
        report["model"] = meta.get("model")
    if meta.get("cached"):
        report["cached"] = True
    fixes = parse_fixes(raw)
    if fixes is None:
        return payload, done("unreadable")
    limit = max(MIN_LIMIT, math.ceil(len(units) * MAX_SHARE))
    known = [fix for fix in fixes if any(unit.key == fix["n"] for unit in units)]
    if len(known) > limit:
        return payload, done("too_many", asked=len(known))
    checked, accepted, refused = apply_fixes(payload, units, fixes, lecture)
    report["refused"] = refused
    if not accepted:
        return payload, done("ok")
    # The fixed sentences go through the same check as the model's own text (coordinator.py): look-alikes replaced,
    # remarks about the source gone. A fix with a broken word is the checker's slip: then none is kept.
    checked, broken = mixed_script.check(checked, scripts)
    if broken:
        return payload, done("broken")
    report["fixed"] = accepted
    return checked, done("ok")
