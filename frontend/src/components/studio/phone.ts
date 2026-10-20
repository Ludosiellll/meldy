import { useEffect, useState, type RefObject } from 'react';
import type { FrameSize } from '../exams/useFrame';
import { STUDIO } from './copyStudio';
import { reducedMotion } from './useDark';

/**
 * The studio on a phone and a tablet (phone audit of 19.10): the bottom bar, the field under the keyboard, a block just
 * added, the words that must fit, the tour's clip.
 */

/**
 * The bottom bar («Блоки», «Настройки», «Отправить по ссылке») stands on every screen without the computer's three
 * columns: a phone upright or on its side and an iPad upright (frames 's' and 'm', up to 1023 px). Before 19.10 it
 * stood only below 640 px, and from 640 to 1023 these three were nowhere.
 */
export function hasBottomBar(size: FrameSize): boolean {
  return size === 's' || size === 'm';
}

/** …and steps away while a field of the page takes the keyboard: a keyboard that resizes the page would put the bar over the field. */
export function bottomBarShown(size: FrameSize, typing: boolean): boolean {
  return hasBottomBar(size) && !typing;
}

const TYPED_INPUTS = new Set(['', 'text', 'search', 'url', 'email', 'tel', 'number', 'password']);

/** The element opens the on-screen keyboard when it has the focus: a text field, a textarea, an editable element. */
export function takesKeyboard(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLTextAreaElement) return !target.readOnly && !target.disabled;
  if (target instanceof HTMLInputElement) return TYPED_INPUTS.has(target.type) && !target.readOnly && !target.disabled;
  return target.isContentEditable === true;
}

/** True while the focus is in a field inside `ref` that takes the keyboard (the page edited in place, «Текст», «Список»). */
export function useTyping(ref: RefObject<HTMLElement | null>): boolean {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const inside = (target: EventTarget | null) => target instanceof Node && Boolean(ref.current?.contains(target)) && takesKeyboard(target);
    let timer = 0;
    const onIn = (event: FocusEvent) => {
      window.clearTimeout(timer);
      setTyping(inside(event.target));
    };
    // After the focus has moved (relatedTarget is empty on a phone's tap outside): where it is now.
    const onOut = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setTyping(inside(document.activeElement)), 0);
    };
    document.addEventListener('focusin', onIn);
    document.addEventListener('focusout', onOut);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('focusin', onIn);
      document.removeEventListener('focusout', onOut);
    };
  }, [ref]);
  return typing;
}

/** The device has a pointer that hovers (a mouse, a trackpad): a field may take the focus without opening a keyboard. */
export function canHover(): boolean {
  try {
    return typeof window.matchMedia !== 'function' || window.matchMedia('(hover: hover)').matches;
  } catch {
    return true;
  }
}

/** Below this width the bar's blue button says «Отправить»; its name stays «Отправить по ссылке». */
export const SEND_SHORT_BELOW = 400;

export function sendWords(width: number): string {
  return width > 0 && width < SEND_SHORT_BELOW ? STUDIO.sendShort : STUDIO.send;
}

/**
 * The tour's clip shows the computer's studio (dragging from the left column): on a phone (narrower than 480 px) or a
 * screen too low for it (a phone on its side) the card goes without it.
 */
export function tourClipFits(width: number, height: number): boolean {
  return width >= 480 && height >= 600;
}

/**
 * A block just added is brought to the middle of the screen: `nearest` left it under a phone's bottom bar (live check
 * of 19.10: «Заголовок» from «Блоки» typed in under «Отправить по ссылке»).
 */
export function revealBlock(root: ParentNode | null | undefined, blockId: string): boolean {
  const node = root?.querySelector<HTMLElement>(`[data-block="${blockId}"]`);
  if (!node) return false;
  node.scrollIntoView?.({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
  return true;
}
