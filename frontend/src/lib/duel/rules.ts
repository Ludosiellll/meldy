/**
 * «Дуэль» (docs/live/DUEL.md): the numbers of one seat, as the database counts them (migration
 * 20261106090200_live_duel.sql, meldy_private.live_duel_points / live_duel_winner) — the battle's phase 0 for each seat
 * (docs/live/CONTRACT.md §3, lib/live/rules.ts): points by speed and streak (100 in «Без спешки»), a share for some of
 * several right answers, the freeze by a wrong answer and the thaw by a right one; no answer by the end of the time
 * freezes nobody. The screens never grade: the server does at the close. This mirror is for the fake server, the
 * screens' tests and the rehearsal, which checks it against the SQL on a grid (supabase/tests/local/live_duel_mirror.*).
 *
 * The clock and the polls are here too: the timeline's numbers (§4) and how often a device asks (§7).
 */
import { COUNTDOWN_MS, GRACE_MS, damage } from '../live/rules';

export { COUNTDOWN_MS, GRACE_MS };
/** «Готов» by both → the first question shows this much later. */
export const READY_GAP_MS = 2000;
/** The reveal of a closed question lasts this long by itself; with an explanation to read, twice as long. */
export const REVEAL_MS = 7000;
export const REVEAL_LONG_MS = 14000;
/** A seat is away when its last call is older than this (meldy_private.live_duel_here). */
export const AWAY_MS = 20_000;
/** Between questions the duel waits this long for a seat that is away; then the one who stayed wins. */
export const WAIT_MS = 60_000;
/** In the lobby the invited seat is freed after this long away. */
export const LOBBY_FREE_MS = 120_000;
/** An unstarted duel expires a day after its create. */
export const EXPIRE_MS = 24 * 60 * 60 * 1000;
/** Rounds of one match (a rematch is the next round). */
export const MAX_ROUNDS = 20;
/** Seconds a question: as the battle's. */
export const TIMES = [10, 20, 30] as const;
export type DuelTime = (typeof TIMES)[number];
/** Questions a duel takes from an exam's subjects: 3 to 30. */
export const MIN_QUESTIONS = 3;
export const MAX_QUESTIONS = 30;

/** The link's code (meldy_private.random_code). */
export const CODE_RE = /^[0-9a-hjkmnp-tv-z]{12}$/;

export interface PointsSettings {
  timeS: number;
  speed: boolean;
  calm: boolean;
}

export interface Points {
  dmg: number;
  correct: boolean;
  thawed: boolean;
  frozen: boolean;
  /** The streak after the answer. */
  streak: number;
}

/**
 * One seat's answer graded (live_duel_points). `share`: 1 the exact answer, between 0 and 1 some of several right
 * ones, 0 wrong, null no answer. `elapsedMs`: from the answers' opening by the server's clock (null: none).
 */
export function duelPoints(streak: number, frozen: boolean, share: number | null, elapsedMs: number | null, s: PointsSettings): Points {
  const limit = s.timeS * 1000;
  const elapsed = Math.min(Math.max(Math.floor(elapsedMs ?? limit), 0), limit);
  const hit = s.calm ? 100 : damage(elapsed, s.timeS, streak + 1, s.speed);
  if (share !== null && share >= 1) {
    if (frozen) return { dmg: 0, correct: true, thawed: true, frozen: false, streak: 1 };
    return { dmg: hit, correct: true, thawed: false, frozen: false, streak: streak + 1 };
  }
  if (share !== null && share > 0) {
    // floor(x + 0.5) of the double, as the SQL (Math.round is the same for these non-negative numbers)
    return { dmg: frozen ? 0 : Math.floor(hit * share + 0.5), correct: false, thawed: false, frozen, streak: 0 };
  }
  if (share !== null) return { dmg: 0, correct: false, thawed: false, frozen: frozen || !s.calm, streak: 0 };
  return { dmg: 0, correct: false, thawed: false, frozen, streak: 0 };
}

export interface SeatNumbers {
  dmg: number;
  right: number;
  streak: number;
  best: number;
  frozen: boolean;
  thaws: number;
  timeMs: number;
}

export function freshSeat(): SeatNumbers {
  return { dmg: 0, right: 0, streak: 0, best: 0, frozen: false, thaws: 0, timeMs: 0 };
}

/** A seat's numbers after one closed question (live_duel_close). */
export function scoreSeat(seat: SeatNumbers, answer: { share: number; elapsedMs: number } | null, s: PointsSettings): { seat: SeatNumbers; points: Points } {
  const p = duelPoints(seat.streak, seat.frozen, answer ? answer.share : null, answer ? answer.elapsedMs : null, s);
  const limit = s.timeS * 1000;
  return {
    points: p,
    seat: {
      dmg: seat.dmg + p.dmg,
      right: seat.right + (p.correct ? 1 : 0),
      streak: p.streak,
      best: Math.max(seat.best, p.streak),
      frozen: p.frozen,
      thaws: seat.thaws + (p.thawed ? 1 : 0),
      timeMs: seat.timeMs + (answer ? Math.min(Math.max(Math.floor(answer.elapsedMs), 0), limit) : limit),
    },
  };
}

/** The winner (live_duel_winner): more points, then more right answers; null is a draw. Time decides nothing more. */
export function winnerOf(a: { dmg: number; right: number }, b: { dmg: number; right: number }): 1 | 2 | null {
  if (a.dmg > b.dmg || (a.dmg === b.dmg && a.right > b.right)) return 1;
  if (b.dmg > a.dmg || (a.dmg === b.dmg && b.right > a.right)) return 2;
  return null;
}

// ─────────────────────────────────────────── the polls (DUEL.md §7) ───────────────────────────────────────────

/** How the device reaches the database (lib/supabaseRoute): directly, or through the site's /sb proxy. */
export type Route = 'direct' | 'proxy' | null;

/** While something is timed (a question, its reveal, a wait) on the direct route. */
export const POLL_TIMED_MS = 1000;
/** In the lobby. */
export const POLL_LOBBY_MS = 1500;
/** After the end. */
export const POLL_FINAL_MS = 3000;
/**
 * On the /sb route: the proxy lets 600 anonymous calls a minute through per address, shared by everyone behind one NAT.
 * About 3 s while timed and in the lobby (a call exactly when something is due comes on top), 5 s after the end.
 */
export const POLL_PROXY_MS = 3000;
export const POLL_PROXY_FINAL_MS = 5000;
/** A 429: the next poll waits longer, 3 s more each time, at most this (Retry-After when it is shorter). */
export const BACKOFF_STEP_MS = 3000;
export const BACKOFF_MAX_MS = 9000;

export type PollStage = 'lobby' | 'play' | 'wait' | 'final';

export function pollMs(stage: PollStage, route: Route): number {
  if (route === 'proxy') return stage === 'final' ? POLL_PROXY_FINAL_MS : POLL_PROXY_MS;
  if (stage === 'final') return POLL_FINAL_MS;
  return stage === 'lobby' ? POLL_LOBBY_MS : POLL_TIMED_MS;
}

/** The wait after the n-th 429 in a row (n ≥ 1). */
export function backoffMs(n: number, retryAfterS: number | null): number {
  const step = Math.min(BACKOFF_MAX_MS, BACKOFF_STEP_MS * Math.max(1, n));
  return retryAfterS !== null && retryAfterS > 0 ? Math.min(step, retryAfterS * 1000) : step;
}

/** The slowest the device can be between two calls while it is on the page: the away threshold stays well above it. */
export const SLOWEST_CALL_MS = POLL_PROXY_FINAL_MS + BACKOFF_MAX_MS;
