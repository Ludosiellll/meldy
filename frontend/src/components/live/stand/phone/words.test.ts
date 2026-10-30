import { describe, expect, it } from 'vitest';
import { ZONE_COLOURS as ARENA_COLOURS } from '../../../../lib/live/three/internal/arena';
import { STAND_LETTERS, type StandLast, type StandMe, type StandState } from '../../../../lib/live/move/protocol';
import { mapHeight, VIEW, MAX_STRETCH } from './map';
import { LETTERS, lastFor, outcomeOf, placeLine, playersLine, points, secondsLeft, streakLine, zoneLine, ZONE_COLOURS } from './words';

const last = (over: Partial<StandLast> = {}): StandLast => ({ qi: 2, choice: 1, ok: true, pts: 620, ms: 4210, fell: false, revived: false, late: false, ...over });

describe('the phone of «Встань на ответ» says it in plain words (MODE_STAND §8)', () => {
  it('uses the projector letters and floor colours, zone index = option index', () => {
    expect([...LETTERS]).toEqual([...STAND_LETTERS]);
    expect([...ZONE_COLOURS]).toEqual([...ARENA_COLOURS]);
  });

  it('tells where the own character stands', () => {
    expect(zoneLine(1, 4)).toBe('Вы на Б');
    expect(zoneLine(-1, 4)).toBe('Бегите к ответу');
    expect(zoneLine(3, 3)).toBe('Здесь нет ответа');
  });

  it('gives the result of a question from the room’s numbers', () => {
    expect(outcomeOf(last(), 1)).toEqual({ tone: 'ok', title: 'Верно', big: '+620', lines: [] });
    expect(outcomeOf(last({ pts: 1160 }), 3).lines).toEqual(['3\u00a0верных подряд']);
    expect(outcomeOf(last({ ok: false, pts: 0, fell: true }), 0)).toMatchObject({ tone: 'fell', title: 'Мимо', big: null, lines: ['Теперь вы призрак.', 'Встаньте на верный ответ, и вы вернётесь.'] });
    expect(outcomeOf(last({ ok: false, pts: 0, choice: null, fell: true }), 0).title).toBe('Вы не встали на ответ');
    expect(outcomeOf(last({ ok: false, pts: 0, fell: false }), 0).lines[0]).toBe('Вы пока призрак.');
    expect(outcomeOf(last({ pts: 380, revived: true }), 0)).toEqual({ tone: 'ghost', title: 'Призрак на верном ответе', big: '+380', lines: ['Скоро вернётесь.'] });
    expect(outcomeOf(last({ late: true, ok: false, pts: 0 }), 0)).toEqual({ tone: 'seen', title: 'Вы зашли позже', big: null, lines: ['Этот вопрос не считаем.'] });
  });

  it('numbers first, with the noun: places, points, streaks, players', () => {
    expect(placeLine(4, 24)).toBe('4 место из 24');
    expect(points(2450)).toBe('2 450 очков');
    expect(points(1)).toBe('1 очко');
    expect(points(22)).toBe('22 очка');
    expect(streakLine(3)).toBe('3 верных подряд');
    expect(playersLine(21)).toBe('Играет 21');
    expect(playersLine(24)).toBe('Играют 24');
  });

  it('shows a result only once the room has sent it for this question', () => {
    const state = { phase: 'reveal', res: { qi: 2 } } as unknown as StandState;
    const me = { last: last() } as StandMe;
    expect(lastFor(state, me)).toEqual(last());
    expect(lastFor(state, { last: last({ qi: 1 }) } as StandMe)).toBeNull();
    expect(lastFor({ ...state, phase: 'open' } as StandState, me)).toBeNull();
  });

  it('counts the seconds on the room’s clock: the full time before the opening, zero at the end', () => {
    expect(secondsLeft(96_250, 81_250 - 3000, 15)).toBe(15);
    expect(secondsLeft(96_250, 81_250, 15)).toBe(15);
    expect(secondsLeft(96_250, 93_300, 15)).toBe(3);
    expect(secondsLeft(96_250, 96_250, 15)).toBe(0);
    expect(secondsLeft(96_250, 99_000, 15)).toBe(0);
    expect(secondsLeft(null, 1, 20)).toBe(20);
  });

  it('gives the map the free height up to 1.6 times the arena’s shape', () => {
    const natural = (360 * VIEW.h) / VIEW.w;
    expect(mapHeight(360, 1000)).toBeCloseTo(natural * MAX_STRETCH);
    expect(mapHeight(360, 200)).toBe(200);
    expect(mapHeight(360, 10)).toBeCloseTo(natural * 0.8);
  });
});
