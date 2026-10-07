"""The Hugging Face Space refuses a pushed binary file over 100 KB unless it is stored with Xet.

Release 29 (deploy-hf.yml, run 36) was rejected for a 143 KB frontend/public/og-image.png. The workflow
pushes every tracked file except qa-screens/, so a binary file over the limit anywhere else stops the next
release; this test fails first.
"""

import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
LIMIT = 100 * 1024
NOT_PUSHED = ("qa-screens/",)


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
    too_big = []
    for name in files:
        if name.startswith(NOT_PUSHED):
            continue
        path = ROOT / name
        if not path.is_file():
            continue  # deleted in the working tree
        size = path.stat().st_size
        if size > LIMIT and _is_binary(path):
            too_big.append(f"{name} ({size // 1024} KB)")
    assert too_big == []
