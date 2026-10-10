/**
 * A Telegram chat with the Meldy bot as Telegram draws it (light theme): the phone, the status bar, the chat's header
 * with the bot's round avatar and «бот», the wallpaper's tint, a date pill, white bubbles with a tail and the time,
 * inline buttons under a message (the blue one is Telegram's «primary» style), the callback toast, the input bar. The
 * system font inside the phone, not the site's. No Telegram logo.
 *
 * Self-contained in the reel for now (the tip clips build their own chat in components/tips): every piece is a plain
 * component styled by telegram.css, and the scene moves them by their `data-a` names — another chat look can replace
 * this file and its stylesheet without touching the scene.
 */
import type { ReactNode } from 'react';
import './telegram.css';

/** The bot's profile photo (bot/avatar.ts): the app's mark — blue, a white «m», the yellow dot — in a round crop. */
export function BotAvatar({ size = 40 }: { size?: number }) {
  return (
    <svg className="mr-tg-ava" width={size} height={size} viewBox="0 0 512 512" aria-hidden="true">
      <circle cx="256" cy="256" r="256" fill="#2869dd" />
      <g transform="translate(-13 0)">
        <path d="M121 342V222a52 52 0 0 1 104 0v120M225 222a52 52 0 0 1 104 0v120" fill="none" stroke="#ffffff" strokeWidth="46" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="385" cy="322" r="30" fill="#f4c45b" />
      </g>
    </svg>
  );
}

function StatusIcons() {
  return (
    <span className="mr-tg-sys">
      <svg viewBox="0 0 18 12" width="18" height="12" aria-hidden="true">
        <rect x="0" y="8" width="3" height="4" rx="1" fill="currentColor" />
        <rect x="5" y="5.5" width="3" height="6.5" rx="1" fill="currentColor" />
        <rect x="10" y="3" width="3" height="9" rx="1" fill="currentColor" />
        <rect x="15" y="0" width="3" height="12" rx="1" fill="currentColor" />
      </svg>
      <svg viewBox="0 0 16 12" width="16" height="12" aria-hidden="true">
        <path d="M8 11.2 5.6 8.6a3.4 3.4 0 0 1 4.8 0Zm-4.1-4.3a5.8 5.8 0 0 1 8.2 0l1.6-1.7a8.2 8.2 0 0 0-11.4 0Zm-3.3-3.4a10.4 10.4 0 0 1 14.8 0L17 1.9a12.7 12.7 0 0 0-18 0Z" fill="currentColor" />
      </svg>
      <svg viewBox="0 0 27 12" width="27" height="12" aria-hidden="true">
        <rect x="0.5" y="0.5" width="22" height="11" rx="3.5" fill="none" stroke="currentColor" opacity="0.4" />
        <rect x="2" y="2" width="16" height="8" rx="2" fill="currentColor" />
        <path d="M24.5 4v4a2 2 0 0 0 0-4Z" fill="currentColor" opacity="0.4" />
      </svg>
    </span>
  );
}

/** The phone: status bar, the chat's header, the chat (children), the input bar. */
export function TgPhone({ time, name, status, children }: { time: string; name: string; status: string; children: ReactNode }) {
  return (
    <div className="mr-tg-phone">
      <div className="mr-tg-screen">
        <div className="mr-tg-wall" />
        <div className="mr-tg-status">
          <span>{time}</span>
          <i className="mr-tg-island" />
          <StatusIcons />
        </div>
        <div className="mr-tg-head">
          <span className="mr-tg-back">
            <svg viewBox="0 0 12 20" width="12" height="20" aria-hidden="true">
              <path d="M10 2 2 10l8 8" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <b>Чаты</b>
          </span>
          <span className="mr-tg-title">
            <b>{name}</b>
            <span>{status}</span>
          </span>
          <BotAvatar size={40} />
        </div>
        <div className="mr-tg-chat">{children}</div>
        <div className="mr-tg-input">
          <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
            <path
              d="M20.5 11.6 12.4 19.7a5.2 5.2 0 0 1-7.4-7.4l8.4-8.4a3.5 3.5 0 0 1 4.9 4.9l-8.4 8.4a1.7 1.7 0 0 1-2.4-2.4l7.7-7.7"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="mr-tg-field">Сообщение</span>
          <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
            <rect x="8.6" y="2.6" width="6.8" height="12.2" rx="3.4" fill="none" stroke="currentColor" strokeWidth="1.7" />
            <path d="M5.4 11.4a6.6 6.6 0 0 0 13.2 0M12 18v3.4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
        </div>
        <i className="mr-tg-home" />
      </div>
    </div>
  );
}

export function TgDate({ children }: { children: ReactNode }) {
  return <div className="mr-tg-date">{children}</div>;
}

export interface TgButton {
  text: string;
  /** Telegram's «primary» style: the blue button. */
  primary?: boolean;
  /** A link button: the small arrow in its corner. */
  url?: boolean;
  /** The scene's name for it (a press, a highlight). */
  a?: string;
}

/** An incoming message: the white bubble with its tail and the time, and the inline buttons under it. */
export function TgMessage({ time, children, keyboard = [], a }: { time: string; children: ReactNode; keyboard?: TgButton[][]; a?: string }) {
  return (
    <div className="mr-tg-msg" data-a={a}>
      <div className="mr-tg-bubble">
        {children}
        <span className="mr-tg-time-room" />
        <span className="mr-tg-time">{time}</span>
        <svg className="mr-tg-tail" viewBox="0 0 11 20" width="11" height="20" aria-hidden="true">
          <path d="M11 0v20H0c4.6-.5 7.6-2.5 9.4-6C10.5 11.6 11 7 11 0Z" fill="currentColor" />
        </svg>
      </div>
      {keyboard.length > 0 ? (
        <div className="mr-tg-keys">
          {keyboard.map((row, index) => (
            <div key={index} className="mr-tg-row">
              {row.map((button) => (
                <span key={button.text} className={`mr-tg-key${button.primary ? ' mr-tg-key--primary' : ''}`} data-a={button.a}>
                  {/* Where a finger touches the button (a phone has no pointer). */}
                  {button.a ? <i className="mr-tg-touch" data-a={`${button.a}-touch`} /> : null}
                  {button.text}
                  {button.url ? (
                    <svg className="mr-tg-url" viewBox="0 0 10 10" width="9" height="9" aria-hidden="true">
                      <path d="M3 1h6v6M9 1 1.5 8.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : null}
                </span>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The short notice Telegram shows when a button's answer has words (answerCallbackQuery). */
export function TgToast({ children, a }: { children: ReactNode; a?: string }) {
  return (
    <div className="mr-tg-toast" data-a={a}>
      {children}
    </div>
  );
}
