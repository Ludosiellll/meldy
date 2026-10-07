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
    is_plan_text,
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


# ── План лекции, оглавление, вопросы для самоконтроля ───────────────────────

PLANS = [
    "План лекции\n1. Понятие модели данных\n2. Ключи отношения\n3. Связи между сущностями",
    # Склеенный по словам текст живого прогона: план делит фрагмент с заголовком лекции и началом первого раздела.
    "Лекция 1. Реляционная модель данных. Ключи и связи Учебная дисциплина «Базы данных». Лекция 1 из 3. План лекции "
    "1. Понятие модели данных. Появление реляционной модели. 2. Основные понятия: домен, атрибут, кортеж, отношение. "
    "3. Свойства отношений. Отношение и таблица SQL. 4. Ключи отношения. 1. Понятие модели данных. Появление "
    "реляционной модели База данных хранит сведения о некоторой предметной области.",
    "Содержание\n- Введение\n- Реляционная модель\n- Нормализация",
    "Оглавление: 1) Введение 2) Ключи 3) Связи 4) Нормализация",
    "## План лекции\n1. Ключи\n2. Связи\n3. Целостность",
    "План\n1. Ключи\n2. Связи\n3. Целостность",
    "Выводы. Транзакция — неделимая единица работы. Вопросы для самоконтроля 1. Чем отношение отличается от таблицы? "
    "2. Что такое суперключ? 3. Как реализовать связь «многие ко многим»?",
    "Контрольные вопросы:\n1. Что такое домен?\n2. Что такое кортеж?\n3. Что такое схема отношения?",
    "В этой лекции мы рассмотрим: понятие модели данных; ключи отношения; связи между сущностями.",
    "Сегодня мы рассмотрим причины, виды и последствия инфляции.",
]
NOT_PLANS = [
    # Перечень определений — это содержание, хоть он и нумерованный.
    "Различают: 1. Целостность сущностей — у каждого отношения есть первичный ключ, его значения уникальны. "
    "2. Ссылочную целостность — значение внешнего ключа совпадает с ключом. 3. Доменные ограничения — тип данных, "
    "NOT NULL, DEFAULT, CHECK.",
    "Содержание: 1. Атомарность — транзакция выполняется целиком или не выполняется вовсе. 2. Согласованность — база "
    "переходит из одного согласованного состояния в другое. 3. Изолированность — транзакции не видят данных друг друга.",
    "Реляционная модель состоит из трёх частей: структурной — данные представлены набором отношений; целостной — данные "
    "подчиняются ограничениям целостности; манипуляционной — операции реляционной алгебры.",
    # Без метки нумерованный список — содержание: свойства, шаги алгоритма.
    "Свойства транзакций:\n1. Атомарность\n2. Согласованность\n3. Изолированность\n4. Долговечность",
    "Алгоритм нормализации: 1. Найти все функциональные зависимости. 2. Выделить ключ. 3. Разбить отношение.",
    # «План» без «лекции» в строке с пунктами — план выполнения запроса, а не лекции.
    "План: 1. Сканирование таблицы. 2. Фильтрация строк. 3. Сортировка результата.",
    "План выполнения запроса строит оптимизатор СУБД: 1. чтение 2. фильтр 3. сортировка.",
    "Содержание понятия «отношение» включает: 1. заголовок 2. тело 3. степень",
    "План лекции 1. Ключи. 2. Связи.",  # два пункта — мало
    # Вступление с перечнем, но дальше идёт объяснение: вступление не только перечисляет темы.
    "В этой лекции мы рассмотрим реляционную модель, ключи и связи. Реляционная модель — это способ представить "
    "данные набором отношений, у каждого отношения есть заголовок и тело, а каждый кортеж описывает один объект "
    "предметной области; ключи и связи разберём ниже на примере базы данных деканата.",
    "Кривая Филлипса",
    "",
]


@pytest.mark.parametrize("text", PLANS)
def test_plans_contents_and_question_lists_are_recognised(text):
    assert is_plan_text(text)


@pytest.mark.parametrize("text", NOT_PLANS)
def test_definition_lists_steps_and_other_lists_are_not_plans(text):
    assert not is_plan_text(text)


INTEGRITY_LECTURE = [
    Passage("rel", "Р", "S01", "План лекции 1. Ключи отношения. 2. Внешний ключ. 3. Ограничения целостности в реляционной модели.", 1),
    Passage("rel", "Р", "S02", "Модель данных — это структуры, операции и ограничения целостности. Реляционная модель данных появилась в 1970 году.", 2),
    Passage("rel", "Р", "S03", "Реляционная модель состоит из трёх частей: структурной, целостной и манипуляционной; целостная часть — ограничения целостности данных.", 3),
    Passage("rel", "Р", "S04", "Различают: целостность сущностей, ссылочную целостность, доменные ограничения и ограничения кортежа; СУБД отклоняет операцию, которая их нарушает.", 4),
    Passage("rel", "Р", "S05", "Вопросы для самоконтроля 1. Что такое внешний ключ? 2. Какие ограничения целостности различают в реляционной модели? 3. Чем ключ отличается от суперключа?", 5),
    Passage("nf", "Н", "S01", "Транзакция переводит базу в согласованное состояние: после неё выполняются все ограничения целостности.", 1),
    Passage("nf", "Н", "S02", "Первая нормальная форма требует атомарных значений в реляционной модели.", 2),
]
Q_INTEGRITY = "Ограничения целостности в реляционной модели данных."


def test_a_plan_does_not_take_a_lecture_place_and_a_lecture_gives_one_plan_at_most():
    index = BM25Index(INTEGRITY_LECTURE)
    pairs = lambda hits: [(h.passage.material_id, h.passage.source_id) for h in hits]  # noqa: E731
    # Без правила план занимает одно из трёх мест лекции, и раздел с видами ограничений (S04) не проходит.
    old = index.search(Q_INTEGRITY, top_k=6, per_material_cap=3)
    assert pairs(old) == [("rel", "S02"), ("rel", "S03"), ("rel", "S01"), ("nf", "S02"), ("nf", "S01")]
    assert not any(hit.plan for hit in old)
    # С правилом план идёт сверх трёх мест, вопросы для самоконтроля (второй план той же лекции) — мимо, S04 — среди кандидатов.
    new = index.search(Q_INTEGRITY, top_k=6, per_material_cap=3, plans_per_material=1)
    assert pairs(new) == [("rel", "S02"), ("rel", "S03"), ("rel", "S01"), ("nf", "S02"), ("rel", "S04"), ("nf", "S01")]
    assert [hit.passage.source_id for hit in new if hit.plan] == ["S01"]
    assert sum(1 for hit in new if hit.passage.material_id == "rel" and not hit.plan) == 3
    # top_k план занимает: место из шести он не добавляет.
    assert len(index.search(Q_INTEGRITY, top_k=3, per_material_cap=3, plans_per_material=1)) == 3
    # Без плана поиск с правилом и без него одинаков.
    plain = BM25Index([p for p in INTEGRITY_LECTURE if p.source_id not in ("S01", "S05") or p.material_id != "rel"])
    assert pairs(plain.search(Q_INTEGRITY, plans_per_material=1)) == pairs(plain.search(Q_INTEGRITY))


def test_top_per_material_is_the_best_non_plan_documents_of_each_lecture():
    index = BM25Index(INTEGRITY_LECTURE)
    query = terms(Q_INTEGRITY, exam_stopwords=True)
    top = index.top_per_material(query + query, per_material=3)  # повторы основ не считаются
    assert sorted(top) == ["nf", "rel"]
    every = [hit for hit in index.search(Q_INTEGRITY, top_k=20, per_material_cap=0) if not is_plan_text(hit.passage.text)]
    for material_id, items in top.items():
        expected = [hit for hit in every if hit.passage.material_id == material_id][:3]
        assert [item.passage for item in items] == [hit.passage for hit in expected]
        for item, hit in zip(items, expected):
            assert item.score == pytest.approx(hit.score) and item.idf_share == pytest.approx(hit.idf_share)
            assert list(item.matched_stems) == hit.matched_stems and item.material_id == material_id
    # План (S01) и вопросы для самоконтроля (S05) не участвуют; три раздела лекции — по убыванию оценки.
    assert [item.passage.source_id for item in top["rel"]] == ["S02", "S03", "S04"]
    assert [item.passage.source_id for item in index.top_per_material(query)["rel"]] == ["S02"]
    # Совпадений нет — материала нет.
    assert index.top_per_material([stem("гиперинфляция")]) == {}
    assert index.top_per_material([]) == {} and BM25Index([]).top_per_material(query) == {}
    assert index.top_per_material(query, per_material=0) == {}
    # Лекция, где слова вопроса есть только в плане, не попадает в ответ вовсе; без skip_plans план — обычный документ.
    plan_only = BM25Index([INTEGRITY_LECTURE[0], INTEGRITY_LECTURE[4]])
    assert plan_only.top_per_material(query) == {}
    assert plan_only.top_per_material(query, skip_plans=False)["rel"][0].passage.source_id == "S01"


def test_two_plans_of_one_lecture_never_take_two_places():
    index = BM25Index(INTEGRITY_LECTURE)
    hits = index.search(Q_INTEGRITY, top_k=10, per_material_cap=0, plans_per_material=1)
    assert [hit.passage.source_id for hit in hits if hit.plan] == ["S01"]
    assert "S05" not in [hit.passage.source_id for hit in hits]
    two = index.search(Q_INTEGRITY, top_k=10, per_material_cap=0, plans_per_material=2)
    assert [hit.passage.source_id for hit in two if hit.plan] == ["S01", "S05"]


def test_a_plan_after_its_lecture_filled_its_places_does_not_add_a_fourth():
    passages = [
        Passage("rel", "Р", "S01", "Ограничения целостности: целостность сущностей и ссылочная целостность.", 1),
        Passage("rel", "Р", "S02", "Ограничения целостности проверяет СУБД при вставке и удалении строк.", 2),
        Passage("rel", "Р", "S03", "Доменные ограничения целостности: тип данных, NOT NULL, CHECK.", 3),
        Passage("rel", "Р", "S04", "План лекции 1. Ключи. 2. Связи отношений. 3. Ограничения целостности и их виды в модели данных.", 4),
        Passage("nf", "Н", "S01", "Транзакция сохраняет ограничения целостности базы.", 1),
    ]
    index = BM25Index(passages)
    ranked = [(h.passage.material_id, h.passage.source_id) for h in index.search("ограничения целостности", top_k=10, per_material_cap=0)]
    assert [pair for pair in ranked if pair[0] == "rel"][3] == ("rel", "S04")  # план ниже трёх разделов своей лекции
    hits = index.search("ограничения целостности", top_k=6, per_material_cap=3, plans_per_material=1)
    # Места лекции уже заняты разделами: план не добавляет лекции четвёртое место за счёт другой лекции.
    assert [(h.passage.material_id, h.passage.source_id) for h in hits] == [pair for pair in ranked if pair != ("rel", "S04")]
    assert not any(hit.plan for hit in hits)


def test_a_short_plan_is_not_glued_to_the_first_section_as_its_heading():
    passages = [
        Passage("m", "T", "S01", "План\n1. Ключи\n2. Связи\n3. Целостность", 1),  # короткий, без точки: похож на заголовок
        Passage("m", "T", "S02", "Ключи отношения. Первичный ключ однозначно определяет кортеж отношения.", 2),
        Passage("m", "T", "S03", "Кривая Филлипса", 3),
        Passage("m", "T", "S04", "В краткосрочном периоде рост цен снижает незанятость.", 4),
    ]
    index = BM25Index(passages)
    by_source = {h.passage.source_id: h for h in index.search("ключи связи целостность", top_k=6, per_material_cap=0)}
    assert by_source["S02"].heading is None  # слова плана не достались первому разделу
    assert "S01" in by_source  # план — отдельный документ
    # Обычный короткий заголовок склеивается, как раньше.
    assert index.search("Кривая Филлипса краткосрочном")[0].heading == "Кривая Филлипса"


def test_a_plan_heading_glued_to_its_list_makes_the_document_a_plan():
    passages = [
        Passage("m", "T", "S01", "План лекции", 1),
        Passage("m", "T", "S02", "1. Ключи отношения.\n2. Внешний ключ.\n3. Ограничения целостности.", 2),
        Passage("m", "T", "S03", "Ограничения целостности — правила для данных; СУБД проверяет их при каждой операции.", 3),
    ]
    hits = BM25Index(passages).search("ограничения целостности", per_material_cap=1, plans_per_material=1)
    plan = next(hit for hit in hits if hit.passage.source_id == "S02")
    assert plan.plan and plan.heading == "План лекции"
    assert [hit.passage.source_id for hit in hits if not hit.plan] == ["S03"]  # единственное место лекции — у раздела


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
