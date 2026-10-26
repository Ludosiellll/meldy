"""Recordings by their length (the owner, 2026-10-26: «одним запросом можно выжрать весь лимит»).

The price of a recording grows with its length (plans.recording_cost), one recording is at most 2 hours, the day's
total per user is 2 hours free and 5 hours PRO (recording_charges, consume_recording_seconds), and one long recording is
transcribed at a time (recording_queue.py). The length is measured before anything is charged; every refusal before
the stream charges nothing. Supabase is the in-memory QuotaServer of test_quota.py with the recording functions added.
"""
import asyncio
import json
import subprocess
import sys
import uuid
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import audio_pieces  # noqa: E402
import plans  # noqa: E402
import quota  # noqa: E402
import recording_queue  # noqa: E402
from test_quota import RESETS_AT, SECTION_ANSWERS, QuotaServer, api, install  # noqa: E402,F401

SUMMARY = SECTION_ANSWERS["summarizer"]
LECTURE = "Инфляция — это устойчивый рост общего уровня цен в экономике. " * 12


class RecordingServer(QuotaServer):
    """The quota RPCs plus the day's total of recordings, as 20261026090000_recording_usage.sql keeps it."""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.recording_limit = 7200
        self.recording_used = 0
        self.recording_charges: dict[str, int] = {}

    async def handler(self, request: httpx.Request) -> httpx.Response:
        fn = request.url.path.rsplit("/", 1)[-1]
        if fn not in ("consume_recording_seconds", "refund_recording_seconds"):
            return await super().handler(request)
        args = json.loads(request.content or b"{}")
        token = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
        self.calls.append((fn, args, token))
        if isinstance(self.fail, int) and self.fail:
            return httpx.Response(self.fail, json={"code": "XX000"})
        if fn == "consume_recording_seconds":
            seconds = args["p_seconds"]
            if self.recording_used + seconds > self.recording_limit:
                return httpx.Response(200, json={"allowed": False, "pro": self.pro, "used": self.recording_used,
                                                 "limit": self.recording_limit, "resets_at": RESETS_AT, "charge_id": None})
            self.recording_used += seconds
            charge_id = str(uuid.uuid4())
            self.recording_charges[charge_id] = seconds
            return httpx.Response(200, json={"allowed": True, "pro": self.pro, "used": self.recording_used,
                                             "limit": self.recording_limit, "resets_at": RESETS_AT, "charge_id": charge_id})
        back = self.recording_charges.pop(args["p_charge"], 0)
        self.recording_used -= back
        return httpx.Response(200, json={"refunded": back})


@pytest.fixture
def server(monkeypatch, quota_on):
    yield install(monkeypatch, RecordingServer())
    quota._REPORTED.clear()


def recording_of(monkeypatch, seconds):
    async def measured(exe, path):
        return float(seconds)

    monkeypatch.setattr(audio_pieces, "probe_seconds", measured)


def transcribe_as(monkeypatch, api, text=LECTURE, seen=None):
    async def transcribe(path, mime_type=None, *, progress=None, deadline=None):
        if seen is not None:
            seen.append(deadline)
        return text

    monkeypatch.setattr(api.main, "transcribe_media_file", transcribe)


def post_recording(api, name="lecture.mp3", body=b"ID3 audio", token="token-a"):
    return api.post("/api/analyze/media", files={"file": (name, body, "audio/mpeg")},
                    data={"enabled_agents": json.dumps(["summarizer"])},
                    headers={"Authorization": f"Bearer {token}"})


def events(response):
    out = []
    for block in response.text.split("\n\n"):
        block = block.strip()
        if block.startswith("data: "):
            out.append(json.loads(block[6:]))
    return out


def run(coro):
    return asyncio.run(coro)


# ── Prices ─────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("minutes, units", [
    (0, 20), (10, 20), (30, 20), (30.02, 30), (45, 30), (45.5, 40), (60, 40), (90, 60), (120, 80),
])
def test_a_recording_costs_a_lecture_up_to_30_minutes_and_10_more_for_each_started_15(minutes, units):
    assert plans.recording_cost(minutes * 60) == units


@pytest.mark.parametrize("chars, units", [(1, 20), (50_000, 20), (50_001, 30), (100_000, 30), (100_001, 40), (300_000, 70)])
def test_a_text_costs_a_lecture_up_to_50000_characters_and_10_more_for_each_started_50000(chars, units):
    assert plans.text_cost(chars) == units


def test_the_browser_shows_the_same_recording_and_text_prices():
    source = (Path(__file__).resolve().parents[2] / "frontend" / "src" / "lib" / "plans.ts").read_text(encoding="utf-8")
    for line in ("RECORDING_BASE_SECONDS = 30 * 60;", "RECORDING_STEP_SECONDS = 15 * 60;", "RECORDING_STEP_UNITS = 10;",
                 "RECORDING_MAX_SECONDS = 2 * 60 * 60;", "{ free: 2 * 60 * 60, pro: 5 * 60 * 60 }",
                 "TEXT_BASE_CHARS = 50_000;", "TEXT_STEP_CHARS = 50_000;", "TEXT_STEP_UNITS = 10;"):
        assert line in source, line


def test_the_limits_of_recordings():
    assert plans.RECORDING_MAX_SECONDS == 7200
    assert plans.RECORDING_DAILY_SECONDS == {"free": 7200, "pro": 18000}
    assert quota.hours_minutes(2700) == "45 мин" and quota.hours_minutes(3900) == "1 ч 05 мин"
    assert quota.hours_minutes(7200) == "2 ч" and quota.hours_minutes(7201) == "2 ч 01 мин"


# ── The length, measured by ffmpeg ─────────────────────────────────────────────


needs_ffmpeg = pytest.mark.skipif(audio_pieces.ffmpeg_exe() is None, reason="no ffmpeg")


def _make(tmp_path, name, *args):
    path = tmp_path / name
    subprocess.run([audio_pieces.ffmpeg_exe(), "-loglevel", "error", "-y", *args, str(path)], check=True)
    return path


@needs_ffmpeg
def test_probe_seconds_reads_the_length_of_the_sound_without_decoding_it(tmp_path, real_recording_length):
    mp3 = _make(tmp_path, "a.mp3", "-f", "lavfi", "-i", "sine=frequency=440:duration=95", "-c:a", "libmp3lame", "-b:a", "32k")
    assert run(audio_pieces.probe_seconds(audio_pieces.ffmpeg_exe(), str(mp3))) == pytest.approx(95, abs=0.2)
    silent = _make(tmp_path, "v.mp4", "-f", "lavfi", "-i", "testsrc=duration=3:size=64x48", "-c:v", "libx264")
    with pytest.raises(audio_pieces.FfmpegError):
        run(audio_pieces.probe_seconds(audio_pieces.ffmpeg_exe(), str(silent)))
    junk = tmp_path / "junk.mp3"
    junk.write_bytes(b"not a recording")
    with pytest.raises(audio_pieces.FfmpegError):
        run(audio_pieces.probe_seconds(audio_pieces.ffmpeg_exe(), str(junk)))


@needs_ffmpeg
def test_a_file_without_sound_is_refused_before_the_charge(api, real_recording_length):
    response = post_recording(api, body=b"not a recording")
    assert response.status_code == 400
    assert response.json()["code"] == "recording_unreadable" and "Лимит не списан" in response.json()["detail"]
    assert api.server.calls == []


# ── The route: cap, price, the day's total ─────────────────────────────────────


def test_a_recording_over_two_hours_is_refused_before_anything_is_charged(api, monkeypatch):
    recording_of(monkeypatch, 2 * 3600 + 15 * 60)
    response = post_recording(api)
    assert response.status_code == 400
    body = response.json()
    assert body["code"] == "recording_too_long"
    assert body["detail"].startswith("Запись длится 2 ч 15 мин — это больше 2 часов.")
    assert api.server.calls == []


def test_a_45_minute_recording_costs_30_units_and_counts_its_seconds(api, monkeypatch):
    recording_of(monkeypatch, 45 * 60)
    deadlines = []
    transcribe_as(monkeypatch, api, seen=deadlines)
    api.answer_with(SUMMARY)
    response = post_recording(api)
    assert [item["type"] for item in events(response)][-2:] == ["results", "done"]
    assert api.server.rpc("consume_recording_seconds") == [{"p_seconds": 2700}]
    assert api.server.rpc("consume_ai_units") == [{"p_units": 30, "p_kind": "lecture"}]
    assert api.server.recording_used == 2700 and api.server.used == 30
    assert api.server.rpc("refund_recording_seconds") == [] and api.server.rpc("refund_ai_units") == []


def test_a_photo_costs_a_lecture_and_is_not_measured(api, monkeypatch):
    async def never(exe, path):
        raise AssertionError("a photo is not a recording")

    monkeypatch.setattr(audio_pieces, "probe_seconds", never)
    monkeypatch.setattr(api.main.ocr, "recognize_photo", lambda *a, **k: _text(LECTURE))
    api.answer_with(SUMMARY)
    png = b"\x89PNG\r\n\x1a\n" + b"\0" * 64
    response = api.post("/api/analyze/media", files={"file": ("page.png", png, "image/png")},
                        data={"enabled_agents": json.dumps(["summarizer"])})
    assert [item["type"] for item in events(response)][-1] == "done"
    assert api.server.rpc("consume_ai_units") == [{"p_units": 20, "p_kind": "lecture"}]
    assert api.server.rpc("consume_recording_seconds") == []


async def _text(value):
    return value


def test_a_recording_over_the_days_total_is_refused_and_nothing_is_charged(api, monkeypatch):
    api.server.recording_used = 6000
    recording_of(monkeypatch, 30 * 60)
    response = post_recording(api)
    assert response.status_code == 429
    body = response.json()
    assert body["code"] == "recording_day_limit"
    assert body["detail"] == (
        "Сегодня вы уже загрузили записей на 1 ч 40 мин из 2 ч. Эта запись длится 30 мин — она не помещается. "
        "Новые записи можно будет загрузить завтра, лимит не списан."
    )
    assert body["used"] == 6000 and body["limit"] == 7200 and body["seconds"] == 1800 and body["resets_at"] == RESETS_AT
    assert api.server.rpc("consume_ai_units") == [] and api.server.recording_used == 6000


def test_units_over_the_daily_limit_give_the_recordings_seconds_back(api, monkeypatch):
    api.server.used = 90
    recording_of(monkeypatch, 60 * 60)
    response = post_recording(api)
    assert response.status_code == 429 and response.json()["code"] == "ai_limit" and response.json()["units"] == 40
    assert len(api.server.rpc("refund_recording_seconds")) == 1 and api.server.recording_used == 0


def test_a_failed_transcription_gives_back_both_the_units_and_the_seconds(api, monkeypatch):
    recording_of(monkeypatch, 40 * 60)

    async def fails(path, mime_type=None, **kwargs):
        raise api.main.MediaProcessingTimeout()

    monkeypatch.setattr(api.main, "transcribe_media_file", fails)
    response = post_recording(api)
    assert events(response)[-1]["code"] == "timeout"
    run(quota.drain_background())
    assert api.server.used == 0 and api.server.recording_used == 0


def test_a_check_that_is_unavailable_lets_the_recording_through(api, monkeypatch):
    recording_of(monkeypatch, 20 * 60)
    transcribe_as(monkeypatch, api)
    api.answer_with(SUMMARY)
    original = api.server.handler

    async def no_recording_functions(request):
        if request.url.path.endswith("/consume_recording_seconds"):
            return httpx.Response(404, json={"code": "PGRST202"})
        return await original(request)

    monkeypatch.setattr(api.server, "handler", no_recording_functions)
    monkeypatch.setattr(quota.supabase_rest, "_transport", httpx.MockTransport(no_recording_functions))
    response = post_recording(api)
    assert [item["type"] for item in events(response)][-1] == "done"
    assert api.server.used == 20


# ── The transcription's budget by length ──────────────────────────────────────


def test_the_transcription_budget_grows_with_the_recording(monkeypatch):
    import main

    monkeypatch.delenv("MEDIA_TRANSCRIBE_TIMEOUT_SECONDS", raising=False)
    assert main.media_transcribe_timeout_seconds() == 480
    assert main.media_transcribe_timeout_seconds(20 * 60) == 480
    assert main.media_transcribe_timeout_seconds(3600) == pytest.approx(660)
    assert main.media_transcribe_timeout_seconds(7200) == 900
    monkeypatch.setenv("MEDIA_TRANSCRIBE_TIMEOUT_SECONDS", "30")
    assert main.media_transcribe_timeout_seconds(7200) == 30


# ── The queue of long recordings ───────────────────────────────────────────────


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


def test_the_queue_takes_long_recordings_in_turn_and_estimates_the_wait():
    async def go():
        clock = Clock()
        queue = recording_queue.RecordingQueue(clock)
        first = queue.join(3600, "user-a")
        second = queue.join(1800, "user-b")
        third = queue.join(1200, "user-c")
        assert first.active and not second.active and not third.active
        # 3600 s of audio is 540 s of work: the second waits 9 min, the third 9 + 4.5 → 14 min.
        assert queue.status(second).endswith("примерно через 9 мин.")
        assert queue.status(third).endswith("примерно через 14 мин.")
        clock.now += 300
        assert queue.status(second).endswith("примерно через 4 мин.")
        assert queue.refusal("user-a") == recording_queue.OWN_MESSAGE
        assert queue.refusal("user-d") is None
        queue.leave(second)  # its page is gone: the third moves up
        queue.leave(first)
        assert third.active and queue.waiting == 0
        queue.leave(third)
        assert queue.refusal("user-a") is None

    run(go())


def test_the_queue_refuses_a_fifth_waiting_recording():
    async def go():
        queue = recording_queue.RecordingQueue(Clock())
        queue.join(3600, "owner")
        for index in range(recording_queue.MAX_WAITING):
            queue.join(1200, f"user-{index}")
        refusal = queue.refusal("someone")
        assert refusal and refusal.startswith("Сейчас Meldy распознаёт несколько длинных записей.")
        assert "лимит не списан" in refusal

    run(go())


def test_a_long_recording_waits_its_turn_and_hears_where_it_is(api, monkeypatch):
    recording_of(monkeypatch, 40 * 60)
    monkeypatch.setattr(recording_queue, "STATUS_EVERY_SECONDS", 0.05)
    transcribe_as(monkeypatch, api)
    api.answer_with(SUMMARY)
    holder = recording_queue.QUEUE.join(3600, "user-b")
    original_status = recording_queue.QUEUE.status
    heard = []

    def status(ticket):
        # The other recording is done after the page heard its place twice (inside the stream's own loop).
        heard.append(ticket)
        if len(heard) == 2:
            recording_queue.QUEUE.leave(holder)
        return original_status(ticket)

    monkeypatch.setattr(recording_queue.QUEUE, "status", status)
    response = post_recording(api)
    items = events(response)
    statuses = [item["message"] for item in items if item["type"] == "status"]
    assert any(message.startswith("Сейчас Meldy распознаёт другую длинную запись.") for message in statuses)
    assert items[-1]["type"] == "done" and recording_queue.QUEUE.waiting == 0


def test_a_recording_that_waited_too_long_gives_up_with_its_units_back(api, monkeypatch):
    recording_of(monkeypatch, 40 * 60)
    monkeypatch.setattr(recording_queue, "STATUS_EVERY_SECONDS", 0.02)
    monkeypatch.setattr(recording_queue, "MAX_WAIT_SECONDS", 0.1)
    transcribe_as(monkeypatch, api)
    recording_queue.QUEUE.join(3600, "user-b")
    response = post_recording(api)
    last = events(response)[-1]
    assert last == {"type": "error", "code": "queue_timeout", "message": recording_queue.TIMEOUT_MESSAGE}
    run(quota.drain_background())
    assert api.server.used == 0 and api.server.recording_used == 0
    assert recording_queue.QUEUE.waiting == 0


def test_a_full_queue_and_a_second_own_recording_are_refused_before_the_charge(api, monkeypatch):
    recording_of(monkeypatch, 40 * 60)
    recording_queue.QUEUE.join(3600, "user-a")
    response = post_recording(api)
    assert response.status_code == 429 and response.json()["code"] == "recording_queue_full"
    assert response.json()["detail"] == recording_queue.OWN_MESSAGE
    for index in range(recording_queue.MAX_WAITING):
        recording_queue.QUEUE.join(1200, f"user-{index}")
    response = post_recording(api, token="token-b")
    assert response.status_code == 429 and response.json()["code"] == "recording_queue_full"
    assert api.server.calls == []


def test_a_short_recording_never_waits(api, monkeypatch):
    recording_of(monkeypatch, 8 * 60)
    transcribe_as(monkeypatch, api)
    api.answer_with(SUMMARY)
    recording_queue.QUEUE.join(3600, "user-b")
    response = post_recording(api)
    statuses = [item["message"] for item in events(response) if item["type"] == "status"]
    assert not any("очереди" in message for message in statuses)
    assert events(response)[-1]["type"] == "done"
