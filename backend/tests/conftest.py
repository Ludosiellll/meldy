"""Shared test setup: the daily AI limit and the model-call log talk to Supabase, so they are off
in every test (AI_QUOTA_DISABLED, AI_CALL_LOG_DISABLED) unless the test asks for ``quota_on``."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@pytest.fixture(autouse=True)
def _ai_quota_off_by_default(monkeypatch):
    monkeypatch.setenv("AI_QUOTA_DISABLED", "1")
    monkeypatch.setenv("AI_CALL_LOG_DISABLED", "1")


@pytest.fixture
def quota_on(monkeypatch):
    """The daily limit and the call log as in production (tests mock PostgREST themselves)."""
    monkeypatch.delenv("AI_QUOTA_DISABLED", raising=False)
    monkeypatch.delenv("AI_CALL_LOG_DISABLED", raising=False)
