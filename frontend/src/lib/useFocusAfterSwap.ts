import { useEffect, type RefObject } from 'react';

/**
 * When a screen inside `container` is swapped (`key` changes) and the focus was lost with the old screen (it sits on the
 * page's body), it goes to the new screen: its `[data-autofocus]` element, else its first heading (made focusable with
 * tabindex -1), so a keyboard or a screen reader is told what came (accessibility audit 07.11, A11Y-4: the class game,
 * the duel). A focus the person holds elsewhere is never taken.
 */
export function useFocusAfterSwap(container: RefObject<HTMLElement | null>, key: string): void {
  useEffect(() => {
    const root = container.current;
    if (!root || typeof document === 'undefined') return;
    const active = document.activeElement;
    if (active && active !== document.body && active !== document.documentElement) return;
    const target = root.querySelector<HTMLElement>('[data-autofocus]') ?? root.querySelector<HTMLElement>('h1, h2');
    if (!target) return;
    if (!target.matches('a[href], button, input, select, textarea, [tabindex]')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  }, [container, key]);
}
