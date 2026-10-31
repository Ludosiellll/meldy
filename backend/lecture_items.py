"""Вопросы теста из лекции (выпуск 49): у каждого — фраза-источник из текста лекции и ключ, сверенный с ней.

Вход — вопросы самопроверки лекции (quiz_json: question, options «A) …», correct «A», explanation, source_ids) и её
фрагменты (summary_json.grounding.sources или utils.build_source_chunks того же текста: те же S-id). Выход — вопросы для
test_items (single) с цитатой.

Фраза-источник — всегда настоящее предложение лекции: его не пишет модель, его выбирает код из фрагментов, на которые
сослалась модель (source_ids), а потом из остальных. Выбирается предложение, где больше всего слов верного ответа и
вопроса (основы слов: retrieval.stem). Сверка ключа:
- «сверен» (checked): в фразе есть слова верного ответа (не меньше половины), и ни один неверный вариант не подходит к
  ней так же или лучше;
- «проверьте» (doubt): фраза с верным ответом есть, но неверный вариант подходит к ней не хуже (фраза перечисляет
  несколько вариантов) — автор решает сам, по умолчанию такой вопрос не отмечен;
- фразы с верным ответом нет — вопрос не предлагается вовсе (dropped): ответа в тексте лекции нет.
Цитата добавляется к пояснению: «Из лекции «…»: «…»» (test_items хранит одно пояснение, до 2000 знаков); у текста и
файла — «Из текста: …», «Из файла «…»: …».
"""

from __future__ import annotations

import re
from typing import Any, Iterable, Optional

from retrieval import STOPWORDS, stem, tokenize

QUOTE_MAX_CHARS = 320
EXPLANATION_MAX_CHARS = 2000
MIN_ANSWER_SHARE = 0.5
_SENTENCE_RE = re.compile(r"(?<=[.!?…])\s+(?=[«\"(A-ZА-ЯЁ0-9])|\n+")
_LETTER_RE = re.compile(r"^\s*([A-Za-zА-Яа-яЁё])\s*[).:\-]\s*")
_LATIN = "ABCDEFGH"
_CYRILLIC = "АБВГДЕЖЗ"


def stems(text: str) -> set[str]:
    """Основы значимых слов: без служебных, числа — как есть."""
    return {stem(token) for token in tokenize(text) if token not in STOPWORDS and (len(token) >= 3 or token.isdigit())}


def sentences(text: str) -> list[str]:
    """Предложения фрагмента как они написаны (строка списка — тоже предложение)."""
    out = []
    for piece in _SENTENCE_RE.split(text or ""):
        piece = piece.strip()
        if len(piece.split()) >= 3:
            out.append(piece)
    return out


def _cut(sentence: str) -> str:
    """Предложение длиннее QUOTE_MAX_CHARS — его начало по границе слова и «…» (слова — дословно из лекции)."""
    if len(sentence) <= QUOTE_MAX_CHARS:
        return sentence
    head = sentence[:QUOTE_MAX_CHARS]
    head = head[: head.rfind(" ")] if " " in head else head
    return head.rstrip(" ,;:—-") + "…"


def option_body(option: str) -> str:
    """«A) Текст» → «Текст»."""
    return _LETTER_RE.sub("", option or "", count=1).strip()


def correct_index(correct: Any, options: list[str]) -> Optional[int]:
    """Буква ответа самопроверки («A», «Б») → номер варианта."""
    letter = str(correct or "").strip()[:1].upper()
    if not letter:
        return None
    for alphabet in (_LATIN, _CYRILLIC):
        if letter in alphabet and alphabet.index(letter) < len(options):
            return alphabet.index(letter)
    return None


def _share(words: set[str], sentence_words: set[str]) -> float:
    return len(words & sentence_words) / len(words) if words else 0.0


def source_phrase(question: str, right: str, wrongs: list[str], chunks: list[dict], prefer: Iterable[str] = ()) -> Optional[dict]:
    """Фраза-источник для вопроса: {"quote", "source_id", "checked"} или None — верного ответа в тексте нет."""
    right_words = stems(right)
    if not right_words:
        return None
    question_words = stems(question) - right_words
    wrong_words = [stems(wrong) - right_words for wrong in wrongs]
    preferred = [source_id for source_id in prefer if isinstance(source_id, str)]
    order = sorted(chunks, key=lambda chunk: (chunk.get("id") not in preferred,
                                              preferred.index(chunk["id"]) if chunk.get("id") in preferred else 0))
    best: Optional[tuple[tuple, dict]] = None
    for rank, chunk in enumerate(order):
        for sentence in sentences(str(chunk.get("text") or "")):
            words = stems(sentence)
            answer = _share(right_words, words)
            if answer < MIN_ANSWER_SHARE:
                continue
            rival = max((_share(wrong, words) for wrong in wrong_words if wrong), default=0.0)
            checked = rival < answer
            asked = len(question_words & words)
            score = (checked, round(answer, 3), asked, chunk.get("id") in preferred, -rank)
            if best is None or score > best[0]:
                best = (score, {"quote": _cut(sentence), "source_id": chunk.get("id"), "checked": checked})
    return best[1] if best else None


def source_label(kind: str, title: str = "") -> str:
    """Откуда цитата: «Из лекции «Инфляция»», «Из текста», «Из файла «Глава 2»»."""
    title = " ".join((title or "").split())[:120]
    if kind == "text":
        return "Из текста"
    word = "Из файла" if kind == "file" else "Из лекции"
    return f"{word} «{title}»" if title else word


def with_quote(explanation: str, quote: str, where: str = "Из лекции") -> str:
    """Пояснение и цитата одним текстом (≤ EXPLANATION_MAX_CHARS): цитата не режется, режется пояснение."""
    tail = f"{where}: «{quote}»"
    room = EXPLANATION_MAX_CHARS - len(tail) - 2
    text = (explanation or "").strip()
    if len(text) > room:
        text = text[: max(0, room - 1)].rstrip() + "…" if room > 1 else ""
    return f"{text}\n\n{tail}" if text else tail


def items_from_quiz(quiz: Iterable[dict], chunks: list[dict], where: str = "Из лекции") -> tuple[list[dict], int]:
    """Вопросы самопроверки → вопросы теста с цитатой и сверкой ключа; второе — сколько не предложено (ответа нет в
    тексте или вопрос не читается)."""
    out: list[dict] = []
    dropped = 0
    for item in quiz:
        if not isinstance(item, dict):
            dropped += 1
            continue
        stem_text = " ".join(str(item.get("question") or "").split())
        options = [option_body(str(option)) for option in item.get("options") or [] if str(option).strip()]
        index = correct_index(item.get("correct"), options)
        if not stem_text or not 2 <= len(options) <= 8 or index is None or len(set(o.lower() for o in options)) != len(options):
            dropped += 1
            continue
        phrase = source_phrase(stem_text, options[index], [o for k, o in enumerate(options) if k != index], chunks,
                               item.get("source_ids") or [])
        if phrase is None:
            dropped += 1
            continue
        explanation = " ".join(str(item.get("explanation") or "").split())
        out.append({
            "stem": stem_text[:4000],
            "options": [option[:600] for option in options],
            "correct": [index],
            "explanation": with_quote(explanation, phrase["quote"], where),
            "quote": phrase["quote"],
            "source_id": phrase["source_id"],
            "checked": phrase["checked"],
        })
    return out, dropped
