/**
 * «Подобрать ключи с ИИ» in «Вопросы и ключи» (owner, 2026-11-04; docs/import/KEYS_AI.md): the saved questions of the
 * exam that have no key. The same rules as at the import (import/keysAi.ts): only on the press; single or multiple
 * choice without pictures, within the server's limits; one request per subject (its title along) and per 300 questions;
 * a key only when two answers agreed and were sure. Each key is written as the author's key with the AI's mark:
 * container_item_update(id, { correct, ai_key: true }) (migration 20261107090300_ai_key_flag); a later change of the key
 * takes the mark off.
 */
import { keysAi, type KeysAiQuestion, type KeysAiResponse } from '../../../api/containers';
import { keysAiCost } from '../../../lib/plans';
import type { TestItem } from '../../../types/container';
import { KEYS_AI_WORDS } from '../copyImport';
import { KEYS_AI_MAX_QUESTIONS, type KeysAiOutcome } from '../import/keysAi';

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
  bySubject.forEach((list) => {
    for (let at = 0; at < list.length; at += KEYS_AI_MAX_QUESTIONS) out.push(list.slice(at, at + KEYS_AI_MAX_QUESTIONS));
  });
  return out;
}

/** What the press costs: each request on its own, 5 units per started 100 of its questions. */
export function savedKeysAiPrice(candidates: readonly SavedKeysAiCandidate[]): number {
  return batches(candidates).reduce((sum, batch) => sum + keysAiCost(batch.length), 0);
}

/**
 * Sends the requests one after another and writes each agreed key with `write` (the page's update of the question,
 * which keeps the row on the page in step); a failed request or write stops the run, what was written stays.
 */
export async function runSavedKeysAi(
  candidates: readonly SavedKeysAiCandidate[],
  write: (item: TestItem, correct: number[]) => Promise<void>,
  onProgress: (done: number, total: number) => void,
  call: (input: { subject: string | null; questions: KeysAiQuestion[] }) => Promise<KeysAiResponse> = keysAi,
): Promise<KeysAiOutcome> {
  const outcome: KeysAiOutcome = { sent: 0, keyed: 0, notes: {}, units: 0, error: null };
  try {
    for (const batch of batches(candidates)) {
      const response = await call({ subject: batch[0].subjectTitle || null, questions: batch.map((candidate) => candidate.question) });
      outcome.units += response.units;
      const byId = new Map(batch.map((candidate) => [candidate.item.id, candidate]));
      for (const result of response.results) {
        const candidate = byId.get(result.id);
        if (!candidate) continue;
        if (result.correct && result.correct.length > 0 && result.correct.every((index) => index < candidate.item.options.length)) {
          await write(candidate.item, result.correct);
          outcome.keyed += 1;
        } else {
          const note = result.note ?? (result.sure === 'none' ? KEYS_AI_WORDS.noAnswer : KEYS_AI_WORDS.unsure);
          outcome.notes[note] = (outcome.notes[note] ?? 0) + 1;
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
