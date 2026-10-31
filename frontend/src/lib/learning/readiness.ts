/**
 * Readiness of exam questions, computed from the learning journal (contracts §6.5, Jury_Check
 * 2026-10-03 item 3).
 *
 * History belongs to the normalised question text: events are keyed `q:<question_hash>`, so a
 * new exam with the same question sees earlier answers. Only answers to exam tickets
 * (`exam_answer`, written by record_oral_attempt, spoken or typed) decide readiness. A
 * self-rating («знаю · плаваю · не знаю», kind `self_rating`) is shown next to it and never counts
 * as an answer. Pure module: no network, no storage.
 *
 * The rule «подтверждено», in words. Graded answers are taken in the order of the server's
 * created_at. An answer of 4 or 5 is засчитан, a 2 or 3 is a провал; an answer without a grade
 * (correct null) neither starts nor breaks anything. The current series is the засчитанные
 * answers after the last провал: a провал starts the series over. The question is подтверждён
 * when the first and the last answer of the series are on different local days (local_date) and
 * at least 20 hours apart by the server clock (created_at). The memo's examples:
 * - засчитано at 10:00 and 18:00 on day 1 and at 8:00 on day 2: 22 hours and two days → подтверждено;
 * - засчитано at 23:59 and at 0:01: two days but two minutes → засчитано, не подтверждено;
 * - засчитано at 1:00 and at 21:00 of one day: 20 hours but one day → засчитано, не подтверждено;
 * - засчитано, провал, засчитано the next day → засчитано, не подтверждено (the series started
 *   over); one more засчитанный answer on a later day at least 20 hours after the restart →
 *   подтверждено.
 * Fourteen days after the last засчитанный answer a подтверждённый question is «пора проверить»
 * (`stale`): it still counts as подтверждён, the sheet says how old the confirmation is. The fourteen
 * days are calendar days of the student's day (local_date) to today in the browser's zone — the same
 * count the sheet shows as «N дней назад» (daysSinceDay), so «14 дней назад» is always «пора проверить»
 * and «13 дней назад» never is (before, the flag counted 14 × 24 hours of the server's clock).
 */
import type { LearningEvent, SelfRating } from '../../types/learning.ts';

// Re-exported for the modules that import it from here; without a module path, so the bot's copy of this file
// (scripts/sync_bot_plan.mjs) differs from it only in its import line.
export type { SelfRating };

export type Readiness = 'untested' | 'once' | 'confirmed' | 'not_passed';

/** The first and the last засчитанный answer of a series must be at least this far apart (server time). */
export const CONFIRM_MIN_HOURS = 20;
/** A confirmation whose last засчитанный answer is this many calendar days old is «пора проверить». */
export const CONFIRM_STALE_DAYS = 14;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * 'once' never names a day: under the 20-hour rule answers at 23:59 and 0:01 are on two days and
 * still not a confirmation (Jury_Check, critique of the plan).
 *
 * Since Ф1 (2026-10-07) the screen never says «засчитано»: it read as a credit from an AI. A passed
 * answer (grade 4 or 5 inside, oralGrade.ts) is one where «названо достаточно» — enough of the points,
 * what «Как считается» of the protocol says in words; a failed one — «названо недостаточно». The code
 * keeps its own words (passed, not_passed) for the same rule.
 */
export const READINESS_LABELS: Record<Readiness, string> = {
  untested: 'ещё не отвечали',
  once: 'ответ полный, ещё не выучено',
  confirmed: 'выучено',
  not_passed: 'ответ неполный',
};

/** «Плаваю» is only a self-rating word; the readiness mark for a failed answer reads «названо недостаточно». */
export const SELF_RATING_LABELS: Record<SelfRating, string> = {
  know: 'знаю',
  unsure: 'плаваю',
  dont_know: 'не знаю',
};

/** Stored in `learning_events.confidence` of a self_rating event. */
export const SELF_RATING_CONFIDENCE: Record<SelfRating, 1 | 2 | 3> = {
  dont_know: 1,
  unsure: 2,
  know: 3,
};

export interface QuestionState {
  readiness: Readiness;
  /** The latest self-rating, or null when the question was never rated. */
  selfRating: SelfRating | null;
  /**
   * The self-rating in force when the latest graded answer was given: the `confidence` stored with
   * that answer (record_oral_attempt keeps the rating the student had), otherwise the latest
   * self_rating event before it. A rating changed after the answer does not move it. Null without
   * answers or without an earlier rating.
   */
  ratingAtLastAnswer: SelfRating | null;
  /** Answers to the question's tickets (exam_answer events, graded or not). */
  attempts: number;
  /** Distinct local days with a passed answer (grade 4 or 5), over the whole history. */
  passedDays: number;
  /** Local day of the latest answer. */
  lastDate: string | null;
  lastGrade: number | null;
  lastScorePct: number | null;
  /** Local day of the first answer. */
  firstDate: string | null;
  /** exam_sessions.id of the latest answer: the read-only protocol of that attempt. */
  lastSessionId: string | null;
  /** created_at of the first засчитанный answer of the current series (null when the series is empty). */
  seriesStartAt: string | null;
  /** local_date of that answer. */
  seriesStartDate: string | null;
  /** created_at of the last засчитанный answer of the current series: the age of a confirmation counts from it. */
  lastPassAt: string | null;
  /** local_date of that answer. */
  lastPassDate: string | null;
  /** created_at of the first answer of the series that met both conditions (null unless confirmed). */
  confirmedAt: string | null;
  /** local_date of that answer: «Был подтверждён с 29 сентября». */
  confirmedOn: string | null;
  /** Confirmed, and the last засчитанный answer is CONFIRM_STALE_DAYS or more days old: «пора проверить». */
  stale: boolean;
  /**
   * 'once' only: the earliest moment a засчитанный answer would confirm the question — the later of
   * seriesStartAt + 20 hours and the local midnight after seriesStartDate (ISO). Null otherwise.
   */
  confirmableFrom: string | null;
  /** 'once' and that moment has come: a good answer now confirms the question. */
  awaiting: boolean;
}

/** Chronological order: server time, then the raw timestamp (microseconds), then id. */
export function compareEventTime(a: Pick<LearningEvent, 'created_at' | 'id'>, b: Pick<LearningEvent, 'created_at' | 'id'>): number {
  const ta = Date.parse(a.created_at);
  const tb = Date.parse(b.created_at);
  if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function ratingFromConfidence(confidence: unknown): SelfRating | null {
  if (confidence === 3) return 'know';
  if (confidence === 2) return 'unsure';
  if (confidence === 1) return 'dont_know';
  return null;
}

/** Server time of an event in ms, or null when it cannot be read (then no hour condition is met). */
export function serverTime(event: Pick<LearningEvent, 'created_at'>): number | null {
  const ms = Date.parse(event.created_at);
  return Number.isFinite(ms) ? ms : null;
}

/** Local midnight after a 'yyyy-MM-dd' day, in ms (browser time zone), or null. */
export function midnightAfter(key: string | null): number | null {
  const match = typeof key === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(key) : null;
  if (!match) return null;
  const next = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1);
  return Number.isNaN(next.getTime()) ? null : next.getTime();
}

/**
 * Calendar days from a local day 'yyyy-MM-dd' to the local day of `now` (browser time zone): 0 today, 1 yesterday;
 * null for no day. The one clock of «пора проверить» and of the sheet's «N дней назад» (components/exams/sheetModel).
 */
export function daysSinceDay(key: string | null | undefined, now: Date | number = new Date()): number | null {
  const match = typeof key === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(key) : null;
  if (!match) return null;
  const day = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(day.getTime())) return null;
  const at = new Date(timeOf(now));
  const today = new Date(at.getFullYear(), at.getMonth(), at.getDate());
  // Rounded: a day across a clock change is 23 or 25 hours long.
  return Math.round((today.getTime() - day.getTime()) / DAY_MS);
}

/**
 * Both conditions of the rule between the first answer of a series and a later one. The cheat sheet
 * erases a line by the same rule (lib/exams/cheatSheet.ts).
 */
export function meetsRule(first: LearningEvent, later: LearningEvent): boolean {
  if (!first.local_date || !later.local_date || later.local_date === first.local_date) return false;
  const from = serverTime(first);
  const to = serverTime(later);
  return from !== null && to !== null && to - from >= CONFIRM_MIN_HOURS * HOUR_MS;
}

function timeOf(now: Date | number | undefined): number {
  if (typeof now === 'number') return now;
  if (now instanceof Date) return now.getTime();
  return Date.now();
}

/**
 * State of one question from its exam_answer events and its self_rating events (any order).
 *
 * Readiness, by graded answers in server time: none → untested; the last one failed → not_passed;
 * the first and the last засчитанный answer of the current series (the passes after the last
 * провал) on different local days and at least 20 hours apart → confirmed; otherwise → once.
 * `now` decides only `stale` and `awaiting`.
 */
export function questionState(answers: LearningEvent[], ratings: LearningEvent[], now: Date | number = new Date()): QuestionState {
  const spoken = answers.filter((event) => event && event.kind === 'exam_answer').sort(compareEventTime);
  const graded = spoken.filter((event) => event.correct === true || event.correct === false);
  const passed = graded.filter((event) => event.correct === true);
  const passedDays = new Set(passed.map((event) => event.local_date)).size;
  const lastGraded = graded.length > 0 ? graded[graded.length - 1] : null;

  // The current series: the засчитанные answers after the last провал.
  let lastFail = -1;
  for (let i = graded.length - 1; i >= 0; i -= 1) {
    if (graded[i].correct === false) {
      lastFail = i;
      break;
    }
  }
  const series = graded.slice(lastFail + 1);
  const start = series.length > 0 ? series[0] : null;
  const end = series.length > 0 ? series[series.length - 1] : null;

  let readiness: Readiness;
  if (!lastGraded) readiness = 'untested';
  else if (lastGraded.correct === false) readiness = 'not_passed';
  else if (start && end && meetsRule(start, end)) readiness = 'confirmed';
  else readiness = 'once';

  const at = timeOf(now);
  let confirmedAt: string | null = null;
  let confirmedOn: string | null = null;
  let stale = false;
  let confirmableFrom: string | null = null;
  let awaiting = false;
  if (readiness === 'confirmed' && start && end) {
    const first = series.find((event) => event !== start && meetsRule(start, event)) ?? end;
    confirmedAt = first.created_at;
    confirmedOn = first.local_date;
    const days = daysSinceDay(end.local_date, at);
    stale = days !== null && days >= CONFIRM_STALE_DAYS;
  } else if (readiness === 'once' && start) {
    const begin = serverTime(start);
    const midnight = midnightAfter(start.local_date);
    if (begin !== null || midnight !== null) {
      const from = Math.max(begin !== null ? begin + CONFIRM_MIN_HOURS * HOUR_MS : -Infinity, midnight ?? -Infinity);
      confirmableFrom = new Date(from).toISOString();
      awaiting = at >= from;
    }
  }

  const first = spoken.length > 0 ? spoken[0] : null;
  const last = spoken.length > 0 ? spoken[spoken.length - 1] : null;
  const lastPayload = (last?.payload ?? {}) as Record<string, unknown>;
  const scoreFromEvent = last && typeof last.score === 'number' ? Math.round(last.score * 100) : null;

  const rated = ratings.filter((event) => event && event.kind === 'self_rating').sort(compareEventTime);
  /** The latest rating among the self_rating events sorted before `limit` (all of them without it). */
  const latestRating = (limit: LearningEvent | null): SelfRating | null => {
    for (let i = rated.length - 1; i >= 0; i -= 1) {
      if (limit && compareEventTime(rated[i], limit) >= 0) continue;
      const rating = ratingFromConfidence(rated[i].confidence);
      if (rating) return rating;
    }
    return null;
  };
  const selfRating = latestRating(null);
  const ratingAtLastAnswer = lastGraded ? ratingFromConfidence(lastGraded.confidence) ?? latestRating(lastGraded) : null;

  return {
    readiness,
    selfRating,
    ratingAtLastAnswer,
    attempts: spoken.length,
    passedDays,
    lastDate: last?.local_date ?? null,
    lastGrade: last ? finiteNumber(lastPayload.grade) : null,
    lastScorePct: last ? finiteNumber(lastPayload.score_pct) ?? scoreFromEvent : null,
    firstDate: first?.local_date ?? null,
    lastSessionId: last?.session_id ?? null,
    seriesStartAt: start?.created_at ?? null,
    seriesStartDate: start?.local_date ?? null,
    lastPassAt: end?.created_at ?? null,
    lastPassDate: end?.local_date ?? null,
    confirmedAt,
    confirmedOn,
    stale,
    confirmableFrom,
    awaiting,
  };
}

/** The state of a question nobody answered or rated (for rows without journal events). */
export function emptyQuestionState(): QuestionState {
  return questionState([], []);
}

/** One state per question hash; the key is the item_key without its 'q:' prefix. */
export function statesByHash(events: LearningEvent[], now: Date | number = new Date()): Map<string, QuestionState> {
  const groups = new Map<string, { answers: LearningEvent[]; ratings: LearningEvent[] }>();
  for (const event of events) {
    if (!event || typeof event.item_key !== 'string' || !event.item_key.startsWith('q:')) continue;
    if (event.kind !== 'exam_answer' && event.kind !== 'self_rating') continue;
    const hash = event.item_key.slice(2);
    if (!hash) continue;
    let group = groups.get(hash);
    if (!group) {
      group = { answers: [], ratings: [] };
      groups.set(hash, group);
    }
    if (event.kind === 'exam_answer') group.answers.push(event);
    else group.ratings.push(event);
  }
  const states = new Map<string, QuestionState>();
  for (const [hash, group] of groups) states.set(hash, questionState(group.answers, group.ratings, now));
  return states;
}

/**
 * Counts for an exam sheet. `hashes` holds one entry per question row, so the four counts always
 * add up to `total`. `since` is the earliest local day of an answer among these questions. `stale`
 * counts the confirmed questions that are «пора проверить»; they stay in `confirmed`.
 */
export function examSummary(
  hashes: string[],
  states: Map<string, QuestionState>,
): { total: number; confirmed: number; once: number; notPassed: number; untested: number; since: string | null; stale: number } {
  let confirmed = 0;
  let once = 0;
  let notPassed = 0;
  let untested = 0;
  let stale = 0;
  let since: string | null = null;
  for (const hash of hashes) {
    const state = states.get(hash);
    switch (state?.readiness ?? 'untested') {
      case 'confirmed':
        confirmed += 1;
        if (state?.stale) stale += 1;
        break;
      case 'once':
        once += 1;
        break;
      case 'not_passed':
        notPassed += 1;
        break;
      default:
        untested += 1;
    }
    if (state?.firstDate && (since === null || state.firstDate < since)) since = state.firstDate;
  }
  return { total: hashes.length, confirmed, once, notPassed, untested, since, stale };
}

/**
 * Self-assessment against answers (the illusion of knowing).
 * - `ratedKnow`: questions whose current self-rating is «знаю».
 * - `ratedKnowAnswered`: questions answered while rated «знаю», judged by the rating in force at
 *   the latest graded answer (`ratingAtLastAnswer`). A rating changed after seeing the result
 *   neither hides a failed «знаю» answer nor turns an earlier pass into a confident one, so this
 *   is not a subset of `ratedKnow`.
 * - `ratedKnowPassed`: of those, the questions whose latest answer passed — «названо достаточно»
 *   (readiness once or confirmed).
 * Enough data means at least three such answered questions.
 */
export function confidenceVsConfirmed(
  hashes: string[],
  states: Map<string, QuestionState>,
): { ratedKnow: number; ratedKnowAnswered: number; ratedKnowPassed: number; enoughData: boolean } {
  let ratedKnow = 0;
  let ratedKnowAnswered = 0;
  let ratedKnowPassed = 0;
  for (const hash of hashes) {
    const state = states.get(hash);
    if (!state) continue;
    if (state.selfRating === 'know') ratedKnow += 1;
    if (state.ratingAtLastAnswer !== 'know' || state.attempts === 0 || state.readiness === 'untested') continue;
    ratedKnowAnswered += 1;
    if (state.readiness === 'once' || state.readiness === 'confirmed') ratedKnowPassed += 1;
  }
  return { ratedKnow, ratedKnowAnswered, ratedKnowPassed, enoughData: ratedKnowAnswered >= 3 };
}
