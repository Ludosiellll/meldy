/**
 * The way in without a link: the six digits of the PIN from the teacher's screen. «Дальше» asks the server at once
 * (controller.checkPin): a wrong or finished PIN is said here, before the character.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { LiveBoss } from './art';
import type { PlayerController } from './controller';

/**
 * `onLeave`: the site's way back (owner, 06.11: «нельзя назад вернуться отсюда») — the page before, or the site's start
 * when /play was opened by a link. Telegram has its own «Назад» and passes none.
 */
export function PinScreen({ ctl, error, initial, busy, onLeave }: { ctl: PlayerController; error: string | null; initial: string; busy: boolean; onLeave?: () => void }) {
  const [value, setValue] = useState(initial);
  // A PIN from the address arrives after the first paint: the field shows the one being checked.
  useEffect(() => {
    if (initial) setValue(initial);
  }, [initial]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void ctl.submitPin(value);
  };
  const digits = value.replace(/\D/g, '').slice(0, 6);
  const shown = digits.length > 3 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : digits;
  return (
    <form className="lp-page-wrap" onSubmit={submit} style={{ display: 'contents' }}>
      <div className="lp-page">
        {onLeave ? (
          <button type="button" className="lp-leave" onClick={onLeave}>
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M12 4.5 6.5 10l5.5 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Назад
          </button>
        ) : null}
        <h1 className="lp-h1">Битва с монстром</h1>
        <p className="lp-sub">Весь класс против Дедлайна. Введите PIN с экрана ведущего.</p>
        <div className="lp-pin-boss">
          <LiveBoss size={150} phase={0} />
        </div>
        <div className="lp-pin-field">
          <label htmlFor="lp-pin">PIN игры</label>
          <input
            id="lp-pin"
            data-autofocus=""
            className="lp-pin-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            enterKeyHint="go"
            placeholder="000 000"
            value={shown}
            maxLength={7}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'lp-pin-error' : undefined}
            onChange={(e) => setValue(e.target.value.replace(/\D/g, '').slice(0, 6))}
          />
        </div>
        {error && (
          <p id="lp-pin-error" className="lp-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="lp-bar">
        <button type="submit" className="lp-btn lp-btn--main" disabled={digits.length !== 6 || busy}>
          {busy ? 'Ищем игру…' : 'Дальше'}
        </button>
      </div>
    </form>
  );
}
