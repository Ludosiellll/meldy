import { describe, expect, it } from 'vitest';
import shared from '../../../../../contracts/live/mixed_messages.json';
import {
  arenaLive,
  decodeSnapshot,
  encodeSnapshot,
  F_GHOST,
  F_ICE,
  isGhost,
  isIced,
  parseStand,
  zoneOption,
  ZONE_SHIFT,
  type StandHello,
  type StandMe,
  type StandState,
} from './protocol';

// The messages of a mixed room as backend/live_move_mixed.py writes them (contracts/live/mixed_messages.json, checked by
// backend/tests/test_live_mixed.py): docs/live/MODE_MIXED.md §4.
describe('a mixed room’s messages (the battle with movement rounds)', () => {
  it('hello carries the plan', () => {
    const hello = parseStand(shared.hello) as StandHello;
    expect(hello).not.toBeNull();
    expect(hello.mixed).toEqual({ every: 3, rounds: [2, 5] });
    expect(hello.time_s).toBe(20);
  });

  it('a button question: round tap, no question, no arena', () => {
    const tap = parseStand(shared.tap) as StandState;
    expect(tap.round).toBe('tap');
    expect(tap.q).toBeNull();
    expect(tap.opens).toBeNull();
    expect(arenaLive(tap)).toBe(false);
  });

  it('a movement round: its question and times, the arena on', () => {
    const cd = parseStand(shared.countdown) as StandState;
    expect(cd.round).toBe('stand');
    expect(cd.q?.options).toHaveLength(4);
    expect((cd.closes ?? 0) - (cd.opens ?? 0)).toBe(20_000);
    expect(arenaLive(cd)).toBe(true);
    expect(JSON.stringify(shared.countdown)).not.toContain('key');
  });

  it('the reveal: everyone off the right zone falls and all of them come back; the battle’s numbers', () => {
    const r = (parseStand(shared.reveal) as StandState).res!;
    expect(r.key).toBe(1);
    expect(r.back).toEqual(r.fell);
    expect(r.void).toBe(false);
    expect(r.thawed).toEqual([3]);
    expect(r.froze).toEqual([2, 4]);
    expect([r.hp, r.hp_max, r.phase, r.phase_changed, r.healed, r.defeated]).toEqual([849, 1320, 1, 1, 0, false]);
    expect(r.pts).toBeUndefined();
    expect(r.hits).toBeUndefined();
    const host = (parseStand(shared.reveal_host) as StandState).res!;
    expect(host.pts).toEqual([[1, 150]]);
    expect(host.hits).toEqual([[1, 150, 849]]);
    expect(arenaLive(parseStand(shared.reveal) as StandState)).toBe(true);
  });

  it('me: the battle’s points, the freeze, never a ghost', () => {
    const right = parseStand(shared.me_right) as StandMe;
    expect([right.pts, right.frozen, right.ghost, right.last?.pts, right.last?.ok, right.last?.fell]).toEqual([372, false, false, 150, true, false]);
    const none = parseStand(shared.me_none) as StandMe;
    expect([none.frozen, none.ghost, none.last?.choice, none.last?.froze, none.last?.fell, none.last?.void]).toEqual([true, false, null, true, true, false]);
  });

  it('a broken mixed field is ignored', () => {
    expect(parseStand({ ...shared.tap, round: 'dance' })).toBeNull();
    expect(parseStand({ ...shared.hello, mixed: { every: 3 } })).toBeNull();
    expect(parseStand({ ...shared.hello, mixed: null })).toBeNull();
    expect(parseStand({ ...shared.reveal, res: { ...shared.reveal.res, void: 'no' } })).toBeNull();
    expect(parseStand({ ...shared.reveal, res: { ...shared.reveal.res, froze: 2 } })).toBeNull();
  });

  it('the arena is on in a stand room always; in a mixed room only in a movement round’s countdown, open and reveal', () => {
    const stand = { ...(shared.countdown as unknown as StandState), round: undefined, phase: 'lobby' as const };
    expect(arenaLive(stand)).toBe(true);
    for (const phase of ['lobby', 'leaderboard', 'podium', 'ended'] as const)
      expect(arenaLive({ ...(shared.countdown as unknown as StandState), phase })).toBe(false);
    expect(arenaLive({ ...(shared.countdown as unknown as StandState), phase: 'open' })).toBe(true);
    expect(arenaLive({ ...(shared.countdown as unknown as StandState), round: null, phase: 'lobby' })).toBe(false);
    expect(arenaLive(null)).toBe(false);
  });
});

describe('snapshot flags of a mixed room', () => {
  it('give the ice beside the fall and the zone', () => {
    expect(F_ICE).toBe(1 << 6);
    const frame = encodeSnapshot(
      {
        tick: 40,
        t: 2000,
        ack: 0,
        ents: [
          { id: 1, x: 380, y: 340, flags: F_ICE | (1 << ZONE_SHIFT) },
          { id: 2, x: 800, y: 330, flags: F_GHOST | F_ICE },
          { id: 3, x: 1220, y: 340, flags: 2 << ZONE_SHIFT },
        ],
      },
      10,
    );
    const s = decodeSnapshot(frame, 10)!;
    expect(s.ents.map((e) => [isIced(e.flags), isGhost(e.flags), zoneOption(e.flags)])).toEqual([
      [true, false, 0],
      [true, true, null],
      [false, false, 1],
    ]);
  });
});
