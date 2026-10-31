"""Mode A «Встань на ответ» on top of a movement room (contract: docs/live/MODE_STAND.md).

A question is on the board and on the phones; four answer zones А, Б, В, Г lie on the floor. At the deadline the room
reads where every character stands, writes the answers through ``live_stand_close`` (one call, authorised by the host
token the room already holds) and gets the key and every player's result back. Then the floor drops everywhere but the
right zone: who is not on it falls and becomes a ghost; a ghost on the right zone comes back when the floor returns.

Two parts:
- ``StandGame`` — the rules inside the room (``RoomHooks``): zone tracking each tick of a question, the decision at
  ``closes + 250 ms``, the result's visuals (falls, freezes, ghosts, the floor), the JSON the clients get. No I/O.
- ``StandMode`` — the glue: it follows the live game's state (``live_host_state`` once a second, at once after the
  host's ``sync``), turns its times into room ms, writes the answers with retries, and sends the messages. Every
  database call is an asyncio task off the tick.

The database stays the judge of the state machine, the points and the ghosts (``live_players.frozen``); the room never
learns the key before the question is closed.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import time
from collections import deque
from datetime import datetime
from typing import Any, Callable

import live_move as lm
from live_move_modes import GameSource, Mode

log = logging.getLogger("live_move")

PROTOCOL = 1

# The arena (MODE_STAND.md §3): zone i is option i; the letters are for display. Six zones on the tile grid: А Б on the
# far row's corners, В Г on the near row's, Д Е in the middle column above and below the stage; a question with fewer
# options closes the rest (a character on a closed zone answers nothing).
ARENA: dict[str, Any] = {
    "w": 1600, "h": 900,
    "solids": [
        {"rect": [0, 0, 1600, 160]},                                   # the back wall under the question board
        {"rect": [0, 160, 20, 740]}, {"rect": [1580, 160, 20, 740]}, {"rect": [0, 880, 1600, 20]},
        {"circle": [800, 520, 80]},                                    # the stage, where «Дедлайн» stands
    ],
    "zones": [
        {"id": "А", "rect": [80, 220, 420, 240]}, {"id": "Б", "rect": [1100, 220, 420, 240]},
        {"id": "В", "rect": [80, 580, 420, 240]}, {"id": "Г", "rect": [1100, 580, 420, 240]},
        {"id": "Д", "rect": [560, 220, 480, 180]}, {"id": "Е", "rect": [560, 640, 480, 180]},
    ],
    "spawns": [[560, 520], [1040, 520], [300, 520], [1300, 520]],
    "npc_spawns": [[800, 520]],
}
STAGE = [800, 520, 80]
FLOOR = {"x": 20, "y": 160, "tile": 60, "cols": 26, "rows": 12}
LETTERS = ["А", "Б", "В", "Г", "Д", "Е"]

ALARM_MS = 3000          # the last seconds the alarm shakes (clients only)
DECIDE_LAG_MS = 250      # zones are read this long after the deadline: commands sent before zero have arrived
FALL_MS = 900            # a character that fell cannot move while it falls
FLOOR_MS = 4000          # the floor is down this long after the stomp
POLL_S = 1.0             # live_host_state, unless the host's «sync» comes first
WRITE_WINDOW_S = 7.0     # retries of the write; the database closes an open stand question by itself after 8 s
HOLD = 1 << 40           # frozen «until further notice» (a tick far away)

# Mode B «Убеги от Дедлайна» (MODE_RUN.md): every second movement round «Дедлайн» leaves its stage and hunts the class.
HUNT_SPEED = 215.0       # a player runs 260: the hunter can be escaped, not by standing still
HUNT_STOP_MS = 2000      # the hunters are called back this long before zero (the stomp is from the stage)
HUNT_FROM = (800.0, 630.0)   # where they come down: in front of the stage
HUNT_GAP = 90.0          # between hunters coming down together
KNOCK = 180.0            # a catch throws the character at least this far from the hunter
KNOCK_MAX = 900.0        # and on until it is off every zone (it loses the zone it held)
CAUGHT_MS = 1500         # and it cannot move this long
SAFE_MS = 2000           # nobody catches it again this long after a catch
HUNTER_REST_MS = 1000    # the hunter stands and roars this long after a catch


def stand_points(elapsed_ms: int, time_s: int, streak_after: int, speed: bool, ghost: bool) -> int:
    """The points of a right answer (MODE_STAND.md §6), exactly as meldy_private.live_stand_points computes them (the
    rehearsal compares every millisecond). The database is the judge; this mirror serves the tests."""
    t = time_s * 1000
    early = max(0.0, 1.0 - float(min(max(elapsed_ms, 0), t)) / float(t)) if speed else 1.0
    base = 500.0 + 500.0 * early
    mult = 0.5 if ghost else 1.0 + 0.1 * float(min(max(streak_after - 1, 0), 4))
    return 10 * int(math.floor(base * mult / 10.0 + 0.5))


def number_of(res: dict[str, Any]) -> dict[str, Any]:
    """A number question played as ranges: its accepted numbers, tolerance and unit (the reveal shows the true value
    inside the right range), as live_stand_result / live_mixed_result give them; nothing for any other question."""
    num = res.get("num")
    if not isinstance(num, dict) or not isinstance(num.get("forms"), list):
        return {}
    tol = num.get("tolerance")
    unit = num.get("unit")
    return {"num": {"forms": [str(f) for f in num["forms"]][:10],
                    "tolerance": tol if isinstance(tol, (int, float)) and not isinstance(tol, bool) else None,
                    "unit": unit if isinstance(unit, str) else None}}


def keys_of(res: dict[str, Any]) -> list[int]:
    """Every right zone of a closed round: ``keys`` of a question of several right answers (every one of them stays up
    and is a right answer), else the one ``key``."""
    keys = res.get("keys")
    if isinstance(keys, list) and keys and all(isinstance(k, int) and not isinstance(k, bool) for k in keys):
        return sorted(set(keys))
    return [int(res.get("key", -1))]


def arena_map() -> lm.GameMap:
    return lm.parse_map(ARENA)


def iso_ms(value: Any) -> float | None:
    """The database's ISO time («2026-10-21T10:00:00.123Z») as epoch ms, or None."""
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000.0
    except ValueError:
        return None


class OffsetClock:
    """Database time ↔ room ms. Each poll gives the database's «now» between two readings of the room's clock; the
    sample with the shortest round trip of the last 8 is trusted."""

    def __init__(self) -> None:
        self.samples: deque[tuple[float, float]] = deque(maxlen=8)   # (round trip ms, db ms − room ms)

    @property
    def ready(self) -> bool:
        return bool(self.samples)

    def sample(self, db_ms: float, room_before: float, room_after: float) -> None:
        self.samples.append((room_after - room_before, db_ms - (room_before + room_after) / 2.0))

    def to_room(self, db_ms: float) -> float:
        return db_ms - min(self.samples)[1]


# ─────────────────────────────────────────── The rules in the room ───────────────────────────────────────────


class StandGame(lm.RoomHooks):
    """Mode A inside one room. The room calls ``on_tick``; ``StandMode`` feeds it the game's state and the results.
    ``on_decide(qi, answers)`` fires once per question at the deadline; ``on_change()`` whenever the picture the
    clients see changed by time (countdown → open, the floor back)."""

    def __init__(self, *, time_s: int = 15, speed: bool = True, q_count: int = 0, boss: str = "clock") -> None:
        self.room: lm.Room | None = None
        self.time_s = time_s
        self.speed = speed
        self.q_count = q_count
        self.boss = boss if boss in ("clock", "skeleton") else "clock"
        self.players = 0
        self.phase = "lobby"
        self.qi = -1
        self.q: dict[str, Any] | None = None
        self.n = 0
        self.opens_ms = 0.0
        self.closes_ms = 0.0
        self.decided = False
        self.applied_qi = -1
        self.floor = "up"
        self.back_at = 0.0
        self.res: dict[str, Any] | None = None
        self.res_pts: list[list[int]] = []
        self.top: list[dict[str, Any]] | None = None
        self.acc: int | None = None
        self.ghosts: set[str] = set()                      # live_players.id of ghosts (the database's word)
        self.me: dict[str, dict[str, Any]] = {}            # live_players.id → the phone's own numbers
        self.track: dict[int, tuple[int, float]] = {}      # entity id → (zone index + 1, room ms it entered)
        self.at_decision: dict[int, int] = {}              # entity id → zone at the decision
        self.chase = False                                 # this round «Дедлайн» hunts (mode B)
        self.catches = 0                                   # catches in this round
        self.on_decide: Callable[[int, list[dict[str, Any]]], None] | None = None
        self.on_change: Callable[[], None] | None = None

    # ── the game's state (from the database) ──

    def begin(self, qi: int, q: dict[str, Any], opens_ms: float, closes_ms: float, now_ms: float) -> None:
        """Question qi is announced (countdown) or already open: track zones from now on."""
        self.qi = qi
        self.q = {"text": q.get("text", ""), "options": list(q.get("options") or [])}
        if isinstance(q.get("multi"), int) and not isinstance(q.get("multi"), bool) and q["multi"] > 1:
            self.q["multi"] = q["multi"]          # several right zones: the boards say how many (no key in it)
        if q.get("kind") == "number" and q.get("ranges") is True:
            self.q["ranges"] = True               # a number played as ranges (20261102090200): «Встаньте на промежуток с ответом»
            if isinstance(q.get("unit"), str) and q["unit"]:
                self.q["unit"] = q["unit"]
        self.n = min(len(self.q["options"]), len(LETTERS))
        self.opens_ms = opens_ms
        self.closes_ms = closes_ms
        self.decided = False
        self.res = None
        self.res_pts = []
        self.top = None
        self.track = {}
        self.at_decision = {}
        self._floor_up()
        self._release()
        self._call_off()
        self.chase = self.chase_round(qi)
        self.catches = 0
        self.phase = "countdown" if now_ms < opens_ms else "open"

    def chase_round(self, qi: int) -> bool:
        """«Встань на ответ» of every question: the second, fourth, … question is a chase."""
        return qi % 2 == 1

    def set_phase(self, phase: str, *, top: list[dict[str, Any]] | None = None, acc: int | None = None) -> None:
        """lobby, leaderboard, podium or ended: the floor is up and nobody is held."""
        if self.floor == "down":
            self._floor_up()
        self._release()
        self._call_off()
        self.chase = False
        self.phase = phase
        self.top = top if phase in ("leaderboard", "podium") else None
        self.acc = acc if phase == "podium" else None
        if phase == "lobby":
            self.qi = -1
            self.q = None

    def sync_ghosts(self, frozen: dict[str, bool]) -> None:
        """Ghosts as the database has them (the host roster's «frozen»), when no stomp is on screen."""
        self.ghosts = {pid for pid, f in frozen.items() if f}
        if self.room is not None and self.floor == "up":
            for p in self.room.players.values():
                self._paint(p, p.pid in self.ghosts)

    def on_player(self, p: lm.Player) -> None:
        """A (re)joining character gets its ghost flag (the database's word)."""
        self._paint(p, p.pid in self.ghosts)

    # ── each tick ──

    def on_tick(self, room: lm.Room) -> None:
        phase = self.phase
        if phase == "countdown" or phase == "open":
            now = room.t_ms()
            if phase == "countdown" and now >= self.opens_ms:
                self.phase = "open"
                self._changed()
            if self.chase:
                self._hunt(room, now)
            if self.decided:
                return
            zone_index = room.map.zone_index
            track = self.track
            for p in room.players.values():
                z = zone_index(p.x, p.y)
                rec = track.get(p.id)
                if rec is None or rec[0] != z:
                    track[p.id] = (z, now)
            if self.phase == "open" and now >= self.closes_ms + DECIDE_LAG_MS:
                answers = self.decide(room, now)
                if self.on_decide is not None:
                    self.on_decide(self.qi, answers)
        elif self.floor == "down" and room.t_ms() >= self.back_at:
            self._floor_up()
            self._release()
            self._changed()

    def decide(self, room: lm.Room, now: float) -> list[dict[str, Any]]:
        """The answers at this moment: connected players whose centre is in a live zone; elapsed = when they entered
        it − opens (0 when they were there before). Everyone is held still until the result."""
        self.decided = True
        self._call_off()
        answers: list[dict[str, Any]] = []
        time_ms = self.time_s * 1000
        for p in room.players.values():
            p.frozen_until = HOLD
            rec = self.track.get(p.id)
            z = rec[0] if rec is not None else room.map.zone_index(p.x, p.y)
            self.at_decision[p.id] = z
            if p.connected and 1 <= z <= self.n:
                since = rec[1] if rec is not None else now
                answers.append({"p": p.pid, "c": z - 1, "e": int(min(max(since - self.opens_ms, 0.0), time_ms))})
        return answers

    # ── the result ──

    def apply(self, res: dict[str, Any], now_ms: float) -> bool:
        """live_stand_close's answer → the stomp: who falls, who stays, who comes back, the phones' numbers."""
        room = self.room
        qi = res.get("qi")
        if room is None or qi != self.qi or self.applied_qi == qi or not isinstance(res.get("rows"), list):
            return False
        key = int(res.get("key", -1))
        keys = keys_of(res)
        rows = [r for r in res["rows"] if isinstance(r, dict) and isinstance(r.get("p"), str)]
        fall_ticks = max(1, math.ceil(FALL_MS * room.tick_hz / 1000))
        fell: list[int] = []
        back: list[int] = []
        pts: list[list[int]] = []
        stood = 0
        fastest: tuple[float, int, int | None, int | None] | None = None   # (ms, −pts, id, ms)
        ghosts: set[str] = set()
        seen: set[int] = set()
        for r in rows:
            pid = r["p"]
            p = room.by_pid.get(pid)
            eid = p.id if p is not None else None
            out = bool(r.get("out"))
            ok = bool(r.get("ok"))
            revived = bool(r.get("revived"))
            ghost = bool(r.get("ghost"))
            fell_now = bool(r.get("fell"))
            if ghost:
                ghosts.add(pid)
            if out and p is not None:
                # Joined after the question opened: nothing counts; off the right zone they fall and come back.
                on_island = self.at_decision.get(p.id, room.map.zone_index(p.x, p.y)) - 1 in keys
                fell_now = not on_island and not ghost
                if fell_now:
                    back.append(p.id)
            if ok and not revived and not out:
                stood += 1
                ms = r.get("ms")
                cand = (float(ms) if isinstance(ms, (int, float)) else math.inf, -int(r.get("pts") or 0), eid,
                        int(ms) if isinstance(ms, (int, float)) else None)
                if eid is not None and (fastest is None or cand[:2] < fastest[:2]):
                    fastest = cand
            if revived and eid is not None:
                back.append(eid)
            if int(r.get("pts") or 0) > 0 and eid is not None:
                pts.append([eid, int(r["pts"])])
            if p is not None:
                seen.add(p.id)
                if fell_now:
                    fell.append(p.id)
                    self._paint(p, True)
                    p.frozen_until = room.tick + fall_ticks
                elif ghost and not revived:
                    self._paint(p, True)
                    p.frozen_until = 0                       # a ghost floats over the holes
                else:
                    self._paint(p, ghost or revived)         # alive on the right zone, or a ghost coming back
                    p.frozen_until = HOLD                    # stays on the island until the floor returns
            self.me[pid] = {
                "ghost": ghost, "pts": int(r.get("total") or 0), "streak": int(r.get("streak") or 0),
                "best": int(r.get("best") or 0), "right": int(r.get("right") or 0), "place": r.get("place"),
                "of": len(rows),
                "last": {"qi": qi, "choice": r.get("c"), "ok": ok, "pts": int(r.get("pts") or 0), "ms": r.get("ms"),
                         "fell": fell_now, "revived": revived, "late": out},
            }
        for p in room.players.values():
            if p.id not in seen:                             # kicked, or unknown to the database: just let go
                p.frozen_until = 0
        self.ghosts = ghosts
        self.applied_qi = qi
        self.phase = "reveal"
        self.floor = "down"
        self.back_at = now_ms + FLOOR_MS
        counts = res.get("counts") if isinstance(res.get("counts"), list) else []
        self.res = {
            "qi": qi, "key": key, **({"keys": keys} if len(keys) > 1 else {}), **number_of(res), "counts": counts, "stood": stood, "of": int(res.get("active") or 0),
            "fastest": None if fastest is None else {"id": fastest[2], "pts": -fastest[1], "ms": fastest[3]},
            "fell": fell, "back": back, "at": int(now_ms), "back_at": int(self.back_at),
        }
        self.res_pts = pts
        return True

    def refresh_me(self, res: dict[str, Any]) -> None:
        """The phones' numbers from a closed question's rows, without any stomp (podium, a room that came late)."""
        rows = [r for r in res.get("rows") or [] if isinstance(r, dict) and isinstance(r.get("p"), str)]
        for r in rows:
            last = self.me.get(r["p"], {}).get("last")
            self.me[r["p"]] = {"ghost": bool(r.get("ghost")), "pts": int(r.get("total") or 0),
                               "streak": int(r.get("streak") or 0), "best": int(r.get("best") or 0),
                               "right": int(r.get("right") or 0), "place": r.get("place"), "of": len(rows), "last": last}

    # ── what the clients get ──

    def hello(self) -> dict[str, Any]:
        return {"t": "stand", "k": "hello", "v": PROTOCOL, "boss": self.boss, "q_count": self.q_count,
                "time_s": self.time_s, "speed": self.speed, "stage": STAGE, "floor": FLOOR, "letters": LETTERS,
                "alarm_ms": ALARM_MS, "fall_ms": FALL_MS, "floor_ms": FLOOR_MS}

    def state(self, host: bool) -> dict[str, Any]:
        q = self.q if self.phase in ("countdown", "open", "reveal") else None
        res = None
        if self.phase == "reveal" and self.res is not None:
            res = dict(self.res, pts=self.res_pts) if host else self.res
        return {"t": "stand", "k": "state", "phase": self.phase, "qi": self.qi, "q_count": self.q_count,
                "players": self.players, "q": q,
                "opens": int(self.opens_ms) if q is not None else None,
                "closes": int(self.closes_ms) if q is not None else None,
                "floor": self.floor, "res": res, "top": self.top, "acc": self.acc,
                "chase": self.chase and q is not None, "caught": self.catches if q is not None else 0}

    def me_of(self, pid: str) -> dict[str, Any] | None:
        me = self.me.get(pid)
        return None if me is None else {"t": "stand", "k": "me", **me}

    # ── mode B: the hunt ──

    def can_chase(self, room: lm.Room, npc: lm.Npc, p: lm.Player) -> bool:
        """Hunted: a connected character, not a ghost, not just caught or held."""
        return (self.chase and p.connected and room.tick >= p.caught_until and room.tick >= p.frozen_until
                and not p.mode_flags & lm.F_GHOST)

    def on_catch(self, room: lm.Room, npc: lm.Npc, p: lm.Player) -> None:
        """Caught: thrown off the zone it held — KNOCK units away from the hunter, on until it is out of every zone
        (towards the stage when a wall stops it); in small steps, so no wall or the stage is crossed. Held CAUGHT_MS,
        safe for SAFE_MS; the hunter rests HUNTER_REST_MS."""
        m = room.map
        dx = p.x - npc.x
        dy = p.y - npc.y
        d = math.hypot(dx, dy)
        if d < 1e-6:
            dx, dy, d = 0.0, 1.0, 1.0
        step = lm.PLAYER_R * 0.9
        ux, uy = dx / d * step, dy / d * step
        gone = 0.0
        while gone < KNOCK or (m.zone_index(p.x, p.y) and gone < KNOCK_MAX):
            x, y = lm.move_circle(m, p.x, p.y, ux, uy, lm.PLAYER_R)
            if math.hypot(x - p.x, y - p.y) < step * 0.3:
                # a wall: on towards the stage's centre
                cx, cy = STAGE[0] - p.x, STAGE[1] - p.y
                c = math.hypot(cx, cy) or 1.0
                ux, uy = cx / c * step, cy / c * step
                x, y = lm.move_circle(m, p.x, p.y, ux, uy, lm.PLAYER_R)
            p.x, p.y = x, y
            gone += step
        hz = room.tick_hz
        p.frozen_until = max(p.frozen_until, room.tick + math.ceil(CAUGHT_MS * hz / 1000))
        p.caught_until = room.tick + math.ceil(SAFE_MS * hz / 1000)
        npc.paused_until = room.tick + math.ceil(HUNTER_REST_MS * hz / 1000)
        self.catches += 1
        room.emit({"t": "ev", "k": "caught", "id": p.id, "by": npc.id})
        self._changed()                                    # the boards' «Поймал N»

    def hunters_for(self, players: int) -> int:
        """One hunter, a second past 12 players, a third past 24."""
        return 1 + (players > 12) + (players > 24)

    def _hunt(self, room: lm.Room, now: float) -> None:
        """The hunters are out while the round is open, until HUNT_STOP_MS before zero."""
        out = self.phase == "open" and not self.decided and now < self.closes_ms - HUNT_STOP_MS
        if out and not room.npcs:
            n = self.hunters_for(sum(1 for p in room.players.values() if p.connected))
            for k in range(n):
                npc = room.add_npc("hunter")
                npc.speed = HUNT_SPEED
                npc.x, npc.y = lm.move_circle(room.map, HUNT_FROM[0] + (k - (n - 1) / 2) * HUNT_GAP, HUNT_FROM[1],
                                              0.0, 0.0, npc.r)
        elif not out and room.npcs:
            room.remove_npcs()

    def _call_off(self) -> None:
        if self.room is not None and self.room.npcs:
            self.room.remove_npcs()

    # ── inside ──

    def _paint(self, p: lm.Player, ghost: bool) -> None:
        p.mode_flags = (p.mode_flags | lm.F_GHOST) if ghost else (p.mode_flags & ~lm.F_GHOST)

    def _floor_up(self) -> None:
        self.floor = "up"
        if self.room is not None:
            for p in self.room.players.values():
                self._paint(p, p.pid in self.ghosts)

    def _release(self) -> None:
        if self.room is not None:
            for p in self.room.players.values():
                p.frozen_until = 0

    def _changed(self) -> None:
        if self.on_change is not None:
            self.on_change()


# ─────────────────────────────────────────── The glue: database, timers, messages ───────────────────────────────────────────


def _dumps(obj: Any) -> str:
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False)


class StandMode(Mode):
    kind = "stand"
    poll_s = POLL_S
    write_window_s = WRITE_WINDOW_S

    def __init__(self, runner: Any, host_state: dict[str, Any], source: GameSource) -> None:
        settings = host_state.get("settings") or {}
        self.runner = runner
        self.source = source
        self.game_id: str = runner.game_id
        self.game = StandGame(time_s=int(settings.get("time_s") or 15), speed=bool(settings.get("speed", True)),
                              q_count=int(host_state.get("q_count") or 0), boss=str(settings.get("boss") or "clock"))
        self.game.players = int(host_state.get("players") or 0)
        self.game.on_decide = self._on_decide
        self.game.on_change = self.broadcast
        self.hooks = self.game
        self.clock = OffsetClock()
        self.rev: int | None = None
        self.writing: int | None = None                  # the question a write (or a fetch) is under way for
        self.stopped = False
        self.polls = 0
        self.poll_errors = 0
        self.writes = 0
        self.write_errors = 0
        self._poke: asyncio.Event | None = None
        self._tasks: set[asyncio.Task] = set()

    # ── Mode ──

    def game_map(self) -> lm.GameMap:
        return arena_map()

    def attach(self, room: lm.Room) -> None:
        self.game.room = room

    def start(self) -> None:
        self._poke = asyncio.Event()
        self._spawn(self._poll_loop())

    def stop(self) -> None:
        self.stopped = True
        for t in list(self._tasks):
            if t is not asyncio.current_task():
                t.cancel()

    def on_join(self, conn: Any) -> None:
        if conn.player is not None:
            self.game.on_player(conn.player)
        conn.send_text(_dumps(self.game.hello()))
        conn.send_text(_dumps(self.game.state(conn.role == "host")))
        if conn.player is not None:
            me = self.game.me_of(conn.player.pid)
            if me is not None:
                conn.send_text(_dumps(me))

    def on_command(self, conn: Any, op: Any, obj: dict[str, Any]) -> bool:
        if op == "sync":
            self.poke()
            return True
        if op in ("map", "npc"):   # the arena and the boss are the mode's
            conn.send_json({"t": "err", "code": "op"})
            return True
        return False

    # ── sending ──

    def broadcast(self) -> None:
        phones = _dumps(self.game.state(False))
        hosts = _dumps(self.game.state(True))
        for c in self.runner.hosts:
            c.send_text(hosts)
        for c in self.runner.conns.values():
            c.send_text(phones)

    def send_me_all(self) -> None:
        for c in self.runner.conns.values():
            if c.player is not None:
                me = self.game.me_of(c.player.pid)
                if me is not None:
                    c.send_text(_dumps(me))

    # ── the game's state ──

    def poke(self) -> None:
        if self._poke is not None:
            self._poke.set()

    def room_now(self) -> float:
        """Room ms now (the last tick's time plus what passed since it started)."""
        room = self.runner.room
        return room.t_ms() + max(0.0, time.perf_counter() - self.runner.tick_at) * 1000.0

    async def _poll_loop(self) -> None:
        assert self._poke is not None
        while not self.stopped:
            await self.poll()
            try:
                await asyncio.wait_for(self._poke.wait(), self.poll_s)
            except asyncio.TimeoutError:
                pass
            self._poke.clear()

    async def poll(self) -> None:
        before = self.room_now()
        try:
            st = await self.source.host_state(self.game_id, self.runner._host_token, self.rev)
        except asyncio.CancelledError:
            raise
        except Exception:
            self.poll_errors += 1
            return
        after = self.room_now()
        self.polls += 1
        if not isinstance(st, dict):
            return
        db_now = iso_ms(st.get("now"))
        if db_now is not None:
            self.clock.sample(db_now, before, after)
        if st.get("unchanged"):
            return
        if isinstance(st.get("rev"), int):
            self.rev = st["rev"]
        try:
            self.apply_state(st)
        except Exception:   # a shape the room does not expect must not stop the polling
            log.exception("live_move: stand state of %s not applied", self.game_id[:8])

    def apply_state(self, st: dict[str, Any]) -> None:
        g = self.game
        state = st.get("state")
        qi = st.get("qi") if isinstance(st.get("qi"), int) else -1
        players = st.get("players")
        changed = False
        if isinstance(players, int) and players != g.players:
            g.players = players
            changed = g.phase == "lobby"
        if isinstance(st.get("q_count"), int):
            g.q_count = st["q_count"]
        roster = {r["player_id"]: bool(r.get("frozen")) for r in st.get("roster") or []
                  if isinstance(r, dict) and isinstance(r.get("player_id"), str)}
        if state == "lobby":
            if g.phase != "lobby":
                g.sync_ghosts(roster)
                g.set_phase("lobby")
                changed = True
        elif state in ("countdown", "open"):
            # A poll sent before the room's own write can come back after it: an «open» of the question whose result
            # is already on screen is stale (the database never opens a question again), never a new round.
            if (g.qi != qi or g.phase not in ("countdown", "open")) and g.applied_qi != qi and self.clock.ready:
                q = st.get("question") or {}
                opens, closes = iso_ms(q.get("opens_at")), iso_ms(q.get("closes_at"))
                if opens is not None and closes is not None:
                    if g.floor == "up":
                        g.sync_ghosts(roster)
                    g.begin(qi, q, self.clock.to_room(opens), self.clock.to_room(closes), self.room_now())
                    changed = True
        elif state == "reveal":
            if g.applied_qi != qi and self.writing is None:
                # The room did not close this question (it came late, restarted, or its write gave up): read the
                # stored result (live_stand_close of a closed question writes nothing) and show it.
                if g.qi != qi:
                    q = st.get("question") or {}
                    g.begin(qi, q, self.room_now(), self.room_now(), self.room_now())
                g.decided = True
                self._spawn(self._write(qi, []))
        elif state in ("leaderboard", "podium"):
            if g.phase != state:
                top = [{"id": self._eid(t.get("player_id")), "name": t.get("name"), "look": t.get("look"),
                        "pts": t.get("dmg"), "move": t.get("move")} for t in st.get("top") or [] if isinstance(t, dict)]
                final = st.get("final") if isinstance(st.get("final"), dict) else {}
                g.set_phase(state, top=top, acc=final.get("accuracy_pct"))
                changed = True
                if state == "podium" and qi >= 0:
                    self._spawn(self._refresh(qi))
        elif state == "ended":
            if g.phase != "ended":
                g.set_phase("ended")
                changed = True
                asyncio.get_running_loop().call_later(1.0, self.runner.close, 4410, "ended")
        if changed:
            self.broadcast()

    def _eid(self, pid: Any) -> int | None:
        p = self.runner.room.by_pid.get(pid) if isinstance(pid, str) else None
        return p.id if p is not None else None

    # ── the write ──

    def _on_decide(self, qi: int, answers: list[dict[str, Any]]) -> None:
        self._spawn(self._write(qi, answers))

    async def _write(self, qi: int, answers: list[dict[str, Any]]) -> None:
        """One call with every answer; retried with backoff while it makes sense. A question closed meanwhile
        (by time) comes back as it is stored (``again``), so a retry is always safe."""
        self.writing = qi
        loop = asyncio.get_running_loop()
        end = loop.time() + self.write_window_s
        delay = 0.25
        try:
            while not self.stopped:
                try:
                    res = await self.source.stand_close(self.game_id, self.runner._host_token, qi, answers)
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    self.write_errors += 1
                    status = getattr(exc, "status", 0)
                    if status in (401, 403, 404) or loop.time() + delay > end:
                        log.warning("live_move: stand write for %s gave up (%s)", self.game_id[:8], status or type(exc).__name__)
                        return
                    await asyncio.sleep(delay)
                    delay = min(2.0, delay * 2)
                    continue
                self.writes += 1
                try:
                    applied = isinstance(res, dict) and self.game.apply(res, self.runner.room.t_ms())
                except Exception:
                    log.exception("live_move: stand result of %s not applied", self.game_id[:8])
                    return
                log.debug("live_move: stand result qi=%s applied=%s (room qi %s, phase %s)", res.get("qi") if isinstance(res, dict) else None,
                          applied, self.game.qi, self.game.phase)
                if applied:
                    self.broadcast()
                    self.send_me_all()
                return
        finally:
            if self.writing == qi:
                self.writing = None

    async def _refresh(self, qi: int) -> None:
        """At the podium: everyone's final numbers (the last question's stored rows)."""
        try:
            res = await self.source.stand_close(self.game_id, self.runner._host_token, qi, [])
        except asyncio.CancelledError:
            raise
        except Exception:
            return
        if isinstance(res, dict):
            self.game.refresh_me(res)
            self.send_me_all()

    def _spawn(self, coro: Any) -> None:
        task = asyncio.get_running_loop().create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
