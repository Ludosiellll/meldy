/**
 * Grading of one answer against an item's key (docs/kinds/CONTRACT.md §2.2): the TypeScript twin of
 * meldy_private.grade_item. Shared cases: contracts/kinds/grade_vectors.json. Indices are file indices.
 */
import type { ItemKind } from '../../types/container';
import { gapForms } from './cloze';
import { shortNorm } from './norm';
import { numberRight } from './number';

/** What grading reads of a row. */
export interface GradeItem {
  kind: ItemKind;
  options: readonly string[];
  correct: readonly number[];
  answers: readonly string[];
  tolerance?: number | string | null;
  unit?: string | null;
  partial?: boolean;
}

/** The answer element as a client sends it (record_test_answers; the quiz sends shown indices, mapped before this). */
export interface GradeAnswer {
  chosen?: number | number[] | null;
  text?: string | null;
  texts?: string[] | null;
  shown_order?: number[] | null;
}

export type GradeResult = 'right' | 'wrong' | 'dont_know' | 'pending';
export interface Grade {
  valid: boolean;
  correct: boolean;
  result: GradeResult | null;
  /** 0..1, rounded to 4 decimals: 1 for a right answer; a share of it with partial credit; 0 otherwise. */
  credit: number;
}

const INVALID: Grade = { valid: false, correct: false, result: null, credit: 0 };
const round4 = (x: number) => Math.round(x * 10000) / 10000;
const isIndex = (x: unknown, max: number, min = 0) => typeof x === 'number' && Number.isInteger(x) && x >= min && x < max && x <= 9;

function shownOrderOk(order: unknown, size: number): boolean {
  if (order === undefined || order === null) return true;
  if (!Array.isArray(order) || order.length !== size) return false;
  return new Set(order.filter((x) => isIndex(x, size))).size === size;
}

function verdict(correct: boolean, credit: number): Grade {
  return { valid: true, correct, result: correct ? 'right' : 'wrong', credit: correct ? 1 : round4(credit) };
}

const DONT_KNOW: Grade = { valid: true, correct: false, result: 'dont_know', credit: 0 };

/** The share of pairs of an arrangement in the right relative order. */
export function orderCredit(chosen: readonly number[]): number {
  const n = chosen.length;
  if (n < 2) return 1;
  let inversions = 0;
  for (let i = 0; i < n; i += 1) for (let j = i + 1; j < n; j += 1) if (chosen[i] > chosen[j]) inversions += 1;
  return 1 - inversions / ((n * (n - 1)) / 2);
}

function gradeOld(item: GradeItem, answer: GradeAnswer): Grade {
  if (item.kind === 'short') {
    if (answer.text === null) return answer.shown_order !== undefined && answer.shown_order !== null ? INVALID : DONT_KNOW;
    if (typeof answer.text !== 'string' || answer.text.length > 1000 || shortNorm(answer.text) === '') return INVALID;
    if (answer.shown_order !== undefined && answer.shown_order !== null) return INVALID;
    const norm = shortNorm(answer.text);
    return verdict(item.answers.some((form) => shortNorm(form) === norm), 0);
  }
  const n = item.options.length;
  let chosen: number[] | null;
  if (answer.chosen === null) chosen = [];
  else if (typeof answer.chosen === 'number') chosen = isIndex(answer.chosen, n) ? [answer.chosen] : null;
  else if (Array.isArray(answer.chosen) && answer.chosen.length <= n && answer.chosen.every((x) => isIndex(x, n))
           && new Set(answer.chosen).size === answer.chosen.length) chosen = [...answer.chosen].sort((a, b) => a - b);
  else chosen = null;
  if (chosen === null || (item.kind === 'single' && chosen.length > 1)) return INVALID;
  if (!shownOrderOk(answer.shown_order, n)) return INVALID;
  if (chosen.length === 0) return DONT_KNOW;
  const key = [...item.correct].sort((a, b) => a - b);
  const correct = key.length === chosen.length && key.every((k, i) => k === chosen![i]);
  let credit = 0;
  if (!correct && item.kind === 'multiple' && item.partial && key.length > 0) {
    const hits = chosen.filter((c) => key.includes(c)).length;
    credit = Math.max(0, (2 * hits - chosen.length) / key.length);
  }
  return verdict(correct, credit);
}

/** The server's verdict on one answer, on the device. */
export function gradeItem(item: GradeItem, answer: GradeAnswer): Grade {
  if (item.kind === 'single' || item.kind === 'multiple' || item.kind === 'short') return gradeOld(item, answer);
  const noOrder = answer.shown_order === undefined || answer.shown_order === null;
  if (item.kind === 'number' || item.kind === 'essay') {
    if (answer.text === null) return noOrder ? DONT_KNOW : INVALID;
    const max = item.kind === 'essay' ? 6000 : 1000;
    if (typeof answer.text !== 'string' || answer.text.length > max || shortNorm(answer.text) === '' || !noOrder) return INVALID;
    if (item.kind === 'essay') return { valid: true, correct: false, result: 'pending', credit: 0 };
    return verdict(numberRight(answer.text, item.answers, item.tolerance ?? null, item.unit ?? null), 0);
  }
  if (item.kind === 'cloze') {
    const forms = gapForms(item.answers);
    // a cloze of one gap also takes «text» (the bot's typed answer)
    const texts = answer.texts === undefined && forms.length === 1 && answer.text !== undefined
      ? (answer.text === null ? null : [answer.text]) : answer.texts;
    if (texts === null) return noOrder ? DONT_KNOW : INVALID;
    if (!Array.isArray(texts) || texts.length !== forms.length || !texts.every((t) => typeof t === 'string' && t.length <= 200)
        || !noOrder) return INVALID;
    if (texts.every((t) => shortNorm(t) === '')) return DONT_KNOW;
    const right = texts.filter((t, k) => shortNorm(t) !== '' && item.answers[k].split('\n').some((f) => shortNorm(f) === shortNorm(t))).length;
    return verdict(right === forms.length, item.partial ? right / forms.length : 0);
  }
  // order and match
  const n = item.options.length;
  const m = item.kind === 'order' ? n : item.answers.length;
  const chosen = answer.chosen;
  if (chosen === null || (Array.isArray(chosen) && chosen.length === 0)) return shownOrderOk(answer.shown_order, m) ? DONT_KNOW : INVALID;
  if (!Array.isArray(chosen) || chosen.length !== n || !chosen.every((x) => isIndex(x, m, item.kind === 'match' ? -1 : 0))) return INVALID;
  if (item.kind === 'order' && new Set(chosen).size !== n) return INVALID;
  if (!shownOrderOk(answer.shown_order, m)) return INVALID;
  if (item.kind === 'order') {
    const correct = chosen.every((c, i) => c === i);
    return verdict(correct, item.partial ? orderCredit(chosen) : 0);
  }
  if (chosen.every((c) => c < 0)) return DONT_KNOW;
  const right = chosen.filter((c, i) => c === i).length;
  return verdict(right === n, item.partial ? right / n : 0);
}
