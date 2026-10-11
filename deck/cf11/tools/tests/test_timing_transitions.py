import pytest
from lxml import etree

from conftest import PML_XSD
from deckpptx.timing import Effect, Media, Target, build_timing, schedule
from deckpptx.transitions import set_transition, transition_xml

NS = {'p': 'http://schemas.openxmlformats.org/presentationml/2006/main',
      'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
      'mc': 'http://schemas.openxmlformats.org/markup-compatibility/2006',
      'p14': 'http://schemas.microsoft.com/office/powerpoint/2010/main',
      'p159': 'http://schemas.microsoft.com/office/powerpoint/2015/09/main'}


def xp(el, q):
    return el.xpath(q, namespaces=NS)


def eff(spid, effect, trigger, delay=0, dur=500, text=True, box=False, companions=()):
    return Effect(Target(spid, has_text=text, has_box=box), effect, trigger, delay, dur, list(companions))


def test_schedule_groups_and_node_types():
    e = [eff(2, 'fade', 'after'), eff(3, 'rise', 'with'), eff(4, 'zoom', 'click'), eff(5, 'appear', 'after'),
         eff(6, 'wipe', 'click')]
    groups, auto = schedule(e)
    assert auto is True
    assert [[[n for _, n in sg] for sg in g] for g in groups] == [
        [['afterEffect', 'withEffect']], [['clickEffect'], ['afterEffect']], [['clickEffect']]]


def test_first_effect_on_click_has_no_auto_group():
    groups, auto = schedule([eff(2, 'fade', 'click'), eff(3, 'fade', 'with')])
    assert auto is False and [[[n for _, n in sg] for sg in g] for g in groups] == [[['clickEffect', 'withEffect']]]


@pytest.mark.parametrize('name, pid, sub', [('appear', '1', '0'), ('fade', '10', '0'), ('rise', '42', '0'),
                                            ('wipe', '22', '8'), ('zoom', '53', '16')])
def test_presets(name, pid, sub):
    t = build_timing([eff(5, name, 'click', dur=700)], [])
    ctn = xp(t, '//p:cTn[@presetClass="entr"]')[0]
    assert (ctn.get('presetID'), ctn.get('presetSubtype'), ctn.get('nodeType')) == (pid, sub, 'clickEffect')
    vis = xp(ctn, './/p:set//p:attrName/text()')
    assert vis == ['style.visibility']
    if name == 'wipe':
        assert xp(ctn, './/p:animEffect/@filter') == ['wipe(left)']          # From Left
    if name == 'rise':
        assert xp(ctn, './/p:anim[.//p:attrName="ppt_y"]//p:strVal/@val') == ['#ppt_y+.1', '#ppt_y']
        assert xp(ctn, './/p:animEffect/@filter') == ['fade']
    if name == 'zoom':
        assert xp(ctn, './/p:anim[.//p:attrName="ppt_w"]//p:fltVal/@val') == ['0']
    if name != 'appear':
        assert set(xp(ctn, './/p:cBhvr/p:cTn/@dur')) >= {'700'}


def test_delays_and_after_previous_start():
    t = build_timing([eff(2, 'fade', 'click', dur=600), eff(3, 'appear', 'after', delay=200), eff(4, 'fade', 'after')], [])
    sub = xp(t, '//p:seq/p:cTn/p:childTnLst/p:par/p:cTn/p:childTnLst/p:par/p:cTn')
    starts = [xp(c, './p:stCondLst/p:cond/@delay')[0] for c in sub]
    assert starts == ['0', '600', '801']                 # fade 600 ms; appear = 200 ms delay + 1 ms
    assert xp(t, '//p:cTn[@presetID="1"]/p:stCondLst/p:cond/@delay') == ['200']


def test_ids_sequence_and_onbegin_points_to_main_sequence():
    t = build_timing([eff(2, 'fade', 'after'), eff(3, 'fade', 'click')], [])
    ids = [int(i) for i in xp(t, '//p:cTn/@id')]
    assert ids == list(range(1, len(ids) + 1))
    assert xp(t, '//p:cTn[@nodeType="mainSeq"]/@id') == ['2']
    assert xp(t, '//p:cond[@evt="onBegin"]/p:tn/@val') == ['2']


def test_build_list_only_for_text_and_anim_bg_for_boxes():
    pic = Target(9)
    t = build_timing([eff(2, 'fade', 'click', companions=[pic]), eff(3, 'fade', 'with', box=True), eff(4, 'fade', 'with', text=False)], [])
    blds = {b.get('spid'): b.get('animBg') for b in xp(t, '//p:bldP')}
    assert blds == {'2': None, '3': '1'}
    assert xp(t, '//p:cTn[@presetClass="entr"][.//p:spTgt/@spid="9"]/@nodeType') == ['withEffect']   # layer follows
    assert xp(t, '//p:cTn[@presetClass="entr"][.//p:spTgt/@spid="9"]/@grpId') == []


def test_media_autoplay_loop_and_pause_toggle():
    t = build_timing([eff(2, 'fade', 'click')], [Media(spid=7, dur_ms=2000, loop=True)])
    groups = xp(t, '//p:seq/p:cTn[@nodeType="mainSeq"]/p:childTnLst/p:par')
    # a slide-start group holding only the playback was put in front of the click group
    assert xp(groups[0], './p:cTn/p:stCondLst/p:cond[@evt="onBegin"]') and len(groups) == 2
    play = xp(t, '//p:cTn[@presetClass="mediacall"][@presetID="1"]')[0]
    assert play.get('nodeType') == 'afterEffect'
    assert xp(play, './/p:cmd/@cmd') == ['playFrom(0.0)'] and xp(play, './/p:cmd/p:cBhvr/p:cTn/@dur') == ['2000']
    node = xp(t, '//p:video/p:cMediaNode/p:cTn')[0]
    assert node.get('repeatCount') == 'indefinite' and node.get('display') == '0'
    assert xp(node, './p:endCondLst/p:cond/@evt') == ['onNext', 'onPrev']
    assert xp(t, '//p:cTn[@nodeType="interactiveSeq"]//p:cmd/@cmd') == ['togglePause']


def test_media_plays_after_the_effects_of_its_group():
    e = [eff(2, 'wipe', 'after', dur=700), eff(3, 'fade', 'click')]
    t = build_timing(e, [Media(spid=7, dur_ms=5000)])
    g0 = xp(t, '//p:cTn[@nodeType="mainSeq"]/p:childTnLst/p:par')[0]
    subs = xp(g0, './p:cTn/p:childTnLst/p:par/p:cTn')
    assert [xp(s, './p:stCondLst/p:cond/@delay')[0] for s in subs] == ['0', '700']
    assert xp(subs[-1], './/p:cTn/@presetClass') == ['mediacall']


def test_video_revealed_on_click_plays_in_that_group():
    e = [eff(2, 'fade', 'after'), eff(7, 'zoom', 'click', text=False)]
    t = build_timing(e, [Media(spid=7, dur_ms=3000, shown_by=e[1])])
    groups = xp(t, '//p:cTn[@nodeType="mainSeq"]/p:childTnLst/p:par')
    assert len(groups) == 2 and xp(groups[1], './/p:cTn[@presetClass="mediacall"]')


def test_no_timing_without_effects_or_media():
    assert build_timing([], []) is None


@pytest.mark.skipif(not PML_XSD.exists(), reason='pptx skill schemas not available')
def test_timing_is_schema_valid():
    schema = etree.XMLSchema(etree.parse(str(PML_XSD)))
    e = [eff(2, n, t) for n, t in (('fade', 'after'), ('rise', 'with'), ('zoom', 'click'), ('wipe', 'after'), ('appear', 'with'))]
    timing = build_timing(e, [Media(spid=9, dur_ms=2000, loop=True, shown_by=e[2])])
    sld = etree.fromstring(
        '<p:sld xmlns:a="%s" xmlns:p="%s" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>'
        '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>' % (NS['a'], NS['p']))
    sld.append(timing)
    assert schema.validate(sld), schema.error_log


def test_morph_transition_markup():
    ac = transition_xml('morph', 1500)
    choice = xp(ac, './mc:Choice')[0]
    assert choice.get('Requires') == 'p159'
    tr = xp(choice, './p:transition')[0]
    assert tr.get('{%s}dur' % NS['p14']) == '1500' and tr.get('spd') == 'slow'
    assert xp(tr, './p159:morph/@option') == ['byObject']
    assert xp(ac, './mc:Fallback/p:transition/p:fade')


def test_fade_and_none():
    ac = transition_xml('fade', 700)
    assert xp(ac, './mc:Choice/@Requires') == ['p14'] and xp(ac, './mc:Choice/p:transition/p:fade')
    assert transition_xml('none') is None


def test_transition_goes_after_clr_map_ovr():
    sld = etree.fromstring('<p:sld xmlns:p="%s"><p:cSld/><p:clrMapOvr/><p:timing/></p:sld>' % NS['p'])
    set_transition(sld, 'morph', 1200)
    assert [etree.QName(c).localname for c in sld] == ['cSld', 'clrMapOvr', 'AlternateContent', 'timing']
    set_transition(sld, 'none')
    assert [etree.QName(c).localname for c in sld] == ['cSld', 'clrMapOvr', 'timing']
