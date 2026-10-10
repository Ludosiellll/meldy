// An in-memory BotDb for the function's tests (spec §8.1 «Поддельная база — в памяти»), modelled on T1's SQL
// (CONTRACT_T1.md, migration 20261010120000_telegram_bot.sql): the update ledger with its 30 s lease; link codes
// (private_only, slow_down after 10 failures an hour, invalid, used, expired by the message date, the same code from
// the same Telegram → linked again, the newest link wins on both sides); settings answered with statuses, the pending
// prompt and the once-an-hour hint; «seen» marks; the day's cards; the deliveries' at-most-once states (claimed →
// sending → sent | failed | skipped; sending for 10 minutes → unknown, never sent again; claimed and never tried, or
// sent back by bot_delivery_retry after a 429 → taken again after 10 minutes, at most 3 tries) and K2 (three cards in a
// row with nothing since).
import type {
  AfterDateRow, BotDb, BotRpcName, BotStatus, ChatEvent, ClaimResult, DayCloseRow, Link, OpenSession, Prompt, ReminderContext,
  ReminderRow, SettingsPatch, SettingsResult, Today, UpdateBegin, Who,
} from '../db.ts';
import { DbError, minutesOf } from '../db.ts';
import type { PlanInputsWire } from '../../plan/container.ts';
import { addDays, clockOf, localDay } from '../../plan/time.ts';

interface LinkRow {
  id: number;
  userId: string;
  tgUserId: number;
  chatId: number;
  remindOn: boolean;
  remindAt: number;
  tz: string;
  pausedUntil: string | null;
  blockedAt: number | null;
  unlinkedAt: number | null;
  lang: string | null;
  askedAt: number | null;
  lastSeenAt: number | null;
  hintAt: number | null;
  prompt: Prompt | null;
}

interface CodeRow { userId: string; tz: string; expiresAt: number; usedAt: number | null; usedByTg: number | null }

interface Delivery {
  id: number;
  kind: 'reminder' | 'ask' | 'after_date' | 'day_close' | 'notice';
  chatId: number;
  linkId: number;
  localDay: string;
  ref: string | null;
  status: 'claimed' | 'sending' | 'sent' | 'failed' | 'skipped' | 'unknown';
  attempts: number;
  claimedAt: number;
  sentAt: number | null;
  messageId: number | null;
  error: string | null;
  answer?: 'yes' | 'pause' | 'stop';
}

interface DayRow { cardMessageId: number | null; cardUsed: boolean; lastMessageId: number | null; closedAt: number | null }

/** What bot_today / bot_reminder_context read for a user: the plan wire, the exams' meta, the open session. */
export interface UserData {
  wire?: PlanInputsWire | null;
  exams?: Array<{ id: string; createdAt?: string | null; keyChanges?: number; hasOral?: boolean }>;
  session?: OpenSession | null;
  /** Moments of answers on the site or in the bot (ms), for «recently active» and K2. */
  answers?: number[];
}

const LEASE_MS = 30_000;
const MIN = 60_000;
const HOUR = 60 * MIN;

export function fakeDb(options: { now: () => number }) {
  const now = options.now;
  const calls: Array<{ fn: string; args: unknown }> = [];
  const failures = new Map<string, Error[]>();
  const updates = new Map<number, { status: 'started' | 'failed' | 'done'; at: number; error?: string }>();
  const codes = new Map<string, CodeRow>();
  const claimFailures: Array<{ tg: number; at: number }> = [];
  const links: LinkRow[] = [];
  const users = new Map<string, UserData>();
  const deliveries: Delivery[] = [];
  const days = new Map<string, DayRow>();
  const dayCloseQueue: Array<{ linkId: number; localDay: string }> = [];
  const afterDateQueue: Array<{ linkId: number; containerId: string; exam: AfterDateRow['exam'] }> = [];  // exam null: deleted
  const beats: Array<Record<string, number>> = [];
  const setups: Array<Record<string, unknown>> = [];
  const extraRpc = new Map<string, (args: Record<string, unknown>) => unknown>();
  let nextLinkId = 1;
  let nextDeliveryId = 1;
  let lastSetupAt: number | null = null;
  let lastTickAt: number | null = null;

  function record(fn: string, args: unknown) {
    calls.push({ fn, args });
    const queue = failures.get(fn);
    if (queue && queue.length > 0) throw queue.shift();
  }

  const active = () => links.filter((l) => l.unlinkedAt === null);
  const byTg = (tg: number) => active().find((l) => l.tgUserId === tg) ?? null;
  const dayKey = (l: LinkRow, d: string) => `${l.id}|${d}`;
  const answersOf = (l: LinkRow) => users.get(l.userId)?.answers ?? [];
  /** An answer (site or bot) in the last 30 minutes delays the card; an action in the bot does not (T1 90e15a5). */
  const recentlyActive = (l: LinkRow, t: number) => answersOf(l).some((a) => a > t - 30 * MIN && a <= t);
  const answeredSince = (l: LinkRow, at: number) => answersOf(l).some((a) => a > at);

  function linkShape(l: LinkRow): Link {
    const t = now();
    const today = localDay(t, l.tz);
    const c = clockOf(t, l.tz);
    return {
      tgUserId: l.tgUserId, chatId: l.chatId, blocked: l.blockedAt !== null, remindOn: l.remindOn, remindAt: l.remindAt, tz: l.tz,
      pausedUntil: l.pausedUntil !== null && l.pausedUntil > today ? l.pausedUntil : null, prompt: l.prompt, today,
      localTime: c.h * 60 + c.m, now: t,
    };
  }

  function todayOf(l: LinkRow, withSession: boolean): Today {
    const data = users.get(l.userId) ?? {};
    const link = linkShape(l);
    const row = days.get(dayKey(l, link.today));
    return {
      link,
      now: link.now,
      wire: data.wire ?? null,
      oral: [],
      exams: (data.exams ?? []).map((e) => ({ id: e.id, createdAt: e.createdAt ?? null, keyChanges: e.keyChanges ?? 0, hasOral: e.hasOral ?? false })),
      session: withSession ? data.session ?? null : null,
      day: withSession && row ? { cardMessageId: row.cardMessageId, cardUsed: row.cardUsed, lastMessageId: row.lastMessageId } : null,
    };
  }

  function sweep(kinds: Delivery['kind'][], t: number) {
    for (const d of deliveries) {
      if (!kinds.includes(d.kind)) continue;
      if (d.status === 'sending' && d.claimedAt < t - 10 * MIN) {
        if (d.kind === 'ask') {
          const l = links.find((x) => x.id === d.linkId);
          if (l && (l.askedAt === null || l.askedAt < d.claimedAt)) l.askedAt = d.claimedAt;
        }
        d.status = 'unknown';
        d.error = 'died while sending';
      }
      if (d.status === 'claimed' && d.claimedAt < t - 3 * HOUR) {
        d.status = 'failed';
        d.error = 'abandoned';
      }
    }
  }

  const inWindow = (l: LinkRow, t: number) => {
    const c = clockOf(t, l.tz);
    const minutes = c.h * 60 + c.m;
    return minutes >= l.remindAt && minutes < l.remindAt + 180 && minutes < 23 * 60;
  };

  function newDelivery(kind: Delivery['kind'], l: LinkRow, day: string, ref: string | null): Delivery | null {
    const card = (k: string) => k === 'reminder' || k === 'ask';
    if (deliveries.some((d) => d.kind === kind && d.chatId === l.chatId && d.localDay === day && d.ref === ref)) return null;
    if (card(kind) && deliveries.some((d) => card(d.kind) && d.chatId === l.chatId && d.localDay === day)) return null;
    const d: Delivery = { id: nextDeliveryId++, kind, chatId: l.chatId, linkId: l.id, localDay: day, ref, status: 'claimed', attempts: 1, claimedAt: now(), sentAt: null, messageId: null, error: null };
    deliveries.push(d);
    return d;
  }

  const db: BotDb = {
    async rpc<T>(fn: BotRpcName, args: Record<string, unknown> = {}): Promise<T> {
      record(fn, args);
      const handler = extraRpc.get(fn);
      if (!handler) throw new DbError(fn, 404, 'PGRST202');
      return handler(args) as T;
    },

    async updateBegin(updateId: number): Promise<UpdateBegin> {
      record('bot_update_begin', { updateId });
      const row = updates.get(updateId);
      if (!row) {
        updates.set(updateId, { status: 'started', at: now() });
        return 'new';
      }
      if (row.status === 'done') return 'done';
      if (row.status === 'started' && now() - row.at < LEASE_MS) return 'busy';
      updates.set(updateId, { status: 'started', at: now() });
      return 'retry';
    },
    async updateDone(updateId: number) {
      record('bot_update_done', { updateId });
      const row = updates.get(updateId);
      if (row) updates.set(updateId, { status: 'done', at: now() });
    },
    async updateFailed(updateId: number, errorName: string) {
      record('bot_update_failed', { updateId, errorName });
      const row = updates.get(updateId);
      if (row && row.status !== 'done') updates.set(updateId, { status: 'failed', at: now(), error: /^[A-Za-z0-9_.:-]{1,64}$/.test(errorName) ? errorName : 'Error' });
    },

    async setup(args) {
      record('bot_setup', args);
      if (!/^[A-Za-z0-9_]{5,32}$/.test(args.username) || !(args.botId > 0) || !/^[A-Za-z0-9_-]{32,128}$/.test(args.tickToken)
        || !/^https:\/\/[a-z0-9-]{1,63}\.supabase\.co\/functions\/v1\/telegram$/.test(args.functionUrl)
        || !/^[a-z]{2}-[a-z]+-\d$/.test(args.functionRegion)) {
        throw new DbError('bot_setup', 400, '22023');
      }
      if (lastSetupAt !== null && now() - lastSetupAt < MIN) return { status: 'slow_down', retryAfter: Math.ceil((lastSetupAt + MIN - now()) / 1000) };
      lastSetupAt = now();
      setups.push(args);
      return { status: 'ok', retryAfter: null };
    },
    async status(): Promise<BotStatus> {
      record('bot_status', {});
      const list = [...updates.values()];
      return {
        configured: setups.length > 0,
        botUsername: setups.length > 0 ? String(setups[setups.length - 1].username) : null,
        functionRegion: setups.length > 0 ? String(setups[setups.length - 1].functionRegion) : null,
        tickMode: 'every_minute',
        lastSetupAt: lastSetupAt === null ? null : new Date(lastSetupAt).toISOString(),
        lastTickAt: lastTickAt === null ? null : new Date(lastTickAt).toISOString(),
        lastTick: beats.at(-1) ?? null,
        calls: { month: new Date(now()).toISOString().slice(0, 7), updates: list.length, ticks: beats.length, total: list.length + beats.length },
        ledger: { started: list.filter((u) => u.status === 'started').length, failed: list.filter((u) => u.status === 'failed').length, done: list.filter((u) => u.status === 'done').length },
      };
    },
    async tickBeat(stats) {
      record('bot_tick_beat', stats);
      lastTickAt = now();
      beats.push(stats);
    },

    async linkClaim(args): Promise<ClaimResult> {
      record('bot_link_claim', args);
      const t = now();
      if (args.tgUserId <= 0 || args.chatId !== args.tgUserId) return { status: 'private_only', replacedChatId: null };
      if (claimFailures.filter((f) => f.tg === args.tgUserId && t - f.at < HOUR).length >= 10) return { status: 'slow_down', replacedChatId: null };
      const code = /^L[0-9a-f]{32}$/.test(args.code) ? codes.get(args.code) : undefined;
      if (!code) {
        claimFailures.push({ tg: args.tgUserId, at: t });
        return { status: 'invalid', replacedChatId: null };
      }
      if (code.usedAt !== null) {
        const mine = active().find((l) => l.userId === code.userId && l.tgUserId === args.tgUserId);
        if (code.usedByTg === args.tgUserId && mine) {
          mine.blockedAt = null;
          mine.lastSeenAt = t;
          return { status: 'linked', replacedChatId: null };
        }
        return { status: 'used', replacedChatId: null };
      }
      if (Math.min(args.messageDate * 1000, t) > code.expiresAt) return { status: 'expired', replacedChatId: null };
      code.usedAt = t;
      code.usedByTg = args.tgUserId;
      const mine = active().find((l) => l.userId === code.userId) ?? null;
      const theirs = byTg(args.tgUserId);
      if (mine && mine.tgUserId === args.tgUserId) {
        mine.chatId = args.chatId;
        mine.tz = code.tz;
        mine.blockedAt = null;
        mine.lastSeenAt = t;
        return { status: 'linked', replacedChatId: null };
      }
      let replacedChatId: number | null = null;
      if (mine) {
        mine.unlinkedAt = t;
        replacedChatId = mine.chatId !== args.chatId ? mine.chatId : null;
      }
      if (theirs) theirs.unlinkedAt = t;
      links.push({
        id: nextLinkId++, userId: code.userId, tgUserId: args.tgUserId, chatId: args.chatId, remindOn: true, remindAt: 20 * 60, tz: code.tz,
        pausedUntil: null, blockedAt: null, unlinkedAt: null, lang: args.lang, askedAt: null, lastSeenAt: t, hintAt: null, prompt: null,
      });
      return { status: 'linked', replacedChatId };
    },
    async chatEvent(tgUserId: number, event: ChatEvent) {
      record('bot_chat_event', { tgUserId, event });
      const l = byTg(tgUserId);
      if (!l) return;
      if (event === 'stop') {
        l.unlinkedAt = now();
        l.prompt = null;
      } else if (event === 'blocked') l.blockedAt = l.blockedAt ?? now();
      else {
        l.blockedAt = null;
        l.lastSeenAt = now();
      }
    },
    async whoami(tgUserId: number): Promise<Who> {
      record('bot_whoami', { tgUserId });
      const l = byTg(tgUserId);
      if (!l) return { linked: false };
      l.lastSeenAt = now();
      const data = users.get(l.userId) ?? {};
      const exams = (data.wire?.containers ?? []).map((c) => ({ id: c.id, title: c.title, examDate: c.exam_date, lastDate: c.exam_date, role: c.role }));
      return { linked: true, ...linkShape(l), exams };
    },
    async settings(tgUserId: number, patch: SettingsPatch): Promise<SettingsResult> {
      record('bot_settings', { tgUserId, patch });
      const l = byTg(tgUserId);
      if (!l) return { status: 'unlinked' };
      for (const key of Object.keys(patch)) {
        if (!['remind_at', 'remind_on', 'tz', 'paused_until', 'prompt', 'hint', 'ask'].includes(key)) return { status: 'invalid', field: key, reason: 'unknown' };
      }
      let remindAt = l.remindAt;
      let remindOn: boolean | undefined = patch.remind_on;
      if (patch.remind_at !== undefined) {
        if (!/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(patch.remind_at)) return { status: 'invalid', field: 'remind_at', reason: 'format' };
        const m = minutesOf(patch.remind_at) as number;
        if (m < 7 * 60 || m > 22 * 60 + 59) return { status: 'invalid', field: 'remind_at', reason: 'range' };
        remindAt = m;
        remindOn = remindOn ?? true;
      }
      const today = localDay(now(), patch.tz ?? l.tz);
      if (patch.paused_until !== undefined && patch.paused_until !== null) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(patch.paused_until)) return { status: 'invalid', field: 'paused_until', reason: 'format' };
        if (patch.paused_until <= today) return { status: 'invalid', field: 'paused_until', reason: 'past' };
        if (patch.paused_until > addDays(today, 366)) return { status: 'invalid', field: 'paused_until', reason: 'far' };
      }
      let hint: boolean | null = null;
      if (patch.hint !== undefined) hint = l.hintAt === null || l.hintAt <= now() - HOUR;
      l.remindAt = remindAt;
      if (remindOn !== undefined) l.remindOn = remindOn;
      if (patch.tz !== undefined) l.tz = patch.tz;
      if (patch.paused_until !== undefined) l.pausedUntil = patch.paused_until;
      if (patch.prompt !== undefined) {
        l.prompt = patch.prompt === null ? null
          : { kind: patch.prompt.kind, promptId: patch.prompt.prompt_id, targetId: patch.prompt.target_id, from: patch.prompt.from, at: patch.prompt.at };
      }
      if (patch.ask !== undefined && !['yes', 'pause', 'stop'].includes(patch.ask)) return { status: 'invalid', field: 'ask', reason: 'format' };
      if (hint) l.hintAt = now();
      l.lastSeenAt = now();
      if (patch.ask) {
        const lastAsk = deliveries.filter((d) => d.linkId === l.id && d.kind === 'ask' && (d.status === 'sent' || d.status === 'unknown')).at(-1);
        if (lastAsk) lastAsk.answer = patch.ask;
      }
      return { status: 'ok', link: linkShape(l), hint };
    },

    async today(tgUserId: number) {
      record('bot_today', { tgUserId });
      const l = byTg(tgUserId);
      if (!l) return null;
      l.lastSeenAt = now();
      return todayOf(l, true);
    },
    async cardSent(tgUserId: number, messageId: number, event: 'card' | 'used' | 'last') {
      record('bot_card_sent', { tgUserId, messageId, event });
      const l = byTg(tgUserId);
      if (!l || !(messageId > 0)) return { prevMessageId: null };
      const today = localDay(now(), l.tz);
      if (event === 'used') {
        for (const [key, row] of days) if (key.startsWith(`${l.id}|`) && row.cardMessageId === messageId) row.cardUsed = true;
        return { prevMessageId: null };
      }
      const key = dayKey(l, today);
      const row = days.get(key) ?? { cardMessageId: null, cardUsed: false, lastMessageId: null, closedAt: null };
      days.set(key, row);
      if (event === 'card') {
        const prev = row.cardMessageId !== messageId && !row.cardUsed ? row.cardMessageId : null;
        row.cardMessageId = messageId;
        row.cardUsed = false;
        return { prevMessageId: prev };
      }
      const prev = row.lastMessageId !== messageId ? row.lastMessageId : null;
      row.lastMessageId = messageId;
      return { prevMessageId: prev };
    },
    async claimReminders(limit: number): Promise<ReminderRow[]> {
      record('bot_claim_reminders', { limit });
      const t = now();
      sweep(['reminder', 'ask'], t);
      const out: ReminderRow[] = [];
      const due = active()
        .filter((l) => l.blockedAt === null && l.remindOn && inWindow(l, t))
        .filter((l) => {
          const today = localDay(t, l.tz);
          return (l.pausedUntil === null || l.pausedUntil <= today) && !recentlyActive(l, t)
            && !deliveries.some((d) => (d.kind === 'reminder' || d.kind === 'ask') && d.chatId === l.chatId && d.localDay === today);
        })
        .sort((a, b) => a.remindAt - b.remindAt || a.id - b.id)
        .slice(0, Math.max(1, Math.min(limit, 500)));
      for (const l of due) {
        const d = newDelivery('reminder', l, localDay(t, l.tz), null);
        if (d) out.push({ deliveryId: d.id, chatId: d.chatId, localDay: d.localDay, tz: l.tz });
      }
      for (const d of deliveries) {
        const l = links.find((x) => x.id === d.linkId);
        if (!l || l.unlinkedAt !== null || l.blockedAt !== null || !l.remindOn) continue;
        if (!(d.kind === 'reminder' || d.kind === 'ask') || d.status !== 'claimed' || d.attempts >= 3 || d.claimedAt >= t - 10 * MIN) continue;
        if (d.localDay !== localDay(t, l.tz) || !inWindow(l, t) || recentlyActive(l, t)) continue;
        d.claimedAt = t;
        d.attempts += 1;
        out.push({ deliveryId: d.id, chatId: d.chatId, localDay: d.localDay, tz: l.tz });
      }
      return out;
    },
    async reminderContext(deliveryId: number): Promise<ReminderContext> {
      record('bot_reminder_context', { deliveryId });
      const d = deliveries.find((x) => x.id === deliveryId);
      if (!d || !(d.kind === 'reminder' || d.kind === 'ask') || d.status !== 'claimed') return { card: 'skip', deliveryId, reason: 'not_claimed' };
      const l = links.find((x) => x.id === d.linkId);
      const reason = !l || l.unlinkedAt !== null ? 'unlinked' : l.blockedAt !== null ? 'blocked' : !l.remindOn ? 'off'
        : l.pausedUntil !== null && l.pausedUntil > d.localDay ? 'paused'
          : l.askedAt !== null && (l.lastSeenAt ?? -Infinity) <= l.askedAt && !answeredSince(l, l.askedAt) ? 'silent' : null;
      if (reason !== null || !l) {
        d.status = 'skipped';
        d.error = reason;
        return { card: 'skip', deliveryId, reason: reason ?? 'unlinked' };
      }
      const sent = deliveries
        .filter((x) => x.linkId === l.id && x.kind === 'reminder' && (x.status === 'sent' || x.status === 'unknown') && x.id !== d.id)
        .map((x) => x.sentAt ?? x.claimedAt)
        .sort((a, b) => b - a)
        .slice(0, 3);
      const k2 = sent.length === 3 && (l.lastSeenAt ?? -Infinity) <= sent[2] && !answeredSince(l, sent[2]);
      d.kind = k2 ? 'ask' : 'reminder';
      return { card: k2 ? 'K2' : 'K1', deliveryId, chatId: d.chatId, localDay: d.localDay, today: todayOf(l, false) };
    },
    async deliverySending(deliveryId: number) {
      record('bot_delivery_sending', { deliveryId });
      const d = deliveries.find((x) => x.id === deliveryId);
      const l = d ? links.find((x) => x.id === d.linkId) : undefined;
      if (!d || d.status !== 'claimed' || !l || l.unlinkedAt !== null || l.blockedAt !== null) return false;
      d.status = 'sending';
      d.claimedAt = now();
      return true;
    },
    async deliveryDone(deliveryId, status, messageId, error) {
      record('bot_delivery_done', { deliveryId, status, messageId, error });
      if (!['sent', 'failed', 'skipped'].includes(status)) throw new DbError('bot_delivery_done', 400, '22023');
      const d = deliveries.find((x) => x.id === deliveryId);
      if (!d || !['claimed', 'sending', 'unknown'].includes(d.status)) return { prevCardMessageId: null };
      d.status = status;
      d.sentAt = status === 'sent' ? now() : null;
      d.messageId = status === 'sent' ? messageId ?? null : null;
      d.error = status === 'sent' ? null : (error ?? null);
      const l = links.find((x) => x.id === d.linkId);
      if (!l) return { prevCardMessageId: null };
      if (status === 'sent' && d.kind === 'ask') l.askedAt = now();
      if (status === 'sent' && d.kind === 'reminder' && messageId) {
        const key = dayKey(l, d.localDay);
        const row = days.get(key) ?? { cardMessageId: null, cardUsed: false, lastMessageId: null, closedAt: null };
        days.set(key, row);
        const prev = row.cardMessageId !== messageId && !row.cardUsed ? row.cardMessageId : null;
        row.cardMessageId = messageId;
        row.cardUsed = false;
        return { prevCardMessageId: prev };
      }
      if (d.kind === 'day_close') {
        const row = days.get(dayKey(l, d.localDay));
        if (row) row.closedAt = now();
      }
      return { prevCardMessageId: null };
    },
    async deliveryRetry(deliveryId: number, error = '429') {
      record('bot_delivery_retry', { deliveryId, error });
      const d = deliveries.find((x) => x.id === deliveryId);
      if (!d || d.status !== 'sending') return false;
      const l = links.find((x) => x.id === d.linkId);
      const t = now();
      const today = l ? localDay(t, l.tz) : '';
      const due = Boolean(l) && l!.unlinkedAt === null && l!.blockedAt === null && d.attempts < 3
        && (d.kind === 'day_close'
          ? d.localDay >= addDays(today, -2)
          : l!.remindOn && (l!.pausedUntil === null || l!.pausedUntil <= today) && d.localDay === today && inWindow(l!, t));
      d.error = error.slice(0, 200) || '429';
      if (due) {
        d.status = 'claimed';
        d.claimedAt = t;
        return true;
      }
      d.status = 'failed';
      return false;
    },
    async claimDayClose(limit: number): Promise<DayCloseRow[]> {
      record('bot_claim_day_close', { limit });
      const t = now();
      sweep(['day_close'], t);
      const out: DayCloseRow[] = [];
      const rowOf = (l: LinkRow, day: string) => {
        const row = days.get(dayKey(l, day));
        return row && row.closedAt === null ? row : null;
      };
      for (const q of dayCloseQueue) {
        if (out.length >= limit) break;
        const l = links.find((x) => x.id === q.linkId);
        if (!l || l.unlinkedAt !== null || l.blockedAt !== null) continue;
        const row = rowOf(l, q.localDay);
        if (!row) continue;
        const d = newDelivery('day_close', l, q.localDay, null);
        if (d) out.push({ deliveryId: d.id, chatId: l.chatId, localDay: q.localDay, cardMessageId: row.cardUsed ? null : row.cardMessageId, lastMessageId: row.lastMessageId });
      }
      for (const d of deliveries) {
        if (out.length >= limit) break;
        if (d.kind !== 'day_close' || d.status !== 'claimed' || d.attempts >= 3 || d.claimedAt >= t - 10 * MIN) continue;
        const l = links.find((x) => x.id === d.linkId);
        if (!l || l.unlinkedAt !== null || l.blockedAt !== null || d.localDay < addDays(localDay(t, l.tz), -2)) continue;
        const row = rowOf(l, d.localDay);
        if (!row) continue;
        d.claimedAt = t;
        d.attempts += 1;
        out.push({ deliveryId: d.id, chatId: l.chatId, localDay: d.localDay, cardMessageId: row.cardUsed ? null : row.cardMessageId, lastMessageId: row.lastMessageId });
      }
      return out;
    },
    async claimAfterDate(limit: number): Promise<AfterDateRow[]> {
      record('bot_claim_after_date', { limit });
      sweep(['after_date'], now());
      const out: AfterDateRow[] = [];
      for (const q of afterDateQueue) {
        if (out.length >= limit) break;
        const l = links.find((x) => x.id === q.linkId);
        if (!l || l.unlinkedAt !== null || l.blockedAt !== null || !l.remindOn) continue;
        const d = newDelivery('after_date', l, localDay(now(), l.tz), q.containerId);
        if (d) out.push({ deliveryId: d.id, chatId: l.chatId, localDay: d.localDay, containerId: q.containerId, exam: q.exam });
      }
      const t = now();
      for (const d of deliveries) {
        if (out.length >= limit) break;
        if (d.kind !== 'after_date' || d.status !== 'claimed' || d.attempts >= 3 || d.claimedAt >= t - 10 * MIN) continue;
        const l = links.find((x) => x.id === d.linkId);
        if (!l || l.unlinkedAt !== null || l.blockedAt !== null || !l.remindOn || d.localDay !== localDay(t, l.tz) || !inWindow(l, t)) continue;
        const q = afterDateQueue.find((x) => x.linkId === l.id && x.containerId === d.ref);
        if (!q) continue;
        d.claimedAt = t;
        d.attempts += 1;
        out.push({ deliveryId: d.id, chatId: l.chatId, localDay: d.localDay, containerId: q.containerId, exam: q.exam });
      }
      return out;
    },
  };

  return {
    db,
    calls,
    updates,
    links,
    deliveries,
    days,
    beats,
    setups,
    dayCloseQueue,
    afterDateQueue,
    /** The next call of `fn` throws (once per error queued). */
    fail(fn: string, ...errors: Error[]) {
      failures.set(fn, [...(failures.get(fn) ?? []), ...errors]);
    },
    /** A link code the site would have made: `L` + 32 hex, valid `ttlMs` from now. */
    addCode(code: string, userId: string, opts: { tz?: string; ttlMs?: number } = {}) {
      codes.set(code, { userId, tz: opts.tz ?? 'Europe/Minsk', expiresAt: now() + (opts.ttlMs ?? 15 * MIN), usedAt: null, usedByTg: null });
    },
    /** An active link, as if claimed earlier (not seen recently). */
    addLink(row: { userId: string; tgUserId: number; remindAt?: string; tz?: string; remindOn?: boolean; pausedUntil?: string | null; askedAt?: number | null }) {
      const l: LinkRow = {
        id: nextLinkId++, userId: row.userId, tgUserId: row.tgUserId, chatId: row.tgUserId, remindOn: row.remindOn ?? true,
        remindAt: minutesOf(row.remindAt ?? '20:00') ?? 1200, tz: row.tz ?? 'Europe/Minsk', pausedUntil: row.pausedUntil ?? null,
        blockedAt: null, unlinkedAt: null, lang: 'ru', askedAt: row.askedAt ?? null, lastSeenAt: null, hintAt: null, prompt: null,
      };
      links.push(l);
      return l;
    },
    link(tg: number) {
      return byTg(tg);
    },
    setUser(userId: string, data: UserData) {
      users.set(userId, { ...(users.get(userId) ?? {}), ...data });
    },
    /** Put a day row (a card or a summary of an earlier day) and queue its night's close. */
    addDay(linkId: number, localDayKey: string, row: Partial<DayRow>, close = true) {
      days.set(`${linkId}|${localDayKey}`, { cardMessageId: null, cardUsed: false, lastMessageId: null, closedAt: null, ...row });
      if (close) dayCloseQueue.push({ linkId, localDay: localDayKey });
    },
    /** A K3 waiting for the tick. */
    addAfterDate(linkId: number, containerId: string, exam: AfterDateRow['exam']) {
      afterDateQueue.push({ linkId, containerId, exam });
    },
    on(fn: string, handler: (args: Record<string, unknown>) => unknown) {
      extraRpc.set(fn, handler);
    },
    of(fn: string) {
      return calls.filter((c) => c.fn === fn);
    },
  };
}

export type FakeDb = ReturnType<typeof fakeDb>;
