/**
 * «Соревнование в своё время» (docs/live/CHALLENGE.md): the numbers of one person's run, as the database counts them
 * (migration 20261106090100_live_challenge.sql, meldy_private.live_run_score) — the battle's rules for one player
 * (docs/live/CONTRACT.md §3, lib/live/rules.ts): damage by speed and streak (100 in «Без спешки»), a share for some of
 * several right answers, the freeze and the thaw, the boss's phases and its heal. The screens never grade: the server
 * does. This mirror is for the fake server, the screens' tests and the rehearsal, which checks it against the SQL on
 * every case of a grid (supabase/tests/local/live_game_run.sh, the challenge stage).
 */
import { COUNTDOWN_MS, GRACE_MS, HP_PER_ANSWER, damage, healAmount, phaseFor } from '../live/rules';
import type { BossPhase } from '../live/types';

/** Seconds of reading before the answers open (the battle's countdown). */
export const READY_MS = COUNTDOWN_MS;
/** The server takes an answer up to this long after the question's end. */
export { GRACE_MS };
/** The boss of a run: 55 HP a question (the battle's, for one player). */
export const HP_PER_QUESTION = HP_PER_ANSWER;
/** Runs a challenge takes, at most. */
export const MAX_RUNS = 300;
/** Rows of the table by the link. */
export const BOARD_SIZE = 50;
/** Seconds to answer a question. */
export const TIMES = [10, 20, 30] as const;
export type ChallengeTime = (typeof TIMES)[number];
/** The deadline: from 5 minutes to 30 days after the create. */
export const DEADLINE_MIN_MS = 5 * 60 * 1000;
export const DEADLINE_MAX_MS = 30 * 24 * 60 * 60 * 1000;
/** Questions a challenge takes from an exam's subjects: 3 to 30. */
export const MIN_QUESTIONS = 3;
export const MAX_QUESTIONS = 30;

/** The link's code (meldy_private.random_code). */
export const CODE_RE = /^[0-9a-hjkmnp-tv-z]{12}$/;

export interface RunNumbers {
  dmg: number;
  right: number;
  streak: number;
  best: number;
  frozen: boolean;
  thaws: number;
  hp: number;
  hpMax: number;
  phase: BossPhase;
  timeMs: number;
}

export interface ScoreSettings {
  timeS: number;
  speed: boolean;
  calm: boolean;
}

/** The answer's share (1 the exact answer, between 0 and 1 some of several right ones, 0 wrong) and its time; null: none. */
export type ScoredAnswer = { share: number; elapsedMs: number } | null;

export interface ScoreResult {
  correct: boolean;
  dmg: number;
  thawed: boolean;
  frozen: boolean;
  healed: number;
  phaseChanged: BossPhase | null;
}

/** A new run's numbers: its own boss, 55 HP a question. */
export function freshRun(questions: number): RunNumbers {
  const hp = HP_PER_QUESTION * questions;
  return { dmg: 0, right: 0, streak: 0, best: 0, frozen: false, thaws: 0, hp, hpMax: hp, phase: 0, timeMs: 0 };
}

/**
 * One question of a run graded (live_run_score): `qPhase` is the boss's phase the question opened with (its rules apply).
 * Share 1: damage (100 without speed in «Без спешки»), streak + 1; a frozen player thaws instead (no damage, streak 1).
 * A share between 0 and 1: round(damage × share), streak 0, no freeze (a frozen player deals 0). Share 0: streak 0,
 * frozen. None: streak 0, frozen only from phase 1. «Без спешки»: nobody freezes. In phase 2 a miss heals the boss.
 */
export function scoreAnswer(run: RunNumbers, answer: ScoredAnswer, qPhase: BossPhase, settings: ScoreSettings): { run: RunNumbers; result: ScoreResult } {
  const limit = settings.timeS * 1000;
  const next: RunNumbers = { ...run };
  const elapsed = answer ? Math.min(Math.max(Math.floor(answer.elapsedMs), 0), limit) : limit;
  const share = answer ? answer.share : 0;
  const hitOf = () => (settings.calm ? 100 : damage(elapsed, settings.timeS, run.streak + 1, settings.speed));
  let dmg = 0;
  let right = false;
  let thawed = false;
  if (answer && share >= 1) {
    right = true;
    next.right += 1;
    if (run.frozen) {
      next.frozen = false;
      next.streak = 1;
      next.thaws += 1;
      next.best = Math.max(run.best, 1);
      thawed = true;
    } else {
      dmg = hitOf();
      next.hp = Math.max(0, run.hp - dmg);
      next.streak = run.streak + 1;
      next.best = Math.max(run.best, next.streak);
    }
  } else if (answer && share > 0) {
    // floor(x + 0.5) of the double, as the SQL (Math.round is the same for these non-negative numbers)
    dmg = run.frozen ? 0 : Math.floor(hitOf() * share + 0.5);
    next.hp = Math.max(0, run.hp - dmg);
    next.streak = 0;
  } else if (answer) {
    next.streak = 0;
    next.frozen = run.frozen || !settings.calm;
  } else {
    next.streak = 0;
    next.frozen = run.frozen || (!settings.calm && qPhase >= 1);
  }
  let healed = 0;
  if (qPhase === 2 && next.hp > 0 && !right) {
    healed = Math.min(healAmount(run.hpMax), run.hpMax - next.hp);
    next.hp += healed;
  }
  next.phase = Math.max(run.phase, phaseFor(next.hp, run.hpMax)) as BossPhase;
  next.dmg = run.dmg + dmg;
  next.timeMs = run.timeMs + elapsed;
  return {
    run: next,
    result: { correct: right, dmg, thawed, frozen: next.frozen, healed, phaseChanged: next.phase > run.phase ? next.phase : null },
  };
}

/** A finished run on the table. */
export interface BoardEntry {
  id: string;
  dmg: number;
  right: number;
  timeMs: number;
  /** When it finished (ms): the earlier first among equals. */
  finishedAt: number;
}

/** The table's order (challenge_board): points, then right answers, then the shorter time, then who finished first. */
export function boardCompare(a: BoardEntry, b: BoardEntry): number {
  return b.dmg - a.dmg || b.right - a.right || a.timeMs - b.timeMs || a.finishedAt - b.finishedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** The places beside rows in the table's order: equal points, right answers and time share a place («1, 2, 2, 4»). */
export function boardPlaces(rows: readonly Pick<BoardEntry, 'dmg' | 'right' | 'timeMs'>[]): number[] {
  const out: number[] = [];
  rows.forEach((r, i) => {
    const p = rows[i - 1];
    out.push(i > 0 && p && p.dmg === r.dmg && p.right === r.right && p.timeMs === r.timeMs ? out[i - 1] : i + 1);
  });
  return out;
}

/** The table of a set of finished runs: ordered, with places, the first BOARD_SIZE. */
export function board<T extends BoardEntry>(rows: readonly T[]): Array<T & { place: number }> {
  const sorted = rows.slice().sort(boardCompare);
  const places = boardPlaces(sorted);
  return sorted.slice(0, BOARD_SIZE).map((r, i) => ({ ...r, place: places[i] }));
}

/** A run's place among the finished (as live_run_place): one more than those strictly ahead. */
export function placeOf(me: Pick<BoardEntry, 'dmg' | 'right' | 'timeMs'>, finished: readonly Pick<BoardEntry, 'dmg' | 'right' | 'timeMs'>[]): number {
  return (
    1 +
    finished.filter((o) => o.dmg > me.dmg || (o.dmg === me.dmg && o.right > me.right) || (o.dmg === me.dmg && o.right === me.right && o.timeMs < me.timeMs))
      .length
  );
}

/** The setup's deadlines: in an hour, today at 23:59 (tomorrow's when it is less than an hour away), in 3 days, a week, two weeks. */
export type DeadlinePreset = 'hour' | 'today' | 'days3' | 'week' | 'weeks2';
export const DEADLINE_PRESETS: readonly DeadlinePreset[] = ['hour', 'today', 'days3', 'week', 'weeks2'];

export function deadlineOf(preset: DeadlinePreset, now: Date): Date {
  const at = new Date(now.getTime());
  switch (preset) {
    case 'hour':
      return new Date(now.getTime() + 60 * 60 * 1000);
    case 'today': {
      at.setHours(23, 59, 0, 0);
      if (at.getTime() - now.getTime() < 60 * 60 * 1000) at.setDate(at.getDate() + 1);
      return at;
    }
    case 'days3':
    case 'week':
    case 'weeks2': {
      at.setDate(at.getDate() + (preset === 'days3' ? 3 : preset === 'week' ? 7 : 14));
      at.setHours(23, 59, 0, 0);
      return at;
    }
  }
}

/** Whether a chosen deadline is one the server takes (with a minute's margin for the way there). */
export function deadlineOk(at: Date, now: Date): boolean {
  const ms = at.getTime() - now.getTime();
  return Number.isFinite(ms) && ms >= DEADLINE_MIN_MS + 60_000 && ms <= DEADLINE_MAX_MS - 60_000;
}
