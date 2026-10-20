/**
 * The live game «Битва с монстром»: the shapes of docs/live/CONTRACT.md (§8). Every option index on the wire is a
 * shown index (the order every phone and the projector use). Times are ISO strings of the server's clock.
 */

export type GameState = 'lobby' | 'countdown' | 'open' | 'reveal' | 'leaderboard' | 'podium' | 'ended';
export type GameMode = 'boss';
export type BossPhase = 0 | 1 | 2;
export type Uuid = string;

export type BodyId = 'round' | 'square' | 'drop' | 'bean' | 'cloud';
export type ColourId = 'blue' | 'yellow' | 'green' | 'pink' | 'sky' | 'orange' | 'violet' | 'teal' | 'graphite' | 'snow';
export type EyesId = 'round' | 'dots' | 'one' | 'sleepy' | 'glasses';
export type HatId = 'none' | 'cap' | 'beanie' | 'phones' | 'flower' | 'antenna' | 'bow' | 'crown' | 'grad' | 'horns';
export type Expression = 'idle' | 'happy' | 'hurt' | 'frozen';
/** The parts that open by playing (CONTRACT §10). */
export type UnlockId = 'graphite' | 'snow' | 'crown' | 'grad' | 'horns';

export interface Look {
  body: BodyId;
  colour: ColourId;
  eyes: EyesId;
  hat: HatId;
}

export interface Settings {
  mode: GameMode;
  /** Seconds to answer: 10, 20 or 30. */
  time_s: 10 | 20 | 30;
  /** Damage depends on speed; false = accuracy only. */
  speed: boolean;
  /** 'pin': anyone with the PIN; 'members': only the exam's members. */
  who: 'pin' | 'members';
  /** The bot's final post names the top three. */
  chat_names: boolean;
}

export type GameSource =
  | { quiz_id: Uuid }
  | { container_id: Uuid; subject_ids: Uuid[]; count: number };

export interface CreateResult {
  game_id: Uuid;
  pin: string;
  topic: string;
  host_token: string;
  q_count: number;
  skipped: number;
  join_url: string;
  tg_url: string;
}

export interface Wardrobe {
  look: Look | null;
  unlocked: UnlockId[];
  games: number;
  wins: number;
}

export interface JoinResult {
  game_id: Uuid;
  player_id: Uuid;
  topic: string;
  state: GameState;
  rev: number;
  now: string;
  name: string;
  look: Look;
  /** null for a web guest (nothing is saved). */
  wardrobe: Pick<Wardrobe, 'unlocked' | 'games' | 'wins'> | null;
  /** Only from /telegram/game/join: the token the function made. */
  token?: string;
}

export interface Question {
  qi: number;
  text: string;
  options: string[];
  opens_at: string;
  closes_at: string;
  /** The phase the question opened with: its rules apply to it. */
  phase: BossPhase;
  picture: string | null;
}

export interface Boss {
  hp: number;
  hp_max: number;
  phase: BossPhase;
  defeated: boolean;
}

export interface Me {
  player_id: Uuid;
  name: string;
  look: Look;
  dmg: number;
  streak: number;
  best: number;
  frozen: boolean;
  place: number;
  /** This question's choice (shown index), or null. */
  choice: number | null;
}

export interface QuestionResult {
  qi: number;
  /** Shown index of the key. */
  key: number;
  counts: number[];
  right: number;
  /** HP the boss healed back after this question (phase 2), 0 otherwise. */
  healed: number;
  /** The phase the boss entered after this question, or null. */
  phase_changed: BossPhase | null;
}

export interface PlayerResult extends QuestionResult {
  correct: boolean;
  /** No answer from this player. */
  none: boolean;
  dmg: number;
  thawed: boolean;
  frozen: boolean;
}

export interface Hit {
  player_id: Uuid;
  dmg: number;
  hp_after: number;
}

export interface HostResult extends QuestionResult {
  hits: Hit[];
  frozen_now: Uuid[];
  thawed: Uuid[];
}

export interface TopRow {
  player_id: Uuid;
  name: string;
  look: Look;
  dmg: number;
  /** Previous place − current place; 0 for a new entry. */
  move: number;
}

export interface Final {
  won: boolean;
  place: number;
  dmg: number;
  best: number;
  right: number;
  accuracy_pct: number;
  unlocked_now: UnlockId[];
}

interface StateBase {
  rev: number;
  now: string;
  state: GameState;
  mode: GameMode;
  /** The current or last question, -1 in the lobby. */
  qi: number;
  q_count: number;
  time_s: number;
  speed: boolean;
  players: number;
  answered: number;
  question: Question | null;
  boss: Boss;
  top: TopRow[] | null;
}

export interface PlayerState extends StateBase {
  me: Me;
  result: PlayerResult | null;
  final: Final | null;
  /** Lobby: looks of up to 40 other players. */
  crowd: Look[] | null;
}

export interface RosterRow {
  player_id: Uuid;
  name: string;
  look: Look;
  dmg: number;
  right: number;
  streak: number;
  frozen: boolean;
  joined_at: string;
  answered: boolean;
}

export interface HostState extends StateBase {
  pin: string;
  topic: string;
  settings: Settings;
  skipped: number;
  roster: RosterRow[];
  answered_ids: Uuid[];
  result: HostResult | null;
  /** Podium: the class's result. */
  final: { won: boolean; accuracy_pct: number } | null;
}

/** `since_rev` equal to the current one: nothing changed. */
export interface Unchanged {
  rev: number;
  now: string;
  unchanged: true;
}

export interface ReviewItem {
  qi: number;
  text: string;
  options: string[];
  key: number;
  choice: number | null;
  correct: boolean;
}

export interface Review {
  items: ReviewItem[];
}

export interface AnswerAck {
  accepted: true;
  answered: number;
  now: string;
}

/** The Realtime hint: never trusted, only a reason to read the state again. */
export interface Hint {
  rev: number;
  state: GameState;
}

export type LiveErrorCode =
  | '28000'
  | '42501'
  | 'P0002'
  | '22023'
  | 'ML001'
  | 'ML002'
  | 'ML003'
  | 'ML004'
  | 'ML005'
  | 'ML006'
  | 'ML007'
  | 'ML008'
  | 'ML009'
  | 'ML011'
  | 'network'
  | 'unknown';

export class LiveError extends Error {
  readonly code: LiveErrorCode;
  readonly detail: string | null;
  readonly status: number;
  constructor(code: LiveErrorCode, detail: string | null = null, status = 400) {
    super(`${code}${detail ? `/${detail}` : ''}`);
    this.name = 'LiveError';
    this.code = code;
    this.detail = detail;
    this.status = status;
  }
}

/** The one interface both the fake server and the real client give (CONTRACT §12). */
export interface LiveApi {
  readonly kind: 'fake' | 'real';
  // host
  create(source: GameSource, settings: Settings): Promise<CreateResult>;
  hostState(game: Uuid, hostToken: string, sinceRev?: number): Promise<HostState | Unchanged>;
  next(game: Uuid, hostToken: string, expect: GameState): Promise<HostState>;
  kick(game: Uuid, hostToken: string, player: Uuid): Promise<void>;
  end(game: Uuid, hostToken: string): Promise<void>;
  // player
  join(pin: string, name: string, token: string, look: Look | null): Promise<JoinResult>;
  setLook(game: Uuid, token: string, look: Look): Promise<Look>;
  answer(game: Uuid, token: string, qi: number, choice: number): Promise<AnswerAck>;
  state(game: Uuid, token: string, sinceRev?: number): Promise<PlayerState | Unchanged>;
  review(game: Uuid, token: string): Promise<Review>;
  /** Realtime hints of a game; returns the unsubscribe. `onLink(false)` → poll every second. */
  subscribe(topic: string, onHint: (hint: Hint) => void, onLink?: (connected: boolean) => void): () => void;
}

export function isUnchanged(value: unknown): value is Unchanged {
  return typeof value === 'object' && value !== null && (value as { unchanged?: unknown }).unchanged === true;
}
