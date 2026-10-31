"""A whole battle with movement rounds on this machine, for the projector and phone pages (LOCAL ONLY, never the
Space's app; docs/live/MODE_MIXED.md).

The real room (live_move_api's socket, live_move_mixed, SupabaseVerifier with its live_host_state and live_stand_close
calls) against the rehearsal's database behind a real PostgREST (supabase/tests/local/live_mixed_local.sh starts both),
and N bots that join with live_join, tap the button questions with live_answer (mostly right, at their own speed) and
run to a zone over the socket in the movement rounds (mostly the right one; some late, some wrong, a few stay in the
corridor), as phones do. The same server answers the site's calls: /rest/v1/* goes on to PostgREST, so the frontend
runs with VITE_SUPABASE_URL pointing here and /api proxied to it with WebSockets (frontend/scripts/mixed-local.mjs does
both and plays the teacher and one phone in Chromium).

    python backend/scripts/live_mixed_local.py --local --rest http://127.0.0.1:54691 --secret … --container … \\
        --subject … --author … --bots 12 --every 3 --time 10 --skill 0.3 0.6 --port 8418

prints one JSON line {game, host_token, pin, url} once the room's server listens, then keeps the bots playing until it
is stopped. Refuses to start without --local.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import math
import os
import random
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[1]))
sys.path.insert(0, str(HERE.parent))

import httpx  # noqa: E402
import uvicorn  # noqa: E402
from fastapi import FastAPI, Request  # noqa: E402
from fastapi.responses import JSONResponse, Response  # noqa: E402
from websockets.asyncio.client import connect  # noqa: E402
from websockets.exceptions import ConnectionClosed, InvalidStatus  # noqa: E402

import live_move as lm  # noqa: E402
import live_move_api as api  # noqa: E402
import live_move_stand as lms  # noqa: E402
import supabase_rest  # noqa: E402
from live_stand_e2e import jwt  # noqa: E402

# the questions of live_mixed_local.sh's seed, in order: options and the right one (keep_order, so shown = stored)
N_OPTIONS = [4, 3, 6, 2, 3, 5]
KEYS = [1, 2, 1, 0, 0, 3]
# its kinds seed (LIVE_LOCAL_SEED=kinds), by the question's text: every right option (keep_order), or a text's forms
# with the wrong ones the bots type (20261102090000_live_kinds_teams.sql)
ANSWERS = {
    "Какие команды меняют данные в таблице?": {"keys": [0, 2, 4]},
    "Какая команда отменяет транзакцию?": {"keys": [1]},
    "Какие ключи бывают у таблицы?": {"keys": [0, 2]},
    "Как называется язык запросов к базам данных? Три буквы.": {"right": ["SQL", "sql", "Sql", "SQL."], "wrong": ["SEQUEL", "sequel", "PHP", "СКЛ"]},
    "Что делает JOIN?": {"keys": [1]},
    "Какой оператор группирует строки?": {"keys": [3]},
    # LIVE_LOCAL_SEED=numbers (20261102090100_live_numbers.sql): typed numbers, graded by the database's number rule
    "Сколько байт в килобайте?": {"right": ["1024", "1 024", "1024,0"], "wrong": ["1000", "1023", "512", "2048"]},
    "Скорость звука в воздухе при 20 °C?": {"right": ["343", "340 м/с", "350", "335"], "wrong": ["300", "1235", "3000", "100 м/с"]},
}


def keys_of(text: str | None, qi: int) -> list[int]:
    known = ANSWERS.get(text or "")
    if known and "keys" in known:
        return list(known["keys"])
    return [KEYS[qi] if 0 <= qi < len(KEYS) else 0]

NAMES = ["Алина", "Артём", "Ева", "Миша", "Соня", "Тимур", "Вера", "Глеб", "Даша", "Егор", "Катя", "Лёва", "Маша",
         "Никита", "Оля", "Паша", "Рита", "Саша", "Таня", "Федя", "Юля", "Ярик", "Лиза", "Илья", "Дима", "Аня", "Костя",
         "Женя", "Вика", "Роман"]
BODIES = ["round", "square", "drop", "bean", "cloud"]
COLOURS = ["blue", "yellow", "green", "pink", "sky", "orange", "violet", "teal"]
HATS = ["none", "cap", "beanie", "phones", "flower", "antenna", "bow", "none"]


def token(i: int) -> str:
    return f"mixed-local-bot-{i:02d}".ljust(43, "x")


def zone_spot(rng: random.Random, zone: int) -> tuple[float, float]:
    """A spot inside zone `zone` (live_move_stand.ARENA), away from its edges."""
    x, y, w, h = lms.ARENA["zones"][zone]["rect"]
    return x + 50 + rng.random() * (w - 100), y + 40 + rng.random() * (h - 80)


class Bot:
    def __init__(self, i: int, pin: str, rpc, url: str, skill: float, seed: int, think_s: float = 5.5) -> None:
        self.i = i
        self.think_s = think_s
        self.pin = pin
        self.rpc = rpc
        self.url = url
        self.skill = skill
        self.rng = random.Random(seed)
        self.game = ""
        self.you = None
        self.pos: tuple[float, float] | None = None
        self.t = 0
        self.state: dict | None = None
        self.target: tuple[float, float] | None = None
        self.plan_qi = -1
        self.start_at = 0.0
        self.seq = 0
        self.tapped: set[int] = set()

    async def run(self) -> None:
        look = {"body": BODIES[(self.i * 3) % 5], "colour": COLOURS[(self.i * 5 + 1) % 8], "eyes": "round",
                "hat": HATS[(self.i * 7 + 2) % len(HATS)]}
        joined = await self.rpc("live_join", {"p_pin": self.pin, "p_name": NAMES[self.i % len(NAMES)], "p_token": token(self.i),
                                              "p_look": look})
        self.game = joined["game_id"]
        await asyncio.gather(self._socket(), self._taps())

    async def _socket(self) -> None:
        while True:
            try:
                async with connect(self.url, max_queue=None) as ws:
                    await ws.send(json.dumps({"t": "hello", "v": 1, "game": self.game, "token": token(self.i), "role": "player"}))
                    welcome = json.loads(await asyncio.wait_for(ws.recv(), 10))
                    if welcome.get("t") == "welcome":
                        self.you = welcome.get("you")
                        await asyncio.gather(self._read(ws), self._drive(ws))
            except (ConnectionClosed, OSError, asyncio.TimeoutError, InvalidStatus):
                pass
            if self.state and self.state.get("phase") == "ended":
                return
            await asyncio.sleep(2 + self.rng.random())

    async def _read(self, ws) -> None:
        async for msg in ws:
            if isinstance(msg, bytes):
                snap = lm.decode_snapshot(msg)
                if snap is None:
                    continue
                self.t = snap["t"]
                for eid, x, y, _f in snap["ents"]:
                    if eid == self.you:
                        self.pos = (x / lm.Q, y / lm.Q)
                        break
            else:
                obj = json.loads(msg)
                if obj.get("t") == "stand" and obj.get("k") == "state":
                    self.state = obj

    def _plan(self, st: dict) -> None:
        qi = st["qi"]
        if qi == self.plan_qi:
            return
        self.plan_qi = qi
        keys = keys_of((st.get("q") or {}).get("text"), qi)
        n = len(st["q"]["options"]) if st.get("q") else 4
        roll = self.rng.random()
        if roll < self.skill:
            zone = self.rng.choice(keys)                  # several right zones: any of them
        elif roll < 0.93:
            zone = self.rng.choice([z for z in range(n) if z not in keys] or keys)
        else:
            zone = None                                  # stays in the corridor
        self.target = zone_spot(self.rng, zone) if zone is not None else None
        self.start_at = time.monotonic() + (self.rng.random() * 1.5 if self.rng.random() < 0.75 else 3 + self.rng.random() * 5)

    async def _drive(self, ws) -> None:
        last_ping = 0.0
        while True:
            await asyncio.sleep(0.05)
            now = time.monotonic()
            if now - last_ping > 2.0:
                last_ping = now
                await ws.send(json.dumps({"t": "ping", "c": 0}))
            st = self.state
            if st is None or self.pos is None or st.get("round") != "stand" or st["phase"] not in ("countdown", "open"):
                continue
            self._plan(st)
            if self.t >= (st.get("closes") or 0) - 150 or now < self.start_at or self.target is None:
                continue
            dx, dy = self.target[0] - self.pos[0], self.target[1] - self.pos[1]
            d = math.hypot(dx, dy)
            if d < 24:
                continue
            cx, cy = self.pos[0] - 800, self.pos[1] - 520       # round the stage rather than push into it
            if math.hypot(cx, cy) < 130:
                dx += cx * 1.5
                dy += cy * 1.5
                d = math.hypot(dx, dy) or 1
            self.seq += 1
            await ws.send(lm.encode_input(self.seq, [(round(127 * dx / d), round(127 * dy / d), 0)]))

    async def _taps(self) -> None:
        """The button questions: read the state about every 0.7 s, tap once per question after a think."""
        while True:
            await asyncio.sleep(0.6 + self.rng.random() * 0.3)
            try:
                st = await self.rpc("live_state", {"p_game": self.game, "p_token": token(self.i), "p_since_rev": None})
            except SystemExit:
                continue
            if st.get("state") in ("ended",):
                return
            q = st.get("question")
            me = st["me"]
            if (st.get("state") != "open" or not q or q.get("stand") or st["qi"] in self.tapped or me.get("choice") is not None
                    or me.get("picks") or me.get("typed")):
                continue
            qi = st["qi"]
            self.tapped.add(qi)
            await asyncio.sleep(self.rng.random() * self.think_s)
            n = len(q["options"])
            right = self.rng.random() < self.skill
            known = ANSWERS.get(q.get("text") or "", {})
            if q.get("kind") in ("short", "number"):
                pool = known.get("right" if right else "wrong") or ["?"]
                body = {"p_game": self.game, "p_token": token(self.i), "p_qi": qi, "p_answer": {"text": self.rng.choice(pool)}}
                fn = "live_submit"
            elif q.get("kind") == "multiple":
                keys = keys_of(q.get("text"), qi)
                if right:
                    picks = keys
                elif self.rng.random() < 0.6:                 # some of the right ones (a partial hit), maybe one wrong
                    picks = self.rng.sample(keys, max(1, len(keys) - 1))
                    if self.rng.random() < 0.4:
                        picks = picks + [self.rng.choice([z for z in range(n) if z not in keys] or keys)]
                else:
                    picks = [self.rng.choice([z for z in range(n) if z not in keys] or keys)]
                body = {"p_game": self.game, "p_token": token(self.i), "p_qi": qi, "p_answer": {"picks": sorted(set(picks))}}
                fn = "live_submit"
            else:
                key = keys_of(q.get("text"), qi)[0]
                body = {"p_game": self.game, "p_token": token(self.i), "p_qi": qi, "p_choice": key if right else self.rng.randrange(n)}
                fn = "live_answer"
            try:
                await self.rpc(fn, body)
            except SystemExit:
                pass


def make_app(rest: str, anon: str) -> FastAPI:
    app = FastAPI()
    app.include_router(api.router)
    cors = {"access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*"}
    client = httpx.AsyncClient(base_url=rest, timeout=15, trust_env=False)

    @app.options("/{rest_path:path}")
    async def preflight(rest_path: str) -> Response:
        return Response(status_code=204, headers=cors)

    @app.get("/auth/v1/health")
    async def health() -> Response:
        return JSONResponse({"ok": True}, headers=cors)

    @app.api_route("/rest/v1/{path:path}", methods=["GET", "POST", "PATCH", "DELETE"])
    async def to_postgrest(path: str, request: Request) -> Response:
        """The site's calls, as Supabase's gateway passes them on to PostgREST (as a guest: the local anon key)."""
        keep = {k: v for k, v in request.headers.items() if k.lower() in ("content-type", "prefer", "accept")}
        keep["authorization"] = f"Bearer {anon}"
        r = await client.request(request.method, f"/{path}", params=request.query_params, content=await request.body(), headers=keep)
        out = {k: v for k, v in r.headers.items() if k.lower() in ("content-type", "content-range", "retry-after")}
        return Response(r.content, status_code=r.status_code, headers={**out, **cors})

    @app.api_route("/{other:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"])
    async def elsewhere(other: str, request: Request) -> Response:
        """Anything else the site asks (the auth server, Realtime): nothing here."""
        return JSONResponse({"message": "not here"}, status_code=404, headers=cors)

    return app


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--local", action="store_true", help="required: this is a local tool")
    ap.add_argument("--rest", required=True, help="PostgREST's address")
    ap.add_argument("--secret", required=True, help="PostgREST's JWT secret")
    ap.add_argument("--container", required=True)
    ap.add_argument("--subject", required=True)
    ap.add_argument("--author", required=True)
    ap.add_argument("--bots", type=int, default=12)
    ap.add_argument("--questions", type=int, default=6)
    ap.add_argument("--every", type=int, default=3, choices=[0, 3, 5, 10], help="0: a battle without movement rounds")
    ap.add_argument("--time", type=int, default=10, choices=[10, 20, 30])
    ap.add_argument("--boss", default="skeleton", choices=["clock", "skeleton"])
    ap.add_argument("--teams", type=int, default=0, choices=[0, 2, 3, 4], help="teams (20261102090000_live_kinds_teams.sql)")
    ap.add_argument("--port", type=int, default=8418)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--join-s", type=float, default=8.0, help="the bots join over this many seconds")
    ap.add_argument("--skill", type=float, nargs=2, default=[0.3, 0.6], metavar=("LOW", "HIGH"),
                    help="each bot is right this often (a share between the two), so the boss lasts a short test")
    ap.add_argument("--think", type=float, default=5.5, help="a bot taps within this many seconds of the opening")
    ap.add_argument("--log", default="warning", choices=["debug", "info", "warning"], help="the room's own log (stderr)")
    a = ap.parse_args()
    if not a.local:
        raise SystemExit("live_mixed_local.py is a local tool: pass --local")
    logging.basicConfig(level=logging.WARNING, format="%(asctime)s %(name)s %(levelname)s %(message)s", stream=sys.stderr)
    logging.getLogger("live_move").setLevel(a.log.upper())
    anon = jwt(a.secret, {"role": "anon"})
    author = jwt(a.secret, {"role": "authenticated", "sub": a.author})
    supabase_rest._base_url = lambda: a.rest
    os.environ["SUPABASE_KEY"] = anon
    http = httpx.AsyncClient(base_url=a.rest, timeout=15, trust_env=False)

    async def rpc(fn: str, body: dict, bearer: str = anon) -> dict:
        r = await http.post(f"/rpc/{fn}", json=body, headers={"Authorization": f"Bearer {bearer}"})
        if r.status_code >= 400:
            raise SystemExit(f"{fn} → {r.status_code} {r.text[:200]}")
        return r.json()

    created = await rpc("live_create", {"p_source": {"container_id": a.container, "subject_ids": [a.subject], "count": a.questions},
                                        "p_settings": {"mode": "boss", "stand_every": a.every, "time_s": a.time, "boss": a.boss,
                                                       **({"teams": a.teams} if a.teams else {})}}, author)
    game, host_token, pin = created["game_id"], created["host_token"], created["pin"]
    api.hub = api.Hub()
    server = uvicorn.Server(uvicorn.Config(make_app(a.rest, anon), host="127.0.0.1", port=a.port, log_level="warning", lifespan="off",
                                           ws_max_size=65536))
    serve = asyncio.create_task(server.serve())
    while not server.started:
        await asyncio.sleep(0.05)
    url = f"ws://127.0.0.1:{a.port}{api.WS_PATH}"
    print(json.dumps({"game": game, "host_token": host_token, "pin": pin, "url": url, "http": f"http://127.0.0.1:{a.port}"}), flush=True)
    # the bots join once the projector has opened the room (a phone before the host gets 4404 and retries anyway)
    while game not in api.hub.rooms:
        await asyncio.sleep(0.2)
    await asyncio.sleep(1.5)
    rng = random.Random(a.seed)
    bots = []
    for i in range(a.bots):
        skill = a.skill[0] + rng.random() * (a.skill[1] - a.skill[0])
        bots.append(asyncio.create_task(Bot(i, pin, rpc, url, skill, a.seed * 100 + i, a.think).run()))
        await asyncio.sleep(a.join_s / max(1, a.bots) * (0.5 + rng.random()))
    try:
        await serve
    finally:
        try:
            await rpc("live_end", {"p_game": game, "p_host_token": host_token})
        except BaseException:
            pass


if __name__ == "__main__":
    asyncio.run(main())
