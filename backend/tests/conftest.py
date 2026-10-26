"""Shared test setup: the daily AI limit, the model-call log and the statistics (telemetry_api.py) talk to
Supabase, so they are off in every test (AI_QUOTA_DISABLED, AI_CALL_LOG_DISABLED, TELEMETRY_DISABLED) unless
the test asks for ``quota_on`` or ``telemetry_on``. Pairs resting after a 429 and the heavy-call line
(agents/base.py) live in process memory: every test starts without them."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agents import base as ai_base  # noqa: E402


@pytest.fixture(autouse=True)
def _ai_quota_off_by_default(monkeypatch):
    monkeypatch.setenv("AI_QUOTA_DISABLED", "1")
    monkeypatch.setenv("AI_CALL_LOG_DISABLED", "1")
    monkeypatch.setenv("TELEMETRY_DISABLED", "1")


@pytest.fixture(autouse=True)
def _no_resting_pairs_or_heavy_line(monkeypatch):
    for name in ("AI_COOLDOWN", "AI_HEAVY_CONCURRENCY"):
        monkeypatch.delenv(name, raising=False)
    ai_base.reset_cooldowns()
    ai_base.reset_heavy_line()
    yield
    ai_base.reset_cooldowns()
    ai_base.reset_heavy_line()


@pytest.fixture(autouse=True)
def _recordings_ten_minutes_long(monkeypatch, request):
    """A test's «recording» is a few bytes that ffmpeg cannot read: analyze_media measures every recording as 10 minutes
    (the price of a lecture, no queue) unless the test asks for ``real_recording_length``. The queue of long recordings
    (recording_queue.py) starts empty in every test."""
    import audio_pieces
    import recording_queue

    monkeypatch.setattr(recording_queue, "QUEUE", recording_queue.RecordingQueue())
    if "real_recording_length" in request.fixturenames:
        return

    async def ten_minutes(exe, path):
        return 600.0

    monkeypatch.setattr(audio_pieces, "probe_seconds", ten_minutes)


@pytest.fixture
def real_recording_length():
    """analyze_media measures the uploaded recording with ffmpeg, as in production."""


@pytest.fixture
def quota_on(monkeypatch):
    """The daily limit and the call log as in production (tests mock PostgREST themselves)."""
    monkeypatch.delenv("AI_QUOTA_DISABLED", raising=False)
    monkeypatch.delenv("AI_CALL_LOG_DISABLED", raising=False)


@pytest.fixture
def telemetry_on(monkeypatch):
    """Statistics and server error reports as in production (tests mock PostgREST themselves)."""
    monkeypatch.delenv("TELEMETRY_DISABLED", raising=False)
