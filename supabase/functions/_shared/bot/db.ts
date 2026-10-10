/**
 * The bot's database: only `POST /rest/v1/rpc/bot_*` with the service role (spec decision 3, §6.4). No table reads, no
 * direct connection string; a test greps the bot's code for both.
 *
 * `BotDb` is the one interface the bot uses; `createDb` maps the JSON of T1's SQL functions onto it
 * (supabase/functions/_shared/bot/CONTRACT_T1.md, migration 20261010120000_telegram_bot.sql). Bot functions answer
 * input problems with statuses; they raise only 42501 (not the service role) and 22023 (a call the code never means).
 * `rpc()` reaches any other `bot_*` function (the session's, T5/T6; the group's, T7/T8).
 *
 * `bot_whoami`, `bot_settings` and `bot_today` mark the user as seen (a reminder then waits 30 minutes, K2's silence
 * ends): call them only for updates the user sent, never from the tick.
 *
 * Keys: the new secret key (`sb_secret_…`) goes on the `apikey` header only; a legacy service_role JWT also goes on
 * `Authorization: Bearer` (Supabase docs, «Migrating to publishable and secret API keys»). The responses come gzipped
 * (Deno's fetch asks for it and decompresses).
 */
import type { ContainersOverview, LocalDay, PlanInputsWire, PlanItem } from '../plan/container.ts';
import type { FetchLike } from './tg.ts';

export type BotRpcName = `bot_${string}`;

/** A failed RPC: PostgREST's code (42501, 22023, PGRST202…) and the HTTP status; never the URL, the key or the details. */
export class DbError extends Error {
  readonly fn: string;
  readonly status: number;
  readonly code: string;

  constructor(fn: string, status: number, code: string) {
    super(`db ${fn} ${status}${code ? ` ${code}` : ''}`);
    this.name = 'DbError';
    this.fn = fn;
    this.status = status;
    this.code = code;
  }
}

// ─────────────────────────────────────────── shapes ───────────────────────────────────────────

export type UpdateBegin = 'new' | 'retry' | 'done' | 'busy';

/** The function's pending ForceReply (M4 time, S3 date), kept in bot.links.prompt (≤ 1 KB). */
export interface Prompt {
  kind: 'time' | 'date';
  /** The prompt message (the user replies to it). */
  promptId: number;
  /** The message that changes after the answer (M2 → M3, S1, S3 → the pause); null: post anew. */
  targetId: number | null;
  from: 'link' | 'settings';
  /** When it was asked (epoch s): a prompt older than an hour no longer takes plain text. */
  at: number | null;
}

/** LINK (`bot.link_json`) of a Telegram user; `tgUserId` is the caller's (the JSON has no ids but the chat's). */
export interface Link {
  tgUserId: number;
  chatId: number;
  blocked: boolean;
  remindOn: boolean;
  /** Minutes after local midnight (20:00 → 1200). */
  remindAt: number;
  tz: string;
  /** The first day the card comes again; only while it is after today. */
  pausedUntil: LocalDay | null;
  prompt: Prompt | null;
  /** Today in the link's zone, by the server's clock. */
  today: LocalDay;
  /** The local clock, minutes after midnight. */
  localTime: number;
  /** The server's clock, epoch ms. */
  now: number;
}

/** bot_whoami's exams (nearest date first). */
export interface ExamRow { id: string; title: string; examDate: LocalDay | null; lastDate: LocalDay | null; role: 'owner' | 'member' }

export type Who = { linked: false } | ({ linked: true } & Link & { exams: ExamRow[] });

export type ClaimStatus = 'linked' | 'used' | 'expired' | 'invalid' | 'slow_down' | 'private_only';
export interface ClaimResult {
  status: ClaimStatus;
  /** The chat this Meldy account was linked to before (M6 goes there once). */
  replacedChatId: number | null;
}

export type ChatEvent = 'stop' | 'blocked' | 'unblocked';

/**
 * What `bot_settings` may change. `remind_at` 'H:MM' (07:00–22:59; turns the plan on unless `remind_on` is given);
 * `paused_until` after today and within 366 days, or null; `prompt` or null; `hint: true` asks whether S6 may go now
 * (true at most once an hour); `ask` = the answer to the last K2 (kept for the pilot's numbers). `{}` only marks the
 * user as seen.
 */
export interface SettingsPatch {
  remind_at?: string;
  remind_on?: boolean;
  tz?: string;
  paused_until?: LocalDay | null;
  prompt?: { kind: Prompt['kind']; prompt_id: number; target_id: number | null; from: Prompt['from']; at: number } | null;
  hint?: true;
  ask?: 'yes' | 'pause' | 'stop';
}

export type SettingsResult =
  | { status: 'ok'; link: Link; hint: boolean | null }
  | { status: 'invalid'; field: string | null; reason: 'unknown' | 'format' | 'range' | 'past' | 'far' | string }
  | { status: 'unlinked' };

/** The open «занятие» (T5's bot.sessions row), as /today needs it. */
export interface OpenSession {
  sid: string;
  containerId: string;
  subjectId: string;
  messageId: number | null;
  chatId: number | null;
  position: number;
  queue: Array<{ id: string; retry: 0 | 1 | 2 }>;
  localDay: LocalDay;
  kind: 'plan' | 'errors' | 'extra';
}

/** Facts about an exam the plan input does not carry (from containers_overview_for). */
export interface ExamMeta {
  id: string;
  createdAt: string | null;
  /** Answered items whose key the author changed since («Автор исправил ключ…», members only): the subjects' `stale`. */
  keyChanges: number;
  /** A subject has an oral part: its questions are planned on the site («Устные — в Meldy»). */
  hasOral: boolean;
}

/** Everything a card needs, read once: bot_today, or bot_reminder_context in the tick. */
export interface Today {
  link: Link;
  /** The server's clock, epoch ms. */
  now: number;
  /** plan_inputs_for the user: every exam in one wire (decoded per exam with the copied planInputs.ts). */
  wire: PlanInputsWire | null;
  /**
   * The oral questions of every exam as the plan's items. Empty until package T11 (`bot_oral_inputs` + the container's
   * `oralParts.ts`) fills it: card.ts `planInputOf` is the one place a plan input is built, and it passes these on.
   */
  oral: PlanItem[];
  exams: ExamMeta[];
  session: OpenSession | null;
  /** Today's bot.days row: the card and the last summary. */
  day: { cardMessageId: number | null; cardUsed: boolean; lastMessageId: number | null } | null;
}

export interface ReminderRow { deliveryId: number; chatId: number; localDay: LocalDay; tz: string }

export type ReminderContext =
  | { card: 'skip'; deliveryId: number; reason: string }
  | { card: 'K1' | 'K2'; deliveryId: number; chatId: number; localDay: LocalDay; today: Today };

export interface DayCloseRow {
  deliveryId: number;
  chatId: number;
  localDay: LocalDay;
  /** null when the card was used or there was none. */
  cardMessageId: number | null;
  /** The last summary of the day: its keyboard comes off. */
  lastMessageId: number | null;
}

export interface AfterDateRow {
  deliveryId: number;
  chatId: number;
  localDay: LocalDay;
  containerId: string;
  /** null: the exam was deleted meanwhile (close the row as skipped, `gone`). */
  exam: {
    title: string;
    examDate: LocalDay | null;
    lastDate: LocalDay;
    firstPlanDay: LocalDay | null;
    activeDays: number;
    answers: number;
    twoDays: number;
    keyed: number;
  } | null;
}

export interface BotStatus {
  configured: boolean;
  botUsername: string | null;
  functionRegion: string | null;
  /** every_minute, or when_due once this month's calls pass 60 % of the free plan (spec §10). */
  tickMode: string | null;
  lastSetupAt: string | null;
  lastTickAt: string | null;
  lastTick: unknown;
  calls: { month: string | null; updates: number; ticks: number; total: number };
  ledger: { started: number; failed: number; done: number };
}

export interface BotDb {
  /** Any `bot_*` function (the session's and the group's packages call theirs through this). */
  rpc<T = unknown>(fn: BotRpcName, args?: Record<string, unknown>): Promise<T>;

  updateBegin(updateId: number): Promise<UpdateBegin>;
  updateDone(updateId: number): Promise<void>;
  updateFailed(updateId: number, errorName: string): Promise<void>;

  /** `functionUrl` = `https://<ref>.supabase.co/functions/v1/telegram` exactly; `functionRegion` = setup.ts FUNCTION_REGION. */
  setup(args: { username: string; botId: number; tickToken: string; functionUrl: string; functionRegion: string }): Promise<{ status: 'ok' | 'slow_down'; retryAfter: number | null }>;
  status(): Promise<BotStatus>;
  tickBeat(stats: Record<string, number>): Promise<void>;

  linkClaim(args: { code: string; tgUserId: number; chatId: number; lang: string | null; messageDate: number }): Promise<ClaimResult>;
  chatEvent(tgUserId: number, event: ChatEvent): Promise<void>;
  whoami(tgUserId: number): Promise<Who>;
  settings(tgUserId: number, patch: SettingsPatch): Promise<SettingsResult>;

  today(tgUserId: number): Promise<Today | null>;
  /** card: a /today K1 went out (→ an earlier unused card to delete); used: a card became a session; last: a summary (→ the previous one's keyboard comes off). */
  cardSent(tgUserId: number, messageId: number, event: 'card' | 'used' | 'last'): Promise<{ prevMessageId: number | null }>;
  claimReminders(limit: number): Promise<ReminderRow[]>;
  reminderContext(deliveryId: number): Promise<ReminderContext>;
  /** true: send now; false: do NOT send (taken, given up, the link ended or was blocked). Right before the call to Telegram. */
  deliverySending(deliveryId: number): Promise<boolean>;
  /** sent (+ message id) | failed | skipped (+ a short reason). A sent K1 returns an unused /today card of that day to delete. */
  deliveryDone(deliveryId: number, status: 'sent' | 'failed' | 'skipped', messageId?: number | null, error?: string | null): Promise<{ prevCardMessageId: number | null }>;
  claimDayClose(limit: number): Promise<DayCloseRow[]>;
  claimAfterDate(limit: number): Promise<AfterDateRow[]>;
}

// ─────────────────────────────────────────── raw JSON → shapes ───────────────────────────────────────────

type Raw = Record<string, unknown>;

const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {});
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null;
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const day = (v: unknown): LocalDay | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const rows = (v: unknown): Raw[] => (Array.isArray(v) ? v.map(obj) : []);

/** '20:00' / '7:45' / '20:00:00' → minutes after midnight. */
export function minutesOf(value: unknown): number | null {
  const m = typeof value === 'string' ? /^(\d{1,2}):(\d{2})(:\d{2})?$/.exec(value.trim()) : null;
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h < 24 && mi < 60 ? h * 60 + mi : null;
}

/** 1200 → '20:00' (bot_settings' remind_at). */
export function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function toPrompt(raw: unknown): Prompt | null {
  const p = obj(raw);
  const kind = p.kind === 'time' || p.kind === 'date' ? p.kind : null;
  const promptId = num(p.prompt_id);
  if (!kind || promptId === null) return null;
  return { kind, promptId, targetId: num(p.target_id), from: p.from === 'link' ? 'link' : 'settings', at: num(p.at) };
}

/** LINK → Link; null when it is not a link. */
export function toLink(raw: unknown, tgUserId: number): Link | null {
  const r = obj(raw);
  if (r.linked !== true) return null;
  const chatId = num(r.chat_id);
  const remindAt = minutesOf(r.remind_at);
  const tz = str(r.tz);
  const today = day(r.local_day);
  if (chatId === null || remindAt === null || !tz || !today) return null;
  const now = num(r.now);
  return {
    tgUserId,
    chatId,
    blocked: r.blocked === true,
    remindOn: r.remind_on !== false,
    remindAt,
    tz,
    pausedUntil: day(r.paused_until),
    prompt: toPrompt(r.prompt),
    today,
    localTime: minutesOf(r.local_time) ?? 0,
    now: now !== null ? now * 1000 : Date.now(),
  };
}

export function toWho(raw: unknown, tgUserId: number): Who {
  const link = toLink(raw, tgUserId);
  if (!link) return { linked: false };
  const exams: ExamRow[] = rows(obj(raw).exams).map((e) => ({
    id: str(e.id) ?? '',
    title: str(e.title) ?? '',
    examDate: day(e.exam_date),
    lastDate: day(e.last_date),
    role: (e.role === 'owner' ? 'owner' : 'member') as ExamRow['role'],
  })).filter((e) => e.id !== '');
  return { linked: true, ...link, exams };
}

export function toSession(raw: unknown): OpenSession | null {
  const r = obj(raw);
  const sid = str(r.sid);
  if (!sid) return null;
  const items = Array.isArray(r.items) ? r.items.map(String) : [];
  const retry = Array.isArray(r.retry) ? r.retry.map((x) => Number(x) || 0) : [];
  const kind = str(r.kind);
  return {
    sid,
    containerId: str(r.container_id) ?? '',
    subjectId: str(r.subject_id) ?? '',
    messageId: num(r.message_id),
    chatId: num(r.chat_id),
    position: num(r.position) ?? 0,
    queue: items.map((id, i) => ({ id, retry: Math.max(0, Math.min(2, retry[i] ?? 0)) as 0 | 1 | 2 })),
    localDay: day(r.local_day) ?? '',
    kind: kind === 'errors' || kind === 'extra' ? kind : 'plan',
  };
}

/** containers_overview_for → what the card needs beyond the plan (created_at for ties, the members' changed keys). */
export function examMeta(overview: unknown): ExamMeta[] {
  const containers = rows(obj(overview).containers) as unknown as ContainersOverview['containers'];
  return containers.map((c) => ({
    id: String(c.id ?? ''),
    createdAt: typeof c.created_at === 'string' ? c.created_at : null,
    keyChanges: c.role === 'member' ? (Array.isArray(c.subjects) ? c.subjects : []).reduce((sum, s) => sum + (num(s.stale) ?? 0), 0) : 0,
    hasOral: (Array.isArray(c.subjects) ? c.subjects : []).some((s) => s.has_oral === true),
  })).filter((e) => e.id !== '');
}

function toWire(raw: unknown): PlanInputsWire | null {
  const w = obj(raw);
  return Array.isArray(w.containers) && Array.isArray(w.subjects) && Array.isArray(w.items) ? (w as unknown as PlanInputsWire) : null;
}

/** bot_today → Today; null when the Telegram user is not linked. */
export function toToday(raw: unknown, tgUserId: number): Today | null {
  const r = obj(raw);
  if (r.linked !== true) return null;
  const link = toLink(r.link, tgUserId);
  if (!link) return null;
  const d = r.day ? obj(r.day) : null;
  return {
    link,
    now: link.now,
    wire: toWire(r.plan),
    oral: [],
    exams: examMeta(r.overview),
    session: r.session ? toSession(r.session) : null,
    day: d ? { cardMessageId: num(d.card_message_id), cardUsed: d.card_used === true, lastMessageId: num(d.last_message_id) } : null,
  };
}

const CLAIM_STATUSES: readonly ClaimStatus[] = ['linked', 'used', 'expired', 'invalid', 'slow_down', 'private_only'];

export function toClaim(raw: unknown): ClaimResult {
  const r = obj(raw);
  const status = CLAIM_STATUSES.includes(r.status as ClaimStatus) ? (r.status as ClaimStatus) : 'invalid';
  return { status, replacedChatId: num(r.replaced_chat_id) };
}

export function toSettings(raw: unknown, tgUserId: number): SettingsResult {
  const r = obj(raw);
  if (r.status === 'ok') {
    const link = toLink(r.link, tgUserId);
    if (link) return { status: 'ok', link, hint: typeof r.hint === 'boolean' ? r.hint : null };
  }
  if (r.status === 'invalid') return { status: 'invalid', field: str(r.field), reason: str(r.reason) ?? 'format' };
  return { status: 'unlinked' };
}

export function toReminderContext(raw: unknown, deliveryId: number): ReminderContext {
  const r = obj(raw);
  const card = r.card;
  if ((card === 'K1' || card === 'K2') && r.status === 'ok') {
    const chatId = num(r.chat_id) ?? 0;
    const link = toLink(r.link, chatId);
    if (link) {
      return {
        card,
        deliveryId,
        chatId,
        localDay: day(r.local_day) ?? link.today,
        today: { link, now: link.now, wire: toWire(r.plan), oral: [], exams: examMeta(r.overview), session: null, day: null },
      };
    }
  }
  return { card: 'skip', deliveryId, reason: str(r.reason) ?? 'not_claimed' };
}

// ─────────────────────────────────────────── the PostgREST client ───────────────────────────────────────────

export interface DbOptions {
  /** SUPABASE_URL */
  url: string;
  /** The secret key (sb_secret_…) or the legacy service_role JWT. */
  key: string;
  fetch: FetchLike;
  timeoutMs?: number;
}

export function createDb(options: DbOptions): BotDb {
  const base = options.url.replace(/\/+$/, '');
  const legacy = !options.key.startsWith('sb_');
  const timeoutMs = options.timeoutMs ?? 10_000;

  async function rpc<T>(fn: BotRpcName, args: Record<string, unknown> = {}): Promise<T> {
    if (!/^bot_[a-z0-9_]{1,60}$/.test(fn)) throw new DbError(fn, 0, 'bad_name');
    const headers: Record<string, string> = { apikey: options.key, 'Content-Type': 'application/json', Accept: 'application/json' };
    if (legacy) headers.Authorization = `Bearer ${options.key}`;
    let res: Response;
    try {
      res = await options.fetch(`${base}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args), signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      const name = error && typeof error === 'object' && 'name' in error ? String((error as { name: unknown }).name) : '';
      throw new DbError(fn, 0, name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network');
    }
    let text = '';
    try {
      text = await res.text();
    } catch {
      throw new DbError(fn, res.status, 'body');
    }
    if (!res.ok) {
      let code = '';
      try {
        code = String(obj(JSON.parse(text)).code ?? '');
      } catch {
        code = '';
      }
      throw new DbError(fn, res.status, /^[A-Z0-9_]{1,10}$/.test(code) ? code : '');
    }
    if (text === '') return null as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new DbError(fn, res.status, 'bad_json');
    }
  }

  return {
    rpc,
    async updateBegin(updateId) {
      const state = await rpc<unknown>('bot_update_begin', { p_update_id: updateId });
      if (state === 'new' || state === 'retry' || state === 'done' || state === 'busy') return state;
      throw new DbError('bot_update_begin', 200, 'bad_state');
    },
    async updateDone(updateId) {
      await rpc('bot_update_done', { p_update_id: updateId });
    },
    async updateFailed(updateId, errorName) {
      await rpc('bot_update_failed', { p_update_id: updateId, p_error: errorName });
    },
    async setup(args) {
      const r = obj(await rpc('bot_setup', {
        p_bot_username: args.username, p_bot_id: args.botId, p_tick_token: args.tickToken, p_function_url: args.functionUrl,
        p_function_region: args.functionRegion,
      }));
      return r.status === 'slow_down' ? { status: 'slow_down', retryAfter: num(r.retry_after) } : { status: 'ok', retryAfter: null };
    },
    async status() {
      const r = obj(await rpc('bot_status'));
      const calls = obj(r.calls);
      const ledger = obj(r.ledger);
      return {
        configured: r.configured === true,
        botUsername: str(r.bot_username),
        functionRegion: str(r.function_region),
        tickMode: str(r.tick_mode),
        lastSetupAt: str(r.last_setup_at),
        lastTickAt: str(r.last_tick_at),
        lastTick: r.last_tick ?? null,
        calls: { month: str(calls.month), updates: num(calls.updates) ?? 0, ticks: num(calls.ticks) ?? 0, total: num(calls.total) ?? 0 },
        ledger: { started: num(ledger.started) ?? 0, failed: num(ledger.failed) ?? 0, done: num(ledger.done) ?? 0 },
      };
    },
    async tickBeat(stats) {
      await rpc('bot_tick_beat', { p_stats: stats });
    },
    async linkClaim(args) {
      return toClaim(await rpc('bot_link_claim', {
        p_code: args.code, p_tg_user_id: args.tgUserId, p_chat_id: args.chatId, p_lang: args.lang,
        p_message_date: new Date(args.messageDate * 1000).toISOString(),
      }));
    },
    async chatEvent(tgUserId, event) {
      await rpc('bot_chat_event', { p_tg_user_id: tgUserId, p_event: event });
    },
    async whoami(tgUserId) {
      return toWho(await rpc('bot_whoami', { p_tg_user_id: tgUserId }), tgUserId);
    },
    async settings(tgUserId, patch) {
      return toSettings(await rpc('bot_settings', { p_tg_user_id: tgUserId, p_patch: patch }), tgUserId);
    },
    async today(tgUserId) {
      return toToday(await rpc('bot_today', { p_tg_user_id: tgUserId }), tgUserId);
    },
    async cardSent(tgUserId, messageId, event) {
      const r = obj(await rpc('bot_card_sent', { p_tg_user_id: tgUserId, p_message_id: messageId, p_event: event }));
      return { prevMessageId: num(r.prev_message_id) };
    },
    async claimReminders(limit) {
      return rows(await rpc('bot_claim_reminders', { p_limit: limit }))
        .map((r) => ({ deliveryId: num(r.delivery_id) ?? 0, chatId: num(r.chat_id) ?? 0, localDay: day(r.local_day) ?? '', tz: str(r.tz) ?? 'Europe/Minsk' }))
        .filter((r) => r.deliveryId > 0 && r.chatId > 0);
    },
    async reminderContext(deliveryId) {
      return toReminderContext(await rpc('bot_reminder_context', { p_delivery_id: deliveryId }), deliveryId);
    },
    async deliverySending(deliveryId) {
      return (await rpc<unknown>('bot_delivery_sending', { p_delivery_id: deliveryId })) === true;
    },
    async deliveryDone(deliveryId, status, messageId, error) {
      const r = obj(await rpc('bot_delivery_done', {
        p_delivery_id: deliveryId, p_status: status, p_tg_message_id: messageId ?? null, p_error: error ? error.slice(0, 200) : null,
      }));
      return { prevCardMessageId: num(r.prev_card_message_id) };
    },
    async claimDayClose(limit) {
      return rows(await rpc('bot_claim_day_close', { p_limit: limit })).map((r) => ({
        deliveryId: num(r.delivery_id) ?? 0,
        chatId: num(r.chat_id) ?? 0,
        localDay: day(r.local_day) ?? '',
        cardMessageId: num(r.card_message_id),
        lastMessageId: num(r.last_message_id),
      })).filter((r) => r.deliveryId > 0 && r.chatId > 0);
    },
    async claimAfterDate(limit) {
      return rows(await rpc('bot_claim_after_date', { p_limit: limit })).map((r) => {
        const e = r.exam && typeof r.exam === 'object' ? obj(r.exam) : null;
        const lastDate = e ? day(e.last_date) ?? day(e.exam_date) : null;
        return {
          deliveryId: num(r.delivery_id) ?? 0,
          chatId: num(r.chat_id) ?? 0,
          localDay: day(r.local_day) ?? '',
          containerId: str(r.container_id) ?? (e ? str(e.container_id) : null) ?? '',
          exam: e && lastDate
            ? {
                title: str(e.title) ?? '',
                examDate: day(e.exam_date),
                lastDate,
                firstPlanDay: day(e.first_plan_day),
                activeDays: num(e.active_days) ?? 0,
                answers: num(e.answers) ?? 0,
                twoDays: num(e.two_days) ?? 0,
                keyed: num(e.keyed) ?? 0,
              }
            : null,
        };
      }).filter((r) => r.deliveryId > 0 && r.chatId > 0);
    },
  };
}
