"""«Группа по ссылке» (exam_shares.py): снимок готового экзамена в копию однокурсника.

Перенос id лекций и вопросов, пересчёт отпечатка и ключа эталона, самопроверка (409, ничего не вставлено),
sheet.for = created_at, у однокурсника to_write = 0, пункты из кэша без quota.reserve и без модели, «Сверить»
без единиц, повторный вход — та же копия, отозванная ссылка, автор не входит в свою ссылку, предел мест, условие
готовности (пункты записаны или дважды не прошли проверку цитат), запись такого отказа сервером, согласие,
код один раз, копию дальше не раздают, страница приглашения без входа.

Supabase — PostgREST в памяти из test_oral_sheet (RLS по токену) и функции миграции 20261007110403_exam_shares
на Python с той же логикой проверок (SQL-поведение — supabase/tests/local/exam_shares_behaviour.sql), модель —
подменённый BaseAgent.run, который здесь не должен звать никто, кроме теста записи отказа.
"""
import hashlib
import json
import re
import sys
import uuid
from pathlib import Path

import httpx
import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import exam_shares  # noqa: E402
import exams_map  # noqa: E402
import oral  # noqa: E402
import oral_api  # noqa: E402
import oral_sheet  # noqa: E402
import quota  # noqa: E402
import supabase_rest  # noqa: E402
import test_oral_api  # noqa: E402
from agents.base import BaseAgent  # noqa: E402
from retrieval import material_passages  # noqa: E402
from test_oral import BUDGET, ECON, ECON_QUESTION, econ_points  # noqa: E402
from test_oral_api import ANON, URL, question_hash, rubric_answer  # noqa: E402
from test_oral_sheet import SheetSupabase  # noqa: E402

USERS = {"token-a": "user-a", "token-b": "user-b", "token-c": "user-c"}
CODE = "abcdefghjkmn"
REAL_RESERVE = quota.reserve  # с AI_QUOTA_DISABLED (conftest) ничего не списывает и в сеть не ходит
SHORTS = {"p1": "цель — ценовая стабильность", "p2": "осн. инструмент — ключ. ставка"}


def rpc_error(code, status=400):
    return httpx.Response(status, json={"code": code, "message": "internal details that must not leak"})


class ShareSupabase(SheetSupabase):
    """PostgREST в памяти: ещё таблицы ссылок, мест и отказов, политика вставки ссылки и функции миграции."""

    TABLES = SheetSupabase.TABLES + ("exam_shares", "exam_share_members", "learning_events")

    def __init__(self):
        super().__init__()
        self.rpc_calls: list[tuple[str, dict]] = []

    # — HTTP —

    def handler(self, request: httpx.Request) -> httpx.Response:
        if "/rpc/" in request.url.path:
            self.requests.append(request)
            token = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
            if request.headers.get("apikey") != ANON:
                return httpx.Response(401, json={"code": "PGRST301"})
            user = USERS.get(token)
            if user is None and token != ANON:
                return httpx.Response(401, json={"code": "PGRST301", "message": "JWT expired"})
            name = request.url.path.rsplit("/", 1)[-1]
            args = json.loads(request.content or b"{}")
            self.rpc_calls.append((name, args))
            return getattr(self, f"_rpc_{name}")(user, args)
        return super().handler(request)

    def _insert(self, table, user, body, prefer, params):
        if table == "exam_shares":
            values = body
            row = {"id": str(uuid.uuid4()), "owner_id": user, "created_at": "2026-10-07T10:00:00+00:00", "members": 0,
                   "max_members": 80, "revoked_at": None, "expires_at": None}
            row.update(values)
            exam = next((e for e in self.tables["exams"] if e["id"] == row["exam_id"]), None)
            is_copy = any(m["member_exam_id"] == row["exam_id"] and m["user_id"] == user for m in self.tables["exam_share_members"])
            if row["owner_id"] != user or exam is None or exam["user_id"] != user or is_copy or row["members"] != 0:
                return httpx.Response(403, json={"code": "42501", "message": "row-level security"})
            if any(other["code_hash"] == row["code_hash"] for other in self.tables["exam_shares"]):
                return httpx.Response(409, json={"code": "23505"})
            row["user_id"] = user  # RLS чтения в памяти — по user_id (в базе — owner_id)
            self.tables["exam_shares"].append(row)
            return httpx.Response(201, json=[self._project(row, params)])
        if table == "oral_rubric_failures":
            created = []
            for values in body if isinstance(body, list) else [body]:
                row = {"id": str(uuid.uuid4()), "user_id": user, "rubric_version": 1, "failed_at": "2026-10-07T09:00:00+00:00"}
                row.update(values)
                if row["user_id"] != user:
                    return httpx.Response(403, json={"code": "42501"})
                unique = ("user_id", "question_hash", "source_key", "rubric_version")
                if any(all(other.get(k) == row.get(k) for k in unique) for other in self.tables[table]):
                    if "resolution=ignore-duplicates" in prefer:
                        continue
                    return httpx.Response(409, json={"code": "23505"})
                self.tables[table].append(row)
                created.append(row)
            return httpx.Response(201, json=[self._project(row, params) for row in created])
        return super()._insert(table, user, body, prefer, params)

    # — функции миграции —

    def _share(self, code):
        if not isinstance(code, str) or not re.fullmatch(r"[0-9a-hjkmnp-tv-z]{12}", code):
            return None
        digest = hashlib.sha256(code.encode()).hexdigest()
        return next((s for s in self.tables["exam_shares"] if s["code_hash"] == digest), None)

    def _seat(self, share, user):
        return next((m for m in self.tables["exam_share_members"] if m["share_id"] == share["id"] and m["user_id"] == user), None)

    def _live_copy(self, seat, user):
        if seat is None or seat.get("member_exam_id") is None:
            return None
        exam = next((e for e in self.tables["exams"] if e["id"] == seat["member_exam_id"] and e["user_id"] == user), None)
        return exam["id"] if exam else None

    @staticmethod
    def _dead(share):
        if share["revoked_at"]:
            return "MS002"
        if share["expires_at"] and share["expires_at"] <= "2026-10-07T10:00:00+00:00":
            return "MS003"
        return None

    def _rpc_exam_share_preview(self, user, args):
        share = self._share(args.get("p_code"))
        if share is None:
            return httpx.Response(200, json={"status": "not_found"})
        exam = next(e for e in self.tables["exams"] if e["id"] == share["exam_id"])
        if user == share["owner_id"]:
            status = "own"
        else:
            copy_id = self._live_copy(self._seat(share, user), user) if user else None
            if copy_id:
                return httpx.Response(200, json={"status": "joined", "exam_id": copy_id, "title": exam["title"]})
            dead = self._dead(share)
            if dead:
                return httpx.Response(200, json={"status": {"MS002": "revoked", "MS003": "expired"}[dead]})
            seats = [m for m in self.tables["exam_share_members"] if m["share_id"] == share["id"]]
            if (user is None or self._seat(share, user) is None) and len(seats) >= share["max_members"]:
                return httpx.Response(200, json={"status": "full"})
            status = "active"
        questions = [q for q in self.tables["exam_questions"] if q["exam_id"] == exam["id"]]
        lectures = [link for link in self.tables["exam_materials"] if link["exam_id"] == exam["id"]]
        return httpx.Response(200, json={"status": status, "exam_id": exam["id"] if status == "own" else None,
                                         "title": exam["title"], "kind": "exam", "exam_date": exam.get("exam_date"),
                                         "questions": len(questions), "lectures": len(lectures)})

    def _rpc_exam_share_bundle(self, user, args):
        if user is None:
            return rpc_error("28000", 403)
        share = self._share(args.get("p_code"))
        if share is None:
            return rpc_error("MS001")
        if share["owner_id"] == user:
            return rpc_error("MS005")
        seat = self._seat(share, user)
        copy_id = self._live_copy(seat, user)
        if copy_id:
            return httpx.Response(200, json={"v": 1, "joined": {"exam_id": copy_id}})
        dead = self._dead(share)
        if dead:
            return rpc_error(dead)
        seats = [m for m in self.tables["exam_share_members"] if m["share_id"] == share["id"]]
        if seat is None and len(seats) >= share["max_members"]:
            return rpc_error("MS004")
        owner, exam_id = share["owner_id"], share["exam_id"]
        exam = next(e for e in self.tables["exams"] if e["id"] == exam_id)
        links = sorted((l for l in self.tables["exam_materials"] if l["exam_id"] == exam_id), key=lambda l: (l["added_at"], l["material_id"]))
        link_ids = [l["material_id"] for l in links]
        questions = sorted((q for q in self.tables["exam_questions"] if q["exam_id"] == exam_id and q["user_id"] == owner),
                           key=lambda q: (q["position"], q.get("created_at") or "", q["id"]))
        hashes = {q["question_hash"] for q in questions}
        question_keys = ("id", "position", "label", "section", "text", "question_hash", "coverage", "coverage_method",
                         "coverage_reason", "missing_note", "evidence", "nearest", "materials_fingerprint", "mapping_version",
                         "mapped_at")
        return httpx.Response(200, json={
            "v": 1,
            "exam": {key: exam.get(key) for key in ("title", "kind", "exam_date", "source_kind", "source_text", "ticket_layout",
                                                   "mapping_state", "mapping_started_at", "mapped_at", "mapped_material_ids")},
            "links": [{"material_id": mid} for mid in link_ids],
            "materials": [{key: m.get(key, "") for key in ("id", "title", "subject", "original_text")}
                          for mid in link_ids for m in self.tables["materials"] if m["id"] == mid and m["user_id"] == owner],
            "questions": [{key: q.get(key) for key in question_keys} for q in questions],
            "rubrics": [{key: r.get(key) for key in ("question_hash", "source_key", "rubric_version", "material_ids", "rubric",
                                                    "created_at", "sheet")}
                        for r in self.tables["oral_rubrics"]
                        if r["user_id"] == owner and r["question_hash"] in hashes and r["material_id"] in link_ids
                        and set(r.get("material_ids") or []) <= set(link_ids)],
            "failures": [{key: f.get(key) for key in ("question_hash", "source_key", "rubric_version", "failed_at")}
                         for f in self.tables["oral_rubric_failures"] if f["user_id"] == owner and f["question_hash"] in hashes],
        })

    def _rpc_exam_share_join(self, user, args):
        if user is None:
            return rpc_error("28000", 403)
        share = self._share(args.get("p_code"))
        if share is None:
            return rpc_error("MS001")
        if share["owner_id"] == user:
            return rpc_error("MS005")
        seat = self._seat(share, user)
        copy_id = self._live_copy(seat, user)
        if copy_id:
            return httpx.Response(200, json={"exam_id": copy_id, "joined": False})
        dead = self._dead(share)
        if dead:
            return rpc_error(dead)
        seats = [m for m in self.tables["exam_share_members"] if m["share_id"] == share["id"]]
        if seat is None and len(seats) >= share["max_members"]:
            return rpc_error("MS004")
        copy = args.get("p_copy")
        if not isinstance(copy, dict) or copy.get("v") != 1:
            return rpc_error("MS006")
        exam = copy["exam"]
        materials = [{"user_id": user, "summary_json": {"text_only": True}, "flashcards_json": {"flashcards": []},
                      "quiz_json": {"quiz": []}, **m} for m in copy["materials"]]
        own = {m["id"] for m in materials}
        rows = {
            "materials": materials,
            "exams": [{"user_id": user, **{k: v for k, v in exam.items()}}],
            "exam_materials": [{"exam_id": exam["id"], "material_id": l["material_id"], "user_id": user,
                                "added_at": f"2026-10-07T10:00:00.{index:06d}+00:00"} for index, l in enumerate(copy["links"], 1)],
            "exam_questions": [{"exam_id": exam["id"], "user_id": user, "question_hash": question_hash(q["text"]),
                                "created_at": "2026-10-07T10:00:00+00:00", **q} for q in copy["questions"]],
            "oral_rubrics": [{"user_id": user, "model": "", **r, "created_at": r["created_at"] or "2026-10-07T10:00:00+00:00"}
                             for r in copy["rubrics"]],
        }
        # Политики «свои строки»: лекции эталонов и связи — только свои (иначе отказ всей транзакции).
        if any(r["material_id"] not in own or not set(r["material_ids"]) <= own for r in rows["oral_rubrics"]):
            return rpc_error("42501", 403)
        if any(l["material_id"] not in own for l in rows["exam_materials"]):
            return rpc_error("42501", 403)
        for table, items in rows.items():
            self.tables[table].extend(items)
        if seat is None:
            seat = {"id": str(uuid.uuid4()), "share_id": share["id"], "user_id": user, "member_exam_id": None}
            self.tables["exam_share_members"].append(seat)
            share["members"] += 1
        seat["member_exam_id"] = exam["id"]
        return httpx.Response(200, json={"exam_id": exam["id"], "joined": True, "questions": len(copy["questions"]),
                                         "lectures": len(materials), "rubrics": len(copy["rubrics"])})

    def _rpc_exam_share_revoke(self, user, args):
        if user is None:
            return rpc_error("28000", 403)
        share = next((s for s in self.tables["exam_shares"] if s["id"] == args.get("p_share_id") and s["owner_id"] == user), None)
        if share is None:
            return rpc_error("MS001")
        share["revoked_at"] = share["revoked_at"] or "2026-10-07T11:00:00+00:00"
        return httpx.Response(200, json={"id": share["id"], "revoked_at": share["revoked_at"]})

    # — что видит пользователь —

    def own(self, table, user):
        return [row for row in self.tables[table] if row.get("user_id") == user]


@pytest.fixture
def share(monkeypatch):
    import main
    from fastapi.testclient import TestClient

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
    for name in ("GEMINI_API_KEY", "GROQ_API_KEY", "SHEET_DAILY_BUILDS"):
        monkeypatch.delenv(name, raising=False)
    fake = ShareSupabase()
    monkeypatch.setattr(supabase_rest, "_transport", httpx.MockTransport(fake.handler))
    model = test_oral_api.FakeModel()

    async def fake_run(agent, system_prompt, user_text, **kwargs):
        return await model.run(agent, system_prompt, user_text, **kwargs)

    monkeypatch.setattr(BaseAgent, "run", fake_run)
    monkeypatch.setattr(BaseAgent, "forget", classmethod(lambda cls, raw: None))
    reserved: list = []

    async def no_reserve(*args, **kwargs):
        reserved.append(args)
        raise AssertionError("quota.reserve must not be called")

    monkeypatch.setattr(quota, "reserve", no_reserve)
    oral_api._flights.clear()
    oral_sheet._jobs.clear()
    client = TestClient(main.app, headers={"Authorization": "Bearer token-a"})
    client.fake, client.model, client.reserved = fake, model, reserved
    yield client
    oral_api._flights.clear()
    oral_sheet._jobs.clear()


def as_user(token):
    return {"Authorization": f"Bearer {token}"}


# ── Экзамен автора ──────────────────────────────────────────────────────────────


def fragments_of(material_id, title, text):
    return {p.source_id: p.text for p in material_passages(material_id, title, text)}


def author_exam(fake, *, with_rubrics=True, failed=False, unmapped=False):
    """Экзамен автора как после сверки и записи шпаргалки: две лекции, четыре вопроса, ключи по формуле листа."""
    econ = fake.material("Денежный рынок", ECON)
    budget = fake.material("Бюджетная политика", BUDGET)
    for row, subject in ((fake.row("materials", econ), "Макроэкономика"), (fake.row("materials", budget), "Макроэкономика")):
        row["subject"] = subject
    exam_id = fake.exam(title="Макроэкономика")
    fake.row("exams", exam_id).update({"kind": "exam", "exam_date": "2026-11-10", "source_kind": "paste",
                                       "source_text": "1. …", "mapping_state": "done", "mapping_started_at": None,
                                       "mapped_at": "2026-10-06T10:00:00+00:00", "mapped_material_ids": [econ, budget]})
    fake.link(exam_id, econ)
    fake.link(exam_id, budget)
    links = [econ, budget]
    econ_fragments = fragments_of(econ, "Денежный рынок", ECON)
    budget_fragments = fragments_of(budget, "Бюджетная политика", BUDGET)
    fingerprint = exams_map.materials_fingerprint([(econ, ECON), (budget, BUDGET)])

    def evidence(material_id, title, frags, sid):
        return {"material_id": material_id, "material_title": title, "source_id": sid, "excerpt": frags[sid]}

    common = {"coverage_reason": "Ответ есть во фрагментах лекций", "missing_note": "", "materials_fingerprint": fingerprint,
              "mapping_version": exams_map.MAP_VERSION, "mapped_at": "2026-10-06T10:00:00+00:00", "section": None}
    q1 = fake.question(exam_id, ECON_QUESTION, position=1, label="1", coverage="full", coverage_method="llm",
                       evidence=[evidence(econ, "Денежный рынок", econ_fragments, "S02"),
                                 evidence(econ, "Денежный рынок", econ_fragments, "S03")],
                       nearest=[], created_at="2026-10-01T08:00:01+00:00", **common)
    q2 = fake.question(exam_id, "Бюджетная политика во время спада", position=2, label="2", coverage="partial",
                       coverage_method="llm", evidence=[evidence(budget, "Бюджетная политика", budget_fragments, "S03")],
                       nearest=[{"material_id": budget, "material_title": "Бюджетная политика", "source_id": "S02",
                                 "excerpt": budget_fragments["S02"][:60], "matched": ["бюджетн"]}],
                       created_at="2026-10-01T08:00:02+00:00", **{**common, "missing_note": "примеров"})
    q3 = fake.question(exam_id, "Теорема Коуза", position=3, label="3", coverage="none", coverage_method="lexical",
                       evidence=[], nearest=[], created_at="2026-10-01T08:00:03+00:00",
                       **{**common, "coverage_reason": "Ни одного фрагмента с этими словами"})
    q4 = fake.question(exam_id, "Согласование денежной и бюджетной политики", position=4, label="4",
                       coverage=None if unmapped else "full", coverage_method=None if unmapped else "llm",
                       evidence=[] if unmapped else [evidence(budget, "Бюджетная политика", budget_fragments, "S04")],
                       nearest=[], created_at="2026-10-01T08:00:04+00:00", **common)
    fake.row("exams", exam_id)["ticket_layout"] = {"mode": "fixed", "per_ticket": 2, "section_titles": [],
                                                    "tickets": [{"number": 1, "question_ids": [q1, q2]},
                                                                {"number": 2, "question_ids": [q3, q4]}]}
    stamps = {q1: "2026-10-06T11:00:00.123456+00:00", q2: "2026-10-06T11:00:01.654321+00:00",
              q4: "2026-10-06T11:00:02.000001+00:00"}
    if with_rubrics:
        for qid, materials in ((q1, [(econ, "Денежный рынок")]), (q2, [(budget, "Бюджетная политика"), (econ, "Денежный рынок")]),
                               (q4, [(budget, "Бюджетная политика")])):
            if qid == q4 and (failed or unmapped):
                continue
            row = fake.row("exam_questions", qid)
            points = [{"id": f"p{n}", **point} for n, point in enumerate(econ_points(), start=1)]
            fake.tables["oral_rubrics"].append({
                "id": str(uuid.uuid4()), "user_id": "user-a", "question_hash": row["question_hash"],
                "source_key": oral.rubric_key(row, links), "material_id": materials[0][0],
                "material_ids": [mid for mid, _ in materials], "question": row["text"], "rubric_version": 1, "model": "m",
                "created_at": stamps[qid],
                "sheet": {"v": 1, "for": stamps[qid], "short": dict(SHORTS), "tried": {"p3": True}},
                "rubric": {"v": 1, "question": row["text"], "coverage": row["coverage"], "coverage_note": "",
                           "fragments_considered": 3, "fragments_total": 9,
                           "materials": [{"key": f"M{i}", "material_id": mid, "title": title}
                                         for i, (mid, title) in enumerate(materials, start=1)],
                           "points": points,
                           "nearest": [{"source_id": "M1:S02", "material_id": materials[0][0], "text": "…"}]},
            })
    if failed:
        row = fake.row("exam_questions", q4)
        fake.tables["oral_rubric_failures"].append({"id": str(uuid.uuid4()), "user_id": "user-a", "question_hash": row["question_hash"],
                                                    "source_key": oral.rubric_key(row, links), "rubric_version": 1,
                                                    "failed_at": "2026-10-06T12:00:00+00:00", "reason": "unverifiable"})
    return {"exam": exam_id, "econ": econ, "budget": budget, "questions": [q1, q2, q3, q4], "links": links}


def make_link(share, exam_id, code=CODE, **fields):
    """Ссылка автора с известным кодом (код из ответа API случаен — для входа берём свой)."""
    row = {"id": str(uuid.uuid4()), "exam_id": exam_id, "owner_id": "user-a", "user_id": "user-a",
           "code_hash": hashlib.sha256(code.encode()).hexdigest(), "consent": exam_shares.CONSENT_TEXT,
           "created_at": "2026-10-07T09:00:00+00:00", "expires_at": "2027-01-05T09:00:00+00:00", "revoked_at": None,
           "max_members": 80, "members": 0}
    row.update(fields)
    share.fake.tables["exam_shares"].append(row)
    return row


def join(share, token="token-b", code=CODE):
    return share.post("/api/exam-shares/join", json={"code": code}, headers=as_user(token))


def member_rows(share, user="user-b"):
    return {table: share.fake.own(table, user) for table in ("exams", "materials", "exam_materials", "exam_questions", "oral_rubrics")}


def assert_refusal(response, status, code):
    assert response.status_code == status, response.text
    body = response.json()
    assert body["code"] == code and re.search(r"[А-Яа-яЁё]", body["detail"])
    assert "internal details" not in response.text and "Exception" not in response.text
    return body


# ── Маршруты ────────────────────────────────────────────────────────────────────


def test_routes_are_mounted_and_the_preview_is_public():
    import main

    declared = {(route.path, frozenset(route.methods)) for route in exam_shares.router.routes}
    assert declared == {
        ("/api/exam-shares", frozenset({"GET"})),
        ("/api/exam-shares", frozenset({"POST"})),
        ("/api/exam-shares/{share_id}/revoke", frozenset({"POST"})),
        ("/api/exam-shares/preview", frozenset({"POST"})),
        ("/api/exam-shares/join", frozenset({"POST"})),
    }
    assert main.exam_shares_router is exam_shares.router
    assert "/api/exam-shares/preview" in main.PUBLIC_API_PATHS
    assert "/api/exam-shares/join" not in main.PUBLIC_API_PATHS and "/api/exam-shares" not in main.PUBLIC_API_PATHS


def test_code_alphabet_and_normalisation():
    codes = {exam_shares.new_code() for _ in range(2000)}
    assert len(codes) == 2000
    assert all(re.fullmatch(r"[0-9a-hjkmnp-tv-z]{12}", code) for code in codes)
    # Есть и цифра, и буква: адрес /join/<код> не попадает в статистику как слово (lib/telemetry.routePattern).
    assert all(re.search(r"\d", code) and re.search(r"[a-z]", code) for code in codes)
    assert exam_shares.normalize_code(" ABCD-EFGH-JKMN ") == "abcdefghjkmn"
    assert exam_shares.normalize_code("abcdefghjkmi") is None  # i — не из алфавита
    assert exam_shares.normalize_code("abc") is None and exam_shares.normalize_code(None) is None
    assert exam_shares.code_hash(CODE) == hashlib.sha256(CODE.encode()).hexdigest()


# ── Создание ссылки ─────────────────────────────────────────────────────────────


def test_a_link_needs_the_consent_and_the_code_is_shown_once(share):
    exam = author_exam(share.fake)
    refused = share.post("/api/exam-shares", json={"exam_id": exam["exam"]})
    assert_refusal(refused, 400, "consent")
    assert share.fake.tables["exam_shares"] == []

    created = share.post("/api/exam-shares", json={"exam_id": exam["exam"], "consent": True})
    assert created.status_code == 200, created.text
    body = created.json()
    code = body["code"]
    assert re.fullmatch(r"[0-9a-hjkmnp-tv-z]{12}", code) and body["path"] == f"/join/{code}"
    stored = share.fake.tables["exam_shares"][0]
    assert stored["code_hash"] == hashlib.sha256(code.encode()).hexdigest()
    assert code not in json.dumps(stored) and stored["consent"] == exam_shares.CONSENT_TEXT
    assert stored["max_members"] == 80 and stored["owner_id"] == "user-a"
    assert body["share"]["state"] == "active" and body["share"]["members"] == 0

    state = share.get(f"/api/exam-shares?exam_id={exam['exam']}").json()
    assert state["ready"] is True and state["copy"] is False and len(state["shares"]) == 1
    assert code not in json.dumps(state)
    assert share.model.calls == [] and share.reserved == []


def test_a_link_waits_for_the_sheet_then_takes_a_question_whose_points_failed(share):
    exam = author_exam(share.fake, failed=True)
    failure = share.fake.tables["oral_rubric_failures"].pop()
    refused = share.post("/api/exam-shares", json={"exam_id": exam["exam"], "consent": True})
    body = assert_refusal(refused, 409, "not_ready")
    assert body["reason"] == "needs_sheet" and body["questions"] == 1
    assert body["detail"] == "Сначала допишите шпаргалку: у 1 вопроса ещё нет пунктов ответа."
    state = share.get(f"/api/exam-shares?exam_id={exam['exam']}").json()
    assert state["ready"] is False and state["reason"]["reason"] == "needs_sheet"
    assert share.fake.tables["exam_shares"] == []

    # Пункты вопроса 4 дважды не прошли проверку цитат — отказ записан: ссылку можно сделать.
    share.fake.tables["oral_rubric_failures"].append(failure)
    created = share.post("/api/exam-shares", json={"exam_id": exam["exam"], "consent": True})
    assert created.status_code == 200, created.text
    assert share.get(f"/api/exam-shares?exam_id={exam['exam']}").json()["ready"] is True


def test_a_link_waits_for_the_mapping(share):
    exam = author_exam(share.fake, unmapped=True)
    body = assert_refusal(share.post("/api/exam-shares", json={"exam_id": exam["exam"], "consent": True}), 409, "not_ready")
    assert body["reason"] == "needs_mapping" and body["detail"] == "Сначала сверьте список с лекциями: 1 вопрос ещё не сверен."
    running = author_exam(share.fake)
    share.fake.row("exams", running["exam"]).update({"mapping_state": "running", "mapping_started_at": "2999-01-01T00:00:00+00:00"})
    body = assert_refusal(share.post("/api/exam-shares", json={"exam_id": running["exam"], "consent": True}), 409, "not_ready")
    assert body["reason"] == "mapping_running"
    assert share.fake.tables["exam_shares"] == []


def nothing_found(share, exam):
    """Сверка закончена, но ни один вопрос не нашёлся в лекциях: все «нет»."""
    for qid in exam["questions"]:
        share.fake.row("exam_questions", qid).update(
            {"coverage": "none", "coverage_method": "lexical", "evidence": [], "nearest": [],
             "coverage_reason": "Ни одного фрагмента с этими словами"}
        )


def test_the_state_counts_what_the_mapping_found(share):
    exam = author_exam(share.fake)
    state = share.get(f"/api/exam-shares?exam_id={exam['exam']}").json()
    # «есть», «частично», «нет», «есть»: три из четырёх нашлись в лекциях.
    assert state["ready"] is True and state["coverage"] == {"questions": 4, "found": 3}

    # Нашёлся один из четырёх: ссылку дать можно (окно предупредит), сервер не отказывает.
    for qid in exam["questions"][1:]:
        share.fake.row("exam_questions", qid).update({"coverage": "none", "coverage_method": "lexical", "evidence": []})
    state = share.get(f"/api/exam-shares?exam_id={exam['exam']}").json()
    assert state["ready"] is True and state["coverage"] == {"questions": 4, "found": 1}
    assert share.post("/api/exam-shares", json={"exam_id": exam["exam"], "consent": True}).status_code == 200


def test_a_link_is_refused_when_the_lectures_answer_nothing(share):
    exam = author_exam(share.fake)
    make_link(share, exam["exam"])  # сделана раньше, когда было что делить
    nothing_found(share, exam)

    state = share.get(f"/api/exam-shares?exam_id={exam['exam']}").json()
    assert state["ready"] is False and state["copy"] is False
    assert state["reason"] == {"code": "nothing_found", "detail": exam_shares.NOTHING_FOUND_DETAIL, "questions": 4, "found": 0}
    assert state["coverage"] == {"questions": 4, "found": 0}
    assert exam_shares.NOTHING_FOUND_DETAIL == (
        "В лекциях не нашлось ответа ни на один вопрос — однокурсникам будет не с чем заниматься. "
        "Добавьте лекции по этим темам и сверьте заново, потом приглашайте."
    )

    before = len(share.fake.tables["exam_shares"])
    body = assert_refusal(share.post("/api/exam-shares", json={"exam_id": exam["exam"], "consent": True}), 409, "nothing_found")
    assert body["detail"] == exam_shares.NOTHING_FOUND_DETAIL and body["questions"] == 4 and body["found"] == 0
    assert len(share.fake.tables["exam_shares"]) == before

    # Вход по ссылке, сделанной раньше, этим не закрыт: однокурсник получает копию, как получал.
    response = join(share)
    assert response.status_code == 200, response.text
    assert share.model.calls == [] and share.reserved == []


def test_an_unmapped_exam_hears_about_the_mapping_before_nothing_found(share):
    exam = author_exam(share.fake, unmapped=True)
    nothing_found(share, exam)
    share.fake.row("exam_questions", exam["questions"][3]).update({"coverage": None, "coverage_method": None})
    body = assert_refusal(share.post("/api/exam-shares", json={"exam_id": exam["exam"], "consent": True}), 409, "not_ready")
    assert body["reason"] == "needs_mapping"
    state = share.get(f"/api/exam-shares?exam_id={exam['exam']}").json()
    assert state["reason"]["reason"] == "needs_mapping" and state["coverage"] == {"questions": 4, "found": 0}


def test_another_users_exam_cannot_get_a_link(share):
    exam = author_exam(share.fake)
    response = share.post("/api/exam-shares", json={"exam_id": exam["exam"], "consent": True}, headers=as_user("token-b"))
    assert_refusal(response, 404, "not_found")
    assert share.fake.tables["exam_shares"] == []


# ── Вход по ссылке ──────────────────────────────────────────────────────────────


def test_join_copies_the_exam_with_new_ids_fingerprint_and_keys(share):
    exam = author_exam(share.fake)
    make_link(share, exam["exam"])
    response = join(share)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["joined"] is True and body["questions"] == 4 and body["lectures"] == 2 and body["without_points"] == 0
    rows = member_rows(share)
    copy_id = body["exam_id"]
    assert [e["id"] for e in rows["exams"]] == [copy_id] and copy_id != exam["exam"]

    # Лекции — «только текст», новые id, тексты автора, порядок автора.
    links = [l["material_id"] for l in sorted(rows["exam_materials"], key=lambda l: l["added_at"])]
    by_id = {m["id"]: m for m in rows["materials"]}
    assert [by_id[mid]["original_text"] for mid in links] == [ECON, BUDGET]
    assert all(m["summary_json"] == {"text_only": True} for m in rows["materials"])
    assert not set(links) & set(exam["links"])
    renamed = dict(zip(exam["links"], links))

    # Отпечаток — заново, по новым id; evidence и nearest — с новыми id лекций.
    fingerprint = exams_map.materials_fingerprint((mid, by_id[mid]["original_text"]) for mid in links)
    questions = sorted(rows["exam_questions"], key=lambda q: q["position"])
    author = [share.fake.row("exam_questions", qid) for qid in exam["questions"]]
    for mine, theirs in zip(questions, author):
        assert mine["id"] != theirs["id"] and mine["text"] == theirs["text"]
        assert mine["materials_fingerprint"] == fingerprint
        assert [e["material_id"] for e in mine["evidence"]] == [renamed[e["material_id"]] for e in theirs["evidence"]]
        assert [e["excerpt"] for e in mine["evidence"]] == [e["excerpt"] for e in theirs["evidence"]]
        assert [n["material_id"] for n in mine["nearest"]] == [renamed[n["material_id"]] for n in theirs["nearest"]]

    # Эталон: ключ — oral.rubric_key строки копии; лекции эталона — новые id.
    rubrics = {(r["question_hash"], r["source_key"]): r for r in rows["oral_rubrics"]}
    assert len(rubrics) == 3
    for mine in questions:
        if mine["coverage"] not in ("full", "partial"):
            continue
        row = rubrics[(mine["question_hash"], oral.rubric_key(mine, links))]
        assert row["material_id"] in links and set(row["material_ids"]) <= set(links)
        assert {m["material_id"] for m in row["rubric"]["materials"]} <= set(links)
        assert {n["material_id"] for n in row["rubric"]["nearest"]} <= set(links)
    layout = rows["exams"][0]["ticket_layout"]
    assert [t["question_ids"] for t in layout["tickets"]] == [[questions[0]["id"], questions[1]["id"]],
                                                            [questions[2]["id"], questions[3]["id"]]]
    dump = json.dumps(rows, ensure_ascii=False)
    for old in [*exam["links"], *exam["questions"], exam["exam"]]:
        assert old not in dump
    assert rows["exams"][0]["mapping_state"] == "done" and rows["exams"][0]["mapped_material_ids"] == links
    assert share.model.calls == [] and share.reserved == []


def test_the_copy_keeps_the_focus_of_the_evidence(share):
    """evidence[].focus (место проверенной цитаты, exams_map) — необязательный ключ: копия переносит его как есть,
    тексты лекций те же, так что место то же; на готовность ссылки и самопроверку он не влияет."""
    exam = author_exam(share.fake)
    first = share.fake.row("exam_questions", exam["questions"][0])
    excerpt = first["evidence"][0]["excerpt"]
    words = list(re.finditer(r"\w+", excerpt))
    focus = [words[2].start(), words[9].end()]
    first["evidence"][0]["focus"] = focus
    make_link(share, exam["exam"])
    response = join(share)
    assert response.status_code == 200, response.text
    mine = min(member_rows(share)["exam_questions"], key=lambda q: q["position"])
    assert mine["evidence"][0]["focus"] == focus and mine["evidence"][0]["excerpt"] == excerpt
    assert "focus" not in mine["evidence"][1]


def test_the_sheet_keeps_for_equal_to_created_at_and_to_write_is_zero(share):
    exam = author_exam(share.fake)
    make_link(share, exam["exam"])
    copy_id = join(share).json()["exam_id"]
    author_rubrics = {r["question_hash"]: r for r in share.fake.own("oral_rubrics", "user-a")}
    for mine in share.fake.own("oral_rubrics", "user-b"):
        theirs = author_rubrics[mine["question_hash"]]
        assert mine["created_at"] == theirs["created_at"] and mine["sheet"] == theirs["sheet"]
        assert mine["sheet"]["for"] == mine["created_at"]

    sheet = share.get(f"/api/oral/sheet?exam_id={copy_id}", headers=as_user("token-b"))
    assert sheet.status_code == 200, sheet.text
    body = sheet.json()
    assert body["to_write"] == 0 and body["units"] == 0
    written = [q for q in body["questions"] if q["rubric"] is not None]
    assert len(written) == 3 and all(q["rebuilt"] is False for q in body["questions"])
    for question in written:
        assert question["rubric"]["built_at"] == author_rubrics[question["question_hash"]]["created_at"]
        shorts = {p["id"]: p["short"] for p in question["rubric"]["points"]}
        assert shorts["p1"] == SHORTS["p1"] and shorts["p2"] == SHORTS["p2"] and shorts["p3"] == ""
    assert share.model.calls == [] and share.reserved == []


def test_the_member_gets_points_from_the_cache_without_quota_or_model(share):
    exam = author_exam(share.fake)
    make_link(share, exam["exam"])
    copy_id = join(share).json()["exam_id"]
    questions = sorted(share.fake.own("exam_questions", "user-b"), key=lambda q: q["position"])
    for question in questions[:2]:
        response = share.post("/api/oral/rubric", json={"exam_id": copy_id, "question_id": question["id"]},
                              headers=as_user("token-b"))
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["cached"] is True and body["saved"] is True and len(body["rubric"]["points"]) == 4
    none = share.post("/api/oral/rubric", json={"exam_id": copy_id, "question_id": questions[2]["id"]}, headers=as_user("token-b"))
    assert none.status_code == 409 and none.json()["code"] == "not_in_lectures"
    assert share.model.calls == [] and share.reserved == []


def test_mapping_the_copy_costs_nothing(share):
    exam = author_exam(share.fake)
    make_link(share, exam["exam"])
    copy_id = join(share).json()["exam_id"]
    response = share.post(f"/api/exams/{copy_id}/map", json={"question_ids": None, "force": False}, headers=as_user("token-b"))
    assert response.status_code == 200, response.text
    events = [json.loads(frame[6:]) for frame in response.text.split("\n\n") if frame.startswith("data: ")]
    assert events[0]["type"] == "start" and events[0]["to_check"] == 0
    assert events[-1]["type"] == "done" and events[-1]["used_ai"] is False
    assert share.model.calls == [] and share.reserved == []


def test_joining_again_opens_the_same_copy(share):
    exam = author_exam(share.fake)
    link = make_link(share, exam["exam"])
    first = join(share).json()
    calls = len(share.fake.rpc_calls)
    again = join(share)
    assert again.status_code == 200 and again.json() == {"exam_id": first["exam_id"], "joined": False}
    assert [name for name, _ in share.fake.rpc_calls[calls:]] == ["exam_share_bundle"]
    assert len(share.fake.own("exams", "user-b")) == 1 and len(share.fake.own("materials", "user-b")) == 2
    assert link["members"] == 1


def test_a_revoked_link_lets_nobody_new_in(share):
    exam = author_exam(share.fake)
    link = make_link(share, exam["exam"])
    first = join(share).json()
    revoked = share.post(f"/api/exam-shares/{link['id']}/revoke")
    assert revoked.status_code == 200 and revoked.json()["revoked_at"]
    assert_refusal(join(share, "token-c"), 410, "link_revoked")
    assert share.fake.own("exams", "user-c") == [] and share.fake.own("materials", "user-c") == []
    # Копия того, кто вошёл раньше, остаётся его.
    assert join(share).json() == {"exam_id": first["exam_id"], "joined": False}
    preview = share.post("/api/exam-shares/preview", json={"code": CODE}, headers={"Authorization": ""})
    assert preview.json() == {"status": "revoked"}
    # Отозвать чужую ссылку нельзя.
    assert_refusal(share.post(f"/api/exam-shares/{link['id']}/revoke", headers=as_user("token-b")), 404, "link_not_found")


def test_the_author_cannot_join_their_own_link(share):
    exam = author_exam(share.fake)
    make_link(share, exam["exam"])
    assert_refusal(join(share, "token-a"), 409, "own_link")
    assert len(share.fake.own("exams", "user-a")) == 1


def test_the_seat_limit(share):
    exam = author_exam(share.fake)
    link = make_link(share, exam["exam"], max_members=1)
    assert join(share, "token-b").status_code == 200
    assert_refusal(join(share, "token-c"), 409, "link_full")
    assert share.fake.own("exams", "user-c") == []
    assert link["members"] == 1
    # Вошедший раньше по-прежнему открывает свою копию.
    assert join(share, "token-b").json()["joined"] is False


def test_an_expired_link_and_a_wrong_code(share):
    exam = author_exam(share.fake)
    make_link(share, exam["exam"], expires_at="2026-10-01T00:00:00+00:00")
    assert_refusal(join(share), 410, "link_expired")
    assert_refusal(join(share, code="zzzzzzzzzzzz"), 404, "link_not_found")
    assert_refusal(join(share, code="not a code"), 404, "link_not_found")


def test_a_question_whose_points_failed_goes_without_points_and_the_ticket_skips_the_model(share):
    exam = author_exam(share.fake, failed=True)
    make_link(share, exam["exam"])
    body = join(share).json()
    assert body["without_points"] == 1
    copy_id = body["exam_id"]
    sheet = share.get(f"/api/oral/sheet?exam_id={copy_id}", headers=as_user("token-b")).json()
    assert sheet["to_write"] == 0
    fourth = next(q for q in sheet["questions"] if q["position"] == 4)
    assert fourth["rubric"]["coverage"] == "none" and fourth["rubric"]["points"] == []
    ticket = share.post("/api/oral/rubric", json={"exam_id": copy_id, "question_id": fourth["question_id"]}, headers=as_user("token-b"))
    assert ticket.status_code == 422 and ticket.json()["code"] == "rubric_unverifiable"
    assert share.model.calls == [] and share.reserved == []


def test_the_self_check_refuses_a_copy_whose_key_would_not_match(share, monkeypatch):
    exam = author_exam(share.fake)
    make_link(share, exam["exam"])
    original = exam_shares._build_copy

    def wrong_key(*args, **kwargs):
        plan = original(*args, **kwargs)
        plan.payload["rubrics"][0]["source_key"] = "0" * 40  # ключ, которого лист однокурсника не найдёт
        return plan

    monkeypatch.setattr(exam_shares, "_build_copy", wrong_key)
    assert_refusal(join(share), 409, "copy_mismatch")
    assert [name for name, _ in share.fake.rpc_calls] == ["exam_share_bundle"]
    assert member_rows(share) == {table: [] for table in ("exams", "materials", "exam_materials", "exam_questions", "oral_rubrics")}
    assert share.fake.tables["exam_share_members"] == []
    # Тот же расчёт до создания ссылки: ссылка не создаётся, автору — свои слова.
    refused = share.post("/api/exam-shares", json={"exam_id": exam["exam"], "consent": True})
    assert assert_refusal(refused, 409, "copy_mismatch")["detail"] == exam_shares.AUTHOR_COPY_MISMATCH_DETAIL
    assert len(share.fake.tables["exam_shares"]) == 1  # только ссылка, сделанная тестом вручную


def test_the_self_check_refuses_an_old_id_left_in_the_copy(share, monkeypatch):
    exam = author_exam(share.fake)
    make_link(share, exam["exam"])
    monkeypatch.setattr(exam_shares, "_translate_layout", lambda layout, ids: layout)  # id вопросов автора остаются
    assert_refusal(join(share), 409, "copy_mismatch")
    assert member_rows(share)["exams"] == [] and share.fake.tables["exam_share_members"] == []


def test_the_plan_is_pure_and_checks_the_fingerprint_against_the_copied_texts(share, monkeypatch):
    exam = author_exam(share.fake)
    assert share.fake._rpc_exam_share_bundle("user-b", {"p_code": CODE}).status_code == 400  # ссылки ещё нет
    make_link(share, exam["exam"])
    snapshot = exam_shares.snapshot_from_bundle(json.loads(share.fake._rpc_exam_share_bundle("user-b", {"p_code": CODE}).content))
    ids = iter(f"00000000-0000-4000-8000-{n:012d}" for n in range(1, 100))
    plan = exam_shares.plan_copy(snapshot, new_id=lambda: next(ids))
    payload = plan.payload
    assert payload["exam"]["id"] == plan.exam_id and plan.rubrics == 3 and plan.lectures == 2
    texts = {m["id"]: m["original_text"] for m in payload["materials"]}
    fingerprint = exams_map.materials_fingerprint(texts.items())
    assert {q["materials_fingerprint"] for q in payload["questions"]} == {fingerprint}
    assert share.fake.rpc_calls == [] and member_rows(share)["exams"] == []

    # Текст лекции поменялся по дороге — отпечаток вопросов уже не тот, что у лекций копии: самопроверка ловит.
    original_verify = exam_shares._verify

    def tampered(plan, *args):
        plan.payload["materials"][0]["original_text"] += " "
        return original_verify(plan, *args)

    monkeypatch.setattr(exam_shares, "_verify", tampered)
    with pytest.raises(exam_shares.ShareError) as caught:
        exam_shares.plan_copy(snapshot)
    assert caught.value.code == "copy_mismatch" and caught.value.status_code == 409


# ── Копию дальше не раздают; страница приглашения ───────────────────────────────


def test_a_copy_cannot_be_shared_on(share):
    exam = author_exam(share.fake)
    make_link(share, exam["exam"])
    copy_id = join(share).json()["exam_id"]
    state = share.get(f"/api/exam-shares?exam_id={copy_id}", headers=as_user("token-b")).json()
    assert state["copy"] is True and state["ready"] is False and state["reason"]["code"] == "is_copy"
    refused = share.post("/api/exam-shares", json={"exam_id": copy_id, "consent": True}, headers=as_user("token-b"))
    assert_refusal(refused, 409, "is_copy")


def test_the_preview_works_signed_out_and_tells_only_the_title(share):
    exam = author_exam(share.fake)
    make_link(share, exam["exam"])
    response = share.post("/api/exam-shares/preview", json={"code": CODE.upper()}, headers={"Authorization": ""})
    assert response.status_code == 200
    body = response.json()
    assert body == {"status": "active", "title": "Макроэкономика", "kind": "exam", "exam_date": "2026-11-10",
                    "questions": 4, "lectures": 2}
    assert share.post("/api/exam-shares/preview", json={"code": "nope"}, headers={"Authorization": ""}).json() == {"status": "not_found"}
    assert share.post("/api/exam-shares/preview", content=b"{oops", headers={"Authorization": ""}).json() == {"status": "not_found"}
    own = share.post("/api/exam-shares/preview", json={"code": CODE}).json()
    assert own["status"] == "own" and own["exam_id"] == exam["exam"]
    copy_id = join(share).json()["exam_id"]
    joined = share.post("/api/exam-shares/preview", json={"code": CODE}, headers=as_user("token-b")).json()
    assert joined["status"] == "joined" and joined["exam_id"] == copy_id
    # Истёкший токен страницы — как без входа.
    stale = share.post("/api/exam-shares/preview", json={"code": CODE}, headers=as_user("token-expired"))
    assert stale.status_code == 200 and stale.json()["status"] == "active"


def test_join_needs_a_session(share):
    exam = author_exam(share.fake)
    make_link(share, exam["exam"])
    response = share.post("/api/exam-shares/join", json={"code": CODE}, headers={"Authorization": ""})
    assert response.status_code == 401
    assert share.fake.rpc_calls == []


# ── Отказ проверки цитат записывается ───────────────────────────────────────────


def test_points_that_fail_the_quote_check_twice_leave_a_failure_row(share, monkeypatch):
    monkeypatch.setattr(quota, "reserve", REAL_RESERVE)  # здесь пункты собирает модель — списание как обычно
    exam_id, question_id, material_id = test_oral_api.econ_exam(share.fake)
    points = econ_points()
    for point in points[1:]:
        point["source_quote"] = "Такой фразы в лекции нет совсем, модель её придумала"
    share.model.answer(rubric_answer(points), rubric_answer(points[:2]))
    response = share.post("/api/oral/rubric", json={"exam_id": exam_id, "question_id": question_id})
    assert response.status_code == 422 and response.json()["code"] == "rubric_unverifiable"
    question = share.fake.row("exam_questions", question_id)
    failures = share.fake.tables["oral_rubric_failures"]
    assert [(f["question_hash"], f["source_key"], f["user_id"]) for f in failures] == [
        (question["question_hash"], oral.rubric_key(question, [material_id]), "user-a")
    ]
    assert share.fake.tables["oral_rubrics"] == []


# ── Автор на своей ссылке ───────────────────────────────────────────────────────


def test_the_author_on_their_own_link_sees_whether_it_is_open_closed_or_expired(share):
    # Живой прогон 07.10: на закрытой ссылке автор читал «Однокурсники, которые по ней войдут…» — «own» в
    # exam_share_preview решается раньше отзыва. Своя строка ссылки читается токеном автора, без миграции.
    exam = author_exam(share.fake)
    link = make_link(share, exam["exam"])
    own = share.post("/api/exam-shares/preview", json={"code": CODE}).json()
    assert own["status"] == "own" and own["link"] == "active" and own["exam_id"] == exam["exam"]

    assert share.post(f"/api/exam-shares/{link['id']}/revoke").status_code == 200
    closed = share.post("/api/exam-shares/preview", json={"code": CODE}).json()
    assert closed["status"] == "own" and closed["link"] == "revoked" and closed["exam_id"] == exam["exam"]
    # Гостю и однокурснику — как раньше: ссылка закрыта, без названия экзамена и без поля link.
    assert share.post("/api/exam-shares/preview", json={"code": CODE}, headers={"Authorization": ""}).json() == {"status": "revoked"}
    assert share.post("/api/exam-shares/preview", json={"code": CODE}, headers=as_user("token-c")).json() == {"status": "revoked"}

    other = "pqrstvwxyz23"
    make_link(share, exam["exam"], code=other, expires_at="2026-01-05T09:00:00+00:00")
    expired = share.post("/api/exam-shares/preview", json={"code": other}).json()
    assert expired["status"] == "own" and expired["link"] == "expired"


def test_an_unreadable_own_link_row_leaves_the_state_unsaid(share):
    exam = author_exam(share.fake)
    make_link(share, exam["exam"])
    share.fake.fail[("GET", "exam_shares")] = 500
    own = share.post("/api/exam-shares/preview", json={"code": CODE})
    assert own.status_code == 200
    assert own.json()["status"] == "own" and "link" not in own.json()


# ── Шпаргалка автора: вопросы, которые записать нельзя ─────────────────────────


def test_the_authors_sheet_counts_only_what_can_still_be_written_and_names_the_rest(share):
    # Живой прогон 07.10: два вопроса, чьи пункты дважды не прошли проверку цитат, держали на листе автора
    # «2 вопроса — 2 единицы» навсегда, хотя ссылка группы уже считала их готовыми.
    from test_oral_sheet import events_of

    exam = author_exam(share.fake, failed=True)
    sheet = share.get(f"/api/oral/sheet?exam_id={exam['exam']}").json()
    assert (sheet["to_write"], sheet["units"], sheet["unwritable"]) == (0, 0, 1)
    fourth = next(q for q in sheet["questions"] if q["position"] == 4)
    assert fourth["unwritable"] is True and fourth["rubric"] is None and fourth["rebuilt"] is False
    assert [q["unwritable"] for q in sheet["questions"] if q["position"] != 4] == [False, False, False]
    # Ссылка группы читает ту же строку отказа и тоже считает вопрос готовым.
    assert share.get(f"/api/exam-shares?exam_id={exam['exam']}").json()["ready"] is True

    # Запуск записи его не пробует: ни эталона, ни списания (короткие строки готовых — без единиц).
    share.model.answer({})
    events = events_of(share.post("/api/oral/sheet/write", json={"exam_id": exam["exam"]}))
    done = events[-1]
    assert done["type"] == "done" and done["total"] == 0 and done["units"] == 0
    assert not [event for event in events if event["type"] == "question" and not event.get("refresh")]
    assert share.reserved == []

    # Без строки отказа (или с новыми лекциями — новым ключом) вопрос снова можно записать.
    share.fake.tables["oral_rubric_failures"].clear()
    again = share.get(f"/api/oral/sheet?exam_id={exam['exam']}").json()
    assert (again["to_write"], again["units"], again["unwritable"]) == (1, 1, 0)


def test_an_unreadable_failure_table_leaves_the_sheet_as_before(share):
    exam = author_exam(share.fake, failed=True)
    share.fake.fail[("GET", "oral_rubric_failures")] = 404
    sheet = share.get(f"/api/oral/sheet?exam_id={exam['exam']}")
    assert sheet.status_code == 200
    assert (sheet.json()["to_write"], sheet.json()["unwritable"]) == (1, 0)
