"""The Hugging Face Space refuses a pushed binary file over 100 KB unless it is stored with Xet.

Release 29 (deploy-hf.yml, run 36) was rejected for a 143 KB frontend/public/og-image.png. The workflow
pushes every tracked file except the folders its `git rm -r -q --cached --ignore-unmatch …` line drops
(qa-screens/ and the presentation's deck/), so a binary file over the limit anywhere else stops the next
release; this test fails first. The list of dropped folders is read from the workflow itself, so the two stay
in step.
"""

import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
LIMIT = 100 * 1024
WORKFLOW = ROOT / ".github" / "workflows" / "deploy-hf.yml"


def _not_pushed() -> tuple[str, ...]:
    """The folders deploy-hf.yml drops from the pushed tree: the paths after `--ignore-unmatch` on its git rm line."""
    for line in WORKFLOW.read_text(encoding="utf-8").splitlines():
        words = line.split()
        if "rm" in words and "--cached" in words and "--ignore-unmatch" in words:
            paths = [word for word in words[words.index("--ignore-unmatch") + 1:] if not word.startswith("-")]
            return tuple(path.rstrip("/") + "/" for path in paths)
    raise AssertionError("deploy-hf.yml has no `git rm --cached --ignore-unmatch` line")


def test_the_workflow_drops_qa_screens_and_the_deck():
    assert set(_not_pushed()) >= {"qa-screens/", "deck/"}


def _tracked_files() -> list[str] | None:
    try:
        out = subprocess.run(["git", "ls-files", "-z"], cwd=ROOT, capture_output=True, check=True).stdout
    except (OSError, subprocess.CalledProcessError):
        return None  # not a git checkout (a source archive): nothing to check
    return [name for name in out.decode("utf-8").split("\0") if name]


def _is_binary(path: Path) -> bool:
    """Binary as git decides it: a NUL among the first 8000 bytes."""
    with path.open("rb") as handle:
        return b"\0" in handle.read(8000)


def test_no_binary_file_over_100_kb_is_pushed_to_the_space():
    files = _tracked_files()
    if files is None:
        pytest.skip("not a git checkout")
    not_pushed = _not_pushed()
    too_big = []
    for name in files:
        if name.startswith(not_pushed):
            continue
        path = ROOT / name
        if not path.is_file():
            continue  # deleted in the working tree
        size = path.stat().st_size
        if size > LIMIT and _is_binary(path):
            too_big.append(f"{name} ({size // 1024} KB)")
    assert too_big == []
