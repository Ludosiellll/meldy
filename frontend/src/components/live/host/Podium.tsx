/**
 * The end (prototype host-09): won or lost, the class's numbers, the three by damage on the podium and everyone else
 * cheering at the sides. Columns rise and characters land once (CSS on mount). After «Закончить игру» the same picture
 * stays, with the note that each student keeps their own review.
 */
import { memo } from 'react';
import type { HostState, Look, RosterRow, TopRow } from '../../../lib/live/types';
import { Character } from '../art/Character';
import { sameLook } from './Arena';
import { NEXT, PODIUM, nb } from './copy';
import { podiumSlots } from './layout';

/** dmg desc, right desc, joined asc (CONTRACT §3; the roster has no best streak). */
export function rankRoster(rows: readonly RosterRow[]): RosterRow[] {
  return rows.slice().sort((a, b) => b.dmg - a.dmg || b.right - a.right || (a.joined_at < b.joined_at ? -1 : a.joined_at > b.joined_at ? 1 : 0));
}

const PodiumChar = memo(
  function PodiumChar({ look, size, name, phaseMs }: { look: Look; size: number; name?: string; phaseMs: number }) {
    return <Character look={look} size={size} name={name} face="happy" move="cheer" phaseMs={phaseMs} />;
  },
  (a, b) => a.size === b.size && a.name === b.name && a.phaseMs === b.phaseMs && sameLook(a.look, b.look),
);

const crownCache = new WeakMap<Look, Look>();
function crowned(look: Look): Look {
  if (look.hat === 'crown') return look;
  let out = crownCache.get(look);
  if (!out) {
    out = { ...look, hat: 'crown' };
    crownCache.set(look, out);
  }
  return out;
}

const COLUMNS = [
  { dx: -110, h: 300, cls: 'lvh-pod-col--1' },
  { dx: -340, h: 230, cls: 'lvh-pod-col--2' },
  { dx: 120, h: 190, cls: 'lvh-pod-col--3' },
];
const FLOOR = 780;

export interface PodiumProps {
  state: HostState;
  roster: RosterRow[];
  width: number;
  busy: boolean;
  onReview: () => void;
  onAgain: (() => void) | null;
  onFinish: () => void;
}

export function Podium({ state, roster, width, busy, onReview, onAgain, onFinish }: PodiumProps) {
  const ended = state.state === 'ended';
  const played = state.qi >= 0;
  const ranked = rankRoster(roster);
  const top: Array<Pick<TopRow, 'player_id' | 'name' | 'look' | 'dmg'>> = (state.top && state.top.length ? state.top : ranked).slice(0, 3).filter((r) => r.dmg > 0 || played);
  const onPodium = new Set(top.map((r) => r.player_id));
  const rest = ranked.filter((r) => !onPodium.has(r.player_id));
  const crowd = podiumSlots(rest.length, width);
  const won = state.final?.won ?? state.boss.defeated;
  const title = !played ? PODIUM.ended : won ? PODIUM.won : PODIUM.lost;
  const asked = Math.max(0, state.qi + 1);
  return (
    <div className="lvh-podium" data-won={won ? '' : undefined}>
      <div className="lvh-pod-head">
        <h1>{title}</h1>
        {played ? <p>{PODIUM.stats(asked, state.players, state.final ? state.final.accuracy_pct : null)}</p> : null}
      </div>
      <ol className="lvh-pod-stand" aria-label="Тройка по урону">
        {top.map((r, i) => {
          const col = COLUMNS[i];
          return (
            <li key={r.player_id} className={`lvh-pod-col ${col.cls}`} style={{ left: width / 2 + col.dx, width: 220, height: col.h, top: FLOOR - col.h, ['--i' as string]: i }}>
              <b>{i + 1}</b>
              <span className="lvh-pod-name">{r.name}</span>
              <span className="lvh-pod-dmg">{PODIUM.dmg(r.dmg)}</span>
            </li>
          );
        })}
      </ol>
      {top.map((r, i) => {
        const col = COLUMNS[i];
        // The first wears the crown for the photo (the hat of the art, so it jumps with the character).
        const look = i === 0 ? crowned(r.look) : r.look;
        return (
          <div key={r.player_id} className="lvh-pod-char" style={{ left: width / 2 + col.dx + 45, top: FLOOR - col.h - 128, ['--i' as string]: i }}>
            <PodiumChar look={look} size={130} phaseMs={i * 160} />
          </div>
        );
      })}
      {rest.slice(0, crowd.length).map((r, i) => {
        const s = crowd[i];
        return (
          <div key={r.player_id} className="lvh-pod-fan" style={{ left: s.x, top: s.y, ['--i' as string]: i % 12 }}>
            <PodiumChar look={r.look} size={s.size} name={r.name} phaseMs={(i * 140) % 700} />
          </div>
        );
      })}
      {rest.length > crowd.length ? <div className="lvh-pod-more">+{nb(rest.length - crowd.length)}</div> : null}
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
