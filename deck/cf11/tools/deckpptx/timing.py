"""Slide timing: entrance effects (main sequence), media playback, build list.

Effect presets (the exact behaviour nodes PowerPoint writes; preset ids/subtypes per the table LibreOffice uses to
read PowerPoint files, oox/source/ppt/commontimenodecontext.cxx `preset_mapping` / `convert_subtype`):

  data-anim | PowerPoint effect (ru UI)             | presetID/Subtype | behaviours
  ----------+--------------------------------------+------------------+---------------------------------------------
  appear    | Appear (Появление)                   | 1 / 0            | set style.visibility=visible
  fade      | Fade (Выцветание)                    | 10 / 0           | set + animEffect transition=in filter=fade
  rise      | Float In, Up (Всплывание, вверх)     | 42 / 0           | set + animEffect fade + anim ppt_x #ppt_x->#ppt_x
            |                                      |                  |   + anim ppt_y "#ppt_y+.1" -> "#ppt_y"
  wipe      | Wipe, From Left (Появление сбоку...) | 22 / 8           | set + animEffect transition=in filter="wipe(left)"
  zoom      | Zoom, Object Center (Масштабирование)| 53 / 16          | set + anim ppt_w 0->#ppt_w + anim ppt_h 0->#ppt_h
            |                                      |                  |   + animEffect fade
Sources: appear, fade, rise and zoom are copied from slides saved by Microsoft Office PowerPoint in LibreOffice's
test corpus (sd/qa/unit/data/pptx/tdf112089.pptx, tdf104788.pptx slide 6, tdf112086.pptx). Wipe: preset 22, subtype
8 = "from-left" (commontimenodecontext.cxx) and filter "wipe(left)" = barWipe leftToRight in the default direction
(pptfilterhelpers.cxx transition table, `mbDirection` true = default geometric direction; the filter names the side
the wipe starts from, PowerPoint's default Wipe From Bottom is "wipe(down)"). Checked by round trip: LibreOffice
turns this XML into its own "ooo-entrance-wipe" / "from-left" = barWipe leftToRight (sd/xml/effects.xml). No
PowerPoint-saved sample of Wipe was available here.

Structure (as PowerPoint writes it, e.g. tdf124457.pptx / bnc591147.pptx):
  tmRoot > mainSeq(seq concurrent=1 nextAc=seek) > click group par (cond delay=indefinite, plus
  cond evt=onBegin tn=<mainSeq id> when it starts with the slide) > sub-group par (cond delay = start ms inside the
  group: "after previous" opens a new sub-group that starts when the previous one ends) > effect par (cTn presetID..,
  nodeType clickEffect | withEffect | afterEffect, cond delay = data-anim-delay).
  Media: <p:video><p:cMediaNode><p:cTn fill=hold display=0 [repeatCount=indefinite]> with end conditions
  onNext/onPrev, plus an interactiveSeq that toggles pause when the video is clicked (bnc591147.pptx).
  Autoplay = a mediacall/presetID 1 playFrom(0.0) effect whose cmd lasts the clip (bnc591147.pptx). It is appended
  as the last sub-group of the click group in which the video appears, so no "after previous" effect waits for it.
  bldLst: a bldP (grpId=0) for every animated shape that carries text, animBg=1 when it also has a fill/outline
  (tdf112086.pptx, tdf124457.pptx); pictures and plain shapes get none (tdf104788.pptx groups).
"""
from __future__ import annotations

from dataclasses import dataclass, field

from lxml import etree

NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
P = f'{{{NS_P}}}'

PRESETS = {
    'appear': (1, 0),
    'fade': (10, 0),
    'rise': (42, 0),
    'wipe': (22, 8),
    'zoom': (53, 16),
}


@dataclass
class Target:
    spid: int
    has_text: bool = False
    has_box: bool = False      # fill or outline drawn by the shape itself (bldP animBg="1")


@dataclass
class Effect:
    target: Target
    effect: str                # appear | fade | rise | wipe | zoom
    trigger: str               # click | with | after
    delay_ms: int = 0
    dur_ms: int = 500
    companions: list = field(default_factory=list)   # Targets that play the same effect "with" this one


@dataclass
class Media:
    spid: int
    dur_ms: int
    loop: bool = False
    autoplay: bool = True
    shown_by: Effect | None = None     # the entrance effect that reveals the video, if any


def _el(tag, parent=None, **attrs):
    e = etree.Element(P + tag) if parent is None else etree.SubElement(parent, P + tag)
    for k, v in attrs.items():
        e.set(k, str(v))
    return e


def _ctn(parent_par, **attrs):
    """<p:cTn> inside a <p:par>; ids are assigned later in document order."""
    return _el('cTn', parent_par, id='0', **attrs)


def _cond(st_lst, delay, evt=None, tn=None, sld=False, sp=None):
    c = _el('cond', st_lst)
    if evt:
        c.set('evt', evt)
    c.set('delay', str(delay))
    if tn is not None:
        _el('tn', c, val=tn)
    if sld or sp is not None:
        t = _el('tgtEl', c)
        if sld:
            _el('sldTgt', t)
        else:
            _el('spTgt', t, spid=sp)
    return c


def _bhvr(parent, spid, dur, fill_hold=True, attr=None, extra_ctn=None):
    cb = _el('cBhvr', parent)
    ctn = _el('cTn', cb, id='0', dur=dur)
    if extra_ctn:
        for k, v in extra_ctn.items():
            ctn.set(k, str(v))
    if fill_hold:
        ctn.set('fill', 'hold')
    tg = _el('tgtEl', cb)
    _el('spTgt', tg, spid=spid)
    if attr:
        al = _el('attrNameLst', cb)
        _el('attrName', al).text = attr
    return cb, ctn


def _set_visible(lst, spid):
    s = _el('set', lst)
    cb, ctn = _bhvr(s, spid, 1)
    _cond(_el('stCondLst', ctn), 0)
    al = _el('attrNameLst', cb)                  # cBhvr children: cTn, tgtEl, attrNameLst
    _el('attrName', al).text = 'style.visibility'
    to = _el('to', s)
    _el('strVal', to, val='visible')


def _anim_effect(lst, spid, dur, flt):
    ae = _el('animEffect', lst, transition='in', filter=flt)
    cb = _el('cBhvr', ae)
    _el('cTn', cb, id='0', dur=dur)
    tg = _el('tgtEl', cb)
    _el('spTgt', tg, spid=spid)


def _anim(lst, spid, dur, attr, frm, to, frm_is_float=False):
    a = _el('anim', lst, calcmode='lin', valueType='num')
    _bhvr(a, spid, dur, attr=attr)
    tl = _el('tavLst', a)
    for tm, val, flt in (('0', frm, frm_is_float), ('100000', to, False)):
        tav = _el('tav', tl, tm=tm)
        v = _el('val', tav)
        if flt:
            _el('fltVal', v, val=val)
        else:
            _el('strVal', v, val=val)


def behaviours(lst, effect: str, spid: int, dur: int):
    """Append the behaviour nodes of one preset to <p:childTnLst> lst."""
    _set_visible(lst, spid)
    if effect == 'fade':
        _anim_effect(lst, spid, dur, 'fade')
    elif effect == 'rise':
        _anim_effect(lst, spid, dur, 'fade')
        _anim(lst, spid, dur, 'ppt_x', '#ppt_x', '#ppt_x')
        _anim(lst, spid, dur, 'ppt_y', '#ppt_y+.1', '#ppt_y')
    elif effect == 'wipe':
        _anim_effect(lst, spid, dur, 'wipe(left)')
    elif effect == 'zoom':
        _anim(lst, spid, dur, 'ppt_w', '0', '#ppt_w', frm_is_float=True)
        _anim(lst, spid, dur, 'ppt_h', '0', '#ppt_h', frm_is_float=True)
        _anim_effect(lst, spid, dur, 'fade')


def effect_par(parent, effect: str, target: Target, node_type: str, delay: int, dur: int):
    pid, sub = PRESETS[effect]
    par = _el('par', parent)
    ctn = _ctn(par, presetID=pid, presetClass='entr', presetSubtype=sub, fill='hold')
    if target.has_text:
        ctn.set('grpId', '0')
    ctn.set('nodeType', node_type)
    _cond(_el('stCondLst', ctn), delay)
    behaviours(_el('childTnLst', ctn), effect, target.spid, dur)
    return par


def media_par(parent, m: Media, node_type: str):
    par = _el('par', parent)
    ctn = _ctn(par, presetID=1, presetClass='mediacall', presetSubtype=0, fill='hold', nodeType=node_type)
    _cond(_el('stCondLst', ctn), 0)
    lst = _el('childTnLst', ctn)
    cmd = _el('cmd', lst, type='call', cmd='playFrom(0.0)')
    cb = _el('cBhvr', cmd)
    _el('cTn', cb, id='0', dur=max(1, m.dur_ms), fill='hold')
    tg = _el('tgtEl', cb)
    _el('spTgt', tg, spid=m.spid)
    return par


def effect_length(e: Effect) -> int:
    return e.delay_ms + (1 if e.effect == 'appear' else e.dur_ms)


def schedule(effects: list[Effect]):
    """Group effects: [[subgroup, ...] per click group], subgroup = [(Effect, nodeType)], plus `auto` flag of group 0."""
    groups: list[list[list]] = []
    auto_first = False
    for i, e in enumerate(effects):
        trig = e.trigger
        if i == 0:
            if trig == 'click':
                groups.append([[(e, 'clickEffect')]])
            else:
                auto_first = True
                groups.append([[(e, 'withEffect' if trig == 'with' else 'afterEffect')]])
            continue
        if trig == 'click':
            groups.append([[(e, 'clickEffect')]])
        elif trig == 'with':
            groups[-1][-1].append((e, 'withEffect'))
        else:
            groups[-1].append([(e, 'afterEffect')])
    return groups, auto_first


def build_timing(effects: list[Effect], media: list[Media]):
    """<p:timing> for one slide, or None when nothing moves and there is no video."""
    if not effects and not media:
        return None
    groups, auto_first = schedule(effects)
    # media play: last sub-group of the click group where the video appears (group 0 = slide start)
    if any(m.autoplay and m.shown_by is None for m in media) and not auto_first:
        groups.insert(0, [])                  # a group that starts with the slide, holding only the playback
        auto_first = True
    plays: dict[int, list[Media]] = {}
    for m in media:
        if not m.autoplay:
            continue
        gi = 0
        if m.shown_by is not None:
            for k, g in enumerate(groups):
                if any(e is m.shown_by for sg in g for e, _ in sg):
                    gi = k
        plays.setdefault(gi, []).append(m)

    timing = _el('timing')
    tn_lst = _el('tnLst', timing)
    root_par = _el('par', tn_lst)
    root = _ctn(root_par, dur='indefinite', restart='never', nodeType='tmRoot')
    root_kids = _el('childTnLst', root)
    bld_targets: list[Target] = []
    if groups:
        seq = _el('seq', root_kids, concurrent='1', nextAc='seek')
        main = _el('cTn', seq, id='0', dur='indefinite', nodeType='mainSeq')
        main_kids = _el('childTnLst', main)
        for gi, g in enumerate(groups):
            gpar = _el('par', main_kids)
            gctn = _ctn(gpar, fill='hold')
            st = _el('stCondLst', gctn)
            _cond(st, 'indefinite')
            if gi == 0 and auto_first:
                _cond(st, 0, evt='onBegin', tn='2')          # mainSeq is cTn id 2 (ids are assigned in order)
            gkids = _el('childTnLst', gctn)
            start = 0
            for sg in g:
                spar = _el('par', gkids)
                sctn = _ctn(spar, fill='hold')
                _cond(_el('stCondLst', sctn), start)
                skids = _el('childTnLst', sctn)
                longest = 0
                for e, node_type in sg:
                    effect_par(skids, e.effect, e.target, node_type, e.delay_ms, e.dur_ms)
                    bld_targets.append(e.target)
                    for c in e.companions:
                        effect_par(skids, e.effect, c, 'withEffect', e.delay_ms, e.dur_ms)
                        bld_targets.append(c)
                    longest = max(longest, effect_length(e))
                start += longest
            ms = plays.get(gi, [])
            if ms:
                spar = _el('par', gkids)
                sctn = _ctn(spar, fill='hold')
                _cond(_el('stCondLst', sctn), start)
                skids = _el('childTnLst', sctn)
                for k, m in enumerate(ms):
                    media_par(skids, m, 'afterEffect' if k == 0 else 'withEffect')
        prev = _el('prevCondLst', seq)
        _cond(prev, 0, evt='onPrev', sld=True)
        nxt = _el('nextCondLst', seq)
        _cond(nxt, 0, evt='onNext', sld=True)
    for m in media:
        v = _el('video', root_kids)
        cm = _el('cMediaNode', v)
        ctn = _el('cTn', cm, id='0')
        if m.loop:
            ctn.set('repeatCount', 'indefinite')
        ctn.set('fill', 'hold')
        ctn.set('display', '0')
        _cond(_el('stCondLst', ctn), 'indefinite')
        end = _el('endCondLst', ctn)
        _cond(end, 0, evt='onNext', sld=True)
        _cond(end, 0, evt='onPrev', sld=True)
        tg = _el('tgtEl', cm)
        _el('spTgt', tg, spid=m.spid)
    for m in media:
        # click on the video toggles pause, as PowerPoint adds for every inserted video
        seq = _el('seq', root_kids, concurrent='1', nextAc='seek')
        ctn = _el('cTn', seq, id='0', restart='whenNotActive', fill='hold', evtFilter='cancelBubble', nodeType='interactiveSeq')
        _cond(_el('stCondLst', ctn), 0, evt='onClick', sp=m.spid)
        es = _el('endSync', ctn, evt='end', delay='0')
        _el('rtn', es, val='all')
        kids = _el('childTnLst', ctn)
        p1 = _el('par', kids)
        c1 = _ctn(p1, fill='hold')
        _cond(_el('stCondLst', c1), 0)
        k1 = _el('childTnLst', c1)
        p2 = _el('par', k1)
        c2 = _ctn(p2, fill='hold')
        _cond(_el('stCondLst', c2), 0)
        k2 = _el('childTnLst', c2)
        p3 = _el('par', k2)
        c3 = _ctn(p3, presetID=2, presetClass='mediacall', presetSubtype=0, fill='hold', nodeType='clickEffect')
        _cond(_el('stCondLst', c3), 0)
        k3 = _el('childTnLst', c3)
        cmd = _el('cmd', k3, type='call', cmd='togglePause')
        cb = _el('cBhvr', cmd)
        _el('cTn', cb, id='0', dur='1', fill='hold')
        tg = _el('tgtEl', cb)
        _el('spTgt', tg, spid=m.spid)
        nxt = _el('nextCondLst', seq)
        _cond(nxt, 0, evt='onClick', sp=m.spid)
    # build list
    seen = set()
    bld = None
    for t in bld_targets:
        if not t.has_text or t.spid in seen:
            continue
        seen.add(t.spid)
        if bld is None:
            bld = _el('bldLst', timing)
        b = _el('bldP', bld, spid=t.spid, grpId='0')
        if t.has_box:
            b.set('animBg', '1')
    # ids in document order: tmRoot = 1, mainSeq = 2 (the onBegin condition above refers to it)
    for i, c in enumerate(timing.iter(P + 'cTn'), start=1):
        c.set('id', str(i))
    return timing
