/**
 * «Соревнование в своё время»: the shapes of docs/live/CHALLENGE.md (migration 20261106090100_live_challenge.sql). Every
 * option index is a shown index; times are ISO strings of the server's clock. The errors are the live game's
 * (lib/live/types LiveError: the same codes and the same PGRST status override).
 */
import type { AnswerInput, BossPhase, GameSource, Look, PracticeResult, Review, Uuid } from '../live/types';

export type { AnswerInput, GameSource, PracticeResult, Review };

/** What anyone with the link sees of a challenge. */
export interface ChallengeInfo {
  code: string;
  title: string;
  q_count: number;
  time_s: number;
  speed: boolean;
  /** «Без спешки»: present (true) only in such a challenge. */
  calm?: true;
  /** «Верный ответ — в конце»: present only then; the keys and explanations come once the run is finished. */
  reveal?: 'end';
  deadline: string;
  state: 'open' | 'over';
  /** Why it is over: closed early by the author, or the deadline passed; null while open. */
  over: 'closed' | 'deadline' | null;
  /** Runs finished (on the table) and under way. */
  finished: number;
  playing: number;
  now?: string;
}

export interface RunBoss {
  hp: number;
  hp_max: number;
  phase: BossPhase;
  defeated: boolean;
}

export interface RunInfo {
  name: string;
  look: Look;
  /** The current question, -1 before the first. */
  qi: number;
  dmg: number;
  right: number;
  streak: number;
  best: number;
  frozen: boolean;
  time_ms: number;
  boss: RunBoss;
  finished: boolean;
  /** Once finished: the place among the finished runs. */
  place: number | null;
}

export interface RunQuestion {
  qi: number;
  text: string;
  options: string[];
  opens_at: string;
  closes_at: string;
  /** The boss's phase the question opened with. */
  phase: BossPhase;
  kind?: 'multiple' | 'short' | 'number';
  multi?: number;
  unit?: string | null;
}

/** The own answer to the current question. */
export interface RunAnswer {
  choice?: number;
  picks?: number[];
  typed?: string;
  elapsed_ms: number | null;
}

/** The current question once graded (answered, or its time ran out): the key, the verdict, the explanation. */
export interface RunResult {
  qi: number;
  /** The key in the run's own order of the options; absent while hidden. */
  key?: number;
  keys?: number[];
  forms?: string[];
  tolerance?: number | null;
  unit?: string | null;
  correct: boolean;
  /** No answer: the time ran out. */
  none: boolean;
  share?: number;
  dmg: number;
  thawed: boolean;
  frozen: boolean;
  healed: number;
  phase_changed: BossPhase | null;
  elapsed_ms: number | null;
  explanation?: string;
  /** «Верный ответ — в конце» and the run not finished: no key, forms or explanation yet (the verdict and points are here). */
  hidden?: true;
}

export interface RunState {
  now: string;
  challenge: ChallengeInfo;
  run: RunInfo;
  question: RunQuestion | null;
  answer: RunAnswer | null;
  result: RunResult | null;
}

export interface BoardRow {
  place: number;
  name: string;
  look: Look;
  dmg: number;
  right: number;
  time_ms: number;
  /** The caller's own row. */
  me?: true;
}

export interface BoardMe {
  place: number | null;
  name: string;
  look: Look;
  dmg: number;
  right: number;
  time_ms: number;
  finished: boolean;
}

export interface Board {
  now: string;
  challenge: ChallengeInfo;
  top: BoardRow[];
  me: BoardMe | null;
}

export interface ChallengeSettings {
  time_s: 10 | 20 | 30;
  speed: boolean;
  calm?: boolean;
  /** When a person sees the keys: after each question (default) or once the run is finished. */
  reveal?: 'each' | 'end';
  /** ISO time, 5 minutes to 30 days ahead. */
  deadline: string;
}

export interface CreateChallengeResult {
  challenge_id: Uuid;
  code: string;
  path: string;
  url: string;
  q_count: number;
  skipped: number;
  deadline: string;
}

export interface ResultRun {
  run_id: Uuid;
  place: number | null;
  name: string;
  look: Look;
  dmg: number;
  right: number;
  time_ms: number;
  answered: number;
  joined_at: string;
  finished_at: string | null;
  removed: boolean;
}

export interface ResultQuestion {
  qi: number;
  text: string;
  kind: 'single' | 'multiple' | 'short' | 'number';
  answered: number;
  right: number;
  partial: number;
}

export interface ChallengeResults extends ChallengeInfo {
  challenge_id: Uuid;
  container_id: Uuid;
  quiz_id: Uuid | null;
  skipped: number;
  path: string;
  url: string;
  created_at: string;
  closed_at: string | null;
  runs: ResultRun[];
  questions: ResultQuestion[];
}

export interface MineItem extends ChallengeInfo {
  challenge_id: Uuid;
  container_id: Uuid;
  path: string;
  created_at: string;
  leader: { name: string; look: Look; dmg: number } | null;
}

/** The one interface the real client and the fake give. */
export interface ChallengeApi {
  readonly kind: 'fake' | 'real';
  // the author (signed in)
  create(source: GameSource, settings: ChallengeSettings): Promise<CreateChallengeResult>;
  close(challenge: Uuid): Promise<ChallengeInfo>;
  remove(challenge: Uuid, run: Uuid): Promise<void>;
  results(challenge: Uuid): Promise<ChallengeResults>;
  mine(container?: Uuid | null): Promise<MineItem[]>;
  // anyone with the link
  info(code: string): Promise<ChallengeInfo>;
  join(code: string, name: string, token: string, look: Look | null): Promise<RunState>;
  state(code: string, token: string): Promise<RunState>;
  next(code: string, token: string, qi: number): Promise<RunState>;
  answer(code: string, token: string, qi: number, answer: AnswerInput): Promise<RunState>;
  board(code: string, token?: string | null): Promise<Board>;
  review(code: string, token: string): Promise<Review>;
  practice(code: string, token: string): Promise<PracticeResult>;
}
