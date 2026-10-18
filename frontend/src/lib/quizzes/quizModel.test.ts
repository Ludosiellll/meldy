import { describe, expect, it } from 'vitest';
import type { TestItem } from '../../types/container';
import type { QuizAttemptRow, QuizItemStat, QuizRow } from '../../types/quiz';
import {
  clockOffset,
  clockText,
  csvOf,
  dateWords,
  defaultMinutes,
  defaultSettings,
  minutesTaken,
  peopleRows,
  questionRows,
  quizOrder,
  secondsLeft,
  settingsProblems,
  summaryOf,
  timeStage,
} from './quizModel';

const NOW = new Date('2026-10-16T12:00:00Z');

function attempt(over: Partial<QuizAttemptRow>): QuizAttemptRow {
  return {
    id: 'a',
    person: 'p1',
    name: 'Иванов Иван',
    own: false,
    guest: false,
    n: 1,
    started_at: '2026-10-16T12:00:00Z',
    deadline_at: '2026-10-16T12:30:00Z',
    finished_at: '2026-10-16T12:18:00Z',
    finish_reason: 'sent',
    total: 20,
    answered: 20,
    correct: 15,
    ...over,
  };
}

describe('defaults', () => {
  it('give about a minute a question, from the list', () => {
    expect(defaultMinutes(20)).toBe(20);
    expect(defaultMinutes(25)).toBe(30);
    expect(defaultMinutes(160)).toBe(180);
    expect(defaultMinutes(500)).toBe(240);
  });

  it('take every subject, 20 questions, one attempt and a week', () => {
    const s = defaultSettings(['s1', 's2'], 640, NOW);
    expect(s.subject_ids).toEqual(['s1', 's2']);
    expect(s.item_count).toBe(20);
    expect(s.time_limit_min).toBe(20);
    expect(s.attempts).toBe(1);
    expect(s.review).toBe('mistakes_then_answers');
    expect(s.title).toMatch(/^Контрольная · \d{2}\.\d{2}$/);
    const closes = new Date(s.closes_at!);
    expect(closes.getTime() - NOW.getTime()).toBeGreaterThan(6 * 86400000);
    expect(closes.getTime() - NOW.getTime()).toBeLessThan(8 * 86400000);
    expect(defaultSettings(['s1'], 12, NOW).item_count).toBe(12);
  });
});

describe('settingsProblems', () => {
  it('names what the server would refuse', () => {
    const s = defaultSettings(['s1'], 100, NOW);
    expect(settingsProblems(s, 100)).toEqual([]);
    expect(settingsProblems({ ...s, title: ' ' }, 100)).toEqual(['title']);
    expect(settingsProblems({ ...s, subject_ids: [] }, 100)).toEqual(['subjects']);
    expect(settingsProblems({ ...s, item_count: 0 }, 100)).toEqual(['count']);
    expect(settingsProblems(s, 0)).toEqual(['count']);
    expect(settingsProblems({ ...s, opens_at: '2026-10-20T10:00:00Z', closes_at: '2026-10-19T10:00:00Z' }, 100)).toEqual(['window']);
  });
});

describe('the clock', () => {
  it('counts from the server deadline with the clock difference', () => {
    const offset = clockOffset('2026-10-16T12:00:10Z', Date.parse('2026-10-16T12:00:00Z'));
    expect(offset).toBe(10000);
    expect(secondsLeft('2026-10-16T12:30:00Z', offset, Date.parse('2026-10-16T12:00:00Z'))).toBe(1790);
    expect(secondsLeft('2026-10-16T12:30:00Z', 0, Date.parse('2026-10-16T13:00:00Z'))).toBe(0);
    expect(secondsLeft(null, 0, 0)).toBeNull();
    expect(clockText(521)).toBe('08:41');
    expect(clockText(3723)).toBe('1:02:03');
  });
});

describe('peopleRows', () => {
  it('keeps one row a person: the best attempt, or the one being written', () => {
    const rows = peopleRows(
      [
        attempt({ id: 'a1', n: 1, correct: 12 }),
        attempt({ id: 'a2', n: 2, correct: 17 }),
        attempt({ id: 'a3', n: 3, correct: 10 }),
        attempt({ id: 'b1', person: 'p2', name: 'Борисова Анна', finished_at: null, finish_reason: null, answered: 7, correct: 5 }),
      ],
      'best',
    );
    expect(rows.map((row) => row.name)).toEqual(['Борисова Анна', 'Иванов Иван']);
    expect(rows[0].status).toBe('writing');
    expect(rows[0].percent).toBeNull();
    expect(rows[1].counted.id).toBe('a2');
    expect(rows[1].attempts).toBe(3);
    expect(rows[1].percent).toBe(85);
    expect(rows[1].minutes).toBe(18);
    expect(peopleRows([attempt({ id: 'a1', n: 1, correct: 18 }), attempt({ id: 'a2', n: 2, correct: 9 })], 'last')[0].counted.id).toBe('a2');
  });

  it('says how the attempt ended', () => {
    expect(peopleRows([attempt({ finish_reason: 'time' })], 'best')[0].status).toBe('time');
    expect(peopleRows([attempt({ finish_reason: 'closed' })], 'best')[0].status).toBe('closed');
  });
});

describe('summaryOf', () => {
  it('counts people without the author', () => {
    const rows = peopleRows(
      [
        attempt({ id: 'a', correct: 15 }),
        attempt({ id: 'b', person: 'p2', name: 'Б', correct: 10 }),
        attempt({ id: 'c', person: 'p3', name: 'В', finished_at: null, finish_reason: null }),
        attempt({ id: 'd', person: 'me', name: 'Автор', own: true, correct: 20 }),
      ],
      'best',
    );
    expect(summaryOf(rows, 60)).toEqual({ writing: 1, done: 2, avgPercent: 63, passed: 1 });
    expect(summaryOf(rows, null).passed).toBeNull();
  });
});

describe('questionRows', () => {
  it('puts the hardest first', () => {
    const stats: QuizItemStat[] = [
      { item_id: 'x', shown: 10, answered: 10, correct: 9, picks: [9, 1], wrong_texts: [] },
      { item_id: 'y', shown: 10, answered: 8, correct: 2, picks: [2, 6], wrong_texts: [] },
      { item_id: 'z', shown: 0, answered: 0, correct: 0, picks: [], wrong_texts: [] },
    ];
    const rows = questionRows(stats, new Map());
    expect(rows.map((row) => row.itemId)).toEqual(['y', 'x', 'z']);
    expect(rows[0].percent).toBe(20);
    expect(rows[2].percent).toBeNull();
  });
});

describe('csvOf', () => {
  it('opens in Excel: BOM, «;», a column per question', () => {
    const quiz = { pass_percent: 60 } as QuizRow;
    const items = [
      { id: 'i1', subject_id: 's1', position: 2, file_no: '7' },
      { id: 'i2', subject_id: 's1', position: 1, file_no: '3' },
    ] as TestItem[];
    const csv = csvOf(
      quiz,
      [attempt({ id: 'a1', name: 'Иванов; Иван', correct: 1, total: 2 })],
      [
        { attempt_id: 'a1', item_id: 'i1', correct: true },
        { attempt_id: 'a1', item_id: 'i2', correct: false },
      ],
      items,
      [{ id: 's1', title: 'Вариант 1' }],
    );
    expect(csv.startsWith('﻿')).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe('Имя;Попытка;Начало;Конец;Минуты;Верно;Всего;%;Порог;Вариант 1 № 3;Вариант 1 № 7');
    expect(lines[1].startsWith('"Иванов; Иван";1;')).toBe(true);
    expect(lines[1].endsWith(';1;2;50;нет;0;1')).toBe(true);
  });

  it('a value a spreadsheet would run as a formula gets an apostrophe first (= + - @, a tab, a carriage return)', () => {
    const quiz = { pass_percent: null } as QuizRow;
    const items = [{ id: 'i1', subject_id: 's1', position: 1, file_no: '3' }] as TestItem[];
    const names = ['=HYPERLINK("http://x.example";"нажми")', '+7 900', '-2+3', '@SUM(A1)', '\tТаб', '\rВозврат', 'Обычное имя', 'Анна=Ян'];
    const csv = csvOf(
      quiz,
      names.map((name, index) => attempt({ id: `a${index}`, name, correct: 1, total: 1 })),
      names.map((_, index) => ({ attempt_id: `a${index}`, item_id: 'i1', correct: true })),
      items,
      [{ id: 's1', title: '=Вариант' }],
    );
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0].endsWith(";'=Вариант № 3")).toBe(true);
    const row = (start: string) => lines.slice(1).find((line) => line.startsWith(start));
    expect(row(`"'=HYPERLINK(""http://x.example"";""нажми"")";1;`)).toBeDefined();
    expect(row("'+7 900;1;")).toBeDefined();
    expect(row("'-2+3;1;")).toBeDefined();
    expect(row("'@SUM(A1);1;")).toBeDefined();
    expect(row("'\tТаб;1;")).toBeDefined();
    // A carriage return inside a cell: quoted as well (the file's own line breaks are CRLF).
    expect(csv).toContain(`"'\rВозврат";1;`);
    // Ordinary text and a sign further in stay as they are; so do the numbers.
    expect(row('Обычное имя;1;')).toBeDefined();
    expect(row('Анна=Ян;1;')).toBeDefined();
    expect(lines).toHaveLength(names.length + 1);
    expect(lines.slice(1).every((line) => line.endsWith(';1;1;100;;1'))).toBe(true);
  });
});

describe('quizOrder', () => {
  const item = { id: 'i1', kind: 'single' as const, options: ['a', 'b', 'c', 'd', 'e'], keep_order: false };
  it('is the same for the same attempt and question, a permutation, and differs between attempts', () => {
    const one = quizOrder(item, 'att-1', true);
    expect(quizOrder(item, 'att-1', true)).toEqual(one);
    expect([...one].sort()).toEqual([0, 1, 2, 3, 4]);
    const others = ['att-2', 'att-3', 'att-4', 'att-5'].map((id) => quizOrder(item, id, true).join());
    expect(others.some((order) => order !== one.join())).toBe(true);
  });
  it('keeps the file’s order without shuffling, for a question that keeps it, and gives none to a short answer', () => {
    expect(quizOrder(item, 'att-1', false)).toEqual([0, 1, 2, 3, 4]);
    expect(quizOrder({ ...item, keep_order: true }, 'att-1', true)).toEqual([0, 1, 2, 3, 4]);
    expect(quizOrder({ ...item, kind: 'short', options: [] }, 'att-1', true)).toEqual([]);
  });
});

describe('dateWords and timeStage (release 47 design fixes)', () => {
  const NB = String.fromCharCode(0xa0);
  const at = (y: number, m: number, d: number, h: number, min: number) => new Date(y, m, d, h, min).toISOString();
  it('«25 октября, 23:59» in the device’s time, kept whole; the year only when it is another one', () => {
    const now = new Date(2026, 9, 18, 12, 0);
    expect(dateWords(at(2026, 9, 25, 23, 59), now)).toBe(`25${NB}октября,${NB}23:59`);
    expect(dateWords(at(2026, 4, 1, 9, 5), now)).toBe(`1${NB}мая,${NB}09:05`);
    expect(dateWords(at(2027, 0, 3, 9, 0), now)).toBe(`3${NB}января${NB}2027,${NB}09:00`);
    expect(dateWords(null, now)).toBe('');
    expect(dateWords('не дата', now)).toBe('');
  });
  it('red from five minutes left, the second step at one minute; nothing without a timer', () => {
    expect(timeStage(null)).toBe(0);
    expect(timeStage(301)).toBe(0);
    expect(timeStage(300)).toBe(1);
    expect(timeStage(61)).toBe(1);
    expect(timeStage(60)).toBe(2);
    expect(timeStage(0)).toBe(2);
  });
  it('a mark only for an attempt longer than it: five minutes or less — the last minute only; a minute or less — none (release 47.1)', () => {
    // A 20-minute attempt: both marks.
    expect(timeStage(300, 1200)).toBe(1);
    expect(timeStage(60, 1200)).toBe(2);
    // Just over five minutes: both.
    expect(timeStage(300, 301)).toBe(1);
    // Five minutes in all: not red at the start, red from the last minute.
    expect(timeStage(300, 300)).toBe(0);
    expect(timeStage(61, 300)).toBe(0);
    expect(timeStage(60, 300)).toBe(2);
    expect(timeStage(0, 300)).toBe(2);
    // Two minutes in all.
    expect(timeStage(120, 120)).toBe(0);
    expect(timeStage(60, 120)).toBe(2);
    // A minute or less in all: never red.
    expect(timeStage(60, 60)).toBe(0);
    expect(timeStage(10, 45)).toBe(0);
    // The whole time unknown: as before.
    expect(timeStage(300, null)).toBe(1);
    expect(timeStage(300, Number.NaN)).toBe(1);
    expect(timeStage(null, 300)).toBe(0);
  });
});

describe('minutesTaken (release 47.1)', () => {
  const at = (seconds: number) => new Date(Date.UTC(2026, 9, 16, 10, 0, seconds)).toISOString();
  it('0 under a minute («меньше минуты»), else rounded; null while unfinished', () => {
    expect(minutesTaken({ started_at: at(0), finished_at: at(20) })).toBe(0);
    expect(minutesTaken({ started_at: at(0), finished_at: at(59) })).toBe(0);
    expect(minutesTaken({ started_at: at(0), finished_at: at(60) })).toBe(1);
    expect(minutesTaken({ started_at: at(0), finished_at: at(89) })).toBe(1);
    expect(minutesTaken({ started_at: at(0), finished_at: at(18 * 60 + 10) })).toBe(18);
    expect(minutesTaken({ started_at: at(0), finished_at: null })).toBeNull();
    expect(minutesTaken({ started_at: 'не дата', finished_at: at(30) })).toBeNull();
  });
});
