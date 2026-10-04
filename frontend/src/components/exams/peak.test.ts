import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LearningEvent } from '../../api/learning';
import { parsePeakFlags, peakChange, peakKey, peakText, takePeakFlags } from './peak';

const HASH = 'ab'.repeat(16);
const OTHER = 'cd'.repeat(16);
const NOW = new Date(2026, 9, 7, 12, 0, 0);
const TODAY = '2026-10-07';

function answer(day: string, correct: boolean, grade: number, id = `${day}-${grade}`): LearningEvent {
  return {
    id,
    created_at: `${day}T10:00:00Z`,
    local_date: day,
    material_id: null,
    kind: 'exam_answer',
    item_key: `q:${HASH}`,
    correct,
    score: grade / 5,
    confidence: null,
    source_ids: [],
    session_id: id,
    payload: { grade },
  };
}

const COUNTS = { total: 40, confirmed: 7, once: 3, notPassed: 2, since: '2026-09-20' };
const plain = (text: string) => text.replace(/ /g, ' ');

function textOf(answers: LearningEvent[], before: Parameters<typeof peakChange>[2] = null, confirmedTicketsPct: number | null = null) {
  const change = peakChange(answers, [], before);
  if (!change) throw new Error('no change');
  return peakText({ change, answers, number: '17', counts: COUNTS, confirmedTicketsPct, now: NOW });
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
    const change = peakChange(answers, [], null);
    expect(change?.before.readiness).toBe('once');
    expect(change?.after.readiness).toBe('confirmed');
    expect(peakChange(answers, [], 'untested')?.before.readiness).toBe('untested');
    expect(peakChange([], [], null)).toBeNull();
  });
});

describe('peakText: the five transitions', () => {
  it('once → confirmed names both days and the new count', () => {
    const text = textOf([answer('2026-09-29', true, 4), answer(TODAY, true, 4)], null, 3);
    expect(text.because).toBe('29 сентября — зачтено. Сегодня снова «хорошо»: два зачёта в разные дни, вопрос подтверждён.');
    expect(text).toMatchObject({ title: 'Подтверждено ответами', before: 6, after: 7, total: 40, draws: true });
    // The growth is part of the statement (redesign critique 2, round 2).
    expect(plain(text.statement)).toBe('Вопрос 17 подтверждён ответом, который вы дали только что. С 20 сентября: 0 → 7.');
    expect(plain(text.fine[0])).toBe('Подтверждено — значит, зачтено дважды, в разные дни. Билетов, где подтверждены оба вопроса, — 3 %.');
  });

  it('confirmed → not passed takes the confirmation back', () => {
    const text = textOf([answer('2026-09-20', true, 4), answer('2026-09-29', true, 5), answer(TODAY, false, 2)]);
    expect(text.because).toBe('Был подтверждён с 29 сентября, сегодня — «неудовлетворительно». Подтверждение снято.');
    expect(text).toMatchObject({ title: 'Подтверждено ответами', before: 8, after: 7, total: 40, draws: true });
  });

  it('untested → not passed says it will come up more often in «Чаще слабые»', () => {
    const text = textOf([answer(TODAY, false, 3)]);
    expect(text.because).toBe('Сегодня — «удовлетворительно», вопрос пока не зачтён. В режиме «Чаще слабые» он будет выпадать чаще.');
    expect(text).toMatchObject({ title: 'Не зачтено', before: 1, after: 2, total: null, draws: true });
  });

  it('untested → once asks for a pass on another day', () => {
    const text = textOf([answer(TODAY, true, 4)]);
    expect(text.because).toBe('Зачтено сегодня. Второй зачёт в другой день подтвердит вопрос.');
    expect(text).toMatchObject({ title: 'Зачтено в один день', before: 2, after: 3, draws: true });
  });

  it('a second pass on the same day changes nothing visible', () => {
    const text = textOf([answer(TODAY, true, 4, 'a'), answer(TODAY, true, 5, 'b')]);
    expect(text.because).toBe('Снова зачтено, но в тот же день. Для подтверждения нужен зачёт в другой день.');
    expect(text).toMatchObject({ before: null, draws: false });
  });

  it('a confirmed question answered well again stays confirmed', () => {
    const text = textOf([answer('2026-09-20', true, 4), answer('2026-09-29', true, 4), answer(TODAY, true, 5)]);
    expect(text.because).toBe('Сегодня снова «отлично»: вопрос остаётся подтверждённым.');
    expect(text).toMatchObject({ before: null, after: 7, draws: false });
  });
});
