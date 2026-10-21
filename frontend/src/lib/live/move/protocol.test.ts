import { describe, expect, it } from 'vitest';
import { CLOSE, decodeSnapshot, encodeInput, encodeSnapshot, F_AWAY, F_FROZEN, kindOf, KIND_NPC, retryable, zoneOf } from './protocol';

/** A snapshot frame as backend/live_move.py writes it, from wire integers. */
function snapshotFrame(tick: number, t: number, ack: number, ents: Array<[number, number, number, number]>): ArrayBuffer {
  return encodeSnapshot({ tick, t, ack, ents: ents.map(([id, x, y, flags]) => ({ id, x, y, flags })) }, 1);
}

describe('input frames', () => {
  it('are 6 bytes plus 3 a command, little-endian, signed axes', () => {
    const buf = encodeInput([
      { seq: 7, jx: 127, jy: -5, buttons: 1 },
      { seq: 8, jx: 0, jy: 0, buttons: 0 },
    ]);
    // The same bytes as live_move.encode_input(7, [(127, -5, 1), (0, 0, 0)]).
    expect([...new Uint8Array(buf)]).toEqual([2, 2, 7, 0, 0, 0, 127, 251, 1, 0, 0, 0]);
  });

  it('refuse gaps and sizes the server would refuse', () => {
    expect(() => encodeInput([])).toThrow(RangeError);
    expect(() => encodeInput(Array.from({ length: 5 }, (_, i) => ({ seq: i + 1, jx: 0, jy: 0, buttons: 0 })))).toThrow(RangeError);
    expect(() => encodeInput([{ seq: 1, jx: 0, jy: 0, buttons: 0 }, { seq: 3, jx: 0, jy: 0, buttons: 0 }])).toThrow(RangeError);
  });
});

describe('snapshot frames', () => {
  it('decode tick, time, ack and positions in map units', () => {
    const s = decodeSnapshot(snapshotFrame(12, 600, 99, [[3, 6123, 3568, F_AWAY | (2 << 8)], [9, 100, 200, KIND_NPC]]), 10);
    expect(s).toEqual({
      tick: 12,
      t: 600,
      ack: 99,
      ents: [
        { id: 3, x: 612.3, y: 356.8, flags: F_AWAY | (2 << 8) },
        { id: 9, x: 10, y: 20, flags: KIND_NPC },
      ],
    });
    expect(zoneOf(s!.ents[0].flags)).toBe(2);
    expect(kindOf(s!.ents[1].flags)).toBe(KIND_NPC);
    expect(s!.ents[0].flags & F_FROZEN).toBe(0);
  });

  it('round-trip through encodeSnapshot', () => {
    const s = { tick: 5, t: 250, ack: 3, ents: [{ id: 1, x: 612.3, y: 356.8, flags: 0 }] };
    expect(decodeSnapshot(encodeSnapshot(s, 10), 10)).toEqual(s);
  });

  it('are refused when cut short or of another type', () => {
    const good = snapshotFrame(1, 50, 0, [[1, 1, 1, 0]]);
    expect(decodeSnapshot(good.slice(0, 20), 10)).toBeNull();
    const other = good.slice(0);
    new DataView(other).setUint8(0, 2);
    expect(decodeSnapshot(other, 10)).toBeNull();
  });
});

describe('close codes', () => {
  it('reconnect after drops, no room yet, busy or Supabase down; never after a final one', () => {
    for (const code of [1006, 1001, 1011, CLOSE.NO_ROOM, CLOSE.TIMEOUT, CLOSE.SLOW_DOWN, CLOSE.UNAVAILABLE]) expect(retryable(code)).toBe(true);
    for (const code of [CLOSE.ROOM_CLOSED, CLOSE.REPLACED, CLOSE.BAD_TOKEN, CLOSE.FORBIDDEN, CLOSE.FULL, CLOSE.ENDED, CLOSE.BAD_REQUEST, CLOSE.TOO_BIG])
      expect(retryable(code)).toBe(false);
  });
});
