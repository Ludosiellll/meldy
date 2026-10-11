"""Fit a frame sequence into a slide's window: scale, round the corners onto the window's colour, make it loop.

    python3 -I loopmask.py <in_dir> <out_dir> <width> <height> [--radius 24] [--bg #ffffff] [--xfade 15] [--start K]

Reads in_dir/f0000.png… (any size, cropped to the target aspect from the centre), writes out_dir/f0000.png…
at width × height. Corners outside a rounded rectangle of `radius` are painted `bg`, so the video sits on a
white window (PowerPoint has no transparent video). With --xfade K the first K frames fade from the tail of
the sequence into its head, so the last frame runs into the first without a seam; the output is K frames
shorter than the input. --start K rotates the looping output so it begins on (output) frame K: a clip whose screen
rides into its slide under Morph shows its poster during the transition and plays from frame 0 when the slide lands,
so a loop that begins on its poster's moment does not jump. The same tool fits the recordings of the live site
(tools/record/fit.py).
"""
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw


def arg(name, default):
    if f'--{name}' in sys.argv:
        return sys.argv[sys.argv.index(f'--{name}') + 1]
    return default


def rounded_mask(w, h, r, scale=4):
    big = Image.new('L', (w * scale, h * scale), 0)
    ImageDraw.Draw(big).rounded_rectangle((0, 0, w * scale - 1, h * scale - 1), radius=r * scale, fill=255)
    return big.resize((w, h), Image.LANCZOS)


def fit(im, w, h):
    sw, sh = im.size
    target = w / h
    if sw / sh > target:  # too wide: crop the sides
        nw = round(sh * target)
        im = im.crop(((sw - nw) // 2, 0, (sw - nw) // 2 + nw, sh))
    elif sw / sh < target:  # too tall: crop top and bottom
        nh = round(sw / target)
        im = im.crop((0, (sh - nh) // 2, sw, (sh - nh) // 2 + nh))
    return im.resize((w, h), Image.LANCZOS)


def main():
    src, dst, w, h = Path(sys.argv[1]), Path(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
    radius = int(arg('radius', 24))
    bg = arg('bg', '#ffffff')
    k = int(arg('xfade', 0))
    start = int(arg('start', 0))
    frames = sorted(src.glob('f*.png'))
    if not frames:
        sys.exit(f'no frames in {src}')
    dst.mkdir(parents=True, exist_ok=True)
    for old in dst.glob('f*.png'):
        old.unlink()
    mask = rounded_mask(w, h, radius)
    plate = Image.new('RGB', (w, h), bg)
    n = len(frames)
    m = n - k  # output length
    start %= m
    load = lambda i: fit(Image.open(frames[i]).convert('RGB'), w, h)
    for i in range(m):
        im = load(i)
        if k and i < k:
            # Fade from the tail (frame m + i) into the head (frame i).
            im = Image.blend(load(m + i), im, (i + 1) / (k + 1))
        out = Image.composite(im, plate, mask)
        out.save(dst / f'f{(i - start) % m:04d}.png')
    print(f'{m} frames {w}x{h} (radius {radius}, crossfade {k}{f", starts on frame {start}" if start else ""}) -> {dst}')


if __name__ == '__main__':
    main()
