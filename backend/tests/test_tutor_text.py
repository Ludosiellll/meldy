"""Ответ репетитора по предложениям для голоса (tutor_text.py)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tutor_text import SentenceSplitter, refs_of, speakable  # noqa: E402


def stream(*pieces: str) -> list[tuple[str, list[str]]]:
    splitter = SentenceSplitter()
    out = []
    for piece in pieces:
        out += [(s.text, s.refs) for s in splitter.feed(piece)]
    out += [(s.text, s.refs) for s in splitter.flush()]
    return out


def test_the_first_sentence_leaves_as_soon_as_the_next_one_starts():
    splitter = SentenceSplitter()
    assert splitter.feed("Хорошо") == []
    assert splitter.feed(". ") == []  # a reference may still follow
    first = splitter.feed("Теперь")
    assert [s.text for s in first] == ["Хорошо."]
    assert [s.text for s in splitter.feed(" скажите, почему?")] == []
    assert [s.text for s in splitter.flush()] == ["Теперь скажите, почему?"]


def test_abbreviations_initials_numbers_and_lists_do_not_end_a_sentence():
    text = "Это т. е. рынок, см. рис. 3 и т. д. в 1990-х. А. С. Пушкин писал. Ставка 7.5 процента! Верно? "
    assert [t for t, _ in stream(text)] == [
        "Это т. е. рынок, см. рис. 3 и т. д. в 1990-х.",
        "А. С. Пушкин писал.",
        "Ставка 7.5 процента!",
        "Верно?",
    ]
    # A list number is not a sentence of its own, and the voice does not read it out.
    assert [t for t, _ in stream("1. Первое. 2. Второе.")] == ["Первое.", "Второе."]


def test_quotes_ellipsis_and_paragraphs():
    assert [t for t, _ in stream("Он сказал: «Так.» Потом… Подумал?! Да\n\nНовый абзац")] == [
        "Он сказал: «Так.»",
        "Потом…",
        "Подумал?!",
        "Да",
        "Новый абзац",
    ]


def test_references_stay_with_their_sentence_and_leave_the_spoken_text():
    out = stream("Рост ВВП зависит от инвестиций [S03]. ", "Так в лекции. [S07, S12] ", "А вы как ", "думаете?")
    assert out == [
        ("Рост ВВП зависит от инвестиций.", ["S03"]),
        ("Так в лекции.", ["S07", "S12"]),
        ("А вы как думаете?", []),
    ]
    # A reference still being written holds the sentence back.
    splitter = SentenceSplitter()
    assert splitter.feed("Так. [S0") == []
    assert [(s.text, s.refs) for s in splitter.feed("4] Дальше")] == [("Так.", ["S04"])]


def test_a_long_sentence_is_cut_at_a_comma_so_the_voice_does_not_wait():
    long = "Инфляция — это устойчивый рост общего уровня цен, " * 6
    splitter = SentenceSplitter()
    parts = splitter.feed(long)
    assert parts and all(len(p.text) <= 220 for p in parts)
    assert parts[0].text.endswith(",")


def test_speakable_removes_markdown_lists_and_cut_references():
    assert speakable("**Важно:** `ставка` растёт [S01].\n- пункт один\n- пункт два [S0") == "Важно: ставка растёт. пункт один пункт два"
    assert refs_of("[S1] и [S01, S2] и [S03]") == ["S01", "S02", "S03"]
    assert stream("[S01]. ") == []
