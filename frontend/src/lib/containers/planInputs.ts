/**
 * Wire → plan input (package D1): decodes `plan_inputs` (tuples, day offsets, epoch seconds) into the plan's
 * `PlanInput` for one container (epoch ms, local days), merges answers still in the offline queue as answered today,
 * and adds the oral questions (from `oralPlan.ts`). Pure: the moment, the zone, the queue and the oral items come in
 * through `options`; no clock, no storage, no network. Day arithmetic and the pace blend are package D2's
 * (lib/containers/time.ts, lib/containers/pace.ts): one implementation of each.
 *
 * - Day fields are offsets from the wire's `day`; moments are epoch seconds (the server rounds state moments up, so a
 *   moment never comes early): `addDays(day, offset)` and `seconds × 1000`.
 * - Per container: the budget (`minutes_per_day`), the first plan day, today's first answer and seconds done, and the
 *   new questions already taken today per subject.
 * - A wire of an earlier day (read before midnight, or kept on the device) still gives every item's state; its
 *   «today» (first answer, seconds, new questions) belonged to that day, so it starts from zero.
 * - Answers in the offline queue count as answered today (spec decision 10): the item is not offered again today
 *   (its last day is today), a question seen for the first time takes one of the day's new questions, and the
 *   seconds of a learning answer count as done. Nothing else of the state moves: the rule runs only in SQL.
 */
import type { AnswerInput, Pace, PlanInput, PlanInputsWire, PlanItem, PlanStateRow, UnitState, Uuid } from '../../types/container';
import { paceFrom } from './pace';
import { addDays, localDay } from './time';

export interface DecodeOptions {
  containerId: Uuid;
  tz: string;
  now: number; // epoch ms on the device
  pending: AnswerInput[]; // the offline queue's answers for this account
  oral: PlanItem[]; // oral questions of the container's oral parts
}

/** The seconds of one answer the server counts for today's work (test_answers.ms, capped at 180 s like plan_inputs). */
const ANSWER_MS_CAP = 180_000;

function moment(seconds: number | null | undefined): number | null {
  return typeof seconds === 'number' && Number.isFinite(seconds) ? seconds * 1000 : null;
}

/** One `PlanStateRow` as a `UnitState`: day offsets from `day` become local days, epoch seconds become ms. */
export function unitFromRow(row: PlanStateRow, day: string): UnitState {
  const [, seen, wrong, firstSeen, lastAnswer, , streakDay, streakAt, twoDaysAt, namedAt, checks, peekDay, wasTwoDays, cleanOkAt] = row;
  const dayAt = (offset: number | null | undefined) => (typeof offset === 'number' && Number.isFinite(offset) ? addDays(day, offset) : null);
  return {
    seen: seen ?? 0,
    wrong: wrong ?? 0,
    firstDay: dayAt(firstSeen),
    lastDay: dayAt(lastAnswer),
    seriesAt: moment(streakAt),
    seriesDay: dayAt(streakDay),
    twoDaysAt: moment(twoDaysAt),
    namedAt: moment(namedAt),
    checks: checks ?? 0,
    peekDay: dayAt(peekDay),
    wasTwoDays: wasTwoDays === 1,
    cleanOkAt: moment(cleanOkAt),
  };
}

function emptyUnit(): UnitState {
  return { seen: 0, wrong: 0, firstDay: null, lastDay: null, seriesAt: null, seriesDay: null, twoDaysAt: null,
    namedAt: null, checks: 0, peekDay: null, wasTwoDays: false, cleanOkAt: null };
}

export function decodePlanInputs(wire: PlanInputsWire, options: DecodeOptions): PlanInput {
  const containerIndex = wire.containers.findIndex((container) => container.id === options.containerId);
  if (containerIndex < 0) throw new Error(`plan_inputs: no container ${options.containerId}`);
  const container = wire.containers[containerIndex];
  const today = localDay(options.now, options.tz);
  const sameDay = wire.day === today;

  const subjectIndexes: number[] = [];
  wire.subjects.forEach((subject, index) => {
    if (subject.container === containerIndex) subjectIndexes.push(index);
  });
  const ownSubjects = new Set(subjectIndexes);
  const subjects = subjectIndexes.map((index) => {
    const subject = wire.subjects[index];
    return { id: subject.id, title: subject.title, date: subject.test_date ?? null };
  });

  const states = new Map<number, PlanStateRow>();
  for (const row of wire.states) if (Array.isArray(row)) states.set(row[0], row);

  const items: PlanItem[] = [];
  const byId = new Map<string, PlanItem>();
  wire.items.forEach((row, index) => {
    const [id, subject, topic, position, , , slow] = row;
    if (!ownSubjects.has(subject)) return;
    const state = states.get(index);
    const item: PlanItem = {
      id,
      s: wire.subjects[subject].id,
      f: 't',
      tp: topic ?? null,
      o: position,
      u: state ? unitFromRow(state, wire.day) : emptyUnit(),
    };
    if (slow === 1) item.slow = 1;
    items.push(item);
    byId.set(id, item);
  });

  const newDone: Record<string, number> = {};
  for (const index of subjectIndexes) newDone[wire.subjects[index].id] = sameDay ? wire.subjects[index].new_today ?? 0 : 0;
  let doneSec = sameDay ? container.today.done_s ?? 0 : 0;
  const firstAt = sameDay ? moment(container.today.first_at) : null;

  // The offline queue: answered today, whatever the server will make of them.
  let pendingMs = 0;
  const merged = new Set<string>();
  for (const answer of options.pending) {
    const item = answer && byId.get(answer.item_id);
    if (!item?.u) continue;
    if (answer.mode !== 'mock' && typeof answer.ms === 'number' && Number.isFinite(answer.ms) && answer.ms > 0) {
      pendingMs += Math.min(answer.ms, ANSWER_MS_CAP);
    }
    if (merged.has(item.id)) continue;
    merged.add(item.id);
    const unit = { ...item.u };
    if (unit.firstDay === null) {
      unit.firstDay = today;
      newDone[item.s] = (newDone[item.s] ?? 0) + 1;
    }
    if (unit.lastDay === null || unit.lastDay < today) unit.lastDay = today;
    item.u = unit;
  }
  doneSec += Math.round(pendingMs / 1000);

  let pace: Record<string, Pace> | null = null;
  if (wire.pace.some((row) => ownSubjects.has(row.subject))) {
    const paces = paceFrom(wire.pace, wire.subjects.length);
    pace = {};
    for (const index of subjectIndexes) if (paces[index]) pace[wire.subjects[index].id] = paces[index];
  }

  const ownIds = new Set(subjects.map((subject) => subject.id));
  return {
    v: 1,
    now: options.now,
    tz: options.tz,
    containerId: container.id,
    budgetMin: container.settings?.minutes_per_day ?? 60,
    firstPlanDay: container.first_plan_day,
    subjects,
    items: [...items, ...options.oral.filter((item) => item && ownIds.has(item.s))],
    today: { firstAt, doneSec, newDone },
    pace,
    ai: wire.ai ? { left: wire.ai.left, resetsAt: wire.ai.resets_at * 1000 } : null,
  };
}
