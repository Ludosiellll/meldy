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
  | RoomStats;

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
  | { op: 'end' };

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
