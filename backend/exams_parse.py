"""Разбор списка вопросов к экзамену по правилам (без модели).

Вход — текст, который вставил студент, или текст файла (DOCX приходит из
parser.extract_text: строка таблицы — ячейки через « | », абзац с автонумерацией —
«N. текст»). Выход — вопросы для предпросмотра, разделы, билеты и предупреждения.
В базу ничего не пишется: позиции билетов существуют только в этом ответе.

Правила (спека «Билеты» 4.3, правила 1–7, и контракт §4):
1. «Билет № N» начинает билет; остаток строки или ячейки может содержать вопросы
   в строку («1. … 2. …»), ссылки на номера вопросов («вопросы 1 и 21») или один вопрос
   с заглавной буквы. Шапка в той же строке («… по дисциплине «…»», «(весенний семестр)»)
   вопросом не становится.
2. «Раздел/Часть/Модуль/Блок/Тема N» и римский номер «II. …» — заголовок раздела. Им же
   становятся заголовок части списка («Теоретические вопросы», «Практические задания:»,
   «Задачи») вне билета — и над первым вопросом, где иначе был бы шапкой, — и короткая
   строка без номера, «?» и точки между вопросами с номерами («18. …», «Практические
   задания», «19. …»); если номер между ними пропущен ровно один, строка — вопрос.
3. «N.», «N)», «Вопрос N.», «№ N.» в начале строки — вопрос с номером.
4. Шапка документа (вопросы к экзамену, «Экзаменационные билеты», дисциплина, кафедра…)
   пропускается, подписи, даты и колонтитулы — тоже. Шапка, которая повторяется перед
   каждым билетом, пропускается и внутри билетов; строки без номера до первого билета —
   шапка (о них предупреждение unparsed_lines).
5. Строка со строчной буквы после вопроса — продолжение переноса (joined_lines). Строка
   с заглавной — тоже, если номера вокруг идут подряд (n и n+1: отдельного вопроса между
   ними нет) или после двоеточия идут подпункты.
6. Прочие строки — вопросы без видимого номера.
7. Дубли по нормализованному тексту (normalize_question, как в базе) склеиваются,
   билеты ссылаются на первую позицию.
Строка таблицы, где первая ячейка — число, — вопрос с этим номером; строка, где
первая ячейка — «Билет № N», перечисляет вопросы этого билета.
Текст из PDF: номер на отдельной строке («1» над «Предмет и метод») становится номером
следующего вопроса, только если продолжает нумерацию (номер страницы — нет); перенос
после дефиса («инстру-» + «менты») склеивается без пробела.

normalize_question и question_hash повторяют SQL-функции миграции
public.meldy_normalize_question / public.meldy_question_hash: тот же явный набор
букв (без str.lower()), [0-9] вместо \\d, ASCII-пробелы вместо \\s, md5 от UTF-8.
Здесь они нужны только для склейки дублей при разборе; хэш вопроса в базе
вычисляет сама база (генерируемый столбец exam_questions.question_hash).
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field

__all__ = [
    "MAX_QUESTIONS",
    "MAX_SOURCE_CHARS",
    "ParseError",
    "normalize_question",
    "parse_question_list",
    "question_hash",
]

MAX_SOURCE_CHARS = 60_000
MAX_QUESTIONS = 150
MAX_QUESTION_CHARS = 1000  # exam_questions.text: 3..1000 знаков
MIN_QUESTION_CHARS = 3
LONG_QUESTION_CHARS = 400
SHORT_QUESTION_CHARS = 8
MAX_SECTIONS = 20  # exam_questions.section: 1..20
MAX_SECTION_TITLE_CHARS = 200
HEADING_MAX_CHARS = 60  # строка без номера между вопросами длиннее — скорее вопрос, чем заголовок
HEADING_MAX_WORDS = 7
PREAMBLE_MAX_LINES = 8  # шапка до первого билета; больше строк без номера — это уже список
WRAP_MIN_CHARS = 30  # короче строку PDF не переносит
WRAP_SHARE = 0.7  # доля самой длинной строки документа, с которой строка считается доведённой до края

NO_QUESTIONS_DETAIL = "Не нашли ни одного вопроса. Вставьте список, где каждый вопрос начинается с новой строки."
TOO_MANY_DETAIL = "Можно до 150 вопросов. Разбейте список на два экзамена."
TOO_LONG_DETAIL = "Список длиннее 60 000 знаков. Разбейте его на два экзамена."


class ParseError(Exception):
    """Список нельзя разобрать: status — HTTP-статус, detail — текст для пользователя."""

    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


# ── Нормализация вопроса (зеркало SQL из миграции hackathon_journal_exams_oral) ──

_ASCII_SPACE = "[ \\t\\n\\r\\f\\v]"
_LEADING_LABEL_RE = re.compile(
    f"^{_ASCII_SPACE}*([Вв][Оо][Пп][Рр][Оо][Сс]{_ASCII_SPACE}*)?№?{_ASCII_SPACE}*"
    f"[0-9]{{1,3}}(\\.[0-9]{{1,2}})?[.)]{_ASCII_SPACE}*"
)
_UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯё"
_LOWER = "abcdefghijklmnopqrstuvwxyzабвгдеежзийклмнопрстуфхцчшщъыьэюяе"
_CASE_TABLE = str.maketrans(_UPPER, _LOWER)
_NOT_WORD_RE = re.compile("[^0-9a-zа-я]+")


def normalize_question(text: str) -> str:
    """Текст вопроса без номера в начале, регистра, «ё/е» и пунктуации (как meldy_normalize_question)."""
    stripped = _LEADING_LABEL_RE.sub("", text or "", count=1)
    return _NOT_WORD_RE.sub(" ", stripped.translate(_CASE_TABLE)).strip(" ")


def question_hash(text: str) -> str:
    """md5 нормализованного текста в hex (как meldy_question_hash)."""
    return hashlib.md5(normalize_question(text).encode("utf-8")).hexdigest()


# ── Распознавание строк ─────────────────────────────────────────────────────────

_INVISIBLE = dict.fromkeys(map(ord, "​‌‍⁠﻿­"), None)
# Управляющие символы (NUL и прочие, кроме табуляции и переводов строк): PostgreSQL не хранит NUL в text.
_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_SPACES_RE = re.compile(r"\s+")
_MARKDOWN_HEADING_RE = re.compile(r"^(?:#{1,6}|>+)\s*")
_MARKDOWN_BOLD_RE = re.compile(r"(\*\*|__)(.+?)\1")
_ESCAPED_NUMBER_RE = re.compile(r"^(\d{1,3})\\([.)])")
_LETTER_RE = re.compile(r"[A-Za-zА-Яа-яЁё]")

_TICKET_RE = re.compile(
    r"^(?:экзаменационный\s+)?билет\s*(?:№|n\b|no\b\.?)?\s*(\d{1,3})(?!\d)\s*[.:)\-–—]?\s*(.*)$",
    re.IGNORECASE,
)
_SECTION_RE = re.compile(
    r"^(?:раздел|часть|модуль|блок|тема)\s*(?:№\s*)?(?:[IVXLC]{1,6}|\d{1,2})(?![\w])",
    re.IGNORECASE,
)
_ROMAN_SECTION_RE = re.compile(r"^[IVXLC]{1,5}[.)]\s+\S")
# Заголовок части списка — вся строка: «Теоретические вопросы», «ПРАКТИЧЕСКИЕ ЗАДАНИЯ:», «Задачи».
# Без уточнения («Вопросы», «Экзаменационные вопросы») это шапка документа, а не часть списка.
_PART_HEADING_RE = re.compile(
    r"^(?:"
    r"(?:теоретическ|практическ)\w*\s+(?:вопрос|задани|задач|част|упражнени)\w*"
    r"|(?:(?:практическ|ситуационн|расч[её]тн|творческ)\w*\s+)?задач[аи]"
    r"|теория|практика"
    r")\s*[.:]?$",
    re.IGNORECASE,
)
_SECTION_PREFIX_RE = re.compile(
    r"^(?:раздел|часть|модуль|блок|тема)\s*(?:№\s*)?([IVXLC]{1,6}|\d{1,2}(?:\.\d{1,2})?)\s*[.:)\-–—]?\s*",
    re.IGNORECASE,
)
_TOPIC_RE = re.compile(r"^тема\b", re.IGNORECASE)
_NUMBERED_RE = re.compile(
    r"^(?P<prefix>вопрос\s*)?(?P<no>№\s*)?(?P<label>\d{1,3}(?:\.\d{1,2})?)(?P<delim>[.)])?(?P<gap>\s*)(?P<text>\S.*)$",
    re.IGNORECASE,
)
_BARE_NUMBER_RE = re.compile(r"^(?:№\s*)?(\d{1,3}(?:\.\d{1,2})?)\s*[.)]?$")
_INLINE_NUMBER_RE = re.compile(r"(?:(?<=\s)|^)(\d{1,2})([.)])(?:\s+|(?=[A-ZА-ЯЁ«\"]))")
_TICKET_REFS_RE = re.compile(
    r"^(?:вопрос\w*\s*)?(?:№\s*)?\d{1,3}(?:\s*(?:,|;|\+|/|и|&)\s*(?:№\s*)?\d{1,3})+\s*\.?$",
    re.IGNORECASE,
)
_REF_NUMBER_RE = re.compile(r"\d{1,3}")
_HYPHEN_END_RE = re.compile(r"[A-Za-zА-Яа-яЁё]-$")
_BULLET_RE = re.compile(r"^[•·▪◦●○■□➢➤►▸‣⁃∙*\-–—]+\s*")
_PAGE_RE = re.compile(r"^(?:стр\.?|страница|с\.|page)\s*\d+(?:\s*(?:из|/|of)\s*\d+)?\.?$", re.IGNORECASE)

# Шапка, которая сама по себе никогда не бывает вопросом: пропускается в любом месте.
_HEADER_STRONG_RE = re.compile(
    r"^(?:"
    r"(?:примерн\w*\s+|контрольн\w*\s+|экзаменационн\w*\s+)?(?:перечень|список)\s+(?:\w+\s+){0,2}вопрос\w*"
    r"|(?:экзаменационн\w*|контрольн\w*|теоретическ\w*)\s+вопрос\w*"
    r"|вопрос\w*\s+(?:к|для)\s+(?:\w+\s+)?(?:экзамен|зач[её]т|дифференцированн|коллоквиум|промежуточн|итогов|"
    r"самопровер|подготовк|аттестаци)\w*"
    r"|примерн\w*\s+(?:вопрос|тем)\w*"
    r"|(?:тем[аы]|тематик\w*)\s+(?:к|для)\s+\w+"
    r")(?:\s|[.:;,«»\"(]|$)",
    re.IGNORECASE,
)
_HEADER_STRONG_END_RE = re.compile(r"^вопрос\w*\s*:?\s*$", re.IGNORECASE)
# Заголовок документа с билетами («Экзаменационные билеты по дисциплине …», «Билеты к зачёту»):
# пропускается в любом месте и, в отличие от шапки списка вопросов, не закрывает текущий билет
# (так повторяется колонтитул страницы). «Билет № N» — единственное число с номером — сюда не попадает.
_TITLE_RE = re.compile(r"^(?:экзаменационн\w*\s+|зач[её]тн\w*\s+)?билет(?:ы|ов)(?!\w)", re.IGNORECASE)
# Шапка документа: пропускается до первого вопроса блока и в билете (там она повторяется
# перед каждым билетом), только в списке с номерами.
_HEADER_SOFT_RE = re.compile(
    r"^(?:"
    r"(?:по\s+)?(?:учебн\w+\s+)?дисциплин\w*"
    r"|(?:по\s+)?курсу?\s*[:«\"]"
    r"|министерств\w*|федеральн\w*\s+государствен\w*|фгбоу|фгаоу|гбоу|гоу\b|ано\s+во"
    r"|университет\b|институт\b|академия\b|колледж\b|кафедр\w*|факультет\w*|филиал\b"
    r"|(?:(?:для|по)\s+)?направлени\w*\s+подготовки|(?:для|по)\s+направлени\w*"
    r"|(?:(?:для|по)\s+)?специальност\w*|профиль\b|образовательн\w*\s+программ\w*|форма\s+обучени\w*"
    r"|квалификаци\w*|семестр\w*|учебн\w+\s+год\w*|\d\s*курс\b|курс\s*\d|групп[аы]\s*[:№\d]"
    r"|для\s+студент\w*|для\s+обучающ\w*|составител\w*|разработчик\w*|автор\w*\s*:|преподавател\w*\s*:|лектор\w*\s*:"
    r"|утвержд\w*|рассмотрен\w*|одобрен\w*|согласован\w*|принят\w*\s+на"
    r"|(?:экзамен|зач[её]т|коллоквиум)\w*\s*(?:по\b|$)"
    r")",
    re.IGNORECASE,
)
_FOOTER_RE = re.compile(
    r"^(?:зав(?:едующ\w*)?\.?\s*кафедр\w*|составител\w*\s*[:,]|разработчик\w*\s*[:,]|преподавател\w*\s*:"
    r"|экзаменатор\w*|(?:доцент|профессор)\b|ст(?:арш\w*)?\.?\s+преподавател\w*"
    r"|(?:билет\w*\s+)?(?:рассмотрен|утвержд|одобрен|составлен|обсужд)\w*(?:\s+и\s+\w+)?\s+на\s+заседани"
    r"|протокол\s*№|подпись\b|м\.\s*п\.|дата\s*:)",
    re.IGNORECASE,
)
# Остаток строки «Билет № N …», который не вопрос: «Вариант 2», «2024/2025 уч. год».
_TICKET_TAIL_HEADER_RE = re.compile(r"^(?:вариант\w*\s*№?\s*\d*\s*[.:;]?$|\d{4}\s*[/–-]\s*\d{2,4}(?!\d))", re.IGNORECASE)
_TABLE_HEADER_CELL_RE = re.compile(
    r"^(?:№.*|n|no\.?|номер.*|вопрос\w*(?:\s*№?\s*\d{1,2})?|формулировк\w*.*|содержани\w*.*|наименовани\w*.*"
    r"|тем[аы]|раздел\w*|компетенци\w*.*|код.*|билет\w*|п\s*/\s*п|часы|кол-во.*)$",
    re.IGNORECASE,
)


def _clean_line(line: str) -> str:
    line = _CONTROL_RE.sub(" ", line.translate(_INVISIBLE))
    line = _SPACES_RE.sub(" ", line).strip()
    if not line:
        return ""
    if line[0] in "#>":
        line = _MARKDOWN_HEADING_RE.sub("", line)
    if "**" in line or "__" in line:
        line = _MARKDOWN_BOLD_RE.sub(r"\2", line)
    if "\\" in line:
        line = _ESCAPED_NUMBER_RE.sub(r"\1\2", line)
    return line.strip()


def _has_letter(text: str) -> bool:
    return _LETTER_RE.search(text) is not None


def _first_letter(text: str) -> str:
    match = _LETTER_RE.search(text)
    return match.group(0) if match else ""


def _starts_lowercase(text: str) -> bool:
    stripped = text.lstrip(" «\"'„“")
    return bool(stripped) and stripped[0].isalpha() and stripped[0].islower()


def _clean_question_text(text: str) -> str:
    text = _SPACES_RE.sub(" ", text).strip()
    return text.strip(" |").strip()


def _cut(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    cut = text[:limit]
    space = cut.rfind(" ")
    if space >= limit * 0.6:
        cut = cut[:space]
    return cut.rstrip(" ,;:-–—")


def _label_number(label: str) -> int | None:
    head = label.split(".", 1)[0]
    return int(head) if head.isdigit() else None


def _is_section(line: str) -> bool:
    return _SECTION_RE.match(line) is not None or _ROMAN_SECTION_RE.match(line) is not None


def _is_part_heading(line: str) -> bool:
    return _PART_HEADING_RE.match(line) is not None


def _is_strong_header(line: str) -> bool:
    return _HEADER_STRONG_RE.match(line) is not None or _HEADER_STRONG_END_RE.match(line) is not None


def _has_two_letters(text: str) -> bool:
    first = _LETTER_RE.search(text)
    return first is not None and _LETTER_RE.search(text, first.end()) is not None


def _is_ticket_header_text(text: str) -> bool:
    """Текст рядом с «Билет № N», который не формулировка вопроса, а шапка.

    Вопрос в строке билета начинается с заглавной буквы; «по дисциплине …», «для
    направления …», «(весенний семестр)», «Кафедра …», «Вариант 2» — нет.
    """
    stripped = text.strip()
    if not stripped or stripped[0] in "([" or not _has_letter(stripped):
        return True
    if stripped[0].isalpha() and not stripped[0].isupper():
        return True
    if stripped[0] in "«\"„“'" and not _first_letter(stripped).isupper():
        return True
    return bool(
        _HEADER_SOFT_RE.match(stripped)
        or _is_strong_header(stripped)
        or _TITLE_RE.match(stripped)
        or _FOOTER_RE.match(stripped)
        or _TICKET_TAIL_HEADER_RE.match(stripped)
    )


def _inline_chain(text: str, expected: int | None) -> list[re.Match]:
    """Номера вопросов в строку («1. … 2. …»), идущие подряд.

    expected — номер, с которого обязана начаться цепочка (None — с первого найденного).
    Числа не по порядку остаются частью текста («в 2008 г.», «2) спроса» после «1.»).
    """
    chain: list[re.Match] = []
    for match in _INLINE_NUMBER_RE.finditer(text):
        number = int(match.group(1))
        if not chain:
            if expected is not None and number != expected:
                continue
            chain.append(match)
        elif number == int(chain[-1].group(1)) + 1:
            chain.append(match)
    return chain


def _chain_items(text: str, chain: list[re.Match]) -> list[tuple[str, str]]:
    items: list[tuple[str, str]] = []
    for index, match in enumerate(chain):
        end = chain[index + 1].start() if index + 1 < len(chain) else len(text)
        body = text[match.end():end].strip()
        if body:
            items.append((match.group(1), body))
    return items


# ── Первый проход: строки → записи ──────────────────────────────────────────────


@dataclass
class _Entry:
    kind: str  # section | ticket | end_ticket | question | refs
    text: str = ""
    label: str = ""
    numbered: bool = False
    in_ticket: bool = False
    joined: bool = False
    number: int | None = None
    refs: list[str] = field(default_factory=list)
    keep_ticket: bool = False  # раздел из ячейки таблицы внутри билета не закрывает билет
    ticket_line: bool = False  # текст из самой строки «Билет № N …»
    bullet: bool = False  # строка начиналась маркером списка («–», «•»)
    line_chars: int = 0  # длина последней строки исходника в этой записи (0 — ячейка таблицы)
    part: bool = False  # раздел — заголовок части списка («Практические задания»), вопросом не становится


# Текст вопроса дальше не наращивается: он всё равно обрезается до MAX_QUESTION_CHARS
# (_cut смотрит только на начало), а склейка без потолка стоит O(n²) на длинном вводе.
_JOIN_CAP_CHARS = MAX_QUESTION_CHARS + 100


def _append(base: str, separator: str, addition: str) -> str:
    if len(base) > _JOIN_CAP_CHARS:
        return base
    return f"{base}{separator}{addition}"


class _Scanner:
    def __init__(self, lines: list[str]) -> None:
        self.lines = lines
        self.entries: list[_Entry] = []
        self.last_question: _Entry | None = None
        self.in_ticket = False
        self.block_has_question = False
        self.block_has_numbered = False
        self.seen_question = False
        self.seq: int | None = None
        self.sub_seq: int | None = None
        self.main_delim: str | None = None
        self.table_mode: str | None = None
        self.dropped_service_lines = 0
        self.pending_label: str | None = None  # номер на отдельной строке (таблица из PDF): «1» над «Предмет и метод»
        self.line_chars = 0  # длина текущей строки исходника
        # Строка, доведённая почти до правого края, — кандидат на перенос (PDF режет по ширине страницы).
        longest = max((len(line) for line in lines if line and " | " not in line), default=0)
        self.wrap_chars = max(WRAP_MIN_CHARS, int(longest * WRAP_SHARE))

        self.has_numbered = any(
            (match := _NUMBERED_RE.match(line)) is not None and match.group("delim") and _has_letter(match.group("text"))
            for line in lines
        ) or any(" | " in line for line in lines)
        starts = [_starts_lowercase(_BULLET_RE.sub("", line)) for line in lines if _has_letter(line)]
        lowercase_majority = bool(starts) and sum(starts) * 2 > len(starts)
        # Строку со строчной буквы считаем переносом, если список с номерами
        # или большинство строк начинается с заглавной.
        self.join_lowercase = self.has_numbered or not lowercase_majority

    # — записи —

    def _reset_block(self) -> None:
        self.seq = None
        self.sub_seq = None
        self.main_delim = None
        self.block_has_question = False
        self.block_has_numbered = False
        self.last_question = None

    def add_section(self, title: str, *, keep_ticket: bool = False, part: bool = False) -> None:
        self.entries.append(_Entry("section", text=title[:MAX_SECTION_TITLE_CHARS], keep_ticket=keep_ticket, part=part))
        if keep_ticket:
            return
        self.in_ticket = False
        self._reset_block()

    def start_ticket(self, number: int) -> None:
        self.entries.append(_Entry("ticket", number=number))
        self.in_ticket = True
        self._reset_block()

    def end_ticket(self) -> None:
        if self.in_ticket:
            self.entries.append(_Entry("end_ticket"))
            self.in_ticket = False
            self._reset_block()

    def add_question(
        self,
        text: str,
        label: str = "",
        numbered: bool = False,
        delim: str | None = None,
        *,
        ticket_line: bool = False,
        bullet: bool = False,
    ) -> None:
        text = _clean_question_text(text)
        if not _has_letter(text):
            return
        entry = _Entry(
            "question",
            text=text,
            label=label,
            numbered=numbered,
            in_ticket=self.in_ticket,
            ticket_line=ticket_line,
            bullet=bullet,
            line_chars=self.line_chars,
        )
        self.entries.append(entry)
        self.last_question = entry
        self.block_has_question = True
        self.seen_question = True
        self.sub_seq = None
        if numbered:
            self.block_has_numbered = True
            number = _label_number(label)
            if number is not None and "." not in label:
                self.seq = number
            if delim and self.main_delim is None:
                self.main_delim = delim

    def add_refs(self, text: str) -> None:
        self.entries.append(_Entry("refs", refs=_REF_NUMBER_RE.findall(text)))

    def join(self, text: str, separator: str = " ") -> None:
        question = self.last_question
        assert question is not None
        if len(question.text) > _JOIN_CAP_CHARS:  # дальше текст всё равно обрежется
            question.joined = True
            question.line_chars = self.line_chars
            return
        addition = _clean_question_text(text)
        if not addition:
            return
        # Только хвост: поиск «буква-$» по всему тексту на каждой строке давал O(n²).
        if separator == " " and _HYPHEN_END_RE.search(question.text[-2:]) and _starts_lowercase(addition):
            separator = ""  # перенос по слогам или по дефису: «инстру-» + «менты», «денежно-» + «кредитная»
        question.text = _append(question.text, separator, addition)
        question.joined = True
        question.line_chars = self.line_chars

    def drop_service_line(self) -> None:
        if self.seen_question:
            self.dropped_service_lines += 1

    # — разбор —

    def scan(self) -> list[_Entry]:
        for line in self.lines:
            if not line:
                continue
            if " | " in line:
                self.pending_label = None
                self.line_chars = 0
                self.table_row(line.split(" | "))
                continue
            self.table_mode = None
            self.line_chars = len(line)
            self.line(line)
        return self.entries

    def _label_from_pending(self, pending: str | None) -> str | None:
        """Номер с отдельной строки годится, только если продолжает нумерацию (иначе это номер страницы)."""
        if pending is None or "." in pending:
            return None
        expected = 1 if self.seq is None else self.seq + 1
        return pending if _label_number(pending) == expected else None

    def line(self, line: str, from_table: bool = False) -> None:
        pending, self.pending_label = self.pending_label, None
        bare = _BARE_NUMBER_RE.match(line)
        if bare and not from_table:
            self.pending_label = bare.group(1)
            return
        ticket = _TICKET_RE.match(line)
        if ticket:
            self.start_ticket(int(ticket.group(1)))
            remainder = ticket.group(2).strip()
            if remainder:
                self.ticket_remainder(remainder)
            return
        if _is_section(line) and not _NUMBERED_RE.match(line):
            self.add_section(line)
            return
        if not self.in_ticket and _is_part_heading(line):
            # «Теоретические вопросы» над пунктом 1 — раздел, а не шапка; в билете это шапка билета.
            self.add_section(line.rstrip(" .:"), part=True)
            return
        if _PAGE_RE.match(line) or not _has_letter(line):
            return
        if _TITLE_RE.match(line):
            return
        if _is_strong_header(line):
            self.end_ticket()
            return
        numbered = self._numbered(line)
        if numbered is None and self._is_soft_header(line):
            if self.block_has_numbered:
                self.drop_service_line()  # шапка следующего билета посреди списка — об этом скажем
            return
        if numbered is None and _FOOTER_RE.match(line):
            self.drop_service_line()
            return
        if numbered is not None:
            label, delim, text = numbered
            if self._is_sub_item(label, delim):
                self.join(line, " " if self.last_question and self.last_question.text.endswith((":", ";", ",")) else "; ")
                self.sub_seq = _label_number(label)
                return
            chain = _inline_chain(text, (_label_number(label) or 0) + 1) if "." not in label else []
            if len(chain) >= 2:  # список, слитый в одну строку: «1. A. 2. B. 3. C.»
                self.add_question(text[: chain[0].start()], label, True, delim)
                for item_label, item_text in _chain_items(text, chain):
                    self.add_question(item_text, item_label, True, delim)
                return
            self.add_question(text, label, True, delim)
            return
        if self._is_continuation(line):
            bullet = _BULLET_RE.match(line)
            if bullet and bullet.group(0).strip():
                text = line[bullet.end():]
                previous = self.last_question.text if self.last_question else ""
                self.join(text, " " if previous.endswith((":", ";", ",")) else "; ")
            else:
                self.join(line)
            return
        if not _has_two_letters(line):
            self.drop_service_line()  # дата и подпись ««___» ________ 20__ г.»
            return
        bullet = _BULLET_RE.match(line)
        is_bullet = bool(bullet and bullet.group(0).strip())
        label = self._label_from_pending(pending)
        if label is not None:
            self.add_question(_BULLET_RE.sub("", line), label, True, ".", bullet=is_bullet)
            return
        self.add_question(_BULLET_RE.sub("", line), bullet=is_bullet)

    def _is_soft_header(self, line: str) -> bool:
        """Строка шапки («Кафедра …», «по дисциплине …») в списке с номерами.

        До первого вопроса блока — всегда; в билете и после его вопросов, потому что шапка
        следующего билета стоит перед его строкой «Билет № N». Строка со строчной буквы
        после вопроса — перенос, а не шапка.
        """
        if not self.has_numbered or not _HEADER_SOFT_RE.match(line):
            return False
        if not self.block_has_numbered:
            return True
        return self.in_ticket and not (self.join_lowercase and _starts_lowercase(line))

    def _numbered(self, line: str) -> tuple[str, str | None, str] | None:
        match = _NUMBERED_RE.match(line)
        if match is None:
            return None
        label, delim, gap, text = match.group("label"), match.group("delim"), match.group("gap"), match.group("text")
        prefixed = bool(match.group("prefix") or match.group("no"))
        if not _has_letter(text):
            return None
        if delim:
            if not gap and not (text[0].isalpha() or text[0] in "«\"(“"):
                return None  # «12.03.2024», «1.5x»
            return label, delim, text
        if not gap:
            return None
        if prefixed:
            return label, None, text
        # Без точки или скобки («12 Рынок труда») — только с заглавной буквы и по порядку номеров.
        number = _label_number(label)
        if not text[0].isupper():
            return None
        if "." in label:
            return label, None, text
        expected = 1 if self.seq is None else self.seq + 1
        if number is not None and expected <= number <= expected + 2:
            return label, None, text
        return None

    def _is_sub_item(self, label: str, delim: str | None) -> bool:
        """«1) мера стоимости» под «1. Функции денег»: другой разделитель и номер не по порядку."""
        if self.last_question is None or not self.last_question.numbered or self.main_delim is None:
            return False
        if not delim or delim == self.main_delim or "." in label:
            return False
        number = _label_number(label)
        if number is None:
            return False
        if self.sub_seq is not None and number == self.sub_seq + 1:
            return True  # следующий подпункт того же вопроса
        return self.seq is not None and number != self.seq + 1

    def _is_continuation(self, line: str) -> bool:
        if self.last_question is None:
            return False
        bullet = _BULLET_RE.match(line)
        if bullet and bullet.group(0).strip():
            rest = line[bullet.end():]
            return self.last_question.numbered and self.join_lowercase and _starts_lowercase(rest)
        first = line[0]
        if first in ",;:)(":
            return True
        return self.join_lowercase and _starts_lowercase(line)

    def ticket_cell(self, text: str) -> None:
        text = text.lstrip(" .:;—–-").strip()
        if not text:
            return
        if _TICKET_REFS_RE.match(text):
            self.add_refs(text)
            return
        chain = _inline_chain(text, None)
        if chain:
            prefix = text[: chain[0].start()].strip()
            if not _has_letter(prefix) or _is_strong_header(prefix) or _is_ticket_header_text(prefix):
                for label, body in _chain_items(text, chain):
                    self.add_question(body, label, True)
                return
        self.add_question(text)

    def ticket_remainder(self, text: str) -> None:
        """Остаток строки «Билет № N …»: вопросы в строку, ссылки на номера или один вопрос.

        Шапка в той же строке («… по дисциплине «Макроэкономика»», «(весенний семестр)»,
        «Вариант 2») вопросом не становится.
        """
        text = text.lstrip(" .:;—–-").strip()
        if not text:
            return
        if _TICKET_REFS_RE.match(text) or _inline_chain(text, None):
            self.ticket_cell(text)
            return
        if _is_ticket_header_text(text):
            return
        self.add_question(text, ticket_line=True)

    def table_row(self, raw_cells: list[str]) -> None:
        cells = [cell.strip() for cell in raw_cells if cell.strip()]
        if not cells:
            return
        if all(_TABLE_HEADER_CELL_RE.match(cell) for cell in cells) and not _BARE_NUMBER_RE.match(cells[0]):
            self.table_mode = "tickets" if any(cell.lower().startswith("билет") or "билета" in cell.lower() for cell in cells) else "questions"
            return
        section_title: str | None = None
        ticket_number: int | None = None
        ticket_tail = ""  # остаток ячейки «Билет № N …»
        label: str | None = None
        rest: list[str] = []
        for cell in cells:
            if rest or label is not None:
                rest.append(cell)
                continue
            ticket = _TICKET_RE.match(cell) if ticket_number is None else None
            if ticket:
                ticket_number = int(ticket.group(1))
                ticket_tail = ticket.group(2).strip()
                continue
            if section_title is None and ticket_number is None and _is_section(cell) and len(cell) <= 120:
                section_title = cell
                continue
            bare = _BARE_NUMBER_RE.match(cell)
            if bare:
                label = bare.group(1)
                continue
            rest.append(cell)

        if section_title is not None:
            self.add_section(section_title, keep_ticket=self.in_ticket and ticket_number is None)
        if ticket_number is None and label is not None and self.table_mode == "tickets" and rest:
            number = _label_number(label)
            if number is not None:
                ticket_number, label = number, None
        if ticket_number is not None:
            self.start_ticket(ticket_number)
            if ticket_tail:
                self.ticket_remainder(ticket_tail)
            for cell in rest:
                self.ticket_cell(cell)
            return
        texts = [cell for cell in rest if _has_letter(cell)]
        if not texts:
            return
        if label is not None:
            self.add_question(max(texts, key=len), label, True, ".")
            return
        self.line(max(texts, key=len), from_table=True)


# ── Второй проход: записи → вопросы, разделы, билеты ────────────────────────────


@dataclass
class _Question:
    text: str
    label: str
    numbered: bool
    in_ticket: bool
    joined: bool
    section: int | None
    ticket: int | None
    flags: list[str] = field(default_factory=list)
    duplicate_of: int | None = None
    position: int | None = None


def _promote_outline_sections(entries: list[_Entry]) -> list[_Entry]:
    """«1. Введение» прямо перед «1.1. …» — заголовок раздела, а не вопрос."""
    result: list[_Entry] = []
    for index, entry in enumerate(entries):
        if entry.kind == "question" and entry.numbered and entry.label.isdigit():
            following = entries[index + 1] if index + 1 < len(entries) else None
            if (
                following is not None
                and following.kind == "question"
                and following.label.startswith(entry.label + ".")
            ):
                result.append(_Entry("section", text=f"{entry.label}. {entry.text}"[:MAX_SECTION_TITLE_CHARS]))
                continue
        result.append(entry)
    return result


def _is_block_boundary(entry: _Entry) -> bool:
    return entry.kind in ("ticket", "end_ticket", "refs") or (entry.kind == "section" and not entry.keep_ticket)


def _drop_repeated_ticket_headers(entries: list[_Entry]) -> tuple[list[_Entry], int]:
    """Шапка, которая повторяется в билетах и не распознана правилами, — не вопрос.

    «Российский экономический университет …» перед каждой строкой «Билет № N» (то есть
    в конце каждого билета, кроме последнего, и до первого билета) или «Макроэкономика» в
    самой строке билета. Кандидаты — текст из строки «Билет № N …», строки без номера в
    билете, где остальные вопросы с номерами, и строки без номера до первого билета. Текст
    (normalize_question) убирается отовсюду, если он есть в трёх билетах, во всех билетах
    кроме одного (от двух) или и до первого билета, и в билете. Возвращает записи и число
    убранных строк.
    """
    ordinals: list[int | None] = []  # 0 — до первого билета, 1… — номер билета по порядку
    numbered_tickets: set[int] = set()
    tickets_with_questions: set[int] = set()
    current: int | None = 0
    count = 0
    for entry in entries:
        if entry.kind == "ticket":
            count += 1
            current = count
        elif entry.kind == "end_ticket" or (entry.kind == "section" and not entry.keep_ticket):
            current = None
        if entry.kind != "question":
            ordinals.append(None)
        elif current == 0 and not entry.in_ticket:
            ordinals.append(0)
        else:
            ordinals.append(current if entry.in_ticket else None)
        ordinal = ordinals[-1]
        if ordinal:
            tickets_with_questions.add(ordinal)
            if entry.numbered:
                numbered_tickets.add(ordinal)
    if not tickets_with_questions:
        return entries, 0
    groups: dict[str, list[int]] = {}
    for index, entry in enumerate(entries):
        ordinal = ordinals[index]
        if ordinal is None or entry.numbered:
            continue
        if ordinal and not (entry.ticket_line or ordinal in numbered_tickets):
            continue
        key = normalize_question(entry.text)
        if key:
            groups.setdefault(key, []).append(index)
    drop: set[int] = set()
    for indices in groups.values():
        seen = {ordinals[index] for index in indices}
        in_tickets = len(seen - {0})
        if (
            in_tickets >= 3
            or (in_tickets >= 2 and in_tickets >= len(tickets_with_questions) - 1)
            or (0 in seen and in_tickets >= 1)
        ):
            drop.update(indices)
    if not drop:
        return entries, 0
    return [entry for index, entry in enumerate(entries) if index not in drop], len(drop)


def _text_end(text: str) -> str:
    stripped = text.rstrip(" »\"'”)]")
    return stripped[-1:]


_TERMINAL_ENDS = ".?!…"
_OPEN_ENDS = ":;,"


def _label_parts(label: str) -> list[int] | None:
    pieces = label.split(".")
    if not pieces or not all(piece.isdigit() for piece in pieces):
        return None
    return [int(piece) for piece in pieces]


def _label_follows(previous: str, following: str) -> bool:
    """following продолжает нумерацию previous: 4 → 5, 1.2 → 1.3, 1.3 → 2.1."""
    a, b = _label_parts(previous), _label_parts(following)
    if a is None or b is None or len(a) != len(b):
        return False
    if len(a) == 1:
        return b[0] == a[0] + 1
    if len(a) == 2:
        return (b[0] == a[0] and b[1] == a[1] + 1) or (b[0] == a[0] + 1 and b[1] == 1)
    return False


def _join_wrapped_lines(entries: list[_Entry], wrap_chars: int) -> list[_Entry]:
    """Строка без номера после вопроса с номером, которая не может быть отдельным вопросом.

    - Подпункты после двоеточия («Функции денег:» + «- Мера стоимости;» + …).
    - Номера n и n+1 идут подряд, значит отдельного вопроса кафедры между ними нет:
      перенос строки из PDF («…показатели и их» + «ВВП, ВНД: способы измерения.») или
      второе предложение вопроса. Короткая строка без точки после короткого вопроса
      («2. ВВП» + «Денежный рынок») похожа на заголовок и остаётся отдельной — о ней
      говорит предупреждение mixed_numbering.
    - Последний вопрос блока без точки, доведённый почти до края строки (wrap_chars), —
      перенос и без следующего номера.
    Склеенный вопрос получает флаг joined_lines.
    """
    next_label: list[str | None] = [None] * len(entries)
    later_question: list[bool] = [False] * len(entries)
    upcoming: str | None = None
    seen_question = False
    for index in range(len(entries) - 1, -1, -1):
        entry = entries[index]
        next_label[index] = upcoming
        later_question[index] = seen_question
        if entry.kind == "question":
            seen_question = True
            if entry.numbered:
                upcoming = entry.label
        elif _is_block_boundary(entry):
            upcoming = None
            seen_question = False

    result: list[_Entry] = []
    anchor: _Entry | None = None  # последний вопрос с номером, к которому ещё можно приклеить строку
    subitems = False
    numbered_in_block = 0
    for index, entry in enumerate(entries):
        if entry.kind != "question":
            result.append(entry)
            if _is_block_boundary(entry):
                anchor, subitems, numbered_in_block = None, False, 0
            continue
        if entry.numbered:
            result.append(entry)
            anchor, subitems = entry, False
            numbered_in_block += 1
            continue
        if anchor is not None:
            end = _text_end(anchor.text)
            follows = next_label[index] is not None and _label_follows(anchor.label, next_label[index] or "")
            own_end = _text_end(entry.text)
            wrapped = anchor.line_chars >= wrap_chars  # строка вопроса дошла до края — её перенесли
            glue = False
            if end == ":":
                glue, subitems = True, True
            elif subitems and end in _OPEN_ENDS:
                glue = True
            elif follows:
                if end in _TERMINAL_ENDS:
                    glue = own_end in _TERMINAL_ENDS
                else:
                    glue = wrapped or end in _OPEN_ENDS or own_end in _TERMINAL_ENDS
            elif not later_question[index] and numbered_in_block >= 2:
                glue = wrapped and end not in _TERMINAL_ENDS
            if glue:
                if entry.bullet:
                    separator = " " if end in _OPEN_ENDS else "; "
                elif _HYPHEN_END_RE.search(anchor.text[-2:]) and _starts_lowercase(entry.text):
                    separator = ""
                else:
                    separator = " "
                anchor.text = _append(anchor.text, separator, entry.text)
                anchor.joined = True
                anchor.line_chars = entry.line_chars
                continue
        result.append(entry)
        anchor, subitems = None, False
    return result


def _one_label_missing(previous: str, following: str) -> bool:
    """Между номерами пропущен ровно один: 17 → 19, 1.2 → 1.4, 1.3 → 2.2."""
    parts = _label_parts(previous)
    if parts is None:
        return False
    if len(parts) == 1:
        skipped = [str(parts[0] + 1)]
    elif len(parts) == 2:
        skipped = [f"{parts[0]}.{parts[1] + 1}", f"{parts[0] + 1}.1"]
    else:
        return False
    return any(_label_follows(label, following) for label in skipped)


def _looks_like_heading(text: str) -> bool:
    """Короткая строка с заглавной буквы, без «?» и без точки (двоеточие можно): «Практические задания»."""
    text = text.strip()
    if not text or len(text) > HEADING_MAX_CHARS or len(text.split()) > HEADING_MAX_WORDS or "?" in text:
        return False
    if _text_end(text) in ".!…;,":
        return False
    return _first_letter(text).isupper()


def _promote_inline_headings(entries: list[_Entry]) -> list[_Entry]:
    """Строка без номера между двумя вопросами с номерами вне билетов — заголовок раздела, если похожа
    на заголовок («18. …», «Практические задания», «19. …»; нумерация может и начаться заново).

    Остаётся вопросом строка с «?» или точкой, длинная, с маркером списка и строка, вместо которой
    в нумерации пропущен ровно один номер («17. …», «Нормализация», «19. …» — вопрос 18 без номера).
    Перенос строки к этому времени уже приклеен (_join_wrapped_lines).
    """

    def numbered(entry: _Entry) -> bool:
        return entry.kind == "question" and entry.numbered and not entry.in_ticket

    result = list(entries)
    for index in range(1, len(entries) - 1):
        entry, before, after = entries[index], entries[index - 1], entries[index + 1]
        if entry.kind != "question" or entry.numbered or entry.in_ticket or entry.bullet or entry.ticket_line:
            continue
        if not (numbered(before) and numbered(after)) or not _looks_like_heading(entry.text):
            continue
        if _one_label_missing(before.label, after.label):
            continue
        result[index] = _Entry("section", text=entry.text.strip().rstrip(" .:")[:MAX_SECTION_TITLE_CHARS], part=True)
    return result


def _is_caps(text: str) -> bool:
    letters = _LETTER_RE.findall(text)
    return len(letters) >= 4 and all(letter.isupper() for letter in letters)


def _drop_caps_title(entries: list[_Entry]) -> tuple[list[_Entry], int]:
    """Список без номеров: первая строка заглавными («МАКРОЭКОНОМИКА») над обычными
    вопросами — название курса, а не вопрос. Сказано в unparsed_lines."""
    first = next((index for index, entry in enumerate(entries) if entry.kind != "section"), None)
    if first is None or entries[first].kind != "question" or entries[first].numbered or entries[first].in_ticket:
        return entries, 0
    if not _is_caps(entries[first].text):
        return entries, 0
    rest = [entry for entry in entries[first + 1:] if entry.kind == "question"]
    if len(rest) < 2 or any(_is_caps(entry.text) for entry in rest):
        return entries, 0
    return entries[:first] + entries[first + 1:], 1


def _drop_preamble(entries: list[_Entry]) -> tuple[list[_Entry], int]:
    """Строки без номера до первого вопроса с номером — шапка документа («Макроэкономика»).

    Только для списков, где вопросы в основном с номерами. Строка с «?» остаётся
    вопросом; если первый номер — 2, последняя строка перед ним — это вопрос 1. Заголовок
    части списка между шапкой и первым вопросом («Теоретические вопросы») шапку не прерывает.
    В документе из билетов, где все вопросы после первого билета стоят в билетах, строки
    без номера до первого билета — шапка (название курса), их не больше PREAMBLE_MAX_LINES.
    Возвращает записи и число отброшенных строк, о которых стоит сказать: в билетах — все,
    в списке — похожие на вопрос (от 25 знаков).
    """
    first_ticket = next((index for index, entry in enumerate(entries) if entry.kind == "ticket"), None)
    if first_ticket is not None:
        before = [index for index in range(first_ticket) if entries[index].kind == "question"]
        after = [entry for entry in entries[first_ticket:] if entry.kind == "question"]
        if (
            before
            and after
            and all(entry.in_ticket for entry in after)
            and not any(entries[index].numbered for index in before)
            and len(before) <= PREAMBLE_MAX_LINES
        ):
            dropped = set(before)
            return [entry for index, entry in enumerate(entries) if index not in dropped], len(dropped)
    questions = [entry for entry in entries if entry.kind == "question" and not entry.in_ticket]
    numbered = [entry for entry in questions if entry.numbered]
    if not numbered or len(numbered) * 5 < len(questions) * 3:
        return _drop_caps_title(entries)
    preamble: list[int] = []
    first_numbered: _Entry | None = None
    for index, entry in enumerate(entries):
        if entry.kind == "ticket" or (entry.kind == "section" and not entry.part):
            break
        if entry.kind == "question" and not entry.in_ticket:
            if entry.numbered:
                first_numbered = entry
                break
            if not entry.text.rstrip().endswith("?"):
                preamble.append(index)
    if first_numbered is None:
        return entries, 0
    if preamble and _label_number(first_numbered.label) == 2 and "." not in first_numbered.label:
        preamble = preamble[:-1]
    drop = set(preamble)
    suspicious = sum(1 for index in preamble if len(entries[index].text) >= 25)
    return [entry for index, entry in enumerate(entries) if index not in drop], suspicious


def _sections_as_questions(entries: list[_Entry]) -> list[_Entry]:
    """Список без вопросов, из одних заголовков: вопросы — это темы.

    «Тема 1.1. …» под «Раздел 1. …» — вопрос, а раздел остаётся разделом. Если тем нет
    («Раздел 1. …», «I. …» подряд), вопросами становятся все заголовки.
    """
    sections = [entry for entry in entries if entry.kind == "section"]
    topics = [entry for entry in sections if _TOPIC_RE.match(entry.text)]
    only_topics = bool(topics) and len(topics) < len(sections)
    converted: list[_Entry] = []
    for entry in entries:
        if entry.kind != "section" or entry.part or (only_topics and not _TOPIC_RE.match(entry.text)):
            converted.append(entry)  # «Практические задания» — не тема, а часть списка
            continue
        prefix = _SECTION_PREFIX_RE.match(entry.text)
        if prefix and entry.text[prefix.end():].strip():
            converted.append(_Entry("question", text=entry.text[prefix.end():].strip(), label=prefix.group(1), numbered=True))
        else:
            roman = re.match(r"^([IVXLC]{1,5})[.)]\s+(.+)$", entry.text)
            if roman:
                converted.append(_Entry("question", text=roman.group(2), label=roman.group(1), numbered=True))
            else:
                converted.append(_Entry("question", text=entry.text))
    return converted


def _plural(number: int, one: str, few: str, many: str) -> str:
    tail = number % 100
    if 11 <= tail <= 14:
        return many
    last = number % 10
    if last == 1:
        return one
    if 2 <= last <= 4:
        return few
    return many


def parse_question_list(text: str) -> dict:
    """Разбор списка вопросов. ParseError — пустой результат или превышен предел."""
    source = (text or "").replace("\x00", "")  # source_text сохраняется в exams как есть, без NUL
    if len(source) > MAX_SOURCE_CHARS:
        raise ParseError(413, TOO_LONG_DETAIL)
    lines = [_clean_line(line) for line in source.replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    scanner = _Scanner(lines)
    entries = _promote_outline_sections(scanner.scan())
    if not any(entry.kind == "question" for entry in entries) and any(entry.kind == "section" for entry in entries):
        entries = _sections_as_questions(entries)
    entries, dropped_headers = _drop_repeated_ticket_headers(entries)
    entries = _join_wrapped_lines(entries, scanner.wrap_chars)
    entries = _promote_inline_headings(entries)
    entries, dropped_preamble = _drop_preamble(entries)
    dropped_lines = scanner.dropped_service_lines + dropped_headers + dropped_preamble

    # Записи → вопросы с разделом и билетом (сырые номера).
    questions: list[_Question] = []
    raw_sections: list[str] = []
    tickets: list[dict] = []  # {"number", "members": [индексы вопросов], "refs": [номера]}
    ticket_by_number: dict[int, dict] = {}
    current_section: int | None = None
    current_ticket: dict | None = None
    ticket_labels: list[list[int]] = []
    ticket_styles: list[list[bool]] = []  # по каждому блоку «Билет № N»: есть ли номер у вопроса
    for entry in entries:
        if entry.kind == "section":
            raw_sections.append(entry.text)
            current_section = len(raw_sections)
            if not entry.keep_ticket:
                current_ticket = None
        elif entry.kind == "ticket":
            assert entry.number is not None
            current_ticket = ticket_by_number.get(entry.number)
            if current_ticket is None:
                current_ticket = {"number": entry.number, "members": [], "refs": []}
                ticket_by_number[entry.number] = current_ticket
                tickets.append(current_ticket)
            ticket_labels.append([])
            ticket_styles.append([])
        elif entry.kind == "end_ticket":
            current_ticket = None
        elif entry.kind == "refs":
            if current_ticket is not None:
                current_ticket["refs"].extend(entry.refs)
        elif entry.kind == "question":
            in_ticket = entry.in_ticket and current_ticket is not None
            question = _Question(
                text=entry.text,
                label=entry.label,
                numbered=entry.numbered,
                in_ticket=in_ticket,
                joined=entry.joined,
                section=current_section,
                ticket=None,
            )
            questions.append(question)
            if in_ticket and current_ticket is not None:
                current_ticket["members"].append(len(questions) - 1)
                number = _label_number(entry.label) if entry.numbered else None
                if number is not None and ticket_labels:
                    ticket_labels[-1].append(number)
                if ticket_styles:
                    ticket_styles[-1].append(entry.numbered)

    # Нумерация внутри билетов («1., 2.» в каждом билете) — номером вопроса не считается.
    local_numbering = False
    highest: int | None = None
    for labels in ticket_labels:
        if not labels:
            continue
        if highest is not None and labels[0] <= highest:
            local_numbering = True
            break
        highest = max(labels) if highest is None else max(highest, max(labels))

    # Текст, длина, отсев мусора.
    kept_raw: list[_Question] = []
    for question in questions:
        text_value = _clean_question_text(question.text)
        if len(text_value) > MAX_QUESTION_CHARS:
            text_value = _cut(text_value, MAX_QUESTION_CHARS)
            question.flags.append("long")
        question.text = text_value
        kept_raw.append(question)

    # Дубли по нормализованному тексту: остаётся первая позиция.
    by_hash: dict[str, int] = {}
    final: list[_Question] = []
    for index, question in enumerate(kept_raw):
        normalized = normalize_question(question.text)
        if len(question.text) < MIN_QUESTION_CHARS or not normalized:
            question.duplicate_of = -1  # не вопрос
            continue
        digest = hashlib.md5(normalized.encode("utf-8")).hexdigest()
        if digest in by_hash:
            first = kept_raw[by_hash[digest]]
            question.duplicate_of = by_hash[digest]
            if "duplicate_removed" not in first.flags:
                first.flags.append("duplicate_removed")
            continue
        by_hash[digest] = index
        final.append(question)

    if not final:
        raise ParseError(400, NO_QUESTIONS_DETAIL)
    if len(final) > MAX_QUESTIONS:
        raise ParseError(400, TOO_MANY_DETAIL)

    for position, question in enumerate(final, start=1):
        question.position = position

    def position_of(raw_index: int) -> int | None:
        question = kept_raw[raw_index]
        if question.duplicate_of is None:
            return question.position
        if question.duplicate_of >= 0:
            return kept_raw[question.duplicate_of].position
        return None

    # Разделы: только те, где остались вопросы; номера 1..k по порядку.
    section_map: dict[int, int] = {}
    sections_out: list[dict] = []
    for question in final:
        if question.section is not None and question.section not in section_map:
            section_map[question.section] = len(section_map) + 1
            sections_out.append({"index": section_map[question.section], "title": raw_sections[question.section - 1]})
    if len(sections_out) > MAX_SECTIONS:
        sections_out = []
        section_map = {}

    # Билеты: позиции после склейки дублей, ссылки «вопросы 1 и 21» — по номерам кафедры.
    position_by_label: dict[str, int] = {}
    for question in final:
        if question.label and not question.in_ticket and question.label not in position_by_label:
            position_by_label[question.label] = question.position or 0
    tickets_out: list[dict] = []
    for ticket in tickets:
        positions: list[int] = []
        for raw_index in ticket["members"]:
            position = position_of(raw_index)
            if position is not None and position not in positions:
                positions.append(position)
        for ref in ticket["refs"]:
            position = position_by_label.get(str(int(ref)))
            if position and position not in positions:
                positions.append(position)
        if positions:
            tickets_out.append({"number": ticket["number"], "positions": positions})

    questions_out: list[dict] = []
    numbered_outside = 0
    unnumbered_outside = 0
    for question in final:
        label = question.label if question.numbered else ""
        if question.in_ticket and local_numbering:
            label = ""
        if not question.in_ticket:
            if question.numbered:
                numbered_outside += 1
            else:
                unnumbered_outside += 1
        flags: list[str] = []
        if question.joined:
            flags.append("joined_lines")
        if len(question.text) > LONG_QUESTION_CHARS or "long" in question.flags:
            flags.append("long")
        if len(question.text) < SHORT_QUESTION_CHARS:
            flags.append("short")
        if "duplicate_removed" in question.flags:
            flags.append("duplicate_removed")
        questions_out.append(
            {
                "position": question.position,
                "label": label[:16],
                "text": question.text,
                "section": section_map.get(question.section) if question.section is not None else None,
                "flags": flags,
            }
        )

    warnings: list[dict] = []
    mixed_in_ticket = any(any(styles) and not all(styles) for styles in ticket_styles)
    if (numbered_outside and unnumbered_outside) or mixed_in_ticket:
        warnings.append({
            "code": "mixed_numbering",
            "message": "У части строк нет номера — проверьте список.",
        })
    if dropped_lines:
        count = dropped_lines
        warnings.append({
            "code": "unparsed_lines",
            "message": (
                f"Пропустили {count} {_plural(count, 'строку', 'строки', 'строк')}: похоже на шапку, подписи "
                "или колонтитулы. Проверьте, что вопросы не потерялись."
            ),
        })
    if len(final) < 3:
        count = len(final)
        warnings.append({
            "code": "few_found",
            "message": (
                f"Нашли всего {count} {_plural(count, 'вопрос', 'вопроса', 'вопросов')}. Если их больше, "
                "проверьте, что каждый вопрос начинается с новой строки."
            ),
        })

    return {
        "method": "regex",
        "questions": questions_out,
        "sections": sections_out,
        "tickets": tickets_out,
        "warnings": warnings,
        "source_text": source,
    }
