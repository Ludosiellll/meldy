import { describe, expect, it } from 'vitest';
import type { LearningEvent } from '../api/learning';
import {
  cardStates,
  dueCount,
  forecast,
  lectureRows,
  recallShare,
  recallTally,
  recallWindow,
  todoItems,
  weekLede,
  type LectureRow,
} from './progressModel';
import { localDateKey } from './streak';

// Local times at midday, so the local day never depends on the time zone of the machine.
const NOW = new Date(2026, 9, 3, 12, 0, 0);
const at = (day: number, hour = 12) => new Date(2026, 9, day, hour, 0, 0).toISOString();
const dayKey = (day: number) => localDateKey(new Date(2026, 9, day, 12, 0, 0));

function review(day: number, correct: boolean, material = 'm1', id = `${day}-${Math.random()}`): LearningEvent {
  return {
    id, created_at: at(day), local_date: dayKey(day), material_id: material, kind: 'card_review', item_key: `card:${id}`,
    correct, score: correct ? 0.8 : 0.2, confidence: null, source_ids: [], session_id: 's', payload: {},
  };
}

function quizAnswer(day: number, material: string, index: number, correct: boolean): LearningEvent {
  return {
    id: `q-${material}-${index}`, created_at: at(day), local_date: dayKey(day), material_id: material, kind: 'quiz_answer',
    item_key: `quiz:${material}:${index}`, correct, score: correct ? 1 : 0, confidence: null, source_ids: [], session_id: `qs-${material}`,
    payload: { v: 1, index, retake: false },
  };
}

describe('card states', () => {
  it('splits cards into new, learning and consolidated by what review did to them', () => {
    const cards = [
      { repetitions: 0, next_review: at(3, 9), last_reviewed_at: null }, // never reviewed
      { repetitions: 0, next_review: at(4, 9), last_reviewed_at: null, origin: 'oral_followup' }, // follow-up, waiting
      { repetitions: 0, next_review: at(4, 9), last_reviewed_at: null }, // an old «Не помню» moved it forward
      { repetitions: 1, next_review: at(4, 9), last_reviewed_at: at(3, 8) },
      { repetitions: 0, next_review: at(4, 9), last_reviewed_at: at(3, 8) }, // forgotten after a success
      { repetitions: 2, next_review: at(9, 9), last_reviewed_at: at(3, 8) },
      { repetitions: 5, next_review: at(30, 9), last_reviewed_at: at(2, 8) },
    ];
    expect(cardStates(cards, NOW)).toEqual({ total: 7, fresh: 2, learning: 3, solid: 2 });
  });

  it('counts due cards like the top bar (next review not later than now) and spreads the next 7 days', () => {
    const cards = [
      { next_review: at(1, 9) }, // overdue: today
      { next_review: at(3, 11) }, // due now
      { next_review: at(3, 20) }, // later today
      { next_review: at(4, 9) },
      { next_review: at(9, 23) }, // the 7th day
      { next_review: at(10, 9) }, // beyond the week
      { next_review: null },
      { next_review: 'not a date' },
    ];
    expect(dueCount(cards, NOW)).toBe(2);
    expect(forecast(cards, NOW).map((day) => day.count)).toEqual([3, 1, 0, 0, 0, 0, 1]);
    expect(forecast(cards, NOW)[0].key).toBe(dayKey(3));
  });
});

describe('recall from the journal', () => {
  const events = [
    review(3, true), review(3, false), review(1, true, 'm2'), review(20, true), // 20 Oct is in the future window, left out
    { ...review(2, true), kind: 'quiz_answer' as const },
    { ...review(2, true), correct: null },
    review(26 - 30, true), // 26 September: older than the window
  ];

  it('counts card answers of a period, of one lecture when asked', () => {
    expect(recallTally(events, dayKey(1), dayKey(3))).toEqual({ answers: 3, recalled: 2 });
    expect(recallTally(events, dayKey(1), dayKey(3), 'm1')).toEqual({ answers: 2, recalled: 1 });
  });

  it('gives a share only from the minimum number of answers', () => {
    expect(recallShare({ answers: 9, recalled: 9 }, 10)).toBeNull();
    expect(recallShare({ answers: 10, recalled: 7 }, 10)).toBeCloseTo(0.7);
    expect(recallShare({ answers: 0, recalled: 0 }, 0)).toBeNull();
  });

  it('takes the last 30 days, never earlier than the first day of the journal', () => {
    expect(recallWindow('2026-10-04')).toEqual({ from: '2026-10-03', to: '2026-10-04', sinceJournal: true });
    expect(recallWindow('2026-11-01')).toEqual({ from: '2026-10-03', to: '2026-11-01', sinceJournal: false });
    expect(recallWindow('2026-11-10')).toEqual({ from: '2026-10-12', to: '2026-11-10', sinceJournal: false });
  });
});

describe('lecture rows', () => {
  const materials = [
    { id: 'done', title: 'Всё повторено', created_at: at(1), flashcards_json: { flashcards: [{ question: 'q', answer: 'a' }] }, quiz: [{}] },
    { id: 'due', title: 'Есть к повторению', created_at: at(1), flashcards_json: { flashcards: [{ question: 'q', answer: 'a' }] }, quiz: [{}] },
    { id: 'due2', title: 'Больше к повторению', created_at: at(1), flashcards_json: { flashcards: [{ question: 'q', answer: 'a' }] } },
    { id: 'add', title: 'Карточки не в повторении', created_at: at(2), flashcards_json: [{ question: 'q1', answer: 'a1' }, { question: 'q2', answer: 'a2' }, { question: '', answer: 'x' }] },
    { id: 'quiz', title: 'Тест не пройден', created_at: at(2), flashcards_json: { flashcards: [] }, quiz: [{}, {}] },
    { id: 'text', title: 'Только текст', created_at: at(3), text_only: true, flashcards_json: { flashcards: [] }, quiz: [{}] },
  ];
  const cards = [
    { material_id: 'done', repetitions: 2, next_review: at(9), last_reviewed_at: at(2) },
    { material_id: 'due', repetitions: 0, next_review: at(3, 8), last_reviewed_at: null },
    { material_id: 'due2', repetitions: 0, next_review: at(3, 8), last_reviewed_at: null },
    { material_id: 'due2', repetitions: 1, next_review: at(2, 8), last_reviewed_at: at(1) },
  ];
  const quizEvents = [quizAnswer(2, 'done', 0, true), quizAnswer(2, 'done', 1, false)];

  const rows = lectureRows({ materials, cards, quizEvents, reviewEvents: [review(2, false, 'due2')], mistakes: [{ material_id: 'due' }, { material_id: null }], now: NOW, windowFrom: dayKey(1), windowTo: dayKey(3) });
  const byId = (id: string) => rows.find((row) => row.id === id)!;

  it('gives each lecture one next step: due cards, cards not in review, then the test', () => {
    expect(byId('due').action).toEqual({ kind: 'review', count: 1 });
    expect(byId('due2').action).toEqual({ kind: 'review', count: 2 });
    expect(byId('add').action).toEqual({ kind: 'add', count: 2 });
    expect(byId('quiz').action).toEqual({ kind: 'quiz' });
    expect(byId('done').action).toBeNull(); // the test was taken, nothing due
    expect(byId('text').action).toBeNull(); // text-only lectures have no cards or test by design
  });

  it('puts the lectures with something to do first, the most due cards first, text-only last', () => {
    expect(rows.map((row) => row.id)).toEqual(['due2', 'due', 'add', 'quiz', 'done', 'text']);
  });

  it('keeps the counters of each lecture', () => {
    expect(byId('due2').states).toEqual({ total: 2, fresh: 1, learning: 1, solid: 0 });
    expect(byId('due2').recall).toEqual({ answers: 1, recalled: 0 });
    expect(byId('due').mistakes).toBe(1);
    expect(byId('done').lastActivity).toBe(dayKey(2));
    expect(byId('done').metrics.quiz).toMatchObject({ correct: 1, total: 2 });
    expect(byId('text').textOnly).toBe(true);
    expect(byId('add').notInReview).toBe(2);
    expect(byId('done').nextReview).toBe(at(9)); // nothing due: when the next card comes back
    expect(byId('due').nextReview).toBeNull();
    expect(rows.filter((row) => row.quizUntaken).map((row) => row.id)).toEqual(['due', 'quiz']); // «text» has a test by design only
  });
});

describe('what to work on', () => {
  const row = (id: string, patch: Partial<LectureRow>): LectureRow =>
    ({
      id, title: id, createdAt: at(1), textOnly: false, states: { total: 0, fresh: 0, learning: 0, solid: 0 }, due: 0, notInReview: 0, hasQuiz: false,
      metrics: { cards: { total: 0, reviewed: 0, recalled: 0, consolidated: 0, nextCheck: null }, quiz: null, quizRepeat: null, accuracy: null, status: 'untested' },
      recall: { answers: 0, recalled: 0 }, mistakes: 0, lastActivity: null, nextReview: null, quizUntaken: false, action: null, ...patch,
    }) as LectureRow;

  it('names forgotten lectures first, then mistakes, cards outside review, exam gaps and tests', () => {
    const rows = [
      row('quiz', { quizUntaken: true, createdAt: at(1), action: { kind: 'quiz' } }),
      row('busy', { quizUntaken: true, createdAt: at(2), due: 3, action: { kind: 'review', count: 3 } }), // its test counts too
      row('add', { notInReview: 6, action: { kind: 'add', count: 6 } }),
      row('weak', { recall: { answers: 8, recalled: 3 } }),
      row('weaker', { recall: { answers: 5, recalled: 1 } }),
      row('few', { recall: { answers: 4, recalled: 0 } }), // too few answers to call it weak
      row('fine', { recall: { answers: 10, recalled: 9 } }),
    ];
    const { items, more } = todoItems({
      rows,
      mistakes: [{ topic: 'Инфляция' }, { topic: 'Ставка' }, { topic: 'Инфляция' }, { topic: null }],
      exams: [{ id: 'e1', title: 'Экзамен: экономика', none: 9 }, { id: 'e2', title: 'Зачёт', none: 0 }],
    });
    expect(items.map((item) => item.kind)).toEqual(['weak', 'weak', 'mistakes', 'add', 'exam', 'quiz']);
    expect(items[0]).toMatchObject({ kind: 'weak', share: 0.2 });
    expect(items[2]).toEqual({ kind: 'mistakes', count: 4, topics: ['Инфляция', 'Ставка'] });
    // Untaken tests are one line, the newest lecture first.
    expect(items[5]).toMatchObject({ kind: 'quiz' });
    expect(items[5].kind === 'quiz' && items[5].lectures.map((lecture) => lecture.id)).toEqual(['busy', 'quiz']);
    expect(more).toBe(0);
  });

  it('shows at most six and says how many more', () => {
    const rows = Array.from({ length: 9 }, (_, i) => row(`a${i}`, { notInReview: 2, action: { kind: 'add', count: 2 } }));
    const { items, more } = todoItems({ rows, mistakes: [], exams: null });
    expect(items).toHaveLength(6);
    expect(more).toBe(3);
  });
});

describe('the line under the title', () => {
  it('says what happened in the last 7 days, or when it last happened', () => {
    expect(weekLede({ cardAnswers: 24, tests: 1, tickets: 0, lastDay: '3 октября' })).toBe('За 7 дней: 24 ответа на карточки и 1 тест.');
    expect(weekLede({ cardAnswers: 1, tests: 0, tickets: 5, lastDay: null })).toBe('За 7 дней: 1 ответ на карточки и 5 ответов на билеты.');
    expect(weekLede({ cardAnswers: 0, tests: 0, tickets: 0, lastDay: '30 сентября' })).toBe('За 7 дней занятий не было. Последние — 30 сентября.');
    expect(weekLede({ cardAnswers: 0, tests: 0, tickets: 0, lastDay: null })).toBe('Здесь будет видно, как вы запоминаете лекции. Начните с повторения карточек.');
  });
});
