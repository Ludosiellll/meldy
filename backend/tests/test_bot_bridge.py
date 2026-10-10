"""Мост бота к Space (bot_bridge.py): голосовой ответ по одноразовому билету.

База — подменённый транспорт httpx: в памяти две функции билета (bridge_voice_take, bridge_voice_refund) с правилами
миграции 20261010120006 (билет берётся один раз, что бы ни ответил; 2 минуты; привязан к попытке, вопросу и заданию;
потолок студента, общий стоп, лимит ИИ; единицы списывает take проверки, возврат — один раз). Распознавание —
подменённый stt.transcribe_answer, модели — подменённый BaseAgent.run.

Проверяется: путь открыт без сессии и ходит в базу только публичным ключом; каждый отказ (нет билета, битый, чужой,
использованный, просроченный, выключено, потолок, стоп, лимит, коротко, не распознано, «не знаю», сбой модели) —
без списания или с возвратом; настоящая проверка — те же промпты и параметры, что /api/oral/check и /api/oral/evaluate;
журнал без звука, текста, вопроса, билета и id; в Telegram Space не ходит.
"""
import json
import re
import sys
import uuid
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import bot_bridge  # noqa: E402
import oral  # noqa: E402
import oral_api  # noqa: E402
import stt  # noqa: E402
import supabase_rest  # noqa: E402
from agents import base as ai_base  # noqa: E402
from agents.base import AIError, BaseAgent  # noqa: E402
from plans import AI_COSTS  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
URL = "https://bridge-test.supabase.invalid"
ANON = "anon-test-key"
QUESTION = "Взаимоблокировка: условия возникновения и способы предотвращения."
FOLLOWUP_Q = "Какие условия должны выполняться одновременно, чтобы возникла взаимоблокировка?"
ANSWER = ("Взаимоблокировка — это когда процессы ждут ресурсы, занятые друг другом. Ресурс занят одним процессом, "
          "процесс держит ресурс и ждёт другой.")
AUDIO = b"OggS" + bytes(4000)
POINTS = [
    {"id": "p1", "title": "Взаимное исключение: ресурс занят одним процессом", "essential": True,
     "source_quote": "ресурс может использовать только один процесс",
     "followup": {"question": "Что значит взаимное исключение?", "expected": "Ресурс занят одним процессом."}},
    {"id": "p2", "title": "Удержание и ожидание: процесс держит ресурс и ждёт другой", "essential": True,
     "source_quote": "процесс удерживает ресурс и ожидает другой",
     "followup": {"question": FOLLOWUP_Q, "expected": "Четыре условия Коффмана."}},
    {"id": "p3", "title": "Круговое ожидание: цепочка процессов ждёт друг друга", "essential": False,
     "source_quote": "процессы образуют замкнутую цепь ожидания",
     "followup": {"question": "Что такое круговое ожидание?", "expected": "Замкнутая цепь."}},
]


class FakeDb:
    """bridge_voice_take / bridge_voice_refund в памяти, по правилам миграции (без лишнего)."""

    def __init__(self):
        self.tickets: dict[str, dict] = {}
        self.requests: list[httpx.Request] = []
        self.voice_on = True
        self.used = 12  # единицы сегодня (лимит 100)
        self.limit = 100
        self.audio = {"user": 0, "all": 0}
        self.user_cap = 1800
        self.stop = 20160
        self.down = False

    def issue(self, job, *, seconds=30, parts=0, gone=False, expired=False, charged=False, transcript=ANSWER):
        ticket = uuid.uuid4().hex + uuid.uuid4().hex
        self.tickets[ticket] = {"job": job, "seconds": seconds, "parts": parts, "gone": gone, "expired": expired,
                                "taken": False, "charge": None, "refunded": False, "charged_before": charged,
                                "transcript": transcript}
        return ticket

    def take(self, ticket):
        t = self.tickets.get(ticket) if isinstance(ticket, str) and re.match(r"^[0-9a-f]{64}$", ticket) else None
        if t is None:
            return {"status": "invalid"}
        if t["taken"]:
            return {"status": "used"}
        t["taken"] = True
        if t["expired"]:
            return {"status": "expired"}
        if not self.voice_on:
            return {"status": "off"}
        if t["gone"]:
            return {"status": "gone"}
        if t["job"] in ("transcribe", "followup"):
            cost = max(t["seconds"], 10)
            if self.audio["user"] + cost > self.user_cap:
                return {"status": "ceiling"}
            if self.audio["all"] + cost > self.stop:
                return {"status": "stop"}
            self.audio["user"] += cost
            self.audio["all"] += cost
        if t["job"] == "transcribe":
            return {"status": "ok", "job": "transcribe", "hint": QUESTION[:300], "min_words": 8 if t["parts"] == 0 else 1}
        if t["job"] == "check":
            if not t["charged_before"]:
                if self.used + 4 > self.limit:
                    return {"status": "limit"}
                self.used += 4
                t["charge"] = 4
            return {"status": "ok", "job": "check", "question": QUESTION, "transcript": t["transcript"], "points": POINTS,
                    "units": {"charged": 4, "left": self.limit - self.used}}
        return {"status": "ok", "job": "followup", "question": QUESTION, "hint": FOLLOWUP_Q, "point_id": "p2",
                "followup": {"question": FOLLOWUP_Q, "expected": "Четыре условия Коффмана."},
                "points": [{key: p[key] for key in ("id", "title", "essential")} for p in POINTS]}

    def refund(self, ticket):
        t = self.tickets.get(ticket)
        if t is None:
            return {"status": "invalid"}
        if t["job"] != "check" or not t["taken"] or t["charge"] is None or t["refunded"]:
            return {"status": "no"}
        t["refunded"] = True
        self.used -= t["charge"]
        return {"status": "ok", "refunded": t["charge"]}

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.down:
            return httpx.Response(503, json={"message": "down"})
        fn = request.url.path.rsplit("/", 1)[-1]
        body = json.loads(request.content or b"{}")
        if fn == "bridge_voice_take":
            return httpx.Response(200, json=self.take(body.get("p_ticket")))
        if fn == "bridge_voice_refund":
            return httpx.Response(200, json=self.refund(body.get("p_ticket")))
        return httpx.Response(404, json={"code": "PGRST202"})


class FakeStt:
    def __init__(self):
        self.calls: list[dict] = []
        self.answer: object = ANSWER

    async def transcribe(self, data, mime, hint=""):
        self.calls.append({"bytes": len(data), "mime": mime, "hint": hint})
        if isinstance(self.answer, BaseException):
            raise self.answer
        return self.answer


class FakeModel:
    """BaseAgent.run: быстрая проверка и протокол узнаются по промпту; записывает вызовы."""

    def __init__(self):
        self.calls: list[dict] = []
        self.check: object = {"statuses": {"p1": "covered", "p2": "missing", "p3": "covered"}}
        self.only: object = {"statuses": {"p2": "covered"}}
        self.protocol: object = {
            "points": [{"id": "p1", "status": "covered", "student_quote": "Ресурс занят одним процессом", "comment": "Сказано."},
                       {"id": "p2", "status": "missing", "student_quote": "", "comment": ""},
                       {"id": "p3", "status": "covered", "student_quote": "процессы ждут ресурсы", "comment": ""}],
            "errors": [], "verdict": "Назван главный пункт."}

    async def run(self, agent, system_prompt, user_text, **kwargs):
        kind = "evaluate" if system_prompt.startswith("Ты — экзаменатор и составляешь протокол") else (
            "only" if "дополнительный вопрос" in system_prompt else "check")
        self.calls.append({"kind": kind, "system": system_prompt, "text": user_text, "kwargs": kwargs})
        answer = {"check": self.check, "only": self.only, "evaluate": self.protocol}[kind]
        if isinstance(answer, BaseException):
            raise answer
        return answer if isinstance(answer, str) else json.dumps(answer, ensure_ascii=False)


@pytest.fixture
def env(monkeypatch):
    import main
    from fastapi.testclient import TestClient

    async def no_session(request):
        raise AssertionError("/api/bot/voice must not ask for a session")

    monkeypatch.setattr(main, "require_authenticated_user", no_session)
    monkeypatch.setattr(main.limiter, "enabled", False)
    monkeypatch.setenv("SUPABASE_URL", URL)
    monkeypatch.setenv("SUPABASE_KEY", ANON)
    db = FakeDb()
    monkeypatch.setattr(supabase_rest, "_transport", httpx.MockTransport(db.handler))
    speech = FakeStt()
    monkeypatch.setattr(stt, "transcribe_answer", speech.transcribe)
    model = FakeModel()

    async def fake_run(agent, system_prompt, user_text, **kwargs):
        return await model.run(agent, system_prompt, user_text, **kwargs)

    monkeypatch.setattr(BaseAgent, "run", fake_run)
    monkeypatch.setattr(BaseAgent, "forget", classmethod(lambda cls, raw: None))
    client = TestClient(main.app)
    return client, db, speech, model, main


def post(client, ticket=None, body=b"", content_type=None, headers=None):
    sent = dict(headers or {})
    if ticket is not None:
        sent[bot_bridge.TICKET_HEADER] = ticket
    if content_type:
        sent["Content-Type"] = content_type
    return client.post(bot_bridge.BOT_VOICE_PATH, content=body, headers=sent)


# ── The path ────────────────────────────────────────────────────────────────────


def test_the_path_is_public_and_needs_a_well_formed_ticket_before_the_database(env):
    client, db, speech, model, main = env
    assert bot_bridge.BOT_VOICE_PATH in main.PUBLIC_API_PATHS
    for ticket in (None, "", "short", "G" * 64, "A" * 64, "a" * 63, "a" * 65):
        response = post(client, ticket, AUDIO, "audio/ogg")
        assert response.status_code == 400 and response.json() == {"status": "invalid"}
    assert db.requests == [] and speech.calls == [] and model.calls == []


def test_the_database_is_reached_with_the_public_key_only(env, monkeypatch):
    client, db, speech, model, main = env
    ticket = db.issue("transcribe")
    assert post(client, ticket, AUDIO, "audio/ogg").json()["status"] == "ok"
    request = db.requests[0]
    assert str(request.url) == f"{URL}/rest/v1/rpc/bridge_voice_take"
    assert request.headers["apikey"] == ANON and request.headers["authorization"] == f"Bearer {ANON}"
    assert json.loads(request.content) == {"p_ticket": ticket}
    # A new publishable key goes on apikey only (as the bot's db.ts does with the secret key).
    monkeypatch.setenv("SUPABASE_KEY", "sb_publishable_test")
    post(client, db.issue("transcribe"), AUDIO, "audio/ogg")
    assert db.requests[-1].headers["apikey"] == "sb_publishable_test" and "authorization" not in db.requests[-1].headers


def test_the_bridge_never_talks_to_telegram_and_holds_no_service_key():
    source = (ROOT / "backend" / "bot_bridge.py").read_text(encoding="utf-8")
    for needle in ("api.telegram.org", "getFile", "TELEGRAM_BOT_TOKEN", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEYS",
                   "os.getenv", "os.environ"):
        assert needle not in source, needle


# ── Tickets: unknown, foreign, used twice, expired, off ─────────────────────────


def test_an_unknown_ticket_is_invalid(env):
    client, db, speech, model, main = env
    response = post(client, "f" * 64, AUDIO, "audio/ogg")
    assert response.status_code == 200 and response.json() == {"status": "invalid"}
    assert speech.calls == []


def test_a_foreign_ticket_does_nothing(env):
    client, db, speech, model, main = env
    # Bound to another attempt or question (the database says gone): no recognition, nothing counted.
    ticket = db.issue("transcribe", gone=True)
    assert post(client, ticket, AUDIO, "audio/ogg").json() == {"status": "gone"}
    assert speech.calls == [] and db.audio == {"user": 0, "all": 0}


def test_a_ticket_used_twice_works_once(env):
    client, db, speech, model, main = env
    ticket = db.issue("transcribe")
    assert post(client, ticket, AUDIO, "audio/ogg").json()["status"] == "ok"
    assert post(client, ticket, AUDIO, "audio/ogg").json() == {"status": "used"}
    assert len(speech.calls) == 1 and db.audio["user"] == 30


def test_an_expired_ticket_is_refused_and_burned(env):
    client, db, speech, model, main = env
    ticket = db.issue("transcribe", expired=True)
    assert post(client, ticket, AUDIO, "audio/ogg").json() == {"status": "expired"}
    assert post(client, ticket, AUDIO, "audio/ogg").json() == {"status": "used"}
    assert speech.calls == []


def test_switched_off_the_space_does_nothing(env):
    client, db, speech, model, main = env
    db.voice_on = False
    for job in ("transcribe", "check", "followup"):
        assert post(client, db.issue(job), AUDIO, "audio/ogg").json() == {"status": "off"}
    assert speech.calls == [] and model.calls == [] and db.used == 12


def test_the_database_down_is_503(env):
    client, db, speech, model, main = env
    db.down = True
    response = post(client, db.issue("transcribe"), AUDIO, "audio/ogg")
    assert response.status_code == 503 and response.json() == {"status": "unavailable"}


# ── transcribe ──────────────────────────────────────────────────────────────────


def test_a_voice_is_recognised_with_the_question_as_the_hint_and_charges_nothing(env):
    client, db, speech, model, main = env
    response = post(client, db.issue("transcribe"), AUDIO, "audio/ogg; codecs=opus")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "text": ANSWER, "words": len(oral.words(ANSWER))}
    assert speech.calls == [{"bytes": len(AUDIO), "mime": "audio/ogg", "hint": QUESTION}]
    assert db.used == 12 and model.calls == []


def test_too_short_and_not_recognised_are_refused_without_charging(env):
    client, db, speech, model, main = env
    speech.answer = "Взаимоблокировка это когда ждут"
    assert post(client, db.issue("transcribe"), AUDIO, "audio/ogg").json() == {"status": "too_short", "words": 4}
    # A later voice of the same answer needs only to be recognised.
    assert post(client, db.issue("transcribe", parts=1), AUDIO, "audio/ogg").json()["status"] == "ok"
    speech.answer = ""
    assert post(client, db.issue("transcribe"), AUDIO, "audio/ogg").json() == {"status": "not_recognized"}
    speech.answer = "..."
    assert post(client, db.issue("transcribe"), AUDIO, "audio/ogg").json() == {"status": "not_recognized"}
    # Under half a kilobyte: a container without sound, not sent to recognition.
    calls = len(speech.calls)
    assert post(client, db.issue("transcribe"), b"OggS" + bytes(100), "audio/ogg").json() == {"status": "not_recognized"}
    assert len(speech.calls) == calls and db.used == 12


def test_recognition_failures_are_busy_or_failed(env):
    client, db, speech, model, main = env
    speech.answer = AIError.busy()
    assert post(client, db.issue("transcribe"), AUDIO, "audio/ogg").json() == {"status": "busy"}
    speech.answer = AIError(502, "stt_failed", stt.STT_FAILED_DETAIL)
    assert post(client, db.issue("transcribe"), AUDIO, "audio/ogg").json() == {"status": "failed"}
    assert db.used == 12


def test_the_audio_must_be_ogg_and_at_most_20_mb(env):
    client, db, speech, model, main = env
    assert post(client, db.issue("transcribe"), AUDIO, "audio/mpeg").status_code == 415
    assert post(client, db.issue("transcribe"), AUDIO).status_code == 415
    big = bytes(bot_bridge.MAX_AUDIO_BYTES + 1)
    assert post(client, db.issue("transcribe"), big, "audio/ogg").status_code == 413
    assert speech.calls == []


def test_the_ceiling_and_the_shared_stop_refuse_before_recognition(env):
    client, db, speech, model, main = env
    db.audio["user"] = 1795
    assert post(client, db.issue("transcribe", seconds=20), AUDIO, "audio/ogg").json() == {"status": "ceiling"}
    db.audio = {"user": 0, "all": 20155}
    assert post(client, db.issue("transcribe", seconds=20), AUDIO, "audio/ogg").json() == {"status": "stop"}
    assert post(client, db.issue("followup", seconds=20), AUDIO, "audio/ogg").json() == {"status": "stop"}
    assert speech.calls == [] and model.calls == [] and db.used == 12


# ── check ───────────────────────────────────────────────────────────────────────


def test_a_check_charges_once_and_returns_the_sites_check_and_protocol(env):
    client, db, speech, model, main = env
    ticket = db.issue("check")
    response = post(client, ticket)
    body = response.json()
    assert response.status_code == 200 and body["status"] == "ok"
    assert body["statuses"] == {"p1": "covered", "p2": "missing", "p3": "covered"}
    assert body["ask"] == {"point_id": "p2"}  # oral.choose_followup: the main point that was missed
    assert [p["status"] for p in body["protocol"]["points"]] == ["covered", "missing", "covered"]
    assert body["units"] == {"charged": 4, "left": 84}
    assert db.used == 16 and not db.tickets[ticket]["refunded"]
    assert sorted(call["kind"] for call in model.calls) == ["check", "evaluate"]
    assert speech.calls == []


def test_the_check_runs_with_the_routes_own_prompts_and_parameters(env):
    """The quick check is /api/oral/check's call and the protocol is oral_api.judge_answer: the same prompts, inputs and
    model parameters (the route has no callable of its own outside the request; this pins the repeat)."""
    client, db, speech, model, main = env
    post(client, db.issue("check"))
    bridge = {call["kind"]: call for call in model.calls}
    model.calls.clear()
    points = [{key: p[key] for key in ("id", "title", "essential")} for p in POINTS]
    import asyncio
    statuses = asyncio.run(bot_bridge.quick_check(QUESTION, points, ANSWER))
    assert statuses == {"p1": "covered", "p2": "missing", "p3": "covered"}
    direct = model.calls[-1]
    assert bridge["check"]["system"] == oral.build_check_prompt(None) == direct["system"]
    assert bridge["check"]["text"] == oral.build_check_input(QUESTION, points, ANSWER)
    assert bridge["check"]["kwargs"] == {
        "timeout": oral_api.check_timeout_seconds(), "gemini_timeout": oral_api.check_gemini_seconds(), "thinking": "off",
        "temperature": 0, "max_tokens": oral_api.CHECK_MAX_TOKENS, "json_mode": True, "meta": bridge["check"]["kwargs"]["meta"]}
    assert bridge["evaluate"]["system"] == oral.build_evaluate_prompt()
    assert bridge["evaluate"]["text"] == oral.build_evaluate_input(QUESTION, [
        {"id": p["id"], "title": p["title"], "essential": p["essential"], "source_quote": p["source_quote"]} for p in POINTS], ANSWER)
    assert bridge["evaluate"]["kwargs"]["temperature"] == 0.2 and bridge["evaluate"]["kwargs"]["max_tokens"] == oral_api.EVALUATE_MAX_TOKENS


def test_the_routes_check_parameters_are_the_bridges(monkeypatch):
    """oral_api.oral_check's model call, read from its source: a change there without bot_bridge.quick_check fails."""
    import inspect
    route = inspect.getsource(oral_api.oral_check)
    bridge = inspect.getsource(bot_bridge.quick_check)
    for argument in ("budget=check_timeout_seconds()", "gemini_timeout=check_gemini_seconds()", 'thinking="off"',
                     "groq_model=ai_base.groq_fast_model()", "temperature=0", "max_tokens=CHECK_MAX_TOKENS", "json_mode=True"):
        assert argument in route, argument
        assert argument.replace("check_timeout_seconds", "oral_api.check_timeout_seconds").replace(
            "check_gemini_seconds", "oral_api.check_gemini_seconds").replace("CHECK_MAX_TOKENS", "oral_api.CHECK_MAX_TOKENS") in bridge, argument


def test_a_model_failure_gives_the_units_back_once(env):
    client, db, speech, model, main = env
    model.protocol = AIError.timeout()
    ticket = db.issue("check")
    assert post(client, ticket).json() == {"status": "failed"}
    assert db.used == 12 and db.tickets[ticket]["refunded"]
    model.protocol = FakeModel().protocol
    model.check = AIError.busy()
    ticket = db.issue("check")
    assert post(client, ticket).json() == {"status": "busy"}
    assert db.used == 12
    # An unusable answer of the model is a failure too.
    model.check = {"nothing": True}
    assert post(client, db.issue("check")).json() == {"status": "failed"}
    assert db.used == 12


def test_an_answer_that_says_dont_know_is_not_checked_and_not_charged(env):
    client, db, speech, model, main = env
    ticket = db.issue("check", transcript="Ну, не знаю")
    assert post(client, ticket).json() == {"status": "dont_know"}
    assert model.calls == [] and db.used == 12


def test_the_ai_limit_at_the_take_charges_nothing(env):
    client, db, speech, model, main = env
    db.used = 98
    assert post(client, db.issue("check")).json() == {"status": "limit"}
    assert model.calls == [] and db.used == 98


def test_a_check_repeated_after_a_lost_answer_is_charged_once(env):
    client, db, speech, model, main = env
    post(client, db.issue("check"))
    assert db.used == 16
    assert post(client, db.issue("check", charged=True)).json()["status"] == "ok"
    assert db.used == 16


# ── followup ────────────────────────────────────────────────────────────────────


def test_the_answer_to_the_examiners_question_is_one_point_checked_with_what_must_sound(env):
    client, db, speech, model, main = env
    speech.answer = "Взаимное исключение, удержание и ожидание, нет вытеснения и круговое ожидание"
    response = post(client, db.issue("followup", seconds=6), AUDIO, "audio/ogg")
    assert response.json() == {"status": "ok", "text": speech.answer, "followup_status": "covered", "judged_by": "check"}
    assert speech.calls[0]["hint"] == FOLLOWUP_Q
    call = model.calls[-1]
    assert call["kind"] == "only" and call["system"] == oral.build_check_prompt("p2")
    assert "ВОПРОС ЭКЗАМЕНАТОРА: " + FOLLOWUP_Q in call["text"] and "ДОЛЖНО ПРОЗВУЧАТЬ: Четыре условия Коффмана." in call["text"]
    assert db.used == 12


def test_dont_know_aloud_is_missing_without_the_model_and_silence_is_not_recognised(env):
    client, db, speech, model, main = env
    speech.answer = "Не знаю"
    assert post(client, db.issue("followup"), AUDIO, "audio/ogg").json()["followup_status"] == "missing"
    assert model.calls == []
    speech.answer = ""
    assert post(client, db.issue("followup"), AUDIO, "audio/ogg").json() == {"status": "not_recognized"}


# ── Logs and the price ──────────────────────────────────────────────────────────


def test_logs_carry_no_audio_text_question_ticket_or_id(env, capsys):
    client, db, speech, model, main = env
    tickets = [db.issue("transcribe"), db.issue("check"), db.issue("followup"), db.issue("check", expired=True)]
    for ticket in tickets:
        post(client, ticket, AUDIO, "audio/ogg")
    model.protocol = AIError.failed()
    post(client, db.issue("check"))
    out = capsys.readouterr()
    logged = out.out + out.err
    lines = [line for line in logged.splitlines() if line.startswith("Bot voice:")]
    assert len(lines) == 5
    for line in lines:
        assert re.match(r"^Bot voice: (transcribe|check|followup|-) [a-z_]+ \d+ ms$", line), line
    for secret in [*tickets, ANSWER[:20], QUESTION[:20], FOLLOWUP_Q[:20], "OggS"]:
        assert secret not in logged


def test_the_price_is_the_sites_answer_cost():
    migration = (ROOT / "supabase" / "migrations" / "20261010120006_telegram_bot_voice.sql").read_text(encoding="utf-8")
    assert AI_COSTS["answer"] == 4
    assert "select v.u, v.d, pg_catalog.floor(v.d * v.s)::integer, 4 from v" in migration
