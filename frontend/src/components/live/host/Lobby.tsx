/**
 * The room before the first question, for the class at the back of the room: a card with the short address, the PIN
 * in the biggest letters on the screen and the QR code of the join link (made on the device); the panel the class
 * gathers on, with their count; and one line of the teacher's under both — the settings, the post into the chat (a
 * compact control, TelegramPost) and «Начать». The characters are the crowd's (Crowd.tsx): they stay when the game
 * starts and walk into the arena.
 */
import { useMemo, type ReactNode } from 'react';
import type { HostState } from '../../../lib/live/types';
import { qrCode, shortLink } from '../../../lib/quizzes/qr';
import { LOBBY, NEXT, pinText } from './copy';
import { mixedOf } from '../../../lib/live/types';
import { lobbyBoxes, type Point } from './layout';

function Qr({ text }: { text: string }) {
  const qr = useMemo(() => qrCode(text), [text]);
  return (
    <svg className="lvh-qr-svg" viewBox={`-1 -1 ${qr.size + 2} ${qr.size + 2}`} role="img" aria-label={`QR-код: ${shortLink(text)}`} shapeRendering="crispEdges">
      <path d={qr.path} fill="#0B121C" />
    </svg>
  );
}

const box = (b: { x: number; y: number; w: number; h: number }) => ({ left: b.x, top: b.y, width: b.w, height: b.h });

/** The teacher's line under the card and the panel starts here (host.css .lvh-lobby-foot). */
export const FOOT_X = 40;
/** The post's list or note (host.css .lvh-tg-pop). */
const TG_POP_W = 500;

export interface LobbyProps {
  state: HostState;
  players: number;
  /** Players the grid has no room for, and where «и ещё N» goes. */
  more: number;
  morePoint: Point;
  moreW: number;
  joinUrl: string;
  width: number;
  busy: boolean;
  onStart: () => void;
  /** The teacher's post into the chat (TelegramPost), when the exam is known. */
  telegram?: ReactNode;
  /** The chat the game was posted to: the class is told where its «Играть» is. */
  tgChat?: string | null;
}

export function Lobby({ state, players, more, morePoint, moreW, joinUrl, width, busy, onStart, telegram, tgChat = null }: LobbyProps) {
  const n = LOBBY.count(players);
  const site = shortLink(joinUrl.replace(/\?.*$/, ''));
  const { card, panel } = lobbyBoxes(width);
  // the address on one line, as big as the card allows (Onest's bold letters average ~0.56 of their size)
  const siteFont = Math.max(22, Math.min(32, Math.floor((card.w - 80) / (Math.max(1, site.length) * 0.56))));
  return (
    <div className="lvh-lobby">
      <section className="lvh-lobby-card" style={box(card)} aria-label={LOBBY.how}>
        <div className="lvh-lobby-k">{LOBBY.go}</div>
        <div className="lvh-lobby-site" style={{ fontSize: siteFont }}>
          {site}
        </div>
        <div className="lvh-lobby-k lvh-lobby-k--pin">{LOBBY.pin}</div>
        <div className="lvh-lobby-pin" aria-label={`PIN ${state.pin.split('').join(' ')}`}>
          {pinText(state.pin)}
        </div>
        <div className="lvh-lobby-scan">
          <div className="lvh-qr">
            <Qr text={joinUrl} />
          </div>
          <p>
            {LOBBY.camera}
            {tgChat !== null ? <span className="lvh-lobby-tg">{LOBBY.tg(tgChat)}</span> : null}
            <span className="lvh-lobby-later">{LOBBY.later}</span>
          </p>
        </div>
      </section>
      <section className="lvh-lobby-panel" style={box(panel)} aria-label={LOBBY.players}>
        <div className="lvh-lobby-count" aria-live="polite">
          {players > 0 ? (
            <>
              <b>{n.n}</b>
              <span>{n.word}</span>
            </>
          ) : null}
        </div>
        {players === 0 ? (
          <div className="lvh-lobby-wait">
            <b>{LOBBY.waiting}</b>
            <span>{LOBBY.waitingHint}</span>
          </div>
        ) : null}
      </section>
      {more > 0 ? (
        <div className="lvh-lobby-more" style={{ left: morePoint.x, top: morePoint.y, width: moreW }}>
          {LOBBY.more(more)}
        </div>
      ) : null}
      {/* the post's list or note opens over the class's panel at its right — the PIN and the QR code stay in view, and
          the class fills the panel from the top left */}
      <div className="lvh-lobby-foot" style={{ ['--tg-pop-x' as string]: `${panel.x + panel.w - FOOT_X - 28 - TG_POP_W}px` }}>
        <span className="lvh-lobby-settings">{LOBBY.settings(state.time_s, state.speed, state.settings.who === 'members', mixedOf(state)?.rounds, !!state.calm)}</span>
        {telegram}
        <span className="lvh-grow" />
        <button type="button" className="lvh-btn lvh-btn--start" onClick={onStart} disabled={busy || players === 0}>
          {LOBBY.start}
          <kbd className="lvh-kbd">{NEXT.key}</kbd>
        </button>
      </div>
    </div>
  );
}
