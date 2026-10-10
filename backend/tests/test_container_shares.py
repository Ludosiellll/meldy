"""Мост устных копий экзамена-контейнера (container_shares.py): POST /api/containers/{id}/oral-sync.

Участник группы получает копии устных предметов через неизменённый устный путь exam_shares.py: bound (копия уже
есть, например со старого /join), copied (bundle → снимок → план копии → join → привязка), not_ready (место не
занято), closed (MS002 / MS003 и предметы, которых container_oral_codes не назвала), failed (в журнале без токена
и кода ссылки). Повторный вызов ничего не делает, два вызова сразу дают одну копию, без входа — 401, не участник —
404, лимит — 6 в минуту на пользователя, exam_shares.py только читается.

Supabase — PostgREST в памяти из test_exam_shares (функции exam_share_* на Python, RLS по токену) и функции
container_oral_codes / container_bind_copy с логикой миграции 20261009093500_containers.sql (SQL-поведение —
supabase/tests/local/containers_behaviour.sql, раздел 6). Модель и единицы лимита не нужны никому.
"""
import asyncio
import contextlib
import hashlib
import inspect
import json
import re
import sys
import uuid
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import container_shares  # noqa: E402
import exam_shares  # noqa: E402
import quota  # noqa: E402
import supabase_rest  # noqa: E402
import telemetry_api  # noqa: E402
import test_oral_api  # noqa: E402
from agents.base import BaseAgent  # noqa: E402
from ratelimit import RATE_LIMIT_DETAIL, user_or_ip_key  # noqa: E402
from test_exam_shares import USERS, ShareSupabase, as_user, assert_refusal, author_exam, make_link  # noqa: E402
from test_exam_shares import join as join_old_link  # noqa: E402
from test_oral import ECON  # noqa: E402
from test_oral_api import ANON, FOREIGN_TEXT, URL  # noqa: E402

NOW = "2026-10-07T10:00:00+00:00"  # часы PostgREST в памяти (ShareSupabase._dead)
ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"
SYNC_LIMIT = "6 per 1 minute"


def oral_code(salt, exam_id):
    """meldy_private.oral_code: 60 бит sha256('meldy-oral:' || соль || ':' || id экзамена) алфавитом ссылок."""
    bits = int(hashlib.sha256(f"meldy-oral:{salt}:{exam_id}".encode()).hexdigest()[:15], 16)
    return "".join(ALPHABET[(bits >> (55 - 5 * i)) & 31] for i in range(12))


def code_hash(code):
    return hashlib.sha256(code.encode()).hexdigest()


def refusal(code, status=400):
    """Отказ функции базы как его отдаёт PostgREST: (HTTP-статус, тело). Ответ собирается заново на каждый вызов."""
    return status, {"code": code, "message": FOREIGN_TEXT}


def rpc_error(code, status=400):
    return httpx.Response(status, json={"code": code, "message": FOREIGN_TEXT})


class BridgeSupabase(ShareSupabase):
    """PostgREST в памяти: ещё таблицы экзамена-контейнера, его функции устного моста, чтение своих строк участника,
    отказы функций по имени (refusals) и действия «сразу после вызова» (after) — например, автор закрыл ссылку."""

    TABLES = ShareSupabase.TABLES + (
        "containers", "container_subjects", "container_links", "container_members", "container_member_exams",
    )

    def __init__(self):
        super().__init__()
        self.refusals: dict[str, tuple[int, object]] = {}
        self.after: dict[str, object] = {}

    def handler(self, request):
        if "/rpc/" in request.url.path:
            name = request.url.path.rsplit("/", 1)[-1]
            if name in self.refusals:
                self.requests.append(request)
                self.rpc_calls.append((name, json.loads(request.content or b"{}")))
                status, body = self.refusals[name]
                return httpx.Response(status, json=body)
            response = super().handler(request)
            hook = self.after.pop(name, None)
            if hook is not None:
                hook()
            return response
        return super().handler(request)

    # — данные —

    def role(self, user, container_id):
        container = next((c for c in self.tables["containers"] if c["id"] == container_id), None)
        if container is None or user is None:
            return None
        if container["owner_id"] == user:
            return "owner"
        seat = next((m for m in self.tables["container_members"]
                     if m["container_id"] == container_id and m["user_id"] == user), None)
        if seat is not None and seat["left_at"] is None and seat["removed_at"] is None:
            return "member"
        return None

    def derived_share(self, link, exam_id):
        digest = code_hash(oral_code(link["oral_salt"], exam_id))
        return next((s for s in self.tables["exam_shares"] if s["code_hash"] == digest), None)

    def revoke_link(self, link):
        """container_link_revoke: ни новых участников, ни новых устных копий по ссылке."""
        link["revoked_at"] = "2026-10-07T09:30:00+00:00"
        for share in self.tables["exam_shares"]:
            if share["id"] in link["oral_share_ids"]:
                share["revoked_at"] = share["revoked_at"] or link["revoked_at"]

    def own_copy(self, user, exam_id):
        """Копия участника этого экзамена по любой его ссылке (existing_exam_id)."""
        shares = {s["id"] for s in self.tables["exam_shares"] if s["exam_id"] == exam_id}
        for seat in reversed(self.tables["exam_share_members"]):
            copy_id = seat.get("member_exam_id")
            if seat["share_id"] in shares and seat["user_id"] == user and copy_id and any(
                e["id"] == copy_id and e["user_id"] == user for e in self.tables["exams"]
            ):
                return copy_id
        return None

    # — функции миграции 20261009093500_containers.sql —

    def _ensure_oral_shares(self, link):
        if link["consent"] is None:
            return
        for subject in self.tables["container_subjects"]:
            exam_id = subject["exam_id"]
            if subject["container_id"] != link["container_id"] or exam_id is None:
                continue
            if not any(e["id"] == exam_id and e["user_id"] == link["owner_id"] for e in self.tables["exams"]):
                continue
            if any(m.get("member_exam_id") == exam_id for m in self.tables["exam_share_members"]):
                continue  # копию дальше не раздают
            share = self.derived_share(link, exam_id)
            if share is None:
                share = {"id": str(uuid.uuid4()), "exam_id": exam_id, "owner_id": link["owner_id"], "user_id": link["owner_id"],
                         "code_hash": code_hash(oral_code(link["oral_salt"], exam_id)), "consent": link["consent"],
                         "created_at": NOW, "max_members": link["max_members"], "members": 0,
                         "expires_at": link["expires_at"] if (link["expires_at"] or "") > NOW else None,
                         "revoked_at": link["revoked_at"]}
                self.tables["exam_shares"].append(share)
            if share["id"] not in link["oral_share_ids"]:
                link["oral_share_ids"].append(share["id"])

    def _rpc_container_oral_codes(self, user, args):
        if user is None:
            return rpc_error("28000", 403)
        container_id = args.get("p_container_id")
        if self.role(user, container_id) != "member":
            return rpc_error("P0002", 500)  # PostgREST: класс P0 — HTTP 500
        seat = next(m for m in self.tables["container_members"] if m["container_id"] == container_id and m["user_id"] == user)
        links = [l for l in self.tables["container_links"]
                 if l["container_id"] == container_id and l["consent"] is not None and l["revoked_at"] is None
                 and (l["expires_at"] is None or l["expires_at"] > NOW)]
        links.sort(key=lambda l: (l["id"] == seat["link_id"], l["created_at"]), reverse=True)
        if not links:
            return httpx.Response(200, json={"status": "closed", "subjects": []})
        link = links[0]
        self._ensure_oral_shares(link)
        subjects = []
        for subject in sorted(self.tables["container_subjects"], key=lambda s: (s["position"], s["created_at"])):
            if subject["container_id"] != container_id or subject["exam_id"] is None:
                continue
            if any(b["subject_id"] == subject["id"] and b["user_id"] == user for b in self.tables["container_member_exams"]):
                continue
            share = self.derived_share(link, subject["exam_id"])
            if share is None or share["revoked_at"] is not None:
                continue
            subjects.append({"subject_id": subject["id"], "title": subject["title"],
                             "code": oral_code(link["oral_salt"], subject["exam_id"]),
                             "existing_exam_id": self.own_copy(user, subject["exam_id"])})
        return httpx.Response(200, json={"status": "open", "subjects": subjects})

    def _rpc_container_bind_copy(self, user, args):
        if user is None:
            return rpc_error("28000", 403)
        subject = next((s for s in self.tables["container_subjects"] if s["id"] == args.get("p_subject_id")), None)
        if subject is None or subject["exam_id"] is None or self.role(user, subject["container_id"]) != "member":
            return rpc_error("P0002", 500)
        exam_id = args.get("p_exam_id")
        # Только копия этого экзамена по его ссылке (место в exam_share_members), и экзамен — свой.
        proven = any(
            m["user_id"] == user and m.get("member_exam_id") == exam_id
            and any(s["id"] == m["share_id"] and s["exam_id"] == subject["exam_id"] for s in self.tables["exam_shares"])
            and any(e["id"] == exam_id and e["user_id"] == user for e in self.tables["exams"])
            for m in self.tables["exam_share_members"]
        )
        if not proven:
            return rpc_error("42501", 403)
        rows = self.tables["container_member_exams"]
        bound = next((b for b in rows if b["subject_id"] == subject["id"] and b["user_id"] == user), None)
        if bound is None:
            bound = {"container_id": subject["container_id"], "subject_id": subject["id"], "user_id": user, "exam_id": exam_id}
            rows.append(bound)
        return httpx.Response(200, json={"subject_id": subject["id"], "exam_id": bound["exam_id"]})

    # — чтение участника: предметы экзамена (свой или вступил) и свои привязки —

    def _get(self, request, table, user):
        if table not in ("container_subjects", "container_member_exams"):
            return super()._get(request, table, user)
        self.requests.append(request)
        if request.headers.get("apikey") != ANON or user is None:
            return httpx.Response(401, json={"code": "PGRST301", "message": "JWT expired"})
        failure = self.fail.get(("GET", table))
        if failure:
            return httpx.Response(failure, json={"code": "XX000", "message": FOREIGN_TEXT})
        params = list(request.url.params.multi_items())
        if table == "container_subjects":
            rows = [s for s in self.tables[table] if s["owner_id"] == user or self.role(user, s["container_id"]) == "member"]
        else:
            rows = [b for b in self.tables[table] if b["user_id"] == user]
        for key, raw in params:
            if key in ("select", "order", "limit"):
                continue
            if raw == "not.is.null":
                rows = [row for row in rows if row.get(key) is not None]
            elif raw.startswith("eq."):
                rows = [row for row in rows if row.get(key) is not None and str(row[key]) == raw[3:]]
            else:
                raise AssertionError(f"unsupported filter {key}={raw}")
        order = dict(params).get("order")
        if order:
            assert order == "position.asc,created_at.asc"
            rows = sorted(rows, key=lambda row: (row["position"], row["created_at"]))
        return httpx.Response(200, json=[self._project(row, params) for row in rows])


@pytest.fixture
def bridge(monkeypatch):
    import main

    for token, user in USERS.items():
        monkeypatch.setitem(test_oral_api.TOKENS, token, user)

    async def fake_user(request):
        token = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
        if token not in USERS:
            raise HTTPException(status_code=401, detail="Требуется войти в аккаунт")
        return {"id": USERS[token]}

    monkeypatch.setattr(main, "require_authenticated_user", fake_user)
    monkeypatch.setattr(main.limiter, "enabled", False)
    monkeypatch.setenv("SUPABASE_URL", URL)
    monkeypatch.setenv("SUPABASE_KEY", ANON)
    fake = BridgeSupabase()
    monkeypatch.setattr(supabase_rest, "_transport", httpx.MockTransport(fake.handler))

    async def no_model(*args, **kwargs):
        raise AssertionError("the oral bridge never calls a model")

    async def no_reserve(*args, **kwargs):
        raise AssertionError("quota.reserve must not be called")

    monkeypatch.setattr(BaseAgent, "run", no_model)
    monkeypatch.setattr(quota, "reserve", no_reserve)
    client = TestClient(main.app, headers={"Authorization": "Bearer token-b"})
    client.fake = fake
    yield client
    assert container_shares._turns == {}  # очередь не копит ключи


def oral_container(bridge, exams, *, member="user-b", consent=True, test_subject=False):
    """Экзамен автора (user-a): устные предметы — его экзамены по порядку, ссылка группы и участник."""
    fake = bridge.fake
    container_id = str(uuid.uuid4())
    fake.tables["containers"].append({"id": container_id, "owner_id": "user-a", "user_id": "user-a", "title": "Зимняя сессия"})
    subjects = []
    for position, exam_id in enumerate([None, *exams] if test_subject else exams, start=1):
        subject = {"id": str(uuid.uuid4()), "container_id": container_id, "owner_id": "user-a", "position": position,
                   "title": f"Предмет {position}", "exam_id": exam_id, "created_at": f"2026-10-07T08:00:{position:02d}+00:00"}
        fake.tables["container_subjects"].append(subject)
        if exam_id is not None:
            subjects.append(subject["id"])
    link = {"id": str(uuid.uuid4()), "container_id": container_id, "owner_id": "user-a", "oral_salt": uuid.uuid4().hex,
            "consent": exam_shares.CONSENT_TEXT if consent else None, "max_members": 60, "members": 0,
            "expires_at": "2027-01-05T09:00:00+00:00", "revoked_at": None, "created_at": "2026-10-07T09:00:00+00:00",
            "oral_share_ids": []}
    fake.tables["container_links"].append(link)
    if member:
        fake.tables["container_members"].append({"container_id": container_id, "user_id": member, "link_id": link["id"],
                                                 "left_at": None, "removed_at": None})
        link["members"] += 1
    return {"id": container_id, "subjects": subjects, "link": link}


def sync(bridge, container_id, token="token-b"):
    return bridge.post(f"/api/containers/{container_id}/oral-sync", headers=as_user(token))


def calls_since(fake, start):
    return [name for name, _ in fake.rpc_calls[start:]]


def args_of(fake, name):
    return [args for called, args in fake.rpc_calls if called == name]


def copies_of(fake, user="user-b"):
    return [e["id"] for e in fake.own("exams", user)]


def bindings(fake, user="user-b"):
    return [(b["subject_id"], b["exam_id"]) for b in fake.tables["container_member_exams"] if b["user_id"] == user]


def seats_on(fake, share):
    return [m for m in fake.tables["exam_share_members"] if m["share_id"] == share["id"]]


# ── Маршрут ─────────────────────────────────────────────────────────────────────


def test_the_route_is_mounted_for_signed_in_users_and_limited_per_user():
    import main

    assert {(route.path, frozenset(route.methods)) for route in container_shares.router.routes} == {
        ("/api/containers/{container_id}/oral-sync", frozenset({"POST"})),
    }
    assert main.container_shares_router is container_shares.router
    assert not any(path.startswith("/api/containers") for path in main.PUBLIC_API_PATHS)
    limits = {name: [(str(limit.limit), limit.key_func) for limit in values]
              for name, values in main.limiter._route_limits.items() if name.startswith("container_shares.")}
    assert limits == {"container_shares.oral_sync": [(SYNC_LIMIT, user_or_ip_key)]}
    source = inspect.getsource(container_shares)
    assert '@limiter.limit("6/minute", key_func=user_or_ip_key)\nasync def oral_sync' in source


# ── copied ──────────────────────────────────────────────────────────────────────


def test_a_member_gets_a_copy_through_the_unchanged_oral_path(bridge, monkeypatch):
    exam = author_exam(bridge.fake)
    c = oral_container(bridge, [exam["exam"]], test_subject=True)
    seen = {"bundles": [], "snapshots": [], "plans": []}
    real_snapshot, real_plan = container_shares.snapshot_from_bundle, container_shares.plan_copy

    def spy_snapshot(raw):
        snapshot = real_snapshot(raw)
        seen["bundles"].append(raw)
        seen["snapshots"].append(snapshot)
        return snapshot

    def spy_plan(snapshot, **kwargs):
        assert kwargs == {}  # как у входа по /join: новые id и часы — по умолчанию
        plan = real_plan(snapshot)
        seen["plans"].append((snapshot, plan))
        return plan

    monkeypatch.setattr(container_shares, "snapshot_from_bundle", spy_snapshot)
    monkeypatch.setattr(container_shares, "plan_copy", spy_plan)

    response = sync(bridge, c["id"])
    assert response.status_code == 200, response.text
    copy_id = copies_of(bridge.fake)[0]
    [subject] = c["subjects"]
    assert response.json() == {"container_id": c["id"], "oral": [{"subject_id": subject, "status": "copied", "exam_id": copy_id}]}
    assert copies_of(bridge.fake) == [copy_id] and copy_id != exam["exam"]
    assert bindings(bridge.fake) == [(subject, copy_id)]

    # Устный путь — тот же, что у /join, с кодом производной ссылки из container_oral_codes.
    code = oral_code(c["link"]["oral_salt"], exam["exam"])
    assert calls_since(bridge.fake, 0) == ["container_oral_codes", "exam_share_bundle", "exam_share_join", "container_bind_copy"]
    assert args_of(bridge.fake, "container_oral_codes") == [{"p_container_id": c["id"]}]
    assert args_of(bridge.fake, "exam_share_bundle") == [{"p_code": code}]
    [(snapshot, plan)] = seen["plans"]
    assert seen["snapshots"] == [snapshot] and seen["bundles"][0]["exam"]["title"] == "Макроэкономика"
    assert len(snapshot.questions) == 4 and snapshot.links == exam["links"]
    assert args_of(bridge.fake, "exam_share_join") == [{"p_code": code, "p_copy": json.loads(json.dumps(plan.payload))}]
    assert plan.exam_id == copy_id
    assert args_of(bridge.fake, "container_bind_copy") == [{"p_subject_id": subject, "p_exam_id": copy_id}]

    # Копия — как у входа по ссылке: лекции, вопросы и пункты ответа участника; место по производной ссылке.
    share = bridge.fake.derived_share(c["link"], exam["exam"])
    assert share["members"] == 1 and [m["member_exam_id"] for m in seats_on(bridge.fake, share)] == [copy_id]
    assert len(bridge.fake.own("materials", "user-b")) == 2 and len(bridge.fake.own("exam_questions", "user-b")) == 4
    assert len(bridge.fake.own("oral_rubrics", "user-b")) == 3
    assert code not in response.text and "token-b" not in response.text


def test_a_second_call_does_nothing_new(bridge):
    exam = author_exam(bridge.fake)
    c = oral_container(bridge, [exam["exam"]])
    first = sync(bridge, c["id"]).json()
    start = len(bridge.fake.rpc_calls)
    again = sync(bridge, c["id"])
    assert again.status_code == 200 and again.json() == {"container_id": c["id"], "oral": []}
    assert calls_since(bridge.fake, start) == ["container_oral_codes"]
    assert copies_of(bridge.fake) == [first["oral"][0]["exam_id"]]
    assert len(bindings(bridge.fake)) == 1
    assert bridge.fake.derived_share(c["link"], exam["exam"])["members"] == 1


# ── bound ───────────────────────────────────────────────────────────────────────


def test_a_copy_from_the_old_join_link_is_bound_and_not_made_again(bridge):
    exam = author_exam(bridge.fake)
    make_link(bridge, exam["exam"])
    old_copy = join_old_link(bridge).json()["exam_id"]
    c = oral_container(bridge, [exam["exam"]])
    start = len(bridge.fake.rpc_calls)

    response = sync(bridge, c["id"])
    assert response.status_code == 200, response.text
    [subject] = c["subjects"]
    assert response.json()["oral"] == [{"subject_id": subject, "status": "bound", "exam_id": old_copy}]
    assert calls_since(bridge.fake, start) == ["container_oral_codes", "container_bind_copy"]
    assert args_of(bridge.fake, "container_bind_copy") == [{"p_subject_id": subject, "p_exam_id": old_copy}]
    assert copies_of(bridge.fake) == [old_copy] and bindings(bridge.fake) == [(subject, old_copy)]
    assert seats_on(bridge.fake, bridge.fake.derived_share(c["link"], exam["exam"])) == []  # места по ссылке экзамена не занято


def test_a_copy_made_through_the_derived_link_meanwhile_is_bound_not_made_again(bridge):
    """Между container_oral_codes и exam_share_bundle копию по этой же производной ссылке успел сделать другой вызов:
    bundle отдаёт её id (как при повторном входе по /join) — та же копия привязывается, второй не делается."""
    exam = author_exam(bridge.fake)
    c = oral_container(bridge, [exam["exam"]])
    code = oral_code(c["link"]["oral_salt"], exam["exam"])
    made = {}

    def copied_meanwhile():
        raw = bridge.fake._rpc_exam_share_bundle("user-b", {"p_code": code}).json()
        plan = exam_shares.plan_copy(exam_shares.snapshot_from_bundle(raw))
        payload = json.loads(json.dumps(plan.payload))
        made["copy"] = bridge.fake._rpc_exam_share_join("user-b", {"p_code": code, "p_copy": payload}).json()["exam_id"]

    bridge.fake.after["container_oral_codes"] = copied_meanwhile
    response = sync(bridge, c["id"])
    assert response.status_code == 200, response.text
    [subject] = c["subjects"]
    assert response.json()["oral"] == [{"subject_id": subject, "status": "bound", "exam_id": made["copy"]}]
    assert calls_since(bridge.fake, 0) == ["container_oral_codes", "exam_share_bundle", "container_bind_copy"]
    assert copies_of(bridge.fake) == [made["copy"]] and bindings(bridge.fake) == [(subject, made["copy"])]


def test_the_answer_names_the_copy_the_subject_is_bound_to(bridge):
    """container_bind_copy не перепривязывает предмет (on conflict do nothing) и отдаёт привязанную копию: её и
    называет ответ, даже если предмет успели привязать между вызовами (например, другой процесс сервера)."""
    exam = author_exam(bridge.fake)
    c = oral_container(bridge, [exam["exam"]])
    [subject] = c["subjects"]
    earlier = bridge.fake.exam(user="user-b", title="Макроэкономика")

    def bound_meanwhile():
        bridge.fake.tables["container_member_exams"].append(
            {"container_id": c["id"], "subject_id": subject, "user_id": "user-b", "exam_id": earlier})

    bridge.fake.after["exam_share_join"] = bound_meanwhile
    response = sync(bridge, c["id"])
    assert response.status_code == 200, response.text
    assert response.json()["oral"] == [{"subject_id": subject, "status": "copied", "exam_id": earlier}]
    assert bindings(bridge.fake) == [(subject, earlier)]


def test_a_copy_that_was_not_bound_is_bound_on_the_next_call(bridge):
    exam = author_exam(bridge.fake)
    c = oral_container(bridge, [exam["exam"]])
    bridge.fake.refusals["container_bind_copy"] = refusal("XX000", 503)
    first = sync(bridge, c["id"]).json()
    [subject] = c["subjects"]
    assert first["oral"] == [{"subject_id": subject, "status": "failed"}]
    [copy_id] = copies_of(bridge.fake)
    assert bindings(bridge.fake) == []

    del bridge.fake.refusals["container_bind_copy"]
    again = sync(bridge, c["id"]).json()
    assert again["oral"] == [{"subject_id": subject, "status": "bound", "exam_id": copy_id}]
    assert copies_of(bridge.fake) == [copy_id] and bindings(bridge.fake) == [(subject, copy_id)]


# ── not_ready ───────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("state", ["needs_sheet", "needs_mapping", "mapping_running"])
def test_an_oral_part_that_is_not_ready_takes_no_seat(bridge, state):
    exam = author_exam(bridge.fake, with_rubrics=state != "needs_sheet", unmapped=state == "needs_mapping")
    if state == "mapping_running":
        bridge.fake.row("exams", exam["exam"]).update({"mapping_state": "running", "mapping_started_at": "2999-01-01T00:00:00+00:00"})
    c = oral_container(bridge, [exam["exam"]])
    response = sync(bridge, c["id"])
    assert response.status_code == 200, response.text
    assert response.json()["oral"] == [{"subject_id": c["subjects"][0], "status": "not_ready"}]
    assert "exam_share_join" not in calls_since(bridge.fake, 0)
    share = bridge.fake.derived_share(c["link"], exam["exam"])
    assert share["members"] == 0 and seats_on(bridge.fake, share) == []
    assert copies_of(bridge.fake) == [] and bridge.fake.own("materials", "user-b") == [] and bindings(bridge.fake) == []


def test_the_copy_comes_once_the_author_part_is_ready(bridge):
    exam = author_exam(bridge.fake)
    bridge.fake.row("exams", exam["exam"]).update({"mapping_state": "running", "mapping_started_at": "2999-01-01T00:00:00+00:00"})
    c = oral_container(bridge, [exam["exam"]])
    assert sync(bridge, c["id"]).json()["oral"][0]["status"] == "not_ready"
    bridge.fake.row("exams", exam["exam"]).update({"mapping_state": "done", "mapping_started_at": None})
    again = sync(bridge, c["id"]).json()["oral"]
    assert [row["status"] for row in again] == ["copied"] and again[0]["exam_id"] == copies_of(bridge.fake)[0]


# ── closed ──────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "after, change",
    [
        ("container_oral_codes", {"revoked_at": "2026-10-07T09:45:00+00:00"}),  # bundle: MS002
        ("container_oral_codes", {"expires_at": "2026-10-07T09:45:00+00:00"}),  # bundle: MS003
        ("exam_share_bundle", {"revoked_at": "2026-10-07T09:45:00+00:00"}),  # join: MS002
    ],
)
def test_a_derived_link_closed_meanwhile_is_closed(bridge, after, change):
    exam = author_exam(bridge.fake)
    c = oral_container(bridge, [exam["exam"]])
    bridge.fake.after[after] = lambda: bridge.fake.derived_share(c["link"], exam["exam"]).update(change)
    response = sync(bridge, c["id"])
    assert response.status_code == 200, response.text
    assert response.json()["oral"] == [{"subject_id": c["subjects"][0], "status": "closed"}]
    assert copies_of(bridge.fake) == [] and bindings(bridge.fake) == []
    assert seats_on(bridge.fake, bridge.fake.derived_share(c["link"], exam["exam"])) == []


def test_an_oral_subject_whose_derived_link_the_author_closed_is_closed(bridge):
    exams = [author_exam(bridge.fake)["exam"] for _ in range(3)]
    for exam_id in exams[1:]:
        bridge.fake.row("exams", exam_id).update({"mapping_state": "running", "mapping_started_at": "2999-01-01T00:00:00+00:00"})
    c = oral_container(bridge, exams, test_subject=True)
    first, second, third = c["subjects"]
    assert [row["status"] for row in sync(bridge, c["id"]).json()["oral"]] == ["copied", "not_ready", "not_ready"]

    # Второй и третий готовы; производную ссылку второго автор закрыл в «Пригласить группу» своего устного экзамена.
    for exam_id in exams[1:]:
        bridge.fake.row("exams", exam_id).update({"mapping_state": "done", "mapping_started_at": None})
    second_share = bridge.fake.derived_share(c["link"], exams[1])
    revoked = bridge.post(f"/api/exam-shares/{second_share['id']}/revoke", headers=as_user("token-a"))
    assert revoked.status_code == 200, revoked.text
    start = len(bridge.fake.rpc_calls)

    response = sync(bridge, c["id"])
    assert response.status_code == 200, response.text
    oral = response.json()["oral"]
    # Первый привязан раньше — его нет; второго container_oral_codes не назвала — он закрыт, а не «появится позже»;
    # предметы — в порядке экзамена.
    assert [(row["subject_id"], row["status"]) for row in oral] == [(second, "closed"), (third, "copied")]
    assert "exam_id" not in oral[0] and len(bindings(bridge.fake)) == 2
    assert [args["p_code"] for args in args_of(bridge.fake, "exam_share_bundle")][-1] == oral_code(c["link"]["oral_salt"], exams[2])
    assert calls_since(bridge.fake, start) == ["container_oral_codes", "exam_share_bundle", "exam_share_join", "container_bind_copy"]
    assert seats_on(bridge.fake, second_share) == [] and len(copies_of(bridge.fake)) == 2


@pytest.mark.parametrize("why", ["link_revoked", "no_consent"])
def test_without_an_open_link_every_oral_subject_without_a_copy_is_closed(bridge, why):
    exams = [author_exam(bridge.fake)["exam"] for _ in range(2)]
    c = oral_container(bridge, exams, consent=why != "no_consent", test_subject=True)
    if why == "link_revoked":  # ссылка экзамена закрыта, её производные ссылки — тоже
        bridge.fake._ensure_oral_shares(c["link"])
        bridge.fake.revoke_link(c["link"])
    response = sync(bridge, c["id"])
    assert response.status_code == 200, response.text
    assert response.json() == {"container_id": c["id"],
                               "oral": [{"subject_id": sid, "status": "closed"} for sid in c["subjects"]]}
    assert calls_since(bridge.fake, 0) == ["container_oral_codes"]
    assert copies_of(bridge.fake) == []


# ── failed ──────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "rpc, answer, logged",
    [
        ("exam_share_bundle", refusal("MS004"), "bundle failed (400 MS004)"),  # мест по производной ссылке нет
        ("exam_share_bundle", refusal("MS001"), "bundle failed (400 MS001)"),
        ("exam_share_bundle", refusal("XX000", 503), "bundle failed (503 XX000)"),
        ("exam_share_join", refusal("MS006"), "join failed (400 MS006)"),
        ("container_bind_copy", refusal("42501", 403), "bind failed (403 42501)"),
        ("container_bind_copy", refusal("P0002", 500), "bind failed (500 P0002)"),  # участника убрали между вызовами
    ],
)
def test_anything_else_fails_one_subject_and_is_logged_without_secrets(bridge, capsys, rpc, answer, logged):
    exam = author_exam(bridge.fake)
    c = oral_container(bridge, [exam["exam"]])
    bridge.fake.refusals[rpc] = answer
    response = sync(bridge, c["id"])
    assert response.status_code == 200, response.text
    [subject] = c["subjects"]
    assert response.json() == {"container_id": c["id"], "oral": [{"subject_id": subject, "status": "failed"}]}
    assert bindings(bridge.fake) == []
    log = capsys.readouterr().out
    assert f"Container oral sync: {logged}" in log
    code = oral_code(c["link"]["oral_salt"], exam["exam"])
    for secret in (code, "token-b", ANON, FOREIGN_TEXT, ECON[:40]):
        assert secret not in log and secret not in response.text
    for user_data in (exam["exam"], c["id"], subject, "Макроэкономика"):
        assert user_data not in log


def test_a_refused_copy_and_a_bug_cost_one_subject_and_the_bug_is_reported(bridge, monkeypatch, capsys):
    mismatched, broken, kept = (author_exam(bridge.fake) for _ in range(3))
    make_link(bridge, kept["exam"])
    old_copy = join_old_link(bridge).json()["exam_id"]
    c = oral_container(bridge, [mismatched["exam"], broken["exam"], kept["exam"]])
    real_plan = container_shares.plan_copy

    def plan(snapshot, **kwargs):
        if snapshot.links == mismatched["links"]:
            raise exam_shares.ShareError(409, "copy_mismatch", exam_shares.COPY_MISMATCH_DETAIL)
        if snapshot.links == broken["links"]:
            raise KeyError("a bug with Макроэкономика in it")
        return real_plan(snapshot, **kwargs)

    reports = []
    monkeypatch.setattr(container_shares, "plan_copy", plan)
    monkeypatch.setattr(telemetry_api, "report_server_error", lambda *args, **kwargs: reports.append(args))
    start = len(bridge.fake.rpc_calls)
    response = sync(bridge, c["id"])
    assert response.status_code == 200, response.text
    assert [row["status"] for row in response.json()["oral"]] == ["failed", "failed", "bound"]
    assert response.json()["oral"][2]["exam_id"] == old_copy
    assert calls_since(bridge.fake, start) == ["container_oral_codes", "exam_share_bundle", "exam_share_bundle",
                                              "container_bind_copy"]
    log = capsys.readouterr().out
    assert "Container oral sync: copy refused (409 copy_mismatch)" in log
    [(name, error_id, exc, request)] = reports
    assert name == "container_oral_sync" and isinstance(exc, KeyError) and request.url.path.endswith("/oral-sync")
    assert f"Container oral sync [{error_id}]: KeyError" in log and "a bug" not in log and "Макроэкономика" not in log


# ── Вход и доступ ───────────────────────────────────────────────────────────────


def test_a_signed_out_request_is_refused_before_any_database_call(bridge):
    c = oral_container(bridge, [author_exam(bridge.fake)["exam"]])
    for headers in ({"Authorization": ""}, as_user("token-unknown")):
        response = bridge.post(f"/api/containers/{c['id']}/oral-sync", headers=headers)
        assert response.status_code == 401 and response.json() == {"detail": "Требуется войти в аккаунт"}
    assert bridge.fake.requests == []


def test_the_route_itself_wants_a_session_token(monkeypatch):
    monkeypatch.setattr(container_shares.limiter, "enabled", False)
    bare = FastAPI()
    bare.include_router(container_shares.router)  # без middleware main.py
    response = TestClient(bare).post(f"/api/containers/{uuid.uuid4()}/oral-sync")
    assert response.status_code == 401 and response.json() == {"detail": "Требуется войти в аккаунт"}


def test_only_a_member_syncs(bridge):
    exam = author_exam(bridge.fake)
    c = oral_container(bridge, [exam["exam"]])
    for token in ("token-c", "token-a"):  # чужой и сам автор
        body = assert_refusal(sync(bridge, c["id"], token), 404, "not_found")
        assert body["detail"] == "Экзамен не найден"
    bridge.fake.tables["container_members"][0]["left_at"] = "2026-10-07T09:50:00+00:00"
    assert_refusal(sync(bridge, c["id"]), 404, "not_found")
    assert_refusal(sync(bridge, str(uuid.uuid4())), 404, "not_found")
    start = len(bridge.fake.requests)
    assert_refusal(sync(bridge, "not-a-container"), 404, "not_found")
    assert len(bridge.fake.requests) == start
    assert copies_of(bridge.fake) == [] and copies_of(bridge.fake, "user-c") == []


@pytest.mark.parametrize(
    "answer, status, code",
    [
        (refusal("42501", 403), 403, "forbidden"),
        (refusal("28000", 403), 401, "session"),
        (refusal("PGRST301", 401), 401, "session"),
        (refusal("PGRST202", 404), 503, "unavailable"),
        (refusal("XX000", 503), 503, "read_failed"),
        ((200, []), 503, "read_failed"),
    ],
)
def test_a_refusal_of_the_codes_is_a_russian_error(bridge, answer, status, code):
    c = oral_container(bridge, [author_exam(bridge.fake)["exam"]])
    bridge.fake.refusals["container_oral_codes"] = answer
    assert_refusal(sync(bridge, c["id"]), status, code)
    assert calls_since(bridge.fake, 0) == ["container_oral_codes"]


@pytest.mark.parametrize("rpc", ["exam_share_bundle", "exam_share_join", "container_bind_copy"])
def test_a_session_that_expires_midway_is_401(bridge, rpc):
    c = oral_container(bridge, [author_exam(bridge.fake)["exam"]])
    bridge.fake.refusals[rpc] = refusal("PGRST301", 401)
    assert_refusal(sync(bridge, c["id"]), 401, "session")


# ── Лимит и очередь ─────────────────────────────────────────────────────────────


def test_the_limit_is_6_a_minute_per_user(bridge, monkeypatch):
    import main

    exam = author_exam(bridge.fake)
    c = oral_container(bridge, [exam["exam"]])
    bridge.fake.tables["container_members"].append({"container_id": c["id"], "user_id": "user-c", "link_id": c["link"]["id"],
                                                    "left_at": None, "removed_at": None})
    monkeypatch.setattr(main.limiter, "enabled", True)
    main.limiter.reset()
    try:
        assert [sync(bridge, c["id"]).status_code for _ in range(6)] == [200] * 6
        limited = sync(bridge, c["id"])
        assert limited.status_code == 429 and limited.json()["detail"] == RATE_LIMIT_DETAIL
        assert sync(bridge, c["id"], "token-c").status_code == 200  # по пользователю, а не по общему адресу
    finally:
        main.limiter.reset()


@pytest.mark.parametrize("in_process_lock", [True, False])
def test_two_calls_at_once_make_one_copy(bridge, monkeypatch, in_process_lock):
    """Замок в процессе ставит второй вызов в очередь; и без него копию по одной ссылке дважды не сделать —
    exam_share_join (exam_share_claim держит строку ссылки) отдаёт второму ту же копию."""
    import main

    exam = author_exam(bridge.fake)
    c = oral_container(bridge, [exam["exam"]])
    if not in_process_lock:
        @contextlib.asynccontextmanager
        async def side_by_side(key):
            yield

        monkeypatch.setattr(container_shares, "_one_at_a_time", side_by_side)

    async def interleaving(request):
        await asyncio.sleep(0)  # каждый ответ базы отдаёт ход другому запросу
        response = bridge.fake.handler(request)
        await asyncio.sleep(0)
        return response

    monkeypatch.setattr(supabase_rest, "_transport", httpx.MockTransport(interleaving))

    async def both():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
            path = f"/api/containers/{c['id']}/oral-sync"
            return await asyncio.gather(*(client.post(path, headers=as_user("token-b")) for _ in range(2)))

    responses = asyncio.run(both())
    assert [r.status_code for r in responses] == [200, 200]
    [copy_id] = copies_of(bridge.fake)
    rows = [row for r in responses for row in r.json()["oral"]]
    assert [row["status"] for row in rows].count("copied") == 1
    assert all(row["exam_id"] == copy_id for row in rows)
    assert bindings(bridge.fake) == [(c["subjects"][0], copy_id)]
    assert bridge.fake.derived_share(c["link"], exam["exam"])["members"] == 1
    if in_process_lock:
        assert calls_since(bridge.fake, 0) == ["container_oral_codes", "exam_share_bundle", "exam_share_join",
                                              "container_bind_copy", "container_oral_codes"]
        assert sorted(len(r.json()["oral"]) for r in responses) == [0, 1]


# ── exam_shares.py только читается ──────────────────────────────────────────────


def test_the_bridge_only_reads_exam_shares(bridge):
    for name in ("snapshot_from_bundle", "plan_copy", "normalize_code", "ShareError", "_rpc_error", "READ_TIMEOUT_SECONDS"):
        assert getattr(container_shares, name) is getattr(exam_shares, name)
    source = inspect.getsource(container_shares)
    assert not re.search(r"exam_shares\.\w+\s*=(?!=)", source) and "setattr(" not in source
    before = dict(vars(exam_shares))
    exams = [author_exam(bridge.fake)["exam"] for _ in range(2)]
    make_link(bridge, exams[1])
    join_old_link(bridge)
    c = oral_container(bridge, exams)
    assert [row["status"] for row in sync(bridge, c["id"]).json()["oral"]] == ["copied", "bound"]
    after = dict(vars(exam_shares))
    assert after.keys() == before.keys() and all(after[name] is before[name] for name in before)
