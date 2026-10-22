"""Deck v2 («Сцена», 2026-10-19): crop the live-site stills of account A into deck/cf11/media/product/v2/.

    python tools/record/v2_stills.py <shots dir (2x desktop, 3x phone)> <guest phone shots dir> <07 master frames dir>
                                     [--only name.png,name.png]

Every still is a real screen of https://ludosiel-studyforge.hf.space taken on 19.10.2026 (release 47.3), account A
(the profile name «Команда Meldy») or a guest phone without an account. Re-taken on 22.10.2026 (release 47.26) at the
same windows and crops: lec-konspekt (the lecture page with the fragment panel of «Ключевые тезисы» open: since 21.10
fragments open in a panel from the left, the margin keeps only the sections; a window 76 px narrower and the box moved
to its left edge, the same size, so the panel is not cut), studio-drag (account A's unsent test
«Рыночное равновесие»: the jury's test is never opened in the studio), exam-found (a still at 1024 × 800, ×1.75, at the
moment «Нашли 240 вопросов», before «Сохранить»: nothing saved). --only crops just the named stills. Crops leave out the app's top bar (the
account menu and its initial) and anything personal. Boxes are in source pixels. The output is PNG, reduced to at
most `max_w` pixels wide (about 2x of its box on the slide) and quantised to 256 colours when that shows no visible
loss (flat UI), else kept 24-bit.
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

OUT = Path(__file__).resolve().parents[2] / 'media' / 'product' / 'v2'

# name: (source dir key, file, box (l, t, r, b) or None, max width)
CROPS = {
    # lectures: the result page of the video lecture «Рыночное равновесие, спрос и предложение» (12.10); lec-page.png
    # since 22.10 at 1364 × 900 (×2) with the fragment panel open, cropped from its left edge so the panel shows whole
    'lec-konspekt.png': ('d', 'lec-page.png', (0, 200, 2680, 1800), 2200),
    'lec-podcast.png': ('d', 'lec-podcast.png', (100, 200, 2780, 1800), 2200),
    'lec-talk.png': ('d', 'talk-2.png', (100, 150, 2780, 1290), 2200),
    # exams: the import of the department file (07 master, 11.10, release 44) and «План по дням» (19.10)
    'exam-found.png': ('m', 'm07-04.png', (40, 290, 1760, 1260), 1800),
    'exam-days.png': ('d', 'exam-days.png', (921, 515, 1961, 1285), 1100),
    # the constructor: the studio of the jury test, a block being dragged in; the author's live results
    'studio-drag.png': ('d', 'studio-drag.png', (0, 150, 2880, 1800), 2600),
    'studio-design.png': ('d', 'studio-design.png', (0, 150, 2880, 1800), 2600),
    'quiz-stats.png': ('d', 'stats.png', (100, 220, 2780, 1560), 2200),
    # the guest's phone (390 px, 2x): the test card, question 5 with the author's own picture, the result
    'guest-card.png': ('g', 'g01-card.png', None, 780),
    'guest-q5.png': ('g', 'g03-q5-answered.png', None, 780),
    'guest-result.png': ('g', 'g04-result.png', None, 780),
}


def save(img: Image.Image, path: Path) -> None:
    img = img.convert('RGB')
    q = img.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    back = q.convert('RGB')
    import numpy as np
    err = np.abs(np.asarray(back, dtype=np.int16) - np.asarray(img, dtype=np.int16))
    if err.mean() < 1.2 and np.percentile(err, 99.9) < 24:
        q.save(path, optimize=True)
    else:
        img.save(path, optimize=True)


def main() -> None:
    dirs = {'d': Path(sys.argv[1]), 'g': Path(sys.argv[2]), 'm': Path(sys.argv[3])}
    only = set(sys.argv[sys.argv.index('--only') + 1].split(',')) if '--only' in sys.argv else None
    OUT.mkdir(parents=True, exist_ok=True)
    for name, (key, file, box, max_w) in CROPS.items():
        if only and name not in only:
            continue
        img = Image.open(dirs[key] / file)
        if box:
            img = img.crop(box)
        if img.width > max_w:
            img = img.resize((max_w, round(img.height * max_w / img.width)), Image.LANCZOS)
        save(img, OUT / name)
        print(f'{name:22s} {img.size} {(OUT / name).stat().st_size / 1e3:.0f} kB')


if __name__ == '__main__':
    main()
