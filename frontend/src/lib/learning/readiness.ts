/**
 * Readiness of exam questions, computed from the learning journal (contracts §6.5).
 *
 * History belongs to the normalised question text: events are keyed `q:<question_hash>`, so a
 * new exam with the same question sees earlier answers. Only answers given aloud
 * (`exam_answer`, written by record_oral_attempt) decide readiness. A self-rating
 * («знаю · плаваю · не знаю», kind `self_rating`) is shown next to it and never counts as an
 * answer. Pure module: no network, no storage.
 */
import type { LearningEvent, SelfRating } from '../../api/learning';

export type { SelfRating } from '../../api/learning';

export type Readiness = 'untested' | 'once' | 'confirmed' | 'not_passed';

/**
 * 'once' covers every pass made on a single local day (two passes today are still 'once'), so its
 * label names the day, not the number of answers; 'confirmed' needs passes on two different days.
 */
export const READINESS_LABELS: Record<Readiness, string> = {
  untested: 'не проверялось',
  once: 'зачтено в один день',
  confirmed: 'подтверждено',
  not_passed: 'не зачтено',
};

/** «Плаваю» is only a self-rating word; the readiness mark for a failed answer reads «не зачтено». */
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
  /** Answers given aloud (exam_answer events). */
  attempts: number;
  /** Distinct local days with a passed answer (grade 4 or 5). */
  passedDays: number;
  /** Local day of the latest answer. */
  lastDate: string | null;
  lastGrade: number | null;
  lastScorePct: number | null;
  /** Local day of the first answer. */
  firstDate: string | null;
  /** exam_sessions.id of the latest answer: the read-only protocol of that attempt. */
  lastSessionId: string | null;
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

/**
 * State of one question from its exam_answer events and its self_rating events (any order).
 *
 * Readiness, by answers in time order: none → untested; the last answer failed → not_passed;
 * at least two passed answers on at least two different local days and the last one passed →
 * confirmed; otherwise → once.
 */
export function questionState(answers: LearningEvent[], ratings: LearningEvent[]): QuestionState {
  const spoken = answers.filter((event) => event && event.kind === 'exam_answer').sort(compareEventTime);
  const graded = spoken.filter((event) => event.correct === true || event.correct === false);
  const passed = graded.filter((event) => event.correct === true);
  const passedDays = new Set(passed.map((event) => event.local_date)).size;
  const lastGraded = graded.length > 0 ? graded[graded.length - 1] : null;

  let readiness: Readiness;
  if (!lastGraded) readiness = 'untested';
  else if (lastGraded.correct === false) readiness = 'not_passed';
  else if (passed.length >= 2 && passedDays >= 2) readiness = 'confirmed';
  else readiness = 'once';

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
  };
}

/** One state per question hash; the key is the item_key without its 'q:' prefix. */
export function statesByHash(events: LearningEvent[]): Map<string, QuestionState> {
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
  for (const [hash, group] of groups) states.set(hash, questionState(group.answers, group.ratings));
  return states;
}

/**
 * Counts for an exam sheet. `hashes` holds one entry per question row, so the four counts always
 * add up to `total`. `since` is the earliest local day of an answer among these questions.
 */
export function examSummary(
  hashes: string[],
  states: Map<string, QuestionState>,
): { total: number; confirmed: number; once: number; notPassed: number; untested: number; since: string | null } {
  let confirmed = 0;
  let once = 0;
  let notPassed = 0;
  let untested = 0;
  let since: string | null = null;
  for (const hash of hashes) {
    const state = states.get(hash);
    switch (state?.readiness ?? 'untested') {
      case 'confirmed':
        confirmed += 1;
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
  return { total: hashes.length, confirmed, once, notPassed, untested, since };
}

/**
 * Self-assessment against answers given aloud (the illusion of knowing).
 * - `ratedKnow`: questions whose current self-rating is «знаю».
 * - `ratedKnowAnswered`: questions answered aloud while rated «знаю», judged by the rating in force
 *   at the latest graded answer (`ratingAtLastAnswer`). A rating changed after seeing the result
 *   neither hides a failed «знаю» answer nor turns an earlier pass into a confident one, so this
 *   is not a subset of `ratedKnow`.
 * - `ratedKnowPassed`: of those, the questions whose latest answer passed (readiness once or
 *   confirmed).
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
