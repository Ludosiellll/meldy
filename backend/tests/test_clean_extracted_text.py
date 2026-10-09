import random
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from parser import clean_extracted_text  # noqa: E402


def _old_clean(text: str) -> str:
    """The previous rules, kept here to prove the new ones give the same text."""
    text = text.replace("﻿", "")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("\x00", "")
    text = re.sub(r"[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]", "", text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def test_same_text_as_the_previous_rules():
    rng = random.Random(7)
    alphabet = ["a", "б", " ", " ", "\t", "\n", "\r\n", "\r", "\x00", "\x07", "﻿", "  \n", "\t\n", "x  "]
    for _ in range(3000):
        sample = "".join(rng.choice(alphabet) for _ in range(rng.randint(0, 60)))
        assert clean_extracted_text(sample) == _old_clean(sample), repr(sample)


def test_trailing_spaces_and_blank_lines():
    assert clean_extracted_text("  Вопрос 1.  \t\n\n\n\nВопрос 2.\t \n") == "Вопрос 1.\n\nВопрос 2."
    assert clean_extracted_text("код:\n    int a = 1;  \n    a -= 2;") == "код:\n    int a = 1;\n    a -= 2;"


def test_long_run_of_spaces_is_fast():
    text = "начало" + " " * 200_000 + "конец" + " \t" * 100_000
    started = time.perf_counter()
    assert clean_extracted_text(text) == "начало" + " " * 200_000 + "конец"
    assert time.perf_counter() - started < 0.5
