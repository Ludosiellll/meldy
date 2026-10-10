import { describe, expect, it } from 'vitest';
import wordsSource from './words.ts?raw';
import type { DayPlan } from '../../types/container';
import { planDay } from './plan.ts';
import {
  LINE_KEYS, NBSP, RULE_LINE, SKIP_NOTE, TWO_DAYS, dayRowText, dayText, figureLines, figureRow, glue, lineText, nextStudyDayWord, planDetail,
  planLine, planTitle, plural, rangeText, shownMinutes, startLabel, weekdayText, type LineKey,
} from './words.ts';
import { at, makeInput, testItems } from './__fixtures__/scenarios.ts';

/** Spec §16 #45 (+ #39, #55 and the design critique's rejected forms). «засчит» bans every form of the rejected verb. */
const BANNED: Array<[string, RegExp]> = [
  ['контейнер', /контейнер/i],
  ['тест (as the name of the content)', /(^|[^а-яё])тест/i],
  ['повторени', /повторени/i],
  ['на проверку', /на проверку/i],
  ['спорн', /спорн/i],
  ['пробн', /пробн/i],
  ['засчит', /засчит/i],
  ['сгорел / сгорит', /сгор(ел|ит|ело)/i],
  ['готов на', /готов на/i],
  ['выучен', /выучен/i],
  ['сдашь', /сдашь/i],
  ['отстаёте', /отста[её]те/i],
  ['преподавател', /преподавател/i],
  ['колледж', /колледж/i],
  ['аккредитац', /аккредитац/i],
  ['копи', /копи/i],
  ['Ключ изменён только у вас', /только у вас/i],
  ['около 55 вместо 45', /вместо/i],
  ['вернулись по сроку', /по сроку/i],
  ['правильный ответ', /правильный ответ/i],
  ['сессия / тренировка', /(^|[^а-яё])(сесси|тренировк)/i],
];

const ru = (s: string) => s.replace(/ /g, ' ');

/** Sample params for every key, as planDay emits them. */
const SAMPLES: Record<LineKey, Array<DayPlan['lines'][number]>> = {
  later: [{ key: 'later', n: [12], time: '17:00' }, { key: 'later', n: [1], time: '8:05' }, { key: 'later', n: [22], time: '19:30' }],
  first_count: [{ key: 'first_count', n: [1], day: '2026-10-11', time: '17:00' }, { key: 'first_count', n: [0], day: '2026-10-10', time: '19:00' },
    { key: 'first_count', n: [0], day: '2026-10-10' }, { key: 'first_count', n: [1], day: '2026-10-11' }, { key: 'first_count', n: [4], day: '2026-10-14', time: '9:15' }],
  skip: [{ key: 'skip', n: [1, 60] }, { key: 'skip', n: [2, 45] }, { key: 'skip', n: [5, 90] }, { key: 'skip', n: [1, 45], day: '2026-10-16' }],
  short: [{ key: 'short', n: [45, 700, 960, 75], day: '2026-10-28' }, { key: 'short', n: [30, 410, 960, 120], day: '2026-10-28' }],
  short_max: [{ key: 'short_max', n: [90, 820, 960], day: '2026-10-28' }],
  need: [{ key: 'need', n: [960, 70], day: '2026-10-28' }],
  window_ahead: [{ key: 'window_ahead', n: [4], day: '2026-10-24' }, { key: 'window_ahead', n: [1], day: '2026-09-30' }],
  window_detail: [{ key: 'window_detail', n: [4], day: '2026-10-24' }, { key: 'window_detail', n: [1], day: '2026-10-26' }],
  window_in: [{ key: 'window_in', n: [3] }, { key: 'window_in', n: [1] }],
  exam_today: [{ key: 'exam_today', n: [37] }],
  exam_errors: [{ key: 'exam_errors', n: [20] }, { key: 'exam_errors', n: [1] }, { key: 'exam_errors', n: [3] }],
  after: [{ key: 'after', day: '2026-10-28' }],
  no_date: [{ key: 'no_date', n: [15] }],
  first_day: [{ key: 'first_day' }],
  more_new: [{ key: 'more_new', n: [20] }, { key: 'more_new', n: [1] }],
  ai_limit: [{ key: 'ai_limit', time: '3:00' }],
  oral: [{ key: 'oral', n: [9, 3, 12] }, { key: 'oral', n: [10, 0, 0] }, { key: 'oral', n: [0, 3, 12] }, { key: 'oral', n: [4, 0, 14] }],
  oral_no_lectures: [{ key: 'oral_no_lectures', n: [60] }, { key: 'oral_no_lectures', n: [1] }, { key: 'oral_no_lectures', n: [21] }],
  done: [{ key: 'done', n: [128, 61] }, { key: 'done', n: [3, 0] }],
  nothing: [{ key: 'nothing', n: [4], day: '2026-10-14' }, { key: 'nothing', n: [1], day: '2026-10-11' }, { key: 'nothing' }],
  day_off: [{ key: 'day_off', n: [2], day: '2026-10-19' }, { key: 'day_off', n: [1], day: '2026-10-18' }, { key: 'day_off', n: [9], day: '2026-10-26' },
    { key: 'day_off' }],
  pace_faster: [{ key: 'pace_faster', n: [45] }],
  pace_slower: [{ key: 'pace_slower', n: [80] }],
};

describe('plural and glue', () => {
  it('chooses one / few / many', () => {
    const f = (n: number) => plural(n, 'вопрос', 'вопроса', 'вопросов');
    expect([0, 1, 2, 4, 5, 11, 12, 14, 19, 21, 22, 25, 101, 111, 112, 121, 1000].map(f)).toEqual([
      'вопросов', 'вопрос', 'вопроса', 'вопроса', 'вопросов', 'вопросов', 'вопросов', 'вопросов', 'вопросов', 'вопрос', 'вопроса',
      'вопросов', 'вопрос', 'вопросов', 'вопросов', 'вопрос', 'вопросов',
    ]);
    expect(plural(-1, 'a', 'b', 'c')).toBe('a');
  });

  it('glues the number to its word with a no-break space', () => {
    expect(glue(21, 'минута', 'минуты', 'минут')).toBe(`21${NBSP}минута`);
    expect(NBSP).toBe(' ');
  });
});

describe('days', () => {
  it('reads dates in Russian', () => {
    expect(ru(dayText('2026-10-11'))).toBe('11 октября');
    expect(ru(dayText('2027-01-01'))).toBe('1 января');
    expect(ru(weekdayText('2026-10-10'))).toBe('Сб, 10 октября');
    expect(ru(rangeText('2026-10-24', '2026-10-27'))).toBe('24–27 октября');
    expect(ru(rangeText('2026-10-30', '2026-11-02'))).toBe('30 октября – 2 ноября');
    expect(ru(rangeText('2026-10-30', '2026-10-30'))).toBe('30 октября');
  });

  it('names the next study day after today: «завтра», «в понедельник» within the week, else the date', () => {
    const FRI = '2026-10-09';
    // Every day: always «завтра», whatever the day (and a mask out of 1..127 is every day).
    for (const day of ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', FRI, '2026-10-10', '2026-10-11']) {
      expect(nextStudyDayWord(day, 127)).toBe('завтра');
    }
    expect(nextStudyDayWord(FRI, 0)).toBe('завтра');
    expect(nextStudyDayWord(FRI, 200)).toBe('завтра');
    // Saturday off, on Friday: Sunday. Saturday and Sunday off: Monday, from Friday, Saturday or Sunday.
    expect(nextStudyDayWord(FRI, 127 - 32)).toBe('в воскресенье');
    expect(nextStudyDayWord(FRI, 31)).toBe('в понедельник');
    expect(nextStudyDayWord('2026-10-10', 31)).toBe('в понедельник');
    expect(nextStudyDayWord('2026-10-11', 31)).toBe('завтра');
    expect(nextStudyDayWord('2026-10-12', 31)).toBe('завтра');
    // Tuesdays only, on Wednesday: six days ahead, by name; Fridays only, on Friday: a week ahead, by date.
    expect(nextStudyDayWord('2026-10-07', 2)).toBe('во вторник');
    expect(ru(nextStudyDayWord(FRI, 16))).toBe('16 октября');
    expect(ru(nextStudyDayWord('2026-10-30', 16))).toBe('6 ноября');
  });
});

describe('lineText', () => {
  it('renders every key the plan can emit, with every sample', () => {
    for (const key of LINE_KEYS) {
      expect(SAMPLES[key], key).toBeDefined();
      for (const line of SAMPLES[key]) {
        const text = lineText(line);
        expect(text.trim().length, `${key} ${JSON.stringify(line)}`).toBeGreaterThan(5);
        expect(text).not.toMatch(/undefined|NaN|null|\{|\}/);
      }
    }
    expect(lineText({ key: 'no_such_key' })).toBe('');
  });

  it('says exactly what the spec says', () => {
    const t = (line: DayPlan['lines'][number]) => ru(lineText(line));
    expect(t({ key: 'later', n: [12], time: '17:00' })).toBe('Ещё 12 вопросов — после 17:00'); // #32
    expect(t({ key: 'first_count', n: [1], day: '2026-10-11', time: '17:00' })).toBe('Первые войдут в счёт завтра после 17:00 — если снова ответите верно'); // #40
    expect(t({ key: 'first_count', n: [0], day: '2026-10-10', time: '19:00' })).toBe('Первые войдут в счёт сегодня после 19:00 — если снова ответите верно');
    expect(t({ key: 'first_count', n: [4], day: '2026-10-14' })).toBe('Первые войдут в счёт 14 октября — если снова ответите верно');
    expect(t({ key: 'skip', n: [1, 60] })).toBe('Вчера без занятий. Сегодня те же 60 минут — больше знакомых вопросов.'); // #39, #55
    expect(t({ key: 'skip', n: [2, 45] })).toBe('2 дня без занятий. Сегодня те же 45 минут — больше знакомых вопросов.');
    // a study day missed before days off: not «Вчера» (yesterday was a day off)
    expect(t({ key: 'skip', n: [1, 45], day: '2026-10-16' })).toBe('1 день без занятий. Сегодня те же 45 минут — больше знакомых вопросов.');
    // a day off (not one of the student's days of the week): the next study day, by name within the week
    expect(t({ key: 'day_off', n: [2], day: '2026-10-19' })).toBe('Сегодня выходной. Следующие вопросы — в понедельник.');
    expect(t({ key: 'day_off', n: [1], day: '2026-10-18' })).toBe('Сегодня выходной. Следующие вопросы — завтра.');
    expect(t({ key: 'day_off', n: [9], day: '2026-10-26' })).toBe('Сегодня выходной. Следующие вопросы — 26 октября.');
    expect(t({ key: 'day_off' })).toBe('Сегодня выходной.');
    expect(t({ key: 'oral_no_lectures', n: [60] })).toBe('Ещё 60 устных войдут в план, когда к предмету будут лекции.'); // #35
    expect(t({ key: 'short', n: [45, 700, 960, 75], day: '2026-10-28' }))
      .toBe('При 45 минутах к 28 октября вы увидите около 700 из 960. Чтобы увидеть все, нужно около 75 минут.');
    expect(t({ key: 'short_max', n: [90, 820, 960], day: '2026-10-28' })).toBe('Даже при 90 минутах в день к 28 октября вы увидите около 820 из 960.');
    // the plan card's note is one line from day 1 (m9); «Время в день» says it in full
    expect(t({ key: 'window_ahead', n: [4], day: '2026-10-24' })).toBe('С 24 октября новых вопросов не будет.');
    expect(t({ key: 'window_detail', n: [4], day: '2026-10-24' })).toBe('С 24 октября новых вопросов не будет: последние 4 дня — только знакомые, сначала ошибки.');
    expect(t({ key: 'window_in', n: [3] })).toBe('До экзамена 3 дня: новых нет, только знакомые.');
    expect(t({ key: 'exam_today', n: [37] })).toBe('Сегодня экзамен.');
    expect(t({ key: 'exam_errors', n: [20] })).toBe('20 вопросов, где были ошибки');
    expect(t({ key: 'after', day: '2026-10-28' })).toBe('Экзамен прошёл 28 октября.');
    expect(t({ key: 'no_date', n: [15] })).toBe('Без даты — по 15 новых в день на предмет.');
    expect(t({ key: 'more_new', n: [20] })).toBe('Ещё 20 новых');
    expect(t({ key: 'ai_limit', time: '3:00' })).toBe('Лимит ИИ на сегодня закончился. Проверка вернётся в 3:00.');
    expect(t({ key: 'oral', n: [9, 3, 12] })).toBe('Устные: 9 сверить с пунктами, 3 ответить вслух с проверкой — 12 единиц ИИ.');
    expect(t({ key: 'done', n: [128, 61] })).toBe('На сегодня всё: 128 вопросов за 61 минуту.');
    expect(t({ key: 'nothing', n: [4], day: '2026-10-14' })).toBe('На сегодня всё. Следующие вопросы — 14 октября.');
    expect(t({ key: 'nothing', n: [1], day: '2026-10-11' })).toBe('На сегодня всё. Следующие вопросы — завтра.');
    expect(t({ key: 'first_day' })).toBe('Время уточнится после первых 20 ответов.');
    expect(t({ key: 'need', n: [960, 70], day: '2026-10-28' })).toBe('Чтобы увидеть все 960 вопросов к 28 октября, нужно около 70 минут в день.');
    expect(t({ key: 'pace_faster', n: [45] })).toBe('Вы отвечаете быстрее, чем мы считали: хватит 45 минут в день.');
    expect(t({ key: 'pace_slower', n: [80] })).toBe('Вы отвечаете медленнее, чем мы считали: нужно около 80 минут в день.');
  });

  it('declines with the number', () => {
    expect(ru(lineText({ key: 'later', n: [1], time: '8:05' }))).toBe('Ещё 1 вопрос — после 8:05');
    expect(ru(lineText({ key: 'later', n: [22], time: '19:30' }))).toBe('Ещё 22 вопроса — после 19:30');
    expect(ru(lineText({ key: 'window_detail', n: [1], day: '2026-10-26' }))).toContain('последний день — только знакомые');
    expect(ru(lineText({ key: 'exam_errors', n: [1] }))).toBe('1 вопрос, где была ошибка');
    expect(ru(lineText({ key: 'oral_no_lectures', n: [21] }))).toBe('Ещё 21 устный войдёт в план, когда к предмету будут лекции.');
    expect(ru(lineText({ key: 'done', n: [3, 0] }))).toBe('На сегодня всё: 3 вопроса.');
    expect(ru(lineText({ key: 'short', n: [21, 410, 960, 121], day: '2026-10-28' }))).toBe('При 21 минуте к 28 октября вы увидите около 410 из 960. Чтобы увидеть все, нужно около 121 минуты.');
    expect(ru(lineText({ key: 'oral', n: [4, 0, 1] }))).toBe('Устные: 4 сверить с пунктами — 1 единица ИИ.');
  });
});

describe('banned words', () => {
  it('words.ts has none of them, comments included', () => {
    for (const [name, re] of BANNED) expect(re.test(wordsSource), name).toBe(false);
  });

  it('no rendered line has them', () => {
    const texts = [
      ...LINE_KEYS.flatMap((key) => SAMPLES[key].map(lineText)), RULE_LINE, SKIP_NOTE, TWO_DAYS,
      dayRowText({ from: '2026-10-10', to: '2026-10-23', kind: 'study', minutes: 45 }),
      dayRowText({ from: '2026-10-24', to: '2026-10-27', kind: 'window', minutes: null }),
      dayRowText({ from: '2026-10-28', to: '2026-10-28', kind: 'exam', minutes: null }),
    ];
    for (const text of texts) for (const [name, re] of BANNED) expect(re.test(text), `${name} in «${text}»`).toBe(false);
  });
});

describe('the plan line, title and detail', () => {
  const now = at('2026-10-10', '09:00');
  const subjects = [{ id: 'a', date: '2026-10-30' }];

  it('before the first answer: «Сегодня около 45 минут: 30 новых и 60 знакомых» and the card title', () => {
    const plan = planDay(makeInput({ now, subjects, items: testItems('a', 200), budgetMin: 30 }));
    expect(plan.state).toBe('study');
    const min = shownMinutes(plan.counts.leftSec);
    expect(min).toBeLessThanOrEqual(30);
    expect(ru(planLine(plan))).toBe(`Сегодня около ${min} минут: ${plan.counts.newItems} новых`);
    expect(ru(planTitle(plan))).toBe(`Сегодня ${plan.counts.newItems} вопросов, около ${min} минут`);
    const mixed: DayPlan = { ...plan, counts: { ...plan.counts, newItems: 41, reviews: 101, oral: 12 } };
    expect(ru(planDetail(mixed))).toBe('41 новый, 101 знакомый и 12 устных');
    expect(ru(planDetail({ ...plan, counts: { ...plan.counts, newItems: 30, reviews: 60, oral: 0 } }))).toBe('30 новых и 60 знакомых');
  });

  it('after the first answers: «Сегодня осталось 46 вопросов, около 15 минут.»', () => {
    const plan = planDay(makeInput({ now, subjects, items: testItems('a', 200), budgetMin: 30 }));
    const partly: DayPlan = { ...plan, counts: { ...plan.counts, newItems: 46, reviews: 0, oral: 0, estSec: 1800, leftSec: 900 } };
    expect(ru(planLine(partly))).toBe('Сегодня осталось 46 вопросов, около 15 минут.');
    expect(ru(planTitle(partly))).toBe('Сегодня осталось 46 вопросов, около 15 минут');
  });

  it('done, nothing, exam day, after the date', () => {
    const plan = planDay(makeInput({ now, subjects, items: [] }));
    const done: DayPlan = { ...plan, state: 'done', lines: [{ key: 'done', n: [128, 61] }] };
    expect(ru(planLine(done))).toBe('На сегодня всё: 128 вопросов за 61 минуту.');
    expect(ru(planTitle(done))).toBe('На сегодня всё: 128 вопросов за 61 минуту');
    const nothing: DayPlan = { ...plan, state: 'nothing', lines: [{ key: 'nothing', n: [4], day: '2026-10-14' }] };
    expect(ru(planLine(nothing))).toBe('На сегодня всё. Следующие вопросы — 14 октября.');
    expect(planLine({ ...plan, state: 'exam_today', lines: [] })).toBe('Сегодня экзамен.');
    expect(ru(planLine({ ...plan, state: 'after', lines: [{ key: 'after', day: '2026-10-28' }] }))).toBe('Экзамен прошёл 28 октября.');
    expect(planLine({ ...plan, state: 'empty' })).toBe('');
  });

  it('never shows more minutes than were estimated by more than rounding', () => {
    for (const sec of [1, 59, 61, 299, 599, 601, 2699, 2700, 2849, 3600, 5399]) {
      const min = shownMinutes(sec);
      expect(Math.abs(min - sec / 60)).toBeLessThanOrEqual(2.5);
    }
    expect(shownMinutes(0)).toBe(0);
  });
});

describe('figure lines', () => {
  it('N ≥ 1: the number, «из M», the caption and «Видели · ошибок сейчас»', () => {
    expect(figureLines({ inPlan: 960, twoDays: 143, seen: 410, errors: 37, selfKnow: 0 }, null)).toEqual({
      big: '143', of: 'из 960', label: TWO_DAYS, under: 'Видели 410 · ошибок сейчас 37',
    });
    expect(figureRow({ inPlan: 960, twoDays: 143, seen: 410, errors: 37, selfKnow: 0 })).toBe('Верно в два разных дня: 143 из 960');
  });

  it('N = 0 after answers: no big zero; the dated first-count line (decision 40)', () => {
    const f = { inPlan: 960, twoDays: 0, seen: 60, errors: 9, selfKnow: 0 };
    expect(figureLines(f, '2026-10-11', { today: '2026-10-10', time: '17:00' })).toEqual({
      big: '', of: '', label: 'Первые войдут в счёт завтра после 17:00 — если снова ответите верно', under: 'Видели 60 · ошибок сейчас 9',
    });
    expect(ru(figureLines(f, '2026-10-11').label)).toBe('Первые войдут в счёт 11 октября — если снова ответите верно');
    expect(figureLines(f, '2026-10-10', { today: '2026-10-10' }).label).toBe('Первые войдут в счёт сегодня — если снова ответите верно');
    expect(figureLines(f, null).label).toBe(RULE_LINE);
  });

  it('before any answer: the rule, and no «Видели» line', () => {
    expect(figureLines({ inPlan: 960, twoDays: 0, seen: 0, errors: 0, selfKnow: 0 }, null)).toEqual({ big: '', of: '', label: RULE_LINE, under: null });
  });
});

describe('start label', () => {
  it('phone, laptop, resume and the AI check', () => {
    expect(ru(startLabel(20, null, null))).toBe('Начать: 20 вопросов');
    expect(ru(startLabel(20, 9, null))).toBe('Начать: 20 вопросов, около 9 минут');
    expect(ru(startLabel(20, null, { done: 12, of: 20 }))).toBe('Продолжить: ещё 8 вопросов');
    expect(ru(startLabel(3, null, null, 'ai_check'))).toBe('Ответить вслух: 3 вопроса');
    expect(ru(startLabel(1, 1, null))).toBe('Начать: 1 вопрос, около 1 минуты');
  });
});

describe('«План по дням» rows', () => {
  it('groups equal days and promises no minutes in the final window', () => {
    expect(ru(dayRowText({ from: '2026-10-10', to: '2026-10-23', kind: 'study', minutes: 45 }))).toBe('10–23 октября — около 45 минут в день');
    expect(ru(dayRowText({ from: '2026-10-10', to: '2026-10-10', kind: 'study', minutes: 45 }))).toBe('10 октября — около 45 минут');
    expect(ru(dayRowText({ from: '2026-10-24', to: '2026-10-27', kind: 'window', minutes: null }))).toBe('24–27 октября — новых нет, только знакомые, сначала ошибки');
    expect(ru(dayRowText({ from: '2026-10-28', to: '2026-10-28', kind: 'exam', minutes: null }))).toBe('28 октября — экзамен');
    expect(ru(dayRowText({ from: '2026-10-10', to: '2026-10-12', kind: 'study', minutes: null }))).toBe('10–12 октября — только знакомые');
    expect(SKIP_NOTE).toBe('Если пропустите день, его вопросы перейдут на следующие.');
  });
});
