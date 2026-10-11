"""Live text: an extracted text element -> p:txBody (and the frame geometry it needs).

Horizontal fidelity
  * Every soft line break Chromium made becomes <a:br/>, so the HTML's line breaks survive whatever the renderer's
    own line breaking would do. The frame is then widened by a slack S = max(10 % of the text width, 24 px) on the
    side(s) the alignment allows (right for left-aligned text, half each side for centred text, left for
    right-aligned text), so a substituted font up to ~10 % wider still does not wrap. Mixed alignments widen both
    sides and compensate with marL/marR. A text with its own fill/border (a pill) keeps its exact box and gets
    wrap="none" instead (its box is visible, so it cannot grow). The slack stops at the slide edge.
  * Inside a preset geometry the text lives in the preset's text rectangle (roundRect: inset r * 0.29289), so the
    CSS padding is reduced by that inset.
  * Letter spacing: CSS adds it after every character, the last one of a line included; LibreOffice does not add
    it after the last character (measured: right-aligned text with -4 px tracking moved by -4.6 px). Right-aligned
    and centred lines are shifted by that amount (whole for right, half for centre) through the paragraph margins.

Vertical fidelity
  * Line spacing is exact (a:spcPts = the CSS line height). Impress formats slide text with a font-independent
    line model, its emulation of PowerPoint's ("fixed cell height", editeng impedit3.cxx:
    ImplCalculateFontIndependentLineSpacing / RecalcFormatterFontMetrics): a line is 1.2 em with ascent 1.0 em and
    descent 0.2 em whatever the font's own metrics, and an exact spacing L adds the difference above the text
    (SvxLineSpaceRule::Fix: ascent += L - natural). So baseline = line top + L - 0.2 * font size, which the
    calibration in research/calibrate_lines.py confirms (0.205 em measured). The first line top is placed so the
    first baseline lands where Chromium drew it; later paragraphs get spcBef so their first baselines land too.
    PowerPoint itself could not be measured here; its single spacing is the same 1.2 em model (see README).
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from lxml import etree

from .dml import color_el
from .fonts import face_for_weight
from .shapes import box_geometry, text_rect_insets
from .units import emu, pt100

NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
A = f'{{{NS_A}}}'

SLACK_FRAC = 0.10
SLACK_MIN_PX = 24.0
SLIDE_W, SLIDE_H = 1920.0, 1080.0   # the frame (with its slack) stays on the slide
CELL_DESCENT_EM = 0.2       # font-independent line model: line = 1.2 em, baseline 1.0 em below the line top
HLINK_COLOR_EXT = '{A12FA001-AC4F-418D-AE19-62706E023703}'   # [MS-ODRAWXML] 2.35 hlinkClr ("tx" = text colour)
NS_AHYP = 'http://schemas.microsoft.com/office/drawing/2018/hyperlinkcolor'

LANGS = {'ru': 'ru-RU', 'en': 'en-US', 'be': 'be-BY', 'uk': 'uk-UA', 'de': 'de-DE'}


def ooxml_lang(lang: str | None) -> str:
    if not lang:
        return 'ru-RU'
    parts = lang.replace('_', '-').split('-')
    if len(parts) >= 2:
        return f'{parts[0].lower()}-{parts[1].upper()}'
    return LANGS.get(parts[0].lower(), f'{parts[0].lower()}-{parts[0].upper()}')


@dataclass
class RunCtx:
    lang: str
    opacity: float = 1.0
    caps_from_transform: bool = False      # title placeholder: keep the authored text, render capitals with cap="all"
    link_rid: object = None                # callable(url) -> rId for run hyperlinks


def rpr(run: dict, ctx: RunCtx, tag: str = 'rPr'):
    face = face_for_weight(run.get('weight', 400))
    el = etree.Element(A + tag)
    el.set('lang', ctx.lang)
    el.set('sz', str(max(100, min(400000, pt100(run['sizePx'])))))
    el.set('b', '1' if face.bold else '0')
    el.set('i', '1' if run.get('italic') else '0')
    if run.get('underline'):
        el.set('u', 'sng')
    if run.get('strike'):
        el.set('strike', 'sngStrike')
    el.set('kern', '1200')
    if ctx.caps_from_transform and run.get('transform') == 'uppercase':
        el.set('cap', 'all')
    spc = pt100(run.get('letterSpacingPx', 0))
    if spc:
        el.set('spc', str(max(-400000, min(400000, spc))))
    shift = run.get('baselineShift') or 0
    if abs(shift) > 0.01:
        el.set('baseline', str(int(round(max(-1, min(1, shift)) * 100000))))
    el.set('dirty', '0')
    el.append(color_el('solidFill', run.get('color'), ctx.opacity))
    for t in ('latin', 'ea', 'cs'):
        etree.SubElement(el, A + t, typeface=face.typeface)
    if run.get('href') and ctx.link_rid and tag == 'rPr':
        h = etree.SubElement(el, A + 'hlinkClick')
        h.set(f'{{{NS_R}}}id', ctx.link_rid(run['href']))
        ext_lst = etree.SubElement(h, A + 'extLst')
        ext = etree.SubElement(ext_lst, A + 'ext', uri=HLINK_COLOR_EXT)
        etree.SubElement(ext, f'{{{NS_AHYP}}}hlinkClr', nsmap={'ahyp': NS_AHYP}, val='tx')
    return el


@dataclass
class ParaPlan:
    align: str
    line_px: float              # exact line pitch
    spc_bef_px: float
    marL_px: float
    marR_px: float
    indent_px: float
    lines: list                 # each: list of runs
    err_px: float = 0.0         # residual baseline error of the paragraph's first line (model vs HTML)


@dataclass
class TextPlan:
    x: float
    y: float
    w: float
    h: float
    ins: tuple                  # l, t, r, b (px)
    anchor: str
    wrap: str
    paras: list = field(default_factory=list)
    slack_px: float = 0.0
    notes: list = field(default_factory=list)


def _line_desc(line: dict) -> float:
    """Descent the renderer keeps below the baseline of an exact-height line (0.2 em of the largest run)."""
    return CELL_DESCENT_EM * max((r.get('sizePx') or 0.0) for r in line['runs']) if line['runs'] else 0.0


def _line_natural(line: dict) -> float:
    return max(((r.get('ascPx') or 0) + (r.get('descPx') or 0)) for r in line['runs']) if line['runs'] else 0.0


def paragraph_pitch(p: dict) -> float:
    """Exact line spacing for a paragraph: the measured pitch when it has several lines, else the CSS line
    height, else the font's natural height ('normal')."""
    bases = [ln['baseline'] for ln in p['lines']]
    if len(bases) >= 2:
        deltas = sorted(b - a for a, b in zip(bases, bases[1:]))
        return deltas[len(deltas) // 2]
    if p.get('lineHeightPx'):
        return float(p['lineHeightPx'])
    return _line_natural(p['lines'][0])


def end_spacing_shift(p: dict) -> float:
    """px to move a paragraph's lines right so they end where Chromium ended them (trailing letter-spacing)."""
    runs = p['lines'][0]['runs'] if p['lines'] else []
    if not runs:
        return 0.0
    ls = runs[-1].get('letterSpacingPx', 0.0) or 0.0
    align = p['align']
    if align == 'r':
        return -ls
    if align == 'ctr':
        return -ls / 2
    return 0.0


def plan_text(el: dict, movable: bool = True) -> TextPlan:
    """Frame geometry, insets and per-paragraph spacing for one text element (slide px)."""
    t = el['text']
    paras = t['paragraphs']
    css_ins = t.get('insets') or {'l': 0, 't': 0, 'r': 0, 'b': 0}
    style = el.get('style') or {}
    visible_box = bool(style.get('fill') or (style.get('line') and style.get('lineUniform')))
    fixed_frame = visible_box or not movable or bool(el.get('rot'))
    box = el['box']

    # ---- the frame and the insets of the text area inside it
    if visible_box:
        frame, radii, line = box_geometry(box, style)            # outline inset: the stroke covers the CSS border
        half = line['w'] / 2 if line else 0.0
        tr = text_rect_insets(frame['w'], frame['h'], radii)       # preset text rectangle (rounded corners)
        ins = [css_ins['l'] - half - tr[0], css_ins['t'] - half, css_ins['r'] - half - tr[2], css_ins['b'] - half]
        text_top, text_bottom = frame['y'] + tr[1], frame['y'] + frame['h'] - tr[3]
    else:
        frame = dict(box)
        ins = [css_ins['l'], css_ins['t'], css_ins['r'], css_ins['b']]
        text_top, text_bottom = frame['y'], frame['y'] + frame['h']

    # ---- horizontal: per-paragraph margins, slack, trailing-letter-spacing shift
    content_w = max(1.0, box['w'] - css_ins['l'] - css_ins['r'])
    widest = max((ln['right'] - ln['left'] + p.get('marLPx', 0) + p.get('marRPx', 0)
                  for p in paras for ln in p['lines']), default=0.0)
    text_w = max(content_w, widest)
    aligns = {('l' if p['align'] == 'just' else p['align']) for p in paras} or {'l'}
    marL = [p.get('marLPx', 0.0) for p in paras]
    marR = [p.get('marRPx', 0.0) for p in paras]
    shifts = [end_spacing_shift(p) for p in paras]
    x, w = frame['x'], frame['w']
    slack = 0.0
    if not fixed_frame:
        slack = max(SLACK_FRAC * text_w, SLACK_MIN_PX)
        extra_l = extra_r = 0.0
        if aligns == {'l'}:
            extra_r = slack
        elif aligns == {'r'}:
            extra_l = slack
        elif aligns == {'ctr'}:
            extra_l = extra_r = slack / 2
        else:
            extra_l = extra_r = slack
            for i, p in enumerate(paras):
                if p['align'] in ('l', 'just'):
                    marL[i] += extra_l
                elif p['align'] == 'r':
                    marR[i] += extra_r
        # room for the letter-spacing shifts: grow both sides by E and keep every paragraph in place
        E = math.ceil(max((abs(s) for s in shifts), default=0.0))
        extra_l += E
        extra_r += E
        marL = [m + E for m in marL]
        marR = [m + E for m in marR]
        for i, p in enumerate(paras):
            if p['align'] == 'r':
                marR[i] -= shifts[i]
            elif p['align'] == 'ctr':
                marL[i] += shifts[i]
                marR[i] -= shifts[i]
        x -= extra_l
        w += extra_l + extra_r
        # the slack never takes the frame past the slide edge (PowerPoint would show the frame's outline on the
        # pasteboard when it is selected); trimming a side and its margins keeps every line where it was
        over_l = max(0.0, -x)
        if over_l:
            x, w = 0.0, w - over_l
            marL = [m - over_l for m in marL]
        over_r = max(0.0, x + w - SLIDE_W)
        if over_r:
            w -= over_r
            marR = [m - over_r for m in marR]
    elif any(shifts):
        # fixed frame (a visible box): apply the first paragraph's shift through the insets
        s = shifts[0]
        if paras[0]['align'] == 'r':
            ins[2] -= s
        elif paras[0]['align'] == 'ctr':
            ins[0] += s
            ins[2] -= s

    # ---- vertical: line tops from Chromium's baselines (font-independent 1.2 em line model)
    plans = []
    first_top = prev_end = None
    for i, p in enumerate(paras):
        pitch = paragraph_pitch(p)
        lines = p['lines']
        top0 = lines[0]['baseline'] - pitch + _line_desc(lines[0])
        if first_top is None:
            first_top = actual_top = top0
            spc_bef = err = 0.0
        else:
            want = top0 - prev_end
            spc_bef = max(0.0, want)
            err = spc_bef - want   # > 0: the paragraph sits lower than in the HTML
            actual_top = prev_end + spc_bef
        prev_end = actual_top + len(lines) * pitch
        plans.append(ParaPlan(align=p['align'], line_px=pitch, spc_bef_px=spc_bef, marL_px=max(0.0, marL[i]),
                              marR_px=max(0.0, marR[i]), indent_px=p.get('indentPx', 0.0),
                              lines=[ln['runs'] for ln in lines], err_px=err))
    block_h = prev_end - first_top

    notes = []
    if fixed_frame:
        y, h = frame['y'], frame['h']
        T = first_top - text_top                     # wanted gap between the text rectangle top and the first line
        if T >= 0:
            anchor, ins[1], ins[3] = 't', T, 0.0
        else:
            # centre the block in the text rectangle and push it up with a bottom inset (insets stay >= 0)
            anchor, ins[1] = 'ctr', 0.0
            ins[3] = (text_bottom - text_top) - block_h - 2 * T
    else:
        y = max(0.0, min(frame['y'], first_top))
        ins[1] = first_top - y
        h = min(max(frame['y'] + frame['h'], first_top + block_h), SLIDE_H) - y
        ins[3] = 0.0
        anchor = 't'
    clamped = [round(v, 1) for v in ins if v < -0.5]
    if clamped:
        notes.append(f'insets {clamped} px clamped to 0 (text area smaller than the CSS box)')
    wrap = 'none' if (fixed_frame or t.get('wrapNone')) else 'square'
    plan = TextPlan(x=x, y=y, w=w, h=h, ins=tuple(max(0.0, v) for v in ins), anchor=anchor, wrap=wrap, paras=plans,
                    slack_px=slack, notes=notes)
    worst = max((abs(pp.err_px) for pp in plans), default=0.0)
    if worst > 1.5:
        plan.notes.append(f'paragraph spacing cannot be negative: up to {worst:.1f}px baseline error')
    return plan


def body_pr(plan: TextPlan):
    l, t, r, b = plan.ins
    bp = etree.Element(A + 'bodyPr', vert='horz', wrap=plan.wrap, lIns=str(emu(l)), tIns=str(emu(t)),
                       rIns=str(emu(r)), bIns=str(emu(b)), rtlCol='0', anchor=plan.anchor, anchorCtr='0')
    etree.SubElement(bp, A + 'noAutofit')
    return bp


def tx_body(tag_ns_p: str, plan: TextPlan, ctx: RunCtx):
    """<p:txBody> for a plan. tag_ns_p = presentationml namespace (txBody lives in it on p:sp)."""
    body = etree.Element(f'{{{tag_ns_p}}}txBody')
    body.append(body_pr(plan))
    etree.SubElement(body, A + 'lstStyle')
    for pp in plan.paras:
        p = etree.SubElement(body, A + 'p')
        ppr = etree.SubElement(p, A + 'pPr', algn=pp.align)
        if pp.marL_px > 0.05:
            ppr.set('marL', str(emu(pp.marL_px)))
        if pp.marR_px > 0.05:
            ppr.set('marR', str(emu(pp.marR_px)))
        ppr.set('indent', str(emu(pp.indent_px)))
        ln = etree.SubElement(ppr, A + 'lnSpc')
        etree.SubElement(ln, A + 'spcPts', val=str(max(0, min(158400, pt100(pp.line_px)))))
        sb = etree.SubElement(ppr, A + 'spcBef')
        etree.SubElement(sb, A + 'spcPts', val=str(max(0, min(158400, pt100(pp.spc_bef_px)))))
        sa = etree.SubElement(ppr, A + 'spcAft')
        etree.SubElement(sa, A + 'spcPts', val='0')
        etree.SubElement(ppr, A + 'buNone')
        last_run = None
        for li, runs in enumerate(pp.lines):
            if li:
                br = etree.SubElement(p, A + 'br')
                br.append(rpr(last_run or runs[0], ctx))
            for run in runs:
                text = run['raw'] if (ctx.caps_from_transform and run.get('transform') == 'uppercase') else run['text']
                if not text:
                    continue
                r = etree.SubElement(p, A + 'r')
                r.append(rpr(run, ctx))
                etree.SubElement(r, A + 't').text = text
                last_run = run
        if last_run is not None:
            p.append(rpr(last_run, ctx, tag='endParaRPr'))
    return body
