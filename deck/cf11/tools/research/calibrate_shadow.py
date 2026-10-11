"""Calibrate a CSS box-shadow against a DrawingML outer shadow (a:outerShdw) as LibreOffice renders it.

    SOFFICE=<LibreOffice 26.x soffice> python research/calibrate_shadow.py <out dir>     (node with Playwright too)

One white rounded card per slide on the canvas colour. Chromium draws each card with its CSS box-shadow (the
reference); the same card is built as a roundRect with a:outerShdw the way deckpptx/shapes.py writes it (dist/dir
from the offset, the spread as sx/sy about the centre, algn="ctr", the colour and alpha) for several
blurRad = k x the CSS blur radius, LibreOffice renders it, and the shadow ring around the card is compared: mean and
99th-percentile grey-level error per card and k.

Measured with LibreOffice 26.8.1.1 (2026-10-11), mean / p99 grey levels in the ring:
                                               k 0.9      k 1.0      k 1.1      k 1.2      k 1.3
    1 560x300   0 24 48 0      a.25         1.1 / 5    0.6 / 3    0.3 / 3    0.6 / 2    1.1 / 4
    2 480x260   0 8 24 0       a.25         1.2 / 6    0.7 / 4    0.7 / 4    0.8 / 3    1.6 / 5
    3 400x300   0 40 80 0      a.20         0.6 / 3    0.4 / 2    0.2 / 1    0.5 / 2    0.8 / 3
    4 812x288   0 40 80 -48    a.30 (deck)  0.7 / 6    0.4 / 4    0.2 / 3    0.2 / 2    0.4 / 3
    5 812x528   0 40 80 -48    a.30 (deck)  0.8 / 5    0.6 / 4    0.4 / 3    0.1 / 2    0.2 / 2
    6 496x320   0 40 80 -48    a.30 (deck)  0.5 / 5    0.3 / 3    0.1 / 2    0.2 / 2    0.3 / 3
    7 1664x528  0 40 80 -48    a.30 (deck)  0.9 / 5    0.8 / 4    0.4 / 3    0.2 / 2    0.3 / 2
    8 688x140   0 48 90 -56    a.38         1.1 / 15   1.0 / 14   1.0 / 14   0.9 / 14   0.9 / 13
-> deckpptx/shapes.py SHADOW_BLUR_K = 1.1: best for the unscaled shadows (1-3) and within 0.3 grey levels of the
   best for the deck's cards (4-7, the deck's --shadow on the sizes of slides 02, 03, 11, 12).
Two LibreOffice behaviours found on the way (probes with a canvas-coloured card, blur 99 px, alpha .6):
  * sy without sx is ignored (the shadow keeps the full height); with sx present both apply. shapes.py always writes
    both.
  * the scale applies to the blurred shadow: its blur shrinks with sx/sy (a 140 px card at sy 20 % gets a tight,
    hard band where CSS - shrink, then blur - keeps a soft one; card 8). k absorbs the mild case; a strong negative
    spread on a small box stays visibly tighter than the HTML, compare.py flags it, data-shadow="bake" is the remedy.
PowerPoint is not measured: its blur radius, and whether it scales before or after blurring, are not verified.
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from lxml import etree
from PIL import Image

HERE = Path(__file__).resolve().parent
TOOLS = HERE.parent
sys.path.insert(0, str(TOOLS))
from deckpptx.shapes import geometry_el, shadow_el   # noqa: E402
import deckpptx.shapes as shapes                     # noqa: E402
from deckpptx.template import new_presentation       # noqa: E402

NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
P = f'{{{NS_P}}}'
A = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
CANVAS, SURFACE = 'F3F3F0', 'FFFFFF'
DECK = (0, 40, 80, -48, '0B121C', 0.30)          # deck.css --shadow, its visible layer
# cards, each centred on its own slide: (w, h, radius, (dx, dy, blur, spread, rgb, alpha))
CARDS = [(560, 300, 40, (0, 24, 48, 0, '0B121C', 0.25)),
         (480, 260, 32, (0, 8, 24, 0, '0B121C', 0.25)),
         (400, 300, 24, (0, 40, 80, 0, '0B121C', 0.20)),
         (812, 288, 48, DECK), (812, 528, 48, DECK), (496, 320, 48, DECK), (1664, 528, 48, DECK),
         (688, 140, 48, (0, 48, 90, -56, '10295A', 0.38))]
KS = (0.9, 1.0, 1.1, 1.2, 1.3)


def pos(w, h):
    return (1920 - w) // 2, (1080 - h) // 2 - 40


def reference(out: Path) -> list[Path]:
    js = out / 'shot.mjs'
    pages = []
    for i, (w, h, r, (dx, dy, b, s, c, a)) in enumerate(CARDS, start=1):
        x, y = pos(w, h)
        rgba = f'rgba({int(c[0:2], 16)},{int(c[2:4], 16)},{int(c[4:6], 16)},{a})'
        html = out / f'ref-{i}.html'
        html.write_text(f'<!doctype html><html><body style="margin:0;width:1920px;height:1080px;background:#{CANVAS};'
                        f'position:relative;overflow:hidden"><div style="position:absolute;left:{x}px;top:{y}px;'
                        f'width:{w}px;height:{h}px;border-radius:{r}px;background:#{SURFACE};'
                        f'box-shadow:{dx}px {dy}px {b}px {s}px {rgba}"></div></body></html>', encoding='utf-8')
        pages.append((html, out / f'ref-{i}.png'))
    js.write_text(f"""import {{ loadChromium }} from {json.dumps(str(TOOLS / 'pw.mjs'))};
const chromium = await loadChromium();
const b = await chromium.launch();
const p = await b.newPage({{ viewport: {{ width: 1920, height: 1080 }} }});
for (const [html, png] of {json.dumps([[str(h), str(p)] for h, p in pages])}) {{
  await p.goto('file://' + html);
  await p.screenshot({{ path: png }});
}}
await b.close();
""", encoding='utf-8')
    subprocess.run(['node', str(js)], check=True)
    return [p for _, p in pages]


def build(out: Path, k: float) -> list[Path]:
    shapes.SHADOW_BLUR_K = k
    prs = new_presentation()
    for i, (w, h, r, (dx, dy, b, s, c, a)) in enumerate(CARDS, start=2):
        slide = prs.slides.add_slide(prs.slide_layouts[0])
        tree = slide.shapes._spTree
        for sp in list(tree.iterchildren(P + 'sp')):
            tree.remove(sp)
        x, y = pos(w, h)
        bg = etree.SubElement(tree, P + 'sp')
        nv = etree.SubElement(bg, P + 'nvSpPr')
        etree.SubElement(nv, P + 'cNvPr', id='2', name='canvas')
        etree.SubElement(nv, P + 'cNvSpPr')
        etree.SubElement(nv, P + 'nvPr')
        spr = etree.SubElement(bg, P + 'spPr')
        xf = etree.SubElement(spr, A + 'xfrm')
        etree.SubElement(xf, A + 'off', x='0', y='0')
        etree.SubElement(xf, A + 'ext', cx=str(1920 * 6350), cy=str(1080 * 6350))
        g = etree.SubElement(spr, A + 'prstGeom', prst='rect')
        etree.SubElement(g, A + 'avLst')
        f = etree.SubElement(spr, A + 'solidFill')
        etree.SubElement(f, A + 'srgbClr', val=CANVAS)
        ln = etree.SubElement(spr, A + 'ln')
        etree.SubElement(ln, A + 'noFill')
        sp = etree.SubElement(tree, P + 'sp')
        nv = etree.SubElement(sp, P + 'nvSpPr')
        etree.SubElement(nv, P + 'cNvPr', id='3', name='card')
        etree.SubElement(nv, P + 'cNvSpPr')
        etree.SubElement(nv, P + 'nvPr')
        spr = etree.SubElement(sp, P + 'spPr')
        xf = etree.SubElement(spr, A + 'xfrm')
        etree.SubElement(xf, A + 'off', x=str(x * 6350), y=str(y * 6350))
        etree.SubElement(xf, A + 'ext', cx=str(w * 6350), cy=str(h * 6350))
        spr.append(geometry_el(w, h, [[r, r]] * 4)[0])
        f = etree.SubElement(spr, A + 'solidFill')
        etree.SubElement(f, A + 'srgbClr', val=SURFACE)
        ln = etree.SubElement(spr, A + 'ln')
        etree.SubElement(ln, A + 'noFill')
        spr.append(shadow_el({'dx': dx, 'dy': dy, 'blur': b, 'spread': s, 'color': {'rgb': c, 'alpha': a}}, w, h))
    pptx = out / f'shadow-k{k}.pptx'
    prs.save(str(pptx))
    prof = tempfile.mkdtemp()
    subprocess.run([os.environ['SOFFICE'], f'-env:UserInstallation=file://{prof}', '--headless', '--norestore',
                    '--convert-to', 'pdf', '--outdir', str(out), str(pptx)],
                   env={**os.environ, 'SAL_USE_VCLPLUGIN': 'svp'}, check=True, capture_output=True)
    subprocess.run(['pdftoppm', '-png', '-scale-to-x', '1920', '-scale-to-y', '1080',
                    str(out / f'shadow-k{k}.pdf'), str(out / f'shadow-k{k}')], check=True)
    pngs = sorted(out.glob(f'shadow-k{k}-*.png'), key=lambda p: int(p.stem.rsplit('-', 1)[1]))
    return pngs


def ring(x, y, w, h, dx, dy, b, s):
    m = np.zeros((1080, 1920), bool)
    e = abs(dx) + abs(dy) + b + max(0, s) + 8
    m[max(0, y - e):min(1080, y + h + e), max(0, x - e):min(1920, x + w + e)] = True
    m[y:y + h, x:x + w] = False
    return m


def main(out: Path):
    out.mkdir(parents=True, exist_ok=True)
    refs = [np.asarray(Image.open(p).convert('L'), dtype=np.float32) for p in reference(out)]
    rows = {i: [] for i in range(len(CARDS))}
    for k in KS:
        for i, png in enumerate(build(out, k)):
            img = np.asarray(Image.open(png).convert('L').resize((1920, 1080)), dtype=np.float32)
            w, h, r, (dx, dy, b, s, c, a) = CARDS[i]
            x, y = pos(w, h)
            m = ring(x, y, w, h, dx, dy, b, s)
            d = np.abs(refs[i][m] - img[m])
            rows[i].append(f'{d.mean():4.1f} / {np.percentile(d, 99):<3.0f}')
    print('card                                     ' + ''.join(f'{"k " + str(k):<11}' for k in KS))
    for i, (w, h, r, (dx, dy, b, s, c, a)) in enumerate(CARDS):
        print(f'{i + 1} {w}x{h:<5} {dx} {dy} {b} {s:<4} a{a:<5}'.ljust(41) + ''.join(f'{v:<11}' for v in rows[i]))


if __name__ == '__main__':
    main(Path(sys.argv[1]))
