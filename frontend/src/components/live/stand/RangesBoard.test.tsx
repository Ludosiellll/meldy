/**
 * A number played as ranges on the arena (20261102090200_live_ranges.sql): the round's board says «Встаньте на
 * промежуток с ответом» over the four ranges and, at the reveal, the right range with the true value under it (the
 * room's `num`, else the database's result); the flat projector says the value under its tiles; the phone's review
 * says «Вы стояли на … · верный ответ …»; the room's messages with `num` and `ranges` parse.
 */
import { createRef } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { parseStand, type StandState } from '../../../lib/live/move/protocol';
import type { HostResult, HostState, Question } from '../../../lib/live/types';
import { QuestionPanel } from '../host/Panel';
import { ReviewScreen } from '../player/ReviewScreen';
import type { PlayerController } from '../player/controller';
import { MixedBoard, NO_REVEAL } from './MixedHost';

afterEach(cleanup);

const NB = ' ';
const RANGES = [`меньше${NB}300`, '300–400', '400–500', `больше${NB}500`];
const now = Date.UTC(2026, 9, 31, 9, 0, 0);
const question: Question = {
  qi: 2, text: 'Скорость звука в воздухе?', options: RANGES, opens_at: new Date(now).toISOString(), closes_at: new Date(now + 20000).toISOString(),
  phase: 0, picture: null, stand: true, kind: 'number', unit: 'м/с', ranges: true,
};
const host = (over: Partial<HostState>) =>
  ({
    rev: 3, now: new Date(now).toISOString(), state: 'open', mode: 'boss', qi: 2, q_count: 6, time_s: 20, speed: true, players: 5, answered: 0,
    question, boss: { hp: 800, hp_max: 1100, phase: 0, defeated: false }, top: null, pin: '123456', topic: 't',
    settings: { mode: 'boss', time_s: 20, speed: true, who: 'pin', chat_names: false }, skipped: 0, roster: [], answered_ids: [], result: null, final: null,
    mixed: { every: 3, rounds: [2, 5] }, ...over,
  }) as HostState;
const roomState = (over: Partial<StandState>): StandState => ({
  t: 'stand', k: 'state', phase: 'open', qi: 2, q_count: 6, players: 5, q: { text: question.text, options: RANGES, ranges: true, unit: 'м/с' },
  opens: 0, closes: 20000, floor: 'up', res: null, top: null, acc: null, round: 'stand', ...over,
});
function board(s: HostState, rs: StandState | null) {
  return render(
    <MixedBoard s={s} rs={rs} reveal={NO_REVEAL} nameOf={() => 'x'} timerRef={createRef()} countRefs={{ current: [] }} frozenRef={createRef()}
      frozenPillRef={createRef()} loading={false} failed={false} lost={false} />,
  );
}

describe('a range round on the projector', () => {
  it('open: the ranges on the board and «Встаньте на промежуток с ответом»', () => {
    const view = board(host({}), roomState({}));
    expect(view.container.querySelector('.lvbt-multi')?.textContent).toBe('Встаньте на промежуток с ответом');
    expect([...view.container.querySelectorAll('.lvst-opt-text')].map((x) => x.textContent)).toEqual(RANGES);
  });

  it('the reveal: the right range and the true value under it, from the room', () => {
    const res = { qi: 2, key: 1, counts: [1, 3, 1, 0], stood: 3, of: 5, fastest: null, fell: [], back: [], at: 0, back_at: 0, num: { forms: ['343'], tolerance: 10, unit: 'м/с' } };
    const view = board(host({ state: 'reveal' }), roomState({ phase: 'reveal', res, floor: 'down' }));
    expect(view.container.querySelector('.lvst-answer')?.textContent).toContain('300–400');
    expect(view.container.querySelector('.lvbt-range-value')?.textContent).toBe(`Ответ: 343${NB}±${NB}10${NB}м/с`);
  });

  it('the reveal without the room: the database\'s result says the value', () => {
    const result: HostResult = { qi: 2, key: 1, counts: [1, 3, 1, 0], right: 3, healed: 0, phase_changed: null, ranges: true, forms: ['343'], tolerance: 10, unit: 'м/с', hits: [], frozen_now: [], thawed: [] };
    const view = board(host({ state: 'reveal', result }), null);
    expect(view.container.querySelector('.lvbt-range-value')?.textContent).toBe(`Ответ: 343${NB}±${NB}10${NB}м/с`);
  });

  it('a one-answer round says neither', () => {
    const one = { ...question, options: ['a', 'b', 'c', 'd'], kind: undefined, unit: undefined, ranges: undefined };
    const view = board(host({ question: one }), roomState({ q: { text: one.text, options: one.options } }));
    expect(view.container.querySelector('.lvbt-multi')).toBeNull();
    expect(view.container.querySelector('.lvbt-range-value')).toBeNull();
  });

  it('the flat projector: the tiles are the ranges; the value under them at the reveal', () => {
    const open = render(<QuestionPanel question={question} result={null} players={5} answered={0} opensAt={now} closesAt={now + 20000} />);
    expect(open.container.querySelectorAll('.lvh-tiles > *').length).toBeGreaterThanOrEqual(4);
    expect(open.container.querySelector('.lvh-number')).toBeNull();
    cleanup();
    const result: HostResult = { qi: 2, key: 1, counts: [1, 3, 1, 0], right: 3, healed: 0, phase_changed: null, ranges: true, forms: ['343'], tolerance: 10, unit: 'м/с', hits: [], frozen_now: [], thawed: [] };
    const shut = render(<QuestionPanel question={question} result={result} players={5} answered={5} opensAt={now} closesAt={now + 20000} />);
    expect(shut.container.querySelector('.lvh-number-key')?.textContent).toBe(`Верный ответ: 343${NB}±${NB}10${NB}м/с`);
    expect(shut.container.querySelector('svg.lvnl')).toBeNull();
  });
});

describe('the room\'s messages of a range round', () => {
  it('parse with ranges and the true value; a broken value is refused', () => {
    const base = { t: 'stand', k: 'state', phase: 'reveal', qi: 2, q_count: 6, players: 5, opens: 0, closes: 1, floor: 'down', top: null, acc: null, round: 'stand',
      q: { text: 'x', options: RANGES, ranges: true, unit: 'м/с' } };
    const res = { qi: 2, key: 1, counts: [0, 1, 0, 0], stood: 1, of: 1, fastest: null, fell: [], back: [], at: 0, back_at: 0 };
    const ok = parseStand({ ...base, res: { ...res, num: { forms: ['343'], tolerance: 10, unit: 'м/с' } } }) as StandState;
    expect(ok.res?.num?.forms).toEqual(['343']);
    expect(ok.q?.ranges).toBe(true);
    expect(parseStand({ ...base, res: { ...res, num: '343' } })).toBeNull();
    expect(parseStand({ ...base, res })).not.toBeNull();
  });
});

describe('the phone\'s review of a range round', () => {
  it('«Вы стояли на … · верный ответ …», the right range when missed; none stood', () => {
    const items = [
      { qi: 0, text: 'Скорость звука?', options: RANGES, key: 1, choice: 2, correct: false, kind: 'number' as const, ranges: true, stand: true, forms: ['343'], tolerance: 10, unit: 'м/с', typed: null },
      { qi: 1, text: 'Байт?', options: RANGES, key: 3, choice: 3, correct: true, kind: 'number' as const, ranges: true, stand: true, forms: ['1024'], tolerance: null, unit: null, typed: null },
      { qi: 2, text: 'Бит?', options: RANGES, key: 0, choice: null, correct: false, kind: 'number' as const, ranges: true, stand: true, forms: ['8'], tolerance: null, unit: null, typed: null },
    ];
    const view = render(<ReviewScreen ctl={{} as PlayerController} review={{ items }} error={null} standalone back="final" />);
    const li = view.container.querySelectorAll('.lp-rv-item');
    expect([...li].map((x) => x.querySelector('.lp-rv-badge')?.textContent)).toEqual(['Неверно', 'Верно', 'Не встали на ответ']);
    expect(li[0].textContent).toContain(`Вы стояли на 400–500 · верный ответ 343${NB}±${NB}10${NB}м/с`);
    expect(li[0].textContent).toContain('Верный промежуток: 300–400');
    expect(li[1].textContent).toContain(`Вы стояли на больше${NB}500 · верный ответ 1024`);
    expect(li[1].textContent).not.toContain('Верный промежуток');
    expect(li[2].textContent).toContain('Вы не встали ни на один промежуток · верный ответ 8');
  });
});
