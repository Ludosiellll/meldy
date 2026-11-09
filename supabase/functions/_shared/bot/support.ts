/**
 * Support through the bot (the owner, 2026-11-09: «поддержку можно сделать через бота, чтобы писали мне через основного
 * бота»; migration 20261109090100_bot_support.sql). Anyone writes to the author of Meldy in the bot's private chat and
 * gets the answer in the same chat; the site's «запрос на удаление аккаунта» reaches the author the same way.
 *
 * Writing: `/support`, or the site's deep link `/start support`, in a private chat — linked to a Meldy account or not —
 * answers with a ForceReply prompt. ONE RULE makes a message a support message: it is a Telegram reply, in a private
 * chat, to one of the bot's own support messages — the prompt, one of its two refusals (too long, not a text) or an
 * answer of the author. No per-chat state, so the rule is the same for a linked and an unlinked chat. The router asks
 * `supportReply` before anything else reads the message: such a reply is never a file, a voice answer or a typed answer
 * of a study question. A text of up to 2 000 characters is kept (`bot_support_add`: at most 5 an hour and 20 a day per
 * chat, counted in the database; the same message delivered twice is kept once) and confirmed; anything else is
 * answered and not kept. In a group chat `/support` gets one line and a button to the private chat, nothing is kept.
 *
 * The author's chat (the owner, 2026-11-09: always the owner's own Telegram, never a Meldy account's link). The
 * database holds only the sha256 of the author's Telegram username (bot.config.support_username_hash); the username is
 * nowhere in the code. A bot cannot write first, so the author presses «Старт» once: while no chat is bound, an update
 * from a private chat whose sender has a username is shown to `bot_support_owner`, which compares the hash itself and
 * binds that chat and that Telegram id — once. From then on the author is that Telegram id, not the username: whoever
 * carries the username later gets nothing. `ownerClaim` keeps the cost low: once the database says a chat is bound, the
 * instance never asks again; until then it asks about each sender at most once an hour.
 *
 * Reaching the author: the tick's step «support» (`bot_support_claim`: oldest first, at most 10 a tick; while no chat
 * is bound the rows wait). Each row is one message in the author's chat, sent at least once: a row counts as sent only
 * after `bot_support_done`; a 429, a timeout or a 5xx leaves it for a later tick (the claim's lease ends); a 403 — the
 * author stopped the bot — leaves every row waiting; a 400 closes the row with its code, so it never holds the ones
 * behind it. The first message of a tick rings: it is the author's own chat (as the monitor's alert).
 *
 * The author's reply: a Telegram reply to one of those messages. The database decides (`bot_support_reply`, by the
 * replier's Telegram id, the chat and the message replied to): only the bound Telegram in the bound chat, and only a
 * message the bot sent there for a row, gets an answer — anyone else falls through to the router as if this module
 * were not there. The reply's text goes to the sender's chat under «Ответ автора Meldy:»; every reply is relayed, the
 * row is marked answered by the first. Telegram refusing (the person stopped the bot) is said to the author.
 *
 * A sender's name and text are their own words in the author's chat: escaped, the name made inert (html.ts), and a
 * «/command» in the text broken so a tap never runs it (/stop would unlink a linked Telegram); links stay.
 * The log gets counts and error names only: never a name, a username, a text or an id (log.ts).
 */
import { dayText } from '../plan/words.ts';
import { localDay } from '../plan/time.ts';
import { DbError } from './db.ts';
import { b, code, esc, inert, lines, t, WORD_JOINER } from './html.ts';
import { errorName, log } from './log.ts';
import type { Ctx, SupportPort, TgUpdate } from './router.ts';
import type { StepStats, TickTools } from './tick.ts';
import { isBlocked, isRateLimited, send, TelegramError, type Keyboard, type TgMessage, type TgUser } from './tg.ts';
import * as W from './words.ts';

/** Rows a tick asks for. */
export const SUPPORT_LIMIT = 10;
/** A sender's name in the author's chat, in characters once made inert. */
export const NAME_MAX = 64;
/** The zone of a deletion request's day when the database names none. */
const DEFAULT_TZ = 'Europe/Minsk';

const MIN = 60_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** A Telegram username; anything else is left out of the header and never shown to the claim. */
const USERNAME_RE = /^[A-Za-z0-9_]{4,32}$/;

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {});
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
/** A message of the bot with plain spaces: the renderer glued it with no-break spaces, and so do some sentences of words.ts. */
const plain = (text: string) => text.replace(/\u00a0/g, ' ');
const size = (text: string) => [...text].length;
const usernameOf = (from: TgUser) => (typeof from.username === 'string' && USERNAME_RE.test(from.username) ? from.username : null);
/** The migration is not applied yet. */
const missing = (error: unknown) => error instanceof DbError && (error.code === 'PGRST202' || error.status === 404);

// ─────────────────────────────────────────── the rule ───────────────────────────────────────────

/** The bot's messages a reply to which is a support message: the prompt and its two refusals. */
export const SUPPORT_PROMPTS: readonly string[] = [W.SUPPORT_PROMPT, W.SUPPORT_TOO_LONG, W.SUPPORT_TEXT_ONLY];

const PLAIN_PROMPTS: readonly string[] = SUPPORT_PROMPTS.map(plain);

/** The text of one of the bot's support messages in a sender's chat: a prompt, or an answer of the author. */
export function isSupportPrompt(text: string): boolean {
  const said = plain(text);
  return PLAIN_PROMPTS.includes(said) || said.startsWith(W.SUPPORT_ANSWER);
}

/** The text of a message the tick sends to the author's chat (whose chat it is, the database says). */
export function isSupportNotice(text: string): boolean {
  const said = plain(text);
  return said.startsWith(`${W.SUPPORT_HEAD} · `) || said.startsWith(W.SUPPORT_DELETION);
}

// ─────────────────────────────────────────── messages ───────────────────────────────────────────

/** A «/command» no tap can run: a word joiner after the slash. A link's slashes are left alone. */
export function noCommands(text: string): string {
  return text.replace(/(^|[^\p{L}\p{N}_/])\/(?=[A-Za-z0-9_])/gu, `$1/${WORD_JOINER}`);
}

/** A sender's name in the header: one line, never a link or a second «·» field, at most NAME_MAX characters. */
function shownName(name: string | null): string {
  const clean = (name ?? '').replace(/·/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return W.SUPPORT_NO_NAME;
  const chars = [...inert(clean)];
  return chars.length > NAME_MAX ? `${chars.slice(0, NAME_MAX - 1).join('')}…` : chars.join('');
}

export type SupportRow =
  | { id: number; kind: 'message'; name: string | null; username: string | null; linked: boolean; text: string }
  /** `at`: when it was asked or taken back (epoch ms). */
  | { id: number; kind: 'deletion' | 'deletion_cancel'; userId: string; at: number };

/** The message of a row in the author's chat (HTML). `tz`: the zone of a request's day. */
export function notice(row: SupportRow, tz: string): string {
  if (row.kind === 'message') {
    return lines(b(W.supportHead(shownName(row.name), row.username, row.linked)), esc(noCommands(row.text)), '', t(W.SUPPORT_REPLY_HINT));
  }
  const id = `${t(' · id ')}${code(row.userId)}`;
  if (row.kind === 'deletion_cancel') return `${b(W.SUPPORT_DELETION_CANCEL)}${id}`;
  return `${b(W.SUPPORT_DELETION)}${id}${t(` · ${dayText(localDay(row.at, tz))}`)}`;
}

/** The author's answer in the sender's chat. */
export function answer(text: string): string {
  return lines(b(W.SUPPORT_ANSWER), esc(text));
}

const writeButton = (botUsername: string): Keyboard => [[{ text: W.SUPPORT_WRITE, url: `https://t.me/${botUsername}?start=support` }]];

// ─────────────────────────────────────────── a sender ───────────────────────────────────────────

/** `/support` and `/start support` in a private chat: the prompt. */
export async function supportCommand(ctx: Ctx, msg: TgMessage): Promise<void> {
  await send(ctx.tg, { chatId: msg.chat.id, text: t(W.SUPPORT_PROMPT), forceReply: { placeholder: W.SUPPORT_PLACEHOLDER } });
}

/**
 * `/support` in a group: where to write; nothing is kept. At most one line an hour per group and instance: a command
 * anyone can repeat must not flood the chat.
 */
export async function supportInGroup(ctx: Ctx, msg: TgMessage): Promise<void> {
  if (!ctx.hourly(msg.chat.id)) return;
  await send(ctx.tg, { chatId: msg.chat.id, text: t(W.SUPPORT_GROUP), keyboard: writeButton(ctx.botUsername), replyTo: msg.message_id });
}

/** A refusal that asks again: its own ForceReply, so the next reply is a support message too. */
const askAgain = (ctx: Ctx, chatId: number, text: string) => send(ctx.tg, { chatId, text: t(text), forceReply: { placeholder: W.SUPPORT_PLACEHOLDER } });

function senderName(from: TgUser): string | null {
  const name = [from.first_name, from.last_name].filter((part): part is string => typeof part === 'string').join(' ').replace(/\s+/g, ' ').trim();
  return name ? [...name].slice(0, 128).join('') : null;
}

/** A reply to a support prompt: kept and confirmed, or answered with why not. */
async function supportMessage(ctx: Ctx, msg: TgMessage): Promise<void> {
  const from = msg.from as TgUser;
  const chatId = msg.chat.id;
  if (typeof msg.text !== 'string') {
    await askAgain(ctx, chatId, W.SUPPORT_TEXT_ONLY);
    return;
  }
  const text = msg.text.trim();
  if (text === '') {
    await askAgain(ctx, chatId, W.SUPPORT_PROMPT);
    return;
  }
  if (size(text) > W.SUPPORT_TEXT_MAX) {
    await askAgain(ctx, chatId, W.SUPPORT_TOO_LONG);
    return;
  }
  const result = obj(await ctx.db.rpc<unknown>('bot_support_add', {
    p_tg_user_id: from.id, p_chat_id: chatId, p_message_id: msg.message_id, p_text: text, p_name: senderName(from), p_username: usernameOf(from),
  }));
  if (result.status === 'stored') await send(ctx.tg, { chatId, text: t(W.SUPPORT_SENT) });
  else if (result.status === 'slow_down') await send(ctx.tg, { chatId, text: t(result.limit === 'day' ? W.SUPPORT_SLOW_DAY : W.SUPPORT_SLOW_HOUR) });
  else if (result.status === 'too_long') await askAgain(ctx, chatId, W.SUPPORT_TOO_LONG);
  else if (result.status === 'empty') await askAgain(ctx, chatId, W.SUPPORT_PROMPT);
  // private_only: the database saw a chat that is not a private one; nothing is kept and nothing is said.
}

// ─────────────────────────────────────────── the author ───────────────────────────────────────────

/** A private chat's sender: of a message, or of a button press there. */
function privateSender(update: TgUpdate): { from: TgUser; chatId: number } | null {
  const msg = update.message;
  if (msg) return msg.chat?.type === 'private' && msg.from && !msg.from.is_bot ? { from: msg.from, chatId: msg.chat.id } : null;
  const press = update.callback_query;
  return press && press.message?.chat?.type === 'private' ? { from: press.from, chatId: press.message.chat.id } : null;
}

/**
 * The one-time claim of the author's chat, run before an update is handled (the update is then handled as any other).
 * The database compares the username's hash and binds the chat; the answer `claimed` comes once, with the line to that
 * chat. What an instance remembers: `settled` once the database says a chat is bound (it never asks again), each
 * sender it was told «not this one» about for an hour, and a pause after a call that failed. Never throws.
 */
export function ownerClaim(now: () => number): (ctx: Ctx, update: TgUpdate) => Promise<void> {
  let settled = false;
  let quietUntil = Number.NEGATIVE_INFINITY;
  const asked = new Map<number, number>();
  return async (ctx, update) => {
    if (settled || now() < quietUntil) return;
    const sender = privateSender(update);
    const username = sender ? usernameOf(sender.from) : null;
    if (!sender || username === null) return;
    const last = asked.get(sender.from.id);
    if (last !== undefined && now() - last < 60 * MIN) return;
    try {
      const result = obj(await ctx.db.rpc<unknown>('bot_support_owner', { p_tg_user_id: sender.from.id, p_chat_id: sender.chatId, p_username: username }));
      if (result.status === 'claimed' || result.status === 'set') settled = true;
      // off: no hash is set, nobody can claim; look again later, not on every update.
      else if (result.status === 'off') quietUntil = now() + 10 * MIN;
      else {
        if (asked.size > 10000) asked.clear();
        asked.set(sender.from.id, now());
      }
      if (result.status === 'claimed') await send(ctx.tg, { chatId: sender.chatId, text: t(W.SUPPORT_CLAIMED) });
    } catch (error) {
      if (missing(error)) {
        quietUntil = now() + 10 * MIN;
        return;
      }
      quietUntil = Math.max(quietUntil, now() + MIN);
      log({ route: 'webhook', kind: 'support', outcome: 'failed', error_name: errorName(error), tg_code: error instanceof TelegramError ? error.code : undefined });
    }
  };
}

/** A 400 or 403 from Telegram: it refused, nothing went out (a 429 and anything transient are not). */
const refused = (error: unknown) => error instanceof TelegramError && error.failure === 'api' && (error.code === 400 || error.code === 403);

/**
 * A reply to a message that reads as one of the tick's: true when the database says the replier is the author in the
 * author's chat and the bot answered; false for anyone else (nothing of support happens).
 */
async function authorReply(ctx: Ctx, msg: TgMessage, repliedId: number): Promise<boolean> {
  const from = msg.from as TgUser;
  const chatId = msg.chat.id;
  let raw: unknown;
  try {
    raw = await ctx.db.rpc<unknown>('bot_support_reply', { p_tg_user_id: from.id, p_chat_id: chatId, p_message_id: repliedId });
  } catch (error) {
    // Without the migration there is no author.
    if (missing(error)) return false;
    throw error;
  }
  const found = obj(raw);
  const say = (text: string) => send(ctx.tg, { chatId, text: t(text), replyTo: msg.message_id });
  if (found.status === 'gone') {
    await say(W.SUPPORT_GONE);
    return true;
  }
  if (found.status === 'service') {
    await say(W.SUPPORT_SERVICE);
    return true;
  }
  const id = num(found.id);
  const to = num(found.chat_id);
  if (found.status !== 'ok' || id === null || to === null) return false;
  if (typeof msg.text !== 'string') {
    await say(W.SUPPORT_TEXT_ONLY);
    return true;
  }
  if (size(msg.text) > W.SUPPORT_REPLY_MAX) {
    await say(W.SUPPORT_REPLY_LONG);
    return true;
  }
  try {
    await send(ctx.tg, { chatId: to, text: answer(msg.text) });
  } catch (error) {
    // A timeout, a 429 or a 5xx goes up: the update fails and Telegram brings the reply again.
    if (!refused(error)) throw error;
    // As every send to a person's chat: a 403 marks a linked Telegram blocked (nothing for one that is not linked).
    if (isBlocked(error)) await ctx.db.chatEvent(to, 'blocked').catch(() => undefined);
    await say(W.SUPPORT_NOT_DELIVERED);
    return true;
  }
  // The answer is out. From here nothing may fail the update: a retry would send the answer again.
  await ctx.db.rpc<unknown>('bot_support_answered', { p_id: id }).catch((error: unknown) => {
    log({ route: 'webhook', kind: 'support', outcome: 'failed', error_name: errorName(error) });
  });
  await say(W.SUPPORT_DELIVERED).catch((error: unknown) => {
    log({ route: 'webhook', kind: 'support', outcome: 'failed', error_name: errorName(error), tg_code: error instanceof TelegramError ? error.code : undefined });
  });
  return true;
}

/**
 * A private message that is a reply to a message of the bot: true when it was a support message or the author's reply
 * (answered here), false when it is neither and the router goes on.
 */
export async function supportReply(ctx: Ctx, msg: TgMessage): Promise<boolean> {
  const reply = msg.reply_to_message;
  if (!reply || !reply.from?.is_bot) return false;
  const asked = reply.text ?? '';
  if (isSupportPrompt(asked)) {
    await supportMessage(ctx, msg);
    return true;
  }
  return isSupportNotice(asked) ? authorReply(ctx, msg, reply.message_id) : false;
}

// ─────────────────────────────────────────── the tick's step ───────────────────────────────────────────

export type SupportClaim =
  | { status: 'ok'; chatId: number; tz: string; rows: SupportRow[]; bad: number[] }
  /** No chat is bound yet (the author has not pressed «Старт»): the rows wait. */
  | { status: 'no_chat'; waiting: number };

/** bot_support_claim → the rows to send; a row that is not one of the three kinds is `bad` (its id, to close it). */
export function parseClaim(raw: unknown): SupportClaim {
  const r = obj(raw);
  const chatId = num(r.chat_id);
  if (r.status !== 'ok' || chatId === null || chatId <= 0) return { status: 'no_chat', waiting: num(r.waiting) ?? 0 };
  const rows: SupportRow[] = [];
  const bad: number[] = [];
  for (const item of Array.isArray(r.rows) ? r.rows : []) {
    const x = obj(item);
    const id = num(x.id);
    if (id === null) continue;
    const text = str(x.text);
    const userId = str(x.user_id) ?? '';
    const at = Date.parse(str(x.at) ?? '');
    if (x.kind === 'message' && text !== null && text !== '') {
      const username = str(x.username);
      rows.push({ id, kind: 'message', name: str(x.name), username: username !== null && USERNAME_RE.test(username) ? username : null, linked: x.linked === true, text });
    } else if ((x.kind === 'deletion' || x.kind === 'deletion_cancel') && UUID_RE.test(userId) && Number.isFinite(at)) {
      rows.push({ id, kind: x.kind, userId, at });
    } else {
      bad.push(id);
    }
  }
  return { status: 'ok', chatId, tz: str(r.tz) ?? DEFAULT_TZ, rows, bad };
}

const add = (stats: StepStats, key: string, n = 1) => {
  stats[key] = (stats[key] ?? 0) + n;
};

export function createSupport(options: { limit?: number } = {}): SupportPort {
  const limit = options.limit ?? SUPPORT_LIMIT;
  return {
    async tick(ctx: Ctx, tools: TickTools): Promise<StepStats> {
      const stats: StepStats = {};
      let raw: unknown;
      try {
        raw = await ctx.db.rpc<unknown>('bot_support_claim', { p_limit: limit });
      } catch (error) {
        // The migration is not applied yet: nothing is kept.
        if (missing(error)) return { missing: 1 };
        throw error;
      }
      const claim = parseClaim(raw);
      if (claim.status !== 'ok') {
        if (claim.waiting > 0) add(stats, 'waiting', claim.waiting);
        return stats;
      }
      const close = (id: number, args: Record<string, unknown>) => ctx.db.rpc<unknown>('bot_support_done', { p_id: id, ...args });
      for (const id of claim.bad) {
        await close(id, { p_error: 'bad_row' }).catch(() => undefined);
        add(stats, 'bad');
      }
      for (const row of claim.rows) {
        if (ctx.now() > tools.deadline) {
          add(stats, 'left'); // the claim's lease ends: a later tick takes it
          continue;
        }
        let sent: TgMessage;
        try {
          await tools.pace();
          // open: the owner copies an account's id or a person's words from their own chat (tg.ts SendArgs.open)
          sent = await send(ctx.tg, { chatId: claim.chatId, text: notice(row, claim.tz), sound: stats.sent === undefined, open: true });
        } catch (error) {
          if (isRateLimited(error)) {
            add(stats, 'rate_limited'); // Telegram did nothing: the rows wait for a later tick
            break;
          }
          if (isBlocked(error)) {
            add(stats, 'blocked'); // the author stopped the bot: every row waits until it is started again
            break;
          }
          if (error instanceof TelegramError && error.failure === 'api' && error.code < 500) {
            // Telegram will never take this one: closed with its code, so it does not hold the rows behind it.
            await close(row.id, { p_error: `tg_${error.code}` }).catch(() => undefined);
            add(stats, 'failed');
            continue;
          }
          // A timeout, a network error or a 5xx: it may have gone out; a later tick sends it again (at least once).
          add(stats, 'unknown');
          log({ route: 'tick', kind: 'support', outcome: 'failed', error_name: errorName(error), tg_code: error instanceof TelegramError ? error.code : undefined });
          break;
        }
        try {
          // Without this mark the row goes out again: tried twice before the step gives up.
          const mark = () => close(row.id, { p_chat_id: claim.chatId, p_message_id: sent.message_id });
          await mark().catch(() => mark());
          add(stats, 'sent');
        } catch (error) {
          add(stats, 'error');
          log({ route: 'tick', kind: 'support', outcome: 'failed', error_name: errorName(error) });
          break;
        }
      }
      return stats;
    },
  };
}
