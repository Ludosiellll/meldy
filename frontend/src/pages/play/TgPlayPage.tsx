/**
 * /tg/play — «Битва с монстром» inside Telegram (docs/live/CONTRACT.md §9; meldy-notes
 * 10_Project/Telegram_Live_Game_Spec_2026-10-20.md). Opened by the group post's «Играть» (the direct link
 * `t.me/Meldyteach_bot/play?startapp=<PIN>`) or by the private chat's web_app button (`/tg/play?pin=<PIN>`);
 * `startapp=r_<game>` opens that game's review.
 *
 * The Mini App gate is lib/telegram/miniApp.ts, unchanged: Telegram's script and the Mini App mode start only inside a
 * real Telegram client (its bridge). Without one this address is the site's /play (a link with Telegram's launch data
 * in a plain browser tab gets no Telegram anything). In Telegram: full screen, Telegram's haptics, the closing
 * confirmation and swipes off while playing, the token in SecureStorage, «Назад» for a step back.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { liveApi, liveFakeWanted } from '../../lib/live/api';
import { MINI_APP_PATH, bootMiniApp, launchData, miniAppState, useMiniApp } from '../../lib/telegram/miniApp';
import { PlayerApp } from '../../components/live/player/PlayerApp';
import { PlayerController } from '../../components/live/player/controller';
import { obeyOffline } from '../../components/live/player/offline';
import { LiveBoss } from '../../components/live/player/art';
import { enterFullscreen, pinOf, reviewGameOf, telegramPlatform, type GameWebApp } from '../../components/live/player/telegram';
import '../../components/live/player/player.css';

export const BOT_URL = 'https://t.me/Meldyteach_bot';

function Loading() {
  return (
    <main className="lp" aria-label="Битва с монстром">
      <div className="lp-page" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <LiveBoss size={120} phase={0} />
        <p className="lp-sub" role="status">
          Открываем игру…
        </p>
      </div>
    </main>
  );
}

function TelegramGame({ webApp }: { webApp: GameWebApp }) {
  const { search } = useLocation();
  const [entry] = useState(() => {
    const launch = launchData();
    const params = new URLSearchParams(search);
    const start = launch?.startParam ?? null;
    const typed = params.get('pin');
    return {
      pin: pinOf(start) ?? (typed && /^\d{6}$/.test(typed) ? typed : null),
      reviewGame: reviewGameOf(start) ?? reviewGameOf(params.get('r') ? `r_${params.get('r')}` : null),
      initData: launch?.initData ?? '',
      firstName: launch?.firstName ?? null,
    };
  });
  const [platform] = useState(() => telegramPlatform({ webApp, initData: entry.initData, firstName: entry.firstName, fake: liveFakeWanted() }));
  const [ctl] = useState(() => {
    const id = webApp.initDataUnsafe?.user?.id;
    return new PlayerController({ api: obeyOffline(liveApi()), platform, profile: typeof id === 'number' ? `tg.${id}` : 'tg' });
  });

  useEffect(() => enterFullscreen(webApp), [webApp]);

  useEffect(() => {
    void ctl.start({ pin: entry.pin, reviewGame: entry.reviewGame });
    return () => ctl.dispose();
  }, [ctl, entry]);

  // Telegram's «Назад»: one handler at a time, hidden when there is no step back.
  const current = useRef<(() => void) | null>(null);
  const onBackChange = useCallback(
    (handler: (() => void) | null) => {
      const back = webApp.BackButton;
      if (!back) return;
      try {
        if (current.current) back.offClick(current.current);
        current.current = handler;
        if (handler) {
          back.onClick(handler);
          back.show();
        } else back.hide();
      } catch {
        // An old client without «Назад»: the screens have their own buttons.
      }
    },
    [webApp],
  );

  return <PlayerApp ctl={ctl} platform={platform} shareUrl={BOT_URL} onBackChange={onBackChange} />;
}

export default function TgPlayPage() {
  const mini = useMiniApp();
  const { search } = useLocation();

  useEffect(() => {
    // main.tsx boots the Mini App on /tg only; the game's address asks for the same gate.
    if (miniAppState().status === 'off') void bootMiniApp(MINI_APP_PATH);
  }, []);

  if (mini.status === 'outside') return <Navigate to={{ pathname: '/play', search }} replace />;
  if (mini.status !== 'on') return <Loading />;
  return <TelegramGame webApp={mini.webApp as GameWebApp} />;
}
