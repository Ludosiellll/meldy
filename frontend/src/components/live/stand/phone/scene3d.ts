/**
 * The phone's view of the arena in 3D (docs/live/KIT_3D.md, MODE_STAND.md §8–§9): the projector's game on a phone.
 * The same kit, the same floor and zone colours, the same signs (smaller), the same heroes, the boss on its stage, the
 * floor dropping, the ghosts; the camera is the projector's 3/4 view from the front, closer, following the own hero
 * (camera.ts). The own hero wears «Вы» and a white ring.
 *
 * Phones are weak, so the scene draws lighter than the projector: no outlines, at most 1.25 pixels a point, simpler
 * tiles; its own governor (quality.ts) lowers the resolution and at last the frame rate when frames run late. It never
 * leaves 3D for being slow: only a phone without WebGL plays the flat view (sprites.ts).
 *
 * Nothing here makes React render. `frame()` is called by the view's own loop (one requestAnimationFrame for the
 * whole screen): positions go straight into the kit's instance buffers.
 */
import type { Arena, ArenaShape, Boss, BossKind, Kit, MoveMap, Player, View } from '../../../../lib/live/three';
import { STAGE_BOSS_HEIGHT, loadKit, toPlayerLook } from '../../../../lib/live/three';
import { F_AWAY, isGhost, isIced, kindOf, KIND_NPC, KIND_PLAYER, resKeys, type StandState } from '../../../../lib/live/move/protocol';
import type { MapJson } from '../../../../lib/live/move/sim';
import { easeOutBack } from '../plan';
import { DEFAULT_TOPS, FollowCam, type Screen } from './camera';
import { LIGHT_LEVEL, PHONE_LEVELS, PHONE_PIXEL_RATIO, PhoneGovernor } from './quality';
import type { Backdrop, FrameInput } from './sprites';
import { BossCopies } from '../bossCopies';

export { PHONE_PIXEL_RATIO };
/** How the phone pins its view (StandGame: localStorage `meldy.live.view`): auto, the best level, the light level. */
export type PhonePin = 'auto' | '3d' | 'light';
/** The signs against the projector's: they read on a phone and leave the floor to the heroes. */
const SIGN_SCALE = 0.7;
/** Mode B: the other hunters are this much of the boss's height; the boss runs back to its stage this fast. */
const HUNTER_SCALE = 0.62;
const BOSS_HOME_SPEED = 700;
/** A character this fast (map units/s) runs; slower, it stands. */
const RUN_SPEED = 25;
/** Seconds the camera keeps leaning to the boss after its blow. */
const LEAN_AFTER_S = 1.8;
/** As on the projector (stand/scene.ts): a fallen character drops this long, then rises as a ghost this long. */
const FALL_S = 0.75;
const RISE_S = 1.0;

interface Tracked {
  player: Player;
  x: number;
  y: number;
  seen: number;
  /**
   * The floor dropped under it (kit seconds): it stands where it stood until its tile goes (`fallAt`), drops with it,
   * and rises out of the pit as a ghost from `riseAt`, as on the projector. Infinity: not falling.
   */
  fallAt: number;
  riseAt: number;
  fx: number;
  fy: number;
  /** The battle's ice drawn now (a mixed game's F_ICE; it forms only in sight, so the fallen get it when back). */
  iced: boolean;
  /** Not drawn yet: its ice is shown as it is, without growing. */
  fresh: boolean;
}

function tracked(player: Player, x: number, y: number, seen: number): Tracked {
  return { player, x, y, seen, fallAt: Infinity, riseAt: Infinity, fx: x, fy: y, iced: false, fresh: true };
}

export class PhoneScene implements Backdrop {
  private view: View | null = null;
  private arena: Arena | null = null;
  private boss: Boss | null = null;
  private cam: FollowCam | null = null;
  private readonly tracked = new Map<number, Tracked>();
  private frameNo = 0;
  private readonly governor: PhoneGovernor;
  private level: number;
  private labels = '';
  private phase: StandState['phase'] | null = null;
  private floor: 'up' | 'down' = 'up';
  private qi = -1;
  private alarm = false;
  /** Kit seconds until which the camera leans to the boss (its blow). */
  private leanUntil = 0;
  /** The question whose stomp has begun, and the kit second of the boss's blow on the floor. */
  private stompedQi = -1;
  private impactAt = Infinity;
  /** The canvas's CSS size and the band the arena may use (StandPlay's setBand). */
  private readonly screen: Screen = { width: 390, height: 844, top: 200, bottom: 170 };
  private band: { top: number; bottom: number } | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private observer: ResizeObserver | null = null;
  private readonly onVisible = () => {
    if (!document.hidden) this.governor.begin();
  };
  /** Kept for callers of the old screen: the phone no longer leaves 3D for being slow (only without WebGL). */
  readonly slow = false;
  /** kit.now() of the loop's last start (a mixed game's arena coming back after the button questions). */
  private startedAt = -Infinity;

  private constructor(
    private readonly kit: Kit,
    private readonly bossKind: BossKind,
    pin: PhonePin,
  ) {
    this.level = pin === 'light' ? LIGHT_LEVEL : 0;
    this.governor = new PhoneGovernor(this.level, pin !== 'auto');
    this.copies = new BossCopies(() => this.kit, bossKind, STAGE_BOSS_HEIGHT[bossKind] * HUNTER_SCALE);
  }

  /**
   * Fetches three.js, the models and the boss (cached for a year): call it in the lobby. `pin`: '3d' draws at the
   * best level always (a recording, QA), 'light' at the cheapest, 'auto' (default) lets the frame times choose.
   */
  static async load(boss: BossKind, pin: PhonePin = 'auto'): Promise<PhoneScene> {
    const kit = await loadKit({ boss });
    return new PhoneScene(kit, boss, pin);
  }

  /** Puts the scene on a canvas; false when this phone cannot draw it (no WebGL 2). */
  mount(canvas: HTMLCanvasElement): boolean {
    try {
      const dense = (window.devicePixelRatio || 1) >= 2;
      const lv = PHONE_LEVELS[this.level];
      this.view = this.kit.mount(canvas, { maxPixelRatio: PHONE_PIXEL_RATIO, quality: lv.kit, maxFps: lv.fps, antialias: !dense, tagScale: 1.15, tagHeight: 2.55 });
    } catch {
      this.view = null;
      return false;
    }
    this.canvas = canvas;
    this.measure();
    this.observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.measure()) : null;
    this.observer?.observe(canvas);
    document.addEventListener('visibilitychange', this.onVisible);
    return true;
  }

  /**
   * The room's map (the welcome's) and the hello's floor grid and stage: the floor laid on the server's grid, the
   * boss on the stage in the middle, as on the projector (KIT_3D.md §4). Once.
   */
  setMap(map: MapJson, shape?: ArenaShape): void {
    if (this.arena) return;
    // The stand arena's zones are rectangles (MODE_STAND §3), the kit's MoveMap shape.
    this.arena = this.kit.createArena(map as unknown as MoveMap, shape, { signScale: SIGN_SCALE, tileSegments: 1 });
    this.boss = this.kit.createBoss(this.bossKind, shape?.stage ? { height: STAGE_BOSS_HEIGHT[this.bossKind] } : {});
    this.copies.prepare();
    const f = shape?.floor;
    const bounds = f ? { x0: f.x, y0: f.y, x1: f.x + f.cols * f.tile, y1: f.y + f.rows * f.tile } : { x0: 0, y0: 0, x1: map.w, y1: map.h };
    const bossTop = (STAGE_BOSS_HEIGHT[this.bossKind] + 0.4) * 50;
    const zones = (this.arena.map.zones ?? []).map(({ rect: [x, y, w, h] }) => ({ x0: x, y0: y, x1: x + w, y1: y + h }));
    this.cam = new FollowCam(bounds, { sign: DEFAULT_TOPS.sign, boss: bossTop }, this.arena.stage, zones);
    this.placeCamera(0, null);
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
    this.startedAt = this.kit.now();
    this.governor.begin();
    this.view?.start((dt) => onFrame(dt));
  }

  stop(): void {
    this.view?.stop();
  }

  /**
   * The part of the screen the arena may use, client px: below the question card (`top`, its bottom edge) and above
   * the stick and the small map (`bottom`, their top edge). The arena's whole depth is put in it.
   */
  setBand(top: number, bottom: number): void {
    if (this.band && this.band.top === top && this.band.bottom === bottom) return;
    this.band = { top, bottom };
    this.measure();
  }

  /** The canvas's size and where the band lies on it (read on a resize or a new band, never per frame). */
  private measure(): void {
    const c = this.canvas;
    if (!c) return;
    const r = c.getBoundingClientRect();
    const s = this.screen;
    s.width = Math.max(1, r.width || c.clientWidth || 390);
    s.height = Math.max(1, r.height || c.clientHeight || 844);
    if (this.band) {
      s.top = Math.max(0, this.band.top - r.top);
      s.bottom = Math.max(0, r.bottom - this.band.bottom);
    }
  }

  /** The answers on the zones' signs (zone index = option index); closed zones show their letter only. */
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
      const zones = resKeys(st.res).map((k) => (arena.map.zones ?? [])[k]?.id ?? '');
      if (fresh) {
        // the boss jumped at zero (setAlarm); a result here first starts the jump now. The floor goes at the blow.
        if (this.stompedQi !== st.qi) this.stomp(st.qi);
        const impact = Math.max(this.impactAt, this.kit.now() + 0.05);
        arena.collapse(zones, impact);
        for (const id of st.res.fell) {
          const t = id === this.you ? this.me : this.tracked.get(id);
          if (!t) continue;
          // its tile's own moment in the ripple; a tile that stays (a phone that went away): just after the blow
          const drops = arena.fallsAt(t.x, t.y);
          t.fallAt = Number.isFinite(drops) ? drops : impact + 0.35;
          t.riseAt = t.fallAt + FALL_S;
          t.fx = t.x;
          t.fy = t.y;
        }
        this.leanUntil = impact + LEAN_AFTER_S;
      } else {
        // A state seen after a reconnect: drawn as it is now, no stomp.
        arena.collapse(zones, this.kit.now() - 5);
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

  /**
   * The last seconds before the stomp: the boss rings and glows, the camera leans towards it. The alarm going off while
   * the question is still open is zero on the room's clock: the boss jumps then, as on the projector, and its blow
   * drops the floor as soon as the result is here.
   */
  setAlarm(on: boolean): void {
    const boss = this.boss;
    if (on === this.alarm || !boss) return;
    this.alarm = on;
    if (on) boss.setPhase('warn');
    else if (this.phase === 'open' && this.stompedQi !== this.qi) this.stomp(this.qi);
    else if (boss.phase === 'warn') boss.setPhase('idle');
  }

  private stomp(qi: number): void {
    const boss = this.boss;
    if (!boss) return;
    boss.setPhase('stomp');
    this.stompedQi = qi;
    this.impactAt = this.kit.now() + boss.stompImpactS;
    this.leanUntil = this.impactAt + LEAN_AFTER_S;
  }

  private you: number | null = null;
  private me: Tracked | null = null;

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
          // Others carry no name on a phone: the room tells a phone no one else's name (CONTRACT §5).
          t = tracked(this.kit.createPlayer(toPlayerLook(entry?.[4]), ''), p.x, p.y, f);
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
        this.me = tracked(this.kit.createPlayer(toPlayerLook(entry?.[4]), 'Вы'), input.me.x, input.me.y, f);
        this.me.player.setOwn(true);
        this.you = input.me.id;
        this.cam?.reset();
      }
      this.move(this.me, input.me.x, input.me.y, input.me.flags, dt, now, arena);
    }
    this.hunt(input.others, dt);
    this.placeCamera(dt, input.me, now);
    // Characters gone from the room (a kicked player).
    if (f % 30 === 0) {
      for (const [id, t] of this.tracked) {
        if (t.seen < f - 30) {
          t.player.dispose();
          this.tracked.delete(id);
        }
      }
    }
    // the phone's ladder (quality.ts) was tuned on frames of at most 100 ms: it keeps judging them so
    this.govern(Math.min(dt, 0.1));
  }

  // ── mode B: «Дедлайн» hunting (MODE_RUN.md) ──
  private readonly hunters = new Map<number, { model: Boss; x: number; y: number }>();
  /** Smaller copies of the boss for the other hunters (mode B). */
  private readonly copies: BossCopies;
  private bossAway = false;
  private bossX = 0;
  private bossY = 0;

  /** The boss runs where the room's first hunter is, smaller copies where the others are; then back to its stage. */
  private hunt(others: FrameInput['others'], dt: number): void {
    const boss = this.boss;
    const arena = this.arena;
    if (!boss || !arena) return;
    let lead = true;
    const seen = new Set<number>();
    if (others) {
      for (const [id, p] of others) {
        if (kindOf(p.flags) !== KIND_NPC) continue;
        if (lead) {
          lead = false;
          if (!this.bossAway) {
            this.bossAway = true;
            this.bossX = arena.stage.x;
            this.bossY = arena.stage.y;
          }
          this.runBoss(boss, p.x, p.y);
          continue;
        }
        seen.add(id);
        let h = this.hunters.get(id);
        if (!h) {
          const model = this.copies.make();
          if (!model) continue;
          model.setPhase('chase');
          h = { model, x: p.x, y: p.y };
          this.hunters.set(id, h);
        }
        if ((p.x - h.x) ** 2 + (p.y - h.y) ** 2 > 0.25) h.model.setFacing(Math.atan2(p.x - h.x, p.y - h.y));
        h.x = p.x;
        h.y = p.y;
        h.model.setPosition(p.x, p.y);
      }
    }
    for (const [id, h] of this.hunters) {
      if (seen.has(id)) continue;
      h.model.dispose();
      this.hunters.delete(id);
    }
    if (lead && this.bossAway) {
      const dx = arena.stage.x - this.bossX;
      const dy = arena.stage.y - this.bossY;
      const d = Math.hypot(dx, dy);
      const step = BOSS_HOME_SPEED * Math.max(dt, 0);
      if (d <= step || d < 1) {
        this.bossAway = false;
        boss.setPosition(arena.stage.x, arena.stage.y);
        boss.setFacing(0);
        boss.setPhase(this.alarm ? 'warn' : 'idle');
      } else {
        this.runBoss(boss, this.bossX + (dx / d) * step, this.bossY + (dy / d) * step);
      }
    }
  }

  private runBoss(boss: Boss, x: number, y: number): void {
    if ((x - this.bossX) ** 2 + (y - this.bossY) ** 2 > 0.25) boss.setFacing(Math.atan2(x - this.bossX, y - this.bossY));
    if (boss.phase !== 'chase' && boss.phase !== 'roar') boss.setPhase('chase');
    this.bossX = x;
    this.bossY = y;
    boss.setPosition(x, y);
  }

  private move(t: Tracked, x: number, y: number, flags: number, dt: number, now: number, arena: Arena): void {
    const dx = x - t.x;
    const dy = y - t.y;
    const speed = dt > 0 ? Math.hypot(dx, dy) / dt : 0;
    t.x = x;
    t.y = y;
    const p = t.player;
    // The battle's ice (a mixed game): it breaks on the right zone at the boss's blow, not before it (no blow yet: at
    // once); it forms only in sight, never on one falling or rising from the pit.
    const ice = isIced(flags);
    const away = t.fallAt !== Infinity && now < t.riseAt + RISE_S;
    const breaks = !ice && (this.impactAt === Infinity || now >= this.impactAt + 0.25);
    if (ice !== t.iced && (breaks || (ice && !away && !isGhost(flags)))) {
      t.iced = ice;
      // drawn as it is when first seen or right after the loop started again (ice changed in the button questions)
      p.setIce(ice, t.fresh || now - this.startedAt < 0.3);
    }
    t.fresh = false;
    if (t.fallAt !== Infinity) {
      if (now < t.riseAt) {
        // held where it stood until its tile goes, then down with it (or by itself where the tile stays)
        p.setGhost(false);
        p.setAway(false);
        const u = Math.max(0, now - t.fallAt);
        const z = now < t.fallAt ? 0 : Math.max(-650, Math.min(arena.floorAt(t.fx, t.fy), -650 * u * u));
        p.setPose(now < t.fallAt ? 'idle' : 'fall');
        p.setPosition(t.fx, t.fy, z);
        return;
      }
      if (now < t.riseAt + RISE_S) {
        // out of the pit as a ghost, sliding to where the room has it now
        const k = (now - t.riseAt) / RISE_S;
        const m = Math.min(1, k * 1.4);
        p.setGhost(true);
        p.setPose('idle');
        p.setPosition(t.fx + (x - t.fx) * m, t.fy + (y - t.fy) * m, -170 + 170 * easeOutBack(k));
        return;
      }
      t.fallAt = Infinity;
      t.riseAt = Infinity;
    }
    p.setGhost(isGhost(flags));
    p.setAway((flags & F_AWAY) !== 0);
    // in ice a character slides, it does not run
    p.setPose(speed > RUN_SPEED && !t.iced ? 'run' : 'idle');
    if (speed > RUN_SPEED) p.setFacing(Math.atan2(dx, dy));
    p.setPosition(x, y, isGhost(flags) ? 0 : Math.min(0, arena.floorAt(x, y)));
  }

  private placeCamera(dt: number, me: FrameInput['me'], now = 0): void {
    if (!this.view || !this.cam) return;
    const shot = this.cam.update(dt, me, this.screen, this.alarm || now < this.leanUntil);
    this.view.setCamera(shot);
  }

  /** The phone's own governor (quality.ts): down when frames run late, up after a calm stretch, never out of 3D. */
  private govern(dt: number): void {
    const view = this.view;
    if (!view || dt <= 0) return;
    if (this.governor.push(dt * 1000)) {
      this.level = this.governor.level;
      const lv = PHONE_LEVELS[this.level];
      view.setQuality(lv.kit);
      view.setMaxFps(lv.fps);
    }
  }

  /** The view's numbers, with the phone's own level (0 best … 5 the light view) as `quality`. */
  stats() {
    const s = this.view?.stats();
    return s ? { ...s, quality: this.level } : null;
  }

  dispose(): void {
    this.observer?.disconnect();
    this.observer = null;
    document.removeEventListener('visibilitychange', this.onVisible);
    this.kit.dispose();
    this.tracked.clear();
    this.view = null;
    this.arena = null;
    this.boss = null;
    this.canvas = null;
  }
}
