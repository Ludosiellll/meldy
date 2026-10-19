"""«Дикий» корпус банков вопросов с эталоном: раскладки, которые встречаются у живых пользователей (этап 1
«универсального импорта», 2026-10-19). Содержание придумано; чужих файлов здесь нет.

Пересобрать (из корня репозитория; нужны python-docx, Pillow, xlsxwriter):

    python backend/tests/fixtures/banks/wild/make_wild.py

Пишет files/<id>.<ext> (и files/<id>_key.<ext> — ключ отдельным файлом) и truth/<id>.json — эталон файла:

    {"id", "file", "key_file"?, "tags": [...], "note", "supported": true|false,
     "questions": [{"stem", "options": [...в порядке файла], "correct": [индексы], "kind",
                    "answers"?: [принятые короткие ответы], "order"?: [индексы вариантов в верном порядке],
                    "pairs"?: [[левое, правое], ...], "subject"?, "topic"?, "variant"?, "pictures"?}]}

Вид (kind): single, multiple, truefalse, open (короткий или числовой ответ — answers), match, order. Ключ только
тот, что есть в файле: в файле без ключа correct = [] (разбор не должен его придумать). Тексты — как их должен
отдать идеальный разбор: без номера, без буквы варианта, без маркера ключа и без знаков списка («;», «.» в конце
вариантов). Код в вопросе — строками через «\\n».

Считает и печатает итог разбора bank_eval.py (рядом с тестами): python backend/tests/bank_eval.py.
Чего здесь нет: .doc (Word 97 — разбор отвечает 415 по расширению), скан без текстового слоя (нужно распознавание),
PDF из Word со шрифтами Word (здесь PDF собран вручную: текстовый слой есть, оформления ключа нет).
"""
from __future__ import annotations

import io
import json
import re
import sys
import zipfile
from datetime import datetime
from pathlib import Path
from xml.sax.saxutils import escape

from docx import Document
from docx.enum.text import WD_COLOR_INDEX
from docx.oxml import OxmlElement, parse_xml
from docx.oxml.ns import qn
from docx.shared import RGBColor

HERE = Path(__file__).resolve().parent
FILES = HERE / "files"
TRUTH = HERE / "truth"

RUS = "абвгдежзик"
RUS_UP = "АБВГДЕЖЗИК"
LAT = "abcdefghij"
BE = "абвгдежзік"  # беларускія літары варыянтаў: «і» замест «и»
W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


# ── Вопросы (придуманы) ─────────────────────────────────────────────────────────


def Q(stem, options, correct, kind="single", **extra):
    return {"stem": stem, "options": list(options), "correct": list(correct), "kind": kind, **extra}


RU = [
    Q("Какой город является столицей Беларуси?", ["Минск", "Гомель", "Брест", "Витебск"], [0]),
    Q("Сколько планет в Солнечной системе?", ["7", "8", "9", "10"], [1]),
    Q("Какой газ преобладает в атмосфере Земли?", ["кислород", "углекислый газ", "азот", "аргон"], [2]),
    Q("Кто написал роман «Война и мир»?", ["Ф. М. Достоевский", "Л. Н. Толстой", "А. П. Чехов", "И. С. Тургенев"], [1]),
    Q("Какая самая длинная река Европы?", ["Дунай", "Днепр", "Волга", "Рейн"], [2]),
    Q("Чему равна сумма углов треугольника?", ["90°", "180°", "270°", "360°"], [1]),
    Q("Какой органоид клетки отвечает за синтез белка?", ["митохондрия", "рибосома", "лизосома", "вакуоль"], [1]),
    Q("В каком году началась Вторая мировая война?", ["1914", "1939", "1941", "1945"], [1]),
    Q("Какой металл самый лёгкий?", ["алюминий", "литий", "натрий", "магний"], [1]),
    Q("Какая единица измерения силы в СИ?", ["джоуль", "ватт", "ньютон", "паскаль"], [2]),
    Q("Кто открыл закон всемирного тяготения?", ["Галилей", "Ньютон", "Кеплер", "Эйнштейн"], [1]),
    Q("Какой океан самый большой по площади?", ["Атлантический", "Индийский", "Северный Ледовитый", "Тихий"], [3]),
    Q("Сколько хромосом в соматической клетке человека?", ["23", "44", "46", "48"], [2]),
    Q("Какой химический символ у золота?", ["Ag", "Au", "Gd", "Go"], [1]),
    Q("Кто автор поэмы «Мёртвые души»?", ["Н. В. Гоголь", "А. С. Пушкин", "М. Ю. Лермонтов", "Н. А. Некрасов"], [0]),
    Q("Какая кислота содержится в желудочном соке?", ["серная", "азотная", "соляная", "уксусная"], [2]),
    Q("Чему примерно равно ускорение свободного падения у поверхности Земли?", ["9,8 м/с²", "6,7 м/с²", "3,0 м/с²", "12 м/с²"], [0]),
    Q("Как называется наука о растениях?", ["зоология", "ботаника", "микология", "экология"], [1]),
    Q("Какой материк самый большой по площади?", ["Африка", "Евразия", "Северная Америка", "Антарктида"], [1]),
    Q("Сколько байт в одном килобайте по стандарту JEDEC?", ["1000", "1024", "512", "2048"], [1]),
    Q("Какой процесс превращает жидкость в газ?", ["конденсация", "кристаллизация", "испарение", "сублимация"], [2]),
    Q("Какой орган человека вырабатывает инсулин?", ["печень", "почки", "поджелудочная железа", "щитовидная железа"], [2]),
    Q("Какое из чисел является простым?", ["21", "27", "29", "33"], [2]),
    Q("Как называется верхний слой кожи?", ["дерма", "эпидермис", "гиподерма", "мезодерма"], [1]),
    Q("Какой город был столицей Великого княжества Литовского?", ["Вильна", "Краков", "Полоцк", "Гродно"], [0]),
    Q("Какую планету называют Красной?", ["Венера", "Юпитер", "Марс", "Сатурн"], [2]),
    Q("Сколько сторон у шестиугольника?", ["5", "6", "7", "8"], [1]),
    Q("Какой элемент обозначается символом Fe?", ["фтор", "железо", "фосфор", "франций"], [1]),
    Q("В каком году был принят Статут ВКЛ последней редакции?", ["1529", "1566", "1588", "1610"], [2]),
    Q("Какой прибор измеряет атмосферное давление?", ["термометр", "барометр", "гигрометр", "амперметр"], [1]),
    Q("Какое из этих животных является млекопитающим?", ["акула", "дельфин", "окунь", "скат"], [1]),
    Q("Как называется часть речи, обозначающая действие?", ["существительное", "прилагательное", "глагол", "наречие"], [2]),
    Q("Какая формула у воды?", ["H2O", "CO2", "O2", "H2O2"], [0]),
    Q("Кто был первым космонавтом?", ["Г. С. Титов", "Ю. А. Гагарин", "А. А. Леонов", "В. В. Терешкова"], [1]),
    Q("Какой угол называется прямым?", ["45°", "90°", "120°", "180°"], [1]),
    Q("Какой пигмент придаёт листьям зелёный цвет?", ["каротин", "хлорофилл", "меланин", "гемоглобин"], [1]),
    Q("Какая валюта используется в Японии?", ["юань", "вона", "иена", "рупия"], [2]),
    Q("Сколько минут в сутках?", ["1240", "1440", "1640", "1840"], [1]),
    Q("Какое озеро самое большое в Беларуси?", ["Нарочь", "Освея", "Дривяты", "Лукомльское"], [0]),
    Q("Какой знак ставится в конце вопросительного предложения?", ["точка", "восклицательный знак", "вопросительный знак", "точка с запятой"], [2]),
    Q("Какая из этих птиц не умеет летать?", ["ласточка", "пингвин", "чайка", "воробей"], [1]),
    Q("Сколько градусов в полном обороте?", ["180", "270", "360", "400"], [2]),
    Q("Какой город является столицей Польши?", ["Краков", "Варшава", "Гданьск", "Лодзь"], [1]),
    Q("Кто написал стихотворение «Бородино»?", ["А. С. Пушкин", "М. Ю. Лермонтов", "Ф. И. Тютчев", "А. А. Фет"], [1]),
    Q("Какие вещества ускоряют реакции в живой клетке?", ["ферменты", "гормоны", "витамины", "антитела"], [0]),
    Q("Какой слой атмосферы ближе всего к Земле?", ["стратосфера", "тропосфера", "мезосфера", "термосфера"], [1]),
    Q("Сколько килограммов в одной тонне?", ["100", "500", "1000", "10000"], [2]),
    Q("Какое явление объясняет радугу?", ["дисперсия света", "отражение звука", "конвекция", "диффузия"], [0]),
]

MULTI = [
    Q("Выберите все чётные числа:", ["2", "3", "4", "7", "8"], [0, 2, 4], "multiple"),
    Q("Какие из перечисленных газов являются благородными? (несколько правильных ответов)", ["гелий", "азот", "неон", "аргон", "водород"], [0, 2, 3], "multiple"),
    Q("Отметьте все языки программирования:", ["Python", "HTML", "Java", "CSS", "C#"], [0, 2, 4], "multiple"),
    Q("Укажите всех млекопитающих:", ["кит", "летучая мышь", "крокодил", "ёж"], [0, 1, 3], "multiple"),
    Q("Выберите все простые числа:", ["2", "9", "11", "15", "17"], [0, 2, 4], "multiple"),
    Q("Какие органы относятся к пищеварительной системе? Выберите все верные ответы.", ["желудок", "лёгкие", "печень", "кишечник"], [0, 2, 3], "multiple"),
    Q("Укажите все страны Скандинавии:", ["Норвегия", "Швеция", "Польша", "Дания"], [0, 1, 3], "multiple"),
    Q("Отметьте все хвойные деревья:", ["сосна", "берёза", "ель", "лиственница", "клён"], [0, 2, 3], "multiple"),
]

CODE = [
    Q("Что выведет программа?", ["5", "8", "53", "ошибку компиляции"], [1], code="int x = 5;\nx += 3;\nConsole.WriteLine(x);"),
    Q("Что вернёт выражение на Python?", ["2", "3", "4", "ошибку"], [1], code="len([1, 2, [3, 4]])"),
    Q("Что вернёт запрос?", ["число студентов старше 18 лет", "список студентов", "средний возраст", "ошибку синтаксиса"], [0],
      code="SELECT COUNT(*) FROM Students\nWHERE age > 18;"),
    Q("Что напечатает код на C?", ["1", "2", "3", "адрес массива"], [1], code='int a[3] = {1, 2, 3};\nprintf("%d", a[1]);'),
    Q("Чему будет равно y после выполнения кода?", ["7", "10", "4", "9"], [0], code="y = 10\nfor i in range(3):\n    y -= i"),
    Q("Какой оператор сравнивает значения без приведения типов в JavaScript?", ["==", "===", "=", "!="], [1]),
    Q("Что делает команда?", ["меняет права доступа к файлу", "удаляет файл", "копирует файл", "переименовывает файл"], [0],
      code="chmod 755 deploy.sh"),
    Q("Что выведет этот фрагмент?", ["0", "null", "-1", "исключение"], [2], code="string s = null;\nConsole.WriteLine(s?.Length ?? -1);"),
    Q("Какое значение получит переменная c?", ["3", "3.5", "4", "1"], [0], code="a = 7\nb = 2\nc = a // b"),
    Q("Что выведет программа на Java?", ["1", "3", "0", "3.33"], [0], code="System.out.println(10 % 3);"),
]

MATH = [
    Q("Решите уравнение x² − 5x + 6 = 0.", ["x = 2; x = 3", "x = −2; x = −3", "x = 1; x = 6", "корней нет"], [0]),
    Q("Чему равен √144?", ["11", "12", "14", "72"], [1]),
    Q("Найдите производную функции f(x) = x³.", ["3x²", "x²", "3x", "x⁴/4"], [0]),
    Q("Вычислите значение выражения 2³ · 2².", ["16", "32", "64", "10"], [1]),
    Q("Чему равен sin 30°?", ["0", "1/2", "√3/2", "1"], [1]),
    Q("Площадь круга радиуса r равна:", ["2πr", "πr²", "πd", "r²"], [1]),
    Q("Сколько будет 15 % от 200?", ["15", "20", "30", "35"], [2]),
    Q("Решите неравенство 2x + 1 > 7.", ["x > 3", "x < 3", "x > 4", "x ≥ 3"], [0]),
]

BEL = [
    Q("Якая сталіца Рэспублікі Беларусь?", ["Мінск", "Гродна", "Магілёў", "Брэст"], [0]),
    Q("Хто напісаў паэму «Новая зямля»?", ["Янка Купала", "Якуб Колас", "Максім Багдановіч", "Уладзімір Караткевіч"], [1]),
    Q("Колькі літар у беларускім алфавіце?", ["32", "33", "36", "30"], [0]),
    Q("Якая рака працякае праз Гродна?", ["Дняпро", "Нёман", "Прыпяць", "Сож"], [1]),
    Q("Хто з'яўляецца аўтарам зборніка «Вянок»?", ["Максім Багдановіч", "Янка Купала", "Францішак Багушэвіч", "Цётка"], [0]),
    Q("Які горад лічыцца самым старажытным у Беларусі?", ["Полацк", "Тураў", "Пінск", "Мінск"], [0]),
    Q("Як па-беларуску будзе «спасибо»?", ["дзякуй", "калі ласка", "прабачце", "добры дзень"], [0]),
    Q("Якая літара ёсць толькі ў беларускім алфавіце?", ["ў", "щ", "ъ", "и"], [0]),
    Q("Хто выдаў «Псалтыр» у 1517 годзе?", ["Францыск Скарына", "Сімяон Полацкі", "Кірыла Тураўскі", "Мікола Гусоўскі"], [0]),
    Q("Якое возера самае вялікае ў Беларусі?", ["Нарач", "Освея", "Дрысвяты", "Лукомскае"], [0]),
]

EN = [
    Q("What is the capital of Canada?", ["Toronto", "Ottawa", "Vancouver", "Montreal"], [1]),
    Q("Which planet is closest to the Sun?", ["Venus", "Earth", "Mercury", "Mars"], [2]),
    Q("What does CPU stand for?", ["Central Processing Unit", "Computer Personal Unit", "Central Program Utility", "Core Processing Unit"], [0]),
    Q("Which gas do plants absorb from the air?", ["Oxygen", "Nitrogen", "Carbon dioxide", "Helium"], [2]),
    Q("Who wrote 'Romeo and Juliet'?", ["Charles Dickens", "William Shakespeare", "Jane Austen", "Mark Twain"], [1]),
    Q("How many continents are there?", ["5", "6", "7", "8"], [2]),
    Q("What is the boiling point of water at sea level?", ["90 °C", "100 °C", "110 °C", "120 °C"], [1]),
    Q("Which protocol is used to send e-mail?", ["FTP", "SMTP", "HTTP", "SSH"], [1]),
    Q("What is the past tense of 'go'?", ["goed", "gone", "went", "going"], [2]),
    Q("Which data structure works on the LIFO principle?", ["queue", "stack", "tree", "graph"], [1]),
    Q("What is 7 × 8?", ["54", "56", "58", "64"], [1]),
    Q("Which ocean lies between Europe and North America?", ["Pacific", "Indian", "Atlantic", "Arctic"], [2]),
]

TF = [
    ("Вода кипит при 100 °C на уровне моря.", True),
    ("Солнце вращается вокруг Земли.", False),
    ("Минск — столица Беларуси.", True),
    ("Кит — это рыба.", False),
    ("Сумма углов квадрата равна 360°.", True),
    ("Медь — неметалл.", False),
    ("Python — язык программирования.", True),
    ("Свет распространяется медленнее звука.", False),
]

SHORT = [
    ("Сколько будет 12 × 12?", ["144"]),
    ("Назовите химический символ натрия.", ["Na"]),
    ("В каком году состоялась Грюнвальдская битва?", ["1410"]),
    ("Как называется столица Франции?", ["Париж"]),
    ("Сколько сантиметров в одном метре?", ["100"]),
    ("Назовите самую высокую гору мира.", ["Эверест", "Джомолунгма"]),
    ("Какой газ необходим для горения?", ["кислород"]),
    ("Чему равно число π с точностью до сотых?", ["3,14", "3.14"]),
    ("Как называется деление клетки с сохранением числа хромосом?", ["митоз"]),
    ("Сколько секунд в одном часе?", ["3600"]),
    ("Кто написал роман в стихах «Евгений Онегин»?", ["Пушкин", "А. С. Пушкин"]),
    ("Сколько будет 2 в десятой степени?", ["1024"]),
]

MATCH = [
    ("Установите соответствие между страной и её столицей.", ["Франция", "Германия", "Италия"], ["Рим", "Париж", "Берлин"], [1, 2, 0]),
    ("Установите соответствие между физической величиной и единицей измерения.", ["сила", "работа", "мощность"],
     ["ватт", "ньютон", "джоуль"], [1, 2, 0]),
    ("Соотнесите автора и произведение.", ["Пушкин", "Толстой", "Гоголь"], ["«Ревизор»", "«Капитанская дочка»", "«Анна Каренина»"], [1, 2, 0]),
    ("Установите соответствие между органом и системой органов.", ["сердце", "лёгкие", "желудок"],
     ["дыхательная", "пищеварительная", "кровеносная"], [2, 0, 1]),
]

ORDER = [
    ("Расположите события в хронологическом порядке.", ["Люблинская уния", "Крещение Руси", "Полтавская битва", "Грюнвальдская битва"], [1, 3, 0, 2]),
    ("Расположите планеты по удалённости от Солнца, начиная с ближайшей.", ["Марс", "Меркурий", "Земля", "Венера"], [1, 3, 2, 0]),
    ("Расположите единицы информации по возрастанию.", ["килобайт", "байт", "мегабайт", "бит"], [3, 1, 0, 2]),
    ("Установите правильную последовательность фаз митоза.", ["анафаза", "профаза", "телофаза", "метафаза"], [1, 3, 0, 2]),
]


def take(pool, start, count):
    return [dict(pool[(start + i) % len(pool)]) for i in range(count)]


def stem_of(q):
    return q["stem"] + ("\n" + q["code"] if q.get("code") else "")


def truth(q, *, key=True, **extra):
    """Эталон вопроса с вариантами; key=False — в файле ключа нет."""
    out = {"stem": stem_of(q), "options": list(q["options"]), "correct": list(q["correct"]) if key else [], "kind": q["kind"]}
    out.update({k: v for k, v in extra.items() if v is not None})
    return out


def truth_open(stem, answers, *, key=True, **extra):
    out = {"stem": stem, "options": [], "correct": [], "kind": "open", "answers": list(answers) if key else []}
    out.update(extra)
    return out


def truth_tf(stem, value, *, labels=("Верно", "Неверно"), key=True):
    return {"stem": stem, "options": list(labels), "correct": ([0] if value else [1]) if key else [], "kind": "truefalse"}


def truth_match(stem, left, right, key, *, with_key=True):
    pairs = [[left[i], right[key[i]]] for i in range(len(left))] if with_key else []
    return {"stem": stem, "options": [], "correct": [], "kind": "match", "left": left, "right": right, "pairs": pairs}


def truth_order(stem, options, order, *, with_key=True):
    return {"stem": stem, "options": list(options), "correct": [], "kind": "order", "order": list(order) if with_key else []}


def roman(n):
    out = ""
    for value, digits in ((10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I")):
        while n >= value:
            out += digits
            n -= value
    return out


# ── Документ: абзацы, ячейки, таблицы, надписи ──────────────────────────────────


class P:
    """Абзац: куски (текст, оформление), нумерация Word (num_id, уровень), стиль, картинки в конце."""

    def __init__(self, *runs, num=None, style=None, pics=0, pic_seed=0):
        self.runs = [(r, {}) if isinstance(r, str) else r for r in runs]
        self.num = num
        self.style = style
        self.pics = pics
        self.pic_seed = pic_seed

    @property
    def text(self):
        return "".join(text for text, _ in self.runs)


class C:
    def __init__(self, *paras, vmerge=None, span=1, shade=None):
        self.paras = [p if isinstance(p, P) else P(p) for p in paras]
        self.vmerge = vmerge
        self.span = span
        self.shade = shade


class T:
    def __init__(self, rows):
        self.rows = rows


class TB:
    """Надпись Word (VML), внутри — абзацы."""

    def __init__(self, *paras):
        self.paras = list(paras)


def R(text, **marks):
    return (text, marks)


FORMATS = {
    "bold": {"b": True}, "underline": {"u": True}, "italic": {"i": True}, "red": {"color": "FF0000"},
    "green": {"color": "00B050"}, "blue": {"color": "0070C0"}, "highlight": {"hl": "YELLOW"}, "shade": {"shade": "FFFF00"},
}


def png(seed=0):
    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (10, 10), ((seed * 53) % 256, (seed * 97 + 40) % 256, (seed * 31 + 90) % 256)).save(buffer, format="PNG")
    return buffer.getvalue()


def _marks(run, marks):
    if marks.get("b"):
        run.bold = True
    if marks.get("u"):
        run.underline = True
    if marks.get("i"):
        run.italic = True
    if marks.get("strike"):
        run.font.strike = True
    if marks.get("color"):
        run.font.color.rgb = RGBColor.from_string(marks["color"])
    if marks.get("hl"):
        run.font.highlight_color = getattr(WD_COLOR_INDEX, marks["hl"])
    if marks.get("font"):
        run.font.name = marks["font"]
    if marks.get("shade"):
        shd = OxmlElement("w:shd")
        shd.set(qn("w:val"), "clear")
        shd.set(qn("w:color"), "auto")
        shd.set(qn("w:fill"), marks["shade"])
        run._r.get_or_add_rPr().append(shd)


def _numbered(paragraph, num_id, level):
    p_pr = paragraph._p.get_or_add_pPr()
    num_pr = OxmlElement("w:numPr")
    ilvl = OxmlElement("w:ilvl")
    ilvl.set(qn("w:val"), str(level))
    nid = OxmlElement("w:numId")
    nid.set(qn("w:val"), str(num_id))
    num_pr.append(ilvl)
    num_pr.append(nid)
    p_pr.append(num_pr)


def _fill_paragraph(doc, paragraph, spec: P):
    if spec.style:
        paragraph.style = doc.styles[spec.style]
    for text, marks in spec.runs:
        if text:
            _marks(paragraph.add_run(text), marks)
    for k in range(spec.pics):
        paragraph.add_run().add_picture(io.BytesIO(png(spec.pic_seed + k)))
    if spec.num:
        _numbered(paragraph, *spec.num)


def _define_lists(doc, lists):
    """lists: {abstract_id: [(fmt, lvlText), ...по уровням]}, nums: {num_id: abstract_id (+ restart)}."""
    numbering = doc.part.numbering_part.element
    first_num = numbering.find(qn("w:num"))
    for abstract_id, levels in lists["abstract"].items():
        abstract = OxmlElement("w:abstractNum")
        abstract.set(qn("w:abstractNumId"), str(abstract_id))
        for level, (fmt, text) in enumerate(levels):
            lvl = OxmlElement("w:lvl")
            lvl.set(qn("w:ilvl"), str(level))
            for tag, value in (("w:start", "1"), ("w:numFmt", fmt), ("w:lvlText", text)):
                element = OxmlElement(tag)
                element.set(qn("w:val"), value)
                lvl.append(element)
            abstract.append(lvl)
        if first_num is not None:
            first_num.addprevious(abstract)
        else:
            numbering.append(abstract)
    for num_id, (abstract_id, restart_level) in lists["nums"].items():
        num = OxmlElement("w:num")
        num.set(qn("w:numId"), str(num_id))
        ref = OxmlElement("w:abstractNumId")
        ref.set(qn("w:val"), str(abstract_id))
        num.append(ref)
        if restart_level is not None:
            override = OxmlElement("w:lvlOverride")
            override.set(qn("w:ilvl"), str(restart_level))
            start = OxmlElement("w:startOverride")
            start.set(qn("w:val"), "1")
            override.append(start)
            num.append(override)
        numbering.append(num)


def _set_merge(cell, value):
    tc_pr = cell._tc.get_or_add_tcPr()
    merge = OxmlElement("w:vMerge")
    if value == "restart":
        merge.set(qn("w:val"), "restart")
    tc_pr.append(merge)


def _cell_shade(cell, fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill)
    tc_pr.append(shd)


def _table(doc, spec: T, parent=None):
    width = max(sum(cell.span for cell in row) for row in spec.rows)
    table = (parent or doc).add_table(rows=len(spec.rows), cols=width)
    table.style = doc.styles["Table Grid"]
    for r, row in enumerate(spec.rows):
        col = 0
        for cell_spec in row:
            cell = table.cell(r, col)
            if cell_spec.span > 1:
                cell = cell.merge(table.cell(r, col + cell_spec.span - 1))
            for k, para in enumerate(cell_spec.paras):
                _fill_paragraph(doc, cell.paragraphs[0] if k == 0 else cell.add_paragraph(), para)
            if cell_spec.vmerge:
                _set_merge(cell, cell_spec.vmerge)
            if cell_spec.shade:
                _cell_shade(cell, cell_spec.shade)
            col += cell_spec.span
    return table


def _p_xml(spec: P) -> str:
    runs = []
    for text, marks in spec.runs:
        props = ("<w:b/>" if marks.get("b") else "") + ("<w:u w:val=\"single\"/>" if marks.get("u") else "")
        runs.append(f"<w:r>{f'<w:rPr>{props}</w:rPr>' if props else ''}<w:t xml:space=\"preserve\">{escape(text)}</w:t></w:r>")
    return f"<w:p>{''.join(runs)}</w:p>"


def _textbox(doc, spec: TB, index: int):
    paragraph = doc.add_paragraph()
    inner = "".join(_p_xml(p) for p in spec.paras)
    xml = (f'<w:r xmlns:w="{W_NS}" xmlns:v="urn:schemas-microsoft-com:vml"><w:pict>'
           f'<v:shape id="tb{index}" type="#_x0000_t202" style="width:230pt;height:320pt">'
           f"<v:textbox><w:txbxContent>{inner}</w:txbxContent></v:textbox></v:shape></w:pict></w:r>")
    paragraph._p.append(parse_xml(xml))


_DROP = re.compile(r"^(?:word/stylesWithEffects\.xml|docProps/thumbnail\.jpeg|customXml/.*)$")


def slim(data: bytes) -> bytes:
    """Без частей шаблона python-docx, которые разбору не нужны (stylesWithEffects, эскиз, customXml): файл втрое меньше.
    Время в архиве — постоянное: пересборка не меняет файлы без причины."""
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(data)) as source, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as target:
        for info in source.infolist():
            if _DROP.match(info.filename):
                continue
            content = source.read(info.filename)
            if info.filename == "[Content_Types].xml":
                content = re.sub(rb'<Override PartName="/(?:word/stylesWithEffects\.xml|docProps/thumbnail\.jpeg|customXml/[^"]*)"[^>]*/>',
                                 b"", content)
            elif info.filename.endswith(".rels"):
                content = re.sub(rb'<Relationship [^>]*Target="[^"]*(?:stylesWithEffects\.xml|thumbnail\.jpeg|customXml/[^"]*)"[^>]*/>',
                                 b"", content)
            target.writestr(zipfile.ZipInfo(info.filename, date_time=(2026, 1, 1, 0, 0, 0)), content,
                            compress_type=zipfile.ZIP_DEFLATED)
    return out.getvalue()


def docx(blocks, *, lists=None, columns=None) -> bytes:
    doc = Document()
    if lists:
        _define_lists(doc, lists)
    boxes = 0
    for block in blocks:
        if isinstance(block, P):
            _fill_paragraph(doc, doc.add_paragraph(), block)
        elif isinstance(block, T):
            _table(doc, block)
        elif isinstance(block, TB):
            boxes += 1
            _textbox(doc, block, boxes)
    if columns:
        sect = doc.element.body.find(qn("w:sectPr"))
        cols = OxmlElement("w:cols")
        cols.set(qn("w:num"), str(columns))
        cols.set(qn("w:space"), "425")
        sect.append(cols)
    buffer = io.BytesIO()
    doc.save(buffer)
    return slim(buffer.getvalue())


def plain(blocks) -> str:
    lines = []
    for block in blocks:
        if isinstance(block, P):
            lines.append(block.text)
        elif isinstance(block, T):
            for row in block.rows:
                lines.append("\t".join(" ".join(p.text for p in cell.paras) for cell in row))
    return "\n".join(lines) + "\n"


def xlsx(rows, *, formats=None, sheet="Лист1") -> bytes:
    """rows: список строк; ячейка — str/число или (str, {"b": True, "fill": "FFFF00", "color": "FF0000"})."""
    import xlsxwriter

    buffer = io.BytesIO()
    book = xlsxwriter.Workbook(buffer, {"in_memory": True})
    book.set_properties({"created": datetime(2026, 1, 1)})
    sheet_ = book.add_worksheet(sheet)
    cache = {}
    for r, row in enumerate(rows):
        for c, value in enumerate(row):
            marks = {}
            if isinstance(value, tuple):
                value, marks = value
            if value is None or value == "":
                continue
            key = tuple(sorted(marks.items()))
            if key not in cache:
                props = {"text_wrap": True}
                if marks.get("b"):
                    props["bold"] = True
                if marks.get("fill"):
                    props["bg_color"] = "#" + marks["fill"]
                if marks.get("color"):
                    props["font_color"] = "#" + marks["color"]
                cache[key] = book.add_format(props)
            sheet_.write(r, c, value, cache[key])
    book.close()
    return buffer.getvalue()


# ── Вопрос абзацами ─────────────────────────────────────────────────────────────

NUMBERS = {
    "dot": lambda n: f"{n}. ", "paren": lambda n: f"{n}) ", "hash": lambda n: f"№{n}. ", "hash_space": lambda n: f"№ {n} ",
    "vopros": lambda n: f"Вопрос {n}: ", "roman": lambda n: f"{roman(n)}. ", "letter": lambda n: f"{RUS_UP[n - 1]}. ",
    "none": lambda n: "", "zadanie": lambda n: f"Задание №{n}. ", "padded": lambda n: f"{n:02d}. ", "q_en": lambda n: f"Q{n}. ",
    "tab": lambda n: f"{n}.\t", "nbsp": lambda n: f"{n}. ", "dash": lambda n: f"{n} – ", "pytanne": lambda n: f"Пытанне {n}. ",
    "question_en": lambda n: f"Question {n}. ",
}
LABELS = {
    "rus_paren": lambda k: f"{RUS[k]}) ", "rus_up_dot": lambda k: f"{RUS_UP[k]}. ", "rus_up_paren": lambda k: f"{RUS_UP[k]}) ",
    "rus_dot": lambda k: f"{RUS[k]}. ", "lat_paren": lambda k: f"{LAT[k]}) ", "lat_up_dot": lambda k: f"{LAT[k].upper()}. ",
    "lat_up_paren": lambda k: f"{LAT[k].upper()}) ", "lat_tab": lambda k: f"{LAT[k]}\t", "num_paren": lambda k: f"{k + 1}) ",
    "num_dot": lambda k: f"{k + 1}. ", "bullet": lambda k: "• ", "dash": lambda k: "- ", "none": lambda k: "",
    "paren_both": lambda k: f"({RUS[k]}) ", "rus_paren_tab": lambda k: f"{RUS[k]})\t", "be_paren": lambda k: f"{BE[k]}) ",
    "rus_nbsp": lambda k: f"{RUS[k]}) ",
}


def option_runs(label: str, text: str, is_key: bool, key: str) -> list:
    if key in FORMATS:
        return [label, R(text, **FORMATS[key])] if is_key else [label, text]
    if key == "bold_line":
        return [R(label + text, b=True)] if is_key else [label + text]
    if key == "plus_before":
        return ["+" + label + text] if is_key else [label + text]
    if key == "star_before":
        return ["*" + label + text] if is_key else [label + text]
    if key == "plus_after":
        return [label + text + " +"] if is_key else [label + text]
    if key == "verno_after":
        return [label + text + " (верно)"] if is_key else [label + text]
    if key == "check":
        return ["☑ " + label + text] if is_key else ["☐ " + label + text]
    if key == "plus_minus":
        return [("+ " if is_key else "- ") + text]
    return [label + text]


def q_paras(n, q, *, num="dot", label="rus_paren", key="bold", inline=None, own_line=False, stem_marks=None,
            blank=False, answer=None, code_font=None):
    """Вопрос абзацами. inline: None — вариант на строку; "next" — все варианты строкой под вопросом; "same" — в строке
    вопроса; "tabs" — через табуляцию. answer: "letter" | "text" — строка «Ответ: …» под вариантами."""
    out = []
    head = NUMBERS[num](n)
    stem_marks = stem_marks or {}
    labeler = LABELS[label]
    if own_line:
        out.append(P(head.strip()))
        head = ""
    stem_paras = [P(head, R(q["stem"], **stem_marks))]
    if q.get("code"):
        for line in q["code"].split("\n"):
            stem_paras.append(P(R(line, font=code_font) if code_font else line))
    if inline:
        sep = "\t" if inline == "tabs" else " "
        runs = []
        for k, option in enumerate(q["options"]):
            runs += option_runs(labeler(k), option, k in q["correct"], key)
            if k < len(q["options"]) - 1:
                runs.append(";" + sep if inline != "tabs" else sep)
        if inline == "same" and not q.get("code"):
            stem_paras[0].runs += [(" ", {})] + [(r, {}) if isinstance(r, str) else r for r in runs]
        else:
            stem_paras.append(P(*runs))
        out += stem_paras
    else:
        out += stem_paras
        for k, option in enumerate(q["options"]):
            out.append(P(*option_runs(labeler(k), option, k in q["correct"], key)))
    if answer == "letter":
        out.append(P("Ответ: " + ", ".join(RUS[k] for k in q["correct"])))
    elif answer == "text":
        out.append(P("Правильный ответ: " + "; ".join(q["options"][k] for k in q["correct"])))
    if blank:
        out.append(P(""))
    return out


def key_pairs(questions, alphabet=RUS, sep=" – ", joiner=", ", start=1):
    return joiner.join(f"{start + i}{sep}{', '.join(alphabet[k] for k in q['correct'])}" for i, q in enumerate(questions))


# ── Случаи ───────────────────────────────────────────────────────────────────────

CASES = []


def case(case_id, ext, *tags, note=""):
    def register(fn):
        CASES.append({"id": case_id, "ext": ext, "tags": list(tags), "note": note, "fn": fn})
        return fn
    return register


def simple(questions, **kw):
    blocks = []
    for n, q in enumerate(questions, start=1):
        blocks += q_paras(n, q, **kw)
    return blocks


# Нумерация вопросов ------------------------------------------------------------

@case("w001_num_dot", "docx", "num:dot", "opt:rus_paren", "key:bold")
def _():
    qs = take(RU, 0, 8)
    return docx(simple(qs)), [truth(q) for q in qs]


@case("w002_num_paren", "docx", "num:paren", "opt:rus_paren", "key:bold")
def _():
    qs = take(RU, 8, 8)
    return docx(simple(qs, num="paren")), [truth(q) for q in qs]


@case("w003_num_hash", "docx", "num:hash", "opt:rus_paren", "key:underline")
def _():
    qs = take(RU, 16, 8)
    return docx(simple(qs, num="hash", key="underline")), [truth(q) for q in qs]


@case("w004_num_vopros_colon", "docx", "num:vopros", "opt:rus_paren", "key:bold")
def _():
    qs = take(RU, 24, 8)
    return docx(simple(qs, num="vopros")), [truth(q) for q in qs]


@case("w005_vopros_own_line", "docx", "num:vopros_line", "opt:rus_up_dot", "key:bold",
      note="«Вопрос 1» отдельной строкой, текст вопроса — следующей")
def _():
    qs = take(RU, 32, 8)
    blocks = []
    for n, q in enumerate(qs, start=1):
        blocks.append(P(f"Вопрос {n}"))
        blocks += q_paras(n, q, num="none", label="rus_up_dot")
    return docx(blocks), [truth(q) for q in qs]


@case("w006_num_roman", "docx", "num:roman", "opt:rus_paren", "key:bold")
def _():
    qs = take(RU, 40, 8)
    return docx(simple(qs, num="roman")), [truth(q) for q in qs]


@case("w007_num_letters_opts_digits", "docx", "num:letter", "opt:num_paren", "key:bold",
      note="вопросы пронумерованы буквами «А.», варианты — цифрами «1)»")
def _():
    qs = take(RU, 3, 6)
    return docx(simple(qs, num="letter", label="num_paren")), [truth(q) for q in qs]


@case("w008_no_numbers_blank_lines", "docx", "num:none", "opt:rus_paren", "key:bold", "sep:blank")
def _():
    qs = take(RU, 11, 8)
    return docx(simple(qs, num="none", blank=True)), [truth(q) for q in qs]


@case("w009_no_numbers_tight", "docx", "num:none", "opt:rus_paren", "key:bold")
def _():
    qs = take(RU, 19, 8)
    return docx(simple(qs, num="none")), [truth(q) for q in qs]


@case("w010_word_autonumber_both", "docx", "num:word_list", "opt:word_list", "key:highlight",
      note="вопросы — список Word «1.», варианты — список Word «а)», нумерация вариантов заново в каждом вопросе")
def _():
    qs = take(RU, 27, 8)
    lists = {"abstract": {90: [("decimal", "%1."), ("russianLower", "%2)")], 91: [("russianLower", "%1)")]},
             "nums": {90: (90, None), **{100 + n: (91, 0) for n in range(1, 9)}}}
    blocks = []
    for n, q in enumerate(qs, start=1):
        blocks.append(P(q["stem"], num=(90, 0)))
        for k, option in enumerate(q["options"]):
            blocks.append(P(*option_runs("", option, k in q["correct"], "highlight"), num=(100 + n, 0)))
    return docx(blocks, lists=lists), [truth(q) for q in qs]


@case("w011_word_list_options_latin", "docx", "num:dot", "opt:word_list_latin", "key:bold", "lang:en")
def _():
    qs = take(EN, 0, 8)
    lists = {"abstract": {92: [("lowerLetter", "%1)")]}, "nums": {200 + n: (92, 0) for n in range(1, 9)}}
    blocks = []
    for n, q in enumerate(qs, start=1):
        blocks.append(P(f"{n}. {q['stem']}"))
        for k, option in enumerate(q["options"]):
            blocks.append(P(*option_runs("", option, k in q["correct"], "bold"), num=(200 + n, 0)))
    return docx(blocks, lists=lists), [truth(q) for q in qs]


@case("w012_zadanie_opts_digits", "docx", "num:zadanie", "opt:num_dot", "key:italic")
def _():
    qs = take(RU, 35, 8)
    return docx(simple(qs, num="zadanie", label="num_dot", key="italic")), [truth(q) for q in qs]


@case("w013_padded_numbers", "docx", "num:padded", "opt:rus_dot", "key:red")
def _():
    qs = take(RU, 43, 8)
    return docx(simple(qs, num="padded", label="rus_dot", key="red")), [truth(q) for q in qs]


@case("w014_q_english", "docx", "num:q_en", "opt:lat_up_paren", "key:bold", "lang:en")
def _():
    qs = take(EN, 4, 8)
    return docx(simple(qs, num="q_en", label="lat_up_paren")), [truth(q) for q in qs]


@case("w015_tabs_separators", "docx", "num:tab", "opt:rus_paren_tab", "key:bold", "text:tabs")
def _():
    qs = take(RU, 5, 8)
    return docx(simple(qs, num="tab", label="rus_paren_tab")), [truth(q) for q in qs]


@case("w016_nbsp_quotes", "docx", "num:nbsp", "opt:rus_nbsp", "key:bold", "text:nbsp")
def _():
    qs = take(RU, 13, 8)
    return docx(simple(qs, num="nbsp", label="rus_nbsp")), [truth(q) for q in qs]


@case("w017_number_dash", "txt", "num:dash", "opt:rus_paren", "key:end_list")
def _():
    qs = take(RU, 21, 8)
    blocks = simple(qs, num="dash", key="none", blank=True)
    blocks += [P("Ответы: " + key_pairs(qs, sep="-"))]
    return plain(blocks).encode("utf-8"), [truth(q) for q in qs]


# Варианты ответа ---------------------------------------------------------------

@case("w020_opts_upper_paren", "docx", "num:dot", "opt:rus_up_paren", "key:bold")
def _():
    qs = take(RU, 2, 8)
    return docx(simple(qs, label="rus_up_paren")), [truth(q) for q in qs]


@case("w021_opts_latin_for_russian", "docx", "num:dot", "opt:lat_paren", "key:bold")
def _():
    qs = take(RU, 10, 8)
    return docx(simple(qs, label="lat_paren")), [truth(q) for q in qs]


@case("w022_opts_bare_letter_tab", "docx", "num:dot", "opt:lat_tab", "key:bold", "lang:en", "text:tabs")
def _():
    qs = take(EN, 2, 8)
    return docx(simple(qs, label="lat_tab")), [truth(q) for q in qs]


@case("w023_opts_bullets", "docx", "num:dot", "opt:bullet", "key:bold")
def _():
    qs = take(RU, 18, 8)
    return docx(simple(qs, label="bullet")), [truth(q) for q in qs]


@case("w024_opts_dash", "docx", "num:dot", "opt:dash", "key:underline")
def _():
    qs = take(RU, 26, 8)
    return docx(simple(qs, label="dash", key="underline")), [truth(q) for q in qs]


@case("w025_inline_next_line", "docx", "num:dot", "opt:inline", "key:bold")
def _():
    qs = take(RU, 34, 8)
    return docx(simple(qs, inline="next")), [truth(q) for q in qs]


@case("w026_inline_same_line", "docx", "num:dot", "opt:inline", "key:bold")
def _():
    qs = take(RU, 42, 8)
    return docx(simple(qs, inline="same")), [truth(q) for q in qs]


@case("w027_inline_tabs_txt", "txt", "num:dot", "opt:inline_tabs", "key:end_list", "text:tabs")
def _():
    qs = take(RU, 1, 8)
    blocks = simple(qs, inline="tabs", key="none")
    blocks += [P(""), P("Ключ: " + key_pairs(qs, sep="-"))]
    return plain(blocks).encode("utf-8"), [truth(q) for q in qs]


@case("w028_option_sublines", "docx", "num:dot", "opt:rus_paren", "opt:sublines", "key:bold",
      note="длинные варианты продолжаются вторым абзацем без буквы")
def _():
    long = [
        Q("Что такое фотосинтез?", ["процесс образования органических веществ", "процесс распада белков", "процесс деления клетки"], [0]),
        Q("Что изучает экология?", ["взаимоотношения организмов", "строение атомов", "законы движения тел"], [0]),
        Q("Что такое атом?", ["мельчайшая частица химического элемента", "молекула воды", "единица измерения массы"], [0]),
        Q("Что такое материк?", ["крупный массив суши", "остров в океане", "горная система"], [0]),
    ]
    tails = ["из углекислого газа и воды на свету", "между собой и со средой обитания", "носитель его химических свойств",
             "окружённый морями и океанами"]
    blocks = []
    qs = []
    for n, (q, tail) in enumerate(zip(long, tails), start=1):
        blocks.append(P(f"{n}. {q['stem']}"))
        options = list(q["options"])
        for k, option in enumerate(options):
            blocks.append(P(f"{RUS[k]}) ", R(option, b=k == 0) if k == 0 else option))
            if k == 0:
                blocks.append(P(R(tail, b=True)))
        options[0] = options[0] + " " + tail
        qs.append(Q(q["stem"], options, [0]))
    return docx(blocks), [truth(q) for q in qs]


@case("w029_opts_paren_both", "docx", "num:dot", "opt:paren_both", "key:bold")
def _():
    qs = take(RU, 9, 8)
    return docx(simple(qs, label="paren_both")), [truth(q) for q in qs]


@case("w030_word_bullet_options", "docx", "num:dot", "opt:word_bullets", "key:bold")
def _():
    qs = take(RU, 17, 8)
    lists = {"abstract": {93: [("bullet", "•")]}, "nums": {93: (93, None)}}
    blocks = []
    for n, q in enumerate(qs, start=1):
        blocks.append(P(f"{n}. {q['stem']}"))
        for k, option in enumerate(q["options"]):
            blocks.append(P(*option_runs("", option, k in q["correct"], "bold"), num=(93, 0)))
    return docx(blocks, lists=lists), [truth(q) for q in qs]


@case("w031_opts_no_labels", "docx", "num:dot", "opt:none", "key:bold")
def _():
    qs = take(RU, 25, 8)
    return docx(simple(qs, label="none")), [truth(q) for q in qs]


@case("w032_opts_digits_key_end", "docx", "num:dot", "opt:num_paren", "key:end_list")
def _():
    qs = take(RU, 33, 8)
    blocks = simple(qs, label="num_paren", key="none")
    blocks += [P("Ответы:"), P(", ".join(f"{i}-{q['correct'][0] + 1}" for i, q in enumerate(qs, start=1)))]
    return docx(blocks), [truth(q) for q in qs]


@case("w033_options_grid_two_per_line", "txt", "num:dot", "opt:grid", "key:end_list", "text:tabs",
      note="варианты по два в строке через табуляцию: «а) …<tab>в) …»")
def _():
    qs = take(RU, 41, 6)
    blocks = []
    for n, q in enumerate(qs, start=1):
        o = q["options"]
        blocks += [P(f"{n}. {q['stem']}"), P(f"а) {o[0]}\t\tв) {o[2]}"), P(f"б) {o[1]}\t\tг) {o[3]}"), P("")]
    blocks.append(P("Ответы: " + key_pairs(qs, sep="")))
    return plain(blocks).encode("utf-8"), [truth(q) for q in qs]


@case("w034_soft_breaks_one_paragraph", "docx", "num:dot", "opt:rus_paren", "key:bold", "text:soft_breaks",
      note="вопрос и варианты в одном абзаце через разрыв строки (Shift+Enter)")
def _():
    qs = take(RU, 6, 8)
    blocks = []
    for n, q in enumerate(qs, start=1):
        runs = [f"{n}. {q['stem']}"]
        for k, option in enumerate(q["options"]):
            runs.append("\n")
            runs += option_runs(f"{RUS[k]}) ", option, k in q["correct"], "bold")
        blocks.append(P(*runs))
    return docx(blocks), [truth(q) for q in qs]


# Таблицы -----------------------------------------------------------------------

@case("w040_table_row_per_question_key_col", "docx", "table:row_per_q", "opt:columns", "key:column_letter")
def _():
    qs = take(RU, 12, 8)
    rows = [[C("№"), C("Вопрос"), C("А"), C("Б"), C("В"), C("Г"), C("Ответ")]]
    for n, q in enumerate(qs, start=1):
        rows.append([C(str(n)), C(q["stem"]), *[C(o) for o in q["options"]], C(RUS_UP[q["correct"][0]])])
    return docx([P("Тест по общим знаниям"), T(rows)]), [truth(q) for q in qs]


@case("w041_table_options_in_cell_bold", "docx", "table:options_in_cell", "opt:none", "key:bold")
def _():
    qs = take(RU, 20, 8)
    rows = [[C("№ п/п"), C("Вопрос"), C("Варианты ответов")]]
    for n, q in enumerate(qs, start=1):
        rows.append([C(f"{n}."), C(q["stem"]),
                     C(*[P(*option_runs("", o, k in q["correct"], "bold")) for k, o in enumerate(q["options"])])])
    return docx([T(rows)]), [truth(q) for q in qs]


@case("w042_table_option_rows_plus_column", "docx", "table:option_rows", "key:plus_column",
      note="№ и вопрос объединены вниз, вариант на строку, в последнем столбце «+» у верного")
def _():
    qs = take(RU, 28, 6)
    rows = [[C("№"), C("Вопрос"), C("Варианты"), C("Верный")]]
    for n, q in enumerate(qs, start=1):
        for k, o in enumerate(q["options"]):
            first = k == 0
            rows.append([C(str(n) if first else "", vmerge="restart" if first else "continue"),
                         C(q["stem"] if first else "", vmerge="restart" if first else "continue"),
                         C(o), C("+" if k in q["correct"] else "")])
    return docx([T(rows)]), [truth(q) for q in qs]


@case("w043_table_option_cols_no_header", "docx", "table:row_per_q", "opt:columns", "key:highlight", "table:no_header")
def _():
    qs = take(RU, 36, 8)
    rows = []
    for n, q in enumerate(qs, start=1):
        rows.append([C(str(n)), C(q["stem"]),
                     *[C(P(R(o, **(FORMATS["highlight"] if k in q["correct"] else {})))) for k, o in enumerate(q["options"])]])
    return docx([T(rows)]), [truth(q) for q in qs]


@case("w044_table_two_column_page", "docx", "table:two_column_page", "opt:rus_paren", "key:bold",
      note="страница в две колонки таблицей: вопросы 1–4 слева, 5–8 справа")
def _():
    qs = take(RU, 44, 8)
    left, right = [], []
    for n, q in enumerate(qs, start=1):
        (left if n <= 4 else right).extend(q_paras(n, q))
    return docx([T([[C(*left), C(*right)]])]), [truth(q) for q in qs]


@case("w045_table_key_column_text", "docx", "table:row_per_q", "opt:inline", "key:column_text",
      note="в столбце ключа — текст верного варианта, а не буква")
def _():
    qs = take(RU, 4, 8)
    rows = [[C("№"), C("Вопрос"), C("Варианты ответа"), C("Правильный ответ")]]
    for n, q in enumerate(qs, start=1):
        rows.append([C(str(n)), C(q["stem"]), C("; ".join(f"{RUS[k]}) {o}" for k, o in enumerate(q["options"]))),
                     C(q["options"][q["correct"][0]])])
    return docx([T(rows)]), [truth(q) for q in qs]


@case("w046_table_stem_rows_green", "docx", "table:stem_rows", "opt:rus_up_paren", "key:green",
      note="строка вопроса на всю ширину, под ней ряд вариантов; ключ зелёным")
def _():
    qs = take(RU, 14, 6)
    rows = []
    for n, q in enumerate(qs, start=1):
        rows.append([C(f"{n}. {q['stem']}", span=4)])
        rows.append([C(P(f"{RUS_UP[k]}) ", R(o, **(FORMATS["green"] if k in q["correct"] else {})))) for k, o in enumerate(q["options"])])
    return docx([P("Вариант 3"), T(rows)]), [truth(q) for q in qs]


@case("w047_table_autonumber_column", "docx", "table:autonumber_col", "opt:inline", "key:column_letter",
      note="столбец № — автонумерация Word (в ячейке нет текста)")
def _():
    qs = take(RU, 22, 8)
    lists = {"abstract": {94: [("decimal", "%1.")]}, "nums": {94: (94, None)}}
    rows = [[C("№"), C("Вопрос"), C("Варианты ответов"), C("Ответ")]]
    for q in qs:
        rows.append([C(P("", num=(94, 0))), C(q["stem"]), C(" ".join(f"{RUS[k]}) {o};" for k, o in enumerate(q["options"])).rstrip(";")),
                     C(RUS[q["correct"][0]])])
    return docx([T(rows)], lists=lists), [truth(q) for q in qs]


@case("w048_table_stem_and_options_in_one_cell", "docx", "table:options_in_cell", "opt:rus_paren", "key:underline")
def _():
    qs = take(RU, 30, 8)
    rows = []
    for n, q in enumerate(qs, start=1):
        paras = [P(q["stem"])] + [P(*option_runs(f"{RUS[k]}) ", o, k in q["correct"], "underline")) for k, o in enumerate(q["options"])]
        rows.append([C(str(n)), C(*paras)])
    return docx([T(rows)]), [truth(q) for q in qs]


@case("w049_table_letter_column_plus", "docx", "table:option_rows", "opt:letter_column", "key:plus_column",
      note="№ | Вопрос | Буква | Вариант | Ключ — вариант на строку")
def _():
    qs = take(RU, 38, 5)
    rows = [[C("№"), C("Вопрос"), C(""), C("Вариант ответа"), C("Ключ")]]
    for n, q in enumerate(qs, start=1):
        for k, o in enumerate(q["options"]):
            first = k == 0
            rows.append([C(str(n) if first else "", vmerge="restart" if first else "continue"),
                         C(q["stem"] if first else "", vmerge="restart" if first else "continue"),
                         C(f"{RUS[k]})"), C(o), C("+" if k in q["correct"] else "")])
    return docx([T(rows)]), [truth(q) for q in qs]


@case("w050_table_per_question", "docx", "table:per_question", "opt:rus_paren", "key:bold",
      note="каждый вопрос — своя маленькая таблица: строка вопроса и строки «буква | вариант»")
def _():
    qs = take(RU, 46, 6)
    blocks = []
    for n, q in enumerate(qs, start=1):
        rows = [[C(f"{n}."), C(q["stem"])]]
        for k, o in enumerate(q["options"]):
            rows.append([C(f"{RUS[k]})"), C(P(R(o, **(FORMATS["bold"] if k in q["correct"] else {}))))])
        blocks += [T(rows), P("")]
    return docx(blocks), [truth(q) for q in qs]


# Ключ -----------------------------------------------------------------------------

def _key_case(case_id, key, start, *tags, label="rus_paren", pool=RU, ext="docx", note=""):
    @case(case_id, ext, "num:dot", f"opt:{label}", f"key:{key}", *tags, note=note)
    def _():
        qs = take(pool, start, 8)
        blocks = simple(qs, label=label, key=key)
        return (docx(blocks) if ext == "docx" else plain(blocks).encode("utf-8")), [truth(q) for q in qs]


_key_case("w060_key_underline", "underline", 3)
_key_case("w061_key_italic", "italic", 7)
_key_case("w062_key_red", "red", 15)
_key_case("w063_key_green", "green", 23)
_key_case("w064_key_highlight", "highlight", 31)
_key_case("w065_key_shading", "shade", 39)
_key_case("w066_key_bold_whole_line", "bold_line", 47)
_key_case("w067_key_plus_before_label", "plus_before", 2, ext="txt")
_key_case("w068_key_star_before_label", "star_before", 10, ext="txt")
_key_case("w069_key_plus_after", "plus_after", 18, ext="txt")
_key_case("w070_key_verno_after", "verno_after", 26)
_key_case("w071_key_checkbox_symbols", "check", 34, note="☑ у верного варианта, ☐ у остальных")


@case("w072_mytest_plus_minus", "txt", "num:none", "opt:plus_minus", "key:plus_minus")
def _():
    qs = take(RU, 40, 8)
    blocks = []
    for q in qs:
        blocks.append(P(q["stem"]))
        blocks += [P(*option_runs("", o, k in q["correct"], "plus_minus")) for k, o in enumerate(q["options"])]
        blocks.append(P(""))
    return plain(blocks).encode("utf-8"), [truth(q) for q in qs]


@case("w073_key_end_dash_txt", "txt", "num:dot", "opt:rus_paren", "key:end_list")
def _():
    qs = take(RU, 0, 10)
    blocks = simple(qs, key="none", blank=True) + [P("Ответы:"), P(key_pairs(qs, sep="-"))]
    return plain(blocks).encode("utf-8"), [truth(q) for q in qs]


@case("w074_key_end_glued", "docx", "num:dot", "opt:rus_paren", "key:end_glued")
def _():
    qs = take(RU, 10, 10)
    blocks = simple(qs, key="none") + [P("Ключ"), P(" ".join(f"{i}{RUS[q['correct'][0]]}" for i, q in enumerate(qs, start=1)))]
    return docx(blocks), [truth(q) for q in qs]


@case("w075_key_end_grid", "docx", "num:dot", "opt:rus_paren", "key:end_grid", note="ключ таблицей: строка номеров, под ней строка букв")
def _():
    qs = take(RU, 20, 10)
    numbers = [C("№")] + [C(str(i)) for i in range(1, 11)]
    answers = [C("Ответ")] + [C(RUS[q["correct"][0]]) for q in qs]
    return docx(simple(qs, key="none") + [P("Ключ к тесту"), T([numbers, answers])]), [truth(q) for q in qs]


@case("w076_key_end_vertical_table", "docx", "num:dot", "opt:rus_up_dot", "key:end_table")
def _():
    qs = take(RU, 30, 10)
    rows = [[C("№ вопроса"), C("Правильный ответ")]] + [[C(str(i)), C(RUS_UP[q["correct"][0]])] for i, q in enumerate(qs, start=1)]
    return docx(simple(qs, label="rus_up_dot", key="none") + [P("Эталоны ответов"), T(rows)]), [truth(q) for q in qs]


@case("w077_two_variants_key_by_columns", "docx", "variants:two", "num:dot", "opt:rus_paren", "key:end_variant_columns",
      note="в файле два варианта с нумерацией заново; ключ — таблица «№ | Вариант 1 | Вариант 2»")
def _():
    v1, v2 = take(RU, 2, 6), take(RU, 26, 6)
    blocks = [P("Вариант 1")] + simple(v1, key="none") + [P("Вариант 2")] + simple(v2, key="none")
    rows = [[C("№"), C("Вариант 1"), C("Вариант 2")]] + [[C(str(i + 1)), C(RUS[a["correct"][0]]), C(RUS[b["correct"][0]])]
                                                        for i, (a, b) in enumerate(zip(v1, v2))]
    blocks += [P("Ключ"), T(rows)]
    return docx(blocks), [truth(q, variant=1) for q in v1] + [truth(q, variant=2) for q in v2]


@case("w078_key_separate_docx", "docx", "num:dot", "opt:rus_paren", "key:separate_file")
def _():
    qs = take(RU, 5, 10)
    key = docx([P("Ключ ответов"), T([[C("№"), C("Ответ")]] + [[C(str(i)), C(RUS_UP[q["correct"][0]])] for i, q in enumerate(qs, start=1)])])
    return docx(simple(qs, key="none")), [truth(q) for q in qs], {"key_file": ("docx", key)}


@case("w079_key_separate_txt", "docx", "num:paren", "opt:rus_paren", "key:separate_file")
def _():
    qs = take(RU, 15, 10)
    key = "\n".join(f"{i} – {RUS[q['correct'][0]]}" for i, q in enumerate(qs, start=1)) + "\n"
    return docx(simple(qs, num="paren", key="none")), [truth(q) for q in qs], {"key_file": ("txt", key.encode("utf-8"))}


@case("w080_key_section_lines", "txt", "num:dot", "opt:rus_paren", "key:end_lines", note="«Ответы:» и строки «1. б»")
def _():
    qs = take(RU, 25, 8)
    blocks = simple(qs, key="none", blank=True) + [P("Ответы:")] + [P(f"{i}. {RUS[q['correct'][0]]}") for i, q in enumerate(qs, start=1)]
    return plain(blocks).encode("utf-8"), [truth(q) for q in qs]


@case("w081_answer_line_letter", "docx", "num:dot", "opt:rus_paren", "key:answer_line")
def _():
    qs = take(RU, 33, 8)
    return docx(simple(qs, key="none", answer="letter")), [truth(q) for q in qs]


@case("w082_answer_line_text", "txt", "num:dot", "opt:rus_paren", "key:answer_text", note="«Правильный ответ: <текст варианта>»")
def _():
    qs = take(RU, 41, 8)
    return plain(simple(qs, key="none", answer="text", blank=True)).encode("utf-8"), [truth(q) for q in qs]


@case("w083_key_end_option_text", "docx", "num:dot", "opt:rus_paren", "key:end_text", note="ключ в конце — текстом варианта")
def _():
    qs = take(RU, 1, 8)
    blocks = simple(qs, key="none") + [P("Ответы:")] + [P(f"{i} — {q['options'][q['correct'][0]]}") for i, q in enumerate(qs, start=1)]
    return docx(blocks), [truth(q) for q in qs]


@case("w084_multiple_bold", "docx", "num:dot", "opt:rus_paren", "key:bold", "kind:multiple")
def _():
    qs = take(MULTI, 0, 8)
    return docx(simple(qs)), [truth(q) for q in qs]


@case("w085_multiple_key_list", "txt", "num:dot", "opt:rus_paren", "key:end_list", "kind:multiple")
def _():
    qs = take(MULTI, 2, 6) + take(RU, 9, 4)
    blocks = simple(qs, key="none", blank=True) + [P("Ключ:")] + [P(f"{i} – {', '.join(RUS[k] for k in q['correct'])}") for i, q in enumerate(qs, start=1)]
    return plain(blocks).encode("utf-8"), [truth(q) for q in qs]


@case("w086_no_key_docx", "docx", "num:dot", "opt:rus_paren", "key:none")
def _():
    qs = take(RU, 12, 8)
    return docx(simple(qs, key="none")), [truth(q, key=False) for q in qs]


@case("w087_no_key_txt", "txt", "num:paren", "opt:rus_up_dot", "key:none")
def _():
    qs = take(RU, 28, 8) + take(MULTI, 5, 2)
    return plain(simple(qs, num="paren", label="rus_up_dot", key="none", blank=True)).encode("utf-8"), [truth(q, key=False) for q in qs]


@case("w088_key_end_upper_latin_lookalike", "txt", "num:dot", "opt:rus_up_paren", "key:end_list",
      note="ключ набран заглавными, часть букв — латиницей в русской раскладке (B вместо В)")
def _():
    qs = take(RU, 36, 8)
    look = {"А": "A", "В": "B", "С": "C"}
    pairs = "; ".join(f"{i} - {look.get(RUS_UP[q['correct'][0]], RUS_UP[q['correct'][0]])}" for i, q in enumerate(qs, start=1))
    blocks = simple(qs, label="rus_up_paren", key="none") + [P(""), P("Ответы: " + pairs)]
    return plain(blocks).encode("utf-8"), [truth(q) for q in qs]


@case("w089_key_end_paren_pairs", "docx", "num:dot", "opt:rus_paren", "key:end_list")
def _():
    qs = take(RU, 44, 8)
    blocks = simple(qs, key="none") + [P("Ключ: " + " ".join(f"{i}) {RUS[q['correct'][0]]}" for i, q in enumerate(qs, start=1)))]
    return docx(blocks), [truth(q) for q in qs]


# Виды вопросов -------------------------------------------------------------------

@case("w090_matching", "docx", "kind:match", "key:answer_line")
def _():
    blocks, out = [], []
    for n, (stem, left, right, key) in enumerate(MATCH, start=1):
        blocks.append(P(f"{n}. {stem}"))
        blocks += [P(f"{i + 1}) {x}") for i, x in enumerate(left)]
        blocks += [P(f"{RUS_UP[i]}) {y}") for i, y in enumerate(right)]
        blocks.append(P("Ответ: " + ", ".join(f"{i + 1}-{RUS_UP[key[i]]}" for i in range(len(left)))))
        blocks.append(P(""))
        out.append(truth_match(stem, left, right, key))
    return docx(blocks), out


@case("w091_ordering", "docx", "kind:order", "key:answer_line")
def _():
    blocks, out = [], []
    for n, (stem, options, order) in enumerate(ORDER, start=1):
        blocks.append(P(f"{n}. {stem}"))
        blocks += [P(f"{i + 1}) {x}") for i, x in enumerate(options)]
        blocks.append(P("Ответ: " + ", ".join(str(i + 1) for i in order)))
        out.append(truth_order(stem, options, order))
    return docx(blocks), out


@case("w092_short_numeric_answers", "txt", "kind:open", "key:answer_line")
def _():
    blocks, out = [], []
    for n, (stem, answers) in enumerate(SHORT, start=1):
        blocks += [P(f"{n}. {stem}"), P(f"Ответ: {answers[0]}"), P("")]
        out.append(truth_open(stem, answers))
    return plain(blocks).encode("utf-8"), out


@case("w093_true_false_options", "docx", "kind:truefalse", "opt:rus_paren", "key:bold")
def _():
    blocks, out = [], []
    for n, (stem, value) in enumerate(TF, start=1):
        blocks.append(P(f"{n}. {stem}"))
        blocks.append(P("а) ", R("Верно", b=value) if value else "Верно"))
        blocks.append(P("б) ", R("Неверно", b=not value) if not value else "Неверно"))
        out.append(truth_tf(stem, value))
    return docx(blocks), out


@case("w094_true_false_table", "docx", "kind:truefalse", "table:statements", "key:column_word",
      note="таблица «Утверждение | Да/Нет»: в столбце ответа «да» или «нет»")
def _():
    rows = [[C("№"), C("Утверждение"), C("Ответ (да/нет)")]]
    out = []
    for n, (stem, value) in enumerate(TF, start=1):
        rows.append([C(str(n)), C(stem), C("да" if value else "нет")])
        out.append(truth_open(stem, ["да" if value else "нет"]))
    return docx([P("Ответьте «да» или «нет»."), T(rows)]), out


@case("w095_short_answers_table", "docx", "kind:open", "table:row_per_q", "key:column_text")
def _():
    rows = [[C("№"), C("Вопрос"), C("Ответ")]]
    out = []
    for n, (stem, answers) in enumerate(SHORT[:8], start=1):
        rows.append([C(str(n)), C(stem), C(answers[0])])
        out.append(truth_open(stem, answers))
    return docx([T(rows)]), out


@case("w096_mixed_kinds", "docx", "kind:mixed", "num:dot", "opt:rus_paren", "key:mixed")
def _():
    blocks, out = [], []
    n = 0
    for q in take(RU, 7, 3):
        n += 1
        blocks += q_paras(n, q)
        out.append(truth(q))
    for q in take(MULTI, 6, 2):
        n += 1
        blocks += q_paras(n, q)
        out.append(truth(q))
    for stem, answers in SHORT[4:6]:
        n += 1
        blocks += [P(f"{n}. {stem}"), P(f"Ответ: {answers[0]}")]
        out.append(truth_open(stem, answers))
    stem, options, order = ORDER[2]
    n += 1
    blocks += [P(f"{n}. {stem}")] + [P(f"{RUS[i]}) {x}") for i, x in enumerate(options)] + [P("Ответ: " + ", ".join(RUS[i] for i in order))]
    out.append(truth_order(stem, options, order))
    stem, left, right, key = MATCH[0]
    n += 1
    blocks += [P(f"{n}. {stem}")] + [P(f"{i + 1}. {x}") for i, x in enumerate(left)] + [P(f"{RUS_UP[i]}. {y}") for i, y in enumerate(right)]
    blocks.append(P("Ответ: " + " ".join(f"{i + 1}{RUS_UP[key[i]]}" for i in range(len(left)))))
    out.append(truth_match(stem, left, right, key))
    return docx(blocks), out


@case("w097_fill_blank_key_end", "txt", "kind:open", "key:end_text", note="«Вставьте пропущенное слово: ____», ответы списком в конце")
def _():
    items = [("Столица Франции — ______.", "Париж"), ("Вода состоит из водорода и ______.", "кислорода"),
             ("Самая большая планета Солнечной системы — ______.", "Юпитер"), ("Автор «Евгения Онегина» — ______.", "Пушкин"),
             ("Единица измерения силы тока — ______.", "ампер"), ("Процесс превращения пара в воду называется ______.", "конденсация")]
    blocks = [P("Вставьте пропущенное слово.")]
    blocks += [P(f"{n}. {stem}") for n, (stem, _) in enumerate(items, start=1)]
    blocks += [P(""), P("Ответы:")] + [P(f"{n} – {answer}") for n, (_, answer) in enumerate(items, start=1)]
    return plain(blocks).encode("utf-8"), [truth_open(stem, [answer]) for stem, answer in items]


# Строение файла ---------------------------------------------------------------------

@case("w100_two_subjects", "docx", "struct:subjects", "num:dot", "opt:rus_paren", "key:bold")
def _():
    a, b = take(RU, 3, 5), take(BEL, 0, 5)
    blocks = [P("Дисциплина: Естествознание")] + simple(a) + [P("Дисциплина: Беларуская мова")] + simple(b, label="be_paren")
    return docx(blocks), [truth(q, subject="Естествознание") for q in a] + [truth(q, subject="Беларуская мова") for q in b]


@case("w101_topics", "docx", "struct:topics", "num:dot", "opt:rus_paren", "key:bold")
def _():
    a, b, c = take(RU, 9, 4), take(MATH, 0, 4), take(CODE, 0, 4)
    blocks = [P("Тема 1. Общие вопросы")] + simple(a)
    blocks += [P("Тема 2. Математика")] + [x for n, q in enumerate(b, start=5) for x in q_paras(n, q)]
    blocks += [P("Тема 3. Программирование")] + [x for n, q in enumerate(c, start=9) for x in q_paras(n, q, code_font="Courier New")]
    out = [truth(q, topic="Тема 1. Общие вопросы") for q in a] + [truth(q, topic="Тема 2. Математика") for q in b]
    out += [truth(q, topic="Тема 3. Программирование") for q in c]
    return docx(blocks), out


@case("w102_heading_styles", "docx", "struct:word_headings", "num:dot", "opt:rus_paren", "key:underline")
def _():
    a, b = take(RU, 17, 4), take(EN, 6, 4)
    blocks = [P("Общие знания", style="Heading 1"), P("Природа", style="Heading 2")] + simple(a[:2], key="underline")
    blocks += [P("Люди и города", style="Heading 2")] + [x for n, q in enumerate(a[2:], start=3) for x in q_paras(n, q, key="underline")]
    blocks += [P("English", style="Heading 1"), P("Basics", style="Heading 2")]
    blocks += [x for n, q in enumerate(b, start=1) for x in q_paras(n, q, key="underline", label="lat_paren")]
    out = [truth(q, subject="Общие знания", topic="Природа") for q in a[:2]] + [truth(q, subject="Общие знания", topic="Люди и города") for q in a[2:]]
    out += [truth(q, subject="English", topic="Basics") for q in b]
    return docx(blocks), out


@case("w103_variants_restart_key_end", "txt", "variants:two", "num:dot", "opt:rus_paren", "key:end_list_by_variant")
def _():
    v1, v2 = take(RU, 11, 5), take(RU, 31, 5)
    blocks = [P("Вариант 1")] + simple(v1, key="none") + [P(""), P("Вариант 2")] + simple(v2, key="none")
    blocks += [P(""), P("Ответы"), P("Вариант 1: " + key_pairs(v1, sep="")), P("Вариант 2: " + key_pairs(v2, sep=""))]
    return plain(blocks).encode("utf-8"), [truth(q, variant=1) for q in v1] + [truth(q, variant=2) for q in v2]


@case("w104_duplicates", "docx", "struct:duplicates", "num:dot", "opt:rus_paren", "key:bold")
def _():
    qs = take(RU, 0, 5) + take(RU, 1, 2) + take(RU, 7, 1)
    return docx(simple(qs)), [truth(q) for q in qs]


@case("w105_junk_lines", "docx", "struct:junk", "num:dot", "opt:rus_paren", "key:bold",
      note="шапка «Утверждаю», инструкция, «Страница N из M», подпись преподавателя, дата")
def _():
    qs = take(RU, 19, 8)
    blocks = [P("УТВЕРЖДАЮ"), P("Заместитель директора по учебной работе"), P("__________ И. И. Иванова"), P("«01» сентября 2026 г."), P(""),
              P("Итоговый тест по курсу «Окружающий мир»"), P("Инструкция: выберите один правильный ответ. Время выполнения — 30 минут."), P("")]
    for n, q in enumerate(qs, start=1):
        blocks += q_paras(n, q)
        if n in (3, 6):
            blocks += [P(f"Страница {n // 3} из 3"), P("")]
    blocks += [P(""), P("Составитель: преподаватель ____________ П. П. Петров"), P("Рассмотрено на заседании цикловой комиссии, протокол № 2")]
    return docx(blocks), [truth(q) for q in qs]


@case("w106_mixed_languages", "docx", "lang:mixed", "num:dot", "opt:rus_paren", "key:bold")
def _():
    a, b, c = take(RU, 38, 3), take(BEL, 3, 3), take(EN, 8, 3)
    blocks = simple(a) + [x for n, q in enumerate(b, start=4) for x in q_paras(n, q, label="be_paren")]
    blocks += [x for n, q in enumerate(c, start=7) for x in q_paras(n, q, label="lat_paren")]
    return docx(blocks), [truth(q) for q in a + b + c]


@case("w107_belarusian_pytanne", "docx", "lang:be", "num:pytanne", "opt:be_paren", "key:bold")
def _():
    qs = take(BEL, 0, 10)
    return docx(simple(qs, num="pytanne", label="be_paren")), [truth(q) for q in qs]


@case("w108_english_answer_lines", "txt", "lang:en", "num:question_en", "opt:lat_up_dot", "key:answer_line")
def _():
    qs = take(EN, 0, 10)
    blocks = []
    for n, q in enumerate(qs, start=1):
        blocks += q_paras(n, q, num="question_en", label="lat_up_dot", key="none")
        blocks += [P(f"Answer: {LAT[q['correct'][0]].upper()}"), P("")]
    return plain(blocks).encode("utf-8"), [truth(q) for q in qs]


@case("w109_code_mono_blank_lines", "docx", "content:code", "num:dot", "opt:rus_paren", "key:bold")
def _():
    qs = take(CODE, 0, 10)
    blocks = []
    for n, q in enumerate(qs, start=1):
        blocks += q_paras(n, q, code_font="Consolas")
    return docx(blocks), [truth(q) for q in qs]


@case("w110_formulas", "docx", "content:formulas", "num:dot", "opt:rus_paren", "key:bold")
def _():
    qs = take(MATH, 0, 8)
    return docx(simple(qs)), [truth(q) for q in qs]


@case("w111_pictures", "docx", "content:pictures", "num:dot", "opt:rus_paren", "key:bold",
      note="картинка под текстом вопроса у трёх вопросов, вариант-картинка у одного")
def _():
    qs = take(RU, 23, 6)
    blocks, out = [], []
    for n, q in enumerate(qs, start=1):
        paras = q_paras(n, q)
        if n in (1, 3, 5):
            paras.insert(1, P(pics=1, pic_seed=n))
        blocks += paras
        out.append(truth(q, pictures=1 if n in (1, 3, 5) else 0))
    q = Q("Какая из картинок изображает квадрат?", ["", "", ""], [1])
    blocks += [P("7. " + q["stem"]), P("а) ", pics=1, pic_seed=20), P("б) ", R("", b=True), pics=1, pic_seed=21), P("в) ", pics=1, pic_seed=22),
               P("Ответ: б")]
    out.append(truth(q, pictures=3))
    return docx(blocks), out


@case("w112_text_boxes", "docx", "layout:text_boxes", "num:dot", "opt:rus_paren", "key:bold",
      note="вопросы в надписях Word (две надписи рядом — «две колонки»)")
def _():
    qs = take(RU, 4, 8)
    left = [p for n, q in enumerate(qs[:4], start=1) for p in q_paras(n, q)]
    right = [p for n, q in enumerate(qs[4:], start=5) for p in q_paras(n, q)]
    return docx([P("Тест"), TB(*left), TB(*right)]), [truth(q) for q in qs]


@case("w113_section_two_columns", "docx", "layout:section_columns", "num:dot", "opt:rus_paren", "key:bold")
def _():
    qs = take(RU, 12, 8)
    return docx(simple(qs), columns=2), [truth(q) for q in qs]


@case("w114_long_file_key_list", "docx", "struct:long", "num:dot", "opt:rus_paren", "key:end_list")
def _():
    qs = take(RU, 0, 48) + take(MATH, 0, 8) + take(EN, 0, 4)
    blocks = simple(qs, key="none") + [P("Ключи к тесту"), P(key_pairs(qs, sep=" – ", joiner="; "))]
    return docx(blocks), [truth(q) for q in qs]


@case("w115_pasted_from_pdf", "txt", "text:pdf_paste", "num:dot", "opt:rus_paren", "key:end_list",
      note="строки обрезаны по ширине страницы, перенос «газ-\\nами», номера страниц и колонтитулы посреди вопросов")
def _():
    qs = take(RU, 5, 10)
    lines = ["Тестовые задания по естествознанию", ""]
    for n, q in enumerate(qs, start=1):
        stem = q["stem"]
        if len(stem) > 40:
            cut = stem.rfind(" ", 0, 40)
            lines += [f"{n}. {stem[:cut]}", stem[cut + 1:]]
        else:
            lines.append(f"{n}. {stem}")
        for k, o in enumerate(q["options"]):
            lines.append(f"{RUS[k]}) {o}")
            if n == 4 and k == 1:
                lines += ["", "2", "Тестовые задания по естествознанию", ""]
        if n == 8:
            lines += ["", "3", ""]
    lines += ["", "Ответы: " + key_pairs(qs, sep="", joiner=" ")]
    return ("\n".join(lines) + "\n").encode("utf-8"), [truth(q) for q in qs]


@case("w116_cp1251_txt", "txt", "text:cp1251", "num:dot", "opt:rus_paren", "key:end_list")
def _():
    qs = take(RU, 27, 8)
    blocks = simple(qs, key="none", blank=True) + [P("Ответы: " + key_pairs(qs, sep="-"))]
    return plain(blocks).encode("cp1251"), [truth(q) for q in qs]


@case("w117_utf16_txt", "txt", "text:utf16", "num:dot", "opt:rus_paren", "key:plus_after")
def _():
    qs = take(RU, 25, 8)
    return plain(simple(qs, key="plus_after", blank=True)).encode("utf-16"), [truth(q) for q in qs]


@case("w118_two_paragraph_stems", "docx", "stem:multi_paragraph", "num:dot", "opt:rus_paren", "key:bold",
      note="перед вопросом абзац условия, вопрос — следующим абзацем")
def _():
    base = [
        Q("Какой это город?", ["Минск", "Брест", "Пинск", "Орша"], [0], context="Этот город стоит на реке Свислочь и является столицей."),
        Q("О каком явлении идёт речь?", ["испарение", "плавление", "конденсация", "кристаллизация"], [2], context="Водяной пар охлаждается и превращается в капли."),
        Q("Какой газ выделяется?", ["кислород", "азот", "водород", "гелий"], [0], context="Растение на свету поглощает углекислый газ."),
        Q("Кто это?", ["Скорина", "Колас", "Купала", "Богданович"], [0], context="Он издал «Псалтырь» в Праге в 1517 году."),
    ]
    blocks, out = [], []
    for n, q in enumerate(base, start=1):
        blocks += [P(f"{n}. {q['context']}"), P(q["stem"])]
        blocks += [P(*option_runs(f"{RUS[k]}) ", o, k in q["correct"], "bold")) for k, o in enumerate(q["options"])]
        out.append({**truth(q), "stem": q["context"] + "\n" + q["stem"]})
    return docx(blocks), out


@case("w119_repeated_instructions", "docx", "struct:junk", "num:zadanie", "opt:rus_paren", "key:bold",
      note="«Выберите один правильный ответ:» перед вариантами каждого вопроса")
def _():
    qs = take(RU, 29, 8)
    blocks = []
    for n, q in enumerate(qs, start=1):
        blocks += [P(f"Задание №{n}. {q['stem']}"), P("Выберите один правильный ответ:")]
        blocks += [P(*option_runs(f"{RUS[k]}) ", o, k in q["correct"], "bold")) for k, o in enumerate(q["options"])]
    return docx(blocks), [truth(q) for q in qs]


# Форматы ------------------------------------------------------------------------------

@case("w130_gift_mixed", "txt", "format:gift", "kind:mixed")
def _():
    text = ["$CATEGORY: Общие знания", ""]
    out = []
    for q in take(RU, 0, 4):
        answers = " ".join(("=" if k in q["correct"] else "~") + o for k, o in enumerate(q["options"]))
        text += [f"::{q['stem'][:20]}::{q['stem']} {{{answers}}}", ""]
        out.append(truth(q))
    for stem, value in TF[:3]:
        text += [f"{stem} {{{'T' if value else 'F'}}}", ""]
        out.append(truth_tf(stem, value))
    for stem, answers in SHORT[:3]:
        text += [f"{stem} {{={answers[0]}}}", ""]
        out.append(truth_open(stem, answers))
    q = MULTI[0]
    share = round(100 / len(q["correct"]), 5)
    answers = " ".join((f"~%{share}%" if k in q["correct"] else "~%-100%") + o for k, o in enumerate(q["options"]))
    text += [f"{q['stem']} {{{answers}}}", ""]
    out.append(truth(q))
    stem, left, right, key = MATCH[0]
    text += [f"{stem} {{" + " ".join(f"={left[i]} -> {right[key[i]]}" for i in range(len(left))) + "}", ""]
    out.append(truth_match(stem, left, right, key))
    return "\n".join(text).encode("utf-8"), out


@case("w131_aiken", "txt", "format:aiken", "opt:lat_up_dot", "key:aiken")
def _():
    qs = take(RU, 8, 8)
    lines = []
    for q in qs:
        lines.append(q["stem"])
        lines += [f"{LAT[k].upper()}. {o}" for k, o in enumerate(q["options"])]
        lines += [f"ANSWER: {LAT[q['correct'][0]].upper()}", ""]
    return "\n".join(lines).encode("utf-8"), [truth(q) for q in qs]


def _moodle_xml():
    parts = ['<?xml version="1.0" encoding="UTF-8"?>', "<quiz>"]
    out = []
    for q in take(RU, 16, 4):
        answers = "".join(f'<answer fraction="{100 if k in q["correct"] else 0}" format="html"><text>{escape(o)}</text></answer>'
                          for k, o in enumerate(q["options"]))
        parts.append(f'<question type="multichoice"><name><text>{escape(q["stem"][:20])}</text></name>'
                     f'<questiontext format="html"><text><![CDATA[<p>{q["stem"]}</p>]]></text></questiontext>'
                     f"<single>true</single>{answers}</question>")
        out.append(truth(q))
    for stem, value in TF[3:5]:
        parts.append(f'<question type="truefalse"><name><text>tf</text></name><questiontext format="html"><text>{escape(stem)}</text></questiontext>'
                     f'<answer fraction="{100 if value else 0}"><text>true</text></answer><answer fraction="{0 if value else 100}"><text>false</text></answer></question>')
        out.append(truth_tf(stem, value))
    for stem, answers in SHORT[3:5]:
        parts.append(f'<question type="shortanswer"><name><text>sa</text></name><questiontext format="html"><text>{escape(stem)}</text></questiontext>'
                     f'<answer fraction="100"><text>{escape(answers[0])}</text></answer></question>')
        out.append(truth_open(stem, answers))
    parts.append("</quiz>")
    return "\n".join(parts).encode("utf-8"), out


CASES.append({"id": "w132_moodle_xml", "ext": "xml", "tags": ["format:moodle_xml", "kind:mixed"], "note": "Moodle XML",
              "fn": _moodle_xml})


@case("w133_moodle_review_copy", "txt", "format:moodle_review", "opt:lat_dot", "key:answer_text",
      note="страница просмотра попытки Moodle, скопированная текстом: «Вопрос 1», «Баллов: 1,00 из 1,00», «Правильный ответ: …»")
def _():
    qs = take(RU, 2, 8)
    lines = []
    for n, q in enumerate(qs, start=1):
        lines += [f"Вопрос {n}", "Верно" if n % 3 else "Неверно", f"Баллов: {'1,00' if n % 3 else '0,00'} из 1,00", "Отметить вопрос",
                  "Текст вопроса", q["stem"], "Выберите один ответ:"]
        lines += [f"{LAT[k]}. {o}" for k, o in enumerate(q["options"])]
        lines += ["Отзыв", f"Правильный ответ: {q['options'][q['correct'][0]]}"]
    return ("\n".join(lines) + "\n").encode("utf-8"), [truth(q) for q in qs]


@case("w134_google_forms_copy", "txt", "format:google_forms", "opt:none", "key:answer_text",
      note="форма Google с ответами: «1 балл», варианты без букв, «Правильный ответ» и текст варианта следующей строкой")
def _():
    qs = take(RU, 18, 6)
    lines = ["Тест по окружающему миру", "Всего баллов: 4/6", "* Обязательно", "", "Адрес электронной почты *", "student@example.com", ""]
    for n, q in enumerate(qs, start=1):
        lines += [f"{q['stem']} *", "1/1" if n % 2 else "0/1"]
        lines += q["options"]
        lines += ["Правильный ответ", q["options"][q["correct"][0]], ""]
    return ("\n".join(lines) + "\n").encode("utf-8"), [truth(q) for q in qs]


@case("w135_kahoot_xlsx", "xlsx", "format:kahoot", "key:column_numbers")
def _():
    qs = take(EN, 0, 6) + take(MULTI, 2, 2)
    rows = [["Quiz template"], ["Add questions, at least two answer alternatives, time limit and choose correct answers (at least one)."],
            [], ["Question - max 120 characters", "Answer 1 - max 75 characters", "Answer 2 - max 75 characters",
                 "Answer 3 - max 75 characters", "Answer 4 - max 75 characters", "Time limit (sec) – 5, 10, 20, 30, 60, 90, 120, or 240 secs",
                 "Correct answer(s) - choose at least one"]]
    out = []
    for q in qs:
        options = q["options"][:4]
        correct = [k for k in q["correct"] if k < 4]
        rows.append([q["stem"], *options, 20, ",".join(str(k + 1) for k in correct)])
        out.append({**truth(q), "options": options, "correct": correct, "kind": "multiple" if len(correct) > 1 else "single"})
    return xlsx(rows), out


@case("w136_quizizz_xlsx", "xlsx", "format:quizizz", "key:column_numbers", "kind:mixed")
def _():
    rows = [["Question Text", "Question Type", "Option 1", "Option 2", "Option 3", "Option 4", "Option 5", "Correct Answer",
             "Time in seconds", "Image Link"]]
    out = []
    for q in take(RU, 30, 5):
        rows.append([q["stem"], "Multiple Choice", *q["options"], "", str(q["correct"][0] + 1), 30, ""])
        out.append(truth(q))
    q = MULTI[3]
    rows.append([q["stem"], "Checkbox", *q["options"], "", ",".join(str(k + 1) for k in q["correct"]), 30, ""])
    out.append(truth(q))
    for stem, answers in SHORT[6:8]:
        rows.append([stem, "Fill-in-the-Blank", answers[0], "", "", "", "", "", 30, ""])
        out.append(truth_open(stem, answers))
    return xlsx(rows), out


@case("w137_csv_comma", "csv", "format:csv", "key:column_letter")
def _():
    import csv

    qs = take(RU, 3, 8)
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["Вопрос", "Вариант A", "Вариант B", "Вариант C", "Вариант D", "Ответ"])
    for q in qs:
        writer.writerow([q["stem"], *q["options"], "ABCD"[q["correct"][0]]])
    return buffer.getvalue().encode("utf-8"), [truth(q) for q in qs]


@case("w138_csv_semicolon_cp1251", "csv", "format:csv", "text:cp1251", "key:column_text")
def _():
    qs = take(RU, 36, 8)
    lines = ["№;Вопрос;Ответ 1;Ответ 2;Ответ 3;Ответ 4;Правильный ответ"]
    lines += [f"{n};{q['stem']};{';'.join(q['options'])};{q['options'][q['correct'][0]]}" for n, q in enumerate(qs, start=1)]
    return ("\r\n".join(lines) + "\r\n").encode("cp1251"), [truth(q) for q in qs]


@case("w139_html_list", "html", "format:html", "key:bold")
def _():
    qs = take(RU, 21, 8)
    parts = ["<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>Тест</title></head><body><h1>Тест</h1><ol>"]
    for q in qs:
        options = "".join(f"<li>{'<b>' + escape(o) + '</b>' if k in q['correct'] else escape(o)}</li>" for k, o in enumerate(q["options"]))
        parts.append(f"<li><p>{escape(q['stem'])}</p><ol type=\"a\">{options}</ol></li>")
    parts.append("</ol></body></html>")
    return "".join(parts).encode("utf-8"), [truth(q) for q in qs]


@case("w140_html_table", "html", "format:html", "table:row_per_q", "key:column_letter")
def _():
    qs = take(RU, 37, 8)
    rows = "".join(f"<tr><td>{n}</td><td>{escape(q['stem'])}</td>" + "".join(f"<td>{escape(o)}</td>" for o in q["options"])
                   + f"<td>{RUS_UP[q['correct'][0]]}</td></tr>" for n, q in enumerate(qs, start=1))
    html = ("<html><head><meta charset=\"utf-8\"></head><body><table border=\"1\"><tr><th>№</th><th>Вопрос</th><th>А</th><th>Б</th>"
            f"<th>В</th><th>Г</th><th>Ответ</th></tr>{rows}</table></body></html>")
    return html.encode("utf-8"), [truth(q) for q in qs]


@case("w141_markdown_checkboxes", "md", "format:markdown", "opt:md_checkbox", "key:checkbox")
def _():
    qs = take(RU, 45, 6) + take(MULTI, 4, 2)
    lines = ["# Тест", ""]
    for n, q in enumerate(qs, start=1):
        lines.append(f"{n}. {q['stem']}")
        lines += [f"   - [{'x' if k in q['correct'] else ' '}] {o}" for k, o in enumerate(q["options"])]
        lines.append("")
    return "\n".join(lines).encode("utf-8"), [truth(q) for q in qs]


@case("w142_markdown_bold", "md", "format:markdown", "opt:rus_paren", "key:md_bold", "struct:topics")
def _():
    a, b = take(RU, 6, 4), take(EN, 3, 4)
    lines = ["## Тема 1. Природа", ""]
    for n, q in enumerate(a, start=1):
        lines.append(f"**{n}. {q['stem']}**")
        lines += [f"{RUS[k]}) **{o}**" if k in q["correct"] else f"{RUS[k]}) {o}" for k, o in enumerate(q["options"])]
        lines.append("")
    lines += ["## Тема 2. English", ""]
    for n, q in enumerate(b, start=5):
        lines.append(f"{n}. {q['stem']}")
        lines += [f"{LAT[k]}) **{o}**" if k in q["correct"] else f"{LAT[k]}) {o}" for k, o in enumerate(q["options"])]
        lines.append("")
    out = [truth(q, topic="Тема 1. Природа") for q in a] + [truth(q, topic="Тема 2. English") for q in b]
    return "\n".join(lines).encode("utf-8"), out


def pdf(lines: list[str]) -> bytes:
    """PDF с текстовым слоем без библиотек: Helvetica с кодировкой cp1251 (Differences по именам uniXXXX) и ToUnicode —
    pdftotext и любой разбор PDF достают из него кириллицу. Строка — строка страницы, 48 строк на страницу."""
    codes = {}
    for byte in range(128, 256):
        char = bytes([byte]).decode("cp1251", errors="ignore")
        if char:
            codes[byte] = ord(char)
    differences = " ".join(f"{byte} /uni{code:04X}" for byte, code in codes.items())
    cmap_lines = "\n".join(f"<{byte:02X}> <{code:04X}>" for byte, code in codes.items())
    tounicode = ("/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) "
                 "/Supplement 0 >> def /CMapName /Adobe-Identity-UCS def /CMapType 2 def 1 begincodespacerange <00> <FF> "
                 "endcodespacerange 95 beginbfrange <20> <7E> <0020> endbfrange "
                 f"{len(codes)} beginbfchar\n{cmap_lines}\nendbfchar endcmap CMapName currentdict /CMap defineresource pop end end")
    pages = [lines[i:i + 48] for i in range(0, len(lines), 48)] or [[]]
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"",  # страницы — ниже, когда известны номера
        f"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /FirstChar 32 /LastChar 255 /Widths [{' '.join(['556'] * 224)}] "
        f"/Encoding << /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [{differences}] >> /ToUnicode 4 0 R >>".encode("ascii"),
        f"<< /Length {len(tounicode)} >>\nstream\n{tounicode}\nendstream".encode("ascii"),
    ]
    kids = []
    for page in pages:
        text = b"BT /F1 11 Tf 14 TL 50 800 Td\n"
        for line in page:
            raw = line.encode("cp1251")
            raw = raw.replace(b"\\", b"\\\\").replace(b"(", b"\\(").replace(b")", b"\\)")
            text += b"(" + raw + b") Tj T*\n"
        text += b"ET"
        objects.append(b"<< /Length %d >>\nstream\n" % len(text) + text + b"\nendstream")
        content = len(objects)
        objects.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> "
                       f"/Contents {content} 0 R >>".encode("ascii"))
        kids.append(len(objects))
    objects[1] = f"<< /Type /Pages /Kids [{' '.join(f'{k} 0 R' for k in kids)}] /Count {len(kids)} >>".encode("ascii")
    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n".encode("ascii") + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode("ascii")
    out += "".join(f"{offset:010d} 00000 n \n" for offset in offsets).encode("ascii")
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode("ascii")
    return bytes(out)


def _pdf():
    qs = take(RU, 33, 8)
    blocks = simple(qs, key="none") + [P(""), P("Ответы: " + key_pairs(qs, sep="-"))]
    return pdf(plain(blocks).split("\n")), [truth(q) for q in qs]


CASES.append({"id": "w143_pdf_text_layer", "ext": "pdf", "tags": ["format:pdf", "num:dot", "opt:rus_paren", "key:end_list"],
              "note": "PDF с текстовым слоем (Helvetica, cp1251, ToUnicode)", "fn": _pdf})


@case("w144_xlsx_key_column", "xlsx", "format:xlsx", "table:row_per_q", "key:column_letter")
def _():
    qs = take(RU, 40, 8)
    rows = [["№", "Вопрос", "а", "б", "в", "г", "Ответ"]]
    rows += [[n, q["stem"], *q["options"], RUS[q["correct"][0]]] for n, q in enumerate(qs, start=1)]
    return xlsx(rows), [truth(q) for q in qs]


@case("w145_xlsx_option_rows_fill", "xlsx", "format:xlsx", "table:option_rows", "key:fill")
def _():
    qs = take(RU, 0, 6)
    rows = [["№", "Вопрос", "Варианты ответа"]]
    for n, q in enumerate(qs, start=1):
        for k, o in enumerate(q["options"]):
            rows.append([n if k == 0 else "", q["stem"] if k == 0 else "", (o, {"fill": "C6EFCE"}) if k in q["correct"] else o])
    return xlsx(rows), [truth(q) for q in qs]


@case("w146_pasted_word_table_tsv", "txt", "format:tsv", "table:option_rows", "key:column_letter",
      note="таблица Word, вставленная как текст: ячейки через табуляцию")
def _():
    qs = take(RU, 10, 6)
    lines = ["№\tВопрос\tВарианты ответа\tОтвет"]
    for n, q in enumerate(qs, start=1):
        lines.append(f"{n}\t{q['stem']}\t" + " ".join(f"{RUS[k]}) {o}" for k, o in enumerate(q["options"])) + f"\t{RUS[q['correct'][0]]}")
    return ("\n".join(lines) + "\n").encode("utf-8"), [truth(q) for q in qs]


@case("w147_xlsx_bold_in_cells", "xlsx", "format:xlsx", "table:row_per_q", "key:bold", "table:no_header")
def _():
    qs = take(EN, 5, 6)
    rows = [[q["stem"], *[(o, {"b": True}) if k in q["correct"] else o for k, o in enumerate(q["options"])]] for q in qs]
    return xlsx(rows), [truth(q) for q in qs]


# Ещё раскладки ----------------------------------------------------------------------

@case("w150_options_on_stem_line_after_colon", "docx", "num:dot", "opt:inline", "key:bold", "kind:multiple")
def _():
    qs = take(MULTI, 0, 4) + take(RU, 46, 2)
    return docx(simple(qs, inline="same")), [truth(q) for q in qs]


@case("w151_stem_bold_key_underline", "docx", "num:dot", "opt:rus_paren", "key:underline", "stem:bold",
      note="текст вопроса жирный, ключ подчёркнут")
def _():
    qs = take(RU, 3, 8)
    return docx(simple(qs, key="underline", stem_marks={"b": True})), [truth(q) for q in qs]


@case("w152_stem_bold_key_bold_line", "docx", "num:dot", "opt:rus_paren", "key:bold_line", "stem:bold",
      note="вопрос жирный, верный вариант жирный целиком")
def _():
    qs = take(RU, 11, 8)
    return docx(simple(qs, key="bold_line", stem_marks={"b": True})), [truth(q) for q in qs]


@case("w153_vopros_line_options_digits_key_end", "txt", "num:vopros_line", "opt:num_paren", "key:end_list")
def _():
    qs = take(RU, 19, 8)
    blocks = []
    for n, q in enumerate(qs, start=1):
        blocks += [P(f"Вопрос №{n}"), P(q["stem"])] + [P(f"{k + 1}) {o}") for k, o in enumerate(q["options"])] + [P("")]
    blocks.append(P("Ответы: " + ", ".join(f"{n}-{q['correct'][0] + 1}" for n, q in enumerate(qs, start=1))))
    return plain(blocks).encode("utf-8"), [truth(q) for q in qs]


@case("w154_five_options_key_bold_mixed_case", "docx", "num:dot", "opt:rus_up_paren", "key:bold")
def _():
    qs = [Q(q["stem"], q["options"] + ["нет правильного ответа"], q["correct"]) for q in take(RU, 27, 8)]
    return docx(simple(qs, label="rus_up_paren")), [truth(q) for q in qs]


@case("w155_options_with_trailing_semicolons", "docx", "num:dot", "opt:rus_paren", "key:bold", "text:list_punct")
def _():
    qs = take(RU, 35, 8)
    blocks = []
    for n, q in enumerate(qs, start=1):
        blocks.append(P(f"{n}. {q['stem']}"))
        for k, o in enumerate(q["options"]):
            end = ";" if k < len(q["options"]) - 1 else "."
            blocks.append(P(f"{RUS[k]}) ", R(o + end, b=True) if k in q["correct"] else o + end))
    return docx(blocks), [truth(q) for q in qs]


@case("w156_key_in_stem_parentheses", "txt", "num:dot", "opt:rus_paren", "key:stem_suffix",
      note="ответ в скобках в конце строки вопроса: «(Ответ: б)»")
def _():
    qs = take(RU, 43, 6)
    blocks = []
    for n, q in enumerate(qs, start=1):
        blocks.append(P(f"{n}. {q['stem']} (Ответ: {RUS[q['correct'][0]]})"))
        blocks += [P(f"{RUS[k]}) {o}") for k, o in enumerate(q["options"])]
        blocks.append(P(""))
    return plain(blocks).encode("utf-8"), [truth(q) for q in qs]


@case("w157_tests_numbered_within_topics", "docx", "struct:topics", "num:sub", "opt:rus_paren", "key:bold",
      note="номера «1.1.», «1.2.» внутри тем")
def _():
    a, b = take(RU, 0, 3), take(RU, 20, 3)
    blocks = [P("1. Природа")]
    for n, q in enumerate(a, start=1):
        blocks += [P(f"1.{n}. {q['stem']}")] + [P(*option_runs(f"{RUS[k]}) ", o, k in q["correct"], "bold")) for k, o in enumerate(q["options"])]
    blocks.append(P("2. Человек"))
    for n, q in enumerate(b, start=1):
        blocks += [P(f"2.{n}. {q['stem']}")] + [P(*option_runs(f"{RUS[k]}) ", o, k in q["correct"], "bold")) for k, o in enumerate(q["options"])]
    out = [truth(q, topic="1. Природа") for q in a] + [truth(q, topic="2. Человек") for q in b]
    return docx(blocks), out


@case("w158_indigo_star_hash", "txt", "num:none", "opt:indigo", "key:indigo", "kind:multiple",
      note="Indigo: «*» — единственный верный, «#» — несколько верных")
def _():
    out, lines = [], []
    for q in take(RU, 14, 4):
        lines.append(q["stem"])
        lines += [("*" if k in q["correct"] else "") + o for k, o in enumerate(q["options"])]
        lines.append("")
        out.append(truth(q))
    for q in take(MULTI, 1, 2):
        lines.append(q["stem"])
        lines += [("#" if k in q["correct"] else "") + o for k, o in enumerate(q["options"])]
        lines.append("")
        out.append(truth(q))
    return "\n".join(lines).encode("utf-8"), out


@case("w159_numbered_questions_inside_table_cells_bold", "docx", "table:one_column", "num:dot", "opt:rus_paren", "key:bold",
      note="весь тест — одна таблица в один столбец, вопрос с вариантами — в своей строке")
def _():
    qs = take(RU, 24, 6)
    rows = [[C(*q_paras(n, q))] for n, q in enumerate(qs, start=1)]
    return docx([T(rows)]), [truth(q) for q in qs]


# Отложенные (holdout, тег «holdout»): написаны после улучшений разбора по w-файлам и в настройке не участвовали — по
# ним видно, насколько улучшения переносятся на соседние раскладки. Их ошибки исправлять отдельно, с новым отложенным
# набором, иначе мерить перенос будет нечем.

@case("h01_vopros_hash_space_upper_paren_underline", "docx", "holdout", "num:vopros", "opt:rus_up_paren", "key:underline")
def _():
    qs = take(RU, 5, 6)
    blocks = []
    for n, q in enumerate(qs, start=1):
        blocks.append(P(f"Вопрос № {n}. {q['stem']}"))
        blocks += [P(*option_runs(f"{RUS_UP[k]}) ", o, k in q["correct"], "underline")) for k, o in enumerate(q["options"])]
    return docx(blocks), [truth(q) for q in qs]


@case("h02_roman_paren_latin_dot_italic", "docx", "holdout", "num:roman", "opt:lat_dot", "key:italic")
def _():
    qs = take(EN, 1, 6)
    blocks = []
    for n, q in enumerate(qs, start=1):
        blocks.append(P(f"{roman(n)}) {q['stem']}"))
        blocks += [P(*option_runs(f"{LAT[k]}. ", o, k in q["correct"], "italic")) for k, o in enumerate(q["options"])]
    return docx(blocks), [truth(q) for q in qs]


@case("h03_zadanie_colon_line_digit_options_endash_key", "txt", "holdout", "num:vopros_line", "opt:num_dot", "key:end_list")
def _():
    qs = take(RU, 12, 6)
    lines = []
    for n, q in enumerate(qs, start=1):
        lines += [f"Задание {n}:", q["stem"]] + [f"{k + 1}. {o}" for k, o in enumerate(q["options"])] + [""]
    lines.append("Ответы: " + " ".join(f"{n}–{q['correct'][0] + 1}" for n, q in enumerate(qs, start=1)))
    return ("\n".join(lines) + "\n").encode("utf-8"), [truth(q) for q in qs]


@case("h04_unnumbered_colon_stems_upper_dot_bold_line", "docx", "holdout", "num:none", "opt:rus_up_dot", "key:bold_line")
def _():
    qs = [Q(q["stem"].rstrip("?") + ":", q["options"], q["correct"]) for q in take(RU, 20, 6)]
    blocks = []
    for q in qs:
        blocks.append(P(q["stem"]))
        blocks += [P(*option_runs(f"{RUS_UP[k]}. ", o, k in q["correct"], "bold_line")) for k, o in enumerate(q["options"])]
    return docx(blocks), [truth(q) for q in qs]


@case("h05_inline_commas_next_line_key_glued_no_spaces", "txt", "holdout", "num:dot", "opt:inline", "key:end_glued")
def _():
    qs = take(RU, 28, 6)
    lines = []
    for n, q in enumerate(qs, start=1):
        lines += [f"{n}. {q['stem']}", ", ".join(f"{RUS[k]}) {o}" for k, o in enumerate(q["options"]))]
    lines += ["", "Ключ: " + "".join(f"{n}{RUS[q['correct'][0]]}" for n, q in enumerate(qs, start=1))]
    return ("\n".join(lines) + "\n").encode("utf-8"), [truth(q) for q in qs]


@case("h06_filled_squares", "txt", "holdout", "num:dot", "opt:squares", "key:check")
def _():
    qs = take(RU, 34, 6)
    lines = []
    for n, q in enumerate(qs, start=1):
        lines.append(f"{n}. {q['stem']}")
        lines += [("■ " if k in q["correct"] else "□ ") + o for k, o in enumerate(q["options"])]
    return ("\n".join(lines) + "\n").encode("utf-8"), [truth(q) for q in qs]


@case("h07_check_mark_after_option", "txt", "holdout", "num:paren", "opt:rus_paren", "key:check_after")
def _():
    qs = take(RU, 40, 6)
    lines = []
    for n, q in enumerate(qs, start=1):
        lines.append(f"{n}) {q['stem']}")
        lines += [f"{RUS[k]}) {o}" + (" ✓" if k in q["correct"] else "") for k, o in enumerate(q["options"])]
    return ("\n".join(lines) + "\n").encode("utf-8"), [truth(q) for q in qs]


@case("h08_table_variant_columns_answer_number", "docx", "holdout", "table:row_per_q", "opt:columns", "key:column_numbers")
def _():
    qs = take(RU, 2, 6)
    rows = [[C("Вопрос"), C("Вариант 1"), C("Вариант 2"), C("Вариант 3"), C("Вариант 4"), C("Ответ")]]
    rows += [[C(q["stem"]), *[C(o) for o in q["options"]], C(str(q["correct"][0] + 1))] for q in qs]
    return docx([T(rows)]), [truth(q) for q in qs]


@case("h09_roman_variants_key_by_variant", "txt", "holdout", "variants:two", "num:dot", "opt:rus_paren", "key:end_list_by_variant")
def _():
    v1, v2 = take(RU, 7, 4), take(RU, 37, 4)
    lines = ["ВАРИАНТ I"]
    for n, q in enumerate(v1, start=1):
        lines += [f"{n}. {q['stem']}"] + [f"{RUS[k]}) {o}" for k, o in enumerate(q["options"])]
    lines += ["", "ВАРИАНТ II"]
    for n, q in enumerate(v2, start=1):
        lines += [f"{n}. {q['stem']}"] + [f"{RUS[k]}) {o}" for k, o in enumerate(q["options"])]
    lines += ["", "Ответы", "I вариант: " + key_pairs(v1, sep="-"), "II вариант: " + key_pairs(v2, sep="-")]
    return ("\n".join(lines) + "\n").encode("utf-8"), [truth(q, variant=1) for q in v1] + [truth(q, variant=2) for q in v2]


@case("h10_options_in_2x2_table_under_stem", "docx", "holdout", "table:options_grid", "num:dot", "key:bold")
def _():
    qs = take(RU, 15, 5)
    blocks = []
    for n, q in enumerate(qs, start=1):
        o = q["options"]
        cell = [C(P(f"{RUS[k]}) ", R(o[k], **(FORMATS["bold"] if k in q["correct"] else {})))) for k in range(4)]
        blocks += [P(f"{n}. {q['stem']}"), T([[cell[0], cell[1]], [cell[2], cell[3]]]), P("")]
    return docx(blocks), [truth(q) for q in qs]


@case("h11_markdown_hr_bullets_bold", "md", "holdout", "format:markdown", "num:none", "opt:dash", "key:md_bold")
def _():
    qs = take(RU, 44, 5)
    lines = []
    for q in qs:
        lines += [f"**{q['stem']}**", ""] + [f"- **{o}**" if k in q["correct"] else f"- {o}" for k, o in enumerate(q["options"])]
        lines += ["", "---", ""]
    return "\n".join(lines).encode("utf-8"), [truth(q) for q in qs]


@case("h12_belarusian_adkaz_lines", "txt", "holdout", "lang:be", "num:dot", "opt:be_paren", "key:answer_line")
def _():
    qs = take(BEL, 2, 6)
    lines = []
    for n, q in enumerate(qs, start=1):
        lines += [f"{n}. {q['stem']}"] + [f"{BE[k]}) {o}" for k, o in enumerate(q["options"])] + [f"Адказ: {BE[q['correct'][0]]}", ""]
    return ("\n".join(lines) + "\n").encode("utf-8"), [truth(q) for q in qs]


@case("h13_english_correct_answer_lines", "txt", "holdout", "lang:en", "num:dot", "opt:lat_up_paren", "key:answer_line")
def _():
    qs = take(EN, 6, 6)
    lines = []
    for n, q in enumerate(qs, start=1):
        lines += [f"{n}. {q['stem']}"] + [f"{LAT[k].upper()}) {o}" for k, o in enumerate(q["options"])]
        lines += [f"Correct answer: {LAT[q['correct'][0]].upper()}", ""]
    return ("\n".join(lines) + "\n").encode("utf-8"), [truth(q) for q in qs]


@case("h14_word_list_digit_options_highlight", "docx", "holdout", "num:dot", "opt:word_list_digits", "key:highlight", "stem:bold")
def _():
    qs = take(RU, 25, 6)
    lists = {"abstract": {95: [("decimal", "%1)")]}, "nums": {300 + n: (95, 0) for n in range(1, 7)}}
    blocks = []
    for n, q in enumerate(qs, start=1):
        blocks.append(P(R(f"{n}. {q['stem']}", b=True)))
        blocks += [P(*option_runs("", o, k in q["correct"], "highlight"), num=(300 + n, 0)) for k, o in enumerate(q["options"])]
    return docx(blocks, lists=lists), [truth(q) for q in qs]


@case("h15_stars_separated_answer_text", "txt", "holdout", "num:none", "opt:rus_paren", "key:answer_text", "sep:stars")
def _():
    qs = take(RU, 31, 6)
    lines = []
    for q in qs:
        lines += [q["stem"]] + [f"{RUS[k]}) {o}" for k, o in enumerate(q["options"])]
        lines += [f"Ответ: {q['options'][q['correct'][0]]}", "***"]
    return ("\n".join(lines) + "\n").encode("utf-8"), [truth(q) for q in qs]


@case("h16_key_table_latin_letters_for_cyrillic", "docx", "holdout", "num:dot", "opt:rus_up_paren", "key:end_grid")
def _():
    qs = take(RU, 9, 8)
    latin = "ABCD"
    rows = [[C("Вопрос")] + [C(str(i)) for i in range(1, 9)], [C("Ответ")] + [C(latin[q["correct"][0]]) for q in qs]]
    return docx(simple(qs, label="rus_up_paren", key="none") + [P("Ключ"), T(rows)]), [truth(q) for q in qs]


@case("h17_moodle_review_english", "txt", "holdout", "format:moodle_review", "lang:en", "opt:lat_dot", "key:answer_text")
def _():
    qs = take(EN, 0, 6)
    lines = []
    for n, q in enumerate(qs, start=1):
        lines += [f"Question {n}", "Correct", "Mark 1.00 out of 1.00", "Flag question", "Question text", q["stem"], "Select one:"]
        lines += [f"{LAT[k]}. {o}" for k, o in enumerate(q["options"])]
        lines += ["Feedback", f"The correct answer is: {q['options'][q['correct'][0]]}"]
    return ("\n".join(lines) + "\n").encode("utf-8"), [truth(q) for q in qs]


@case("h18_inline_three_spaces", "docx", "holdout", "num:dot", "opt:inline_spaces", "key:bold")
def _():
    qs = take(RU, 3, 6)
    blocks = []
    for n, q in enumerate(qs, start=1):
        runs = []
        for k, o in enumerate(q["options"]):
            runs += option_runs(f"{RUS[k]}) ", o, k in q["correct"], "bold") + (["   "] if k < len(q["options"]) - 1 else [])
        blocks += [P(f"{n}. {q['stem']}"), P(*runs)]
    return docx(blocks), [truth(q) for q in qs]


@case("h19_kahoot_like_csv_semicolon_xlsx_headers_ru", "xlsx", "holdout", "format:xlsx", "table:row_per_q", "key:column_numbers")
def _():
    qs = take(RU, 41, 6)
    rows = [["Тест «Окружающий мир»"], [], ["Текст вопроса", "Ответ 1", "Ответ 2", "Ответ 3", "Ответ 4", "Номер верного ответа"]]
    rows += [[q["stem"], *q["options"], q["correct"][0] + 1] for q in qs]
    return xlsx(rows), [truth(q) for q in qs]


@case("h20_numbered_answers_section_word_values", "docx", "holdout", "num:dot", "opt:rus_paren", "key:end_text")
def _():
    qs = take(RU, 18, 6)
    blocks = simple(qs, key="none") + [P("Правильные ответы:")]
    blocks += [P(f"{n}) {RUS[q['correct'][0]]} – {q['options'][q['correct'][0]]}") for n, q in enumerate(qs, start=1)]
    return docx(blocks), [truth(q) for q in qs]


def main() -> int:
    FILES.mkdir(parents=True, exist_ok=True)
    TRUTH.mkdir(parents=True, exist_ok=True)
    ids = set()
    written = 0
    for spec in CASES:
        case_id = spec["id"]
        assert case_id not in ids, case_id
        ids.add(case_id)
        produced = spec["fn"]()
        data, questions = produced[0], produced[1]
        extra = produced[2] if len(produced) > 2 else {}
        name = f"{case_id}.{spec['ext']}"
        record = {"id": case_id, "file": f"files/{name}", "tags": spec["tags"], "note": spec["note"],
                  "supported": spec["ext"] in ("docx", "txt", "md", "xlsx"), "questions": questions}
        if data is None:
            if not (FILES / name).is_file():
                print(f"skip {name}: generator unavailable", file=sys.stderr)
                continue
        else:
            (FILES / name).write_bytes(data)
        if "key_file" in extra:
            ext, key_data = extra["key_file"]
            key_name = f"{case_id}_key.{ext}"
            (FILES / key_name).write_bytes(key_data)
            record["key_file"] = f"files/{key_name}"
        (TRUTH / f"{case_id}.json").write_text(json.dumps(record, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        written += 1
    print(f"{written} files, {sum(1 for _ in TRUTH.glob('*.json'))} truth records")
    return 0


if __name__ == "__main__":
    sys.exit(main())
