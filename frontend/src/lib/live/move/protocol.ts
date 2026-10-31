/**
 * The movement games' wire format (docs/live/MOVE.md; the server is backend/live_move.py and live_move_api.py).
 * Binary frames, little-endian: the phone's input (type 2) and the server's snapshot (type 1). Everything else is JSON
 * text.
 */
import type { MapJson } from './sim';

export const PROTOCOL_VERSION = 1;
export const WS_PATH = '/api/live/move/ws';

export const MSG_SNAPSHOT = 1;
export const MSG_INPUT = 2;
export const MAX_CMDS_PER_MSG = 4;

export const KIND_PLAYER = 0;
export const KIND_NPC = 1;
export const F_AWAY = 1 << 2;
export const F_FROZEN = 1 << 3;
export const F_CAUGHT = 1 << 4;
/** Mode A «Встань на ответ»: the character fell and floats as a ghost. Bits 5–7 belong to the modes. */
export const F_GHOST = 1 << 5;
/**
 * A battle with movement rounds (docs/live/MODE_MIXED.md): the character is frozen in the battle (a wrong answer, or
 * none from phase 1) — draw it with ice; standing on the right zone thaws it. Only in a mixed room.
 */
export const F_ICE = 1 << 6;
export const ZONE_SHIFT = 8;

const SNAP_HEAD = 16; // type u8, version u8, count u16, tick u32, t_ms u32, ack u32
const SNAP_ENT = 8; // id u16, x u16, y u16, flags u16
const INPUT_HEAD = 6; // type u8, count u8, first seq u32

/** One tick of the phone's joystick: axes are signed bytes (-127…127); seqs are consecutive within a connection. */
export interface Command {
  seq: number;
  jx: number;
  jy: number;
  buttons: number;
}

export interface Entity {
  id: number;
  x: number;
  y: number;
  flags: number;
}

/** A snapshot with positions in map units (the wire's integers divided by `q`). */
export interface Snapshot {
  tick: number;
  /** Server time of this tick, ms since the room opened (tick × 1000 / hz). */
  t: number;
  /** The last of this phone's commands the server applied (0 for the host). */
  ack: number;
  ents: Entity[];
}

/** [id, kind, live_players.id or null, name (a monster: its kind), look or null] */
export type RosterEntry = [number, number, string | null, string, unknown];

export interface Welcome {
  t: 'welcome';
  v: number;
  role: 'player' | 'host';
  tick: number;
  ms: number;
  hz: number;
  snap: number;
  q: number;
  speed: number;
  r: number;
  npc_r: number;
  map: MapJson;
  roster: RosterEntry[];
  frozen: boolean;
  you?: number;
  pid?: string;
  resumed?: boolean;
}

export interface RoomStats {
  t: 'stats';
  tick: number;
  players: number;
  connected: number;
  hosts: number;
  npcs: number;
  late_ms: { p50: number; p99: number; max: number };
  work_ms: { p50: number; p99: number; max: number };
  samples: number;
  overruns: number;
  snaps_skipped: number;
  dropped_msgs: number;
  dropped_cmds: number;
  bytes_out: number;
  rooms: number;
  sockets: number;
  /** The room's game mode ('stand', 'mixed'), or null for the plain room. */
  mode?: string | null;
}

// ─────────────── Mode A «Встань на ответ» (docs/live/MODE_STAND.md) ───────────────

export type BossKind = 'clock' | 'skeleton';
export type StandPhase = 'lobby' | 'countdown' | 'open' | 'reveal' | 'leaderboard' | 'podium' | 'ended';

/** Zone index = option index; these are only the labels drawn on the floor. Match zones by index, never by id. */
export const STAND_LETTERS = ['А', 'Б', 'В', 'Г', 'Д', 'Е'] as const;

/** The arena (the server sends the same map in its welcome): contracts/live/stand_arena.json. */
export const STAND_ARENA: MapJson = {
  w: 1600,
  h: 900,
  solids: [
    { rect: [0, 0, 1600, 160] },
    { rect: [0, 160, 20, 740] },
    { rect: [1580, 160, 20, 740] },
    { rect: [0, 880, 1600, 20] },
    { circle: [800, 520, 80] },
  ],
  zones: [
    { id: 'А', rect: [80, 220, 420, 240] },
    { id: 'Б', rect: [1100, 220, 420, 240] },
    { id: 'В', rect: [80, 580, 420, 240] },
    { id: 'Г', rect: [1100, 580, 420, 240] },
    { id: 'Д', rect: [560, 220, 480, 180] },
    { id: 'Е', rect: [560, 640, 480, 180] },
  ],
  spawns: [
    [560, 520],
    [1040, 520],
    [300, 520],
    [1300, 520],
  ],
  npc_spawns: [[800, 520]],
};

/** The floor that drops: tiles of `tile` from (x, y), `cols` × `rows`. */
export interface StandFloor {
  x: number;
  y: number;
  tile: number;
  cols: number;
  rows: number;
}

/** Once after every welcome (a reconnect too). */
export interface StandHello {
  t: 'stand';
  k: 'hello';
  v: number;
  boss: BossKind;
  q_count: number;
  time_s: number;
  speed: boolean;
  /** The boss's stage: a solid circle [x, y, r] of the map. */
  stage: [number, number, number];
  floor: StandFloor;
  letters: string[];
  /** The last ms before `closes` when the alarm shakes (client only). */
  alarm_ms: number;
  /** How long a character falls (the server holds it still meanwhile). */
  fall_ms: number;
  /** How long the floor stays down after the stomp. */
  floor_ms: number;
  /** A mixed room only (MODE_MIXED.md): N and the qi of every movement round. */
  mixed?: { every: number; rounds: number[] };
}

export interface StandQuestion {
  text: string;
  options: string[];
  /** Several right zones: how many (the boards say «встаньте на любой»); absent for one. */
  multi?: number;
  /** A number question played as ranges (20261102090200_live_ranges.sql): the options are ranges; its unit. */
  ranges?: true;
  unit?: string;
}

/** A range round's true value (20261102090200_live_ranges.sql): the accepted numbers, the tolerance, the unit. */
export interface StandNumber {
  forms: string[];
  tolerance: number | null;
  unit: string | null;
}

/** A closed question (only in `reveal`). Entity ids are the snapshot ids. */
export interface StandResult {
  qi: number;
  /** The right option = the zone that stays. */
  key: number;
  /** A question of several right answers: every right zone (they all stay up; standing on any is right). */
  keys?: number[];
  /** A number question played as ranges: the true value the boards show inside the right range. */
  num?: StandNumber;
  /** Answers per zone (ghosts too), length = options. */
  counts: number[];
  /** Alive players on the right zone («Устояли N из M»). */
  stood: number;
  /** Players of this question. */
  of: number;
  /** The alive player who got onto the right zone first. */
  fastest: { id: number | null; pts: number; ms: number | null } | null;
  /** Characters that fall at this stomp (play the fall for each, wherever it stands). */
  fell: number[];
  /** Characters that come back to life when the floor returns. */
  back: number[];
  /** Room ms of the stomp and of the floor's return. */
  at: number;
  back_at: number;
  /** Host only: [entity id, points] of every scorer (a mixed room: [entity id, damage] of every hit). */
  pts?: Array<[number, number]>;
  // A mixed room only (MODE_MIXED.md §4): `fell` is everyone off the right zone and `back` the same characters (nobody
  // stays a ghost), `stood` the right answers (hits and thaws), `of` the players of the question.
  /** Characters whose ice broke (frozen before, on the right zone). */
  thawed?: number[];
  /** Characters frozen now (a wrong zone, or none). */
  froze?: number[];
  /** The boss after this round (the battle's HP), its phase, and whether it fell. */
  hp?: number;
  hp_max?: number;
  phase?: number;
  defeated?: boolean;
  /** HP the boss healed back after this round (phase 2), and the phase it entered (or null). */
  healed?: number;
  phase_changed?: number | null;
  /** The room never wrote this round (closed by time): nobody fell, nothing changed. */
  void?: boolean;
  /** Host only: [entity id, damage, the boss's HP after it] in the order the hits land. */
  hits?: Array<[number, number, number]>;
}

export interface StandTopEntry {
  /** The character's entity id when it is in the room. */
  id: number | null;
  name: string;
  look: unknown;
  pts: number;
  move: number;
}

/** The whole picture: after `hello` and on every change. Times are room ms (the snapshot clock, `serverNow()`). */
export interface StandState {
  t: 'stand';
  k: 'state';
  phase: StandPhase;
  qi: number;
  q_count: number;
  players: number;
  q: StandQuestion | null;
  opens: number | null;
  closes: number | null;
  floor: 'up' | 'down';
  res: StandResult | null;
  top: StandTopEntry[] | null;
  /** Podium: right answers in % of all asked. */
  acc: number | null;
  /**
   * A mixed room only: the kind of the current question — 'stand' (a movement round: `q`, `opens`, `closes`, `res`
   * are its own), 'tap' (a button question: the phone reads it from live_state; `q` is null), null in the lobby. The
   * arena is on only while `round` is 'stand' and `phase` is countdown, open or reveal (`arenaLive`).
   */
  round?: 'stand' | 'tap' | null;
  /**
   * Mode B «Убеги от Дедлайна» (MODE_RUN.md): this movement round «Дедлайн» leaves its stage and hunts the class
   * (the room's NPC entities, kind 1) until 2 s before zero. False outside a question.
   */
  chase?: boolean;
  /** Catches in this round so far (a chase round). */
  caught?: number;
}

export interface StandLast {
  qi: number;
  /** The zone (option) the player stood in, or null. */
  choice: number | null;
  ok: boolean;
  pts: number;
  ms: number | null;
  fell: boolean;
  revived: boolean;
  /** Joined after the question opened: it did not count. */
  late: boolean;
  /** A mixed room only: frozen before and on the right zone (no damage, the ice breaks). */
  thawed?: boolean;
  /** A mixed room only: frozen now (a wrong zone, or none). */
  froze?: boolean;
  /** A mixed room only: the room never wrote this round; nothing counted. */
  void?: boolean;
}

/**
 * Phones only: the player's own numbers. In a mixed room (after each movement round only) `pts` are the battle's
 * points (damage), `last.pts` this round's damage, `ghost` is always false and `frozen` is the battle's freeze.
 */
export interface StandMe {
  t: 'stand';
  k: 'me';
  ghost: boolean;
  /** A mixed room only: frozen in the battle after this round. */
  frozen?: boolean;
  pts: number;
  streak: number;
  best: number;
  right: number;
  place: number | null;
  of: number;
  last: StandLast | null;
}

export type StandMessage = StandHello | StandState | StandMe;

const STAND_PHASES: ReadonlySet<string> = new Set(['lobby', 'countdown', 'open', 'reveal', 'leaderboard', 'podium', 'ended']);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isNumOrNull = (v: unknown): boolean => v === null || isNum(v);

/** A stand message with the fields a screen relies on, or null (an unknown or broken one is ignored). */
export function parseStand(obj: unknown): StandMessage | null {
  if (!obj || typeof obj !== 'object') return null;
  const m = obj as Record<string, unknown>;
  if (m.t !== 'stand') return null;
  if (m.k === 'hello') {
    if (m.mixed !== undefined) {
      const x = m.mixed as { every?: unknown; rounds?: unknown } | null;
      if (!x || typeof x !== 'object' || !isNum(x.every) || !Array.isArray(x.rounds) || !x.rounds.every(isNum)) return null;
    }
    return isNum(m.q_count) && isNum(m.time_s) && (m.boss === 'clock' || m.boss === 'skeleton') && Array.isArray(m.stage)
      ? (m as unknown as StandHello)
      : null;
  }
  if (m.k === 'state') {
    if (typeof m.phase !== 'string' || !STAND_PHASES.has(m.phase) || !isNum(m.qi) || !isNumOrNull(m.opens) || !isNumOrNull(m.closes))
      return null;
    if (m.floor !== 'up' && m.floor !== 'down') return null;
    if (m.round !== undefined && m.round !== null && m.round !== 'stand' && m.round !== 'tap') return null;
    if ((m.chase !== undefined && typeof m.chase !== 'boolean') || (m.caught !== undefined && !isNum(m.caught))) return null;
    if (m.q !== null && (typeof m.q !== 'object' || !Array.isArray((m.q as StandQuestion).options))) return null;
    if (m.res !== null) {
      const r = m.res as Partial<StandResult> | undefined;
      if (!r || !isNum(r.key) || !Array.isArray(r.fell) || !Array.isArray(r.back) || !isNum(r.back_at)) return null;
      if (r.void !== undefined && typeof r.void !== 'boolean') return null;
      if (r.keys !== undefined && (!Array.isArray(r.keys) || !r.keys.every(isNum))) return null;
      if (r.num !== undefined && (!r.num || typeof r.num !== 'object' || !Array.isArray(r.num.forms))) return null;
      if (r.hp !== undefined && r.hp !== null && !isNum(r.hp)) return null;
      if ((r.thawed !== undefined && !Array.isArray(r.thawed)) || (r.froze !== undefined && !Array.isArray(r.froze))) return null;
    }
    return m as unknown as StandState;
  }
  if (m.k === 'me') {
    return isNum(m.pts) && typeof m.ghost === 'boolean' ? (m as unknown as StandMe) : null;
  }
  return null;
}

/** The option a character stands on (from its snapshot flags), or null in a corridor. */
export const zoneOption = (flags: number): number | null => {
  const z = flags >> ZONE_SHIFT;
  return z === 0 ? null : z - 1;
};
export const isGhost = (flags: number): boolean => (flags & F_GHOST) !== 0;
/** A mixed room: the character is frozen in the battle (draw the ice). */
export const isIced = (flags: number): boolean => (flags & F_ICE) !== 0;

/**
 * Whether the arena is on screen: a stand room always (its lobby is a run-around too); a mixed room only during a
 * movement round's countdown, open and reveal — between them it sends no snapshots, only this state and pongs.
 */
export function arenaLive(state: StandState | null): boolean {
  if (!state) return false;
  if (state.round === undefined) return true;
  return state.round === 'stand' && (state.phase === 'countdown' || state.phase === 'open' || state.phase === 'reveal');
}

/**
 * The points of a right answer (MODE_STAND.md §6), as the database computes them — for a preview only («до +1000»);
 * the server's `me.last.pts` is the result.
 */
export function standPoints(elapsedMs: number, timeS: number, streakAfter: number, speed: boolean, ghost: boolean): number {
  const t = timeS * 1000;
  const early = speed ? Math.max(0, 1 - Math.min(Math.max(elapsedMs, 0), t) / t) : 1;
  const base = 500 + 500 * early;
  const mult = ghost ? 0.5 : 1 + 0.1 * Math.min(Math.max(streakAfter - 1, 0), 4);
  return 10 * Math.floor((base * mult) / 10 + 0.5);
}

export type ServerEvent =
  | { t: 'add'; e: RosterEntry }
  | { t: 'del'; id: number }
  | { t: 'map'; map: MapJson }
  | { t: 'freeze'; on: boolean }
  | { t: 'ev'; k: string; id: number; by?: number }
  | { t: 'say'; data: unknown }
  | { t: 'pong'; c: number | null; tick: number; ms: number }
  | { t: 'zones'; tick: number; z: Record<string, number[]> }
  | { t: 'err'; code: string; why?: string }
  | RoomStats
  | StandMessage;

/** Host commands (docs/live/MOVE.md §Host commands). */
export type HostCommand =
  | { op: 'npc'; on: boolean; n?: number; kind?: string }
  | { op: 'freeze'; on: boolean }
  | { op: 'map'; map: MapJson }
  | { op: 'respawn' }
  | { op: 'kick'; pid: string }
  | { op: 'say'; data: unknown }
  | { op: 'zones' }
  | { op: 'stats' }
  | { op: 'end' }
  /** After every live_next, live_kick and live_end: the room reads the game's state at once (MODE_STAND.md §2). */
  | { op: 'sync' };

/** Close codes of the server (live_move_api.py). */
export const CLOSE = {
  ROOM_CLOSED: 4000,
  REPLACED: 4001,
  BAD_REQUEST: 4400,
  BAD_TOKEN: 4401,
  FORBIDDEN: 4403,
  NO_ROOM: 4404,
  TIMEOUT: 4408,
  FULL: 4409,
  ENDED: 4410,
  SLOW_DOWN: 4429,
  UNAVAILABLE: 4503,
  TOO_BIG: 1009,
} as const;

const FINAL: ReadonlySet<number> = new Set([
  CLOSE.ROOM_CLOSED,
  CLOSE.REPLACED,
  CLOSE.BAD_REQUEST,
  CLOSE.BAD_TOKEN,
  CLOSE.FORBIDDEN,
  CLOSE.FULL,
  CLOSE.ENDED,
  CLOSE.TOO_BIG,
]);

/** Whether a close is worth reconnecting after (network drops, no room yet, busy, Supabase down). */
export function retryable(code: number): boolean {
  return !FINAL.has(code);
}

/** An input frame of consecutive commands (1…4). */
export function encodeInput(cmds: readonly Command[]): ArrayBuffer {
  if (cmds.length < 1 || cmds.length > MAX_CMDS_PER_MSG) throw new RangeError('1-4 commands a frame');
  const buf = new ArrayBuffer(INPUT_HEAD + 3 * cmds.length);
  const v = new DataView(buf);
  v.setUint8(0, MSG_INPUT);
  v.setUint8(1, cmds.length);
  v.setUint32(2, cmds[0].seq, true);
  cmds.forEach((c, i) => {
    if (c.seq !== cmds[0].seq + i) throw new RangeError('seqs must be consecutive');
    v.setInt8(INPUT_HEAD + 3 * i, c.jx);
    v.setInt8(INPUT_HEAD + 3 * i + 1, c.jy);
    v.setUint8(INPUT_HEAD + 3 * i + 2, c.buttons);
  });
  return buf;
}

/** A snapshot frame, or null when it is not one this client understands. */
export function decodeSnapshot(buf: ArrayBuffer, q: number): Snapshot | null {
  if (buf.byteLength < SNAP_HEAD) return null;
  const v = new DataView(buf);
  if (v.getUint8(0) !== MSG_SNAPSHOT || v.getUint8(1) !== PROTOCOL_VERSION) return null;
  const n = v.getUint16(2, true);
  if (buf.byteLength !== SNAP_HEAD + SNAP_ENT * n) return null;
  const ents: Entity[] = new Array(n);
  for (let i = 0, off = SNAP_HEAD; i < n; i++, off += SNAP_ENT) {
    ents[i] = { id: v.getUint16(off, true), x: v.getUint16(off + 2, true) / q, y: v.getUint16(off + 4, true) / q, flags: v.getUint16(off + 6, true) };
  }
  return { tick: v.getUint32(4, true), t: v.getUint32(8, true), ack: v.getUint32(12, true), ents };
}

/** A snapshot frame as the server writes it (tests, an offline fake server): positions × q, rounded half up. */
export function encodeSnapshot(s: Snapshot, q: number): ArrayBuffer {
  const buf = new ArrayBuffer(SNAP_HEAD + SNAP_ENT * s.ents.length);
  const v = new DataView(buf);
  const wire = (n: number) => Math.min(65535, Math.max(0, Math.floor(n * q + 0.5)));
  v.setUint8(0, MSG_SNAPSHOT);
  v.setUint8(1, PROTOCOL_VERSION);
  v.setUint16(2, s.ents.length, true);
  v.setUint32(4, s.tick, true);
  v.setUint32(8, s.t, true);
  v.setUint32(12, s.ack, true);
  s.ents.forEach((e, i) => {
    const off = SNAP_HEAD + SNAP_ENT * i;
    v.setUint16(off, e.id, true);
    v.setUint16(off + 2, wire(e.x), true);
    v.setUint16(off + 4, wire(e.y), true);
    v.setUint16(off + 6, e.flags, true);
  });
  return buf;
}

export const kindOf = (flags: number): number => flags & 3;
/** 1 + the index of the map zone the entity stands in, 0 for none. */
export const zoneOf = (flags: number): number => flags >> ZONE_SHIFT;

/** Every zone that stays up at a round's stomp: `keys` of a question of several right answers, else the one `key`. */
export function resKeys(res: Pick<StandResult, 'key' | 'keys'> | null | undefined): number[] {
  if (!res) return [];
  return Array.isArray(res.keys) && res.keys.length > 0 ? res.keys : [res.key];
}
