"""Подменные «модели» для разбора с ИИ (bank_ai) — без провайдеров: оценка корпуса и тесты.

- oracle — модель, которая читает идеально и честно ссылается на доказательства: вопросы корпуса (truth/*.json) найдены
  в строках документа (bank_markup), ключ назван, только если в файле есть его отметка (оформление, флажок, маркер, строка
  «Ответ: …», строка ключа, ячейка ключа). Разбор с оракулом — верхняя граница конвейера: всё, что ниже, — ошибка
  конвертера, проверки или слияния, а не модели.
- noisy — оракул с типичными ошибками модели (детерминированно по тексту куска): ключ не тот, но с «доказательством»;
  ключ без доказательства; ссылка на строку вне куска; пересказ варианта; выдуманный вопрос с ключом; оборванный JSON;
  другой вид вопроса. Сервер обязан не принять ни одного выдуманного ключа.
- cassette — записанные ответы {chunk_key: ответ} (scripts/record_bank_ai.py): так CI проигрывает ответы, не обращаясь
  к провайдеру.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Optional

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import bank_ai  # noqa: E402
import bank_markup  # noqa: E402
import bank_parse  # noqa: E402
from bank_ai import SYMBOL_MARK_RE  # noqa: E402
from bank_docx import Para  # noqa: E402
from bank_parse import ANSWER_RE, FORMAT_SIGNALS, MARK_SHARE, Option, Reader, make_option, question_number  # noqa: E402

LINE_RE = re.compile(r"^\[(\d+)\] ", re.M)
MARK_BACK = {"bold": "b", "underline": "u", "italic": "i", "highlight": "hl", "shade": "shade", "color": "color"}
FENCE_STRIP = re.compile(r"^\s*(?:[+*#]\s*|☑\s*|☒\s*|\[[xXхХ]\]\s*)|\s*(?:\(\s*\+\s*\)|\((?:верно|правильно)\)|[-–—]\s*(?:верно|правильно)|✓|✔|√|\+)\s*$", re.I)


def norm(text: str) -> str:
    return " ".join((text or "").replace(" ", " ").replace("ё", "е").split()).lower()


def chunk_lines(text: str) -> list[int]:
    return [int(n) for n in LINE_RE.findall(text)]


def _option_of(line: bank_markup.MLine) -> Option:
    return make_option(Para(runs=list(line.runs), checkbox=line.checkbox, images=list(line.images)))


def _stem_line_body(text: str) -> str:
    q = question_number(text.strip())
    body = q[2] if q else text
    answer = bank_parse.STEM_ANSWER_RE.search(body)
    if answer:
        body = body[:answer.start()]
    return norm(body).rstrip(" *")


def locate(questions: list[dict], lines: list[bank_markup.MLine]) -> list[Optional[dict]]:
    """Где в строках документа каждый вопрос эталона: {stem: [n], options: [(n, text|None)], range: (first, last)}."""
    out: list[Optional[dict]] = []
    cursor = 0
    for q in questions:
        stem_parts = [norm(part) for part in q["stem"].split("\n") if part.strip()]
        if not stem_parts:
            out.append(None)
            continue
        found = None
        for i in range(cursor, len(lines)):
            body = _stem_line_body(lines[i].text)
            if body == stem_parts[0] or (len(stem_parts[0]) >= 10 and stem_parts[0] in norm(lines[i].text)) \
                    or (len(body) >= 10 and body == stem_parts[0].rstrip("?:. ")):
                found = i
                break
        if found is None:
            out.append(None)
            continue
        stem = [lines[found].n]
        if found and bank_parse.QUESTION_NUMBER_RE.match(lines[found - 1].text.strip()):
            stem.insert(0, lines[found - 1].n)  # «Вопрос 3» строкой над текстом
        j = found + 1
        for part in stem_parts[1:]:
            k = next((k for k in range(j, min(len(lines), j + 6)) if norm(lines[k].text) == part), None)
            if k is not None:
                stem.append(lines[k].n)
                j = k + 1
        options: list[tuple[int, Optional[str]]] = []
        same_line_inline = stem_parts[0] in norm(lines[found].text) and len(q["options"]) > 1 and all(
            norm(option) in norm(lines[found].text) for option in q["options"] if option)
        scan_from = found if same_line_inline else j
        for option in q["options"]:
            target = norm(option)
            hit = None
            for k in range(scan_from, min(len(lines), scan_from + 40)):
                line = lines[k]
                if line.n in stem and not same_line_inline:
                    continue
                parsed = _option_of(line)
                if not same_line_inline and target and (norm(parsed.text) == target or norm(FENCE_STRIP.sub("", parsed.text)) == target):
                    hit = (line.n, None)
                elif target and target in norm(line.text) and len(target) >= 1 and re.search(
                        r"(?:^|[\s;,(])" + re.escape(option.strip()) + r"(?=$|[\s;,.)]|\t)", line.text):
                    hit = (line.n, option.strip())
                if hit:
                    scan_from = k + (0 if hit[1] else 1)
                    break
            if hit is None and option:
                break
            if option:
                options.append(hit)
        if len(options) != len([option for option in q["options"] if option]):
            out.append(None)  # варианты в строках не нашлись: честная модель такой вопрос не называет
            cursor = found + 1
            continue
        last = max([n for n, _ in options] + stem)
        out.append({"stem": stem, "options": options, "first": lines[found].n, "last": last})
        last_index = next(k for k, line in enumerate(lines) if line.n == last)
        cursor = last_index + (0 if any(text for _, text in options) else 1)
    return out


def _evidence(q: dict, spot: dict, lines: list[bank_markup.MLine], label: str,
              next_first: Optional[int] = None) -> tuple[Optional[list[int]], Optional[dict], Optional[str]]:
    """(ключ, доказательство, ответ) — только то, что в файле действительно отмечено. next_first — первая строка
    следующего вопроса: строка «Ответ: …» ищется до неё."""
    by_n = {line.n: line for line in lines}
    following = [line for line in lines if line.n > spot.get("last", spot["first"])]
    own = [line for line in following if next_first is None or line.n < next_first]
    if q["kind"] in ("single", "multiple", "truefalse") and q["correct"] and spot.get("options"):
        built = bank_ai.line_options(by_n, spot["options"])
        key = sorted(q["correct"])
        for signal in FORMAT_SIGNALS:
            marked = [k for k, option in enumerate(built) if option.share(signal) >= MARK_SHARE]
            if marked == key and len(marked) < len(built):
                return key, {"type": "mark", "mark": MARK_BACK[signal]}, None
        checked = [k for k, option in enumerate(built) if option.checkbox]
        if checked == key and len(checked) < len(built):
            return key, {"type": "checkbox"}, None
        raws = [getattr(option, "raw", option.text) for option in built]
        marked = [k for k, raw in enumerate(raws) if SYMBOL_MARK_RE.search(raw)]
        if marked == key and len(marked) < len(raws):
            return key, {"type": "marker"}, None
    for line in own[:12]:
        if ANSWER_RE.match(line.text.strip()):
            return (sorted(q["correct"]) or None), {"type": "answer_line", "l": line.n}, ANSWER_RE.match(line.text.strip()).group(1)
    if label:
        for line in following:
            value = bank_ai._cited_value("key_row", line.text, label)
            if value:
                return (sorted(q["correct"]) or None), {"type": "key_row", "l": line.n}, value
    return None, None, None


def oracle_document(questions: list[dict], lines: list[bank_markup.MLine]) -> list[Optional[dict]]:
    """Ответы оракула по каждому вопросу эталона (None — вопрос в строках не найден)."""
    spots = locate(questions, lines)
    by_n = {line.n: line for line in lines}
    out: list[Optional[dict]] = []
    firsts = [spot["first"] if spot else None for spot in spots]
    for index, (q, spot) in enumerate(zip(questions, spots)):
        if spot is None:
            out.append(None)
            continue
        next_first = next((first for first in firsts[index + 1:] if first is not None), None)
        first_text = by_n[spot["stem"][0]].text.strip()
        number = question_number(first_text)
        alone = bank_parse.QUESTION_NUMBER_RE.match(first_text)
        label = (alone.group(1) if alone else number[0] if number else "")
        lettered = re.match(r"^([А-ЯЁA-Z])[.)]\s+", first_text)
        if not label and lettered and not norm(q["stem"]).startswith(norm(lettered.group(0))):
            label = lettered.group(1)  # «Б. Какая …» — номер буквой
        key, ev, answer = _evidence(q, spot, lines, label, next_first)
        entry = {"n": label or None, "q": spot["stem"], "kind": q["kind"], "key": key if q["kind"] != "open" else None, "ev": ev,
                 "answer": answer if q["kind"] in ("open", "match", "order") else None}
        options = spot.get("options") or []
        whole = [n for n, text in options if text is None]
        inline = [{"l": n, "t": text} for n, text in options if text is not None]
        entry["o"] = whole if whole and not inline else None
        entry["io"] = inline if inline else None
        if whole and inline:
            entry["io"] = [{"l": n, "t": text if text is not None else by_n[n].text.strip()} for n, text in options]
        if q["kind"] == "order" and ev is not None:
            entry["key"] = q.get("order") or None
        out.append(entry)
    return out


def make_oracle_ask(questions: list[dict], lines: list[bank_markup.MLine], noisy: bool = False):
    """ask(system, text, meta) для bank_ai.hybrid: вопросы эталона, первая строка которых — в куске."""
    answers = oracle_document(questions, lines)

    async def ask(system: str, text: str, meta: dict) -> str:
        numbers = set(chunk_lines(text))
        picked = []
        for answer in answers:
            if answer is None or answer["q"][0] not in numbers:
                continue
            cited = set(answer["q"]) | set(answer["o"] or []) | {piece["l"] for piece in answer["io"] or []}
            if cited <= numbers:
                picked.append(dict(answer))
        payload = {"questions": picked, "skip": []}
        if noisy:
            return perturb(payload, text, numbers)
        meta.update(model="oracle")
        return json.dumps(payload, ensure_ascii=False)

    return ask


def _rng(text: str, salt: str) -> int:
    return int(hashlib.sha256(f"{salt}|{text}".encode("utf-8")).hexdigest()[:8], 16)


def perturb(payload: dict, text: str, numbers: set[int]) -> str:
    """Оракул с ошибками модели. Решения — по хешу текста куска: повторяемо в CI."""
    questions = payload["questions"]
    if _rng(text, "truncate") % 10 == 0 and len(numbers) > 3:
        return json.dumps(payload, ensure_ascii=False)[: max(10, len(json.dumps(payload)) // 2)]  # обрыв ответа
    for k, q in enumerate(questions):
        roll = _rng(text, f"q{k}") % 100
        option_count = len(q["o"] or []) + len(q["io"] or [])
        if roll < 15 and option_count >= 2 and q.get("key"):
            q["key"] = [(q["key"][0] + 1) % option_count]  # не тот вариант, «доказательство» прежнее
        elif roll < 25 and option_count >= 2:
            q["key"], q["ev"] = [0], None  # ключ без доказательства
        elif roll < 32:
            q["q"] = q["q"] + [max(numbers) + 50]  # строка вне куска
        elif roll < 40 and q["io"]:
            q["io"][0]["t"] = q["io"][0]["t"] + " примерно"  # пересказ варианта
        elif roll < 45:
            q["kind"] = "open" if q["kind"] != "open" else "single"
    if _rng(text, "invent") % 5 == 0:
        free = sorted(numbers - {n for q in questions for n in q["q"] + (q["o"] or []) + [p["l"] for p in q["io"] or []]})
        if len(free) >= 3:
            questions.append({"n": None, "q": [free[0]], "o": free[1:3], "kind": "single", "key": [1],
                              "ev": {"type": "mark", "mark": "b"}, "answer": None})  # выдуманный вопрос с «жирным» ключом
    return json.dumps(payload, ensure_ascii=False)


def make_cassette_ask(cassette: dict):
    async def ask(system: str, text: str, meta: dict) -> str:
        key = bank_ai.chunk_key(text)
        if key not in cassette:
            from agents.base import AIError

            raise AIError.failed()
        meta.update(model="cassette")
        return cassette[key]

    return ask
