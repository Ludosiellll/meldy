"""A long text costs more (plans.text_cost) and a video link is read only from YouTube's subtitles through the owner's
proxy (2026-10-26). A pasted YouTube transcript loses its times. Supabase is the in-memory QuotaServer of test_quota.py.
"""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import media_parser  # noqa: E402
import quota  # noqa: E402
from test_quota import SECTION_ANSWERS, api, server  # noqa: E402,F401
from utils import is_youtube_link, strip_transcript_times  # noqa: E402

SUMMARY = SECTION_ANSWERS["summarizer"]
SENTENCE = "Инфляция — это устойчивый рост общего уровня цен на товары и услуги в экономике страны. "


def long_text(chars):
    return (SENTENCE * (chars // len(SENTENCE) + 1))[:chars]


def post_text(api, text, name="pasted-text.txt"):
    return api.post("/api/analyze", files={"file": (name, text.encode("utf-8"), "text/plain")},
                    data={"enabled_agents": json.dumps(["summarizer"])})


def events(response):
    return [json.loads(block.strip()[6:]) for block in response.text.split("\n\n") if block.strip().startswith("data: ")]


def run(coro):
    import asyncio

    return asyncio.run(coro)


# ── Long texts ─────────────────────────────────────────────────────────────────


def test_a_text_up_to_50000_characters_costs_a_lecture(api):
    api.answer_with(SUMMARY)
    response = post_text(api, long_text(50_000))
    assert events(response)[-1]["type"] == "done"
    assert api.server.rpc("consume_ai_units") == [{"p_units": 20, "p_kind": "lecture"}]


def test_a_120000_character_text_adds_20_units_for_its_length(api):
    api.answer_with(SUMMARY)
    response = post_text(api, long_text(120_000))
    assert events(response)[-1]["type"] == "done"
    assert api.server.rpc("consume_ai_units") == [{"p_units": 20, "p_kind": "lecture"}, {"p_units": 20, "p_kind": "lectureLong"}]
    assert api.server.used == 40 and api.server.rpc("refund_ai_units") == []


def test_a_long_text_over_the_daily_limit_ends_with_ai_limit_and_the_lecture_back(api):
    api.server.used = 70
    api.answer_with(SUMMARY)
    response = post_text(api, long_text(120_000))
    last = events(response)[-1]
    assert last["type"] == "error" and last["code"] == "ai_limit"
    # The page sees the day without this run and the price of the whole run.
    assert last["used"] == 70 and last["units"] == 40
    run(quota.drain_background())
    assert api.server.used == 70


def test_a_failed_analysis_gives_back_the_surcharge_too(api):
    from agents.base import AIError

    api.answer_with(AIError.failed())
    post_text(api, long_text(120_000))
    run(quota.drain_background())
    assert api.server.used == 0


# ── A pasted YouTube transcript ───────────────────────────────────────────────


def transcript(lines=30, inline=False):
    rows = []
    for index in range(lines):
        minute, second = divmod(index * 7, 60)
        phrase = f"это фраза номер {index} про инфляцию и рост цен."
        rows.append(f"{minute}:{second:02d} {phrase}" if inline else f"{minute}:{second:02d}\n{phrase}")
    return "\n".join(rows)


@pytest.mark.parametrize("inline", [False, True])
def test_a_pasted_transcript_loses_its_times(inline):
    cleaned = strip_transcript_times(transcript(inline=inline))
    assert "0:07" not in cleaned and "1:03" not in cleaned
    assert cleaned.startswith("это фраза номер 0 про инфляцию") and "фраза номер 29" in cleaned


def test_the_spoken_times_of_a_screen_reader_go_too():
    text = "\n".join(f"0:{index:02d}\n{index} секунд\nфраза {index} про цены." for index in range(10, 40))
    cleaned = strip_transcript_times(text)
    assert "секунд" not in cleaned and "фраза 10 про цены. фраза 11" in cleaned


def test_a_text_with_a_few_times_stays_as_it_is():
    text = "Лекция начинается в 9:00.\nПерерыв в 10:30.\n" + "Инфляция — рост цен.\n" * 20
    assert strip_transcript_times(text) == text


def test_the_analysis_of_a_pasted_transcript_reads_no_times(api):
    api.answer_with(SUMMARY)
    response = post_text(api, transcript(60))
    extracted = next(item for item in events(response) if item["type"] == "text_extracted")
    assert "0:07" not in extracted["text"] and "фраза номер 59" in extracted["text"]


# ── Video links ────────────────────────────────────────────────────────────────


def test_youtube_links_are_known():
    for url in ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtu.be/abc", "https://m.youtube.com/watch?v=x"):
        assert is_youtube_link(url)
    for url in ("https://rutube.ru/video/1/", "https://vk.com/video-1_2", "https://example.com/youtube.com"):
        assert not is_youtube_link(url)


def test_with_the_proxy_a_youtube_link_is_read_from_its_subtitles(api, monkeypatch):
    seen = []

    async def captions(url, proxy):
        seen.append((url, proxy))
        return long_text(3000)

    monkeypatch.setenv("YOUTUBE_PROXY_URL", "http://proxy.invalid:8000")
    monkeypatch.setattr(api.main, "youtube_captions", captions)
    api.answer_with(SUMMARY)
    response = api.post("/api/analyze/url", data={"url": "https://youtu.be/dQw4w9WgXcQ",
                                                  "enabled_agents": json.dumps(["summarizer"])})
    items = events(response)
    assert items[0] == {"type": "status", "message": "Берём субтитры видео…"} and items[-1]["type"] == "done"
    assert seen == [("https://youtu.be/dQw4w9WgXcQ", "http://proxy.invalid:8000")]
    assert api.server.used == 20


def test_without_subtitles_the_link_ends_with_the_way_round_and_costs_nothing(api, monkeypatch):
    async def captions(url, proxy):
        raise media_parser.NoCaptions("TranscriptsDisabled")

    monkeypatch.setenv("YOUTUBE_PROXY_URL", "http://proxy.invalid:8000")
    monkeypatch.setattr(api.main, "youtube_captions", captions)
    response = api.post("/api/analyze/url", data={"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"})
    last = events(response)[-1]
    assert last == {"type": "error", "code": "no_text", "message": api.main.NO_CAPTIONS_MESSAGE}
    run(quota.drain_background())
    assert api.server.used == 0


def test_with_the_proxy_other_video_hosts_are_still_refused_before_the_charge(api, monkeypatch):
    monkeypatch.setenv("YOUTUBE_PROXY_URL", "http://proxy.invalid:8000")
    response = api.post("/api/analyze/url", data={"url": "https://rutube.ru/video/abc/"})
    assert response.status_code == 400 and response.json() == {"detail": api.main.VIDEO_LINK_DETAIL}
    assert api.server.calls == []


def test_the_subtitles_skip_sound_marks_and_join_the_lines(monkeypatch):
    class Transcript:
        def fetch(self):
            return [{"text": "[Музыка]"}, {"text": "Итак,\nсегодня"}, {"text": "  говорим об инфляции. "}]

    class Listing:
        def find_transcript(self, languages):
            assert languages[0] == "ru"
            return Transcript()

    class Api:
        def __init__(self, proxy_config=None):
            assert proxy_config is not None

        def list(self, video_id):
            assert video_id == "dQw4w9WgXcQ"
            return Listing()

    import youtube_transcript_api

    monkeypatch.setattr(youtube_transcript_api, "YouTubeTranscriptApi", Api)
    text = run(media_parser.youtube_captions("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "http://proxy.invalid:1"))
    assert text == "Итак, сегодня говорим об инфляции."


def test_a_refused_subtitles_request_is_no_captions(monkeypatch):
    class Api:
        def __init__(self, proxy_config=None):
            pass

        def list(self, video_id):
            raise RuntimeError("RequestBlocked")

    import youtube_transcript_api

    monkeypatch.setattr(youtube_transcript_api, "YouTubeTranscriptApi", Api)
    with pytest.raises(media_parser.NoCaptions):
        run(media_parser.youtube_captions("https://youtu.be/dQw4w9WgXcQ", "http://proxy.invalid:1"))
