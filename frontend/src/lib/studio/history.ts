/**
 * «Отменить / Повторить» of the studio (Ctrl+Z / Ctrl+Shift+Z): a stack of whole documents, pure. A step is one change
 * of the page; typing into one block is one step while the keys keep coming (each within COALESCE_MS of the last one),
 * so Ctrl+Z takes back the word typed, not one letter. At most HISTORY_LIMIT steps back are kept.
 */
import type { TestDoc } from '../../types/testDoc';
import { sameValue } from './doc';

export const HISTORY_LIMIT = 100;
export const COALESCE_MS = 1000;

export interface DocHistory {
  readonly past: readonly TestDoc[];
  readonly present: TestDoc;
  readonly future: readonly TestDoc[];
  /** The coalescing key of the latest step (typing in one block), null for any other change. */
  readonly key: string | null;
  /** When the latest step was recorded (ms, the caller's clock). */
  readonly at: number;
}

/** A fresh history (a loaded document, or the one another tab saved after «Обновить»). */
export function startHistory(doc: TestDoc, at = 0): DocHistory {
  return { past: [], present: doc, future: [], key: null, at };
}

/** The key that makes typing into one field of one block a single step. */
export const typingKey = (blockId: string, field = 'text'): string => `type:${blockId}:${field}`;

const same = (a: TestDoc, b: TestDoc) => sameValue(a, b);

/**
 * The page changed to `doc` at `at` (ms). With a `key` equal to the latest step's, recorded within COALESCE_MS of it,
 * the change joins that step. Any new step drops what «Повторить» could bring back. A change to the same page records
 * nothing.
 */
export function record(history: DocHistory, doc: TestDoc, at: number, key: string | null = null): DocHistory {
  if (same(doc, history.present)) return history;
  if (key !== null && key === history.key && at >= history.at && at - history.at < COALESCE_MS) {
    return { ...history, present: doc, future: [], at };
  }
  const past = [...history.past, history.present];
  return { past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past, present: doc, future: [], key, at };
}

/** The present page replaced without a step (ids of new questions bound after a save, say). */
export function amend(history: DocHistory, doc: TestDoc): DocHistory {
  return doc === history.present ? history : { ...history, present: doc };
}

export const canUndo = (history: DocHistory): boolean => history.past.length > 0;
export const canRedo = (history: DocHistory): boolean => history.future.length > 0;

export function undo(history: DocHistory): DocHistory {
  if (!canUndo(history)) return history;
  const past = history.past.slice(0, -1);
  return { past, present: history.past[history.past.length - 1], future: [history.present, ...history.future], key: null, at: history.at };
}

export function redo(history: DocHistory): DocHistory {
  if (!canRedo(history)) return history;
  return { past: [...history.past, history.present], present: history.future[0], future: history.future.slice(1), key: null, at: history.at };
}
