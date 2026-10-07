/**
 * The last beat of both sign-in reels: a statement ending with the yellow dot, then the wordmark, and
 * its dot alone in the middle — the frame the reel starts from.
 */
import { useRef } from 'react';
import { opacity, put, useEls, useFrame } from '../reel/engine';
import { STAGE_H, STAGE_W, clamp, ease, mix, seg } from '../reel/timeline';
import { Statement, Wordmark, focusIn, slideIn } from '../film/kit';

/** Under the wordmark: what Meldy is, in the words of the landing (Release 29). */
export const READY_TAG = 'Тренажёр устного экзамена по билетам кафедры';

/** How long the beat is (ms): the loop wraps at its end. */
export const READY_LENGTH = 4400;
/** The dot of the loop, in stage pixels: where every reel starts and ends. */
export const HOME = { x: STAGE_W / 2, y: STAGE_H / 2, size: 34 };

export function Ready({ lines }: { lines: readonly string[] }) {
  const root = useRef<HTMLDivElement>(null);
  const { one } = useEls(root);
  const from = useRef<{ x: number; y: number; size: number } | null>(null);
  useFrame((l) => {
    slideIn(one('mark'), l, 1950, { dx: 160, dur: 760, smear: 22 });
    focusIn(one('tag'), l, 2350, 600, 10);
    const leave = seg(l, 3100, 380);
    put(one('mark'), 'filter', `blur(${(16 * ease.in(leave)).toFixed(2)}px)`);
    if (l >= 3100) opacity(one('mark'), 1 - leave);
    if (l >= 3000) opacity(one('tag'), 1 - seg(l, 3000, 300));

    // The wordmark's own dot stays behind and glides home to the middle.
    if (l >= 3050 && !from.current) from.current = measureDot(one('wmdot'), root.current);
    if (l < 3050) from.current = null;
    const start = from.current ?? HOME;
    const home = ease.inOut(seg(l, 3150, 700));
    const size = mix(start.size, HOME.size, home);
    const dot = one('home');
    put(dot, 'width', `${size.toFixed(2)}px`);
    put(dot, 'height', `${size.toFixed(2)}px`);
    put(dot, 'transform', `translate3d(${(mix(start.x, HOME.x, home) - size / 2).toFixed(1)}px,${(mix(start.y, HOME.y, home) - size / 2).toFixed(1)}px,0)`);
    opacity(dot, l >= 3100 ? 1 : 0);
    opacity(one('wmdot'), l >= 3100 ? 0 : 1);
  });
  return (
    <div ref={root} className="mr-scene">
      <Statement lines={lines} at={500} dot out={1700} className="ar-say ar-say--end" />
      <div data-a="mark" className="ar-mark" style={{ opacity: 0 }}>
        <Wordmark className="ar-mark-w" />
      </div>
      <p data-a="tag" className="ar-tag" style={{ opacity: 0 }}>
        {READY_TAG}
      </p>
      <i data-a="home" className="fm-brand-dot ar-home" style={{ opacity: 0 }} />
    </div>
  );
}

/** Where the wordmark's dot is on the stage (stage pixels), or null where nothing is laid out. */
function measureDot(dot: Element | undefined, scene: HTMLElement | null): { x: number; y: number; size: number } | null {
  const stage = scene?.closest('.mr-stage');
  if (!dot || !stage) return null;
  const s = stage.getBoundingClientRect();
  const d = dot.getBoundingClientRect();
  if (!s.width || !d.width) return null;
  const scale = s.width / STAGE_W;
  return {
    x: clamp((d.left + d.width / 2 - s.left) / scale, 0, STAGE_W),
    y: clamp((d.top + d.height / 2 - s.top) / scale, 0, STAGE_H),
    size: d.width / scale,
  };
}
