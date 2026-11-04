/**
 * «Подобрать ключи с ИИ» on the import page (owner, 2026-11-04: «делай подбор ключей с ии»; contract
 * docs/import/KEYS_AI.md). Only on the student's press. The questions sent are those the file gave no key and that the
 * model can read: single or multiple choice, without pictures, within the server's limits; one request per subject (its
 * title goes along), per 100 questions and per 4 of the server's model batches (one price step: the server answers 4
 * batches well within its deadline with 2 calls at a time), sent one after another; a request the server asks to wait
 * (429 with Retry-After) waits and goes again. A key comes back only when two independent answers
 * agreed and were sure; it becomes the student's own key with aiKey (saved with key_source 'manual' and the flag ai_key)
 * and waits in «Проверьте ключи от ИИ». A question without a key stays without one, with the server's note («ИИ не
 * уверен»). A result for a question that changed while the AI answered (its file read again, a key set by hand) is
 * dropped.
 *
 * Pure but for the call it is given (api/containers.ts keysAi), so the tests give a fake server.
 */
import { keysAi, type KeysAiQuestion, type KeysAiResponse } from '../../../api/containers';
import { keysAiCost } from '../../../lib/plans';
import { KEYS_AI_WORDS } from '../copyImport';
import { activeSubjects, type DraftSubject, type ImportEdits, type ItemFix } from './importModel';
import { retryAfterMs } from './readQueue';

/** The server's limits (backend/bank_keys_ai.py): longer questions are left out, they stay without a key. */
export const KEYS_AI_MAX_QUESTIONS = 300;
/** The server's model batches (bank_keys_ai.make_batches): up to 25 questions and 12 000 characters each… */
const BATCH_QUESTIONS = 25;
const BATCH_CHARS = 12_000;
/** …and at most 12 of them in a request (more is a 413). */
export const KEYS_AI_MAX_BATCHES = 12;
/**
 * What one request of ours holds: 100 questions and 4 batches, one price step (keysAiCost). The server answers a batch
 * twice with 2 calls at a time within 150 s: 4 batches leave room for slow answers, 12 did not (the last ones came back
 * without an answer but paid). Several requests cost what one bigger request would: 5 units per 100 or per 4 batches.
 */
export const KEYS_AI_REQUEST_QUESTIONS = 100;
export const KEYS_AI_REQUEST_BATCHES = 4;
const MAX_TEXT = 2000;
const MAX_OPTIONS = 10;
const MIN_OPTIONS = 2;
const MAX_OPTION = 500;

export interface KeysAiCandidate {
  uid: string;
  /** The file the question was read from: a result after that file was read again is dropped. */
  fileId: string;
  subjectKey: string;
  subjectTitle: string;
  question: KeysAiQuestion;
  /** Option i as sent is the file's option optionMap[i] (ItemFix.correct keeps the file's indices). */
  optionMap: number[];
}

/**
 * The questions «Подобрать ключи с ИИ» sends: a choice question without a key from the file and without one the student
 * set, with no picture (the model cannot see it), no conflict of variants, not already refused as unsure; within the
 * server's limits. `only` — one subject's (its key).
 */
export function keysAiCandidates(subjects: readonly DraftSubject[], edits: ImportEdits, only: string | null = null): KeysAiCandidate[] {
  const out: KeysAiCandidate[] = [];
  for (const subject of activeSubjects(subjects)) {
    if (only !== null && subject.key !== only) continue;
    for (const item of subject.test) {
      if (item.kind !== 'single' && item.kind !== 'multiple') continue;
      if (item.rawCorrect.length > 0 || item.correct.length > 0 || item.variantKeys || item.marked.length > 0) continue;
      if (item.images || item.imageLost || item.flags.includes('has_image')) continue;
      const fix = edits.items[item.uid];
      if (fix?.correct || fix?.aiTried === 'low') continue;
      const text = item.text.trim();
      const options = item.options.map((option) => option.trim());
      if (!text || text.length > MAX_TEXT) continue;
      if (options.length < MIN_OPTIONS || options.length > MAX_OPTIONS || options.some((option) => !option || option.length > MAX_OPTION)) continue;
      out.push({
        uid: item.uid,
        fileId: item.fileId,
        subjectKey: subject.key,
        subjectTitle: subject.title,
        question: { id: item.uid, text, options, kind: item.kind },
        optionMap: [...item.optionMap],
      });
    }
  }
  return out;
}

/**
 * Of a subject joining the exam's own subject (updateModel.ts joinPlans), only the questions it adds go: the ones the
 * exam has already are not saved again, so the AI is not asked about them.
 */
export function keysAiForJoins(
  candidates: readonly KeysAiCandidate[],
  joins: Readonly<Record<string, { plan: { add: ReadonlyArray<{ uid: string }> } }>>,
): KeysAiCandidate[] {
  const keys = Object.keys(joins);
  if (keys.length === 0) return [...candidates];
  const adding = new Set(keys.flatMap((key) => joins[key].plan.add.map((item) => item.uid)));
  return candidates.filter((candidate) => !(candidate.subjectKey in joins) || adding.has(candidate.uid));
}

export interface KeysAiBatch {
  subject: string;
  items: KeysAiCandidate[];
}

const codePoints = (text: string) => Array.from(text).length;

/** A question's size as the server counts it for its batches (bank_keys_ai._rendered_size), in code points. */
function questionSize(question: KeysAiQuestion): number {
  return codePoints(question.text.trim()) + question.options.reduce((sum, option) => sum + codePoints(option) + 4, 0) + 40;
}

/** The server's batching of a request, step by step: whether the next question starts a new batch. */
class Batcher {
  batches = 0;
  private inBatch = 0;
  private size = 0;

  startsNew(cost: number): boolean {
    return this.inBatch === 0 || this.inBatch >= BATCH_QUESTIONS || this.size + cost > BATCH_CHARS;
  }

  add(cost: number): void {
    if (this.startsNew(cost)) {
      this.batches += 1;
      this.inBatch = 0;
      this.size = 0;
    }
    this.inBatch += 1;
    this.size += cost;
  }
}

/** How many model batches the server makes of these questions (bank_keys_ai.make_batches): the price counts them. */
export function keysAiBatchCount(questions: readonly KeysAiQuestion[]): number {
  const batcher = new Batcher();
  questions.forEach((question) => batcher.add(questionSize(question)));
  return batcher.batches;
}

/** One request's units, as the server charges it: 5 per started 100 questions or per started 4 batches, the more. */
export const keysAiRequestCost = (questions: readonly KeysAiQuestion[]) => keysAiCost(questions.length, keysAiBatchCount(questions));

/** A subject's questions split into requests: up to 100 questions and 4 batches each (KEYS_AI_REQUEST_*). */
export function keysAiRequests<T>(list: readonly T[], questionOf: (entry: T) => KeysAiQuestion): T[][] {
  const out: T[][] = [];
  let current: T[] = [];
  let batcher = new Batcher();
  for (const entry of list) {
    const cost = questionSize(questionOf(entry));
    if (current.length >= KEYS_AI_REQUEST_QUESTIONS || (batcher.startsNew(cost) && batcher.batches >= KEYS_AI_REQUEST_BATCHES)) {
      out.push(current);
      current = [];
      batcher = new Batcher();
    }
    batcher.add(cost);
    current.push(entry);
  }
  if (current.length > 0) out.push(current);
  return out;
}

/** One request per subject (its title goes along as context), split as keysAiRequests says. */
export function keysAiBatches(candidates: readonly KeysAiCandidate[]): KeysAiBatch[] {
  const bySubject = new Map<string, KeysAiCandidate[]>();
  for (const candidate of candidates) bySubject.set(candidate.subjectKey, [...(bySubject.get(candidate.subjectKey) ?? []), candidate]);
  const out: KeysAiBatch[] = [];
  bySubject.forEach((items) => {
    for (const part of keysAiRequests(items, (item) => item.question)) out.push({ subject: items[0].subjectTitle, items: part });
  });
  return out;
}

/** What the press costs: each request is charged on its own (keysAiRequestCost). */
export function keysAiPrice(candidates: readonly KeysAiCandidate[]): number {
  return keysAiBatches(candidates).reduce((sum, batch) => sum + keysAiRequestCost(batch.items.map((item) => item.question)), 0);
}

/** The longest wait a run takes on its own (a spent day's Retry-After is hours: that one stops the run). */
const LONGEST_WAIT_MS = 3 * 60_000;
const DEFAULT_WAIT_MS = 20_000;
const MAX_WAITS = 6;

/** How long to wait before sending again, or null when the refusal is not for waiting (the AI busy, the day's units). */
function waitBeforeAgain(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status;
  const code = String((error as { code?: unknown } | null)?.code ?? '');
  if (status !== 429 || code === 'ai_limit' || code === 'ai_busy') return null;
  const header = (error as { retryAfter?: unknown } | null)?.retryAfter;
  const ms = retryAfterMs(typeof header === 'string' ? header : null) ?? DEFAULT_WAIT_MS;
  return ms > LONGEST_WAIT_MS ? null : Math.max(1_000, ms);
}

export interface KeysAiRunOptions {
  /** The server asked to wait (a minute's limit, another request of the same user running): until when. */
  onWait?: (until: number | null) => void;
  /** Whether a question's result still applies when it comes (its file not read again, no key set meanwhile). */
  isFresh?: (candidate: KeysAiCandidate) => boolean;
  /** Waiting itself (tests give a fake clock). */
  sleep?: (ms: number) => Promise<void>;
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** One request, sent again after each «wait» the server asks for (429 with Retry-After), up to MAX_WAITS times. */
export async function sendWaiting<T>(send: () => Promise<T>, options: Pick<KeysAiRunOptions, 'onWait' | 'sleep'> = {}): Promise<T> {
  for (let waits = 0; ; waits += 1) {
    try {
      const response = await send();
      options.onWait?.(null);
      return response;
    } catch (error) {
      const ms = waits < MAX_WAITS ? waitBeforeAgain(error) : null;
      if (ms === null) {
        options.onWait?.(null);
        throw error;
      }
      options.onWait?.(Date.now() + ms);
      await (options.sleep ?? pause)(ms);
    }
  }
}

export interface KeysAiOutcome {
  /** Questions sent. */
  sent: number;
  /** Got a key. */
  keyed: number;
  /** Stayed without a key, by the server's note. */
  notes: Record<string, number>;
  units: number;
  /** The request that failed (the ones before it count); null — none. */
  error: unknown;
  /** Results dropped because the question changed while the AI answered (its file read again, a key set by hand). */
  stale?: number;
  /** «Вопросы и ключи»: agreed keys not written, by why («уже есть ключ», «не удалось сохранить»). */
  unwritten?: Record<string, number>;
}

/**
 * Sends the batches one after another; after each one `onBatch` gets the fixes to merge into ImportEdits.items (a key
 * from the AI, or the note of a question left without one) and the progress. A request the server asks to wait for
 * waits and goes again (sendWaiting); any other failure stops the run: what came back before it stays.
 */
export async function runKeysAi(
  candidates: readonly KeysAiCandidate[],
  onBatch: (fixes: Record<string, ItemFix>, progress: { done: number; total: number }) => void,
  call: (input: { subject: string | null; questions: KeysAiQuestion[] }) => Promise<KeysAiResponse> = keysAi,
  options: KeysAiRunOptions = {},
): Promise<KeysAiOutcome> {
  const outcome: KeysAiOutcome = { sent: 0, keyed: 0, notes: {}, units: 0, error: null, stale: 0 };
  const total = candidates.length;
  for (const batch of keysAiBatches(candidates)) {
    let response: KeysAiResponse;
    try {
      response = await sendWaiting(() => call({ subject: batch.subject, questions: batch.items.map((item) => item.question) }), options);
    } catch (error) {
      outcome.error = error;
      break;
    }
    const byId = new Map(batch.items.map((item) => [item.uid, item]));
    const fixes: Record<string, ItemFix> = {};
    for (const result of response.results) {
      const candidate = byId.get(result.id);
      if (!candidate) continue;
      if (options.isFresh && !options.isFresh(candidate)) {
        outcome.stale = (outcome.stale ?? 0) + 1;
        continue;
      }
      const indices = result.correct?.map((index) => candidate.optionMap[index]).filter((index) => typeof index === 'number') ?? [];
      if (result.correct && indices.length === result.correct.length && indices.length > 0) {
        fixes[candidate.uid] = { correct: indices, kind: candidate.question.kind, aiKey: true, aiOk: false, aiTried: undefined, aiNote: undefined };
        outcome.keyed += 1;
      } else {
        const note = result.note ?? (result.sure === 'none' ? KEYS_AI_WORDS.noAnswer : KEYS_AI_WORDS.unsure);
        fixes[candidate.uid] = { aiTried: result.sure === 'none' ? 'none' : 'low', aiNote: note };
        outcome.notes[note] = (outcome.notes[note] ?? 0) + 1;
      }
    }
    outcome.sent += batch.items.length;
    outcome.units += response.units;
    onBatch(fixes, { done: outcome.sent, total });
  }
  return outcome;
}

/** The words for a failed request: the server's own line for what it names (limit, busy, a bad request), ours otherwise. */
export function keysAiErrorLine(error: unknown): string {
  const code = typeof (error as { code?: unknown } | null)?.code === 'string' ? (error as { code: string }).code : '';
  const detail = typeof (error as { detail?: unknown } | null)?.detail === 'string' ? (error as { detail: string }).detail : '';
  const status = (error as { status?: unknown } | null)?.status;
  const message = error instanceof Error ? error.message.trim() : '';
  const russian = message && /[а-яё]/i.test(message) ? message : '';
  if (code === 'ai_limit') return KEYS_AI_WORDS.limit;
  if (code === 'ai_busy') return KEYS_AI_WORDS.busy;
  if (code === 'keys_running') return KEYS_AI_WORDS.elsewhere;
  if (error instanceof Error && error.name === 'AiKeyNotStored') return KEYS_AI_WORDS.notStored;
  // the answer did not come: the server may have done the work and kept the units, the page cannot know
  if (code === 'network' || status === 0) return KEYS_AI_WORDS.network;
  if (status === 429) return russian || KEYS_AI_WORDS.tooMany;
  if (status === 413 || code === 'too_big') return KEYS_AI_WORDS.tooBig;
  if (status === 422 || code === 'bad_request') return KEYS_AI_WORDS.badRequest;
  if (code === 'ai_failed' || detail === 'ai_failed' || (typeof status === 'number' && status >= 500)) return KEYS_AI_WORDS.failed;
  return KEYS_AI_WORDS.failed;
}
