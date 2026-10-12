"""audio_pieces.py: where a long recording is cut (plan_pieces), and the pauses and pieces ffmpeg finds and writes.

The live measurements behind the 30 s pieces cut at the longest pause are at the top of media_parser.py. The
recordings here are synthetic: sine tones for speech, digital silence for pauses, white noise over all of it for a
noisy room, made with the ffmpeg that comes with imageio-ffmpeg and kept in pytest's tmp_path.
"""
import asyncio
import os
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import audio_pieces  # noqa: E402
from audio_pieces import FfmpegError, Piece, plan_pieces  # noqa: E402

needs_ffmpeg = pytest.mark.skipif(audio_pieces.ffmpeg_exe() is None, reason="no ffmpeg (imageio-ffmpeg not installed)")

# A 95 s lecture: in the first window the longest pause (16-18 s) comes before a later, shorter one (27-27.5 s);
# 40.4 s is the only pause middle in the second window; the third has none (a hard cut at 70.4 s); the rest is the
# last piece.
LECTURE = [
    ("tone", 16.0), ("pause", 2.0), ("tone", 9.0), ("pause", 0.5), ("tone", 12.5), ("pause", 0.8),
    ("tone", 7.2), ("pause", 1.2), ("tone", 30.8), ("pause", 1.0), ("tone", 14.0),
]
LECTURE_PAUSES = [(16.0, 18.0), (27.0, 27.5), (40.0, 40.8), (48.0, 49.2), (80.0, 81.0)]
LECTURE_PLAN = [Piece(0.0, 17.0, 2.0), Piece(17.0, 40.4, 0.8), Piece(40.4, 70.4, 0.0), Piece(70.4, 95.0, 0.0)]


def make_recording(path: Path, layout, noise: float = 0.0) -> Path:
    """An MP3 (16 kHz mono, 24 kbps) of ``layout``: ("tone", seconds) at half of full scale, ("pause", seconds) of
    digital silence; ``noise``: the amplitude of white noise over the whole recording."""
    parts, labels = [], []
    for index, (kind, seconds) in enumerate(layout):
        level = f"0.5*sin({300 + 37 * index}*2*PI*t)" if kind == "tone" else "0"
        parts.append(f"aevalsrc={level}:s=16000:d={seconds}[p{index}]")
        labels.append(f"[p{index}]")
    graph = ";".join(parts) + ";" + "".join(labels) + f"concat=n={len(layout)}:v=0:a=1"
    if noise:
        total = sum(seconds for _, seconds in layout)
        graph += (
            f"[speech];anoisesrc=r=16000:a={noise}:c=white:seed=7:d={total}[noise];"
            "[speech][noise]amix=inputs=2:duration=first:normalize=0"
        )
    subprocess.run(
        [audio_pieces.ffmpeg_exe(), "-nostdin", "-y", "-hide_banner", "-v", "error", "-f", "lavfi", "-i", graph,
         "-c:a", "libmp3lame", "-b:a", "24k", str(path)],
        check=True,
    )
    return path


@pytest.fixture(scope="module")
def recordings(tmp_path_factory):
    folder = tmp_path_factory.mktemp("recordings")
    return {
        "lecture": make_recording(folder / "lecture.mp3", LECTURE),
        "noisy": make_recording(folder / "noisy.mp3", LECTURE, noise=0.03),
    }


def run(coroutine):
    return asyncio.run(coroutine)


def flac_seconds(path) -> float:
    """The length a FLAC piece says it has (its STREAMINFO), read here without the module's helpers."""
    with open(path, "rb") as handle:
        head = handle.read(42)
    assert head[:4] == b"fLaC"
    info = head[8:42]
    rate = (info[10] << 12) | (info[11] << 4) | (info[12] >> 4)
    samples = int.from_bytes(info[13:18], "big") & ((1 << 36) - 1)
    assert rate == 16000 and samples > 0
    return samples / rate


def assert_pieces(actual, expected, tolerance=0.05):
    assert len(actual) == len(expected), actual
    for got, want in zip(actual, expected):
        assert got == pytest.approx(want, abs=tolerance), (actual, expected)


# ── where to cut ───────────────────────────────────────────────────────────────────


def test_without_pauses_the_cuts_are_hard_every_30_seconds_and_the_last_piece_may_run_to_34_5():
    assert plan_pieces(100.0, []) == [Piece(0.0, 30.0, 0.0), Piece(30.0, 60.0, 0.0), Piece(60.0, 90.0, 0.0), Piece(90.0, 100.0, 0.0)]
    # 34 s after the last cut: one last piece rather than 30 s and a 4 s sliver.
    assert plan_pieces(94.0, []) == [Piece(0.0, 30.0, 0.0), Piece(30.0, 60.0, 0.0), Piece(60.0, 94.0, 0.0)]
    assert plan_pieces(34.5, []) == [Piece(0.0, 34.5, 0.0)]


def test_the_cut_is_the_middle_of_the_longest_pause_in_the_second_half_of_the_window():
    # Window [15, 30]: the 2 s pause wins over the later 0.5 s one; a pause before 15 s does not count.
    pauses = [(9.0, 13.0), (16.0, 18.0), (27.0, 27.5)]
    assert plan_pieces(60.0, pauses)[0] == Piece(0.0, 17.0, 2.0)
    # Of two equal pauses, the later one.
    assert plan_pieces(60.0, [(19.0, 20.0), (25.0, 26.0)])[0] == Piece(0.0, 25.5, 1.0)
    # The pauses may come in any order.
    assert plan_pieces(60.0, [(27.0, 27.5), (16.0, 18.0)])[0] == Piece(0.0, 17.0, 2.0)
    # The window is counted from the last cut, and the middle may sit on its edges.
    assert plan_pieces(79.0, [(14.0, 16.0), (44.5, 45.5)]) == [
        Piece(0.0, 15.0, 2.0), Piece(15.0, 45.0, 1.0), Piece(45.0, 79.0, 0.0),
    ]
    # 35 s after the last cut is more than 34.5: one more hard cut.
    assert plan_pieces(80.0, [(14.0, 16.0), (44.5, 45.5)])[2:] == [Piece(45.0, 75.0, 0.0), Piece(75.0, 80.0, 0.0)]


def test_each_cut_keeps_the_length_of_its_pause():
    pieces = plan_pieces(95.0, LECTURE_PAUSES)
    assert_pieces(pieces, LECTURE_PLAN, tolerance=1e-9)
    assert [piece.pause for piece in pieces] == pytest.approx([2.0, 0.8, 0.0, 0.0])
    assert all(left.end == right.start for left, right in zip(pieces, pieces[1:]))


def test_too_many_pieces_make_the_window_grow_up_to_90_seconds(monkeypatch):
    # An hour without pauses: 120 pieces of 30 s fit the default limit.
    hour = plan_pieces(3600.0, [])
    assert len(hour) == 120 and all(piece.end - piece.start == 30.0 for piece in hour)
    # A limit of 100: the window grows to 3600 / 100 / 0.75 = 48 s.
    monkeypatch.setenv("AUDIO_MAX_PIECES", "100")
    grown = plan_pieces(3600.0, [])
    assert len(grown) <= 100 and grown[0] == Piece(0.0, 48.0, 0.0) and grown[-1].end == 3600.0
    # The window would need 120 s: it stops at 90.
    capped = plan_pieces(3600.0, [], limit=40)
    assert len(capped) == 40 and {piece.end - piece.start for piece in capped} == {90.0}
    # A pause still decides the cut in a grown window.
    assert plan_pieces(3600.0, [(70.0, 72.0)], limit=40)[0] == Piece(0.0, 71.0, 2.0)
    monkeypatch.setenv("AUDIO_MAX_PIECES", "nonsense")
    assert audio_pieces.max_pieces() == 120


# ── ffmpeg ─────────────────────────────────────────────────────────────────────────


@pytest.fixture
def fresh_ffmpeg_lookup():
    audio_pieces.ffmpeg_exe.cache_clear()
    yield
    audio_pieces.ffmpeg_exe.cache_clear()


def test_ffmpeg_comes_from_the_env_then_imageio_ffmpeg_then_the_path(monkeypatch, fresh_ffmpeg_lookup):
    import shutil
    import types

    monkeypatch.setenv("FFMPEG_BINARY", "/opt/ffmpeg/bin/ffmpeg")
    assert audio_pieces.ffmpeg_exe() == "/opt/ffmpeg/bin/ffmpeg"
    audio_pieces.ffmpeg_exe.cache_clear()
    monkeypatch.delenv("FFMPEG_BINARY")

    def no_binary():
        raise RuntimeError("No ffmpeg exe could be found.")

    monkeypatch.setitem(sys.modules, "imageio_ffmpeg", types.SimpleNamespace(get_ffmpeg_exe=no_binary))
    monkeypatch.setattr(shutil, "which", lambda name: "/usr/bin/ffmpeg" if name == "ffmpeg" else None)
    assert audio_pieces.ffmpeg_exe() == "/usr/bin/ffmpeg"
    audio_pieces.ffmpeg_exe.cache_clear()
    monkeypatch.setattr(shutil, "which", lambda name: None)
    assert audio_pieces.ffmpeg_exe() is None
    # The answer is kept: the binary is looked for once per process.
    monkeypatch.setattr(shutil, "which", lambda name: "/usr/bin/ffmpeg")
    assert audio_pieces.ffmpeg_exe() is None


@needs_ffmpeg
def test_pauses_and_length_of_a_recording(recordings):
    duration, pauses = run(audio_pieces.find_pauses(audio_pieces.ffmpeg_exe(), str(recordings["lecture"])))
    assert duration == pytest.approx(95.0, abs=0.05)
    assert_pieces(pauses, LECTURE_PAUSES)
    assert_pieces(plan_pieces(duration, pauses), LECTURE_PLAN)


@needs_ffmpeg
def test_a_noisy_room_gets_a_threshold_from_the_recording_itself(recordings, monkeypatch):
    exe = audio_pieces.ffmpeg_exe()
    filters = []
    ffmpeg = audio_pieces._ffmpeg

    async def recording_filters(exe, *args):
        filters.append(args[args.index("-af") + 1])
        return await ffmpeg(exe, *args)

    monkeypatch.setattr(audio_pieces, "_ffmpeg", recording_filters)
    # The noise never falls below -35 dB: no pause there.
    log = run(audio_pieces._silences(exe, str(recordings["noisy"]), -35.0))
    assert audio_pieces._pauses(log, 95.0) == []
    filters.clear()
    duration, pauses = run(audio_pieces.find_pauses(exe, str(recordings["noisy"])))
    # Mean volume about -10 dB, less 6 dB: -16 dB, held at the -20 dB end of the range.
    assert filters == ["silencedetect=noise=-35dB:d=0.25", "volumedetect", "silencedetect=noise=-20dB:d=0.25"]
    assert duration == pytest.approx(95.0, abs=0.05)
    assert_pieces(pauses, LECTURE_PAUSES)
    # A clean recording is read once.
    filters.clear()
    run(audio_pieces.find_pauses(exe, str(recordings["lecture"])))
    assert filters == ["silencedetect=noise=-35dB:d=0.25"]


def test_silences_are_read_from_the_log_and_one_open_at_the_end_ends_with_the_recording():
    log = (
        "  Duration: 00:02:50.04, start: 0.025057, bitrate: 128 kb/s\n"
        "[silencedetect @ 0x1] silence_start: -0.0213\n"
        "[silencedetect @ 0x1] silence_end: 0.5 | silence_duration: 0.52\n"
        "[silencedetect @ 0x1] silence_start: 12\n"
        "[silencedetect @ 0x1] silence_end: 13.25 | silence_duration: 1.25\n"
        "[silencedetect @ 0x1] silence_start: 168.5\n"
        "size=N/A time=00:02:50.00 bitrate=N/A speed= 900x\n"
    )
    duration = audio_pieces._length(log)
    assert duration == 170.0  # the decoded length, not the container's estimate
    assert audio_pieces._pauses(log, duration) == [(0.0, 0.5), (12.0, 13.25), (168.5, 170.0)]
    assert audio_pieces._length("  Duration: 00:20:00.50, start: 0.000000\n") == 1200.5
    with pytest.raises(FfmpegError):
        audio_pieces._length("Duration: N/A, bitrate: N/A\n")


@needs_ffmpeg
def test_a_file_ffmpeg_cannot_read_is_an_ffmpeg_error_without_its_name(tmp_path):
    path = tmp_path / "upload-of-a-student.mp3"
    path.write_bytes(b"ID3 audio")
    with pytest.raises(FfmpegError) as info:
        run(audio_pieces.find_pauses(audio_pieces.ffmpeg_exe(), str(path)))
    assert "upload-of-a-student" not in str(info.value) and str(tmp_path) not in str(info.value)
    with pytest.raises(FfmpegError):
        run(audio_pieces.find_pauses(str(tmp_path / "no-such-ffmpeg"), str(path)))


@needs_ffmpeg
def test_a_run_that_takes_too_long_is_stopped(recordings, monkeypatch):
    monkeypatch.setattr(audio_pieces, "FFMPEG_TIMEOUT_SECONDS", 0.001)
    with pytest.raises(FfmpegError) as info:
        run(audio_pieces.find_pauses(audio_pieces.ffmpeg_exe(), str(recordings["lecture"])))
    assert str(info.value) == "took too long"


# ── the pieces ─────────────────────────────────────────────────────────────────────


@needs_ffmpeg
def test_one_decode_cuts_the_pieces_where_the_plan_says(recordings, tmp_path):
    exe = audio_pieces.ffmpeg_exe()
    duration, pauses = run(audio_pieces.find_pauses(exe, str(recordings["lecture"])))
    plan = plan_pieces(duration, pauses)
    files = run(audio_pieces.cut_pieces(exe, str(recordings["lecture"]), plan, str(tmp_path)))
    assert [os.path.basename(file) for file in files] == ["piece0000.flac", "piece0001.flac", "piece0002.flac", "piece0003.flac"]

    # The segment muxer's own list: each boundary within one FLAC frame (72 ms) after the planned cut.
    rows = [line.rsplit(",", 2) for line in (tmp_path / "pieces.csv").read_text().splitlines()]
    starts = [float(start) for _, start, _ in rows]
    assert all(0 <= start - piece.start <= audio_pieces.BOUNDARY_TOLERANCE_SECONDS for start, piece in zip(starts, plan))

    # Each piece says its own length (the muxer left «unknown» in all but the last, which had the whole recording's)...
    lengths = [flac_seconds(file) for file in files]
    assert_pieces(lengths, [piece.end - piece.start for piece in plan], tolerance=audio_pieces.BOUNDARY_TOLERANCE_SECONDS)
    assert sum(lengths) == pytest.approx(duration, abs=0.01)
    # ...and holds that much audio (ffmpeg reports the decoded length to 10 ms).
    for file, length in zip(files, lengths):
        decoded, _ = run(audio_pieces.find_pauses(exe, file))
        assert decoded == pytest.approx(length, abs=0.011)

    # The first cut is in the middle of the 2 s pause: the first piece ends with about 1 s of it, the second starts so.
    _, first = run(audio_pieces.find_pauses(exe, files[0]))
    _, second = run(audio_pieces.find_pauses(exe, files[1]))
    assert first[-1][1] == pytest.approx(lengths[0], abs=0.01) and first[-1][1] - first[-1][0] == pytest.approx(1.0, abs=0.1)
    assert second[0][0] == 0.0 and second[0][1] == pytest.approx(1.0, abs=0.1)


@needs_ffmpeg
def test_pieces_are_cut_one_at_a_time_when_the_segments_are_off_the_plan(recordings, tmp_path, monkeypatch, capsys):
    exe = audio_pieces.ffmpeg_exe()
    monkeypatch.setattr(audio_pieces, "BOUNDARY_TOLERANCE_SECONDS", -1.0)  # no segment boundary is good enough
    files = run(audio_pieces.cut_pieces(exe, str(recordings["lecture"]), LECTURE_PLAN, str(tmp_path)))
    assert "cutting one piece at a time" in capsys.readouterr().out
    lengths = [flac_seconds(file) for file in files]
    assert_pieces(lengths, [piece.end - piece.start for piece in LECTURE_PLAN], tolerance=0.01)
    decoded, _ = run(audio_pieces.find_pauses(exe, files[-1]))
    assert decoded == pytest.approx(lengths[-1], abs=0.011)


@needs_ffmpeg
def test_a_cut_ffmpeg_cannot_make_is_an_ffmpeg_error(tmp_path):
    with pytest.raises(FfmpegError):
        run(audio_pieces.cut_pieces(audio_pieces.ffmpeg_exe(), str(tmp_path / "gone.mp3"), LECTURE_PLAN, str(tmp_path)))
