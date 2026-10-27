"""A YouTube lecture by its link, for free (the owner, 2026-10-27: «нужно сделать что-то с получением субтитров, но
бесплатно»).

YouTube refuses its subtitles and its sound to servers of data centres: youtube-transcript-api gets RequestBlocked and a
caption track's address from the watch page comes back empty (checked 2026-10-27 from a cloud machine). Gemini takes a
public YouTube video by its address and Google fetches it itself (ai.google.dev, video understanding: free, at most
8 hours of YouTube video a day on the free tier). So the video's speech is written down by Gemini, in clips of
CLIP_SECONDS, three at a time. The length comes first: the price, the 2-hour cap and the day's total of recordings are a
recording's (plans.recording_cost, quota.reserve_recording). The page reads it from YouTube's own embedded player in the
user's browser (frontend lib/youtubeVideo.ts: a data centre soon gets YouTube's «unusual traffic» page instead of the
watch page) and sends it; without it the watch page is asked once. Every clip has its bounds, so a length said shorter
than the video's only writes down that much of it: the part that was paid for.
"""
from __future__ import annotations

import asyncio
import json
import math
import re
import time
from dataclasses import dataclass
from typing import Callable, Optional
from urllib.parse import parse_qs, urlparse

import httpx
from google.genai import types

import media_parser
from agents.base import AIError
from utils import strip_transcript_times

_VIDEO_ID = re.compile(r"^[0-9A-Za-z_-]{11}$")
WATCH_TIMEOUT_SECONDS = 12.0
# A browser's request: without the consent cookies a European address gets the consent page instead of the video's.
WATCH_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
    ),
    "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
    "Cookie": "CONSENT=YES+cb; SOCS=CAI",
}

# A clip of the video per request: about 15 minutes of speech is 2 000 words, well inside a reply; 39 tokens a second
# go in (32 of sound, a low-resolution frame every 10 s), 35 000 a clip.
CLIP_SECONDS = 15 * 60
# The last clip may be this much longer instead of a clip of its own.
CLIP_SLACK_SECONDS = 3 * 60
CLIPS_AT_ONCE = 3
FRAMES_PER_SECOND = 0.1
CLIP_PROMPT = (
    media_parser.MEDIA_TRANSCRIPTION_PROMPT
    + " Это видео с YouTube: записывай только речь, что видно на экране, не описывай. Если в этом отрезке никто "
    "не говорит, ответь одним словом: (тишина)."
)


@dataclass(frozen=True)
class VideoInfo:
    video_id: str
    seconds: int
    title: str

    @property
    def url(self) -> str:
        return f"https://www.youtube.com/watch?v={self.video_id}"


class VideoUnavailable(Exception):
    """The link names no video, or the video is private, removed, a live stream or its page cannot be read."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def video_id(url: str) -> str:
    """The 11-character id of a YouTube video link (watch?v=, youtu.be/, shorts/, embed/, live/), or ""."""
    text = (url or "").strip()
    if not re.match(r"^[a-z][a-z0-9+.-]*://", text, re.IGNORECASE):
        text = "https://" + text
    try:
        parsed = urlparse(text)
    except ValueError:
        return ""
    host = (parsed.hostname or "").lower()
    parts = [part for part in parsed.path.split("/") if part]
    candidate = ""
    if host == "youtu.be" or host.endswith(".youtu.be"):
        candidate = parts[0] if parts else ""
    elif parts and parts[0] in ("shorts", "embed", "live", "v") and len(parts) > 1:
        candidate = parts[1]
    else:
        candidate = (parse_qs(parsed.query).get("v") or [""])[0]
    return candidate if _VIDEO_ID.match(candidate) else ""


def _player_response(page: str) -> Optional[dict]:
    marker = page.find("ytInitialPlayerResponse")
    while marker >= 0:
        start = page.find("{", marker)
        if start < 0:
            return None
        try:
            value, _ = json.JSONDecoder().raw_decode(page, start)
        except ValueError:
            value = None
        if isinstance(value, dict) and ("videoDetails" in value or "playabilityStatus" in value):
            return value
        marker = page.find("ytInitialPlayerResponse", marker + 1)
    return None


def info_from_page(video: str, page: str) -> VideoInfo:
    """The video's length and title from its watch page; VideoUnavailable when the page has none of a video."""
    player = _player_response(page)
    if not player:
        raise VideoUnavailable("unreadable")
    status = str((player.get("playabilityStatus") or {}).get("status") or "")
    details = player.get("videoDetails") or {}
    if status in ("ERROR", "UNPLAYABLE") or not details:
        raise VideoUnavailable("unavailable")
    if details.get("isLive"):
        raise VideoUnavailable("live")
    if details.get("isPrivate"):
        raise VideoUnavailable("unavailable")
    # Gemini takes only public videos: one open only by its link is refused before anything is charged.
    microformat = (player.get("microformat") or {}).get("playerMicroformatRenderer") or {}
    if microformat.get("isUnlisted"):
        raise VideoUnavailable("unlisted")
    try:
        seconds = int(details.get("lengthSeconds") or 0)
    except (TypeError, ValueError):
        seconds = 0
    if seconds <= 0:
        raise VideoUnavailable("live" if details.get("isLiveContent") else "unreadable")
    title = re.sub(r"\s+", " ", str(details.get("title") or "")).strip()[:200]
    return VideoInfo(video_id=video, seconds=seconds, title=title)


async def video_info(url: str, *, client: Optional[httpx.AsyncClient] = None) -> VideoInfo:
    """Length and title of the YouTube video at ``url`` from its watch page."""
    video = video_id(url)
    if not video:
        raise VideoUnavailable("no_id")
    own = client is None
    http = client or httpx.AsyncClient(timeout=WATCH_TIMEOUT_SECONDS, follow_redirects=True, headers=WATCH_HEADERS)
    try:
        response = await http.get("https://www.youtube.com/watch", params={"v": video, "hl": "ru"})
        page = response.text if response.status_code == 200 else ""
    except httpx.HTTPError as exc:
        print(f"YouTube page: {type(exc).__name__}")
        raise VideoUnavailable("unreadable") from None
    finally:
        if own:
            await http.aclose()
    if not page:
        raise VideoUnavailable("unreadable")
    return info_from_page(video, page)


def clips(seconds: int) -> list[tuple[int, int]]:
    """(start, end) seconds of the requests for a video of ``seconds``: CLIP_SECONDS each, the last one up to
    CLIP_SLACK_SECONDS longer rather than a short clip of its own."""
    count = max(1, math.ceil(max(0, seconds - CLIP_SLACK_SECONDS) / CLIP_SECONDS))
    bounds = [index * CLIP_SECONDS for index in range(count)] + [seconds]
    return [(bounds[index], bounds[index + 1]) for index in range(count)]


def clip_part(info: VideoInfo, start: int, end: int) -> types.Part:
    """The video between ``start`` and ``end`` as a part of a Gemini request: its YouTube address, Google fetches it."""
    metadata = types.VideoMetadata(fps=FRAMES_PER_SECOND, start_offset=f"{start}s", end_offset=f"{end}s")
    return types.Part(file_data=types.FileData(file_uri=info.url), video_metadata=metadata)


def info_from_length(url: str, seconds: object) -> Optional[VideoInfo]:
    """The video of ``url`` with the length the page read from YouTube's player (seconds, rounded up), or None when
    the link names no video or the length is not a positive number."""
    video = video_id(url)
    try:
        value = float(seconds)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    if not video or not math.isfinite(value) or value <= 0:
        return None
    return VideoInfo(video_id=video, seconds=math.ceil(value), title="")


def clean_transcript(text: str) -> str:
    """A clip's text without times the model put in anyway and without «[музыка]»-like marks."""
    text = re.sub(r"\[[^\]\n]{1,40}\]|\(тишина\)\.?", " ", text or "", flags=re.IGNORECASE)
    text = strip_transcript_times(text)
    return re.sub(r"[ \t]+", " ", text).strip()


async def transcribe(
    info: VideoInfo,
    *,
    progress: Optional[Callable[[float, float], None]] = None,
    deadline: Optional[float] = None,
) -> str:
    """The speech of the video, written down by Gemini clip by clip (CLIPS_AT_ONCE at a time, in order joined).
    ``progress(seconds done, seconds in all)`` after each clip. AIError.busy() when Gemini was rate limited,
    media_parser.MediaProcessingTimeout when ``deadline`` (time.monotonic()) comes first, ValueError otherwise."""
    spans = clips(info.seconds)
    texts: list[str] = [""] * len(spans)
    gate = asyncio.Semaphore(CLIPS_AT_ONCE)
    done = 0.0

    async def one(index: int, start: int, end: int) -> None:
        nonlocal done
        async with gate:
            if deadline is not None and time.monotonic() >= deadline:
                raise media_parser.MediaProcessingTimeout()
            text = await media_parser._transcribe_with_gemini(
                None, None, inline=clip_part(info, start, end), prompt=CLIP_PROMPT, low_media=True
            )
        texts[index] = clean_transcript(text)
        done += end - start
        if progress is not None:
            progress(done, float(info.seconds))

    started = time.monotonic()
    try:
        async with asyncio.TaskGroup() as group:
            for index, (start, end) in enumerate(spans):
                group.create_task(one(index, start, end))
    except BaseExceptionGroup as failed:
        busy = next((exc for exc in failed.exceptions if isinstance(exc, AIError)), None)
        raise busy or failed.exceptions[0] from None
    print(f"YouTube video: {len(spans)} clips of {info.seconds} s written down in {time.monotonic() - started:.1f} s")
    return "\n\n".join(text for text in texts if text)
