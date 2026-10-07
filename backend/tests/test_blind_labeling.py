"""Слепая разметка вердиктов Meldy (backend/scripts/blind_labeling.py): листы для двух разметчиков и сверка.

Все ответы синтетические. Числа в проверках посчитаны вручную: интервал Уилсона, каппа Коэна, доли совпадений,
ложные «назван» и «не назван» (разбор — у CASES).
"""
import base64
import csv
import hashlib
import importlib.util
import io
import json
import re
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]


def _module():
    name = "blind_labeling_under_test"
    if name not in sys.modules:
        spec = importlib.util.spec_from_file_location(name, BACKEND / "scripts" / "blind_labeling.py")
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module  # dataclasses ищут модуль класса в sys.modules
        spec.loader.exec_module(module)
    return sys.modules[name]


bl = _module()

EXPORT_HEADER = [
    "student", "answer", "day", "input", "question", "answer_text", "point_id", "essential", "point_title", "lecture_quote",
]
KEY_HEADER = ["answer", "point_id", "meldy_verdict", "meldy_quote", "meldy_followup_verdict", "followup_answer"]
A1, A2, A3, A4 = "0a1b2c3d4e5f", "123456789012", "abcdefabcdef", "fedcba987654"
WORDS = {"C": "назван", "P": "частично", "M": "не назван", "W": "ошибка", "U": "не могу решить", "": ""}

# Синтетический экзамен: 4 ответа по 3 пункта. Ответы A1 и A2 — голосом, A3 и A4 — текстом.
ANSWERS = [
    ("stud00000001", A1, "speech", "Что такое спрос?",
     "ну спрос это когда покупатель хочет и может купить товар\nи чем выше цена тем меньше берут",
     [("p1", True, "Спрос — желание и возможность купить", "Спрос — это желание и возможность покупателя купить товар."),
      ("p2", True, "Закон спроса: цена выше — спрос ниже", "При росте цены величина спроса снижается."),
      ("p3", False, "Кривая спроса убывает", "Кривая спроса имеет отрицательный наклон.")]),
    ("stud00000001", A2, "speech", "Что такое предложение?",
     "предложение это сколько продавцы готовы продать по цене",
     [("p1", True, "Предложение — сколько готовы продать", "Предложение — количество товара, которое продавцы готовы продать."),
      ("p2", False, "Закон предложения", "При росте цены величина предложения растёт."),
      ("p3", False, "Кривая предложения растёт", "Кривая предложения имеет положительный наклон.")]),
    ("stud00000002", A3, "text", "Что такое равновесие?",
     "=Равновесие — точка, где спрос равен предложению; цена там «равновесная».",
     [("p1", True, "Равновесие — спрос равен предложению", "Равновесие — состояние, когда спрос равен предложению."),
      ("p2", True, "Равновесная цена", "Цена в точке равновесия называется равновесной."),
      ("p3", False, "Дефицит ниже равновесной цены", "Ниже равновесной цены возникает дефицит.")]),
    ("stud00000002", A4, "text", "Что такое эластичность?",
     "Эластичность показывает, насколько меняется спрос при изменении цены.",
     [("p1", True, "Эластичность — чувствительность спроса к цене", "Эластичность — мера чувствительности спроса к цене."),
      ("p2", False, "Коэффициент эластичности", "Коэффициент — отношение процентных изменений."),
      ("p3", False, "Неэластичный спрос", "Если коэффициент меньше единицы, спрос неэластичный.")]),
]

# Код: (A, B, Meldy). Разбор (пункты 1–12 по порядку):
# оба отметили один из 4 вариантов — 10 (кроме 9: A «не могу решить» и 12: у B пусто);
# совпали в 4 вариантах 8 из 10 (кроме 5 и 6); A: назван 5, частично 2, не назван 2, ошибка 1;
# B: назван 4, частично 2, не назван 3, ошибка 1 → p_e = (20 + 4 + 6 + 1) / 100 = 0,31, κ = 0,49 / 0,69 = 0,7101;
# «назван / не назван»: совпали 9 из 10 (кроме 6), p_e = 0,5·0,4 + 0,5·0,6 = 0,5, κ = 0,4 / 0,5 = 0,8.
# Согласие людей (4 варианта) — 1, 2, 3, 4, 7, 8, 10, 11; у 11 Meldy не оценил → 7, верно 1, 3, 7, 10 → 4 из 7.
# Согласие «назван / не назван» — ещё 5 → без 11 их 8, верно 1, 3, 5, 7, 10 → 5 из 8.
# Люди не засчитали 3, 4, 5, 8, 10 → Meldy назвал 4 и 8 → ложное «назван» 2 из 5; Meldy назвал 1, 4, 7, 8 → 2 из 4.
# Люди засчитали 1, 2, 7 → Meldy не засчитал 2 → ложное «не назван» 1 из 3; Meldy не засчитал 2, 3, 5, 10 → 1 из 4.
CASES = {
    f"{A1}/p1": ("C", "C", "covered"),
    f"{A1}/p2": ("C", "C", "partial"),
    f"{A1}/p3": ("M", "M", "missing"),
    f"{A2}/p1": ("W", "W", "covered"),
    f"{A2}/p2": ("P", "M", "missing"),
    f"{A2}/p3": ("C", "P", "covered"),
    f"{A3}/p1": ("C", "C", "covered"),
    f"{A3}/p2": ("M", "M", "covered"),
    f"{A3}/p3": ("U", "C", "covered"),
    f"{A4}/p1": ("P", "P", "partial"),
    f"{A4}/p2": ("C", "C", "unrated"),
    f"{A4}/p3": ("M", "", "missing"),
}
FOLLOWUPS = {f"{A1}/p2": ("covered", "цена выше — покупают меньше"), f"{A2}/p2": ("missing", "не помню")}


def csv_text(rows, delimiter=","):
    out = io.StringIO()
    csv.writer(out, delimiter=delimiter, lineterminator="\r\n").writerows(rows)
    return out.getvalue()


def export_csv(answers=ANSWERS):
    rows = [EXPORT_HEADER]
    for student, answer, mode, question, text, points in answers:
        for pid, essential, title, quote in points:
            essential_word = "true" if essential else "false"
            rows.append([student, answer, "2026-10-07", mode, question, text, pid, essential_word, title, quote])
    return csv_text(rows)


def key_csv(cases=CASES, extra=()):
    rows = [KEY_HEADER]
    for code, (_, _, verdict) in cases.items():
        answer, point = code.split("/")
        followup, followup_answer = FOLLOWUPS.get(code, ("", ""))
        quote = "" if verdict in ("missing", "unrated") else "отрывок ответа"
        rows.append([answer, point, verdict, quote, followup, followup_answer])
    rows += list(extra)
    return csv_text(rows)


def meta(code):
    answer, point = code.split("/")
    for _, answer_id, mode, _, _, points in ANSWERS:
        for pid, essential, title, _ in points:
            if answer_id == answer and pid == point:
                return ("да" if essential else "нет"), bl.INPUT_WORD[mode], title
    raise KeyError(code)


def marks_csv(letter, kit="00c0ffee", cases=CASES, column=0, extra=()):
    """Файл, как его скачивает HTML-лист (колонки MARKS_COLUMNS, «;», BOM)."""
    rows = [list(bl.MARKS_COLUMNS)]
    for n, code in enumerate(cases, start=1):
        main, mode, title = meta(code)
        rows.append([letter, kit, n, (n + 2) // 3, code, code.split("/")[1], main, mode, title, WORDS[cases[code][column]], ""])
    rows += list(extra)
    return "\ufeff" + csv_text(rows, delimiter=";")


def load_marks(text, letter, name=None):
    digest = hashlib.sha256(text.encode()).hexdigest()
    return bl.load_marks(bl.parse_table(text, name or f"otmetki_{letter}.csv", digest=digest), letter)


def load_key(text):
    return bl.load_key(bl.parse_table(text, "key.csv", digest=hashlib.sha256(text.encode()).hexdigest()))


# ── Статистика ──────────────────────────────────────────────────────────────────


def test_wilson_interval_matches_hand_computed_bounds():
    # z = 1,95996; 0 из 10: верх = (z²/n) / (1 + z²/n) = 0,38415 / 1,38415 = 0,2775.
    assert bl.wilson(0, 10) == pytest.approx((0.0, 0.2775), abs=1e-4)
    assert bl.wilson(10, 10) == pytest.approx((0.7225, 1.0), abs=1e-4)
    # 5 из 10: центр 0,5, полуширина z·√(0,025 + z²/400) / 1,38415 = 0,26341.
    assert bl.wilson(5, 10) == pytest.approx((0.2366, 0.7634), abs=1e-4)
    # 8 из 10: центр (0,8 + 0,19207) / 1,38415 = 0,71674, полуширина z·√(0,016 + 0,0096) / 1,38415 = 0,22658.
    assert bl.wilson(8, 10) == pytest.approx((0.4902, 0.9433), abs=1e-4)
    assert bl.wilson(0, 0) is None
    assert bl.Share(4, 7).value == pytest.approx(4 / 7) and bl.Share(0, 0).value is None


def test_cohen_kappa_textbook_binary_example():
    # 50 работ: да/да 20, да/нет 5, нет/да 10, нет/нет 15 → p_o = 0,7, p_e = 0,5·0,6 + 0,5·0,4 = 0,5, κ = 0,4.
    pairs = [("y", "y")] * 20 + [("y", "n")] * 5 + [("n", "y")] * 10 + [("n", "n")] * 15
    kappa = bl.cohen_kappa(pairs, ("y", "n"))
    assert (kappa.n, kappa.agree) == (50, 35)
    assert kappa.p_o == pytest.approx(0.7) and kappa.p_e == pytest.approx(0.5) and kappa.kappa == pytest.approx(0.4)
    # Ошибка по Коэну: √(0,7·0,3 / (50·0,5²)) = 0,12961 → 0,4 ± 1,96·0,12961.
    assert (kappa.low, kappa.high) == pytest.approx((0.1460, 0.6540), abs=1e-4)


def test_cohen_kappa_four_classes_by_hand_and_degenerate_cases():
    a = ["covered", "covered", "covered", "partial", "missing", "missing", "wrong", "covered", "missing", "partial"]
    b = ["covered", "covered", "partial", "partial", "missing", "wrong", "wrong", "covered", "missing", "missing"]
    # Совпали 7 из 10. A: 4/2/3/1, B: 3/2/3/2 → p_e = (12 + 4 + 9 + 2) / 100 = 0,27, κ = 0,43 / 0,73.
    four = bl.cohen_kappa(list(zip(a, b)), bl.CLASSES)
    assert four.agree == 7 and four.p_e == pytest.approx(0.27) and four.kappa == pytest.approx(0.43 / 0.73)
    # «Назван / не назван»: совпали 9 из 10, p_e = 0,4·0,3 + 0,6·0,7 = 0,54, κ = 0,36 / 0,46.
    two = bl.cohen_kappa([(bl.binary(x), bl.binary(y)) for x, y in zip(a, b)], (bl.NAMED, bl.NOT_NAMED))
    assert two.agree == 9 and two.p_e == pytest.approx(0.54) and two.kappa == pytest.approx(0.36 / 0.46)

    assert bl.cohen_kappa([], bl.CLASSES).kappa is None
    same = bl.cohen_kappa([("covered", "covered")] * 5, bl.CLASSES)
    assert same.p_e == 1 and same.kappa is None  # у обоих один вариант — каппа не определена
    perfect = bl.cohen_kappa([("covered", "covered")] * 3 + [("missing", "missing")] * 2, bl.CLASSES)
    assert perfect.kappa == pytest.approx(1.0) and perfect.low is None and perfect.high is None  # не «от 1 до 1»


# ── Чтение CSV ──────────────────────────────────────────────────────────────────


def test_parse_table_reads_bom_semicolons_quotes_and_multiline_cells():
    text = '\ufeffКод;Оценка;Комментарий\r\nx1/p1;назван;"две\r\nстроки; и ""кавычки"""\r\n\r\nx1/p2;;\r\n'
    table = bl.parse_table(text, "a.csv")
    assert table.columns == ["код", "оценка", "комментарий"]
    assert table.rows == [
        (2, {"код": "x1/p1", "оценка": "назван", "комментарий": 'две\r\nстроки; и "кавычки"'}),
        (4, {"код": "x1/p2", "оценка": "", "комментарий": ""}),
    ]
    assert bl.parse_table("a,b\n1,2\n", "c.csv").rows == [(2, {"a": "1", "b": "2"})]
    assert bl.parse_table("a\tb\n1\t2\n", "t.csv").rows == [(2, {"a": "1", "b": "2"})]
    short = bl.parse_table("a;b;c\n1\n2;3;4;5\n", "s.csv")
    assert short.rows[0] == (2, {"a": "1", "b": "", "c": ""})
    assert any("строка 3" in note and "лишние" in note for note in short.notes)
    for bad in ("", "\n\n", "одна колонка\nзначение\n"):
        with pytest.raises(bl.InputError):
            bl.parse_table(bad, "bad.csv")


def test_read_table_falls_back_to_windows_1251_with_a_note(tmp_path):
    path = tmp_path / "excel.csv"
    path.write_bytes("код;оценка\r\nx1/p1;не назван\r\n".encode("cp1251"))
    table = bl.read_table(path)
    assert table.rows[0][1]["оценка"] == "не назван"
    assert any("Windows-1251" in note for note in table.notes)
    assert table.digest == hashlib.sha256(path.read_bytes()).hexdigest()
    with pytest.raises(bl.InputError):
        bl.read_table(tmp_path / "нет такого.csv")


def test_formula_cells_are_escaped_and_restored():
    assert bl._cell("=СУММ(1)") == "'=СУММ(1)" and bl._cell("-минус") == "'-минус" and bl._cell("текст") == "текст"
    assert bl._uncell("'=СУММ(1)") == "=СУММ(1)" and bl._uncell("'обычный") == "'обычный"


# ── Выгрузка и листы ────────────────────────────────────────────────────────────


def test_load_export_groups_points_by_answer_and_reports_odd_rows():
    rows = [EXPORT_HEADER]
    rows.append(["s1", "AAA111aaa111", "2026-10-07", "speech", "Вопрос?", "текст", "p2", "false", "Второй", "Цитата 2"])
    rows.append(["s1", "aaa111aaa111", "2026-10-07", "speech", "Вопрос?", "текст", "p1", "true", "Первый", "Цитата 1"])
    rows.append(["s1", "aaa111aaa111", "2026-10-07", "speech", "Вопрос?", "текст", "p10", "да", "Десятый", ""])
    rows.append(["s1", "aaa111aaa111", "2026-10-07", "speech", "Вопрос?", "текст", "p1", "true", "Первый", "Цитата 1"])
    rows.append(["s1", "aaa111aaa111", "2026-10-07", "speech", "Вопрос?", "текст", "p2", "false", "Другой", "Цитата 2"])
    rows.append(["s1", "aaa111aaa111", "2026-10-07", "text", "Вопрос?", "другой текст", "p3", "может быть", "Третий", ""])
    rows.append(["s2", "", "2026-10-07", "text", "Вопрос?", "текст", "p1", "true", "Без ответа", ""])
    rows.append(["s2", "bad id/x", "2026-10-07", "text", "Вопрос?", "текст", "p1", "true", "Плохой код", ""])
    rows.append(["s2", "bbb222bbb222", "2026-10-07", "голосом", "Вопрос 2?", "", "p1", "true", "", ""])
    export = bl.load_export(bl.parse_table(csv_text(rows), "export.csv"))
    first, second = export.answers
    assert first.answer == "aaa111aaa111" and first.input == "speech" and first.text == "текст"
    assert [point.point_id for point in first.points] == ["p1", "p2", "p3", "p10"]  # p10 после p3
    assert first.points[1].title == "Второй" and first.points[2].essential is None
    assert second.input == "speech" and second.points[0].essential is True
    text = "\n".join(export.warnings)
    assert "Строки без ответа или пункта пропущены: 8." in text
    assert "Строки с непонятным кодом ответа или пункта пропущены: 9." in text
    assert "главный ли пункт (строки 7)" in text
    assert "У ответов aaa111aaa111 строки расходятся" in text
    assert "Повторы строк (одинаковые) — взята одна: aaa111aaa111/p1." in text
    assert "Повторы строк с другим пунктом — взята первая: aaa111aaa111/p2." in text
    assert "Пустой текст ответа: bbb222bbb222." in text and "Пункты без названия: bbb222bbb222/p1." in text
    assert "меньше 3 пунктов" in text and "bbb222bbb222" in text and "SQL Editor" in text


def test_load_export_refuses_the_key_and_files_without_needed_columns():
    with pytest.raises(bl.InputError, match="ключ"):
        bl.load_export(bl.parse_table(key_csv(), "key.csv"))
    leaked = csv_text([EXPORT_HEADER + ["meldy_verdict"], ["s", "a1", "d", "text", "q", "t", "p1", "true", "T", "Q", "covered"]])
    with pytest.raises(bl.InputError, match="решения Meldy"):
        bl.load_export(bl.parse_table(leaked, "export.csv"))
    with pytest.raises(bl.InputError, match="answer_text"):
        bl.load_export(bl.parse_table("answer,point_id,point_title\na1,p1,T\n", "export.csv"))


def test_sheets_have_the_same_answers_in_a_different_seeded_order():
    answers = bl.load_export(bl.parse_table(export_csv(), "export.csv")).answers
    first = bl.build_sheets(answers, 7)
    again = bl.build_sheets(list(reversed(answers)), 7)  # порядок строк выгрузки не важен
    assert [[x.answer for x in sheet.answers] for sheet in first] == [[x.answer for x in sheet.answers] for sheet in again]
    a, b = first
    assert sorted(x.answer for x in a.answers) == sorted(x.answer for x in b.answers) == sorted([A1, A2, A3, A4])
    assert [x.answer for x in a.answers] != [x.answer for x in b.answers]
    assert a.kit == b.kit == bl.kit_id(7, answers) and a.shuffle.startswith("7:A:")
    assert len({tuple(x.answer for x in bl.build_sheets(answers, seed)[0].answers) for seed in range(30)}) > 1
    two = answers[:2]
    for seed in range(20):  # с двумя ответами порядок B совпал бы с A в половине случаев — берётся другая попытка
        sheet_a, sheet_b = bl.build_sheets(two, seed)
        assert [x.answer for x in sheet_a.answers] != [x.answer for x in sheet_b.answers]
    chosen = bl.choose_answers(answers, 2, 11)
    assert len(chosen) == 2 and chosen == bl.choose_answers(answers, 2, 11)
    assert bl.choose_answers(answers, 10, 11) == sorted(answers, key=lambda x: x.answer)


def test_html_sheet_is_blind_self_contained_and_escaped():
    answers = bl.load_export(bl.parse_table(export_csv(), "export.csv")).answers
    answers[0].text = "ответ </script><script>alert(1)</script> & <b>жирный</b>"
    sheet = bl.build_sheets(answers, 3)[0]
    page = bl.render_html(sheet)

    # Ничего внешнего: ни ссылок, ни файлов, ни шрифтов; CSP пускает только свой стиль и свой скрипт.
    for forbidden in ("http://", "https://", "<link", "src=", "@import", "url("):
        assert forbidden not in page
    style = re.search(r"<style>(.*?)</style>", page, re.S).group(1)
    script = re.search(r"<script>(.*?)</script>", page, re.S).group(1)
    csp = re.search(r'http-equiv="Content-Security-Policy" content="([^"]+)"', page).group(1)
    for source in (style, script):
        digest = base64.b64encode(hashlib.sha256(source.encode("utf-8")).digest()).decode()
        assert f"'sha256-{digest}'" in csp
    assert "default-src 'none'" in csp and "unsafe-inline" not in csp

    # Слепо: нет решений Meldy, кода студента и дня ответа.
    for leak in ("covered", "partial", "missing", "wrong", "unrated", "meldy_", "stud0000000", "2026-10-07"):
        assert leak not in page
    assert "Решений Meldy здесь нет" in page

    # Текст ответа экранирован и показан один раз, под ним — его пункты с пятью вариантами и комментарием.
    assert "&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt; &amp; &lt;b&gt;жирный&lt;/b&gt;" in page
    assert page.count("alert(1)") == 1
    data = json.loads(re.search(r'<script type="application/json" id="data">(.*?)</script>', page, re.S).group(1))
    assert data["sheet"] == "A" and data["kit"] == sheet.kit and len(data["items"]) == 12
    assert [item["n"] for item in data["items"]] == list(range(1, 13))
    for answer in sheet.answers:
        assert page.count(f"код {answer.answer}<") == 1
    for item in data["items"]:
        for word in ("назван", "частично", "не назван", "ошибка", "не могу решить"):
            assert f'name="r{item["n"]}" value="{word}"' in page
        assert f'id="c{item["n"]}"' in page and f'id="item-{item["n"]}"' in page
    assert page.count('class="tag">главный<') == 6
    assert "Своими словами тоже считается" in page and "похожие по звучанию" in page.lower()
    assert "Верная мысль, которой нет в лекции, — не ошибка" in page


def test_csv_sheet_shows_each_answer_once_and_escapes_formulas():
    answers = bl.load_export(bl.parse_table(export_csv(), "export.csv")).answers
    sheet = bl.build_sheets(answers, 5)[1]
    text = bl.render_sheet_csv(sheet)
    assert text.startswith("\ufeff")
    rows = list(csv.reader(io.StringIO(text.lstrip("\ufeff"), newline=""), delimiter=";"))
    assert tuple(rows[0]) == bl.SHEET_COLUMNS and len(rows) == 13
    column = {name: index for index, name in enumerate(rows[0])}
    assert {row[column["лист"]] for row in rows[1:]} == {"B"}
    assert [row[column["№"]] for row in rows[1:]] == [str(n) for n in range(1, 13)]
    texts = [row[column["текст ответа"]] for row in rows[1:]]
    assert sum(1 for value in texts if value) == 4  # текст — только в первой строке ответа
    assert "'=Равновесие — точка, где спрос равен предложению; цена там «равновесная»." in texts
    assert all(row[column["отметка"]] == "" and row[column["комментарий"]] == "" for row in rows[1:])
    assert not any(leak in text for leak in ("covered", "missing", "meldy_", "stud0000000"))


def test_make_kit_writes_two_sheets_and_a_record_and_never_overwrites(tmp_path):
    export = tmp_path / "export.csv"
    export.write_text(export_csv(), encoding="utf-8")
    made = bl.make_kit(export, tmp_path / "kit", seed=42, answers=3)
    names = sorted(path.name for path in made.files)
    assert names == ["razmetka_A.csv", "razmetka_A.html", "razmetka_B.csv", "razmetka_B.html", "razmetka_kit.json"]
    record = json.loads((tmp_path / "kit" / "razmetka_kit.json").read_text(encoding="utf-8"))
    assert record["seed"] == 42 and record["kit"] == made.kit and record["sample"] == {"requested": 3, "answers": 3, "points": 9}
    assert record["export"]["sha256"] == hashlib.sha256(export.read_bytes()).hexdigest()
    assert sorted(record["sheets"]["A"]["order"]) == sorted(record["sheets"]["B"]["order"])
    assert record["sheets"]["A"]["order"] != record["sheets"]["B"]["order"]
    assert any("по плану нужно 25–50" in note for note in made.notes)

    with pytest.raises(bl.InputError, match="уже есть"):
        bl.make_kit(export, tmp_path / "kit", seed=1)
    again = bl.make_kit(export, tmp_path / "kit", seed=42, answers=3, force=True)
    assert again.kit == made.kit  # тот же seed — тот же набор
    with pytest.raises(bl.InputError):
        bl.make_kit(export, tmp_path / "other", answers=0)


# ── Отметки и ключ ──────────────────────────────────────────────────────────────


def test_load_marks_reads_the_file_the_html_sheet_downloads():
    # Так его скачал лист в браузере (Chromium, Playwright): BOM, «;», CRLF, кавычки и «'» перед «=».
    text = (
        "\ufeffлист;набор;№;ответ №;код;пункт;главный;ввод;название пункта;отметка;комментарий\r\n"
        "A;73a72e0a;1;1;aaa111aaa111/p1;p1;да;голос;Спрос — желание и возможность купить;назван;\r\n"
        'A;73a72e0a;2;1;aaa111aaa111/p2;p2;нет;голос;Закон спроса;частично;"кавычки "" и ; точка с запятой"\r\n'
        "A;73a72e0a;3;1;aaa111aaa111/p3;p3;да;голос;Кривая спроса;ошибка;'=формула?\r\n"
        "A;73a72e0a;4;2;bbb222bbb222/p1;p1;да;текст;Предложение — количество товара;;\r\n"
    )
    marks = load_marks(text, "A")
    assert (marks.sheet, marks.kit, marks.rows) == ("A", "73a72e0a", 4)
    assert marks.labels == {
        "aaa111aaa111/p1": "covered", "aaa111aaa111/p2": "partial", "aaa111aaa111/p3": "wrong", "bbb222bbb222/p1": None,
    }
    assert marks.comments["aaa111aaa111/p2"] == 'кавычки " и ; точка с запятой'
    assert marks.comments["aaa111aaa111/p3"] == "=формула?"
    assert marks.meta["aaa111aaa111/p1"] == bl.ItemMeta(True, "speech", "Спрос — желание и возможность купить")
    assert marks.meta["bbb222bbb222/p1"].input == "text" and marks.empty == ["bbb222bbb222/p1"]


def test_load_marks_reads_a_filled_sheet_and_english_headers_and_reports_repeats():
    filled = csv_text([
        ["answer", "point_id", "label", "comment"],
        ["A1", "P1", "covered", ""],
        ["a1", "p2", "Не назван.", "сказал только термин"],
        ["a1", "p3", "наверное", ""],
        ["a1", "p4", "", ""],
        ["a1", "p5", "ошибка", ""],
        ["a1", "p5", "ошибка", "повтор"],
        ["a1", "p6", "назван", ""],
        ["a1", "p6", "частично", ""],
        ["a1", "p7", "", ""],
        ["a1", "p7", "?", ""],
        ["", "p8", "назван", ""],
    ])
    marks = load_marks(filled, "B")
    assert marks.sheet is None and marks.kit is None
    assert marks.labels == {
        "a1/p1": "covered", "a1/p2": "missing", "a1/p3": None, "a1/p4": None, "a1/p5": "wrong", "a1/p6": None,
        "a1/p7": "unsure",
    }
    assert marks.unknown == {"наверное": ["a1/p3"]} and marks.empty == ["a1/p4"]
    assert marks.repeats == ["a1/p5", "a1/p7"] and marks.conflicts == ["a1/p6"] and marks.bad_rows == [12]
    assert marks.comments["a1/p5"] == "повтор" and marks.comments["a1/p2"] == "сказал только термин"

    with pytest.raises(bl.InputError, match="ключ"):
        load_marks(key_csv(), "A")
    with pytest.raises(bl.InputError, match="выгрузка"):
        load_marks(export_csv(), "A")
    with pytest.raises(bl.InputError, match="отметка"):
        load_marks("код;что-то\nx/p1;1\n", "A")


def test_load_key_reads_verdicts_followups_and_reports_odd_rows():
    key = load_key(key_csv(extra=[
        [A1, "p1", "covered", "отрывок ответа", "", ""],
        [A1, "p3", "covered", "", "", ""],
        ["ffff00000000", "p1", "maybe", "", "", ""],
        ["ffff00000000", "p2", "covered", "", "wrong-ish", ""],
        ["", "p1", "covered", "", "", ""],
    ]))
    assert key.items[f"{A1}/p2"] == bl.KeyRow("partial", "отрывок ответа", "covered", "цена выше — покупают меньше")
    assert key.items[f"{A4}/p2"].verdict == "unrated"
    assert key.repeats == [f"{A1}/p1"] and key.conflicts == [f"{A1}/p3"] and key.items[f"{A1}/p3"].verdict is None
    assert key.unknown == {"maybe": ["ffff00000000/p1"], "wrong-ish (переспрос)": ["ffff00000000/p2"]}
    assert key.bad_rows == [18]
    with pytest.raises(bl.InputError, match="первый запрос"):
        load_key(export_csv())
    with pytest.raises(bl.InputError, match="разметчика"):
        load_key(marks_csv("A"))
    with pytest.raises(bl.InputError, match="meldy_verdict"):
        load_key("answer,point_id\na,p1\n")


# ── Сверка ──────────────────────────────────────────────────────────────────────


def compare(**changes):
    a = load_marks(changes.get("a", marks_csv("A")), "A")
    b = load_marks(changes.get("b", marks_csv("B", column=1)), "B")
    return bl.compare(a, b, load_key(changes.get("key", key_csv())))


def test_compare_counts_every_number_by_hand():
    result = compare()
    assert (result.people4.n, result.people4.agree) == (10, 8)
    assert result.people4.p_e == pytest.approx(0.31) and result.people4.kappa == pytest.approx(0.49 / 0.69)
    # Ошибка: √(0,8·0,2 / (10·0,69²)) = 0,18332 → нижняя граница 0,7101 − 1,96·0,18332 = 0,3508, верхняя — до 1.
    assert result.people4.low == pytest.approx(0.3508, abs=1e-4) and result.people4.high == 1.0
    assert (result.people2.agree, result.people2.p_e, result.people2.kappa) == (9, pytest.approx(0.5), pytest.approx(0.8))

    assert result.versus["A"] == (bl.Share(6, 10), bl.Share(7, 10))  # у A ещё пункт 12, где B пусто
    assert result.versus["B"] == (bl.Share(6, 10), bl.Share(6, 10))  # у B ещё пункт 9, где A не решил
    assert result.versus["consensus"] == (bl.Share(4, 7), bl.Share(5, 8))
    assert result.false_named == bl.Share(2, 5) and result.false_named_of_meldy == bl.Share(2, 4)
    assert result.false_not_named == bl.Share(1, 3) and result.false_not_named_of_meldy == bl.Share(1, 4)

    assert result.confusion == {
        ("covered", "covered"): 2, ("partial", "covered"): 1, ("missing", "missing"): 1, ("covered", "wrong"): 1,
        ("covered", "missing"): 1, ("partial", "partial"): 1, ("unrated", "covered"): 1,
    }
    assert result.people_matrix == {
        ("covered", "covered"): 4, ("missing", "missing"): 2, ("wrong", "wrong"): 1, ("partial", "missing"): 1,
        ("covered", "partial"): 1, ("unsure", "covered"): 1, ("partial", "partial"): 1, ("missing", None): 1,
    }
    groups = {group.name: group for group in result.by_essential + result.by_input}
    assert (groups["Главные пункты"].exact, groups["Главные пункты"].binary) == (bl.Share(3, 6), bl.Share(3, 6))
    assert (groups["Главные пункты"].false_named, groups["Главные пункты"].false_not_named) == (bl.Share(2, 3), bl.Share(1, 3))
    assert (groups["Остальные пункты"].exact, groups["Остальные пункты"].binary) == (bl.Share(1, 1), bl.Share(2, 2))
    rest = groups["Остальные пункты"]
    assert (rest.false_named, rest.false_not_named) == (bl.Share(0, 2), bl.Share(0, 0))
    assert (groups["Голос"].exact, groups["Голос"].binary) == (bl.Share(2, 4), bl.Share(3, 5))
    assert (groups["Голос"].false_named, groups["Голос"].false_not_named) == (bl.Share(1, 3), bl.Share(1, 2))
    assert (groups["Текст"].exact, groups["Текст"].binary) == (bl.Share(2, 3), bl.Share(2, 3))
    assert (groups["Текст"].false_named, groups["Текст"].false_not_named) == (bl.Share(1, 2), bl.Share(0, 1))
    assert groups["Голос и текст"].exact == bl.Share(0, 0)
    assert result.followups == {"covered": 1, "missing": 1}

    assert [item.code for item in result.disputes] == [f"{A2}/p2", f"{A2}/p3", f"{A3}/p3"]
    # Сначала ложные «назван» (4, 8), потом ложное «не назван» (2).
    assert [item.code for item in result.mismatches] == [f"{A2}/p1", f"{A3}/p2", f"{A1}/p2"]
    assert result.warnings == [
        f"B (otmetki_B.csv): без отметки 1: {A4}/p3.",
        f"Meldy не оценил (1) — в сравнение с Meldy не входят: {A4}/p2.",
    ]


def test_report_shows_counts_intervals_and_lists_for_review():
    report = bl.render_report(compare(), today="2026-10-20")
    assert report.startswith("# Слепая разметка: точность вердиктов Meldy\n\nОтчёт от 2026-10-20.")
    # 4 из 7: центр 0,5461, полуширина 0,2957 → 25,0–84,2 %.
    assert "- Meldy и общий ответ людей, 4 варианта: 4 из 7 = 57,1 % (25,0–84,2 %)." in report
    assert "4 варианта — 8 из 10 = 80,0 % (49,0–94,3 %), каппа 0,71 (примерно от 0,35 до 1,00) — существенное согласие." in report
    assert "«назван / не назван» — 9 из 10 = 90,0 %" in report and "каппа 0,80" in report
    assert "Meldy назвал 2 из 5 = 40,0 %" in report and "Meldy не засчитал 1 из 3 = 33,3 %" in report
    assert "| Разметчик A | 6 из 10 = 60,0 % (31,3–83,2 %) | 7 из 10 = 70,0 % (39,7–89,2 %) |" in report
    assert "| назван | 2 | 0 | 1 | 1 | 4 |" in report  # Meldy «назван»: люди назван 2, не назван 1, ошибка 1
    assert "| не оценён | 1 | 0 | 0 | 0 | 1 |" in report
    assert "Пунктов листов с переспросом: 2 (назван — 1, не назван — 1)." in report
    assert f"| {A2} | p1 · главный · Предложение — сколько готовы продать | ошибка | назван | отрывок ответа | — |" in report
    assert f"| {A3} | p3 · Дефицит ниже равновесной цены | не могу решить | назван | назван | — |" in report
    assert "Пунктов для сравнения мало" in report
    assert "covered" not in report and "unrated" not in report  # вердикты — словами


def test_compare_warns_about_every_dropped_or_odd_row():
    a = marks_csv("A", extra=[
        ["A", "00c0ffee", 13, 5, f"{A1}/p1", "p1", "да", "голос", "", "назван", ""],  # повтор с той же отметкой
        ["A", "00c0ffee", 14, 5, f"{A1}/p3", "p3", "нет", "голос", "", "назван", ""],  # повтор с другой отметкой
        ["A", "00c0ffee", 15, 5, "eeee00000000/p1", "p1", "да", "текст", "", "назван", ""],  # нет в ключе и у B
        ["A", "00c0ffee", 16, 5, "", "", "", "", "", "назван", ""],  # без кода
    ])
    b = marks_csv("B", column=1).replace(f"B;00c0ffee;10;4;{A4}/p1;p1;да;текст;", f"B;00c0ffee;10;4;{A4}/p1;p1;да;голос;")
    b = b.replace(f"{A4}/p2;p2;нет;текст;Коэффициент эластичности;назван", f"{A4}/p2;p2;нет;текст;Коэффициент эластичности;может")
    key = key_csv(extra=[
        [A4, "p4", "covered", "", "", ""],  # пункт размеченного ответа, которого нет в листах
        ["dddd00000000", "p1", "covered", "", "", ""],  # ответ не в выборке
        [A1, "p2", "missing", "", "", ""],  # повтор с другим вердиктом
    ])
    result = compare(a=a, b=b, key=key)
    text = "\n".join(result.warnings)
    assert "A (otmetki_A.csv): строки без понятного кода пункта пропущены: 17." in text
    assert f"A (otmetki_A.csv): пункт повторяется, отметка одна — взята одна строка: {A1}/p1." in text
    assert f"A (otmetki_A.csv): пункт повторяется с разными отметками — не учитывается: {A1}/p3." in text
    assert f"B (otmetki_B.csv): непонятная отметка «может» — пункт считается неотмеченным: {A4}/p2." in text
    assert "Есть в файле A, но нет в B (1): eeee00000000/p1." in text
    assert "Нет в ключе, Meldy не с чем сравнить (1): eeee00000000/p1." in text
    assert f"Ключ: пункт повторяется с разными вердиктами — не учитывается: {A1}/p2." in text
    assert "Ответов в ключе, которых нет в листах: 1 (не вошли в выборку?)." in text
    assert f"В ключе есть пункты размеченных ответов, которых нет в листах (1): {A4}/p4." in text
    assert f"У A и B разные пометки «главный» или «ввод» — взята из A: {A4}/p1." in text
    items = {item.code: item for item in result.items}
    assert items[f"{A1}/p3"].a is None and items[f"{A1}/p2"].meldy is None
    assert items["eeee00000000/p1"].in_key is False and items["dddd00000000/p1"].in_a is False
    assert result.people4.n == 8  # без A1/p3 (повтор), A3/p3 (не решил), A4/p2 (непонятно) и A4/p3 (пусто)


def test_compare_hints_at_the_salt_when_nothing_matches_the_key():
    other_salt = key_csv().replace(A1, "999999999999").replace(A2, "888888888888").replace(A3, "777777777777")
    other_salt = other_salt.replace(A4, "666666666666")
    result = compare(key=other_salt)
    assert result.warnings[0].startswith("Ни один пункт листов не нашёлся в ключе.")
    assert result.versus["consensus"] == (bl.Share(0, 0), bl.Share(0, 0)) and result.people4.agree == 8


def test_compare_refuses_one_file_twice_and_flags_swapped_or_foreign_sheets():
    same = marks_csv("A")
    with pytest.raises(bl.InputError, match="одинаковые"):
        compare(a=same, b=same)
    with pytest.raises(bl.InputError, match="Оба файла — отметки листа A"):
        compare(b=marks_csv("A", column=1))
    swapped = compare(a=marks_csv("B", column=1), b=marks_csv("A"))
    assert sum("Файлы перепутаны местами?" in warning for warning in swapped.warnings) == 2
    assert swapped.people4.agree == 8  # цифры от перестановки не меняются
    foreign = compare(b=marks_csv("B", kit="12345678", column=1))
    assert any("из разных наборов (00c0ffee и 12345678)" in warning for warning in foreign.warnings)
    no_sheet = csv_text([["код", "оценка"]] + [[code, WORDS[value[1]]] for code, value in CASES.items()], delimiter=";")
    flagged = compare(b=no_sheet)
    assert any("нет колонки «лист»" in warning for warning in flagged.warnings)
    same_labels = [["код", "оценка"]] + [[code, WORDS[value[0]]] for code, value in CASES.items()]
    twins = compare(a=csv_text(same_labels, delimiter=";"), b=csv_text(same_labels, delimiter=","))
    assert any("совпадают полностью" in warning for warning in twins.warnings)


# ── Весь путь: make → разметка → score ─────────────────────────────────────────


def test_end_to_end_make_fill_and_score(tmp_path, capsys):
    export = tmp_path / "export.csv"
    export.write_text(export_csv(), encoding="utf-8")
    assert bl.main(["make", str(export), "--out", str(tmp_path / "kit"), "--seed", "2026"]) == 0
    printed = capsys.readouterr().out
    assert "Готово: ответов 4, пунктов 12" in printed and "(--seed 2026)" in printed

    def sheet_rows(letter):
        text = (tmp_path / "kit" / f"razmetka_{letter}.csv").read_text(encoding="utf-8-sig")
        return list(csv.DictReader(io.StringIO(text, newline=""), delimiter=";"))

    # A отмечает в HTML-листе и скачивает CSV (тот же формат, что у кнопки «Скачать CSV»).
    rows_a = sheet_rows("A")
    downloaded = [list(bl.MARKS_COLUMNS)] + [
        [row["лист"], row["набор"], row["№"], row["ответ №"], row["код"], row["пункт"], row["главный"], row["ввод"],
         row["название пункта"], WORDS[CASES[row["код"]][0]], "сомневаюсь" if row["код"] == f"{A3}/p3" else ""]
        for row in rows_a
    ]
    (tmp_path / "otmetki_A.csv").write_text("\ufeff" + csv_text(downloaded, delimiter=";"), encoding="utf-8")

    # B заполняет колонку «отметка» в razmetka_B.csv в Excel и сохраняет как CSV в Windows-1251.
    rows_b = sheet_rows("B")
    for row in rows_b:
        row["отметка"] = WORDS[CASES[row["код"]][1]]
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=list(bl.SHEET_COLUMNS), delimiter=";", lineterminator="\r\n")
    writer.writeheader()
    writer.writerows(rows_b)
    (tmp_path / "otmetki_B.csv").write_bytes(out.getvalue().encode("cp1251"))
    assert [row["код"] for row in rows_a] != [row["код"] for row in rows_b]  # порядок у листов разный

    (tmp_path / "key.csv").write_text(key_csv(), encoding="utf-8")
    report_path = tmp_path / "otchet.md"
    code = bl.main(["score", str(tmp_path / "otmetki_A.csv"), str(tmp_path / "otmetki_B.csv"), str(tmp_path / "key.csv"),
                    "--out", str(report_path)])
    assert code == 0
    assert "Предупреждений: 3" in capsys.readouterr().err
    report = report_path.read_text(encoding="utf-8")
    assert "otmetki_B.csv: файл не в UTF-8, прочитан как Windows-1251" in report
    assert "4 варианта — 8 из 10 = 80,0 %" in report and "каппа 0,71" in report
    assert "- Meldy и общий ответ людей, «назван / не назван»: 5 из 8 = 62,5 % (30,6–86,3 %)." in report
    assert "Meldy назвал 2 из 5 = 40,0 % (11,8–76,9 %)" in report
    assert "| Главные пункты | 3 из 6 = 50,0 %" in report and "| Текст | 2 из 3 = 66,7 %" in report
    assert f"| {A3} | p3 · Дефицит ниже равновесной цены | не могу решить | назван | назван | A: сомневаюсь |" in report
    kit = json.loads((tmp_path / "kit" / "razmetka_kit.json").read_text(encoding="utf-8"))
    assert f"разметчик A (лист A, набор {kit['kit']})" in report and f"разметчик B (лист B, набор {kit['kit']})" in report


def test_cli_reports_input_errors_with_exit_code_2(tmp_path, capsys):
    key = tmp_path / "key.csv"
    key.write_text(key_csv(), encoding="utf-8")
    assert bl.main(["make", str(key), "--out", str(tmp_path / "kit")]) == 2
    assert "Это ключ (второй запрос)" in capsys.readouterr().err
    assert not (tmp_path / "kit").exists()
    marks = tmp_path / "a.csv"
    marks.write_text(marks_csv("A"), encoding="utf-8")
    assert bl.main(["score", str(marks), str(marks), str(key)]) == 2
    assert "одинаковые" in capsys.readouterr().err
    assert bl.main(["score", str(marks), str(tmp_path / "нет.csv"), str(key)]) == 2
    assert "не удалось прочитать файл" in capsys.readouterr().err
    other = tmp_path / "b.csv"
    other.write_text(marks_csv("B", column=1), encoding="utf-8")
    assert bl.main(["score", str(marks), str(other), str(key), "--out", str(tmp_path / "нет папки" / "o.md")]) == 2
    assert "Не удалось записать файл" in capsys.readouterr().err
