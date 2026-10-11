import pytest

from conftest import FONTS
from deckpptx import fonts as F
from deckpptx.units import SLIDE_H_EMU, SLIDE_W_EMU, angle, emu, pct100k, pt, pt100


def test_slide_geometry():
    assert (SLIDE_W_EMU, SLIDE_H_EMU) == (12192000, 6858000)        # 13.333 x 7.5 in
    assert emu(1) == 6350 and emu(1920) == 12192000 and emu(1080) == 6858000
    assert emu(0.5) == 3175 and emu(-10) == -63500
    assert pt(48) == 24 and pt100(48) == 2400 and pt100(30.5) == 1525   # 2 px = 1 pt, sz in 1/100 pt
    assert pt100(-1.44) == -72                                          # letter spacing (spc) keeps its sign
    assert angle(90) == 5400000 and angle(-6) == 354 * 60000 and angle(360) == 0
    assert pct100k(0.55) == 55000 and pct100k(2) == 100000


@pytest.mark.parametrize('weight, typeface, bold', [
    (100, 'Onest', False), (400, 'Onest', False), (449, 'Onest', False),
    (450, 'Onest Medium', False), (500, 'Onest Medium', False),
    (550, 'Onest SemiBold', False), (600, 'Onest SemiBold', False),
    (650, 'Onest', True), (700, 'Onest', True), (900, 'Onest', True),
])
def test_weight_to_face(weight, typeface, bold):
    face = F.face_for_weight(weight)
    assert (face.typeface, face.bold) == (typeface, bold)


def test_font_files_match_the_mapping():
    # nameID 1/2 of the static TTFs are what PowerPoint matches typefaces against
    assert F.check_font_names(FONTS) == []


def test_vertical_metrics_typo():
    assert F.vertical_metrics(FONTS / 'Onest-400.ttf') == pytest.approx((0.97, 0.305, 0.0))


@pytest.mark.parametrize('weight', [400, 500, 600, 700])
def test_eot_round_trip(weight):
    face = F.FACES[weight]
    ttf = (FONTS / face.file).read_bytes()
    eot = F.ttf_to_eot(FONTS / face.file)
    h = F.parse_eot_header(eot)
    assert h['eotSize'] == len(eot)
    assert h['fontDataSize'] == len(ttf) and h['fontData'] == ttf      # uncompressed, no XOR
    assert h['version'] == 0x00020002 and h['flags'] == 0 and h['magic'] == 0x504C
    assert h['family'] == face.typeface                                 # what p:font/@typeface says
    assert h['subfamily'] == ('Bold' if face.bold else 'Regular')
    assert h['weight'] == weight and h['fsType'] == 0
    # after the names: Padding5, RootStringSize, RootStringCheckSum (empty root string = 0x50475342, "BSGP"),
    # EUDCCodePage, Padding6, SignatureSize, EUDCFlags, EUDCFontSize = 24 bytes, then the font data
    tail = len(eot) - len(ttf) - 24
    assert eot[tail + 4:tail + 8] == b'BSGP'
    assert int.from_bytes(eot[tail + 8:tail + 12], 'little') == 1252


def test_embed_fonts_package():
    from deckpptx.template import new_presentation
    prs = new_presentation()
    faces = F.embed_fonts(prs, FONTS)
    assert faces == ['Onest', 'Onest Medium', 'Onest SemiBold']
    pres = prs.part._element
    assert pres.get('embedTrueTypeFonts') == '1' and pres.get('saveSubsetFonts') is None
    lst = pres.find('{%s}embeddedFontLst' % F.NS_P)
    # schema order: ... sldSz, notesSz, smartTags?, embeddedFontLst ...
    assert lst.getprevious().tag.endswith('notesSz')
    slots = {ef[0].get('typeface'): [c.tag.split('}')[1] for c in ef[1:]] for ef in lst}
    assert slots == {'Onest': ['regular', 'bold'], 'Onest Medium': ['regular'], 'Onest SemiBold': ['regular']}
