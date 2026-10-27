"""A YouTube lecture by its link, for free (the owner, 2026-10-27): the watch page gives the length, Gemini writes the
speech down from the video's address in clips, and the video is priced, capped and counted as a recording of its length.
Supabase is the in-memory RecordingServer of test_recording_limits.py.
"""
import asyncio
import json
import sys
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import media_parser  # noqa: E402
import quota  # noqa: E402
import youtube_video  # noqa: E402
from agents.base import AIError  # noqa: E402
from test_quota import SECTION_ANSWERS, api  # noqa: E402,F401
from test_recording_limits import LECTURE, events, run, server  # noqa: E402,F401

SUMMARY = SECTION_ANSWERS["summarizer"]
LINK = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"


def watch_page(seconds=600, title="Лекция 5. Инфляция", status="OK", unlisted=False, live=False):
    player = {
        "playabilityStatus": {"status": status},
        "videoDetails": {"videoId": "dQw4w9WgXcQ", "lengthSeconds": str(seconds), "title": title,
                         "isLive": live, "isLiveContent": live},
        "microformat": {"playerMicroformatRenderer": {"isUnlisted": unlisted}},
    }
    return ('<html><script>var meta = {"a": 1};</script><script>var ytInitialPlayerResponse = '
            + json.dumps(player, ensure_ascii=False) + ';var ytInitialData = {};</script></html>')


def a_video(monkeypatch, seconds=600, title="Лекция 5. Инфляция"):
    async def info(url, *, client=None):
        return youtube_video.VideoInfo(video_id=youtube_video.video_id(url), seconds=seconds, title=title)

    monkeypatch.setattr(youtube_video, "video_info", info)


def written_down(monkeypatch, text=LECTURE, seen=None):
    async def transcribe(video, *, progress=None, deadline=None):
        if seen is not None:
            seen.append(video)
        if isinstance(text, BaseException):
            raise text
        if progress is not None:
            progress(float(video.seconds), float(video.seconds))
        return text

    monkeypatch.setattr(youtube_video, "transcribe", transcribe)


def post_link(api, url=LINK, **extra):
    return api.post("/api/analyze/url", data={"url": url, "enabled_agents": json.dumps(["summarizer"]), **extra},
                    headers={"Authorization": "Bearer token-a"})


# ── The link and the watch page ───────────────────────────────────────────────


@pytest.mark.parametrize("url", [
    LINK, "youtube.com/watch?v=dQw4w9WgXcQ&t=42s", "https://youtu.be/dQw4w9WgXcQ?si=abc",
    "https://m.youtube.com/watch?feature=share&v=dQw4w9WgXcQ", "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "https://www.youtube.com/embed/dQw4w9WgXcQ", "https://www.youtube.com/live/dQw4w9WgXcQ?feature=shared",
])
def test_the_video_id_of_every_kind_of_link(url):
    assert youtube_video.video_id(url) == "dQw4w9WgXcQ"


@pytest.mark.parametrize("url", ["https://www.youtube.com/", "https://www.youtube.com/@channel",
                                 "https://www.youtube.com/playlist?list=PL123", "https://youtu.be/short"])
def test_a_link_without_a_video_has_no_id(url):
    assert youtube_video.video_id(url) == ""


def test_the_length_and_the_title_come_from_the_watch_page():
    info = youtube_video.info_from_page("dQw4w9WgXcQ", watch_page(seconds=2843))
    assert info == youtube_video.VideoInfo("dQw4w9WgXcQ", 2843, "Лекция 5. Инфляция")
    assert info.url == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"


@pytest.mark.parametrize("page, reason", [
    (watch_page(status="ERROR"), "unavailable"),
    (watch_page(status="UNPLAYABLE"), "unavailable"),
    (watch_page(unlisted=True), "unlisted"),
    (watch_page(seconds=0, live=True), "live"),
    ("<html>Sign in to confirm you’re not a bot</html>", "unreadable"),
])
def test_a_video_gemini_cannot_take_is_refused_by_its_reason(page, reason):
    with pytest.raises(youtube_video.VideoUnavailable) as caught:
        youtube_video.info_from_page("dQw4w9WgXcQ", page)
    assert caught.value.reason == reason


def test_a_finished_stream_is_a_video_and_a_sign_in_wall_with_details_is_still_read():
    assert youtube_video.info_from_page("dQw4w9WgXcQ", watch_page(seconds=5400, live=False)).seconds == 5400
    assert youtube_video.info_from_page("dQw4w9WgXcQ", watch_page(status="LOGIN_REQUIRED")).seconds == 600


def test_the_watch_page_is_asked_for_as_a_browser_in_russian():
    seen = []

    def handler(request):
        seen.append(request)
        return httpx.Response(200, text=watch_page(seconds=1500))

    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler), headers=youtube_video.WATCH_HEADERS) as client:
            return await youtube_video.video_info("https://youtu.be/dQw4w9WgXcQ", client=client)

    assert run(go()).seconds == 1500
    assert seen[0].url.params["v"] == "dQw4w9WgXcQ" and seen[0].url.params["hl"] == "ru"
    assert "Chrome" in seen[0].headers["user-agent"] and "SOCS" in seen[0].headers["cookie"]


@pytest.mark.parametrize("answer", [httpx.Response(429, text="slow down"), httpx.ConnectError("down")])
def test_a_watch_page_that_does_not_come_is_unreadable(answer):
    def handler(request):
        if isinstance(answer, Exception):
            raise answer
        return answer

    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await youtube_video.video_info(LINK, client=client)

    with pytest.raises(youtube_video.VideoUnavailable) as caught:
        run(go())
    assert caught.value.reason == "unreadable"


# ── Clips and the speech ──────────────────────────────────────────────────────


@pytest.mark.parametrize("seconds, spans", [
    (40, [(0, 40)]), (900, [(0, 900)]), (1080, [(0, 1080)]), (1100, [(0, 900), (900, 1100)]),
    (3600, [(0, 900), (900, 1800), (1800, 2700), (2700, 3600)]),
])
def test_a_video_goes_in_clips_of_15_minutes_the_last_up_to_3_minutes_longer(seconds, spans):
    assert youtube_video.clips(seconds) == spans


def test_two_hours_are_eight_clips():
    assert len(youtube_video.clips(7200)) == 8 and youtube_video.clips(7200)[-1] == (6300, 7200)


def test_a_clip_is_the_videos_address_with_its_bounds_and_a_frame_every_10_seconds():
    info = youtube_video.VideoInfo("dQw4w9WgXcQ", 3000, "")
    part = youtube_video.clip_part(info, 900, 1800)
    assert part.file_data.file_uri == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    assert (part.video_metadata.start_offset, part.video_metadata.end_offset) == ("900s", "1800s")
    assert part.video_metadata.fps == 0.1
    # A whole short video has its bounds too: a length said shorter than the video's writes down only that much.
    whole = youtube_video.clip_part(youtube_video.VideoInfo("dQw4w9WgXcQ", 600, ""), 0, 600)
    assert (whole.video_metadata.start_offset, whole.video_metadata.end_offset) == ("0s", "600s")


@pytest.mark.parametrize("seconds, expected", [("213.04", 214), (19, 19), ("7200", 7200)])
def test_the_length_read_by_the_page_is_rounded_up(seconds, expected):
    assert youtube_video.info_from_length(LINK, seconds) == youtube_video.VideoInfo("dQw4w9WgXcQ", expected, "")


@pytest.mark.parametrize("url, seconds", [(LINK, None), (LINK, ""), (LINK, "abc"), (LINK, "0"), (LINK, "-5"),
                                          (LINK, "nan"), (LINK, "inf"), ("https://www.youtube.com/", "300")])
def test_a_length_that_is_no_length_is_not_taken(url, seconds):
    assert youtube_video.info_from_length(url, seconds) is None


def test_the_clips_are_written_down_together_and_joined_in_order(monkeypatch):
    asked, done = [], []

    async def gemini(path, mime, is_image=False, *, inline=None, prompt=None, low_media=False):
        start = inline.video_metadata.start_offset
        asked.append((start, prompt, low_media))
        await asyncio.sleep(0.01 if start == "0s" else 0)  # the first clip answers last
        return f"[музыка] Часть с {start}. (тишина)"

    monkeypatch.setattr(media_parser, "_transcribe_with_gemini", gemini)
    info = youtube_video.VideoInfo("dQw4w9WgXcQ", 2700, "")
    text = run(youtube_video.transcribe(info, progress=lambda d, t: done.append((d, t))))
    assert text == "Часть с 0s.\n\nЧасть с 900s.\n\nЧасть с 1800s."
    assert sorted(a[0] for a in asked) == ["0s", "1800s", "900s"]
    assert all(prompt == youtube_video.CLIP_PROMPT and low for _, prompt, low in asked)
    assert done[-1] == (2700.0, 2700.0) and len(done) == 3


@pytest.mark.parametrize("failure", [AIError.busy(), ValueError("Модели Gemini не справились с задачей.")])
def test_a_clip_that_fails_fails_the_video(monkeypatch, failure):
    async def gemini(path, mime, is_image=False, *, inline=None, prompt=None, low_media=False):
        if inline.video_metadata.start_offset == "900s":
            raise failure
        return "Текст."

    monkeypatch.setattr(media_parser, "_transcribe_with_gemini", gemini)
    with pytest.raises(type(failure)):
        run(youtube_video.transcribe(youtube_video.VideoInfo("dQw4w9WgXcQ", 2700, "")))


def test_the_gemini_request_of_a_clip_has_its_prompt_and_low_resolution(monkeypatch):
    assert media_parser._media_generation_config("gemini-3.5-flash-lite", True).media_resolution is not None
    assert media_parser._media_generation_config("gemini-3.5-flash-lite").media_resolution is None
    assert "только речь" in youtube_video.CLIP_PROMPT


# ── The route ─────────────────────────────────────────────────────────────────


def test_a_youtube_lecture_is_priced_and_counted_as_a_recording_of_its_length(api, monkeypatch):
    a_video(monkeypatch, seconds=2843)
    seen = []
    written_down(monkeypatch, seen=seen)
    api.answer_with(SUMMARY)
    items = events(post_link(api))
    assert items[0]["type"] == "status" and "Смотрим видео" in items[0]["message"]
    extracted = next(item for item in items if item["type"] == "text_extracted")
    assert extracted["transcribed"] is True and items[-1]["type"] == "done"
    # 47 min 23 s: 20 + 10 for 15 more minutes + 10 for the started next ones.
    assert api.server.rpc("consume_ai_units") == [{"p_units": 40, "p_kind": "lecture"}]
    assert api.server.rpc("consume_recording_seconds") == [{"p_seconds": 2843}]
    assert api.server.used == 40 and api.server.recording_used == 2843
    assert seen[0].video_id == "dQw4w9WgXcQ"


def test_the_length_the_page_read_from_youtubes_player_is_taken_without_the_watch_page(api, monkeypatch):
    async def info(url, *, client=None):
        raise AssertionError("the watch page must not be asked")

    monkeypatch.setattr(youtube_video, "video_info", info)
    seen = []
    written_down(monkeypatch, seen=seen)
    api.answer_with(SUMMARY)
    assert events(post_link(api, video_seconds="1843.6"))[-1]["type"] == "done"
    assert seen[0] == youtube_video.VideoInfo("dQw4w9WgXcQ", 1844, "")
    assert api.server.rpc("consume_ai_units") == [{"p_units": 30, "p_kind": "lecture"}]
    assert api.server.rpc("consume_recording_seconds") == [{"p_seconds": 1844}]


def test_a_length_over_2_hours_from_the_page_is_refused_too(api, monkeypatch):
    response = post_link(api, video_seconds="7300")
    assert response.status_code == 400 and response.json()["code"] == "recording_too_long"
    assert api.server.calls == []


def test_a_long_transcript_of_a_video_adds_no_charge_for_its_characters(api, monkeypatch):
    a_video(monkeypatch, seconds=3600)
    written_down(monkeypatch, text=LECTURE * 200)
    api.answer_with(SUMMARY)
    assert events(post_link(api))[-1]["type"] == "done"
    assert [call["p_kind"] for call in api.server.rpc("consume_ai_units")] == ["lecture"]


def test_a_video_over_2_hours_is_refused_before_anything_is_charged(api, monkeypatch):
    a_video(monkeypatch, seconds=7260)
    response = post_link(api)
    assert response.status_code == 400 and response.json()["code"] == "recording_too_long"
    assert "2 ч 01 мин" in response.json()["detail"] and api.server.calls == []


@pytest.mark.parametrize("reason", ["no_id", "unavailable", "unlisted", "live", "unreadable"])
def test_a_video_that_cannot_be_read_is_refused_before_anything_is_charged(api, monkeypatch, reason):
    async def info(url, *, client=None):
        raise youtube_video.VideoUnavailable(reason)

    monkeypatch.setattr(youtube_video, "video_info", info)
    response = post_link(api)
    assert response.status_code == 400
    assert response.json() == {"detail": api.main.YOUTUBE_UNAVAILABLE_DETAILS[reason], "code": "youtube_unavailable"}
    assert api.server.calls == []


def test_the_days_recordings_count_the_video_too(api, monkeypatch):
    api.server.recording_used = 7000
    a_video(monkeypatch, seconds=600)
    response = post_link(api)
    assert response.status_code == 429 and response.json()["code"] == "recording_day_limit"
    assert api.server.rpc("consume_ai_units") == []


@pytest.mark.parametrize("failure, code", [
    (ValueError("all models failed"), "no_text"), (AIError.busy(), "busy"), (media_parser.MediaProcessingTimeout(), "timeout"),
])
def test_a_video_that_is_not_written_down_gives_everything_back(api, monkeypatch, failure, code):
    a_video(monkeypatch, seconds=1200)
    written_down(monkeypatch, text=failure)
    last = events(post_link(api))[-1]
    assert last["type"] == "error" and last["code"] == code
    if code == "no_text":
        assert last["message"] == api.main.NO_CAPTIONS_MESSAGE and "Показать расшифровку" in last["message"]
    run(quota.drain_background())
    assert api.server.used == 0 and api.server.recording_used == 0


def test_with_the_proxy_the_subtitles_come_first_and_gemini_is_not_asked(api, monkeypatch):
    a_video(monkeypatch, seconds=900)
    written_down(monkeypatch, text=AssertionError("Gemini must not be asked"))

    async def captions(url, proxy):
        return LECTURE

    monkeypatch.setenv("YOUTUBE_PROXY_URL", "http://proxy.invalid:8000")
    monkeypatch.setattr(api.main, "youtube_captions", captions)
    api.answer_with(SUMMARY)
    items = events(post_link(api))
    assert items[0] == {"type": "status", "message": "Берём субтитры видео…"} and items[-1]["type"] == "done"


def test_with_the_proxy_and_no_subtitles_gemini_writes_the_speech_down(api, monkeypatch):
    a_video(monkeypatch, seconds=900)
    written_down(monkeypatch)

    async def captions(url, proxy):
        raise media_parser.NoCaptions("TranscriptsDisabled")

    monkeypatch.setenv("YOUTUBE_PROXY_URL", "http://proxy.invalid:8000")
    monkeypatch.setattr(api.main, "youtube_captions", captions)
    api.answer_with(SUMMARY)
    assert events(post_link(api))[-1]["type"] == "done"


def test_other_video_sites_are_still_refused_before_the_charge(api):
    response = post_link(api, "https://rutube.ru/video/abc/")
    assert response.status_code == 400 and response.json() == {"detail": api.main.VIDEO_LINK_DETAIL}
    assert api.server.calls == []


def test_the_page_asks_for_the_length_and_price_of_a_video_before_the_start(api, monkeypatch):
    a_video(monkeypatch, seconds=2843)
    response = api.get("/api/youtube/info", params={"url": LINK}, headers={"Authorization": "Bearer token-a"})
    assert response.status_code == 200
    assert response.json() == {"seconds": 2843, "title": "Лекция 5. Инфляция", "units": 40}
    assert api.server.calls == []


def test_the_length_of_a_video_needs_a_sign_in(api, monkeypatch):
    a_video(monkeypatch)
    response = api.get("/api/youtube/info", params={"url": LINK}, headers={"Authorization": "Bearer nobody"})
    assert response.status_code == 401
