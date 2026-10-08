/**
 * The film's words are the app's own: every phrase of the copy must occur in the app's source (outside
 * the reel and the example data), or be one of the plain facts listed below. The example's numbers are
 * held to the example's own data.
 */
import { describe, expect, it } from 'vitest';
import { EYEBROW, HEADLINE, TRY_LABEL } from '../home/landingCopy';
import * as C from './content';

const SOURCES = import.meta.glob('../../**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** The app's code: no tests, no reel (the film's own copy), no example data (checked on its own below). */
const APP_TEXT = Object.entries(SOURCES)
  .filter(([path]) => !/\.test\.tsx?$/.test(path) && !path.includes('/components/reel/') && !path.includes('/data/example/'))
  .map(([, text]) => text)
  .join('\n')
  .replace(/\s+/g, ' ');

const inApp = (phrase: string) => APP_TEXT.includes(phrase.replace(/\s+/g, ' '));

/** Plain facts the film states about the app, which the app does without saying them in these words. */
const PLAIN_FACTS = ['Пункты ответа — под каждым вопросом'];

describe('the film copy is the app’s own', () => {
  it('uses the landing’s first lines and the chapters’ sentences as the app writes them', () => {
    for (const phrase of [EYEBROW, HEADLINE, TRY_LABEL]) expect(inApp(phrase), phrase).toBe(true);
    for (const line of [
      'Ответы — цитатами из ваших лекций',
      'Билет — вслух, с переспросом',
      'Строки стирают только ответы в разные дни',
      'Каждый однокурсник получит свою копию экзамена',
    ]) {
      expect(inApp(line), line).toBe(true);
    }
  });

  it('writes each statement of the chapters as the app writes it, or as a plain fact', () => {
    for (const lines of Object.values(C.STATEMENTS)) {
      const sentence = lines.join(' ');
      expect(inApp(sentence) || PLAIN_FACTS.includes(sentence), sentence).toBe(true);
    }
  });

  it('shows the lecture check, the answer and the notes in the app’s own words', () => {
    for (const phrase of [
      'Лекция «',
      ' · фрагмент ',
      'подходит к ',
      'Отметить подходящие (',
      'Без подходящей лекции: ',
      'Отвечать голосом',
      'По ключевым словам: ',
      'итог — после ответа',
      'Экзаменатор',
      C.NOTES.afterQuestion,
      C.NOTES.notNamed,
      'была стёрта',
    ]) {
      expect(inApp(phrase), phrase).toBe(true);
    }
    expect(inApp('Распознано')).toBe(true);
    expect(inApp('вопросов')).toBe(true);
    expect(C.NOTES.returned).toBe('была стёрта · пункт не назван');
  });

  it('shows the group, the day’s question and the reminder in the app’s own words', () => {
    for (const phrase of [C.GROUP.copyLabel, C.GROUP.questionOfDay, C.GROUP.remind, 'Напоминание в 20:00']) {
      expect(inApp(phrase), phrase).toBe(true);
    }
  });
});

describe('the example’s numbers and words come from the example', () => {
  it('lists the example’s twelve questions and counts them as the editor does', () => {
    expect(C.LIST).toHaveLength(12);
    expect(C.RECOGNIZED).toBe('Распознано 12 вопросов');
    expect(C.LIST_TITLE).toBe('Вопросы к экзамену по микроэкономике');
    expect(C.FOCUS_NUMBER).toBe(7);
    expect(C.FOCUS_TEXT).toBe('Эластичность спроса и выручка продавца.');
  });

  it('takes the lecture check from the editor’s fit on the example: four questions, and questions 11 and 12 without a lecture', () => {
    expect(C.FIT_HINT).toBe('подходит к 4 вопросам');
    expect(C.FIT_BUTTON).toBe('Отметить подходящие (4)');
    expect(C.UNMATCHED_LINE).toBe('Без подходящей лекции: вопросы 11 и 12.');
    expect(C.SLIP.caption).toBe('Лекция «Эластичность спроса» · фрагмент 5');
    expect(C.SLIP.quote).toBe('Если спрос эластичный, снижение цены увеличивает выручку');
  });

  it('writes the cheat sheet’s lines and the examiner’s follow-up from the example’s own points', () => {
    expect(C.POINTS.map((point) => point.short)).toEqual([
      'выручка = цена × количество',
      'эластичный: снижение цены → выручка ↑',
      'неэластичный: выручка ↑ при повышении цены',
      'единичная эластичность: выручка не меняется',
    ]);
    expect(C.TICKET.turns[1].text).toBe(C.FOLLOWUPS[2]);
    expect(C.FOLLOWUPS[2]).toBe('А если спрос неэластичный, как продавцу увеличить выручку?');
    expect(C.TICKET.countLine).toBe('По ключевым словам: 2 из 4');
  });
});
