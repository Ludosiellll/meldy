"""Разметка экзамена по лекциям (exams_map.py): проверки честности судьи, повторы, пачки,
повторное использование с исходной датой, блокировка, запись до события, доказательства —
целые фрагменты лекции. Плюс функция согласия скрипта mapping_accuracy.py (ворота 3).

Данные только синтетические: демо-лекция tests/fixtures/demo_lecture_v0.txt и короткие
тексты ниже. Supabase — подменённый транспорт httpx (supabase_rest._transport), модель —
подменённый BaseAgent.run.
"""
import asyncio
import hashlib
import importlib.util
import json
import random
import re
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

import exams_map  # noqa: E402
import supabase_rest  # noqa: E402
from agents.base import AIError, BaseAgent  # noqa: E402
from exams_map import (  # noqa: E402
    INTERNAL_MESSAGE,
    MAP_VERSION,
    MAPPING_RUNNING_DETAIL,
    REASON_NO_ANSWER,
    REASON_NO_OVERLAP,
    REASON_NO_SUPPORT,
    WRITE_FAILED_MESSAGE,
    MapError,
    Verdict,
    clean_missing,
    coverage_from_verdict,
    heading_passages,
    materials_fingerprint,
    passage_index,
    prepare_mapping,
    release_unstarted,
    run_mapping,
    select_targets,
    validate_judge_answer,
)
from exams_parse import question_hash  # noqa: E402
from exams_prompts import JUDGE_PROMPT  # noqa: E402
from retrieval import BM25Index, material_passages  # noqa: E402
from supabase_rest import SupabaseRest  # noqa: E402
from utils import build_source_chunks  # noqa: E402

URL = "https://fake-ref.supabase.co"
ANON = "anon-public-key"
TOKENS = {"token-a": "user-a", "token-b": "user-b"}
T0 = datetime(2026, 10, 3, 9, 0, tzinfo=timezone.utc)

DEMO = (BACKEND / "tests" / "fixtures" / "demo_lecture_v0.txt").read_text(encoding="utf-8")
ECON = """Денежный рынок и денежно-кредитная политика

Денежный рынок — часть финансового рынка, на которой встречаются спрос на деньги и предложение денег. Спрос на деньги складывается из трансакционного мотива, мотива предосторожности и спекулятивного мотива.

Предложение денег формируют центральный банк и коммерческие банки. Денежный мультипликатор показывает, во сколько раз изменится денежная масса при изменении денежной базы на единицу.

Денежно-кредитная политика центрального банка направлена на ценовую стабильность. Её инструменты: ключевая ставка, операции на открытом рынке и нормативы обязательных резервов.

Инфляция — устойчивый рост общего уровня цен. По темпу различают умеренную, галопирующую инфляцию и гиперинфляцию. Причины инфляции: избыточный спрос и рост издержек производства.

Режим таргетирования инфляции означает, что центральный банк объявляет цель по инфляции и меняет ключевую ставку, чтобы удержать инфляцию около цели."""
# Длинный абзац с переносами строк: build_source_chunks режет его по словам (фрагменты по ~850 знаков).
LONG = "Экономический рост\n\n" + "\n".join(
    f"Фактор роста номер {n}: накопление капитала, рост производительности труда и технический прогресс "
    f"увеличивают потенциальный выпуск экономики в долгосрочном периоде."
    for n in range(1, 30)
)

Q_BACKPROP = "Метод обратного распространения ошибки"
Q_ACTIVATION = "Функции активации: назначение и основные виды"
Q_PHILLIPS = "Кривая Филлипса"
Q_POLICY = "Денежно-кредитная политика центрального банка"
Q_BAYES = "Байесовские сети доверия"
Q_INFLATION = "Инфляция: виды и причины"
Q_TARGETING = "Таргетирование инфляции"
Q_REGULARIZATION = "Регуляризация и борьба с переобучением"


# ── Подменённый PostgREST ───────────────────────────────────────────────────────

TIMESTAMP_COLUMNS = {"mapped_at", "mapping_started_at", "created_at"}
_TS_RE = re.compile(r"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}")


def ts(value):
    return None if value is None else datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def pg_ts(value):
    """Как PostgREST отдаёт timestamptz: «2026-10-03T09:00:05.123456+00:00»."""
    return None if value is None else ts(value).astimezone(timezone.utc).isoformat()


def sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class FakeSupabase:
    """PostgREST в памяти: RLS по токену, фильтры eq/neq/in/is/lt и or(...), order, limit, select."""

    def __init__(self):
        self.tables = {name: [] for name in ("exams", "exam_questions", "exam_materials", "materials")}
        self.requests: list[httpx.Request] = []
        self.log: list[tuple] = []
        self.fail: dict[tuple[str, str], object] = {}  # (метод, таблица) → статус или функция(request) → статус|None

    # — данные —

    def material(self, title, text, user="user-a"):
        row = {"id": str(uuid.uuid4()), "user_id": user, "title": title, "original_text": text}
        self.tables["materials"].append(row)
        return row["id"]

    def exam(self, user="user-a", **fields):
        row = {
            "id": str(uuid.uuid4()), "user_id": user, "title": "Макроэкономика", "mapping_state": "none",
            "mapping_started_at": None, "mapped_at": None, "mapped_material_ids": [],
            "created_at": pg_ts("2026-10-01T08:00:00Z"),
        }
        row.update({key: pg_ts(value) if key in TIMESTAMP_COLUMNS else value for key, value in fields.items()})
        self.tables["exams"].append(row)
        return row["id"]

    def link(self, exam_id, material_id, user="user-a"):
        self.tables["exam_materials"].append({"exam_id": exam_id, "material_id": material_id, "user_id": user})

    def question(self, exam_id, position, text, user="user-a", **fields):
        row = {
            "id": str(uuid.uuid4()), "exam_id": exam_id, "user_id": user, "position": position, "label": str(position),
            "section": None, "text": text, "question_hash": question_hash(text), "coverage": None, "coverage_method": None,
            "coverage_reason": "", "missing_note": "", "evidence": [], "nearest": [], "materials_fingerprint": None,
            "mapping_version": None, "mapped_at": None, "created_at": pg_ts(f"2026-10-01T08:00:{position % 60:02d}Z"),
        }
        row.update({key: pg_ts(value) if key in TIMESTAMP_COLUMNS else value for key, value in fields.items()})
        self.tables["exam_questions"].append(row)
        return row["id"]

    def row(self, table, row_id):
        return next(row for row in self.tables[table] if row["id"] == row_id)

    def questions_of(self, exam_id):
        return [row for row in self.tables["exam_questions"] if row["exam_id"] == exam_id]

    # — HTTP —

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        token = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
        user = TOKENS.get(token)
        if request.headers.get("apikey") != ANON or user is None:
            return httpx.Response(401, json={"code": "PGRST301", "message": "JWT expired"})
        table = request.url.path.rsplit("/", 1)[-1]
        params = list(request.url.params.multi_items())
        failure = self.fail.get((request.method, table))
        status = failure(request) if callable(failure) else failure
        if status:
            return httpx.Response(status, json={"code": "XX000", "message": "internal details that must not leak"})
        rows = [row for row in self.tables[table] if row.get("user_id") == user and self._matches(row, params)]
        if request.method == "GET":
            rows = self._ordered(rows, params)
            limit = dict(params).get("limit")
            if limit is not None:
                rows = rows[: int(limit)]
            return httpx.Response(200, json=[self._project(row, params) for row in rows])
        if request.method == "PATCH":
            values = json.loads(request.content)
            for row in rows:
                for key, value in values.items():
                    row[key] = pg_ts(value) if key in TIMESTAMP_COLUMNS else value
                if table == "exam_questions":
                    self.log.append(("write", row["id"]))
            return httpx.Response(200, json=[self._project(row, params) for row in rows])
        return httpx.Response(405, json={"code": "PGRST105"})

    @staticmethod
    def _equal(actual, value):
        if isinstance(actual, bool):
            return str(actual).lower() == value
        if isinstance(actual, str) and _TS_RE.match(actual) and _TS_RE.match(value):
            return ts(actual) == ts(value)
        return str(actual) == value

    def _check(self, actual, op, value):
        value = value.strip('"')
        if op == "eq":
            return actual is not None and self._equal(actual, value)
        if op == "neq":
            return actual is not None and not self._equal(actual, value)
        if op == "is":
            assert value == "null"
            return actual is None
        if op == "in":
            return actual is not None and any(self._equal(actual, item) for item in value.strip("()").split(","))
        if op == "lt":
            return actual is not None and ts(actual) < ts(value)
        raise AssertionError(f"unsupported filter {op}")

    @staticmethod
    def _split_or(expression):
        parts, current, quoted = [], "", False
        for char in expression.strip()[1:-1]:
            if char == '"':
                quoted = not quoted
            if char == "," and not quoted:
                parts.append(current)
                current = ""
                continue
            current += char
        parts.append(current)
        return parts

    def _matches(self, row, params):
        for key, raw in params:
            if key in ("select", "order", "limit", "columns", "on_conflict"):
                continue
            if key == "or":
                options = [part.split(".", 2) for part in self._split_or(raw)]
                if not any(self._check(row.get(column), op, value) for column, op, value in options):
                    return False
                continue
            op, _, value = raw.partition(".")
            if not self._check(row.get(key), op, value):
                return False
        return True

    @staticmethod
    def _ordered(rows, params):
        order = dict(params).get("order")
        if not order:
            return rows
        for term in reversed(order.split(",")):
            column, _, direction = term.partition(".")
            present = [row for row in rows if row.get(column) is not None]
            missing = [row for row in rows if row.get(column) is None]
            present.sort(key=lambda row: ts(row[column]) if column in TIMESTAMP_COLUMNS else row[column],
                         reverse=direction == "desc")
            rows = (missing + present) if direction == "desc" else (present + missing)
        return rows

    @staticmethod
    def _project(row, params):
        select = dict(params).get("select")
        if not select or select == "*":
            return dict(row)
        return {column: row.get(column) for column in select.split(",")}


# ── Подменённая модель ──────────────────────────────────────────────────────────

_QUESTION_LINE = re.compile(r"^Вопрос (\d+): (.*)$")
_CANDIDATE_LINE = re.compile(r"^\[(C\d+)\] \((.*?)\) (.*)$")


def parse_block(user_text):
    """Вход судьи → [{"n", "text", "candidates": [{"label", "title", "text"}]}]."""
    questions = []
    for block in user_text.split("\n\n"):
        lines = block.split("\n")
        head = _QUESTION_LINE.match(lines[0])
        assert head, lines[0]
        candidates = []
        for line in lines[1:]:
            match = _CANDIDATE_LINE.match(line)
            assert match, line
            candidates.append({"label": match.group(1), "title": match.group(2), "text": match.group(3)})
        questions.append({"n": int(head.group(1)), "text": head.group(2), "candidates": candidates})
    return questions


class Judge:
    """Подменённый BaseAgent.run: script(questions, номер вызова) → dict | str | исключение."""

    def __init__(self, script=None):
        self.calls = []
        self.script = script or honest({})

    async def run(self, agent, system_prompt, user_text, **kwargs):
        questions = parse_block(user_text)
        self.calls.append({"system": system_prompt, "user": user_text, "questions": questions, "kwargs": kwargs})
        answer = self.script(questions, len(self.calls))
        if isinstance(answer, BaseException):
            raise answer
        return answer if isinstance(answer, str) else json.dumps(answer, ensure_ascii=False)

    def asked(self):
        return [question["text"] for call in self.calls for question in call["questions"]]


def honest(rules, default=("none", None)):
    """rules: {подстрока вопроса: (coverage, подстрока опорного фрагмента или None)}."""

    def script(questions, call_number):
        results = []
        for question in questions:
            coverage, needle = next(
                (rule for key, rule in rules.items() if key.lower() in question["text"].lower()), default
            )
            support = [c["label"] for c in question["candidates"] if needle and needle.lower() in c["text"].lower()][:1]
            results.append({
                "n": question["n"], "coverage": coverage, "support": support,
                "missing": "" if coverage == "full" else "Нет классификации", "reason": f"Решено по фрагментам: {coverage}",
            })
        return {"results": results}

    return script


RULES = {
    "обратного распространения": ("full", "Обратное распространение ошибки"),
    "функции активации": ("partial", "Функция активации определяет"),
    "денежно-кредитная": ("full", "Денежно-кредитная политика центрального банка"),
    "байесовские": ("none", None),
    "инфляция: виды": ("full", "Инфляция — устойчивый рост"),
    "таргетирование": ("full", "Режим таргетирования"),
    "регуляризация": ("full", "Переобучение — главная проблема"),
}


# ── Окружение ───────────────────────────────────────────────────────────────────


class Clock:
    def __init__(self, start=T0):
        self.now = start

    def __call__(self):
        self.now += timedelta(seconds=1)
        return self.now


@pytest.fixture
def fake(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", URL)
    monkeypatch.setenv("SUPABASE_KEY", ANON)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.setattr(exams_map, "STAGGER_SECONDS", 0.0)
    clock = Clock()
    monkeypatch.setattr(exams_map, "_now", clock)
    supabase = FakeSupabase()
    supabase.clock = clock
    monkeypatch.setattr(supabase_rest, "_transport", httpx.MockTransport(supabase.handler))
    BaseAgent._run_cache.clear()
    yield supabase
    BaseAgent._run_cache.clear()


@pytest.fixture
def judge(monkeypatch):
    model = Judge(honest(RULES))

    async def fake_run(agent, system_prompt, user_text, **kwargs):
        return await model.run(agent, system_prompt, user_text, **kwargs)

    monkeypatch.setattr(BaseAgent, "run", fake_run)
    return model


def course(fake, questions, *, user="user-a", materials=(("Нейронные сети", DEMO), ("Денежный рынок", ECON)), **exam_fields):
    material_ids = [fake.material(title, text, user=user) for title, text in materials]
    exam_id = fake.exam(user=user, **exam_fields)
    for material_id in material_ids:
        fake.link(exam_id, material_id, user=user)
    question_ids = [fake.question(exam_id, position, text, user=user) for position, text in enumerate(questions, start=1)]
    return exam_id, question_ids, material_ids


def run_map(fake, exam_id, *, token="token-a", question_ids=None, force=False):
    async def go():
        job = await prepare_mapping(SupabaseRest(token), exam_id, question_ids, force)
        events = []
        async for event in run_mapping(job):
            events.append(event)
            fake.log.append(("event", event["type"], [item["question_id"] for item in event.get("items", [])]))
        return events

    return asyncio.run(go())


def map_error(fake, exam_id, *, token="token-a"):
    async def go():
        db = SupabaseRest(token)
        try:
            with pytest.raises(MapError) as info:
                await prepare_mapping(db, exam_id)
        finally:
            await db.aclose()
        return info.value

    return asyncio.run(go())


def fragments_of(*texts_by_id):
    """{(material_id, source_id): текст фрагмента} по build_source_chunks(text, max_chunks=None)."""
    result = {}
    for material_id, text in texts_by_id:
        for chunk in build_source_chunks(text, max_chunks=None):
            result[(material_id, chunk["id"])] = chunk["text"]
    return result


def assert_honest_rows(fake):
    """Инвариант: «есть / частично» модели или поиска — с доказательством; доказательство — целый фрагмент."""
    texts = {row["id"]: row["original_text"] for row in fake.tables["materials"]}
    fragments = fragments_of(*texts.items())
    for row in fake.tables["exam_questions"]:
        if row["coverage_method"] in ("llm", "lexical") and row["coverage"] in ("full", "partial"):
            assert row["evidence"], row
        if row["coverage_method"] == "manual":
            assert row["evidence"] == []
        for item in row["evidence"]:
            assert item["excerpt"] == fragments[(item["material_id"], item["source_id"])]
            assert len(item["excerpt"]) <= 900
        for item in row["nearest"]:
            assert item["excerpt"] in fragments[(item["material_id"], item["source_id"])]
            assert len(item["excerpt"]) <= 300
        assert row["coverage"] in (None, "full", "partial", "none", "unverified")
        assert len(row["coverage_reason"]) <= 400 and len(row["missing_note"]) <= 400


def by_type(events, kind):
    return [event for event in events if event["type"] == kind]


def items(events):
    return {item["question_id"]: item for event in events for item in event.get("items", [])}


# ── Отпечаток и цели ───────────────────────────────────────────────────────────


def test_fingerprint_follows_the_contract_formula():
    expected = hashlib.sha256(",".join(sorted([f"a:{sha('текст А')}", f"b:{sha('текст Б')}"])).encode()).hexdigest()
    assert materials_fingerprint([("b", "текст Б"), ("a", "текст А")]) == expected
    assert materials_fingerprint([("a", "текст А"), ("b", "текст Б")]) == expected
    assert materials_fingerprint([("a", "текст А!"), ("b", "текст Б")]) != expected
    assert materials_fingerprint([("a", "текст А")]) != expected


def _question(qid, coverage=None, method=None, fp=None, version=MAP_VERSION, evidence=()):
    return {"id": qid, "coverage": coverage, "coverage_method": method, "materials_fingerprint": fp,
            "mapping_version": version if coverage else None, "evidence": list(evidence)}


def test_targets_follow_the_contract_rules_and_never_touch_manual_marks():
    in_exam = {"material_id": "m1", "source_id": "S01", "excerpt": "x"}
    removed = {"material_id": "gone", "source_id": "S01", "excerpt": "x"}
    questions = [
        _question("new"),
        _question("unverified", "unverified", "lexical", "fp-now"),
        _question("partial-same", "partial", "llm", "fp-now", evidence=[in_exam]),
        _question("partial-old", "partial", "llm", "fp-old", evidence=[in_exam]),
        _question("none-old", "none", "lexical", "fp-old"),
        _question("none-old-version", "none", "llm", "fp-now", version=0),
        _question("none-same", "none", "llm", "fp-now"),
        _question("full-old-fp", "full", "llm", "fp-old", evidence=[in_exam]),  # новая лекция не отнимает «есть»
        _question("full-removed", "full", "llm", "fp-old", evidence=[in_exam, removed]),
        _question("manual", "full", "manual", None, evidence=[]),
    ]
    ids = lambda targets: [question["id"] for question in targets]  # noqa: E731
    assert ids(select_targets(questions, "fp-now", {"m1"}, None, False)) == [
        "new", "unverified", "partial-old", "none-old", "none-old-version", "full-removed",
    ]
    assert ids(select_targets(questions, "fp-now", {"m1"}, ["partial-same", "manual"], False)) == ["partial-same"]
    assert ids(select_targets(questions, "fp-now", {"m1"}, None, True)) == [question["id"] for question in questions]
    assert "manual" in ids(select_targets(questions, "fp-now", {"m1"}, ["manual"], True))


def test_full_is_rechecked_when_its_excerpt_is_no_longer_the_lectures_fragment():
    fragments = {("m1", "S01"): "Нынешний текст фрагмента."}
    current = _question("current", "full", "llm", "fp", evidence=[{"material_id": "m1", "source_id": "S01", "excerpt": "Нынешний текст фрагмента."}])
    stale = _question("stale", "full", "llm", "fp", evidence=[{"material_id": "m1", "source_id": "S01", "excerpt": "Старый текст."}])
    targets = select_targets([current, stale], "fp", {"m1"}, None, False, fragments)
    assert [question["id"] for question in targets] == ["stale"]


# ── Судья: вход и проверка ответа ───────────────────────────────────────────────


def test_judge_block_labels_candidates_per_question_and_names_the_lecture():
    from exams_prompts import JudgeCandidate, JudgeQuestion, build_judge_block

    block = build_judge_block([
        JudgeQuestion("Метод   обратного\nраспространения", (
            JudgeCandidate("Нейронные сети (лекция 2)", "Обратное распространение ошибки: градиент…", None),
            JudgeCandidate("Нейронные сети (лекция 2)", "Переобучение — главная проблема.", "Регуляризация и борьба с переобучением"),
        )),
        JudgeQuestion("Кривая Филлипса", (JudgeCandidate("", "слово " * 200, None),)),
    ], fragment_chars=450)
    first, second = block.split("\n\n")
    assert first.splitlines() == [
        "Вопрос 1: Метод обратного распространения",
        "[C1] (Нейронные сети «лекция 2») Обратное распространение ошибки: градиент…",
        "[C2] (Нейронные сети «лекция 2») Регуляризация и борьба с переобучением. Переобучение — главная проблема.",
    ]
    head, candidate = second.splitlines()
    assert head == "Вопрос 2: Кривая Филлипса" and candidate.startswith("[C1] (Без названия) слово")
    asked = build_judge_block([JudgeQuestion("Что такое ВВП?", (JudgeCandidate("Макро", "ВВП — стоимость.", "Что такое ВВП?"),))])
    assert asked.splitlines()[1] == "[C1] (Макро) Что такое ВВП? ВВП — стоимость."
    assert candidate.endswith(" …") and len(candidate) <= len("[C1] (Без названия) ") + 452
    assert "[C1]" in JUDGE_PROMPT and '"results"' in JUDGE_PROMPT and "JSON" in JUDGE_PROMPT
    assert "Решай только по этим фрагментам" in JUDGE_PROMPT



def test_judge_labels_outside_the_questions_own_candidates_are_dropped():
    raw = json.dumps({"results": [
        {"n": 1, "coverage": "full", "support": ["C3", "C7", "[C1]"], "missing": "", "reason": "ок"},
        {"n": 2, "coverage": "partial", "support": ["C2", "С1"], "missing": "нет видов", "reason": "ок"},  # С1 — кириллица
        {"n": 3, "coverage": "full", "support": [4, "C1"], "missing": "", "reason": "ок"},
    ]}, ensure_ascii=False)
    verdicts, complete = validate_judge_answer(raw, [3, 1, 2])
    assert complete
    assert verdicts[0].support == (2, 0)
    assert verdicts[1].support == (0,)
    assert verdicts[2].support == (0,)


@pytest.mark.parametrize(
    ("raw", "expected", "complete"),
    [
        ("не JSON", {}, False),
        ('{"results": "нет"}', {}, False),
        (json.dumps({"results": [{"n": "2", "coverage": "нет", "support": []}, {"n": 1, "coverage": "есть", "support": ["C1"]}]},
                    ensure_ascii=False), {0: "full", 1: "none"}, True),
        (json.dumps({"results": [{"n": 1, "coverage": "maybe"}, {"n": 2, "coverage": "partial"}]}), {1: "partial"}, False),
        (json.dumps({"results": [{"n": 1, "coverage": "full"}, {"n": 1, "coverage": "none"}, {"n": 2, "coverage": "none"}]}),
         {0: "full", 1: "none"}, False),
        (json.dumps({"results": [{"n": 0, "coverage": "full"}, {"n": 3, "coverage": "full"}, {"n": 2, "coverage": "none"}]}),
         {1: "none"}, False),
        ('{"results": [{"n": 1, "coverage": "full", "support": ["C1"]}, {"n": 2, "cover', {0: "full"}, False),  # обрезанный JSON
        (json.dumps([{"n": 1, "coverage": "none"}, {"n": 2, "coverage": "none"}]), {0: "none", 1: "none"}, True),
    ],
)
def test_judge_answer_shapes(raw, expected, complete):
    verdicts, is_complete = validate_judge_answer(raw, [2, 2])
    assert {index: verdict.coverage for index, verdict in verdicts.items()} == expected
    assert is_complete is complete


def _demo_hits(query):
    passages = material_passages("m-demo", "Нейронные сети", DEMO)
    return BM25Index(passages).search(query, top_k=6, per_material_cap=3)


@pytest.mark.parametrize("coverage", ["full", "partial"])
def test_full_or_partial_without_valid_support_becomes_none(coverage):
    hits = _demo_hits(Q_BACKPROP)
    item = coverage_from_verdict("q1", hits, Verdict(coverage, (), "чего-то нет", "есть ответ"), "2026-10-03T09:00:00Z")
    assert item["coverage"] == "none" and item["method"] == "llm"
    assert item["reason"] == REASON_NO_SUPPORT == "Нет подтверждающего фрагмента"
    assert item["evidence"] == [] and item["missing"] == ""
    assert [n["source_id"] for n in item["nearest"]] == [hit.passage.source_id for hit in hits[:3]]


def test_supported_verdicts_cite_whole_fragments_and_keep_only_honest_notes():
    hits = _demo_hits(Q_BACKPROP)
    full = coverage_from_verdict("q1", hits, Verdict("full", (0, 0, 1), "лишнее", "Есть"), "t")
    assert [item["source_id"] for item in full["evidence"]] == ["S14", hits[1].passage.source_id]
    assert full["evidence"][0]["excerpt"] == hits[0].passage.text and full["missing"] == "" and full["nearest"] == []
    partial = coverage_from_verdict("q1", hits, Verdict("partial", (0,), "Нет примеров", ""), "t")
    # «Не хватает: примеров» — без «Нет» в начале; пустое пояснение — общее пояснение сервера.
    assert partial["missing"] == "примеров" and partial["reason"] == "Во фрагментах лекций есть часть ответа"
    none = coverage_from_verdict("q1", hits, Verdict("none", (0,), "", "Фрагменты о другом"), "t")
    assert none["evidence"] == [] and none["nearest"] and none["reason"] == "Фрагменты о другом"


def test_reason_and_missing_are_trimmed_to_200_chars():
    long_text = "очень длинное объяснение " * 40
    raw = json.dumps({"results": [{"n": 1, "coverage": "partial", "support": ["C1"], "missing": long_text, "reason": long_text}]},
                     ensure_ascii=False)
    verdict = validate_judge_answer(raw, [1])[0][0]
    assert 0 < len(verdict.reason) <= 200 and 0 < len(verdict.missing) <= 200
    assert verdict.reason.endswith("…")


def test_evidence_is_always_a_whole_fragment_and_nearest_a_verbatim_part():
    """Свойство: при любых ответах судьи доказательство — целый фрагмент лекции, ближайшее — его часть."""
    materials = [("m-demo", "Нейронные сети", DEMO), ("m-econ", "Денежный рынок", ECON), ("m-long", "Экономический рост", LONG)]
    passages = [passage for mid, title, text in materials for passage in material_passages(mid, title, text)]
    passages += material_passages("m-ph", "Макроэкономика", PHILLIPS)
    materials.append(("m-ph", "Макроэкономика", PHILLIPS))
    index = BM25Index(passages)
    by_order = passage_index(passages)
    fragments = fragments_of(*[(mid, text) for mid, _, text in materials])
    assert any(len(text) > 300 and "\n" not in text for text in fragments.values())  # длинные фрагменты есть
    words = re.findall(r"[А-Яа-яЁё]{5,}", DEMO + ECON + LONG + PHILLIPS)
    rng = random.Random(7)
    for _ in range(300):
        query = " ".join(rng.sample(words, 3))
        hits = index.search(query, top_k=6, per_material_cap=3)
        support = tuple(rng.randint(-1, 7) for _ in range(rng.randint(0, 4)))
        verdict = Verdict(rng.choice(["full", "partial", "none"]), support, "x", "y")
        item = coverage_from_verdict("q", hits, verdict, "t", by_order if rng.random() < 0.7 else None)
        if item["coverage"] in ("full", "partial"):
            assert item["evidence"] and len(item["evidence"]) <= 3
        for evidence in item["evidence"]:
            assert evidence["excerpt"] == fragments[(evidence["material_id"], evidence["source_id"])]
            assert len(evidence["excerpt"]) <= 900
        for nearest in item["nearest"]:
            assert nearest["excerpt"] in fragments[(nearest["material_id"], nearest["source_id"])]
            assert 0 < len(nearest["excerpt"]) <= 300
            assert all(word in fragments[(nearest["material_id"], nearest["source_id"])] for word in nearest["matched"])


PHILLIPS = """Инфляция и безработица

Инфляция — устойчивый рост общего уровня цен. Безработица — часть рабочей силы без работы, которая ищет работу.

Кривая Филлипса

В краткосрочном периоде существует обратная связь между темпом роста цен и уровнем незанятости. В долгосрочном периоде эта связь исчезает: экономика возвращается к естественному уровню.

Денежный рынок

Спрос на деньги складывается из трансакционного мотива и мотива предосторожности."""
Q_PHILLIPS_ASPECTS = "Кривая Филлипса: краткосрочный и долгосрочный аспекты"


def _phillips():
    passages = material_passages("m-ph", "Макроэкономика", PHILLIPS)
    return passages, BM25Index(passages), passage_index(passages)


def test_a_heading_fragment_is_shown_with_the_evidence_it_heads():
    passages, index, by_order = _phillips()
    hits = index.search(Q_PHILLIPS_ASPECTS, top_k=6, per_material_cap=3)
    assert hits[0].passage.source_id == "S04" and hits[0].heading == "Кривая Филлипса"
    assert heading_passages(hits[0], by_order) == (passages[2],)
    partial = coverage_from_verdict("q", hits, Verdict("partial", (0,), "", ""), "t", by_order)
    # Судья читал «Кривая Филлипса. В краткосрочном…»: заголовок — отдельный целый фрагмент перед текстом.
    assert [(item["source_id"], item["excerpt"]) for item in partial["evidence"]] == [
        ("S03", "Кривая Филлипса"),
        ("S04", hits[0].passage.text),
    ]
    assert all(item["material_title"] == "Макроэкономика" for item in partial["evidence"])


def test_a_heading_only_match_points_the_nearest_fragment_at_the_heading():
    _, index, by_order = _phillips()
    hits = index.search(Q_PHILLIPS, top_k=6, per_material_cap=3)
    assert hits[0].passage.source_id == "S04" and hits[0].matched_words == []
    none = coverage_from_verdict("q", hits, Verdict("none", (), "", ""), "t", by_order)
    first = none["nearest"][0]
    assert (first["source_id"], first["excerpt"], first["matched"]) == ("S03", "Кривая Филлипса", ["Кривая", "Филлипса"])
    # Совпали и слова самого фрагмента — он и остаётся ближайшим, со своими словами.
    aspects = coverage_from_verdict("q", index.search(Q_PHILLIPS_ASPECTS), Verdict("none", (), "", ""), "t", by_order)
    assert aspects["nearest"][0]["source_id"] == "S04"
    assert aspects["nearest"][0]["matched"] == ["краткосрочном", "долгосрочном"]


def test_headings_take_only_the_evidence_places_left_after_the_fragments():
    lecture = (
        "Кривая Филлипса\n\nВ краткосрочном периоде рост цен снижает незанятость.\n\n"
        "Кривая Филлипса в долгосрочном периоде\n\nВ долгосрочном периоде связь исчезает, незанятость естественная."
    )
    passages = material_passages("m", "Макро", lecture)
    by_order = passage_index(passages)
    hits = BM25Index(passages).search(Q_PHILLIPS_ASPECTS, top_k=6, per_material_cap=3)
    assert [hit.passage.source_id for hit in hits] == ["S04", "S02"] or [hit.passage.source_id for hit in hits] == ["S02", "S04"]
    item = coverage_from_verdict("q", hits, Verdict("full", (0, 1), "", ""), "t", by_order)
    first_heading = f"S{hits[0].passage.order - 1:02d}"
    assert [evidence["source_id"] for evidence in item["evidence"]] == [first_heading, hits[0].passage.source_id, hits[1].passage.source_id]
    texts = {passage.source_id: passage.text for passage in passages}
    assert all(evidence["excerpt"] == texts[evidence["source_id"]] for evidence in item["evidence"])


def test_mapping_stores_the_heading_with_the_evidence_and_the_nearest_fragment(fake, judge):
    exam_id, (q_aspects, q_phillips), (lecture,) = course(
        fake, [Q_PHILLIPS_ASPECTS, Q_PHILLIPS], materials=(("Макроэкономика", PHILLIPS),)
    )
    judge.script = honest({"аспекты": ("partial", "краткосрочном периоде")}, default=("none", None))
    events = run_map(fake, exam_id)
    marks = items(events)
    assert [item["source_id"] for item in marks[q_aspects]["evidence"]] == ["S03", "S04"]
    assert [item["source_id"] for item in marks[q_phillips]["nearest"]][:1] == ["S03"]
    assert marks[q_phillips]["nearest"][0]["matched"] == ["Кривая", "Филлипса"]
    candidate = judge.calls[0]["questions"][0]["candidates"][0]["text"]
    assert candidate.startswith("Кривая Филлипса. В краткосрочном периоде")
    assert fake.row("exam_questions", q_aspects)["evidence"] == marks[q_aspects]["evidence"]
    assert_honest_rows(fake)


# Две лекции с одинаковыми номерами фрагментов (S01–S04 в каждой), как в живом прогоне 07.10:
# там у Q6 «Ограничения целостности» доказательством встал S05 чужой лекции.
RELATIONAL = (
    "Реляционная модель данных\n\n"
    "Реляционная модель представляет данные набором отношений. Отношение — множество кортежей с атомарными значениями, "
    "у каждого отношения есть первичный ключ. Модель состоит из структурной, целостной и манипуляционной частей; "
    "СУБД отвечает за то, чтобы данные всегда подчинялись правилам модели, и проверяет их при каждой операции. "
    "Пользователь описывает, какие данные ему нужны, а способ поиска выбирает сама система управления базами данных.\n\n"
    "Ограничения целостности — правила, которым данные удовлетворяют в любой момент. Различают ограничения "
    "целостности сущностей (первичный ключ уникален и не содержит NULL), ссылочную целостность (внешний ключ "
    "ссылается на существующую строку), доменные ограничения (тип, NOT NULL, DEFAULT, CHECK), ограничения кортежа "
    "и отношения и бизнес-правила предметной области, которые проверяют триггеры или прикладная программа.\n\n"
    "Связи между сущностями бывают один к одному, один ко многим и многие ко многим. Связь один ко многим "
    "реализуется внешним ключом на стороне многих, связь многие ко многим — связующим отношением с составным "
    "ключом из двух внешних ключей. В связующее отношение помещают и атрибуты самой связи, например дату и оценку."
)
NORMAL_FORMS = (
    "Нормализация отношений\n\n"
    "Нормализация устраняет избыточность и аномалии вставки, обновления и удаления. Функциональная зависимость "
    "связывает атрибуты отношения: значение одного набора атрибутов однозначно определяет значение другого. "
    "Транзакция переводит базу из одного согласованного состояния в другое: после неё выполняются все ограничения "
    "целостности, иначе СУБД её не зафиксирует.\n\n"
    "Первая нормальная форма требует, чтобы значения всех атрибутов были атомарны: в каждой ячейке одно значение, "
    "нет списков и повторяющихся групп. Таблица со столбцами Дисциплина1, Дисциплина2 в первой нормальной форме не "
    "находится; повторяющиеся значения раскладывают по строкам или выносят в отдельное отношение.\n\n"
    "Вторая нормальная форма требует, чтобы каждый неключевой атрибут полностью зависел от каждого потенциального "
    "ключа. Третья нормальная форма запрещает транзитивные зависимости неключевых атрибутов от ключа: для этого "
    "отношение раскладывают на проекции без потери данных."
)
Q_INTEGRITY = "Ограничения целостности в реляционной модели данных."
Q_FIRST_NF = "Первая нормальная форма."


def test_evidence_comes_from_the_lecture_of_the_chosen_candidate_when_fragment_numbers_repeat():
    passages = material_passages("m-rel", "Реляционная модель", RELATIONAL) + material_passages("m-nf", "Нормализация", NORMAL_FORMS)
    assert [p.source_id for p in passages] == ["S01", "S02", "S03", "S04"] * 2  # номера в двух лекциях одни и те же
    hits = BM25Index(passages).search(Q_INTEGRITY, top_k=6, per_material_cap=3)
    assert [(hit.passage.material_id, hit.passage.source_id) for hit in hits] == [
        ("m-rel", "S02"), ("m-rel", "S03"), ("m-nf", "S02"), ("m-nf", "S04"),
    ]
    texts = {(p.material_id, p.source_id): p.text for p in passages}
    for index, wanted in ((1, ("m-rel", "S03")), (2, ("m-nf", "S02"))):
        item = coverage_from_verdict("q", hits, Verdict("full", (index,), "", "Есть"), "t", passage_index(passages))
        assert [(e["material_id"], e["source_id"], e["excerpt"]) for e in item["evidence"]] == [(*wanted, texts[wanted])]
        assert item["evidence"][0]["material_title"] == ("Реляционная модель" if wanted[0] == "m-rel" else "Нормализация")


def test_one_batch_two_lectures_same_fragment_numbers_each_question_gets_its_own_lectures_fragment(fake, judge):
    exam_id, (q_integrity, q_first_nf), (relational, normal_forms) = course(
        fake, [Q_INTEGRITY, Q_FIRST_NF], materials=(("Реляционная модель", RELATIONAL), ("Нормализация", NORMAL_FORMS))
    )
    judge.script = honest({"ограничения целостности": ("full", "Различают ограничения"), "первая нормальная": ("full", "Первая нормальная форма требует")})
    marks = items(run_map(fake, exam_id))
    # Один вызов судьи на оба вопроса: метки [C1]… у каждого вопроса свои и повторяются.
    (call,) = judge.calls
    assert [[c["label"] for c in q["candidates"]] for q in call["questions"]] == [["C1", "C2", "C3", "C4"], ["C1", "C2"]]
    texts = {row["id"]: row["original_text"] for row in fake.tables["materials"]}
    fragments = fragments_of(*texts.items())
    # У обоих доказательств номер S03, но каждое — из своей лекции и с её текстом.
    assert [(e["material_id"], e["source_id"]) for e in marks[q_integrity]["evidence"]] == [(relational, "S03")]
    assert [(e["material_id"], e["source_id"]) for e in marks[q_first_nf]["evidence"]] == [(normal_forms, "S03")]
    assert marks[q_integrity]["evidence"][0]["excerpt"] == fragments[(relational, "S03")]
    assert "Различают ограничения" in marks[q_integrity]["evidence"][0]["excerpt"]
    assert marks[q_first_nf]["evidence"][0]["excerpt"] == fragments[(normal_forms, "S03")]
    assert fake.row("exam_questions", q_integrity)["evidence"] == marks[q_integrity]["evidence"]
    assert_honest_rows(fake)


def test_judge_notes_name_lecture_fragments_instead_of_candidate_labels():
    hits = _demo_hits(Q_BACKPROP)
    first, second = (str(int(hit.passage.source_id[1:])) for hit in hits[:2])
    item = coverage_from_verdict(
        "q1", hits, Verdict("partial", (0,), "Нет классификации видов в [C2]", "Фрагмент C1 содержит определение, виды есть в [C2]"), "t"
    )
    assert item["reason"] == f"Фрагмент {first} содержит определение, виды есть во фрагменте {second}"
    assert item["missing"] == f"классификации видов во фрагменте {second}"
    listed = coverage_from_verdict("q1", hits, Verdict("full", (0, 1), "", "C1 и C2 описывают метод"), "t")
    assert listed["reason"] == f"Фрагменты {first} и {second} описывают метод"
    # Метка, которой нет у вопроса, — пояснение не показываем, остаётся общее.
    unknown = coverage_from_verdict("q1", hits, Verdict("partial", (0,), "Нет примеров из [C9]", "Ответ в C9"), "t")
    assert unknown["reason"] == "Во фрагментах лекций есть часть ответа" and unknown["missing"] == ""
    # «С 5 видами» — не метка.
    assert coverage_from_verdict("q1", hits, Verdict("full", (0,), "", "С 5 видами функций"), "t")["reason"] == "С 5 видами функций"


@pytest.mark.parametrize(
    ("missing", "shown"),
    [
        ("Нет классификации видов инфляции", "классификации видов инфляции"),
        ("Не хватает: примеров из практики", "примеров из практики"),
        ("Отсутствуют виды инфляции", "виды инфляции"),
        ("В лекции нет примеров", "примеров"),
        ("Не указаны причины инфляции", "причины инфляции"),
        ("ВВП по доходам", "ВВП по доходам"),
        ("Нет", ""),
        ("—", ""),
    ],
)
def test_missing_notes_read_after_ne_khvataet(missing, shown):
    """На экране «Не хватает: {missing_note}» — без второго «нет» и с маленькой буквы."""
    assert clean_missing(missing, {}) == shown


def test_judge_prompt_asks_for_content_not_labels():
    assert "В reason и missing не упоминай метки [C…]" in JUDGE_PROMPT
    assert "без «нет» и «не хватает» в начале" in JUDGE_PROMPT


def test_mapped_rows_never_carry_candidate_labels(fake, judge):
    exam_id, question_ids, _ = course(fake, [Q_BACKPROP, Q_ACTIVATION, Q_POLICY])

    def script(questions, call_number):
        return {"results": [
            {"n": q["n"], "coverage": "partial", "support": ["C1"], "missing": "Нет классификации [C2]",
             "reason": "Фрагмент C1 содержит часть ответа, C2 — нет"}
            for q in questions
        ]}

    judge.script = script
    run_map(fake, exam_id)
    for question_id in question_ids:
        row = fake.row("exam_questions", question_id)
        assert row["coverage"] == "partial"
        assert not re.search(r"(?<![0-9A-Za-zА-Яа-яЁё])\[?[CС]\d", row["coverage_reason"] + row["missing_note"]), row
        assert row["missing_note"].startswith("классификации")


def test_reused_rows_lose_old_candidate_labels(fake, judge):
    exam_a, (source_id,), materials = course(fake, [Q_BACKPROP])
    run_map(fake, exam_a)
    source = fake.row("exam_questions", source_id)
    source.update({"coverage": "partial", "coverage_reason": "Фрагмент C1 содержит определение", "missing_note": "Нет примеров"})
    exam_b = fake.exam()
    for material_id in materials:
        fake.link(exam_b, material_id)
    reused_id = fake.question(exam_b, 1, Q_BACKPROP)
    events = run_map(fake, exam_b)
    item = items(events)[reused_id]
    assert item["reused"] is True
    assert item["reason"] == "Во фрагментах лекций есть часть ответа" and item["missing"] == "примеров"


# ── Поток разметки ──────────────────────────────────────────────────────────────


def test_mapping_streams_marks_writes_each_before_its_event_and_ends_with_done(fake, judge):
    exam_id, (q_backprop, q_activation, q_phillips, q_policy, q_bayes), (demo, econ) = course(
        fake, [Q_BACKPROP, Q_ACTIVATION, Q_PHILLIPS, Q_POLICY, Q_BAYES]
    )
    events = run_map(fake, exam_id)

    assert [event["type"] for event in events] == ["start", "lexical", "batch", "done"]
    start = events[0]
    assert start["questions"] == 5 and start["to_check"] == 5 and start["skipped"] == []
    assert start["fingerprint"] == materials_fingerprint([(demo, DEMO), (econ, ECON)])
    assert start["materials"] == [
        {"id": demo, "title": "Нейронные сети", "fragments": 30},
        {"id": econ, "title": "Денежный рынок", "fragments": 6},
    ]

    marks = items(events)
    assert marks[q_phillips]["coverage"] == "none" and marks[q_phillips]["method"] == "lexical"
    assert marks[q_phillips]["reason"] == REASON_NO_OVERLAP == "Ни одного фрагмента с этими словами"
    assert Q_PHILLIPS not in judge.asked()  # нет общих слов — модель не спрашивали
    assert marks[q_backprop]["coverage"] == "full" and marks[q_backprop]["evidence"][0]["source_id"] == "S14"
    assert marks[q_activation]["coverage"] == "partial" and marks[q_activation]["missing"] == "классификации"
    assert marks[q_policy]["coverage"] == "full" and marks[q_policy]["evidence"][0]["material_id"] == econ
    assert marks[q_bayes]["coverage"] == "none" and marks[q_bayes]["nearest"] and marks[q_bayes]["evidence"] == []
    assert all(item["reused"] is False for item in marks.values())

    done = events[-1]
    assert done["state"] == "done" and done["used_ai"] is True and done["reused"] == 0
    assert done["counts"] == {"full": 2, "partial": 1, "none": 2, "unverified": 0}
    rows = {row["id"]: row for row in fake.questions_of(exam_id)}
    oldest = min((row["mapped_at"] for row in rows.values()), key=ts)
    assert done["mapped_at"] == done["oldest_mapped_at"] == oldest

    # Запись в базу — до события, с токеном вызывающего.
    for position, entry in enumerate(fake.log):
        if entry[0] == "event":
            for question_id in entry[2]:
                assert ("write", question_id) in fake.log[:position]
    assert fake.requests and all(request.headers["authorization"] == "Bearer token-a" for request in fake.requests)
    assert all(request.headers["apikey"] == ANON for request in fake.requests)

    for question_id, item in marks.items():
        row = rows[question_id]
        assert (row["coverage"], row["coverage_method"]) == (item["coverage"], item["method"])
        assert row["evidence"] == item["evidence"] and row["nearest"] == item["nearest"]
        assert row["materials_fingerprint"] == start["fingerprint"] and row["mapping_version"] == MAP_VERSION
        assert ts(row["mapped_at"]) == ts(item["mapped_at"])
    exam = fake.row("exams", exam_id)
    assert exam["mapping_state"] == "done" and exam["mapped_at"] == oldest
    assert exam["mapped_material_ids"] == [demo, econ]
    assert_honest_rows(fake)

    (call,) = judge.calls
    assert call["system"] == JUDGE_PROMPT
    assert call["kwargs"] == {"temperature": 0, "max_tokens": exams_map.JUDGE_MAX_TOKENS, "json_mode": True,
                              "timeout": 45.0, "thinking": "low", "use_cache": True}
    for question in call["questions"]:
        titles = [candidate["title"] for candidate in question["candidates"]]
        assert 1 <= len(titles) <= 6 and all(titles.count(title) <= 3 for title in titles)


def test_a_lecture_without_text_is_skipped_and_left_out_of_the_fingerprint(fake, judge):
    exam_id, _, (demo, scan) = course(fake, [Q_BACKPROP], materials=(("Нейронные сети", DEMO), ("Скан лекции 5", "\n  \n")))
    events = run_map(fake, exam_id)
    start = events[0]
    assert start["skipped"] == [{"id": scan, "title": "Скан лекции 5", "reason": "no_text"}]
    assert [material["id"] for material in start["materials"]] == [demo]
    assert start["fingerprint"] == materials_fingerprint([(demo, DEMO)])
    assert fake.row("exams", exam_id)["mapped_material_ids"] == [demo]


def test_label_outside_candidates_is_dropped_and_unsupported_full_is_saved_as_none(fake, judge):
    exam_id, (q_backprop, q_bayes), _ = course(fake, [Q_BACKPROP, Q_BAYES])

    def script(questions, call_number):
        return {"results": [
            {"n": 1, "coverage": "full", "support": ["C1", "C9"], "missing": "", "reason": "Есть"},
            {"n": 2, "coverage": "full", "support": ["C9"], "missing": "", "reason": "Модель уверена"},
        ]}

    judge.script = script
    events = run_map(fake, exam_id)
    marks = items(events)
    assert [item["source_id"] for item in marks[q_backprop]["evidence"]] == ["S14"]
    assert marks[q_bayes]["coverage"] == "none" and marks[q_bayes]["reason"] == REASON_NO_SUPPORT
    row = fake.row("exam_questions", q_bayes)
    assert row["coverage"] == "none" and row["coverage_method"] == "llm" and row["evidence"] == []
    assert row["coverage_reason"] == "Нет подтверждающего фрагмента" and row["nearest"]
    assert_honest_rows(fake)


def test_missing_n_gets_one_half_size_retry_then_unverified(fake, judge):
    exam_id, question_ids, _ = course(fake, [Q_BACKPROP, Q_ACTIVATION, Q_POLICY, Q_INFLATION])
    first_answer = {"results": [{"n": 1, "coverage": "full", "support": ["C1"], "missing": "", "reason": "Есть"}]}
    BaseAgent._run_cache[("ранний ответ",)] = json.dumps(first_answer, ensure_ascii=False)

    def script(questions, call_number):
        first = questions[0]
        return {"results": [{"n": first["n"], "coverage": "full", "support": [first["candidates"][0]["label"]],
                             "missing": "", "reason": "Есть"}]}  # отвечает только на первый вопрос пачки

    judge.script = script
    events = run_map(fake, exam_id)
    # Пачка из 4 (без ключа Gemini) → пропущены 2, 3, 4 → повтор пачками по 2: [2, 3] и [4].
    assert [len(call["questions"]) for call in judge.calls] == [4, 2, 1]
    assert judge.calls[1]["questions"][0]["text"] == Q_ACTIVATION
    marks = items(events)
    assert [marks[qid]["coverage"] for qid in question_ids] == ["full", "full", "unverified", "full"]
    unverified = marks[question_ids[2]]
    assert unverified["method"] == "lexical" and unverified["reason"] == REASON_NO_ANSWER
    assert unverified["evidence"] == [] and unverified["nearest"]
    done = events[-1]
    assert done["state"] == "partial" and done["counts"]["unverified"] == 1
    assert fake.row("exams", exam_id)["mapping_state"] == "partial"
    assert ("ранний ответ",) not in BaseAgent._run_cache  # негодный ответ вычищен из кеша перед повтором
    assert_honest_rows(fake)


def test_a_busy_retry_says_so_in_the_reason(fake, judge):
    exam_id, question_ids, _ = course(fake, [Q_BACKPROP, Q_POLICY])

    def script(questions, call_number):
        if call_number == 1:
            return {"results": [{"n": 1, "coverage": "full", "support": ["C1"], "reason": "Есть"}]}
        return AIError.busy()

    judge.script = script
    marks = items(run_map(fake, exam_id))
    assert marks[question_ids[1]]["coverage"] == "unverified"
    assert marks[question_ids[1]]["reason"] == "Проверено только по словам: сервис ИИ был занят"


@pytest.mark.parametrize(
    ("error", "message"),
    [
        (AIError.busy(), "Сервис занят — эти вопросы проверены только по словам"),
        (AIError.failed(), "ИИ-сервис не ответил — эти вопросы проверены только по словам"),
        (AIError.timeout(), "ИИ-сервис не ответил вовремя — эти вопросы проверены только по словам"),
    ],
)
def test_a_failed_batch_is_batch_failed_with_lexical_unverified_items(fake, judge, error, message):
    exam_id, question_ids, _ = course(fake, [Q_BACKPROP, Q_POLICY, Q_PHILLIPS])
    judge.script = lambda questions, call_number: error
    events = run_map(fake, exam_id)
    assert [event["type"] for event in events] == ["start", "lexical", "batch_failed", "done"]
    failed = events[2]
    assert failed["index"] == 1 and failed["total"] == 1 and failed["message"] == message
    assert failed["question_ids"] == [question_ids[0], question_ids[1]]
    for item in failed["items"]:
        assert item["coverage"] == "unverified" and item["method"] == "lexical"
        assert item["evidence"] == [] and item["nearest"]
    assert len(judge.calls) == 1  # пачку целиком не повторяют
    done = events[-1]
    assert done["state"] == "partial" and done["used_ai"] is False
    assert done["counts"] == {"full": 0, "partial": 0, "none": 1, "unverified": 2}
    assert fake.row("exam_questions", question_ids[0])["coverage"] == "unverified"
    assert "internal" not in json.dumps(events, ensure_ascii=False)


def test_batches_of_ten_with_a_gemini_key_and_of_four_with_cut_fragments_without(fake, judge, monkeypatch):
    questions = ["Сигмоида и её недостатки", "Функция ReLU", "Dropout", "Аугментация данных", "Оптимизаторы Adam и RMSProp",
                 "Градиентный спуск", "Сверточные сети и фильтры", "Механизм внимания", "Трансформер и самовнимание",
                 "Прямой проход", "L2-регуляризация", "Фактор роста: накопление капитала", "Архитектуры ResNet и VGG"]
    materials = (("Нейронные сети", DEMO), ("Экономический рост", LONG))
    exam_id, _, _ = course(fake, questions, materials=materials)
    judge.script = honest({}, default=("none", None))
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-test-key")
    run_map(fake, exam_id)
    assert [len(call["questions"]) for call in judge.calls] == [10, 3]
    candidates = [c["text"] for call in judge.calls for q in call["questions"] for c in q["candidates"]]
    assert max(len(text) for text in candidates) > 700 and not any(text.endswith(" …") for text in candidates)  # целиком

    judge.calls.clear()
    exam_id, _, _ = course(fake, questions, materials=materials)
    monkeypatch.delenv("GEMINI_API_KEY")
    run_map(fake, exam_id)
    assert sorted(len(call["questions"]) for call in judge.calls) == [1, 4, 4, 4]
    candidates = [c["text"] for call in judge.calls for q in call["questions"] for c in q["candidates"]]
    assert max(len(text) for text in candidates) <= 450 + 2 + 120  # 450 знаков, « …» и заголовок раздела
    assert any(text.endswith(" …") for text in candidates)


def test_full_reuse_makes_no_model_calls_and_keeps_the_original_date(fake, judge):
    texts = [Q_BACKPROP, Q_POLICY, Q_PHILLIPS, Q_BAYES]
    exam_a, ids_a, materials = course(fake, texts)
    run_map(fake, exam_a)
    calls_after_a = len(judge.calls)
    dates_a = {fake.row("exam_questions", qid)["question_hash"]: fake.row("exam_questions", qid)["mapped_at"] for qid in ids_a}

    fake.clock.now += timedelta(days=2)
    exam_b = fake.exam()
    for material_id in materials:
        fake.link(exam_b, material_id)
    ids_b = [fake.question(exam_b, n, f"{n}. {text}!") for n, text in enumerate(texts, start=1)]  # тот же нормализованный текст
    events = run_map(fake, exam_b)

    assert len(judge.calls) == calls_after_a  # ни одного вызова модели
    assert [event["type"] for event in events] == ["start", "reused", "done"]
    for item in events[1]["items"]:
        assert item["reused"] is True
        row = fake.row("exam_questions", item["question_id"])
        assert item["mapped_at"] == dates_a[row["question_hash"]] == row["mapped_at"]
    done = events[-1]
    assert done["reused"] == 4 and done["used_ai"] is False and done["state"] == "done"
    oldest = min(dates_a.values(), key=ts)
    assert done["oldest_mapped_at"] == done["mapped_at"] == oldest == fake.row("exams", exam_b)["mapped_at"]
    assert {fake.row("exam_questions", qid)["coverage"] for qid in ids_b} == {"full", "none"}
    assert_honest_rows(fake)


def test_a_partly_reused_run_dates_the_exam_by_its_oldest_mark(fake, judge):
    exam_a, (a_backprop, _), materials = course(fake, [Q_BACKPROP, Q_POLICY])
    run_map(fake, exam_a)
    old_date = fake.row("exam_questions", a_backprop)["mapped_at"]

    fake.clock.now += timedelta(hours=5)
    exam_b = fake.exam()
    for material_id in materials:
        fake.link(exam_b, material_id)
    b_backprop = fake.question(exam_b, 1, Q_BACKPROP)
    b_targeting = fake.question(exam_b, 2, Q_TARGETING)
    judge.calls.clear()
    events = run_map(fake, exam_b)

    assert judge.asked() == [Q_TARGETING]
    assert [event["type"] for event in events] == ["start", "reused", "batch", "done"]
    assert items(by_type(events, "reused"))[b_backprop]["mapped_at"] == old_date
    fresh = items(by_type(events, "batch"))[b_targeting]
    assert fresh["reused"] is False and ts(fresh["mapped_at"]) > ts(old_date) + timedelta(hours=4)
    done = events[-1]
    assert done["reused"] == 1 and done["used_ai"] is True
    assert done["oldest_mapped_at"] == done["mapped_at"] == old_date
    exam = fake.row("exams", exam_b)
    assert exam["mapped_at"] == old_date and exam["mapping_state"] == "done"


def test_rechecking_an_up_to_date_question_reuses_its_own_mark_and_still_writes_first(fake, judge):
    exam_id, (q_backprop, q_policy), _ = course(fake, [Q_BACKPROP, Q_POLICY])
    run_map(fake, exam_id)
    before = dict(fake.row("exam_questions", q_backprop))
    judge.calls.clear()
    fake.log.clear()
    events = run_map(fake, exam_id, question_ids=[q_backprop])
    assert judge.calls == []
    assert [event["type"] for event in events] == ["start", "reused", "done"]
    item = events[1]["items"][0]
    assert item["question_id"] == q_backprop and item["reused"] is True and item["mapped_at"] == before["mapped_at"]
    assert fake.log.index(("write", q_backprop)) < fake.log.index(("event", "reused", [q_backprop]))
    assert fake.row("exam_questions", q_backprop)["evidence"] == before["evidence"]


def test_a_row_whose_evidence_is_not_a_lecture_fragment_is_not_reused(fake, judge):
    exam_a, (forged,), materials = course(fake, [Q_BACKPROP])
    fp = materials_fingerprint([(materials[0], DEMO), (materials[1], ECON)])
    row = fake.row("exam_questions", forged)
    row.update({
        "coverage": "full", "coverage_method": "llm", "materials_fingerprint": fp, "mapping_version": MAP_VERSION,
        "mapped_at": pg_ts("2026-09-01T10:00:00Z"),
        "evidence": [{"material_id": materials[0], "material_title": "x", "source_id": "S14", "excerpt": "Выдуманный ответ."}],
    })
    exam_b = fake.exam()
    for material_id in materials:
        fake.link(exam_b, material_id)
    fresh = fake.question(exam_b, 1, Q_BACKPROP)
    events = run_map(fake, exam_b)
    assert judge.asked() == [Q_BACKPROP]
    assert items(events)[fresh]["reused"] is False
    assert items(events)[fresh]["evidence"][0]["excerpt"] != "Выдуманный ответ."


def test_one_exam_with_the_same_question_twice_asks_once(fake, judge):
    exam_id, (first, second), _ = course(fake, [Q_INFLATION + ".", Q_INFLATION + "!"])
    events = run_map(fake, exam_id)
    assert len(judge.asked()) == 1
    marks = items(events)
    assert marks[first]["coverage"] == marks[second]["coverage"] == "full"


def test_question_ids_limit_the_run_and_manual_marks_need_force(fake, judge):
    exam_id, (q_backprop, q_policy, q_manual), _ = course(fake, [Q_BACKPROP, Q_POLICY, Q_REGULARIZATION])
    manual = fake.row("exam_questions", q_manual)
    manual.update({"coverage": "full", "coverage_method": "manual", "coverage_reason": "Отмечено вами", "evidence": []})

    events = run_map(fake, exam_id, question_ids=[q_policy, q_manual])
    assert events[0]["to_check"] == 1 and set(items(events)) == {q_policy}
    assert fake.row("exam_questions", q_backprop)["coverage"] is None

    events = run_map(fake, exam_id)  # без force ручная отметка не трогается
    assert q_manual not in items(events) and fake.row("exam_questions", q_manual)["coverage_method"] == "manual"

    judge.calls.clear()
    events = run_map(fake, exam_id, force=True)
    assert events[0]["to_check"] == 3 and q_manual in items(events)
    assert "reused" not in [event["type"] for event in events]  # force: без повторного использования
    assert fake.row("exam_questions", q_manual)["coverage_method"] == "llm"
    assert {call["kwargs"]["use_cache"] for call in judge.calls} == {False}  # «проверить заново» — не из кеша
    assert_honest_rows(fake)


def test_a_new_lecture_rechecks_partial_and_none_but_keeps_full(fake, judge):
    exam_id, (q_backprop, q_inflation), _ = course(fake, [Q_BACKPROP, Q_INFLATION], materials=(("Нейронные сети", DEMO),))
    run_map(fake, exam_id)
    assert fake.row("exam_questions", q_inflation)["coverage"] == "none"
    judge.calls.clear()
    econ = fake.material("Денежный рынок", ECON)
    fake.link(exam_id, econ)
    events = run_map(fake, exam_id)
    assert judge.asked() == [Q_INFLATION]
    assert events[0]["to_check"] == 1
    assert fake.row("exam_questions", q_inflation)["coverage"] == "full"
    assert fake.row("exam_questions", q_backprop)["coverage"] == "full"


# ── Ошибки до потока, блокировка, сбои ─────────────────────────────────────────


def test_errors_before_the_stream(fake, judge):
    assert (map_error(fake, "not-a-uuid").status, map_error(fake, "not-a-uuid").detail) == (404, "Экзамен не найден")
    assert fake.requests == []
    assert map_error(fake, str(uuid.uuid4())).status == 404

    foreign, _, _ = course(fake, [Q_BACKPROP], user="user-b")
    assert map_error(fake, foreign).status == 404

    empty = fake.exam()
    assert (map_error(fake, empty).status, map_error(fake, empty).detail) == (400, "В экзамене нет вопросов")

    unlinked = fake.exam()
    fake.question(unlinked, 1, Q_BACKPROP)
    error = map_error(fake, unlinked)
    assert (error.status, error.detail) == (422, "К экзамену не добавлены лекции. Добавьте лекции с текстом и повторите.")

    scans, _, _ = course(fake, [Q_BACKPROP], materials=(("Скан лекции", "  \n "),))
    error = map_error(fake, scans)
    assert error.status == 422 and error.detail.startswith("Ни у одной лекции нет текста")

    huge, _, _ = course(fake, [Q_BACKPROP], materials=(("Огромная", "слово " * 500_001),))
    assert map_error(fake, huge).status == 413

    assert not any(request.method == "PATCH" for request in fake.requests)
    assert all(exam["mapping_state"] == "none" for exam in fake.tables["exams"])


def test_409_while_a_fresh_run_holds_the_lock_and_a_stale_lock_is_taken_over(fake, judge):
    exam_id, _, _ = course(fake, [Q_BACKPROP], mapping_state="running", mapping_started_at=T0 - timedelta(minutes=1))
    error = map_error(fake, exam_id)
    assert (error.status, error.detail) == (409, MAPPING_RUNNING_DETAIL)
    assert not any(request.method == "PATCH" for request in fake.requests)

    fake.row("exams", exam_id)["mapping_started_at"] = pg_ts(T0 - timedelta(minutes=6))
    events = run_map(fake, exam_id)
    assert events[-1]["type"] == "done" and fake.row("exams", exam_id)["mapping_state"] == "done"


def test_409_when_another_run_takes_the_lock_between_the_read_and_the_patch(fake, judge):
    exam_id, _, _ = course(fake, [Q_BACKPROP])

    def lock_taken(request):
        if "or" in request.url.params:
            fake.row("exams", exam_id).update({"mapping_state": "running", "mapping_started_at": pg_ts(fake.clock.now)})
        return None

    fake.fail[("PATCH", "exams")] = lock_taken
    error = map_error(fake, exam_id)
    assert (error.status, error.detail) == (409, MAPPING_RUNNING_DETAIL)


def test_a_failed_lock_write_is_503_not_a_missing_exam(fake, judge):
    exam_id, _, _ = course(fake, [Q_BACKPROP])
    fake.fail[("PATCH", "exams")] = 500
    error = map_error(fake, exam_id)
    assert (error.status, error.detail) == (503, "Не удалось начать сверку с лекциями. Повторите через минуту.")


def test_the_lock_is_released_after_an_exception(fake, judge, monkeypatch):
    exam_id, _, _ = course(fake, [Q_BACKPROP], mapping_state="done", mapped_at=T0 - timedelta(days=1))

    def broken(*args, **kwargs):
        raise RuntimeError("секретная подробность сбоя")

    monkeypatch.setattr(exams_map, "_search_candidates", broken)
    events = run_map(fake, exam_id)
    assert events == [{"type": "error", "message": INTERNAL_MESSAGE}]
    exam = fake.row("exams", exam_id)
    assert exam["mapping_state"] == "failed"


def test_a_failed_write_ends_the_stream_with_error_and_a_failed_state(fake, judge):
    exam_id, _, _ = course(fake, [Q_BACKPROP, Q_PHILLIPS])
    fake.fail[("PATCH", "exam_questions")] = 500
    events = run_map(fake, exam_id)
    assert [event["type"] for event in events] == ["start", "error"]
    assert events[-1]["message"] == WRITE_FAILED_MESSAGE
    # На листе у сбоя кнопка «Повторить»: текст не называет кнопку, которой нет.
    assert WRITE_FAILED_MESSAGE == "Не удалось сохранить результаты сверки. Уже проверенные вопросы сохранены — повторите через минуту."
    assert fake.row("exams", exam_id)["mapping_state"] == "failed"
    assert fake.row("exams", exam_id)["mapped_material_ids"] == []  # после сбоя набор лекций разметки не меняется
    assert "internal details" not in json.dumps(events, ensure_ascii=False)


def test_release_unstarted_puts_back_the_previous_state(fake, judge):
    exam_id, _, _ = course(fake, [Q_BACKPROP], mapping_state="done", mapped_at=T0 - timedelta(days=1))

    async def go():
        job = await prepare_mapping(SupabaseRest("token-a"), exam_id)
        assert fake.row("exams", exam_id)["mapping_state"] == "running"
        await release_unstarted(job)
        await release_unstarted(job)  # второй раз ничего не делает
        return job

    job = asyncio.run(go())
    assert job.started is True
    assert fake.row("exams", exam_id)["mapping_state"] == "done"
    assert sum(1 for request in fake.requests if request.method == "PATCH") == 2  # блокировка и её снятие


def test_release_unstarted_does_nothing_once_the_stream_started(fake, judge):
    exam_id, _, _ = course(fake, [Q_BACKPROP])

    async def go():
        job = await prepare_mapping(SupabaseRest("token-a"), exam_id)
        events = [event async for event in run_mapping(job)]
        patches = sum(1 for request in fake.requests if request.method == "PATCH")
        await release_unstarted(job)
        return events, patches

    events, patches = asyncio.run(go())
    assert events[-1]["type"] == "done"
    assert sum(1 for request in fake.requests if request.method == "PATCH") == patches
    assert fake.row("exams", exam_id)["mapping_state"] == "done"


def test_rows_stay_honest_after_mixed_runs(fake, judge):
    exam_id, question_ids, _ = course(fake, [Q_BACKPROP, Q_ACTIVATION, Q_PHILLIPS, Q_POLICY, Q_BAYES, Q_TARGETING])
    calls = {"n": 0}

    def script(questions, call_number):
        calls["n"] += 1
        if calls["n"] == 2:
            return AIError.busy()
        return {"results": [
            {"n": q["n"], "coverage": random.Random(q["n"]).choice(["full", "partial", "none"]),
             "support": [random.Random(q["n"] + 1).choice(["C1", "C2", "C5", "C8"])], "missing": "x", "reason": "y"}
            for q in questions
        ]}

    judge.script = script
    run_map(fake, exam_id)
    run_map(fake, exam_id, force=True)
    assert_honest_rows(fake)


# ── Скрипт ворот 3: функция согласия ───────────────────────────────────────────


def _accuracy_module():
    name = "mapping_accuracy_under_test"
    if name not in sys.modules:
        spec = importlib.util.spec_from_file_location(name, BACKEND / "scripts" / "mapping_accuracy.py")
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module  # dataclasses ищут модуль класса в sys.modules
        spec.loader.exec_module(module)
    return sys.modules[name]


def test_mapping_accuracy_agreement_counts_classes_presence_and_false_full():
    accuracy = _accuracy_module()
    Mark = accuracy.MachineMark
    machine = {
        1: Mark("full", "llm"), 2: Mark("partial", "llm"), 3: Mark("none", "lexical"), 4: Mark("full", "llm"),
        5: Mark("partial", "llm"), 6: Mark("unverified", "lexical"), 7: Mark(None, None), 8: Mark("full", "manual"),
        9: Mark("none", "llm"),
    }
    reference = {1: "full", 2: "full", 3: "none", 4: "none", 5: "partial", 6: "full", 7: "none", 8: "none", 10: "full"}
    result = accuracy.agreement(machine, reference)
    assert result.compared == 7  # без ручной отметки (8) и позиции 10, которой нет в экзамене
    assert result.exact == 3  # 1, 3, 5
    assert result.presence == 4  # 1, 2, 3, 5 — unverified и неразмеченный не совпадают
    assert result.false_full == 1  # 4
    assert result.undecided == 2
    assert result.manual == [8] and result.missing_in_exam == [10] and result.unreferenced == [9]
    assert [(d.position, d.reference, d.machine) for d in result.disagreements] == [
        (2, "full", "partial"), (4, "none", "full"), (6, "full", "unverified"), (7, "none", None),
    ]
    assert result.exact_share == pytest.approx(3 / 7) and result.passed() is False

    perfect = accuracy.agreement({1: Mark("full", "llm"), 2: Mark("none", "llm")}, {1: "full", 2: "none"})
    assert perfect.exact_share == perfect.presence_share == 1.0 and perfect.passed() is True
    assert accuracy.agreement({}, {1: "full"}).passed() is False


def test_mapping_accuracy_reads_the_reference_csv():
    accuracy = _accuracy_module()
    assert accuracy.parse_reference("﻿позиция;покрытие\n1;full\n2; Частично \n\n# комментарий\n3;нет\n") == {
        1: "full", 2: "partial", 3: "none",
    }
    assert accuracy.parse_reference("1,none\n2,partial\n") == {1: "none", 2: "partial"}
    for bad in ("1;maybe\n", "1;full\n1;none\n", "позиция;покрытие\n", "1;full\nx;none\n"):
        with pytest.raises(accuracy.ReferenceFileError):
            accuracy.parse_reference(bad)
    marks, repeated = accuracy.machine_marks([
        {"position": 1, "text": "А", "coverage": "full", "coverage_method": "llm"},
        {"position": 1, "text": "Б", "coverage": "none", "coverage_method": "llm"},
    ])
    assert marks[1].text == "А" and repeated == [1]


def test_mapping_accuracy_script_reads_with_the_owner_token_and_never_writes(fake, judge, monkeypatch, tmp_path, capsys):
    accuracy = _accuracy_module()
    exam_id, (q1, q2, q3), _ = course(fake, [Q_BACKPROP, Q_PHILLIPS, Q_ACTIVATION])
    run_map(fake, exam_id)  # 1 — есть, 2 — нет (по словам), 3 — частично
    fake.requests.clear()
    reference = tmp_path / "эталон.csv"
    reference.write_text("позиция;покрытие\n1;full\n2;none\n3;full\n", encoding="utf-8")
    monkeypatch.setenv("MELDY_TOKEN", "token-a")

    assert accuracy.main([exam_id, str(reference)]) == 1  # 2 из 3 = 66,7% < 80%
    out = capsys.readouterr().out
    assert "Совпадение по трём классам: 2 из 3 = 66,7%" in out and "НЕ пройдено" in out
    assert "«Есть / нет»: 3 из 3 = 100,0%" in out
    assert "№ 3: эталон — есть, разметка — частично." in out
    assert fake.requests and {request.method for request in fake.requests} == {"GET"}
    assert all(request.headers["authorization"] == "Bearer token-a" for request in fake.requests)

    reference.write_text("1;full\n2;none\n3;partial\n", encoding="utf-8")
    assert accuracy.main([exam_id, str(reference), "--json"]) == 0
    report = json.loads(capsys.readouterr().out)
    assert report["exact"] == 3 and report["passed"] is True and report["disagreements"] == []

    monkeypatch.setenv("MELDY_TOKEN", "token-b")  # чужой экзамен не виден
    assert accuracy.main([exam_id, str(reference)]) == 2
    monkeypatch.delenv("MELDY_TOKEN")
    assert accuracy.main([exam_id, str(reference)]) == 2
