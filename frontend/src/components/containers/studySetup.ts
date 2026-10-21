import type { ContainerSummary, DayPlan, LocalDay, PlanCls, PlanInput } from '../../types/container';
import { SESSION_SIZE } from '../../lib/containers/plan';
import { buildSession, freeSession, shuffled, type QueueEntry } from '../../lib/containers/session';
import { answeredToday, clsOf, firstSession, moreNew, subjectKind, type DaySession, type StudyRecord } from './model';
import { newId, resumable, sessionOf, type SavedOral, type SavedSession } from './sessionStore';

/**
 * Which questions a «занятие» takes (Concept 2 §3.10; spec decisions 12, 18, 51), all from the study engine
 * (lib/containers/session.ts, plan.ts):
 * - the plan's session of a subject (20 with variants, 10 oral self-checks): buildSession;
 * - a topic («Начать 20 вопросов по теме») and the current errors («Только ошибки: N», the exam day's «20 вопросов, где
 *   были ошибки»): freeSession, up to 20 in a seeded order;
 * - more new ones («Ещё 20 новых»): plan.ts extraNew, in a seeded order;
 * - a session left today (`?resume=1`): where it stopped;
 * - the session the address names (`?sid=`, written when it starts): the same one after a reload (sessionStore.ts
 *   sessionOf).
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
  /** A self-check picked up again: its ratings so far (null for a new one and for an answer session). */
  oral: SavedOral | null;
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

  const sid = params.get('sid');
  const again = params.get('resume') ? resumable(saved, today) : sid ? sessionOf(saved, sid, today) : null;
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
      oral: again.kind === 'self_check' ? again.oral ?? null : null,
    };
  }

  const subjectId = params.get('s') || firstSession(plan)?.subjectId || summary.subjects[0]?.id || '';
  const kind = kindOf(summary, subjectId, params.get('kind'));
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
    // «Только ошибки: N» counts every current error, today's too (model.ts errorCount, «ошибок сейчас»), and opens them
    // all (owner, 2026-10-20: «хочу ошибки посмотреть … пишет их нет»): going over a mistake of today is practice — the
    // server takes a right answer on the day its key was shown as training (rule_step, peek_day), so nothing counts
    // early. freeSession puts the older errors first: today's come last.
    const skip = only === 'errors' ? [] : done;
    try {
      queue = freeSession(input, { subjectId, topic: only ? undefined : topic, onlyErrors: only === 'errors' }, skip, id);
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
  return { id, subjectId, kind, topic, only, queue, pos: 0, records: [], startedAt: now, resumed: false, cls, oral: null };
}

/** A «занятие» of a subject: an oral subject has only self-checks here (its AI checks are a ticket of the oral exam). */
function kindOf(summary: ContainerSummary, subjectId: string, asked: string | null): 'answer' | 'self_check' {
  const oralOnly = summary.subjects.some((subject) => subject.id === subjectId && subjectKind(subject) === 'oral');
  return asked === 'self_check' || oralOnly ? 'self_check' : 'answer';
}

/**
 * How many questions the link of a plan session opens (model.ts sessionHref), so a pill names exactly that (usability
 * check 2026-10-11, D3: «Ещё 13 вопросов» opened 18): a «занятие» takes setupSession's queue — the subject's next
 * questions of its kind across the plan's sessions, up to a session's size, past what was answered today and past
 * `answered` (a session the plan does not count yet); an AI check, the ticket's questions.
 */
export function sessionOpens(p: { plan: DayPlan; input: PlanInput | null; summary: ContainerSummary; session: DaySession; answered?: Iterable<string> }): number {
  const { plan, input, summary, session } = p;
  if (session.kind === 'ai_check') return Math.min(SESSION_SIZE.ai_check, session.ids.length);
  const kind = kindOf(summary, session.subjectId, session.kind);
  const done = [...answeredToday(input, plan.day), ...(p.answered ?? [])];
  try {
    return buildSession(plan, session.subjectId, kind, done, 'opens').length;
  } catch {
    return session.ids.length;
  }
}
