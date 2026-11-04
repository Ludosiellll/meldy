import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Leaving the studio while something is not saved asks first (owner, 04.11: «если выйти по стрелке, ничего не
 * меняется»). The app runs on BrowserRouter, which has no blocker (useBlocker needs a data router), so the studio holds
 * the ways out itself while `active`:
 *
 * - a click on a link of this site that goes to another address (the studio's «Назад», the app's top line and tabs, any
 *   other in-app link), caught before the router's own handler (the capture phase) — a click with a modifier, a link to
 *   another site, a new tab or a download goes as usual;
 * - the browser's «Назад» and «Вперёд»: the move is taken back at once (the router never hears of it; the history's
 *   index, React Router's `idx` in history.state, says how far it went) and asked about; going on replays it;
 * - closing or reloading the tab: the browser's own question (beforeunload).
 *
 * `ask` gets the step; `go(step)` (from useLeaveGuard) takes it without asking again.
 */

export type LeaveStep = { kind: 'link'; to: string } | { kind: 'history'; delta: number };

const indexOf = (state: unknown): number | null => {
  const idx = state && typeof state === 'object' ? (state as { idx?: unknown }).idx : null;
  return typeof idx === 'number' && Number.isInteger(idx) ? idx : null;
};

export function useLeaveGuard(active: boolean, ask: (step: LeaveStep) => void, navigate: (to: string) => void): (step: LeaveStep) => void {
  const askRef = useRef(ask);
  askRef.current = ask;
  // The page's own address as the router has it (a link to it is no way out).
  const location = useLocation();
  const here = useRef('');
  here.current = `${location.pathname}${location.search}${location.hash}`;
  /** A step let through: the next history move is not held. */
  const released = useRef(false);

  useEffect(() => {
    if (!active) return undefined;
    released.current = false;
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!anchor || (anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      const to = `${url.pathname}${url.search}${url.hash}`;
      if (to === here.current) return;
      event.preventDefault();
      event.stopPropagation();
      askRef.current({ kind: 'link', to });
    };
    // The index the page stands at; a move away is undone with the opposite move, whose own popstate is swallowed.
    let at = indexOf(window.history.state);
    let undoing = false;
    const onPop = (event: PopStateEvent) => {
      if (released.current) return;
      if (undoing) {
        undoing = false;
        event.stopImmediatePropagation();
        return;
      }
      const next = indexOf(event.state);
      if (at === null || next === null || next === at) {
        at = next ?? at;
        return;
      }
      event.stopImmediatePropagation();
      const delta = next - at;
      undoing = true;
      window.history.go(-delta);
      askRef.current({ kind: 'history', delta });
    };
    const onUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    document.addEventListener('click', onClick, true);
    window.addEventListener('popstate', onPop, true);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('popstate', onPop, true);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [active]);

  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  return useRef((step: LeaveStep) => {
    released.current = true;
    if (step.kind === 'link') navigateRef.current(step.to);
    else window.history.go(step.delta);
  }).current;
}
