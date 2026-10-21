/**
 * The phone's arena behind a question (docs/live/KIT_3D.md, MODE_STAND.md §8): the 3D scene, loaded and warmed up
 * while the player waits (the lobby) and drawn lighter on a weak phone (scene3d.ts, quality.ts), or the flat view on
 * a phone without WebGL 2. Shared by «Встань на ответ» (StandGame) and a battle's movement rounds (MixedPhone): the canvases
 * stay mounted for the whole game, so the models are loaded once.
 */
import { useEffect, useRef, useState } from 'react';
import { readStore } from '../../player/platform';
import { mapFromJson } from '../../../../lib/live/move/sim';
import { PhoneScene } from './scene3d';
import { SpriteView, type Backdrop } from './sprites';
import type { StandSession, StandView } from './session';

/**
 * A device can pin the arena's view (QA on a real phone, a recording): localStorage `meldy.live.view` = `3d` (the best
 * 3D level, never lowered), `light` (the cheapest 3D level: lower resolution, 30 frames a second) or `2d` (the flat
 * view of a phone without WebGL). Unset: 3D, lowered step by step while frames run late; flat only without WebGL.
 */
export const VIEW_KEY = 'meldy.live.view';

export interface PhoneArena {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  spritesRef: React.RefObject<HTMLCanvasElement>;
  scene: PhoneScene | null;
  sprites: SpriteView | null;
  /** The flat view plays (no 3D on this phone at all). */
  flat: boolean;
  /** What draws the arena now: the 3D scene or the light view (null until one is ready). */
  backdrop: Backdrop | null;
}

export function usePhoneArena(session: StandSession, v: StandView): PhoneArena {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scene, setScene] = useState<PhoneScene | null>(null);
  const [pinned] = useState(() => readStore('local', VIEW_KEY));
  /** No 3D here at all (no WebGL 2, the models did not come, or the device pinned the flat view). */
  const [no3d, setNo3d] = useState(pinned === '2d');
  const spritesRef = useRef<HTMLCanvasElement>(null);
  const [sprites, setSprites] = useState<SpriteView | null>(null);
  const bossKind = v.hello?.boss ?? null;
  const roomMap = v.ready ? (session.client.welcome?.map ?? null) : null;
  // the hello's floor grid and stage: the 3D floor is the server's, the boss on the stage in the middle
  const helloRef = useRef(v.hello);
  helloRef.current = v.hello;
  useEffect(() => {
    if (!bossKind || !roomMap || pinned === '2d') return undefined;
    if (typeof WebGL2RenderingContext === 'undefined') {
      setNo3d(true);
      return undefined;
    }
    let alive = true;
    let made: PhoneScene | null = null;
    PhoneScene.load(bossKind, pinned === '3d' || pinned === 'light' ? pinned : 'auto')
      .then(async (sc) => {
        made = sc;
        const canvas = canvasRef.current;
        if (!alive || !canvas || !sc.mount(canvas)) {
          sc.dispose();
          made = null;
          if (alive) setNo3d(true);
          return;
        }
        const hello = helloRef.current;
        sc.setMap(roomMap, hello ? { floor: hello.floor, stage: hello.stage } : undefined);
        await sc.warmUp();
        if (alive) setScene(sc);
      })
      .catch(() => {
        // No 3D on this phone (no WebGL 2, the models did not come): the flat view plays.
        if (alive) setNo3d(true);
      });
    return () => {
      alive = false;
      made?.dispose();
      setScene(null);
    };
  }, [bossKind, roomMap, pinned]);
  // The flat view: only on a phone with no 3D at all.
  const flat = no3d;
  useEffect(() => {
    const canvas = spritesRef.current;
    if (!flat || !roomMap || !canvas) return undefined;
    const view = new SpriteView(canvas, mapFromJson(roomMap));
    setSprites(view);
    return () => {
      view.dispose();
      setSprites(null);
    };
  }, [flat, roomMap]);
  return { canvasRef, spritesRef, scene, sprites, flat, backdrop: flat ? sprites : scene };
}
