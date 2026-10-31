/**
 * Teams on the projector (docs/live/CONTRACT.md §13): the database gives each team's players, points and average
 * (`teams`, by place); the roster says who is in which team. The leaderboard shows the teams by their average with
 * each team's best player; the podium puts the teams on the blocks and names the game's best player.
 */
import { memo } from 'react';
import { nb } from '../host/copy';
import type { RosterRow, TeamRow } from '../../../lib/live/types';
import { TEAMS_COPY, TEAM_COLOURS } from './copy';
import { Thumb } from './Thumb';

export function teamColour(team: number | null | undefined): string {
  return (team && TEAM_COLOURS[team]) || '#8b8fa3';
}

/** The best player of a team (or of the class with `team` null): the most points, then right answers, then who came first. */
export function bestOf(roster: readonly RosterRow[], team: number | null): RosterRow | null {
  let best: RosterRow | null = null;
  for (const r of roster) {
    if (team !== null && r.team !== team) continue;
    if (!best || r.dmg > best.dmg || (r.dmg === best.dmg && r.right > best.right)) best = r;
  }
  return best && best.dmg > 0 ? best : null;
}

/** player id → team, for the scene's rings and the name tags. */
export function teamOfRows(roster: readonly RosterRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of roster) if (r.team) out.set(r.player_id, r.team);
  return out;
}

export const TeamBoard = memo(function TeamBoard({ teams, roster }: { teams: readonly TeamRow[]; roster: readonly RosterRow[] }) {
  return (
    <ol className="lvtm-board" aria-label={TEAMS_COPY.board}>
      {teams.map((t, i) => {
        const best = bestOf(roster, t.team);
        return (
          <li key={t.team} data-first={t.place === 1 ? '' : undefined} style={{ ['--tc' as string]: teamColour(t.team), ['--i' as string]: i }}>
            <span className="lvtm-place">{t.place}</span>
            <span className="lvtm-name">{TEAMS_COPY.name(t.team)}</span>
            <span className="lvtm-avg">
              <b>{nb(Math.round(t.avg))}</b>
              <span>{TEAMS_COPY.avgLabel}</span>
            </span>
            <span className="lvtm-n">{TEAMS_COPY.players(t.players)}</span>
            {best ? (
              <span className="lvtm-best">
                <Thumb look={best.look} size={44} />
                <span>{best.name}</span>
                <b>{nb(best.dmg)}</b>
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
});

/** The teams on the blocks (2 · 1 · 3, the 4th beside) and the game's best player. */
export const TeamPodium = memo(function TeamPodium({ teams, roster }: { teams: readonly TeamRow[]; roster: readonly RosterRow[] }) {
  const order = [1, 0, 2].filter((i) => teams[i]);
  const best = bestOf(roster, null);
  return (
    <div className="lvtm-podium">
      <div className="lvtm-blocks">
        {order.map((i) => {
          const t = teams[i];
          return (
            <div key={t.team} className={`lvtm-pod lvtm-pod--${i + 1}`} style={{ ['--tc' as string]: teamColour(t.team), ['--i' as string]: i }}>
              <div className="lvtm-pod-label">
                <span className="lvtm-name">{TEAMS_COPY.name(t.team)}</span>
                <span className="lvtm-pod-avg">
                  <b>{nb(Math.round(t.avg))}</b> {TEAMS_COPY.avgLabel}
                </span>
              </div>
              <div className="lvtm-pod-block">{t.place}</div>
            </div>
          );
        })}
        {teams[3] ? (
          <div className="lvtm-pod lvtm-pod--4" style={{ ['--tc' as string]: teamColour(teams[3].team), ['--i' as string]: 3 }}>
            <div className="lvtm-pod-label">
              <span className="lvtm-name">{TEAMS_COPY.name(teams[3].team)}</span>
              <span className="lvtm-pod-avg">
                <b>{nb(Math.round(teams[3].avg))}</b>
              </span>
            </div>
            <div className="lvtm-pod-block">{teams[3].place}</div>
          </div>
        ) : null}
      </div>
      {best ? (
        <div className="lvtm-mvp" style={{ ['--tc' as string]: teamColour(best.team) }}>
          <Thumb look={best.look} size={64} />
          <span>
            <small>{TEAMS_COPY.mvp}</small>
            <b>{best.name}</b>
          </span>
          <b className="lvtm-mvp-pts">{nb(best.dmg)}</b>
        </div>
      ) : null}
    </div>
  );
});
