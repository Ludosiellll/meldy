"""Fit a clip's master into a slide's window, through motion/loopmask.py, in one command.

    python3 -I deck/cf11/tools/record/fit.py <masters>/<clip>-master.json --box W H [--radius R] [--scale 1.2]
                                             [--bg #ffffff] [--name NAME] [--out deck/cf11/media/product] [--crf 26]

--box     the video's box on the 1920 × 1080 slide (the <img data-pptx="video"> width and height), CSS px
--radius  its corner radius on the slide (laptop windows 24, the phone 44; round 2's ink screens: 22 and 50)
--bg      the colour outside the rounded corners: the window around the screen on the slide (white cards in round
          1; round 2's devices have ink bezels, so '#0b121c')
--scale   encoded pixels per slide pixel (default 1.2; never more than the master has: no upscaling)

The camera: the master is the whole window of the recording; the master's camera keys say which band of it matters
at each moment ({clip: s, top: y, bottom: y} in the recording's CSS px; `ease`: seconds of a smooth move, 0 = a cut).
Here the band gets the box's shape — the full width of the recording and the height that shape allows, centred on the
key's band (or from its top when the band is taller) — and loopmask.py scales it to the box, rounds the corners onto
the window's colour (--bg) and writes the frames (the master already dissolves its end into its start: --xfade 0).

Writes <out>/<name>.mp4 (H.264 High, yuv420p, BT.709 tags, CRF 26, +faststart, no audio) and <out>/<name>.jpg, the
poster at 2× the box: Chromium's own 2× (laptop) or 3× (phone) still of that moment, with the same band and corners.
"""
import json
import math
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
LOOPMASK = HERE.parent.parent / 'motion' / 'loopmask.py'


def arg(name, default=None, n=1):
    if f'--{name}' not in sys.argv:
        return default
    i = sys.argv.index(f'--{name}')
    return sys.argv[i + 1] if n == 1 else sys.argv[i + 1:i + 1 + n]


def ease(p):
    p = min(1.0, max(0.0, p))
    return 4 * p * p * p if p < 0.5 else 1 - (-2 * p + 2) ** 3 / 2


def band_top(key, band_h, full_h, scale):
    """The top of the band (master px) a camera key asks for, for a band of height band_h."""
    top, bottom = key.get('top', 0) * scale, key.get('bottom', full_h / scale) * scale
    if bottom - top <= band_h:
        y = (top + bottom) / 2 - band_h / 2
    else:
        y = top if key.get('anchor', 'top') == 'top' else bottom - band_h
    return min(max(0.0, y), full_h - band_h)


def camera_at(keys, t, band_h, full_h, scale):
    if not keys:
        return (full_h - band_h) / 2
    prev = None
    for key in keys:
        if key['clip'] <= t + 1e-6:
            prev_key, prev = prev, key
    cur = prev or keys[0]
    y = band_top(cur, band_h, full_h, scale)
    i = keys.index(cur)
    if i > 0 and cur.get('ease', 0) > 0 and t < cur['clip'] + cur['ease']:
        y0 = band_top(keys[i - 1], band_h, full_h, scale)
        y = y0 + (y - y0) * ease((t - cur['clip']) / cur['ease'])
    return y


def main():
    meta_path = Path(sys.argv[1]).resolve()
    meta = json.loads(meta_path.read_text(encoding='utf-8'))
    masters = meta_path.parent
    box = [int(v) for v in arg('box', n=2)]
    radius = float(arg('radius', meta.get('window', {}).get('radius', 24)))
    name = arg('name', meta.get('window', {}).get('name', meta['clip']))
    out_dir = Path(arg('out', str(HERE.parent.parent / 'media' / 'product')))
    crf = arg('crf', '26')
    bg = arg('bg', '#ffffff')
    W, H = meta['size']
    s = meta['capture_scale']
    aspect = box[0] / box[1]
    # The band: the full width of the recording, the box's shape (a phone keeps its height and loses a little width).
    band_w, band_h = W, W / aspect
    if band_h > H:
        band_w, band_h = H * aspect, H
    want = float(arg('scale', 1.2))
    px_w = min(round(box[0] * want), int(band_w))
    px_w -= px_w % 2
    px_h = round(px_w / aspect)
    px_h -= px_h % 2
    enc_scale = px_w / box[0]
    r_px = max(1, round(radius * enc_scale))
    keys = meta.get('camera', [])
    print(f'{meta["clip"]}: box {box[0]}×{box[1]} → {px_w}×{px_h} px (×{enc_scale:.3f}), radius {r_px}, band {band_w:.0f}×{band_h:.0f} of {W}×{H}', flush=True)

    work = Path(tempfile.mkdtemp(prefix=f'fit-{meta["clip"]}-', dir=str(masters)))
    try:
        crop_dir, fit_dir = work / 'crop', work / 'fit'
        crop_dir.mkdir()
        dec = subprocess.Popen(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', str(masters / f'{meta["clip"]}-master.mp4'),
                                '-vf', 'scale=in_color_matrix=bt709:in_range=pc,format=rgb24', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
                               stdout=subprocess.PIPE)
        n = 0
        size = W * H * 3
        x0 = (W - band_w) / 2
        while True:
            buf = dec.stdout.read(size)
            if len(buf) < size:
                break
            im = Image.frombytes('RGB', (W, H), buf)
            y0 = camera_at(keys, n / meta['fps'], band_h, H, s)
            im.crop((round(x0), round(y0), round(x0 + band_w), round(y0 + band_h))).save(crop_dir / f'f{n:04d}.png', compress_level=1)
            n += 1
        dec.wait()
        subprocess.run(['python3', '-I', str(LOOPMASK), str(crop_dir), str(fit_dir), str(px_w), str(px_h), '--radius', str(r_px), '--bg', bg, '--xfade', '0'], check=True)
        out_dir.mkdir(parents=True, exist_ok=True)
        mp4 = out_dir / f'{name}.mp4'
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-framerate', str(meta['fps']), '-i', str(fit_dir / 'f%04d.png'),
                        '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
                        '-c:v', 'libx264', '-preset', 'slow', '-crf', str(crf), '-profile:v', 'high', '-level:v', '4.0',
                        '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
                        '-movflags', '+faststart', '-an', str(mp4)], check=True)
        print(f'  {mp4} {mp4.stat().st_size / 1024:.0f} KB, {n} frames = {n / meta["fps"]:.2f} s')

        poster = meta.get('poster')
        if poster:
            still = Image.open(masters / poster['file']).convert('RGB')
            ps = poster['scale']
            sw, sh = still.size
            pb_w, pb_h = sw, sw / aspect
            if pb_h > sh:
                pb_w, pb_h = sh * aspect, sh
            key = poster.get('camera') or {}
            if not key and keys:
                key = keys[-1]
            py = band_top(key, pb_h, sh, ps) if key else (sh - pb_h) / 2
            px = (sw - pb_w) / 2
            pdir, pout = work / 'poster', work / 'poster-out'
            pdir.mkdir()
            still.crop((round(px), round(py), round(px + pb_w), round(py + pb_h))).save(pdir / 'f0000.png')
            subprocess.run(['python3', '-I', str(LOOPMASK), str(pdir), str(pout), str(box[0] * 2), str(box[1] * 2), '--radius', str(round(radius * 2)), '--bg', bg], check=True)
            jpg = out_dir / f'{name}.jpg'
            Image.open(pout / 'f0000.png').convert('RGB').save(jpg, quality=90, subsampling=0, optimize=True)
            print(f'  {jpg} {jpg.stat().st_size / 1024:.0f} KB ({box[0] * 2}×{box[1] * 2})')
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == '__main__':
    main()
