/**
 * Тарифы и цена действий ИИ в единицах дневного лимита (расчёт 2026-10-04: заметка
 * `10_Project/AI_Limits_2026-10-04` в meldy-notes). Те же числа знает сервер (`backend/plans.py`):
 * списывает единицы он, клиент только показывает остаток и предупреждает заранее.
 *
 * Единица ≈ 0,1 ₽ расходов на модель (Gemini 3.1 Flash-Lite по ценам Google на 2026-10-04).
 */

/** Бесплатный аккаунт: единиц ИИ в сутки (сброс в 00:00 UTC). */
export const FREE_DAILY_UNITS = 100;

/** PRO: потолок честного использования в сутки — защищает от скриптов, а не от учёбы. */
export const PRO_DAILY_UNITS = 1000;

/** Сколько единиц стоит действие. Действия, которых здесь нет, лимит не расходуют. */
export const AI_COSTS = {
  /** Анализ лекции: конспект, карточки, тест (и по выбору — разговор, шпаргалка). */
  lecture: 20,
  /** Сверка списка вопросов с лекциями — за каждые начатые 40 новых вопросов. */
  examMapping: 10,
  /** Проверка ответа на билет: быстрая проверка, переспрос и протокол. */
  answer: 4,
  /** Пункты ответа по вопросу, который ещё не разбирали (один раз на вопрос). */
  answerPoints: 1,
  /** «Разговор» по лекции. */
  conversation: 5,
  /** Схемы к готовому разговору. */
  visuals: 2,
  /** Шпаргалка. */
  cheatsheet: 5,
  /** Сообщение в чате с ИИ. */
  chatMessage: 1,
} as const;

export type AICostKind = keyof typeof AI_COSTS;

/** Окно «Что даёт PRO» открывается этим событием на window (см. components/pro). */
export const OPEN_PRO_EVENT = 'meldy:open-pro';

export type ProReason = 'pricing' | 'limit' | 'meter';

/** Открыть окно PRO из любого места приложения. */
export function openProWindow(reason: ProReason = 'pricing'): void {
  try {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(OPEN_PRO_EVENT, { detail: { reason } }));
  } catch {
    // Окно — подсказка; без него работа не ломается.
  }
}
