import { describe, expect, it } from 'vitest';
import type { LearningEvent } from '../api/learning';
import { MIN_MEASURED, type ProgressCard, materialMetrics } from './progressMetrics';

const NOW = new Date('2026-10-02T15:00:00Z');
const TOMORROW = '2026-10-03T14:05:00+00:00';
const MATERIAL = '11111111-1111-1111-1111-111111111111';

let sequence = 0;

function quizAnswer(session: string, at: string, correct: boolean | null, retake: boolean, localDate = at.slice(0, 10)): LearningEvent {
  sequence += 1;
  return {
    id: `event-${sequence}`,
    created_at: at,
    local_date: localDate,
    material_id: MATERIAL,
    kind: 'quiz_answer',
    item_key: `quiz:${MATERIAL}:${String(sequence).padStart(32, '0')}`,
    correct,
    score: correct === null ? null : correct ? 1 : 0,
    confidence: null,
    source_ids: [],
    session_id: session,
    payload: { v: 1, retake, client_retake: retake, seen_before: retake, surface: 'analysis' },
  };
}

function attempt(session: string, at: string, results: boolean[], retake: boolean, localDate?: string) {
  return results.map((correct, i) => {
    const time = new Date(Date.parse(at) + i * 1000).toISOString();
    return quizAnswer(session, time, correct, retake, localDate ?? at.slice(0, 10));
  });
}

/** The demo run: six cards after one review session (5 «Знаю», 1 «Не помню»), test 4/5, retake 5/5. */
function demoCards(): ProgressCard[] {
  return [
    { repetitions: 1, next_review: '2026-10-03T14:01:00+00:00', last_reviewed_at: '2026-10-02T14:01:00+00:00' },
    { repetitions: 1, next_review: '2026-10-03T14:02:00+00:00', last_reviewed_at: '2026-10-02T14:02:00+00:00' },
    { repetitions: 1, next_review: '2026-10-03T14:00:30+00:00', last_reviewed_at: '2026-10-02T14:00:30+00:00' },
    { repetitions: 1, next_review: '2026-10-03T14:03:00+00:00', last_reviewed_at: '2026-10-02T14:03:00+00:00' },
    // A legacy row reviewed by an old client: no review date, but a successful answer.
    { repetitions: 1, next_review: '2026-10-03T14:04:00+00:00', last_reviewed_at: null },
    // «Не помню» today from an old client: repetitions reset, schedule moved to tomorrow.
    { repetitions: 0, next_review: TOMORROW, last_reviewed_at: null },
  ];
}

function demoQuiz(): LearningEvent[] {
  return [
    ...attempt('a0000000-0000-0000-0000-000000000002', '2026-10-02T14:20:00Z', [true, true, true, true, true], true),
    ...attempt('a0000000-0000-0000-0000-000000000001', '2026-10-02T13:50:00Z', [true, false, true, true, true], false),
  ];
}

describe('materialMetrics', () => {
  it('gives the demo run its honest numbers', () => {
    const metrics = materialMetrics(demoCards(), demoQuiz(), NOW);
    expect(metrics.cards).toEqual({
      total: 6,
      reviewed: 6,
      recalled: 5,
      consolidated: 0,
      nextCheck: '2026-10-03T14:00:30+00:00',
    });
    expect(metrics.quiz).toEqual({ date: '2026-10-02', correct: 4, total: 5 });
    expect(metrics.quizRepeat).toEqual({ date: '2026-10-02', correct: 5, total: 5 });
    expect(metrics.accuracy).toEqual({ value: 9 / 11, numerator: 9, denominator: 11 });
    expect(Math.round((metrics.accuracy?.value ?? 0) * 100)).toBe(82);
    expect(metrics.status).toBe('measured');
  });

  it('counts a card as consolidated only after two successful answers', () => {
    const cards: ProgressCard[] = [
      { repetitions: 2, next_review: '2026-10-08T10:00:00Z', last_reviewed_at: '2026-10-02T10:00:00Z' },
      { repetitions: 3, next_review: '2026-10-20T10:00:00Z', last_reviewed_at: '2026-10-02T10:00:00Z' },
      { repetitions: 1, next_review: '2026-10-03T10:00:00Z', last_reviewed_at: '2026-10-02T10:00:00Z' },
    ];
    const metrics = materialMetrics(cards, [], NOW);
    expect(metrics.cards).toMatchObject({ reviewed: 3, recalled: 3, consolidated: 2, nextCheck: '2026-10-03T10:00:00Z' });
    expect(metrics.quiz).toBeNull();
    expect(metrics.accuracy).toEqual({ value: 1, numerator: 3, denominator: 3 });
  });

  it('never counts a retake as the first test', () => {
    const events = [
      ...attempt('b0000000-0000-0000-0000-000000000001', '2026-10-01T10:00:00Z', [true, true, true], true),
      ...attempt('b0000000-0000-0000-0000-000000000002', '2026-10-02T10:00:00Z', [true, false, false], false),
    ];
    const metrics = materialMetrics([], events, NOW);
    expect(metrics.quiz).toEqual({ date: '2026-10-02', correct: 1, total: 3 });
    expect(metrics.quizRepeat).toBeNull();
  });

  it('shows the latest later attempt as the repeat and keeps it out of the accuracy', () => {
    const events = [
      ...attempt('c0000000-0000-0000-0000-000000000001', '2026-09-28T10:00:00Z', [false, false, true, true], false),
      ...attempt('c0000000-0000-0000-0000-000000000002', '2026-09-29T10:00:00Z', [true, true, true, false], true),
      ...attempt('c0000000-0000-0000-0000-000000000003', '2026-09-30T10:00:00Z', [true, true, true, true], true),
    ];
    const metrics = materialMetrics([], events, NOW);
    expect(metrics.quiz).toEqual({ date: '2026-09-28', correct: 2, total: 4 });
    expect(metrics.quizRepeat).toEqual({ date: '2026-09-30', correct: 4, total: 4 });
    expect(metrics.accuracy).toEqual({ value: 0.5, numerator: 2, denominator: 4 });
  });

  it('dates an attempt by the local day of the answer', () => {
    const events = attempt('d0000000-0000-0000-0000-000000000001', '2026-10-02T22:30:00Z', [true, true, true], false, '2026-10-03');
    expect(materialMetrics([], events, NOW).quiz).toEqual({ date: '2026-10-03', correct: 3, total: 3 });
  });

  it('leaves unscored answers out of the test counts', () => {
    const events = [
      quizAnswer('e0000000-0000-0000-0000-000000000001', '2026-10-02T10:00:00Z', true, false),
      quizAnswer('e0000000-0000-0000-0000-000000000001', '2026-10-02T10:00:01Z', null, false),
      quizAnswer('e0000000-0000-0000-0000-000000000001', '2026-10-02T10:00:02Z', false, false),
    ];
    expect(materialMetrics([], events, NOW).quiz).toEqual({ date: '2026-10-02', correct: 1, total: 2 });
  });

  it('has too little data below three measured answers', () => {
    const metrics = materialMetrics(
      [{ repetitions: 1, next_review: TOMORROW, last_reviewed_at: '2026-10-02T10:00:00Z' }, { repetitions: 0, next_review: '2026-10-01T10:00:00Z' }],
      [],
      NOW,
    );
    expect(MIN_MEASURED).toBe(3);
    expect(metrics.status).toBe('few_data');
    expect(metrics.accuracy).toBeNull();
    expect(metrics.cards).toMatchObject({ total: 2, reviewed: 1, recalled: 1 });
  });

  it('is untested when nothing was answered', () => {
    const fresh: ProgressCard[] = Array.from({ length: 6 }, () => ({
      repetitions: 0,
      next_review: '2026-10-02T09:00:00Z',
      last_reviewed_at: null,
    }));
    const metrics = materialMetrics(fresh, [], NOW);
    expect(metrics.status).toBe('untested');
    expect(metrics.cards).toEqual({ total: 6, reviewed: 0, recalled: 0, consolidated: 0, nextCheck: null });
    expect(metrics.quiz).toBeNull();
    expect(metrics.quizRepeat).toBeNull();
    expect(metrics.accuracy).toBeNull();
    expect(materialMetrics([], [], NOW).status).toBe('untested');
  });

  it('counts «Не помню» today as reviewed but not recalled', () => {
    const metrics = materialMetrics([{ repetitions: 0, next_review: TOMORROW, last_reviewed_at: null }], [], NOW);
    expect(metrics.cards).toMatchObject({ reviewed: 1, recalled: 0 });
  });

  it('does not count a new follow-up card from an oral answer as reviewed', () => {
    const cards: ProgressCard[] = [
      { repetitions: 0, next_review: TOMORROW, last_reviewed_at: null, origin: 'oral_followup' },
      { repetitions: 0, next_review: TOMORROW, last_reviewed_at: '2026-10-02T12:00:00Z', origin: 'oral_followup' },
    ];
    expect(materialMetrics(cards, [], NOW).cards).toMatchObject({ total: 2, reviewed: 1, recalled: 0 });
  });

  it('is not untested when only a repeated attempt exists', () => {
    const events = attempt('f0000000-0000-0000-0000-000000000001', '2026-10-02T10:00:00Z', [true, true], true);
    const metrics = materialMetrics([], events, NOW);
    expect(metrics.quiz).toBeNull();
    expect(metrics.quizRepeat).toEqual({ date: '2026-10-02', correct: 2, total: 2 });
    expect(metrics.status).toBe('few_data');
  });

  it('ignores journal events of other kinds', () => {
    const review: LearningEvent = { ...quizAnswer('g0000000-0000-0000-0000-000000000001', '2026-10-02T10:00:00Z', true, false), kind: 'card_review' };
    expect(materialMetrics([], [review], NOW).quiz).toBeNull();
  });
});
