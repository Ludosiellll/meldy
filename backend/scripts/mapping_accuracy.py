"""Сверка разметки экзамена с эталоном команды (ворота 3 плана хакатона).

Инструмент владельца: запускается на своём компьютере, в базу ничего не пишет.
Читает вопросы экзамена через PostgREST с токеном владельца (действует RLS) и
сравнивает их покрытие с эталоном команды из CSV, который хранится вне репозитория.

    MELDY_TOKEN=<access token> SUPABASE_URL=https://<ref>.supabase.co SUPABASE_KEY=<anon key> \\
        python backend/scripts/mapping_accuracy.py <exam_id> <эталон.csv> [--json]

Токен — access_token вошедшего пользователя. В консоли открытого сайта Meldy:
    JSON.parse(localStorage.getItem('sb-<ref>-auth-token')).access_token
SUPABASE_KEY — публичный anon-ключ проекта (тот же, что у сайта).

Эталон: по строке на вопрос, «позиция;покрытие», где позиция — номер строки списка
в экзамене (exam_questions.position), покрытие — full | partial | none (можно «есть»,
«частично», «нет»). Строка-заголовок, пустые строки и строки с # пропускаются;
разделитель «;» или «,».

Что печатается (ворота 3: совпадение ≥ 80%, «есть / нет» ≥ 90%; спека «Билеты» AC4:
«есть» при эталоне «нет» — не больше одного вопроса):
- совпадение по трём классам (full / partial / none);
- совпадение «есть / нет»: full и partial — «есть», none — «нет»;
- все расхождения с текстом вопроса.
Вопрос «проверено только по словам» (unverified) или ещё не размеченный считается
расхождением: разметка не приняла решения. Ручные отметки («Отмечено вами») — решение
человека, а не разметки, поэтому в сравнение не входят и перечисляются отдельно.

Код выхода: 0 — все пороги пройдены, 1 — какой-то порог не пройден, 2 — ошибка ввода
или чтения.
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import io
import json
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

EXACT_THRESHOLD = 0.80
PRESENCE_THRESHOLD = 0.90
FALSE_FULL_LIMIT = 1

CLASSES = ("full", "partial", "none")
_WORDS = {
    "full": "full",
    "partial": "partial",
    "none": "none",
    "есть": "full",
    "полностью": "full",
    "частично": "partial",
    "нет": "none",
}
LABELS = {
    "full": "есть",
    "partial": "частично",
    "none": "нет",
    "unverified": "только по словам",
    None: "не размечен",
}


class ReferenceFileError(ValueError):
    """Эталон нельзя прочитать: текст ошибки — для владельца."""


@dataclass(frozen=True)
class MachineMark:
    """Покрытие вопроса в базе: coverage (или None) и способ (llm, lexical, manual или None)."""

    coverage: str | None
    method: str | None = None
    text: str = ""


@dataclass
class Disagreement:
    position: int
    reference: str
    machine: str | None
    text: str = ""


@dataclass
class Agreement:
    compared: int = 0
    exact: int = 0
    presence: int = 0
    false_full: int = 0
    undecided: int = 0
    manual: list[int] = field(default_factory=list)
    missing_in_exam: list[int] = field(default_factory=list)
    unreferenced: list[int] = field(default_factory=list)
    disagreements: list[Disagreement] = field(default_factory=list)

    @property
    def exact_share(self) -> float | None:
        return self.exact / self.compared if self.compared else None

    @property
    def presence_share(self) -> float | None:
        return self.presence / self.compared if self.compared else None

    def passed(self) -> bool:
        return (
            self.compared > 0
            and (self.exact_share or 0.0) >= EXACT_THRESHOLD
            and (self.presence_share or 0.0) >= PRESENCE_THRESHOLD
            and self.false_full <= FALSE_FULL_LIMIT
        )


def _has(coverage: str | None) -> bool | None:
    if coverage in ("full", "partial"):
        return True
    if coverage == "none":
        return False
    return None


def agreement(machine: dict[int, MachineMark], reference: dict[int, str]) -> Agreement:
    """Согласие разметки с эталоном по позициям вопросов.

    machine — {позиция: MachineMark}, reference — {позиция: full|partial|none}.
    Ручные отметки не сравниваются; unverified и неразмеченные — расхождения.
    """
    result = Agreement()
    for position in sorted(reference):
        expected = reference[position]
        if expected not in CLASSES:
            raise ReferenceFileError(f"Позиция {position}: неизвестное покрытие «{expected}»")
        mark = machine.get(position)
        if mark is None:
            result.missing_in_exam.append(position)
            continue
        if mark.method == "manual":
            result.manual.append(position)
            continue
        result.compared += 1
        actual = mark.coverage if mark.coverage in CLASSES else None
        if actual is None:
            result.undecided += 1
        if actual == expected:
            result.exact += 1
        if actual is not None and _has(actual) == _has(expected):
            result.presence += 1
        if actual == "full" and expected == "none":
            result.false_full += 1
        if actual != expected:
            shown = mark.coverage if mark.coverage in LABELS else None
            result.disagreements.append(Disagreement(position, expected, shown, mark.text))
    result.unreferenced = sorted(position for position in machine if position not in reference)
    return result


def parse_reference(text: str) -> dict[int, str]:
    """CSV «позиция;покрытие» → {позиция: full|partial|none}."""
    sample = text.lstrip("﻿")
    delimiter = ";" if ";" in sample else ","
    reference: dict[int, str] = {}
    for line_number, row in enumerate(csv.reader(io.StringIO(sample), delimiter=delimiter), start=1):
        cells = [cell.strip() for cell in row]
        if not cells or not any(cells) or cells[0].startswith("#"):
            continue
        if not cells[0].isdigit():
            if line_number == 1 or not reference:
                continue  # заголовок
            raise ReferenceFileError(f"Строка {line_number}: позиция «{cells[0]}» — не число")
        if len(cells) < 2:
            raise ReferenceFileError(f"Строка {line_number}: нет покрытия")
        position = int(cells[0])
        coverage = _WORDS.get(cells[1].lower())
        if coverage is None:
            raise ReferenceFileError(f"Строка {line_number}: покрытие «{cells[1]}» — ожидается full, partial или none")
        if position in reference:
            raise ReferenceFileError(f"Строка {line_number}: позиция {position} уже была")
        reference[position] = coverage
    if not reference:
        raise ReferenceFileError("В эталоне нет ни одной строки «позиция;покрытие»")
    return reference


def machine_marks(rows: list[dict]) -> tuple[dict[int, MachineMark], list[int]]:
    """Строки exam_questions → {позиция: MachineMark} и повторяющиеся позиции (берётся первая)."""
    marks: dict[int, MachineMark] = {}
    repeated: list[int] = []
    for row in rows:
        position = row.get("position")
        if not isinstance(position, int):
            continue
        if position in marks:
            repeated.append(position)
            continue
        marks[position] = MachineMark(row.get("coverage"), row.get("coverage_method"), str(row.get("text") or ""))
    return marks, sorted(set(repeated))


def _percent(value: float | None) -> str:
    return "—" if value is None else f"{value * 100:.1f}".replace(".", ",") + "%"


def report(exam: dict, result: Agreement, total: int, repeated: list[int]) -> str:
    lines = [f"Экзамен: «{exam.get('title') or 'без названия'}», вопросов: {total}, разметка от {exam.get('mapped_at') or '—'}"]
    lines.append(
        f"Сравнено вопросов: {result.compared}. Ручных отметок не учтено: {len(result.manual)}. "
        f"Без эталона: {len(result.unreferenced)}. Нет в экзамене: {len(result.missing_in_exam)}."
    )
    if result.undecided:
        lines.append(f"Без решения разметки (только по словам или не размечены): {result.undecided} — считаются расхождениями.")
    verdict = lambda ok: "пройдено" if ok else "НЕ пройдено"  # noqa: E731
    lines.append(
        f"Совпадение по трём классам: {result.exact} из {result.compared} = {_percent(result.exact_share)} "
        f"(порог {EXACT_THRESHOLD:.0%}) — {verdict((result.exact_share or 0) >= EXACT_THRESHOLD)}"
    )
    lines.append(
        f"«Есть / нет»: {result.presence} из {result.compared} = {_percent(result.presence_share)} "
        f"(порог {PRESENCE_THRESHOLD:.0%}) — {verdict((result.presence_share or 0) >= PRESENCE_THRESHOLD)}"
    )
    lines.append(
        f"«Есть» при эталоне «нет»: {result.false_full} (не больше {FALSE_FULL_LIMIT}) — "
        f"{verdict(result.false_full <= FALSE_FULL_LIMIT)}"
    )
    if repeated:
        lines.append(f"Позиции повторяются в экзамене (взята первая строка): {', '.join(map(str, repeated))}")
    if result.missing_in_exam:
        lines.append(f"Позиции эталона, которых нет в экзамене: {', '.join(map(str, result.missing_in_exam))}")
    if result.manual:
        lines.append(f"Ручные отметки (не сравнивались): {', '.join(map(str, result.manual))}")
    if result.disagreements:
        lines.append("Расхождения:")
        for item in result.disagreements:
            text = " ".join(item.text.split())
            if len(text) > 90:
                text = text[:89].rstrip() + "…"
            lines.append(f"  № {item.position}: эталон — {LABELS[item.reference]}, разметка — {LABELS.get(item.machine)}. {text}")
    else:
        lines.append("Расхождений нет.")
    return "\n".join(lines)


async def load_exam(exam_id: str, token: str) -> tuple[dict, list[dict]]:
    """Экзамен и его вопросы с токеном владельца. Только чтение."""
    from supabase_rest import SupabaseRest

    async with SupabaseRest(token) as db:
        exam = await db.select_one("exams", {"select": "id,title,mapping_state,mapped_at", "id": f"eq.{exam_id}"})
        if exam is None:
            raise LookupError("Экзамен не найден (или он чужой для этого токена)")
        rows = await db.select(
            "exam_questions",
            {
                "select": "position,text,coverage,coverage_method,mapped_at",
                "exam_id": f"eq.{exam_id}",
                "order": "position.asc,created_at.asc",
            },
        )
    return exam, rows


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Сверка разметки экзамена с эталоном команды (ворота 3).")
    parser.add_argument("exam_id", help="id экзамена (uuid)")
    parser.add_argument("reference", help="CSV эталона «позиция;full|partial|none», хранится вне репозитория")
    parser.add_argument("--json", action="store_true", help="вывести итог в JSON")
    args = parser.parse_args(argv)

    token = os.getenv("MELDY_TOKEN", "").strip()
    if not token or not os.getenv("SUPABASE_URL", "").strip() or not os.getenv("SUPABASE_KEY", "").strip():
        print("Нужны переменные окружения MELDY_TOKEN, SUPABASE_URL и SUPABASE_KEY.", file=sys.stderr)
        return 2
    try:
        reference = parse_reference(Path(args.reference).read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError) as exc:
        print(f"Не удалось прочитать эталон: {type(exc).__name__}", file=sys.stderr)
        return 2
    except ReferenceFileError as exc:
        print(f"Эталон: {exc}", file=sys.stderr)
        return 2
    try:
        exam, rows = asyncio.run(load_exam(args.exam_id, token))
    except LookupError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    except Exception as exc:  # сеть, 401, нет настроек: тексты ответа сервера не печатаем
        status = getattr(exc, "status", "")
        print(f"Не удалось прочитать экзамен: {type(exc).__name__} {status}".rstrip(), file=sys.stderr)
        return 2

    marks, repeated = machine_marks(rows)
    result = agreement(marks, reference)
    if args.json:
        print(json.dumps({
            "exam_id": exam.get("id"),
            "mapped_at": exam.get("mapped_at"),
            "questions": len(rows),
            "compared": result.compared,
            "exact": result.exact,
            "exact_share": result.exact_share,
            "presence": result.presence,
            "presence_share": result.presence_share,
            "false_full": result.false_full,
            "undecided": result.undecided,
            "manual": result.manual,
            "missing_in_exam": result.missing_in_exam,
            "unreferenced": result.unreferenced,
            "repeated_positions": repeated,
            "disagreements": [
                {"position": item.position, "reference": item.reference, "machine": item.machine} for item in result.disagreements
            ],
            "passed": result.passed(),
        }, ensure_ascii=False, indent=2))
    else:
        print(report(exam, result, len(rows), repeated))
    return 0 if result.passed() else 1


if __name__ == "__main__":
    sys.exit(main())
