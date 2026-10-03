/**
 * The answer screen as one state machine (contracts §7.2; oral spec 3.2):
 *
 *   loading → ready (the rubric loads) → answering (voice: listening | paused, or text) →
 *   finalizing (stop ≤ 800 ms) → examiner (the quick check, ≤ 1.5 s) → followup (asking |
 *   answering | checking) → evaluating → protocol (saved | save_error | eval_error)
 *
 * With nothing to ask: examiner → evaluating («Хорошо, по существу всё»). Pure: no timers, no
 * network; the page runs the effects and reports back with actions.
 */
import type { CheckStatus, Evaluation, RubricResponse } from './oralApi';
import type { AnswerInput, SaveResult } from './oralPersistence';
import type { NearestItem, QuestionHistory, TicketExam, TicketQuestion } from './ticketData';

export type Phase = 'loading' | 'load_error' | 'ready' | 'answering' | 'finalizing' | 'examiner' | 'followup' | 'evaluating' | 'protocol';
export type AnswerMode = 'voice' | 'text';

export type RubricState =
  | { status: 'loading' }
  | { status: 'ready'; response: RubricResponse }
  /** 409 not_in_lectures, or a 200 rubric whose coverage is none: nothing to check an answer against. */
  | { status: 'not_in_lectures'; message: string; nearest: NearestDisplay[] }
  /** 422: no verified rubric (or no lecture text). */
  | { status: 'unverifiable'; message: string }
  /** The model or the connection failed: «Повторить». */
  | { status: 'failed'; message: string }
  /** 404, 401 and the like: «Лист экзамена». */
  | { status: 'blocked'; message: string };

/** A nearest fragment shown when the lectures do not answer the question. */
export interface NearestDisplay {
  title: string;
  fragment: string;
  text: string;
  matched: string[];
}

export interface FollowupState {
  pointId: string;
  question: string;
  expected: string;
  chosenBy: 'check' | 'client';
  stage: 'asking' | 'answering' | 'checking' | 'done';
  mode: AnswerMode;
  typed: string;
  /** «Не расслышал ответ» was said once already. */
  notHeard: boolean;
  status: CheckStatus | null;
  /** The answer as said or typed; «не знаю» after the button. */
  answer: string;
  /** How the status was decided: the quick check, or the browser's key-word rule when the check did not answer in time. */
  judgedBy: 'check' | 'keywords' | null;
}

export interface AttemptState {
  attemptId: string;
  /** final + interim at «Готово»: what the quick check saw. */
  snapshot: string;
  /** The final answer after stop(): what the evaluation saw. */
  transcript: string;
  live: string[];
  input: AnswerInput;
  durationSeconds: number;
  startedAt: string;
  /** Restored from sessionStorage after a failed evaluation. */
  restored: boolean;
}

export type EvaluationState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'done'; result: Evaluation }
  | { status: 'failed'; message: string };

export type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; result: SaveResult; at: string }
  | { status: 'failed' }
  /** Nothing was rated: there is no grade, so nothing is saved. */
  | { status: 'no_grade' };

export interface TicketState {
  phase: Phase;
  loadError: { kind: 'not_found' | 'failed'; message: string } | null;
  exam: TicketExam | null;
  questions: TicketQuestion[];
  index: number;
  /** Bumps on every new question or new attempt: async results of an older run are ignored. */
  run: number;
  rubric: RubricState;
  history: QuestionHistory | null;
  limit: 'unknown' | 'ok' | 'exhausted';
  mode: AnswerMode;
  paused: boolean;
  typed: string;
  named: string[];
  announcement: string;
  usedSpeech: boolean;
  usedText: boolean;
  /** Answer time: accumulated ms plus the running stretch. */
  clock: { accumulated: number; since: number | null };
  draftAt: string | null;
  notice: string | null;
  attempt: AttemptState | null;
  followup: FollowupState | null;
  /** No follow-up: «Хорошо, по существу всё». */
  allCovered: boolean;
  evaluation: EvaluationState;
  save: SaveState;
}

export type TicketAction =
  | { type: 'loaded'; exam: TicketExam; questions: TicketQuestion[] }
  | { type: 'load_failed'; kind: 'not_found' | 'failed'; message: string }
  | { type: 'question'; index: number }
  | { type: 'rubric_loading'; run: number }
  | { type: 'rubric'; run: number; rubric: RubricState }
  | { type: 'history'; run: number; history: QuestionHistory | null }
  | { type: 'limit'; run: number; limit: 'ok' | 'exhausted' }
  | { type: 'draft_restored'; text: string; savedAt: string; input: AnswerInput; now: number }
  | { type: 'draft_cleared' }
  | { type: 'start'; mode: AnswerMode; now: number }
  | { type: 'mode'; mode: AnswerMode; typed?: string; now: number }
  | { type: 'pause'; now: number }
  | { type: 'resume'; now: number }
  | { type: 'typed'; text: string }
  | { type: 'heard' }
  | { type: 'marks'; named: string[]; announcement: string }
  | { type: 'notice'; text: string | null }
  | { type: 'restart' }
  | { type: 'finalize'; attemptId: string; snapshot: string; live: string[]; input: AnswerInput; now: number; startedAt: string }
  | { type: 'examiner' }
  | { type: 'transcript'; text: string }
  | { type: 'followup'; pointId: string; question: string; expected: string; chosenBy: 'check' | 'client'; mode: AnswerMode }
  | { type: 'no_followup' }
  | { type: 'followup_listen' }
  | { type: 'followup_mode'; mode: AnswerMode; typed?: string }
  | { type: 'followup_typed'; text: string }
  | { type: 'followup_not_heard' }
  /** «Повторить вопрос» while answering aloud: back to listening to the examiner. */
  | { type: 'followup_repeat' }
  | { type: 'followup_checking' }
  | { type: 'followup_result'; status: CheckStatus; answer: string; judgedBy?: 'check' | 'keywords' | null }
  | { type: 'evaluation_running'; run: number }
  | { type: 'evaluation_done'; run: number; result: Evaluation }
  | { type: 'evaluation_failed'; run: number; message: string }
  | { type: 'protocol' }
  | { type: 'save_start' }
  | { type: 'save_done'; result: SaveResult; at: string }
  | { type: 'save_failed' }
  | { type: 'no_grade' }
  | { type: 'save_retry' }
  | { type: 'evaluation_retry'; run: number }
  | { type: 'stash_restored'; attempt: AttemptState; followup: FollowupState | null; message: string };

export function initialTicketState(): TicketState {
  return {
    phase: 'loading',
    loadError: null,
    exam: null,
    questions: [],
    index: 0,
    run: 0,
    rubric: { status: 'loading' },
    history: null,
    limit: 'unknown',
    mode: 'voice',
    paused: false,
    typed: '',
    named: [],
    announcement: '',
    usedSpeech: false,
    usedText: false,
    clock: { accumulated: 0, since: null },
    draftAt: null,
    notice: null,
    attempt: null,
    followup: null,
    allCovered: false,
    evaluation: { status: 'idle' },
    save: { status: 'idle' },
  };
}

function freshQuestion(state: TicketState, index: number): TicketState {
  return {
    ...initialTicketState(),
    phase: 'ready',
    exam: state.exam,
    questions: state.questions,
    index,
    run: state.run + 1,
  };
}

function stopClock(clock: TicketState['clock'], now: number): TicketState['clock'] {
  return clock.since === null ? clock : { accumulated: clock.accumulated + Math.max(0, now - clock.since), since: null };
}

function startClock(clock: TicketState['clock'], now: number): TicketState['clock'] {
  return clock.since === null ? { ...clock, since: now } : clock;
}

/** Answer time in ms at `now`. */
export function answerTime(state: Pick<TicketState, 'clock'>, now: number): number {
  return state.clock.accumulated + (state.clock.since === null ? 0 : Math.max(0, now - state.clock.since));
}

export function ticketReducer(state: TicketState, action: TicketAction): TicketState {
  switch (action.type) {
    case 'loaded':
      return freshQuestion({ ...state, exam: action.exam, questions: action.questions }, 0);
    case 'load_failed':
      return { ...state, phase: 'load_error', loadError: { kind: action.kind, message: action.message } };
    case 'question':
      if (action.index < 0 || action.index >= state.questions.length) return state;
      return freshQuestion(state, action.index);
    case 'rubric_loading':
      return action.run === state.run ? { ...state, rubric: { status: 'loading' } } : state;
    case 'rubric':
      return action.run === state.run ? { ...state, rubric: action.rubric } : state;
    case 'history':
      return action.run === state.run ? { ...state, history: action.history } : state;
    case 'limit':
      return action.run === state.run ? { ...state, limit: action.limit } : state;
    case 'draft_restored':
      if (state.phase !== 'ready') return state;
      return {
        ...state,
        phase: 'answering',
        mode: 'text',
        paused: false,
        typed: action.text,
        draftAt: action.savedAt,
        usedSpeech: action.input !== 'text',
        usedText: action.input !== 'speech',
        clock: startClock(state.clock, action.now),
      };
    case 'draft_cleared':
      return { ...state, draftAt: null, typed: '', named: [], announcement: '', phase: state.phase === 'answering' ? 'ready' : state.phase, clock: { accumulated: 0, since: null } };
    case 'start':
      if (state.phase !== 'ready' && state.phase !== 'answering') return state;
      return {
        ...state,
        phase: 'answering',
        mode: action.mode,
        paused: false,
        notice: null,
        usedText: state.usedText || action.mode === 'text',
        clock: startClock(state.clock, action.now),
      };
    case 'mode':
      if (state.phase !== 'answering') return state;
      return {
        ...state,
        mode: action.mode,
        paused: false,
        typed: action.typed ?? state.typed,
        usedText: state.usedText || action.mode === 'text',
        clock: startClock(state.clock, action.now),
      };
    case 'pause':
      return state.phase === 'answering' ? { ...state, paused: true, clock: stopClock(state.clock, action.now) } : state;
    case 'resume':
      return state.phase === 'answering' ? { ...state, paused: false, clock: startClock(state.clock, action.now) } : state;
    case 'typed':
      return { ...state, typed: action.text, notice: null };
    case 'heard':
      return state.usedSpeech ? state : { ...state, usedSpeech: true };
    case 'marks':
      return { ...state, named: action.named, announcement: action.announcement };
    case 'notice':
      return { ...state, notice: action.text };
    case 'restart':
      return { ...freshQuestion(state, state.index), rubric: state.rubric, history: state.history, limit: state.limit, run: state.run };
    case 'finalize':
      if (state.phase !== 'answering') return state;
      return {
        ...state,
        phase: 'finalizing',
        paused: false,
        notice: null,
        clock: stopClock(state.clock, action.now),
        named: Array.from(new Set([...state.named, ...action.live])),
        attempt: {
          attemptId: action.attemptId,
          snapshot: action.snapshot,
          transcript: action.snapshot,
          live: action.live,
          input: action.input,
          durationSeconds: Math.round(answerTime(state, action.now) / 1000),
          startedAt: action.startedAt,
          restored: false,
        },
        evaluation: { status: 'running' },
      };
    case 'examiner':
      return state.phase === 'finalizing' ? { ...state, phase: 'examiner' } : state;
    case 'transcript':
      return state.attempt ? { ...state, attempt: { ...state.attempt, transcript: action.text } } : state;
    case 'followup':
      if (state.phase !== 'examiner' && state.phase !== 'finalizing') return state;
      return {
        ...state,
        phase: 'followup',
        followup: {
          pointId: action.pointId,
          question: action.question,
          expected: action.expected,
          chosenBy: action.chosenBy,
          // A typed answer goes on typed: the field is there while the question is heard.
          stage: action.mode === 'text' ? 'answering' : 'asking',
          mode: action.mode,
          typed: '',
          notHeard: false,
          status: null,
          answer: '',
          judgedBy: null,
        },
      };
    case 'no_followup':
      if (state.phase !== 'examiner' && state.phase !== 'finalizing') return state;
      return { ...state, phase: 'evaluating', allCovered: true, followup: null };
    case 'followup_listen':
      return state.followup ? { ...state, followup: { ...state.followup, stage: 'answering', mode: 'voice' } } : state;
    case 'followup_mode':
      return state.followup
        ? { ...state, followup: { ...state.followup, mode: action.mode, typed: action.typed ?? state.followup.typed, stage: action.mode === 'text' ? 'answering' : state.followup.stage } }
        : state;
    case 'followup_typed':
      return state.followup ? { ...state, followup: { ...state.followup, typed: action.text } } : state;
    case 'followup_not_heard':
      return state.followup
        ? { ...state, followup: { ...state.followup, notHeard: true, stage: state.followup.mode === 'voice' ? 'asking' : 'answering' } }
        : state;
    case 'followup_repeat':
      return state.followup && state.followup.mode === 'voice' ? { ...state, followup: { ...state.followup, stage: 'asking' } } : state;
    case 'followup_checking':
      return state.followup ? { ...state, followup: { ...state.followup, stage: 'checking' } } : state;
    case 'followup_result':
      if (!state.followup) return state;
      return {
        ...state,
        phase: 'evaluating',
        followup: { ...state.followup, stage: 'done', status: action.status, answer: action.answer, judgedBy: action.judgedBy ?? null },
      };
    case 'evaluation_running':
      return action.run === state.run ? { ...state, evaluation: { status: 'running' } } : state;
    case 'evaluation_done':
      return action.run === state.run ? { ...state, evaluation: { status: 'done', result: action.result } } : state;
    case 'evaluation_failed':
      return action.run === state.run ? { ...state, evaluation: { status: 'failed', message: action.message } } : state;
    case 'protocol':
      // The protocol opens only when the evaluation has an outcome (a result or an honest failure).
      return state.phase === 'evaluating' && (state.evaluation.status === 'done' || state.evaluation.status === 'failed')
        ? { ...state, phase: 'protocol' }
        : state;
    case 'save_start':
      return { ...state, save: { status: 'saving' } };
    case 'save_done':
      return { ...state, save: { status: 'saved', result: action.result, at: action.at } };
    case 'save_failed':
      return { ...state, save: { status: 'failed' } };
    case 'no_grade':
      return { ...state, save: { status: 'no_grade' } };
    case 'save_retry':
      return state.save.status === 'failed' ? { ...state, save: { status: 'idle' } } : state;
    case 'evaluation_retry':
      return action.run === state.run && state.evaluation.status === 'failed'
        ? { ...state, phase: 'evaluating', evaluation: { status: 'running' }, save: { status: 'idle' } }
        : state;
    case 'stash_restored':
      if (state.phase !== 'ready') return state;
      return {
        ...state,
        phase: 'protocol',
        attempt: action.attempt,
        named: action.attempt.live,
        followup: action.followup,
        allCovered: action.followup === null,
        evaluation: { status: 'failed', message: action.message },
      };
    default:
      return state;
  }
}

/** The protocol's sub-state (contracts §7.2): saved, save_error or eval_error. */
export function protocolState(state: TicketState): 'saving' | 'saved' | 'save_error' | 'eval_error' | 'no_grade' | null {
  if (state.phase !== 'protocol') return null;
  if (state.evaluation.status === 'failed') return 'eval_error';
  if (state.save.status === 'saved') return 'saved';
  if (state.save.status === 'failed') return 'save_error';
  if (state.save.status === 'no_grade') return 'no_grade';
  return 'saving';
}

/** An answer that is given and not saved yet: the page's own links ask before leaving. */
export function hasUnsavedAnswer(state: TicketState, answerText: string): boolean {
  switch (state.phase) {
    case 'answering':
      return answerText.trim() !== '';
    case 'finalizing':
    case 'examiner':
    case 'followup':
    case 'evaluating':
      return true;
    case 'protocol':
      return state.save.status !== 'saved' && state.save.status !== 'no_grade';
    default:
      return false;
  }
}
