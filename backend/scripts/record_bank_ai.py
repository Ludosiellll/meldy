"""Записать ответы модели для разбора сложных мест банка (bank_ai) на «диком» корпусе — кассету для CI.

Кассета — JSON {chunk_key: сырой ответ модели}; bank_eval.py --ai cassette --cassette <файл> и test_bank_ai.py
проигрывают её без обращения к провайдеру. Ключ куска — версия запроса (bank_ai.PROMPT_VERSION) и текст куска:
поменяли запрос или разметку строк — кассету нужно записать заново.

    python backend/scripts/record_bank_ai.py --model oracle --out backend/tests/fixtures/banks/ai_cassettes/oracle.json
    python backend/scripts/record_bank_ai.py --model live --only h --out /tmp/live.json   # нужны ключи провайдеров

oracle / noisy — подменные модели bank_oracle (без сети). live — та же модель, что у /api/exams/parse-bank/ai
(BaseAgent: Gemini, затем Groq; GEMINI_API_KEY / GROQ_API_KEY из окружения). Файлы корпуса — сгенерированные
(make_wild.py), в кассету уходит только то, что ушло бы модели: строки кусков и её ответы.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(BACKEND / "tests"))

import bank_ai  # noqa: E402
import bank_eval  # noqa: E402
import bank_markup  # noqa: E402
import bank_oracle  # noqa: E402


def recorder(ask, tape: dict):
    async def record(system: str, text: str, meta: dict) -> str:
        raw = await ask(system, text, meta)
        tape[bank_ai.chunk_key(text)] = raw
        return raw

    return record


async def record_case(case: dict, model: str, scope: str, tape: dict) -> dict:
    path = bank_eval.WILD / case["file"]
    prepared = {"contents": path.read_bytes(), "name": path.name, "with_pictures": True, "text": None}
    try:
        blocks, line_word, pictures = bank_ai._blocks_of(prepared)
    except bank_ai.BankError:
        return {}
    if model == "live":
        ask = bank_ai.default_ask
    else:
        ask = bank_oracle.make_oracle_ask(case["questions"], bank_markup.markup(blocks), noisy=model == "noisy")
    result = await bank_ai.hybrid(blocks, ask=recorder(ask, tape), line_word=line_word, pictures=pictures, scope=scope,
                                  format_mode=case.get("format", "auto"))
    return result.get("ai") or {}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--model", choices=("oracle", "noisy", "live"), default="oracle")
    parser.add_argument("--scope", choices=("flagged", "all"), default="flagged")
    parser.add_argument("--only", help="префикс id случаев (w, h, k, h05…)")
    parser.add_argument("--out", required=True, help="файл кассеты (дописывается, если уже есть)")
    args = parser.parse_args(argv)
    out = Path(args.out)
    tape = json.loads(out.read_text(encoding="utf-8")) if out.exists() else {}
    if args.model != "live":
        bank_ai.STAGGER_SECONDS = 0
    sent = 0
    for case in bank_eval.load_cases():
        if args.only and not case["id"].startswith(args.only):
            continue
        stats = asyncio.run(record_case(case, args.model, args.scope, tape))
        if stats.get("chunks"):
            sent += 1
            print(f"{case['id']}: chunks {stats['chunks']}, found {stats['found']}, rejected keys {stats['rejected_keys']}")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(tape, ensure_ascii=False, indent=0, sort_keys=True) + "\n", encoding="utf-8")
    print(f"files sent {sent}, answers {len(tape)} → {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
