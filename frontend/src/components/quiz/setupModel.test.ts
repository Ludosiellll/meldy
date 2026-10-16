import { describe, expect, it } from 'vitest';
import { item } from '../containers/testkit/fixtures';
import type { QuizRow } from '../../types/quiz';
import { changedSettings, countChoices, countFor, isoFromLocal, keyedBySubject, localInput, poolOf, settingsOf } from './setupModel';

const ROW: QuizRow = {
  id: 'q1',
  container_id: 'c1',
  code: 'abcdefghjkmn',
  title: 'Контрольная · 16.10',
  subject_ids: ['s1', 's2'],
  item_count: 20,
  same_set: false,
  shuffle_items: true,
  shuffle_options: true,
  time_limit_s: 1200,
  opens_at: null,
  closes_at: '2026-10-23T20:59:00+00:00',
  closed_at: null,
  attempts: 1,
  grading: 'best',
  allow_back: true,
  pass_percent: null,
  review: 'mistakes_then_answers',
  members_only: false,
  created_at: '2026-10-16T10:00:00+00:00',
  updated_at: '2026-10-16T10:00:00+00:00',
  state: 'open',
  started: false,
};

describe('the pool', () => {
  it('counts keyed questions by subject: a choice with a key or a short answer with forms', () => {
    const counts = keyedBySubject([
      item({ id: 'a', subject_id: 's1' }),
      item({ id: 'b', subject_id: 's1', correct: [] }),
      item({ id: 'c', subject_id: 's2', kind: 'short', options: [], correct: [], answers: ['42'] }),
    ]);
    expect(counts.get('s1')).toBe(1);
    expect(counts.get('s2')).toBe(1);
    expect(poolOf(['s1', 's2'], counts)).toBe(2);
    expect(poolOf(['s3'], counts)).toBe(0);
  });

  it('offers the list below the pool, the pool as «все» and a saved odd count', () => {
    expect(countChoices(12, 12)).toEqual([
      { value: 5, all: false },
      { value: 10, all: false },
      { value: 12, all: true },
    ]);
    const many = countChoices(640, 20);
    expect(many[many.length - 1]).toEqual({ value: 200, all: false });
    expect(countChoices(100, 17).map((choice) => choice.value)).toContain(17);
  });

  it('keeps the count when the pool changes, «все» stays «все»', () => {
    expect(countFor(20, 100, 50)).toBe(20);
    expect(countFor(20, 100, 12)).toBe(12);
    expect(countFor(12, 12, 30)).toBe(30);
    expect(countFor(5, 0, 30)).toBe(5);
  });
});

describe('an edit', () => {
  it('reads a saved quiz as the form, the timer in minutes', () => {
    const s = settingsOf(ROW);
    expect(s.time_limit_min).toBe(20);
    expect(s.subject_ids).toEqual(['s1', 's2']);
    expect(settingsOf({ ...ROW, time_limit_s: null }).time_limit_min).toBeNull();
  });

  it('sends only what changed; the same moment written another way is no change', () => {
    const s = settingsOf(ROW);
    expect(changedSettings(s, { ...s, closes_at: '2026-10-23T20:59:00.000Z', subject_ids: ['s2', 's1'] })).toEqual({});
    expect(changedSettings(s, { ...s, title: '  Итоговая ', attempts: 3, pass_percent: 60 })).toEqual({ title: 'Итоговая', attempts: 3, pass_percent: 60 });
    expect(changedSettings(s, { ...s, closes_at: null })).toEqual({ closes_at: null });
  });

  it('turns a datetime-local value into a moment and back, in the device’s time', () => {
    const iso = isoFromLocal('2026-10-23T23:59');
    expect(iso).not.toBeNull();
    expect(localInput(iso)).toBe('2026-10-23T23:59');
    expect(isoFromLocal('')).toBeNull();
    expect(localInput(null)).toBe('');
  });
});
