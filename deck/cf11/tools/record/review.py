"""Frames of a fitted clip to judge it by: a sheet at one frame a second, and full-size stills at chosen seconds.

    python3 -I deck/cf11/tools/record/review.py <clip.mp4> <out dir> [--stills 3.5,9,14.2] [--box W H] [--cols 6] [--width 384]

Writes <out>/<name>-1fps.png (every second of the clip, small, with its second) and <out>/<name>-<s>s.png: the
frame at that second, at the size the screen shows it on the 1920 × 1080 slide (--box: the screen's width and
height on the slide; without it, the clip's own size) — the size to judge legibility at.
"""
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw


def arg(name, default=None):
    if f'--{name}' in sys.argv:
        return sys.argv[sys.argv.index(f'--{name}') + 1]
    return default


def main():
    mp4, out = Path(sys.argv[1]), Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    name = mp4.stem
    cols, width = int(arg('cols', 6)), int(arg('width', 384))
    with tempfile.TemporaryDirectory(prefix='review-', dir=str(out)) as tmp:
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', str(mp4), '-vf', 'fps=1:round=down', str(Path(tmp) / 's%03d.png')], check=True)
        frames = sorted(Path(tmp).glob('s*.png'))
        first = Image.open(frames[0])
        h = round(first.height * width / first.width)
        rows = (len(frames) + cols - 1) // cols
        sheet = Image.new('RGB', (cols * (width + 10) + 10, rows * (h + 30) + 10), '#2a2f36')
        d = ImageDraw.Draw(sheet)
        for i, f in enumerate(frames):
            x, y = 10 + (i % cols) * (width + 10), 10 + (i // cols) * (h + 30)
            sheet.paste(Image.open(f).convert('RGB').resize((width, h), Image.LANCZOS), (x, y + 22))
            d.text((x, y + 4), f'{i:2d} s', fill='#e8e8e8')
        sheet.save(out / f'{name}-1fps.png')
        print(f'{out / f"{name}-1fps.png"}: {len(frames)} frames')
    box = [int(v) for v in sys.argv[sys.argv.index('--box') + 1:sys.argv.index('--box') + 3]] if '--box' in sys.argv else None
    for s in [float(v) for v in (arg('stills') or '').split(',') if v.strip()]:
        dst = out / f'{name}-{s:05.2f}s.png'
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-ss', f'{s:.3f}', '-i', str(mp4), '-frames:v', '1', str(dst)], check=True)
        if box:
            Image.open(dst).convert('RGB').resize(tuple(box), Image.LANCZOS).save(dst)
        print(f'{dst}')


if __name__ == '__main__':
    main()
