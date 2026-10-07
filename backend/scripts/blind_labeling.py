"""Слепая разметка вердиктов Meldy: листы для двух разметчиков и сверка с ключом.

Инструмент владельца. Работает на своём компьютере: в базу и в сеть не ходит, нужна только
стандартная библиотека Python 3.12. Метод (план 2026-10-07, «Слепая разметка точности»):
25–50 ответов (около 150 вердиктов) размечают преподаватель и второй независимый человек;
разметчик видит текст ответа, пункт и цитату лекции, но не решение Meldy; ложные «назван»
считаются отдельно; при малой выборке — интервалы, а не только проценты.

Входы — CSV из docs/oral-answer-texts-export.sql (SQL Editor Supabase → Download CSV): первый
запрос — для листов, второй — ключ с решениями Meldy (только у владельца). Как пользоваться —
docs/blind-labeling.md.

1. Листы:

    python backend/scripts/blind_labeling.py make выгрузка.csv --out папка [--answers 40] [--seed 123]

   razmetka_A.html и razmetka_A.csv — первому разметчику, razmetka_B.* — второму: те же ответы в
   другом порядке (seed записан). razmetka_kit.json — запись набора для владельца: seed, порядок,
   файл выгрузки. HTML работает без сети, печатается и сохраняет отметки кнопкой «Скачать CSV»
   (otmetki_A_<набор>.csv). В листах нет решений Meldy, кода студента и дня ответа; файл с
   колонками meldy_* (ключ) make не принимает. --answers — случайные N ответов из выгрузки.

2. Сверка:

    python backend/scripts/blind_labeling.py score otmetki_A.csv otmetki_B.csv ключ.csv [--out отчёт.md]

   Отчёт в Markdown: согласие людей (доля и каппа Коэна, 4 варианта и «назван / не назван»),
   Meldy против каждого человека и против их общего ответа (доли с 95 % интервалом Уилсона), матрица
   ошибок, ложные «назван» и «не назван», разбивка по главным пунктам и по вводу (голос, текст,
   голос и текст), списки расхождений для разбора. Сравнивается основной вердикт пункта
   (meldy_verdict): по нему шпаргалка стирает строку. Вердикт переспроса только считается: ответа
   на переспрос в листах нет. «Не могу решить», пустые отметки, повторы, лишние и недостающие
   строки попадают в предупреждения отчёта: ничего не отбрасывается молча.

Код выхода: 0 — готово, 2 — ошибка во входных файлах (текст — в stderr).
"""

from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import html
import io
import json
import math
import random
import re
import secrets
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from statistics import NormalDist

CLASSES = ("covered", "partial", "missing", "wrong")
UNSURE = "unsure"
UNRATED = "unrated"
CHOICES = CLASSES + (UNSURE,)
WORD = {
    "covered": "назван",
    "partial": "частично",
    "missing": "не назван",
    "wrong": "ошибка",
    UNSURE: "не могу решить",
    UNRATED: "не оценён",
}
NAMED, NOT_NAMED = "named", "not_named"
INPUT_WORD = {"speech": "голос", "text": "текст", "mixed": "голос и текст"}
INPUT_TAG = {"speech": "голосом", "text": "текстом", "mixed": "голосом и текстом"}
LETTERS = ("A", "B")
Z95 = NormalDist().inv_cdf(0.975)
MIN_POINTS = 3  # в эталоне 3–6 пунктов (oral.MIN_POINTS); меньше — выгрузка, скорее всего, обрезана
PLAN_ANSWERS = (25, 50)

EXPORT_COLUMNS = (
    "student", "answer", "day", "input", "question", "answer_text", "point_id", "essential", "point_title", "lecture_quote",
)
EXPORT_REQUIRED = ("answer", "answer_text", "point_id", "point_title")
KEY_REQUIRED = ("answer", "point_id", "meldy_verdict")
SHEET_COLUMNS = (
    "лист", "набор", "№", "ответ №", "код", "пункт", "главный", "ввод", "вопрос", "текст ответа",
    "название пункта", "цитата из лекции", "отметка", "комментарий",
)
# Колонки файла, который скачивает HTML-лист (тот же порядок в _SCRIPT).
MARKS_COLUMNS = ("лист", "набор", "№", "ответ №", "код", "пункт", "главный", "ввод", "название пункта", "отметка", "комментарий")
_MARK_ALIASES = {
    "code": ("код", "code"),
    "answer": ("answer", "код ответа"),
    "point": ("пункт", "point_id"),
    "label": ("отметка", "оценка", "label"),
    "comment": ("комментарий", "comment"),
    "sheet": ("лист", "sheet"),
    "kit": ("набор", "kit"),
    "essential": ("главный", "essential"),
    "input": ("ввод", "input"),
    "title": ("название пункта", "point_title"),
}
_LABELS = {
    "назван": "covered", "названо": "covered", "covered": "covered",
    "частично": "partial", "partial": "partial",
    "не назван": "missing", "не названо": "missing", "missing": "missing",
    "ошибка": "wrong", "wrong": "wrong",
    "не могу решить": UNSURE, "unsure": UNSURE, "?": UNSURE,
}
_VERDICTS = {"covered": "covered", "partial": "partial", "missing": "missing", "wrong": "wrong", "unrated": UNRATED}
_INPUTS = {
    "speech": "speech", "голос": "speech", "голосом": "speech",
    "text": "text", "текст": "text", "текстом": "text",
    "mixed": "mixed", "голос и текст": "mixed", "голосом и текстом": "mixed",
}
_TRUE = {"true", "t", "1", "да", "yes"}
_FALSE = {"false", "f", "0", "нет", "no"}
_ID_RE = re.compile(r"^[\w.:-]+$")
# Ячейка, которая начинается с этих знаков, в Excel становится формулой: перед ней пишется «'».
_FORMULA_START = ("=", "+", "-", "@", "\t", "\r")


class InputError(ValueError):
    """Файл нельзя использовать: текст — для владельца."""


# ── Чтение CSV ──────────────────────────────────────────────────────────────────


@dataclass
class Table:
    name: str
    columns: list[str]  # имена колонок: строчные, «ё» → «е», пробелы схлопнуты
    rows: list[tuple[int, dict[str, str]]]  # (номер строки как в таблице: заголовок — 1, значения)
    notes: list[str] = field(default_factory=list)
    digest: str = ""


def _norm(value: object) -> str:
    text = str(value or "").replace("\ufeff", "").replace("ё", "е").replace("Ё", "Е")
    return " ".join(text.split()).lower()


def _clean(value: object) -> str:
    """Текст одной строкой: пробелы и переводы строк схлопнуты."""
    return " ".join(str(value or "").split())


def _text(value: object) -> str:
    """Текст ответа: переводы строк сохраняются, края обрезаны."""
    return str(value or "").replace("\r\n", "\n").replace("\r", "\n").strip()


def _cell(value: object) -> str:
    text = "" if value is None else str(value)
    return "'" + text if text.startswith(_FORMULA_START) else text


def _uncell(value: str) -> str:
    text = value or ""
    return text[1:] if len(text) > 1 and text[0] == "'" and text[1] in "=+-@\t\r" else text


def parse_table(text: str, name: str, notes: list[str] | None = None, digest: str = "") -> Table:
    """CSV из строки: разделитель «;», «,» или табуляция — по строке заголовка."""
    notes = list(notes or [])
    text = text.lstrip("\ufeff")
    header_line = next((line for line in text.splitlines() if line.strip()), "")
    if not header_line:
        raise InputError(f"{name}: файл пустой")
    counts = {delimiter: header_line.count(delimiter) for delimiter in (";", ",", "\t")}
    delimiter = max(counts, key=lambda d: counts[d])
    if counts[delimiter] == 0:
        raise InputError(f"{name}: не похоже на CSV — в первой строке нет разделителей")
    try:
        records = list(csv.reader(io.StringIO(text, newline=""), delimiter=delimiter))
    except csv.Error as exc:
        raise InputError(f"{name}: CSV не читается ({exc})") from None
    while records and not any(cell.strip() for cell in records[0]):
        records.pop(0)
    if not records:
        raise InputError(f"{name}: в файле нет строки заголовка")
    columns = [_norm(cell) for cell in records[0]]
    repeated = sorted({column for column in columns if column and columns.count(column) > 1})
    if repeated:
        notes.append(f"{name}: колонки повторяются ({', '.join(repeated)}) — прочитана первая.")
    rows: list[tuple[int, dict[str, str]]] = []
    for number, record in enumerate(records[1:], start=2):
        if not any(cell.strip() for cell in record):
            continue
        if len(record) > len(columns) and any(cell.strip() for cell in record[len(columns):]):
            notes.append(f"{name}, строка {number}: ячеек больше, чем колонок, — лишние не прочитаны.")
        values: dict[str, str] = {}
        for index, column in enumerate(columns):
            if column and column not in values:
                values[column] = record[index] if index < len(record) else ""
        rows.append((number, values))
    return Table(name, columns, rows, notes, digest)


def read_table(path: Path) -> Table:
    try:
        raw = Path(path).read_bytes()
    except OSError as exc:
        raise InputError(f"{Path(path).name}: не удалось прочитать файл ({type(exc).__name__})") from None
    notes: list[str] = []
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            text = raw.decode("cp1251")
        except UnicodeDecodeError:
            raise InputError(f"{Path(path).name}: непонятная кодировка — сохраните файл как CSV UTF-8") from None
        notes.append(f"{Path(path).name}: файл не в UTF-8, прочитан как Windows-1251 (так сохраняет Excel).")
    return parse_table(text, Path(path).name, notes, hashlib.sha256(raw).hexdigest())


def _bool(value: object) -> bool | None:
    word = _norm(value)
    if word in _TRUE:
        return True
    if word in _FALSE:
        return False
    return None


def _yes(value: bool | None) -> str:
    return {True: "да", False: "нет"}.get(value, "")


def _natural(value: str) -> tuple:
    return tuple(int(part) if part.isdigit() else part for part in re.split(r"(\d+)", value))


def _code(answer: object, point: object) -> str | None:
    answer_id, point_id = _norm(_uncell(str(answer or ""))), _norm(_uncell(str(point or "")))
    if not answer_id or not point_id or not _ID_RE.match(answer_id) or not _ID_RE.match(point_id):
        return None
    return f"{answer_id}/{point_id}"


def _code_key(code: str) -> tuple:
    answer, _, point = code.partition("/")
    return (answer, _natural(point))


def _codes(codes) -> str:
    return ", ".join(sorted(codes, key=_code_key))


def _lines(numbers) -> str:
    return ", ".join(str(number) for number in numbers)


# ── Выгрузка (первый запрос) ────────────────────────────────────────────────────


@dataclass(frozen=True)
class Point:
    point_id: str
    title: str
    essential: bool | None
    quote: str


@dataclass
class Answer:
    answer: str
    student: str
    input: str
    question: str
    text: str
    points: list[Point] = field(default_factory=list)


@dataclass
class Export:
    name: str
    digest: str
    rows: int
    answers: list[Answer]
    warnings: list[str]

    @property
    def points(self) -> int:
        return sum(len(answer.points) for answer in self.answers)


def load_export(table: Table) -> Export:
    """Первый запрос выгрузки → ответы с пунктами. Колонки meldy_* (ключ) — ошибка: листы слепые."""
    leaked = [column for column in table.columns if column.startswith("meldy_") or column == "followup_answer"]
    if leaked:
        raise InputError(
            f"{table.name}: в файле есть решения Meldy ({', '.join(leaked)}). Это ключ (второй запрос), "
            "разметчикам его давать нельзя. Для листов нужен первый запрос выгрузки."
        )
    missing = [column for column in EXPORT_REQUIRED if column not in table.columns]
    if missing:
        raise InputError(
            f"{table.name}: нет колонок {', '.join(missing)}. Нужен первый запрос из docs/oral-answer-texts-export.sql."
        )
    warnings = list(table.notes)
    absent = [column for column in EXPORT_COLUMNS if column not in table.columns and column not in EXPORT_REQUIRED]
    if absent:
        warnings.append(f"Нет колонок {', '.join(absent)} — в листах эти поля будут пустыми.")
    extra = [column for column in table.columns if column and column not in EXPORT_COLUMNS]
    if extra:
        warnings.append(f"Колонки {', '.join(extra)} листам не нужны и в них не попадут.")

    answers: dict[str, Answer] = {}
    seen: dict[str, Point] = {}
    no_id: list[int] = []
    bad_id: list[int] = []
    odd_essential: list[int] = []
    odd_input: Counter = Counter()
    split_answers: list[str] = []
    repeats: list[str] = []
    clashes: list[str] = []
    for number, row in table.rows:
        raw_answer, raw_point = _norm(row.get("answer")), _norm(row.get("point_id"))
        if not raw_answer or not raw_point:
            no_id.append(number)
            continue
        code = _code(raw_answer, raw_point)
        if code is None:
            bad_id.append(number)
            continue
        answer_id, point_id = code.split("/")
        essential = _bool(row.get("essential"))
        if essential is None and "essential" in table.columns:
            odd_essential.append(number)
        raw_input = _norm(row.get("input"))
        mode = _INPUTS.get(raw_input, raw_input)
        if raw_input and raw_input not in _INPUTS:
            odd_input[raw_input] += 1
        point = Point(point_id, _clean(row.get("point_title")), essential, _clean(row.get("lecture_quote")))
        fields = (_norm(row.get("student")), mode, _clean(row.get("question")), _text(row.get("answer_text")))
        answer = answers.get(answer_id)
        if answer is None:
            answer = answers[answer_id] = Answer(answer_id, *fields)
        elif (answer.student, answer.input, answer.question, answer.text) != fields and answer_id not in split_answers:
            split_answers.append(answer_id)
        if code in seen:
            (repeats if seen[code] == point else clashes).append(code)
            continue
        seen[code] = point
        answer.points.append(point)

    if no_id:
        warnings.append(f"Строки без ответа или пункта пропущены: {_lines(no_id)}.")
    if bad_id:
        warnings.append(f"Строки с непонятным кодом ответа или пункта пропущены: {_lines(bad_id)}.")
    if odd_essential:
        warnings.append(f"Непонятно, главный ли пункт (строки {_lines(odd_essential)}) — в листе без пометки.")
    for value, count in sorted(odd_input.items()):
        warnings.append(f"Непонятный ввод «{value}» в {count} строках — в листе как есть.")
    if split_answers:
        warnings.append(f"У ответов {', '.join(split_answers)} строки расходятся (текст, вопрос или ввод) — взята первая.")
    if repeats:
        warnings.append(f"Повторы строк (одинаковые) — взята одна: {_codes(repeats)}.")
    if clashes:
        warnings.append(f"Повторы строк с другим пунктом — взята первая: {_codes(clashes)}.")
    for answer in answers.values():
        answer.points.sort(key=lambda point: _natural(point.point_id))
    empty_text = sorted(answer.answer for answer in answers.values() if not answer.text)
    if empty_text:
        warnings.append(f"Пустой текст ответа: {', '.join(empty_text)}.")
    no_title = [f"{answer.answer}/{point.point_id}" for answer in answers.values() for point in answer.points if not point.title]
    if no_title:
        warnings.append(f"Пункты без названия: {_codes(no_title)}.")
    short = sorted(answer.answer for answer in answers.values() if len(answer.points) < MIN_POINTS)
    if short:
        warnings.append(
            f"У ответов меньше {MIN_POINTS} пунктов (в эталоне их 3–6): {', '.join(short)}. "
            "Проверьте, не обрезана ли выгрузка ограничением строк в SQL Editor."
        )
    return Export(table.name, table.digest, len(table.rows), list(answers.values()), warnings)


# ── Листы ───────────────────────────────────────────────────────────────────────


@dataclass
class Sheet:
    letter: str
    kit: str
    seed: int
    attempt: int
    answers: list[Answer]

    @property
    def shuffle(self) -> str:
        return f"{self.seed}:{self.letter}:{self.attempt}"


def kit_id(seed: int, answers: list[Answer]) -> str:
    ids = ",".join(sorted(answer.answer for answer in answers))
    return hashlib.sha256(f"{seed}|{ids}".encode("utf-8")).hexdigest()[:8]


def choose_answers(answers: list[Answer], count: int | None, seed: int) -> list[Answer]:
    """Все ответы или случайные count из них (seed — тот же, что у порядка листов)."""
    canonical = sorted(answers, key=lambda answer: answer.answer)
    if count is None or count >= len(canonical):
        return canonical
    return sorted(random.Random(f"{seed}:sample").sample(canonical, count), key=lambda answer: answer.answer)


def build_sheets(answers: list[Answer], seed: int) -> list[Sheet]:
    """Листы A и B: одни и те же ответы, у каждого свой порядок (random.Random(«seed:лист:попытка»)).

    Пункты внутри ответа — в порядке эталона. Если порядок B совпал с A, берётся следующая попытка.
    """
    canonical = sorted(answers, key=lambda answer: answer.answer)
    kit = kit_id(seed, canonical)
    sheets: list[Sheet] = []
    previous: list[str] | None = None
    for letter in LETTERS:
        attempt = 0
        while True:
            order = list(canonical)
            random.Random(f"{seed}:{letter}:{attempt}").shuffle(order)
            ids = [answer.answer for answer in order]
            if previous is None or len(ids) < 2 or ids != previous or attempt >= 99:
                break
            attempt += 1
        sheets.append(Sheet(letter, kit, seed, attempt, order))
        previous = ids
    return sheets


def sheet_items(sheet: Sheet) -> list[dict]:
    items: list[dict] = []
    for number, answer in enumerate(sheet.answers, start=1):
        for point in answer.points:
            items.append({
                "n": len(items) + 1,
                "a": number,
                "code": f"{answer.answer}/{point.point_id}",
                "pid": point.point_id,
                "main": _yes(point.essential),
                "input": INPUT_WORD.get(answer.input, answer.input),
                "title": point.title,
            })
    return items


def render_sheet_csv(sheet: Sheet) -> str:
    """Лист таблицей: строка — пункт; вопрос и текст ответа — в первой строке ответа. UTF-8 с BOM, «;»."""
    out = io.StringIO()
    writer = csv.writer(out, delimiter=";", lineterminator="\r\n")
    writer.writerow(SHEET_COLUMNS)
    n = 0
    for number, answer in enumerate(sheet.answers, start=1):
        for index, point in enumerate(answer.points):
            n += 1
            first = index == 0
            writer.writerow([_cell(value) for value in (
                sheet.letter, sheet.kit, n, number, f"{answer.answer}/{point.point_id}", point.point_id,
                _yes(point.essential), INPUT_WORD.get(answer.input, answer.input),
                answer.question if first else "", answer.text if first else "", point.title, point.quote, "", "",
            )])
    return "\ufeff" + out.getvalue()


_STYLE = """
:root { --ink: #1f2328; --muted: #57606a; --line: #d0d7de; --paper: #ffffff; --bg: #f6f8fa; --accent: #0b5cad;
  --done: #1a7f37; --todo: #bf8700; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html { color-scheme: light; }
body { margin: 0; background: var(--bg); color: var(--ink);
  font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
.wrap { max-width: 860px; margin: 0 auto; padding: 0 16px 48px; }
h1 { font-size: 1.5rem; line-height: 1.25; margin: 24px 0 4px; }
.meta { color: var(--muted); font-size: .875rem; margin: 0 0 16px; }
.instr, .answer { background: var(--paper); border: 1px solid var(--line); border-radius: 8px; padding: 12px 16px; }
.instr h2 { font-size: 1.125rem; margin: 4px 0 8px; }
.instr p { margin: 0 0 8px; }
.instr dl { margin: 0 0 8px; }
.instr dt { font-weight: 600; float: left; clear: left; margin-right: 6px; }
.instr dt::after { content: " —"; }
.instr dd { margin: 0 0 4px; }
.instr ul { margin: 0 0 8px; padding-left: 20px; }
.warn { background: #fff8c5; border: 1px solid #d4a72c; border-radius: 8px; padding: 8px 12px; }
.bar { position: sticky; top: 0; z-index: 2; background: var(--bg); border-bottom: 1px solid var(--line);
  display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 8px 0; margin: 16px 0 0; }
.progress { font-weight: 600; margin-right: auto; }
button { font: inherit; font-size: .9375rem; padding: 6px 12px; border: 1px solid var(--line); border-radius: 6px;
  background: var(--paper); color: var(--ink); cursor: pointer; }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
button.link { border-color: transparent; background: none; color: var(--accent); text-decoration: underline; padding: 6px 4px; }
button:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.status { color: var(--muted); font-size: .875rem; width: 100%; margin: 0; }
.copy textarea { width: 100%; height: 160px; font: .8125rem ui-monospace, Menlo, Consolas, monospace; }
.answer { margin: 16px 0; }
.answer h2 { font-size: 1.125rem; margin: 0 0 8px; display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: baseline; }
.tag { font-size: .8125rem; font-weight: 500; border: 1px solid var(--line); border-radius: 999px; padding: 0 8px;
  color: var(--muted); }
.code { font: .8125rem ui-monospace, Menlo, Consolas, monospace; color: var(--muted); }
.question { margin: 0 0 8px; }
.text { white-space: pre-wrap; overflow-wrap: anywhere; background: #f6f8fa; border-left: 3px solid var(--line);
  padding: 8px 12px; margin: 0 0 8px; }
.points { list-style: none; margin: 0; padding: 0; }
.point { border-top: 1px dashed var(--line); border-left: 3px solid transparent; padding: 10px 0 10px 10px; }
.point.done { border-left-color: var(--done); }
.point.todo { border-left-color: var(--todo); background: #fff8c5; }
.ptitle { font-weight: 600; margin: 0; }
.pid { font: .8125rem ui-monospace, Menlo, Consolas, monospace; color: var(--muted); margin-right: 6px; }
.ptitle .tag { margin-right: 6px; }
.quote { color: var(--muted); font-size: .9375rem; margin: 4px 0 8px; }
fieldset.choices { border: 0; margin: 0; padding: 0; min-width: 0; display: flex; flex-wrap: wrap; gap: 4px 18px; }
fieldset.choices legend { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0);
  white-space: nowrap; }
.choices label { white-space: nowrap; cursor: pointer; padding: 2px 0; }
.choices input { margin: 0 4px 0 0; vertical-align: -2px; }
.comment { display: flex; gap: 8px; align-items: baseline; margin: 6px 0 0; }
.comment label { color: var(--muted); font-size: .9375rem; }
.comment input { flex: 1; min-width: 0; font: inherit; padding: 4px 6px; border: 1px solid var(--line); border-radius: 4px; }
footer { color: var(--muted); font-size: .875rem; margin-top: 24px; }
@media (max-width: 600px) { .bar { position: static; } }
@media print {
  body { background: #fff; font-size: 11pt; }
  .wrap { max-width: none; padding: 0; }
  .no-print, .bar { display: none !important; }
  .instr, .answer { border: 0; border-radius: 0; padding: 8px 0; }
  .answer { border-top: 2px solid #000; }
  .text { background: none; border-left: 2px solid #999; }
  .point { break-inside: avoid; }
  .point.done, .point.todo { border-left-color: transparent; background: none; }
  .comment input { border: 0; border-bottom: 1px solid #000; border-radius: 0; }
}
"""

_INSTRUCTION = """<section class="instr">
<h2>Как размечать</h2>
<p>Ниже ответы студентов на вопросы экзамена. Под каждым ответом — пункты, которые ждут в полном ответе,
и цитата из лекции, откуда взят пункт. Для каждого пункта выберите один вариант:</p>
<dl>
<dt>назван</dt><dd>мысль пункта в ответе есть. Своими словами тоже считается.</dd>
<dt>частично</dt><dd>пункт упомянут, но без сути или раскрыт наполовину.</dd>
<dt>не назван</dt><dd>этой мысли в ответе нет. «Не знаю» и повтор вопроса — тоже «не назван».</dd>
<dt>ошибка</dt><dd>сказано обратное пункту или цитате лекции, или неверно по сути.
Если по пункту есть и верное, и ошибка, выбирайте «ошибка».</dd>
<dt>не могу решить</dt><dd>если решить правда нельзя. Напишите в комментарии почему.</dd>
</dl>
<ul>
<li>Судите только по тексту ответа и цитате лекции. Стиль, грамотность и знания сверх пунктов не оценивайте.
Верная мысль, которой нет в лекции, — не ошибка.</li>
<li>Ответ голосом — это автоматическая расшифровка речи: знаков препинания нет, бывают ошибки в словах.
Похожие по звучанию слова понимайте по смыслу.</li>
<li>Пометка «главный» — для сведения: все пункты судите одинаково.</li>
<li>Решайте сами, ни с кем не советуйтесь. Ответы перемешаны. Решений Meldy здесь нет — так задумано.</li>
<li>Комментарий не обязателен. Пишите, если сомневались.</li>
</ul>
<p><b>Как сохранить.</b> Отметки хранятся в этом браузере: страницу можно закрыть и открыть снова.
Когда закончите, нажмите «Скачать CSV» и отправьте файл тому, кто дал вам лист.
Чтобы продолжить на другом компьютере, скачайте CSV и там нажмите «Загрузить CSV».</p>
</section>"""

# Без сети и без внешних файлов. Отметки — в localStorage (ключ по набору и листу) и в CSV
# с колонками MARKS_COLUMNS; «Загрузить CSV» читает такой файл обратно (UTF-8 или Windows-1251).
_SCRIPT = r"""
(function () {
  "use strict";
  var data = JSON.parse(document.getElementById("data").textContent);
  var SHEET = data.sheet, KIT = data.kit, ITEMS = data.items;
  var WORDS = ["назван", "частично", "не назван", "ошибка", "не могу решить"];
  var HEADER = ["лист", "набор", "№", "ответ №", "код", "пункт", "главный", "ввод", "название пункта", "отметка", "комментарий"];
  var STORE = "meldy-razmetka:" + KIT + ":" + SHEET;
  var FILE = "otmetki_" + SHEET + "_" + KIT + ".csv";
  var byCode = {};
  ITEMS.forEach(function (item) { byCode[item.code] = item; });
  var storeOk = true, dirty = false;

  function $(id) { return document.getElementById(id); }
  function say(text) { $("status").textContent = text; $("statusline").hidden = !text; }
  function radios(item) { return document.getElementsByName("r" + item.n); }
  function comment(item) { return $("c" + item.n); }
  function getLabel(item) {
    var list = radios(item);
    for (var i = 0; i < list.length; i++) if (list[i].checked) return list[i].value;
    return "";
  }
  function setLabel(item, value) {
    var list = radios(item);
    for (var i = 0; i < list.length; i++) list[i].checked = list[i].value === value;
  }
  function marks() {
    var result = {};
    ITEMS.forEach(function (item) {
      var label = getLabel(item), text = comment(item).value;
      if (label || text) result[item.code] = [label, text];
    });
    return result;
  }
  function noStore() { storeOk = false; $("nostore").hidden = false; }
  function save() {
    dirty = true;
    if (!storeOk) return;
    try { localStorage.setItem(STORE, JSON.stringify({ v: 1, marks: marks() })); } catch (e) { noStore(); }
  }
  function apply(found) {
    var n = 0;
    Object.keys(found).forEach(function (code) {
      var item = byCode[code];
      if (!item) return;
      setLabel(item, WORDS.indexOf(found[code][0]) >= 0 ? found[code][0] : "");
      comment(item).value = found[code][1] || "";
      n++;
    });
    return n;
  }
  function restore() {
    var raw = null;
    try {
      raw = localStorage.getItem(STORE);
      localStorage.setItem(STORE + ":probe", "1");
      localStorage.removeItem(STORE + ":probe");
    } catch (e) { noStore(); return; }
    if (!raw) return;
    try { apply(JSON.parse(raw).marks || {}); } catch (e) { /* испорченная запись: начинаем с чистого листа */ }
  }
  function progress(showTodo) {
    var done = 0;
    ITEMS.forEach(function (item) {
      var li = $("item-" + item.n), ok = !!getLabel(item);
      if (ok) done++;
      li.classList.toggle("done", ok);
      if (ok) li.classList.remove("todo"); else if (showTodo) li.classList.add("todo");
    });
    $("progress").textContent = "Отмечено " + done + " из " + ITEMS.length;
    return done;
  }

  function cell(value) {
    var s = value == null ? "" : String(value);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[;"\r\n]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv() {
    var lines = [HEADER.map(cell).join(";")];
    ITEMS.forEach(function (item) {
      lines.push([SHEET, KIT, item.n, item.a, item.code, item.pid, item.main, item.input, item.title,
                  getLabel(item), comment(item).value].map(cell).join(";"));
    });
    return lines.join("\r\n") + "\r\n";
  }
  function count(text, ch) { return text.split(ch).length - 1; }
  function parseCsv(text) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    var first = text.split(/\r?\n/, 1)[0] || "";
    var delim = count(first, ";") >= count(first, ",") ? ";" : ",";
    if (count(first, "\t") > count(first, delim)) delim = "\t";
    var rows = [], row = [], field = "", quoted = false, i = 0, c;
    while (i < text.length) {
      c = text.charAt(i);
      if (quoted) {
        if (c === '"') {
          if (text.charAt(i + 1) === '"') { field += '"'; i += 2; continue; }
          quoted = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') { quoted = true; i++; continue; }
      if (c === delim) { row.push(field); field = ""; i++; continue; }
      if (c === "\r") { i++; continue; }
      if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
      field += c; i++;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows;
  }
  function norm(value) {
    return String(value == null ? "" : value).replace(/\ufeff/g, "").replace(/ё/g, "е").replace(/Ё/g, "Е")
      .replace(/\s+/g, " ").trim().toLowerCase();
  }
  function uncell(value) { return /^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value; }

  // null — нет колонок «код» и «отметка» (не тот файл или не та кодировка); иначе текст для строки статуса.
  function importCsv(text) {
    var rows = parseCsv(text);
    if (!rows.length) return null;
    var head = rows[0].map(norm);
    var iCode = head.indexOf("код"), iLabel = head.indexOf("отметка"), iComment = head.indexOf("комментарий");
    if (iLabel < 0) iLabel = head.indexOf("оценка");
    var iSheet = head.indexOf("лист"), iKit = head.indexOf("набор");
    if (iCode < 0 || iLabel < 0) return null;
    var found = {}, foreign = 0, odd = 0, other = "", otherKit = "";
    for (var r = 1; r < rows.length; r++) {
      var row = rows[r];
      if (row.length === 1 && row[0] === "") continue;
      var sheet = iSheet >= 0 ? norm(row[iSheet]).toUpperCase() : "";
      if (sheet && sheet !== SHEET) { other = sheet; continue; }
      if (iKit >= 0 && norm(row[iKit]) && norm(row[iKit]) !== KIT) otherKit = norm(row[iKit]);
      var code = norm(uncell(row[iCode] || ""));
      if (!byCode[code]) { foreign++; continue; }
      var label = norm(uncell(row[iLabel] || "")).replace(/\.$/, "");
      if (label && WORDS.indexOf(label) < 0) { odd++; label = ""; }
      found[code] = [label, iComment >= 0 ? uncell(row[iComment] || "") : ""];
    }
    var n = Object.keys(found).length;
    if (!n && other) return "Это отметки листа " + other + ", а здесь лист " + SHEET + ". Ничего не загружено.";
    if (!n) return "В файле нет пунктов этого листа. Ничего не загружено.";
    var foreignKit = "Файл из другого набора (" + otherKit + ", а здесь " + KIT + "). Загрузить совпавшие пункты?";
    if (otherKit && !window.confirm(foreignKit)) {
      return "Ничего не загружено.";
    }
    var before = Object.keys(marks()).length;
    if (before && !window.confirm("На странице уже есть отметки (" + before + "). Заменить их отметками из файла?")) {
      return "Ничего не загружено.";
    }
    apply(found);
    save();
    progress(false);
    var labeled = 0, notes = 0;
    Object.keys(found).forEach(function (code) { if (found[code][0]) labeled++; if (found[code][1]) notes++; });
    var note = "Загружено из файла: отметок " + labeled + ", комментариев " + notes + ".";
    if (foreign) note += " Чужих пунктов пропущено: " + foreign + ".";
    if (odd) note += " Непонятных оценок: " + odd + " — эти пункты без отметки.";
    return note;
  }
  function readAs(file, encoding, done) {
    var reader = new FileReader();
    reader.onload = function () { done(String(reader.result)); };
    reader.onerror = function () { done(null); };
    reader.readAsText(file, encoding);
  }

  function download() {
    var done = progress(true);
    if (done < ITEMS.length && !window.confirm("Без отметки " + (ITEMS.length - done) + " из " + ITEMS.length +
        ". Скачать как есть? Потом можно продолжить и скачать снова.")) return;
    var blob = new Blob(["\ufeff" + toCsv()], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = FILE;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
    dirty = false;
    say("Скачан файл " + FILE + ": отмечено " + done + " из " + ITEMS.length + ".");
    $("showcsv").hidden = false;
  }
  function next() {
    for (var i = 0; i < ITEMS.length; i++) {
      if (!getLabel(ITEMS[i])) {
        var li = $("item-" + ITEMS[i].n);
        li.scrollIntoView({ block: "center" });
        var first = radios(ITEMS[i])[0];
        if (first) first.focus({ preventScroll: true });
        return;
      }
    }
    say("Все пункты отмечены.");
  }

  document.addEventListener("change", function (event) {
    var target = event.target;
    if (target && target.type === "radio") { save(); progress(false); }
  });
  document.addEventListener("input", function (event) {
    if (event.target && event.target.classList.contains("note")) save();
  });
  $("save").addEventListener("click", download);
  $("save2").addEventListener("click", download);
  $("next").addEventListener("click", next);
  $("print").addEventListener("click", function () { window.print(); });
  $("open").addEventListener("click", function () { $("load").click(); });
  $("showcsv").addEventListener("click", function () {
    var box = $("copybox");
    box.hidden = !box.hidden;
    if (!box.hidden) { box.querySelector("textarea").value = toCsv(); box.querySelector("textarea").select(); }
  });
  $("load").addEventListener("change", function () {
    var file = this.files && this.files[0];
    this.value = "";
    if (!file) return;
    readAs(file, "utf-8", function (text) {
      var result = text == null ? null : importCsv(text);
      if (result !== null) { say(result); return; }
      readAs(file, "windows-1251", function (other) {
        var second = other == null ? null : importCsv(other);
        say(second !== null ? second : "Это не файл отметок: нет колонок «код» и «отметка».");
      });
    });
  });
  window.addEventListener("beforeunload", function (event) {
    if (!storeOk && dirty) { event.preventDefault(); event.returnValue = ""; }
  });
  restore();
  progress(false);
})();
"""


def _csp_source(source: str) -> str:
    return "'sha256-" + base64.b64encode(hashlib.sha256(source.encode("utf-8")).digest()).decode("ascii") + "'"


def _json_block(value: object) -> str:
    text = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return text.replace("&", "\\u0026").replace("<", "\\u003c").replace(">", "\\u003e")


def render_html(sheet: Sheet) -> str:
    """Лист для разметчика: один файл без сети и внешних файлов (CSP пускает только свой стиль и скрипт)."""
    e = html.escape
    items = sheet_items(sheet)
    csp = (
        f"default-src 'none'; style-src {_csp_source(_STYLE)}; script-src {_csp_source(_SCRIPT)}; "
        "img-src data:; form-action 'none'; base-uri 'none'"
    )
    total = len(sheet.answers)
    parts = [
        "<!doctype html>",
        '<html lang="ru">',
        "<head>",
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        f'<meta http-equiv="Content-Security-Policy" content="{csp}">',
        f"<title>Разметка ответов — лист {e(sheet.letter)}</title>",
        f"<style>{_STYLE}</style>",
        "</head>",
        "<body>",
        '<div class="wrap">',
        "<header>",
        f"<h1>Разметка ответов — лист {e(sheet.letter)}</h1>",
        f'<p class="meta">Ответов: {total}, пунктов: {len(items)}. Набор {e(sheet.kit)}.</p>',
        "</header>",
        _INSTRUCTION,
        '<noscript><p class="warn">JavaScript выключен: лист можно читать и печатать, но отметки не сохранятся. '
        f"Включите JavaScript или отмечайте в файле razmetka_{e(sheet.letter)}.csv.</p></noscript>",
        '<div class="bar no-print">',
        f'<span class="progress" id="progress">Отмечено 0 из {len(items)}</span>',
        '<button type="button" id="next">К неотмеченному</button>',
        '<button type="button" id="save" class="primary">Скачать CSV</button>',
        '<button type="button" id="open">Загрузить CSV</button>',
        '<input type="file" id="load" accept=".csv,text/csv" hidden>',
        '<button type="button" id="print" class="link">Распечатать</button>',
        '<p class="status" id="statusline" hidden><span id="status" role="status" aria-live="polite"></span> '
        '<button type="button" id="showcsv" class="link" hidden>Файл не скачался</button></p>',
        "</div>",
        '<p class="warn no-print" id="nostore" hidden>Браузер не даёт хранить отметки. Не закрывайте страницу, '
        "пока не скачаете CSV.</p>",
        '<div class="copy no-print" id="copybox" hidden><p>Скопируйте этот текст, вставьте в Блокнот и сохраните '
        'файл с расширением .csv (кодировка UTF-8). Его и отправьте.</p>'
        '<textarea readonly aria-label="Отметки в формате CSV"></textarea></div>',
        "<main>",
    ]
    by_code = {item["code"]: item for item in items}
    data = {"sheet": sheet.letter, "kit": sheet.kit, "items": items}
    for number, answer in enumerate(sheet.answers, start=1):
        tag = INPUT_TAG.get(answer.input, answer.input)
        parts.append(f'<article class="answer" id="answer-{number}">')
        parts.append(
            f"<h2>Ответ {number} из {total}"
            + (f' <span class="tag">{e(tag)}</span>' if tag else "")
            + f' <span class="code">код {e(answer.answer)}</span></h2>'
        )
        parts.append(f'<p class="question"><b>Вопрос.</b> {e(answer.question) if answer.question else "(не выгружен)"}</p>')
        parts.append(f'<div class="text">{e(answer.text) if answer.text else "(текст пуст)"}</div>')
        parts.append('<ol class="points">')
        for point in answer.points:
            n = by_code[f"{answer.answer}/{point.point_id}"]["n"]
            main = '<span class="tag">главный</span>' if point.essential else ""
            parts.append(f'<li class="point" id="item-{n}">')
            parts.append(
                f'<p class="ptitle"><span class="pid">{e(point.point_id)}</span>{main}'
                f'{e(point.title) if point.title else "(без названия)"}</p>'
            )
            quote = f"Из лекции: «{e(point.quote)}»" if point.quote else "Цитаты нет."
            parts.append(f'<p class="quote">{quote}</p>')
            parts.append(f'<fieldset class="choices"><legend>Пункт {e(point.point_id)}, ответ {number}</legend>')
            for choice in CHOICES:
                word = WORD[choice]
                parts.append(f'<label><input type="radio" name="r{n}" value="{e(word)}"> {e(word)}</label>')
            parts.append("</fieldset>")
            parts.append(
                f'<p class="comment"><label for="c{n}">Комментарий</label>'
                f'<input type="text" class="note" id="c{n}" maxlength="1000" autocomplete="off"></p>'
            )
            parts.append("</li>")
        parts.append("</ol>")
        parts.append("</article>")
    parts += [
        "</main>",
        '<p class="no-print"><button type="button" id="save2" class="primary">Скачать CSV</button></p>',
        f"<footer>Лист {e(sheet.letter)}, набор {e(sheet.kit)}, порядок {e(sheet.shuffle)}. Страница ничего не "
        "отправляет в сеть: отметки остаются в этом браузере и в файле, который вы скачаете.</footer>",
        "</div>",
        f'<script type="application/json" id="data">{_json_block(data)}</script>',
        f"<script>{_SCRIPT}</script>",
        "</body>",
        "</html>",
        "",
    ]
    return "\n".join(parts)


@dataclass
class MakeResult:
    kit: str
    seed: int
    answers: int
    points: int
    students: int
    top_student: int
    files: list[Path]
    warnings: list[str]
    notes: list[str]


def make_kit(
    export_path: Path,
    out_dir: Path,
    *,
    seed: int | None = None,
    answers: int | None = None,
    force: bool = False,
    now: datetime | None = None,
) -> MakeResult:
    """Листы A и B (HTML и CSV) и запись набора razmetka_kit.json из первого запроса выгрузки."""
    if answers is not None and answers < 1:
        raise InputError("--answers: нужно число больше нуля")
    export = load_export(read_table(Path(export_path)))
    if not export.answers:
        raise InputError(f"{export.name}: нет ни одного ответа с пунктами")
    seed = secrets.randbelow(1_000_000) if seed is None else seed
    chosen = choose_answers(export.answers, answers, seed)
    sheets = build_sheets(chosen, seed)
    out_dir = Path(out_dir)
    contents: dict[str, str] = {}
    for sheet in sheets:
        contents[f"razmetka_{sheet.letter}.html"] = render_html(sheet)
        contents[f"razmetka_{sheet.letter}.csv"] = render_sheet_csv(sheet)
    students = Counter(answer.student for answer in chosen if answer.student)
    notes: list[str] = []
    low, high = PLAN_ANSWERS
    if len(chosen) < low:
        notes.append(f"Ответов {len(chosen)} — по плану нужно {low}–{high}: интервалы будут широкими.")
    elif len(chosen) > high and answers is None:
        notes.append(f"Ответов {len(chosen)} — по плану {low}–{high}. Случайные N ответов: --answers N.")
    if answers is not None and answers > len(export.answers):
        notes.append(f"Просили {answers} ответов, в выгрузке их {len(export.answers)} — взяты все.")
    record = {
        "tool": "backend/scripts/blind_labeling.py make",
        "format": 1,
        "kit": sheets[0].kit,
        "created_at": (now or datetime.now(timezone.utc)).isoformat(timespec="seconds"),
        "seed": seed,
        "export": {
            "file": export.name, "sha256": export.digest, "rows": export.rows,
            "answers": len(export.answers), "points": export.points,
        },
        "sample": {"requested": answers, "answers": len(chosen), "points": sum(len(answer.points) for answer in chosen)},
        "students": len(students),
        "sheets": {
            sheet.letter: {
                "shuffle": sheet.shuffle,
                "files": [f"razmetka_{sheet.letter}.html", f"razmetka_{sheet.letter}.csv"],
                "order": [answer.answer for answer in sheet.answers],
            }
            for sheet in sheets
        },
        "warnings": export.warnings,
    }
    contents["razmetka_kit.json"] = json.dumps(record, ensure_ascii=False, indent=2) + "\n"
    existing = [name for name in contents if (out_dir / name).exists()]
    if existing and not force:
        raise InputError(f"В папке {out_dir} уже есть {', '.join(existing)}. Укажите другую папку или --force.")
    out_dir.mkdir(parents=True, exist_ok=True)
    files = []
    for name, content in contents.items():
        path = out_dir / name
        path.write_text(content, encoding="utf-8", newline="")
        files.append(path)
    return MakeResult(
        sheets[0].kit, seed, len(chosen), record["sample"]["points"], len(students),
        max(students.values(), default=0), files, export.warnings, notes,
    )


# ── Отметки разметчиков и ключ ──────────────────────────────────────────────────


@dataclass
class ItemMeta:
    essential: bool | None = None
    input: str | None = None
    title: str = ""


@dataclass
class Marks:
    """Отметки одного разметчика: код «ответ/пункт» → covered…wrong, unsure или None (нет отметки)."""

    name: str
    letter: str
    digest: str
    rows: int
    sheet: str | None
    kit: str | None
    labels: dict[str, str | None]
    comments: dict[str, str]
    meta: dict[str, ItemMeta]
    empty: list[str]
    unknown: dict[str, list[str]]
    repeats: list[str]
    conflicts: list[str]
    bad_rows: list[int]
    notes: list[str]


def _resolve(columns: list[str], aliases: dict[str, tuple[str, ...]]) -> dict[str, str | None]:
    return {key: next((name for name in names if name in columns), None) for key, names in aliases.items()}


def load_marks(table: Table, letter: str) -> Marks:
    """CSV разметчика: файл из HTML-листа («Скачать CSV») или заполненный razmetka_X.csv."""
    if "meldy_verdict" in table.columns:
        raise InputError(f"{table.name}: это ключ с вердиктами Meldy, а нужен файл разметчика {letter}.")
    cols = _resolve(table.columns, _MARK_ALIASES)
    if cols["label"] is None:
        if "answer_text" in table.columns:
            raise InputError(f"{table.name}: это выгрузка (первый запрос), а нужен файл разметчика {letter}.")
        raise InputError(f"{table.name}: нет колонки «отметка» — это не файл отметок разметчика {letter}.")
    if cols["code"] is None and (cols["answer"] is None or cols["point"] is None):
        raise InputError(f"{table.name}: нет колонки «код» (или answer и point_id) — не понять, к какому пункту отметка.")
    entries: dict[str, list[tuple[str | None, str, str, ItemMeta]]] = {}
    bad_rows: list[int] = []
    sheets: Counter = Counter()
    kits: Counter = Counter()
    for number, row in table.rows:
        if cols["code"] is not None:
            answer, _, point = _norm(_uncell(row.get(cols["code"], ""))).rpartition("/")
            code = _code(answer, point)
        else:
            code = _code(row.get(cols["answer"], ""), row.get(cols["point"], ""))
        if code is None:
            bad_rows.append(number)
            continue
        raw = _uncell(row.get(cols["label"], "")).strip()
        word = _norm(raw).rstrip(".")
        label = _LABELS.get(word) if word else None
        if cols["sheet"] and _norm(row.get(cols["sheet"])):
            sheets[_norm(row.get(cols["sheet"])).upper()] += 1
        if cols["kit"] and _norm(row.get(cols["kit"])):
            kits[_norm(row.get(cols["kit"]))] += 1
        raw_input = _norm(row.get(cols["input"])) if cols["input"] else ""
        meta = ItemMeta(
            _bool(row.get(cols["essential"])) if cols["essential"] else None,
            _INPUTS.get(raw_input, raw_input or None),
            _clean(_uncell(row.get(cols["title"], ""))) if cols["title"] else "",
        )
        comment = _clean(_uncell(row.get(cols["comment"], ""))) if cols["comment"] else ""
        entries.setdefault(code, []).append((label, raw if word and label is None else "", comment, meta))

    # Повторы пункта: одна и та же отметка (или одна непустая) — пункт с этой отметкой; разные — не учитывается.
    labels: dict[str, str | None] = {}
    comments: dict[str, str] = {}
    metas: dict[str, ItemMeta] = {}
    unknown: dict[str, list[str]] = defaultdict(list)
    repeats: list[str] = []
    conflicts: list[str] = []
    empty: list[str] = []
    for code, rows in entries.items():
        found = {label for label, _, _, _ in rows if label is not None}
        if len(rows) > 1:
            (conflicts if len(found) > 1 else repeats).append(code)
        chosen = next((row for row in rows if row[0] is not None), rows[0])
        labels[code] = chosen[0] if len(found) <= 1 else None
        comments[code] = " / ".join(dict.fromkeys(comment for _, _, comment, _ in rows if comment))
        metas[code] = chosen[3]
        if labels[code] is None and len(found) <= 1:
            odd = next((raw for _, raw, _, _ in rows if raw), "")
            if odd:
                unknown[odd].append(code)
            else:
                empty.append(code)
    notes = list(table.notes)
    if len(sheets) > 1:
        notes.append(f"В файле {letter} ({table.name}) строки разных листов: {', '.join(sorted(sheets))}.")
    if len(kits) > 1:
        notes.append(f"В файле {letter} ({table.name}) строки разных наборов: {', '.join(sorted(kits))}.")
    return Marks(
        table.name, letter, table.digest, len(table.rows),
        sheets.most_common(1)[0][0] if sheets else None, kits.most_common(1)[0][0] if kits else None,
        labels, comments, metas, sorted(empty, key=_code_key), dict(unknown), sorted(repeats, key=_code_key),
        sorted(conflicts, key=_code_key), bad_rows, notes,
    )


@dataclass(frozen=True)
class KeyRow:
    verdict: str | None  # covered…wrong или unrated; None — непонятный или противоречивый
    quote: str
    followup: str | None
    followup_answer: str


@dataclass
class Key:
    name: str
    digest: str
    rows: int
    items: dict[str, KeyRow]
    unknown: dict[str, list[str]]
    repeats: list[str]
    conflicts: list[str]
    bad_rows: list[int]
    notes: list[str]


def load_key(table: Table) -> Key:
    """Второй запрос выгрузки: вердикт Meldy по паре (answer, point_id)."""
    if "answer_text" in table.columns:
        raise InputError(f"{table.name}: это первый запрос (для разметчиков), а нужен второй — ключ с вердиктами Meldy.")
    if any(alias in table.columns for alias in _MARK_ALIASES["label"]):
        raise InputError(f"{table.name}: это файл разметчика, а нужен ключ (второй запрос выгрузки).")
    missing = [column for column in KEY_REQUIRED if column not in table.columns]
    if missing:
        raise InputError(
            f"{table.name}: нет колонок {', '.join(missing)}. Нужен второй запрос из docs/oral-answer-texts-export.sql."
        )
    items: dict[str, KeyRow] = {}
    unknown: dict[str, list[str]] = defaultdict(list)
    repeats: list[str] = []
    conflicts: set[str] = set()
    bad_rows: list[int] = []
    for number, row in table.rows:
        code = _code(row.get("answer"), row.get("point_id"))
        if code is None:
            bad_rows.append(number)
            continue
        word = _norm(row.get("meldy_verdict"))
        verdict = _VERDICTS.get(word)
        if verdict is None:
            unknown[word or "(пусто)"].append(code)
        followup_word = _norm(row.get("meldy_followup_verdict"))
        followup = _VERDICTS.get(followup_word) if followup_word else None
        if followup_word and followup is None:
            unknown[f"{followup_word} (переспрос)"].append(code)
        entry = KeyRow(verdict, _clean(row.get("meldy_quote")), followup, _clean(row.get("followup_answer")))
        if code in items:
            repeats.append(code)
            if items[code].verdict != entry.verdict:
                conflicts.add(code)
            continue
        items[code] = entry
    for code in conflicts:
        items[code] = KeyRow(None, "", None, "")
    return Key(
        table.name, table.digest, len(table.rows), items, dict(unknown),
        sorted(set(repeats) - conflicts, key=_code_key), sorted(conflicts, key=_code_key), bad_rows, list(table.notes),
    )


# ── Статистика ──────────────────────────────────────────────────────────────────


def wilson(hits: int, total: int, z: float = Z95) -> tuple[float, float] | None:
    """95 % интервал Уилсона для доли hits/total; None — нечего считать."""
    if total <= 0:
        return None
    p = hits / total
    denominator = 1 + z * z / total
    center = (p + z * z / (2 * total)) / denominator
    half = z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / denominator
    return max(0.0, center - half), min(1.0, center + half)


@dataclass(frozen=True)
class Share:
    hits: int
    total: int

    @property
    def value(self) -> float | None:
        return self.hits / self.total if self.total else None

    @property
    def interval(self) -> tuple[float, float] | None:
        return wilson(self.hits, self.total)


@dataclass(frozen=True)
class Kappa:
    """Каппа Коэна для двух разметчиков; low/high — приблизительный 95 % интервал (ошибка по Коэну, 1960).

    Когда совпали все пары (или ни одна), ошибка по этой формуле нулевая и интервал вышел бы точкой —
    тогда low/high None: неопределённость показывает интервал доли совпадений.
    """

    n: int
    agree: int
    p_o: float | None
    p_e: float | None
    kappa: float | None
    low: float | None
    high: float | None


def cohen_kappa(pairs: list[tuple[str, str]], classes: tuple[str, ...]) -> Kappa:
    n = len(pairs)
    if n == 0:
        return Kappa(0, 0, None, None, None, None, None)
    agree = sum(1 for first, second in pairs if first == second)
    p_o = agree / n
    first = Counter(x for x, _ in pairs)
    second = Counter(y for _, y in pairs)
    p_e = sum(first[k] * second[k] for k in classes) / (n * n)
    if p_e >= 1:
        return Kappa(n, agree, p_o, p_e, None, None, None)
    kappa = (p_o - p_e) / (1 - p_e)
    se = math.sqrt(p_o * (1 - p_o) / (n * (1 - p_e) ** 2))
    if se == 0:
        return Kappa(n, agree, p_o, p_e, kappa, None, None)
    return Kappa(n, agree, p_o, p_e, kappa, max(-1.0, kappa - Z95 * se), min(1.0, kappa + Z95 * se))


def binary(label: str) -> str:
    """Назван / не назван: строку шпаргалки стирает только «назван» (covered)."""
    return NAMED if label == "covered" else NOT_NAMED


def _rated(label: str | None) -> bool:
    return label in CLASSES


# ── Сверка ──────────────────────────────────────────────────────────────────────


@dataclass
class Item:
    code: str
    a: str | None
    b: str | None
    a_comment: str
    b_comment: str
    meldy: str | None
    meldy_quote: str
    followup: str | None
    in_a: bool
    in_b: bool
    in_key: bool
    meta: ItemMeta

    @property
    def answer(self) -> str:
        return self.code.split("/")[0]

    @property
    def point(self) -> str:
        return self.code.split("/")[1]

    @property
    def both(self) -> bool:
        return _rated(self.a) and _rated(self.b)

    @property
    def consensus(self) -> str | None:
        """Общий вариант A и B из четырёх или None."""
        return self.a if self.both and self.a == self.b else None

    @property
    def consensus_binary(self) -> str | None:
        """Общий ответ A и B «назван / не назван» или None."""
        return binary(self.a) if self.both and binary(self.a) == binary(self.b) else None


@dataclass
class Group:
    name: str
    exact: Share
    binary: Share
    false_named: Share
    false_not_named: Share


@dataclass
class Result:
    a: Marks
    b: Marks
    key: Key
    items: list[Item]
    warnings: list[str]
    people4: Kappa
    people2: Kappa
    versus: dict[str, tuple[Share, Share]]
    false_named: Share  # из пунктов, которые оба человека не засчитали, Meldy сказал «назван»
    false_named_of_meldy: Share  # из «назван» Meldy люди не засчитали
    false_not_named: Share  # из пунктов, которые люди засчитали, Meldy сказал другое
    false_not_named_of_meldy: Share  # из «не назван» Meldy (частично, не назван, ошибка) люди засчитали
    confusion: Counter
    people_matrix: Counter
    by_essential: list[Group]
    by_input: list[Group]
    followups: Counter
    disputes: list[Item]
    mismatches: list[Item]


def _against(items: list[Item], reference) -> tuple[Share, Share]:
    """Meldy против эталона reference(item) → вариант из четырёх или None: (4 варианта, назван / не назван)."""
    pairs = [(item.meldy, reference(item)) for item in items if _rated(item.meldy) and reference(item) is not None]
    return (
        Share(sum(1 for meldy, truth in pairs if meldy == truth), len(pairs)),
        Share(sum(1 for meldy, truth in pairs if binary(meldy) == binary(truth)), len(pairs)),
    )


def _errors(items: list[Item]) -> tuple[Share, Share, Share, Share]:
    """Ложные «назван» и «не назван» против общего ответа людей «назван / не назван»."""
    judged = [item for item in items if _rated(item.meldy) and item.consensus_binary is not None]
    people_not = [item for item in judged if item.consensus_binary == NOT_NAMED]
    people_named = [item for item in judged if item.consensus_binary == NAMED]
    meldy_named = [item for item in judged if item.meldy == "covered"]
    meldy_not = [item for item in judged if item.meldy != "covered"]
    return (
        Share(sum(1 for item in people_not if item.meldy == "covered"), len(people_not)),
        Share(sum(1 for item in meldy_named if item.consensus_binary == NOT_NAMED), len(meldy_named)),
        Share(sum(1 for item in people_named if item.meldy != "covered"), len(people_named)),
        Share(sum(1 for item in meldy_not if item.consensus_binary == NAMED), len(meldy_not)),
    )


def _consensus(items: list[Item]) -> tuple[Share, Share]:
    """Meldy против общего ответа людей: 4 варианта (A = B) и «назван / не назван» (A и B совпали в этом)."""
    agreed = [item for item in items if _rated(item.meldy) and item.consensus_binary is not None]
    return (
        _against(items, lambda item: item.consensus)[0],
        Share(sum(1 for item in agreed if binary(item.meldy) == item.consensus_binary), len(agreed)),
    )


def _group(name: str, items: list[Item]) -> Group:
    exact, agreed = _consensus(items)
    false_named, _, false_not_named, _ = _errors(items)
    return Group(name, exact, agreed, false_named, false_not_named)


def _merge_meta(first: ItemMeta | None, second: ItemMeta | None) -> tuple[ItemMeta, bool]:
    if first is None or second is None:
        return (first or second or ItemMeta()), False
    clash = any(
        x is not None and y is not None and x != y
        for x, y in ((first.essential, second.essential), (first.input, second.input))
    )
    return ItemMeta(
        first.essential if first.essential is not None else second.essential,
        first.input or second.input,
        first.title or second.title,
    ), clash


def compare(a: Marks, b: Marks, key: Key) -> Result:
    if a.digest and a.digest == b.digest:
        raise InputError("Файлы A и B одинаковые: нужны отметки двух разных людей.")
    if a.sheet and b.sheet and a.sheet == b.sheet:
        raise InputError(f"Оба файла — отметки листа {a.sheet}. Нужны файлы листа A и листа B.")
    warnings: list[str] = []
    for marks in (a, b):
        warnings += marks.notes
    warnings += key.notes
    for marks in (a, b):
        if marks.sheet is None:
            warnings.append(f"В файле {marks.letter} ({marks.name}) нет колонки «лист»: не проверить, чей это файл.")
        elif marks.sheet != marks.letter:
            warnings.append(f"Файл {marks.letter} ({marks.name}) — отметки листа {marks.sheet}. Файлы перепутаны местами? "
                            "Цифры от этого не меняются, но A и B в отчёте — по порядку файлов в команде.")
    if a.kit and b.kit and a.kit != b.kit:
        warnings.append(f"Листы из разных наборов ({a.kit} и {b.kit}): сравниваются только общие пункты.")
    if a.labels and a.labels == b.labels and a.comments == b.comments:
        warnings.append("Отметки и комментарии A и B совпадают полностью. Проверьте, что это два разных человека.")

    for marks in (a, b):
        who = f"{marks.letter} ({marks.name})"
        if marks.bad_rows:
            warnings.append(f"{who}: строки без понятного кода пункта пропущены: {_lines(marks.bad_rows)}.")
        for raw, codes in sorted(marks.unknown.items()):
            warnings.append(f"{who}: непонятная отметка «{raw}» — пункт считается неотмеченным: {_codes(codes)}.")
        if marks.repeats:
            warnings.append(f"{who}: пункт повторяется, отметка одна — взята одна строка: {_codes(marks.repeats)}.")
        if marks.conflicts:
            warnings.append(f"{who}: пункт повторяется с разными отметками — не учитывается: {_codes(marks.conflicts)}.")
        if marks.empty:
            warnings.append(f"{who}: без отметки {len(marks.empty)}: {_codes(marks.empty)}.")
    only_a = set(a.labels) - set(b.labels)
    only_b = set(b.labels) - set(a.labels)
    if only_a:
        warnings.append(f"Есть в файле A, но нет в B ({len(only_a)}): {_codes(only_a)}.")
    if only_b:
        warnings.append(f"Есть в файле B, но нет в A ({len(only_b)}): {_codes(only_b)}.")
    labeled = set(a.labels) | set(b.labels)
    no_key = labeled - set(key.items)
    if labeled and key.items and no_key == labeled:
        warnings.insert(0, "Ни один пункт листов не нашёлся в ключе. Проверьте, что в запросах 1 и 2 одна и та же "
                           "соль и что ключ — от той же выгрузки.")
    if no_key:
        warnings.append(f"Нет в ключе, Meldy не с чем сравнить ({len(no_key)}): {_codes(no_key)}.")
    if key.bad_rows:
        warnings.append(f"Ключ: строки без понятного кода пропущены: {_lines(key.bad_rows)}.")
    for raw, codes in sorted(key.unknown.items()):
        warnings.append(f"Ключ: непонятный вердикт «{raw}» — пункт без вердикта: {_codes(codes)}.")
    if key.repeats:
        warnings.append(f"Ключ: пункт повторяется с тем же вердиктом — взята одна строка: {_codes(key.repeats)}.")
    if key.conflicts:
        warnings.append(f"Ключ: пункт повторяется с разными вердиктами — не учитывается: {_codes(key.conflicts)}.")
    not_labeled = set(key.items) - labeled
    if not_labeled:
        labeled_answers = {code.split("/")[0] for code in labeled}
        partly = {code for code in not_labeled if code.split("/")[0] in labeled_answers}
        absent = {code.split("/")[0] for code in not_labeled - partly}
        if absent:
            warnings.append(f"Ответов в ключе, которых нет в листах: {len(absent)} (не вошли в выборку?). "
                            "В сравнение они не входят.")
        if partly:
            warnings.append(f"В ключе есть пункты размеченных ответов, которых нет в листах ({len(partly)}): {_codes(partly)}.")

    items: list[Item] = []
    clashes: list[str] = []
    for code in sorted(labeled | set(key.items), key=_code_key):
        meta, clash = _merge_meta(a.meta.get(code), b.meta.get(code))
        if clash:
            clashes.append(code)
        entry = key.items.get(code)
        items.append(Item(
            code, a.labels.get(code), b.labels.get(code), a.comments.get(code, ""), b.comments.get(code, ""),
            entry.verdict if entry else None, entry.quote if entry else "", entry.followup if entry else None,
            code in a.labels, code in b.labels, entry is not None, meta,
        ))
    if clashes:
        warnings.append(f"У A и B разные пометки «главный» или «ввод» — взята из A: {_codes(clashes)}.")
    unrated = [item.code for item in items if item.in_key and (item.in_a or item.in_b) and item.meldy == UNRATED]
    if unrated:
        warnings.append(f"Meldy не оценил ({len(unrated)}) — в сравнение с Meldy не входят: {_codes(unrated)}.")

    scope = [item for item in items if item.in_a or item.in_b]
    both = [item for item in scope if item.both]
    people4 = cohen_kappa([(item.a, item.b) for item in both], CLASSES)
    people2 = cohen_kappa([(binary(item.a), binary(item.b)) for item in both], (NAMED, NOT_NAMED))
    versus = {
        "A": _against(scope, lambda item: item.a if _rated(item.a) else None),
        "B": _against(scope, lambda item: item.b if _rated(item.b) else None),
        "consensus": _consensus(scope),
    }
    false_named, false_named_of_meldy, false_not_named, false_not_named_of_meldy = _errors(scope)
    confusion: Counter = Counter()
    for item in scope:
        if item.consensus is not None:
            confusion[(item.meldy if item.in_key else None, item.consensus)] += 1
    people_matrix: Counter = Counter()
    for item in scope:
        if item.in_a and item.in_b:
            people_matrix[(item.a, item.b)] += 1
    by_essential = [
        _group(name, [item for item in scope if item.meta.essential is value])
        for name, value in (("Главные пункты", True), ("Остальные пункты", False), ("Не указано", None))
    ]
    by_input = [
        _group(name, [item for item in scope if item.meta.input == value])
        for name, value in (("Голос", "speech"), ("Текст", "text"), ("Голос и текст", "mixed"))
    ]
    other_inputs = sorted({item.meta.input or "" for item in scope} - {"speech", "text", "mixed"})
    for value in other_inputs:
        by_input.append(_group(f"Ввод «{value}»" if value else "Не указано",
                               [item for item in scope if (item.meta.input or "") == value]))
    followups = Counter(item.followup for item in scope if item.followup)
    disputes = [
        item for item in scope
        if (item.a is not None and item.b is not None and item.a != item.b) or item.a == item.b == UNSURE
    ]

    def order(item: Item) -> tuple:
        if item.meldy == "covered" and item.consensus_binary == NOT_NAMED:
            kind = 0
        elif item.meldy != "covered" and item.consensus_binary == NAMED:
            kind = 1
        else:
            kind = 2
        return (kind, _code_key(item.code))

    mismatches = sorted(
        (
            item for item in scope
            if _rated(item.meldy) and item.consensus_binary is not None
            and (binary(item.meldy) != item.consensus_binary or (item.consensus is not None and item.meldy != item.consensus))
        ),
        key=order,
    )
    return Result(
        a, b, key, items, warnings, people4, people2, versus, false_named, false_named_of_meldy, false_not_named,
        false_not_named_of_meldy, confusion, people_matrix, by_essential, by_input, followups, disputes, mismatches,
    )


# ── Отчёт ───────────────────────────────────────────────────────────────────────


def _pct(value: float | None) -> str:
    return "—" if value is None else f"{value * 100:.1f}".replace(".", ",") + " %"


def _num(value: float) -> str:
    return f"{value:.2f}".replace(".", ",").replace("-", "−")


def _share(share: Share) -> str:
    if not share.total:
        return "нет данных"
    low, high = share.interval
    span = f"{low * 100:.1f}–{high * 100:.1f} %".replace(".", ",")
    return f"{share.hits} из {share.total} = {_pct(share.value)} ({span})"


def _kappa_word(kappa: float) -> str:
    if kappa < 0:
        return "согласия нет"
    if kappa <= 0.20:
        return "слабое согласие"
    if kappa <= 0.40:
        return "удовлетворительное согласие"
    if kappa <= 0.60:
        return "умеренное согласие"
    if kappa <= 0.80:
        return "существенное согласие"
    return "почти полное согласие"


def _kappa(kappa: Kappa) -> str:
    if not kappa.n:
        return "нет данных"
    if kappa.kappa is None:
        return "не считается: у обоих все отметки одного варианта"
    if kappa.low is None:
        return f"{_num(kappa.kappa)} — {_kappa_word(kappa.kappa)}"
    return f"{_num(kappa.kappa)} (примерно от {_num(kappa.low)} до {_num(kappa.high)}) — {_kappa_word(kappa.kappa)}"


def _md(value: object, limit: int = 0) -> str:
    text = _clean(value)
    if limit and len(text) > limit:
        text = text[: limit - 1].rstrip() + "…"
    return text.replace("|", "\\|") or "—"


def _word(label: str | None) -> str:
    return WORD.get(label, "—") if label else "—"


def _point(item: Item, limit: int = 70) -> str:
    parts = [item.point]
    if item.meta.essential:
        parts.append("главный")
    if item.meta.title:
        parts.append(_md(item.meta.title, limit))
    return " · ".join(parts)


def _comments(item: Item, limit: int = 120) -> str:
    parts = [f"{who}: {_md(text, limit)}" for who, text in (("A", item.a_comment), ("B", item.b_comment)) if text]
    return "; ".join(part for part in parts if part) or "—"


def _count_row(title: str, values: list) -> str:
    return f"| {title} | " + " | ".join(str(value) for value in values) + " |"


def render_report(result: Result, today: str | None = None) -> str:
    a, b, key = result.a, result.b, result.key
    scope = [item for item in result.items if item.in_a or item.in_b]
    both = [item for item in scope if item.both]
    comparable = [item for item in both if _rated(item.meldy)]
    answers = {item.answer for item in scope}
    today = today or datetime.now(timezone.utc).date().isoformat()
    exact, agreed = result.versus["consensus"]
    lines = [
        "# Слепая разметка: точность вердиктов Meldy",
        "",
        f"Отчёт от {today}. Цифры посчитаны только по трём файлам ниже. В скобках у долей — 95 % интервал "
        "(интервал Уилсона): при таком числе пунктов настоящая доля, скорее всего, в этих границах.",
        "",
        "| Файл | Что это | Строк | SHA-256 |",
        "| --- | --- | --- | --- |",
        f"| {_md(a.name)} | разметчик A (лист {a.sheet or '?'}, набор {a.kit or '?'}) | {a.rows} | {a.digest[:12]} |",
        f"| {_md(b.name)} | разметчик B (лист {b.sheet or '?'}, набор {b.kit or '?'}) | {b.rows} | {b.digest[:12]} |",
        f"| {_md(key.name)} | ключ: вердикты Meldy | {key.rows} | {key.digest[:12]} |",
        "",
        "## Коротко",
        "",
        f"- Пунктов в листах: {len(scope)}, ответов: {len(answers)}. Отметили оба человека: {len(both)}. "
        f"Из них с вердиктом Meldy: {len(comparable)}.",
        f"- Люди между собой: 4 варианта — {_share(Share(result.people4.agree, result.people4.n))}, "
        f"каппа {_kappa(result.people4)}.",
        f"- Люди между собой, «назван / не назван» — {_share(Share(result.people2.agree, result.people2.n))}, "
        f"каппа {_kappa(result.people2)}.",
        f"- Meldy и общий ответ людей, 4 варианта: {_share(exact)}.",
        f"- Meldy и общий ответ людей, «назван / не назван»: {_share(agreed)}.",
        f"- Ложное «назван» (строка шпаргалки стёрлась бы зря): из пунктов, которые оба человека не засчитали, "
        f"Meldy назвал {_share(result.false_named)}. Из пунктов, которые назвал Meldy, люди не засчитали "
        f"{_share(result.false_named_of_meldy)}.",
        f"- Ложное «не назван» (строка осталась бы, хотя пункт назван): из пунктов, которые оба человека засчитали, "
        f"Meldy не засчитал {_share(result.false_not_named)}. Из пунктов, которые Meldy не засчитал, люди засчитали "
        f"{_share(result.false_not_named_of_meldy)}.",
    ]
    if len(comparable) < 100:
        lines.append(f"- Пунктов для сравнения мало ({len(comparable)}): смотрите на интервалы, а не только на проценты.")
    lines += ["", "## Предупреждения", ""]
    lines += [f"- {warning}" for warning in result.warnings] or ["Предупреждений нет."]

    lines += ["", "## Что сравнивали", "", "| | A | B |", "| --- | --- | --- |"]
    per = []
    for marks in (a, b):
        counts = Counter(marks.labels.values())
        unknown = sum(len(codes) for codes in marks.unknown.values())
        per.append({
            "rows": marks.rows, "items": len(marks.labels),
            **{label: counts.get(label, 0) for label in CHOICES},
            "empty": len(marks.empty), "unknown": unknown, "repeats": len(marks.repeats), "conflicts": len(marks.conflicts),
            "bad": len(marks.bad_rows), "no_key": len(set(marks.labels) - set(key.items)),
        })
    rows = [
        ("Строк в файле", "rows"), ("Пунктов (без повторов)", "items"),
        *((f"«{WORD[label]}»", label) for label in CHOICES),
        ("Без отметки", "empty"), ("Непонятная отметка", "unknown"), ("Повтор с той же отметкой", "repeats"),
        ("Повтор с разными отметками", "conflicts"), ("Строк без кода", "bad"), ("Нет в ключе", "no_key"),
    ]
    lines += [_count_row(title, [per[0][name], per[1][name]]) for title, name in rows]
    verdicts = Counter(item.meldy for item in scope if item.in_key)
    lines += [
        "",
        f"Ключ: строк {key.rows}, пунктов {len(key.items)}; в листах из них {sum(1 for item in scope if item.in_key)}. "
        "Вердикты Meldy по пунктам листов: "
        + ", ".join(f"{WORD[label]} — {verdicts.get(label, 0)}" for label in CLASSES + (UNRATED,))
        + (f", непонятный или противоречивый — {verdicts.get(None, 0)}" if verdicts.get(None) else "") + ".",
    ]

    lines += [
        "", "## Люди между собой", "",
        "Только пункты, где оба выбрали один из четырёх вариантов («не могу решить» и пустые не входят).", "",
        "| | Пунктов | Совпало | Каппа Коэна |", "| --- | --- | --- | --- |",
        *(
            f"| {title} | {kappa.n} | {_share(Share(kappa.agree, kappa.n))} | {_kappa(kappa)} |"
            for title, kappa in (("4 варианта", result.people4), ("«назван / не назван»", result.people2))
        ),
        "", "Строки — A, столбцы — B (все пункты, которые есть в обоих файлах):", "",
    ]
    columns = list(CHOICES) + [None]
    lines.append("| A \\ B | " + " | ".join(_word(column) if column else "без отметки" for column in columns) + " | всего |")
    lines.append("| --- " * (len(columns) + 2) + "|")
    for row in columns:
        values = [result.people_matrix.get((row, column), 0) for column in columns]
        lines.append(f"| {_word(row) if row else 'без отметки'} | " + " | ".join(map(str, values)) + f" | {sum(values)} |")

    lines += [
        "", "## Meldy и люди", "",
        "«Общий ответ людей» — пункты, где A и B выбрали одно и то же. Где люди разошлись, общего ответа нет; "
        "сравнение с каждым человеком включает и спорные пункты.", "",
        "| С кем сравнивали | 4 варианта | «назван / не назван» |", "| --- | --- | --- |",
        f"| Разметчик A | {_share(result.versus['A'][0])} | {_share(result.versus['A'][1])} |",
        f"| Разметчик B | {_share(result.versus['B'][0])} | {_share(result.versus['B'][1])} |",
        f"| Общий ответ людей | {_share(exact)} | {_share(agreed)} |",
        "", "### Ложные «назван» и «не назван»", "",
        "По общему ответу людей «назван / не назван». «Не назван» здесь — всё, что не стирает строку: частично, "
        "не назван, ошибка.", "",
        "| Что считали | Доля (95 % интервал) |", "| --- | --- |",
        f"| Meldy сказал «назван», а оба человека — нет (из пунктов, которые люди не засчитали) | {_share(result.false_named)} |",
        f"| Из пунктов, которые назвал Meldy, люди не засчитали | {_share(result.false_named_of_meldy)} |",
        "| Оба человека сказали «назван», а Meldy — нет (из пунктов, которые люди засчитали) | "
        f"{_share(result.false_not_named)} |",
        f"| Из пунктов, которые Meldy не засчитал, люди засчитали | {_share(result.false_not_named_of_meldy)} |",
        "", "### Матрица ошибок: Meldy против общего ответа людей", "",
        "Строки — Meldy, столбцы — люди (пункты, где A и B выбрали одно и то же из четырёх вариантов).", "",
        "| Meldy \\ люди | " + " | ".join(WORD[label] for label in CLASSES) + " | всего |",
        "| --- " * (len(CLASSES) + 2) + "|",
    ]
    for row in CLASSES + (UNRATED, None):
        values = [result.confusion.get((row, column), 0) for column in CLASSES]
        if row in (UNRATED, None) and not any(values):
            continue
        title = WORD[row] if row else "нет в ключе или непонятно"
        lines.append(f"| {title} | " + " | ".join(map(str, values)) + f" | {sum(values)} |")
    totals = [sum(result.confusion.get((row, column), 0) for row in CLASSES + (UNRATED, None)) for column in CLASSES]
    lines.append("| всего | " + " | ".join(map(str, totals)) + f" | {sum(totals)} |")

    lines += [
        "", "## По группам", "",
        "Против общего ответа людей. Ложное «назван» — из пунктов, которые люди не засчитали; ложное «не назван» — "
        "из пунктов, которые люди засчитали.", "",
        "| Группа | 4 варианта | «назван / не назван» | Ложное «назван» | Ложное «не назван» |",
        "| --- | --- | --- | --- | --- |",
    ]
    for group in result.by_essential + result.by_input:
        if group.name == "Не указано" and not group.binary.total and not group.exact.total:
            continue
        lines.append(
            f"| {group.name} | {_share(group.exact)} | {_share(group.binary)} | {_share(group.false_named)} | "
            f"{_share(group.false_not_named)} |"
        )

    lines += ["", "## Переспросы", ""]
    if result.followups:
        total = sum(result.followups.values())
        spread = ", ".join(f"{WORD[label]} — {result.followups[label]}" for label in CLASSES if result.followups.get(label))
        lines.append(
            f"Пунктов листов с переспросом: {total} ({spread}). Вердикт переспроса не сверялся: в листах только "
            "основной ответ, а строку шпаргалки стирает только «назван» в основном ответе."
        )
    else:
        lines.append("Переспросов по пунктам листов нет.")

    lines += [
        "", "## Для разбора", "",
        "Здесь комментарии разметчиков и отрывки ответов — для владельца, не для публикации. Текст ответа — в "
        "выгрузке по коду ответа.", "",
        f"### Люди не согласны или не смогли решить ({len(result.disputes)})", "",
    ]
    if result.disputes:
        lines += ["| Ответ | Пункт | A | B | Meldy | Комментарии |", "| --- | --- | --- | --- | --- | --- |"]
        for item in result.disputes:
            lines.append(
                f"| {item.answer} | {_point(item)} | {_word(item.a)} | {_word(item.b)} | {_word(item.meldy)} | "
                f"{_comments(item)} |"
            )
    else:
        lines.append("Нет.")
    lines += [
        "", f"### Meldy не совпал с общим ответом людей ({len(result.mismatches)})", "",
        "Сначала ложные «назван», потом ложные «не назван», потом остальное.", "",
    ]
    if result.mismatches:
        lines += [
            "| Ответ | Пункт | Люди | Meldy | Отрывок, который нашёл Meldy | Комментарии |",
            "| --- | --- | --- | --- | --- | --- |",
        ]
        for item in result.mismatches:
            people = _word(item.consensus) if item.consensus else f"{_word(item.a)} / {_word(item.b)}"
            lines.append(
                f"| {item.answer} | {_point(item)} | {people} | {_word(item.meldy)} | {_md(item.meldy_quote, 100)} | "
                f"{_comments(item)} |"
            )
    else:
        lines.append("Нет.")

    lines += [
        "", "## Как считали", "",
        "- Пункт — пара «код ответа / пункт» из выгрузки. Отметки людей и вердикты Meldy сопоставлены по этой паре.",
        "- 4 варианта: назван, частично, не назван, ошибка. «Назван / не назван»: «назван» против остальных трёх — так "
        "шпаргалка решает, стирать ли строку.",
        "- Сравнивается основной вердикт Meldy (meldy_verdict). «Не оценён» у Meldy, «не могу решить» и пустые отметки "
        "людей в сравнение не входят — они перечислены выше.",
        "- Каппа Коэна — согласие с поправкой на случайные совпадения: 0 — как наугад, 1 — полное. Слова к каппе — по "
        "шкале Лэндиса и Коха. Интервал каппы приблизительный (стандартная ошибка по Коэну, 1960).",
        "- Интервал долей — 95 % интервал Уилсона. Чем меньше пунктов, тем он шире.",
        "",
    ]
    return "\n".join(lines)


def score_files(a_path: Path, b_path: Path, key_path: Path) -> Result:
    a = load_marks(read_table(Path(a_path)), "A")
    b = load_marks(read_table(Path(b_path)), "B")
    key = load_key(read_table(Path(key_path)))
    return compare(a, b, key)


# ── Командная строка ────────────────────────────────────────────────────────────


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Слепая разметка вердиктов Meldy: листы и сверка.")
    commands = parser.add_subparsers(dest="command", required=True)
    make = commands.add_parser("make", help="листы для двух разметчиков из первого запроса выгрузки")
    make.add_argument("export", help="CSV первого запроса (docs/oral-answer-texts-export.sql)")
    make.add_argument("--out", required=True, help="папка для листов")
    make.add_argument("--seed", type=int, help="число для порядка ответов (по умолчанию случайное; записывается)")
    make.add_argument("--answers", type=int, help="взять случайные N ответов (по плану 25–50)")
    make.add_argument("--force", action="store_true", help="заменить листы, которые уже есть в папке")
    score = commands.add_parser("score", help="сверка отметок двух разметчиков с ключом")
    score.add_argument("a", help="CSV разметчика A")
    score.add_argument("b", help="CSV разметчика B")
    score.add_argument("key", help="CSV второго запроса (ключ с вердиктами Meldy)")
    score.add_argument("--out", help="куда записать отчёт .md (по умолчанию — на экран)")
    args = parser.parse_args(argv)
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # консоль Windows и вывод в файл
        except (AttributeError, ValueError):
            pass

    try:
        if args.command == "make":
            made = make_kit(Path(args.export), Path(args.out), seed=args.seed, answers=args.answers, force=args.force)
            print(f"Готово: ответов {made.answers}, пунктов {made.points}, набор {made.kit} (--seed {made.seed}).")
            if made.students:
                print(f"Студентов: {made.students}; больше всего ответов у одного: {made.top_student}.")
            print("Файлы:")
            for path in made.files:
                print(f"  {path}")
            print("Первому разметчику — razmetka_A.html (и .csv), второму — razmetka_B.html (и .csv).")
            print("Ключ (второй запрос) и razmetka_kit.json оставьте у себя.")
            for note in made.notes:
                print(note)
            if made.warnings:
                print(f"Предупреждения ({len(made.warnings)}):", file=sys.stderr)
                for warning in made.warnings:
                    print(f"  - {warning}", file=sys.stderr)
            return 0
        result = score_files(Path(args.a), Path(args.b), Path(args.key))
        report = render_report(result)
        if args.out:
            Path(args.out).write_text(report, encoding="utf-8")
            print(f"Отчёт: {args.out}")
        else:
            print(report)
        if result.warnings:
            print(f"Предупреждений: {len(result.warnings)} — они в начале отчёта.", file=sys.stderr)
        return 0
    except InputError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    except OSError as exc:
        print(f"Не удалось записать файл: {exc.filename or ''} ({type(exc).__name__})", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
