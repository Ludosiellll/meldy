/**
 * «Контрольная» (spec meldy-notes 10_Project/Quiz_and_Editor_Spec_2026-10-16.md part 2; plan
 * docs/superpowers/plans/2026-10-16-quiz.md «Data contract»): what the quiz functions of the database take and give.
 * The tables are reachable only through these functions; the key never comes with a question before the review allows.
 */
import type { ItemImages, ItemKind, Uuid } from './container';

export type QuizGrading = 'best' | 'last';
export type QuizReview = 'score' | 'mistakes' | 'answers' | 'mistakes_then_answers';
export type QuizState = 'not_yet' | 'open' | 'closed';
export type QuizFinishReason = 'sent' | 'time' | 'closed';

/** p_settings of quiz_create (missing keys take the server's default) and quiz_update (only the keys given). */
export interface QuizSettings {
  title: string;
  subject_ids: Uuid[];
  item_count: number;
  same_set: boolean;
  shuffle_items: boolean;
  shuffle_options: boolean;
  /** null — no timer. */
  time_limit_min: number | null;
  opens_at: string | null;
  closes_at: string | null;
  /** null — no limit (the server keeps 50 a person). */
  attempts: number | null;
  grading: QuizGrading;
  allow_back: boolean;
  pass_percent: number | null;
  review: QuizReview;
  members_only: boolean;
}

/** Settings fixed once somebody has started (quiz_update answers MC011 for them). */
export const LOCKED_SETTINGS = ['subject_ids', 'item_count', 'same_set', 'shuffle_items', 'shuffle_options', 'time_limit_min'] as const;

export interface QuizRow {
  id: Uuid;
  container_id: Uuid;
  code: string;
  title: string;
  subject_ids: Uuid[];
  item_count: number;
  same_set: boolean;
  shuffle_items: boolean;
  shuffle_options: boolean;
  time_limit_s: number | null;
  opens_at: string | null;
  closes_at: string | null;
  closed_at: string | null;
  attempts: number | null;
  grading: QuizGrading;
  allow_back: boolean;
  pass_percent: number | null;
  review: QuizReview;
  members_only: boolean;
  created_at: string;
  updated_at: string;
  state: QuizState;
  /** Somebody has an attempt: the locked settings stay as they are. */
  started: boolean;
}

/** A row of quiz_list: the quiz and its counts (the author's own attempts left out). */
export interface QuizListRow extends QuizRow {
  people: number;
  writing: number;
  finished: number;
  avg_percent: number | null;
}

export interface QuizAttemptRow {
  id: Uuid;
  /** The same for every attempt of one person in this quiz (not their account id). */
  person: string;
  name: string;
  /** The author's own try. */
  own: boolean;
  n: number;
  started_at: string;
  deadline_at: string | null;
  finished_at: string | null;
  finish_reason: QuizFinishReason | null;
  total: number;
  answered: number;
  correct: number;
}

export interface QuizItemStat {
  item_id: Uuid;
  shown: number;
  answered: number;
  correct: number;
  /** Answers that chose option i (choice questions; [] for a short answer). */
  picks: number[];
  wrong_texts: Array<{ text: string; n: number }>;
}

export interface QuizResults {
  quiz: QuizRow;
  server_now: string;
  attempts: QuizAttemptRow[];
  items: QuizItemStat[];
}

export interface QuizMark {
  attempt_id: Uuid;
  item_id: Uuid;
  correct: boolean;
}

export interface AttemptAnswer {
  item_id: Uuid;
  chosen: number[] | null;
  text: string | null;
  correct: boolean | null;
  answered_at: string;
}

export interface QuizPreviewMe {
  /** The profile's name, when it has one. */
  name_hint: string | null;
  is_author: boolean;
  is_member: boolean;
  attempts_used: number;
  open_attempt: Uuid | null;
  can_start: boolean;
  reason: null | 'no_attempts' | 'members_only' | 'not_yet' | 'closed';
  results: Array<{ attempt_id: Uuid; n: number; finished_at: string; correct: number; total: number }>;
}

export interface QuizPreview {
  status: 'not_found' | QuizState;
  title?: string;
  exam_title?: string;
  author_name?: string;
  item_count?: number;
  time_limit_s?: number | null;
  opens_at?: string | null;
  closes_at?: string | null;
  attempts?: number | null;
  grading?: QuizGrading;
  allow_back?: boolean;
  pass_percent?: number | null;
  review?: QuizReview;
  members_only?: boolean;
  server_now?: string;
  me?: QuizPreviewMe | null;
}

export interface QuizAttemptItem {
  id: Uuid;
  kind: ItemKind;
  stem: string;
  options: string[];
  code: boolean;
  keep_order: boolean;
  images: ItemImages | null;
}

export interface QuizAttempt {
  attempt_id: Uuid;
  n: number;
  quiz_title: string;
  server_now: string;
  started_at: string;
  deadline_at: string | null;
  allow_back: boolean;
  shuffle_options: boolean;
  items: QuizAttemptItem[];
  answers: Array<{ item_id: Uuid; chosen: number[] | null; text: string | null }>;
}

/** One answer as quiz_answer takes it: an empty choice or text takes the answer back. */
export interface QuizAnswerInput {
  item_id: Uuid;
  chosen?: number[] | null;
  text?: string | null;
}

export interface QuizResultItem extends QuizAttemptItem {
  chosen: number[] | null;
  text: string | null;
  right: boolean;
  /** Only when the review shows the answers. */
  key: number[] | null;
  forms: string[] | null;
}

export interface QuizResult {
  attempt_id: Uuid;
  n: number;
  quiz_title: string;
  code: string;
  started_at: string;
  finished_at: string;
  finish_reason: QuizFinishReason;
  correct: number;
  total: number;
  percent: number;
  pass_percent: number | null;
  passed: boolean | null;
  review_now: 'score' | 'mistakes' | 'answers';
  /** When the right answers open (review «mistakes_then_answers» before the quiz closes). */
  answers_after: string | null;
  attempts_left: number | null;
  can_retry: boolean;
  items: QuizResultItem[];
}
