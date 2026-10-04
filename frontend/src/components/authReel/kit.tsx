/** Small pieces shared by the sign-in reels' scenes. */
import { mix } from '../reel/timeline';

/** A circle opening from (x, y) over the stage: `p` 0 → closed, 1 → covers all of 1920 × 1080. */
export function circleClip(p: number, x: number, y: number): string {
  const reach = Math.hypot(Math.max(x, 1920 - x), Math.max(y, 1080 - y));
  return `circle(${mix(0, reach + 4, p).toFixed(1)}px at ${x}px ${y}px)`;
}

/** The stage covered from the bottom up: `p` 0 → nothing, 1 → all. */
export function riseClip(p: number): string {
  return `inset(${(100 - 100 * p).toFixed(2)}% 0 0 0)`;
}

export function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5.5 12.5l4.2 4.2L18.5 7.8" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 14.5v3A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5v-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** A document tile: three white lines on a coloured square (b = blue, y = yellow, p = pink, g = green). */
export function DocIcon({ tone = 'b' }: { tone?: 'b' | 'y' | 'p' | 'g' }) {
  return (
    <span className={`ar-icon${tone === 'b' ? '' : ` ar-icon--${tone}`}`}>
      <i />
      <i />
      <i />
    </span>
  );
}
