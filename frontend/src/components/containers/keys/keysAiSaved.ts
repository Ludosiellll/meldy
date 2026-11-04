/**
 * «Подобрать ключи с ИИ» in «Вопросы и ключи» (owner, 2026-11-04; docs/import/KEYS_AI.md): the saved questions of the
 * exam that have no key. The same rules as at the import (import/keysAi.ts): only on the press; single or multiple
 * choice without pictures, within the server's limits; one request per subject (its title along), split as the server
 * can answer well in time (100 questions, 4 model batches a request), one after another, waiting when the server asks to; a key only when two
 * answers agreed and were sure. Each key is written as the author's key with the AI's mark:
 * container_item_update(id, { correct, ai_key: true }) (migration 20261107090300_ai_key_flag); a later change of the key
 * takes the mark off. A question the author keyed meanwhile is refused by the database (22023 'keyed') and counted as
 * «уже есть ключ»; any other failed write is counted too and the run goes on: the answers are paid for.
 */
import { keysAi, type KeysAiQuestion, type KeysAiResponse } from '../../../api/containers';
import type { TestItem } from '../../../types/container';
import { KEYS_AI_WORDS } from '../copyImport';
import { keysAiRequestCost, keysAiRequests, sendWaiting, type KeysAiOutcome, type KeysAiRunOptions } from '../import/keysAi';

const MAX_TEXT = 2000;
const MAX_OPTION = 500;

export interface SavedKeysAiCandidate {
  item: TestItem;
  subjectTitle: string;
  question: KeysAiQuestion;
}

const pictured = (item: TestItem) => Boolean(item.images?.stem?.length || item.images?.options?.some((list) => list.length > 0));

/** The saved questions the button sends: choice without a key, without pictures, within the limits; in `order`. */
export function savedKeysAiCandidates(items: readonly TestItem[], subjectTitle: ReadonlyMap<string, string>): SavedKeysAiCandidate[] {
  const out: SavedKeysAiCandidate[] = [];
  for (const item of items) {
    if (item.kind !== 'single' && item.kind !== 'multiple') continue;
    if (item.correct.length > 0 || pictured(item) || item.flags.includes('has_image')) continue;
    const text = item.stem.trim();
    const options = item.options.map((option) => String(option).trim());
    if (!text || text.length > MAX_TEXT || options.length < 2 || options.length > 10 || options.some((option) => !option || option.length > MAX_OPTION)) {
      continue;
    }
    out.push({ item, subjectTitle: subjectTitle.get(item.subject_id) ?? '', question: { id: item.id, text, options, kind: item.kind } });
  }
  return out;
}

function batches(candidates: readonly SavedKeysAiCandidate[]): SavedKeysAiCandidate[][] {
  const bySubject = new Map<string, SavedKeysAiCandidate[]>();
  for (const candidate of candidates) bySubject.set(candidate.item.subject_id, [...(bySubject.get(candidate.item.subject_id) ?? []), candidate]);
  const out: SavedKeysAiCandidate[][] = [];
  bySubject.forEach((list) => out.push(...keysAiRequests(list, (candidate) => candidate.question)));
  return out;
}

/** What the press costs: each request on its own (import/keysAi.ts keysAiRequestCost). */
export function savedKeysAiPrice(candidates: readonly SavedKeysAiCandidate[]): number {
  return batches(candidates).reduce((sum, batch) => sum + keysAiRequestCost(batch.map((candidate) => candidate.question)), 0);
}

/** The database refused the AI's key because the question has one now (the author set it meanwhile). */
const keyedMeanwhile = (error: unknown) =>
  (error as { code?: unknown } | null)?.code === '22023' && (error as { detail?: unknown } | null)?.detail === 'keyed';

/** A database without migration 20261107090300 stores the key without the mark: the run stops, nothing more is written. */
export class AiKeyNotStored extends Error {
  constructor() {
    super('ai_key not stored');
    this.name = 'AiKeyNotStored';
  }
}

/**
 * Sends the requests one after another and writes each agreed key with `write` (the page's update of the question,
 * which keeps the row on the page in step; it returns the mark as stored). A question keyed meanwhile counts as «уже
 * есть ключ», another failed write as «не удалось сохранить»; the run goes on. A failed request stops the run, and so
 * does a write the database stored without the mark (AiKeyNotStored); what was written stays.
 */
export async function runSavedKeysAi(
  candidates: readonly SavedKeysAiCandidate[],
  write: (item: TestItem, correct: number[]) => Promise<{ ai_key?: boolean }>,
  onProgress: (done: number, total: number) => void,
  call: (input: { subject: string | null; questions: KeysAiQuestion[] }) => Promise<KeysAiResponse> = keysAi,
  options: Pick<KeysAiRunOptions, 'onWait' | 'sleep'> = {},
): Promise<KeysAiOutcome> {
  const outcome: KeysAiOutcome = { sent: 0, keyed: 0, notes: {}, units: 0, error: null, unwritten: {} };
  const note = (text: string) => {
    outcome.notes[text] = (outcome.notes[text] ?? 0) + 1;
  };
  const unwritten = (text: string) => {
    outcome.unwritten![text] = (outcome.unwritten![text] ?? 0) + 1;
  };
  try {
    for (const batch of batches(candidates)) {
      const response = await sendWaiting(
        () => call({ subject: batch[0].subjectTitle || null, questions: batch.map((candidate) => candidate.question) }),
        options,
      );
      outcome.units += response.units;
      const byId = new Map(batch.map((candidate) => [candidate.item.id, candidate]));
      for (const result of response.results) {
        const candidate = byId.get(result.id);
        if (!candidate) continue;
        if (result.correct && result.correct.length > 0 && result.correct.every((index) => index < candidate.item.options.length)) {
          let stored: { ai_key?: boolean };
          try {
            stored = await write(candidate.item, result.correct);
          } catch (error) {
            unwritten(keyedMeanwhile(error) ? KEYS_AI_WORDS.keyedMeanwhile : KEYS_AI_WORDS.notWritten);
            continue;
          }
          if (stored.ai_key !== true) throw new AiKeyNotStored();
          outcome.keyed += 1;
        } else {
          note(result.note ?? (result.sure === 'none' ? KEYS_AI_WORDS.noAnswer : KEYS_AI_WORDS.unsure));
        }
      }
      outcome.sent += batch.length;
      onProgress(outcome.sent, candidates.length);
    }
  } catch (error) {
    outcome.error = error;
  }
  return outcome;
}
