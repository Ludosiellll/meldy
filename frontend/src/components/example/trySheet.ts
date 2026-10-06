import { useCallback, useMemo, useState } from 'react';
import type { LearningEvent } from '../../api/learning';
import type { SheetWriteState } from '../../api/cheatSheet';
import { buildSheet, localDayOf, type SheetLine, type SheetQuestion } from '../../lib/exams/cheatSheet';
import type { CheckStatus } from '../../lib/oral/oralApi';
import { EXAMPLE_EXAM, EXAMPLE_QUESTIONS, exampleQuestion, exampleRubric, type ExampleQuestion } from '../../data/example';
import type { CheatSheetData } from '../exams/sheet/useCheatSheet';

/**
 * The example's cheat sheet (/try, sheet spec 4.3): «Микроэкономика» written from the start (the
 * points' short lines are written by hand in data/example), and yesterday's answers of the example
 * — at this very time a day ago (the 20-hour rule), questions 5 and 9 — so their named lines are
 * half erased. The guest's answers, peeks and the time of the first visit live only in this tab
 * (sessionStorage `meldy_try_sheet`): nothing goes to the server, as everywhere in the example.
 */

export const TRY_SHEET_KEY = 'meldy_try_sheet';
/** The questions the guest answered just now: the sheet plays what they changed (the after-answer flag). */
export const TRY_PEAK_KEY = 'meldy_try_peak';
/** «Шпаргалка» or «Вопросы»: the example's view, for this tab. */
export const TRY_VIEW_KEY = 'meldy_try_view';

const DAY_MS = 86_400_000;
const SEED_PREFIX = 'try-seed-';

export interface TryFollowup {
  pointId: string;
  question: string;
  answer: string;
  status: CheckStatus;
  judgedBy: 'check' | 'keywords' | null;
}

/** One answer of the example: a seeded one of yesterday or the guest's own. */
export interface TryAnswer {
  session: string;
  questionId: string;
  /** When it was given (ms). */
  at: number;
  transcript: string;
  /** Every point of the question: its status in this answer. */
  statuses: Record<string, CheckStatus>;
  followup: TryFollowup | null;
}

interface TryPeek {
  questionId: string;
  pointId: string;
  at: number;
}

interface TryStore {
  v: 1;
  /** The first visit of this tab: yesterday's answers are a day before it. */
  seededAt: number;
  answers: TryAnswer[];
  peeks: TryPeek[];
}

/**
 * Yesterday's answers of the example. Their words name exactly these points by the example's key
 * words (trySheet.test.ts holds them to it), so their protocols read true.
 */
export const SEEDED_ANSWERS: ReadonlyArray<{ questionId: string; transcript: string; named: readonly string[] }> = [
  {
    questionId: 'q5',
    transcript:
      'Эластичность — это реакция спроса на цену: на сколько процентов он изменится, если цена изменится на один процент. Считают как отношение процентного изменения спроса к процентному изменению цены. Если модуль больше единицы, спрос эластичный.',
    named: ['p1', 'p2', 'p3'],
  },
  {
    questionId: 'q9',
    transcript: 'Явные издержки — это прямые платежи фирмы: зарплата, аренда. Бухгалтерская прибыль — это выручка минус явные издержки.',
    named: ['p1', 'p3'],
  },
];

/** «Вставить ответ примера» on question 5: it names every main point and one more, so they erase. */
export const EXAMPLE_ANSWER_Q5 =
  'Эластичность показывает реакцию спроса на цену: на сколько процентов изменится спрос, если цена изменится на один процент. ' +
  'Её считают как отношение процентного изменения спроса к процентному изменению цены. ' +
  'Если модуль больше единицы, спрос эластичный, если меньше единицы — неэластичный. ' +
  'Знак у эластичности обычно отрицательный, поэтому сравнивают модуль.';

/** The question whose answer «Вставить ответ примера» offers. */
export const EXAMPLE_ANSWER_QUESTION = 'q5';

/** A stable 32-hex «hash» of an example question: the sheet keys the journal by it. */
export function exampleHash(questionId: string): string {
  const number = exampleQuestion(questionId)?.number ?? 0;
  return `e${number.toString(16).padStart(31, '0')}`;
}

export function exampleRubricId(questionId: string): string {
  return `example-${questionId}`;
}

function seededAnswers(seededAt: number): TryAnswer[] {
  return SEEDED_ANSWERS.map((seed) => {
    const question = exampleQuestion(seed.questionId) as ExampleQuestion;
    const statuses: Record<string, CheckStatus> = {};
    question.points.forEach((_, index) => {
      const id = `p${index + 1}`;
      statuses[id] = seed.named.includes(id) ? 'covered' : 'missing';
    });
    return { session: `${SEED_PREFIX}${seed.questionId}`, questionId: seed.questionId, at: seededAt - DAY_MS, transcript: seed.transcript, statuses, followup: null };
  });
}

export function isSeededSession(session: string): boolean {
  return session.startsWith(SEED_PREFIX);
}

function parseStore(raw: string | null): TryStore | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<TryStore>;
    if (!value || value.v !== 1 || typeof value.seededAt !== 'number' || !Number.isFinite(value.seededAt)) return null;
    const answers = (Array.isArray(value.answers) ? value.answers : []).filter(
      (answer): answer is TryAnswer =>
        Boolean(answer) &&
        typeof answer.session === 'string' &&
        typeof answer.questionId === 'string' &&
        exampleQuestion(answer.questionId) !== null &&
        typeof answer.at === 'number' &&
        typeof answer.transcript === 'string' &&
        Boolean(answer.statuses) &&
        typeof answer.statuses === 'object',
    );
    const peeks = (Array.isArray(value.peeks) ? value.peeks : []).filter(
      (peek): peek is TryPeek => Boolean(peek) && typeof peek.questionId === 'string' && typeof peek.pointId === 'string' && typeof peek.at === 'number',
    );
    return { v: 1, seededAt: value.seededAt, answers, peeks };
  } catch {
    return null;
  }
}

/** The tab's example: yesterday's answers on the first read, then whatever the guest added. */
export function readTryStore(now: number = Date.now()): TryStore {
  let stored: TryStore | null = null;
  try {
    stored = parseStore(window.sessionStorage.getItem(TRY_SHEET_KEY));
  } catch {
    stored = null;
  }
  if (stored) return stored;
  const fresh: TryStore = { v: 1, seededAt: now, answers: seededAnswers(now), peeks: [] };
  writeTryStore(fresh);
  return fresh;
}

function writeTryStore(store: TryStore) {
  try {
    window.sessionStorage.setItem(TRY_SHEET_KEY, JSON.stringify(store));
  } catch {
    // A private window: the example still works for this page.
  }
}

/** The guest's answer joins the example's journal (once per session id). */
export function saveTryAnswer(answer: TryAnswer): TryStore {
  const store = readTryStore(answer.at);
  if (store.answers.some((item) => item.session === answer.session)) return store;
  const next = { ...store, answers: [...store.answers, answer] };
  writeTryStore(next);
  return next;
}

export function findTryAnswer(session: string | null): TryAnswer | null {
  if (!session) return null;
  return readTryStore().answers.find((answer) => answer.session === session) ?? null;
}

/** Back on the sheet, the guest's last answer is played (sheet spec 4.2): read once. */
export function setTryPeak(questionId: string) {
  try {
    window.sessionStorage.setItem(TRY_PEAK_KEY, JSON.stringify([{ hash: exampleHash(questionId), question_id: questionId }]));
  } catch {
    // The sheet just shows the result.
  }
}

export function takeTryPeak(): string | null {
  try {
    const raw = window.sessionStorage.getItem(TRY_PEAK_KEY);
    window.sessionStorage.removeItem(TRY_PEAK_KEY);
    return raw;
  } catch {
    return null;
  }
}

/** The example's questions as the sheet reads them from the server: the points with their short lines. */
export function trySheetQuestions(): SheetQuestion[] {
  return EXAMPLE_QUESTIONS.map((question) => {
    const rubric = exampleRubric(question);
    return {
      question_id: question.id,
      position: question.number,
      label: String(question.number),
      section: null,
      text: question.text,
      question_hash: exampleHash(question.id),
      coverage: question.coverage,
      coverage_method: 'llm',
      coverage_reason: question.reason,
      missing_note: question.missing,
      rubric: rubric
        ? {
            rubric_id: exampleRubricId(question.id),
            built_at: null,
            coverage: rubric.coverage,
            coverage_note: rubric.coverage_note,
            materials: rubric.materials,
            points: rubric.points.map((point, index) => ({
              id: point.id,
              title: point.title,
              short: question.points[index]?.short ?? '',
              essential: point.essential,
              source_quote: point.source_quote,
              source_ids: point.source_ids,
            })),
          }
        : null,
      rebuilt: false,
    };
  });
}

function eventBase(at: number) {
  return { created_at: new Date(at).toISOString(), local_date: localDayOf(at), material_id: null, score: null, confidence: null, source_ids: [] as string[] };
}

/** An answer's oral_point events, as record_oral_attempt writes them for a real one. */
export function answerEvents(answer: TryAnswer): LearningEvent[] {
  const question = exampleQuestion(answer.questionId);
  if (!question) return [];
  const rubricId = exampleRubricId(question.id);
  return question.points.map((point, index) => {
    const id = `p${index + 1}`;
    const status = answer.statuses[id] ?? 'missing';
    const asked = answer.followup?.pointId === id ? answer.followup.status : null;
    return {
      id: `${answer.session}-${id}`,
      ...eventBase(answer.at),
      kind: 'oral_point',
      item_key: `oral:${rubricId}:${id}`,
      correct: status === 'covered' || asked === 'covered',
      session_id: answer.session,
      payload: { v: 1, question_hash: exampleHash(question.id), rubric_id: rubricId, point_id: id, title: point.title, status, essential: point.essential, live: true, followup_status: asked },
    };
  });
}

function peekEvent(peek: TryPeek, index: number): LearningEvent | null {
  const question = exampleQuestion(peek.questionId);
  const point = question?.points[Number(peek.pointId.slice(1)) - 1];
  if (!question || !point) return null;
  const rubricId = exampleRubricId(question.id);
  return {
    id: `try-peek-${index}`,
    ...eventBase(peek.at),
    kind: 'sheet_peek',
    item_key: `peek:${rubricId}:${peek.pointId}`,
    correct: null,
    session_id: null,
    payload: { v: 1, question_hash: exampleHash(question.id), rubric_id: rubricId, point_id: peek.pointId, title: point.title, exam_id: EXAMPLE_EXAM.id },
  };
}

export function tryEvents(store: TryStore): LearningEvent[] {
  return [...store.answers.flatMap(answerEvents), ...store.peeks.map(peekEvent).filter((event): event is LearningEvent => event !== null)];
}

const IDLE_WRITE: SheetWriteState = {
  examId: EXAMPLE_EXAM.id,
  phase: 'idle',
  done: 0,
  total: 0,
  written: 0,
  failed: 0,
  busy: 0,
  limit: false,
  results: {},
  message: null,
  seq: 0,
  stopping: false,
};
const NO_FRESH: ReadonlySet<string> = new Set();
const NO_NOTES: ReadonlyMap<string, string> = new Map();
const noop = () => undefined;

/** The example's sheet in the shape of a real one (useCheatSheet): written, nothing to write or read. */
export function useTrySheetData(): CheatSheetData {
  const [store, setStore] = useState(() => readTryStore());
  const [now, setNow] = useState(() => Date.now());
  const questions = useMemo(() => trySheetQuestions(), []);
  const events = useMemo(() => tryEvents(store), [store]);
  const sheet = useMemo(() => buildSheet(questions, events, now), [questions, events, now]);
  const written = useMemo(() => questions.filter((question) => question.rubric).length, [questions]);
  const peek = useCallback((line: SheetLine) => {
    const at = Date.now();
    const current = readTryStore(at);
    const next = { ...current, peeks: [...current.peeks, { questionId: line.questionId, pointId: line.pointId, at }] };
    writeTryStore(next);
    setStore(next);
    setNow(at);
  }, []);
  return {
    status: 'ready',
    error: null,
    questions,
    events,
    eventsState: 'ready',
    eventsError: null,
    toWrite: 0,
    units: 0,
    serverJob: null,
    write: IDLE_WRITE,
    sheet,
    now,
    freshIds: NO_FRESH,
    writeNotes: NO_NOTES,
    written,
    reload: noop,
    startWrite: noop,
    stopWrite: async () => 0,
    peek,
    settleFresh: noop,
  };
}
