// The outage monitor's fakes (monitor.test.ts). The site as a `fetch`: it records what it was asked and answers
// /api/health, /try and /api/health/deep from a script — a status and a body, a timeout, a network error whose message
// carries the URL (as Deno's does), or a slow answer that moves the clock. The monitor's three functions of migration
// 20261012100000_telegram_bot_monitor.sql in memory, on fakeDb's `on()`: off until a chat is set; a slot is taken only
// forward and at most an hour ahead; the state starts over after a day without a run; a save holds only short codes
// and ISO times (else 22023), merged per check.
import { DbError } from '../db.ts';
import type { FakeDb } from './fake_db.ts';

export const SITE_URL = 'https://ludosiel-studyforge.hf.space';
/** The page of /try as Vite builds it (Release 44.5's bundle). */
export const TRY_PAGE = '<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8" /><title>Meldy</title>'
  + '<script type="module" crossorigin src="/assets/index-C_n_i1Q-.js"></script>'
  + '<link rel="stylesheet" crossorigin href="/assets/index-BqTz7Q2a.css"></head><body><div id="root"></div></body></html>';

type DeepCheck = { ok: boolean; code?: string | null } & Record<string, unknown>;

/** /api/health/deep's answer (backend/health_deep.py): every check up unless given, `ok` from them. */
export function deepBody(checks: Partial<Record<'gemini' | 'groq' | 'tts' | 'supabase', DeepCheck>> = {}, extra: Record<string, unknown> = {}): string {
  const up = (provider: string, model: string | null) => ({ ok: true, provider, model, ms: 412, code: null });
  const all: Record<string, DeepCheck> = {
    gemini: { ...up('Gemini', 'model-main'), fallback: false, tried: [], fast: { ok: true, code: null, detail: null } },
    groq: { ...up('Groq', 'model-main'), detail: null, fast: { model: 'model-fast', ok: true, code: null, detail: null } },
    tts: up('edge-tts', 'voice-1'),
    supabase: up('Supabase', null),
    ...checks,
  };
  return JSON.stringify({
    ok: Object.values(all).every((c) => c.ok === true),
    checked_at: '2026-10-12T02:51:00Z',
    checks: all,
    cached: false,
    age_seconds: 0,
    fresh_in_seconds: 600,
    try: { key: 'own', calls_today: 3, cap: 60, keyword_fallbacks: 0 },
    ...extra,
  });
}

export type SiteAnswer =
  | { status: number; body?: string }
  | { kind: 'timeout' }
  | { kind: 'network' }
  /** Answers after `ms` by the clock (the fake moves it). */
  | { kind: 'slow'; ms: number; status?: number; body?: string };

export interface SiteCall { url: string; path: string; at: number; hasSignal: boolean }

export function fakeSite(clock: { now(): number; advance(ms: number): void }) {
  const calls: SiteCall[] = [];
  const queued = new Map<string, SiteAnswer[]>();
  const standing = new Map<string, SiteAnswer>();
  const DEFAULTS: Record<string, SiteAnswer> = {
    '/api/health': { status: 200, body: '{"status":"ok","groq_configured":true,"gemini_configured":true,"ai":{"provider":null,"model":null,"at":null}}' },
    '/try': { status: 200, body: TRY_PAGE },
    '/api/health/deep': { status: 200, body: deepBody() },
  };

  const fetchFn = async (url: string, init?: RequestInit): Promise<Response> => {
    const u = new URL(url);
    calls.push({ url, path: u.pathname, at: clock.now(), hasSignal: init?.signal instanceof AbortSignal });
    const queue = queued.get(u.pathname);
    const answer = (queue && queue.length > 0 ? queue.shift() : undefined) ?? standing.get(u.pathname) ?? DEFAULTS[u.pathname]
      ?? { status: 404, body: 'Not found' };
    if ('kind' in answer) {
      if (answer.kind === 'timeout') throw new DOMException('The operation timed out.', 'TimeoutError');
      if (answer.kind === 'network') throw new TypeError(`error sending request for url (${url}): connection reset`);
      clock.advance(answer.ms);
      const usual = DEFAULTS[u.pathname];
      return new Response(answer.body ?? (usual && 'body' in usual ? usual.body : '') ?? '', { status: answer.status ?? 200 });
    }
    return new Response(answer.body ?? '', { status: answer.status });
  };

  return {
    fetch: fetchFn,
    calls,
    /** The next answers of a path, once each, in order. */
    once(path: string, ...answers: SiteAnswer[]) {
      queued.set(path, [...(queued.get(path) ?? []), ...answers]);
    },
    /** The path's answer from now on (until `restore`). */
    always(path: string, answer: SiteAnswer) {
      standing.set(path, answer);
    },
    restore(path: string) {
      standing.delete(path);
    },
    /** The paths asked, in order. */
    paths() {
      return calls.map((c) => c.path);
    },
  };
}

export type FakeSite = ReturnType<typeof fakeSite>;

const HOUR = 3_600_000;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

/** One check's saved state as bot_monitor_save takes it. */
function stateOk(v: unknown): boolean {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const r = v as Record<string, unknown>;
  const time = (x: unknown) => x === undefined || x === null || (typeof x === 'string' && ISO.test(x));
  return Object.keys(r).every((k) => ['fails', 'since', 'alerted', 'ok', 'code'].includes(k))
    && /^[0-9]{1,6}$/.test(String(r.fails)) && time(r.since) && time(r.alerted) && time(r.ok)
    && (r.code === undefined || r.code === null || (typeof r.code === 'string' && /^[a-z0-9_]{1,32}$/.test(r.code)));
}

/** bot_monitor_state, bot_monitor_claim and bot_monitor_save on a fakeDb; the returned row is the owner's switch too. */
export function fakeMonitorDb(fdb: FakeDb, now: () => number) {
  const row = {
    /** bot.config.monitor_chat_id: null — off. */
    chatId: null as number | null,
    /** bot.config.monitor_site: null — the bot's site. */
    site: null as string | null,
    /** bot.tick_mode(): every_minute | when_due. */
    tickMode: 'every_minute' as 'every_minute' | 'when_due',
    healthSlot: null as string | null,
    deepSlot: null as string | null,
    /** bot.monitor.checks: per check {fails, since, alerted, ok, code}. */
    checks: {} as Record<string, Record<string, unknown>>,
    saves: [] as Array<Record<string, unknown>>,
  };
  const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));

  fdb.on('bot_monitor_state', () => row.chatId === null
    ? { status: 'off' }
    : { status: 'on', chat_id: row.chatId, site: row.site, tick_mode: row.tickMode, health_slot: row.healthSlot, deep_slot: row.deepSlot,
        checks: copy(row.checks) });

  fdb.on('bot_monitor_claim', (args) => {
    if (row.chatId === null) return { status: 'off' };
    const at = now();
    const take = (p: unknown, stored: string | null) => typeof p === 'string' && Date.parse(p) <= at + HOUR
      && (stored === null || Date.parse(p) > Date.parse(stored));
    const health = take(args.p_health_slot, row.healthSlot);
    const deep = take(args.p_deep_slot, row.deepSlot);
    if (health || deep) {
      const last = Math.max(...[row.healthSlot, row.deepSlot].filter((s): s is string => s !== null).map(Date.parse));
      if (Number.isFinite(last) && last < at - 24 * HOUR) row.checks = {};
      if (health) row.healthSlot = args.p_health_slot as string;
      if (deep) row.deepSlot = args.p_deep_slot as string;
    }
    return { status: 'ok', health, deep, checks: copy(row.checks) };
  });

  fdb.on('bot_monitor_save', (args) => {
    const checks = args.p_checks;
    if (!checks || typeof checks !== 'object' || Array.isArray(checks) || JSON.stringify(checks).length > 4096
      || !Object.entries(checks as Record<string, unknown>).every(([k, v]) => /^[a-z][a-z0-9_]{0,15}$/.test(k) && stateOk(v))) {
      throw new DbError('bot_monitor_save', 400, '22023');
    }
    if (row.chatId === null) return { status: 'off' };
    row.saves.push(copy(checks as Record<string, unknown>));
    row.checks = { ...row.checks, ...copy(checks as Record<string, Record<string, unknown>>) };
    return { status: 'ok' };
  });

  return row;
}

export type FakeMonitorRow = ReturnType<typeof fakeMonitorDb>;
