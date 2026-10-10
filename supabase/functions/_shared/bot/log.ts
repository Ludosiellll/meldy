/**
 * The bot's one log function (spec §6.7): one JSON line per update, tick or admin call.
 *
 * Only these fields are written, and only in these shapes: the route, the update id, the kind of update or step, the
 * time taken, the outcome, an error's NAME (never its message: a fetch error's message can carry the request URL,
 * and Telegram's URL holds the token), Telegram's error code and a few counters. Texts, names, user and chat ids
 * never reach the log. `console.*` is used here and nowhere else in the bot (a test greps for it).
 */

export type LogRoute = 'webhook' | 'tick' | 'setup' | 'status' | 'file' | 'http';

export interface LogEntry {
  route: LogRoute;
  update_id?: number;
  /** The update's kind (message, callback, my_chat_member…) or the tick's step. */
  kind?: string;
  ms?: number;
  /** ok, skip, busy, failed, unauthorized… */
  outcome: string;
  /** An Error's name or a short code (TelegramError, DbError, TimeoutError…). */
  error_name?: string;
  /** Telegram's error_code (0: network or timeout). */
  tg_code?: number;
  /** Counters of a tick step (claimed, sent, skipped…). */
  counts?: Record<string, number>;
}

const TOKEN_RE = /^[A-Za-z0-9_.:|-]{1,48}$/;

function word(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value);
  return TOKEN_RE.test(text) ? text : 'invalid';
}

function int(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : undefined;
}

/** The entry as it is written: unknown fields dropped, free text replaced. */
export function cleanEntry(entry: LogEntry): Record<string, unknown> {
  const out: Record<string, unknown> = { route: word(entry.route) ?? 'http', outcome: word(entry.outcome) ?? 'invalid' };
  const updateId = int(entry.update_id);
  if (updateId !== undefined) out.update_id = updateId;
  const kind = word(entry.kind);
  if (kind !== undefined) out.kind = kind;
  const ms = int(entry.ms);
  if (ms !== undefined) out.ms = ms;
  const errorName = word(entry.error_name);
  if (errorName !== undefined) out.error_name = errorName;
  const tgCode = int(entry.tg_code);
  if (tgCode !== undefined) out.tg_code = tgCode;
  if (entry.counts && typeof entry.counts === 'object') {
    const counts: Record<string, number> = {};
    for (const [key, value] of Object.entries(entry.counts)) {
      const k = word(key);
      const v = int(value);
      if (k && k !== 'invalid' && v !== undefined) counts[k] = v;
    }
    if (Object.keys(counts).length > 0) out.counts = counts;
  }
  return out;
}

type Sink = (line: string, failed: boolean) => void;

const consoleSink: Sink = (line, failed) => {
  if (failed) console.error(line);
  else console.log(line);
};

let sink: Sink = consoleSink;

/** Tests: capture the lines; returns the function that puts the console back. */
export function setLogSink(next: Sink): () => void {
  sink = next;
  return () => {
    sink = consoleSink;
  };
}

const FAILED = new Set(['failed', 'error', 'unauthorized']);

/** Writes one line. Never throws. */
export function log(entry: LogEntry): void {
  try {
    const clean = cleanEntry(entry);
    sink(JSON.stringify(clean), FAILED.has(String(clean.outcome)) || clean.error_name !== undefined);
  } catch {
    // A log line is never worth failing an update.
  }
}

/** The name to log for anything thrown: the Error's name only. */
export function errorName(error: unknown): string {
  if (error && typeof error === 'object' && 'name' in error) {
    const name = String((error as { name: unknown }).name);
    if (TOKEN_RE.test(name)) return name;
  }
  return 'Error';
}
