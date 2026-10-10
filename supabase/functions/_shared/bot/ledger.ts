/**
 * The update ledger (spec decision 6, §6.1; the engineer's fix of «seen first»): `bot_update_begin` → `new` / `retry`:
 * handle; `done` / `busy`: answer 200. `done` is written only after the handler succeeded, so an update whose handling
 * failed runs again when Telegram retries it (a lost `/start <code>` was the bug of marking it seen first).
 *
 * After a failure (`bot_update_failed` with the error's name):
 * - a message (or `my_chat_member`) → 503 when trying later can help (the database or Telegram was down, slow or
 *   rate-limited): Telegram retries for up to 24 h, link codes are judged by the message's date. A deterministic
 *   failure (a 4xx, a bug) → 200: retrying it every minute for a day would not help;
 * - a button press → the line «Meldy сейчас не отвечает…» and 200 (a press expires after 150 s anyway).
 * One log line per update.
 */
import { DbError } from './db.ts';
import { errorName, log } from './log.ts';
import { TelegramError } from './tg.ts';
import type { Ctx, Tap, TgUpdate, UpdateKind } from './router.ts';
import * as W from './words.ts';

/** Whether handling the same update later can succeed: the database or Telegram was unreachable, slow, failing or busy. */
export function transient(error: unknown): boolean {
  if (error instanceof DbError) return error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500;
  if (error instanceof TelegramError) return error.failure === 'timeout' || error.failure === 'network' || error.code === 429 || error.code >= 500;
  return false;
}

/** The name kept in bot.updates.error_name (`^[A-Za-z0-9_.:-]{1,64}$`): TelegramError:429, DbError:503, TypeError… */
export function failureName(error: unknown): string {
  if (error instanceof TelegramError) return `TelegramError:${error.code}`;
  if (error instanceof DbError) return `DbError:${error.status}`;
  return errorName(error);
}

/** Runs one update through the ledger; returns the HTTP status for Telegram. */
export async function processUpdate(ctx: Ctx, update: TgUpdate, kind: UpdateKind, tap: Tap | null,
  run: () => Promise<void>, started: number): Promise<number> {
  const id = update.update_id;
  const ms = () => ctx.now() - started;
  if (kind === 'ignored') {
    log({ route: 'webhook', update_id: id, kind, outcome: 'ignored', ms: ms() });
    return 200;
  }
  let state: Awaited<ReturnType<Ctx['db']['updateBegin']>>;
  try {
    state = await ctx.db.updateBegin(id);
  } catch (error) {
    log({ route: 'webhook', update_id: id, kind, outcome: 'failed', error_name: failureName(error), ms: ms() });
    if (tap) {
      await tap.answer(W.DB_DOWN_TAP);
      return 200;
    }
    return 503;
  }
  if (state === 'done' || state === 'busy') {
    log({ route: 'webhook', update_id: id, kind, outcome: state, ms: ms() });
    return 200;
  }
  try {
    await run();
  } catch (error) {
    await ctx.db.updateFailed(id, failureName(error)).catch(() => undefined);
    log({ route: 'webhook', update_id: id, kind, outcome: 'failed', error_name: failureName(error),
      tg_code: error instanceof TelegramError ? error.code : undefined, ms: ms() });
    if (tap) {
      if (!tap.answered) await tap.answer(W.DB_DOWN_TAP);
      return 200;
    }
    return transient(error) ? 503 : 200;
  }
  // A lost «done» costs one extra run on a retry (every effect is idempotent on its own key).
  await ctx.db.updateDone(id).catch(() => undefined);
  log({ route: 'webhook', update_id: id, kind, outcome: state === 'retry' ? 'ok_retry' : 'ok', ms: ms() });
  return 200;
}
