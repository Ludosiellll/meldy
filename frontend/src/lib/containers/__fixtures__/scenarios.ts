/**
 * TEST ONLY: synthetic plan inputs, and a deterministic learner who studies them day by day through the real plan
 * and sessions, with the database's rule mirrored by ./sqlRule.ts. Not a model of learning: it checks the plan's
 * mechanics (the frozen day, the budget, the figure moving from day 2), never predicts results.
 */
import type { DayPlan, LocalDay, OralMeta, PlanInput, PlanItem, UnitState } from '../../../types/container.ts';
import { planDay } from '../plan.ts';
import { emptyState, inFigure, isSeen } from '../rule.ts';
import { afterAnswer, buildSession, prng } from '../session.ts';
import { atLocalTime, localDay } from '../time.ts';
import { sqlStep } from './sqlRule.ts';

export const TZ = 'Europe/Minsk';

/** The moment of a local wall time: `at('2026-10-07', '21:00')`. */
export function at(day: LocalDay, hhmm: string, tz = TZ): number {
  const [h, m] = hhmm.split(':').map(Number);
  return atLocalTime(day, h * 60 + m, tz);
}

/** `count` test questions of a subject, topics of `topicSize` consecutive questions; every `slowEvery`-th has code. */
export function testItems(subjectId: string, count: number, topicSize = 20, slowEvery = 0): PlanItem[] {
  const out: PlanItem[] = [];
  for (let k = 1; k <= count; k += 1) {
    const item: PlanItem = { id: `${subjectId}-t${String(k).padStart(4, '0')}`, s: subjectId, f: 't', tp: 1 + Math.floor((k - 1) / topicSize), o: k };
    if (slowEvery > 0 && k % slowEvery === 0) item.slow = 1;
    out.push(item);
  }
  return out;
}

/** `count` oral questions of a subject with `lines` deciding lines each. */
export function oralItems(subjectId: string, count: number, meta: Partial<OralMeta> = {}, lines = 3): PlanItem[] {
  const out: PlanItem[] = [];
  for (let k = 1; k <= count; k += 1) {
    out.push({
      id: `${subjectId}-o${String(k).padStart(4, '0')}`, s: subjectId, f: 'o', tp: null, o: k,
      l: Array.from({ length: lines }, () => emptyState()),
      m: { sc: null, rating: 0, ac: null, prepared: true, ...meta },
    });
  }
  return out;
}

export interface InputOptions {
  now: number;
  subjects: Array<{ id: string; title?: string; date: LocalDay | null }>;
  items: PlanItem[];
  budgetMin?: number;
  firstPlanDay?: LocalDay;
  tz?: string;
  firstAt?: number | null;
  doneSec?: number;
  newDone?: Record<string, number>;
  ai?: { left: number; resetsAt: number } | null;
}

export function makeInput(o: InputOptions): PlanInput {
  const tz = o.tz ?? TZ;
  return {
    v: 1,
    now: o.now,
    tz,
    containerId: 'c-1',
    budgetMin: o.budgetMin ?? 60,
    firstPlanDay: o.firstPlanDay ?? localDay(o.now, tz),
    subjects: o.subjects.map((s) => ({ id: s.id, title: s.title ?? s.id, date: s.date })),
    items: o.items,
    today: { firstAt: o.firstAt ?? null, doneSec: o.doneSec ?? 0, newDone: o.newDone ?? {} },
    pace: null,
    ai: o.ai ?? null,
  };
}

/** A state built by answering in order (each answer through the database's rule). */
export function stateAfter(answers: Array<{ at: number; correct: boolean; retry?: boolean; misclick?: boolean }>, examDay: LocalDay | null = null, tz = TZ): UnitState {
  let s = emptyState();
  for (const a of answers) s = sqlStep(s, { at: a.at, day: localDay(a.at, tz), correct: a.correct, retry: a.retry, misclick: a.misclick }, examDay).state;
  return s;
}

// ───────────────────────────────────────────── the learner ─────────────────────────────────────────────

export interface Learner { pNew: number; pReview: number; pRetry: number; tNew: number; tRev: number; tRetry: number; tWrong: number }

/** Answers at the default pace (35 s new, 20 s familiar), right on 55 % of new and 85 % of familiar questions. */
export const STEADY: Learner = { pNew: 0.55, pReview: 0.85, pRetry: 0.93, tNew: 35, tRev: 20, tRetry: 12, tWrong: 10 };

interface DayRecord { firstAt: number | null; doneSec: number; newDone: Record<string, number> }

export interface Sim {
  tz: string;
  subjects: PlanInput['subjects'];
  budgetMin: number;
  firstPlanDay: LocalDay;
  seed: string;
  learner: Learner;
  items: PlanItem[];
  states: Map<string, UnitState>;
  days: Map<LocalDay, DayRecord>;
  dateOf: Map<string, LocalDay | null>;
}

export function newSim(o: { subjects: Array<{ id: string; date: LocalDay | null }>; items: PlanItem[]; budgetMin: number; firstPlanDay: LocalDay; seed: string; learner?: Learner; tz?: string }): Sim {
  const dateOf = new Map<string, LocalDay | null>();
  for (const item of o.items) dateOf.set(item.id, o.subjects.find((s) => s.id === item.s)?.date ?? null);
  return {
    tz: o.tz ?? TZ, subjects: o.subjects.map((s) => ({ id: s.id, title: s.id, date: s.date })), budgetMin: o.budgetMin,
    firstPlanDay: o.firstPlanDay, seed: o.seed, learner: o.learner ?? STEADY, items: o.items,
    states: new Map(), days: new Map(), dateOf,
  };
}

function record(sim: Sim, day: LocalDay): DayRecord {
  let rec = sim.days.get(day);
  if (!rec) {
    rec = { firstAt: null, doneSec: 0, newDone: {} };
    sim.days.set(day, rec);
  }
  return rec;
}

/** What plan_inputs would return at `now` (the database's states and today's facts). */
export function simInput(sim: Sim, now: number): PlanInput {
  const day = localDay(now, sim.tz);
  const rec = sim.days.get(day) ?? { firstAt: null, doneSec: 0, newDone: {} };
  return {
    v: 1, now, tz: sim.tz, containerId: 'sim', budgetMin: sim.budgetMin, firstPlanDay: sim.firstPlanDay,
    subjects: sim.subjects,
    items: sim.items.map((item) => {
      const u = sim.states.get(item.id);
      return u ? { ...item, u } : item;
    }),
    today: { firstAt: rec.firstAt, doneSec: Math.round(rec.doneSec), newDone: { ...rec.newDone } },
    pace: null,
    ai: null,
  };
}

/**
 * Studies from `start`: the plan's next session again and again (each answer through the database's rule) until
 * the plan offers nothing more now or `maxSec` seconds are spent. Returns when it ended and what it saw.
 */
export function sit(sim: Sim, start: number, maxSec = Infinity): { end: number; answered: number; plans: DayPlan[] } {
  const L = sim.learner;
  let t = start;
  let spent = 0;
  let answered = 0;
  const plans: DayPlan[] = [];
  for (let guard = 0; guard < 200 && spent < maxSec; guard += 1) {
    const plan = planDay(simInput(sim, t));
    plans.push(plan);
    const next = plan.sessions[0];
    if (!next) break;
    const day = localDay(t, sim.tz);
    const rec = record(sim, day);
    const seed = `${sim.seed}:${t}`;
    let queue = buildSession(plan, next.subjectId, next.kind, [], seed);
    for (let pos = 0; pos < queue.length && spent < maxSec; pos += 1) {
      const e = queue[pos];
      const u = sim.states.get(e.id) ?? emptyState();
      const fresh = !isSeen(u);
      const p = e.retry > 0 ? L.pRetry : fresh ? L.pNew : L.pReview;
      const correct = prng(`${sim.seed}|${e.id}|${day}|${e.retry}|${u.seen}`)() < p;
      const sec = (e.retry > 0 ? L.tRetry : fresh ? L.tNew : L.tRev) + (correct ? 0 : L.tWrong);
      if (rec.firstAt === null) rec.firstAt = t;
      const r = sqlStep(u, { at: t, day, correct, retry: e.retry > 0 }, sim.dateOf.get(e.id) ?? null);
      sim.states.set(e.id, r.state);
      if (fresh && e.retry === 0) rec.newDone[next.subjectId] = (rec.newDone[next.subjectId] ?? 0) + 1;
      rec.doneSec += sec;
      spent += sec;
      t += sec * 1000;
      answered += 1;
      queue = afterAnswer(queue, pos, { id: e.id, correct }, seed);
    }
  }
  return { end: t, answered, plans };
}

export function simFigure(sim: Sim): number {
  let n = 0;
  for (const u of sim.states.values()) if (inFigure(u)) n += 1;
  return n;
}

export function simSeen(sim: Sim): number {
  let n = 0;
  for (const u of sim.states.values()) if (isSeen(u)) n += 1;
  return n;
}
