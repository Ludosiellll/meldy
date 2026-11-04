"""Подбор ключей с ИИ (bank_keys_ai.py): без провайдеров.

Модель здесь — подменные ответы, написанные в тесте: «знающая» модель отвечает по текстам верных вариантов, где бы они
ни стояли, «слепая» — по месту. Главное, что держат тесты: ключ — только когда два независимых ответа совпали и оба
«уверен»; перемешанные варианты переводятся обратно в номера вопроса; одиночный вопрос — ровно один номер, множественный —
не все; негодный ответ спрашивается ещё раз половинками; единицы списываются до модели и возвращаются, если ответа нет;
в журнал — только счётчики.
"""
import asyncio
import json
import re
import sys
from pathlib import Path

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import bank_keys_ai  # noqa: E402
import plans  # noqa: E402
import quota  # noqa: E402
from agents import base as ai_base  # noqa: E402
from agents.base import AIError, BaseAgent  # noqa: E402
from bank_keys_ai import Provider  # noqa: E402
from ratelimit import RATE_LIMIT_DETAIL, limiter, user_or_ip_key  # noqa: E402

PATH = "/api/exams/keys/ai"

QUESTIONS = [
    {"id": "q1", "text": "Столица России?", "options": ["Казань", "Москва", "Самара", "Пермь"], "kind": "single"},
    {"id": "q2", "text": "Какие из чисел простые?", "options": ["2", "4", "7", "9"], "kind": "multiple"},
    {"id": "q3", "text": "Сколько будет 2 + 2?", "options": ["3", "4", "5"], "kind": "single"},
]
RIGHT = {"Столица России?": {"Москва"}, "Какие из чисел простые?": {"2", "7"}, "Сколько будет 2 + 2?": {"4"}}
SUBJECT = "Общая подготовка"
SECRET_WORDS = ("Столица", "Москва", "Казань", "простые", "Общая подготовка")


@pytest.fixture(autouse=True)
def no_stagger(monkeypatch):
    monkeypatch.setattr(bank_keys_ai, "STAGGER_SECONDS", 0)


# ── Подменная модель ────────────────────────────────────────────────────────────


def parse_prompt(text: str) -> tuple:
    """(предмет, вопросы) из текста запроса: {n, kind, text, options} — варианты в порядке показа."""
    subject, questions, mode = None, [], None
    for line in text.split("\n"):
        head = re.match(r"^Вопрос (\d+)\. (Один верный ответ|Несколько верных ответов)\.$", line)
        if head:
            kind = "single" if head.group(2).startswith("Один") else "multiple"
            questions.append({"n": int(head.group(1)), "kind": kind, "lines": [], "options": []})
            mode = "text"
        elif line.startswith("Предмет: ") and not questions:
            subject = line[len("Предмет: "):]
        elif line == "Варианты:":
            mode = "options"
        elif line and mode == "options":
            option = re.match(r"^(\d+)\) (.*)$", line)
            assert option and int(option.group(1)) == len(questions[-1]["options"]) + 1
            questions[-1]["options"].append(option.group(2))
        elif line and mode == "text":
            questions[-1]["lines"].append(line)
    for question in questions:
        question["text"] = "\n".join(question.pop("lines"))
    return subject, questions


def model(decide):
    """ask: decide(вопрос) → (тексты выбранных вариантов, «уверен» | «не уверен»), готовая запись ответа (dict) или None
    (вопрос пропущен). ask.sent — присланные тексты."""
    sent = []

    async def ask(system: str, text: str, meta: dict) -> str:
        sent.append(text)
        meta.update(model="test")
        _, questions = parse_prompt(text)
        answers = []
        for question in questions:
            decision = decide(question)
            if decision is None:
                continue
            if isinstance(decision, dict):
                answers.append({"n": question["n"], **decision})
                continue
            picked, sure = decision
            answers.append({"n": question["n"], "pick": [k + 1 for k, o in enumerate(question["options"]) if o in picked],
                            "sure": sure})
        return json.dumps({"answers": answers}, ensure_ascii=False)

    ask.sent = sent
    return ask


def knowing(question):
    return RIGHT[question["text"]], "уверен"


def first_place(question):
    """«Слепая» модель: всегда первый вариант, уверенно."""
    return {question["options"][0]}, "уверен"


def questions_of(body: dict):
    return bank_keys_ai.validate(body)


def run(questions, providers, subject=None, **options) -> dict:
    return asyncio.run(bank_keys_ai.suggest(subject, questions, providers=providers, **options))


def two(first, second):
    return [Provider("gemini", first), Provider("groq", second)]


def by_id(result: dict) -> dict:
    return {entry["id"]: entry for entry in result["results"]}


# ── Проверка запроса ────────────────────────────────────────────────────────────


def question(**changes):
    return {**QUESTIONS[0], **changes}


BAD_BODIES = [
    ("[]", None),
    ('{"questions": []}', bank_keys_ai.COUNT_DETAIL),
    (json.dumps({"questions": [question(id=f"q{k}") for k in range(301)]}), bank_keys_ai.COUNT_DETAIL),
    (json.dumps({"questions": [question()], "extra": 1}), None),
    (json.dumps({"subject": 5, "questions": [question()]}), None),
    (json.dumps({"subject": "а" * 201, "questions": [question()]}), bank_keys_ai.SUBJECT_DETAIL),
    (json.dumps({"questions": "q1"}), None),
    (json.dumps({"questions": [{"id": "q1", "text": "Т?", "options": ["а", "б"]}]}), None),
    (json.dumps({"questions": [question(image="x.png")]}), None),
    (json.dumps({"questions": [question(id="q 1")]}), None),
    (json.dumps({"questions": [question(id="q1\n")]}), None),
    (json.dumps({"questions": [question(id="ю1")]}), None),
    (json.dumps({"questions": [question(id="a" * 65)]}), None),
    (json.dumps({"questions": [question(id=7)]}), None),
    (json.dumps({"questions": [question(), question()]}), None),
    (json.dumps({"questions": [question(kind="open")]}), None),
    (json.dumps({"questions": [question(text=None)]}), None),
    (json.dumps({"questions": [question(text="   ")]}), "Вопрос 1: нет текста вопроса."),
    (json.dumps({"questions": [question(id="a"), question(id="b", text="я" * 2001)]}), "Вопрос 2: текст длиннее 2000 знаков."),
    (json.dumps({"questions": [question(options=["один"])]}), "Вопрос 1: нужно от 2 до 10 вариантов ответа."),
    (json.dumps({"questions": [question(options=[str(k) for k in range(11)])]}), "Вопрос 1: нужно от 2 до 10 вариантов ответа."),
    (json.dumps({"questions": [question(options="а, б")]}), None),
    (json.dumps({"questions": [question(options=["а", 2])]}), None),
    (json.dumps({"questions": [question(options=["а", " "])]}), "Вопрос 1: пустой вариант ответа."),
    (json.dumps({"questions": [question(options=["а", "б" * 501])]}), "Вопрос 1: вариант ответа длиннее 500 знаков."),
]


@pytest.mark.parametrize("raw,detail", BAD_BODIES)
def test_anything_off_the_contract_is_a_422_in_plain_russian_and_costs_nothing(api, raw, detail):
    response = api.post(PATH, content=raw.encode("utf-8"), headers={"content-type": "application/json"})
    assert response.status_code == 422, response.text
    body = response.json()
    assert body["code"] == "bad_request" and body["detail"] == (detail or bank_keys_ai.BAD_BODY_DETAIL)
    assert re.search("[а-яё]", body["detail"], re.I) and not re.search("[A-Za-z]", body["detail"])
    assert api.charges == [] and api.asked == []


def test_broken_json_and_a_huge_body_are_refused_before_anything_else(api, monkeypatch):
    broken = api.post(PATH, content=b'{"questions": [', headers={"content-type": "application/json"})
    assert broken.status_code == 422 and broken.json() == {"detail": bank_keys_ai.BAD_BODY_DETAIL, "code": "bad_request"}
    monkeypatch.setattr(bank_keys_ai, "MAX_BODY_BYTES", 100)
    huge = api.post(PATH, json={"questions": QUESTIONS})
    assert huge.status_code == 413 and huge.json() == {"detail": bank_keys_ai.TOO_BIG_DETAIL, "code": "too_big"}
    assert api.charges == [] and api.asked == []


def test_the_limits_themselves_are_accepted():
    body = {"subject": None, "questions": [
        {"id": "a" * 64, "text": "я" * 2000, "options": ["в" * 500] * 10, "kind": "multiple"},
        {"id": "Q_1:2.3-x", "text": " Да? ", "options": ["Да", "Нет"], "kind": "single"},
    ] + [{"id": f"n{k}", "text": "Т?", "options": ["а", "б"], "kind": "single"} for k in range(298)]}
    subject, questions = bank_keys_ai.validate(body)
    assert subject is None and len(questions) == 300 and questions[1].text == "Да?"
    assert bank_keys_ai.validate({"subject": "  ", "questions": QUESTIONS})[0] is None
    assert bank_keys_ai.validate({"questions": QUESTIONS})[0] is None


# ── Два ответа: ключ только при согласии ────────────────────────────────────────


def test_two_providers_that_agree_give_the_key_and_see_only_the_question_text_options_and_subject():
    subject, questions = questions_of({"subject": SUBJECT, "questions": QUESTIONS})
    first, second = model(knowing), model(knowing)
    result = run(questions, two(first, second), subject=subject)
    assert result["units"] == 5 and result["spent_questions"] == 3
    assert result["results"] == [
        {"id": "q1", "correct": [1], "agree": True, "sure": "high"},
        {"id": "q2", "correct": [0, 2], "agree": True, "sure": "high"},
        {"id": "q3", "correct": [1], "agree": True, "sure": "high"},
    ]
    assert len(first.sent) == len(second.sent) == 1
    for text in first.sent + second.sent:
        sent_subject, sent = parse_prompt(text)
        assert sent_subject == SUBJECT
        assert [(q["text"], q["options"], q["kind"]) for q in sent] == [(q["text"], q["options"], q["kind"]) for q in QUESTIONS]
        assert not any(q["id"] in text for q in QUESTIONS)  # id клиента модели не нужны
    assert first.sent == second.sent  # два провайдера видят варианты в порядке файла


def test_answers_that_disagree_or_doubt_give_no_key_and_say_why():
    _, questions = questions_of({"questions": QUESTIONS})

    def doubtful(q):
        if q["text"] == "Сколько будет 2 + 2?":
            return RIGHT[q["text"]], "не уверен"
        return knowing(q)

    result = by_id(run(questions, two(model(knowing), model(first_place))))
    assert result["q1"] == {"id": "q1", "correct": None, "agree": False, "sure": "low", "note": "ответы ИИ разошлись"}
    assert result["q2"]["correct"] is None and result["q2"]["note"] == bank_keys_ai.NOTE_SPLIT

    result = by_id(run(questions, two(model(knowing), model(doubtful))))
    assert result["q1"]["sure"] == "high" and result["q2"]["sure"] == "high"
    assert result["q3"] == {"id": "q3", "correct": None, "agree": True, "sure": "low", "note": "ИИ не уверен"}

    shrug = model(lambda q: {"pick": [], "sure": "не уверен"})
    assert by_id(run(questions, two(shrug, model(knowing))))["q1"] == {
        "id": "q1", "correct": None, "agree": False, "sure": "low", "note": "ИИ не уверен"}


def test_a_missing_or_malformed_answer_is_no_key_with_sure_none():
    _, questions = questions_of({"questions": QUESTIONS})

    def odd(q):
        return {"q1": None, "q2": {"pick": [9], "sure": "уверен"}, "q3": {"pick": [2], "sure": "наверное"}}[
            next(item["id"] for item in QUESTIONS if item["text"] == q["text"])]

    result = run(questions, two(model(knowing), model(odd)))
    assert [(r["correct"], r["agree"], r["sure"], r["note"]) for r in result["results"]] == \
        [(None, False, "none", bank_keys_ai.NOTE_NO_ANSWER)] * 3


# ── Один провайдер: второй раз варианты перемешаны ──────────────────────────────


def test_one_provider_is_asked_twice_with_shuffled_options_and_the_answer_maps_back():
    body = {"questions": QUESTIONS + [
        {"id": "q4", "text": "Какой орган отвечает за зрение?", "options": ["Печень", "Глаз", "Ухо", "Все перечисленные"],
         "kind": "single"},
    ]}
    RIGHT["Какой орган отвечает за зрение?"] = {"Глаз"}
    try:
        _, questions = questions_of(body)
        ask = model(knowing)
        result = by_id(run(questions, [Provider("gemini", ask)]))
    finally:
        RIGHT.pop("Какой орган отвечает за зрение?")
    assert result["q1"] == {"id": "q1", "correct": [1], "agree": True, "sure": "high"}
    assert result["q2"]["correct"] == [0, 2] and result["q3"]["correct"] == [1] and result["q4"]["correct"] == [1]
    plain, shuffled = (parse_prompt(text)[1] for text in ask.sent)
    for before, after in zip(plain, shuffled):
        assert sorted(after["options"]) == sorted(before["options"])
        moved = [k for k, option in enumerate(before["options"]) if not bank_keys_ai.STAYS_RE.search(option)]
        assert all(after["options"][k] != before["options"][k] for k in moved)  # ни один не на своём месте
    assert shuffled[3]["options"][3] == "Все перечисленные"  # «все перечисленные» — на своём месте


def test_a_position_biased_single_provider_is_caught_by_the_shuffle():
    _, questions = questions_of({"questions": QUESTIONS})
    result = run(questions, [Provider("gemini", model(first_place))])
    assert all(r["correct"] is None and r["sure"] == "low" for r in result["results"])


def test_options_that_point_at_other_options_are_not_shuffled_and_get_no_key_from_one_provider():
    item = {"id": "r", "text": "Что верно?", "options": ["Земля круглая", "Луна — звезда", "а и б"], "kind": "single"}
    _, questions = questions_of({"questions": [item]})
    assert bank_keys_ai.shuffled_order(questions[0]) == (0, 1, 2)
    picks = model(lambda q: ({"Земля круглая"}, "уверен"))
    assert run(questions, [Provider("gemini", picks)])["results"] == [
        {"id": "r", "correct": None, "agree": True, "sure": "low", "note": bank_keys_ai.NOTE_UNCHECKED}]
    # два провайдера — проверка независима и без перестановки
    assert run(questions, two(picks, picks))["results"][0]["correct"] == [0]


def test_the_shuffle_is_stable_and_a_two_option_question_is_swapped():
    _, questions = questions_of({"questions": [
        {"id": "t", "text": "Вода кипит при 100 °C?", "options": ["Верно", "Неверно"], "kind": "single"}] + QUESTIONS})
    assert bank_keys_ai.shuffled_order(questions[0]) == (1, 0)
    for q in questions:
        order = bank_keys_ai.shuffled_order(q)
        assert order == bank_keys_ai.shuffled_order(q) and sorted(order) == list(range(len(q.options)))
        assert all(order[k] != k for k in range(len(order)))


def test_a_failed_provider_is_replaced_by_the_other_one_with_shuffled_options():
    _, questions = questions_of({"questions": QUESTIONS})
    good = model(knowing)

    async def down(system, text, meta):
        raise AIError.busy()

    result = run(questions, two(good, down))
    assert all(r["sure"] == "high" for r in result["results"])
    assert len(good.sent) == 2 and parse_prompt(good.sent[0])[1] != parse_prompt(good.sent[1])[1]
    result = run(questions, two(down, good))
    assert [r["correct"] for r in result["results"]] == [[1], [0, 2], [1]]


# ── Один ответ, несколько ответов ───────────────────────────────────────────────


def test_single_takes_exactly_one_option_and_multiple_neither_none_nor_all():
    body = {"questions": [
        {"id": "s2", "text": "Один, но два?", "options": ["а", "б", "в"], "kind": "single"},
        {"id": "m_all", "text": "Все сразу?", "options": ["а", "б", "в"], "kind": "multiple"},
        {"id": "m_none", "text": "Ничего?", "options": ["а", "б", "в"], "kind": "multiple"},
        {"id": "m_one", "text": "Один из многих?", "options": ["а", "б", "в"], "kind": "multiple"},
        {"id": "m_two", "text": "Двое?", "options": ["а", "б"], "kind": "multiple"},
        {"id": "dup", "text": "Дважды?", "options": ["а", "б", "в"], "kind": "single"},
    ]}
    picks = {"Один, но два?": {"а", "б"}, "Все сразу?": {"а", "б", "в"}, "Ничего?": set(), "Один из многих?": {"в"},
             "Двое?": {"б"}}

    def decide(q):
        if q["text"] == "Дважды?":
            return {"pick": [1, 1], "sure": "уверен"}
        return picks[q["text"]], "уверен"

    _, questions = questions_of(body)
    result = by_id(run(questions, two(model(decide), model(decide))))
    assert result["s2"] == {"id": "s2", "correct": None, "agree": False, "sure": "none", "note": bank_keys_ai.NOTE_NO_ANSWER}
    assert result["m_all"] == {"id": "m_all", "correct": None, "agree": True, "sure": "low", "note": bank_keys_ai.NOTE_ALL}
    assert result["m_none"]["correct"] is None and result["m_none"]["sure"] == "none"
    assert result["m_one"] == {"id": "m_one", "correct": [2], "agree": True, "sure": "high"}
    assert result["m_two"] == {"id": "m_two", "correct": [1], "agree": True, "sure": "high"}
    assert result["dup"]["correct"] is None and result["dup"]["sure"] == "none"


def test_the_reply_parser_is_strict_about_numbers_and_confidence():
    parse = bank_keys_ai.parse_reply
    assert parse("не json", [3]) is None and parse('{"answers": []}', [3]) is None and parse('{"a": 1}', [3]) is None
    got = parse('```json\n{"answers": [{"n": 1, "pick": [2], "sure": "Уверен"}, {"n": "2", "pick": ["1", 3], '
                '"sure": "не уверен"}, {"n": 3, "pick": [true], "sure": true}, {"n": 4, "pick": [1], "sure": "да"}, '
                '{"n": 9, "pick": [1], "sure": "уверен"}]}\n```', [3, 3, 3, 3])
    assert got[0] == bank_keys_ai.Reading(shown=(1,), sure=True)
    assert got[1] == bank_keys_ai.Reading(shown=(0, 2), sure=False)
    assert got[2].bad and got[3].bad and 8 not in got
    twice = parse('{"answers": [{"n": 1, "pick": [1], "sure": "уверен"}, {"n": 1, "pick": [2], "sure": "уверен"}]}', [2])
    assert twice[0].bad
    wrapped = parse('Вот ответ: {"answers": [{"n": 1, "pick": [2], "sure": "уверен"}]} Готово.', [2])
    assert wrapped == {0: bank_keys_ai.Reading(shown=(1,), sure=True)}
    assert parse('{"answers": [{"n": 1, "pick": [1], "sure": "уверен"}, {"n": 2, "pick": [1, ', [2, 2]) is None  # не чинится


# ── Оборванный или негодный ответ ───────────────────────────────────────────────


def test_a_truncated_or_broken_reply_is_asked_again_in_halves():
    _, questions = questions_of({"questions": QUESTIONS + [
        {"id": f"x{k}", "text": f"Сколько будет 2 + 2? ({k})", "options": ["3", "4", "5"], "kind": "single"}
        for k in range(3)]})
    for k in range(3):
        RIGHT[f"Сколько будет 2 + 2? ({k})"] = {"4"}
    try:
        honest = model(knowing)
        sizes = []

        async def flaky(system, text, meta):
            count = len(parse_prompt(text)[1])
            sizes.append(count)
            if len(sizes) == 1:
                return '{"answers": [{"n": 1, "pick": [2'  # оборван
            if len(sizes) == 2:
                meta["finish_reason"] = "MAX_TOKENS"  # JSON цел, но ответ упёрся в предел
            return await honest(system, text, meta)

        result = run(questions, two(flaky, model(knowing)))
    finally:
        for k in range(3):
            RIGHT.pop(f"Сколько будет 2 + 2? ({k})")
    assert sizes[0] == 6 and sizes[1] + sizes[2] == 6 and len(sizes) == 3
    # первая половина упёрлась в предел и глубже не делится: её вопросы без второго ответа
    assert [r["sure"] for r in result["results"]] == ["none"] * sizes[1] + ["high"] * sizes[2]


def test_questions_skipped_in_a_good_reply_are_asked_once_more_alone():
    _, questions = questions_of({"questions": QUESTIONS})
    seen = []
    honest = model(knowing)

    async def skips_first_time(system, text, meta):
        seen.append(len(parse_prompt(text)[1]))
        if len(seen) == 1:
            raw = json.loads(await honest(system, text, meta))
            raw["answers"] = raw["answers"][1:]
            return json.dumps(raw, ensure_ascii=False)
        return await honest(system, text, meta)

    result = run(questions, two(skips_first_time, model(knowing)))
    assert seen == [3, 1] and all(r["sure"] == "high" for r in result["results"])


def test_batches_hold_at_most_25_questions_and_calls_run_within_the_limit():
    many = [{"id": f"n{k}", "text": f"Вопрос номер {k}?", "options": ["да", "нет"], "kind": "single"} for k in range(60)]
    _, questions = questions_of({"questions": many})
    assert [len(batch) for batch in bank_keys_ai.make_batches(questions)] == [25, 25, 10]
    big = [{"id": f"b{k}", "text": "я" * 2000, "options": ["в" * 500] * 10, "kind": "single"} for k in range(4)]
    assert [len(b) for b in bank_keys_ai.make_batches(questions_of({"questions": big})[1])] == [1, 1, 1, 1]

    running, peak = [0], [0]

    async def slow(system, text, meta):
        running[0] += 1
        peak[0] = max(peak[0], running[0])
        await asyncio.sleep(0.01)
        running[0] -= 1
        return json.dumps({"answers": [{"n": q["n"], "pick": [1], "sure": "уверен"} for q in parse_prompt(text)[1]]})

    result = run(questions, two(slow, slow))
    assert peak[0] <= bank_keys_ai.PARALLEL and len(result["results"]) == 60
    assert result["units"] == 5


def test_answers_that_came_in_time_are_kept_when_the_whole_budget_runs_out(monkeypatch):
    monkeypatch.setattr(bank_keys_ai, "TOTAL_TIMEOUT_SECONDS", 0.3)
    monkeypatch.setattr(bank_keys_ai, "BATCH_QUESTIONS", 2)
    _, questions = questions_of({"questions": QUESTIONS})
    honest = model(knowing)

    async def stuck_on_the_last(system, text, meta):
        if "2 + 2" in text:
            await asyncio.sleep(5)
        return await honest(system, text, meta)

    result = run(questions, two(stuck_on_the_last, model(knowing)))
    assert [r["sure"] for r in result["results"]] == ["high", "high", "none"]


# ── Провайдеры по умолчанию ─────────────────────────────────────────────────────


def test_default_providers_are_gemini_and_groq_each_alone_without_the_cache(monkeypatch):
    calls = []

    async def run_agent(self, system, text, **kwargs):
        calls.append({"groq": self.groq_api_key, "gemini": self._gemini_keys(), "heavy": ai_base.heavy_state()["running"],
                      **kwargs})
        return json.dumps({"answers": []})

    monkeypatch.setattr(BaseAgent, "run", run_agent)
    monkeypatch.setenv("GEMINI_API_KEY", "g-key")
    monkeypatch.setenv("GROQ_API_KEY", "q-key")
    providers = bank_keys_ai.default_providers()
    assert [p.name for p in providers] == ["gemini", "groq"]
    for provider in providers:
        asyncio.run(provider.ask("system", "text", {}))
    gemini, groq = calls
    assert (gemini["groq"], gemini["gemini"]) == ("", ["g-key"]) and (groq["groq"], groq["gemini"]) == ("q-key", [])
    for call in calls:
        assert call["temperature"] == 0 and call["json_mode"] is True and call["use_cache"] is False
        assert call["heavy"] == 1  # в общей очереди тяжёлых вызовов
    monkeypatch.delenv("GROQ_API_KEY")
    assert [p.name for p in bank_keys_ai.default_providers()] == ["gemini"]
    monkeypatch.delenv("GEMINI_API_KEY")
    monkeypatch.setenv("GROQ_API_KEY", "q-key")
    assert [p.name for p in bank_keys_ai.default_providers()] == ["groq"]


def test_the_price_is_five_units_for_each_started_hundred_questions():
    assert [plans.keys_ai_cost(n) for n in (1, 100, 101, 200, 201, 300)] == [5, 5, 10, 10, 15, 15]
    assert plans.AI_COSTS["keysAI"] == 5 and plans.KEYS_AI_QUESTIONS_PER_CHARGE == 100


# ── Маршрут ─────────────────────────────────────────────────────────────────────


@pytest.fixture
def api(monkeypatch):
    import main

    async def fake_user(request):
        token = request.headers.get("authorization", "")
        if token not in ("Bearer token-a", "Bearer token-b"):
            raise HTTPException(status_code=401, detail="Требуется войти в аккаунт")
        return {"id": token[-7:]}

    charges, events, asked = [], [], []

    class Receipt:
        def __init__(self, units):
            self.units, self.kept, self.refunded = units, False, False

        def keep(self):
            self.kept = True

        async def refund(self):
            self.refunded = True

    async def charge(request, kind, units):
        events.append("charge")
        charges.append((kind, Receipt(units)))
        return charges[-1][1]

    async def real_model(*args, **kwargs):
        raise AssertionError("в тестах настоящая модель не зовётся")

    def providers_from(*asks):
        def make():
            out = []
            for name, ask in zip(("gemini", "groq"), asks):
                async def logged(system, text, meta, ask=ask):
                    events.append("ask")
                    asked.append(text)
                    return await ask(system, text, meta)
                out.append(Provider(name, logged))
            return out
        monkeypatch.setattr(bank_keys_ai, "default_providers", make)

    monkeypatch.setattr(main, "require_authenticated_user", fake_user)
    monkeypatch.setattr(main.limiter, "enabled", False)
    monkeypatch.setattr(quota, "charge", charge)
    monkeypatch.setattr(BaseAgent, "run", real_model)
    providers_from(model(knowing), model(knowing))
    client = TestClient(main.app, headers={"Authorization": "Bearer token-a"})
    client.charges, client.events, client.asked, client.providers_from = charges, events, asked, providers_from
    yield client


def test_the_route_charges_before_the_model_keeps_the_units_and_logs_only_counters(api, capsys):
    response = api.post(PATH, json={"subject": SUBJECT, "questions": QUESTIONS})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["units"] == 5 and body["spent_questions"] == 3
    assert [r["correct"] for r in body["results"]] == [[1], [0, 2], [1]]
    (kind, receipt), = api.charges
    assert kind == "keysAI" and receipt.units == 5 and receipt.kept and not receipt.refunded
    assert api.events[0] == "charge" and api.events.count("ask") == 2
    logged = capsys.readouterr().out
    assert "Keys AI: questions 3, batches 1, providers 2" in logged and "high 3" in logged
    assert not any(word in logged for word in SECRET_WORDS)  # в журнал — только счётчики


def test_the_price_follows_the_number_of_questions_sent(api):
    many = [{"id": f"n{k}", "text": "Сколько будет 2 + 2?", "options": ["3", "4", "5"], "kind": "single"} for k in range(101)]
    response = api.post(PATH, json={"questions": many})
    assert response.status_code == 200 and response.json()["units"] == 10 and response.json()["spent_questions"] == 101
    assert api.charges[0][1].units == 10


def test_units_come_back_and_the_message_is_plain_when_no_answer_came(api, capsys):
    async def down(system, text, meta):
        raise AIError.failed()

    api.providers_from(down, down)
    response = api.post(PATH, json={"subject": SUBJECT, "questions": QUESTIONS})
    assert response.status_code == 502 and response.json() == {"detail": bank_keys_ai.AI_FAILED_DETAIL, "code": "ai_failed"}
    (_, receipt), = api.charges
    assert receipt.refunded and not receipt.kept

    async def busy(system, text, meta):
        raise AIError.busy()

    api.providers_from(busy, down)
    response = api.post(PATH, json={"questions": QUESTIONS})
    assert response.status_code == 429 and response.json() == {"detail": bank_keys_ai.AI_BUSY_DETAIL, "code": "ai_busy"}
    assert api.charges[1][1].refunded

    async def garbage(system, text, meta):
        return "Москва, конечно"

    api.providers_from(garbage)
    response = api.post(PATH, json={"questions": QUESTIONS})
    assert response.status_code == 502 and api.charges[2][1].refunded and not api.charges[2][1].kept
    logged = capsys.readouterr().out
    assert logged.count("Keys AI:") == 3 and not any(word in logged for word in SECRET_WORDS)


def test_a_partial_answer_keeps_the_units(api):
    async def down(system, text, meta):
        raise AIError.failed()

    api.providers_from(model(knowing), down)
    response = api.post(PATH, json={"questions": QUESTIONS})
    assert response.status_code == 200 and all(r["sure"] == "high" for r in response.json()["results"])
    assert api.charges[0][1].kept and not api.charges[0][1].refunded


def test_the_daily_limit_and_no_providers_stop_the_request_before_the_model(api, monkeypatch):
    async def no_units(request, kind, units):
        raise quota.AILimitExceeded(used=98, limit=100, resets_at=None, pro=False, units=units)

    monkeypatch.setattr(quota, "charge", no_units)
    response = api.post(PATH, json={"questions": QUESTIONS})
    assert response.status_code == 429 and response.json()["code"] == "ai_limit" and response.json()["units"] == 5
    assert api.asked == []

    monkeypatch.setattr(bank_keys_ai, "default_providers", lambda: [])
    response = api.post(PATH, json={"questions": QUESTIONS})
    assert response.status_code == 503 and response.json() == {"detail": bank_keys_ai.AI_FAILED_DETAIL, "code": "ai_failed"}
    assert api.asked == []


def test_the_route_is_mounted_and_needs_a_session(api, monkeypatch):
    import main

    assert {(route.path, frozenset(route.methods)) for route in bank_keys_ai.router.routes} == {(PATH, frozenset({"POST"}))}
    assert main.bank_keys_ai_router is bank_keys_ai.router
    anonymous = TestClient(main.app).post(PATH, json={"questions": QUESTIONS})
    assert anonymous.status_code == 401 and anonymous.json()["detail"] == "Требуется войти в аккаунт"
    bare = FastAPI()
    bare.include_router(bank_keys_ai.router)  # без middleware main.py: вторая линия
    response = TestClient(bare).post(PATH, json={"questions": QUESTIONS})
    assert response.status_code == 401 and response.json() == {"detail": bank_keys_ai.AUTH_DETAIL, "code": "auth"}
    assert api.charges == [] and api.asked == []


def test_the_limit_is_5_a_minute_and_30_a_day_per_user(api, monkeypatch):
    import main

    limits = {name: [(str(limit.limit), limit.key_func) for limit in values]
              for name, values in main.limiter._route_limits.items() if name.startswith("bank_keys_ai.")}
    assert limits == {"bank_keys_ai.suggest_keys": [("5 per 1 minute", user_or_ip_key), ("30 per 1 day", user_or_ip_key)]}
    assert main.limiter is limiter

    monkeypatch.setattr(main.limiter, "enabled", True)
    main.limiter.reset()
    try:
        for _ in range(5):
            assert api.post(PATH, json={"questions": QUESTIONS}).status_code == 200
        limited = api.post(PATH, json={"questions": QUESTIONS})
        assert limited.status_code == 429 and limited.json()["detail"] == RATE_LIMIT_DETAIL
        other = api.post(PATH, json={"questions": QUESTIONS}, headers={"Authorization": "Bearer token-b"})
        assert other.status_code == 200
        assert len(api.charges) == 6  # отказ лимита запросов ничего не списал
    finally:
        main.limiter.reset()
