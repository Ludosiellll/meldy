"""Frames for the stage deck's game film (motion/game-film.html): the stretches of one recorded game, from the
projector's render and the phone's, named by the recording's ms.

    python3 -I deck/cf11/tools/record/game_film_frames.py <projector.mp4> <phone frames dir> [--out DIR] [--pad MS]
                                                          --ranges 5400-9800,19800-30000,42300-50500,112300-118900

The projector is `frontend/scripts/stand-local.mjs replay` (1920 × 1080, 25 fps: frame f shows the recording's ms
(f + 1) × 40). The phone is `stand_phone_replay.mjs` (p-<ms>.jpg, 780 × 1688). Writes h-<ms>.jpg and p-<ms>.jpg for
every 40 ms of each range (plus `--pad` ms on both sides, default 80) into the out folder (default
deck/cf11/media/gen/footage/game, ignored by git). Fails if a phone frame of a range is missing.
"""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

STEP = 40


def main() -> int:
    args = sys.argv[1:]
    if len(args) < 2:
        print(__doc__)
        return 2
    host, phone = Path(args[0]), Path(args[1])
    opt = lambda k, d: args[args.index(k) + 1] if k in args else d  # noqa: E731
    out = Path(opt('--out', str(Path(__file__).resolve().parents[2] / 'media' / 'gen' / 'footage' / 'game')))
    pad = int(opt('--pad', '80'))
    ranges = [tuple(int(v) for v in r.split('-')) for r in opt('--ranges', '').split(',') if r]
    if not ranges:
        print('give --ranges a-b,c-d (ms of the recording)')
        return 2
    out.mkdir(parents=True, exist_ok=True)
    made = 0
    for a, b in ranges:
        a = max(STEP, (a - pad) // STEP * STEP)
        b = (b + pad + STEP - 1) // STEP * STEP
        n = (b - a) // STEP + 1
        first = a // STEP - 1                      # the projector's frame that shows ms a
        with tempfile.TemporaryDirectory() as tmp:
            subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-ss', f'{first / 25:.3f}', '-i', str(host),
                            '-frames:v', str(n), '-q:v', '2', '-start_number', '0', f'{tmp}/%05d.jpg'], check=True)
            got = sorted(Path(tmp).glob('*.jpg'))
            if len(got) != n:
                print(f'the projector gave {len(got)} frames of {n} for {a}-{b}')
                return 1
            for i, f in enumerate(got):
                shutil.move(str(f), out / f'h-{a + i * STEP:06d}.jpg')
        for ms in range(a, b + 1, STEP):
            src = phone / f'p-{ms:06d}.jpg'
            if not src.exists():
                print(f'no phone frame {src.name}')
                return 1
            shutil.copyfile(src, out / src.name)
        made += n
    print(f'{made} pairs of frames in {out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
