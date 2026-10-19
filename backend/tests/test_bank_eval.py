"""«Дикий» корпус банков (fixtures/banks/wild, эталон truth/*.json, генератор make_wild.py) и оценка bank_eval.py.

Тест держит пол, а не совершенство: число найденных вопросов, верных текстов, вариантов, ключей и видов не ниже
достигнутого, неверных ключей (в том числе придуманных там, где в файле ключа нет) — не больше; каждый файл, который
разбирается без единой ошибки, таким и остаётся (тест на раскладку). Улучшили разбор — поднимите пол и сократите
KNOWN_IMPERFECT; опустился — что-то сломано. Полный отчёт: python backend/tests/bank_eval.py.
"""
import functools
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bank_eval  # noqa: E402

WILD = bank_eval.WILD

# Пол по итогам разбора по правилам (вопросов в корпусе — 1354: 1080 в w-файлах, 122 в отложенных h, 152 в отложенных
# h2 = k-файлах). До этапа 1 (2026-10-19) w-файлы: found 955, stem 878, options 827, key 796, kind 923, perfect 83,
# false 56, key_wrong 14; h-файлы: key 37 из 122, perfect 4 из 20; k-файлы до этапа 2: key 54 из 152, perfect 8 из 26.
# Без запаса на шум — разбор детерминирован.
EXPECTED = 1354
FLOOR = {"found": 1325, "stem": 1302, "options": 1284, "key": 1249, "kind": 1311, "perfect_files": 154}
CEILING = {"false": 61, "key_wrong": 5, "key_invented": 0}
# Файлы, которые правила пока не разбирают: вопросы, пронумерованные буквами при вариантах с цифрами, и отложенные h- и
# k-файлы, на которых видно, что правила переносятся не на всё (их раскладки нарочно не настраивались: их место — за
# разбором с ИИ и за следующим отложенным набором).
KNOWN_IMPERFECT = {
    "w007_num_letters_opts_digits",
    "h05_inline_commas_next_line_key_glued_no_spaces", "h06_filled_squares", "h09_roman_variants_key_by_variant",
    "h10_options_in_2x2_table_under_stem", "h11_markdown_hr_bullets_bold", "h12_belarusian_adkaz_lines",
    "h13_english_correct_answer_lines", "h15_stars_separated_answer_text", "h16_key_table_latin_letters_for_cyrillic",
    "h17_moodle_review_english", "h19_kahoot_like_csv_semicolon_xlsx_headers_ru", "h20_numbered_answers_section_word_values",
    "k02_csv_tab_options_in_one_cell", "k06_html_saved_quiz_checked_radios", "k14_docx_one_table_merged_stems_letter_col",
    "k17_txt_english_paren_letters_answer_key", "k18_docx_vopros_iz_online_copy", "k19_xlsx_transposed_questions_in_columns",
    "k23_docx_matching_table_answer_line", "k24_docx_true_false_boxes_on_line",
}


@functools.lru_cache(maxsize=1)
def report() -> dict:
    return bank_eval.evaluate()


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
    total = report()["total"]
    assert total["expected"] == EXPECTED
    low = {name: (total[name], floor) for name, floor in FLOOR.items() if total[name] < floor}
    high = {name: (total[name], ceiling) for name, ceiling in CEILING.items() if total[name] > ceiling}
    assert not low and not high, f"below floor {low}, above ceiling {high}"


@pytest.mark.parametrize("case_id", sorted(case["id"] for case in bank_eval.load_cases() if case["id"] not in KNOWN_IMPERFECT))
def test_every_layout_the_rules_read_stays_read_without_a_single_mistake(case_id):
    entry = next(entry for entry in report()["files"] if entry["id"] == case_id)
    assert not entry["reasons"], entry["problems"][:5] or dict(entry["reasons"])
