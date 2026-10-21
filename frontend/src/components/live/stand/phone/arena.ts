/**
 * The phone's arena behind a question (docs/live/KIT_3D.md, MODE_STAND.md §8): the 3D scene, loaded and warmed up
 * while the player waits (the lobby), or the light view on a phone without WebGL 2 or too slow for 3D even at the
 * cheapest level. Shared by «Встань на ответ» (StandGame) and a battle's movement rounds (MixedPhone): the canvases
 * stay mounted for the whole game, so the models are loaded once.
 */
import { useEffect, useRef, useState } from 'react';
import { readStore } from '../../player/platform';
import { mapFromJson } from '../../../../lib/live/move/sim';
import { PhoneScene } from './scene3d';
import { SpriteView, type Backdrop } from './sprites';
import type { StandSession, StandView } from './session';

/**
 * A device can pin the arena's view (QA on a real phone, a recording): localStorage `meldy.live.view` = `3d` (never
 * the light view) or `light` (never 3D). Unset: 3D when the phone can, the light view when it cannot keep up.
 */
export const VIEW_KEY = 'meldy.live.view';

export interface PhoneArena {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  spritesRef: React.RefObject<HTMLCanvasElement>;
  scene: PhoneScene | null;
  sprites: SpriteView | null;
  /** The light view plays (no 3D here, or too slow). */
  light: boolean;
  /** What draws the arena now: the 3D scene or the light view (null until one is ready). */
  backdrop: Backdrop | null;
}

export function usePhoneArena(session: StandSession, v: StandView): PhoneArena {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scene, setScene] = useState<PhoneScene | null>(null);
  const [slow, setSlow] = useState(false);
  const [pinned] = useState(() => readStore('local', VIEW_KEY));
  /** No 3D here at all (no WebGL 2, the models did not come, or the device pinned the light view). */
  const [no3d, setNo3d] = useState(pinned === 'light');
  const spritesRef = useRef<HTMLCanvasElement>(null);
  const [sprites, setSprites] = useState<SpriteView | null>(null);
  const bossKind = v.hello?.boss ?? null;
  const roomMap = v.ready ? (session.client.welcome?.map ?? null) : null;
  // the hello's floor grid and stage: the 3D floor is the server's, the boss on the stage in the middle
  const helloRef = useRef(v.hello);
  helloRef.current = v.hello;
  useEffect(() => {
    if (!bossKind || !roomMap || pinned === 'light') return undefined;
    if (typeof WebGL2RenderingContext === 'undefined') {
      setNo3d(true);
      return undefined;
    }
    let alive = true;
    let made: PhoneScene | null = null;
    PhoneScene.load(bossKind)
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
        // No 3D on this phone (no WebGL 2, the models did not come): the light view plays.
        if (alive) setNo3d(true);
      });
    return () => {
      alive = false;
      made?.dispose();
      setScene(null);
    };
  }, [bossKind, roomMap, pinned]);
  // The light view: on a phone with no 3D, or one too slow for it even at the cheapest level.
  const light = slow || no3d;
  useEffect(() => {
    const canvas = spritesRef.current;
    if (!light || !roomMap || !canvas) return undefined;
    const view = new SpriteView(canvas, mapFromJson(roomMap));
    setSprites(view);
    return () => {
      view.dispose();
      setSprites(null);
    };
  }, [light, roomMap]);
  useEffect(() => {
    if (!scene || slow || pinned === '3d') return undefined;
    const t = setInterval(() => {
      if (scene.slow) setSlow(true);
    }, 1000);
    return () => clearInterval(t);
  }, [scene, slow, pinned]);
  return { canvasRef, spritesRef, scene, sprites, light, backdrop: light ? sprites : scene };
}
