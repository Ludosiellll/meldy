/**
 * The oral part of the day plan, pure (package T11 over D1's oralPlan.ts; spec decision 35; Concept 2 §2.1, §2.8): an
 * oral exam's cheat sheet and journal events in, its questions as plan items out. No network, no storage, no clock: the
 * site (oralPlan.ts `loadOralPlanItems`, over GET /api/oral/sheet and its journal reads) and the Telegram bot (over
 * `bot_oral_inputs`, the same reads in SQL) run this same code, so both plan the same oral questions. Imports only the
 * cheat sheet's pure rules (lib/exams/cheatSheet.ts with lib/learning/readiness.ts), the sheet's parser
 * (lib/exams/sheetResponse.ts), time.ts and types: it loads with `node --experimental-strip-types`, as the bot's copy
 * in supabase/functions/_shared/plan/ does.
 *
 * Which questions are in the plan (Concept 2 §2.1: «in the lectures and its points are written or can be written»):
 * - written points (block `lines`): `prepared`, with the deciding lines — the essential points, or every point when
 *   none is essential — as `UnitState`s;
 * - in the lectures, points not written yet (`unwritten`, `rebuilt`: the sheet can write them now): in the plan,
 *   not `prepared`, no lines — the plan asks for their points (spec §6);
 * - everything else waits for lectures and is left out (spec decision 35: «Ещё 60 устных войдут в план, когда к
 *   предмету будут лекции»): not checked against lectures yet (`unmapped`), checked by words only (`unverified`),
 *   not in the lectures or nothing to quote (`gap`). They are counted in `withoutPoints`.
 *
 * The local day. The sheet reads its lines on the device's day of `now` (cheatSheet.ts `localDayOf`, the browser's
 * zone, as on the oral page); the site plans in that same zone (hooks.ts `deviceZone()`). A caller in another zone (the
 * bot runs in UTC and plans in the link's zone) passes `today`, the local day of the plan's zone: the lines are then read
 * as on a device whose day is `today` — the day logic of the sheet compares local days only with each other and with
 * the exam's date, so every local day it sees (the events' and the exam's) is moved by the same number of days, and the
 * lines' days are moved back. Moments are never moved.
 */
import { buildSheet, localDayOf, type LineStatus, type SheetBlock, type SheetQuestion } from '../exams/cheatSheet.ts';
import { parseSheetResponse } from '../exams/sheetResponse.ts';
import type { LearningEvent } from '../../types/learning.ts';
import type { LocalDay, OralMeta, PlanInput, PlanItem, UnitState, Uuid } from '../../types/container.ts';
import { addDays, daysBetween, isLocalDay } from './time.ts';

export interface OralPlanPart {
  examId: Uuid;
  subjectId: Uuid;
  items: PlanItem[];
  withoutPoints: number; // oral questions waiting for lectures
  /** The oral exam's own date (its exams row is the only owner of an oral date); null when it has none or is unknown. */
  examDate?: string | null;
}

/** The sheet's blocks whose questions are in the plan. */
export const IN_PLAN: ReadonlySet<SheetBlock['kind']> = new Set(['lines', 'unwritten', 'rebuilt']);

function later(a: string | null, b: string): string {
  return a === null || b > a ? b : a;
}

function moment(iso: string | null | undefined): number | null {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

/**
 * One line's state as the rule's `UnitState` (the same fields a test item has), read off the cheat sheet's own verdict
 * (`lineStatus`): its state, the naming that erased it, the latest naming and the checks passed come from the sheet;
 * the history (checked answers, oldest first) gives the counts, the days and the start of the current series. A miss
 * shows the points, so its day is a peek day, as a test item's «Не знаю» is; a line uncovered today is one too.
 */
export function unitFromLine(status: LineStatus, today: string): UnitState {
  let seen = 0;
  let wrong = 0;
  let firstDay: string | null = null;
  let lastDay: string | null = null;
  let peekDay: string | null = null;
  let cleanOkAt: number | null = null;
  let lastMiss = -1;
  status.history.forEach((event, index) => {
    seen += 1;
    if (event.date) {
      if (firstDay === null || event.date < firstDay) firstDay = event.date;
      lastDay = later(lastDay, event.date);
    }
    if (event.outcome === 'missed') {
      wrong += 1;
      lastMiss = index;
      if (event.date) peekDay = later(peekDay, event.date);
    } else if (event.outcome === 'skipped') {
      // Named after the line was uncovered that day: a peek day (the naming did not count).
      if (event.date) peekDay = later(peekDay, event.date);
    } else {
      cleanOkAt = moment(event.at) ?? cleanOkAt;
    }
  });
  if (status.peekedToday) {
    peekDay = later(peekDay, today);
    lastDay = later(lastDay, today);
    firstDay = firstDay ?? today;
  }
  const unit: UnitState = {
    seen,
    wrong,
    firstDay,
    lastDay,
    seriesAt: null,
    seriesDay: null,
    twoDaysAt: null,
    namedAt: null,
    checks: 0,
    peekDay,
    wasTwoDays: status.state === 'returned' || status.wasErasedOn !== null,
    cleanOkAt,
  };
  const series = status.history.slice(lastMiss + 1).filter((event) => event.outcome === 'named');
  const start = series[0];
  if (status.state === 'rubbed' || status.state === 'erased' || status.state === 'due') {
    unit.seriesAt = start ? moment(start.at) : null;
    unit.seriesDay = start?.date || null;
  }
  if (status.state === 'rubbed') {
    unit.namedAt = series.length > 0 ? moment(series[series.length - 1].at) : null;
  } else if (status.state === 'erased' || status.state === 'due') {
    unit.twoDaysAt = moment(status.erasedAt);
    unit.namedAt = moment(status.lastNamedAt);
    unit.checks = status.checks;
  }
  return unit;
}

/** The last self-check («знаю · плаваю · не знаю») and the last AI check of a question, from its journal events. */
export function oralMeta(questionHash: string, events: readonly LearningEvent[], prepared: boolean): OralMeta {
  const key = `q:${questionHash}`;
  let sc: string | null = null;
  let rating: OralMeta['rating'] = 0;
  let ac: string | null = null;
  let scAt = '';
  let acAt = '';
  for (const event of events) {
    if (!event || event.item_key !== key) continue;
    if (event.kind === 'self_rating' && event.confidence && event.created_at >= scAt) {
      scAt = event.created_at;
      sc = event.local_date || sc;
      rating = event.confidence;
    } else if (event.kind === 'exam_answer' && event.created_at >= acAt) {
      acAt = event.created_at;
      ac = event.local_date || ac;
    }
  }
  return { sc, rating, ac, prepared };
}

/** The deciding lines of a block: its essential points, or every point when none is essential (Concept 2 §2.1). */
export function decidingLines(block: SheetBlock): SheetBlock['lines'] {
  const essential = block.lines.filter((line) => line.essential);
  return essential.length > 0 ? essential : block.lines;
}

export interface OralDayOptions {
  /**
   * The local day ('YYYY-MM-DD') the lines are read on: the plan's day in the plan's zone (time.ts `localDay(now, tz)`).
   * Without it (the site) the device's day of `now`. Only the days move; with it, `erasableFrom` of the lines is not
   * meaningful (the plan never reads it).
   */
  today?: LocalDay;
}

/** The first step of a part: the sheet read on a day, which questions are in the plan and whose events they need. */
export interface OralSheetPlan {
  /** The questions in the plan, in the sheet's order, with their blocks (the lines' states as read on `today`). */
  planned: Array<{ question: SheetQuestion; block: SheetBlock }>;
  /** Oral questions waiting for lectures. */
  withoutPoints: number;
  /** The planned questions' hashes, in their order: their self-checks and AI checks (fetchQuestionEvents) are needed. */
  metaHashes: string[];
  /** The local day the lines were read on. */
  today: LocalDay;
}

function shiftDay(day: string, by: number): string {
  return by !== 0 && isLocalDay(day) ? addDays(day, by) : day;
}

/** The status read with every local day moved by `by` days, moved back (moments stay). */
function shiftedBack(status: LineStatus, by: number): LineStatus {
  return {
    ...status,
    history: status.history.map((event) => ({ ...event, date: shiftDay(event.date, -by) })),
    erasedOn: status.erasedOn === null ? null : shiftDay(status.erasedOn, -by),
    wasErasedOn: status.wasErasedOn === null ? null : shiftDay(status.wasErasedOn, -by),
  };
}

/**
 * The sheet read on a day: the cheat sheet's own blocks (buildSheet over the line events, with the exam's date for the
 * last days before it) and the questions in the plan. `lineEvents` are the oral_point and sheet_peek events of the
 * written questions (fetchSheetEvents over sheetHashes).
 */
export function oralSheetPlan(
  sheet: { questions: readonly SheetQuestion[] },
  lineEvents: readonly LearningEvent[],
  now: number,
  examDate: string | null,
  options: OralDayOptions = {},
): OralSheetPlan {
  const deviceDay = localDayOf(now);
  const today = typeof options.today === 'string' && isLocalDay(options.today) ? options.today : deviceDay;
  const shift = today !== deviceDay && isLocalDay(deviceDay) ? daysBetween(today, deviceDay) : 0;
  const events =
    shift === 0 ? lineEvents : lineEvents.map((event) => (event ? { ...event, local_date: shiftDay(event.local_date, shift) } : event));
  const built = buildSheet(sheet.questions, events, now, { examDate: examDate === null ? null : shiftDay(examDate, shift) });
  const questions = new Map<string, SheetQuestion>(sheet.questions.map((question) => [question.question_id, question]));

  const planned: Array<{ question: SheetQuestion; block: SheetBlock }> = [];
  let withoutPoints = 0;
  for (const block of built.blocks) {
    const question = questions.get(block.questionId);
    if (!question) continue;
    if (!IN_PLAN.has(block.kind)) {
      withoutPoints += 1;
      continue;
    }
    planned.push({
      question,
      block: shift === 0 ? block : { ...block, lines: block.lines.map((line) => ({ ...line, status: shiftedBack(line.status, shift) })) },
    });
  }
  const metaHashes = planned.map(({ question }) => question.question_hash).filter((hash) => hash !== '');
  return { planned, withoutPoints, metaHashes, today };
}

/** The second step: the planned questions as plan items, with their last self-check and AI check (`metaEvents`). */
export function oralPlanItems(subjectId: Uuid, plan: OralSheetPlan, metaEvents: readonly LearningEvent[]): PlanItem[] {
  return plan.planned.map(({ question, block }) => {
    const prepared = block.kind === 'lines';
    return {
      id: question.question_id,
      s: subjectId,
      f: 'o',
      tp: question.section,
      o: question.position,
      l: prepared ? decidingLines(block).map((line) => unitFromLine(line.status, plan.today)) : [],
      m: oralMeta(question.question_hash, metaEvents, prepared),
    };
  });
}

/**
 * One oral part (one exam) of the plan: its questions as plan items and the count of those waiting for lectures. The
 * site's loadOralPlanItems runs the same two steps around its reads; the bot calls this with the reads of
 * `bot_oral_inputs` and `today` = the local day of its plan.
 */
export function oralPlanPart(
  part: { examId: Uuid; subjectId: Uuid },
  examDate: string | null,
  now: number,
  sheet: { questions: readonly SheetQuestion[] },
  lineEvents: readonly LearningEvent[],
  metaEvents: readonly LearningEvent[],
  options: OralDayOptions = {},
): OralPlanPart {
  const plan = oralSheetPlan(sheet, lineEvents, now, examDate, options);
  const items = oralPlanItems(part.subjectId, plan, metaEvents);
  return { examId: part.examId, subjectId: part.subjectId, items, withoutPoints: plan.withoutPoints, examDate };
}

/**
 * A subject with only an oral part in the plan takes its oral exam's date (spec §3 «Даты»: the exams row is the only
 * owner of an oral date); a subject with test items keeps its own (the subject's, else the exam's common one). The rule
 * of hooks.ts `buildData`, for a caller that builds the plan input itself (the bot): apply it to decodePlanInputs' result.
 */
export function withOralDates(input: PlanInput, parts: ReadonlyArray<Pick<OralPlanPart, 'subjectId' | 'examDate'>>): PlanInput {
  const withTests = new Set(input.items.filter((item) => item.f === 't').map((item) => item.s));
  const oralDates = new Map<string, string | null | undefined>(parts.map((part) => [part.subjectId, part.examDate]));
  return {
    ...input,
    subjects: input.subjects.map((subject) => {
      const oralDate = oralDates.get(subject.id);
      return !withTests.has(subject.id) && oralDate ? { ...subject, date: oralDate } : subject;
    }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The journal rows of one list (the SQL gives them as the site's reads normalise them: api/learning.ts normalizeEvent). */
function eventsOf(value: unknown): LearningEvent[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (row): row is LearningEvent =>
      isRecord(row) && typeof row.id === 'string' && typeof row.item_key === 'string' && typeof row.kind === 'string',
  );
}

/**
 * The oral parts of `public.bot_oral_inputs` (the bot's reads, the same as the site's: one part per oral exam of the
 * user's exams, `{exam_id, subject_id, exam_date, sheet, line_events, meta_events, capped}`) as the plan's parts, in
 * their order. As loadOralPlanItems: a part without an exam or a subject is skipped, an exam is read once (the first
 * part wins). A part the bot cannot plan is left out (its subject then has no oral items): `capped` (more questions
 * than the bot reads), or a sheet the parser rejects. `today`: the plan's local day (see OralDayOptions).
 */
export function oralPartsFromInputs(raw: unknown, now: number, options: OralDayOptions = {}): OralPlanPart[] {
  const entries = isRecord(raw) && Array.isArray(raw.parts) ? raw.parts : [];
  const seen = new Set<string>();
  const parts: OralPlanPart[] = [];
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const examId = typeof entry.exam_id === 'string' ? entry.exam_id : '';
    const subjectId = typeof entry.subject_id === 'string' ? entry.subject_id : '';
    if (!examId || !subjectId || seen.has(examId)) continue;
    seen.add(examId);
    if (entry.capped === true || !isRecord(entry.sheet)) continue;
    let sheet: { questions: readonly SheetQuestion[] };
    try {
      sheet = parseSheetResponse(entry.sheet);
    } catch {
      continue;
    }
    const examDate = typeof entry.exam_date === 'string' && entry.exam_date ? entry.exam_date : null;
    parts.push(oralPlanPart({ examId, subjectId }, examDate, now, sheet, eventsOf(entry.line_events), eventsOf(entry.meta_events), options));
  }
  return parts;
}
