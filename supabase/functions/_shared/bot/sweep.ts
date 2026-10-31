/**
 * The tick's step «sweep»: the pictures of deleted exams and tests (migration 20261103090200_picture_sweep.sql).
 *
 * «Удалить тест» left the test's pictures in storage, the public ones (the cover, the studio's page pictures in the bucket
 * quiz-covers) still opening by their address (found 19.10). Now the database queues the folder «<container id>/» of every
 * deleted containers row, in the delete's own transaction, whoever deleted it. Each tick this step takes up to
 * SWEEP_FOLDERS of them (`bot_picture_sweep`: oldest first, each at most once a minute and 50 times), lists the folder in
 * both buckets through the Storage API with the service key and removes what it finds; a folder found empty in both
 * buckets leaves the queue (`bot_picture_swept`), so the folder is listed once more after its removal.
 *
 * Bounds: only the two buckets, only the folder of a container id the database gave (a UUID), only the Storage API (it
 * removes a file and its row together; a row deleted by SQL would leave the file behind), at most LIST_PAGES pages of a
 * folder a tick, and nothing started after the tick's deadline. A failing folder is counted and tried again by a later
 * tick; the step never throws into the tick but for the database's own failure. The log gets counts and error names
 * only: never a path, a name or a key.
 */
import { DbError } from './db.ts';
import { errorName, log } from './log.ts';
import type { Ctx, SweepPort } from './router.ts';
import type { StepStats, TickTools } from './tick.ts';
import type { FetchLike } from './tg.ts';

/** The buckets whose «<container id>/» folders hold a container's pictures (frontend/src/api/itemPictures.ts). */
export const SWEEP_BUCKETS = ['quiz-covers', 'test-item-images'] as const;
/** Folders a tick takes. */
export const SWEEP_FOLDERS = 5;
/** Objects a page of a folder's listing holds; one removal call takes one page. */
export const LIST_PAGE = 100;
/** Pages of one folder a tick lists (a folder of one test has a few dozen pictures). */
export const LIST_PAGES = 10;
export const STORAGE_TIMEOUT_MS = 10_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** A picture's own name in a folder: the sha256 of its bytes and the extension the buckets take. */
const NAME_RE = /^[0-9A-Za-z._-]{1,120}$/;

/** A Storage API answer that was not 2xx (only the status: never the body, which can name the path). */
export class StorageError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`storage ${status}`);
    this.name = 'StorageError';
    this.status = status;
  }
}

export interface SweepOptions {
  /** SUPABASE_URL. */
  url: string;
  /** The service key (as for the database). */
  key: string;
  fetch: FetchLike;
  timeoutMs?: number;
}

const add = (stats: StepStats, key: string, n = 1) => {
  stats[key] = (stats[key] ?? 0) + n;
};

export function createSweep(options: SweepOptions): SweepPort {
  const base = `${options.url.replace(/\/+$/, '')}/storage/v1/object`;
  const timeoutMs = options.timeoutMs ?? STORAGE_TIMEOUT_MS;
  // As db.ts: the new secret key goes on `apikey` only; a legacy service_role JWT also as the bearer.
  const headers: Record<string, string> = { apikey: options.key, 'Content-Type': 'application/json' };
  if (!options.key.startsWith('sb_')) headers.Authorization = `Bearer ${options.key}`;

  async function storage(method: 'POST' | 'DELETE', path: string, body: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await options.fetch(`${base}/${path}`, { method, headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      const name = errorName(error);
      throw new StorageError(name === 'TimeoutError' || name === 'AbortError' ? 0 : -1);
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new StorageError(res.status);
    }
    return res.json().catch(() => null);
  }

  /** The pictures in `folder` of `bucket`: «<folder>/<name>», files only (a sub-folder is listed without an id). */
  async function list(bucket: string, folder: string): Promise<string[]> {
    const paths: string[] = [];
    for (let page = 0; page < LIST_PAGES; page += 1) {
      const rows = await storage('POST', `list/${bucket}`, {
        prefix: folder,
        limit: LIST_PAGE,
        offset: page * LIST_PAGE,
        sortBy: { column: 'name', order: 'asc' },
      });
      const list = Array.isArray(rows) ? (rows as Array<{ id?: unknown; name?: unknown }>) : [];
      for (const row of list) if (row && row.id && typeof row.name === 'string' && NAME_RE.test(row.name)) paths.push(`${folder}/${row.name}`);
      if (list.length < LIST_PAGE) break;
    }
    return paths;
  }

  return {
    async tick(ctx: Ctx, tools: TickTools): Promise<StepStats> {
      const stats: StepStats = {};
      let taken: unknown;
      try {
        taken = await ctx.db.rpc<unknown>('bot_picture_sweep', { p_limit: SWEEP_FOLDERS });
      } catch (error) {
        // The migration is not applied yet: nothing is queued.
        if (error instanceof DbError && (error.code === 'PGRST202' || error.status === 404)) return { missing: 1 };
        throw error;
      }
      const raw = taken && typeof taken === 'object' ? (taken as { folders?: unknown }).folders : null;
      const folders = (Array.isArray(raw) ? raw : []).filter((id): id is string => typeof id === 'string' && UUID_RE.test(id));
      add(stats, 'taken', folders.length);
      for (const folder of folders) {
        if (ctx.now() > tools.deadline) {
          add(stats, 'left');
          continue;
        }
        try {
          let found = 0;
          for (const bucket of SWEEP_BUCKETS) {
            const paths = await list(bucket, folder);
            found += paths.length;
            for (let at = 0; at < paths.length; at += LIST_PAGE) {
              const removed = await storage('DELETE', bucket, { prefixes: paths.slice(at, at + LIST_PAGE) });
              add(stats, 'removed', Array.isArray(removed) ? removed.length : 0);
            }
          }
          if (found === 0) {
            await ctx.db.rpc<unknown>('bot_picture_swept', { p_container: folder });
            add(stats, 'emptied');
          }
        } catch (error) {
          add(stats, 'failed');
          log({ route: 'tick', kind: 'sweep', outcome: 'failed', error_name: error instanceof StorageError ? `storage_${error.status}` : errorName(error) });
        }
      }
      return stats;
    },
  };
}
