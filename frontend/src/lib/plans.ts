/**
 * Тарифы и цена действий ИИ в единицах дневного лимита (расчёт 2026-10-04: заметка
 * `10_Project/AI_Limits_2026-10-04` в meldy-notes и docs/ai-limits-2026-10-04.md). Те же числа знает
 * сервер (`backend/plans.py`): списывает единицы он, клиент только показывает остаток и
 * предупреждает заранее.
 *
 * Единица ≈ 0,1 ₽ расходов на модель (Gemini 3.1 Flash-Lite по ценам Google на 2026-10-04).
 */

/** Бесплатный аккаунт: единиц ИИ в сутки (сброс в 00:00 UTC). */
export const FREE_DAILY_UNITS = 100;

/** PRO: потолок честного использования в сутки — защищает от скриптов, а не от учёбы. */
export const PRO_DAILY_UNITS = 1000;

/** Сколько единиц стоит действие. Действия, которых здесь нет, лимит не расходуют. */
export const AI_COSTS = {
  /** Анализ лекции: конспект, карточки, тест (и по выбору — разговор, выжимка). */
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
  /** Выжимка лекции («Создать выжимку» во вкладке «Кратко»). */
  cheatsheet: 5,
  // Прежние разделы: столько же, сколько до 2026-10-04 списывал браузер.
  /** Работа над ошибками. */
  mistakesPractice: 2,
  /** Распознавание оценок по фото. */
  gradebookScan: 1,
  // Закрыто 2026-10-05: вызовы модели, которые раньше ничего не стоили.
  /** Распознавание скана PDF — за каждые начатые 15 страниц (фото страницы входит в анализ). */
  scanPages: 5,
  /** Раздел анализа заново. Бесплатно — починка раздела, который не получился в анализе своей лекции. */
  analysisSection: 7,
  /** Ход голосового репетитора, на который ответила модель. */
  tutorTurn: 1,
} as const;
// Убраны вместе со скрытыми разделами (2026-10-05): чат, курсы, миссии, экзамен у «профессора», карьера.

export type AICostKind = keyof typeof AI_COSTS;

/** Сверка списка: AI_COSTS.examMapping за каждые начатые столько новых вопросов. */
export const EXAM_MAPPING_QUESTIONS_PER_CHARGE = 40;

/** Единицы сверки: 10 за каждые начатые 40 вопросов, которые уходят модели (готовые — бесплатно). */
export function examMappingCost(questions: number): number {
  const count = Math.max(0, Math.trunc(Number(questions) || 0));
  return AI_COSTS.examMapping * Math.ceil(count / EXAM_MAPPING_QUESTIONS_PER_CHARGE);
}

/** Распознавание скана: AI_COSTS.scanPages за каждые начатые столько страниц. */
export const OCR_PAGES_PER_CHARGE = 15;

/** Единицы распознавания скана PDF: 5 за каждые начатые 15 страниц. */
export function scanCost(pages: number): number {
  const count = Math.max(0, Math.trunc(Number(pages) || 0));
  return AI_COSTS.scanPages * Math.ceil(count / OCR_PAGES_PER_CHARGE);
}

/** Дневной лимит аккаунта в единицах. */
export function dailyUnits(isPro: boolean): number {
  return isPro ? PRO_DAILY_UNITS : FREE_DAILY_UNITS;
}

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
