import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTheme } from '../../contexts/ThemeProvider';
import { useMiniApp } from '../../lib/telegram/miniApp';
import '../../styles/telegram.css';

/** Where Telegram's «Назад» is not shown: «Сегодня» is the Mini App's home (Telegram's own «Закрыть» leaves it). */
export function isMiniAppHome(pathname: string): boolean {
  // /tg/play (the live game) runs its own «Назад»: a step back inside the game, hidden while playing.
  return pathname === '/dashboard' || pathname === '/' || pathname === '/tg' || pathname === '/tg/play';
}

/**
 * The parts of the app that follow Telegram while it is a Mini App (lib/telegram/miniApp.ts); outside Telegram it
 * renders nothing and does nothing. Mounted once inside the router (App.tsx):
 * - Meldy's light or dark theme after Telegram's colour scheme (not written to the student's own choice; until the
 *   script is in, the one public/theme-init.js read from the launch holds), the student's own again when the visit
 *   turns out not to be Telegram's;
 * - Telegram's «Назад» on every page but «Сегодня»: a step back in the app's history, or «Сегодня» when there is none
 *   (the page's own «‹ …» links are hidden in this mode: styles/telegram.css, Layout).
 */
export default function TelegramChrome() {
  const mini = useMiniApp();
  const { setForcedTheme } = useTheme();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const scheme = mini.status === 'on' ? mini.scheme : mini.status === 'outside' ? null : undefined;
  const webApp = mini.status === 'on' ? mini.webApp : null;
  const home = isMiniAppHome(pathname);

  useEffect(() => {
    if (scheme !== undefined) setForcedTheme(scheme);
  }, [scheme, setForcedTheme]);

  useEffect(() => {
    const back = webApp?.BackButton;
    if (!back) return undefined;
    if (home) {
      back.hide();
      return undefined;
    }
    const onBack = () => {
      const index = (window.history.state as { idx?: unknown } | null)?.idx;
      if (typeof index === 'number' && index > 0) navigate(-1);
      else navigate('/dashboard', { replace: true });
    };
    back.onClick(onBack);
    back.show();
    return () => back.offClick(onBack);
  }, [webApp, home, navigate]);

  return null;
}
