import pytest
from lxml import etree

from deckpptx.shapes import K45
from deckpptx.text import CELL_DESCENT_EM, SLACK_MIN_PX, RunCtx, ooxml_lang, plan_text, tx_body
from deckpptx.units import emu

NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
A = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
NOBOX = {'fill': None, 'line': None, 'lineUniform': True, 'radii': [[0, 0]] * 4}


def run(text, size=48.0, weight=400, ls=0.0, color='0B121C', alpha=1.0, **kw):
    r = {'text': text, 'raw': kw.pop('raw', text), 'family': 'Onest', 'weight': weight, 'italic': False,
         'sizePx': size, 'color': {'rgb': color, 'alpha': alpha}, 'letterSpacingPx': ls, 'underline': False,
         'strike': False, 'transform': 'none', 'baselineShift': 0, 'href': None,
         'ascPx': 0.97 * size, 'descPx': 0.305 * size}
    r.update(kw)
    return r


def line(runs, baseline, left=100.0, right=500.0):
    return {'baseline': baseline, 'left': left, 'right': right, 'maxSizePx': max(r['sizePx'] for r in runs), 'runs': runs}


def para(lines, align='l', lh=None):
    return {'align': align, 'lineHeightPx': lh, 'indentPx': 0, 'marLPx': 0, 'marRPx': 0, 'lines': lines}


def element(paras, box=(100, 200, 800, 120), ins=(0, 0, 0, 0), style=None):
    x, y, w, h = box
    return {'type': 'text', 'box': {'x': x, 'y': y, 'w': w, 'h': h}, 'bbox': {'x': x, 'y': y, 'w': w, 'h': h},
            'style': style or dict(NOBOX), 'rot': 0,
            'text': {'paragraphs': paras, 'insets': dict(zip('ltrb', ins)), 'wrapNone': False}}


def body(el, **ctx):
    plan = plan_text(el)
    return plan, tx_body(NS_P, plan, RunCtx(lang='ru-RU', **ctx))


def test_soft_breaks_become_line_breaks_in_one_paragraph():
    el = element([para([line([run('ИИ не отвечает')], 260), line([run('за студента')], 312)], lh=52)])
    _, b = body(el)
    ps = b.findall(A + 'p')
    assert len(ps) == 1
    kids = [c.tag.split('}')[1] for c in ps[0] if c.tag != A + 'pPr']
    assert kids == ['r', 'br', 'r', 'endParaRPr']
    assert [t.text for t in ps[0].iter(A + 't')] == ['ИИ не отвечает', 'за студента']   # NBSP kept


def test_run_properties():
    r = run('спрашивает', size=64, weight=600, ls=-1.92, color='0B121C', alpha=0.55, underline=True, href='https://gs.by')
    el = element([para([line([run('он его '), r], 300)], lh=70.4)])
    _, b = body(el, link_rid=lambda url: 'rId9')
    rp = b.findall(f'.//{A}r')[1].find(A + 'rPr')
    assert rp.get('lang') == 'ru-RU' and rp.get('sz') == '3200' and rp.get('b') == '0' and rp.get('spc') == '-96'
    assert rp.get('u') == 'sng' and rp.get('kern') == '1200'
    assert [rp.find(A + t).get('typeface') for t in ('latin', 'ea', 'cs')] == ['Onest SemiBold'] * 3
    clr = rp.find(f'{A}solidFill/{A}srgbClr')
    assert clr.get('val') == '0B121C' and clr.find(A + 'alpha').get('val') == '55000'
    h = rp.find(A + 'hlinkClick')
    assert h.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id') == 'rId9'
    # schema order inside a:rPr: fill ... latin, ea, cs ... hlinkClick
    assert [c.tag.split('}')[1] for c in rp] == ['solidFill', 'latin', 'ea', 'cs', 'hlinkClick']


def test_bold_700_is_onest_bold_flag():
    el = element([para([line([run('2000', weight=700)], 300)], lh=60)])
    _, b = body(el)
    rp = b.find(f'.//{A}rPr')
    assert rp.get('b') == '1' and rp.find(A + 'latin').get('typeface') == 'Onest'


def test_title_keeps_authored_text_and_uses_caps():
    r = run('ТИТУЛЬНЫЙ', raw='Титульный', size=40, weight=600, ls=4.8, transform='uppercase')
    el = element([para([line([r], 152)], lh=48)])
    _, b = body(el, caps_from_transform=True)
    rp = b.find(f'.//{A}r/{A}rPr')
    assert b.find(f'.//{A}t').text == 'Титульный'          # the outline shows the mandatory name verbatim
    assert rp.get('cap') == 'all' and rp.get('spc') == '240'


@pytest.mark.parametrize('align, dx, dw', [('l', 0, 80), ('ctr', -40, 80), ('r', -80, 80)])
def test_slack_side_follows_alignment(align, dx, dw):
    el = element([para([line([run('строка')], 300)], align=align, lh=60)], box=(100, 240, 800, 80))
    plan = plan_text(el)
    assert plan.x == pytest.approx(100 + dx) and plan.w == pytest.approx(800 + dw)   # slack = 10 % of 800
    assert plan.wrap == 'square'


def test_minimum_slack_for_short_text():
    el = element([para([line([run('2')], 300, 100, 130)], lh=60)], box=(100, 240, 40, 80))
    assert plan_text(el).w == pytest.approx(40 + SLACK_MIN_PX)


def test_first_baseline_lands_on_the_html_baseline():
    # renderer: baseline = line top + L - 0.2 * size  (font-independent 1.2 em line model)
    el = element([para([line([run('Цель', size=48)], 300)], lh=52.8)], box=(100, 250, 800, 60))
    plan = plan_text(el)
    first_top = 300 - 52.8 + CELL_DESCENT_EM * 48
    assert plan.y == pytest.approx(250) and plan.ins[1] == pytest.approx(first_top - 250)
    assert plan.anchor == 't'


def test_frame_moves_up_instead_of_negative_inset():
    el = element([para([line([run('Meldy', size=200)], 360)], lh=240)], box=(100, 168, 600, 240))
    plan = plan_text(el)
    first_top = 360 - 240 + 40          # 160: above the element box (168)
    assert plan.y == pytest.approx(first_top) and plan.ins[1] == pytest.approx(0)


def test_paragraph_spacing_from_baselines():
    p1 = para([line([run('Имя', size=40)], 300)], lh=50)
    p2 = para([line([run('роль', size=30)], 400)], lh=40)
    plan = plan_text(element([p1, p2], box=(100, 240, 800, 200)))
    top1 = 300 - 50 + 8
    top2 = 400 - 40 + 6
    assert plan.paras[1].spc_bef_px == pytest.approx(top2 - (top1 + 50))
    _, b = body(element([p1, p2], box=(100, 240, 800, 200)))
    sb = b.findall(A + 'p')[1].find(f'{A}pPr/{A}spcBef/{A}spcPts')
    assert sb.get('val') == str(round((top2 - top1 - 50) * 50))
    ln = b.findall(A + 'p')[0].find(f'{A}pPr/{A}lnSpc/{A}spcPts')
    assert ln.get('val') == '2500'                       # 50 px exact line height = 25 pt


def test_measured_pitch_wins_for_multi_line_paragraphs():
    p = para([line([run('a')], 300), line([run('b')], 361), line([run('c')], 422)], lh=55)
    plan = plan_text(element([p]))
    assert plan.paras[0].line_px == pytest.approx(61)


def test_pill_uses_the_preset_text_rectangle():
    style = {'fill': {'rgb': '2869DD', 'alpha': 1}, 'line': None, 'lineUniform': True, 'radii': [[32, 32]] * 4}
    r = run('Постановление № 319', size=30, weight=500, color='FFFFFF')
    el = element([para([line([r], 882, 1136, 1458)], lh=64)], box=(1104, 840, 386, 64), ins=(32, 0, 32, 0), style=style)
    plan = plan_text(el)
    assert (plan.x, plan.y, plan.w, plan.h) == (1104, 840, 386, 64)      # a visible box keeps its exact geometry
    assert plan.wrap == 'none'
    assert plan.ins[0] == pytest.approx(32 - 32 * K45) and plan.ins[2] == pytest.approx(32 - 32 * K45)
    # first line top is above the text rectangle: centred anchor pushed up by a bottom inset
    assert plan.anchor == 'ctr'
    text_top = 840 + 32 * K45
    T = (882 - 64 + 6) - text_top
    assert plan.ins[3] == pytest.approx((64 - 2 * 32 * K45) - 64 - 2 * T)


def test_right_aligned_tracking_is_shifted():
    # LibreOffice drops the spacing after a line's last character; CSS keeps it
    r = run('2 автора', size=104, weight=700, ls=-4.16)
    el = element([para([line([r], 916, 198, 608)], align='r', lh=104)], box=(128, 830, 480, 104))
    plan = plan_text(el)
    right_edge = plan.x + plan.w - plan.paras[0].marR_px
    assert right_edge == pytest.approx(128 + 480 + 4.16, abs=0.01)


@pytest.mark.parametrize('lang, out', [('ru', 'ru-RU'), ('ru-ru', 'ru-RU'), ('en', 'en-US'), (None, 'ru-RU'), ('be', 'be-BY')])
def test_language_tags(lang, out):
    assert ooxml_lang(lang) == out


def test_body_pr_no_autofit_zero_insets():
    el = element([para([line([run('x')], 260)], lh=60)], box=(100, 250, 300, 60))
    _, b = body(el)
    bp = b.find(A + 'bodyPr')
    assert bp.get('wrap') == 'square' and bp.get('lIns') == '0' and bp.get('rIns') == '0' and bp.get('bIns') == '0'
    assert bp.find(A + 'noAutofit') is not None
    assert bp.get('tIns') == str(emu(plan_text(el).ins[1]))
