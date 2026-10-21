/**
 * The phone's side of the room in «Встань на ответ» (docs/live/MODE_STAND.md, MOVE.md), without React: one MoveClient
 * (prediction for the own character, others 150 ms behind for a phone's jitter) and a small store of what changes
 * about seven times a question — the room's `hello`, `state`, `me`, the socket's status and «connection lost». The
 * screens render this snapshot; positions never go through it (the screen's animation frame reads `client.frame()`).
 *
 * «Связь пропала» shows after 1 s without snapshots once the room has spoken (§9): the last picture stays meanwhile.
 * A final close (the game ended, kicked, a bad token, the room closed) stops for good and says why.
 */
import { MoveClient, type MoveClientOptions, type MoveStatus } from '../../../../lib/live/move';
import { CLOSE, type StandHello, type StandMe, type StandMessage, type StandState } from '../../../../lib/live/move/protocol';

export const LOST_MS = 1000;
/** Phones see others this far in the past (MODE_STAND §9: mobile jitter). */
export const PHONE_DELAY_MS = 150;

export interface StandView {
  status: MoveStatus;
  /** The final close code when `status` is closed (4410 ended, 4403 kicked, …). */
  code: number | null;
  /** Snapshots stopped for over a second after the room had spoken: the screen keeps its last picture. */
  lost: boolean;
  /** The room has answered at least once (welcome): the stick works. */
  ready: boolean;
  /** The own character's entity id. */
  you: number | null;
  hello: StandHello | null;
  state: StandState | null;
  me: StandMe | null;
}

export interface SessionOptions {
  game: string;
  token: string;
  url?: string;
  WebSocketImpl?: MoveClientOptions['WebSocketImpl'];
  now?: () => number;
  /** Tests: how often «lost» is checked (ms). */
  checkMs?: number;
}

export class StandSession {
  readonly client: MoveClient;
  private view: StandView = { status: 'connecting', code: null, lost: false, ready: false, you: null, hello: null, state: null, me: null };
  private readonly listeners = new Set<() => void>();
  private readonly now: () => number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly checkMs: number;
  private disposed = false;

  constructor(o: SessionOptions) {
    this.now = o.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    this.checkMs = o.checkMs ?? 250;
    this.client = new MoveClient({
      game: o.game,
      token: o.token,
      role: 'player',
      url: o.url,
      delayMs: PHONE_DELAY_MS,
      WebSocketImpl: o.WebSocketImpl,
      now: this.now,
      onWelcome: (w) => this.set({ ready: true, you: w.you ?? null }),
      onStand: (m) => this.onStand(m),
      onStatus: (status, code) => this.set({ status, code: status === 'closed' ? (code ?? null) : null }),
    });
  }

  readonly getSnapshot = (): StandView => this.view;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  connect(): void {
    this.disposed = false;
    this.client.connect();
    if (!this.timer) this.timer = setInterval(() => this.check(), this.checkMs);
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.client.close();
  }

  /** The stick, each axis in [-1, 1] (+y down the map): batched by the client at 15 Hz, never sent per frame. */
  stick(x: number, y: number): void {
    this.client.setJoystick(x, y);
  }

  /** Why the room let this phone go for good, in the controller's terms; null while it may still come back. */
  ended(): 'ended' | 'kicked' | 'gone' | null {
    if (this.view.status !== 'closed' || this.view.code === null) return null;
    if (this.view.code === CLOSE.ENDED) return 'ended';
    if (this.view.code === CLOSE.FORBIDDEN) return 'kicked';
    return this.view.code === 1000 ? null : 'gone';
  }

  private check(): void {
    const at = this.client.lastSnapAt;
    const lost = this.view.ready && this.view.status !== 'closed' && (at === null || this.now() - at > LOST_MS);
    if (lost !== this.view.lost) this.set({ lost });
  }

  private onStand(m: StandMessage): void {
    if (m.k === 'hello') this.set({ hello: m });
    else if (m.k === 'state') this.set({ state: m });
    else this.set({ me: m });
  }

  private set(patch: Partial<StandView>): void {
    if (this.disposed) return;
    let changed = false;
    for (const key of Object.keys(patch) as (keyof StandView)[]) {
      if (this.view[key] !== patch[key]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.view = { ...this.view, ...patch };
    for (const listener of Array.from(this.listeners)) listener();
  }
}
