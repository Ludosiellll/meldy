import type { AnswerInput, PlanInput, TestItem } from '../../types/container';
import { prng } from '../../lib/containers/session';
import { answered, answerFields, gradeAnswer, type KindAnswer } from '../../lib/kinds/answer';
import { gradeLocal, testItemsOf } from './model';

/**
 * «Как на экзамене» without React: which questions a try takes (Concept 2 §3.9 — from the seen ones while anything is
 * unseen, so a try never eats the plan's new questions; stratified by topic; seeded), how it is scored on the device
 * (an unanswered question is an error, decision 36), and the answers it sends (mode 'mock', unanswered as null).
 */
export type MockAnswer = number[] | string | null;
/** An answer of any kind (release 48: order and match keep a list in its order, cloze a text per gap). */
export type AnyAnswer = KindAnswer;
const OLD_KINDS = new Set(['single', 'multiple', 'short']);

function shuffle<T>(list: T[], random: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** The most questions one «Как на экзамене» holds: the database's own bound (test_mock_runs.items, container_mock_finish). */
export const MOCK_MAX = 200;

export function drawMock(input: PlanInput | null, bank: ReadonlyMap<string, TestItem>, subjectId: string, wanted: number, seed: string): string[] {
  const count = Math.min(MOCK_MAX, Math.max(0, Math.floor(wanted)));
  const candidates = testItemsOf(input, subjectId).filter((item) => bank.has(item.id));
  const seen = candidates.filter((item) => item.u && item.u.seen > 0);
  const unseen = candidates.filter((item) => !item.u || item.u.seen === 0);
  const random = prng(seed);
  const pool = seen.length >= count ? seen : [...seen, ...shuffle(unseen, random).slice(0, count - seen.length)];
  const byTopic = new Map<number, string[]>();
  for (const item of pool) {
    const topic = item.tp ?? 0;
    byTopic.set(topic, [...(byTopic.get(topic) ?? []), item.id]);
  }
  const groups = shuffle(
    Array.from(byTopic.values()).map((ids) => shuffle(ids, random)),
    random,
  );
  const picked: string[] = [];
  while (picked.length < count && groups.some((group) => group.length > 0)) {
    for (const group of groups) {
      const next = group.shift();
      if (next !== undefined && picked.length < count) picked.push(next);
    }
  }
  return shuffle(picked, random);
}

export function isAnswered(answer: AnyAnswer | undefined): boolean {
  if (answer === null || answer === undefined) return false;
  if (typeof answer === 'string') return answer.trim() !== '';
  if (answer.some((x) => typeof x === 'string') || answer.some((x) => typeof x === 'number' && x < 0)) return answered(answer);
  return answer.length > 0;
}

export function scoreMock(itemIds: string[], answers: Record<string, AnyAnswer>, bank: ReadonlyMap<string, TestItem>): { correct: number; unanswered: number; wrongIds: string[] } {
  let correct = 0;
  let unanswered = 0;
  const wrongIds: string[] = [];
  for (const id of itemIds) {
    const item = bank.get(id);
    const answer = answers[id];
    if (!isAnswered(answer)) {
      unanswered += 1;
      wrongIds.push(id);
      continue;
    }
    if (!item) continue;
    const ok = !OLD_KINDS.has(item.kind)
      ? gradeAnswer(item, answer).correct
      : gradeLocal(item, typeof answer === 'string' ? { chosen: null, text: answer } : { chosen: answer as number[], text: null });
    if (ok) correct += 1;
    else wrongIds.push(id);
  }
  return { correct, unanswered, wrongIds };
}

export function mockAnswers(p: {
  runId: string;
  itemIds: string[];
  answers: Record<string, AnyAnswer>;
  orders: Record<string, number[]>;
  bank: ReadonlyMap<string, TestItem>;
}): AnswerInput[] {
  const out: AnswerInput[] = [];
  p.itemIds.forEach((id, index) => {
    const item = p.bank.get(id);
    if (!item) return;
    const answer = p.answers[id];
    const base: AnswerInput = {
      client_event_id: `${p.runId}:${String(index + 1).padStart(2, '0')}`,
      item_id: id,
      rev: item.rev,
      mode: 'mock',
      cls: 'free',
    };
    if (item.kind === 'short') {
      out.push({ ...base, text: isAnswered(answer) && typeof answer === 'string' ? answer.trim() : null });
      return;
    }
    if (!OLD_KINDS.has(item.kind)) {
      // release 48: number / cloze typed; order and match in file indices, the order shown kept when there is one
      const shown = item.kind === 'order' || item.kind === 'match' ? p.orders[id] : undefined;
      out.push({ ...base, ...answerFields(item.kind, answer), ...(shown && shown.length > 0 ? { shown_order: shown } : {}) });
      return;
    }
    const chosen = isAnswered(answer) && Array.isArray(answer) ? [...(answer as number[])].sort((a, b) => a - b) : null;
    out.push({
      ...base,
      chosen: chosen === null ? null : item.kind === 'single' ? chosen[0] : chosen,
      shown_order: p.orders[id] ?? item.options.map((_, i) => i),
    });
  });
  return out;
}

/** «31:20» */
export function clock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
