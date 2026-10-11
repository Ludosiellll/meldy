from compare import lo_spacing_drift


def run(text, ls, rgb='0B121C', **kw):
    return {'text': text, 'weight': 600, 'italic': False, 'sizePx': 72, 'color': {'rgb': rgb, 'alpha': 1},
            'letterSpacingPx': ls, 'underline': False, 'strike': False, 'baselineShift': 0, 'href': None, **kw}


def element(*lines):
    return {'text': {'paragraphs': [{'lines': [{'runs': list(runs)} for runs in lines]}]}}


def test_negative_spacing_is_lost_at_every_colour_change_inside_a_line():
    line = [run('Пилот: ', -2.16), run('[N]', -2.16, '8A8F97'), run(' студентов, ', -2.16),
            run('[M]', -2.16, '8A8F97'), run(' дней', -2.16)]
    assert lo_spacing_drift(element(line)) == 8.64


def test_no_drift_for_positive_or_zero_spacing_or_a_single_run():
    assert lo_spacing_drift(element([run('a', 2.0), run('b', 2.0, 'FFFFFF')])) == 0
    assert lo_spacing_drift(element([run('a', 0.0), run('b', 0.0, 'FFFFFF')])) == 0
    assert lo_spacing_drift(element([run('abc', -3.0)])) == 0


def test_worst_line_counts_and_line_ends_do_not():
    first = [run('один ', -1.0), run('два', -1.0, 'FFFFFF')]             # one change: 1 px
    second = [run('три ', -2.0), run('четыре', -2.0, 'FFFFFF'), run(' пять', -2.0)]   # two changes: 4 px
    assert lo_spacing_drift(element(first, second)) == 4.0


def test_runs_differing_only_in_family_are_one_portion():
    a, b = run('a', -2.0), run('b', -2.0)
    b['family'] = 'Onest, sans-serif'
    assert lo_spacing_drift(element([a, b])) == 0
