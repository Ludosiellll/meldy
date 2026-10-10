"""Measure where LibreOffice puts the first baseline of a text box with exact line spacing (a:spcPts).

    python research/calibrate_lines.py <out dir>   (needs SOFFICE = LibreOffice 26.x)

Builds one slide of text boxes (Onest embedded as in the deck): top inset 0, anchor top, a single line of "НННН"
(flat bottom on the baseline) at several font sizes and exact line heights, renders it with LibreOffice at 1920 px
and finds the baseline as the lowest ink row of each box. Prints baseline - box top for each case next to the
model `spacing - descent`, so the vertical model in deckpptx/text.py can be checked against the renderer.
"""
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from lxml import etree
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from deckpptx import fonts as F                        # noqa: E402
from deckpptx.template import new_presentation         # noqa: E402
from deckpptx.text import RunCtx, TextPlan, ParaPlan, tx_body   # noqa: E402

NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
P = f'{{{NS_P}}}'
A = '{http://schemas.openxmlformats.org/drawingml/2006/main}'

CASES = []   # (size px, line px, weight)
for size in (28, 40, 64, 120, 200):
    for ratio in (0.9, 1.0, 1.1, 1.275, 1.5):
        CASES.append((size, round(size * ratio, 2), 600))


def main(out: Path):
    out.mkdir(parents=True, exist_ok=True)
    prs = new_presentation()
    slide = prs.slides.add_slide(prs.slide_layouts[0])
    tree = slide.shapes._spTree
    for sp in list(tree.iterchildren(P + 'sp')):
        tree.remove(sp)
    boxes = []
    x, y, col_w = 20, 20, 380
    nid = 2
    for size, line, weight in CASES:
        h = max(line, size * 1.4) + 30
        if y + h > 1060:
            x += col_w
            y = 20
        run = {'text': 'НННН', 'raw': 'НННН', 'weight': weight, 'sizePx': size, 'color': {'rgb': '000000', 'alpha': 1},
               'letterSpacingPx': 0, 'italic': False}
        plan = TextPlan(x=x, y=y, w=col_w - 20, h=h, ins=(0, 0, 0, 0), anchor='t', wrap='none',
                        paras=[ParaPlan(align='l', line_px=line, spc_bef_px=0, marL_px=0, marR_px=0, indent_px=0, lines=[[run]])])
        sp = etree.SubElement(tree, P + 'sp')
        nv = etree.SubElement(sp, P + 'nvSpPr')
        etree.SubElement(nv, P + 'cNvPr', id=str(nid), name=f'case {nid}')
        etree.SubElement(nv, P + 'cNvSpPr', txBox='1')
        etree.SubElement(nv, P + 'nvPr')
        spr = etree.SubElement(sp, P + 'spPr')
        xf = etree.SubElement(spr, A + 'xfrm')
        etree.SubElement(xf, A + 'off', x=str(x * 6350), y=str(y * 6350))
        etree.SubElement(xf, A + 'ext', cx=str((col_w - 20) * 6350), cy=str(int(h * 6350)))
        g = etree.SubElement(spr, A + 'prstGeom', prst='rect')
        etree.SubElement(g, A + 'avLst')
        etree.SubElement(spr, A + 'noFill')
        sp.append(tx_body(NS_P, plan, RunCtx(lang='ru-RU')))
        boxes.append((size, line, x, y, col_w - 20, h))
        nid += 1
        y += h
    F.embed_fonts(prs, HERE.parent.parent / 'design' / 'fonts')
    pptx = out / 'calibrate.pptx'
    prs.save(str(pptx))
    soffice = os.environ.get('SOFFICE')
    prof = tempfile.mkdtemp()
    subprocess.run([soffice, f'-env:UserInstallation=file://{prof}', '--headless', '--norestore', '--convert-to', 'pdf',
                    '--outdir', str(out), str(pptx)], env={**os.environ, 'SAL_USE_VCLPLUGIN': 'svp'}, check=True,
                   capture_output=True)
    subprocess.run(['pdftoppm', '-png', '-r', '144', '-singlefile', str(out / 'calibrate.pdf'), str(out / 'calibrate')], check=True)
    img = np.asarray(Image.open(out / 'calibrate.png').convert('L'))
    scale = img.shape[1] / 1920
    asc, desc, gap = F.vertical_metrics(HERE.parent.parent / 'design' / 'fonts' / 'Onest-600.ttf')
    print(f'font metrics asc {asc} desc {desc} gap {gap}; render scale {scale}')
    print(f"{'size':>5} {'line':>7} {'ratio':>6} | {'LO base-top':>11} {'model L-d':>9} {'diff':>6} {'diff/em':>8} | {'cap top':>7}")
    for size, line, x, y, w, h in boxes:
        x0, y0, x1, y1 = [int(round(v * scale)) for v in (x, y - 0.5 * size, x + w, y + h)]
        reg = img[max(0, y0):y1, x0:x1] < 128
        rows = np.where(reg.any(axis=1))[0]
        if not len(rows):
            print(size, line, 'no ink'); continue
        base = (max(0, y0) + rows[-1] + 1) / scale
        cap_top = (max(0, y0) + rows[0]) / scale
        model = line - desc * size
        d = (base - y) - model
        print(f'{size:5d} {line:7.2f} {line / size:6.3f} | {base - y:11.2f} {model:9.2f} {d:6.2f} {d / size:8.3f} | {cap_top - y:7.2f}')


if __name__ == '__main__':
    main(Path(sys.argv[1]))
