"""A long lecture recording cut at its pauses into pieces of at most 30 s, which Whisper reads whole.

Whisper skips passages of a long recording and none of a piece that fits one 30 s window (the live measurements
are at the top of media_parser.py). ffmpeg finds the pauses (silencedetect), plan_pieces chooses the cuts, and one
more ffmpeg run writes the pieces as mono 16 kHz WAV (16-bit PCM), the audio Whisper works with: about 960 KB for
30 s, far below Groq's 25 MB and Gemini's 20 MB inline. ffmpeg is the static build that comes with the
imageio-ffmpeg package. Nothing here talks to a provider, and no file name or ffmpeg log is printed: the log names
the file and may carry its tags.
"""
from __future__ import annotations

import asyncio
import contextlib
import functools
import os
import re
import shutil
from typing import NamedTuple

# A piece of at most 30 s is one Whisper window: no passage of it is skipped.
TARGET_SECONDS = 30.0
# A recording this long or shorter is not cut: it goes as it is, one request as before.
WHOLE_MAX_SECONDS = 32.0
# The last piece may run this much longer than the others rather than end in a sliver of a few seconds.
LAST_PIECE_STRETCH = 1.15
# The pieces of one recording: 120 take six minutes to start at Groq's 20 requests a minute (media_parser.py),
# within the eight minutes the analysis gives a transcription (main.py). A longer recording gets longer pieces
# instead: on average a cut lands at three quarters of the window, and a piece grows to 90 s at most.
MAX_PIECES_DEFAULT = 120
CUT_AVERAGE_SHARE = 0.75
MAX_TARGET_SECONDS = 90.0

# A pause is a quarter of a second or more below -35 dB. A room whose noise never falls that low gives fewer pauses
# than one per 45 s of audio; then the threshold follows the recording itself: its mean volume less 6 dB, within
# -60…-20 dB.
SILENCE_DB = -35.0
SILENCE_SECONDS = 0.25
SECONDS_PER_PAUSE = 45.0
RELATIVE_SILENCE_DB = 6.0
RELATIVE_SILENCE_LIMITS_DB = (-60.0, -20.0)

_WAV = ("-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le")
# The segment muxer cuts at the first packet at or after a planned time: up to 31 ms later in the tests' MP3, 19 ms
# in an AAC m4a, 8 ms in the 19:25 one (2026-10-12). Farther off than this, the pieces are cut one at a time.
BOUNDARY_TOLERANCE_SECONDS = 0.15
# ffmpeg decoded the tests' 95 s MP3 in under 0.15 s (about 900 times real time); a run still going after two
# minutes is stuck, and the whole file goes instead.
FFMPEG_TIMEOUT_SECONDS = 120.0


class FfmpegError(Exception):
    """ffmpeg is missing, cannot read the recording or could not cut it. The message is a short reason without the
    file's name: media_parser.py logs it and sends the whole file, as before."""


class Piece(NamedTuple):
    start: float
    end: float
    pause: float  # the length of the pause the piece was cut at: 0 for a hard cut and for the last piece


@functools.cache
def ffmpeg_exe() -> str | None:
    """FFMPEG_BINARY, else the ffmpeg that comes with imageio-ffmpeg, else ffmpeg on PATH; None without any."""
    configured = os.getenv("FFMPEG_BINARY", "").strip()
    if configured:
        return configured
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:  # not installed, or no binary for this platform
        return shutil.which("ffmpeg")


def max_pieces() -> int:
    try:
        value = int(os.getenv("AUDIO_MAX_PIECES", "") or MAX_PIECES_DEFAULT)
    except ValueError:
        return MAX_PIECES_DEFAULT
    return value if value > 0 else MAX_PIECES_DEFAULT


async def _ffmpeg(exe: str, *args: str) -> str:
    """ffmpeg's log (stderr) of one run. FfmpegError when it cannot start, fails or runs longer than
    FFMPEG_TIMEOUT_SECONDS; a run that is cancelled or too slow is killed."""
    try:
        process = await asyncio.create_subprocess_exec(
            exe, "-nostdin", "-y", "-hide_banner", "-nostats", *args,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
    except OSError as exc:
        raise FfmpegError(f"could not start ({type(exc).__name__})") from None
    try:
        _, log = await asyncio.wait_for(process.communicate(), FFMPEG_TIMEOUT_SECONDS)
    except BaseException as exc:
        if process.returncode is None:
            with contextlib.suppress(ProcessLookupError):
                process.kill()
            await process.wait()
        if isinstance(exc, TimeoutError):
            raise FfmpegError("took too long") from None
        raise
    if process.returncode != 0:
        raise FfmpegError(f"exited with {process.returncode}")
    return log.decode("utf-8", "replace")


_NUMBER = r"(-?\d+(?:\.\d+)?(?:e[-+]?\d+)?)"
_SILENCE_RE = re.compile(r"silence_(start|end): " + _NUMBER)
# The decoded length (the last report's time=), else the container's Duration, an estimate for some MP3s.
_TIME_RE = re.compile(r"\btime=(\d+):(\d\d):(\d\d(?:\.\d+)?)")
_DURATION_RE = re.compile(r"Duration: (\d+):(\d\d):(\d\d(?:\.\d+)?)")
_MEAN_VOLUME_RE = re.compile(r"mean_volume: (-?(?:inf|\d+(?:\.\d+)?)) dB")


def _length(log: str) -> float:
    found = _TIME_RE.findall(log) or _DURATION_RE.findall(log)
    if not found:
        raise FfmpegError("found no length")
    hours, minutes, seconds = found[-1]
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


def _pauses(log: str, duration: float) -> list[tuple[float, float]]:
    """(start, end) of each silence in the log; a silence still open at the end of the file ends at ``duration``."""
    pauses: list[tuple[float, float]] = []
    start = None
    for kind, value in _SILENCE_RE.findall(log):
        if kind == "start":
            start = max(0.0, float(value))
        elif start is not None:
            if float(value) > start:
                pauses.append((start, float(value)))
            start = None
    if start is not None and duration > start:
        pauses.append((start, duration))
    return pauses


async def _silences(exe: str, path: str, threshold_db: float) -> str:
    return await _ffmpeg(
        exe, "-vn", "-i", path, "-af", f"silencedetect=noise={threshold_db:g}dB:d={SILENCE_SECONDS:g}", "-f", "null", "-"
    )


async def find_pauses(exe: str, path: str) -> tuple[float, list[tuple[float, float]]]:
    """The recording's length in seconds and its pauses, (start, end) in order. Below -35 dB first; with fewer than
    one pause per 45 s of audio (a noisy room) once more below the recording's mean volume less 6 dB, and the run
    with more pauses counts."""
    log = await _silences(exe, path, SILENCE_DB)
    duration = _length(log)
    pauses = _pauses(log, duration)
    if len(pauses) < duration / SECONDS_PER_PAUSE:
        mean = _MEAN_VOLUME_RE.search(await _ffmpeg(exe, "-vn", "-i", path, "-af", "volumedetect", "-f", "null", "-"))
        if mean:
            low, high = RELATIVE_SILENCE_LIMITS_DB
            threshold = min(high, max(low, float(mean.group(1)) - RELATIVE_SILENCE_DB))
            relative = _pauses(await _silences(exe, path, threshold), duration)
            if len(relative) > len(pauses):
                pauses = relative
    return duration, pauses


def _plan(duration: float, pauses: list[tuple[float, float]], target: float) -> list[Piece]:
    pieces: list[Piece] = []
    position = 0.0
    while duration - position > LAST_PIECE_STRETCH * target:
        cut, pause = position + target, 0.0
        for start, end in pauses:
            middle = (start + end) / 2
            # The longest pause whose middle lies in the second half of the window; of equal ones the later.
            if position + target / 2 <= middle <= position + target and end - start >= pause:
                cut, pause = middle, end - start
        pieces.append(Piece(position, cut, pause))
        position = cut
    pieces.append(Piece(position, duration, 0.0))
    return pieces


def plan_pieces(duration: float, pauses: list[tuple[float, float]], limit: int | None = None) -> list[Piece]:
    """Where to cut a recording of ``duration`` seconds with these pauses. From each cut, the next one is the middle
    of the longest pause whose middle lies 15 to 30 s further (of equal ones the later; the last pause before the
    30 s mark sometimes fell inside a sentence, live 2026-10-12), or a hard cut at 30 s when there is none; the last
    piece may run to 34.5 s. When that makes more than ``limit`` pieces (AUDIO_MAX_PIECES, 120), the window grows
    to fit, up to 90 s."""
    limit = max_pieces() if limit is None else limit
    ordered = sorted((start, end) for start, end in pauses if end > start)
    pieces = _plan(duration, ordered, TARGET_SECONDS)
    if len(pieces) > limit:
        target = min(MAX_TARGET_SECONDS, max(TARGET_SECONDS, duration / limit / CUT_AVERAGE_SHARE))
        pieces = _plan(duration, ordered, target)
    return pieces


def _segments_match(listing: str, pieces: list[Piece]) -> bool:
    """Whether the segment muxer's list of what it wrote has the planned pieces, each starting within
    BOUNDARY_TOLERANCE_SECONDS of the plan."""
    try:
        with open(listing, encoding="utf-8") as handle:
            rows = [line.rsplit(",", 2) for line in handle.read().splitlines() if line.strip()]
        starts = [float(start) for _, start, _ in rows]
    except (OSError, ValueError):
        return False
    return len(starts) == len(pieces) and all(
        abs(start - piece.start) <= BOUNDARY_TOLERANCE_SECONDS for start, piece in zip(starts, pieces)
    )


async def cut_pieces(exe: str, path: str, pieces: list[Piece], directory: str) -> list[str]:
    """The pieces as mono 16 kHz WAV files in ``directory``, in order: one decode with the segment muxer, or one run
    per piece when its boundaries come out more than BOUNDARY_TOLERANCE_SECONDS off the plan. Every WAV piece gets
    its own header with its own length: PCM has nothing to fix afterwards."""
    files = [os.path.join(directory, f"piece{index:04d}.wav") for index in range(len(pieces))]
    listing = os.path.join(directory, "pieces.csv")
    await _ffmpeg(
        exe, "-vn", "-i", path, *_WAV,
        "-f", "segment", "-segment_times", ",".join(f"{piece.end:.3f}" for piece in pieces[:-1]),
        "-segment_list", listing, "-segment_list_type", "csv", "-reset_timestamps", "1",
        os.path.join(directory, "piece%04d.wav"),
    )
    if _segments_match(listing, pieces):
        return files
    print("Lecture pieces: the segment boundaries are off the plan; cutting one piece at a time")
    for index, piece in enumerate(pieces):
        # Input seeking is exact for audio; the last piece runs to the end of the recording.
        span = ("-ss", f"{piece.start:.3f}") + (("-to", f"{piece.end:.3f}") if index + 1 < len(pieces) else ())
        await _ffmpeg(exe, *span, "-vn", "-i", path, *_WAV, files[index])
    return files
