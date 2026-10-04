"""/api/analyze* streams: keepalive, deadlines, one terminal event, pre-stream errors, limits."""
import asyncio
import io
import json
import os
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from agents.base import AIError, BaseAgent  # noqa: E402
from sse import KEEPALIVE, SSE_HEADERS, sse_event, with_keepalive  # noqa: E402
from uploads import AI_UNAVAILABLE_DETAIL  # noqa: E402

SUMMARY = json.dumps({"title": "Инфляция", "subject": "Экономика", "content": "Рост цен.", "terms": []}, ensure_ascii=False)
QUIZ = json.dumps({"quiz": [{"question": "Что?", "options": ["A) Да", "B) Нет"], "correct": "A"}]}, ensure_ascii=False)
LECTURE = "Инфляция — устойчивый рост общего уровня цен.\n\nЦентральный банк повышает ключевую ставку."


def section_of(prompt: str) -> str:
    if "обучающих карточек" in prompt:
        return "flashcards"
    if "проверочных тестов" in prompt:
        return "quiz"
    if "шпаргалок" in prompt:
        return "cheatsheet"
    if "учебных разговоров" in prompt:
        return "podcast"
    if "гейм-дизайнер" in prompt:
        return "missions"
    return "summarizer"


def frames(body: str) -> list:
    """Events in order; "KA" for a keepalive comment."""
    out = []
    for block in body.split("\n\n"):
        block = block.strip("\n")
        if not block:
            continue
        if block.startswith(":"):
            out.append("KA")
        else:
            assert block.startswith("data: "), block
            out.append(json.loads(block[len("data: "):]))
    return out


def kinds(items: list) -> list:
    return [item if item == "KA" else item["type"] for item in items]


@pytest.fixture
def api(monkeypatch):
    import main
    from fastapi.testclient import TestClient

    async def fake_user(request):
        token = request.headers.get("Authorization", "Bearer user-a").split(" ", 1)[1]
        return {"id": token}

    monkeypatch.setattr(main, "require_authenticated_user", fake_user)
    monkeypatch.setattr(main.limiter, "enabled", False)
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-key")
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.setenv("AI_AGENT_STAGGER_SECONDS", "0")
    monkeypatch.delenv("MAX_UPLOAD_BYTES", raising=False)
    BaseAgent._run_cache.clear()
    yield TestClient(main.app)
    BaseAgent._run_cache.clear()


def answer_with(monkeypatch, answers):
    calls = []

    async def run(self, system_prompt, user_text, **kwargs):
        name = section_of(system_prompt)
        calls.append(name)
        answer = answers[name]
        if callable(answer):
            answer = await answer()
        if isinstance(answer, BaseException):
            raise answer
        return answer

    monkeypatch.setattr(BaseAgent, "run", run)
    return calls


def post_text(client, text=LECTURE, agents=("summarizer",), name="lecture.txt", user="user-a"):
    return client.post(
        "/api/analyze",
        files={"file": (name, io.BytesIO(text.encode("utf-8")), "text/plain")},
        data={"enabled_agents": json.dumps(list(agents))},
        headers={"Authorization": f"Bearer {user}"},
    )


async def sleep_then(seconds, value):
    await asyncio.sleep(seconds)
    return value


# --- keepalive and deadlines -------------------------------------------------------------

def test_keepalive_flows_while_agents_are_silent_and_order_is_kept(api, monkeypatch):
    monkeypatch.setenv("SSE_KEEPALIVE_SECONDS", "0.05")
    answer_with(monkeypatch, {"summarizer": lambda: sleep_then(0.35, SUMMARY)})
    response = post_text(api)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    for header, value in SSE_HEADERS.items():
        assert response.headers[header.lower()] == value
    items = frames(response.text)
    events = [kind for kind in kinds(items) if kind != "KA"]
    assert events == ["text_extracted", "grounding", "agent_start", "agent_done", "results", "done"]
    start, done = kinds(items).index("agent_start"), kinds(items).index("agent_done")
    assert "KA" in kinds(items)[start:done]
    assert ": keepalive\n\n" in response.text


def test_hung_provider_ends_with_an_error_event_and_never_done(api, monkeypatch):
    monkeypatch.setenv("SSE_KEEPALIVE_SECONDS", "0.05")
    monkeypatch.setenv("AI_AGENT_TIMEOUT_SECONDS", "0.2")
    hang = lambda: sleep_then(30, SUMMARY)  # noqa: E731
    answer_with(monkeypatch, {"summarizer": hang, "flashcards": hang, "quiz": hang})
    response = post_text(api, agents=("summarizer", "flashcards", "quiz"))
    items = frames(response.text)
    names = kinds(items)
    assert "KA" in names
    assert names[-1] == "error" and "results" not in names and "done" not in names
    assert items[-1]["code"] == "timeout"
    assert items[-1]["message"].startswith("ИИ-сервис сейчас не ответил. Материал не сохранён, лимит не списан.")
    done_events = [item for item in items if item != "KA" and item["type"] == "agent_done"]
    assert {event["status"] for event in done_events} == {"timeout"}


def test_one_usable_core_section_gives_results_then_done(api, monkeypatch):
    monkeypatch.setenv("SSE_KEEPALIVE_SECONDS", "0.05")
    monkeypatch.setenv("AI_AGENT_TIMEOUT_SECONDS", "0.2")
    hang = lambda: sleep_then(30, QUIZ)  # noqa: E731
    answer_with(monkeypatch, {"summarizer": SUMMARY, "flashcards": hang, "quiz": hang})
    items = [item for item in frames(post_text(api, agents=("summarizer", "flashcards", "quiz")).text) if item != "KA"]
    names = kinds(items)
    assert names[:2] == ["text_extracted", "grounding"]
    assert names[-2:] == ["results", "done"] and names.count("done") == 1
    results = items[-2]
    assert results["sections"]["summarizer"] == {"status": "ok"}
    assert results["sections"]["quiz"]["status"] == "timeout"
    assert results["quiz"] == {"error": "Модель не ответила вовремя"}


def test_code_heavy_lecture_gets_results_not_an_empty_error(api, monkeypatch):
    code = "```python\nfor i in range(3):\n    print(i)\n```"
    calls = answer_with(monkeypatch, {
        "summarizer": json.dumps({"title": "Циклы", "subject": "Информатика", "content": f"## Цикл for\n\n{code}", "terms": []},
                                 ensure_ascii=False),
        "flashcards": json.dumps({"flashcards": [{"question": f"Что выведет?\n{code}", "answer": "0, 1 и 2."}]},
                                 ensure_ascii=False),
        "quiz": json.dumps({"quiz": [{"question": f"Сколько строк выведет?\n{code}", "options": ["A) 3", "B) 2"],
                                      "correct": "A", "explanation": "range(3) даёт 0, 1, 2."}]}, ensure_ascii=False),
    })
    items = [item for item in frames(post_text(api, agents=("summarizer", "flashcards", "quiz")).text) if item != "KA"]
    assert kinds(items)[-2:] == ["results", "done"]
    results = items[-2]
    assert results["sections"] == {name: {"status": "ok"} for name in ("summarizer", "flashcards", "quiz")}
    assert code in results["summarizer"]["content"]
    assert code in results["flashcards"]["flashcards"][0]["question"]
    assert code in results["quiz"]["quiz"][0]["question"]
    assert sorted(calls) == ["flashcards", "quiz", "summarizer"]  # one call each, no retries


def test_all_empty_sections_end_with_error_empty_and_no_done(api, monkeypatch):
    answer_with(monkeypatch, {"summarizer": "", "flashcards": "не JSON", "quiz": "{}"})
    items = frames(post_text(api, agents=("summarizer", "flashcards", "quiz")).text)
    assert kinds(items)[-1] == "error" and items[-1]["code"] == "empty"
    assert "done" not in kinds(items) and "results" not in kinds(items)


def test_all_busy_sections_end_with_error_busy(api, monkeypatch):
    answer_with(monkeypatch, {"summarizer": AIError.busy(), "quiz": AIError.busy()})
    items = frames(post_text(api, agents=("summarizer", "quiz")).text)
    assert items[-1]["type"] == "error" and items[-1]["code"] == "busy"


def test_grounding_event_matches_the_results_sources(api, monkeypatch):
    answer_with(monkeypatch, {"summarizer": SUMMARY})
    items = frames(post_text(api).text)
    grounding = next(item for item in items if item["type"] == "grounding")
    results = next(item for item in items if item["type"] == "results")
    assert grounding["sources"] == results["grounding"]["sources"]
    assert grounding["source_count"] == 2
    assert kinds(items).index("grounding") < kinds(items).index("agent_start")


def test_unexpected_coordinator_failure_is_one_internal_error(api, monkeypatch):
    from agents.coordinator import CoordinatorAgent

    async def broken(self, text, **kwargs):
        yield {"type": "grounding", "source_count": 0, "sources": []}
        raise RuntimeError("boom secret https://provider.invalid")

    monkeypatch.setattr(CoordinatorAgent, "process", broken)
    response = post_text(api)
    items = frames(response.text)
    assert items[-1]["type"] == "error" and items[-1]["code"] == "internal"
    assert items[-1]["message"].startswith("Не удалось завершить анализ. Код ошибки: ")
    assert "secret" not in response.text and "provider.invalid" not in response.text


# --- before the stream: format, size, gate, limits ----------------------------------------

def test_oversized_document_is_413_before_streaming(api, monkeypatch):
    monkeypatch.setenv("MAX_UPLOAD_BYTES", "10")
    calls = answer_with(monkeypatch, {"summarizer": SUMMARY})
    response = post_text(api, text="x" * 100)
    assert response.status_code == 413
    assert response.headers["content-type"].startswith("application/json")
    assert response.json()["detail"].startswith("Файл слишком большой")
    assert calls == []


def test_unsupported_format_and_empty_url_are_400(api, monkeypatch):
    response = post_text(api, name="lecture.doc")
    assert response.status_code == 400 and response.json()["detail"].startswith("Неподдерживаемый формат")
    for data in ({"url": ""}, {"url": "   "}, {}):
        response = api.post("/api/analyze/url", data=data)
        assert response.status_code == 400 and response.json() == {"detail": "Укажите корректный URL-адрес."}
    response = api.post("/api/analyze/media", files={"file": ("notes.pdf", io.BytesIO(b"%PDF"), "application/pdf")})
    assert response.status_code == 400 and response.json()["detail"].startswith("Неподдерживаемый формат медиа")
    response = api.post("/api/analyze/media", files={"file": ("talk.mp3", io.BytesIO(b""), "audio/mpeg")})
    assert response.status_code == 400 and response.json() == {"detail": "Файл пустой. Выберите другой файл."}


def _record_temp_files(monkeypatch):
    import main

    created = []
    original = main.tempfile.NamedTemporaryFile

    def recording(*args, **kwargs):
        handle = original(*args, **kwargs)
        created.append(handle.name)
        return handle

    monkeypatch.setattr(main.tempfile, "NamedTemporaryFile", recording)
    return created


def test_oversized_media_is_413_and_no_temp_file_is_created(api, monkeypatch):
    import main

    monkeypatch.setenv("MAX_UPLOAD_BYTES", "10")
    created = _record_temp_files(monkeypatch)
    transcribed = []

    async def transcribe(path, mime_type=None):
        transcribed.append(path)
        return LECTURE

    monkeypatch.setattr(main, "transcribe_media_file", transcribe)
    response = api.post("/api/analyze/media", files={"file": ("talk.mp3", io.BytesIO(b"ID3" + b"x" * 100), "audio/mpeg")})
    assert response.status_code == 413
    assert response.json()["detail"].startswith("Файл слишком большой")
    assert created == [] and transcribed == []


def test_media_temp_file_is_removed_after_transcription(api, monkeypatch):
    import main

    created = _record_temp_files(monkeypatch)
    seen = {}

    async def transcribe(path, mime_type=None):
        seen["exists"] = os.path.exists(path)
        seen["mime"] = mime_type
        return LECTURE

    monkeypatch.setattr(main, "transcribe_media_file", transcribe)
    answer_with(monkeypatch, {"summarizer": SUMMARY})
    response = api.post(
        "/api/analyze/media",
        files={"file": ("talk.mp3", io.BytesIO(b"ID3 audio"), "audio/mpeg")},
        data={"enabled_agents": json.dumps(["summarizer"])},
    )
    items = frames(response.text)
    assert kinds(items)[:3] == ["status", "text_extracted", "grounding"]
    assert kinds(items)[-2:] == ["results", "done"]
    assert seen == {"exists": True, "mime": "audio/mpeg"}
    assert len(created) == 1 and not os.path.exists(created[0])


def test_media_transcription_timeout_is_a_readable_error_event(api, monkeypatch):
    import main

    monkeypatch.setenv("MEDIA_TRANSCRIBE_TIMEOUT_SECONDS", "0.1")
    created = _record_temp_files(monkeypatch)

    async def transcribe(path, mime_type=None):
        await asyncio.sleep(10)
        return LECTURE

    monkeypatch.setattr(main, "transcribe_media_file", transcribe)
    items = frames(api.post("/api/analyze/media", files={"file": ("talk.mp4", io.BytesIO(b"video"), "video/mp4")}).text)
    assert kinds(items) == ["status", "error"]
    assert items[-1] == {"type": "error", "code": "timeout", "message": "Расшифровка заняла слишком много времени. Попробуйте файл короче."}
    assert created and not os.path.exists(created[0])


def test_media_provider_quota_is_a_busy_error_event(api, monkeypatch):
    import main

    async def transcribe(path, mime_type=None):
        raise AIError.busy()

    monkeypatch.setattr(main, "transcribe_media_file", transcribe)
    items = frames(api.post("/api/analyze/media", files={"file": ("talk.mp3", io.BytesIO(b"ID3"), "audio/mpeg")}).text)
    assert items[-1]["type"] == "error" and items[-1]["code"] == "busy"


def test_gemini_only_streams_and_no_keys_is_503_without_env_names(api, monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "")
    answer_with(monkeypatch, {"summarizer": SUMMARY})
    response = post_text(api)
    assert response.status_code == 200 and kinds(frames(response.text))[-1] == "done"

    monkeypatch.setenv("GEMINI_API_KEY", "")
    for response in (
        post_text(api),
        api.post("/api/analyze/url", data={"url": "https://example.com/lecture"}),
        api.post("/api/analyze/media", files={"file": ("talk.mp3", io.BytesIO(b"ID3"), "audio/mpeg")}),
    ):
        assert response.status_code == 503
        assert response.json() == {"detail": AI_UNAVAILABLE_DETAIL}
        for name in ("GROQ", "GEMINI", "API_KEY"):
            assert name not in response.text


def test_rate_limit_is_per_user_with_a_russian_429(api, monkeypatch):
    import main

    answer_with(monkeypatch, {"summarizer": SUMMARY})
    monkeypatch.setattr(main.limiter, "enabled", True)
    main.limiter.reset()
    try:
        codes = [post_text(api, text=f"{LECTURE} {i}", user="user-a").status_code for i in range(5)]
        sixth = post_text(api, text=f"{LECTURE} 6", user="user-a")
        other_user = post_text(api, text=f"{LECTURE} B", user="user-b")
    finally:
        main.limiter.reset()
    assert codes == [200] * 5
    assert sixth.status_code == 429
    assert sixth.json() == {"detail": "Слишком много запросов. Подождите минуту и повторите."}
    assert int(sixth.headers["retry-after"]) >= 1
    assert other_user.status_code == 200


# --- inside the stream: text problems ------------------------------------------------------

def test_document_without_text_is_a_no_text_error(api, monkeypatch):
    calls = answer_with(monkeypatch, {"summarizer": SUMMARY})
    items = frames(post_text(api, text="   \n  ").text)
    assert items == [{"type": "error", "code": "no_text",
                      "message": "В файле не найден текст. Для сканированного PDF используйте PDF с OCR или DOCX/TXT."}]
    assert calls == []


def test_unreadable_document_is_a_no_text_error_without_parser_text(api, monkeypatch):
    import main

    def broken(contents, filename):
        raise ValueError("Ошибка чтения PDF: EOF marker not found /tmp/secret")

    monkeypatch.setattr(main, "extract_text", broken)
    response = post_text(api, name="lecture.pdf")
    items = frames(response.text)
    assert items[-1]["code"] == "no_text" and "secret" not in response.text and "EOF" not in response.text


def test_url_that_cannot_be_read_is_a_no_text_error(api, monkeypatch):
    import main

    async def scrape(url):
        raise ValueError("internal http://10.0.0.1 refused")

    monkeypatch.setattr(main, "scrape_url", scrape)
    response = api.post("/api/analyze/url", data={"url": "https://example.com/x"})
    items = frames(response.text)
    assert kinds(items) == ["status", "error"] and items[-1]["code"] == "no_text"
    assert "10.0.0.1" not in response.text


def test_url_stream_runs_the_analysis(api, monkeypatch):
    import main

    async def scrape(url):
        return LECTURE

    monkeypatch.setattr(main, "scrape_url", scrape)
    answer_with(monkeypatch, {"summarizer": SUMMARY})
    items = frames(api.post("/api/analyze/url", data={"url": "https://example.com/x", "enabled_agents": '["summarizer"]'}).text)
    assert kinds(items) == ["status", "text_extracted", "grounding", "agent_start", "agent_done", "results", "done"]


# --- sse.py and uploads.py -----------------------------------------------------------------

def test_sse_event_and_constants():
    assert sse_event({"type": "status", "message": "Готово"}) == 'data: {"type": "status", "message": "Готово"}\n\n'
    assert KEEPALIVE == ": keepalive\n\n"
    assert SSE_HEADERS == {"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"}


def _collect(stream):
    async def go():
        return [item async for item in stream]

    return asyncio.run(go())


def test_with_keepalive_keeps_order_and_fills_silence():
    async def source():
        yield "a"
        await asyncio.sleep(0.2)
        yield "b"
        yield "c"

    out = _collect(with_keepalive(source(), interval=0.03))
    assert [item for item in out if item != KEEPALIVE] == ["a", "b", "c"]
    assert out.index("b") > 1 and KEEPALIVE in out[1:out.index("b")]


def test_with_keepalive_reads_the_interval_from_env_at_call_time(monkeypatch):
    monkeypatch.setenv("SSE_KEEPALIVE_SECONDS", "0.03")

    async def source():
        await asyncio.sleep(0.15)
        yield "x"

    out = _collect(with_keepalive(source()))
    assert out[-1] == "x" and out.count(KEEPALIVE) >= 2


def test_with_keepalive_reraises_a_source_error_after_earlier_items():
    async def source():
        yield "a"
        raise ValueError("boom")

    async def go():
        seen = []
        with pytest.raises(ValueError):
            async for item in with_keepalive(source(), interval=0.05):
                seen.append(item)
        return seen

    assert asyncio.run(go()) == ["a"]


def test_with_keepalive_closes_the_source_on_aclose():
    state = {"closed": False}

    async def source():
        try:
            yield "a"
            await asyncio.sleep(30)
            yield "b"
        finally:
            state["closed"] = True

    async def go():
        stream = with_keepalive(source(), interval=0.02)
        first = await stream.__anext__()
        second = await stream.__anext__()  # a keepalive while the source sleeps
        await stream.aclose()
        return first, second

    assert asyncio.run(go()) == ("a", KEEPALIVE)
    assert state["closed"] is True


async def _wait_for(predicate, seconds=2.0):
    loop = asyncio.get_running_loop()
    deadline = loop.time() + seconds
    while not predicate() and loop.time() < deadline:
        await asyncio.sleep(0.01)
    await asyncio.sleep(0)  # let done-callbacks run


def _source_with_slow_cleanup(events):
    async def source():
        try:
            yield "data: first\n\n"
            await asyncio.sleep(30)
            yield "data: never\n\n"
        finally:
            events.append("cleanup started")
            await asyncio.sleep(0.05)  # e.g. releasing a lock over the network
            events.append("cleanup done")

    return source()


def test_with_keepalive_cleanup_survives_a_cancelled_task_group():
    """anyio re-sends the cancel to the consumer on every loop pass; the source's
    awaited cleanup must still run to the end (and the task must not leak)."""
    import anyio
    import sse

    events = []

    async def go():
        async def consume():
            async for item in with_keepalive(_source_with_slow_cleanup(events), interval=5):
                events.append(item)

        async with anyio.create_task_group() as group:
            group.start_soon(consume)
            await asyncio.sleep(0.05)  # the source is awaiting now
            group.cancel_scope.cancel()
        await _wait_for(lambda: "cleanup done" in events)
        return set(sse._CLOSING_SOURCES)

    leftover = asyncio.run(go())
    assert events == ["data: first\n\n", "cleanup started", "cleanup done"]
    assert leftover == set()


def test_client_disconnect_lets_the_source_cleanup_finish():
    """The real path: uvicorn reports ASGI spec 2.3, so Starlette streams inside a task
    group and cancels it when the client disconnects (a closed tab during mapping)."""
    from starlette.responses import StreamingResponse

    events = []

    async def go():
        first_sent = asyncio.Event()
        bodies = []

        async def send(message):
            if message["type"] == "http.response.body" and message.get("body"):
                bodies.append(message["body"])
                first_sent.set()

        async def receive():
            await first_sent.wait()
            return {"type": "http.disconnect"}

        scope = {"type": "http", "asgi": {"version": "3.0", "spec_version": "2.3"}, "http_version": "1.1",
                 "method": "GET", "path": "/", "raw_path": b"/", "query_string": b"", "headers": []}
        response = StreamingResponse(with_keepalive(_source_with_slow_cleanup(events), interval=5),
                                     media_type="text/event-stream")
        await asyncio.wait_for(response(scope, receive, send), 5)
        await _wait_for(lambda: "cleanup done" in events)
        return bodies

    assert asyncio.run(go()) == [b"data: first\n\n"]
    assert events == ["cleanup started", "cleanup done"]


def test_with_keepalive_close_does_not_hang_on_a_source_that_ignores_cancel():
    async def stubborn():
        for value in ("a", "b", "c", "d"):
            try:
                await asyncio.sleep(0.05)
            except asyncio.CancelledError:
                pass  # misbehaving source: keeps producing after a cancel
            yield value

    async def go():
        stream = with_keepalive(stubborn(), interval=5)
        first = await stream.__anext__()
        closing = asyncio.ensure_future(stream.aclose())
        done, _ = await asyncio.wait({closing}, timeout=1)
        closing.cancel()  # only matters when it hung
        await asyncio.gather(closing, return_exceptions=True)
        return first, closing in done

    assert asyncio.run(go()) == ("a", True)


def test_with_keepalive_runs_the_source_in_one_task():
    async def source():
        task = asyncio.current_task()
        async with asyncio.timeout(10):  # a context spanning yields needs one task
            for value in ("a", "b", "c"):
                assert asyncio.current_task() is task
                await asyncio.sleep(0.02)
                yield value

    assert [item for item in _collect(with_keepalive(source(), interval=0.01)) if item != KEEPALIVE] == ["a", "b", "c"]


def test_uploads_module_does_not_import_main():
    code = (
        "import sys; sys.path.insert(0, %r); import uploads, ratelimit, sse; "
        "assert 'main' not in sys.modules, 'main imported'; print(uploads.max_upload_bytes())"
    ) % str(BACKEND)
    env = {key: value for key, value in os.environ.items() if key != "MAX_UPLOAD_BYTES"}
    result = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, env=env, timeout=60)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == str(15 * 1024 * 1024)


def test_upload_limit_is_read_at_call_time(monkeypatch):
    import uploads
    from fastapi import HTTPException
    from starlette.datastructures import Headers, UploadFile

    def upload(size):
        return UploadFile(file=io.BytesIO(b"x" * size), filename="a.txt", headers=Headers({"content-type": "text/plain"}))

    monkeypatch.setenv("MAX_UPLOAD_BYTES", "10")
    assert uploads.max_upload_bytes() == 10
    assert asyncio.run(uploads.read_upload_with_limit(upload(10))) == b"x" * 10
    with pytest.raises(HTTPException) as info:
        asyncio.run(uploads.read_upload_with_limit(upload(11)))
    assert info.value.status_code == 413 and info.value.detail.startswith("Файл слишком большой")
    monkeypatch.setenv("MAX_UPLOAD_BYTES", str(15 * 1024 * 1024))
    assert uploads.upload_too_large_detail() == "Файл слишком большой. Максимальный размер: 15 МБ"
    monkeypatch.setenv("MAX_UPLOAD_BYTES", "garbage")
    assert uploads.max_upload_bytes() == 15 * 1024 * 1024


def test_ai_configured_reads_env_at_call_time(monkeypatch):
    import uploads

    monkeypatch.setenv("GROQ_API_KEY", " ")
    monkeypatch.setenv("GEMINI_API_KEY", "")
    assert uploads.ai_configured() is False
    monkeypatch.setenv("GEMINI_API_KEY", "key")
    assert uploads.ai_configured() is True
    monkeypatch.setenv("GEMINI_API_KEY", "")
    monkeypatch.setenv("GROQ_API_KEY", "key")
    assert uploads.ai_configured() is True


# --- media_parser: the PROCESSING poll is capped ----------------------------------------------

def test_media_processing_poll_is_capped_and_other_keys_are_not_tried(monkeypatch, tmp_path):
    import media_parser

    monkeypatch.setenv("GEMINI_API_KEY", "key-one,key-two")
    monkeypatch.setattr(media_parser, "media_processing_poll_seconds", lambda: 0.0)
    clients, deleted = [], []

    class FakeFiles:
        def upload(self, file=None, config=None):
            return SimpleNamespace(name="files/1", state=SimpleNamespace(name="PROCESSING"))

        def get(self, name=None):
            return SimpleNamespace(name=name, state=SimpleNamespace(name="PROCESSING"))

        def delete(self, name=None):
            deleted.append(name)

    class FakeClient:
        def __init__(self, api_key=None, **kwargs):
            clients.append(api_key)
            self.files = FakeFiles()

    monkeypatch.setattr(media_parser.genai, "Client", FakeClient)
    path = tmp_path / "talk.mp4"
    path.write_bytes(b"video")
    with pytest.raises(media_parser.MediaProcessingTimeout) as info:
        asyncio.run(media_parser.transcribe_media_file(str(path), "video/mp4"))
    assert str(info.value) == "Расшифровка заняла слишком много времени. Попробуйте файл короче."
    assert len(clients) == 1 and deleted == ["files/1"]


def test_media_quota_on_every_model_is_reported_as_busy(monkeypatch, tmp_path):
    import media_parser
    from google.genai import errors as genai_errors

    monkeypatch.setenv("GEMINI_API_KEY", "key-one")

    class FakeFiles:
        def upload(self, file=None, config=None):
            return SimpleNamespace(name="files/1", state=SimpleNamespace(name="ACTIVE"))

        def delete(self, name=None):
            pass

    class FakeClient:
        def __init__(self, api_key=None, **kwargs):
            self.files = FakeFiles()

            async def generate_content(model=None, contents=None, **kwargs):
                raise genai_errors.ClientError(429, {"error": {"code": 429, "message": "quota", "status": "RESOURCE_EXHAUSTED"}})

            self.aio = SimpleNamespace(models=SimpleNamespace(generate_content=generate_content))

    monkeypatch.setattr(media_parser.genai, "Client", FakeClient)
    path = tmp_path / "talk.mp4"
    path.write_bytes(b"video")
    with pytest.raises(AIError) as info:
        asyncio.run(media_parser.transcribe_media_file(str(path), "video/mp4"))
    assert info.value.status_code == 429


def test_terminal_messages_say_limit_not_energy():
    """Spec 3.10: the app speaks of a daily limit; «энергия» is gone from every terminal message."""
    from agents.coordinator import TERMINAL_MESSAGES
    import main

    messages = list(TERMINAL_MESSAGES.values()) + [main.MEDIA_BUSY_MESSAGE]
    for message in messages:
        assert "лимит не списан" in message
        assert "энерги" not in message.lower()
