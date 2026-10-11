"""Bleed: pictures are cropped to the slide, native shapes and live text that cross its edge fail the build."""
import json

import pytest
from PIL import Image

from build import build, crop_to_slide, objects_path, overhang, text_extent
from conftest import FONTS
from deckpptx.text import plan_text


def test_overhang_names_only_the_sides_that_stick_out():
    assert overhang({'x': 0, 'y': 0, 'w': 1920, 'h': 1080}) == {}
    assert overhang({'x': -10, 'y': 1000, 'w': 100, 'h': 100}) == {'left': 10, 'bottom': 20}
    assert overhang({'x': 1900.3, 'y': 0, 'w': 20, 'h': 10}) == {}          # sub-pixel rounding is tolerated


def test_crop_to_slide_composes_with_an_existing_crop():
    # a picture shown 2000 px wide from x=-40 with 10 % already cut on each side
    frame, crop = crop_to_slide({'x': -40, 'y': 100, 'w': 2000, 'h': 500}, {'l': 0.1, 't': 0.0, 'r': 0.1, 'b': 0.0})
    assert frame == {'x': 0.0, 'y': 100, 'w': 1920.0, 'h': 500}
    iw = 2000 / 0.8                                           # the whole image in slide px
    assert crop['l'] == pytest.approx(0.1 + 40 / iw) and crop['r'] == pytest.approx(0.1 + 40 / iw)
    assert crop['t'] == pytest.approx(0.0) and crop['b'] == pytest.approx(0.0)
    assert crop_to_slide({'x': 10, 'y': 10, 'w': 50, 'h': 50}, None) == ({'x': 10, 'y': 10, 'w': 50, 'h': 50}, None)


def test_text_extent_is_the_line_boxes():
    e = {'bbox': {'x': 0, 'y': 0, 'w': 1, 'h': 1}, 'text': {'paragraphs': [{'lines': [
        {'left': 100, 'right': 400, 'baseline': 200, 'runs': [{'sizePx': 40, 'ascPx': 38, 'descPx': 10}]},
        {'left': 100, 'right': 300, 'baseline': 250, 'runs': [{'sizePx': 40, 'ascPx': 38, 'descPx': 10}]}]}]}}
    assert text_extent(e) == {'x': 100, 'y': 162, 'w': 300, 'h': 98}


def test_text_slack_stops_at_the_slide_edge():
    run = {'text': 'Справа', 'raw': 'Справа', 'weight': 400, 'sizePx': 40, 'color': {'rgb': '000000', 'alpha': 1},
           'letterSpacingPx': 0, 'italic': False, 'ascPx': 38, 'descPx': 10}
    el = {'box': {'x': 1700, 'y': 500, 'w': 200, 'h': 48}, 'bbox': {'x': 1700, 'y': 500, 'w': 200, 'h': 48}, 'style': {},
          'text': {'paragraphs': [{'align': 'l', 'lineHeightPx': 48, 'lines': [
              {'left': 1700, 'right': 1890, 'baseline': 538, 'maxSizePx': 40, 'runs': [run]}]}], 'insets': None}}
    plan = plan_text(el)
    assert plan.x == pytest.approx(1700) and plan.x + plan.w <= 1920.0 + 1e-6


def _slide_doc(tmp, elements):
    bg = tmp / 'bg.png'
    Image.new('RGB', (1920, 1080), (243, 243, 240)).save(bg)
    title = {'id': 'e1', 'type': 'title', 'domIndex': 0, 'name': None, 'box': {'x': 128, 'y': 100, 'w': 400, 'h': 50},
             'bbox': {'x': 128, 'y': 100, 'w': 400, 'h': 50}, 'rot': 0, 'opacity': 1, 'style': {},
             'text': {'paragraphs': [{'align': 'l', 'lineHeightPx': 50, 'lines': [{'left': 128, 'right': 400,
                      'baseline': 140, 'maxSizePx': 40, 'runs': [{'text': 'Титульный', 'raw': 'Титульный',
                      'weight': 600, 'sizePx': 40, 'color': {'rgb': '1F5BC6', 'alpha': 1}, 'letterSpacingPx': 0,
                      'italic': False, 'ascPx': 38, 'descPx': 10}]}]}], 'insets': None, 'lang': 'ru'}}
    doc = {'format': 'cf11-slides/1', 'slides': [{'nn': '01', 'file': '01-t.html', 'background': 'bg.png',
                                                  'reference': 'bg.png', 'lang': 'ru', 'notes': [], 'warnings': [],
                                                  'transition': {'type': 'fade', 'durMs': None},
                                                  'elements': [title] + elements}]}
    (tmp / 'slides.json').write_text(json.dumps(doc, ensure_ascii=False), encoding='utf-8')


def test_a_shape_across_the_edge_fails_the_build_and_leaves_no_file(tmp_path):
    shape = {'id': 'e2', 'type': 'shape', 'domIndex': 1, 'name': '!!bar', 'box': {'x': 1800, 'y': 300, 'w': 200, 'h': 40},
             'bbox': {'x': 1800, 'y': 300, 'w': 200, 'h': 40}, 'rot': 0, 'opacity': 1,
             'style': {'fill': {'rgb': '0B121C', 'alpha': 1}, 'line': None, 'lineUniform': True, 'radii': [[0, 0]] * 4}}
    _slide_doc(tmp_path, [shape])
    out = tmp_path / 'deck.pptx'
    out.write_bytes(b'stale')
    res = build(tmp_path, out, FONTS, 'Meldy — test', 'none')
    assert len(res['errors']) == 1 and 'right 80 px' in res['errors'][0] and '!!bar' in res['errors'][0]
    assert not out.exists() and not objects_path(out).exists()


def test_a_shape_inside_builds_and_writes_the_sidecar(tmp_path):
    shape = {'id': 'e2', 'type': 'shape', 'domIndex': 1, 'name': '!!bar', 'box': {'x': 1700, 'y': 300, 'w': 200, 'h': 40},
             'bbox': {'x': 1700, 'y': 300, 'w': 200, 'h': 40}, 'rot': 0, 'opacity': 1,
             'style': {'fill': {'rgb': '0B121C', 'alpha': 1}, 'line': None, 'lineUniform': True, 'radii': [[0, 0]] * 4}}
    _slide_doc(tmp_path, [shape])
    out = tmp_path / 'deck.pptx'
    res = build(tmp_path, out, FONTS, 'Meldy — test', 'none')
    assert res['errors'] == [] and out.exists()
    side = json.loads(objects_path(out).read_text(encoding='utf-8'))
    roles = [(o['name'], o['role'], o['element']) for o in side['slides'][0]['objects']]
    assert roles == [('!!bg', 'bg', None), ('!!title', 'title', 'e1'), ('!!bar', 'shape', 'e2')]
