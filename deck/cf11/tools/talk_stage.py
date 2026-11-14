"""The stage talk (talk/stage-talk.md) -> the slides' notes and the speaker's Word file.

    tools/.venv/bin/python -I tools/talk_stage.py [--docx <out.docx>] [--wpm 135]

talk/stage-talk.md has one section per slide («## 07-lectures»): «screen:» says what the hall sees, plain lines are what
the speaker says, a line «@a–b text» is said while the slide's film shows its seconds a–b, [brackets] are actions.
1. Each slide's notes in slides-stage/ get the speech as their talk paragraphs (the timing marks dropped); the
   paragraphs «Если спросят…», «О записи…» stay; «Докладчику…» goes (the cues are in the talk now).
2. With --docx: talk/stage-talk.json (the talk, the slides' names, the «если спросят» paragraphs, the clock at --wpm
   words a minute) and tools/talk_stage_docx.cjs writes the Word file from it.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

DECK = Path(__file__).resolve().parent.parent
SLIDES = DECK / 'slides-stage'
SRC = DECK / 'talk' / 'stage-talk.md'
KEEP = ('Если спросят', 'О записи')
WAITS = {'15-conclusion': 9}          # seconds the speaker waits for the dot's scene after the last click


def arg(name, default=None):
    return sys.argv[sys.argv.index(f'--{name}') + 1] if f'--{name}' in sys.argv else default


wpm = float(arg('wpm', 135))
text = re.sub(r'<!--.*?-->', '', SRC.read_text(encoding='utf-8'), flags=re.S)
title = re.search(r'^# (.+)$', text, re.M).group(1).strip()
slides = []
for sec in re.split(r'\n## ', text)[1:]:
    head, body = sec.split('\n', 1)
    key = head.strip()
    screen, parts = '', []
    for line in body.split('\n'):
        line = line.strip()
        if not line:
            continue
        if line.startswith('screen:'):
            screen = line[len('screen:'):].strip()
            continue
        m = re.match(r'^@([\d.]+)–([\d.]+)\s+(.*)$', line)
        parts.append({'at': [float(m.group(1)), float(m.group(2))], 'text': m.group(3)} if m else {'text': line})
    slides.append({'key': key, 'screen': screen, 'parts': parts})


def words(s):
    return len(re.sub(r'\[[^\]]*\]', ' ', s).split())


clock = 0.0
for s in slides:
    html_path = SLIDES / f'{s["key"]}.html'
    html = html_path.read_text(encoding='utf-8')
    sec = re.search(r'<div class="sec"[^>]*>(.*?)</div>', html)
    nav = re.search(r'<div class="nav"[^>]*>(.*?)</div>', html)
    part = re.search(r'<b>(.*?)</b>', nav.group(1)).group(1) if nav and '<b>' in nav.group(1) else ''
    name = re.sub('<[^>]+>', '', sec.group(1)).replace('&nbsp;', ' ') if sec else 'Титульный'
    s['name'] = name + (f' · {part}' if part and name.startswith('Представление') else '')
    m = re.search(r'<template data-pptx="notes">(.*?)</template>', html, re.S)
    old = [p.strip() for p in m.group(1).split('\n\n') if p.strip()]
    s['asked'] = [p for p in old if p.startswith(KEEP)]
    # the notes: the speech, one paragraph per film beat or per line, then what stays
    speech = [p['text'] for p in s['parts']]
    new = '\n\n'.join(speech + s['asked'])
    html_path.write_text(html[:m.start(1)] + new + html[m.end(1):], encoding='utf-8')
    n = sum(words(p['text']) for p in s['parts'])
    s['words'] = n
    s['start'] = clock
    clock += n / wpm * 60 + WAITS.get(s['key'], 0)
    s['end'] = clock
total = sum(s['words'] for s in slides)
out = {'title': title, 'wpm': wpm, 'words': total, 'seconds': clock, 'slides': slides}
(DECK / 'talk' / 'stage-talk.json').write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')
print(f'{len(slides)} slides, {total} words, {clock / 60:.1f} min at {wpm:g} words a minute; notes updated')
docx = arg('docx')
if docx:
    subprocess.run(['node', str(DECK / 'tools' / 'talk_stage_docx.cjs'), str(DECK / 'talk' / 'stage-talk.json'), docx],
                   check=True, env={'NODE_PATH': '/opt/node22/lib/node_modules', 'PATH': '/usr/local/bin:/usr/bin:/bin:/opt/node22/bin'})
