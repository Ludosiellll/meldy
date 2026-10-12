"""A long recording goes to Whisper in pieces (media_parser._transcribe_in_pieces), and the page sees the minutes done.

Groq and Gemini are fakes. In the unit tests ffmpeg is faked too (the plan is real) and time is a fake clock whose
sleep moves it on at once; the end-to-end tests cut the synthetic lecture of test_audio_pieces.py with the real
ffmpeg. The live measurements behind the pieces are at the top of media_parser.py.
"""
import asyncio
import io
import json
import os
import sys
import tempfile
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import audio_pieces  # noqa: E402
import media_parser  # noqa: E402
from agents.base import AIError  # noqa: E402
from test_analyze_stream import LECTURE, SUMMARY, answer_with, frames, kinds  # noqa: E402
from test_audio_pieces import LECTURE as LECTURE_LAYOUT, make_recording, needs_ffmpeg  # noqa: E402

PIECE_NAMES = [f"piece{index:04d}.flac" for index in range(5)]


class FakeTime:
    """time.monotonic and asyncio.sleep of the pieces: a sleep moves the clock on at once and lets others run."""

    def __init__(self):
        self.now = 1000.0
        self.sleeps = []

    def clock(self):
        return self.now

    async def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.now += seconds
        await asyncio.sleep(0)


class GroqError(Exception):
    """A failure as the Groq SDK raises it: the HTTP status and, for a 429, the retry-after header."""

    def __init__(self, status, retry_after=None):
        super().__init__(f"HTTP {status}")
        self.status_code = status
        self.response = SimpleNamespace(headers={} if retry_after is None else {"retry-after": retry_after})


@pytest.fixture
def groq(monkeypatch):
    """groq.AsyncGroq: each request is recorded (its file's name, type and bytes, and the fake clock when one is
    set); it answers ``texts[name]`` or «Текст <name>.» after ``hold[name]`` turns of the loop (1 by default);
    ``fail[name]`` lists what the next requests for that file raise, in turn."""
    import groq as groq_module

    state = SimpleNamespace(calls=[], clients=[], finished=[], texts={}, fail={}, hold={}, running=0, most=0, clock=None)

    class FakeAsyncGroq:
        def __init__(self, api_key=None, **kwargs):
            state.clients.append(kwargs)
            self.audio = SimpleNamespace(transcriptions=SimpleNamespace(create=self.create))

        async def create(self, **kwargs):
            name, handle, mime = kwargs["file"]
            call = {key: value for key, value in kwargs.items() if key != "file"}
            call.update(name=name, mime=mime, data=handle.read(), at=state.clock() if state.clock else None)
            state.calls.append(call)
            state.running += 1
            state.most = max(state.most, state.running)
            try:
                for _ in range(state.hold.get(name, 1)):
                    await asyncio.sleep(0)
                if state.fail.get(name):
                    raise state.fail[name].pop(0)
                state.finished.append(name)
                return state.texts.get(name, f"Текст {name}.")
            finally:
                state.running -= 1

    monkeypatch.setattr(groq_module, "AsyncGroq", FakeAsyncGroq)
    monkeypatch.setenv("GROQ_API_KEY", "groq-key")
    for name in ("GROQ_TRANSCRIPTION_MODEL", "GROQ_LECTURE_TRANSCRIPTION_MODEL", "GROQ_AUDIO_RPM",
                 "GROQ_AUDIO_CONCURRENCY", "AUDIO_MAX_PIECES"):
        monkeypatch.delenv(name, raising=False)
    media_parser._groq_audio_starts.clear()
    yield state
    media_parser._groq_audio_starts.clear()


@pytest.fixture
def cut(monkeypatch):
    """ffmpeg faked: the recording lasts 130 s with pauses at 19-21, 44.75-45.25 and 99-101 s, so the real plan is
    0-20 (cut at a 2 s pause), 20-45 (0.5 s), 45-75 (a hard cut), 75-100 (2 s), 100-130; each piece is a small file in
    the pieces' directory (``directories``)."""
    state = SimpleNamespace(duration=130.0, pauses=[(19.0, 21.0), (44.75, 45.25), (99.0, 101.0)], directories=[], plans=[])

    async def find_pauses(exe, path):
        return state.duration, state.pauses

    async def cut_pieces(exe, path, pieces, directory):
        state.directories.append(directory)
        state.plans.append(pieces)
        files = []
        for index, piece in enumerate(pieces):
            files.append(os.path.join(directory, f"piece{index:04d}.flac"))
            Path(files[-1]).write_bytes(f"fLaC {piece.start:g}-{piece.end:g}".encode())
        return files

    monkeypatch.setattr(audio_pieces, "ffmpeg_exe", lambda: "ffmpeg")
    monkeypatch.setattr(audio_pieces, "find_pauses", find_pauses)
    monkeypatch.setattr(audio_pieces, "cut_pieces", cut_pieces)
    return state


@pytest.fixture
def recording(tmp_path):
    path = tmp_path / "lecture.m4a"
    path.write_bytes(b"audio")
    return path


def in_pieces(path, clock, progress=None, deadline=None):
    return asyncio.run(media_parser._transcribe_in_pieces(str(path), progress, deadline, clock.clock, clock.sleep))


def fake_gemini(monkeypatch, answer):
    """genai.Client of media_parser: the calls; each answers ``answer`` (or raises it). The Files API must not be used."""
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-key")
    monkeypatch.setenv("GEMINI_MODELS", "gemini-model")
    calls = []

    class FakeClient:
        def __init__(self, api_key=None, **kwargs):
            self.files = SimpleNamespace(upload=None, get=None, delete=None)

            async def generate_content(model=None, contents=None, config=None):
                part, prompt = contents
                calls.append({"model": model, "mime": part.inline_data.mime_type, "data": part.inline_data.data,
                              "prompt": prompt, "config": config})
                if isinstance(answer, BaseException):
                    raise answer
                return SimpleNamespace(text=answer)

            self.aio = SimpleNamespace(models=SimpleNamespace(generate_content=generate_content))

    monkeypatch.setattr(media_parser.genai, "Client", FakeClient)
    return calls


# ── the pieces ─────────────────────────────────────────────────────────────────────


def test_pieces_go_to_whisper_as_the_whole_file_did_and_come_back_in_order(groq, cut, recording):
    groq.texts = {
        "piece0000.flac": "Первая часть. Спасибо.",  # a cut's «Спасибо.» (live 2026-10-12)
        "piece0001.flac": "Вторая часть.",
        "piece0002.flac": "Третья часть. Продолжение следует...",
        "piece0003.flac": "Субтитры сделал DimaTorzok",  # nothing but a made-up line
        "piece0004.flac": "Последняя часть. Спасибо.",  # the lecturer's own, at the very end
    }
    groq.hold = {"piece0000.flac": 30}  # the first piece answers last
    progress = []
    text = in_pieces(recording, FakeTime(), progress=lambda done, total: progress.append((done, total)))

    # A paragraph where the cut pause lasted 1.5 s or more (also across the empty piece), a space elsewhere.
    assert text == "Первая часть.\n\nВторая часть. Третья часть.\n\nПоследняя часть. Спасибо."
    assert groq.finished[-1] == "piece0000.flac"
    assert sorted(call["name"] for call in groq.calls) == PIECE_NAMES
    for call in groq.calls:
        assert call["model"] == "whisper-large-v3-turbo" and call["language"] == "ru" and call["temperature"] == 0
        assert call["response_format"] == "text" and "prompt" not in call and call["mime"] == "audio/flac"
    assert {call["data"] for call in groq.calls} == {b"fLaC 0-20", b"fLaC 20-45", b"fLaC 45-75", b"fLaC 75-100", b"fLaC 100-130"}
    # The SDK does not retry on its own: its requests would escape the pace.
    assert groq.clients == [{"max_retries": 0}]
    # Seconds of the recording done after each piece, whatever the order.
    assert [total for _, total in progress] == [130.0] * 5
    assert [done for done, _ in progress] == sorted(done for done, _ in progress) and progress[-1][0] == 130.0
    assert cut.directories and not os.path.exists(cut.directories[0])


def test_at_most_groq_audio_concurrency_pieces_are_in_flight(groq, cut, recording, monkeypatch):
    groq.hold = {name: 5 for name in PIECE_NAMES}
    in_pieces(recording, FakeTime())
    assert groq.most == 4 and len(groq.calls) == 5
    monkeypatch.setenv("GROQ_AUDIO_CONCURRENCY", "2")
    groq.most, groq.calls = 0, []
    in_pieces(recording, FakeTime())
    assert groq.most == 2 and len(groq.calls) == 5


def test_the_process_starts_at_most_groq_audio_rpm_requests_in_any_minute(groq, cut, recording, monkeypatch):
    monkeypatch.setenv("GROQ_AUDIO_RPM", "2")
    clock = FakeTime()
    groq.clock = clock.clock

    async def two_recordings_at_once():
        return await asyncio.gather(*(
            media_parser._transcribe_in_pieces(str(recording), None, None, clock.clock, clock.sleep) for _ in range(2)
        ))

    assert all(asyncio.run(two_recordings_at_once()))
    starts = sorted(call["at"] for call in groq.calls)
    assert len(starts) == 10
    assert all(sum(1 for other in starts if start <= other < start + 60) <= 2 for start in starts)
    assert starts[-1] - starts[0] >= 240  # ten requests at two a minute
    assert min(clock.sleeps) > 0


def test_a_busy_groq_is_waited_for_as_long_as_it_asks_but_at_most_30_seconds(groq, cut, recording, capsys):
    groq.fail = {
        "piece0001.flac": [GroqError(429, "7")],
        "piece0002.flac": [GroqError(429)],  # no retry-after: 10 s
        "piece0003.flac": [GroqError(429, "120"), GroqError(429, "2")],
    }
    clock = FakeTime()
    text = in_pieces(recording, clock)
    assert sorted(clock.sleeps) == [2.0, 7.0, 10.0, 30.0]
    assert len(groq.calls) == 9 and text.count("Текст piece") == 5
    assert "Groq is busy (429), a piece waits 30 s" in capsys.readouterr().out


def test_a_piece_groq_fails_twice_goes_to_gemini_with_its_bytes_inline(groq, cut, recording, monkeypatch):
    groq.fail = {"piece0002.flac": [GroqError(500), GroqError(503)]}
    gemini = fake_gemini(monkeypatch, "Текст от Gemini.")
    clock = FakeTime()
    text = in_pieces(recording, clock)
    assert clock.sleeps == [1.0]  # one more try after a second
    assert text == (
        "Текст piece0000.flac.\n\nТекст piece0001.flac. Текст от Gemini. Текст piece0003.flac.\n\nТекст piece0004.flac."
    )
    [call] = gemini
    assert call["mime"] == "audio/flac" and call["data"] == b"fLaC 45-75"
    assert call["prompt"] == media_parser.MEDIA_TRANSCRIPTION_PROMPT and call["model"] == "gemini-model"
    assert call["config"].temperature == media_parser.MEDIA_TRANSCRIPTION_TEMPERATURE


def test_a_piece_gemini_cannot_transcribe_either_fails_the_whole_transcription(groq, cut, recording, monkeypatch):
    from google.genai import errors as genai_errors

    groq.fail = {"piece0002.flac": [GroqError(500), GroqError(500)]}
    fake_gemini(monkeypatch, genai_errors.ClientError(429, {"error": {"code": 429, "message": "quota", "status": "RESOURCE_EXHAUSTED"}}))
    with pytest.raises(AIError) as info:
        in_pieces(recording, FakeTime())
    assert info.value.status_code == 429
    assert not os.path.exists(cut.directories[-1])

    groq.fail = {"piece0002.flac": [GroqError(500), GroqError(500)]}
    fake_gemini(monkeypatch, RuntimeError("down"))
    with pytest.raises(ValueError):
        in_pieces(recording, FakeTime())
    assert not os.path.exists(cut.directories[-1])


def test_the_pieces_stop_at_the_deadline(groq, cut, recording, monkeypatch):
    # Two requests a minute: the third would start a minute after the first, past a deadline 50 s away.
    monkeypatch.setenv("GROQ_AUDIO_RPM", "2")
    clock = FakeTime()
    with pytest.raises(media_parser.MediaProcessingTimeout):
        in_pieces(recording, clock, deadline=clock.now + 50)
    assert len(groq.calls) == 2 and not os.path.exists(cut.directories[-1])
    assert clock.sleeps == []  # it does not wait for a turn past the deadline

    # A 429 whose wait would cross the deadline: Groq is busy, as the page says.
    monkeypatch.delenv("GROQ_AUDIO_RPM")
    media_parser._groq_audio_starts.clear()
    groq.fail = {"piece0000.flac": [GroqError(429, "30")]}
    clock = FakeTime()
    with pytest.raises(AIError) as info:
        in_pieces(recording, clock, deadline=clock.now + 20)
    assert info.value.status_code == 429 and not os.path.exists(cut.directories[-1])


def test_without_a_groq_key_or_ffmpeg_or_for_a_short_recording_nothing_is_cut(groq, cut, recording, monkeypatch, capsys):
    cut.duration = 32.0
    assert in_pieces(recording, FakeTime()) is None
    cut.duration = 33.0  # one piece of 33 s: the file itself goes
    assert in_pieces(recording, FakeTime()) is None and cut.plans == []
    monkeypatch.setattr(audio_pieces, "ffmpeg_exe", lambda: None)
    assert in_pieces(recording, FakeTime()) is None
    assert "no ffmpeg" in capsys.readouterr().out
    monkeypatch.delenv("GROQ_API_KEY")
    assert in_pieces(recording, FakeTime()) is None
    assert groq.calls == []


# ── the whole file, as before ──────────────────────────────────────────────────────


def test_without_ffmpeg_the_recording_goes_whole(groq, monkeypatch, tmp_path):
    monkeypatch.setattr(audio_pieces, "ffmpeg_exe", lambda: None)
    path = tmp_path / "upload.mp3"
    path.write_bytes(b"ID3 audio")
    assert asyncio.run(media_parser.transcribe_media_file(str(path), "audio/mpeg")) == "Текст upload.mp3."
    [call] = groq.calls
    assert call["name"] == "upload.mp3" and call["mime"] == "audio/mpeg" and call["data"] == b"ID3 audio"


@needs_ffmpeg
def test_a_recording_of_at_most_32_seconds_goes_whole(groq, tmp_path):
    path = make_recording(tmp_path / "short.mp3", [("tone", 12.0), ("pause", 1.0), ("tone", 17.0)])
    assert asyncio.run(media_parser.transcribe_media_file(str(path), "audio/mpeg")) == "Текст short.mp3."
    [call] = groq.calls
    assert call["name"] == "short.mp3" and call["mime"] == "audio/mpeg"


@needs_ffmpeg
def test_a_recording_ffmpeg_cannot_read_goes_whole_and_the_log_names_no_file(groq, tmp_path, capsys):
    path = tmp_path / "Иванов_лекция.mp3"
    path.write_bytes(b"ID3 audio")
    assert asyncio.run(media_parser.transcribe_media_file(str(path), "audio/mpeg")) == "Текст Иванов_лекция.mp3."
    [call] = groq.calls
    assert call["name"] == "Иванов_лекция.mp3"
    log = capsys.readouterr().out
    assert log.count("Lecture pieces:") == 1 and "the recording goes to Whisper whole" in log
    assert "Иванов" not in log and str(tmp_path) not in log


@needs_ffmpeg
def test_a_long_recording_goes_to_whisper_in_flac_pieces_cut_at_its_pauses(groq, tmp_path, monkeypatch):
    path = make_recording(tmp_path / "lecture.mp3", LECTURE_LAYOUT)
    temporary = tmp_path / "tmp"
    temporary.mkdir()
    monkeypatch.setattr(tempfile, "tempdir", str(temporary))
    progress = []
    text = asyncio.run(media_parser.transcribe_media_file(
        str(path), "audio/mpeg", progress=lambda done, total: progress.append((done, total)),
        deadline=time.monotonic() + 60,
    ))
    # Cut at 17 s (a 2 s pause), 40.4 s (0.8 s) and 70.4 s (no pause in the window): test_audio_pieces.LECTURE_PLAN.
    assert text == "Текст piece0000.flac.\n\nТекст piece0001.flac. Текст piece0002.flac. Текст piece0003.flac."
    assert sorted(call["name"] for call in groq.calls) == PIECE_NAMES[:4]
    for call in groq.calls:
        assert call["mime"] == "audio/flac" and call["data"][:4] == b"fLaC" and "prompt" not in call
        assert call["model"] == "whisper-large-v3-turbo" and call["language"] == "ru" and call["temperature"] == 0
    assert len(progress) == 4 and progress[-1][0] == pytest.approx(95.0, abs=0.05)
    assert all(total == pytest.approx(95.0, abs=0.05) for _, total in progress)
    assert list(temporary.iterdir()) == []  # the pieces are gone


# ── the minutes the page sees (main.py) ────────────────────────────────────────────


def shown_statuses(updates, finish=None):
    """The statuses main._transcription_progress shows for these (seconds done, seconds in all), each let through
    before the next; the transcription ends with ``finish`` (an exception) or a text."""
    import main

    async def scenario():
        task = asyncio.get_running_loop().create_future()
        queue: asyncio.Queue = asyncio.Queue()
        shown = []

        async def collect():
            async for status in main._transcription_progress(task, queue):
                shown.append(status["message"])

        collector = asyncio.ensure_future(collect())
        for update in updates:
            queue.put_nowait(update)
            for _ in range(20):
                await asyncio.sleep(0)
        if finish is None:
            task.set_result("text")
        else:
            task.set_exception(finish)
        await collector
        return shown

    return asyncio.run(scenario())


def test_the_minutes_done_are_shown_only_when_they_change(monkeypatch):
    import main

    monkeypatch.setattr(main, "RECORDING_PROGRESS_SECONDS", 0)
    assert shown_statuses([(30.0, 1165.0), (65.0, 1165.0), (90.0, 1165.0), (130.0, 1165.0), (400.0, 1165.0)]) == [
        "Распознаём запись: 1 из 19 мин", "Распознаём запись: 2 из 19 мин", "Распознаём запись: 6 из 19 мин",
    ]
    # No «0 из 1 мин» for a short recording; 2:50 is 3 minutes in all.
    assert shown_statuses([(20.0, 50.0), (50.0, 50.0)]) == []
    assert shown_statuses([(61.0, 170.0), (125.0, 170.0), (170.0, 170.0)]) == [
        "Распознаём запись: 1 из 3 мин", "Распознаём запись: 2 из 3 мин",
    ]
    # Every status fits the page's 160 characters.
    assert len(main.RECORDING_PROGRESS_MESSAGE.format(done=999, total=999)) <= 160


def test_the_minutes_done_are_shown_at_most_every_5_seconds(monkeypatch):
    import main

    assert main.RECORDING_PROGRESS_SECONDS == 5.0
    assert shown_statuses([(65.0, 1165.0), (130.0, 1165.0), (400.0, 1165.0)]) == ["Распознаём запись: 1 из 19 мин"]


@pytest.fixture
def api(monkeypatch):
    """The app with a signed-in user, no rate limit, Gemini configured; models are answer_with(...) fakes."""
    import main
    from agents.base import BaseAgent
    from fastapi.testclient import TestClient

    async def fake_user(request):
        return {"id": "user-a"}

    monkeypatch.setattr(main, "require_authenticated_user", fake_user)
    monkeypatch.setattr(main.limiter, "enabled", False)
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-key")
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.setenv("AI_AGENT_STAGGER_SECONDS", "0")
    monkeypatch.delenv("MAX_UPLOAD_BYTES", raising=False)
    monkeypatch.delenv("MEDIA_TRANSCRIBE_TIMEOUT_SECONDS", raising=False)
    BaseAgent._run_cache.clear()
    yield TestClient(main.app)
    BaseAgent._run_cache.clear()


def test_the_stream_tells_how_many_minutes_of_the_recording_are_done(api, monkeypatch):
    import main

    monkeypatch.setattr(main, "RECORDING_PROGRESS_SECONDS", 0)
    seen = {}

    async def transcribe(path, mime_type=None, *, progress=None, deadline=None):
        seen["budget"] = deadline - time.monotonic()
        for done in (30.0, 65.0, 90.0, 130.0, 400.0):
            progress(done, 1165.0)
            await asyncio.sleep(0.05)
        return LECTURE

    monkeypatch.setattr(main, "transcribe_media_file", transcribe)
    answer_with(monkeypatch, {"summarizer": SUMMARY})
    response = api.post(
        "/api/analyze/media",
        files={"file": ("lecture.m4a", io.BytesIO(b"audio"), "audio/mp4")},
        data={"enabled_agents": json.dumps(["summarizer"])},
    )
    items = [item for item in frames(response.text) if item != "KA"]
    statuses = [item["message"] for item in items if item["type"] == "status"]
    # The first status stays; the minutes follow it, before the text.
    assert statuses == [
        "Распознаём текст файла. Это может занять несколько минут.",
        "Распознаём запись: 1 из 19 мин", "Распознаём запись: 2 из 19 мин", "Распознаём запись: 6 из 19 мин",
    ]
    assert kinds(items)[:5] == ["status"] * 4 + ["text_extracted"] and kinds(items)[-1] == "done"
    # The deadline is the stream's budget: 480 s by default (the page waits 10 minutes for a media analysis).
    assert main.media_transcribe_timeout_seconds() == 480.0 and 470 < seen["budget"] <= 480


@pytest.mark.parametrize("failure, event", [
    (media_parser.MediaProcessingTimeout(), {"type": "error", "code": "timeout", "message": "Расшифровка заняла слишком много времени. Попробуйте файл короче."}),
    (AIError.busy(), {"type": "error", "code": "busy", "message": "Сервис ИИ сейчас занят. Материал не сохранён, лимит не списан. Попробуйте через минуту."}),
])
def test_a_transcription_that_fails_after_some_minutes_ends_with_the_same_error_events(api, monkeypatch, failure, event):
    import main

    monkeypatch.setattr(main, "RECORDING_PROGRESS_SECONDS", 0)

    async def transcribe(path, mime_type=None, *, progress=None, deadline=None):
        progress(70.0, 1165.0)
        await asyncio.sleep(0.05)
        raise failure

    monkeypatch.setattr(main, "transcribe_media_file", transcribe)
    items = [item for item in frames(api.post("/api/analyze/media", files={"file": ("lecture.mp3", io.BytesIO(b"ID3"), "audio/mpeg")}).text) if item != "KA"]
    assert items[1] == {"type": "status", "message": "Распознаём запись: 1 из 19 мин"}
    assert items[-1] == event and kinds(items) == ["status", "status", "error"]


def test_a_client_gone_mid_transcription_stops_it_before_the_upload_is_removed(monkeypatch):
    import main

    monkeypatch.setattr(main, "RECORDING_PROGRESS_SECONDS", 0)
    state = {}

    async def transcribe(path, mime_type=None, *, progress=None, deadline=None):
        state["path"] = path
        progress(70.0, 1165.0)
        try:
            await asyncio.sleep(30)
        except asyncio.CancelledError:
            state["upload_there_when_stopped"] = os.path.exists(path)
            raise

    monkeypatch.setattr(main, "transcribe_media_file", transcribe)

    async def scenario():
        stream = main.event_stream_media(b"audio", "lecture.m4a", "audio/mp4")
        async for frame in stream:
            if "1 из 19 мин" in frame:
                break
        await stream.aclose()
        for _ in range(20):
            await asyncio.sleep(0)

    asyncio.run(scenario())
    assert state["upload_there_when_stopped"] is True and not os.path.exists(state["path"])
