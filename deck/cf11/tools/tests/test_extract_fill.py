"""extract.mjs on a one-slide deck: private fill (data-fill), data-morph, data-anim-dir, settle, text layers."""
import json
import shutil
import subprocess

import pytest

from conftest import TOOLS

NODE = shutil.which('node')
pytestmark = pytest.mark.skipif(NODE is None, reason='node not available')

SLIDE = """<!doctype html><html lang="ru"><head><meta charset="utf-8">
<link rel="stylesheet" href="{css}"></head><body>
<main class="slide" data-transition="morph" data-morph="char">
  <h1 class="label" data-pptx="title">Автор проекта</h1>
  <p class="claim" data-pptx="text" style="top:300px"><span data-fill="author1.name">[Имя]</span> и <span data-fill="nokey">[нет]</span></p>
  <div class="claim" data-pptx="text" style="top:520px" data-anim="wipe" data-anim-dir="down">Снизу</div>
  <div class="claim" data-pptx="text" style="top:700px" data-anim="settle" data-anim-dir="up">Спокойно</div>
</main></body></html>"""


def run(tmp_path, fill):
    slides = tmp_path / 'slides'
    slides.mkdir(exist_ok=True)
    (slides / '01-a.html').write_text(SLIDE.format(css=(TOOLS / 'fixtures' / 'fixture.css').as_uri()), encoding='utf-8')
    out = tmp_path / 'build'
    r = subprocess.run([NODE, str(TOOLS / 'extract.mjs'), '--slides', str(slides), '--out', str(out), '--fill', str(fill),
                        '--no-opt'], capture_output=True, text=True, timeout=180)
    assert r.returncode == 0, r.stdout + r.stderr
    doc = json.loads((out / 'slides.json').read_text(encoding='utf-8'))
    return doc['slides'][0], r.stdout + r.stderr


def text_of(e):
    return ''.join(r['text'] for p in e['text']['paragraphs'] for ln in p['lines'] for r in ln['runs'])


def test_fill_values_replace_placeholders_and_missing_keys_warn_once(tmp_path):
    fill = tmp_path / 'fill.json'
    fill.write_text(json.dumps({'author1.name': 'Тестова Анна'}, ensure_ascii=False), encoding='utf-8')
    s, log = run(tmp_path, fill)
    claim = [e for e in s['elements'] if e['type'] == 'text'][0]
    assert text_of(claim) == 'Тестова Анна и [нет]'
    assert s['filled'] == ['author1.name']
    assert log.count('fill: no "nokey"') == 1 and 'author1.name' not in log
    assert s['transition']['option'] == 'char'
    wipe, settle = [e for e in s['elements'] if e.get('anim')]
    assert wipe['anim'] == {**wipe['anim'], 'effect': 'wipe', 'dir': 'down'}
    assert settle['anim']['effect'] == 'settle' and 'dir' not in settle['anim']
    assert any('data-anim-dir only applies to wipe' in w for w in s['warnings'])
    assert all(e.get('textLayer', {}).get('png', '').endswith('-text.png') for e in s['elements'])


def test_without_the_fill_file_the_placeholders_stay(tmp_path):
    s, log = run(tmp_path, tmp_path / 'missing.json')
    claim = [e for e in s['elements'] if e['type'] == 'text'][0]
    assert text_of(claim) == '[Имя] и [нет]' and s['filled'] == []
    assert log.count('not found') == 2                       # one warning per key
