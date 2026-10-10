/**
 * The minute tick (spec §6.6): `POST /telegram/tick` answers 202 and runs this in `EdgeRuntime.waitUntil`.
 *
 * Steps, at most 30 s in all, sends at most 25 a second:
 *   1. close the group's posts at 21:00 — T8 (`ports.group.closePosts`);
 *   2. send the group's posts — T8 (`ports.group.sendPosts`);
 *   3. reminders, at most 50: claim → context → the copied `planDay` → the card → `sending` → `sendMessage` → done;
 *   4. «Ответили N» — T8 (`ports.group.counters`);
 *   5. the night's close: delete the unused card, take the keyboard off the last summary;
 *   6. K3 after an exam's date;
 *   7. pending answers older than 30 minutes recorded as given (T5's `bot_flush_pending`);
 *   8. `bot_tick_beat` with the tick's numbers.
 *
 * At most once (decision 7): `bot_delivery_sending` right before the call to Telegram; false → not sent. A timeout or a
 * network error after it leaves the row in `sending` (it becomes `unknown`, never sent again). 429 stops the step (the
 * rows not reached stay `claimed` for a later tick); 403 → `bot_chat_event(blocked)`. A failing step never stops the
 * others. The tick never calls `bot_whoami` / `bot_settings` / `bot_today`: they would mark the user as seen.
 */
import { afterDateCard, askCard, dayCard, type CardResult } from './card.ts';
import type { ReminderRow } from './db.ts';
import { DbError } from './db.ts';
import { errorName, log } from './log.ts';
import type { Ctx, Ports } from './router.ts';
import { editKeyboard, isBlocked, isRateLimited, remove, send, TelegramError } from './tg.ts';

export type StepStats = Record<string, number>;

/** What every step gets: when to stop starting work (epoch ms) and the shared pacer (≤ 25 sends a second). */
export interface TickTools { deadline: number; pace: () => Promise<void> }

export const TICK_BUDGET_MS = 30_000;
/** Work starts only while this much of the budget is left (a send takes up to 10 s with its timeout). */
export const STOP_MARGIN_MS = 5_000;
export const SENDS_PER_SECOND = 25;
export const CLAIM_LIMIT = 50;

export interface TickOptions {
  sleep?: (ms: number) => Promise<void>;
  limit?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** ≤ 25 sends a second: each call waits until 40 ms after the previous one. */
export function pacer(now: () => number, sleep: (ms: number) => Promise<void>, perSecond = SENDS_PER_SECOND) {
  const gap = 1000 / perSecond;
  let last = Number.NEGATIVE_INFINITY;
  return async () => {
    const wait = last + gap - now();
    if (wait > 0) await sleep(wait);
    last = Math.max(now(), last + gap);
  };
}

const add = (stats: StepStats, key: string, n = 1) => {
  stats[key] = (stats[key] ?? 0) + n;
};

type Outcome = 'sent' | 'stop' | 'next';

/** Sends one claimed card; the delivery's outcome is recorded whatever happens. */
async function deliver(ctx: Ctx, stats: StepStats, deliveryId: number, chatId: number, card: CardResult, sound: boolean,
  pace: () => Promise<void>): Promise<Outcome> {
  if (!(await ctx.db.deliverySending(deliveryId))) {
    add(stats, 'taken');
    return 'next';
  }
  await pace();
  try {
    const sent = await send(ctx.tg, { chatId, text: card.out.text, keyboard: card.out.keyboard, sound });
    const done = await ctx.db.deliveryDone(deliveryId, 'sent', sent.message_id);
    if (done.prevCardMessageId !== null) await remove(ctx.tg, chatId, done.prevCardMessageId);
    add(stats, 'sent');
    return 'sent';
  } catch (error) {
    if (isRateLimited(error)) {
      // Telegram refused it: nothing went out. The row is closed as failed (the contract has no way back to «claimed»).
      await ctx.db.deliveryDone(deliveryId, 'failed', null, '429').catch(() => undefined);
      add(stats, 'rate_limited');
      return 'stop';
    }
    if (isBlocked(error)) {
      await ctx.db.chatEvent(chatId, 'blocked').catch(() => undefined);
      await ctx.db.deliveryDone(deliveryId, 'failed', null, '403').catch(() => undefined);
      add(stats, 'blocked');
      return 'next';
    }
    if (error instanceof TelegramError && error.failure === 'api' && error.code < 500) {
      await ctx.db.deliveryDone(deliveryId, 'failed', null, String(error.code)).catch(() => undefined);
      add(stats, 'failed');
      return 'next';
    }
    // A timeout, a network error or a 5xx after `sending`: it may have gone out. The row stays in `sending` and becomes
    // `unknown`; it is never sent again (at most once).
    add(stats, 'unknown');
    return 'next';
  }
}

/** Step 3: the day cards (K1, or K2 in place of the fourth ignored one). */
export async function reminders(ctx: Ctx, deadline: number, pace: () => Promise<void>, limit = CLAIM_LIMIT): Promise<StepStats> {
  const stats: StepStats = {};
  const rows: ReminderRow[] = await ctx.db.claimReminders(limit);
  add(stats, 'claimed', rows.length);
  for (const row of rows) {
    if (ctx.now() > deadline) {
      add(stats, 'left');
      continue; // claimed and never tried: a later tick takes it again after 10 minutes
    }
    const context = await ctx.db.reminderContext(row.deliveryId);
    if (context.card === 'skip') {
      add(stats, `skip_${context.reason}`);
      continue;
    }
    const card = context.card === 'K2' ? askCard(context.today, context.today.link) : dayCard(context.today, 'reminder', ctx.site);
    if (!card.send) {
      await ctx.db.deliveryDone(row.deliveryId, 'skipped', null, card.state);
      add(stats, `skip_${card.state}`);
      continue;
    }
    const outcome = await deliver(ctx, stats, row.deliveryId, context.chatId, card, context.card === 'K1', pace);
    if (outcome === 'sent' && context.card === 'K2') add(stats, 'asked');
    if (outcome === 'stop') break;
  }
  return stats;
}

/** Step 5: the night after a day — the unused card goes, the last summary loses its keyboard. */
export async function dayClose(ctx: Ctx, deadline: number, pace: () => Promise<void>, limit = CLAIM_LIMIT): Promise<StepStats> {
  const stats: StepStats = {};
  const rows = await ctx.db.claimDayClose(limit);
  add(stats, 'claimed', rows.length);
  for (const row of rows) {
    if (ctx.now() > deadline) {
      add(stats, 'left');
      continue;
    }
    if (!(await ctx.db.deliverySending(row.deliveryId))) {
      add(stats, 'taken');
      continue;
    }
    try {
      if (row.cardMessageId !== null) {
        await pace();
        if (await remove(ctx.tg, row.chatId, row.cardMessageId)) add(stats, 'deleted');
      }
      if (row.lastMessageId !== null) {
        await pace();
        await editKeyboard(ctx.tg, { chatId: row.chatId, messageId: row.lastMessageId, keyboard: null });
        add(stats, 'keyboards');
      }
      await ctx.db.deliveryDone(row.deliveryId, 'sent');
      add(stats, 'closed');
    } catch (error) {
      if (isBlocked(error)) await ctx.db.chatEvent(row.chatId, 'blocked').catch(() => undefined);
      await ctx.db.deliveryDone(row.deliveryId, 'failed', null, error instanceof TelegramError ? String(error.code) : errorName(error)).catch(() => undefined);
      add(stats, 'failed');
      if (isRateLimited(error)) break;
    }
  }
  return stats;
}

/** Step 6: K3, the last message about an exam, the day after its last date. */
export async function afterDate(ctx: Ctx, deadline: number, pace: () => Promise<void>, limit = CLAIM_LIMIT): Promise<StepStats> {
  const stats: StepStats = {};
  const rows = await ctx.db.claimAfterDate(limit);
  add(stats, 'claimed', rows.length);
  for (const row of rows) {
    if (ctx.now() > deadline) {
      add(stats, 'left');
      continue;
    }
    if (!row.exam) {
      // The exam was deleted meanwhile: nothing to say about it.
      await ctx.db.deliveryDone(row.deliveryId, 'skipped', null, 'gone');
      add(stats, 'skip_gone');
      continue;
    }
    const outcome = await deliver(ctx, stats, row.deliveryId, row.chatId, afterDateCard({ ...row, exam: row.exam }, ctx.site), false, pace);
    if (outcome === 'stop') break;
  }
  return stats;
}

/** Step 7: T5's flush of answers left pending for 30 minutes (absent until T5 is applied). */
export async function flushPending(ctx: Ctx): Promise<StepStats> {
  try {
    const result = await ctx.db.rpc<unknown>('bot_flush_pending');
    const n = typeof result === 'number' ? result : Number((result as { flushed?: unknown } | null)?.flushed ?? 0);
    return { flushed: Number.isFinite(n) ? n : 0 };
  } catch (error) {
    if (error instanceof DbError && (error.code === 'PGRST202' || error.status === 404)) return { missing: 1 };
    throw error;
  }
}

/** The whole tick. Returns its numbers (also written by `bot_tick_beat` and the log line). */
export async function runTick(ctx: Ctx, ports: Ports, options: TickOptions = {}): Promise<StepStats> {
  const started = ctx.now();
  const deadline = started + TICK_BUDGET_MS - STOP_MARGIN_MS;
  const pace = pacer(ctx.now, options.sleep ?? defaultSleep);
  const limit = options.limit ?? CLAIM_LIMIT;
  const totals: StepStats = {};
  const tools: TickTools = { deadline, pace };
  const steps: Array<[string, () => Promise<StepStats>]> = [
    ['close', () => ports.group.closePosts(ctx, tools)],
    ['posts', () => ports.group.sendPosts(ctx, tools)],
    ['rem', () => reminders(ctx, deadline, pace, limit)],
    ['count', () => ports.group.counters(ctx, tools)],
    ['night', () => dayClose(ctx, deadline, pace, limit)],
    ['k3', () => afterDate(ctx, deadline, pace, limit)],
    ['flush', () => flushPending(ctx)],
  ];
  for (const [name, step] of steps) {
    try {
      const stats = await step();
      for (const [key, value] of Object.entries(stats)) if (Number.isFinite(value) && value !== 0) totals[`${name}_${key}`] = value;
    } catch (error) {
      totals[`${name}_error`] = 1;
      log({ route: 'tick', kind: name, outcome: 'failed', error_name: errorName(error), tg_code: error instanceof TelegramError ? error.code : undefined });
    }
  }
  totals.ms = ctx.now() - started;
  try {
    await ctx.db.tickBeat(totals);
  } catch (error) {
    log({ route: 'tick', kind: 'beat', outcome: 'failed', error_name: errorName(error) });
  }
  log({ route: 'tick', outcome: 'ok', ms: totals.ms, counts: totals });
  return totals;
}
