import math
import random
import sys
import threading
import time
import unicodedata
from collections import Counter
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import retrieval  # noqa: E402
from retrieval import (  # noqa: E402
    EXAM_STOPWORDS,
    BM25Index,
    Passage,
    material_passages,
    normalize_text,
    stem,
    terms,
    tokenize,
)
from utils import build_source_chunks  # noqa: E402

DEMO = (Path(__file__).resolve().parent / "fixtures" / "demo_lecture_v0.txt").read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def demo_passages():
    return material_passages("demo", "Нейронные сети", DEMO)


@pytest.fixture(scope="module")
def demo_index(demo_passages):
    return BM25Index(demo_passages)


def by_id(passages, source_id):
    return next(p for p in passages if p.source_id == source_id)


# ── Нормализация, токены, основы ────────────────────────────────────────────


def test_normalize_text_is_nfc_lowercase_without_yo():
    decomposed = unicodedata.normalize("NFD", "ЁЛКА и Йод")
    assert decomposed != unicodedata.normalize("NFC", decomposed)
    assert normalize_text(decomposed) == "елка и йод"
    assert normalize_text("") == ""


def test_tokenize_keeps_letters_digits_and_drops_single_chars():
    assert tokenize("В 1917 г. — LSTM-сети, Ёж и ИИ!") == ["1917", "lstm", "сети", "еж", "ии"]


def test_inflected_forms_share_stems():
    assert terms("денежно-кредитную политику") == terms("денежно-кредитной политики") == ["денежн", "кредитн", "политик"]
    assert stem("Распространения") == stem("распространение") == "распространен"


def test_stem_by_script_and_digits_as_is():
    assert stem("networks") == "network"
    assert stem("1917") == "1917"
    assert stem("Ёлки") == stem("елки")


def test_stems_are_cached():
    retrieval._stem_normalized.cache_clear()
    stem("переобучение")
    stem("переобучение")
    assert retrieval._stem_normalized.cache_info().hits >= 1


def test_stopwords_and_exam_stopwords():
    question = "Охарактеризуйте понятие и основные виды функций активации"
    assert terms(question, exam_stopwords=True) == ["функц", "активац"]
    plain = terms(question)
    assert "функц" in plain and stem("охарактеризуйте") in plain and stem("виды") in plain
    for word in ("опишите", "раскройте", "сущность", "роль", "значение", "особенности", "дайте", "определение",
                 "назовите", "перечислите", "приведите", "примеры", "сравните", "объясните", "вопрос"):
        assert stem(word) in EXAM_STOPWORDS, word


def test_stemmers_are_safe_across_threads():
    words = [f"{root}{ending}" for root in ("переобуч", "распростран", "регуляриз", "нейрон", "активац")
             for ending in ("ение", "ения", "ением", "ениями", "енный", "енного")]
    expected = {word: retrieval._stem_normalized.__wrapped__(word) for word in words}
    retrieval._stem_normalized.cache_clear()
    errors: list[str] = []

    def worker():
        for _ in range(30):
            for word in words:
                if retrieval._stem_normalized.__wrapped__(word) != expected[word]:
                    errors.append(word)

    threads = [threading.Thread(target=worker) for _ in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert errors == []


# ── Фрагменты без потолка ───────────────────────────────────────────────────


def test_uncapped_chunks_keep_the_first_80_ids_and_texts():
    text = "\n\n".join(f"Абзац номер {i}: рынок, ставка и инфляция в разделе {i}." for i in range(1, 201))
    capped = build_source_chunks(text)
    uncapped = build_source_chunks(text, max_chunks=None)
    assert len(capped) == 80 and len(uncapped) == 200
    assert uncapped[:80] == capped
    passages = material_passages("m1", "Макроэкономика", text)
    assert len(passages) == 200
    assert [p.source_id for p in passages[:2]] == ["S01", "S02"]
    assert passages[99].source_id == "S100" and passages[99].order == 100
    assert passages[-1].source_id == "S200" and passages[-1].text == uncapped[-1]["text"]
    assert all(p.material_id == "m1" and p.title == "Макроэкономика" for p in passages)


def test_material_passages_of_empty_text():
    assert material_passages("m1", "Пусто", "") == []
    assert material_passages("m1", "Пусто", "   \n\n ") == []


# ── BM25 на демо-лекции ─────────────────────────────────────────────────────


def test_backpropagation_fragment_ranks_first(demo_index):
    hits = demo_index.search("Метод обратного распространения ошибки")
    assert hits[0].passage.source_id == "S14"
    assert hits[0].matched_stems == ["обратн", "распространен", "ошибк"]
    # «Обратное» начинает фразу во фрагменте и строчным там не встречается — написание как в лекции.
    assert hits[0].matched_words == ["Обратное", "распространение", "ошибки", "ошибку"]
    assert hits[0].idf_share > 0.7
    assert [h.score for h in hits] == sorted((h.score for h in hits), reverse=True)


def test_absent_topic_has_low_idf_share(demo_index, demo_passages):
    query = "Байесовские сети доверия"
    best = max(demo_index.idf_share(query, p) for p in demo_passages)
    assert best < 0.1
    hits = demo_index.search(query)
    assert hits, "слово «сети» есть в лекции, кандидаты находятся"
    assert all(h.idf_share < 0.1 and h.matched_stems == ["сет"] for h in hits)


def test_heading_is_merged_with_the_next_fragment(demo_passages, demo_index):
    heading = by_id(demo_passages, "S17")
    assert heading.text == "Регуляризация и борьба с переобучением"
    query = "Регуляризация и борьба с переобучением"

    hits = demo_index.search(query, top_k=30, per_material_cap=0)
    assert hits[0].passage.source_id == "S18"
    assert hits[0].heading == heading.text
    assert "S17" not in [h.passage.source_id for h in hits]
    assert hits[0].idf_share == pytest.approx(1.0)

    # Без склейки короткий заголовок выигрывает за счёт нормировки длины — это и чиним.
    unmerged = BM25Index(demo_passages, merge_headings=False).search(query)
    assert unmerged[0].passage.source_id == "S17"


def test_heading_rules():
    passages = [
        Passage("m", "T", "S01", "Раздел 1. Деньги", 1),
        Passage("m", "T", "S02", "Тема 1", 2),
        Passage("m", "T", "S03", "Деньги — это всеобщий эквивалент стоимости товаров.", 3),
        Passage("m", "T", "S04", "Короткое предложение с точкой.", 4),
        Passage("m", "T", "S05", "Инфляция — рост общего уровня цен.", 5),
        Passage("m", "T", "S06", "Заключение без продолжения", 6),
        Passage("other", "T2", "S07", "Чужой заголовок про деньги", 7),
        Passage("m", "T", "S09", "Ещё один заголовок про деньги", 9),
    ]
    index = BM25Index(passages)
    hits = index.search("деньги", top_k=10, per_material_cap=0)
    ids = [h.passage.source_id for h in hits]
    by_source = {h.passage.source_id: h for h in hits}
    assert "S01" not in ids and "S02" not in ids  # цепочка заголовков склеена с S03
    assert by_source["S03"].heading == "Раздел 1. Деньги\nТема 1"
    assert by_source["S07"].heading is None  # у фрагмента другого материала нет следующего
    assert by_source["S09"].heading is None  # S08 нет: склеивать не с чем
    assert index.search("заключение")[0].passage.source_id == "S06"  # последний фрагмент материала остаётся сам собой
    assert index.search("короткое предложение")[0].heading is None  # с точкой — не заголовок


def test_per_material_cap_and_top_k(demo_passages):
    copy = [Passage("demo-2", p.title, p.source_id, p.text, p.order) for p in demo_passages]
    index = BM25Index(demo_passages + copy)
    hits = index.search("нейронные сети обучение", top_k=6, per_material_cap=2)
    assert len(hits) == 4
    assert Counter(h.passage.material_id for h in hits) == {"demo": 2, "demo-2": 2}
    assert len(index.search("нейронные сети обучение", top_k=3, per_material_cap=0)) == 3
    assert index.search("нейронные сети", top_k=0) == []


def test_ties_are_deterministic_by_order_then_position():
    text = "Ставка рефинансирования влияет на кредит."
    passages = [
        Passage("b", "B", "S05", text, 5),
        Passage("a", "A", "S02", text, 2),
        Passage("c", "C", "S02", text, 2),
        Passage("a", "A", "S01", "Совсем другой текст про бюджет страны.", 1),
    ]
    index = BM25Index(passages)
    first = [(h.passage.material_id, h.passage.source_id) for h in index.search("ставка рефинансирования", per_material_cap=0)]
    assert first == [("a", "S02"), ("c", "S02"), ("b", "S05")]
    for _ in range(5):
        again = [(h.passage.material_id, h.passage.source_id) for h in index.search("ставка рефинансирования", per_material_cap=0)]
        assert again == first


def test_exclude_skips_listed_fragments(demo_index):
    hits = demo_index.search("Метод обратного распространения ошибки", exclude=frozenset({("demo", "S14")}))
    assert hits and "S14" not in [h.passage.source_id for h in hits]


def test_matched_words_keep_the_lecture_spelling(demo_index):
    hits = demo_index.search("Метод обратного распространения ошибки", top_k=6)
    s07 = next(h for h in hits if h.passage.source_id == "S07")
    assert s07.matched_words == ["распространённые"]
    assert s07.heading == "Функции активации"


CENTRAL_BANK = "\n\n".join(
    [
        "Денежно-кредитная политика ЦБ",
        "ЦБ определяет ключевую ставку и меняет её в зависимости от инфляции. Ставка влияет на кредиты, "
        "и высокая ставка их удорожает.",
        "Инфляция и её виды",
        "Инфляция — устойчивый рост общего уровня цен. ВВП при этом растёт медленнее.",
    ]
)


def test_matched_words_name_only_words_of_the_cited_fragment():
    # «Ближе всего: фрагмент 2 — там только слово …» не должно называть слова заголовка S01.
    passages = material_passages("m1", "Денежный рынок", CENTRAL_BANK)
    assert [p.source_id for p in passages] == ["S01", "S02", "S03", "S04"]
    index = BM25Index(passages)
    query = "Денежно-кредитная политика ЦБ: цели, инструменты"
    hit = index.search(query)[0]
    assert hit.passage.source_id == "S02"
    assert hit.heading == "Денежно-кредитная политика ЦБ"
    # Оценка и доля idf — по фрагменту вместе с заголовком, как и раньше…
    assert set(hit.matched_stems) == {"денежн", "кредитн", "политик", "цб"}
    assert hit.idf_share == pytest.approx(index.idf_share(query, hit.passage))
    assert hit.idf_share > 0.4  # «цели» и «инструменты» в лекции нет
    # …а слова — только из самого S02, «ЦБ» заглавными, как в лекции.
    assert hit.matched_words == ["ЦБ"]


def test_heading_only_match_has_no_matched_words(demo_passages, demo_index):
    # В S18 слова «регуляризация» нет: оно только в склеенном с ним заголовке S17.
    assert "регуляриз" not in by_id(demo_passages, "S18").text.lower()
    hits = demo_index.search("Регуляризация", top_k=10, per_material_cap=0)
    s18 = next(h for h in hits if h.passage.source_id == "S18")
    assert s18.heading == "Регуляризация и борьба с переобучением"
    assert s18.matched_stems == [stem("регуляризация")]
    assert s18.matched_words == []
    s20 = next(h for h in hits if h.passage.source_id == "S20")
    assert s20.matched_words == ["регуляризация"]
    for hit in hits:
        for word in hit.matched_words:
            assert word in hit.passage.text, (hit.passage.source_id, word)


def test_matched_words_prefer_the_lowercase_spelling_and_keep_acronyms():
    passages = material_passages("m1", "Денежный рынок", CENTRAL_BANK)
    index = BM25Index(passages)
    s02 = next(h for h in index.search("ставка ЦБ инфляция", per_material_cap=0) if h.passage.source_id == "S02")
    # «Ставка» в начале фразы, ниже есть строчная «ставка» — показываем строчную; «ЦБ» не трогаем.
    assert s02.matched_words == ["ЦБ", "ставку", "инфляции", "ставка"]
    s04 = next(h for h in index.search("инфляция ВВП", per_material_cap=0) if h.passage.source_id == "S04")
    # Строчной «инфляция» в S04 нет — остаётся «Инфляция», как в лекции; «ВВП» — аббревиатура.
    assert s04.matched_words == ["Инфляция", "ВВП"]
    assert s04.heading == "Инфляция и её виды"


def test_empty_queries_and_indexes():
    assert BM25Index([]).search("деньги") == []
    index = BM25Index(material_passages("m", "T", DEMO))
    assert index.search("") == []
    assert index.search("и в на") == []
    assert index.search("Опишите понятие") == []  # одни слова-инструкции
    assert index.idf_share("", Passage("m", "T", "S01", "текст", 1)) == 0.0


def test_idf_share_for_a_passage_outside_the_index(demo_index):
    outside = Passage("x", "X", "S01", "Обратное распространение ошибки — основа обучения.", 1)
    assert demo_index.idf_share("Метод обратного распространения ошибки", outside) > 0.7


# ── Ленивое сопоставление основ = полный стемминг ───────────────────────────


def _eager_reference(index: BM25Index, query: str) -> list[tuple[float, str, str]]:
    """BM25, где основы считаются для каждого слова каждого фрагмента."""
    docs = []
    for doc in index._docs:
        tf: Counter = Counter()
        for token, count in doc.tf.items():
            tf[stem(token)] += count
        docs.append((index.passages[doc.target], tf, doc.length))
    n = len(docs)
    avgdl = sum(length for _, _, length in docs) / n
    df: Counter = Counter()
    for _, tf, _ in docs:
        df.update(tf.keys())
    query_terms = list(dict.fromkeys(terms(query, exam_stopwords=True)))
    result = []
    for passage, tf, length in docs:
        score = 0.0
        for term in query_terms:
            if term in tf:
                idf = math.log(1 + (n - df[term] + 0.5) / (df[term] + 0.5))
                score += idf * tf[term] * 2.4 / (tf[term] + 1.4 * (0.25 + 0.75 * length / avgdl))
        if score > 0:
            result.append((round(score, 9), passage.material_id, passage.source_id))
    return sorted(result)


def test_lazy_stem_lookup_matches_full_stemming(demo_passages):
    english = material_passages(
        "en",
        "Deep learning",
        "Backpropagation computes gradients.\n\nThe network was training on happy, happier and happiest examples.\n\n"
        "Dying gradients and lying labels: probability and sensitivity of models.\n\n"
        "Regularization prevents overfitting in neural networks; dropout is one regularizer.",
    )
    index = BM25Index(demo_passages + english)
    queries = [
        "Метод обратного распространения ошибки",
        "Переобучение нейронных сетей и методы регуляризации",
        "Свёрточные нейронные сети: принцип работы свёрточного слоя",
        "Байесовские сети доверия",
        "happiness of the networks and regularize training",
        "die lie probabilities sensitive",
        "Трансформеры и механизм самовнимания",
    ]
    for query in queries:
        got = sorted(
            (round(h.score, 9), h.passage.material_id, h.passage.source_id)
            for h in index.search(query, top_k=1000, per_material_cap=0)
        )
        assert got == _eager_reference(index, query), query


# ── Скорость ─────────────────────────────────────────────────────────────────


def _synthetic_course(fragments: int = 1000, seed: int = 7) -> list[Passage]:
    """Курс с богатым словарём: слова лекции плюс ~15 тыс. выдуманных словоформ."""
    rng = random.Random(seed)
    syllables = ["ка", "ре", "ми", "до", "ла", "ст", "но", "пр", "ве", "ти", "ры", "зо", "бу", "ще", "ль", "кон", "тра", "ция"]
    endings = ["", "а", "ы", "ой", "ую", "ами", "ость", "ение", "ения", "ировать", "ный", "ная", "ного"]
    lecture_words = DEMO.split()
    invented = ["".join(rng.choice(syllables) for _ in range(rng.randint(2, 4))) + rng.choice(endings) for _ in range(15000)]
    passages = []
    for index in range(fragments):
        words = []
        while sum(len(w) + 1 for w in words) < 850:
            words.append(rng.choice(invented) if rng.random() < 0.5 else rng.choice(lecture_words))
        passages.append(Passage(f"m{index // 100}", f"Лекция {index // 100}", f"S{index % 100 + 1:02d}", " ".join(words), index % 100 + 1))
    return passages


def test_index_and_search_1000_fragments_is_fast():
    passages = _synthetic_course()
    assert len(passages) == 1000
    best = float("inf")
    for _ in range(3):
        retrieval._stem_normalized.cache_clear()  # холодный кеш основ, как после перезапуска Space
        started = time.perf_counter()
        index = BM25Index(passages)
        hits = index.search("Метод обратного распространения ошибки и регуляризация")
        best = min(best, time.perf_counter() - started)
        assert hits
    assert best < 0.3, f"индекс и поиск по 1000 фрагментам заняли {best:.3f} с"
