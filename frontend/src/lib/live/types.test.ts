import { describe, expect, it } from 'vitest';
import { standRounds } from './rules';
import {
  DEFAULT_STAND_EVERY,
  isStandRound,
  MINI_GAMES,
  miniGameOf,
  miniGameSettings,
  mixedOf,
  STAND_EVERY,
  untilStandRound,
  type HostState,
  type PlayerState,
  type Question,
} from './types';

// A mixed game's states as the database returns them (supabase/migrations/20261024090000_live_mixed.sql,
// docs/live/MODE_MIXED.md §4): the new keys appear only in a mixed game.
const QUESTION: Question = {
  qi: 2, text: 'Что делает JOIN?', options: ['Удаляет строки', 'Соединяет таблицы', 'Создаёт индекс', 'Блокирует таблицу'],
  opens_at: '2026-10-24T10:00:03.000Z', closes_at: '2026-10-24T10:00:23.000Z', phase: 0, picture: null, stand: true,
};
const HOST: HostState = {
  rev: 9, now: '2026-10-24T10:00:01.000Z', state: 'countdown', mode: 'boss', qi: 2, q_count: 6, time_s: 20, speed: true,
  players: 4, answered: 0, question: QUESTION, boss: { hp: 1013, hp_max: 1320, phase: 0, defeated: false, kind: 'skeleton' },
  top: null, mixed: { every: 3, rounds: [2, 5] }, pin: '482913', topic: 'Q2xzQ2xzQ2xzQ2xzQ2xzQ2', skipped: 0,
  settings: { mode: 'boss', time_s: 20, speed: true, who: 'pin', chat_names: true, boss: 'skeleton', stand_every: 3 },
  roster: [], answered_ids: [], result: null, final: null,
};
const PLAYER: PlayerState = {
  ...HOST, state: 'reveal',
  me: { player_id: 'p', name: 'Аня', look: { body: 'round', colour: 'blue', eyes: 'round', hat: 'none' }, dmg: 0, streak: 0, best: 0, frozen: true, place: 4, choice: null },
  result: { qi: 2, key: 1, counts: [1, 2, 0, 0], right: 2, healed: 0, phase_changed: 1, stand: true, void: false,
            correct: false, none: true, dmg: 0, thawed: false, frozen: true },
  final: null, crowd: null,
};

describe('the setup’s «Мини-игра с движением»', () => {
  it('maps every pick to the settings and back', () => {
    expect(MINI_GAMES.map((p) => miniGameSettings(p))).toEqual([
      { mode: 'boss', stand_every: 0 },
      { mode: 'boss', stand_every: 3 },
      { mode: 'boss', stand_every: 5 },
      { mode: 'boss', stand_every: 10 },
      { mode: 'stand', stand_every: 0 },
    ]);
    for (const p of MINI_GAMES) expect(miniGameOf(miniGameSettings(p))).toBe(p);
    expect(miniGameOf({ mode: 'boss' })).toBe('none'); // a game made before the setting
    expect(STAND_EVERY).toEqual([0, 3, 5, 10]);
    expect(DEFAULT_STAND_EVERY).toBe(5);
  });
});

describe('a mixed game’s state', () => {
  it('names its movement rounds', () => {
    expect(mixedOf(HOST)).toEqual({ every: 3, rounds: [2, 5] });
    expect(isStandRound(HOST)).toBe(true);
    expect(isStandRound({ ...HOST, question: { ...QUESTION, stand: false } })).toBe(false);
    expect(isStandRound({ ...HOST, question: null })).toBe(false);
    expect(PLAYER.result?.stand && !PLAYER.result.void && PLAYER.result.none && PLAYER.me.frozen).toBe(true);
  });

  it('a plain battle or a broken plan has none', () => {
    const { mixed: _drop, ...battle } = HOST;
    expect(mixedOf(battle)).toBeNull();
    expect(isStandRound({ ...battle, question: { ...QUESTION, stand: undefined } })).toBe(false);
    expect(mixedOf({ mixed: { every: 4, rounds: [3] } as never })).toBeNull();
    expect(mixedOf({ mixed: { every: 3, rounds: [-1] } })).toBeNull();
    expect(mixedOf(null)).toBeNull();
  });

  it('counts the questions until the next movement round', () => {
    const m = mixedOf(HOST);
    expect([0, 1, 2, 3, 5, 6].map((qi) => untilStandRound(m, qi))).toEqual([2, 1, 0, 2, 0, null]);
    expect(untilStandRound(null, 0)).toBeNull();
  });
});

describe('the rule (meldy_private.live_stand_round; supabase/tests/live_mixed.sql has the same cases)', () => {
  it('every Nth question, and the last one of a game shorter than N', () => {
    expect(standRounds(3, 6)).toEqual([2, 5]);
    expect(standRounds(3, 7)).toEqual([2, 5]);
    expect(standRounds(5, 12)).toEqual([4, 9]);
    expect(standRounds(10, 30)).toEqual([9, 19, 29]);
    expect(standRounds(10, 6)).toEqual([5]);
    expect(standRounds(5, 4)).toEqual([3]);
    expect(standRounds(3, 1)).toEqual([0]);
    expect(standRounds(3, 3)).toEqual([2]);
    expect(standRounds(0, 6)).toEqual([]);
  });
});
