"""The second reading of the конспект (notes_check.py): sentences, the checker's answer, the guards and the stream.

The three slips of the history lecture in the recheck of release 44.9 (12.10.2026) are the cases here: a case ending
that made France declare war («3 августа — Франция»), «грозил втянуть» retold as «неизбежно втягивал», and the
armistice that «привело к крушению» four empires.
"""
import asyncio
import io
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import notes_check  # noqa: E402
from agents.base import AIError  # noqa: E402
from test_analyze_stream import api, frames  # noqa: E402,F401
from test_analyze_stream import section_of  # noqa: E402

LECTURE = (
    "28 июня 1914 года в Сараеве сербский студент Гаврило Принцип застрелил эрцгерцога Франца Фердинанда. "
    "1 августа 1914 года Германия объявила войну России, 3 августа — Франции. 4 августа в войну вступила "
    "Великобритания.\n\nСистема военных союзов. Любой локальный конфликт грозил втянуть в войну всю Европу.\n\n"
    "Война продолжалась с 1914 по 1918 год. Компьенское перемирие было подписано 11 ноября 1918 года. Война привела к "
    "распаду четырёх империй: Российской, Германской, Австро-Венгерской и Османской."
)

DECLARATIONS = "1 августа войну России объявила Германия, 3 августа — Франция, а 4 августа вступила Великобритания."
ALLIANCES = "**Система военных союзов**: устройство, при котором локальный конфликт неизбежно втягивал в войну всю Европу."
ARMISTICE = ("Подписание Компьенского перемирия состоялось 11 ноября 1918 года, что привело к крушению Российской, "
             "Германской, Австро-Венгерской и Османской империй.")

CONTENT = (
    "## Ключевые тезисы\n"
    "- Убийство в Сараеве стало только поводом к войне.\n\n"
    "## Повод к войне\n"
    f"28 июня 1914 года Гаврило Принцип застрелил эрцгерцога. {DECLARATIONS}\n\n"
    "## Главные причины\n"
    f"- {ALLIANCES}\n\n"
    "## Итоги\n"
    f"Война шла с 1914 по 1918 год и завершилась поражением Германии. {ARMISTICE}"
)

FIXED_DECLARATIONS = "1 августа войну России объявила Германия, 3 августа — Франции, а 4 августа вступила Великобритания."
FIXED_ALLIANCES = "**Система военных союзов**: устройство, при котором любой локальный конфликт грозил втянуть в войну всю Европу."
FIXED_ARMISTICE = ("Компьенское перемирие было подписано 11 ноября 1918 года, а война привела к распаду Российской, "
                   "Германской, Австро-Венгерской и Османской империй.")


@pytest.fixture(autouse=True)
def check_on(monkeypatch):
    """Off by default since release 44.11; these tests are about the check itself."""
    monkeypatch.setenv("AI_NOTES_CHECK", "on")


def summary(content=CONTENT, terms=None):
    return {"title": "Причины войны", "subject": "История", "content": content, "terms": terms or []}


def key_of(units, text):
    return next(unit.key for unit in units if unit.text == text)


class FakeAgent:
    def __init__(self, answer):
        self.answer = answer
        self.calls = []

    async def run(self, system_prompt, user_text, **kwargs):
        self.calls.append({"system": system_prompt, "user": user_text, **kwargs})
        answer = self.answer(user_text) if callable(self.answer) else self.answer
        if isinstance(answer, BaseException):
            raise answer
        if isinstance(answer, (dict, list)):
            return json.dumps(answer, ensure_ascii=False)
        return answer


def verify(agent, payload, lecture=LECTURE, **kwargs):
    return asyncio.run(notes_check.verify_summary(agent, payload, lecture, **kwargs))


# --- sentences ----------------------------------------------------------------------------------


def test_the_notes_are_read_sentence_by_sentence_without_headings_and_list_marks():
    units = notes_check.split_units(CONTENT)
    texts = [unit.text for unit in units]
    assert texts == [
        "Убийство в Сараеве стало только поводом к войне.",
        "28 июня 1914 года Гаврило Принцип застрелил эрцгерцога.",
        DECLARATIONS,
        ALLIANCES,
        "Война шла с 1914 по 1918 год и завершилась поражением Германии.",
        ARMISTICE,
    ]
    assert [unit.key for unit in units] == ["1", "2", "3", "4", "5", "6"]
    for unit in units:
        assert CONTENT[unit.start:unit.end] == unit.text


def test_abbreviations_formulas_and_short_pieces_do_not_cut_or_count():
    content = (
        "В 1914 г. Германия объявила войну России и Франции.\n"
        "Закон Ома: $I = \\frac{U}{R}$. Сила тока растёт с напряжением.\n"
        "$$\nR = R_1 + R_2. R_3\n$$\n"
        "| Тип | Значение. Ещё |\n"
        "```\nкод. Код дальше идёт.\n```\n"
        "Итак. Всё сказано выше в лекции.\n"
        "Работы А. С. Попова изменили связь навсегда."
    )
    texts = [unit.text for unit in notes_check.split_units(content)]
    assert texts == [
        "В 1914 г. Германия объявила войну России и Франции.",
        "Сила тока растёт с напряжением.",
        "Всё сказано выше в лекции.",
        "Работы А. С. Попова изменили связь навсегда.",
    ]


def test_term_definitions_are_checked_under_their_own_numbers():
    terms = [{"term": "Антанта", "definition": "Блок Великобритании, Франции и России."},
             {"term": "Союз", "definition": "Блок."},
             "не термин"]
    units = notes_check.term_units(terms)
    assert [(unit.key, unit.term, unit.text) for unit in units] == [("T1", 0, "Блок Великобритании, Франции и России.")]
    text = notes_check.build_check_text(notes_check.split_units("Одно предложение из конспекта лекции."), "ЛЕКЦИЯ", terms)
    assert text.startswith("КОНСПЕКТ:\n[1] Одно предложение из конспекта лекции.")
    assert text.endswith("\n\nЛЕКЦИЯ:\nЛЕКЦИЯ")
    text = notes_check.build_check_text(units, "Лекция.", terms)
    assert "[T1] Антанта — Блок Великобритании, Франции и России." in text


# --- the checker's answer -----------------------------------------------------------------------


def test_the_answer_is_read_in_its_usual_forms():
    assert notes_check.parse_fixes('{"fixes": [{"n": 3, "why": "кто объявил", "fixed": "А."}]}') == [
        {"n": "3", "why": "кто объявил", "fixed": "А."}]
    assert notes_check.parse_fixes('```json\n[{"n": "[t2]", "fixed": "Б."}]\n```') == [{"n": "T2", "why": "", "fixed": "Б."}]
    assert notes_check.parse_fixes('{"fixes": []}') == []
    assert notes_check.parse_fixes('{"fixes": [{"n": 1}, "x", {"fixed": "В."}]}') == []
    assert notes_check.parse_fixes('{"title": "Конспект", "content": "…"}') is None
    assert notes_check.parse_fixes("Ошибок нет.") is None
    assert notes_check.parse_fixes(None) is None


def test_a_fix_loses_what_the_checker_echoed_and_keeps_the_links_and_the_end_mark():
    assert notes_check.clean_fixed("[3] - Сопротивление зависит от длины", "Сопротивление растёт [S01].") == (
        "Сопротивление зависит от длины [S01].")
    assert notes_check.clean_fixed("Ток  течёт\nот плюса [S02].", "Ток течёт от минуса [S01].") == "Ток течёт от плюса [S02]."
    assert notes_check.clean_fixed("Антанта — блок трёх держав", "Блок двух держав.", "Антанта") == "Блок трёх держав."
    assert notes_check.clean_fixed("28 июня — повод", "Повод.") == "28 июня — повод."


def test_a_fix_that_is_another_sentence_or_brings_a_new_number_is_refused():
    assert notes_check.refusal(DECLARATIONS, FIXED_DECLARATIONS, LECTURE) is None
    assert notes_check.refusal(ALLIANCES, FIXED_ALLIANCES, LECTURE) is None
    assert notes_check.refusal(ARMISTICE, FIXED_ARMISTICE, LECTURE) is None
    assert notes_check.refusal(DECLARATIONS, DECLARATIONS + " ", LECTURE) == "same"
    assert notes_check.refusal(DECLARATIONS, "", LECTURE) == "same"
    assert notes_check.refusal(ARMISTICE, "Перемирие подписали в лесу у Компьена, все были рады.", LECTURE) == "rewritten"
    assert notes_check.refusal(ARMISTICE, ARMISTICE.replace("11 ноября", "12 ноября"), LECTURE) == "new_number"
    assert notes_check.refusal("Короткое верное предложение тут.", "Короткое верное предложение тут. " * 4, LECTURE) == "longer"
    assert notes_check.refusal("Ток растёт [S01].", "Ток растёт быстро [S07].", "Ток растёт.") is None


# --- applying -----------------------------------------------------------------------------------


def test_fixes_replace_their_sentences_and_nothing_else():
    payload = summary(terms=[{"term": "Антанта", "definition": "Блок Великобритании, Франции, России и Италии."}])
    units = notes_check.split_units(CONTENT) + notes_check.term_units(payload["terms"])
    fixes = [
        {"n": key_of(units, ARMISTICE), "why": "причина", "fixed": FIXED_ARMISTICE},
        {"n": key_of(units, DECLARATIONS), "why": "кто объявил", "fixed": FIXED_DECLARATIONS},
        {"n": "T1", "why": "Италии нет", "fixed": "Антанта — блок Великобритании, Франции и России."},
        {"n": "99", "why": "", "fixed": "Лишнее."},
        {"n": key_of(units, DECLARATIONS), "why": "ещё раз", "fixed": FIXED_DECLARATIONS},
    ]
    fixed, accepted, refused = notes_check.apply_fixes(payload, units, fixes, LECTURE)
    assert fixed["content"] == CONTENT.replace(ARMISTICE, FIXED_ARMISTICE).replace(DECLARATIONS, FIXED_DECLARATIONS)
    assert fixed["terms"] == [{"term": "Антанта", "definition": "Блок Великобритании, Франции и России."}]
    assert payload["terms"][0]["definition"] == "Блок Великобритании, Франции, России и Италии."  # not changed in place
    assert [item["n"] for item in accepted] == ["6", "3", "T1"]
    assert accepted[1] == {"n": "3", "why": "кто объявил", "was": DECLARATIONS, "now": FIXED_DECLARATIONS}
    assert refused == [{"n": "99", "reason": "unknown"}, {"n": "3", "reason": "repeated"}]


# --- the check ------------------------------------------------------------------------------------


def three_fixes(user_text):
    units = notes_check.split_units(CONTENT)
    return {"fixes": [
        {"n": key_of(units, DECLARATIONS), "why": "войну объявила Германия", "fixed": FIXED_DECLARATIONS},
        {"n": key_of(units, ALLIANCES), "why": "в лекции «грозил втянуть»", "fixed": FIXED_ALLIANCES},
        {"n": key_of(units, ARMISTICE), "why": "в лекции распад — итог войны", "fixed": FIXED_ARMISTICE},
    ]}


def test_the_three_slips_of_the_recheck_are_fixed_and_reported():
    agent = FakeAgent(three_fixes)
    fixed, report = verify(agent, summary())
    assert fixed["content"] == (CONTENT.replace(DECLARATIONS, FIXED_DECLARATIONS).replace(ALLIANCES, FIXED_ALLIANCES)
                                .replace(ARMISTICE, FIXED_ARMISTICE))
    assert report["status"] == "ok" and report["sentences"] == 6 and report["refused"] == []
    assert [(item["was"], item["now"]) for item in report["fixed"]] == [
        (DECLARATIONS, FIXED_DECLARATIONS), (ALLIANCES, FIXED_ALLIANCES), (ARMISTICE, FIXED_ARMISTICE)]
    assert isinstance(report["ms"], int)
    call = agent.calls[0]
    assert call["system"] == notes_check.build_check_prompt(False)
    assert call["user"].startswith("КОНСПЕКТ:\n[1] ") and call["user"].endswith(LECTURE)
    assert call["json_mode"] is True and call["temperature"] == 0.0
    assert call.get("use_cache", True) is True  # the same конспект is checked once: a cached analysis stays free
    assert 0 < call["timeout"] <= notes_check.DEFAULT_TIMEOUT_SECONDS


def test_a_recorded_lecture_tells_the_checker_that_names_may_be_misheard():
    agent = FakeAgent({"fixes": []})
    fixed, report = verify(agent, summary(), recording=True)
    assert fixed == summary() and report["status"] == "ok" and report["fixed"] == []
    assert "распознаванием речи" in agent.calls[0]["system"]
    assert "распознаванием речи" not in notes_check.build_check_prompt(False)


@pytest.mark.parametrize("answer, status", [
    (AIError.busy(), "failed"),
    (AIError.timeout(), "failed"),
    ("Всё верно, ошибок нет.", "unreadable"),
    ({"title": "Не тот ответ", "content": "…"}, "unreadable"),
])
def test_a_failed_check_leaves_the_notes_as_they_were(answer, status):
    payload = summary()
    fixed, report = verify(FakeAgent(answer), payload)
    assert fixed is payload and report["status"] == status and report["fixed"] == []


def test_a_checker_that_wants_to_change_most_of_the_notes_changes_nothing():
    units = notes_check.split_units(CONTENT)
    answer = {"fixes": [{"n": unit.key, "why": "", "fixed": unit.text + " Ещё."} for unit in units]}
    payload = summary()
    fixed, report = verify(FakeAgent(answer), payload)
    assert fixed is payload and report == {**report, "status": "too_many", "asked": 6, "fixed": []}


def test_a_fix_with_a_broken_word_keeps_the_notes_as_they_were():
    units = notes_check.split_units(CONTENT)
    answer = {"fixes": [{"n": key_of(units, ALLIANCES), "why": "", "fixed": FIXED_ALLIANCES.replace("Европу", "Еврoпу")}]}
    fixed, report = verify(FakeAgent(answer), summary())
    # A Latin look-alike is replaced like in the model's own text (mixed_script.check).
    assert report["status"] == "ok" and fixed["content"] == CONTENT.replace(ALLIANCES, FIXED_ALLIANCES)
    answer = {"fixes": [{"n": key_of(units, ALLIANCES), "why": "", "fixed": FIXED_ALLIANCES.replace("Европу", "Еврoпуnation")}]}
    payload = summary()
    fixed, report = verify(FakeAgent(answer), payload)
    assert fixed is payload and report["status"] == "broken" and report["fixed"] == []


def test_the_check_can_be_off_short_of_time_or_too_long_and_then_asks_nothing(monkeypatch):
    agent = FakeAgent(three_fixes)
    monkeypatch.setenv("AI_NOTES_CHECK", "off")
    assert verify(agent, summary())[1]["status"] == "skipped"
    monkeypatch.delenv("AI_NOTES_CHECK")
    assert verify(agent, summary())[1]["status"] == "skipped"  # off unless asked for (release 44.11)
    monkeypatch.setenv("AI_NOTES_CHECK", "on")
    assert verify(agent, summary(), budget=1.0)[1]["status"] == "no_time"
    assert verify(agent, summary(), lecture="а" * (notes_check.MAX_LECTURE_CHARS + 1))[1]["status"] == "skipped"
    report = verify(agent, summary(content="## Только заголовок"))[1]
    assert report["status"] == "skipped" and report["sentences"] == 0
    assert agent.calls == []
    monkeypatch.setenv("AI_NOTES_CHECK_TIMEOUT_SECONDS", "12")
    verify(agent, summary(), budget=60.0)
    assert agent.calls[-1]["timeout"] == 12.0


def test_a_checker_that_does_not_answer_in_time_is_not_waited_for(monkeypatch):
    monkeypatch.setattr(notes_check, "MIN_BUDGET_SECONDS", 0.01)

    class Slow(FakeAgent):
        async def run(self, system_prompt, user_text, **kwargs):
            await asyncio.sleep(5)

    payload = summary()
    fixed, report = verify(Slow(None), payload, budget=0.05)
    assert fixed is payload and report["status"] == "failed" and report["error"] == "TimeoutError"
    assert report["ms"] < 2000


# --- in the analysis --------------------------------------------------------------------------------


def post_lecture(client, agents=("summarizer",)):
    return client.post(
        "/api/analyze",
        files={"file": ("lecture.txt", io.BytesIO(LECTURE.encode("utf-8")), "text/plain")},
        data={"enabled_agents": json.dumps(list(agents))},
        headers={"Authorization": "Bearer user-a"},
    )


def answers_with_check(monkeypatch, check_answer):
    from agents.base import BaseAgent

    calls = []

    async def run(self, system_prompt, user_text, **kwargs):
        name = section_of(system_prompt)
        calls.append(name)
        if name == "notes_check":
            return json.dumps(check_answer(user_text), ensure_ascii=False)
        if name == "summarizer":
            return json.dumps(summary(), ensure_ascii=False)
        return json.dumps({"flashcards": [{"question": "Кто объявил войну России 1 августа?", "answer": "Германия."}]},
                          ensure_ascii=False)

    monkeypatch.setattr(BaseAgent, "run", run)
    return calls


def test_the_stream_gives_the_checked_notes_and_the_report(api, monkeypatch):
    calls = answers_with_check(monkeypatch, three_fixes)
    events = [item for item in frames(post_lecture(api, ("summarizer", "flashcards")).text) if item != "KA"]
    done = next(item for item in events if item["type"] == "agent_done" and item["agent"] == "summarizer")
    results = next(item for item in events if item["type"] == "results")
    for content in (done["result"]["content"], results["summarizer"]["content"]):
        assert DECLARATIONS not in content and ALLIANCES not in content and ARMISTICE not in content
        assert FIXED_DECLARATIONS in content and FIXED_ALLIANCES in content and FIXED_ARMISTICE in content
    report = results["checks"]["summarizer"]
    assert report["status"] == "ok" and len(report["fixed"]) == 3
    assert "checks" not in done and "checks" not in results["summarizer"]
    assert sorted(calls) == ["flashcards", "notes_check", "summarizer"]  # the cards are not read again


def test_a_failed_check_does_not_fail_the_analysis(api, monkeypatch):
    def broken(user_text):
        raise AIError.busy()

    answers_with_check(monkeypatch, broken)
    results = next(item for item in frames(post_lecture(api).text) if item != "KA" and item["type"] == "results")
    assert results["sections"]["summarizer"] == {"status": "ok"}
    assert results["summarizer"]["content"] == CONTENT
    assert results["checks"]["summarizer"]["status"] == "failed"


def test_by_default_the_analysis_asks_no_check_and_sends_no_report(api, monkeypatch):
    monkeypatch.delenv("AI_NOTES_CHECK")
    calls = answers_with_check(monkeypatch, three_fixes)
    results = next(item for item in frames(post_lecture(api).text) if item != "KA" and item["type"] == "results")
    assert results["summarizer"]["content"] == CONTENT and "checks" not in results
    assert calls == ["summarizer"]


def test_the_notes_made_again_on_the_lecture_page_are_checked_too(api, monkeypatch):
    calls = answers_with_check(monkeypatch, three_fixes)
    response = api.post("/api/analyze/section", json={"section": "summarizer", "text": LECTURE},
                        headers={"Authorization": "Bearer user-a"})
    assert response.status_code == 200, response.text
    content = response.json()["result"]["content"]
    assert FIXED_DECLARATIONS in content and FIXED_ARMISTICE in content and ARMISTICE not in content
    assert calls == ["summarizer", "notes_check"]
