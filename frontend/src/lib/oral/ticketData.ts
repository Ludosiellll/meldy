/**
 * Data of the answer screen, read directly with the user's session (row-level security keeps it to
 * the user's own rows): the exam and the ticket's questions, the question's history in the journal
 * (fetchQuestionEvents), a saved protocol for the read-only view, and the anchors of a stored
 * rubric so that a saved protocol underlines the same words as the live one. Nothing here imports
 * the «Билеты» modules (contracts §7.1).
 */
import { supabase } from '../supabase';
import { fetchQuestionEvents, type LearningEvent } from '../../api/learning';
import { questionState, SELF_RATING_CONFIDENCE, type QuestionState } from '../learning/readiness';
import { displayMaterialTitle } from '../../utils/materialTitle';

export type ExamKind = 'exam' | 'credit' | 'colloquium';

/** A ticket of the department's own list (exams.ticket_layout.tickets, written by the exam editor). */
export interface DepartmentTicket {
  number: number;
  questionIds: string[];
}

/** What the answer screen needs of exams.ticket_layout: whether the tickets are the department's, and which. */
export interface TicketLayoutInfo {
  mode: 'random' | 'sections' | 'fixed';
  tickets: DepartmentTicket[];
}

export interface TicketExam {
  id: string;
  title: string;
  kind: ExamKind;
  layout: TicketLayoutInfo;
}

/** A lecture fragment that answers the question (exam_questions.evidence). */
export interface EvidenceItem {
  material_id: string;
  material_title: string;
  source_id: string;
  excerpt: string;
}

/** The nearest fragment of a question with no answer in the lectures (exam_questions.nearest). */
export interface NearestItem {
  material_id: string;
  material_title: string;
  source_id: string;
  excerpt: string;
  matched: string[];
}

export interface TicketQuestion {
  id: string;
  exam_id: string;
  position: number;
  label: string;
  text: string;
  question_hash: string;
  coverage: 'full' | 'partial' | 'none' | 'unverified' | null;
  evidence: EvidenceItem[];
  nearest: NearestItem[];
}

export class TicketLoadError extends Error {
  readonly kind: 'not_found' | 'failed';

  constructor(kind: 'not_found' | 'failed', message: string) {
    super(message);
    this.name = 'TicketLoadError';
    this.kind = kind;
  }
}

export const TICKET_NOT_FOUND = 'Билет не найден: вопросов нет в этом экзамене.';
export const TICKET_LOAD_FAILED = 'Не удалось загрузить билет. Проверьте связь и повторите.';

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown, max = 4000): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function examKind(value: unknown): ExamKind {
  return value === 'credit' || value === 'colloquium' ? value : 'exam';
}

/** exams.ticket_layout, read defensively: anything unknown is a random draw without department tickets. */
export function ticketLayoutOf(value: unknown): TicketLayoutInfo {
  if (!isRecord(value)) return { mode: 'random', tickets: [] };
  const mode = value.mode === 'fixed' || value.mode === 'sections' ? value.mode : 'random';
  const tickets = (Array.isArray(value.tickets) ? value.tickets : [])
    .filter(isRecord)
    .map((ticket) => ({
      number: typeof ticket.number === 'number' && Number.isInteger(ticket.number) ? ticket.number : 0,
      questionIds: (Array.isArray(ticket.question_ids) ? ticket.question_ids : []).filter((id): id is string => typeof id === 'string'),
    }))
    .filter((ticket) => ticket.number > 0 && ticket.questionIds.length > 0);
  return { mode, tickets };
}

/**
 * The department's ticket number for this answer (Jury_Check items 4, 9, 11), or null. `&n` is only
 * honoured when the exam's tickets are the department's own list, ticket N is in it, and the answered
 * questions are a non-empty part of that ticket in its order — the draw leaves «нет» questions out of
 * q and keeps &n (ExamDraw). A number typed into the address, or one the list does not back, is never
 * shown: «Билет 12» on the screen has to be the department's ticket 12.
 */
export function departmentTicketNumber(layout: TicketLayoutInfo, requested: string | null, questionIds: readonly string[]): string | null {
  if (layout.mode !== 'fixed' || !requested || questionIds.length === 0) return null;
  const raw = requested.trim();
  if (!/^\d{1,6}$/.test(raw)) return null;
  const number = Number(raw);
  const inOrder = (ticket: DepartmentTicket) => {
    let from = 0;
    for (const id of questionIds) {
      const at = ticket.questionIds.indexOf(id, from);
      if (at < 0) return false;
      from = at + 1;
    }
    return true;
  };
  const ticket = layout.tickets.find((item) => item.number === number && inOrder(item));
  return ticket ? String(ticket.number) : null;
}

function evidenceOf(value: unknown): EvidenceItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => ({
    material_id: str(item.material_id, 64),
    material_title: displayMaterialTitle(str(item.material_title, 200), ''),
    source_id: str(item.source_id, 16),
    excerpt: str(item.excerpt, 1000),
  }));
}

function nearestOf(value: unknown): NearestItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((item) => ({
      material_id: str(item.material_id, 64),
      material_title: displayMaterialTitle(str(item.material_title, 200), ''),
      source_id: str(item.source_id, 16),
      excerpt: str(item.excerpt, 400),
      matched: Array.isArray(item.matched) ? item.matched.filter((word): word is string => typeof word === 'string').slice(0, 12) : [],
    }))
    .filter((item) => item.excerpt.trim() !== '');
}

function questionOf(row: Record<string, unknown>): TicketQuestion {
  const coverage = row.coverage;
  return {
    id: str(row.id, 64),
    exam_id: str(row.exam_id, 64),
    position: typeof row.position === 'number' ? row.position : 0,
    label: str(row.label, 16),
    text: str(row.text, 1000),
    question_hash: str(row.question_hash, 64),
    coverage: coverage === 'full' || coverage === 'partial' || coverage === 'none' || coverage === 'unverified' ? coverage : null,
    evidence: evidenceOf(row.evidence),
    nearest: nearestOf(row.nearest),
  };
}

/** Ticket question ids from `?q=a,b`: 1..4 unique UUIDs in the given order. */
export function parseQuestionIds(raw: string | null): string[] {
  if (!raw) return [];
  const ids: string[] = [];
  for (const part of raw.split(',')) {
    const id = decodeURIComponentSafe(part).trim();
    if (isUuid(id) && !ids.includes(id)) ids.push(id);
    if (ids.length === 4) break;
  }
  return ids;
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** The exam row (title for the top line, tickets for «Билет N»). Null when it is missing or not the user's. */
export async function loadExam(examId: string): Promise<TicketExam | null> {
  if (!isUuid(examId)) return null;
  const { data, error } = await supabase.from('exams').select('id, title, kind, ticket_layout').eq('id', examId).maybeSingle();
  if (error) throw new TicketLoadError('failed', TICKET_LOAD_FAILED);
  if (!isRecord(data)) return null;
  return { id: str(data.id, 64), title: str(data.title, 200), kind: examKind(data.kind), layout: ticketLayoutOf(data.ticket_layout) };
}

/** The exam and the ticket's questions in the requested order; a question outside the exam is an error. */
export async function loadTicket(examId: string, questionIds: string[]): Promise<{ exam: TicketExam; questions: TicketQuestion[] }> {
  if (!isUuid(examId) || questionIds.length === 0) throw new TicketLoadError('not_found', TICKET_NOT_FOUND);
  let exam: TicketExam | null;
  let rows: unknown[] | null;
  try {
    const [examResult, questionResult] = await Promise.all([
      loadExam(examId),
      supabase
        .from('exam_questions')
        .select('id, exam_id, position, label, text, question_hash, coverage, evidence, nearest')
        .eq('exam_id', examId)
        .in('id', questionIds),
    ]);
    exam = examResult;
    if (questionResult.error) throw new TicketLoadError('failed', TICKET_LOAD_FAILED);
    rows = questionResult.data as unknown[] | null;
  } catch (error) {
    if (error instanceof TicketLoadError) throw error;
    throw new TicketLoadError('failed', TICKET_LOAD_FAILED);
  }
  if (!exam) throw new TicketLoadError('not_found', TICKET_NOT_FOUND);
  const byId = new Map((rows ?? []).filter(isRecord).map((row) => [String(row.id), questionOf(row)]));
  const questions = questionIds.map((id) => byId.get(id)).filter((question): question is TicketQuestion => Boolean(question));
  if (questions.length !== questionIds.length) throw new TicketLoadError('not_found', TICKET_NOT_FOUND);
  return { exam, questions };
}

// ── History of a question ───────────────────────────────────────────────────────────

export interface PreviousAttempt {
  sessionId: string;
  /** The exam the answer was given in: history is kept by question text, so it may be another exam. */
  examId: string | null;
  localDate: string;
  grade: number | null;
  scorePct: number | null;
}

export interface QuestionHistory {
  state: QuestionState;
  /** The latest answer aloud, for «В прошлый раз (1 окт.): 3 из 5» and the read-only protocol. */
  previous: PreviousAttempt | null;
  /** The latest self-rating as journal confidence (3 знаю · 2 плаваю · 1 не знаю), saved with the answer. */
  confidence: 1 | 2 | 3 | null;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function historyFrom(events: LearningEvent[]): QuestionHistory {
  const answers = events.filter((event) => event.kind === 'exam_answer');
  const ratings = events.filter((event) => event.kind === 'self_rating');
  const state = questionState(answers, ratings);
  const last = answers.length > 0 ? answers[answers.length - 1] : null;
  const previous: PreviousAttempt | null =
    last && last.session_id
      ? {
          sessionId: last.session_id,
          examId: isUuid(last.payload.exam_id) ? last.payload.exam_id : null,
          localDate: last.local_date,
          grade: finite(last.payload.grade),
          scorePct: finite(last.payload.score_pct) ?? (last.score !== null ? Math.round(last.score * 100) : null),
        }
      : null;
  return { state, previous, confidence: state.selfRating ? SELF_RATING_CONFIDENCE[state.selfRating] : null };
}

/** Answers aloud and self-ratings of this question text (any exam with the same question). */
export async function loadQuestionHistory(questionHash: string): Promise<QuestionHistory> {
  const events = await fetchQuestionEvents([questionHash]);
  return historyFrom(events);
}

// ── A saved protocol (read-only view) ──────────────────────────────────────────────

export interface StoredPoint {
  id: string;
  title: string;
  essential: boolean;
  status: 'covered' | 'partial' | 'missing' | 'wrong' | 'unrated';
  credit: number | null;
  student_quote: string;
  comment: string;
  source_ids: string[];
  material_id: string | null;
  source_quote: string;
  source_label: string;
  live: boolean;
}

export interface StoredFollowup {
  point_id: string;
  question: string;
  expected: string;
  status: 'covered' | 'partial' | 'missing' | 'wrong';
  student_quote: string;
  chosen_by: 'check' | 'client';
}

export interface StoredProtocol {
  sessionId: string;
  examId: string | null;
  examQuestionId: string | null;
  rubricId: string | null;
  question: string;
  questionHash: string;
  subject: string;
  score: number | null;
  grade: number | null;
  input: string;
  completedAt: string | null;
  points: StoredPoint[];
  followup: StoredFollowup | null;
  errors: Array<{ point_id: string; student_quote: string; correction: string }>;
  verdict: string;
}

const POINT_STATUSES = new Set(['covered', 'partial', 'missing', 'wrong', 'unrated']);
const FOLLOWUP_STATUSES = new Set(['covered', 'partial', 'missing', 'wrong']);

function storedPoint(value: unknown): StoredPoint | null {
  if (!isRecord(value)) return null;
  const id = str(value.id, 4);
  if (!/^p[1-6]$/.test(id)) return null;
  return {
    id,
    title: str(value.title, 200),
    essential: value.essential === true,
    status: (typeof value.status === 'string' && POINT_STATUSES.has(value.status) ? value.status : 'unrated') as StoredPoint['status'],
    credit: finite(value.credit),
    student_quote: str(value.student_quote, 200),
    comment: str(value.comment, 240),
    source_ids: Array.isArray(value.source_ids) ? value.source_ids.filter((sid): sid is string => typeof sid === 'string') : [],
    material_id: typeof value.material_id === 'string' ? value.material_id : null,
    source_quote: str(value.source_quote, 400),
    source_label: str(value.source_label, 160),
    live: value.live === true,
  };
}

/** Parses exam_sessions.questions_json[0] of an oral_ticket row (contracts §1.5). */
export function protocolFromRow(row: Record<string, unknown>): StoredProtocol | null {
  const list = Array.isArray(row.questions_json) ? row.questions_json : [];
  const entry = list[0];
  if (!isRecord(entry)) return null;
  const points = (Array.isArray(entry.points) ? entry.points : []).map(storedPoint).filter((point): point is StoredPoint => Boolean(point));
  if (points.length === 0) return null;
  const followupRaw = isRecord(entry.followup) ? entry.followup : null;
  const followup: StoredFollowup | null =
    followupRaw && typeof followupRaw.point_id === 'string'
      ? {
          point_id: followupRaw.point_id,
          question: str(followupRaw.question, 300),
          expected: str(followupRaw.expected, 400),
          status: (typeof followupRaw.status === 'string' && FOLLOWUP_STATUSES.has(followupRaw.status)
            ? followupRaw.status
            : 'missing') as StoredFollowup['status'],
          student_quote: str(followupRaw.student_quote, 200),
          chosen_by: followupRaw.chosen_by === 'check' ? 'check' : 'client',
        }
      : null;
  const errors = (Array.isArray(entry.errors) ? entry.errors : [])
    .filter(isRecord)
    .map((item) => ({ point_id: str(item.point_id, 4), student_quote: str(item.student_quote, 200), correction: str(item.correction, 200) }))
    .filter((item) => item.correction.trim() !== '');
  return {
    sessionId: str(row.id, 64),
    examId: typeof entry.exam_id === 'string' ? entry.exam_id : null,
    examQuestionId: typeof entry.exam_question_id === 'string' ? entry.exam_question_id : null,
    rubricId: typeof entry.rubric_id === 'string' ? entry.rubric_id : null,
    question: str(entry.question, 1000),
    questionHash: str(entry.question_hash, 64),
    subject: str(row.subject, 200),
    score: finite(row.score),
    grade: finite(entry.grade),
    input: str(entry.input, 16),
    completedAt: typeof row.completed_at === 'string' ? row.completed_at : typeof row.created_at === 'string' ? row.created_at : null,
    points,
    followup,
    errors,
    verdict: str(entry.verdict, 600),
  };
}

/** A saved oral_ticket attempt; null when it is missing, not the user's, or not an oral answer. */
export async function loadOralSession(sessionId: string): Promise<StoredProtocol | null> {
  if (!isUuid(sessionId)) return null;
  const { data, error } = await supabase
    .from('exam_sessions')
    .select('id, subject, kind, score, questions_json, completed_at, created_at')
    .eq('id', sessionId)
    .eq('kind', 'oral_ticket')
    .maybeSingle();
  if (error) throw new TicketLoadError('failed', 'Не удалось загрузить протокол. Проверьте связь и повторите.');
  if (!isRecord(data)) return null;
  return protocolFromRow(data);
}

/** Anchors of a stored rubric by point id (to underline the same words in a saved protocol). */
export async function loadRubricAnchors(rubricId: string | null): Promise<Record<string, string[][]>> {
  if (!isUuid(rubricId)) return {};
  try {
    const { data, error } = await supabase.from('oral_rubrics').select('rubric').eq('id', rubricId).maybeSingle();
    if (error || !isRecord(data) || !isRecord(data.rubric) || !Array.isArray(data.rubric.points)) return {};
    const anchors: Record<string, string[][]> = {};
    for (const point of data.rubric.points) {
      if (!isRecord(point) || typeof point.id !== 'string' || !Array.isArray(point.anchors)) continue;
      anchors[point.id] = point.anchors
        .map((group) => (Array.isArray(group) ? group.filter((variant): variant is string => typeof variant === 'string') : []))
        .filter((group) => group.length > 0);
    }
    return anchors;
  } catch {
    return {};
  }
}
