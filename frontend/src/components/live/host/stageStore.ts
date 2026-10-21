/**
 * What the teacher's screen shows right now, apart from what the server says: during the reveal the server's state is
 * already final (HP after every hit, who froze), and the screen catches up with it hit by hit. Each character, the HP
 * bar and the monster read their own piece of this store, so a hit re-renders the one character it touches and the
 * bar — not the crowd. Elements the effects move (a character's hop box, the monster's shake box) are registered here
 * too: the director animates them directly, with no render at all.
 */
import { useCallback, useSyncExternalStore } from 'react';
import type { BossPhase, Expression, Look } from '../../../lib/live/types';

export interface CharView {
  face: Expression;
  frozen: boolean;
}

export interface BossView {
  phase: BossPhase;
  hurt: boolean;
  /** Fell (defeat): drawn hidden until the next game state. */
  fallen: boolean;
  /** The beat between the end of the answers and the reveal: it braces itself. */
  tense: boolean;
}

/** One of the three who hit hardest in this question. */
export interface StrikeRow {
  id: string;
  name: string;
  dmg: number;
  look: Look;
}

/** The question's blow: the class's total and the three who hit hardest (shown under the HP bar after the hit). */
export interface StrikeView {
  total: number;
  top: StrikeRow[];
}

export interface HpView {
  hp: number;
  max: number;
}

const IDLE: CharView = { face: 'idle', frozen: false };

type Listener = () => void;

export class StageStore {
  private chars = new Map<string, CharView>();
  private charListeners = new Map<string, Set<Listener>>();
  private hp: HpView = { hp: 0, max: 0 };
  private hpListeners = new Set<Listener>();
  private boss: BossView = { phase: 0, hurt: false, fallen: false, tense: false };
  private bossListeners = new Set<Listener>();
  private strike: StrikeView | null = null;
  private strikeListeners = new Set<Listener>();
  /** id → the box a character hops in (registered by the character). */
  readonly hops = new Map<string, HTMLElement>();
  /** The monster's shake box and its flash. */
  bossShake: HTMLElement | null = null;
  bossFlash: HTMLElement | null = null;

  char(id: string): CharView {
    return this.chars.get(id) ?? IDLE;
  }

  setChar(id: string, patch: Partial<CharView>): void {
    const cur = this.char(id);
    const next = { face: patch.face ?? cur.face, frozen: patch.frozen ?? cur.frozen };
    if (next.face === cur.face && next.frozen === cur.frozen) return;
    this.chars.set(id, next);
    this.charListeners.get(id)?.forEach((fn) => fn());
  }

  subscribeChar(id: string, fn: Listener): () => void {
    let set = this.charListeners.get(id);
    if (!set) {
      set = new Set();
      this.charListeners.set(id, set);
    }
    set.add(fn);
    return () => {
      set!.delete(fn);
    };
  }

  /** Forget the characters not in `keep` (kicked, or a new game). */
  retain(keep: ReadonlySet<string>): void {
    for (const id of [...this.chars.keys()]) if (!keep.has(id)) this.chars.delete(id);
  }

  getHp(): HpView {
    return this.hp;
  }

  setHp(hp: number, max = this.hp.max): void {
    const value = Math.max(0, Math.min(max, Math.round(hp)));
    if (value === this.hp.hp && max === this.hp.max) return;
    this.hp = { hp: value, max };
    this.hpListeners.forEach((fn) => fn());
  }

  subscribeHp = (fn: Listener): (() => void) => {
    this.hpListeners.add(fn);
    return () => {
      this.hpListeners.delete(fn);
    };
  };

  getBoss = (): BossView => this.boss;

  setBoss(patch: Partial<BossView>): void {
    const next = { ...this.boss, ...patch };
    if (next.phase === this.boss.phase && next.hurt === this.boss.hurt && next.fallen === this.boss.fallen && next.tense === this.boss.tense) return;
    this.boss = next;
    this.bossListeners.forEach((fn) => fn());
  }

  subscribeBoss = (fn: Listener): (() => void) => {
    this.bossListeners.add(fn);
    return () => {
      this.bossListeners.delete(fn);
    };
  };

  getStrike = (): StrikeView | null => this.strike;

  setStrike(next: StrikeView | null): void {
    const cur = this.strike;
    if (cur === next) return;
    if (
      cur &&
      next &&
      cur.total === next.total &&
      cur.top.length === next.top.length &&
      cur.top.every((r, i) => r.id === next.top[i].id && r.dmg === next.top[i].dmg && r.name === next.top[i].name)
    )
      return;
    this.strike = next;
    this.strikeListeners.forEach((fn) => fn());
  }

  subscribeStrike = (fn: Listener): (() => void) => {
    this.strikeListeners.add(fn);
    return () => {
      this.strikeListeners.delete(fn);
    };
  };
}

export function useCharView(store: StageStore, id: string): CharView {
  const subscribe = useCallback((fn: Listener) => store.subscribeChar(id, fn), [store, id]);
  const get = useCallback(() => store.char(id), [store, id]);
  return useSyncExternalStore(subscribe, get, get);
}

export function useHpView(store: StageStore): HpView {
  const get = useCallback(() => store.getHp(), [store]);
  return useSyncExternalStore(store.subscribeHp, get, get);
}

export function useBossView(store: StageStore): BossView {
  return useSyncExternalStore(store.subscribeBoss, store.getBoss, store.getBoss);
}

export function useStrike(store: StageStore): StrikeView | null {
  return useSyncExternalStore(store.subscribeStrike, store.getStrike, store.getStrike);
}
