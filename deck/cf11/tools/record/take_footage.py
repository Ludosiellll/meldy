"""A local take (rec.cjs: raw screencast frames with their times, the hand's log) -> footage for a screen film:
<out>/m-0001.jpg … at a constant rate (each moment shows the last frame painted before it) and <out>/take.js, which
sets window.TAKE = { fps, frames, seconds, size: [w, h] (the frames' px), k (px per CSS px), view: [w, h] (CSS px),
marks: { name: s }, boxes: { name: [x0, y0, x1, y1] } (CSS px), presses: [{ t, x, y }], taps: [...],
path: [[t, x, y], …] (the pointer) }, times in seconds of the footage.

    python -I take_footage.py <take dir> <out dir> [--fps 30] [--from <mark>] [--to <mark>] [--lead 0.3] [--tail 0.5]
"""
import json, shutil, sys
from pathlib import Path

def arg(name, default=None):
    return sys.argv[sys.argv.index(f'--{name}') + 1] if f'--{name}' in sys.argv else default

take_dir, out = Path(sys.argv[1]), Path(sys.argv[2])
fps = int(arg('fps', 30))
take = json.loads((take_dir / 'take.json').read_text())
frames, events = take['frames'], take['events']
marks_abs = {e['name']: e['t'] for e in events if e['kind'] == 'mark'}
t0 = marks_abs[arg('from')] - float(arg('lead', 0.3)) if arg('from') else frames[0]['t']
t1 = marks_abs[arg('to')] + float(arg('tail', 0.5)) if arg('to') else frames[-1]['t']
t0 = max(t0, frames[0]['t'])
if out.exists(): shutil.rmtree(out)
out.mkdir(parents=True)
n = int((t1 - t0) * fps) + 1
j = 0
for k in range(n):
    t = t0 + k / fps
    while j + 1 < len(frames) and frames[j + 1]['t'] <= t: j += 1
    shutil.copyfile(take_dir / 'raw' / frames[j]['file'], out / f'm-{k + 1:04d}.jpg')
from PIL import Image
w, h = Image.open(out / 'm-0001.jpg').size
vw, vh = take['viewport']['width'], take['viewport']['height']
rel = lambda t: round(t - t0, 3)
data = {
    'fps': fps, 'frames': n, 'seconds': round(n / fps, 3), 'size': [w, h], 'k': round(w / vw, 4), 'view': [vw, vh],
    'marks': {e['name']: rel(e['t']) for e in events if e['kind'] == 'mark' and t0 <= e['t'] <= t1},
    'boxes': {e['name']: [round(v, 1) for v in e['rect']] for e in events if e['kind'] == 'box' and e.get('rect')},
    'presses': [{'t': rel(e['t']), 'x': round(e['x'], 1), 'y': round(e['y'], 1)} for e in events if e['kind'] == 'down' and t0 <= e['t'] <= t1],
    'taps': [{'t': rel(e['t']), 'x': round(e['x'], 1), 'y': round(e['y'], 1)} for e in events if e['kind'] == 'tap' and t0 <= e['t'] <= t1],
    # the pointer's way, for the film's own cursor (the screencast does not draw one)
    'path': [[rel(e['t']), round(e['x'], 1), round(e['y'], 1)] for e in events if e['kind'] in ('pointer', 'move', 'down', 'up') and t0 <= e['t'] <= t1],
}
(out / 'take.js').write_text('window.TAKE = ' + json.dumps(data, ensure_ascii=False) + ';\n', encoding='utf-8')
print(f'{out}: {n} frames at {fps} fps ({data["seconds"]} s), {w}x{h}, {len(data["marks"])} marks, {len(data["boxes"])} boxes, {len(data["presses"])} presses, {len(data["taps"])} taps')
