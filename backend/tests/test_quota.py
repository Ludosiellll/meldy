"""Дневной лимит ИИ на сервере (quota.py) и «какая модель ответила».

Списание до модели токеном пользователя, возврат при сбое, 429 ai_limit в общей форме ошибок,
fail-open при сбое Supabase (одна строка журнала на вид сбоя), бесплатный демо-текст, цены
всех эндпоинтов из plans.py, сверка списка (10 за начатые 40 вопросов, которые уходят модели),
ответ вслух (протокол 4, новые пункты ответа +1, проверка бесплатна), журнал вызовов
(log_ai_call в фоне) и последняя ответившая модель в /api/health, модели по умолчанию.

Supabase — подменённый транспорт httpx (supabase_rest._transport), модель — подменённый
BaseAgent.run или поддельные клиенты провайдеров.
"""
import asyncio
import hashlib
import json
import sys
import uuid
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import exams_api  # noqa: E402
import exams_map  # noqa: E402
import oral_api  # noqa: E402
import quota  # noqa: E402
import receipts  # noqa: E402
import supabase_rest  # noqa: E402
from agents import base  # noqa: E402
from agents.base import AIError, BaseAgent  # noqa: E402
from plans import AI_COSTS, FREE_DAILY_UNITS, PRO_DAILY_UNITS, exam_mapping_cost, scan_cost  # noqa: E402
from test_lecture_formats import FakeGemini, gemini_error, scan_pdf  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
DEMO_FILE = REPO / "frontend" / "src" / "data" / "demo" / "lecture.txt"
URL = "https://quota-test.supabase.invalid"
ANON = "anon-test-key"
TOKENS = {"token-a": "user-a", "token-b": "user-b"}
RESETS_AT = "2026-10-05T00:00:00Z"
LIMIT_BODY_KEYS = {"detail", "code", "used", "limit", "resets_at", "pro", "units"}


class QuotaServer:
    """RPC дневного лимита в памяти, как функции миграции 20261004205613_ai_quota_server.

    Запросы к таблицам уходят во вложенный обработчик (inner), если он есть.
    """

    def __init__(self, *, limit=FREE_DAILY_UNITS, used=0, pro=False, inner=None):
        self.limit, self.used, self.pro, self.inner = limit, used, pro, inner
        self.charges: dict[str, int] = {}
        self.calls: list[tuple[str, dict, str]] = []
        self.fail = None  # статус HTTP, исключение или «странный» ответ (dict) для каждого RPC

    def rpc(self, name):
        return [args for fn, args, _ in self.calls if fn == name]

    def status(self, allowed, charge_id=None):
        return {"allowed": allowed, "pro": self.pro, "used": self.used, "limit": self.limit,
                "resets_at": RESETS_AT, "charge_id": charge_id}

    async def handler(self, request: httpx.Request) -> httpx.Response:
        if "/rest/v1/rpc/" not in request.url.path:
            if self.inner is None:
                return httpx.Response(404, json={"code": "PGRST205"})
            return self.inner(request)
        fn = request.url.path.rsplit("/", 1)[-1]
        args = json.loads(request.content or b"{}")
        token = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
        self.calls.append((fn, args, token))
        assert request.headers.get("apikey") == ANON and token in TOKENS
        if isinstance(self.fail, BaseException):
            raise self.fail
        if isinstance(self.fail, dict):
            return httpx.Response(200, json=self.fail)
        if self.fail == "slow":
            await asyncio.sleep(1)
        elif self.fail:
            return httpx.Response(self.fail, json={"code": "XX000", "message": "internal details"})
        if fn == "consume_ai_units":
            units = args["p_units"]
            if self.used + units > self.limit:
                return httpx.Response(200, json=self.status(False))
            self.used += units
            charge_id = str(uuid.uuid4())
            self.charges[charge_id] = units
            return httpx.Response(200, json=self.status(True, charge_id))
        if fn == "refund_ai_units":
            left = self.charges.get(args["p_charge"], 0)
            back = min(left, args["p_units"])
            self.charges[args["p_charge"]] = left - back
            self.used -= back
            return httpx.Response(200, json={"refunded": back, "used": self.used, "limit": self.limit, "resets_at": RESETS_AT})
        if fn == "log_ai_call":
            return httpx.Response(204)
        return httpx.Response(404, json={"code": "PGRST202"})


def install(monkeypatch, server):
    monkeypatch.setenv("SUPABASE_URL", URL)
    monkeypatch.setenv("SUPABASE_KEY", ANON)
    monkeypatch.setattr(supabase_rest, "_transport", httpx.MockTransport(server.handler))
    quota._REPORTED.clear()
    return server


@pytest.fixture
def server(monkeypatch, quota_on):
    yield install(monkeypatch, QuotaServer())
    quota._REPORTED.clear()


@pytest.fixture
def api(server, monkeypatch):
    """Приложение с пользователем token-a, без лимита частоты; модель — answer_with(...)."""
    import main
    from fastapi.testclient import TestClient

    async def fake_user(request):
        token = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
        if token not in TOKENS:
            raise HTTPException(status_code=401, detail="Требуется войти в аккаунт")
        return {"id": TOKENS[token]}

    monkeypatch.setattr(main, "require_authenticated_user", fake_user)
    monkeypatch.setattr(main.limiter, "enabled", False)
    monkeypatch.setattr(main, "GROQ_API_KEY", "groq-key")
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-key")
    BaseAgent._run_cache.clear()
    calls = []

    def answer_with(*answers):
        queue = list(answers)

        async def fake_run(self, system_prompt, user_text, **kwargs):
            calls.append({"system": system_prompt, "user": user_text, **kwargs})
            item = queue.pop(0) if len(queue) > 1 else queue[0]
            if isinstance(item, BaseException):
                raise item
            return item if isinstance(item, str) else json.dumps(item, ensure_ascii=False)

        monkeypatch.setattr(BaseAgent, "run", fake_run)
        monkeypatch.setattr(BaseAgent, "run_with_images", fake_run)

    client = TestClient(main.app, headers={"Authorization": "Bearer token-a"})
    client.answer_with = answer_with
    client.calls = calls
    client.server = server
    client.main = main
    yield client
    BaseAgent._run_cache.clear()


def run(coro):
    return asyncio.run(coro)


# ── Демо-текст ──────────────────────────────────────────────────────────────────


def test_demo_hash_is_the_hash_of_the_frontend_demo_text():
    """Правка lecture.txt без правки quota.DEMO_LECTURE_SHA256 — красный тест (демо снова платное)."""
    raw = DEMO_FILE.read_text(encoding="utf-8")
    normalized = " ".join(raw.replace("﻿", "").split())
    assert hashlib.sha256(normalized.encode("utf-8")).hexdigest() == quota.DEMO_LECTURE_SHA256
    assert quota.is_demo_text(raw) and quota.is_demo_text(raw.strip())
    assert quota.is_demo_text("﻿\n  " + raw.replace("\n", "\r\n") + "  \n")
    assert not quota.is_demo_text(raw.strip() + "!")
    assert not quota.is_demo_text("") and not quota.is_demo_text(None)
    data = raw.strip().encode("utf-8")
    assert quota.is_demo_upload(data, "pasted-text.txt") and quota.is_demo_upload(data, "Лекция.MD")
    assert not quota.is_demo_upload(data, "lecture.pdf")
    assert not quota.is_demo_upload(data + b" " * (quota.DEMO_MAX_BYTES + 1), "pasted-text.txt")
    assert not quota.is_demo_upload(b"\xff\xfe broken", "pasted-text.txt")


# ── Списание и возврат ─────────────────────────────────────────────────────────


def test_reserve_spends_units_with_the_users_own_token_and_refunds_once(server):
    async def go():
        spent = await quota.reserve("token-a", "answerPoints", 1)
        assert spent.units == 1 and spent.charge_id and spent.reserved
        assert server.used == 1
        await spent.refund()
        await spent.refund()  # второй раз ничего не делает
        return spent

    spent = run(go())
    assert server.calls == [
        ("consume_ai_units", {"p_units": 1, "p_kind": "answerPoints"}, "token-a"),
        ("refund_ai_units", {"p_units": 1, "p_kind": "answerPoints", "p_charge": spent.charge_id}, "token-a"),
    ]
    assert server.used == 0 and not spent.reserved


def test_zero_units_and_the_off_switch_never_call_supabase(server, monkeypatch):
    spent = run(quota.reserve("token-a", "lecture", 0))
    assert spent.units == 0 and server.calls == []
    monkeypatch.setenv("AI_QUOTA_DISABLED", "1")
    spent = run(quota.reserve("token-a", "lecture", 20))
    assert spent.units == 0 and not spent.reserved and server.calls == []
    run(spent.refund())
    assert server.calls == []
    with pytest.raises(ValueError):
        run(quota.reserve("token-a", "bad kind; drop table", 1))


def test_not_allowed_is_ai_limit_with_used_limit_and_reset(server):
    server.used = 99
    with pytest.raises(quota.AILimitExceeded) as info:
        run(quota.reserve("token-a", "answer", 4))
    exc = info.value
    assert isinstance(exc, AIError) and exc.status_code == 429 and exc.code == "ai_limit"
    assert exc.detail == "Дневной лимит ИИ на сегодня исчерпан."
    assert exc.extra == {"used": 99, "limit": 100, "resets_at": RESETS_AT, "pro": False, "units": 4}
    assert isinstance(exc.retry_after, int) and exc.retry_after >= 1
    assert exc.event() == {"type": "error", "code": "ai_limit", "message": exc.detail, **exc.extra}
    assert server.used == 99 and server.rpc("refund_ai_units") == []


@pytest.mark.parametrize("failure", [503, 500, 404, 401, httpx.ConnectError("down"), {"weird": True}, "slow"])
def test_infrastructure_failures_allow_the_action_and_log_once(server, monkeypatch, capsys, failure):
    monkeypatch.setattr(quota, "QUOTA_TIMEOUT_SECONDS", 0.05)
    server.fail = failure
    first = run(quota.reserve("token-a", "lecture", 20))
    second = run(quota.reserve("token-a", "lecture", 20))
    assert first.units == 0 and second.units == 0 and not first.reserved
    lines = [line for line in capsys.readouterr().out.splitlines() if line.startswith("AI quota:")]
    assert len(lines) == 1 and "token-a" not in lines[0] and "internal details" not in lines[0]


def test_no_session_token_is_allowed_without_a_call(server, capsys):
    spent = run(quota.reserve(None, "lecture", 20))
    assert spent.units == 0 and server.calls == []
    assert "no session token" in capsys.readouterr().out


def test_refund_on_failure_gives_the_units_back_and_reraises(server):
    async def go():
        spent = await quota.reserve("token-a", "visuals", 2)
        with pytest.raises(AIError):
            async with quota.refund_on_failure(spent):
                raise AIError.failed()
        kept = await quota.reserve("token-a", "visuals", 2)
        async with quota.refund_on_failure(kept):
            pass
        return spent, kept

    spent, kept = run(go())
    assert [args["p_charge"] for args in server.rpc("refund_ai_units")] == [spent.charge_id]
    assert server.used == 2 and kept.reserved


def test_a_failed_refund_is_logged_not_raised(server, capsys):
    async def go():
        spent = await quota.reserve("token-a", "cheatsheet", 5)
        server.fail = 503
        await spent.refund()

    run(go())
    assert "refund failed" in capsys.readouterr().out


def test_costs_come_from_plans():
    assert (FREE_DAILY_UNITS, PRO_DAILY_UNITS) == (100, 1000)
    assert [exam_mapping_cost(n) for n in (0, 1, 40, 41, 80, 81)] == [0, 10, 10, 20, 20, 30]
    assert quota.exam_mapping_units(41) == 20
    # Скан PDF: 5 единиц за каждые начатые 15 страниц.
    assert [scan_cost(n) for n in (0, 1, 15, 16, 60)] == [0, 5, 5, 10, 20]
    assert quota.scan_units(31) == 15


def test_the_browser_shows_the_prices_the_server_charges():
    import re

    source = (REPO / "frontend" / "src" / "lib" / "plans.ts").read_text(encoding="utf-8")
    block = source.split("export const AI_COSTS = {", 1)[1].split("} as const;", 1)[0]
    assert {name: int(units) for name, units in re.findall(r"^\s*(\w+): (\d+),$", block, re.M)} == AI_COSTS
    assert "OCR_PAGES_PER_CHARGE = 15;" in source and "EXAM_MAPPING_QUESTIONS_PER_CHARGE = 40;" in source


# ── Эндпоинты: списание до модели, возврат, 429 ────────────────────────────────


CHEATSHEET = {"key_points": ["a"], "cheatsheet": "**ВВП** — стоимость товаров и услуг.", "questions": []}


def test_a_cheatsheet_charges_its_price_and_refunds_a_failed_answer(api):
    api.answer_with(CHEATSHEET)
    response = api.post("/api/quick-prep", json={"context": "Лекция про ВВП."})
    assert response.status_code == 200, response.text
    assert api.server.rpc("consume_ai_units") == [{"p_units": 5, "p_kind": "cheatsheet"}]
    assert api.server.rpc("refund_ai_units") == [] and api.server.used == 5

    api.answer_with(AIError.busy())
    response = api.post("/api/quick-prep", json={"context": "Ещё одна лекция про ВВП."})
    assert response.status_code == 429 and "занят" in response.json()["detail"]
    (refund,) = api.server.rpc("refund_ai_units")
    assert refund["p_units"] == 5 and api.server.used == 5


def test_limit_is_a_429_in_the_apps_error_shape_and_the_model_is_not_called(api):
    api.server.used = FREE_DAILY_UNITS
    api.answer_with("не должен понадобиться")
    response = api.post("/api/quick-prep", json={"context": "Лекция."})
    assert response.status_code == 429
    body = response.json()
    assert set(body) == LIMIT_BODY_KEYS
    assert body == {"detail": "Дневной лимит ИИ на сегодня исчерпан.", "code": "ai_limit", "used": 100, "limit": 100,
                    "resets_at": RESETS_AT, "pro": False, "units": 5}
    assert int(response.headers["retry-after"]) >= 1
    assert api.calls == []


def test_pro_limit_is_reported_as_pro(api):
    api.server.pro, api.server.limit, api.server.used = True, PRO_DAILY_UNITS, PRO_DAILY_UNITS
    api.answer_with(CHEATSHEET)
    body = api.post("/api/quick-prep", json={"context": "Лекция."}).json()
    assert body["code"] == "ai_limit" and body["pro"] is True and body["limit"] == 1000


PODCAST_LINE = {"speaker": "Макс", "text": "О чём лекция?", "source_ids": ["S01"]}


@pytest.mark.parametrize(
    "path,body,kind,units",
    [
        ("/api/quick-prep", {"context": "Лекция про инфляцию и ставку."}, "cheatsheet", 5),
        ("/api/mistakes/practice", {"mistakes": [{"id": "m-1", "question": "Что такое инфляция?"}]}, "mistakesPractice", 2),
        ("/api/podcast/generate", {"context": "Инфляция — устойчивый рост цен.", "title": "Инфляция"}, "conversation", 5),
        ("/api/podcast/visuals", {"lines": [PODCAST_LINE], "context": "Инфляция — рост цен."}, "visuals", 2),
        ("/api/academic/scan", {"text": "Оценки: 5, 4"}, "gradebookScan", 1),
        # Закрыто 2026-10-05: раньше эти вызовы модели ничего не стоили.
        ("/api/analyze/section", {"section": "quiz", "text": "Лекция про инфляцию. " * 20}, "analysisSection", 7),
    ],
)
def test_every_model_endpoint_reserves_its_plan_cost_and_refunds_when_the_model_fails(api, path, body, kind, units):
    assert units == AI_COSTS[kind]
    api.answer_with(AIError.failed())
    api.post(path, json=body)
    assert api.server.rpc("consume_ai_units") == [{"p_units": units, "p_kind": kind}]
    (refund,) = api.server.rpc("refund_ai_units")
    assert refund["p_units"] == units and refund["p_kind"] == kind
    assert api.server.used == 0


MATERIAL_ID = "11111111-2222-4333-8444-555555555555"
STORED_TEXT = "Сохранённый текст лекции про инфляцию и ключевую ставку. " * 12
RECEIPT_KEY = "receipt-test-key"


@pytest.fixture(autouse=True)
def receipt_key(monkeypatch):
    monkeypatch.setenv("ANALYSIS_RECEIPT_KEY", RECEIPT_KEY)


def receipt(user="user-a", text=STORED_TEXT, failed=("quiz",)):
    return receipts.issue(user, text, failed)


def material_row(*, owner="token-a", status="failed", text=STORED_TEXT, receipt_of=None):
    """Строка materials; receipt_of — квитанция анализа (по умолчанию — честная: этот текст, этот владелец, тест не получился)."""
    sections = {"summarizer": {"status": "ok"}}
    if status is not None:
        sections["quiz"] = {"status": status}
    summary = {"sections": sections, "receipt": receipt() if receipt_of is None else receipt_of}
    return {"user_id": TOKENS[owner], "summary_json": summary, "original_text": text}


def serve_material(server, row):
    seen = []

    def inner(request):
        seen.append(request)
        if request.url.path.endswith("/rest/v1/materials"):
            return httpx.Response(200, json=[row] if row else [])
        return httpx.Response(404, json={"code": "PGRST205"})

    server.inner = inner
    return seen


def test_a_section_that_failed_in_a_paid_analysis_is_repaired_free_from_the_saved_text(api):
    seen = serve_material(api.server, material_row())
    api.answer_with(AIError.failed())
    api.post("/api/analyze/section", json={"section": "quiz", "text": "Чужой текст, присланный браузером.", "material_id": MATERIAL_ID})
    assert api.server.rpc("consume_ai_units") == []
    assert seen and f"eq.{MATERIAL_ID}" in str(seen[0].url)
    sent = " ".join(call["user"] + call["system"] for call in api.calls)
    assert "Сохранённый текст лекции" in sent and "Чужой текст" not in sent


@pytest.mark.parametrize(
    "make_row",
    [
        lambda: material_row(status="ok"),        # раздел уже есть: это не починка
        lambda: material_row(status=None),        # раздел не заказывали (лекция «только текст» и т. п.)
        lambda: material_row(owner="token-b"),    # чужой материал читается, но не чинится бесплатно
        lambda: material_row(text=""),            # нет сохранённого текста
        lambda: None,                             # материала нет
        # Строку владелец правит сам, квитанцию — нет:
        lambda: material_row(receipt_of=""),                                     # квитанции нет
        lambda: material_row(text=STORED_TEXT + " Подменённый текст."),          # текст не тот, что анализировали
        lambda: material_row(receipt_of=receipt(user="user-b")),                 # квитанция другого человека
        lambda: material_row(receipt_of=receipt(failed=("flashcards",))),        # тест в анализе получился
        lambda: material_row(receipt_of=receipt()[:-4] + "AAAA"),                # подпись подделана
        lambda: material_row(receipt_of=receipt().replace("r1.", "r1.e30", 1)),  # подменены данные
    ],
    ids=["ok", "not-asked", "not-owner", "no-text", "no-row", "no-receipt", "other-text", "other-user",
         "other-section", "forged-signature", "forged-payload"],
)
def test_a_section_that_is_not_a_repair_costs_its_price(api, make_row):
    serve_material(api.server, make_row())
    api.answer_with(AIError.failed())
    api.post("/api/analyze/section", json={"section": "quiz", "text": "Лекция про инфляцию. " * 20, "material_id": MATERIAL_ID})
    assert api.server.rpc("consume_ai_units") == [{"p_units": AI_COSTS["analysisSection"], "p_kind": "analysisSection"}]


def test_successful_answers_keep_their_units(api):
    api.answer_with(CHEATSHEET)
    assert api.post("/api/quick-prep", json={"context": "Лекция про инфляцию."}).status_code == 200
    assert api.server.rpc("refund_ai_units") == [] and api.server.used == AI_COSTS["cheatsheet"]


# ── Анализ лекции: демо бесплатно, отказ до потока, возврат без результата ─────


class FakeCoordinator:
    outcome = "results"
    runs = 0
    sections: dict = {}

    def __init__(self, api_key):
        pass

    async def process(self, text, enabled_agents=None, **settings):
        FakeCoordinator.runs += 1
        yield {"type": "grounding", "source_count": 1, "sources": []}
        if FakeCoordinator.outcome == "results":
            yield {"type": "results", "summarizer": {"content": "Конспект"}, "warnings": [],
                   "sections": dict(FakeCoordinator.sections)}
        elif FakeCoordinator.outcome == "cut":  # конспект отдан, затем поток оборвался
            for name in ("summarizer", "flashcards", "quiz"):
                yield {"type": "agent_start", "agent": name, "label": name}
            yield {"type": "agent_done", "agent": "summarizer", "status": "ok", "result": {"content": "Конспект"}}
            raise RuntimeError("connection lost")
        elif FakeCoordinator.outcome == "error":
            yield {"type": "error", "code": "failed", "message": "Материал не сохранён, лимит не списан."}
        else:
            raise RuntimeError("boom")


@pytest.fixture
def analyze(api, monkeypatch):
    monkeypatch.setattr(api.main, "CoordinatorAgent", FakeCoordinator)
    FakeCoordinator.outcome, FakeCoordinator.runs, FakeCoordinator.sections = "results", 0, {}
    return api


def post_text(client, text, name="pasted-text.txt"):
    return client.post("/api/analyze", files={"file": (name, text.encode("utf-8"), "text/plain")},
                       data={"enabled_agents": json.dumps(["summarizer"])})


def sse_types(response):
    return [json.loads(line[6:])["type"] for line in response.text.splitlines() if line.startswith("data: ")]


def test_the_built_in_demo_text_is_free_and_any_other_text_costs_a_lecture(analyze):
    demo = DEMO_FILE.read_text(encoding="utf-8").strip()
    response = post_text(analyze, demo)
    assert response.status_code == 200 and sse_types(response)[-1] == "done"
    assert analyze.server.rpc("consume_ai_units") == []

    response = post_text(analyze, demo + "\n\nМоя приписка к лекции.")
    assert response.status_code == 200 and sse_types(response)[-1] == "done"
    assert analyze.server.rpc("consume_ai_units") == [{"p_units": AI_COSTS["lecture"], "p_kind": "lecture"}]
    assert analyze.server.rpc("refund_ai_units") == [] and analyze.server.used == 20


@pytest.mark.parametrize("outcome", ["error", "crash"])
def test_a_run_without_results_gives_the_lecture_units_back(analyze, outcome):
    FakeCoordinator.outcome = outcome
    response = post_text(analyze, "Лекция про инфляцию. " * 30)
    assert response.status_code == 200 and sse_types(response)[-1] == "error"
    (refund,) = analyze.server.rpc("refund_ai_units")
    assert refund["p_units"] == 20 and analyze.server.used == 0


def test_a_run_cut_after_some_sections_keeps_their_share(analyze):
    FakeCoordinator.outcome = "cut"
    response = post_text(analyze, "Лекция про инфляцию. " * 30)
    assert sse_types(response)[-1] == "error"
    kept = -(-AI_COSTS["lecture"] // 3)  # конспект — один из трёх основных разделов, с округлением вверх
    (refund,) = analyze.server.rpc("refund_ai_units")
    assert refund["p_units"] == AI_COSTS["lecture"] - kept and analyze.server.used == kept


def test_an_analysis_with_a_failed_section_hands_its_owner_a_receipt(analyze):
    text = "Лекция про инфляцию. " * 30
    FakeCoordinator.sections = {"summarizer": {"status": "ok"}, "quiz": {"status": "failed", "message": "…"}}
    results = next(event for event in stream_events(post_text(analyze, text)) if event["type"] == "results")
    assert receipts.covers(results["receipt"], "user-a", text, "quiz")
    assert not receipts.covers(results["receipt"], "user-a", text, "summarizer")
    assert not receipts.covers(results["receipt"], "user-b", text, "quiz")

    FakeCoordinator.sections = {"summarizer": {"status": "ok"}}
    results = next(event for event in stream_events(post_text(analyze, text)) if event["type"] == "results")
    assert "receipt" not in results


def test_a_receipt_is_the_servers_word_for_this_user_text_and_section(monkeypatch):
    signed = receipts.issue("user-a", "Текст  лекции\r\nпро ставку", ["quiz", "flashcards"])
    assert signed and len(signed) < receipts.MAX_LENGTH
    assert receipts.covers(signed, "user-a", "Текст лекции\nпро ставку", "quiz")  # пробелы и переносы не важны
    assert receipts.covers(signed, "user-a", "Текст лекции про ставку", "flashcards")
    assert not receipts.covers(signed, "user-a", "Текст лекции про ставку", "summarizer")
    assert not receipts.covers(signed, "user-b", "Текст лекции про ставку", "quiz")
    assert not receipts.covers(signed, "user-a", "Другой текст", "quiz")
    assert receipts.issue("user-a", "Текст", []) is None and receipts.issue(None, "Текст", ["quiz"]) is None
    for junk in (None, 42, "", "r1.x.y", "r2." + signed[3:], signed + "x" * receipts.MAX_LENGTH):
        assert not receipts.covers(junk, "user-a", "Текст лекции про ставку", "quiz")
    monkeypatch.setenv("ANALYSIS_RECEIPT_KEY", "another key")  # новый ключ — прежние квитанции недействительны
    assert not receipts.covers(signed, "user-a", "Текст лекции про ставку", "quiz")
    monkeypatch.delenv("ANALYSIS_RECEIPT_KEY")
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    assert receipts.issue("user-a", "Текст", ["quiz"]) is None  # без ключей сервера квитанций нет


def test_a_file_without_text_costs_nothing(analyze):
    response = post_text(analyze, "   ")
    assert sse_types(response) == ["error"]
    assert analyze.server.used == 0 and len(analyze.server.rpc("refund_ai_units")) == 1


def test_the_limit_is_a_429_before_the_stream_and_the_model_never_runs(analyze):
    analyze.server.used = 90
    response = post_text(analyze, "Лекция про инфляцию. " * 30)
    assert response.status_code == 429 and response.json()["code"] == "ai_limit"
    assert response.headers["content-type"].startswith("application/json")
    assert FakeCoordinator.runs == 0
    response = analyze.post("/api/analyze/url", data={"url": "https://example.com/lecture"})
    assert response.status_code == 429 and response.json()["code"] == "ai_limit"


# ── Распознавание сканов: «только текст», список вопросов, анализ ───────────────

SCAN_QUESTIONS = "Вопросы к экзамену\n1. Предмет и метод макроэкономики.\n2. ВВП и способы его измерения.\n3. Инфляция и её виды."


@pytest.fixture
def gemini(monkeypatch):
    """Подменённый Gemini распознавания (FakeGemini из test_lecture_formats): gemini(behaviour) ставит его."""

    def install_fake(behaviour=None):
        return (FakeGemini() if behaviour is None else FakeGemini(behaviour)).install(monkeypatch)

    yield install_fake
    base._GENAI_CLIENTS.clear()
    base._MODEL_SKIP.clear()


def scan_file(pages=2, name="scan.pdf"):
    return {"file": (name, scan_pdf(pages), "application/pdf")}


def stream_events(response):
    return [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")]


def test_a_scan_imported_as_text_or_as_a_question_list_costs_its_recognition(api, gemini):
    gemini()
    lecture = api.post("/api/extract", files=scan_file(16, "Лекция.pdf"))
    plain = api.post("/api/extract", files={"file": ("lecture.txt", ("Деньги — особый товар. " * 30).encode(), "text/plain")})
    gemini(lambda call: (SCAN_QUESTIONS, "STOP"))
    questions = api.post("/api/exams/parse", files=scan_file(1, "Вопросы.pdf"))
    assert lecture.status_code == 200 and lecture.json()["ocr"] is True, lecture.text
    assert plain.status_code == 200 and questions.status_code == 200, questions.text
    assert api.server.rpc("consume_ai_units") == [
        {"p_units": 2 * AI_COSTS["scanPages"], "p_kind": "scanPages"},  # 16 страниц — два куска по 15
        {"p_units": AI_COSTS["scanPages"], "p_kind": "scanPages"},
    ]
    assert api.server.rpc("refund_ai_units") == []


def test_a_failed_recognition_gives_its_units_back_and_a_spent_limit_stops_it_before_the_model(api, gemini):
    gemini(lambda call: gemini_error(429, "RESOURCE_EXHAUSTED"))
    busy = api.post("/api/extract", files=scan_file())
    assert busy.status_code == 429 and busy.json()["code"] == "ai_busy"
    (refund,) = api.server.rpc("refund_ai_units")
    assert (refund["p_kind"], refund["p_units"]) == ("scanPages", AI_COSTS["scanPages"]) and api.server.used == 0

    fake = gemini(lambda call: (SCAN_QUESTIONS, "STOP"))
    api.server.used = FREE_DAILY_UNITS - 1
    spent = api.post("/api/exams/parse", files=scan_file(1, "Вопросы.pdf"))
    assert spent.status_code == 429 and set(spent.json()) == LIMIT_BODY_KEYS
    assert spent.json()["code"] == "ai_limit" and spent.json()["units"] == AI_COSTS["scanPages"]
    assert fake.calls == []


def test_the_analysis_of_a_scan_adds_its_recognition_to_the_lecture(analyze, gemini):
    gemini()
    response = analyze.post("/api/analyze", files=scan_file(), data={"enabled_agents": json.dumps(["summarizer"])})
    assert sse_types(response)[-1] == "done", response.text
    assert analyze.server.rpc("consume_ai_units") == [
        {"p_units": AI_COSTS["lecture"], "p_kind": "lecture"},
        {"p_units": AI_COSTS["scanPages"], "p_kind": "scanPages"},
    ]
    assert analyze.server.rpc("refund_ai_units") == [] and analyze.server.used == AI_COSTS["lecture"] + AI_COSTS["scanPages"]


def test_a_cut_scan_run_keeps_its_recognition_whole_and_the_share_of_the_lecture(analyze, gemini):
    gemini()
    FakeCoordinator.outcome = "cut"
    analyze.post("/api/analyze", files=scan_file(), data={"enabled_agents": json.dumps(["summarizer"])})
    kept = -(-AI_COSTS["lecture"] // 3)
    (refund,) = analyze.server.rpc("refund_ai_units")
    assert (refund["p_kind"], refund["p_units"]) == ("lecture", AI_COSTS["lecture"] - kept)
    assert analyze.server.used == kept + AI_COSTS["scanPages"]


@pytest.mark.parametrize("failure", ["analysis", "recognition"])
def test_a_scan_analysis_without_results_gives_back_the_lecture_and_the_recognition(analyze, gemini, failure):
    if failure == "analysis":
        gemini()
        FakeCoordinator.outcome = "error"
    else:
        gemini(lambda call: gemini_error(429, "RESOURCE_EXHAUSTED"))
    response = analyze.post("/api/analyze", files=scan_file(), data={"enabled_agents": json.dumps(["summarizer"])})
    assert sse_types(response)[-1] == "error"
    assert sorted(args["p_kind"] for args in analyze.server.rpc("refund_ai_units")) == ["lecture", "scanPages"]
    assert analyze.server.used == 0


def test_a_scan_over_the_rest_of_the_limit_ends_the_stream_with_ai_limit_before_recognition(analyze, gemini):
    fake = gemini()
    left = AI_COSTS["lecture"]  # хватает на лекцию, но не на лекцию со сканом
    analyze.server.used = FREE_DAILY_UNITS - left
    response = analyze.post("/api/analyze", files=scan_file(), data={"enabled_agents": json.dumps(["summarizer"])})
    events = stream_events(response)
    assert [event["type"] for event in events] == ["status", "error"]
    # Окно лимита считает день без вернувшихся единиц лекции и цену всего прогона.
    assert {key: events[-1][key] for key in ("code", "used", "limit", "units")} == {
        "code": "ai_limit", "used": FREE_DAILY_UNITS - left, "limit": FREE_DAILY_UNITS,
        "units": AI_COSTS["lecture"] + AI_COSTS["scanPages"],
    }
    assert fake.calls == [] and FakeCoordinator.runs == 0
    assert analyze.server.used == FREE_DAILY_UNITS - left


def test_a_spent_day_or_hour_window_says_so_instead_of_wait_a_minute():
    from limits import parse_many
    from slowapi.errors import RateLimitExceeded

    import ratelimit

    def detail(window):
        (item,) = parse_many(window)
        return ratelimit._detail_for(RateLimitExceeded(SimpleNamespace(limit=item, error_message=None)))

    assert detail("5/minute") == ratelimit.RATE_LIMIT_DETAIL
    assert detail("30/day") == ratelimit.RATE_LIMIT_DAY_DETAIL
    assert detail("100/hour") == ratelimit.RATE_LIMIT_HOUR_DETAIL
    assert "завтра" in ratelimit.RATE_LIMIT_DAY_DETAIL


# ── Ответ вслух ────────────────────────────────────────────────────────────────


@pytest.fixture
def oral(monkeypatch, quota_on):
    import main
    from fastapi.testclient import TestClient
    from test_oral_api import ANON as ORAL_ANON, URL as ORAL_URL, FakeModel, FakeSupabase as OralSupabase

    async def fake_user(request):
        token = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
        if token not in TOKENS:
            raise HTTPException(status_code=401, detail="Требуется войти в аккаунт")
        return {"id": TOKENS[token]}

    monkeypatch.setattr(main, "require_authenticated_user", fake_user)
    monkeypatch.setattr(main.limiter, "enabled", False)
    for name in ("GEMINI_API_KEY", "GROQ_API_KEY", "ORAL_CHECK_TIMEOUT_SECONDS"):
        monkeypatch.delenv(name, raising=False)
    fake = OralSupabase()
    server = QuotaServer(inner=fake.handler)
    install(monkeypatch, server)
    monkeypatch.setenv("SUPABASE_URL", ORAL_URL)
    monkeypatch.setenv("SUPABASE_KEY", ORAL_ANON)
    monkeypatch.setattr(sys.modules[__name__], "ANON", ORAL_ANON)
    model = FakeModel()

    async def fake_run(agent, system_prompt, user_text, **kwargs):
        return await model.run(agent, system_prompt, user_text, **kwargs)

    monkeypatch.setattr(BaseAgent, "run", fake_run)
    monkeypatch.setattr(BaseAgent, "forget", classmethod(lambda cls, raw: None))
    oral_api._flights.clear()
    client = TestClient(main.app, headers={"Authorization": "Bearer token-a"})
    client.fake, client.model, client.server = fake, model, server
    yield client
    oral_api._flights.clear()


def evaluation_answer():
    return {"points": [{"id": "p1", "status": "covered", "student_quote": "цель", "comment": "Названо."},
                       {"id": "p2", "status": "missing", "student_quote": "", "comment": "Нет."}],
            "errors": [], "verdict": "Цель названа, про ставку не сказано."}


def test_evaluate_costs_an_answer_and_a_failed_protocol_costs_nothing(oral):
    from test_oral_api import evaluate_body

    oral.model.answer(evaluation_answer())
    assert oral.post("/api/oral/evaluate", json=evaluate_body()).status_code == 200
    assert oral.server.rpc("consume_ai_units") == [{"p_units": AI_COSTS["answer"], "p_kind": "answer"}]

    oral.model.answer(AIError.timeout())
    assert oral.post("/api/oral/evaluate", json=evaluate_body()).status_code == 504
    assert len(oral.server.rpc("refund_ai_units")) == 1 and oral.server.used == AI_COSTS["answer"]

    # Пустой ответ оценивается без модели — и без единиц.
    assert oral.post("/api/oral/evaluate", json=evaluate_body(transcript="   ")).status_code == 200
    assert len(oral.server.rpc("consume_ai_units")) == 2


def test_quick_checks_are_free(oral):
    from test_oral_api import check_body

    oral.model.answer({"statuses": {"p1": "covered", "p2": "missing", "p3": "missing", "p4": "missing"}})
    assert oral.post("/api/oral/check", json=check_body()).status_code == 200
    assert oral.server.rpc("consume_ai_units") == []


def test_new_answer_points_cost_one_unit_and_saved_ones_are_free(oral):
    from test_oral_api import econ_exam, post_rubric, rubric_answer

    exam_id, question_id, _ = econ_exam(oral.fake)
    oral.model.answer(rubric_answer())
    first = post_rubric(oral, exam_id, question_id)
    assert first.status_code == 200 and first.json()["cached"] is False
    second = post_rubric(oral, exam_id, question_id)
    assert second.status_code == 200 and second.json()["cached"] is True
    assert oral.server.rpc("consume_ai_units") == [{"p_units": AI_COSTS["answerPoints"], "p_kind": "answerPoints"}]


def test_two_simultaneous_rubric_requests_pay_once(oral):
    import main
    from test_oral_api import econ_exam, rubric_answer

    exam_id, question_id, _ = econ_exam(oral.fake)
    oral.model.answer(rubric_answer())
    oral.model.delay = 0.2

    async def both():
        transport = httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver",
                                     headers={"Authorization": "Bearer token-a"}) as client:
            body = {"exam_id": exam_id, "question_id": question_id}
            return await asyncio.gather(client.post("/api/oral/rubric", json=body), client.post("/api/oral/rubric", json=body))

    first, second = asyncio.run(both())
    assert first.status_code == second.status_code == 200
    assert len(oral.server.rpc("consume_ai_units")) == 1


def test_a_rubric_the_model_could_not_build_gives_the_unit_back_and_the_limit_is_429(oral):
    from test_oral_api import econ_exam, post_rubric

    exam_id, question_id, _ = econ_exam(oral.fake)
    oral.model.answer(AIError.busy())
    assert post_rubric(oral, exam_id, question_id).status_code == 429
    assert len(oral.server.rpc("refund_ai_units")) == 1 and oral.server.used == 0

    oral.server.used = FREE_DAILY_UNITS
    response = post_rubric(oral, exam_id, question_id)
    assert response.status_code == 429 and set(response.json()) == LIMIT_BODY_KEYS
    assert response.json()["code"] == "ai_limit"


# ── Сверка списка с лекциями ───────────────────────────────────────────────────


@pytest.fixture
def mapping(monkeypatch, quota_on):
    import main
    from fastapi.testclient import TestClient
    from test_exams_map import ANON as MAP_ANON, RULES, URL as MAP_URL, Clock, FakeSupabase as MapSupabase, Judge, honest

    async def fake_user(request):
        token = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
        if token not in TOKENS:
            raise HTTPException(status_code=401, detail="Требуется войти в аккаунт")
        return {"id": TOKENS[token]}

    monkeypatch.setattr(main, "require_authenticated_user", fake_user)
    monkeypatch.setattr(main.limiter, "enabled", False)
    for name in ("GEMINI_API_KEY", "GROQ_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(exams_map, "STAGGER_SECONDS", 0.0)
    clock = Clock()
    monkeypatch.setattr(exams_map, "_now", clock)
    fake = MapSupabase()
    fake.clock = clock
    server = QuotaServer(inner=fake.handler)
    install(monkeypatch, server)
    monkeypatch.setenv("SUPABASE_URL", MAP_URL)
    monkeypatch.setenv("SUPABASE_KEY", MAP_ANON)
    monkeypatch.setattr(sys.modules[__name__], "ANON", MAP_ANON)
    judge = Judge(honest(RULES))

    async def fake_run(agent, system_prompt, user_text, **kwargs):
        return await judge.run(agent, system_prompt, user_text, **kwargs)

    monkeypatch.setattr(BaseAgent, "run", fake_run)
    BaseAgent._run_cache.clear()
    client = TestClient(main.app, headers={"Authorization": "Bearer token-a"})
    client.fake, client.judge, client.server = fake, judge, server
    yield client
    BaseAgent._run_cache.clear()


def map_events(client, exam_id, **body):
    response = client.post(f"/api/exams/{exam_id}/map", json={"question_ids": None, "force": False, **body})
    assert response.status_code == 200, response.text
    return [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")]


def test_mapping_charges_ten_per_started_forty_questions_that_go_to_the_model(mapping):
    from test_exams_map import Q_BACKPROP, Q_PHILLIPS, Q_POLICY, course

    questions = [f"{Q_POLICY} {n}" for n in range(1, 42)] + [Q_BACKPROP, Q_PHILLIPS]
    exam_id, _, _ = course(mapping.fake, questions)
    events = map_events(mapping, exam_id)
    assert events[-1]["type"] == "done" and events[-1]["used_ai"] is True
    judged = sum(len(call["questions"]) for call in mapping.judge.calls)
    assert judged == 42  # «Кривая Филлипса» без общих слов с лекциями — «нет» без модели и бесплатно
    (spent,) = mapping.server.rpc("consume_ai_units")
    assert spent == {"p_units": exam_mapping_cost(judged), "p_kind": "examMapping"} and spent["p_units"] == 20
    assert mapping.server.rpc("refund_ai_units") == []

    # Повтор: всё уже проверено — модель не нужна, единиц нет.
    again = map_events(mapping, exam_id)
    assert again[-1]["type"] == "done" and len(mapping.server.rpc("consume_ai_units")) == 1


def test_mapping_where_the_model_answered_nothing_gives_the_units_back(mapping):
    from test_exams_map import Q_BACKPROP, course

    mapping.judge.script = lambda questions, number: AIError.busy()
    exam_id, _, _ = course(mapping.fake, [Q_BACKPROP])
    events = map_events(mapping, exam_id)
    assert events[-1]["type"] == "done" and events[-1]["used_ai"] is False
    assert mapping.server.rpc("consume_ai_units") == [{"p_units": 10, "p_kind": "examMapping"}]
    assert len(mapping.server.rpc("refund_ai_units")) == 1 and mapping.server.used == 0


def test_mapping_over_the_limit_is_an_ai_limit_event_and_no_model_call(mapping):
    from test_exams_map import Q_BACKPROP, course

    mapping.server.used = 95
    exam_id, _, _ = course(mapping.fake, [Q_BACKPROP])
    events = map_events(mapping, exam_id)
    last = events[-1]
    assert last == {"type": "error", "code": "ai_limit", "message": "Дневной лимит ИИ на сегодня исчерпан.",
                    "used": 95, "limit": 100, "resets_at": RESETS_AT, "pro": False, "units": 10}
    assert mapping.judge.calls == []
    assert mapping.fake.row("exams", exam_id)["mapping_state"] == "failed"


def test_mapping_without_questions_for_the_model_costs_nothing(mapping):
    from test_exams_map import Q_PHILLIPS, course

    exam_id, _, _ = course(mapping.fake, [Q_PHILLIPS])
    events = map_events(mapping, exam_id)
    assert events[-1]["type"] == "done" and mapping.server.rpc("consume_ai_units") == []


# ── Какая модель ответила: журнал вызовов и /api/health ────────────────────────


def install_gemini(monkeypatch, behaviour):
    calls = []

    class FakeClient:
        def __init__(self, api_key=None, **kwargs):
            async def generate_content(*, model, contents, config):
                calls.append({"model": model, "config": config})
                result = behaviour(model)
                if isinstance(result, BaseException):
                    raise result
                return SimpleNamespace(text=result, candidates=[SimpleNamespace(finish_reason="STOP")])

            self.aio = SimpleNamespace(models=SimpleNamespace(generate_content=generate_content))

    monkeypatch.setattr(base.genai, "Client", FakeClient)
    base._GENAI_CLIENTS.clear()
    base._MODEL_SKIP.clear()
    return calls


@pytest.fixture
def clean_agent(monkeypatch):
    for name in ("GEMINI_MODELS", "GEMINI_FAST_MODELS", "GROQ_MODEL", "GROQ_FAST_MODEL", "AI_CACHE_DISABLED"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-key")
    monkeypatch.setattr(base, "_LAST_ANSWER", {})
    BaseAgent._run_cache.clear()
    BaseAgent._cache_info.clear()
    yield
    BaseAgent._run_cache.clear()
    BaseAgent._cache_info.clear()
    base._GENAI_CLIENTS.clear()
    base._MODEL_SKIP.clear()


def test_every_real_call_is_logged_for_its_user_in_the_background(server, clean_agent, monkeypatch):
    install_gemini(monkeypatch, lambda model: "ответ")

    async def go():
        spent = await quota.reserve("token-a", "answerPoints", 1)
        assert spent.units == 1
        await BaseAgent().run("Ты помощник.", "Вопрос один")
        await BaseAgent().run("Ты помощник.", "Вопрос один")  # из кэша — не вызов
        await BaseAgent().run("Ты помощник.", "Вопрос два")
        await quota.drain_background()

    run(go())
    logs = server.rpc("log_ai_call")
    assert len(logs) == 2
    assert logs[0] == {"p_kind": "answerPoints", "p_units": 1, "p_provider": "gemini", "p_model": "gemini-3.5-flash-lite",
                       "p_ok": True, "p_ms": logs[0]["p_ms"]}
    assert logs[1]["p_units"] == 0 and isinstance(logs[0]["p_ms"], int)
    assert all(token == "token-a" for fn, _, token in server.calls)


def test_a_failed_call_is_logged_with_its_last_model_and_never_breaks_the_answer(server, clean_agent, monkeypatch):
    from google.genai import errors

    install_gemini(monkeypatch, lambda model: errors.ServerError(503, {"error": {"code": 503, "status": "UNAVAILABLE"}}))
    server.fail = 500  # журнал тоже не пишется — ответ от этого не меняется

    async def go():
        await quota.reserve("token-a", "visuals", 0)
        with pytest.raises(AIError):
            await BaseAgent().run("Ты помощник.", "Вопрос")
        await quota.drain_background()

    run(go())
    (log,) = server.rpc("log_ai_call")
    # The last model of the list is the one named for a call that failed on all of them.
    assert log["p_ok"] is False and log["p_provider"] == "gemini" and log["p_model"] == base.gemini_models_env()[-1]
    assert log["p_kind"] == "visuals"


def test_without_a_bound_user_or_with_the_log_off_nothing_is_sent(server, clean_agent, monkeypatch):
    install_gemini(monkeypatch, lambda model: "ответ")

    async def unbound():
        await BaseAgent().run("Ты помощник.", "Вопрос без пользователя")
        await quota.drain_background()

    asyncio.run(unbound())
    monkeypatch.setenv("AI_CALL_LOG_DISABLED", "1")

    async def off():
        await quota.reserve("token-a", "answerPoints", 0)
        await BaseAgent().run("Ты помощник.", "Вопрос при выключенном журнале")
        await quota.drain_background()

    asyncio.run(off())
    assert server.rpc("log_ai_call") == []


def test_the_auth_middleware_binds_the_user_and_the_path_kind(api, monkeypatch):
    seen = []

    async def fake_run(self, system_prompt, user_text, **kwargs):
        seen.append(quota._CALL_CONTEXT.get())
        return "Что такое ставка?"

    monkeypatch.setattr(BaseAgent, "run", fake_run)
    api.post("/api/quick-prep", json={"context": "Лекция."})
    api.post("/api/mistakes/practice", json={"mistakes": [{"id": "m-1", "question": "Что такое инфляция?"}]})
    assert [(ctx.token, ctx.kind, ctx.units) for ctx in seen] == [
        ("token-a", "cheatsheet", 5), ("token-a", "mistakesPractice", 2)]
    assert quota.kind_from_path(f"/api/exams/{uuid.uuid4()}/map") == "exams_map"
    assert quota.kind_from_path("/api/oral/check") == "oral_check"


def test_health_names_the_model_that_answered_last_without_user_data(clean_agent, monkeypatch):
    import main
    from fastapi.testclient import TestClient

    install_gemini(monkeypatch, lambda model: "ответ")
    client = TestClient(main.app)
    assert client.get("/api/health").json()["ai"] == {"provider": None, "model": None, "at": None}
    asyncio.run(BaseAgent().run("Ты помощник.", "Вопрос"))
    ai = client.get("/api/health").json()["ai"]
    assert ai["provider"] == "gemini" and ai["model"] == "gemini-3.5-flash-lite"
    assert ai["at"].endswith("Z") and len(ai["at"]) == 20
    first_at = ai["at"]
    asyncio.run(BaseAgent().run("Ты помощник.", "Вопрос"))  # из кэша: «последний ответ» не меняется
    assert client.get("/api/health").json()["ai"]["at"] == first_at
    assert set(client.get("/api/health").json()) == {"status", "groq_configured", "gemini_configured", "ai"}


# ── Модели по умолчанию ────────────────────────────────────────────────────────


def test_default_models_and_the_fallback_when_the_first_one_is_gone(clean_agent, monkeypatch):
    from google.genai import errors

    assert base.gemini_models_env() == ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]
    assert base.gemini_models(fast=True) == ["gemini-3.1-flash-lite", "gemini-3.5-flash-lite"]
    assert base.groq_model() == "openai/gpt-oss-120b" and base.groq_fast_model() == "openai/gpt-oss-20b"
    monkeypatch.setenv("GROQ_MODEL", "my-groq")
    monkeypatch.setenv("GROQ_FAST_MODEL", "my-fast")
    monkeypatch.setenv("GEMINI_MODELS", "a-model,b-model")
    assert (base.groq_model(), base.groq_fast_model(), base.gemini_models_env()) == ("my-groq", "my-fast", ["a-model", "b-model"])
    # A key that lost a model: it is skipped and the next one in the list answers.
    monkeypatch.setenv("GEMINI_MODELS", "gemini-2.5-flash-lite,gemini-3.1-flash-lite")

    gone = errors.ClientError(404, {"error": {"code": 404, "status": "NOT_FOUND", "message": "model not found"}})
    calls = install_gemini(monkeypatch, lambda model: gone if model == "gemini-2.5-flash-lite" else "ответ 3.1")
    meta = {}
    assert asyncio.run(BaseAgent().run("Ты помощник.", "Вопрос", meta=meta)) == "ответ 3.1"
    assert [call["model"] for call in calls] == ["gemini-2.5-flash-lite", "gemini-3.1-flash-lite"]
    assert meta["model"] == "gemini-3.1-flash-lite" and base.model_skipped("gemini", "gemini-key", "gemini-2.5-flash-lite")
    # Gemini 3 получает явный уровень размышлений: без режима — LOW, а не «high» по умолчанию у Google.
    assert calls[-1]["config"].thinking_config.thinking_level.name == "LOW"
    assert asyncio.run(BaseAgent().run("Ты помощник.", "Другой", meta=meta)) == "ответ 3.1"
    assert [call["model"] for call in calls][-1] == "gemini-3.1-flash-lite"  # пропущенная модель не вызывается снова


@pytest.mark.parametrize("mode,level,label", [(None, "LOW", "low"), ("low", "LOW", "low"), ("off", "MINIMAL", "off")])
def test_thinking_plan_for_gemini_3_models(mode, level, label):
    plan = base.thinking_plan("gemini-3.1-flash-lite", mode)
    assert plan.config.thinking_level.name == level and plan.label == label
    assert plan.allowance == base.THINKING_ALLOWANCE
    assert base.thinking_plan("gemini-2.5-flash-lite", None).config is None  # 2.5: по-прежнему умолчание провайдера
