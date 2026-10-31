/**
 * What the teacher's tab keeps between reloads (sessionStorage, this tab only): the host token (CONTRACT §7,
 * `meldy.live.host.<game_id>`), the game's name and links from «Открыть комнату», and the questions as they were
 * played, for «Разбор». Every read and write survives a refused storage (private mode): the screen then simply
 * forgets on reload.
 */
import type { FakeOptions } from '../../../lib/live/fake';
import type { GameSource, HostState, Settings } from '../../../lib/live/types';
import type { Seats } from './layout';

const TOKEN = (id: string) => `meldy.live.host.${id}`;
const INFO = (id: string) => `meldy.live.hostinfo.${id}`;
const LOG = (id: string) => `meldy.live.hostlog.${id}`;
const SEATS = (id: string) => `meldy.live.hostseats.${id}`;

function read(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    /* storage refused */
  }
}

export function readHostToken(gameId: string): string | null {
  const t = read(TOKEN(gameId));
  return t && /^[A-Za-z0-9_-]{20,100}$/.test(t) ? t : null;
}

export function saveHostToken(gameId: string, token: string): void {
  write(TOKEN(gameId), token);
}

export interface HostInfo {
  title: string | null;
  joinUrl: string | null;
  containerId: string | null;
  quizId: string | null;
  source: GameSource | null;
  settings: Settings | null;
}

export function readHostInfo(gameId: string): HostInfo | null {
  const raw = read(INFO(gameId));
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<HostInfo>;
    return {
      title: typeof v.title === 'string' ? v.title : null,
      joinUrl: typeof v.joinUrl === 'string' ? v.joinUrl : null,
      containerId: typeof v.containerId === 'string' ? v.containerId : null,
      quizId: typeof v.quizId === 'string' ? v.quizId : null,
      source: v.source ?? null,
      settings: v.settings ?? null,
    };
  } catch {
    return null;
  }
}

export function saveHostInfo(gameId: string, info: HostInfo): void {
  write(INFO(gameId), JSON.stringify(info));
}

/** One played question as the screen saw it: the text at countdown, the key and counts at reveal. */
export interface LoggedQuestion {
  qi: number;
  text: string;
  options: string[];
  key: number | null;
  /** Several right answers: every right option; a text answer: its accepted forms (absent in an older log). */
  keys?: number[] | null;
  forms?: string[] | null;
  /** A number question (20261102090100_live_numbers.sql): its kind, tolerance and unit (absent in an older log). */
  kind?: 'number';
  tolerance?: number | null;
  unit?: string | null;
  counts: number[] | null;
  right: number | null;
  players: number;
}

export function readLog(gameId: string): LoggedQuestion[] {
  const raw = read(LOG(gameId));
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as LoggedQuestion[];
    return Array.isArray(v) ? v.filter((q) => q && typeof q.qi === 'number' && typeof q.text === 'string' && Array.isArray(q.options)) : [];
  } catch {
    return [];
  }
}

/** Adds what this state tells about its question; returns the log (the same array when nothing new). */
export function logState(gameId: string, log: LoggedQuestion[], s: HostState): LoggedQuestion[] {
  const q = s.question;
  if (!q) return log;
  const at = log.findIndex((x) => x.qi === q.qi);
  const was = at >= 0 ? log[at] : null;
  const result = s.result && s.result.qi === q.qi ? s.result : null;
  const next: LoggedQuestion = {
    qi: q.qi,
    text: q.text,
    options: q.options,
    key: result ? result.key : (was?.key ?? null),
    keys: result ? (result.keys ?? null) : (was?.keys ?? null),
    forms: result ? (result.forms ?? null) : (was?.forms ?? null),
    ...(q.kind === 'number'
      ? { kind: 'number' as const, tolerance: result ? (result.tolerance ?? null) : (was?.tolerance ?? null), unit: result ? (result.unit ?? q.unit ?? null) : (was?.unit ?? q.unit ?? null) }
      : {}),
    counts: result ? result.counts : (was?.counts ?? null),
    right: result ? result.right : (was?.right ?? null),
    players: result ? s.players : (was?.players ?? s.players),
  };
  if (was && was.key === next.key && was.text === next.text && was.right === next.right && was.players === next.players) return log;
  const out = log.slice();
  if (at >= 0) out[at] = next;
  else out.push(next);
  out.sort((a, b) => a.qi - b.qi);
  write(LOG(gameId), JSON.stringify(out));
  return out;
}

/** The arena's seats as they were (a reload keeps everyone where they sat; layout.ts seats()). */
export function readSeats(gameId: string): Seats | null {
  const raw = read(SEATS(gameId));
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { of?: unknown; count?: unknown };
    if (!Array.isArray(v.of) || typeof v.count !== 'number') return null;
    const of = new Map<string, number>();
    for (const pair of v.of) {
      if (Array.isArray(pair) && typeof pair[0] === 'string' && Number.isInteger(pair[1]) && pair[1] >= 0) of.set(pair[0], pair[1]);
    }
    return { of, count: Math.max(v.count, ...[...of.values()].map((x) => x + 1), 0) };
  } catch {
    return null;
  }
}

export function saveSeats(gameId: string, seats: Seats): void {
  write(SEATS(gameId), JSON.stringify({ of: [...seats.of], count: seats.count }));
}

/**
 * Knobs of the fake server for development and the browser runs, read from the address only when the fake is on:
 * `bots=30` (players besides the bots' default 23), `fast=1` (bots answer in 1–3 s).
 */
export function fakeKnobs(search: string): FakeOptions {
  const p = new URLSearchParams(search);
  const out: FakeOptions = {};
  const bots = p.has('bots') ? Number(p.get('bots')) : NaN;
  if (Number.isInteger(bots) && bots >= 0 && bots <= 300) out.bots = bots;
  if (p.get('fast') === '1') out.fastBots = true;
  return out;
}
