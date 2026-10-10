// Synthetic plan inputs for the bot's tests and snapshots: the spec's invented exam «Осенняя сессия» (3 ноября,
// 4 предмета, 960 вопросов; today is Friday, 16 October 2026; the zone is Europe/Minsk). Nothing here comes from a
// real bank: the ids are made up and there is no question text (the card only needs states).
import type { PlanInputsWire, PlanItemRow, PlanStateRow } from '../../plan/container.ts';
import type { Link, Today } from '../db.ts';

export const TZ = 'Europe/Minsk';
export const DAY = '2026-10-16';
/** 20:00 in Minsk on Friday, 16 October 2026 (UTC+3). */
export const NOW = Date.UTC(2026, 9, 16, 17, 0, 0);
export const CID = 'a1b2c3d4-0000-4000-8000-000000000001';
export const CID2 = 'a1b2c3d4-0000-4000-8000-000000000002';
export const TITLE = 'Осенняя сессия';
export const TITLE2 = 'Зимняя сессия';
export const SUBJECTS = ['Компьютерные сети', 'Базы данных', 'Операционные системы', 'Основы программирования'];
export const SUBJECT_IDS = SUBJECTS.map((_, i) => `b1b2c3d4-0000-4000-8000-00000000010${i + 1}`);
export const TG = 700100;
export const USER = 'c1c2c3d4-0000-4000-8000-000000000001';

const sec = (ms: number) => Math.floor(ms / 1000);
const H = 3_600_000;
const D = 24 * H;

export function itemId(container: number, n: number): string {
  return `d${container}d2c3d4-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

export interface ExamSpec {
  id: string;
  title: string;
  date: string | null;
  firstPlanDay?: string;
  role?: 'owner' | 'member';
  subjects?: number;
  perSubject?: number;
  minutes?: number;
  /** Items in «верно в два разных дня» (spread across subjects). */
  twoDays?: number;
  /** Open mistakes (last answer wrong, yesterday). */
  errors?: number;
  /** Started series from two days ago (countable now). */
  started?: number;
  /** Answered today (first seen today). */
  answeredToday?: number;
  /** The day offset of the last answers of the seen items (−1 yesterday; −2 skipped yesterday). */
  lastDay?: number;
  today?: { firstAt: number | null; doneSec: number };
}

/** One exam's part of the wire (items in subject blocks, states by the counts asked). */
function examParts(spec: ExamSpec, containerIndex: number, subjectBase: number, nowMs: number) {
  const subjects = spec.subjects ?? 4;
  const per = spec.perSubject ?? 240;
  const items: PlanItemRow[] = [];
  const states: Array<[number, PlanStateRow]> = [];
  const wireSubjects: PlanInputsWire['subjects'] = [];
  for (let s = 0; s < subjects; s += 1) {
    wireSubjects.push({
      id: containerIndex === 0 ? SUBJECT_IDS[s] : `e${containerIndex}e2c3d4-0000-4000-8000-00000000010${s + 1}`,
      container: containerIndex,
      title: containerIndex === 0 ? SUBJECTS[s] : `Предмет ${s + 1}`,
      test_date: spec.date,
      oral_exam_id: null,
      topics: 3,
      new_today: 0,
    });
  }
  let n = 0;
  for (let s = 0; s < subjects; s += 1) {
    for (let i = 0; i < per; i += 1) {
      n += 1;
      items.push([itemId(containerIndex, n), subjectBase + s, (i % 3) + 1, i + 1, 0, 1, 0]);
    }
  }
  const last = spec.lastDay ?? -1;
  const order = items.map((_, index) => index);
  // Interleave subjects: item k of each subject in turn, so every count spreads over the subjects.
  order.sort((a, b) => (a % per) - (b % per) || a - b);
  let k = 0;
  const take = (count: number, make: (index: number) => PlanStateRow) => {
    for (let c = 0; c < count && k < order.length; c += 1, k += 1) states.push([order[k], make(order[k])]);
  };
  const named = sec(nowMs - 3 * D);
  take(spec.twoDays ?? 0, (i) => [i, 3, 0, -9, last, 0, -9, sec(nowMs - 9 * D), named, named, 0, null, 0, named]);
  take(spec.errors ?? 0, (i) => [i, 2, 1, -6, last, 1, null, null, null, null, 0, last, 0, null]);
  take(spec.started ?? 0, (i) => [i, 1, 0, Math.min(-2, last), Math.min(-2, last), 0, Math.min(-2, last), sec(nowMs + Math.min(-2, last) * D), null, null, 0, null, 0, sec(nowMs + Math.min(-2, last) * D)]);
  take(spec.answeredToday ?? 0, (i) => [i, 1, 0, 0, 0, 0, 0, sec(nowMs - 2 * H), null, null, 0, null, 0, sec(nowMs - 2 * H)]);
  return { items, states, wireSubjects };
}

/** A wire with one or more exams (indices of items and subjects shift per exam, as plan_inputs_for gives them). */
export function wireOf(specs: ExamSpec[], nowMs = NOW): PlanInputsWire {
  const containers: PlanInputsWire['containers'] = [];
  const subjects: PlanInputsWire['subjects'] = [];
  const items: PlanItemRow[] = [];
  const states: PlanStateRow[] = [];
  specs.forEach((spec, index) => {
    const parts = examParts(spec, index, subjects.length, nowMs);
    const offset = items.length;
    containers.push({
      id: spec.id,
      title: spec.title,
      exam_date: spec.date,
      role: spec.role ?? 'member',
      first_plan_day: spec.firstPlanDay ?? '2026-10-05',
      answers_today: spec.answeredToday ?? 0,
      settings: { minutes_per_day: spec.minutes ?? 45, study_weekdays: 127 },
      today: { first_at: spec.today?.firstAt ?? null, done_s: spec.today?.doneSec ?? 0 },
    });
    subjects.push(...parts.wireSubjects);
    items.push(...parts.items);
    for (const [i, row] of parts.states) {
      const copy = [...row] as PlanStateRow;
      copy[0] = offset + i;
      states.push(copy);
    }
    // new_today per subject: the items first answered today
    if (spec.answeredToday) {
      const per = Math.ceil(spec.answeredToday / parts.wireSubjects.length);
      for (const s of parts.wireSubjects) s.new_today = per;
    }
  });
  return { v: 1, day: dayOf(nowMs), now: sec(nowMs), containers, subjects, items, states, doubted: [], pace: [], ai: null };
}

function dayOf(ms: number): string {
  // Minsk is UTC+3 all year.
  return new Date(ms + 3 * H).toISOString().slice(0, 10);
}

export function linkOf(overrides: Partial<Link> = {}, nowMs = NOW): Link {
  const minutes = new Date(nowMs + 3 * H).getUTCHours() * 60 + new Date(nowMs + 3 * H).getUTCMinutes();
  return {
    tgUserId: TG, chatId: TG, blocked: false, remindOn: true, remindAt: 20 * 60, tz: TZ, pausedUntil: null, prompt: null,
    today: dayOf(nowMs), localTime: minutes, now: nowMs, ...overrides,
  };
}

export function todayOf(specs: ExamSpec[] | null, extra: Partial<Today> = {}, nowMs = NOW): Today {
  return {
    link: linkOf({}, nowMs),
    now: nowMs,
    wire: specs ? wireOf(specs, nowMs) : null,
    exams: (specs ?? []).map((s, i) => ({ id: s.id, createdAt: `2026-10-0${i + 1}T10:00:00Z`, keyChanges: 0, hasOral: false })),
    session: null,
    day: null,
    ...extra,
  };
}

/** The standard Friday: 143 in the figure, 37 open mistakes, 230 started, the rest new; 3 November; 45 minutes. */
export const AUTUMN: ExamSpec = { id: CID, title: TITLE, date: '2026-11-03', twoDays: 143, errors: 37, started: 230 };
