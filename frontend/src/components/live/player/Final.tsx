/**
 * The end of the game on the phone: who won, the own place on a podium block, damage and best streak, the parts this
 * game opened, «Разбор ошибок» and «Поделиться».
 */
import { useEffect, useRef, useState } from 'react';
import type { Boss, Final as FinalData, Look, UnlockId } from '../../../lib/live/types';
import { LiveChar } from './art';
import type { PlayerController } from './controller';
import { UNLOCK_NAMES, nb, questions } from './copy';
import type { HapticKind, PlayerPlatform, ShareResult } from './platform';

const BLOCK: Record<number, number> = { 1: 108, 2: 84, 3: 66 };

function withUnlock(look: Look, unlock: UnlockId): Look {
  if (unlock === 'graphite' || unlock === 'snow') return { ...look, colour: unlock };
  return { ...look, hat: unlock };
}

export interface FinalProps {
  ctl: PlayerController;
  platform: PlayerPlatform;
  final: FinalData;
  boss: Boss;
  look: Look;
  players: number;
  asked: number;
  guest: boolean;
  gameId: string;
  token: () => string | null;
  shareUrl: string;
  haptic: (kind: HapticKind) => void;
}

export function Final({ ctl, platform, final, boss, look, players, asked, guest, gameId, token, shareUrl, haptic }: FinalProps) {
  const [shared, setShared] = useState<ShareResult | null>(null);
  const [busy, setBusy] = useState(false);
  const fired = useRef(false);
  const won = final.won;
  const left = boss.hp_max > 0 ? Math.max(1, Math.round((100 * boss.hp) / boss.hp_max)) : 0;
  const crown = final.unlocked_now.includes('crown');
  const shown = crown ? { ...look, hat: 'crown' as const } : look;
  const height = BLOCK[final.place] ?? 52;
  const placeLine = final.dmg > 0 ? `вы ${final.place}-й по урону из ${players}` : 'урона в этот раз нет';

  useEffect(() => {
    if (fired.current) return undefined;
    fired.current = true;
    const t = setTimeout(() => haptic(won ? 'success' : 'warning'), 250);
    const u = final.unlocked_now.length ? setTimeout(() => haptic('success'), 1250) : null;
    return () => {
      clearTimeout(t);
      if (u) clearTimeout(u);
    };
  }, [haptic, won, final.unlocked_now.length]);

  const share = async () => {
    const t = token();
    if (!t || busy) return;
    setBusy(true);
    const title = won ? 'Дедлайн повержен' : 'Битва с Дедлайном';
    const text = `${final.place}-е место из ${players} · урон ${nb(final.dmg)}. Играть с Meldy`;
    const result = await platform.share({ title, text, url: shareUrl, gameId, token: t });
    setShared(result);
    setBusy(false);
  };

  return (
    <>
      <div className="lp-page">
        <h1 className="lp-h1">{won ? 'Дедлайн повержен' : 'Дедлайн победил'}</h1>
        <p className="lp-sub">
          {won ? `${questions(asked)} · ${placeLine}` : `У Дедлайна осталось ${left} % · ${placeLine}`}
        </p>
        <div className="lp-stage">
          <div className="lp-block" style={{ height }}>
            {final.place}
          </div>
          <div className="lp-winner" style={{ bottom: height - 2 }}>
            <LiveChar look={shown} size={150} face={won ? 'happy' : 'idle'} move={won ? 'cheer' : 'idle'} title={`Ваш персонаж, ${final.place}-е место`} />
          </div>
        </div>
        <div className="lp-card lp-stats">
          <span>
            <b>{final.place}-е место</b> из {players}
          </span>
          <span>урон {nb(final.dmg)}</span>
          <span>серия {final.best}</span>
        </div>
        <p className="lp-sub">
          Верных ответов у класса — {final.accuracy_pct} %, у вас — {final.right} из {asked}.
        </p>
        {final.unlocked_now.map((u) => (
          <div key={u} className="lp-card lp-unlock">
            <LiveChar look={withUnlock(look, u)} size={62} face="happy" move="none" />
            <div>
              <b>{UNLOCK_NAMES[u].title}</b>
              <br />
              <span>
                {UNLOCK_NAMES[u].why} {guest ? 'Чтобы открытое оставалось у вас, играйте из Telegram или войдите в Meldy.' : 'Уже в вашем шкафу.'}
              </span>
            </div>
          </div>
        ))}
        <button type="button" className="lp-btn lp-btn--quiet" style={{ marginTop: 8 }} onClick={() => ctl.restart()}>
          Ещё игра по PIN
        </button>
        {shared === 'copied' && (
          <p className="lp-sub" role="status">
            Ссылка скопирована.
          </p>
        )}
        {shared === 'failed' && (
          <p className="lp-error" role="status">
            Не получилось поделиться.
          </p>
        )}
      </div>
      <div className="lp-bar">
        <button type="button" className="lp-btn lp-btn--second" onClick={() => void ctl.openReview()}>
          Разбор ошибок
        </button>
        <button type="button" className="lp-btn lp-btn--main" disabled={busy} onClick={() => void share()}>
          Поделиться
        </button>
      </div>
    </>
  );
}
