/**
 * «Все вопросы»: `minutes_per_day` at the database's top value (lib/containers/plan.ts ALL_QUESTIONS_MIN, the same
 * number; allQuestionsMinutes.test.ts keeps them equal). The words of the import page and of the plan (copy.ts,
 * copyImport.ts) take it from here: through plan.ts they brought the whole planner along, also to the landing's reel,
 * which shows those words (smoothness audit 20.10: 24 KB of the guest's landing). plan.ts itself is copied to the
 * Telegram bot as it is, so it keeps its own constant.
 */
export const ALL_QUESTIONS_MINUTES = 300;
