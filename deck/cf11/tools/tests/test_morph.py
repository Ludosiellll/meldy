"""Morph pairing as documented (deckpptx/morph.py) and the read-back of the fixture deck."""
from pathlib import Path

import pytest

from conftest import DECK
from deckpptx.morph import Obj, Package, pair_slides

FIXTURE_PPTX = DECK / 'out' / 'fixtures' / 'cf11-fixtures.pptx'


def obj(spid, name, kind='shape', z=None, geom='rect', text='', image=None, builds=False, slide=1):
    return Obj(slide=slide, spid=spid, name=name, kind=kind, z=spid if z is None else z, geom=geom, text=text,
               image_sha1=image, builds_in=builds)


def names(pairs):
    return sorted((p.a.name, p.b.name, p.how) for p in pairs)


def test_forced_names_pair_whatever_the_shape_and_text():
    a = [obj(2, '!!dot', geom='ellipse'), obj(3, '!!label', text='один')]
    b = [obj(2, '!!dot', geom='roundRect', slide=2), obj(3, '!!label', text='другой', slide=2)]
    r = pair_slides(a, b)
    assert names(r.pairs) == [('!!dot', '!!dot', 'name'), ('!!label', '!!label', 'name')]
    assert not r.gone and not r.new


def test_forced_names_need_the_same_type():
    r = pair_slides([obj(2, '!!w', kind='shape')], [obj(2, '!!w', kind='picture', image='x', slide=2)])
    assert not r.pairs and len(r.gone) == 1 and len(r.new) == 1
    assert any('same type' in n for n in r.notes)


def test_automatic_match_is_same_type_and_content_and_never_a_forced_object():
    a = [obj(2, 'Text 1', text='Шпаргалка'), obj(3, '!!x', text='Шпаргалка'), obj(4, 'Pic', kind='picture', image='abc'),
         obj(5, 'Box', geom='roundRect')]
    b = [obj(7, 'Text 9', text='Шпаргалка', slide=2), obj(8, 'Pic 2', kind='picture', image='abc', slide=2),
         obj(9, 'Box 2', geom='ellipse', slide=2), obj(10, 'Other', text='Другое', slide=2)]
    r = pair_slides(a, b)
    assert names(r.pairs) == [('Pic', 'Pic 2', 'auto'), ('Text 1', 'Text 9', 'auto')]
    assert {o.name for o in r.gone} == {'!!x', 'Box'} and {o.name for o in r.new} == {'Box 2', 'Other'}


def test_identical_candidates_are_paired_in_z_order_and_flagged():
    a = [obj(2, 'A1', geom='roundRect', z=0), obj(3, 'A2', geom='roundRect', z=1)]
    b = [obj(5, 'B2', geom='roundRect', z=1, slide=2), obj(4, 'B1', geom='roundRect', z=0, slide=2)]
    r = pair_slides(a, b)
    assert names(r.pairs) == [('A1', 'B1', 'auto'), ('A2', 'B2', 'auto')]
    assert all('ambiguous' in p.note for p in r.pairs)


def test_objects_that_build_in_take_no_part_and_are_reported():
    a = [obj(2, '!!word', text='Meldy'), obj(3, 'Chip', geom='roundRect')]
    b = [obj(2, '!!word', text='Meldy', builds=True, slide=2), obj(3, 'Chip 2', geom='roundRect', builds=True, slide=2)]
    r = pair_slides(a, b)
    assert not r.pairs and len(r.held) == 2 and len(r.gone) == 2
    assert sorted((p.b.name, p.how) for p in r.blocked) == [('!!word', 'name'), ('Chip 2', 'auto')]


def test_duplicate_forced_names_are_noted():
    r = pair_slides([obj(2, '!!a'), obj(3, '!!a')], [obj(2, '!!a', slide=2)])
    assert len(r.pairs) == 1 and any('2 times' in n for n in r.notes)


@pytest.mark.skipif(not FIXTURE_PPTX.exists(), reason='run tools/make.sh fixtures first')
def test_reads_the_fixture_deck():
    pkg = Package(FIXTURE_PPTX)
    kinds = [(s.transition.kind, s.transition.option, s.transition.dur_ms) for s in pkg.slides]
    assert kinds == [('fade', None, 700), ('morph', 'byWord', 1500), ('morph', 'byObject', 1500), ('cut', None, 0)]
    s1 = pkg.slides[0]
    assert s1.objects[0].name == '!!bg' and s1.objects[0].kind == 'picture' and s1.objects[0].z == 0
    dot = [o for o in pkg.slides[1].objects if o.name == '!!dot'][0]
    assert dot.geom == 'roundRect' and dot.fill and abs(dot.w - 812) < 1
    video = [o for o in pkg.slides[1].objects if o.kind == 'media']
    assert len(video) == 1 and video[0].media and video[0].image          # the clip and its poster
    title = [o for o in pkg.slides[2].objects if o.name == '!!title'][0]
    assert title.placeholder == 'title' and title.text == 'Актуальность'
    assert any(o.builds_in for o in pkg.slides[2].objects) and not any(o.builds_in for o in pkg.slides[3].objects)
