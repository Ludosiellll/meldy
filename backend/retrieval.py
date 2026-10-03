"""Общий лексический поиск по фрагментам лекций: основы Snowball и BM25.

Один модуль для разметки билетов (backend/exams_map.py) и для подбора фрагментов
эталона устного ответа (backend/oral.py), договорённость 5.1 #4 плана хакатона.
Поиск только подбирает кандидатов: совпадение слов никогда не считается
доказательством того, что вопрос есть в лекции, — это решает модель или человек.

Анализ материала (find_source_ids, extract_relevant_paragraphs, 80 фрагментов)
этот модуль не трогает. Новые функции режут текст без потолка:
build_source_chunks(text, max_chunks=None); первые 80 id и тексты совпадают
с теми, что сохранены в summary_json.grounding.
"""

from __future__ import annotations

import math
import re
import threading
import unicodedata
from bisect import bisect_left
from collections import Counter
from dataclasses import dataclass
from functools import lru_cache
from typing import Iterable

import snowballstemmer

from utils import build_source_chunks

__all__ = [
    "BM25Index",
    "EXAM_STOPWORDS",
    "Hit",
    "Passage",
    "STOPWORDS",
    "material_passages",
    "normalize_text",
    "stem",
    "terms",
    "tokenize",
]

_TOKEN_RE = re.compile(r"[0-9a-zа-я]+")
# Те же слова в написании лекции (заглавные буквы и «ё» сохраняются): из них Hit.matched_words.
_SURFACE_RE = re.compile(r"[0-9A-Za-zА-Яа-яЁё]+")
_CYRILLIC_RE = re.compile(r"[а-я]")
_LATIN_RE = re.compile(r"[a-z]")

# Заголовок: короткий фрагмент (до 120 знаков) без точки в конце.
HEADING_MAX_CHARS = 120
_TRAILING_CLOSERS = " \t\r\n»\"'”’)]"


def normalize_text(text: str) -> str:
    """NFC, нижний регистр, «ё» → «е»."""
    return unicodedata.normalize("NFC", text or "").lower().replace("ё", "е")


def tokenize(text: str) -> list[str]:
    """Токены [0-9a-zа-я]+ нормализованного текста длиной от двух знаков."""
    return [token for token in _TOKEN_RE.findall(normalize_text(text)) if len(token) >= 2]


_local = threading.local()


def _stemmers() -> tuple:
    # Объекты snowballstemmer хранят состояние разбора слова, поэтому у каждого потока свои.
    pair = getattr(_local, "stemmers", None)
    if pair is None:
        pair = (snowballstemmer.stemmer("russian"), snowballstemmer.stemmer("english"))
        _local.stemmers = pair
    return pair


@lru_cache(maxsize=131072)
def _stem_normalized(token: str) -> str:
    if not token or token.isdigit():
        return token
    has_cyrillic = _CYRILLIC_RE.search(token) is not None
    has_latin = _LATIN_RE.search(token) is not None
    russian, english = _stemmers()
    if has_cyrillic and not has_latin:
        return russian.stemWord(token) or token
    if has_latin and not has_cyrillic:
        return english.stemWord(token) or token
    return token  # смешанная запись («cтол» с латинской c) остаётся как есть


def stem(token: str) -> str:
    """Основа слова: snowball russian для кириллицы, english для латиницы, числа как есть. Кешируется."""
    return _stem_normalized(normalize_text(token).strip())


# Служебные слова (сравниваются с нормализованным токеном до стемминга: «ё» уже стала «е»).
STOPWORDS: frozenset[str] = frozenset(
    """
    и в во не что он на я с со как а то все она так его но да ты к у же вы за бы по только ее мне
    было вот от меня еще нет о из ему теперь когда даже ну вдруг ли если уже или ни быть был него
    до вас нибудь опять уж вам ведь там потом себя ничего ей может они тут где есть надо ней для мы
    тебя их чем была сам чтоб без будто чего раз тоже себе под будет ж тогда кто этот того потому
    этого какой совсем ним здесь этом один почти мой тем чтобы нее сейчас были куда зачем всех
    никогда можно при наконец два об другой хоть после над больше тот через эти нас про всего них
    какая много разве три эту моя впрочем хорошо свою этой перед иногда лучше чуть том нельзя
    такой им более всегда конечно всю между это также который которая которое которые которого
    которой котором которым которых является являются каждый каждая каждое каждого
    the of and or in on to for with by is are be as at from that this it its was were which an
    """.split()
)

# Слова формулировки экзаменационного вопроса: в запросе они не ищутся (хранятся основами).
# Список контракта плюс несколько глаголов-инструкций, которые в тексте лекции не встречаются.
_EXAM_STOPWORD_FORMS = (
    "охарактеризуйте опишите раскройте понятие сущность роль значение особенности основные виды "
    "дайте определение назовите перечислите приведите примеры сравните объясните вопрос "
    "расскажите укажите поясните обоснуйте изложите проанализируйте сформулируйте"
)
EXAM_STOPWORDS: frozenset[str] = frozenset(stem(word) for word in _EXAM_STOPWORD_FORMS.split())


def _terms_from_tokens(tokens: Iterable[str], exam_stopwords: bool) -> list[str]:
    result: list[str] = []
    for token in tokens:
        if token in STOPWORDS:
            continue
        base = _stem_normalized(token)
        if not base or (exam_stopwords and base in EXAM_STOPWORDS):
            continue
        result.append(base)
    return result


def terms(text: str, *, exam_stopwords: bool = False) -> list[str]:
    """Основы значимых слов текста по порядку (с повторами), без служебных слов."""
    return _terms_from_tokens(tokenize(text), exam_stopwords)


def _unique(items: Iterable[str]) -> list[str]:
    return list(dict.fromkeys(items))


@dataclass(frozen=True)
class Passage:
    """Фрагмент лекции. order — номер фрагмента в материале (S07 → 7)."""

    material_id: str
    title: str
    source_id: str
    text: str
    order: int


def material_passages(material_id: str, title: str, text: str) -> list[Passage]:
    """Все фрагменты материала, без потолка в 80 штук: build_source_chunks(text, max_chunks=None)."""
    chunks = build_source_chunks(text or "", max_chunks=None)  # type: ignore[arg-type]
    return [
        Passage(
            material_id=str(material_id),
            title=title or "",
            source_id=chunk["id"],
            text=chunk["text"],
            order=_source_number(chunk["id"], fallback=index),
        )
        for index, chunk in enumerate(chunks, start=1)
    ]


def _source_number(source_id: str, *, fallback: int) -> int:
    digits = source_id[1:] if source_id[:1] == "S" else ""
    return int(digits) if digits.isdigit() else fallback


def _is_heading(text: str) -> bool:
    stripped = (text or "").strip()
    if not stripped or len(stripped) > HEADING_MAX_CHARS:
        return False
    return not stripped.rstrip(_TRAILING_CLOSERS).endswith((".", "…"))


@dataclass
class Hit:
    """Найденный фрагмент.

    score, idf_share и matched_stems считаются по документу индекса: фрагменту вместе со
    склеенным с ним заголовком. heading — текст этого заголовка (или None).

    matched_words — слова самого фрагмента passage.text в написании лекции («ЦБ», «ставкой»),
    чьи основы совпали с вопросом, по порядку появления. Слова заголовка сюда не входят:
    если с вопросом совпал только заголовок, matched_words == [], и показывать нужно
    заголовок, например «совпал заголовок раздела «…»», а не «там есть слово …».
    """

    passage: Passage
    score: float
    idf_share: float
    matched_stems: list[str]
    matched_words: list[str]
    heading: str | None


@dataclass
class _Doc:
    target: int  # индекс фрагмента-содержания в списке passages
    heading_indices: tuple[int, ...]
    tf: Counter  # нормализованные токены (без служебных слов) → число вхождений
    length: int


def _russian_stemmed(token: str) -> bool:
    """Токен, который стеммит snowball russian: есть кириллица и нет латиницы."""
    return _CYRILLIC_RE.search(token) is not None and _LATIN_RE.search(token) is None


def _candidate_prefix(term: str) -> str:
    """Префикс, с которого начинается любая словоформа с основой term.

    Русская основа snowball — префикс слова: алгоритм только отсекает окончания.
    Английский snowball (Porter2) может заменить последние буквы («happy» → «happi»,
    «probability» → «probabl»), но основа без двух последних букв остаётся префиксом
    слова. Проверено на ~48 тыс. словоформ; кандидаты всё равно сверяются стеммингом.
    """
    if _russian_stemmed(term):
        return term
    return term[: max(1, len(term) - 2)]


class BM25Index:
    """BM25 по основам слов фрагментов (k1 = 1,4, b = 0,75).

    Короткий фрагмент-заголовок (до 120 знаков, без точки в конце) при merge_headings
    оценивается вместе со следующим фрагментом того же материала: находкой становится
    фрагмент-содержание, а текст заголовка попадает в Hit.heading. Иначе короткий
    заголовок выигрывал бы у объяснения за счёт нормировки длины.

    Скорость: snowball на чистом Python тратит ~20 мкс на слово, а в курсе из тысячи
    фрагментов 10–25 тыс. разных словоформ. Поэтому индекс хранит словоформы, а основы
    вопроса сопоставляет лениво: все словоформы с основой лежат среди слов с известным
    префиксом (_candidate_prefix), и стеммить нужно только их. Результат тот же, что при
    стемминге всех слов (сверено с полным стеммингом в test_retrieval.py).
    """

    def __init__(
        self,
        passages: list[Passage],
        *,
        k1: float = 1.4,
        b: float = 0.75,
        merge_headings: bool = True,
    ) -> None:
        self.passages: list[Passage] = list(passages)
        self.k1 = float(k1)
        self.b = float(b)
        self.merge_headings = bool(merge_headings)

        passage_tokens = [_content_tokens(p.text) for p in self.passages]
        position: dict[tuple[str, int], int] = {}
        for index, passage in enumerate(self.passages):
            position.setdefault((passage.material_id, passage.order), index)

        absorbed = [False] * len(self.passages)
        if self.merge_headings:
            for index, passage in enumerate(self.passages):
                successor = position.get((passage.material_id, passage.order + 1))
                absorbed[index] = successor is not None and successor != index and _is_heading(passage.text)

        self._docs: list[_Doc] = []
        self._doc_of: dict[tuple[str, str], int] = {}
        for index, passage in enumerate(self.passages):
            if absorbed[index]:
                continue
            chain: list[int] = []
            previous = position.get((passage.material_id, passage.order - 1))
            while previous is not None and absorbed[previous] and previous not in chain and previous != index:
                chain.insert(0, previous)
                predecessor = self.passages[previous]
                previous = position.get((predecessor.material_id, predecessor.order - 1))
            tokens: list[str] = []
            for heading_index in chain:
                tokens.extend(passage_tokens[heading_index])
            tokens.extend(passage_tokens[index])
            self._doc_of.setdefault((passage.material_id, passage.source_id), len(self._docs))
            self._docs.append(_Doc(index, tuple(chain), Counter(tokens), len(tokens)))

        self._n = len(self._docs)
        self._avgdl = (sum(doc.length for doc in self._docs) / self._n) if self._n else 0.0

        self._token_postings: dict[str, list[tuple[int, int]]] = {}
        for doc_index, doc in enumerate(self._docs):
            for token, count in doc.tf.items():
                self._token_postings.setdefault(token, []).append((doc_index, count))

        self._vocab: list[str] = sorted(self._token_postings)
        # основа → (документ → частота, словоформы этой основы); заполняется при поиске
        self._resolved: dict[str, tuple[dict[int, int], frozenset[str]]] = {}

    # ── Основы → документы ──────────────────────────────────────────────────

    def _resolve(self, term: str) -> tuple[dict[int, int], frozenset[str]]:
        cached = self._resolved.get(term)
        if cached is not None:
            return cached
        forms: list[str] = []
        prefix = _candidate_prefix(term)
        vocab = self._vocab
        position = bisect_left(vocab, prefix)
        while position < len(vocab) and vocab[position].startswith(prefix):
            if _stem_normalized(vocab[position]) == term:
                forms.append(vocab[position])
            position += 1
        per_doc: dict[int, int] = {}
        for form in forms:
            for doc_index, count in self._token_postings[form]:
                per_doc[doc_index] = per_doc.get(doc_index, 0) + count
        result = (per_doc, frozenset(forms))
        self._resolved[term] = result
        return result

    def _idf(self, term: str) -> float:
        df = len(self._resolve(term)[0])
        return math.log(1.0 + (self._n - df + 0.5) / (df + 0.5))

    def _query_terms(self, query: str, exam_stopwords: bool) -> list[str]:
        return _unique(terms(query, exam_stopwords=exam_stopwords))

    def _share(self, query_terms: list[str], present: set[str]) -> float:
        total = sum(self._idf(term) for term in query_terms)
        if total <= 0:
            return 0.0
        matched = sum(self._idf(term) for term in query_terms if term in present)
        return matched / total

    def idf_share(self, query: str, passage: Passage) -> float:
        """Σidf(совпавших основ вопроса) / Σidf(всех основ вопроса) для фрагмента (без слов-инструкций)."""
        query_terms = self._query_terms(query, True)
        if not query_terms:
            return 0.0
        doc_index = self._doc_of.get((passage.material_id, passage.source_id))
        if doc_index is not None:
            present = {term for term in query_terms if doc_index in self._resolve(term)[0]}
        else:
            present = set(terms(passage.text))
        return self._share(query_terms, present)

    # ── Поиск ────────────────────────────────────────────────────────────────

    def search(
        self,
        query: str,
        *,
        top_k: int = 6,
        per_material_cap: int = 3,
        exam_stopwords: bool = True,
        exclude: frozenset[tuple[str, str]] = frozenset(),
    ) -> list[Hit]:
        """Лучшие фрагменты по BM25: по убыванию оценки, при равенстве — по номеру фрагмента."""
        if top_k <= 0 or not self._docs:
            return []
        query_terms = self._query_terms(query, exam_stopwords)
        if not query_terms:
            return []

        k1, b, avgdl = self.k1, self.b, self._avgdl or 1.0
        scores: dict[int, float] = {}
        for term in query_terms:
            per_doc = self._resolve(term)[0]
            if not per_doc:
                continue
            idf = self._idf(term)
            for doc_index, tf in per_doc.items():
                length = self._docs[doc_index].length
                denominator = tf + k1 * (1.0 - b + b * length / avgdl)
                scores[doc_index] = scores.get(doc_index, 0.0) + idf * tf * (k1 + 1.0) / denominator

        ranked = sorted(
            (doc_index for doc_index, score in scores.items() if score > 0),
            key=lambda doc_index: (
                -scores[doc_index],
                self.passages[self._docs[doc_index].target].order,
                self._docs[doc_index].target,
            ),
        )

        hits: list[Hit] = []
        per_material: Counter = Counter()
        for doc_index in ranked:
            doc = self._docs[doc_index]
            passage = self.passages[doc.target]
            if (passage.material_id, passage.source_id) in exclude:
                continue
            if per_material_cap and per_material_cap > 0 and per_material[passage.material_id] >= per_material_cap:
                continue
            per_material[passage.material_id] += 1
            matched = [term for term in query_terms if doc_index in self._resolve(term)[0]]
            forms: set[str] = set()
            for term in matched:
                forms.update(self._resolve(term)[1])
            heading_texts = [self.passages[i].text for i in doc.heading_indices]
            hits.append(
                Hit(
                    passage=passage,
                    score=scores[doc_index],
                    idf_share=self._share(query_terms, set(matched)),
                    matched_stems=matched,
                    matched_words=_matched_words(passage.text, forms),
                    heading="\n".join(heading_texts) if heading_texts else None,
                )
            )
            if len(hits) >= top_k:
                break
        return hits


def _content_tokens(text: str) -> list[str]:
    """Нормализованные токены без служебных слов: из них строятся документы индекса."""
    return [token for token in tokenize(text) if token not in STOPWORDS]


def _matched_words(text: str, forms: set[str]) -> list[str]:
    """Слова одного фрагмента в написании лекции, чьи словоформы входят в forms.

    forms — нормализованные словоформы (нижний регистр, «е» вместо «ё»). Порядок — по
    первому появлению. У каждой словоформы одно написание: строчное, если оно есть во
    фрагменте («Ставка … ставка» → «ставка»), иначе первое встреченное («ЦБ», «ВВП»).
    """
    if not forms:
        return []
    chosen: dict[str, str] = {}
    for surface in _SURFACE_RE.findall(unicodedata.normalize("NFC", text or "")):
        form = surface.lower().replace("ё", "е")
        if form not in forms:
            continue
        current = chosen.get(form)
        if current is None or (current != current.lower() and surface == surface.lower()):
            chosen[form] = surface
    return list(chosen.values())
