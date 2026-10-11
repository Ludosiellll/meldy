"""Read a built PPTX back as objects, and pair the objects of two slides the way Morph is documented to.

Used by check_pptx.py (the lint: an entrance animation on an object that morphs in) and by the motion preview
(tools/preview), so both see exactly what is in the file: names, z-order, geometry, fills, pictures, media, text,
transitions and which objects the main sequence builds in.

How Morph pairs objects (Microsoft, «Morph transition: Tips and tricks», support.microsoft.com, read 2026-10-11):
  * "!!name": two objects of the same type with the same name starting with "!!" on the two slides morph into each
    other, whatever their shape or content (a circle into a square, a shape with other text, two different images).
    Morph never matches a "!!" object with a non-"!!" one, and expects each "!!" name once per slide.
  * Other names do not change how Morph treats an object. Without "!!" PowerPoint matches objects automatically;
    the article implies the rule: the same type with the same content - the same shape with the same text, the same
    picture (forcing exists precisely for "different shapes", "the same shape with different text", "two images").
    Practitioners report that several identical objects (e.g. three equal rectangles) get matched unpredictably
    (BrightCarbon, «How to use PowerPoint Morph with multiple objects»). Here identical candidates are paired in
    z-order and reported as ambiguous: PowerPoint's own choice may differ.
  * The Words / Characters options also match individual words / characters between text objects; not modelled
    (a text object is matched as a whole, with a note).
Not documented, assumed here (and stated in the preview's README): an object with an entrance effect on the incoming
slide is hidden when the slide starts, so it takes no part in the Morph (its would-be partner fades out) and builds
in afterwards; "type" means the PowerPoint object class (shape incl. text boxes and placeholders, picture, media).
"""
from __future__ import annotations

import hashlib
import posixpath
import re
import zipfile
from dataclasses import dataclass, field

from lxml import etree

NS = {'p': 'http://schemas.openxmlformats.org/presentationml/2006/main',
      'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
      'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
      'mc': 'http://schemas.openxmlformats.org/markup-compatibility/2006',
      'p14': 'http://schemas.microsoft.com/office/powerpoint/2010/main',
      'p159': 'http://schemas.microsoft.com/office/powerpoint/2015/09/main',
      'rel': 'http://schemas.openxmlformats.org/package/2006/relationships'}
P, A, R = '{%s}' % NS['p'], '{%s}' % NS['a'], '{%s}' % NS['r']
EMU_PX = 6350.0
SPD_MS = {'fast': 500, 'med': 750, 'slow': 1000}


def _xp(el, expr):
    return etree.XPath(expr, namespaces=NS)(el)


@dataclass
class Obj:
    slide: int                      # 1-based
    spid: int
    name: str
    kind: str                       # shape | picture | media | graphic | group | connector
    z: int                          # position in the shape tree, bottom first
    x: float = 0.0
    y: float = 0.0
    w: float = 0.0
    h: float = 0.0
    rot: float = 0.0
    flip_h: bool = False
    flip_v: bool = False
    geom: str = 'rect'              # prstGeom name or 'custom'
    adj: dict = field(default_factory=dict)
    path: list | None = None        # custGeom: [{'w','h','cmds': [(op, [numbers])]}] in EMU
    fill: tuple | None = None       # (RRGGBB, alpha)
    line: dict | None = None        # {'rgb','alpha','w','dash','join'}
    text: str = ''
    text_box: bool = False
    placeholder: str | None = None
    image: str | None = None        # part name of the picture / poster
    image_sha1: str | None = None
    crop: dict | None = None        # srcRect fractions l, t, r, b
    alpha: float = 1.0
    media: str | None = None        # part name of the video
    media_sha1: str | None = None
    decorative: bool = False
    builds_in: bool = False         # an entrance effect of the main sequence targets it

    @property
    def forced(self) -> bool:
        return self.name.startswith('!!')

    def label(self) -> str:
        what = {'shape': 'text' if self.text and self.geom == 'rect' and not self.fill and not self.line else self.geom,
                'picture': 'picture', 'media': 'video'}.get(self.kind, self.kind)
        t = f' «{_short(self.text)}»' if self.text else ''
        return f'{self.name} [{what}{t}]'

    def box(self) -> str:
        return f'{self.x:.0f},{self.y:.0f} {self.w:.0f}×{self.h:.0f}'


def _short(s: str, n: int = 34) -> str:
    s = ' / '.join(x for x in s.split('\n') if x)
    return s if len(s) <= n else s[:n - 1] + '…'


@dataclass
class Transition:
    kind: str = 'none'              # morph | fade | cut (no transition) | other:<name>
    dur_ms: int = 0
    option: str | None = None       # morph: byObject | byWord | byChar


@dataclass
class Slide:
    index: int                      # 1-based
    part: str
    objects: list[Obj]
    transition: Transition
    timing: etree._Element | None
    root: etree._Element


class Package:
    """The slides of a PPTX as Obj lists (zip + lxml; no python-pptx, so any PPTX can be read)."""

    def __init__(self, path):
        self.zip = zipfile.ZipFile(path)
        self._sha = {}
        pres = etree.fromstring(self.zip.read('ppt/presentation.xml'))
        rels = self.rels('ppt/presentation.xml')
        self.slides: list[Slide] = []
        for i, sid in enumerate(_xp(pres, 'p:sldIdLst/p:sldId'), start=1):
            part = rels[sid.get(R + 'id')]
            self.slides.append(self.read_slide(i, part))

    # ---- package helpers
    def rels(self, part: str) -> dict:
        d, b = posixpath.split(part)
        rp = posixpath.join(d, '_rels', b + '.rels')
        if rp not in self.zip.namelist():
            return {}
        out = {}
        for r in etree.fromstring(self.zip.read(rp)).findall('{%s}Relationship' % NS['rel']):
            if r.get('TargetMode') == 'External':
                out[r.get('Id')] = r.get('Target')
            else:
                out[r.get('Id')] = posixpath.normpath(posixpath.join(d, r.get('Target')))
        return out

    def sha1(self, part: str) -> str:
        if part not in self._sha:
            self._sha[part] = hashlib.sha1(self.zip.read(part)).hexdigest()
        return self._sha[part]

    def read(self, part: str) -> bytes:
        return self.zip.read(part)

    # ---- slides
    def read_slide(self, index: int, part: str) -> Slide:
        root = etree.fromstring(self.zip.read(part))
        rels = self.rels(part)
        tree = root.find('p:cSld/p:spTree', NS)
        objs = []
        z = 0
        for el in tree:
            tag = etree.QName(el).localname
            if tag not in ('sp', 'pic', 'graphicFrame', 'grpSp', 'cxnSp'):
                continue
            o = self.read_object(index, el, tag, z, rels)
            if o is not None:
                objs.append(o)
                z += 1
        timing = root.find('p:timing', NS)
        if timing is not None:
            ins = entrance_targets(timing)
            for o in objs:
                o.builds_in = o.spid in ins
        return Slide(index, part, objs, read_transition(root), timing, root)

    def read_object(self, index, el, tag, z, rels) -> Obj | None:
        c = el.find('.//p:cNvPr', NS)
        if c is None:
            return None
        o = Obj(slide=index, spid=int(c.get('id')), name=c.get('name') or '', z=z,
                kind={'sp': 'shape', 'pic': 'picture', 'graphicFrame': 'graphic', 'grpSp': 'group',
                      'cxnSp': 'connector'}[tag])
        o.decorative = bool(_xp(c, './/*[local-name()="decorative"][@val="1"]'))
        xfrm = el.find('p:spPr/a:xfrm', NS) if tag != 'grpSp' else el.find('p:grpSpPr/a:xfrm', NS)
        if xfrm is None and tag == 'graphicFrame':
            xfrm = el.find('p:xfrm', NS)
        if xfrm is not None:
            off, ext = xfrm.find('a:off', NS), xfrm.find('a:ext', NS)
            if off is not None and ext is not None:
                o.x, o.y = int(off.get('x')) / EMU_PX, int(off.get('y')) / EMU_PX
                o.w, o.h = int(ext.get('cx')) / EMU_PX, int(ext.get('cy')) / EMU_PX
            o.rot = int(xfrm.get('rot', '0')) / 60000.0
            o.flip_h, o.flip_v = xfrm.get('flipH') == '1', xfrm.get('flipV') == '1'
        sppr = el.find('p:spPr', NS)
        if sppr is not None:
            pg = sppr.find('a:prstGeom', NS)
            cg = sppr.find('a:custGeom', NS)
            if pg is not None:
                o.geom = pg.get('prst')
                for gd in pg.findall('a:avLst/a:gd', NS):
                    m = re.match(r'val\s+(-?\d+)', gd.get('fmla', ''))
                    if m:
                        o.adj[gd.get('name')] = int(m.group(1))
            elif cg is not None:
                o.geom, o.path = 'custom', read_paths(cg)
            o.fill = solid_fill(sppr)
            o.line = read_line(sppr.find('a:ln', NS))
        if tag == 'sp':
            o.text_box = el.find('p:nvSpPr/p:cNvSpPr', NS) is not None and el.find('p:nvSpPr/p:cNvSpPr', NS).get('txBox') == '1'
            ph = el.find('p:nvSpPr/p:nvPr/p:ph', NS)
            o.placeholder = ph.get('type', 'body') if ph is not None else None
            o.text = text_of(el.find('p:txBody', NS))
        if tag == 'pic':
            blip = el.find('p:blipFill/a:blip', NS)
            if blip is not None and blip.get(R + 'embed') in rels:
                o.image = rels[blip.get(R + 'embed')]
                o.image_sha1 = self.sha1(o.image)
                amf = blip.find('a:alphaModFix', NS)
                if amf is not None:
                    o.alpha = int(amf.get('amt', '100000')) / 100000.0
            sr = el.find('p:blipFill/a:srcRect', NS)
            if sr is not None:
                o.crop = {k: int(sr.get(k, '0')) / 100000.0 for k in ('l', 't', 'r', 'b')}
            vf = el.find('p:nvPicPr/p:nvPr/a:videoFile', NS)
            if vf is not None and vf.get(R + 'link') in rels:
                o.kind = 'media'
                o.media = rels[vf.get(R + 'link')]
                if o.media in self.zip.namelist():
                    o.media_sha1 = self.sha1(o.media)
        return o


def read_paths(cg) -> list:
    paths = []
    for p in cg.findall('a:pathLst/a:path', NS):
        cmds = []
        for c in p:
            op = etree.QName(c).localname
            if op in ('moveTo', 'lnTo'):
                pt = c.find('a:pt', NS)
                cmds.append((op, [float(pt.get('x')), float(pt.get('y'))]))
            elif op == 'arcTo':
                cmds.append((op, [float(c.get(k)) for k in ('wR', 'hR', 'stAng', 'swAng')]))
            elif op in ('cubicBezTo', 'quadBezTo'):
                cmds.append((op, [float(v) for pt in c.findall('a:pt', NS) for v in (pt.get('x'), pt.get('y'))]))
            elif op == 'close':
                cmds.append((op, []))
        paths.append({'w': float(p.get('w', '0')), 'h': float(p.get('h', '0')), 'cmds': cmds})
    return paths


def _color(el) -> tuple | None:
    if el is None:
        return None
    c = el.find('a:srgbClr', NS)
    if c is None:
        return None
    a = c.find('a:alpha', NS)
    return c.get('val').upper(), (int(a.get('val')) / 100000.0 if a is not None else 1.0)


def solid_fill(sppr) -> tuple | None:
    return _color(sppr.find('a:solidFill', NS))


def read_line(ln) -> dict | None:
    if ln is None or ln.find('a:noFill', NS) is not None:
        return None
    col = _color(ln.find('a:solidFill', NS))
    if col is None:
        return None
    dash = ln.find('a:prstDash', NS)
    return {'rgb': col[0], 'alpha': col[1], 'w': int(ln.get('w', '12700')) / EMU_PX,
            'dash': dash.get('val') if dash is not None else 'solid',
            'join': 'miter' if ln.find('a:miter', NS) is not None else 'round'}


def text_of(body) -> str:
    if body is None:
        return ''
    paras = []
    for p in body.findall('a:p', NS):
        s = []
        for ch in p:
            t = etree.QName(ch).localname
            if t == 'r':
                s.append(''.join(ch.find('a:t', NS).itertext()) if ch.find('a:t', NS) is not None else '')
            elif t == 'br':
                s.append('\n')
            elif t == 'fld':
                s.append(''.join(x.text or '' for x in ch.findall('a:t', NS)))
        paras.append(''.join(s))
    return '\n'.join(paras).strip('\n')


def read_transition(root) -> Transition:
    el = None
    for ac in root.findall('mc:AlternateContent', NS):
        for ch in ac.findall('mc:Choice', NS):
            el = ch.find('p:transition', NS)
            if el is not None:
                break
        if el is None:
            fb = ac.find('mc:Fallback/p:transition', NS)
            el = fb
        if el is not None:
            break
    if el is None:
        el = root.find('p:transition', NS)
    if el is None:
        return Transition('cut', 0)
    dur = el.get('{%s}dur' % NS['p14'])
    ms = int(dur) if dur is not None else SPD_MS.get(el.get('spd', 'fast'), 500)
    kids = [c for c in el if isinstance(c.tag, str)]
    if not kids:
        return Transition('cut', 0)
    k = kids[0]
    name = etree.QName(k).localname
    if name == 'morph':
        return Transition('morph', ms, k.get('option', 'byObject'))
    if name == 'fade':
        return Transition('fade', ms)
    return Transition(f'other:{name}', ms)


def entrance_targets(timing) -> set[int]:
    """Shape ids an entrance effect of the main sequence targets (hidden when the slide starts)."""
    out = set()
    for ctn in _xp(timing, './/p:cTn[@nodeType="mainSeq"]//p:cTn[@presetClass="entr"]'):
        for t in _xp(ctn, './/p:spTgt'):
            out.add(int(t.get('spid')))
    return out


# ---------------------------------------------------------------------------- pairing

@dataclass
class Pair:
    a: Obj
    b: Obj
    how: str                        # name | auto
    note: str = ''


@dataclass
class Pairing:
    pairs: list[Pair] = field(default_factory=list)
    gone: list[Obj] = field(default_factory=list)      # outgoing objects without a partner: fade out
    new: list[Obj] = field(default_factory=list)       # incoming objects without a partner: fade in
    held: list[Obj] = field(default_factory=list)      # incoming objects with an entrance effect: not in the morph
    blocked: list[Pair] = field(default_factory=list)  # would morph in but build in instead (the lint)
    notes: list[str] = field(default_factory=list)


def content_key(o: Obj):
    """What PowerPoint's automatic matching compares: the type and the content."""
    if o.kind == 'shape':
        return ('shape', o.geom, o.text)
    if o.kind == 'picture':
        return ('picture', o.image_sha1)
    if o.kind == 'media':
        return ('media', o.media_sha1)
    return (o.kind, o.name)


def pair_slides(prev: list[Obj], cur: list[Obj], option: str = 'byObject') -> Pairing:
    """Morph pairs between the end state of `prev` and the start state of `cur`."""
    res = Pairing()
    used_a: set[int] = set()
    start = [o for o in cur if not o.builds_in]
    res.held = [o for o in cur if o.builds_in]

    # 1. forced: "!!name" with "!!name" of the same type
    by_name: dict[str, list[Obj]] = {}
    for o in prev:
        if o.forced:
            by_name.setdefault(o.name, []).append(o)
    seen_b: dict[str, int] = {}
    for o in sorted(cur, key=lambda x: x.z):
        if not o.forced:
            continue
        seen_b[o.name] = seen_b.get(o.name, 0) + 1
        cands = [a for a in by_name.get(o.name, []) if id(a) not in used_a]
        if not cands:
            near = [a for a in prev if a.forced and a.name.lower() == o.name.lower() and a.name != o.name]
            if near:
                res.notes.append(f'{o.name}: the previous slide has {near[0].name} (case differs) - no forced match')
            continue
        same = [a for a in cands if a.kind == o.kind]
        if not same:
            res.notes.append(f'{o.name}: a {o.kind} here, a {cands[0].kind} on the previous slide - Morph pairs '
                             f'"!!" names of the same type only, so they fade instead')
            continue
        a = same[0]
        if o.builds_in:
            res.blocked.append(Pair(a, o, 'name'))
            continue
        used_a.add(id(a))
        res.pairs.append(Pair(a, o, 'name'))
    for n, k in seen_b.items():
        if k > 1:
            res.notes.append(f'{n} is used {k} times on this slide: Morph expects each "!!" name once')
    for n, lst in by_name.items():
        if len(lst) > 1:
            res.notes.append(f'{n} is used {len(lst)} times on the previous slide: Morph expects each "!!" name once')

    # 2. automatic: same type and content, "!!" objects never take part
    groups_a: dict = {}
    for a in prev:
        if not a.forced and id(a) not in used_a:
            groups_a.setdefault(content_key(a), []).append(a)
    groups_b: dict = {}
    for b in start:
        if not b.forced and not any(p.b is b for p in res.pairs):
            groups_b.setdefault(content_key(b), []).append(b)
    for key, bs in groups_b.items():
        as_ = groups_a.get(key, [])
        if not as_:
            continue
        bs, as_ = sorted(bs, key=lambda x: x.z), sorted(as_, key=lambda x: x.z)
        ambiguous = len(as_) > 1 or len(bs) > 1
        for a, b in zip(as_, bs):
            note = (f'ambiguous: {len(as_)} candidates on the previous slide, {len(bs)} here; paired in z-order, '
                    f'PowerPoint may choose differently') if ambiguous else ''
            used_a.add(id(a))
            res.pairs.append(Pair(a, b, 'auto', note))
    # held objects that would have been auto-matched (the lint)
    left_a: dict = {}
    for a in prev:
        if not a.forced and id(a) not in used_a:
            left_a.setdefault(content_key(a), []).append(a)
    for b in res.held:
        if b.forced:
            continue
        cands = left_a.get(content_key(b))
        if cands:
            res.blocked.append(Pair(cands[0], b, 'auto'))
    paired_a = {id(p.a) for p in res.pairs}
    paired_b = {id(p.b) for p in res.pairs}
    res.gone = [a for a in prev if id(a) not in paired_a]
    res.new = [b for b in start if id(b) not in paired_b]
    if option in ('byWord', 'byChar'):
        res.notes.append(f'option {option}: PowerPoint also matches single {"words" if option == "byWord" else "characters"} '
                         f'between text objects; this model matches whole objects only')
    return res
