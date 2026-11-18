#!/usr/bin/env python3
"""The stand's cards: a sheet of eight to print and cut, each with the wordmark, a QR code to the example without
sign-up and one line of what to do (the owner, 18.11: «карточки нужно сделать покруче, текст не иишным, убрать ссылку
именно надписью, кьюар код … с персонажем нашим … чтобы красиво при печати получилось»).

    python3 deck/cf11/tools/qr_cards.py <out dir> [--url https://…/try]

Writes <out dir>/cards.html and prints the page to cards.pdf (A4 across, eight cards of 74.25 × 105 mm, vector, the
fonts inside) and cards.png (a preview). Needs segno (the code's modules) and Playwright's Chromium (the PDF).

The code is the brand's own: every module is a dot, the corner marks are rounded, and in the middle sits «Точка», the
wordmark's yellow dot with the face the app draws (index.css --m-dot-face). It is made with the highest error
correction (H), so the modules the face covers are restored by any scanner (checked on the printed page at 300 dpi
with zxing: all eight codes, and one card made small, blurred and turned as a phone sees it). For a printer: white paper, no filled grounds, nothing nearer than
9 mm to a card's edge (a printer leaves about 5 mm of the sheet blank), hairlines to cut along.
"""
from __future__ import annotations

import math
import subprocess
import sys
from pathlib import Path

import segno

HERE = Path(__file__).resolve().parent
FONTS = HERE.parent / 'design' / 'fonts'
INK = '#0b121c'
YELLOW = '#f4c45b'
MUTED = '#4b515b'
URL = 'https://ludosiel-studyforge.hf.space/try'
# the face: how far the modules are cleared round it and its own radius, in modules
CLEAR = 5.4
FACE = 4.5


def qr_svg(url: str) -> tuple[str, int]:
    """The code as an SVG fragment in module units (0…n), and n."""
    code = segno.make(url, error='h', micro=False, boost_error=False)
    m = [list(row) for row in code.matrix]
    n = len(m)
    c = n / 2
    finders = [(0, 0), (0, n - 7), (n - 7, 0)]
    # version 2 and up has alignment marks; versions 2–6 have one, its centre 6 modules in from the far corner
    align = (n - 7, n - 7) if n >= 25 else None
    def special(r: int, col: int) -> bool:
        if any(fr <= r < fr + 7 and fc <= col < fc + 7 for fr, fc in finders):
            return True
        return bool(align) and abs(r - align[0]) <= 2 and abs(col - align[1]) <= 2
    out = []
    dots = []
    for r in range(n):
        for col in range(n):
            if not m[r][col] or special(r, col):
                continue
            if math.hypot(col + 0.5 - c, r + 0.5 - c) < CLEAR:
                continue
            dots.append(f'M{col + 0.5 - 0.46:.2f} {r + 0.5:.2f}a.46 .46 0 1 0 .92 0a.46 .46 0 1 0 -.92 0')
    out.append(f'<path fill="{INK}" d="{"".join(dots)}"/>')
    def ring(x: float, y: float, size: float, radius: float, inner: float) -> str:
        def rr(x0, y0, s, rad):
            return (f'M{x0 + rad:.2f} {y0:.2f}h{s - 2 * rad:.2f}a{rad} {rad} 0 0 1 {rad} {rad}v{s - 2 * rad:.2f}a{rad} {rad} 0 0 1 -{rad} {rad}'
                    f'h-{s - 2 * rad:.2f}a{rad} {rad} 0 0 1 -{rad} -{rad}v-{s - 2 * rad:.2f}a{rad} {rad} 0 0 1 {rad} -{rad}z')
        return rr(x, y, size, radius) + rr(x + 1, y + 1, size - 2, inner)
    for fr, fc in finders:
        out.append(f'<path fill="{INK}" fill-rule="evenodd" d="{ring(fc, fr, 7, 2.1, 1.2)}"/>')
        out.append(f'<circle cx="{fc + 3.5}" cy="{fr + 3.5}" r="1.55" fill="{INK}"/>')
    if align:
        ar, ac = align
        out.append(f'<path fill="{INK}" fill-rule="evenodd" d="{ring(ac - 2, ar - 2, 5, 1.5, 0.8)}"/>')
        out.append(f'<circle cx="{ac + 0.5}" cy="{ar + 0.5}" r=".5" fill="{INK}"/>')
    # «Точка»: the app's face, 20 units across
    k = FACE / 10
    out.append(f'<g transform="translate({c - FACE:.3f} {c - FACE:.3f}) scale({k:.4f})"><circle cx="10" cy="10" r="10" fill="{YELLOW}"/>'
               f'<ellipse cx="7.1" cy="8.4" rx="1.5" ry="2.4" fill="{INK}"/><ellipse cx="12.9" cy="8.4" rx="1.5" ry="2.4" fill="{INK}"/></g>')
    return ''.join(out), n


def page(url: str) -> str:
    body, n = qr_svg(url)
    card = f'''<div class="card">
  <div class="logo">Meldy<i></i></div>
  <svg class="qr" viewBox="0 0 {n} {n}" role="img" aria-label="QR-код примера Meldy"><use href="#code"/></svg>
  <div class="h">Наведите камеру</div>
  <div class="p">Откроется пробный экзамен.<br>Регистрация не&nbsp;нужна.</div>
</div>'''
    faces = '\n'.join(f"@font-face{{font-family:Onest;src:url('{(FONTS / f'Onest-{w}.ttf').as_uri()}');font-weight:{w}}}" for w in (400, 600))
    return f'''<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Meldy — карточки</title><style>
{faces}
@page{{size:297mm 210mm;margin:0}}
html,body{{margin:0;background:#fff;font-family:Onest,sans-serif;color:{INK};-webkit-print-color-adjust:exact;print-color-adjust:exact}}
.sheet{{position:relative;width:297mm;height:210mm;display:grid;grid-template-columns:repeat(4,74.25mm);grid-template-rows:repeat(2,105mm)}}
.card{{box-sizing:border-box;padding:9mm 9mm 0;display:flex;flex-direction:column}}
.logo{{font-size:9mm;line-height:1;font-weight:600;letter-spacing:-.055em}}
.logo i{{display:inline-block;width:2.25mm;height:2.25mm;margin-left:.45mm;border-radius:50%;background:{YELLOW}}}
.qr{{display:block;width:52mm;height:52mm;margin:6mm auto 0}}
.h{{margin-top:5.6mm;font-size:5.6mm;line-height:1.1;font-weight:600;letter-spacing:-.02em}}
.p{{margin-top:1.7mm;font-size:3.2mm;line-height:1.4;color:{MUTED}}}
/* where to cut: hairlines between the cards (one drawing: thin boxes of their own were dropped by the PDF printer) */
.cuts{{position:absolute;left:0;top:0;width:297mm;height:210mm}}
</style></head><body><svg width="0" height="0" style="position:absolute"><defs><g id="code">{body}</g></defs></svg>
<div class="sheet">{card * 8}
<svg class="cuts" viewBox="0 0 297 210" aria-hidden="true"><path d="M74.25 0V210M148.5 0V210M222.75 0V210M0 105H297" fill="none" stroke="#aeb2b9" stroke-width=".2" stroke-dasharray="1.2 1"/></svg>
</div></body></html>'''


PRINT = r'''
const { chromium } = require('playwright');
(async () => {
  const [html, pdf, png] = process.argv.slice(2);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1123, height: 794 }, deviceScaleFactor: 2 });
  await p.goto('file://' + html);
  await p.evaluate(() => document.fonts.ready);
  await p.pdf({ path: pdf, width: '297mm', height: '210mm', printBackground: true });
  await p.screenshot({ path: png });
  await b.close();
})();
'''


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return 2
    out = Path(args[0]).resolve()
    url = args[args.index('--url') + 1] if '--url' in args else URL
    out.mkdir(parents=True, exist_ok=True)
    html = out / 'cards.html'
    html.write_text(page(url), encoding='utf-8')
    js = out / 'print.cjs'
    js.write_text(PRINT, encoding='utf-8')
    subprocess.run(['node', str(js), str(html), str(out / 'cards.pdf'), str(out / 'cards.png')], check=True)
    js.unlink()
    print(out / 'cards.pdf')
    return 0


if __name__ == '__main__':
    sys.exit(main())
