/**
 * The battle with movement rounds on the screens (docs/live/MODE_MIXED.md §8): when the arena is on, how a round's
 * reveal plays on the projector, and the phone's own lines — against the messages of contracts/live/mixed_messages.json.
 */
import { describe, expect, it } from 'vitest';
import messages from '../../../../../contracts/live/mixed_messages.json';
import type { StandLast, StandResult, StandState } from '../../../lib/live/move/protocol';
import type { PlayerResult, Question } from '../../../lib/live/types';
import { MIXED, SETUP } from '../host/copy';
import { missWords } from '../player/Battle';
import { miniGameLine } from '../player/Lobby';
import { arenaOn, hpBefore, lastOfResult, mixedOutcome, revealPlan, strongest, type DbView } from './mixed';

const question = (qi: number, stand: boolean): Question => ({ qi, text: 'Вопрос', options: ['А', 'Б'], opens_at: '', closes_at: '', phase: 0, picture: null, stand });
const db = (state: DbView['state'], qi: number, stand: boolean): DbView => ({ state, qi, question: qi >= 0 ? question(qi, stand) : null });
const room = (phase: StandState['phase'], qi: number, round: StandState['round']): StandState => ({ ...(messages.countdown as unknown as StandState), phase, qi, round });

describe('when the arena is on', () => {
  it('the database alone: a movement round from its countdown to its reveal, never a button question', () => {
    expect(arenaOn(db('countdown', 2, true), null)).toBe(true);
    expect(arenaOn(db('open', 2, true), null)).toBe(true);
    expect(arenaOn(db('reveal', 2, true), null)).toBe(true);
    expect(arenaOn(db('leaderboard', 2, true), null)).toBe(false);
    expect(arenaOn(db('open', 1, false), null)).toBe(false);
    expect(arenaOn(db('lobby', -1, false), null)).toBe(false);
  });

  it('the room leads when it knows the question first (the teacher\'s click), the database when the room is behind', () => {
    // the room already opened the round, the database's poll has not come yet
    expect(arenaOn(db('leaderboard', 1, false), room('countdown', 2, 'stand'))).toBe(true);
    // the teacher moved on: the room says leaderboard before the database's poll
    expect(arenaOn(db('reveal', 2, true), room('leaderboard', 2, 'stand'))).toBe(false);
    // the room is behind (it has not heard the click yet): the database decides
    expect(arenaOn(db('countdown', 2, true), room('leaderboard', 1, 'tap'))).toBe(true);
    expect(arenaOn(db('countdown', 3, false), room('reveal', 2, 'stand'))).toBe(false);
    // a button question in a mixed room
    expect(arenaOn(db('open', 1, false), room('open', 1, 'tap'))).toBe(false);
  });

  it('a stand room\'s message (no round) leaves it to the database', () => {
    const stand = { ...room('lobby', -1, null) } as StandState;
    delete (stand as { round?: unknown }).round;
    expect(arenaOn(db('lobby', -1, false), stand)).toBe(false);
  });
});

describe('the projector\'s reveal', () => {
  const res = (messages.reveal_host as unknown as StandState).res as StandResult;

  it('starts from the HP before the hits and lands them one by one, then the news of the phase', () => {
    expect(res.hits?.length).toBeGreaterThan(0);
    const plan = revealPlan(res);
    expect(plan.from).toBe(hpBefore(res));
    expect(plan.from).toBe(res.hits![0][2] + res.hits![0][1]);
    expect(plan.hits.map((h) => h.hp)).toEqual(res.hits!.map((h) => h[2]));
    expect(plan.hits.map((h) => h.at)).toEqual([...plan.hits.map((h) => h.at)].sort((a, b) => a - b));
    expect(plan.blow).toBeGreaterThan(plan.hits[plan.hits.length - 1].at);
    // the shared reveal changes the phase (worked example A): the news after the blow
    expect(res.phase_changed).toBe(1);
    expect(plan.news).toBeGreaterThan(plan.blow!);
    expect(plan.end).toBeGreaterThan(plan.news!);
  });

  it('thirty hits still land within about two and a half seconds; a void round plays nothing', () => {
    const many: StandResult = { ...res, hits: Array.from({ length: 30 }, (_, i) => [i, 100, 3000 - 100 * (i + 1)] as [number, number, number]), phase_changed: null, healed: 0, defeated: false };
    const plan = revealPlan(many);
    expect(plan.hits[29].at - plan.hits[0].at).toBeLessThanOrEqual(2500);
    expect(plan.news).toBeNull();
    const nothing = revealPlan({ ...res, void: true });
    expect(nothing.hits).toEqual([]);
    expect(nothing.blow).toBeNull();
    expect(nothing.news).toBeNull();
  });

  it('without hits the HP before is the HP before the heal; the three who hit hardest, the first first on a tie', () => {
    expect(hpBefore({ hits: [], hp: 238, healed: 66 })).toBe(172);
    expect(hpBefore({ hp: undefined, healed: 0 })).toBeNull();
    expect(strongest({ hits: [[1, 50, 0], [2, 141, 0], [3, 141, 0], [4, 200, 0]] })).toEqual([
      { id: 4, dmg: 200 },
      { id: 2, dmg: 141 },
      { id: 3, dmg: 141 },
    ]);
  });
});

describe('the phone\'s own round', () => {
  const last = (part: Partial<StandLast>): StandLast => ({ qi: 2, choice: 1, ok: false, pts: 0, ms: null, fell: false, revived: false, late: false, ...part });
  const nb = (n: number) => String(n);

  it('says each outcome in its own words (MODE_MIXED §8)', () => {
    expect(mixedOutcome(last({ ok: true, pts: 141 }), false, nb)).toMatchObject({ tone: 'ok', title: 'Верно', big: '−141' });
    expect(mixedOutcome(last({ ok: true, thawed: true }), false, nb)).toMatchObject({ tone: 'thaw', title: 'Лёд растаял', big: null });
    expect(mixedOutcome(last({ froze: true, fell: true }), true, nb)).toMatchObject({ tone: 'frozen', title: 'Мимо', lines: ['Вы заморожены.', 'Ответьте верно, чтобы оттаять.'] });
    expect(mixedOutcome(last({ choice: null, froze: true, fell: true }), true, nb)).toMatchObject({ title: 'Вы не встали ни на один ответ', lines: ['Вы заморожены.', 'Ответьте верно, чтобы оттаять.'] });
    expect(mixedOutcome(last({ choice: 0, fell: true }), true, nb).lines[0]).toBe('Вы всё ещё заморожены.');
    expect(mixedOutcome(last({ late: true }), false, nb)).toMatchObject({ tone: 'seen', title: 'Вы зашли позже', lines: ['Этот вопрос не считаем.'] });
    expect(mixedOutcome(last({ void: true }), false, nb)).toMatchObject({ tone: 'void', title: 'Мини-игра не засчитана' });
  });

  it('reads the room\'s shared messages and, without the room, the database\'s result', () => {
    const right = messages.me_right as unknown as { last: StandLast; frozen: boolean };
    expect(mixedOutcome(right.last, right.frozen, nb)).toMatchObject({ title: 'Верно', big: '−150' });
    const none = messages.me_none as unknown as { last: StandLast; frozen: boolean };
    expect(mixedOutcome(none.last, none.frozen, nb)).toMatchObject({ title: 'Вы не встали ни на один ответ', lines: ['Вы заморожены.', 'Ответьте верно, чтобы оттаять.'] });
    const r: PlayerResult = { qi: 2, key: 1, counts: [1, 2, 0, 0], right: 2, healed: 0, phase_changed: null, stand: true, void: false, correct: false, none: true, dmg: 0, thawed: false, frozen: true };
    expect(lastOfResult(r, null, false)).toMatchObject({ choice: null, ok: false, froze: true, fell: true, void: false });
    expect(lastOfResult({ ...r, correct: true, none: false, dmg: 141, frozen: false }, 1, false)).toMatchObject({ choice: 1, ok: true, pts: 141, froze: false });
    expect(lastOfResult({ ...r, void: true }, null, true)).toMatchObject({ void: true, fell: false, froze: false });
  });
});

describe('the battle\'s sheet after a movement round', () => {
  it('says «Не встали на ответ» or «Мимо» there, the battle\'s words on a button question', () => {
    expect(missWords({ none: true, frozen: true, stand: true }, true)).toEqual({ title: 'Не встали на ответ', line: 'Вы заморожены. Ответьте верно на следующий вопрос, чтобы оттаять.' });
    expect(missWords({ none: false, frozen: true, stand: true }, false)).toEqual({ title: 'Мимо', line: 'Вы всё ещё заморожены. Ответьте верно на следующий вопрос, чтобы оттаять.' });
    expect(missWords({ none: true, frozen: true, stand: false }, true).title).toBe('Не успели');
    expect(missWords({ none: false, frozen: false }, false)).toEqual({ title: 'Неверно', line: 'Серия начнётся заново со следующего верного ответа.' });
  });
});

describe('the words of the mini-game', () => {
  it('the setup names the questions, or the rule past four of them', () => {
    expect(SETUP.mixedAbout(3, [2, 5])).toBe('Весь класс бьёт монстра верными ответами. На вопросах 3 и 6 ученики бегут на верный ответ.');
    expect(SETUP.mixedAbout(10, [5])).toBe('Весь класс бьёт монстра верными ответами. На вопросе 6 ученики бегут на верный ответ.');
    expect(SETUP.mixedAbout(3, [2, 5, 8, 11, 14])).toBe('Весь класс бьёт монстра верными ответами. На каждом 3-м вопросе ученики бегут на верный ответ.');
  });

  it('the projector and the phone say when the mini-games come', () => {
    expect(MIXED.soon(0)).toBe('Следующий вопрос с мини-игрой');
    expect(MIXED.soon(1)).toBe('Мини-игра через 1 вопрос');
    expect(MIXED.soon(2)).toBe('Мини-игра через 2 вопроса');
    expect(MIXED.soon(5)).toBe('Мини-игра через 5 вопросов');
    expect(MIXED.rounds([2, 5])).toBe('мини-игра на вопросах 3 и 6');
    expect(MIXED.rounds([9])).toBe('мини-игра на вопросе 10');
    expect(miniGameLine([2, 5, 8])).toBe('На вопросах 3, 6 и 9 будет мини-игра. Там вы бегаете по арене.');
    expect(miniGameLine([4])).toBe('На вопросе 5 будет мини-игра. Там вы бегаете по арене.');
  });
});
