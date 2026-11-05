/**
 * The drafts of question editors kept through a login that ends by itself (release 52's open point: the session ran out
 * — the refresh failed, or the account signed out in another tab — and the sign-in page took the place of the page,
 * with the question's changes not saved). An open editor holding changes registers here (keepOnSessionLost); when
 * AuthContext hears a sign-out the app did not ask for, it calls sessionLost() before the page goes, and every such
 * editor's draft is written to this tab's sessionStorage (it lives through the sign-in page and Google's round trip in
 * the same tab, and goes with the tab). Back on the page, the editor of that question takes its draft (takeRescued) when
 * the question is still as it was, and the page says which question waits (rescuedFor). «Выйти» from the account menu
 * is the author's own choice and keeps nothing (the leave check asked first). A draft older than a day is dropped.
 */

const KEY = 'meldy_rescued_drafts';
const LOST = 'meldy:session-lost';
const DAY_MS = 24 * 60 * 60 * 1000;

export interface RescuedDraft {
  containerId: string;
  /** null — a new question not added yet. */
  itemId: string | null;
  /** The question as it was when the editor opened it (the editor's stamp): a question changed since takes nothing. */
  stamp: string;
  draft: unknown;
  at: number;
}

type Saver = () => RescuedDraft | null;

const savers = new Set<Saver>();
let listening = false;

const keyOf = (containerId: string, itemId: string | null) => `${containerId}:${itemId ?? 'new'}`;
const isObj = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function isRescued(value: unknown): value is RescuedDraft {
  return (
    isObj(value) &&
    typeof value.containerId === 'string' &&
    (value.itemId === null || typeof value.itemId === 'string') &&
    typeof value.stamp === 'string' &&
    typeof value.at === 'number' &&
    isObj(value.draft)
  );
}

function read(now = Date.now()): Record<string, RescuedDraft> {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!isObj(parsed)) return {};
    const out: Record<string, RescuedDraft> = {};
    for (const [key, value] of Object.entries(parsed)) if (isRescued(value) && now - value.at < DAY_MS) out[key] = value;
    return out;
  } catch {
    return {};
  }
}

function write(all: Record<string, RescuedDraft>): void {
  try {
    if (Object.keys(all).length === 0) window.sessionStorage.removeItem(KEY);
    else window.sessionStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // storage full or blocked: nothing more can be kept
  }
}

/** Every registered editor holding changes writes its draft now. */
export function rescueNow(): void {
  if (savers.size === 0) return;
  const all = read();
  for (const saver of savers) {
    let kept: RescuedDraft | null = null;
    try {
      kept = saver();
    } catch {
      kept = null;
    }
    if (kept) all[keyOf(kept.containerId, kept.itemId)] = kept;
  }
  write(all);
}

/** An open editor: `saver` gives its draft while it holds changes (null otherwise). The returned function takes it back. */
export function keepOnSessionLost(saver: Saver): () => void {
  if (!listening && typeof window !== 'undefined') {
    window.addEventListener(LOST, rescueNow);
    listening = true;
  }
  savers.add(saver);
  return () => {
    savers.delete(saver);
  };
}

/** The session ended without the app asking (AuthContext): the open editors keep their drafts before the page goes. */
export function sessionLost(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(LOST));
}

/** The kept draft of a question, taken out of the store: only while the question is as it was (`stamp`). */
export function takeRescued(containerId: string, itemId: string | null, stamp: string): unknown | null {
  if (typeof window === 'undefined') return null;
  const all = read();
  const key = keyOf(containerId, itemId);
  const kept = all[key];
  if (!kept) return null;
  delete all[key];
  write(all);
  return kept.stamp === stamp ? kept.draft : null;
}

/** The questions of an exam with a kept draft (oldest first): the page says they wait. */
export function rescuedFor(containerId: string): RescuedDraft[] {
  if (typeof window === 'undefined') return [];
  return Object.values(read())
    .filter((kept) => kept.containerId === containerId)
    .sort((a, b) => a.at - b.at);
}
