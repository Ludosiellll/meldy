/**
 * The phone's own view of the arena in 3D (docs/live/KIT_3D.md, MODE_STAND.md §8–§9): the same KayKit kit as the
 * projector, with a camera that follows the own character close and tilted, the others around it, the answers on
 * the floor's banners, the boss's stomp and the floor dropping, the own fall and the ghost.
 *
 * Phones are weak, so the scene starts lighter than the projector's: pixel ratio at most 1.25, outlines off (quality
 * level 1 at best), and our own governor steps the kit down when frames run late. When even the cheapest level runs
 * late for a few seconds, `slow` turns true and the screen switches to the light top-down view (sprites.ts).
 *
 * Nothing here makes React render. `frame()` is called by the view's own loop (one requestAnimationFrame for the
 * whole screen): positions go straight into the kit's instance buffers.
 */
import type { Arena, Boss, BossKind, Kit, MoveMap, Player, View } from '../../../../lib/live/three';
import { loadKit, toPlayerLook } from '../../../../lib/live/three';
import { QUALITY_LEVELS, QualityGovernor } from '../../../../lib/live/three/quality';
import type { Pose as Sample } from '../../../../lib/live/move/interp';
import { F_AWAY, isGhost, kindOf, KIND_PLAYER, type RosterEntry, type StandState } from '../../../../lib/live/move/protocol';
import type { MapJson } from '../../../../lib/live/move/sim';
import type { Backdrop, FrameInput } from './sprites';

/** The best quality level a phone draws at: no outlines (QUALITY_LEVELS[1]). */
export const PHONE_BEST_LEVEL = 1;
export const PHONE_PIXEL_RATIO = 1.25;
/** Seconds at the cheapest level, still late, before the light view takes over. */
const SLOW_AFTER_S = 4;
/** The camera: how far behind and above the own character, map units (the floor is 1600 × 900). */
const CAM_BACK = 760;
const CAM_UP = 1080;
const CAM_AHEAD = 110;
const CAM_FOV = 54;
/** A character this fast (map units/s) runs; slower, it stands. */
const RUN_SPEED = 25;

interface Tracked {
  player: Player;
  x: number;
  y: number;
  seen: number;
  /** Kit seconds until which this character plays its fall (the floor dropped under it). */
  fallUntil: number;
}

export class PhoneScene implements Backdrop {
  private view: View | null = null;
  private arena: Arena | null = null;
  private boss: Boss | null = null;
  private readonly tracked = new Map<number, Tracked>();
  private frameNo = 0;
  private readonly governor = new QualityGovernor({ budgetMs: 1000 / 60 });
  private level = PHONE_BEST_LEVEL;
  private lateS = 0;
  private cam = { x: 800, y: 520, ready: false };
  private labels = '';
  private phase: StandState['phase'] | null = null;
  private floor: 'up' | 'down' = 'up';
  private qi = -1;
  private alarm = false;
  /** The cheapest level could not keep up: the light view takes over. */
  slow = false;

  private constructor(
    private readonly kit: Kit,
    private readonly bossKind: BossKind,
  ) {
    this.governor.force(PHONE_BEST_LEVEL);
  }

  /** Fetches three.js, the models and the boss (cached for a year): call it in the lobby. */
  static async load(boss: BossKind): Promise<PhoneScene> {
    const kit = await loadKit({ boss });
    return new PhoneScene(kit, boss);
  }

  /** Puts the scene on a canvas; false when this phone cannot draw it (no WebGL 2). */
  mount(canvas: HTMLCanvasElement): boolean {
    try {
      const dense = (window.devicePixelRatio || 1) >= 2;
      this.view = this.kit.mount(canvas, { maxPixelRatio: PHONE_PIXEL_RATIO, quality: PHONE_BEST_LEVEL, antialias: !dense, tagScale: 1.4, tagHeight: 2.3 });
      return true;
    } catch {
      this.view = null;
      return false;
    }
  }

  /** The room's map (the welcome's): the floor, its zones and the boss. Once. */
  setMap(map: MapJson): void {
    if (this.arena) return;
    // The stand arena's zones are rectangles (MODE_STAND §3), the kit's MoveMap shape.
    this.arena = this.kit.createArena(map as unknown as MoveMap);
    this.boss = this.kit.createBoss(this.bossKind);
    this.placeCamera(800, 520, true);
  }

  get ready(): boolean {
    return !!this.view && !!this.arena;
  }

  /** Compiles the shaders and uploads the textures before the first question (no stall when it starts). */
  async warmUp(): Promise<void> {
    if (!this.view) return;
    await this.view.warmUp();
  }

  start(onFrame: (dt: number) => void): void {
    this.view?.start((dt) => onFrame(dt));
  }

  stop(): void {
    this.view?.stop();
  }

  /** The answers on the floor's banners, by zone (zone index = option index); closed zones show their letter only. */
  setOptions(options: readonly string[] | null): void {
    const arena = this.arena;
    if (!arena) return;
    const key = options ? options.join('\u0001') : '';
    if (key === this.labels) return;
    this.labels = key;
    const labels: Record<string, string> = {};
    (arena.map.zones ?? []).forEach((z, i) => {
      labels[z.id] = options?.[i] ?? '';
    });
    arena.setZoneLabels(labels);
  }

  /** The room's state: the stomp and the drop at the reveal, the floor's return, the alarm's last seconds. */
  setState(st: StandState, nowRoom: number | null): void {
    const arena = this.arena;
    const boss = this.boss;
    if (!arena || !boss) return;
    const fresh = st.res && nowRoom !== null && nowRoom - st.res.at < 1200;
    if (st.phase === 'reveal' && st.res && (this.phase !== 'reveal' || this.qi !== st.qi) && st.floor === 'down') {
      const zone = (arena.map.zones ?? [])[st.res.key];
      if (fresh) {
        boss.setPhase('stomp');
        arena.collapse(zone?.id ?? '', this.kit.now() + boss.stompImpactS);
        const until = this.kit.now() + boss.stompImpactS + 1.3;
        for (const id of st.res.fell) {
          const t = this.tracked.get(id);
          if (t) t.fallUntil = until;
        }
        this.myFallUntil = st.res.fell.includes(this.you ?? -1) ? until : 0;
      } else {
        // A state seen after a reconnect: drawn as it is now, no stomp.
        arena.collapse(zone?.id ?? '', this.kit.now() - 5);
      }
    }
    if (st.floor === 'up' && this.floor === 'down') arena.restore();
    if (st.phase !== 'reveal' && this.phase === 'reveal' && st.floor === 'up' && this.floor !== 'up') arena.restore();
    this.floor = st.floor;
    this.phase = st.phase;
    this.qi = st.qi;
    if (st.phase !== 'open' && this.alarm) {
      this.alarm = false;
      if (boss.phase === 'warn') boss.setPhase('idle');
    }
  }

  /** The last seconds before the stomp: the boss rings and glows. */
  setAlarm(on: boolean): void {
    if (on === this.alarm || !this.boss) return;
    this.alarm = on;
    this.boss.setPhase(on ? 'warn' : 'idle');
  }

  private you: number | null = null;
  private me: Tracked | null = null;
  private myFallUntil = 0;

  /** One frame: everyone's position, pose and ghost, the camera on the own character, the quality. */
  frame(dt: number, input: FrameInput): void {
    const arena = this.arena;
    if (!arena) return;
    this.frameNo++;
    const now = this.kit.now();
    const f = this.frameNo;
    if (input.others) {
      for (const [id, p] of input.others) {
        if (kindOf(p.flags) !== KIND_PLAYER) continue;
        let t = this.tracked.get(id);
        if (!t) {
          const entry = input.roster.get(id);
          t = { player: this.kit.createPlayer(toPlayerLook(entry?.[4]), ''), x: p.x, y: p.y, seen: f, fallUntil: 0 };
          t.player.setPosition(p.x, p.y);
          this.tracked.set(id, t);
        }
        this.move(t, p.x, p.y, p.flags, dt, now, arena);
        t.seen = f;
      }
    }
    if (input.me) {
      if (!this.me || this.you !== input.me.id) {
        this.me?.player.dispose();
        const entry = input.roster.get(input.me.id);
        this.me = { player: this.kit.createPlayer(toPlayerLook(entry?.[4]), 'Вы'), x: input.me.x, y: input.me.y, seen: f, fallUntil: 0 };
        this.you = input.me.id;
        this.placeCamera(input.me.x, input.me.y, true);
      }
      this.me.fallUntil = this.myFallUntil;
      this.move(this.me, input.me.x, input.me.y, input.me.flags, dt, now, arena);
      this.placeCamera(input.me.x, input.me.y, false, dt);
    }
    // Characters gone from the room (a kicked player).
    if (f % 30 === 0) {
      for (const [id, t] of this.tracked) {
        if (t.seen < f - 30) {
          t.player.dispose();
          this.tracked.delete(id);
        }
      }
    }
    this.govern(dt);
  }

  private move(t: Tracked, x: number, y: number, flags: number, dt: number, now: number, arena: Arena): void {
    const dx = x - t.x;
    const dy = y - t.y;
    const speed = dt > 0 ? Math.hypot(dx, dy) / dt : 0;
    t.x = x;
    t.y = y;
    const p = t.player;
    if (now < t.fallUntil) {
      p.setGhost(false);
      p.setPose('fall');
      p.setPosition(x, y, Math.min(0, arena.floorAt(x, y)));
      return;
    }
    p.setGhost(isGhost(flags) || (flags & F_AWAY) !== 0);
    p.setPose(speed > RUN_SPEED ? 'run' : 'idle');
    if (speed > RUN_SPEED) p.setFacing(Math.atan2(dx, dy));
    p.setPosition(x, y, isGhost(flags) ? 0 : Math.min(0, arena.floorAt(x, y)));
  }

  private placeCamera(x: number, y: number, snap: boolean, dt = 0): void {
    if (!this.view) return;
    const k = snap || !this.cam.ready ? 1 : 1 - Math.exp(-dt * 7);
    // On an answer zone the camera leans halfway to the zone's centre: its banner stays readable on a narrow phone,
    // the own character stays in the picture.
    const zone = this.arena?.map.zones?.find((z) => x >= z.rect[0] && x <= z.rect[0] + z.rect[2] && y >= z.rect[1] && y <= z.rect[1] + z.rect[3]);
    const cx = zone ? (x + zone.rect[0] + zone.rect[2] / 2) / 2 : x;
    this.cam.x += (cx - this.cam.x) * k;
    this.cam.y += (y - this.cam.y) * k;
    this.cam.ready = true;
    this.view.setCamera({
      eye: { x: this.cam.x, y: this.cam.y + CAM_BACK, z: CAM_UP },
      target: { x: this.cam.x, y: this.cam.y - CAM_AHEAD, z: 0 },
      fov: CAM_FOV,
    });
  }

  /** Our own governor (the kit's would go back to outlines): level 1 at best, down when late, «slow» at the bottom. */
  private govern(dt: number): void {
    const view = this.view;
    if (!view || dt <= 0) return;
    if (this.governor.push(dt * 1000)) {
      const level = Math.max(PHONE_BEST_LEVEL, this.governor.level);
      if (level !== this.level) {
        this.level = level;
        view.setQuality(level);
      }
    }
    const cheapest = this.level >= QUALITY_LEVELS.length - 1;
    if (cheapest && this.governor.mean > (1000 / 60) * 1.3) this.lateS += dt;
    else this.lateS = 0;
    if (this.lateS > SLOW_AFTER_S) this.slow = true;
  }

  stats() {
    return this.view?.stats() ?? null;
  }

  dispose(): void {
    this.kit.dispose();
    this.tracked.clear();
    this.view = null;
    this.arena = null;
    this.boss = null;
  }
}
