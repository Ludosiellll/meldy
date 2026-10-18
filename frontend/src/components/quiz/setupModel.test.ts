import { describe, expect, it } from 'vitest';
import { item } from '../containers/testkit/fixtures';
import type { QuizRow } from '../../types/quiz';
import { defaultSettings } from '../../lib/quizzes/quizModel';
import {
  allQuestions,
  changedSettings,
  countChoices,
  countFor,
  hasExplanations,
  isoFromLocal,
  keyedBySubject,
  localInput,
  poolOf,
  settingsOf,
  whoOf,
  withWho,
  WHO_CHOICES,
} from './setupModel';

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
  guests: true,
  cover_path: null,
  accent: 'blue',
  offer_practice: false,
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

  it('reads the guests, the cover, the colour and the offer to train (release 47)', () => {
    const cover = `c1/${'b'.repeat(64)}.webp`;
    expect(settingsOf({ ...ROW, guests: false, members_only: true, cover_path: cover, accent: 'violet', offer_practice: true })).toMatchObject({
      guests: false,
      members_only: true,
      cover_path: cover,
      accent: 'violet',
      offer_practice: true,
    });
  });

  it('sends the new settings when they change, and nothing when they do not', () => {
    const s = settingsOf(ROW);
    expect(changedSettings(s, { ...s })).toEqual({});
    expect(changedSettings(s, { ...s, guests: false })).toEqual({ guests: false });
    expect(changedSettings(s, { ...s, cover_path: 'c1/x.png', accent: 'orange', offer_practice: true })).toEqual({ cover_path: 'c1/x.png', accent: 'orange', offer_practice: true });
    expect(changedSettings({ ...s, cover_path: 'c1/x.png' }, { ...s, cover_path: null })).toEqual({ cover_path: null });
    expect(changedSettings(s, withWho(s, 'members'))).toEqual({ members_only: true, guests: false });
  });

  it('turns a datetime-local value into a moment and back, in the device’s time', () => {
    const iso = isoFromLocal('2026-10-23T23:59');
    expect(iso).not.toBeNull();
    expect(localInput(iso)).toBe('2026-10-23T23:59');
    expect(isoFromLocal('')).toBeNull();
    expect(localInput(null)).toBe('');
  });
});

describe('who may write (release 47 §47.1)', () => {
  const s = settingsOf(ROW);
  it('reads the two flags as one of three choices', () => {
    expect(WHO_CHOICES).toEqual(['guests', 'link', 'members']);
    expect(whoOf({ guests: true, members_only: false })).toBe('guests');
    expect(whoOf({ guests: false, members_only: false })).toBe('link');
    expect(whoOf({ guests: false, members_only: true })).toBe('members');
    // A row written before release 47 with members_only and the default guests: the members' choice.
    expect(whoOf({ guests: true, members_only: true })).toBe('members');
  });
  it('writes a choice as the two flags, never both on', () => {
    expect(withWho(s, 'guests')).toMatchObject({ guests: true, members_only: false });
    expect(withWho(s, 'link')).toMatchObject({ guests: false, members_only: false });
    expect(withWho(s, 'members')).toMatchObject({ guests: false, members_only: true });
    for (const who of WHO_CHOICES) expect(whoOf(withWho(s, who))).toBe(who);
  });
});

describe('all the questions (?all=1)', () => {
  const base = defaultSettings(['s1', 's2'], 30, new Date('2026-10-18T10:00:00Z'));
  it('takes the whole pool, one set for everyone, in order; the timer follows the count', () => {
    expect(allQuestions(base, 30)).toMatchObject({ subject_ids: ['s1', 's2'], item_count: 30, same_set: true, shuffle_items: false, time_limit_min: 30 });
    expect(allQuestions(base, 7)).toMatchObject({ item_count: 7, time_limit_min: 10 });
  });
  it('stops at 200 questions', () => {
    expect(allQuestions(base, 640)).toMatchObject({ item_count: 200, time_limit_min: 240 });
  });
  it('keeps everything else of the start', () => {
    const all = allQuestions(base, 30);
    expect({ ...all, item_count: base.item_count, time_limit_min: base.time_limit_min, same_set: base.same_set, shuffle_items: base.shuffle_items }).toEqual(base);
  });
  it('is named as the test: its title, trimmed and cut to 120; none — the usual name', () => {
    expect(allQuestions(base, 30, '  Химия, 9 класс ').title).toBe('Химия, 9 класс');
    expect(allQuestions(base, 30, 'Я'.repeat(125)).title).toBe('Я'.repeat(120));
    expect(allQuestions(base, 30, '   ').title).toBe(base.title);
    expect(allQuestions(base, 30, null).title).toBe(base.title);
  });
});

describe('hasExplanations', () => {
  const items = [
    item({ id: 'a', subject_id: 's1', correct: [0], explanation: '' }),
    item({ id: 'b', subject_id: 's1', correct: [0], explanation: '  ' }),
    item({ id: 'c', subject_id: 's2', correct: [0], explanation: 'Потому что так.' }),
    item({ id: 'd', subject_id: 's3', correct: [], answers: [], explanation: 'Без ключа — не в контрольной.' }),
  ];
  it('a keyed question of a ticked subject with words in its explanation', () => {
    expect(hasExplanations(items, ['s1', 's2'])).toBe(true);
    expect(hasExplanations(items, ['s1'])).toBe(false);
    // Without a key a question never reaches a quiz, its explanation neither.
    expect(hasExplanations(items, ['s3'])).toBe(false);
    expect(hasExplanations([], ['s1'])).toBe(false);
  });
});
