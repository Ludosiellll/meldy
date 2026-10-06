import { useEffect, useState } from 'react';
import { fetchSheetEvents, type LearningEvent } from '../../../api/learning';
import {
  buildSheet,
  changeSummary,
  quietReason,
  sheetChanges,
  sheetWithout,
  type ChangeSummary,
  type LineOptions,
  type QuietReason,
  type SheetQuestion,
} from '../../../lib/exams/cheatSheet';
import type { RubricResponse } from '../../../lib/oral/oralApi';

/**
 * What one saved answer changed on the cheat sheet, for the answer's protocol (spec 4.2): «На
 * шпаргалке: 2 строки стёрлись». The question's lines are its rubric (the one the answer was checked
 * against, the sheet's own), their states come from the question's journal with and without this
 * answer's events — the same comparison the sheet replays.
 */

interface AnsweredQuestion {
  id: string;
  position: number;
  label: string;
  text: string;
  question_hash: string;
  coverage: SheetQuestion['coverage'];
}

/** The question as a sheet of one: its rubric's points are the lines. */
export function answerSheetQuestion(question: AnsweredQuestion, response: RubricResponse): SheetQuestion {
  const rubric = response.rubric;
  return {
    question_id: question.id,
    position: question.position,
    label: question.label,
    section: null,
    text: question.text,
    question_hash: question.question_hash,
    coverage: question.coverage,
    coverage_method: null,
    coverage_reason: '',
    missing_note: '',
    rubric: {
      rubric_id: response.rubric_id ?? `answer-${question.id}`,
      built_at: null,
      coverage: rubric.coverage,
      coverage_note: rubric.coverage_note,
      materials: rubric.materials,
      points: rubric.coverage === 'none' ? [] : rubric.points.map((point) => ({
        id: point.id,
        title: point.title,
        short: '',
        essential: point.essential,
        source_quote: point.source_quote,
        source_ids: point.source_ids,
      })),
    },
  };
}

/** What an answer did on the sheet, and why nothing changed when nothing did. */
export interface AnswerChange {
  summary: ChangeSummary;
  quiet: QuietReason | null;
}

/**
 * The change of the answer `sessionId`, or null when the journal has none of its events yet.
 * `options.examDate`: the last days before the exam make lines due sooner, as on the sheet.
 */
export function answerChange(
  question: SheetQuestion,
  events: readonly LearningEvent[],
  sessionId: string,
  now: number,
  options: LineOptions = {},
): AnswerChange | null {
  if (!events.some((event) => event.session_id === sessionId && event.kind === 'oral_point')) return null;
  const after = buildSheet([question], events, now, options);
  const before = sheetWithout([question], events, sessionId, now, options);
  const changes = sheetChanges(before, after);
  return { summary: changeSummary(changes), quiet: quietReason(after, new Set([sessionId]), new Set(changes.map((change) => change.key))) };
}

/** A just-saved write may not be in the next read yet: read once more after this long. */
const REREAD_MS = 1200;

/**
 * The change of a saved answer, read from the journal once the answer is saved (null until then,
 * and when it cannot be read: the protocol then simply has no such line).
 */
export function useAnswerSheetChange(input: {
  question: AnsweredQuestion | null;
  response: RubricResponse | null;
  sessionId: string | null;
  examDate?: string | null;
}): AnswerChange | null {
  const { question, response, sessionId } = input;
  const examDate = input.examDate ?? null;
  const [change, setChange] = useState<{ sessionId: string; summary: AnswerChange } | null>(null);
  useEffect(() => {
    if (!question || !response || !sessionId || !question.question_hash) return undefined;
    let alive = true;
    let timer: number | undefined;
    const sheetQuestion = answerSheetQuestion(question, response);
    const read = async (again: boolean) => {
      try {
        const events = await fetchSheetEvents([question.question_hash]);
        if (!alive) return;
        const summary = answerChange(sheetQuestion, events, sessionId, Date.now(), { examDate });
        if (summary) setChange({ sessionId, summary });
        else if (again) timer = window.setTimeout(() => void read(false), REREAD_MS);
      } catch {
        // No line: the sheet itself shows the change.
      }
    };
    void read(true);
    return () => {
      alive = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [question, response, sessionId, examDate]);
  return change && change.sessionId === sessionId ? change.summary : null;
}
