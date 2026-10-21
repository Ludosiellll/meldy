/**
 * A small readout at the top centre for checking a real device (the projector laptop, a phone): frames a second, the slowest 5 %
 * of frames in ms, and the 3D quality level (0 best … 5 cheapest; «2D» when the phone plays the light view). It shows
 * only with `?fps=1` in the address, never by default. It times the page's own animation frames, so it costs one
 * requestAnimationFrame callback and one text update a second.
 */
import { useEffect, useRef } from 'react';

/** Whether the address asks for the readout (`?fps=1`). */
export function fpsWanted(search: string = typeof window !== 'undefined' ? window.location.search : ''): boolean {
  return new URLSearchParams(search).get('fps') === '1';
}

/** fps and p95 of frame intervals (ms), from the last second's intervals. */
export function frameNumbers(intervals: readonly number[]): { fps: number; p95: number } {
  if (intervals.length === 0) return { fps: 0, p95: 0 };
  const sum = intervals.reduce((a, b) => a + b, 0);
  const sorted = intervals.slice().sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(0.95 * (sorted.length - 1) + 0.5))];
  return { fps: sum > 0 ? (1000 * intervals.length) / sum : 0, p95 };
}

export function FpsReadout({ quality }: { quality: () => number | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const qualityRef = useRef(quality);
  qualityRef.current = quality;
  useEffect(() => {
    let raf = 0;
    let last = 0;
    let shown = 0;
    const intervals: number[] = [];
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (last) intervals.push(now - last);
      last = now;
      if (now - shown < 1000) return;
      shown = now;
      const { fps, p95 } = frameNumbers(intervals);
      intervals.length = 0;
      const q = qualityRef.current();
      if (ref.current) ref.current.textContent = `${fps.toFixed(0)} fps · p95 ${p95.toFixed(1)} ms · ${q === null ? '2D' : `3D ${q}`}`;
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div
      ref={ref}
      aria-hidden="true"
      style={{
        // top centre: the corners and the bottom hold the screens' buttons and the phone's status card
        position: 'fixed',
        top: 'max(2px, env(safe-area-inset-top))',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        padding: '4px 8px',
        borderRadius: 6,
        background: 'rgba(0, 0, 0, 0.72)',
        color: '#fff',
        font: '600 12px/1.3 ui-monospace, monospace',
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
      }}
    />
  );
}
