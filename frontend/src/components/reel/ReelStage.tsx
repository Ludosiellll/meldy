import { useLayoutEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import type { ReelClock } from './clock';
import { ClockProvider, SceneProvider, opacity, put, text, flag, useEls, useFrame } from './engine';
import Brand from './scenes/Brand';
import Chaos from './scenes/Chaos';
import Intro from './scenes/Intro';
import Oral from './scenes/Oral';
import Outro from './scenes/Outro';
import Ready from './scenes/Ready';
import Review from './scenes/Review';
import Tickets from './scenes/Tickets';
import Tour from './scenes/Tour';
import { CHAPTERS, activeScenes, chapterAt, clamp, ease, mix, sceneWindow, seg, timecode, type SceneId } from './timeline';

const SCENE_VIEWS: Record<SceneId, ComponentType> = {
  intro: Intro,
  chaos: Chaos,
  brand: Brand,
  tour: Tour,
  tickets: Tickets,
  oral: Oral,
  review: Review,
  ready: Ready,
  outro: Outro,
};

/** The corner labels: visible over the chaos and over the chapters, light on dark scenes. */
const HUD_SPANS = [
  { from: sceneWindow('chaos').from + 300, to: sceneWindow('brand').from + 150, label: '00 / Сессия' },
  { from: sceneWindow('tickets').from + 150, to: sceneWindow('ready').to - 350, label: '' },
];

function hudLabel(t: number): { text: string; since: number } {
  const chapter = chapterAt(t);
  if (chapter) return { text: `${chapter.number} / ${chapter.label}`, since: chapter.at };
  return { text: HUD_SPANS[0].label, since: HUD_SPANS[0].from };
}

/** 1 = white corner labels (dark and blue scenes), 0 = ink (paper scenes). */
function hudLight(t: number): number {
  const darkFrom = sceneWindow('ready').from;
  if (t < sceneWindow('brand').from + 400) return 1;
  return clamp((t - darkFrom - 100) / 300);
}

function Hud() {
  const root = useRef<HTMLDivElement>(null);
  const { one, all } = useEls(root);
  useFrame((_, t) => {
    let show = 0;
    for (const span of HUD_SPANS) show = Math.max(show, Math.min(seg(t, span.from, 300), 1 - seg(t, span.to - 300, 300)));
    opacity(root.current, show);
    if (show <= 0) return;
    const light = hudLight(t);
    const channel = Math.round(mix(11, 255, light));
    put(root.current, 'color', `rgb(${channel},${Math.round(mix(18, 255, light))},${Math.round(mix(28, 255, light))})`);
    const label = hudLabel(t);
    const typed = Math.floor(((t - label.since) * 30) / 1000);
    text(one('label'), label.text.toUpperCase().slice(0, Math.max(0, typed)));
    text(one('time'), timecode(t));
    const chapter = chapterAt(t);
    all('dot').forEach((dot, index) => flag(dot, 'is-on', Boolean(chapter && CHAPTERS[index].id === chapter.id)));
    const slide = 1 - ease.brand(show);
    all('corner').forEach((corner, index) => {
      const sx = index % 2 === 0 ? -1 : 1;
      const sy = index < 2 ? -1 : 1;
      put(corner, 'transform', `translate3d(${(sx * 14 * slide).toFixed(2)}px,${(sy * 14 * slide).toFixed(2)}px,0)`);
    });
  });
  return (
    <div ref={root} className="mr-hud" aria-hidden="true">
      <span data-a="corner" className="mr-hud-c mr-hud-c--tl" />
      <span data-a="corner" className="mr-hud-c mr-hud-c--tr" />
      <span data-a="corner" className="mr-hud-c mr-hud-c--bl" />
      <span data-a="corner" className="mr-hud-c mr-hud-c--br" />
      <span className="mr-hud-t mr-hud-t--tl">MELDY</span>
      <span data-a="label" className="mr-hud-t mr-hud-t--tr" />
      <span data-a="time" className="mr-hud-t mr-hud-t--bl" />
      <span className="mr-hud-t mr-hud-t--br">
        {CHAPTERS.map((chapter) => (
          <i key={chapter.id} data-a="dot" className="mr-hud-dot" />
        ))}
      </span>
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
