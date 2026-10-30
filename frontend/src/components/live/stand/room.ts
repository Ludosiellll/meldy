/**
 * The projector's socket to the game's room (docs/live/MOVE.md, MODE_STAND.md): one MoveClient with the host token,
 * shared by the 3D scene (positions every frame, read straight from the client) and the screen (the mode's `state`,
 * about seven times a question). Nothing here re-renders per snapshot: React hears only the room's own messages
 * and the socket's status.
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { MoveClient, type MoveStatus, type RosterEntry, type StandHello, type StandState, type Welcome } from '../../../lib/live/move';

export interface RoomView {
  status: MoveStatus;
  /** The close code of a final close, or the code the client retries after. */
  code: number | null;
  welcome: Welcome | null;
  hello: StandHello | null;
  state: StandState | null;
  /** Bumped when characters come or go (the roster). */
  rosterRev: number;
}

type Listener = () => void;

/** The client and what React reads of it, as one external store. */
export class StandRoom {
  readonly client: MoveClient;
  private view: RoomView = { status: 'connecting', code: null, welcome: null, hello: null, state: null, rosterRev: 0 };
  private readonly listeners = new Set<Listener>();
  /** The scene's own hooks: called before React hears (no re-render needed for them). */
  readonly sceneHooks = new Set<{ onWelcome?: (w: Welcome) => void; onRoster?: (e: RosterEntry | null, id: number) => void; onState?: (s: StandState, prev: StandState | null) => void; onHello?: (h: StandHello) => void; onCaught?: (id: number) => void }>();

  constructor(game: string, token: string, url?: string) {
    this.client = new MoveClient({
      game,
      token,
      role: 'host',
      url,
      onWelcome: (w) => {
        for (const h of this.sceneHooks) h.onWelcome?.(w);
        this.set({ welcome: w, rosterRev: this.view.rosterRev + 1 });
      },
      onStand: (m) => {
        if (m.k === 'hello') {
          for (const h of this.sceneHooks) h.onHello?.(m);
          this.set({ hello: m });
        } else if (m.k === 'state') {
          const prev = this.view.state;
          for (const h of this.sceneHooks) h.onState?.(m, prev);
          this.set({ state: m });
        }
      },
      onEvent: (e) => {
        if (e.t === 'add') {
          for (const h of this.sceneHooks) h.onRoster?.(e.e, e.e[0]);
          this.set({ rosterRev: this.view.rosterRev + 1 });
        } else if (e.t === 'del') {
          for (const h of this.sceneHooks) h.onRoster?.(null, e.id);
          this.set({ rosterRev: this.view.rosterRev + 1 });
        } else if (e.t === 'ev' && e.k === 'caught') {
          // mode B: «Дедлайн» caught a character
          for (const h of this.sceneHooks) h.onCaught?.(e.id);
        }
      },
      onStatus: (status, code) => this.set({ status, code: code ?? null }),
    });
  }

  private set(part: Partial<RoomView>): void {
    this.view = { ...this.view, ...part };
    for (const l of this.listeners) l();
  }

  readonly subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  readonly get = (): RoomView => this.view;

  /** After every live_next, live_kick and live_end: the room reads the game's state at once (MODE_STAND.md §2). */
  sync(): void {
    this.client.command({ op: 'sync' });
  }

  /** The kick in the room too (the database's live_kick is the other half). */
  kick(pid: string): void {
    this.client.command({ op: 'kick', pid });
  }

  connect(): void {
    this.client.connect();
  }

  close(): void {
    this.client.close();
  }
}

/** The room for this game while the screen is open. */
export function useStandRoom(game: string, token: string | null): { room: StandRoom | null; view: RoomView | null } {
  const room = useMemo(() => (token ? new StandRoom(game, token) : null), [game, token]);
  useEffect(() => {
    if (!room) return undefined;
    room.connect();
    return () => room.close();
  }, [room]);
  const noop = useMemo(() => ({ subscribe: () => () => {}, get: () => null }), []);
  const view = useSyncExternalStore(room ? room.subscribe : noop.subscribe, room ? room.get : noop.get, room ? room.get : noop.get);
  return { room, view };
}
