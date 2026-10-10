/**
 * TEST ONLY: the database side of a study day, so the frozen-day tests read the plan the way the site and the bot do —
 * through plan_inputs and decodePlanInputs:
 * - answers go through the database's rule (./sqlRule.ts) and into an answer log;
 * - `pace` and `pace_day` are counted from the log as meldy_private.plan_inputs_for counts them (per subject index and
 *   class, the last ≤ 200 learn answers with a time, no retries, no misclicks: n, the median of ms capped at 180 s,
 *   the share wrong; `pace_day` only from answers made before the container's first answer today);
 * - `day_start` keeps, for each item, its state before its first answer of the day, as the trigger of
 *   supabase/migrations/20261010130000_containers_frozen_pace.sql does;
 * - today's first answer, seconds and new questions, as the wire's `today` and `new_today`.
 * Moments go out as epoch seconds rounded up, days as offsets, the way the wire carries them. Not a model of learning.
 */
import type { LocalDay, PlanCls, PlanInput, PlanInputsWire, PlanItem, PlanStateRow, UnitState } from '../../../types/container.ts';
import { decodePlanInputs } from '../planInputs.ts';
import { emptyState, isSeen } from '../rule.ts';
import { daysBetween, localDay } from '../time.ts';
import { sqlStep } from './sqlRule.ts';
import { TZ } from './scenarios.ts';

const CONTAINER = 'c-srv';

interface Logged { subject: number; cls: PlanCls; ms: number; correct: boolean; retry: boolean; misclick: boolean; at: number; day: LocalDay }

export interface Server {
  tz: string;
  subjects: Array<{ id: string; title: string; date: LocalDay | null }>;
  items: PlanItem[]; // test items only, in plan order
  budgetMin: number;
  firstPlanDay: LocalDay;
  states: Map<string, UnitState>;
  starts: Map<string, { day: LocalDay; state: UnitState }>;
  log: Logged[];
}

export function newServer(o: { subjects: Array<{ id: string; date: LocalDay | null }>; items: PlanItem[]; budgetMin: number; firstPlanDay: LocalDay; tz?: string }): Server {
  return {
    tz: o.tz ?? TZ, subjects: o.subjects.map((s) => ({ id: s.id, title: s.id, date: s.date })), items: o.items, budgetMin: o.budgetMin,
    firstPlanDay: o.firstPlanDay, states: new Map(), starts: new Map(), log: [],
  };
}

/** The plan class the site sends with an answer (components/containers/model.ts clsOf). */
export function classOf(u: UnitState | undefined, inWindow: boolean): PlanCls {
  if (!u || !isSeen(u)) return 'new_floor';
  if (u.twoDaysAt !== null) return inWindow ? 'final' : 'check';
  if (u.seriesAt !== null) return 'confirm';
  return 'relearn';
}

/** One answer through the rule, as record_test_answers_for records it (the state, the log and the day's start). */
export function record(server: Server, itemId: string, a: { at: number; correct: boolean; ms: number; cls: PlanCls; retry?: boolean; misclick?: boolean }): void {
  const item = server.items.find((entry) => entry.id === itemId);
  if (!item) throw new Error(`no item ${itemId}`);
  const day = localDay(a.at, server.tz);
  const prev = server.states.get(itemId) ?? emptyState();
  const date = server.subjects.find((s) => s.id === item.s)?.date ?? null;
  const r = sqlStep(prev, { at: a.at, day, correct: a.correct, retry: a.retry, misclick: a.misclick }, date);
  if (r.step !== 'late') {
    // The trigger: an update that moves the last answer to a later day keeps the state the day began with.
    if (r.state.lastDay !== null && (prev.lastDay === null || r.state.lastDay > prev.lastDay)) server.starts.set(itemId, { day: r.state.lastDay, state: prev });
    server.states.set(itemId, r.state);
  }
  const subject = server.subjects.findIndex((s) => s.id === item.s);
  server.log.push({ subject, cls: a.cls, ms: a.ms, correct: a.correct, retry: Boolean(a.retry), misclick: Boolean(a.misclick), at: a.at, day });
}

function median(values: number[]): number {
  const v = values.slice().sort((x, y) => x - y);
  const n = v.length;
  return n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
}

function paceRows(log: Logged[], before: number | null): PlanInputsWire['pace'] {
  const groups = new Map<string, Logged[]>();
  for (const a of log) {
    if (a.retry || a.misclick || (before !== null && a.at >= before)) continue;
    const key = `${a.subject}|${a.cls}`;
    const list = groups.get(key);
    if (list) list.push(a); else groups.set(key, [a]);
  }
  const rows: PlanInputsWire['pace'] = [];
  for (const [key, list] of [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const last = list.slice(-200);
    const [subject, cls] = key.split('|');
    rows.push({
      subject: Number(subject), cls: cls as PlanCls, n: last.length, median_ms: Math.round(median(last.map((a) => Math.min(a.ms, 180_000)))),
      p_wrong: Math.round((last.filter((a) => !a.correct).length / last.length) * 10_000) / 10_000,
    });
  }
  return rows;
}

const sec = (ms: number | null) => (ms === null ? null : Math.ceil(ms / 1000));

function tuple(index: number, u: UnitState, day: LocalDay): PlanStateRow {
  const off = (d: LocalDay | null) => (d === null ? null : daysBetween(day, d));
  return [index, u.seen, u.wrong, off(u.firstDay), off(u.lastDay), null, off(u.seriesDay), sec(u.seriesAt), sec(u.twoDaysAt), sec(u.namedAt),
    u.checks, off(u.peekDay), u.wasTwoDays ? 1 : 0, sec(u.cleanOkAt)];
}

/** What plan_inputs answers at `now` (`old`: a server before 20261010130000, without pace_day and day_start). */
export function wireAt(server: Server, now: number, old = false): PlanInputsWire {
  const day = localDay(now, server.tz);
  const todays = server.log.filter((a) => a.day === day);
  const firstAt = todays.length > 0 ? Math.min(...todays.map((a) => a.at)) : null;
  const doneMs = todays.reduce((sum, a) => sum + Math.min(a.ms, 180_000), 0);
  const states: PlanStateRow[] = [];
  const starts: PlanStateRow[] = [];
  server.items.forEach((item, i) => {
    const u = server.states.get(item.id);
    if (!u) return;
    states.push(tuple(i, u, day));
    const start = server.starts.get(item.id);
    if (u.lastDay === day && start && start.day === day && u.firstDay !== null && u.firstDay < day) starts.push(tuple(i, start.state, day));
  });
  const wire: PlanInputsWire = {
    v: 1, day, now: Math.floor(now / 1000),
    containers: [{ id: CONTAINER, title: 'Сессия', exam_date: null, role: 'owner', first_plan_day: server.firstPlanDay, answers_today: todays.length,
      settings: { minutes_per_day: server.budgetMin, study_weekdays: 127 },
      today: { first_at: firstAt === null ? null : Math.floor(firstAt / 1000), done_s: Math.round(doneMs / 1000) } }],
    subjects: server.subjects.map((s) => ({
      id: s.id, container: 0, title: s.title, test_date: s.date, oral_exam_id: null, topics: 9,
      new_today: server.items.filter((item) => item.s === s.id && server.states.get(item.id)?.firstDay === day).length,
    })),
    items: server.items.map((item) => [item.id, server.subjects.findIndex((s) => s.id === item.s), item.tp, item.o, 0, 1, item.slow ? 1 : 0]),
    states,
    doubted: [],
    pace: paceRows(server.log, null),
    ai: null,
  };
  if (!old) {
    wire.pace_day = paceRows(server.log, firstAt);
    wire.day_start = starts.sort((a, b) => a[0] - b[0]);
  }
  return wire;
}

/** The plan's input at `now`, decoded as the site and the bot decode it. */
export function inputAt(server: Server, now: number, old = false): PlanInput {
  return decodePlanInputs(wireAt(server, now, old), { containerId: CONTAINER, tz: server.tz, now, pending: [], oral: [] });
}
