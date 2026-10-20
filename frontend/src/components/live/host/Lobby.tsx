/**
 * The room before the first question (prototype host-02): PIN in letters a class reads from the back, the QR code of the
 * join link (made on the device), the Telegram line, and the blue panel the characters stand on as they come in. The
 * characters themselves are the crowd's (Crowd.tsx): they stay when the game starts and walk into the arena.
 */
import { useMemo, type ReactNode } from 'react';
import type { HostState } from '../../../lib/live/types';
import { qrCode, shortLink } from '../../../lib/quizzes/qr';
import { LOBBY, NEXT, pinText } from './copy';
import type { Point } from './layout';

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
  players: number;
  /** Players the grid has no room for, and where «и ещё N» goes. */
  more: number;
  morePoint: Point;
  joinUrl: string;
  busy: boolean;
  onStart: () => void;
  /** The Telegram line (TelegramPost), when the exam is known. */
  telegram?: ReactNode;
}

export function Lobby({ state, players, more, morePoint, joinUrl, busy, onStart, telegram }: LobbyProps) {
  const n = LOBBY.count(players);
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
        {telegram}
        <p className="lvh-lobby-settings">{LOBBY.settings(state.time_s, state.speed, state.settings.who === 'members')}</p>
      </div>
      <section className="lvh-lobby-right" aria-label="Игроки">
        <div className="lvh-lobby-count" aria-live="polite">
          {players > 0 ? (
            <>
              {n.n}
              <span>{n.word}</span>
            </>
          ) : (
            <span className="lvh-lobby-wait">{LOBBY.waiting}</span>
          )}
        </div>
        {players > 0 ? <p className="lvh-lobby-kick">{LOBBY.kickHint}</p> : null}
      </section>
      {more > 0 ? (
        <div className="lvh-lobby-more" style={{ left: morePoint.x, top: morePoint.y }}>
          {LOBBY.more(more)}
        </div>
      ) : null}
      <div className="lvh-lobby-foot">
        <span>{LOBBY.foot}</span>
        <button type="button" className="lvh-btn" onClick={onStart} disabled={busy || players === 0}>
          {LOBBY.start}
          <kbd className="lvh-kbd">{NEXT.key}</kbd>
        </button>
      </div>
    </div>
  );
}
