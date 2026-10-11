"""Turn a take of the live site into a clip's master: the cut, the hand drawn where it really was, the loop's end.

    python3 -I deck/cf11/tools/record/edit.py deck/cf11/tools/record/cut-07.json [--takes DIR] [--masters DIR]

A take (rec.cjs) is the page's own frames as Chromium painted them (each with its wall-clock time) and a log of the
hand: pointer moves, presses, taps, named moments. The cut file names the stretches of the take to keep, by those
moments (`"found-0.4"` = 0.4 s before the moment «found»); everything between them is cut — waits for the server, the
system's file window. Inside a kept stretch time runs as it ran: nothing is sped up. A stretch may end on a held
frame (`hold`, seconds). The last `loop.dissolve` seconds dissolve into the first frame, so the clip loops without a
jump.

Writes, in the masters folder (default: $MELDY_MASTERS, else <takes>/../masters):
  <clip>-master.mp4   the clip at the full window of the recording (laptop 1440 × 900, phone 780 × 1688), 30 fps,
                      H.264 4:4:4, full range, BT.709, CRF 18 (45–49 dB PSNR against the frames: a high-quality
                      intermediate, small enough to commit), the pointer or the touch drawn in
  <clip>-master.json  its size, the kept stretches and the moments in clip seconds, the camera keys, the poster
  <clip>-poster.png   the poster's still, re-rendered by Chromium at 2× (laptop) or 3× (phone)
fit.py fits a master into a slide's window of any size through motion/loopmask.py.
"""
import bisect
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

DEFAULT_TAKES = '/tmp/claude-0/-home-user/bdd6a3db-98b1-55d9-a278-b6d3039b029b/scratchpad/rec/takes'


def arg(name, default=None):
    if f'--{name}' in sys.argv:
        return sys.argv[sys.argv.index(f'--{name}') + 1]
    return default


# ───────────────────────────── the hand ─────────────────────────────

ARROW = [(0, 0), (0, 16.6), (4.2, 12.7), (6.9, 19.0), (9.7, 17.9), (7.0, 11.8), (12.4, 11.8)]


def arrow_sprite(height):
    """The pointer as a computer draws it: black, a white edge, a soft shadow. Returns (RGBA, offset of the tip)."""
    k = 8  # supersampling
    unit = height / 20.5
    pad = 6
    size = (int((14 * unit + 2 * pad) * k), int((21 * unit + 2 * pad) * k))
    pts = [((x * unit + pad) * k, (y * unit + pad) * k) for x, y in ARROW]
    shadow = Image.new('L', size, 0)
    ImageDraw.Draw(shadow).polygon([(x + 1.0 * unit * k, y + 1.5 * unit * k) for x, y in pts], fill=80)
    shadow = shadow.filter(ImageFilter.GaussianBlur(1.5 * unit * k))
    zero = Image.new('L', size, 0)
    out = Image.merge('RGBA', (zero, zero, zero, shadow))
    body = Image.new('RGBA', size, (0, 0, 0, 0))
    d = ImageDraw.Draw(body)
    d.polygon(pts, fill=(255, 255, 255, 255), outline=(255, 255, 255, 255), width=max(1, int(2.4 * unit * k)))
    d.polygon(pts, fill=(11, 18, 28, 255))
    out = Image.alpha_composite(out, body)
    return out.resize((size[0] // k, size[1] // k), Image.LANCZOS), pad


class Hand:
    """Where the pointer (or a finger) was at any moment of the take, and what it was doing."""

    def __init__(self, events, kind, scale):
        self.kind = kind
        self.scale = scale
        self.moves = sorted((e['t'], e['x'], e['y']) for e in events if e['kind'] in ('pointer', 'move', 'down', 'up', 'tap'))
        self.times = [m[0] for m in self.moves]
        self.downs = [(e['t'], e['x'], e['y']) for e in events if e['kind'] == 'down']
        self.ups = sorted(e['t'] for e in events if e['kind'] == 'up')
        self.taps = [(e['t'], e['x'], e['y']) for e in events if e['kind'] == 'tap']
        # Drags: each a list of (t, x, y) from the touch's start to its end.
        self.drags = []
        for e in sorted((e for e in events if e['kind'] in ('touchstart', 'touchmove', 'touchend')), key=lambda e: e['t']):
            if e['kind'] == 'touchstart':
                self.drags.append([(e['t'], e['x'], e['y'])])
            elif self.drags:
                self.drags[-1].append((e['t'], e['x'], e['y']))
        self.switches = sorted((e['t'], e['kind'] == 'show') for e in events if e['kind'] in ('hide', 'show'))
        self.home = (self.moves[0][1], self.moves[0][2]) if self.moves else None
        if kind == 'mouse':
            self.sprite, self.pad = arrow_sprite(26 * scale)
            w, h = self.sprite.size
            self.sprite_down = self.sprite.resize((round(w * 0.9), round(h * 0.9)), Image.LANCZOS)

    def at(self, t):
        """The hand's place at t: between two logged steps of one movement (< 0.1 s apart), on the line between them."""
        i = bisect.bisect_right(self.times, t) - 1
        if i < 0:
            return self.home
        t0, x0, y0 = self.moves[i]
        if i + 1 < len(self.moves):
            t1, x1, y1 = self.moves[i + 1]
            if 0 < t1 - t0 < 0.1:
                p = (t - t0) / (t1 - t0)
                return x0 + (x1 - x0) * p, y0 + (y1 - y0) * p
        return x0, y0

    def shown(self, t):
        """How much of the pointer shows at t (0…1): it fades out in 0.2 s when hidden and back in when shown."""
        level, since, state = 1.0, None, True
        for ts, show in self.switches:
            if ts <= t:
                state, since = show, ts
        if since is None:
            return 1.0
        p = min(1.0, (t - since) / 0.2)
        return p if state else 1.0 - p

    def pressed(self, t):
        for td, _, _ in self.downs:
            tu = next((u for u in self.ups if u >= td), td + 0.1)
            if td <= t <= tu:
                return True
        return False

    def draw(self, frame, t):
        """The hand at take time t, drawn onto an RGB frame."""
        return self._mouse(frame, t) if self.kind == 'mouse' else self._touch(frame, t)

    def _mouse(self, frame, t):
        s = self.scale
        layer = None
        for td, x, y in self.downs:  # the ring of a press: grows and fades in 0.42 s
            age = t - td
            if 0 <= age <= 0.42:
                layer = layer or Image.new('RGBA', frame.size, (0, 0, 0, 0))
                p = age / 0.42
                e = 1 - (1 - p) ** 3
                r = (9 + 17 * e) * s
                a = int(255 * 0.34 * (1 - p))
                ImageDraw.Draw(layer).ellipse((x * s - r, y * s - r, x * s + r, y * s + r), fill=(11, 18, 28, int(a * 0.35)),
                                              outline=(11, 18, 28, a), width=max(1, round(2.2 * s)))
        if layer is not None:
            frame = Image.alpha_composite(frame.convert('RGBA'), layer).convert('RGB')
        pos = self.at(t)
        level = self.shown(t)
        if pos is None or level <= 0:
            return frame
        down = self.pressed(t)
        sprite = self.sprite_down if down else self.sprite
        if level < 1:
            sprite = sprite.copy()
            sprite.putalpha(sprite.getchannel('A').point(lambda a: int(a * level)))
        pad = self.pad * (0.9 if down else 1)
        frame.paste(sprite, (round(pos[0] * s - pad), round(pos[1] * s - pad)), sprite)
        return frame

    def _touch(self, frame, t):
        s = self.scale
        layer = None
        for tt, x, y in self.taps:  # a fingertip: comes in 0.09 s, stays, fades by 0.55 s
            age = t - tt
            if -0.02 <= age <= 0.55:
                layer = layer or Image.new('RGBA', frame.size, (0, 0, 0, 0))
                if age < 0.09:
                    grow, alpha = 0.82 + 0.18 * max(0.0, age) / 0.09, 1.0
                elif age < 0.24:
                    grow, alpha = 1.0, 1.0
                else:
                    p = (age - 0.24) / 0.31
                    grow, alpha = 1.0 + 0.12 * p, 1 - p
                r = 21 * s * grow
                ImageDraw.Draw(layer).ellipse((x * s - r, y * s - r, x * s + r, y * s + r), fill=(11, 18, 28, int(255 * 0.17 * alpha)),
                                              outline=(255, 255, 255, int(255 * 0.85 * alpha)), width=max(1, round(1.6 * s)))
        for steps in self.drags:  # a fingertip: lands, follows the drag as logged, lifts
            t0, t1 = steps[0][0], steps[-1][0]
            if t0 - 0.06 <= t <= t1 + 0.25:
                layer = layer or Image.new('RGBA', frame.size, (0, 0, 0, 0))
                k = max(0, bisect.bisect_right([st[0] for st in steps], t) - 1)
                _, x, y = steps[k]
                alpha = 1.0 if t0 <= t <= t1 else (max(0.0, (t - t0 + 0.06) / 0.06) if t < t0 else max(0.0, 1 - (t - t1) / 0.25))
                r = 21 * s
                ImageDraw.Draw(layer).ellipse((x * s - r, y * s - r, x * s + r, y * s + r), fill=(11, 18, 28, int(255 * 0.17 * alpha)),
                                              outline=(255, 255, 255, int(255 * 0.85 * alpha)), width=max(1, round(1.6 * s)))
        if layer is not None:
            frame = Image.alpha_composite(frame.convert('RGBA'), layer).convert('RGB')
        return frame


# ───────────────────────────── the cut ─────────────────────────────

def moment(spec, marks):
    """«found-0.4» → the take time 0.4 s before the moment «found»; «@20.4» → 20.4 s after the take's first frame."""
    spec = str(spec).strip()
    if spec.startswith('@'):
        return marks['@'] + float(spec[1:])
    m = re.fullmatch(r'([A-Za-z_][\w-]*?)([+-]\d+(?:\.\d+)?)?', spec)
    if not m:
        raise SystemExit(f'bad moment «{spec}»')
    name, off = m.group(1), float(m.group(2) or 0)
    if name not in marks:
        raise SystemExit(f'no moment «{name}» in the take (it has: {", ".join(marks)})')
    return marks[name] + off


def main():
    cut = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
    takes = Path(arg('takes', os.environ.get('MELDY_TAKES', DEFAULT_TAKES)))
    take_dir = Path(cut['take']) if Path(cut['take']).is_absolute() else takes / cut['take']
    masters = Path(arg('masters', os.environ.get('MELDY_MASTERS', str(takes.parent / 'masters'))))
    masters.mkdir(parents=True, exist_ok=True)
    take = json.loads((take_dir / 'take.json').read_text())
    # The screencast's stamps can come a frame out of order: the page's frames in the order they were painted.
    # A still (Chromium re-rendering the page at 2× or 3× for the poster) can leak a frame drawn at that scale into
    # the screencast; the frames sent while it was taken and 0.3 s after are dropped (the page stood still then).
    # A leak is a run of frames far from the page as it was before the still that ends with the page back as it
    # was: a transient. A level meter that keeps moving, or a scroll that starts right after, is not one.
    leaks = [(e['t'], e.get('t_end', e['t'] + 0.35) + 0.3) for e in take['events'] if e['kind'] == 'still']
    every = sorted(take['frames'], key=lambda f: f['t'])

    def small(f):
        return Image.open(take_dir / 'raw' / f['file']).convert('L').reduce(4)

    def far(ref, f):
        diff = ImageChops.difference(ref, small(f)).point(lambda v: 255 if v > 32 else 0)
        return diff.histogram()[255] / (ref.size[0] * ref.size[1])

    bad = set()
    for a, b in leaks:
        before = [f for f in every if f['t'] < a]
        inside = [f for f in every if a <= f['t'] <= b + 0.5]
        if not before or not inside:
            continue
        ref = small(before[-1])
        run = []
        for f in inside:
            d = far(ref, f)
            if d > 0.12:
                run.append(f['file'])
            else:
                if run and d < 0.03:
                    bad.update(run)
                run = []
                if d >= 0.03:
                    break
    frames = [f for f in every if f['file'] not in bad]
    dropped = len(bad)
    times = [f['t'] for f in frames]
    t_first = frames[0]['t']
    marks = {'@': t_first}
    for e in take['events']:
        if e['kind'] == 'mark':
            marks.setdefault(e['name'], e['t'])
        elif e['kind'] == 'still':
            marks.setdefault(f"still_{e['name']}", e['t'])
    fps = cut.get('fps', 30)
    W, H = Image.open(take_dir / 'raw' / frames[0]['file']).size
    scale = W / take['viewport']['width']
    hand = Hand(take['events'], cut.get('pointer', 'mouse'), scale)

    # The timeline: the take time of each output frame; where each kept stretch begins in the clip.
    plan, stretches = [], []
    for seg in cut['segments']:
        a, b = moment(seg['from'], marks), moment(seg['to'], marks)
        if b <= a:
            raise SystemExit(f'segment {seg} runs backwards')
        start = len(plan) / fps
        plan += [a + k / fps for k in range(round((b - a) * fps))]
        plan += [b] * round(seg.get('hold', 0) * fps)
        stretches.append({'from': seg['from'], 'to': seg['to'], 'clip_from': round(start, 3), 'clip_to': round(len(plan) / fps, 3),
                          'take_from': round(a - t_first, 3), 'take_to': round(b - t_first, 3), 'hold': seg.get('hold', 0)})
    dissolve = round(cut.get('loop', {}).get('dissolve', 0.5) * fps)
    total = len(plan)
    print(f"{cut['clip']}: {total} frames = {total / fps:.2f} s at {fps} fps, {W}×{H}; the last {dissolve} dissolve into the first; {dropped} frame(s) of stills dropped")
    # Each cut: invisible when the page looks the same on both sides of it (beyond JPEG noise) and the hand has not moved.
    for i in range(1, len(stretches)):
        a = moment(cut['segments'][i - 1]['to'], marks)
        b = moment(cut['segments'][i]['from'], marks)
        fa = frames[max(0, bisect.bisect_right(times, a) - 1)]['file']
        fb = frames[max(0, bisect.bisect_right(times, b) - 1)]['file']
        box = None
        if fa != fb:
            da = Image.open(take_dir / 'raw' / fa).convert('L')
            db = Image.open(take_dir / 'raw' / fb).convert('L')
            box = ImageChops.difference(da, db).point(lambda v: 255 if v > 24 else 0).getbbox()
        pa, pb = hand.at(a), hand.at(b)
        moved = pa is not None and pb is not None and abs(pa[0] - pb[0]) + abs(pa[1] - pb[1]) > 1
        kind = 'invisible' if box is None and not moved else 'a cut (' + ', '.join(filter(None, [f'page changes in {box}' if box else '', 'the hand moves' if moved else ''])) + ')'
        print(f'  cut {i}: take {a - t_first:.2f} → {b - t_first:.2f} s: {kind}')

    def clip_time(spec):
        """A moment of the take → its second in the clip (the nearest kept frame)."""
        tm = moment(spec, marks)
        k = min(range(total), key=lambda i: abs(plan[i] - tm))
        return round(k / fps, 3)

    # The master: H.264 4:4:4, full range, BT.709, CRF 18 — visually lossless for these pages (PSNR ≈ 46–49 dB
    # against an RGB CRF 8 encode) and small enough to keep in the repository next to the clips.
    out = masters / f'{cut["clip"]}-master.mp4'
    enc = subprocess.Popen(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}',
                            '-r', str(fps), '-i', '-', '-vf', 'scale=out_color_matrix=bt709:out_range=pc,format=yuv444p',
                            '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-tune', 'stillimage', '-g', str(2 * fps),
                            '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'pc',
                            '-movflags', '+faststart', str(out)], stdin=subprocess.PIPE)
    cache = {}

    def frame_at(t):
        f = frames[max(0, bisect.bisect_right(times, t) - 1)]['file']
        if f not in cache:
            cache.clear()
            cache[f] = Image.open(take_dir / 'raw' / f).convert('RGB')
        return cache[f].copy()

    first = None
    for k, t in enumerate(plan):
        im = hand.draw(frame_at(t), t)
        if k == 0:
            first = im.copy()
        if dissolve and k >= total - dissolve:
            im = Image.blend(im, first, (k - (total - dissolve) + 1) / (dissolve + 1))
        enc.stdin.write(im.tobytes())
    enc.stdin.close()
    if enc.wait() != 0:
        raise SystemExit('ffmpeg failed')

    camera = []
    for key in cut.get('camera', []):
        k = dict(key)
        if 'at' in k:
            k['clip'] = clip_time(k.pop('at')) if not isinstance(k['at'], (int, float)) else k.pop('at')
        camera.append(k)
    camera.sort(key=lambda k: k['clip'])
    kept = [(s['take_from'] + t_first, s['take_to'] + t_first) for s in stretches]
    moments = {name: clip_time(name) for name in marks if name != '@' and any(a - 0.5 / fps <= marks[name] <= b + 0.5 / fps for a, b in kept)}
    meta = {
        'clip': cut['clip'], 'take': str(take_dir), 'size': [W, H], 'viewport': take['viewport'], 'capture_scale': scale,
        'device_scale': take.get('dpr'), 'fps': fps, 'frames': total, 'seconds': round(total / fps, 3), 'dissolve_frames': dissolve,
        'stretches': stretches, 'moments': moments, 'camera': camera, 'window': cut.get('window', {}),
    }
    poster = cut.get('poster')
    if poster:
        src = take_dir / 'stills' / f"{poster['still']}.png"
        dst = masters / f'{cut["clip"]}-poster.png'
        shutil.copyfile(src, dst)
        pk = dict(poster.get('camera', {}))
        meta['poster'] = {'file': dst.name, 'still': poster['still'], 'scale': Image.open(src).size[0] / take['viewport']['width'], 'camera': pk}
    (masters / f'{cut["clip"]}-master.json').write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'  {out} ({out.stat().st_size / 1e6:.1f} MB)')
    for s in stretches:
        print(f'  clip {s["clip_from"]:6.2f}–{s["clip_to"]:6.2f} s  ←  take {s["take_from"]:6.2f}–{s["take_to"]:6.2f} s  ({s["from"]} → {s["to"]})')


if __name__ == '__main__':
    main()
