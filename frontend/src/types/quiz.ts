/**
 * «Контрольная» (spec meldy-notes 10_Project/Quiz_and_Editor_Spec_2026-10-16.md part 2; plan
 * docs/superpowers/plans/2026-10-16-quiz.md «Data contract»): what the quiz functions of the database take and give.
 * The tables are reachable only through these functions; the key never comes with a question before the review allows.
 */
import type { ItemImages, ItemKind, Uuid } from './container';
import type { DocDesign, ResultBand } from './testDoc';

export type QuizGrading = 'best' | 'last';
export type QuizReview = 'score' | 'mistakes' | 'answers' | 'mistakes_then_answers';
export type QuizState = 'not_yet' | 'open' | 'closed';
/** 'protection': the strict level ended it at its limit (20261020120000_quiz_protection). */
export type QuizFinishReason = 'sent' | 'time' | 'closed' | 'protection';
/**
 * «Защита от списывания» (20261020120000_quiz_protection): off; normal — the question is covered while the page is not
 * in front and each time is recorded; strict — also fullscreen, no copying, a watermark, and the attempt ends at the
 * limit. Missing from an older server: off.
 */
export type QuizProtection = 'off' | 'normal' | 'strict';
export type QuizGuardKind = 'hidden' | 'blur' | 'split' | 'fullscreen' | 'copy' | 'paste' | 'reload';
/** The colour of a quiz's page (release 47); 'blue' is Meldy's own. */
export type QuizAccent = 'blue' | 'green' | 'orange' | 'violet' | 'pink' | 'graphite';
export const QUIZ_ACCENTS: readonly QuizAccent[] = ['blue', 'green', 'orange', 'violet', 'pink', 'graphite'];

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
  /** Anyone with the link writes without an account (release 47; false when members_only). */
  guests: boolean;
  /** «<container id>/<sha256>.<ext>» in the public bucket quiz-covers; null — no cover. */
  cover_path: string | null;
  accent: QuizAccent;
  /** After the result, offer the taker to train this exam in Meldy (they join it as a member). */
  offer_practice: boolean;
  /**
   * «Как в студии» (release 47.2, 20261019100000_test_docs): the questions, their order and the look are the studio
   * page's; the draw settings (subjects, count, set, order) are stored as given and ignored. Missing — false.
   */
  design?: boolean;
  /** «Защита от списывания»; missing — off. Locked after the start like the timer. */
  protection?: QuizProtection;
  /** The strict level's limit of counted events (1..20, default 3). */
  protection_limit?: number;
}

/** Settings fixed once somebody has started (quiz_update answers MC011 for them). */
export const LOCKED_SETTINGS = [
  'subject_ids',
  'item_count',
  'same_set',
  'shuffle_items',
  'shuffle_options',
  'time_limit_min',
  'design',
  'protection',
  'protection_limit',
] as const;

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
  guests: boolean;
  cover_path: string | null;
  accent: QuizAccent;
  offer_practice: boolean;
  /** «Как в студии» (release 47.2); missing from an older server — false. */
  design?: boolean;
  /** «Защита от списывания»; missing from an older server — off. */
  protection?: QuizProtection;
  protection_limit?: number;
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
  /** Written without an account (release 47): attempts are counted per device. */
  guest: boolean;
  n: number;
  started_at: string;
  deadline_at: string | null;
  finished_at: string | null;
  finish_reason: QuizFinishReason | null;
  total: number;
  answered: number;
  correct: number;
  /**
   * The points of the right answers and of all the attempt's questions (release 47.2): a question of a quiz «как в
   * студии» weighs the points of its block; any other weighs 1 (score = correct, max_score = total). Missing from an
   * older server.
   */
  score?: number;
  max_score?: number;
  /** The counted events of the attempt (the page away), all of its events, and whether any counted event, copy or paste. */
  guard_count?: number;
  guard_events?: number;
  flagged?: boolean;
}

/** One event of an attempt's timeline (quiz_attempt_events): `source` 'server' — written by quiz_start (reload). */
export interface QuizGuardEventRow {
  id: string;
  kind: QuizGuardKind;
  at: string;
  q: number | null;
  ms: number | null;
  source: 'client' | 'server';
}

export interface QuizItemStat {
  item_id: Uuid;
  shown: number;
  answered: number;
  correct: number;
  /** Answers that chose option i (single / multiple; [] for every other kind). */
  picks: number[];
  /** The commonest wrong answers of a short or a number question. */
  wrong_texts: Array<{ text: string; n: number }>;
  /** The sum of credits (a new kind or partial credit, release 48): correct counts full answers only. */
  credit?: number;
  /** Essays not marked yet. */
  pending?: number;
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

/**
 * quiz_analysis (release 49, 20261105090000_quiz_stats): a cell of an attempt — the question's index in
 * QuizAnalysis.items, its credit 0..1 (null while an essay waits for its mark) and the seconds spent on it, from the
 * answer saved before it (null: no answer).
 */
export type QuizAnalysisCell = [index: number, credit: number | null, seconds: number | null];
export interface QuizAnalysisAttempt {
  id: Uuid;
  /** As QuizAttemptRow.person. */
  person: string;
  n: number;
  guest: boolean;
  /** An account in the exam now: its mistakes can go to training. */
  member: boolean;
  /** Its mistakes went to training already (quiz_send_mistakes). */
  sent: boolean;
  started_at: string;
  finished_at: string;
  cells: QuizAnalysisCell[];
}
/** Another quiz of the same exam or test: per question index [index, shown, credit]. */
export interface QuizAnalysisOther {
  id: Uuid;
  title: string;
  created_at: string;
  closed: boolean;
  attempts: number;
  items: Array<[index: number, shown: number, credit: number]>;
}
/** The finished attempts of others than the author, for the statistics a psychometrician would compute. */
export interface QuizAnalysis {
  quiz_id: Uuid;
  server_now: string;
  /** The questions in the exam's order; the cells point into this list. */
  items: Uuid[];
  attempts: QuizAnalysisAttempt[];
  others: QuizAnalysisOther[];
}
/** quiz_send_mistakes: people who got mistakes now and how many; people whose mistakes went before; people without a
 *  mistake; accounts outside the exam; guests; whether the quiz offers «Тренироваться дальше». */
export interface MistakesSent {
  people: number;
  answers: number;
  again: number;
  clean: number;
  outside: number;
  guests: number;
  practice: boolean;
}
/** test_item_percents: per question of the exam, the finished attempts of others that got it and their credit. */
export interface ItemPercent {
  item_id: Uuid;
  shown: number;
  credit: number;
}

export interface AttemptAnswer {
  item_id: Uuid;
  chosen: number[] | null;
  text: string | null;
  correct: boolean | null;
  answered_at: string;
  /** A new kind or partial credit (release 48): 0..1. */
  credit?: number;
  /** cloze: one text per gap. */
  texts?: string[] | null;
  /** essay: the mark, null while waiting. */
  mark?: EssayMark | null;
  pending?: boolean;
}
export type EssayVerdict = 'full' | 'partial' | 'none';
export interface EssayMark {
  verdict: EssayVerdict;
  quote: string | null;
  source: 'ai' | 'author';
  checked_at?: string;
}
/** quiz_essay_task (the author): what the check needs. */
export interface EssayTask {
  attempt_id: Uuid;
  item_id: Uuid;
  stem: string;
  explanation: string | null;
  material_ids: Uuid[];
  text: string | null;
  finished: boolean;
  mark: EssayMark | null;
}

export interface QuizPreviewMe {
  /** The profile's name, when it has one. */
  name_hint: string | null;
  /** «Me» of a visitor without an account, by the device's token (release 47). */
  guest?: boolean;
  is_author: boolean;
  is_member: boolean;
  attempts_used: number;
  open_attempt: Uuid | null;
  can_start: boolean;
  reason: null | 'no_attempts' | 'members_only' | 'not_yet' | 'closed';
  /** score / max_score: the weighted points (release 47.2), missing from an older server. */
  results: Array<{ attempt_id: Uuid; n: number; finished_at: string; correct: number; total: number; score?: number; max_score?: number }>;
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
  guests?: boolean;
  cover_path?: string | null;
  accent?: QuizAccent;
  offer_practice?: boolean;
  /** The studio page of a quiz «как в студии» (release 47.2); null for any other quiz, missing from an older server. */
  design?: DocDesign | null;
  /** «Защита от списывания»: the rules are said before the start. */
  protection?: QuizProtection;
  protection_limit?: number;
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
  /** Release 48 (docs/kinds/CONTRACT.md §3.1): partial credit; number — unit; match — the right items in the attempt's
   *  order; cloze — the number of gaps. order's options come already in the attempt's order. */
  partial?: boolean;
  unit?: string | null;
  right?: string[];
  gaps?: number;
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
  /** The studio page the attempt is shown on (release 47.2); null — the usual one question at a time. */
  design?: DocDesign | null;
  /** The name the participant gave (the strict level's watermark). */
  taker_name?: string;
  protection?: QuizProtection;
  protection_limit?: number;
  /** The counted events so far (after a reload, the line under the clock goes on from it). */
  guard_count?: number;
  items: QuizAttemptItem[];
  answers: Array<{ item_id: Uuid; chosen: number[] | null; text: string | null; texts?: string[] | null }>;
}

/** One answer as quiz_answer takes it: an empty choice or text takes the answer back. Order and match: shown indices. */
export interface QuizAnswerInput {
  item_id: Uuid;
  chosen?: number[] | null;
  text?: string | null;
  texts?: string[] | null;
}

/** A question of the review (keep_order: since 20261016140000_quiz_result_order). */
export interface QuizResultItem extends Omit<QuizAttemptItem, 'keep_order' | 'right'> {
  keep_order?: boolean;
  chosen: number[] | null;
  text: string | null;
  right: boolean;
  /** Only when the review shows the answers. */
  key: number[] | null;
  forms: string[] | null;
  /** The author's explanation, only with the answers (release 47); null otherwise. */
  explanation?: string | null;
  /** Release 48 (docs/kinds/CONTRACT.md §3.5), on a new kind or partial credit: the credit 0..1; order and match in
   *  the attempt's shown indices; cloze's texts and which gaps were right; forms of number / cloze, tolerance; an
   *  essay's mark. */
  credit?: number;
  partial?: boolean;
  unit?: string | null;
  tolerance?: number | null;
  right_items?: string[];
  texts?: string[] | null;
  gaps_right?: boolean[];
  gap_forms?: string[][] | null;
  mark?: EssayMark | null;
  pending?: boolean;
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
  /**
   * The points of the right answers and of all graded questions (release 47.2): with the studio's points they differ
   * from correct / total, and percent = round(100 · score / max_score). Missing from an older server.
   */
  score?: number;
  max_score?: number;
  /** Essays of the attempt the author has not marked yet (release 48); only when the attempt has essays. */
  pending?: number;
  percent: number;
  pass_percent: number | null;
  passed: boolean | null;
  /** With each item's keep_order: the review orders the options as the attempt did (quizOrder). Missing before 46.1. */
  shuffle_options?: boolean;
  review_now: 'score' | 'mistakes' | 'answers';
  /** When the right answers open (review «mistakes_then_answers» before the quiz closes). */
  answers_after: string | null;
  attempts_left: number | null;
  can_retry: boolean;
  items: QuizResultItem[];
  /**
   * The author offers to train this exam (release 47): its title, whether the taker is a member already, and whether
   * the training is open — false while a quiz of the exam is open or not yet open (20261018130000_quiz_guards; a member
   * sees every answer of the exam), and for 20 s after a closing by time, while the last answers still save
   * (20261018140000_quiz_practice_grace). Missing from an older server: read as open.
   */
  practice?: { exam_title: string; member: boolean; ready?: boolean } | null;
  accent?: QuizAccent;
  /** The studio page of a quiz «как в студии» (release 47.2): its result screen (bands, the link further) and look. */
  design?: DocDesign | null;
  /** The band of the page whose from..to holds the percent; null when none does or the quiz has no page. */
  band?: ResultBand | null;
  /** A quiz with protection: its level, the counted events of the attempt and the strict limit; null without. */
  guard?: { level: QuizProtection; count: number; limit: number } | null;
}
