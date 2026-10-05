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
    "chatMessage": 1,
    # Прежние разделы: столько же, сколько до 2026-10-04 списывал браузер.
    "course": 5,
    "missions": 2,
    "mistakesPractice": 2,
    "gradebookScan": 1,
    "careerProfile": 5,
    "careerReview": 5,
    # Закрыто 2026-10-05: вызовы модели, которые раньше ничего не стоили.
    # Распознавание скана PDF — за каждые начатые OCR_PAGES_PER_CHARGE страниц (фото страницы
    # входит в анализ, как любой медиафайл).
    "scanPages": 5,
    # Раздел анализа заново. Бесплатно — только починка раздела, который не получился в уже
    # оплаченном анализе своей лекции (сервер сверяет это по базе).
    "analysisSection": 7,
    # Устный экзамен у «профессора»: каждый вопрос и каждая оценка ответа.
    "professorQuestion": 1,
    "professorEvaluate": 1,
    # Карьера (скрытый раздел): реплика или подсказка — 1, курс, тест, задание, проект — 3.
    "careerChat": 1,
    "careerGenerate": 3,
}

# Сверка списка: AI_COSTS["examMapping"] за каждые начатые столько новых вопросов.
EXAM_MAPPING_QUESTIONS_PER_CHARGE = 40

# Распознавание скана: AI_COSTS["scanPages"] за каждые начатые столько страниц (кусок ocr.py).
OCR_PAGES_PER_CHARGE = 15

# Устный экзамен у «профессора» (/exam): вопрос и оценка ответа списываются каждый раз; цена
# экзамена — для проверки остатка до начала. Длина не из списка — как у обычного билета (5).
PROFESSOR_EXAM_LENGTHS = (3, 5, 10)
PROFESSOR_EXAM_DEFAULT_LENGTH = 5


def exam_mapping_cost(questions: int) -> int:
    """Единицы сверки списка: 10 за каждые начатые 40 вопросов, которые уходят модели."""
    count = max(0, int(questions))
    return AI_COSTS["examMapping"] * math.ceil(count / EXAM_MAPPING_QUESTIONS_PER_CHARGE)


def scan_cost(pages) -> int:
    """Единицы распознавания скана PDF: 5 за каждые начатые 15 страниц."""
    count = max(0, int(pages))
    return AI_COSTS["scanPages"] * math.ceil(count / OCR_PAGES_PER_CHARGE)


def professor_exam_cost(length) -> int:
    """Единицы всего устного экзамена у «профессора» (3, 5 или 10 вопросов): вопрос и оценка на каждый."""
    if isinstance(length, bool) or length not in PROFESSOR_EXAM_LENGTHS:
        length = PROFESSOR_EXAM_DEFAULT_LENGTH
    return length * (AI_COSTS["professorQuestion"] + AI_COSTS["professorEvaluate"])
