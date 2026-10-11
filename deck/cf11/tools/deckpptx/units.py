"""Geometry and type units.

A slide is 1920 x 1080 CSS px = 13.333 x 7.5 in = 12192000 x 6858000 EMU, so 1 px = 6350 EMU and 2 px = 1 pt.
"""
SLIDE_W_PX, SLIDE_H_PX = 1920, 1080
EMU_PER_PX = 6350
SLIDE_W_EMU, SLIDE_H_EMU = SLIDE_W_PX * EMU_PER_PX, SLIDE_H_PX * EMU_PER_PX   # 12192000 x 6858000


def emu(px: float) -> int:
    """CSS px -> EMU (integer, as OOXML coordinates must be)."""
    return int(round(px * EMU_PER_PX))


def pt(px: float) -> float:
    """CSS px -> points (1 pt = 2 px on this slide)."""
    return px / 2.0


def pt100(px: float) -> int:
    """CSS px -> hundredths of a point (font size `sz`, letter spacing `spc`, line spacing `spcPts`)."""
    return int(round(px * 50))


def angle(deg: float) -> int:
    """Degrees -> DrawingML angle units (60000ths of a degree), normalised to [0, 360)."""
    return int(round((deg % 360.0) * 60000)) % 21600000


def pct100k(v: float) -> int:
    """0..1 fraction -> DrawingML percentage (100000 = 100 %)."""
    return int(round(max(0.0, min(1.0, v)) * 100000))
