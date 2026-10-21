/**
 * The studio's tour plays «Свой тест» from the studio on (UX audit of 21.10, P4): the tour comes once the test is open,
 * so its clip no longer starts with «Нажмите «Новый тест» и назовите тест». The same scene, its clock moved on by the
 * time the studio opens; the steps from the second one, at their times in the shorter loop. The scene's own fade starts
 * at its paper, so this loop opens from paper too (`tourfade`), and the seam never shows.
 */
import { useRef } from 'react';
import { SceneProvider, opacity, useEls, useFrame } from '../../reel/engine';
import { ease, seg } from '../../reel/timeline';
import type { ClipStep } from '../types';
import { FADE_IN, FADE_OUT } from './kit';
import { ST, STUDIO_STEPS, STUDIO_TOTAL, StudioScene } from './studio';

/** Where the tour's clip starts in «Свой тест»: the studio opens. */
export const TOUR_FROM = ST.studio;
export const STUDIO_TOUR_TOTAL = STUDIO_TOTAL - TOUR_FROM;
export const STUDIO_TOUR_STEPS: readonly ClipStep[] = STUDIO_STEPS.slice(1).map((step, at) => ({
  ...step,
  at: at === 0 ? 0 : step.at - TOUR_FROM,
  still: step.still - TOUR_FROM,
}));

export function StudioTourScene() {
  const root = useRef<HTMLDivElement>(null);
  const { one } = useEls(root);
  useFrame((l) => opacity(one('tourfade'), ease.out(seg(l, 0, FADE_IN)) * (1 - ease.in(seg(l, STUDIO_TOUR_TOTAL - FADE_OUT, FADE_OUT - 40)))));
  return (
    <div ref={root} className="mr-scene">
      <div data-a="tourfade" className="mr-scene" style={{ opacity: 0 }}>
        <SceneProvider value={{ from: -TOUR_FROM, to: STUDIO_TOTAL }}>
          <StudioScene />
        </SceneProvider>
      </div>
    </div>
  );
}
