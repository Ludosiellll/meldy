"""Re-open a built PPTX and check it against the slides.json it was built from.

    python check_pptx.py <deck.pptx> [<slides.json>] [--deck-rules]

Checks: slide count; each slide's title placeholder text; every "!!name" of the HTML present on its slide; the
background picture at the bottom of the z-order; notes text; transitions (morph / fade / none, Morph with a Fade
fallback); timing (entrance effects, media play + loop) exactly where the HTML asks for it; every live text run in
an embedded Onest face with a language; media and picture relationships resolvable; embedded fonts present, EOT
headers readable and naming the faces the runs use; no hidden slides; core properties without personal data.
--deck-rules adds the contest rules: 10 mandatory names in order, at most 15 slides, file <= 9.5 MB.
Exit status 1 on any failure.
"""
from __future__ import annotations

import argparse
import json
import sys
import zipfile
from pathlib import Path

from lxml import etree
from pptx import Presentation

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from build import MANDATORY, mandatory_order_problems   # noqa: E402
from deckpptx.fonts import FACES, parse_eot_header       # noqa: E402

NS = {'p': 'http://schemas.openxmlformats.org/presentationml/2006/main',
      'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
      'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
      'mc': 'http://schemas.openxmlformats.org/markup-compatibility/2006',
      'p14': 'http://schemas.microsoft.com/office/powerpoint/2010/main',
      'p159': 'http://schemas.microsoft.com/office/powerpoint/2015/09/main'}
P = '{%s}' % NS['p']


def xp(el, expr):
    """XPath with our prefixes (python-pptx elements override .xpath())."""
    return etree.XPath(expr, namespaces=NS)(el)


class Checker:
    def __init__(self):
        self.fails, self.passes = [], 0

    def ok(self, cond: bool, msg: str):
        if cond:
            self.passes += 1
        else:
            self.fails.append(msg)
        return cond


def title_of(sdata: dict) -> str | None:
    t = [e for e in sdata['elements'] if e['type'] == 'title']
    if not t:
        return None
    return ''.join(r['raw'] for p in t[0]['text']['paragraphs'] for ln in p['lines'] for r in ln['runs']).strip()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('pptx')
    ap.add_argument('slides_json', nargs='?')
    ap.add_argument('--deck-rules', action='store_true')
    a = ap.parse_args()
    c = Checker()
    path = Path(a.pptx)
    prs = Presentation(str(path))
    doc = json.loads(Path(a.slides_json).read_text(encoding='utf-8')) if a.slides_json else None
    zf = zipfile.ZipFile(path)

    # ---- package level
    pres = prs.part._element
    c.ok(prs.slide_width == 12192000 and prs.slide_height == 6858000, f'slide size {prs.slide_width}x{prs.slide_height}')
    efl = pres.find(P + 'embeddedFontLst')
    c.ok(pres.get('embedTrueTypeFonts') == '1', 'embedTrueTypeFonts is not set')
    embedded = {}
    if c.ok(efl is not None, 'no p:embeddedFontLst'):
        for ef in efl.findall(P + 'embeddedFont'):
            face = ef.find(P + 'font').get('typeface')
            for slot in ef:
                if slot.tag == P + 'font':
                    continue
                rid = slot.get('{%s}id' % NS['r'])
                part = prs.part.related_part(rid)
                hdr = parse_eot_header(part.blob)
                c.ok(hdr['magic'] == 0x504C and hdr['eotSize'] == len(part.blob), f'{part.partname}: bad EOT header')
                c.ok(hdr['family'] == face, f'{part.partname}: EOT family {hdr["family"]!r} listed as {face!r}')
                want_bold = etree.QName(slot).localname == 'bold'
                c.ok((hdr['subfamily'] == 'Bold') == want_bold, f'{part.partname}: subfamily {hdr["subfamily"]} in slot {etree.QName(slot).localname}')
                c.ok(part.content_type == 'application/x-fontdata', f'{part.partname}: content type {part.content_type}')
                embedded.setdefault(face, set()).add(etree.QName(slot).localname)
    cp = prs.core_properties
    c.ok(cp.title.startswith('Meldy'), f'core title {cp.title!r}')
    c.ok(not cp.author and not cp.last_modified_by, f'personal data in core properties: author={cp.author!r} lastModifiedBy={cp.last_modified_by!r}')
    c.ok('python-pptx' not in (cp.comments or ''), 'template description left in core properties')
    c.ok(not any(n.startswith('ppt/printerSettings') for n in zf.namelist()), 'printer settings part left in the package')
    hidden = [i + 1 for i, s in enumerate(prs.slides) if s._element.get('show') == '0']
    c.ok(not hidden, f'hidden slides: {hidden}')

    # ---- per slide
    slides = list(prs.slides)
    if doc:
        c.ok(len(slides) == len(doc['slides']), f'{len(slides)} slides, slides.json has {len(doc["slides"])}')
    titles = []
    for i, slide in enumerate(slides):
        sd = doc['slides'][i] if doc and i < len(doc['slides']) else None
        tag = f'slide {i + 1}'
        sld = slide._element
        tree = slide.shapes._spTree
        names = [el.get('name') for el in tree.iter(P + 'cNvPr')]
        # title placeholder
        ph = [sp for sp in tree.iter(P + 'sp') if sp.find('.//p:nvPr/p:ph[@type="title"]', NS) is not None]
        ttext = ''.join(xp(ph[0], './/a:t/text()')).strip() if ph else None
        titles.append(ttext or '')
        if sd:
            want = title_of(sd)
            c.ok(ttext == want, f'{tag}: title placeholder {ttext!r}, HTML says {want!r}')
            for e in sd['elements']:
                if e.get('name', '') and e['name'].startswith('!!'):
                    c.ok(e['name'] in names, f'{tag}: {e["name"]} missing')
            # notes
            want_notes = sd.get('notes') or []
            if want_notes:
                got = slide.notes_slide.notes_text_frame.text if slide.has_notes_slide else ''
                c.ok(got.split('\n') == want_notes, f'{tag}: notes differ')
            # transition
            kind = (sd.get('transition') or {}).get('type', 'morph')
            ac = sld.find('mc:AlternateContent', NS)
            if kind == 'none':
                c.ok(ac is None and sld.find(P + 'transition') is None, f'{tag}: a transition is set, HTML says none')
            else:
                ok = ac is not None and ac.find('mc:Fallback/p:transition/p:fade', NS) is not None
                if kind == 'morph':
                    ok = ok and ac.find('mc:Choice/p:transition/p159:morph', NS) is not None
                else:
                    ok = ok and ac.find('mc:Choice/p:transition/p:fade', NS) is not None
                c.ok(ok, f'{tag}: {kind} transition XML missing or wrong')
            # timing
            n_anim = sum(1 for e in sd['elements'] if e.get('anim'))
            videos = [e for e in sd['elements'] if e['type'] == 'video']
            timing = sld.find(P + 'timing')
            if n_anim or videos:
                if c.ok(timing is not None, f'{tag}: no p:timing although {n_anim} animations / {len(videos)} videos'):
                    effects = xp(timing, './/p:cTn[@presetClass="entr"]')
                    mains = [x for x in effects if x.get('nodeType') in ('clickEffect', 'afterEffect', 'withEffect')]
                    c.ok(len(mains) >= n_anim, f'{tag}: {len(mains)} entrance effects, HTML has {n_anim}')
                    clicks = sum(1 for e in sd['elements'] if (e.get('anim') or {}).get('trigger') == 'click')
                    c.ok(len(xp(timing, './/p:cTn[@nodeType="clickEffect"][@presetClass="entr"]')) == clicks,
                         f'{tag}: click-triggered effects differ from the HTML ({clicks})')
                    ids = [int(x.get('id')) for x in timing.iter(P + 'cTn')]
                    c.ok(len(ids) == len(set(ids)) and ids == sorted(ids), f'{tag}: timing cTn ids not unique/ordered')
                    spids = {int(x.get('id')) for x in tree.iter(P + 'cNvPr')}
                    tg = {int(x.get('spid')) for x in timing.iter(P + 'spTgt')}
                    c.ok(tg <= spids, f'{tag}: timing targets missing shapes {sorted(tg - spids)}')
                    for v in videos:
                        auto = v['src'].get('autoplay', True)
                        plays = xp(timing, './/p:cmd[@cmd="playFrom(0.0)"]')
                        if auto:
                            c.ok(len(plays) >= 1, f'{tag}: autoplay video without a playFrom command')
                        loops = xp(timing, './/p:video/p:cMediaNode/p:cTn[@repeatCount="indefinite"]')
                        if v['src'].get('loop'):
                            c.ok(len(loops) >= 1, f'{tag}: looping video without repeatCount=indefinite')
            else:
                c.ok(timing is None, f'{tag}: p:timing present although the HTML has no animation or video')
        # z-order: the background first
        first = next((el for el in tree if el.tag in (P + 'pic', P + 'sp')), None)
        c.ok(first is not None and first.tag == P + 'pic' and first.find('.//p:cNvPr', NS).get('name') == '!!bg',
             f'{tag}: background picture is not at the bottom of the z-order')
        # names unique, !! names unique
        dup = {n for n in names if names.count(n) > 1 and n}
        c.ok(not dup, f'{tag}: duplicate object names {sorted(dup)}')
        # text runs: Onest typefaces + language
        faces = {f.typeface for f in FACES.values()}
        for r in tree.iter('{%s}r' % NS['a']):
            rpr = r.find('a:rPr', NS)
            latin = rpr.find('a:latin', NS) if rpr is not None else None
            if not c.ok(latin is not None and latin.get('typeface') in faces, f'{tag}: a run is not in an Onest face'):
                break
            c.ok(rpr.get('lang'), f'{tag}: a run without lang')
            c.ok(latin.get('typeface') in embedded, f'{tag}: typeface {latin.get("typeface")} is not embedded')
        # relationships resolvable (media, pictures, links)
        for rel in slide.part.rels.values():
            if rel.is_external:
                continue
            c.ok(rel.target_part is not None, f'{tag}: broken relationship {rel.rId}')
        for pic in tree.iter(P + 'pic'):
            vf = pic.find('.//a:videoFile', NS)
            if vf is not None:
                rid = vf.get('{%s}link' % NS['r'])
                part = slide.part.related_part(rid)
                c.ok(part.content_type == 'video/mp4', f'{tag}: video part {part.partname} is {part.content_type}')
                media = pic.find('.//p14:media', NS)
                c.ok(media is not None and slide.part.related_part(media.get('{%s}embed' % NS['r'])) is part,
                     f'{tag}: p14:media does not point at the video part')
    if doc:
        c.ok(all(t for t in titles), 'a slide has no title placeholder text')
    if a.deck_rules:
        for p in mandatory_order_problems(titles):
            c.ok(False, p)
        size = path.stat().st_size
        c.ok(size <= 9_500_000, f'file is {size / 1e6:.2f} MB, budget 9.5 MB')
    print(f'{path.name}: {len(slides)} slides, titles: ' + ' | '.join(titles))
    print(f'embedded fonts: ' + ', '.join(f'{k} ({"+".join(sorted(v))})' for k, v in sorted(embedded.items())))
    for f in c.fails:
        print('  ✗ ' + f)
    print(f'{c.passes} checks passed, {len(c.fails)} failed')
    return 1 if c.fails else 0


if __name__ == '__main__':
    sys.exit(main())
