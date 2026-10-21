/**
 * The facts `learn_left` gives per oral question, computed the site's way: the line rule of lib/exams/cheatSheet.ts
 * (buildSheet → lineStatus) over the deciding lines of lib/containers/oralParts.ts (the essential points, or every
 * point when none is essential). meldy_private.learn_left_facts in SQL computes the same; contracts/learn_left/vectors.json
 * holds shared cases both sides are checked against (learnFacts.vectors.test.ts here, supabase/tests/local/learn_left_run.sh
 * there).
 *
 * - state 3: every deciding line erased or due (a due check stays learned, as in the figure); 2: every deciding line at
 *   least rubbed (named, waiting for another day); 1: some; 0: none;
 * - named / of: deciding lines rubbed, erased or due / deciding lines;
 * - missed: a deciding line whose last checked answer missed it (missed, returned);
 * - learned_at: the latest erasing naming of the deciding lines (epoch seconds, down); ready_at (state 2 only): the
 *   latest `erasableFrom` of its rubbed deciding lines (epoch seconds, up): an answer from then on makes it learned.
 * Moments in the browser's zone, as the sheet reads them (the vectors are made and checked in UTC).
 */
import { blockKind, type SheetBlock, type SheetQuestion } from './cheatSheet.ts';
import type { OralKind } from '../containers/topics.ts';

export interface QuestionFacts {
  id: string;
  kind: OralKind;
  state: 0 | 1 | 2 | 3;
  named: number;
  of: number;
  learnedAt: number | null;
  readyAt: number | null;
  missed: boolean;
}

function moment(iso: string | null): number | null {
  const at = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(at) ? at : null;
}

/** The kind `learn_left` names: the sheet's block kind, with a question in no lecture told apart from other gaps. */
export function factsKind(question: SheetQuestion): OralKind {
  return question.coverage === 'none' ? 'none' : blockKind(question);
}

export function questionFacts(question: SheetQuestion, block: SheetBlock | undefined): QuestionFacts {
  const kind = factsKind(question);
  const base: QuestionFacts = { id: question.question_id, kind, state: 0, named: 0, of: 0, learnedAt: null, readyAt: null, missed: false };
  if (!block || kind !== 'lines') return base;
  const deciding = block.lines.some((line) => line.essential) ? block.lines.filter((line) => line.essential) : block.lines;
  const learned = (state: string) => state === 'erased' || state === 'due';
  const named = deciding.filter((line) => line.status.state === 'rubbed' || learned(line.status.state)).length;
  const of = deciding.length;
  const all = of > 0 && deciding.every((line) => learned(line.status.state));
  const state: QuestionFacts['state'] = all ? 3 : of > 0 && named === of ? 2 : named > 0 ? 1 : 0;
  let learnedAt: number | null = null;
  if (all) {
    for (const line of deciding) {
      const at = moment(line.status.erasedAt);
      if (at !== null && (learnedAt === null || at > learnedAt)) learnedAt = at;
    }
  }
  let readyAt: number | null = null;
  if (state === 2) {
    for (const line of deciding) {
      if (line.status.state !== 'rubbed') continue;
      const at = moment(line.status.erasableFrom);
      if (at !== null && (readyAt === null || at > readyAt)) readyAt = at;
    }
  }
  return {
    ...base,
    state,
    named,
    of,
    learnedAt: learnedAt === null ? null : Math.floor(learnedAt / 1000),
    readyAt: readyAt === null ? null : Math.ceil(readyAt / 1000),
    missed: deciding.some((line) => line.status.state === 'missed' || line.status.state === 'returned'),
  };
}
