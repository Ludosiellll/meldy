"""Тарифы и цена действий ИИ в единицах дневного лимита (расчёт 2026-10-04).

Зеркало frontend/src/lib/plans.ts: сервер списывает единицы, клиент показывает остаток.
Единица ≈ 0,1 ₽ расходов на модель (Gemini 3.1 Flash-Lite по ценам Google на 2026-10-04).
"""

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
}

# Сверка списка: AI_COSTS["examMapping"] за каждые начатые столько новых вопросов.
EXAM_MAPPING_QUESTIONS_PER_CHARGE = 40
