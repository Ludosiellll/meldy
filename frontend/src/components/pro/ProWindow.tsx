import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { OPEN_PRO_EVENT, type ProReason } from '../../lib/plans';
import { track } from '../../lib/telemetry';
import { lazyPart, useLazyPart } from '../../lib/lazyPart';

/**
 * The window itself (ProWindowDialog.tsx, its styles and words) is a file of its own: fetched the
 * first time the window opens, or earlier by the idle prefetch. The listener below is light and is
 * mounted with the app, so an event from anywhere is never missed.
 */
export const proWindowPart = lazyPart(() => import('./ProWindowDialog').then((module) => module.default));

const REASONS: readonly ProReason[] = ['pricing', 'limit', 'meter'];
const isReason = (value: unknown): value is ProReason => typeof value === 'string' && (REASONS as readonly string[]).includes(value);

/**
 * Mounted once inside the router (App.tsx): listens for `meldy:open-pro` (lib/plans.ts
 * openProWindow) and shows the window over any page. Focus goes back to what opened it; another
 * page closes it.
 */
export function ProWindowProvider() {
  const [state, setState] = useState<{ open: boolean; reason: ProReason }>({ open: false, reason: 'pricing' });
  const openRef = useRef(false);
  const opener = useRef<HTMLElement | null>(null);
  const { pathname } = useLocation();
  const path = useRef(pathname);

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ reason?: unknown } | null>).detail;
      const reason = isReason(detail?.reason) ? detail.reason : 'pricing';
      if (!openRef.current) {
        const active = document.activeElement;
        opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
        track('pro_window_open', { reason });
      }
      openRef.current = true;
      setState({ open: true, reason });
    };
    window.addEventListener(OPEN_PRO_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_PRO_EVENT, onOpen);
  }, []);

  const close = useCallback(() => {
    if (!openRef.current) return;
    openRef.current = false;
    setState((previous) => ({ ...previous, open: false }));
  }, []);

  // Once the window has left the page (its focus guard is gone), focus returns to the opener.
  useEffect(() => {
    if (state.open) return;
    const back = opener.current;
    opener.current = null;
    if (!back || !back.isConnected || typeof back.focus !== 'function') return;
    try {
      back.focus({ preventScroll: true });
    } catch {
      back.focus();
    }
  }, [state.open]);

  // Another page (a link in the window, «назад») closes it.
  useEffect(() => {
    if (path.current === pathname) return;
    path.current = pathname;
    close();
  }, [pathname, close]);

  // Its file failed to load: the window does not open (the error is logged); the next opening tries again.
  const ProWindow = useLazyPart(proWindowPart, state.open, {
    immediate: true,
    onError: (error) => {
      console.error('Окно PRO не загрузилось:', error);
      close();
    },
  });

  return state.open && ProWindow ? <ProWindow reason={state.reason} onClose={close} /> : null;
}
