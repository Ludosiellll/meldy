/**
 * The battle on the 3D projector (BattleHost): what the button questions need from the database's HostState, without
 * React and without 3D. Pure, tested in battle.test.ts.
 */
import type { StandResult } from '../../../lib/live/move/protocol';
import type { HostState, RosterRow } from '../../../lib/live/types';
import type { TimerFace } from './plan';
import type { BattleRow } from './scene';

/** The class round the boss: the database's players in joining order (an older one first; equal times by id). */
export function battleRows(roster: readonly RosterRow[]): BattleRow[] {
  return roster
    .slice()
    .sort((a, b) => (a.joined_at < b.joined_at ? -1 : a.joined_at > b.joined_at ? 1 : a.player_id < b.player_id ? -1 : a.player_id > b.player_id ? 1 : 0))
    .map((r) => ({ pid: r.player_id, name: r.name, look: r.look }));
}

/** Who is frozen in the battle now (the database's word). */
export function frozenPids(roster: readonly RosterRow[]): Set<string> {
  return new Set(roster.filter((r) => r.frozen).map((r) => r.player_id));
}

/**
 * A button question's result in the shape a movement round's reveal plays (mixed.ts revealPlan): the hits as
 * [index, damage, HP after] in the database's order (time, then player), and `pids[index]` the player of each.
 */
export function tapRevealOf(s: Pick<HostState, 'result' | 'boss'>): { res: StandResult; pids: string[] } | null {
  const r = s.result;
  if (!r) return null;
  const pids = r.hits.map((h) => h.player_id);
  const res: StandResult = {
    qi: r.qi,
    key: r.key,
    counts: r.counts,
    stood: r.right,
    of: 0,
    fastest: null,
    fell: [],
    back: [],
    at: 0,
    back_at: 0,
    hits: r.hits.map((h, i) => [i, h.dmg, h.hp_after] as [number, number, number]),
    hp: s.boss.hp,
    hp_max: s.boss.hp_max,
    healed: r.healed,
    phase_changed: r.phase_changed,
    defeated: s.boss.defeated,
    void: false,
  };
  return { res, pids };
}

/** The first hit of a button question (the database stores the hits by time): «Быстрее всех». */
export function fastestHit(s: Pick<HostState, 'result' | 'roster'>): { name: string; dmg: number } | null {
  const h = s.result?.hits?.[0];
  if (!h) return null;
  const row = s.roster.find((r) => r.player_id === h.player_id);
  return row ? { name: row.name, dmg: h.dmg } : null;
}

/**
 * The timer's face of a button question at `now` (this device's ms): 3-2-1 before the answers open (ready), then the
 * seconds left; hot in the last `alarmMs`; `left` the share of the time left (1 → 0). Stopped (everyone answered, or the
 * reveal came): the seconds it stopped at, not hot.
 */
export function tapTimerFace(opensAt: number, closesAt: number, now: number, stoppedAt: number | null = null, alarmMs = 3000): TimerFace {
  const t = stoppedAt !== null ? Math.min(now, stoppedAt) : now;
  if (t < opensAt) return { sec: Math.max(1, Math.ceil((opensAt - t) / 1000)), ready: true, hot: false, left: 1 };
  const total = Math.max(1000, closesAt - opensAt);
  const rest = Math.max(0, closesAt - t);
  const sec = Math.ceil(rest / 1000);
  return { sec, ready: false, hot: stoppedAt === null && rest > 0 && rest <= alarmMs, left: Math.max(0, Math.min(1, rest / total)) };
}
