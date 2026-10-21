"""The movement WebSocket (live_move_api.py) on a real uvicorn server: join and auth refusals, inputs → snapshots,
reconnect, kick, limits, room lifecycle; and the token check against PostgREST (SupabaseVerifier, mocked)."""
import asyncio
import contextlib
import json
import logging
import sys
from pathlib import Path

import httpx
import pytest
import uvicorn
from fastapi import FastAPI
from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed, InvalidStatus

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import live_move as lm  # noqa: E402
import live_move_api as api  # noqa: E402
import supabase_rest  # noqa: E402

GAME = "11111111-2222-4333-8444-555555555555"
HOST_TOKEN = "H" * 43
TOKENS = {f"P{i:02d}".ljust(43, "x"): f"00000000-0000-4000-8000-{i:012d}" for i in range(80)}
TOKEN_LIST = list(TOKENS)


class FakeVerifier:
    def __init__(self, state="lobby"):
        self.calls = 0
        self.state = state
        self.refuse: dict[str, api.Refused] = {}

    async def verify(self, game, token, role):
        self.calls += 1
        await asyncio.sleep(0)
        if token in self.refuse:
            raise self.refuse[token]
        if game != GAME:
            raise api.Refused(api.CLOSE_BAD_TOKEN, "bad_token")
        if role == "host" and token == HOST_TOKEN:
            return api.Identity("host", None, "", None, self.state)
        if role == "player" and token in TOKENS:
            return api.Identity("player", TOKENS[token], "name" + token[1:3], {"body": "round"}, self.state)
        raise api.Refused(api.CLOSE_BAD_TOKEN, "bad_token")


@contextlib.asynccontextmanager
async def serving(**limits):
    """The router alone on uvicorn (port 0) with a fresh hub; yields (url, hub)."""
    app = FastAPI()
    app.include_router(api.router)
    old = api.hub
    api.hub = api.Hub(verifier=FakeVerifier(), limits=api.Limits(**limits))
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


def run(coro):
    return asyncio.run(asyncio.wait_for(coro, 20))


async def hello(url, token, role="player", game=GAME, **kw):
    # No receive cap: a test that stops reading must still see the server's close frame.
    ws = await connect(url, max_queue=None, **kw)
    await ws.send(json.dumps({"t": "hello", "v": 1, "game": game, "token": token, "role": role}))
    return ws


async def joined(url, token, role="player"):
    ws = await hello(url, token, role)
    welcome = json.loads(await asyncio.wait_for(ws.recv(), 3))
    assert welcome["t"] == "welcome", welcome
    return ws, welcome


async def close_code(ws, within=3.0):
    try:
        while True:
            await asyncio.wait_for(ws.recv(), within)
    except ConnectionClosed as exc:
        return exc.rcvd.code if exc.rcvd else None


async def next_snapshot(ws, within=3.0, where=lambda s: True):
    deadline = asyncio.get_running_loop().time() + within
    while True:
        msg = await asyncio.wait_for(ws.recv(), max(0.01, deadline - asyncio.get_running_loop().time()))
        if isinstance(msg, bytes):
            snap = lm.decode_snapshot(msg)
            if where(snap):
                return snap


# ─────────────── join ───────────────


def test_host_opens_the_room_and_a_player_joins():
    async def scenario():
        async with serving() as (url, hub):
            host, hw = await joined(url, HOST_TOKEN, "host")
            assert hw["role"] == "host" and hw["hz"] == lm.TICK_HZ and hw["map"]["w"] == 1600 and "you" not in hw
            assert GAME in hub.rooms
            ws, pw = await joined(url, TOKEN_LIST[0])
            assert pw["role"] == "player" and pw["pid"] == TOKENS[TOKEN_LIST[0]] and pw["resumed"] is False
            assert [pw["you"], 0, pw["pid"]] == pw["roster"][0][:3]
            snap = await next_snapshot(host, where=lambda s: s["ents"])
            assert [e[0] for e in snap["ents"]] == [pw["you"]] and snap["ack"] == 0
            await ws.close()
            await host.close()
    run(scenario())


def test_phones_get_other_players_looks_but_not_their_names_the_projector_gets_all():
    async def scenario():
        async with serving() as (url, hub):
            host, _ = await joined(url, HOST_TOKEN, "host")
            a, wa = await joined(url, TOKEN_LIST[0])
            b, wb = await joined(url, TOKEN_LIST[1])
            others = [e for e in wb["roster"] if e[0] != wb["you"]]
            assert others == [[wa["you"], 0, None, "", {"body": "round"}]]
            assert [e for e in wb["roster"] if e[0] == wb["you"]][0][2:4] == [wb["pid"], "name01"]

            async def adds(ws):
                out = []
                while len(out) < 1:
                    msg = await asyncio.wait_for(ws.recv(), 3)
                    if isinstance(msg, str) and json.loads(msg)["t"] == "add":
                        out.append(json.loads(msg)["e"])
                return out

            assert await adds(a) == [[wb["you"], 0, None, "", {"body": "round"}]]
            host_adds = []
            while len(host_adds) < 2:
                msg = await asyncio.wait_for(host.recv(), 3)
                if isinstance(msg, str) and json.loads(msg)["t"] == "add":
                    host_adds.append(json.loads(msg)["e"])
            assert {e[3] for e in host_adds} == {"name00", "name01"} and all(e[2] for e in host_adds)
            for ws in (a, b, host):
                await ws.close()
    run(scenario())


def test_player_before_the_host_is_told_to_retry():
    async def scenario():
        async with serving() as (url, hub):
            ws = await hello(url, TOKEN_LIST[0])
            assert await close_code(ws) == api.CLOSE_NO_ROOM
            assert hub.verifier.calls == 0          # no Supabase call for a room that is not there
    run(scenario())


@pytest.mark.parametrize("token, game, code", [
    ("short", GAME, api.CLOSE_BAD_TOKEN),
    ("Z" * 43, GAME, api.CLOSE_BAD_TOKEN),
    (HOST_TOKEN, "not-a-uuid", api.CLOSE_BAD_TOKEN),
])
def test_bad_host_tokens_are_refused(token, game, code):
    async def scenario():
        async with serving() as (url, hub):
            ws = await hello(url, token, "host", game=game)
            assert await close_code(ws) == code
            assert not hub.rooms
    run(scenario())


def test_malformed_hello_and_hello_timeout():
    async def scenario():
        async with serving(hello_timeout=0.3) as (url, hub):
            ws = await connect(url)
            await ws.send("not json")
            assert await close_code(ws) == api.CLOSE_BAD_REQUEST
            ws = await connect(url)
            await ws.send(json.dumps({"t": "hello", "v": 99, "game": GAME, "token": HOST_TOKEN, "role": "host"}))
            assert await close_code(ws) == api.CLOSE_BAD_REQUEST
            ws = await connect(url)
            assert await close_code(ws) == api.CLOSE_TIMEOUT
    run(scenario())


def test_refusals_of_the_token_check_become_close_codes():
    async def scenario():
        async with serving() as (url, hub):
            host, _ = await joined(url, HOST_TOKEN, "host")
            hub.verifier.refuse[TOKEN_LIST[1]] = api.Refused(api.CLOSE_FORBIDDEN, "kicked")
            hub.verifier.refuse[TOKEN_LIST[2]] = api.Refused(api.CLOSE_UNAVAILABLE, "auth_unavailable")
            for token, code in ((TOKEN_LIST[1], api.CLOSE_FORBIDDEN), (TOKEN_LIST[2], api.CLOSE_UNAVAILABLE),
                                ("Q" * 43, api.CLOSE_BAD_TOKEN)):
                ws = await hello(url, token)
                assert await close_code(ws) == code
            await host.close()
    run(scenario())


def test_an_ended_game_is_refused():
    async def scenario():
        async with serving() as (url, hub):
            hub.verifier.state = "ended"
            ws = await hello(url, HOST_TOKEN, "host")
            assert await close_code(ws) == api.CLOSE_ENDED
    run(scenario())


def test_foreign_origin_is_refused_at_the_handshake():
    async def scenario():
        async with serving() as (url, hub):
            with pytest.raises(InvalidStatus) as exc:
                await connect(url, origin="https://evil.example")
            assert exc.value.response.status_code == 403
            ws, _ = await joined(url, HOST_TOKEN, "host")   # no Origin (a native client) is fine
            port = url.split(":")[2].split("/")[0]
            same = await connect(url, origin=f"http://127.0.0.1:{port}")   # the page's own host
            await same.close()
            await ws.close()
    run(scenario())


# ─────────────── play ───────────────


def test_inputs_move_the_player_and_snapshots_ack_them():
    async def scenario():
        async with serving() as (url, hub):
            host, _ = await joined(url, HOST_TOKEN, "host")
            ws, w = await joined(url, TOKEN_LIST[0])
            me = w["you"]
            first = await next_snapshot(ws, where=lambda s: any(e[0] == me for e in s["ents"]))
            x0 = [e for e in first["ents"] if e[0] == me][0][1]
            await ws.send(lm.encode_input(1, [(127, 0, 0)] * 4))
            await ws.send(lm.encode_input(5, [(127, 0, 0)] * 2))
            snap = await next_snapshot(ws, where=lambda s: s["ack"] == 6)
            x6 = [e for e in snap["ents"] if e[0] == me][0][1]
            assert x6 - x0 == 6 * 13 * lm.Q                # six ticks at full speed, exactly
            hsnap = await next_snapshot(host, where=lambda s: s["tick"] >= snap["tick"])
            assert hsnap["ack"] == 0
            await ws.close()
            await host.close()
    run(scenario())


def test_ping_pong_and_unknown_messages():
    async def scenario():
        async with serving() as (url, hub):
            host, _ = await joined(url, HOST_TOKEN, "host")
            await host.send(json.dumps({"t": "ping", "c": 123.5}))
            await host.send(json.dumps({"t": "dance"}))
            seen = {}
            while len(seen) < 2:
                msg = await asyncio.wait_for(host.recv(), 3)
                if isinstance(msg, str):
                    obj = json.loads(msg)
                    seen[obj["t"]] = obj
            assert seen["pong"]["c"] == 123.5 and seen["pong"]["ms"] == seen["pong"]["tick"] * 50
            assert seen["err"]["code"] == "unknown"
            await host.close()
    run(scenario())


def test_a_reconnect_resumes_without_a_second_check_and_replaces_the_old_socket():
    async def scenario():
        async with serving() as (url, hub):
            host, _ = await joined(url, HOST_TOKEN, "host")
            old, w1 = await joined(url, TOKEN_LIST[0])
            calls = hub.verifier.calls
            new, w2 = await joined(url, TOKEN_LIST[0])
            assert w2["you"] == w1["you"] and w2["resumed"] is True
            assert hub.verifier.calls == calls
            assert await close_code(old) == api.CLOSE_REPLACED
            await new.close()
            await asyncio.sleep(0.15)
            snap = await next_snapshot(host, where=lambda s: s["ents"] and s["ents"][0][3] & lm.F_AWAY)
            assert snap["ents"][0][0] == w1["you"]
            again, w3 = await joined(url, TOKEN_LIST[0])
            assert w3["you"] == w1["you"] and hub.verifier.calls == calls
            await again.close()
            await host.close()
    run(scenario())


def test_kick_closes_the_player_and_keeps_them_out():
    async def scenario():
        async with serving() as (url, hub):
            host, _ = await joined(url, HOST_TOKEN, "host")
            ws, w = await joined(url, TOKEN_LIST[0])
            await host.send(json.dumps({"t": "cmd", "op": "kick", "pid": w["pid"]}))
            assert await close_code(ws) == api.CLOSE_FORBIDDEN
            back = await hello(url, TOKEN_LIST[0])            # the cache is dropped and the pid banned
            assert await close_code(back) == api.CLOSE_FORBIDDEN
            await host.close()
    run(scenario())


def test_host_commands_npc_freeze_zones_stats_and_map():
    async def scenario():
        async with serving() as (url, hub):
            host, _ = await joined(url, HOST_TOKEN, "host")
            ws, w = await joined(url, TOKEN_LIST[0])
            for cmd in ({"op": "npc", "on": True, "n": 2}, {"op": "freeze", "on": True}, {"op": "zones"},
                        {"op": "stats"}, {"op": "map", "map": {"w": 1}}, {"op": "say", "data": {"q": "2+2?"}}):
                await host.send(json.dumps({"t": "cmd", **cmd}))
            got: dict[str, list] = {}
            while not {"add", "freeze", "zones", "stats", "err", "say"} <= set(got):
                msg = await asyncio.wait_for(host.recv(), 3)
                if isinstance(msg, str):
                    obj = json.loads(msg)
                    got.setdefault(obj["t"], []).append(obj)
            assert [a["e"][1] for a in got["add"]].count(lm.KIND_NPC) == 2
            assert got["zones"][0]["z"] == {"A": [], "B": [], "C": [], "D": []}
            assert got["stats"][0]["players"] == 1 and got["stats"][0]["npcs"] == 2
            assert got["err"][0]["code"] == "map" and got["err"][0]["why"].startswith("w")
            assert got["say"][0]["data"] == {"q": "2+2?"}
            await ws.send(lm.encode_input(1, [(127, 0, 0)]))
            snap = await next_snapshot(ws, where=lambda s: s["ack"] == 1)
            mine = [e for e in snap["ents"] if e[0] == w["you"]][0]
            assert mine[3] & lm.F_FROZEN
            await ws.send(json.dumps({"t": "cmd", "op": "npc", "on": False}))   # players cannot command
            while True:
                msg = await asyncio.wait_for(ws.recv(), 3)
                if isinstance(msg, str) and json.loads(msg)["t"] == "err":
                    break
            assert len(hub.rooms[GAME].room.npcs) == 2
            await ws.close()
            await host.close()
    run(scenario())


# ─────────────── limits ───────────────


def test_oversized_and_flooding_clients_are_closed():
    async def scenario():
        async with serving() as (url, hub):
            host, _ = await joined(url, HOST_TOKEN, "host")
            big, _ = await joined(url, TOKEN_LIST[0])
            await big.send(b"\x02" + b"\0" * 100)
            assert await close_code(big) == api.CLOSE_TOO_BIG
            chatty, _ = await joined(url, TOKEN_LIST[1])
            await chatty.send(json.dumps({"t": "ping", "pad": "x" * 300}))
            assert await close_code(chatty) == api.CLOSE_TOO_BIG
            flood, _ = await joined(url, TOKEN_LIST[2])
            for seq in range(1, 400):
                await flood.send(lm.encode_input(seq * 4, [(127, 0, 0)] * 4))
            assert await close_code(flood) == api.CLOSE_SLOW_DOWN
            bad, _ = await joined(url, TOKEN_LIST[3])
            await bad.send(b"\x02\x09\0\0\0\0")
            assert await close_code(bad) == api.CLOSE_BAD_REQUEST
            await host.send(b"\x02")                      # the host sends no inputs
            assert await close_code(host) == api.CLOSE_BAD_REQUEST
    run(scenario())


def test_a_flood_cannot_outrun_the_speed_limit():
    async def scenario():
        async with serving() as (url, hub):
            host, _ = await joined(url, HOST_TOKEN, "host")
            ws, w = await joined(url, TOKEN_LIST[0])
            runner = hub.rooms[GAME]
            player = runner.room.players[w["you"]]
            x0, t0 = player.x, runner.room.tick
            seq = 1
            for _ in range(20):                           # 80 commands in ~0.5 s: 4× the allowed rate
                await ws.send(lm.encode_input(seq, [(127, 0, 0)] * 4))
                seq += 4
                await asyncio.sleep(0.025)
            await asyncio.sleep(0.6)
            ticks = runner.room.tick - t0
            moved = (player.x - x0) / 13
            assert moved <= 12 + ticks * 1.05 / 1 and moved < 40     # burst 12, then one a tick at most
            await ws.close()
            await host.close()
    run(scenario())


def test_connection_caps():
    async def scenario():
        async with serving(max_conns=2, max_players=1) as (url, hub):
            host, _ = await joined(url, HOST_TOKEN, "host")
            p0, _ = await joined(url, TOKEN_LIST[0])
            third = await connect(url)
            assert await close_code(third) == api.CLOSE_SLOW_DOWN
            await p0.close()
            await asyncio.sleep(0.1)
            p1, _ = await joined(url, TOKEN_LIST[0])
            await p1.close()
            await host.close()
        async with serving(max_players=1) as (url, hub):
            host, _ = await joined(url, HOST_TOKEN, "host")
            p0, _ = await joined(url, TOKEN_LIST[0])
            p1 = await hello(url, TOKEN_LIST[1])
            assert await close_code(p1) == api.CLOSE_FULL
            await host.close()
    run(scenario())


def test_failed_token_checks_are_throttled_per_address():
    async def scenario():
        async with serving() as (url, hub):
            host, _ = await joined(url, HOST_TOKEN, "host")
            codes = []
            for i in range(14):
                ws = await hello(url, f"bad{i:02d}".ljust(43, "z"))
                codes.append(await close_code(ws))
            assert codes[:10] == [api.CLOSE_BAD_TOKEN] * 10 and api.CLOSE_SLOW_DOWN in codes[10:]
            assert hub.verifier.calls <= 12
            await host.close()
    run(scenario())


# ─────────────── lifecycle ───────────────


def test_room_closes_when_the_host_is_gone_past_the_grace():
    async def scenario():
        async with serving(host_grace=0.5) as (url, hub):
            host, _ = await joined(url, HOST_TOKEN, "host")
            ws, _ = await joined(url, TOKEN_LIST[0])
            await host.close()
            assert await close_code(ws, within=4) == api.CLOSE_ROOM_CLOSED
            assert GAME not in hub.rooms
    run(scenario())


def test_host_back_within_the_grace_keeps_the_room():
    async def scenario():
        async with serving(host_grace=1.5) as (url, hub):
            host, _ = await joined(url, HOST_TOKEN, "host")
            ws, w = await joined(url, TOKEN_LIST[0])
            runner = hub.rooms[GAME]
            await host.close()
            await asyncio.sleep(0.6)
            host2, hw = await joined(url, HOST_TOKEN, "host")
            assert hub.rooms[GAME] is runner and [w["you"], 0] == hw["roster"][0][:2]
            await asyncio.sleep(1.5)
            assert GAME in hub.rooms
            await ws.close()
            await host2.close()
    run(scenario())


def test_host_end_and_ended_game_close_the_room():
    async def scenario():
        async with serving() as (url, hub):
            host, _ = await joined(url, HOST_TOKEN, "host")
            ws, _ = await joined(url, TOKEN_LIST[0])
            await host.send(json.dumps({"t": "cmd", "op": "end"}))
            assert await close_code(ws) == api.CLOSE_ENDED
            assert await close_code(host) == api.CLOSE_ENDED
            host, _ = await joined(url, HOST_TOKEN, "host")
            ws, _ = await joined(url, TOKEN_LIST[0])
            hub.verifier.state = "ended"
            await hub.rooms[GAME]._check_state()        # the periodic check
            assert await close_code(ws) == api.CLOSE_ENDED
    run(scenario())


def test_idle_clients_are_closed():
    async def scenario():
        async with serving(idle_timeout=0.4) as (url, hub):
            host, _ = await joined(url, HOST_TOKEN, "host")
            assert await close_code(host, within=4) == api.CLOSE_TIMEOUT
    run(scenario())


def test_main_app_serves_the_socket_past_the_http_auth_middleware():
    import main

    async def scenario():
        old = api.hub
        api.hub = api.Hub(verifier=FakeVerifier(), limits=api.Limits())
        server = uvicorn.Server(uvicorn.Config(main.app, host="127.0.0.1", port=0, log_level="warning", lifespan="off"))
        task = asyncio.create_task(server.serve())
        try:
            while not server.started:
                await asyncio.sleep(0.01)
            port = server.servers[0].sockets[0].getsockname()[1]
            ws, w = await joined(f"ws://127.0.0.1:{port}{api.WS_PATH}", HOST_TOKEN, "host")
            assert w["role"] == "host"
            await ws.close()
        finally:
            for runner in list(api.hub.rooms.values()):
                runner.close(api.CLOSE_ROOM_CLOSED, "test_end")
            server.should_exit = True
            await task
            api.hub = old
    run(scenario())


# ─────────────── the token check through PostgREST ───────────────


def _postgrest(monkeypatch, handler):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_KEY", "anon-key-for-tests")
    monkeypatch.setattr(supabase_rest, "_transport", httpx.MockTransport(handler))


def test_supabase_verifier_reads_the_player_and_host(monkeypatch, caplog):
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        seen.append((request.url.path, request.headers["apikey"], request.headers["authorization"], body))
        if request.url.path.endswith("/rpc/live_state"):
            return httpx.Response(200, json={"state": "lobby", "me": {"player_id": TOKENS[TOKEN_LIST[0]], "name": "Дима",
                                                                      "look": {"body": "drop"}}})
        return httpx.Response(200, json={"state": "open", "pin": "482913", "roster": []})

    _postgrest(monkeypatch, handler)
    caplog.set_level(logging.DEBUG)

    async def scenario():
        v = api.SupabaseVerifier()
        player = await v.verify(GAME, TOKEN_LIST[0], "player")
        host = await v.verify(GAME, HOST_TOKEN, "host")
        return player, host

    player, host = asyncio.run(scenario())
    assert player == api.Identity("player", TOKENS[TOKEN_LIST[0]], "Дима", {"body": "drop"}, "lobby")
    assert host.role == "host" and host.state == "open"
    assert seen[0][0] == "/rest/v1/rpc/live_state" and seen[1][0] == "/rest/v1/rpc/live_host_state"
    assert seen[0][1] == "anon-key-for-tests" and seen[0][2] == "Bearer anon-key-for-tests"
    assert seen[0][3] == {"p_game": GAME, "p_token": TOKEN_LIST[0], "p_since_rev": None}
    assert seen[1][3] == {"p_game": GAME, "p_host_token": HOST_TOKEN, "p_since_rev": None}
    assert TOKEN_LIST[0] not in caplog.text and HOST_TOKEN not in caplog.text


@pytest.mark.parametrize("status, code, role, close", [
    (404, "P0002", "player", api.CLOSE_BAD_TOKEN),
    (403, "42501", "player", api.CLOSE_FORBIDDEN),     # kicked
    (403, "42501", "host", api.CLOSE_BAD_TOKEN),       # wrong host token
    (400, "22023", "player", api.CLOSE_BAD_TOKEN),
    (429, "ML005", "player", api.CLOSE_SLOW_DOWN),
    (503, None, "player", api.CLOSE_UNAVAILABLE),
])
def test_supabase_verifier_maps_refusals(monkeypatch, status, code, role, close):
    _postgrest(monkeypatch, lambda request: httpx.Response(status, json={"code": code, "message": "x", "details": "y"}))

    async def scenario():
        with pytest.raises(api.Refused) as exc:
            await api.SupabaseVerifier().verify(GAME, HOST_TOKEN if role == "host" else TOKEN_LIST[0], role)
        return exc.value.code

    assert asyncio.run(scenario()) == close


def test_supabase_verifier_network_failure_is_retryable(monkeypatch):
    def handler(request):
        raise httpx.ConnectError("down")

    _postgrest(monkeypatch, handler)

    async def scenario():
        with pytest.raises(api.Refused) as exc:
            await api.SupabaseVerifier().verify(GAME, TOKEN_LIST[0], "player")
        return exc.value.code

    assert asyncio.run(scenario()) == api.CLOSE_UNAVAILABLE
