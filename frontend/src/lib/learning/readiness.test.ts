import { describe, expect, it } from 'vitest';
import type { LearningEvent } from '../../api/learning';
import {
  CONFIRM_MIN_HOURS,
  CONFIRM_STALE_DAYS,
  READINESS_LABELS,
  SELF_RATING_CONFIDENCE,
  SELF_RATING_LABELS,
  confidenceVsConfirmed,
  daysSinceDay,
  emptyQuestionState,
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
  opts: { localDate?: string; session?: string; score?: number; confidence?: 1 | 2 | 3 | null; unscored?: boolean } = {},
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
    correct: opts.unscored ? null : grade >= 4,
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
      untested: 'ещё не отвечали',
      // Under the 20-hour rule 23:59 and 0:01 are two days and still not a confirmation, so the
      // label never names a day. No «засчитано» on screen since Ф1: it read as a credit from an AI.
      once: 'ответ полный, ещё не выучено',
      confirmed: 'выучено',
      not_passed: 'ответ неполный',
    });
    for (const label of Object.values(READINESS_LABELS)) expect(label).not.toMatch(/засчит|зачт/);
    expect(SELF_RATING_LABELS).toEqual({ know: 'знаю', unsure: 'плаваю', dont_know: 'не знаю' });
    expect(SELF_RATING_CONFIDENCE).toEqual({ dont_know: 1, unsure: 2, know: 3 });
  });
});

describe('questionState', () => {
  it('is untested without answers', () => {
    const empty = {
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
      seriesStartAt: null,
      seriesStartDate: null,
      lastPassAt: null,
      lastPassDate: null,
      confirmedAt: null,
      confirmedOn: null,
      stale: false,
      confirmableFrom: null,
      awaiting: false,
    };
    expect(questionState([], [])).toEqual(empty);
    expect(emptyQuestionState()).toEqual(empty);
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

/** A local wall-clock moment as the server would store it (created_at in UTC), and its local day. */
function local(day: string, hh: number, mm = 0): { at: string; localDate: string } {
  const [y, m, d] = day.split('-').map(Number);
  return { at: new Date(y, m - 1, d, hh, mm).toISOString(), localDate: day };
}

function pass(hash: string, day: string, hh: number, mm = 0, grade = 4): LearningEvent {
  const when = local(day, hh, mm);
  return answer(hash, when.at, grade, { localDate: when.localDate });
}

function fail(hash: string, day: string, hh: number, mm = 0, grade = 3): LearningEvent {
  const when = local(day, hh, mm);
  return answer(hash, when.at, grade, { localDate: when.localDate });
}

describe('the rule «подтверждено» (Jury_Check item 3)', () => {
  it('confirms 10:00 and 18:00 on one day and 8:00 the next day: the first and the last are 22 hours and two days apart', () => {
    const answers = [pass(HASH_A, '2026-10-07', 10), pass(HASH_A, '2026-10-07', 18), pass(HASH_A, '2026-10-08', 8)];
    expect(questionState(answers.slice(0, 2), []).readiness).toBe('once');
    const state = questionState(answers, []);
    expect(state.readiness).toBe('confirmed');
    expect(READINESS_LABELS[state.readiness]).toBe('выучено');
    expect(state).toMatchObject({
      seriesStartAt: answers[0].created_at,
      seriesStartDate: '2026-10-07',
      lastPassAt: answers[2].created_at,
      lastPassDate: '2026-10-08',
      confirmedAt: answers[2].created_at,
      confirmedOn: '2026-10-08',
      confirmableFrom: null,
      awaiting: false,
    });
  });

  it('does not confirm 23:59 and 0:01: two days, but two minutes apart', () => {
    const state = questionState([pass(HASH_A, '2026-10-07', 23, 59), pass(HASH_A, '2026-10-08', 0, 1)], []);
    expect(state.readiness).toBe('once');
    expect(READINESS_LABELS[state.readiness]).toBe('ответ полный, ещё не выучено');
  });

  it('does not confirm 1:00 and 21:00 of one day: 20 hours, but one day', () => {
    const state = questionState([pass(HASH_A, '2026-10-07', 1), pass(HASH_A, '2026-10-07', 21)], []);
    expect(state.readiness).toBe('once');
  });

  it('starts the series over after a провал: pass, fail, pass the next day is not a confirmation; a later pass 20 hours on is', () => {
    const first = pass(HASH_A, '2026-10-07', 10);
    const failed = fail(HASH_A, '2026-10-07', 15);
    const restart = pass(HASH_A, '2026-10-08', 11);
    // Without the провал the same passes would confirm the question (25 hours, two days).
    expect(questionState([first, restart], []).readiness).toBe('confirmed');
    const restarted = questionState([first, failed, restart], []);
    expect(restarted.readiness).toBe('once');
    expect(restarted.seriesStartAt).toBe(restart.created_at);
    // Exactly 20 hours after the restart, on a later day: confirmed.
    const later = pass(HASH_A, '2026-10-09', 7);
    expect(Date.parse(later.created_at) - Date.parse(restart.created_at)).toBe(CONFIRM_MIN_HOURS * 3_600_000);
    const confirmed = questionState([first, failed, restart, later], []);
    expect(confirmed.readiness).toBe('confirmed');
    expect(confirmed.confirmedOn).toBe('2026-10-09');
    // One minute short of 20 hours is not enough.
    expect(questionState([first, failed, restart, pass(HASH_A, '2026-10-09', 6, 59)], []).readiness).toBe('once');
  });

  it('ignores answers without a grade: they neither start nor break a series', () => {
    const graded = [pass(HASH_A, '2026-10-07', 10), pass(HASH_A, '2026-10-08', 9)];
    const unscored = (day: string, hh: number) => answer(HASH_A, local(day, hh).at, 3, { localDate: day, unscored: true });
    const state = questionState([unscored('2026-10-06', 9), graded[0], unscored('2026-10-07', 12), graded[1]], []);
    expect(state.readiness).toBe('confirmed');
    expect(state.seriesStartAt).toBe(graded[0].created_at);
    expect(state.attempts).toBe(4);
    expect(questionState([unscored('2026-10-06', 9)], []).readiness).toBe('untested');
    expect(questionState([graded[0], unscored('2026-10-09', 9)], []).readiness).toBe('once');
  });

  it('takes the hours from the server time and the days from the local day', () => {
    // 30 hours apart by the server clock, but the browser wrote the same local day: not two days.
    const sameDay = [
      answer(HASH_A, '2026-10-07T01:00:00Z', 4, { localDate: '2026-10-07' }),
      answer(HASH_A, '2026-10-08T07:00:00Z', 4, { localDate: '2026-10-07' }),
    ];
    expect(questionState(sameDay, []).readiness).toBe('once');
    // Two local days, but 19 h 59 min by the server clock.
    const tooSoon = [
      answer(HASH_A, '2026-10-07T10:00:00Z', 4, { localDate: '2026-10-07' }),
      answer(HASH_A, '2026-10-08T05:59:00Z', 4, { localDate: '2026-10-08' }),
    ];
    expect(questionState(tooSoon, []).readiness).toBe('once');
    const enough = [tooSoon[0], answer(HASH_A, '2026-10-08T06:00:00Z', 4, { localDate: '2026-10-08' })];
    expect(questionState(enough, []).readiness).toBe('confirmed');
  });

  it('is «пора проверить» from the 14th calendar day after the last засчитанный answer, and still confirmed', () => {
    const answers = [pass(HASH_A, '2026-09-20', 10), pass(HASH_A, '2026-09-21', 10), pass(HASH_A, '2026-09-25', 12)];
    const day = 86_400_000;
    // The last day before: 8 October, a millisecond before midnight (13 days after 25 September).
    const before = questionState(answers, [], new Date(2026, 9, 9).getTime() - 1);
    expect(before).toMatchObject({ readiness: 'confirmed', stale: false });
    // 9 October from its first moment, even before the hour of the answer (one clock: the calendar, as the sheet's words).
    const at = questionState(answers, [], new Date(2026, 9, 9, 0, 0));
    expect(at).toMatchObject({ readiness: 'confirmed', stale: true, lastPassAt: answers[2].created_at, confirmedOn: '2026-09-21' });
    expect(daysSinceDay('2026-09-25', new Date(2026, 9, 9, 0, 0))).toBe(CONFIRM_STALE_DAYS);
    // Counted from the last засчитанный answer, not from the day it was first confirmed.
    expect(questionState(answers, [], new Date(Date.parse(answers[1].created_at) + 15 * day)).stale).toBe(false);
    expect(questionState(answers.slice(0, 2), [], new Date(Date.parse(answers[1].created_at) + 15 * day)).stale).toBe(true);
  });

  it('says «пора проверить» exactly when the sheet says «14 дней назад» or more, at every hour around the boundary', () => {
    // The debt: the flag counted 14 × 24 h of the server's clock, the sheet's words calendar days, so «Выучено 14 дней
    // назад.» could stand without «Пора проверить.» until the hour of the answer came round again.
    for (const hour of [0, 9, 12, 23]) {
      const answers = [pass(HASH_A, '2026-09-19', 10), pass(HASH_A, '2026-09-21', hour, 30)];
      for (let at = new Date(2026, 9, 3, 0, 0).getTime(); at <= new Date(2026, 9, 7, 0, 0).getTime(); at += 3_600_000) {
        const state = questionState(answers, [], at);
        expect(state.readiness).toBe('confirmed');
        const words = daysSinceDay(state.lastPassDate, at) as number;
        expect(state.stale, `answered at ${hour}:30, now ${new Date(at).toString()}`).toBe(words >= CONFIRM_STALE_DAYS);
      }
    }
  });

  it('counts calendar days from a local day in the browser’s zone, and nothing for no day', () => {
    expect(daysSinceDay('2026-10-09', new Date(2026, 9, 9, 23, 59))).toBe(0);
    expect(daysSinceDay('2026-10-08', new Date(2026, 9, 9, 0, 1))).toBe(1);
    expect(daysSinceDay('2026-09-25', new Date(2026, 9, 9).getTime())).toBe(14);
    expect(daysSinceDay('2026-10-10', new Date(2026, 9, 9))).toBe(-1);
    expect(daysSinceDay(null)).toBeNull();
    expect(daysSinceDay('9 октября')).toBeNull();
  });

  it('names the earliest moment a засчитанный answer would confirm a question passed once, and when that moment has come', () => {
    const afternoon = pass(HASH_A, '2026-10-07', 14, 2);
    const state = questionState([afternoon], [], new Date(2026, 9, 8, 10, 1));
    // The later of 20 hours on and the next local midnight.
    expect(state.confirmableFrom).toBe(new Date(2026, 9, 8, 10, 2).toISOString());
    expect(state.awaiting).toBe(false);
    expect(questionState([afternoon], [], new Date(2026, 9, 8, 10, 2)).awaiting).toBe(true);
    // An answer at 3:00: 20 hours on is 23:00 the same day, so the next midnight decides.
    const night = pass(HASH_A, '2026-10-07', 3);
    expect(questionState([night], []).confirmableFrom).toBe(new Date(2026, 9, 8, 0, 0).toISOString());
    // A second pass the same day does not move the start of the series.
    expect(questionState([afternoon, pass(HASH_A, '2026-10-07', 20)], []).confirmableFrom).toBe(new Date(2026, 9, 8, 10, 2).toISOString());
    // Only a question passed once has it.
    expect(questionState([afternoon, fail(HASH_A, '2026-10-08', 9)], [])).toMatchObject({ readiness: 'not_passed', confirmableFrom: null, awaiting: false, seriesStartAt: null, lastPassAt: null });
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
    const states = statesByHash(
      [
        answer(HASH_A, '2026-10-07T09:00:00Z', 4),
        answer(HASH_A, '2026-10-08T09:00:00Z', 5),
        answer(HASH_B, '2026-10-09T09:00:00Z', 4),
        answer(HASH_C, '2026-10-06T09:00:00Z', 2),
      ],
      new Date('2026-10-10T12:00:00Z'),
    );
    expect(examSummary([HASH_A, HASH_B, HASH_C, HASH_D], states)).toEqual({
      total: 4,
      confirmed: 1,
      once: 1,
      notPassed: 1,
      untested: 1,
      since: '2026-10-06',
      stale: 0,
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
      stale: 0,
    });
  });

  it('keeps a stale confirmation among the confirmed and counts it as «пора проверить»', () => {
    const events = [
      answer(HASH_A, '2026-09-01T09:00:00Z', 4),
      answer(HASH_A, '2026-09-02T09:00:00Z', 5),
      answer(HASH_B, '2026-10-01T09:00:00Z', 4),
      answer(HASH_B, '2026-10-02T09:00:00Z', 4),
    ];
    const summary = examSummary([HASH_A, HASH_B], statesByHash(events, new Date('2026-10-05T12:00:00Z')));
    expect(summary).toMatchObject({ confirmed: 2, stale: 1 });
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
