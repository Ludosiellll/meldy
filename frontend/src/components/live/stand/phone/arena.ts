/**
 * The phone's arena behind a question (docs/live/KIT_3D.md, MODE_STAND.md §8): the 3D scene, loaded and warmed up
 * while the player waits (the lobby) and drawn lighter on a weak phone (scene3d.ts, quality.ts), or the flat view.
 * Shared by «Встань на ответ» (StandGame) and a battle's movement rounds (MixedPhone): the canvases stay mounted for
 * the whole game, so the models are loaded once.
 *
 * The flat view plays while the 3D is not in: on a phone without WebGL 2 for good, else while it loads or between
 * tries after a failure (arenaLoader.ts). The 3D comes in once it is ready, between questions. Why the 3D is not
 * drawing is on the 3D canvas (`data-view3d`, `data-why`) and in the console (`live: phone 3D …`).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { readStore } from '../../player/platform';
import { mapFromJson } from '../../../../lib/live/move/sim';
import { ArenaLoader, type Arena3dTrace } from './arenaLoader';
import { PhoneScene } from './scene3d';
import { SpriteView, type Backdrop } from './sprites';
import type { StandSession, StandView } from './session';

/**
 * A device can pin the arena's view (QA on a real phone, a recording): localStorage `meldy.live.view` = `3d` (the best
 * 3D level, never lowered), `light` (the cheapest 3D level: lower resolution, 30 frames a second) or `2d` (the flat
 * view of a phone without WebGL). Unset: 3D, lowered step by step while frames run late; flat only without WebGL.
 */
export const VIEW_KEY = 'meldy.live.view';

/** What draws the arena, for a live check: the 3D (`on`), or the flat view and why (arenaLoader.ts). */
export type Arena3dView = 'on' | Arena3dTrace['state'];

export interface PhoneArena {
  /** The 3D canvas: its ref and its React key (a new element for a try after one that held a scene). */
  canvasRef: (canvas: HTMLCanvasElement | null) => void;
  canvasKey: number;
  spritesRef: React.RefObject<HTMLCanvasElement>;
  scene: PhoneScene | null;
  sprites: SpriteView | null;
  /** The flat view plays (no 3D on this phone, or the 3D is not in yet). */
  flat: boolean;
  /** What draws the arena now: the 3D scene or the flat view (null until one is ready). */
  backdrop: Backdrop | null;
  /** `on` while the 3D draws; else loading, retry (between tries), ready (comes in between questions) or off. */
  view3d: Arena3dView;
  /** Why the 3D is not drawing: no WebGL 2, the device's pin, the last failed try. Null when nothing went wrong. */
  why: string | null;
}

const PINNED_FLAT = 'the device pinned the flat view (meldy.live.view = 2d)';

/**
 * `showing`: the arena is on the screen now (a question's countdown, time or reveal). The 3D that gets ready then
 * comes in after the question: the player who started on the flat view keeps it until the question ends.
 */
export function usePhoneArena(session: StandSession, v: StandView, showing: boolean): PhoneArena {
  const [pinned] = useState(() => readStore('local', VIEW_KEY));
  const [webgl2] = useState(() => typeof WebGL2RenderingContext !== 'undefined');
  const off = pinned === '2d' ? PINNED_FLAT : !webgl2 ? 'no WebGL 2' : null;
  const bossKind = v.hello?.boss ?? null;
  const roomMap = v.ready ? (session.client.welcome?.map ?? null) : null;
  // A reconnect brings a new welcome with the same map: the arena stays as it is (it used to be built anew on the
  // same canvas, whose context the old scene had lost, and the phone went flat for the rest of the game).
  const mapKey = useMemo(() => (roomMap ? JSON.stringify(roomMap) : null), [roomMap]);
  const mapRef = useRef(roomMap);
  mapRef.current = roomMap;
  // the hello's floor grid and stage: the 3D floor is the server's, the boss on the stage in the middle
  const helloRef = useRef(v.hello);
  helloRef.current = v.hello;

  const canvasEl = useRef<HTMLCanvasElement | null>(null);
  const loaderRef = useRef<ArenaLoader<PhoneScene> | null>(null);
  const [canvasKey, setCanvasKey] = useState(0);
  const canvasRef = useCallback((canvas: HTMLCanvasElement | null) => {
    canvasEl.current = canvas;
    if (canvas) loaderRef.current?.canvasChanged();
  }, []);
  /** Warmed up, waiting for a moment between questions. */
  const [ready, setReady] = useState<PhoneScene | null>(null);
  /** Drawing the arena. */
  const [scene, setScene] = useState<PhoneScene | null>(null);
  const [trace, setTrace] = useState<Arena3dTrace>({ state: 'loading', tries: 0, why: null });

  useEffect(() => {
    if (!bossKind || !mapKey || off) return undefined;
    const map = mapRef.current!;
    const loader = new ArenaLoader<PhoneScene>({
      load: () => PhoneScene.load(bossKind, pinned === '3d' || pinned === 'light' ? pinned : 'auto'),
      canvas: () => canvasEl.current,
      renewCanvas: () => setCanvasKey((k) => k + 1),
      prepare: (sc) => {
        const hello = helloRef.current;
        sc.setMap(map, hello ? { floor: hello.floor, stage: hello.stage } : undefined);
      },
      onReady: setReady,
      onTrace: setTrace,
    });
    loaderRef.current = loader;
    loader.start();
    return () => {
      loader.stop();
      if (loaderRef.current === loader) loaderRef.current = null;
      setReady(null);
      setScene(null);
    };
  }, [bossKind, mapKey, pinned, off]);

  // the 3D comes in between questions (in the lobby at once)
  useEffect(() => {
    if (!ready || showing || scene === ready) return;
    setScene(ready);
    console.info('live: phone 3D on');
  }, [ready, showing, scene]);

  // no 3D on this phone at all: said once, when the arena is first needed
  const told = useRef(false);
  useEffect(() => {
    if (!off || !mapKey || told.current) return;
    told.current = true;
    console.warn(`live: phone 3D off (${off}): the flat view plays`);
  }, [off, mapKey]);

  // The flat view: while the 3D is not drawing (none on this phone, or not in yet).
  const flat = !scene;
  const [sprites, setSprites] = useState<SpriteView | null>(null);
  const spritesRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = spritesRef.current;
    const map = mapRef.current;
    if (!flat || !mapKey || !map || !canvas) return undefined;
    const view = new SpriteView(canvas, mapFromJson(map));
    setSprites(view);
    return () => {
      view.dispose();
      setSprites(null);
    };
  }, [flat, mapKey]);

  const view3d: Arena3dView = off ? 'off' : scene ? 'on' : trace.state;
  const why = off ?? (scene ? null : trace.why);
  return { canvasRef, canvasKey, spritesRef, scene, sprites, flat, backdrop: flat ? sprites : scene, view3d, why };
}
