/**
 * The outage monitor: the tick's step «monitor» (tick.ts: after the steps of spec §6.6, before the beat). The plan's
 * «монитор с сообщением в Telegram» (meldy-notes 10_Project/Project_Review_2026-10-11, Roadmap): on 2026-10-12 the
 * site's voice was down 02:51–03:38 UTC (/api/tts 502 on every new line, /api/health/deep `tts: network`) and nobody
 * was told.
 *
 * OFF until the owner sets bot.config.monitor_chat_id (migration 20261012100000_telegram_bot_monitor.sql): while it is
 * null, bot_monitor_state answers «off» and the step does nothing more. The site is bot.config.monitor_site, else the
 * bot's site (W.SITE).
 *
 * A run checks, each time its slot comes (bot_monitor_claim takes the slot first: two ticks at once never run the same
 * checks):
 *   - every 5 minutes, or on the tick's 15-minute beat in its saving mode (tick_mode when_due):
 *     health — GET /api/health: OK is 200 within 15 s;
 *     try    — GET /try: OK is 200 within 15 s and the page names its index-*.js bundle;
 *   - every 30 minutes:
 *     deep   — GET /api/health/deep (public; the Space keeps its answer 10 minutes): OK is 200 within 20 s with its list
 *              of checks, unless `ok` is false with none of the four below down; then tts, gemini, groq and supabase,
 *              each by its own `ok` and `code`, as of the answer's `checked_at`. While deep itself fails, the four stay
 *              as they were.
 * A timeout or a network error is a failure of that check. A run starts only when its checks end within the tick's
 * budget (tools.deadline); otherwise a later tick of the same slot takes them.
 *
 * The rule, per check: an alert after 2 failures in a row; while it keeps failing, again at most every 6 hours, with how
 * long it has been down; one recovery message when it is OK again, with how long it was down. A run's lines go out as
 * one message to the owner's chat, with sound when one of them is an alert (spec §3's «only the day card rings» is
 * about students' chats; this one is the owner's, who can mute it). A message that did not go out is not recorded: the
 * next run says it again (`alerted` is saved only after a sent alert; a recovery that did not go out keeps the failure
 * open).
 *
 * Messages: plain Russian, UTC times. Never a token, a key, a URL or a provider's text: only the check's path, an HTTP
 * status and short codes held to a plain pattern. The step never throws into the tick; its log lines carry codes only.
 */
import { DbError } from './db.ts';
import { t } from './html.ts';
import { errorName, log } from './log.ts';
import type { Ctx, MonitorPort, StepStats, TickTools } from './router.ts';
import { send, TelegramError, type FetchLike } from './tg.ts';
import { dayText } from '../plan/words.ts';
import * as W from './words.ts';

export type CheckName = 'health' | 'try' | 'deep' | 'tts' | 'gemini' | 'groq' | 'supabase';
/** Every check, in the order of a message's lines. */
export const CHECKS: readonly CheckName[] = ['health', 'try', 'deep', 'tts', 'gemini', 'groq', 'supabase'];
/** The checks of /api/health/deep the monitor reads (backend/health_deep.py CHECK_ORDER). */
export const DEEP_CHECKS = ['tts', 'gemini', 'groq', 'supabase'] as const;

const MIN = 60_000;
const HOUR = 60 * MIN;
/** The slots: the five-minute checks every 5 minutes (every 15 in the tick's saving mode: its beat), deep every 30. */
export const EVERY_MS = 5 * MIN;
export const SAVING_EVERY_MS = 15 * MIN;
export const DEEP_EVERY_MS = 30 * MIN;
/** OK means an answer within this. The deep check waits longer: without a fresh answer the Space asks its providers. */
export const TIMEOUT_MS = 15_000;
export const DEEP_TIMEOUT_MS = 20_000;
/** An alert after this many failures in a row; again at most every REPEAT_MS while it keeps failing. */
export const ALERT_AFTER = 2;
export const REPEAT_MS = 6 * HOUR;
const MAX_FAILS = 999_999;

/** The page of /try names its bundle (Vite: /assets/index-<hash>.js). */
const BUNDLE = /\bindex-[A-Za-z0-9_-]+\.js\b/;
/** A code that may reach a message or the state: an HTTP status or a short word (`network`, `http_503`). */
const CODE = /^[a-z0-9_]{1,32}$/;
/** The site: https and a host (a port at most); no path, query or credentials (the same check as bot.config's). */
const SITE = /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:[0-9]{1,5})?$/;

/** One check's state as bot.monitor.checks keeps it (ISO times; null: none). */
export interface CheckState {
  /** Failures in a row; 0 while OK. */
  fails: number;
  /** When the failure began: its first failed check. */
  since: string | null;
  /** When the failure's last alert went out. */
  alerted: string | null;
  /** When the check was last OK. */
  ok: string | null;
  /** The last failure's code: an HTTP status, timeout, network, no_bundle, bad_json, not_ok or a deep check's own. */
  code: string | null;
}

export const FRESH: CheckState = { fails: 0, since: null, alerted: null, ok: null, code: null };

/** What a run saw of one check, and when (epoch ms). */
export type Seen = { ok: true; at: number } | { ok: false; at: number; code: string };
export type Sight = Partial<Record<CheckName, Seen>>;

/** A line of the message: down (the alert), still (the alert again after 6 hours), up (the recovery). */
export interface Say {
  check: CheckName;
  kind: 'down' | 'still' | 'up';
  /** When the failure began. */
  since: number;
  /** down, still: the run; up: when the check was OK again. */
  at: number;
  code: string | null;
}

const iso = (ms: number) => new Date(ms).toISOString();

// ─────────────────────────────────────────── words (the owner's; plain text, t() glues and escapes) ───────────────────

/** Each check in a line: where it failed (a path of the site, or the deep check's name) and what it means. */
const WHAT: Record<CheckName, { where: string; down: string; up: string }> = {
  health: { where: '/api/health', down: 'сайт не отвечает', up: 'сайт снова отвечает' },
  try: { where: '/try', down: 'не открывается пример без входа', up: 'пример без входа снова открывается' },
  deep: { where: '/api/health/deep', down: 'не проходит проверка сервисов', up: 'проверка сервисов снова проходит' },
  tts: { where: 'tts', down: 'не работает озвучка', up: 'озвучка снова работает' },
  gemini: { where: 'gemini', down: 'не работает Gemini', up: 'Gemini снова работает' },
  groq: { where: 'groq', down: 'не работает Groq', up: 'Groq снова работает' },
  supabase: { where: 'supabase', down: 'не работает Supabase', up: 'Supabase снова работает' },
};

/** «47 мин», «1 ч 5 мин», «6 ч»: at least a minute. */
export function duration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / MIN));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} мин`;
  return rest === 0 ? `${hours} ч` : `${hours} ч ${rest} мин`;
}

/** «02:51» on the run's UTC day; «11 октября 22:51» on another. */
export function utcTime(at: number, now: number): string {
  const d = new Date(at);
  const clock = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  const day = iso(at).slice(0, 10);
  return day === iso(now).slice(0, 10) ? clock : `${dayText(day)} ${clock}`;
}

/** One line (plain text): «Meldy: не работает озвучка (tts: network) с 02:51 UTC.», «Meldy: озвучка снова работает, перерыв 47 мин.» */
export function lineOf(say: Say, now: number): string {
  const what = WHAT[say.check];
  if (say.kind === 'up') return `Meldy: ${what.up}, перерыв ${duration(say.at - say.since)}.`;
  const down = `Meldy: ${what.down} (${what.where}: ${say.code ?? 'other'}) с ${utcTime(say.since, now)} UTC`;
  return say.kind === 'still' ? `${down}, уже ${duration(say.at - say.since)}.` : `${down}.`;
}

/** The run's message for parse_mode HTML: its lines, glued and escaped. */
export function monitorText(said: Say[], now: number): string {
  return said.map((say) => t(lineOf(say, now))).join('\n');
}

// ─────────────────────────────────────────── the rule (pure) ───────────────────────────────────────────

/** What a check's new result says: the alert, the alert again, the recovery, or nothing (null). */
export function judge(check: CheckName, prev: CheckState, seen: Seen, now: number): Say | null {
  if (seen.ok) {
    if (prev.alerted === null || prev.since === null) return null;
    // A recovery the owner was not told yet (its message did not go out) ended at its first OK.
    const end = prev.fails === 0 && prev.ok !== null ? Date.parse(prev.ok) : seen.at;
    return { check, kind: 'up', since: Date.parse(prev.since), at: end, code: prev.code };
  }
  const since = prev.since !== null ? Date.parse(prev.since) : seen.at;
  if (prev.alerted === null) return prev.fails + 1 >= ALERT_AFTER ? { check, kind: 'down', since, at: now, code: seen.code } : null;
  return now - Date.parse(prev.alerted) >= REPEAT_MS ? { check, kind: 'still', since, at: now, code: seen.code } : null;
}

/** The check's state after the run. `sent`: the run's message went out. */
export function settle(prev: CheckState, seen: Seen, say: Say | null, sent: boolean, now: number): CheckState {
  if (seen.ok) {
    // Not told yet: the failure stays open, with its first OK, and the next run says the recovery.
    if (say && !sent) return { ...prev, fails: 0, ok: iso(say.at) };
    return { fails: 0, since: null, alerted: null, ok: iso(seen.at), code: null };
  }
  return {
    fails: Math.min(prev.fails + 1, MAX_FAILS),
    since: prev.since ?? iso(seen.at),
    alerted: say !== null && sent ? iso(now) : prev.alerted,
    ok: prev.ok,
    code: seen.code,
  };
}

// ─────────────────────────────────────────── the site ───────────────────────────────────────────

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {});
const codeOf = (v: unknown): string => (typeof v === 'string' && CODE.test(v) ? v : 'other');
const failed = (at: number, code: string): Seen => ({ ok: false, at, code });

/** The answer's `checked_at` when it is sane (the Space keeps an answer 10 minutes), else the run's time. */
function observedAt(value: unknown, at: number): number {
  const when = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isFinite(when) && when >= at - 15 * MIN && when <= at + MIN ? Math.min(when, at) : at;
}

/** /api/health/deep's 200 → deep and its four checks. Only `ok`, `checks.<name>.ok`, `.code` and `checked_at` are read. */
export function readDeep(body: string, at: number): Sight {
  let data: Raw;
  try {
    data = obj(JSON.parse(body));
  } catch {
    return { deep: failed(at, 'bad_json') };
  }
  const checks = data.checks;
  if (!checks || typeof checks !== 'object' || Array.isArray(checks)) return { deep: failed(at, 'bad_json') };
  const when = observedAt(data.checked_at, at);
  const out: Sight = {};
  for (const name of DEEP_CHECKS) {
    const check = obj((checks as Raw)[name]);
    if (check.ok === true) out[name] = { ok: true, at: when };
    else if (check.ok === false) out[name] = failed(when, codeOf(check.code));
  }
  // `ok` false with none of the four down: a check the monitor does not know failed.
  const named = DEEP_CHECKS.some((name) => out[name]?.ok === false);
  out.deep = data.ok === false && !named ? failed(at, 'not_ok') : { ok: true, at };
  return out;
}

type Answer = { status: number; body: string } | { failure: 'timeout' | 'network' };

/** One GET within its limit, by the run's clock too: an answer later than the limit is a timeout. */
async function get(fetchFn: FetchLike, url: string, limitMs: number, now: () => number): Promise<Answer> {
  const started = now();
  try {
    const res = await fetchFn(url, { method: 'GET', signal: AbortSignal.timeout(limitMs) });
    const body = await res.text();
    return now() - started > limitMs ? { failure: 'timeout' } : { status: res.status, body };
  } catch (error) {
    // Only the kind of failure: an error's message can carry the URL.
    const name = errorName(error);
    return { failure: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network' };
  }
}

/** The claimed checks, side by side. */
async function checkSite(fetchFn: FetchLike, site: string, claim: { health: boolean; deep: boolean }, at: number,
  now: () => number): Promise<Sight> {
  const [health, page, deep] = await Promise.all([
    claim.health ? get(fetchFn, `${site}/api/health`, TIMEOUT_MS, now) : null,
    claim.health ? get(fetchFn, `${site}/try`, TIMEOUT_MS, now) : null,
    claim.deep ? get(fetchFn, `${site}/api/health/deep`, DEEP_TIMEOUT_MS, now) : null,
  ]);
  const out: Sight = {};
  if (health) {
    out.health = 'failure' in health ? failed(at, health.failure) : health.status === 200 ? { ok: true, at } : failed(at, String(health.status));
  }
  if (page) {
    if ('failure' in page) out.try = failed(at, page.failure);
    else if (page.status !== 200) out.try = failed(at, String(page.status));
    else out.try = BUNDLE.test(page.body) ? { ok: true, at } : failed(at, 'no_bundle');
  }
  if (deep) {
    if ('failure' in deep) out.deep = failed(at, deep.failure);
    else if (deep.status !== 200) out.deep = failed(at, String(deep.status));
    else Object.assign(out, readDeep(deep.body, at));
  }
  return out;
}

// ─────────────────────────────────────────── the database (bot_monitor_*) ───────────────────────────────────────────

function toCheckState(raw: unknown): CheckState {
  const r = obj(raw);
  const time = (v: unknown) => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null);
  return {
    fails: typeof r.fails === 'number' && Number.isInteger(r.fails) && r.fails >= 0 ? Math.min(r.fails, MAX_FAILS) : 0,
    since: time(r.since),
    alerted: time(r.alerted),
    ok: time(r.ok),
    code: typeof r.code === 'string' && CODE.test(r.code) ? r.code : null,
  };
}

function toChecks(raw: unknown): Partial<Record<CheckName, CheckState>> {
  const r = obj(raw);
  const out: Partial<Record<CheckName, CheckState>> = {};
  for (const name of CHECKS) if (r[name] && typeof r[name] === 'object') out[name] = toCheckState(r[name]);
  return out;
}

const slotOf = (at: number, every: number) => Math.floor(at / every) * every;
const slotAt = (v: unknown): number | null => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? Date.parse(v) : null);

interface MonitorState { chatId: number; site: string; saving: boolean; healthSlot: number | null; deepSlot: number | null }

/** bot_monitor_state → what a run needs; null when the monitor is off. */
export function toMonitorState(raw: unknown): MonitorState | null {
  const r = obj(raw);
  const chatId = typeof r.chat_id === 'number' && Number.isSafeInteger(r.chat_id) && r.chat_id !== 0 ? r.chat_id : null;
  if (r.status !== 'on' || chatId === null) return null;
  return {
    chatId,
    site: typeof r.site === 'string' && SITE.test(r.site) ? r.site : W.SITE,
    saving: r.tick_mode === 'when_due',
    healthSlot: slotAt(r.health_slot),
    deepSlot: slotAt(r.deep_slot),
  };
}

// ─────────────────────────────────────────── the step ───────────────────────────────────────────

const add = (stats: StepStats, key: string, n = 1) => {
  stats[key] = (stats[key] ?? 0) + n;
};

async function run(ctx: Ctx, tools: TickTools, fetchFn: FetchLike): Promise<StepStats> {
  let raw: unknown;
  try {
    raw = await ctx.db.rpc<unknown>('bot_monitor_state');
  } catch (error) {
    // The migration is not applied yet: nothing to do.
    if (error instanceof DbError && (error.code === 'PGRST202' || error.status === 404)) return { missing: 1 };
    throw error;
  }
  const state = toMonitorState(raw);
  if (!state) return {};
  const stats: StepStats = {};
  const at = ctx.now();
  const healthSlot = slotOf(at, state.saving ? SAVING_EVERY_MS : EVERY_MS);
  const deepSlot = slotOf(at, DEEP_EVERY_MS);
  const wantHealth = state.healthSlot === null || state.healthSlot < healthSlot;
  const wantDeep = state.deepSlot === null || state.deepSlot < deepSlot;
  if (!wantHealth && !wantDeep) return stats;
  // The checks run side by side and end by the deadline; what does not fit waits for a later tick of its slot.
  const fitHealth = wantHealth && at + TIMEOUT_MS <= tools.deadline;
  const fitDeep = wantDeep && at + DEEP_TIMEOUT_MS <= tools.deadline;
  if ((wantHealth && !fitHealth) || (wantDeep && !fitDeep)) add(stats, 'late');
  if (!fitHealth && !fitDeep) return stats;
  const claim = obj(await ctx.db.rpc<unknown>('bot_monitor_claim', {
    p_health_slot: fitHealth ? iso(healthSlot) : null,
    p_deep_slot: fitDeep ? iso(deepSlot) : null,
  }));
  if (claim.status !== 'ok') return stats;
  const taken = { health: claim.health === true, deep: claim.deep === true };
  if (!taken.health && !taken.deep) {
    add(stats, 'busy'); // another tick has this slot
    return stats;
  }
  const prev = toChecks(claim.checks);
  const sight = await checkSite(fetchFn, state.site, taken, at, ctx.now);
  const said: Say[] = [];
  for (const check of CHECKS) {
    const seen = sight[check];
    if (!seen) continue;
    add(stats, 'checked');
    if (!seen.ok) add(stats, 'failed');
    const say = judge(check, prev[check] ?? FRESH, seen, at);
    if (say) said.push(say);
  }
  let sent = false;
  if (said.length > 0) {
    const alerts = said.filter((say) => say.kind !== 'up').length;
    if (alerts > 0) add(stats, 'alerts', alerts);
    if (said.length > alerts) add(stats, 'recoveries', said.length - alerts);
    // As every step: work starts only before the deadline. Not sent now, said by the next run.
    if (ctx.now() <= tools.deadline) {
      await tools.pace();
      try {
        await send(ctx.tg, { chatId: state.chatId, text: monitorText(said, at), sound: alerts > 0 });
        sent = true;
      } catch (error) {
        log({ route: 'tick', kind: 'monitor', outcome: 'failed', error_name: errorName(error), tg_code: error instanceof TelegramError ? error.code : undefined });
      }
    }
    add(stats, sent ? 'sent' : 'unsent');
  }
  const next: Partial<Record<CheckName, CheckState>> = {};
  for (const check of CHECKS) {
    const seen = sight[check];
    if (seen) next[check] = settle(prev[check] ?? FRESH, seen, said.find((say) => say.check === check) ?? null, sent, at);
  }
  await ctx.db.rpc('bot_monitor_save', { p_checks: next });
  return stats;
}

/** The step: never throws into the tick (a failure is one log line with its name, and `error` in the tick's numbers). */
export async function monitorTick(ctx: Ctx, tools: TickTools, fetchFn: FetchLike): Promise<StepStats> {
  try {
    return await run(ctx, tools, fetchFn);
  } catch (error) {
    log({ route: 'tick', kind: 'monitor', outcome: 'failed', error_name: errorName(error) });
    return { error: 1 };
  }
}

/** The port (telegram/index.ts): the site is reached with the function's own fetch. */
export function createMonitor(deps: { fetch: FetchLike }): MonitorPort {
  return { tick: (ctx, tools) => monitorTick(ctx, tools, deps.fetch) };
}
