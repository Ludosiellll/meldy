/**
 * Peak 3 (redesign spec 5.9): after an answer is saved, the answer screen leaves a flag in
 * sessionStorage `meldy_exam_peak_<examId>` (the question hash and its state before the answer).
 * Back on the sheet the journal is read again, the states are compared, and only then the row
 * scrolls into view and its new readiness mark is drawn — never on a timer, never twice.
 *
 * The flag is read tolerantly (one hash, an object or a list), and the «before» state is
 * recomputed from the journal when the flag does not carry it.
 */
import type { LearningEvent } from '../../api/learning';
import { localDate } from '../../api/learning';
import { compareEventTime, questionState, type QuestionState, type Readiness } from '../../lib/learning/readiness';
import { formatDay, GRADE_WORDS } from '../../lib/exams/format';
import { pct } from './sheetModel';

export function peakKey(examId: string): string {
  return `meldy_exam_peak_${examId}`;
}

export interface PeakFlag {
  hash: string | null;
  questionId: string | null;
  before: Readiness | null;
}

const READINESS: Readiness[] = ['untested', 'once', 'confirmed', 'not_passed'];
const HASH = /^[0-9a-f]{32}$/;

function readinessOf(value: unknown): Readiness | null {
  return typeof value === 'string' && (READINESS as string[]).includes(value) ? (value as Readiness) : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function flagOf(value: unknown): PeakFlag | null {
  if (typeof value === 'string') {
    const hash = value.trim().toLowerCase().replace(/^q:/, '');
    return HASH.test(hash) ? { hash, questionId: null, before: null } : null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const rawHash = str(record.hash) ?? str(record.question_hash) ?? str(record.questionHash) ?? str(record.item_key);
  const hash = rawHash ? rawHash.toLowerCase().replace(/^q:/, '') : null;
  const questionId = str(record.question_id) ?? str(record.questionId) ?? str(record.exam_question_id) ?? str(record.examQuestionId);
  const beforeValue = record.before ?? record.previous ?? record.prev ?? record.readiness_before ?? record.readiness;
  const before =
    readinessOf(beforeValue) ??
    (beforeValue && typeof beforeValue === 'object' ? readinessOf((beforeValue as Record<string, unknown>).readiness) : null);
  if (!(hash && HASH.test(hash)) && !questionId) return null;
  return { hash: hash && HASH.test(hash) ? hash : null, questionId, before };
}

/** Parses whatever the answer screen stored: a hash, an object, a list, or {items|questions: […]}. */
export function parsePeakFlags(raw: string | null): PeakFlag[] {
  if (!raw) return [];
  let value: unknown = raw;
  try {
    value = JSON.parse(raw);
  } catch {
    value = raw;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const nested = record.items ?? record.questions ?? record.answers;
    if (Array.isArray(nested)) value = nested;
  }
  const list = Array.isArray(value) ? value : [value];
  const flags: PeakFlag[] = [];
  for (const item of list) {
    const flag = flagOf(item);
    if (flag && !flags.some((known) => (flag.hash && known.hash === flag.hash) || (flag.questionId && known.questionId === flag.questionId))) {
      flags.push(flag);
    }
  }
  return flags.slice(0, 4);
}

/** Reads the flag once: it is removed right away, so the effect plays a single time. */
export function takePeakFlags(examId: string): PeakFlag[] {
  try {
    const key = peakKey(examId);
    const raw = window.sessionStorage.getItem(key);
    if (raw !== null) window.sessionStorage.removeItem(key);
    return parsePeakFlags(raw);
  } catch {
    return [];
  }
}

export interface PeakChange {
  before: QuestionState;
  after: QuestionState;
  /** The answer just given (the latest exam_answer of the question). */
  latest: LearningEvent;
}

/**
 * The state before and after the latest answer of a question. `beforeHint` (from the flag) wins over
 * the recomputed one. Null when the question has no answer in the journal.
 */
export function peakChange(answers: LearningEvent[], ratings: LearningEvent[], beforeHint: Readiness | null): PeakChange | null {
  const spoken = answers.filter((event) => event.kind === 'exam_answer').sort(compareEventTime);
  if (spoken.length === 0) return null;
  const latest = spoken[spoken.length - 1];
  const after = questionState(spoken, ratings);
  const recomputed = questionState(spoken.slice(0, -1), ratings);
  const before = beforeHint ? { ...recomputed, readiness: beforeHint } : recomputed;
  return { before, after, latest };
}

function gradeOf(event: LearningEvent): number | null {
  const value = event.payload?.grade;
  const grade = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isInteger(grade) && grade >= 2 && grade <= 5 ? grade : null;
}

function dayWord(key: string, today: string, now: Date): string {
  return key === today ? 'сегодня' : formatDay(key, now);
}

function capitalize(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

/** The pass before the latest answer: «29 сентября — зачтено». */
function previousPassDay(answers: LearningEvent[], latest: LearningEvent): string | null {
  const earlier = answers
    .filter((event) => event.kind === 'exam_answer' && event.id !== latest.id && event.correct === true)
    .sort(compareEventTime);
  return earlier.length > 0 ? earlier[earlier.length - 1].local_date : null;
}

/** The first day the question became confirmed, for «Был подтверждён с 29 сентября». */
function confirmedSinceDay(answers: LearningEvent[], latest: LearningEvent): string | null {
  const passes = answers
    .filter((event) => event.kind === 'exam_answer' && event.id !== latest.id && event.correct === true)
    .sort(compareEventTime);
  const days = Array.from(new Set(passes.map((event) => event.local_date)));
  return days.length >= 2 ? days[1] : null;
}

export interface PeakCounts {
  total: number;
  confirmed: number;
  once: number;
  notPassed: number;
  since: string | null;
}

export interface PeakText {
  /** Under the row, 15 muted. */
  because: string;
  /** Meldy's column. */
  title: string;
  before: number | null;
  after: number;
  total: number | null;
  statement: string;
  fine: string[];
  /** A new mark is drawn (false when nothing visible changes). */
  draws: boolean;
}

/** Words of the five transitions of the spec's table (and the neighbours they imply). */
export function peakText(input: {
  change: PeakChange;
  answers: LearningEvent[];
  number: string;
  counts: PeakCounts;
  confirmedTicketsPct: number | null;
  now?: Date;
}): PeakText {
  const { change, answers, number, counts } = input;
  const now = input.now ?? new Date();
  const today = localDate(now);
  const latestDay = change.latest.local_date || today;
  const when = dayWord(latestDay, today, now);
  const grade = gradeOf(change.latest);
  const gradeWord = grade !== null ? `«${GRADE_WORDS[grade]}»` : 'ответ без оценки';
  const from = change.before.readiness;
  const to = change.after.readiness;
  const confirmedTickets = input.confirmedTicketsPct !== null ? ` Билетов, где подтверждены оба вопроса, — ${pct(input.confirmedTicketsPct)}.` : '';

  if (to === 'confirmed' && from !== 'confirmed') {
    const passDay = previousPassDay(answers, change.latest);
    const head = passDay ? `${capitalize(formatDay(passDay, now))} — зачтено. ` : '';
    return {
      because: `${head}${capitalize(when)} снова ${gradeWord}: два зачёта в разные дни, вопрос подтверждён.`,
      title: 'Подтверждено ответами',
      before: Math.max(0, counts.confirmed - 1),
      after: counts.confirmed,
      total: counts.total,
      statement: `Вопрос ${number} подтверждён ответом, который вы дали только что.`,
      fine: [
        `Подтверждено — значит, зачтено дважды, в разные дни.${counts.since ? ` С ${formatDay(counts.since, now)}: 0 → ${counts.confirmed}.` : ''}${confirmedTickets}`,
      ],
      draws: true,
    };
  }
  if (to === 'not_passed' && from === 'confirmed') {
    const since = confirmedSinceDay(answers, change.latest);
    return {
      because: `Был подтверждён${since ? ` с ${formatDay(since, now)}` : ''}, ${when} — ${gradeWord}. Подтверждение снято.`,
      title: 'Подтверждено ответами',
      before: counts.confirmed + 1,
      after: counts.confirmed,
      total: counts.total,
      statement: `Вопрос ${number}: последний ответ не зачтён, подтверждение снято.`,
      fine: ['Подтверждено — значит, зачтено дважды, в разные дни, и последний ответ зачтён.'],
      draws: true,
    };
  }
  if (to === 'not_passed') {
    return {
      because: `${capitalize(when)} — ${gradeWord}, вопрос пока не зачтён. В режиме «Чаще слабые» он будет выпадать чаще.`,
      title: 'Не зачтено',
      before: from === 'not_passed' ? counts.notPassed : Math.max(0, counts.notPassed - 1),
      after: counts.notPassed,
      total: null,
      statement: `Вопрос ${number}: ответ, который вы дали только что, не зачтён.`,
      fine: [],
      draws: from !== 'not_passed',
    };
  }
  if (to === 'once' && from === 'once') {
    return {
      because: 'Снова зачтено, но в тот же день. Для подтверждения нужен зачёт в другой день.',
      title: 'Зачтено в один день',
      before: null,
      after: counts.once,
      total: null,
      statement: `Вопрос ${number} снова зачтён.`,
      fine: [],
      draws: false,
    };
  }
  if (to === 'once') {
    return {
      because: `Зачтено ${when}. Второй зачёт в другой день подтвердит вопрос.`,
      title: 'Зачтено в один день',
      before: Math.max(0, counts.once - 1),
      after: counts.once,
      total: null,
      statement: `Вопрос ${number} зачтён ответом, который вы дали только что.`,
      fine: [],
      draws: true,
    };
  }
  // Still confirmed: one more good answer.
  return {
    because: `${capitalize(when)} снова ${gradeWord}: вопрос остаётся подтверждённым.`,
    title: 'Подтверждено ответами',
    before: null,
    after: counts.confirmed,
    total: counts.total,
    statement: `Вопрос ${number} остаётся подтверждённым.`,
    fine: [],
    draws: false,
  };
}
