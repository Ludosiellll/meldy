"""Live movement games: the WebSocket ``/api/live/move/ws`` (protocol: docs/live/MOVE.md).

Positions do not go through Supabase Realtime (100 messages a second on the Free plan, each broadcast counted once per
receiver: 30 phones at 10 Hz is over it at once). They go over one WebSocket per phone to this process, behind the
Space's nginx (``location = /api/live/move/ws``). Nothing here is stored: rooms live in memory and die with the
process; results go through the existing ``live_*`` SQL.

Who may connect: the phone's player token and the projector's host token of a ``live_games`` row — the same 43-char
tokens the ``live_*`` RPCs take. The first message carries them (never the URL: addresses end up in proxy logs). The
token is checked once per connection with the existing ``live_state`` / ``live_host_state`` RPC through PostgREST
with the anon key (``SupabaseVerifier``); a room remembers sha256(token) → player, so a reconnect is not checked
again. Tokens are never logged.

One process, one event loop: every room runs its own tick task (``RoomRunner.run``); every connection has a reader
(the endpoint coroutine) and a writer task that always sends the newest snapshot (a slow phone skips snapshots and
never holds the tick back).
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import time
from collections import deque
from dataclasses import dataclass
from typing import Any, Callable, Protocol
from urllib.parse import urlsplit

from fastapi import APIRouter, WebSocket

import live_move as lm
import supabase_rest
from ratelimit import visitor_ip

log = logging.getLogger("live_move")

WS_PATH = "/api/live/move/ws"

# Close codes. The client lib (frontend/src/lib/live/move/client.ts) reconnects on the "retry" ones only.
CLOSE_ROOM_CLOSED = 4000     # the host left for more than the grace period            — final
CLOSE_REPLACED = 4001        # the same player connected again (another tab, a reconnect) — final for this socket
CLOSE_BAD_REQUEST = 4400     # broke the protocol                                         — final
CLOSE_BAD_TOKEN = 4401       # unknown game or token                                      — final
CLOSE_FORBIDDEN = 4403       # kicked, or a foreign Origin                                 — final
CLOSE_NO_ROOM = 4404         # the host has not opened the room yet                        — retry in ~2 s
CLOSE_TIMEOUT = 4408         # no hello in time, or silent for too long                   — retry
CLOSE_FULL = 4409            # the room (or its host seats) is full                        — final
CLOSE_ENDED = 4410           # the live game ended                                         — final
CLOSE_SLOW_DOWN = 4429       # rate limit, too many connections, a client too slow to read — retry with backoff
CLOSE_UNAVAILABLE = 4503     # the token check could not reach Supabase                   — retry with backoff
CLOSE_TOO_BIG = 1009

_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{43}$")
_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def _env_int(name: str, default: int) -> int:
    try:
        value = int(os.getenv(name, "").strip() or default)
    except ValueError:
        return default
    return value if value > 0 else default


@dataclass
class Limits:
    max_conns: int = 300           # sockets in the process: ~0.2 % of a core each (load test 2026-10-21, docs/live/MOVE.md)
    max_per_ip: int = 150          # a whole school behind one NAT is one address: a few classes at once
    max_pending: int = 64          # sockets that have not finished their hello
    max_rooms: int = 8
    max_players: int = lm.MAX_PLAYERS
    max_hosts: int = 3             # projector + the teacher's phone + one spare
    hello_timeout: float = 5.0
    idle_timeout: float = 15.0     # nothing from a client for this long: closed (phones ping every 2 s)
    host_grace: float = 60.0       # a room without its host for longer than this closes
    max_age: float = 3 * 3600 + 600  # live games expire 3 h after create
    state_check: float = 60.0      # how often a room asks Supabase whether its game ended
    hello_max: int = 1024
    player_text_max: int = 256
    host_text_max: int = 64 * 1024
    binary_max: int = 64
    say_max: int = 4096            # a host «say» payload, serialised
    outbox_max: int = 64           # JSON messages waiting for a slow client before it is dropped

    @classmethod
    def from_env(cls) -> "Limits":
        return cls(
            max_conns=_env_int("LIVE_MOVE_MAX_CONNS", cls.max_conns),
            max_per_ip=_env_int("LIVE_MOVE_MAX_PER_IP", cls.max_per_ip),
            max_rooms=_env_int("LIVE_MOVE_MAX_ROOMS", cls.max_rooms),
            max_players=min(lm.MAX_PLAYERS, _env_int("LIVE_MOVE_MAX_PLAYERS", cls.max_players)),
        )


# ─────────────────────────────────────────── Token check ───────────────────────────────────────────


@dataclass(frozen=True)
class Identity:
    role: str                  # "player" | "host"
    player_id: str | None      # live_players.id for a player
    name: str
    look: Any
    state: str                 # the live game's state at the check


class Refused(Exception):
    """A connection refused with a close code; ``reason`` is short and safe to show (≤ 123 bytes)."""

    def __init__(self, code: int, reason: str) -> None:
        super().__init__(reason)
        self.code = code
        self.reason = reason


class Verifier(Protocol):
    async def verify(self, game_id: str, token: str, role: str) -> Identity: ...


class SupabaseVerifier:
    """The token check through the existing RPCs (no new SQL): ``live_state(p_game, p_token, null)`` for a player,
    ``live_host_state(p_game, p_host_token, null)`` for the host, over PostgREST with the anon key, as the browser
    calls them. Both are SECURITY DEFINER and refuse a wrong token (404 P0002 token/game, 403 42501 host/kicked).
    One call per connection (a reconnect is matched by the room), at most ``concurrency`` at a time."""

    def __init__(self, concurrency: int = 8, timeout: float = 6.0) -> None:
        self.concurrency = concurrency
        self.timeout = timeout
        self._loop: asyncio.AbstractEventLoop | None = None
        self._rest: supabase_rest.SupabaseRest | None = None
        self._sem: asyncio.Semaphore | None = None

    def _client(self) -> tuple[supabase_rest.SupabaseRest, asyncio.Semaphore]:
        loop = asyncio.get_running_loop()
        if self._rest is None or self._loop is not loop:
            # The anon key is the browser's own public key; PostgREST takes it as apikey and as the bearer.
            self._rest = supabase_rest.SupabaseRest(supabase_rest._api_key(), timeout=self.timeout)
            self._sem = asyncio.Semaphore(self.concurrency)
            self._loop = loop
        assert self._sem is not None
        return self._rest, self._sem

    async def verify(self, game_id: str, token: str, role: str) -> Identity:
        host = role == "host"
        try:
            rest, sem = self._client()
            async with sem:
                data = await rest.rpc(
                    "live_host_state" if host else "live_state",
                    {"p_game": game_id, "p_host_token" if host else "p_token": token, "p_since_rev": None},
                )
        except supabase_rest.SupabaseRestError as exc:
            raise _refusal(exc, host) from None
        if not isinstance(data, dict) or not isinstance(data.get("state"), str):
            raise Refused(CLOSE_UNAVAILABLE, "auth_shape")
        state = data["state"]
        if host:
            return Identity("host", None, "", None, state)
        me = data.get("me")
        if not isinstance(me, dict) or not isinstance(me.get("player_id"), str):
            raise Refused(CLOSE_UNAVAILABLE, "auth_shape")
        name = me.get("name") if isinstance(me.get("name"), str) else ""
        return Identity("player", me["player_id"], name[:24], me.get("look"), state)


def _refusal(exc: supabase_rest.SupabaseRestError, host: bool) -> Refused:
    if exc.status in (400, 401, 404):
        return Refused(CLOSE_BAD_TOKEN, "bad_token")
    if exc.status == 403:
        return Refused(CLOSE_BAD_TOKEN, "bad_token") if host else Refused(CLOSE_FORBIDDEN, "kicked")
    if exc.status == 429:
        return Refused(CLOSE_SLOW_DOWN, "auth_busy")
    return Refused(CLOSE_UNAVAILABLE, "auth_unavailable")


def _for_phones(entry: list[Any]) -> list[Any]:
    """Another player's roster entry as a phone gets it: id, kind and look (no live_players.id, no name)."""
    if entry[1] != lm.KIND_PLAYER:
        return entry
    return [entry[0], entry[1], None, "", entry[4]]


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _dumps(obj: Any) -> str:
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False)


def _pct(values: list[float], q: float) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    return s[min(len(s) - 1, int(q * len(s)))]


# ─────────────────────────────────────────── Connection ───────────────────────────────────────────


class Conn:
    """One socket after its hello. The reader is the endpoint coroutine; ``run_sender`` is its writer task."""

    def __init__(self, ws: WebSocket, ip: str, now: float, limits: Limits) -> None:
        self.ws = ws
        self.ip = ip
        self.limits = limits
        self.role = ""
        self.player: lm.Player | None = None
        self.runner: RoomRunner | None = None
        self.outbox: deque[str] = deque()
        self.snap: bytes | None = None
        self.wake = asyncio.Event()
        self.closed = False
        self.close_code = 1000
        self.close_reason = ""
        self.last_rx = now
        self.msg_bucket = lm.Bucket(30, 20, now)                         # input frames (phones send ~15/s)
        self.cmd_bucket = lm.Bucket(lm.TICK_HZ * 1.05, 12, now)          # commands: one per tick, 5 % slack
        self.text_bucket = lm.Bucket(5, 10, now)                          # JSON: pings, host commands
        self.abuse = lm.Bucket(5, 60, now)                                # refused frames before the socket goes
        self.dropped_msgs = 0
        self.snaps_skipped = 0
        self.bytes_out = 0
        self.sender: asyncio.Task | None = None

    def send_text(self, text: str) -> None:
        if self.closed:
            return
        if len(self.outbox) >= self.limits.outbox_max:
            self.close(CLOSE_SLOW_DOWN, "slow_reader")
            return
        self.outbox.append(text)
        self.wake.set()

    def send_json(self, obj: Any) -> None:
        self.send_text(_dumps(obj))

    def send_snapshot(self, frame: bytes) -> None:
        if self.closed:
            return
        if self.snap is not None:
            self.snaps_skipped += 1
        self.snap = frame
        self.wake.set()

    def close(self, code: int, reason: str) -> None:
        if self.closed:
            return
        self.closed = True
        self.close_code = code
        self.close_reason = reason
        self.wake.set()

    def violation(self, now: float) -> None:
        self.dropped_msgs += 1
        if not self.abuse.take(now):
            self.close(CLOSE_SLOW_DOWN, "rate")

    async def run_sender(self) -> None:
        ws = self.ws
        try:
            while True:
                await self.wake.wait()
                self.wake.clear()
                while self.outbox:
                    await ws.send_text(self.outbox.popleft())
                if self.closed:
                    break
                frame = self.snap
                if frame is not None:
                    self.snap = None
                    await ws.send_bytes(frame)
                    self.bytes_out += len(frame)
        except Exception:  # the peer went away while we wrote: the reader sees the disconnect
            return
        try:
            await ws.close(self.close_code, self.close_reason)
        except Exception:
            pass


# ─────────────────────────────────────────── Room runner ───────────────────────────────────────────


class RoomRunner:
    """A room with its connections and its tick task."""

    def __init__(self, hub: "Hub", game_id: str, host_hash: str, host_token: str, now: float) -> None:
        self.hub = hub
        self.room = lm.Room(game_id, max_players=hub.limits.max_players)
        self.game_id = game_id
        self.host_hash = host_hash
        self._host_token = host_token   # kept in memory only, for the periodic «has the game ended» check
        self.hosts: list[Conn] = []
        self.conns: dict[int, Conn] = {}            # player entity id → its socket
        self.known: dict[str, str] = {}             # sha256(player token) → live_players.id, checked once
        self.banned: set[str] = set()               # kicked live_players.id
        self.created_at = now
        self.host_left_at: float | None = None
        self.next_check = now + hub.limits.state_check
        self.checking = False
        self.closed = False
        self.task: asyncio.Task | None = None
        self.lateness: deque[float] = deque(maxlen=12000)   # seconds a tick started after its schedule
        self.work: deque[float] = deque(maxlen=12000)       # seconds a tick took
        self.overruns = 0

    # ── the loop ──

    async def run(self) -> None:
        # perf_counter, not loop.time(): uvloop's clock moves in whole milliseconds, too coarse to see jitter.
        clock = time.perf_counter
        dt = 1.0 / self.room.tick_hz
        due = clock()
        try:
            while not self.closed:
                start = clock()
                self.lateness.append(start - due)
                self.tick()
                now = clock()
                self.work.append(now - start)
                due += dt
                if due < now - 0.25:          # far behind (a stalled loop): skip the missed ticks, do not burst
                    self.overruns += 1
                    due = now
                await asyncio.sleep(max(0.0, due - now))
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("live_move: room %s crashed", self.game_id[:8])
            self.close(CLOSE_ROOM_CLOSED, "server_error")

    def tick(self) -> None:
        room = self.room
        room.step()
        if room.events:
            for event in room.events:
                text = _dumps(event)
                for c in self.hosts:
                    c.send_text(text)
                if event.get("t") == "add" and event["e"][1] == lm.KIND_PLAYER:
                    # Phones learn another player's look only (CONTRACT.md §5: names are the projector's); the
                    # newcomer itself already has its own entry from the welcome.
                    entry = event["e"]
                    text = _dumps({"t": "add", "e": _for_phones(entry)})
                    for c in self.conns.values():
                        if c.player is not None and c.player.id != entry[0]:
                            c.send_text(text)
                else:
                    for c in self.conns.values():
                        c.send_text(text)
            room.events.clear()
        if room.tick % lm.SNAP_EVERY == 0:
            head, body = room.snapshot_parts()
            if self.hosts:
                frame = b"".join((head, lm.pack_ack(0), body))
                for c in self.hosts:
                    c.send_snapshot(frame)
            for c in self.conns.values():
                c.send_snapshot(b"".join((head, lm.pack_ack(c.player.ack if c.player else 0), body)))
        if room.tick % room.tick_hz == 0:
            self.housekeeping(self.hub.clock())

    def housekeeping(self, now: float) -> None:
        limits = self.hub.limits
        for c in list(self.conns.values()) + self.hosts:
            if now - c.last_rx > limits.idle_timeout:
                c.close(CLOSE_TIMEOUT, "idle")
        if self.hosts:
            self.host_left_at = None
        elif self.host_left_at is None:
            self.host_left_at = now
        elif now - self.host_left_at > limits.host_grace:
            self.close(CLOSE_ROOM_CLOSED, "host_left")
            return
        if now - self.created_at > limits.max_age:
            self.close(CLOSE_ENDED, "expired")
            return
        if now >= self.next_check and not self.checking:
            self.next_check = now + limits.state_check
            self.checking = True
            asyncio.get_running_loop().create_task(self._check_state())

    async def _check_state(self) -> None:
        """Ends the room when its live game has ended (3 h expiry, «Завершить» from another screen). A Supabase that
        cannot answer changes nothing."""
        try:
            ident = await self.hub.verifier.verify(self.game_id, self._host_token, "host")
            if ident.state == "ended":
                self.close(CLOSE_ENDED, "ended")
        except Refused as exc:
            if exc.code == CLOSE_BAD_TOKEN:
                self.close(CLOSE_ENDED, "ended")
        except Exception:
            log.warning("live_move: state check failed for %s", self.game_id[:8])
        finally:
            self.checking = False

    # ── membership ──

    def attach_player(self, conn: Conn, ident: Identity, thash: str) -> tuple[lm.Player, bool]:
        player, resumed = self.room.add_player(ident.player_id or "", ident.name, ident.look)
        self.known[thash] = player.pid
        old = self.conns.get(player.id)
        if old is not None and old is not conn:
            old.close(CLOSE_REPLACED, "replaced")
        conn.role = "player"
        conn.player = player
        conn.runner = self
        self.conns[player.id] = conn
        return player, resumed

    def detach(self, conn: Conn) -> None:
        if conn.role == "host":
            if conn in self.hosts:
                self.hosts.remove(conn)
            if not self.hosts and self.host_left_at is None:
                self.host_left_at = self.hub.clock()
        elif conn.player is not None and self.conns.get(conn.player.id) is conn:
            del self.conns[conn.player.id]
            self.room.set_connected(conn.player, False)

    def kick(self, pid: str) -> bool:
        self.banned.add(pid)
        for thash, known_pid in list(self.known.items()):
            if known_pid == pid:
                del self.known[thash]
        player = self.room.remove_player(pid)
        if player is None:
            return False
        conn = self.conns.pop(player.id, None)
        if conn is not None:
            conn.close(CLOSE_FORBIDDEN, "kicked")
        return True

    def close(self, code: int, reason: str) -> None:
        if self.closed:
            return
        self.closed = True
        for c in list(self.conns.values()) + self.hosts:
            c.close(code, reason)
        self.hub.forget(self)
        if self.task is not None and self.task is not asyncio.current_task():
            self.task.cancel()
        log.info("live_move: room %s closed (%s)", self.game_id[:8], reason)

    def welcome(self, conn: Conn, resumed: bool = False) -> dict[str, Any]:
        room = self.room
        out: dict[str, Any] = {
            "t": "welcome", "v": lm.PROTOCOL_VERSION, "role": conn.role,
            "tick": room.tick, "ms": room.t_ms(), "hz": room.tick_hz, "snap": lm.SNAP_EVERY, "q": lm.Q,
            "speed": lm.PLAYER_SPEED, "r": lm.PLAYER_R, "npc_r": lm.NPC_R,
            "map": room.map.to_json(), "roster": room.roster(), "frozen": room.frozen_all,
        }
        if conn.player is not None:
            me = conn.player.id
            out["roster"] = [e if e[0] == me else _for_phones(e) for e in out["roster"]]
            out.update({"you": me, "pid": conn.player.pid, "resumed": resumed})
        return out

    def stats(self) -> dict[str, Any]:
        lat = [v * 1000 for v in self.lateness]
        work = [v * 1000 for v in self.work]
        conns = list(self.conns.values()) + self.hosts
        return {
            "t": "stats", "tick": self.room.tick, "players": len(self.room.players),
            "connected": len(self.conns), "hosts": len(self.hosts), "npcs": len(self.room.npcs),
            "late_ms": {"p50": round(_pct(lat, 0.5), 3), "p99": round(_pct(lat, 0.99), 3), "max": round(max(lat, default=0), 3)},
            "work_ms": {"p50": round(_pct(work, 0.5), 3), "p99": round(_pct(work, 0.99), 3), "max": round(max(work, default=0), 3)},
            "samples": len(lat), "overruns": self.overruns,
            "snaps_skipped": sum(c.snaps_skipped for c in conns),
            "dropped_msgs": sum(c.dropped_msgs for c in conns),
            "dropped_cmds": sum(p.dropped for p in self.room.players.values()),
            "bytes_out": sum(c.bytes_out for c in conns),
            "rooms": len(self.hub.rooms), "sockets": self.hub.total,
        }


# ─────────────────────────────────────────── Hub ───────────────────────────────────────────


class Hub:
    """All rooms and sockets of this process."""

    def __init__(self, verifier: Verifier | None = None, limits: Limits | None = None,
                 clock: Callable[[], float] = time.monotonic) -> None:
        self.verifier: Verifier = verifier or SupabaseVerifier()
        self.limits = limits or Limits.from_env()
        self.clock = clock
        self.rooms: dict[str, RoomRunner] = {}
        self.total = 0
        self.pending = 0
        self.per_ip: dict[str, int] = {}
        self.auth_fail: dict[str, lm.Bucket] = {}   # per address: failed token checks (10, then 1 per 2 s)
        extra = os.getenv("LIVE_MOVE_ORIGINS", "")
        self.origins = {o.strip().rstrip("/") for o in extra.split(",") if o.strip()}

    def forget(self, runner: RoomRunner) -> None:
        if self.rooms.get(runner.game_id) is runner:
            del self.rooms[runner.game_id]

    def origin_ok(self, ws: WebSocket) -> bool:
        """No Origin (a native client), the page's own host, or one listed in LIVE_MOVE_ORIGINS."""
        origin = ws.headers.get("origin")
        if not origin:
            return True
        if origin.rstrip("/") in self.origins:
            return True
        host = (ws.headers.get("host") or "").lower()
        return bool(host) and (urlsplit(origin).netloc or "").lower() == host

    def _auth_bucket(self, ip: str, now: float) -> lm.Bucket:
        b = self.auth_fail.get(ip)
        if b is None:
            if len(self.auth_fail) > 4096:
                self.auth_fail.clear()
            b = self.auth_fail[ip] = lm.Bucket(0.5, 10, now)
        return b

    # ── the endpoint ──

    async def serve(self, ws: WebSocket) -> None:
        limits = self.limits
        if not self.origin_ok(ws):
            await ws.close(CLOSE_FORBIDDEN)   # before accept: the handshake is refused (HTTP 403)
            return
        ip = visitor_ip(ws)  # type: ignore[arg-type]  (headers and client, as on a Request)
        await ws.accept()
        if self.total >= limits.max_conns or self.per_ip.get(ip, 0) >= limits.max_per_ip or self.pending >= limits.max_pending:
            await ws.close(CLOSE_SLOW_DOWN, "busy")
            return
        self.total += 1
        self.per_ip[ip] = self.per_ip.get(ip, 0) + 1
        self.pending += 1
        conn: Conn | None = None
        try:
            try:
                conn = await self._hello(ws, ip)
            finally:
                self.pending -= 1
            if conn is None:
                return
            conn.sender = asyncio.get_running_loop().create_task(conn.run_sender())
            await self._read(conn)
        finally:
            self.total -= 1
            left = self.per_ip.get(ip, 1) - 1
            if left > 0:
                self.per_ip[ip] = left
            else:
                self.per_ip.pop(ip, None)
            if conn is not None:
                if conn.runner is not None:
                    conn.runner.detach(conn)
                conn.close(1000, "")
                if conn.sender is not None:
                    try:
                        await asyncio.wait_for(conn.sender, 2.0)
                    except Exception:
                        conn.sender.cancel()

    async def _hello(self, ws: WebSocket, ip: str) -> Conn | None:
        """The first message → an attached Conn (welcome queued), or the socket closed with the reason."""
        limits = self.limits
        try:
            msg = await asyncio.wait_for(ws.receive(), limits.hello_timeout)
        except asyncio.TimeoutError:
            await ws.close(CLOSE_TIMEOUT, "hello_timeout")
            return None
        if msg.get("type") == "websocket.disconnect":
            return None
        text = msg.get("text")
        try:
            if not isinstance(text, str) or len(text) > limits.hello_max:
                raise Refused(CLOSE_BAD_REQUEST, "hello")
            try:
                hello = json.loads(text)
            except ValueError:
                raise Refused(CLOSE_BAD_REQUEST, "hello") from None
            if not isinstance(hello, dict) or hello.get("t") != "hello" or hello.get("v") != lm.PROTOCOL_VERSION:
                raise Refused(CLOSE_BAD_REQUEST, "hello")
            role = hello.get("role")
            game = hello.get("game")
            token = hello.get("token")
            if role not in ("player", "host") or not isinstance(game, str) or not isinstance(token, str):
                raise Refused(CLOSE_BAD_REQUEST, "hello")
            game = game.lower()
            if not _UUID_RE.match(game) or not _TOKEN_RE.match(token):
                raise Refused(CLOSE_BAD_TOKEN, "bad_token")
            conn = Conn(ws, ip, self.clock(), limits)
            if role == "host":
                await self._join_host(conn, game, token)
            else:
                await self._join_player(conn, game, token)
            return conn
        except Refused as exc:
            await ws.close(exc.code, exc.reason)
            return None

    async def _check(self, ip: str, game: str, token: str, role: str) -> Identity:
        now = self.clock()
        bucket = self._auth_bucket(ip, now)
        if bucket.level(now) < 1:   # this address failed too many checks: no more calls to Supabase for now
            raise Refused(CLOSE_SLOW_DOWN, "auth_rate")
        try:
            ident = await self.verifier.verify(game, token, role)
        except Refused as exc:
            if exc.code in (CLOSE_BAD_TOKEN, CLOSE_FORBIDDEN):
                bucket.take(self.clock())
            raise
        if ident.state == "ended":
            raise Refused(CLOSE_ENDED, "ended")
        return ident

    async def _join_host(self, conn: Conn, game: str, token: str) -> None:
        thash = token_hash(token)
        runner = self.rooms.get(game)
        if runner is None or runner.host_hash != thash:
            await self._check(conn.ip, game, token, "host")
            runner = self.rooms.get(game)   # another host socket may have opened it meanwhile
        if runner is not None and runner.host_hash != thash:
            raise Refused(CLOSE_BAD_TOKEN, "bad_token")
        if runner is None:
            if len(self.rooms) >= self.limits.max_rooms:
                raise Refused(CLOSE_SLOW_DOWN, "rooms_full")
            runner = RoomRunner(self, game, thash, token, self.clock())
            self.rooms[game] = runner
            runner.task = asyncio.get_running_loop().create_task(runner.run())
            log.info("live_move: room %s opened", game[:8])
        if len(runner.hosts) >= self.limits.max_hosts:
            raise Refused(CLOSE_FULL, "hosts_full")
        conn.role = "host"
        conn.runner = runner
        runner.hosts.append(conn)
        runner.host_left_at = None
        conn.send_json(runner.welcome(conn))

    async def _join_player(self, conn: Conn, game: str, token: str) -> None:
        runner = self.rooms.get(game)
        if runner is None:
            raise Refused(CLOSE_NO_ROOM, "no_room")
        thash = token_hash(token)
        known = runner.room.by_pid.get(runner.known.get(thash, ""))
        if known is not None:   # a reconnect: this token was checked when the player first came
            ident = Identity("player", known.pid, known.name, known.look, "")
        else:
            ident = await self._check(conn.ip, game, token, "player")
            if self.rooms.get(game) is not runner or runner.closed:
                raise Refused(CLOSE_NO_ROOM, "no_room")
        if ident.player_id in runner.banned:
            raise Refused(CLOSE_FORBIDDEN, "kicked")
        try:
            player, resumed = runner.attach_player(conn, ident, thash)
        except OverflowError:
            raise Refused(CLOSE_FULL, "room_full") from None
        conn.send_json(runner.welcome(conn, resumed))

    # ── after the hello ──

    async def _read(self, conn: Conn) -> None:
        ws = conn.ws
        limits = self.limits
        while True:
            msg = await ws.receive()
            if msg.get("type") == "websocket.disconnect":
                return
            now = self.clock()
            conn.last_rx = now
            runner = conn.runner
            if runner is None or runner.closed or conn.closed:
                continue   # closing: drain until the peer's close arrives
            data = msg.get("bytes")
            if data is not None:
                if conn.role != "player":
                    conn.close(CLOSE_BAD_REQUEST, "binary")
                elif len(data) > limits.binary_max:
                    conn.close(CLOSE_TOO_BIG, "too_big")
                elif not conn.msg_bucket.take(now):
                    conn.violation(now)
                else:
                    self._on_input(conn, data, now)
                continue
            text = msg.get("text")
            if text is None:
                continue
            if len(text) > (limits.host_text_max if conn.role == "host" else limits.player_text_max):
                conn.close(CLOSE_TOO_BIG, "too_big")
            elif not conn.text_bucket.take(now):
                conn.violation(now)
            else:
                self._on_text(conn, text)

    def _on_input(self, conn: Conn, data: bytes, now: float) -> None:
        try:
            first, cmds = lm.decode_input(data)
        except lm.ProtocolError:
            conn.close(CLOSE_BAD_REQUEST, "input")
            return
        keep = 0
        for _ in cmds:
            if not conn.cmd_bucket.take(now):
                break
            keep += 1
        if keep < len(cmds):
            conn.violation(now)
        if keep and conn.player is not None and conn.runner is not None:
            conn.runner.room.push_commands(conn.player, first, cmds[:keep])

    def _on_text(self, conn: Conn, text: str) -> None:
        try:
            obj = json.loads(text)
        except ValueError:
            conn.close(CLOSE_BAD_REQUEST, "json")
            return
        if not isinstance(obj, dict):
            conn.close(CLOSE_BAD_REQUEST, "json")
            return
        runner = conn.runner
        assert runner is not None
        kind = obj.get("t")
        if kind == "ping":
            c = obj.get("c")
            conn.send_json({"t": "pong", "c": c if isinstance(c, (int, float)) and not isinstance(c, bool) else None,
                            "tick": runner.room.tick, "ms": runner.room.t_ms()})
        elif kind == "cmd" and conn.role == "host":
            self._host_cmd(conn, runner, obj)
        else:
            conn.send_json({"t": "err", "code": "unknown"})

    def _host_cmd(self, conn: Conn, runner: RoomRunner, obj: dict[str, Any]) -> None:
        room = runner.room
        op = obj.get("op")
        if op == "npc":
            room.remove_npcs()
            n = obj.get("n", 1)
            if obj.get("on") and isinstance(n, int) and not isinstance(n, bool):
                for _ in range(max(0, min(lm.MAX_NPCS, n))):
                    room.add_npc(str(obj.get("kind") or "chaser")[:16])
        elif op == "freeze":
            room.frozen_all = bool(obj.get("on"))
            room.emit({"t": "freeze", "on": room.frozen_all})
        elif op == "map":
            try:
                room.set_map(lm.parse_map(obj.get("map")))
            except lm.MapError as exc:
                conn.send_json({"t": "err", "code": "map", "why": str(exc)[:120]})
        elif op == "respawn":
            room.respawn()
        elif op == "kick":
            pid = obj.get("pid")
            if isinstance(pid, str) and _UUID_RE.match(pid.lower()):
                runner.kick(pid.lower())
        elif op == "say":
            payload = obj.get("data")
            text = _dumps({"t": "say", "data": payload})
            if len(text) > self.limits.say_max:
                conn.send_json({"t": "err", "code": "say_too_big"})
            else:
                room.emit({"t": "say", "data": payload})
        elif op == "zones":
            conn.send_json({"t": "zones", "tick": room.tick, "z": room.zones()})
        elif op == "stats":
            conn.send_json(runner.stats())
            if obj.get("reset"):
                runner.lateness.clear()
                runner.work.clear()
                runner.overruns = 0
        elif op == "end":
            runner.close(CLOSE_ENDED, "ended")
        else:
            conn.send_json({"t": "err", "code": "op"})


router = APIRouter()
hub = Hub()


@router.websocket(WS_PATH)
async def live_move_ws(websocket: WebSocket) -> None:
    await hub.serve(websocket)
