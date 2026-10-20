/**
 * The end (prototype host-09): won or lost, the class's numbers and the three columns. The characters are the crowd's
 * (Crowd.tsx): the three by damage walk onto the columns, everyone else to the sides, cheering. After «Закончить игру»
 * the same picture stays, with the note that each student keeps their own review.
 */
import { memo } from 'react';
import type { HostState, Look, RosterRow, TopRow } from '../../../lib/live/types';
import { Character } from '../art/Character';
import { NEXT, PODIUM, nb } from './copy';
import { crowned, sameLook } from './Crowd';
import { PODIUM_COLUMNS, PODIUM_FLOOR, podiumTopSlots } from './layout';

/** dmg desc, right desc, joined asc (CONTRACT §3; the roster has no best streak). */
export function rankRoster(rows: readonly RosterRow[]): RosterRow[] {
  return rows.slice().sort((a, b) => b.dmg - a.dmg || b.right - a.right || (a.joined_at < b.joined_at ? -1 : a.joined_at > b.joined_at ? 1 : 0));
}

export type PodiumRow = Pick<TopRow, 'player_id' | 'name' | 'look' | 'dmg'>;

/** The three on the podium: the server's top (podium), else the roster ranked (ended early). */
export function podiumTop(state: HostState): PodiumRow[] {
  if (state.qi < 0) return [];
  return (state.top && state.top.length ? state.top : rankRoster(state.roster)).slice(0, 3);
}

/** One of the three who is not in the drawn crowd (joined after the first 40): drawn here. */
const Standalone = memo(
  function Standalone({ look, phaseMs }: { look: Look; phaseMs: number }) {
    return <Character look={look} size={130} face="happy" move="cheer" phaseMs={phaseMs} />;
  },
  (a, b) => a.phaseMs === b.phaseMs && sameLook(a.look, b.look),
);

const COLUMN_CLASS = ['lvh-pod-col--1', 'lvh-pod-col--2', 'lvh-pod-col--3'];

export interface PodiumProps {
  state: HostState;
  top: PodiumRow[];
  /** Ids the crowd draws (the rest of the three are drawn here). */
  drawn: ReadonlySet<string>;
  /** Players the sides have no room for. */
  more: number;
  width: number;
  busy: boolean;
  onReview: () => void;
  onAgain: (() => void) | null;
  onFinish: () => void;
}

export function Podium({ state, top, drawn, more, width, busy, onReview, onAgain, onFinish }: PodiumProps) {
  const ended = state.state === 'ended';
  const played = state.qi >= 0;
  const won = state.final?.won ?? state.boss.defeated;
  const title = !played ? PODIUM.ended : won ? PODIUM.won : PODIUM.lost;
  const asked = Math.max(0, state.qi + 1);
  const spots = podiumTopSlots(width);
  return (
    <div className="lvh-podium" data-won={won ? '' : undefined}>
      <div className="lvh-pod-head">
        <h1>{title}</h1>
        {played ? <p>{PODIUM.stats(asked, state.players, state.final ? state.final.accuracy_pct : null)}</p> : null}
      </div>
      <ol className="lvh-pod-stand" aria-label="Тройка по урону">
        {top.map((r, i) => {
          const col = PODIUM_COLUMNS[i];
          return (
            <li
              key={r.player_id}
              className={`lvh-pod-col ${COLUMN_CLASS[i]}`}
              style={{ left: width / 2 + col.dx, width: 220, height: col.h, top: PODIUM_FLOOR - col.h, ['--i' as string]: i }}
            >
              <b>{i + 1}</b>
              <span className="lvh-pod-name">{r.name}</span>
              <span className="lvh-pod-dmg">{PODIUM.dmg(r.dmg)}</span>
            </li>
          );
        })}
      </ol>
      {top.map((r, i) =>
        drawn.has(r.player_id) ? null : (
          <div key={r.player_id} className="lvh-pod-char" style={{ left: spots[i].x, top: spots[i].y, ['--i' as string]: i }}>
            <Standalone look={i === 0 ? crowned(r.look) : r.look} phaseMs={i * 160} />
          </div>
        ),
      )}
      {more > 0 ? <div className="lvh-pod-more">+{nb(more)}</div> : null}
      <div className="lvh-pod-actions">
        <button type="button" className="lvh-btn lvh-btn--white" onClick={onReview}>
          {PODIUM.review}
        </button>
        {onAgain ? (
          <button type="button" className="lvh-btn lvh-btn--white" onClick={onAgain}>
            {PODIUM.again}
          </button>
        ) : null}
        {ended ? (
          <p className="lvh-pod-note">{PODIUM.finished}</p>
        ) : (
          <button type="button" className="lvh-btn" onClick={onFinish} disabled={busy}>
            {PODIUM.finish}
            <kbd className="lvh-kbd">{NEXT.key}</kbd>
          </button>
        )}
      </div>
    </div>
  );
}
