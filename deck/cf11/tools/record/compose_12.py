"""Slide 12's clip: the projector and one student's phone from one recorded game of «Встань на ответ», side by side.

    python3 -I deck/cf11/tools/record/compose_12.py <projector.mp4> <phone frames dir> <cut.json> [--out DIR] [--work DIR]

The projector is `frontend/scripts/stand-local.mjs replay` (a recorded game drawn frame by frame in the real projector
page, 1920 × 1080, 25 fps: frame f shows the recording's ms (f + 1) × 40). The phone is `stand_phone_replay.mjs` (the
same recording in the real phone page, 390 × 844 at 2×, one player followed): p-<ms>.jpg per frame. Both show the
same ms of the same game, so a pair of frames is one moment on both screens.

The cut file names the two stretches of the game to keep (ms of the recording) and the poster's moment. What lies
between them is waiting (everyone already stands on an answer) and is cut; each cut is a crossfade (`fade` s), nothing
is sped up. The loop is A → B → A; the encoded clip begins on the poster's moment inside B (the screen rides into the
slide showing its poster and plays on from there without a jump).

Writes <out>/<name>.mp4 (the box at 1×: H.264 High, yuv420p, BT.709 tags, +faststart, no audio, 25 fps) and
<out>/<name>.jpg (the poster at 2×: the same layout drawn from the same two frames).
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw

CANVAS = (11, 15, 22)          # the slide's dark canvas #0B0F16
BEZEL_EDGE = (38, 46, 59)      # the theme's line #262E3B, as .bezel in design/stage.css


def arg(name, default=None):
    if f'--{name}' in sys.argv:
        return sys.argv[sys.argv.index(f'--{name}') + 1]
    return default


def rounded_mask(size, radius, ss=4):
    w, h = size
    big = Image.new('L', (w * ss, h * ss), 0)
    ImageDraw.Draw(big).rounded_rectangle([0, 0, w * ss - 1, h * ss - 1], radius=radius * ss, fill=255)
    return big.resize(size, Image.LANCZOS)


class Layout:
    """Geometry in slide px (the box on the slide is box[0] × box[1]); `s` = encoded pixels per slide px."""

    def __init__(self, lay: dict, s: float):
        self.s = s
        px = lambda v: int(round(v * s))
        self.size = (px(lay['box'][0]), px(lay['box'][1]))
        pj = lay['projector']
        self.proj_at, self.proj_size, self.proj_r = (px(pj['x']), px(pj['y'])), (px(pj['w']), px(pj['h'])), px(pj['radius'])
        ph = lay['phone']
        self.bezel_at, self.bezel_size, self.bezel_r = (px(ph['x']), px(ph['y'])), (px(ph['w']), px(ph['h'])), px(ph['radius'])
        self.edge = max(1, px(ph['edge']))
        sc = ph['screen']
        self.screen_at = (px(ph['x'] + sc['inset']), px(ph['y'] + sc['inset']))
        self.screen_size = (px(ph['w'] - 2 * sc['inset']), px(ph['h'] - 2 * sc['inset']))
        self.screen_r = px(sc['radius'])
        self.proj_mask = rounded_mask(self.proj_size, self.proj_r)
        self.screen_mask = rounded_mask(self.screen_size, self.screen_r)
        # the bezel: black with the theme's line as its edge, drawn once at 4× and reduced
        ss = 4
        bw, bh = self.bezel_size
        big = Image.new('RGBA', (bw * ss, bh * ss), (0, 0, 0, 0))
        d = ImageDraw.Draw(big)
        d.rounded_rectangle([0, 0, bw * ss - 1, bh * ss - 1], radius=self.bezel_r * ss, fill=BEZEL_EDGE + (255,))
        e = self.edge * ss
        d.rounded_rectangle([e, e, bw * ss - 1 - e, bh * ss - 1 - e], radius=(self.bezel_r - self.edge) * ss, fill=(0, 0, 0, 255))
        self.bezel = big.resize(self.bezel_size, Image.LANCZOS)

    def frame(self, projector: Image.Image, phone: Image.Image) -> Image.Image:
        out = Image.new('RGB', self.size, CANVAS)
        p = projector.convert('RGB').resize(self.proj_size, Image.LANCZOS)
        out.paste(p, self.proj_at, self.proj_mask)
        out.paste(self.bezel, self.bezel_at, self.bezel)
        # the phone's page covers the screen (a fraction of a pixel of the page is cut at its right or bottom edge)
        sw, sh = self.screen_size
        k = max(sw / phone.width, sh / phone.height)
        w, h = max(sw, round(phone.width * k)), max(sh, round(phone.height * k))
        f = phone.convert('RGB').resize((w, h), Image.LANCZOS).crop((0, 0, sw, sh))
        out.paste(f, self.screen_at, self.screen_mask)
        return out


def projector_frames(video: Path, spans: list[tuple[int, int]], work: Path) -> dict[int, Path]:
    """The projector's frames of the spans (ms of the recording) as PNGs: {ms: file}."""
    out = {}
    work.mkdir(parents=True, exist_ok=True)
    for a, b in spans:
        f0, f1 = a // 40 - 1, b // 40 - 1
        pattern = work / f'proj-{a}-%05d.png'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(video), '-vf', f"select='between(n,{f0},{f1})'",
                        '-vsync', '0', '-start_number', str(f0), str(pattern)], check=True)
        for f in range(f0, f1 + 1):
            p = work / f'proj-{a}-{f:05d}.png'
            if p.exists():
                out[(f + 1) * 40] = p
    return out


def main():
    video, phone_dir, cut_path = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    cut = json.loads(cut_path.read_text(encoding='utf-8'))
    out_dir = Path(arg('out', 'deck/cf11/media/product'))
    work = Path(arg('work', '/tmp/compose-12'))
    fps = cut.get('fps', 25)
    step = 1000 // fps
    fade_n = round(cut.get('fade', 0.4) * fps)
    A, B = cut['segments']
    spans = [(A['from'], A['to']), (B['from'], B['to'])]
    proj = projector_frames(video, spans, work / 'proj')
    seq = lambda a, b: list(range(a, b + 1, step))
    a_ms, b_ms = seq(*spans[0]), seq(*spans[1])
    # one cycle A → B → A, each cut a crossfade of fade_n frames: (ms, ms of the frame dissolving in, its weight)
    cyc = []
    for ms in a_ms[:len(a_ms) - fade_n]:
        cyc.append((ms, None, 0.0))
    for k in range(fade_n):
        cyc.append((a_ms[len(a_ms) - fade_n + k], b_ms[k], (k + 1) / (fade_n + 1)))
    for ms in b_ms[fade_n:len(b_ms) - fade_n]:
        cyc.append((ms, None, 0.0))
    # the B → A seam dissolves into A's first frame, which comes next in the cycle: the loop closes on it
    for k in range(fade_n):
        cyc.append((b_ms[len(b_ms) - fade_n + k], a_ms[0], (k + 1) / (fade_n + 1)))
    poster = cut['poster']
    start = next(i for i, (ms, other, w) in enumerate(cyc) if other is None and ms >= poster)
    cyc = cyc[start:] + cyc[:start]
    lay1 = Layout(cut['layout'], 1)
    lay2 = Layout(cut['layout'], 2)
    load_phone = lambda ms: Image.open(phone_dir / f'p-{ms:06d}.jpg')
    frames = work / 'out'
    shutil.rmtree(frames, ignore_errors=True)
    frames.mkdir(parents=True)
    cache = {}

    def pair(ms, lay):
        key = (ms, lay.s)
        if key not in cache:
            if len(cache) > 40:
                cache.clear()
            cache[key] = lay.frame(Image.open(proj[ms]), load_phone(ms))
        return cache[key]

    for i, (ms, other, w) in enumerate(cyc):
        im = pair(ms, lay1)
        if other is not None:
            im = Image.blend(im, pair(other, lay1), w)
        im.save(frames / f'f{i:04d}.png')
    name = cut['name']
    mp4 = out_dir / f'{name}.mp4'
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-framerate', str(fps), '-i', str(frames / 'f%04d.png'),
                    '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow',
                    '-crf', str(cut.get('crf', 22)), '-profile:v', 'high', '-level:v', '4.0',
                    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
                    '-movflags', '+faststart', '-an', str(mp4)], check=True)
    still = pair(poster, lay2)
    still.save(out_dir / f'{name}.jpg', quality=90, optimize=True)
    total = len(cyc) / fps
    print(f'{mp4}: {len(cyc)} frames, {total:.2f} s, {mp4.stat().st_size / 1e6:.2f} MB; poster at {poster} ms '
          f'({out_dir / (name + ".jpg")}, {(out_dir / (name + ".jpg")).stat().st_size / 1e3:.0f} KB)')
    # when each moment comes in the encoded clip (for timing the slide and the notes)
    for label, ms in cut.get('moments', {}).items():
        hits = [i for i, (m, other, w) in enumerate(cyc) if m == ms]
        if hits:
            print(f'  {label}: {hits[0] / fps:.2f} s')


if __name__ == '__main__':
    main()
