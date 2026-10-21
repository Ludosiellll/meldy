import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backoffMs, CLOSE_STALE, MoveClient, type MoveStatus } from './client';
import { CLOSE, encodeSnapshot, F_FROZEN, MSG_INPUT, type Welcome } from './protocol';

const GAME = '11111111-2222-4333-8444-555555555555';
const TOKEN = 'P'.repeat(43);

/** A WebSocket that records what the client sends; the test plays the server. */
class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 0;
  binaryType = 'blob';
  sent: Array<string | ArrayBuffer> = [];
  closedWith: number | null = null;
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

  close(code = 1000) {
    this.closedWith = code;
    this.readyState = 3;
  }

  // the server's side
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  text(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
  binary(buf: ArrayBuffer) {
    this.onmessage?.({ data: buf });
  }
  drop(code: number) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  json() {
    return this.sent.filter((d): d is string => typeof d === 'string').map((d) => JSON.parse(d));
  }
  inputs() {
    return this.sent
      .filter((d): d is ArrayBuffer => d instanceof ArrayBuffer)
      .map((buf) => {
        const v = new DataView(buf);
        expect(v.getUint8(0)).toBe(MSG_INPUT);
        const n = v.getUint8(1);
        return { first: v.getUint32(2, true), cmds: Array.from({ length: n }, (_, i) => [v.getInt8(6 + 3 * i), v.getInt8(7 + 3 * i)]) };
      });
  }
}

const welcome = (over: Partial<Welcome> = {}): Welcome => ({
  t: 'welcome',
  v: 1,
  role: 'player',
  tick: 100,
  ms: 5000,
  hz: 20,
  snap: 2,
  q: 10,
  speed: 260,
  r: 18,
  npc_r: 26,
  map: { w: 1600, h: 900, solids: [], zones: [], spawns: [[800, 450]], npc_spawns: [] },
  roster: [[7, 0, 'pid-7', 'Дима', null]],
  frozen: false,
  you: 7,
  pid: 'pid-7',
  resumed: false,
  ...over,
});

const snapshot = (tick: number, ack: number, x: number, y: number, flags = 0) =>
  encodeSnapshot({ tick, t: tick * 50, ack, ents: [{ id: 7, x, y, flags }, { id: 8, x: 100, y: 100, flags: 0 }] }, 10);

let now = 0;
let statuses: Array<[MoveStatus, number | undefined]> = [];

const last = <T,>(list: T[]): T => list[list.length - 1];

function client(over: Partial<ConstructorParameters<typeof MoveClient>[0]> = {}) {
  return new MoveClient({
    game: GAME,
    token: TOKEN,
    role: 'player',
    url: 'ws://test/api/live/move/ws',
    WebSocketImpl: FakeSocket as unknown as new (url: string) => WebSocket,
    now: () => now,
    onStatus: (s, code) => statuses.push([s, code]),
    ...over,
  });
}

/** Advance fake time and the clock the client reads together. */
function advance(ms: number) {
  for (let left = ms; left > 0; left -= 10) {
    now += Math.min(10, left);
    vi.advanceTimersByTime(Math.min(10, left));
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.all = [];
  now = 0;
  statuses = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('MoveClient', () => {
  it('says hello with the token in the first message, never in the address', () => {
    const c = client();
    c.connect();
    const ws = FakeSocket.all[0];
    expect(ws.url).toBe('ws://test/api/live/move/ws');
    ws.open();
    expect(ws.json()).toEqual([{ t: 'hello', v: 1, game: GAME, token: TOKEN, role: 'player' }]);
    expect(ws.binaryType).toBe('arraybuffer');
  });

  it('sends 20 commands a second in frames at ~15 Hz, consecutive seqs, nothing while the stick rests', () => {
    const c = client();
    c.connect();
    const ws = FakeSocket.all[0];
    ws.open();
    ws.text(welcome());
    ws.binary(snapshot(100, 0, 800, 450));
    advance(1000);
    expect(ws.inputs()).toEqual([]); // resting stick
    c.setJoystick(1, 0);
    advance(1000);
    const frames = ws.inputs();
    expect(frames.length).toBeGreaterThanOrEqual(14);
    expect(frames.length).toBeLessThanOrEqual(16);
    const cmds = frames.flatMap((f) => f.cmds.map((cmd, i) => ({ seq: f.first + i, cmd })));
    expect(cmds.length).toBeGreaterThanOrEqual(19);
    expect(cmds.length).toBeLessThanOrEqual(21);
    expect(cmds.map((c) => c.seq)).toEqual(cmds.map((_, i) => i + 1));
    expect(cmds.every((c) => c.cmd[0] === 127 && c.cmd[1] === 0)).toBe(true);
    c.setJoystick(0, 0);
    advance(500);
    const after = ws.inputs().slice(frames.length);
    expect(after.flatMap((f) => f.cmds)).toEqual([[0, 0]]); // one still command, then quiet
  });

  it('predicts its own character and keeps others ~100 ms behind', () => {
    const c = client();
    c.connect();
    const ws = FakeSocket.all[0];
    ws.open();
    ws.text(welcome());
    ws.binary(snapshot(100, 0, 800, 450));
    c.setJoystick(1, 0);
    advance(200); // 4 commands made, none acked yet
    const f = c.frame(now);
    expect(f.me).toMatchObject({ id: 7, y: 450 });
    expect(f.me!.x).toBeCloseTo(800 + 4 * 13, 6);
    expect(f.others.get(8)).toEqual({ x: 100, y: 100, flags: 0 });
    expect(f.others.has(7)).toBe(false);
    // The server applied 2 of them: the replay of the other 2 lands on the same spot, nothing to correct.
    ws.binary(snapshot(102, 2, 826, 450));
    expect(c.frame(now).me!.x).toBeCloseTo(852, 6);
  });

  it('stops predicting when the server freezes the player', () => {
    const c = client();
    c.connect();
    const ws = FakeSocket.all[0];
    ws.open();
    ws.text(welcome());
    ws.binary(snapshot(100, 0, 800, 450, F_FROZEN));
    c.setJoystick(1, 0);
    advance(300);
    expect(c.frame(now).me!.x).toBe(800);
    expect(ws.inputs().length).toBeGreaterThan(0); // still sent: the server acks them
  });

  it('pings every 2 s and measures the round trip', () => {
    const c = client({ role: 'host' });
    c.connect();
    const ws = FakeSocket.all[0];
    ws.open();
    ws.text(welcome({ role: 'host', you: undefined, pid: undefined }));
    advance(2000);
    const ping = ws.json().find((m) => m.t === 'ping');
    expect(ping).toEqual({ t: 'ping', c: 2000 });
    advance(40);
    ws.text({ t: 'pong', c: ping.c, tick: 140, ms: 7000 });
    expect(c.rttMs).toBe(40);
    c.command({ op: 'npc', on: true, n: 1 });
    expect(last(ws.json())).toEqual({ t: 'cmd', op: 'npc', on: true, n: 1 });
    expect(ws.inputs()).toEqual([]); // a host sends no inputs
  });

  it('reconnects after a drop with a new hello and seqs from 1 again', () => {
    const c = client();
    c.connect();
    let ws = FakeSocket.all[0];
    ws.open();
    ws.text(welcome());
    ws.binary(snapshot(100, 0, 800, 450));
    c.setJoystick(0, 1);
    advance(300);
    ws.drop(1006);
    expect(last(statuses)).toEqual(['waiting', 1006]);
    advance(1000);
    expect(FakeSocket.all).toHaveLength(2);
    ws = FakeSocket.all[1];
    ws.open();
    expect(ws.json()[0].t).toBe('hello');
    ws.text(welcome({ resumed: true }));
    ws.binary(snapshot(130, 0, 800, 470));
    advance(200);
    expect(ws.inputs()[0].first).toBe(1);
    expect(last(statuses)).toEqual(['open', undefined]);
  });

  it('waits for the host (4404) and gives up on a final close', () => {
    const c = client();
    c.connect();
    FakeSocket.all[0].open();
    FakeSocket.all[0].drop(CLOSE.NO_ROOM);
    advance(1900);
    expect(FakeSocket.all).toHaveLength(1);
    advance(700);
    expect(FakeSocket.all).toHaveLength(2);
    FakeSocket.all[1].open();
    FakeSocket.all[1].drop(CLOSE.FORBIDDEN);
    advance(20000);
    expect(FakeSocket.all).toHaveLength(2);
    expect(last(statuses)).toEqual(['closed', CLOSE.FORBIDDEN]);
  });

  it('drops a socket that went silent and opens another', () => {
    const c = client();
    c.connect();
    const ws = FakeSocket.all[0];
    ws.open();
    ws.text(welcome());
    ws.binary(snapshot(100, 0, 800, 450));
    advance(4200);
    expect(ws.closedWith).toBe(CLOSE_STALE);
    advance(2000);
    expect(FakeSocket.all.length).toBe(2);
  });

  it('retries when the socket cannot even be created', () => {
    let fail = true;
    class Refusing extends FakeSocket {
      constructor(url: string) {
        if (fail) throw new Error('SecurityError');
        super(url);
      }
    }
    const c = client({ WebSocketImpl: Refusing as unknown as new (url: string) => WebSocket });
    c.connect();
    expect(last(statuses)).toEqual(['waiting', 1006]);
    fail = false;
    advance(1000);
    expect(FakeSocket.all).toHaveLength(1);
  });

  it('close() leaves for good', () => {
    const c = client();
    c.connect();
    FakeSocket.all[0].open();
    c.close();
    expect(FakeSocket.all[0].closedWith).toBe(1000);
    advance(10000);
    expect(FakeSocket.all).toHaveLength(1);
    expect(c.status).toBe('closed');
  });

  it('keeps the roster and map up to date from events', () => {
    const events: string[] = [];
    const c = client({ onEvent: (e) => events.push(e.t) });
    c.connect();
    const ws = FakeSocket.all[0];
    ws.open();
    ws.text(welcome());
    ws.text({ t: 'add', e: [9, 1, null, 'chaser', null] });
    ws.text({ t: 'del', id: 7 });
    ws.text({ t: 'map', map: { w: 800, h: 600, solids: [], zones: [{ id: 'A', rect: [0, 0, 10, 10] }], spawns: [[1, 1]], npc_spawns: [] } });
    ws.text({ t: 'freeze', on: true });
    expect([...c.roster.keys()]).toEqual([9]);
    expect(c.map!.w).toBe(800);
    expect(c.frozen).toBe(true);
    expect(events).toEqual(['add', 'del', 'map', 'freeze']);
  });
});

describe('MoveClient in mode A «Встань на ответ»', () => {
  const state = (over: Record<string, unknown> = {}) => ({
    t: 'stand', k: 'state', phase: 'open', qi: 0, q_count: 3, players: 2, q: { text: 'Вопрос', options: ['a', 'b'] },
    opens: 5000, closes: 6000, floor: 'up', res: null, top: null, acc: null, ...over,
  });

  it('keeps the latest hello, state and me and hands them to onStand', () => {
    const got: string[] = [];
    const c = client({ onStand: (m) => got.push(m.k) });
    c.connect();
    const ws = FakeSocket.all[0];
    ws.open();
    ws.text(welcome());
    ws.text({ t: 'stand', k: 'hello', v: 1, boss: 'clock', q_count: 3, time_s: 15, speed: true, stage: [800, 520, 80],
              floor: { x: 20, y: 160, tile: 60, cols: 26, rows: 12 }, letters: ['А', 'Б', 'В', 'Г'], alarm_ms: 3000, fall_ms: 900, floor_ms: 4000 });
    ws.text(state({ phase: 'countdown' }));
    ws.text({ t: 'stand', k: 'me', ghost: true, pts: 0, streak: 0, best: 0, right: 0, place: 2, of: 2, last: null });
    ws.text({ t: 'stand', k: 'state', phase: 'nonsense' }); // ignored
    expect(got).toEqual(['hello', 'state', 'me']);
    expect(c.stand.hello?.boss).toBe('clock');
    expect(c.stand.state?.phase).toBe('countdown');
    expect(c.stand.me?.ghost).toBe(true);
  });

  it('gives the room clock and lets the stick go at the question’s zero until the next state', () => {
    const c = client();
    c.connect();
    const ws = FakeSocket.all[0];
    ws.open();
    ws.text(welcome());
    ws.binary(snapshot(100, 0, 800, 450)); // room ms 5000 at local 0
    expect(c.serverNow(now)).toBe(5000);
    ws.text(state()); // closes at room ms 6000
    c.setJoystick(1, 0);
    advance(900);
    expect(c.holding(now)).toBe(false);
    const before = ws.inputs().flatMap((f) => f.cmds);
    expect(before.every((cmd) => cmd[0] === 127)).toBe(true);
    advance(300); // past zero: still commands only
    expect(c.holding(now)).toBe(true);
    const after = ws.inputs().flatMap((f) => f.cmds).slice(before.length);
    expect(after.length).toBeGreaterThan(0);
    expect(after.filter((cmd) => cmd[0] !== 0).length).toBeLessThanOrEqual(2); // the frame in flight at zero
    expect(after[after.length - 1]).toEqual([0, 0]);
    ws.text(state({ phase: 'reveal', floor: 'down', res: { qi: 0, key: 1, counts: [0, 1], stood: 1, of: 2, fastest: null,
                                                           fell: [8], back: [], at: 6300, back_at: 10300 } }));
    expect(c.holding(now)).toBe(false);
    const n = ws.inputs().flatMap((f) => f.cmds).length;
    advance(200);
    expect(ws.inputs().flatMap((f) => f.cmds).slice(n).some((cmd) => cmd[0] === 127)).toBe(true);
  });
});

describe('backoffMs', () => {
  it('doubles up to 8 s with jitter, waits ~2 s for the host, ≥ 3 s when busy', () => {
    expect(backoffMs(0, 1006, () => 0.5)).toBe(500);
    expect(backoffMs(3, 1006, () => 0.5)).toBe(4000);
    expect(backoffMs(10, 1006, () => 0.5)).toBe(8000);
    expect(backoffMs(0, 1006, () => 0)).toBe(350);
    expect(backoffMs(5, CLOSE.NO_ROOM, () => 0)).toBe(2000);
    expect(backoffMs(0, CLOSE.SLOW_DOWN, () => 0.5)).toBe(3000);
  });
});
