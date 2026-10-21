/**
 * The bar over the stage: Meldy, the mode and the test's name; the question's number, PIN and players; the teacher's
 * tools (sound, players, full screen, end) and the one blue «Дальше» when the game waits for the teacher.
 */
import { Maximize, Minimize, Users, Volume2, VolumeX } from 'lucide-react';
import { NEXT, TOP } from './copy';

export interface TopBarProps {
  title: string | null;
  question: { i: number; n: number } | null;
  final: boolean;
  pin: string | null;
  players: number | null;
  offline: boolean;
  full: boolean;
  next: { label: string; disabled: boolean; onClick: () => void } | null;
  onPlayers: (() => void) | null;
  onFull: () => void;
  onEnd: (() => void) | null;
  /** The sound's switch (remembered in this browser). */
  sound?: { muted: boolean; onToggle: () => void } | null;
}

export function TopBar({ title, question, final, pin, players, offline, full, next, onPlayers, onFull, onEnd, sound = null }: TopBarProps) {
  const q = question ? TOP.question(question.i, question.n) : null;
  return (
    <header className="lvh-top">
      <span className="lvh-logo" aria-label="Meldy">
        Meldy<i />
      </span>
      <span className="lvh-what">
        {TOP.mode}
        {title ? (
          <>
            {' · '}
            <b>{title}</b>
          </>
        ) : null}
      </span>
      <span className="lvh-grow" />
      {offline ? (
        <span className="lvh-pill lvh-pill--warn" role="status">
          {TOP.offline}
        </span>
      ) : null}
      {q ? (
        <span className="lvh-q-no">
          {q.before}
          <b>{q.i}</b>
          {q.after}
        </span>
      ) : null}
      {final ? <span className="lvh-q-no">{TOP.final}</span> : null}
      {pin ? <span className="lvh-pill">{TOP.pin(pin)}</span> : null}
      {players !== null ? <span className="lvh-pill">{TOP.playing(players)}</span> : null}
      <span className="lvh-tools">
        {sound ? (
          <button
            type="button"
            className="lvh-tool"
            onClick={sound.onToggle}
            aria-label={TOP.sound}
            aria-pressed={!sound.muted}
            title={sound.muted ? TOP.soundOn : TOP.soundOff}
            data-muted={sound.muted ? '' : undefined}
          >
            {sound.muted ? <VolumeX size={22} strokeWidth={2.2} aria-hidden="true" /> : <Volume2 size={22} strokeWidth={2.2} aria-hidden="true" />}
          </button>
        ) : null}
        {onPlayers ? (
          <button type="button" className="lvh-tool" onClick={onPlayers} aria-label={TOP.players} title={TOP.players}>
            <Users size={22} strokeWidth={2.2} aria-hidden="true" />
          </button>
        ) : null}
        <button type="button" className="lvh-tool" onClick={onFull} aria-label={full ? TOP.fullscreenOff : TOP.fullscreen} title={full ? TOP.fullscreenOff : TOP.fullscreen}>
          {full ? <Minimize size={22} strokeWidth={2.2} aria-hidden="true" /> : <Maximize size={22} strokeWidth={2.2} aria-hidden="true" />}
        </button>
        {onEnd ? (
          <button type="button" className="lvh-tool lvh-tool--text" onClick={onEnd}>
            {TOP.end}
          </button>
        ) : null}
      </span>
      {next ? (
        <button type="button" className="lvh-btn lvh-btn--next" onClick={next.onClick} disabled={next.disabled}>
          {next.label}
          <kbd className="lvh-kbd">{NEXT.key}</kbd>
        </button>
      ) : null}
    </header>
  );
}
