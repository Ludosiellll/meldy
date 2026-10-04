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
}

# Сверка списка: AI_COSTS["examMapping"] за каждые начатые столько новых вопросов.
EXAM_MAPPING_QUESTIONS_PER_CHARGE = 40

# Устный экзамен у «профессора» (/exam): весь экзамен по числу вопросов, списывается
# один раз — при первом вопросе. Длина не из списка — как у обычного билета (5).
PROFESSOR_EXAM_COSTS = {3: 1, 5: 2, 10: 4}
PROFESSOR_EXAM_DEFAULT_LENGTH = 5


def exam_mapping_cost(questions: int) -> int:
    """Единицы сверки списка: 10 за каждые начатые 40 вопросов, которые уходят модели."""
    count = max(0, int(questions))
    return AI_COSTS["examMapping"] * math.ceil(count / EXAM_MAPPING_QUESTIONS_PER_CHARGE)


def professor_exam_cost(length) -> int:
    """Единицы устного экзамена у «профессора» по числу вопросов (3, 5 или 10)."""
    if isinstance(length, bool) or length not in PROFESSOR_EXAM_COSTS:
        length = PROFESSOR_EXAM_DEFAULT_LENGTH
    return PROFESSOR_EXAM_COSTS[length]
