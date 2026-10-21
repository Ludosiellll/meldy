/**
 * The battle with movement rounds (docs/live/MODE_MIXED.md §8) on both screens, without React and without 3D: when the
 * arena is on screen, how a movement round's reveal plays on the projector (the hits one by one, then the heal, the
 * phase or the fall), and what a phone says about its own round. Pure, tested in mixed.test.ts.
 */
import { arenaLive, type StandLast, type StandResult, type StandState } from '../../../lib/live/move/protocol';
import { isStandRound, type GameState, type PlayerResult, type Question } from '../../../lib/live/types';

const ORDER: readonly string[] = ['lobby', 'countdown', 'open', 'reveal', 'leaderboard', 'podium', 'ended'];
const rank = (phase: string) => ORDER.indexOf(phase);

/** The parts of the database's state (PlayerState or HostState) the decision needs. */
export interface DbView {
  state: GameState;
  qi: number;
  question: Question | null;
}

/**
 * Whether the arena is on screen: the room's word when it knows the same question at the same or a later phase (it
 * hears the teacher's click first, MODE_STAND §2), else the database's (`question.stand` in countdown, open or reveal).
 * A room message without `round` is not a mixed room's: the database decides.
 */
export function arenaOn(db: DbView | null, room: StandState | null): boolean {
  const dbOn = !!db && isStandRound(db) && (db.state === 'countdown' || db.state === 'open' || db.state === 'reveal');
  if (!room || room.round === undefined) return dbOn;
  if (db && (room.qi < db.qi || (room.qi === db.qi && rank(room.phase) < rank(db.state)))) return dbOn;
  return arenaLive(room);
}

// ─────────────────────────────────────────── the projector's reveal ───────────────────────────────────────────

/** One hit as it lands: entity id, damage, the boss's HP after it, and when (ms after the plan's start). */
export interface HitStep {
  at: number;
  id: number;
  dmg: number;
  hp: number;
}

export interface RevealPlan {
  /** The boss's HP before the round's hits. */
  from: number;
  hits: HitStep[];
  /** ms: the last hit's thud (all the damage together), or null without hits. */
  blow: number | null;
  /** ms: the heal, the phase or the fall is told (null: nothing to tell). */
  news: number | null;
  /** ms: everything is shown. */
  end: number;
}

/** When the first hit lands after the result came: the boss's jump, the floor's drop and the fall go first. */
export const HITS_AFTER_MS = 1100;
/** All the hits within about this long, each at least MIN and at most MAX apart. */
const HITS_SPREAD_MS = 2400;
const HIT_MIN_MS = 60;
const HIT_MAX_MS = 280;

/** The boss's HP before a movement round's hits: the first hit's HP plus its damage, else the HP before the heal. */
export function hpBefore(res: Pick<StandResult, 'hits' | 'hp' | 'healed'>): number | null {
  const first = res.hits?.[0];
  if (first) return first[2] + first[1];
  if (typeof res.hp !== 'number') return null;
  return res.hp - (res.healed ?? 0);
}

/**
 * How a movement round's reveal plays on the projector (MODE_MIXED §8, projector 4): after the stomp and the fall the
 * hits land one by one (each with its damage and the HP after it), then one thud for all of them, then the heal, the
 * new phase or the boss's fall. A void round has nothing to play.
 */
export function revealPlan(res: StandResult, firstMs = HITS_AFTER_MS): RevealPlan {
  const hits = res.void ? [] : (res.hits ?? []);
  const from = hpBefore(res) ?? res.hp ?? 0;
  const step = hits.length > 1 ? Math.min(HIT_MAX_MS, Math.max(HIT_MIN_MS, HITS_SPREAD_MS / (hits.length - 1))) : 0;
  const steps = hits.map(([id, dmg, hp], i) => ({ at: firstMs + i * step, id, dmg, hp }));
  const blow = steps.length ? steps[steps.length - 1].at + 260 : null;
  const tell = !res.void && ((res.healed ?? 0) > 0 || res.phase_changed === 1 || res.phase_changed === 2 || res.defeated === true);
  const news = tell ? (blow ?? firstMs) + 650 : null;
  const end = (news ?? blow ?? 0) + 400;
  return { from, hits: steps, blow, news, end };
}

/** The hits of a round with the most damage first (three for the line under the bar). */
export function strongest(res: Pick<StandResult, 'hits'>, n = 3): Array<{ id: number; dmg: number }> {
  return (res.hits ?? [])
    .map(([id, dmg], i) => ({ id, dmg, i }))
    .filter((h) => h.dmg > 0)
    .sort((a, b) => b.dmg - a.dmg || a.i - b.i)
    .slice(0, n)
    .map(({ id, dmg }) => ({ id, dmg }));
}

// ─────────────────────────────────────────── the phone's own round ───────────────────────────────────────────

/** ok: a hit; thaw: the ice broke; frozen: a miss (or no zone); seen: a late joiner; void: the round did not count. */
export type MixedTone = 'ok' | 'thaw' | 'frozen' | 'seen' | 'void';

export interface MixedOutcome {
  tone: MixedTone;
  title: string;
  /** «−141», or null. */
  big: string | null;
  lines: string[];
}

/**
 * The phone's line about its own movement round (MODE_MIXED §8, phone 4), from the room's `me.last` and the battle's
 * freeze after the round (`frozen`): «Верно. −141 Дедлайну», «Лёд растаял», «Мимо. Вы заморожены», «Вы не встали ни на
 * один ответ. Вы заморожены», «Вы зашли позже. Этот вопрос не считаем», «Мини-игра не засчитана».
 */
export function mixedOutcome(last: StandLast, frozen: boolean, nb: (n: number) => string = String): MixedOutcome {
  if (last.void) return { tone: 'void', title: 'Мини-игра не засчитана', big: null, lines: ['Связь с ареной пропала.', 'Урон и лёд не изменились.'] };
  if (last.late) return { tone: 'seen', title: 'Вы зашли позже', big: null, lines: ['Этот вопрос не считаем.'] };
  if (last.ok && last.thawed) return { tone: 'thaw', title: 'Лёд растаял', big: null, lines: ['Ответ верный. Урона в этот раз нет.', 'Со следующего вопроса бьёте как все.'] };
  if (last.ok) return { tone: 'ok', title: 'Верно', big: `−${nb(last.pts)}`, lines: ['урона Дедлайну'] };
  const what = last.choice === null ? 'Вы не встали ни на один ответ' : 'Мимо';
  const still = frozen && !last.froze;
  return { tone: 'frozen', title: what, big: null, lines: [still ? 'Вы всё ещё заморожены.' : 'Вы заморожены.', 'Ответьте верно, чтобы оттаять.'] };
}

/**
 * The phone's own round when the room's `me` never came (no socket): the database's result in the room's words.
 * `frozenBefore`: frozen when the round opened.
 */
export function lastOfResult(r: PlayerResult, choice: number | null, frozenBefore: boolean): StandLast {
  return {
    qi: r.qi,
    choice: r.none ? null : choice,
    ok: r.correct,
    pts: r.dmg,
    ms: null,
    fell: !r.correct && !r.void,
    revived: false,
    late: false,
    thawed: r.thawed,
    froze: r.frozen && !frozenBefore,
    void: r.void === true,
  };
}
