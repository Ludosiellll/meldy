/**
 * The live game «Битва с монстром»: the shapes of docs/live/CONTRACT.md (§8). Every option index on the wire is a
 * shown index (the order every phone and the projector use). Times are ISO strings of the server's clock.
 */

export type GameState = 'lobby' | 'countdown' | 'open' | 'reveal' | 'leaderboard' | 'podium' | 'ended';
/**
 * 'boss': «Битва с монстром» (with `stand_every` > 0: a battle with movement rounds, docs/live/MODE_MIXED.md);
 * 'stand': «Встань на ответ», a movement game (docs/live/MODE_STAND.md).
 */
export type GameMode = 'boss' | 'stand';
/** The boss of a movement game or a battle's movement rounds, the teacher's pick. */
export type BossKind = 'clock' | 'skeleton';
/** A battle's movement rounds: every Nth question is played as «Встань на ответ»; 0: none (docs/live/MODE_MIXED.md). */
export type StandEvery = 0 | 3 | 5 | 10;
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
  /** Seconds to answer: 10, 20 or 30 («Встань на ответ»: 15, 20 or 30; 15 by default). */
  time_s: 10 | 15 | 20 | 30;
  /** The arena's boss (default 'clock'); returned in a stand game's and a mixed game's settings only. */
  boss?: BossKind;
  /**
   * A battle (`mode` 'boss') with movement rounds: every 3rd, 5th or 10th question (0 or left out: none; a stand game
   * takes 0 only, `22023 stand_every`). Returned in a mixed game's settings only. The setup's default is 5
   * (`DEFAULT_STAND_EVERY`); the database's default is 0 so older screens keep the plain battle.
   */
  stand_every?: StandEvery;
  /** Damage depends on speed; false = accuracy only. */
  speed: boolean;
  /** 'pin': anyone with the PIN; 'members': only the exam's members. */
  who: 'pin' | 'members';
  /** The bot's final post names the top three. */
  chat_names: boolean;
  /**
   * Teams (20261102090000_live_kinds_teams.sql): 0 or left out — none; 2, 3 or 4 — a player gets the smallest team on
   * join, a team's score is its players' average (CONTRACT §13). Returned in the settings of a game with teams only.
   */
  teams?: Teams;
  /** «Без спешки»: points only for right answers (a battle only; speed is then false). Absent or false: as before. */
  calm?: boolean;
}

/** The setup's «Команды»: none, 2, 3 or 4. */
export type Teams = 0 | 2 | 3 | 4;
export const TEAMS: readonly Teams[] = [0, 2, 3, 4];

/** A team's standing (from the lobby on, in a game with teams): its players not kicked, their points and average. */
export interface TeamRow {
  /** 1..teams. */
  team: number;
  players: number;
  dmg: number;
  /** The average points per player, one decimal (the place is by the exact average). */
  avg: number;
  place: number;
}

/**
 * What a question asks for (CONTRACT §4): absent — one right option (tap); 'multiple' — two right options or more (the
 * phone ticks them and sends the set; `multi` says how many are right); 'short' — a text answer (no options); 'number'
 * — a number typed on the phone's keypad (no options; 20261102090100_live_numbers.sql).
 */
export type QuestionKind = 'single' | 'multiple' | 'short' | 'number';

/** A closed number question's answers for the projector's line: [value (canonical decimal), count], by value. */
export type NumberSpread = Array<[string, number]>;

/** One of a text question's answers typed most often (normalised; rude ones left out), shown at its reveal. */
export interface TopAnswer {
  text: string;
  n: number;
  ok: boolean;
}

/** The phone's answer: a tap, the options ticked, or the text typed (`live_submit`). */
export type AnswerInput = { choice: number } | { picks: number[] } | { text: string };

/** `live_practice`: the mistakes sent to the exam's plan. */
export interface PracticeResult {
  container_id: Uuid;
  /** The player joined the exam now (the quiz offered practice). */
  joined: boolean;
  /** Recorded (now or by an earlier press). */
  saved: number;
  mistakes: number;
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

/** `live_pin`'s refusal: live_join's code, details, HTTP status and Retry-After seconds (ML005), as data. */
export interface PinRefused {
  status: 'refused';
  code: string;
  detail: string | null;
  http: number;
  retry_after: number | null;
}

/**
 * `live_pin` (the PIN step, CONTRACT §8): live_join's checks before the name, answered with HTTP 200. `open`: a game this
 * caller may join, with its mode (null only from the old check through live_join, real.ts); `joined`: this identity
 * (the same token, or the same signed-in account) was in the game already and the server took it back with this token;
 * `refused`: what live_join refused with.
 */
export type PinResult = { status: 'open'; mode: GameMode | null } | ({ status: 'joined' } & JoinResult) | PinRefused;

/**
 * A question's pictures as the game shows them: storage paths in the private bucket test-item-images, the question's
 * and each option's in the shown order (an option without a picture has []). Read through the quiz-media function with
 * the game's host or player token (LiveApi.picture), only once the question was shown.
 */
export interface LivePictures {
  stem: string[];
  options: string[][];
}

export interface Question {
  qi: number;
  text: string;
  options: string[];
  opens_at: string;
  closes_at: string;
  /** The phase the question opened with: its rules apply to it. */
  phase: BossPhase;
  /** Always null (old phones read it); the pictures are in `pictures`. */
  picture: string | null;
  /** A battle's question with pictures (20261030090000_live_pictures.sql): absent when it has none. */
  pictures?: LivePictures;
  /**
   * A mixed game only: this question is a movement round — played in the arena over the room's socket; `live_answer`
   * refuses it (`ML004 stand`), the room writes everyone's zone at the deadline. Absent in other games.
   */
  stand?: boolean;
  /** Absent for one right option; 'multiple', 'short' or 'number' (QuestionKind). */
  kind?: Exclude<QuestionKind, 'single'>;
  /** A question of several right answers: how many are right (the board and the phone say it). */
  multi?: number;
  /** A number question: the unit an answer is in (null: none), shown beside the keypad. */
  unit?: string | null;
  /** A number question played as ranges on the arena (20261102090200_live_ranges.sql): the options are the ranges. */
  ranges?: boolean;
}

/** A mixed game's plan (in PlayerState and HostState from the lobby on): N and the qi of every movement round. */
export interface Mixed {
  every: Exclude<StandEvery, 0>;
  rounds: number[];
}

export interface Boss {
  hp: number;
  hp_max: number;
  phase: BossPhase;
  defeated: boolean;
  /** The arena's boss of a stand game (no HP there: hp = hp_max = 0) or of a mixed game (the battle's HP). */
  kind?: BossKind;
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
  /** A question of several right answers: the options this player ticked (null: none yet). */
  picks?: number[] | null;
  /** A text question: what this player typed (null: nothing yet). */
  typed?: string | null;
  /** A game with teams: the player's team (1..teams). */
  team?: number | null;
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
  /** A mixed game only: this question was a movement round. */
  stand?: boolean;
  /**
   * A mixed game only: a movement round the room never wrote (it was down; closed by time 8 s after the deadline):
   * nobody hit, froze or lost a streak, no heal. `counts` are zeros, `none` is true for everyone.
   */
  void?: boolean;
  /** A question of several right answers: every right option (shown indexes, ascending; `key` is the first). */
  keys?: number[];
  /** A text question: the accepted forms (`key` is -1, `counts` empty); a number question: the accepted numbers. */
  forms?: string[];
  /** A text question: the three answers typed most often; a number question: the three numbers nearest a right one. */
  tops?: TopAnswer[];
  /** A number question: the accepted distance (null: exact) and the unit (null: none). */
  tolerance?: number | null;
  unit?: string | null;
  /** A number question played as ranges: `key` / `keys` are the right ranges, `forms` the true value. */
  ranges?: boolean;
}

export interface PlayerResult extends QuestionResult {
  correct: boolean;
  /** No answer from this player. */
  none: boolean;
  dmg: number;
  thawed: boolean;
  frozen: boolean;
  /** Several right answers: this player's ticks and their share (1: the exact set; between 0 and 1: a partial hit). */
  picks?: number[] | null;
  share?: number;
  /** A text question: what this player typed. */
  typed?: string | null;
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
  /** A number question: up to 60 values typed with their counts (the projector's number line). */
  spread?: NumberSpread;
}

export interface TopRow {
  player_id: Uuid;
  name: string;
  look: Look;
  dmg: number;
  /** Previous place − current place; 0 for a new entry. */
  move: number;
  /** A game with teams: the player's team. */
  team?: number | null;
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
  /** Taps so far; stays 0 during a movement round (the room writes everyone at once). */
  answered: number;
  question: Question | null;
  boss: Boss;
  top: TopRow[] | null;
  /** A mixed game only (`settings.stand_every` > 0): the plan of its movement rounds. */
  mixed?: Mixed;
  /** A game with teams: every team's standing, by place. */
  teams?: TeamRow[];
  /**
   * «Без спешки» (20261106090000_live_calm.sql): a right answer deals 100 (a partial one its share), no points for
   * speed or a streak, nobody freezes. Present (true) only in such a game.
   */
  calm?: true;
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
  /** A game with teams: the player's team. */
  team?: number | null;
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
  /** A mixed game only: a movement round (`choice` is the zone the player stood in, null for none). */
  stand?: boolean;
  /** Its pictures, when it has any. */
  pictures?: LivePictures;
  /** As the question's (QuestionKind): absent for one right option. */
  kind?: Exclude<QuestionKind, 'single'>;
  /** Several right answers: every right option, the own ticks and their share. */
  keys?: number[];
  picks?: number[] | null;
  share?: number;
  /** A text question: the accepted forms and the own text (null: none); a number question: the accepted numbers. */
  forms?: string[];
  typed?: string | null;
  /** A number question: the accepted distance (null: exact) and the unit (null: none). */
  tolerance?: number | null;
  unit?: string | null;
  /** A number question played as ranges: `choice` is the range stood on, `key` / `keys` the right ones. */
  ranges?: boolean;
  /** The author's explanation, when the question has one. */
  explanation?: string;
}

export interface Review {
  items: ReviewItem[];
}

export interface AnswerAck {
  accepted: true;
  answered: number;
  now: string;
}

/** `live_tg_post`: the bot posts the game into the group later; no message id comes back (W1, 20.10). */
export interface TgPostResult {
  status: 'posting';
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
  | 'ML010'
  | 'ML011'
  | 'ML012'
  | 'network'
  | 'unknown';

/** The codes the server refuses with (the body's `code`); any other is 'unknown'. */
export const SERVER_CODES: ReadonlySet<string> = new Set(['28000', '42501', 'P0002', '22023', 'ML001', 'ML002', 'ML003', 'ML004', 'ML005', 'ML006', 'ML007', 'ML008', 'ML009', 'ML010', 'ML011', 'ML012']);

export class LiveError extends Error {
  readonly code: LiveErrorCode;
  readonly detail: string | null;
  readonly status: number;
  /** ML005: seconds until the call may go again (Retry-After), when known. */
  readonly retryAfterS: number | null;
  constructor(code: LiveErrorCode, detail: string | null = null, status = 400, retryAfterS: number | null = null) {
    super(`${code}${detail ? `/${detail}` : ''}`);
    this.name = 'LiveError';
    this.code = code;
    this.detail = detail;
    this.status = status;
    this.retryAfterS = retryAfterS;
  }
}

/** A refusal of `live_pin` as the LiveError the same refusal of `live_join` gives (real.ts liveError). */
export function pinRefusal(r: PinRefused): LiveError {
  if (!SERVER_CODES.has(r.code)) return new LiveError('unknown', r.code || r.detail, r.http);
  return new LiveError(r.code as LiveErrorCode, r.detail, r.http, r.code === 'ML005' ? r.retry_after : null);
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
  /**
   * The game's post into a Telegram group bound to the exam (`live_tg_post`, the author's session, W1 20.10): the bot
   * sends it later. Errors: 28000, 42501/author, P0002/game|group, ML002/ended, ML005/post (one a minute), ML010/bot.
   */
  tgPost(game: Uuid, chatId: number): Promise<TgPostResult>;
  // player
  /** The PIN step (`live_pin`): a game to join with this PIN, for this caller and token. Refusals come as data. */
  pin(pin: string, token: string): Promise<PinResult>;
  join(pin: string, name: string, token: string, look: Look | null): Promise<JoinResult>;
  setLook(game: Uuid, token: string, look: Look): Promise<Look>;
  answer(game: Uuid, token: string, qi: number, choice: number): Promise<AnswerAck>;
  /**
   * An answer of any kind (`live_submit`, 20261102090000_live_kinds_teams.sql): the options ticked on a question of
   * several right answers, the text of a text question (a tap may go here too). The checks and refusals of `answer`,
   * plus ML004 kind (a text on a choice question or the other way round) and 22023 answer.
   */
  submit(game: Uuid, token: string, qi: number, answer: AnswerInput): Promise<AnswerAck>;
  state(game: Uuid, token: string, sinceRev?: number): Promise<PlayerState | Unchanged>;
  review(game: Uuid, token: string): Promise<Review>;
  /**
   * «Тренировать ошибки» (`live_practice`, the session's account): the game's mistakes go to the exam's plan. 28000 not
   * signed in; ML012 practice (not a member and not offered) / open / removed / full; ML004 not_open before the podium.
   */
  practice(game: Uuid, token: string): Promise<PracticeResult>;
  /**
   * An object URL of a picture of a question this game has shown (`token`: the host's or a player's), read through the
   * quiz-media function and kept for the page's life. Absent where a server has no pictures (tests' stubs).
   */
  picture?(game: Uuid, token: string, path: string): Promise<string>;
  /** Realtime hints of a game; returns the unsubscribe. `onLink(false)` → poll every second. */
  subscribe(topic: string, onHint: (hint: Hint) => void, onLink?: (connected: boolean) => void): () => void;
}

export function isUnchanged(value: unknown): value is Unchanged {
  return typeof value === 'object' && value !== null && (value as { unchanged?: unknown }).unchanged === true;
}

// ─────────────── The battle with movement rounds (docs/live/MODE_MIXED.md) ───────────────

export const STAND_EVERY: readonly StandEvery[] = [0, 3, 5, 10];
/** «Каждые 5 вопросов»: what the setup offers first (the owner's pick, 21.10). */
export const DEFAULT_STAND_EVERY: StandEvery = 5;

/** The setup's «Мини-игра с движением»: «Нет», every 3rd, 5th or 10th question, «Все вопросы». */
export type MiniGame = 'none' | 3 | 5 | 10 | 'all';
export const MINI_GAMES: readonly MiniGame[] = ['none', 3, 5, 10, 'all'];

/** The settings a pick gives: «Все вопросы» is the stand game, «Нет» the plain battle, N the battle every Nth. */
export function miniGameSettings(pick: MiniGame): Pick<Settings, 'mode' | 'stand_every'> {
  if (pick === 'all') return { mode: 'stand', stand_every: 0 };
  return { mode: 'boss', stand_every: pick === 'none' ? 0 : pick };
}

/** The pick of a game's settings (the inverse of `miniGameSettings`; an older game without the key is «Нет»). */
export function miniGameOf(settings: Pick<Settings, 'mode' | 'stand_every'>): MiniGame {
  if (settings.mode === 'stand') return 'all';
  const n = settings.stand_every;
  return n === 3 || n === 5 || n === 10 ? n : 'none';
}

/** The mixed plan of a state, or null (a plain battle, a stand game, a broken value). */
export function mixedOf(state: PlayerState | HostState | { mixed?: unknown } | null | undefined): Mixed | null {
  const m = (state as { mixed?: unknown } | null | undefined)?.mixed;
  if (!m || typeof m !== 'object') return null;
  const { every, rounds } = m as { every?: unknown; rounds?: unknown };
  if ((every !== 3 && every !== 5 && every !== 10) || !Array.isArray(rounds) || !rounds.every((r) => Number.isInteger(r) && r >= 0))
    return null;
  return { every, rounds: rounds as number[] };
}

/** Whether the state's current question is a movement round of a mixed game (the database's word: `question.stand`). */
export function isStandRound(state: { question: Question | null } | null | undefined): boolean {
  return state?.question?.stand === true;
}

/** How many questions until the next movement round after question `qi` (0: `qi` itself is one), or null: none left. */
export function untilStandRound(mixed: Mixed | null, qi: number): number | null {
  const next = mixed?.rounds.find((r) => r >= qi);
  return next === undefined ? null : next - qi;
}

// ─────────────── Several right answers, text answers, teams (20261102090000_live_kinds_teams.sql) ───────────────

/** What the question asks for (QuestionKind): a missing `kind` is one right option. */
export function questionKind(q: { kind?: unknown } | null | undefined): QuestionKind {
  return q?.kind === 'multiple' || q?.kind === 'short' || q?.kind === 'number' ? q.kind : 'single';
}

/** Every right option of a closed question (shown indexes): `keys` of several, else the one `key` (none for a text). */
export function rightKeys(r: { key: number; keys?: unknown } | null | undefined): number[] {
  if (!r) return [];
  if (Array.isArray(r.keys) && r.keys.length > 0 && r.keys.every((k) => Number.isInteger(k) && k >= 0)) return r.keys as number[];
  return r.key >= 0 ? [r.key] : [];
}

/** The teams of a state (by place), or null in a game without teams. */
export function teamsOf(state: { teams?: unknown } | null | undefined): TeamRow[] | null {
  const t = state?.teams;
  if (!Array.isArray(t) || t.length === 0) return null;
  return t.filter((r): r is TeamRow => typeof r === 'object' && r !== null && Number.isInteger((r as TeamRow).team));
}
