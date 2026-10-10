"""Pictures (PNG renders, image files, GIF) and the crop/placement maths shared with video.

Placement: the full image is laid out the way CSS object-fit/object-position does it, then the visible part is
the intersection with the element box and with any clipping ancestor (overflow != visible). The picture frame is
that visible rectangle and a:srcRect crops the image to it, so nothing is distorted or drawn outside the clip.
"""
from __future__ import annotations

import subprocess
from pathlib import Path

from lxml import etree

from .units import angle, emu

NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
A, P, R = f'{{{NS_A}}}', f'{{{NS_P}}}', f'{{{NS_R}}}'
SVG_BLIP_EXT = '{96DAC541-7B7A-43D3-8B79-37D633B846F1}'     # as LibreOffice writes it (oox/source/export/drawingml.cxx)
NS_ASVG = 'http://schemas.microsoft.com/office/drawing/2016/SVG/main'
DECORATIVE_EXT = '{C183D7F6-B498-43B3-948B-1728B52AA6E4}'    # [MS-ODRAWXML] 2.34 decorative (oox/source/export/shapes.cxx)
NS_ADEC = 'http://schemas.microsoft.com/office/drawing/2017/decorative'


def _pos_frac(token: str, free: float) -> tuple[float, float]:
    """object-position component -> (fraction, absolute px offset)."""
    token = token.strip()
    named = {'left': 0.0, 'top': 0.0, 'center': 0.5, 'right': 1.0, 'bottom': 1.0}
    if token in named:
        return named[token], 0.0
    if token.endswith('%'):
        return float(token[:-1]) / 100.0, 0.0
    if token.endswith('px'):
        return 0.0, float(token[:-2])
    return 0.5, 0.0


def intersect(a: dict, b: dict) -> dict:
    x1, y1 = max(a['x'], b['x']), max(a['y'], b['y'])
    x2, y2 = min(a['x'] + a['w'], b['x'] + b['w']), min(a['y'] + a['h'], b['y'] + b['h'])
    return {'x': x1, 'y': y1, 'w': max(0.0, x2 - x1), 'h': max(0.0, y2 - y1)}


def placement(box: dict, natural: tuple[int, int] | None, fit: str | None, position: str | None,
              clip: dict | None) -> tuple[dict, dict | None]:
    """(visible frame in slide px, srcRect fractions {l,t,r,b} or None)."""
    bw, bh = box['w'], box['h']
    fit = (fit or 'fill').strip()
    if natural and natural[0] > 0 and natural[1] > 0 and fit in ('cover', 'contain', 'scale-down', 'none'):
        iw, ih = natural
        if fit == 'cover':
            s = max(bw / iw, bh / ih)
        elif fit == 'contain':
            s = min(bw / iw, bh / ih)
        elif fit == 'scale-down':
            s = min(1.0, bw / iw, bh / ih)
        else:
            s = 1.0
        dw, dh = iw * s, ih * s
        parts = (position or '50% 50%').split()
        fx, ax = _pos_frac(parts[0], bw - dw)
        fy, ay = _pos_frac(parts[1] if len(parts) > 1 else '50%', bh - dh)
        img = {'x': box['x'] + (bw - dw) * fx + ax, 'y': box['y'] + (bh - dh) * fy + ay, 'w': dw, 'h': dh}
        vis = intersect(img, box)
    else:
        img, vis = dict(box), dict(box)
    if clip:
        vis = intersect(vis, clip)
    if vis['w'] <= 0 or vis['h'] <= 0:
        return dict(box), None
    crop = {'l': (vis['x'] - img['x']) / img['w'], 't': (vis['y'] - img['y']) / img['h'],
            'r': (img['x'] + img['w'] - vis['x'] - vis['w']) / img['w'],
            'b': (img['y'] + img['h'] - vis['y'] - vis['h']) / img['h']}
    if all(abs(v) < 0.0005 for v in crop.values()):
        crop = None
    return vis, crop


def probe_media(path: Path) -> dict:
    """Width, height and duration (ms) of a video or GIF via ffprobe."""
    out = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
                          'stream=width,height,duration:format=duration', '-of', 'default=nw=1', str(path)],
                         capture_output=True, text=True, check=True).stdout
    info = {}
    for line in out.splitlines():
        if '=' in line:
            k, v = line.split('=', 1)
            if v not in ('N/A', ''):
                info.setdefault(k, v)
    dur = float(info.get('duration', 0) or 0)
    return {'w': int(info.get('width', 0)), 'h': int(info.get('height', 0)), 'durMs': int(round(dur * 1000))}


def first_frame(video: Path, dest: Path) -> Path:
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(video), '-frames:v', '1', str(dest)], check=True)
    return dest


# H.264 settings of the deck's clips (research/REPORT: BT.709-tagged, yuv420p, faststart, no audio)
X264 = ['-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-profile:v', 'high', '-level:v', '4.0', '-pix_fmt', 'yuv420p',
        '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
        '-movflags', '+faststart', '-an']


def crop_video(src: Path, poster: Path, crop: dict, size: tuple[int, int], cache: Path) -> tuple[Path, Path, str]:
    """Re-encode the visible part of a clip (and crop its poster) instead of relying on a:srcRect, which
    LibreOffice ignores for video. Cached by source, mtime and crop. Returns (video, poster, crop filter)."""
    import hashlib

    from PIL import Image
    iw, ih = size
    cw = max(2, int(round(iw * (1 - crop['l'] - crop['r']) / 2)) * 2)
    ch = max(2, int(round(ih * (1 - crop['t'] - crop['b']) / 2)) * 2)
    cx = min(iw - cw, max(0, int(round(iw * crop['l']))))
    cy = min(ih - ch, max(0, int(round(ih * crop['t']))))
    flt = f'crop={cw}:{ch}:{cx}:{cy}'
    st = src.stat()
    key = hashlib.sha1(f'{src.resolve()}|{st.st_mtime_ns}|{st.st_size}|{flt}'.encode()).hexdigest()[:12]
    cache.mkdir(parents=True, exist_ok=True)
    out = cache / f'{src.stem}-{key}.mp4'
    if not out.exists():
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(src), '-vf', flt, *X264, str(out)], check=True)
    pout = cache / f'{src.stem}-{key}-poster.png'
    if not pout.exists():
        with Image.open(poster) as im:
            pw, ph = im.size
            box = (round(pw * cx / iw), round(ph * cy / ih), round(pw * (cx + cw) / iw), round(ph * (cy + ch) / ih))
            im.crop(box).save(pout)
    return out, pout, flt


def c_nv_pr(spid: int, name: str, descr: str | None, hlink_rid: str | None, decorative: bool = False):
    c = etree.Element(P + 'cNvPr', id=str(spid), name=name)
    if descr:
        c.set('descr', descr)
    if hlink_rid:
        h = etree.SubElement(c, A + 'hlinkClick')
        h.set(R + 'id', hlink_rid)
    if decorative:
        lst = etree.SubElement(c, A + 'extLst')
        ext = etree.SubElement(lst, A + 'ext', uri=DECORATIVE_EXT)
        etree.SubElement(ext, f'{{{NS_ADEC}}}decorative', nsmap={'adec': NS_ADEC}, val='1')
    return c


def xfrm(parent, frame: dict, rot: float = 0.0):
    x = etree.SubElement(parent, A + 'xfrm')
    if rot:
        x.set('rot', str(angle(rot)))
    etree.SubElement(x, A + 'off', x=str(emu(frame['x'])), y=str(emu(frame['y'])))
    etree.SubElement(x, A + 'ext', cx=str(max(1, emu(frame['w']))), cy=str(max(1, emu(frame['h']))))
    return x


def src_rect_el(crop: dict):
    return etree.Element(A + 'srcRect', **{k: str(int(round(v * 100000))) for k, v in crop.items() if abs(v) >= 0.0005})


def pic_el(spid: int, name: str, rid: str, frame: dict, *, descr=None, hlink_rid=None, decorative=False, rot=0.0,
           crop=None, geom=None, alpha=1.0, svg_rid=None):
    """<p:pic> for an embedded image part `rid`; geom = prstGeom/custGeom element (default rect)."""
    pic = etree.Element(P + 'pic')
    nv = etree.SubElement(pic, P + 'nvPicPr')
    nv.append(c_nv_pr(spid, name, descr, hlink_rid, decorative))
    cp = etree.SubElement(nv, P + 'cNvPicPr')
    etree.SubElement(cp, A + 'picLocks', noChangeAspect='1')
    etree.SubElement(nv, P + 'nvPr')
    bf = etree.SubElement(pic, P + 'blipFill')
    blip = etree.SubElement(bf, A + 'blip')
    blip.set(R + 'embed', rid)
    if alpha < 0.9995:
        etree.SubElement(blip, A + 'alphaModFix', amt=str(int(round(max(0.0, alpha) * 100000))))
    if svg_rid:
        lst = etree.SubElement(blip, A + 'extLst')
        ext = etree.SubElement(lst, A + 'ext', uri=SVG_BLIP_EXT)
        sb = etree.SubElement(ext, f'{{{NS_ASVG}}}svgBlip', nsmap={'asvg': NS_ASVG})
        sb.set(R + 'embed', svg_rid)
    if crop:
        bf.append(src_rect_el(crop))
    st = etree.SubElement(bf, A + 'stretch')
    etree.SubElement(st, A + 'fillRect')
    sp = etree.SubElement(pic, P + 'spPr')
    xfrm(sp, frame, rot)
    if geom is None:
        geom = etree.Element(A + 'prstGeom', prst='rect')
        etree.SubElement(geom, A + 'avLst')
    sp.append(geom)
    return pic
