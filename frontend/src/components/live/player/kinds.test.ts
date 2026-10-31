/**
 * The phone's answers of the new kinds (20261102090000_live_kinds_teams.sql, CONTRACT §3): the ticks of a question of
 * several right answers and a text answer go through `submit` once, with the server's checks; a reload takes them
 * back from `me`; «Тренировать ошибки» (live_practice) — done, sign in first, refused in plain words.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveError, type AnswerInput, type LiveApi, type PlayerState } from '../../../lib/live/types';
import { pickOf, practiceRefusal, type PlayerController } from './controller';
import { controller, fakeApi, newRecorder, recordingPlatform, until, useGameClock, type FakeApi } from './testkit';

let api: FakeApi;
let ctl: PlayerController;
const sent: Array<{ qi: number; answer: AnswerInput }> = [];

/** The fake's game, its questions told as one of the new kinds (the fake draws one right option only). */
function withKind(kind: 'multiple' | 'short', over: Partial<LiveApi> = {}): LiveApi {
  const patch = (st: PlayerState): PlayerState =>
    st.question ? { ...st, question: { ...st.question, kind, ...(kind === 'multiple' ? { multi: 2 } : { options: [] }) } } : st;
  return Object.assign(Object.create(api) as LiveApi, {
    state: async (game: string, token: string, since?: number) => {
      const st = await api.state(game, token, since);
      return 'unchanged' in st ? st : patch(st);
    },
    submit: async (_game: string, _token: string, qi: number, answer: AnswerInput) => {
      sent.push({ qi, answer });
      return { accepted: true as const, answered: 1, now: new Date().toISOString() };
    },
    ...over,
  });
}

async function playUntilOpen(c: PlayerController) {
  await c.start({ pin: '482913' });
  c.setName('Дима');
  await c.confirm();
  await until(() => c.getSnapshot().state?.state === 'countdown' || c.getSnapshot().state?.state === 'open');
  await until(() => c.isOpenNow());
}

beforeEach(() => {
  useGameClock();
  window.sessionStorage.clear();
  window.localStorage.clear();
  api = fakeApi();
  sent.length = 0;
});

afterEach(() => {
  ctl?.dispose();
  vi.useRealTimers();
});

describe('several right answers on the phone', () => {
  it('the ticks go once, sorted and without repeats; a second press sends nothing', async () => {
    ctl = controller(withKind('multiple'), recordingPlatform(newRecorder()));
    await playUntilOpen(ctl);
    const qi = ctl.getSnapshot().state!.qi;
    ctl.answerPicks([2, 0, 2]);
    await until(() => ctl.getSnapshot().pick?.status === 'accepted');
    expect(sent).toEqual([{ qi, answer: { picks: [0, 2] } }]);
    expect(ctl.getSnapshot().pick).toMatchObject({ qi, choice: -1, picks: [0, 2] });
    ctl.answerPicks([1]);
    ctl.answer(1);
    expect(sent).toHaveLength(1);
  });

  it('nothing ticked sends nothing', async () => {
    ctl = controller(withKind('multiple'), recordingPlatform(newRecorder()));
    await playUntilOpen(ctl);
    ctl.answerPicks([]);
    ctl.answerPicks([9]);
    expect(sent).toHaveLength(0);
    expect(ctl.getSnapshot().pick).toBeNull();
  });
});

describe('a text answer on the phone', () => {
  it('goes trimmed, once; a blank one does not go', async () => {
    ctl = controller(withKind('short'), recordingPlatform(newRecorder()));
    await playUntilOpen(ctl);
    ctl.answerText('   ');
    expect(sent).toHaveLength(0);
    ctl.answerText('  Москва  ');
    await until(() => ctl.getSnapshot().pick?.status === 'accepted');
    expect(sent.map((s) => s.answer)).toEqual([{ text: 'Москва' }]);
    expect(ctl.getSnapshot().pick?.text).toBe('Москва');
    ctl.answerText('Питер');
    expect(sent).toHaveLength(1);
  });

  it('a refusal of the kind is said as a late answer (no retry)', async () => {
    ctl = controller(
      withKind('short', { submit: async () => Promise.reject(new LiveError('ML004', 'kind')) }),
      recordingPlatform(newRecorder()),
    );
    await playUntilOpen(ctl);
    ctl.answerText('Москва');
    await until(() => ctl.getSnapshot().pick?.status === 'late');
  });
});

describe('the answer of a new kind after a reload', () => {
  const base = { rev: 1, now: '', state: 'open', mode: 'boss', qi: 3, q_count: 5, time_s: 20, speed: true, players: 2, answered: 1, question: null, boss: { hp: 1, hp_max: 1, phase: 0, defeated: false }, top: null, result: null, final: null, crowd: null } as const;
  const me = { player_id: 'p', name: 'Дима', look: { body: 'round', colour: 'blue', eyes: 'round', hat: 'none' }, dmg: 0, streak: 0, best: 0, frozen: false, place: 1, choice: null } as const;
  it('ticks, a text, a tap or nothing', () => {
    expect(pickOf({ ...base, me: { ...me, picks: [1, 3] } } as unknown as PlayerState)).toMatchObject({ qi: 3, choice: -1, picks: [1, 3], status: 'accepted' });
    expect(pickOf({ ...base, me: { ...me, typed: 'Москва' } } as unknown as PlayerState)).toMatchObject({ choice: -1, text: 'Москва' });
    expect(pickOf({ ...base, me: { ...me, choice: 2 } } as unknown as PlayerState)).toMatchObject({ choice: 2 });
    expect(pickOf({ ...base, me: { ...me, picks: [], typed: '' } } as unknown as PlayerState)).toBeNull();
  });
});

describe('«Тренировать ошибки»', () => {
  async function toPodiumWith(over: Partial<LiveApi>) {
    ctl = controller(Object.assign(Object.create(api) as LiveApi, over), recordingPlatform(newRecorder()));
    await ctl.start({ pin: '482913' });
    ctl.setName('Дима');
    await ctl.confirm();
    await until(() => ctl.getSnapshot().state?.state === 'podium', 600_000, 500);
    await ctl.openReview();
    await until(() => ctl.getSnapshot().review !== null);
  }

  it('done: the exam and how many went', async () => {
    const practice = vi.fn(async () => ({ container_id: 'c-1', joined: false, saved: 3, mistakes: 3 }));
    await toPodiumWith({ practice });
    await ctl.practiceMistakes();
    expect(practice).toHaveBeenCalledTimes(1);
    expect(ctl.getSnapshot().practice).toEqual({ status: 'done', containerId: 'c-1', saved: 3 });
  });

  it('not signed in: sign in first', async () => {
    await toPodiumWith({ practice: async () => Promise.reject(new LiveError('28000', null, 401)) });
    await ctl.practiceMistakes();
    expect(ctl.getSnapshot().practice).toEqual({ status: 'signin' });
  });

  it('refused in plain words', async () => {
    await toPodiumWith({ practice: async () => Promise.reject(new LiveError('ML012', 'practice', 403)) });
    await ctl.practiceMistakes();
    expect(ctl.getSnapshot().practice).toEqual({ status: 'refused', text: practiceRefusal(new LiveError('ML012', 'practice')) });
    expect(practiceRefusal(new LiveError('ML012', 'open'))).toMatch(/контрольная/);
    expect(practiceRefusal(new LiveError('ML012', 'removed'))).toMatch(/убрал/);
    expect(practiceRefusal(new LiveError('ML012', 'full'))).toMatch(/мест/);
  });

  it('back from the sign-in: the review of the game by its link, and practice goes on by itself', async () => {
    const practice = vi.fn(async () => ({ container_id: 'c-2', joined: true, saved: 2, mistakes: 2 }));
    await toPodiumWith({});
    const gameId = ctl.getSnapshot().game!.id;
    ctl.dispose();
    ctl = controller(Object.assign(Object.create(api) as LiveApi, { practice }), recordingPlatform(newRecorder()));
    await ctl.start({ reviewGame: gameId, practice: true });
    expect(ctl.getSnapshot().step).toBe('review');
    expect(practice).toHaveBeenCalledTimes(1);
    expect(ctl.getSnapshot().practice).toEqual({ status: 'done', containerId: 'c-2', saved: 2 });
  });
});
