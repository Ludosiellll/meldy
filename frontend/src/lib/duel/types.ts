/**
 * «Дуэль»: the shapes of docs/live/DUEL.md (migration 20261106090200_live_duel.sql). Every option index is in this seat's
 * own order; times are ISO strings of the server's clock. The errors are the live game's (lib/live/types LiveError: the
 * same codes and the same PGRST status override).
 */
import type { AnswerInput, Look, PracticeResult, Review, ReviewItem } from '../live/types';

export type { AnswerInput, PracticeResult };

export type DuelStage = 'lobby' | 'play' | 'wait' | 'final';

/** What anyone with the link sees. */
export interface DuelInfo {
  code: string;
  title: string;
  q_count: number;
  time_s: number;
  speed: boolean;
  calm?: true;
  stage: DuelStage;
  round: number;
  players: Array<{ seat: 1 | 2; name: string; look: Look }>;
  /** The invited seat is taken (or the duel is over): a new device cannot sit down. */
  full: boolean;
  now?: string;
}

export interface DuelHead {
  code: string;
  title: string;
  q_count: number;
  time_s: number;
  speed: boolean;
  calm?: true;
  stage: DuelStage;
  /** The current question, -1 in the lobby. */
  qi: number;
  round: number;
  path: string;
  url: string;
  /** The lobby: when an unstarted duel expires. */
  expires_at: string | null;
  /**
   * The wait between questions: when it ends — the one who stayed wins then, or, when `wait_open`, the next question
   * starts without the seat away (its 120 s of waiting a duel are spent by then).
   */
  wait_until: string | null;
  wait_open?: boolean;
}

export interface DuelMe {
  seat: 1 | 2;
  name: string;
  look: Look;
  dmg: number;
  right: number;
  streak: number;
  best: number;
  frozen: boolean;
  ready: boolean;
  /** «Дальше» pressed in this reveal. */
  next: boolean;
  rematch: boolean;
}

export interface DuelOther {
  seat: 1 | 2;
  name: string;
  look: Look;
  dmg: number;
  right: number;
  streak: number;
  frozen: boolean;
  ready: boolean;
  /** The other seat called in the last 20 s. */
  present: boolean;
  /** It answered the current question (nothing more until it closes). */
  answered: boolean;
  next: boolean;
  rematch: boolean;
}

export interface DuelQuestion {
  qi: number;
  /** The text comes at shown_at: until then only the times. */
  soon?: true;
  text?: string;
  options?: string[];
  shown_at: string;
  opens_at: string;
  closes_at: string;
  kind?: 'multiple' | 'short' | 'number';
  multi?: number;
  unit?: string | null;
  /** Closed: both answered, or the time ran out (and its 1.5 s). */
  closed_at?: string;
  /** The reveal ends by itself then (7 s, 14 with an explanation), or when both pressed «Дальше». */
  reveal_until?: string;
}

/** The own answer to the current question: no verdict before the close. */
export interface DuelAnswer {
  choice?: number;
  picks?: number[];
  typed?: string;
  elapsed_ms: number | null;
}

/** One seat's answer of a closed question, in the viewer's order. */
export interface DuelSide {
  correct: boolean;
  none: boolean;
  dmg: number;
  thawed: boolean;
  frozen: boolean;
  elapsed_ms: number | null;
  share: number;
  choice?: number;
  picks?: number[];
  typed?: string;
  /** The other seat's typed text that the live game's filter would not show. */
  masked?: true;
}

export interface DuelResult {
  qi: number;
  key: number;
  kind?: 'multiple' | 'short' | 'number';
  keys?: number[];
  forms?: string[];
  tolerance?: number | null;
  unit?: string | null;
  explanation?: string;
  me: DuelSide | null;
  other: DuelSide | null;
}

export type TrackMark = 'right' | 'part' | 'wrong' | 'none';

export interface TrackRow {
  qi: number;
  me: TrackMark;
  other: TrackMark;
  me_dmg: number;
  other_dmg: number;
}

export interface DuelFinal {
  reason: 'done' | 'left' | 'gone' | 'expired';
  ended_at: string;
  winner: 'me' | 'other' | null;
}

export interface DuelRematch {
  me: boolean;
  other: boolean;
  /** Both pressed «Ещё раз»: the next duel's code. */
  code: string | null;
  round: number;
  /** Fewer than 20 rounds so far. */
  possible: boolean;
}

export interface DuelMatch {
  round: number;
  me: number;
  other: number;
  draws: number;
}

export interface DuelState {
  now: string;
  rev: number;
  duel: DuelHead;
  me: DuelMe;
  other: DuelOther | null;
  question: DuelQuestion | null;
  answer: DuelAnswer | null;
  result: DuelResult | null;
  track: TrackRow[];
  final: DuelFinal | null;
  rematch: DuelRematch | null;
  match: DuelMatch;
}

/** `duel_state` with the rev the device holds: nothing changed but the clock and the other seat's presence. */
export interface DuelUnchanged {
  unchanged: true;
  rev: number;
  now: string;
  stage: DuelStage;
  other: { present: boolean } | null;
}

export function isUnchanged(v: DuelState | DuelUnchanged): v is DuelUnchanged {
  return (v as DuelUnchanged).unchanged === true;
}

/** Where the questions come from (the server builds the list; no item id is ever sent). */
export type DuelSource =
  | { container_id: string; subject_ids: string[]; count: number }
  | { quiz_id: string }
  | { challenge: string; token: string }
  | { game: string; token: string };

export interface DuelSettings {
  time_s?: 10 | 20 | 30;
  speed?: boolean;
  calm?: boolean;
}

/** A review item: the live game's (the own answer) and the other seat's answer. */
export interface DuelReviewItem extends ReviewItem {
  dmg: number;
  none: boolean;
  other: DuelSide | null;
}

export interface DuelReview extends Review {
  items: DuelReviewItem[];
}

export interface DuelApi {
  readonly kind: 'fake' | 'real';
  create(source: DuelSource, settings: DuelSettings, name: string, token: string, look: Look | null): Promise<DuelState>;
  info(code: string): Promise<DuelInfo>;
  join(code: string, name: string, token: string, look: Look | null): Promise<DuelState>;
  state(code: string, token: string, rev?: number | null): Promise<DuelState | DuelUnchanged>;
  ready(code: string, token: string): Promise<DuelState>;
  answer(code: string, token: string, qi: number, answer: AnswerInput): Promise<DuelState>;
  next(code: string, token: string, qi: number): Promise<DuelState>;
  rematch(code: string, token: string): Promise<DuelState>;
  review(code: string, token: string): Promise<DuelReview>;
  practice(code: string, token: string): Promise<PracticeResult>;
}
