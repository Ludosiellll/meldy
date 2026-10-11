"""Motion preview scenes read back from the fixture PPTX (needs `make.sh fixtures` run once)."""
import sys

import pytest

from conftest import DECK, TOOLS

sys.path.insert(0, str(TOOLS / 'preview'))
from scene import build_scenes   # noqa: E402

PPTX = DECK / 'out' / 'fixtures' / 'cf11-fixtures.pptx'
OBJECTS = DECK / 'out' / 'fixtures' / 'cf11-fixtures.objects.json'
pytestmark = pytest.mark.skipif(not (PPTX.exists() and OBJECTS.exists()), reason='run tools/make.sh fixtures first')


@pytest.fixture(scope='module')
def scenes(tmp_path_factory):
    out = tmp_path_factory.mktemp('motion')
    res = build_scenes(PPTX, OBJECTS, out, {'slides': {'03': {'clicks': [0.5, 2.0], 'hold': 1}}}, (640, 360), 30, 1.2, 3.0)
    import json
    sc = {s['nn']: json.loads(open(s['scene'], encoding='utf-8').read()) for s in res['manifest']['slides']}
    return res, sc, out


def test_first_slide_fades_in_from_black_and_builds_after_it(scenes):
    _, sc, _ = scenes
    s = sc['01']
    assert s['transition'] == {'kind': 'fade', 'dur': 700.0, 'option': None, 'fromBlack': True}
    assert s['prev'] is None and s['groups'][0]['auto'] and s['groups'][0]['start'] == 700.0
    assert s['T'] == pytest.approx(s['groups'][-1]['end'] + 3000)                  # the default hold


def test_click_script_and_default_gap(scenes):
    _, sc, _ = scenes
    g = sc['03']['groups']
    assert g[0]['auto'] and [round(x['start'] - y['end']) for x, y in zip(g[1:], g)] == [500, 2000]
    assert sc['03']['T'] == pytest.approx(g[-1]['end'] + 1000)
    g2 = sc['02']['groups']                                              # no script: 1.2 s after the build
    clicks = [x for x in g2 if not x['auto']]
    assert clicks and all(round(x['start'] - y['end']) == 1200 for x, y in zip(g2[1:], g2) if not x['auto'])


def test_video_without_entrance_plays_from_the_slide_start_and_loops(scenes):
    _, sc, _ = scenes
    m = sc['02']['media']
    assert len(m) == 1 and m[0]['loop'] is True
    assert m[0]['play'] == pytest.approx(sc['02']['groups'][0]['start']) == pytest.approx(1500)   # data-play="with"
    video = [o for o in sc['02']['cur'] if o.get('video')][0]
    assert video['video']['n'] > 10 and video['img']['src'].endswith('.png')        # frames + the poster


def test_morph_draw_list_and_entrance_rules(scenes):
    _, sc, _ = scenes
    d = sc['03']['draw']
    kinds = {(x['kind'], x.get('how')) for x in d}
    assert ('pair', 'name') in kinds and ('held', None) in kinds and ('gone', None) in kinds
    byk = {o['key']: o for o in sc['03']['cur']}
    held = [byk[x['b']]['name'] for x in d if x['kind'] == 'held']
    assert '!!word' in held                                                   # animated, so not in the Morph
    zs = [x['z'] for x in d]
    assert zs == sorted(zs)


def test_text_layers_reach_the_scene_and_the_log_names_the_pairs(scenes):
    res, sc, out = scenes
    texts = [o for o in sc['02']['cur'] if o['kind'] == 'shape' and o['text']]
    assert texts and all(o['textLayer'] and o['textLayer']['src'].endswith('-text.png') for o in texts)
    log = (out / 'morph-log.txt').read_text(encoding='utf-8')
    assert 'pair name !!dot [roundRect]  →  !!dot [ellipse]' in log
    assert 'blocked !!word' in log and 'Fade from black' in log
    assert not res['warnings']
