"""/api/tts: retries, the clip caches, one synthesis per clip, the edge-tts slots and the rate limit.

edge-tts is never reached: every test replaces edge_tts.Communicate with a scripted fake.
"""
import asyncio
import os
import sys
import time
from pathlib import Path

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ratelimit import RATE_LIMIT_DETAIL, user_or_ip_key  # noqa: E402

# Bigger than TTS_MIN_CACHED_BYTES, like a real clip (edge-tts gives ~6 KB per second).
CLIP = b"ID3" + bytes(range(256)) * 8
FAILURE = {"detail": "Не удалось озвучить текст"}
TOKENS = {"token-a": "student-a", "token-b": "student-b"}


class FakeEdge:
    """Scripted edge-tts: each synthesis takes the next outcome, the last one repeats.

    ok — the clip in two audio chunks; empty — boundaries only; error — the stream breaks;
    hang — never answers; slow — the clip after a short pause; tiny — a 7-byte fragment.
    """

    def __init__(self, *outcomes):
        self.outcomes = list(outcomes) or ["ok"]
        self.calls = []
        self.active = 0
        self.max_active = 0

    def communicate(self):
        edge = self

        class Communicate:
            def __init__(self, text, voice, rate=None):
                edge.calls.append({"text": text, "voice": voice, "rate": rate})
                self.outcome = edge.outcomes.pop(0) if len(edge.outcomes) > 1 else edge.outcomes[0]

            async def stream(self):
                edge.active += 1
                edge.max_active = max(edge.max_active, edge.active)
                try:
                    if self.outcome == "error":
                        raise RuntimeError("connection reset by https://speech.platform.bing.com")
                    if self.outcome == "hang":
                        await asyncio.sleep(30)
                    if self.outcome == "slow":
                        await asyncio.sleep(0.05)
                    yield {"type": "WordBoundary", "offset": 1}
                    if self.outcome == "tiny":
                        yield {"type": "audio", "data": b"ID3-mp3"}
                    elif self.outcome != "empty":
                        yield {"type": "audio", "data": CLIP[:1000]}
                        yield {"type": "audio", "data": CLIP[1000:]}
                finally:
                    edge.active -= 1

        return Communicate


@pytest.fixture
def tts(monkeypatch, tmp_path):
    """Fresh caches and slots for every test, the disk cache in tmp_path, short pauses."""
    import edge_tts
    import main
    from fastapi.testclient import TestClient

    async def fake_user(request):
        token = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
        if token not in TOKENS:
            raise HTTPException(status_code=401, detail="Требуется войти в аккаунт")
        return {"id": TOKENS[token]}

    monkeypatch.setattr(main, "require_authenticated_user", fake_user)
    monkeypatch.setattr(main.limiter, "enabled", False)
    monkeypatch.setattr(main, "_tts_memory_cache", main._TTSClipCache(main.TTS_MEMORY_MAX_CLIPS, main.TTS_MEMORY_MAX_BYTES))
    monkeypatch.setattr(main, "_tts_inflight", {})
    monkeypatch.setattr(main, "_tts_slot_state", {})
    monkeypatch.setattr(main, "TTS_DISK_CACHE_DIR", str(tmp_path / "tts"))
    monkeypatch.setattr(main, "TTS_RETRY_DELAYS", (0.01, 0.02))

    class Api:
        edge = FakeEdge()
        client = TestClient(main.app, headers={"Authorization": "Bearer token-a"})

        def script(self, *outcomes):
            self.edge = FakeEdge(*outcomes)
            monkeypatch.setattr(edge_tts, "Communicate", self.edge.communicate())
            return self.edge

        def post(self, text="Привет, это Софья.", role="female", **kwargs):
            return self.client.post("/api/tts", json={"text": text, "role": role}, **kwargs)

    api = Api()
    api.main = main
    api.disk = tmp_path / "tts"
    api.script("ok")
    return api


# ── Retries ──────────────────────────────────────────────────────────────────


def test_a_failed_attempt_is_retried_and_the_clip_is_returned(tts):
    edge = tts.script("error", "ok")
    response = tts.post()
    assert response.status_code == 200
    assert response.content == CLIP
    assert response.headers["content-type"] == "audio/mpeg"
    # Voice, rate and text fully determine the clip: the browser may keep it for a day.
    assert response.headers["cache-control"] == "private, max-age=86400"
    assert edge.calls == [{"text": "Привет, это Софья.", "voice": "ru-RU-SvetlanaNeural", "rate": "+20%"}] * 2


def test_empty_audio_counts_as_a_failed_attempt(tts):
    edge = tts.script("empty", "empty", "ok")
    response = tts.post()
    assert response.status_code == 200
    assert response.content == CLIP
    assert len(edge.calls) == 3


def test_when_every_attempt_fails_the_answer_is_an_honest_502_and_nothing_is_cached(tts):
    edge = tts.script("error", "empty", "error")
    response = tts.post()
    assert response.status_code == 502
    assert response.json() == FAILURE
    assert "bing" not in response.text and "reset" not in response.text
    assert len(edge.calls) == 3
    assert len(tts.main._tts_memory_cache) == 0
    assert not tts.disk.exists() or not list(tts.disk.glob("*.mp3"))

    # The next request asks edge-tts again instead of serving a remembered failure.
    tts.script("ok")
    assert tts.post().status_code == 200


def test_attempts_are_spaced_by_the_backoff(tts, monkeypatch):
    assert tts.main.TTS_ATTEMPTS == 3
    monkeypatch.setattr(tts.main, "TTS_RETRY_DELAYS", (0.1, 0.2))
    tts.script("error")
    started = time.monotonic()
    assert tts.post().status_code == 502
    assert 0.3 <= time.monotonic() - started < 2


def test_production_settings_bound_one_request_to_40_seconds():
    import main

    # Three attempts, 0.4 s and 1.2 s apart, 15 s each, at most 40 s together, 3 at a time.
    assert main.TTS_ATTEMPTS == 3
    assert main.TTS_RETRY_DELAYS == (0.4, 1.2)
    assert main.TTS_ATTEMPT_SECONDS == 15.0
    assert main.TTS_TIMEOUT_SECONDS == 40.0
    assert main.TTS_CONCURRENCY == 3
    assert (main.TTS_MEMORY_MAX_CLIPS, main.TTS_MEMORY_MAX_BYTES) == (300, 64 * 1024 * 1024)


def test_a_hanging_attempt_is_cut_off_and_retried(tts, monkeypatch):
    monkeypatch.setattr(tts.main, "TTS_ATTEMPT_SECONDS", 0.1)
    edge = tts.script("hang", "ok")
    started = time.monotonic()
    response = tts.post("Привет")
    assert response.status_code == 200
    assert response.content == CLIP
    assert len(edge.calls) == 2
    assert time.monotonic() - started < 3


def test_the_whole_request_is_bounded(tts, monkeypatch):
    monkeypatch.setattr(tts.main, "TTS_ATTEMPT_SECONDS", 0.2)
    monkeypatch.setattr(tts.main, "TTS_TIMEOUT_SECONDS", 0.3)
    edge = tts.script("hang")
    started = time.monotonic()
    response = tts.post("Привет")
    assert response.status_code == 502
    assert response.json() == FAILURE
    # The second attempt gets only what is left of the 0.3 s; there is no time for a third.
    assert len(edge.calls) == 2
    assert time.monotonic() - started < 2


def test_env_numbers_fall_back_on_typos(monkeypatch):
    import main

    monkeypatch.setenv("TTS_TEST_NUMBER", "пятнадцать")
    assert main._tts_env_number("TTS_TEST_NUMBER", 15.0) == 15.0
    monkeypatch.setenv("TTS_TEST_NUMBER", "-1")
    assert main._tts_env_number("TTS_TEST_NUMBER", 15.0) == 15.0
    monkeypatch.setenv("TTS_TEST_NUMBER", "20")
    assert main._tts_env_number("TTS_TEST_NUMBER", 15.0) == 20.0
    monkeypatch.delenv("TTS_TEST_NUMBER")
    assert main._tts_env_number("TTS_TEST_NUMBER", 15.0) == 15.0


# ── Caches ───────────────────────────────────────────────────────────────────


def test_a_cached_clip_is_served_without_edge_tts(tts):
    edge = tts.script("ok")
    first = tts.post()
    second = tts.post()
    assert first.status_code == second.status_code == 200
    assert second.content == first.content == CLIP
    assert second.headers["cache-control"] == "private, max-age=86400"
    assert len(edge.calls) == 1

    # Another voice is another clip; «professor» and «male» share Dmitry and so share the clip.
    assert tts.post(role="male").status_code == 200
    assert tts.post(role="professor").status_code == 200
    assert tts.post(role="кто-то").status_code == 200
    assert [call["voice"] for call in edge.calls] == ["ru-RU-SvetlanaNeural", "ru-RU-DmitryNeural"]


def test_the_cache_key_is_voice_rate_and_text(tts):
    main = tts.main
    key = main._tts_cache_key("ru-RU-SvetlanaNeural", "Привет")
    assert len(key) == 64
    assert key != main._tts_cache_key("ru-RU-DmitryNeural", "Привет")
    assert key != main._tts_cache_key("ru-RU-SvetlanaNeural", "Привет!")
    # The text is trimmed before it becomes a key: spaces around it make no new clip.
    edge = tts.script("ok")
    tts.post("Привет")
    tts.post("  Привет \n")
    assert len(edge.calls) == 1


def test_the_disk_cache_serves_a_clip_after_the_memory_cache_is_gone(tts, monkeypatch):
    edge = tts.script("ok")
    assert tts.post().status_code == 200
    files = list(tts.disk.glob("*.mp3"))
    key = tts.main._tts_cache_key("ru-RU-SvetlanaNeural", "Привет, это Софья.")
    assert [path.name for path in files] == [f"{key}.mp3"]
    assert files[0].read_bytes() == CLIP
    assert not list(tts.disk.glob("*.tmp"))

    # A new process: empty memory, the same container disk.
    monkeypatch.setattr(tts.main, "_tts_memory_cache", tts.main._TTSClipCache(10, 10 * 1024 * 1024))
    response = tts.post()
    assert response.status_code == 200
    assert response.content == CLIP
    assert len(edge.calls) == 1
    assert tts.main._tts_memory_cache.get(key) == CLIP


def test_disk_errors_never_fail_the_request(tts, monkeypatch):
    blocker = tts.disk.parent / "not-a-folder"
    blocker.write_text("файл, а не папка")
    monkeypatch.setattr(tts.main, "TTS_DISK_CACHE_DIR", str(blocker))
    edge = tts.script("ok")
    response = tts.post()
    assert response.status_code == 200
    assert response.content == CLIP
    # The memory cache still works.
    assert tts.post().status_code == 200
    assert len(edge.calls) == 1


def test_the_disk_cache_can_be_turned_off(tts, monkeypatch):
    monkeypatch.setattr(tts.main, "TTS_DISK_CACHE_DIR", "")
    tts.script("ok")
    assert tts.post().status_code == 200
    assert not tts.disk.exists()


def test_a_fragment_is_returned_but_never_cached(tts):
    edge = tts.script("tiny")
    first = tts.post()
    assert first.status_code == 200
    assert first.content == b"ID3-mp3"
    assert tts.post().status_code == 200
    assert len(edge.calls) == 2
    assert not tts.disk.exists() or not list(tts.disk.glob("*.mp3"))


def test_the_memory_cache_is_bounded_by_clips_and_bytes():
    import main

    clip = lambda marker: marker * 2000  # noqa: E731
    cache = main._TTSClipCache(max_clips=2, max_bytes=10_000)
    cache.put("a", clip(b"a"))
    cache.put("b", clip(b"b"))
    assert cache.get("a") == clip(b"a")  # «a» is now the most recent
    cache.put("c", clip(b"c"))
    assert cache.get("b") is None
    assert cache.get("a") and cache.get("c")
    assert len(cache) == 2 and cache.total_bytes == 4000

    by_bytes = main._TTSClipCache(max_clips=100, max_bytes=5000)
    for name in (b"x", b"y", b"z"):
        by_bytes.put(name.decode(), clip(name))
    assert by_bytes.get("x") is None
    assert by_bytes.total_bytes == 4000

    # Fragments and clips bigger than the whole budget are not kept.
    by_bytes.put("tiny", b"ID3")
    by_bytes.put("huge", b"h" * 6000)
    assert by_bytes.get("tiny") is None and by_bytes.get("huge") is None
    # Putting the same key again replaces it without counting it twice.
    by_bytes.put("y", clip(b"Y"))
    assert by_bytes.total_bytes == 4000 and by_bytes.get("y") == clip(b"Y")


def test_the_disk_cache_drops_the_oldest_clips(tmp_path, monkeypatch):
    import main

    monkeypatch.setattr(main, "TTS_DISK_MAX_FILES", 2)
    folder = str(tmp_path / "tts")
    main._tts_disk_write(folder, "a" * 64, CLIP)
    main._tts_disk_write(folder, "b" * 64, CLIP)
    os.utime(os.path.join(folder, "a" * 64 + ".mp3"), (1000, 1000))
    os.utime(os.path.join(folder, "b" * 64 + ".mp3"), (2000, 2000))
    main._tts_disk_write(folder, "c" * 64, CLIP)
    assert sorted(name[0] for name in os.listdir(folder)) == ["b", "c"]

    # Reading a clip makes it fresh again, so it outlives an older unread one.
    os.utime(os.path.join(folder, "c" * 64 + ".mp3"), (3000, 3000))
    assert main._tts_disk_read(folder, "b" * 64) == CLIP
    main._tts_disk_write(folder, "d" * 64, CLIP)
    assert sorted(name[0] for name in os.listdir(folder)) == ["b", "d"]

    monkeypatch.setattr(main, "TTS_DISK_MAX_FILES", 100)
    monkeypatch.setattr(main, "TTS_DISK_MAX_BYTES", len(CLIP) * 2)
    main._tts_disk_write(folder, "e" * 64, CLIP)
    assert len(os.listdir(folder)) == 2
    assert main._tts_disk_read(folder, "missing") is None


# ── One synthesis per clip, a few at a time ──────────────────────────────────


def test_identical_requests_wait_for_one_shared_synthesis(tts):
    main = tts.main
    edge = tts.script("slow")
    key = main._tts_cache_key("ru-RU-DmitryNeural", "Общая реплика")

    async def together():
        return await asyncio.gather(*(main._tts_shared_clip(key, "Общая реплика", "ru-RU-DmitryNeural") for _ in range(4)))

    assert asyncio.run(together()) == [CLIP] * 4
    assert len(edge.calls) == 1
    assert main._tts_inflight == {}


def test_a_shared_synthesis_outlives_a_request_that_went_away(tts):
    main = tts.main
    edge = tts.script("slow")
    key = main._tts_cache_key("ru-RU-DmitryNeural", "Ушедший клиент")

    async def scenario():
        leaving = asyncio.ensure_future(main._tts_shared_clip(key, "Ушедший клиент", "ru-RU-DmitryNeural"))
        await asyncio.sleep(0.01)
        leaving.cancel()
        # The client retries: it joins the synthesis that is still running.
        return await main._tts_shared_clip(key, "Ушедший клиент", "ru-RU-DmitryNeural")

    assert asyncio.run(scenario()) == CLIP
    assert len(edge.calls) == 1
    assert main._tts_memory_cache.get(key) == CLIP


def test_no_more_than_the_allowed_syntheses_run_at_once(tts, monkeypatch):
    main = tts.main
    monkeypatch.setattr(main, "TTS_CONCURRENCY", 2)
    edge = tts.script("slow")
    texts = [f"Реплика {number}" for number in range(6)]

    async def burst():
        return await asyncio.gather(
            *(main._tts_shared_clip(main._tts_cache_key("ru-RU-DmitryNeural", text), text, "ru-RU-DmitryNeural") for text in texts)
        )

    assert asyncio.run(burst()) == [CLIP] * 6
    assert len(edge.calls) == 6
    assert edge.max_active == 2


# ── Input and limits ─────────────────────────────────────────────────────────


def test_empty_text_is_400_without_edge_tts(tts):
    edge = tts.script("ok")
    response = tts.post("   \n ")
    assert response.status_code == 400
    assert response.json() == {"detail": "Текст для озвучки пуст"}
    assert edge.calls == []


def test_tts_needs_a_session(tts):
    tts.script("ok")
    response = tts.post(headers={"Authorization": "Bearer unknown"})
    assert response.status_code == 401
    assert tts.edge.calls == []


def test_the_rate_limit_fits_a_whole_conversation_and_counts_per_user(tts, monkeypatch):
    main = tts.main
    limits = [(str(limit.limit), limit.key_func) for limit in main.limiter._route_limits["main.text_to_speech"]]
    assert limits == [("120 per 1 minute", user_or_ip_key), ("3000 per 1 day", user_or_ip_key)]

    edge = tts.script("ok")
    monkeypatch.setattr(main.limiter, "enabled", True)
    main.limiter.reset()
    try:
        # 30 lines, prefetched, played and replayed four times over: still under the limit.
        codes = [tts.post(f"Реплика {number % 30}").status_code for number in range(120)]
        assert codes == [200] * 120
        assert len(edge.calls) == 30  # every line is synthesised once, the rest are cache hits
        limited = tts.post("Реплика 1")
        assert limited.status_code == 429
        assert limited.json() == {"detail": RATE_LIMIT_DETAIL}
        other_user = tts.post("Реплика 1", headers={"Authorization": "Bearer token-b"})
        assert other_user.status_code == 200
    finally:
        main.limiter.reset()
