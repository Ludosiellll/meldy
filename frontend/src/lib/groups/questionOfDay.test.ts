import { describe, expect, it } from 'vitest';
import type { SheetQuestion } from '../exams/cheatSheet';
import { dailyOrder, dayNumber, hasAnswerPoints, questionLine, questionOfDay, questionOfDayMessage } from './questionOfDay';

const EXAM = 'e1d2c3b4-a596-4877-8899-aabbccddeeff';
const CODE = 'k7m2pq9rst4v';

function question(position: number, overrides: Partial<SheetQuestion> = {}): SheetQuestion {
  return {
    question_id: `q${position}`,
    position,
    label: String(position),
    section: null,
    text: `Вопрос номер ${position}`,
    question_hash: position.toString(16).padStart(32, '0'),
    coverage: 'full',
    coverage_method: 'llm',
    coverage_reason: '',
    missing_note: '',
    rubric: {
      rubric_id: `r${position}`,
      built_at: null,
      coverage: 'full',
      coverage_note: '',
      materials: [],
      points: [{ id: 'p1', title: 'Пункт', short: '', essential: true, source_quote: '', source_ids: [] }],
    },
    ...overrides,
  };
}

const WRITTEN = Array.from({ length: 6 }, (_, index) => question(index + 1));
/** Every kind of question that has no answer points to ask about. */
const WITHOUT_POINTS: SheetQuestion[] = [
  question(20, { coverage: 'none', rubric: null }), // «нет в лекциях» by the mapping
  question(21, { rubric: { ...question(21).rubric!, coverage: 'none', points: [] } }), // the points found nothing
  question(22, { rubric: { ...question(22).rubric!, points: [] } }),
  question(23, { rubric: null }), // not written yet
  question(24, { coverage: null, rubric: null }), // not mapped yet
  question(25, { coverage: 'unverified', rubric: null }),
  question(26, { rubric: null, unwritable: true }), // failed the quote check twice
  question(27, { coverage: 'none' }), // a rubric left from earlier lectures, now «нет в лекциях»
];

describe('the question of the day', () => {
  it('asks only about questions with written answer points, never a «нет в лекциях» one', () => {
    expect(WRITTEN.every(hasAnswerPoints)).toBe(true);
    expect(WITHOUT_POINTS.filter(hasAnswerPoints)).toEqual([]);
    expect(dailyOrder([...WRITTEN, ...WITHOUT_POINTS], EXAM).map((item) => item.position).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(questionOfDay(WITHOUT_POINTS, EXAM, '2026-10-08')).toBeNull();
    expect(questionOfDay([], EXAM, '2026-10-08')).toBeNull();
  });

  it('gives the same question all day, whatever the order of the list', () => {
    const today = questionOfDay(WRITTEN, EXAM, '2026-10-08');
    expect(today).not.toBeNull();
    expect(questionOfDay([...WRITTEN].reverse(), EXAM, '2026-10-08')).toBe(today);
    expect(questionOfDay([...WITHOUT_POINTS, ...WRITTEN], EXAM, '2026-10-08')).toBe(today);
  });

  it('goes through every question before one comes again, and not in the list order', () => {
    const days = Array.from({ length: 12 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 9, 8 + index));
      return date.toISOString().slice(0, 10);
    });
    const picked = days.map((day) => questionOfDay(WRITTEN, EXAM, day)!.position);
    expect(new Set(picked.slice(0, 6)).size).toBe(6);
    expect(picked.slice(6)).toEqual(picked.slice(0, 6));
    for (let index = 1; index < picked.length; index += 1) expect(picked[index]).not.toBe(picked[index - 1]);
    // The order is the exam's own: another exam walks the same list in another order.
    const other = days.slice(0, 6).map((day) => questionOfDay(WRITTEN, 'another-exam', day)!.position);
    expect(other).not.toEqual(picked.slice(0, 6));
    expect(picked.slice(0, 6)).not.toEqual([...picked.slice(0, 6)].sort((a, b) => a - b));
  });

  it('counts days by the calendar date, across months and years', () => {
    expect(dayNumber('1970-01-02')).toBe(1);
    expect(dayNumber('2026-11-01')! - dayNumber('2026-10-31')!).toBe(1);
    expect(dayNumber('2027-01-01')! - dayNumber('2026-12-31')!).toBe(1);
    expect(dayNumber('8 октября')).toBeNull();
    expect(questionOfDay(WRITTEN, EXAM, 'не дата')).toBeNull();
  });

  it('writes the message: the exam, the question with its number, the link last', () => {
    const today = question(12, { label: '12а', text: '  Эластичность спроса\nпо цене: виды и факторы.  ' });
    const url = `https://ludosiel-studyforge.hf.space/join/${CODE}`;
    expect(questionOfDayMessage({ title: 'Экзамен: цифровая экономика', question: today, url })).toBe(
      ['Вопрос дня — «Цифровая экономика»', '12а. Эластичность спроса по цене: виды и факторы.', `Ответить в Meldy: ${url}`].join('\n'),
    );
    expect(questionOfDayMessage({ title: 'Макроэкономика', question: today, url: null })).toBe(
      ['Вопрос дня — «Макроэкономика»', '12а. Эластичность спроса по цене: виды и факторы.', 'Ответить можно в Meldy — в своей копии экзамена.'].join('\n'),
    );
    // Without the department's number: the place in the list; a very long wording is cut.
    expect(questionLine(question(7, { label: '', text: 'а'.repeat(800) }))).toMatch(/^7\. а{499}…$/);
  });
});
