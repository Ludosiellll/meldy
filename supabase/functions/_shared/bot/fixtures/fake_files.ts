// The file hand-off for the function's tests (package T9): an in-memory model of
// supabase/migrations/20261010120005_telegram_bot_files.sql on T2's fake database (bot_file_offer, bot_file_redeem, and
// telegram_file_take as the site calls it), and a fake of Telegram's file server
// (https://api.telegram.org/file/bot<token>/<file_path>) around T2's fake Bot API, which also answers getFile.
// Everything here is invented: the exam «Осенняя сессия» of the spec, made-up file ids, bytes that are not a real bank.
import { createHash, randomBytes } from 'node:crypto';
import { DbError } from '../db.ts';
import type { FakeDb } from './fake_db.ts';
import type { FakeTelegram } from './fake_telegram.ts';

const MIN = 60_000;
const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

export interface FileRow {
  ticketHash: string;
  userId: string;
  fileId: string;
  name: string | null;
  size: number | null;
  mime: string | null;
  expiresAt: number;
  tokenHash: string | null;
  tokenExpiresAt: number | null;
  usedAt: number | null;
}

export function fakeFileStore(fake: FakeDb, options: { now: () => number }) {
  const now = options.now;
  const rows = new Map<string, FileRow>();

  fake.on('bot_file_offer', (args) => {
    const tg = Number(args.p_tg_user_id);
    const fileId = args.p_file_id;
    const size = args.p_size === null || args.p_size === undefined ? null : Number(args.p_size);
    if (!(tg > 0) || typeof fileId !== 'string' || !/^[!-~]{1,512}$/.test(fileId) || (size !== null && size < 0)) {
      throw new DbError('bot_file_offer', 400, '22023');
    }
    const link = fake.link(tg);
    if (!link) return { status: 'unlinked' };
    if (size !== null && size > 20 * 1024 * 1024) return { status: 'too_big' };
    for (const [hash, row] of rows) if (row.expiresAt < now() - 24 * 60 * MIN) rows.delete(hash);
    const ticket = `F${randomBytes(16).toString('hex')}`;
    const expiresAt = now() + 30 * MIN;
    rows.set(sha(ticket), {
      ticketHash: sha(ticket), userId: link.userId, fileId, name: typeof args.p_name === 'string' ? args.p_name : null, size,
      mime: typeof args.p_mime === 'string' ? args.p_mime : null, expiresAt, tokenHash: null, tokenExpiresAt: null, usedAt: null,
    });
    return { status: 'ok', ticket, expires_at: new Date(expiresAt).toISOString() };
  });

  fake.on('bot_file_redeem', (args) => {
    const token = args.p_token;
    if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return { status: 'invalid' };
    const row = [...rows.values()].find((r) => r.tokenHash === sha(token));
    if (!row) return { status: 'invalid' };
    if (row.usedAt !== null) return { status: 'used' };
    if ((row.tokenExpiresAt ?? 0) <= now()) return { status: 'expired' };
    row.usedAt = now();
    return { status: 'ok', file_id: row.fileId, name: row.name, size: row.size, mime: row.mime };
  });

  return {
    rows,
    /** telegram_file_take(p_ticket) as the site's signed-in user `userId` calls it. */
    take(userId: string, ticket: string): Record<string, unknown> {
      if (!/^F[0-9a-f]{32}$/.test(ticket)) return { status: 'invalid' };
      const row = rows.get(sha(ticket));
      if (!row) return { status: 'invalid' };
      if (row.userId !== userId) return { status: 'other_user' };
      if (row.usedAt !== null) return { status: 'used' };
      if (row.expiresAt <= now()) return { status: 'expired' };
      const token = randomBytes(32).toString('hex');
      row.tokenHash = sha(token);
      row.tokenExpiresAt = now() + MIN;
      return { status: 'ok', token, expires_at: new Date(row.tokenExpiresAt).toISOString(), name: row.name, size: row.size, mime: row.mime };
    },
    rowOf(ticket: string): FileRow | undefined {
      return rows.get(sha(ticket));
    },
  };
}

export type FakeFileStore = ReturnType<typeof fakeFileStore>;

export type ServerFailure = 'network' | 'hang' | '404' | '500' | 'cut' | 'slow_body';

/**
 * Telegram's file server: `files` maps a file_path to its bytes. Answers like the real one would (with cache headers the
 * function must not pass on). Failures: a network error whose message holds the URL (as Deno's does), a request that
 * hangs until its signal aborts, 404 / 500 with Telegram's JSON, a body cut halfway (the error names the URL), a body
 * that stalls after the first chunk until the signal aborts. Every other URL goes to T2's fake Bot API.
 */
export function fakeFileServer(tg: FakeTelegram, files: Record<string, Uint8Array>) {
  const downloads: string[] = [];
  const failures: ServerFailure[] = [];

  const fetchFn = async (url: string, init?: RequestInit): Promise<Response> => {
    const m = /^https:\/\/api\.telegram\.org\/file\/bot([^/]+)\/(.+)$/.exec(url);
    if (!m) return tg.fetch(url, init);
    downloads.push(url);
    if (m[1] !== tg.token) return Response.json({ ok: false, error_code: 401, description: 'Unauthorized' }, { status: 401 });
    const signal = init?.signal ?? null;
    const aborted = () => signal?.reason ?? new DOMException('The signal has been aborted', 'AbortError');
    const failure = failures.shift();
    if (failure === 'network') throw new TypeError(`error sending request for url (${url}): connection reset`);
    if (failure === 'hang') {
      return new Promise<Response>((_, reject) => {
        if (signal?.aborted) reject(aborted());
        signal?.addEventListener('abort', () => reject(aborted()), { once: true });
      });
    }
    if (failure === '404') return Response.json({ ok: false, error_code: 404, description: 'Not Found' }, { status: 404 });
    if (failure === '500') return new Response('<html>500</html>', { status: 500 });
    const bytes = files[decodeURIComponent(m[2])];
    if (!bytes) return Response.json({ ok: false, error_code: 404, description: 'Not Found' }, { status: 404 });
    const headers = {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(bytes.length),
      'Cache-Control': 'max-age=31536000, public',
      ETag: '"5f1c-telegram"',
      'Last-Modified': 'Fri, 16 Oct 2026 17:00:00 GMT',
      Expires: 'Sat, 16 Oct 2027 17:00:00 GMT',
    };
    if (failure === 'cut' || failure === 'slow_body') {
      const half = bytes.slice(0, Math.max(1, Math.floor(bytes.length / 2)));
      let sent = false;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (!sent) {
            sent = true;
            controller.enqueue(half);
            return;
          }
          if (failure === 'cut') {
            controller.error(new TypeError(`error reading a body from connection for url (${url})`));
            return;
          }
          return new Promise<void>((resolve) => {
            const stop = () => {
              controller.error(aborted());
              resolve();
            };
            if (signal?.aborted) stop();
            else signal?.addEventListener('abort', stop, { once: true });
          });
        },
      });
      return new Response(body, { status: 200, headers });
    }
    return new Response(bytes, { status: 200, headers });
  };

  return {
    fetch: fetchFn,
    downloads,
    fail(...queue: ServerFailure[]) {
      failures.push(...queue);
    },
  };
}

export type FakeFileServer = ReturnType<typeof fakeFileServer>;

/** Synthetic bytes for «Банк_БД_2026.docx» (not a real document; the import is not run here). */
export function syntheticBytes(length: number, seed = 7): Uint8Array {
  const out = new Uint8Array(length);
  let x = seed;
  for (let i = 0; i < length; i += 1) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out[i] = x & 0xff;
  }
  return out;
}
