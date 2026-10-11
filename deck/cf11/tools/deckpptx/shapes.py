"""Native shapes: CSS box (border-radius, background, border) -> DrawingML geometry, fill and outline.

Geometry choice (radii come from extract_page.js after the CSS overlapping-curves scaling):
  every corner 0                         -> rect
  every corner = half width / half height -> ellipse   (contract: border-radius: 50%)
  four equal circular corners            -> roundRect, adj = r / min(w, h)
  top pair equal, bottom pair equal      -> round2SameRect (adj1 = top, adj2 = bottom)
  anything else                          -> custGeom path with arcs
A CSS border is drawn inside the box, a DrawingML outline is centred on the path, so a bordered shape is inset by
half the border width (radii too): the stroke then covers exactly the CSS border area.

A CSS box-shadow (its most visible outer layer, chosen by extract_page.js) becomes <a:effectLst><a:outerShdw>, so
the shadow travels and scales with the object under Morph: dist/dir from the offset, the spread as a scale about the
centre (sx = (w + 2 spread) / w), the colour with its alpha, blurRad = SHADOW_BLUR_K x the CSS blur radius
(research/calibrate_shadow.py: the factor that matches LibreOffice 26.8 best; PowerPoint's blur is not measured).
LibreOffice scales the shadow after blurring it, so a strong negative spread on a small box (sy far below 100 %)
comes out tighter than the CSS one; compare.py flags such a shadow and data-shadow="bake" bakes it instead.
"""
from __future__ import annotations

import math

from lxml import etree

from .dml import color_el
from .units import emu

NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
A = f'{{{NS_A}}}'
EPS = 0.5
K45 = 0.29289   # 1 - cos 45deg: how far the preset text rectangles sit inside a rounded corner
SHADOW_BLUR_K = 1.1


def text_rect_insets(w: float, h: float, radii) -> tuple[float, float, float, float]:
    """Insets (l, t, r, b px) of the text rectangle a preset geometry defines inside its bounds (ECMA-376
    presetShapeDefinitions.xml: roundRect il = x1 * 29289 / 100000, ellipse il = wd2 - cos(45) * wd2, round2SameRect
    t = tdx, b = bdx, l = r = the larger of the two). PowerPoint and LibreOffice lay text out inside that rectangle."""
    kind, adj = classify(w, h, radii)
    ss = min(w, h)
    if kind == 'roundRect':
        i = ss * adj['adj'] / 100000 * K45
        return i, i, i, i
    if kind == 'ellipse':
        return w / 2 * K45, h / 2 * K45, w / 2 * K45, h / 2 * K45
    if kind == 'round2SameRect':
        tdx = ss * adj['adj1'] / 100000 * K45
        bdx = ss * adj['adj2'] / 100000 * K45
        side = tdx if adj['adj1'] > adj['adj2'] else bdx
        return side, tdx, side, bdx
    return 0.0, 0.0, 0.0, 0.0


def classify(w: float, h: float, radii) -> tuple[str, dict]:
    """Return (preset or 'custom', adjust values {name: 1/100000 units}) for a w x h box."""
    r = [(max(0.0, rx), max(0.0, ry)) for rx, ry in radii]
    if all(rx < 0.25 and ry < 0.25 for rx, ry in r):
        return 'rect', {}
    if all(rx >= w / 2 - EPS and ry >= h / 2 - EPS for rx, ry in r):
        return 'ellipse', {}
    ss = max(1e-6, min(w, h))
    circular = all(abs(rx - ry) < EPS for rx, ry in r)
    if circular and all(abs(rx - r[0][0]) < EPS for rx, _ in r):
        return 'roundRect', {'adj': min(50000, int(round(r[0][0] / ss * 100000)))}
    tl, tr, br, bl = r
    if circular and abs(tl[0] - tr[0]) < EPS and abs(bl[0] - br[0]) < EPS:
        return 'round2SameRect', {'adj1': min(50000, int(round(tl[0] / ss * 100000))),
                                  'adj2': min(50000, int(round(bl[0] / ss * 100000)))}
    return 'custom', {}


def custom_geometry(w_emu: int, h_emu: int, radii_emu):
    """<a:custGeom> rounded rectangle with independent elliptical corners (tl, tr, br, bl as (rx, ry) EMU)."""
    (tlx, tly), (trx, try_), (brx, bry), (blx, bly) = radii_emu
    g = etree.Element(A + 'custGeom')
    for t in ('avLst', 'gdLst', 'ahLst', 'cxnLst'):
        etree.SubElement(g, A + t)
    etree.SubElement(g, A + 'rect', l='l', t='t', r='r', b='b')
    pl = etree.SubElement(g, A + 'pathLst')
    path = etree.SubElement(pl, A + 'path', w=str(w_emu), h=str(h_emu))

    def pt(parent_tag, x, y):
        e = etree.SubElement(path, A + parent_tag)
        etree.SubElement(e, A + 'pt', x=str(int(round(x))), y=str(int(round(y))))

    def arc(rx, ry, st):
        if rx > 0 and ry > 0:
            etree.SubElement(path, A + 'arcTo', wR=str(int(round(rx))), hR=str(int(round(ry))),
                             stAng=str(st * 60000), swAng=str(90 * 60000))

    pt('moveTo', tlx, 0)
    pt('lnTo', w_emu - trx, 0)
    arc(trx, try_, 270)
    pt('lnTo', w_emu, h_emu - bry)
    arc(brx, bry, 0)
    pt('lnTo', blx, h_emu)
    arc(blx, bly, 90)
    pt('lnTo', 0, tly)
    arc(tlx, tly, 180)
    etree.SubElement(path, A + 'close')
    return g


def geometry_el(w: float, h: float, radii):
    """Geometry element for a w x h px box (prstGeom with avLst, or custGeom)."""
    kind, adj = classify(w, h, radii)
    if kind == 'custom':
        return custom_geometry(emu(w), emu(h), [(emu(rx), emu(ry)) for rx, ry in radii]), kind
    g = etree.Element(A + 'prstGeom', prst=kind)
    av = etree.SubElement(g, A + 'avLst')
    for name, val in adj.items():
        etree.SubElement(av, A + 'gd', name=name, fmla=f'val {val}')
    return g, kind


DASH = {'dashed': 'dash', 'dotted': 'sysDot'}


def line_el(line: dict | None, opacity: float, sharp: bool):
    ln = etree.Element(A + 'ln')
    if not line:
        etree.SubElement(ln, A + 'noFill')
        return ln
    ln.set('w', str(emu(line['w'])))
    if line.get('dash') == 'double':
        ln.set('cmpd', 'dbl')
    ln.append(color_el('solidFill', line['color'], opacity))
    if line.get('dash') in DASH:
        etree.SubElement(ln, A + 'prstDash', val=DASH[line['dash']])
    if sharp:
        etree.SubElement(ln, A + 'miter', lim='800000')
    else:
        etree.SubElement(ln, A + 'round')
    return ln


def box_geometry(box: dict, style: dict) -> tuple[dict, list, dict | None]:
    """(box, radii, line) after insetting by half the outline width, so the stroke covers the CSS border."""
    line = style.get('line') if style.get('lineUniform') else None
    radii = [list(r) for r in style.get('radii') or [[0, 0]] * 4]
    if not line:
        return dict(box), radii, None
    half = line['w'] / 2
    b = {'x': box['x'] + half, 'y': box['y'] + half, 'w': max(1.0, box['w'] - line['w']), 'h': max(1.0, box['h'] - line['w'])}
    radii = [[max(0.0, rx - half), max(0.0, ry - half)] for rx, ry in radii]
    return b, radii, line


def shadow_el(shadow: dict | None, w: float, h: float, opacity: float = 1.0):
    """<a:effectLst><a:outerShdw .../></a:effectLst> for one CSS box-shadow layer {dx, dy, blur, spread, color}
    (slide px) of a w x h px object, or None when it draws nothing. algn="ctr" scales about the centre, as a CSS
    spread grows or shrinks the shadow on every side; rotWithShape="1": a CSS shadow turns with its element."""
    if not shadow or not shadow.get('color') or w <= 0 or h <= 0:
        return None
    spread = shadow.get('spread') or 0.0
    sx, sy = (w + 2 * spread) / w, (h + 2 * spread) / h
    alpha = shadow['color'].get('alpha', 1.0) * opacity
    if sx <= 0.001 or sy <= 0.001 or alpha <= 0.002:
        return None
    dx, dy = shadow.get('dx') or 0.0, shadow.get('dy') or 0.0
    eff = etree.Element(A + 'effectLst')
    sh = etree.SubElement(eff, A + 'outerShdw', blurRad=str(emu(max(0.0, shadow.get('blur') or 0.0) * SHADOW_BLUR_K)))
    dist = math.hypot(dx, dy)
    if dist > 0.01:
        sh.set('dist', str(emu(dist)))
        sh.set('dir', str(int(round((math.degrees(math.atan2(dy, dx)) % 360.0) * 60000)) % 21600000))
    if abs(sx - 1) > 1e-5 or abs(sy - 1) > 1e-5:
        # both, always: LibreOffice 26.8 ignores sy when sx is absent (research/calibrate_shadow.py)
        sh.set('sx', str(int(round(sx * 100000))))
        sh.set('sy', str(int(round(sy * 100000))))
    sh.set('algn', 'ctr')
    sh.set('rotWithShape', '1')
    sh.append(color_el('solidFill', shadow['color'], opacity)[0])
    return eff


def sp_pr(box: dict, style: dict | None, opacity: float, rot: float = 0.0, fill_override=None, shadow=None):
    """<p:spPr> with xfrm, geometry, fill, outline and (shadow = a CSS box-shadow layer) an outer shadow for an
    element box (slide px)."""
    from .units import angle
    style = style or {}
    b, radii, line = box_geometry(box, style)
    sp = etree.Element('{http://schemas.openxmlformats.org/presentationml/2006/main}spPr')
    xfrm = etree.SubElement(sp, A + 'xfrm')
    if rot:
        xfrm.set('rot', str(angle(rot)))
    etree.SubElement(xfrm, A + 'off', x=str(emu(b['x'])), y=str(emu(b['y'])))
    etree.SubElement(xfrm, A + 'ext', cx=str(max(1, emu(b['w']))), cy=str(max(1, emu(b['h']))))
    geom, kind = geometry_el(b['w'], b['h'], radii)
    sp.append(geom)
    fill = fill_override if fill_override is not None else style.get('fill')
    sp.append(color_el('solidFill', fill, opacity))
    sp.append(line_el(line, opacity, sharp=(kind == 'rect')))
    eff = shadow_el(shadow, box['w'], box['h'], opacity)     # the silhouette: fill + outline = the CSS border box
    if eff is not None:
        sp.append(eff)
    return sp, kind
