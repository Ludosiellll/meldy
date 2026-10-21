import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOSE, encodeSnapshot, STAND_ARENA, type Welcome } from '../../../../lib/live/move/protocol';
import { FloatingStick } from './stick';
import { LOST_MS, StandSession } from './session';

const GAME = '11111111-2222-4333-8444-555555555555';
const last = <T,>(list: T[]): T => list[list.length - 1];
const TOKEN = 'P'.repeat(43);

/** A WebSocket the test plays the room with. */
class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 0;
  binaryType = 'blob';
  sent: Array<string | ArrayBuffer> = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string | ArrayBuffer) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  text(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
  snap(tick: number, x = 560, y = 520, flags = 0) {
    this.onmessage?.({ data: encodeSnapshot({ tick, t: tick * 50, ack: 0, ents: [{ id: 7, x, y, flags }] }, 10) });
  }
  drop(code: number) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  inputs() {
    return this.sent.filter((d): d is ArrayBuffer => d instanceof ArrayBuffer);
  }
}

const welcome: Welcome = {
  t: 'welcome', v: 1, role: 'player', tick: 100, ms: 5000, hz: 20, snap: 2, q: 10, speed: 260, r: 18, npc_r: 26,
  map: STAND_ARENA, roster: [[7, 0, 'pid-7', 'Дима', { body: 'drop', colour: 'blue', hat: 'cap' }]], frozen: false, you: 7, pid: 'pid-7', resumed: false,
};

let now = 0;
let session: StandSession;
const sock = () => FakeSocket.all[FakeSocket.all.length - 1];

beforeEach(() => {
  vi.useFakeTimers();
  now = 1000;
  FakeSocket.all = [];
  session = new StandSession({ game: GAME, token: TOKEN, url: 'ws://test/api/live/move/ws', WebSocketImpl: FakeSocket as unknown as new (url: string) => WebSocket, now: () => now, checkMs: 100 });
});
afterEach(() => {
  session.dispose();
  vi.useRealTimers();
});

describe('StandSession: the room for the phone (MODE_STAND §4, §9)', () => {
  it('keeps hello, state and me, and renders only on a change', () => {
    const seen: unknown[] = [];
    session.subscribe(() => seen.push(session.getSnapshot()));
    session.connect();
    sock().open();
    expect(JSON.parse(sock().sent[0] as string)).toMatchObject({ t: 'hello', role: 'player', game: GAME, token: TOKEN });
    sock().text(welcome);
    expect(session.getSnapshot()).toMatchObject({ status: 'open', ready: true, you: 7 });
    sock().text({ t: 'stand', k: 'hello', v: 1, boss: 'clock', q_count: 6, time_s: 15, speed: true, stage: [800, 520, 80], floor: {}, letters: [], alarm_ms: 3000, fall_ms: 900, floor_ms: 4000 });
    sock().text({ t: 'stand', k: 'state', phase: 'lobby', qi: -1, q_count: 6, players: 24, q: null, opens: null, closes: null, floor: 'up', res: null, top: null, acc: null });
    sock().text({ t: 'stand', k: 'me', ghost: false, pts: 0, streak: 0, best: 0, right: 0, place: 4, of: 24, last: null });
    const v = session.getSnapshot();
    expect(v.hello?.time_s).toBe(15);
    expect(v.state?.phase).toBe('lobby');
    expect(v.me?.place).toBe(4);
    const n = seen.length;
    // Snapshots move dots, never the store.
    for (let t = 101; t < 120; t++) sock().snap(t);
    expect(seen.length).toBe(n);
    // A broken message is ignored.
    sock().text({ t: 'stand', k: 'state', phase: 'nope' });
    expect(session.getSnapshot().state?.phase).toBe('lobby');
  });

  it('says «connection lost» after a second without snapshots, and takes it back when they come', () => {
    session.connect();
    sock().open();
    sock().text(welcome);
    sock().snap(101);
    vi.advanceTimersByTime(300);
    now += 300;
    expect(session.getSnapshot().lost).toBe(false);
    now += LOST_MS + 50;
    vi.advanceTimersByTime(200);
    expect(session.getSnapshot().lost).toBe(true);
    sock().snap(102);
    vi.advanceTimersByTime(200);
    expect(session.getSnapshot().lost).toBe(false);
  });

  it('a mixed room: no «lost» between movement rounds (no snapshots due), counted from the moment the arena comes on', () => {
    session.connect();
    sock().open();
    sock().text(welcome);
    const state = (phase: string, round: 'stand' | 'tap' | null, qi = 2) => ({ t: 'stand', k: 'state', phase, qi, q_count: 6, players: 4, q: null, opens: null, closes: null, floor: 'up', res: null, top: null, acc: null, round });
    // time passes with only pongs on the socket (the client's stale check stays quiet)
    const quiet = (ms: number) => {
      now += ms;
      sock().text({ t: 'pong', c: null, tick: 1, ms: 1 });
      vi.advanceTimersByTime(200);
    };
    sock().text(state('lobby', null, -1));
    quiet(3000);
    expect(session.getSnapshot().lost).toBe(false);
    sock().text(state('open', 'tap', 1));
    quiet(3000);
    expect(session.getSnapshot().lost).toBe(false);
    // a movement round: snapshots are due from now on
    sock().text(state('countdown', 'stand'));
    quiet(LOST_MS / 2);
    expect(session.getSnapshot().lost).toBe(false);
    quiet(LOST_MS);
    expect(session.getSnapshot().lost).toBe(true);
    sock().snap(200);
    vi.advanceTimersByTime(200);
    expect(session.getSnapshot().lost).toBe(false);
    // the round is over: none due again
    sock().text(state('leaderboard', 'stand'));
    quiet(3000);
    expect(session.getSnapshot().lost).toBe(false);
  });

  it('tells a final close apart from a drop it will come back from', () => {
    session.connect();
    sock().open();
    sock().text(welcome);
    sock().drop(1006);
    expect(session.getSnapshot().status).toBe('waiting');
    expect(session.ended()).toBeNull();
    vi.advanceTimersByTime(10_000);
    sock().open();
    sock().text(welcome);
    sock().drop(CLOSE.ENDED);
    expect(session.getSnapshot()).toMatchObject({ status: 'closed', code: CLOSE.ENDED });
    expect(session.ended()).toBe('ended');
  });

  it('sends the stick in the client’s 15 Hz batches, not per move', () => {
    session.connect();
    sock().open();
    sock().text(welcome);
    sock().snap(101);
    for (let i = 0; i < 30; i++) session.stick(1, 0); // a finger moving fast: 30 events
    now += 70;
    vi.advanceTimersByTime(70);
    expect(sock().inputs().length).toBe(1);
  });
});

describe('FloatingStick', () => {
  function field() {
    const el = document.createElement('div');
    el.getBoundingClientRect = () => ({ left: 10, top: 400, width: 360, height: 400, right: 370, bottom: 800, x: 10, y: 400, toJSON: () => null });
    el.setPointerCapture = () => {};
    el.releasePointerCapture = () => {};
    const base = document.createElement('div');
    const knob = document.createElement('div');
    return { el, base, knob };
  }
  const ev = (type: string, x: number, y: number, id = 1) => Object.assign(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true }), { pointerId: id, pointerType: 'touch' });

  it('starts under the finger, pulls toward it, follows past the rim and lets go', () => {
    const moves: Array<[number, number]> = [];
    const stick = new FloatingStick({ radius: 50, onMove: (x, y) => moves.push([x, y]) });
    const { el, base, knob } = field();
    stick.attach(el, base, knob);
    el.dispatchEvent(ev('pointerdown', 190, 600));
    expect(stick.active).toBe(true);
    el.dispatchEvent(ev('pointermove', 215, 600));
    expect(last(moves)).toEqual([0.5, 0]);
    el.dispatchEvent(ev('pointermove', 190, 500));
    expect(last(moves)[1]).toBeCloseTo(-1);
    stick.paint();
    expect(knob.style.transform).toContain('translate3d');
    el.dispatchEvent(ev('pointerup', 190, 500));
    expect(last(moves)).toEqual([0, 0]);
    expect(stick.active).toBe(false);
  });

  it('ignores the finger while the room holds everyone still', () => {
    const moves: Array<[number, number]> = [];
    const stick = new FloatingStick({ onMove: (x, y) => moves.push([x, y]) });
    const { el, base, knob } = field();
    stick.attach(el, base, knob);
    el.dispatchEvent(ev('pointerdown', 190, 600));
    stick.setEnabled(false);
    expect(last(moves)).toEqual([0, 0]);
    el.dispatchEvent(ev('pointermove', 260, 600));
    expect(last(moves)).toEqual([0, 0]);
    stick.paint();
    expect(base.dataset.state).toBe('off');
  });
});
