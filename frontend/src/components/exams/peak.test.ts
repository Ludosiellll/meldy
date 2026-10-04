import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LearningEvent } from '../../api/learning';
import {
  daysPhrase,
  growthSentence,
  parsePeakFlags,
  peakChange,
  peakGrowth,
  peakKey,
  peakText,
  secondAnswerAfterReview,
  secondAnswerSentence,
  secondAnswerSessions,
  staleSentence,
  takePeakFlags,
  type PeakCounts,
} from './peak';

const HASH = 'ab'.repeat(16);
const OTHER = 'cd'.repeat(16);
const NOW = new Date(2026, 9, 7, 12, 0, 0);
const TODAY = '2026-10-07';

/** A local wall-clock time as the server stores it. */
function at(day: string, hh = 10, mm = 0): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, hh, mm).toISOString();
}

function answer(day: string, correct: boolean, grade: number, id = `${day}-${grade}`, opts: { hh?: number; mm?: number; hash?: string; session?: string } = {}): LearningEvent {
  return {
    id,
    created_at: at(day, opts.hh ?? 10, opts.mm ?? 0),
    local_date: day,
    material_id: null,
    kind: 'exam_answer',
    item_key: `q:${opts.hash ?? HASH}`,
    correct,
    score: grade / 5,
    confidence: null,
    source_ids: [],
    session_id: opts.session ?? id,
    payload: { grade },
  };
}

function point(session: string, status: string, n: number): LearningEvent {
  return {
    id: `${session}-p${n}`,
    created_at: at(TODAY, 10, 1),
    local_date: TODAY,
    material_id: null,
    kind: 'oral_point',
    item_key: `oral:r:p${n}`,
    correct: status === 'unrated' ? null : status === 'covered',
    score: null,
    confidence: null,
    source_ids: [],
    session_id: session,
    payload: { status, point_id: `p${n}` },
  };
}

const COUNTS: PeakCounts = { total: 40, confirmed: 7, once: 3, notPassed: 2, since: '2026-10-04', confirmedBeforeToday: 6 };
const plain = (text: string) => text.replace(/[  ]/g, ' ');

function textOf(answers: LearningEvent[], before: Parameters<typeof peakChange>[2] = null, counts: PeakCounts = COUNTS, confirmedTicketsPct: number | null = null) {
  const change = peakChange(answers, [], before, NOW);
  if (!change) throw new Error('no change');
  return peakText({ change, answers, number: '12', counts, confirmedTicketsPct, now: NOW });
}

afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('the peak flag', () => {
  it('is read tolerantly: a hash, an object, a list or {items}', () => {
    expect(parsePeakFlags(HASH)).toEqual([{ hash: HASH, questionId: null, before: null }]);
    expect(parsePeakFlags(JSON.stringify(`q:${HASH.toUpperCase()}`))).toEqual([{ hash: HASH, questionId: null, before: null }]);
    expect(parsePeakFlags(JSON.stringify({ question_hash: HASH, before: { readiness: 'once' } }))).toEqual([{ hash: HASH, questionId: null, before: 'once' }]);
    expect(parsePeakFlags(JSON.stringify({ questionId: 'q7', readiness_before: 'untested' }))).toEqual([{ hash: null, questionId: 'q7', before: 'untested' }]);
    expect(parsePeakFlags(JSON.stringify([{ hash: HASH }, { hash: HASH }, { hash: OTHER, before: 'confirmed' }]))).toEqual([
      { hash: HASH, questionId: null, before: null },
      { hash: OTHER, questionId: null, before: 'confirmed' },
    ]);
    expect(parsePeakFlags(JSON.stringify({ items: [{ item_key: `q:${OTHER}` }] }))).toEqual([{ hash: OTHER, questionId: null, before: null }]);
  });

  it('ignores anything else', () => {
    expect(parsePeakFlags(null)).toEqual([]);
    expect(parsePeakFlags('not a hash')).toEqual([]);
    expect(parsePeakFlags(JSON.stringify({ hash: 'short', before: 'once' }))).toEqual([]);
    expect(parsePeakFlags('{"broken":')).toEqual([]);
  });

  it('is taken once: the key is removed when read', () => {
    window.sessionStorage.setItem(peakKey('exam-1'), JSON.stringify({ hash: HASH }));
    expect(takePeakFlags('exam-1')).toHaveLength(1);
    expect(window.sessionStorage.getItem('meldy_exam_peak_exam-1')).toBeNull();
    expect(takePeakFlags('exam-1')).toEqual([]);
  });

  it('survives blocked storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(takePeakFlags('exam-1')).toEqual([]);
  });
});

describe('peakChange', () => {
  it('recomputes the state before the latest answer from the journal, unless the flag carries it', () => {
    const answers = [answer('2026-09-29', true, 4), answer(TODAY, true, 5)];
    const change = peakChange(answers, [], null, NOW);
    expect(change?.before.readiness).toBe('once');
    expect(change?.after.readiness).toBe('confirmed');
    expect(peakChange(answers, [], 'untested', NOW)?.before.readiness).toBe('untested');
    expect(peakChange([], [], null, NOW)).toBeNull();
  });
});

describe('peakText: every transition', () => {
  it('untested → once: засчитано today, confirmed by a засчитанный answer on another day, 20 hours on at the earliest', () => {
    const text = textOf([answer(TODAY, true, 4)], 'untested');
    expect(text.because).toBe('Засчитано сегодня. Подтвердит засчитанный ответ на другой день, не раньше чем через 20 часов.');
    expect(text).toMatchObject({ title: 'Засчитано, не подтверждено', before: 2, after: 3, draws: true });
    expect(text.statement).toBe('Вопрос 12: ответ, который вы дали только что, засчитан.');
    // Seven are confirmed already: the growth from history is in the column.
    expect(text.growth).toEqual({ to: 7, total: 40, days: 3, today: 1 });
  });

  it('once → once: said why it is not a confirmation yet and from when it can be', () => {
    const first = answer(TODAY, true, 4, 'a', { hh: 9, mm: 2 });
    const again = answer(TODAY, true, 5, 'b', { hh: 11, mm: 30 });
    const text = textOf([first, again]);
    expect(plain(text.because)).toBe(
      'Снова засчитано, но с первого засчитанного ответа прошло меньше 20 часов или это тот же день. Подтвердит засчитанный ответ не раньше 8 окт., 5:02.',
    );
    expect(text).toMatchObject({ title: 'Засчитано, не подтверждено', before: null, draws: false });
    expect(text.statement).toBe('Вопрос 12: ответ, который вы дали только что, засчитан.');
  });

  it('once → confirmed: the day of the series’ first pass, «засчитано дважды, в разные дни», the growth and +1 today', () => {
    const text = textOf([answer('2026-09-29', true, 4), answer(TODAY, true, 4)], null, COUNTS, 3);
    expect(text.because).toBe('29 сентября — засчитано. Сегодня снова «хорошо»: засчитано дважды, в разные дни, — вопрос подтверждён.');
    expect(text).toMatchObject({ title: 'Подтверждено ответами', before: 6, after: 7, total: 40, draws: true });
    expect(text.statement).toBe('Вопрос 12 подтверждён ответом, который вы дали только что.');
    expect(plain(text.fine[0])).toBe('Подтверждено — значит, засчитано дважды, в разные дни. Билетов, где подтверждены оба вопроса, — 3 %.');
    expect(text.growth).toEqual({ to: 7, total: 40, days: 3, today: 1 });
  });

  it('once → confirmed names the first pass of the current series, not an older one before a провал', () => {
    const text = textOf([answer('2026-09-20', true, 4), answer('2026-09-25', false, 3), answer('2026-09-29', true, 4), answer(TODAY, true, 5)]);
    expect(text.because).toBe('29 сентября — засчитано. Сегодня снова «отлично»: засчитано дважды, в разные дни, — вопрос подтверждён.');
  });

  it('confirmed → confirmed: one more good answer, nothing drawn', () => {
    const text = textOf([answer('2026-09-20', true, 4), answer('2026-09-29', true, 4), answer(TODAY, true, 5)]);
    expect(text.because).toBe('Сегодня снова «отлично»: вопрос остаётся подтверждённым.');
    expect(text).toMatchObject({ before: null, after: 7, draws: false });
    expect(text.statement).toBe('Вопрос 12 остаётся подтверждённым.');
  });

  it('any → not_passed: «удовлетворительно», в готовность не засчитано, and the growth from history without +1', () => {
    const counts = { ...COUNTS, confirmedBeforeToday: 7 };
    const text = textOf([answer(TODAY, false, 3)], 'untested', counts);
    expect(text.because).toBe('Сегодня — «удовлетворительно», в готовность не засчитано. В режиме «Чаще слабые» вопрос будет выпадать чаще.');
    expect(text).toMatchObject({ title: 'Не засчитано', before: 1, after: 2, total: null, draws: true });
    expect(text.statement).toBe('Вопрос 12: ответ, который вы дали только что, не засчитан.');
    expect(text.growth).toEqual({ to: 7, total: 40, days: 3, today: 0 });
  });

  it('confirmed → not_passed: confirmed since the day it was first confirmed, the confirmation is taken back', () => {
    const text = textOf([answer('2026-09-20', true, 4), answer('2026-09-29', true, 5), answer('2026-10-02', true, 4), answer(TODAY, false, 3)]);
    expect(text.because).toBe('Был подтверждён с 29 сентября, сегодня — «удовлетворительно». Подтверждение снято, серия начнётся заново.');
    expect(text).toMatchObject({ title: 'Подтверждено ответами', before: 8, after: 7, total: 40, draws: true });
    expect(text.statement).toBe('Вопрос 12: ответ, который вы дали только что, не засчитан. Подтверждение снято.');
  });

  it('not_passed → once: the series started over', () => {
    const text = textOf([answer('2026-10-05', false, 2), answer(TODAY, true, 4)]);
    expect(text.because).toBe('Засчитано сегодня. После провала серия началась заново.');
    expect(text).toMatchObject({ title: 'Засчитано, не подтверждено', before: 2, after: 3, draws: true });
  });

  it('not_passed → not_passed: the wavy line stays, nothing is drawn again', () => {
    const text = textOf([answer('2026-10-05', false, 2), answer(TODAY, false, 3)]);
    expect(text.because).toBe('Сегодня — «удовлетворительно», в готовность не засчитано. В режиме «Чаще слабые» вопрос будет выпадать чаще.');
    expect(text).toMatchObject({ title: 'Не засчитано', before: 2, after: 2, draws: false });
  });

  it('never says «0 → 0»: with nothing confirmed the column keeps the count of the transition', () => {
    const counts = { total: 40, confirmed: 0, once: 1, notPassed: 0, since: TODAY, confirmedBeforeToday: 0 };
    const text = textOf([answer(TODAY, true, 4)], 'untested', counts);
    expect(text.growth).toBeNull();
    expect(text).toMatchObject({ title: 'Засчитано, не подтверждено', before: 0, after: 1 });
    expect(text.fine).toEqual([]);
  });
});

describe('the growth line', () => {
  it('counts the days from the first answer and the net change of the day, never below zero', () => {
    expect(peakGrowth({ ...COUNTS, since: '2026-10-06' }, NOW)).toEqual({ to: 7, total: 40, days: 1, today: 1 });
    expect(peakGrowth({ ...COUNTS, since: TODAY, confirmedBeforeToday: 7 }, NOW)).toEqual({ to: 7, total: 40, days: 0, today: 0 });
    // A day that lost one confirmation and gained another: 7 before, 7 now — no «+1».
    expect(peakGrowth({ ...COUNTS, confirmedBeforeToday: 7 }, NOW)?.today).toBe(0);
    // Lost more than gained: still no negative change shown.
    expect(peakGrowth({ ...COUNTS, confirmedBeforeToday: 9 }, NOW)?.today).toBe(0);
    // Unknown history before today: no «+N сегодня».
    expect(peakGrowth({ ...COUNTS, confirmedBeforeToday: null }, NOW)?.today).toBe(0);
    expect(peakGrowth({ ...COUNTS, confirmed: 0 }, NOW)).toBeNull();
  });

  it('words the days with plurals and dates the start of the history', () => {
    expect(daysPhrase(1)).toBe('за 1 день');
    expect(daysPhrase(3)).toBe('за 3 дня');
    expect(daysPhrase(5)).toBe('за 5 дней');
    expect(daysPhrase(21)).toBe('за 21 день');
    expect(daysPhrase(0)).toBe('');
    expect(growthSentence({ confirmed: 7, since: '2026-10-04' }, NOW)).toBe('С 4 октября: 0 → 7 за 3 дня.');
    expect(growthSentence({ confirmed: 7, since: TODAY }, NOW)).toBeNull();
    expect(growthSentence({ confirmed: 0, since: '2026-10-01' }, NOW)).toBeNull();
    expect(staleSentence(2)).toBe('Пора проверить: 2 — подтверждены больше 14 дней назад.');
    expect(staleSentence(1)).toBe('Пора проверить: 1 — подтверждён больше 14 дней назад.');
    expect(staleSentence(0)).toBeNull();
  });
});

describe('«Второй ответ после разбора»', () => {
  it('pools раскрыто / rated over the first and the second answers of the questions answered twice', () => {
    const q1 = [answer('2026-10-01', true, 4, 's1', { session: 's1' }), answer('2026-10-03', true, 5, 's2', { session: 's2' })];
    const q2 = [
      answer('2026-10-02', false, 3, 's3', { hash: OTHER, session: 's3' }),
      answer('2026-10-04', true, 4, 's4', { hash: OTHER, session: 's4' }),
      // A third answer is not part of it.
      answer('2026-10-05', true, 5, 's5', { hash: OTHER, session: 's5' }),
    ];
    const points = [
      // first answers: 2 of 5 and 1 of 3 раскрыто (an unrated point is left out)
      ...['covered', 'covered', 'partial', 'missing', 'wrong', 'unrated'].map((status, n) => point('s1', status, n)),
      ...['covered', 'missing', 'missing'].map((status, n) => point('s3', status, n)),
      // second answers: 4 of 5 and 3 of 3
      ...['covered', 'covered', 'covered', 'covered', 'partial'].map((status, n) => point('s2', status, n)),
      ...['covered', 'covered', 'covered'].map((status, n) => point('s4', status, n)),
      ...['missing', 'missing'].map((status, n) => point('s5', status, n)),
    ];
    const value = secondAnswerAfterReview([...q1, ...q2], points);
    expect(value).toEqual({ questions: 2, firstPct: 38, secondPct: 88 });
    expect(plain(secondAnswerSentence(value!))).toBe('Второй ответ после разбора: по 2 вопросам в первый раз раскрыто 38 % пунктов, во второй — 88 %.');
    expect(secondAnswerSessions([...q1, ...q2]).sort()).toEqual(['s1', 's2', 's3', 's4']);
  });

  it('needs two graded answers, and rated points in both sessions', () => {
    const once = [answer('2026-10-01', true, 4, 's1', { session: 's1' })];
    expect(secondAnswerAfterReview(once, [point('s1', 'covered', 1)])).toBeNull();
    expect(secondAnswerSessions(once)).toEqual([]);
    const twice = [answer('2026-10-01', true, 4, 's1', { session: 's1' }), answer('2026-10-03', true, 5, 's2', { session: 's2' })];
    // The second session has only unrated points: the question drops out.
    expect(secondAnswerAfterReview(twice, [point('s1', 'covered', 1), point('s2', 'unrated', 1)])).toBeNull();
    // Answers without a grade do not count as the first or the second answer.
    const unscored = { ...answer('2026-09-30', true, 4, 's0', { session: 's0' }), correct: null };
    expect(secondAnswerAfterReview([unscored, ...twice], [point('s1', 'covered', 1), point('s2', 'covered', 1), point('s0', 'missing', 1)])).toEqual({
      questions: 1,
      firstPct: 100,
      secondPct: 100,
    });
    expect(secondAnswerAfterReview([], [])).toBeNull();
    expect(plain(secondAnswerSentence({ questions: 1, firstPct: 40, secondPct: 80 }))).toBe(
      'Второй ответ после разбора: по 1 вопросу в первый раз раскрыто 40 % пунктов, во второй — 80 %.',
    );
  });
});
