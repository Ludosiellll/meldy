"""Conversation ("Разговор") contract: sanitizer, prompts, coordinator hook and endpoints."""
import asyncio
import copy
import json
import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agents.base import BaseAgent, build_podcast_prompt, build_podcast_visuals_prompt  # noqa: E402
from utils import (  # noqa: E402
    VISUAL_ICONS,
    VISUAL_TYPES,
    sanitize_podcast_lines,
    sanitize_podcast_payload,
    sanitize_podcast_visuals,
    sanitize_visual,
)


VALID_VISUALS = {
    "term": {"type": "term", "term": "Фотосинтез", "definition": "Процесс образования органических веществ на свету."},
    "steps": {"type": "steps", "title": "Как идёт процесс", "items": ["Свет поглощается", "Вода расщепляется", "Образуется глюкоза"]},
    "compare": {
        "type": "compare",
        "title": "Световая и темновая фазы",
        "left": {"label": "Световая", "points": ["Нужен свет", "Выделяется кислород"]},
        "right": {"label": "Темновая", "points": ["Свет не нужен"]},
    },
    "formula": {
        "type": "formula",
        "title": "Скорость",
        "latex": "v = \\frac{s}{t}",
        "legend": [{"symbol": "v", "meaning": "скорость"}, {"symbol": "s", "meaning": "путь"}],
    },
    "chart": {
        "type": "chart",
        "title": "Доля фаз",
        "kind": "line",
        "unit": "%",
        "data": [{"label": "2020", "value": 12.5}, {"label": "2021", "value": 30}],
    },
    "timeline": {
        "type": "timeline",
        "title": "Открытия",
        "events": [{"date": "1771", "label": "Опыт Пристли"}, {"date": "1779", "label": "Работа Ингенхауза"}],
    },
    "diagram": {
        "type": "diagram",
        "title": "Цепочка",
        "nodes": [{"id": "a", "label": "Свет"}, {"id": "b", "label": "Хлорофилл"}, {"id": "c", "label": "Глюкоза"}],
        "edges": [{"from": "a", "to": "b", "label": "поглощается"}, {"from": "b", "to": "c"}],
    },
    "fact": {"type": "fact", "title": "Из лекции", "text": "Кислород выделяется в световой фазе."},
    "question": {"type": "question", "question": "Где идёт фотосинтез?", "answer": "В хлоропластах."},
    "scene": {"type": "scene", "title": "Фотосинтез", "icon": "leaf", "caption": "Как растение кормит само себя."},
}


# --- sanitize_visual -----------------------------------------------------------

def test_every_contract_type_has_a_valid_example():
    assert set(VALID_VISUALS) == set(VISUAL_TYPES)


@pytest.mark.parametrize("kind", sorted(VALID_VISUALS))
def test_valid_visual_of_each_type_is_kept_unchanged(kind):
    visual = copy.deepcopy(VALID_VISUALS[kind])
    assert sanitize_visual(visual) == VALID_VISUALS[kind]


def test_unknown_keys_are_removed_everywhere():
    visual = copy.deepcopy(VALID_VISUALS["compare"])
    visual["color"] = "red"
    visual["left"]["emoji"] = "x"
    cleaned = sanitize_visual(visual)
    assert cleaned == VALID_VISUALS["compare"]

    diagram = copy.deepcopy(VALID_VISUALS["diagram"])
    diagram["nodes"][0]["x"] = 10
    diagram["edges"][0]["weight"] = 3
    cleaned = sanitize_visual(diagram)
    assert "x" not in cleaned["nodes"][0]
    assert "weight" not in cleaned["edges"][0]


@pytest.mark.parametrize(
    "visual",
    [
        None,
        "term",
        [],
        {"type": "pie", "title": "x"},
        {"term": "без типа", "definition": "..."},
        {"type": "term", "term": "Только термин"},
        {"type": "steps", "title": "Один шаг", "items": ["Шаг"]},
        {"type": "steps", "items": ["a", "b"]},
        {"type": "compare", "title": "x", "left": {"label": "A", "points": []}, "right": {"label": "B", "points": ["b"]}},
        {"type": "formula", "title": "Длинная", "latex": "x" * 201},
        {"type": "formula", "title": "Пустая", "latex": "  "},
        {"type": "timeline", "title": "x", "events": [{"date": "1900", "label": "a"}]},
        {"type": "fact", "title": "x", "text": ""},
        {"type": "question", "question": "Без ответа?"},
    ],
)
def test_invalid_visuals_are_dropped(visual):
    assert sanitize_visual(visual) is None


@pytest.mark.parametrize(
    "data",
    [
        [{"label": "a", "value": 1}],  # fewer than 2 points
        [{"label": "a", "value": 1}, {"label": "b", "value": "много"}],  # not a number
        [{"label": "a", "value": 1}, {"label": "b", "value": float("inf")}],  # not finite
        [{"label": "a", "value": 1}, {"label": "b", "value": float("nan")}],
        [{"label": "a", "value": 1}, {"label": "b", "value": True}],  # bool is not a value
        [{"label": "a", "value": 1}, {"label": "", "value": 2}],  # empty label
        [{"label": "a", "value": 1}, {"label": "b", "value": 10 ** 400}],  # overflow
        [{"label": "a", "value": 1}, "b"],
        "1,2,3",
    ],
)
def test_invalid_chart_is_dropped(data):
    visual = {"type": "chart", "title": "Числа", "kind": "bar", "data": data}
    assert sanitize_visual(visual) is None


def test_chart_values_are_coerced_and_list_clamped():
    visual = {
        "type": "chart",
        "title": "Показатели",
        "kind": "pie",
        "data": [{"label": f"P{i}", "value": f"{i},5"} for i in range(10)] + [{"label": "x", "value": "40%"}],
    }
    cleaned = sanitize_visual(visual)
    assert cleaned["kind"] == "bar"
    assert len(cleaned["data"]) == 8
    assert cleaned["data"][0] == {"label": "P0", "value": 0.5}
    assert cleaned["data"][3]["value"] == 3.5
    assert "unit" not in cleaned
    assert sanitize_visual({"type": "chart", "title": "t", "data": [{"label": "a", "value": "40%"}, {"label": "b", "value": "7"}]})["data"] == [
        {"label": "a", "value": 40},
        {"label": "b", "value": 7},
    ]


def test_diagram_edges_must_reference_node_ids():
    visual = copy.deepcopy(VALID_VISUALS["diagram"])
    visual["edges"] = [
        {"from": "a", "to": "zzz"},  # unknown target
        {"from": "a", "to": "a"},  # self loop
        {"from": "a", "to": "b"},
        {"from": "a", "to": "b", "label": "дубль"},  # duplicate
    ]
    cleaned = sanitize_visual(visual)
    assert cleaned["edges"] == [{"from": "a", "to": "b"}]

    visual["edges"] = [{"from": "x", "to": "y"}]
    assert sanitize_visual(visual) is None


def test_diagram_limits_nodes_and_edges():
    nodes = [{"id": f"n{i}", "label": f"Узел {i}"} for i in range(10)] + [{"id": "n0", "label": "дубль"}]
    edges = [{"from": f"n{i}", "to": f"n{j}"} for i in range(7) for j in range(7) if i != j]
    edges.append({"from": "n8", "to": "n0"})  # node 8 is clamped away
    cleaned = sanitize_visual({"type": "diagram", "title": "Сеть", "nodes": nodes, "edges": edges})
    assert len(cleaned["nodes"]) == 7
    assert len(cleaned["edges"]) == 10
    ids = {node["id"] for node in cleaned["nodes"]}
    assert all(edge["from"] in ids and edge["to"] in ids for edge in cleaned["edges"])


def test_scene_icon_must_be_whitelisted():
    visual = dict(VALID_VISUALS["scene"], icon="rocket")
    assert sanitize_visual(visual) is None
    assert sanitize_visual(dict(VALID_VISUALS["scene"], icon=" Brain "))["icon"] == "brain"
    assert len(VISUAL_ICONS) == 18


def test_text_limits_are_applied():
    long = "слово " * 200
    term = sanitize_visual({"type": "term", "term": long, "definition": long})
    assert len(term["term"]) <= 80 and term["term"].endswith("…")
    assert len(term["definition"]) <= 280

    steps = sanitize_visual({"type": "steps", "title": long, "items": [long] * 9})
    assert len(steps["title"]) <= 80
    assert len(steps["items"]) == 6
    assert all(len(item) <= 120 for item in steps["items"])

    compare = sanitize_visual({
        "type": "compare",
        "title": "t",
        "left": {"label": long, "points": [long] * 6},
        "right": {"label": "B", "points": ["b"]},
    })
    assert len(compare["left"]["label"]) <= 80
    assert len(compare["left"]["points"]) == 4

    formula = sanitize_visual({
        "type": "formula",
        "title": "t",
        "latex": "$$E = mc^2$$",
        "legend": [{"symbol": "E", "meaning": long}] * 7 + [{"symbol": "", "meaning": "x"}],
    })
    assert formula["latex"] == "E = mc^2"
    assert len(formula["legend"]) == 5
    assert all(len(row["meaning"]) <= 120 for row in formula["legend"])

    timeline = sanitize_visual({"type": "timeline", "title": "t", "events": [{"date": 1900 + i, "label": "x"} for i in range(9)]})
    assert len(timeline["events"]) == 6
    assert timeline["events"][0]["date"] == "1900"

    for kind, field in (("fact", "text"), ("question", "answer"), ("scene", "caption")):
        base = copy.deepcopy(VALID_VISUALS[kind])
        base[field] = long
        assert len(sanitize_visual(base)[field]) <= 280


def test_whitespace_is_collapsed_and_type_is_case_insensitive():
    cleaned = sanitize_visual({"type": " Term ", "term": "  Атом \n ", "definition": "Мельчайшая\n\nчастица"})
    assert cleaned == {"type": "term", "term": "Атом", "definition": "Мельчайшая частица"}


# --- sanitize_podcast_lines --------------------------------------------------------

def test_legacy_lines_are_unchanged():
    legacy = [
        {"speaker": "Макс", "text": "Софья, о чём сегодня?"},
        {"speaker": "Софья", "text": "О фотосинтезе."},
    ]
    with_sources = [
        {"speaker": "Макс", "text": "Что такое фотосинтез?", "source_ids": ["S01"]},
        {"speaker": "Софья", "text": "Это процесс на свету.", "source_ids": ["S01", "S02"]},
    ]
    assert sanitize_podcast_lines(copy.deepcopy(legacy)) == legacy
    assert sanitize_podcast_lines(copy.deepcopy(with_sources)) == with_sources


def test_lines_keep_valid_visuals_and_drop_invalid_ones_but_not_the_line():
    lines = [
        {"speaker": "Макс", "text": "Начнём.", "visual": VALID_VISUALS["scene"], "mood": "happy"},
        {"speaker": "Софья", "text": "Вот числа.", "visual": {"type": "chart", "title": "x", "data": [{"label": "a", "value": "?"}]}},
        {"speaker": "Макс", "text": "   "},
        {"speaker": "Софья", "text": None},
        "строка",
        {"speaker": "", "text": "Без имени"},
        {"speaker": "Макс", "text": "Источники", "source_ids": ["[s03]", "S03", "bad", 4]},
    ]
    cleaned = sanitize_podcast_lines(lines)
    assert cleaned[0] == {"speaker": "Макс", "text": "Начнём.", "visual": VALID_VISUALS["scene"]}
    assert cleaned[1] == {"speaker": "Софья", "text": "Вот числа."}
    assert cleaned[2] == {"speaker": "Макс", "text": "Без имени"}
    assert cleaned[3] == {"speaker": "Макс", "text": "Источники", "source_ids": ["S03"]}
    assert len(cleaned) == 4


def test_transliterated_host_names_map_to_the_two_voices():
    cleaned = sanitize_podcast_lines([
        {"speaker": "Max", "text": "Hi"},
        {"speaker": "Sofia", "text": "Hello"},
        {"speaker": "Гость", "text": "Привет"},
    ])
    assert [line["speaker"] for line in cleaned] == ["Макс", "Софья", "Гость"]


def test_lines_are_clamped_and_non_lists_rejected():
    many = [{"speaker": "Макс", "text": f"Реплика {i}"} for i in range(60)]
    assert len(sanitize_podcast_lines(many)) == 40
    assert sanitize_podcast_lines({"podcast": many}) == []
    assert sanitize_podcast_lines(None) == []


def test_payload_without_usable_lines_becomes_an_error():
    assert sanitize_podcast_payload({"podcast": []}) == {"error": "Ответ ИИ пришёл в неверном формате"}
    assert sanitize_podcast_payload({"error": "x"}) == {"error": "x"}
    assert sanitize_podcast_payload({"podcast": [{"speaker": "Макс", "text": "Привет"}], "extra": 1}) == {
        "podcast": [{"speaker": "Макс", "text": "Привет"}]
    }


def test_visual_items_are_filtered_by_index():
    items = [
        {"index": 0, "visual": VALID_VISUALS["scene"]},
        {"index": "2", "visual": VALID_VISUALS["term"]},
        {"index": 2, "visual": VALID_VISUALS["fact"]},  # duplicate index, first wins
        {"index": 5, "visual": VALID_VISUALS["fact"]},  # out of range
        {"index": -1, "visual": VALID_VISUALS["fact"]},
        {"index": True, "visual": VALID_VISUALS["fact"]},
        {"index": 1, "visual": {"type": "scene", "title": "x", "icon": "rocket", "caption": "y"}},
    ]
    assert sanitize_podcast_visuals(items, 3) == [
        {"index": 0, "visual": VALID_VISUALS["scene"]},
        {"index": 2, "visual": VALID_VISUALS["term"]},
    ]
    assert sanitize_podcast_visuals(items, 0) == []
    assert sanitize_podcast_visuals("x", 3) == []


# --- prompts --------------------------------------------------------------------------

@pytest.mark.parametrize("builder", [build_podcast_prompt, build_podcast_visuals_prompt])
def test_prompts_describe_the_whole_visual_contract(builder):
    prompt = builder()
    assert "{{" not in prompt and "}}" not in prompt
    for kind in VISUAL_TYPES:
        assert f'"type": "{kind}"' in prompt, kind
    for icon in VISUAL_ICONS:
        assert icon in prompt
    assert "JSON" in prompt  # BaseAgent switches the provider into JSON mode on this word
    assert "```json" in prompt  # explicitly forbids the fence


def test_podcast_prompt_asks_for_grounded_two_host_conversation():
    prompt = build_podcast_prompt()
    assert '"podcast": [' in prompt
    assert '"speaker": "Макс"' in prompt and '"speaker": "Софья"' in prompt
    assert '"source_ids"' in prompt
    assert "10 до 16" in prompt and "45 слов" in prompt
    assert "40–60%" in prompt
    # The example block (between the outer braces) is valid JSON once "..." are filled.
    example = prompt[prompt.index("{\n"): prompt.rindex("}") + 1]
    parsed = json.loads(example)
    assert [line["speaker"] for line in parsed["podcast"]] == ["Макс", "Софья", "Макс"]
    assert sanitize_visual(parsed["podcast"][0]["visual"]) is not None


def test_visuals_prompt_forbids_new_lines():
    prompt = build_podcast_visuals_prompt()
    assert '"visuals": [' in prompt and '"index": 0' in prompt
    assert "новые реплики добавлять нельзя" in prompt
    example = prompt[prompt.index("{\n"): prompt.rindex("}") + 1]
    assert json.loads(example)["visuals"][0]["index"] == 0


# --- coordinator hook -------------------------------------------------------------------

def test_coordinator_sanitizes_podcast_and_keeps_lexical_source_ids(monkeypatch):
    from agents.coordinator import CoordinatorAgent

    model_answer = json.dumps({
        "podcast": [
            {"speaker": "Макс", "text": "Что такое суперпозиция?", "source_ids": ["S01"], "visual": VALID_VISUALS["scene"]},
            {"speaker": "Софья", "text": "Суперпозиция означает сочетание нескольких состояний до измерения.",
             "visual": {"type": "chart", "title": "x", "data": [{"label": "a", "value": "много"}]}},
            {"speaker": "Макс", "text": ""},
        ]
    }, ensure_ascii=False)

    async def fake_run(self, system_prompt, user_text):
        assert "ФРАГМЕНТЫ ИСТОЧНИКА" in system_prompt
        return model_answer

    monkeypatch.setattr(BaseAgent, "run", fake_run)
    text = "Квантовая механика описывает состояние частицы.\n\nСуперпозиция означает сочетание нескольких состояний до измерения."

    async def collect():
        events = []
        async for event in CoordinatorAgent(api_key="").process(text, enabled_agents=["podcast"]):
            events.append(event)
        return events

    events = asyncio.run(collect())
    assert events[0]["label"] == "Разговор"
    podcast = events[-1]["podcast"]["podcast"]
    assert len(podcast) == 2
    assert podcast[0]["visual"] == VALID_VISUALS["scene"]
    assert "visual" not in podcast[1]
    # enrich_agent_result still overwrites ids lexically.
    assert podcast[1]["source_ids"] == ["S02"]


# --- endpoints --------------------------------------------------------------------------

@pytest.fixture
def api(monkeypatch):
    import main
    from fastapi.testclient import TestClient

    async def fake_user(request):
        return {"id": "test-user"}

    monkeypatch.setattr(main, "require_authenticated_user", fake_user)
    monkeypatch.setattr(main.limiter, "enabled", False)
    calls = []

    def answer_with(raw):
        async def fake_run(self, system_prompt, user_text):
            calls.append({"system": system_prompt, "user": user_text})
            if isinstance(raw, Exception):
                raise raw
            return raw
        monkeypatch.setattr(main.BaseAgent, "run", fake_run)

    client = TestClient(main.app)
    client.answer_with = answer_with
    client.calls = calls
    return client


SOURCE = "Фотосинтез идёт в хлоропластах.\n\nВ 2020 году доля составила 12,5 процента, в 2021 году — 30 процентов."
FAILURE = {"detail": "Не удалось подготовить разговор. Попробуйте ещё раз."}


def test_generate_returns_sanitized_grounded_lines(api):
    api.answer_with("```json\n" + json.dumps({
        "podcast": [
            {"speaker": "Макс", "text": "Где идёт фотосинтез?", "visual": VALID_VISUALS["scene"]},
            {"speaker": "Софья", "text": "В хлоропластах.", "visual": {"type": "scene", "title": "x", "icon": "rocket", "caption": "y"}},
            {"speaker": "Макс", "text": "А доля в 2021 году?", "visual": {
                "type": "chart", "title": "Доля", "kind": "bar", "unit": "%",
                "data": [{"label": "2020", "value": 12.5}, {"label": "2021", "value": 30}],
            }},
        ]
    }, ensure_ascii=False) + "\n```")
    response = api.post("/api/podcast/generate", json={
        "context": SOURCE,
        "title": "Фотосинтез",
        "terms": [{"term": "Хлоропласт", "definition": "Органоид клетки"}, "мусор"],
    })
    assert response.status_code == 200
    podcast = response.json()["podcast"]
    assert [line["speaker"] for line in podcast] == ["Макс", "Софья", "Макс"]
    assert podcast[0]["visual"] == VALID_VISUALS["scene"]
    assert "visual" not in podcast[1]
    assert podcast[2]["visual"]["data"][1] == {"label": "2021", "value": 30}
    assert all(isinstance(line["source_ids"], list) for line in podcast)
    assert podcast[1]["source_ids"] == ["S01"]

    call = api.calls[-1]
    assert "[S01] Фотосинтез идёт в хлоропластах." in call["system"]
    assert call["system"].startswith(build_podcast_prompt())
    assert "НАЗВАНИЕ МАТЕРИАЛА: Фотосинтез" in call["user"]
    assert "- Хлоропласт — Органоид клетки" in call["user"]
    assert SOURCE in call["user"]


def test_generate_validates_input(api):
    api.answer_with("{}")
    assert api.post("/api/podcast/generate", json={"context": "x" * 20001}).status_code == 413
    assert api.post("/api/podcast/generate", json={"context": "   "}).status_code == 400
    assert api.post("/api/podcast/generate", json={}).status_code == 422
    assert api.calls == []


@pytest.mark.parametrize("raw", ["", "не JSON", json.dumps({"podcast": []}), json.dumps({"podcast": [{"speaker": "Макс", "text": ""}]})])
def test_generate_invalid_model_output_is_502(api, raw):
    BaseAgent._run_cache[("cached-prompt", "cached-text")] = raw
    api.answer_with(raw)
    response = api.post("/api/podcast/generate", json={"context": SOURCE})
    assert response.status_code == 502
    assert response.json() == FAILURE
    # The unusable answer is evicted so "Попробуйте ещё раз" really asks again.
    assert ("cached-prompt", "cached-text") not in BaseAgent._run_cache


def test_generate_provider_failure_is_502_without_details(api):
    from fastapi import HTTPException

    api.answer_with(HTTPException(status_code=500, detail="Ошибка ИИ (Groq): secret-provider-url"))
    response = api.post("/api/podcast/generate", json={"context": SOURCE})
    assert response.status_code == 502
    assert response.json() == FAILURE
    assert "secret" not in response.text

    api.answer_with(RuntimeError("boom https://provider.invalid/key=abc"))
    response = api.post("/api/podcast/generate", json={"context": SOURCE})
    assert response.status_code == 502
    assert "provider" not in response.text


def test_visuals_returns_only_valid_items_for_existing_lines(api):
    api.answer_with(json.dumps({
        "visuals": [
            {"index": 0, "visual": VALID_VISUALS["term"]},
            {"index": 1, "visual": VALID_VISUALS["fact"]},  # line 1 has no text
            {"index": 2, "visual": VALID_VISUALS["question"]},
            {"index": 9, "visual": VALID_VISUALS["steps"]},
            {"index": 2, "visual": VALID_VISUALS["steps"]},
        ]
    }, ensure_ascii=False))
    lines = [
        {"speaker": "Макс", "text": "Что такое фотосинтез?"},
        {"speaker": "Софья", "text": ""},
        {"speaker": "Софья", "text": "Это процесс в хлоропластах.", "source_ids": ["S01"]},
    ]
    response = api.post("/api/podcast/visuals", json={"lines": lines, "context": SOURCE, "terms": [{"term": "Хлоропласт"}]})
    assert response.status_code == 200
    assert response.json() == {"visuals": [
        {"index": 0, "visual": VALID_VISUALS["term"]},
        {"index": 2, "visual": VALID_VISUALS["question"]},
    ]}
    call = api.calls[-1]
    assert call["system"] == build_podcast_visuals_prompt()
    assert "[0] Макс: Что такое фотосинтез?" in call["user"]
    assert "[2] Софья: Это процесс в хлоропластах." in call["user"]
    assert "[1]" not in call["user"]
    assert "- Хлоропласт" in call["user"]
    assert SOURCE in call["user"]


def test_visuals_accepts_a_bare_list_answer(api):
    api.answer_with(json.dumps([{"index": 0, "visual": VALID_VISUALS["scene"]}], ensure_ascii=False))
    response = api.post("/api/podcast/visuals", json={"lines": [{"speaker": "Макс", "text": "Привет"}]})
    assert response.status_code == 200
    assert response.json()["visuals"][0]["index"] == 0


def test_visuals_validates_input_and_output(api):
    api.answer_with(json.dumps({"visuals": [{"index": 3, "visual": VALID_VISUALS["scene"]}]}))
    line = {"speaker": "Макс", "text": "Привет"}
    assert api.post("/api/podcast/visuals", json={"lines": [line] * 41}).status_code == 413
    assert api.post("/api/podcast/visuals", json={"lines": [line], "context": "x" * 15001}).status_code == 413
    assert api.post("/api/podcast/visuals", json={"lines": [{"speaker": "Макс", "text": " "}]}).status_code == 400
    assert api.calls == []

    response = api.post("/api/podcast/visuals", json={"lines": [line]})
    assert response.status_code == 502
    assert response.json() == FAILURE

    api.answer_with(RuntimeError("provider down"))
    response = api.post("/api/podcast/visuals", json={"lines": [line]})
    assert response.status_code == 502
    assert response.json() == FAILURE


def test_podcast_endpoints_require_a_session(monkeypatch):
    import main
    from fastapi.testclient import TestClient

    monkeypatch.setattr(main.limiter, "enabled", False)
    client = TestClient(main.app)
    assert client.post("/api/podcast/generate", json={"context": SOURCE}).status_code == 401
    assert client.post("/api/podcast/visuals", json={"lines": []}).status_code == 401


# --- /api/tts ---------------------------------------------------------------------------

class _FakeCommunicate:
    chunks: list = []
    fail_after: int | None = None

    def __init__(self, text, voice, rate=None):
        self.text = text

    async def stream(self):
        for index, chunk in enumerate(self.chunks):
            if self.fail_after is not None and index >= self.fail_after:
                raise RuntimeError("connection reset by edge")
            yield chunk


def _install_tts(monkeypatch, chunks, fail_after=None):
    import edge_tts

    fake = type("FakeCommunicate", (_FakeCommunicate,), {"chunks": chunks, "fail_after": fail_after})
    monkeypatch.setattr(edge_tts, "Communicate", fake)


def test_tts_returns_audio_bytes(api, monkeypatch):
    _install_tts(monkeypatch, [
        {"type": "WordBoundary", "offset": 1},
        {"type": "audio", "data": b"ID3"},
        {"type": "audio", "data": b"-mp3"},
    ])
    response = api.post("/api/tts", json={"text": "Привет", "role": "female"})
    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/mpeg"
    assert response.content == b"ID3-mp3"


def test_tts_empty_audio_is_502(api, monkeypatch):
    _install_tts(monkeypatch, [{"type": "WordBoundary", "offset": 1}])
    response = api.post("/api/tts", json={"text": "Привет"})
    assert response.status_code == 502
    assert response.content != b""


def test_tts_failure_mid_stream_is_502_without_details(api, monkeypatch):
    _install_tts(monkeypatch, [{"type": "audio", "data": b"ID3"}, {"type": "audio", "data": b"x"}], fail_after=1)
    response = api.post("/api/tts", json={"text": "Привет"})
    assert response.status_code == 502
    assert "edge" not in response.text and "reset" not in response.text


def test_tts_rejects_empty_text(api):
    assert api.post("/api/tts", json={"text": "   "}).status_code == 400


# --- grounding of numbers and dates ---------------------------------------------------

MEMORY_SOURCE = (
    "В 1885 году Эббингауз проверял, сколько помнит. Через 20 минут он помнил 58% слогов, "
    "через 1 день — 33%, через 31 день — 21%. В выборке было 12 500 слогов, доля ошибок 12,5 процента."
)


def _chart(values):
    return {
        "type": "chart",
        "title": "Кривая забывания",
        "kind": "line",
        "unit": "%",
        "data": [{"label": f"P{i}", "value": value} for i, value in enumerate(values)],
    }


def test_grounded_chart_is_kept_and_invented_chart_is_dropped():
    lines = [
        {"speaker": "Макс", "text": "Цифры из лекции.", "visual": _chart([58, 33, 21])},
        {"speaker": "Софья", "text": "Выдуманные цифры.", "visual": _chart([58, 40, 21])},
        {"speaker": "Макс", "text": "Разные записи чисел.", "visual": _chart(["12 500", 12500, "12,5", 12.5])},
    ]
    cleaned = sanitize_podcast_lines(copy.deepcopy(lines), source_text=MEMORY_SOURCE)
    assert cleaned[0]["visual"]["data"][1]["value"] == 33
    assert "visual" not in cleaned[1]  # 40 is not in the material
    assert cleaned[1]["text"] == "Выдуманные цифры."  # the line itself stays
    assert [point["value"] for point in cleaned[2]["visual"]["data"]] == [12500, 12500, 12.5, 12.5]


def test_charts_and_timelines_without_a_source_are_dropped():
    timeline = {"type": "timeline", "title": "История", "events": [{"date": "1885", "label": "Опыт"}, {"date": "1968", "label": "Модель"}]}
    lines = [
        {"speaker": "Макс", "text": "График.", "visual": _chart([58, 33])},
        {"speaker": "Софья", "text": "Даты.", "visual": timeline},
        {"speaker": "Макс", "text": "Термин.", "visual": VALID_VISUALS["term"]},
    ]
    cleaned = sanitize_podcast_lines(copy.deepcopy(lines))
    assert "visual" not in cleaned[0] and "visual" not in cleaned[1]
    assert cleaned[2]["visual"] == VALID_VISUALS["term"]


def test_timeline_dates_must_appear_in_the_source():
    source = "В 1885 году вышла книга. В XIX веке память изучали на себе. 12 апреля 1961 года — полёт."
    good = {"type": "timeline", "title": "История", "events": [
        {"date": "1885 г.", "label": "Книга"},
        {"date": "XIX век", "label": "Опыты"},
        {"date": "12 апреля 1961", "label": "Полёт"},
    ]}
    bad = {"type": "timeline", "title": "История", "events": [{"date": "1885", "label": "Книга"}, {"date": "1990", "label": "Нет в тексте"}]}
    assert sanitize_podcast_lines([{"speaker": "Макс", "text": "a", "visual": good}], source_text=source)[0]["visual"] == good
    assert "visual" not in sanitize_podcast_lines([{"speaker": "Макс", "text": "a", "visual": bad}], source_text=source)[0]


def test_visual_items_are_grounded_too():
    items = [
        {"index": 0, "visual": _chart([58, 33])},
        {"index": 1, "visual": _chart([58, 99])},
    ]
    assert [item["index"] for item in sanitize_podcast_visuals(items, 2, source_text=MEMORY_SOURCE)] == [0]
    assert sanitize_podcast_visuals(items, 2) == []


def test_number_strings_with_thousands_separators():
    cleaned = sanitize_visual(_chart(["12,500", "1,234,567", "12,5", "12 500"]))
    assert [point["value"] for point in cleaned["data"]] == [12500, 1234567, 12.5, 12500]


def test_percent_in_latex_is_escaped():
    cleaned = sanitize_visual({"type": "formula", "title": "КПД", "latex": "\\eta = \\frac{A_p}{A_z} \\cdot 100%"})
    assert cleaned["latex"] == "\\eta = \\frac{A_p}{A_z} \\cdot 100\\%"
    already = sanitize_visual({"type": "formula", "title": "Доля", "latex": "w = 40\\% \\cdot m"})
    assert already["latex"] == "w = 40\\% \\cdot m"


def test_fact_lines_point_at_the_fragment_of_the_quote():
    from utils import build_source_chunks, enrich_agent_result

    text = (
        "Фотосинтез идёт в хлоропластах растительной клетки.\n\n"
        "Кислород выделяется в световой фазе, когда вода расщепляется на свету."
    )
    chunks = build_source_chunks(text, chunk_chars=60)
    assert [chunk["id"] for chunk in chunks][:2] == ["S01", "S02"]
    lines = [{
        "speaker": "Софья",
        "text": "Хлоропласты — это фабрики клетки, а дальше смотрим цитату.",
        "source_ids": ["S01"],
        "visual": {"type": "fact", "title": "Из лекции", "text": "Кислород выделяется в световой фазе, когда вода расщепляется."},
    }]
    enriched = enrich_agent_result("podcast", {"podcast": lines}, chunks)
    assert enriched["podcast"][0]["source_ids"][0] == "S02"


def test_generate_drops_an_invented_chart(api):
    api.answer_with(json.dumps({"podcast": [
        {"speaker": "Макс", "text": "Смотрим цифры.", "visual": _chart([12.5, 30])},
        {"speaker": "Софья", "text": "А тут выдумка.", "visual": _chart([12.5, 77])},
    ]}, ensure_ascii=False))
    response = api.post("/api/podcast/generate", json={"context": SOURCE})
    podcast = response.json()["podcast"]
    assert podcast[0]["visual"]["type"] == "chart"
    assert "visual" not in podcast[1]


def test_provider_quota_is_reported_as_busy(api):
    from fastapi import HTTPException

    api.answer_with(HTTPException(status_code=429, detail="API_LIMIT_REACHED"))
    response = api.post("/api/podcast/generate", json={"context": SOURCE})
    assert response.status_code == 429
    assert response.json() == {"detail": "Сервис сейчас занят. Подождите минуту и попробуйте ещё раз."}
    response = api.post("/api/podcast/visuals", json={"lines": [{"speaker": "Макс", "text": "Привет"}]})
    assert response.status_code == 429


# --- grounding regressions: foreign values must not pass ----------------------------

def _facts(text):
    from utils import SourceFacts

    return SourceFacts(text)


def _bar(values):
    return sanitize_visual({
        "type": "chart", "title": "Числа", "kind": "bar",
        "data": [{"label": f"P{i}", "value": value} for i, value in enumerate(values)],
    })


def test_decimal_comma_is_never_read_as_a_tenfold_value():
    from utils import visual_is_grounded

    facts = _facts("Инфляция составила 7,4%, ставка — 1,5 процента, число пи около 3,14. Доля ошибок 12,5 процента.")
    for invented in (74, 15, 314, 125):
        assert not visual_is_grounded(_bar([7.4, invented]), facts), invented
    assert visual_is_grounded(_bar([7.4, 1.5, 3.14, 12.5]), facts)


def test_thousands_groups_are_not_split_into_separate_numbers():
    from utils import visual_is_grounded

    facts = _facts(MEMORY_SOURCE)  # "В выборке было 12 500 слогов"
    assert not visual_is_grounded(_bar([500, 12]), facts)
    assert visual_is_grounded(_bar([12500, 58]), facts)
    # A 4-digit year next to a number is two numbers; a row of 3-digit groups is a table row.
    assert visual_is_grounded(_bar([2019, 150]), _facts("В 2019 150 человек сдали экзамен."))
    assert visual_is_grounded(_bar([100, 200, 300]), _facts("Расход: 100 200 300 литров по годам."))


def test_chart_sign_must_match_the_source():
    from utils import visual_is_grounded

    assert not visual_is_grounded(_bar([-58, -33]), _facts(MEMORY_SOURCE))
    assert not visual_is_grounded(_bar([40, -40]), _facts("Температура упала до 40 градусов."))
    facts = _facts("Ночью было −12 °C, днём -3 °C, а шкала идёт от 1-5 баллов; война 1941-1945 годов.")
    assert visual_is_grounded(_bar([-12, -3]), facts)
    assert not visual_is_grounded(_bar([-1, -5]), facts)
    assert visual_is_grounded(_bar([1941, 1945]), facts)
    assert not visual_is_grounded(_bar([-1945, 1941]), facts)


def test_timeline_dates_must_be_whole_words_of_the_source():
    facts = _facts("Эббингауз начал опыты в 1885 году. В опыте было 18 серий. Каждый человек учил слоги.")
    for foreign in ("85", "88", "век", "18 век", "20 век"):
        assert not facts.has_date(foreign), foreign
    for date in ("1885", "1885 г.", "в 1885 году"):
        assert facts.has_date(date), date
    reform = _facts("Реформа 1861 года. В XIX веке. Война 1853–1856 годов, итоги подвели к 1860 году.")
    for foreign in ("18", "61", "86"):
        assert not reform.has_date(foreign), foreign
    for date in ("XIX век", "1861 год", "1853–1856", "1853-1856 гг.", "1856–1860"):
        assert reform.has_date(date), date


def test_generate_drops_a_timeline_with_foreign_dates(api):
    context = "Эббингауз начал опыты в 1885 году и описал кривую забывания. В опыте было 18 серий."
    api.answer_with(json.dumps({"podcast": [
        {"speaker": "Макс", "text": "Когда это было?", "visual": {
            "type": "timeline", "title": "История",
            "events": [{"date": "18 век", "label": "Начало"}, {"date": "85", "label": "Опыт"}],
        }},
        {"speaker": "Софья", "text": "В 1885 году.", "visual": {
            "type": "timeline", "title": "История",
            "events": [{"date": "1885", "label": "Опыт"}, {"date": "18 серий", "label": "Серии"}],
        }},
    ]}, ensure_ascii=False))
    response = api.post("/api/podcast/generate", json={"context": context})
    assert response.status_code == 200
    podcast = response.json()["podcast"]
    assert "visual" not in podcast[0]
    assert podcast[1]["visual"]["events"][0]["date"] == "1885"


# --- fragment ids that the player shows ---------------------------------------------

def test_chart_line_points_at_the_fragment_that_holds_its_numbers():
    from utils import build_source_chunks, enrich_agent_result

    text = (
        "Инфляция в России в 2022 году составила 11,9 процента, в 2023 году — 7,4 процента.\n\n"
        "Центральный банк повышает ключевую ставку, чтобы охладить кредитование и замедлить рост цен в экономике."
    )
    chunks = build_source_chunks(text)
    line = {
        "speaker": "Софья",
        "text": "Центральный банк повышает ставку, чтобы замедлить рост цен в экономике — вот как это выглядит.",
        "source_ids": ["S02"],
        "visual": {"type": "chart", "title": "Инфляция", "kind": "bar", "unit": "%",
                   "data": [{"label": "2022", "value": "11,9"}, {"label": "2023", "value": "7,4"}]},
    }
    lines = sanitize_podcast_lines([line], source_text=text)
    enriched = enrich_agent_result("podcast", {"podcast": lines}, chunks)
    # The model (and the words of the line) point at S02, but the numbers live in S01.
    assert enriched["podcast"][0]["source_ids"] == ["S01"]


def test_chart_numbers_spread_over_fragments_cite_each_of_them():
    from utils import build_source_chunks, visual_source_ids

    chunks = build_source_chunks("Через 20 минут помнили 58%.\n\nЧерез месяц помнили 21%.\n\nЗабывание идёт быстро.")
    chart = {"type": "chart", "title": "Кривая", "kind": "line", "data": [
        {"label": "20 мин", "value": 58}, {"label": "Месяц", "value": 21},
    ]}
    assert visual_source_ids(chart, chunks) == ["S01", "S02"]
    assert visual_source_ids({"type": "term", "term": "x", "definition": "y"}, chunks) is None


def test_only_word_for_word_quotes_cite_a_fragment():
    from utils import build_source_chunks, quote_source_ids, visual_source_ids

    text = (
        "Герман Эббингауз в 1885 году описал кривую забывания.\n\n"
        "Каждое повторение делает след памяти прочнее, поэтому после повторения кривая забывания становится более пологой."
    )
    chunks = build_source_chunks(text)
    verbatim = {"type": "fact", "title": "Цитата", "text": "Каждое повторение делает след памяти прочнее…"}
    shortened = {"type": "fact", "title": "Цитата", "text": "Каждое повторение делает след памяти прочнее… кривая забывания становится более пологой."}
    paraphrase = {"type": "fact", "title": "Факт", "text": "Эббингауз лично доказал, что сон удваивает память."}
    assert visual_source_ids(verbatim, chunks) == ["S02"]
    assert visual_source_ids(shortened, chunks) == ["S02"]
    assert visual_source_ids(paraphrase, chunks) == []
    assert quote_source_ids("Эббингауз", chunks) == []  # too short to be a quote

    lines = [{"speaker": "Софья", "text": "Эббингауз и сон.", "source_ids": ["S01"], "visual": paraphrase}]
    from utils import annotate_podcast

    annotate_podcast(lines, chunks)
    # A paraphrase keeps only word-matched ids of the line; the player does not show them as a source.
    assert lines[0]["source_ids"] == ["S01"]


def test_quote_across_two_fragments_cites_both():
    from utils import build_source_chunks, quote_source_ids

    chunks = build_source_chunks(
        "Фотосинтез идёт в хлоропластах растительной клетки.\n\n"
        "Кислород выделяется в световой фазе, когда вода расщепляется на свету.",
        chunk_chars=60,
    )
    assert quote_source_ids("Кислород выделяется в световой фазе, когда вода расщепляется на свету.", chunks) == ["S02", "S03"]


def test_visuals_endpoint_returns_checked_fragment_ids(api):
    context = (
        "Эббингауз в 1885 году описал кривую забывания.\n\n"
        "Через 20 минут он помнил 58% слогов, через 1 день — 33%."
    )
    api.answer_with(json.dumps({"visuals": [
        {"index": 0, "visual": VALID_VISUALS["term"]},
        {"index": 1, "visual": _chart([58, 33])},
        {"index": 2, "visual": {"type": "fact", "title": "Лично", "text": "Эббингауз лично доказал, что сон удваивает память."}},
    ]}, ensure_ascii=False))
    lines = [
        {"speaker": "Макс", "text": "Что такое фотосинтез?"},
        {"speaker": "Софья", "text": "Смотрим на цифры.", "source_ids": ["S01"]},
        {"speaker": "Макс", "text": "А сон?", "source_ids": ["S01"]},
    ]
    response = api.post("/api/podcast/visuals", json={"lines": lines, "context": context})
    assert response.status_code == 200
    visuals = {item["index"]: item for item in response.json()["visuals"]}
    assert "source_ids" not in visuals[0]  # a term makes no checkable claim
    assert visuals[1]["source_ids"] == ["S02"]
    assert visuals[2]["source_ids"] == []  # a paraphrase is not a quote


def test_prompts_ask_for_word_for_word_quotes_and_mhchem():
    for prompt in (build_podcast_prompt(), build_podcast_visuals_prompt()):
        assert "дословная цитата" in prompt
        assert "Пересказ — это не \"fact\"" in prompt
        assert "\\\\ce{6CO2 + 6H2O ->[$h\\\\nu$] C6H12O6 + 6O2}" in prompt


def test_rate_limits_are_keyed_on_the_signed_in_user():
    import main
    from starlette.requests import Request

    def request(user=None):
        scope = {"type": "http", "method": "POST", "path": "/api/tts", "headers": [], "client": ("10.0.0.7", 1234), "state": {}}
        req = Request(scope)
        if user is not None:
            req.state.user = user
        return req

    assert main.user_or_ip_key(request({"id": "student-1"})) == "user:student-1"
    assert main.user_or_ip_key(request({"id": "student-2"})) == "user:student-2"
    assert main.user_or_ip_key(request()) == "10.0.0.7"


# --- /api/quick-prep (cheatsheet) -------------------------------------------------------

def test_quick_prep_returns_the_cheatsheet(api):
    api.answer_with(json.dumps({"cheatsheet": "# Шпаргалка\n\n- Главное", "key_points": []}, ensure_ascii=False))
    response = api.post("/api/quick-prep", json={"context": SOURCE})
    assert response.status_code == 200
    assert response.json()["cheatsheet"].startswith("# Шпаргалка")


@pytest.mark.parametrize("raw", ["не JSON", json.dumps({"cheatsheet": ""}), json.dumps({"key_points": ["a"]}), json.dumps(["x"])])
def test_quick_prep_failure_is_an_error_not_a_stand_in_cheatsheet(api, raw):
    BaseAgent._run_cache[("quick-prompt", "quick-text")] = raw
    api.answer_with(raw)
    response = api.post("/api/quick-prep", json={"context": SOURCE})
    assert response.status_code == 502
    assert response.json() == {"detail": "Не удалось создать шпаргалку. Попробуйте ещё раз."}
    assert ("quick-prompt", "quick-text") not in BaseAgent._run_cache


def test_quick_prep_reports_busy_provider_and_empty_text(api):
    from fastapi import HTTPException

    api.answer_with(HTTPException(status_code=429, detail="API_LIMIT_REACHED"))
    assert api.post("/api/quick-prep", json={"context": SOURCE}).status_code == 429
    api.answer_with(RuntimeError("provider down https://secret.invalid"))
    response = api.post("/api/quick-prep", json={"context": SOURCE})
    assert response.status_code == 502 and "secret" not in response.text
    assert api.post("/api/quick-prep", json={"context": "   "}).status_code == 400
