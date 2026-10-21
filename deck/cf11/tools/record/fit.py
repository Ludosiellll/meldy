"""Fit a clip's master into a slide's screen in one command: the camera, the press rings, the corners, the loop.

    python3 -I deck/cf11/tools/record/fit.py <masters>/<clip>-master.json --box W H [--radius R] [--bg '#0b121c']
                                             [--scale 1] [--start S|poster] [--min-w 640] [--name NAME]
                                             [--out deck/cf11/media/product] [--crf 29]

--box     the video's box on the 1920 × 1080 slide (the <img data-pptx="video"> width and height), CSS px
--radius  its corner radius on the slide (round 2's ink screens: laptop 22, phone 36)
--bg      the colour outside the rounded corners (the bezel around the screen: '#0b121c')
--scale   encoded pixels per slide pixel (default 1: the screen's own size; more only if the master has them)
--start   the clip second the encoded loop begins on (default: the poster's moment). A screen that rides into its
          slide shows its poster during the transition and plays from the clip's first frame when the slide lands;
          begun on the poster's moment, the loop does not jump there.
--min-w   the narrowest region of the page the camera frames, CSS px (default: the master's, 640): the most it
          zooms in (a 1152-px screen: 1.8×)

The camera: each beat of the master (camera.keys: a rectangle of the page in CSS px, from the boxes the take logged)
becomes a region of the screen's shape around it — at least `min_w` wide, never past the window's edges — and the
camera eases there (`move` seconds, in and out; widths change on a log scale, so a zoom keeps its pace). Before the
loop's seam it eases back to the first beat, so the end runs into the start. Every frame is sampled from the master
with sub-pixel precision (no jitter on slow moves). Where the hand pressed (clicks), a soft ring in Meldy's blue
grows and fades; no captions. A master with a `pointer` track (edit.py, a laptop take) gets the mouse pointer drawn
where it was, its size following the camera's zoom (21 CSS px tall, as on the screen). A camera key may carry its own
`y_min` (0: a full-window dialog over the site's top line). loopmask.py rounds the corners onto the bezel's colour
and starts the loop on --start.

Writes <out>/<name>.mp4 (H.264 High, yuv420p, BT.709 tags, CRF 29 at x264's veryslow with adaptive quantisation for
flat pages — as sharp as CRF 26 at 'slow' to the eye, a third smaller —, +faststart, no audio) and <out>/<name>.jpg: the
poster at 2× the box, cut from Chromium's own 3× still of that moment with the camera's region of that moment.
Prints the beats in the encoded clip's seconds (after the loop's new start), for timing a slide's builds.
"""
import json
import math
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent
LOOPMASK = HERE.parent.parent / 'motion' / 'loopmask.py'
BLUE = (40, 105, 221)  # Meldy's blue, as the app paints it


def arg(name, default=None, n=1):
    if f'--{name}' not in sys.argv:
        return default
    i = sys.argv.index(f'--{name}')
    return sys.argv[i + 1] if n == 1 else sys.argv[i + 1:i + 1 + n]


def ease(p):
    """Smootherstep: starts and ends at rest."""
    p = min(1.0, max(0.0, p))
    return p * p * p * (p * (6 * p - 15) + 10)


class Camera:
    """The region of the page (CSS px: left, top, width) the screen shows at each clip second."""

    def __init__(self, meta, aspect, min_w=None):
        cam = meta.get('camera') or {}
        self.vw, self.vh = meta['viewport']['width'], meta['viewport']['height']
        self.aspect = aspect
        self.min_w = float(min_w if min_w is not None else cam.get('min_w', 640))
        # The window's top band the camera keeps out of (a page's pinned top line), CSS px.
        self.y_min = float(cam.get('y_min', 0))
        pad, move = cam.get('pad', 16), cam.get('move', 0.9)
        self.keys = []
        for key in cam.get('keys', []):
            y_min = float(key.get('y_min', self.y_min))
            region = self.region(key['rect'], key.get('pad', pad), key.get('min_w', self.min_w), key.get('anchor', 'center'), y_min)
            self.keys.append({'t': key['clip'], 'region': region, 'move': key.get('move', move), 'hop': key.get('hop', 0.0), 'beat': key.get('beat', ''),
                              'y_min': y_min})
        if not self.keys:
            self.keys.append({'t': 0.0, 'region': self.region([0, 0, self.vw, self.vh], 0, 0, 'center'), 'move': 0, 'hop': 0, 'beat': 'window',
                              'y_min': self.y_min})
        self.keys.sort(key=lambda k: k['t'])
        # The seam: in the last moments the camera goes back to the first beat, so the end runs into the start.
        T = meta['seconds']
        back = meta.get('loop_fade_frames', 15) / meta['fps'] + 0.4
        if self.keys[-1]['region'] != self.keys[0]['region']:
            self.keys.append({'t': max(self.keys[-1]['t'] + 0.1, T - back), 'region': self.keys[0]['region'], 'move': back, 'hop': 0.0, 'beat': 'seam',
                              'y_min': self.keys[0]['y_min']})

    def fits(self, w, y_min=None):
        """The widest region of the screen's shape inside the window below its top band."""
        return min(w, self.vw, (self.vh - (self.y_min if y_min is None else y_min)) * self.aspect)

    def clamp(self, x, y, w, y_min=None):
        h = w / self.aspect
        return (min(max(0.0, x), self.vw - w), min(max(self.y_min if y_min is None else y_min, y), self.vh - h), w)

    def region(self, rect, pad, min_w, anchor, y_min=None):
        x0, y0, x1, y1 = rect[0] - pad, rect[1] - pad, rect[2] + pad, rect[3] + pad
        w, h = x1 - x0, y1 - y0
        rw = self.fits(max(w, h * self.aspect, min_w), y_min)
        rh = rw / self.aspect
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        ry = y0 if anchor == 'top' else cy - rh / 2
        return self.clamp(cx - rw / 2, ry, rw, y_min)

    def at(self, t):
        prev = self.keys[0]
        for i, key in enumerate(self.keys):
            if key['t'] > t:
                break
            if i == 0:
                continue
            p = (t - key['t']) / key['move'] if key['move'] > 0 else 1.0
            if p >= 1:
                prev = key
                continue
            a, b = prev['region'], key['region']
            e = ease(p)
            wa, wb = a[2], b[2]
            w = math.exp(math.log(wa) + (math.log(wb) - math.log(wa)) * e) * (1 + key['hop'] * math.sin(math.pi * e))
            ca = (a[0] + wa / 2, a[1] + wa / self.aspect / 2)
            cb = (b[0] + wb / 2, b[1] + wb / self.aspect / 2)
            cx, cy = ca[0] + (cb[0] - ca[0]) * e, ca[1] + (cb[1] - ca[1]) * e
            y_min = min(prev['y_min'], key['y_min'])
            w = self.fits(w, y_min)
            return self.clamp(cx - w / 2, cy - w / self.aspect / 2, w, y_min)
        return prev['region']

    def beats(self):
        return [(k['t'], k['beat'], k['region']) for k in self.keys]


RING_S = 0.7  # how long a press ring lives, s
ARROW = [(0, 0), (0, 16.6), (4.2, 12.7), (6.9, 19.0), (9.7, 17.9), (7.0, 11.8), (12.4, 11.8)]
ARROW_CSS = 21  # the pointer's height in the page's CSS px: it grows with the camera's zoom, as on a real screen
_arrows = {}


def arrow_sprite(height):
    """The pointer as a computer draws it: dark, a white edge, a soft shadow. (RGBA, offset of the tip)."""
    key = round(height * 4) / 4
    if key in _arrows:
        return _arrows[key]
    k = 8  # supersampling
    unit = key / 20.5
    pad = 6
    size = (int((14 * unit + 2 * pad) * k), int((21 * unit + 2 * pad) * k))
    pts = [((x * unit + pad) * k, (y * unit + pad) * k) for x, y in ARROW]
    shadow = Image.new('L', size, 0)
    ImageDraw.Draw(shadow).polygon([(x + 1.0 * unit * k, y + 1.5 * unit * k) for x, y in pts], fill=90)
    shadow = shadow.filter(ImageFilter.GaussianBlur(1.5 * unit * k))
    zero = Image.new('L', size, 0)
    out = Image.merge('RGBA', (zero, zero, zero, shadow))
    body = Image.new('RGBA', size, (0, 0, 0, 0))
    d = ImageDraw.Draw(body)
    d.polygon(pts, fill=(255, 255, 255, 255), outline=(255, 255, 255, 255), width=max(1, int(2.4 * unit * k)))
    d.polygon(pts, fill=(11, 18, 28, 255))
    out = Image.alpha_composite(out, body)
    _arrows[key] = (out.resize((size[0] // k, size[1] // k), Image.LANCZOS), pad)
    return _arrows[key]


def ring(layer, ox, oy, age, k):
    """A press: a soft ring in Meldy's blue grows from under the finger and fades (0.7 s). A light rim runs along it
    and a light disc flashes under the finger, so the ring reads on the app's blue buttons as on its pale pages."""
    if age < 0 or age > RING_S:
        return
    p = age / RING_S
    grow = 1 - (1 - p) ** 3
    r = (14 + 24 * grow) * k
    width = (3.4 - 1.4 * p) * k
    alpha = 0.95 * (1 - p) ** 1.4
    ss = 4  # drawn at 4× and reduced: a smooth edge
    size = int(2 * (r + width) + 10 * k + 6)
    patch = Image.new('RGBA', (size * ss, size * ss), (0, 0, 0, 0))
    d = ImageDraw.Draw(patch)
    c = size * ss / 2 + ((ox % 1) - 0.5) * ss, size * ss / 2 + ((oy % 1) - 0.5) * ss
    if age < 0.3:
        q = age / 0.3
        rf = (14 + 6 * (1 - (1 - q) ** 2)) * k * ss
        d.ellipse((c[0] - rf, c[1] - rf, c[0] + rf, c[1] + rf), fill=(255, 255, 255, int(255 * 0.32 * (1 - q))))
    R = r * ss
    rim = (width + 3 * k) * ss
    d.ellipse((c[0] - R - rim / 2 + width * ss / 2, c[1] - R - rim / 2 + width * ss / 2, c[0] + R + rim / 2 - width * ss / 2, c[1] + R + rim / 2 - width * ss / 2),
              outline=(255, 255, 255, int(255 * alpha * 0.75)), width=max(1, round(rim)))
    d.ellipse((c[0] - R, c[1] - R, c[0] + R, c[1] + R), outline=BLUE + (int(255 * alpha),), width=max(1, round(width * ss)))
    patch = patch.resize((size, size), Image.LANCZOS)
    paste_clipped(layer, patch, int(math.floor(ox)) - size // 2 + 1, int(math.floor(oy)) - size // 2 + 1)


def paste_clipped(layer, patch, x, y):
    """alpha_composite needs a destination inside the layer: crop the patch to the part that lands there."""
    W, H = layer.size
    sx, sy = max(0, -x), max(0, -y)
    ex, ey = min(patch.size[0], W - x), min(patch.size[1], H - y)
    if ex <= sx or ey <= sy:
        return
    layer.alpha_composite(patch.crop((sx, sy, ex, ey)), (x + sx, y + sy))


def main():
    meta_path = Path(sys.argv[1]).resolve()
    meta = json.loads(meta_path.read_text(encoding='utf-8'))
    masters = meta_path.parent
    box = [int(v) for v in arg('box', n=2)]
    window = meta.get('window', {})
    radius = float(arg('radius', window.get('radius', 22)))
    bg = arg('bg', window.get('bg', '#ffffff'))
    name = arg('name', window.get('name', meta['clip']))
    out_dir = Path(arg('out', str(HERE.parent.parent / 'media' / 'product')))
    crf = arg('crf', '29')
    fps = meta['fps']
    W, H = meta['size']
    s = meta['capture_scale']
    aspect = box[0] / box[1]
    cam = Camera(meta, aspect, arg('min-w'))
    want = float(arg('scale', 1.0))
    px_w = round(box[0] * want)
    px_w -= px_w % 2
    px_h = round(px_w / aspect)
    px_h -= px_h % 2
    k = px_w / box[0]  # encoded pixels per slide pixel
    r_px = max(1, round(radius * k))
    T = meta['frames'] / fps
    start_spec = arg('start', 'poster')
    start_s = (meta.get('poster') or {}).get('clip', 0.0) if start_spec == 'poster' else float(start_spec)
    start_f = round(start_s * fps) % meta['frames']
    print(f'{meta["clip"]}: box {box[0]}×{box[1]} → {px_w}×{px_h} px, radius {r_px}, bg {bg}; loop begins at {start_f / fps:.2f} s', flush=True)
    for t, beat, (x, y, w) in cam.beats():
        print(f'  camera {t:6.2f} s  {beat:10s} x {x:6.1f} y {y:6.1f} w {w:6.1f} CSS px  (zoom {box[0] / w:.2f}×, master px per output px {w * s / px_w:.2f})')

    work = Path(tempfile.mkdtemp(prefix=f'fit-{meta["clip"]}-', dir=str(masters)))
    try:
        crop_dir, fit_dir = work / 'crop', work / 'fit'
        crop_dir.mkdir()
        dec = subprocess.Popen(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', str(masters / f'{meta["clip"]}-master.mp4'),
                               '-vf', 'scale=in_color_matrix=bt709:in_range=pc,format=rgb24', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
                               stdout=subprocess.PIPE)
        clicks = meta.get('clicks', [])
        pointer = meta.get('pointer')
        n = 0
        size = W * H * 3
        while True:
            buf = dec.stdout.read(size)
            if len(buf) < size:
                break
            t = n / fps
            x, y, w = cam.at(t)
            h = w / aspect
            im = Image.frombytes('RGB', (W, H), buf).resize((px_w, px_h), Image.LANCZOS, box=(x * s, y * s, (x + w) * s, (y + h) * s))
            live = [c for c in clicks if 0 <= t - c['clip'] <= RING_S]
            hand = pointer[n] if pointer and n < len(pointer) else None
            if live or hand:
                layer = Image.new('RGBA', im.size, (0, 0, 0, 0))
                for c in live:
                    ring(layer, (c['x'] - x) / w * px_w, (c['y'] - y) / h * px_h, t - c['clip'], k)
                if hand:
                    zoom = px_w / w  # output px per CSS px
                    sprite, pad = arrow_sprite(ARROW_CSS * zoom * (0.9 if hand[2] else 1.0))
                    hx, hy = (hand[0] - x) * zoom, (hand[1] - y) * zoom
                    paste_clipped(layer, sprite, round(hx - pad), round(hy - pad))
                im = Image.alpha_composite(im.convert('RGBA'), layer).convert('RGB')
            im.save(crop_dir / f'f{n:04d}.png', compress_level=1)
            n += 1
        dec.wait()
        subprocess.run(['python3', '-I', str(LOOPMASK), str(crop_dir), str(fit_dir), str(px_w), str(px_h), '--radius', str(r_px), '--bg', bg,
                        '--xfade', '0', '--start', str(start_f)], check=True)
        out_dir.mkdir(parents=True, exist_ok=True)
        mp4 = out_dir / f'{name}.mp4'
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-framerate', str(fps), '-i', str(fit_dir / 'f%04d.png'),
                        '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
                        '-c:v', 'libx264', '-preset', 'veryslow', '-crf', str(crf), '-x264-params', 'aq-mode=3:ref=8:bframes=6:keyint=600',
                        '-profile:v', 'high', '-level:v', '4.0',
                        '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
                        '-movflags', '+faststart', '-an', str(mp4)], check=True)
        print(f'  {mp4} {mp4.stat().st_size / 1024:.0f} KB, {n} frames = {n / fps:.2f} s')
        keep = arg('keep-frames')
        if keep:  # the fitted frames, for trying encoder settings
            shutil.rmtree(keep, ignore_errors=True)
            shutil.copytree(fit_dir, keep)

        poster = meta.get('poster')
        if poster:
            if abs(poster['clip'] - start_f / fps) > 0.5 / fps:
                print(f'  note: the poster is the moment {poster["clip"]:.2f} s, the loop begins at {start_f / fps:.2f} s')
            if any(0 <= poster['clip'] - c['clip'] <= RING_S for c in clicks):
                print('  warning: a press ring is still showing at the poster\'s moment')
            still = Image.open(masters / poster['file']).convert('RGB')
            ps = poster['scale']
            x, y, w = cam.at(poster['clip'])
            h = w / aspect
            pdir, pout = work / 'poster', work / 'poster-out'
            pdir.mkdir()
            pim = still.resize((box[0] * 2, box[1] * 2), Image.LANCZOS, box=(x * ps, y * ps, (x + w) * ps, (y + h) * ps))
            pf = round(poster['clip'] * fps)
            hand = pointer[pf] if pointer and pf < len(pointer) else None
            if hand:  # the pointer where the clip's frame has it, so the loop does not jump when it starts on the poster
                zoom = box[0] * 2 / w
                sprite, pad = arrow_sprite(ARROW_CSS * zoom * (0.9 if hand[2] else 1.0))
                layer = Image.new('RGBA', pim.size, (0, 0, 0, 0))
                paste_clipped(layer, sprite, round((hand[0] - x) * zoom - pad), round((hand[1] - y) * zoom - pad))
                pim = Image.alpha_composite(pim.convert('RGBA'), layer).convert('RGB')
            pim.save(pdir / 'f0000.png')
            subprocess.run(['python3', '-I', str(LOOPMASK), str(pdir), str(pout), str(box[0] * 2), str(box[1] * 2), '--radius', str(round(radius * 2)), '--bg', bg], check=True)
            jpg = out_dir / f'{name}.jpg'
            Image.open(pout / 'f0000.png').convert('RGB').save(jpg, quality=90, subsampling=0, optimize=True)
            print(f'  {jpg} {jpg.stat().st_size / 1024:.0f} KB ({box[0] * 2}×{box[1] * 2})')
    finally:
        shutil.rmtree(work, ignore_errors=True)

    # The beats in the encoded clip's seconds: the loop now begins at start_s.
    def shifted(t):
        return round((t - start_f / fps) % T, 2)

    print(f'  beats in the encoded clip (it begins at the master\'s {start_f / fps:.2f} s, loops every {T:.2f} s):')
    for t, beat, _ in cam.beats():
        print(f'    {shifted(t):6.2f} s  camera → {beat}')
    for nm, t in sorted(meta.get('moments', {}).items(), key=lambda kv: shifted(kv[1])):
        print(f'    {shifted(t):6.2f} s  {nm}')
    for c in clicks:
        print(f'    {shifted(c["clip"]):6.2f} s  press at ({c["x"]:.0f}, {c["y"]:.0f})')


if __name__ == '__main__':
    main()
