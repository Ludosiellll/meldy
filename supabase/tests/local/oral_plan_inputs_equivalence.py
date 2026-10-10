"""LOCAL ONLY; NEVER AGAINST THE LIVE PROJECT. The Space's side of the T11 equivalence (oral_plan_inputs_equivalence.sh).

Runs the backend's own code over a scratch PostgreSQL 16 cluster: the GET /api/oral/sheet path (oral_sheet._load_state +
_sheet_response, through supabase_rest.SupabaseRest) against a PostgREST stand-in, an httpx transport that turns each
request into the SQL PostgREST would run and runs it with psql as role authenticated with the user's JWT sub, so the
policies apply as they do for the site. Run with the backend venv and -I (only the backend directory is added to the path):

  python -I oral_plan_inputs_equivalence.py fixture DB       the synthetic fixture («Осенняя сессия», invented): users A
                                                             (author), B (member), X (stranger); exams, lectures, 20+
                                                             questions, rubrics, failures, journal events, containers,
                                                             links. Rubric keys come from the backend's oral.rubric_key
                                                             over the questions as the Space reads them.
  python -I oral_plan_inputs_equivalence.py sheets DB OUT    for every fixture exam and user: the Space's JSON vs
                                                             meldy_private.oral_sheet_for(user, exam); writes both to OUT
                                                             (the TS side feeds them to the cores).
  python -I oral_plan_inputs_equivalence.py fuzz DB N [SEED] py_str, oral_rubric_key, oral_clean_points and
                                                             oral_clean_materials against the backend's str(),
                                                             oral.rubric_key, _clean_points and _clean_materials on N
                                                             random JSON values (each round-tripped through jsonb, as
                                                             PostgREST hands them to the Space).
Prints one line per check (a difference with where it is); exits 1 when anything differs.
Environment: PGHOST, PGPORT, PGUSER (psql's), nothing else.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import random
import subprocess
import sys
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parents[2] / "backend"
sys.path.insert(0, str(BACKEND))
# Never a real project: the backend's client gets a local URL and a fake key, and every request goes to the stand-in.
os.environ["SUPABASE_URL"] = "http://postgrest.local"
os.environ["SUPABASE_KEY"] = "local-anon-key-not-real"

import httpx  # noqa: E402

import oral  # noqa: E402
import oral_sheet  # noqa: E402
import supabase_rest  # noqa: E402
from fastapi import HTTPException  # noqa: E402

FAILS: list[str] = []


def ok(name: str, detail: str = "") -> None:
    print(f"  ok    {name:<66} {detail}")


def fail(name: str, detail: str) -> None:
    print(f"  FAIL  {name:<66} {detail}")
    FAILS.append(name)


# ── psql ────────────────────────────────────────────────────────────────────────────────────────────────────────────────


def psql(db: str, script: str) -> str:
    """Runs a script with psql (-X -q -At, stop on error); returns its output."""
    result = subprocess.run(
        ["psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-d", db, "-f", "-"],
        input=script, capture_output=True, text=True, check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"psql failed: {result.stderr.strip()[:2000]}")
    return result.stdout


def lit(value: Any) -> str:
    """A SQL literal (text, or null)."""
    if value is None:
        return "null"
    return "'" + str(value).replace("'", "''") + "'"


def jlit(value: Any) -> str:
    return lit(json.dumps(value, ensure_ascii=False)) + "::jsonb"


def as_user(user_id: str, sql: str) -> str:
    """The script PostgREST runs for a signed-in user: role authenticated, the JWT's sub, then the query."""
    return (
        "begin;\nset local role authenticated;\n"
        f"select set_config('request.jwt.claim.sub', {lit(user_id)}, true) \\g /dev/null\n"
        f"{sql};\ncommit;\n"
    )


# ── a PostgREST stand-in for supabase_rest.SupabaseRest ────────────────────────────────────────────────────────────────


def ident(name: str) -> str:
    if not name.replace("_", "").isalnum():
        raise ValueError(f"bad name {name!r}")
    return '"' + name + '"'


def select_sql(table: str, params: list[tuple[str, str]]) -> str:
    """GET /rest/v1/<table>?select=…&col=op.value&order=…&limit=…&offset=… as PostgREST's SQL (json_agg of the rows)."""
    columns: list[str] = []
    where: list[str] = []
    order: list[str] = []
    limit = offset = None
    for key, value in params:
        if key == "select":
            for item in value.split(","):
                item = item.strip()
                alias, _, expr = item.partition(":") if ":" in item else (item, "", item)
                parts = expr.split("->")
                sql = ident(parts[0]) + "".join(f"->{lit(p)}" for p in parts[1:])
                columns.append(f"{sql} as {ident(alias)}")
        elif key == "order":
            for item in value.split(","):
                name, *flags = item.split(".")
                order.append(ident(name) + (" desc" if "desc" in flags else " asc"))
        elif key == "limit":
            limit = int(value)
        elif key == "offset":
            offset = int(value)
        else:
            op, _, arg = value.partition(".")
            if op == "eq":
                where.append(f"{ident(key)} = {lit(arg)}")
            elif op == "in":
                items = arg[1:-1].split(",") if arg.startswith("(") and arg.endswith(")") else []
                where.append(f"{ident(key)} in ({', '.join(lit(i) for i in items) or 'null'})")
            else:
                raise ValueError(f"unsupported filter {key}={value}")
    sql = f"select {', '.join(columns) or '*'} from public.{ident(table)}"
    if where:
        sql += " where " + " and ".join(where)
    if order:
        sql += " order by " + ", ".join(order)
    if limit is not None:
        sql += f" limit {limit}"
    if offset is not None:
        sql += f" offset {offset}"
    return f"select coalesce(json_agg(t), '[]'::json) from ({sql}) t"


class PostgrestStandIn:
    """httpx transport: every GET becomes psql as the bearer's user (the bearer token IS the user id here)."""

    def __init__(self, db: str) -> None:
        self.db = db
        self.requests: list[str] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        if request.method != "GET":
            return httpx.Response(405, json={"code": "PGRST105", "message": "read only"})
        table = request.url.path.rsplit("/", 1)[-1]
        params = parse_qsl(request.url.query.decode(), keep_blank_values=True)
        user_id = request.headers["Authorization"].split(" ", 1)[1]
        self.requests.append(table)
        out = psql(self.db, as_user(user_id, select_sql(table, params))).strip()
        return httpx.Response(200, content=out.encode(), headers={"Content-Type": "application/json"})


async def space_sheet(db: str, exam_id: str, user_id: str) -> tuple[dict | None, int | None]:
    """The Space's GET /api/oral/sheet body for this user and exam: (json, None) or (None, HTTP status)."""
    stand_in = PostgrestStandIn(db)
    supabase_rest._transport = httpx.MockTransport(stand_in)
    try:
        async with supabase_rest.SupabaseRest(user_id) as rest:
            state = await oral_sheet._load_state(rest, exam_id, user_id)
        return oral_sheet._sheet_response(exam_id, state, None), None
    except HTTPException as exc:
        return None, exc.status_code
    finally:
        supabase_rest._transport = None


def sql_sheet(db: str, exam_id: str, user_id: str) -> tuple[dict | None, str | None]:
    """meldy_private.oral_sheet_for(user, exam): (json, None) or (None, SQLSTATE)."""
    script = (
        "\\set VERBOSITY verbose\n"
        f"select meldy_private.oral_sheet_for({lit(user_id)}::uuid, {lit(exam_id)}::uuid);\n"
    )
    result = subprocess.run(["psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-d", db, "-f", "-"],
                            input=script, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        state = next((part.split()[0] for part in result.stderr.split("ERROR:")[1:]), "?")
        return None, state.rstrip(":")
    return json.loads(result.stdout), None


# ── the fixture ─────────────────────────────────────────────────────────────────────────────────────────────────────────

A = "a1000000-0000-4000-8000-000000000001"
B = "b1000000-0000-4000-8000-000000000002"
X = "c1000000-0000-4000-8000-000000000003"


def uid(label: str) -> str:
    """A fixed UUID per fixture label."""
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "meldy-t11:" + label))


def fake_key(label: str) -> str:
    return hashlib.sha256(("other-key:" + label).encode()).hexdigest()[:40]


E1, E2, E3, E4, EB, EX = (uid(n) for n in ("E1", "E2", "E3", "E4", "EB", "EX"))
M1, M2, M3, MB, MX = (uid(n) for n in ("M1", "M2", "M3", "MB", "MX"))
C1, C2 = uid("C1"), uid("C2")
S1, S2, S3, S4 = (uid(n) for n in ("S1", "S2", "S3", "S4"))

# The questions of E1: text, coverage, method, fingerprint, evidence; a shared text gives a shared hash.
ELASTIC = "Что такое эластичность спроса по цене и от чего она зависит?"
COSTS = "Постоянные и переменные издержки фирмы: примеры и график"
Q = [
    # n, position, created offset (s), label, section, text, coverage, method, fingerprint, evidence
    (1, 1, 0, "1", 1, "Рыночное равновесие: как оно устанавливается?", "full", "llm", "fp:v1:aaa",
     [{"material_id": M1, "source_id": "S1"}, {"material_id": M1, "source_id": "S2"}]),
    (2, 2, 0, "2", 1, "Закон спроса и его исключения", "full", "llm", None, [{"material_id": M2, "source_id": "S5"}]),
    (3, 3, 0, "3.", 1, ELASTIC, "partial", "llm", "fp:v1:bbb", [{"material_id": M1, "source_id": "S7"}]),
    (4, 4, 0, "4)", 1, "Функции денег в экономике", "full", "lexical", None, [{"material_id": M2, "source_id": "S9"}]),
    (5, 5, 0, "", 1, COSTS, "full", "llm", None, [{"material_id": M1, "source_id": "S11"}]),
    (6, 6, 0, "6", 1, "Монополия и монопсония: различия", "partial", "manual", "fp:v1:ccc", []),
    (7, 7, 0, "7", 2, "Теория игр в олигополии", "none", "llm", None, []),
    (8, 8, 0, "8", 2, "Кривая Лоренца и коэффициент Джини", "unverified", "lexical", None, []),
    (9, 9, 0, "9", 2, "Инфляция спроса и инфляция издержек", None, None, None, []),
    (10, 10, 0, "10", 2, "Внешние эффекты и теорема Коуза", "full", "llm", None, [{"material_id": M2, "source_id": "S3"}]),
    (11, 11, 0, "11", 2, "Ценовая дискриминация третьей степени", "full", "llm", None, [{"material_id": M1, "source_id": "S4"}]),
    (12, 12, 0, "12а", 2, "Спрос на труд: предельный продукт в денежном выражении", "full", "llm", "fp:v1:ddd",
     [{"material_id": M2, "source_id": "S8"}]),
    (13, 13, 0, "13", 2, ELASTIC, "full", "llm", "fp:v1:eee", [{"material_id": M2, "source_id": "S2"}]),
    (14, 14, 0, "14", None, COSTS, "full", "llm", None, [{"material_id": M1, "source_id": "S11"}]),
    (15, 15, 0, "15", None, "Предельная полезность и равновесие потребителя", "full", "llm", None,
     [{"material_id": M1, "source_id": "S6"}]),
    (16, 16, 0, "16", None, "Ставка процента и инвестиции", "full", "llm", None, [{"material_id": M2, "source_id": "S1"}]),
    (17, 17, 0, "17", None, "Безработица: виды и измерение", "partial", "llm", None, [{"material_id": M2, "source_id": "S4"}]),
    # Evidence the Space reads with str(): a number, true, a list, a non-object item, empty values, a repeat.
    (18, 18, 0, "18", None, "Фискальная политика и мультипликатор", "full", "llm", None,
     [{"material_id": 5, "source_id": "S1"}, {"material_id": True, "source_id": [1, "a"]}, "S2", {"material_id": "", "source_id": "S3"},
      {"material_id": M1, "source_id": 2.50}, {"material_id": M1, "source_id": "S12"}, {"material_id": M1, "source_id": "S12"}]),
    (19, 19, 5, "19", None, "Денежно-кредитная политика центрального банка", "full", "llm", None,
     [{"material_id": M2, "source_id": "S10"}]),
    # Same position as 19, created earlier: comes first.
    (20, 19, 0, "20", None, "Платёжный баланс и валютный курс", "full", "llm", None, [{"material_id": M1, "source_id": "S13"}]),
]

E1_LECTURES = [M1, M2]


def point(pid: Any, title: Any, essential: Any = False, quote: Any = "цитата из лекции", ids: Any = None) -> dict:
    return {"id": pid, "title": title, "essential": essential, "source_quote": quote,
            "source_ids": ids if ids is not None else ["M1:S1"], "anchors": [["рын"]], "followup": {"question": "?"}}


def materials(*ids: str) -> list[dict]:
    return [{"key": f"M{i + 1}", "material_id": mid, "title": f"Лекция {i + 1}"} for i, mid in enumerate(ids)]


def rubric(points: Any, coverage: Any = "full", mats: Any = None, note: Any = "") -> dict:
    return {"coverage": coverage, "coverage_note": note, "points": points,
            "materials": mats if mats is not None else materials(M1, M2)}


def sheet_for(created_at: str, shorts: dict) -> dict:
    return {"v": 1, "for": created_at, "short": shorts, "tried": {}}


def at(day: int, hour: int, minute: int = 0, second: float = 0) -> str:
    """A moment of December 2026 (UTC) in PostgREST's format."""
    whole = int(second)
    micro = round((second - whole) * 1_000_000)
    return f"2026-12-{day:02d}T{hour:02d}:{minute:02d}:{whole:02d}" + (f".{micro:06d}" if micro else "") + "+00:00"


def fixture_base_sql() -> str:
    users = [A, B, X]
    lines = [
        "set session_replication_role = replica;",  # the journal's trigger would replace created_at / local_date
        "insert into auth.users (id) values " + ", ".join(f"({lit(u)})" for u in users) + " on conflict do nothing;",
    ]
    mats = [(M1, A, "Лекция 1. Спрос и предложение"), (M2, A, "Лекция 2. Фирма и рынок"), (M3, A, "Лекция 3. Другой курс"),
            (MB, B, "Лекция 1 (копия)"), (MX, X, "Чужая лекция")]
    lines.append("insert into public.materials (id, user_id, title, original_text) values "
                 + ", ".join(f"({lit(m)}, {lit(u)}, {lit(t)}, 'текст лекции')" for m, u, t in mats) + ";")
    exams = [(E1, A, "Экономика", "2026-12-23", "done"), (E2, A, "Экономика (старый список)", None, "done"),
             (E3, A, "История", None, "none"), (E4, A, "Большой список", "2027-01-20", "partial"),
             (EB, B, "Экономика", "2026-12-24", "done"), (EX, X, "Чужой экзамен", None, "done")]
    lines.append("insert into public.exams (id, user_id, title, exam_date, mapping_state) values "
                 + ", ".join(f"({lit(e)}, {lit(u)}, {lit(t)}, {lit(d)}::date, {lit(s)})" for e, u, t, d, s in exams) + ";")
    em = [(E1, M1, A, at(1, 9)), (E1, M2, A, at(1, 9, 0, 1)), (E2, M3, A, at(1, 9)), (EB, MB, B, at(2, 9)), (EX, MX, X, at(1, 9))]
    lines.append("insert into public.exam_materials (exam_id, material_id, user_id, added_at) values "
                 + ", ".join(f"({lit(e)}, {lit(m)}, {lit(u)}, {lit(t)})" for e, m, u, t in em) + ";")
    rows = []
    for n, pos, offset, label, section, text, coverage, method, fp, evidence in Q:
        rows.append(f"({lit(uid(f'E1Q{n}'))}, {lit(E1)}, {lit(A)}, {pos}, {lit(label)}, {lit(section)}::smallint, {lit(text)}, "
                    f"{lit(coverage)}, {lit(method)}, {lit('Есть в лекциях' if coverage else '')}, "
                    f"{lit('не хватает примеров' if coverage == 'partial' else '')}, {jlit(evidence)}, {lit(fp)}, "
                    f"{lit(at(1, 10, 0, offset))})")
    # E2: the same text as E1's question 1 (another exam, other lectures); E3: three questions, no lectures.
    rows.append(f"({lit(uid('E2Q1'))}, {lit(E2)}, {lit(A)}, 1, '', null, {lit(Q[0][5])}, 'full', 'llm', '', '', "
                f"{jlit([{'material_id': M3, 'source_id': 'S1'}])}, null, {lit(at(1, 11))})")
    for n in range(1, 4):
        rows.append(f"({lit(uid(f'E3Q{n}'))}, {lit(E3)}, {lit(A)}, {n}, '', null, {lit(f'Реформы и контрреформы, часть {n}')}, "
                    f"null, null, '', '', '[]'::jsonb, null, {lit(at(1, 12))})")
    # EB: the member's copy (its own rows, the member's own rubric).
    for n in (1, 2, 13):
        _, pos, _, label, section, text, coverage, method, fp, _ = Q[n - 1]
        rows.append(f"({lit(uid(f'EBQ{n}'))}, {lit(EB)}, {lit(B)}, {pos}, {lit(label)}, {lit(section)}::smallint, {lit(text)}, "
                    f"{lit(coverage)}, {lit(method)}, '', '', {jlit([{'material_id': MB, 'source_id': 'S1'}])}, {lit(fp)}, "
                    f"{lit(at(2, 10))})")
    rows.append(f"({lit(uid('EXQ1'))}, {lit(EX)}, {lit(X)}, 1, '', null, {lit(Q[0][5])}, 'full', 'llm', '', '', '[]'::jsonb, null, "
                f"{lit(at(1, 10))})")
    lines.append("insert into public.exam_questions (id, exam_id, user_id, position, label, section, text, coverage, coverage_method, "
                 "coverage_reason, missing_note, evidence, materials_fingerprint, created_at) values\n  " + ",\n  ".join(rows) + ";")
    # E4: 301 questions (more than the bot reads for a part).
    lines.append(f"insert into public.exam_questions (exam_id, user_id, position, text, created_at) "
                 f"select {lit(E4)}, {lit(A)}, least(g, 300), 'Вопрос большого списка № ' || g, {lit(at(1, 13))}::timestamptz + g * interval '1 second' "
                 f"from generate_series(1, 301) g;")
    # The containers: C1 (A's) with Экономика (oral E1), Право (no oral), История (oral E3); B joined C1 and bound EB.
    lines += [
        f"insert into public.containers (id, owner_id, title, exam_date, created_at) values ({lit(C1)}, {lit(A)}, 'Осенняя сессия', '2026-12-24', {lit(at(1, 8))}),"
        f" ({lit(C2)}, {lit(A)}, 'Зимняя сессия', '2027-01-20', {lit(at(2, 8))});",
        f"insert into public.container_subjects (id, container_id, owner_id, position, title, exam_date, exam_id, created_at) values "
        f"({lit(S1)}, {lit(C1)}, {lit(A)}, 1, 'Экономика', null, {lit(E1)}, {lit(at(1, 8))}), "
        f"({lit(S2)}, {lit(C1)}, {lit(A)}, 2, 'Право', '2026-12-26', null, {lit(at(1, 8))}), "
        f"({lit(S3)}, {lit(C1)}, {lit(A)}, 3, 'История', null, {lit(E3)}, {lit(at(1, 8))}), "
        f"({lit(S4)}, {lit(C2)}, {lit(A)}, 1, 'Большой список', null, {lit(E4)}, {lit(at(2, 8))});",
        f"insert into public.container_members (container_id, user_id, joined_at) values ({lit(C1)}, {lit(B)}, {lit(at(2, 9))});",
        f"insert into public.container_member_exams (container_id, subject_id, user_id, exam_id) values ({lit(C1)}, {lit(S1)}, {lit(B)}, {lit(EB)});",
        "insert into bot.links (user_id, tg_user_id, chat_id, tz) values "
        f"({lit(A)}, 70001, 70001, 'Europe/Minsk'), ({lit(B)}, 70002, 70002, 'Asia/Vladivostok');",
        "set session_replication_role = origin;",
    ]
    return "\n".join(lines) + "\n"


def space_questions(db: str, exam_id: str, user_id: str) -> list[dict]:
    """The exam's questions and lectures as the Space reads them (the same stand-in), with their rubric keys."""
    stand_in = PostgrestStandIn(db)
    supabase_rest._transport = httpx.MockTransport(stand_in)

    async def read() -> tuple[list[dict], list[str]]:
        async with supabase_rest.SupabaseRest(user_id) as rest:
            questions = await oral_sheet._select_pages(rest, "exam_questions", {
                "select": oral_sheet._QUESTION_COLUMNS, "exam_id": f"eq.{exam_id}", "order": "position.asc,created_at.asc,id.asc"})
            lectures = await oral_sheet.oral_api._exam_material_ids(rest, exam_id)
        return questions, lectures

    try:
        questions, lectures = asyncio.run(read())
    finally:
        supabase_rest._transport = None
    for question in questions:
        question["key"] = oral.rubric_key(question, lectures)
    return questions


def fixture_rubrics_sql(db: str) -> str:
    """Rubric rows, failures and journal events, keyed by what the Space computes for the stored questions."""
    e1 = {q["id"]: q for q in space_questions(db, E1, A)}
    eb = {q["id"]: q for q in space_questions(db, EB, B)}
    e2 = {q["id"]: q for q in space_questions(db, E2, A)}
    q = lambda n: e1[uid(f"E1Q{n}")]  # noqa: E731
    rows: list[str] = []

    def add(label: str, user: str, question: dict, key: str, body: dict, created: str, sheet: Any = None,
            version: int = 1, material: str = M1) -> str:
        rid = uid("R:" + label)
        rows.append(f"({lit(rid)}, {lit(user)}, {lit(question['question_hash'])}, {lit(key)}, {lit(material)}, {lit(question['text'])}, "
                    f"{jlit(body)}, {version}, {lit(created)}, {jlit(sheet) if sheet is not None else 'null'})")
        return rid

    r1_at = at(5, 10, 0, 0.123456)
    r = {}
    r[1] = add("q1", A, q(1), q(1)["key"], rubric([
        point("p1", "Равновесие — точка, где спрос равен предложению", True, ids=["M1:S1", "M1:S2", 7, "bad"]),
        point("p2", "Избыток или дефицит сдвигает цену к равновесию"),
        point("p3", "Равновесная цена уравнивает объёмы спроса и предложения")]), r1_at,
        sheet_for(r1_at, {"p1": "равновесие:  спрос = предложение", "p2": " избыток\u00a0или дефицит → цена ", "p9": "лишнее"}))
    r[2] = add("q2", A, q(2), q(2)["key"], rubric([point("p1", "Спрос падает с ростом цены"), point("p2", "Товары Гиффена — исключение")]),
               at(5, 11))
    r[3] = add("q3", A, q(3), q(3)["key"], rubric([
        point("p1", "Эластичность — отношение процентных изменений", True),
        point("p2", "Зависит от наличия заменителей", True),
        point("p2", "Повтор пункта p2 не попадает в лист"),
        point("p7", "Пункт с чужим номером"),
        point("p3", "   "),
        point("p4", "\u3000\u2003"),
        point("p5", "\ufeffТолько знак BOM в начале"),
        point("p6\n", "Номер с переводом строки в конце"),
        "не объект",
        point("p3", "Доля расходов на товар", "true", 12, "M1:S7"),
    ], coverage="partial", note="В лекции нет примеров"), at(5, 12))
    # 4: the current row is not usable (an unknown coverage); a usable row with points by another key, built only from
    #    this exam's lectures: rebuilt.
    add("q4-bad", A, q(4), q(4)["key"], rubric([point("p1", "Деньги — мера стоимости")], coverage="maybe"), at(5, 13))
    add("q4-other", A, q(4), fake_key("q4"), rubric([point("p1", "Деньги — средство обращения")], mats=materials(M1, M2)), at(4, 13))
    # 5 and 14 (one text, one key): no current row; a row by another key from other lectures (M3): not rebuilt.
    add("q5-other", A, q(5), fake_key("q5"), rubric([point("p1", "Постоянные не зависят от объёма")], mats=materials(M3)), at(4, 14))
    # 6: a failure by its key: unwritable.
    # 10: the rubric says the lectures have nothing: no lines (a gap on the sheet).
    r[10] = add("q10", A, q(10), q(10)["key"], rubric([], coverage="none", note="В лекциях нет"), at(5, 14))
    # 11: points is not a list: not usable; no other row: to write.
    add("q11", A, q(11), q(11)["key"], rubric({"p1": "не список"}), at(5, 15))
    # 12: lectures with a number, an empty key, a non-object; the sheet record of another version.
    r[12] = add("q12", A, q(12), q(12)["key"], rubric([point("p1", "Спрос на труд — производный", True)],
                mats=[{"key": "M1", "material_id": M1, "title": "Лекция 1"}, {"key": "", "material_id": 42, "title": None},
                      {"material_id": M2}, "M3", {"key": "M9", "material_id": [], "title": 0.5}]),
                at(5, 16), sheet_for(at(5, 15), {"p1": "спрос на труд"}))
    r[13] = add("q13", A, q(13), q(13)["key"], rubric([point("p1", "Эластичность больше единицы — спрос эластичен", True),
                                                       point("p2", "Эластичность меньше единицы — неэластичен", True)]), at(6, 10))
    # 15: two points with the same words (twins): told apart by their ids.
    r[15] = add("q15", A, q(15), q(15)["key"], rubric([point("p1", "Полезность убывает"), point("p2", "Полезность убывает!"),
                                                       point("p3", "Равновесие: MU/P равны", True)]), at(6, 11))
    # 16: a short line the Space's check refuses (a word that is not in the title) and one it keeps.
    r16_at = at(6, 12)
    r[16] = add("q16", A, q(16), q(16)["key"], rubric([point("p1", "Рост ставки снижает инвестиции", True),
                                                       point("p2", "Инвестиции зависят от ожидаемой доходности")]),
                r16_at, sheet_for(r16_at, {"p1": "ставка ↑ → инвестиции ↓", "p2": "инвестиции и ВВП"}))
    r[17] = add("q17", A, q(17), q(17)["key"], rubric([point("p1", "Фрикционная безработица", True)], coverage="partial", mats=[]),
                at(6, 13))
    r[18] = add("q18", A, q(18), q(18)["key"], rubric([point("p1", "Мультипликатор госрасходов больше единицы", True)]), at(6, 14))
    r[19] = add("q19", A, q(19), q(19)["key"], rubric([point("p1", "Ставка рефинансирования", True)]), at(6, 15))
    r[20] = add("q20", A, q(20), q(20)["key"], rubric([point("p1", "Курс уравновешивает платёжный баланс", True)]), at(6, 16))
    # Rows nobody may see or use: another user's (same hashes and keys), another version, another exam's lectures.
    add("x-q1", X, q(1), q(1)["key"], rubric([point("p1", "Чужой пункт")]), at(5, 10), material=MX)
    add("x-q5", X, q(5), q(5)["key"], rubric([point("p1", "Чужой пункт")]), at(5, 10), material=MX)
    add("a-q2-v2", A, q(2), q(2)["key"], rubric([point("p1", "Другая версия")]), at(5, 10), version=2)
    e2q = e2[uid("E2Q1")]
    add("e2-q1", A, e2q, e2q["key"], rubric([point("p1", "Равновесие в старом списке")], mats=materials(M3)), at(3, 10), material=M3)
    # The member's copy: B's own rubric rows.
    for n in (1, 13):
        bq = eb[uid(f"EBQ{n}")]
        r[f"b{n}"] = add(f"b-q{n}", B, bq, bq["key"], rubric([point("p1", f"Пункт копии {n}", True), point("p2", "Второй пункт")],
                                                            mats=materials(MB)), at(7, 10), material=MB)

    lines = ["set session_replication_role = replica;",
             "insert into public.oral_rubrics (id, user_id, question_hash, source_key, material_id, question, rubric, rubric_version, "
             "created_at, sheet) values\n  " + ",\n  ".join(rows) + ";",
             "insert into public.oral_rubric_failures (user_id, question_hash, source_key) values "
             f"({lit(A)}, {lit(q(6)['question_hash'])}, {lit(q(6)['key'])}), "
             f"({lit(A)}, {lit(q(11)['question_hash'])}, {lit(fake_key('q11-old'))}), "
             f"({lit(X)}, {lit(q(5)['question_hash'])}, {lit(q(5)['key'])});"]

    # ── the journal ──
    events: list[str] = []
    seq = [0]

    def ev(user: str, kind: str, item_key: str, created: str, local: str, payload: dict, correct: Any = None,
           confidence: Any = None, session: str | None = None, score: Any = None, source_ids: Any = None,
           material: str | None = None, eid: str | None = None) -> None:
        seq[0] += 1
        event_id = eid or uid(f"ev{seq[0]}")
        events.append(f"({lit(event_id)}, {lit(user)}, {lit(created)}, {lit(local)}::date, {lit(material)}, {lit(kind)}, {lit(item_key)}, "
                      f"{lit(correct)}::boolean, {lit(score)}::real, {lit(confidence)}::smallint, "
                      f"{lit(source_ids) if source_ids is not None else 'default'}, {lit(session)}::uuid, {lit('fx-' + event_id)}, {jlit(payload)})")

    def named(user: str, question: dict, rid: str, pid: str, title: Any, created: str, local: str, status: str = "covered",
              correct: Any = True, session: str | None = None, followup: str | None = None, **extra: Any) -> None:
        payload = {"question_hash": question["question_hash"], "rubric_id": rid, "point_id": pid, "status": status}
        if title is not None:
            payload["title"] = title
        if followup:
            payload["followup_status"] = followup
        ev(user, "oral_point", f"oral:{rid}:{pid}", created, local, payload, correct=correct,
           session=session or uid(f"session:{created}"), **extra)

    def peek(user: str, question: dict, rid: str, pid: str, title: str, created: str, local: str) -> None:
        ev(user, "sheet_peek", f"peek:{rid}:{pid}", created, local,
           {"v": 1, "question_hash": question["question_hash"], "rubric_id": rid, "point_id": pid, "title": title, "exam_id": E1})

    def rated(user: str, question: dict, kind: str, created: str, local: str, confidence: Any = None, correct: Any = None,
              score: Any = None) -> None:
        ev(user, kind, f"q:{question['question_hash']}", created, local, {"v": 1, "grade": 5 if correct else 2}, correct=correct,
           confidence=confidence, score=score)

    # Q1: p1 named on two days 23 h apart (erased), then a check five days on; p2 missed, then named twice the same day;
    #     p3 partial («упомянут»), wrong, then named after the examiner's question (not recalled alone); an unrated one.
    named(A, q(1), r[1], "p1", "Равновесие — точка, где спрос равен предложению", at(8, 10), "2026-12-08")
    named(A, q(1), r[1], "p1", "Равновесие — точка, где спрос равен предложению", at(9, 9), "2026-12-09")
    named(A, q(1), r[1], "p1", "РАВНОВЕСИЕ: точка, где спрос равен предложению!", at(15, 12), "2026-12-15")
    named(A, q(1), r[1], "p2", "Избыток или дефицит сдвигает цену к равновесию", at(8, 10), "2026-12-08", status="missing", correct=False)
    named(A, q(1), r[1], "p2", "Избыток или дефицит сдвигает цену к равновесию", at(16, 10), "2026-12-16")
    named(A, q(1), r[1], "p2", "Избыток или дефицит сдвигает цену к равновесию", at(16, 18), "2026-12-16")
    named(A, q(1), r[1], "p3", "Равновесная цена уравнивает объёмы спроса и предложения", at(8, 10), "2026-12-08", status="partial", correct=False)
    named(A, q(1), r[1], "p3", "Равновесная цена уравнивает объёмы спроса и предложения", at(10, 10), "2026-12-10", status="wrong", correct=False)
    named(A, q(1), r[1], "p3", "Равновесная цена уравнивает объёмы спроса и предложения", at(11, 10), "2026-12-11", status="missing",
          followup="covered", correct=True)
    named(A, q(1), r[1], "p3", "Равновесная цена уравнивает объёмы спроса и предложения", at(12, 10), "2026-12-12", status="covered", correct=None)
    # Q2 (no essential point): p1 named the evening of 12-19 (Minsk) and the morning of 12-20; p2 missed, peeked on 12-21
    #     and named that day after the peek (a peek day); a peek on 12-22 (the user's «today» in some runs).
    named(A, q(2), r[2], "p1", "Спрос падает с ростом цены", at(19, 19, 30), "2026-12-19")
    named(A, q(2), r[2], "p1", "Спрос падает с ростом цены", at(20, 17, 45), "2026-12-20")
    named(A, q(2), r[2], "p2", "Товары Гиффена — исключение", at(18, 10), "2026-12-18", status="missing", correct=False)
    peek(A, q(2), r[2], "p2", "Товары Гиффена — исключение", at(21, 8), "2026-12-21")
    named(A, q(2), r[2], "p2", "Товары Гиффена — исключение", at(21, 9), "2026-12-21")
    peek(A, q(2), r[2], "p1", "Спрос падает с ростом цены", at(21, 22, 30), "2026-12-22")
    # Q3: the essential points; an event of the old rubric id with the same words (carried across rebuilds).
    named(A, q(3), uid("R:q3-old"), "p1", "Эластичность — отношение процентных изменений", at(3, 10), "2026-12-03")
    named(A, q(3), r[3], "p1", "Эластичность — отношение процентных изменений", at(13, 10), "2026-12-13")
    named(A, q(3), r[3], "p2", "Зависит от наличия заменителей", at(13, 10), "2026-12-13", status="partial", correct=False)
    # Without words: matched by item_key (oral:<rubric>:<point>).
    named(A, q(3), r[3], "p2", None, at(14, 10), "2026-12-14")
    # Q13 (same text as Q3, another key): its own rows; the hash is shared, so Q3's events are offered to it too.
    named(A, q(13), r[13], "p1", "Эластичность больше единицы — спрос эластичен", at(17, 10), "2026-12-17")
    named(A, q(13), r[13], "p1", "Эластичность больше единицы — спрос эластичен", at(18, 7), "2026-12-18")
    # Q15 twins: one answer names both twins; the line keeps its own point's event.
    s15 = uid("s15")
    named(A, q(15), r[15], "p1", "Полезность убывает", at(14, 10, 0, 0.5), "2026-12-14", session=s15)
    named(A, q(15), r[15], "p2", "Полезность убывает!", at(14, 10, 0, 0.5), "2026-12-14", status="missing", correct=False, session=s15)
    named(A, q(15), r[15], "p3", "Равновесие: MU/P равны", at(14, 10, 0, 0.5004), "2026-12-14", session=s15)
    named(A, q(15), r[15], "p3", "Равновесие: MU/P равны", at(14, 10, 0, 0.5009), "2026-12-14", session=uid("s15b"))
    # Q16 / Q19 / Q20: erased lines due near the exam (the last days before it check a line not named for 4 days).
    named(A, q(16), r[16], "p1", "Рост ставки снижает инвестиции", at(10, 10), "2026-12-10")
    named(A, q(16), r[16], "p1", "Рост ставки снижает инвестиции", at(11, 12), "2026-12-11")
    named(A, q(16), r[16], "p1", "Рост ставки снижает инвестиции", at(17, 12), "2026-12-17")
    named(A, q(19), r[19], "p1", "Ставка рефинансирования", at(12, 10), "2026-12-12")
    named(A, q(19), r[19], "p1", "Ставка рефинансирования", at(13, 9), "2026-12-13")
    named(A, q(20), r[20], "p1", "Курс уравновешивает платёжный баланс", at(19, 8), "2026-12-19")
    named(A, q(20), r[20], "p1", "Курс уравновешивает платёжный баланс", at(20, 7, 59), "2026-12-20")
    # Ties: the same created_at for two events (ordered by id), and the same millisecond.
    tie = at(17, 9, 0, 0.25)
    named(A, q(18), r[18], "p1", "Мультипликатор госрасходов больше единицы", tie, "2026-12-17", eid="00000000-0000-4000-8000-0000000000f2")
    named(A, q(18), r[18], "p1", "Мультипликатор госрасходов больше единицы", tie, "2026-12-17", status="missing", correct=False,
          eid="00000000-0000-4000-8000-0000000000f1")
    # Self-checks and AI checks; extra kinds the plan never reads; another user's event; an event of a hash not on the sheet.
    rated(A, q(1), "self_rating", at(18, 10), "2026-12-18", confidence=2)
    rated(A, q(1), "self_rating", at(19, 10), "2026-12-19", confidence=3)
    rated(A, q(1), "exam_answer", at(20, 12), "2026-12-20", correct=True, score=0.875)
    rated(A, q(1), "exam_answer", at(20, 12), "2026-12-20", correct=False, score=0.123456789)
    rated(A, q(4), "self_rating", at(17, 10), "2026-12-17", confidence=1)
    rated(A, q(5), "exam_answer", at(16, 10), "2026-12-16", correct=None)
    rated(A, q(7), "self_rating", at(16, 10), "2026-12-16", confidence=3)  # a gap: not in the plan
    rated(A, q(9), "exam_answer", at(16, 10), "2026-12-16", correct=True)   # unmapped: not in the plan
    rated(A, q(3), "self_rating", at(15, 10), "2026-12-15", confidence=2)
    rated(A, q(3), "self_rating", at(15, 11), "2026-12-15", confidence=None)
    ev(A, "quiz_answer", f"q:{q(1)['question_hash']}", at(15, 10), "2026-12-15", {"v": 1}, correct=True)
    ev(A, "card_review", "card:1", at(15, 10), "2026-12-15", {"v": 1}, score=0.5, source_ids="{S1,NULL,S2}", material=M1)
    ev(X, "self_rating", f"q:{q(1)['question_hash']}", at(20, 10), "2026-12-20", {"v": 1}, confidence=1)
    named(X, q(1), r[1], "p1", "Равновесие — точка, где спрос равен предложению", at(20, 10), "2026-12-20")
    named(A, e2q, uid("R:e2-q1"), "p1", "Равновесие в старом списке", at(20, 10), "2026-12-20")
    # The member's copy: B's own events.
    for n in (1, 13):
        bq = eb[uid(f"EBQ{n}")]
        named(B, bq, r[f"b{n}"], "p1", f"Пункт копии {n}", at(15, 2), "2026-12-15")
        named(B, bq, r[f"b{n}"], "p1", f"Пункт копии {n}", at(16, 3), "2026-12-16")
        rated(B, bq, "self_rating", at(17, 3), "2026-12-17", confidence=3)
    lines.append("insert into public.learning_events (id, user_id, created_at, local_date, material_id, kind, item_key, correct, score, "
                 "confidence, source_ids, session_id, client_event_id, payload) values\n  " + ",\n  ".join(events) + ";")
    lines.append("set session_replication_role = origin;")
    return "\n".join(lines) + "\n"


def cmd_fixture(db: str) -> None:
    psql(db, fixture_base_sql())
    psql(db, fixture_rubrics_sql(db))
    # Test questions in «Право» (the author adds them as the site does): the plan shares one budget between them and
    # the oral questions; «Экономика» stays oral-only (its oral exam's date then leads its plan).
    items = [{"ref": f"law-{n}", "stem": f"Норма права № {n}: что верно?", "options": ["первое", "второе", "третье", "четвёртое"],
              "correct": [n % 4], "topic": 1 + n % 3} for n in range(1, 41)]
    psql(db, as_user(A, f"select public.container_items_add({lit(S2)}, {jlit(items)}) \\g /dev/null\nselect 1"))
    counts = psql(db, "select (select count(*) from public.exam_questions) || ' questions, ' || (select count(*) from public.test_items)"
                      " || ' test items, ' || (select count(*) from public.oral_rubrics)"
                      " || ' rubric rows, ' || (select count(*) from public.oral_rubric_failures) || ' failures, '"
                      " || (select count(*) from public.learning_events) || ' journal events, ' || (select count(distinct kind) from public.learning_events)"
                      " || ' kinds';").strip()
    ok("fixture loaded", counts)


# ── the sheets ──────────────────────────────────────────────────────────────────────────────────────────────────────────

SHEET_CASES = [(A, E1), (A, E2), (A, E3), (B, EB), (A, E4)]
DENIED_CASES = [(A, EX), (B, E1), (X, E1), (A, uid("missing"))]


def first_difference(left: Any, right: Any, path: str = "$") -> str | None:
    if type(left) is not type(right) and not (isinstance(left, (int, float)) and isinstance(right, (int, float))
                                               and not isinstance(left, bool) and not isinstance(right, bool)):
        return f"{path}: {left!r} vs {right!r}"
    if isinstance(left, dict):
        if set(left) != set(right):
            return f"{path}: keys {sorted(set(left) ^ set(right))}"
        for key in left:
            found = first_difference(left[key], right[key], f"{path}.{key}")
            if found:
                return found
        return None
    if isinstance(left, list):
        if len(left) != len(right):
            return f"{path}: {len(left)} vs {len(right)} items"
        for index, (a, b) in enumerate(zip(left, right)):
            found = first_difference(a, b, f"{path}[{index}]")
            if found:
                return found
        return None
    return None if left == right else f"{path}: {left!r} vs {right!r}"


def without_short(sheet: dict) -> tuple[dict, list[tuple[str, str, str]]]:
    """The sheet with every point's short taken out, and the list (question, point, short) taken."""
    copy = json.loads(json.dumps(sheet))
    shorts = []
    for question in copy.get("questions", []):
        for item in (question.get("rubric") or {}).get("points", []):
            shorts.append((question["question_id"], item["id"], item.pop("short")))
    return copy, shorts


def cmd_sheets(db: str, out: str) -> None:
    result: dict[str, Any] = {}
    for user, exam in SHEET_CASES:
        space, status = asyncio.run(space_sheet(db, exam, user))
        sql, state = sql_sheet(db, exam, user)
        name = f"oral_sheet_for = _sheet_response ({'A' if user == A else 'B'}, {exam[:8]})"
        if space is None or sql is None:
            fail(name, f"space {status}, sql {state}")
            continue
        left, space_shorts = without_short(space)
        right, sql_shorts = without_short(sql)
        diff = first_difference(left, right)
        if diff:
            fail(name, diff)
            continue
        # The short line: equal, or the Space's check refused the stored one (display only).
        refused = 0
        titles = {(q["question_id"], p["id"]): p["title"] for q in space["questions"] for p in (q.get("rubric") or {}).get("points", [])}
        for (qid, pid, mine), (_, _, stored) in zip(space_shorts, sql_shorts):
            if mine == stored:
                continue
            if mine == "" and oral_sheet.short_problem(stored, titles[(qid, pid)]) is not None:
                refused += 1
                continue
            fail(name, f"short of {qid}/{pid}: {mine!r} vs {stored!r}")
            break
        else:
            questions = len(space["questions"])
            with_rubric = sum(1 for item in space["questions"] if item["rubric"])
            ok(name, f"{questions} questions, {with_rubric} rubrics, {len(space_shorts)} points, to_write {space['to_write']}, "
                     f"units {space['units']}, unwritable {space['unwritable']}, rebuilt "
                     f"{sum(1 for item in space['questions'] if item['rebuilt'])}; shorts refused by the Space's check: {refused}")
        result[f"{user}|{exam}"] = {"space": space, "sql": sql}
    for user, exam in DENIED_CASES:
        _, status = asyncio.run(space_sheet(db, exam, user))
        _, state = sql_sheet(db, exam, user)
        name = f"not the user's exam: Space 404, SQL P0002 ({exam[:8]})"
        if status == 404 and state == "P0002":
            ok(name)
        else:
            fail(name, f"space {status}, sql {state}")
    Path(out).write_text(json.dumps(result, ensure_ascii=False))


# ── the fuzz ────────────────────────────────────────────────────────────────────────────────────────────────────────────

CHARS = (
    list("abcxyzABCXYZ0123456789 -_:.,;!?/()[]{}<>=+*%$#@&|~^`") + list("абвгдеёжзийклмнопрстуфхцчшщъыьэюяАБВГДЕЁЖЗИЙ")
    + ["'", '"', "\\", "\t", "\n", "\r", "\x0b", "\x0c", "\x1c", "\x1f", "\x01", "\x7f", "\x85", "\xa0", "\xad", "\u1680",
       "\u2003", "\u200b", "\u2028", "\u2029", "\u202f", "\u205f", "\u3000", "\ufeff", "\ue000", "→", "↑", "≤", "й", "ё", "€", "😀"]
)


def rand_text(rng: random.Random, short: bool = False) -> str:
    return "".join(rng.choice(CHARS) for _ in range(rng.randint(0, 3 if short else 12)))


def rand_number(rng: random.Random) -> Any:
    pick = rng.randint(0, 9)
    if pick == 0:
        return 0
    if pick == 1:
        return rng.randint(-10**20, 10**20)
    if pick == 2:
        return rng.randint(-100, 100)
    if pick == 3:
        return 0.0
    if pick == 4:
        return rng.uniform(-1e-3, 1e-3)
    if pick == 5:
        return rng.choice([1e15, 1e16, 1.5e16, 123456789012345678.0, 1e-4, 1e-5, 2.5, -2.5, 0.1, 1e300, 5e-324])
    return round(rng.uniform(-1e6, 1e6), rng.randint(0, 8))


def rand_value(rng: random.Random, depth: int = 0) -> Any:
    pick = rng.randint(0, 9 if depth < 2 else 6)
    if pick <= 2:
        return rand_text(rng)
    if pick == 3:
        return rand_number(rng)
    if pick == 4:
        return rng.choice([True, False])
    if pick == 5:
        return None
    if pick == 6:
        return rng.choice(["", "p1", "p2", "p6\n", "p7", "M1", str(uuid.UUID(int=rng.getrandbits(128)))])
    if pick in (7, 8):
        return [rand_value(rng, depth + 1) for _ in range(rng.randint(0, 3))]
    return {rand_text(rng, True): rand_value(rng, depth + 1) for _ in range(rng.randint(0, 3))}


def rand_point(rng: random.Random) -> Any:
    if rng.random() < 0.1:
        return rand_value(rng)
    item: dict[str, Any] = {}
    for key, make in (("id", lambda: rng.choice(["p1", "p2", "p3", "p6", "p6\n", "p7", "P1", " p1", 1, None])),
                      ("title", lambda: rng.choice([rand_text(rng), "  ", "\u3000", "\ufeff", "Пункт", None, 5])),
                      ("essential", lambda: rng.choice([True, False, "true", 1, None])),
                      ("source_quote", lambda: rng.choice([rand_text(rng), None, 3])),
                      ("source_ids", lambda: rng.choice([["M1:S1", 2, None, "x"], "M1:S1", [], None]))):
        if rng.random() < 0.85:
            item[key] = make()
    return item


def cmd_fuzz(db: str, count: int, seed: int = 20261010) -> None:
    rng = random.Random(seed)
    values = [rand_value(rng) for _ in range(count)]
    evidences = [[rng.choice([{"material_id": rand_value(rng), "source_id": rand_value(rng)},
                              {"material_id": str(uuid.UUID(int=rng.getrandbits(128))), "source_id": f"S{rng.randint(1, 99)}"},
                              rand_value(rng)]) for _ in range(rng.randint(0, 4))] for _ in range(count)]
    fingerprints = [rng.choice([None, "", "fp:v1:" + rand_text(rng, True), rand_text(rng)]) for _ in range(count)]
    methods = [rng.choice([None, "llm", "lexical", "manual", ""]) for _ in range(count)]
    lectures = [[rng.choice([str(uuid.UUID(int=rng.getrandbits(128))), rand_text(rng, True), ""]) for _ in range(rng.randint(0, 3))]
                for _ in range(count)]
    points = [[rand_point(rng) for _ in range(rng.randint(0, 6))] if rng.random() < 0.9 else rand_value(rng) for _ in range(count)]
    mats = [[rand_value(rng) if rng.random() < 0.2 else {k: rand_value(rng) for k in ("key", "material_id", "title") if rng.random() < 0.8}
             for _ in range(rng.randint(0, 3))] for _ in range(count)]
    rows = []
    for i in range(count):
        ids = ("array[" + ", ".join(lit(m) for m in lectures[i]) + "]::text[]") if lectures[i] else "'{}'::text[]"
        rows.append(f"({i}, {jlit(values[i])}, {jlit(evidences[i])}, {lit(fingerprints[i])}, {lit(methods[i])}, {ids}, "
                    f"{jlit(points[i])}, {jlit(mats[i])})")
    script = (
        "create temp table f (i int, v jsonb, ev jsonb, fp text, m text, l text[], p jsonb, mt jsonb);\n"
        "insert into f values\n  " + ",\n  ".join(rows) + ";\n"
        "select json_agg(json_build_object('i', i, 'v', v::text, 'ev', ev::text, 'p', p::text, 'mt', mt::text,"
        " 'str', meldy_private.py_str(v), 'key', meldy_private.oral_rubric_key(fp, l, ev, m),"
        " 'points', meldy_private.oral_clean_points(p)::text, 'mats', meldy_private.oral_clean_materials(mt)::text) order by i) from f;\n"
    )
    out = json.loads(psql(db, script))
    checks = {"py_str = str(x or \"\")": 0, "oral_rubric_key = oral.rubric_key": 0,
              "oral_clean_points = _clean_points": 0, "oral_clean_materials = _clean_materials": 0}
    for row in out:
        i = row["i"]
        # What the Space sees: PostgREST hands over the jsonb text, json.loads reads it.
        value = json.loads(row["v"])
        expect = str(value or "")
        if row["str"] != expect:
            fail("py_str = str(x or \"\")", f"{row['v']!r}: {row['str']!r} vs {expect!r}")
            return
        checks["py_str = str(x or \"\")"] += 1
        question = {"materials_fingerprint": fingerprints[i], "evidence": json.loads(row["ev"]), "coverage_method": methods[i]}
        expect_key = oral.rubric_key(question, lectures[i])
        if row["key"] != expect_key:
            fail("oral_rubric_key = oral.rubric_key", f"case {i}: {row['key']} vs {expect_key} ({row['ev']})")
            return
        checks["oral_rubric_key = oral.rubric_key"] += 1
        expect_points = oral_sheet._clean_points(json.loads(row["p"]))
        if json.loads(row["points"]) != expect_points:
            fail("oral_clean_points = _clean_points", f"case {i}: {row['points']} vs {json.dumps(expect_points, ensure_ascii=False)}")
            return
        checks["oral_clean_points = _clean_points"] += 1
        expect_mats = oral_sheet._clean_materials(json.loads(row["mt"]))
        if json.loads(row["mats"]) != expect_mats:
            fail("oral_clean_materials = _clean_materials", f"case {i}: {row['mats']} vs {json.dumps(expect_mats, ensure_ascii=False)}")
            return
        checks["oral_clean_materials = _clean_materials"] += 1
    for name, n in checks.items():
        ok(name, f"{n} random values")


def main() -> int:
    command, db = sys.argv[1], sys.argv[2]
    if command == "fixture":
        cmd_fixture(db)
    elif command == "sheets":
        cmd_sheets(db, sys.argv[3])
    elif command == "fuzz":
        cmd_fuzz(db, int(sys.argv[3]), int(sys.argv[4]) if len(sys.argv) > 4 else 20261010)
    else:
        raise SystemExit(f"unknown command {command}")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
