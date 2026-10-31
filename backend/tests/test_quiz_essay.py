"""«Развёрнутый ответ» контрольной: проверка по лекциям (quiz_essay.py, выпуск 48, docs/kinds/CONTRACT.md §3.4).

Вердикт по статусам пунктов, отказы без ответа, без лекций и без ответа в лекциях (без модели и без списания),
полная проверка (пункты из лекций, протокол, оценка сохраняется с source ai), пункты одного вопроса — один раз,
401 и формат. Supabase — подменённый клиент, модель — подменённые build_points и judge_answer.
"""
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import oral_api  # noqa: E402
import quiz_essay  # noqa: E402

ATTEMPT = "0f000000-0000-4000-8000-000000000001"
ITEM = "0f000000-0000-4000-8000-000000000002"
LECTURE = "0f000000-0000-4000-8000-000000000003"
POINTS = [
    {"id": "p1", "title": "Денежная реформа", "essential": True, "source_quote": "Денежная реформа 1839 года ввела серебряный рубль."},
    {"id": "p2", "title": "Военная реформа", "essential": True, "source_quote": "Военная реформа сократила срок службы."},
    {"id": "p3", "title": "Судебная реформа", "essential": False, "source_quote": "Суд присяжных."},
]


def statuses(**by_id):
    return {"points": [{"id": k, "status": v} for k, v in by_id.items()]}


def test_verdict_full_when_every_main_point_is_named():
    assert quiz_essay.verdict_of(POINTS, statuses(p1="covered", p2="covered", p3="missing")) == ("full", POINTS[0]["source_quote"])


def test_verdict_partial_quotes_the_first_main_point_missed():
    verdict, quote = quiz_essay.verdict_of(POINTS, statuses(p1="covered", p2="missing", p3="covered"))
    assert verdict == "partial" and quote == POINTS[1]["source_quote"]
    assert quiz_essay.verdict_of(POINTS, statuses(p1="partial", p2="missing"))[0] == "partial"


def test_verdict_none_and_a_wrong_point_is_not_full():
    assert quiz_essay.verdict_of(POINTS, statuses(p1="missing", p2="missing", p3="missing")) == ("none", POINTS[0]["source_quote"])
    assert quiz_essay.verdict_of(POINTS, statuses(p1="covered", p2="covered", p3="wrong"))[0] == "partial"


def test_verdict_without_main_points_takes_them_all():
    plain = [dict(p, essential=False) for p in POINTS]
    assert quiz_essay.verdict_of(plain, statuses(p1="covered", p2="covered", p3="covered"))[0] == "full"
    assert quiz_essay.verdict_of(plain, statuses(p1="covered"))[0] == "partial"


class FakeDb:
    def __init__(self, task):
        self.task = task
        self.calls = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return None

    async def rpc(self, fn, args):
        self.calls.append((fn, args))
        if fn == "quiz_essay_task":
            return self.task
        if fn == "quiz_essay_mark":
            return {"verdict": args["p_verdict"], "quote": args["p_quote"], "source": args["p_source"]}
        raise AssertionError(fn)


@pytest.fixture
def api(monkeypatch):
    import main
    from fastapi.testclient import TestClient

    async def fake_user(request):
        if request.headers.get("authorization") != "Bearer token-a":
            raise HTTPException(status_code=401, detail="Требуется войти в аккаунт")
        return {"id": "user-a"}

    monkeypatch.setattr(main, "require_authenticated_user", fake_user)
    monkeypatch.setattr(main.limiter, "enabled", False)
    state = {"task": {"stem": "Расскажите о реформах", "text": "Были денежная и военная реформы.", "material_ids": [LECTURE]},
             "points_built": 0, "judged": [], "db": None}

    def make_db(token):
        assert token == "token-a"
        state["db"] = FakeDb(state["task"])
        return state["db"]

    async def fake_lectures(db, ids):
        return oral_api.ExamLectures(list(ids), ["lecture"], None)

    async def fake_points(token, stem, lectures):
        state["points_built"] += 1
        return list(POINTS)

    async def fake_judge(stem, points, text):
        state["judged"].append(text)
        return statuses(p1="covered", p2="missing", p3="missing")

    async def no_charge(*args, **kwargs):
        return None

    monkeypatch.setattr(quiz_essay, "SupabaseRest", make_db)
    monkeypatch.setattr(quiz_essay.oral_api, "load_exam_lectures", fake_lectures)
    monkeypatch.setattr(quiz_essay, "build_points", fake_points)
    monkeypatch.setattr(quiz_essay.oral_api, "judge_answer", fake_judge)
    monkeypatch.setattr(quiz_essay.quota, "charge", no_charge)

    class NoRefund:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

    monkeypatch.setattr(quiz_essay.quota, "refund_on_failure", NoRefund)
    quiz_essay._reset_for_tests()
    client = TestClient(main.app, headers={"Authorization": "Bearer token-a"})
    client.state_ = state
    yield client
    quiz_essay._reset_for_tests()


def post(api, **body):
    return api.post("/api/quiz/essay-check", json={"attempt_id": ATTEMPT, "item_id": ITEM, **body})


def test_check_marks_the_essay_by_the_lectures(api):
    response = post(api)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["verdict"] == "partial" and body["source"] == "ai"
    assert body["quote"] == POINTS[1]["source_quote"]
    assert [p["status"] for p in body["points"]] == ["covered", "missing", "missing"]
    fn, args = api.state_["db"].calls[-1]
    assert fn == "quiz_essay_mark" and args["p_verdict"] == "partial" and args["p_source"] == "ai"
    assert api.state_["judged"] == ["Были денежная и военная реформы."]


def test_the_points_of_one_question_are_built_once(api):
    assert post(api).status_code == 200
    assert post(api).status_code == 200
    assert api.state_["points_built"] == 1 and len(api.state_["judged"]) == 2


@pytest.mark.parametrize(
    "task, code",
    [
        ({"stem": "В", "text": None, "material_ids": [LECTURE]}, "unanswered"),
        ({"stem": "В", "text": "Ответ", "material_ids": []}, "no_lectures"),
        (None, "not_found"),
    ],
)
def test_refusals_spend_nothing(api, task, code):
    api.state_["task"] = task
    response = post(api)
    assert response.status_code in (404, 409) and response.json()["code"] == code
    assert api.state_["points_built"] == 0 and api.state_["judged"] == []


def test_not_in_lectures(api, monkeypatch):
    async def none(token, stem, lectures):
        return []

    monkeypatch.setattr(quiz_essay, "build_points", none)
    response = post(api)
    assert response.status_code == 409 and response.json()["code"] == "not_in_lectures"
    assert api.state_["judged"] == []


def test_needs_a_session_and_ids(api):
    assert api.post("/api/quiz/essay-check", json={"attempt_id": ATTEMPT, "item_id": ITEM}, headers={"Authorization": ""}).status_code == 401
    assert post(api, item_id="нет").status_code == 400
