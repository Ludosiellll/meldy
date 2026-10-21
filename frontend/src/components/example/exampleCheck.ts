/**
 * The words of step 3 of the example (/try, «Вот что проверил Meldy»): what became of each point of the answer and of
 * the examiner's question, said as results in short plain sentences (the owner's plain-words rule, 21.10) for someone
 * who has never seen the app. The statuses are the check's own (the AI's, or the key words when the AI is not there:
 * tryCheck.ts); nothing here judges anything. Pure.
 */
import type { PointStatus } from '../../lib/oral/oralGrade';
import { namedAfterQuestion, type ProtocolFollowup } from '../oral/OralProtocol';
import { plural } from '../../lib/oral/format';

/** A point's fate, the reply to the examiner's question included. */
export type RowStatus = 'named' | 'after' | 'partial' | 'wrong' | 'missing' | 'unrated';

export const ROW_WORDS: Record<RowStatus, string> = {
  named: 'Есть в ответе',
  after: 'Прозвучал после вопроса экзаменатора',
  partial: 'Раскрыт не полностью',
  wrong: 'Есть ошибка',
  missing: 'Не прозвучал',
  unrated: 'Не проверен',
};

type Followup = Pick<ProtocolFollowup, 'pointId' | 'status'> | null;

/** What became of a point: its status in the answer, unless the reply to the examiner named it. */
export function rowStatus(point: { id: string; status: PointStatus }, followup: Followup): RowStatus {
  if (followup && followup.pointId === point.id && namedAfterQuestion(point.status, followup)) return 'after';
  switch (point.status) {
    case 'covered':
      return 'named';
    case 'partial':
      return 'partial';
    case 'wrong':
      return 'wrong';
    case 'missing':
      return 'missing';
    default:
      return 'unrated';
  }
}

/** «4 пункта», «1 пункт»: the number first, with its noun. */
function points(n: number): string {
  return `${n} ${plural(n, 'пункт', 'пункта', 'пунктов')}`;
}

/** «прозвучал» / «прозвучали» after a count. */
function agree(n: number, one: string, many: string): string {
  return n % 10 === 1 && n % 100 !== 11 ? one : many;
}

/**
 * The result: «Ответ полный» or «В ответе 4 пункта из 5», then what happened to the rest, one short sentence each —
 * «Ещё 1 пункт прозвучал после вопроса экзаменатора.», «1 пункт не прозвучал.» — or null when there is nothing more.
 */
export function checkHeadline(rows: ReadonlyArray<{ id: string; status: PointStatus }>, followup: Followup): { title: string; rest: string | null } {
  const counts: Record<RowStatus, number> = { named: 0, after: 0, partial: 0, wrong: 0, missing: 0, unrated: 0 };
  for (const row of rows) counts[rowStatus(row, followup)] += 1;
  const total = rows.length;
  if (total > 0 && counts.named === total) return { title: 'Ответ полный', rest: `В нём все ${points(total)} из лекций.` };
  const title = counts.named === 0 ? 'В ответе нет пунктов из лекций' : `В ответе ${points(counts.named)} из ${total}`;
  const rest: string[] = [];
  if (counts.after > 0) rest.push(`Ещё ${points(counts.after)} ${agree(counts.after, 'прозвучал', 'прозвучали')} после вопроса экзаменатора.`);
  if (counts.partial > 0) rest.push(`${points(counts.partial)} ${agree(counts.partial, 'раскрыт', 'раскрыты')} не полностью.`);
  if (counts.wrong > 0) rest.push(`${points(counts.wrong)} с ошибкой.`);
  if (counts.missing > 0) rest.push(`${points(counts.missing)} не ${agree(counts.missing, 'прозвучал', 'прозвучали')}.`);
  if (counts.unrated > 0) rest.push(`${points(counts.unrated)} не ${agree(counts.unrated, 'проверен', 'проверены')}.`);
  return { title, rest: rest.length > 0 ? rest.join(' ') : null };
}

const REPLY_OUTCOME: Record<ProtocolFollowup['status'], string> = {
  covered: 'Ответ верный.',
  partial: 'Ответ неполный.',
  missing: 'Пункт так и не прозвучал.',
  wrong: 'Ответ неверный.',
};

/** What the reply to the examiner's question did, in short sentences. `status` is the asked point's status in the answer. */
export function replyOutcome(followup: ProtocolFollowup, status: PointStatus): string {
  if (followup.answer === 'не знаю') return 'Вы ответили «не знаю». Пункт не прозвучал.';
  if (!followup.answer.trim()) return 'Ответа не было. Пункт не прозвучал.';
  if (followup.judgedBy === 'keywords') {
    const said = { covered: 'Пункт прозвучал.', partial: 'Пункт упомянут.', missing: 'Пункт не прозвучал.', wrong: 'В ответе ошибка.' }[followup.status];
    return `Ответ проверен по ключевым словам. ${said}`;
  }
  if (namedAfterQuestion(status, followup)) return 'Ответ верный. Пункт прозвучал.';
  return REPLY_OUTCOME[followup.status];
}
