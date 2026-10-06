"""«Шпаргалка» (oral_sheet.py) и общий ключ эталона (oral.rubric_key).

Ключ /api/oral/rubric и листа — одна формула; подбор фрагментов по лекциям, загруженным один раз на
задачу, тот же. Чтение листа: 0, 1 и 300 вопросов (адреса запросов короче 8 КБ), чужие ключи и
rebuilt, испорченная строка, урезанные поля, short только своей версии эталона, страницы, лист без
колонки sheet. Запись: поток SSE (только data:), кэш перед списанием, одна оплата на двоих с
/rubric, возвраты, 429/504 → busy и стоп, лимит на середине → ai_limit, уход клиента, второй POST,
сверка → 409, не больше двух сборок на процесс со сдвигом стартов, keepalive, истёкший токен →
auth, «Остановить», дневной потолок, несохранённый эталон. Короткие строки: проверка кодом, PATCH
только sheet с created_at, пробованные пункты модели больше не отдаются, без единиц, пачки до 60.

Supabase — PostgREST в памяти из test_oral_api (здесь ещё JSON-пути в select, offset, колонка sheet,
истекающий токен), модель — подменённый BaseAgent.run, дневной лимит — QuotaServer из test_quota.
"""
import asyncio
import inspect
import json
import re
import sys
import time
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import oral  # noqa: E402
import oral_api  # noqa: E402
import oral_sheet  # noqa: E402
import quota  # noqa: E402
import supabase_rest  # noqa: E402
import test_oral_api  # noqa: E402
from agents.base import AIError, BaseAgent  # noqa: E402
from plans import AI_COSTS, FREE_DAILY_UNITS  # noqa: E402
from test_oral import BUDGET, BUDGET_ID, DEMO, ECON, ECON_ID, ECON_QUESTION, econ_points  # noqa: E402
from test_oral_api import ANON, FOREIGN_TEXT, URL, FakeSupabase, rubric_answer  # noqa: E402
from test_quota import QuotaServer  # noqa: E402

QUESTIONS = [
    ECON_QUESTION,
    "Инструменты центрального банка",
    "Ключевая ставка и инфляция",
    "Операции на открытом рынке и нормы резервов",
]
TITLES_SHORT = {
    "Цель политики — ценовая стабильность": "цель — ценовая стабильность",
    "Основной инструмент — ключевая ставка": "гл. инструмент — ключ. ставка",
    "Операции на открытом рынке": "операции на откр. рынке",
    "Нормы обязательных резервов": "нормы обяз. резервов",
}
POINT_KEYS = ["id", "title", "short", "essential", "source_quote", "source_ids"]
RUBRIC_KEYS = ["rubric_id", "built_at", "coverage", "coverage_note", "materials", "points"]
QUESTION_KEYS = {
    "question_id", "position", "label", "section", "text", "question_hash", "coverage", "coverage_method",
    "coverage_reason", "missing_note", "rubric", "rebuilt",
}
_KEY_LINE_RE = re.compile(r"^(q\d+p\d): (.*)$", re.M)


def _sort_key(value):
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return (0, value, "")
    return (1, 0, str(value or ""))


class SheetSupabase(FakeSupabase):
    """PostgREST в памяти: ещё JSON-пути в select (с псевдонимом и без), offset, числовой порядок,
    колонка sheet (или её отсутствие до миграции) и токен, который истекает после N вставок эталона."""

    def __init__(self):
        super().__init__()
        self.expired: set[str] = set()
        self.without_sheet_column = False
        self.expire_after_inserts: int | None = None
        self.inserted = 0
        self.clock = 0

    def handler(self, request: httpx.Request) -> httpx.Response:
        table = request.url.path.rsplit("/", 1)[-1]
        token = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
        if token in self.expired:
            self.requests.append(request)
            return httpx.Response(401, json={"code": "PGRST301", "message": "JWT expired"})
        if self.without_sheet_column and table == "oral_rubrics":
            if request.method == "GET" and "sheet" in request.url.params.get("select", "").split(","):
                self.requests.append(request)
                return httpx.Response(400, json={"code": "42703", "message": "column oral_rubrics.sheet does not exist"})
            if request.method == "PATCH" and "sheet" in json.loads(request.content):
                self.requests.append(request)
                return httpx.Response(400, json={"code": "PGRST204", "message": "Could not find the 'sheet' column"})
        if request.method == "GET":
            return self._get(request, table, test_oral_api.TOKENS.get(token))
        response = super().handler(request)
        if request.method == "POST" and table == "oral_rubrics" and response.status_code == 201 and json.loads(response.content):
            self.inserted += 1
            if self.expire_after_inserts is not None and self.inserted >= self.expire_after_inserts:
                self.expired.add(token)
        return response

    def _get(self, request, table, user):
        self.requests.append(request)
        if request.headers.get("apikey") != ANON or user is None:
            return httpx.Response(401, json={"code": "PGRST301", "message": "JWT expired"})
        params = list(request.url.params.multi_items())
        failure = self.fail.get(("GET", table))
        status = failure(request) if callable(failure) else failure
        if status:
            return httpx.Response(status, json={"code": "XX000", "message": FOREIGN_TEXT})
        if table == "oral_rubrics" and self.hidden_rubric_reads > 0:
            self.hidden_rubric_reads -= 1
            return httpx.Response(200, json=[])
        query = dict(params)
        rows = [row for row in self.tables[table] if row.get("user_id") == user and self._matches(row, params)]
        rows = self._ordered(rows, query.get("order"))[int(query.get("offset", 0)):]
        if query.get("limit") is not None:
            rows = rows[: int(query["limit"])]
        return httpx.Response(200, json=[self._project(row, params) for row in rows])

    def _insert(self, table, user, body, prefer, params):
        if table != "oral_rubrics":
            return super()._insert(table, user, body, prefer, params)
        created = []
        for values in body if isinstance(body, list) else [body]:
            self.clock += 1
            row = {"id": str(uuid.uuid4()), "user_id": user, "rubric_version": 1, "model": "", "sheet": None,
                   "created_at": f"2026-10-05T09:00:{self.clock % 60:02d}.{self.clock:06d}+00:00"}
            row.update(values)
            own = any(m["id"] == row.get("material_id") and m["user_id"] == user for m in self.tables["materials"])
            if row["user_id"] != user or not own:
                return httpx.Response(403, json={"code": "42501", "message": FOREIGN_TEXT})
            unique = ("user_id", "question_hash", "source_key", "rubric_version")
            if any(all(other.get(k) == row.get(k) for k in unique) for other in self.tables[table]):
                if "resolution=ignore-duplicates" in prefer:
                    continue
                return httpx.Response(409, json={"code": "23505", "message": FOREIGN_TEXT})
            self.tables[table].append(row)
            created.append(row)
        return httpx.Response(201, json=[self._project(row, params) for row in created])

    @staticmethod
    def _matches(row, params):
        return FakeSupabase._matches(row, [(key, value) for key, value in params if key != "offset"])

    @staticmethod
    def _ordered(rows, order):
        if not order:
            return rows
        for term in reversed(order.split(",")):
            column, _, direction = term.partition(".")
            rows = sorted(rows, key=lambda row: _sort_key(row.get(column)), reverse=direction == "desc")
        return rows

    @staticmethod
    def _project(row, params):
        select = dict(params).get("select")
        if not select or select == "*":
            return json.loads(json.dumps(row))
        projected = {}
        for column in select.split(","):
            alias, _, path = column.rpartition(":")
            parts = path.split("->")
            value = row.get(parts[0])
            for part in parts[1:]:
                value = value.get(part) if isinstance(value, dict) else None
            projected[alias or parts[-1]] = json.loads(json.dumps(value))
        return projected

    def rubrics(self):
        return self.tables["oral_rubrics"]


def short_answer(text, short_for=None):
    """Ответ модели на короткие строки: {ключ: строка} по строкам запроса «q1p1: <title>»."""
    pick = short_for or (lambda title: TITLES_SHORT.get(title, ""))
    return {key: pick(title) for key, title in _KEY_LINE_RE.findall(text)}


class SheetModel:
    """BaseAgent.run: эталон (по очереди, последний повторяется) и короткие строки по ключам запроса."""

    def __init__(self):
        self.calls: list[dict] = []
        self.rubrics: list = []
        self.shorts = None  # None — TITLES_SHORT; callable(text, kwargs) → ответ; исключение
        self.delay = 0.0
        self.active = 0
        self.max_active = 0
        self.on_rubric = None

    @property
    def rubric_calls(self):
        return [call for call in self.calls if call["kind"] == "rubric"]

    @property
    def short_calls(self):
        return [call for call in self.calls if call["kind"] == "short"]

    async def run(self, agent, system_prompt, user_text, **kwargs):
        kind = "short" if system_prompt == oral_sheet.SHORT_PROMPT else "rubric"
        self.calls.append({"kind": kind, "system": system_prompt, "text": user_text, "at": time.monotonic(), **kwargs})
        if kind == "short":
            if isinstance(self.shorts, BaseException):
                raise self.shorts
            answer = self.shorts(user_text, kwargs) if callable(self.shorts) else short_answer(user_text)
            return answer if isinstance(answer, str) else json.dumps(answer, ensure_ascii=False)
        self.active += 1
        self.max_active = max(self.max_active, self.active)
        try:
            if self.on_rubric is not None:
                self.on_rubric(user_text)
            if self.delay:
                await asyncio.sleep(self.delay)
            if not self.rubrics:
                item = rubric_answer()
            else:
                item = self.rubrics.pop(0) if len(self.rubrics) > 1 else self.rubrics[0]
            if isinstance(item, BaseException):
                raise item
            return item if isinstance(item, str) else json.dumps(item, ensure_ascii=False)
        finally:
            self.active -= 1


@pytest.fixture
def sheet(monkeypatch):
    import main
    from fastapi.testclient import TestClient

    monkeypatch.setitem(test_oral_api.TOKENS, "token-a2", "user-a")

    async def fake_user(request):
        token = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
        if token not in test_oral_api.TOKENS:
            raise HTTPException(status_code=401, detail="Требуется войти в аккаунт")
        return {"id": test_oral_api.TOKENS[token]}

    monkeypatch.setattr(main, "require_authenticated_user", fake_user)
    monkeypatch.setattr(main.limiter, "enabled", False)
    monkeypatch.setenv("SUPABASE_URL", URL)
    monkeypatch.setenv("SUPABASE_KEY", ANON)
    for name in ("GEMINI_API_KEY", "GROQ_API_KEY", "SHEET_DAILY_BUILDS", "SSE_KEEPALIVE_SECONDS"):
        monkeypatch.delenv(name, raising=False)
    fake = SheetSupabase()
    monkeypatch.setattr(supabase_rest, "_transport", httpx.MockTransport(fake.handler))
    model = SheetModel()

    async def fake_run(agent, system_prompt, user_text, **kwargs):
        return await model.run(agent, system_prompt, user_text, **kwargs)

    monkeypatch.setattr(BaseAgent, "run", fake_run)
    monkeypatch.setattr(BaseAgent, "forget", classmethod(lambda cls, raw: None))
    monkeypatch.setattr(oral_sheet, "BUILD_STAGGER_SECONDS", 0.0)
    monkeypatch.setattr(oral_sheet, "_gate", oral_sheet._BuildGate())
    oral_api._flights.clear()
    oral_sheet._jobs.clear()
    client = TestClient(main.app, headers={"Authorization": "Bearer token-a"})
    client.fake, client.model, client.main = fake, model, main
    yield client
    oral_api._flights.clear()
    oral_sheet._jobs.clear()


@pytest.fixture
def paid(sheet, monkeypatch, quota_on):
    """Лист с дневным лимитом ИИ как в работе: RPC consume/refund — QuotaServer, таблицы — SheetSupabase."""
    server = QuotaServer(inner=sheet.fake.handler)
    monkeypatch.setattr(supabase_rest, "_transport", httpx.MockTransport(server.handler))
    quota._REPORTED.clear()
    sheet.server = server
    yield sheet
    quota._REPORTED.clear()


def course(fake, texts, *, user="user-a", coverage="full", method="llm", fingerprint="fp-econ",
           lectures=(("Денежный рынок", ECON),), **exam_fields):
    """Экзамен с лекциями и вопросами; возвращает (exam_id, id вопросов, id первой лекции)."""
    material_ids = [fake.material(title, text, user=user) for title, text in lectures]
    exam_id = fake.exam(user=user)
    fake.row("exams", exam_id).update(exam_fields)
    for material_id in material_ids:
        fake.link(exam_id, material_id, user=user)
    evidence = (
        [{"material_id": material_ids[0], "material_title": "Денежный рынок", "source_id": "S02", "excerpt": "…"}]
        if material_ids else []
    )
    ids = [
        fake.question(
            exam_id, text, user=user, position=number, label=str(number), section=1, coverage=coverage,
            coverage_method=method, coverage_reason="Ответ есть во фрагментах лекций", missing_note="",
            evidence=evidence, materials_fingerprint=fingerprint, created_at=f"2026-10-01T08:00:{number % 60:02d}+00:00",
        )
        for number, text in enumerate(texts, start=1)
    ]
    return exam_id, ids, (material_ids[0] if material_ids else None)


def stored_rubric(material_id, coverage="full"):
    points = [] if coverage == "none" else [
        {"id": f"p{number}", "title": point["title"], "essential": point["essential"],
         "source_quote": point["source_quote"], "source_ids": point["source_ids"],
         "anchors": point["anchors"], "followup": point["followup"]}
        for number, point in enumerate(econ_points(), start=1)
    ]
    return {
        "v": 1, "question": "…", "coverage": coverage, "coverage_note": "Нет про резервы" if coverage == "partial" else "",
        "fragments_considered": 6, "fragments_total": 6,
        "materials": [{"key": "M1", "material_id": material_id, "title": "Денежный рынок"}],
        "points": points,
        "nearest": [{"source_id": "M1:S02", "material_id": material_id, "text": "…"}] if coverage == "none" else [],
    }


def rubric_row(fake, question_id, material_id, *, key=None, rubric=None, created_at="2026-10-04T10:00:00+00:00",
               sheet=None, user="user-a"):
    question = fake.row("exam_questions", question_id)
    row = {
        "id": str(uuid.uuid4()), "user_id": user, "question_hash": question["question_hash"],
        "source_key": key or oral.rubric_key(question, []), "rubric_version": 1, "material_id": material_id,
        "material_ids": [material_id], "question": question["text"],
        "rubric": stored_rubric(material_id) if rubric is None else rubric, "model": "", "created_at": created_at,
        "sheet": sheet,
    }
    fake.tables["oral_rubrics"].append(row)
    return row


def frames_of(text):
    frames = text.split("\n\n")
    assert frames[-1] == "", "поток должен кончаться пустой строкой"
    for frame in frames[:-1]:
        # Только data: с JSON (читатель клиента readSseStream не смотрит на event:) и комментарии keepalive.
        assert frame == ": keepalive" or re.fullmatch(r"data: \{.*\}", frame, flags=re.S), frame
    return frames[:-1]


def events_of(response):
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/event-stream")
    return [json.loads(frame[len("data: "):]) for frame in frames_of(response.text) if frame.startswith("data: ")]


def write(client, exam_id, **body):
    return client.post("/api/oral/sheet/write", json={"exam_id": exam_id, **body})


def read_sheet(client, exam_id, **headers):
    response = client.get(f"/api/oral/sheet?exam_id={exam_id}", headers=headers or None)
    assert response.status_code == 200, response.text
    return response.json()


def statuses(events):
    return [(event["question_id"], event["status"]) for event in events if event["type"] == "question"]


def in_one_loop(main, scenario):
    """Сценарий в одном цикле событий: фоновая задача записи живёт между запросами."""

    async def go():
        transport = httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver",
                                     headers={"Authorization": "Bearer token-a"}) as client:
            return await scenario(client)

    return asyncio.run(go())


async def until(predicate, timeout=10.0):
    deadline = time.monotonic() + timeout
    while not predicate():
        if time.monotonic() > deadline:
            raise AssertionError("не дождались")
        await asyncio.sleep(0.005)


def assert_plain_russian(response, status, detail=None):
    assert response.status_code == status, response.text
    body = response.json()
    assert set(body) <= {"detail", "code"}
    assert re.search(r"[А-Яа-яЁё]", body["detail"]) and FOREIGN_TEXT not in response.text
    if detail is not None:
        assert body["detail"] == detail


# ── Ключ эталона: одна формула у /api/oral/rubric и листа ──────────────────────


def legacy_key(row, exam_material_ids):
    """Ключ, как /api/oral/rubric считал его до oral.rubric_key (oral_api.py на 2026-10-05)."""
    fingerprint = row.get("materials_fingerprint")
    material_ids = None
    if not (isinstance(fingerprint, str) and fingerprint):
        material_ids = exam_material_ids
    evidence = row.get("evidence") if isinstance(row.get("evidence"), list) else []
    return oral.source_key(fingerprint, material_ids or [], evidence, row.get("coverage_method"))


EVIDENCE = [{"material_id": "m-1", "source_id": "S02", "excerpt": "…"}, {"material_id": "m-2", "source_id": "S07"}]


@pytest.mark.parametrize(
    "row",
    [
        {"materials_fingerprint": "fp", "evidence": EVIDENCE, "coverage_method": "llm"},
        {"materials_fingerprint": "fp", "evidence": EVIDENCE[::-1], "coverage_method": "llm"},
        {"materials_fingerprint": "fp", "evidence": EVIDENCE + EVIDENCE[:1], "coverage_method": "llm"},
        {"materials_fingerprint": "fp", "evidence": [None, "S02", {"material_id": "m-1"}, {"source_id": "S03"}, *EVIDENCE],
         "coverage_method": "llm"},
        {"materials_fingerprint": "fp", "evidence": {"material_id": "m-1", "source_id": "S02"}, "coverage_method": "llm"},
        {"materials_fingerprint": "fp", "evidence": "S02", "coverage_method": None},
        {"materials_fingerprint": "fp", "evidence": None, "coverage_method": "manual"},
        {"materials_fingerprint": None, "evidence": EVIDENCE, "coverage_method": "llm"},
        {"materials_fingerprint": "", "evidence": [], "coverage_method": None},
        {"materials_fingerprint": 17, "evidence": EVIDENCE, "coverage_method": "manual"},
        {"evidence": EVIDENCE},
        {},
    ],
)
def test_rubric_key_is_the_formula_of_the_rubric_endpoint(row):
    ids = ["b-material", "a-material", "b-material"]
    assert oral.rubric_key(row, ids) == legacy_key(row, ids)
    assert oral.rubric_key(dict(row, id="q1", text="Вопрос", position=3), ids) == legacy_key(row, ids)


def test_rubric_key_ignores_evidence_order_duplicates_and_junk_but_not_the_method_or_lectures():
    base = {"materials_fingerprint": "fp", "evidence": EVIDENCE, "coverage_method": "llm"}
    key = oral.rubric_key(base, [])
    assert oral.rubric_key(dict(base, evidence=EVIDENCE[::-1] + [EVIDENCE[0], None, {"material_id": "x"}]), []) == key
    assert oral.rubric_key(dict(base, coverage_method="manual"), []) != key
    assert oral.rubric_key(dict(base, coverage_method=None), []) != key
    assert oral.rubric_key(base, ["any"]) == key  # с отпечатком id лекций экзамена не нужны
    no_fp = dict(base, materials_fingerprint=None)
    assert oral.rubric_key(no_fp, ["b", "a"]) == oral.rubric_key(no_fp, ["a", "b", "a"])
    assert oral.rubric_key(no_fp, ["a"]) != oral.rubric_key(no_fp, ["a", "b"])
    assert len(key) == 40 and re.fullmatch(r"[0-9a-f]{40}", key)


def test_rubrics_built_by_the_rubric_endpoint_are_found_by_the_sheet(sheet):
    """Отпечаток есть и нет, ручная отметка: /api/oral/rubric сохраняет под тем же ключом, что ищет лист."""
    fake = sheet.fake
    exam_id, (with_fp, without_fp, manual), material_id = course(fake, QUESTIONS[:3])
    fake.row("exam_questions", without_fp)["materials_fingerprint"] = None
    fake.row("exam_questions", manual).update(coverage_method="manual", evidence=[])
    stored = {}
    for question_id in (with_fp, without_fp, manual):
        response = test_oral_api.post_rubric(sheet, exam_id, question_id)
        assert response.status_code == 200, response.text
        stored[question_id] = response.json()["rubric_id"]
    keys = {row["id"]: row["source_key"] for row in fake.rubrics()}
    assert keys[stored[without_fp]] == oral.rubric_key(fake.row("exam_questions", without_fp), [material_id])
    body = read_sheet(sheet, exam_id)
    assert {q["question_id"]: q["rubric"]["rubric_id"] for q in body["questions"]} == stored
    assert body["to_write"] == 0 and body["units"] == 0


# ── Подбор фрагментов с лекциями, загруженными один раз ────────────────────────


def test_a_shared_corpus_selects_exactly_what_a_fresh_one_does():
    materials = [
        oral.LectureMaterial(ECON_ID, "Денежный рынок", ECON),
        oral.LectureMaterial(BUDGET_ID, "Бюджетная политика", BUDGET),
        oral.LectureMaterial("33333333-3333-4333-8333-333333333333", "Нейронные сети", DEMO),
        oral.LectureMaterial(ECON_ID, "Повтор", "другой текст"),
        oral.LectureMaterial("44444444-4444-4444-8444-444444444444", "Скан", "   "),
    ]
    corpus = oral.build_corpus(materials)
    cases = [
        (ECON_QUESTION, [{"material_id": ECON_ID, "source_id": "S02"}, {"material_id": ECON_ID, "source_id": "S03"}]),
        ("Как обучается нейронная сеть?", []),
        ("Бюджетная политика: расходы и налоги", [{"material_id": BUDGET_ID, "source_id": "S02"}]),
        ("Квантовая хромодинамика", []),
        ("", None),
    ]
    for question, evidence in cases + cases[::-1]:  # поиск дополняет память индекса — подбор не меняется
        for budget in (oral.FRAGMENT_BUDGET_CHARS, 1500):
            fresh = oral.select_fragments(question, materials, evidence, budget=budget)
            shared = oral.select_fragments(question, materials, evidence, budget=budget, corpus=corpus)
            assert shared == fresh
            assert fresh.fragments or question == ""
    empty = oral.build_corpus([oral.LectureMaterial(ECON_ID, "Скан", " ")])
    assert oral.select_fragments("Вопрос", [], [], corpus=empty) == oral.select_fragments("Вопрос", [], [])


def test_the_sheet_sends_the_model_the_same_rubric_request_as_the_rubric_endpoint(sheet):
    fake = sheet.fake
    exam_id, (question_id,), _ = course(fake, [ECON_QUESTION], lectures=(("Денежный рынок", ECON), ("Бюджет", BUDGET)))
    assert test_oral_api.post_rubric(sheet, exam_id, question_id).status_code == 200
    via_rubric = sheet.model.rubric_calls[-1]
    fake.tables["oral_rubrics"].clear()
    events = events_of(write(sheet, exam_id))
    assert statuses(events) == [(question_id, "written")]
    via_sheet = sheet.model.rubric_calls[-1]
    assert via_sheet["text"] == via_rubric["text"] and via_sheet["system"] == via_rubric["system"]
    for name in ("temperature", "max_tokens", "json_mode", "thinking", "timeout", "use_cache"):
        assert via_sheet[name] == via_rubric[name]
    # Лекции экзамена прочитаны задачей один раз, а не на каждый вопрос.
    assert sum(1 for request in fake.requests if request.url.path.endswith("/materials")) == 2


# ── GET /api/oral/sheet ─────────────────────────────────────────────────────────


def test_routes_limits_and_sessions(sheet):
    declared = {(route.path, frozenset(route.methods)) for route in oral_sheet.router.routes}
    assert declared == {
        ("/api/oral/sheet", frozenset({"GET"})),
        ("/api/oral/sheet/write", frozenset({"POST"})),
        ("/api/oral/sheet/stop", frozenset({"POST"})),
    }
    assert sheet.main.oral_sheet_router is oral_sheet.router
    mounted = {(getattr(route, "path", None), frozenset(getattr(route, "methods", None) or ())) for route in sheet.main.app.routes}
    assert any(getattr(route, "original_router", None) is oral_sheet.router for route in sheet.main.app.routes) or (
        declared <= mounted
    )
    source = inspect.getsource(oral_sheet)
    assert '@limiter.limit("30/minute", key_func=user_or_ip_key)\nasync def oral_sheet(' in source
    assert '@limiter.limit("6/minute", key_func=user_or_ip_key)\nasync def oral_sheet_write(' in source
    assert oral_sheet.MAX_RUN_QUESTIONS == 60 and oral_sheet.PAGE_ROWS == 1000 and oral_sheet.HASH_CHUNK == 50
    assert oral_sheet.BUILD_SLOTS == 2 and oral_sheet.DEFAULT_DAILY_BUILDS == 400
    exam_id, _, _ = course(sheet.fake, QUESTIONS[:1])
    for method, path, body in (("GET", f"/api/oral/sheet?exam_id={exam_id}", None),
                               ("POST", "/api/oral/sheet/write", {"exam_id": exam_id}),
                               ("POST", "/api/oral/sheet/stop", {"exam_id": exam_id})):
        response = sheet.request(method, path, json=body, headers={"Authorization": "Bearer stranger"})
        assert_plain_russian(response, 401)
    assert sheet.model.calls == []


def test_writing_is_limited_per_user(sheet, monkeypatch):
    from ratelimit import RATE_LIMIT_DETAIL

    exam_id = sheet.fake.exam()
    other = sheet.fake.exam(user="user-b")
    monkeypatch.setattr(sheet.main.limiter, "enabled", True)
    sheet.main.limiter.reset()
    try:
        codes = [write(sheet, exam_id).status_code for _ in range(7)]
        assert codes == [200] * 6 + [429]
        assert_plain_russian(write(sheet, exam_id), 429, RATE_LIMIT_DETAIL)
        # Предел — по пользователю, а не по общему IP прокси.
        response = sheet.post("/api/oral/sheet/write", json={"exam_id": other}, headers={"Authorization": "Bearer token-b"})
        assert response.status_code == 200
    finally:
        sheet.main.limiter.reset()


def test_an_exam_without_questions(sheet):
    exam_id = sheet.fake.exam()
    sheet.fake.requests.clear()
    assert read_sheet(sheet, exam_id) == {
        "exam_id": exam_id, "mapping_state": "none", "questions": [], "to_write": 0, "units": 0, "job": None,
    }
    assert sheet.fake.paths() == ["exams", "exam_questions"]  # без вопросов эталоны не читаются


def test_one_question_with_a_trimmed_rubric(sheet):
    fake = sheet.fake
    exam_id, (question_id,), material_id = course(fake, QUESTIONS[:1], mapping_state="done")
    fake.row("exam_questions", question_id).update(coverage="partial", missing_note="классификации видов инфляции")
    row = rubric_row(fake, question_id, material_id, rubric=stored_rubric(material_id, "partial"))
    fake.requests.clear()
    body = read_sheet(sheet, exam_id)
    assert body["exam_id"] == exam_id and body["mapping_state"] == "done" and body["job"] is None
    assert body["to_write"] == 0 and body["units"] == 0
    (question,) = body["questions"]
    assert set(question) == QUESTION_KEYS
    assert question["question_id"] == question_id and question["position"] == 1 and question["label"] == "1"
    assert question["section"] == 1 and question["text"] == QUESTIONS[0] and question["rebuilt"] is False
    assert question["question_hash"] == fake.row("exam_questions", question_id)["question_hash"]
    assert (question["coverage"], question["coverage_method"]) == ("partial", "llm")
    assert question["coverage_reason"] == "Ответ есть во фрагментах лекций"
    assert question["missing_note"] == "классификации видов инфляции"
    rubric = question["rubric"]
    assert list(rubric) == RUBRIC_KEYS
    assert rubric["rubric_id"] == row["id"] and rubric["built_at"] == row["created_at"]
    assert rubric["coverage"] == "partial" and rubric["coverage_note"] == "Нет про резервы"
    assert rubric["materials"] == [{"key": "M1", "material_id": material_id, "title": "Денежный рынок"}]
    assert [list(point) for point in rubric["points"]] == [POINT_KEYS] * 4
    first = rubric["points"][0]
    assert first == {"id": "p1", "title": "Цель политики — ценовая стабильность", "short": "", "essential": True,
                     "source_quote": econ_points()[0]["source_quote"], "source_ids": ["M1:S02"]}
    # Из базы взяты только нужные поля эталона; якоря, переспросы и ближайшие фрагменты не уходят клиенту.
    (read,) = [request for request in fake.requests if request.url.path.endswith("/oral_rubrics")]
    select = read.url.params["select"]
    assert select == ("id,question_hash,source_key,created_at,sheet,coverage:rubric->coverage,"
                      "coverage_note:rubric->coverage_note,points:rubric->points,materials:rubric->materials")
    assert read.url.params["rubric_version"] == "eq.1" and read.url.params["user_id"] == "eq.user-a"
    text = json.dumps(body, ensure_ascii=False)
    assert "anchors" not in text and "followup" not in text and "nearest" not in text
    assert sheet.model.calls == []


def test_three_hundred_questions_are_read_in_chunks_with_short_urls(sheet):
    fake = sheet.fake
    texts = [f"Вопрос {number}: инфляция, ставка и денежный рынок" for number in range(1, 301)]
    exam_id, ids, material_id = course(fake, texts)
    for question_id in ids[::3]:
        rubric_row(fake, question_id, material_id)
    fake.requests.clear()
    body = read_sheet(sheet, exam_id)
    assert [q["position"] for q in body["questions"]] == list(range(1, 301))
    assert sum(1 for q in body["questions"] if q["rubric"]) == 100
    assert body["to_write"] == 200 and body["units"] == 200 * AI_COSTS["answerPoints"]
    assert all(len(str(request.url)) < 8192 for request in fake.requests)
    reads = [request for request in fake.requests if request.url.path.endswith("/oral_rubrics")]
    assert len(reads) == 6
    hashes = [request.url.params["question_hash"][4:-1].split(",") for request in reads]
    assert all(len(chunk) <= 50 for chunk in hashes) and sum(len(chunk) for chunk in hashes) == 300


def test_other_keys_are_ignored_and_rebuilt_says_the_points_were_rebuilt(sheet):
    fake = sheet.fake
    exam_id, (current, remapped, was_none, never), material_id = course(fake, QUESTIONS)
    rubric_row(fake, current, material_id)
    old = rubric_row(fake, remapped, material_id, key="old-key-other-lectures")
    rubric_row(fake, was_none, material_id, key="old-key-none", rubric=stored_rubric(material_id, "none"))
    rubric_row(fake, never, material_id, key="old-key-broken", rubric={"points": "испорчено"})
    body = read_sheet(sheet, exam_id)
    by_id = {q["question_id"]: q for q in body["questions"]}
    assert by_id[current]["rubric"] is not None and by_id[current]["rebuilt"] is False
    assert by_id[remapped]["rubric"] is None and by_id[remapped]["rebuilt"] is True
    assert old["id"] not in json.dumps(body)
    # Прежний эталон без пунктов («нет в лекциях») или испорченный — строк не было: не «пересобраны».
    assert by_id[was_none]["rubric"] is None and by_id[was_none]["rebuilt"] is False
    assert by_id[never]["rubric"] is None and by_id[never]["rebuilt"] is False
    assert body["to_write"] == 3


def test_a_corrupt_row_counts_as_to_write_and_is_rebuilt_in_place(sheet):
    fake = sheet.fake
    exam_id, (question_id,), material_id = course(fake, QUESTIONS[:1])
    broken = rubric_row(fake, question_id, material_id, rubric={"coverage": "full", "points": "испорчено"})
    body = read_sheet(sheet, exam_id)
    assert body["questions"][0]["rubric"] is None and body["to_write"] == 1 and body["units"] == 1
    events = events_of(write(sheet, exam_id))
    assert statuses(events) == [(question_id, "written")]
    assert len(fake.rubrics()) == 1 and events[1]["rubric"]["rubric_id"] == broken["id"]
    assert sheet.model.rubric_calls[0]["use_cache"] is False  # перезапись — как force у /rubric
    assert len(fake.rubrics()[0]["rubric"]["points"]) == 4


def test_to_write_and_units_count_only_unwritten_full_and_partial_questions(sheet):
    fake = sheet.fake
    texts = ["Цели денежно-кредитной политики", "Инструменты ЦБ", "Кривая Филлипса", "Квантовая механика",
             "Нормы резервов", "Ставка ЦБ", "Ставка ЦБ"]
    exam_id, (full, partial, unverified, none, written, twin1, twin2), material_id = course(fake, texts)
    fake.row("exam_questions", partial)["coverage"] = "partial"
    fake.row("exam_questions", unverified).update(coverage="unverified", coverage_method="lexical")
    fake.row("exam_questions", none)["coverage"] = "none"
    rubric_row(fake, written, material_id)
    body = read_sheet(sheet, exam_id)
    assert body["to_write"] == 4  # full, partial и два вопроса с одним текстом
    assert body["units"] == 3 * AI_COSTS["answerPoints"]  # одинаковые вопросы делят эталон и единицу
    fake.row("exam_questions", full)["coverage"] = None
    assert read_sheet(sheet, exam_id)["to_write"] == 3
    assert {twin1, twin2} <= {q["question_id"] for q in body["questions"]}


def test_short_lines_are_read_only_for_their_own_rubric_version(sheet):
    fake = sheet.fake
    exam_id, (fresh, stale, future), material_id = course(fake, QUESTIONS[:3])
    created = "2026-10-04T10:00:00.123456+00:00"
    good = {"v": 1, "for": created, "short": {"p1": "цель — ценовая стабильность", "p2": "x" * 57}, "tried": {"p3": True}}
    rubric_row(fake, fresh, material_id, created_at=created, sheet=good)
    rubric_row(fake, stale, material_id, created_at=created, sheet=dict(good, **{"for": "2026-10-03T10:00:00+00:00"}))
    rubric_row(fake, future, material_id, created_at=created, sheet=dict(good, v=2))
    by_id = {q["question_id"]: q["rubric"]["points"] for q in read_sheet(sheet, exam_id)["questions"]}
    assert [point["short"] for point in by_id[fresh]] == ["цель — ценовая стабильность", "", "", ""]
    assert all(point["short"] == "" for point in by_id[stale] + by_id[future])
    # Та же отметка в другой записи ISO — та же версия.
    fake.rubrics()[0]["sheet"]["for"] = "2026-10-04T10:00:00.123456Z"
    assert read_sheet(sheet, exam_id)["questions"][0]["rubric"]["points"][0]["short"] == "цель — ценовая стабильность"


def test_rubrics_and_questions_are_read_page_by_page(sheet, monkeypatch):
    monkeypatch.setattr(oral_sheet, "PAGE_ROWS", 3)
    fake = sheet.fake
    exam_id, ids, material_id = course(fake, QUESTIONS + ["Пятый вопрос о резервах"])
    for number in range(7):
        rubric_row(fake, ids[0], material_id, key=f"other-key-{number:02d}")
    target = rubric_row(fake, ids[0], material_id)
    fake.requests.clear()
    body = read_sheet(sheet, exam_id)
    assert body["questions"][0]["rubric"]["rubric_id"] == target["id"] and len(body["questions"]) == 5
    reads = [request for request in fake.requests if request.url.path.endswith("/oral_rubrics")]
    assert [request.url.params["offset"] for request in reads] == ["0", "3", "6"]
    assert all(request.url.params["limit"] == "3" and request.url.params["order"] == "id.asc" for request in reads)
    question_reads = [request for request in fake.requests if request.url.path.endswith("/exam_questions")]
    assert [request.url.params["offset"] for request in question_reads] == ["0", "3"]


def test_more_than_a_thousand_rows_of_one_question_are_all_read(sheet):
    fake = sheet.fake
    exam_id, (question_id,), material_id = course(fake, QUESTIONS[:1])
    for number in range(1000):
        rubric_row(fake, question_id, material_id, key=f"old-{number:04d}")
    target = rubric_row(fake, question_id, material_id)
    fake.requests.clear()
    assert read_sheet(sheet, exam_id)["questions"][0]["rubric"]["rubric_id"] == target["id"]
    reads = [request for request in fake.requests if request.url.path.endswith("/oral_rubrics")]
    assert [request.url.params["offset"] for request in reads] == ["0", "1000"]


def test_the_sheet_reads_without_the_sheet_column_before_the_migration(sheet):
    fake = sheet.fake
    fake.without_sheet_column = True
    exam_id, (question_id,), material_id = course(fake, QUESTIONS[:1])
    rubric_row(fake, question_id, material_id)
    body = read_sheet(sheet, exam_id)
    assert [point["short"] for point in body["questions"][0]["rubric"]["points"]] == [""] * 4
    selects = [r.url.params["select"] for r in fake.requests if r.url.path.endswith("/oral_rubrics")]
    assert "sheet" in selects[0].split(",") and "sheet" not in selects[1].split(",")
    # Запись без колонки: эталоны пишутся, короткие строки — нет, модель за ними не зовут.
    fake.tables["oral_rubrics"].clear()
    events = events_of(write(sheet, exam_id))
    assert statuses(events) == [(question_id, "written")] and sheet.model.short_calls == []


def test_sheet_read_errors_are_plain_russian(sheet):
    fake = sheet.fake
    exam_id, _, _ = course(fake, QUESTIONS[:1])
    foreign, _, _ = course(fake, QUESTIONS[:1], user="user-b")
    assert_plain_russian(sheet.get(f"/api/oral/sheet?exam_id={foreign}"), 404, oral_sheet.EXAM_NOT_FOUND_DETAIL)
    assert_plain_russian(sheet.get("/api/oral/sheet?exam_id=17"), 404, oral_sheet.EXAM_NOT_FOUND_DETAIL)
    assert_plain_russian(sheet.get("/api/oral/sheet"), 404, oral_sheet.EXAM_NOT_FOUND_DETAIL)
    fake.fail[("GET", "oral_rubrics")] = 500
    assert_plain_russian(sheet.get(f"/api/oral/sheet?exam_id={exam_id}"), 503, oral_sheet.READ_FAILED_DETAIL)
    fake.fail[("GET", "oral_rubrics")] = 401
    assert_plain_russian(sheet.get(f"/api/oral/sheet?exam_id={exam_id}"), 401, oral_api.SESSION_EXPIRED_DETAIL)
    assert_plain_russian(write(sheet, foreign), 404, oral_sheet.EXAM_NOT_FOUND_DETAIL)
    assert_plain_russian(write(sheet, exam_id, question_ids="все"), 400, oral_api.BAD_BODY_DETAIL)
    assert sheet.model.calls == []


# ── POST /api/oral/sheet/write ─────────────────────────────────────────────────


def test_write_streams_progress_questions_and_done_and_stores_short_lines_first(sheet):
    fake = sheet.fake
    exam_id, ids, material_id = course(fake, QUESTIONS[:3])
    response = write(sheet, exam_id)
    assert response.headers["cache-control"] == "no-cache" and response.headers["x-accel-buffering"] == "no"
    events = events_of(response)
    assert events[0] == {"type": "progress", "done": 0, "total": 3}
    assert sorted(statuses(events)) == sorted((question_id, "written") for question_id in ids)
    assert [event["done"] for event in events[1:4]] == [1, 2, 3] and all(event["total"] == 3 for event in events[1:4])
    assert events[-1] == {"type": "done", "written": 3, "failed": 0, "busy": 0, "limit": False, "units": 0,
                          "total": 3, "auth": 0, "stopped": 0}
    assert len(events) == 5
    for event in events[1:4]:
        rubric = event["rubric"]
        assert list(rubric) == RUBRIC_KEYS and [list(point) for point in rubric["points"]] == [POINT_KEYS] * 4
        # Короткие строки уже в событии: на глазах клиента они не переписываются.
        assert [point["short"] for point in rubric["points"]] == list(TITLES_SHORT.values())
        row = next(row for row in fake.rubrics() if row["id"] == rubric["rubric_id"])
        assert rubric["built_at"] == row["created_at"]
        assert row["sheet"] == {"v": 1, "for": row["created_at"], "short": dict(zip(["p1", "p2", "p3", "p4"], TITLES_SHORT.values())),
                                "tried": {}}
    assert len(fake.rubrics()) == 3 and {row["material_id"] for row in fake.rubrics()} == {material_id}
    assert len(sheet.model.rubric_calls) == 3 and len(sheet.model.short_calls) == 3
    short = sheet.model.short_calls[0]
    assert short["fast"] is True and short["temperature"] == 0 and short["json_mode"] is True
    assert short["timeout"] == oral_sheet.SHORT_TIMEOUT_SECONDS and short["max_tokens"] <= 4000
    assert short["text"].startswith("ВОПРОС q1: ") and "q1p4: Нормы обязательных резервов" in short["text"]
    assert oral_sheet._jobs == {} and oral_api._flights == {}
    # Лист после записи: всё написано, строки на месте.
    body = read_sheet(sheet, exam_id)
    assert body["to_write"] == 0 and body["job"] is None
    assert all(point["short"] for q in body["questions"] for point in q["rubric"]["points"])


def test_question_ids_pick_from_the_writable_ones_and_a_run_takes_at_most_sixty(sheet, monkeypatch):
    fake = sheet.fake
    exam_id, (first, second, third, fourth), material_id = course(fake, QUESTIONS)
    fake.row("exam_questions", second).update(coverage="unverified", coverage_method="lexical")
    rubric_row(fake, third, material_id)
    events = events_of(write(sheet, exam_id, question_ids=[fourth, second, third, "не-uuid"]))
    assert events[0] == {"type": "progress", "done": 0, "total": 1}
    # third уже написан: в запуск не входит, ему только дописываются короткие строки (без счёта done).
    assert sorted(statuses(events)) == sorted([(fourth, "written"), (third, "cached")])
    assert [event["done"] for event in events if event.get("status") == "cached"] == [0]
    monkeypatch.setattr(oral_sheet, "MAX_RUN_QUESTIONS", 1)
    events = events_of(write(sheet, exam_id))
    assert events[0]["total"] == 1 and statuses(events) == [(first, "written")]


def test_a_rubric_cached_meanwhile_is_not_charged(paid):
    fake = paid.fake
    exam_id, (question_id,), material_id = course(fake, QUESTIONS[:1])
    row = rubric_row(fake, question_id, material_id)
    fake.hidden_rubric_reads = 1  # запуск строку не видит (её сохранил другой запрос), сборка — уже видит
    events = events_of(write(paid, exam_id))
    assert statuses(events) == [(question_id, "cached")] and events[1]["rubric"]["rubric_id"] == row["id"]
    assert events[-1]["units"] == 0 and events[-1]["written"] == 1
    assert paid.server.rpc("consume_ai_units") == [] and paid.model.rubric_calls == []
    # Короткие строки к нему всё равно пишутся — без единиц.
    assert len(paid.model.short_calls) == 1 and row["sheet"]["short"]["p1"] == "цель — ценовая стабильность"


def test_a_question_shared_with_the_rubric_endpoint_is_one_model_call_and_one_charge(paid):
    fake = paid.fake
    exam_id, (question_id,), _ = course(fake, QUESTIONS[:1])
    paid.model.delay = 0.3

    async def scenario(client):
        rubric = asyncio.ensure_future(
            client.post("/api/oral/rubric", json={"exam_id": exam_id, "question_id": question_id}))
        await until(lambda: paid.model.rubric_calls)
        sheet_response = await client.post("/api/oral/sheet/write", json={"exam_id": exam_id})
        return await rubric, sheet_response

    rubric, sheet_response = in_one_loop(paid.main, scenario)
    events = events_of(sheet_response)
    assert rubric.status_code == 200 and statuses(events) == [(question_id, "written")]
    assert events[1]["rubric"]["rubric_id"] == rubric.json()["rubric_id"]
    assert len(paid.model.rubric_calls) == 1 and len(fake.rubrics()) == 1
    assert paid.server.rpc("consume_ai_units") == [{"p_units": AI_COSTS["answerPoints"], "p_kind": "answerPoints"}]
    assert events[-1]["units"] == AI_COSTS["answerPoints"] and paid.server.used == AI_COSTS["answerPoints"]


def unverifiable_answer():
    points = econ_points()
    for point in points:
        point["source_quote"] = "Такой фразы в лекции нет совсем, модель её придумала"
    return rubric_answer(points)


@pytest.mark.parametrize(
    "answers, first_status, rest_status",
    [
        ([unverifiable_answer(), unverifiable_answer(), rubric_answer()], "unverifiable", "written"),
        ([AIError.failed(), rubric_answer()], "failed", "written"),
        ([AIError.timeout()], "busy", "busy"),
    ],
)
def test_failed_rubrics_give_the_unit_back(paid, monkeypatch, answers, first_status, rest_status):
    monkeypatch.setattr(oral_sheet, "BUILD_SLOTS", 1)
    fake = paid.fake
    exam_id, (first, second), _ = course(fake, QUESTIONS[:2])
    paid.model.rubrics = list(answers)
    events = events_of(write(paid, exam_id))
    assert statuses(events) == [(first, first_status), (second, rest_status)]
    charged = 1 if rest_status == "written" else 0
    assert len(paid.server.rpc("refund_ai_units")) == 1 and paid.server.used == charged
    assert events[-1]["units"] == charged
    if first_status == "busy":
        assert len(paid.model.rubric_calls) == 1  # после таймаута новые вопросы не начинаются
        assert events[-1]["busy"] == 2
    else:
        assert events[-1]["failed"] == 1 and events[-1]["written"] == 1


def test_a_busy_provider_stops_the_run_and_the_rest_is_busy(paid, monkeypatch):
    monkeypatch.setattr(oral_sheet, "BUILD_STAGGER_SECONDS", 0.2)
    fake = paid.fake
    exam_id, ids, _ = course(fake, QUESTIONS[:3])
    paid.model.rubrics = [AIError.busy()]
    events = events_of(write(paid, exam_id))
    assert statuses(events) == [(question_id, "busy") for question_id in ids]
    assert len(paid.model.rubric_calls) == 1 and fake.rubrics() == []
    assert len(paid.server.rpc("consume_ai_units")) == 1 and len(paid.server.rpc("refund_ai_units")) == 1
    assert paid.server.used == 0
    assert events[-1] == {"type": "done", "written": 0, "failed": 0, "busy": 3, "limit": False, "units": 0,
                          "total": 3, "auth": 0, "stopped": 0}


def test_the_ai_limit_mid_run_ends_with_ai_limit_and_charges_nothing_more(paid, monkeypatch):
    monkeypatch.setattr(oral_sheet, "BUILD_SLOTS", 1)
    fake = paid.fake
    paid.server.used = FREE_DAILY_UNITS - 2
    exam_id, ids, _ = course(fake, QUESTIONS)
    events = events_of(write(paid, exam_id))
    assert statuses(events) == [(ids[0], "written"), (ids[1], "written"), (ids[2], "limit"), (ids[3], "limit")]
    last = events[-1]
    assert last == {"type": "error", "code": "ai_limit", "message": quota.AI_LIMIT_DETAIL, "used": FREE_DAILY_UNITS,
                    "limit": FREE_DAILY_UNITS, "resets_at": "2026-10-05T00:00:00Z", "pro": False, "units": 1}
    assert not any(event["type"] == "done" for event in events)
    consumed = paid.server.rpc("consume_ai_units")
    assert len(consumed) == 3 and paid.server.used == FREE_DAILY_UNITS  # третий отказ, четвёртого запроса нет
    assert len(paid.model.rubric_calls) == 2 and len(fake.rubrics()) == 2


def test_a_client_that_leaves_does_not_stop_the_writing(sheet):
    main = sheet.main
    fake = sheet.fake
    exam_id, ids, _ = course(fake, QUESTIONS[:3])
    sheet.model.delay = 0.05
    raw = json.dumps({"exam_id": exam_id}).encode()
    scope = {
        "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "POST", "scheme": "http",
        "path": "/api/oral/sheet/write", "raw_path": b"/api/oral/sheet/write", "query_string": b"", "root_path": "",
        "client": ("127.0.0.1", 5000), "server": ("testserver", 80),
        "headers": [(b"authorization", b"Bearer token-a"), (b"content-type", b"application/json"),
                    (b"content-length", str(len(raw)).encode())],
    }

    async def go():
        sent: list[dict] = []
        first_chunk = asyncio.Event()
        delivered = False

        async def receive():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": raw, "more_body": False}
            await first_chunk.wait()
            return {"type": "http.disconnect"}

        async def send(message):
            sent.append(message)
            if message["type"] == "http.response.body" and message.get("body"):
                first_chunk.set()

        await main.app(scope, receive, send)
        bodies = b"".join(message.get("body", b"") for message in sent if message["type"] == "http.response.body")
        running_after_leave = bool(oral_sheet._jobs)
        await until(lambda: not oral_sheet._jobs)
        return bodies.decode(), running_after_leave

    received, running_after_leave = asyncio.run(go())
    assert running_after_leave and '"type": "done"' not in received
    assert len(fake.rubrics()) == 3 and all(row["sheet"]["short"] for row in fake.rubrics())
    assert len(sheet.model.rubric_calls) == 3


def test_a_second_post_attaches_to_the_running_job_with_a_fresh_token(sheet):
    fake = sheet.fake
    exam_id, ids, _ = course(fake, QUESTIONS[:3])
    sheet.model.delay = 0.15

    async def scenario(client):
        first = asyncio.ensure_future(client.post("/api/oral/sheet/write", json={"exam_id": exam_id}))
        await until(lambda: sheet.model.rubric_calls)
        while_running = (await client.get(f"/api/oral/sheet?exam_id={exam_id}")).json()["job"]
        second = await client.post("/api/oral/sheet/write", json={"exam_id": exam_id},
                                   headers={"Authorization": "Bearer token-a2"})
        return await first, second, while_running

    first, second, while_running = in_one_loop(sheet.main, scenario)
    assert while_running["state"] == "running" and while_running["total"] == 3 and while_running["done"] == 0
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", while_running["started_at"])
    first_events, second_events = events_of(first), events_of(second)
    assert second_events[0]["type"] == "progress" and second_events[0]["total"] == 3
    assert second_events[-1] == first_events[-1] and first_events[-1]["written"] == 3
    # Второй поток идёт с текущего места: те же события, что у первого после подключения.
    assert first_events[-len(second_events) + 1:] == second_events[1:]
    assert len(sheet.model.rubric_calls) == 3 and len(fake.rubrics()) == 3
    # Подключившийся запрос принёс свежий токен — им пишутся следующие вопросы.
    tokens = [request.headers["authorization"] for request in fake.requests if request.method == "POST"]
    assert "Bearer token-a2" in tokens and oral_sheet._jobs == {}


def test_follow_joins_a_running_job_and_never_starts_a_new_one(sheet):
    fake = sheet.fake
    exam_id, _, _ = course(fake, QUESTIONS[:3])
    # Запись уже кончилась (или её не было): подключение не запускает новую и ничего не списывает.
    events = events_of(write(sheet, exam_id, follow=True))
    assert events == [{"type": "done", "written": 0, "failed": 0, "busy": 0, "limit": False, "units": 0, "total": 0,
                       "auth": 0, "stopped": 0, "joined": False}]
    assert sheet.model.calls == [] and fake.rubrics() == [] and oral_sheet._jobs == {}
    assert read_sheet(sheet, exam_id)["to_write"] == 3

    sheet.model.delay = 0.15

    async def scenario(client):
        first = asyncio.ensure_future(client.post("/api/oral/sheet/write", json={"exam_id": exam_id}))
        await until(lambda: sheet.model.rubric_calls)
        followed = await client.post("/api/oral/sheet/write", json={"exam_id": exam_id, "follow": True})
        return await first, followed

    first, followed = in_one_loop(sheet.main, scenario)
    followed_events = events_of(followed)
    assert followed_events[0]["type"] == "progress" and followed_events[-1] == events_of(first)[-1]
    assert "joined" not in followed_events[-1] and followed_events[-1]["written"] == 3
    assert len(sheet.model.rubric_calls) == 3 and len(fake.rubrics()) == 3


def test_a_running_mapping_is_409_and_a_stale_lock_is_not(sheet):
    fake = sheet.fake
    now = datetime.now(timezone.utc)
    exam_id, _, _ = course(fake, QUESTIONS[:1], mapping_state="running", mapping_started_at=now.isoformat())
    assert_plain_russian(write(sheet, exam_id), 409, oral_sheet.MAPPING_RUNNING_DETAIL)
    assert sheet.model.calls == [] and oral_sheet._jobs == {}
    fake.row("exams", exam_id)["mapping_started_at"] = (now - timedelta(minutes=10)).isoformat()
    assert events_of(write(sheet, exam_id))[-1]["written"] == 1


def test_at_most_two_builds_at_once_across_users_with_a_stagger(sheet, monkeypatch):
    monkeypatch.setattr(oral_sheet, "BUILD_STAGGER_SECONDS", 0.1)
    fake = sheet.fake
    exam_a, _, _ = course(fake, QUESTIONS[:3])
    exam_b, _, _ = course(fake, QUESTIONS[1:4], user="user-b")
    sheet.model.delay = 0.25
    starts: list[float] = []
    acquire = oral_sheet._gate.acquire

    async def recorded():
        allowed = await acquire()
        starts.append(time.monotonic())
        return allowed

    monkeypatch.setattr(oral_sheet._gate, "acquire", recorded)

    async def scenario(client):
        return await asyncio.gather(
            client.post("/api/oral/sheet/write", json={"exam_id": exam_a}),
            client.post("/api/oral/sheet/write", json={"exam_id": exam_b}, headers={"Authorization": "Bearer token-b"}),
        )

    first, second = in_one_loop(sheet.main, scenario)
    assert events_of(first)[-1]["written"] == 3 and events_of(second)[-1]["written"] == 3
    assert len(sheet.model.rubric_calls) == 6 and sheet.model.max_active == 2
    gaps = [later - earlier for earlier, later in zip(starts, starts[1:])]
    assert len(starts) == 6 and min(gaps) >= 0.1 - 0.005


def test_the_build_gate_holds_two_slots_staggers_real_starts_and_gives_back_what_was_not_used(monkeypatch):
    monkeypatch.setattr(oral_sheet, "BUILD_STAGGER_SECONDS", 0.05)
    monkeypatch.setenv("SHEET_DAILY_BUILDS", "4")
    gate = oral_sheet._BuildGate()

    async def go():
        loop = asyncio.get_running_loop()
        starts: list[float] = []

        async def build(hold):
            if not await gate.acquire():
                return False
            starts.append(loop.time())
            await asyncio.sleep(hold)
            gate.release()
            return True

        first, second = asyncio.ensure_future(build(0.2)), asyncio.ensure_future(build(0.2))
        await asyncio.sleep(0.02)
        late = asyncio.ensure_future(build(0))
        await asyncio.sleep(0.01)
        assert (gate.active, len(gate.waiters), gate.started) == (2, 1, 2)
        late.cancel()  # ушёл из очереди: ни места, ни старта за сутки
        await asyncio.gather(late, return_exceptions=True)
        assert (gate.active, len(gate.waiters), gate.started) == (2, 0, 2)
        third = asyncio.ensure_future(build(0))
        assert await asyncio.gather(first, second, third) == [True, True, True]
        gate.last_start = loop.time()  # следующему старту ждать сдвиг
        waiting = asyncio.ensure_future(gate.acquire())
        await asyncio.sleep(0.01)
        assert (gate.active, gate.started) == (1, 4)
        waiting.cancel()  # остановили во время сдвига: место и старт возвращаются
        await asyncio.gather(waiting, return_exceptions=True)
        assert (gate.active, gate.started) == (0, 3)
        assert await build(0) is True
        assert await gate.acquire() is False  # дневной потолок
        return starts

    starts = asyncio.run(go())
    assert len(starts) == 4
    assert min(later - earlier for earlier, later in zip(starts, starts[1:])) >= 0.05


def test_keepalive_flows_while_a_rubric_is_being_built(sheet, monkeypatch):
    monkeypatch.setenv("SSE_KEEPALIVE_SECONDS", "0.05")
    exam_id, _, _ = course(sheet.fake, QUESTIONS[:1])
    sheet.model.delay = 0.4
    response = write(sheet, exam_id)
    frames = frames_of(response.text)
    progress = next(index for index, frame in enumerate(frames) if '"progress"' in frame)
    question = next(index for index, frame in enumerate(frames) if '"question"' in frame)
    assert ": keepalive" in frames[progress:question]
    assert events_of(response)[-1]["type"] == "done"


def test_an_expired_token_reports_auth_for_the_rest(sheet, monkeypatch):
    monkeypatch.setattr(oral_sheet, "BUILD_SLOTS", 1)
    fake = sheet.fake
    exam_id, ids, _ = course(fake, QUESTIONS[:3])
    fake.expire_after_inserts = 1
    events = events_of(write(sheet, exam_id))
    assert statuses(events) == [(ids[0], "written"), (ids[1], "auth"), (ids[2], "auth")]
    assert events[-1]["auth"] == 2 and events[-1]["written"] == 1
    assert len(sheet.model.rubric_calls) == 1
    # Строки первого вопроса записать не удалось (токен истёк) — в событии их нет.
    assert [point["short"] for point in events[1]["rubric"]["points"]] == [""] * 4


def test_stop_finishes_started_questions_and_starts_no_more(sheet, monkeypatch):
    monkeypatch.setattr(oral_sheet, "BUILD_SLOTS", 1)
    fake = sheet.fake
    exam_id, ids, _ = course(fake, QUESTIONS)
    sheet.model.delay = 0.2

    async def scenario(client):
        running = asyncio.ensure_future(client.post("/api/oral/sheet/write", json={"exam_id": exam_id}))
        await until(lambda: sheet.model.rubric_calls)
        stop = await client.post("/api/oral/sheet/stop", json={"exam_id": exam_id})
        job = (await client.get(f"/api/oral/sheet?exam_id={exam_id}")).json()["job"]
        streamed = await running
        again = await client.post("/api/oral/sheet/stop", json={"exam_id": exam_id})
        return stop, job, streamed, again

    stop, job, streamed, again = in_one_loop(sheet.main, scenario)
    assert stop.status_code == 200 and stop.json() == {"stopped": True, "running": 1}
    assert job["state"] == "stopping"
    events = events_of(streamed)
    assert statuses(events) == [(ids[0], "written")]
    assert events[-1] == {"type": "done", "written": 1, "failed": 0, "busy": 0, "limit": False, "units": 0,
                          "total": 4, "auth": 0, "stopped": 3}
    assert len(sheet.model.rubric_calls) == 1 and len(fake.rubrics()) == 1
    assert again.json() == {"stopped": False, "running": 0}


def test_the_daily_build_cap_of_the_process_marks_the_rest_busy(sheet, monkeypatch):
    monkeypatch.setenv("SHEET_DAILY_BUILDS", "1")
    monkeypatch.setattr(oral_sheet, "BUILD_SLOTS", 1)
    exam_id, ids, _ = course(sheet.fake, QUESTIONS[:3])
    events = events_of(write(sheet, exam_id))
    assert statuses(events) == [(ids[0], "written"), (ids[1], "busy"), (ids[2], "busy")]
    assert len(sheet.model.rubric_calls) == 1
    monkeypatch.setattr(oral_sheet, "_utc_today", lambda: date(2099, 1, 1))  # новые сутки UTC
    events = events_of(write(sheet, exam_id))
    assert statuses(events) == [(ids[1], "written"), (ids[2], "busy")]


def test_a_rubric_that_was_not_saved_is_failed_and_refunded(paid):
    fake = paid.fake
    exam_id, (question_id,), _ = course(fake, QUESTIONS[:1])
    fake.fail[("POST", "oral_rubrics")] = 500
    events = events_of(write(paid, exam_id))
    assert statuses(events) == [(question_id, "failed")] and events[1]["rubric"] is None
    assert len(paid.server.rpc("refund_ai_units")) == 1 and paid.server.used == 0
    assert events[-1]["units"] == 0 and events[-1]["failed"] == 1
    assert paid.model.short_calls == [] and not any(r.method == "PATCH" for r in fake.requests)


def test_an_exam_without_lectures_fails_its_questions_without_the_model(sheet):
    exam_id, ids, _ = course(sheet.fake, QUESTIONS[:2], lectures=())
    events = events_of(write(sheet, exam_id))
    assert statuses(events) == [(question_id, "failed") for question_id in ids]
    assert sheet.model.calls == [] and events[-1]["failed"] == 2


def test_a_model_coverage_none_is_status_none_and_charged(paid):
    exam_id, (question_id,), _ = course(paid.fake, QUESTIONS[:1])
    paid.model.rubrics = [{"coverage": "none", "coverage_note": "В лекциях нет", "points": []}]
    events = events_of(write(paid, exam_id))
    assert statuses(events) == [(question_id, "none")]
    assert events[1]["rubric"]["coverage"] == "none" and events[1]["rubric"]["points"] == []
    assert events[-1]["units"] == 1 and paid.server.used == 1 and paid.model.short_calls == []


def test_a_crashing_job_ends_the_stream_with_an_error(sheet, monkeypatch):
    exam_id, _, _ = course(sheet.fake, QUESTIONS[:1])

    async def broken(self):
        raise RuntimeError("internal details that must not leak")

    monkeypatch.setattr(oral_sheet.SheetJob, "_compress_cached", broken)
    events = events_of(write(sheet, exam_id))
    assert events[-1] == {"type": "error", "message": oral_sheet.INTERNAL_MESSAGE}
    assert oral_sheet._jobs == {}


# ── Короткие строки ─────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "short, title, problem",
    [
        ("цель — ценовая стабильность", "Цель политики — ценовая стабильность", None),
        ("гл. инструмент — ключ. ставка", "Основной инструмент — ключевая ставка", None),
        ("цена ↑ → спрос ↓", "Чем выше цена, тем меньше спрос", None),
        ("ставка ↑ → инфляция ↓", "Рост ставки снижает инфляцию", None),
        ("нормы ↑ → мульт. ↓", "Рост норм сокращает денежный мультипликатор", None),
        ("ЦБ ↑ ставку → кредиты дороже", "Центральный банк повышает ставку, и кредиты становятся дороже", None),
        ("инфл. 2–3% в год", "Инфляция около 2–3% в год", None),
        ("инфляция не полезна для экономики", "Инфляция в долгосрочной перспективе не является полезной для экономики", None),
        ("MV = PQ", "Уравнение обмена: MV = PQ", None),
        ("цена ↑ → спрос ↑", "Чем выше цена, тем меньше спрос", "direction"),
        ("цена ↓ → спрос ↑", "Чем выше цена, тем меньше спрос", "direction"),
        ("ставка ↓ → инфляция ↑", "Рост ставки снижает инфляцию", "direction"),
        ("ставка ↑", "Ключевая ставка — основной инструмент", "direction"),
        ("инфляция полезна для экономики", "Инфляция в долгосрочной перспективе не является полезной для экономики", "negation"),
        ("без резервов", "Нормы обязательных резервов", "negation"),
        ("инфл. 4% в год", "Инфляция около 2–3% в год", "digits"),
        ("цель — 2% инфляции", "Цель политики — ценовая стабильность", "new_word"),
        ("цель — рост ВВП", "Цель политики — ценовая стабильность", "new_word"),
        ("ВВП ↑", "Рост ставки снижает инфляцию", "acronym"),
        ("ставка ↗ → инфляция ↘", "Рост ставки снижает инфляцию", "arrow"),
        ("цель политики: ценовая стабильность, низкая и предсказуемая инфляция ok",
         "Цель политики — ценовая стабильность, то есть низкая и предсказуемая инфляция в стране", "too_long"),
        ("Цель политики — ценовая стабильность", "Цель политики — ценовая стабильность", "not_shorter"),
        ("цель политики ценовая стабильность", "Цель политики — ценовая стабильность", "same"),
        ("", "Нормы обязательных резервов", "empty"),
        (None, "Нормы обязательных резервов", "empty"),
    ],
)
def test_short_lines_are_checked_by_code(short, title, problem):
    assert oral_sheet.short_problem(short, title) == problem


EXAMPLE_QUESTIONS_TS = Path(__file__).resolve().parents[2] / "frontend" / "src" / "data" / "example" / "questions.ts"


@pytest.mark.skipif(not EXAMPLE_QUESTIONS_TS.exists(), reason="фронтенда нет рядом (сборка только бэкенда)")
def test_the_example_s_hand_written_lines_keep_the_rules_of_short_lines():
    """Пример /try пишет строки шпаргалки вручную (frontend/src/data/example/questions.ts) — по тем же правилам."""
    pairs = re.findall(r"title: '([^']*)',\s*short: '([^']*)'", EXAMPLE_QUESTIONS_TS.read_text(encoding="utf-8"))
    assert len(pairs) == 47
    assert [(title, short, oral_sheet.short_problem(short, title)) for title, short in pairs if oral_sheet.short_problem(short, title)] == []


def test_only_the_sheet_column_of_the_rubrics_version_is_patched(sheet):
    fake = sheet.fake
    exam_id, (question_id,), _ = course(fake, QUESTIONS[:1])
    events_of(write(sheet, exam_id))
    (row,) = fake.rubrics()
    patches = [request for request in fake.requests if request.method == "PATCH"]
    assert len(patches) == 1
    (patch,) = patches
    assert patch.url.path.endswith("/oral_rubrics")
    assert dict(patch.url.params) == {"id": f"eq.{row['id']}", "created_at": f"eq.{row['created_at']}", "select": "id"}
    assert list(json.loads(patch.content)) == ["sheet"]
    assert len(json.dumps(row["sheet"], ensure_ascii=False).encode()) <= oral_sheet.SHEET_MAX_BYTES


def test_tried_points_are_never_sent_to_the_model_again(sheet):
    fake = sheet.fake
    exam_id, (question_id,), _ = course(fake, QUESTIONS[:1])

    def answer(text, kwargs):
        keys = [key for key, _ in _KEY_LINE_RE.findall(text)]
        return {keys[0]: "цель — ценовая стабильность", keys[1]: "гл. инструмент — 2% инфляции", keys[2]: ""}

    sheet.model.shorts = answer
    first = events_of(write(sheet, exam_id))
    assert [p["short"] for p in first[1]["rubric"]["points"]] == ["цель — ценовая стабильность", "", "", ""]
    (row,) = fake.rubrics()
    assert row["sheet"]["short"] == {"p1": "цель — ценовая стабильность"}
    assert row["sheet"]["tried"] == {"p2": True, "p3": True, "p4": True}
    calls = len(sheet.model.short_calls)
    second = events_of(write(sheet, exam_id))
    assert second == [{"type": "progress", "done": 0, "total": 0},
                      {"type": "done", "written": 0, "failed": 0, "busy": 0, "limit": False, "units": 0,
                       "total": 0, "auth": 0, "stopped": 0}]
    assert len(sheet.model.short_calls) == calls and sheet.model.rubric_calls[1:] == []


def test_a_cut_off_short_answer_marks_tried_only_what_came(sheet):
    fake = sheet.fake
    exam_id, (question_id,), _ = course(fake, QUESTIONS[:1])

    def cut(text, kwargs):
        kwargs["meta"]["finish_reason"] = "MAX_TOKENS"
        keys = [key for key, _ in _KEY_LINE_RE.findall(text)]
        return {keys[0]: "цель — ценовая стабильность", keys[1]: "что-то новое"}

    sheet.model.shorts = cut
    events_of(write(sheet, exam_id))
    (row,) = fake.rubrics()
    assert row["sheet"]["short"] == {"p1": "цель — ценовая стабильность"} and row["sheet"]["tried"] == {"p2": True}
    sheet.model.shorts = None
    events_of(write(sheet, exam_id))
    assert re.findall(r"q\dp\d", sheet.model.short_calls[-1]["text"]) == ["q1p3", "q1p4"]
    assert set(row["sheet"]["short"]) == {"p1", "p3", "p4"}


def test_short_lines_cost_no_units(paid):
    exam_id, ids, material_id = course(paid.fake, QUESTIONS[:3])
    rubric_row(paid.fake, ids[2], material_id)
    events = events_of(write(paid, exam_id))
    assert events[-1]["units"] == 2 and events[-1]["written"] == 2
    assert paid.server.rpc("consume_ai_units") == [{"p_units": 1, "p_kind": "answerPoints"}] * 2
    assert len(paid.model.short_calls) == 3 and paid.server.used == 2


def test_rubrics_that_already_existed_are_shortened_in_batches_of_sixty_points(sheet):
    fake = sheet.fake
    texts = [f"Вопрос {number} о денежной политике" for number in range(1, 17)]
    exam_id, ids, material_id = course(fake, texts)
    rows = [rubric_row(fake, question_id, material_id) for question_id in ids]
    events = events_of(write(sheet, exam_id))
    assert events[0] == {"type": "progress", "done": 0, "total": 0}
    cached = [event for event in events if event["type"] == "question"]
    assert sorted(event["question_id"] for event in cached) == sorted(ids)
    assert all(event["status"] == "cached" and event["done"] == 0 and event["total"] == 0 for event in cached)
    assert all(point["short"] for event in cached for point in event["rubric"]["points"])
    assert events[-1]["written"] == 0 and events[-1]["units"] == 0
    sizes = [len(re.findall(r"^q\d+p\d:", call["text"], flags=re.M)) for call in sheet.model.short_calls]
    assert sizes == [60, 4] and sheet.model.rubric_calls == []
    assert all(row["sheet"]["for"] == row["created_at"] and len(row["sheet"]["short"]) == 4 for row in rows)


def test_a_stale_sheet_is_written_anew_for_the_current_version(sheet):
    fake = sheet.fake
    exam_id, (question_id,), material_id = course(fake, QUESTIONS[:1])
    row = rubric_row(fake, question_id, material_id,
                     sheet={"v": 1, "for": "2026-10-01T00:00:00+00:00", "short": {"p1": "старое"}, "tried": {"p2": True}})
    events_of(write(sheet, exam_id))
    assert re.findall(r"q\dp\d", sheet.model.short_calls[0]["text"]) == ["q1p1", "q1p2", "q1p3", "q1p4"]
    assert row["sheet"]["for"] == row["created_at"] and row["sheet"]["short"]["p1"] == "цель — ценовая стабильность"


def test_a_rebuild_during_the_short_lines_is_never_overwritten(sheet):
    fake = sheet.fake
    exam_id, (question_id,), _ = course(fake, QUESTIONS[:1])

    def rebuilt_meanwhile(text, kwargs):
        fake.rubrics()[0]["created_at"] = "2026-10-05T23:59:59.000001+00:00"  # force с другой вкладки
        return short_answer(text)

    sheet.model.shorts = rebuilt_meanwhile
    events = events_of(write(sheet, exam_id))
    assert fake.rubrics()[0]["sheet"] is None
    assert [point["short"] for point in events[1]["rubric"]["points"]] == [""] * 4
