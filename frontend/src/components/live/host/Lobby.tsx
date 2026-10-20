/**
 * The room before the first question (prototype host-02): PIN in letters a class reads from the back, the QR code of the
 * join link (made on the device), and the characters as they come in. A character is a button: the teacher can remove
 * a player. New characters drop in once (CSS, on mount); the ones already there do not render again.
 */
import { memo, useMemo } from 'react';
import type { HostState, Look, RosterRow } from '../../../lib/live/types';
import { qrCode, shortLink } from '../../../lib/quizzes/qr';
import { Character } from '../art/Character';
import { sameLook } from './Arena';
import { LOBBY, NEXT, pinText } from './copy';
import { LOBBY_MAX } from './layout';

const LobbyChar = memo(
  function LobbyChar({ row, phaseMs, onPick }: { row: RosterRow; phaseMs: number; onPick: (row: RosterRow) => void }) {
    return (
      <li className="lvh-lobby-cell">
        <button type="button" className="lvh-lobby-char" onClick={() => onPick(row)} aria-label={row.name}>
          <Character look={row.look} size={72} name={row.name} phaseMs={phaseMs} />
        </button>
      </li>
    );
  },
  (a, b) => a.onPick === b.onPick && a.phaseMs === b.phaseMs && a.row.player_id === b.row.player_id && a.row.name === b.row.name && sameLook(a.row.look as Look, b.row.look as Look),
);

function Qr({ text }: { text: string }) {
  const qr = useMemo(() => qrCode(text), [text]);
  return (
    <svg className="lvh-qr-svg" viewBox={`-1 -1 ${qr.size + 2} ${qr.size + 2}`} role="img" aria-label={`QR-код: ${shortLink(text)}`} shapeRendering="crispEdges">
      <path d={qr.path} fill="#0B121C" />
    </svg>
  );
}

export interface LobbyProps {
  state: HostState;
  rows: RosterRow[];
  joinUrl: string;
  busy: boolean;
  onStart: () => void;
  onPick: (row: RosterRow) => void;
}

export function Lobby({ state, rows, joinUrl, busy, onStart, onPick }: LobbyProps) {
  const shown = rows.slice(0, LOBBY_MAX);
  const more = rows.length - shown.length;
  const n = LOBBY.count(rows.length);
  const site = shortLink(joinUrl.replace(/\?.*$/, ''));
  return (
    <div className="lvh-lobby">
      <div className="lvh-lobby-left">
        <div className="lvh-lobby-pin-k">{LOBBY.pin}</div>
        <div className="lvh-lobby-pin" aria-label={`PIN ${state.pin.split('').join(' ')}`}>
          {pinText(state.pin)}
        </div>
        <div className="lvh-qr">
          <Qr text={joinUrl} />
        </div>
        <p className="lvh-lobby-how">
          <b>{LOBBY.camera}</b> {LOBBY.cameraText}
          <br />
          <b>{LOBBY.site}</b> {site}
        </p>
        <p className="lvh-lobby-settings">{LOBBY.settings(state.time_s, state.speed, state.settings.who === 'members')}</p>
      </div>
      <section className="lvh-lobby-right" aria-label="Игроки">
        <div className="lvh-lobby-count" aria-live="polite">
          {rows.length > 0 ? (
            <>
              {n.n}
              <span>{n.word}</span>
            </>
          ) : (
            <span className="lvh-lobby-wait">{LOBBY.waiting}</span>
          )}
        </div>
        {rows.length > 0 ? <p className="lvh-lobby-kick">{LOBBY.kickHint}</p> : null}
        <ul className="lvh-lobby-grid">
          {shown.map((row, i) => (
            <LobbyChar key={row.player_id} row={row} phaseMs={(i * 137) % 900} onPick={onPick} />
          ))}
          {more > 0 ? <li className="lvh-lobby-more">{LOBBY.more(more)}</li> : null}
        </ul>
      </section>
      <div className="lvh-lobby-foot">
        <span>{LOBBY.foot}</span>
        <button type="button" className="lvh-btn" onClick={onStart} disabled={busy || rows.length === 0}>
          {LOBBY.start}
          <kbd className="lvh-kbd">{NEXT.key}</kbd>
        </button>
      </div>
    </div>
  );
}
