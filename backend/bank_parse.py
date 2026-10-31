"""Разбор банка вопросов по правилам, без модели: тест с вариантами и открытые вопросы (спецификация §3).

Вход — файл (parse_bank_file: DOCX, TXT, MD, XLSX) или вставленный текст (parse_bank_text). DOCX читает
bank_docx.read_docx (блоки с оформлением и уровнями заголовков), XLSX — read_xlsx (первый лист, zipfile и
lxml, без новых зависимостей), текст — text_blocks (строка — абзац, **жирный** Markdown — жирный кусок),
таблица, вставленная из Word с табуляциями, — tsv_table, Moodle GIFT — read_gift. Выход — словарь
предпросмотра (finish): предметы, темы, вопросы (с вариантами или открытые), правильные ответы и откуда они
взяты, флаги для очереди проверки, доли отмеченных знаков по каждому признаку оформления (marks — по ним
клиент меняет источник ключа без нового запроса), раскладка, статистика.

Раскладки: таблица «вариант на строку» (ячейки № и вопроса объединены вниз), варианты в одной ячейке,
варианты по столбцам (и без шапки; шапки выгрузок Kahoot и Quizizz), таблица на вопрос, таблица-раскладка страницы
(вопросы в ячейках колонками или рамкой), надписи Word с вопросами (bank_docx), нумерованные абзацы (набранные руками
и автонумерация Word; «№1.», «Q1.», «Question 1.», «Пытанне 1.», римские «IV.», «1 – …», «Вопрос 3» строкой над
текстом), вопросы без номеров подряд, блоки через пустую строку (MyTestX «+»/«-», Indigo «*»/«#», Aiken «ANSWER: B»),
варианты в строку «а) … б) …» (и строкой под вопросом), по два в строке, «a<tab>…»; страница попытки Moodle и форма
Google с ответами, скопированные текстом; заголовки Markdown в файле .md. Колонтитулы («Страница 3 из 10», номер
страницы и повторённая шапка) и подсказка «Выберите один правильный ответ:» — не текст вопроса. Вопрос без
вариантов — открытый (kind «open»): список вопросов к экзамену разбирается в открытые вопросы, в смешанном
файле вид у каждого вопроса свой. Варианты — строки с буквой («а)», «b.»), с «+»/«-», пункты списка Word;
строки под вопросом до первого такого варианта — его текст: код идёт отдельными строками как написан, с
отступами и пустыми строками внутри. В файле без ключа и отметок строки без подписи под вопросом — тоже его
текст (открытый вопрос с кодом). Номер вопроса продолжает нумерацию (следующий, «1» — заново, небольшой
пропуск): «0.0.0.0», «3.5», «192)» после вопроса 125 — текст. Вид — по устройству, а не по словам: отмеченный
вариант или ключ-буква — выбор; «порядок» — ключ-перестановка («2, 4, 3, 1»), места числами («3. март») или
задание «Расположите…» без отметок; «соответствие» — пары («А-2, Б-3») или «Установите соответствие…» без
отметок. format_mode: auto — так; test — вопрос без вариантов помечается no_options, строки без подписи под
вопросом — варианты; open — строки-варианты приклеиваются к тексту вопроса как написаны, все вопросы открытые.

Предметы — уровень над темами (_sections): заголовок со словом «Дисциплина», «Учебная дисциплина»,
«Предмет», «МДК», «ПМ», «Модуль», «Курс» и названием (абзац или объединённая строка таблицы) — evidence
«heading»; верхний уровень заголовков Word, когда темы стоят уровнем ниже, — «heading_level»; отдельная
таблица или отдельный нумерованный ряд после заголовка не «Тема…», где нумерация начинается заново с 1, —
«restart» (с предупреждением subjects_restart: клиент спрашивает, делить ли). Без признаков — один предмет
без названия (evidence «none»). Темы нумеруются по всему файлу, у каждой — свой предмет.

Ключ по старшинству: ключ строками от пользователя (key_text), явный ключ файла (колонка ключа, строка
«Ответ: …» и «(Ответ: б)» в конце строки вопроса, список ключей: «Ключ» и строки «1 – б», одна строка «Ключ: 1 – б,
2 – а, 7 – а, в», «1б 2а 3в», таблица «№ | Ответ» или «№ | 1 | 2» над «Ответ | б | а»; в файле с вариантами — ключ
своего варианта: «Вариант 2: 1а 2б», таблица «№ | Вариант 1 | Вариант 2»), маркеры («#» и «*» — не в коде:
«#include» — код), флажки (и «☑/☐», «[x]», «+в)», «*в)» перед вариантом, «+» в столбце ключа у варианта на строку),
один признак оформления на весь документ (жирный,
подчёркивание, выделение, цвет, заливка, курсив; вариант отмечен, если отмечено не меньше 60 % его
видимых знаков). key_mode: auto — так; first_option — «первый вариант всегда правильный» (у вопросов с
вариантами [0], ключи файла не берутся); none — «ответы не отмечены» (ключей файла нет). Ключ ИИ не
придумывает: модели здесь нет. У открытого вопроса ключа нет; строка «Ответ: …» становится answer.

Текст не чистится, как в устном списке (никакой разметки, пробелов и normalize_question): «#region»,
«*», «--», «-=», «__init__», «items?.Count ?? 0», «count -= step;», «3.5», «int arr[10];» остаются как
написаны; срезаются только узнанные номера, буквы вариантов (если они идут по порядку), маркеры и знаки
списка («x;», «y;», «z.»). Повторы вариантов (same_options) и вопросов (duplicate) — с учётом регистра.

Пределы: до 2000 вопросов в файле (BankError 413 too_many), до 2 000 000 знаков текста (413 too_much_text),
тем до 300 (хвост сливается с 300-й, предупреждение topics_merged), вопрос до 4000 знаков, вариант до 600
(длиннее — обрезка и флаг too_long), в ответе до 20 вариантов у вопроса. Регулярные выражения — без
неоднозначных соседних повторов (маркер в конце варианта ищется в хвосте строки), склейка строк перестаёт
расти после двойного предела: разбор остаётся линейным.
"""

from __future__ import annotations

import io
import base64
import re
import zipfile
from collections import Counter
from dataclasses import dataclass, field, replace
from typing import Optional

import bank_docx
import bank_formats
import bank_markup
from bank_docx import (
    LATIN_LOWER,
    RUSSIAN_LOWER,
    ArchiveTooLarge,
    Block,
    Cell,
    Para,
    Run,
    Table,
    check_archive,
    read_docx,
)
from parser import _legacy_decode_score, _looks_like_text

__all__ = [
    "BankError",
    "FILE_EXTENSIONS",
    "FORMAT_MODES",
    "KEY_MODES",
    "MARK_SHARE",
    "MAX_ITEMS",
    "MAX_TOTAL_CHARS",
    "check_file_name",
    "clean_text",
    "decode_text",
    "parse_bank_file",
    "parse_bank_text",
    "parse_blocks",
    "parse_key_text",
    "read_key_file",
    "read_gift",
    "read_xlsx",
    "subject_title",
    "text_blocks",
    "tsv_table",
]

FILE_EXTENSIONS = ("docx", "txt", "md", "xlsx", "csv", "html", "htm", "xml", "pdf", "gift")  # gift — выпуск 49
KEY_MODES = ("auto", "first_option", "none")
FORMAT_MODES = ("auto", "test", "open")

MAX_ITEMS = 2000
MAX_TOTAL_CHARS = 2_000_000
MAX_TOPICS = 300
MAX_QUESTION_CHARS = 4000
MAX_OPTION_CHARS = 600
MAX_OPTIONS_OUT = 20  # больше вариантов у вопроса — ошибка разбора (флаг many_options), список не раздуваем
MAX_LABEL_CHARS = 16
MAX_EXPLANATION_CHARS = 2000  # test_items_explanation_check (выпуск 48)
MAX_TITLE_CHARS = 200
MAX_HEADING_CHARS = 200  # строка длиннее — не заголовок предмета
MAX_SKIPPED = 50
SKIPPED_CHARS = 200
MAX_KEY_TEXT_CHARS = 30_000
# Склейка перенесённых строк перестаёт расти после двойного предела: дальше всё равно обрезка и too_long.
GROW_QUESTION_CHARS = 2 * MAX_QUESTION_CHARS
GROW_OPTION_CHARS = 2 * MAX_OPTION_CHARS
MAX_XLSX_PART_BYTES = 24 * 1024 * 1024
MAX_XLSX_CELLS = 200_000
MAX_XLSX_COLUMNS = 32
TEXT_BYTES_PER_CHAR = 8  # файл TXT больше 8 байт на знак предела — заведомо больше предела (UTF-8 — до 4 байт)
NUMBERED_RUN_SCAN = 200  # строк, которые смотрит numbered_run
STEM_SCAN = 200  # строк под вопросом, в которых first_option ищет первый вариант с подписью
MAX_NUMBER_JUMP = 20  # номер вопроса больше ожидаемого не дальше чем на столько (пропуски), иначе — текст

MAX_OPTIONS = 8
MIN_OPTIONS = 2
MARK_SHARE = 0.6
MARK_SUFFIX_TAIL = 80

OLD_DOC_DETAIL = "Это файл Word старого формата (.doc). Откройте его в Word, сохраните как DOCX и загрузите снова."
UNSUPPORTED_DETAIL = "Этот формат не читаем. Подойдут Word (DOCX), Excel (XLSX), PDF, текст (TXT, MD, CSV), HTML и Moodle XML."
SCAN_PDF_DETAIL = "В этом PDF нет текста — это скан. Пришлите Word или текстовый файл."
TOO_MANY_DETAIL = "В файле больше 2000 вопросов. Разделите его на части и загрузите по очереди."
NO_ITEMS_DETAIL = "Не нашли вопросов. Проверьте, что в файле есть пронумерованные вопросы."
NO_TEST_ITEMS_DETAIL = "Не нашли вопросов с вариантами ответов. Проверьте, что это тест: вопрос и под ним варианты."
UNREADABLE_DETAIL = "Не удалось прочитать файл. Сохраните его заново в Word как DOCX и попробуйте ещё раз."
TOO_MUCH_TEXT_DETAIL = "В файле больше 2 000 000 знаков текста. Разделите его на части и загрузите по очереди."
EMPTY_FILE_DETAIL = "Файл пустой. Выберите другой файл."
TOPICS_MERGED_WARNING = "В файле {count} тем — больше 300. Вопросы тем после 300-й добавлены в 300-ю."
SUBJECTS_RESTART_WARNING = "Похоже, в файле несколько предметов. Разделить?"
KEY_TEXT_NO_PAIRS_WARNING = "В ключе не нашли пар «номер – ответ», например «1 – б»."
KEY_TEXT_NO_MATCH_WARNING = "Номера в ключе не совпали с номерами вопросов в файле."
KEY_FILE_NO_KEYS_DETAIL = "В файле ключа не нашли пар «номер — ответ»: нужна таблица «1 | А» или строки «1 – А»."
KEY_FILE_CHOOSE_WARNING = "В файле ключа несколько вариантов: {variants}. Выберите вариант этого теста."
KEY_FILE_OTHER_WARNING = "В файле ключа нет варианта {variant}, есть: {variants}. Выберите нужный."
MAX_KEY_SECTIONS = 30
# Картинки вопросов в ответе разбора (base64): до 12 МБ на файл; вопросы после предела — с флагом has_image, как раньше.
MAX_PICTURES_BYTES = 12 * 1024 * 1024


class BankError(Exception):
    """Ответ пользователю вместо предпросмотра: HTTP-статус, код для клиента и текст по-русски."""

    def __init__(self, status: int, code: str, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.code = code
        self.detail = detail


RUS = RUSSIAN_LOWER
LAT = LATIN_LOWER
# Латинские буквы, похожие на кириллицу, по регистру (ключ набран в другой раскладке).
LOOKALIKE_LOWER = {"a": "а", "c": "с", "e": "е", "o": "о", "p": "р", "x": "х", "y": "у"}
LOOKALIKE_UPPER = {"A": "а", "B": "в", "C": "с", "E": "е", "H": "н", "K": "к", "M": "м", "O": "о", "P": "р", "T": "т", "X": "х"}

# «\s*(?:№\s*)?» вместо «\s*№?\s*»: два соседних \s* на длинном ряду пробелов перебирались бы квадратично.
# «Модуль» с названием — предмет (SUBJECT_CODE_RE проверяется раньше), «Модуль 2» без названия — тема.
TOPIC_RE = re.compile(
    r"^(?:тема|раздел|модуль|блок|часть|глава)\s*(?:№\s*)?(?:[IVXLC]{1,6}|\d{1,2}(?:\.\d{1,2})*)(?![\w])"
    r"|^вариант\s*(?:№\s*)?\d{1,2}\s*(?:[.:]\s*)?$",
    re.I,
)
# Номер — «12.» или «12)»; «3.5», «10.0.0.1», «0.0.0.0  0.0.0.0» (число, адрес, строка таблицы) — не номер: после точки цифра.
# Со словом или знаком перед номером: «Вопрос 3.», «Задание №3», «№3.», «№ 3 …», «Q3.», «Question 3.», «Пытанне 3.» (бел.).
# «3 – Текст» (тире с пробелами) — номер, если дальше слово (а не ключ «3 – б» и не «5 - 3»).
_Q_WORD = r"(?:вопрос|задание|заданне|пытанне|question|task)"
QUESTION_RE = re.compile(
    rf"^(?:{_Q_WORD}\s*(?:№\s*)?|№\s*|q\s*)?(\d{{1,4}})\s*(?:\)|\.(?!\d))\s*(?=\S)(.*)$"
    rf"|^(?:{_Q_WORD}\s*(?:№\s*)?|№\s*)(\d{{1,4}})\s*[.:)]?\s+(.*)$"
    r"|^(\d{1,4})\s+[–—-]\s+(?=[^\n]*?[^\W\d_]{3})(.*)$",
    re.I | re.S,
)
# Римский номер вопроса «IV. Текст» (1–39): только заглавными, после него точка или скобка и пробел.
ROMAN_QUESTION_RE = re.compile(r"^(?=[IVX])(X{0,3}(?:IX|IV|V?I{0,3}))\s*[.)]\s+(?=\S)(.*)$", re.S)
_ROMAN_VALUES = {"I": 1, "V": 5, "X": 10}
# Подпись варианта: «а)», «б.», «(в)», «1)», «2.». Не подпись: «3.5» (число) и «c.Count», «a.b» (код: после точки
# латинская буква, цифра, «_», скобка). Срезается, только если подписи вариантов идут по порядку (labels_in_sequence).
# «a<tab>текст» (буква и табуляция без скобки) — тоже подпись.
OPTION_LABEL_RE = re.compile(
    r"^\(?([а-иА-ИсСa-hA-H])(?:\s*(?:\)|\.(?![A-Za-z\d_(\[]))|\t)\s*(?=\S)|^(\d{1,2})\s*(?:\)|\.(?!\d))\s*(?=\S)", re.S)
# Отметка перед вариантом: флажок «☑»/«☐», «[x]»/«[ ]» (и пункт Markdown «- [x]»), «+» или «*» вплотную перед буквой («+в)»).
# Отмеченный — ключ (как флажок Word), «☐»/«[ ]» — неотмеченный.
LEAD_MARK_RE = re.compile(  # без «^»: lead_mark ищет с позиции после отступа (match с pos)
    r"(?:[-*]\s+)?(?:\[([ xXхХ✓✔])\]|([☐☑☒✅□■✓✔]))\s*(?=\S)"
    r"|(\+\s?|\*)(?=\(?(?:[а-иА-ИсСa-hA-H]|\d{1,2})\s*[).]\s*\S)"
)
# Варианты по два в строке: «а) 180<tab>в) 360» — подпись после табуляции или двух пробелов (их ищет grid_parts:
# поиск с пробелами перед подписью был бы квадратичным на длинном ряду пробелов).
GRID_LABEL_RE = re.compile(r"(?<=[\t \u00a0])\(?[а-иА-Иa-hA-H] ?[).] ?(?=\S)")
BULLET_RE = re.compile(r"^[•·▪◦●○■□➢➤►–—]\s+|^-\s+(?=\S)")
INLINE_OPTION_RE = re.compile(r"(?:(?<=\s)|^)([а-иa-h])\)\s*")
ANSWER_RE = re.compile(
    r"^(?:правильн\w*\s+ответ\w*|верн\w*\s+ответ\w*|ответ|эталон(?:\s+ответа)?|ключ|отв\.|answer"
    r"|правільн\w*\s+адказ\w*|адказ|правильн\w*\s+відповід\w*|відповідь|(?:correct|right)\s+answer|the\s+correct\s+answers?\s+(?:is|are))"
    r"\s*[:\-–—]\s*(.+)$", re.I)
KEY_HEADING_RE = re.compile(
    r"^(?:ключ\w*|ответы|эталоны?(?:\s+ответов)?|правильные\s+ответы|ключ\w*\s+(?:к|правильных)\s+.*|ответы\s+к\s+.*"
    r"|таблица\s+ответов|адказы|відповіді|answer\s+key|answers|(?:correct|right)\s+answers|key)\s*[.:]?$",
    re.I,
)
KEY_PAIR_START_RE = re.compile(r"(?:(?<=^)|(?<=[\s,;]))(\d{1,4})(?:\s*[-–—.:)]\s*|\s+(?=[а-яёa-z])|(?=[а-яё]))", re.I)
# Ключ слитно: «1в2б3б4в» — по одной букве на номер
GLUED_KEY_RE = re.compile(r"(?<!\S)(?:\d{1,3}[а-иА-Иa-hA-H]){2,}(?!\S)")
GLUED_PAIR_RE = re.compile(r"\d{1,3}[а-иА-Иa-hA-H]")
# Ключ одной строкой: «Ключ: 1 – б, 2 – а, …», «Ответы: 1-б; 2-а», «Ключ к тесту — 1б 2а» (пары — KEY_PAIR_START_RE).
KEY_LIST_HEAD_RE = re.compile(
    r"^(?:ключ\w*(?:\s+(?:к|правильных)\s+[^:–—]{1,60}?)?|ответы(?:\s+к\s+[^:–—]{1,60}?)?|правильные\s+ответы"
    r"|эталоны?(?:\s+ответов)?|таблица\s+ответов|адказы|відповіді|answer\s+key|answers|(?:correct|right)\s+answers)"
    r"\s*[:.–—-]\s*",
    re.I,
)
# Ответ в списке ключей: «б», «а, в», «2, 4, 3, 1», «А-2, Б-3» — короткие буквы и числа через запятую или тире.
KEY_VALUE_SPLIT_RE = re.compile(r"[\s,;:=→–—-]+")
MAX_KEY_VALUE_CHARS = 40
# Ключ вопроса на соответствие: «А-2, Б-3, В-1», «1б, 2а» — пары буква–число.
MATCH_KEY_PAIR_RE = re.compile(r"(?:[а-яёa-z](?:\s*[-–—:=→])?\s*\d{1,2}|\d{1,2}(?:\s*[-–—:=→])?\s*[а-яёa-z])(?![а-яёa-z\d])", re.I)
MAX_KEY_SHAPE_CHARS = 200  # ключ длиннее — не пары и не перестановка: выбор (или key_invalid)
MULTI_HINT_RE = re.compile(
    r"(?<![а-яё])(?:(?:несколько|все|два|три|четыре)\s+(?:правильн|верн)|выберите\s+все|укажите\s+все|отметьте\s+все"
    r"|все\s+(?:города|верные|правильные))",
    re.I,
)
# Место в порядке, записанное числом («3. март», MyTestX): число — место варианта, если в вопросе есть слово о порядке.
ORDER_HINT_RE = re.compile(
    r"(?<![а-яё])(?:последовательност|правильн\w+\s+порядок|по\s+порядку|в\s+(?:хронологическом\s+)?порядке"
    r"|расположите|упорядочите|расставьте)",
    re.I,
)
# Вид «порядок» и «соответствие» — только по заданию (повелительное «Расположите…», «Установите соответствие…» в вопросе
# без «?») и когда ни один вариант не отмечен ключом: «по порядку», «последовательности», «соответствия» внутри вопроса
# с выбором ответа вида не меняют.
ORDER_TASK_RE = re.compile(
    r"(?<![а-яё])(?:расположите|расставьте|упорядочите|пронумеруйте)(?![а-яё])"
    r"|(?<![а-яё])(?:установите|укажите|определите|восстановите|запишите)\s+(?:(?:правильн|верн|нужн|логическ|хронологическ)\w*\s+)?"
    r"(?:последовательност|порядок|очер[её]дност)",
    re.I,
)
MATCH_TASK_RE = re.compile(
    r"(?<![а-яё])(?:соотнесите|сопоставьте)(?![а-яё])"
    r"|(?<![а-яё])(?:установите|укажите|определите|найдите)\s+(?:\w+\s+)?соответстви"
    r"|(?<![а-яё])(?:установите|подберите|составьте)\s+пары",
    re.I,
)
OPEN_HINT_RE = re.compile(r"_{3,}|\.{5,}|(?<![а-яё])(?:впишите|дополните|вставьте\s+пропущ\w*)(?![а-яё])", re.I)
PLUSMINUS_RE = re.compile(r"^([+-])\s+(?=\S)")
# «*верно», «#верно» (Indigo). Не маркер: директивы кода «#include», «#region», «#define», «#!/bin/bash».
GLUED_MARK_RE = re.compile(
    r"^([*#])(?=\S)(?!(?:include|import|region|endregion|define|undef|ifn?def|if|elif|else|endif|pragma|line|error"
    r"|warning|nullable|using)(?![A-Za-z])|!)"
)
# Ищется только в хвосте варианта (mark_suffix): на длинном ряду пробелов поиск по всей строке квадратичен.
MARK_SUFFIX_RE = re.compile(
    r"\s*(?:\(\s*\+\s*\)|\(\s*(?:верно|правильно|правильный\s+ответ|верный\s+ответ)\s*\)|[-–—]\s*(?:верно|правильно)"
    r"|✓|✔|√|(?<=[^\s+])\+|\s\+)\s*$",
    re.I,
)
HEADER_CELL_RE = re.compile(
    r"^(?:№.*|n|no\.?|п\s*/\s*п|номер.*|вопрос\w*.*|задани\w*.*|содержани\w*.*|формулировк\w*.*|текст.*|тестов\w*.*"
    r"|вариант\w*.*|ответ\w*.*|правильн\w*.*|верн\w*.*|ключ\w*|эталон\w*.*|дистрактор\w*.*|тем[аы]|раздел\w*|компетенци\w*.*|код.*"
    r"|уров\w*.*|балл\w*.*|[а-еa-e]|[1-8]|утверждени\w*.*|тип(?:\s+вопроса)?|#"
    # шапки выгрузок Kahoot, Quizizz, Google Forms: «Question - max 120 characters», «Answer 1», «Correct answer(s)»
    r"|question.*|answers?\b.*|options?\s*\d.*|choice\s*\d.*|correct.*|right\s+answer.*|time.*|image.*|type|points?|score)$",
    re.I,
)
HEADER_SCAN = 6  # шапка таблицы — в одной из первых строк (выгрузка Kahoot: над шапкой название и подсказка)
# Отметка верного варианта в столбце ключа при варианте на строку: «+», «✓», «x», «да», «верно»
MARK_CELL_RE = re.compile(r"^(?:[+✓✔√*xXхХ]|да|верно|правильно|true|истина|correct)$", re.I)
# Вид вопроса в столбце «Question Type» (Quizizz): ввод ответа — открытый вопрос, ответ — в первом столбце вариантов
FILL_TYPE_RE = re.compile(r"fill|blank|open|short|ввод|открыт|кратк", re.I)
CODE_RE = re.compile(r"[{}]|=>|\?\.|\+=|-=|==|!=|<<|>>|::|#\w|\w\(\)|\w\.\w+\(|;\s*\S")
# Строка SQL, как её пишут в заданиях: оператор заглавными в начале строки («SELECT *», «FROM Students», «ORDER BY
# name DESC;», «CREATE TABLE Orders (»); строчными — только узнаваемым строением («select … from», «insert into»).
SQL_LINE_RE = re.compile(
    r"^(?:SELECT|INSERT\s+INTO|DELETE\s+FROM|CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX|VIEW|TRIGGER|PROCEDURE|FUNCTION"
    r"|DATABASE|SCHEMA|SEQUENCE|USER|ROLE)|ALTER\s+TABLE|DROP\s+(?:TABLE|INDEX|VIEW|TRIGGER|PROCEDURE|FUNCTION|DATABASE"
    r"|SCHEMA|SEQUENCE|USER|ROLE)|TRUNCATE|GRANT|REVOKE|BEGIN\s+TRANSACTION|COMMIT|ROLLBACK|SAVEPOINT|SET\s+TRANSACTION"
    r"|WHERE|(?:(?:INNER|LEFT|RIGHT|FULL|CROSS)\s+)?(?:OUTER\s+)?JOIN|ORDER\s+BY|GROUP\s+BY|HAVING|UNION)\b"
    r"|^(?:UPDATE\s+\w+|FROM\s+\w|SET\s+\S+\s+\S|BEGIN\s*;|VALUES\s*\(|WITH\s+\w+\s+AS\b)"
    r"|^(?:select\b.*\bfrom\b|insert\s+into\b|delete\s+from\b|update\s+\w+\s+set\b|(?:create|alter|drop)\s+table\b)"
)
# Строка оболочки: приглашение («$ ls -l», «C:\>ping …», «PS C:\>»), «#!/bin/bash», «@echo off», команда PowerShell
# («Get-Process | …») или команда строчными в начале строки («chmod 755 deploy.sh», «ps aux | grep nginx»).
SHELL_LINE_RE = re.compile(
    r"^(?:\$\s+\S|#!/|[A-Za-z]:\\[^\s>]*>|PS\s+[A-Za-z]:\\|@echo\b"
    r"|(?:Get|Set|New|Remove|Start|Stop|Restart|Invoke|Write|Test|Import|Export|Select|Where|Sort|Format|Out|Measure"
    r"|Clear|Copy|Move|Rename|Enable|Disable|Install|Update|ConvertTo|ConvertFrom|ForEach)-[A-Z][A-Za-z]+(?=[\s|]|$)"
    r"|(?:sudo|ls|cd|pwd|cat|echo|grep|egrep|find|chmod|chown|chgrp|mkdir|rmdir|rm|cp|mv|ln|touch|tar|gzip|gunzip|zip"
    r"|unzip|apt|apt-get|yum|dnf|pacman|systemctl|service|journalctl|ps|top|htop|kill|killall|pkill|nice|renice|df|du"
    r"|free|mount|umount|uname|whoami|useradd|usermod|userdel|groupadd|passwd|history|which|whereis|head|tail|sort|uniq"
    r"|wc|cut|awk|sed|tr|xargs|ssh|scp|rsync|curl|wget|ping|traceroute|tracert|ipconfig|ifconfig|ip|netstat|nslookup"
    r"|dig|docker|git|bash|sh|zsh|python3?|pip3?|export|source|alias|crontab|sleep|jobs|nohup|umask|tasklist|taskkill"
    r"|netsh|route|arp|hostname|systeminfo|chkdsk|xcopy|robocopy|attrib|dir|copy|del|cls|type|set)(?=\s|$))"
)
# Строковые значения и хвосты-комментарии не считаются, когда строку проверяют на русские слова.
_LITERAL_RE = re.compile(r"\"[^\"]*\"|'[^']*'|`[^`]*`")
_COMMENT_TAIL_RE = re.compile(r"(?:\s--\s|\s#\s|//).*$")


def _words_line(raw: str) -> bool:
    """Строка — русские слова: больше половины букв кириллица (строковые значения и комментарии не в счёт)."""
    bare = _COMMENT_TAIL_RE.sub(" ", _LITERAL_RE.sub('""', raw))
    letters = [char for char in bare if char.isalpha()]
    return bool(letters) and sum(1 for char in letters if "а" <= char.lower() <= "я" or char in "ёЁ") * 2 > len(letters)


_ASKS_RE = re.compile(r"[^\W\d_]\?\s*$")  # конец вопроса: слово и «?» («ls?», «Where is it?»), но не «echo $?»


def sql_or_shell_line(raw: str) -> bool:
    """Строка — узнаваемая строка SQL или оболочки (команда, приглашение, оператор), а не вопрос и не русские слова."""
    text = raw.strip()
    if not text or _ASKS_RE.search(text) or _words_line(text):
        return False
    return bool(SQL_LINE_RE.match(text) or SHELL_LINE_RE.match(text))


def code_in_lines(text: str) -> bool:
    """В тексте вопроса есть строка SQL или оболочки (у них нет знаков кода C: «SELECT name», «chmod 755 deploy.sh»)."""
    return any(sql_or_shell_line(line) for line in text.split("\n"))
OPEN_LINE_RE = re.compile(r"^(?:\[(.+)\]|=\s*(?:\{[^}]*\}\s*)?(.+))$")
PAIR_LINE_RE = re.compile(r"^(.*?\S)?\s*=\s*(\S.*)$")
MD_BOLD_RE = re.compile(r"\*\*(.+?)\*\*")
# Вариант-картинка: в строке одна подпись «Б)» / «в.», а сам вариант — картинка после неё
LONE_LABEL_RE = re.compile(r"^\(?([а-иА-ИсСa-hA-H])\s*[).]$")
# «17.» и картинка: вопрос — сама картинка (владелец: «а если вопрос является картинкой?»)
NUMBER_ONLY_RE = re.compile(r"^(\d{1,4})\s*[.)]?$")
# «86.17. Вопрос»: номер вопроса и оставшийся от другого списка номер (строка вопроса на всю ширину таблицы)
DOUBLE_NUMBER_RE = re.compile(r"^(\d{1,4})\.\s?(\d{1,4})\.\s*(?=\S)(.*)$", re.S)
# «Вариант 1», «ТЕСТОВЫЙ ВАРИАНТ 4», «Вариант № 2.» — заголовок всего файла; в файле ключей — «КЛЮЧ … — ВАРИАНТ 4».
VARIANT_HEADING_RE = re.compile(r"^(?:тестовый\s+)?вариант\s*(?:№\s*)?\d{1,3}\s*[.:]?$", re.I)
VARIANT_RE = re.compile(r"(?<![а-яё])вариант\s*(?:№\s*)?(\d{1,3})(?!\d)", re.I)
# Ключ варианта строкой: «Вариант 2: 1а 2б», «Ключ к варианту 2 — 1-а, 2-в», «Ответы к варианту 3.» (пары — со следующих строк)
VARIANT_KEY_RE = re.compile(
    r"^(?:(?:ключ\w*|ответы|эталоны?|правильные\s+ответы)\s+(?:к\s+|для\s+)?)?вариант\w*\s*(?:№\s*)?(\d{1,3})(?!\d)\s*[:.)–—-]?\s*(.*)$",
    re.I | re.S,
)
# «Вопрос 12», «Вопрос №12», «Question 12», «Пытанне 12» отдельной строкой — номер вопроса, текст — со следующей строки
QUESTION_NUMBER_RE = re.compile(rf"^{_Q_WORD}\s*(?:№\s*)?(\d{{1,4}})(?:\s+(?:из|of|з)\s+\d{{1,4}})?\s*[.:]?$", re.I)
# Ответ в скобках в конце строки вопроса: «Кто написал «Бородино»? (Ответ: б)»
STEM_ANSWER_RE = re.compile(r"\((?:правильн\w*\s+ответ\w*|верн\w*\s+ответ\w*|ответ|ключ|answer) ?[:\-–—] ?([^()]{1,40}?) ?\)\s*$", re.I)
STEM_ANSWER_TAIL = 80  # ищется только в хвосте строки вопроса (как маркер в конце варианта)
# Подсказка к вариантам, не часть вопроса: «Выберите один правильный ответ:» (Moodle: «Выберите один ответ:»)
CHOOSE_ONE_RE = re.compile(r"^(?:выберите|укажите|отметьте)\s+(?:один|одно)\s+(?:(?:правильный|верный)\s+)?(?:ответ|вариант(?:\s+ответа)?)\s*[:.]?$"
                           r"|^(?:choose|select)\s+(?:one(?:\s+(?:answer|option))?|the\s+correct\s+(?:answer|option))\s*[:.]?$", re.I)
# Колонтитулы и служебные строки, которые не относятся ни к одному вопросу: «Страница 3 из 10», «Стр. 4», «Page 2 of 5»;
# строки страницы просмотра попытки Moodle — только в файле, где она узнана (moodle_chrome).
PAGE_LINE_RE = re.compile(r"^(?:страница|стр\.?|лист|page)\s*\d{1,4}(?:\s*(?:из|of|/)\s*\d{1,4})?\.?$|^-\s*\d{1,4}\s*-$", re.I)
MOODLE_MARK_RE = re.compile(r"^(?:отметить вопрос|текст вопроса|flag question|question text)$", re.I)
MOODLE_CHROME_RE = re.compile(
    r"^(?:отметить вопрос|текст вопроса|отзыв|верно|неверно|частично правильный|выполнен|нет ответа|не завершено"
    r"|баллов?\s*:?\s*[\d,.]+\s+из\s+[\d,.]+|балл\s*:?\s*[\d,.]+|flag question|question text|feedback|correct|incorrect"
    r"|partially correct|mark\s+[\d.]+\s+out\s+of\s+[\d.]+)$",
    re.I,
)
# «1.2. Что такое алгоритм?» — номер внутри темы: метка «1.2», место в нумерации 2. Только строка-вопрос (знак в конце):
# «3.5 кг», «10.0.0.1  255.0.0.0» — не вопрос.
SUBNUMBER_RE = re.compile(r"^(\d{1,2})\.(\d{1,3})\.?\s+(?=[^\W\d_])(.*[?:.…])\s*$", re.S)
# Ответы GIFT: «{=верно ~неверно}», «{#5}», «{T}» — скобка не впритык к слову или «$», внутри первым «=», «~», «#число»
# или T/F. Код в скобках — не GIFT: «{ x = 100; }», «${#arr[@]}», «List{T}», «std::cout».
GIFT_ANSWERS_RE = re.compile(r"(?<![\w$])\{\s*(?:[=~][^{}]*|#\s*[-=\d][^{}]*|(?:T|F|TRUE|FALSE)\s*(?:#[^{}]*)?)\}", re.I)
GIFT_TITLE_RE = re.compile(r"^[ \t]*::[^:\n]{1,200}::", re.M)

# Заголовок предмета. «Дисциплина: Основы программирования», «Предмет «История»», «Курс: Сети»:
SUBJECT_WORD_RE = re.compile(r"^(?:учебн\w*\s+)?(?:дисциплин[аы]|предмет|курс)(?![а-яё])\s*(?::|(?=[«\"„“]))\s*(.+)$", re.I)
# «Дисциплина Основы программирования», «Учебная дисциплина Базы данных» — название с заглавной буквы:
SUBJECT_SPACE_RE = re.compile(r"^(?:учебн\w*\s+)?(?:дисциплин[аы]|предмет)\s+(.+)$", re.I)
# «МДК 01.01 Разработка…», «ПМ.01 …», «Модуль 2. Базы данных» — название вместе с кодом:
SUBJECT_CODE_RE = re.compile(r"^(?:мдк|пм|модул[ья])(?![а-яё])[\s.]*(?:№\s*)?\d[\d.]*\s*[.:—–-]?\s*(.+)$", re.I)
# «Тестовые задания по учебной дисциплине «Основы программирования»»:
SUBJECT_IN_LINE_RE = re.compile(
    r"(?:^|\s)по\s+(?:учебн\w*\s+)?(?:дисциплин[еау]|предмет[ау]|мдк|курсу)(?![а-яё])\s*(?:[\d.]+\s*)?:?\s*(.+)$", re.I)
_QUOTED_RE = re.compile(r"[«\"„“]([^»\"“”]+)[»\"“”]")
_LETTERS_RE = re.compile(r"[A-Za-zА-Яа-яЁё]")

FORMAT_SIGNALS = ("bold", "underline", "highlight", "color", "shade", "italic")
CHOICE_KINDS = ("single", "multiple", "truefalse")
# Флаги, из-за которых вопрос попадает в «Проверьте N вопросов» (картинка, формула и склейка строк — нет).
PROBLEM_FLAGS = frozenset({
    "no_key", "several_marked", "key_conflict", "key_invalid", "key_letter_ambiguous", "partial_mark", "few_options",
    "many_options", "empty_option", "same_options", "no_options", "duplicate", "too_long",
})
# Вопросы, чьи строки файла уходят экрану проверки (source_lines): с флагами проверки и те, что модель прочитала иначе.
REVIEW_FLAGS = PROBLEM_FLAGS | {"ai_disagrees", "ai_key_rejected", "ai_only"}
AMBIGUOUS_FLAGS = frozenset({"several_marked", "key_conflict", "key_letter_ambiguous"})
# Маркеры ключа в ответе (marker): «+»/«-» перед вариантом, «*» и «#» Indigo, «+» после варианта.
MARKER_NAMES = (("+-", "plus_minus"), ("*", "star"), ("#", "hash"), ("suffix", "plus_suffix"))
SUBJECT_ROLES = ("subject", "subject_level")


def question_number(text: str) -> Optional[tuple[str, int, str]]:
    """Номер вопроса в начале строки — (метка, место в нумерации, текст вопроса) или None: «12. Текст» → ("12", 12,
    "Текст"); «Вопрос 3 Текст», «№3. Текст», «Q3. Текст», «3 – Текст» → ("3", 3, "Текст"); «1.2. Текст?» → ("1.2", 2,
    "Текст?"); «IV. Текст» → ("4", 4, "Текст")."""
    q = QUESTION_RE.match(text)
    if q:
        for group in (1, 3, 5):
            if q.group(group):
                return q.group(group), int(q.group(group)), q.group(group + 1)
    sub = SUBNUMBER_RE.match(text)
    if sub:
        return f"{sub.group(1)}.{sub.group(2)}", int(sub.group(2)), sub.group(3)
    roman = ROMAN_QUESTION_RE.match(text)
    if roman and roman.group(1):
        value = roman_value(roman.group(1))
        return str(value), value, roman.group(2)
    return None


def roman_value(text: str) -> int:
    """«IV» → 4 (ROMAN_QUESTION_RE пропускает только правильную запись до XXXIX)."""
    total = 0
    for i, char in enumerate(text):
        value = _ROMAN_VALUES[char]
        total += -value if i + 1 < len(text) and _ROMAN_VALUES[text[i + 1]] > value else value
    return total


def _number(label: str) -> Optional[int]:
    """Номер из подписи «12» или None («①», «²» и слишком длинные строки — не номер)."""
    return int(label) if label.isdecimal() and len(label) <= 9 else None


def _visible(text: str) -> int:
    """Видимые знаки (без пробельных): str.split() режет по тем же знакам, что str.isspace()."""
    return len("".join(text.split()))


def _clean_title(text: str) -> str:
    """Название из заголовка: пробелы схлопнуты, знаки по краям срезаны, «кавычки» сняты."""
    text = " ".join(text.split()).strip(" .:;,—–-")
    quoted = _QUOTED_RE.match(text)
    if quoted:
        text = quoted.group(1).strip()
    return text[:MAX_TITLE_CHARS]


def subject_title(text: str) -> Optional[str]:
    """Название предмета, если строка — заголовок дисциплины, иначе None.

    «Дисциплина: Основы программирования» → «Основы программирования»; «Учебная дисциплина «Базы данных»» →
    «Базы данных»; «МДК 01.01 Разработка модулей» и «Модуль 2. Базы данных» — целиком (код — часть
    названия); «Тестовые задания по дисциплине «Сети»» → «Сети». Вопрос («…?») и длинная строка — не заголовок.
    """
    text = text.strip()
    if not text or len(text) > MAX_HEADING_CHARS or text.endswith("?"):
        return None
    code = SUBJECT_CODE_RE.match(text)
    if code and _LETTERS_RE.search(code.group(1)):
        return _clean_title(text)
    names = []
    word = SUBJECT_WORD_RE.match(text)
    if word:
        names.append(word.group(1))
    spaced = SUBJECT_SPACE_RE.match(text)
    if spaced and spaced.group(1)[:1].isupper():
        names.append(spaced.group(1))
    in_line = SUBJECT_IN_LINE_RE.search(text)
    if in_line:
        names.append(in_line.group(1))
    for name in names:
        title = _clean_title(name)
        if _LETTERS_RE.search(title) and not title.lower().startswith("лекци"):
            return title
    return None


def variant_number(text: str) -> Optional[int]:
    """Номер варианта теста из заголовка «Вариант 1», «ТЕСТОВЫЙ ВАРИАНТ 4», «Ключ ответов — вариант 5»."""
    match = VARIANT_RE.search(" ".join(text.split()))
    return int(match.group(1)) if match else None


def heading_kind(text: str, default: str) -> str:
    """Вид заголовка: «discipline» (предмет), «topic» («Тема 1», «Раздел 2»), «variant» («Вариант 4» — не тема:
    так подписан весь файл) или default."""
    if VARIANT_HEADING_RE.match(" ".join(text.split())):
        return "variant"
    if subject_title(text) is not None:
        return "discipline"
    if TOPIC_RE.match(text):
        return "topic"
    return default


def letters_index(token: str, count: int, style: str) -> tuple[Optional[int], bool]:
    """(индекс, неоднозначно): «б» → 1 при русских буквах вариантов, «b» → 1 при латинских, «3» → 2."""
    token = token.strip().rstrip(").")
    if not token or len(token) > 3:
        return None, False
    if token.isdecimal():
        index = int(token) - 1
        return (index if 0 <= index < count else None), False
    low = token.lower()
    if style == "lat":
        index = LAT.find(low)
        if index < 0:
            index = RUS.find(low)
        return (index if 0 <= index < count else None), False
    index = RUS.find(low)
    if index >= 0:
        return (index if index < count else None), False
    look = LOOKALIKE_UPPER.get(token) if token.isupper() else LOOKALIKE_LOWER.get(token)
    by_glyph = RUS.find(look) if look else -1
    by_order = LAT.find(low)
    glyph_ok = 0 <= by_glyph < count
    order_ok = 0 <= by_order < count
    if glyph_ok and order_ok and by_glyph != by_order:
        return by_glyph, True
    if glyph_ok:
        return by_glyph, False
    return (by_order if order_ok else None), order_ok


def mark_suffix(text: str) -> Optional[int]:
    """Где начинается маркер правильного варианта в конце текста («+», «(верно)», «✓») — или None."""
    match = MARK_SUFFIX_RE.search(text, max(0, len(text) - MARK_SUFFIX_TAIL))
    return match.start() if match else None


# Кириллица, похожая на латиницу: «А) В) С) D)» набирают как «A) B) C) D)».
LATIN_LOOKALIKE = {"а": "a", "в": "b", "с": "c", "е": "e", "н": "h", "к": "k", "м": "m", "о": "o", "р": "p", "т": "t",
                   "х": "x", "у": "y"}


def label_positions(label: str) -> set[int]:
    """Места (с 0), которые может означать подпись варианта: «3» → {2}; «в» → {2, 1} (третья русская или «b»)."""
    if label.isdecimal():
        return {int(label) - 1}
    low = label.lower()
    places = {RUS.find(low), LAT.find(low)}
    glyph = LOOKALIKE_UPPER.get(label) if label.isupper() else LOOKALIKE_LOWER.get(label)
    if glyph:
        places.add(RUS.find(glyph))
    latin = LATIN_LOOKALIKE.get(low)
    if latin:
        places.add(LAT.find(latin))
    places.discard(-1)
    return places


def labels_in_sequence(labels: list[str]) -> bool:
    """Подписи вариантов идут по порядку с первой: а, б, в… / a, b, c… / 1, 2, 3… — или числа 1…n вперемешку
    (место в порядке, MyTestX «3. март»). Только тогда подпись в тексте варианта — подпись, а не его начало («3.5»)."""
    if not labels or not all(labels):
        return False
    if all(label.isdecimal() for label in labels):
        return sorted(int(label) for label in labels) == list(range(1, len(labels) + 1))
    return all(place in label_positions(label) for place, label in enumerate(labels))


def _mono(runs: list[Run]) -> bool:
    """Весь видимый текст моноширинным шрифтом (код)."""
    visible = [run for run in runs if run.text.strip()]
    return bool(visible) and all(run.mono for run in visible)


def _mono_inside(runs: list[Run]) -> bool:
    """Часть видимого текста — моноширинным шрифтом, часть — нет: код внутри строки вопроса («Что вернёт Count()?») или
    код под вопросом в том же абзаце (строки через перенос). Строка, набранная моноширинным целиком, — шрифт файла."""
    visible = [run for run in runs if run.text.strip()]
    return any(run.mono for run in visible) and not all(run.mono for run in visible)


def _mono_any(runs: list[Run]) -> bool:
    """Хоть один видимый кусок моноширинным шрифтом (строка под вопросом)."""
    return any(run.mono for run in runs if run.text.strip())


_CYRILLIC_RE = re.compile(r"[А-Яа-яЁё]")


def _ends_with(text: str, marks: str) -> bool:
    """Последний видимый знак текста — один из marks (без копии текста: вопрос растёт строка за строкой)."""
    end = len(text)
    while end and text[end - 1].isspace():
        end -= 1
    return bool(end) and text[end - 1] in marks


def code_like(raw: str) -> bool:
    """Строка похожа на код: с отступом, со знаками кода или без русских букв («SELECT *», «x = 2 + 3 * 4»)."""
    return raw[:1] in (" ", "\t") or bool(CODE_RE.search(raw)) or not _CYRILLIC_RE.search(raw)


@dataclass
class Option:
    text: str
    label: str = ""
    runs: list[Run] = field(default_factory=list)
    images: list[str] = field(default_factory=list)  # id картинок (bank_docx), "" — картинка, которая не переносится
    formulas: int = 0
    checkbox: Optional[bool] = None
    prefix: str = ""  # подпись, срезанная с начала текста («3) »): вернётся, если подписи вариантов не по порядку
    prefix_runs: list[Run] = field(default_factory=list)

    def mark_counts(self, mark: str) -> tuple[int, int]:
        """(отмеченных видимых знаков, видимых знаков) по признаку оформления."""
        letters = marked = 0
        for run in self.runs:
            visible = _visible(run.text)
            letters += visible
            value = getattr(run, mark)
            if value and value != "none":
                marked += visible
        return marked, letters

    def share(self, mark: str) -> float:
        marked, letters = self.mark_counts(mark)
        return marked / letters if letters else 0.0


@dataclass
class Item:
    label: str
    text: str
    seq: int = 0  # порядковый номер создания: заголовки между вопросами привязаны к нему
    options: list[Option] = field(default_factory=list)
    topic: Optional[int] = None
    subject: Optional[int] = None
    explicit: Optional[str] = None
    explicit_from: str = ""
    file_explicit: Optional[str] = None  # ключ файла, который перекрыл ключ пользователя (для key_conflict)
    correct: list[int] = field(default_factory=list)
    order: list[int] = field(default_factory=list)
    pairs: list[tuple[str, str]] = field(default_factory=list)
    answer: Optional[str] = None
    marker_multi: bool = False
    evidence: str = ""
    kind: str = "single"
    flags: list[str] = field(default_factory=list)
    where: str = ""
    images: list[str] = field(default_factory=list)  # картинки вопроса: id или "" (не переносится)
    formulas: int = 0
    label_style: str = "rus"
    weights: list[float] = field(default_factory=list)  # GIFT
    inline: bool = False  # варианты вырезаны из одного абзаца
    sub_labels: list[str] = field(default_factory=list)  # format «open»: подписи строк-подпунктов в тексте
    mono: bool = False  # в тексте вопроса есть моноширинный шрифт: код (флаг «code» ответа)
    variant: Optional[int] = None  # «Вариант N» над вопросом (в файле несколько вариантов): ключ берётся из ключа варианта
    ref: Optional[tuple[int, int, int]] = None  # первая строка вопроса в документе (bank_markup: номер строки, фрагмент)
    source: str = ""  # разбор с ИИ: «rules» | «ai» | «both»
    alt: Optional[dict] = None  # разбор с ИИ: другая версия вопроса, когда правила и ИИ разошлись
    grid: bool = False  # варианты по два в строке («а) …<tab>в) …»): порядок — по буквам
    number: Optional[dict] = None  # числовой ответ (выпуск 48): {"answers": ["9.8"], "tolerance": "0.1" | None}
    # выпуск 49 (GIFT, Moodle XML)
    explanation: str = ""  # пояснение: «####…» GIFT, generalfeedback Moodle, иначе отзыв верного ответа
    gaps: list[list[str]] = field(default_factory=list)  # cloze: принимаемые формы каждого пропуска «___»
    extras: list[str] = field(default_factory=list)  # match: правые элементы без пары (лишние)

    def flag(self, name: str) -> None:
        if name not in self.flags:
            self.flags.append(name)


def take_stem_answer(item: "Item") -> None:
    """«Кто написал «Бородино»? (Ответ: б)» — ответ в скобках в конце строки вопроса: ключ строкой «Ответ:»."""
    answer = STEM_ANSWER_RE.search(item.text, max(0, len(item.text) - STEM_ANSWER_TAIL)) if "(" in item.text else None
    if answer and item.text[:answer.start()].strip() and item.explicit is None:
        item.text = item.text[:answer.start()].rstrip()
        item.explicit, item.explicit_from = answer.group(1).strip(), "answer_line"


@dataclass
class Heading:
    """Заголовок между вопросами. kind: discipline (предмет), topic («Тема…»), section (другой заголовок: тема,
    если после него нумерация не начинается заново) или line (пропущенная строка: только название предмета)."""

    seq: int
    text: str
    kind: str
    level: Optional[int] = None


def para_text(para: Para) -> str:
    return (para.label + " " if para.label else "") + para.text


def strip_runs(runs: list[Run], cut: int) -> list[Run]:
    """Куски без первых cut знаков."""
    out: list[Run] = []
    for run in runs:
        if cut >= len(run.text):
            cut -= len(run.text)
            continue
        out.append(replace(run, text=run.text[cut:]))
        cut = 0
    return out


def trim_runs(runs: list[Run], keep: int) -> list[Run]:
    """Первые keep знаков кусков."""
    out: list[Run] = []
    for run in runs:
        if keep <= 0:
            break
        out.append(replace(run, text=run.text[:keep]))
        keep -= len(run.text)
    return out


def trim_visible(runs: list[Run], keep: int) -> list[Run]:
    """Куски до keep-го видимого знака включительно: оформление следует за текстом, у которого срезан хвост."""
    out: list[Run] = []
    for run in runs:
        if keep <= 0:
            break
        count = 0
        for index, char in enumerate(run.text):
            if not char.isspace():
                count += 1
                if count == keep:
                    out.append(replace(run, text=run.text[: index + 1]))
                    return out
        out.append(run)
        keep -= count
    return out


def lead_mark(para: Para) -> Para:
    """Абзац без отметки перед вариантом (LEAD_MARK_RE): «☑ б) 90°» → «б) 90°» с флажком checkbox=True, «☐ а) 45°» →
    checkbox=False, «+в) азот» → «в) азот», отмечен. Абзац без такой отметки — как был."""
    raw = para.text
    lead = len(raw) - len(raw.lstrip())
    match = LEAD_MARK_RE.match(raw, lead) if raw[lead:lead + 1] in "-*+[☐☑☒✅□■✓✔" else None
    if not match:
        return para
    if match.group(3):
        checked = True
    elif match.group(1) is not None:
        checked = match.group(1) != " "
    else:
        checked = match.group(2) not in "☐□"
    return replace(para, runs=strip_runs(para.runs, match.end()), checkbox=checked if para.checkbox is None else para.checkbox)


def make_option(para: Para) -> Option:
    para = lead_mark(para)
    raw = para.text
    runs = list(para.runs)
    lead = len(raw) - len(raw.lstrip())
    raw, runs = raw.strip(), strip_runs(runs, lead)
    label = para.label.rstrip(".)") if para.label else ""
    prefix, prefix_runs = "", []
    match = OPTION_LABEL_RE.match(raw) if not label else None
    lone = LONE_LABEL_RE.match(raw) if not label and not match and para.images else None
    if match:
        label = match.group(1) or match.group(2)
        prefix, prefix_runs = raw[:match.end()], trim_runs(runs, match.end())
        raw, runs = raw[match.end():], strip_runs(runs, match.end())
    elif lone:  # «Б)» и картинка: вариант без текста
        label, prefix, prefix_runs, raw, runs = lone.group(1), raw, list(runs), "", []
    # «- » остаётся до разбора маркеров: в MyTestX «- » — неверный вариант, в остальных файлах — пункт списка.
    return Option(text=raw.strip(), label=label, runs=runs, images=list(para.images), formulas=para.formulas,
                  checkbox=para.checkbox, prefix=prefix, prefix_runs=prefix_runs)


def order_grid(item: Item) -> None:
    """Варианты по два в строке («а) …<tab>в) …», ниже «б) …<tab>г) …») — в порядке букв, если буквы — все с первой."""
    labels = [o.label.lower() for o in item.options]
    for alphabet in (RUS, LAT):
        places = [alphabet.find(label) if len(label) == 1 else -1 for label in labels]
        if sorted(places) == list(range(len(places))):
            item.options = [option for _, option in sorted(zip(places, item.options), key=lambda pair: pair[0])]
            return


def _label_in_place(option: Option, place: int) -> bool:
    """Подпись варианта надёжна: из нумерации Word (не из текста) или из текста, но на своём месте («в)» третьим)."""
    return not option.prefix or place in label_positions(option.label)


def restore_unordered_labels(item: Item) -> None:
    """Подписи, срезанные с текста вариантов, возвращаются в текст, если подписи вариантов не идут по порядку:
    «3.» в варианте «3) 5» среди вариантов без букв — часть текста, а не номер."""
    if not any(option.prefix for option in item.options) or labels_in_sequence([o.label for o in item.options]):
        return
    for option in item.options:
        if option.prefix:
            option.text = option.prefix + option.text
            option.runs = option.prefix_runs + option.runs
            option.label, option.prefix, option.prefix_runs = "", "", []


def _text_offset(para: Para) -> int:
    """Сдвиг от позиции в para_text(para).strip() к позиции в para.text (номер автонумерации, пробелы)."""
    full = para_text(para)
    return (len(full) - len(full.lstrip())) - (len(full) - len(para.text))


CELL_SEPARATOR_RE = re.compile(r"\s+\|\s+")  # «; » — нет: точка с запятой бывает внутри варианта на строку


def cell_pieces(para: Para) -> Optional[list[Para]]:
    """Варианты одной строкой в ячейке столбца вариантов: «митохондрия | рибосома | лизосома» —
    абзацы по одному на вариант с оформлением кусков; меньше двух частей — None."""
    text = para.text
    separators = list(CELL_SEPARATOR_RE.finditer(text))
    if not separators or len({m.group(0).strip() for m in separators}) != 1:
        return None
    bounds, start = [], 0
    for m in separators:
        bounds.append((start, m.start()))
        start = m.end()
    bounds.append((start, len(text)))
    if any(not text[a:b].strip() for a, b in bounds):
        return None
    return [Para(runs=trim_runs(strip_runs(para.runs, a), b - a), checkbox=para.checkbox) for a, b in bounds]


def split_inline(para: Para, chain: list[re.Match], text: str, offset: int = 0) -> list[Option]:
    """Варианты в одном абзаце «а) x; б) y»: куски режутся вместе с текстом, жирный остаётся у своего варианта.

    text — строка, в которой найдена цепочка; offset переводит позицию в ней в позицию в para.text.
    """
    options = []
    for i, match in enumerate(chain):
        start = match.end()
        end = chain[i + 1].start() if i + 1 < len(chain) else len(text)
        runs = trim_runs(strip_runs(para.runs, max(0, start + offset)), end - start)
        body = text[start:end].strip()
        if body.endswith((";", ",")):
            body = body[:-1].rstrip()
        options.append(Option(text=body, label=match.group(1), runs=trim_visible(runs, _visible(body))))
    return options


def inline_chain(text: str) -> Optional[list[re.Match]]:
    matches = list(INLINE_OPTION_RE.finditer(text))
    for alphabet in (RUS, LAT):
        chain: list[re.Match] = []
        for match in matches:
            if alphabet.find(match.group(1).lower()) == len(chain):
                chain.append(match)
        if len(chain) >= 2:
            return chain
    return None


@dataclass
class Line:
    offset: int
    para: Para
    text: str
    ref: Optional[tuple[int, int, int]] = None  # место в документе: (блок, строка таблицы или -1, абзац потока раскладки)


def _cell_para(cell: Cell) -> Para:
    """Ячейка одним абзацем: абзацы ячейки через перевод строки, с картинками, формулами и флажком."""
    runs: list[Run] = []
    for index, para in enumerate(cell.paras):
        if index:
            runs.append(Run(text="\n"))
        runs.extend(para.runs)
    checkbox = next((p.checkbox for p in cell.paras if p.checkbox is not None), None)
    return Para(runs=runs, shade=cell.shade, images=[key for p in cell.paras for key in p.images],
                formulas=sum(p.formulas for p in cell.paras), checkbox=checkbox)


def _column_label(index: int) -> str:
    return RUS[index] if index < len(RUS) else str(index + 1)


def unglue_key(text: str) -> str:
    """«1в2б3а» → «1в 2б 3а» (ключ слитно, по одной букве на номер); остальное — как было."""
    return GLUED_KEY_RE.sub(lambda m: " ".join(GLUED_PAIR_RE.findall(m.group(0))), text) if GLUED_KEY_RE.search(text) else text


def key_pairs(text: str) -> Optional[list[tuple[str, str]]]:
    """Пары «номер – ответ», если строка из них и состоит (первая пара — с первого знака), иначе None.

    «1 – б, 2 – а, 11 – а, б, г» → [("1", "б"), ("2", "а"), ("11", "а, б, г")]; «1б 2а 3в» → три пары.
    """
    text = unglue_key(text.strip())
    if not KEY_PAIR_START_RE.match(text):  # первая пара — с первого знака (остальную строку не смотрим зря)
        return None
    starts = list(KEY_PAIR_START_RE.finditer(text))
    pairs = []
    for i, start in enumerate(starts):
        end = starts[i + 1].start() if i + 1 < len(starts) else len(text)
        value = text[start.end():end].strip(" \t\n,;.")
        if not value:
            return None
        pairs.append((start.group(1), value))
    return pairs


def short_key(value: str) -> bool:
    """Ответ из коротких букв и чисел: «б», «а, в», «2, 4, 3, 1», «А-2, Б-3» (не слово и не фраза)."""
    tokens = [token for token in KEY_VALUE_SPLIT_RE.split(value) if token]
    return 0 < len(tokens) <= 20 and all(len(token) <= 2 and token.isalnum() for token in tokens)


def key_list_pairs(text: str, continued: bool = False) -> Optional[list[tuple[str, str]]]:
    """Строка списка ключей → пары «номер – ответ» или None.

    С заголовком: «Ключ: 1 – б, 2 – а, …», «Ответы: 1-б; 2-а», «Ключ к тесту — 1б 2а» — две пары и больше.
    Без заголовка: строка из одних пар «1б 2а 3в» с короткими ответами и номерами по возрастанию — три пары и больше
    (continued: продолжение списка ключей со строки выше — хватит одной пары).
    """
    head = KEY_LIST_HEAD_RE.match(text)
    if head:
        pairs = key_pairs(text[head.end():])
        if pairs and len(pairs) >= 2 and all(len(value) <= MAX_KEY_VALUE_CHARS for _, value in pairs):
            return pairs
        return None
    pairs = key_pairs(text)
    if not pairs or len(pairs) < (1 if continued else 3) or not all(short_key(value) for _, value in pairs):
        return None
    numbers = [int(number) for number, _ in pairs]
    if not continued and any(b <= a for a, b in zip(numbers, numbers[1:])):
        return None
    return pairs


NUMBER_CELL_RE = re.compile(r"\d{1,4}\.?")


def horizontal_keys(rows: list[list[Cell]]) -> Optional[dict[str, str]]:
    """Ключ таблицей по строкам: строка номеров («№ | 1 | 2 | 3»), под ней строка ответов («Ответ | б | а | в»);
    таких пар строк может быть несколько. Иначе None."""
    if len(rows) < 2 or len(rows) % 2:
        return None
    keys: dict[str, str] = {}
    for k in range(0, len(rows), 2):  # первая же пара строк не из номеров и ответов — не ключ (таблицу дальше не читаем)
        top, bottom = [cell.text for cell in rows[k]], [cell.text for cell in rows[k + 1]]
        numbers = [(c, text.rstrip(".")) for c, text in enumerate(top) if NUMBER_CELL_RE.fullmatch(text)]
        words = [text for text in top if text and not NUMBER_CELL_RE.fullmatch(text)]
        if len(numbers) < 2 or len(words) > 1 or (words and not HEADER_CELL_RE.match(words[0])):
            return None
        for c, number in numbers:
            value = bottom[c].strip() if c < len(bottom) else ""
            if value:
                if len(value) > MAX_KEY_VALUE_CHARS:
                    return None
                keys[number] = value
    return keys or None


# ── Читатели ────────────────────────────────────────────────────────────────────


def layout_flow(table: Table) -> list[Para]:
    """Абзацы ячеек таблицы-раскладки по порядку чтения; после каждой ячейки — пустой абзац (граница блока)."""
    flow: list[Para] = []
    for row in table.rows:
        for cell in row:
            if not cell.continuation and cell.paras:
                flow.extend(cell.paras)
                flow.append(Para())
    return flow


class KeyStore(dict):
    """Ключ файла «номер → ответ». Номер, которому файл дал два разных ответа (ключи двух вариантов без подписи варианта,
    опечатка), попадает в conflicts: такой ключ не берётся — вопрос получает key_conflict, а не ответ последней строки."""

    def __init__(self) -> None:
        super().__init__()
        self.conflicts: set[str] = set()

    def __setitem__(self, number: str, value: str) -> None:
        old = self.get(number)
        if old is not None and " ".join(old.lower().split()) != " ".join(value.lower().split()):
            self.conflicts.add(number)
        super().__setitem__(number, value)

    def update(self, pairs=(), **_) -> None:  # type: ignore[override]
        for number, value in (pairs.items() if isinstance(pairs, dict) else pairs):
            self[number] = value


class Reader:
    """Вопросы, заголовки и списки ключей, найденные в блоках.

    line_word — «абзац» (DOCX) или «строка» (текст); open_mode — format «open»: строки-варианты приклеиваются
    к тексту вопроса. Заголовки (heading) копятся событиями с seq — номером следующего вопроса; предметы и
    темы из них раскладывает _sections после чтения.
    """

    def __init__(self, line_word: str = "абзац", open_mode: bool = False, test_mode: bool = False) -> None:
        self.items: list[Item] = []
        self.headings: list[Heading] = []
        self.keys: KeyStore = KeyStore()
        self.key_lists = 0
        self.skipped: list[str] = []
        self.layouts: Counter = Counter()
        self.tables = 0
        self.table_starts: set[int] = set()  # seq первого вопроса каждой таблицы с вопросами
        self.seq = 0
        self.line_word = line_word
        self.open_mode = open_mode
        self.test_mode = test_mode  # format «test»: строки под вопросом без подписей — варианты, как раньше
        self.plus_minus = False  # абзацы файла MyTestX: варианты — строки «+ …» / «- …» (paragraphs)
        self.keyless = False  # в абзацах ни ключа, ни отметок: строки без подписи под вопросом — его текст (paragraphs)
        self.has_tables = False  # в документе есть таблицы (ключ таблицей может стоять после абзацев): keyless не ставится
        self.variant: Optional[int] = None  # «Вариант 4» в заголовке файла: по нему берётся раздел файла ключей
        self.current_variant: Optional[int] = None  # последний заголовок «Вариант N» над вопросами
        self.variant_keys: dict[int, KeyStore] = {}  # ключ по вариантам в самом файле («Вариант 2: 1а 2б», столбцы)
        self.pictures: dict[str, tuple[str, bytes]] = {}  # картинки DOCX: id → (тип, байты) (bank_docx.read_docx)
        self.block = 0  # номер блока документа, который читается сейчас (таблица)
        self.blocks: list = []  # блоки документа (read_bank): строки фрагментов и разбор с ИИ
        self.table_kinds: dict[int, bool] = {}  # блок-таблица → раскладка страницы (layout_table): markup не считает заново
        self.row_index: dict[int, int] = {}

    def heading(self, text: str, default: str, level: Optional[int] = None) -> None:
        title = " ".join(text.split())
        if title:
            kind = heading_kind(title, default)
            if kind == "variant":
                number = variant_number(title)
                if self.variant is None:
                    self.variant = number
                self.current_variant = number
            self.headings.append(Heading(seq=self.seq, text=title[:MAX_TITLE_CHARS], kind=kind, level=level))

    def skip(self, text: str) -> None:
        if len(self.skipped) < MAX_SKIPPED:
            self.skipped.append(text[:SKIPPED_CHARS])
        self.heading(text, "line")  # пропущенная строка может оказаться названием предмета

    def where(self, line: Line) -> str:
        return f"{self.line_word} {line.offset + 1}"

    def new_item(self, label: str, text: str, where: str, ref: Optional[tuple[int, int, int]] = None) -> Item:
        item = Item(label=label, text=text.strip(), seq=self.seq, where=where, variant=self.current_variant, ref=ref)
        take_stem_answer(item)
        self.seq += 1
        self.items.append(item)
        return item

    # — списки ключей —

    def key_line(self, text: str, keys: Optional[dict[str, str]] = None) -> int:
        """Пары «номер – ответ» строки ключа в keys (по умолчанию — общий ключ файла); сколько найдено."""
        keys = self.keys if keys is None else keys
        text = unglue_key(text)
        starts = list(KEY_PAIR_START_RE.finditer(text))
        found = 0
        for i, start in enumerate(starts):
            end = starts[i + 1].start() if i + 1 < len(starts) else len(text)
            value = text[start.end():end].strip(" ,;.")
            if value:
                keys[start.group(1)] = value
                found += 1
        return found

    # — таблицы —

    def table(self, table: Table, index: int = 0) -> None:
        """Таблица — блок index документа."""
        self.tables += 1
        self.block = index
        first_seq = self.seq
        layout = self.layout_table(table)
        self.table_kinds[index] = layout
        if layout:
            # таблица — раскладка страницы (две колонки, рамка): её ячейки читаются абзацами по порядку
            self.layouts["table_layout"] += 1
            flow = layout_flow(table)
            self.paragraphs(flow, index, [(index, -1, k) for k in range(len(flow))])
        else:
            self._table(table, table.title or f"таблица {self.tables}")
        if self.seq > first_seq:
            self.table_starts.add(first_seq)

    @staticmethod
    def layout_table(table: Table) -> bool:
        """Таблица в один-три столбца, где в ячейке целые вопросы: строка «N. Вопрос?» и под ней варианты с буквами — не
        таблица вопросов, а раскладка страницы (вопросы 1–4 слева, 5–8 справа; вопрос в рамке)."""
        if not table.rows or max(len(row) for row in table.rows) > 3:
            return False
        numbered = whole = 0
        for row in table.rows:
            for cell in row:
                if cell.continuation:
                    continue
                texts = [para_text(p).strip() for p in cell.paras]
                questions = sum(1 for p, text in zip(cell.paras, texts) if p.level in (None, 0) and question_number(text)
                                and (text.endswith(("?", ":", "…")) or len(text) > 40))
                options = sum(1 for p, text in zip(cell.paras, texts)
                              if (m := OPTION_LABEL_RE.match(text)) is not None and m.group(1) or (p.level or 0) >= 1)
                numbered += questions
                whole += 1 if questions and options >= 2 else 0
        return numbered >= 2 and whole >= 1

    def _table(self, table: Table, title: str) -> None:
        self.row_index = {id(row): r for r, row in enumerate(table.rows)}  # строка таблицы → её место (ref вопроса)
        numbers = table.numbers or list(range(1, len(table.rows) + 1))
        rows = [(number, row) for number, row in zip(numbers, table.rows) if any(cell.text for cell in row)]
        if not rows:
            return
        by_variant = variant_columns([row for _, row in rows])
        if by_variant:  # ключ таблицей «№ | Вариант 1 | Вариант 2» в самом файле с вариантами
            self.key_lists += 1
            for section in by_variant:
                self.variant_keys.setdefault(section["variant"], KeyStore()).update(section["keys"])
            return
        across = horizontal_keys([row for _, row in rows])
        if across:  # «№ | 1 | 2 | 3» над «Ответ | б | а | в»
            self.key_lists += 1
            self.keys.update(across)
            return
        if self._stem_rows(rows, title):
            return
        roles = None
        for h in range(min(HEADER_SCAN, len(rows))):
            heads = [" ".join(cell.text.split()) for cell in rows[h][1] if cell.text]
            if len(heads) < 2 or not all(HEADER_CELL_RE.match(text) for text in heads):
                continue
            found = self.header_roles(rows[h][1])
            if h and (found.get("question") is None or not (found.get("option_cols") or found.get("options") is not None)):
                continue  # ниже первой строки шапкой считается только строка с вопросом и вариантами
            for _, row in rows[:h]:  # название и подсказка над шапкой выгрузки
                for cell in row:
                    if cell.text and not cell.continuation:
                        self.skip(cell.text)
            roles, rows = found, rows[h + 1:]
            break
        if not rows:
            return
        if roles is None:
            roles = self.guess_roles([row for _, row in rows])
        if roles.get("key_table"):
            self.key_lists += 1
            for _, row in rows:  # «№ | Ответ», и «№ | Ответ | № | Ответ» — пары ячеек слева направо
                texts = [cell.text for cell in row]
                c = 0
                while c + 1 < len(texts):
                    if NUMBER_CELL_RE.fullmatch(texts[c]) and texts[c + 1]:
                        self.keys[texts[c].rstrip(".")] = texts[c + 1]
                        c += 2
                    else:
                        c += 1
            return
        current: Optional[Item] = None
        num_col, q_col, opt_col, key_col = roles.get("number"), roles.get("question"), roles.get("options"), roles.get("key")
        option_cols = roles.get("option_cols") or []
        option_labels = roles.get("option_labels") or {}
        listed = False

        def filled(cells: list[Cell], col: Optional[int]) -> bool:
            return col is not None and col < len(cells) and not cells[col].continuation and bool(cells[col].text.strip())

        # строки с вариантом без вопроса — вариант на строку: « | » внутри ячейки — часть варианта (код, вывод программы)
        option_rows = opt_col is not None and opt_col != q_col and any(
            filled(cells, opt_col) and not filled(cells, q_col) for _, cells in rows)
        for row_number, cells in rows:
            live = [(c, cell) for c, cell in enumerate(cells) if cell.text and not cell.continuation]
            if not live:
                continue
            lone = live[0][1] if len(live) == 1 else None
            pairs = key_list_pairs(" ".join(lone.text.split())) if lone is not None else None
            if pairs:  # строка таблицы «Ключ: 1 – б, 2 – а, …»
                self.key_lists += 0 if listed else 1
                listed = True
                self.keys.update(pairs)
                current = None
                continue
            if lone is not None and (lone.span > 1 or TOPIC_RE.match(lone.text) or subject_title(lone.text) is not None
                                     or (len(cells) > 2 and live[0][0] == 0 and not lone.text.isdecimal())):
                self.heading(lone.text, "section")
                current = None
                continue

            def cell_at(col: Optional[int]) -> Optional[Cell]:
                return cells[col] if col is not None and col < len(cells) and not cells[col].continuation else None

            number_cell, question_cell = cell_at(num_col), cell_at(q_col)
            number = number_cell.text.strip().rstrip(".") if number_cell and number_cell.text else ""
            starts = bool(question_cell and question_cell.text) or _number(number) is not None
            if starts and current is not None and number and LONE_LABEL_RE.match(number + (")" if number[-1].isalpha() else "")):
                starts = False  # «а) | вариант»: в столбце номера — буква варианта, строка — вариант текущего вопроса
            if starts:
                text = question_cell.text if question_cell else ""
                current = self.new_item(number, text, f"{title}, строка {row_number}", (self.block, self.row_index.get(id(cells), -1), 0))
                if question_cell:
                    current.images += [key for p in question_cell.paras for key in p.images]
                    current.formulas += sum(p.formulas for p in question_cell.paras)
                    stem_paras = question_cell.paras[:1] if q_col == opt_col else question_cell.paras
                    current.mono = bool(stem_paras) and (_mono_inside(stem_paras[0].runs)
                                                         or any(_mono_any(p.runs) for p in stem_paras[1:]))
                    if q_col == opt_col:  # вопрос и варианты в одной ячейке: первый абзац — вопрос
                        current.text = question_cell.paras[0].text.strip()
            if current is None:
                continue
            had = len(current.options)
            if option_cols:
                for k, c in enumerate(option_cols):
                    if c < len(cells) and cells[c].text:
                        para = _cell_para(cells[c])
                        if self.open_mode:
                            self.add_option(current, replace(para, runs=[Run(text=f"{_column_label(k)}) "), *para.runs]))
                            continue
                        option = make_option(para)
                        option.label = option.label or option_labels.get(c) or _column_label(k)
                        current.options.append(option)
                self.layouts["table_option_columns"] += 1
            else:
                option_cell = cell_at(opt_col)
                if option_cell is not None and option_cell.text:
                    paras = [p for p in option_cell.paras if p.text.strip() or p.images]
                    if q_col == opt_col and starts:
                        paras = paras[1:]
                    if len(paras) > 1:
                        self.layouts["table_options_in_cell"] += 1
                        for para in paras:
                            self.add_option(current, para)
                    elif paras:
                        chain = inline_chain(paras[0].text) if not self.open_mode else None
                        pieces = cell_pieces(paras[0]) if opt_col != q_col and starts and not chain and not option_rows else None
                        if chain and starts:
                            self.layouts["table_options_in_cell"] += 1
                            current.options.extend(split_inline(paras[0], chain, paras[0].text))
                            current.inline = True
                        elif pieces:
                            self.layouts["table_options_in_cell"] += 1
                            for piece in pieces:
                                self.add_option(current, piece)
                        else:
                            self.layouts["table_option_rows"] += 1
                            self.add_option(current, paras[0])
            key_cell = cell_at(key_col)
            if key_cell is not None and key_cell.text:
                if MARK_CELL_RE.match(key_cell.text.strip()) and not option_cols and len(current.options) == had + 1:
                    # вариант на строку, в столбце ключа «+» у верного варианта
                    current.correct.append(had)
                    current.evidence = "key_column"
                    current.marker_multi = len(current.correct) > 1
                else:
                    current.explicit, current.explicit_from = key_cell.text, "key_column"
            type_cell = cell_at(roles.get("type"))
            if type_cell is not None and FILL_TYPE_RE.search(type_cell.text) and current.options and not current.correct:
                # «Fill-in-the-Blank»: в первом столбце вариантов — ответ, а не вариант
                current.answer, current.evidence = current.options[0].text, "key_column"
                current.options, current.kind, current.explicit = [], "open", None

    @staticmethod
    def _live(cells: list[Cell]) -> list[tuple[int, Cell]]:
        return [(c, cell) for c, cell in enumerate(cells)
                if (cell.text or any(p.images for p in cell.paras)) and not cell.continuation]

    @classmethod
    def _stem(cls, cells: list[Cell], expected: Optional[int] = None) -> Optional[tuple[str, int, str]]:
        """Строка вопроса на всю ширину таблицы: одна живая ячейка шире столбца, первый абзац — «N.Вопрос».
        «86.17. Вопрос» — вопрос 86 со старым номером 17 из другого списка (так в файле владельца): номером берётся
        тот, что продолжает нумерацию (expected), иначе первый."""
        live = cls._live(cells)
        if len(live) != 1 or live[0][1].span < 2 or not live[0][1].paras:
            return None
        text = live[0][1].paras[0].text.strip()
        bare = NUMBER_ONLY_RE.match(text)
        if bare and any(p.images for p in live[0][1].paras):
            return bare.group(1), int(bare.group(1)), ""
        double = DOUBLE_NUMBER_RE.match(text)
        if double:
            first, second = int(double.group(1)), int(double.group(2))
            if expected is None or expected in (first, second):
                number = second if expected == second and expected != first else first
                return str(number), number, double.group(3)
        return question_number(text)

    @classmethod
    def _option_row(cls, cells: list[Cell]) -> bool:
        """Ряд вариантов под строкой вопроса: две и больше ячеек по одному столбцу, первая — не номер."""
        live = cls._live(cells)
        return len(live) >= 2 and all(cell.span == 1 for _, cell in live) \
            and not NUMBER_CELL_RE.fullmatch(live[0][1].text.strip())

    def _stem_rows(self, rows: list[tuple[int, list[Cell]]], title: str) -> bool:
        """Файлы колледжа «Вариант 4» (владелец, 2026-10-14): строка «1.Вопрос» объединена на всю ширину, под ней ряд
        ячеек «А)…», «Б)…». Без этого прохода строка вопроса читалась заголовком темы, а ряд вариантов — вопросом.
        Узнаётся по парам «строка вопроса → ряд вариантов»: не меньше двух, и вместе они занимают большую часть строк."""
        pairs = sum(1 for (_, a), (_, b) in zip(rows, rows[1:]) if self._stem(a) and self._option_row(b))
        if pairs < 2 or pairs * 2 < len(rows) * 0.6:
            return False
        current: Optional[Item] = None
        expected: Optional[int] = None
        for row_number, cells in rows:
            stem = self._stem(cells, expected)
            if stem is not None:
                label, number, first = stem
                expected = number + 1
                cell = self._live(cells)[0][1]
                rest = [p.text.strip() for p in cell.paras[1:] if p.text.strip()]
                current = self.new_item(label, "\n".join([first.strip(), *rest]), f"{title}, строка {row_number}",
                                        (self.block, self.row_index.get(id(cells), -1), 0))
                current.images += [key for p in cell.paras for key in p.images]
                current.formulas += sum(p.formulas for p in cell.paras)
                current.mono = _mono_inside(cell.paras[0].runs) or any(_mono_any(p.runs) for p in cell.paras[1:])
                continue
            live = self._live(cells)
            if len(live) == 1 and live[0][1].span > 1:  # строка на всю ширину без номера — тема
                self.heading(live[0][1].text, "section")
                current = None
                continue
            if current is None or not live:
                continue
            for _, cell in live:  # варианты; ряд может продолжаться на следующей строке
                option = make_option(_cell_para(cell))
                option.label = option.label or _column_label(len(current.options))
                current.options.append(option)
            self.layouts["table_stem_rows"] += 1
        return True

    @staticmethod
    def header_roles(row: list[Cell]) -> dict:
        roles: dict = {"option_cols": []}
        for c, cell in enumerate(row):
            text = " ".join(cell.text.lower().split())
            if not text:
                continue
            if re.match(r"^(?:question\s+type|type|тип(?:\s+вопроса)?)$", text):
                roles["type"] = c
            elif (text.startswith("№") or text in ("n", "no", "no.", "п/п", "#") or text.startswith("номер")) \
                    and not re.search(r"(?:верн|правильн)\w*\s+(?:ответ|вариант)", text):
                roles.setdefault("number", c)
            elif re.match(r"^(?:правильн|верн|ключ|эталон|correct|right\s+answer)", text) or text in ("ответ", "ответ:") \
                    or re.match(r"^(?:№|номер)\w*\s+(?:верн|правильн)\w*\s+(?:ответ|вариант)", text) \
                    or re.match(r"^ответ\s*\(", text):
                roles["key"] = c
            elif re.match(r"^(?:вариант\w*\s+ответ|ответы|варианты|дистрактор)", text) or text in ("вариант", "answers", "options"):
                roles["options"] = c
            elif re.match(r"^(?:[а-еa-e]|[1-8]|(?:вариант|answer|option|choice|ответ)\s*(?:\d|[a-hа-з](?![a-zа-яё])).*)$", text):
                roles["option_cols"].append(c)
                letter = re.search(r"(?:^|\s)([a-hа-з]|\d)$", text)  # «Вариант B», «Answer 2»: подпись варианта — из шапки
                if letter:
                    roles.setdefault("option_labels", {})[c] = letter.group(1)
            elif re.match(r"^(?:вопрос|содержани|задани|формулировк|текст|тестов|утверждени|question)", text):
                roles.setdefault("question", c)
        if "number" in roles and "question" not in roles and roles.get("key") is not None and "options" not in roles \
                and not roles["option_cols"]:
            roles["key_table"] = True
        if "options" not in roles and not roles["option_cols"] and "question" in roles:
            roles["options"] = roles["question"]
        return roles

    @staticmethod
    def guess_roles(rows: list[list[Cell]]) -> dict:
        width = max(len(row) for row in rows)
        numeric = [sum(1 for row in rows if c < len(row) and re.fullmatch(r"\d{1,4}\.?", row[c].text or "")) for c in range(width)]
        roles: dict = {"option_cols": []}
        if width == 2 and numeric[0] >= len(rows) * 0.8 and all(len(row[1].text) <= 16 for row in rows if len(row) > 1):
            return {"number": 0, "key": 1, "key_table": True}
        columns = Reader.option_columns(rows, width, 1 if numeric[0] >= len(rows) * 0.8 else 0)
        if columns:
            return columns
        if width >= 2 and numeric[0] >= len(rows) * 0.15:
            roles.update(number=0, question=1, options=2 if width >= 3 else 1)
        else:
            roles.update(question=0, options=1 if width >= 2 else 0)
        return roles

    @staticmethod
    def option_columns(rows: list[list[Cell]], width: int, start: int) -> Optional[dict]:
        """Варианты по столбцам без шапки: за столбцом вопроса (и номера) — три столбца и больше, где почти в каждой
        строке по одному короткому абзацу. Последний такой столбец из одних букв, цифр и «+» — столбец ключа."""
        if width - start < 4:
            return None

        def single(row: list[Cell], c: int) -> bool:
            return c < len(row) and bool(row[c].text) and not row[c].continuation and len(row[c].paras) <= 1 \
                and len(row[c].text) <= MAX_OPTION_CHARS

        cols = []
        for c in range(start + 1, width):
            if sum(1 for row in rows if single(row, c)) < len(rows) * 0.8:
                break
            cols.append(c)
        if len(cols) < 3 or not all(start < len(row) and row[start].text for row in rows):
            return None
        roles: dict = {"question": start, "option_cols": cols}
        if start:
            roles["number"] = 0
        last = cols[-1]
        if len(cols) >= 4 and all(last >= len(row) or not row[last].text or re.fullmatch(r"[А-Иа-иA-Ha-h1-8+,; ]{1,6}", row[last].text)
                                  for row in rows):
            roles["key"], roles["option_cols"] = last, cols[:-1]
        return roles

    # — абзацы —

    def add_option(self, item: Item, para: Para) -> None:
        text = para_text(para).strip()
        if not text and para.images:
            target = item.options[-1] if item.options else None
            if target is None:
                item.images += para.images
            else:
                target.images += para.images
            return
        if self.open_mode:
            # format «open»: строка-вариант — часть текста вопроса, как написана
            label = OPTION_LABEL_RE.match(text)
            if label or para.label:
                item.sub_labels.append(para.label.rstrip(".)") if para.label else (label.group(1) or label.group(2)))
            if len(item.text) < GROW_QUESTION_CHARS:
                item.text = f"{item.text}\n{text}" if item.text else text
            item.images += para.images
            item.formulas += para.formulas
            return
        if not item.options and not para.label:
            chain = inline_chain(text)
            if chain and chain[0].start() == 0:  # «а) 45°; б) 90°; в) 120°» строкой под вопросом
                item.options.extend(split_inline(para, chain, text, _text_offset(para)))
                item.inline = True
                self.layouts["inline_options"] += 1
                return
        if not para.label and OPTION_LABEL_RE.match(text) and (not item.options or all(o.label for o in item.options)):
            parts = self.grid_parts(para, text)
            if parts:  # «а) 180<tab>в) 360»: варианты по два в строке
                item.options.extend(make_option(part) for part in parts)
                item.grid = True
                return
        if self.continues(item, para, text):
            last = item.options[-1]  # перенос варианта: буква (или «+»/«-») стоит только на первой строке
            if len(last.text) < GROW_OPTION_CHARS:
                last.text = f"{last.text} {text}".strip()
                last.runs.append(Run(text=" "))
                last.runs.extend(para.runs)
            item.flag("joined_lines")
            return
        item.options.append(make_option(para))

    @staticmethod
    def grid_parts(para: Para, text: str) -> Optional[list[Para]]:
        """Строка из нескольких вариантов с подписями через табуляцию или два пробела → абзацы вариантов (с оформлением)."""
        starts, ends = [0], []
        for label in GRID_LABEL_RE.finditer(text):
            before = text[starts[-1]:label.start()]
            gap = len(before) - len(before.rstrip(" \t\u00a0"))
            if "\t" in before[len(before) - gap:] or gap >= 2:
                ends.append(label.start() - gap)
                starts.append(label.start())
        if not ends:
            return None
        ends.append(len(text))
        offset = _text_offset(para)
        bounds = starts
        parts = []
        for start, end in zip(bounds, ends):
            piece = text[start:end]
            if not OPTION_LABEL_RE.match(piece.strip()):
                return None
            parts.append(Para(runs=trim_runs(strip_runs(para.runs, start + offset), end - start), checkbox=para.checkbox))
        return parts

    def continues(self, item: Item, para: Para, text: str) -> bool:
        """Строка без подписи после вариантов — перенос последнего варианта: у вариантов есть буквы (подпись последнего
        из текста — на своём месте: «в)» третьим) или это файл «+»/«-» и последний вариант отмечен."""
        if not item.options or para.label or (para.level or 0) or OPTION_LABEL_RE.match(text) or BULLET_RE.match(text) \
                or PLUSMINUS_RE.match(text) or (GLUED_MARK_RE.match(text) and not _mono(para.runs)) \
                or (para.images and LONE_LABEL_RE.match(text)):
            return False
        if self.plus_minus and PLUSMINUS_RE.match(item.options[-1].text):
            return True
        last = len(item.options) - 1
        if item.options[last].label:
            return _label_in_place(item.options[last], last)
        return any(option.label and _label_in_place(option, k) for k, option in enumerate(item.options))

    @staticmethod
    def _title_like(text: str) -> bool:
        """Строка шапки, которая может повториться колонтитулом: не короткая, не вопрос, не заголовок темы или варианта."""
        return len(text) >= 12 and not text.endswith(("?", ":")) and heading_kind(text, "line") == "line" \
            and not KEY_HEADING_RE.match(text) and not OPTION_LABEL_RE.match(text)

    @staticmethod
    def furniture(lines: list[Line], i: int, titles: set[str], moodle: bool) -> bool:
        """Строка не из вопросов: колонтитул («Страница 3 из 10», номер страницы между пустыми строками, шапка файла,
        повторённая на новой странице) или служебная строка страницы попытки Moodle («Отметить вопрос», «Баллов: …»)."""
        text = lines[i].text
        if PAGE_LINE_RE.match(text) or (moodle and MOODLE_CHROME_RE.match(text)):
            return True
        if text.isdecimal() and len(text) <= 3 and (i == 0 or not lines[i - 1].text):
            after = lines[i + 1].text if i + 1 < len(lines) else ""
            return not after or after in titles
        if text not in titles:
            return False
        before = lines[i - 1].text if i else ""
        after = lines[i + 1].text if i + 1 < len(lines) else ""
        return not before or (before.isdecimal() and len(before) <= 3) or not after

    def _key_variant_line(self, lines: list[Line], i: int, in_key: str) -> Optional[tuple[int, Optional[list]]]:
        """«Вариант 2: 1а 2б 3в», «Ключ к варианту 2 — 1-а …» → (вариант, пары); «Вариант 2» в ключе, а под ним пары →
        (вариант, None). Иначе None."""
        head = VARIANT_KEY_RE.match(" ".join(lines[i].text.split()))
        if not head:
            return None
        rest = head.group(2).strip()
        if rest:
            pairs = key_list_pairs(rest, continued=True)
            return (int(head.group(1)), pairs) if pairs and (in_key or len(pairs) >= 2) else None
        if not in_key:
            return None
        following = next((line.text for line in lines[i + 1: i + 4] if line.text), "")
        return (int(head.group(1)), None) if key_list_pairs(following, continued=True) else None

    def paragraphs(self, paras: list[Para], start_index: int, refs: Optional[list[tuple[int, int, int]]] = None) -> None:
        """Абзацы подряд: start_index — номер блока первого из них (refs — места абзацев потока таблицы-раскладки)."""
        paras = [lead_mark(p) for p in paras]
        lines = [Line(start_index + i, p, para_text(p).strip(), refs[i] if refs else (start_index + i, -1, 0))
                 for i, p in enumerate(paras)]
        moodle = sum(1 for line in lines if MOODLE_MARK_RE.match(line.text)) >= 2
        first_question = next((i for i, line in enumerate(lines) if line.text and line.para.level in (None, 0)
                               and (question_number(line.text) or QUESTION_NUMBER_RE.match(line.text))), len(lines))
        titles = {line.text for line in lines[:first_question] if line.text and self._title_like(line.text)}
        body: list[Line] = []
        in_key = ""  # «heading» — после строки «Ключ» / «Ответы»; «line» — после строки «Ключ: 1 – б, 2 – а, …»
        key_variant: Optional[int] = None  # ключ какого варианта идёт («Вариант 2» в ключе)
        for i, line in enumerate(lines):
            text = line.text
            mono = _mono(line.para.runs)
            if text and not mono and i > first_question and self.furniture(lines, i, titles, moodle):
                continue
            keyed = self._key_variant_line(lines, i, in_key) if text and not mono and "ариант" in text else None
            if keyed is not None:
                key_variant, pairs = keyed
                self.key_lists += 0 if in_key else 1
                in_key = "line" if pairs else "heading"
                if pairs:
                    self.variant_keys.setdefault(key_variant, KeyStore()).update(pairs)
                continue
            # список ключей одной строкой (или несколькими: продолжение — строки из одних пар)
            pairs = key_list_pairs(text, continued=in_key == "line") if text and not mono else None
            if pairs:
                self.key_lists += 0 if in_key else 1
                in_key = "line"
                (self.variant_keys.setdefault(key_variant, KeyStore()) if key_variant is not None else self.keys).update(pairs)
                continue
            if text and KEY_HEADING_RE.match(text):
                in_key = "heading"
                key_variant = None
                self.key_lists += 1
                continue
            if text and not mono:
                if in_key == "heading" and self.key_line(text, self.variant_keys.setdefault(key_variant, KeyStore())
                                                         if key_variant is not None else None):
                    continue
                in_key = ""
                key_variant = None
            body.append(line)
        self.plus_minus = self.marked_lines(body)
        self.keyless = not self.test_mode and not self.has_tables and self.no_key_anywhere(body)
        if self.block_mode(body):
            self.read_blocks(body)
        else:
            self.read_numbered(body)

    @staticmethod
    def marked_lines(body: list[Line]) -> bool:
        """Файл MyTestX: строки «+ …» и «- …» (по две и больше) — заметная доля непустых строк."""
        signs: Counter = Counter()
        filled = 0
        for line in body:
            if line.text:
                filled += 1
                m = PLUSMINUS_RE.match(line.text)
                if m:
                    signs[m.group(1)] += 1
        return signs["+"] >= 2 and signs["-"] >= 2 and signs["+"] + signs["-"] >= 0.3 * filled

    def no_key_anywhere(self, body: list[Line]) -> bool:
        """Ни списка ключей, ни строки «Ответ: …», ни маркеров («+ …», «*верно», «(верно)», флажки), ни отметки
        оформлением в строках после первого вопроса (кроме заголовков и кода): файл без ключа — список вопросов."""
        if self.keys or self.plus_minus:
            return False
        started = False
        for line in body:
            text, para = line.text, line.para
            if not text:
                continue
            if para.level in (None, 0) and question_number(text):
                started = True
                continue
            if ANSWER_RE.match(text) or para.checkbox is not None or mark_suffix(text) is not None \
                    or (text[:1] == "+" and PLUSMINUS_RE.match(text)):
                return False
            glued = GLUED_MARK_RE.match(text) and text[1:2].isalnum() and not CODE_RE.search(text)  # «*верно», не «*)»
            styled = any(run.bold or run.underline or run.italic or run.highlight or run.color or run.shade for run in para.runs)
            if not started or not (glued or styled) or _mono(para.runs) or self.heading_line(line) is not None:
                continue
            if glued:
                return False
            visible = _visible(para.text)
            for signal in FORMAT_SIGNALS:
                marked = sum(_visible(run.text) for run in para.runs if getattr(run, signal) and getattr(run, signal) != "none")
                if marked and marked >= MARK_SHARE * visible:
                    return False
        return True

    @staticmethod
    def blocks_of(body: list[Line]) -> list[list[Line]]:
        blocks: list[list[Line]] = [[]]
        for line in body:
            if not line.text and not line.para.images:
                if blocks[-1]:
                    blocks.append([])
                continue
            blocks[-1].append(line)
        return [block for block in blocks if block]

    def block_mode(self, body: list[Line]) -> bool:
        blocks = self.blocks_of(body)
        if len(blocks) < 3:
            return False
        sizes = sorted(len(block) for block in blocks)
        median = sizes[len(sizes) // 2]
        heads = sum(1 for block in blocks if not OPTION_LABEL_RE.match(block[0].text) and not PLUSMINUS_RE.match(block[0].text))
        return 2 <= median <= 12 and heads >= len(blocks) * 0.7

    def heading_line(self, line: Line) -> Optional[str]:
        """Вид заголовка, если строка — заголовок (предмет, «Тема…», заголовок Word), иначе None."""
        text, para = line.text, line.para
        if (para.level in (None, 0) and question_number(text)) or QUESTION_NUMBER_RE.match(text) or para.checkbox is not None:
            return None  # строка с флажком — вариант («☐ Вариант 1»), а не заголовок
        kind = heading_kind(text, "section")
        if kind == "topic":
            return kind
        if kind in ("discipline", "variant") and not self.option_like(line):
            return kind
        if para.outline is not None and not self.option_like(line):
            return kind
        return None

    def code_gaps(self, blocks: list[list[Line]]) -> list[list[Line]]:
        """Пустая строка внутри кода под вопросом делит блок надвое: блоки склеиваются обратно (с пустой строкой),
        если в первом ещё нет вариантов и он кончается кодом, а второй начинается кодом (не вопросом и не
        заголовком) и в нём есть варианты."""
        def code(line: Line) -> bool:  # строка кода, а не вопрос («Что вернёт items?.Count?» — вопрос)
            return not line.text.endswith("?") and (_mono(line.para.runs) or code_like(line.para.text))

        out: list[list[Line]] = []
        for block in blocks:
            previous = out[-1] if out else None
            if previous and len(previous) >= 2 and code(previous[-1]) and code(block[0]) \
                    and not question_number(block[0].text) and self.heading_line(block[0]) is None \
                    and not any(self.option_start(line) for line in previous) and any(self.option_start(line) for line in block):
                out[-1] = previous + [Line(previous[-1].offset + 1, Para(), "")] + block
            else:
                out.append(block)
        return out

    def read_blocks(self, body: list[Line]) -> None:
        self.layouts["blocks"] += 1
        for block in self.code_gaps(self.blocks_of(body)):
            first = 0
            while first < len(block) and block[first].text and self.heading_line(block[first]):
                self.heading(block[first].text, "section", block[first].para.outline)
                first += 1
            if first >= len(block):
                continue
            head = block[first]
            rest = block[first + 1:]
            alone = QUESTION_NUMBER_RE.match(head.text) if head.para.level in (None, 0) else None
            if alone and rest:  # «Вопрос 3» строкой, текст вопроса — следующей
                head, rest = rest[0], rest[1:]
            q = question_number(head.text) if head.para.level in (None, 0) and not alone else None
            label, text = (q[0], q[2]) if q else (alone.group(1) if alone else "", head.text)
            marked_at = next((k for k, line in enumerate(rest) if PLUSMINUS_RE.match(line.text)), 0) if self.plus_minus else 0
            mono = _mono_inside(head.para.runs)
            if marked_at:
                # «+»/«-»: варианты — только отмеченные строки; строки до первой из них — текст вопроса (код как написан)
                for line in rest[:marked_at]:
                    if len(text) < GROW_QUESTION_CHARS:
                        text = f"{text}\n{line.para.text.rstrip()}"
                        mono = mono or _mono_any(line.para.runs)
                rest = rest[marked_at:]
            # текст вопроса может идти в несколько строк до первой строки, похожей на вариант
            labelled_later = any(OPTION_LABEL_RE.match(line.text) or PLUSMINUS_RE.match(line.text) for line in rest)
            skip = 0
            while labelled_later and len(rest) - skip > 2 and not self.option_like(rest[skip]) \
                    and not ANSWER_RE.match(rest[skip].text):
                line = rest[skip]
                if CHOOSE_ONE_RE.match(line.text):
                    skip += 1  # «Выберите один правильный ответ:» — подсказка, не текст вопроса
                    continue
                if (line.text or not line.para.images) and len(text) < GROW_QUESTION_CHARS:
                    raw = line.para.text.rstrip()  # код (моноширинный или похожий на код) — с отступами
                    text = f"{text}\n{raw if _mono(line.para.runs) or code_like(raw) else line.text}"
                    mono = mono or _mono_any(line.para.runs)
                skip += 1
            rest = rest[skip:]
            if not rest:
                if label or head.text.endswith(("?", ":", "…")):
                    self.new_item(label, text, self.where(head), head.ref).mono = mono  # вопрос без вариантов: открытый
                else:
                    self.skip(head.text)
                continue
            item = self.new_item(label or (head.para.label.rstrip(".") if head.para.label else ""), text, self.where(head), head.ref)
            item.mono = mono
            item.images += head.para.images
            item.formulas += head.para.formulas
            if not self.open_mode:
                open_lines = [OPEN_LINE_RE.match(line.text) for line in rest]
                pair_lines = [PAIR_LINE_RE.match(line.text) for line in rest]
                if all(open_lines) and len(rest) <= 3:
                    item.answer = "; ".join((m.group(1) or m.group(2)).strip() for m in open_lines)
                    item.kind = "open"
                    continue
                if len(rest) >= 2 and all(pair_lines) and not any(PLUSMINUS_RE.match(line.text) for line in rest):
                    item.pairs = [((m.group(1) or "").strip(), m.group(2).strip()) for m in pair_lines]
                    item.kind = "match"
                    continue
            for line in rest:
                answer = ANSWER_RE.match(line.text)
                if answer:
                    item.explicit, item.explicit_from = answer.group(1).strip(), "answer_line"
                    continue
                self.add_option(item, line.para)
            header = not label and not item.explicit and not head.text.endswith(("?", ":"))
            if header and (self.open_mode or len(item.options) < 2):
                self.items.pop()  # блок-шапка, не вопрос
                for line in block[first:]:
                    self.skip(line.text)

    @staticmethod
    def option_like(line: Line) -> bool:
        """Строка похожа на вариант или ответ: подпись, «+»/«-», маркер «*»/«#», знак списка, уровень списка Word,
        «[ответ]» / «= ответ». Код (моноширинный) маркером «#», «*» и «[…]» не бывает: «#include», «[Serializable]»."""
        text = line.text
        if OPTION_LABEL_RE.match(text) or PLUSMINUS_RE.match(text) or BULLET_RE.match(text) or (line.para.level or 0) >= 1 \
                or line.para.checkbox is not None:
            return True
        if line.para.images and LONE_LABEL_RE.match(text):  # «Б)» и картинка
            return True
        return not _mono(line.para.runs) and bool(GLUED_MARK_RE.match(text) or OPEN_LINE_RE.match(text))

    def option_start(self, line: Line) -> bool:
        """Строка, с которой начинаются варианты вопроса: буква («а)», «b.»), пункт списка Word второго уровня,
        «+ …»/«- …» (в файле без ключа «- » — знак списка в тексте вопроса, а не вариант)."""
        label = OPTION_LABEL_RE.match(line.text)
        if (label and label.group(1)) or (line.para.level or 0) >= 1 or line.para.checkbox is not None:
            return True
        return bool(PLUSMINUS_RE.match(line.text)) and (self.plus_minus or not self.keyless)

    def stem_place(self, item: Item, line: Line, mono: bool, code: Optional[str], later: bool) -> Optional[str]:
        """Куда идёт строка под вопросом без вариантов: «code» — отдельной строкой его текста, как написана (код,
        продолжение задания), «wrap» — перенос строки вопроса через пробел, None — это вариант.

        code — строка выше уже код: «mono» (моноширинный) или «text». Моноширинная строка — код. До первого
        варианта с подписью или «+»/«-» (later) и в файле без ключа (варианты дают только подписи и маркеры) —
        текст вопроса, если он закончен знаком («?», «:», «.»), строка похожа на код или идёт за кодом. Иначе
        как раньше: после «?» и «:» — вариант, после незаконченной строки — перенос; строка кода остаётся строкой.
        """
        if self.option_start(line) or OPTION_LABEL_RE.match(line.text):
            return None
        option_like = self.option_like(line)
        raw = line.para.text
        if mono:
            return "code" if later or code or not option_like else None
        if code == "mono" and not later and not self.keyless:
            return None  # моноширинный код кончился: строка обычным шрифтом — вариант
        if later or (self.keyless and not self.open_mode):
            if code or (later and option_like) or _ends_with(item.text, "?:….!") or code_like(raw):
                return "code"
        if option_like:
            return None
        if code:
            return "code"
        if _ends_with(item.text, "?:…"):
            return None
        return "code" if code_like(raw) else "wrap"

    @staticmethod
    def next_in_order(number: int, expected: int) -> bool:
        """Номер продолжает нумерацию вопросов: следующий, пропуск вперёд не больше MAX_NUMBER_JUMP или «1»
        (нумерация заново). Иначе строка с числом в начале («0.», «10.» после вопроса 125, «192)») — текст."""
        return number == 1 or expected <= number <= expected + MAX_NUMBER_JUMP

    def first_option(self, body: list[Line], position: int, expected: int) -> Optional[int]:
        """Позиция первой строки-варианта (option_start) с position и дальше — до следующего вопроса (его номер
        продолжает нумерацию), заголовка или строки «Ответ: …»; None — такой нет. Строки до неё под вопросом — его
        текст (код), а не варианты."""
        for index in range(position, min(len(body), position + STEM_SCAN)):
            line = body[index]
            if not line.text:
                continue
            if self.option_start(line):
                return index
            q = question_number(line.text) if line.para.level in (None, 0) else None
            if q and q[1] == 1 and expected != 1 and q[0].isdecimal():
                return index  # «1)» под вопросом: варианты с номерами (numbered_option)
            if q and self.next_in_order(q[1], expected):
                return None
            if ANSWER_RE.match(line.text) or self.heading_line(line) is not None:
                return None
        return None

    @staticmethod
    def next_number(body: list[Line], position: int) -> Optional[int]:
        """Номер вопроса в следующей непустой строке (через пустые, не дальше трёх строк) или None."""
        for line in body[position + 1: position + 4]:
            if line.text:
                q = question_number(line.text) if line.para.level in (None, 0) else None
                return q[1] if q and q[0].isdecimal() else None  # «2.1.» — следующая тема, а не нумерация заново
        return None

    def restart_heading(self, line: Line, current: Optional[Item], expected_next: int, body: list[Line], position: int) -> bool:
        """Строка перед вопросом «1.», когда номера уже дошли до 2 и дальше: заголовок новой части файла.

        Не вариант: у текущего вопроса нет вариантов или все они с буквами (строка без буквы была бы склейкой).
        """
        text = line.text
        if expected_next < 3 or len(text) > 150 or text.endswith(("?", ";", ",")) or self.option_like(line):
            return False
        if current is not None and current.options and not all(o.label for o in current.options):
            return False
        return self.next_number(body, position) == 1

    def read_numbered(self, body: list[Line]) -> None:
        current: Optional[Item] = None
        expected_next = 1
        scanned: Optional[Item] = None  # вопрос, для которого найдена позиция первого варианта (options_at)
        options_at: Optional[int] = None
        code_open = False  # последняя строка вопроса — код как написан: пустые строки после неё могут быть внутри кода
        code_kind = "text"  # её шрифт: «mono» (моноширинный) или «text»
        blanks = 0
        after_blank = False  # перед строкой была пустая строка
        for position, line in enumerate(body):
            text, para = line.text, line.para
            if not text:
                if para.images and current is not None:
                    if current.options:
                        self.add_option(current, para)
                    else:
                        current.images += para.images
                elif code_open:
                    blanks += 1
                after_blank = not para.images
                continue
            in_code, code_open = code_open, False
            gap, blanks = blanks, 0
            blank_before, after_blank = after_blank, False
            mono = _mono(para.runs)
            kind = self.heading_line(line)
            if kind is not None and not (kind == "topic" and current and current.options and OPTION_LABEL_RE.match(text)):
                self.heading(text, "section", para.outline)
                current = None
                continue
            answer = ANSWER_RE.match(text)
            if answer and current is not None:
                current.explicit, current.explicit_from = answer.group(1).strip(), "answer_line"
                continue
            alone = QUESTION_NUMBER_RE.match(text) if para.level in (None, 0) else None
            if alone and (current is None or self.next_in_order(int(alone.group(1)), expected_next)):
                current = self.new_item(alone.group(1), "", self.where(line), line.ref)  # «Вопрос 3» строкой, текст — ниже
                expected_next = int(alone.group(1)) + 1
                self.layouts["numbered_paragraphs"] += 1
                continue
            if current is not None and not current.options and CHOOSE_ONE_RE.match(text):
                continue  # «Выберите один правильный ответ:» между вопросом и вариантами
            q = question_number(text) if para.level in (None, 0) else None
            if q and q[1] >= 1000 and not 0 <= q[1] - expected_next <= 5:
                q = None  # четыре цифры — номер вопроса, только если продолжают нумерацию («1410.» — скорее год)
            if q and self.section_number(q, text, body, position):
                self.heading(text, "section")  # «2. Человек» над «2.1. …» — раздел (его номер нумерацию не продолжает)
                current = None
                continue
            if q and current is not None and not self.next_in_order(q[1], expected_next):
                q = None  # «0.», «192)» после вопроса 125 — строка кода или таблицы, а не вопрос
            if q and self.numbered_heading(para, text, body, position):
                self.heading(text, "section")  # «1) Общая психология» жирным над «1. …»: раздел, а не вопрос 1
                current = None
                continue
            if q:
                label, number, body_text = q
                if not (current is not None and label.isdecimal()
                        and self.numbered_option(current, number, expected_next, body, position)):
                    if current is not None and number == 1 and not current.label and not current.options \
                            and current.explicit is None and self.items and self.items[-1] is current:
                        self.items.pop()  # строка без номера над «1.» — заголовок списка, а не вопрос
                        self.heading(current.text, "line")
                    current = self.new_item(label, body_text, self.where(line), line.ref)
                    current.mono = _mono_inside(para.runs)
                    expected_next = number + 1
                    self.layouts["numbered_paragraphs"] += 1
                    chain = inline_chain(text) if not self.open_mode else None
                    if chain:
                        current.text = text[len(text) - len(body_text): chain[0].start()].strip()
                        current.options.extend(split_inline(para, chain, text, _text_offset(para)))
                        current.inline = True
                        self.layouts["inline_options"] += 1
                    continue
            if not in_code and not mono and self.restart_heading(line, current, expected_next, body, position):
                self.heading(text, "line")
                current = None
                continue
            if current is not None and not current.options and not current.text and not current.images \
                    and not self.option_start(line) and not OPTION_LABEL_RE.match(text):
                current.text = text  # текст вопроса под строкой «Вопрос 3»
                current.mono = _mono_inside(para.runs)
                take_stem_answer(current)
                continue
            if current is not None and not current.options and not ANSWER_RE.match(text):
                if scanned is not current:
                    scanned, options_at = current, self.first_option(body, position, expected_next)
                place = self.stem_place(current, line, mono, code_kind if in_code else None,
                                        options_at is not None and position < options_at)
                if place == "code":
                    # код под вопросом — отдельными строками, как написан (отступы и пустые строки внутри кода)
                    if len(current.text) < GROW_QUESTION_CHARS:
                        current.text = current.text + "\n" * (gap if in_code else 0) + "\n" + para.text.rstrip()
                        current.mono = current.mono or _mono_any(para.runs)
                    code_open, code_kind = True, "mono" if mono else "text"
                    continue
                if place == "wrap":
                    if len(current.text) < GROW_QUESTION_CHARS:
                        current.text = f"{current.text} {text}"  # перенос строки вопроса
                    continue
            if current is not None and blank_before and self.ends_before(current, line):
                current = None  # после пустой строки — не продолжение варианта: подпись, примечание или новый вопрос
            if current is not None and self.unnumbered_next(current, line, body, position):
                current = self.new_item(para.label.rstrip(".") if para.label else "", para.text.strip(), self.where(line), line.ref)
                current.mono = _mono_inside(para.runs)
                self.layouts["unnumbered_paragraphs"] += 1
                continue
            if current is None:
                if text.endswith(("?", ":", "…")) or (not self.open_mode and self.options_follow(body, position)):
                    current = self.new_item(para.label.rstrip(".") if para.label else "", para.text.strip(), self.where(line), line.ref)
                    current.mono = _mono_inside(para.runs)
                    self.layouts["unnumbered_paragraphs"] += 1
                else:
                    self.skip(text)
                continue
            self.add_option(current, para)

    def ends_before(self, item: Item, line: Line) -> bool:
        """Строка без подписи после пустой строки под вариантами с подписями по порядку («а)», «б)»…) — не перенос
        последнего варианта: вопрос уже кончился («Составитель: …», «Рассмотрено на заседании …»)."""
        if len(item.options) < MIN_OPTIONS or self.option_like(line) or self.option_start(line) or line.para.label:
            return False
        labels = [o.label for o in item.options]
        return all(labels) and labels_in_sequence(labels)

    def unnumbered_next(self, item: Item, line: Line, body: list[Line], position: int) -> bool:
        """Вопрос без номера сразу после вариантов предыдущего: строка с «?» (или «:») без подписи, а следующая строка —
        первый вариант («а)», «a.», «1)»), а у вариантов текущего вопроса подписи по порядку."""
        text = line.text
        if not text.endswith(("?", ":")) or len(item.options) < MIN_OPTIONS or self.option_like(line) or line.para.label:
            return False
        labels = [o.label for o in item.options]
        if not (all(labels) and labels_in_sequence(labels)):
            return False
        following = next((other for other in body[position + 1: position + 4] if other.text), None)
        if following is None or not self.option_start(following):
            return False
        label = following.para.label.rstrip(".)") if following.para.label else ""
        if not label:
            match = OPTION_LABEL_RE.match(following.text)
            label = (match.group(1) or match.group(2)) if match else ""
        return bool(label) and 0 in label_positions(label)

    @staticmethod
    def numbered_heading(para: Para, text: str, body: list[Line], position: int) -> bool:
        """Короткая нумерованная строка, вся жирная, без «?» и «:», прямо над вопросом 1."""
        if len(text) > 80 or text.rstrip().endswith(("?", ":", "…")):
            return False
        visible = [run for run in para.runs if run.text.strip()]
        if not visible or not all(run.bold for run in visible):
            return False
        for line in body[position + 1: position + 3]:
            if line.text:
                q = question_number(line.text)
                return bool(q and q[1] == 1)
        return False

    @staticmethod
    def section_number(q: tuple[str, int, str], text: str, body: list[Line], position: int) -> bool:
        """«2. Человек» прямо над «2.1. Вопрос?»: номер раздела, вопросы которого пронумерованы внутри него."""
        if not q[0].isdecimal() or len(text) > 80 or text.rstrip().endswith(("?", ":", "…")):
            return False
        following = next((line.text for line in body[position + 1: position + 3] if line.text), "")
        sub = SUBNUMBER_RE.match(following)
        return bool(sub) and sub.group(1) == q[0] and sub.group(2) == "1"

    def options_follow(self, body: list[Line], position: int) -> bool:
        seen = blanks = 0
        for line in body[position + 1: position + 4]:
            if not line.text:
                break
            if line.text.endswith("?") or not self.option_like(line):
                return False
            seen += 1
            blanks += 1 if OPEN_HINT_RE.search(line.text) and question_number(line.text) else 0
        if blanks >= 2:
            return False  # «1. Столица Франции — ______.»: под заданием — вопросы с пропуском, а не варианты
        # длинный ряд «1.», «2.», … «9.» под строкой — список вопросов, а не варианты
        return seen >= 2 and self.numbered_run(body, position + 1) <= MAX_OPTIONS

    @staticmethod
    def numbered_run(body: list[Line], position: int) -> int:
        """Сколько строк подряд нумеруются 1, 2, 3… с позиции position (строки без номера между ними не мешают)."""
        expected, count = 1, 0
        for line in body[position: position + NUMBERED_RUN_SCAN]:
            if not line.text:
                continue
            q = question_number(line.text) if line.para.level in (None, 0) else None
            if not q:
                continue
            if q[1] != expected:
                break
            count += 1
            expected += 1
            if count > MAX_OPTIONS:
                break
        return count

    def numbered_option(self, item: Item, number: int, expected: int, body: list[Line], position: int) -> bool:
        """«2. текст» после вопроса: вариант (нумерация заново в каждом вопросе) или следующий вопрос?"""
        labels = [o.label for o in item.options] + item.sub_labels
        numbers = [n for n in (_number(label) for label in labels) if n is not None]
        if labels and not numbers:
            return False  # варианты с буквами или без подписи: «1.» после них — новый вопрос
        next_option = numbers[-1] + 1 if numbers else 1
        if number != next_option:
            return False
        if number == 1 and self.numbered_run(body, position) > MAX_OPTIONS:
            return False  # «1.», «2.», … «9.» — список вопросов
        if number != expected:
            return True
        text = body[position].text
        if text.endswith("?") or text.endswith(":"):
            return False
        for line in body[position + 1: position + 3]:
            if not line.text:
                continue
            m = OPTION_LABEL_RE.match(line.text)
            return not (m and m.group(2) == "1")
        return True


# ── GIFT (Moodle) ───────────────────────────────────────────────────────────────

GIFT_ESCAPES = {"\\~": "\x01", "\\=": "\x02", "\\#": "\x03", "\\{": "\x04", "\\}": "\x05", "\\:": "\x06", "\\n": "\n"}
GIFT_BACK = {"\x01": "~", "\x02": "=", "\x03": "#", "\x04": "{", "\x05": "}", "\x06": ":"}


_NUMBER_RE = re.compile(r"^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$")


def canonical_number(text: str) -> Optional[str]:
    """«9,80» → «9.8», «+5» → «5», «.5» → «0.5»: число, как его хранит вопрос «Число» (test_items.answers); иначе None."""
    t = re.sub(r"\s+", "", text or "").replace(",", ".").replace("\u2212", "-")
    if not _NUMBER_RE.match(t):
        return None
    negative = t.startswith("-")
    t = t.lstrip("+-")
    whole, _, fraction = t.partition(".")
    whole = whole.lstrip("0") or "0"
    fraction = fraction.rstrip("0")
    out = whole + ("." + fraction if fraction else "")
    if len(out) > 40:
        return None
    return ("-" + out) if negative and out != "0" else out


def _tolerance(text: str) -> Optional[str]:
    value = canonical_number(text)
    if value is None or value.startswith("-"):
        return None
    whole, _, fraction = value.partition(".")
    return value if len(fraction) <= 6 else None


def gift_number(body: str) -> Optional[dict]:
    """Числовой ответ GIFT «{#…}»: «5», «5:0,5» (допуск), «1..5» (промежуток: середина и половина), несколько
    «=5:0.5 =4» (вес «%…%» пропускается). {"answers": [...], "tolerance": "…" | None}, или None, когда не число."""
    parts = [p.strip() for p in re.split(r"(?<!^)=", body.strip().lstrip("=")) if p.strip()]
    answers: list[str] = []
    tolerance: Optional[str] = None
    for part in parts:
        part = re.sub(r"^%-?\d+(?:\.\d+)?%", "", part.split("#")[0]).strip()
        if ".." in part:
            low, high = (canonical_number(x) for x in part.split("..", 1))
            if low is None or high is None:
                return None
            from decimal import Decimal
            a, b = Decimal(low), Decimal(high)
            middle = canonical_number(str((a + b) / 2))
            half = _tolerance(str(abs(b - a) / 2))
            if middle is None or half is None:
                return None
            answers.append(middle)
            tolerance = half if tolerance is None else max(tolerance, half, key=float)
            continue
        value, _, tol = part.partition(":")
        number = canonical_number(value)
        if number is None:
            return None
        answers.append(number)
        if tol.strip():
            t = _tolerance(tol)
            if t is None:
                return None
            tolerance = t if tolerance is None else max(tolerance, t, key=float)
    answers = list(dict.fromkeys(answers))[:10]
    if not answers:
        return None
    return {"answers": answers, "tolerance": tolerance if tolerance not in (None, "0") else None}


def looks_like_gift(text: str) -> bool:
    """Ответы в скобках GIFT («{=верно ~неверно}», «{T}», «{#5}») — два и больше, или один при «::название::» в начале
    строки или $CATEGORY. Код со скобками («{ x = 100; }») и «::» («std::cout») файл GIFT не делает."""
    answers = 0
    for _ in GIFT_ANSWERS_RE.finditer(text):
        answers += 1
        if answers >= 2:
            return True
    return answers == 1 and ("$CATEGORY" in text or GIFT_TITLE_RE.search(text) is not None)


AIKEN_OPTION_RE = re.compile(r"^([A-Z])[.)]\s+(\S.*)$")
AIKEN_ANSWER_RE = re.compile(r"^ANSWER\s*:\s*([A-Za-z])\s*$", re.I)
AIKEN_NUMBERED_RE = re.compile(r"^(?:\d{1,4}\s*[.)]|(?:question|вопрос|задание)\s*№?\s*\d+)", re.I)


def _aiken_block(lines: list[str]) -> Optional[tuple[list[str], list[str], Optional[str]]]:
    """Блок Aiken (выпуск 49): строки вопроса, варианты «A. …» подряд с буквы A, необязательная строка «ANSWER: B»
    в конце — (вопрос, варианты, буква ответа или None); иначе None."""
    answer = None
    if lines and AIKEN_ANSWER_RE.match(lines[-1]):
        answer = AIKEN_ANSWER_RE.match(lines[-1]).group(1).upper()
        lines = lines[:-1]
    first = next((i for i, line in enumerate(lines) if AIKEN_OPTION_RE.match(line)), None)
    if not first:  # нет вариантов или нет строки вопроса
        return None
    stem, rest = lines[:first], lines[first:]
    options = []
    for offset, line in enumerate(rest):
        found = AIKEN_OPTION_RE.match(line)
        if not found or found.group(1) != chr(ord("A") + offset):
            return None
        options.append(found.group(2).strip())
    if len(options) < 2:
        return None
    return stem, options, answer


def _aiken_blocks(text: str) -> list[list[str]]:
    return [[line.strip() for line in chunk.split("\n") if line.strip()]
            for chunk in re.split(r"\n\s*\n", text.replace("\r\n", "\n")) if chunk.strip()]


def looks_like_aiken(text: str) -> bool:
    """Файл Aiken (Moodle): каждый блок через пустую строку — вопрос, варианты «A.» / «A)» с латинской буквы A подряд и
    строка «ANSWER: B»; строка ответа есть хотя бы у половины блоков (у остальных её могли забыть)."""
    if "ANSWER" not in text:
        return False
    blocks = _aiken_blocks(text)
    read = [_aiken_block(block) for block in blocks]
    if not blocks or any(entry is None or AIKEN_NUMBERED_RE.match(entry[0][0]) for entry in read):
        return False  # не Aiken или вопросы с номерами («Question 1.», «1.»): их читает общий разбор, как раньше
    with_answer = sum(1 for block in blocks if block[-1].startswith("ANSWER"))  # «ANSWER» — заглавными, как в Moodle
    return with_answer >= 1 and with_answer * 2 >= len(read)


def read_aiken(text: str) -> Reader:
    """Aiken (выпуск 49): вопрос — строки до вариантов, варианты по буквам, ключ — «ANSWER: B» (evidence answer_line);
    буква, которой нет среди вариантов, — флаг key_invalid, нет строки ответа — без ключа."""
    reader = Reader(line_word="строка")
    reader.layouts["aiken"] += 1
    line_no = 1
    for chunk in re.split(r"(\n\s*\n)", text.replace("\r\n", "\n")):
        if not chunk.strip():
            line_no += chunk.count("\n")
            continue
        lines = [line.strip() for line in chunk.split("\n") if line.strip()]
        entry = _aiken_block(lines)
        start = line_no + len(chunk) - len(chunk.lstrip("\n"))
        line_no += chunk.count("\n")
        if entry is None:
            continue
        stem, options, answer = entry
        item = reader.new_item("", "\n".join(stem), f"строка {start}")
        item.options = [Option(text=option, runs=[Run(text=option)]) for option in options]
        if answer is not None:
            index = ord(answer) - ord("A")
            if 0 <= index < len(options):
                item.correct, item.evidence = [index], "answer_line"
            else:
                item.flag("key_invalid")
    return reader


def read_gift(text: str) -> Reader:
    reader = Reader(line_word="строка")
    reader.layouts["gift"] += 1

    def unescape(value: str) -> str:
        for key, back in GIFT_BACK.items():
            value = value.replace(key, back)
        return value.strip()

    def plain(value: str, html: bool) -> str:
        """Текст поля GIFT: экранирование снято; у вопроса «[html]» — HTML текстом (выпуск 49)."""
        value = unescape(value).replace("\x07", "\\")
        return bank_formats._html_text(value)[0] if html and "<" in value else value

    def feedback(body: str) -> str:
        """Отзыв ответа: текст после первой «#» (выпуск 49)."""
        return body.split("#", 1)[1] if "#" in body else ""

    lines = [line for line in text.replace("\r\n", "\n").split("\n") if not line.strip().startswith("//")]
    raw = "\n".join(lines).replace("\\\\", "\x07")
    for key, value in GIFT_ESCAPES.items():
        raw = raw.replace(key, value)
    for chunk in re.split(r"\n\s*\n", raw):
        chunk = chunk.strip()
        if not chunk:
            continue
        category = re.match(r"^\$CATEGORY:\s*(.+)$", chunk)
        if category:
            title = unescape(category.group(1)).replace("\x07", "\\")
            if title.startswith("$"):  # путь Moodle «$course$/top/…/Тема 3» (выпуск 49): тема — последняя часть
                title = title.rstrip("/").split("/")[-1].strip() or title
            reader.heading(title, "topic")
            continue
        chunk = re.sub(r"^::.*?::", "", chunk, flags=re.S).strip()
        # от первой «{» до последней «}» (как ^(.*?)\{(.*)\}(.*)$, но без перебора)
        open_at, close_at = chunk.find("{"), chunk.rfind("}")
        if open_at < 0 or close_at < open_at:
            if len(reader.skipped) < MAX_SKIPPED:
                reader.skipped.append(unescape(chunk)[:SKIPPED_CHARS])
            continue
        head, answers, tail = chunk[:open_at], chunk[open_at + 1:close_at].strip(), chunk[close_at + 1:]
        if tail.strip():  # пропуск посреди фразы (выпуск 49: без лишних пробелов, перед знаком препинания — без пробела)
            rest = tail.lstrip()
            head = (head.rstrip() + " " if head.strip() else "") + "___" + ("" if rest[:1] in ".,;:!?)»…" else " ") + rest
        stem = unescape(head).replace("\x07", "\\")
        html = stem.lower().startswith("[html]")
        stem = re.sub(r"^\[(?:html|moodle|markdown|plain)\]", "", stem)
        if html and "<" in stem:
            stem = bank_formats._html_text(stem)[0]
        # общее пояснение — после последней «####» (как в Moodle, question/format/gift)
        general = ""
        cut = answers.rfind("####")
        if cut >= 0:
            general, answers = plain(answers[cut + 4:], html), answers[:cut].strip()
        item = reader.new_item("", stem, "GIFT")
        head_word = answers.split("#", 1)[0].strip().upper()
        if head_word in ("T", "TRUE", "F", "FALSE"):
            item.kind = "truefalse"
            item.options = [Option(text="Верно"), Option(text="Неверно")]
            item.correct = [0 if head_word.startswith("T") else 1]
            item.evidence = "gift"
            # {T#отзыв на неверный ответ#отзыв на верный}: пояснение — общее, иначе более длинный отзыв (короткий —
            # обычно «Верно.»; объясняет чаще отзыв на неверный ответ)
            bits = answers.split("#", 2)
            right = plain(bits[2], html) if len(bits) > 2 else ""
            wrong = plain(bits[1], html) if len(bits) > 1 else ""
            item.explanation = general or (wrong if len(wrong) > len(right) else right)
            continue
        if answers.startswith("#"):
            item.kind, item.answer, item.evidence = "open", answers[1:].split(":")[0].strip(), "gift"
            item.number = gift_number(unescape(answers[1:]))  # выпуск 48: число с допуском, не только запись
            if item.number:  # выпуск 49: запись ответа — само число («=%100%443:0#» из Moodle — «443»)
                item.answer = item.number["answers"][0]
            first = re.split(r"(?<!^)=", answers[1:].strip().lstrip("="))[0]
            item.explanation = general or plain(feedback(first), html)
            continue
        parts = re.findall(r"([=~])\s*((?:%-?\d+(?:\.\d+)?%)?)([^=~]*)", answers)
        if parts and all(sign == "=" for sign, _, _ in parts) and all("->" in body for _, _, body in parts):
            item.kind = "match"
            for _, _, body in parts:
                left, right = (plain(x, html) for x in body.split("->", 1))
                if left:
                    item.pairs.append((left, right))
                elif right:
                    item.extras.append(right)  # выпуск 49: «= -> лишний» — правый элемент без пары
            item.explanation = general
            continue
        if parts and all(sign == "=" for sign, _, _ in parts):
            item.kind, item.answer, item.evidence = "open", "; ".join(unescape(body.split("#")[0]) for _, _, body in parts), "gift"
            item.explanation = general or plain(feedback(parts[0][2]), html)
            continue
        right_feedback = ""
        for sign, weight, body in parts:
            option_text = plain(body.split("#")[0], html)
            value = 100.0 if sign == "=" else float(weight.strip("%")) if weight else 0.0
            item.options.append(Option(text=option_text, runs=[Run(text=option_text)]))
            item.weights.append(value)
            if value > 0 and not right_feedback:
                right_feedback = plain(feedback(body), html)
        item.correct = [i for i, w in enumerate(item.weights) if w > 0]
        item.evidence = "gift" if item.options else ""
        item.explanation = general or right_feedback
        if len(item.correct) > 1:
            item.kind = "multiple"
    return reader


# ── XLSX (zipfile и lxml) ───────────────────────────────────────────────────────

_S = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
_SHEET_RE = re.compile(r"xl/worksheets/sheet(\d{1,4})\.xml")
_CELL_REF_RE = re.compile(r"([A-Z]{1,3})(\d{1,7})$")
_XLSX_ESCAPE_RE = re.compile(r"_x([0-9A-Fa-f]{4})_")
_XLSX_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_XLSX_OFF = ("0", "false", "none")


def _xml(archive: zipfile.ZipFile, name: str):
    """Часть книги без подстановки сущностей и без сети (свой парсер на вызов: парсеры lxml не делят потоки)."""
    from lxml import etree

    parser = etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False, huge_tree=False)
    return etree.fromstring(archive.read(name), parser)


def _xlsx_text(value: Optional[str]) -> str:
    """Текст ячейки: escape-последовательности Excel «_x000D_» раскрыты, управляющие знаки убраны."""
    if not value:
        return ""
    value = _XLSX_ESCAPE_RE.sub(lambda m: chr(int(m.group(1), 16)), value)
    return _XLSX_CONTROL_RE.sub("", value.replace("\r\n", "\n").replace("\r", "\n"))


def _xlsx_color(element) -> Optional[str]:
    """Цвет шрифта или заливки: 'FF0000', 'theme:5', 'indexed:10' — или None (чёрный, авто, «Текст 1»)."""
    if element is None:
        return None
    rgb = (element.get("rgb") or "").upper()
    if rgb:
        rgb = rgb[-6:]
        return None if rgb in ("000000", "FFFFFF") else rgb
    theme = element.get("theme")
    if theme is not None:
        return None if theme in ("0", "1") else f"theme:{theme}"
    indexed = element.get("indexed")
    if indexed is not None:
        return None if indexed in ("8", "9", "64", "65") else f"indexed:{indexed}"
    return None


def _xlsx_font(element) -> dict:
    """Оформление из <font> или <rPr>: жирный, курсив, подчёркивание, цвет."""
    if element is None:
        return {}

    def on(tag: str) -> bool:
        found = element.find(_S + tag)
        return found is not None and (found.get("val") or "1").lower() not in _XLSX_OFF

    underline = element.find(_S + "u")
    return {
        "bold": on("b"),
        "italic": on("i"),
        "underline": underline is not None and (underline.get("val") or "single").lower() != "none",
        "color": _xlsx_color(element.find(_S + "color")),
    }


def _xlsx_fill(fill) -> Optional[str]:
    pattern = fill.find(_S + "patternFill")
    if pattern is None or (pattern.get("patternType") or "none") in ("none", "gray125"):
        return None
    return _xlsx_color(pattern.find(_S + "fgColor"))


class _SharedStrings:
    """Общие строки книги: куски с оформлением собираются при первом обращении."""

    def __init__(self, root) -> None:
        self._items = root.findall(_S + "si") if root is not None else []
        self._cache: dict[int, list[Run]] = {}

    def runs(self, index: int) -> list[Run]:
        if index in self._cache:
            return self._cache[index]
        runs: list[Run] = []
        if 0 <= index < len(self._items):
            si = self._items[index]
            plain = si.find(_S + "t")
            if plain is not None:
                runs.append(Run(text=_xlsx_text(plain.text)))
            for r in si.findall(_S + "r"):
                font = _xlsx_font(r.find(_S + "rPr"))
                t = r.find(_S + "t")
                runs.append(Run(text=_xlsx_text(t.text if t is not None else ""), bold=font.get("bold", False),
                                italic=font.get("italic", False), underline=font.get("underline", False),
                                color=font.get("color")))
        self._cache[index] = runs
        return runs


def _column_index(letters: str) -> int:
    col = 0
    for char in letters:
        col = col * 26 + (ord(char) - 64)
    return col


def _split_lines(runs: list[Run], shade: Optional[str]) -> list[Para]:
    """Текст ячейки с переводами строк (Alt+Enter) — абзацами, как варианты в одной ячейке Word."""
    paras = [Para(shade=shade)]
    for run in runs:
        pieces = run.text.split("\n")
        for index, piece in enumerate(pieces):
            if index:
                paras.append(Para(shade=shade))
            if piece:
                paras[-1].runs.append(replace(run, text=piece))
    return [para for para in paras if para.text.strip()]


def read_xlsx(contents: bytes) -> list[Table]:
    """Первый лист книги — таблица; номера строк — как в Excel («лист 1, строка 12»).

    Оформление: жирный, курсив, подчёркивание и цвет шрифта ячейки и кусков общих строк, заливка ячейки.
    Ячеек со значением — до 200 000 (больше — ArchiveTooLarge), столбцов — до 32 (дальше не читаются).
    """
    names = set(check_archive(contents, max_part=min(MAX_XLSX_PART_BYTES, bank_docx.MAX_XML_PART_BYTES)))
    with zipfile.ZipFile(io.BytesIO(contents)) as archive:
        shared = _SharedStrings(_xml(archive, "xl/sharedStrings.xml") if "xl/sharedStrings.xml" in names else None)
        xfs: list[tuple[dict, Optional[str]]] = []
        if "xl/styles.xml" in names:
            styles = _xml(archive, "xl/styles.xml")
            fonts_root, fills_root, xfs_root = styles.find(_S + "fonts"), styles.find(_S + "fills"), styles.find(_S + "cellXfs")
            fonts = [_xlsx_font(font) for font in fonts_root.findall(_S + "font")] if fonts_root is not None else []
            fills = [_xlsx_fill(fill) for fill in fills_root.findall(_S + "fill")] if fills_root is not None else []
            for xf in (xfs_root.findall(_S + "xf") if xfs_root is not None else []):
                font_id, fill_id = _number(xf.get("fontId", "0")), _number(xf.get("fillId", "0"))
                font = fonts[font_id] if font_id is not None and font_id < len(fonts) else {}
                fill = fills[fill_id] if fill_id is not None and fill_id < len(fills) else None
                xfs.append((font, fill))
        sheets = sorted((name for name in names if _SHEET_RE.fullmatch(name)), key=lambda n: int(_SHEET_RE.fullmatch(n).group(1)))
        tables: list[Table] = []
        for name in sheets[:1]:
            root = _xml(archive, name)
            grid: dict[int, dict[int, Cell]] = {}
            values = 0
            row_number = 0
            for row in root.iter(_S + "row"):
                row_number = _number(row.get("r") or "") or row_number + 1
                col = 0
                for c in row.findall(_S + "c"):
                    ref = _CELL_REF_RE.match(c.get("r") or "")
                    if ref:
                        col, row_number = _column_index(ref.group(1)), int(ref.group(2))
                    else:
                        col += 1
                    if col > MAX_XLSX_COLUMNS:
                        continue
                    runs = _xlsx_cell_runs(c, shared, xfs)
                    if not runs:
                        continue
                    values += 1
                    if values > MAX_XLSX_CELLS:
                        raise ArchiveTooLarge(f"more than {MAX_XLSX_CELLS} cells")
                    style = _number(c.get("s") or "0")
                    fill = xfs[style][1] if style is not None and style < len(xfs) else None
                    grid.setdefault(row_number, {})[col] = Cell(paras=_split_lines(runs, fill), shade=fill)
            width = max((max(cols) for cols in grid.values()), default=0)
            empty = Cell(paras=[])
            rows = [[grid[r].get(c, empty) for c in range(1, width + 1)] for r in sorted(grid)]
            tables.append(Table(rows=rows, numbers=sorted(grid), title=f"лист {len(tables) + 1}"))
        return tables


def _xlsx_cell_runs(c, shared: _SharedStrings, xfs: list[tuple[dict, Optional[str]]]) -> list[Run]:
    """Куски ячейки с оформлением её стиля (у кусков общих строк своё оформление поверх)."""
    style = _number(c.get("s") or "0")
    font, fill = xfs[style] if style is not None and style < len(xfs) else ({}, None)
    marks = {"bold": font.get("bold", False), "italic": font.get("italic", False),
             "underline": font.get("underline", False), "color": font.get("color"), "shade": fill}
    kind = c.get("t")
    v = c.find(_S + "v")
    if kind == "s" and v is not None:
        index = _number((v.text or "").strip())
        if index is None:
            return []
        return [replace(run, bold=run.bold or marks["bold"], italic=run.italic or marks["italic"],
                        underline=run.underline or marks["underline"], color=run.color or marks["color"], shade=fill)
                for run in shared.runs(index)]
    if kind == "inlineStr":
        text = "".join(t.text or "" for t in c.iter(_S + "t"))
        return [Run(text=_xlsx_text(text), **marks)]
    if v is None or not (v.text or "").strip():
        return []
    if kind == "b":
        return [Run(text="ИСТИНА" if v.text.strip() == "1" else "ЛОЖЬ", **marks)]
    if kind in ("str", "e"):
        return [Run(text=_xlsx_text(v.text), **marks)]
    try:
        number = float(v.text)
        text = str(int(number)) if number.is_integer() else repr(number)
    except (ValueError, OverflowError):
        text = _xlsx_text(v.text)
    return [Run(text=text, **marks)]


# ── Ключи и проверка ────────────────────────────────────────────────────────────


def _cut_last(option: Option, rstrip: bool = True) -> None:
    """Срезать последний знак варианта (знак списка «;», «.»): оформление следует за текстом."""
    text = option.text[:-1]
    option.text = text.rstrip() if rstrip else text
    option.runs = trim_visible(option.runs, _visible(option.text))


def strip_list_punctuation(item: Item, inline: bool = False) -> None:
    """«x;», «y;», «z.» — знаки списка, не часть вариантов. «;» в конце каждого варианта без точки в последнем —
    часть текста (оператор SQL или C# «int arr[10];»): такие варианты остаются как написаны."""
    texts = [o.text for o in item.options]
    if len(texts) < 2:
        return
    head, last = texts[:-1], texts[-1]
    if all(t.endswith((";", ",")) for t in head) and last.endswith(".") and not any(_mono(o.runs) for o in item.options):
        for option in item.options:
            _cut_last(option)
    elif inline and last.endswith(".."):
        _cut_last(item.options[-1], rstrip=False)
    elif inline and last.endswith(".") and not any(t.endswith(".") for t in head):
        _cut_last(item.options[-1], rstrip=False)


def _symbol_marked(text: str) -> bool:
    return bool(PLUSMINUS_RE.match(text) or GLUED_MARK_RE.match(text) or mark_suffix(text) is not None)


def _glued_mark(option: Option) -> Optional[re.Match]:
    """Маркер «*»/«#» в начале варианта (Indigo); в коде (моноширинный вариант) маркеров нет."""
    return None if _mono(option.runs) else GLUED_MARK_RE.match(option.text)


def detect_markers(items: list[Item], least: int = 2) -> set[str]:
    """Маркеры ключа во всём документе. В файле маркер должен стоять хотя бы у двух вопросов (и у половины): одна
    «*» в большом файле бывает просто текстом. Текст быстрой контрольной учитель отмечает сам (hand): хватает одного
    вопроса (least=1)."""
    counts: Counter = Counter()
    for item in items:
        if not item.options:
            continue
        if all(PLUSMINUS_RE.match(o.text) for o in item.options):
            counts["+-"] += 1
        glued = Counter(m.group(1) for m in map(_glued_mark, item.options) if m)
        for symbol, n in glued.items():
            if n < len(item.options):
                counts[symbol] += 1
        suffix = sum(1 for o in item.options if mark_suffix(o.text) is not None)
        if 1 <= suffix < len(item.options):
            counts["suffix"] += 1
    with_options = sum(1 for item in items if item.options) or 1
    chosen = {symbol for symbol, n in counts.items() if n >= max(least, with_options * 0.5 if least > 1 else 1)}
    if "*" in chosen and counts.get("#"):
        chosen.add("#")  # Indigo: «*» — один правильный вариант, «#» — несколько
    if "#" in chosen and counts.get("*"):
        chosen.add("*")
    return chosen


def apply_markers(items: list[Item], markers: set[str], *, assign: bool = True) -> None:
    """Срезает маркеры с вариантов; assign — отмеченные маркером варианты становятся ключом."""
    for item in items:
        hits = []
        for i, option in enumerate(item.options):
            if "+-" in markers:
                m = PLUSMINUS_RE.match(option.text)
                if m:
                    if m.group(1) == "+":
                        hits.append(i)
                    option.text, option.runs = option.text[m.end():].strip(), strip_runs(option.runs, m.end())
                    continue
            m = _glued_mark(option)
            if m and m.group(1) in markers:
                hits.append(i)
                if assign:
                    item.marker_multi = item.marker_multi or m.group(1) == "#"
                option.text, option.runs = option.text[m.end():].strip(), strip_runs(option.runs, m.end())
                continue
            if "suffix" in markers:
                start = mark_suffix(option.text)
                if start is not None:
                    hits.append(i)
                    option.text = option.text[:start].strip()
                    option.runs = trim_visible(option.runs, _visible(option.text))
        if assign and hits and not item.correct:
            item.correct, item.evidence = hits, "marker"
            if len(hits) > 1:
                item.marker_multi = True


def choose_signal(items: list[Item]) -> tuple[Optional[str], dict]:
    """Признак оформления, которым отмечен ключ во всём документе (или None), и таблица по признакам."""
    table = {}
    for signal in FORMAT_SIGNALS:
        one = many = all_marked = 0
        for item in items:
            if len(item.options) < MIN_OPTIONS:
                continue
            marked = [o for o in item.options if o.share(signal) >= MARK_SHARE]
            if len(marked) == len(item.options):
                all_marked += 1
            elif len(marked) == 1:
                one += 1
            elif marked:
                many += 1
        table[signal] = {"one": one, "many": many, "all": all_marked}
    with_options = sum(1 for item in items if len(item.options) >= MIN_OPTIONS) or 1
    best = max(FORMAT_SIGNALS, key=lambda s: (table[s]["one"] + table[s]["many"], -table[s]["all"]))
    if (table[best]["one"] + table[best]["many"]) / with_options < 0.5:
        return None, table
    return best, table


def _task_line(text: str) -> str:
    """Задание — первая строка вопроса (под ней может быть код)."""
    return text.split("\n", 1)[0].strip()


def order_task(text: str) -> bool:
    """«Расположите…», «Установите правильную последовательность…:» — задание на порядок (не вопрос с «?»)."""
    task = _task_line(text)
    return bool(ORDER_TASK_RE.search(task)) and not task.endswith("?")


def match_task(text: str) -> bool:
    """«Установите соответствие…», «Соотнесите…» — задание на соответствие (не вопрос с «?»)."""
    task = _task_line(text)
    return bool(MATCH_TASK_RE.search(task)) and not task.endswith("?")


def key_shape(item: Item, key: str) -> str:
    """Вид, который задаёт ключ файла: «match» — пары «А-2, Б-3, В-1»; «order» — все варианты по одному разу не по
    возрастанию («2, 4, 3, 1») или по возрастанию в задании на порядок; иначе «choice» — номер или буквы вариантов."""
    key = key.strip()
    if len(key) > MAX_KEY_SHAPE_CHARS:
        return "choice"
    if len(MATCH_KEY_PAIR_RE.findall(key)) >= 2 and not MATCH_KEY_PAIR_RE.sub("", key).strip(" ,;.\t"):
        return "match"
    count = len(item.options)
    tokens = re.findall(r"\d{1,2}|[а-яёa-z]", key, re.I)
    if count >= 3 and len(tokens) == count:
        places = [letters_index(token, count, item.label_style)[0] for token in tokens]
        if None not in places and sorted(places) == list(range(count)) and (places != sorted(places) or order_task(item.text)):
            return "order"
    return "choice"


def order_places(item: Item) -> None:
    """Порядок, записанный как «3. март» (MyTestX): числа вариантов — их места, если в вопросе есть слово о порядке."""
    if ORDER_HINT_RE.search(item.text) and item.options and all(o.label.isdecimal() for o in item.options):
        places = [int(o.label) for o in item.options]
        if sorted(places) == list(range(1, len(places) + 1)) and places != sorted(places):
            item.order = [places.index(p) for p in range(1, len(places) + 1)]
            item.evidence = "order_numbers"


def classify(item: Item, format_mode: str = "auto", *, marked: bool = False, shape: Optional[str] = None) -> None:
    """Вид вопроса по устройству, а не по словам: отмеченный вариант (оформление, маркер, флажок) или ключ-буква —
    выбор (single / multiple); «порядок» — ключ-перестановка, места числами или задание «Расположите…» без отметок;
    «соответствие» — ключ-пары или задание «Установите соответствие…» без отметок."""
    if item.kind in ("open", "match", "truefalse", "multiple", "cloze") or (item.kind == "order" and item.evidence == "gift"):
        return  # вид задан разметкой файла (GIFT, Moodle XML) или устройством вопроса
    text = item.text
    if not item.options:
        if format_mode != "test":
            item.kind = "open"  # вопрос без вариантов — открытый
        else:
            item.kind = "open" if (item.answer or item.explicit or OPEN_HINT_RE.search(text)) else "unknown"
        return
    free = shape is None and not marked  # ни ключа файла, ни отметки: вид — по заданию
    if shape == "order" or (free and (item.order or order_task(text))):
        item.kind = "order"
    elif shape == "match" or (free and match_task(text)):
        item.kind = "match"
    elif MULTI_HINT_RE.search(text) or item.marker_multi:
        item.kind = "multiple"
    else:
        lowered = sorted(o.text.lower().strip(". ") for o in item.options)
        if lowered in (["верно", "неверно"], ["да", "нет"], ["ложь", "правда"], ["истина", "ложь"]):
            item.kind = "truefalse"


def resolve_choice(item: Item, key: str) -> tuple[list[int], bool]:
    """Ключ «б», «а, в», «2», «Б) Статут» или текст варианта → индексы вариантов (и неоднозначность буквы)."""
    key = key.strip()
    count = len(item.options)
    if not count:
        return [], False
    lowered = key.lower()
    for i, option in enumerate(item.options):
        if option.text and option.text.lower() == lowered:
            return [i], False
    m = re.match(r"^([а-яёa-z]|\d{1,2})\s*[).]\s*(\S.*)$", key, re.I)
    if m:
        index, ambiguous = letters_index(m.group(1), count, item.label_style)
        if index is not None:
            return [index], ambiguous
    m = re.match(r"^([а-яёa-z]|\d{1,2})\s*[-–—:]\s*(\S.*)$", key, re.I)
    if m:  # «б – Евразия»: буква и текст того же варианта
        index, ambiguous = letters_index(m.group(1), count, item.label_style)
        if index is not None and same_text(item.options[index].text) == same_text(m.group(2)):
            return [index], ambiguous
    tokens = re.findall(r"\d{1,2}|[а-яёa-zA-ZА-ЯЁ]", key)
    if tokens and len("".join(tokens)) <= 10:
        out, any_ambiguous = [], False
        for token in tokens:
            index, ambiguous = letters_index(token, count, item.label_style)
            if index is None:
                return [], False
            any_ambiguous = any_ambiguous or ambiguous
            if index not in out:
                out.append(index)
        return out, any_ambiguous
    return [], False


def resolve_order(item: Item, key: str) -> list[int]:
    tokens = re.findall(r"\d{1,2}|[а-яёa-z]", key, re.I)
    out = []
    for token in tokens:
        index, _ = letters_index(token, len(item.options), item.label_style)
        if index is None or index in out:
            return []
        out.append(index)
    return out if len(out) == len(item.options) else []


def same_text(text: str, code: bool = False) -> str:
    """Для поиска повторов (same_options, duplicate): регистр важен — «Hello», «hello» и «HELLO» разные; код
    (моноширинный или со знаками кода) сравнивается как написан, в остальном тексте пробелы схлопнуты и «ё» = «е»."""
    if code or CODE_RE.search(text):
        return text.strip()
    return " ".join(text.replace("ё", "е").replace("Ё", "Е").split())


def _mark_value(marked: int, letters: int) -> float:
    """Доля отмеченных знаков с округлением вниз до сотых: порог 0.6 у клиента даёт то же, что здесь.

    0 и 1 — целыми; хоть один отмеченный знак — не меньше 0.01 (клиент видит частичную отметку).
    """
    if not letters or not marked:
        return 0
    if marked >= letters:
        return 1
    return max(1, marked * 100 // letters) / 100


def _open_up(item: Item) -> None:
    """format «open»: варианты (GIFT) и пары — строками текста вопроса; вопрос становится открытым."""
    lines = [(f"{o.label}) " if o.label else "") + o.text for o in item.options]
    lines += [f"{a} — {b}" for a, b in item.pairs]
    if lines:
        item.text = "\n".join([item.text, *lines]).strip()
        item.options, item.pairs, item.correct, item.weights, item.order = [], [], [], [], []
        item.kind, item.evidence = "open", ""


def finish(reader: Reader, *, key_mode: str = "auto", user_keys: Optional[dict[str, str]] = None,
           format_mode: str = "auto", hand: bool = False) -> dict:
    """Ключи, виды, флаги, предметы и темы найденных вопросов → словарь предпросмотра. hand — текст быстрой
    контрольной: маркер ключа («*», «+») засчитывается и у одного вопроса."""
    use_file = key_mode == "auto"
    items = [item for item in reader.items if item.text or item.options]
    if len(items) > MAX_ITEMS:  # дальше число вопросов не меняется: отказ до разбора ключей
        raise BankError(413, "too_many", TOO_MANY_DETAIL)
    if format_mode == "open":
        for item in items:
            _open_up(item)
    _cap_pictures(reader, items)
    file_keys = reader.keys
    for item in items:
        if item.grid:
            order_grid(item)
        restore_unordered_labels(item)
        labels = [o.label for o in item.options if o.label]
        item.label_style = "lat" if labels and all(label.lower() in LAT for label in labels) else "rus"
        strip_list_punctuation(item, item.inline)
        user_key = user_keys.get(item.label) if user_keys and item.label else None
        file_key = item.explicit
        keys = _keys_for(reader, item, file_keys)
        if file_key is None and item.label and item.label in getattr(keys, "conflicts", ()):
            item.flag("key_conflict")  # в ключе файла у этого номера два разных ответа: не угадываем, какой
        elif file_key is None and item.label and item.label in keys:
            file_key, item.explicit_from = keys[item.label], "key_list"
        if user_key is not None:
            # ключ пользователя старше ключа файла; несогласие с файлом — key_conflict
            item.file_explicit = file_key
            item.explicit, item.explicit_from = user_key, "key_text"
        else:
            item.explicit = file_key
    markers = detect_markers(items, least=1 if hand else 2)
    signal, table = choose_signal(items)
    if markers and signal:
        marker_items = sum(1 for item in items if any(_symbol_marked(o.text) for o in item.options))
        signal_items = table[signal]["one"] + table[signal]["many"]
        if signal_items >= marker_items:
            markers = set()
    if markers:
        apply_markers(items, markers, assign=use_file)
    if "+-" not in markers:
        for item in items:
            for option in item.options:
                bullet = BULLET_RE.match(option.text)
                if bullet and not option.label:
                    option.text, option.runs = option.text[bullet.end():], strip_runs(option.runs, bullet.end())
    for item in items:
        # отметки ключа в файле: маркер (уже в item.correct), оформление, флажки — не у всех вариантов сразу
        formatted: list[int] = []
        checked: list[int] = []
        if use_file and item.options:
            if signal:
                formatted = [i for i, o in enumerate(item.options) if o.share(signal) >= MARK_SHARE]
            checked = [i for i, o in enumerate(item.options) if o.checkbox]
            formatted = formatted if len(formatted) < len(item.options) else []
            checked = checked if len(checked) < len(item.options) else []
        marked = bool(item.correct or formatted or checked)
        shape = None
        if item.explicit and item.options and (use_file or item.explicit_from == "key_text"):
            shape = key_shape(item, item.explicit)
        if shape is None and not marked:
            order_places(item)  # «3. март» (MyTestX): число — место варианта
        classify(item, format_mode, marked=marked, shape=shape)
        choice = item.kind in CHOICE_KINDS
        if choice and not use_file:
            # «первый вариант» / «ответы не отмечены»: ключей файла нет, ключ пользователя остаётся
            item.correct, item.evidence = [], ""
            if item.explicit_from != "key_text":
                item.explicit, item.explicit_from = None, ""
            item.file_explicit = None
        if not choice:
            formatted, checked = [], []
        if item.explicit and item.kind == "order":
            item.order = resolve_order(item, item.explicit) or item.order
            item.evidence = item.explicit_from
        elif item.explicit and item.kind in ("match", "open"):
            item.answer, item.evidence = item.explicit, item.explicit_from
        elif item.explicit:
            explicit, ambiguous = resolve_choice(item, item.explicit)
            if not explicit:
                item.flag("key_invalid")
            else:
                other = item.correct or formatted
                if other and sorted(other) != sorted(explicit):
                    item.flag("key_conflict")
                if item.file_explicit:
                    from_file, _ = resolve_choice(item, item.file_explicit)
                    if from_file and sorted(from_file) != sorted(explicit):
                        item.flag("key_conflict")
                if ambiguous:
                    item.flag("key_letter_ambiguous")
                item.correct, item.evidence = explicit, item.explicit_from
                if len(explicit) > 1 and item.kind == "single":
                    item.kind = "multiple"
        if not item.correct and choice:
            if use_file:
                if checked:
                    item.correct, item.evidence = checked, "checkbox"
                    if len(checked) > 1 and item.kind == "single":
                        item.kind = "multiple"  # отмечены два флажка — автор отметил несколько верных
                elif formatted:
                    item.correct, item.evidence = formatted, signal
            elif key_mode == "first_option" and item.options:
                item.correct, item.evidence = [0], "first_option"
        if use_file and signal and not item.correct and any(0 < o.share(signal) < MARK_SHARE for o in item.options):
            item.flag("partial_mark")
        n = len(item.options)
        if item.kind in CHOICE_KINDS:
            if n < MIN_OPTIONS:
                item.flag("few_options")
            if n > MAX_OPTIONS:
                item.flag("many_options")
            if not item.correct:
                item.flag("no_key")
            elif item.kind != "multiple" and len(item.correct) > 1:
                item.flag("several_marked")
        elif item.kind == "order" and not item.order and item.options:
            item.flag("no_key")
        elif item.kind == "unknown":
            item.flag("no_options")
        if any(not o.text and not o.images for o in item.options):
            item.flag("empty_option")
        texts = [same_text(o.text, code=_mono(o.runs)) for o in item.options if o.text]
        if len(set(texts)) < len(texts):
            item.flag("same_options")
        if "" in item.images or any("" in o.images for o in item.options):
            item.flag("has_image")  # картинка, которую не перенести (EMF/WMF, слишком большая): вопрос ждёт проверки
        if item.formulas or any(o.formulas for o in item.options):
            item.flag("has_formula")
        if len(item.text) > MAX_QUESTION_CHARS or any(len(o.text) > MAX_OPTION_CHARS for o in item.options[:MAX_OPTIONS_OUT]):
            item.flag("too_long")
    seen: set = set()
    for item in items:
        # одинаковый текст с разными картинками — разные вопросы («Что означает выделенная стрелка?» ×3)
        key = (same_text(item.text), tuple(sorted(same_text(o.text, code=_mono(o.runs)) for o in item.options)),
               tuple(item.images), tuple(sorted(tuple(o.images) for o in item.options)))
        if key in seen:
            item.flag("duplicate")
        else:
            seen.add(key)
    warnings: list[dict] = []
    subjects, topics = _sections(reader, items, warnings)
    gaps: list[list[int]] = []
    previous: dict[int, int] = {}
    for item in items:  # пропуски номеров — внутри предмета: в новом предмете нумерация с начала
        number = _number(item.label)
        if number is not None:
            last = previous.get(item.subject)
            if last is not None and number > last + 1:
                gaps.append([last + 1, number - 1])
            previous[item.subject] = number
    if user_keys is not None:
        if not user_keys:
            warnings.append({"code": "key_text_unused", "message": KEY_TEXT_NO_PAIRS_WARNING})
        elif not any(item.explicit_from == "key_text" for item in items):
            warnings.append({"code": "key_text_unused", "message": KEY_TEXT_NO_MATCH_WARNING})
    return _result(reader, items, signal, table, markers, gaps, warnings, subjects, topics)


def _keys_for(reader: Reader, item: Item, file_keys: KeyStore) -> dict[str, str]:
    """Ключ списком для вопроса: ключ его варианта, если в файле ключ по вариантам («Вариант 2: 1а 2б», столбцы
    «Вариант 1 | Вариант 2»), иначе общий. Вопрос варианта, у которого ключа нет, общий ключ не берёт: в файле с
    несколькими вариантами он может быть чужим, а неверный ключ хуже, чем никакого."""
    by_variant = reader.variant_keys
    if not by_variant:
        return file_keys
    if item.variant is not None:
        return by_variant.get(item.variant, {})
    if len(by_variant) == 1:
        return next(iter(by_variant.values()))
    return {}


def _cap_pictures(reader: Reader, items: list[Item]) -> None:
    """Картинки сверх MAX_PICTURES_BYTES (по порядку вопросов; одна картинка считается один раз) не переносятся:
    их место становится "", и вопрос получит has_image, как файл без переноса картинок."""
    total = 0
    kept: set[str] = set()
    for item in items:
        for holder in (item, *item.options):
            for k, key in enumerate(holder.images):
                if not key or key in kept:
                    continue
                size = len(reader.pictures.get(key, ("", b""))[1])
                if not size or total + size > MAX_PICTURES_BYTES:
                    holder.images[k] = ""
                    continue
                total += size
                kept.add(key)


def _item_images(item: Item, options: list[Option]) -> Optional[dict]:
    """Перенесённые картинки вопроса: {"stem": [id…], "options": [[id…] по вариантам]} или None."""
    stem = [key for key in item.images if key]
    by_option = [[key for key in o.images if key] for o in options]
    return {"stem": stem, "options": by_option} if stem or any(by_option) else None


def _restart_title(roles: list[str]) -> Optional[int]:
    """Индекс заголовка, который называет новую часть: последний не «Тема…» до первой «Темы…»."""
    first_topic = next((k for k, role in enumerate(roles) if role == "topic"), len(roles))
    candidates = [k for k in range(first_topic) if roles[k] in ("section", "line", "variant")]
    return candidates[-1] if candidates else None


def _sections(reader: Reader, items: list[Item], warnings: list[dict]) -> tuple[list[dict], list[dict]]:
    """Предметы и темы по заголовкам между вопросами; item.subject и item.topic — их номера (с 1).

    1) Заголовок дисциплины («Дисциплина: …», «МДК 01.01 …») начинает предмет — evidence «heading».
    2) Заголовки Word двух уровней и больше: верхний уровень (не «Тема…») — предметы («heading_level»),
       ниже — темы.
    3) Вопрос «1.» после вопросов с номерами 2 и дальше, перед которым новая таблица без «Темы…» или
       заголовок не «Тема…», начинает предмет «restart» (и первая часть файла — тоже «restart»).
    Иначе — один предмет без названия («none»). Темы — заголовки «Тема…» и прочие заголовки разделов;
    пустые предметы и темы убираются, тем больше 300 — хвост сливается с 300-й.
    """
    events = reader.headings
    levels = sorted({e.level for e in events if e.level is not None})
    subject_level = levels[0] if len(levels) >= 2 and any(e.level == levels[0] and e.kind != "topic" for e in events) else None

    def role(event: Heading) -> str:
        if event.kind == "discipline":
            return "subject"
        if subject_level is not None and event.level is not None:
            if event.level == subject_level and event.kind != "topic":
                return "subject_level"
            if event.level > subject_level:
                return "topic"
        return event.kind

    gaps: list[list[Heading]] = []
    pointer = 0
    for item in items:
        gap: list[Heading] = []
        while pointer < len(events) and events[pointer].seq <= item.seq:
            gap.append(events[pointer])
            pointer += 1
        gaps.append(gap)
    roles = [[role(event) for event in gap] for gap in gaps]

    restart_at: set[int] = set()
    previous: Optional[int] = None
    for i, item in enumerate(items):
        number = _number(item.label)
        if number == 1 and previous is not None and previous >= 2 and not any(r in SUBJECT_ROLES for r in roles[i]):
            no_topic = "topic" not in roles[i]
            if _restart_title(roles[i]) is not None or (item.seq in reader.table_starts and no_topic):
                restart_at.add(i)
        if number is not None:
            previous = number

    subjects: list[dict] = []
    topics: list[dict] = []
    subject: Optional[int] = None
    topic: Optional[int] = None

    def start_subject(title: Optional[str], evidence: str) -> None:
        nonlocal subject, topic
        subjects.append({"title": title, "evidence": evidence})
        subject, topic = len(subjects), None

    for i, item in enumerate(items):
        gap, gap_roles = gaps[i], roles[i]
        titled: Optional[int] = None
        if i in restart_at or (i == 0 and restart_at and not any(r in SUBJECT_ROLES for r in gap_roles)):
            titled = _restart_title(gap_roles)
            start_subject(gap[titled].text if titled is not None else None, "restart")
        for k, (event, event_role) in enumerate(zip(gap, gap_roles)):
            if event_role == "subject":
                start_subject(subject_title(event.text), "heading")
            elif event_role == "subject_level":
                start_subject(event.text, "heading_level")
            elif event_role == "topic" or (event_role == "section" and k != titled):
                if subject is None:
                    start_subject(None, "none")
                topics.append({"title": event.text, "subject": subject})
                topic = len(topics)
        if subject is None:
            start_subject(None, "none")
        item.subject, item.topic = subject, topic

    used_subjects = sorted({item.subject for item in items})
    subject_map = {old: new for new, old in enumerate(used_subjects, start=1)}
    used_topics = sorted({item.topic for item in items if item.topic})
    topic_map: dict[int, Optional[int]] = {old: new for new, old in enumerate(used_topics, start=1)}
    kept = [topics[old - 1] for old in used_topics]
    if len(kept) > MAX_TOPICS:
        warnings.append({"code": "topics_merged", "message": TOPICS_MERGED_WARNING.format(count=len(kept))})
        last_subject = kept[MAX_TOPICS - 1]["subject"]
        for old, new in list(topic_map.items()):
            if new is not None and new > MAX_TOPICS:  # хвост — в последнюю тему, если она того же предмета
                topic_map[old] = MAX_TOPICS if topics[old - 1]["subject"] == last_subject else None
        kept = kept[:MAX_TOPICS]
    for item in items:
        item.subject = subject_map[item.subject]
        item.topic = topic_map.get(item.topic) if item.topic else None
    subject_items = Counter(item.subject for item in items)
    topic_items = Counter(item.topic for item in items if item.topic)
    out_subjects = [
        {"index": subject_map[old], "title": subjects[old - 1]["title"], "evidence": subjects[old - 1]["evidence"],
         "items": subject_items[subject_map[old]]}
        for old in used_subjects
    ]
    out_topics = [
        {"index": index, "title": entry["title"], "subject": subject_map[entry["subject"]], "items": topic_items.get(index, 0)}
        for index, entry in enumerate(kept, start=1)
    ]
    if any(entry["evidence"] == "restart" for entry in out_subjects):
        warnings.append({"code": "subjects_restart", "message": SUBJECTS_RESTART_WARNING})
    return out_subjects, out_topics


def _review(reader: Reader, items: list[Item], out_items: list[dict], subjects: int) -> dict:
    """Строки вопросов, уверенность, фрагменты файла и предложение разобрать сложные места с ИИ (bank_markup).

    У вопроса: lines — [первая, последняя] строка в нумерации bank_markup.markup (или None: GIFT, Moodle XML),
    confidence (0…1), doubts (причины). В ответе: doubtful — сомнительных вопросов, source_lines — строки фрагментов
    сомнительных вопросов, вопросов с флагами проверки и, после разбора с ИИ, вопросов в версии модели и тех, что модель
    прочитала иначе (их экран проверки показывает рядом с файлом), с оформлением кусков; ai_offer — bank_markup.offer."""
    lines = bank_markup.markup(reader.blocks, reader.table_kinds) if reader.blocks else []
    full = bank_markup.item_ranges([item.ref for item in items], lines, clip=False) if lines else [None] * len(items)
    ranges = bank_markup.clipped(full)
    by_n = {line.n: line for line in lines}
    for entry, span, (score, why) in zip(out_items, ranges, bank_markup.confidence(out_items)):
        if span and entry["kind"] == "open" and not entry.get("answer"):
            labelled = sum(1 for n in range(span[0] + 1, span[1] + 1) if n in by_n and OPTION_LABEL_RE.match(by_n[n].text.strip()))
            if labelled >= 2:  # под открытым вопросом строки с подписями вариантов, которые разбор не взял (ячейки таблицы)
                score, why = round(max(0.0, score - 0.5), 2), why + ["options_unread"]
        entry["lines"] = list(span) if span else None
        entry["confidence"] = score
        entry["doubts"] = why
    wanted: set[int] = set()
    for entry, span in zip(out_items, ranges):
        if span and (entry["confidence"] < bank_markup.DOUBT_AT or set(entry["flags"]) & REVIEW_FLAGS
                     or entry.get("source") == "ai"):
            wanted.update(range(max(1, span[0] - 1), span[1] + 2))
    return {
        "doubtful": sum(1 for entry in out_items if entry["confidence"] < bank_markup.DOUBT_AT),
        "line_count": len(lines),
        "source_lines": bank_markup.source_lines(lines, wanted),
        "ai_offer": bank_markup.offer(out_items, full, len(lines), len(reader.skipped), subjects, key_lists=reader.key_lists),
    }


def _result(reader: Reader, items: list[Item], signal: Optional[str], table: dict, markers: set[str],
            gaps: list[list[int]], warnings: list[dict], subjects: list[dict], topics: list[dict]) -> dict:
    """Словарь ответа: тексты в пределах базы, marks по признакам документа."""
    shown = [item.options[:MAX_OPTIONS_OUT] for item in items]
    signals = [s for s in FORMAT_SIGNALS if any(o.mark_counts(s)[0] for options in shown for o in options)]
    out_items = []
    for position, (item, options) in enumerate(zip(items, shown), start=1):
        count = len(options)
        out_items.append({
            "position": position,
            "label": item.label[:MAX_LABEL_CHARS],
            "subject": item.subject,
            "topic": item.topic,
            "kind": item.kind,
            "text": item.text[:MAX_QUESTION_CHARS].rstrip() if len(item.text) > MAX_QUESTION_CHARS else item.text,
            "options": [o.text[:MAX_OPTION_CHARS].rstrip() if len(o.text) > MAX_OPTION_CHARS else o.text for o in options],
            "correct": [i for i in item.correct if i < count],
            "order": item.order if all(i < count for i in item.order) else [],
            "pairs": [[a[:MAX_OPTION_CHARS], b[:MAX_OPTION_CHARS]] for a, b in item.pairs[:MAX_OPTIONS_OUT]],
            "answer": item.answer[:MAX_QUESTION_CHARS] if item.answer else item.answer,
            "evidence": item.evidence,
            "flags": list(item.flags),
            # код: знаки кода C, моноширинный шрифт в вопросе или в вариантах, строки SQL и оболочки
            "code": bool(item.mono or CODE_RE.search(item.text) or code_in_lines(item.text)
                         or any(CODE_RE.search(o.text) or any(r.mono for r in o.runs) for o in item.options)),
            "where": item.where,
            "marks": {s: [_mark_value(*o.mark_counts(s)) for o in options] for s in signals},
            "images": _item_images(item, options),
        })
        if item.number:  # выпуск 48: число с допуском (GIFT «{#…}», Moodle numerical)
            out_items[-1]["number"] = item.number
        if item.explanation:  # выпуск 49: пояснение из файла (GIFT «####…» и «#…», Moodle feedback)
            out_items[-1]["explanation"] = item.explanation[:MAX_EXPLANATION_CHARS].rstrip()
        if item.gaps:  # выпуск 49: cloze — формы каждого пропуска по порядку
            out_items[-1]["gaps"] = [list(forms) for forms in item.gaps]
        if item.extras:  # выпуск 49: лишние правые элементы соответствия
            out_items[-1]["extras"] = [extra[:MAX_OPTION_CHARS] for extra in item.extras[:MAX_OPTIONS_OUT]]
        if item.source:  # разбор с ИИ (bank_ai): откуда вопрос и вторая версия, если правила и ИИ разошлись
            out_items[-1]["source"] = item.source
            out_items[-1]["alt"] = item.alt
    used = {key for entry in out_items if entry["images"]
            for key in [*entry["images"]["stem"], *(k for keys in entry["images"]["options"] for k in keys)]}
    clean = sum(1 for item in items if not set(item.flags) & PROBLEM_FLAGS)
    review = _review(reader, items, out_items, len(subjects))
    marker = "+".join(name for symbol, name in MARKER_NAMES if symbol in markers) or None
    return {
        "method": "rules",
        "layout": reader.layouts.most_common(1)[0][0] if reader.layouts else "none",
        "layouts_seen": dict(reader.layouts),
        "variant": reader.variant,
        "confidence": round(clean / len(items), 2) if items else 0.0,
        "key_source": dict(Counter(item.evidence for item in items if item.evidence)),
        "format_signal": signal,
        "format_signals": table,
        "mark_share": MARK_SHARE,
        "marker": marker,
        "markers": sorted(markers),
        "subjects": subjects,
        "topics": topics,
        "skipped": list(reader.skipped),
        "warnings": warnings,
        "items": out_items,
        # картинки вопросов (владелец, 2026-10-14): id (sha256) → тип и base64; клиент кладёт их в хранилище при сохранении
        "pictures": {key: {"type": reader.pictures[key][0], "data": base64.b64encode(reader.pictures[key][1]).decode("ascii")}
                     for key in sorted(used)},
        "stats": {
            "items": len(items),
            "with_key": sum(1 for item in items if item.correct or item.order or item.answer or item.pairs or item.gaps),
            "no_key": sum(1 for item in items if "no_key" in item.flags),
            "ambiguous": sum(1 for item in items if set(item.flags) & AMBIGUOUS_FLAGS),
            "to_check": len(items) - clean,
            "duplicates": sum(1 for item in items if "duplicate" in item.flags),
            "kinds": dict(Counter(item.kind for item in items)),
            "options": {str(k): v for k, v in sorted(Counter(len(item.options) for item in items).items())},
            "gaps": gaps,
            "key_lists": reader.key_lists,
        },
        **review,
    }


def parse_key_text(text: str) -> dict[str, str]:
    """Ключ строками «1 – б», «2. в», «3-а; 4-г» → {номер: ответ}. Строка-заголовок «Ответы:» пропускается."""
    reader = Reader()
    for line in text.replace("\r\n", "\n").split("\n"):
        if line.strip() and not KEY_HEADING_RE.match(line.strip()):
            reader.key_line(line.strip())
    return reader.keys


# ── Ключ отдельным файлом (владелец, 2026-10-14: «ключи в другом файле, а тест в другом») ─────────


# Ключ таблицей «№ | В1 | В2 | В3 | № | В1 | …» (владелец, 2026-10-14: ключ к вариантам 1–3 одним файлом): над столбцами
# ответов — номер варианта («В1», «Вар. 2», «Вариант 3», «1 вар.»), слева — столбец номеров вопросов.
VARIANT_COLUMN_RE = re.compile(r"(?:в(?:ар(?:иант)?)?\.?\s*(?:№\s*)?(\d{1,3})|(\d{1,3})\s*-?\s*(?:й\s+)?вар(?:иант)?\.?)", re.I)
NUMBER_COLUMN_RE = re.compile(r"(?:№|n|no\.?|номер|вопрос|задание)(?:\s*(?:вопроса|задания|п\s*/\s*п))?\.?", re.I)


def variant_columns(rows: list[list[Cell]]) -> Optional[list[dict]]:
    """Таблица ключа со столбцом на вариант → разделы [{"title", "variant", "keys"}] (два варианта и больше), иначе None.

    Строка-шапка (одна из первых трёх): «№» и за ним подписи вариантов, группами слева направо; ниже — строки «1 | В | А |
    А | 41 | А | Г | Б». Столбец берётся по месту в сетке таблицы (объединённые ячейки сдвигают его), ответ — короткий
    («б», «а, в»), иначе пропускается. Без этого такая таблица читалась парами «номер | ответ» — ключ первого варианта
    молча доставался всем."""

    def placed(row: list[Cell]) -> list[tuple[int, str]]:
        out, at = [], 0
        for cell in row:
            out.append((at, "" if cell.continuation else " ".join(cell.text.split())))
            at += max(1, cell.span)
        return out

    for h, header in enumerate(rows[:3]):
        cells = placed(header)
        groups: list[tuple[int, dict[int, int]]] = []
        i = 0
        while i < len(cells):
            if NUMBER_COLUMN_RE.fullmatch(cells[i][1]):
                columns: dict[int, int] = {}
                j = i + 1
                while j < len(cells) and (match := VARIANT_COLUMN_RE.fullmatch(cells[j][1])):
                    columns[cells[j][0]] = int(match.group(1) or match.group(2))
                    j += 1
                if len(columns) >= 2 and len(set(columns.values())) == len(columns):
                    groups.append((cells[i][0], columns))
                i = j
            else:
                i += 1
        variants = sorted({v for _, columns in groups for v in columns.values()})
        if len(variants) < 2:
            continue
        keys: dict[int, dict[str, str]] = {v: {} for v in variants}
        for row in rows[h + 1:]:
            at = dict(placed(row))
            for number_at, columns in groups:
                number = at.get(number_at, "")
                if not NUMBER_CELL_RE.fullmatch(number):
                    continue
                for column, variant in columns.items():
                    value = at.get(column, "")
                    if value and short_key(value):
                        keys[variant][number.rstrip(".")] = value
        sections = [{"title": f"Вариант {v}", "variant": v, "keys": keys[v]} for v in variants if keys[v]]
        return sections if len(sections) >= 2 else None
    return None


def key_sections(blocks: list[Block]) -> list[dict]:
    """Файл ключа → разделы по вариантам: [{"title", "variant", "keys": {номер: ответ}}].

    Заголовок с «вариант N» («КЛЮЧ ОТВЕТОВ — ВАРИАНТ 4») начинает раздел; пары берутся из таблиц («1 | А | 2 | Г»,
    «№ | 1 | 2» над «Ответ | б | а») и строк («1 – А, 2 – Г»). Таблица со столбцом на вариант («№ | В1 | В2 | В3») —
    раздел на каждый вариант (variant_columns). Ключ без заголовков — один раздел без варианта.
    """
    sections: list[dict] = []

    def start(title: str, variant: Optional[int]) -> None:
        sections.append({"title": title[:MAX_TITLE_CHARS], "variant": variant, "keys": {}})

    def add(pairs) -> None:
        if not sections:
            start("", None)
        for number, value in pairs:
            sections[-1]["keys"][str(number).rstrip(".")] = value

    def line(text: str) -> None:
        variant = variant_number(text) if len(text) <= MAX_TITLE_CHARS else None
        if variant is not None and not key_pairs(text):
            start(text, variant)
            text = text.split(":", 1)[1] if ":" in text else ""  # «Ключ к варианту 4: 1-А 2-Б»
        pairs = key_list_pairs(text.strip(), continued=True) if text.strip() else None
        if pairs:
            add(pairs)

    for block in blocks:
        if isinstance(block, Table):
            by_variant = variant_columns(block.rows)
            if by_variant:
                sections.extend(by_variant)
                continue
            across = horizontal_keys(block.rows)
            if across:
                add(across.items())
                continue
            for row in block.rows:
                texts = [" ".join(cell.text.split()) for cell in row if not cell.continuation]
                live = [text for text in texts if text]
                if len(live) == 1:
                    line(live[0])
                    continue
                c = 0
                while c < len(texts):  # «1 | А | 2 | Г»: пары ячеек слева направо
                    if NUMBER_CELL_RE.fullmatch(texts[c]) and c + 1 < len(texts) and short_key(texts[c + 1]):
                        add([(texts[c], texts[c + 1])])
                        c += 2
                        continue
                    if texts[c]:
                        line(texts[c])
                    c += 1
        else:
            text = " ".join(para_text(block).split())
            if text:
                line(text)
    return [section for section in sections if section["keys"]][:MAX_KEY_SECTIONS]


def pick_key_section(sections: list[dict], variant: Optional[int], chosen: Optional[int]) -> tuple[Optional[int], Optional[dict]]:
    """Какой раздел файла ключа взять → (его номер в списке или None, предупреждение или None).

    Выбор пользователя (chosen) — всегда; иначе раздел с вариантом теста; иначе единственный раздел, если варианты не
    спорят (у раздела или у теста номера нет). Чужой вариант молча не берётся: неверный ключ хуже, чем никакого."""
    if not sections:
        return None, None
    if chosen is not None and 0 <= chosen < len(sections):
        return chosen, None
    numbers = [section["variant"] for section in sections]
    if variant is not None and variant in numbers:
        return numbers.index(variant), None
    if len(sections) == 1 and (variant is None or numbers[0] is None):
        return 0, None
    listed = ", ".join(str(n) for n in numbers if n is not None) or str(len(sections))
    if variant is not None:
        return None, {"code": "key_file_variant", "message": KEY_FILE_OTHER_WARNING.format(variant=variant, variants=listed)}
    return None, {"code": "key_file_variant", "message": KEY_FILE_CHOOSE_WARNING.format(variants=listed)}


def _heading_above_table(item: Item) -> bool:
    """Строка без вариантов прямо над таблицей — её заголовок, если не похожа на вопрос («?») и не длинная."""
    return not item.options and not item.answer and not item.text.rstrip().endswith("?") and len(item.text) <= 150


def parse_blocks(blocks: list[Block], *, key_mode: str = "auto", user_keys: Optional[dict[str, str]] = None,
                 line_word: str = "абзац", format_mode: str = "auto", key_file: Optional[list[dict]] = None,
                 key_section: Optional[int] = None, pictures: Optional[dict[str, tuple[str, bytes]]] = None,
                 hand: bool = False) -> dict:
    """Блоки документа (абзацы и таблицы по порядку) → словарь предпросмотра (finish). pictures — картинки DOCX."""
    reader = read_bank(blocks, line_word=line_word, format_mode=format_mode, pictures=pictures)
    return _finish_with_key_file(reader, key_mode=key_mode, user_keys=user_keys, format_mode=format_mode,
                                 key_file=key_file, key_section=key_section, hand=hand)


def read_bank(blocks: list[Block], *, line_word: str = "абзац", format_mode: str = "auto",
              pictures: Optional[dict[str, tuple[str, bytes]]] = None) -> Reader:
    """Блоки документа → вопросы и заголовки разбора по правилам (Reader), до ключей и флагов (finish)."""
    reader = Reader(line_word=line_word, open_mode=format_mode == "open", test_mode=format_mode == "test")
    reader.pictures = pictures or {}
    reader.blocks = blocks
    reader.has_tables = any(isinstance(block, Table) for block in blocks)
    run: list[Para] = []
    start = 0
    for index, block in enumerate(blocks):
        if isinstance(block, Table):
            if run:
                before = len(reader.items)
                reader.paragraphs(run, start)
                # одна-две строки прямо над таблицей без вариантов — её заголовок (тема), а не вопросы;
                # три и больше — список открытых вопросов перед таблицей
                tail = 0
                while tail < len(reader.items) - before and _heading_above_table(reader.items[-1 - tail]):
                    tail += 1
                if tail <= 2:
                    for _ in range(tail):
                        heading = reader.items.pop()
                        reader.heading(f"{heading.label}. {heading.text}" if heading.label else heading.text, "section")
                run = []
            reader.table(block, index)
            start = index + 1
        else:
            run.append(block)
    if run:
        reader.paragraphs(run, start)
    return reader


def _finish_with_key_file(reader: Reader, *, key_mode: str, user_keys: Optional[dict[str, str]], format_mode: str,
                          key_file: Optional[list[dict]], key_section: Optional[int], hand: bool = False) -> dict:
    """finish, а ключ из файла ключа (раздел варианта этого теста) — как ключ списком: старше отметок файла,
    несогласие с ними — key_conflict. Строки, вставленные руками, старше файла ключа."""
    if key_file is None:
        return finish(reader, key_mode=key_mode, user_keys=user_keys, format_mode=format_mode, hand=hand)
    used, warning = pick_key_section(key_file, reader.variant, key_section)
    keys = dict(key_file[used]["keys"]) if used is not None else None
    if keys is not None and user_keys:
        keys.update(user_keys)
    result = finish(reader, key_mode=key_mode, user_keys=keys if keys is not None else user_keys, format_mode=format_mode,
                    hand=hand)
    if warning:
        result["warnings"].append(warning)
    result["key_file"] = {
        "sections": [{"title": s["title"], "variant": s["variant"], "count": len(s["keys"])} for s in key_file],
        "used": used,
    }
    return result


def tsv_table(text: str) -> Optional[Table]:
    """Таблица Word, вставленная в поле текста, приходит строками с табуляциями: строки ячеек. Пустая ячейка под
    заполненной считается объединённой с ней (ячейки № и вопроса у строк вариантов)."""
    lines = [line for line in text.replace("\r\n", "\n").split("\n") if line.strip()]
    # «1.<tab>Вопрос» и «а)<tab>вариант» (список Word, вставленный текстом) — одна табуляция, у строки таблицы — две и больше.
    tabbed = [line for line in lines if line.count("\t") >= 2]
    if len(lines) < 4 or len(tabbed) < len(lines) * 0.6:
        return None
    if sum(1 for line in tabbed if OPTION_LABEL_RE.match(line.strip())) * 2 >= len(tabbed):
        return None  # «а) 180<tab><tab>в) 360» — варианты по два в строке, а не строки таблицы
    width = max(line.count("\t") + 1 for line in lines)
    rows = []
    for line in lines:
        cells = line.split("\t") + [""] * (width - line.count("\t") - 1)
        filled = [c for c in cells if c.strip()]
        if len(filled) == 1 and not cells[-1].strip():
            rows.append([Cell(paras=[Para(runs=[Run(text=filled[0].strip())])], span=width)])
            continue
        rows.append([Cell(paras=[Para(runs=[Run(text=c.strip())])] if c.strip() else [], continuation=not c.strip() and i < width - 1)
                     for i, c in enumerate(cells)])
    return Table(rows=rows)


MD_HEADING_RE = re.compile(r"^(#{1,6})[ \t]+(\S.*?)[ \t#]*$")


def text_blocks(text: str, markdown: bool = False) -> list[Para]:
    """Вставленный текст или TXT: строка — абзац; **жирный** Markdown — жирный кусок (больше ничего не раскрывается).
    markdown (файл .md): «## Тема 2» — заголовок уровня 2 (в тексте «#» в начале строки — комментарий кода)."""
    paras = []
    for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if not line.strip():
            paras.append(Para(runs=[]))
            continue
        heading = MD_HEADING_RE.match(line) if markdown and line[:1] == "#" else None
        if heading:
            paras.append(Para(runs=[Run(text=heading.group(2).replace("**", ""))], outline=len(heading.group(1))))
            continue
        runs: list[Run] = []
        last = 0
        for m in MD_BOLD_RE.finditer(line):
            if m.start() > last:
                runs.append(Run(text=line[last:m.start()]))
            runs.append(Run(text=m.group(1), bold=True))
            last = m.end()
        if last < len(line):
            runs.append(Run(text=line[last:]))
        paras.append(Para(runs=runs))
    return paras


# ── Вход: файл или текст ────────────────────────────────────────────────────────

_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def clean_text(text: str) -> str:
    """Переводы строк — «\\n», без BOM, NUL и управляющих знаков (табуляция остаётся). Линейно: в отличие от
    parser.clean_extracted_text здесь нет «[ \\t]+\\n», который на длинном ряду пробелов перебирается квадратично."""
    return _CONTROL_RE.sub("", text.replace("\ufeff", "").replace("\r\n", "\n").replace("\r", "\n"))


def decode_text(contents: bytes) -> str:
    """Текст TXT/MD, как parser._extract_text: BOM, UTF-16 без BOM, UTF-8, затем cp1251 / cp866 / latin-1 по оценке
    parser._legacy_decode_score — но с линейной clean_text. Нераскодируемый файл — UnicodeDecodeError."""
    if contents.startswith((b"\xff\xfe\x00\x00", b"\x00\x00\xfe\xff")):
        return clean_text(contents.decode("utf-32"))
    if contents.startswith((b"\xff\xfe", b"\xfe\xff")):
        return clean_text(contents.decode("utf-16"))
    if contents.startswith(b"\xef\xbb\xbf"):
        return clean_text(contents.decode("utf-8-sig"))
    sample = contents[:4096]
    if sample and sample.count(b"\x00") / len(sample) > 0.20:
        for encoding in ("utf-16-le", "utf-16-be"):
            try:
                return clean_text(contents.decode(encoding))
            except UnicodeDecodeError:
                pass
    try:
        return clean_text(contents.decode("utf-8"))
    except UnicodeDecodeError:
        pass
    candidates = []
    for encoding in ("cp1251", "cp866", "latin-1"):
        try:
            decoded = clean_text(contents.decode(encoding))
        except UnicodeDecodeError:
            continue
        if _looks_like_text(decoded):
            candidates.append((_legacy_decode_score(decoded), decoded))
    if candidates:
        return max(candidates, key=lambda candidate: candidate[0])[1]
    return clean_text(contents.decode("utf-8", errors="replace"))


_OLE_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
_ENCRYPTED_PACKAGE = "EncryptedPackage".encode("utf-16-le")


def check_file_name(name: str) -> str:
    """Расширение файла (FILE_EXTENSIONS) или BankError 415: «.doc» — old_doc, остальное — unsupported."""
    extension = name.rsplit(".", 1)[-1].lower().strip() if "." in name else ""
    if extension == "doc":
        raise BankError(415, "old_doc", OLD_DOC_DETAIL)
    if extension not in FILE_EXTENSIONS:
        raise BankError(415, "unsupported", UNSUPPORTED_DETAIL)
    return extension


def _sniff(contents: bytes, extension: str) -> str:
    """'docx', 'xlsx', 'pdf', 'moodle', 'html', 'csv' или 'text' по содержимому (переименованный файл читается тем, чем
    он является)."""
    if contents.startswith(b"%PDF-"):
        return "pdf"
    if contents.startswith(_OLE_MAGIC):
        # Word 97–2003 (.doc), переименованный в .docx; файл с паролем — тоже OLE, но с EncryptedPackage
        if extension != "xlsx" and _ENCRYPTED_PACKAGE not in contents:
            raise BankError(415, "old_doc", OLD_DOC_DETAIL)
        raise BankError(422, "unreadable", UNREADABLE_DETAIL)
    if contents.startswith(b"PK\x03\x04"):
        try:
            names = set(check_archive(contents))
        except ArchiveTooLarge:
            raise BankError(413, "too_much_text", TOO_MUCH_TEXT_DETAIL) from None
        except Exception:
            raise BankError(422, "unreadable", UNREADABLE_DETAIL) from None
        if "word/document.xml" in names:
            return "docx"
        if "xl/workbook.xml" in names:
            return "xlsx"
        if extension in ("docx", "xlsx"):
            return extension
        raise BankError(422, "unreadable", UNREADABLE_DETAIL)
    if extension in ("docx", "xlsx", "pdf"):
        raise BankError(422, "unreadable", UNREADABLE_DETAIL)
    head = contents[:2048].lstrip(b"\xef\xbb\xbf \t\r\n").lower()
    if b"<quiz" in contents[:4096].lower() and (head.startswith(b"<?xml") or head.startswith(b"<quiz")):
        return "moodle"
    if extension == "xml":
        raise BankError(422, "unreadable", UNREADABLE_DETAIL)  # XML, но не Moodle
    if extension in ("html", "htm") or head.startswith((b"<!doctype html", b"<html")):
        return "html"
    if extension == "csv":
        return "csv"
    return "text"


def _user_keys(key_text: Optional[str]) -> Optional[dict[str, str]]:
    if key_text is None or not key_text.strip():
        return None
    return parse_key_text(key_text)


def _check_modes(key_mode: str, format_mode: str) -> None:
    if key_mode not in KEY_MODES:
        raise ValueError(f"key_mode {key_mode!r}")
    if format_mode not in FORMAT_MODES:
        raise ValueError(f"format_mode {format_mode!r}")


def _block_chars(blocks: list[Block]) -> int:
    total = 0
    for block in blocks:
        if isinstance(block, Table):
            total += sum(len(para.text) for row in block.rows for cell in row for para in cell.paras)
        else:
            total += len(block.text)
    return total


def _checked(result: dict, format_mode: str) -> dict:
    """Пределы ответа: больше 2000 вопросов — 413; ни одного вопроса (в format «test» — с вариантами) — 422."""
    if result["stats"]["items"] > MAX_ITEMS:
        raise BankError(413, "too_many", TOO_MANY_DETAIL)
    if format_mode == "test":
        if not any(len(item["options"]) >= MIN_OPTIONS for item in result["items"]):
            raise BankError(422, "no_items", NO_TEST_ITEMS_DETAIL)
    elif not result["items"]:
        raise BankError(422, "no_items", NO_ITEMS_DETAIL)
    return result


FORMS_MARK_RE = re.compile(r"^(?:\*\s*(?:обязательно|обязательное поле|required)|(?:всего баллов|total points)\s*:?\s*[\d.,]+\s*/\s*[\d.,]+)$", re.I)
FORMS_SCORE_RE = re.compile(r"^[\d.,]+\s*/\s*[\d.,]+$|^[\d.,]+\s+(?:балл\w*|points?)$", re.I)
FORMS_RIGHT_RE = re.compile(r"^(?:правильный ответ|правильные ответы|correct answers?)$", re.I)


def forms_text(text: str) -> str:
    """Текст формы Google с ответами («* Обязательно», «Всего баллов: 4/6»): без оценок «1/1» и «1 балл», без «*» в конце
    вопроса, а «Правильный ответ» и текст варианта следующей строкой — одной строкой «Правильный ответ: …». Иначе — как был."""
    lines = text.split("\n")
    if not any(FORMS_MARK_RE.match(line.strip()) for line in lines[:60]):
        return text
    out: list[str] = []
    skip_next = False
    for i, line in enumerate(lines):
        if skip_next:
            skip_next = False
            continue
        bare = line.strip()
        if FORMS_MARK_RE.match(bare) or FORMS_SCORE_RE.match(bare):
            continue
        if FORMS_RIGHT_RE.match(bare) and i + 1 < len(lines) and lines[i + 1].strip():
            out.append(f"Правильный ответ: {lines[i + 1].strip()}")
            skip_next = True
            continue
        out.append(line.rstrip()[:-2].rstrip() if bare.endswith(" *") else line)
    return "\n".join(out)


# «(Ответ: б)» строкой под вариантами (в быстрой контрольной так пишут, как и в конце строки вопроса): «Ответ: б».
HAND_ANSWER_LINE_RE = re.compile(
    r"^[ \t]*\((правильн\w*\s+ответ\w*|верн\w*\s+ответ\w*|ответ|answer)[ \t]*[:\-–—][ \t]*([^()\n]{1,40}?)[ \t]*\)[ \t]*$",
    re.I | re.M)
# «*» после верного варианта: в конце строки («б) лакмус *», «b) 4*») и перед следующей подписью в строке вариантов
# («а) HCl б) H2SO4* в) HNO3»). Не «**» (жирный Markdown) и не «*» одна в строке.
HAND_STAR_END_RE = re.compile(r"(?<=[^\s*])[ \t]*\*[ \t]*$", re.M)
HAND_STAR_INLINE_RE = re.compile(r"(?<=[^\s*])[ \t]*\*(?=[ \t]+\(?[а-иА-Иa-hA-H] ?\))")


def hand_text(text: str) -> str:
    """Текст быстрой контрольной перед разбором: «*» после варианта — отметка «(верно)» (её разбор знает и в файлах),
    «(Ответ: б)» строкой — «Ответ: б»."""
    text = HAND_ANSWER_LINE_RE.sub(lambda m: f"{m.group(1)}: {m.group(2)}", text)
    text = HAND_STAR_INLINE_RE.sub(" (верно)", text)
    return HAND_STAR_END_RE.sub(" (верно)", text)


def parse_bank_text(text: str, *, key_mode: str = "auto", key_text: Optional[str] = None, format_mode: str = "auto",
                    key_file: Optional[list[dict]] = None, key_section: Optional[int] = None, markdown: bool = False,
                    hand: bool = False, gift: bool = False) -> dict:
    """Вставленный текст (или текст TXT/MD) → предпросмотр банка. markdown — файл .md. Ошибки — BankError.
    hand — текст быстрой контрольной (paste_api.py): учитель отмечает ответы сам (hand_text), «*» у одного вопроса —
    уже ключ. gift — файл .gift (выпуск 49): читается как GIFT, даже если в нём один вопрос без названия."""
    _check_modes(key_mode, format_mode)
    text = clean_text(text or "")
    if len(text) > MAX_TOTAL_CHARS:
        raise BankError(413, "too_much_text", TOO_MUCH_TEXT_DETAIL)
    if hand:
        text = hand_text(text)
    user_keys = _user_keys(key_text)
    if looks_like_gift(text) or (gift and GIFT_ANSWERS_RE.search(text)):
        return _checked(finish(read_gift(text), key_mode=key_mode, user_keys=user_keys, format_mode=format_mode), format_mode)
    if looks_like_aiken(text):  # выпуск 49: Aiken — свой разбор (вопрос без «?» тоже вопрос)
        return _checked(finish(read_aiken(text), key_mode=key_mode, user_keys=user_keys, format_mode=format_mode), format_mode)
    text = forms_text(text)
    table = tsv_table(text)
    blocks: list[Block] = [table] if table is not None else list(text_blocks(text, markdown=markdown))
    result = parse_blocks(blocks, key_mode=key_mode, user_keys=user_keys, line_word="строка", format_mode=format_mode,
                          key_file=key_file, key_section=key_section, hand=hand)
    return _checked(result, format_mode)


def _file_input(contents: bytes, name: str, pictures: Optional[dict[str, tuple[str, bytes]]] = None) -> tuple[str, object]:
    """Файл → ("text", текст TXT/MD), ("blocks", блоки DOCX/XLSX/CSV/HTML), ("pdf", строки PDF) или ("moodle", вопросы Moodle XML);
    картинки DOCX — в pictures, если он передан. Ошибки — те же BankError, что у банка."""
    extension = check_file_name(name)
    if not contents:
        raise BankError(422, "empty_file", EMPTY_FILE_DETAIL)
    kind = _sniff(contents, extension)
    if kind in ("text", "csv"):
        if len(contents) > TEXT_BYTES_PER_CHAR * MAX_TOTAL_CHARS:
            raise BankError(413, "too_much_text", TOO_MUCH_TEXT_DETAIL)  # заведомо длиннее: не раскодируем
        try:
            text = decode_text(contents)
        except Exception as exc:  # кодировку не угадать: текст исключения пользователю не показываем
            print(f"Bank text decoding failed: {type(exc).__name__}")
            raise BankError(422, "unreadable", UNREADABLE_DETAIL) from None
        if kind == "text":
            return "text", text
    try:
        if kind == "moodle":
            return "moodle", bank_formats.read_moodle(contents)
        if kind == "docx":
            blocks: list[Block] = read_docx(contents, pictures)
        elif kind == "xlsx":
            blocks = list(read_xlsx(contents))
        elif kind == "csv":
            blocks = [bank_formats.read_csv(text)]
        elif kind == "html":
            blocks = bank_formats.read_html(contents)
        else:
            blocks = list(bank_formats.read_pdf(contents))
    except ArchiveTooLarge:
        raise BankError(413, "too_much_text", TOO_MUCH_TEXT_DETAIL) from None
    except bank_formats.PdfScan:
        raise BankError(422, "scan_pdf", SCAN_PDF_DETAIL) from None
    except Exception as exc:  # повреждённый файл: текст исключения пользователю не показываем
        print(f"Bank file read failed: {type(exc).__name__}")
        raise BankError(422, "unreadable", UNREADABLE_DETAIL) from None
    if _block_chars(blocks) > MAX_TOTAL_CHARS:
        raise BankError(413, "too_much_text", TOO_MUCH_TEXT_DETAIL)
    return ("pdf" if kind == "pdf" else "blocks"), blocks


def _file_blocks(contents: bytes, name: str, pictures: Optional[dict[str, tuple[str, bytes]]] = None) -> tuple[Optional[str], list[Block]]:
    """Файл → (текст TXT/MD, []) или (None, блоки); Moodle XML здесь не читается (файл ключа из него не бывает)."""
    kind, value = _file_input(contents, name, pictures)
    if kind == "moodle":
        raise BankError(422, "unreadable", UNREADABLE_DETAIL)
    return (value, []) if kind == "text" else (None, value)  # type: ignore[return-value]


def read_moodle_reader(questions: list) -> "Reader":
    """Вопросы Moodle XML (bank_formats.read_moodle) → вопросы разбора: ответы из разметки файла (evidence «gift», как GIFT)."""
    reader = Reader(line_word="вопрос")
    reader.layouts["moodle_xml"] += 1
    category: Optional[str] = None
    for number, question in enumerate(questions, start=1):
        if question.category and question.category != category:
            category = question.category
            reader.heading(category, "topic")
        item = reader.new_item("", question.text, f"вопрос {number}")
        item.images = [""] * question.images
        if question.kind in ("multichoice", "truefalse"):
            if question.kind == "truefalse" and len(question.options) == 2:
                true_first = question.options[0].strip().lower() in ("true", "верно", "да", "истина")
                weights = question.fractions if true_first else list(reversed(question.fractions))
                item.options = [Option(text="Верно"), Option(text="Неверно")]
                item.kind = "truefalse"
                item.correct = [k for k, weight in enumerate(weights) if weight > 0]
            else:
                item.options = [Option(text=text, runs=[Run(text=text)]) for text in question.options]
                item.correct = [k for k, weight in enumerate(question.fractions) if weight > 0]
                if not question.single or len(item.correct) > 1:
                    item.kind = "multiple"
            item.evidence = "gift" if item.correct else ""
        elif question.kind in ("shortanswer", "numerical"):
            item.kind, item.answer, item.evidence = "open", "; ".join(question.answers) or None, "gift" if question.answers else ""
            if question.kind == "numerical" and question.answers:
                numbers = [canonical_number(a) for a in question.answers]
                tolerances = [_tolerance(t) for t in question.tolerances if t and t.strip()]
                if numbers and all(numbers) and all(tolerances):
                    top = max(tolerances, key=float) if tolerances else None
                    item.number = {"answers": list(dict.fromkeys(numbers))[:10], "tolerance": top if top not in (None, "0") else None}
        elif question.kind == "matching" and question.pairs:
            item.kind, item.pairs = "match", list(question.pairs)
            item.extras = list(question.extras)  # выпуск 49: лишние правые элементы
        elif question.kind == "ordering" and len(question.options) >= 2:
            # выпуск 49: порядок — элементы в верном порядке (как в файле)
            item.kind, item.evidence = "order", "gift"
            item.options = [Option(text=text, runs=[Run(text=text)]) for text in question.options]
            item.order = list(range(len(item.options)))
        elif question.kind == "cloze" and (cloze := moodle_cloze(question)) is not None:
            item.kind, item.evidence = "cloze", "gift"  # выпуск 49: пропуски в тексте
            item.text, item.gaps = cloze
        else:
            item.kind = "open"  # эссе, перетаскивание, cloze, который не перенести: текст вопроса, ответа нет
        item.explanation = question.explanation
    return reader


CLOZE_TYPED = {"SHORTANSWER", "SA", "MW", "SHORTANSWER_C", "SAC", "MWC"}
CLOZE_NUMBER = {"NUMERICAL", "NM"}
CLOZE_CHOICE = {"MULTICHOICE", "MC", "MULTICHOICE_V", "MCV", "MULTICHOICE_H", "MCH", "MULTICHOICE_S", "MCS",
                "MULTICHOICE_VS", "MCVS", "MULTICHOICE_HS", "MCHS"}
MAX_GAPS = 10  # test_items: cloze — 1..10 пропусков, 1..10 форм в каждом, форма 1..200 знаков (docs/kinds/CONTRACT.md)
MAX_GAP_FORMS = 10
MAX_GAP_FORM_CHARS = 200
_CLOZE_LEFT_RE = re.compile(r"\{\d*:[A-Za-z_]{2,40}:")


def moodle_cloze(question) -> Optional[tuple[str, list[list[str]]]]:
    """Вопрос Moodle cloze → (текст с «___» на месте пропусков, формы каждого пропуска) или None — перенести нельзя
    (тогда он остаётся открытым, как раньше). Пропуск SHORTANSWER — его верные (100 %) ответы; NUMERICAL — число без
    допуска (и с запятой); MULTICHOICE — верный вариант, а варианты — в скобках после пропуска по алфавиту (иначе
    вопрос нельзя решить, а порядок файла часто выдаёт ответ). MULTIRESPONSE, допуск, «*» в ответе — None."""
    mark = bank_formats.GAP_MARK
    text = question.cloze_text
    if not question.cloze or not text or len(question.cloze) > MAX_GAPS or text.count(mark) != len(question.cloze):
        return None
    if re.search(r"_{3,}", text) or _CLOZE_LEFT_RE.search(text):
        return None  # свои «___» в тексте спутают пропуски; встроенный ответ, который не прочитан
    gaps: list[list[str]] = []
    shown: list[str] = []
    for kind, alternatives in question.cloze:
        right = [answer for weight, answer in alternatives if weight >= 100 and answer]
        suffix = ""
        if kind in CLOZE_TYPED:
            if any("*" in form for form in right):
                return None  # «*» в Moodle — любой ответ
            forms = right
        elif kind in CLOZE_NUMBER:
            forms = []
            for answer in right:
                value, _, tolerance = answer.partition(":")
                if tolerance.strip() and canonical_number(tolerance) not in ("0", None):
                    return None
                number = canonical_number(value)
                if number is None or (tolerance.strip() and canonical_number(tolerance) is None):
                    return None
                forms += [number] + ([number.replace(".", ",")] if "." in number else [])
        elif kind in CLOZE_CHOICE:
            if len(right) != 1:
                return None
            forms = right
            choices = sorted(dict.fromkeys(answer for _, answer in alternatives if answer), key=str.casefold)
            if len(choices) < 2:
                return None
            suffix = " (" + " / ".join(choices) + ")"
        else:
            return None
        forms = list(dict.fromkeys(" ".join(form.split()) for form in forms))
        if not forms or len(forms) > MAX_GAP_FORMS or any(
                not form or len(form) > MAX_GAP_FORM_CHARS or not re.search(r"\w", form) for form in forms):
            return None
        gaps.append(forms)
        shown.append("___" + suffix)
    pieces = text.split(mark)
    out = pieces[0] + "".join(gap + piece for gap, piece in zip(shown, pieces[1:]))
    return out.strip(), gaps


def read_key_file(contents: bytes, name: str) -> list[dict]:
    """Файл ключа (DOCX, XLSX, TXT, MD) → разделы key_sections. Без пар — BankError 422 no_keys."""
    text, blocks = _file_blocks(contents, name)
    if text is not None:
        text = clean_text(text)
        table = tsv_table(text)
        blocks = [table] if table is not None else list(text_blocks(text))
    sections = key_sections(blocks)
    if not sections:
        raise BankError(422, "no_keys", KEY_FILE_NO_KEYS_DETAIL)
    return sections


def parse_bank_file(contents: bytes, name: str, *, key_mode: str = "auto", key_text: Optional[str] = None,
                    format_mode: str = "auto", key_file: Optional[list[dict]] = None, key_section: Optional[int] = None,
                    with_pictures: bool = False) -> dict:
    """Файл банка (DOCX, XLSX, TXT, MD, CSV, HTML, PDF, Moodle XML) → предпросмотр. Ошибки — BankError с кодом для
    клиента: 415 old_doc / unsupported, 413 too_many / too_much_text, 422 empty_file / unreadable / no_items / scan_pdf.
    key_file — разделы файла ключа (read_key_file), key_section — раздел, выбранный пользователем.
    with_pictures — картинки DOCX переносятся (их просит клиент, который умеет их сохранить: страница, закэшированная до
    этого, сохранила бы вопрос без картинки и без флага has_image); без него картинки — только флаг, как раньше."""
    _check_modes(key_mode, format_mode)
    pictures: Optional[dict[str, tuple[str, bytes]]] = {} if with_pictures else None
    kind, value = _file_input(contents, name, pictures)
    if kind == "text":
        return parse_bank_text(value, key_mode=key_mode, key_text=key_text, format_mode=format_mode,  # type: ignore[arg-type]
                               key_file=key_file, key_section=key_section, markdown=name.lower().endswith(".md"),
                               gift=name.lower().endswith(".gift"))
    if kind == "moodle":
        reader = read_moodle_reader(value)  # type: ignore[arg-type]
        result = _finish_with_key_file(reader, key_mode=key_mode, user_keys=_user_keys(key_text), format_mode=format_mode,
                                       key_file=key_file, key_section=key_section)
        return _checked(result, format_mode)
    line_word = "строка" if kind == "pdf" else "абзац"
    result = parse_blocks(value, key_mode=key_mode, user_keys=_user_keys(key_text), format_mode=format_mode,  # type: ignore[arg-type]
                          key_file=key_file, key_section=key_section, pictures=pictures, line_word=line_word)
    return _checked(result, format_mode)
