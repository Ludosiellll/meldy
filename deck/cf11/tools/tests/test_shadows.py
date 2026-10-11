"""Native shadows (box-shadow -> a:outerShdw) and layers that travel with their "!!" owner ("!!x·layer")."""
import json
import shutil
import subprocess
import zipfile

import pytest
from lxml import etree
from PIL import Image

from build import build, objects_path
from check_pptx import lint_transition
from conftest import DECK, FONTS, TOOLS
from deckpptx.morph import Obj, Package, layer_owner, pair_slides, read_shadow
from deckpptx.shapes import SHADOW_BLUR_K, shadow_el, sp_pr
from test_build_bleed import _slide_doc

A = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
P = '{http://schemas.openxmlformats.org/presentationml/2006/main}'
NODE = shutil.which('node')
FIXTURE_PPTX = DECK / 'out' / 'fixtures' / 'cf11-fixtures.pptx'
DECK_SHADOW = {'dx': 0, 'dy': 40, 'blur': 80, 'spread': -48, 'color': {'rgb': '0B121C', 'alpha': 0.3}, 'dropped': 1}


# ---------------------------------------------------------------------------- XML
def test_shadow_el_maps_offset_blur_spread_and_colour():
    sh = shadow_el(DECK_SHADOW, 812, 288).find(A + 'outerShdw')
    assert sh.get('blurRad') == str(round(80 * SHADOW_BLUR_K * 6350))
    assert sh.get('dist') == str(40 * 6350) and sh.get('dir') == '5400000'                  # straight down
    assert sh.get('sx') == str(round(716 / 812 * 100000)) and sh.get('sy') == str(round(192 / 288 * 100000))
    assert sh.get('algn') == 'ctr' and sh.get('rotWithShape') == '1'
    c = sh.find(A + 'srgbClr')
    assert c.get('val') == '0B121C' and c.find(A + 'alpha').get('val') == '30000'
    r = read_shadow(sh)                                       # what the preview and the lint read back
    assert r['blur'] == pytest.approx(80 * SHADOW_BLUR_K) and r['dist'] == 40 and r['dir'] == 90
    assert r['sy'] == pytest.approx(192 / 288, abs=1e-5) and r['alpha'] == pytest.approx(0.3)


def test_shadow_el_writes_sx_with_sy_and_skips_empty_shadows():
    plain = shadow_el({**DECK_SHADOW, 'dy': 0, 'spread': 0}, 100, 100).find(A + 'outerShdw')
    assert plain.get('sx') is None and plain.get('sy') is None and plain.get('dist') is None
    wide = shadow_el({**DECK_SHADOW, 'spread': -10}, 10000, 100).find(A + 'outerShdw')
    assert wide.get('sx') == '99800' and wide.get('sy') == '80000'      # LibreOffice ignores sy without sx
    up_left = shadow_el({**DECK_SHADOW, 'dx': -10, 'dy': -10}, 100, 100).find(A + 'outerShdw')
    assert up_left.get('dir') == str(225 * 60000)
    assert shadow_el({**DECK_SHADOW, 'spread': -60}, 812, 100) is None   # the spread eats the box: CSS draws nothing
    assert shadow_el({**DECK_SHADOW, 'color': {'rgb': '000000', 'alpha': 0.001}}, 100, 100) is None
    assert shadow_el(None, 100, 100) is None


def test_sp_pr_puts_the_shadow_after_the_outline():
    style = {'fill': {'rgb': 'FFFFFF', 'alpha': 1}, 'radii': [[48, 48]] * 4, 'lineUniform': True, 'line': None}
    sp, _ = sp_pr({'x': 0, 'y': 0, 'w': 812, 'h': 288}, style, 1.0, shadow=DECK_SHADOW)
    assert [c.tag.split('}')[1] for c in sp] == ['xfrm', 'prstGeom', 'solidFill', 'ln', 'effectLst']
    sp, _ = sp_pr({'x': 0, 'y': 0, 'w': 812, 'h': 288}, style, 1.0)
    assert sp.find(A + 'effectLst') is None


# ---------------------------------------------------------------------------- layers
def test_layer_names_pair_by_name_and_fold_into_the_owner_lint():
    assert layer_owner('!!card·layer') == '!!card'
    assert layer_owner('Shape 01.02:over') is None and layer_owner('!!card') is None
    assert Obj(1, 3, '!!card·layer', 'picture', 2).label() == '!!card·layer [layer of !!card]'
    prev = [Obj(1, 2, '!!card', 'shape', 1), Obj(1, 3, '!!card·layer', 'picture', 2)]
    cur = [Obj(2, 2, '!!card', 'shape', 1), Obj(2, 3, '!!card·layer', 'picture', 2)]
    res = pair_slides(prev, cur)
    assert {(p.a.name, p.b.name, p.how) for p in res.pairs} == {('!!card', '!!card', 'name'),
                                                                 ('!!card·layer', '!!card·layer', 'name')}
    held = [Obj(2, 2, '!!card', 'shape', 1, builds_in=True), Obj(2, 3, '!!card·layer', 'picture', 2, builds_in=True)]
    res = pair_slides(prev, held)
    assert len(res.blocked) == 2
    lines = lint_transition(1, 2, res)
    assert len(lines) == 1 and '!!card [rect] (with its layer)' in lines[0]


def _layer_png(path):
    im = Image.new('RGBA', (200, 80), (0, 0, 0, 0))
    im.paste((245, 182, 205, 255), (0, 0, 120, 42))
    im.save(path)


def test_a_named_owner_layer_is_named_from_it_and_the_shadow_is_native(tmp_path):
    _layer_png(tmp_path / 'tag.png')
    style = {'fill': {'rgb': 'FFFFFF', 'alpha': 1}, 'line': None, 'lineUniform': True, 'radii': [[48, 48]] * 4,
             'shadowNative': DECK_SHADOW}
    named = {'id': 'e2', 'type': 'shape', 'domIndex': 1, 'name': '!!card', 'box': {'x': 128, 'y': 300, 'w': 812, 'h': 288},
             'bbox': {'x': 128, 'y': 300, 'w': 812, 'h': 288}, 'rot': 0, 'opacity': 1, 'style': style,
             'render': {'mode': 'over', 'png': 'tag.png', 'rect': {'x': 170, 'y': 340, 'w': 100, 'h': 40}, 'scale': 2}}
    plain = {**named, 'id': 'e3', 'domIndex': 2, 'name': None, 'box': {'x': 980, 'y': 300, 'w': 812, 'h': 288},
             'bbox': {'x': 980, 'y': 300, 'w': 812, 'h': 288}, 'style': {**style, 'shadowNative': None},
             'render': {**named['render'], 'rect': {'x': 1020, 'y': 340, 'w': 100, 'h': 40}}}
    _slide_doc(tmp_path, [named, plain])
    out = tmp_path / 'deck.pptx'
    res = build(tmp_path, out, FONTS, 'Meldy — test', 'none')
    assert res['errors'] == []
    side = json.loads(objects_path(out).read_text(encoding='utf-8'))
    roles = [(o['name'], o['role']) for o in side['slides'][0]['objects']]
    assert ('!!card·layer', 'over') in roles and ('Shape 01.03:over', 'over') in roles      # unnamed: unique as before
    sld = etree.fromstring(zipfile.ZipFile(out).read('ppt/slides/slide1.xml'))
    shadows = sld.findall(f'.//{P}spPr/{A}effectLst/{A}outerShdw')
    assert len(shadows) == 1
    owner = shadows[0].getparent().getparent().getparent()
    assert owner.find(f'{P}nvSpPr/{P}cNvPr').get('name') == '!!card'


@pytest.mark.skipif(not FIXTURE_PPTX.exists(), reason='run tools/make.sh fixtures first')
def test_fixture_shadows_and_the_travelling_layer():
    s1, s2, s3, s4 = Package(FIXTURE_PPTX).slides
    by = lambda s, n: [o for o in s.objects if o.name == n][0]   # noqa: E731
    gif = [o for o in s1.objects if o.image and o.image.endswith('.gif')][0]
    assert gif.shadow and gif.shadow['dist'] == pytest.approx(12)                   # a placed file's shadow
    assert by(s2, '!!card').shadow is None                                         # data-shadow="bake": in its layer
    card = by(s3, '!!card').shadow
    assert card['rgb'] == '10295A' and card['alpha'] == pytest.approx(0.38) and card['dist'] == pytest.approx(48)
    sticker = [o for o in s3.objects if o.rot and o.shadow]
    assert sticker and sticker[0].shadow['rotWith']                                # turns with the shape
    pill = [o for o in s3.objects if o.text == 'Постановление № 319'][0]
    assert pill.shadow is None                                                     # baked into its under-layer
    assert [o.geom for o in s4.objects if o.shadow] == ['ellipse']
    res = pair_slides(s2.objects, s3.objects)
    assert {(p.a.name, p.how) for p in res.pairs} >= {('!!card', 'name'), ('!!card·layer', 'name')}


# ---------------------------------------------------------------------------- extract
SLIDE = """<!doctype html><html lang="ru"><head><meta charset="utf-8">
<link rel="stylesheet" href="{css}"></head><body>
<main class="slide" data-transition="morph">
  <h1 class="label" data-pptx="title">Тени</h1>
  <div class="card" data-pptx="shape" data-name="!!a" style="left:100px;top:260px;width:400px;height:300px"><span class="tag">Билет</span></div>
  <div data-pptx="shape" style="position:absolute;left:600px;top:260px;width:300px;height:200px;background:rgba(40,105,221,.5);box-shadow:0 10px 20px rgba(0,0,0,.3)"></div>
  <div class="card" data-pptx="shape" data-shadow="bake" style="left:1000px;top:260px;width:300px;height:200px"></div>
  <div class="card" data-pptx="shape" style="left:1400px;top:260px;width:300px;height:200px;box-shadow:inset 0 0 10px #000"></div>
  <p class="src" data-pptx="text" style="top:640px;box-shadow:0 4px 8px rgba(0,0,0,.3)">Без фона</p>
  <p class="src" data-pptx="text" style="top:740px;background:#fff;box-shadow:0 4px 8px rgba(0,0,0,.3)">С фоном</p>
  <img data-pptx="image" data-src="{png}" src="{png}" style="position:absolute;left:100px;top:860px;width:200px;height:120px;box-shadow:0 6px 12px rgba(0,0,0,.3)">
  <img data-pptx="image" data-src="{png}" src="{png}" style="position:absolute;left:400px;top:860px;width:200px;height:120px;opacity:.5;box-shadow:0 6px 12px rgba(0,0,0,.3)">
  <div class="card" data-pptx="shape" data-shadow="soft" style="left:700px;top:860px;width:200px;height:120px"></div>
</main></body></html>"""


@pytest.mark.skipif(NODE is None, reason='node not available')
def test_extract_chooses_native_or_baked_and_hides_a_native_shadow_from_the_layer(tmp_path):
    slides = tmp_path / 'slides'
    slides.mkdir()
    png = slides / 'pic.png'
    Image.new('RGB', (400, 240), (40, 105, 221)).save(png)
    (slides / '01-a.html').write_text(SLIDE.format(css=(TOOLS / 'fixtures' / 'fixture.css').as_uri(), png=png.name),
                                      encoding='utf-8')
    out = tmp_path / 'build'
    r = subprocess.run([NODE, str(TOOLS / 'extract.mjs'), '--slides', str(slides), '--out', str(out), '--fill',
                        str(tmp_path / 'none.json'), '--no-opt'], capture_output=True, text=True, timeout=180)
    assert r.returncode == 0, r.stdout + r.stderr
    s = json.loads((out / 'slides.json').read_text(encoding='utf-8'))['slides'][0]
    el = [e for e in s['elements'] if e['type'] != 'title']
    card, translucent, bake, inset, bare, boxed, pic, faded, soft = el
    native = card['style']['shadowNative']
    assert native == {'dx': 0, 'dy': 48, 'blur': 90, 'spread': -56, 'color': {'rgb': '10295A', 'alpha': 0.38}, 'dropped': 1}
    assert not card['style']['shadowBaked'] and card['render']['mode'] == 'over'          # the tag only
    for e in (translucent, bake, inset):
        assert e['style']['shadowNative'] is None and e['style']['shadowBaked'] and e['render']['mode'] == 'over'
    assert bare['style']['shadowNative'] is None and bare['render']['mode'] == 'under'
    assert boxed['style']['shadowNative'] and 'render' not in boxed
    assert pic['style']['shadowNative'] and faded['style']['shadowNative'] is None
    assert soft['style']['shadowNative']
    assert any('box-shadow not carried (opacity below 1)' in w for w in s['warnings'])
    assert any('unknown data-shadow="soft"' in w for w in s['warnings'])
    # the card's layer holds the tag but not the shadow: nothing below the card's box is painted
    rr = card['render']['rect']
    with Image.open(out / card['render']['png']) as im:
        alpha = im.getchannel('A')
        below = int((card['box']['y'] + card['box']['h'] - rr['y'] + 2) * 2)
        assert below < im.height and alpha.crop((0, below, im.width, im.height)).getextrema()[1] == 0
