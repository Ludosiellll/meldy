import { describe, expect, it } from 'vitest';
import type { HostState } from '../../../lib/live/types';
import { classAccuracy, gameOutcome, questionsClosed } from './Podium';

type S = Pick<HostState, 'state' | 'qi' | 'q_count' | 'result' | 'boss' | 'final'>;
const result = (qi: number) => ({ qi, key: 0, counts: [1, 0], right: 1, healed: 0, phase_changed: null, hits: [], frozen_now: [], thawed: [] });
const base: S = { state: 'ended', qi: -1, q_count: 6, result: null, boss: { hp: 900, hp_max: 1000, phase: 0, defeated: false }, final: null };

describe('how the game ended (the podium’s title)', () => {
  it('counts a question only once it closed', () => {
    expect(questionsClosed({ qi: -1, result: null })).toBe(0);
    expect(questionsClosed({ qi: 3, result: null })).toBe(3); // stopped during question 4
    expect(questionsClosed({ qi: 3, result: result(3) })).toBe(4);
    expect(questionsClosed({ qi: 3, result: result(2) })).toBe(3);
  });

  it('the real server after live_end mid-game (no final): stopped, never «Дедлайн победил»', () => {
    expect(gameOutcome({ ...base, qi: 3 })).toBe('stopped');
    expect(gameOutcome({ ...base, qi: 3, result: result(3) })).toBe('stopped');
    // the fake fills final for ended too: still stopped while questions remain and the monster stands
    expect(gameOutcome({ ...base, qi: 3, result: result(3), final: { won: false, accuracy_pct: 50 } })).toBe('stopped');
  });

  it('closed: ended before any question closed', () => {
    expect(gameOutcome(base)).toBe('closed');
    expect(gameOutcome({ ...base, qi: 0 })).toBe('closed');
  });

  it('won and lost as the contract has them', () => {
    expect(gameOutcome({ ...base, state: 'podium', qi: 5, result: result(5), final: { won: false, accuracy_pct: 40 } })).toBe('lost');
    expect(
      gameOutcome({ ...base, state: 'podium', qi: 2, result: result(2), boss: { hp: 0, hp_max: 1000, phase: 2, defeated: true }, final: { won: true, accuracy_pct: 80 } }),
    ).toBe('won');
    // ended during the last reveal (no final from the server): every question closed
    expect(gameOutcome({ ...base, qi: 5, result: result(5) })).toBe('lost');
    expect(gameOutcome({ ...base, qi: 4, result: result(4), boss: { hp: 0, hp_max: 1000, phase: 2, defeated: true } })).toBe('won');
  });

  it('a stopped game’s accuracy counts only the closed questions', () => {
    const roster = [0, 1, 2, 3].map((i) => ({
      player_id: `p${i}`,
      name: 'Аня',
      look: { body: 'round', colour: 'blue', eyes: 'round', hat: 'none' },
      dmg: 0,
      right: i,
      streak: 0,
      frozen: false,
      joined_at: '',
      answered: false,
    })) as HostState['roster'];
    const s = { ...base, qi: 3, roster, final: { won: false, accuracy_pct: 99 } } as unknown as HostState;
    // 6 right of 4 players × 3 closed questions
    expect(classAccuracy(s, 'stopped')).toBe(50);
    expect(classAccuracy({ ...s, state: 'podium' } as HostState, 'lost')).toBe(99);
  });
});
