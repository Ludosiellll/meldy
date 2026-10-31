import { describe, expect, it } from 'vitest';
import { closeQuestion, damage, healAmount, partialDamage, liveShare, type ClosePlayer } from '../live/rules';
import type { BossPhase } from '../live/types';
import { BOARD_SIZE, board, boardCompare, boardPlaces, deadlineOf, deadlineOk, freshRun, placeOf, scoreAnswer, type BoardEntry, type RunNumbers } from './rules';

/** A small deterministic generator (the cases are the same on every run). */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('scoreAnswer: one person alone plays by the battle’s close (lib/live/rules closeQuestion)', () => {
  it('agrees with closeQuestion for one player on 6000 single-answer cases: right, wrong, none, frozen, every phase, every speed', () => {
    const rand = rng(50);
    for (let n = 0; n < 6000; n += 1) {
      const timeS = [10, 20, 30][Math.floor(rand() * 3)];
      const speed = rand() < 0.75;
      const hpMax = 55 * (3 + Math.floor(rand() * 28));
      const hp = Math.floor(rand() * (hpMax + 1));
      const qPhase = Math.floor(rand() * 3) as BossPhase;
      const streak = Math.floor(rand() * 6);
      const run: RunNumbers = { dmg: Math.floor(rand() * 900), right: streak, streak, best: streak + Math.floor(rand() * 3), frozen: rand() < 0.3, thaws: 0, hp, hpMax, phase: qPhase, timeMs: 0 };
      const what = rand();
      const elapsedMs = Math.floor(rand() * timeS * 1000);
      const player: ClosePlayer = { id: 'p', streak: run.streak, best: run.best, frozen: run.frozen, dmg: run.dmg, right: run.right, thaws: run.thaws, active: true };
      const answers = what < 0.15 ? [] : [{ playerId: 'p', choice: what < 0.6 ? 1 : 0, elapsedMs }];
      const live = closeQuestion({ players: [player], answers, key: 1, optionCount: 4, timeS, speedOn: speed, hp, hpMax, qPhase, phase: qPhase });
      const mine = scoreAnswer(run, answers.length ? { share: what < 0.6 ? 1 : 0, elapsedMs } : null, qPhase, { timeS, speed, calm: false });
      const p = live.players[0];
      const o = live.outcomes.get('p')!;
      expect([mine.run.dmg, mine.run.streak, mine.run.best, mine.run.frozen, mine.run.right, mine.run.thaws, mine.run.hp, mine.run.phase, mine.result.healed, mine.result.correct, mine.result.dmg, mine.result.thawed],
        `case ${n}`).toEqual([p.dmg, p.streak, p.best, p.frozen, p.right, p.thaws, live.hp, live.phase, live.healed, o.correct, o.dmg, o.thawed]);
    }
  });

  it('several right answers: a share of the damage a right answer would deal (partialDamage), no streak, no freeze', () => {
    const run = { ...freshRun(10), streak: 2, best: 2 };
    const share = liveShare([2], [0, 2]);
    const got = scoreAnswer(run, { share, elapsedMs: 2000 }, 0, { timeS: 20, speed: true, calm: false });
    expect(share).toBe(0.5);
    expect(got.result.dmg).toBe(partialDamage(2000, 20, 3, true, 0.5));
    expect(got.run.streak).toBe(0);
    expect(got.run.frozen).toBe(false);
    expect(got.result.correct).toBe(false);
    // frozen: nothing, and still frozen
    const frozen = scoreAnswer({ ...run, frozen: true }, { share, elapsedMs: 2000 }, 0, { timeS: 20, speed: true, calm: false });
    expect([frozen.result.dmg, frozen.run.frozen]).toEqual([0, true]);
  });

  it('the worked example of CONTRACT §3: keys [0, 2], 20 s — the set at 1000 ms deals 98, half of it at 2000 ms 48', () => {
    expect(scoreAnswer(freshRun(6), { share: liveShare([0, 2], [0, 2]), elapsedMs: 1000 }, 0, { timeS: 20, speed: true, calm: false }).result.dmg).toBe(98);
    expect(scoreAnswer(freshRun(6), { share: liveShare([2], [0, 2]), elapsedMs: 2000 }, 0, { timeS: 20, speed: true, calm: false }).result.dmg).toBe(48);
    expect(scoreAnswer(freshRun(6), { share: liveShare([0, 1], [0, 2]), elapsedMs: 2000 }, 0, { timeS: 20, speed: true, calm: false }).run.frozen).toBe(true);
  });

  it('«Без спешки»: 100 a right answer however fast or late, half for half the ticks, nobody freezes', () => {
    const calm = { timeS: 20, speed: false, calm: true };
    const run = { ...freshRun(10), streak: 4, best: 4 };
    expect(scoreAnswer(run, { share: 1, elapsedMs: 0 }, 0, calm).result.dmg).toBe(100);
    expect(scoreAnswer(run, { share: 1, elapsedMs: 19999 }, 0, calm).result.dmg).toBe(100);
    expect(scoreAnswer(run, { share: 0.5, elapsedMs: 100 }, 0, calm).result.dmg).toBe(50);
    expect(scoreAnswer(run, { share: 0, elapsedMs: 100 }, 1, calm).run.frozen).toBe(false);
    expect(scoreAnswer(run, null, 2, calm).run.frozen).toBe(false);
    expect(scoreAnswer(run, null, 2, calm).run.streak).toBe(0);
  });

  it('the boss: 55 HP a question, phase 1 at ⅔ and 2 at ⅓, a miss in phase 2 heals 5 % while it is alive, a defeat stays', () => {
    const run = freshRun(4);
    expect([run.hp, run.hpMax]).toEqual([220, 220]);
    const hit = scoreAnswer(run, { share: 1, elapsedMs: 1000 }, 0, { timeS: 20, speed: true, calm: false });
    expect([hit.result.dmg, hit.run.hp, hit.run.phase, hit.result.phaseChanged]).toEqual([98, 122, 1, 1]);
    const late = { ...run, hp: 50, phase: 2 as BossPhase };
    const miss = scoreAnswer(late, { share: 0, elapsedMs: 1000 }, 2, { timeS: 20, speed: true, calm: false });
    expect([miss.result.healed, miss.run.hp]).toEqual([healAmount(220), 50 + healAmount(220)]);
    const dead = scoreAnswer({ ...late, hp: 0 }, null, 2, { timeS: 20, speed: true, calm: false });
    expect([dead.result.healed, dead.run.hp]).toEqual([0, 0]);
  });

  it('the time: the answer’s server time, the whole time for none', () => {
    const a = scoreAnswer(freshRun(3), { share: 1, elapsedMs: 4321.9 }, 0, { timeS: 10, speed: true, calm: false });
    expect(a.run.timeMs).toBe(4321);
    expect(a.result.dmg).toBe(damage(4321, 10, 1, true));
    expect(scoreAnswer(freshRun(3), null, 0, { timeS: 10, speed: true, calm: false }).run.timeMs).toBe(10_000);
    expect(scoreAnswer(freshRun(3), { share: 1, elapsedMs: 99_999 }, 0, { timeS: 10, speed: true, calm: false }).run.timeMs).toBe(10_000);
  });
});

describe('the table: points, then right answers, then the shorter time; equal on all three share a place', () => {
  const e = (id: string, dmg: number, right: number, timeMs: number, finishedAt: number): BoardEntry => ({ id, dmg, right, timeMs, finishedAt });

  it('orders as challenge_board does', () => {
    const rows = [e('Аня', 500, 4, 30000, 50), e('Боря', 500, 4, 25000, 10), e('Вика', 500, 5, 40000, 70), e('Гоша', 300, 3, 10000, 5), e('Даня', 500, 4, 25000, 40), e('Жора', 0, 0, 80000, 1)];
    const out = board(rows);
    expect(out.map((r) => `${r.place}:${r.id}`)).toEqual(['1:Вика', '2:Боря', '2:Даня', '4:Аня', '5:Гоша', '6:Жора']);
    expect(placeOf(rows[4], rows)).toBe(2);
    expect(placeOf(rows[0], rows)).toBe(4);
  });

  it('keeps the first fifty, and a tie that goes on shares the place', () => {
    const rows = Array.from({ length: 80 }, (_, i) => e(`p${i}`, 100 * (i % 7), i % 3, 1000 * (i % 5), i));
    const out = board(rows);
    expect(out).toHaveLength(BOARD_SIZE);
    for (let i = 1; i < out.length; i += 1) expect(boardCompare(out[i - 1], out[i])).toBeLessThan(0);
    const places = boardPlaces(out);
    out.forEach((r, i) => expect(places[i]).toBe(placeOf(r, rows)));
  });
});

describe('the deadline presets', () => {
  const now = new Date(2026, 10, 3, 18, 40);
  it('an hour, today at 23:59 (tomorrow’s when less than an hour is left), 3 days, a week, two weeks at 23:59', () => {
    expect(deadlineOf('hour', now).getTime() - now.getTime()).toBe(3600_000);
    expect(deadlineOf('today', now).toString()).toBe(new Date(2026, 10, 3, 23, 59).toString());
    expect(deadlineOf('today', new Date(2026, 10, 3, 23, 30)).toString()).toBe(new Date(2026, 10, 4, 23, 59).toString());
    expect(deadlineOf('days3', now).toString()).toBe(new Date(2026, 10, 6, 23, 59).toString());
    expect(deadlineOf('weeks2', now).toString()).toBe(new Date(2026, 10, 17, 23, 59).toString());
  });
  it('is taken from 5 minutes to 30 days ahead', () => {
    expect(deadlineOk(new Date(now.getTime() + 2 * 60_000), now)).toBe(false);
    expect(deadlineOk(new Date(now.getTime() + 10 * 60_000), now)).toBe(true);
    expect(deadlineOk(new Date(now.getTime() + 31 * 24 * 3600_000), now)).toBe(false);
    expect(deadlineOk(new Date('nonsense'), now)).toBe(false);
  });
});
