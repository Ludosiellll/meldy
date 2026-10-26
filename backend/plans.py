"""Тарифы и цена действий ИИ в единицах дневного лимита (расчёт 2026-10-04).

Зеркало frontend/src/lib/plans.ts: сервер списывает единицы, клиент показывает остаток.
Единица ≈ 0,1 ₽ расходов на модель (Gemini 3.1 Flash-Lite по ценам Google на 2026-10-04).
"""

import math

FREE_DAILY_UNITS = 100
PRO_DAILY_UNITS = 1000

AI_COSTS = {
    "lecture": 20,
    "examMapping": 10,
    "answer": 4,
    "answerPoints": 1,
    "conversation": 5,
    "visuals": 2,
    "cheatsheet": 5,
    # Прежние разделы: столько же, сколько до 2026-10-04 списывал браузер.
    "mistakesPractice": 2,
    "gradebookScan": 1,
    # Закрыто 2026-10-05: вызовы модели, которые раньше ничего не стоили.
    # Распознавание скана PDF — за каждые начатые OCR_PAGES_PER_CHARGE страниц (фото страницы
    # входит в анализ, как любой медиафайл).
    "scanPages": 5,
    # Раздел анализа заново. Бесплатно — только починка раздела, который не получился в анализе
    # своей лекции (по квитанции анализа, receipts.py).
    "analysisSection": 7,
    # Голосовой репетитор: ход разговора, на который ответила модель (tutor_api.py).
    "tutorTurn": 1,
    # Разбор сложных мест банка вопросов моделью (bank_ai.py) — за каждые начатые 100 вопросов, отправленных модели.
    "importAI": 5,
}
# Убраны вместе со скрытыми разделами (2026-10-05): чат, курсы, миссии, экзамен у «профессора»,
# карьера.

# Сверка списка: AI_COSTS["examMapping"] за каждые начатые столько новых вопросов.
EXAM_MAPPING_QUESTIONS_PER_CHARGE = 40

# Разбор банка с ИИ: AI_COSTS["importAI"] за каждые начатые столько вопросов, отправленных модели.
IMPORT_AI_QUESTIONS_PER_CHARGE = 100


def import_ai_cost(questions: int) -> int:
    """Единицы разбора сложных мест банка: 5 за каждые начатые 100 вопросов, которые уходят модели (не меньше 5)."""
    count = max(1, int(questions))
    return AI_COSTS["importAI"] * math.ceil(count / IMPORT_AI_QUESTIONS_PER_CHARGE)


# Распознавание скана: AI_COSTS["scanPages"] за каждые начатые столько страниц (кусок ocr.py).
OCR_PAGES_PER_CHARGE = 15

# Запись лекции (владелец 2026-10-26: «одним запросом можно выжрать весь лимит»). Узкое место — общий бесплатный
# запас распознавания речи Groq на весь сайт (7 200 с аудио в час, 28 800 в день): длина записи меряется до
# списания, и цена растёт с ней. До RECORDING_BASE_SECONDS — цена лекции, дальше RECORDING_STEP_UNITS за каждые
# начатые RECORDING_STEP_SECONDS. Одна запись — не длиннее RECORDING_MAX_SECONDS; за день — не больше
# RECORDING_DAILY_SECONDS (бесплатно / PRO; считает база, recording_charges).
RECORDING_BASE_SECONDS = 30 * 60
RECORDING_STEP_SECONDS = 15 * 60
RECORDING_STEP_UNITS = 10
RECORDING_MAX_SECONDS = 2 * 60 * 60
RECORDING_DAILY_SECONDS = {"free": 2 * 60 * 60, "pro": 5 * 60 * 60}

# Очень длинный текст (вставленный, из файла или со страницы): до TEXT_BASE_CHARS — цена лекции, дальше
# TEXT_STEP_UNITS за каждые начатые TEXT_STEP_CHARS. Модель читает текст лекции целиком в каждом разделе.
TEXT_BASE_CHARS = 50_000
TEXT_STEP_CHARS = 50_000
TEXT_STEP_UNITS = 10


def recording_cost(seconds) -> int:
    """Единицы анализа записи такой длины: 20 до 30 минут, дальше +10 за каждые начатые 15 минут."""
    length = max(0.0, float(seconds or 0))
    extra = max(0.0, length - RECORDING_BASE_SECONDS)
    return AI_COSTS["lecture"] + RECORDING_STEP_UNITS * math.ceil(extra / RECORDING_STEP_SECONDS)


def text_cost(chars) -> int:
    """Единицы анализа текста такой длины: 20 до 50 000 знаков, дальше +10 за каждые начатые 50 000."""
    count = max(0, int(chars or 0))
    extra = max(0, count - TEXT_BASE_CHARS)
    return AI_COSTS["lecture"] + TEXT_STEP_UNITS * math.ceil(extra / TEXT_STEP_CHARS)


def exam_mapping_cost(questions: int) -> int:
    """Единицы сверки списка: 10 за каждые начатые 40 вопросов, которые уходят модели."""
    count = max(0, int(questions))
    return AI_COSTS["examMapping"] * math.ceil(count / EXAM_MAPPING_QUESTIONS_PER_CHARGE)


def scan_cost(pages) -> int:
    """Единицы распознавания скана PDF: 5 за каждые начатые 15 страниц."""
    count = max(0, int(pages))
    return AI_COSTS["scanPages"] * math.ceil(count / OCR_PAGES_PER_CHARGE)

