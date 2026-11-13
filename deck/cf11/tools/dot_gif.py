"""A motion clip with a transparent ground -> an animated GIF that lies over the slide with no ground of its own.

    tools/.venv/bin/python -I tools/dot_gif.py <clip name> [--fps 25] [--hold-last 600]

Why a GIF and not a video: PowerPoint draws a video's dark ground lighter than the slide's canvas on some machines
(TV levels shown as they are; measured on the owner's screen recording of 13.11.2026), so a video over the bare canvas
shows as a rectangle. A GIF is a picture: its colours are exact and its ground is transparent.

1. node motion/render_alpha.mjs <name>: the clip's frames as PNGs with alpha (media/gen/frames/<name>-alpha).
2. Every frame: pixels almost clear become the GIF's transparent colour; the rest are matted on the canvas colour
   (#0b0f16), so the drawing's soft edge is right on the slide. One palette for all frames, no dither.
3. Equal frames in a row become one frame with their time; the last frame stays for --hold-last seconds, so a
   looping player does not start the clip again while the slide is on.
Writes media/gen/<name>.gif and media/gen/<name>.png (the first frame: what the PDF and a reader see).
"""
import subprocess
import sys
from pathlib import Path

from PIL import Image

DECK = Path(__file__).resolve().parent.parent
CANVAS = (11, 15, 22)
KEY = (255, 0, 255)


def arg(name, default):
    return sys.argv[sys.argv.index(f'--{name}') + 1] if f'--{name}' in sys.argv else default


name = sys.argv[1]
fps = int(arg('fps', 25))
hold = float(arg('hold-last', 600))
subprocess.run(['node', str(DECK / 'motion' / 'render_alpha.mjs'), name, '--fps', str(fps)], check=True)
files = sorted((DECK / 'media' / 'gen' / 'frames' / f'{name}-alpha').glob('f*.png'))
frames = [Image.open(f).convert('RGBA') for f in files]
size = frames[0].size


def matte(im):
    rgb = Image.alpha_composite(Image.new('RGBA', im.size, CANVAS + (255,)), im).convert('RGB')
    clear = im.getchannel('A').point(lambda v: 255 if v < 12 else 0)
    return rgb, clear


# one palette: from a sheet of the drawn parts of a spread of frames
drawn = [(im, im.getbbox()) for im in frames if im.getbbox()]
step = max(1, len(drawn) // 40)
crops = [matte(im.crop(box))[0] for im, box in drawn[::step]]
sheet = Image.new('RGB', (sum(c.width for c in crops), max(c.height for c in crops)), CANVAS)
x = 0
for c in crops:
    sheet.paste(c, (x, 0)); x += c.width
pal_img = sheet.quantize(colors=255, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
pal = pal_img.getpalette()[:255 * 3]

out, times = [], []
prev = None
for im in frames:
    rgb, clear = matte(im)
    p = rgb.quantize(palette=pal_img, dither=Image.Dither.NONE).point(lambda i: min(255, i + 1))
    p.putpalette(list(KEY) + pal)
    p.paste(0, mask=clear)
    data = p.tobytes()
    if data == prev:
        times[-1] += 1000 // fps
    else:
        out.append(p); times.append(1000 // fps); prev = data
times[-1] = int(hold * 1000)
gen = DECK / 'media' / 'gen'
gif = gen / f'{name}.gif'
out[0].save(gif, save_all=True, append_images=out[1:], duration=times, loop=0, disposal=2, transparency=0, optimize=False)
frames[0].save(gen / f'{name}.png')
back = Image.open(gif)
print(f'{gif}: {back.n_frames} frames ({len(frames)} rendered at {fps} fps), {size[0]}x{size[1]}, {gif.stat().st_size / 1024:.0f} KB, '
      f'first {times[0]} ms, last {times[-1] // 1000} s, loop {back.info.get("loop")}')
