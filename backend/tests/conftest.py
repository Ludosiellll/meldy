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


@pytest.fixture
def quota_on(monkeypatch):
    """The daily limit and the call log as in production (tests mock PostgREST themselves)."""
    monkeypatch.delenv("AI_QUOTA_DISABLED", raising=False)
    monkeypatch.delenv("AI_CALL_LOG_DISABLED", raising=False)


@pytest.fixture
def telemetry_on(monkeypatch):
    """Statistics and server error reports as in production (tests mock PostgREST themselves)."""
    monkeypatch.delenv("TELEMETRY_DISABLED", raising=False)
