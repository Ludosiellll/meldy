"""A whole «Встань на ответ» game on this machine, for the projector page (LOCAL ONLY, never the Space's app).

The real room (live_move_api's socket and live_move_stand) with the game's database in memory
(tests/live_stand_fake.FakeLiveDb), the live RPCs the projector calls (live_host_state, live_next, live_kick,
live_end) answered at /rest/v1/rpc/<name> as PostgREST would, and N bots that join, walk about in the lobby and run
to a zone in each question over the socket, as phones do.

    python backend/scripts/live_stand_local.py --bots 30 --port 8000

Then run the frontend with VITE_SUPABASE_URL=http://127.0.0.1:8000 and /api proxied to this port with WebSockets
(frontend/scripts/stand-local.mjs does both), and open /live/<game> with the host token in sessionStorage:
the script prints both. Refuses to start without --local.

    python backend/scripts/live_stand_local.py --local --auto --record game.json

plays the teacher itself (start, next after each reveal and top five, the end) and records what a projector
receives: every message of a host socket with its time, and the database's host state whenever it changes. The
projector page replays such a file frame by frame (stand-local.mjs replay) for a smooth video on a machine without
a GPU.
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import json
import math
import os
import random
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[1]))
sys.path.insert(0, str(HERE.parents[1] / "tests"))

import uvicorn  # noqa: E402
from fastapi import FastAPI, Request  # noqa: E402
from fastapi.responses import JSONResponse, Response  # noqa: E402
from websockets.asyncio.client import connect  # noqa: E402
from websockets.exceptions import ConnectionClosed  # noqa: E402

import live_move as lm  # noqa: E402
import live_move_api as api  # noqa: E402
from live_stand_fake import FakeLiveDb, FakeRefusal  # noqa: E402

GAME = "5a1d0c3e-7b2f-4c11-9a6e-1f0e2d3c4b5a"
HOST = "local-stand-host-token-".ljust(43, "h")

QUESTIONS = [
    ("Какая планета ближе всего к Солнцу?", ["Меркурий", "Венера", "Марс", "Земля"], 0),
    ("Сколько байт в килобайте по стандарту ГОСТ?", ["1000", "1024", "512"], 1),
    ("Какой уровень изоляции исключает фантомное чтение?", ["READ COMMITTED", "REPEATABLE READ", "SERIALIZABLE", "READ UNCOMMITTED"], 2),
    ("Столица Австралии", ["Сидней", "Канберра"], 1),
    ("Какой газ растения поглощают днём?", ["Кислород", "Азот", "Углекислый газ", "Водород"], 2),
    ("Сколько сторон у шестиугольника?", ["5", "6", "8", "7"], 1),
]

NAMES = ["Алина", "Артём", "Ева", "Миша", "Соня", "Тимур", "Вера", "Глеб", "Даша", "Егор", "Катя", "Лёва", "Маша",
         "Никита", "Оля", "Паша", "Рита", "Саша", "Таня", "Федя", "Юля", "Ярик", "Лиза", "Илья", "Дима", "Аня", "Костя",
         "Женя", "Вика", "Роман", "Полина", "Стас", "Ксюша", "Денис", "Настя", "Гоша", "Лена", "Марк", "Ира", "Влад"]
BODIES = ["round", "square", "drop", "bean", "cloud"]
COLOURS = ["blue", "yellow", "green", "pink", "sky", "orange", "violet", "teal"]
HATS = ["none", "cap", "beanie", "phones", "flower", "antenna", "bow", "none", "crown", "grad"]


def pid(i: int) -> str:
    return f"00000000-0000-4000-8000-{i:012d}"


def token(i: int) -> str:
    return f"P{i:02d}".ljust(43, "x")


class DbVerifier:
    """The token check against the fake database: the host gets its whole live_host_state, as SupabaseVerifier."""

    def __init__(self, db: FakeLiveDb) -> None:
        self.db = db

    async def verify(self, game, tok, role):
        await asyncio.sleep(0)
        if game != GAME:
            raise api.Refused(api.CLOSE_BAD_TOKEN, "bad_token")
        if role == "host" and tok == HOST:
            st = self.db.host_state_sync()
            return api.Identity("host", None, "", None, st["state"], st)
        if role == "player" and tok.startswith("P"):
            i = int(tok[1:3])
            p = self.db.players.get(pid(i))
            if p is not None and not p["kicked"]:
                return api.Identity("player", pid(i), p["name"], p["look"], self.db.state)
        raise api.Refused(api.CLOSE_BAD_TOKEN, "bad_token")


def zone_targets(rng: random.Random, zone: int) -> tuple[float, float]:
    """A spot inside zone `zone` (MODE_STAND §3), away from its edges."""
    x0, y0 = (80, 220) if zone in (0, 2) else (920, 220)
    if zone >= 2:
        y0 = 580
    return x0 + 60 + rng.random() * 480, y0 + 50 + rng.random() * 140


class Bot:
    """A phone: wanders in the lobby, runs to a zone in each question (mostly the right one), lets the stick go at
    zero, pings every 2 s. Some start late, some stay in the corridor, ghosts keep playing."""

    def __init__(self, i: int, url: str, db: FakeLiveDb, skill: float, seed: int) -> None:
        self.i = i
        self.url = url
        self.db = db
        self.skill = skill
        self.rng = random.Random(seed)
        self.ws = None
        self.you = None
        self.pos: tuple[float, float] | None = None
        self.state: dict | None = None
        self.target: tuple[float, float] | None = None
        self.plan_qi = -2
        self.start_at = 0.0
        self.seq = 0
        self.wander_until = 0.0

    async def run(self) -> None:
        while True:
            try:
                async with connect(self.url, max_queue=None) as ws:
                    self.ws = ws
                    await ws.send(json.dumps({"t": "hello", "v": 1, "game": GAME, "token": token(self.i), "role": "player"}))
                    welcome = json.loads(await asyncio.wait_for(ws.recv(), 5))
                    if welcome.get("t") != "welcome":
                        await asyncio.sleep(2)
                        continue
                    self.you = welcome.get("you")
                    await asyncio.gather(self._read(ws), self._drive(ws))
            except (ConnectionClosed, OSError, asyncio.TimeoutError):
                pass
            if self.db.state == "ended":
                return
            await asyncio.sleep(2 + self.rng.random())

    async def _read(self, ws) -> None:
        async for msg in ws:
            if isinstance(msg, bytes):
                snap = lm.decode_snapshot(msg)
                if snap is None:
                    continue
                for eid, x, y, _f in snap["ents"]:
                    if eid == self.you:
                        self.pos = (x / lm.Q, y / lm.Q)
                        break
                self.t = snap["t"]
            else:
                obj = json.loads(msg)
                if obj.get("t") == "stand" and obj.get("k") == "state":
                    self.state = obj

    def _plan(self, st: dict) -> None:
        qi = st["qi"]
        if qi == self.plan_qi:
            return
        self.plan_qi = qi
        q = self.db.questions[qi] if 0 <= qi < len(self.db.questions) else None
        n = len(st["q"]["options"]) if st.get("q") else 4
        roll = self.rng.random()
        if q is None:
            zone = None
        elif roll < self.skill:
            zone = q["key"]
        elif roll < 0.95:
            zone = self.rng.choice([z for z in range(n) if z != q["key"]] or [q["key"]])
        else:
            zone = None                                   # stays in the corridor
        self.target = zone_targets(self.rng, zone) if zone is not None else (700 + self.rng.random() * 200, 200 + self.rng.random() * 40)
        # most run at once; a few think first, a few change their mind at the end
        self.start_at = time.monotonic() + (self.rng.random() * 1.2 if self.rng.random() < 0.8 else 3 + self.rng.random() * 5)
        self.switch = None
        if zone is not None and self.rng.random() < 0.12 and n > 1:
            other = self.rng.choice([z for z in range(n) if z != zone])
            self.switch = (time.monotonic() + 3 + self.rng.random() * 4, zone_targets(self.rng, other))
            self.target = zone_targets(self.rng, other)
            self.final = zone_targets(self.rng, zone)
        else:
            self.final = self.target

    async def _drive(self, ws) -> None:
        last_ping = 0.0
        while True:
            await asyncio.sleep(0.05)
            now = time.monotonic()
            if now - last_ping > 2.0:
                last_ping = now
                await ws.send(json.dumps({"t": "ping", "c": 0}))
            st = self.state
            if st is None or self.pos is None:
                continue
            phase = st["phase"]
            target = None
            if phase in ("countdown", "open"):
                self._plan(st)
                if getattr(self, "t", 0) >= (st.get("closes") or 0) - 120:
                    continue                                  # zero: the stick is let go
                if now < self.start_at:
                    continue
                if self.switch is not None and now >= self.switch[0]:
                    self.target = self.final
                    self.switch = None
                target = self.target
            elif phase in ("lobby", "leaderboard", "podium") or (phase == "reveal" and st.get("floor") == "up"):
                if now > self.wander_until or self.target is None:
                    self.wander_until = now + 1.5 + self.rng.random() * 3
                    if self.rng.random() < 0.35:
                        self.target = None
                    else:
                        self.target = (80 + self.rng.random() * 1440, 200 + self.rng.random() * 640)
                target = self.target
            elif phase == "reveal":
                # a ghost drifts about over the holes
                target = self.target
            if target is None:
                continue
            dx, dy = target[0] - self.pos[0], target[1] - self.pos[1]
            d = math.hypot(dx, dy)
            if d < 24:
                continue
            # round the stage in the middle rather than push into it
            cx, cy = self.pos[0] - 800, self.pos[1] - 520
            if math.hypot(cx, cy) < 130:
                dx += cx * 1.5
                dy += cy * 1.5
                d = math.hypot(dx, dy) or 1
            self.seq += 1
            await ws.send(lm.encode_input(self.seq, [(round(127 * dx / d), round(127 * dy / d), 0)]))


class Recorder:
    """A host socket that plays the teacher (with --auto) and writes what a projector receives."""

    def __init__(self, url: str, db: FakeLiveDb, bots: int, auto: bool) -> None:
        self.url = url
        self.db = db
        self.bots = bots
        self.auto = auto
        self.t0 = time.monotonic()
        self.ws_log: list[list] = []          # [ms, "t" | "b", text or base64]
        self.db_log: list[list] = []          # [ms, host state]
        self.phase = "lobby"
        self.since = time.monotonic()
        self.done = asyncio.Event()

    def ms(self) -> float:
        return round((time.monotonic() - self.t0) * 1000.0, 1)

    async def run(self) -> None:
        async with connect(self.url, max_queue=None) as ws:
            self.t0 = time.monotonic()
            await ws.send(json.dumps({"t": "hello", "v": 1, "game": GAME, "token": HOST, "role": "host"}))
            reader = asyncio.get_running_loop().create_task(self._read(ws))
            try:
                await self._drive(ws)
            finally:
                reader.cancel()

    async def _read(self, ws) -> None:
        async for msg in ws:
            if isinstance(msg, bytes):
                self.ws_log.append([self.ms(), "b", base64.b64encode(msg).decode()])
            else:
                self.ws_log.append([self.ms(), "t", msg])
                obj = json.loads(msg)
                if obj.get("t") == "stand" and obj.get("k") == "state" and obj["phase"] != self.phase:
                    self.phase = obj["phase"]
                    self.since = time.monotonic()

    async def _drive(self, ws) -> None:
        last_rev = None
        last_roster = None
        last_ping = 0.0
        while True:
            await asyncio.sleep(0.1)
            now = time.monotonic()
            if now - last_ping > 2:
                last_ping = now
                await ws.send(json.dumps({"t": "ping", "c": 0}))
            st = self.db.host_state_sync()
            key = json.dumps([r["player_id"] for r in st["roster"]] + [r["frozen"] for r in st["roster"]])
            if st["rev"] != last_rev or key != last_roster:
                last_rev, last_roster = st["rev"], key
                self.db_log.append([self.ms(), st])
            if not self.auto:
                continue
            t = now - self.since
            moved = False
            if self.phase == "lobby" and len(self.db.players) >= self.bots and t > 4:
                moved = True
            elif self.phase == "reveal" and t > 7.5:
                moved = True
            elif self.phase == "leaderboard" and t > 5:
                moved = True
            elif self.phase == "podium" and t > 9:
                self.done.set()
                return
            if moved and self.db.state == self.phase:
                self.db.next()
                await ws.send(json.dumps({"t": "cmd", "op": "sync"}))
                self.since = now + 100          # until the room says the next phase

    def save(self, path: str) -> None:
        with open(path, "w") as f:
            json.dump({"game": GAME, "host_token": HOST, "ws": self.ws_log, "db": self.db_log}, f, ensure_ascii=False)


def make_app(db: FakeLiveDb) -> FastAPI:
    app = FastAPI()
    app.include_router(api.router)
    cors = {"access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*"}

    @app.options("/{rest:path}")
    async def preflight(rest: str) -> Response:
        return Response(status_code=204, headers=cors)

    @app.get("/auth/v1/health")
    async def health() -> Response:
        return JSONResponse({"ok": True}, headers=cors)

    def fail(e: FakeRefusal) -> JSONResponse:
        return JSONResponse({"code": e.code, "message": e.code, "details": e.details, "hint": None}, status_code=e.status, headers=cors)

    @app.post("/rest/v1/rpc/{name}")
    async def rpc(name: str, request: Request) -> Response:
        args = await request.json()
        if args.get("p_game") not in (None, GAME):
            return fail(FakeRefusal(404, "P0002", "game"))
        if "p_host_token" in args and args["p_host_token"] != HOST:
            return fail(FakeRefusal(403, "42501", "host"))
        try:
            if name == "live_host_state":
                return JSONResponse(db.host_state_sync(args.get("p_since_rev")), headers=cors)
            if name == "live_next":
                db.settle()
                if args.get("p_expect") != db.state:
                    return fail(FakeRefusal(409, "ML011", db.state))
                db.next()
                return JSONResponse(db.host_state_sync(), headers=cors)
            if name == "live_kick":
                db.kick(args["p_player"])
                return JSONResponse({"ok": True}, headers=cors)
            if name == "live_end":
                db.end()
                return JSONResponse({"ok": True}, headers=cors)
        except FakeRefusal as e:
            return fail(e)
        return fail(FakeRefusal(400, "22023", name))

    return app


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--local", action="store_true", help="required: this is a local tool")
    ap.add_argument("--bots", type=int, default=30)
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--time", type=int, default=15)
    ap.add_argument("--questions", type=int, default=4)
    ap.add_argument("--boss", default="clock", choices=["clock", "skeleton"])
    ap.add_argument("--join-s", type=float, default=12.0, help="the bots join over this many seconds")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--auto", action="store_true", help="play the teacher (start, next, the end)")
    ap.add_argument("--record", default="", help="write what a projector receives to this file (with --auto)")
    a = ap.parse_args()
    if not a.local:
        raise SystemExit("live_stand_local.py is a local tool: pass --local")
    os.environ.setdefault("LIVE_MOVE_ORIGINS", "http://127.0.0.1:3000,http://localhost:3000")
    qs = QUESTIONS[: a.questions]
    db = FakeLiveDb(GAME, HOST, [(len(o), k) for _t, o, k in qs], time_s=a.time, boss=a.boss)
    for q, (text, options, _k) in zip(db.questions, qs):
        q["text"] = text
        q["options"] = options
    api.hub = api.Hub(verifier=DbVerifier(db), limits=api.Limits(), source=db)
    api.hub.origins |= {o for o in os.environ["LIVE_MOVE_ORIGINS"].split(",") if o}
    app = make_app(db)
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=a.port, log_level="warning", lifespan="off", ws_max_size=65536))
    task = asyncio.create_task(server.serve())
    while not server.started:
        await asyncio.sleep(0.05)
    url = f"ws://127.0.0.1:{a.port}{api.WS_PATH}"
    print(json.dumps({"game": GAME, "host_token": HOST, "url": url}), flush=True)
    rng = random.Random(a.seed)
    bots: list[asyncio.Task] = []
    recorder = Recorder(url, db, a.bots, a.auto) if (a.auto or a.record) else None
    rec_task = asyncio.create_task(recorder.run()) if recorder else None
    # the bots join once the projector has opened the room (a phone before the host gets 4404 and retries anyway)
    while GAME not in api.hub.rooms:
        await asyncio.sleep(0.2)
    if recorder:
        await asyncio.sleep(2.0)                      # a moment of the empty arena first
    for i in range(a.bots):
        look = {"body": BODIES[(i * 3) % 5], "colour": COLOURS[(i * 5 + 1) % 8], "eyes": "round", "hat": HATS[(i * 7 + 2) % len(HATS)]}
        db.join(pid(i), NAMES[i % len(NAMES)], look)
        skill = 0.45 + rng.random() * 0.45
        bots.append(asyncio.create_task(Bot(i, url, db, skill, a.seed * 100 + i).run()))
        await asyncio.sleep(a.join_s / max(1, a.bots) * (0.5 + rng.random()))
    if recorder and a.auto:
        await recorder.done.wait()
        if a.record:
            recorder.save(a.record)
            print(json.dumps({"recorded": a.record, "messages": len(recorder.ws_log), "states": len(recorder.db_log)}), flush=True)
        server.should_exit = True
        for t in bots:
            t.cancel()
        if rec_task:
            rec_task.cancel()
    await task


if __name__ == "__main__":
    asyncio.run(main())
