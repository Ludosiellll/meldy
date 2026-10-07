"""Подсказка «какие лекции подходят к вопросам» (lecture_fit.py, POST /api/exams/lecture-fit).

Калибровка правила 07.10.2026 (скрипт вне репозитория). Данные: курс «Базы данных» — три лекции
e2e-прогона (третья — tests/fixtures/live_course) и 20 вопросов questions_databases.txt, из них 8
(B-деревья) и 16 (NoSQL) в лекциях не раскрыты; пример /try — три лекции и 12 вопросов
frontend/src/data/example, вопрос 12 в лекциях не раскрыт. Помехи — лекции друг друга, педагогика,
информатика, веб-разработка «ПР 9», статистика, история, биология, нейросети, денежный рынок.

  набор                                  точность «подходит»  полнота  «без подходящей лекции»
  БД: только курс (3 лекции)             1,00                 1,00     8, 16
  пример: только курс (3 лекции)         1,00                 0,91     11*, 12
  БД: курс + пример + педагогика (7)     1,00                 1,00     8, 16
  пример: то же (7)                      1,00                 1,00     12
  БД: 14 лекций                          1,00                 1,00     8, 16
  пример: 14 лекций                      1,00                 1,00     12
  * вопрос 11 примера раскрыт в лекции частично: покрытие 0,31 при пороге 0,35 (8 основ).

Самые узкие запасы: вопрос 8 (B-деревья) — покрытие 0,22–0,24 при пороге 0,30; вопрос 2 —
0,58–0,63 при 0,50; вопрос 10 примера — 0,58–0,63 при 0,50; вопрос 20 (практическое задание на
3НФ) — 0,44–0,46 при 0,30; NoSQL — 0,30–0,35 при 0,50. При пороге 0,6 оценки лучшей лекции
(вместо 0,7) подходила бы и лекция по SQL к вопросу о COMMIT и ROLLBACK: она их упоминает. Ограничение: если нужной лекции нет, её место может занять лекция с теми же
бытовыми словами (практическое задание «…средний балл группы…» без лекции по SQL — к тексту по
педагогике про средний балл группы); подсказка об этом и говорит: «точнее покажет сверка».

Здесь — правило на коротких текстах, регрессия на примере /try и лекции 3 курса БД (данные
репозитория), маршрут: только свои лекции с токеном пользователя, потолки, кеш, ошибки.
"""
import asyncio
import json
import re
import sys
import uuid
from pathlib import Path

import httpx
import pytest
from fastapi import HTTPException

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

import exams_api  # noqa: E402
import lecture_fit  # noqa: E402
import supabase_rest  # noqa: E402
from agents.base import BaseAgent  # noqa: E402
from lecture_fit import coverage_floor, fitting_lectures, question_terms  # noqa: E402
from parser import extract_text  # noqa: E402
from retrieval import BM25Index, material_passages, stem  # noqa: E402
from test_exams_map import ANON, TOKENS, URL, FakeSupabase, pg_ts  # noqa: E402

EXAMPLE = BACKEND.parent / "frontend" / "src" / "data" / "example"
LIVE_COURSE = BACKEND / "tests" / "fixtures" / "live_course"

PEDAGOGY = """Процесс обучения и методы обучения

Обучение — целенаправленный процесс взаимодействия преподавателя и студентов. Процесс обучения включает цель, содержание, методы, средства и результат.

Контроль и оценка результатов обучения. Текущий контроль проводится на каждом занятии, промежуточный — зачёт и экзамен. Оценка выражает результат контроля в баллах."""

INFLATION = """Инфляция

Инфляция — устойчивый рост общего уровня цен в экономике. По темпу различают умеренную, галопирующую инфляцию и гиперинфляцию.

Причины инфляции: избыточный совокупный спрос (инфляция спроса) и рост издержек производства (инфляция издержек)."""

LABOUR = """Рынок труда

Спрос на труд предъявляют фирмы, предложение труда — работники. Заработная плата — цена труда.

Безработица — часть рабочей силы, которая ищет работу и не находит её. Различают фрикционную, структурную и циклическую безработицу."""

PLAN_ONLY = """Лекция 7. Обзор курса

План лекции
1. Инфляция: виды и причины.
2. Рынок труда и безработица.
3. Денежно-кредитная политика.

Сегодня мы говорим о том, как устроен курс, где брать задания и как сдавать зачёт по дисциплине."""


def index_of(lectures: dict[str, str]) -> BM25Index:
    return BM25Index([passage for material_id, text in lectures.items() for passage in material_passages(material_id, "", text)])


def example_questions() -> list[str]:
    source = (EXAMPLE / "questions.ts").read_text(encoding="utf-8")
    found = re.findall(r"id: 'q(\d+)',\s*\n(?:.*\n)?\s*text: '([^']*)'", source)
    assert [int(number) for number, _ in found] == list(range(1, 13))
    return [text for _, text in found]


def database_questions() -> list[str]:
    lines = (LIVE_COURSE / "questions_databases.txt").read_text(encoding="utf-8").splitlines()
    found = [match.group(1) for match in (re.match(r"^\d+\.\s+(.*)$", line.strip()) for line in lines) if match]
    assert len(found) == 20
    return found


@pytest.fixture(autouse=True)
def _fresh_cache():
    lecture_fit.reset_cache()
    yield
    lecture_fit.reset_cache()


# ── Правило ─────────────────────────────────────────────────────────────────────


def test_question_terms_drop_instructions_ordinals_and_task_verbs():
    assert question_terms("Опишите понятие инфляции и её виды.") == [stem("инфляции")]
    assert question_terms("Первая и вторая нормальные формы.") == [stem("нормальные"), stem("формы")]
    assert stem("составьте") in lecture_fit.FIT_STOPWORDS and stem("третья") in lecture_fit.FIT_STOPWORDS
    assert question_terms("Составьте SQL-запрос") == ["sql", stem("запрос")]
    assert question_terms("Раскройте роль и значение.") == []


def test_coverage_floor_falls_with_the_length_of_the_question():
    assert [round(coverage_floor(count), 2) for count in range(1, 12)] == [0.5, 0.5, 0.5, 0.5, 0.5, 0.45, 0.4, 0.35, 0.3, 0.3, 0.3]


def test_a_lecture_fits_by_its_explaining_fragment_and_a_common_word_fits_nothing_else():
    index = index_of({"infl": INFLATION, "labour": LABOUR, "ped": PEDAGOGY})
    assert fitting_lectures(index, "Инфляция: виды и причины.") == {"infl"}
    assert fitting_lectures(index, "Рынок труда и безработица.") == {"labour"}
    # «Процесс» есть и в педагогике, но покрытие вопроса — только у лекции об инфляции нет: ни одна не подходит.
    assert fitting_lectures(index, "Процесс глобализации мировой экономики.") == set()
    assert fitting_lectures(index, "Составьте и опишите.") == set()


def test_a_plan_or_contents_never_makes_a_lecture_fit():
    index = index_of({"plan": PLAN_ONLY, "ped": PEDAGOGY})
    # Слова вопроса есть только в плане лекции 7: план тему не объясняет — лекция не подходит.
    assert fitting_lectures(index, "Инфляция: виды и причины.") == set()
    with_lecture = index_of({"plan": PLAN_ONLY, "infl": INFLATION})
    assert fitting_lectures(with_lecture, "Инфляция: виды и причины.") == {"infl"}


SOFTWARE = """Программное обеспечение

Программное обеспечение — все программы компьютера: программное обеспечение бывает разным.

Системное программное обеспечение управляет компьютером: операционные системы, драйверы, утилиты.

Прикладные программы решают задачи пользователя: текстовые редакторы, электронные таблицы, графические редакторы. Инструменты программирования — трансляторы, отладчики и среды разработки — нужны тем, кто сам пишет программы."""


def test_coverage_is_the_best_of_the_lecture_s_three_top_fragments(monkeypatch):
    index = index_of({"soft": SOFTWARE, "infl": INFLATION, "labour": LABOUR, "ped": PEDAGOGY})
    question = "Прикладное программное обеспечение и инструменты программирования."
    top = index.top_per_material(question_terms(question), per_material=3)["soft"]
    # Короткий абзац с «программным обеспечением» обгоняет по BM25 абзац, где вопрос раскрыт.
    assert [item.passage.source_id for item in top[:2]] == ["S02", "S04"]
    assert top[0].idf_share < coverage_floor(5) <= top[1].idf_share
    assert fitting_lectures(index, question) == {"soft"}
    monkeypatch.setattr(lecture_fit, "PASSAGES_PER_LECTURE", 1)
    assert fitting_lectures(index, question) == set()


def test_lectures_close_to_the_best_fit_together_and_a_far_one_does_not():
    copy = INFLATION.replace("Инфляция\n", "Инфляция (копия)\n")
    index = index_of({"first": INFLATION, "second": copy, "labour": LABOUR})
    assert fitting_lectures(index, "Инфляция спроса и инфляция издержек.") == {"first", "second"}
    # «Спрос» есть и в лекции о рынке труда, но её фрагмент далеко от лучшего: не подходит.
    assert "labour" not in fitting_lectures(index, "Инфляция спроса и инфляция издержек.")


def test_regression_on_the_example_and_the_databases_lecture():
    lectures = {
        "M1": (EXAMPLE / "lecture-demand-supply.txt").read_text(encoding="utf-8"),
        "M2": (EXAMPLE / "lecture-elasticity.txt").read_text(encoding="utf-8"),
        "M3": (EXAMPLE / "lecture-costs.txt").read_text(encoding="utf-8"),
        "L3": extract_text((LIVE_COURSE / "lecture3_normalization_transactions.docx").read_bytes(), "upload.docx"),
        "P1": PEDAGOGY,
    }
    index = index_of(lectures)
    expected = ["M1"] * 4 + ["M2"] * 4 + ["M3"] * 3
    found = [fitting_lectures(index, question) for question in example_questions()]
    assert found[:11] == [{lecture} for lecture in expected]
    assert found[11] == set()  # «Рынок труда: спрос на труд и заработная плата» — нет в лекциях примера

    db = [fitting_lectures(index, question) for question in database_questions()]
    for number in (13, 14, 15, 17, 18, 20):  # нормализация и транзакции — лекция 3
        assert db[number - 1] == {"L3"}, number
    assert db[8 - 1] == set() and db[16 - 1] == set()  # B-деревья и NoSQL — ни в одной лекции
    assert not any(found_ & {"M1", "M2", "M3"} for found_ in db)  # экономика к базам данных не подходит


# ── Маршрут ─────────────────────────────────────────────────────────────────────


@pytest.fixture
def api(monkeypatch):
    import main
    from fastapi.testclient import TestClient

    async def fake_user(request):
        token = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
        if token not in TOKENS:
            raise HTTPException(status_code=401, detail="Требуется войти в аккаунт")
        return {"id": TOKENS[token]}

    async def no_model(*args, **kwargs):
        raise AssertionError("подсказка не вызывает модель")

    monkeypatch.setattr(main, "require_authenticated_user", fake_user)
    monkeypatch.setattr(main.limiter, "enabled", False)
    monkeypatch.setenv("SUPABASE_URL", URL)
    monkeypatch.setenv("SUPABASE_KEY", ANON)
    monkeypatch.setattr(BaseAgent, "run", no_model)
    fake = FakeSupabase()
    monkeypatch.setattr(supabase_rest, "_transport", httpx.MockTransport(fake.handler))
    builds = []
    real_build = lecture_fit._build_index

    def counted_build(lectures):
        builds.append([material_id for material_id, _ in lectures])
        return real_build(lectures)

    monkeypatch.setattr(lecture_fit, "_build_index", counted_build)
    clock = {"now": 1000.0}
    monkeypatch.setattr(lecture_fit, "_clock", lambda: clock["now"])
    client = TestClient(main.app, headers={"Authorization": "Bearer token-a"})
    client.fake = fake
    client.builds = builds
    client.clock = clock
    return client


def add(fake, title, text, created, user="user-a"):
    material_id = fake.material(title, text, user=user)
    fake.row("materials", material_id)["created_at"] = pg_ts(created)
    return material_id


def text_reads(fake):
    return [request for request in fake.requests if "original_text" in request.url.params.get("select", "")]


QUESTIONS = ["Инфляция: виды и причины.", "Рынок труда и безработица.", "Кривая Филлипса."]


def test_answers_by_question_and_by_lecture_reading_only_own_lectures_with_the_user_token(api):
    infl = add(api.fake, "Инфляция", INFLATION, "2026-10-03T09:00:00Z")
    labour = add(api.fake, "Рынок труда", LABOUR, "2026-10-02T09:00:00Z")
    scan = add(api.fake, "Скан", "  ", "2026-10-01T09:00:00Z")
    foreign = add(api.fake, "Чужая инфляция", INFLATION, "2026-10-04T09:00:00Z", user="user-b")

    response = api.post("/api/exams/lecture-fit", json={"questions": QUESTIONS, "material_ids": [infl, labour, scan, foreign, "not-a-uuid"]})
    assert response.status_code == 200, response.text
    assert response.json() == {
        "questions": [{"lectures": [infl]}, {"lectures": [labour]}, {"lectures": []}],
        "lectures": [{"id": infl, "questions": [0]}, {"id": labour, "questions": [1]}],
        "unmatched": [2],
        "skipped": [{"id": foreign, "reason": "missing"}, {"id": scan, "reason": "no_text"}],
        "checked_chars": len(INFLATION) + len(LABOUR),
        "limit_chars": lecture_fit.MAX_TOTAL_CHARS,
    }
    # Только чтение, только с токеном пользователя и только его строки.
    assert api.fake.requests and all(request.method == "GET" for request in api.fake.requests)
    assert all(request.headers["authorization"] == "Bearer token-a" for request in api.fake.requests)
    assert all(request.url.params.get("user_id") == "eq.user-a" for request in api.fake.requests)

    # Без material_ids — все свои лекции, от новых к старым; чужая не видна.
    everything = api.post("/api/exams/lecture-fit", json={"questions": QUESTIONS[:1]}).json()
    assert [lecture["id"] for lecture in everything["lectures"]] == [infl, labour]
    assert everything["skipped"] == [{"id": scan, "reason": "no_text"}]


def test_the_cache_keeps_the_index_and_reads_texts_again_only_for_a_new_set_or_after_five_minutes(api):
    infl = add(api.fake, "Инфляция", INFLATION, "2026-10-03T09:00:00Z")
    labour = add(api.fake, "Рынок труда", LABOUR, "2026-10-02T09:00:00Z")
    body = {"questions": QUESTIONS, "material_ids": [infl, labour]}

    first = api.post("/api/exams/lecture-fit", json=body).json()
    assert len(api.builds) == 1 and len(text_reads(api.fake)) == 1
    # Тот же набор: только id и даты лекций (RLS), без текстов и без нового индекса.
    again = api.post("/api/exams/lecture-fit", json={**body, "questions": list(reversed(QUESTIONS))}).json()
    assert len(api.builds) == 1 and len(text_reads(api.fake)) == 1
    assert again["questions"] == list(reversed(first["questions"]))
    assert api.fake.requests[-1].url.params["select"] == "id,created_at"

    # Набор сменился: тексты читаются, индекс строится для нового отпечатка.
    ped = add(api.fake, "Педагогика", PEDAGOGY, "2026-10-04T09:00:00Z")
    api.post("/api/exams/lecture-fit", json={**body, "material_ids": [infl, labour, ped]})
    assert len(api.builds) == 2 and len(text_reads(api.fake)) == 2
    # Прежний набор снова: отпечаток прежний, индекс из кеша.
    api.post("/api/exams/lecture-fit", json=body)
    assert len(api.builds) == 2

    # Через 5 минут тексты читаются заново, индекс строится заново.
    api.clock["now"] += lecture_fit.CACHE_SECONDS + 1
    api.post("/api/exams/lecture-fit", json=body)
    assert len(api.builds) == 3 and len(text_reads(api.fake)) == 3

    # Кеш — у каждого пользователя свой: те же тексты другого пользователя читаются его токеном.
    other_infl = add(api.fake, "Инфляция", INFLATION, "2026-10-03T09:00:00Z", user="user-b")
    other = api.post("/api/exams/lecture-fit", json={"questions": QUESTIONS, "material_ids": [other_infl]},
                     headers={"Authorization": "Bearer token-b"})
    assert other.json()["lectures"] == [{"id": other_infl, "questions": [0]}]
    assert len(api.builds) == 4
    assert text_reads(api.fake)[-1].headers["authorization"] == "Bearer token-b"


def test_text_past_the_limit_is_not_checked_newest_lectures_first(api, monkeypatch):
    monkeypatch.setattr(lecture_fit, "MAX_TOTAL_CHARS", len(INFLATION) + len(LABOUR))
    newest = add(api.fake, "Инфляция", INFLATION, "2026-10-05T09:00:00Z")
    middle = add(api.fake, "Педагогика", PEDAGOGY, "2026-10-04T09:00:00Z")  # длиннее остатка
    oldest = add(api.fake, "Рынок труда", LABOUR, "2026-10-03T09:00:00Z")  # помещается в остаток
    assert len(PEDAGOGY) > len(LABOUR)

    body = api.post("/api/exams/lecture-fit", json={"questions": QUESTIONS, "material_ids": [oldest, middle, newest]}).json()
    assert [lecture["id"] for lecture in body["lectures"]] == [newest, oldest]
    assert body["skipped"] == [{"id": middle, "reason": "limit"}]
    assert body["checked_chars"] == len(INFLATION) + len(LABOUR) == body["limit_chars"]
    assert body["questions"][:2] == [{"lectures": [newest]}, {"lectures": [oldest]}]

    # Остаток исчерпан: следующие лекции не читаются вовсе, а помечаются «limit».
    monkeypatch.setattr(lecture_fit, "MAX_TOTAL_CHARS", len(INFLATION))
    monkeypatch.setattr(lecture_fit, "TEXT_CHUNK", 1)
    lecture_fit.reset_cache()
    reads_before = len(text_reads(api.fake))
    body = api.post("/api/exams/lecture-fit", json={"questions": QUESTIONS, "material_ids": [oldest, middle, newest]}).json()
    assert [lecture["id"] for lecture in body["lectures"]] == [newest]
    assert body["skipped"] == [{"id": middle, "reason": "limit"}, {"id": oldest, "reason": "limit"}]
    assert len(text_reads(api.fake)) == reads_before + 1


def test_lectures_past_the_count_limit_are_skipped(api, monkeypatch):
    monkeypatch.setattr(lecture_fit, "MAX_LECTURES", 1)
    newest = add(api.fake, "Инфляция", INFLATION, "2026-10-05T09:00:00Z")
    older = add(api.fake, "Рынок труда", LABOUR, "2026-10-04T09:00:00Z")
    body = api.post("/api/exams/lecture-fit", json={"questions": QUESTIONS}).json()
    assert [lecture["id"] for lecture in body["lectures"]] == [newest]
    assert body["skipped"] == [{"id": older, "reason": "limit"}]


def test_body_limits_and_bad_bodies(api):
    infl = add(api.fake, "Инфляция", INFLATION, "2026-10-03T09:00:00Z")
    url = "/api/exams/lecture-fit"
    for bad in (None, [], {"questions": []}, {"questions": "Инфляция"}, {"questions": ["Инфляция", 5]},
                {"questions": ["Инфляция"] * (lecture_fit.MAX_QUESTIONS + 1)},
                {"questions": ["Инфляция"], "material_ids": "все"},
                {"questions": ["Инфляция"], "material_ids": [infl] * (lecture_fit.MAX_MATERIAL_IDS + 1)}):
        response = api.post(url, content=json.dumps(bad), headers={"Content-Type": "application/json"})
        assert response.status_code == 400, bad
        assert response.json() == {"detail": exams_api.BAD_BODY_DETAIL}
    assert api.post(url, content=b"{not json").status_code == 400
    huge = api.post(url, json={"questions": ["Инфляция " * 60] * 300, "padding": "я" * exams_api.FIT_BODY_LIMIT})
    assert huge.status_code == 413 and huge.json() == {"detail": exams_api.FIT_TOO_LARGE_DETAIL}
    assert api.fake.requests == []

    # Длинный вопрос режется до 600 знаков, а не отклоняет весь список; 300 вопросов — можно.
    long_question = "Инфляция: виды и причины. " + "Инфляция спроса и инфляция издержек. " * 30
    ok = api.post(url, json={"questions": [long_question] + ["Инфляция"] * 299, "material_ids": [infl]})
    assert ok.status_code == 200 and len(ok.json()["questions"]) == 300
    assert ok.json()["questions"][0] == {"lectures": [infl]}
    # Самый длинный список, какой пришлёт редактор (300 вопросов по 600 букв кириллицей и 500 id лекций), проходит.
    largest = {"questions": ["я" * lecture_fit.QUESTION_CHARS] * 300, "material_ids": [str(uuid.uuid4()) for _ in range(499)] + [infl]}
    assert len(json.dumps(largest, ensure_ascii=False).encode("utf-8")) < exams_api.FIT_BODY_LIMIT
    assert api.post(url, content=json.dumps(largest, ensure_ascii=False).encode("utf-8"), headers={"Content-Type": "application/json"}).status_code == 200


def test_supabase_failures_are_plain_russian(api):
    add(api.fake, "Инфляция", INFLATION, "2026-10-03T09:00:00Z")
    api.fake.fail[("GET", "materials")] = 500
    failed = api.post("/api/exams/lecture-fit", json={"questions": QUESTIONS})
    assert failed.status_code == 503 and failed.json() == {"detail": lecture_fit.READ_FAILED_DETAIL}
    api.fake.fail[("GET", "materials")] = 401
    expired = api.post("/api/exams/lecture-fit", json={"questions": QUESTIONS})
    assert expired.status_code == 401 and expired.json() == {"detail": lecture_fit.SESSION_EXPIRED_DETAIL}


def test_no_lectures_with_text_leaves_every_question_without_a_lecture(api):
    scan = add(api.fake, "Скан", "", "2026-10-03T09:00:00Z")
    body = api.post("/api/exams/lecture-fit", json={"questions": QUESTIONS}).json()
    assert body["lectures"] == [] and body["unmatched"] == [0, 1, 2]
    assert body["skipped"] == [{"id": scan, "reason": "no_text"}] and body["checked_chars"] == 0
    assert api.builds == []


def test_the_index_and_the_scoring_run_off_the_event_loop(api, monkeypatch):
    # Индекс и подсчёт — в потоке-исполнителе: длинный список не держит цикл событий.
    add(api.fake, "Инфляция", INFLATION, "2026-10-03T09:00:00Z")
    real = asyncio.to_thread
    ran: list[str] = []

    async def recorded(function, /, *args, **kwargs):
        ran.append(getattr(function, "__name__", repr(function)))
        return await real(function, *args, **kwargs)

    monkeypatch.setattr(lecture_fit.asyncio, "to_thread", recorded)
    assert api.post("/api/exams/lecture-fit", json={"questions": QUESTIONS}).status_code == 200
    assert ran == ["counted_build", "_report"]
