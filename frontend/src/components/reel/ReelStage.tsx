import { useLayoutEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import type { ReelClock } from './clock';
import { ClockProvider, SceneProvider, opacity, put, useFrame } from './engine';
import Brand from './scenes/Brand';
import Chaos from './scenes/Chaos';
import Group from './scenes/Group';
import Hints from './scenes/Hints';
import Intro from './scenes/Intro';
import Outro from './scenes/Outro';
import Plan from './scenes/Plan';
import Questions from './scenes/Questions';
import Session from './scenes/Session';
import { activeScenes, mix, sceneWindow, seg, type SceneId } from './timeline';

const SCENE_VIEWS: Record<SceneId, ComponentType> = {
  intro: Intro,
  chaos: Chaos,
  brand: Brand,
  questions: Questions,
  plan: Plan,
  session: Session,
  sheet: Hints,
  group: Group,
  outro: Outro,
};

/**
 * The corner mark «MELDY», over the chaos and over the chapters, white on the dark opening and ink on paper.
 * Only this mark: the corner brackets, the chapter label, the timecode and the chapter dots were taken out
 * (the owner, 2026-10-08: «не нравилась рамка по бокам вначале и надписи по углам, кроме Meldy»).
 */
const HUD_SPANS = [
  { from: sceneWindow('chaos').from + 300, to: sceneWindow('brand').from + 150 },
  // From chapter 01's own frame (after the app's top bar with its logo) to the end of chapter 05.
  { from: sceneWindow('questions').from + 2000, to: sceneWindow('group').to - 350 },
];

/** 1 = white mark (the dark opening), 0 = ink (the paper of every chapter). */
function hudLight(t: number): number {
  return t < sceneWindow('brand').from + 400 ? 1 : 0;
}

function Hud() {
  const root = useRef<HTMLDivElement>(null);
  useFrame((_, t) => {
    let show = 0;
    for (const span of HUD_SPANS) show = Math.max(show, Math.min(seg(t, span.from, 300), 1 - seg(t, span.to - 300, 300)));
    opacity(root.current, show);
    if (show <= 0) return;
    const light = hudLight(t);
    put(root.current, 'color', `rgb(${Math.round(mix(11, 255, light))},${Math.round(mix(18, 255, light))},${Math.round(mix(28, 255, light))})`);
  });
  return (
    <div ref={root} className="mr-hud" aria-hidden="true">
      <span className="mr-hud-t mr-hud-t--tl">MELDY</span>
    </div>
  );
}

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
 * unmounted after it ends) and the corner labels. React renders only when that set changes.
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
        <Hud />
      </div>
    </ClockProvider>
  );
}
