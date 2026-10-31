/**
 * «Без спешки» (20261106090000_live_calm.sql) on the screens: the phone's lobby, battle line and result sheet say that
 * only right answers count (no series, no seconds, no ice); the projector's board says it on every question and names
 * nobody the fastest; the lobby's settings line says it. A game without it reads as before.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostState, PlayerState, Question } from '../../../lib/live/types';
import { LOBBY } from '../host/copy';
import { TapBoard } from '../stand/BattleHost';
import { NO_REVEAL } from '../stand/MixedHost';
import { Battle, CALM, missWords } from './Battle';
import type { PlayerController } from './controller';
import { CALM_LINE, Lobby } from './Lobby';

afterEach(cleanup);

const look = { body: 'round', colour: 'blue', eyes: 'round', hat: 'none' } as const;
const now = Date.now();
const q: Question = { qi: 1, text: 'Сколько будет 2 + 2?', options: ['3', '4', '5', '6'], opens_at: new Date(now - 2000).toISOString(), closes_at: new Date(now + 18000).toISOString(), phase: 1, picture: null };
function stateOf(over: Partial<PlayerState>): PlayerState {
  return {
    rev: 5, now: new Date().toISOString(), state: 'open', mode: 'boss', qi: 1, q_count: 5, time_s: 20, speed: false, players: 4, answered: 0,
    question: q, boss: { hp: 900, hp_max: 1100, phase: 1, defeated: false }, top: null,
    me: { player_id: 'p1', name: 'Дима', look, dmg: 0, streak: 2, best: 2, frozen: false, place: 1, choice: null },
    result: null, final: null, crowd: null, ...over,
  };
}
const ctl = { answer: vi.fn(), answerPicks: vi.fn(), answerText: vi.fn(), picture: undefined } as unknown as PlayerController;
const battle = (st: PlayerState) =>
  render(<Battle ctl={ctl} st={st} question={st.question!} pick={null} answered={null} hpFrom={null} frozenBefore={false} late={false} offsetMs={0} look={look} haptic={() => {}} />);
const result = { qi: 1, key: 1, counts: [0, 3, 1, 0], right: 3, healed: 0, phase_changed: null, none: false, thawed: false, frozen: false };

describe('«Без спешки» on the phone', () => {
  it('the lobby says it', () => {
    const view = render(<Lobby ctl={ctl} look={look} name="Дима" players={4} pin="123456" crowd={[]} canEdit={false} calm />);
    expect(view.container.querySelector('.lp-calm')?.textContent).toBe(CALM_LINE);
    expect(view.container.querySelector('.lp-card')?.textContent).toContain('ошибка ничего не отнимает');
    expect(view.container.querySelector('.lp-card')?.textContent).not.toContain('заморозка');
    cleanup();
    const plain = render(<Lobby ctl={ctl} look={look} name="Дима" players={4} pin="123456" crowd={[]} canEdit={false} />);
    expect(plain.container.querySelector('.lp-calm')).toBeNull();
    expect(plain.container.querySelector('.lp-card')?.textContent).toContain('заморозка до следующего верного');
  });

  it('the question: no series bonus, no ice rule even with the boss angry', () => {
    const view = battle(stateOf({ calm: true }));
    expect(view.container.querySelector('.lp-me-text')?.textContent).toBe(CALM.line);
    expect(view.container.querySelector('.lp-rule')).toBeNull();
    cleanup();
    const plain = battle(stateOf({}));
    expect(plain.container.querySelector('.lp-me-text')?.textContent).toMatch(/^Серия 2/);
    expect(plain.container.querySelector('.lp-rule')?.textContent).toMatch(/замёрзнет/);
  });

  it('the sheet: «Без спешки» instead of the series and the seconds; a miss freezes nobody', () => {
    const right = battle(stateOf({ calm: true, state: 'reveal', result: { ...result, correct: true, dmg: 100 } }));
    const sheet = right.container.querySelector('.lp-sheet')!.textContent!;
    expect(sheet).toContain('−100');
    expect(sheet).toContain('Без спешки');
    expect(sheet).not.toContain('Серия');
    cleanup();
    const wrong = battle(stateOf({ calm: true, state: 'reveal', result: { ...result, correct: false, dmg: 0 } }));
    expect(wrong.container.querySelector('.lp-sheet')!.textContent).toContain(CALM.miss);
    expect(missWords({ none: true, frozen: false }, false, true)).toEqual({ title: 'Не успели', line: CALM.miss });
  });
});

describe('«Без спешки» on the projector', () => {
  const host = (over: Partial<HostState>) =>
    ({
      rev: 3, now: new Date(now).toISOString(), state: 'open', mode: 'boss', qi: 1, q_count: 5, time_s: 20, speed: false, players: 4, answered: 1,
      question: q, boss: { hp: 900, hp_max: 1100, phase: 1, defeated: false }, top: null, pin: '123456', topic: 't',
      settings: { mode: 'boss', time_s: 20, speed: false, who: 'pin', chat_names: false, calm: true }, skipped: 0,
      roster: [{ player_id: 'p1', name: 'Дима', look, dmg: 100, right: 1, streak: 1, frozen: false, joined_at: new Date(now - 60000).toISOString(), answered: true }],
      answered_ids: [], result: null, final: null, calm: true, ...over,
    }) as HostState;
  const board = (s: HostState) => render(<TapBoard s={s} q={q} pics={{ stem: undefined, options: [], any: false }} reveal={NO_REVEAL} beat={null} opensAt={now} closesAt={now + 20000} stoppedAt={null} />);

  it('every question says it; the reveal names nobody the fastest', () => {
    const open = board(host({}));
    expect(open.container.querySelector('.lvbt-calm')?.textContent).toBe('Без спешки: очки только за верные ответы');
    cleanup();
    const shut = board(host({ state: 'reveal', result: { ...result, hits: [{ player_id: 'p1', dmg: 100, hp_after: 800 }], frozen_now: [], thawed: [] } }));
    expect(shut.container.querySelector('.lvst-fastest')).toBeNull();
    cleanup();
    const plain = board(host({ calm: undefined, state: 'reveal', result: { ...result, hits: [{ player_id: 'p1', dmg: 75, hp_after: 825 }], frozen_now: [], thawed: [] } }));
    expect(plain.container.querySelector('.lvbt-calm')).toBeNull();
    expect(plain.container.querySelector('.lvst-fastest')?.textContent).toMatch(/Быстрее всех Дима/);
  });

  it('the lobby\'s settings line', () => {
    expect(LOBBY.settings(20, false, false, undefined, true)).toBe('20 с на вопрос · без спешки: очки только за верные ответы · все по PIN');
    expect(LOBBY.settings(20, false, false)).toBe('20 с на вопрос · только верность · все по PIN');
  });
});
