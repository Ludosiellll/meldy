/**
 * Saving an answer aloud (contracts §1.5, §7.2, §9).
 *
 * One save per answer: record_oral_attempt writes the exam_sessions row (kind oral_ticket), the
 * journal events, the mistakes and the review card in one transaction. A retry reuses the
 * attempt_id, so the server answers it with the first result (duplicate: true) and nothing is
 * written twice. One unit of the daily limit is charged only after a successful save, once per
 * attempt.
 *
 * Browser storage (every access in try/catch; nothing here is the source of truth):
 * - localStorage meldy_answer_draft_<questionId> — the answer text while it is being given;
 * - sessionStorage meldy_oral_attempt — an answer whose evaluation failed, for «Проверить снова»;
 * - localStorage meldy_oral_live_marks — '0' / '1', marks during the answer in training (on by
 *   default); an answer «как на экзамене» (?mode=exam) starts with them off and never writes it;
 * - sessionStorage meldy_exam_peak_<examId> — the questions answered just now and their state
 *   before, so the exam sheet can draw the change (redesign spec 5.9).
 */
import { supabase } from '../supabase';
import { incrementAIUsage } from '../../api/limits';
import { localDate } from '../../api/learning';
import type { Readiness } from '../learning/readiness';
import type { Evaluation, Rubric, RubricPoint } from './oralApi';
import type { GradeResult } from './oralGrade';

export const DRAFT_PREFIX = 'meldy_answer_draft_';
export const ATTEMPT_KEY = 'meldy_oral_attempt';
export const LIVE_MARKS_KEY = 'meldy_oral_live_marks';
export const PEAK_PREFIX = 'meldy_exam_peak_';

/** Cost of one answer aloud in units of the daily limit (contracts §6.3). */
export const ORAL_ANSWER_COST = 1;

export type AnswerInput = 'speech' | 'text' | 'mixed';

export interface FollowupRecord {
  point_id: string;
  question: string;
  expected: string;
  status: 'covered' | 'partial' | 'missing' | 'wrong';
  student_quote: string;
  chosen_by: 'check' | 'client';
}

export interface OralAttemptPoint {
  id: string;
  title: string;
  essential: boolean;
  status: 'covered' | 'partial' | 'missing' | 'wrong' | 'unrated';
  credit?: number;
  student_quote: string;
  comment: string;
  source_ids: string[];
  material_id: string | null;
  source_quote: string;
  source_label: string;
  live: boolean;
}

export interface OralAttemptPayload {
  attempt_id: string;
  local_date: string;
  exam_question_id: string;
  rubric_id: string | null;
  material_id: string | null;
  duration_seconds: number;
  input: AnswerInput;
  score: number;
  grade: number;
  confidence: 1 | 2 | 3 | null;
  verdict: string;
  points: OralAttemptPoint[];
  followup: FollowupRecord | null;
  errors: Array<{ point_id: string; student_quote: string; correction: string }>;
  make_card: boolean;
}

const clip = (value: unknown, max: number): string => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/** «M1:S07» → { key: 'M1', id: 'S07' }; a plain «S07» has no key. */
export function splitSourceId(value: string): { key: string | null; id: string } {
  const match = /^(?:(M\d{1,2}):)?(S\d{1,4})$/.exec(value.trim());
  if (!match) return { key: null, id: '' };
  return { key: match[1] ?? null, id: match[2] };
}

/** «S07» → 7 (the number shown as «фрагмент 7»). */
export function fragmentNumber(sourceId: string): number | null {
  const match = /^S0*(\d{1,4})$/.exec(splitSourceId(sourceId).id || sourceId);
  return match ? Number(match[1]) : null;
}

/** «фрагмент 12» or «фрагменты 12, 13». */
export function fragmentsLabel(sourceIds: readonly string[]): string {
  const numbers = Array.from(new Set(sourceIds.map(fragmentNumber).filter((n): n is number => n !== null)));
  if (numbers.length === 0) return '';
  return numbers.length === 1 ? `фрагмент ${numbers[0]}` : `фрагменты ${numbers.join(', ')}`;
}

/** The material of a point (its first source id's key), its plain S-ids, and «Лекция», фрагмент N. */
export function pointSource(point: Pick<RubricPoint, 'source_ids'>, rubric: Pick<Rubric, 'materials'>) {
  const parts = point.source_ids.map(splitSourceId).filter((part) => part.id);
  // «M2:S07» names its lecture; plain ids (an old rubric) belong to the first one.
  const key = parts[0]?.key ?? null;
  const material = key ? rubric.materials.find((item) => item.key === key) ?? null : rubric.materials[0] ?? null;
  const ids = parts.filter((part) => part.key === key).map((part) => part.id);
  const fragments = fragmentsLabel(ids);
  const title = material?.title?.trim() ?? '';
  const titled = title ? `«${title.length > 80 ? `${title.slice(0, 79)}…` : title}»` : 'Лекция';
  return {
    materialId: material?.material_id ?? null,
    materialTitle: title,
    sourceIds: ids.slice(0, 6),
    fragments,
    label: clip(fragments ? `${titled}, ${fragments}` : titled, 120),
  };
}

export interface BuildAttemptInput {
  attemptId: string;
  examQuestionId: string;
  /** exam_questions.evidence[0].material_id: the first evidence material of the question. */
  evidenceMaterialId: string | null;
  rubricId: string | null;
  rubric: Rubric;
  evaluation: Evaluation;
  grade: GradeResult;
  followup: FollowupRecord | null;
  /** Points named by key words during the answer, before any follow-up. */
  live: ReadonlySet<string>;
  input: AnswerInput;
  durationSeconds: number;
  confidence: 1 | 2 | 3 | null;
  localDate?: string;
}

/** p_attempt of record_oral_attempt (contracts §1.5). Throws when there is no grade to save. */
export function buildAttemptPayload(input: BuildAttemptInput): OralAttemptPayload {
  const { grade } = input;
  if (grade.score === null || grade.grade === null) throw new Error('no grade to save');
  const byId = new Map(input.evaluation.points.map((point) => [point.id, point]));
  const points: OralAttemptPoint[] = input.rubric.points.map((point) => {
    const evaluated = byId.get(point.id);
    const source = pointSource(point, input.rubric);
    const credit = grade.credits[point.id];
    const entry: OralAttemptPoint = {
      id: point.id,
      title: clip(point.title, 120),
      essential: point.essential === true,
      status: evaluated?.status ?? 'unrated',
      student_quote: clip(evaluated?.student_quote, 160),
      comment: clip(evaluated?.comment, 200),
      source_ids: source.sourceIds,
      material_id: source.materialId,
      source_quote: clip(point.source_quote, 300),
      source_label: source.label,
      live: input.live.has(point.id),
    };
    if (typeof credit === 'number') entry.credit = credit;
    return entry;
  });
  const firstMaterial = input.evidenceMaterialId ?? input.rubric.materials[0]?.material_id ?? null;
  return {
    attempt_id: input.attemptId,
    local_date: input.localDate ?? localDate(),
    exam_question_id: input.examQuestionId,
    rubric_id: input.rubricId,
    material_id: firstMaterial,
    duration_seconds: Math.max(0, Math.min(3600, Math.round(input.durationSeconds))),
    input: input.input,
    score: grade.score,
    grade: grade.grade,
    confidence: input.confidence,
    verdict: clip(input.evaluation.verdict, 600),
    points,
    followup: input.followup
      ? {
          point_id: input.followup.point_id,
          question: clip(input.followup.question, 200),
          expected: clip(input.followup.expected, 300),
          status: input.followup.status,
          student_quote: clip(input.followup.student_quote, 160),
          chosen_by: input.followup.chosen_by,
        }
      : null,
    errors: input.evaluation.errors.slice(0, 10).map((error) => ({
      point_id: error.point_id,
      student_quote: clip(error.student_quote, 160),
      correction: clip(error.correction, 160),
    })),
    make_card: true,
  };
}

export interface SaveResult {
  sessionId: string;
  duplicate: boolean;
  events: number;
  mistakesAdded: number;
  mistakesExisting: number;
  cardAdded: boolean;
}

export const SAVE_FAILED = 'Результат не сохранён';

export class OralSaveError extends Error {
  readonly code: string | null;

  constructor(code: string | null = null) {
    super(SAVE_FAILED);
    this.name = 'OralSaveError';
    this.code = code;
  }
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

/** Attempts already charged in this page's life: a retry that the server answers as a duplicate is not charged twice. */
const charged = new Set<string>();

/**
 * Saves the attempt once (a retry reuses payload.attempt_id) and then charges one unit of the
 * daily limit. A failed save throws OralSaveError and charges nothing.
 */
export async function saveOralAttempt(userId: string | null, payload: OralAttemptPayload): Promise<SaveResult> {
  let response: { data: unknown; error: unknown };
  try {
    response = await supabase.rpc('record_oral_attempt', { p_attempt: payload });
  } catch {
    throw new OralSaveError('network');
  }
  if (response.error) {
    const code = (response.error as { code?: unknown }).code;
    throw new OralSaveError(typeof code === 'string' ? code : null);
  }
  const data = response.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new OralSaveError('no_result');
  const row = data as Record<string, unknown>;
  if (typeof row.session_id !== 'string' || !row.session_id) throw new OralSaveError('no_result');
  if (userId && !charged.has(payload.attempt_id)) {
    charged.add(payload.attempt_id);
    await incrementAIUsage(userId, ORAL_ANSWER_COST);
  }
  return {
    sessionId: row.session_id,
    duplicate: row.duplicate === true,
    events: count(row.events),
    mistakesAdded: count(row.mistakes_added),
    mistakesExisting: count(row.mistakes_existing),
    cardAdded: row.card_added === true,
  };
}

// ── Drafts ──────────────────────────────────────────────────────────────────────────

export interface AnswerDraft {
  text: string;
  input: AnswerInput;
  savedAt: string;
}

export const DRAFT_DEBOUNCE_MS = 500;

export function draftKey(questionId: string): string {
  return `${DRAFT_PREFIX}${questionId}`;
}

export function readDraft(questionId: string): AnswerDraft | null {
  try {
    const raw = window.localStorage.getItem(draftKey(questionId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Record<string, unknown>;
    const text = typeof value.text === 'string' ? value.text : '';
    if (!text.trim()) return null;
    const input = value.input === 'speech' || value.input === 'mixed' ? value.input : 'text';
    const savedAt = typeof value.saved_at === 'string' ? value.saved_at : new Date().toISOString();
    return { text: text.slice(0, 20_000), input, savedAt };
  } catch {
    return null;
  }
}

export function writeDraft(questionId: string, text: string, input: AnswerInput, now: Date = new Date()): void {
  try {
    if (!text.trim()) {
      window.localStorage.removeItem(draftKey(questionId));
      return;
    }
    window.localStorage.setItem(draftKey(questionId), JSON.stringify({ v: 1, text: text.slice(0, 20_000), input, saved_at: now.toISOString() }));
  } catch {
    // A full or blocked storage only costs the draft.
  }
}

/**
 * Removes the draft of a question. With `writtenUpTo` (an ISO time) only a draft written at or
 * before that time goes: a save that finishes late clears its own answer's draft, never the draft of
 * a newer answer to the same question.
 */
export function clearDraft(questionId: string, writtenUpTo?: string): void {
  try {
    if (writtenUpTo !== undefined) {
      const raw = window.localStorage.getItem(draftKey(questionId));
      if (!raw) return;
      let savedAt = Number.NaN;
      try {
        const value = JSON.parse(raw) as Record<string, unknown>;
        if (value && typeof value.saved_at === 'string') savedAt = Date.parse(value.saved_at);
      } catch {
        // an unreadable draft is removed
      }
      const limit = Date.parse(writtenUpTo);
      if (Number.isFinite(savedAt) && Number.isFinite(limit) && savedAt > limit) return;
    }
    window.localStorage.removeItem(draftKey(questionId));
  } catch {
    // nothing to clear
  }
}

/** A writer that keeps the last text and stores it DRAFT_DEBOUNCE_MS after the last change. */
export function createDraftWriter(questionId: string, delayMs: number = DRAFT_DEBOUNCE_MS) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { text: string; input: AnswerInput } | null = null;
  const flush = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (pending) writeDraft(questionId, pending.text, pending.input);
    pending = null;
  };
  return {
    update(text: string, input: AnswerInput) {
      pending = { text, input };
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(flush, delayMs);
    },
    flush,
    cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}

// ── An answer waiting for its evaluation ────────────────────────────────────────────

/** How a follow-up answer was judged: by the quick check, or by the browser's key-word rule when the check did not answer. */
export type FollowupJudge = 'check' | 'keywords';

/** The follow-up of a waiting answer: the record that will be saved, and how its status was decided (kept only on this page). */
export interface StashedFollowup extends FollowupRecord {
  judged_by?: FollowupJudge | null;
}

export interface StashedAttempt {
  examId: string;
  questionId: string;
  attemptId: string;
  transcript: string;
  input: AnswerInput;
  durationSeconds: number;
  live: string[];
  followup: StashedFollowup | null;
  createdAt: string;
}

export function stashAttempt(attempt: StashedAttempt): void {
  try {
    window.sessionStorage.setItem(ATTEMPT_KEY, JSON.stringify({ v: 1, ...attempt }));
  } catch {
    // The answer still sits in the page's memory.
  }
}

export function readStashedAttempt(examId: string, questionId: string): StashedAttempt | null {
  try {
    const raw = window.sessionStorage.getItem(ATTEMPT_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.examId !== examId || value.questionId !== questionId) return null;
    if (typeof value.attemptId !== 'string' || typeof value.transcript !== 'string' || !value.transcript.trim()) return null;
    const followup = value.followup && typeof value.followup === 'object' ? (value.followup as StashedFollowup) : null;
    return {
      examId,
      questionId,
      attemptId: value.attemptId,
      transcript: value.transcript,
      input: value.input === 'speech' || value.input === 'mixed' ? value.input : 'text',
      durationSeconds: typeof value.durationSeconds === 'number' ? value.durationSeconds : 0,
      live: Array.isArray(value.live) ? value.live.filter((id): id is string => typeof id === 'string') : [],
      followup:
        followup && typeof followup.point_id === 'string'
          ? { ...followup, judged_by: followup.judged_by === 'check' || followup.judged_by === 'keywords' ? followup.judged_by : null }
          : null,
      createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/** Forgets the waiting answer; with `attemptId`, only when the waiting answer is that attempt. */
export function clearStashedAttempt(attemptId?: string): void {
  try {
    if (attemptId !== undefined) {
      const raw = window.sessionStorage.getItem(ATTEMPT_KEY);
      if (!raw) return;
      let stored: unknown = null;
      try {
        stored = (JSON.parse(raw) as Record<string, unknown>)?.attemptId;
      } catch {
        // an unreadable stash is removed
      }
      if (typeof stored === 'string' && stored !== attemptId) return;
    }
    window.sessionStorage.removeItem(ATTEMPT_KEY);
  } catch {
    // nothing to clear
  }
}

// ── Preferences and the exam sheet's flag ──────────────────────────────────────────

export function readLiveMarks(): boolean {
  try {
    return window.localStorage.getItem(LIVE_MARKS_KEY) !== '0';
  } catch {
    return true;
  }
}

export function writeLiveMarks(on: boolean): void {
  try {
    window.localStorage.setItem(LIVE_MARKS_KEY, on ? '1' : '0');
  } catch {
    // the switch still works for this page
  }
}

/** Training (the stored preference) or «как на экзамене» (the draw's mode, ?mode=exam). */
export type TicketMode = 'training' | 'exam';

/**
 * Marks during the answer when the screen opens (Jury_Check item 11): off «как на экзамене», without
 * reading or writing the stored preference; otherwise the preference, on by default.
 */
export function initialLiveMarks(mode: TicketMode): boolean {
  return mode === 'exam' ? false : readLiveMarks();
}

/** The switch «Отмечать пункты во время ответа»: remembered in training only; «как на экзамене» it lasts for this answer. */
export function rememberLiveMarks(mode: TicketMode, on: boolean): void {
  if (mode !== 'exam') writeLiveMarks(on);
}

/** Adds a just-saved question to the sheet's flag: its hash and its readiness before the answer. */
export function addPeakFlag(examId: string, entry: { hash: string; questionId: string; before: Readiness }): void {
  try {
    const key = `${PEAK_PREFIX}${examId}`;
    const raw = window.sessionStorage.getItem(key);
    let list: unknown[] = [];
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        list = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        list = [];
      }
    }
    const next = list.filter(
      (item) => !(item && typeof item === 'object' && (item as Record<string, unknown>).hash === entry.hash),
    );
    next.push({ hash: entry.hash, question_id: entry.questionId, before: entry.before });
    window.sessionStorage.setItem(key, JSON.stringify(next.slice(-4)));
  } catch {
    // the sheet just draws without the change
  }
}
