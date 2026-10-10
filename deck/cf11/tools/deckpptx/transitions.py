"""Slide transitions.

morph: [MS-PPTX] 2.2.1 / 2.6.1.1 - p:transition with a p159:morph child (option byObject) inside an
       mc:AlternateContent Choice that Requires the p159 namespace; p14:dur ([MS-PPTX] 2.3.2.3) carries the
       duration in ms. The Fallback is a plain Fade, which is what PowerPoint 2013 and older, LibreOffice
       (it has no Morph import) and other readers show. Shape pairs are matched by "!!name" (see build.py).
fade:  ISO 29500 p:fade inside the same AlternateContent pattern ([MS-PPTX] 3.1 example), so p14:dur is honoured.
none:  no p:transition at all.
"""
from __future__ import annotations

from lxml import etree

NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
NS_MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006'
NS_P14 = 'http://schemas.microsoft.com/office/powerpoint/2010/main'
NS_P159 = 'http://schemas.microsoft.com/office/powerpoint/2015/09/main'

DEFAULT_MS = {'morph': 1500, 'fade': 700}


def speed(ms: int) -> str:
    """spd for readers that ignore p14:dur (ISO values: fast 0.5 s, med 0.75 s, slow 1 s)."""
    return 'fast' if ms <= 500 else 'med' if ms <= 750 else 'slow'


def transition_xml(kind: str, dur_ms: int | None = None):
    """The element to insert after p:clrMapOvr, or None for no transition."""
    if kind == 'none':
        return None
    ms = int(dur_ms or DEFAULT_MS[kind])
    spd = speed(ms)
    if kind == 'morph':
        choice = (f'<mc:Choice xmlns:p159="{NS_P159}" xmlns:p14="{NS_P14}" Requires="p159">'
                  f'<p:transition spd="{spd}" p14:dur="{ms}"><p159:morph option="byObject"/></p:transition></mc:Choice>')
    elif kind == 'fade':
        choice = (f'<mc:Choice xmlns:p14="{NS_P14}" Requires="p14">'
                  f'<p:transition spd="{spd}" p14:dur="{ms}"><p:fade/></p:transition></mc:Choice>')
    else:
        raise ValueError(f'unknown transition {kind!r}')
    xml = (f'<mc:AlternateContent xmlns:mc="{NS_MC}" xmlns:p="{NS_P}">{choice}'
           f'<mc:Fallback><p:transition spd="{spd}"><p:fade/></p:transition></mc:Fallback></mc:AlternateContent>')
    return etree.fromstring(xml)


def set_transition(sld_el, kind: str, dur_ms: int | None = None):
    """Replace any transition on a p:sld element (keeps schema order: cSld, clrMapOvr, transition, timing, extLst)."""
    for old in sld_el.findall(f'{{{NS_P}}}transition') + sld_el.findall(f'{{{NS_MC}}}AlternateContent'):
        sld_el.remove(old)
    el = transition_xml(kind, dur_ms)
    if el is None:
        return None
    anchor = sld_el.find(f'{{{NS_P}}}clrMapOvr')
    if anchor is None:
        anchor = sld_el.find(f'{{{NS_P}}}cSld')
    anchor.addnext(el)
    return el
