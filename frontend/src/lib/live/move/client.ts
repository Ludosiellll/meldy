/**
 * The movement games' client: one WebSocket to /api/live/move/ws (docs/live/MOVE.md). No UI — a screen calls
 * `setJoystick` from its stick and `frame()` from requestAnimationFrame.
 *
 * - Connects, says hello with the live game's player or host token, reconnects after drops with backoff (the server
 *   resumes the same character); stops for good on a final close (bad token, kicked, room closed, game ended).
 * - A player makes one command per server tick (20 Hz) and sends them in batches at `sendHz` (15 Hz); nothing is sent
 *   while the stick rests. Its own character is predicted (predict.ts); everyone else is interpolated ~100 ms behind
 *   (interp.ts).
 * - Pings every 2 s (the server closes a socket silent for 15 s; the pong gives the round trip); a socket that brought
 *   nothing for `staleMs` is dropped and opened again.
 * - A mode's messages: mode A «Встань на ответ» (docs/live/MODE_STAND.md) keeps its latest `hello`, `state` and `me` in
 *   `stand` and calls `onStand`; at the question's zero it lets the stick go by itself until the next state.
 */
import { SnapshotBuffer, ServerClock, type Pose } from './interp';
import { CommandClock, Predictor } from './predict';
import {
  CLOSE,
  decodeSnapshot,
  encodeInput,
  F_FROZEN,
  MAX_CMDS_PER_MSG,
  parseStand,
  PROTOCOL_VERSION,
  retryable,
  WS_PATH,
  type Command,
  type HostCommand,
  type RosterEntry,
  type ServerEvent,
  type StandHello,
  type StandMe,
  type StandMessage,
  type StandState,
  type Welcome,
} from './protocol';
import { mapFromJson, toAxes, type GameMap } from './sim';

export type MoveStatus = 'connecting' | 'open' | 'waiting' | 'closed';

/** The code this client closes a silent socket with before opening a new one (4000-4999: the application's own). */
export const CLOSE_STALE = 4999;

export interface MoveClientOptions {
  game: string;
  token: string;
  role: 'player' | 'host';
  /** Defaults to this page's host: wss://<host>/api/live/move/ws. */
  url?: string;
  sendHz?: number;
  delayMs?: number;
  pingMs?: number;
  staleMs?: number;
  onWelcome?: (w: Welcome) => void;
  onEvent?: (e: ServerEvent) => void;
  /** Mode A «Встань на ответ»: each hello, state and me (also kept in `client.stand`). */
  onStand?: (m: StandMessage) => void;
  /** `closed` carries the final close code; `waiting` the code it will retry after (e.g. 4404 before the host comes). */
  onStatus?: (status: MoveStatus, code?: number) => void;
  /** Tests: a WebSocket class and a clock. */
  WebSocketImpl?: new (url: string) => WebSocket;
  now?: () => number;
}

export interface RenderState {
  /** The local player's character (null for the host or before the welcome). */
  me: { id: number; x: number; y: number; flags: number } | null;
  /** Everyone else by entity id, at server time `t`. */
  others: Map<number, Pose>;
  t: number | null;
}

export function defaultUrl(): string {
  const loc = typeof window !== 'undefined' ? window.location : null;
  if (!loc) return `ws://localhost${WS_PATH}`;
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}${WS_PATH}`;
}

/** Wait before reconnect attempt `attempt` (0, 1, …) after a close with `code`; jitter keeps a class from reconnecting in step. */
export function backoffMs(attempt: number, code: number, random: () => number = Math.random): number {
  if (code === CLOSE.NO_ROOM) return 2000 + random() * 500;
  const base = Math.min(8000, 500 * 2 ** attempt);
  const floor = code === CLOSE.SLOW_DOWN || code === CLOSE.UNAVAILABLE ? 3000 : 0;
  return Math.max(floor, base) * (0.7 + 0.6 * random());
}

export class MoveClient {
  status: MoveStatus = 'connecting';
  welcome: Welcome | null = null;
  map: GameMap | null = null;
  roster = new Map<number, RosterEntry>();
  rttMs: number | null = null;
  frozen = false;
  /** Mode A: the latest of each message (null before the first; kept across a reconnect until replaced). */
  stand: { hello: StandHello | null; state: StandState | null; me: StandMe | null } = { hello: null, state: null, me: null };

  private ws: WebSocket | null = null;
  private readonly buffer = new SnapshotBuffer();
  private readonly clock = new ServerClock();
  private cmdClock = new CommandClock();
  private predictor: Predictor | null = null;
  private seq = 0;
  private axes: [number, number] = [0, 0];
  private buttons = 0;
  private lastIdle = true;
  private myFlags = 0;
  private attempt = 0;
  private lastRx = 0;
  private timers: Array<ReturnType<typeof setInterval>> = [];
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private readonly now: () => number;
  private readonly o: Required<Pick<MoveClientOptions, 'sendHz' | 'delayMs' | 'pingMs' | 'staleMs'>> & MoveClientOptions;

  constructor(options: MoveClientOptions) {
    this.o = { sendHz: 15, delayMs: 100, pingMs: 2000, staleMs: 4000, ...options };
    this.now = options.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  }

  connect(): void {
    this.stopped = false;
    this.open();
  }

  /** Leaves for good (no reconnect). */
  close(): void {
    this.stopped = true;
    this.clearTimers();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const ws = this.ws;
    this.ws = null;
    if (ws && ws.readyState <= 1) ws.close(1000, 'bye');
    this.setStatus('closed');
  }

  /** The stick, each axis in [-1, 1] (+y is down the map). */
  setJoystick(x: number, y: number): void {
    this.axes = toAxes(x, y);
  }

  setButtons(buttons: number): void {
    this.buttons = buttons & 0xff;
  }

  /** A host command (ignored for a player by the server). */
  command(cmd: HostCommand): void {
    this.sendJson({ t: 'cmd', ...cmd });
  }

  /** The room's clock now (ms, the snapshots' `t`): the base of every mode time (`opens`, `closes`, `back_at`). */
  serverNow(nowMs: number = this.now()): number | null {
    return this.clock.now(nowMs);
  }

  /** Mode A: the question's zero has passed while it is still open here — the stick is let go until the next state. */
  holding(nowMs: number = this.now()): boolean {
    const st = this.stand.state;
    if (!st || st.phase !== 'open' || st.closes === null) return false;
    const t = this.clock.now(nowMs);
    return t !== null && t >= st.closes;
  }

  /**
   * Everyone else into `out` (the host: everyone), reusing its pose objects: a render loop's allocation-free
   * `frame()`. Returns the server time sampled at (null before the first snapshot); `out` is then emptied.
   */
  frameInto(out: Map<number, Pose>, nowMs: number = this.now()): number | null {
    const t = this.clock.now(nowMs);
    if (t === null) {
      out.clear();
      return null;
    }
    this.buffer.sampleInto(t - this.o.delayMs, out);
    const you = this.welcome?.you;
    if (you !== undefined) out.delete(you);
    return t;
  }

  /** What to draw now. */
  frame(nowMs: number = this.now()): RenderState {
    const t = this.clock.now(nowMs);
    const others = t === null ? new Map<number, Pose>() : this.buffer.sample(t - this.o.delayMs);
    let me: RenderState['me'] = null;
    const you = this.welcome?.you;
    if (you !== undefined && this.predictor && this.buffer.latest()) {
      const p = this.predictor.render(nowMs);
      me = { id: you, x: p.x, y: p.y, flags: this.myFlags };
      others.delete(you);
    }
    return { me, others, t };
  }

  // ── the socket ──

  private open(): void {
    const Impl = this.o.WebSocketImpl ?? WebSocket;
    let ws: WebSocket;
    try {
      ws = new Impl(this.o.url ?? defaultUrl());
    } catch {
      // A socket refused before it exists (a CSP block, a bad address): retried like a dropped one, backoff up to 8 s.
      this.ws = null;
      this.onClosed(1006);
      return;
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    this.setStatus(this.attempt ? 'waiting' : 'connecting');
    ws.onopen = () => {
      if (this.ws !== ws) return;
      ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, game: this.o.game, token: this.o.token, role: this.o.role }));
    };
    ws.onmessage = (ev: MessageEvent) => {
      if (this.ws !== ws) return;
      this.lastRx = this.now();
      if (typeof ev.data === 'string') this.onText(ev.data);
      else if (ev.data instanceof ArrayBuffer) this.onBinary(ev.data);
    };
    ws.onclose = (ev: CloseEvent) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.onClosed(ev.code);
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  }

  private onClosed(code: number): void {
    this.clearTimers();
    if (this.stopped) return;
    if (!retryable(code)) {
      this.stopped = true;
      this.setStatus('closed', code);
      return;
    }
    const wait = backoffMs(this.attempt, code);
    this.attempt += 1;
    this.setStatus('waiting', code);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.stopped) this.open();
    }, wait);
  }

  private onText(text: string): void {
    let msg: { t?: string } & Record<string, unknown>;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    switch (msg.t) {
      case 'welcome':
        this.onWelcome(msg as unknown as Welcome);
        return;
      case 'add': {
        const e = (msg as unknown as { e: RosterEntry }).e;
        this.roster.set(e[0], e);
        break;
      }
      case 'del':
        this.roster.delete(msg.id as number);
        break;
      case 'map':
        this.map = mapFromJson((msg as unknown as { map: Welcome['map'] }).map);
        this.predictor?.setMap(this.map);
        break;
      case 'freeze':
        this.frozen = Boolean(msg.on);
        break;
      case 'pong':
        if (typeof msg.c === 'number') this.rttMs = this.now() - msg.c;
        break;
      case 'stand': {
        const m = parseStand(msg);
        if (!m) return;
        if (m.k === 'hello') this.stand = { ...this.stand, hello: m };
        else if (m.k === 'state') this.stand = { ...this.stand, state: m };
        else this.stand = { ...this.stand, me: m };
        this.o.onStand?.(m);
        break;
      }
    }
    this.o.onEvent?.(msg as unknown as ServerEvent);
  }

  private onWelcome(w: Welcome): void {
    this.welcome = w;
    this.attempt = 0;
    this.map = mapFromJson(w.map);
    this.frozen = w.frozen;
    this.roster = new Map(w.roster.map((e) => [e[0], e]));
    this.buffer.clear();
    this.clock.reset();
    this.seq = 0;
    this.lastIdle = true;
    const rules = { tickHz: w.hz, speed: w.speed, r: w.r };
    this.cmdClock = new CommandClock(1000 / w.hz);
    if (w.role === 'player') {
      this.predictor = new Predictor(this.map, { rules });
      this.predictor.reset(0, 0);
    } else {
      this.predictor = null;
    }
    const now = this.now();
    this.lastRx = now;
    this.cmdClock.start(now);
    this.clearTimers();
    this.timers.push(setInterval(() => this.tickSend(), 1000 / this.o.sendHz));
    this.timers.push(setInterval(() => this.ping(), this.o.pingMs));
    this.setStatus('open');
    this.o.onWelcome?.(w);
  }

  private onBinary(buf: ArrayBuffer): void {
    const q = this.welcome?.q;
    if (!q) return;
    const snap = decodeSnapshot(buf, q);
    if (!snap) return;
    const first = this.buffer.latest() === null;
    this.buffer.push(snap);
    this.clock.sample(snap.t, this.now());
    const you = this.welcome?.you;
    if (you === undefined || !this.predictor) return;
    const mine = snap.ents.find((e) => e.id === you);
    if (!mine) return;
    this.myFlags = mine.flags;
    const frozen = (mine.flags & F_FROZEN) !== 0;
    if (first) {
      this.predictor.reset(mine.x, mine.y);
      this.cmdClock.start(this.now());
    }
    this.predictor.reconcile(snap.ack, mine.x, mine.y, frozen);
  }

  // ── timers ──

  private tickSend(): void {
    const ws = this.ws;
    const now = this.now();
    if (!ws || ws.readyState !== 1) return;
    if (now - this.lastRx > this.o.staleMs) {
      // Nothing for too long: a half-open socket (a phone between networks). Open a new one.
      this.ws = null;
      ws.close(CLOSE_STALE, 'stale');
      this.onClosed(CLOSE.TIMEOUT);
      return;
    }
    if (!this.predictor || !this.buffer.latest()) return; // commands start from the first known position
    const n = this.cmdClock.due(now);
    if (n <= 0) return;
    const [jx, jy] = this.holding(now) ? [0, 0] : this.axes;
    const idle = jx === 0 && jy === 0 && this.buttons === 0;
    if (idle && this.lastIdle) return;
    const count = idle ? 1 : n; // one still command tells the server the stick and buttons were let go
    this.lastIdle = idle;
    const frozen = this.frozen || (this.myFlags & F_FROZEN) !== 0;
    const cmds: Command[] = [];
    for (let i = 0; i < count; i++) {
      const cmd = { seq: ++this.seq, jx, jy, buttons: this.buttons };
      this.predictor.apply(cmd, frozen);
      cmds.push(cmd);
    }
    for (let i = 0; i < cmds.length; i += MAX_CMDS_PER_MSG) ws.send(encodeInput(cmds.slice(i, i + MAX_CMDS_PER_MSG)));
  }

  private ping(): void {
    this.sendJson({ t: 'ping', c: this.now() });
  }

  private sendJson(obj: unknown): void {
    const ws = this.ws;
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  private clearTimers(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  private setStatus(status: MoveStatus, code?: number): void {
    this.status = status;
    this.o.onStatus?.(status, code);
  }
}
