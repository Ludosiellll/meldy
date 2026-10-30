/**
 * The projector's 3D picture of mode A (docs/live/MODE_STAND.md §8, §9; the kit: docs/live/KIT_3D.md): the server's
 * arena with «Дедлайн» on its stage in the middle, a KayKit character per player, the stomp and the floor that drops.
 *
 * The render loop is the kit's requestAnimationFrame. Each frame it reads the room's interpolated positions straight
 * from the MoveClient and writes them into the scene: no React state per frame. The screen hears only what changes
 * (the timer's second, the zone counts, alive and ghosts) through `StandHud`, and passes each room `state` in
 * (about seven a question). A character's model is made the first time the room places it (the room sends no
 * positions outside the rounds: nobody is drawn where nobody stands), never per frame.
 *
 * The kit's clock is real time, however slow the frames (a projector without a GPU draws 1–2 a second). The room's
 * `floor: up` waits for a frame that has shown the floor down (FloorShow), and every fallen character is drawn in its
 * fall at least once (fallFrame): on any frame rate the drop is on screen between the stomp and the floor's return.
 */
import { STAGE_BOSS_HEIGHT, loadKit, toPlayerLook, type Arena, type Boss, type BossKind, type Kit, type MoveMap, type Player, type PlayerLook, type View } from '../../../lib/live/three';
import { collapseDownAfter } from '../../../lib/live/three/arenaPlan';
import { F_AWAY, F_GHOST, F_ICE, KIND_NPC, KIND_PLAYER, ZONE_SHIFT, type MapJson, type RosterEntry, type StandHello, type StandResult, type StandState, type Welcome } from '../../../lib/live/move';
import type { Pose } from '../../../lib/live/move';

/** Positions sampled each frame, reused (MoveClient.frameInto). */
type Poses = Map<number, Pose>;
import { FALL_S, FloorShow, changeOf, easeOutBack, fallFrame, tally, timerFace, type FallPlan, type TimerFace } from './plan';
import { facing, leapAt, leapPoint, ringSpots, type Spot } from './formation';
import type { StandRoom } from './room';

/** The moments the screen plays sounds on: the last seconds' ticks, the alarm, the boss's jump and blow, the first
 * ghost rising, the first cheer of those who stood, the floor coming back; freeze and thaw: a mixed game's ice formed or
 * broke on someone (once per frame at most). */
/** `hunt`: «Дедлайн» jumps off its stage after the class (mode B); `caught`: it caught someone. */
export type StandCue = 'tick' | 'tickLast' | 'warn' | 'stomp' | 'impact' | 'rise' | 'cheer' | 'back' | 'freeze' | 'thaw' | 'hunt' | 'caught';

/** What the screen shows outside the 3D picture, told only on change. */
export interface StandHud {
  timer(face: TimerFace): void;
  /** Players per zone, alive, ghosts and (a mixed game) frozen in the battle. */
  tally(counts: readonly number[], alive: number, ghosts: number, iced: number): void;
  cue(cue: StandCue): void;
}

/** A battle's player as the database has it (the host's roster, in joining order): the class round the boss. */
export interface BattleRow {
  pid: string;
  name: string;
  look: unknown;
}

export interface SceneOptions {
  /** Share of the screen kept free at the top (the board) and at the bottom (the buttons). */
  margins: { top: number; bottom: number };
  /** The kit's view: quality ('auto' by default), antialiasing, the pixel ratio's cap (a slow machine's recording). */
  view?: { quality?: 'auto' | number; antialias?: boolean; maxPixelRatio?: number; preserveDrawingBuffer?: boolean };
  /**
   * A battle with movement rounds (docs/live/MODE_MIXED.md): the battle's freeze is drawn as ice (F_ICE), it breaks on
   * the right zone at the boss's blow and forms on the fallen when they are back; the floor's return cheers nobody.
   */
  mixed?: boolean;
  /** Start with the loop stopped (a mixed game's arena between its movement rounds): `resume()` starts it. */
  paused?: boolean;
  /**
   * The arena to draw until the room's welcome and hello come (a battle's class round the boss needs no room): its
   * map, stage and floor (world.ts). Without it nothing is drawn before the room speaks.
   */
  world?: { map: MapJson; stage: [number, number, number]; floor: StandHello['floor'] };
}

/** How steeply the camera looks down at the arena, degrees: steep enough that the boss hides little behind it. */
const TILT = 52;
/** Mode B: the other hunters are this much of the boss's height; the boss runs back to its stage this fast. */
const HUNTER_SCALE = 0.62;
const BOSS_HOME_SPEED = 700;
/** Map units a second under which a character stands. */
const RUN_SPEED = 45;
/** A battle's class runs to its places round the boss this fast (map units a second). */
const FORM_SPEED = 520;
/** A character drawn this long after the class formed came in now: it hops in. */
const JOIN_HOP_AFTER_S = 0.6;

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

export interface Stat {
  mean: number;
  p50: number;
  p95: number;
  max: number;
}

function stat(list: number[]): Stat {
  const s = list.slice().sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
  return { mean: s.reduce((a, b) => a + b, 0) / Math.max(1, s.length), p50: at(0.5), p95: at(0.95), max: s[s.length - 1] ?? 0 };
}

interface Fall extends FallPlan {
  /** Where it stood (it is held still meanwhile). */
  x: number;
  y: number;
}

interface Actor {
  id: number;
  /** live_players.id (the host's roster has it), the look to draw and it as JSON. */
  pid: string | null;
  look: PlayerLook;
  lookKey: string;
  name: string;
  /** Its model: made when the room first places it (null: not drawn yet). */
  player: Player | null;
  x: number;
  y: number;
  flags: number;
  speed: number;
  placed: boolean;
  fall: Fall | null;
  cheerFrom: number;
  cheerUntil: number;
  seen: number;
  /** The ice drawn now (a mixed game). */
  iced: boolean;
  /** Kit second a battle's hit leaps at the boss (-Infinity: none). */
  leapAt: number;
  /** A battle's player drawn from the database's roster alone: its phone is not in the room. */
  puppet: boolean;
}

export class StandScene {
  private kit: Kit | null = null;
  private view: View | null = null;
  private arena: Arena | null = null;
  private boss: Boss | null = null;
  private worldKey = '';
  private map: MoveMap | null = null;
  private floor: StandHello['floor'] | null = null;
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
  /** kit seconds of the first ghost rising and the first cheer after the blow (Infinity: none coming). */
  private riseAt = Infinity;
  private cheerAt = Infinity;
  /** The floor's drop on screen (FloorShow): the zone that stays, its kit second, the room's `up` that waits. */
  private readonly floorShow = new FloorShow();
  private collapseZone = '';
  private collapseAt = -Infinity;
  private upRes: StandResult | null = null;
  /** Seconds from a collapse's start until the whole gap is down (collapseDownAfter for this arena). */
  private downAfter = 2;
  private lastFace: TimerFace = { sec: null, ready: false, hot: false, left: 0 };
  private readonly sums = { counts: [0, 0, 0, 0], alive: 0, ghosts: 0, iced: 0 };
  private readonly shown = { counts: [-1, -1, -1, -1], alive: -1, ghosts: -1, iced: -1, zones: 0 };
  /** The loop is stopped (a mixed game between its movement rounds); kit seconds of the last resume. */
  private paused = false;
  private resumedAt = -Infinity;
  /** The ice's sounds of this frame (one each, whoever it was). */
  private froze = false;
  private thawed = false;
  private readonly flagsScratch: number[] = [];
  private readonly poses: Poses = new Map();
  /** Looks by live_players.id from the database's roster: a hero changed in the lobby (the room keeps the first). */
  private looks = new Map<string, unknown>();
  private readonly hooks: Parameters<StandRoom['sceneHooks']['add']>[0];
  /**
   * A battle outside its movement rounds (the button questions, the lobby, the five best, the podium): the class stands
   * round the boss, from the database's roster; the room's positions wait for the next movement round.
   */
  private formation = false;
  private formedAt = -Infinity;
  private order: BattleRow[] = [];
  private spots = new Map<string, Spot>();
  private puppets = new Map<string, number>();
  private nextPuppet = -1;
  /** The battle's ice by live_players.id while the class stands round the boss (the database's word). */
  private icedPids: ReadonlySet<string> = new Set();
  /**
   * Mode B (MODE_RUN.md): the boss follows the room's first hunter, smaller copies the others; off its stage `away`,
   * where it is drawn now.
   */
  private readonly hunters = new Map<number, { model: Boss; x: number; y: number }>();
  private bossAway = false;
  private bossX = 0;
  private bossY = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly room: StandRoom,
    private hud: StandHud,
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
      onCaught: (id) => this.onCaught(id),
    };
    room.sceneHooks.add(this.hooks);
    this.paused = options.paused === true;
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
    if (this.disposed || this.paused) return;
    this.view.start((dt, now) => this.frame(dt, now));
  }

  /** Stops drawing (a mixed game's arena while the battle's screens show): no frames, no GPU work. */
  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.view?.stop();
  }

  /** Draws again; ice changed meanwhile is shown as it is, without growing or breaking. */
  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    if (!this.view || !this.kit) return;
    this.resumedAt = this.kit.now();
    this.view.start((dt, now) => this.frame(dt, now));
  }

  /** A camera jolt (a hit on the boss in a mixed game's reveal). */
  shake(strength: number): void {
    this.view?.shake(strength);
  }

  /** The boss's look for a moment of the reveal: a roar at the blow, stunned when it falls; warn: the last seconds. */
  bossPhase(phase: 'warn' | 'roar' | 'stunned' | 'idle'): void {
    this.boss?.setPhase(phase);
  }

  // ── a battle round the boss (formation.ts) ──

  /**
   * On: the class stands round the boss (from `setRoster`), the floor is whole and plain; off: the room's positions
   * draw everyone (a movement round). Whoever stands elsewhere runs to its place.
   */
  setFormation(on: boolean): void {
    if (on === this.formation) return;
    this.formation = on;
    const now = this.kit?.now() ?? 0;
    this.formedAt = on ? now : -Infinity;
    this.resumedAt = now;
    if (on) {
      this.arena?.restore();
      this.floorShow.reset();
      this.upRes = null;
      this.impactAt = Infinity;
      this.impactCued = true;
      this.riseAt = Infinity;
      this.cheerAt = Infinity;
      if (this.boss && this.boss.phase !== 'stunned') this.boss.setPhase('idle');
      for (const a of this.actors.values()) {
        a.fall = null;
        a.placed = !!a.player;
      }
    } else {
      for (const a of this.actors.values()) {
        a.leapAt = -Infinity;
        a.cheerUntil = 0;
      }
    }
    this.closeZones();
    this.reconcile();
  }

  /** The database's players in joining order: their places round the boss, and who is drawn without a phone. */
  setRoster(rows: readonly BattleRow[]): void {
    this.order = rows.slice();
    this.layout();
    this.reconcile();
  }

  /** The battle's ice while the class stands round the boss; `instant`: as it is, without growing or breaking. */
  setIced(pids: ReadonlySet<string>, instant = false): void {
    this.icedPids = pids;
    if (!this.formation) return;
    for (const a of this.actors.values()) {
      const want = !!a.pid && pids.has(a.pid);
      if (want === a.iced || !a.player) continue;
      a.iced = want;
      a.player.setIce(want, instant);
    }
  }

  /** An answer came in: the player's character hops. */
  hop(pid: string): void {
    const a = this.byPid(pid);
    if (a?.player && this.formation && !Number.isFinite(a.leapAt)) a.player.setPose('jump');
  }

  /** A hit: the character leaps at the boss and back (it lands formation.LEAP_OUT_S after this call). */
  strike(pid: string): void {
    const a = this.byPid(pid);
    if (!a?.player || !this.formation || !this.kit) return;
    a.leapAt = this.kit.now();
    a.player.setPose('jump');
  }

  /** These players cheer (`'all'`: everyone) for `seconds` (Infinity: until `calm`). */
  cheer(pids: readonly string[] | 'all', seconds = 3): void {
    const now = this.kit?.now() ?? 0;
    const set = pids === 'all' ? null : new Set(pids);
    for (const a of this.actors.values()) {
      if (set && (!a.pid || !set.has(a.pid))) continue;
      a.cheerFrom = now + ((Math.abs(a.id) * 7) % 10) * 0.04;
      a.cheerUntil = now + seconds;
    }
  }

  calm(): void {
    for (const a of this.actors.values()) a.cheerUntil = 0;
  }

  private byPid(pid: string): Actor | undefined {
    for (const a of this.actors.values()) if (a.pid === pid && (this.formation ? this.spots.has(pid) : !a.puppet)) return a;
    return undefined;
  }

  /** The places round the boss for the roster (once the arena is built). */
  private layout(): void {
    const arena = this.arena;
    const map = this.map;
    this.spots = new Map();
    if (!arena || !map) return;
    const f = this.floor;
    const floor = f ? { x0: f.x, y0: f.y, x1: f.x + f.cols * f.tile, y1: f.y + f.rows * f.tile } : { x0: 0, y0: 0, x1: map.w, y1: map.h };
    const spots = ringSpots(this.order.length, arena.stage, floor);
    this.order.forEach((r, i) => this.spots.set(r.pid, spots[i]));
  }

  /** Every zone plain while the class stands round the boss; the room's question names them again in a round. */
  private closeZones(): void {
    const arena = this.arena;
    if (!arena) return;
    if (this.formation) {
      arena.setZoneLabels({});
      arena.setClosedZones(this.zoneIds);
    } else {
      const st = this.state ?? this.room.client.stand.state;
      if (st) this.onState(st, st);
    }
  }

  /**
   * Puppets: a battle's player with no character in the room (its phone is not connected) is drawn from the database's
   * roster while the class stands round the boss; when its phone comes, the room's character takes the model over.
   */
  private reconcile(): void {
    const roomPids = new Set<string>();
    for (const a of this.actors.values()) if (!a.puppet && a.pid) roomPids.add(a.pid);
    for (const [pid, id] of [...this.puppets]) {
      if (this.formation && this.spots.has(pid) && !roomPids.has(pid)) continue;
      const a = this.actors.get(id);
      a?.player?.dispose();
      this.actors.delete(id);
      this.puppets.delete(pid);
    }
    if (!this.formation) return;
    for (const r of this.order) {
      if (roomPids.has(r.pid) || this.puppets.has(r.pid)) continue;
      const id = this.nextPuppet--;
      const look = toPlayerLook(this.looks.has(r.pid) ? this.looks.get(r.pid) : r.look);
      this.puppets.set(r.pid, id);
      this.actors.set(id, { id, pid: r.pid, look, lookKey: JSON.stringify(look), name: r.name, player: null, x: 0, y: 0, flags: 0, speed: 0, placed: false, fall: null, cheerFrom: 0, cheerUntil: 0, seen: 0, iced: false, leapAt: -Infinity, puppet: true });
    }
  }

  setMargins(margins: SceneOptions['margins']): void {
    this.options = { ...this.options, margins };
    this.frameCamera();
  }

  /** The frame statistics of the view (the perf harness and `?fps`). */
  stats() {
    return this.view?.stats() ?? null;
  }

  /**
   * The perf harness (scripts/stand-local.mjs perf): `frames` frames drawn back to back with the loop stopped, each
   * after waiting for the GPU, timing this screen's per-frame work (positions, poses, timer, counts), the kit's update
   * and handing the draw calls over. Milliseconds of JavaScript; the loop starts again after.
   */
  bench(frames: number): { frames: number; total: Stat; scene: Stat; kitAndDraw: Stat; update: Stat; draw: Stat; hudCalls: number; drawCalls: number } | null {
    const view = this.view as unknown as { stop(): void; start(f: (dt: number, now: number) => void): void; frame(dt: number): number; renderer: { getContext(): WebGL2RenderingContext; info: { render: { calls: number } } } } | null;
    if (!view || !this.kit) return null;
    view.stop();
    const gl = view.renderer.getContext();
    const total: number[] = [];
    const scene: number[] = [];
    const update: number[] = [];
    const draw: number[] = [];
    let hudCalls = 0;
    const hud = this.hud;
    const counting: StandHud = {
      timer: (f) => {
        hudCalls++;
        hud.timer(f);
      },
      tally: (c, a, g, i) => {
        hudCalls++;
        hud.tally(c, a, g, i);
      },
      cue: (c) => hud.cue(c),
    };
    (this as unknown as { hud: StandHud }).hud = counting;
    const dt = 1 / 60;
    for (let i = 0; i < frames; i++) {
      gl.finish();
      const t0 = performance.now();
      this.frame(dt, this.kit.now());
      const t1 = performance.now();
      this.kit.update(dt);
      const t1b = performance.now();
      (view as unknown as { renderOnce(dt: number): void }).renderOnce(dt);
      const t2 = performance.now();
      update.push(t1b - t1);
      draw.push(t2 - t1b);
      scene.push(t1 - t0);
      total.push(t2 - t0);
    }
    (this as unknown as { hud: StandHud }).hud = hud;
    const drawCalls = view.renderer.info.render.calls;
    view.start((d, now) => this.frame(d, now));
    const kitAndDraw = total.map((t, i) => t - scene[i]);
    return { frames, total: stat(total), scene: stat(scene), kitAndDraw: stat(kitAndDraw), update: stat(update), draw: stat(draw), hudCalls, drawCalls };
  }

  /**
   * Frame by frame (a recording on a machine too slow for real time): `manual(true)` stops the loop; each `step(dt)`
   * then draws exactly one frame dt seconds later.
   */
  manual(on: boolean): void {
    if (on) this.view?.stop();
    else this.view?.start((d, now) => this.frame(d, now));
  }

  step(dt: number): void {
    const view = this.view as unknown as { renderOnce(dt: number): void } | null;
    if (!view || !this.kit) return;
    this.frame(dt, this.kit.now());
    this.kit.update(dt);
    view.renderOnce(dt);
  }

  dispose(): void {
    this.disposed = true;
    this.room.sceneHooks.delete(this.hooks);
    this.hunters.clear();
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
    const world = w && h ? { map: w.map, floor: h.floor, stage: h.stage } : (this.options.world ?? null);
    if (!kit || !world) return;
    const key = JSON.stringify([world.map, world.floor, world.stage]);
    if (key === this.worldKey) return;
    this.worldKey = key;
    this.arena?.dispose();
    this.boss?.dispose();
    for (const h of this.hunters.values()) h.model.dispose();
    this.hunters.clear();
    this.bossAway = false;
    this.map = kitMap(world.map);
    this.floor = world.floor;
    this.arena = kit.createArena(this.map, { floor: world.floor, stage: world.stage });
    this.downAfter = collapseDownAfter(this.map, { floor: world.floor, stage: world.stage });
    this.zoneIds = (this.map.zones ?? []).map((z) => z.id);
    this.boss = kit.createBoss(this.bossKind, { height: STAGE_BOSS_HEIGHT[this.bossKind] });
    this.frameCamera();
    if (w) for (const e of w.roster) if (e[1] === KIND_PLAYER) this.addActor(e);
    const st = this.state ?? this.room.client.stand.state;
    if (st) this.onState(st, null);
    else if (this.formation) this.closeZones();
    this.layout();
    this.reconcile();
  }

  private frameCamera(): void {
    if (!this.view || !this.map || !this.arena) return;
    const m = this.options.margins;
    this.view.setCamera({ arena: this.map, margins: { top: m.top, bottom: m.bottom, left: 0.01, right: 0.01 }, tilt: TILT });
  }

  /**
   * The database's looks by live_players.id (HostState roster). A player who changed the hero in the lobby gets the
   * new model; everyone else keeps theirs (models are made only when a look changes).
   */
  setLooks(looks: Map<string, unknown>): void {
    this.looks = looks;
    const kit = this.kit;
    if (!kit) return;
    for (const a of this.actors.values()) {
      if (!a.pid || !looks.has(a.pid)) continue;
      const look = toPlayerLook(looks.get(a.pid));
      const key = JSON.stringify(look);
      if (key === a.lookKey) continue;
      a.look = look;
      a.lookKey = key;
      if (!a.player) continue;
      a.player.dispose();
      a.player = kit.createPlayer(look, a.name);
      a.player.setPosition(a.x, a.y, 0);
      if (a.iced) a.player.setIce(true, true);
    }
  }

  /** A character of the roster: its model waits for the room's first position of it (place). */
  private addActor(e: RosterEntry): void {
    const kit = this.kit;
    if (!kit || e[1] !== KIND_PLAYER || this.actors.has(e[0])) return;
    const pid = e[2];
    const look = toPlayerLook(pid && this.looks.has(pid) ? this.looks.get(pid) : e[4]);
    const name = e[3] || '';
    const a: Actor = { id: e[0], pid, look, lookKey: JSON.stringify(look), name, player: null, x: 0, y: 0, flags: 0, speed: 0, placed: false, fall: null, cheerFrom: 0, cheerUntil: 0, seen: 0, iced: false, leapAt: -Infinity, puppet: false };
    // its phone came: the puppet drawn for it hands its model over, where it stands
    const was = pid ? this.puppets.get(pid) : undefined;
    const puppet = was !== undefined ? this.actors.get(was) : undefined;
    if (puppet && pid) {
      if (puppet.lookKey === a.lookKey) {
        Object.assign(a, { player: puppet.player, x: puppet.x, y: puppet.y, placed: puppet.placed, iced: puppet.iced, cheerFrom: puppet.cheerFrom, cheerUntil: puppet.cheerUntil, leapAt: puppet.leapAt });
      } else puppet.player?.dispose();
      this.actors.delete(was!);
      this.puppets.delete(pid);
    }
    this.actors.set(e[0], a);
  }

  private removeActor(id: number): void {
    const a = this.actors.get(id);
    if (!a) return;
    a.player?.dispose();
    this.actors.delete(id);
    // a battle's player whose phone left the room is still in the game: drawn from the roster
    if (this.formation && a.pid && this.spots.has(a.pid)) this.reconcile();
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
      this.riseAt = Infinity;
      this.cheerAt = Infinity;
      this.floorShow.reset();
      this.upRes = null;
    }
    if (this.formation) {
      arena.setZoneLabels({});
      arena.setClosedZones(this.zoneIds);
    } else if (st.q) {
      const labels: Record<string, string> = {};
      this.zoneIds.forEach((id, i) => (labels[id] = i < n ? st.q!.options[i] : ''));
      arena.setZoneLabels(labels);
      arena.setClosedZones(this.zoneIds.slice(n));
    } else {
      arena.setZoneLabels({});
      arena.setClosedZones([]);
    }
    const res = this.formation ? null : st.res;
    if (change === 'stomp' && res) {
      // the boss jumped at zero (frame): the floor goes at its blow; a result that came late drops it at once
      if (this.stompedQi !== st.qi) this.stomp(st.qi, now);
      const impact = Math.max(this.impactAt, now + 0.05);
      this.dropFloor(this.zoneIds[res.key] ?? '', impact);
      const fell = new Set(res.fell);
      let rise = Infinity;
      let cheer = Infinity;
      for (const a of this.actors.values()) {
        if (fell.has(a.id)) {
          // one never drawn (no position yet) has no fall to show
          if (!a.player) continue;
          const drops = arena.fallsAt(a.x, a.y);
          const start = Number.isFinite(drops) ? drops : impact + 0.35;
          a.fall = { x: a.x, y: a.y, start, rise: start + FALL_S, tile: Number.isFinite(drops), drawn: false };
          rise = Math.min(rise, a.fall.rise);
        } else if ((a.flags & F_GHOST) === 0 && (a.flags >> ZONE_SHIFT) - 1 === res.key) {
          a.cheerFrom = impact + 0.45 + ((a.id * 7) % 10) * 0.04;
          a.cheerUntil = impact + 3.2;
          cheer = Math.min(cheer, a.cheerFrom);
        }
      }
      this.riseAt = rise;
      this.cheerAt = cheer;
    } else if (change === 'down' && res) {
      // seen late: the floor is already down, the fallen already ghosts
      this.dropFloor(this.zoneIds[res.key] ?? '', now - 10);
      this.stompedQi = st.qi;
    } else if (change === 'up' && res) {
      // back now, or after the frame that shows the floor down (a slow or late frame: FloorShow)
      this.upRes = res;
      if (this.floorShow.up()) this.floorUp(res, now);
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

  /** The floor drops from kit second `tStart` (the blow); FloorShow learns when a frame shows it down. */
  private dropFloor(zone: string, tStart: number): void {
    this.arena?.collapse(zone, tStart);
    this.collapseZone = zone;
    this.collapseAt = tStart;
    this.floorShow.drop(tStart + this.downAfter);
  }

  /**
   * The room's `up` waits and this frame would still come before the floor is down (frames slower than its down
   * time): the whole drop moves `by` seconds earlier, the falls and the cheers with it, so this frame shows it down.
   */
  private hurry(by: number, now: number): void {
    const arena = this.arena;
    if (!arena) return;
    this.collapseAt -= by;
    arena.collapse(this.collapseZone, this.collapseAt);
    if (Number.isFinite(this.impactAt)) this.impactAt -= by;
    if (Number.isFinite(this.riseAt)) this.riseAt -= by;
    if (Number.isFinite(this.cheerAt)) this.cheerAt -= by;
    for (const a of this.actors.values()) {
      if (Number.isFinite(a.cheerUntil) && a.cheerUntil > now) {
        a.cheerFrom -= by;
        a.cheerUntil -= by;
      }
      const f = a.fall;
      if (!f) continue;
      const drops = arena.fallsAt(f.x, f.y);
      f.tile = Number.isFinite(drops);
      f.start = f.tile ? drops : f.start - by;
      f.rise = f.start + FALL_S;
    }
  }

  /** The floor comes back: the tiles rise, the fallen of `res.back` are back. */
  private floorUp(res: StandResult, now: number): void {
    this.upRes = null;
    const arena = this.arena;
    const boss = this.boss;
    if (!arena || !boss) return;
    arena.restore();
    if (boss.phase !== 'stunned') boss.setPhase('idle');
    this.hud.cue('back');
    for (const id of res.back) {
      const a = this.actors.get(id);
      if (!a) continue;
      a.fall = null;
      // a mixed game: everyone who fell comes back (a miss, not a revival): nobody cheers
      if (this.options.mixed) continue;
      a.cheerFrom = now + 0.25;
      a.cheerUntil = now + 1.8;
    }
  }

  // ── each frame ──

  private frame(dt: number, now: number): void {
    const client = this.room.client;
    const arena = this.arena;
    const boss = this.boss;
    this.frameNo++;
    // the kit's update runs after this: what is set here is drawn at kit second `at` (a whole second later at 1 fps)
    const at = now + (dt > 0 ? dt : 0);
    if (this.formation) {
      this.formationFrame(dt, now, at);
      return;
    }
    const t = client.frameInto(this.poses);
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
    // the floor on a slow or late frame: the room's `up` waits until a frame has shown it down
    const floor = this.floorShow.frame(at);
    if (floor.act === 'hurry') this.hurry(floor.by, now);
    else if (floor.act === 'restore' && this.upRes) this.floorUp(this.upRes, now);
    if (!this.impactCued && at >= this.impactAt) {
      this.impactCued = true;
      this.hud.cue('impact');
    }
    if (at >= this.cheerAt) {
      this.cheerAt = Infinity;
      this.hud.cue('cheer');
    }
    if (at >= this.riseAt) {
      this.riseAt = Infinity;
      this.hud.cue('rise');
    }
    this.updateTimer(st, t);
    const flags = this.flagsScratch;
    flags.length = 0;
    for (const [id, pose] of this.poses) {
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
      if (arena) this.place(a, pose, dt, now, at, arena);
    }
    this.huntFrame(dt, t);
    const zones = st?.q ? Math.min(st.q.options.length, this.zoneIds.length) : this.zoneIds.length;
    tally(flags, zones, this.sums);
    this.tellTally(zones);
    if (this.froze) this.hud.cue('freeze');
    if (this.thawed) this.hud.cue('thaw');
    this.froze = false;
    this.thawed = false;
  }

  /** A battle round the boss: each character at its place facing the boss, running there if it stands elsewhere. */
  private formationFrame(dt: number, now: number, at: number): void {
    const arena = this.arena;
    const kit = this.kit;
    if (!arena || !kit) return;
    const boss = arena.stage;
    for (const a of this.actors.values()) {
      const spot = a.pid ? this.spots.get(a.pid) : undefined;
      // a room's character the roster does not have (kicked, or not the database's yet): not drawn now
      if (!spot || (!a.puppet && a.pid && this.puppets.has(a.pid))) {
        if (a.player) {
          a.player.dispose();
          a.player = null;
          a.placed = false;
        }
        continue;
      }
      let p = a.player;
      if (!p) {
        p = a.player = kit.createPlayer(a.look, a.name);
        a.x = spot.x;
        a.y = spot.y;
        a.placed = true;
        p.setPosition(spot.x, spot.y, 0);
        p.setFacing(facing(spot, boss), true);
        // one who joins while the class stands here hops in
        if (now - this.formedAt > JOIN_HOP_AFTER_S) p.setPose('jump');
        a.iced = false;
      }
      p.setGhost(false);
      p.setAway(false);
      const wantIce = !!a.pid && this.icedPids.has(a.pid);
      if (wantIce !== a.iced) {
        a.iced = wantIce;
        p.setIce(wantIce, true);
      }
      let z = 0;
      let moving = false;
      if (Number.isFinite(a.leapAt)) {
        const leap = leapAt(at - a.leapAt);
        if (leap.done) a.leapAt = -Infinity;
        const pt = leapPoint(spot, boss, leap.k);
        a.x = pt.x;
        a.y = pt.y;
        z = leap.z;
      } else {
        const dx = spot.x - a.x;
        const dy = spot.y - a.y;
        const d = Math.hypot(dx, dy);
        const stepLen = FORM_SPEED * Math.max(0, dt);
        if (!a.placed || d <= stepLen || d < 1) {
          a.x = spot.x;
          a.y = spot.y;
          a.placed = true;
        } else {
          a.x += (dx / d) * stepLen;
          a.y += (dy / d) * stepLen;
          moving = true;
          p.setFacing(Math.atan2(dx, dy));
        }
      }
      if (!moving) p.setFacing(facing({ x: a.x, y: a.y }, boss));
      p.setPosition(a.x, a.y, z);
      // in ice a character slides, it does not run
      if (moving && !a.iced) p.setPose('run');
      else if (at >= a.cheerFrom && at < a.cheerUntil && !a.iced) p.setPose('cheer');
      else p.setPose('idle');
    }
  }

  // ── mode B: the hunt ──

  /**
   * The room's hunters (NPC entities) this frame: the boss runs where the first one is, a smaller copy of it where
   * each other one is. With none out, a boss off its stage runs back to it (the stomp is from the stage).
   */
  private huntFrame(dt: number, t: number | null): void {
    const boss = this.boss;
    const arena = this.arena;
    const kit = this.kit;
    if (!boss || !arena || !kit) return;
    let lead = true;
    const seen = new Set<number>();
    for (const [id, pose] of this.poses) {
      if ((pose.flags & 3) !== KIND_NPC) continue;
      if (lead) {
        lead = false;
        if (!this.bossAway) {
          this.bossAway = true;
          this.bossX = arena.stage.x;
          this.bossY = arena.stage.y;
          this.hud.cue('hunt');
        }
        this.runBoss(boss, pose.x, pose.y);
        continue;
      }
      seen.add(id);
      let h = this.hunters.get(id);
      if (!h) {
        const model = kit.createBoss(this.bossKind, { height: STAGE_BOSS_HEIGHT[this.bossKind] * HUNTER_SCALE });
        model.setPhase('chase');
        h = { model, x: pose.x, y: pose.y };
        this.hunters.set(id, h);
      }
      const dx = pose.x - h.x;
      const dy = pose.y - h.y;
      if (dx * dx + dy * dy > 0.25) h.model.setFacing(Math.atan2(dx, dy));
      h.x = pose.x;
      h.y = pose.y;
      h.model.setPosition(pose.x, pose.y);
    }
    for (const [id, h] of this.hunters) {
      if (seen.has(id)) continue;
      h.model.dispose();
      this.hunters.delete(id);
    }
    if (lead && this.bossAway) {
      // back to the stage at a run
      const dx = arena.stage.x - this.bossX;
      const dy = arena.stage.y - this.bossY;
      const d = Math.hypot(dx, dy);
      const step = BOSS_HOME_SPEED * Math.max(dt, 0);
      if (d <= step || d < 1) {
        this.bossAway = false;
        boss.setPosition(arena.stage.x, arena.stage.y);
        boss.setFacing(0);
        const st = this.state;
        const alarm = this.hello?.alarm_ms ?? 3000;
        boss.setPhase(st && st.phase === 'open' && st.closes !== null && t !== null && t >= st.closes - alarm ? 'warn' : 'idle');
      } else {
        this.runBoss(boss, this.bossX + (dx / d) * step, this.bossY + (dy / d) * step);
      }
    }
  }

  private runBoss(boss: Boss, x: number, y: number): void {
    const dx = x - this.bossX;
    const dy = y - this.bossY;
    if (dx * dx + dy * dy > 0.25) boss.setFacing(Math.atan2(dx, dy));
    if (boss.phase !== 'chase' && boss.phase !== 'roar') boss.setPhase('chase');
    this.bossX = x;
    this.bossY = y;
    boss.setPosition(x, y);
  }

  /** «Дедлайн» caught a character: it roars, the character is thrown (the room moves it) with a hit pose. */
  private onCaught(id: number): void {
    this.hud.cue('caught');
    this.boss?.setPhase('roar');
    this.actors.get(id)?.player?.setPose('hit');
  }

  private stomp(qi: number, now: number): void {
    if (!this.boss) return;
    this.stompedQi = qi;
    this.boss.setPhase('stomp');
    this.impactAt = now + this.boss.stompImpactS;
    this.impactCued = false;
    this.hud.cue('stomp');
  }

  /**
   * One character in this frame (kit seconds: `now` before the kit's update, `at` when it is drawn); its model is made
   * here the first time the room places it.
   */
  private place(a: Actor, pose: Pose, dt: number, now: number, at: number, arena: Arena): void {
    a.seen = this.frameNo;
    a.flags = pose.flags;
    let p = a.player;
    if (!p) {
      if (!this.kit) return;
      p = a.player = this.kit.createPlayer(a.look, a.name);
      a.x = pose.x;
      a.y = pose.y;
      p.setPosition(pose.x, pose.y, 0);
    }
    const f = a.fall;
    if (this.options.mixed) this.ice(a, p, pose.flags, now, at, !f && (pose.flags & F_GHOST) === 0);
    if (f) {
      const ff = fallFrame(f, at);
      if (ff.pit) {
        // held where it stood; drops with its tile (or by itself when the tile stays: a phone that went away)
        p.setGhost(false);
        p.setPosition(f.x, f.y, ff.z);
        p.setPose(ff.falling ? 'fall' : 'idle');
        a.x = f.x;
        a.y = f.y;
        return;
      }
      // out of the pit as a ghost, sliding to where the room has it now
      const k = ff.climb;
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
    // a frame the room's `up` waits for shows the moment before it: the room has everyone moving again, but whoever
    // stood stays where it stood (not walking over the gap still drawn)
    const hold = this.floorShow.waits && a.placed;
    const px = hold ? a.x : pose.x;
    const py = hold ? a.y : pose.y;
    const dx = px - a.x;
    const dy = py - a.y;
    const d = Math.hypot(dx, dy);
    if (!a.placed || d > 120) {
      a.placed = true;
      a.speed = 0;
    } else if (dt > 0) {
      const inst = d / dt;
      a.speed += (inst - a.speed) * Math.min(1, dt * 12);
      if (d > 0.4) p.setFacing(Math.atan2(dx, dy));
    }
    a.x = px;
    a.y = py;
    const ghost = (pose.flags & F_GHOST) !== 0;
    p.setGhost(ghost);
    p.setAway((pose.flags & F_AWAY) !== 0);
    const z = ghost ? 0 : arena.floorAt(a.x, a.y, at);
    p.setPosition(a.x, a.y, z);
    if (!ghost && z < -4) p.setPose('fall');
    else if (at >= a.cheerFrom && at < a.cheerUntil && a.speed < RUN_SPEED) p.setPose('cheer');
    // in ice a character slides, it does not run
    else p.setPose(a.speed > RUN_SPEED && !a.iced ? 'run' : 'idle');
  }

  /**
   * A mixed game's ice (F_ICE: frozen in the battle). It forms only on a character in sight (the fallen get theirs
   * when they are back with the floor) and breaks on the right zone at the boss's blow, not before it. Changes while
   * the arena was away (the button questions) are shown as they are.
   */
  private ice(a: Actor, p: Player, flags: number, now: number, at: number, visible: boolean): void {
    const want = (flags & F_ICE) !== 0;
    if (want === a.iced) return;
    if (!a.placed || now - this.resumedAt < 0.3) {
      a.iced = want;
      p.setIce(want, true);
      return;
    }
    if (want) {
      if (!visible) return;
      this.froze = true;
    } else {
      if (Number.isFinite(this.impactAt) && at < this.impactAt + 0.25) return;
      this.thawed = true;
    }
    a.iced = want;
    p.setIce(want);
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
    let same = s.alive === sh.alive && s.ghosts === sh.ghosts && s.iced === sh.iced && zones === sh.zones;
    for (let i = 0; same && i < zones; i++) if (s.counts[i] !== sh.counts[i]) same = false;
    if (same) return;
    sh.alive = s.alive;
    sh.ghosts = s.ghosts;
    sh.iced = s.iced;
    sh.zones = zones;
    for (let i = 0; i < zones; i++) sh.counts[i] = s.counts[i];
    this.hud.tally(s.counts.slice(0, zones), s.alive, s.ghosts, s.iced);
  }
}
