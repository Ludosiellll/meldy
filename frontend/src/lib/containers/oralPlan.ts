/**
 * Oral questions for the plan (package D1; spec §6, decision 35; Concept 2 §2.1, §2.8): for each oral part (an existing
 * exam), its questions as plan items with their deciding lines' states, built with the cheat sheet's own pure rules
 * (lib/exams/cheatSheet.ts buildSheet / lineStatus) over the existing reads (api/cheatSheet.ts fetchSheet,
 * api/learning.ts fetchSheetEvents / fetchQuestionEvents) — read only, no oral file changes. The same reads the oral
 * page and «Сегодня» make (components/exams/sheet/sheetCount.ts), so a line here is in the state the sheet shows.
 *
 * Which questions are in the plan (Concept 2 §2.1: «in the lectures and its points are written or can be written»):
 * - written points (block `lines`): `prepared`, with the deciding lines — the essential points, or every point when
 *   none is essential — as `UnitState`s;
 * - in the lectures, points not written yet (`unwritten`, `rebuilt`: the sheet can write them now): in the plan,
 *   not `prepared`, no lines — the plan asks for their points (spec §6);
 * - everything else waits for lectures and is left out (spec decision 35: «Ещё 60 устных войдут в план, когда к
 *   предмету будут лекции»): not checked against lectures yet (`unmapped`), checked by words only (`unverified`),
 *   not in the lectures or nothing to quote (`gap`). They are counted in `withoutPoints`.
 */
import { fetchSheet, SheetError } from '../../api/cheatSheet';
import { fetchQuestionEvents, fetchSheetEvents, LearningLoadError, type LearningEvent } from '../../api/learning';
import { ContainerApiError, CONTAINER_ERROR_TEXT } from '../../api/containers';
import { buildSheet, localDayOf, sheetHashes, type LineStatus, type SheetBlock, type SheetQuestion } from '../exams/cheatSheet';
import { supabase } from '../supabase';
import type { OralMeta, PlanItem, UnitState, Uuid } from '../../types/container';

export interface OralPlanPart {
  examId: Uuid;
  subjectId: Uuid;
  items: PlanItem[];
  withoutPoints: number; // oral questions waiting for lectures
  /** The oral exam's own date (its exams row is the only owner of an oral date); null when it has none or is unknown. */
  examDate?: string | null;
}

/** Oral exams read at the same time. */
const PARTS_IN_FLIGHT = 3;

const IN_PLAN: ReadonlySet<SheetBlock['kind']> = new Set(['lines', 'unwritten', 'rebuilt']);

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
function decidingLines(block: SheetBlock): SheetBlock['lines'] {
  const essential = block.lines.filter((line) => line.essential);
  return essential.length > 0 ? essential : block.lines;
}

/**
 * Without an answer from the server the part could not be read for lack of network: the sheet's fetch failed or timed
 * out (SheetError without a status), or the journal read got no code back (LearningLoadError without one).
 */
function oralError(error: unknown): ContainerApiError {
  if (error instanceof ContainerApiError) return error;
  const noAnswer =
    (error instanceof SheetError && error.status === null) || (error instanceof LearningLoadError && error.code === null);
  let offline = false;
  try {
    offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  } catch {
    offline = false;
  }
  return offline || noAnswer
    ? new ContainerApiError('network', CONTAINER_ERROR_TEXT.network, { status: 0 })
    : new ContainerApiError('unknown', CONTAINER_ERROR_TEXT.unknown, { detail: error instanceof Error ? error.message : null });
}

/** The oral exams' own dates (one read of the caller's own exams under RLS); unknown dates stay null. */
async function examDates(examIds: Uuid[]): Promise<Map<Uuid, string | null>> {
  const dates = new Map<Uuid, string | null>();
  try {
    const { data, error } = await supabase.from('exams').select('id, exam_date').in('id', examIds);
    if (error || !Array.isArray(data)) return dates;
    for (const row of data as Array<{ id?: unknown; exam_date?: unknown }>) {
      if (typeof row.id === 'string') dates.set(row.id, typeof row.exam_date === 'string' && row.exam_date ? row.exam_date : null);
    }
  } catch {
    // Without dates the last days before the exam are not applied: the sheet then reads as with no date.
  }
  return dates;
}

async function loadPart(part: { examId: Uuid; subjectId: Uuid }, examDate: string | null, now: number): Promise<OralPlanPart> {
  const sheet = await fetchSheet(part.examId);
  const hashes = sheetHashes(sheet.questions);
  const lineEvents = hashes.length > 0 ? await fetchSheetEvents(hashes) : [];
  const built = buildSheet(sheet.questions, lineEvents, now, { examDate });
  const questions = new Map<string, SheetQuestion>(sheet.questions.map((question) => [question.question_id, question]));

  const planned: Array<{ question: SheetQuestion; block: SheetBlock }> = [];
  let withoutPoints = 0;
  for (const block of built.blocks) {
    const question = questions.get(block.questionId);
    if (!question) continue;
    if (IN_PLAN.has(block.kind)) planned.push({ question, block });
    else withoutPoints += 1;
  }

  const metaHashes = planned.map(({ question }) => question.question_hash).filter((hash) => hash !== '');
  const metaEvents = metaHashes.length > 0 ? await fetchQuestionEvents(metaHashes, ['exam_answer', 'self_rating']) : [];
  const today = localDayOf(now);
  const items: PlanItem[] = planned.map(({ question, block }) => {
    const prepared = block.kind === 'lines';
    return {
      id: question.question_id,
      s: part.subjectId,
      f: 'o',
      tp: question.section,
      o: question.position,
      l: prepared ? decidingLines(block).map((line) => unitFromLine(line.status, today)) : [],
      m: oralMeta(question.question_hash, metaEvents, prepared),
    };
  });
  return { examId: part.examId, subjectId: part.subjectId, items, withoutPoints, examDate };
}

/**
 * The oral questions of these oral parts, one part per exam, in the given order. `now` is the moment the sheet is
 * built for; `tz` is the plan's zone (the sheet itself counts local days in the browser's zone, as on the oral page).
 * Throws ContainerApiError ('network' without an answer) when a part cannot be read: the caller keeps the last ones.
 */
export async function loadOralPlanItems(parts: Array<{ examId: Uuid; subjectId: Uuid }>, now: number, tz: string): Promise<OralPlanPart[]> {
  void tz;
  const seen = new Set<string>();
  const unique = parts.filter((part) => {
    if (!part?.examId || !part.subjectId || seen.has(part.examId)) return false;
    seen.add(part.examId);
    return true;
  });
  if (unique.length === 0) return [];
  const dates = await examDates(unique.map((part) => part.examId));
  const out: OralPlanPart[] = new Array(unique.length);
  let next = 0;
  let failure: unknown = null;
  const worker = async () => {
    while (next < unique.length && failure === null) {
      const index = next;
      next += 1;
      try {
        out[index] = await loadPart(unique[index], dates.get(unique[index].examId) ?? null, now);
      } catch (error) {
        if (failure === null) failure = error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARTS_IN_FLIGHT, unique.length) }, worker));
  if (failure !== null) throw oralError(failure);
  return out;
}
