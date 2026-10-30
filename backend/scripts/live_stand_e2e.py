"""Mode «Встань на ответ» end to end (LOCAL ONLY; run by supabase/tests/local/live_stand_e2e.sh): the real room
(live_move_api.Hub with its SupabaseVerifier, so live_host_state and live_stand_close go through PostgREST) on a local
uvicorn, the rehearsal's database behind a real PostgREST, and N bots that join with live_join and run to their zones
over the socket. Three questions (4, 3 and 2 options), the leaderboards, the podium. Checks that every answer the database stored is the zone
the bot stood in, that the room's results reached every phone and agree with live_state, and reports the delay from
zero to the stomp and the tick's cost. Last line: «STAND E2E …»; exit 0 when everything held.
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import hmac
import json
import math
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx  # noqa: E402
import uvicorn  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from websockets.asyncio.client import connect  # noqa: E402
from websockets.exceptions import ConnectionClosed  # noqa: E402

import live_move as lm  # noqa: E402
import live_move_api as api  # noqa: E402
import supabase_rest  # noqa: E402

CENTRE = {0: (380.0, 340.0), 1: (1220.0, 340.0), 2: (380.0, 700.0), 3: (1220.0, 700.0), 4: (800.0, 310.0), 5: (800.0, 730.0)}


def b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def jwt(secret: str, claims: dict) -> str:
    head = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    body = b64(json.dumps(dict(claims, exp=int(time.time()) + 3600)).encode())
    sig = b64(hmac.new(secret.encode(), f"{head}.{body}".encode(), hashlib.sha256).digest())
    return f"{head}.{body}.{sig}"


def tok(i: int) -> str:
    return ("stand-e2e-bot-" + str(i)).ljust(43, "x")


class Phone:
    def __init__(self, ws, welcome: dict) -> None:
        self.ws = ws
        self.you = welcome.get("you")
        self.snap = None
        self.stand: dict[str, dict] = {}
        self.mes: list[dict] = []
        self.events: list[dict] = []
        self.target: int | None = None
        self.seq = 0
        self.reader = asyncio.get_running_loop().create_task(self._read())
        self.driver = asyncio.get_running_loop().create_task(self._drive())

    async def _read(self) -> None:
        try:
            async for msg in self.ws:
                if isinstance(msg, bytes):
                    self.snap = lm.decode_snapshot(msg)
                else:
                    obj = json.loads(msg)
                    if obj.get("t") == "stand":
                        self.stand[obj["k"]] = obj
                        if obj["k"] == "me":
                            self.mes.append(obj)
                    else:
                        self.events.append(obj)
        except ConnectionClosed:
            pass

    async def _drive(self) -> None:
        last_ping = 0.0
        while True:
            await asyncio.sleep(0.05)
            if time.monotonic() - last_ping > 2.0:          # as MoveClient: the server drops a socket silent for 15 s
                last_ping = time.monotonic()
                try:
                    await self.ws.send(json.dumps({"t": "ping", "c": 0}))
                except ConnectionClosed:
                    return
            st = self.stand.get("state")
            if st is None or self.snap is None or self.target is None or st["phase"] not in ("countdown", "open"):
                continue
            if self.snap["t"] >= st["closes"]:
                continue
            me = next(((x / lm.Q, y / lm.Q) for e, x, y, _f in self.snap["ents"] if e == self.you), None)
            if me is None:
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

    def phase(self) -> str | None:
        st = self.stand.get("state")
        return st["phase"] if st else None


HOST: "Phone | None" = None


async def wait_for(pred, within: float, what: str) -> None:
    end = time.monotonic() + within
    while not pred():
        if time.monotonic() > end:
            seen = json.dumps(HOST.stand.get("state"), ensure_ascii=False)[:300] if HOST else "-"
            raise SystemExit(f"stand e2e: timed out waiting for {what}; the projector's last state: {seen}")
        await asyncio.sleep(0.05)


async def _main(a: argparse.Namespace, made: list) -> int:
    anon = jwt(a.secret, {"role": "anon"})
    author = jwt(a.secret, {"role": "authenticated", "sub": a.author})
    supabase_rest._base_url = lambda: a.rest           # PostgREST itself, not /rest/v1 behind Supabase's gateway
    os.environ["SUPABASE_KEY"] = anon
    http = httpx.AsyncClient(base_url=a.rest, timeout=10, trust_env=False)

    async def rpc(fn: str, body: dict, bearer: str = anon) -> dict:
        r = await http.post(f"/rpc/{fn}", json=body, headers={"Authorization": f"Bearer {bearer}"})
        if r.status_code >= 400:
            raise SystemExit(f"stand e2e: {fn} → {r.status_code} {r.text[:200]}")
        return r.json()

    created = await rpc("live_create", {"p_source": {"container_id": a.container, "subject_ids": [a.subject], "count": 3},
                                        "p_settings": {"mode": "stand", "boss": "skeleton"}}, author)
    game, host_token, pin = created["game_id"], created["host_token"], created["pin"]
    made.append((game, host_token))
    pids = []
    for i in range(a.players):
        pids.append((await rpc("live_join", {"p_pin": pin, "p_name": f"Бот {i + 1}", "p_token": tok(i), "p_look": None}))["player_id"])

    app = FastAPI()
    app.include_router(api.router)
    api.hub = api.Hub()                                  # the real verifier and source: PostgREST
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=0, log_level="warning", lifespan="off"))
    serve = asyncio.create_task(server.serve())
    while not server.started:
        await asyncio.sleep(0.01)
    url = f"ws://127.0.0.1:{server.servers[0].sockets[0].getsockname()[1]}{api.WS_PATH}"

    async def join(token: str, role: str) -> Phone:
        ws = await connect(url, max_queue=None)
        await ws.send(json.dumps({"t": "hello", "v": 1, "game": game, "token": token, "role": role}))
        welcome = json.loads(await asyncio.wait_for(ws.recv(), 10))
        if welcome.get("t") != "welcome":
            raise SystemExit(f"stand e2e: no welcome for {role}: {welcome}")
        return Phone(ws, welcome)

    global HOST
    host = HOST = await join(host_token, "host")
    phones = [await join(tok(i), "player") for i in range(a.players)]
    runner = api.hub.rooms[game]
    assert runner.mode is not None and runner.mode.kind == "stand", "the room has no stand mode"
    await wait_for(lambda: host.stand.get("hello", {}).get("boss") == "skeleton", 5, "hello")

    targets = [lambda i: None if i % 10 == 9 else i % 4, lambda i: None if i % 10 == 9 else i % 3,
               lambda i: None if i % 10 == 9 else i % 2]
    keys = [1, 2, 0]
    expect = ["lobby", "leaderboard", "leaderboard"]
    stomp_after: list[float] = []
    for qi in range(3):
        for i, p in enumerate(phones):
            p.target = targets[qi](i)
        await rpc("live_next", {"p_game": game, "p_host_token": host_token, "p_expect": expect[qi]})
        await host.ws.send(json.dumps({"t": "cmd", "op": "sync"}))
        await wait_for(lambda: host.phase() == "countdown" or host.phase() == "open", 3, f"countdown {qi}")
        await wait_for(lambda: host.phase() == "reveal" and host.stand["state"]["qi"] == qi, 30, f"reveal {qi}")
        st = host.stand["state"]
        if st["res"]["key"] != keys[qi]:
            raise SystemExit(f"stand e2e: key {st['res']['key']} != {keys[qi]}")
        stomp_after.append(st["res"]["at"] - st["closes"])
        await wait_for(lambda: all(p.mes and p.mes[-1]["last"] and p.mes[-1]["last"]["qi"] == qi for p in phones), 5, f"me {qi}")
        await wait_for(lambda: host.stand["state"]["floor"] == "up", 8, f"floor {qi}")
        await rpc("live_next", {"p_game": game, "p_host_token": host_token, "p_expect": "reveal"})
        await host.ws.send(json.dumps({"t": "cmd", "op": "sync"}))
        await wait_for(lambda: host.phase() in ("leaderboard", "podium"), 3, f"after reveal {qi}")
    await wait_for(lambda: host.phase() == "podium", 3, "podium")

    # The database's word against what the bots did.
    agree = 0
    total = 0
    for i, p in enumerate(phones):
        review = await rpc("live_review", {"p_game": game, "p_token": tok(i)})
        state = await rpc("live_state", {"p_game": game, "p_token": tok(i), "p_since_rev": None})
        for item in review["items"]:
            target = targets[item["qi"]](i)
            if target is not None:
                total += 1
                agree += item["choice"] == target
        mine = [m for m in p.mes if m["last"]]
        if mine[-1]["pts"] != state["me"]["dmg"] or sum(m["last"]["pts"] for m in {m["last"]["qi"]: m for m in mine}.values()) != state["me"]["dmg"]:
            raise SystemExit(f"stand e2e: bot {i}: the room said {mine[-1]['pts']}, the database {state['me']['dmg']}")
    if agree != total:
        raise SystemExit(f"stand e2e: {total - agree} of {total} answers are not where the bots stood")

    await host.ws.send(json.dumps({"t": "cmd", "op": "stats"}))
    await wait_for(lambda: any(e.get("t") == "stats" for e in host.events), 3, "stats")
    stats = [e for e in host.events if e.get("t") == "stats"][-1]
    await rpc("live_end", {"p_game": game, "p_host_token": host_token})
    for p in phones + [host]:
        p.driver.cancel()
        await p.ws.close()
    server.should_exit = True
    await serve
    await http.aclose()
    print(f"STAND E2E: {a.players} players, 3 questions, {agree}/{total} answers where the bots stood, results on every "
          f"phone equal live_state; stomp {', '.join(f'{x:.0f}' for x in stomp_after)} ms after zero; "
          f"tick work p99 {stats['work_ms']['p99']} ms; database writes {runner.mode.writes}, polls {runner.mode.polls}")
    return 0


async def main(a: argparse.Namespace) -> int:
    made: list = []
    try:
        return await _main(a, made)
    finally:   # a failed run must not leave an open game behind (3 open games per author)
        for game, host_token in made:
            try:
                async with httpx.AsyncClient(base_url=a.rest, timeout=5, trust_env=False) as h:
                    await h.post("/rpc/live_end", json={"p_game": game, "p_host_token": host_token},
                                 headers={"Authorization": "Bearer " + jwt(a.secret, {"role": "anon"})})
            except Exception:
                pass


if __name__ == "__main__":
    import logging
    logging.basicConfig(level=os.getenv("LIVE_E2E_LOG", "WARNING"), format="%(asctime)s %(name)s %(message)s")
    ap = argparse.ArgumentParser()
    ap.add_argument("--rest", required=True)
    ap.add_argument("--secret", required=True)
    ap.add_argument("--container", required=True)
    ap.add_argument("--subject", required=True)
    ap.add_argument("--author", required=True)
    ap.add_argument("--players", type=int, default=30)
    sys.exit(asyncio.run(asyncio.wait_for(main(ap.parse_args()), 180)))
