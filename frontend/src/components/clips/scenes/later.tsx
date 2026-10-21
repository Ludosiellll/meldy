/**
 * A clip that plays another clip's scene from a later moment (UX audit of 21.10, P4): the studio's tour skips
 * «Новый тест», the teacher's «Как ученик пишет» skips the studio's «Отправить по ссылке». The same scene, its clock
 * moved on; the steps from the second one, at their times in the shorter loop. The scene's own fade is at its start,
 * so the later loop fades in and out by itself (`laterfade`), and the seam never shows.
 */
import { useRef, type ComponentType } from 'react';
import { SceneProvider, opacity, useEls, useFrame } from '../../reel/engine';
import { ease, seg } from '../../reel/timeline';
import type { ClipStep } from '../types';
import { FADE_IN, FADE_OUT } from './kit';

/** The steps after the first, their times counted from `from`. */
export function laterSteps(steps: readonly ClipStep[], from: number): readonly ClipStep[] {
  return steps.slice(1).map((step, at) => ({ ...step, at: at === 0 ? 0 : step.at - from, still: step.still - from }));
}

/** `Scene` (a loop of `total`) played from `from` to its end. */
export function laterScene(Scene: ComponentType, from: number, total: number): ComponentType {
  const length = total - from;
  function LaterScene() {
    const root = useRef<HTMLDivElement>(null);
    const { one } = useEls(root);
    useFrame((l) => opacity(one('laterfade'), ease.out(seg(l, 0, FADE_IN)) * (1 - ease.in(seg(l, length - FADE_OUT, FADE_OUT - 40)))));
    return (
      <div ref={root} className="mr-scene">
        <div data-a="laterfade" className="mr-scene" style={{ opacity: 0 }}>
          <SceneProvider value={{ from: -from, to: total }}>
            <Scene />
          </SceneProvider>
        </div>
      </div>
    );
  }
  return LaterScene;
}
