"""Разбор сложных мест банка вопросов с ИИ: POST /api/exams/parse-bank/ai.

Только по нажатию пользователя. Файл читается так же, как в parse-bank (bank_parse), документ нумеруется строками
(bank_markup.markup), и модели уходят только куски вокруг сомнительных вопросов (или все строки — scope=all): текст
строк с метками оформления, без файла и без картинок. Модель отвечает JSON со ссылками на строки; сервер сам собирает
текст вопроса и вариантов из этих строк — дословно, как в файле.

Ключ — только с доказательством из файла, и сервер проверяет его по своим данным, а не по словам модели: отметка
оформлением (не меньше MARK_SHARE видимых знаков варианта, не у всех вариантов), флажок, маркер («+», «*», «(верно)»),
строка ключа или «Ответ: …» с этим номером, ячейка столбца ключа. Доказательство не подтвердилось — ключа нет, у вопроса
флаг ai_key_rejected. Ответ модели без доказательства ключом не становится никогда.

Сверка с разбором по правилам: совпали вопрос, варианты и ключ — source «both»; разошлись — у сомнительного вопроса
правил берётся версия ИИ (source «ai»), у уверенного — версия правил (source «rules», флаг ai_disagrees); вторая версия
лежит в alt. Вопрос, который нашла только модель, — source «ai», флаг ai_only. Ключи с доказательством и у правил, и у
модели, но разные — ключа нет, key_conflict.

Модель — BaseAgent (Gemini flash-lite, затем Groq), temperature 0, JSON, место в общей очереди тяжёлых вызовов
(heavy_slot); кусок до CHUNK_CHARS знаков (у Groq — меньше), до PARALLEL кусков сразу. Ответ оборван или негоден — кусок
делится пополам и спрашивается ещё раз. Единицы (plans.import_ai_cost, вид importAI) списываются до вызова; ни один кусок
не получился — возвращаются. В журнал сервера — только счётчики.
"""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import os
import re
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Optional

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

import bank_markup
import bank_parse
from bank_docx import Para, Run
from bank_markup import MLine
from bank_parse import (
    ANSWER_RE, FORMAT_SIGNALS, MARK_SHARE, BankError, Item, Option, Reader, finish, make_option, question_number,
    take_stem_answer,
)

PROMPT_VERSION = "bank-ai-1"
CHUNK_CHARS = 12_000
CHUNK_CHARS_GROQ = 6_000
MAX_TOKENS = 4096
CHUNK_TIMEOUT_SECONDS = 45.0
TOTAL_TIMEOUT_SECONDS = 120.0
PARALLEL = 3
STAGGER_SECONDS = 0.8
MAX_CHUNKS = 60
QUESTION_KINDS = ("single", "multiple", "truefalse", "open", "match", "order")
EVIDENCE_TYPES = ("mark", "checkbox", "marker", "key_row", "answer_line", "key_column")
MARK_NAMES = {"b": "bold", "bold": "bold", "u": "underline", "underline": "underline", "i": "italic", "italic": "italic",
              "hl": "highlight", "highlight": "highlight", "shade": "shade", "color": "color"}

SYSTEM_PROMPT = """Ты разбираешь фрагмент файла с тестовыми вопросами. Строки пронумерованы: «[12] текст».
Оформление показано метками: ⟨b⟩жирный⟨/b⟩, ⟨u⟩подчёркнутый⟨/u⟩, ⟨i⟩курсив⟨/i⟩, ⟨s⟩зачёркнутый⟨/s⟩, ⟨hl⟩выделение⟨/hl⟩,
⟨shade⟩заливка⟨/shade⟩, ⟨color⟩цветной шрифт⟨/color⟩, ⟨code⟩моноширинный⟨/code⟩. ☑ и ☐ — флажки. {T2 R5 C3} — ячейка
таблицы (таблица 2, строка 5, столбец 3). # в начале — заголовок. ⟨img⟩ — картинка.

Найди все вопросы фрагмента: текст вопроса, варианты ответа по порядку, вид вопроса. Не решай вопросы и не исправляй текст.

Ключ указывай, только если в файле есть отметка верного ответа, и назови её:
- mark — верный вариант выделен оформлением, а остальные — нет (назови признак: b, u, i, hl, shade, color);
- checkbox — у верного варианта ☑;
- marker — у верного варианта знак «+», «*», «✓», «(верно)» и подобный;
- key_row — строка ключа вида «12 – в» или строка таблицы ответов (назови номер строки в "l");
- answer_line — строка «Ответ: …» у вопроса (номер строки в "l");
- key_column — ячейка столбца «Ответ» или «Ключ» в строке вопроса (номер строки в "l").
Если отметки нет — "key": null. Никогда не выбирай ответ сам.

Ответ — только JSON такого вида:
{"questions": [{"n": "номер вопроса в файле или null",
  "q": [номера строк текста вопроса],
  "o": [номера строк вариантов по порядку] или null,
  "io": [{"l": номер строки, "t": "точный текст варианта"}] или null — если несколько вариантов в одной строке,
  "kind": "single|multiple|truefalse|open|match|order",
  "key": [номера верных вариантов, с 0] или null,
  "ev": {"type": "mark|checkbox|marker|key_row|answer_line|key_column", "mark": "b", "l": номер строки} или null,
  "answer": "короткий ответ дословно из файла" или null}],
 "skip": [номера строк, которые не относятся к вопросам: заголовки, колонтитулы, подписи, инструкции]}
Одну строку не используй в двух вопросах. Вопросы — в порядке файла. Строку ключа в конце файла в вопрос не включай."""

AI_BUSY_DETAIL = "ИИ сейчас занят. Показан разбор по правилам, попробуйте через минуту."
AI_FAILED_DETAIL = "Не удалось разобрать сложные места. Показан разбор по правилам, попробуйте ещё раз."

router = APIRouter()
AI_PATH = "/api/exams/parse-bank/ai"

Ask = Callable[[str, str, dict], Awaitable[str]]


# ── Куски ───────────────────────────────────────────────────────────────────────


@dataclass
class Chunk:
    lines: list[MLine]
    text: str

    @property
    def numbers(self) -> set[int]:
        return {line.n for line in self.lines}


def make_chunks(lines: list[MLine], spans: list[tuple[int, int]], limit: int = CHUNK_CHARS) -> list[Chunk]:
    """Строки выбранных промежутков — куски до limit знаков; режутся на строке, с которой начинается вопрос по номеру,
    иначе где придётся. Строки по номерам с 1."""
    chunks: list[Chunk] = []
    for start, end in spans:
        current: list[MLine] = []
        size = 0
        for line in lines[start - 1:end]:
            rendered = bank_markup.render(line)
            starts_question = question_number(line.text.strip()) is not None
            if current and size + len(rendered) + 1 > limit and (starts_question or size > limit * 1.3):
                chunks.append(_chunk(current))
                current, size = [], 0
            current.append(line)
            size += len(rendered) + 1
        if current:
            chunks.append(_chunk(current))
    return chunks[:MAX_CHUNKS]


def _chunk(lines: list[MLine]) -> Chunk:
    return Chunk(lines=lines, text="\n".join(bank_markup.render(line) for line in lines))


def chunk_key(chunk_text: str) -> str:
    """Ключ записанного ответа (кассеты тестов): версия запроса и текст куска."""
    return hashlib.sha256(f"{PROMPT_VERSION}\n{chunk_text}".encode("utf-8")).hexdigest()


# ── Ответ модели: проверка ссылок ───────────────────────────────────────────────


@dataclass
class AIQuestion:
    stem: list[int]
    options: list[tuple[int, Optional[str]]]  # (строка, текст варианта внутри строки или None — вся строка)
    kind: str
    key: Optional[list[int]]
    ev: Optional[dict]
    answer: Optional[str]
    number: Optional[str]

    @property
    def lines(self) -> set[int]:
        return set(self.stem) | {line for line, _ in self.options}


def _norm(text: str) -> str:
    return " ".join(text.replace(" ", " ").split())


def _int_list(value: Any) -> Optional[list[int]]:
    if not isinstance(value, list) or not all(isinstance(v, int) and not isinstance(v, bool) for v in value):
        return None
    return value


def parse_answer(raw: str, chunk: Chunk) -> tuple[Optional[list[AIQuestion]], Counter_]:
    """Вопросы из ответа модели со ссылками только на строки куска; негодные вопросы отброшены (счётчики причин).
    None — ответ не JSON или без списка questions."""
    problems: Counter_ = Counter_()
    try:
        parsed = json.loads(_strip_fence(raw))
    except (ValueError, TypeError):
        return None, problems
    if not isinstance(parsed, dict) or not isinstance(parsed.get("questions"), list):
        return None, problems
    known = {line.n: line for line in chunk.lines}
    used: set[int] = set()
    out: list[AIQuestion] = []
    for entry in parsed["questions"]:
        if not isinstance(entry, dict):
            problems["not_object"] += 1
            continue
        stem = _int_list(entry.get("q"))
        if not stem or any(n not in known for n in stem):
            problems["bad_stem_lines"] += 1
            continue
        options: list[tuple[int, Optional[str]]] = []
        inline = entry.get("io")
        whole = _int_list(entry.get("o")) if entry.get("o") is not None else []
        if whole is None or any(n not in known for n in whole):
            problems["bad_option_lines"] += 1
            continue
        options += [(n, None) for n in whole]
        if isinstance(inline, list) and inline:
            bad = False
            for piece in inline:
                line_n = piece.get("l") if isinstance(piece, dict) else None
                text = piece.get("t") if isinstance(piece, dict) else None
                if not isinstance(line_n, int) or line_n not in known or not isinstance(text, str) or not _norm(text) \
                        or _norm(text) not in _norm(known[line_n].text):
                    bad = True
                    break
                options.append((line_n, text))
            if bad:
                problems["inline_not_in_line"] += 1
                continue
        lines = set(stem) | {n for n, text in options if text is None}
        if lines & used:
            problems["line_reused"] += 1
            continue
        used |= lines | {n for n, _ in options}
        kind = entry.get("kind") if entry.get("kind") in QUESTION_KINDS else ("single" if options else "open")
        key = _int_list(entry.get("key")) if entry.get("key") is not None else None
        if key is not None and (not key or any(not 0 <= k < len(options) for k in key)):
            problems["key_out_of_range"] += 1
            key = None
        ev = entry.get("ev") if isinstance(entry.get("ev"), dict) else None
        answer = entry.get("answer") if isinstance(entry.get("answer"), str) and entry.get("answer").strip() else None
        number = entry.get("n")
        out.append(AIQuestion(stem=sorted(stem), options=options, kind=kind, key=key, ev=ev, answer=answer,
                              number=str(number).strip() if isinstance(number, (str, int)) and str(number).strip() else None))
    out.sort(key=lambda question: question.stem[0])
    return out, problems


class Counter_(dict):
    def __missing__(self, key):
        return 0


def _strip_fence(raw: str) -> str:
    text = (raw or "").strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else ""
        if text.rstrip().endswith("```"):
            text = text.rstrip()[:-3]
    return text.strip()


# ── Вопрос из строк файла ───────────────────────────────────────────────────────


def _line_para(line: MLine) -> Para:
    return Para(runs=[replace_run(run) for run in line.runs], checkbox=line.checkbox, images=list(line.images))


def replace_run(run: Run) -> Run:
    return Run(**run.__dict__)


def _slice_runs(runs: list[Run], start: int, end: int) -> list[Run]:
    out: list[Run] = []
    at = 0
    for run in runs:
        piece_start, piece_end = max(start, at), min(end, at + len(run.text))
        if piece_start < piece_end:
            out.append(Run(**{**run.__dict__, "text": run.text[piece_start - at:piece_end - at]}))
        at += len(run.text)
    return out


def _inline_span(raw: str, text: str, after: int = 0) -> Optional[tuple[int, int]]:
    """Где в строке кусок с тем же текстом (пробелы не в счёт), начиная с after."""
    target = _norm(text)
    for start in range(after, len(raw)):
        if raw[start].isspace():
            continue
        end = start
        while end <= len(raw) and _norm(raw[start:end]) != target and len(_norm(raw[start:end])) < len(target):
            end += 1
        if _norm(raw[start:end]) == target:
            return start, end
    return None


def _inline_span_back(raw: str, text: str, before: int) -> Optional[tuple[int, int]]:
    """Последний кусок строки с тем же текстом, что кончается не дальше before: варианты ищутся с конца строки, и слово
    варианта в тексте вопроса («… верно ли, что …  ☐ Верно») не мешает."""
    target = _norm(text)
    for start in range(min(before, len(raw)) - 1, -1, -1):
        if raw[start].isspace() or (start and not raw[start - 1].isspace() and raw[start - 1].isalnum() and raw[start].isalnum()):
            continue
        end = start
        while end <= before and _norm(raw[start:end]) != target and len(_norm(raw[start:end])) < len(target):
            end += 1
        if end <= before and _norm(raw[start:end]) == target:
            return start, end
    return None


def _inline_option(line: MLine, text: str, after: int = 0, span: Optional[tuple[int, int]] = None) -> Option:
    """Вариант внутри строки: кусок строки с тем же текстом (пробелы не в счёт) и его оформлением."""
    span = span or _inline_span(line.text, text, after)
    if span is None:
        return Option(text=text.strip(), runs=[Run(text=text.strip())])
    start, end = span
    option = Option(text=line.text[start:end].strip(), runs=_slice_runs(line.runs, start, end))
    option.span = span  # type: ignore[attr-defined]
    return option


STEM_TAIL_MARK_RE = re.compile(r"\s*(?:☑|☒|■|☐|□|\[[ xXхХ✓✔]\]|[+*]|\(?[а-иa-hА-ИA-H]\s?[).])?\s*$")
INLINE_CHECKED_RE = re.compile(r"(?:☑|☒|■|\[[xXхХ✓✔]\])\s*$")
INLINE_UNCHECKED_RE = re.compile(r"(?:☐|□|\[ \])\s*$")
INLINE_PLUS_RE = re.compile(r"(?:^|\s)[+*]\s*$")


def line_options(lines: dict[int, MLine], cited: list[tuple[int, Optional[str]]]) -> list[Option]:
    """Варианты по ссылкам модели: строка целиком или кусок строки. У куска — флажок, если перед ним в строке «☒»/«☐»,
    и маркер «+»/«*» перед ним (raw) — как у варианта на своей строке."""
    spans: dict[int, Optional[tuple[int, int]]] = {}
    limit: dict[int, int] = {}
    for index in range(len(cited) - 1, -1, -1):  # куски строки — с конца: каждый перед следующим
        line_n, inline = cited[index]
        if inline:
            raw = lines[line_n].text
            span = _inline_span_back(raw, inline, limit.get(line_n, len(raw)))
            spans[index] = span
            if span:
                limit[line_n] = span[0]
    out: list[Option] = []
    previous_end: dict[int, int] = {}
    for index, (line_n, inline) in enumerate(cited):
        line = lines[line_n]
        if not inline:
            option = make_option(_line_para(line))
            option.raw = line.text  # type: ignore[attr-defined]
            out.append(option)
            continue
        span = spans.get(index)
        option = _inline_option(line, inline, span=span)
        option.raw = option.text  # type: ignore[attr-defined]
        if span:
            before = line.text[previous_end.get(line_n, 0):span[0]]
            if INLINE_CHECKED_RE.search(before):
                option.checkbox = True
            elif INLINE_UNCHECKED_RE.search(before):
                option.checkbox = False
            elif INLINE_PLUS_RE.search(before):
                option.raw = "+" + option.text  # type: ignore[attr-defined]
            previous_end[line_n] = span[1]
        out.append(option)
    return out



SYMBOL_MARK_RE = re.compile(r"^\s*(?:[+*#]|☑|☒|\[[xXхХ]\])|(?:\(\s*\+\s*\)|\((?:верно|правильно)\)|[-–—]\s*(?:верно|правильно)|✓|✔|√|\s\+)\s*$", re.I)


def build_item(question: AIQuestion, lines: dict[int, MLine], reader: Reader) -> tuple[Item, list[str]]:
    """Вопрос из строк файла (текст — дословно из строк) и проверенный ключ; список флагов проверки."""
    stem_lines = [lines[n] for n in question.stem]
    options = line_options(lines, question.options)
    cut: dict[int, int] = {}  # строка вопроса, в которой и варианты: текст вопроса — до первого варианта
    for (line_n, inline), option in zip(question.options, options):
        span = getattr(option, "span", None)
        if inline and span and line_n in question.stem:
            cut[line_n] = min(cut.get(line_n, span[0]), span[0])
    texts = [STEM_TAIL_MARK_RE.sub("", line.text[:cut[line.n]]) if line.n in cut else line.text for line in stem_lines]
    first = texts[0].strip()
    named = re.match(rf"^{re.escape(question.number)}\s*[.)]\s+(?=\S)", first) if question.number else None
    if named and not question_number(first):
        first = first[named.end():]  # «Б. Какая …»: номер вопроса буквой — тот, что назвала модель
    number = question_number(first)
    label = number[0] if number else (question.number or "")
    text_lines = [number[2] if number else first] + [text.rstrip() for text in texts[1:]]
    alone = bank_parse.QUESTION_NUMBER_RE.match(first)
    if alone and len(stem_lines) > 1:
        label, text_lines = alone.group(1), [text.rstrip() for text in texts[1:]]
    first_line = stem_lines[0]
    item = Item(label=label if label.replace(".", "").isdigit() else (question.number or ""), text="\n".join(text_lines).strip(),
                ref=(first_line.block, first_line.row, 0 if first_line.row >= 0 else first_line.sub), where=f"строка {first_line.n}")
    take_stem_answer(item)
    item.images = [image for line in stem_lines for image in line.images]
    item.options.extend(options)
    item.inline = any(inline for _, inline in question.options)
    if question.kind in ("open", "match", "order", "multiple", "truefalse"):
        item.kind = question.kind if (question.kind != "open" or not item.options) else "single"
    flags: list[str] = []
    _apply_key(item, question, lines, flags)
    return item, flags


def _apply_key(item: Item, question: AIQuestion, lines: dict[int, MLine], flags: list[str]) -> None:
    """Ключ модели — только с доказательством, проверенным по строкам файла; иначе ключа нет, флаг ai_key_rejected."""
    ev = question.ev or {}
    kind = ev.get("type")
    claimed = bool(question.key) or bool(question.answer)
    if not claimed:
        return
    cited = lines.get(ev.get("l")) if isinstance(ev.get("l"), int) else None
    accepted = False
    if kind == "mark" and question.key and item.options:
        signal = MARK_NAMES.get(str(ev.get("mark", "")).lower())
        if signal in FORMAT_SIGNALS:
            marked = [k for k, option in enumerate(item.options) if option.share(signal) >= MARK_SHARE]
            if marked and sorted(marked) == sorted(question.key) and len(marked) < len(item.options):
                item.correct, item.evidence, accepted = sorted(question.key), signal, True
    elif kind == "checkbox" and question.key and item.options:
        checked = [k for k, option in enumerate(item.options) if option.checkbox]
        if checked and sorted(checked) == sorted(question.key) and len(checked) < len(item.options):
            item.correct, item.evidence, accepted = sorted(question.key), "checkbox", True
    elif kind == "marker" and question.key and item.options:
        marked = [k for k, option in enumerate(item.options) if SYMBOL_MARK_RE.search(getattr(option, "raw", "") or option.text)]
        if marked and sorted(marked) == sorted(question.key) and len(marked) < len(item.options):
            for k in marked:  # маркер — не часть текста варианта
                option = item.options[k]
                stripped = re.sub(r"^\s*(?:[+*#]\s*|☑\s*|☒\s*|\[[xXхХ]\]\s*)|\s*(?:\(\s*\+\s*\)|\((?:верно|правильно)\)|[-–—]\s*(?:верно|правильно)|✓|✔|√|\+)\s*$",
                                  "", option.text, flags=re.I).strip()
                if stripped != option.text:
                    option.text, option.runs = stripped, bank_parse.trim_visible(option.runs, bank_parse._visible(stripped))
            item.correct, item.evidence, accepted = sorted(question.key), "marker", True
    elif kind in ("answer_line", "key_row", "key_column") and cited is not None:
        value = _cited_value(kind, cited.text, item.label or question.number)
        if value:
            # значение — из файла; как его понять (буква, номер, текст варианта, пары) — как у правил (finish)
            item.explicit, item.explicit_from = value, {"answer_line": "answer_line", "key_row": "key_list",
                                                        "key_column": "key_column"}[kind]
            accepted = True
    if not accepted:
        flags.append("ai_key_rejected")


def _cited_value(kind: str, text: str, number: Optional[str]) -> Optional[str]:
    """Ответ из названной строки файла: «Ответ: б» → «б»; строка ключа «… 12 – в …» → «в» для вопроса 12; ячейка — она сама."""
    text = text.strip()
    if kind == "answer_line":
        match = ANSWER_RE.match(text)
        return match.group(1).strip() if match else None
    if kind == "key_column":
        return text if 0 < len(text) <= 200 else None
    if not number:
        return None
    keys: dict[str, str] = {}
    Reader().key_line(text, keys)
    if number in keys:
        return keys[number]
    head = bank_parse.KEY_LIST_HEAD_RE.match(text)
    if head:
        Reader().key_line(text[head.end():], keys)
    return keys.get(number)


# ── Слияние с разбором по правилам ──────────────────────────────────────────────


def _brief(entry: dict) -> dict:
    return {"text": entry["text"], "options": entry["options"], "correct": entry["correct"], "kind": entry["kind"],
            "answer": entry.get("answer"), "evidence": entry.get("evidence")}


def _same(a: dict, b: dict) -> bool:
    return _norm(a["text"]) == _norm(b["text"]) and [_norm(o) for o in a["options"]] == [_norm(o) for o in b["options"]] \
        and sorted(a["correct"]) == sorted(b["correct"]) and (a.get("answer") or None) == (b.get("answer") or None)


@dataclass
class AIStats:
    chunks: int = 0
    failed_chunks: int = 0
    questions: int = 0
    units: int = 0
    found: int = 0
    rejected_keys: int = 0
    disagreements: int = 0
    replaced: int = 0
    added: int = 0
    problems: dict = field(default_factory=dict)
    model: Optional[str] = None
    ms: int = 0


def merge(reader: Reader, lines: list[MLine], spans: list[tuple[int, int]], ai_items: list[tuple[Item, set[int], list[str]]],
          key_mode: str, user_keys: Optional[dict[str, str]], format_mode: str, stats: AIStats) -> Reader:
    """Новый разбор: вопросы правил вне кусков — как были; в кусках — сверка с вопросами модели (см. описание модуля)."""
    rules_reader = copy.deepcopy(reader)
    rules_result = finish(copy.deepcopy(reader), key_mode=key_mode, user_keys=user_keys, format_mode=format_mode)
    kept = [item for item in rules_reader.items if item.text or item.options]
    rule_dicts = rules_result["items"]
    ranges = bank_markup.item_ranges([item.ref for item in kept], lines)
    inside = lambda n: any(start <= n <= end for start, end in spans)  # noqa: E731

    # версии модели после той же обработки, что у правил (ключ из файла, флаги)
    ai_reader = Reader()
    ai_reader.keys = reader.keys
    ai_reader.variant_keys = reader.variant_keys
    ai_reader.pictures = reader.pictures
    for item, _, _ in ai_items:
        twin = copy.deepcopy(item)
        twin.seq = len(ai_reader.items)
        ai_reader.items.append(twin)
    ai_dicts = finish(ai_reader, key_mode=key_mode, user_keys=user_keys, format_mode=format_mode)["items"] if ai_items else []

    by_first: dict[int, int] = {}
    for index, span in enumerate(ranges):
        if span:
            by_first.setdefault(span[0], index)
    paired_rule: dict[int, int] = {}
    for a_index, (item, used, _) in enumerate(ai_items):
        first = min(used)
        r_index = by_first.get(first)
        if r_index is None:  # вопрос правил, который начинается внутри вопроса модели, но не с его варианта
            options_of = set(getattr(item, "option_lines", ()))
            r_index = next((k for k, span in enumerate(ranges) if span and span[0] in used and span[0] not in options_of
                            and k not in paired_rule.values()), None)
        if r_index is not None and r_index not in paired_rule.values():
            paired_rule[a_index] = r_index

    ai_option_lines = [set(getattr(item, "option_lines", ())) for item, _, _ in ai_items]
    dropped: dict[int, list[int]] = {}
    chosen: list[tuple[Item, int]] = []  # (вопрос, место: первая строка или порядок)
    rule_places = [(item.seq, ranges[k][0] if ranges[k] else 10 ** 9 + k) for k, item in enumerate(kept)]
    rule_for_ai = {r: a for a, r in paired_rule.items()}

    def absorbs_doubtful(a_index: int) -> bool:
        used = ai_items[a_index][1]
        return any(span and span[0] in used and k not in rule_for_ai and k < len(rule_dicts)
                   and rule_dicts[k]["confidence"] < bank_markup.DOUBT_AT for k, span in enumerate(ranges))
    covered_by_ai = set().union(*(used for _, used, _ in ai_items)) if ai_items else set()
    option_owner = {n: a for a in range(len(ai_items)) for n in ai_option_lines[a]}
    ai_stem_lines = {n for _, used, _ in ai_items for n in used} - set(option_owner)
    for r_index, item in enumerate(kept):
        span = ranges[r_index]
        place = span[0] if span else 10 ** 9 + r_index
        doubtful = rule_dicts[r_index]["confidence"] < bank_markup.DOUBT_AT if r_index < len(rule_dicts) else False
        a_index = rule_for_ai.get(r_index)
        if a_index is not None and not doubtful and absorbs_doubtful(a_index):
            doubtful = True  # версия модели забирает строки соседних сомнительных вопросов правил (варианты в таблице)
        if a_index is None:
            own_lines = set(range(span[0], span[1] + 1)) if span else set()
            if span and inside(span[0]) and doubtful and own_lines & covered_by_ai and span[0] not in ai_stem_lines:
                stats.replaced += 1  # строки сомнительного вопроса правил модель разобрала иначе (склейка, разрез)
                continue
            owner = next((option_owner[n] for n in sorted(own_lines) if n in option_owner), None) \
                if span and inside(span[0]) and span[0] not in ai_stem_lines else None
            if owner is not None and not rule_dicts[r_index]["correct"]:
                # первая строка «вопроса» правил у модели — вариант другого вопроса (строки таблицы, разрез вопроса)
                stats.replaced += 1
                owner_item = ai_items[owner][0]
                owner_item.flag("ai_disagrees")
                dropped.setdefault(owner, []).append(r_index)
                continue
            chosen.append((item, place))
            continue
        ai_item, _, ai_flags = ai_items[a_index]
        rule_entry, ai_entry = rule_dicts[r_index], ai_dicts[a_index]
        if _same(rule_entry, ai_entry):
            item.source = "both"
            chosen.append((item, place))
            continue
        stats.disagreements += 1
        both_keys = rule_entry["correct"] and ai_entry["correct"] and sorted(rule_entry["correct"]) != sorted(ai_entry["correct"])
        if doubtful:
            pick, other, pick_entry, other_entry = ai_item, item, ai_entry, rule_entry
            pick.source = "ai"
            stats.replaced += 1
            _keep_rule_key(pick, ai_entry, rule_entry)
        else:
            pick, other, pick_entry, other_entry = item, ai_item, rule_entry, ai_entry
            pick.source = "rules"
            pick.flag("ai_disagrees")
        pick.alt = {**_brief(other_entry), "source": "ai" if pick is item else "rules"}
        for flag in ai_flags:
            pick.flag(flag)
        if both_keys:
            pick.flag("key_conflict")  # ключи с доказательством у обоих, но разные: в очередь проверки
        chosen.append((pick, place))
    for a_index, (item, used, ai_flags) in enumerate(ai_items):
        if a_index in paired_rule:
            continue
        item.source = "ai"
        item.flag("ai_only")
        if dropped.get(a_index) and item.alt is None:
            item.alt = {**_brief(rule_dicts[dropped[a_index][0]]), "source": "rules"}
        for flag in ai_flags:
            item.flag(flag)
        stats.added += 1
        chosen.append((item, min(used)))
    chosen.sort(key=lambda pair: pair[1])

    out = copy.deepcopy(reader)
    for heading in out.headings:  # заголовок — перед первым вопросом, что шёл после него (по месту в файле)
        place = next((p for seq, p in rule_places if seq >= heading.seq), 10 ** 12)
        heading.seq = next((k for k, (_, p) in enumerate(chosen) if p >= place), len(chosen))
    out.items = []
    for seq, (item, _) in enumerate(chosen):
        item.seq = seq
        out.items.append(item)
    out.table_starts = set()
    return out


def _keep_rule_key(pick: Item, ai_entry: dict, rule_entry: dict) -> None:
    """Версия модели без ключа заменяет сомнительный вопрос правил, у которого ключ из файла был: ключ остаётся, если
    варианты те же (номера вариантов значат то же), ответ открытого вопроса и соответствия — как был."""
    if ai_entry["correct"] or ai_entry.get("answer") or ai_entry.get("order"):
        return
    if rule_entry["correct"] and [_norm(o) for o in ai_entry["options"]] == [_norm(o) for o in rule_entry["options"]]:
        pick.correct, pick.evidence = list(rule_entry["correct"]), rule_entry["evidence"]
    elif rule_entry.get("answer") and pick.kind in ("open", "match"):
        pick.explicit, pick.explicit_from = rule_entry["answer"], rule_entry["evidence"] or "answer_line"


# ── Весь разбор ─────────────────────────────────────────────────────────────────


async def default_ask(system: str, text: str, meta: dict) -> str:
    """Модель: BaseAgent (Gemini, затем Groq), temperature 0, JSON, в общей очереди тяжёлых вызовов."""
    from agents.base import AIError, BaseAgent, heavy_slot

    agent = BaseAgent(api_key=os.getenv("GROQ_API_KEY", ""))
    async with heavy_slot():
        try:
            return await asyncio.wait_for(
                agent.run(system, text, temperature=0, max_tokens=MAX_TOKENS, json_mode=True, timeout=CHUNK_TIMEOUT_SECONDS,
                          thinking="low", meta=meta),
                timeout=CHUNK_TIMEOUT_SECONDS + 5,
            )
        except asyncio.TimeoutError:
            raise AIError.timeout() from None


def _cut_off(meta: dict) -> bool:
    return str(meta.get("finish_reason") or "").strip().upper() in ("MAX_TOKENS", "LENGTH")


async def _ask_chunk(ask: Ask, chunk: Chunk, stats: AIStats, depth: int = 0) -> list[tuple[AIQuestion, Chunk]]:
    """Вопросы куска; оборванный или негодный ответ — один повтор половинками куска. Ошибки модели — наверх."""
    meta: dict = {}
    raw = await ask(SYSTEM_PROMPT, chunk.text, meta)
    stats.model = stats.model or meta.get("model")
    questions, problems = parse_answer(raw, chunk) if not _cut_off(meta) else (None, Counter_())
    for name, count in problems.items():
        stats.problems[name] = stats.problems.get(name, 0) + count
    if questions is not None:
        return [(question, chunk) for question in questions]
    if depth or len(chunk.lines) < 2:
        stats.failed_chunks += 1
        return []
    half = len(chunk.lines) // 2
    out: list[tuple[AIQuestion, Chunk]] = []
    for part in (chunk.lines[:half], chunk.lines[half:]):
        out += await _ask_chunk(ask, _chunk(part), stats, depth + 1)
    return out


async def run_chunks(ask: Ask, chunks: list[Chunk], stats: AIStats) -> list[tuple[AIQuestion, Chunk]]:
    """Куски по PARALLEL сразу со сдвигом STAGGER_SECONDS; ошибка куска — кусок не получился (счётчик), не весь разбор.
    Все куски с ошибкой модели — её ошибка наверх (последняя)."""
    gate = asyncio.Semaphore(PARALLEL)
    last_error: list[BaseException] = []

    async def one(index: int, chunk: Chunk):
        await asyncio.sleep(STAGGER_SECONDS * min(index, PARALLEL - 1) if index < PARALLEL else 0)
        async with gate:
            try:
                return await _ask_chunk(ask, chunk, stats)
            except Exception as exc:  # noqa: BLE001 — сбой модели или сети: кусок не получился
                stats.failed_chunks += 1
                last_error.append(exc)
                return []

    results = await asyncio.wait_for(asyncio.gather(*(one(k, chunk) for k, chunk in enumerate(chunks))),
                                     timeout=TOTAL_TIMEOUT_SECONDS)
    if chunks and stats.failed_chunks >= len(chunks) and last_error:
        raise last_error[-1]
    return [pair for result in results for pair in result]


def plan(reader: Reader, lines: list[MLine], rules: dict, scope: str) -> tuple[list[tuple[int, int]], int]:
    """Что отправить модели и за сколько вопросов: (промежутки строк, вопросов в них)."""
    if scope == "all":
        return ([(1, len(lines))] if lines else []), max(len(rules["items"]), 1)
    offer = rules["ai_offer"]
    if not offer["worth"]:
        return [], 0
    kept = [item for item in reader.items if item.text or item.options]
    ranges = bank_markup.item_ranges([item.ref for item in kept], lines)
    doubtful = [entry["confidence"] < bank_markup.DOUBT_AT or "restarts" in offer["reasons"] for entry in rules["items"]]
    spans = bank_markup.regions(ranges, doubtful, len(lines), tail="no_key" in offer["reasons"], head="unread" in offer["reasons"])
    return spans, offer["questions"]


async def hybrid(blocks: list, *, ask: Ask, key_mode: str = "auto", user_keys: Optional[dict[str, str]] = None,
                 format_mode: str = "auto", line_word: str = "абзац", pictures: Optional[dict] = None, scope: str = "flagged",
                 charge: Optional[Callable[[int], Awaitable[Any]]] = None, key_file: Optional[list[dict]] = None,
                 key_section: Optional[int] = None) -> dict:
    """Разбор с ИИ блоков документа: результат как у parse-bank и «ai» — счётчики. charge(units) — списание до модели
    (возвращает квитанцию с keep()/refund()); None — без списания (тесты, оценка корпуса). key_file — разделы файла
    ключа (раздел варианта этого теста — как у parse-bank)."""
    started = time.monotonic()
    reader = bank_parse.read_bank(blocks, line_word=line_word, format_mode=format_mode, pictures=pictures)
    if key_file is not None:
        used, _ = bank_parse.pick_key_section(key_file, reader.variant, key_section)
        keys = dict(key_file[used]["keys"]) if used is not None else None
        if keys is not None and user_keys:
            keys.update(user_keys)
        user_keys = keys if keys is not None else user_keys
    rules = finish(copy.deepcopy(reader), key_mode=key_mode, user_keys=user_keys, format_mode=format_mode)
    lines = bank_markup.markup(blocks)
    spans, questions = plan(reader, lines, rules, scope)
    stats = AIStats()
    if not spans:
        rules["ai"] = stats.__dict__
        return rules
    chunks = make_chunks(lines, spans)
    stats.chunks, stats.questions, stats.units = len(chunks), questions, bank_markup.ai_units(questions)
    receipt = await charge(stats.units) if charge else None
    try:
        answers = await run_chunks(ask, chunks, stats)
    except BaseException:
        if receipt is not None:
            await receipt.refund()
        raise
    by_n = {line.n: line for line in lines}
    ai_items: list[tuple[Item, set[int], list[str]]] = []
    for question, _ in answers:
        item, flags = build_item(question, by_n, reader)
        item.option_lines = {n for n, _ in question.options}  # type: ignore[attr-defined]
        ai_items.append((item, question.lines, flags))
        stats.rejected_keys += "ai_key_rejected" in flags
    stats.found = len(ai_items)
    if receipt is not None:
        if stats.failed_chunks >= len(chunks):
            await receipt.refund()
        else:
            receipt.keep()
    merged = merge(reader, lines, spans, ai_items, key_mode, user_keys, format_mode, stats)
    result = finish(merged, key_mode=key_mode, user_keys=user_keys, format_mode=format_mode)
    stats.ms = int((time.monotonic() - started) * 1000)
    result["ai"] = {k: v for k, v in stats.__dict__.items()}
    print(f"Bank AI: chunks {stats.chunks}, failed {stats.failed_chunks}, found {stats.found}, rejected keys "
          f"{stats.rejected_keys}, disagreements {stats.disagreements}, added {stats.added}, units {stats.units}")
    return result


# ── Маршрут ─────────────────────────────────────────────────────────────────────


def _rate_limit():
    from ratelimit import limiter, user_or_ip_key

    return limiter.limit("5/minute;30/day", key_func=user_or_ip_key)


@router.post(AI_PATH)
@_rate_limit()
async def parse_bank_ai(request: Request):
    """Файл или текст банка → разбор сложных мест с ИИ (по нажатию; единицы — plans.import_ai_cost)."""
    import bank_api
    import quota
    from agents.base import AIError

    try:
        user = getattr(request.state, "user", None)
        if not (isinstance(user, dict) and user.get("id")):
            raise BankError(401, "auth", bank_api.AUTH_DETAIL)
        form = await bank_api._read_form(request)
        scope = (bank_api._optional_text(form.get("scope")) or "flagged").strip()
        if scope not in ("flagged", "all"):
            raise BankError(400, "bad_form", bank_api.BAD_FORM_DETAIL)
        prepared = await bank_api.prepare(request, form)
        blocks, line_word, pictures = await asyncio.to_thread(_blocks_of, prepared)

        async def charge(units: int):
            return await quota.charge(request, "importAI", units)

        result = await hybrid(blocks, ask=default_ask, key_mode=prepared["key_mode"], user_keys=prepared["user_keys"],
                              format_mode=prepared["format_mode"], line_word=line_word, pictures=pictures, scope=scope,
                              charge=charge, key_file=prepared["key_file"], key_section=prepared["key_section"])
        return bank_parse._checked(result, prepared["format_mode"])
    except BankError as exc:
        return JSONResponse(status_code=exc.status, content={"detail": exc.detail, "code": exc.code})
    except AIError as exc:
        if getattr(exc, "code", "") == "ai_limit":
            raise
        busy = exc.status_code == 429
        return JSONResponse(status_code=exc.status_code, content={"detail": AI_BUSY_DETAIL if busy else AI_FAILED_DETAIL,
                                                                  "code": "ai_busy" if busy else "ai_failed"})


def _blocks_of(prepared: dict) -> tuple[list, str, Optional[dict]]:
    """Блоки файла или текста — так же, как их читает parse-bank (Moodle XML и GIFT модели не нужны: разметка точная)."""
    if prepared.get("contents") is not None:
        pictures: Optional[dict] = {} if prepared.get("with_pictures") else None
        kind, value = bank_parse._file_input(prepared["contents"], prepared["name"], pictures)
        if kind == "moodle":
            raise BankError(422, "no_doubts", NO_DOUBTS_DETAIL)
        if kind == "text":
            return _text_blocks(value, prepared["name"]), "строка", None
        return value, ("строка" if kind == "pdf" else "абзац"), pictures
    return _text_blocks(prepared["text"], ""), "строка", None


NO_DOUBTS_DETAIL = "В этом файле нечего разбирать с ИИ: его разметка уже точная."


def _text_blocks(text: str, name: str) -> list:
    text = bank_parse.clean_text(text or "")
    if bank_parse.looks_like_gift(text):
        raise BankError(422, "no_doubts", NO_DOUBTS_DETAIL)
    text = bank_parse.forms_text(text)
    table = bank_parse.tsv_table(text)
    return [table] if table is not None else list(bank_parse.text_blocks(text, markdown=name.lower().endswith(".md")))
