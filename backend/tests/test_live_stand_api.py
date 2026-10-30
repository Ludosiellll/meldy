"""Mode A «Встань на ответ» through the real WebSocket app (live_move_api on uvicorn) with the database in memory
(live_stand_fake.FakeLiveDb): a whole game of 40 bots that run to their zones over the socket (two questions, the
leaderboard, the podium, the end), the tick's cost with 40 players, the host's «sync», retries of the write, a room
that comes late, a reconnect, the commands a stand room refuses, and a battle game's room left plain."""
import asyncio
import contextlib
import json
import math
import sys
from pathlib import Path

import pytest
import uvicorn
from fastapi import FastAPI
from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import live_move as lm  # noqa: E402
import live_move_api as api  # noqa: E402
import live_move_stand as stand  # noqa: E402
from live_stand_fake import FakeLiveDb  # noqa: E402

GAME = "11111111-2222-4333-8444-555555555555"
HOST = "H" * 43
CENTRE = {0: (380.0, 340.0), 1: (1220.0, 340.0), 2: (380.0, 700.0), 3: (1220.0, 700.0)}


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
            if pid(i) in self.db.players:
                return api.Identity("player", pid(i), f"p{i}", {"body": "round"}, self.db.state)
        raise api.Refused(api.CLOSE_BAD_TOKEN, "bad_token")


@pytest.fixture(autouse=True)
def quick(monkeypatch):
    monkeypatch.setattr(stand, "FLOOR_MS", 1200)
    monkeypatch.setattr(stand.StandMode, "poll_s", 0.25)


@contextlib.asynccontextmanager
async def serving(db: FakeLiveDb):
    app = FastAPI()
    app.include_router(api.router)
    old = api.hub
    api.hub = api.Hub(verifier=DbVerifier(db), limits=api.Limits(), source=db)
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=0, log_level="warning", lifespan="off"))
    task = asyncio.create_task(server.serve())
    try:
        while not server.started:
            await asyncio.sleep(0.01)
        port = server.servers[0].sockets[0].getsockname()[1]
        yield f"ws://127.0.0.1:{port}{api.WS_PATH}", api.hub
    finally:
        for runner in list(api.hub.rooms.values()):
            runner.close(api.CLOSE_ROOM_CLOSED, "test_end")
        server.should_exit = True
        await task
        api.hub = old


def run(coro, within=90):
    return asyncio.run(asyncio.wait_for(coro, within))


class Client:
    """A socket that keeps reading: the latest snapshot, every stand message, the close code."""

    def __init__(self, ws, welcome):
        self.ws = ws
        self.welcome = welcome
        self.you = welcome.get("you")
        self.snap = None
        self.msgs: list[dict] = []
        self.events: list[dict] = []
        self.closed: int | None = None
        self.task = asyncio.get_running_loop().create_task(self._read())

    async def _read(self):
        try:
            async for msg in self.ws:
                if isinstance(msg, bytes):
                    self.snap = lm.decode_snapshot(msg)
                else:
                    obj = json.loads(msg)
                    (self.msgs if obj.get("t") == "stand" else self.events).append(obj)
        except ConnectionClosed as exc:
            self.closed = exc.rcvd.code if exc.rcvd else None
        else:
            self.closed = self.ws.close_code

    def stand(self, k: str) -> list[dict]:
        return [m for m in self.msgs if m["k"] == k]

    def state(self) -> dict | None:
        states = self.stand("state")
        return states[-1] if states else None

    def me(self) -> dict | None:
        mes = self.stand("me")
        return mes[-1] if mes else None

    def mine(self):
        if self.snap is None:
            return None
        for eid, x, y, flags in self.snap["ents"]:
            if eid == self.you:
                return x / lm.Q, y / lm.Q, flags
        return None

    def flags_of(self, eid: int) -> int:
        for e, _x, _y, flags in self.snap["ents"]:
            if e == eid:
                return flags
        raise KeyError(eid)

    async def wait(self, pred, within=12.0, what=""):
        loop = asyncio.get_running_loop()
        end = loop.time() + within
        while not pred(self):
            if loop.time() > end:
                raise AssertionError(f"timed out waiting for {what}: last state {self.state()}")
            await asyncio.sleep(0.02)

    async def close(self):
        await self.ws.close()
        self.task.cancel()


async def join(url, tok, role="player") -> Client:
    ws = await connect(url, max_queue=None)
    await ws.send(json.dumps({"t": "hello", "v": 1, "game": GAME, "token": tok, "role": role}))
    welcome = json.loads(await asyncio.wait_for(ws.recv(), 5))
    assert welcome["t"] == "welcome", welcome
    return Client(ws, welcome)


class Bot:
    """A phone that runs its character to a zone (or stays) with real joystick commands, 20 a second, and lets the
    stick go at zero as MoveClient does."""

    def __init__(self, client: Client) -> None:
        self.c = client
        self.target: int | None = None
        self.seq = 0
        self.task = asyncio.get_running_loop().create_task(self._drive())

    async def _drive(self):
        loop = asyncio.get_running_loop()
        last_ping = 0.0
        while True:
            await asyncio.sleep(0.05)
            if loop.time() - last_ping > 2.0:                # as MoveClient: a socket silent for 15 s is dropped
                last_ping = loop.time()
                try:
                    await self.c.ws.send(json.dumps({"t": "ping", "c": 0}))
                except ConnectionClosed:
                    return
            st, me = self.c.state(), self.c.mine()
            if st is None or me is None or self.target is None or st["phase"] not in ("countdown", "open"):
                continue
            if self.c.snap["t"] >= st["closes"]:
                continue                                    # zero: the stick is let go
            tx, ty = CENTRE[self.target]
            dx, dy = tx - me[0], ty - me[1]
            d = math.hypot(dx, dy)
            if d < 30:
                continue
            self.seq += 1
            jx, jy = round(127 * dx / d), round(127 * dy / d)
            try:
                await self.c.ws.send(lm.encode_input(self.seq, [(jx, jy, 0)]))
            except ConnectionClosed:
                return

    def stop(self):
        self.task.cancel()


def zone_of(flags: int) -> int:
    return flags >> lm.ZONE_SHIFT


# ─────────────── a whole game, 40 phones ───────────────


def test_a_whole_stand_game_with_40_bots_over_the_socket():
    n = 40

    async def scenario():
        db = FakeLiveDb(GAME, HOST, [(4, 1), (3, 2)], time_s=15, countdown_s=1.0, open_s=5.0)
        for i in range(n):
            db.join(pid(i), f"p{i}")
        async with serving(db) as (url, hub):
            host = await join(url, HOST, "host")
            assert hub.rooms[GAME].mode.kind == "stand"
            assert host.welcome["map"]["zones"][1]["id"] == "Б"
            phones = [await join(url, token(i)) for i in range(n)]
            bots = [Bot(c) for c in phones] + [Bot(host)]    # the projector pings too
            await host.wait(lambda c: c.stand("hello") and c.state() and c.state()["phase"] == "lobby", what="lobby")
            hello = host.stand("hello")[0]
            assert hello["boss"] == "clock" and hello["q_count"] == 2 and hello["time_s"] == 15
            runner = hub.rooms[GAME]
            # Question 0 (key Б): bots i % 4 run to zone i % 4; every 10th stays in the corridor.
            for i, b in enumerate(bots[:n]):
                b.target = None if i % 10 == 9 else i % 4
            db.next()
            await host.ws.send(json.dumps({"t": "cmd", "op": "sync"}))
            await host.wait(lambda c: c.state()["phase"] == "countdown", within=3, what="countdown after sync")
            st = host.state()
            assert st["q"]["text"] == "Вопрос 1" and st["closes"] - st["opens"] == pytest.approx(5000, abs=60)
            assert st["res"] is None and "key" not in json.dumps(st)
            await host.wait(lambda c: c.state()["phase"] == "reveal", within=12, what="reveal 0")
            res = host.state()["res"]
            assert res["key"] == 1 and host.state()["floor"] == "down"
            # Who was right is where they stood: the runners at their zones, a stayer wherever its spawn was.
            stored = {k[1]: a for k, a in db.answers.items() if k[0] == 0}
            movers = [i for i in range(n) if i % 10 != 9]
            assert set(stored) >= {pid(i) for i in movers} and all(stored[pid(i)]["c"] == i % 4 for i in movers)
            right = [i for i in range(n) if pid(i) in stored and stored[pid(i)]["c"] == 1]
            wrong = [i for i in range(n) if i not in right]
            ids = {i: phones[i].you for i in range(n)}
            assert sorted(res["fell"]) == sorted(ids[i] for i in wrong)
            assert res["stood"] == len(right) and res["of"] == n and res["back"] == []
            assert {e for e, _ in res["pts"]} == {ids[i] for i in right}
            assert res["fastest"]["id"] in {ids[i] for i in right}
            for i in right:
                assert stored[pid(i)]["pts"] == stand.stand_points(stored[pid(i)]["e"], 15, 1, True, False)
            for i, c in enumerate(phones):
                await c.wait(lambda c: c.me() is not None and c.me()["last"]["qi"] == 0, within=3, what=f"me {i}")
                me = c.me()
                assert me["last"]["ok"] == (i in right) and me["ghost"] == (i in wrong)
                assert c.state()["res"]["key"] == 1 and "pts" not in c.state()["res"]
            await host.wait(lambda c: all(c.flags_of(ids[i]) & lm.F_GHOST for i in wrong), within=2, what="ghost flags")
            await host.wait(lambda c: c.state()["floor"] == "up", within=4, what="floor up")
            # Leaderboard, then question 1 (key В, three options): ghosts i % 3 == 2 come back.
            db.next()
            await host.ws.send(json.dumps({"t": "cmd", "op": "sync"}))
            await host.wait(lambda c: c.state()["phase"] == "leaderboard", within=3, what="leaderboard")
            top = host.state()["top"]
            assert len(top) == 5 and top[0]["pts"] >= top[-1]["pts"] and top[0]["id"] in {ids[i] for i in right}
            for i, b in enumerate(bots[:n]):
                b.target = i % 3
            db.next()
            await host.ws.send(json.dumps({"t": "cmd", "op": "sync"}))
            await host.wait(lambda c: c.state()["phase"] == "reveal" and c.state()["qi"] == 1, within=14, what="reveal 1")
            res = host.state()["res"]
            revived = [i for i in wrong if i % 3 == 2]
            assert res["key"] == 2 and sorted(res["back"]) == sorted(ids[i] for i in revived)
            for i in revived:
                await phones[i].wait(lambda c: c.me()["last"]["qi"] == 1, within=3, what="me 1")
                assert phones[i].me()["last"]["revived"] and phones[i].me()["last"]["pts"] <= 500
            await host.wait(lambda c: c.state()["floor"] == "up", within=4, what="floor up 1")
            await host.wait(lambda c: not any(c.flags_of(ids[i]) & lm.F_GHOST for i in revived), within=1, what="revived")
            # The podium after the last question; then the end.
            db.next()
            await host.ws.send(json.dumps({"t": "cmd", "op": "sync"}))
            await host.wait(lambda c: c.state()["phase"] == "podium", within=3, what="podium")
            assert host.state()["acc"] == db.host_state_sync()["final"]["accuracy_pct"]
            for c in phones[:3]:
                await c.wait(lambda c: c.state()["phase"] == "podium", within=3, what="podium phone")
            await host.ws.send(json.dumps({"t": "cmd", "op": "stats"}))
            await host.wait(lambda c: any(e.get("t") == "stats" for e in c.events), within=3, what="stats")
            stats = [e for e in host.events if e.get("t") == "stats"][-1]
            print(f"\n40 players, stand mode: tick work p50 {stats['work_ms']['p50']} ms, p99 {stats['work_ms']['p99']} ms, "
                  f"max {stats['work_ms']['max']} ms over {stats['samples']} ticks; lateness p99 {stats['late_ms']['p99']} ms; "
                  f"database calls: {db.calls}")
            assert stats["mode"] == "stand" and stats["players"] == n and stats["dropped_cmds"] == 0
            # Wall time inside the tick, bots in the same process: a loaded machine's preemption shows here. The
            # budget (p99 ≤ 3 ms of the tick's own CPU) is asserted by test_live_stand.py; this catches a regression.
            assert stats["work_ms"]["p50"] <= 1.0 and stats["work_ms"]["p99"] <= 10.0
            per_phone = [len(c.msgs) for c in phones]
            assert max(per_phone) <= 20            # mode messages are rare: about seven a question
            db.end()
            await host.ws.send(json.dumps({"t": "cmd", "op": "sync"}))
            await host.wait(lambda c: c.closed is not None, within=4, what="room closed")
            assert host.closed == api.CLOSE_ENDED and host.state()["phase"] == "ended"
            for b in bots:
                b.stop()
            assert runner.mode.write_errors == 0 and db.calls["stand_close"] >= 2
    run(scenario(), within=120)


# ─────────────── the parts ───────────────


def test_the_write_is_retried_and_a_retry_is_safe():
    async def scenario():
        db = FakeLiveDb(GAME, HOST, [(2, 0)], countdown_s=0.3, open_s=0.8)
        db.join(pid(0))
        db.fail_close = 2
        async with serving(db) as (url, hub):
            host = await join(url, HOST, "host")
            phone = await join(url, token(0))
            hub.rooms[GAME].room.by_pid[pid(0)].x, hub.rooms[GAME].room.by_pid[pid(0)].y = CENTRE[0]
            db.next()
            await host.ws.send(json.dumps({"t": "cmd", "op": "sync"}))
            await phone.wait(lambda c: c.me() is not None, within=6, what="the result after two failures")
            assert db.calls["stand_close"] == 3 and phone.me()["last"]["ok"] and phone.me()["pts"] == 1000
            assert hub.rooms[GAME].mode.write_errors == 2
    run(scenario())


def test_a_room_that_comes_late_shows_the_stored_result():
    async def scenario():
        db = FakeLiveDb(GAME, HOST, [(4, 3), (2, 0)], countdown_s=0.0, open_s=0.0)
        for i in range(3):
            db.join(pid(i))
        db.next()
        db.stand_close_sync(0, [{"p": pid(0), "c": 3, "e": 900}, {"p": pid(1), "c": 0, "e": 500}])
        assert db.state == "reveal"
        async with serving(db) as (url, hub):
            host = await join(url, HOST, "host")
            phone = await join(url, token(1))
            await host.wait(lambda c: c.state() and c.state()["phase"] == "reveal", within=3, what="reveal from the database")
            res = host.state()["res"]
            room = hub.rooms[GAME].room
            assert res["key"] == 3 and res["stood"] == 1 and res["counts"] == [1, 0, 0, 1]
            await phone.wait(lambda c: c.me() is not None and c.snap is not None, within=3, what="me")
            assert phone.me()["ghost"] and phone.me()["last"]["choice"] == 0 and phone.me()["last"]["fell"]
            assert phone.mine()[2] & lm.F_GHOST and room.by_pid[pid(1)].id == phone.you
    run(scenario())


def test_a_reconnect_gets_hello_state_and_its_numbers_again():
    async def scenario():
        db = FakeLiveDb(GAME, HOST, [(2, 1)], countdown_s=0.2, open_s=0.6)
        db.join(pid(0))
        async with serving(db) as (url, hub):
            host = await join(url, HOST, "host")
            phone = await join(url, token(0))
            p = hub.rooms[GAME].room.by_pid[pid(0)]
            p.x, p.y = CENTRE[1]
            db.next()
            await host.ws.send(json.dumps({"t": "cmd", "op": "sync"}))
            await phone.wait(lambda c: c.me() is not None, within=5, what="result")
            await phone.close()
            again = await join(url, token(0))
            assert again.welcome["resumed"] is True
            await again.wait(lambda c: c.stand("hello") and c.state() and c.me(), within=2, what="hello, state, me")
            kinds = [m["k"] for m in again.msgs][:3]
            assert kinds == ["hello", "state", "me"] and again.me()["pts"] == 1000
            assert again.state()["phase"] == "reveal"
    run(scenario())


def test_a_stand_room_keeps_its_arena_and_has_no_monster():
    async def scenario():
        db = FakeLiveDb(GAME, HOST, [(2, 1)])
        async with serving(db) as (url, hub):
            host = await join(url, HOST, "host")
            for op in ({"op": "map", "map": {"w": 400, "h": 400}}, {"op": "npc", "on": True}):
                await host.ws.send(json.dumps({"t": "cmd", **op}))
            await host.wait(lambda c: len([e for e in c.events if e.get("t") == "err"]) == 2, within=2, what="refusals")
            assert [e["code"] for e in host.events if e.get("t") == "err"] == ["op", "op"]
            room = hub.rooms[GAME].room
            assert not room.npcs and room.map.w == 1600 and [z.id for z in room.map.zones] == ["А", "Б", "В", "Г"]
    run(scenario())


def test_a_battle_game_gets_the_battle_room_with_the_arena():
    """Every battle gets the battle's room (live_move_mixed, no movement rounds without stand_every): its 3D projector
    stands the phones' characters round the boss on the arena's map."""
    async def scenario():
        db = FakeLiveDb(GAME, HOST, [(2, 1)])
        orig = db.host_state_sync

        def battle(since_rev=None):
            st = orig(since_rev)
            if "settings" in st:
                st["settings"] = dict(st["settings"], mode="boss")
            return st
        db.host_state_sync = battle
        async with serving(db) as (url, hub):
            host = await join(url, HOST, "host")
            await asyncio.sleep(0.3)
            mode = hub.rooms[GAME].mode
            assert mode is not None and mode.kind == "mixed" and mode.game.every == 0
            assert host.welcome["map"]["zones"][0]["id"] == "А"      # the arena of «Встань на ответ»
    run(scenario())
