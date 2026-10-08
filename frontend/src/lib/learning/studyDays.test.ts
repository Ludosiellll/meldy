import { describe, expect, it } from 'vitest';
import { answersByDay, studyDayKeys, studyStreak, windowStart } from './studyDays';

const sessions = [
  { date: '2026-10-05', cards_reviewed: 12 },
  { date: '2026-10-05', cards_reviewed: 3 },
  { date: '2026-10-07', cards_reviewed: 0 },
  { date: '2026-09-01', cards_reviewed: 40 },
];
const events = [
  { kind: 'exam_answer', local_date: '2026-10-07' },
  { kind: 'exam_answer', local_date: '2026-10-07' },
  { kind: 'exam_answer', local_date: '2026-10-08' },
  { kind: 'quiz_answer', local_date: '2026-10-06' },
  { kind: 'quiz_answer', local_date: '2026-10-06' },
  // The same answers as the daily counters: never counted twice.
  { kind: 'card_review', local_date: '2026-10-05' },
  { kind: 'oral_point', local_date: '2026-10-07' },
  { kind: 'self_rating', local_date: '2026-10-04' },
];

describe('days of study', () => {
  it('counts card, ticket and test answers per day, one entry for every day of the window', () => {
    const days = answersByDay({ sessions, events, from: '2026-10-04', to: '2026-10-08' });
    expect(days).toEqual([
      { key: '2026-10-04', cards: 0, tickets: 0, tests: 0 },
      { key: '2026-10-05', cards: 15, tickets: 0, tests: 0 },
      { key: '2026-10-06', cards: 0, tickets: 0, tests: 2 },
      { key: '2026-10-07', cards: 0, tickets: 2, tests: 0 },
      { key: '2026-10-08', cards: 0, tickets: 1, tests: 0 },
    ]);
  });

  it('counts a day with a ticket answer or a test as a day of study, a self-rating or an empty counter not', () => {
    expect([...studyDayKeys({ sessions, events })].sort()).toEqual(['2026-09-01', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08']);
  });

  it('counts the days in a row across cards, tickets and tests', () => {
    expect(studyStreak({ sessions, events }, new Date(2026, 9, 8, 12))).toBe(4);
    // Before the first answer of the day the streak still ends yesterday.
    expect(studyStreak({ sessions, events }, new Date(2026, 9, 9, 8))).toBe(4);
    expect(studyStreak({ sessions, events }, new Date(2026, 9, 10, 8))).toBe(0);
    expect(studyStreak({ sessions: [], events: [] }, new Date(2026, 9, 8, 12))).toBe(0);
  });

  it('starts a window of 30 days 29 days before today', () => {
    expect(windowStart(30, new Date(2026, 9, 8, 12))).toBe('2026-09-09');
    expect(windowStart(1, new Date(2026, 9, 8, 12))).toBe('2026-10-08');
  });
});
