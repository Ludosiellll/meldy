"""Does a film tremble? A film rendered by several pages in turn has frames that differ from the one before them but equal
the one N frames back (render.mjs, 18.11). Prints, for N = 2, 3, 4, the share of changing cells with that signature:
a clean film stays near 1 %, oral-film rendered with --jobs 4 had 56 % at N = 4.   python3 motion/check_cycle.py <film.mp4>"""
import sys, subprocess, numpy as np
f = sys.argv[1]
w, h = map(int, subprocess.check_output(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', f]).decode().strip().split(','))
raw = subprocess.Popen(['ffmpeg', '-v', 'error', '-i', f, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], stdout=subprocess.PIPE)
cell = 40; gy, gx = h // cell, w // cell
frames = []
while True:
    b = raw.stdout.read(w * h)
    if len(b) < w * h: break
    frames.append(np.frombuffer(b, np.uint8).reshape(h, w).astype(np.int16))
    if len(frames) > 6: frames.pop(0)
    if len(frames) < 5: continue
    cur = frames[-1]
    def g(a, b_): return np.abs(a - b_)[:gy * cell, :gx * cell].reshape(gy, cell, gx, cell).max(axis=(1, 3))
    d1 = g(cur, frames[-2])
    row = [int((d1 > 40).sum())]
    for n in (2, 3, 4):
        dn = g(cur, frames[-1 - n])
        row.append(int(((d1 > 40) & (dn < 12)).sum()))
    sys.stdout.write('') ; globals().setdefault('rows', []).append(row)
r = np.array(rows)
tot = r[:, 0].sum()
print(f"{f.split('/')[-1]:22s} steps {len(r):5d}  cells changing {tot:7d}  back to N=2: {r[:,1].sum()/max(tot,1):5.1%}  N=3: {r[:,2].sum()/max(tot,1):5.1%}  N=4: {r[:,3].sum()/max(tot,1):5.1%}")
