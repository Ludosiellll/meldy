"""Adverbs that make a claim stronger than the lecture's (overstatement.py): the slips of the fact rechecks 44.5–44.10."""
import io
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import overstatement  # noqa: E402
from test_analyze_stream import api, frames, section_of  # noqa: E402,F401

LECTURE = (
    "Система военных союзов. Любой локальный конфликт грозил втянуть в войну всю Европу. Война продолжалась с 1914 по "
    "1918 год и закончилась поражением Германии и её союзников. Компьенское перемирие было подписано 11 ноября 1918 "
    "года. Война привела к распаду четырёх империй: Российской, Германской, Австро-Венгерской и Османской."
)


def soften(text, lecture=LECTURE):
    removed = []
    return overstatement.soften_text(text, lecture.lower(), removed), removed


def test_the_overstatements_of_the_rechecks_go():
    assert soften("Локальный конфликт неизбежно втягивал в войну всю Европу.") == (
        "Локальный конфликт втягивал в войну всю Европу.", ["неизбежно"])
    assert soften("Любое столкновение неминуемо втягивало всех союзников.") == (
        "Любое столкновение втягивало всех союзников.", ["неминуемо"])
    assert soften("Конфликт на Балканах моментально перерос в общеевропейскую войну.")[0] == (
        "Конфликт на Балканах перерос в общеевропейскую войну.")
    assert soften("Убийство мгновенно переросло в войну.")[0] == "Убийство переросло в войну."
    assert soften("После подписания перемирия распалось сразу четыре империи.")[0] == (
        "После подписания перемирия распалось четыре империи.")
    assert soften("Империи распались сразу.")[0] == "Империи распались."


def test_the_sentence_still_reads_after_the_word_goes():
    assert soften("Мгновенно началась мобилизация.") == ("Началась мобилизация.", ["Мгновенно"])
    assert soften("Сразу же после убийства был ультиматум.")[0] == "После убийства был ультиматум."
    assert soften("- **Союзы**: конфликт неизбежно втягивал Европу.")[0] == "- **Союзы**: конфликт втягивал Европу."
    assert soften("Конфликт, неизбежно, втягивал всех.")[0] == "Конфликт, втягивал всех."


def test_a_word_the_lecture_uses_or_that_is_negated_stays():
    assert soften("Война началась не сразу, а через месяц.") == ("Война началась не сразу, а через месяц.", [])
    assert soften("Это ни мгновенно, ни быстро.")[0] == "Это ни мгновенно, ни быстро."
    lecture = LECTURE + " Война была неизбежной, и конфликт сразу вышел за пределы Балкан."
    assert soften("Конфликт неизбежно и сразу вышел за пределы Балкан.", lecture)[1] == []
    assert soften("Мгновенная скорость меняется мгновенно.", LECTURE + " Мгновенная скорость.")[1] == []


def test_formulas_code_and_quiz_options_keep_the_word():
    assert soften("Скорость $v = сразу$ и `сразу` в коде.")[0] == "Скорость $v = сразу$ и `сразу` в коде."
    quiz = {"quiz": [{"question": "Что случилось сразу после убийства?",
                      "options": ["A) Война началась сразу", "B) Ультиматум"], "correct": "B",
                      "explanation": "Сразу после убийства предъявили ультиматум."}]}
    softened, removed = overstatement.soften(quiz, LECTURE)
    item = softened["quiz"][0]
    assert item["question"] == "Что случилось после убийства?"
    assert item["options"] == ["A) Война началась сразу", "B) Ультиматум"]
    assert item["explanation"] == "После убийства предъявили ультиматум."
    assert removed == ["сразу", "Сразу"]


def test_without_the_lecture_nothing_changes():
    for lecture in ("", "   ", "Короткий текст.", None):
        assert overstatement.soften({"content": "Империи распались сразу."}, lecture) == (
            {"content": "Империи распались сразу."}, [])


def test_the_analysis_takes_them_out_of_every_section(api, monkeypatch):
    from agents.base import BaseAgent

    answers = {
        "summarizer": {"title": "Причины войны", "subject": "История", "terms": [],
                       "content": "## Главные причины\n- **Союзы**: конфликт неизбежно втягивал Европу.\n"},
        "flashcards": {"flashcards": [{"question": "Что сделал конфликт?", "answer": "Мгновенно перерос в войну."}]},
        "quiz": {"quiz": [{"question": "Что было сразу после перемирия?", "options": ["A) Распад сразу", "B) Мир"],
                           "correct": "B", "explanation": "Империи распались сразу."}]},
    }

    async def run(self, system_prompt, user_text, **kwargs):
        name = section_of(system_prompt)
        return '{"fixes": []}' if name == "notes_check" else json.dumps(answers[name], ensure_ascii=False)

    monkeypatch.setattr(BaseAgent, "run", run)
    response = api.post(
        "/api/analyze",
        files={"file": ("lecture.txt", io.BytesIO(LECTURE.encode("utf-8")), "text/plain")},
        data={"enabled_agents": json.dumps(["summarizer", "flashcards", "quiz"])},
        headers={"Authorization": "Bearer user-a"},
    )
    results = next(item for item in frames(response.text) if item != "KA" and item["type"] == "results")
    assert results["summarizer"]["content"] == "## Главные причины\n- **Союзы**: конфликт втягивал Европу."
    assert results["flashcards"]["flashcards"][0]["answer"] == "Перерос в войну."
    question = results["quiz"]["quiz"][0]
    assert question["question"] == "Что было после перемирия?" and question["explanation"] == "Империи распались."
    assert question["options"] == ["A) Распад сразу", "B) Мир"]


def test_the_vyzhimka_made_later_loses_them_too(api, monkeypatch):
    from agents.base import BaseAgent

    async def run(self, system_prompt, user_text, **kwargs):
        return json.dumps({"key_points": ["Конфликт неизбежно втягивал Европу"],
                           "cheatsheet": "# Выжимка\n\nКонфликт неизбежно втягивал Европу.", "questions": []},
                          ensure_ascii=False)

    monkeypatch.setattr(BaseAgent, "run", run)
    response = api.post("/api/quick-prep", json={"context": LECTURE}, headers={"Authorization": "Bearer user-a"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["cheatsheet"] == "# Выжимка\n\nКонфликт втягивал Европу."
    assert body["key_points"] == ["Конфликт втягивал Европу"]
