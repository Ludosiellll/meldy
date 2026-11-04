/**
 * The import page's queue of files to read (owner, 2026-11-04: of 24 files sent at once about half came back with
 * «Много файлов за минуту»). At most `concurrency` files are read at once. A file the server refuses for now (429) is
 * not a failure: it goes back to its place in the queue, the queue waits as long as the server asks (Retry-After, else
 * `waitMs`) and goes on by itself; the other files keep their places behind it. Only a file refused again and again for
 * longer than `giveUpMs` (or more than `maxTries` times) fails, with the usual line and its retry.
 *
 * Pure of React: the page gives the jobs, the clock and the timer (tests give fake ones).
 */

/**
 * Thrown by a job the server refused for now: `retryAfterMs` — how long it asked to wait (null — it did not say);
 * `detail` — the server's own line (a spent day says «обновится завтра», not «подождите минуту»).
 */
export class Throttled extends Error {
  readonly retryAfterMs: number | null;
  readonly detail: string | null;
  constructor(retryAfterMs: number | null, detail: string | null = null) {
    super('throttled');
    this.name = 'Throttled';
    this.retryAfterMs = retryAfterMs;
    this.detail = detail;
  }

  /** The server asks for longer than the queue waits (a spent hour or day): its own line says so. */
  get long(): boolean {
    return (this.retryAfterMs ?? 0) > LONGEST_WAIT_MS;
  }
}

export interface QueueJob {
  /** One try; throws Throttled when the server asks to wait (anything else is the job's own business). */
  attempt: () => Promise<void>;
  /** The job waits until this moment (ms of `now`) and then goes on by itself. */
  onWait?: (until: number) => void;
  /** Refused for too long (or for a spent hour or day): the job fails; the last refusal says why. */
  onGiveUp?: (refusal: Throttled) => void;
}

export interface ReadQueueOptions {
  concurrency: number;
  /** The wait when the server names none. */
  waitMs?: number;
  /** A job refused for longer than this since its first refusal fails. */
  giveUpMs?: number;
  /** …or refused more times than this. */
  maxTries?: number;
  now?: () => number;
  later?: (run: () => void, ms: number) => void;
}

export const READ_WAIT_MS = 20_000;
export const READ_GIVE_UP_MS = 180_000;
export const READ_MAX_TRIES = 10;
/** The longest wait taken from the server's word (a day's limit names hours: then the job gives up instead). */
const LONGEST_WAIT_MS = 120_000;

interface Queued {
  seq: number;
  job: QueueJob;
  tries: number;
  firstRefused: number | null;
}

export interface ReadQueue {
  push: (job: QueueJob) => void;
  /** Jobs waiting and running. */
  size: () => number;
}

export function createReadQueue(options: ReadQueueOptions): ReadQueue {
  const waitMs = options.waitMs ?? READ_WAIT_MS;
  const giveUpMs = options.giveUpMs ?? READ_GIVE_UP_MS;
  const maxTries = options.maxTries ?? READ_MAX_TRIES;
  const now = options.now ?? (() => Date.now());
  const later = options.later ?? ((run: () => void, ms: number) => void setTimeout(run, ms));
  const waiting: Queued[] = [];
  let running = 0;
  let seq = 0;
  let pausedUntil = 0;
  let timer = false;

  /** Back to its place: before every job pushed after it. */
  const putBack = (entry: Queued) => {
    const at = waiting.findIndex((other) => other.seq > entry.seq);
    if (at < 0) waiting.push(entry);
    else waiting.splice(at, 0, entry);
  };

  const pump = () => {
    const at = now();
    if (at < pausedUntil) {
      if (!timer) {
        timer = true;
        later(() => {
          timer = false;
          pump();
        }, pausedUntil - at);
      }
      return;
    }
    while (running < options.concurrency && waiting.length > 0) {
      const entry = waiting.shift()!;
      running += 1;
      entry.tries += 1;
      void entry.job
        .attempt()
        .then(
          () => undefined,
          (error: unknown) => {
            if (!(error instanceof Throttled)) return;
            const refusedAt = now();
            entry.firstRefused ??= refusedAt;
            const wait = Math.min(LONGEST_WAIT_MS, Math.max(1_000, error.retryAfterMs ?? waitMs));
            if (refusedAt + wait - entry.firstRefused > giveUpMs || entry.tries >= maxTries || error.long) {
              entry.job.onGiveUp?.(error);
              return;
            }
            pausedUntil = Math.max(pausedUntil, refusedAt + wait);
            entry.job.onWait?.(pausedUntil);
            putBack(entry);
          },
        )
        .finally(() => {
          running -= 1;
          pump();
        });
    }
  };

  return {
    push(job) {
      seq += 1;
      waiting.push({ seq, job, tries: 0, firstRefused: null });
      pump();
    },
    size: () => waiting.length + running,
  };
}

/** Seconds from a Retry-After header: a number of seconds or an HTTP date; null when absent or unreadable. */
export function retryAfterMs(header: string | null | undefined, at: number = Date.now()): number | null {
  if (!header) return null;
  const value = header.trim();
  if (/^\d{1,6}$/.test(value)) return Number(value) * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - at);
}
