"""Measure how LibreOffice applies letter spacing (a:rPr spc) at run boundaries inside a line.

    python research/calibrate_spacing.py <out dir>   (needs SOFFICE = LibreOffice 26.x)

One line, «Пилот: [N] студентов, [M] дней» in Onest SemiBold 72 px, as one run, as five runs with the same attributes
and as five runs with alternating colours, at spacing 0, -2.16 and -10 px; plus «АААА|АААА» with one colour change at
-10 px and +10 px. Prints the ink extent of each line. Measured with LibreOffice 26.8: runs with equal attributes are
merged (no change); every colour change with negative spacing makes the line wider by |spacing| (the spacing after
the run's last character is dropped: editeng impedit3.cxx applies kerning behind a portion only when it is positive,
"#i9050# Do Kerning also behind portions"); positive spacing is kept. compare.py allows for this drift.
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
PARTS = ['Пилот: ', '[N]', ' студентов, ', '[M]', ' дней']


def run(text, rgb, ls):
    return {'text': text, 'raw': text, 'weight': 600, 'sizePx': 72, 'color': {'rgb': rgb, 'alpha': 1},
            'letterSpacingPx': ls, 'italic': False}


CASES = []
for ls in (0, -2.16, -10):
    CASES.append((f'one run, spacing {ls}', [run(''.join(PARTS), '000000', ls)]))
    CASES.append((f'5 runs same colour, spacing {ls}', [run(t, '000000', ls) for t in PARTS]))
    CASES.append((f'5 runs 2 colours, spacing {ls}', [run(t, '000000' if i % 2 == 0 else '000001', ls)
                                                       for i, t in enumerate(PARTS)]))
for ls in (-10, 10):
    CASES.append((f'АААААААА one run, spacing {ls}', [run('АААААААА', '000000', ls)]))
    CASES.append((f'АААА|АААА 2 colours, spacing {ls}', [run('АААА', '000000', ls), run('АААА', '000001', ls)]))


def main(out: Path):
    out.mkdir(parents=True, exist_ok=True)
    prs = new_presentation()
    slide = prs.slides.add_slide(prs.slide_layouts[0])
    tree = slide.shapes._spTree
    for sp in list(tree.iterchildren(P + 'sp')):
        tree.remove(sp)
    boxes, x, y, w, h = [], 40, 4, 1800, 82
    for nid, (label, runs) in enumerate(CASES, start=2):
        plan = TextPlan(x=x, y=y, w=w, h=h, ins=(0, 0, 0, 0), anchor='t', wrap='none',
                        paras=[ParaPlan(align='l', line_px=80, spc_bef_px=0, marL_px=0, marR_px=0, indent_px=0,
                                        lines=[runs])])
        sp = etree.SubElement(tree, P + 'sp')
        nv = etree.SubElement(sp, P + 'nvSpPr')
        etree.SubElement(nv, P + 'cNvPr', id=str(nid), name=f'case {nid}')
        etree.SubElement(nv, P + 'cNvSpPr', txBox='1')
        etree.SubElement(nv, P + 'nvPr')
        spr = etree.SubElement(sp, P + 'spPr')
        xf = etree.SubElement(spr, A + 'xfrm')
        etree.SubElement(xf, A + 'off', x=str(x * 6350), y=str(y * 6350))
        etree.SubElement(xf, A + 'ext', cx=str(w * 6350), cy=str(h * 6350))
        g = etree.SubElement(spr, A + 'prstGeom', prst='rect')
        etree.SubElement(g, A + 'avLst')
        etree.SubElement(spr, A + 'noFill')
        sp.append(tx_body(NS_P, plan, RunCtx(lang='ru-RU')))
        boxes.append((label, y))
        y += h
    F.embed_fonts(prs, HERE.parent.parent / 'design' / 'fonts')
    pptx = out / 'spacing.pptx'
    prs.save(str(pptx))
    prof = tempfile.mkdtemp()
    subprocess.run([os.environ['SOFFICE'], f'-env:UserInstallation=file://{prof}', '--headless', '--norestore',
                    '--convert-to', 'pdf', '--outdir', str(out), str(pptx)],
                   env={**os.environ, 'SAL_USE_VCLPLUGIN': 'svp'}, check=True, capture_output=True)
    subprocess.run(['pdftoppm', '-png', '-r', '288', '-singlefile', str(out / 'spacing.pdf'), str(out / 'spacing')],
                   check=True)
    img = np.asarray(Image.open(out / 'spacing.png').convert('L'))
    scale = img.shape[1] / 1920
    for label, top in boxes:
        # only the band between cap top and baseline (baseline at 80 - 0.2 * 72 = 65.6 px), so the descenders of the
        # line above and the accents of this one stay out
        reg = img[int((top + 16) * scale):int((top + 64) * scale), int(x * scale):int((x + w) * scale)] < 128
        cols = np.where(reg.any(axis=0))[0]
        print(f'{label:<36} ink {cols[0] / scale:7.2f} .. {(cols[-1] + 1) / scale:8.2f} px, '
              f'width {(cols[-1] - cols[0] + 1) / scale:8.2f}')


if __name__ == '__main__':
    main(Path(sys.argv[1]))
