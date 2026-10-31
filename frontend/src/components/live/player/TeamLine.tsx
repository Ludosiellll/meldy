/**
 * The player's team on the phone (docs/live/CONTRACT.md §13): its name in its colour (the lobby), the teams' standings
 * by the average (the leaderboard), and the own team's place (the end). The names and colours are the projector's.
 */
import { memo } from 'react';
import type { TeamRow } from '../../../lib/live/types';
import { TEAM_COLOURS, TEAM_NAMES } from '../stand/copy';
import { nb } from './copy';

export const teamName = (t: number) => TEAM_NAMES[t] ?? `Команда ${t}`;
export const teamHex = (t: number) => TEAM_COLOURS[t] || '#8b8fa3';

export function TeamLine({ team }: { team: number }) {
  return (
    <p className="lp-team" style={{ ['--tc' as string]: teamHex(team) }}>
      <i aria-hidden="true" />
      Ваша команда: <b>{teamName(team)}</b>
    </p>
  );
}

/** The teams by place, the own one marked. */
export const TeamsMini = memo(function TeamsMini({ teams, mine }: { teams: readonly TeamRow[]; mine: number | null | undefined }) {
  return (
    <div className="lp-teams">
      <h3>Команды</h3>
      <ol>
        {teams.map((t) => (
          <li key={t.team} data-me={t.team === mine ? 'true' : 'false'} style={{ ['--tc' as string]: teamHex(t.team) }}>
            <span className="lp-n">{t.place}</span>
            <i aria-hidden="true" />
            <span className="lp-who">{t.team === mine ? `${teamName(t.team)} (ваша)` : teamName(t.team)}</span>
            <span>{nb(Math.round(t.avg))}</span>
          </li>
        ))}
      </ol>
    </div>
  );
});

/** «Ваша команда — 1-е место. В среднем 312 урона на игрока.» */
export function teamResult(teams: readonly TeamRow[], mine: number | null | undefined): string | null {
  const t = teams.find((r) => r.team === mine);
  if (!t) return null;
  return `${teamName(t.team)}${t.place === 1 ? ' победили' : ` — ${t.place}-е место`}. В среднем ${nb(Math.round(t.avg))} урона на игрока.`;
}
