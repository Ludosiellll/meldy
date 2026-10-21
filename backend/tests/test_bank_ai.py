"""Разбор сложных мест банка с ИИ (bank_ai.py, bank_markup.py): без провайдеров.

Модель здесь — подменные ответы: написанные в тесте, оракул и «шумный» оракул (bank_oracle.py) и записанные кассеты
(fixtures/banks/ai_cassettes, scripts/record_bank_ai.py). Главное, что держат тесты: ключ появляется только с
отметкой в файле, которую сервер проверил сам; текст вопроса и вариантов — дословно из строк файла; единицы
списываются до модели и возвращаются, если ни один кусок не получился; в журнал — только счётчики.
"""
import asyncio
import json
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import bank_ai  # noqa: E402
import bank_eval  # noqa: E402
import bank_markup  # noqa: E402
import bank_oracle  # noqa: E402
import bank_parse  # noqa: E402
import quota  # noqa: E402
from agents.base import AIError, BaseAgent  # noqa: E402

CASSETTES = Path(__file__).resolve().parent / "fixtures" / "banks" / "ai_cassettes"
AI_PATH = "/api/exams/parse-bank/ai"

# Вопросы, нумерованные буквами, при вариантах с цифрами: правила склеивают их (w007) — сомнительные места.
LETTERED = (
    "А. Кто написал «Войну и мир»?\n1) Достоевский\n2) **Толстой**\n3) Чехов\n"
    "Б. Самая длинная река Европы?\n1) Дунай\n2) **Волга**\n3) Рейн\n"
    "В. Сумма углов треугольника?\n1) 90°\n2) **180°**\n3) 360°\n"
)
# Файлы корпуса, которые правила отправляют модели (ai_offer.worth) — по ним проигрываются кассеты.
AI_CASES = (
    "h09_roman_variants_key_by_variant", "h10_options_in_2x2_table_under_stem", "h11_markdown_hr_bullets_bold",
    "h15_stars_separated_answer_text", "h16_key_table_latin_letters_for_cyrillic", "k06_html_saved_quiz_checked_radios",
    "k14_docx_one_table_merged_stems_letter_col", "k19_xlsx_transposed_questions_in_columns",
    "k23_docx_matching_table_answer_line", "k24_docx_true_false_boxes_on_line", "w007_num_letters_opts_digits",
    "w087_no_key_txt", "w088_key_end_upper_latin_lookalike",
)


@pytest.fixture(autouse=True)
def no_stagger(monkeypatch):
    monkeypatch.setattr(bank_ai, "STAGGER_SECONDS", 0)


def blocks_of(text: str, name: str = "bank.md"):
    return bank_ai._text_blocks(text, name)


def line_no(lines, text: str) -> int:
    return next(line.n for line in lines if line.text.strip() == text)


def scripted(answer):
    """ask, который отвечает answer(lines_of_chunk) — словарь ответа модели — и записывает, что ему прислали."""
    sent = []

    async def ask(system: str, text: str, meta: dict) -> str:
        sent.append(text)
        meta.update(model="test")
        payload = answer(bank_oracle.chunk_lines(text)) if callable(answer) else answer
        return payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False)

    ask.sent = sent
    return ask


def run(blocks, ask, **options) -> dict:
    return asyncio.run(bank_ai.hybrid(blocks, ask=ask, **options))


def lettered_answer(lines):
    """Честный ответ на LETTERED: три вопроса, ключ — жирный вариант."""
    def question(letter, stem, options, key):
        return {"n": letter, "q": [line_no(lines, stem)], "o": [line_no(lines, o) for o in options], "io": None,
                "kind": "single", "key": [key], "ev": {"type": "mark", "mark": "b"}, "answer": None}

    return {"questions": [
        question("А", "А. Кто написал «Войну и мир»?", ["1) Достоевский", "2) Толстой", "3) Чехов"], 1),
        question("Б", "Б. Самая длинная река Европы?", ["1) Дунай", "2) Волга", "3) Рейн"], 1),
        question("В", "В. Сумма углов треугольника?", ["1) 90°", "2) 180°", "3) 360°"], 1),
    ], "skip": []}


# ── Строки документа, уверенность, предложение ──────────────────────────────────


def test_markup_numbers_lines_and_shows_formatting_to_the_model():
    lines = bank_markup.markup(blocks_of(LETTERED))
    assert [line.n for line in lines] == list(range(1, 13))
    assert bank_markup.render(lines[2]) == "[3] 2) ⟨b⟩Толстой⟨/b⟩"
    fragment = bank_markup.source_lines(lines, {3})
    assert fragment == [{"n": 3, "runs": [{"t": "2) ", "m": ""}, {"t": "Толстой", "m": "b"}], "cell": None,
                         "checkbox": None, "images": 0}]


def test_the_rules_result_carries_lines_confidence_and_an_offer_with_its_price():
    result = bank_parse.parse_bank_text(LETTERED)
    first = result["items"][0]
    assert first["lines"] == [1, 5] and first["confidence"] < bank_markup.DOUBT_AT and "option_merged" in first["doubts"]
    assert result["doubtful"] == 7 and result["line_count"] == 12  # склейки и «вопросы» из одного варианта
    assert result["ai_offer"] == {"worth": True, "reasons": ["doubtful"], "questions": 7, "units": 5, "doubtful": 7}
    assert {line["n"] for line in result["source_lines"]} >= {1, 2, 3, 4, 5}


def test_confidence_names_its_reasons_and_leaves_ordinary_questions_alone():
    def item(text, options, **extra):
        return {"text": text, "options": options, "label": "1", "kind": "single" if options else "open", "flags": [],
                **extra}

    plain = item("Кто написал «Мёртвые души»?", ["Н. В. Гоголь", "А. С. Пушкин", "М. Ю. Лермонтов"])
    glued = item("Какая река течёт через Гродно?", ["Дняпро", "Нёман", "Сож Адказ: б"])
    boxes = item("Вода кипит при 100 °C.  ☒ Верно  ☐ Неверно", [])
    listed = item("Какие вещества ускоряют реакции?\n- ферменты\n- гормоны", [])
    unsure_key = item("Что такое атом?", ["частица", "волна", "поле"], flags=["key_letter_ambiguous"])
    scores = bank_markup.confidence([plain, glued, boxes, listed, unsure_key, plain, plain])
    assert scores[0] == (1.0, [])  # инициалы — не подписи вариантов
    assert "option_merged" in scores[1][1] and scores[1][0] < bank_markup.DOUBT_AT
    assert "options_in_stem" in scores[2][1] and "options_in_stem" in scores[3][1]
    assert scores[4][1] == ["key"] and scores[4][0] < bank_markup.DOUBT_AT


def test_a_file_without_doubts_offers_nothing_and_costs_nothing():
    result = bank_parse.parse_bank_text("1. Сколько будет 2 + 2?\nа) 3\nб) **4**\nв) 5\n2. Столица Франции?\nа) **Париж**\nб) Лион\n")
    assert result["ai_offer"] == {"worth": False, "reasons": [], "questions": 0, "units": 0, "doubtful": 0}


def test_the_price_is_five_units_for_each_started_hundred_questions():
    assert [bank_markup.ai_units(n) for n in (0, 1, 100, 101, 250)] == [0, 5, 5, 10, 15]
    assert bank_markup.ai_units(37) == bank_markup.ai_units(1)


# ── Ответ модели: проверка ссылок и ключей ──────────────────────────────────────


def chunk_of(text: str) -> bank_ai.Chunk:
    lines = bank_markup.markup(blocks_of(text))
    return bank_ai.make_chunks(lines, [(1, len(lines))])[0]


def test_answers_that_cite_lines_outside_the_chunk_reuse_lines_or_retell_options_are_dropped():
    chunk = chunk_of(LETTERED)
    good = {"q": [1], "o": [2, 3, 4], "kind": "single"}
    raw = json.dumps({"questions": [
        good,
        {"q": [99], "o": [6, 7], "kind": "single"},  # строки нет в куске
        {"q": [5], "o": [2, 7], "kind": "single"},  # строка 2 — уже вариант первого вопроса
        {"q": [9], "io": [{"l": 10, "t": "девяносто градусов"}], "kind": "single"},  # пересказ, а не текст строки
        {"q": [9], "o": [10, 11], "key": [7], "kind": "single"},  # ключ за пределами вариантов
    ]})
    questions, problems = bank_ai.parse_answer(raw, chunk)
    assert [q.stem for q in questions] == [[1], [9]] and questions[1].key is None
    assert dict(problems) == {"bad_stem_lines": 1, "line_reused": 1, "inline_not_in_line": 1, "key_out_of_range": 1}
    assert bank_ai.parse_answer('{"questions": [', chunk)[0] is None  # оборванный JSON
    assert bank_ai.parse_answer("```json\n" + json.dumps({"questions": [good]}) + "\n```", chunk)[0][0].stem == [1]


def build(text: str, answer: dict):
    lines = bank_markup.markup(blocks_of(text))
    chunk = bank_ai.make_chunks(lines, [(1, len(lines))])[0]
    questions, _ = bank_ai.parse_answer(json.dumps({"questions": [answer]}), chunk)
    return bank_ai.build_item(questions[0], {line.n: line for line in lines}, bank_parse.Reader())


def test_a_key_is_taken_only_with_a_mark_the_server_finds_in_the_file():
    item, flags = build(LETTERED, {"n": "А", "q": [1], "o": [2, 3, 4], "kind": "single", "key": [1],
                                   "ev": {"type": "mark", "mark": "b"}})
    assert item.text == "Кто написал «Войну и мир»?" and [o.text for o in item.options] == ["Достоевский", "Толстой", "Чехов"]
    assert item.correct == [1] and item.evidence == "bold" and flags == []
    wrong, flags = build(LETTERED, {"q": [1], "o": [2, 3, 4], "kind": "single", "key": [2], "ev": {"type": "mark", "mark": "b"}})
    assert wrong.correct == [] and flags == ["ai_key_rejected"]  # «жирный» не тот вариант
    bare, flags = build(LETTERED, {"q": [1], "o": [2, 3, 4], "kind": "single", "key": [0], "ev": None})
    assert bare.correct == [] and flags == ["ai_key_rejected"]  # ответ без доказательства — не ключ
    other_mark, flags = build(LETTERED, {"q": [1], "o": [2, 3, 4], "kind": "single", "key": [1], "ev": {"type": "mark", "mark": "u"}})
    assert other_mark.correct == [] and flags == ["ai_key_rejected"]


def test_the_model_s_number_becomes_the_label_only_when_the_question_s_lines_carry_it():
    plain = "Сколько будет два плюс два?\nтри\nчетыре\nпять\n"
    item, _ = build(plain, {"n": "8", "q": [1], "o": [2, 3, 4], "kind": "single"})
    assert item.label == ""  # «8» — строка файла в ответе модели, у вопроса номера нет
    numbered = "8. Сколько будет два плюс два?\nа) три\nб) четыре\nв) пять\n"
    item, _ = build(numbered, {"n": "8", "q": [1], "o": [2, 3, 4], "kind": "single"})
    assert item.label == "8" and item.text == "Сколько будет два плюс два?"
    lettered, _ = build(LETTERED, {"n": "А", "q": [1], "o": [2, 3, 4], "kind": "single"})
    assert lettered.label == "А"


def test_answer_lines_in_any_language_and_inline_checkboxes_are_checked_against_the_line():
    text = "1. Колькі літар у беларускім алфавіце?\nа) 32\nб) 33\nв) 36\nАдказ: а\n"
    item, flags = build(text, {"n": "1", "q": [1], "o": [2, 3, 4], "kind": "single", "key": [0],
                               "ev": {"type": "answer_line", "l": 5}})
    assert item.explicit == "а" and item.explicit_from == "answer_line" and flags == []
    cited_wrong, flags = build(text, {"q": [1], "o": [2, 3, 4], "kind": "single", "key": [0], "ev": {"type": "answer_line", "l": 2}})
    assert cited_wrong.explicit is None and flags == ["ai_key_rejected"]  # «а) 32» — не строка ответа
    boxes = "Вода кипит при 100 °C на уровне моря.  ☒ Верно  ☐ Неверно\n"
    item, flags = build(boxes, {"q": [1], "io": [{"l": 1, "t": "Верно"}, {"l": 1, "t": "Неверно"}], "kind": "truefalse",
                                "key": [0], "ev": {"type": "checkbox"}})
    assert item.text == "Вода кипит при 100 °C на уровне моря." and [o.text for o in item.options] == ["Верно", "Неверно"]
    assert item.correct == [0] and item.evidence == "checkbox" and flags == []


# ── Весь разбор: слияние с правилами ────────────────────────────────────────────


def test_the_model_mends_glued_questions_and_its_keys_come_from_the_file():
    blocks = blocks_of(LETTERED)
    ask = scripted(lambda numbers: lettered_answer(bank_markup.markup(blocks)))
    result = run(blocks, ask)
    assert [(i["text"], i["options"], i["correct"], i["source"]) for i in result["items"]] == [
        ("Кто написал «Войну и мир»?", ["Достоевский", "Толстой", "Чехов"], [1], "ai"),
        ("Самая длинная река Европы?", ["Дунай", "Волга", "Рейн"], [1], "ai"),
        ("Сумма углов треугольника?", ["90°", "180°", "360°"], [1], "ai"),
    ]
    assert result["ai"]["units"] == 5 and result["ai"]["chunks"] == 1 and result["ai"]["rejected_keys"] == 0
    assert "⟨b⟩Толстой⟨/b⟩" in ask.sent[0]  # оформление доходит до модели метками


CLEAN = "".join(f"{n}. Вопрос номер {n} про что-то важное?\nа) один\nб) **два**\nв) три\n" for n in range(1, 21))
BOXED = "21. Вода кипит при 100 °C на уровне моря.  ☒ Верно  ☐ Неверно\n"  # один сомнительный вопрос на 21


def boxed_answer(lines):
    n = line_no(lines, BOXED.strip())
    return {"n": "21", "q": [n], "io": [{"l": n, "t": "Верно"}, {"l": n, "t": "Неверно"}], "kind": "truefalse",
            "key": [0], "ev": {"type": "checkbox"}, "answer": None}


def test_only_doubtful_places_go_to_the_model_and_the_rest_stays_as_the_rules_read_it():
    blocks = blocks_of(CLEAN + BOXED)
    lines = bank_markup.markup(blocks)
    ask = scripted(lambda numbers: {"questions": [boxed_answer(lines)], "skip": []})
    result = run(blocks, ask)
    offer = bank_parse.parse_bank_text(CLEAN + BOXED)["ai_offer"]
    assert offer["worth"] is False and offer["questions"] == 2 and offer["units"] == 5  # не советуем, но можно нажать
    sent = bank_oracle.chunk_lines(ask.sent[0])
    assert min(sent) >= 77 and len(result["items"]) == 21  # модели — сомнительный вопрос и сосед, не весь файл
    assert {i["source"] for i in result["items"][:20]} == {"rules"} and "ai_disagrees" not in result["items"][0]["flags"]
    last = result["items"][20]
    assert (last["text"], last["options"], last["correct"], last["kind"], last["source"]) == (
        "Вода кипит при 100 °C на уровне моря.", ["Верно", "Неверно"], [0], "truefalse", "ai")
    assert last["evidence"] == "checkbox" and result["ai"]["units"] == 5


def test_a_confident_rules_question_wins_a_disagreement_and_keeps_the_other_version():
    blocks = blocks_of(CLEAN + BOXED)
    lines = bank_markup.markup(blocks)
    short = {"n": "1", "q": [1], "o": [2, 3], "kind": "single", "key": None, "ev": None}  # без третьего варианта
    wrong_key = {"n": "2", "q": [5], "o": [6, 7, 8], "kind": "single", "key": [0], "ev": {"type": "mark", "mark": "b"}}
    result = run(blocks, scripted(lambda numbers: {"questions": [short, wrong_key, boxed_answer(lines)] if 1 in numbers
                                                   else [boxed_answer(lines)]}), scope="all")
    first, second = result["items"][:2]
    assert first["options"] == ["один", "два", "три"] and first["source"] == "rules" and "ai_disagrees" in first["flags"]
    assert first["confidence"] >= bank_markup.DOUBT_AT and first["alt"]["source"] == "ai" and first["alt"]["options"] == ["один", "два"]
    # ключ модели не подтвердился, но тот же вариант выделен в файле: обе версии сходятся на ключе из файла
    assert second["correct"] == [1] and second["source"] == "both" and result["ai"]["rejected_keys"] == 1


def test_a_question_the_model_invents_gets_no_key_and_is_marked_as_found_by_the_model_only():
    text = "Инструкция: выберите один ответ.\nВремя: 20 минут.\nУдачи!\n" + CLEAN
    blocks = blocks_of(text)
    invented = {"n": None, "q": [1], "o": [2, 3], "kind": "single", "key": [1], "ev": {"type": "mark", "mark": "b"}}
    result = run(blocks, scripted(lambda numbers: {"questions": [invented] if 1 in numbers else []}), scope="all")
    made_up = next(i for i in result["items"] if i.get("source") == "ai")
    assert made_up["correct"] == [] and {"ai_only", "ai_key_rejected"} <= set(made_up["flags"])
    assert made_up["confidence"] < bank_markup.DOUBT_AT and result["ai"]["rejected_keys"] == 1


def test_a_broken_answer_is_asked_again_in_halves_and_a_failed_file_returns_the_units(monkeypatch):
    blocks = blocks_of(LETTERED)
    lines = bank_markup.markup(blocks)
    calls = []

    async def ask(system, text, meta):
        calls.append(len(bank_oracle.chunk_lines(text)))
        if len(calls) == 1:
            return '{"questions": [{"q": [1'  # оборван
        numbers = set(bank_oracle.chunk_lines(text))
        full = lettered_answer(lines)
        full["questions"] = [q for q in full["questions"] if set(q["q"] + q["o"]) <= numbers]
        return json.dumps(full)

    result = run(blocks, ask)
    assert len(calls) == 3 and calls[1] + calls[2] == calls[0] and result["ai"]["failed_chunks"] == 0

    class Receipt:
        def __init__(self):
            self.kept = self.refunded = False

        def keep(self):
            self.kept = True

        async def refund(self):
            self.refunded = True

    receipts = []

    async def charge(units):
        receipts.append((units, Receipt()))
        return receipts[-1][1]

    async def down(system, text, meta):
        raise AIError.busy()

    with pytest.raises(AIError):
        run(blocks, down, charge=charge)
    assert receipts[0][0] == 5 and receipts[0][1].refunded and not receipts[0][1].kept
    run(blocks, scripted(lambda numbers: lettered_answer(lines)), charge=charge)
    assert receipts[1][1].kept and not receipts[1][1].refunded


# ── Корпус: оракул, шумный оракул, кассеты ──────────────────────────────────────


def ai_report(mode: str, cassette=None) -> dict:
    cases = {case["id"]: case for case in bank_eval.load_cases()}
    out = {"rules": [], "ai": []}
    for case_id in AI_CASES:
        case = cases[case_id]
        rules, error = bank_eval.run_case(case)
        assert error is None and rules["ai_offer"]["worth"], case_id
        out["rules"].append(bank_eval.score_case(case, rules, None))
        result, error = bank_eval.run_case(case, ai=mode, cassette=cassette)
        out["ai"].append(bank_eval.score_case(case, result, error))
    return {side: {name: sum(entry[name] for entry in entries) for name in ("found", "key", "key_wrong", "key_invented", "false")}
            | {"perfect": sum(1 for entry in entries if not entry["reasons"])} for side, entries in out.items()}


@pytest.mark.parametrize("name", ["oracle", "noisy"])
def test_recorded_answers_replay_in_ci_and_never_add_a_wrong_or_invented_key(name):
    cassette = json.loads((CASSETTES / f"{name}.json").read_text(encoding="utf-8"))
    totals = ai_report("cassette", cassette)
    rules, ai = totals["rules"], totals["ai"]
    assert ai["key_invented"] == 0 and ai["key_wrong"] <= rules["key_wrong"]
    assert ai["found"] > rules["found"] and ai["key"] > rules["key"] and ai["false"] < rules["false"]
    # на 13 файлах: правила — найдено 50, ключей 30, неверных 5, ложных вопросов 61, без ошибок 2
    floor = {"oracle": {"key": 70, "perfect": 9}, "noisy": {"key": 63, "perfect": 4}}[name]
    assert ai["key"] >= floor["key"] and ai["perfect"] >= floor["perfect"], ai


def test_the_cassettes_match_the_current_prompt_and_line_markup():
    cassette = json.loads((CASSETTES / "oracle.json").read_text(encoding="utf-8"))
    cases = {case["id"]: case for case in bank_eval.load_cases()}
    case = cases["w007_num_letters_opts_digits"]
    path = bank_eval.WILD / case["file"]
    blocks, _, _ = bank_ai._blocks_of({"contents": path.read_bytes(), "name": path.name, "with_pictures": True})
    lines = bank_markup.markup(blocks)
    rules = bank_parse.finish(bank_parse.read_bank(blocks))
    spans, _ = bank_ai.plan(bank_parse.read_bank(blocks), lines, rules, "flagged")
    keys = {bank_ai.chunk_key(chunk.text) for chunk in bank_ai.make_chunks(lines, spans)}
    assert keys and keys <= set(cassette), "запрос или разметка строк изменились: запишите кассеты заново (scripts/record_bank_ai.py)"


# ── Маршрут ─────────────────────────────────────────────────────────────────────


@pytest.fixture
def api(monkeypatch):
    import main

    async def fake_user(request):
        if request.headers.get("authorization") != "Bearer token-a":
            raise HTTPException(status_code=401, detail="Требуется войти в аккаунт")
        return {"id": "user-a"}

    charges = []

    class Receipt:
        def __init__(self, units):
            self.units, self.kept, self.refunded = units, False, False

        def keep(self):
            self.kept = True

        async def refund(self):
            self.refunded = True

    async def charge(request, kind, units):
        charges.append((kind, Receipt(units)))
        return charges[-1][1]

    async def model(*args, **kwargs):
        raise AssertionError("в тестах модель не зовётся")

    monkeypatch.setattr(main, "require_authenticated_user", fake_user)
    monkeypatch.setattr(main.limiter, "enabled", False)
    monkeypatch.setattr(quota, "charge", charge)
    monkeypatch.setattr(BaseAgent, "run", model)
    client = TestClient(main.app, headers={"Authorization": "Bearer token-a"})
    client.charges = charges
    yield client


def test_the_route_charges_before_the_model_and_returns_the_merged_parse(api, monkeypatch, capsys):
    blocks = blocks_of(LETTERED)
    monkeypatch.setattr(bank_ai, "default_ask", scripted(lambda numbers: lettered_answer(bank_markup.markup(blocks))))
    response = api.post(AI_PATH, data={"text": LETTERED})
    assert response.status_code == 200, response.text
    body = response.json()
    assert [i["source"] for i in body["items"]] == ["ai", "ai", "ai"] and body["ai"]["units"] == 5
    (kind, receipt), = api.charges
    assert kind == "importAI" and receipt.units == 5 and receipt.kept and not receipt.refunded
    logged = capsys.readouterr().out
    assert "Bank AI: chunks 1" in logged and "Толстой" not in logged and "Войну" not in logged  # в журнал — только счётчики


def test_the_route_returns_units_and_a_plain_message_when_the_model_fails(api, monkeypatch):
    async def down(system, text, meta):
        raise AIError.failed()

    monkeypatch.setattr(bank_ai, "default_ask", down)
    response = api.post(AI_PATH, data={"text": LETTERED})
    assert response.status_code == 502 or response.status_code >= 500, response.text
    assert response.json() == {"detail": bank_ai.AI_FAILED_DETAIL, "code": "ai_failed"}
    (_, receipt), = api.charges
    assert receipt.refunded and not receipt.kept


def test_exact_formats_and_clean_files_are_not_sent_and_cost_nothing(api, monkeypatch):
    monkeypatch.setattr(bank_ai, "default_ask", scripted({"questions": []}))
    gift = api.post(AI_PATH, data={"text": "::Q1:: Сколько будет 2 + 2? {=4 ~3 ~5}\n"})
    assert gift.status_code == 422 and gift.json()["code"] == "no_doubts"
    clean = api.post(AI_PATH, data={"text": "1. Сколько будет 2 + 2?\nа) 3\nб) **4**\nв) 5\n"})
    assert clean.status_code == 200 and clean.json()["ai"]["chunks"] == 0
    bad_scope = api.post(AI_PATH, data={"text": LETTERED, "scope": "everything"})
    assert bad_scope.status_code == 400 and bad_scope.json()["code"] == "bad_form"
    assert api.charges == []


def test_the_route_is_mounted_and_needs_a_session(api):
    import main

    assert {(route.path, frozenset(route.methods)) for route in bank_ai.router.routes} == {(AI_PATH, frozenset({"POST"}))}
    assert main.bank_ai_router is bank_ai.router
    assert TestClient(main.app).post(AI_PATH, data={"text": LETTERED}).status_code == 401
