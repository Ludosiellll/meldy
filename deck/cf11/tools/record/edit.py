"""Turn a take of the live site into a clip's master: the cut, the crossfades, the loop's seam, the camera's beats.

    python3 -I deck/cf11/tools/record/edit.py deck/cf11/tools/record/cut-07.json [--takes DIR] [--masters DIR]

A take (rec.cjs) is the page's own frames as Chromium painted them (each with its wall-clock time) and a log: the
presses and taps, the rectangle each beat shows (Take.box), named moments. The cut file names the stretches of the
take to keep, by those moments ("found-0.4" = 0.4 s before the moment «found», "@12.5" = 12.5 s into the take).
What lies between two stretches is waiting — the server, the system's file window — and is cut; the next stretch
comes in through a crossfade (`fade`, default 0.45 s), so a cut never jumps. Inside a stretch time runs as it ran:
nothing is sped up. Where the page itself swaps for another (a link), the old page dissolves into the new one
(`swaps`: the moments after which that happens). The last `loop.fade` seconds dissolve into the first frame.

The camera is not applied here: the master keeps the whole window, and its json says which rectangle of the page
each beat shows (`camera.keys`: from the take's logged boxes, in CSS px) and when the camera moves there. fit.py
frames it for a screen of any size and draws a ring where the hand pressed (`clicks`).

`mask` (optional): rectangles of the window, in CSS px, that the master and the poster must not keep — the site's top
line with the account's avatar and limit — painted over in one colour (`{"rects": [[x0, y0, x1, y1]], "color": …}`).
The camera never frames them (`camera.y_min`), so the fitted clip is the same with or without the mask. `mask.off`
(optional): stretches of the take, as pairs of moments, where the mask is not painted (a full-window dialog of the app
over the top line, such as the studio's preview; the camera may frame the top line there: fit.py's key `y_min`).

`pointer` (optional, true): the mouse's place in every frame of the master (`pointer` in the json: [x, y, pressed] in
the window's CSS px, or null while hidden), from the take's logged moves and presses; across a cut's crossfade it
glides from where it was to where it is. fit.py draws it.

Writes, in the masters folder (default $MELDY_MASTERS, else <takes>/../masters):
  <clip>-master.mp4   the whole window at the recording's device pixels (laptop 1024 × 800 CSS at 1.75 → 1792 × 1400,
                      phone 390 × 844 at 2 → 780 × 1688), 30 fps, H.264 4:4:4, full range, BT.709, CRF 18
  <clip>-master.json  the stretches; the moments, presses and camera beats in clip seconds; the poster
  <clip>-poster.png   the poster's still: the page re-rendered by Chromium at 3× (`poster.still`); without a still,
                      the take's own frame of `poster.at` at the device's pixels
"""
import bisect
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

DEFAULT_TAKES = '/tmp/claude-0/-home-user/bdd6a3db-98b1-55d9-a278-b6d3039b029b/scratchpad/rec/takes'


def arg(name, default=None):
    if f'--{name}' in sys.argv:
        return sys.argv[sys.argv.index(f'--{name}') + 1]
    return default


def smooth(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


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
    # A still (Chromium re-rendering the page at 3× for the poster) can leak a frame drawn at that scale into the
    # screencast. A leak is a run of frames far from the page as it was before the still that ends with the page
    # back as it was: a transient. Such runs are dropped (the page stood still then).
    leaks = [(e['t'], e.get('t_end', e['t'] + 0.35) + 0.3) for e in take['events'] if e['kind'] == 'still']
    every = sorted(take['frames'], key=lambda f: f['t'])

    def small(f):
        return Image.open(take_dir / 'raw' / f['file']).convert('L').reduce(8)

    def far(ref, img):
        diff = ImageChops.difference(ref, img).point(lambda v: 255 if v > 32 else 0)
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
            d = far(ref, small(f))
            if d > 0.12:
                run.append(f['file'])
            else:
                if run and d < 0.03:
                    bad.update(run)
                run = []
                if d >= 0.03:
                    break
    frames = [f for f in every if f['file'] not in bad]
    times = [f['t'] for f in frames]
    t_first = frames[0]['t']
    marks = {'@': t_first}
    boxes = {}
    for e in take['events']:
        if e['kind'] == 'mark':
            marks.setdefault(e['name'], e['t'])
        elif e['kind'] == 'still':
            marks.setdefault(f"still_{e['name']}", e['t'])
        elif e['kind'] == 'box':
            boxes[e['name']] = e['rect']
    fps = cut.get('fps', 30)
    W, H = Image.open(take_dir / 'raw' / frames[0]['file']).size
    scale = W / take['viewport']['width']
    mask = cut.get('mask') or {}
    mask_rects = mask.get('rects', [])
    mask_color = mask.get('color', '#f3f3f0')
    mask_off = [(moment(a, marks), moment(b, marks)) for a, b in mask.get('off', [])]

    def masked(im, k):
        """The window with the mask's rectangles painted over (k: image pixels per CSS px)."""
        if not mask_rects:
            return im
        im = im.copy()
        d = ImageDraw.Draw(im)
        for r in mask_rects:
            d.rectangle([round(r[0] * k), round(r[1] * k), round(r[2] * k) - 1, round(r[3] * k) - 1], fill=mask_color)
        return im

    def frame_file(t):
        return frames[max(0, bisect.bisect_right(times, t) - 1)]['file']

    # The timeline: the take time of each output frame, the stretch it belongs to, where each stretch begins.
    plan, owner, stretches = [], [], []
    default_fade = cut.get('fade', 0.45)
    for i, seg in enumerate(cut['segments']):
        a, b = moment(seg['from'], marks), moment(seg['to'], marks)
        if b <= a:
            raise SystemExit(f'segment {seg} runs backwards')
        start = len(plan)
        n = round((b - a) * fps)
        plan += [a + k / fps for k in range(n)]
        plan += [b] * round(seg.get('hold', 0) * fps)
        owner += [i] * (len(plan) - start)
        stretches.append({'from': seg['from'], 'to': seg['to'], 'clip_from': round(start / fps, 3), 'clip_to': round(len(plan) / fps, 3),
                          'take_from': round(a - t_first, 3), 'take_to': round(b - t_first, 3), 'hold': seg.get('hold', 0),
                          'fade': 0 if i == 0 else seg.get('fade', default_fade), 'start': start})
    total = len(plan)

    # Page swaps inside a stretch: the first frame after the moment that stays far from the page before it (two
    # frames running: a hover or a press changes a few per cent, a new page 8 % and more, the backgrounds alike).
    swap_fade = cut.get('swap_fade', 0.45)
    threshold = cut.get('swap_threshold', 0.08)
    swaps = []
    for spec in cut.get('swaps', []):
        t = moment(spec, marks)
        pre = frames[max(0, bisect.bisect_right(times, t) - 1)]
        ref = small(pre)
        hit = None
        after = [f for f in frames if t < f['t'] <= t + 8]
        for i, f in enumerate(after):
            if far(ref, small(f)) > threshold and (i + 1 >= len(after) or far(ref, small(after[i + 1])) > threshold):
                hit = f
                break
        if hit is None:
            print(f'  swap after «{spec}»: no page change found within 8 s')
            continue
        # The page as it was just before the swap (the last frame before the far one).
        k = frames.index(hit)
        swaps.append({'spec': spec, 't': hit['t'], 'pre': frames[k - 1]['file'] if k > 0 else hit['file']})
        print(f'  swap after «{spec}»: at take {hit["t"] - t_first:.2f} s')

    loop_fade = round(cut.get('loop', {}).get('fade', 0.5) * fps)
    print(f"{cut['clip']}: {total} frames = {total / fps:.2f} s at {fps} fps, {W}×{H}; {len(bad)} still frame(s) dropped")

    def clip_time(spec):
        """A moment of the take → its second in the clip (the nearest kept frame)."""
        tm = moment(spec, marks)
        k = min(range(total), key=lambda i: abs(plan[i] - tm))
        return round(k / fps, 3)

    # The master: H.264 4:4:4, full range, BT.709, CRF 18 — visually lossless for these pages and small enough to keep
    # in the repository next to the clips.
    out = masters / f'{cut["clip"]}-master.mp4'
    enc = subprocess.Popen(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}',
                            '-r', str(fps), '-i', '-', '-vf', 'scale=out_color_matrix=bt709:out_range=pc,format=yuv444p',
                            '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-tune', 'stillimage', '-g', str(2 * fps),
                            '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'pc',
                            '-movflags', '+faststart', str(out)], stdin=subprocess.PIPE)
    cache = {}

    def load(name):
        if name not in cache:
            if len(cache) > 6:
                cache.pop(next(iter(cache)))
            cache[name] = Image.open(take_dir / 'raw' / name).convert('RGB')
        return cache[name]

    # The mouse: its logged places (moves, presses), hidden and shown again; a press lasts from down to up.
    hand = sorted((e['t'], e['x'], e['y']) for e in take['events'] if e['kind'] in ('pointer', 'move', 'down', 'up'))
    hand_t = [h[0] for h in hand]
    switches = sorted((e['t'], e['kind'] == 'show') for e in take['events'] if e['kind'] in ('hide', 'show'))
    downs = sorted(e['t'] for e in take['events'] if e['kind'] == 'down')
    ups = sorted(e['t'] for e in take['events'] if e['kind'] == 'up')

    def hand_at(t):
        i = bisect.bisect_right(hand_t, t) - 1
        if i < 0:
            return None
        t0, x0, y0 = hand[i]
        if i + 1 < len(hand):
            t1, x1, y1 = hand[i + 1]
            if 0 < t1 - t0 < 0.1:
                q = (t - t0) / (t1 - t0)
                return x0 + (x1 - x0) * q, y0 + (y1 - y0) * q
        return x0, y0

    def hand_shown(t):
        state = True
        for ts, show in switches:
            if ts <= t:
                state = show
        return state

    def hand_pressed(t):
        for td in downs:
            tu = next((u for u in ups if u >= td), td + 0.1)
            if td <= t <= max(tu, td + 0.08):
                return True
        return False

    pointer = []
    first = None
    def page(t):
        """The take's frame at t, with the mask painted unless t lies in one of the mask's off-stretches (each frame
        is masked by its own moment, so a crossfade into an off-stretch never shows what the mask hides)."""
        im = load(frame_file(t))
        return im if any(a <= t <= b for a, b in mask_off) else masked(im, scale)

    for k in range(total):
        t = plan[k]
        im = page(t)
        seg = stretches[owner[k]]
        # A cut: the stretch before dissolves into this one (its last frame held while this one already runs).
        n_fade = round(seg['fade'] * fps)
        if n_fade and k - seg['start'] < n_fade:
            old = page(plan[seg['start'] - 1])
            im = Image.blend(old, im, smooth((k - seg['start'] + 1) / (n_fade + 1)))
        if cut.get('pointer'):
            pos = hand_at(t) if hand_shown(t) else None
            if pos and n_fade and k - seg['start'] < n_fade:
                was = hand_at(plan[seg['start'] - 1])
                if was:
                    e = smooth((k - seg['start'] + 1) / (n_fade + 1))
                    pos = (was[0] + (pos[0] - was[0]) * e, was[1] + (pos[1] - was[1]) * e)
            if pos and loop_fade and k >= total - loop_fade and pointer and pointer[0]:
                e = smooth((k - (total - loop_fade) + 1) / (loop_fade + 1))
                pos = (pos[0] + (pointer[0][0] - pos[0]) * e, pos[1] + (pointer[0][1] - pos[1]) * e)
            pointer.append([round(pos[0], 1), round(pos[1], 1), 1 if hand_pressed(t) else 0] if pos else None)
        # A page swap inside the stretch: the page before it dissolves into the new one.
        for sw in swaps:
            age = t - sw['t']
            if 0 <= age < swap_fade and plan[seg['start']] <= sw['t']:
                pre = load(sw['pre'])
                im = Image.blend(pre if any(a <= t <= b for a, b in mask_off) else masked(pre, scale), im, smooth((age + 1 / fps) / (swap_fade + 1 / fps)))
        if k == 0:
            first = im.copy()
        if loop_fade and k >= total - loop_fade:
            im = Image.blend(im, first, smooth((k - (total - loop_fade) + 1) / (loop_fade + 1)))
        enc.stdin.write(im.tobytes())
    enc.stdin.close()
    if enc.wait() != 0:
        raise SystemExit('ffmpeg failed')

    kept = [(s['take_from'] + t_first, s['take_to'] + t_first, s['start']) for s in stretches]

    def clip_of(t):
        """A take time inside a kept stretch → its clip second; None when it was cut."""
        for a, b, start in kept:
            if a - 0.5 / fps <= t <= b + 0.5 / fps:
                return round((start + (t - a) * fps) / fps, 3)
        return None

    # The presses (a mouse's down, a finger's tap) the clip shows: fit.py draws a ring there.
    clicks = []
    for e in take['events']:
        if e['kind'] in ('down', 'tap'):
            c = clip_of(e['t'])
            if c is not None:
                clicks.append({'clip': c, 'x': round(e['x'], 1), 'y': round(e['y'], 1)})

    # The camera's beats: the rectangle (CSS px) a beat shows, from the boxes the take logged.
    cam = cut.get('camera', {})

    def rect_of(spec):
        if isinstance(spec, list) and len(spec) == 4 and all(isinstance(v, (int, float)) for v in spec):
            return spec
        names = [spec] if isinstance(spec, str) else spec
        missing = [n for n in names if n not in boxes]
        if missing:
            raise SystemExit(f'no box {missing} in the take (it has: {", ".join(boxes)})')
        rs = [boxes[n] for n in names]
        return [min(r[0] for r in rs), min(r[1] for r in rs), max(r[2] for r in rs), max(r[3] for r in rs)]

    keys = []
    for key in cam.get('keys', []):
        k = {'clip': clip_time(key['at']) if not isinstance(key['at'], (int, float)) else key['at'], 'rect': rect_of(key['box'])}
        for field in ('move', 'pad', 'min_w', 'hop', 'anchor', 'y_min'):
            if field in key:
                k[field] = key[field]
        k['beat'] = key.get('beat', key['box'] if isinstance(key['box'], str) else '+'.join(key['box']) if isinstance(key['box'], list) and isinstance(key['box'][0], str) else 'rect')
        keys.append(k)
    keys.sort(key=lambda k: k['clip'])

    moments = {name: clip_of(marks[name]) for name in marks if name != '@' and clip_of(marks[name]) is not None}
    meta = {
        'clip': cut['clip'], 'take': cut['take'],  # as the cut names it: a take in the takes folder
        'size': [W, H], 'viewport': take['viewport'], 'capture_scale': scale,
        'device_scale': take.get('dpr'), 'fps': fps, 'frames': total, 'seconds': round(total / fps, 3), 'loop_fade_frames': loop_fade,
        'stretches': [{k: v for k, v in s.items() if k != 'start'} for s in stretches],
        'swaps': [{'after': s['spec'], 'clip': clip_of(s['t'])} for s in swaps],
        'moments': moments, 'clicks': clicks,
        'camera': {'min_w': cam.get('min_w', 640), 'pad': cam.get('pad', 16), 'move': cam.get('move', 0.9), 'y_min': cam.get('y_min', 0), 'keys': keys},
        'window': cut.get('window', {}),
    }
    if mask_rects:
        meta['mask'] = {'rects': mask_rects, 'color': mask_color}
    if cut.get('pointer'):
        meta['pointer'] = pointer
    poster = cut.get('poster')
    if poster:
        dst = masters / f'{cut["clip"]}-poster.png'
        if poster.get('still'):
            src = take_dir / 'stills' / f"{poster['still']}.png"
            if mask_rects:
                still = Image.open(src)
                masked(still, still.size[0] / take['viewport']['width']).save(dst)
            else:
                shutil.copyfile(src, dst)
            poster_scale = Image.open(src).size[0] / take['viewport']['width']
        else:
            # No still of that moment: the page's own frame, at the take's device pixels (keep it out of a crossfade).
            masked(load(frame_file(moment(poster['at'], marks))), scale).save(dst)
            poster_scale = scale
        meta['poster'] = {'clip': clip_time(poster['at']), 'file': dst.name, 'still': poster.get('still'), 'scale': poster_scale}
    (masters / f'{cut["clip"]}-master.json').write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'  {out} ({out.stat().st_size / 1e6:.1f} MB)')
    for s in stretches:
        print(f'  clip {s["clip_from"]:6.2f}–{s["clip_to"]:6.2f} s  ←  take {s["take_from"]:6.2f}–{s["take_to"]:6.2f} s  ({s["from"]} → {s["to"]}{", fade " + str(s["fade"]) if s["fade"] else ""})')
    for k in keys:
        print(f'  camera {k["clip"]:6.2f} s → {k["beat"]} {[round(v) for v in k["rect"]]}')
    print('  moments: ' + ', '.join(f'{n} {t:.2f}' for n, t in moments.items()))
    if poster:
        print(f'  poster at {meta["poster"]["clip"]:.2f} s ({poster.get("still") or "the take frame"})')


if __name__ == '__main__':
    main()
