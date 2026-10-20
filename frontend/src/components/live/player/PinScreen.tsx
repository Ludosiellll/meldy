/** The way in without a link: the six digits of the PIN from the teacher's screen. */
import { useState, type FormEvent } from 'react';
import { LiveBoss } from './art';
import type { PlayerController } from './controller';

export function PinScreen({ ctl, error, initial }: { ctl: PlayerController; error: string | null; initial: string }) {
  const [value, setValue] = useState(initial);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    ctl.submitPin(value);
  };
  const digits = value.replace(/\D/g, '').slice(0, 6);
  const shown = digits.length > 3 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : digits;
  return (
    <form className="lp-page-wrap" onSubmit={submit} style={{ display: 'contents' }}>
      <div className="lp-page">
        <h1 className="lp-h1">Битва с монстром</h1>
        <p className="lp-sub">Весь класс против Дедлайна. Введите PIN с экрана ведущего.</p>
        <div className="lp-pin-boss">
          <LiveBoss size={150} phase={0} />
        </div>
        <div className="lp-pin-field">
          <label htmlFor="lp-pin">PIN игры</label>
          <input
            id="lp-pin"
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
        <button type="submit" className="lp-btn lp-btn--main" disabled={digits.length !== 6}>
          Дальше
        </button>
      </div>
    </form>
  );
}
