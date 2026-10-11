"""Labelled contact sheet of slide renders.

    python contact_sheet.py <renders dir with slide-*.png> <out.png> [--titles slides.json] [--cols 3] [--width 640]
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
FONT = HERE.parent / 'design' / 'fonts' / 'Onest-500.ttf'


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('renders')
    ap.add_argument('out')
    ap.add_argument('--titles', default=None)
    ap.add_argument('--cols', type=int, default=3)
    ap.add_argument('--width', type=int, default=640)
    a = ap.parse_args()
    files = sorted(Path(a.renders).glob('slide-*.png'), key=lambda p: int(p.stem.split('-')[-1]))
    if not files:
        raise SystemExit(f'no slide-*.png in {a.renders}')
    titles = {}
    if a.titles:
        doc = json.loads(Path(a.titles).read_text(encoding='utf-8'))
        for i, s in enumerate(doc['slides'], start=1):
            t = [e for e in s['elements'] if e['type'] == 'title']
            raw = ''.join(r['raw'] for p in t[0]['text']['paragraphs'] for ln in p['lines'] for r in ln['runs']) if t else ''
            titles[i] = f"{s['nn']} · {raw or s['file']}"
    w = a.width
    h = round(w * 9 / 16)
    pad, label = 16, 34
    cols = min(a.cols, len(files))
    rows = (len(files) + cols - 1) // cols
    sheet = Image.new('RGB', (pad + cols * (w + pad), pad + rows * (h + label + pad)), (40, 44, 52))
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.truetype(str(FONT), 18) if FONT.exists() else ImageFont.load_default()
    for k, f in enumerate(files):
        n = int(f.stem.split('-')[-1])
        with Image.open(f) as im:
            im = im.convert('RGB').resize((w, h), Image.LANCZOS)
        x = pad + (k % cols) * (w + pad)
        y = pad + (k // cols) * (h + label + pad)
        draw.text((x, y + 6), titles.get(n, f'slide {n}'), fill=(235, 235, 235), font=font)
        sheet.paste(im, (x, y + label))
    sheet.save(a.out)
    print(f'contact sheet: {a.out} ({len(files)} slides)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
