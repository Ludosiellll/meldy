"""Распознавание устного ответа на сервере (stt.py, POST /api/oral/transcribe): фантомные титры
Whisper отбрасываются, Groq → Gemini, ошибки по-русски с кодами, ограничения формата и размера.
Сеть не нужна: оба сервиса подменены."""
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import stt  # noqa: E402
from agents.base import AIError  # noqa: E402

AUDIO = b"\x1aE\xdf\xa3" + b"\x00" * 4096  # webm-заголовок и тишина: формат проверяет сервис, не мы


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("Эластичность спроса — это чувствительность покупок к цене.", "Эластичность спроса — это чувствительность покупок к цене."),
        ("  Спрос   эластичен,\nесли покупки меняются сильнее цены. ", "Спрос эластичен, если покупки меняются сильнее цены."),
        ("Субтитры сделал DimaTorzok", ""),
        ("Продолжение следует...", ""),
        ("Спасибо за просмотр!", ""),
        ("[музыка]", ""),
        ("", ""),
        (None, ""),
        (
            "Выручка растёт, когда спрос неэластичен. Субтитры создавал DimaTorzok",
            "Выручка растёт, когда спрос неэластичен.",
        ),
    ],
)
def test_clean_transcript_drops_phantom_credits(raw, expected):
    assert stt.clean_transcript(raw) == expected


def test_clean_transcript_keeps_a_real_answer_that_mentions_music():
    text = "Музыкальная индустрия — пример рынка с эластичным спросом на билеты."
    assert stt.clean_transcript(text) == text


def run(coro):
    import asyncio

    return asyncio.run(coro)


def test_groq_first(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "gsk-test")
    monkeypatch.setenv("GEMINI_API_KEY", "gem-test")
    calls = []

    async def groq(data, mime, hint):
        calls.append(("groq", mime, hint))
        return "Спрос эластичен."

    async def gemini(data, mime, hint):  # pragma: no cover — не должен вызываться
        calls.append(("gemini", mime, hint))
        return "другое"

    monkeypatch.setattr(stt, "_groq_transcribe", groq)
    monkeypatch.setattr(stt, "_gemini_transcribe", gemini)
    assert run(stt.transcribe_answer(AUDIO, "audio/webm", "  Что такое   эластичность? ")) == "Спрос эластичен."
    assert calls == [("groq", "audio/webm", "Что такое эластичность?")]


def test_gemini_when_groq_fails(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "gsk-test")
    monkeypatch.setenv("GEMINI_API_KEY", "gem-test")

    async def groq(data, mime, hint):
        raise RuntimeError("connection reset")

    async def gemini(data, mime, hint):
        return "Издержки бывают постоянными и переменными."

    monkeypatch.setattr(stt, "_groq_transcribe", groq)
    monkeypatch.setattr(stt, "_gemini_transcribe", gemini)
    assert run(stt.transcribe_answer(AUDIO, "audio/webm")) == "Издержки бывают постоянными и переменными."


def test_both_fail_is_a_plain_russian_502(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "gsk-test")
    monkeypatch.setenv("GEMINI_API_KEY", "gem-test")

    async def fail(data, mime, hint):
        raise RuntimeError("upstream exploded with internal details")

    monkeypatch.setattr(stt, "_groq_transcribe", fail)
    monkeypatch.setattr(stt, "_gemini_transcribe", fail)
    with pytest.raises(AIError) as caught:
        run(stt.transcribe_answer(AUDIO, "audio/webm"))
    assert caught.value.status_code == 502 and caught.value.code == "stt_failed"
    assert caught.value.detail == stt.STT_FAILED_DETAIL


def test_rate_limited_is_busy(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "gsk-test")
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)

    class RateLimited(Exception):
        status_code = 429

    async def busy(data, mime, hint):
        raise RateLimited("429 Too Many Requests: rate limit")

    monkeypatch.setattr(stt, "_groq_transcribe", busy)
    with pytest.raises(AIError) as caught:
        run(stt.transcribe_answer(AUDIO, "audio/webm"))
    assert caught.value.status_code == 429


def test_no_keys_is_unconfigured(monkeypatch):
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    with pytest.raises(AIError) as caught:
        run(stt.transcribe_answer(AUDIO, "audio/webm"))
    assert caught.value.status_code == 503 and caught.value.code == "stt_unconfigured"


# ── Эндпоинт ────────────────────────────────────────────────────────────────────


@pytest.fixture
def client(monkeypatch):
    import main
    from fastapi.testclient import TestClient

    async def fake_user(request):
        if request.headers.get("authorization") != "Bearer token-a":
            raise HTTPException(status_code=401, detail="Требуется войти в аккаунт")
        return {"id": "user-a"}

    monkeypatch.setattr(main, "require_authenticated_user", fake_user)
    monkeypatch.setattr(main.limiter, "enabled", False)
    monkeypatch.setenv("GROQ_API_KEY", "gsk-test")
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    seen = []

    async def groq(data, mime, hint):
        seen.append({"bytes": len(data), "mime": mime, "hint": hint})
        return "Предельные издержки — это прирост издержек на единицу выпуска."

    monkeypatch.setattr(stt, "_groq_transcribe", groq)
    test_client = TestClient(main.app, headers={"Authorization": "Bearer token-a"})
    test_client.seen = seen
    return test_client


def test_endpoint_returns_text(client):
    response = client.post(
        "/api/oral/transcribe",
        params={"hint": "Что такое предельные издержки?"},
        content=AUDIO,
        headers={"Content-Type": "audio/webm;codecs=opus"},
    )
    assert response.status_code == 200, response.text
    assert response.json() == {"text": "Предельные издержки — это прирост издержек на единицу выпуска."}
    assert client.seen == [{"bytes": len(AUDIO), "mime": "audio/webm", "hint": "Что такое предельные издержки?"}]


def test_endpoint_needs_a_session(client):
    response = client.post(
        "/api/oral/transcribe", content=AUDIO, headers={"Content-Type": "audio/webm", "Authorization": "Bearer nope"}
    )
    assert response.status_code == 401


def test_endpoint_rejects_other_types(client):
    response = client.post("/api/oral/transcribe", content=AUDIO, headers={"Content-Type": "video/mp4"})
    assert response.status_code == 415
    assert response.json()["detail"] == "Такой формат записи не поддерживается."


def test_endpoint_rejects_large_pieces(client):
    big = b"\x00" * (3 * 1024 * 1024 + 1)
    response = client.post("/api/oral/transcribe", content=big, headers={"Content-Type": "audio/webm"})
    assert response.status_code == 413
    assert client.seen == []


def test_endpoint_tiny_piece_is_silence(client):
    response = client.post("/api/oral/transcribe", content=b"\x1aE\xdf\xa3", headers={"Content-Type": "audio/webm"})
    assert response.status_code == 200 and response.json() == {"text": ""}
    assert client.seen == []
