"""Section validation, statuses, eviction with one retry, run_section and /api/analyze/section."""
import asyncio
import json
import sys
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


from agents import base  # noqa: E402
from agents.base import AIError, BaseAgent  # noqa: E402
from agents.coordinator import (  # noqa: E402
    SECTION_MESSAGES,
    TERMINAL_MESSAGES,
    CoordinatorAgent,
    validate_section,
)
from utils import build_source_chunks  # noqa: E402

TEXT = (
    "Инфляция — устойчивый рост общего уровня цен.\n\n"
    "Центральный банк повышает ключевую ставку, чтобы замедлить рост цен.\n\n"
    "REST API возвращает данные в формате JSON."
)

SUMMARY = {"title": "Инфляция", "subject": "Экономика", "content": "## Инфляция\n\nРост цен.", "terms": [{"term": "Инфляция", "definition": "Рост цен"}]}
CARDS = {"flashcards": [{"id": 7, "question": "Что такое инфляция?", "answer": "Рост общего уровня цен."}]}
QUIZ = {"quiz": [{"id": 3, "question": "Что повышает ЦБ?", "options": ["A) Ключевую ставку", "B) Налоги"], "correct": "A", "explanation": "Ставка."}]}


@pytest.fixture(autouse=True)
def clean_state(monkeypatch):
    for name in ("GEMINI_API_KEY", "GEMINI_MODELS", "GEMINI_FAST_MODELS", "AI_CACHE_DISABLED",
                 "AI_AGENT_TIMEOUT_SECONDS", "GROQ_MODEL"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("AI_AGENT_STAGGER_SECONDS", "0")
    BaseAgent._run_cache.clear()
    BaseAgent._cache_info.clear()
    base._GENAI_CLIENTS.clear()
    base._MODEL_SKIP.clear()
    yield
    BaseAgent._run_cache.clear()
    BaseAgent._cache_info.clear()
    base._GENAI_CLIENTS.clear()
    base._MODEL_SKIP.clear()


def section_of(prompt: str) -> str:
    if "конспект" in prompt and "Верни результат" not in prompt and "шпаргалк" not in prompt:
        return "summarizer"
    if "обучающих карточек" in prompt:
        return "flashcards"
    if "проверочных тестов" in prompt:
        return "quiz"
    if "шпаргалок" in prompt:
        return "cheatsheet"
    if "учебных разговоров" in prompt:
        return "podcast"
    return "missions"


def fake_run(monkeypatch, answers):
    """Patch BaseAgent.run: answers[section] is a str, an Exception, or a list consumed per call."""
    calls = []

    async def run(self, system_prompt, user_text, **kwargs):
        name = section_of(system_prompt)
        calls.append({"section": name, **kwargs})
        answer = answers[name]
        if isinstance(answer, list):
            answer = answer.pop(0) if len(answer) > 1 else answer[0]
        if isinstance(answer, BaseException):
            raise answer
        if callable(answer):
            answer = await answer()
        return answer

    monkeypatch.setattr(BaseAgent, "run", run)
    return calls


def collect(agents, text=TEXT, **kwargs):
    async def go():
        return [event async for event in CoordinatorAgent(api_key="").process(text, enabled_agents=agents, **kwargs)]

    return asyncio.run(go())


# --- validate_section ----------------------------------------------------------------------

@pytest.mark.parametrize(
    "name,raw",
    [
        ("summarizer", ""),
        ("summarizer", "не JSON"),
        ("summarizer", "{}"),
        ("summarizer", json.dumps({"title": "T", "content": "   "})),
        ("summarizer", '{"title": "Инфляция", "subject": "Экономика", "content": "Начало конспекта, который обр'),
        ("flashcards", ""),
        ("flashcards", "{}"),
        ("flashcards", json.dumps({"flashcards": []})),
        ("flashcards", json.dumps({"flashcards": [{"id": 1}]})),
        ("flashcards", '{"flashcards": [{"id": 1, "question": "Что та'),
        ("quiz", json.dumps({"quiz": []})),
        ("quiz", json.dumps({"quiz": [{"question": "Q", "options": ["A) 1", "B) 2"], "correct": "D"}]})),
        ("quiz", json.dumps({"quiz": [{"question": "Q", "options": ["A) 1"], "correct": "A"}]})),
        ("quiz", json.dumps({"quiz": [{"question": "", "options": ["A) 1", "B) 2"], "correct": "A"}]})),
        ("quiz", json.dumps({"quiz": [{"question": "Q", "options": ["A) x", "B) y"], "correct": "A) y"}]}, ensure_ascii=False)),
        ("cheatsheet", ""),
        ("cheatsheet", "{}"),
        ("cheatsheet", json.dumps({"key_points": ["a"]})),
        ("podcast", json.dumps({"podcast": [{"speaker": "Макс", "text": ""}]}, ensure_ascii=False)),
    ],
)
def test_unusable_answers_are_empty(name, raw):
    assert validate_section(name, raw, source_text=TEXT) == (None, "empty")


def test_list_wrapped_summary_is_unwrapped_without_fallback_strings():
    payload, status = validate_section("summarizer", json.dumps([SUMMARY], ensure_ascii=False))
    assert status == "ok"
    assert payload == {"title": "Инфляция", "subject": "Экономика", "content": "## Инфляция\n\nРост цен.",
                       "terms": [{"term": "Инфляция", "definition": "Рост цен"}]}
    assert "fallback" not in json.dumps(payload)
    # Two dicts in a list are not a summary.
    assert validate_section("summarizer", json.dumps([SUMMARY, SUMMARY]))[1] == "empty"


def test_summary_terms_are_optional_and_filtered():
    payload, status = validate_section("summarizer", json.dumps({"content": "Текст", "terms": [{"definition": "без термина"}, "x"]}, ensure_ascii=False))
    assert status == "ok" and payload["terms"] == [] and payload["title"] == ""


def test_cards_with_front_back_or_russian_keys_are_renamed_and_renumbered():
    raw = json.dumps({"flashcards": [
        {"id": 9, "front": "Вопрос 1", "back": "Ответ 1"},
        {"вопрос": "Вопрос 2", "ответ": "Ответ 2"},
        {"question": "Без ответа"},
    ]}, ensure_ascii=False)
    payload, status = validate_section("flashcards", raw)
    assert status == "ok"
    assert payload == {"flashcards": [
        {"id": 1, "question": "Вопрос 1", "answer": "Ответ 1"},
        {"id": 2, "question": "Вопрос 2", "answer": "Ответ 2"},
    ]}
    # A bare list of cards is accepted too.
    assert validate_section("flashcards", json.dumps([{"question": "Q", "answer": "A"}]))[1] == "ok"


def test_quiz_given_as_a_dict_is_found():
    raw = json.dumps({"quiz": {"questions": [{"question": "Q", "options": ["A) 1", "B) 2"], "correct": "B"}]}})
    payload, status = validate_section("quiz", raw)
    assert status == "ok" and payload["quiz"][0]["correct"] == "B"
    single = json.dumps({"quiz": {"question": "Q", "options": ["A) 1", "B) 2"], "correct": "A"}})
    assert validate_section("quiz", single)[0]["quiz"][0]["options"] == ["A) 1", "B) 2"]


@pytest.mark.parametrize(
    "options,correct,expected",
    [
        (["A) Ставка", "B) Налог", "C) Курс", "D) Спрос"], "C", "C"),
        (["A) Ставка", "B) Налог", "C) Курс", "D) Спрос"], "c)", "C"),
        (["A) Ставка", "B) Налог", "C) Курс", "D) Спрос"], "D) Спрос", "D"),
        (["A) Ставка", "B) Налог", "C) Курс", "D) Спрос"], "Налог", "B"),
        (["A) Ставка", "B) Налог", "C) Курс", "D) Спрос"], "В", "B"),     # Cyrillic В written for Latin B
        (["А) Ставка", "Б) Налог", "В) Курс", "Г) Спрос"], "В", "C"),     # Russian lettering: В is third
        (["А) Ставка", "Б) Налог", "В) Курс", "Г) Спрос"], "Г", "D"),
        (["Верно", "Неверно"], "A", "A"),
        (["Верно", "Неверно"], "Неверно", "B"),
        ({"A": "Ставка", "B": "Налог"}, "B", "B"),
    ],
)
def test_quiz_correct_letter_is_normalised_to_a_matching_latin_option(options, correct, expected):
    raw = json.dumps({"quiz": [{"question": "Что?", "options": options, "correct": correct, "explanation": "Так."}]}, ensure_ascii=False)
    payload, status = validate_section("quiz", raw)
    assert status == "ok"
    item = payload["quiz"][0]
    assert item["correct"] == expected
    assert all(option.startswith(f"{letter}) ") for letter, option in zip("ABCD", item["options"]))
    assert any(option.startswith(item["correct"]) for option in item["options"])


def test_unmatched_quiz_items_are_dropped_and_the_rest_renumbered():
    raw = json.dumps({"quiz": [
        {"question": "Плохой", "options": ["A) 1", "B) 2"], "correct": "Z"},
        {"question": "Хороший", "options": ["A) 1", "B) 2"], "correct": "A"},
    ]}, ensure_ascii=False)
    payload, status = validate_section("quiz", raw)
    assert status == "ok"
    assert [(item["id"], item["question"]) for item in payload["quiz"]] == [(1, "Хороший")]


def test_cheatsheet_text_or_json_string():
    assert validate_section("cheatsheet", "# Шпаргалка\n\n- главное") == ({"content": "# Шпаргалка\n\n- главное"}, "ok")
    assert validate_section("cheatsheet", '{"cheatsheet": "# Коротко"}') == ({"content": "# Коротко"}, "ok")
    assert validate_section("cheatsheet", "```markdown\n# Коротко\n```") == ({"content": "# Коротко"}, "ok")


# --- code blocks inside the answer (programming lectures) ------------------------------------

CODE = "```python\nprint(len('abc'))\n```"
CODE_SUMMARY = {"title": "Строки в Python", "subject": "Информатика",
                "content": f"## Длина строки\n\n{CODE}\n\nВыведет 3.", "terms": []}
CODE_CARDS = {"flashcards": [{"question": f"Что выведет код?\n{CODE}", "answer": "3: в строке три символа."}]}
CODE_QUIZ = {"quiz": [{"question": f"Что выведет код?\n{CODE}", "options": ["A) 3", "B) 2"], "correct": "A",
                       "explanation": "Пример:\n```python\nlen('ab') == 2\n```"}]}


def _answer_shapes(payload):
    raw = json.dumps(payload, ensure_ascii=False)
    # Bare JSON, JSON inside one ```json fence, and with a byte-order mark in front.
    return [raw, f"```json\n{raw}\n```", f"\ufeff{raw}\n"]


@pytest.mark.parametrize("name,payload,field", [
    ("summarizer", CODE_SUMMARY, lambda clean: clean["content"]),
    ("flashcards", CODE_CARDS, lambda clean: clean["flashcards"][0]["question"]),
    ("quiz", CODE_QUIZ, lambda clean: clean["quiz"][0]["question"] + clean["quiz"][0]["explanation"]),
])
def test_code_blocks_inside_json_strings_are_kept(name, payload, field):
    for raw in _answer_shapes(payload):
        clean, status = validate_section(name, raw, source_text=TEXT)
        assert status == "ok", raw
        assert CODE in field(clean)


def test_quiz_with_code_keeps_its_options_and_answer():
    clean, status = validate_section("quiz", json.dumps(CODE_QUIZ, ensure_ascii=False))
    assert status == "ok"
    assert clean["quiz"][0]["options"] == ["A) 3", "B) 2"] and clean["quiz"][0]["correct"] == "A"
    assert clean["quiz"][0]["explanation"].endswith("```python\nlen('ab') == 2\n```")


def test_cheatsheet_code_blocks_stay_code_blocks():
    # A whole-answer fence is a wrapper only for markdown/md/text or no tag.
    assert validate_section("cheatsheet", CODE) == ({"content": CODE}, "ok")
    both_ends = f"{CODE}\n\nТекст между примерами.\n\n```python\nx = 1\n```"
    assert validate_section("cheatsheet", both_ends) == ({"content": both_ends}, "ok")
    wrapped = f"```markdown\n# Коротко\n\n{CODE}\n```"
    assert validate_section("cheatsheet", wrapped) == ({"content": f"# Коротко\n\n{CODE}"}, "ok")
    as_json = json.dumps({"cheatsheet": f"# Коротко\n\n{CODE}"}, ensure_ascii=False)
    for raw in (as_json, f"```json\n{as_json}\n```"):
        assert validate_section("cheatsheet", raw) == ({"content": f"# Коротко\n\n{CODE}"}, "ok")


def test_a_degenerate_answer_does_not_stall_the_event_loop():
    # The old fence regex backtracked quadratically over long blank runs (8 000 lines: 0.5 s).
    blank_lines = "```markdown\n" + "\n" * 200_000 + "# x"
    blank_json = "```json\n" + " " * 200_000 + "{"
    started = time.perf_counter()
    for raw in (blank_lines, blank_json):
        validate_section("cheatsheet", raw)
        base.split_outer_fence(raw + "\n```")
    assert time.perf_counter() - started < 0.5


def test_parse_model_json_reads_the_whole_answer_first():
    inner = {"content": f"Пример:\n{CODE}"}
    raw = json.dumps(inner, ensure_ascii=False)
    assert base.parse_model_json(raw) == inner
    assert base.parse_model_json(f"```json\n{raw}\n```") == inner
    assert base.parse_model_json(f"```JSON\n[{raw}]\n```") == [inner]
    # Prose around a fenced answer still goes through the old fallback.
    assert base.parse_model_json('Вот ответ:\n```json\n{"content": "Текст"}\n```\nГотово.') == {"content": "Текст"}
    for broken in ("не JSON", "", "```python\nprint(1)\n```"):
        assert base.parse_model_json(broken) == {}  # the fallback's "nothing usable"
    with pytest.raises(ValueError):
        base.parse_model_json(None)
    assert base.split_outer_fence(CODE) == ("python", "print(len('abc'))")
    assert base.split_outer_fence("```json {\"a\": 1}```") is None  # one line: not a wrapper
    assert base.split_outer_fence("текст ```x```") is None


# --- coordinator statuses, eviction, terminal events --------------------------------------------

def test_grounding_comes_first_and_agent_done_carries_status_and_result(monkeypatch):
    fake_run(monkeypatch, {
        "summarizer": json.dumps([SUMMARY], ensure_ascii=False),
        "flashcards": json.dumps({"flashcards": [{"front": "Что такое инфляция?", "back": "Рост цен."}]}, ensure_ascii=False),
        "quiz": json.dumps({"quiz": [{"question": "Что повышает ЦБ?", "options": ["Ключевую ставку", "Налоги"], "correct": "Ключевую ставку"}]}, ensure_ascii=False),
    })
    events = collect(["summarizer", "flashcards", "quiz"])
    types = [event["type"] for event in events]
    assert types[0] == "grounding"
    assert events[0]["sources"] == build_source_chunks(TEXT) and events[0]["source_count"] == 3
    assert types[1:4] == ["agent_start"] * 3
    assert types[4:7] == ["agent_done"] * 3 and types[-1] == "results"
    for event in events[4:7]:
        assert event["status"] == "ok" and "message" not in event and event["result"]
    results = events[-1]
    assert results["summarizer"]["content"].startswith("## Инфляция") and results["summarizer"]["source_ids"]
    assert results["flashcards"]["flashcards"][0]["question"] == "Что такое инфляция?"
    assert results["quiz"]["quiz"][0]["options"] == ["A) Ключевую ставку", "B) Налоги"]
    assert results["quiz"]["quiz"][0]["correct"] == "A"
    assert results["sections"] == {name: {"status": "ok"} for name in ("summarizer", "flashcards", "quiz")}
    assert results["warnings"] == []
    assert results["grounding"]["sources"] == build_source_chunks(TEXT)
    assert results["cheatsheet"] == {"content": ""}  # not requested


def test_invalid_answer_is_evicted_and_retried_once(monkeypatch):
    calls = fake_run(monkeypatch, {"summarizer": ["не JSON", json.dumps(SUMMARY, ensure_ascii=False)]})
    BaseAgent._run_cache[("cached",)] = "не JSON"
    events = collect(["summarizer"])
    assert [call["section"] for call in calls] == ["summarizer", "summarizer"]
    assert ("cached",) not in BaseAgent._run_cache
    assert events[-1]["type"] == "results" and events[-1]["sections"]["summarizer"] == {"status": "ok"}


def test_all_empty_answers_end_with_an_empty_error_and_no_results(monkeypatch):
    calls = fake_run(monkeypatch, {"summarizer": "", "flashcards": "{}", "quiz": json.dumps({"quiz": []})})
    events = collect(["summarizer", "flashcards", "quiz"])
    assert [call["section"] for call in calls].count("quiz") == 2  # one retry each
    done = [event for event in events if event["type"] == "agent_done"]
    assert {event["status"] for event in done} == {"empty"}
    assert all(event["message"] == SECTION_MESSAGES["empty"] and "result" not in event for event in done)
    assert events[-1] == {"type": "error", "code": "empty", "message": TERMINAL_MESSAGES["empty"]}
    assert not any(event["type"] == "results" for event in events)


def test_all_busy_answers_end_with_a_busy_error(monkeypatch):
    busy = AIError.busy()
    fake_run(monkeypatch, {"summarizer": busy, "flashcards": busy, "quiz": busy})
    events = collect(["summarizer", "flashcards", "quiz"])
    assert events[-1]["code"] == "busy" and events[-1]["message"] == TERMINAL_MESSAGES["busy"]
    assert {event["status"] for event in events if event["type"] == "agent_done"} == {"busy"}


def test_failed_and_timeout_terminal_codes(monkeypatch):
    fake_run(monkeypatch, {"summarizer": RuntimeError("provider down https://secret"), "flashcards": AIError.timeout(), "quiz": ""})
    events = collect(["summarizer", "flashcards", "quiz"])
    assert events[-1]["code"] == "timeout"
    statuses = {event["agent"]: event["status"] for event in events if event["type"] == "agent_done"}
    assert statuses == {"summarizer": "failed", "flashcards": "timeout", "quiz": "empty"}
    assert "secret" not in json.dumps(events, ensure_ascii=False)


def test_one_usable_core_section_gives_results_with_statuses_and_warnings(monkeypatch):
    fake_run(monkeypatch, {"summarizer": json.dumps(SUMMARY, ensure_ascii=False), "flashcards": "не JSON", "quiz": AIError.busy()})
    events = collect(["summarizer", "flashcards", "quiz"])
    results = events[-1]
    assert results["type"] == "results"
    assert results["sections"] == {
        "summarizer": {"status": "ok"},
        "flashcards": {"status": "empty", "message": SECTION_MESSAGES["empty"]},
        "quiz": {"status": "busy", "message": SECTION_MESSAGES["busy"]},
    }
    assert results["flashcards"] == {"error": SECTION_MESSAGES["empty"]}
    assert {warning["agent"] for warning in results["warnings"]} == {"flashcards", "quiz"}


def test_only_optional_sections_requested_and_failed_is_an_error(monkeypatch):
    fake_run(monkeypatch, {"cheatsheet": "   "})
    events = collect(["cheatsheet"])
    assert events[-1]["type"] == "error" and events[-1]["code"] == "empty"


def test_optional_section_ok_does_not_save_a_run_without_core(monkeypatch):
    fake_run(monkeypatch, {"summarizer": "", "cheatsheet": "# Шпаргалка"})
    events = collect(["summarizer", "cheatsheet"])
    assert events[-1]["type"] == "error"


def test_cheatsheet_is_requested_without_json_mode_even_when_the_text_mentions_json(monkeypatch):
    calls = fake_run(monkeypatch, {"summarizer": json.dumps(SUMMARY, ensure_ascii=False), "cheatsheet": "# Шпаргалка"})
    events = collect(["summarizer", "cheatsheet"])
    modes = {call["section"]: call["json_mode"] for call in calls}
    assert modes == {"summarizer": True, "cheatsheet": False}
    assert events[-1]["cheatsheet"]["content"] == "# Шпаргалка"


def test_unusable_answers_are_evicted_and_asked_again_while_valid_ones_stay_cached(monkeypatch):
    """Real BaseAgent.run and its cache with a fake Gemini provider."""
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-key")
    monkeypatch.setenv("GEMINI_MODELS", "gemini-2.5-flash-lite")
    provider_calls = []
    answers = {
        "summarizer": json.dumps(SUMMARY, ensure_ascii=False),
        "flashcards": "не JSON",
        "quiz": json.dumps(QUIZ, ensure_ascii=False),
    }

    class FakeClient:
        def __init__(self, api_key=None, **kwargs):
            async def generate_content(*, model, contents, config):
                name = section_of(contents)
                provider_calls.append(name)
                return SimpleNamespace(text=answers[name], candidates=[SimpleNamespace(finish_reason="STOP")])

            self.aio = SimpleNamespace(models=SimpleNamespace(generate_content=generate_content))

    monkeypatch.setattr(base.genai, "Client", FakeClient)
    first = collect(["summarizer", "flashcards", "quiz"])
    assert first[-1]["sections"]["flashcards"]["status"] == "empty"
    assert sorted(provider_calls) == ["flashcards", "flashcards", "quiz", "summarizer"]
    assert "не JSON" not in BaseAgent._run_cache.values()

    provider_calls.clear()
    second = collect(["summarizer", "flashcards", "quiz"])
    assert sorted(provider_calls) == ["flashcards", "flashcards"]  # the valid answers came from the cache
    assert second[-1]["summarizer"]["content"] == SUMMARY["content"]


def test_section_deadline_covers_the_retry(monkeypatch):
    monkeypatch.setenv("AI_AGENT_TIMEOUT_SECONDS", "0.3")

    async def slow():
        await asyncio.sleep(0.2)
        return "не JSON"

    fake_run(monkeypatch, {"summarizer": [slow, slow, slow]})
    events = collect(["summarizer"])
    assert events[-1] == {"type": "error", "code": "timeout", "message": TERMINAL_MESSAGES["timeout"]}


# --- run_section --------------------------------------------------------------------------------

def test_run_section_returns_a_validated_quiz_with_the_material_grounding(monkeypatch):
    calls = fake_run(monkeypatch, {"quiz": json.dumps({"quiz": [{"question": "Что?", "options": ["А) Да", "Б) Нет"], "correct": "Б"}]}, ensure_ascii=False)})
    result = asyncio.run(CoordinatorAgent(api_key="").run_section("quiz", TEXT, {"quiz_count": 3}))
    assert result["section"] == "quiz" and result["status"] == "ok"
    assert result["result"]["quiz"][0]["options"] == ["A) Да", "B) Нет"] and result["result"]["quiz"][0]["correct"] == "B"
    assert result["grounding"] == {"source_count": 3, "sources": build_source_chunks(TEXT)}
    assert calls[0]["json_mode"] is True


def test_run_section_errors(monkeypatch):
    fake_run(monkeypatch, {"quiz": "мусор", "flashcards": AIError.busy(), "summarizer": AIError.timeout()})
    with pytest.raises(AIError) as info:
        asyncio.run(CoordinatorAgent(api_key="").run_section("quiz", TEXT))
    assert info.value.status_code == 502
    with pytest.raises(AIError) as info:
        asyncio.run(CoordinatorAgent(api_key="").run_section("flashcards", TEXT))
    assert info.value.status_code == 429
    with pytest.raises(AIError) as info:
        asyncio.run(CoordinatorAgent(api_key="").run_section("summarizer", TEXT))
    assert info.value.status_code == 504
    with pytest.raises(ValueError):
        asyncio.run(CoordinatorAgent(api_key="").run_section("podcast", TEXT))


# --- /api/analyze/section ---------------------------------------------------------------------

@pytest.fixture
def api(monkeypatch):
    import main
    from fastapi.testclient import TestClient

    async def fake_user(request):
        return {"id": "section-user"}

    monkeypatch.setattr(main, "require_authenticated_user", fake_user)
    monkeypatch.setattr(main.limiter, "enabled", False)
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-key")
    return TestClient(main.app)


def test_section_endpoint_returns_a_validated_section(api, monkeypatch):
    fake_run(monkeypatch, {"quiz": json.dumps(QUIZ, ensure_ascii=False)})
    response = api.post("/api/analyze/section", json={"section": "quiz", "text": TEXT, "settings": {"quiz_count": 4}})
    assert response.status_code == 200
    body = response.json()
    assert body["section"] == "quiz" and body["status"] == "ok"
    assert body["result"]["quiz"][0] == {
        "id": 1, "question": "Что повышает ЦБ?", "options": ["A) Ключевую ставку", "B) Налоги"],
        "correct": "A", "explanation": "Ставка.", "source_ids": body["result"]["quiz"][0]["source_ids"],
    }
    assert body["grounding"] == {"source_count": 3, "sources": build_source_chunks(TEXT)}


def test_section_endpoint_keeps_a_summary_with_code_in_one_call(api, monkeypatch):
    calls = fake_run(monkeypatch, {"summarizer": json.dumps(CODE_SUMMARY, ensure_ascii=False)})
    response = api.post("/api/analyze/section", json={"section": "summarizer", "text": TEXT})
    assert response.status_code == 200
    assert CODE in response.json()["result"]["content"]
    assert len(calls) == 1  # accepted at once, no retry


def test_section_endpoint_validates_input(api, monkeypatch):
    calls = fake_run(monkeypatch, {"quiz": json.dumps(QUIZ)})
    assert api.post("/api/analyze/section", json={"section": "podcast", "text": TEXT}).status_code == 400
    assert api.post("/api/analyze/section", json={"section": "quiz", "text": "   "}).status_code == 400
    response = api.post("/api/analyze/section", json={"section": "quiz", "text": "x" * 300001})
    assert response.status_code == 413 and "300 000" in response.json()["detail"]
    assert calls == []


def test_section_endpoint_garbage_is_502_and_evicted(api, monkeypatch):
    calls = fake_run(monkeypatch, {"flashcards": "мусор"})
    BaseAgent._run_cache[("old",)] = "мусор"
    response = api.post("/api/analyze/section", json={"section": "flashcards", "text": TEXT})
    assert response.status_code == 502
    assert response.json()["code"] == "ai_failed" and response.json()["detail"]
    assert ("old",) not in BaseAgent._run_cache
    assert len(calls) == 2


def test_section_endpoint_busy_is_429(api, monkeypatch):
    fake_run(monkeypatch, {"summarizer": AIError.busy()})
    response = api.post("/api/analyze/section", json={"section": "summarizer", "text": TEXT})
    assert response.status_code == 429
    assert response.json()["code"] == "ai_busy" and response.headers["retry-after"] == "60"


def test_section_endpoint_without_any_provider_is_503(api, monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY")
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    response = api.post("/api/analyze/section", json={"section": "quiz", "text": TEXT})
    assert response.status_code == 503
    assert "GROQ" not in response.text and "GEMINI" not in response.text
