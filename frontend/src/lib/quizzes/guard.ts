/**
 * «Защита от списывания» of «Контрольная» without React or the DOM's listeners (migration
 * 20261020120000_quiz_protection.sql; the hook that wires it to the page is components/quiz/useGuard.ts).
 *
 * What a page can learn, and so what is recorded (meldy-notes 30_Tech/Codebase_Map.md «Защита от списывания»):
 * - hidden — the page was hidden: another app, the home screen, the lock screen, a call (visibilitychange, pagehide,
 *   freeze);
 * - blur — it lost the focus while still on the screen: an assistant opened over it (Gemini, «Circle to Search»), the
 *   notification shade, a floating window, another window on a computer (window blur with document.hasFocus() false);
 * - split — the window shrank like a split screen or a floating window (media queries against the size at the start);
 * - fullscreen — the strict level's fullscreen ended (fullscreenchange);
 * - copy — a copy of the page's text was tried; paste — text was pasted into an answer; reload — the attempt was opened
 *   again (written by the server, not here).
 * The first four are «counted»: the strict level ends the attempt at its limit. A second phone, a photo of the screen
 * and a screenshot leave no trace a page can see.
 *
 * One time away is one event however many signals it sends (blur, then hidden, then freeze, then pagehide; a call; the
 * screen going dark): an episode opens at the first signal, takes the strongest kind (hidden > split > fullscreen > blur)
 * under the same id, and closes with its duration when the page is back. A new signal within MERGE_MS of the return
 * belongs to the same episode (a shade pulled twice, a fullscreen that ends just after the page came back). The id goes
 * to the server with each version: the server keeps one row an id, so a resend after a reload or a lost connection
 * changes nothing and a later version only makes the kind stronger and adds the duration.
 */

export type GuardKind = 'hidden' | 'blur' | 'split' | 'fullscreen' | 'copy' | 'paste' | 'reload';
export type GuardLevel = 'off' | 'normal' | 'strict';
export type AwayKind = 'hidden' | 'blur' | 'split' | 'fullscreen';

/** One event as quiz_events_add takes it. */
export interface GuardEvent {
  id: string;
  kind: GuardKind;
  /** ISO time the page saw it. */
  at: string;
  /** The question on screen (1-based), null when the layout has none. */
  q: number | null;
  /** How long the page was away; null while it still is (and for copy / paste). */
  ms: number | null;
}

/** The kinds that count towards the strict level's limit (meldy_private.quiz_guard_counted). */
export const COUNTED: ReadonlySet<GuardKind> = new Set<GuardKind>(['hidden', 'blur', 'split', 'fullscreen']);
/** The stronger kind wins inside one episode (meldy_private.quiz_guard_rank). */
export const KIND_RANK: Readonly<Record<GuardKind, number>> = { hidden: 4, split: 3, fullscreen: 2, blur: 1, copy: 0, paste: 0, reload: 0 };

/** A signal this soon after the page came back is the same time away. */
export const MERGE_MS = 1500;
/** Copies (or pastes) closer together than this are one event. */
export const SIGNAL_GAP_MS = 2000;
/** The server's limits: events a call, rows an attempt. */
export const BATCH_MAX = 50;
export const ATTEMPT_MAX = 500;
/** A new event waits this long for others to go with it; two sends are at least SEND_GAP_MS apart. */
export const SEND_DELAY_MS = 4000;
export const SEND_GAP_MS = 3000;
/**
 * A hidden page sends a second later (a page that went to another app still runs its timers by then); a reload never
 * gets there, so its own hiding is not sent. A time away the unloaded page left open, younger than RELOAD_GRACE_MS at
 * the next load, was that reload (GuardQueue.settleUnload).
 */
export const HIDDEN_SEND_MS = 1000;
export const RELOAD_GRACE_MS = 5000;
/** Waits between tries after a failed send (the last one repeats). */
export const GUARD_RETRY_MS = [2000, 5000, 10000, 30000] as const;
/** The strict level's limits the author picks from; 3 by default. */
export const LIMIT_OPTIONS: readonly number[] = [1, 2, 3, 5, 10];
export const DEFAULT_LIMIT = 3;

export function isLevel(value: unknown): value is GuardLevel {
  return value === 'off' || value === 'normal' || value === 'strict';
}

/** The level as the server names it; anything else (an older server) is off. */
export function levelOf(value: unknown): GuardLevel {
  return isLevel(value) ? value : 'off';
}

/** The limit of a strict quiz (1..20), the default for anything unreadable. */
export function limitOf(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 20 ? value : DEFAULT_LIMIT;
}

let counter = 0;
/** An event id: 1..32 of A-Z a-z 0-9 _ -, unique enough for one attempt on one device. */
export function newEventId(now: number = Date.now(), random: () => number = Math.random): string {
  counter = (counter + 1) % 1296;
  return `${now.toString(36)}${counter.toString(36).padStart(2, '0')}${Math.floor(random() * 1679616).toString(36).padStart(4, '0')}`.slice(0, 32);
}

interface Episode {
  id: string;
  kind: AwayKind;
  startedAt: number;
  q: number | null;
}

export interface EpisodesOptions {
  makeId?: () => string;
}

/**
 * The times away of one attempt on this page. away() at each signal, back() when the page is in front again, signal()
 * for copy / paste. Each returns the event to send (a new one, or a new version of the open one), or null when there is
 * nothing new to say.
 */
export class Episodes {
  private open: Episode | null = null;
  /** The last closed episode and when it closed: a signal soon after belongs to it. */
  private last: { episode: Episode; endedAt: number; ms: number } | null = null;
  private signals = new Map<GuardKind, number>();
  private readonly makeId: () => string;
  /** Episodes this page opened (each counted once). */
  opened = 0;

  constructor(options: EpisodesOptions = {}) {
    this.makeId = options.makeId ?? (() => newEventId());
  }

  get isAway(): boolean {
    return this.open !== null;
  }

  get kind(): AwayKind | null {
    return this.open?.kind ?? null;
  }

  away(kind: AwayKind, now: number, q: number | null): GuardEvent | null {
    if (this.open) {
      if (KIND_RANK[kind] <= KIND_RANK[this.open.kind]) return null;
      this.open = { ...this.open, kind };
      return this.event(this.open, null);
    }
    if (this.last && now - this.last.endedAt <= MERGE_MS) {
      // The same time away: it opens again, from its own start, under its id.
      const episode = this.last.episode;
      const stronger = KIND_RANK[kind] > KIND_RANK[episode.kind];
      this.open = { ...episode, kind: stronger ? kind : episode.kind };
      this.last = null;
      return stronger ? this.event(this.open, null) : null;
    }
    this.open = { id: this.makeId(), kind, startedAt: now, q };
    this.opened += 1;
    return this.event(this.open, null);
  }

  back(now: number): GuardEvent | null {
    const episode = this.open;
    if (!episode) return null;
    this.open = null;
    const ms = Math.max(0, Math.min(86_400_000, Math.round(now - episode.startedAt)));
    this.last = { episode, endedAt: now, ms };
    return this.event(episode, ms);
  }

  /** How long the last closed time away lasted (ms), null before the first. */
  get lastMs(): number | null {
    return this.last?.ms ?? null;
  }

  signal(kind: 'copy' | 'paste', now: number, q: number | null): GuardEvent | null {
    const before = this.signals.get(kind);
    if (before !== undefined && now - before < SIGNAL_GAP_MS) return null;
    this.signals.set(kind, now);
    return { id: this.makeId(), kind, at: new Date(now).toISOString(), q, ms: null };
  }

  private event(episode: Episode, ms: number | null): GuardEvent {
    return { id: episode.id, kind: episode.kind, at: new Date(episode.startedAt).toISOString(), q: episode.q, ms };
  }
}

/** Where an attempt's unsent events wait on this device. */
export const guardKey = (attemptId: string) => `quiz:guard:${attemptId}`;

interface Stored {
  event: GuardEvent;
  version: number;
}

function isEvent(value: unknown): value is GuardEvent {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.id === 'string' &&
    /^[A-Za-z0-9_-]{1,32}$/.test(e.id) &&
    typeof e.kind === 'string' &&
    e.kind in KIND_RANK &&
    typeof e.at === 'string' &&
    !Number.isNaN(Date.parse(e.at)) &&
    (e.q === null || (typeof e.q === 'number' && Number.isInteger(e.q) && e.q >= 1 && e.q <= 200)) &&
    (e.ms === null || (typeof e.ms === 'number' && Number.isInteger(e.ms) && e.ms >= 0 && e.ms <= 86_400_000))
  );
}

/** A store of strings (localStorage, or a stand-in in tests). */
export interface KeyStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStore(): KeyStore | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/**
 * The events of an attempt not yet confirmed by the server, kept on the device (they outlive a reload, a closed tab and
 * a lost connection). One entry an id, its latest version; a batch is at most BATCH_MAX; ack() drops what the server
 * took unless a newer version came meanwhile.
 */
export class GuardQueue {
  private items = new Map<string, Stored>();
  private readonly key: string;
  private readonly store: KeyStore | null;

  constructor(attemptId: string, store: KeyStore | null = defaultStore()) {
    this.key = guardKey(attemptId);
    this.store = store;
    try {
      const raw = this.store?.getItem(this.key);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) for (const value of parsed) if (isEvent(value)) this.items.set(value.id, { event: value, version: 0 });
    } catch {
      // An unreadable copy: nothing waits.
    }
  }

  get size(): number {
    return this.items.size;
  }

  put(event: GuardEvent): void {
    const had = this.items.get(event.id);
    this.items.set(event.id, { event, version: (had?.version ?? 0) + 1 });
    this.save();
  }

  /** The oldest BATCH_MAX waiting, with the versions sent (for ack). */
  batch(): { events: GuardEvent[]; versions: Map<string, number> } {
    const entries = [...this.items.values()].slice(0, BATCH_MAX);
    return { events: entries.map((entry) => entry.event), versions: new Map(entries.map((entry) => [entry.event.id, entry.version])) };
  }

  ack(versions: ReadonlyMap<string, number>): void {
    for (const [id, version] of versions) if (this.items.get(id)?.version === version) this.items.delete(id);
    this.save();
  }

  /** The server will not take these (a refused batch): they go. */
  drop(versions: ReadonlyMap<string, number>): void {
    for (const id of versions.keys()) this.items.delete(id);
    this.save();
  }

  /**
   * A new page of the attempt (`loadedAt` — when its navigation began): a time away the last page never closed ended with
   * that page. Opened less than RELOAD_GRACE_MS before this load, it was the reload itself (the server records «reload»,
   * not counted): it goes. Older, the page was away and then gone (another app, the tab closed or dropped): it stays, with
   * the time until this load as its duration. Returns how many went.
   */
  settleUnload(loadedAt: number): number {
    let dropped = 0;
    for (const [id, stored] of [...this.items]) {
      const event = stored.event;
      if (!COUNTED.has(event.kind) || event.ms !== null) continue;
      const at = Date.parse(event.at);
      if (!Number.isFinite(at)) continue;
      if (loadedAt - at <= RELOAD_GRACE_MS) {
        this.items.delete(id);
        dropped += 1;
      } else {
        this.items.set(id, { event: { ...event, ms: Math.max(0, Math.min(86_400_000, Math.round(loadedAt - at))) }, version: stored.version + 1 });
      }
    }
    this.save();
    return dropped;
  }

  private save(): void {
    try {
      if (!this.store) return;
      if (this.items.size === 0) this.store.removeItem(this.key);
      else this.store.setItem(this.key, JSON.stringify([...this.items.values()].map((entry) => entry.event)));
    } catch {
      // Without storage the events still go now; they just cannot outlive a closed tab unsent.
    }
  }
}

/**
 * A split screen or a floating window: the window narrower than SPLIT_WIDTH or lower than SPLIT_HEIGHT of its size at
 * the start (the same orientation). The height alone is not trusted while a text field has the focus (a browser that
 * shrinks the page for the keyboard).
 */
export const SPLIT_WIDTH = 0.75;
export const SPLIT_HEIGHT = 0.6;

export interface Size {
  width: number;
  height: number;
}

export function looksSplit(now: Size, base: Size, typing: boolean): boolean {
  if (!(base.width > 0 && base.height > 0)) return false;
  if (now.width < base.width * SPLIT_WIDTH) return true;
  return !typing && now.height < base.height * SPLIT_HEIGHT;
}

/** The two media queries that turn true when looksSplit would (the engine checks them; no reading of sizes). */
export function splitQueries(base: Size): { width: string; height: string } {
  return {
    width: `(max-width: ${Math.max(1, Math.floor(base.width * SPLIT_WIDTH) - 1)}px)`,
    height: `(max-height: ${Math.max(1, Math.floor(base.height * SPLIT_HEIGHT) - 1)}px)`,
  };
}

/** The attempt ends by itself: a strict quiz at its limit. */
export function overLimit(level: GuardLevel, count: number, limit: number): boolean {
  return level === 'strict' && count >= limit;
}

/** Pauses after failed sends: the n-th failure (1-based). */
export const guardRetryDelay = (failures: number) => GUARD_RETRY_MS[Math.min(Math.max(failures, 1), GUARD_RETRY_MS.length) - 1];
