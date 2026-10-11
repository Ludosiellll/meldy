"""Optimise the pictures extract.mjs rendered, in place, and report their sizes.

    python imgopt.py <out/build/slides.json>

* Background (opaque, 1920x1080): exact palette PNG when the slide has <= 256 colours; otherwise a 256-colour
  quantisation (median cut / octree, with and without Floyd-Steinberg dithering) is accepted only if it shows no
  visible banding (see `banding_ok`); else PNG24. The smallest accepted candidate wins.
* 2x renders (transparent): trimmed to their painted pixels (an image keeps at least its element box), then the
  same PNG8-with-alpha vs PNG32 choice.
slides.json gets, per picture, the optimised file, its trimmed rectangle in slide px and the byte counts.
"""
from __future__ import annotations

import io
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

# Banding check (0..255 per channel). Errors are measured after a light blur (dither noise and anti-aliasing are
# judged the way the eye sees them) and split by the local detail of the original: banding and colour shifts show
# in smooth areas (fills, soft shadows, gradients), so those must stay almost exact; on detailed pixels
# (anti-aliased glyph and shape edges, UI hairlines) a few levels of error are invisible.
BLUR_RADIUS = 1.5
DETAIL_WINDOW = 5           # px, max-min of the luminance in this window decides "smooth" vs "detail"
SMOOTH_DETAIL = 6           # levels: below this a pixel is smooth
MAX_SMOOTH_P9999 = 2.5      # smooth pixels: 99.99th percentile of the blurred error
MAX_DETAIL_P99 = 12.0       # detailed pixels: 99th percentile of the blurred error
MAX_RAW_MEAN = 1.5          # mean un-blurred error over the whole picture


def png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format='PNG', optimize=True, compress_level=9)
    return buf.getvalue()


def _as_float(img: Image.Image) -> np.ndarray:
    if img.mode == 'RGBA':
        a = np.asarray(img, dtype=np.float32)
        rgb = a[..., :3] * (a[..., 3:4] / 255.0)        # compare premultiplied colour and alpha
        return np.concatenate([rgb, a[..., 3:4]], axis=2)
    return np.asarray(img.convert('RGB'), dtype=np.float32)


def banding_ok(orig: Image.Image, cand: Image.Image) -> tuple[bool, dict]:
    mode = 'RGBA' if orig.mode == 'RGBA' else 'RGB'
    o, c = orig.convert(mode), cand.convert(mode)
    raw = np.abs(_as_float(o) - _as_float(c)).max(axis=2)
    ob = _as_float(o.filter(ImageFilter.GaussianBlur(BLUR_RADIUS)))
    cb = _as_float(c.filter(ImageFilter.GaussianBlur(BLUR_RADIUS)))
    blurred = np.abs(ob - cb).max(axis=2)
    lum = o.convert('L') if mode == 'RGB' else Image.fromarray(np.uint8(_as_float(o)[..., :3].mean(axis=2)))
    detail = (np.asarray(lum.filter(ImageFilter.MaxFilter(DETAIL_WINDOW)), dtype=np.int16)
              - np.asarray(lum.filter(ImageFilter.MinFilter(DETAIL_WINDOW)), dtype=np.int16))
    if mode == 'RGBA':                     # an alpha edge is detail too
        alpha = o.getchannel('A')
        detail = np.maximum(detail, np.asarray(alpha.filter(ImageFilter.MaxFilter(DETAIL_WINDOW)), dtype=np.int16)
                            - np.asarray(alpha.filter(ImageFilter.MinFilter(DETAIL_WINDOW)), dtype=np.int16))
    smooth = detail < SMOOTH_DETAIL
    sm = blurred[smooth] if smooth.any() else np.zeros(1)
    de = blurred[~smooth] if (~smooth).any() else np.zeros(1)
    stats = {'raw_mean': round(float(raw.mean()), 3),
             'smooth_p9999': round(float(np.percentile(sm, 99.99)), 2),
             'detail_p99': round(float(np.percentile(de, 99)), 2),
             'smooth_share': round(float(smooth.mean()), 3)}
    ok = (stats['smooth_p9999'] <= MAX_SMOOTH_P9999 and stats['detail_p99'] <= MAX_DETAIL_P99
          and stats['raw_mean'] <= MAX_RAW_MEAN)
    return ok, stats


def anchored_palette(img: Image.Image, max_anchor: int = 96, min_share: float = 0.0004) -> Image.Image:
    """256-colour palette for an RGB picture: its frequent exact colours (flat UI areas keep their exact brand
    colour) plus median-cut colours for the rest (anti-aliasing, shadows)."""
    w, h = img.size
    colors = img.getcolors(maxcolors=w * h) or []
    colors.sort(reverse=True)
    anchors = [c for n, c in colors if n >= min_share * w * h][:max_anchor]
    mc = img.quantize(256, method=Image.Quantize.MEDIANCUT).getpalette()[:768]
    pal = list(anchors)
    A = np.array(anchors, dtype=np.int32).reshape(-1, 3)
    for i in range(0, len(mc), 3):
        if len(pal) >= 256:
            break
        c = tuple(mc[i:i + 3])
        if len(A) and int(np.abs(A - np.array(c)).max(axis=1).min()) <= 3:
            continue
        pal.append(c)
    flat = [v for c in pal for v in c]
    p = Image.new('P', (1, 1))
    p.putpalette(flat + [0] * (768 - len(flat)))
    return p


def exact_palette(img: Image.Image) -> Image.Image | None:
    """Lossless P image when the picture has at most 256 distinct colours (RGB or RGBA)."""
    colors = img.getcolors(maxcolors=256)
    if colors is None:
        return None
    if img.mode == 'RGBA':
        q = img.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    else:
        q = img.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    back = q.convert(img.mode)
    if np.array_equal(np.asarray(back), np.asarray(img)):
        return q
    # build the palette by hand (quantizers may merge near colours)
    pal_img = Image.new('P', (1, 1))
    flat = []
    for _, c in colors:
        flat.extend(c[:3])
    pal_img.putpalette(flat + [0] * (768 - len(flat)))
    if img.mode == 'RGBA':
        return None
    q = img.quantize(palette=pal_img, dither=Image.Dither.NONE)
    return q if np.array_equal(np.asarray(q.convert('RGB')), np.asarray(img)) else None


def best_png(img: Image.Image) -> tuple[bytes, str, dict]:
    """Return (bytes, mode label, stats) of the smallest acceptable encoding."""
    full = png_bytes(img)
    label_full = 'png32' if img.mode == 'RGBA' else 'png24'
    exact = exact_palette(img)
    if exact is not None:
        b = png_bytes(exact)
        return (b, 'png8-exact', {}) if len(b) < len(full) else (full, label_full, {})
    cands = []
    trials = []
    if img.mode == 'RGBA':
        trials.append(('octree', lambda: img.quantize(colors=256, method=Image.Quantize.FASTOCTREE)))
    else:
        pal = anchored_palette(img)
        # Pillow only dithers when it maps onto a given palette, hence the two-step quantisation
        trials.append(('anchored', lambda: img.quantize(palette=pal, dither=Image.Dither.NONE)))
        trials.append(('anchored-dither', lambda: img.quantize(palette=pal, dither=Image.Dither.FLOYDSTEINBERG)))
        trials.append(('mediancut', lambda: img.quantize(colors=256, method=Image.Quantize.MEDIANCUT)))
    for label, make in trials:
        try:
            q = make()
        except ValueError:
            continue
        ok, stats = banding_ok(img, q)
        if ok:
            cands.append((png_bytes(q), f'png8-{label}', stats))
    cands.sort(key=lambda c: len(c[0]))
    if cands and len(cands[0][0]) < len(full):
        return cands[0]
    return full, label_full, {}


def trim(img: Image.Image, keep: tuple[int, int, int, int] | None):
    """Crop to painted pixels (alpha > 0), never smaller than `keep` (box in image px)."""
    bbox = img.getchannel('A').getbbox()
    if bbox is None:
        return None, None
    if keep:
        bbox = (min(bbox[0], keep[0]), min(bbox[1], keep[1]), max(bbox[2], keep[2]), max(bbox[3], keep[3]))
        bbox = (max(0, bbox[0]), max(0, bbox[1]), min(img.width, bbox[2]), min(img.height, bbox[3]))
    return img.crop(bbox), bbox


def main(slides_json: str) -> int:
    path = Path(slides_json)
    out = path.parent
    doc = json.loads(path.read_text(encoding='utf-8'))
    tot_raw = tot_opt = 0
    print(f"{'slide':>5}  {'picture':<26}{'raw KB':>9}{'opt KB':>9}  mode")
    for s in doc['slides']:
        bg = out / s.get('backgroundRaw', s['background'])
        raw = bg.read_bytes()
        img = Image.open(io.BytesIO(raw)).convert('RGB')
        data, mode, stats = best_png(img)
        dest = bg.with_name('bg.opt.png')
        dest.write_bytes(data)
        s['backgroundRaw'] = s.get('backgroundRaw', s['background'])
        s['background'] = dest.relative_to(out).as_posix()
        s['backgroundInfo'] = {'mode': mode, 'bytes': len(data), 'rawBytes': len(raw), **stats}
        tot_raw += len(raw); tot_opt += len(data)
        print(f"{s['nn']:>5}  {'background':<26}{len(raw) / 1000:9.1f}{len(data) / 1000:9.1f}  {mode} {stats or ''}")
        for e in s['elements']:
            r = e.get('render')
            if not r or 'png' not in r:
                continue
            src = out / r.get('pngRaw', r['png'])
            raw = src.read_bytes()
            img = Image.open(io.BytesIO(raw)).convert('RGBA')
            sc = r.get('scale', 2)
            rect = r['rect']
            keep = None
            if r['mode'] in ('image', 'svg'):
                b = e['box'] if r['mode'] == 'svg' else e['bbox']
                keep = (round((b['x'] - rect['x']) * sc), round((b['y'] - rect['y']) * sc),
                        round((b['x'] + b['w'] - rect['x']) * sc), round((b['y'] + b['h'] - rect['y']) * sc))
            cropped, bbox = trim(img, keep)
            if cropped is None:
                print(f"{s['nn']:>5}  {e['id'] + ' ' + r['mode']:<26}{len(raw) / 1000:9.1f}{0:9.1f}  empty, dropped")
                e.pop('render')
                continue
            data, mode, stats = best_png(cropped)
            dest = src.with_name(src.stem.replace('.opt', '') + '.opt.png')
            dest.write_bytes(data)
            r['pngRaw'] = r.get('pngRaw', r['png'])
            r['png'] = dest.relative_to(out).as_posix()
            r['rectRaw'] = r.get('rectRaw', rect)
            r['rect'] = {'x': round(rect['x'] + bbox[0] / sc, 3), 'y': round(rect['y'] + bbox[1] / sc, 3),
                         'w': round((bbox[2] - bbox[0]) / sc, 3), 'h': round((bbox[3] - bbox[1]) / sc, 3)}
            r['px'] = {'w': cropped.width, 'h': cropped.height}
            r['bytes'] = len(data)
            r['format'] = mode
            tot_raw += len(raw); tot_opt += len(data)
            print(f"{s['nn']:>5}  {e['id'] + ' ' + r['mode']:<26}{len(raw) / 1000:9.1f}{len(data) / 1000:9.1f}  "
                  f"{mode} {cropped.width}x{cropped.height}")
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f"total pictures: {tot_raw / 1e6:.3f} MB rendered -> {tot_opt / 1e6:.3f} MB optimised")
    return 0


if __name__ == '__main__':
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    sys.exit(main(sys.argv[1]))
