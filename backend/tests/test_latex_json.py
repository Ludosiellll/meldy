r"""LaTeX in model JSON: commands written with one backslash survive json.loads (finding LIB-2).

The model writes `$\text{COUNT}$` into a JSON string as `"$\text{COUNT}$"`: json.loads read `\t`
as a TAB and the summary showed «extCOUNT»; `\frac`, `\beta`, `\rho`, `\neq` broke the same way,
and `\alpha` or `\sum` made the whole answer unreadable. Real newlines, TABs in code and valid
JSON must stay as they are.
"""
import json
import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agents.base import parse_model_json  # noqa: E402
from utils import parse_llm_json, repair_latex_escapes  # noqa: E402

TAB, FF, BS, CR = "\t", "\f", "\b", "\r"

# A summarizer answer as Gemini returned it for the SQL lecture (single backslashes, real \n escapes).
SUMMARY_RAW = (
    r'{"title": "Язык SQL", "subject": "Базы данных", '
    r'"content": "## Агрегатные функции\n\nДля подсчёта используются функции ($\text{COUNT}$, $\text{SUM}$, '
    r'$\text{AVG}$). Доля строк — $\frac{n}{N}$, коэффициент $\beta$, плотность $\rho$, '
    r'условие $a \neq b$, градиент $\nabla f$, частота $\nu$, $\forall x$, $\bar{x}$, $\theta$, $\tau$.\n\n'
    r'$$\left( \sum_{i=1}^{n} x_i \right) \times \frac{1}{n}$$\n\n- пункт один\n- пункт два", '
    r'"terms": [{"term": "COUNT", "definition": "Считает строки: $\text{COUNT}(*)$"}]}'
)


def test_a_summary_with_single_backslash_latex_keeps_every_command():
    parsed = parse_model_json(SUMMARY_RAW)
    content = parsed["content"]
    for command in (r"\text{COUNT}", r"\text{SUM}", r"\text{AVG}", r"\frac{n}{N}", r"\beta", r"\rho", r"a \neq b",
                    r"\nabla f", r"\nu", r"\forall x", r"\bar{x}", r"\theta", r"\tau", r"\left(", r"\sum_{i=1}",
                    r"\right)", r"\times", r"\frac{1}{n}"):
        assert command in content, command
    # No control characters were made out of the commands.
    for control in (TAB, FF, BS, CR):
        assert control not in content
    # The real line breaks of the Markdown are still line breaks.
    assert content.startswith("## Агрегатные функции\n\nДля подсчёта")
    assert "\n\n- пункт один\n- пункт два" in content
    assert parsed["terms"][0]["definition"] == r"Считает строки: $\text{COUNT}(*)$"


def test_cards_and_a_test_with_latex_and_line_breaks():
    cards = r'{"flashcards": [{"id": 1, "question": "Как найти скорость?", "answer": "По формуле $v = \frac{s}{t}$.\nЕдиницы: $\text{м/с}$."}, {"id": 2, "question": "Что такое $\binom{n}{k}$?", "answer": "Число сочетаний: $\binom{n}{k} = \frac{n!}{k!(n-k)!}$"}]}'
    parsed = parse_model_json(cards)
    assert parsed["flashcards"][0]["answer"] == "По формуле $v = \\frac{s}{t}$.\nЕдиницы: $\\text{м/с}$."
    assert parsed["flashcards"][1]["question"] == r"Что такое $\binom{n}{k}$?"
    assert r"\binom{n}{k} = \frac{n!}{k!(n-k)!}" in parsed["flashcards"][1]["answer"]

    quiz = r'{"quiz": [{"id": 1, "question": "Чему равно $\tan 45^\circ$?", "options": ["A) $1$", "B) $0$", "C) $\infty$", "D) $\sqrt{2}$"], "correct": "A", "explanation": "$\tan 45^\circ = 1$, так как $\sin = \cos$."}]}'
    question = parse_model_json(quiz)["quiz"][0]
    assert question["question"] == r"Чему равно $\tan 45^\circ$?"
    assert question["options"][2:] == [r"C) $\infty$", r"D) $\sqrt{2}$"]
    assert question["explanation"].startswith(r"$\tan 45^\circ = 1$")


def test_a_podcast_formula_without_dollars_keeps_its_commands():
    raw = r'{"podcast": [{"speaker": "Софья", "text": "Скорость — это путь за время.", "visual": {"type": "formula", "title": "Скорость", "latex": "v = \frac{s}{t} \times \beta \rightarrow \theta", "legend": [{"symbol": "v", "meaning": "скорость"}]}}]}'
    visual = parse_model_json(raw)["podcast"][0]["visual"]
    assert visual["latex"] == r"v = \frac{s}{t} \times \beta \rightarrow \theta"


def test_backslashes_json_does_not_know_no_longer_lose_the_answer():
    # «\alpha», «\sum», «\(», «\%» are not JSON escapes: json.loads refused the answer and the fallback cut it.
    raw = r'{"content": "Угол $\alpha$, сумма $\sum_i x_i$, процент $5\%$, скобки \(x\), точка $a \cdot b$, корень $\sqrt{x}$.", "terms": []}'
    parsed = parse_model_json(raw)
    assert parsed["content"] == r"Угол $\alpha$, сумма $\sum_i x_i$, процент $5\%$, скобки \(x\), точка $a \cdot b$, корень $\sqrt{x}$."
    # Upper-case commands are not JSON escapes either.
    assert parse_model_json(r'{"a": "$\Rightarrow \Delta \Theta \Bigl($"}') == {"a": r"$\Rightarrow \Delta \Theta \Bigl($"}


def test_real_escapes_and_valid_json_stay_as_they_are():
    value = {
        "content": "## Тема\n\nТекст.\n- пункт\n\tкод с табуляцией\r\nстрока Windows",
        "code": "def f():\n\treturn x\n\tif y:\n\t\tpass",
        "quote": "Он сказал: \"нет\" / \\ обратная черта",
        "latex": "$\\frac{a}{b}$ и $\\text{COUNT}$ уже экранированы",
        "unicode": "caf\u00e9 \u0436",
        "newline_words": "строка\nnot a command\nnumber\ntext\nequation\nablative\ntoday\ntimes",
    }
    raw = json.dumps(value, ensure_ascii=True)
    assert repair_latex_escapes(raw) == raw
    assert parse_model_json(raw) == value
    assert parse_model_json(json.dumps(value, ensure_ascii=False)) == value


def test_a_new_line_that_starts_with_letters_of_a_command_name():
    # «\nu» could be ν or a new line with «u»: only the exact names count, and \ne only inside $…$.
    assert parse_model_json(r'{"a": "Пункты:\ne) пятый\ni) римский"}') == {"a": "Пункты:\ne) пятый\ni) римский"}
    assert parse_model_json(r'{"a": "$a \ne b$ и $x \ni A$"}') == {"a": r"$a \ne b$ и $x \ni A$"}
    # Display math on its own lines: the new line after $$ stays a new line.
    assert parse_model_json(r'{"a": "$$\ne^{i\pi} + 1 = 0\n$$"}') == {"a": "$$\ne^{i\\pi} + 1 = 0\n$$"}
    # TAB before plain words stays a TAB; \to, \times are commands.
    assert parse_model_json(r'{"a": "имя\tзначение\tone", "b": "$x \to \infty$"}') == {"a": "имя\tзначение\tone", "b": r"$x \to \infty$"}


def test_fenced_and_prose_wrapped_answers_keep_latex_too():
    fenced = "```json\n" + r'{"content": "$\text{SUM}$ и $\frac{1}{2}$"}' + "\n```"
    assert parse_model_json(fenced) == {"content": r"$\text{SUM}$ и $\frac{1}{2}$"}
    prose = 'Вот ответ:\n' + r'{"content": "$\text{MAX}$ и $\beta$"}' + '\nГотово.'
    assert parse_model_json(prose) == {"content": r"$\text{MAX}$ и $\beta$"}
    assert parse_llm_json(prose) == {"content": r"$\text{MAX}$ и $\beta$"}


def test_a_cut_off_answer_is_still_repaired_and_closed():
    raw = r'{"flashcards": [{"id": 1, "question": "Формула?", "answer": "$\frac{a}{b}$"}, {"id": 2, "question": "Ещё $\text{CO'
    parsed = parse_model_json(raw)
    assert parsed["flashcards"][0]["answer"] == r"$\frac{a}{b}$"


def test_backslashes_outside_strings_and_escaped_dollars():
    assert repair_latex_escapes('{"a": 1}') == '{"a": 1}'
    # LaTeX's dollar sign (\\$ in JSON) is not the edge of a formula: \ne after it is outside $…$.
    assert parse_model_json(r'{"a": "цена \\$5\ne"}') == {"a": "цена \\$5\ne"}
    # An escaped quote inside a formula does not end the string.
    assert parse_model_json(r'{"a": "$\text{\"x\"}$"}') == {"a": r'$\text{"x"}$'}


@pytest.mark.parametrize("size", [200_000])
def test_repair_is_linear(size):
    plain = '{"content": "' + "слово " * (size // 6) + '"}'
    heavy = '{"content": "' + r"$\frac{a}{b}$ " * (size // 14) + '"}'
    started = time.perf_counter()
    assert repair_latex_escapes(plain) == plain
    repaired = repair_latex_escapes(heavy)
    assert json.loads(repaired)["content"].startswith(r"$\frac{a}{b}$ ")
    assert time.perf_counter() - started < 1.0
