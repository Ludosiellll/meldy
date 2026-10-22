#!/usr/bin/env python3
"""slides.json (extract.mjs) -> PowerPoint.

    python build.py [--build ../out/build] [--out ../out/meldy-codingfest11.pptx] [--fonts ../design/fonts]
                    [--title "Meldy — CodingFest-11"] [--embed all|used|none]

Per slide: the background picture full-bleed at the bottom ("!!bg", marked decorative), then every marked element
in DOM order - live text (title placeholder or text box), native shapes, pictures, GIF, video - with the 2x
under/over layers next to their element; entrance animations, media autoplay/loop, the transition and the notes.
Then the Onest faces are embedded and the package metadata is set (no personal data). See README.md.

Bleed: a picture, GIF or layer that crosses the slide edge is cropped to the slide (a:srcRect), a video is
re-encoded to its visible part (warned); a native shape or live text that crosses the edge is an ERROR (PowerPoint's
Normal view shows the outside part on the pasteboard) and the build fails. Next to the PPTX the build writes
<name>.objects.json: for every PPTX object (slide, shape id, name) the element and layer it came from - the motion
preview (tools/preview) reads the PPTX and takes the pixels of live text from extract's text layers through it.
"""
from __future__ import annotations

import argparse
import io
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from lxml import etree
from PIL import Image
from pptx.opc.constants import RELATIONSHIP_TYPE as RT
from pptx.opc.package import Part
from pptx.opc.packuri import PackURI

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from deckpptx import fonts as F                      # noqa: E402
from deckpptx.pictures import (crop_video, first_frame, intersect, pic_el, placement, probe_media,  # noqa: E402
                               src_rect_el, xfrm as xfrm_el)
from deckpptx.morph import LAYER_SUFFIX              # noqa: E402
from deckpptx.shapes import geometry_el, shadow_el, sp_pr   # noqa: E402
from deckpptx.template import app_properties_xml, new_presentation   # noqa: E402
from deckpptx.text import RunCtx, ooxml_lang, plan_text, tx_body     # noqa: E402
from deckpptx.timing import Effect, Media, Target, build_timing      # noqa: E402
from deckpptx.transitions import set_transition      # noqa: E402
from deckpptx.units import emu                        # noqa: E402

NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
A, P, R = f'{{{NS_A}}}', f'{{{NS_P}}}', f'{{{NS_R}}}'
DECK = HERE.parent
TYPE_LABEL = {'title': 'Title', 'text': 'Text', 'shape': 'Shape', 'image': 'Picture', 'video': 'Video', 'gif': 'GIF'}
SLIDE_RECT = {'x': 0.0, 'y': 0.0, 'w': 1920.0, 'h': 1080.0}
EDGE_TOL = 0.5      # px a native object may overhang the slide edge (sub-pixel rounding)


def objects_path(pptx: Path) -> Path:
    """The sidecar of a built PPTX: deck.pptx -> deck.objects.json."""
    return Path(pptx).with_suffix('.objects.json')


def overhang(r: dict) -> dict:
    """px by which a rectangle sticks out of the slide on each side (only the sides that do)."""
    o = {'left': -r['x'], 'top': -r['y'], 'right': r['x'] + r['w'] - SLIDE_RECT['w'],
         'bottom': r['y'] + r['h'] - SLIDE_RECT['h']}
    return {k: round(v, 1) for k, v in o.items() if v > EDGE_TOL}


def crop_to_slide(frame: dict, crop: dict | None) -> tuple[dict, dict | None]:
    """Intersect a picture frame with the slide; compose the cut with the picture's existing srcRect."""
    if not overhang(frame):
        return frame, crop
    c = crop or {'l': 0.0, 't': 0.0, 'r': 0.0, 'b': 0.0}
    iw = frame['w'] / max(1e-9, 1.0 - c['l'] - c['r'])       # the whole image, in slide px
    ih = frame['h'] / max(1e-9, 1.0 - c['t'] - c['b'])
    ix, iy = frame['x'] - c['l'] * iw, frame['y'] - c['t'] * ih
    x1, y1 = max(frame['x'], 0.0), max(frame['y'], 0.0)
    x2, y2 = min(frame['x'] + frame['w'], SLIDE_RECT['w']), min(frame['y'] + frame['h'], SLIDE_RECT['h'])
    if x2 <= x1 or y2 <= y1:
        return frame, crop                                   # wholly outside: left to the caller's warning
    vis = {'x': x1, 'y': y1, 'w': x2 - x1, 'h': y2 - y1}
    return vis, {'l': (x1 - ix) / iw, 't': (y1 - iy) / ih, 'r': (ix + iw - x2) / iw, 'b': (iy + ih - y2) / ih}


def shadow_extent(e: dict, rect: dict | None = None) -> dict | None:
    """Where an element's native shadow visibly reaches (1.5 sigma of the blur beyond its spread box), slide px."""
    sh = (e.get('style') or {}).get('shadowNative')
    if not sh:
        return None
    b = rect or e['bbox']
    g = 0.75 * sh['blur'] + sh['spread']
    return {'x': b['x'] + sh['dx'] - g, 'y': b['y'] + sh['dy'] - g, 'w': b['w'] + 2 * g, 'h': b['h'] + 2 * g}


def text_extent(e: dict) -> dict:
    """The rectangle the glyphs of a live text element occupy (line boxes), in slide px."""
    x1 = y1 = float('inf')
    x2 = y2 = float('-inf')
    for p in e['text']['paragraphs']:
        for ln in p['lines']:
            asc = max((r.get('ascPx', r['sizePx']) for r in ln['runs']), default=0)
            desc = max((r.get('descPx', 0.25 * r['sizePx']) for r in ln['runs']), default=0)
            x1, x2 = min(x1, ln['left']), max(x2, ln['right'])
            y1, y2 = min(y1, ln['baseline'] - asc), max(y2, ln['baseline'] + desc)
    if x1 == float('inf'):
        return dict(e['bbox'])
    return {'x': x1, 'y': y1, 'w': x2 - x1, 'h': y2 - y1}
MANDATORY = ['Титульный', 'Автор проекта', 'Актуальность', 'Цель, задачи', 'Новизна и инновационность', 'Содержание',
             'Представление блоков проекта', 'Используемые источники', 'Технические требования', 'Заключение']


class SlideBuilder:
    def __init__(self, prs, slide, sdata: dict, build_dir: Path, log: list):
        self.prs, self.slide, self.s, self.dir, self.log = prs, slide, sdata, build_dir, log
        self.tree = slide.shapes._spTree
        self.names: set[str] = set()
        self.links: dict[str, str] = {}
        self.effects: list[tuple[tuple, Effect]] = []
        self.media: list[Media] = []
        self.lang = ooxml_lang(sdata.get('lang'))
        self.title_text = None
        self.nn = sdata['nn']
        self.errors: list[str] = []
        self.objects: list[dict] = []          # objects.json: shape id -> element / layer it was built from
        # the layout's title placeholder is re-created where the title element sits in the DOM order
        for sp in list(self.tree.iterchildren(P + 'sp')):
            self.tree.remove(sp)

    # ------------------------------------------------------------------ helpers
    def warn(self, msg: str):
        self.log.append(f'{self.s["file"]}: {msg}')

    def error(self, msg: str):
        self.errors.append(f'{self.s["file"]}: {msg}')

    def record(self, spid: int, name: str, role: str, e: dict | None = None, **extra):
        self.objects.append({'spid': spid, 'name': name, 'role': role, 'element': e['id'] if e else None,
                             'elementName': e.get('name') if e else None, **extra})

    def check_edge(self, e: dict, what: str, rect: dict):
        o = overhang(rect)
        if o:
            sides = ', '.join(f'{k} {v:g} px' for k, v in o.items())
            self.error(f'{e["id"]} {e.get("name") or ""} {what} crosses the slide edge ({sides}): PowerPoint shows the '
                       f'part outside the slide on the pasteboard in Normal view. Keep it inside the slide, or mark it '
                       f'data-pptx="image" so it is cropped')

    def check_shadow_edge(self, e: dict, rect: dict | None = None):
        r = shadow_extent(e, rect)
        o = overhang(r) if r else None
        if o:
            sides = ', '.join(f'{k} {v:g} px' for k, v in o.items())
            self.warn(f'{e["id"]} {e.get("name") or ""} native shadow reaches past the slide edge ({sides}): in Normal '
                      f'view PowerPoint is expected to show that part on the pasteboard (the show clips it); '
                      f'data-shadow="bake" bakes it into the slide instead')

    def next_id(self) -> int:
        ids = [int(c.get('id')) for c in self.tree.iter(P + 'cNvPr')]
        return max(ids + [1]) + 1

    def unique(self, name: str) -> str:
        base, n = name, 2
        while name in self.names:
            name = f'{base} ({n})'
            n += 1
        self.names.add(name)
        return name

    def name_for(self, e: dict, suffix: str = '') -> str:
        if e.get('name'):
            base = e['name']
        else:
            base = f'{TYPE_LABEL[e["type"]]} {self.nn}.{e["domIndex"] + 1:02d}'
        return self.unique(base + suffix)

    def link(self, url: str) -> str:
        if url not in self.links:
            self.links[url] = self.slide.part.relate_to(url, RT.HYPERLINK, is_external=True)
        return self.links[url]

    def image(self, path: Path) -> str:
        _, rid = self.slide.part.get_or_add_image_part(str(path))
        return rid

    def optimized(self, path: Path) -> Path:
        """Smaller copy of a PNG placed from a file (poster, screenshot): PNG8 when it shows no banding."""
        path = Path(path)
        if path.suffix.lower() != '.png':
            return path
        import hashlib

        from imgopt import best_png
        st = path.stat()
        key = hashlib.sha1(f'{path.resolve()}|{st.st_mtime_ns}|{st.st_size}'.encode()).hexdigest()[:12]
        out = self.dir / 'opt' / f'{path.stem}-{key}.png'
        if not out.exists():
            out.parent.mkdir(parents=True, exist_ok=True)
            with Image.open(path) as im:
                has_alpha = im.mode in ('RGBA', 'LA', 'PA') or 'transparency' in im.info
                data, _, _ = best_png(im.convert('RGBA' if has_alpha else 'RGB'))
            out.write_bytes(data if len(data) < st.st_size else path.read_bytes())
        return out

    def svg(self, path: Path) -> str:
        pkg = self.prs.part.package
        part = Part(pkg.next_image_partname('svg'), 'image/svg+xml', pkg, Path(path).read_bytes())
        return self.slide.part.relate_to(part, RT.IMAGE)

    def add(self, el):
        self.tree.append(el)
        return el

    def animate(self, e: dict, main: Target, companions: list[Target]):
        a = e.get('anim')
        if not a:
            return None
        eff = Effect(target=main, effect=a['effect'], trigger=a['trigger'], delay_ms=a['delayMs'], dur_ms=a['durMs'],
                     companions=companions, direction=a.get('dir') or 'left')
        key = (a['order'] if a.get('order') is not None else e['domIndex'], e['domIndex'])
        self.effects.append((key, eff))
        return eff

    # ------------------------------------------------------------------ objects
    def background(self):
        path = self.dir / self.s['background']
        rid = self.image(path)
        spid, name = self.next_id(), self.unique('!!bg')
        pic = pic_el(spid, name, rid, {'x': 0, 'y': 0, 'w': 1920, 'h': 1080}, decorative=True)
        # bottom of the z-order: right after nvGrpSpPr/grpSpPr
        self.tree.insert(2, pic)
        self.record(spid, name, 'bg')

    def layer(self, e: dict, which: str) -> Target | None:
        r = e.get('render')
        if not r or r['mode'] != which:
            return None
        rid = self.image(self.dir / r['png'])
        spid = self.next_id()
        frame, crop = crop_to_slide(r['rect'], None)
        # a "!!" owner's layer is "!!owner·layer": it pairs with the owner's layer on the next slide and travels
        # with it under Morph (over- or under-layer alike); other owners' layers stay unique, as auto-match bait
        if (e.get('name') or '').startswith('!!'):
            name = self.unique(e['name'] + LAYER_SUFFIX)
        else:
            name = self.name_for(e, f':{which}')
        self.add(pic_el(spid, name, rid, frame, decorative=True, crop=crop))
        self.record(spid, name, which, e)
        return Target(spid)

    def text(self, e: dict, is_title: bool):
        under = self.layer(e, 'under')
        plan = plan_text(e, movable=True)
        for n in plan.notes:
            self.warn(f'{e["id"]} {n}')
        style = e.get('style') or {}
        visible_box = bool(style.get('fill') or (style.get('line') and style.get('lineUniform')))
        self.check_edge(e, 'text box' if visible_box or e.get('rot') else 'text',
                        e['bbox'] if visible_box or e.get('rot') else text_extent(e))
        spid = self.next_id()
        sp = etree.Element(P + 'sp')
        nv = etree.SubElement(sp, P + 'nvSpPr')
        name = (e.get('name') and self.unique(e['name'])) or (self.unique('!!title') if is_title else self.name_for(e))
        c = etree.SubElement(nv, P + 'cNvPr', id=str(spid), name=name)
        if e.get('alt'):
            c.set('descr', e['alt'])
        if e.get('href'):
            etree.SubElement(c, A + 'hlinkClick').set(R + 'id', self.link(e['href']))
        if is_title:
            cs = etree.SubElement(nv, P + 'cNvSpPr')
            etree.SubElement(cs, A + 'spLocks', noGrp='1')
            nvpr = etree.SubElement(nv, P + 'nvPr')
            etree.SubElement(nvpr, P + 'ph', type='title')
        else:
            etree.SubElement(nv, P + 'cNvSpPr', txBox='1')
            etree.SubElement(nv, P + 'nvPr')
        frame = {'x': plan.x, 'y': plan.y, 'w': plan.w, 'h': plan.h}
        if visible_box:
            spr, _ = sp_pr(e['box'], style, e.get('opacity', 1.0), e.get('rot', 0),   # same frame as plan_text
                           shadow=style.get('shadowNative'))
            self.check_shadow_edge(e)
        else:
            spr = etree.Element(P + 'spPr')
            xfrm_el(spr, frame, e.get('rot', 0))
            g = etree.SubElement(spr, A + 'prstGeom', prst='rect')
            etree.SubElement(g, A + 'avLst')
            etree.SubElement(spr, A + 'noFill')
            ln = etree.SubElement(spr, A + 'ln')
            etree.SubElement(ln, A + 'noFill')
        sp.append(spr)
        ctx = RunCtx(lang=self.lang, opacity=e.get('opacity', 1.0), caps_from_transform=is_title, link_rid=self.link)
        sp.append(tx_body(NS_P, plan, ctx))
        self.add(sp)
        if is_title:
            self.title_text = ''.join(r['raw'] for p in e['text']['paragraphs'] for ln in p['lines'] for r in ln['runs']).strip()
        self.record(spid, name, 'title' if is_title else 'text', e, textLayer=e.get('textLayer'))
        main = Target(spid, has_text=True, has_box=visible_box)
        self.animate(e, main, [under] if under else [])

    def shape(self, e: dict):
        self.check_edge(e, 'shape', e['bbox'])
        spid = self.next_id()
        sp = etree.Element(P + 'sp')
        nv = etree.SubElement(sp, P + 'nvSpPr')
        name = self.name_for(e)
        c = etree.SubElement(nv, P + 'cNvPr', id=str(spid), name=name)
        if e.get('alt'):
            c.set('descr', e['alt'])
        if e.get('href'):
            etree.SubElement(c, A + 'hlinkClick').set(R + 'id', self.link(e['href']))
        etree.SubElement(nv, P + 'cNvSpPr')
        etree.SubElement(nv, P + 'nvPr')
        spr, _ = sp_pr(e['box'], e.get('style'), e.get('opacity', 1.0), e.get('rot', 0),
                       shadow=(e.get('style') or {}).get('shadowNative'))
        self.check_shadow_edge(e)
        sp.append(spr)
        body = etree.SubElement(sp, P + 'txBody')
        etree.SubElement(body, A + 'bodyPr', rtlCol='0', anchor='ctr')
        etree.SubElement(body, A + 'lstStyle')
        p = etree.SubElement(body, A + 'p')
        etree.SubElement(p, A + 'endParaRPr', lang=self.lang, dirty='0')
        self.add(sp)
        self.record(spid, name, 'shape', e)
        over = self.layer(e, 'over')
        self.animate(e, Target(spid, has_text=False, has_box=True), [over] if over else [])

    def picture(self, e: dict):
        r = e.get('render')
        href = self.link(e['href']) if e.get('href') else None
        spid = self.next_id()
        name = self.name_for(e)
        if r and r['mode'] == 'image':
            rid = self.image(self.dir / r['png'])
            frame, crop = crop_to_slide(r['rect'], None)
            self.add(pic_el(spid, name, rid, frame, descr=e.get('alt'), hlink_rid=href, crop=crop))
        elif r and r['mode'] == 'svg':
            rid = self.image(self.dir / r['png'])
            svg_rid = self.svg(self.dir / r['svg'])
            frame, crop = crop_to_slide(r['rect'], None)
            pic = self.add(pic_el(spid, name, rid, frame, descr=e.get('alt'), hlink_rid=href, svg_rid=svg_rid,
                                  alpha=e.get('opacity', 1.0), crop=crop))
            self.shadow(pic, e, frame)
        else:
            src = Path(e['src']['path'])
            with Image.open(src) as im:
                natural = im.size
            frame, crop, geom = self.media_frame(e, natural)
            rid = self.image(self.optimized(src) if e['type'] == 'image' else src)   # a GIF stays as authored
            pic = self.add(pic_el(spid, name, rid, frame, descr=e.get('alt'), hlink_rid=href, rot=e.get('rot', 0),
                                  crop=crop, geom=geom, alpha=e.get('opacity', 1.0)))
            self.shadow(pic, e, frame)
        self.record(spid, name, e['type'] if e['type'] == 'gif' else (r['mode'] if r else 'image'), e)
        self.animate(e, Target(spid), [])

    def shadow(self, pic, e: dict, frame: dict):
        """A placed file's native outer shadow (box-shadow), sized to the picture frame it is drawn from."""
        eff = shadow_el((e.get('style') or {}).get('shadowNative'), frame['w'], frame['h'], e.get('opacity', 1.0))
        if eff is not None:
            pic.find(f'{P}spPr').append(eff)
            self.check_shadow_edge(e, frame)
        return pic

    def media_frame(self, e: dict, natural):
        """Visible frame, srcRect and corner geometry for a file placed in an element box (object-fit, clipping,
        the slide edge)."""
        src = e.get('src') or {}
        clip = e.get('clip') if e.get('clipped') or e.get('clip') else None
        clip = intersect(clip, SLIDE_RECT) if clip else dict(SLIDE_RECT)
        frame, crop = placement(e['box'], natural, src.get('fit'), src.get('position'), clip)
        radii = [list(r) for r in ((e.get('style') or {}).get('radii') or [[0, 0]] * 4)]
        cr = e.get('clipRadius')
        if cr and cr.get('px', 0) > 0:
            b = cr['box']
            if abs(b['x'] - frame['x']) < 2 and abs(b['y'] - frame['y']) < 2 and abs(b['w'] - frame['w']) < 2 and abs(b['h'] - frame['h']) < 2:
                radii = [[cr['px'], cr['px']]] * 4
        # a side cut by the slide edge is straight: its rounded corners are outside the slide
        cut = overhang(e['box'])
        for side, corners in (('left', (0, 3)), ('top', (0, 1)), ('right', (1, 2)), ('bottom', (2, 3))):
            if side in cut:
                for k in corners:
                    radii[k] = [0, 0]
        geom, _ = geometry_el(frame['w'], frame['h'], radii)
        return frame, crop, geom

    def video(self, e: dict):
        src = Path(e['src']['path'])
        info = probe_media(src)
        poster = e['src'].get('poster')
        if not poster:
            poster = first_frame(src, self.dir / f'img/{self.nn}/{e["id"]}-poster.png')
            self.warn(f'{e["id"]}: poster taken from frame 0')
        frame, crop, geom = self.media_frame(e, (info['w'], info['h']))
        if crop:
            src, poster, flt = crop_video(src, Path(poster), crop, (info['w'], info['h']), self.dir / 'media')
            why = ('its box crosses the slide edge' if overhang(e['bbox'])
                   else 'clip aspect differs from its box')
            self.warn(f'{e["id"]}: {why}; re-encoded the visible part ({flt}). '
                      f'Render the clip at {round(frame["w"])}x{round(frame["h"])} (or that aspect) to avoid it')
            crop = None
        mv = self.slide.shapes.add_movie(str(src), emu(frame['x']), emu(frame['y']), emu(frame['w']), emu(frame['h']),
                                         poster_frame_image=str(self.optimized(Path(poster))), mime_type='video/mp4')
        pic = mv._element
        spid = int(pic.find(f'{P}nvPicPr/{P}cNvPr').get('id'))
        c = pic.find(f'{P}nvPicPr/{P}cNvPr')
        name = self.name_for(e)
        c.set('name', name)
        self.record(spid, name, 'video', e)
        if e.get('alt'):
            c.set('descr', e['alt'])
        if crop:
            bf = pic.find(f'{P}blipFill')
            bf.insert(1, src_rect_el(crop))
        spr = pic.find(f'{P}spPr')
        old = spr.find(f'{A}prstGeom')
        spr.replace(old, geom)
        if e.get('rot'):
            from deckpptx.units import angle
            spr.find(f'{A}xfrm').set('rot', str(angle(e['rot'])))
        self.shadow(pic, e, frame)
        eff = self.animate(e, Target(spid), [])
        self.media.append(Media(spid=spid, dur_ms=info['durMs'], loop=e['src'].get('loop', False),
                                autoplay=e['src'].get('autoplay', True), shown_by=eff,
                                play=e['src'].get('play') or 'with'))
        if e.get('href'):
            self.warn(f'{e["id"]}: data-href on a video is ignored (a click on a video toggles playback)')

    def gif(self, e: dict):
        self.picture(e)
        size = Path(e['src']['path']).stat().st_size
        if size > 1_000_000:
            self.warn(f'{e["id"]}: GIF is {size / 1e6:.2f} MB, the contract allows 1 MB')

    # ------------------------------------------------------------------ slide
    def build(self):
        self.background()
        for e in self.s['elements']:
            t = e['type']
            if t in ('title', 'text'):
                self.text(e, t == 'title')
            elif t == 'shape':
                self.shape(e)
            elif t == 'image':
                self.picture(e)
            elif t == 'gif':
                self.gif(e)
            elif t == 'video':
                self.video(e)
        sld = self.slide._element
        for old in sld.findall(P + 'timing'):
            sld.remove(old)
        effects = [eff for _, eff in sorted(self.effects, key=lambda kv: kv[0])]
        timing = build_timing(effects, self.media)
        if timing is not None:
            ext = sld.find(P + 'extLst')
            if ext is not None:
                ext.addprevious(timing)
            else:
                sld.append(timing)
        tr = self.s.get('transition') or {'type': 'morph'}
        set_transition(sld, tr['type'], tr.get('durMs'), tr.get('option') or 'object')
        notes = self.s.get('notes') or []
        if notes:
            tf = self.slide.notes_slide.notes_text_frame
            tf.text = ''
            for i, para in enumerate(notes):
                p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
                run = p.add_run()
                run.text = para
                run._r.get_or_add_rPr().set('lang', self.lang)
        if self.title_text is None:
            self.warn('no title placeholder (data-pptx="title" missing): the outline shows no name for this slide')
        return {'effects': len(effects), 'media': len(self.media)}


def build(build_dir: Path, out: Path, font_dir: Path, title: str, embed: str) -> dict:
    doc = json.loads((build_dir / 'slides.json').read_text(encoding='utf-8'))
    problems = F.check_font_names(font_dir)
    if problems:
        raise SystemExit('font files do not match the typeface mapping:\n  ' + '\n  '.join(problems))
    prs = new_presentation()
    layout = prs.slide_layouts[0]
    log: list[str] = []
    errors: list[str] = []
    sidecar = []
    titles, weights, stats = [], set(), []
    n_media = n_notes = words = paragraphs = 0
    for s in doc['slides']:
        for w in s.get('warnings', []):
            log.append(f'{s["file"]}: {w}')
        slide = prs.slides.add_slide(layout)
        sb = SlideBuilder(prs, slide, s, build_dir, log)
        st = sb.build()
        errors += sb.errors
        sidecar.append({'nn': s['nn'], 'file': s['file'], 'objects': sb.objects})
        titles.append(sb.title_text or '')
        n_media += st['media']
        n_notes += 1 if s.get('notes') else 0
        for e in s['elements']:
            for p in (e.get('text') or {}).get('paragraphs', []):
                paragraphs += 1
                for ln in p['lines']:
                    for r in ln['runs']:
                        weights.add(F.face_for_weight(r['weight']).weight)
                        words += len(r['text'].split())
        stats.append((s['nn'], s['file'], len(s['elements']), st['effects'], st['media'], s['transition']['type']))
    if embed != 'none':
        F.embed_fonts(prs, font_dir, weights=sorted(weights) if embed == 'used' else (400, 500, 600, 700))

    now = datetime.now(timezone.utc).replace(microsecond=0)
    cp = prs.core_properties
    cp.title = title
    cp.subject = ''
    cp.author = ''
    cp.keywords = ''
    cp.comments = ''
    cp.category = ''
    cp.last_modified_by = ''
    cp.revision = 1
    cp.created = cp.modified = now
    cp.language = 'ru-RU'
    for part in prs.part.package.iter_parts():
        if part.partname == '/docProps/app.xml':
            part._blob = app_properties_xml(len(doc['slides']), n_notes, n_media, words, paragraphs, titles)
        if part.partname == '/docProps/thumbnail.jpeg':
            ref = build_dir / doc['slides'][0]['reference']
            with Image.open(ref) as im:
                im = im.convert('RGB')
                im.thumbnail((256, 144))
                buf = io.BytesIO()
                im.save(buf, 'JPEG', quality=85)
                part._blob = buf.getvalue()
    out.parent.mkdir(parents=True, exist_ok=True)
    side = objects_path(out)
    if errors:
        # no file at all rather than a stale or broken one that later steps would check, render and ship
        out.unlink(missing_ok=True)
        side.unlink(missing_ok=True)
        return {'log': log, 'stats': stats, 'titles': titles, 'size': 0, 'errors': errors}
    prs.save(str(out))
    side.write_text(json.dumps({'format': 'cf11-objects/1', 'pptx': out.name, 'build': str(build_dir.resolve()),
                                'slides': sidecar}, ensure_ascii=False, indent=1), encoding='utf-8')
    return {'log': log, 'stats': stats, 'titles': titles, 'size': out.stat().st_size, 'errors': []}


def mandatory_order_problems(titles: list[str]) -> list[str]:
    """The ten names of Приложение 2 in order; own slides only between the blocks and «Используемые источники»."""
    problems = []
    seq = [t for t in titles if t in MANDATORY]
    dedup = [t for i, t in enumerate(seq) if i == 0 or t != seq[i - 1] or t != 'Представление блоков проекта']
    if dedup != MANDATORY:
        missing = [m for m in MANDATORY if m not in titles]
        if missing:
            problems.append('missing mandatory slide names: ' + ', '.join(f'«{m}»' for m in missing))
        else:
            problems.append('mandatory names out of order: ' + ' → '.join(dedup))
    blocks = [i for i, t in enumerate(titles) if t == 'Представление блоков проекта']
    if blocks and len(blocks) != blocks[-1] - blocks[0] + 1:
        own_between = [titles[i] for i in range(blocks[0], blocks[-1] + 1) if titles[i] != 'Представление блоков проекта']
        problems.append('«Представление блоков проекта» slides are not consecutive (between them: ' + ', '.join(own_between) + ')')
    if 'Используемые источники' in titles and blocks:
        src = titles.index('Используемые источники')
        for i, t in enumerate(titles):
            if t not in MANDATORY and not (blocks[-1] < i < src):
                problems.append(f'own slide «{t}» (#{i + 1}) is outside the place for own slides (after the blocks, before the sources)')
    if len(titles) > 15:
        problems.append(f'{len(titles)} slides, the limit is 15')
    return problems


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--build', default=str(DECK / 'out' / 'build'), help='folder with slides.json (extract.mjs --out)')
    ap.add_argument('--out', default=str(DECK / 'out' / 'meldy-codingfest11.pptx'))
    ap.add_argument('--fonts', default=str(DECK / 'design' / 'fonts'))
    ap.add_argument('--title', default='Meldy')
    ap.add_argument('--embed', default='all', choices=['all', 'used', 'none'], help='Onest faces to embed (default all four)')
    ap.add_argument('--deck-rules', action='store_true', help='fail if the mandatory names/order/15-slide rules are broken')
    a = ap.parse_args(argv)
    res = build(Path(a.build), Path(a.out), Path(a.fonts), a.title, a.embed)
    for nn, f, n, eff, med, tr in res['stats']:
        print(f'{nn} {f:<28} {n:3d} objects  {eff:2d} effects  {med} video  transition {tr}')
    for line in res['log']:
        print('  ! ' + line)
    if res['errors']:
        for line in res['errors']:
            print('  ✗ ERROR ' + line)
        print(f'build failed: {len(res["errors"])} error(s); {a.out} not written')
        return 1
    size = res['size']
    print(f'saved {a.out}: {size / 1e6:.3f} MB ({size / 2 ** 20:.3f} MiB), budget 9.5 MB -> '
          f'{"OK" if size <= 9_500_000 else "OVER BUDGET"}')
    problems = mandatory_order_problems(res['titles'])
    for p in problems:
        print(('  ✗ ' if a.deck_rules else '  · ') + p)
    if a.deck_rules and problems:
        return 1
    if not re.fullmatch(r'[A-Za-z0-9._-]+\.pptx', Path(a.out).name):
        print('  ! the file name is not plain Latin (the contest asks for a Latin file name)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
