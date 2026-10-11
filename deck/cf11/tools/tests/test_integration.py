"""Build the fixtures' slides.json into a PPTX and check the saved file (needs `make.sh fixtures` run once)."""
import subprocess
import sys
from pathlib import Path

import pytest

from conftest import DECK, TOOLS

BUILD = DECK / 'out' / 'fixtures' / 'build'
VALIDATE = Path('/mnt/skills/public/pptx/scripts/office/validate.py')
pytestmark = pytest.mark.skipif(not (BUILD / 'slides.json').exists(), reason='run tools/make.sh fixtures first')


@pytest.fixture(scope='module')
def built(tmp_path_factory):
    out = tmp_path_factory.mktemp('pptx') / 'fixtures.pptx'
    r = subprocess.run([sys.executable, str(TOOLS / 'build.py'), '--build', str(BUILD), '--out', str(out)],
                       capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr
    return out


def test_saved_file_matches_the_html(built):
    r = subprocess.run([sys.executable, str(TOOLS / 'check_pptx.py'), str(built), str(BUILD / 'slides.json')],
                       capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr
    assert '0 failed' in r.stdout


@pytest.mark.skipif(not VALIDATE.exists(), reason='pptx skill validator not available')
def test_skill_validator(built):
    r = subprocess.run([sys.executable, str(VALIDATE), str(built)], capture_output=True, text=True, cwd=VALIDATE.parent)
    assert r.returncode == 0, r.stdout + r.stderr


def test_size_and_name(built):
    assert built.stat().st_size < 9_500_000
