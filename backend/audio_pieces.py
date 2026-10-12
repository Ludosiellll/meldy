"""A long lecture recording cut at its pauses into pieces of at most 30 s, which Whisper reads whole.

Whisper skips passages of a long recording and none of a piece that fits one 30 s window (the live measurements
are at the top of media_parser.py). ffmpeg finds the pauses (silencedetect), plan_pieces chooses the cuts, and one
more ffmpeg run writes the pieces as mono 16 kHz FLAC, the audio Whisper works with. ffmpeg is the static build
that comes with the imageio-ffmpeg package. Nothing here talks to a provider, and no file name or ffmpeg log is
printed: the log names the file and may carry its tags.
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

SAMPLE_RATE = 16000
_FLAC = ("-ac", "1", "-ar", str(SAMPLE_RATE), "-c:a", "flac")
# The segment muxer cuts at the first FLAC frame (1152 samples, 72 ms at 16 kHz) after a planned time; farther
# off than this, the pieces are cut one at a time instead.
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


# STREAMINFO, the first metadata block of a FLAC file, starts at byte 8 (after «fLaC» and the block's header); the
# number of samples is its 36 bits from byte 13 (the low half of 13, then 14-17), the MD5 of the audio bytes 18-33.
_STREAMINFO = 8
_SAMPLES_MASK = (1 << 36) - 1


def _streaminfo(path: str) -> bytearray:
    with open(path, "rb") as handle:
        head = bytearray(handle.read(_STREAMINFO + 34))
    if len(head) < _STREAMINFO + 34 or head[:4] != b"fLaC" or head[4] & 0x7F != 0:
        raise FfmpegError("wrote a piece that is not FLAC")
    return head


def flac_samples(path: str) -> int:
    """The number of samples a FLAC file says it holds (0: not said)."""
    return int.from_bytes(_streaminfo(path)[_STREAMINFO + 13:_STREAMINFO + 18], "big") & _SAMPLES_MASK


def _set_flac_samples(path: str, samples: int) -> None:
    head = _streaminfo(path)
    field = (int.from_bytes(head[_STREAMINFO + 13:_STREAMINFO + 18], "big") & ~_SAMPLES_MASK) | samples
    head[_STREAMINFO + 13:_STREAMINFO + 18] = field.to_bytes(5, "big")
    head[_STREAMINFO + 18:_STREAMINFO + 34] = bytes(16)  # no MD5: FLAC's «not computed»
    with open(path, "r+b") as handle:
        handle.write(head)


def _segment_samples(listing: str, pieces: list[Piece], last_file: str) -> list[int] | None:
    """The samples of each piece the segment muxer wrote, by its list of pieces, or None when a boundary is more than
    BOUNDARY_TOLERANCE_SECONDS off the plan or the pieces do not add up to the recording the encoder counted."""
    try:
        with open(listing, encoding="utf-8") as handle:
            rows = [line.rsplit(",", 2) for line in handle.read().splitlines() if line.strip()]
        bounds = [(float(start), float(end)) for _, start, end in rows]
    except (OSError, ValueError):
        return None
    if len(bounds) != len(pieces):
        return None
    if any(abs(start - piece.start) > BOUNDARY_TOLERANCE_SECONDS for (start, _), piece in zip(bounds, pieces)):
        return None
    samples = [round(end * SAMPLE_RATE) - round(start * SAMPLE_RATE) for start, end in bounds]
    return samples if sum(samples) == flac_samples(last_file) else None


async def cut_pieces(exe: str, path: str, pieces: list[Piece], directory: str) -> list[str]:
    """The pieces as mono 16 kHz FLAC files in ``directory``, in order: one decode with the segment muxer, or one run
    per piece when its boundaries come out more than BOUNDARY_TOLERANCE_SECONDS off the plan.

    The segment muxer leaves each piece the FLAC header the encoder began with («length unknown»), and the last one
    the length and MD5 of the whole recording, which the encoder writes at its end: each piece gets its own length
    from the muxer's list (measured 2026-10-12 on ffmpeg 7.0.2)."""
    files = [os.path.join(directory, f"piece{index:04d}.flac") for index in range(len(pieces))]
    listing = os.path.join(directory, "pieces.csv")
    await _ffmpeg(
        exe, "-vn", "-i", path, *_FLAC,
        "-f", "segment", "-segment_times", ",".join(f"{piece.end:.3f}" for piece in pieces[:-1]),
        "-segment_list", listing, "-segment_list_type", "csv", "-reset_timestamps", "1",
        os.path.join(directory, "piece%04d.flac"),
    )
    samples = _segment_samples(listing, pieces, files[-1])
    if samples is not None:
        for file, count in zip(files, samples):
            _set_flac_samples(file, count)
        return files
    print("Lecture pieces: the segment boundaries are off the plan; cutting one piece at a time")
    for index, piece in enumerate(pieces):
        # Input seeking is exact for audio; the last piece runs to the end of the recording.
        span = ("-ss", f"{piece.start:.3f}") + (("-to", f"{piece.end:.3f}") if index + 1 < len(pieces) else ())
        await _ffmpeg(exe, *span, "-vn", "-i", path, *_FLAC, files[index])
    return files
