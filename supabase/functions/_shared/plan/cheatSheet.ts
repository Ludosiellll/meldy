/**
 * The state of every answer point of an oral exam's questions, from the answer journal. Pure module: no network, no
 * storage. «Осталось выучить» decides by it when an oral question is learned (lib/exams/learnFacts.ts, the server's
 * learn_left, lib/containers/oralParts.ts for the plan and the Telegram bot's copy). The words «sheet», «line» and
 * «erased» are those of the cheat sheet this module was written for (notes: 10_Project/Vanishing_Cheat_Sheet_Spec_2026-10-05);
 * the sheet itself left the product on 2026-10-21, its rule stayed.
 *
 * A line is one answer point of a question's current rubric (the points the examiner checks the
 * answer by). Its events are the journal rows of that point:
 * - `oral_point`, written by record_oral_attempt with every checked answer;
 * - `sheet_peek`, written when the student uncovered the point («Показать пункты»).
 * An event belongs to a line when it is about the same question (payload.question_hash) and the
 * same point by its words (payload.title, normalised): a rubric rebuilt under the same id with other
 * points does not inherit their history, a rubric rebuilt with the same point (after re-mapping)
 * does. An event without a title falls back to its item_key.
 *
 * What counts in an answer:
 * - «назван»: the point was covered in the answer itself;
 * - «не назван»: partial, wrong, missing — and missing but named only after the examiner asked
 *   about it (the student did not recall it alone);
 * - skipped: an unrated point, and a naming on the same local day after the point was uncovered.
 * The rule is «подтверждено» of readiness.ts: the series is the namings after the last miss, and
 * the line is erased (learned) when the first and the last naming of the series are on different local days
 * and at least 20 hours apart by the server clock. States:
 * - fresh — never named;
 * - rubbed — named, the series does not erase yet;
 * - erased — learned;
 * - due — erased, and its check is due: 5, 12, 25, 50 days after the last naming as checks pass
 *   (a check is a naming of a due line; an erased line named before its check is due only waits
 *   that long again from the new naming, at the same stage — five days in a row are no three
 *   checks), or in the last days before the exam a line not named for 4 days;
 * - missed — the last event is a miss and the line was never erased;
 * - returned — the last event is a miss and the line had been erased.
 */
import type { LearningEvent } from './learning.ts';
import { CONFIRM_MIN_HOURS, compareEventTime, meetsRule, midnightAfter, serverTime } from './readiness.ts';

export type LineState = 'fresh' | 'rubbed' | 'erased' | 'due' | 'missed' | 'returned';

/** Days after the last naming until an erased line is checked again; the stage grows with each passed check. */
export const DUE_DAYS: readonly number[] = [5, 12, 25, 50];
/** Before the exam (0–2 days to go) an erased line not named for this many days is due. */
export const EXAM_EVE_DAYS = 2;
export const EXAM_EVE_STALE_DAYS = 4;

/**
 * A question in the lectures (the mapping says «есть» or «частично») without answer points: their quotes failed
 * the check twice (oral_rubric_failures, a group copy's placeholder) or the writing found nothing to quote. One
 * phrase on the sheet, after a write and in the teacher's report; «нет в лекциях» is said only of a «нет» question
 * (live run of release 29.1: «Есть в лекциях», two fragments and «Пунктов нет: в лекциях не нашлось…»).
 */
export const POINTS_NOT_WRITTEN = 'Пункты не записаны: Meldy не смог подтвердить их цитатами из лекций';

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
  /** returned: the local day the line had been erased on before the miss, and the naming that erased it. */
  wasErasedOn: string | null;
  wasErasedAt: string | null;
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

/** Signs that carry a point's meaning: «P > MC» and «P < MC» are two points, not one. */
const MEANING_SIGNS = /[<>=≤≥≠+−×÷↑↓→←⇒]/gu;

/**
 * Point words compared the way the journal stores them: lower case, «ё» as «е», letters, digits and
 * the signs of comparison, arithmetic and direction (each a word of its own: «P>MC» is «P > MC»).
 */
export function normalizeTitle(text: unknown): string {
  return typeof text === 'string'
    ? text
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(MEANING_SIGNS, ' $& ')
        .replace(/[^\p{L}\p{N}<>=≤≥≠+−×÷↑↓→←⇒]+/gu, ' ')
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
 * When an erased line becomes due: `days` of its stage after the last naming (`named`, server ms),
 * and — on a local `day` in the last days before the exam — 4 days after it at the latest.
 */
function dueMoment(named: number | null, checks: number, day: string, examDate: string | null | undefined): number | null {
  if (named === null) return null;
  const due = named + DUE_DAYS[Math.min(checks, DUE_DAYS.length - 1)] * DAY_MS;
  const exam = examDate ? dayNumber(examDate) : null;
  const on = dayNumber(day);
  if (exam !== null && on !== null && exam - on >= 0 && exam - on <= EXAM_EVE_DAYS) return Math.min(due, named + EXAM_EVE_STALE_DAYS * DAY_MS);
  return due;
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
        // A check passes when it was due; named earlier, the line only waits its stage again from now.
        const due = dueMoment(lastNamed ? serverTime(lastNamed) : null, checks, event.local_date, options.examDate);
        const time = serverTime(event);
        if (due !== null && time !== null && time >= due) checks += 1;
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
    wasErasedAt: null,
    peekedToday,
    checks: 0,
  };
  if (last === null) return status;
  if (last === 'missed') {
    return wasErased ? { ...status, state: 'returned', wasErasedOn: wasErased.local_date, wasErasedAt: wasErased.created_at } : { ...status, state: 'missed' };
  }

  if (erased && lastNamed) {
    // The last days before the exam: a line not named for 4 days is checked now.
    const dueMs = dueMoment(serverTime(lastNamed), checks, today, options.examDate);
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
  /** The point's short words (≤ 56), empty when there are none: then the title stands for them. */
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
  /**
   * In the lectures, but its points failed the quote check twice for these lectures (oral_rubric_failures): there is
   * nothing to write, the server does not count it in to_write — the same as a group link's copy, a gap.
   */
  unwritable?: boolean;
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
  /** The point's short words: `short`, else the point's title. */
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
  /** The department's wording. */
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

export interface Sheet {
  blocks: SheetBlock[];
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
  if (question.unwritable) return 'gap';
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
 * One answer names a point once: when an answer's events of two points both match a line (twin
 * points of a rebuilt rubric with the same words), the line keeps the one of its own point id,
 * else the first by id — never both, which would name and miss it at the same minute.
 */
function onePerAnswer(events: LearningEvent[], pointId: string): LearningEvent[] {
  const answers = new Map<string, LearningEvent>();
  const rest: LearningEvent[] = [];
  const own = (event: LearningEvent) => payloadOf(event).point_id === pointId;
  for (const event of events) {
    const session = event.kind === 'oral_point' ? event.session_id : null;
    if (!session) {
      rest.push(event);
      continue;
    }
    const kept = answers.get(session);
    if (!kept || (own(event) && !own(kept)) || (own(event) === own(kept) && event.id < kept.id)) answers.set(session, event);
  }
  return answers.size === 0 ? rest : [...rest, ...answers.values()];
}

/**
 * Every question as a block in the department's order with its lines' states.
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
                onePerAnswer(
                  pool.filter((event) => belongs(event, identity)),
                  point.id,
                ),
                now,
                options,
              ),
            };
          })
        : [];

    const deciding = lines.some((line) => line.essential) ? lines.filter((line) => line.essential) : lines;
    const learned = deciding.length > 0 && deciding.every((line) => line.status.state === 'erased');

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
  return { blocks };
}
