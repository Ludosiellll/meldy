"""Decode an MP4 and compare the wrap-around step (last frame -> first frame) with ordinary
frame-to-frame steps. A seamless loop has a wrap step no bigger than typical motion steps."""
import subprocess, sys
import numpy as np
f = sys.argv[1]
w, h = [int(x) for x in subprocess.check_output(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
        'stream=width,height', '-of', 'csv=p=0', f]).decode().strip().split(',')]
raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', f, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'])
fr = np.frombuffer(raw, np.uint8).reshape(-1, h, w).astype(np.int16)
steps = [np.abs(fr[i] - fr[i - 1]).mean() for i in range(1, len(fr))]
wrap = np.abs(fr[0] - fr[-1]).mean()
print('%s: %d frames | ordinary step mean %.3f, p95 %.3f, max %.3f | wrap step (last->first) %.3f -> %s'
      % (f.split('/')[-1], len(fr), np.mean(steps), np.percentile(steps, 95), np.max(steps), wrap,
         'seamless' if wrap <= np.percentile(steps, 95) else 'VISIBLE JUMP'))
