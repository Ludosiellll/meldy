"""Round-trip the PPTX through LibreOffice (PPTX -> ODP) and check that it reads every animation as intended.

    python lo_roundtrip.py <deck.pptx> <slides.json>      (SOFFICE = LibreOffice 26.x soffice)

LibreOffice maps PowerPoint's preset ids, subtypes and behaviour XML onto its own named effects
(oox/source/ppt/commontimenodecontext.cxx); reading them back is an independent check that the timing XML says
what the HTML asked for: effect, direction (wipe from the left = barWipe leftToRight, not reversed), trigger
(on-click / with-previous / after-previous), the layer pictures moving with their element, and video playback.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

from lxml import etree

NS = {'anim': 'urn:oasis:names:tc:opendocument:xmlns:animation:1.0',
      'presentation': 'urn:oasis:names:tc:opendocument:xmlns:presentation:1.0',
      'smil': 'urn:oasis:names:tc:opendocument:xmlns:smil-compatible:1.0',
      'draw': 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0'}
PRES = '{%s}' % NS['presentation']
SMIL = '{%s}' % NS['smil']
EXPECT = {'fade': ('ooo-entrance-fade-in', None), 'rise': ('ooo-entrance-ascend', None),
          'wipe': ('ooo-entrance-wipe', 'from-left'), 'zoom': ('ooo-entrance-fade-in-and-zoom', None),
          'appear': ('ooo-entrance-appear', None)}
TRIG = {'click': 'on-click', 'with': 'with-previous', 'after': 'after-previous'}
DEFAULT_SOFFICE = '/tmp/claude-0/-home-user/bdd6a3db-98b1-55d9-a278-b6d3039b029b/scratchpad/deck-refs/tech/lo268/root/opt/libreoffice26.8/program/soffice'


def to_odp(pptx: Path, out: Path) -> Path:
    soffice = os.environ.get('SOFFICE', DEFAULT_SOFFICE)
    with tempfile.TemporaryDirectory() as prof:
        subprocess.run([soffice, f'-env:UserInstallation=file://{prof}', '--headless', '--norestore', '--convert-to', 'odp',
                        '--outdir', str(out), str(pptx)], env={**os.environ, 'SAL_USE_VCLPLUGIN': 'svp'},
                       check=True, capture_output=True, timeout=300)
    return out / (pptx.stem + '.odp')


def effects_per_page(odp: Path) -> list[list[dict]]:
    root = etree.fromstring(zipfile.ZipFile(odp).read('content.xml'))
    pages = []
    for page in root.iter('{%s}page' % NS['draw']):
        seq = []
        for node in page.iter():
            pc = node.get(PRES + 'preset-class')
            if not pc:
                continue
            filt = node.find('anim:transitionFilter', NS)
            ys = [a.get(SMIL + 'values') for a in node.findall('anim:animate', NS) if a.get(SMIL + 'attributeName') == 'y']
            cmd = node.find('anim:command', NS)
            seq.append({'class': pc, 'id': node.get(PRES + 'preset-id'), 'sub': node.get(PRES + 'preset-sub-type'),
                        'node': node.get(PRES + 'node-type'),
                        'filter': filt is not None and (filt.get(SMIL + 'type'), filt.get(SMIL + 'subtype'),
                                                        filt.get(SMIL + 'direction', 'forward')),
                        'y': ys[0] if ys else None, 'command': cmd is not None and cmd.get('{%s}command' % NS['anim'])})
        audio = [a for a in page.iter('{%s}audio' % NS['anim'])]
        pages.append({'effects': seq, 'media_repeat': [a.get(SMIL + 'repeatCount') for a in audio]})
    return pages


def expected(slide: dict) -> list[tuple]:
    anim = [e for e in slide['elements'] if e.get('anim')]
    anim.sort(key=lambda e: (e['anim']['order'] if e['anim'].get('order') is not None else e['domIndex'], e['domIndex']))
    out = []
    for i, e in enumerate(anim):
        a = e['anim']
        trig = TRIG[a['trigger']]
        out.append((a['effect'], trig))
        r = e.get('render')
        if r and r['mode'] in ('under', 'over'):
            out.append((a['effect'], 'with-previous'))
    return out


def main() -> int:
    pptx, sj = Path(sys.argv[1]), Path(sys.argv[2])
    doc = json.loads(sj.read_text(encoding='utf-8'))
    fails = 0
    with tempfile.TemporaryDirectory() as td:
        pages = effects_per_page(to_odp(pptx, Path(td)))
    for s, page in zip(doc['slides'], pages):
        entr = [x for x in page['effects'] if x['class'] == 'entrance']
        want = expected(s)
        got = [(next((k for k, v in EXPECT.items() if v[0] == x['id']), x['id']), x['node']) for x in entr]
        problems = []
        if [w for w, _ in want] != [g for g, _ in got]:
            problems.append(f'effects {got} != {want}')
        else:
            for (eff, trig), (_, node), x in zip(want, got, entr):
                if node != trig and not (x is entr[0] and trig == 'after-previous' and node == 'after-previous'):
                    problems.append(f'{eff}: trigger {node}, expected {trig}')
                if eff == 'wipe' and (x['sub'] != 'from-left' or x['filter'] != ('barWipe', 'leftToRight', 'forward')):
                    problems.append(f'wipe reads as {x["sub"]} {x["filter"]}, expected from-left barWipe leftToRight forward')
                if eff == 'rise' and x['y'] != 'y+.1;y':
                    problems.append(f'rise y values {x["y"]}')
        vids = [e for e in s['elements'] if e['type'] == 'video']
        plays = [x for x in page['effects'] if x['class'] == 'media-call' and x['command'] == 'play']
        auto = [v for v in vids if v['src'].get('autoplay', True)]
        if len(plays) != len(auto):
            problems.append(f'{len(plays)} media play commands, {len(auto)} autoplay videos')
        loops = [v for v in vids if v['src'].get('loop')]
        if loops and 'indefinite' not in page['media_repeat']:
            problems.append('looping video not read as repeatCount=indefinite')
        status = 'OK' if not problems else 'FAIL'
        fails += bool(problems)
        print(f"{s['nn']} {status}: {len(entr)} entrance nodes, {len(plays)} play, loops {page['media_repeat']}"
              + ''.join(f'\n     ✗ {p}' for p in problems))
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
