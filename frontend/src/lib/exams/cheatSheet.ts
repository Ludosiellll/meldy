/**
 * «Шпаргалка, которая исчезает» (notes: 10_Project/Vanishing_Cheat_Sheet_Spec_2026-10-05, v2): the
 * state of every line of an exam's cheat sheet, from the answer journal. Pure module: no network,
 * no storage.
 *
 * A line is one answer point of a question's current rubric (the points the examiner checks the
 * answer by). Its events are the journal rows of that point:
 * - `oral_point`, written by record_oral_attempt with every checked answer;
 * - `sheet_peek`, written when the student uncovered the line on the sheet («подсмотреть»).
 * An event belongs to a line when it is about the same question (payload.question_hash) and the
 * same point by its words (payload.title, normalised): a rubric rebuilt under the same id with other
 * points does not inherit their history, a rubric rebuilt with the same point (after re-mapping)
 * does. An event without a title falls back to its item_key.
 *
 * Each answer is a pass of the eraser. What counts:
 * - «назван»: the point was covered in the answer itself;
 * - «не назван»: partial, wrong, missing — and missing but named only after the examiner asked
 *   about it (the student did not recall it alone);
 * - skipped: an unrated point, and a naming on the same local day after the line was uncovered.
 * The rule is «подтверждено» of readiness.ts: the series is the namings after the last miss, and
 * the line is erased when the first and the last naming of the series are on different local days
 * and at least 20 hours apart by the server clock. States:
 * - fresh — as written (readable);
 * - rubbed — named, the series does not erase yet: rubbed half-way, not readable;
 * - erased — gone, only the eraser's trace;
 * - due — erased, and its check is due: 5, 12, 25, 50 days after the last naming as checks pass
 *   (a check is a naming of an erased line on another day, 20 hours or more after the previous
 *   naming), or in the last days before the exam a line not named for 4 days;
 * - missed — the last event is a miss and the line was never erased (readable, a pencil wave);
 * - returned — the last event is a miss and the line had been erased (readable, wave, the trace).
 */
import type { LearningEvent } from '../../api/learning';
import { CONFIRM_MIN_HOURS, compareEventTime, meetsRule, midnightAfter, serverTime } from '../learning/readiness';

export type LineState = 'fresh' | 'rubbed' | 'erased' | 'due' | 'missed' | 'returned';

/** Lines still on the sheet (the counter's «осталось»): not erased. */
export const LINE_LEFT: ReadonlySet<LineState> = new Set<LineState>(['fresh', 'rubbed', 'missed', 'returned']);
/** Lines that can be read without uncovering: what is still to learn. */
export const LINE_READABLE: ReadonlySet<LineState> = new Set<LineState>(['fresh', 'missed', 'returned']);

/** Days after the last naming until an erased line is checked again; the stage grows with each passed check. */
export const DUE_DAYS: readonly number[] = [5, 12, 25, 50];
/** Before the exam (0–2 days to go) an erased line not named for this many days is due. */
export const EXAM_EVE_DAYS = 2;
export const EXAM_EVE_STALE_DAYS = 4;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** How the event reads in the line's history. */
export type LineWord = 'named' | 'mentioned' | 'wrong' | 'missing' | 'after_question' | 'after_peek';

export interface LineEvent {
  /** Server time (created_at). */
  at: string;
  /** The answer's local day (local_date). */
  date: string;
  outcome: 'named' | 'missed' | 'skipped';
  word: LineWord;
  /** exam_sessions.id of the answer (the read-only protocol). */
  sessionId: string | null;
}

export interface LineStatus {
  state: LineState;
  /** Checked answers of the line, oldest first (unrated ones are left out; skipped ones stay, marked). */
  history: LineEvent[];
  /**
   * rubbed: the earliest moment a naming erases the line — the later of +20 hours and the next local
   * midnight, and after a peek today not before the next midnight (ISO).
   */
  erasableFrom: string | null;
  /** erased, due: the naming that erased the line and its local day. */
  erasedAt: string | null;
  erasedOn: string | null;
  /** erased, due: the latest naming. */
  lastNamedAt: string | null;
  /** erased: when the line becomes due (ISO); due: since when. */
  dueAt: string | null;
  /** returned: the local day the line had been erased on before the miss. */
  wasErasedOn: string | null;
  /** The line was uncovered today: a naming today does not count. */
  peekedToday: boolean;
  /** Checks passed since the line was erased (the stage of DUE_DAYS). */
  checks: number;
}

export interface LineOptions {
  /** The exam's day ('yyyy-MM-dd'), for the last days before it. */
  examDate?: string | null;
}

function payloadOf(event: LearningEvent): Record<string, unknown> {
  return event.payload && typeof event.payload === 'object' ? (event.payload as Record<string, unknown>) : {};
}

function timeOf(now: Date | number | undefined): number {
  if (typeof now === 'number') return now;
  if (now instanceof Date) return now.getTime();
  return Date.now();
}

/** The local day of a moment in the browser's time zone, 'yyyy-MM-dd'. */
export function localDayOf(ms: number): string {
  const date = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dayNumber(key: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS;
}

/** Point words compared the way the journal stores them: lower case, «ё» as «е», letters and digits only. */
export function normalizeTitle(text: unknown): string {
  return typeof text === 'string'
    ? text
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
    : '';
}

function outcomeOf(event: LearningEvent): { outcome: 'named' | 'missed'; word: LineWord } | null {
  if (event.correct !== true && event.correct !== false) return null;
  const payload = payloadOf(event);
  const status = typeof payload.status === 'string' ? payload.status : '';
  if (event.correct === true) {
    // Missed in the answer, then named after the examiner's question: not recalled alone.
    if ((status === 'missing' || status === 'partial' || status === 'wrong') && payload.followup_status === 'covered') {
      return { outcome: 'missed', word: 'after_question' };
    }
    return { outcome: 'named', word: 'named' };
  }
  if (status === 'partial') return { outcome: 'missed', word: 'mentioned' };
  if (status === 'wrong') return { outcome: 'missed', word: 'wrong' };
  return { outcome: 'missed', word: 'missing' };
}

/**
 * The state of one line from its oral_point and sheet_peek events (any order; other kinds are
 * ignored). `now` decides `due` and `peekedToday`.
 */
export function lineStatus(events: readonly LearningEvent[], now: Date | number = new Date(), options: LineOptions = {}): LineStatus {
  const at = timeOf(now);
  const today = localDayOf(at);
  const sorted = events.filter((event) => event && (event.kind === 'oral_point' || event.kind === 'sheet_peek')).slice().sort(compareEventTime);

  const peekDays = new Set<string>();
  let peekedToday = false;
  const history: LineEvent[] = [];
  let series: LearningEvent[] = [];
  let erased: LearningEvent | null = null;
  let lastNamed: LearningEvent | null = null;
  let checks = 0;
  let wasErased: LearningEvent | null = null;
  let last: 'named' | 'missed' | null = null;

  for (const event of sorted) {
    if (event.kind === 'sheet_peek') {
      if (event.local_date) peekDays.add(event.local_date);
      if (event.local_date === today) peekedToday = true;
      continue;
    }
    const result = outcomeOf(event);
    if (!result) continue;
    const base = { at: event.created_at, date: event.local_date, sessionId: event.session_id ?? null };
    if (result.outcome === 'named' && peekDays.has(event.local_date)) {
      // Uncovered earlier the same day: reading it then saying it erases nothing.
      history.push({ ...base, outcome: 'skipped', word: 'after_peek' });
      continue;
    }
    history.push({ ...base, outcome: result.outcome, word: result.word });
    last = result.outcome;
    if (result.outcome === 'named') {
      if (erased) {
        if (lastNamed && meetsRule(lastNamed, event)) checks += 1;
      } else {
        series.push(event);
        if (meetsRule(series[0], event)) {
          erased = event;
          checks = 0;
        }
      }
      lastNamed = event;
    } else {
      if (erased) wasErased = erased;
      series = [];
      erased = null;
      lastNamed = null;
      checks = 0;
    }
  }

  const status: LineStatus = {
    state: 'fresh',
    history,
    erasableFrom: null,
    erasedAt: null,
    erasedOn: null,
    lastNamedAt: null,
    dueAt: null,
    wasErasedOn: null,
    peekedToday,
    checks: 0,
  };
  if (last === null) return status;
  if (last === 'missed') {
    return wasErased ? { ...status, state: 'returned', wasErasedOn: wasErased.local_date } : { ...status, state: 'missed' };
  }

  if (erased && lastNamed) {
    const named = serverTime(lastNamed);
    const days = DUE_DAYS[Math.min(checks, DUE_DAYS.length - 1)];
    let dueMs = named !== null ? named + days * DAY_MS : null;
    // The last days before the exam: a line not named for 4 days is checked now.
    const exam = options.examDate ? dayNumber(options.examDate) : null;
    const now0 = dayNumber(today);
    if (named !== null && exam !== null && now0 !== null && exam - now0 >= 0 && exam - now0 <= EXAM_EVE_DAYS) {
      const eve = named + EXAM_EVE_STALE_DAYS * DAY_MS;
      dueMs = dueMs === null ? eve : Math.min(dueMs, eve);
    }
    const due = dueMs !== null && at >= dueMs;
    return {
      ...status,
      state: due ? 'due' : 'erased',
      erasedAt: erased.created_at,
      erasedOn: erased.local_date,
      lastNamedAt: lastNamed.created_at,
      dueAt: dueMs !== null ? new Date(dueMs).toISOString() : null,
      checks,
    };
  }

  const start = series[0];
  const begin = start ? serverTime(start) : null;
  const midnight = start ? midnightAfter(start.local_date) : null;
  let erasableFrom: string | null = null;
  if (begin !== null || midnight !== null) {
    let from = Math.max(begin !== null ? begin + CONFIRM_MIN_HOURS * HOUR_MS : -Infinity, midnight ?? -Infinity);
    // Uncovered today: a naming later today does not count either, so not before the next midnight.
    const tomorrow = peekedToday ? midnightAfter(today) : null;
    if (tomorrow !== null) from = Math.max(from, tomorrow);
    erasableFrom = new Date(from).toISOString();
  }
  return { ...status, state: 'rubbed', erasableFrom };
}

// ------------------------------------------------------------------ the sheet

export type SheetCoverage = 'full' | 'partial' | 'none' | 'unverified' | null;

export interface SheetMaterial {
  /** «M1» */
  key: string;
  material_id: string;
  title: string;
}

export interface SheetPoint {
  /** p1…p6 */
  id: string;
  /** The point as the examiner checks it (≤ 120). */
  title: string;
  /** The cheat-sheet line (≤ 56), empty when there is none: then the title is written. */
  short: string;
  essential: boolean;
  /** Word for word from the lecture. */
  source_quote: string;
  /** ['M1:S12'] */
  source_ids: string[];
}

export interface SheetRubric {
  rubric_id: string;
  /** created_at of the rubric (ISO) or null. */
  built_at: string | null;
  /** What the model found in the lectures for this question. */
  coverage: 'full' | 'partial' | 'none';
  coverage_note: string;
  materials: SheetMaterial[];
  points: SheetPoint[];
}

export interface SheetQuestion {
  question_id: string;
  position: number;
  /** The department's number («5», «12а»), empty when the list has none. */
  label: string;
  section: number | null;
  /** The department's wording. */
  text: string;
  question_hash: string;
  /** The mapping's mark (exam_questions.coverage). */
  coverage: SheetCoverage;
  coverage_method: 'llm' | 'lexical' | 'manual' | null;
  coverage_reason: string;
  /** What the lectures lack (mapping), «товаров Гиффена». */
  missing_note: string;
  /** The question's current rubric, null when it was never written. */
  rubric: SheetRubric | null;
  /** No rubric for the current lectures, but there was one for earlier ones: the points were rebuilt. */
  rebuilt?: boolean;
}

/**
 * lines — written; gap — nothing to write, the lectures lack it; unwritten — can be written (a
 * unit); rebuilt — written for other lectures, to be written again; unmapped — not checked against
 * the lectures yet; unverified — checked by words only (written after a new check).
 */
export type BlockKind = 'lines' | 'gap' | 'unwritten' | 'rebuilt' | 'unmapped' | 'unverified';

export interface SheetLine {
  /** `<rubric_id>:<point_id>` */
  key: string;
  questionId: string;
  questionHash: string;
  rubricId: string;
  pointId: string;
  /** The handwritten line: `short`, else the point's title. */
  text: string;
  title: string;
  essential: boolean;
  quote: string;
  sourceIds: string[];
  status: LineStatus;
}

export interface SheetBlock {
  questionId: string;
  /** The department's number, else the position. */
  number: string;
  section: number | null;
  /** The department's wording, printed. */
  text: string;
  kind: BlockKind;
  coverage: SheetCoverage;
  coverageMethod: SheetQuestion['coverage_method'];
  coverageReason: string;
  /** What the lectures lack: the mapping's note, else the rubric's; empty when nothing is missing. */
  missing: string;
  /** The question is covered only partly (the mapping or the rubric says so). */
  partial: boolean;
  materials: SheetMaterial[];
  lines: SheetLine[];
  /** Every essential line is erased (a due line waits for its check). Never true for a block without lines. */
  learned: boolean;
}

export interface SheetCounts {
  /** Lines on the sheet (each line once, even when two questions share it). */
  total: number;
  /** Lines still there (not erased): fresh, rubbed, missed, returned. */
  left: number;
  essentialTotal: number;
  essentialLeft: number;
  rubbed: number;
  erased: number;
  due: number;
  /** Lines to learn: readable (fresh, missed, returned). */
  readable: number;
  learned: number;
  /** Questions without lines: gaps, unwritten, rebuilt, unmapped, unverified. */
  withoutLines: number;
  gaps: number;
  unwritten: number;
  rebuilt: number;
  unmapped: number;
  unverified: number;
  questions: number;
}

export interface Sheet {
  blocks: SheetBlock[];
  counts: SheetCounts;
}

// The words after «Не хватает:» (backend/exams_map.py: clean_missing): a model's «В лекции нет
// примеров» or «не хватает примеров» says the same as the label, so only «примеров» is left.
const MISSING_PREFIX =
  /^(?:(?:в|во)\s+(?:лекци\p{L}*|фрагмент\p{L}*(?:\s+\d+)?|материал\p{L}*|тексте)\s+)?(?:нет|не\s+хватает|не\s+хватило|недоста[её]т|отсутству\p{L}*|не\s+(?:указан|приведен|приведён|назван|раскрыт|описан|рассмотрен|дан|представлен|упомянут)\p{L}*)(?:\s*[:—–-]\s*|\s+)/iu;
const MISSING_EMPTY = /^(?:нет|ничего|всё есть|все есть|—|-)?[.!]?$/iu;

/** What the lectures lack, as it goes after «Не хватает:» (empty when nothing is said). */
export function cleanMissing(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim();
  if (!one || MISSING_EMPTY.test(one)) return '';
  const stripped = one.replace(MISSING_PREFIX, '').replace(/^[\s:—–-]+|[\s:—–-]+$/gu, '');
  if (!stripped) return '';
  const word = /^\p{L}+/u.exec(stripped)?.[0] ?? '';
  // «Классификации» → «классификации»; «ВВП» stays.
  return word.length > 0 && word[0] !== word[0].toLowerCase() && (word.length === 1 || word[1] === word[1].toLowerCase())
    ? stripped[0].toLowerCase() + stripped.slice(1)
    : stripped;
}

/** The question's number on the sheet: the department's label, else its position. */
export function blockNumber(question: Pick<SheetQuestion, 'label' | 'position'>): string {
  // «5.» and «5)» are printed «5.» once, as in «Вопросы» (sheetModel.numberOf).
  const label = typeof question.label === 'string' ? question.label.trim().replace(/[.)]\s*$/, '').trim() : '';
  return label || String(question.position);
}

export function lineKey(rubricId: string, pointId: string): string {
  return `${rubricId}:${pointId}`;
}

/** The kind of a question's block. */
export function blockKind(question: SheetQuestion): BlockKind {
  if (question.coverage === 'none') return 'gap';
  if (question.rubric) return question.rubric.coverage === 'none' || question.rubric.points.length === 0 ? 'gap' : 'lines';
  if (question.coverage === null) return 'unmapped';
  if (question.coverage === 'unverified') return 'unverified';
  return question.rebuilt ? 'rebuilt' : 'unwritten';
}

/** The question hashes whose events the sheet needs (one per written question). */
export function sheetHashes(questions: readonly SheetQuestion[]): string[] {
  const hashes = new Set<string>();
  for (const question of questions) if (question.rubric && question.question_hash) hashes.add(question.question_hash);
  return [...hashes];
}

interface LineIdentity {
  hash: string;
  rubricId: string;
  pointId: string;
  /** The point's words, normalised (normalizeTitle). */
  words: string;
  /** Another point of the same rubric has the same words: within that rubric the point's id decides. */
  twin: boolean;
}

// An event's words, normalised once: every line of its question compares them, on every build.
const eventWords = new WeakMap<LearningEvent, string>();
function wordsOf(event: LearningEvent): string {
  let words = eventWords.get(event);
  if (words === undefined) {
    words = normalizeTitle(payloadOf(event).title);
    eventWords.set(event, words);
  }
  return words;
}

/** Does the event belong to this line: the same question and the same point words (or, without words, the same key). */
function belongs(event: LearningEvent, line: LineIdentity): boolean {
  const payload = payloadOf(event);
  const hash = typeof payload.question_hash === 'string' ? payload.question_hash : '';
  const title = wordsOf(event);
  if (title) {
    if ((hash && hash !== line.hash) || title !== line.words) return false;
    const rubric = typeof payload.rubric_id === 'string' ? payload.rubric_id.toLowerCase() : '';
    const sameRubric = rubric !== '' && rubric === line.rubricId.toLowerCase();
    if (!hash && !sameRubric) return false;
    // Words alone carry a point across rebuilt rubrics; two points of one rubric with the same words
    // are told apart by their ids.
    if (line.twin && sameRubric && typeof payload.point_id === 'string' && payload.point_id) return payload.point_id === line.pointId;
    return true;
  }
  const prefix = event.kind === 'sheet_peek' ? 'peek' : 'oral';
  return event.item_key === `${prefix}:${line.rubricId}:${line.pointId}`;
}

/**
 * The whole sheet: blocks in the department's order with their lines' states, and the counts.
 * `events` are the exam's oral_point and sheet_peek events (any order).
 */
export function buildSheet(
  questions: readonly SheetQuestion[],
  events: readonly LearningEvent[],
  now: Date | number = new Date(),
  options: LineOptions = {},
): Sheet {
  // Events by question hash (a title match is checked per line).
  const byHash = new Map<string, LearningEvent[]>();
  const loose: LearningEvent[] = [];
  for (const event of events) {
    if (!event || (event.kind !== 'oral_point' && event.kind !== 'sheet_peek')) continue;
    const hash = payloadOf(event).question_hash;
    if (typeof hash === 'string' && hash) {
      const list = byHash.get(hash);
      if (list) list.push(event);
      else byHash.set(hash, [event]);
    } else {
      loose.push(event);
    }
  }

  const counts: SheetCounts = {
    total: 0,
    left: 0,
    essentialTotal: 0,
    essentialLeft: 0,
    rubbed: 0,
    erased: 0,
    due: 0,
    readable: 0,
    learned: 0,
    withoutLines: 0,
    gaps: 0,
    unwritten: 0,
    rebuilt: 0,
    unmapped: 0,
    unverified: 0,
    questions: questions.length,
  };
  const counted = new Set<string>();
  const ordered = questions.slice().sort((a, b) => a.position - b.position);
  const blocks: SheetBlock[] = ordered.map((question) => {
    const kind = blockKind(question);
    const rubric = question.rubric;
    const pool = [...(byHash.get(question.question_hash) ?? []), ...loose];
    const titles = kind === 'lines' && rubric ? rubric.points.map((point) => normalizeTitle(point.title)) : [];
    const words = new Map<string, number>();
    for (const title of titles) words.set(title, (words.get(title) ?? 0) + 1);
    const lines: SheetLine[] =
      kind === 'lines' && rubric
        ? rubric.points.map((point, index) => {
            const identity = {
              hash: question.question_hash,
              rubricId: rubric.rubric_id,
              pointId: point.id,
              words: titles[index],
              twin: (words.get(titles[index]) ?? 0) > 1,
            };
            return {
              key: lineKey(rubric.rubric_id, point.id),
              questionId: question.question_id,
              questionHash: question.question_hash,
              rubricId: rubric.rubric_id,
              pointId: point.id,
              text: (point.short || '').trim() || point.title,
              title: point.title,
              essential: point.essential,
              quote: point.source_quote,
              sourceIds: point.source_ids,
              status: lineStatus(
                pool.filter((event) => belongs(event, identity)),
                now,
                options,
              ),
            };
          })
        : [];

    for (const line of lines) {
      if (counted.has(line.key)) continue;
      counted.add(line.key);
      const state = line.status.state;
      counts.total += 1;
      if (line.essential) counts.essentialTotal += 1;
      if (LINE_LEFT.has(state)) {
        counts.left += 1;
        if (line.essential) counts.essentialLeft += 1;
      }
      if (LINE_READABLE.has(state)) counts.readable += 1;
      if (state === 'rubbed') counts.rubbed += 1;
      if (state === 'erased') counts.erased += 1;
      if (state === 'due') counts.due += 1;
    }
    if (kind === 'gap') counts.gaps += 1;
    if (kind === 'unwritten') counts.unwritten += 1;
    if (kind === 'rebuilt') counts.rebuilt += 1;
    if (kind === 'unmapped') counts.unmapped += 1;
    if (kind === 'unverified') counts.unverified += 1;
    if (kind !== 'lines') counts.withoutLines += 1;

    const deciding = lines.some((line) => line.essential) ? lines.filter((line) => line.essential) : lines;
    const learned = deciding.length > 0 && deciding.every((line) => line.status.state === 'erased');
    if (learned) counts.learned += 1;

    const partial = question.coverage === 'partial' || rubric?.coverage === 'partial';
    return {
      questionId: question.question_id,
      number: blockNumber(question),
      section: question.section,
      text: question.text,
      kind,
      coverage: question.coverage,
      coverageMethod: question.coverage_method,
      coverageReason: question.coverage_reason,
      missing: partial ? cleanMissing(question.missing_note || rubric?.coverage_note || '') : '',
      partial,
      materials: rubric?.materials ?? [],
      lines,
      learned,
    };
  });
  return { blocks, counts };
}

// ------------------------------------------------------------------ after an answer, and the history

export interface LineChange {
  key: string;
  questionId: string;
  from: LineState;
  to: LineState;
  /** The line as it was before (its notes and history then): the replay draws it so first. */
  before?: LineStatus;
}

/** Lines whose state differs between two builds of the same sheet, in the sheet's order. */
export function sheetChanges(before: Sheet, after: Sheet): LineChange[] {
  const previous = new Map<string, LineStatus>();
  for (const block of before.blocks) for (const line of block.lines) previous.set(line.key, line.status);
  const changes: LineChange[] = [];
  const seen = new Set<string>();
  for (const block of after.blocks) {
    for (const line of block.lines) {
      if (seen.has(line.key)) continue;
      seen.add(line.key);
      const was = previous.get(line.key);
      if (!was || was.state === line.status.state) continue;
      changes.push({ key: line.key, questionId: block.questionId, from: was.state, to: line.status.state, before: was });
    }
  }
  return changes;
}

/** «2 строки стёрлись, 3 — наполовину, 1 вернулась»: what the changes of an answer did. */
export interface ChangeSummary {
  /** Erased by the answer (a line erased then and due by now counts here too). */
  erased: number;
  /** Rubbed half-way. */
  rubbed: number;
  /** Lines that were due and were named: the check passed, they are erased again. */
  checked: number;
  /** Back in ink: an erased line not named (returned), or a rubbed one not named this time. */
  returned: number;
  /** Still there as written: a fresh line not named this time (it gets the pencil wave). */
  stayed: number;
}

export function changeSummary(changes: readonly LineChange[]): ChangeSummary {
  const summary: ChangeSummary = { erased: 0, rubbed: 0, checked: 0, returned: 0, stayed: 0 };
  for (const change of changes) {
    if (change.to === 'erased') {
      if (change.from === 'due') summary.checked += 1;
      else summary.erased += 1;
    } else if (change.to === 'due') summary.erased += 1;
    else if (change.to === 'rubbed') summary.rubbed += 1;
    else if (change.to === 'returned') summary.returned += 1;
    else if (change.to === 'missed') {
      if (change.from === 'fresh') summary.stayed += 1;
      else summary.returned += 1;
    }
  }
  return summary;
}

/**
 * Why an answer left lines it named as they were, from its own events: lines named again before
 * their moment (how many, and the earliest moment), a line uncovered the same day, lines already
 * erased — or null (nothing named: the protocol says what was missed). `changed`: the keys of the
 * lines the answer did change, which need no reason (without it every line of the answer counts).
 */
export type QuietReason = { kind: 'wait'; from: string; count: number } | { kind: 'peek' } | { kind: 'erased' };

export function quietReason(sheet: Sheet, sessions: ReadonlySet<string>, changed: ReadonlySet<string> = new Set()): QuietReason | null {
  let wait: string | null = null;
  let waiting = 0;
  let peek = false;
  let erased = false;
  for (const block of sheet.blocks) {
    for (const line of block.lines) {
      if (changed.has(line.key)) continue;
      const own = line.status.history.filter((event) => event.sessionId !== null && sessions.has(event.sessionId));
      if (own.length === 0) continue;
      if (own.some((event) => event.word === 'after_peek')) peek = true;
      if (!own.some((event) => event.outcome === 'named')) continue;
      const { state, erasableFrom } = line.status;
      if (state === 'rubbed' && erasableFrom) {
        waiting += 1;
        if (wait === null || Date.parse(erasableFrom) < Date.parse(wait)) wait = erasableFrom;
      }
      if (state === 'erased' || state === 'due') erased = true;
    }
  }
  if (wait) return { kind: 'wait', from: wait, count: waiting };
  if (peek) return { kind: 'peek' };
  if (erased) return { kind: 'erased' };
  return null;
}

/**
 * The answer session whose events are the newest among the sheet's lines (the last answer that
 * changed the sheet), or null.
 */
export function lastAnswerSession(sheet: Sheet, questionIds?: ReadonlySet<string>): string | null {
  let newest: LineEvent | null = null;
  for (const block of sheet.blocks) {
    if (questionIds && !questionIds.has(block.questionId)) continue;
    for (const line of block.lines) {
      for (const event of line.status.history) {
        if (event.sessionId && (!newest || event.at > newest.at)) newest = event;
      }
    }
  }
  return newest?.sessionId ?? null;
}

/** The sheet as it was before one answer session (or several): the same build without their events. */
export function sheetWithout(
  questions: readonly SheetQuestion[],
  events: readonly LearningEvent[],
  sessionId: string | ReadonlySet<string>,
  now: Date | number = new Date(),
  options: LineOptions = {},
): Sheet {
  const left = typeof sessionId === 'string' ? new Set([sessionId]) : sessionId;
  return buildSheet(
    questions,
    events.filter((event) => !event.session_id || !left.has(event.session_id)),
    now,
    options,
  );
}

export interface HistoryFrame {
  /** The local day ('yyyy-MM-dd'). */
  day: string;
  /** End of that day (ms), the `now` the frame was built with. */
  at: number;
  left: number;
  total: number;
}

/**
 * The sheet day by day from the first answer to today (the finale «История листа»): one frame per
 * local day, built as of the end of that day. Lines written later than a day still count on it —
 * the sheet is the current one, only the answers are replayed.
 */
export function sheetHistory(
  questions: readonly SheetQuestion[],
  events: readonly LearningEvent[],
  now: Date | number = new Date(),
  options: LineOptions = {},
): HistoryFrame[] {
  const end = timeOf(now);
  const answered = events.filter((event) => event && event.kind === 'oral_point' && Number.isFinite(Date.parse(event.created_at)));
  if (answered.length === 0) return [];
  const first = Math.min(...answered.map((event) => Date.parse(event.created_at)));
  const frames: HistoryFrame[] = [];
  const start = new Date(first);
  let day = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  for (let guard = 0; guard < 400; guard += 1) {
    const next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
    const at = Math.min(next.getTime() - 1, end);
    const sheet = buildSheet(
      questions,
      events.filter((event) => Date.parse(event.created_at) <= at),
      at,
      options,
    );
    frames.push({ day: localDayOf(at), at, left: sheet.counts.left, total: sheet.counts.total });
    if (next.getTime() > end) break;
    day = next;
  }
  return frames;
}
