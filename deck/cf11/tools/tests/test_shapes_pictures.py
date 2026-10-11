import pytest

from deckpptx.pictures import pic_el, placement
from deckpptx.shapes import K45, box_geometry, classify, custom_geometry, geometry_el, sp_pr, text_rect_insets

A = '{http://schemas.openxmlformats.org/drawingml/2006/main}'


@pytest.mark.parametrize('w, h, radii, kind, adj', [
    (22, 22, [[0, 0]] * 4, 'rect', {}),
    (22, 22, [[5, 5]] * 4, 'roundRect', {'adj': 22727}),                     # strip square, 5 px corners
    (386, 64, [[32, 32]] * 4, 'roundRect', {'adj': 50000}),                  # pill (999px scaled to h/2)
    (56, 56, [[28, 28]] * 4, 'ellipse', {}),                                 # border-radius: 50% on a square
    (300, 160, [[150, 80]] * 4, 'ellipse', {}),                              # border-radius: 50% on a rectangle
    (612, 120, [[32, 32], [32, 32], [0, 0], [0, 0]], 'round2SameRect', {'adj1': 26667, 'adj2': 0}),
    (200, 100, [[10, 10], [20, 20], [0, 0], [0, 0]], 'custom', {}),
])
def test_geometry_classification(w, h, radii, kind, adj):
    assert classify(w, h, radii) == (kind, adj)


def test_custom_geometry_has_one_arc_per_rounded_corner():
    g = custom_geometry(1000, 500, [(100, 100), (0, 0), (50, 80), (0, 0)])
    assert len(g.findall(f'.//{A}arcTo')) == 2 and g.find(f'.//{A}close') is not None


def test_outline_is_inset_by_half_its_width():
    style = {'line': {'w': 2, 'color': {'rgb': 'E3E3DD', 'alpha': 1}, 'dash': 'solid'}, 'lineUniform': True,
             'radii': [[32, 32]] * 4}
    b, radii, line = box_geometry({'x': 96, 'y': 204, 'w': 824, 'h': 560}, style)
    assert b == {'x': 97, 'y': 205, 'w': 822, 'h': 558} and radii[0] == [31, 31] and line['w'] == 2


def test_sp_pr_fill_alpha_and_dash():
    style = {'fill': {'rgb': '2869DD', 'alpha': 0.12}, 'line': {'w': 3, 'color': {'rgb': '8A8F97', 'alpha': 1}, 'dash': 'dashed'},
             'lineUniform': True, 'radii': [[0, 0]] * 4}
    sp, kind = sp_pr({'x': 0, 'y': 0, 'w': 240, 'h': 168}, style, opacity=0.5)
    assert kind == 'rect'
    assert sp.find(f'{A}solidFill/{A}srgbClr/{A}alpha').get('val') == '6000'          # 0.12 * 0.5
    ln = sp.find(A + 'ln')
    assert ln.get('w') == str(3 * 6350) and ln.find(A + 'prstDash').get('val') == 'dash' and ln.find(A + 'miter') is not None
    assert [c.tag.split('}')[1] for c in sp] == ['xfrm', 'prstGeom', 'solidFill', 'ln']


def test_text_rect_insets():
    assert text_rect_insets(386, 64, [[32, 32]] * 4) == pytest.approx((32 * K45,) * 4)
    assert text_rect_insets(300, 160, [[150, 80]] * 4) == pytest.approx((150 * K45, 80 * K45, 150 * K45, 80 * K45))
    assert text_rect_insets(100, 50, [[0, 0]] * 4) == (0, 0, 0, 0)


def test_rotation_in_xfrm():
    sp, _ = sp_pr({'x': 10, 'y': 10, 'w': 220, 'h': 96}, {'fill': {'rgb': 'F5B6CD', 'alpha': 1}, 'radii': [[16, 16]] * 4}, 1.0, rot=-6)
    assert sp.find(A + 'xfrm').get('rot') == str(354 * 60000)


def test_cover_crop():
    # 1280x720 clip in an 812x560 window, object-fit: cover, centred
    frame, crop = placement({'x': 980, 'y': 214, 'w': 812, 'h': 560}, (1280, 720), 'cover', '50% 50%', None)
    assert frame == pytest.approx({'x': 980, 'y': 214, 'w': 812, 'h': 560})
    s = 560 / 720
    side = (1280 * s - 812) / 2 / (1280 * s)
    assert crop == pytest.approx({'l': side, 't': 0, 'r': side, 'b': 0})


def test_contain_shrinks_the_frame():
    frame, crop = placement({'x': 0, 'y': 0, 'w': 400, 'h': 400}, (800, 400), 'contain', '50% 50%', None)
    assert frame == pytest.approx({'x': 0, 'y': 100, 'w': 400, 'h': 200}) and crop is None


def test_clip_by_overflow_ancestor():
    frame, crop = placement({'x': 0, 'y': 0, 'w': 100, 'h': 100}, None, 'fill', None, {'x': 0, 'y': 0, 'w': 100, 'h': 50})
    assert frame == pytest.approx({'x': 0, 'y': 0, 'w': 100, 'h': 50}) and crop == pytest.approx({'l': 0, 't': 0, 'r': 0, 'b': 0.5})


def test_picture_xml():
    g, _ = geometry_el(612, 420, [[32, 32]] * 4)
    pic = pic_el(7, 'Picture 04.15', 'rId3', {'x': 1180, 'y': 196, 'w': 612, 'h': 420}, descr='Экран плана по дням',
                 hlink_rid='rId4', crop={'l': 0.1, 't': 0, 'r': 0.1, 'b': 0}, geom=g, alpha=0.5, svg_rid='rId5')
    c = pic.find('.//{http://schemas.openxmlformats.org/presentationml/2006/main}cNvPr')
    assert c.get('descr') == 'Экран плана по дням' and c.find(A + 'hlinkClick') is not None
    blip = pic.find(f'.//{A}blip')
    assert blip.find(A + 'alphaModFix').get('amt') == '50000'
    assert blip.find(f'{A}extLst/{A}ext').get('uri') == '{96DAC541-7B7A-43D3-8B79-37D633B846F1}'
    assert pic.find(f'.//{A}srcRect').attrib == {'l': '10000', 'r': '10000'}
    assert pic.find(f'.//{A}prstGeom').get('prst') == 'roundRect'
