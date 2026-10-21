/** «Вы в игре»: the own character, the rules in one line, the crowd (looks only, CONTRACT §5) and the PIN. */
import { memo, useEffect, useState } from 'react';
import type { Look } from '../../../lib/live/types';
import { LiveChar } from './art';
import type { PlayerController } from './controller';
import { pinText } from './copy';

/** Characters the crowd adds per frame: each brings six SVG layers to style and lay out. */
const PER_FRAME = 6;

/**
 * Up to 40 characters. They come in a few per frame after the screen has painted, so their style and layout never
 * land in one long frame (at ×4 CPU forty at once were a 120 ms task); later joiners come one by one anyway.
 */
const Crowd = memo(function Crowd({ crowd }: { crowd: readonly Look[] }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (shown >= crowd.length) return undefined;
    const frame = requestAnimationFrame(() => setShown((n) => Math.min(crowd.length, n + PER_FRAME)));
    return () => cancelAnimationFrame(frame);
  }, [shown, crowd.length]);
  return (
    <div className="lp-crowd" aria-hidden="true">
      {crowd.slice(0, shown).map((look, i) => (
        <LiveChar key={i} look={look} size={36} phaseMs={(i * 137) % 800} />
      ))}
    </div>
  );
});

export interface LobbyProps {
  ctl: PlayerController;
  look: Look;
  name: string;
  players: number;
  pin: string;
  crowd: readonly Look[];
  canEdit: boolean;
}

export function Lobby({ ctl, look, name, players, pin, crowd, canEdit }: LobbyProps) {
  return (
    <>
      <div className="lp-page">
        <h1 className="lp-h1">Вы в игре</h1>
        <p className="lp-sub">Ведущий начнёт, когда соберутся все.</p>
        <div className="lp-me-big">
          <div className="lp-floor" style={{ bottom: 26 }} />
          <LiveChar look={look} size={176} face="happy" move="cheer" title={`${name}, ваш персонаж`} />
        </div>
        <div className="lp-card">
          <b>Битва с монстром.</b> Весь класс против Дедлайна: верный ответ — удар, ошибка — заморозка до следующего верного.
        </div>
        <div className="lp-row">
          <span aria-live="polite">Играют {players}</span>
          {pin && <span>PIN {pinText(pin)}</span>}
        </div>
        <Crowd crowd={crowd} />
      </div>
      {canEdit && (
        <div className="lp-bar">
          <button type="button" className="lp-btn lp-btn--second" onClick={() => ctl.editLook()}>
            Изменить персонажа
          </button>
        </div>
      )}
    </>
  );
}
