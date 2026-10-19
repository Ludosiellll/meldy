"""«Дикий» корпус банков (fixtures/banks/wild, эталон truth/*.json, генератор make_wild.py) и оценка bank_eval.py.

Тест держит пол, а не совершенство: число найденных вопросов, верных текстов, вариантов, ключей и видов не ниже
достигнутого, неверных ключей (в том числе придуманных там, где в файле ключа нет) — не больше. Улучшили разбор —
поднимите пол; опустился — что-то сломано. Полный отчёт: python backend/tests/bank_eval.py.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bank_eval  # noqa: E402

WILD = bank_eval.WILD

# Пол по итогам разбора (вопросов в корпусе — 1080): числа «после» выпуска с улучшениями, без запаса на шум —
# разбор детерминирован.
FLOOR = {"found": 955, "stem": 878, "options": 827, "key": 796, "kind": 923, "perfect_files": 83}
CEILING = {"false": 56, "key_wrong": 14, "key_invented": 0}


def test_corpus_is_large_varied_and_every_truth_has_its_file():
    cases = bank_eval.load_cases()
    assert len(cases) >= 80
    tags = {tag for case in cases for tag in case["tags"]}
    for family in ("num:", "opt:", "key:", "table:", "kind:", "format:", "struct:", "lang:", "text:"):
        assert sum(1 for tag in tags if tag.startswith(family)) >= 2, family
    for case in cases:
        assert (WILD / case["file"]).is_file(), case["file"]
        if case.get("key_file"):
            assert (WILD / case["key_file"]).is_file(), case["key_file"]
        assert case["questions"], case["id"]
        for q in case["questions"]:
            assert q["kind"] in ("single", "multiple", "truefalse", "open", "match", "order"), (case["id"], q["kind"])
            assert all(0 <= i < len(q["options"]) for i in q["correct"]), case["id"]
    listed = {Path(case["file"]).name for case in cases} | {Path(case["key_file"]).name for case in cases if case.get("key_file")}
    assert listed == {path.name for path in (WILD / "files").iterdir()}


def test_generator_is_committed_next_to_its_output():
    source = (WILD / "make_wild.py").read_text(encoding="utf-8")
    assert "def main()" in source and "truth" in source


def test_scorer_counts_a_perfect_parse_as_perfect_and_a_wrong_key_as_wrong():
    case = {"id": "x", "file": "x", "tags": [], "questions": [
        {"stem": "Сколько будет 2 + 2?", "options": ["3", "4"], "correct": [1], "kind": "single"},
        {"stem": "Столица Франции?", "options": [], "correct": [], "kind": "open", "answers": ["Париж"]},
    ]}
    good = {"items": [
        {"text": "Сколько будет 2 + 2?", "options": ["3", "4"], "correct": [1], "kind": "single", "answer": None, "order": [], "pairs": []},
        {"text": "Столица Франции?", "options": [], "correct": [], "kind": "open", "answer": "париж", "order": [], "pairs": []},
    ], "subjects": [], "topics": []}
    score = bank_eval.score_case(case, good, None)
    assert (score["found"], score["stem"], score["options"], score["key"], score["kind"], score["false"]) == (2, 2, 2, 2, 2, 0)
    bad = json.loads(json.dumps(good))
    bad["items"][0]["correct"] = [0]
    bad["items"].append({"text": "Страница 3 из 10", "options": [], "correct": [], "kind": "open", "answer": None})
    score = bank_eval.score_case(case, bad, None)
    assert (score["key"], score["key_wrong"], score["false"]) == (1, 1, 1)


def test_rule_parser_holds_the_floor_on_the_wild_corpus():
    total = bank_eval.evaluate()["total"]
    assert total["expected"] == 1080
    low = {name: (total[name], floor) for name, floor in FLOOR.items() if total[name] < floor}
    high = {name: (total[name], ceiling) for name, ceiling in CEILING.items() if total[name] > ceiling}
    assert not low and not high, f"below floor {low}, above ceiling {high}"
