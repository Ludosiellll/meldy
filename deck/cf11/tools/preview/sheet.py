"""Motion preview, step 3: one keyframe sheet per transition, so Morph pairing can be judged without the video.

    python preview/sheet.py <out/preview/motion>

keyframes/NN-in.png: the transition into slide NN at 0, 25, 50, 75 and 100 % (100 % = the slide's start state, before
its builds) and, for a Morph, the pair map: the slide's start dimmed, name pairs blue, automatic pairs orange (an
arrow where the object travels), objects that fade out red, fade in green, wait for their build purple.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
FONTS = HERE.parent.parent / 'design' / 'fonts'
CELL = (768, 432)
GAP, HEAD, CAP = 14, 70, 40
BG, FG, MUTED = (24, 26, 31), (236, 237, 240), (150, 156, 166)


def font(size: int, weight: int = 500):
    f = FONTS / f'Onest-{weight}.ttf'
    return ImageFont.truetype(str(f), size) if f.exists() else ImageFont.load_default()


def summary(scene: dict) -> str:
    tr = scene['transition']
    kind = tr['kind']
    if kind == 'morph':
        draw = scene['draw']
        pairs = [d for d in draw if d['kind'] == 'pair']
        auto = sum(1 for d in pairs if d.get('how') == 'auto')
        n = {k: sum(1 for d in draw if d['kind'] == k) for k in ('gone', 'new', 'held')}
        return (f'Morph {tr.get("option") or "byObject"}, {tr["dur"]:.0f} ms: {len(pairs)} pairs ({auto} automatic), '
                f'{n["gone"]} fade out, {n["new"]} fade in, {n["held"]} build in later')
    if kind == 'fade':
        return f'Fade{" from black" if tr.get("fromBlack") else ""}, {tr["dur"]:.0f} ms'
    return 'no transition (cut)'


def main(motion: Path) -> int:
    manifest = json.loads((motion / 'manifest.json').read_text(encoding='utf-8'))
    keys, out = motion / 'keys', motion / 'keyframes'
    out.mkdir(parents=True, exist_ok=True)
    made = 0
    for s in manifest['slides']:
        nn = s['nn']
        scene = json.loads(Path(s['scene']).read_text(encoding='utf-8'))
        frames = [keys / f'{nn}-k{k}.png' for k in range(5)]
        if scene['transition']['kind'] == 'cut' or not all(f.exists() for f in frames):
            continue
        cells = [(f, cap) for f, cap in zip(frames, ('start', '25 %', '50 %', '75 %', 'end = start of the slide'))]
        mp = keys / f'{nn}-map.png'
        if mp.exists():
            cells.append((mp, 'pairs: blue = name, orange = automatic, red = out, green = in, purple = builds later'))
        cols = 3
        rows = (len(cells) + cols - 1) // cols
        W = cols * CELL[0] + (cols + 1) * GAP
        H = HEAD + rows * (CELL[1] + CAP) + (rows + 1) * GAP
        sheet = Image.new('RGB', (W, H), BG)
        d = ImageDraw.Draw(sheet)
        title = f'{scene["index"] - 1:02d} → {nn}' if scene['index'] > 1 else f'start → {nn}'
        d.text((GAP, 14), title, fill=FG, font=font(34, 600))
        d.text((GAP + 230, 22), summary(scene), fill=MUTED, font=font(24, 500))
        for i, (f, cap) in enumerate(cells):
            r, c = divmod(i, cols)
            x = GAP + c * (CELL[0] + GAP)
            y = HEAD + GAP + r * (CELL[1] + CAP + GAP)
            with Image.open(f) as im:
                sheet.paste(im.convert('RGB').resize(CELL, Image.LANCZOS), (x, y))
            d.text((x, y + CELL[1] + 6), cap, fill=MUTED, font=font(20, 500))
        sheet.save(out / f'{nn}-in.png', optimize=True)
        made += 1
    print(f'{made} keyframe sheet(s) in {out}')
    return 0


if __name__ == '__main__':
    sys.exit(main(Path(sys.argv[1])))
