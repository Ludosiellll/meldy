import { useLayoutEffect, useRef } from 'react';
import { observeSize } from '../../lib/observeSize';

/**
 * The yellow ring around the menu item the guide talks about (guide.css .gd-pulse), inside the item. It pulses out
 * from 3 to 6 px and fades to 45 % and back, as the item's own box-shadow did, but on the compositor: one ring, wider
 * than it shows, carried out by a transform and faded by opacity, and clipped to the outside of the item, so it always
 * starts at the item's edge. The box-shadow repainted the menu (the phone's tab bar with its blur) on every frame
 * while the guide was open (smoothness audit 20.10).
 *
 * What depends on the item's size is set from its box when the size observer reports it (no layout of its own): the
 * scale that carries the ring 3 px further out on each side, the ring's own corners (the item's less its 6 px inset)
 * and the clip (everything but the item's rounded box).
 */
export default function GuidePulse() {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    return observeSize(element, () => {
      const width = element.offsetWidth;
      const height = element.offsetHeight;
      if (!width || !height) return;
      const own = Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0;
      const r = Math.min(own, width / 2, height / 2);
      element.style.setProperty('--gd-sx', ((width / 2 + 6) / (width / 2 + 3)).toFixed(5));
      element.style.setProperty('--gd-sy', ((height / 2 + 6) / (height / 2 + 3)).toFixed(5));
      element.style.setProperty('--gd-r', `${Math.max(0, r - 6)}px`);
      const w = width;
      const h = height;
      const box = r > 0
        ? `M${r} 0H${w - r}A${r} ${r} 0 0 1 ${w} ${r}V${h - r}A${r} ${r} 0 0 1 ${w - r} ${h}H${r}A${r} ${r} 0 0 1 0 ${h - r}V${r}A${r} ${r} 0 0 1 ${r} 0Z`
        : `M0 0H${w}V${h}H0Z`;
      element.style.clipPath = `path(evenodd, 'M-40 -40H${w + 40}V${h + 40}H-40Z${box}')`;
    });
  }, []);
  return <span ref={ref} className="gd-pulse" aria-hidden="true" />;
}
