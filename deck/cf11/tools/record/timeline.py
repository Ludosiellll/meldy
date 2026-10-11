"""Print a take's activity, to choose cut points: per 0.1 s, page frames (#) and hand events (·), with the moments.

    python3 -I deck/cf11/tools/record/timeline.py <take dir> [--from 0] [--to 999]

A cut is invisible where neither the page nor the hand moves (a run of blanks): the frame held is the same.
"""
import json
import sys
from pathlib import Path


def arg(name, default):
    return float(sys.argv[sys.argv.index(f'--{name}') + 1]) if f'--{name}' in sys.argv else default


take = json.loads((Path(sys.argv[1]) / 'take.json').read_text())
t0 = take['frames'][0]['t']
lo, hi = arg('from', 0), arg('to', 1e9)
step = 0.1
end = max(f['t'] for f in take['frames']) - t0
buckets = {}
for f in take['frames']:
    k = int((f['t'] - t0) / step)
    buckets.setdefault(k, [0, 0, []])[0] += 1
for e in take['events']:
    k = int((e['t'] - t0) / step)
    b = buckets.setdefault(k, [0, 0, []])
    if e['kind'] in ('move', 'down', 'up', 'tap', 'key', 'pointer'):
        b[1] += 1
    if e['kind'] in ('mark', 'still'):
        b[2].append(('★' if e['kind'] == 'still' else '') + e['name'])
    if e['kind'] in ('down', 'tap'):
        b[2].append(e['kind'])
line = []
k = int(lo / step)
while k * step <= min(end, hi):
    f, h, names = buckets.get(k, [0, 0, []])
    cell = ('#' if f else ' ') + ('·' if h else ' ')
    if k % 10 == 0:
        line.append(f'\n{k * step:6.1f} |')
    line.append(cell)
    if names:
        line.append(f'[{",".join(names)}]')
    k += 1
print(''.join(line))
