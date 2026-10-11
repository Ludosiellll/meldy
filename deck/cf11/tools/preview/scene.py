#!/usr/bin/env python3
"""Motion preview, step 1: read the built PPTX back and write one scene per slide for the player.

    python preview/scene.py [--pptx out/meldy-codingfest11.pptx] [--out out/preview/motion]
                            [--clicks slides/preview-clicks.json] [--size 1280x720] [--fps 30]

Everything that moves comes from the file itself (deckpptx/morph.py reads it): objects in z-order with their
geometry, fill, outline, outer shadow, picture + crop, video + poster, GIF; the transition (Morph and its option,
Fade, none) and its p14:dur; the main sequence (click groups, with/after, delays, durations, every behaviour node with
its values and easing) and the media commands. Pixels of live text come from extract's text layers through the build's
<deck>.objects.json; pictures, posters, GIFs and videos are taken out of the PPTX package.

Clicks: every click group starts on a click; the default script clicks 1.2 s (--gap) after the previous build
ends (or after the transition), and the slide is held 3 s (--hold) after its last build. A JSON next to the slides
(slides/preview-clicks.json, or --clicks) overrides it: {"gap": 1.2, "hold": 3,
"slides": {"07": {"clicks": [0.5, 2.0], "hold": 5}}} - "clicks" are seconds after the previous build ends.

Writes <out>/scenes/NN.json (one per slide: the transition into it, its builds, the hold), <out>/assets/ and
<out>/morph-log.txt (every Morph pair and every unpaired object per transition).
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import subprocess
import sys
from pathlib import Path

from lxml import etree
from PIL import Image, ImageSequence

HERE = Path(__file__).resolve().parent
TOOLS = HERE.parent
DECK = TOOLS.parent
sys.path.insert(0, str(TOOLS))
from deckpptx.morph import NS, Package, Pairing, layer_owner, pair_slides   # noqa: E402

P = '{%s}' % NS['p']
SLIDE_W, SLIDE_H = 1920.0, 1080.0
BEHAVIOURS = ('set', 'anim', 'animEffect', 'animScale', 'animRot', 'animMotion', 'animClr', 'cmd')


def _x(el, expr):
    return etree.XPath(expr, namespaces=NS)(el)


def num(v, default=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


# ---------------------------------------------------------------------------- timing
def ctn_delay(ctn) -> float | None:
    """The begin delay of a cTn: its first numeric start condition (None = indefinite / event only)."""
    for c in _x(ctn, 'p:stCondLst/p:cond'):
        d = c.get('delay')
        if d is not None and d != 'indefinite':
            return num(d)
    return None


def value_of(val_el):
    if val_el is None or not len(val_el):
        return None
    v = val_el[0]
    tag = etree.QName(v).localname
    if tag in ('strVal', 'fltVal', 'intVal'):
        return v.get('val')
    if tag == 'boolVal':
        return v.get('val')
    return None


def behaviour(el, begin: float) -> dict | None:
    tag = etree.QName(el).localname
    ctn = el.find('p:cBhvr/p:cTn', NS)
    if ctn is None:
        return None
    b = {'type': tag, 'begin': begin + (ctn_delay(ctn) or 0.0)}
    dur = ctn.get('dur')
    b['dur'] = 0.0 if dur in (None, 'indefinite') else num(dur)
    b['accel'] = num(ctn.get('accel'), 0) / 100000.0
    b['decel'] = num(ctn.get('decel'), 0) / 100000.0
    b['spid'] = int(_x(el, 'p:cBhvr/p:tgtEl/p:spTgt/@spid')[0]) if _x(el, 'p:cBhvr/p:tgtEl/p:spTgt/@spid') else None
    b['attr'] = [a.text for a in _x(el, 'p:cBhvr/p:attrNameLst/p:attrName')]
    if tag == 'set':
        b['to'] = value_of(el.find('p:to', NS))
    elif tag == 'anim':
        tav = []
        for t in _x(el, 'p:tavLst/p:tav'):
            tm = t.get('tm')
            tav.append([None if tm in (None, 'indefinite') else num(tm) / 100000.0, value_of(t.find('p:val', NS)),
                        t.get('fmla')])
        if tav and tav[0][0] is None:
            tav[0][0] = 0.0
        b['tav'] = tav
        b['from'], b['to'], b['by'] = el.get('from'), el.get('to'), el.get('by')
    elif tag == 'animEffect':
        b['filter'] = el.get('filter') or ''
        b['transition'] = el.get('transition') or 'in'
    elif tag == 'animScale':
        def pt(name):
            e = el.find(f'p:{name}', NS)
            return [num(e.get('x')) / 100000.0, num(e.get('y')) / 100000.0] if e is not None else None
        b['from'], b['to'], b['by'] = pt('from'), pt('to'), pt('by')
    elif tag == 'cmd':
        b['cmd'] = el.get('cmd') or ''
    return b


def walk(ctn, begin: float, effects: list, parent_effect=None):
    """Collect the effects below a time container; begin = absolute ms the container starts."""
    for child in _x(ctn, 'p:childTnLst/*'):
        tag = etree.QName(child).localname
        if tag in ('par', 'seq'):
            c = child.find('p:cTn', NS)
            b = begin + (ctn_delay(c) or 0.0)
            if c.get('presetClass') and parent_effect is None:
                eff = {'presetID': int(num(c.get('presetID'), 0)), 'presetClass': c.get('presetClass'),
                       'subtype': int(num(c.get('presetSubtype'), 0)), 'nodeType': c.get('nodeType'),
                       'begin': b, 'accel': num(c.get('accel'), 0) / 100000.0,
                       'decel': num(c.get('decel'), 0) / 100000.0, 'behaviours': []}
                walk(c, b, effects, eff)
                ends = [x['begin'] + x['dur'] for x in eff['behaviours']]
                eff['dur'] = max(ends) - b if ends else 0.0
                eff['spids'] = sorted({x['spid'] for x in eff['behaviours'] if x['spid'] is not None})
                effects.append(eff)
            else:
                walk(c, b, effects, parent_effect)
        elif tag in BEHAVIOURS and parent_effect is not None:
            bh = behaviour(child, begin)
            if bh:
                parent_effect['behaviours'].append(bh)


def main_sequence(timing) -> list[dict]:
    """Click groups of the main sequence: [{'auto': bool, 'ctn': element}]"""
    if timing is None:
        return []
    mains = _x(timing, './/p:cTn[@nodeType="mainSeq"]')
    if not mains:
        return []
    groups = []
    for par in _x(mains[0], 'p:childTnLst/p:par'):
        c = par.find('p:cTn', NS)
        auto = bool(_x(c, 'p:stCondLst/p:cond[@evt="onBegin"]'))
        groups.append({'auto': auto, 'ctn': c})
    return groups


def loops(timing) -> set[int]:
    out = set()
    if timing is None:
        return out
    for v in _x(timing, './/p:video/p:cMediaNode'):
        ctn = v.find('p:cTn', NS)
        sp = _x(v, 'p:tgtEl/p:spTgt/@spid')
        if ctn is not None and ctn.get('repeatCount') == 'indefinite' and sp:
            out.add(int(sp[0]))
    return out


def schedule(groups: list[dict], t0: float, script: dict, gap: float, hold: float):
    """Resolve the click groups from t0 (the transition's end). Returns (effects, clicks, end of the hold)."""
    effects, clicks, info = [], [], []
    t = t0
    clicks_after = list(script.get('clicks') or [])
    for i, g in enumerate(groups):
        if g['auto'] and i == 0:
            start = t
        else:
            d = clicks_after.pop(0) if clicks_after else gap
            start = t + d * 1000.0
            clicks.append(start)
        before = len(effects)
        walk(g['ctn'], start, effects)
        mine = effects[before:]
        vis_end = [b['begin'] + b['dur'] for e in mine for b in e['behaviours'] if b['type'] != 'cmd']
        end = max([start] + vis_end)
        info.append({'start': start, 'end': end, 'auto': bool(g['auto'] and i == 0), 'effects': len(mine)})
        t = end
    return effects, clicks, info, t + float(script.get('hold', hold)) * 1000.0


# ---------------------------------------------------------------------------- assets
class Assets:
    def __init__(self, pkg: Package, root: Path, size: tuple[int, int], fps: int):
        self.pkg, self.root, self.size, self.fps = pkg, root, size, fps
        (root / 'assets').mkdir(parents=True, exist_ok=True)
        self.cache = {}

    def image(self, part: str) -> str:
        """An image part as a file (GIF/PNG/JPEG as stored)."""
        key = ('img', part)
        if key not in self.cache:
            data = self.pkg.read(part)
            ext = Path(part).suffix.lower() or '.bin'
            out = self.root / 'assets' / 'img' / (hashlib.sha1(data).hexdigest()[:16] + ext)
            out.parent.mkdir(parents=True, exist_ok=True)
            if not out.exists():
                out.write_bytes(data)
            self.cache[key] = str(out)
        return self.cache[key]

    def gif(self, part: str) -> dict | None:
        key = ('gif', part)
        if key not in self.cache:
            data = self.pkg.read(part)
            im = Image.open(io.BytesIO(data))
            if not getattr(im, 'is_animated', False):
                self.cache[key] = None
                return None
            d = self.root / 'assets' / 'gif' / hashlib.sha1(data).hexdigest()[:16]
            d.mkdir(parents=True, exist_ok=True)
            frames, delays = [], []
            for i, fr in enumerate(ImageSequence.Iterator(im)):
                f = d / f'f{i:04d}.png'
                if not f.exists():
                    fr.convert('RGBA').save(f)
                frames.append(str(f))
                delays.append(max(20, int(fr.info.get('duration', 100) or 100)))
            self.cache[key] = {'frames': frames, 'delays': delays, 'total': sum(delays)}
        return self.cache[key]

    def video(self, part: str, w: float, h: float) -> dict:
        """Frames of an embedded video at the size it is drawn on the preview canvas."""
        sw, sh = self.size
        pw, ph = max(2, int(round(w * sw / SLIDE_W / 2)) * 2), max(2, int(round(h * sh / SLIDE_H / 2)) * 2)
        key = ('video', part, pw, ph)
        if key not in self.cache:
            data = self.pkg.read(part)
            sha = hashlib.sha1(data).hexdigest()[:16]
            src = self.root / 'assets' / 'video' / f'{sha}.mp4'
            src.parent.mkdir(parents=True, exist_ok=True)
            if not src.exists():
                src.write_bytes(data)
            d = self.root / 'assets' / 'video' / f'{sha}-{pw}x{ph}-{self.fps}'
            if not (d / 'done').exists():
                d.mkdir(parents=True, exist_ok=True)
                probe = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
                                        'stream=color_space', '-of', 'default=nw=1:nk=1', str(src)],
                                       capture_output=True, text=True).stdout.strip()
                matrix = ':in_color_matrix=bt709' if 'bt709' in probe else ''
                subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(src), '-vf',
                                f'fps={self.fps},scale={pw}:{ph}:flags=lanczos{matrix}', '-q:v', '3',
                                str(d / 'f%05d.jpg')], check=True)
                (d / 'done').write_text('ok')
            n = len(list(d.glob('f*.jpg')))
            self.cache[key] = {'dir': str(d), 'n': n, 'fps': self.fps}
        return self.cache[key]


# ---------------------------------------------------------------------------- objects
def radii_of(o) -> list | None:
    """Corner radii [tl, tr, br, bl] in px for the rectangle family; None for other geometry."""
    ss = min(o.w, o.h)
    if o.geom == 'rect':
        return [0.0] * 4
    if o.geom == 'roundRect':
        r = o.adj.get('adj', 16667) / 100000.0 * ss
        return [r] * 4
    if o.geom == 'round2SameRect':
        t = o.adj.get('adj1', 16667) / 100000.0 * ss
        b = o.adj.get('adj2', 0) / 100000.0 * ss
        return [t, t, b, b]
    if o.geom == 'ellipse' and abs(o.w - o.h) < 0.5:
        return [o.w / 2] * 4
    return None


def path_px(o) -> list | None:
    if not o.path:
        return None
    out = []
    for p in o.path:
        sx = o.w / p['w'] if p['w'] else 1.0 / 6350.0
        sy = o.h / p['h'] if p['h'] else 1.0 / 6350.0
        cmds = []
        for op, a in p['cmds']:
            if op in ('moveTo', 'lnTo'):
                cmds.append([op, a[0] * sx, a[1] * sy])
            elif op == 'arcTo':
                cmds.append([op, a[0] * sx, a[1] * sy, a[2] / 60000.0, a[3] / 60000.0])
            elif op in ('cubicBezTo', 'quadBezTo'):
                cmds.append([op] + [v * (sx if i % 2 == 0 else sy) for i, v in enumerate(a)])
            else:
                cmds.append([op])
        out.append(cmds)
    return out


def rgba(col):
    if not col:
        return None
    rgb, a = col
    return [int(rgb[0:2], 16), int(rgb[2:4], 16), int(rgb[4:6], 16), round(a, 4)]


def obj_json(o, side: dict | None, assets: Assets, build_dir: Path) -> dict:
    d = {'key': f's{o.slide}:{o.spid}', 'spid': o.spid, 'name': o.name, 'kind': o.kind, 'z': o.z,
         'x': o.x, 'y': o.y, 'w': o.w, 'h': o.h, 'rot': o.rot, 'flipH': o.flip_h, 'flipV': o.flip_v,
         'geom': o.geom, 'radii': radii_of(o), 'path': path_px(o), 'fill': rgba(o.fill),
         'line': ({'rgba': rgba((o.line['rgb'], o.line['alpha'])), 'w': o.line['w'], 'dash': o.line['dash'],
                   'join': o.line['join']} if o.line else None),
         'buildsIn': o.builds_in, 'role': (side or {}).get('role'), 'element': (side or {}).get('element'),
         'label': o.label(), 'text': o.text, 'layerOf': layer_owner(o.name) if o.kind == 'picture' else None}
    if o.shadow:
        sh = o.shadow
        d['shadow'] = {'blur': sh['blur'], 'dist': sh['dist'], 'dir': sh['dir'], 'sx': sh['sx'], 'sy': sh['sy'],
                       'rotWith': sh['rotWith'], 'rgba': rgba((sh['rgb'], sh['alpha']))}
    if o.kind in ('picture', 'media') and o.image:
        d['img'] = {'src': assets.image(o.image), 'crop': o.crop, 'alpha': o.alpha}
        if o.image.lower().endswith('.gif'):
            g = assets.gif(o.image)
            if g:
                d['gif'] = g
    if o.kind == 'media' and o.media:
        d['video'] = assets.video(o.media, o.w, o.h)
    tl = (side or {}).get('textLayer')
    if o.kind == 'shape' and o.text and tl:
        d['textLayer'] = {'src': str((build_dir / tl['png']).resolve()), **tl['rect']}
    elif o.kind == 'shape' and o.text:
        d['textLayer'] = None
        d['warn'] = 'no text layer (rebuild with the current extract.mjs): the preview draws no text for it'
    return d


# ---------------------------------------------------------------------------- transitions
def draw_order(pr: Pairing, prev_objs: list, cur_objs: list) -> list[dict]:
    """Bottom-to-top draw list for the transition: pairs and incoming objects in the incoming z-order, an outgoing
    object without a partner just above the incoming partner of the nearest paired object below it."""
    partner_z = {id(p.a): p.b.z for p in pr.pairs}
    items = []
    for p in pr.pairs:
        items.append({'kind': 'pair', 'a': f's{p.a.slide}:{p.a.spid}', 'b': f's{p.b.slide}:{p.b.spid}',
                      'how': p.how, 'z': float(p.b.z)})
    for b in pr.new:
        items.append({'kind': 'new', 'b': f's{b.slide}:{b.spid}', 'z': float(b.z)})
    for b in pr.held:
        items.append({'kind': 'held', 'b': f's{b.slide}:{b.spid}', 'z': float(b.z)})
    for a in pr.gone:
        below = [x for x in prev_objs if x.z < a.z and id(x) in partner_z]
        base = partner_z[id(below[-1])] if below else -1
        items.append({'kind': 'gone', 'a': f's{a.slide}:{a.spid}', 'z': base + 0.5 + a.z / 1000.0})
    items.sort(key=lambda it: it['z'])
    return items


def shadow_key(o):
    """A shadow as authored (blur, offset, colour); its sx/sy follow the object's size, so they are left out."""
    sh = o.shadow
    return sh and (round(sh['blur'], 1), round(sh['dist'], 1), round(sh['dir'], 1), sh['rgb'], round(sh['alpha'], 3))


def log_transition(lines: list, prev, cur, pr: Pairing | None):
    t = cur.transition
    head = f'{prev.index:02d} → {cur.index:02d}' if prev else f'(start) → {cur.index:02d}'
    if t.kind == 'morph':
        layers = [p.b.name for p in pr.pairs if p.b.kind == 'picture' and layer_owner(p.b.name)]
        lines.append(f'\n{head}  Morph ({t.option}), {t.dur_ms} ms: {len(pr.pairs)} pairs, {len(pr.gone)} fade out, '
                     f'{len(pr.new)} fade in, {len(pr.held)} build in later'
                     + (f'; layers travelling with their owners: {", ".join(layer_owner(n) for n in layers)}'
                        if layers else ''))
    elif t.kind == 'fade':
        lines.append(f'\n{head}  Fade{" from black" if not prev else ""}, {t.dur_ms} ms (no pairing)')
        return
    else:
        lines.append(f'\n{head}  {t.kind}, {t.dur_ms} ms (no pairing)')
        return

    def geo(o):
        g = {'shape': o.geom, 'picture': 'picture', 'media': 'video'}.get(o.kind, o.kind)
        f = f' fill {o.fill[0]}' + (f'@{o.fill[1]:.2f}' if o.fill and o.fill[1] < 0.999 else '') if o.fill else ''
        return f'{g} {o.box()}{f}'

    for p in sorted(pr.pairs, key=lambda p: p.b.z):
        how = 'name' if p.how == 'name' else 'AUTO'
        change = []
        if (abs(p.a.x - p.b.x) > 0.5 or abs(p.a.y - p.b.y) > 0.5 or abs(p.a.w - p.b.w) > 0.5
                or abs(p.a.h - p.b.h) > 0.5):
            change.append(f'{p.a.box()} → {p.b.box()}')
        if p.a.kind == 'shape' and p.a.geom != p.b.geom:
            change.append(f'geometry {p.a.geom} → {p.b.geom}')
        if p.a.fill != p.b.fill and (p.a.fill or p.b.fill):
            change.append(f'fill {p.a.fill[0] if p.a.fill else "none"} → {p.b.fill[0] if p.b.fill else "none"}')
        if p.a.text != p.b.text:
            change.append('text differs: crossfade')
        if p.a.kind in ('picture', 'media') and p.a.image_sha1 != p.b.image_sha1:
            change.append('different picture: crossfade')
        if (p.a.shadow or p.b.shadow) and shadow_key(p.a) != shadow_key(p.b):
            change.append('shadow ' + ('appears' if not p.a.shadow else 'goes' if not p.b.shadow else 'changes'))
        if abs(p.a.rot - p.b.rot) > 0.05:
            change.append(f'rotation {p.a.rot:g}° → {p.b.rot:g}°')
        lines.append(f'  pair {how:<4} {p.a.label()}  →  {p.b.label()}' + (f'   [{"; ".join(change)}]' if change else '   [no change]')
                     + (f'\n         ! {p.note}' if p.note else ''))
    for a in sorted(pr.gone, key=lambda o: o.z):
        lines.append(f'  out       {a.label()}  {geo(a)}   fades out')
    for b in sorted(pr.new, key=lambda o: o.z):
        lines.append(f'  in        {b.label()}  {geo(b)}   fades in')
    for b in sorted(pr.held, key=lambda o: o.z):
        lines.append(f'  build     {b.label()}  {geo(b)}   hidden during the Morph, builds in afterwards')
    for p in pr.blocked:
        lines.append(f'  ! blocked {p.b.label()} would morph from {p.a.label()} '
                     f'({"name" if p.how == "name" else "auto-match"}) but has an entrance animation')
    for n in pr.notes:
        lines.append(f'  ! {n}')


# ---------------------------------------------------------------------------- main
def load_script(path: Path | None) -> dict:
    if path and path.exists():
        return json.loads(path.read_text(encoding='utf-8'))
    return {}


def build_scenes(pptx: Path, objects: Path, out: Path, script: dict, size, fps: int, gap: float, hold: float,
                 only: set | None = None) -> dict:
    pkg = Package(pptx)
    side = json.loads(objects.read_text(encoding='utf-8'))
    if side.get('pptx') != pptx.name:
        print(f'  ! {objects.name} was written for {side.get("pptx")}, not {pptx.name}')
    build_dir = Path(side['build'])
    sidemap = {}
    for k, s in enumerate(side['slides'], start=1):
        for o in s['objects']:
            sidemap[(k, o['spid'])] = o
    nns = [s['nn'] for s in side['slides']]
    assets = Assets(pkg, out, size, fps)
    gap = float(script.get('gap', gap))
    hold = float(script.get('hold', hold))
    per_slide = script.get('slides') or {}
    (out / 'scenes').mkdir(parents=True, exist_ok=True)
    log = [f'Morph pairs per transition - {pptx.name}', 'pair name = forced by a "!!" name; pair AUTO = PowerPoint\'s '
           'automatic match (same shape type and text / same picture), the risky kind; out / in = no partner, fades; '
           'build = has an entrance animation, so it waits for its build']
    manifest = {'pptx': str(pptx), 'size': list(size), 'fps': fps, 'slides': []}
    prev_scene_end = {}
    warnings = []
    for i, cur in enumerate(pkg.slides):
        prev = pkg.slides[i - 1] if i else None
        nn = nns[i] if i < len(nns) else f'{cur.index:02d}'
        cur_objs = [obj_json(o, sidemap.get((cur.index, o.spid)), assets, build_dir) for o in cur.objects]
        prev_objs = ([obj_json(o, sidemap.get((prev.index, o.spid)), assets, build_dir) for o in prev.objects]
                     if prev else None)
        for o in cur_objs:
            if o.get('warn'):
                warnings.append(f'{nn}: {o["label"]}: {o["warn"]}')
        t = cur.transition
        dur = float(t.dur_ms if t.kind in ('morph', 'fade') else 0)
        pr = None
        if t.kind == 'morph' and prev:
            pr = pair_slides(prev.objects, cur.objects, t.option or 'byObject')
            draw = draw_order(pr, prev.objects, cur.objects)
        else:
            draw = []
        log_transition(log, prev, cur, pr)
        groups = main_sequence(cur.timing)
        sc = per_slide.get(nn) or {}
        effects, clicks, ginfo, end = schedule(groups, dur, sc, gap, hold)
        lp = loops(cur.timing)
        media = []
        for e in effects:
            for b in e['behaviours']:
                if b['type'] == 'cmd' and b.get('cmd', '').startswith('playFrom'):
                    m = re.match(r'playFrom\(([\d.]+)\)', b['cmd'])
                    media.append({'key': f's{cur.index}:{b["spid"]}', 'play': b['begin'],
                                  'from': float(m.group(1)) if m else 0.0, 'loop': b['spid'] in lp})
        effects = [e for e in effects if e['presetClass'] != 'mediacall']
        scene = {'nn': nn, 'index': cur.index, 'T': end, 'fps': fps, 'size': list(size),
                 'transition': {'kind': t.kind if (prev or t.kind == 'fade') else 'cut', 'dur': dur,
                                'option': t.option, 'fromBlack': prev is None and t.kind == 'fade'},
                 'prev': prev_objs, 'cur': cur_objs, 'draw': draw, 'effects': effects, 'media': media,
                 'clicks': clicks, 'groups': ginfo,
                 'prevMedia': prev_scene_end.get('media', []), 'prevClock': prev_scene_end.get('T', 0.0)}
        if not only or nn in only:
            (out / 'scenes' / f'{nn}.json').write_text(json.dumps(scene, ensure_ascii=False), encoding='utf-8')
            manifest['slides'].append({'nn': nn, 'scene': str(out / 'scenes' / f'{nn}.json'), 'T': end,
                                       'transition': scene['transition'], 'clicks': clicks})
        # what the next transition starts from: video frame at the end of this slide
        prev_scene_end = {'T': end, 'media': [{'key': m['key'], 'play': m['play'], 'loop': m['loop'], 'from': m['from']}
                                              for m in media]}
    (out / 'morph-log.txt').write_text('\n'.join(log) + '\n', encoding='utf-8')
    (out / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding='utf-8')
    return {'manifest': manifest, 'warnings': warnings, 'log': log}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--pptx', default=str(DECK / 'out' / 'meldy-codingfest11.pptx'))
    ap.add_argument('--objects', default=None, help='default: <pptx>.objects.json written by build.py')
    ap.add_argument('--out', default=str(DECK / 'out' / 'preview' / 'motion'))
    ap.add_argument('--clicks', default=str(DECK / 'slides' / 'preview-clicks.json'))
    ap.add_argument('--size', default='1280x720')
    ap.add_argument('--fps', type=int, default=30)
    ap.add_argument('--gap', type=float, default=1.2, help='s between the end of a build and the next click')
    ap.add_argument('--hold', type=float, default=3.0, help='s a slide stays after its last build')
    ap.add_argument('--only', default=None, help='comma-separated slide numbers')
    a = ap.parse_args(argv)
    pptx = Path(a.pptx)
    objects = Path(a.objects) if a.objects else pptx.with_suffix('.objects.json')
    if not pptx.exists() or not objects.exists():
        print(f'need {pptx} and {objects}: run tools/make.sh (or build.py) first')
        return 2
    w, h = (int(v) for v in a.size.lower().split('x'))
    only = {s.strip().zfill(2) for s in a.only.split(',')} if a.only else None
    script = load_script(Path(a.clicks) if a.clicks else None)
    res = build_scenes(pptx, objects, Path(a.out), script, (w, h), a.fps, a.gap, a.hold, only)
    total = sum(s['T'] for s in res['manifest']['slides'])
    for wmsg in res['warnings']:
        print('  ! ' + wmsg)
    print(f'{len(res["manifest"]["slides"])} scene(s), {total / 1000:.1f} s in all; morph log: {Path(a.out) / "morph-log.txt"}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
