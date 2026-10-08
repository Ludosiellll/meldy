import { useLayoutEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import type { ReelClock } from './clock';
import { ClockProvider, SceneProvider, put, useFrame } from './engine';
import End from './scenes/End';
import Paper from './scenes/Paper';
import { activeScenes, sceneWindow, type SceneId } from './timeline';

const SCENE_VIEWS: Record<SceneId, ComponentType> = {
  paper: Paper,
  end: End,
};

/** Hides a scene mounted ahead of its time: before its first moment nothing of it shows. */
function SceneGate({ from, children }: { from: number; children: ReactNode }) {
  const gate = useRef<HTMLDivElement>(null);
  useFrame((_, t) => put(gate.current, 'opacity', t >= from ? '1' : '0'));
  return (
    <div ref={gate} className="mr-layer" style={{ opacity: 0 }}>
      {children}
    </div>
  );
}

const sameScenes = (a: SceneId[], b: SceneId[]) => a.length === b.length && a.every((id, index) => id === b[index]);

/**
 * The stage: the scenes that are on at the clock's time (each mounted a little before it shows,
 * unmounted after it ends). React renders only when that set changes; the frames are written by the scenes.
 */
export default function ReelStage({ clock, scale }: { clock: ReelClock; scale: number }) {
  const [scenes, setScenes] = useState<SceneId[]>(() => activeScenes(clock.time));
  const current = useRef(scenes);
  useLayoutEffect(
    () =>
      clock.addFrame((t) => {
        const next = activeScenes(t);
        if (sameScenes(current.current, next)) return;
        current.current = next;
        setScenes(next);
      }),
    [clock],
  );
  return (
    <ClockProvider value={clock}>
      <div className="mr-stage" style={{ transform: `scale(${scale})` }} aria-hidden="true">
        {scenes.map((id) => {
          const View = SCENE_VIEWS[id];
          return (
            <SceneProvider key={id} value={sceneWindow(id)}>
              <SceneGate from={sceneWindow(id).from}>
                <View />
              </SceneGate>
            </SceneProvider>
          );
        })}
      </div>
    </ClockProvider>
  );
}
