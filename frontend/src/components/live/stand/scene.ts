/**
 * The projector's 3D picture of mode A (docs/live/MODE_STAND.md §8, §9; the kit: docs/live/KIT_3D.md): the server's
 * arena with «Дедлайн» on its stage in the middle, a KayKit character per player, the stomp and the floor that drops.
 *
 * The render loop is the kit's requestAnimationFrame. Each frame it reads the room's interpolated positions straight
 * from the MoveClient and writes them into the scene: no React state per frame. The screen hears only what changes
 * (the timer's second, the zone counts, alive and ghosts) through `StandHud`, and passes each room `state` in
 * (about seven a question). Meshes are made on the welcome and on `add`, never per frame.
 */
import { loadKit, toPlayerLook, type Arena, type Boss, type BossKind, type Kit, type MoveMap, type Player, type View } from '../../../lib/live/three';
import { F_GHOST, KIND_PLAYER, ZONE_SHIFT, type MapJson, type RosterEntry, type StandHello, type StandState, type Welcome } from '../../../lib/live/move';
import type { Pose } from '../../../lib/live/move';
import { changeOf, easeOutBack, tally, timerFace, type TimerFace } from './plan';
import type { StandRoom } from './room';

export type StandCue = 'tick' | 'tickLast' | 'warn' | 'stomp' | 'impact' | 'back';

/** What the screen shows outside the 3D picture, told only on change. */
export interface StandHud {
  timer(face: TimerFace): void;
  tally(counts: readonly number[], alive: number, ghosts: number): void;
  cue(cue: StandCue): void;
}

export interface SceneOptions {
  /** Share of the screen kept free at the top (the board) and at the bottom (the buttons). */
  margins: { top: number; bottom: number };
  /** The kit's view: quality ('auto' by default), antialiasing, the pixel ratio's cap (a slow machine's recording). */
  view?: { quality?: 'auto' | number; antialias?: boolean; maxPixelRatio?: number };
}

/** Height of the boss on its stage, metres: the stage is the server's solid circle (r 80 = 1.6 m). */
const BOSS_HEIGHT: Record<BossKind, number> = { clock: 4.6, skeleton: 4.4 };
/** How steeply the camera looks down at the arena, degrees: steep enough that the boss hides little behind it. */
const TILT = 52;
/** Map units a second under which a character stands. */
const RUN_SPEED = 45;
/** A fallen character drops this long before it rises as a ghost, seconds. */
const FALL_S = 0.75;
/** How long a ghost takes to rise out of the pit, seconds. */
const RISE_S = 1.0;

/** The room's map as the kit takes it (answer zones are rectangles in mode A). */
export function kitMap(map: MapJson): MoveMap {
  return {
    w: map.w,
    h: map.h,
    solids: map.solids,
    zones: (map.zones ?? []).flatMap((z) => ('rect' in z ? [{ id: z.id, rect: z.rect }] : [])),
    spawns: map.spawns,
    npc_spawns: map.npc_spawns,
  };
}

interface Fall {
  /** Where it stood (it is held still meanwhile). */
  x: number;
  y: number;
  /** kit seconds: its tile starts to drop; it rises as a ghost; whether the tile under it drops at all. */
  start: number;
  rise: number;
  tile: boolean;
}

interface Actor {
  id: number;
  player: Player;
  x: number;
  y: number;
  flags: number;
  speed: number;
  placed: boolean;
  fall: Fall | null;
  cheerFrom: number;
  cheerUntil: number;
  seen: number;
}

export class StandScene {
  private kit: Kit | null = null;
  private view: View | null = null;
  private arena: Arena | null = null;
  private boss: Boss | null = null;
  private worldKey = '';
  private map: MoveMap | null = null;
  private readonly actors = new Map<number, Actor>();
  private hello: StandHello | null = null;
  private state: StandState | null = null;
  private zoneIds: string[] = [];
  private disposed = false;
  private frameNo = 0;
  // the question's moments, so each plays once
  private warnedQi = -1;
  private stompedQi = -1;
  /** kit seconds of the boss's blow on the floor (Infinity: none coming); whether its sound has played. */
  private impactAt = Infinity;
  private impactCued = true;
  private lastFace: TimerFace = { sec: null, ready: false, hot: false, left: 0 };
  private readonly sums = { counts: [0, 0, 0, 0], alive: 0, ghosts: 0 };
  private readonly shown = { counts: [-1, -1, -1, -1], alive: -1, ghosts: -1, zones: 0 };
  private readonly flagsScratch: number[] = [];
  private readonly hooks: Parameters<StandRoom['sceneHooks']['add']>[0];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly room: StandRoom,
    private readonly hud: StandHud,
    private readonly bossKind: BossKind,
    private options: SceneOptions,
  ) {
    this.hooks = {
      onWelcome: (w) => this.onWelcome(w),
      onHello: (h) => {
        this.hello = h;
        this.build();
      },
      onRoster: (e, id) => (e ? this.addActor(e) : this.removeActor(id)),
      onState: (s, prev) => this.onState(s, prev),
    };
    room.sceneHooks.add(this.hooks);
    const c = room.client;
    this.hello = c.stand.hello;
    this.state = c.stand.state;
  }

  /** Loads the kit and starts drawing. Resolves when the first frame can be drawn (or the kit failed). */
  async start(): Promise<void> {
    const kit = await loadKit({ boss: this.bossKind });
    if (this.disposed) {
      kit.dispose();
      return;
    }
    this.kit = kit;
    this.view = kit.mount(this.canvas, this.options.view ?? {});
    if (this.room.client.welcome) this.onWelcome(this.room.client.welcome);
    this.build();
    await this.view.warmUp();
    if (this.disposed) return;
    this.view.start((dt, now) => this.frame(dt, now));
  }

  setMargins(margins: SceneOptions['margins']): void {
    this.options = { ...this.options, margins };
    this.frameCamera();
  }

  /** The frame statistics of the view (the perf harness and `?fps`). */
  stats() {
    return this.view?.stats() ?? null;
  }

  dispose(): void {
    this.disposed = true;
    this.room.sceneHooks.delete(this.hooks);
    this.kit?.dispose();
    this.kit = null;
    this.view = null;
    this.actors.clear();
  }

  // ── the world ──

  private onWelcome(w: Welcome): void {
    this.build();
    if (!this.kit) return;
    const keep = new Set<number>();
    for (const e of w.roster) {
      if (e[1] !== KIND_PLAYER) continue;
      keep.add(e[0]);
      this.addActor(e);
    }
    for (const id of [...this.actors.keys()]) if (!keep.has(id)) this.removeActor(id);
  }

  /** The arena and the boss for the room's map, once the kit, the welcome and the hello are all here. */
  private build(): void {
    const kit = this.kit;
    const w = this.room.client.welcome;
    const h = this.hello ?? this.room.client.stand.hello;
    if (!kit || !w || !h) return;
    const key = JSON.stringify([w.map, h.floor, h.stage, h.boss]);
    if (key === this.worldKey) return;
    this.worldKey = key;
    this.arena?.dispose();
    this.boss?.dispose();
    this.map = kitMap(w.map);
    this.arena = kit.createArena(this.map, { floor: h.floor, stage: h.stage });
    this.zoneIds = (this.map.zones ?? []).map((z) => z.id);
    this.boss = kit.createBoss(this.bossKind, { height: BOSS_HEIGHT[this.bossKind] });
    this.frameCamera();
    for (const e of w.roster) if (e[1] === KIND_PLAYER) this.addActor(e);
    const st = this.state ?? this.room.client.stand.state;
    if (st) this.onState(st, null);
  }

  private frameCamera(): void {
    if (!this.view || !this.map || !this.arena) return;
    const m = this.options.margins;
    this.view.setCamera({ arena: this.map, margins: { top: m.top, bottom: m.bottom, left: 0.01, right: 0.01 }, tilt: TILT });
  }

  private addActor(e: RosterEntry): void {
    const kit = this.kit;
    if (!kit || e[1] !== KIND_PLAYER || this.actors.has(e[0])) return;
    const player = kit.createPlayer(toPlayerLook(e[4]), e[3] || '');
    this.actors.set(e[0], { id: e[0], player, x: 0, y: 0, flags: 0, speed: 0, placed: false, fall: null, cheerFrom: 0, cheerUntil: 0, seen: 0 });
  }

  private removeActor(id: number): void {
    const a = this.actors.get(id);
    if (!a) return;
    a.player.dispose();
    this.actors.delete(id);
  }

  // ── the game's moments ──

  private onState(st: StandState, prev: StandState | null): void {
    const before = this.state;
    this.state = st;
    const kit = this.kit;
    const arena = this.arena;
    const boss = this.boss;
    if (!kit || !arena || !boss) return;
    const now = kit.now();
    const change = changeOf(prev ?? before, st, this.room.client.serverNow());
    const n = st.q ? Math.min(st.q.options.length, this.zoneIds.length) : this.zoneIds.length;
    if (change === 'question' || st.phase === 'lobby' || st.phase === 'leaderboard' || st.phase === 'podium' || st.phase === 'ended') {
      arena.restore();
      boss.setPhase('idle');
      for (const a of this.actors.values()) a.fall = null;
      this.impactAt = Infinity;
      this.impactCued = true;
    }
    if (st.q) {
      const labels: Record<string, string> = {};
      this.zoneIds.forEach((id, i) => (labels[id] = i < n ? st.q!.options[i] : ''));
      arena.setZoneLabels(labels);
      arena.setClosedZones(this.zoneIds.slice(n));
    } else {
      arena.setZoneLabels({});
      arena.setClosedZones([]);
    }
    const res = st.res;
    if (change === 'stomp' && res) {
      // the boss jumped at zero (frame): the floor goes at its blow; a result that came late drops it at once
      if (this.stompedQi !== st.qi) this.stomp(st.qi, now);
      const impact = Math.max(this.impactAt, now + 0.05);
      arena.collapse(this.zoneIds[res.key] ?? '', impact);
      const fell = new Set(res.fell);
      for (const a of this.actors.values()) {
        if (fell.has(a.id)) {
          const drops = arena.fallsAt(a.x, a.y);
          const start = Number.isFinite(drops) ? drops : impact + 0.35;
          a.fall = { x: a.x, y: a.y, start, rise: start + FALL_S, tile: Number.isFinite(drops) };
        } else if ((a.flags & F_GHOST) === 0 && (a.flags >> ZONE_SHIFT) - 1 === res.key) {
          a.cheerFrom = impact + 0.45 + ((a.id * 7) % 10) * 0.04;
          a.cheerUntil = impact + 3.2;
        }
      }
    } else if (change === 'down' && res) {
      // seen late: the floor is already down, the fallen already ghosts
      arena.collapse(this.zoneIds[res.key] ?? '', now - 10);
      this.stompedQi = st.qi;
    } else if (change === 'up' && res) {
      arena.restore();
      boss.setPhase('idle');
      this.hud.cue('back');
      for (const id of res.back) {
        const a = this.actors.get(id);
        if (!a) continue;
        a.fall = null;
        a.cheerFrom = now + 0.25;
        a.cheerUntil = now + 1.8;
      }
    }
    if (st.phase === 'podium' && st.top) {
      st.top.slice(0, 3).forEach((t, i) => {
        const a = t.id !== null ? this.actors.get(t.id) : undefined;
        if (a) {
          a.cheerFrom = now + 0.2 * i;
          a.cheerUntil = Infinity;
        }
      });
    }
  }

  // ── each frame ──

  private frame(dt: number, now: number): void {
    const client = this.room.client;
    const arena = this.arena;
    const boss = this.boss;
    this.frameNo++;
    const t = client.serverNow();
    const st = this.state;
    if (boss && st && st.phase === 'open' && st.closes !== null && t !== null) {
      const hello = this.hello;
      if (this.warnedQi !== st.qi && t >= st.closes - (hello?.alarm_ms ?? 3000)) {
        this.warnedQi = st.qi;
        boss.setPhase('warn');
        this.hud.cue('warn');
      }
      // zero: the boss jumps; its blow drops the floor as soon as the room's result is here
      if (this.stompedQi !== st.qi && t >= st.closes) this.stomp(st.qi, now);
    }
    if (!this.impactCued && now >= this.impactAt) {
      this.impactCued = true;
      this.hud.cue('impact');
    }
    this.updateTimer(st, t);
    const { others } = client.frame();
    const flags = this.flagsScratch;
    flags.length = 0;
    for (const [id, pose] of others) {
      if ((pose.flags & 3) !== KIND_PLAYER) continue;
      flags.push(pose.flags);
      let a = this.actors.get(id);
      if (!a) {
        const e = client.roster.get(id);
        if (!e) continue;
        this.addActor(e);
        a = this.actors.get(id);
        if (!a) continue;
      }
      if (arena) this.place(a, pose, dt, now, arena);
    }
    const zones = st?.q ? Math.min(st.q.options.length, this.zoneIds.length) : this.zoneIds.length;
    tally(flags, zones, this.sums);
    this.tellTally(zones);
  }

  private stomp(qi: number, now: number): void {
    if (!this.boss) return;
    this.stompedQi = qi;
    this.boss.setPhase('stomp');
    this.impactAt = now + this.boss.stompImpactS;
    this.impactCued = false;
    this.hud.cue('stomp');
  }

  private place(a: Actor, pose: Pose, dt: number, now: number, arena: Arena): void {
    a.seen = this.frameNo;
    a.flags = pose.flags;
    const p = a.player;
    const f = a.fall;
    if (f) {
      if (now < f.rise) {
        // held where it stood; drops with its tile (or by itself when the tile stays: a phone that went away)
        p.setGhost(false);
        let z = 0;
        if (f.tile) z = arena.floorAt(f.x, f.y);
        else if (now > f.start) z = -650 * (now - f.start) * (now - f.start);
        p.setPosition(f.x, f.y, Math.max(-650, z));
        p.setPose(now >= f.start ? 'fall' : 'idle');
        a.x = f.x;
        a.y = f.y;
        return;
      }
      // out of the pit as a ghost, sliding to where the room has it now
      const k = (now - f.rise) / RISE_S;
      const m = Math.min(1, k * 1.4);
      const x = f.x + (pose.x - f.x) * m;
      const y = f.y + (pose.y - f.y) * m;
      p.setGhost(true);
      p.setPosition(x, y, -170 + 170 * easeOutBack(k));
      p.setPose('idle');
      a.x = x;
      a.y = y;
      if (k >= 1) a.fall = null;
      return;
    }
    const dx = pose.x - a.x;
    const dy = pose.y - a.y;
    const d = Math.hypot(dx, dy);
    if (!a.placed || d > 120) {
      a.placed = true;
      a.speed = 0;
    } else if (dt > 0) {
      const inst = d / dt;
      a.speed += (inst - a.speed) * Math.min(1, dt * 12);
      if (d > 0.4) p.setFacing(Math.atan2(dx, dy));
    }
    a.x = pose.x;
    a.y = pose.y;
    const ghost = (pose.flags & F_GHOST) !== 0;
    p.setGhost(ghost);
    const z = ghost ? 0 : arena.floorAt(a.x, a.y);
    p.setPosition(a.x, a.y, z);
    if (!ghost && z < -4) p.setPose('fall');
    else if (now >= a.cheerFrom && now < a.cheerUntil && a.speed < RUN_SPEED) p.setPose('cheer');
    else p.setPose(a.speed > RUN_SPEED ? 'run' : 'idle');
  }

  private updateTimer(st: StandState | null, t: number | null): void {
    const face = timerFace(st, t, this.hello?.alarm_ms ?? 3000);
    const last = this.lastFace;
    if (face.sec === last.sec && face.ready === last.ready && face.hot === last.hot) return;
    if (st?.phase === 'open' && !face.ready && face.sec !== null && face.sec !== last.sec && face.sec > 0 && face.sec <= 5) {
      this.hud.cue(face.sec === 1 ? 'tickLast' : 'tick');
    }
    this.lastFace = face;
    this.hud.timer(face);
  }

  private tellTally(zones: number): void {
    const s = this.sums;
    const sh = this.shown;
    let same = s.alive === sh.alive && s.ghosts === sh.ghosts && zones === sh.zones;
    for (let i = 0; same && i < zones; i++) if (s.counts[i] !== sh.counts[i]) same = false;
    if (same) return;
    sh.alive = s.alive;
    sh.ghosts = s.ghosts;
    sh.zones = zones;
    for (let i = 0; i < zones; i++) sh.counts[i] = s.counts[i];
    this.hud.tally(s.counts.slice(0, zones), s.alive, s.ghosts);
  }
}
