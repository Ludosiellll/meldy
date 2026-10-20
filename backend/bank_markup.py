"""Документ банка пронумерованными строками: для экрана проверки, уверенности разбора и разбора с ИИ (без модели).

Строка — абзац (номер автонумерации Word — как в Word), абзац ячейки таблицы (с координатами «T2 R5 C3») или абзац
таблицы-раскладки (по порядку чтения, как его читает разбор). У строки — куски с оформлением: по ним сервер сам
проверяет ключ, который называет модель (bank_ai), и клиент показывает фрагмент файла рядом с вопросом.

Уверенность разбора по правилам — по каждому вопросу (0…1) из того, что разбор уже знает (флаги, число вариантов, следы
склейки), и предложение разобрать сложные места с ИИ (ai_offer) — признаки файла и цена в единицах. Проверено на корпусе
fixtures/banks/wild (bank_eval.py): низкая уверенность ловит около половины вопросов с ошибкой при 4 ложных тревогах на
тысячу верных; признаки файла — 16 из 19 файлов с ошибками при 3 ложных из 130.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Optional

from bank_docx import Block, Cell, Para, Run, Table

__all__ = [
    "DOUBT_AT", "MLine", "ai_units", "confidence", "item_ranges", "markup",
    "offer", "regions", "render", "source_lines",
]

DOUBT_AT = 0.6  # уверенность ниже — вопрос сомнительный
MAX_SOURCE_LINES = 600  # строк фрагментов в ответе разбора
FRAGMENT_LINES = 14  # строк фрагмента у одного вопроса (вопрос, варианты, строка ответа)
LEAD_LINES = 3  # строк над первым сомнительным вопросом без соседа сверху, которые тоже уходят модели

STRUCTURE_FLAGS = frozenset({"few_options", "many_options", "empty_option", "same_options", "no_options", "too_long"})
KEY_FLAGS = frozenset({"no_key"})
KEY_DOUBT_FLAGS = frozenset({"several_marked", "key_conflict", "key_invalid", "key_letter_ambiguous", "partial_mark",
                             "ai_key_rejected"})  # ключ в файле есть, но прочитан не наверняка
_EMBEDDED_LABEL_RE = re.compile(r"(?:^|\s)(?:[а-иa-hА-ИA-H][).]|\d{1,3}[.)])\s+\S")
_EMBEDDED_QUESTION_RE = re.compile(r"\?\s+\S.{8,}")
# «Сож Адказ: б» — строка ответа на незнакомом языке приклеилась к варианту
_ANSWER_TAIL_RE = re.compile(r"\s[^\W\d_]{3,}(?:\s+[^\W\d_]+){0,2}\s*[:\-–—]\s*\(?(?:[а-иa-hА-ИA-H]|[1-6])\)?\.?\s*$")
_BOX_RE = re.compile(r"[☐☑☒□■]")
_INITIALS_RE = re.compile(r"(?<!\S)[А-ЯЁA-Z]\.\s?[А-ЯЁA-Z]\.\s?(?=[А-ЯЁA-Z])")  # «Г. С. Титов», «А.С. Пушкин» — не подписи
_LIST_LINE_RE = re.compile(r"^\s*(?:[•·▪◦●○■□➢➤►*+]|[-–—](?=\s)|\(?[а-иa-hА-ИA-H][).]\s)")


@dataclass
class MLine:
    """Строка документа: номер (с 1), место (блок, строка таблицы или -1, абзац), текст и куски с оформлением."""

    n: int
    block: int
    row: int
    sub: int
    text: str
    runs: list[Run] = field(default_factory=list)
    cell: Optional[str] = None  # «T2 R5 C3» — абзац ячейки таблицы
    checkbox: Optional[bool] = None
    images: list[str] = field(default_factory=list)  # id картинок (bank_docx), "" — картинка, которая не переносится
    outline: Optional[int] = None


def _para_line(n: int, block: int, row: int, sub: int, para: Para, cell: Optional[str] = None) -> MLine:
    runs = ([Run(text=para.label + " ")] if para.label else []) + list(para.runs)
    text = "".join(run.text for run in runs)
    return MLine(n=n, block=block, row=row, sub=sub, text=text, runs=runs, cell=cell, checkbox=para.checkbox,
                 images=list(para.images), outline=para.outline)


def markup(blocks: list[Block]) -> list[MLine]:
    """Строки документа в порядке чтения. Пустые абзацы не нумеруются; места строк совпадают с ref вопросов разбора."""
    from bank_parse import Reader, layout_flow  # тот же выбор «таблица-раскладка», что у разбора

    lines: list[MLine] = []
    tables = 0
    for b, block in enumerate(blocks):
        if isinstance(block, Table):
            tables += 1
            if Reader.layout_table(block):
                for k, para in enumerate(layout_flow(block)):
                    if para.text.strip() or para.images:
                        lines.append(_para_line(len(lines) + 1, b, -1, k, para))
                continue
            for r, row in enumerate(block.rows):
                for c, cell in enumerate(row):
                    if cell.continuation:
                        continue
                    for k, para in enumerate(cell.paras):
                        if para.text.strip() or para.images:
                            lines.append(_para_line(len(lines) + 1, b, r, c * 1000 + k, para, f"T{tables} R{r + 1} C{c + 1}"))
        elif block.text.strip() or block.images:
            lines.append(_para_line(len(lines) + 1, b, -1, 0, block))
    return lines


def item_ranges(refs: list[Optional[tuple[int, int, int]]], lines: list[MLine]) -> list[Optional[tuple[int, int]]]:
    """Строки каждого вопроса: (первая, последняя) — от его первой строки до строки перед следующим вопросом (не
    дальше FRAGMENT_LINES). Вопрос без места (GIFT, Moodle XML) — None."""
    first_of: dict[tuple[int, int, int], int] = {}
    for line in lines:
        key = (line.block, line.row, 0) if line.row >= 0 else (line.block, -1, line.sub)
        first_of.setdefault(key, line.n)
    starts = [first_of.get(ref) if ref is not None else None for ref in refs]
    known = sorted({start for start in starts if start is not None})
    out: list[Optional[tuple[int, int]]] = []
    for start in starts:
        if start is None:
            out.append(None)
            continue
        following = [other for other in known if other > start]
        end = (following[0] - 1) if following else len(lines)
        out.append((start, max(start, min(end, start + FRAGMENT_LINES - 1))))
    return out


# ── Оформление строкой: для модели ─────────────────────────────────────────────

_MARKS = (("bold", "b"), ("underline", "u"), ("italic", "i"), ("strike", "s"), ("highlight", "hl"), ("shade", "shade"),
          ("color", "color"), ("mono", "code"))


def run_marks(run: Run) -> list[str]:
    """Признаки оформления куска: «b», «u», «i», «s», «hl», «shade», «color», «code»."""
    out = []
    for attribute, mark in _MARKS:
        value = getattr(run, attribute)
        if value and value != "none":
            out.append(mark)
    return out


def render(line: MLine) -> str:
    """Строка для модели: «[12] а) ⟨b⟩азот⟨/b⟩», у ячейки — «[40] {T2 R5 C3} …», флажок — ☑/☐, картинка — ⟨img⟩."""
    parts = [f"[{line.n}] "]
    if line.cell:
        parts.append("{" + line.cell + "} ")
    if line.outline:
        parts.append("#" * min(line.outline, 6) + " ")
    if line.checkbox is not None and not line.text.lstrip().startswith(("☑", "☐", "☒")):
        parts.append("☑ " if line.checkbox else "☐ ")
    for run in line.runs:
        marks = run_marks(run) if run.text.strip() else []
        text = run.text.replace("\n", " / ")
        for mark in marks:
            text = f"⟨{mark}⟩{text}⟨/{mark}⟩"
        parts.append(text)
    parts.append(" ⟨img⟩" * len(line.images))
    return "".join(parts)


def source_lines(lines: list[MLine], wanted: set[int]) -> list[dict]:
    """Строки фрагментов для клиента: {n, runs: [{t, m}], cell} — m: признаки куска через пробел («b u»)."""
    out = []
    for line in lines:
        if line.n not in wanted:
            continue
        runs = []
        for run in line.runs:
            marks = " ".join(run_marks(run)) if run.text.strip() else ""
            if runs and runs[-1]["m"] == marks:
                runs[-1]["t"] += run.text
            else:
                runs.append({"t": run.text, "m": marks})
        out.append({"n": line.n, "runs": runs, "cell": line.cell, "checkbox": line.checkbox, "images": len(line.images)})
        if len(out) >= MAX_SOURCE_LINES:
            break
    return out


# ── Уверенность и предложение разобрать с ИИ ────────────────────────────────────


def confidence(items: list[dict]) -> list[tuple[float, list[str]]]:
    """(уверенность 0…1, причины) по каждому вопросу ответа разбора. Причины: structure (флаги устройства), key (флаги
    ключа), options_count, option_merged, stem_merged, unnumbered, open_among_choice, options_unlike, joined_lines."""
    total = max(1, len(items))
    numbered = sum(1 for item in items if item["label"]) / total
    choice = sum(1 for item in items if item["options"]) / total
    counts: dict[int, int] = {}
    for item in items:
        if item["options"]:
            counts[len(item["options"])] = counts.get(len(item["options"]), 0) + 1
    usual = max(counts, key=counts.get) if counts else 0
    out = []
    for item in items:
        score, why = 1.0, []
        flags = set(item["flags"])
        n = len(item["options"])
        if flags & STRUCTURE_FLAGS:
            score -= 0.5
            why.append("structure")
        if flags & KEY_DOUBT_FLAGS:
            score -= 0.45
            why.append("key")
        elif flags & KEY_FLAGS:
            score -= 0.3
            why.append("key")
        if item["kind"] in ("single", "multiple", "truefalse") and not 2 <= n <= 6 and "structure" not in why:
            score -= 0.3
            why.append("options_count")
        choice_kind = item["kind"] in ("single", "multiple", "truefalse")
        if choice_kind and any(_EMBEDDED_LABEL_RE.search(_INITIALS_RE.sub("", option)) or len(option) > 160
                               or _ANSWER_TAIL_RE.search(option) for option in item["options"]):
            score -= 0.4
            why.append("option_merged")  # у «соответствия» и «порядка» подписи в списках — часть задания
        stem_lines = item["text"].split("\n")
        listed = sum(1 for line in stem_lines[1:] if _LIST_LINE_RE.match(line))
        if listed >= 2 or len(_BOX_RE.findall(item["text"])) >= 2:
            score -= 0.45
            why.append("options_in_stem")  # варианты остались в тексте вопроса: списком или флажками в строке
        elif (_EMBEDDED_LABEL_RE.search(stem_lines[-1]) and not n) or _EMBEDDED_QUESTION_RE.search(item["text"]) \
                or (listed and n):
            score -= 0.3
            why.append("stem_merged")
        if not item["label"] and numbered > 0.5:
            score -= 0.2
            why.append("unnumbered")
        if item["kind"] == "open" and choice > 0.7:
            score -= 0.3
            why.append("open_among_choice")
        if choice_kind and n and usual and abs(n - usual) >= 2:
            score -= 0.2
            why.append("options_unlike")
        if "joined_lines" in flags:
            score -= 0.1
            why.append("joined_lines")
        out.append((round(max(0.0, score), 2), why))
    return out


def ai_units(questions: int) -> int:
    """Цена разбора с ИИ в единицах дневного лимита (plans.import_ai_cost: 5 за каждые начатые 100 вопросов)."""
    from plans import import_ai_cost

    return import_ai_cost(questions)


def regions(ranges: list[Optional[tuple[int, int]]], chosen: list[bool], line_count: int, *, tail: bool = False,
            head: bool = False) -> list[tuple[int, int]]:
    """Куски документа для модели: строки выбранных вопросов с соседом до и после; tail — ещё строки после последнего
    вопроса (ключ в конце файла), head — строки до первого (вопросы, которых правила не узнали). Пересекающиеся — вместе."""
    spans: list[tuple[int, int]] = []
    known = [r for r in ranges if r is not None]
    for index, (r, take) in enumerate(zip(ranges, chosen)):
        if not take or r is None:
            continue
        before = next((ranges[k] for k in range(index - 1, -1, -1) if ranges[k] is not None), None)
        after = next((ranges[k] for k in range(index + 1, len(ranges)) if ranges[k] is not None), None)
        # без соседа сверху — ещё LEAD_LINES строк: там бывает вопрос, который правила приняли за заголовок
        spans.append((before[0] if before else max(1, r[0] - LEAD_LINES), (after or r)[1]))
    if known and tail and known[-1][1] < line_count:
        spans.append((known[-1][1] + 1, line_count))
    if known and head and known[0][0] > 1:
        spans.append((1, known[0][0] - 1))
    if not known and (tail or head) and line_count:
        spans.append((1, line_count))
    spans.sort()
    merged: list[tuple[int, int]] = []
    for start, end in spans:
        if merged and start <= merged[-1][1] + 1:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def offer(items: list[dict], ranges: list[Optional[tuple[int, int]]], line_count: int, skipped: int, subjects: int,
          key_lists: int = 0) -> dict:
    """Стоит ли предложить «Разобрать сложные места» и сколько это стоит: {worth, reasons, questions, units, doubtful}.

    Причины: doubtful — сомнительных вопросов 10 % и больше (или 5 и больше); no_key — без ключа 30 % и больше, а в файле
    есть следы ключа, который разбор не применил: пропущенные строки, список ключей, сомнения в ключе или склейка строк;
    unread — пропущенных строк 10 и больше;
    restarts — нумерация с «1» три раза и больше при меньшем числе предметов. questions — вопросов в кусках модели."""
    total = len(items)
    doubtful = [item.get("confidence", 1.0) < DOUBT_AT for item in items]
    count = sum(doubtful)
    no_key = sum(1 for item in items if "no_key" in item["flags"])
    restarts = sum(1 for item in items if item["label"] == "1")
    reasons = []
    if count and (count >= 5 or count >= 0.1 * total):
        reasons.append("doubtful")
    key_traces = skipped >= 1 or key_lists >= 1 or any(
        set(item["flags"]) & KEY_DOUBT_FLAGS or {"option_merged", "joined_lines"} & set(item.get("doubts") or []) for item in items)
    if total and no_key >= 0.3 * total and key_traces:
        reasons.append("no_key")
    if skipped >= 10:
        reasons.append("unread")
    if restarts >= 3 and subjects < restarts:
        reasons.append("restarts")
    if not reasons or not any(r is not None for r in ranges):
        return {"worth": False, "reasons": reasons, "questions": 0, "units": 0, "doubtful": count}
    chosen = [d or "restarts" in reasons for d in doubtful]
    spans = regions(ranges, chosen, line_count, tail="no_key" in reasons, head="unread" in reasons)
    covered = sum(1 for r in ranges if r is not None and any(start <= r[0] <= end for start, end in spans))
    extra = sum(end - start + 1 for start, end in spans) - sum(
        min(r[1], end) - max(r[0], start) + 1 for r in ranges if r is not None for start, end in spans if r[0] <= end and r[1] >= start)
    questions = covered + max(0, extra) // 6  # строки вне вопросов правил: около 6 строк на вопрос
    return {"worth": True, "reasons": reasons, "questions": questions, "units": ai_units(questions), "doubtful": count}
