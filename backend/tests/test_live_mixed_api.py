"""The battle with movement rounds through the real WebSocket app (live_move_api on uvicorn) with the database in memory
(live_mixed_fake.FakeMixedDb): a whole game of 30 bots and 6 questions with every 3rd a movement round — taps on the
button questions, running to the zones over the socket on the movement rounds — then the database's HP and points
against the mirror replayed over the stored answers; no snapshots between movement rounds; nobody a ghost after the
floor returns; the ice; a write that never comes (a void round); a battle without movement rounds left plain."""
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
import live_move_mixed as mixed  # noqa: E402
import live_move_stand as stand  # noqa: E402
from live_mixed_fake import FakeMixedDb  # noqa: E402

GAME = "11111111-2222-4333-8444-555555555555"
HOST = "H" * 43
CENTRE = {0: (380.0, 340.0), 1: (1220.0, 340.0), 2: (380.0, 700.0), 3: (1220.0, 700.0)}
QUESTIONS = [(4, 1), (3, 2), (4, 1), (2, 0), (3, 0), (4, 3)]


def pid(i: int) -> str:
    return f"00000000-0000-4000-8000-{i:012d}"


def token(i: int) -> str:
    return f"P{i:02d}".ljust(43, "x")


class DbVerifier:
    def __init__(self, db: FakeMixedDb) -> None:
        self.db = db

    async def verify(self, game, tok, role):
        await asyncio.sleep(0)
        if game != GAME:
            raise api.Refused(api.CLOSE_BAD_TOKEN, "bad_token")
        if role == "host" and tok == HOST:
            st = self.db.host_state_sync()
            return api.Identity("host", None, "", None, st["state"], st)
        if role == "player" and tok.startswith("P") and pid(int(tok[1:3])) in self.db.players:
            i = int(tok[1:3])
            return api.Identity("player", pid(i), f"p{i}", {"body": "round"}, self.db.state)
        raise api.Refused(api.CLOSE_BAD_TOKEN, "bad_token")


@pytest.fixture(autouse=True)
def quick(monkeypatch):
    monkeypatch.setattr(stand, "FLOOR_MS", 1200)
    monkeypatch.setattr(mixed.MixedMode, "poll_s", 0.25)


@contextlib.asynccontextmanager
async def serving(db):
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


class Phone:
    """A socket that keeps reading (the latest snapshot, how many came, every stand message) and, while a movement
    round runs, drives its character to a zone with real joystick commands as MoveClient does."""

    def __init__(self, ws, welcome):
        self.ws = ws
        self.welcome = welcome
        self.you = welcome.get("you")
        self.snap = None
        self.snaps = 0
        self.msgs: list[dict] = []
        self.events: list[dict] = []
        self.closed: int | None = None
        self.target: int | None = None
        self.seq = 0
        loop = asyncio.get_running_loop()
        self.reader = loop.create_task(self._read())
        self.driver = loop.create_task(self._drive())

    async def _read(self):
        try:
            async for msg in self.ws:
                if isinstance(msg, bytes):
                    self.snap = lm.decode_snapshot(msg)
                    self.snaps += 1
                else:
                    obj = json.loads(msg)
                    (self.msgs if obj.get("t") == "stand" else self.events).append(obj)
        except ConnectionClosed as exc:
            self.closed = exc.rcvd.code if exc.rcvd else None

    async def _drive(self):
        loop = asyncio.get_running_loop()
        last_ping = 0.0
        while True:
            await asyncio.sleep(0.05)
            if loop.time() - last_ping > 2.0:
                last_ping = loop.time()
                try:
                    await self.ws.send(json.dumps({"t": "ping", "c": 0}))
                except ConnectionClosed:
                    return
            st, me = self.state(), self.mine()
            if (st is None or me is None or self.target is None or st.get("round") != "stand"
                    or st["phase"] not in ("countdown", "open") or self.snap["t"] >= st["closes"]):
                continue
            tx, ty = CENTRE[self.target]
            dx, dy = tx - me[0], ty - me[1]
            d = math.hypot(dx, dy)
            if d < 30:
                continue
            self.seq += 1
            try:
                await self.ws.send(lm.encode_input(self.seq, [(round(127 * dx / d), round(127 * dy / d), 0)]))
            except ConnectionClosed:
                return

    def stand(self, k):
        return [m for m in self.msgs if m["k"] == k]

    def state(self):
        s = self.stand("state")
        return s[-1] if s else None

    def me(self):
        s = self.stand("me")
        return s[-1] if s else None

    def mine(self):
        if self.snap is None:
            return None
        for eid, x, y, flags in self.snap["ents"]:
            if eid == self.you:
                return x / lm.Q, y / lm.Q, flags
        return None

    def flags_of(self, eid):
        for e, _x, _y, f in self.snap["ents"]:
            if e == eid:
                return f
        raise KeyError(eid)

    async def wait(self, pred, within=12.0, what=""):
        loop = asyncio.get_running_loop()
        end = loop.time() + within
        while not pred(self):
            if loop.time() > end:
                raise AssertionError(f"timed out waiting for {what}: last state {self.state()}")
            await asyncio.sleep(0.02)

    async def close(self):
        self.driver.cancel()
        await self.ws.close()
        self.reader.cancel()


async def join(url, tok, role="player") -> Phone:
    ws = await connect(url, max_queue=None)
    await ws.send(json.dumps({"t": "hello", "v": 1, "game": GAME, "token": tok, "role": role}))
    welcome = json.loads(await asyncio.wait_for(ws.recv(), 5))
    assert welcome["t"] == "welcome", welcome
    return Phone(ws, welcome)


def run(coro, within=150):
    return asyncio.run(asyncio.wait_for(coro, within))


def replay(db: FakeMixedDb) -> tuple[int, int, dict[str, dict]]:
    """The whole game again through the mirror, from the stored answers alone: (hp, hp_max, players)."""
    ps = {p: dict(dmg=0, streak=0, best=0, right=0, frozen=False, thaws=0) for p in db.players}
    hp_max = len(db.players) * len(db.questions) * 55
    hp, phase = hp_max, 0
    for qi, q in enumerate(db.questions):
        if q["closed"] is None:
            break
        answers = [(p, a["c"], a["e"]) for (k, p), a in db.answers.items() if k == qi]
        out = mixed.close_round(ps, answers, db.active(q), key=q["key"], n_options=q["n"], time_s=db.time_s,
                                speed=db.speed, hp=hp, hp_max=hp_max, q_phase=phase, phase=phase,
                                stand_round=q["stand"], void=q["stand"] and q["room_at"] is None)
        hp, phase = out.hp, out.phase
    return hp, hp_max, ps


# ─────────────── a whole game, 30 phones ───────────────


def test_a_whole_mixed_game_with_30_bots_6_questions_every_3rd_a_movement_round(monkeypatch):
    n = 30
    # the plumbing of mode A's rounds: «Дедлайн» stays on its stage (mode B's hunt: test_live_run.py)
    monkeypatch.setattr(mixed.MixedGame, "chase_round", lambda self, qi: False)

    async def scenario():
        db = FakeMixedDb(GAME, HOST, QUESTIONS, every=3, time_s=20, countdown_s=1.0, open_s=5.0)
        for i in range(n):
            db.join(pid(i), f"p{i}")
        async with serving(db) as (url, hub):
            host = await join(url, HOST, "host")
            runner = hub.rooms[GAME]
            assert runner.mode.kind == "mixed" and host.welcome["map"]["zones"][1]["id"] == "Б"
            phones = [await join(url, token(i)) for i in range(n)]
            ids = {i: phones[i].you for i in range(n)}
            await host.wait(lambda c: c.stand("hello") and c.state() and c.state()["phase"] == "lobby", what="lobby")
            assert host.stand("hello")[0]["mixed"] == {"every": 3, "rounds": [2, 5]}
            await asyncio.sleep(0.5)
            assert host.snaps == 0 and all(p.snaps == 0 for p in phones), "no snapshots in the lobby"
            arena_snaps = 0
            for qi, (n_opts, key) in enumerate(QUESTIONS):
                stand_round = qi in (2, 5)
                before = sum(p.snaps for p in phones)
                db.next()
                await host.ws.send(json.dumps({"t": "cmd", "op": "sync"}))
                await host.wait(lambda c: c.state()["qi"] == qi and c.state()["phase"] in ("countdown", "open"), within=3, what=f"countdown {qi}")
                assert host.state()["round"] == ("stand" if stand_round else "tap")
                if not stand_round:
                    await asyncio.sleep(1.05)                       # the countdown
                    for i in range(n):                              # i % n_opts: about a quarter right
                        db.answer(pid(i), (i + qi) % n_opts)
                    assert db.state == "reveal"
                    await host.ws.send(json.dumps({"t": "cmd", "op": "sync"}))
                    await host.wait(lambda c: c.state()["phase"] == "reveal" and c.state()["qi"] == qi, within=3, what=f"tap reveal {qi}")
                    await asyncio.sleep(0.3)
                    assert sum(p.snaps for p in phones) == before, f"snapshots during the button question {qi}"
                    assert host.state()["res"] is None and host.state()["q"] is None
                else:
                    st = host.state()
                    assert st["q"]["text"] == f"Вопрос {qi + 1}" and st["closes"] - st["opens"] == pytest.approx(5000, abs=60)
                    seen = host.snaps
                    await host.wait(lambda c: c.snaps > seen and c.snap["t"] < c.state()["opens"], within=2, what="the first snapshots")
                    lined = [host.flags_of(ids[i]) >> lm.ZONE_SHIFT for i in range(n)]
                    assert lined == [0] * n, "everyone starts on the line, in no zone"
                    for i, p in enumerate(phones):
                        p.target = None if i % 10 == 9 else i % 4
                    await host.wait(lambda c: c.state()["phase"] == "reveal" and c.state()["qi"] == qi, within=12, what=f"reveal {qi}")
                    res = host.state()["res"]
                    stored = {k[1]: a for k, a in db.answers.items() if k[0] == qi}
                    movers = [i for i in range(n) if i % 10 != 9]
                    assert all(stored[pid(i)]["c"] == i % 4 for i in movers if i % 4 < n_opts), "the database has the zones the bots ran to"
                    on_key = {i for i in range(n) if pid(i) in stored and stored[pid(i)]["c"] == key}
                    assert sorted(res["fell"]) == sorted(ids[i] for i in range(n) if i not in on_key)
                    assert res["back"] == res["fell"] and res["hp"] == db.hp and res["key"] == key and not res["void"]
                    assert [h[2] for h in res["hits"]] == sorted((h[2] for h in res["hits"]), reverse=True)
                    for i, p in enumerate(phones):
                        await p.wait(lambda c: c.me() is not None and c.me()["last"]["qi"] == qi, within=3, what=f"me {i}")
                        me, dbp = p.me(), db.players[pid(i)]
                        assert (me["pts"], me["streak"], me["frozen"], me["right"]) == (dbp["dmg"], dbp["streak"], dbp["frozen"], dbp["right"])
                        assert me["last"]["ok"] == (i in on_key) and not me["ghost"]
                        assert "pts" not in p.state()["res"]
                    await host.wait(lambda c: c.state()["floor"] == "up", within=4, what=f"floor {qi}")
                    await asyncio.sleep(0.25)
                    assert not any(host.flags_of(ids[i]) & lm.F_GHOST for i in range(n)), "nobody stays a ghost"
                    assert all(bool(host.flags_of(ids[i]) & mixed.F_ICE) == db.players[pid(i)]["frozen"] for i in range(n))
                    arena_snaps += sum(p.snaps for p in phones) - before
                db.next()
                await host.ws.send(json.dumps({"t": "cmd", "op": "sync"}))
                await host.wait(lambda c: c.state()["phase"] in ("leaderboard", "podium"), within=3, what=f"after {qi}")
                quiet = sum(p.snaps for p in phones)
                await asyncio.sleep(0.4)
                assert sum(p.snaps for p in phones) == quiet, "no snapshots on the leaderboard"
            assert host.state()["phase"] == "podium" and db.state == "podium"
            # The database's HP and points against the mirror replayed over the stored answers.
            hp, hp_max, ps = replay(db)
            assert (db.hp, db.hp_max) == (hp, hp_max) and 0 < db.hp < db.hp_max
            for p in db.players:
                mine = {k: db.players[p][k] for k in ("dmg", "streak", "best", "right", "frozen", "thaws")}
                assert mine == ps[p], p
            assert sum(p["dmg"] for p in db.players.values()) == db.hp_max - db.hp + sum(
                q["closed_as"].healed for q in db.questions)
            await host.ws.send(json.dumps({"t": "cmd", "op": "stats"}))
            await host.wait(lambda c: any(e.get("t") == "stats" for e in c.events), within=3, what="stats")
            stats = [e for e in host.events if e.get("t") == "stats"][-1]
            print(f"\n30 players, mixed (6 questions, 2 movement rounds): tick work p50 {stats['work_ms']['p50']} ms, "
                  f"p99 {stats['work_ms']['p99']} ms; snapshots per phone {arena_snaps / n:.0f} (movement rounds only); "
                  f"hp {db.hp}/{db.hp_max}; database calls {db.calls}")
            assert stats["mode"] == "mixed" and stats["dropped_cmds"] == 0 and runner.mode.write_errors == 0
            assert stats["work_ms"]["p50"] <= 1.0 and stats["work_ms"]["p99"] <= 10.0
            assert max(len(p.msgs) for p in phones) <= 45
            db.end()
            await host.ws.send(json.dumps({"t": "cmd", "op": "sync"}))
            await host.wait(lambda c: c.closed is not None, within=4, what="room closed")
            assert host.closed == api.CLOSE_ENDED
            for p in phones:
                p.driver.cancel()
    run(scenario())


# ─────────────── the parts ───────────────


def test_a_write_that_never_comes_leaves_a_void_round():
    async def scenario():
        db = FakeMixedDb(GAME, HOST, [(4, 1), (4, 1), (4, 1)], every=3, countdown_s=0.3, open_s=0.8, room_grace_s=1.5)
        for i in range(2):
            db.join(pid(i))
        db.fail_close = -1                                   # Supabase does not answer the room
        async with serving(db) as (url, hub):
            hub.rooms.clear()
            host = await join(url, HOST, "host")
            hub.rooms[GAME].mode.write_window_s = 1.0
            phone = await join(url, token(0))
            for qi in range(2):
                db.next()
                await asyncio.sleep(0.4)
                db.answer(pid(0), 1)
                db.answer(pid(1), 0)
                db.next()
            hp = db.hp
            db.next()
            await host.ws.send(json.dumps({"t": "cmd", "op": "sync"}))
            await host.wait(lambda c: c.state()["round"] == "stand", within=3, what="the movement round")
            await asyncio.sleep(2.2)                          # the room gives up; the database closes it by time
            db.fail_close = 0
            await host.ws.send(json.dumps({"t": "cmd", "op": "sync"}))
            await phone.wait(lambda c: c.state()["phase"] == "reveal" and c.state()["res"] is not None, within=4, what="the void reveal")
            res = phone.state()["res"]
            assert res["void"] and res["fell"] == [] and phone.state()["floor"] == "up"
            assert db.hp == hp and not db.players[pid(0)]["frozen"] and db.players[pid(0)]["streak"] == 2
            await phone.wait(lambda c: c.me() is not None, within=2, what="me")
            assert phone.me()["last"]["void"]
    run(scenario())


def test_a_battle_without_movement_rounds_gets_the_battle_room_with_no_rounds():
    """The battle's 3D projector (BattleHost) opens the room for every battle: the phones' characters stand round the
    boss; with stand_every 0 no question is a movement round, so the room never plays one."""
    async def scenario():
        db = FakeMixedDb(GAME, HOST, [(4, 1)], every=0)
        async with serving(db) as (url, hub):
            host = await join(url, HOST, "host")
            await host.wait(lambda c: bool(c.stand("hello")), within=2, what="hello")
            mode = hub.rooms[GAME].mode
            assert isinstance(mode, mixed.MixedMode) and mode.game.every == 0 and mode.game.rounds == []
            assert host.stand("hello")[0]["mixed"] == {"every": 0, "rounds": []}
            assert not mode.game.live
    run(scenario())
