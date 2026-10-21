/**
 * The public shapes of the 3D kit (docs/live/KIT_3D.md). Types only: importing them costs nothing at run time.
 * Units are the server's map units (docs/live/MOVE.md: 1600 × 900, +y down the map) and seconds.
 */
import type { ArenaShape, MoveMap } from './arenaPlan';
import type { PlayerLook } from './look';
import type { Pose } from './pose';

export type BossKind = 'skeleton' | 'clock';
export type BossPhase = 'idle' | 'warn' | 'stomp' | 'roar' | 'stunned' | 'chase';

export interface Player {
  readonly look: PlayerLook;
  readonly name: string;
  /** The pose being shown (a `once` pose returns to the last looping one by itself). */
  readonly pose: Pose;
  /**
   * idle, run, cheer, fall, wave loop; jump and hit play once and return to the last looping pose asked for
   * (asking for run every frame during a hit does not cut it short); lie plays once and stays down. Asking for the
   * pose already shown changes nothing.
   */
  setPose(pose: Pose): void;
  /** A see-through blue ghost that floats; its name tag fades. */
  setGhost(on: boolean): void;
  /**
   * The player's phone is away (the room's F_AWAY): the name tag fades as a ghost's does. The body is drawn as usual: a
   * see-through body for one player would need a sorted transparent pass of its own.
   */
  setAway(on: boolean): void;
  /**
   * The battle's freeze (a mixed game's movement round, docs/live/MODE_MIXED.md): a block of ice grows round the
   * character; off, it breaks into chips. `instant` shows it as it is now (a state seen late), with no growing or
   * breaking. Hidden while the character is a ghost or falls.
   */
  setIce(on: boolean, instant?: boolean): void;
  /** Map angle: 0 faces +y (down the map, towards the viewer), π/2 faces +x. Turns smoothly unless `instant`. */
  setFacing(rad: number, instant?: boolean): void;
  /** Map units; `z` is the height over the floor (negative while falling: see Arena.floorAt). */
  setPosition(x: number, y: number, z?: number): void;
  /** Advances the pose and the turn. The kit does it each frame for you; calling it yourself first is also fine. */
  update(dt: number): void;
  dispose(): void;
}

export interface Boss {
  readonly kind: BossKind;
  readonly phase: BossPhase;
  /** Seconds from setPhase('stomp') to the blow on the floor: start the collapse at kit.now() + this. */
  readonly stompImpactS: number;
  /**
   * idle; warn (rings, glows, threatens); stomp (jumps and hits the floor once, then idle by itself); roar;
   * stunned (the skeleton falls apart and gets up again when the phase changes; the clock reels); chase (runs).
   */
  setPhase(phase: BossPhase): void;
  /** Map units. Default: its stage (Arena.stage). */
  setPosition(x: number, y: number): void;
  setFacing(rad: number): void;
  update(dt: number): void;
  dispose(): void;
}

export interface Arena {
  readonly map: MoveMap;
  /** Where the boss stands, map units (the shape's stage; without one y < 0: beyond the far edge). */
  readonly stage: { x: number; y: number };
  /** The answer shown next to each zone's letter, by zone id (A → «А»); missing ids show the letter only. */
  setZoneLabels(labels: Partial<Record<string, string>>): void;
  /** Zones that take no answer now (a question with fewer options): their tiles go plain and their sign hides. */
  setClosedZones(ids: readonly string[]): void;
  /**
   * Drops every tile outside the zone `correctZoneId`, in a ripple from under the stage starting at `tStart`
   * (seconds of kit.now(); default now). The shock ring and the camera's jolt come at `tStart`.
   */
  collapse(correctZoneId: string, tStart?: number): void;
  /** Brings the fallen tiles back up (a quick ripple). */
  restore(): void;
  /** Height of the floor at a map point now, map units: 0 intact, negative while its tile falls. */
  floorAt(x: number, y: number): number;
  /** kit.now() second the tile under the point starts to drop; Infinity if it stays. */
  fallsAt(x: number, y: number): number;
  update(dt: number): void;
  dispose(): void;
}

export interface ViewOptions {
  /** Cap on the pixel ratio (default 1.5). */
  maxPixelRatio?: number;
  /** 'auto' (default) or a pinned level 0…5 (0 best). */
  quality?: 'auto' | number;
  /** A clear background (the thumbnails). */
  transparent?: boolean;
  antialias?: boolean;
  /** Name tag size: 1 = 34 px tall on a 1080-high screen. */
  tagScale?: number;
  /** Leave out name tags that would overlap others in a crowd (default true): no tag is ever cut by another. */
  tagDeclutter?: boolean;
  /** How high over the feet the name tags sit, metres (default 2.95; a close phone camera wants them lower). */
  tagHeight?: number;
  /** Keep the picture after drawing (screenshots only: it costs speed). */
  preserveDrawingBuffer?: boolean;
}

export interface CameraSpec {
  /** Frames the whole arena of this map in the 3/4 view; margins keep a share of the screen free (0…0.5). */
  arena?: MoveMap;
  margins?: { top?: number; bottom?: number; left?: number; right?: number };
  /** With `arena`: how steeply the camera looks down, degrees over the floor (default 27; 90 is straight down). */
  tilt?: number;
  /** Map units; z is the height. */
  eye?: { x: number; y: number; z: number };
  target?: { x: number; y: number; z: number };
  fov?: number;
}

export interface FrameStats {
  frames: number;
  fps: number;
  /** Time between frames (what the eye sees), ms. */
  frameMs: { mean: number; p95: number };
  /** JavaScript time of a frame: your callback, the kit's update, handing the draw calls to the GPU. */
  cpuMs: { mean: number; p95: number };
  drawCalls: number;
  triangles: number;
  /** Quality level now (0 best). */
  quality: number;
  pixelRatio: number;
  width: number;
  height: number;
  players: number;
}

export interface View {
  readonly canvas: HTMLCanvasElement;
  /** Runs the frame loop; `onFrame(dt, now)` runs first in each frame. Pauses by itself while the tab is hidden. */
  start(onFrame?: (dt: number, now: number) => void): void;
  stop(): void;
  setCamera(spec: CameraSpec): void;
  /** A short jolt of the camera. collapse() does it at the impact already. */
  shake(strength?: number): void;
  /** Compiles every shader and uploads every texture: call before the round so the first frames do not stall. */
  warmUp(): Promise<void>;
  /** 'auto' (default): drops outlines, then effects, then resolution when frames run late. */
  setQuality(level: 'auto' | number): void;
  stats(): FrameStats;
  resize(): void;
  dispose(): void;
}

export interface BossOptions {
  /** Height in metres (50 map units each). Default: skeleton 6, clock 6.6. */
  height?: number;
}

export interface LoadOptions {
  /** Load the skeleton boss's model too (the clock needs no file). */
  boss?: BossKind;
}

export interface Kit {
  createPlayer(look: PlayerLook, name: string): Player;
  /** The skeleton needs loadKit({ boss: 'skeleton' }) or kit.loadBoss('skeleton') first. */
  createBoss(kind: BossKind, options?: BossOptions): Boss;
  loadBoss(kind: BossKind): Promise<void>;
  /** The server's map; `shape` (mode A: the hello's floor and stage) lays the tiles on its grid and the stage in it. */
  createArena(map: MoveMap, shape?: ArenaShape): Arena;
  /** Draws the kit's scene on a canvas. One view per kit. */
  mount(canvas: HTMLCanvasElement, options?: ViewOptions): View;
  /** Seconds since the kit was made, advanced by update (the view's loop does it). */
  now(): number;
  /** Advances everything by dt seconds; the view's loop calls it. */
  update(dt: number): void;
  /** Frees every GPU resource and the view. */
  dispose(): void;
}
