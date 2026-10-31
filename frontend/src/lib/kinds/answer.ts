/**
 * An answer on the screen and on the wire, for every kind (docs/kinds/CONTRACT.md §2.1, §3.2). The screens keep one
 * value per question: a list of indices (single / multiple: the picked file indices; order: the arrangement top to
 * bottom; match: per left item the right item's index or -1), a string (short, number, essay) or a list of strings
 * (cloze: one per gap). A quiz keeps order and match in the attempt's shown indices; a session in file indices.
 */
import type { AnswerInput, ItemKind } from '../../types/container';
import type { QuizAnswerInput } from '../../types/quiz';
import { gradeItem, type Grade, type GradeItem } from './grade';

export type KindAnswer = number[] | string | string[] | null;

/** The kinds a list of indices stands for in order: the list as it is, never sorted. */
const ORDERED: readonly ItemKind[] = ['order', 'match'];
export const isListKind = (kind: ItemKind) => kind === 'single' || kind === 'multiple' || kind === 'order' || kind === 'match';
export const isTextKind = (kind: ItemKind) => kind === 'short' || kind === 'number' || kind === 'essay';

const isStrings = (value: unknown[]): value is string[] => value.length > 0 && value.every((x) => typeof x === 'string');

/** Whether the question has an answer: a non-blank text, a gap filled, an index chosen (-1 is a match left empty). */
export function answered(answer: KindAnswer | undefined): boolean {
  if (answer === null || answer === undefined) return false;
  if (typeof answer === 'string') return answer.trim() !== '';
  if (answer.length === 0) return false;
  if (isStrings(answer)) return answer.some((text) => text.trim() !== '');
  return (answer as number[]).some((n) => n >= 0);
}

/** A value read back from storage or the server is one of the shapes above. */
export function isKindAnswer(value: unknown): value is KindAnswer {
  if (value === null || typeof value === 'string') return true;
  if (!Array.isArray(value)) return false;
  return value.every((x) => typeof x === 'string') || value.every((n) => Number.isInteger(n) && n >= -1);
}

/** The answer element of record_test_answers / container_mock_finish (file indices); unanswered → the kind's null. */
export function answerFields(kind: ItemKind, answer: KindAnswer | undefined): Pick<AnswerInput, 'chosen' | 'text' | 'texts'> {
  const has = answered(answer);
  if (isTextKind(kind)) return { text: has && typeof answer === 'string' ? answer.trim() : null };
  if (kind === 'cloze') return { texts: has && Array.isArray(answer) ? (answer as string[]).map((t) => String(t).trim()) : null };
  if (!has || !Array.isArray(answer)) return { chosen: null };
  const list = answer as number[];
  if (ORDERED.includes(kind)) return { chosen: [...list] };
  const set = [...list].sort((a, b) => a - b);
  return { chosen: kind === 'single' ? set[0] : set };
}

/** One answer as quiz_answer takes it (order and match in shown indices, as the page keeps them); empty → taken back. */
export function quizInput(itemId: string, kind: ItemKind, answer: KindAnswer): QuizAnswerInput {
  if (isTextKind(kind)) return { item_id: itemId, text: typeof answer === 'string' ? answer.trim() : '' };
  if (kind === 'cloze') return { item_id: itemId, texts: Array.isArray(answer) && answered(answer) ? (answer as string[]).map((t) => String(t)) : null };
  const list = Array.isArray(answer) ? (answer as number[]) : [];
  if (ORDERED.includes(kind)) return { item_id: itemId, chosen: answered(list) ? [...list] : [] };
  return { item_id: itemId, chosen: [...list].sort((a, b) => a - b) };
}

/** A saved answer the server gives back (the attempt; order and match in shown indices). */
export function fromSaved(kind: ItemKind | undefined, saved: { chosen: number[] | null; text: string | null; texts?: string[] | null }): KindAnswer {
  if (kind === 'cloze' && Array.isArray(saved.texts)) return [...saved.texts];
  if (Array.isArray(saved.chosen) && saved.chosen.length > 0) return [...saved.chosen];
  if (typeof saved.text === 'string' && saved.text !== '') return saved.text;
  return null;
}

/** The device's verdict on an answer (the server's wins when it arrives): the grade_item twin. */
export function gradeAnswer(item: GradeItem, answer: KindAnswer | undefined): Grade {
  if (!answered(answer)) return { valid: true, correct: false, result: 'dont_know', credit: 0 };
  return gradeItem(item, answerFields(item.kind, answer));
}
