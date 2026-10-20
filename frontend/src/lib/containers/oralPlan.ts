/**
 * Oral questions for the plan (package D1; spec §6, decision 35; Concept 2 §2.1, §2.8): for each oral part (an existing
 * exam), its questions as plan items with their deciding lines' states. The reads live here: the cheat sheet
 * (api/cheatSheet.ts fetchSheet), its journal events (api/learning.ts fetchSheetEvents / fetchQuestionEvents) and the
 * oral exams' dates — read only, no oral file changes, the same reads the oral page and «Сегодня» make
 * (components/exams/sheet/sheetCount.ts), so a line here is in the state the sheet shows. What is in the plan and how a
 * line becomes a `UnitState` is the pure core, oralParts.ts (package T11), which the Telegram bot runs over the same
 * reads in SQL (`bot_oral_inputs`); its names are re-exported here, so every import from this file keeps working.
 */
import { fetchSheet, SheetError } from '../../api/cheatSheet';
import { fetchQuestionEvents, fetchSheetEvents, LearningLoadError } from '../../api/learning';
import { ContainerApiError, CONTAINER_ERROR_TEXT } from '../../api/containers';
import { sheetHashes } from '../exams/cheatSheet';
import { yieldToMain } from '../idle';
import { supabase } from '../supabase';
import type { Uuid } from '../../types/container';
import { oralPlanItems, oralSheetPlan, type OralPlanPart } from './oralParts';

export { decidingLines, IN_PLAN, oralMeta, unitFromLine } from './oralParts';
export type { OralPlanPart } from './oralParts';

/** Oral exams read at the same time. */
const PARTS_IN_FLIGHT = 3;

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
  // Each exam's sheet is built in a task of its own (smoothness audit 20.10: «Сегодня» built them back to back).
  await yieldToMain();
  const plan = oralSheetPlan(sheet, lineEvents, now, examDate);
  const metaEvents = plan.metaHashes.length > 0 ? await fetchQuestionEvents(plan.metaHashes, ['exam_answer', 'self_rating']) : [];
  const items = oralPlanItems(part.subjectId, plan, metaEvents);
  return { examId: part.examId, subjectId: part.subjectId, items, withoutPoints: plan.withoutPoints, examDate };
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
