/**
 * One question of a «занятие» in chat (spec §4.3, decisions 13–16): how its options are shown, its words apart from
 * its code, the marks of several correct answers carried in `callback_data`, a short answer as the server compares it,
 * and the queue's own facts («7 из 20», a mistake coming back).
 *
 * - Options go on full-width buttons, one a row, when each is at most 24 characters on one line, none is code and the
 *   file's order is not kept (`keep_order`); otherwise the text lists them by letter (А–З) and the buttons are letters
 *   (decision 13, §3). Code options are always letters, each in `<code>` (Z3).
 * - Several correct answers (Z4): a tap changes only the keyboard; the marks travel in `callback_data` as a mask of
 *   shown indices (`t<mask>`, «Ответить» `a<mask>`); nothing reaches the database before «Ответить».
 * - The order of the options is the copied `optionOrder` (seeded, «все перечисленные» last, `keep_order` kept); the
 *   queue is the copied `session.ts` (`counter`, `afterAnswer`). Nothing here re-implements the container's modules.
 *
 * `codeLike`, `splitStem` and `shortNorm` mirror the site's components/containers/model.ts (not one of the copied
 * pure modules): the same rules and the same test vectors. `shortNorm` is `public.meldy_short_norm`.
 */
import { afterAnswer, counter, optionOrder, pinnedLast, type QueueEntry } from '../plan/session.ts';

export type { QueueEntry };

/** The option letters as the site shows them (copy.ts OPTION_LETTERS). */
export const LETTERS = ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З'] as const;
/** §3: an option on a full-width button has at most 24 characters. */
export const OPTION_MAX = 24;
export const MAX_OPTIONS = 8;
/** The longest typed answer the server grades (grade_answer: ≤ 1000 characters). */
export const SHORT_MAX = 1000;

export type ItemKind = 'single' | 'multiple' | 'short';

/** One question as the session shows it: options in the SHOWN order, never the key (bot_session_view). */
export interface QuestionItem {
  id: string;
  kind: ItemKind;
  /** Verbatim, code kept as written (≤ 4000 characters). */
  stem: string;
  /** In the order shown; [] for a short answer. */
  options: string[];
  /** The importer found code in the question or its options. */
  code: boolean;
  keepOrder: boolean;
  /** The number in the file («№ 57»); '' → the position. */
  fileNo: string;
  position: number;
  /** The topic's title from the file («Тема 3. Транзакции»), when the question has a topic. */
  topicTitle: string | null;
  /** 'manual': the file did not mark the answer, the author set the key. */
  keySource: string;
  rev: number;
  /** When the author changed the key of the version shown (ISO), else null: «Ключ исправлен автором 16 октября.» */
  keyChangedAt: string | null;
}

// ─────────────────────────────────────────── code in a question ───────────────────────────────────────────

/**
 * A code-like line: braces, semicolons, operators or a keyword, and few Cyrillic letters once its comments and string
 * literals are left out («Console.WriteLine(c); // целочисленное деление» is code). The site's model.ts `codeLike`.
 */
export function codeLike(line: string): boolean {
  const text = line.trim();
  if (!text) return false;
  if (/^(\/\/|\/\*|#|--\s)/.test(text)) return true;
  const bare = text
    .replace(/\/\*.*?\*\//g, ' ')
    .replace(/\/\/.*$/, ' ')
    .replace(/\s--\s.*$/, ' ')
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`/g, '""')
    .trim();
  const letters = bare.match(/[a-zа-яё]/gi) ?? [];
  const cyrillic = bare.match(/[а-яё]/gi) ?? [];
  if (letters.length > 0 && cyrillic.length / letters.length > 0.5) return false;
  if (/^\s{2,}|\t/.test(line)) return true;
  if (/[;{}]|=>|==|!=|\+\+|::|<\/?\w+>|\w\(.*\)|\[\d*\]/.test(bare)) return true;
  return /^(int|var|let|const|string|bool|double|float|char|long|class|struct|public|private|protected|static|void|for|while|if|else|return|using|namespace|import|from|def|print|console|select|insert|update|delete|create|alter|drop|begin|end|function|new)\b/i.test(bare);
}

/** A stem with code: the words before, the code block (its lines verbatim), the words after. The site's `splitStem`. */
export function splitStem(stem: string, code: boolean): { before: string; code: string | null; after: string } {
  const text = stem.replace(/\r\n?/g, '\n');
  if (!code || !text.includes('\n')) return { before: text.trim(), code: null, after: '' };
  const lines = text.split('\n');
  let first = lines.findIndex((line) => codeLike(line));
  if (first < 0) return { before: text.trim(), code: null, after: '' };
  let last = lines.length - 1;
  while (last > first && !codeLike(lines[last])) last -= 1;
  // A question line ending with «?» or «:» right before the code stays words even if it has brackets.
  if (first === 0 && lines.length > 1 && /[?:]\s*$/.test(lines[0]) && !/[;{}]/.test(lines[0])) first = 1;
  const block = lines.slice(first, last + 1).join('\n').replace(/\s+$/, '');
  const before = lines.slice(0, first).join('\n').trim();
  const after = lines.slice(last + 1).join('\n').trim();
  return { before, code: block || null, after };
}

/** An option is code when the question carries code and one of the option's lines looks like code. */
export function optionIsCode(item: Pick<QuestionItem, 'code'>, option: string): boolean {
  return item.code && String(option).split(/\r?\n/).some((line) => codeLike(line));
}

// ─────────────────────────────────────────── how the options are shown ───────────────────────────────────────────

export type LayoutMode = 'buttons' | 'letters' | 'text';

export interface Layout {
  /** buttons: options on full-width buttons; letters: listed by letter in the text, letters on the buttons; text: a short answer. */
  mode: LayoutMode;
  /** Per shown option: shown as code (`<code>`). */
  code: boolean[];
}

const chars = (text: string) => [...text].length;

/** Decision 13 and Z3: buttons only when every option fits one ≤ 24-character line, none is code and the order is the shuffle's. */
export function layoutOf(item: Pick<QuestionItem, 'kind' | 'options' | 'code' | 'keepOrder'>): Layout {
  if (item.kind === 'short' || item.options.length === 0) return { mode: 'text', code: [] };
  const code = item.options.map((option) => optionIsCode(item, option));
  const fits = item.options.every((option) => {
    const label = String(option).trim();
    return label.length > 0 && !/[\r\n]/.test(label) && chars(label) <= OPTION_MAX;
  });
  return { mode: !code.some(Boolean) && !item.keepOrder && fits ? 'buttons' : 'letters', code };
}

/** The label of an option button (buttons mode): the option on one line. */
export const optionLabel = (option: string) => String(option).trim();

/**
 * Rows of letter buttons (§3): up to 5 a row, by 4 for 6–8 options. With several correct answers a marked letter reads
 * «✓ Б» (3 characters), which a row of five cannot hold (one character each): five then go 3 + 2.
 */
export function letterRows(n: number, multiple: boolean): number[][] {
  const all = Array.from({ length: Math.max(0, Math.min(MAX_OPTIONS, n)) }, (_, i) => i);
  if (all.length === 0) return [];
  if (all.length === 5 && multiple) return [all.slice(0, 3), all.slice(3)];
  if (all.length <= 5) return [all];
  return [all.slice(0, 4), all.slice(4)];
}

// ─────────────────────────────────────────── marks of several correct answers ───────────────────────────────────────────

/** Is shown option `i` marked in `mask`? */
export const isMarked = (mask: number, i: number) => (mask & (1 << i)) !== 0;
/** The mask after a tap on shown option `i`. */
export const flip = (mask: number, i: number) => mask ^ (1 << i);
/** A mask the question can carry: 0 ≤ mask < 2^n. */
export const validMask = (mask: number, n: number) => Number.isInteger(mask) && mask >= 0 && mask < 2 ** Math.max(0, Math.min(MAX_OPTIONS, n));
/** The marked shown indices, in shown order. */
export function marked(mask: number, n: number): number[] {
  return Array.from({ length: Math.max(0, Math.min(MAX_OPTIONS, n)) }, (_, i) => i).filter((i) => isMarked(mask, i));
}

// ─────────────────────────────────────────── the order of the options ───────────────────────────────────────────

/** The seed of the options' order at a position: the session's id and the place in the queue (the site: `${id}:${pos}`). */
export const orderSeed = (sid: string, pos: number) => `${sid}:${pos}`;

/**
 * File indices in the order shown at `pos` (the copied `optionOrder`: a seeded shuffle, «все перечисленные» last,
 * `keep_order` kept). A retry stands at another position, so it gets a new order. The file's order is the fallback.
 */
export function shownOrder(fileOptions: readonly string[], keepOrder: boolean, sid: string, pos: number): number[] {
  const n = fileOptions.length;
  try {
    const order = optionOrder(n, keepOrder, pinnedLast(fileOptions), orderSeed(sid, pos));
    if (order.length === n && new Set(order).size === n) return order;
  } catch {
    // The file's order is always a fair fallback.
  }
  return fileOptions.map((_, i) => i);
}

// ─────────────────────────────────────────── a short answer ───────────────────────────────────────────

/**
 * A short answer normalised as the server compares it (`public.meldy_short_norm`; the site's `shortNorm`): lower case,
 * ё → е, every run of whitespace → one space, trimmed, one final «.» dropped.
 */
export function shortNorm(value: string): string {
  let text = String(value).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').replace(/^ +| +$/g, '');
  if (text.endsWith('.')) text = text.slice(0, -1);
  return text.replace(/ +$/, '');
}

/** The file's form a typed answer matched (what «Верно: 32.» shows), or null. */
export function matchedForm(typed: string, forms: readonly string[]): string | null {
  const norm = shortNorm(typed);
  if (norm === '') return null;
  return forms.find((form) => shortNorm(form) === norm) ?? null;
}

/** What a typed message sends as the answer: null when it is not an answer at all (nothing left after normalising). */
export function typedAnswer(text: string): string | null {
  const value = String(text);
  if (shortNorm(value) === '') return null;
  return [...value].length > SHORT_MAX ? [...value].slice(0, SHORT_MAX).join('') : value;
}

// ─────────────────────────────────────────── the queue ───────────────────────────────────────────

/** «7 из 20» at `pos` (the copied `counter`: a retry repeats the place it came back to). */
export function counterAt(queue: readonly QueueEntry[], pos: number): { n: number; of: number } {
  if (queue.length === 0) return { n: 0, of: 0 };
  try {
    return counter(queue, Math.min(Math.max(0, pos), queue.length - 1));
  } catch {
    return { n: Math.min(pos + 1, queue.length), of: queue.length };
  }
}

/** Does a mistake at `pos` come back in this session (3–5 questions later, at most twice)? The site's `comesAgain`. */
export function comesAgain(queue: readonly QueueEntry[], pos: number, sid: string): boolean {
  const entry = queue[pos];
  if (!entry) return false;
  try {
    return afterAnswer(queue.slice(), pos, { id: entry.id, correct: false }, orderSeed(sid, pos)).slice(pos + 1).some((e) => e.id === entry.id);
  } catch {
    return false;
  }
}

/** The queue after the answer at `pos` was resolved: a mistake comes back, a misclick changes nothing (copied `afterAnswer`). */
export function queueAfter(queue: readonly QueueEntry[], pos: number, answer: { correct: boolean; misclick?: boolean }, sid: string): QueueEntry[] {
  const entry = queue[pos];
  if (!entry) return queue.slice();
  try {
    return afterAnswer(queue.slice(), pos, { id: entry.id, correct: answer.correct, misclick: answer.misclick }, orderSeed(sid, pos));
  } catch {
    return queue.slice();
  }
}

/** The options in the file's order, from the options shown and `order` (order[k] = the file index shown k-th). */
export function fileOptionsOf(options: readonly string[], order: readonly number[]): string[] | null {
  if (order.length !== options.length) return null;
  const out: string[] = new Array(options.length);
  for (let k = 0; k < order.length; k += 1) {
    const f = order[k];
    if (!Number.isInteger(f) || f < 0 || f >= options.length || out[f] !== undefined) return null;
    out[f] = options[k];
  }
  return out;
}

/** The order a question is shown in at `pos` (file indices, display order); [] for a short answer. */
export function orderFor(item: { kind: ItemKind; keepOrder: boolean; options: readonly string[] }, sid: string, pos: number): number[] {
  return item.kind === 'short' ? [] : shownOrder(item.options, item.keepOrder, sid, pos);
}

/**
 * The queue after a miss at `pos` that comes back (CONTRACT_T5 «Дальше»): the copied `afterAnswer` (seed `<sid>:<pos>`,
 * as the site seeds it) and, for the repeat it inserted, a new option order (seed `<sid>:<its position>`). Each entry
 * is `{id, retry}`; the new one also carries `shown`. null when there is nothing to insert.
 */
export function requeueAfterMiss(queue: readonly QueueEntry[], pos: number, sid: string,
  item: { id: string; kind: ItemKind; keepOrder: boolean; fileOptions: readonly string[] }): Array<{ id: string; retry: number; shown?: number[] }> | null {
  const entry = queue[pos];
  if (!entry || entry.id !== item.id || entry.retry >= 2) return null;
  let next = queueAfter(queue, pos, { correct: false }, sid);
  let at = next.findIndex((e, i) => i > pos && e.id === item.id && e.retry === entry.retry + 1);
  if (at < 0) {
    // afterAnswer always inserts below two retries; should it not, the repeat goes last (still «after it»).
    next = [...queue, { id: item.id, retry: (entry.retry + 1) as 1 | 2 }];
    at = next.length - 1;
  }
  return next.map((e, i) => (i === at
    ? { id: e.id, retry: e.retry, shown: orderFor({ kind: item.kind, keepOrder: item.keepOrder, options: item.fileOptions }, sid, i) }
    : { id: e.id, retry: e.retry }));
}

/** «№ 57» (the file's number, else the position). */
export const fileNumber = (item: Pick<QuestionItem, 'fileNo' | 'position'>) => (item.fileNo && item.fileNo.trim() ? item.fileNo.trim() : String(item.position));
