/**
 * «Подобрать ключи с ИИ» on the import page (owner, 2026-11-04: «делай подбор ключей с ии»; contract
 * docs/import/KEYS_AI.md). Only on the student's press. The questions sent are those the file gave no key and that the
 * model can read: single or multiple choice, without pictures, within the server's limits; one request per subject (its
 * title goes along) and per 300 questions. A key comes back only when two independent answers agreed and were sure; it
 * becomes the student's own key with aiKey (saved with key_source 'manual' and the flag ai_key) and waits in «Проверьте
 * ключи от ИИ». A question without a key stays without one, with the server's note («ИИ не уверен»).
 *
 * Pure but for the call it is given (api/containers.ts keysAi), so the tests give a fake server.
 */
import { keysAi, type KeysAiQuestion, type KeysAiResponse } from '../../../api/containers';
import { keysAiCost } from '../../../lib/plans';
import { KEYS_AI_WORDS } from '../copyImport';
import { activeSubjects, type DraftSubject, type ImportEdits, type ItemFix } from './importModel';

/** The server's limits (backend/bank_keys_ai.py): longer questions are left out, they stay without a key. */
export const KEYS_AI_MAX_QUESTIONS = 300;
const MAX_TEXT = 2000;
const MAX_OPTIONS = 10;
const MIN_OPTIONS = 2;
const MAX_OPTION = 500;

export interface KeysAiCandidate {
  uid: string;
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
        subjectKey: subject.key,
        subjectTitle: subject.title,
        question: { id: item.uid, text, options, kind: item.kind },
        optionMap: [...item.optionMap],
      });
    }
  }
  return out;
}

export interface KeysAiBatch {
  subject: string;
  items: KeysAiCandidate[];
}

/** One request per subject and per 300 questions: the subject's title goes along as context. */
export function keysAiBatches(candidates: readonly KeysAiCandidate[]): KeysAiBatch[] {
  const bySubject = new Map<string, KeysAiCandidate[]>();
  for (const candidate of candidates) bySubject.set(candidate.subjectKey, [...(bySubject.get(candidate.subjectKey) ?? []), candidate]);
  const out: KeysAiBatch[] = [];
  bySubject.forEach((items) => {
    for (let at = 0; at < items.length; at += KEYS_AI_MAX_QUESTIONS) out.push({ subject: items[0].subjectTitle, items: items.slice(at, at + KEYS_AI_MAX_QUESTIONS) });
  });
  return out;
}

/** What the press costs: each request is charged on its own (5 units per started 100 of its questions). */
export function keysAiPrice(candidates: readonly KeysAiCandidate[]): number {
  return keysAiBatches(candidates).reduce((sum, batch) => sum + keysAiCost(batch.items.length), 0);
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
}

/**
 * Sends the batches one after another; after each one `onBatch` gets the fixes to merge into ImportEdits.items (a key
 * from the AI, or the note of a question left without one) and the progress. A failed request stops the run: what came
 * back before it stays.
 */
export async function runKeysAi(
  candidates: readonly KeysAiCandidate[],
  onBatch: (fixes: Record<string, ItemFix>, progress: { done: number; total: number }) => void,
  call: (input: { subject: string | null; questions: KeysAiQuestion[] }) => Promise<KeysAiResponse> = keysAi,
): Promise<KeysAiOutcome> {
  const outcome: KeysAiOutcome = { sent: 0, keyed: 0, notes: {}, units: 0, error: null };
  const total = candidates.length;
  for (const batch of keysAiBatches(candidates)) {
    let response: KeysAiResponse;
    try {
      response = await call({ subject: batch.subject, questions: batch.items.map((item) => item.question) });
    } catch (error) {
      outcome.error = error;
      break;
    }
    const byId = new Map(batch.items.map((item) => [item.uid, item]));
    const fixes: Record<string, ItemFix> = {};
    for (const result of response.results) {
      const candidate = byId.get(result.id);
      if (!candidate) continue;
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
  if (code === 'network' || status === 0) return KEYS_AI_WORDS.network;
  if (status === 429) return russian || KEYS_AI_WORDS.tooMany;
  if (status === 413 || code === 'too_big') return KEYS_AI_WORDS.tooBig;
  if (status === 422 || code === 'bad_request') return KEYS_AI_WORDS.badRequest;
  if (code === 'ai_failed' || detail === 'ai_failed' || (typeof status === 'number' && status >= 500)) return KEYS_AI_WORDS.failed;
  return KEYS_AI_WORDS.failed;
}
