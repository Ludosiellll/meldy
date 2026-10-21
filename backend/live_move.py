"""Live movement games: the room's simulation core (no I/O, no clock of its own).

Each student moves a character on a shared map from their phone; the teacher's projector shows everyone. The server
is authoritative: phones send joystick COMMANDS, the room integrates them at a fixed tick and sends compact
SNAPSHOTS. The transport (WebSocket, auth, timers) is ``live_move_api.py``; the browser side is
``frontend/src/lib/live/move/``. The protocol is ``docs/live/MOVE.md``.

Determinism (what client prediction relies on): one command = one tick of movement. The client makes commands on
its own fixed clock of ``TICK_HZ`` (sending them in batches at ~15 Hz), the room applies exactly one queued command
per player per tick (two when the queue is long), and every snapshot acks the last applied command's seq. The phone
replays its unacked commands through the same ``move_circle`` (``sim.ts``) and lands where the server will.
Both sides compute in IEEE doubles in the same order; ``contracts/live/move_cases.json`` holds shared cases.

Units: map units (the reference map is 1600 × 900, the projector's 16:9). Positions go out as
``floor(x * Q + 0.5)`` in unsigned 16 bits, so a map is at most ``MAX_MAP_SIDE`` units on a side.
"""

from __future__ import annotations

import math
import struct
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Iterable

PROTOCOL_VERSION = 1

TICK_HZ = 20                 # simulation steps a second (one command each)
SNAP_EVERY = 2               # a snapshot every 2nd tick: 10 Hz
Q = 10                       # wire positions are 1/Q units
MAX_MAP_SIDE = 6000          # 6000 * Q fits in u16

PLAYER_R = 18.0
PLAYER_SPEED = 260.0         # units a second (the 1600-wide map in ~6 s)
NPC_R = 26.0
NPC_SPEED = 190.0            # a bit slower than a player: a monster can be escaped

MAX_PLAYERS = 60
MAX_NPCS = 8
MAX_CMDS_PER_MSG = 4         # one message carries at most 4 commands (200 ms)
CMD_QUEUE_MAX = 8            # queued commands beyond this drop the oldest (their seq is still acked)
CATCH_UP_ABOVE = 4           # more queued commands than this: two are applied in one tick
AXIS_MAX = 127               # joystick axes are signed bytes, -127..127
CATCH_TICKS = 40             # a caught player stays caught (and frozen) for 2 s

# Binary frames: the first byte is the type.
MSG_SNAPSHOT = 1
MSG_INPUT = 2

# Entity flags (u16): bits 0-1 kind, then states; bits 8-15 the zone the entity stands in (index + 1, 0 = none).
KIND_PLAYER = 0
KIND_NPC = 1
F_AWAY = 1 << 2              # the player's phone is not connected
F_FROZEN = 1 << 3            # commands are acked but do not move (mode freeze, caught)
F_CAUGHT = 1 << 4            # touched by a monster (the default catch hook)
ZONE_SHIFT = 8

_SNAP_HEAD = struct.Struct("<BBHII")   # type, version, entity count, tick, t_ms (12 bytes)
_SNAP_ACK = struct.Struct("<I")        # per connection: the last applied command seq (0 for the host)
_INPUT_HEAD = struct.Struct("<BBI")    # type, command count, first seq (6 bytes) + count × (i8 jx, i8 jy, u8 buttons)

assert PLAYER_SPEED / TICK_HZ < PLAYER_R and NPC_SPEED / TICK_HZ < NPC_R, "one step must be shorter than a radius"


# ─────────────────────────────────────────── Map ───────────────────────────────────────────


class MapError(ValueError):
    """A map that cannot be played (the message names the field)."""


@dataclass(frozen=True)
class Rect:
    x: float
    y: float
    w: float
    h: float

    def contains(self, x: float, y: float) -> bool:
        return self.x <= x <= self.x + self.w and self.y <= y <= self.y + self.h


@dataclass(frozen=True)
class Circle:
    x: float
    y: float
    r: float

    def contains(self, x: float, y: float) -> bool:
        dx = x - self.x
        dy = y - self.y
        return dx * dx + dy * dy <= self.r * self.r


@dataclass(frozen=True)
class Zone:
    id: str
    shape: Rect | Circle


@dataclass(frozen=True)
class GameMap:
    w: float
    h: float
    rects: tuple[Rect, ...] = ()
    circles: tuple[Circle, ...] = ()
    zones: tuple[Zone, ...] = ()
    spawns: tuple[tuple[float, float], ...] = ()
    npc_spawns: tuple[tuple[float, float], ...] = ()

    def to_json(self) -> dict[str, Any]:
        """The map as clients get it (welcome, map change): the same shape parse_map reads."""

        def shape(s: Rect | Circle) -> dict[str, list[float]]:
            return {"rect": [s.x, s.y, s.w, s.h]} if isinstance(s, Rect) else {"circle": [s.x, s.y, s.r]}

        return {
            "w": self.w,
            "h": self.h,
            "solids": [shape(s) for s in self.rects] + [shape(s) for s in self.circles],
            "zones": [{"id": z.id, **shape(z.shape)} for z in self.zones],
            "spawns": [list(p) for p in self.spawns],
            "npc_spawns": [list(p) for p in self.npc_spawns],
        }

    def zone_index(self, x: float, y: float) -> int:
        """1 + the index of the first zone containing the point, or 0."""
        for i, z in enumerate(self.zones):
            if z.shape.contains(x, y):
                return i + 1
        return 0


def _num(value: Any, what: str, lo: float, hi: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise MapError(f"{what}: not a number")
    if not lo <= value <= hi:
        raise MapError(f"{what}: out of range")
    return float(value)


def _shape(obj: Any, what: str, w: float, h: float) -> Rect | Circle:
    if not isinstance(obj, dict):
        raise MapError(f"{what}: not an object")
    if "rect" in obj:
        v = obj["rect"]
        if not isinstance(v, list) or len(v) != 4:
            raise MapError(f"{what}.rect: [x, y, w, h]")
        return Rect(_num(v[0], what, -w, w), _num(v[1], what, -h, h), _num(v[2], what, 1, 2 * w), _num(v[3], what, 1, 2 * h))
    if "circle" in obj:
        v = obj["circle"]
        if not isinstance(v, list) or len(v) != 3:
            raise MapError(f"{what}.circle: [x, y, r]")
        return Circle(_num(v[0], what, -w, w), _num(v[1], what, -h, h), _num(v[2], what, 1, max(w, h)))
    raise MapError(f"{what}: rect or circle")


def _points(value: Any, what: str, w: float, h: float, limit: int) -> tuple[tuple[float, float], ...]:
    if value is None:
        return ()
    if not isinstance(value, list) or len(value) > limit:
        raise MapError(f"{what}: a list of at most {limit} points")
    out = []
    for i, p in enumerate(value):
        if not isinstance(p, list) or len(p) != 2:
            raise MapError(f"{what}[{i}]: [x, y]")
        out.append((_num(p[0], what, 0, w), _num(p[1], what, 0, h)))
    return tuple(out)


def parse_map(obj: Any) -> GameMap:
    """A map from its JSON (docs/live/MOVE.md §Map). Limits keep a tick cheap: 64 solids, 16 zones, 64 spawns."""
    if not isinstance(obj, dict):
        raise MapError("map: not an object")
    w = _num(obj.get("w"), "w", 200, MAX_MAP_SIDE)
    h = _num(obj.get("h"), "h", 200, MAX_MAP_SIDE)
    solids = obj.get("solids") or []
    zones = obj.get("zones") or []
    if not isinstance(solids, list) or len(solids) > 64:
        raise MapError("solids: a list of at most 64")
    if not isinstance(zones, list) or len(zones) > 16:
        raise MapError("zones: a list of at most 16")
    rects: list[Rect] = []
    circles: list[Circle] = []
    for i, s in enumerate(solids):
        shape = _shape(s, f"solids[{i}]", w, h)
        (rects if isinstance(shape, Rect) else circles).append(shape)
    parsed_zones = []
    for i, z in enumerate(zones):
        zid = z.get("id") if isinstance(z, dict) else None
        if not isinstance(zid, str) or not 1 <= len(zid) <= 16:
            raise MapError(f"zones[{i}].id: 1-16 characters")
        parsed_zones.append(Zone(zid, _shape(z, f"zones[{i}]", w, h)))
    spawns = _points(obj.get("spawns"), "spawns", w, h, 64) or ((w / 2, h / 2),)
    npc_spawns = _points(obj.get("npc_spawns"), "npc_spawns", w, h, 16) or ((w / 2, PLAYER_R + NPC_R),)
    return GameMap(w, h, tuple(rects), tuple(circles), tuple(parsed_zones), spawns, npc_spawns)


def default_map() -> GameMap:
    """The reference map: 1600 × 900, four answer zones in the corners, a few pillars, spawn in the middle."""
    return parse_map({
        "w": 1600, "h": 900,
        "solids": [
            {"rect": [380, 250, 60, 400]}, {"rect": [1160, 250, 60, 400]},
            {"rect": [640, 120, 320, 40]}, {"rect": [640, 740, 320, 40]},
            {"circle": [800, 450, 50]},
        ],
        "zones": [
            {"id": "A", "rect": [0, 0, 300, 220]}, {"id": "B", "rect": [1300, 0, 300, 220]},
            {"id": "C", "rect": [0, 680, 300, 220]}, {"id": "D", "rect": [1300, 680, 300, 220]},
        ],
        "spawns": [[800, 330], [800, 570], [680, 450], [920, 450]],
        "npc_spawns": [[800, 60]],
    })


# ─────────────────────────────────────────── Movement (mirrored in sim.ts) ───────────────────────────────────────────


def _push_rect(x: float, y: float, r: float, rc: Rect) -> tuple[float, float]:
    cx = min(max(x, rc.x), rc.x + rc.w)
    cy = min(max(y, rc.y), rc.y + rc.h)
    dx = x - cx
    dy = y - cy
    d2 = dx * dx + dy * dy
    if d2 >= r * r:
        return x, y
    if d2 > 0:
        d = math.sqrt(d2)
        k = (r - d) / d
        return x + dx * k, y + dy * k
    # The centre is inside the rectangle: out through the nearest side (ties: left, right, top, bottom).
    left = x - rc.x
    right = rc.x + rc.w - x
    top = y - rc.y
    bottom = rc.y + rc.h - y
    m = min(left, right, top, bottom)
    if m == left:
        return rc.x - r, y
    if m == right:
        return rc.x + rc.w + r, y
    if m == top:
        return x, rc.y - r
    return x, rc.y + rc.h + r


def _push_circle(x: float, y: float, r: float, c: Circle) -> tuple[float, float]:
    dx = x - c.x
    dy = y - c.y
    rr = r + c.r
    d2 = dx * dx + dy * dy
    if d2 >= rr * rr:
        return x, y
    if d2 > 0:
        d = math.sqrt(d2)
        k = (rr - d) / d
        return x + dx * k, y + dy * k
    return x, c.y - rr


def _clamp(v: float, lo: float, hi: float) -> float:
    return lo if v < lo else hi if v > hi else v


def move_circle(m: GameMap, x: float, y: float, dx: float, dy: float, r: float) -> tuple[float, float]:
    """A circle of radius r moved by (dx, dy): pushed out of every solid (two passes, rectangles then circles, in map
    order) and kept inside the map. A step shorter than r cannot pass through a solid."""
    x += dx
    y += dy
    for _ in range(2):
        for rc in m.rects:
            x, y = _push_rect(x, y, r, rc)
        for c in m.circles:
            x, y = _push_circle(x, y, r, c)
    return _clamp(x, r, m.w - r), _clamp(y, r, m.h - r)


def axis_vector(jx: int, jy: int) -> tuple[float, float]:
    """A joystick of signed bytes as a vector no longer than 1 (-128 counts as -127)."""
    vx = max(-AXIS_MAX, min(AXIS_MAX, jx)) / AXIS_MAX
    vy = max(-AXIS_MAX, min(AXIS_MAX, jy)) / AXIS_MAX
    m2 = vx * vx + vy * vy
    if m2 > 1:
        mag = math.sqrt(m2)
        vx = vx / mag
        vy = vy / mag
    return vx, vy


def step_player(m: GameMap, x: float, y: float, jx: int, jy: int, speed: float = PLAYER_SPEED,
                tick_hz: int = TICK_HZ, r: float = PLAYER_R) -> tuple[float, float]:
    """One command = one tick of movement (the client's prediction runs exactly this)."""
    vx, vy = axis_vector(jx, jy)
    step = speed / tick_hz
    return move_circle(m, x, y, vx * step, vy * step, r)


def apply_command(m: GameMap, x: float, y: float, jx: int, jy: int, tick_hz: int = TICK_HZ) -> tuple[float, float]:
    """A command as the room applies it: a still joystick does not move (nor push) the player."""
    if not jx and not jy:
        return x, y
    return step_player(m, x, y, jx, jy, PLAYER_SPEED, tick_hz)


def quantise(v: float) -> int:
    q = math.floor(v * Q + 0.5)
    return 0 if q < 0 else 65535 if q > 65535 else q


# ─────────────────────────────────────────── Wire: input ───────────────────────────────────────────


class ProtocolError(ValueError):
    """A frame that breaks the protocol (the connection is closed with 4400)."""


def decode_input(data: bytes) -> tuple[int, list[tuple[int, int, int]]]:
    """An input frame → (first seq, [(jx, jy, buttons)]). Raises ProtocolError."""
    if len(data) < _INPUT_HEAD.size + 3:
        raise ProtocolError("input: short")
    kind, n, first = _INPUT_HEAD.unpack_from(data)
    if kind != MSG_INPUT or not 1 <= n <= MAX_CMDS_PER_MSG or len(data) != _INPUT_HEAD.size + 3 * n:
        raise ProtocolError("input: shape")
    if first == 0:
        raise ProtocolError("input: seq starts at 1")
    cmds = []
    off = _INPUT_HEAD.size
    for _ in range(n):
        jx, jy, buttons = struct.unpack_from("<bbB", data, off)
        cmds.append((jx, jy, buttons))
        off += 3
    return first, cmds


def encode_input(first_seq: int, cmds: Iterable[tuple[int, int, int]]) -> bytes:
    """The client's input frame (tests and the load generator; the browser's is protocol.ts)."""
    cmds = list(cmds)
    out = bytearray(_INPUT_HEAD.pack(MSG_INPUT, len(cmds), first_seq))
    for jx, jy, buttons in cmds:
        out += struct.pack("<bbB", jx, jy, buttons)
    return bytes(out)


def decode_snapshot(data: bytes) -> dict[str, Any]:
    """A snapshot frame → {tick, t, ack, ents: [(id, x, y, flags)]} with positions as wire integers (tests, load)."""
    kind, ver, n, tick, t_ms = _SNAP_HEAD.unpack_from(data)
    if kind != MSG_SNAPSHOT or ver != PROTOCOL_VERSION:
        raise ProtocolError("snapshot: type")
    (ack,) = _SNAP_ACK.unpack_from(data, _SNAP_HEAD.size)
    flat = struct.unpack_from(f"<{4 * n}H", data, _SNAP_HEAD.size + _SNAP_ACK.size)
    ents = [tuple(flat[i:i + 4]) for i in range(0, len(flat), 4)]
    return {"tick": tick, "t": t_ms, "ack": ack, "ents": ents}


# ─────────────────────────────────────────── Rate limit ───────────────────────────────────────────


class Bucket:
    """A token bucket: ``rate`` a second, at most ``burst`` saved. The caller passes the time (seconds)."""

    __slots__ = ("rate", "burst", "tokens", "at")

    def __init__(self, rate: float, burst: float, now: float) -> None:
        self.rate = float(rate)
        self.burst = float(burst)
        self.tokens = float(burst)
        self.at = now

    def level(self, now: float) -> float:
        """Tokens saved by now (refilled for the time passed)."""
        if now > self.at:
            self.tokens = min(self.burst, self.tokens + (now - self.at) * self.rate)
            self.at = now
        return self.tokens

    def take(self, now: float, n: float = 1.0) -> bool:
        if self.level(now) >= n:
            self.tokens -= n
            return True
        return False


# ─────────────────────────────────────────── Entities ───────────────────────────────────────────


@dataclass(eq=False)
class Player:
    id: int
    pid: str                      # live_players.id (uuid)
    name: str
    look: Any
    x: float
    y: float
    connected: bool = True
    ack: int = 0                  # last applied command seq of the current connection
    last_rx: int = 0              # last received seq of the current connection (0: none yet)
    buttons: int = 0
    frozen_until: int = 0         # tick until which commands do not move the player
    caught_until: int = 0
    dropped: int = 0              # commands dropped by a full queue
    queue: deque = field(default_factory=deque)

    def new_connection(self) -> None:
        """A (re)connect: the phone starts its seqs again at 1, pending commands of the old socket are gone."""
        self.queue.clear()
        self.ack = 0
        self.last_rx = 0
        self.connected = True


@dataclass(eq=False)
class Npc:
    id: int
    kind: str                     # "chaser" (the stub monster); modes add their own
    x: float
    y: float
    r: float = NPC_R
    speed: float = NPC_SPEED
    target: int = 0               # entity id it is after (0: none)
    paused_until: int = 0


class RoomHooks:
    """Where modes plug in. The default: monsters chase the nearest free player; a catch freezes them for 2 s."""

    def on_tick(self, room: "Room") -> None:
        pass

    def can_chase(self, room: "Room", npc: Npc, p: Player) -> bool:
        return p.connected and room.tick >= p.caught_until

    def on_catch(self, room: "Room", npc: Npc, p: Player) -> None:
        p.caught_until = room.tick + CATCH_TICKS
        p.frozen_until = max(p.frozen_until, room.tick + CATCH_TICKS)
        npc.paused_until = room.tick + CATCH_TICKS // 2
        room.emit({"t": "ev", "k": "caught", "id": p.id, "by": npc.id})


# ─────────────────────────────────────────── Room ───────────────────────────────────────────


class Room:
    """One game's world. Not thread-safe; one event loop drives it (``live_move_api.RoomRunner``)."""

    def __init__(self, game_id: str, game_map: GameMap | None = None, *, tick_hz: int = TICK_HZ,
                 max_players: int = MAX_PLAYERS, hooks: RoomHooks | None = None) -> None:
        self.game_id = game_id
        self.map = game_map or default_map()
        self.tick_hz = tick_hz
        self.max_players = max_players
        self.hooks = hooks or RoomHooks()
        self.tick = 0
        self.players: dict[int, Player] = {}
        self.by_pid: dict[str, Player] = {}
        self.npcs: dict[int, Npc] = {}
        self.frozen_all = False
        self.events: list[dict[str, Any]] = []      # JSON events for everyone, flushed by the runner each tick
        self._next_id = 1
        self._spawned = 0

    # ── membership ──

    def _new_id(self) -> int:
        i = self._next_id
        self._next_id += 1
        if i > 65535:
            raise RuntimeError("entity ids exhausted")
        return i

    def spawn_point(self, k: int) -> tuple[float, float]:
        """The k-th spawn: the map's spawns in turn, each on a golden-angle spiral so players do not stack."""
        sx, sy = self.map.spawns[k % len(self.map.spawns)]
        ring = k // len(self.map.spawns)
        ang = ring * 2.399963229728653
        rad = 2.2 * PLAYER_R * math.sqrt(ring)
        return move_circle(self.map, sx + math.cos(ang) * rad, sy + math.sin(ang) * rad, 0.0, 0.0, PLAYER_R)

    def add_player(self, pid: str, name: str, look: Any) -> tuple[Player, bool]:
        """The player of this live_players id: the same entity again after a reconnect (resumed = True), or a new one.
        Raises OverflowError when the room is full."""
        p = self.by_pid.get(pid)
        if p is not None:
            p.name, p.look = name, look
            p.new_connection()
            return p, True
        if len(self.players) >= self.max_players:
            raise OverflowError("room full")
        x, y = self.spawn_point(self._spawned)
        self._spawned += 1
        p = Player(self._new_id(), pid, name, look, x, y)
        self.players[p.id] = p
        self.by_pid[pid] = p
        self.emit({"t": "add", "e": self.entry(p)})
        return p, False

    def remove_player(self, pid: str) -> Player | None:
        p = self.by_pid.pop(pid, None)
        if p is not None:
            self.players.pop(p.id, None)
            self.emit({"t": "del", "id": p.id})
        return p

    def set_connected(self, p: Player, connected: bool) -> None:
        p.connected = connected
        if not connected:
            p.queue.clear()

    def add_npc(self, kind: str = "chaser") -> Npc:
        if len(self.npcs) >= MAX_NPCS:
            raise OverflowError("too many npcs")
        sx, sy = self.map.npc_spawns[len(self.npcs) % len(self.map.npc_spawns)]
        x, y = move_circle(self.map, sx, sy, 0.0, 0.0, NPC_R)
        n = Npc(self._new_id(), kind, x, y)
        self.npcs[n.id] = n
        self.emit({"t": "add", "e": self.entry(n)})
        return n

    def remove_npcs(self) -> None:
        for nid in list(self.npcs):
            del self.npcs[nid]
            self.emit({"t": "del", "id": nid})

    def set_map(self, game_map: GameMap) -> None:
        """A new map: everyone back to a spawn of it (the map change event goes out first)."""
        self.map = game_map
        self.emit({"t": "map", "map": game_map.to_json()})
        self.respawn()

    def respawn(self) -> None:
        for k, p in enumerate(self.players.values()):
            p.x, p.y = self.spawn_point(k)
        for k, n in enumerate(self.npcs.values()):
            sx, sy = self.map.npc_spawns[k % len(self.map.npc_spawns)]
            n.x, n.y = move_circle(self.map, sx, sy, 0.0, 0.0, n.r)
        self._spawned = len(self.players)

    def entry(self, e: Player | Npc) -> list[Any]:
        """A roster entry: [id, kind, pid, name, look] (an npc: [id, 1, null, its kind, null])."""
        if isinstance(e, Player):
            return [e.id, KIND_PLAYER, e.pid, e.name, e.look]
        return [e.id, KIND_NPC, None, e.kind, None]

    def roster(self) -> list[list[Any]]:
        return [self.entry(p) for p in self.players.values()] + [self.entry(n) for n in self.npcs.values()]

    def emit(self, event: dict[str, Any]) -> None:
        self.events.append(event)

    # ── input ──

    def push_commands(self, p: Player, first_seq: int, cmds: list[tuple[int, int, int]]) -> int:
        """Queue a message's commands (seq first_seq, first_seq + 1, …); seqs already seen are skipped. Returns how
        many were queued. A full queue drops its oldest command, which still counts as applied (acked)."""
        queued = 0
        for i, cmd in enumerate(cmds):
            seq = first_seq + i
            if seq <= p.last_rx:
                continue
            p.last_rx = seq
            p.queue.append((seq, cmd[0], cmd[1], cmd[2]))
            queued += 1
            if len(p.queue) > CMD_QUEUE_MAX:
                old = p.queue.popleft()
                p.ack = old[0]
                p.dropped += 1
        return queued

    # ── the tick ──

    def frozen(self, p: Player) -> bool:
        return self.frozen_all or self.tick < p.frozen_until

    def step(self) -> None:
        """One tick: each player's queued command(s), then the npcs, then the mode's hook."""
        self.tick += 1
        m = self.map
        hz = self.tick_hz
        for p in self.players.values():
            q = p.queue
            if not q:
                continue
            n = 2 if len(q) > CATCH_UP_ABOVE else 1
            frozen = self.frozen(p)
            for _ in range(n):
                if not q:
                    break
                seq, jx, jy, buttons = q.popleft()
                p.ack = seq
                p.buttons = buttons
                if not frozen:
                    p.x, p.y = apply_command(m, p.x, p.y, jx, jy, hz)
        if self.npcs:
            self._npcs_think()
        self.hooks.on_tick(self)

    def _npcs_think(self) -> None:
        hooks = self.hooks
        m = self.map
        for n in self.npcs.values():
            if self.tick < n.paused_until:
                continue
            best: Player | None = None
            best_d2 = math.inf
            for p in self.players.values():
                if not hooks.can_chase(self, n, p):
                    continue
                dx = p.x - n.x
                dy = p.y - n.y
                d2 = dx * dx + dy * dy
                if d2 < best_d2:
                    best, best_d2 = p, d2
            if best is None:
                n.target = 0
                continue
            n.target = best.id
            reach = n.r + PLAYER_R
            if best_d2 <= reach * reach:
                hooks.on_catch(self, n, best)
                continue
            d = math.sqrt(best_d2)
            step = min(n.speed / self.tick_hz, d)
            n.x, n.y = move_circle(m, n.x, n.y, (best.x - n.x) / d * step, (best.y - n.y) / d * step, n.r)
            dx = best.x - n.x
            dy = best.y - n.y
            if dx * dx + dy * dy <= reach * reach:
                hooks.on_catch(self, n, best)

    # ── snapshot ──

    def flags(self, p: Player) -> int:
        f = KIND_PLAYER
        if not p.connected:
            f |= F_AWAY
        if self.frozen(p):
            f |= F_FROZEN
        if self.tick < p.caught_until:
            f |= F_CAUGHT
        return f | (self.map.zone_index(p.x, p.y) << ZONE_SHIFT)

    def t_ms(self) -> int:
        return (self.tick * 1000 // self.tick_hz) & 0xFFFFFFFF

    def snapshot_parts(self) -> tuple[bytes, bytes]:
        """(head, body) of this tick's snapshot; a connection's frame is head + pack_ack(ack) + body."""
        flat: list[int] = []
        for p in self.players.values():
            flat += (p.id, quantise(p.x), quantise(p.y), self.flags(p))
        for n in self.npcs.values():
            flat += (n.id, quantise(n.x), quantise(n.y), KIND_NPC | (self.map.zone_index(n.x, n.y) << ZONE_SHIFT))
        count = len(flat) // 4
        head = _SNAP_HEAD.pack(MSG_SNAPSHOT, PROTOCOL_VERSION, count, self.tick & 0xFFFFFFFF, self.t_ms())
        return head, struct.pack(f"<{len(flat)}H", *flat)

    def zones(self) -> dict[str, list[int]]:
        """Which players stand in each zone now: {zone id: [entity id]} (away players are not counted)."""
        out: dict[str, list[int]] = {z.id: [] for z in self.map.zones}
        for p in self.players.values():
            if p.connected:
                i = self.map.zone_index(p.x, p.y)
                if i:
                    out[self.map.zones[i - 1].id].append(p.id)
        return out


def pack_ack(ack: int) -> bytes:
    return _SNAP_ACK.pack(ack & 0xFFFFFFFF)
