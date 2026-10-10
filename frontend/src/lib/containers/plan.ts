/**
 * The day's plan (package D2; spec §5, §15 #32, Concept 2 §3): pure and deterministic — no clock, no randomness.
 * The same module runs on «Сегодня», offline, and in the Telegram bot (copied to supabase/functions/_shared/plan/).
 *
 * The day is frozen at its first answer (`today.firstAt`): items are classified at that moment, so nothing that
 * becomes countable later joins today's target — except the confirmations that become countable later today, up to
 * 22:00 (decision 32): they are in the target from the start and offered only from their moment. The frozen day is
 * planned with the pace as of its start (`paceDay`) and, when the server says how the day began (`dayStart`), it IS
 * the fill of that moment: answered items leave it, free study and the real minutes trim its end, so the count and
 * the minutes only go down while the student answers (see «the frozen day» below). The budget is a hard cap.
 *
 * Order inside the budget (decision 16): mistakes → confirmations → the coverage floor of new items → oral AI checks
 * (confirmations first) → due checks → the final pass → more new items (≤ 100 a day). Each subject first fills its
 * fair share of the minutes (by remaining work, at least 10 %), then the rest goes through the same order.
 */
import type { Cls, DayPlan, LocalDay, OralMeta, Pace, PlanInput, PlanItem, UnitState } from '../../types/container.ts';
import { DEFAULT_PACE, SLOW_NEW_FACTOR, SLOW_REV_FACTOR } from './pace.ts';
import { derive, emptyState, inFigure, isOpenError, isSeen } from './rule.ts';
import { addDays, atLocalTime, clockText, dayIndex, daysBetween, localDay, startOfDay } from './time.ts';

export const BUDGET_OPTIONS: readonly number[] = [30, 45, 60, 90];
export const NEW_PER_DAY_MAX = 100;
export const NO_DATE_NEW_PER_DAY = 15;
export const WINDOW_MAX_DAYS = 4;
/** Confirmations that become countable later today, up to this local time, belong to today's frozen target. */
export const LATE_UNTIL_MINUTES = 22 * 60;
/** Each subject's fair share is at least this part of the budget. */
export const MIN_SHARE = 0.1;
export const SESSION_SIZE: Readonly<Record<SessionKind, number>> = { answer: 20, self_check: 10, ai_check: 3 };
export const AI_CHECK_UNITS = 4;
export const POINTS_UNITS = 1;
export const MAPPING_UNITS = 10;
export const MAPPING_BATCH = 40;
export const CLASS_ORDER: readonly Cls[] = ['relearn', 'confirm', 'new_floor', 'confirm_ai', 'start_ai', 'check', 'final', 'new_fill'];
/** Times promised on screen are rounded up to 5 minutes («после 17:05» stays true). */
export const TIME_STEP_MIN = 5;

export type SessionKind = 'answer' | 'self_check' | 'ai_check';
export type PlanLine = DayPlan['lines'][number];

const RETRY_FACTOR = 1.07;
const EPS = 1e-6;
const NO_META: OralMeta = { sc: null, rating: 0, ac: null, prepared: false };
const EMPTY: UnitState = emptyState();
const KIND_ORDER: Record<SessionKind, number> = { answer: 0, self_check: 1, ai_check: 2 };

// ───────────────────────────────────────────── estimates ─────────────────────────────────────────────

function isNewCls(cls: Cls): boolean { return cls === 'new_floor' || cls === 'new_fill'; }

/** An oral item in this class is answered aloud with the AI check (4 units); otherwise it is a self-check. */
export function isAiCheck(item: PlanItem, cls: Cls): boolean {
  return item.f === 'o' && (cls === 'confirm_ai' || cls === 'start_ai' || cls === 'check');
}

export function sessionKind(item: PlanItem, cls: Cls): SessionKind {
  if (item.f !== 'o') return 'answer';
  return isAiCheck(item, cls) ? 'ai_check' : 'self_check';
}

function missKey(cls: Cls): keyof Pace['pWrong'] {
  if (isNewCls(cls)) return 'new';
  if (cls === 'relearn' || cls === 'confirm' || cls === 'final') return cls;
  return 'check';
}

/** Seconds a planned item is expected to take: base + pWrong(class) × (wrong extra + 1.07 × retry). */
export function estSeconds(item: PlanItem, cls: Cls, pace: Pace): number {
  if (item.f === 'o') return isAiCheck(item, cls) ? pace.tAC : pace.tSC;
  const base = isNewCls(cls) ? pace.tNew * (item.slow ? SLOW_NEW_FACTOR : 1) : pace.tRev * (item.slow ? SLOW_REV_FACTOR : 1);
  return base + pace.pWrong[missKey(cls)] * (pace.tWrong + RETRY_FACTOR * pace.tRetry);
}

/** The final window's length W = min(4, ⌊D0/3⌋), D0 = days from the first plan day to the date. */
export function windowDays(firstPlanDay: LocalDay, date: LocalDay): number {
  const d0 = daysBetween(firstPlanDay, date);
  return Math.max(0, Math.min(WINDOW_MAX_DAYS, Math.floor(d0 / 3)));
}

function ceil5(minutes: number): number { return Math.max(0, Math.ceil(minutes / 5 - EPS) * 5); }

// ───────────────────────────────────────────── the scan ─────────────────────────────────────────────

type Phase = 'study' | 'window' | 'exam_today' | 'after';

interface Subj {
  id: string;
  index: number;
  date: LocalDay | null;
  phase: Phase;
  daysLeft: number | null; // date − today
  w: number;
  windowFrom: LocalDay | null;
  windowFromAt: number | null;
  lastNewDay: LocalDay | null;
  pace: Pace;
  newDone: number;
  unseen: PlanItem[]; // in plan order
  floor: number;
  cap: number;
  newTaken: number;
  doneEst: number; // estimated seconds of the items answered today
  work: number; // estimated seconds still needed (fair share)
  finalLeft: number;
  finalDoneToday: number;
  finalQuota: number;
  finalUsed: number;
  backlogTest: PlanItem[];
  backlogOral: PlanItem[];
  seenNow: number;
  inPlan: number;
}

interface Cand {
  item: PlanItem;
  s: Subj;
  cls: Cls;
  key: number[];
  from: number | null; // the moment it becomes countable (confirmations), null = now
}

type Bucket = 'relearn' | 'confirm' | 'late' | 'confirm_ai' | 'start_ai' | 'check' | 'final';

interface Fig { inPlan: number; twoDays: number; seen: number; errors: number; selfKnow: number }

interface Scan {
  input: PlanInput;
  tz: string;
  now: number;
  today: LocalDay;
  at: number; // the frozen moment
  frozen: boolean;
  lateUntil: number;
  subjects: Subj[];
  byId: Map<string, Subj>;
  buckets: Record<Bucket, Cand[]>;
  waiting: Array<{ item: PlanItem; s: Subj; from: number }>; // started, not today's: countable from `from` (for `next`)
  dueLater: number[]; // moments checks become due (not today)
  answeredToday: number;
  lastStudyDay: LocalDay | null;
  figure: Fig;
  subjectFigure: Map<string, Fig>;
  mapped: Set<string>;
  hasOral: boolean;
}

function newFig(): Fig { return { inPlan: 0, twoDays: 0, seen: 0, errors: 0, selfKnow: 0 }; }

function laterDay(a: LocalDay | null, b: LocalDay | null): LocalDay | null {
  if (a === null) return b;
  if (b === null) return a;
  return b > a ? b : a;
}

/** The subject's pace; a missing or broken number falls back to the default (a NaN cost would let the fill take everything). */
function paceOf(paces: PlanInput['pace'] | undefined, subjectId: string): Pace {
  const own = paces ? paces[subjectId] : undefined;
  if (!own) return DEFAULT_PACE;
  const sec = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 1 ? v : d);
  const share = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : d);
  const p = own.pWrong ?? DEFAULT_PACE.pWrong;
  const dp = DEFAULT_PACE.pWrong;
  return {
    tNew: sec(own.tNew, DEFAULT_PACE.tNew), tRev: sec(own.tRev, DEFAULT_PACE.tRev), tWrong: sec(own.tWrong, DEFAULT_PACE.tWrong),
    tRetry: sec(own.tRetry, DEFAULT_PACE.tRetry), tSC: sec(own.tSC, DEFAULT_PACE.tSC), tAC: sec(own.tAC, DEFAULT_PACE.tAC),
    pWrong: { new: share(p.new, dp.new), relearn: share(p.relearn, dp.relearn), confirm: share(p.confirm, dp.confirm),
      check: share(p.check, dp.check), final: share(p.final, dp.final) },
  };
}

function batchKey(subjectId: string, order: number): string {
  return `${subjectId}|${Math.floor(Math.max(0, order - 1) / MAPPING_BATCH)}`;
}

/** New items of a subject in plan order: tests by topic round-robin (file order inside a topic), oral merged in proportion. */
function newOrder(items: PlanItem[]): PlanItem[] {
  const byOrder = (a: PlanItem, b: PlanItem) => a.o - b.o || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const topics = new Map<number, PlanItem[]>();
  const oral: PlanItem[] = [];
  for (const item of items) {
    if (item.f === 'o') { oral.push(item); continue; }
    const tp = item.tp === null || item.tp === undefined ? Number.MAX_SAFE_INTEGER : item.tp;
    const list = topics.get(tp);
    if (list) list.push(item); else topics.set(tp, [item]);
  }
  const groups = [...topics.entries()].sort((a, b) => a[0] - b[0]).map(([, list]) => list.sort(byOrder));
  const test: PlanItem[] = [];
  for (let depth = 0; ; depth += 1) {
    let any = false;
    for (const group of groups) if (depth < group.length) { test.push(group[depth]); any = true; }
    if (!any) break;
  }
  oral.sort(byOrder);
  if (oral.length === 0) return test;
  if (test.length === 0) return oral;
  const out: PlanItem[] = [];
  let i = 0;
  let j = 0;
  while (i < test.length || j < oral.length) {
    const takeTest = j >= oral.length || (i < test.length && i * oral.length <= j * test.length);
    if (takeTest) out.push(test[i++]); else out.push(oral[j++]);
  }
  return out;
}

/** The oral question's view from its deciding lines (Concept 2 §4): what the plan may do with it now. */
export function oralView(lines: readonly UnitState[], m: OralMeta, at: number, today: LocalDay, examDay: LocalDay | null, tz: string):
  'new' | 'learning' | 'ready' | 'confirmable' | 'waiting' | 'cleared' {
  if (m.sc === null && m.ac === null && lines.every((l) => !isSeen(l))) return 'new';
  if (lines.length > 0 && lines.every(inFigure)) return 'cleared';
  const peekToday = m.sc === today || lines.some((l) => l.peekDay === today);
  const open = lines.filter((l) => !inFigure(l)).map((l) => derive(l, at, today, examDay, tz));
  if (open.length > 0 && open.every((d) => d.status === 'started')) {
    if (!peekToday && open.every((d) => (d.from ?? Infinity) <= at)) return 'confirmable';
    return 'waiting';
  }
  if (m.rating === 3 && m.sc !== null && m.sc < today && !peekToday && m.ac !== today) return 'ready';
  return 'learning';
}

/** The last self-rating was «Плаваю» or «Не знаю» after the last AI check: no AI check until the next «Знаю». */
function aiHeld(m: OralMeta): boolean {
  return m.sc !== null && (m.rating === 1 || m.rating === 2) && (m.ac === null || m.sc >= m.ac);
}

function cmpKey(a: Cand, b: Cand): number {
  for (let i = 0; i < Math.max(a.key.length, b.key.length); i += 1) {
    const x = a.key[i] ?? 0;
    const y = b.key[i] ?? 0;
    if (x !== y) return x - y;
  }
  return a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0;
}

function dateRank(s: Subj): number { return s.daysLeft === null ? 1e9 : s.daysLeft; }

function scan(input: PlanInput, paces: PlanInput['pace'] | undefined = input.pace): Scan {
  const tz = input.tz;
  const now = input.now;
  const today = localDay(now, tz);
  const firstAt = input.today ? input.today.firstAt : null;
  const frozen = typeof firstAt === 'number' && Number.isFinite(firstAt) && localDay(firstAt, tz) === today;
  const at = frozen ? (firstAt as number) : now;
  const lateUntil = atLocalTime(today, LATE_UNTIL_MINUTES, tz);

  const subjects: Subj[] = [];
  const byId = new Map<string, Subj>();
  (input.subjects ?? []).forEach((raw, index) => {
    if (byId.has(raw.id)) return;
    const date = raw.date ?? null;
    const daysLeft = date === null ? null : daysBetween(today, date);
    const w = date === null ? 0 : windowDays(input.firstPlanDay ?? today, date);
    const windowFrom = date !== null && w > 0 ? addDays(date, -w) : null;
    let phase: Phase = 'study';
    if (daysLeft !== null && daysLeft < 0) phase = 'after';
    else if (daysLeft === 0) phase = 'exam_today';
    else if (windowFrom !== null && today >= windowFrom) phase = 'window';
    const s: Subj = {
      id: raw.id, index, date, phase, daysLeft, w, windowFrom,
      windowFromAt: windowFrom === null ? null : startOfDay(windowFrom, tz),
      lastNewDay: date === null ? null : addDays(date, -w - 1),
      pace: paceOf(paces, raw.id),
      newDone: Math.max(0, Math.floor((input.today && input.today.newDone ? input.today.newDone[raw.id] : 0) ?? 0)),
      unseen: [], floor: 0, cap: 0, newTaken: 0, doneEst: 0, work: 0,
      finalLeft: 0, finalDoneToday: 0, finalQuota: 0, finalUsed: 0, backlogTest: [], backlogOral: [], seenNow: 0, inPlan: 0,
    };
    subjects.push(s);
    byId.set(raw.id, s);
  });

  const buckets: Record<Bucket, Cand[]> = { relearn: [], confirm: [], late: [], confirm_ai: [], start_ai: [], check: [], final: [] };
  const waiting: Scan['waiting'] = [];
  const dueLater: number[] = [];
  const figure = newFig();
  const subjectFigure = new Map<string, Fig>();
  for (const s of subjects) subjectFigure.set(s.id, newFig());
  const mapped = new Set<string>();
  const unseenRaw = new Map<Subj, PlanItem[]>();
  let answeredToday = 0;
  let lastStudyDay: LocalDay | null = null;
  let hasOral = false;
  const seenIds = new Set<string>();
  const before = (day: LocalDay | null) => (day !== null && day < today ? day : null);

  for (const item of input.items ?? []) {
    const s = byId.get(item.s);
    if (!s || seenIds.has(item.id)) continue;
    seenIds.add(item.id);
    const fig = subjectFigure.get(s.id) as Fig;
    const active = s.phase === 'study' || s.phase === 'window';
    const pace = s.pace;

    if (item.f === 'o') {
      hasOral = true;
      const lines = item.l ?? [];
      const m = item.m ?? NO_META;
      if (m.prepared) mapped.add(batchKey(s.id, item.o));
      const cleared = lines.length > 0 && lines.every(inFigure);
      const seen = m.sc !== null || m.ac !== null || lines.some(isSeen);
      const error = lines.some(isOpenError);
      for (const f of [figure, fig]) {
        f.inPlan += 1;
        if (cleared) f.twoDays += 1;
        if (seen) f.seen += 1;
        if (error) f.errors += 1;
        if (m.rating === 3) f.selfKnow += 1;
      }
      lastStudyDay = laterDay(lastStudyDay, laterDay(before(m.sc), before(m.ac)));
      for (const l of lines) lastStudyDay = laterDay(lastStudyDay, laterDay(before(l.lastDay), before(l.peekDay)));
      const doneToday = (m.sc !== null && m.sc >= today) || (m.ac !== null && m.ac >= today);
      if (doneToday) answeredToday += 1;
      if (!active) continue;
      s.inPlan += 1;
      if (seen) s.seenNow += 1;
      if (doneToday) {
        if (m.sc !== null && m.sc >= today) s.doneEst += pace.tSC;
        if (m.ac !== null && m.ac >= today) s.doneEst += pace.tAC;
        s.work += cleared ? 0.3 * pace.tSC : pace.tSC + 1.5 * pace.tAC;
        continue;
      }
      const view = oralView(lines, m, at, today, s.date, tz);
      const lastTouch = laterDay(m.sc, m.ac);
      const touchKey = lastTouch === null ? 0 : dayIndex(lastTouch);
      // No AI check after «Плаваю» / «Не знаю», and none without written points (the check grades against them).
      const held = aiHeld(m) || !m.prepared;
      if (view === 'new') {
        s.work += 2 * pace.tSC + 2.5 * pace.tAC;
        const list = unseenRaw.get(s);
        if (list) list.push(item); else unseenRaw.set(s, [item]);
        continue;
      }
      s.work += cleared ? 0.3 * pace.tSC : pace.tSC + 1.5 * pace.tAC;
      if (!cleared) s.backlogOral.push(item);
      const relearn = () => {
        if (lastTouch === null || lastTouch < today) buckets.relearn.push({ item, s, cls: 'relearn', key: [dateRank(s), touchKey, item.o], from: null });
      };
      if (view === 'confirmable') {
        if (held) { relearn(); continue; }
        const starts = lines.filter((l) => !inFigure(l)).map((l) => l.seriesAt ?? 0);
        buckets.confirm_ai.push({ item, s, cls: 'confirm_ai', key: [dateRank(s), Math.min(...starts), item.o], from: null });
      } else if (view === 'ready') {
        if (held) relearn();
        else buckets.start_ai.push({ item, s, cls: 'start_ai', key: [dateRank(s), m.sc === null ? 0 : dayIndex(m.sc), item.o], from: null });
      } else if (view === 'learning') {
        relearn();
      } else if (view === 'cleared') {
        const due = lines.some((l) => derive(l, at, today, s.date, tz).status === 'due');
        const named = Math.min(...lines.map((l) => l.namedAt ?? l.twoDaysAt ?? 0));
        if (due) {
          if (held) relearn();
          else buckets.check.push({ item, s, cls: 'check', key: [dateRank(s), named, item.o], from: null });
        } else if (s.phase === 'window' && s.windowFrom !== null && (lastTouch === null || lastTouch < s.windowFrom)) {
          s.finalLeft += 1;
          buckets.final.push({ item, s, cls: 'final', key: [dateRank(s), 0, named, item.o], from: null });
        }
      }
      continue;
    }

    // a test item
    const u = item.u ?? EMPTY;
    const twoDays = inFigure(u);
    for (const f of [figure, fig]) {
      f.inPlan += 1;
      if (twoDays) f.twoDays += 1;
      if (isSeen(u)) f.seen += 1;
      if (isOpenError(u)) f.errors += 1;
    }
    for (const d of [u.lastDay, u.firstDay, u.seriesDay, u.peekDay]) lastStudyDay = laterDay(lastStudyDay, before(d));
    const doneToday = u.lastDay !== null && u.lastDay >= today;
    if (doneToday) answeredToday += 1;
    if (!active) continue;
    s.inPlan += 1;
    if (isSeen(u)) s.seenNow += 1;
    const slowRev = item.slow ? SLOW_REV_FACTOR : 1;
    const slowNew = item.slow ? SLOW_NEW_FACTOR : 1;
    if (doneToday) {
      const firstToday = u.firstDay !== null && u.firstDay >= today;
      s.doneEst += estSeconds(item, firstToday ? 'new_floor' : 'confirm', pace);
      s.work += firstToday ? pace.tNew * slowNew + 3.2 * pace.tRev * slowRev : 2 * pace.tRev * slowRev;
      if (twoDays && s.phase === 'window' && s.windowFromAt !== null && (u.cleanOkAt ?? -Infinity) >= s.windowFromAt) s.finalDoneToday += 1;
      const after = derive(u, now, today, s.date, tz); // done for today; when it can count or is due next
      if (after.status === 'started') waiting.push({ item, s, from: after.from as number });
      else if (after.status === 'two_days' && after.from !== null) dueLater.push(after.from);
      continue;
    }
    const st = derive(u, at, today, s.date, tz);
    if (st.status === 'new') {
      s.work += pace.tNew * slowNew + 3.2 * pace.tRev * slowRev;
      const list = unseenRaw.get(s);
      if (list) list.push(item); else unseenRaw.set(s, [item]);
      continue;
    }
    if (st.status === 'learning' || st.status === 'started') {
      s.work += 2 * pace.tRev * slowRev;
      s.backlogTest.push(item);
    } else {
      s.work += 0.3 * pace.tRev * slowRev;
    }
    if (st.status === 'learning') {
      const last = laterDay(u.lastDay, u.peekDay);
      if (last === null || last < today) buckets.relearn.push({ item, s, cls: 'relearn', key: [dateRank(s), last === null ? 0 : dayIndex(last), item.o], from: null });
    } else if (st.status === 'started') {
      const from = st.from as number;
      if (from <= at) buckets.confirm.push({ item, s, cls: 'confirm', key: [dateRank(s), u.seriesAt ?? 0, item.o], from });
      else if (from <= lateUntil) buckets.late.push({ item, s, cls: 'confirm', key: [dateRank(s), from, item.o], from });
      else waiting.push({ item, s, from });
    } else if (st.status === 'due') {
      buckets.check.push({ item, s, cls: 'check', key: [dateRank(s), u.namedAt ?? 0, item.o], from: null });
    } else {
      if (st.from !== null) dueLater.push(st.from);
      if (s.phase === 'window' && s.windowFromAt !== null && (u.cleanOkAt ?? -Infinity) < s.windowFromAt) {
        s.finalLeft += 1;
        buckets.final.push({ item, s, cls: 'final', key: [dateRank(s), u.checks, u.namedAt ?? 0, item.o], from: null });
      }
    }
  }

  for (const [s, list] of unseenRaw) s.unseen = newOrder(list);
  for (const name of Object.keys(buckets) as Bucket[]) buckets[name].sort(cmpKey);

  return { input, tz, now, today, at, frozen, lateUntil, subjects, byId, buckets, waiting, dueLater, answeredToday, lastStudyDay,
    figure, subjectFigure, mapped, hasOral };
}

function activeSubjects(sc: Scan): Subj[] {
  return sc.subjects.filter((s) => s.phase === 'study' || s.phase === 'window');
}

/** Today's floor and cap of new items per subject (frozen for the day through `newDone`). */
function setFloors(sc: Scan): void {
  const active = activeSubjects(sc);
  let capLeft = NEW_PER_DAY_MAX;
  for (const s of sc.subjects) capLeft -= s.newDone;
  capLeft = Math.max(0, capLeft);
  const fillable: Subj[] = [];
  for (const s of active) {
    const n = s.unseen.length;
    if (s.date === null) {
      s.floor = Math.min(n, Math.max(0, NO_DATE_NEW_PER_DAY - s.newDone));
      s.cap = s.floor;
      continue;
    }
    const lastNew = s.lastNewDay as LocalDay;
    const days = sc.today <= lastNew ? daysBetween(sc.today, lastNew) + 1 : Math.max(1, s.daysLeft ?? 1);
    s.floor = Math.min(n, Math.max(0, Math.ceil((n + s.newDone) / days) - s.newDone));
    s.cap = s.floor;
    if (sc.today <= lastNew) fillable.push(s);
  }
  const totalFillable = fillable.reduce((sum, s) => sum + s.unseen.length, 0);
  for (const s of fillable) {
    const share = totalFillable > 0 ? Math.ceil((capLeft * s.unseen.length) / totalFillable) : 0;
    s.cap = Math.min(s.unseen.length, Math.max(s.floor, share));
  }
  for (const s of active) {
    if (s.phase !== 'window' || s.daysLeft === null) continue;
    const days = Math.max(1, s.daysLeft);
    s.finalQuota = Math.max(0, Math.ceil((s.finalLeft + s.finalDoneToday) / days) - s.finalDoneToday);
  }
}

/** Fair shares of the budget by remaining work, each at least MIN_SHARE of it (null for one subject). */
function fairShares(budget: number, subjects: Subj[]): Map<Subj, number> | null {
  const withWork = subjects.filter((s) => s.work > 0);
  if (withWork.length < 2 || budget <= 0) return null;
  const least = budget * Math.min(MIN_SHARE, 1 / withWork.length);
  const out = new Map<Subj, number>();
  let pool = withWork.slice();
  let remaining = budget;
  for (;;) {
    const total = pool.reduce((sum, s) => sum + s.work, 0);
    const low = pool.filter((s) => (remaining * s.work) / total < least);
    if (low.length === 0) {
      for (const s of pool) out.set(s, (remaining * s.work) / total);
      break;
    }
    for (const s of low) { out.set(s, least); remaining -= least; }
    pool = pool.filter((s) => !low.includes(s));
    if (pool.length === 0) break;
  }
  return out;
}

interface Taken { cand: Cand; cost: number; seq: number; rank: number; units: number }

interface Fill {
  taken: Map<string, Taken>;
  list: Taken[];
  spent: number;
  unitsPoints: number;
  unitsChecks: number;
  aiBlocked: boolean;
  remaining: number;
  charge: number;
}

function fillDay(sc: Scan): Fill {
  const input = sc.input;
  const budget = Math.max(0, Number(input.budgetMin) || 0) * 60;
  const active = activeSubjects(sc);
  const doneEst = active.reduce((sum, s) => sum + s.doneEst, 0);
  const doneSec = Math.max(0, Number(input.today ? input.today.doneSec : 0) || 0);
  const charge = Math.max(doneSec, doneEst);
  const remaining = Math.max(0, budget - charge);
  const shares = fairShares(budget, active);
  const used = new Map<Subj, number>();
  for (const s of active) used.set(s, s.doneEst);
  const unitsLeft = input.ai ? Math.max(0, input.ai.left) : null;
  const mapped = new Set(sc.mapped);
  const f: Fill = { taken: new Map(), list: [], spent: 0, unitsPoints: 0, unitsChecks: 0, aiBlocked: false, remaining, charge };
  let seq = 0;

  const take = (c: Cand, sharePass: boolean): boolean => {
    if (f.taken.has(c.item.id)) return true;
    const cost = estSeconds(c.item, c.cls, c.s.pace);
    if (f.spent + cost > remaining + EPS) return false;
    if (sharePass && shares) {
      if ((used.get(c.s) ?? 0) + cost > (shares.get(c.s) ?? 0) + EPS) return false;
    }
    let points = 0;
    let checks = 0;
    let batch: string | null = null;
    if (c.item.f === 'o') {
      if (isAiCheck(c.item, c.cls)) checks = AI_CHECK_UNITS;
      else if (!(c.item.m ?? NO_META).prepared) {
        batch = batchKey(c.s.id, c.item.o);
        points = POINTS_UNITS + (mapped.has(batch) ? 0 : MAPPING_UNITS);
      }
      if (unitsLeft !== null && f.unitsPoints + f.unitsChecks + points + checks > unitsLeft) {
        if (checks > 0) f.aiBlocked = true;
        return false;
      }
    }
    f.spent += cost;
    used.set(c.s, (used.get(c.s) ?? 0) + cost);
    f.unitsPoints += points;
    f.unitsChecks += checks;
    if (batch !== null) mapped.add(batch);
    const t: Taken = { cand: c, cost, seq: seq++, rank: CLASS_ORDER.indexOf(c.cls), units: points + checks };
    f.taken.set(c.item.id, t);
    f.list.push(t);
    return true;
  };

  const takeNew = (cls: Cls, sharePass: boolean) => {
    const order = active.filter((s) => s.unseen.length > 0).sort((a, b) => dateRank(a) - dateRank(b) || a.index - b.index);
    const stopped = new Set<Subj>();
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const s of order) {
        if (stopped.has(s)) continue;
        const limit = Math.min(cls === 'new_floor' ? s.floor : s.cap, s.unseen.length);
        if (s.newTaken >= limit) continue;
        const item = s.unseen[s.newTaken];
        if (take({ item, s, cls, key: [], from: null }, sharePass)) { s.newTaken += 1; progressed = true; } else stopped.add(s);
      }
    }
  };

  const pass = (sharePass: boolean) => {
    for (const cls of CLASS_ORDER) {
      if (isNewCls(cls)) { takeNew(cls, sharePass); continue; }
      if (cls === 'final') {
        for (const c of sc.buckets.final) {
          if (f.taken.has(c.item.id) || c.s.finalUsed >= c.s.finalQuota) continue;
          if (take(c, sharePass)) c.s.finalUsed += 1;
        }
        continue;
      }
      const list = cls === 'confirm' ? [...sc.buckets.confirm, ...sc.buckets.late] : sc.buckets[cls as Bucket];
      for (const c of list) take(c, sharePass);
    }
  };

  if (shares) pass(true);
  pass(false);
  return f;
}

// ───────────────────────────────────────────── the frozen day ─────────────────────────────────────────────
//
// After the day's first answer the target can only shrink, whatever the student's pace becomes (the usability check
// of 2026-10-10 saw 57 → «осталось 47» after 20 answers when the pace was re-estimated and the day refitted):
// - the day is planned with the pace as of its start (plan_inputs.pace_day), never with one re-estimated today;
// - with the day's start known (plan_inputs.day_start: each item answered today in the state it began the day), the
//   target is the very fill of that moment: the same input every time, so the same questions. Answered ones leave it;
//   what free study took by estimate comes off its end (a prefix: nothing skipped comes back); and when the real
//   minutes run short, at most as many questions stay as the cheapest of them fit. Every bound only tightens as the
//   student answers, so the count and the minutes only go down. Spare minutes go to «Ещё 20 новых».
// - Oral questions come from the device's cheat sheet, not from the server, so their day's start is not one of the
//   server's inputs: a day with oral questions in the plan is filled as before, with the day's pace.

/** The input as the day began (the moment of its first answer), or null when the server did not say how it began. */
function startView(input: PlanInput, sc: Scan): PlanInput | null {
  if (!sc.frozen || sc.hasOral || input.paceDay === undefined || !input.dayStart) return null;
  const start = input.dayStart;
  const items: PlanItem[] = [];
  for (const item of input.items ?? []) {
    const u = item.u;
    if (!u || u.lastDay === null || u.lastDay < sc.today) {
      items.push(item);
    } else if (u.firstDay !== null && u.firstDay >= sc.today) {
      items.push({ ...item, u: emptyState() }); // first answered today: it began the day unseen
    } else {
      const before = start[item.id];
      if (!before || (before.lastDay !== null && before.lastDay >= sc.today)) return null;
      items.push({ ...item, u: before });
    }
  }
  return { ...input, now: sc.at, items, today: { firstAt: sc.at, doneSec: 0, newDone: {} }, pace: input.paceDay };
}

/**
 * Today's target on a frozen day: the fill of the day's first answer (`startView`) without what was answered since,
 * trimmed by what free study took and by the real minutes left; null when the day's start is not known.
 */
function frozenFill(input: PlanInput, sc: Scan): Fill | null {
  const view = startView(input, sc);
  if (!view) return null;
  const s0 = scan(view);
  setFloors(s0);
  const f0 = fillDay(s0);
  const answered = new Set<string>();
  for (const item of input.items ?? []) if (item.u && item.u.lastDay !== null && item.u.lastDay >= sc.today) answered.add(item.id);
  // What the day's answers took by estimate: a question of the target at its cost there, another one at its kind's.
  let charged = 0;
  for (const item of view.items) {
    if (!answered.has(item.id)) continue;
    const t = f0.taken.get(item.id);
    const s = s0.byId.get(item.s);
    if (t) charged += t.cost;
    else if (s) charged += estSeconds(item, isSeen(item.u ?? EMPTY) ? 'confirm' : 'new_floor', s.pace);
  }
  const budget = Math.max(0, Number(input.budgetMin) || 0) * 60;
  const doneSec = Math.max(0, Number(input.today ? input.today.doneSec : 0) || 0);
  // The target in the order it was taken; free study comes off its end.
  const kept: Taken[] = [];
  let est = 0;
  for (const t of f0.list) {
    if (answered.has(t.cand.item.id)) continue;
    if (est + t.cost > budget - charged + EPS) break;
    kept.push(t);
    est += t.cost;
  }
  // The real minutes left hold at most as many questions as the cheapest of them fit.
  const realLeft = Math.max(0, budget - doneSec);
  let fit = 0;
  let sum = 0;
  for (const cost of kept.map((t) => t.cost).sort((a, b) => a - b)) {
    if (sum + cost > realLeft + EPS) break;
    sum += cost;
    fit += 1;
  }
  const list = kept.slice(0, fit);
  return {
    taken: new Map(list.map((t) => [t.cand.item.id, t])),
    list,
    spent: Math.min(est, realLeft),
    unitsPoints: 0,
    unitsChecks: 0,
    aiBlocked: false,
    remaining: realLeft,
    charge: Math.max(doneSec, charged),
  };
}

/** The day's target: before the first answer the live fill; after it the frozen one (as before, with the day's pace, when the day's start is not known). */
function dayFill(input: PlanInput, sc: Scan): Fill {
  if (!sc.frozen) return fillDay(sc);
  const frozen = frozenFill(input, sc);
  if (frozen) return frozen;
  if (input.paceDay === undefined) return fillDay(sc);
  const s0 = scan(input, input.paceDay);
  setFloors(s0);
  return fillDay(s0);
}

// ───────────────────────────────────────────── the plan ─────────────────────────────────────────────

function minutesOf(sec: number): number { return Math.max(0, Math.round(sec / 60)); }

function offsetDay(today: LocalDay, day: LocalDay): number { return daysBetween(today, day); }

/**
 * While the figure is 0: when the first questions can count (decision 40), from the plan — a confirmation in today's
 * target counts today (from its moment), any other started question from tomorrow at the earliest.
 */
function firstCount(sc: Scan, fill: Fill): { day: LocalDay; time: string | null } | null {
  const { tz, now, today } = sc;
  let earliest = Infinity;
  for (const t of fill.list) {
    if (t.cand.cls === 'confirm' && t.cand.from !== null) earliest = Math.min(earliest, Math.max(t.cand.from, now));
    if (t.cand.cls === 'confirm_ai') earliest = Math.min(earliest, now); // an oral confirmation planned for today
  }
  if (earliest === Infinity) {
    const tomorrowStart = startOfDay(addDays(today, 1), tz);
    for (const item of sc.input.items ?? []) {
      const s = sc.byId.get(item.s);
      if (!s || !(s.phase === 'study' || s.phase === 'window')) continue;
      const units: UnitState[] = item.f === 'o' ? (item.l ?? []).filter((l) => !inFigure(l)) : [item.u ?? EMPTY];
      if (units.length === 0) continue;
      let moment = -Infinity;
      for (const u of units) {
        const d = derive(u, now, today, s.date, tz);
        moment = d.status === 'started' ? Math.max(moment, d.from as number) : Infinity;
        if (moment === Infinity) break;
      }
      if (moment === Infinity) continue;
      earliest = Math.min(earliest, Math.max(moment, tomorrowStart));
    }
  }
  if (earliest === Infinity) return null;
  const day = localDay(earliest, tz);
  const time = earliest <= now || earliest === startOfDay(day, tz) ? null : clockText(earliest, tz, TIME_STEP_MIN);
  return { day, time };
}

/** The plan of the day. Same input → the same plan, on every device and in the bot. */
export function planDay(input: PlanInput): DayPlan {
  const sc = scan(input);
  const { tz, now, today } = sc;
  const active = activeSubjects(sc);
  setFloors(sc);
  const fill = dayFill(input, sc);

  // the target: ready now, or later today (confirmations not countable yet)
  const ready = fill.list.filter((t) => t.cand.from === null || t.cand.from <= now);
  const later = fill.list.filter((t) => t.cand.from !== null && t.cand.from > now);

  // sessions: one subject and one format each, in priority order
  ready.sort((a, b) => a.rank - b.rank || a.seq - b.seq);
  const groups = new Map<string, Taken[]>();
  for (const t of ready) {
    const key = `${t.cand.s.id}|${sessionKind(t.cand.item, t.cand.cls)}`;
    const list = groups.get(key);
    if (list) list.push(t); else groups.set(key, [t]);
  }
  const chunks: Array<{ s: Subj; kind: SessionKind; items: Taken[] }> = [];
  for (const list of groups.values()) {
    const kind = sessionKind(list[0].cand.item, list[0].cand.cls);
    const size = SESSION_SIZE[kind];
    for (let i = 0; i < list.length; i += size) chunks.push({ s: list[0].cand.s, kind, items: list.slice(i, i + size) });
  }
  chunks.sort((a, b) => a.items[0].rank - b.items[0].rank || dateRank(a.s) - dateRank(b.s) || a.s.index - b.s.index
    || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.items[0].seq - b.items[0].seq);
  const sessions: DayPlan['sessions'] = chunks.map((c) => ({
    subjectId: c.s.id, kind: c.kind, ids: c.items.map((t) => t.cand.item.id),
    estSec: Math.round(c.items.reduce((sum, t) => sum + t.cost, 0)),
  }));

  // counts
  let newItems = 0;
  let reviews = 0;
  let oral = 0;
  let aiChecks = 0;
  let selfChecks = 0;
  for (const t of fill.list) {
    if (t.cand.item.f === 'o') {
      oral += 1;
      if (isAiCheck(t.cand.item, t.cand.cls)) aiChecks += 1; else selfChecks += 1;
    } else if (isNewCls(t.cand.cls)) newItems += 1;
    else reviews += 1;
  }
  const leftSec = Math.round(fill.spent);
  const doneSec = Math.max(0, Math.round(Number(input.today ? input.today.doneSec : 0) || 0));

  // postponed (the fill may come from the scan of the day's start: count by subject id)
  const postponed: DayPlan['postponed'] = {};
  const notTaken = (list: Cand[]) => list.filter((c) => !fill.taken.has(c.item.id)).length;
  const put = (cls: Cls, n: number) => { if (n > 0) postponed[cls] = n; };
  const takenOf = (s: Subj, pick: (cls: Cls) => boolean) => fill.list.filter((t) => t.cand.s.id === s.id && pick(t.cand.cls)).length;
  put('relearn', notTaken(sc.buckets.relearn));
  put('confirm', notTaken(sc.buckets.confirm) + notTaken(sc.buckets.late));
  put('confirm_ai', notTaken(sc.buckets.confirm_ai));
  put('start_ai', notTaken(sc.buckets.start_ai));
  put('check', notTaken(sc.buckets.check));
  put('final', active.reduce((sum, s) => sum + Math.max(0, s.finalQuota - takenOf(s, (cls) => cls === 'final')), 0));
  put('new_floor', active.reduce((sum, s) => sum + Math.max(0, Math.min(s.floor, s.unseen.length) - takenOf(s, isNewCls)), 0));

  // feasibility, coverage, window
  const feas = feasibilityOf(sc);
  const dated = active.filter((s) => s.date !== null).sort((a, b) => dateRank(a) - dateRank(b) || a.index - b.index);
  const lead = dated.length > 0 ? dated[0] : null;
  const unseen = active.reduce((sum, s) => sum + s.unseen.length, 0);
  const coverage: DayPlan['coverage'] = {
    unseen,
    floor: active.reduce((sum, s) => sum + Math.min(s.floor, s.unseen.length), 0),
    lastNewDay: lead ? lead.lastNewDay : null,
    seenByDateEst: feas.seenByDateEst,
    neededMin: feas.neededMin,
  };
  const window: DayPlan['window'] = lead
    ? { from: lead.windowFrom, days: lead.w, inWindow: lead.phase === 'window' }
    : { from: null, days: 0, inWindow: false };

  // state
  const firstAt = input.today ? input.today.firstAt : null;
  const studied = sc.frozen || doneSec > 0 || sc.answeredToday > 0 || (typeof firstAt === 'number' && localDay(firstAt, tz) === today);
  let state: DayPlan['state'];
  if ((input.items ?? []).length === 0) state = 'empty';
  else if (active.length === 0) state = sc.subjects.some((s) => s.phase === 'exam_today') ? 'exam_today' : 'after';
  else if (fill.list.length > 0) state = 'study';
  else state = studied ? 'done' : 'nothing';

  // the next moment something becomes available
  let next: number | null = null;
  if (later.length > 0) next = Math.min(...later.map((t) => t.cand.from as number));
  else {
    for (const w of sc.waiting) if (w.from > now && (next === null || w.from < next)) next = w.from;
    for (const d of sc.dueLater) if (d > now && (next === null || d < next)) next = d;
  }

  // figure
  const figure = { ...sc.figure };
  const fc = figure.twoDays === 0 ? firstCount(sc, fill) : null;

  // per subject
  const perSubject: DayPlan['perSubject'] = sc.subjects.map((s) => {
    const mine = fill.list.filter((t) => t.cand.s.id === s.id);
    const f = sc.subjectFigure.get(s.id) as Fig;
    return {
      subjectId: s.id,
      estSec: Math.round(mine.reduce((sum, t) => sum + t.cost, 0)),
      items: mine.length,
      figure: { inPlan: f.inPlan, twoDays: f.twoDays, seen: f.seen, errors: f.errors },
    };
  });

  // lines (rendered by words.ts)
  const lines: PlanLine[] = [];
  if (state === 'exam_today') {
    const errors = sc.subjects.filter((s) => s.phase === 'exam_today')
      .reduce((sum, s) => sum + (sc.subjectFigure.get(s.id) as Fig).errors, 0);
    lines.push({ key: 'exam_today', n: [errors] });
    if (errors > 0) lines.push({ key: 'exam_errors', n: [Math.min(SESSION_SIZE.answer, errors)] });
  }
  if (state === 'after') {
    const last = sc.subjects.reduce<LocalDay | null>((acc, s) => laterDay(acc, s.date), null);
    if (last !== null) lines.push({ key: 'after', day: last });
  }
  if (active.length > 0) {
    if (state === 'study' && !studied && sc.lastStudyDay !== null) {
      const gap = daysBetween(sc.lastStudyDay, today) - 1;
      if (gap >= 1) lines.push({ key: 'skip', n: [gap, Math.round(Number(input.budgetMin) || 0)] });
    }
    if (later.length > 0) {
      lines.push({ key: 'later', n: [later.length], time: clockText(next as number, tz, TIME_STEP_MIN) });
    }
    const dates = new Set(active.map((s) => s.date));
    if (lead && dates.size === 1 && lead.w > 0) {
      if (lead.phase === 'window') lines.push({ key: 'window_in', n: [lead.daysLeft as number] });
      else if (lead.windowFrom !== null) lines.push({ key: 'window_ahead', n: [lead.w], day: lead.windowFrom });
    }
    if (lead && unseen > 0 && feas.seenByDateEst < feas.total) {
      const lastDate = dated.reduce<LocalDay | null>((acc, s) => laterDay(acc, s.date), null) as LocalDay;
      const budgetMin = Math.round(Number(input.budgetMin) || 0);
      if (feas.neededMin > 90 && budgetMin >= 90) lines.push({ key: 'short_max', n: [budgetMin, feas.seenByDateEst, feas.total], day: lastDate });
      else lines.push({ key: 'short', n: [budgetMin, feas.seenByDateEst, feas.total, feas.neededMin], day: lastDate });
    }
    if (active.some((s) => s.date === null)) lines.push({ key: 'no_date', n: [NO_DATE_NEW_PER_DAY] });
    if (oral > 0) lines.push({ key: 'oral', n: [selfChecks, aiChecks, fill.unitsPoints + fill.unitsChecks] });
    if (fill.aiBlocked && input.ai) lines.push({ key: 'ai_limit', time: clockText(input.ai.resetsAt, tz) });
    if (fc) lines.push(fc.time === null ? { key: 'first_count', n: [offsetDay(today, fc.day)], day: fc.day }
      : { key: 'first_count', n: [offsetDay(today, fc.day)], day: fc.day, time: fc.time });
    if (state === 'study' && figure.seen < 20) lines.push({ key: 'first_day' });
  }
  if (state === 'done') lines.push({ key: 'done', n: [sc.answeredToday, Math.max(doneSec > 0 ? 1 : 0, minutesOf(doneSec))] });
  if (state === 'nothing') {
    const anyWork = unseen > 0 || Object.keys(postponed).length > 0;
    const nextDay = anyWork ? addDays(today, 1) : next === null ? null : laterDay(localDay(next, tz), addDays(today, 1));
    lines.push(nextDay === null ? { key: 'nothing' } : { key: 'nothing', n: [offsetDay(today, nextDay)], day: nextDay });
  }
  if (state === 'done' || state === 'nothing') {
    const more = extraNewOf(sc, SESSION_SIZE.answer);
    if (more) lines.push({ key: 'more_new', n: [more.ids.length] });
  }

  return {
    day: today,
    state,
    sessions,
    counts: { newItems, reviews, oral, aiChecks, estSec: Math.round(fill.charge + fill.spent), leftSec, doneSec },
    postponed,
    coverage,
    window,
    units: sc.hasOral ? { points: fill.unitsPoints, checks: fill.unitsChecks } : null,
    figure,
    perSubject,
    next,
    firstCountDay: fc ? fc.day : null,
    lines,
  };
}

// ───────────────────────────────────────────── feasibility ─────────────────────────────────────────────

function feasibilityOf(sc: Scan): { neededMin: number; option: 30 | 45 | 60 | 90 | null; seenByDateEst: number; total: number } {
  const input = sc.input;
  const budgetSec = Math.max(0, Number(input.budgetMin) || 0) * 60;
  const active = activeSubjects(sc);
  let perDay = 0;
  let total = 0;
  const rows: Array<{ s: Subj; perDay: number; days: number; backlog: number; wAvg: number }> = [];
  for (const s of active) {
    const p = s.pace;
    const extra = p.tWrong + RETRY_FACTOR * p.tRetry;
    const pRev = (p.pWrong.confirm + p.pWrong.check) / 2;
    const k = Math.min(3, Math.max(2, 1.6 + 4 * pRev));
    const tNewP = (item: PlanItem) => p.tNew * (item.slow ? SLOW_NEW_FACTOR : 1) + p.pWrong.new * extra;
    const tRevP = (item: PlanItem) => p.tRev * (item.slow ? SLOW_REV_FACTOR : 1) + pRev * extra;
    let newWork = 0;
    for (const item of s.unseen) newWork += item.f === 'o' ? 2.5 * p.tSC + 2 * p.tAC : tNewP(item) + k * tRevP(item);
    let backlog = s.backlogOral.length * (p.tSC + 1.5 * p.tAC);
    for (const item of s.backlogTest) backlog += 2 * tRevP(item);
    const wAvg = s.unseen.length > 0 ? newWork / s.unseen.length : 0;
    total += s.inPlan;
    if (s.date === null) {
      perDay += Math.min(NO_DATE_NEW_PER_DAY, s.unseen.length) * wAvg;
      continue;
    }
    const days = Math.max(1, s.daysLeft ?? 1);
    const need = (newWork + backlog) / days;
    perDay += need;
    rows.push({ s, perDay: need, days, backlog, wAvg });
  }
  const neededMin = ceil5(perDay / 60);
  const option = (BUDGET_OPTIONS.find((o) => o >= neededMin) ?? null) as 30 | 45 | 60 | 90 | null;
  let seenByDateEst = total;
  if (neededMin > (Number(input.budgetMin) || 0) && perDay > 0) {
    seenByDateEst = 0;
    for (const s of active) {
      const row = rows.find((r) => r.s === s);
      if (!row) { seenByDateEst += s.inPlan; continue; }
      const share = budgetSec * (row.perDay / perDay);
      const seeable = row.wAvg > 0 ? Math.max(0, share * row.days - row.backlog) / row.wAvg : s.unseen.length;
      seenByDateEst += s.seenNow + Math.min(s.unseen.length, Math.floor(seeable));
    }
    seenByDateEst = Math.min(total, seenByDateEst);
    if (seenByDateEst < total && seenByDateEst >= 100) seenByDateEst = Math.floor(seenByDateEst / 10) * 10;
  }
  return { neededMin, option, seenByDateEst, total };
}

/** Minutes a day needed to see everything by the date at the student's pace, the smallest fitting option, and how many they would see at the current budget. */
export function feasibility(input: PlanInput): { neededMin: number; option: 30 | 45 | 60 | 90 | null; seenByDateEst: number } {
  const f = feasibilityOf(scan(input));
  return { neededMin: f.neededMin, option: f.option, seenByDateEst: f.seenByDateEst };
}

// ───────────────────────────────────────────── helpers for the screens ─────────────────────────────────────────────

function extraNewOf(sc: Scan, count: number, exclude?: ReadonlySet<string>): { subjectId: string; ids: string[] } | null {
  const candidates = activeSubjects(sc)
    .filter((s) => s.phase === 'study' && (s.date === null || (s.lastNewDay !== null && sc.today <= s.lastNewDay)))
    .sort((a, b) => dateRank(a) - dateRank(b) || a.index - b.index);
  for (const s of candidates) {
    const ids = s.unseen.filter((item) => !exclude || !exclude.has(item.id)).slice(0, count).map((item) => item.id);
    if (ids.length > 0) return { subjectId: s.id, ids };
  }
  return null;
}

/**
 * «Ещё 20 новых» after the day's target: the next new questions in plan order, of one subject (the nearest date
 * that still takes new questions). They count in tomorrow's `newDone`, so tomorrow asks for fewer new ones.
 */
export function extraNew(input: PlanInput, count = SESSION_SIZE.answer, plan?: DayPlan): { subjectId: string; ids: string[] } | null {
  const exclude = plan ? new Set(plan.sessions.flatMap((s) => s.ids)) : undefined;
  return extraNewOf(scan(input), count, exclude);
}

export interface SubjectInfo {
  subjectId: string;
  date: LocalDay | null;
  phase: 'no_date' | 'study' | 'window' | 'exam_today' | 'after';
  daysLeft: number | null;
  window: DayPlan['window'];
  lastNewDay: LocalDay | null;
  /** The subject page's own lines (window, exam day, after the date, no date), rendered by words.ts `lineText`. */
  lines: PlanLine[];
}

/** One subject's dates and phase today, with its lines (several dates in one exam: each subject says its own). */
export function subjectInfo(input: PlanInput, subjectId: string): SubjectInfo | null {
  const sc = scan(input);
  const s = sc.byId.get(subjectId);
  if (!s) return null;
  const lines: PlanLine[] = [];
  const phase: SubjectInfo['phase'] = s.date === null ? 'no_date' : s.phase;
  if (phase === 'no_date') lines.push({ key: 'no_date', n: [NO_DATE_NEW_PER_DAY] });
  else if (phase === 'window') lines.push({ key: 'window_in', n: [s.daysLeft as number] });
  else if (phase === 'study' && s.w > 0 && s.windowFrom !== null) lines.push({ key: 'window_ahead', n: [s.w], day: s.windowFrom });
  else if (phase === 'exam_today') {
    const errors = (sc.subjectFigure.get(s.id) as Fig).errors;
    lines.push({ key: 'exam_today', n: [errors] });
    if (errors > 0) lines.push({ key: 'exam_errors', n: [Math.min(SESSION_SIZE.answer, errors)] });
  } else if (phase === 'after' && s.date !== null) lines.push({ key: 'after', day: s.date });
  return {
    subjectId, date: s.date, phase, daysLeft: s.daysLeft,
    window: { from: s.windowFrom, days: s.w, inWindow: s.phase === 'window' },
    lastNewDay: s.lastNewDay, lines,
  };
}

export interface DayRow { from: LocalDay; to: LocalDay; kind: 'study' | 'window' | 'exam'; minutes: number | null; subjectIds: string[] }

/**
 * «План по дням»: today to the last date, equal days grouped — study days with about the minutes a day, the final
 * window without a promised number of minutes (decision 39), and each exam day.
 */
export function daysAhead(input: PlanInput): DayRow[] {
  const sc = scan(input);
  const dated = sc.subjects.filter((s) => s.date !== null && (s.daysLeft as number) >= 0);
  if (dated.length === 0) return [];
  const feas = feasibilityOf(sc);
  const budget = Math.round(Number(input.budgetMin) || 0);
  const perDay = feas.neededMin > 0 ? Math.min(budget, feas.neededMin) : null; // null: familiar questions only
  const lastDate = dated.reduce<LocalDay>((acc, s) => ((s.date as LocalDay) > acc ? (s.date as LocalDay) : acc), sc.today);
  const rows: DayRow[] = [];
  for (let day = sc.today; day <= lastDate; day = addDays(day, 1)) {
    const exams = sc.subjects.filter((s) => s.date === day).map((s) => s.id);
    if (exams.length > 0) { rows.push({ from: day, to: day, kind: 'exam', minutes: null, subjectIds: exams }); continue; }
    const open = sc.subjects.filter((s) => s.date === null || (s.date as LocalDay) > day);
    if (open.length === 0) continue;
    const takesNew = open.some((s) => s.date === null || (s.lastNewDay !== null && day <= s.lastNewDay));
    const kind: DayRow['kind'] = takesNew ? 'study' : 'window';
    const minutes = kind === 'study' ? perDay : null;
    const ids = open.map((s) => s.id);
    const prev = rows[rows.length - 1];
    if (prev && prev.kind === kind && prev.minutes === minutes && prev.to === addDays(day, -1) && prev.subjectIds.join() === ids.join()) prev.to = day;
    else rows.push({ from: day, to: day, kind, minutes, subjectIds: ids });
  }
  return rows;
}

/**
 * «Как на экзамене» is offered (Concept 2 §3.9): from the day half the questions are seen, then every 4th day, and on
 * the first day of the final window; at most once a day.
 */
export function mockOffered(args: { day: LocalDay; seen: number; inPlan: number; lastRunDay: LocalDay | null; windowFrom: LocalDay | null }): boolean {
  if (args.lastRunDay !== null && args.lastRunDay >= args.day) return false;
  if (args.windowFrom !== null && args.windowFrom === args.day && args.seen > 0) return true;
  if (args.inPlan <= 0 || args.seen * 2 < args.inPlan) return false;
  return args.lastRunDay === null || daysBetween(args.lastRunDay, args.day) >= 4;
}

/**
 * Oral questions whose points should be written now (spec §6: along the plan, one day ahead): today's planned oral
 * questions without points, then as many of the next new ones per subject.
 */
export function oralToPrepare(input: PlanInput, plan: DayPlan): string[] {
  const byId = new Map((input.items ?? []).map((item) => [item.id, item] as const));
  const out: string[] = [];
  const planned = new Set<string>();
  const perSubject = new Map<string, number>();
  for (const session of plan.sessions) {
    for (const id of session.ids) {
      const item = byId.get(id);
      if (!item || item.f !== 'o') continue;
      planned.add(id);
      if (!(item.m ?? NO_META).prepared) {
        out.push(id);
        perSubject.set(item.s, (perSubject.get(item.s) ?? 0) + 1);
      }
    }
  }
  const sc = scan(input);
  setFloors(sc);
  for (const s of activeSubjects(sc)) {
    const ahead = perSubject.get(s.id) ?? 0;
    if (ahead === 0) continue;
    const next = s.unseen.filter((item) => item.f === 'o' && !planned.has(item.id) && !(item.m ?? NO_META).prepared).slice(0, ahead);
    for (const item of next) out.push(item.id);
  }
  return out;
}
