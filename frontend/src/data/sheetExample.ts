/**
 * The cheat sheet of /try's example exam («Микроэкономика») as the landing and the sign-in reels draw it in Meldy's own
 * look (decision 2026-10-10): questions 6 and 7 with their short lines word for word (data/example/questions.ts), and how
 * far every question's lines are on the day the pictures replay an answer. sheetExample.test.ts holds it to the example;
 * the example's data itself is not imported here (the landing stays light).
 */
import type { SheetState } from '../components/film/listLine';

export interface SheetLineText {
  text: string;
  /** Main points have a dot, the others a dash. */
  essential: boolean;
}

export interface SheetQuestionText {
  number: number;
  text: string;
  lines: readonly SheetLineText[];
}

export const Q4: SheetQuestionText = {
  number: 4,
  text: 'Рыночное равновесие. Дефицит и излишек.',
  lines: [
    { text: 'равновесие = пересечение спроса и предложения', essential: true },
    { text: 'при равновесной цене: вел. спроса = вел. предложения', essential: true },
    { text: 'цена ниже равновесной → дефицит', essential: true },
    { text: 'цена выше равновесной → излишек', essential: true },
    { text: 'цена сама → равновесие', essential: false },
  ],
};

export const Q6: SheetQuestionText = {
  number: 6,
  text: 'Факторы ценовой эластичности спроса.',
  lines: [
    { text: 'заменителей ↑ → спрос эластичнее', essential: true },
    { text: 'доля в бюджете ↑ → эластичность ↑', essential: true },
    { text: 'необходимость — неэластичный, роскошь — эластичный', essential: true },
    { text: 'со временем спрос эластичнее', essential: false },
  ],
};

export const Q7: SheetQuestionText = {
  number: 7,
  text: 'Эластичность спроса и выручка продавца.',
  lines: [
    { text: 'выручка = цена × количество', essential: true },
    { text: 'эластичный: снижение цены → выручка ↑', essential: true },
    { text: 'неэластичный: выручка ↑ при повышении цены', essential: true },
    { text: 'единичная эластичность: выручка не меняется', essential: false },
  ],
};

/**
 * Every question's lines before the answer the pictures replay (questions 1–11; question 12 is in no lecture and has
 * no lines). Question 6 is learned — every main line erased; question 7's first line was named the day before, its
 * third came back after it was erased and then not named.
 */
export const SHEET_BEFORE: ReadonlyArray<{ number: number; states: readonly SheetState[] }> = [
  { number: 1, states: ['erased', 'erased', 'rubbed', 'fresh'] },
  { number: 2, states: ['erased', 'rubbed', 'fresh'] },
  { number: 3, states: ['rubbed', 'fresh', 'fresh', 'fresh'] },
  { number: 4, states: ['erased', 'erased', 'rubbed', 'fresh', 'fresh'] },
  { number: 5, states: ['fresh', 'fresh', 'fresh', 'fresh', 'fresh'] },
  { number: 6, states: ['erased', 'erased', 'erased', 'fresh'] },
  { number: 7, states: ['rubbed', 'fresh', 'returned', 'fresh'] },
  { number: 8, states: ['fresh', 'fresh', 'fresh', 'fresh'] },
  { number: 9, states: ['rubbed', 'fresh', 'fresh', 'fresh', 'fresh'] },
  { number: 10, states: ['fresh', 'fresh', 'fresh', 'fresh', 'fresh'] },
  { number: 11, states: ['fresh', 'fresh', 'fresh', 'fresh'] },
];

/**
 * The note under a line that came back (the exam page's copy.lineNote for «returned», without its dates), with a plain
 * space before «·» as the landing reel's own note has it (components/reel/content.ts; sheetChapters.test ties them).
 */
export const CAME_BACK = 'была стёрта · пункт не назван';
/** The note under a point named only after the examiner's question (the cheat sheet's own words). */
export const AFTER_QUESTION = 'назван только после вопроса экзаменатора';
/** The example's subject, as the sheet's card names it. */
export const SHEET_SUBJECT = 'Микроэкономика';
