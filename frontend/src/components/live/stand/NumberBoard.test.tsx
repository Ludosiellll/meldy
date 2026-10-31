/**
 * A number question on the projector (20261102090100_live_numbers.sql, CONTRACT §15): «Введите число на телефоне» and
 * the unit while it is open; at the reveal the right number with its tolerance and unit, the number line (the right
 * value's pin and band, a stem per value typed, green inside the band and coral outside, the wild answers counted at
 * its ends) and «Ближе всех»; no option tiles. The flat projector shows the key and the same line.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { HostResult, HostState, Question } from '../../../lib/live/types';
import { logState } from '../host/hostSession';
import { QuestionPanel } from '../host/Panel';
import { ReviewSheet } from '../host/Sheets';
import { TapBoard } from './BattleHost';
import { NO_REVEAL } from './MixedHost';
import { NumberLine } from './NumberLine';

afterEach(cleanup);

const NB = ' ';
const now = Date.UTC(2026, 9, 31, 9, 0, 0);
const question: Question = {
  qi: 2, text: 'Высота башни в метрах?', options: [], opens_at: new Date(now).toISOString(), closes_at: new Date(now + 20000).toISOString(),
  phase: 0, picture: null, kind: 'number', unit: 'м',
};
const result: HostResult = {
  qi: 2, key: -1, counts: [], right: 3, healed: 0, phase_changed: null, forms: ['42'], tolerance: 0.5, unit: 'м',
  tops: [{ text: '42', n: 2, ok: true }, { text: '42.5', n: 1, ok: true }, { text: '41', n: 4, ok: false }],
  spread: [['-900', 1], ['38', 1], ['41', 4], ['42', 2], ['42.5', 1], ['47', 1], ['9000', 1]],
  hits: [], frozen_now: [], thawed: [],
};

function host(over: Partial<HostState>): HostState {
  return {
    rev: 3, now: new Date(now).toISOString(), state: 'open', mode: 'boss', qi: 2, q_count: 6, time_s: 20, speed: true, players: 11, answered: 4,
    question, boss: { hp: 800, hp_max: 1100, phase: 0, defeated: false }, top: null, pin: '123456', topic: 't', settings: { mode: 'boss', time_s: 20, speed: true, who: 'pin', chat_names: false },
    skipped: 0, roster: [], answered_ids: [], result: null, final: null, ...over,
  } as HostState;
}

const board = (s: HostState) =>
  render(<TapBoard s={s} q={question} pics={{ stem: undefined, options: [], any: false }} reveal={NO_REVEAL} beat={null} opensAt={now} closesAt={now + 20000} stoppedAt={null} />);

describe('a number question on the 3D projector', () => {
  it('open: «Введите число на телефоне» and the unit; no option tiles', () => {
    const view = board(host({}));
    expect(view.container.querySelector('.lvbt .lvst-hint')?.textContent).toBe('Введите число на телефоне');
    expect(view.container.querySelector('.lvbt-multi')?.textContent).toBe(`Ответ в${NB}м`);
    expect(view.container.querySelector('.lvbt-options')).toBeNull();
    expect(view.container.querySelector('.lvnl')).toBeNull();
  });

  it('the reveal: the right number with its tolerance and unit, the line, «Ближе всех»', () => {
    const view = board(host({ state: 'reveal', result }));
    expect(view.container.querySelector('.lvbt .lvst-answer')?.textContent).toBe(`42${NB}±${NB}0,5${NB}м`);
    const svg = view.container.querySelector('svg.lvnl')!;
    expect(svg.getAttribute('aria-label')).toBe('Числовая прямая: верный ответ 42 м');
    // a stem per value on the line: 38, 41, 42, 42.5, 47 (−900 and 9000 counted at the ends)
    const dots = [...svg.querySelectorAll('.lvnl-dot circle')].map((c) => c.getAttribute('fill'));
    expect(dots).toEqual(['#ff8a7a', '#ff8a7a', '#36c47c', '#36c47c', '#ff8a7a']);
    expect([...svg.querySelectorAll('text')].map((t) => t.textContent)).toEqual(expect.arrayContaining(['← 1', '1 →', '4', '2']));
    expect(svg.querySelectorAll('rect')).toHaveLength(1);
    const near = [...view.container.querySelectorAll('.lvbt-near li')];
    expect(near.map((li) => li.textContent)).toEqual([`42${NB}м2`, `42,5${NB}м1`, `41${NB}м4`]);
    expect(near.map((li) => li.hasAttribute('data-ok'))).toEqual([true, true, false]);
    expect(view.container.querySelector('.lvbt-options')).toBeNull();
  });

  it('nobody typed a number: the key and «Ответов не было»', () => {
    const view = board(host({ state: 'reveal', result: { ...result, tops: [], spread: [], right: 0 } }));
    expect(view.container.querySelector('.lvbt .lvst-answer')?.textContent).toBe(`42${NB}±${NB}0,5${NB}м`);
    expect(view.container.querySelector('.lvbt-line .lvbt-tops-none')?.textContent).toBe('Ответов не было');
    expect(view.container.querySelector('.lvnl')).toBeNull();
  });
});

describe('the number line on its own', () => {
  it('an exact answer (no tolerance): a pin and no band; several accepted values: a pin each', () => {
    const one = render(<NumberLine forms={['1024']} tolerance={null} unit={null} spread={[['1000', 3], ['1024', 5]]} width={600} />);
    expect(one.container.querySelectorAll('rect')).toHaveLength(0);
    expect(one.container.querySelectorAll('path')).toHaveLength(1);
    cleanup();
    const two = render(<NumberLine forms={['9.8', '9.81']} tolerance={0.01} unit="м/с²" spread={[['9.8', 3]]} width={600} />);
    expect(two.container.querySelectorAll('path')).toHaveLength(2);
    expect(two.container.querySelector('svg')?.getAttribute('aria-label')).toBe('Числовая прямая: верный ответ 9,8 или 9,81 м/с²');
  });
});

describe('a number question on the flat projector', () => {
  it('the unit while open; the key and the line at the reveal', () => {
    const open = render(<QuestionPanel question={question} result={null} players={11} answered={4} opensAt={now} closesAt={now + 20000} />);
    expect(open.container.querySelector('.lvh-number')?.textContent).toBe(`Ответ — число в${NB}м: его вводят на телефоне`);
    cleanup();
    const shut = render(<QuestionPanel question={question} result={result} players={11} answered={7} opensAt={now} closesAt={now + 20000} />);
    expect(shut.container.querySelector('.lvh-number-key')?.textContent).toBe(`Верный ответ: 42${NB}±${NB}0,5${NB}м`);
    expect(shut.container.querySelector('.lvh-number svg.lvnl')).not.toBeNull();
  });
});

describe('the teacher\'s «Разбор» after the game', () => {
  it('a number question logged with its tolerance and unit; the sheet says the right number', () => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    let log = logState('g-n', [], host({}));
    expect(log[0]).toMatchObject({ qi: 2, kind: 'number', forms: null, unit: 'м', tolerance: null });
    log = logState('g-n', log, host({ state: 'reveal', result }));
    expect(log[0]).toMatchObject({ qi: 2, kind: 'number', forms: ['42'], unit: 'м', tolerance: 0.5, right: 3 });
    const view = render(<ReviewSheet log={log} roster={[]} asked={3} onClose={() => {}} />);
    expect(view.baseElement.textContent).toContain(`Верный ответ: 42${NB}±${NB}0,5${NB}м`);
  });
});
