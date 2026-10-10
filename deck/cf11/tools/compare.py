"""Compare the LibreOffice renders of the PPTX with the HTML slides they came from.

    python compare.py <build dir with slides.json> <render dir with slide-N.png> [--out <dir>] [--max-shift 2.5]

For every slide: side-by-side (HTML | PPTX in LibreOffice) and a difference image, the share of pixels that differ
visibly, and for every live text element the offset between the two renders, found by searching the shift
(+-12 px) that best aligns the element's region (sub-pixel by a parabola fit). Exit status 1 when a text element
is off by more than --max-shift px.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
FONT = HERE.parent / 'design' / 'fonts' / 'Onest-500.ttf'
SEARCH = 12


def gray(img: Image.Image) -> np.ndarray:
    return np.asarray(img.convert('L'), dtype=np.float32)


def best_shift(ref: np.ndarray, out: np.ndarray, box: tuple[int, int, int, int]) -> tuple[float, float, float]:
    """(dx, dy, residual) that best maps the ref region onto the render: render(x+dx, y+dy) ~ ref(x, y)."""
    x0, y0, x1, y1 = box
    H, W = ref.shape
    x0, y0 = max(SEARCH, x0), max(SEARCH, y0)
    x1, y1 = min(W - SEARCH, x1), min(H - SEARCH, y1)
    if x1 - x0 < 4 or y1 - y0 < 4:
        return 0.0, 0.0, 0.0
    r = ref[y0:y1, x0:x1]
    r = r - r.mean()
    if float(np.abs(r).max()) < 8:
        return 0.0, 0.0, 0.0
    costs = np.full((2 * SEARCH + 1, 2 * SEARCH + 1), np.inf)
    for dy in range(-SEARCH, SEARCH + 1):
        for dx in range(-SEARCH, SEARCH + 1):
            o = out[y0 + dy:y1 + dy, x0 + dx:x1 + dx]
            o = o - o.mean()
            costs[dy + SEARCH, dx + SEARCH] = float(np.mean((o - r) ** 2))
    iy, ix = np.unravel_index(np.argmin(costs), costs.shape)

    def sub(c_m, c_0, c_p):
        d = c_m - 2 * c_0 + c_p
        return 0.0 if d <= 0 else 0.5 * (c_m - c_p) / d
    fx = sub(costs[iy, ix - 1], costs[iy, ix], costs[iy, ix + 1]) if 0 < ix < 2 * SEARCH else 0.0
    fy = sub(costs[iy - 1, ix], costs[iy, ix], costs[iy + 1, ix]) if 0 < iy < 2 * SEARCH else 0.0
    resid = float(np.sqrt(costs[iy, ix])) / max(1.0, float(np.sqrt(np.mean(r ** 2))))
    return ix - SEARCH + fx, iy - SEARCH + fy, resid


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('build')
    ap.add_argument('renders')
    ap.add_argument('--out', default=None)
    ap.add_argument('--max-shift', type=float, default=2.5)
    a = ap.parse_args()
    build, renders = Path(a.build), Path(a.renders)
    out_dir = Path(a.out) if a.out else renders / 'compare'
    out_dir.mkdir(parents=True, exist_ok=True)
    doc = json.loads((build / 'slides.json').read_text(encoding='utf-8'))
    font = ImageFont.truetype(str(FONT), 22) if FONT.exists() else ImageFont.load_default()
    report, worst = [], 0.0
    print(f"{'slide':<6}{'diff>32':>9}{'mean':>7}   text elements: offset (render - HTML) px")
    for i, s in enumerate(doc['slides'], start=1):
        rpath = renders / f'slide-{i}.png'
        if not rpath.exists():
            print(f'{s["nn"]}: no render {rpath}')
            continue
        ref_img = Image.open(build / s['reference']).convert('RGB')
        out_img = Image.open(rpath).convert('RGB').resize(ref_img.size, Image.LANCZOS)
        ref_a, out_a = np.asarray(ref_img, dtype=np.int16), np.asarray(out_img, dtype=np.int16)
        diff = np.abs(ref_a - out_a).max(axis=2)
        frac = float((diff > 32).mean())
        mean = float(np.abs(ref_a - out_a).mean())
        rg, og = gray(ref_img), gray(out_img)
        texts = []
        for e in s['elements']:
            if e['type'] not in ('text', 'title'):
                continue
            ys = [ln['baseline'] for p in e['text']['paragraphs'] for ln in p['lines']]
            if not ys:
                continue
            b = e['bbox']
            box = (int(b['x']) - 4, int(b['y']) - 4, int(b['x'] + b['w']) + 4, int(b['y'] + b['h']) + 4)
            dx, dy, res = best_shift(rg, og, box)
            texts.append({'id': e['id'], 'name': e.get('name'), 'dx': round(dx, 2), 'dy': round(dy, 2), 'residual': round(res, 3),
                          'sample': ''.join(r['text'] for r in e['text']['paragraphs'][0]['lines'][0]['runs'])[:28]})
            worst = max(worst, abs(dx), abs(dy))
        report.append({'slide': s['nn'], 'diffFrac': round(frac, 4), 'meanAbs': round(mean, 2), 'texts': texts})
        print(f"{s['nn']:<6}{frac * 100:8.2f}%{mean:7.2f}   " +
              '  '.join(f"{t['id']}({t['dx']:+.1f},{t['dy']:+.1f})" for t in texts))
        # side by side + diff
        w, h = ref_img.size
        sheet = Image.new('RGB', (w * 2 + 30, h + 60), (40, 44, 52))
        sheet.paste(ref_img, (10, 50))
        sheet.paste(out_img, (w + 20, 50))
        d = ImageDraw.Draw(sheet)
        d.text((10, 12), f"{s['nn']} HTML (Chromium)", fill=(235, 235, 235), font=font)
        d.text((w + 20, 12), f"{s['nn']} PPTX (LibreOffice)", fill=(235, 235, 235), font=font)
        sheet.save(out_dir / f"side-{s['nn']}.png")
        heat = np.clip(diff * 3, 0, 255).astype(np.uint8)
        base = (np.asarray(ref_img.convert('L'), dtype=np.float32) * 0.35).astype(np.uint8)
        rgb = np.stack([np.maximum(base, heat), base, base], axis=2)
        Image.fromarray(rgb).save(out_dir / f"diff-{s['nn']}.png")
    (out_dir / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'worst text offset {worst:.2f} px (limit {a.max_shift}); images and report.json in {out_dir}')
    return 0 if worst <= a.max_shift else 1


if __name__ == '__main__':
    raise SystemExit(main())
