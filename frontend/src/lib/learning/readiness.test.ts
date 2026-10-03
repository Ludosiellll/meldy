import { describe, expect, it } from 'vitest';
import type { LearningEvent } from '../../api/learning';
import {
  READINESS_LABELS,
  SELF_RATING_CONFIDENCE,
  SELF_RATING_LABELS,
  confidenceVsConfirmed,
  examSummary,
  questionState,
  statesByHash,
} from './readiness';

const HASH_A = 'eee8c9ac62e0050c8e2065db1ebed8cc';
const HASH_B = '0123456789abcdef0123456789abcdef';
const HASH_C = 'fedcba9876543210fedcba9876543210';
const HASH_D = '11112222333344445555666677778888';

let sequence = 0;

function answer(
  hash: string,
  at: string,
  grade: number,
  opts: { localDate?: string; session?: string; score?: number; confidence?: 1 | 2 | 3 | null } = {},
): LearningEvent {
  sequence += 1;
  const score = opts.score ?? (grade >= 5 ? 89 : grade === 4 ? 70 : grade === 3 ? 50 : 30);
  return {
    id: `answer-${sequence}`,
    created_at: at,
    local_date: opts.localDate ?? at.slice(0, 10),
    material_id: null,
    kind: 'exam_answer',
    item_key: `q:${hash}`,
    correct: grade >= 4,
    score: score / 100,
    confidence: opts.confidence ?? null,
    source_ids: [],
    session_id: opts.session ?? `session-${sequence}`,
    payload: { v: 1, grade, score_pct: score, exam_id: 'exam-1', exam_question_id: 'question-1' },
  };
}

function rating(hash: string, at: string, confidence: 1 | 2 | 3): LearningEvent {
  sequence += 1;
  return {
    id: `rating-${sequence}`,
    created_at: at,
    local_date: at.slice(0, 10),
    material_id: null,
    kind: 'self_rating',
    item_key: `q:${hash}`,
    correct: null,
    score: null,
    confidence,
    source_ids: [],
    session_id: null,
    payload: { v: 1, exam_id: 'exam-1', exam_question_id: 'question-1' },
  };
}

describe('labels', () => {
  it('uses the agreed words and the confidence scale', () => {
    expect(READINESS_LABELS).toEqual({
      untested: 'не проверялось',
      // Two passes on the same day are still 'once': the label must not say «один раз».
      once: 'зачтено в один день',
      confirmed: 'подтверждено',
      not_passed: 'не зачтено',
    });
    expect(SELF_RATING_LABELS).toEqual({ know: 'знаю', unsure: 'плаваю', dont_know: 'не знаю' });
    expect(SELF_RATING_CONFIDENCE).toEqual({ dont_know: 1, unsure: 2, know: 3 });
  });
});

describe('questionState', () => {
  it('is untested without answers', () => {
    expect(questionState([], [])).toEqual({
      readiness: 'untested',
      selfRating: null,
      ratingAtLastAnswer: null,
      attempts: 0,
      passedDays: 0,
      lastDate: null,
      lastGrade: null,
      lastScorePct: null,
      firstDate: null,
      lastSessionId: null,
    });
  });

  it('is not passed when the last answer got a 3', () => {
    const state = questionState([answer(HASH_A, '2026-10-07T10:00:00Z', 3)], []);
    expect(state.readiness).toBe('not_passed');
    expect(state.lastGrade).toBe(3);
    expect(state.lastScorePct).toBe(50);
    expect(state.attempts).toBe(1);
  });

  it('is passed once after two passed answers on the same local day', () => {
    const state = questionState(
      [answer(HASH_A, '2026-10-07T09:00:00Z', 4), answer(HASH_A, '2026-10-07T18:00:00Z', 5)],
      [],
    );
    expect(state.readiness).toBe('once');
    expect(state.passedDays).toBe(1);
  });

  it('is confirmed by passed answers on two different local days', () => {
    const state = questionState(
      [answer(HASH_A, '2026-10-08T08:00:00Z', 5), answer(HASH_A, '2026-10-07T09:00:00Z', 4)],
      [],
    );
    expect(state.readiness).toBe('confirmed');
    expect(state.passedDays).toBe(2);
    expect(state.firstDate).toBe('2026-10-07');
    expect(state.lastDate).toBe('2026-10-08');
  });

  it('counts the local day, not the UTC day of the server time', () => {
    const late = answer(HASH_A, '2026-10-07T21:30:00Z', 5, { localDate: '2026-10-08' });
    const morning = answer(HASH_A, '2026-10-08T06:00:00Z', 5, { localDate: '2026-10-08' });
    expect(questionState([late, morning], []).readiness).toBe('once');
  });

  it('turns confirmed into not passed after a later failed answer', () => {
    const answers = [
      answer(HASH_A, '2026-10-07T09:00:00Z', 4),
      answer(HASH_A, '2026-10-08T09:00:00Z', 5),
      answer(HASH_A, '2026-10-09T09:00:00Z', 2),
    ];
    expect(questionState(answers.slice(0, 2), []).readiness).toBe('confirmed');
    expect(questionState(answers, []).readiness).toBe('not_passed');
  });

  it('passes again once after a failure is followed by a pass', () => {
    const answers = [answer(HASH_A, '2026-10-07T09:00:00Z', 3), answer(HASH_A, '2026-10-08T09:00:00Z', 4)];
    expect(questionState(answers, []).readiness).toBe('once');
  });

  it('takes the latest self-rating by time, whatever the array order', () => {
    const ratings = [
      rating(HASH_A, '2026-10-07T12:00:00Z', 1),
      rating(HASH_A, '2026-10-07T09:00:00Z', 3),
      rating(HASH_A, '2026-10-06T09:00:00Z', 2),
    ];
    expect(questionState([], ratings).selfRating).toBe('dont_know');
    expect(questionState([], ratings.slice(1)).selfRating).toBe('know');
  });

  it('never treats a self-rating as an answer', () => {
    const state = questionState([], [rating(HASH_A, '2026-10-07T12:00:00Z', 3)]);
    expect(state.readiness).toBe('untested');
    expect(state.attempts).toBe(0);
    expect(state.ratingAtLastAnswer).toBeNull();
  });

  it('keeps the self-rating that was in force when the latest answer was given', () => {
    const state = questionState(
      [answer(HASH_A, '2026-10-07T10:00:00Z', 2)],
      [rating(HASH_A, '2026-10-07T09:00:00Z', 3), rating(HASH_A, '2026-10-07T11:00:00Z', 2)],
    );
    expect(state.selfRating).toBe('unsure');
    expect(state.ratingAtLastAnswer).toBe('know');
  });

  it('has no rating at the answer when the question was rated only afterwards', () => {
    const state = questionState([answer(HASH_A, '2026-10-07T10:00:00Z', 5)], [rating(HASH_A, '2026-10-07T11:00:00Z', 3)]);
    expect(state.selfRating).toBe('know');
    expect(state.ratingAtLastAnswer).toBeNull();
  });

  it('prefers the rating stored with the answer itself', () => {
    const own = answer(HASH_A, '2026-10-07T10:00:00Z', 4, { confidence: 3 });
    expect(questionState([own], []).ratingAtLastAnswer).toBe('know');
    expect(questionState([own], [rating(HASH_A, '2026-10-07T09:00:00Z', 1)]).ratingAtLastAnswer).toBe('know');
  });

  it('takes the rating of the latest answer when the rating changed between answers', () => {
    const state = questionState(
      [answer(HASH_A, '2026-10-07T10:00:00Z', 2), answer(HASH_A, '2026-10-08T10:00:00Z', 4)],
      [rating(HASH_A, '2026-10-07T09:00:00Z', 3), rating(HASH_A, '2026-10-07T12:00:00Z', 1)],
    );
    expect(state.ratingAtLastAnswer).toBe('dont_know');
    expect(state.selfRating).toBe('dont_know');
  });

  it('links the latest answer session for the read-only protocol', () => {
    const state = questionState(
      [
        answer(HASH_A, '2026-10-08T09:00:00Z', 5, { session: 'later-session' }),
        answer(HASH_A, '2026-10-07T09:00:00Z', 3, { session: 'first-session' }),
      ],
      [],
    );
    expect(state.lastSessionId).toBe('later-session');
    expect(state.lastGrade).toBe(5);
  });

  it('orders events of the same millisecond by their full timestamp', () => {
    const first = answer(HASH_A, '2026-10-07T09:00:00.123400+00:00', 5, { session: 'first' });
    const second = answer(HASH_A, '2026-10-07T09:00:00.123900+00:00', 2, { session: 'second' });
    expect(questionState([second, first], []).lastSessionId).toBe('second');
  });
});

describe('statesByHash', () => {
  it('groups by question hash and ignores other journal events', () => {
    const quizEvent: LearningEvent = {
      ...answer(HASH_C, '2026-10-07T09:00:00Z', 5),
      kind: 'quiz_answer',
      item_key: `quiz:none:${HASH_C}`,
    };
    const states = statesByHash([
      answer(HASH_A, '2026-10-07T09:00:00Z', 4),
      rating(HASH_A, '2026-10-07T10:00:00Z', 3),
      rating(HASH_B, '2026-10-07T10:00:00Z', 2),
      quizEvent,
    ]);
    expect(Array.from(states.keys()).sort()).toEqual([HASH_B, HASH_A].sort());
    expect(states.get(HASH_A)).toMatchObject({ readiness: 'once', selfRating: 'know', attempts: 1 });
    expect(states.get(HASH_B)).toMatchObject({ readiness: 'untested', selfRating: 'unsure' });
  });
});

describe('examSummary', () => {
  it('counts every question row and dates the first answer', () => {
    const states = statesByHash([
      answer(HASH_A, '2026-10-07T09:00:00Z', 4),
      answer(HASH_A, '2026-10-08T09:00:00Z', 5),
      answer(HASH_B, '2026-10-09T09:00:00Z', 4),
      answer(HASH_C, '2026-10-06T09:00:00Z', 2),
    ]);
    expect(examSummary([HASH_A, HASH_B, HASH_C, HASH_D], states)).toEqual({
      total: 4,
      confirmed: 1,
      once: 1,
      notPassed: 1,
      untested: 1,
      since: '2026-10-06',
    });
  });

  it('has no start date before the first answer', () => {
    expect(examSummary([HASH_A, HASH_B], new Map())).toEqual({
      total: 2,
      confirmed: 0,
      once: 0,
      notPassed: 0,
      untested: 2,
      since: null,
    });
  });
});

describe('confidenceVsConfirmed', () => {
  it('needs at least three answered «знаю» questions', () => {
    const events = [
      rating(HASH_A, '2026-10-06T09:00:00Z', 3),
      rating(HASH_B, '2026-10-06T09:00:00Z', 3),
      rating(HASH_C, '2026-10-06T09:00:00Z', 3),
      answer(HASH_A, '2026-10-07T09:00:00Z', 5),
      answer(HASH_B, '2026-10-07T09:00:00Z', 3),
    ];
    const hashes = [HASH_A, HASH_B, HASH_C, HASH_D];
    expect(confidenceVsConfirmed(hashes, statesByHash(events))).toEqual({
      ratedKnow: 3,
      ratedKnowAnswered: 2,
      ratedKnowPassed: 1,
      enoughData: false,
    });

    const more = [...events, answer(HASH_C, '2026-10-07T10:00:00Z', 4)];
    expect(confidenceVsConfirmed(hashes, statesByHash(more))).toEqual({
      ratedKnow: 3,
      ratedKnowAnswered: 3,
      ratedKnowPassed: 2,
      enoughData: true,
    });
  });

  it('still counts a failed «знаю» answer after the rating was lowered', () => {
    const hashes = [HASH_A, HASH_B, HASH_C];
    const events = hashes.flatMap((hash) => [
      rating(hash, '2026-10-06T09:00:00Z', 3),
      answer(hash, '2026-10-07T09:00:00Z', 2),
      rating(hash, '2026-10-07T10:00:00Z', 2),
    ]);
    expect(confidenceVsConfirmed(hashes, statesByHash(events))).toEqual({
      ratedKnow: 0,
      ratedKnowAnswered: 3,
      ratedKnowPassed: 0,
      enoughData: true,
    });
  });

  it('does not count a pass given before the rating was raised to «знаю»', () => {
    const hashes = [HASH_A, HASH_B, HASH_C];
    const events = hashes.flatMap((hash) => [
      rating(hash, '2026-10-06T09:00:00Z', 1),
      answer(hash, '2026-10-07T09:00:00Z', 5),
      rating(hash, '2026-10-07T10:00:00Z', 3),
    ]);
    expect(confidenceVsConfirmed(hashes, statesByHash(events))).toEqual({
      ratedKnow: 3,
      ratedKnowAnswered: 0,
      ratedKnowPassed: 0,
      enoughData: false,
    });
  });

  it('uses the rating stored with each answer when the ratings were not loaded', () => {
    const hashes = [HASH_A, HASH_B, HASH_C, HASH_D];
    const events = [
      answer(HASH_A, '2026-10-07T09:00:00Z', 5, { confidence: 3 }),
      answer(HASH_B, '2026-10-07T09:00:00Z', 3, { confidence: 3 }),
      answer(HASH_C, '2026-10-07T09:00:00Z', 4, { confidence: 3 }),
      answer(HASH_D, '2026-10-07T09:00:00Z', 5, { confidence: 2 }),
    ];
    expect(confidenceVsConfirmed(hashes, statesByHash(events))).toEqual({
      ratedKnow: 0,
      ratedKnowAnswered: 3,
      ratedKnowPassed: 2,
      enoughData: true,
    });
  });
});
