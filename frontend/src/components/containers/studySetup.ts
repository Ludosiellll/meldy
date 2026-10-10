import type { ContainerSummary, DayPlan, LocalDay, PlanCls, PlanInput } from '../../types/container';
import { buildSession, freeSession, shuffled, type QueueEntry } from '../../lib/containers/session';
import { answeredToday, clsOf, firstSession, moreNew, type StudyRecord } from './model';
import { newId, resumable, type SavedSession } from './sessionStore';

/**
 * Which questions a «занятие» takes (Concept 2 §3.10; spec decisions 12, 18, 51), all from the study engine
 * (lib/containers/session.ts, plan.ts):
 * - the plan's session of a subject (20 with variants, 10 oral self-checks): buildSession;
 * - a topic («Начать 20 вопросов по теме») and the current errors («Только ошибки: N», the exam day's «20 вопросов, где
 *   были ошибки»): freeSession, up to 20 in a seeded order;
 * - more new ones («Ещё 20 новых»): plan.ts extraNew, in a seeded order;
 * - a session left today (`?resume=1`): where it stopped.
 */
export interface SessionSetup {
  id: string;
  subjectId: string;
  kind: 'answer' | 'self_check';
  topic: number | null;
  only: 'errors' | 'new' | null;
  queue: QueueEntry[];
  pos: number;
  records: StudyRecord[];
  startedAt: number;
  resumed: boolean;
  /** The plan class of each planned question, for the answer's `cls`. */
  cls: Record<string, PlanCls>;
}

export function setupSession(p: {
  params: URLSearchParams;
  saved: SavedSession | null;
  plan: DayPlan | null;
  input: PlanInput | null;
  summary: ContainerSummary;
  today: LocalDay;
  now: number;
}): SessionSetup {
  const { params, saved, plan, input, summary, today, now } = p;
  const items = new Map((input?.items ?? []).map((item) => [item.id, item]));
  const inWindow = Boolean(plan?.window.inWindow);
  const classOf = (ids: string[], fixed: PlanCls | null): Record<string, PlanCls> =>
    Object.fromEntries(ids.map((id) => [id, fixed ?? clsOf(items.get(id)?.u, inWindow)]));

  const again = params.get('resume') ? resumable(saved, today) : null;
  if (again) {
    const ids = Array.from(new Set(again.queue.map((entry) => entry.id)));
    return {
      id: again.id,
      subjectId: again.subjectId,
      kind: again.kind,
      topic: again.topic,
      only: again.only,
      queue: again.queue,
      pos: again.pos,
      records: again.records,
      startedAt: again.startedAt,
      resumed: true,
      cls: classOf(ids, again.only === 'new' ? 'new_fill' : again.only || again.topic ? 'free' : null),
    };
  }

  const kind = params.get('kind') === 'self_check' ? 'self_check' : 'answer';
  const subjectId = params.get('s') || firstSession(plan)?.subjectId || summary.subjects[0]?.id || '';
  const topicRaw = Number(params.get('topic'));
  const topic = Number.isInteger(topicRaw) && topicRaw > 0 ? topicRaw : null;
  const onlyRaw = params.get('only');
  const only = onlyRaw === 'errors' || onlyRaw === 'new' ? onlyRaw : null;
  const id = newId();
  const done = Array.from(answeredToday(input, today));

  let queue: QueueEntry[] = [];
  let cls: Record<string, PlanCls> = {};
  if (kind === 'answer' && only === 'new') {
    const more = moreNew(input, plan);
    const ids = more && more.subjectId === subjectId ? more.ids : [];
    try {
      queue = shuffled(ids, id).map((entry) => ({ id: entry, retry: 0 as const }));
    } catch {
      queue = ids.map((entry) => ({ id: entry, retry: 0 as const }));
    }
    cls = classOf(ids, 'new_fill');
  } else if (kind === 'answer' && (only || topic) && input) {
    try {
      queue = freeSession(input, { subjectId, topic: only ? undefined : topic, onlyErrors: only === 'errors' }, done, id);
    } catch {
      queue = [];
    }
    cls = classOf(
      queue.map((entry) => entry.id),
      'free',
    );
  } else if (plan) {
    try {
      queue = buildSession(plan, subjectId, kind, done, id);
    } catch {
      queue = [];
    }
    cls = classOf(
      queue.map((entry) => entry.id),
      null,
    );
  }
  return { id, subjectId, kind, topic, only, queue, pos: 0, records: [], startedAt: now, resumed: false, cls };
}
