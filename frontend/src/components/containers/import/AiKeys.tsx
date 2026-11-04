import { IMPORT, KEYS_AI_WORDS, nb } from '../copyImport';
import type { KeysAiOutcome } from './keysAi';

/**
 * «Подобрать ключи с ИИ» (owner, 2026-11-04): the button with how many questions go and what it costs, the rule in one
 * line, then while it runs its progress, and after it what came of it. The page keeps the run (ImportPage), the keys go
 * into the import's fixes, the queue «Проверьте ключи от ИИ» takes them.
 */

export interface KeysRun {
  status: 'idle' | 'running' | 'done' | 'failed';
  /** The subject the run was for (its key); null — all. */
  scope: string | null;
  done: number;
  total: number;
  outcome: KeysAiOutcome | null;
  error: string | null;
  /** The server asked to wait (429): the run goes on by itself at this time (ms). */
  waitUntil?: number | null;
}

export const NO_KEYS_RUN: KeysRun = { status: 'idle', scope: null, done: 0, total: 0, outcome: null, error: null, waitUntil: null };

/** The button and its line: «Подобрать ключи с ИИ · 25 вопросов без ключа · 5 единиц». */
export function AiKeysOffer({ count, cost, busy, onRun, rule = true }: { count: number; cost: number; busy: boolean; onRun: () => void; rule?: boolean }) {
  if (count <= 0) return null;
  return (
    <div className="im-aikeys">
      <p className="im-line">
        <button type="button" className="sf-link" disabled={busy} onClick={onRun}>
          {KEYS_AI_WORDS.go}
        </button>{' '}
        <span className="im-aikeys-meta">{nb(KEYS_AI_WORDS.offer(count, cost))}</span>
      </p>
      {rule ? <p className="im-hint" data-muted="">{KEYS_AI_WORDS.rule}</p> : null}
    </div>
  );
}

/**
 * What the run is doing or did: progress (and the server's «wait», counted down by `now`), then «Ключи подобраны для 18
 * из 25 вопросов. Без ключа остались 7: …» and what was charged.
 */
export function AiKeysStatus({ run, now = Date.now() }: { run: KeysRun; now?: number }) {
  if (run.status === 'idle') return null;
  if (run.status === 'running') {
    const wait = run.waitUntil && run.waitUntil > now ? Math.ceil((run.waitUntil - now) / 1000) : 0;
    return (
      <p className="im-line" role="status">
        {nb(KEYS_AI_WORDS.running(run.done, run.total))}
        {wait > 0 ? ` ${nb(IMPORT.serverWait(wait))}` : ''}
      </p>
    );
  }
  const outcome = run.outcome;
  const lines: string[] = [];
  if (outcome && outcome.sent > 0) {
    lines.push(KEYS_AI_WORDS.keyed(outcome.keyed, outcome.sent));
    const notes = Object.entries(outcome.notes).sort((a, b) => b[1] - a[1]);
    const left = notes.reduce((sum, [, n]) => sum + n, 0);
    if (left > 0) lines.push(KEYS_AI_WORDS.left(left, notes));
    if (outcome.stale) lines.push(KEYS_AI_WORDS.stale(outcome.stale));
    const unwritten = Object.entries(outcome.unwritten ?? {}).sort((a, b) => b[1] - a[1]);
    const missed = unwritten.reduce((sum, [, n]) => sum + n, 0);
    if (missed > 0) lines.push(KEYS_AI_WORDS.unwritten(missed, unwritten));
  }
  // what was charged, said plainly: the units of the answers that came; after a lost answer the error line says the rest
  if (outcome && outcome.units > 0) lines.push(KEYS_AI_WORDS.spent(outcome.units));
  else if (outcome && run.error && run.error !== KEYS_AI_WORDS.network) lines.push(KEYS_AI_WORDS.notSpent);
  return (
    <div className="im-aikeys-result">
      {run.error ? (
        <p className="im-line" role="alert">
          {nb(run.error)}
          {outcome && outcome.keyed > 0 ? ` ${KEYS_AI_WORDS.partial(outcome.keyed)}` : ''}
        </p>
      ) : null}
      {lines.length > 0 ? (
        <p className="im-line" role="status">
          {nb(lines.join(' '))}
        </p>
      ) : null}
    </div>
  );
}

/** «Проверьте ключи от ИИ (N). Проверить»: the keys the student has not accepted or changed yet. */
export function AiKeysCheck({ count, busy, onOpen, label }: { count: number; busy: boolean; onOpen: () => void; label: string }) {
  if (count <= 0) return null;
  return (
    <p className="im-line">
      {nb(KEYS_AI_WORDS.check(count))}{' '}
      <button type="button" className="sf-link" disabled={busy} onClick={onOpen}>
        {label}
      </button>
    </p>
  );
}
