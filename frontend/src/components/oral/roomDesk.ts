import { useCallback, useRef, type KeyboardEvent } from 'react';

/**
 * The desk column of the answer room follows the reader on a computer (oral.css, ≥ 1024 px: position sticky
 * under the room's top line), so «Готово» and the protocol's next steps stay in view while a long answer or
 * protocol scrolls (PUB-1, EX-29). A column taller than the window would keep its last controls under the
 * window's edge, so its height goes to the CSS as --or-side-h: such a column scrolls with the page until its
 * bottom is in view, then stays. A callback ref: the room renders a different column in each phase.
 */
export function useDeskColumn(): (node: HTMLElement | null) => void {
  const observer = useRef<ResizeObserver | null>(null);
  return useCallback((node: HTMLElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node) return;
    const write = () => node.style.setProperty('--or-side-h', `${Math.ceil(node.offsetHeight)}px`);
    write();
    if (typeof ResizeObserver === 'undefined') return;
    observer.current = new ResizeObserver(write);
    observer.current.observe(node);
  }, []);
}

/** A Mac (or an iPad with a keyboard) names the key ⌘, everything else Ctrl. */
export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const data = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  const platform = data?.platform || navigator.platform || '';
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** «Ctrl + Enter» or «⌘ + Enter»: the keys that press «Готово» from the answer field. */
export function finishKeysLabel(apple = isApplePlatform()): string {
  return apple ? '⌘ + Enter' : 'Ctrl + Enter';
}

/** For aria-keyshortcuts on «Готово». */
export const FINISH_SHORTCUTS = 'Control+Enter Meta+Enter';

/**
 * Ctrl+Enter or ⌘+Enter in an answer field: «Готово» (PUB-1, EX-29). Not while an input method composes a
 * word, not with Shift or Alt; the line break of a plain Enter stays.
 */
export function isFinishKey(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'> & { nativeEvent?: { isComposing?: boolean } }): boolean {
  if (event.key !== 'Enter' || event.shiftKey || event.altKey) return false;
  if (event.nativeEvent?.isComposing) return false;
  return event.ctrlKey || event.metaKey;
}
