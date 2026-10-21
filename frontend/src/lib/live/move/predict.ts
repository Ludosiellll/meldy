/**
 * The phone's own character moves at once (prediction), and the server stays the judge (reconciliation).
 *
 * Commands are made on a fixed clock of one per server tick (CommandClock) and each is applied here with the server's
 * own movement (sim.ts). A snapshot says which command the server applied last (`ack`) and where that put the
 * character; the commands after it are replayed from there. When nothing went wrong the replay lands exactly where
 * the prediction already was; a difference (a wall the server knew, a freeze, a catch) is not snapped but faded out
 * over ~`smoothMs`, unless it is a teleport.
 */
import type { Command } from './protocol';
import { applyCommand, DEFAULT_RULES, type GameMap, type MoveRules } from './sim';

export class CommandClock {
  private last: number | null = null;

  /** @param maxBacklog ticks owed after a stall (a background tab) beyond which the time is dropped, not sent. */
  constructor(
    private readonly tickMs = 50,
    private readonly maxBacklog = 4,
  ) {}

  start(now: number): void {
    this.last = now;
  }

  /** How many commands are due by `now` (whole ticks since the last ones). */
  due(now: number): number {
    if (this.last === null) {
      this.last = now;
      return 0;
    }
    const n = Math.floor((now - this.last) / this.tickMs);
    if (n <= 0) return 0;
    if (n > this.maxBacklog) {
      this.last = now;
      return this.maxBacklog;
    }
    this.last += n * this.tickMs;
    return n;
  }
}

export interface PredictorOptions {
  rules?: MoveRules;
  smoothMs?: number;
  /** A correction longer than this is a teleport: shown at once. */
  snap?: number;
}

export class Predictor {
  x = 0;
  y = 0;
  private errX = 0;
  private errY = 0;
  private pending: Command[] = [];
  private lastRender: number | null = null;
  private rules: MoveRules;
  private readonly smoothMs: number;
  private readonly snap: number;

  constructor(
    private map: GameMap,
    o: PredictorOptions = {},
  ) {
    this.rules = o.rules ?? DEFAULT_RULES;
    this.smoothMs = o.smoothMs ?? 100;
    this.snap = o.snap ?? 120;
  }

  setMap(map: GameMap): void {
    this.map = map;
  }

  setRules(rules: MoveRules): void {
    this.rules = rules;
  }

  /** A new connection: the server's seqs start again, the old commands are gone. */
  reset(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.errX = 0;
    this.errY = 0;
    this.pending = [];
  }

  get unacked(): number {
    return this.pending.length;
  }

  /** A command just made (and sent): move now, unless the server holds this player frozen. */
  apply(cmd: Command, frozen: boolean): void {
    this.pending.push(cmd);
    if (this.pending.length > 64) this.pending.shift();
    if (!frozen) [this.x, this.y] = applyCommand(this.map, this.x, this.y, cmd.jx, cmd.jy, this.rules);
  }

  /** The server's word: after command `ack` the character was at (sx, sy). */
  reconcile(ack: number, sx: number, sy: number, frozen: boolean): void {
    let drop = 0;
    while (drop < this.pending.length && this.pending[drop].seq <= ack) drop++;
    if (drop) this.pending = this.pending.slice(drop);
    let x = sx;
    let y = sy;
    if (!frozen) for (const c of this.pending) [x, y] = applyCommand(this.map, x, y, c.jx, c.jy, this.rules);
    const ex = this.x + this.errX - x;
    const ey = this.y + this.errY - y;
    if (ex * ex + ey * ey > this.snap * this.snap) {
      this.errX = 0;
      this.errY = 0;
    } else {
      this.errX = ex;
      this.errY = ey;
    }
    this.x = x;
    this.y = y;
  }

  /** Where to draw the character at local time `now` (ms): the prediction plus the fading correction. */
  render(now: number): { x: number; y: number } {
    if (this.lastRender !== null && now > this.lastRender) {
      const k = Math.exp(-(now - this.lastRender) / this.smoothMs);
      this.errX *= k;
      this.errY *= k;
      if (Math.abs(this.errX) < 0.01) this.errX = 0;
      if (Math.abs(this.errY) < 0.01) this.errY = 0;
    }
    this.lastRender = now;
    return { x: this.x + this.errX, y: this.y + this.errY };
  }
}
