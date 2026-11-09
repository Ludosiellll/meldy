// Support's six functions of migration 20261109090100_bot_support.sql in memory, on fakeDb's `on()` (support.test.ts):
// bot_support_add (a private chat only; the same message kept once; empty, too long; 5 an hour and 20 a day per chat),
// bot_support_owner (the one-time claim: the sha256 of the lowercased username against the stored hash, a private chat
// only, once — claimed, then set for everyone), bot_support_claim (no_chat with how many wait while no chat is bound;
// else the oldest waiting rows under a lease of 50 seconds), bot_support_done (sent with the author's message, or closed
// with a short code), bot_support_reply (none for anyone but the bound Telegram in the bound chat; gone; service; ok
// with the sender's chat) and bot_support_answered. `request` and `cancel` queue what the site's
// account_deletion_request and account_deletion_cancel queue. The author's handle here is invented.
import { createHash } from 'node:crypto';
import { DbError } from '../db.ts';
import type { FakeDb } from './fake_db.ts';

/** An invented handle for the tests; the real one is nowhere in the repository, only its hash in the migration. */
export const OWNER_USERNAME = 'meldy_owner_test';
/** As the database hashes it: sha256 of the lowercased username, hex. */
export const usernameHash = (username: string) => createHash('sha256').update(username.toLowerCase(), 'utf8').digest('hex');

export interface SupportRow {
  id: number;
  createdAt: number;
  kind: 'message' | 'deletion' | 'deletion_cancel';
  userId: string | null;
  chatId: number | null;
  tgMessageId: number | null;
  name: string | null;
  username: string | null;
  text: string | null;
  claimedAt: number | null;
  sentAt: number | null;
  ownerChatId: number | null;
  ownerMessageId: number | null;
  error: string | null;
  answeredAt: number | null;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
export const LEASE_MS = 50_000;

export function fakeSupportDb(fdb: FakeDb, now: () => number) {
  const rows: SupportRow[] = [];
  /** bot.config's three columns: the hash the migration sets, and the chat and Telegram id the claim binds. */
  const config = { usernameHash: usernameHash(OWNER_USERNAME) as string | null, chatId: null as number | null, tgUserId: null as number | null };
  let nextId = 1;
  const bad = (fn: string) => new DbError(fn, 400, '22023');
  const waiting = () => rows.filter((r) => r.sentAt === null && r.error === null);
  const blank = (kind: SupportRow['kind']): SupportRow => ({
    id: nextId++, createdAt: now(), kind, userId: null, chatId: null, tgMessageId: null, name: null, username: null, text: null,
    claimedAt: null, sentAt: null, ownerChatId: null, ownerMessageId: null, error: null, answeredAt: null,
  });

  fdb.on('bot_support_owner', (a) => {
    if (config.chatId !== null) return { status: 'set' };
    if (config.usernameHash === null) return { status: 'off' };
    const tg = Number(a.p_tg_user_id);
    const username = typeof a.p_username === 'string' ? a.p_username : '';
    if (!(tg > 0) || Number(a.p_chat_id) !== tg || !/^[A-Za-z0-9_]{4,32}$/.test(username) || usernameHash(username) !== config.usernameHash) return { status: 'no' };
    config.chatId = tg;
    config.tgUserId = tg;
    return { status: 'claimed' };
  });

  fdb.on('bot_support_add', (a) => {
    const tg = Number(a.p_tg_user_id);
    const chatId = Number(a.p_chat_id);
    const messageId = Number(a.p_message_id);
    if (!(tg > 0) || chatId !== tg || !Number.isFinite(messageId)) return { status: 'private_only' };
    if (rows.some((r) => r.kind === 'message' && r.chatId === chatId && r.tgMessageId === messageId)) return { status: 'stored' };
    const text = typeof a.p_text === 'string' ? a.p_text.trim() : '';
    if (text === '') return { status: 'empty' };
    if ([...text].length > 2000) return { status: 'too_long' };
    const mine = rows.filter((r) => r.kind === 'message' && r.chatId === chatId);
    if (mine.filter((r) => r.createdAt > now() - HOUR).length >= 5) return { status: 'slow_down', limit: 'hour' };
    if (mine.filter((r) => r.createdAt > now() - 24 * HOUR).length >= 20) return { status: 'slow_down', limit: 'day' };
    const link = fdb.links.find((l) => l.tgUserId === tg && l.unlinkedAt === null);
    const name = typeof a.p_name === 'string' ? a.p_name.replace(/\s+/g, ' ').trim().slice(0, 128) : '';
    rows.push({
      ...blank('message'), userId: link ? link.userId : null, chatId, tgMessageId: messageId, name: name || null,
      username: typeof a.p_username === 'string' && /^[A-Za-z0-9_]{4,32}$/.test(a.p_username) ? a.p_username : null, text,
    });
    return { status: 'stored' };
  });

  fdb.on('bot_support_claim', (a) => {
    const limit = Number(a.p_limit ?? 10);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw bad('bot_support_claim');
    const cutoff = now() - 90 * 24 * HOUR;
    for (let i = rows.length - 1; i >= 0; i -= 1) if (rows[i].createdAt < cutoff) rows.splice(i, 1);
    if (config.chatId === null) return { status: 'no_chat', waiting: waiting().length };
    const link = fdb.links.find((l) => l.tgUserId === config.tgUserId && l.unlinkedAt === null);
    const taken = waiting().filter((r) => r.claimedAt === null || r.claimedAt <= now() - LEASE_MS).sort((x, y) => x.id - y.id).slice(0, limit);
    for (const r of taken) r.claimedAt = now();
    return {
      status: 'ok', chat_id: config.chatId, tz: link ? link.tz : 'Europe/Minsk',
      rows: taken.map((r) => (r.kind === 'message'
        ? { id: r.id, kind: r.kind, name: r.name, username: r.username, linked: r.userId !== null, text: r.text }
        : { id: r.id, kind: r.kind, user_id: r.userId, at: new Date(r.createdAt).toISOString() })),
    };
  });

  fdb.on('bot_support_done', (a) => {
    const sent = a.p_chat_id != null && a.p_message_id != null;
    const error = typeof a.p_error === 'string' ? a.p_error : null;
    if (sent === (error !== null) || (error !== null && !/^[a-z0-9_]{1,32}$/.test(error))) throw bad('bot_support_done');
    const row = rows.find((r) => r.id === Number(a.p_id) && r.sentAt === null && r.error === null);
    if (!row) return { status: 'gone' };
    if (sent) {
      row.sentAt = now();
      row.ownerChatId = Number(a.p_chat_id);
      row.ownerMessageId = Number(a.p_message_id);
    } else {
      row.error = error;
    }
    return { status: 'ok' };
  });

  fdb.on('bot_support_reply', (a) => {
    if (config.tgUserId === null || Number(a.p_tg_user_id) !== config.tgUserId || Number(a.p_chat_id) !== config.chatId) return { status: 'none' };
    const row = rows.find((r) => r.ownerChatId === config.chatId && r.ownerMessageId === Number(a.p_message_id));
    if (!row) return { status: 'gone' };
    if (row.kind !== 'message') return { status: 'service' };
    return { status: 'ok', id: row.id, chat_id: row.chatId };
  });

  fdb.on('bot_support_answered', (a) => {
    const row = rows.find((r) => r.id === Number(a.p_id) && r.kind === 'message' && r.sentAt !== null);
    if (!row) return { status: 'gone' };
    row.answeredAt = row.answeredAt ?? now();
    return { status: 'ok' };
  });

  return {
    rows,
    config,
    waiting,
    /** What public.account_deletion_request queues for the author. */
    request(userId: string) {
      const row = { ...blank('deletion'), userId };
      rows.push(row);
      return row;
    },
    /** What public.account_deletion_cancel queues. */
    cancel(userId: string) {
      const row = { ...blank('deletion_cancel'), userId };
      rows.push(row);
      return row;
    },
  };
}

export type FakeSupport = ReturnType<typeof fakeSupportDb>;
