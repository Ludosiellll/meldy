/**
 * «Шпаргалка, которая исчезает» (notes: 10_Project/Vanishing_Cheat_Sheet_Spec_2026-10-05): the
 * state of every line of an exam's cheat sheet, from the answer journal. Pure module: no network,
 * no storage.
 *
 * A line is one answer point of a question's current rubric (oral_rubrics: the points the examiner
 * checks), keyed `<rubric_id>:<point_id>`. Its events are the journal rows that record_oral_attempt
 * writes for that point: kind 'oral_point', item_key `oral:<rubric_id>:<point_id>`.
 *
 * The rule is «подтверждено» of readiness.ts applied to one point. An event is «назван» when
 * `correct` is true (the point was covered, or missed and then answered after the examiner asked
 * about it) and «не назван» when it is false (partial, missing, wrong); an event without a grade
 * (`correct` null, unrated) neither starts nor breaks anything. The current series is the namings
 * after the last miss. The line is erased when the first and the last naming of the series are on
 * different local days and at least 20 hours apart by the server clock. States:
 * - fresh: no graded event — the line as written;
 * - once: the last event is a naming and the series does not erase yet — pale ink;
 * - erased: the series erases — an eraser's ghost;
 * - due: erased, and the last naming is 14 days old or more — the ghost shows through («пора проверить»);
 * - missed: the last event is a miss and the line was never erased — ink with a pencil wave;
 * - returned: the last event is a miss and the line had been erased before — ink, wave, «забыли».
 * Reading the sheet, a self-rating, the tutor and a review card never erase anything: only answers
 * checked against the points write oral_point events.
 */
import type { LearningEvent } from '../../api/learning';
import { CONFIRM_MIN_HOURS, CONFIRM_STALE_DAYS, compareEventTime, meetsRule, midnightAfter, serverTime } from '../learning/readiness';

export type LineState = 'fresh' | 'once' | 'erased' | 'due' | 'missed' | 'returned';

/** States in which a line is still on the sheet (the counter's «осталось»). */
export const LINE_LEFT: ReadonlySet<LineState> = new Set<LineState>(['fresh', 'once', 'missed', 'returned']);

export type PointStatus = 'covered' | 'partial' | 'missing' | 'wrong';

export interface LineEvent {
  /** Server time (created_at). */
  at: string;
  /** The answer's local day (local_date). */
  date: string;
  named: boolean;
  /** What the examiner put down for the point in that answer. */
  status: PointStatus;
  /** Missed in the answer, then named after the examiner's question about it. */
  afterQuestion: boolean;
}

export interface LineStatus {
  state: LineState;
  /** Graded events of the line, oldest first (unrated ones are left out). */
  history: LineEvent[];
  /** once: the earliest moment a naming erases the line — the later of +20 hours and the next local midnight (ISO). */
  erasableFrom: string | null;
  /** erased, due: the naming that erased the line (created_at) and its local day. */
  erasedAt: string | null;
  erasedOn: string | null;
  /** erased, due: the latest naming; «пора проверить» counts from it. */
  lastNamedAt: string | null;
  /** returned: the local day the line had been erased on before it was forgotten. */
  wasErasedOn: string | null;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const STATUSES: ReadonlySet<string> = new Set(['covered', 'partial', 'missing', 'wrong']);

function timeOf(now: Date | number | undefined): number {
  if (typeof now === 'number') return now;
  if (now instanceof Date) return now.getTime();
  return Date.now();
}

function payloadOf(event: LearningEvent): Record<string, unknown> {
  return event.payload && typeof event.payload === 'object' ? (event.payload as Record<string, unknown>) : {};
}

function lineEventOf(event: LearningEvent): LineEvent | null {
  if (event.correct !== true && event.correct !== false) return null;
  const payload = payloadOf(event);
  const raw = typeof payload.status === 'string' && STATUSES.has(payload.status) ? (payload.status as PointStatus) : null;
  // The journal's `correct` decides; the status is only for the words («назван частично»).
  const status: PointStatus = raw ?? (event.correct ? 'covered' : 'missing');
  return {
    at: event.created_at,
    date: event.local_date,
    named: event.correct === true,
    status,
    afterQuestion: event.correct === true && status !== 'covered' && payload.followup_status === 'covered',
  };
}

/**
 * The state of one line from its oral_point events (any order, other kinds ignored). `now` decides
 * only `due` and the moment in `erasableFrom` is computed without it.
 */
export function lineStatus(events: readonly LearningEvent[], now: Date | number = new Date()): LineStatus {
  const graded = events
    .filter((event) => event && event.kind === 'oral_point' && (event.correct === true || event.correct === false))
    .slice()
    .sort(compareEventTime);
  const history = graded.map(lineEventOf).filter((item): item is LineEvent => item !== null);

  let series: LearningEvent[] = [];
  // When the line was erased the latest time before now (it may have been forgotten since).
  let erasedEvent: LearningEvent | null = null;
  let erasedBeforeMiss: LearningEvent | null = null;
  for (const event of graded) {
    if (event.correct === true) {
      series.push(event);
      if (!erasedEvent && meetsRule(series[0], event)) erasedEvent = event;
    } else {
      if (erasedEvent) erasedBeforeMiss = erasedEvent;
      series = [];
      erasedEvent = null;
    }
  }

  const empty: LineStatus = {
    state: 'fresh',
    history,
    erasableFrom: null,
    erasedAt: null,
    erasedOn: null,
    lastNamedAt: null,
    wasErasedOn: null,
  };
  const last = graded.length > 0 ? graded[graded.length - 1] : null;
  if (!last) return empty;

  if (last.correct === false) {
    return erasedBeforeMiss
      ? { ...empty, state: 'returned', wasErasedOn: erasedBeforeMiss.local_date }
      : { ...empty, state: 'missed', wasErasedOn: null };
  }

  const start = series[0];
  const end = series[series.length - 1];
  if (erasedEvent && meetsRule(start, end)) {
    const lastNamed = serverTime(end);
    const due = lastNamed !== null && timeOf(now) - lastNamed >= CONFIRM_STALE_DAYS * DAY_MS;
    return {
      ...empty,
      state: due ? 'due' : 'erased',
      erasedAt: erasedEvent.created_at,
      erasedOn: erasedEvent.local_date,
      lastNamedAt: end.created_at,
    };
  }

  const begin = serverTime(start);
  const midnight = midnightAfter(start.local_date);
  let erasableFrom: string | null = null;
  if (begin !== null || midnight !== null) {
    const from = Math.max(begin !== null ? begin + CONFIRM_MIN_HOURS * HOUR_MS : -Infinity, midnight ?? -Infinity);
    erasableFrom = new Date(from).toISOString();
  }
  return { ...empty, state: 'once', erasableFrom };
}

// ------------------------------------------------------------------ the sheet

export type SheetCoverage = 'full' | 'partial' | 'none' | 'unverified' | null;

export interface SheetPoint {
  /** p1…p6 */
  id: string;
  /** The point as the examiner checks it (≤ 120). */
  title: string;
  /** The cheat-sheet line: shorter, with arrows and formulas; empty when it was not written yet. */
  short: string;
  essential: boolean;
  /** Word for word from the lecture. */
  source_quote: string;
  /** «Лекция «…», фрагмент 12». */
  source_label: string;
  material_id: string | null;
}

export interface SheetRubric {
  rubric_id: string;
  /** created_at of the rubric (ISO) or null. */
  built_at: string | null;
  /** What the model found in the lectures for this question. */
  coverage: 'full' | 'partial' | 'none';
  coverage_note: string;
  /** Short name of the question for the sheet; empty when it was not written yet. */
  topic: string;
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
  /** What the lectures lack (mapping), «товаров Гиффена». */
  missing_note: string;
  /** The question's current rubric, null when it was never written. */
  rubric: SheetRubric | null;
}

/**
 * lines — written; gap — nothing to write, the lectures lack it; unwritten — can be written (costs
 * a unit); unmapped — the list is not checked against the lectures yet.
 */
export type BlockKind = 'lines' | 'gap' | 'unwritten' | 'unmapped';

export interface SheetLine {
  /** `<rubric_id>:<point_id>` — the snapshot key. */
  key: string;
  questionId: string;
  pointId: string;
  /** The handwritten line: `short`, else the point's title. */
  text: string;
  title: string;
  essential: boolean;
  quote: string;
  quoteLabel: string;
  status: LineStatus;
}

export interface SheetBlock {
  questionId: string;
  /** The department's number, else the position. */
  number: string;
  section: number | null;
  /** The handwritten heading: the rubric's topic, else the wording up to its first full stop. */
  heading: string;
  /** The department's full wording (screen readers, the «почему» panel). */
  text: string;
  kind: BlockKind;
  lines: SheetLine[];
  /** «в лекциях нет», «в лекциях нет: товаров Гиффена», «ещё не сверено»; null when nothing is missing. */
  note: string | null;
  /** Every line is erased (or due). Never true for a gap or an unwritten question. */
  learned: boolean;
}

export interface SheetCounts {
  /** Lines on the sheet. */
  total: number;
  /** Lines still there: fresh, once, missed, returned. */
  left: number;
  erased: number;
  due: number;
  once: number;
  /** Questions the lectures do not cover at all (gap blocks). */
  gaps: number;
  /** Questions that can be written and are not. */
  unwritten: number;
  /** Questions not checked against the lectures yet. */
  unmapped: number;
  /** Questions whose every line is erased. */
  learned: number;
  questions: number;
}

export interface Sheet {
  blocks: SheetBlock[];
  counts: SheetCounts;
}

export const NOTE_NONE = 'в лекциях нет';
export const NOTE_PARTIAL = 'в лекциях не всё';
export const NOTE_UNMAPPED = 'ещё не сверено';
const HEADING_MAX = 80;

/** The question's number on the sheet: the department's label, else its position. */
export function blockNumber(question: Pick<SheetQuestion, 'label' | 'position'>): string {
  const label = typeof question.label === 'string' ? question.label.trim() : '';
  return label || String(question.position);
}

/** The wording up to its first full stop, at most 80 characters, cut at a word with «…». */
export function headingFromText(text: string): string {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const stop = clean.search(/[.?!;](\s|$)/);
  const first = stop > 0 ? clean.slice(0, stop) : clean;
  if (first.length <= HEADING_MAX) return first;
  const cut = first.slice(0, HEADING_MAX - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > 40 ? cut.slice(0, space) : cut).replace(/[\s,:–-]+$/, '')}…`;
}

export function lineKey(rubricId: string, pointId: string): string {
  return `${rubricId}:${pointId}`;
}

/** The journal item_keys of every line of these questions: what to read for the sheet. */
export function pointItemKeys(questions: readonly SheetQuestion[]): string[] {
  const keys: string[] = [];
  for (const question of questions) {
    const rubric = question.rubric;
    if (!rubric || rubric.coverage === 'none') continue;
    for (const point of rubric.points) keys.push(`oral:${rubric.rubric_id}:${point.id}`);
  }
  return keys;
}

function partialNote(question: SheetQuestion): string {
  const missing = (question.missing_note || question.rubric?.coverage_note || '').replace(/\s+/g, ' ').trim();
  return missing ? `${NOTE_NONE}: ${missing}` : NOTE_PARTIAL;
}

/** The kind of a question's block. */
export function blockKind(question: SheetQuestion): BlockKind {
  if (question.coverage === 'none') return 'gap';
  if (question.rubric) return question.rubric.coverage === 'none' || question.rubric.points.length === 0 ? 'gap' : 'lines';
  if (question.coverage === null) return 'unmapped';
  return 'unwritten';
}

/**
 * The whole sheet: blocks in the department's order with their lines' states, and the counts.
 * `events` are oral_point events (any order, other rubrics' events ignored).
 */
export function buildSheet(questions: readonly SheetQuestion[], events: readonly LearningEvent[], now: Date | number = new Date()): Sheet {
  const byKey = new Map<string, LearningEvent[]>();
  for (const event of events) {
    if (!event || event.kind !== 'oral_point' || typeof event.item_key !== 'string') continue;
    if (!event.item_key.startsWith('oral:')) continue;
    const key = event.item_key.slice(5);
    const list = byKey.get(key);
    if (list) list.push(event);
    else byKey.set(key, [event]);
  }

  const counts: SheetCounts = {
    total: 0,
    left: 0,
    erased: 0,
    due: 0,
    once: 0,
    gaps: 0,
    unwritten: 0,
    unmapped: 0,
    learned: 0,
    questions: questions.length,
  };
  const ordered = questions.slice().sort((a, b) => a.position - b.position);
  const blocks: SheetBlock[] = ordered.map((question) => {
    const kind = blockKind(question);
    const rubric = question.rubric;
    const heading = (rubric?.topic || '').trim() || headingFromText(question.text);
    const lines: SheetLine[] =
      kind === 'lines' && rubric
        ? rubric.points.map((point) => {
            const key = lineKey(rubric.rubric_id, point.id);
            return {
              key,
              questionId: question.question_id,
              pointId: point.id,
              text: (point.short || '').trim() || point.title,
              title: point.title,
              essential: point.essential,
              quote: point.source_quote,
              quoteLabel: point.source_label,
              status: lineStatus(byKey.get(key) ?? [], now),
            };
          })
        : [];
    let note: string | null = null;
    if (kind === 'gap') note = NOTE_NONE;
    else if (kind === 'unmapped') note = NOTE_UNMAPPED;
    else if (question.coverage === 'partial' || rubric?.coverage === 'partial') note = partialNote(question);

    for (const line of lines) {
      counts.total += 1;
      const state = line.status.state;
      if (LINE_LEFT.has(state)) counts.left += 1;
      if (state === 'erased') counts.erased += 1;
      if (state === 'due') counts.due += 1;
      if (state === 'once') counts.once += 1;
    }
    if (kind === 'gap') counts.gaps += 1;
    if (kind === 'unwritten') counts.unwritten += 1;
    if (kind === 'unmapped') counts.unmapped += 1;
    const learned = kind === 'lines' && lines.length > 0 && lines.every((line) => line.status.state === 'erased' || line.status.state === 'due');
    if (learned) counts.learned += 1;

    return {
      questionId: question.question_id,
      number: blockNumber(question),
      section: question.section,
      heading,
      text: question.text,
      kind,
      lines,
      note,
      learned,
    };
  });
  return { blocks, counts };
}

// ------------------------------------------------------------------ what changed since the last look

export type LineSnapshot = Record<string, LineState>;

export interface LineChange {
  key: string;
  questionId: string;
  from: LineState;
  to: LineState;
}

/** The states of every line, for the device's snapshot (`meldy_sheet_seen_<examId>`). */
export function snapshotOf(sheet: Sheet): LineSnapshot {
  const snapshot: LineSnapshot = {};
  for (const block of sheet.blocks) for (const line of block.lines) snapshot[line.key] = line.status.state;
  return snapshot;
}

/**
 * Lines whose state differs from the snapshot, in the sheet's order. A line the snapshot does not
 * know (newly written, a new rubric) is not a change: it is shown as written. No snapshot — nothing.
 */
export function sheetChanges(previous: LineSnapshot | null, sheet: Sheet): LineChange[] {
  if (!previous) return [];
  const changes: LineChange[] = [];
  for (const block of sheet.blocks) {
    for (const line of block.lines) {
      const before = previous[line.key];
      if (!before || before === line.status.state) continue;
      changes.push({ key: line.key, questionId: block.questionId, from: before, to: line.status.state });
    }
  }
  return changes;
}

/** «стёрто 2, побледнело 3, проступил 1»: what the changes did, for the line under the counter. */
export function changeSummary(changes: readonly LineChange[]): { erased: number; faded: number; returned: number; due: number; back: number } {
  let erased = 0;
  let faded = 0;
  let returned = 0;
  let due = 0;
  let back = 0;
  for (const change of changes) {
    if (change.to === 'erased' && change.from !== 'due') erased += 1;
    else if (change.to === 'once') faded += 1;
    else if (change.to === 'returned') returned += 1;
    else if (change.to === 'due') due += 1;
    else if (change.to === 'missed' || change.to === 'fresh') back += 1;
  }
  return { erased, faded, returned, due, back };
}
