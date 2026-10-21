/**
 * The end (prototype host-09): won or lost, the class's numbers and the three columns. The characters are the crowd's
 * (Crowd.tsx): the three by damage walk onto the columns, everyone else to the sides, cheering. After «Закончить игру»
 * the same picture stays, with the note that each student keeps their own review. A game the teacher stopped before its
 * last question says only that it is over, with the questions that really closed; one stopped before any question
 * closed is just «Игра закрыта» (ClosedScreen), without the crowd.
 */
import { memo } from 'react';
import { Link } from 'react-router-dom';
import { accuracyPct } from '../../../lib/live/rules';
import type { HostState, Look, RosterRow, TopRow } from '../../../lib/live/types';
import { Character } from '../art/Character';
import { CLOSED, NEXT, PODIUM, nb } from './copy';
import { crowned, sameLook } from './Crowd';
import { PODIUM_COLUMNS, PODIUM_FLOOR, podiumTopSlots } from './layout';

/** dmg desc, right desc, joined asc (CONTRACT §3; the roster has no best streak). */
export function rankRoster(rows: readonly RosterRow[]): RosterRow[] {
  return rows.slice().sort((a, b) => b.dmg - a.dmg || b.right - a.right || (a.joined_at < b.joined_at ? -1 : a.joined_at > b.joined_at ? 1 : 0));
}

export type PodiumRow = Pick<TopRow, 'player_id' | 'name' | 'look' | 'dmg'>;

/** Questions that closed: the current one counts once its result is out (a game stopped mid-question does not count it). */
export function questionsClosed(s: Pick<HostState, 'qi' | 'result'>): number {
  if (s.qi < 0) return 0;
  return s.qi + (s.result && s.result.qi === s.qi ? 1 : 0);
}

/**
 * How the game ended. `won` / `lost`: the monster fell, or every question closed with it standing (CONTRACT §3).
 * `stopped`: the teacher ended it before its last question — the server records no winner then (`final` is null).
 * `closed`: ended before any question closed (from the lobby, or during the first question).
 */
export type Outcome = 'won' | 'lost' | 'stopped' | 'closed';

export function gameOutcome(s: Pick<HostState, 'state' | 'qi' | 'q_count' | 'result' | 'boss' | 'final'>): Outcome {
  const asked = questionsClosed(s);
  if (asked === 0) return 'closed';
  if (s.boss.defeated || s.final?.won) return 'won';
  if (s.state === 'podium' || asked >= s.q_count) return 'lost';
  return 'stopped';
}

/** The class's share of right answers over the questions that closed (the server's, when it gave one for this outcome). */
export function classAccuracy(s: HostState, outcome: Outcome): number {
  if (s.final && (outcome === 'won' || outcome === 'lost')) return s.final.accuracy_pct;
  const right = s.roster.reduce((sum, r) => sum + r.right, 0);
  return accuracyPct(right, s.roster.length, questionsClosed(s));
}

/** The three on the podium: the server's top (podium), else the roster ranked (ended early). */
export function podiumTop(state: HostState): PodiumRow[] {
  if (questionsClosed(state) === 0) return [];
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
  const outcome = gameOutcome(state);
  const won = outcome === 'won';
  const title = won ? PODIUM.won : outcome === 'lost' ? PODIUM.lost : PODIUM.ended;
  const asked = questionsClosed(state);
  const players = state.roster.length;
  const pct = classAccuracy(state, outcome);
  const spots = podiumTopSlots(width);
  return (
    <div className="lvh-podium" data-won={won ? '' : undefined} data-outcome={outcome}>
      <div className="lvh-pod-head">
        <h1>{title}</h1>
        <p>{outcome === 'stopped' ? PODIUM.statsStopped(asked, state.q_count, players, pct) : PODIUM.stats(asked, players, pct)}</p>
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

/** Ended before any question closed (from the lobby, or in the first question): nothing to rank, the way back. */
export function ClosedScreen({ testHref, onAgain }: { testHref: string; onAgain: (() => void) | null }) {
  return (
    <div className="lvh-msg lvh-closed" role="status">
      <h1>{CLOSED.title}</h1>
      <p>{CLOSED.why}</p>
      <div className="lvh-msg-actions">
        <Link className="lvh-btn" to={testHref}>
          {CLOSED.back}
        </Link>
        {onAgain ? (
          <button type="button" className="lvh-btn lvh-btn--white" onClick={onAgain}>
            {CLOSED.again}
          </button>
        ) : null}
      </div>
    </div>
  );
}
