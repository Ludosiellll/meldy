import { useLayoutEffect, type RefObject } from 'react';

/**
 * A popover that opened past the window's side is moved back in, `margin` px from the edge. A menu is laid along
 * its button's right edge; when the button stands at the left of a phone (the lecture page's «Экспорт» on its own
 * row), the menu went off the screen to the left (dialog audit 2026-10-07, 390×844: only its right 77 px showed).
 */
export function useKeepInView(ref: RefObject<HTMLElement>, open: boolean, margin = 12): void {
  useLayoutEffect(() => {
    const node = ref.current;
    if (!open || !node) return;
    node.style.removeProperty('translate');
    const rect = node.getBoundingClientRect();
    const width = document.documentElement.clientWidth || window.innerWidth;
    if (rect.width === 0 || width === 0) return;
    let shift = 0;
    if (rect.left < margin) shift = margin - rect.left;
    else if (rect.right > width - margin) shift = Math.max(margin - rect.left, width - margin - rect.right);
    if (shift !== 0) node.style.setProperty('translate', `${Math.round(shift)}px 0`);
  }, [ref, open, margin]);
}
