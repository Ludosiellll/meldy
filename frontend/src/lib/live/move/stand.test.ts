import { describe, expect, it } from 'vitest';
import shared from '../../../../../contracts/live/stand_arena.json';
import {
  decodeSnapshot,
  encodeSnapshot,
  F_FROZEN,
  F_GHOST,
  isGhost,
  parseStand,
  STAND_ARENA,
  STAND_LETTERS,
  standPoints,
  zoneOption,
  ZONE_SHIFT,
  type StandState,
} from './protocol';
import { mapFromJson, zoneAt, zoneIndexAt } from './sim';

// Messages as backend/live_move_stand.py writes them (MODE_STAND.md §4).
const HELLO = {
  t: 'stand', k: 'hello', v: 1, boss: 'skeleton', q_count: 6, time_s: 15, speed: true, stage: [800, 520, 80],
  floor: { x: 20, y: 160, tile: 60, cols: 26, rows: 12 }, letters: ['А', 'Б', 'В', 'Г'], alarm_ms: 3000, fall_ms: 900, floor_ms: 4000,
};
const COUNTDOWN = {
  t: 'stand', k: 'state', phase: 'countdown', qi: 2, q_count: 6, players: 24,
  q: { text: 'Какая команда отменяет транзакцию?', options: ['COMMIT', 'ROLLBACK', 'GRANT'] },
  opens: 81250, closes: 96250, floor: 'up', res: null, top: null, acc: null,
};
const REVEAL = {
  ...COUNTDOWN, phase: 'reveal', floor: 'down',
  res: { qi: 2, key: 1, counts: [3, 17, 2], stood: 15, of: 24, fastest: { id: 12, pts: 980, ms: 1450 }, fell: [3, 9, 31], back: [5, 7],
         at: 96620, back_at: 100620 },
};
const ME = {
  t: 'stand', k: 'me', ghost: false, pts: 2450, streak: 2, best: 3, right: 4, place: 4, of: 24,
  last: { qi: 2, choice: 1, ok: true, pts: 620, ms: 4210, fell: false, revived: false, late: false },
};

describe('the arena and the points (contracts/live/stand_arena.json: the server and the SQL hold the same)', () => {
  it('is the shared arena; zone i is option i', () => {
    expect(STAND_ARENA).toEqual(shared.map);
    expect([...STAND_LETTERS]).toEqual(shared.letters);
    expect(STAND_ARENA.zones.map((z) => z.id)).toEqual(['А', 'Б', 'В', 'Г']);
    const m = mapFromJson(STAND_ARENA);
    expect(zoneIndexAt(m, 380, 340)).toBe(1); // А: option 0
    expect(zoneIndexAt(m, 1220, 700)).toBe(4); // Г: option 3
    expect(zoneIndexAt(m, 800, 330)).toBe(0); // a corridor
    expect(zoneIndexAt(m, 80, 340)).toBe(1); // on the edge: inside
    expect(zoneAt(m, 79.9, 340)).toBeNull();
    expect(zoneAt(m, 920, 220)).toBe('Б');
  });

  for (const c of shared.points) {
    it(`points: ${c.elapsed_ms} ms of ${c.time_s} s, streak ${c.streak_after}${c.ghost ? ', a ghost' : ''}${c.speed ? '' : ', speed off'} → ${c.pts}`, () => {
      expect(standPoints(c.elapsed_ms, c.time_s, c.streak_after, c.speed, c.ghost)).toBe(c.pts);
    });
  }
});

describe('stand messages', () => {
  it('parse as the server sends them', () => {
    expect(parseStand(HELLO)).toEqual(HELLO);
    expect(parseStand(COUNTDOWN)).toEqual(COUNTDOWN);
    const reveal = parseStand(REVEAL) as StandState;
    expect(reveal.res?.key).toBe(1);
    expect(reveal.res?.back_at).toBe(100620);
    expect(parseStand({ ...REVEAL, res: { ...REVEAL.res, pts: [[12, 980]] } })).not.toBeNull(); // the host's
    expect(parseStand(ME)).toEqual(ME);
    expect(parseStand({ ...COUNTDOWN, phase: 'leaderboard', q: null, opens: null, closes: null, top: [] })).not.toBeNull();
  });

  it('a broken or foreign one is ignored', () => {
    expect(parseStand(null)).toBeNull();
    expect(parseStand({ t: 'say', k: 'state' })).toBeNull();
    expect(parseStand({ ...COUNTDOWN, phase: 'nap' })).toBeNull();
    expect(parseStand({ ...COUNTDOWN, closes: 'soon' })).toBeNull();
    expect(parseStand({ ...COUNTDOWN, floor: 'gone' })).toBeNull();
    expect(parseStand({ ...COUNTDOWN, q: { text: 'x' } })).toBeNull();
    expect(parseStand({ ...REVEAL, res: { key: 1 } })).toBeNull();
    expect(parseStand({ ...HELLO, boss: 'dragon' })).toBeNull();
    expect(parseStand({ ...ME, pts: '10' })).toBeNull();
    expect(parseStand({ t: 'stand', k: 'later' })).toBeNull();
  });

  it('never carry the key before the close', () => {
    expect(JSON.stringify(COUNTDOWN)).not.toContain('key');
  });
});

describe('snapshot flags of mode A', () => {
  it('give the ghost and the option a character stands on', () => {
    const frame = encodeSnapshot(
      {
        tick: 40,
        t: 2000,
        ack: 0,
        ents: [
          { id: 1, x: 380, y: 340, flags: F_GHOST | (1 << ZONE_SHIFT) },
          { id: 2, x: 800, y: 330, flags: F_FROZEN },
          { id: 3, x: 1220, y: 700, flags: 4 << ZONE_SHIFT },
        ],
      },
      10,
    );
    const s = decodeSnapshot(frame, 10)!;
    expect(s.ents.map((e) => [isGhost(e.flags), zoneOption(e.flags)])).toEqual([
      [true, 0],
      [false, null],
      [false, 3],
    ]);
  });
});
