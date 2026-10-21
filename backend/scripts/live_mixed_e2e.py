"""The battle with movement rounds end to end (LOCAL ONLY; run by supabase/tests/local/live_mixed_e2e.sh): the real room
(live_move_api.Hub with its SupabaseVerifier, so live_host_state and live_stand_close go through PostgREST) on a local
uvicorn, the rehearsal's database behind a real PostgREST, and N bots that join with live_join, tap the button
questions with live_answer and run to their zones over the socket on the movement rounds. Six questions, every 3rd a
movement round, the leaderboards, the podium.

Then the database's word against the Python mirror (live_move_mixed.close_round): the whole game is replayed from the
answers the database stored, and the boss's HP, phase and heals, every player's points, streak, best, right answers,
freeze and thaws, every answer's damage and every question's hits, freezes and thaws must be the same. Also: every
movement answer is the zone the bot stood in, the room's numbers reached every phone and equal live_state, and no
snapshot went out during a button question. Last line «MIXED E2E …»; exit 0 when everything held.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import httpx  # noqa: E402
import uvicorn  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from websockets.asyncio.client import connect  # noqa: E402
from websockets.exceptions import ConnectionClosed  # noqa: E402

import live_move as lm  # noqa: E402
import live_move_api as api  # noqa: E402
import live_move_mixed as mixed  # noqa: E402
import supabase_rest  # noqa: E402
from live_stand_e2e import CENTRE, jwt  # noqa: E402

N_OPTIONS = [4, 3, 4, 2, 3, 4]      # the seed of live_mixed_e2e.sh, kept in order
KEYS = [1, 2, 1, 0, 0, 3]


def tok(i: int) -> str:
    return ("mixed-e2e-bot-" + str(i)).ljust(43, "x")


class Phone:
    def __init__(self, ws, welcome: dict) -> None:
        self.ws = ws
        self.you = welcome.get("you")
        self.snap = None
        self.snaps = 0
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
                    self.snaps += 1
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
            if time.monotonic() - last_ping > 2.0:
                last_ping = time.monotonic()
                try:
                    await self.ws.send(json.dumps({"t": "ping", "c": 0}))
                except ConnectionClosed:
                    return
            st = self.stand.get("state")
            if (st is None or self.snap is None or self.target is None or st.get("round") != "stand"
                    or st["phase"] not in ("countdown", "open") or self.snap["t"] >= st["closes"]):
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

    def state(self) -> dict | None:
        return self.stand.get("state")


HOST: "Phone | None" = None


async def wait_for(pred, within: float, what: str) -> None:
    end = time.monotonic() + within
    while not pred():
        if time.monotonic() > end:
            seen = json.dumps(HOST.state(), ensure_ascii=False)[:300] if HOST else "-"
            raise SystemExit(f"mixed e2e: timed out waiting for {what}; the projector's last state: {seen}")
        await asyncio.sleep(0.05)


def db_read(db: str, game: str) -> dict:
    """The game as the database stored it (psql as postgres, the rehearsal's cluster from PGHOST/PGPORT/PGUSER)."""
    sql = f"""select json_build_object(
      'game', (select row_to_json(g) from (select hp, hp_max, phase, time_s, speed, stand_every, q_count, state, won
                                             from public.live_games where id = '{game}') g),
      'questions', (select json_agg(q order by q.qi) from (select qi, key, jsonb_array_length(options) as n, phase, extract(epoch from opens_at)::float8 as opens_at,
                      closed_at is not null as closed, room_at is not null as room, healed, phase_changed, hits,
                      frozen_now, thawed, counts, right_n from public.live_questions where game_id = '{game}') q),
      'players', (select json_agg(p order by p.joined_at, p.id) from (select id, extract(epoch from joined_at)::float8 as joined_at, kicked_at is not null as kicked, dmg,
                    streak, best, right_n, frozen, thaws from public.live_players where game_id = '{game}') p),
      'answers', (select coalesce(json_agg(a order by a.qi, a.player_id), '[]') from (select qi, player_id, choice, elapsed_ms,
                    correct, dmg from public.live_answers where game_id = '{game}') a))"""
    out = subprocess.run(["psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-d", db, "-c", sql],
                         capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def check_against_mirror(d: dict) -> tuple[int, int]:
    """Replays the stored answers through the mirror; raises on the first difference. → (questions, answers) checked."""
    g = d["game"]
    players = [p for p in d["players"] if not p["kicked"]]
    ps = {p["id"]: dict(dmg=0, streak=0, best=0, right=0, frozen=False, thaws=0) for p in players}
    hp_max = len(players) * g["q_count"] * 55
    hp, phase = hp_max, 0
    n_answers = 0
    for q in d["questions"]:
        if not q["closed"]:
            break
        answers = [(a["player_id"], a["choice"], a["elapsed_ms"]) for a in d["answers"] if a["qi"] == q["qi"]]
        active = [p["id"] for p in players if p["joined_at"] <= q["opens_at"]]
        is_stand = mixed.stand_round(g["stand_every"], g["q_count"], q["qi"])
        if q["phase"] != phase:
            raise SystemExit(f"mixed e2e: q{q['qi']} opened in phase {q['phase']}, the mirror says {phase}")
        out = mixed.close_round(ps, answers, active, key=q["key"], n_options=q["n"], time_s=g["time_s"], speed=g["speed"],
                                hp=hp, hp_max=hp_max, q_phase=phase, phase=phase, stand_round=is_stand,
                                void=is_stand and not q["room"])
        hp, phase = out.hp, out.phase
        stored = [(h["player_id"], h["dmg"], h["hp_after"]) for h in q["hits"]]
        if stored != out.hits or q["frozen_now"] != out.frozen_now or q["thawed"] != out.thawed:
            raise SystemExit(f"mixed e2e: q{q['qi']} hits/freezes/thaws differ: database {stored} {q['frozen_now']} "
                             f"{q['thawed']}, mirror {out.hits} {out.frozen_now} {out.thawed}")
        if (q["healed"], q["phase_changed"], q["right_n"], q["counts"]) != (out.healed, out.phase_changed, out.right, out.counts):
            raise SystemExit(f"mixed e2e: q{q['qi']} heal/phase/right/counts differ")
        for a in d["answers"]:
            if a["qi"] == q["qi"] and a["player_id"] in ps:
                n_answers += 1
                if (a["correct"], a["dmg"]) != out.outcome[a["player_id"]]:
                    raise SystemExit(f"mixed e2e: q{q['qi']} answer of {a['player_id'][:8]}: database {a['correct']} {a['dmg']}, "
                                     f"mirror {out.outcome[a['player_id']]}")
    if (g["hp"], g["hp_max"], g["phase"]) != (hp, hp_max, phase):
        raise SystemExit(f"mixed e2e: the boss: database {g['hp']}/{g['hp_max']} phase {g['phase']}, mirror {hp}/{hp_max} phase {phase}")
    for p in players:
        mine = dict(dmg=p["dmg"], streak=p["streak"], best=p["best"], right=p["right_n"], frozen=p["frozen"], thaws=p["thaws"])
        if mine != ps[p["id"]]:
            raise SystemExit(f"mixed e2e: player {p['id'][:8]}: database {mine}, mirror {ps[p['id']]}")
    return len([q for q in d["questions"] if q["closed"]]), n_answers


async def _main(a: argparse.Namespace, made: list) -> int:
    anon = jwt(a.secret, {"role": "anon"})
    author = jwt(a.secret, {"role": "authenticated", "sub": a.author})
    supabase_rest._base_url = lambda: a.rest
    os.environ["SUPABASE_KEY"] = anon
    http = httpx.AsyncClient(base_url=a.rest, timeout=10, trust_env=False)

    async def rpc(fn: str, body: dict, bearer: str = anon) -> dict:
        r = await http.post(f"/rpc/{fn}", json=body, headers={"Authorization": f"Bearer {bearer}"})
        if r.status_code >= 400:
            raise SystemExit(f"mixed e2e: {fn} → {r.status_code} {r.text[:200]}")
        return r.json()

    created = await rpc("live_create", {"p_source": {"container_id": a.container, "subject_ids": [a.subject], "count": 6},
                                        "p_settings": {"stand_every": 3, "time_s": 10, "boss": "skeleton"}}, author)
    game, host_token, pin = created["game_id"], created["host_token"], created["pin"]
    made.append((game, host_token))
    for i in range(a.players):
        await rpc("live_join", {"p_pin": pin, "p_name": f"Бот {i + 1}", "p_token": tok(i), "p_look": None})

    app = FastAPI()
    app.include_router(api.router)
    api.hub = api.Hub()
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
            raise SystemExit(f"mixed e2e: no welcome for {role}: {welcome}")
        return Phone(ws, welcome)

    global HOST
    host = HOST = await join(host_token, "host")
    phones = [await join(tok(i), "player") for i in range(a.players)]
    runner = api.hub.rooms[game]
    assert runner.mode is not None and runner.mode.kind == "mixed", "the room has no mixed mode"
    await wait_for(lambda: host.stand.get("hello", {}).get("mixed", {}).get("rounds") == [2, 5], 5, "hello")

    async def sync() -> None:
        await host.ws.send(json.dumps({"t": "cmd", "op": "sync"}))

    targets = lambda i: None if i % 10 == 9 else i % 4   # noqa: E731
    stomp_after: list[float] = []
    quiet_snaps = 0
    for qi in range(6):
        stand_round = qi in (2, 5)
        before = sum(p.snaps for p in phones)
        st = await rpc("live_next", {"p_game": game, "p_host_token": host_token, "p_expect": "lobby" if qi == 0 else "leaderboard"})
        if bool(st["question"].get("stand")) != stand_round:
            raise SystemExit(f"mixed e2e: q{qi} stand = {st['question'].get('stand')}")
        await sync()
        await wait_for(lambda: host.state() and host.state()["qi"] == qi and host.state()["phase"] in ("countdown", "open"), 3, f"countdown {qi}")
        if not stand_round:
            opens = (await rpc("live_state", {"p_game": game, "p_token": tok(0), "p_since_rev": None}))["question"]["opens_at"]
            await asyncio.sleep(3.1)
            res = await asyncio.gather(*(rpc("live_answer", {"p_game": game, "p_token": tok(i), "p_qi": qi,
                                                              "p_choice": (i + qi) % N_OPTIONS[qi]}) for i in range(a.players)))
            if not all(r.get("accepted") for r in res):
                raise SystemExit(f"mixed e2e: taps refused at q{qi} (opens {opens})")
            await sync()
            await wait_for(lambda: host.state()["phase"] == "reveal" and host.state()["qi"] == qi, 4, f"tap reveal {qi}")
            quiet_snaps += sum(p.snaps for p in phones) - before
        else:
            seen = host.snaps
            await wait_for(lambda: host.snaps > seen, 3, f"the arena's snapshots at q{qi}")
            for i, p in enumerate(phones):
                p.target = targets(i)
            await wait_for(lambda: host.state()["phase"] == "reveal" and host.state()["qi"] == qi and host.state()["res"], 20, f"reveal {qi}")
            st = host.state()
            if st["res"]["key"] != KEYS[qi] or st["res"]["void"]:
                raise SystemExit(f"mixed e2e: q{qi} key {st['res']['key']} void {st['res']['void']}")
            stomp_after.append(st["res"]["at"] - st["closes"])
            await wait_for(lambda: all(p.mes and p.mes[-1]["last"]["qi"] == qi for p in phones), 5, f"me {qi}")
            await wait_for(lambda: host.state()["floor"] == "up", 8, f"floor {qi}")
            for p in phones:
                p.target = None
        await rpc("live_next", {"p_game": game, "p_host_token": host_token, "p_expect": "reveal"})
        await sync()
        await wait_for(lambda: host.state()["phase"] in ("leaderboard", "podium"), 3, f"after reveal {qi}")
    await wait_for(lambda: host.state()["phase"] == "podium", 3, "podium")
    if quiet_snaps:
        raise SystemExit(f"mixed e2e: {quiet_snaps} snapshots went out during button questions")

    # The phones' numbers from the room against live_state; the movement answers against where the bots stood.
    agree = total = 0
    for i, p in enumerate(phones):
        state = await rpc("live_state", {"p_game": game, "p_token": tok(i), "p_since_rev": None})
        review = await rpc("live_review", {"p_game": game, "p_token": tok(i)})
        for item in review["items"]:
            if item.get("stand") and targets(i) is not None:
                total += 1
                agree += item["choice"] == targets(i)
        mine = {m["last"]["qi"]: m for m in p.mes}
        if mine[5]["pts"] != state["me"]["dmg"] or mine[5]["frozen"] != state["me"]["frozen"]:
            raise SystemExit(f"mixed e2e: bot {i}: the room said {mine[5]['pts']}/{mine[5]['frozen']}, the database "
                             f"{state['me']['dmg']}/{state['me']['frozen']}")
    if agree != total:
        raise SystemExit(f"mixed e2e: {total - agree} of {total} movement answers are not where the bots stood")
    d = db_read(a.db, game)
    n_q, n_a = check_against_mirror(d)

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
    g = d["game"]
    print(f"MIXED E2E: {a.players} players, 6 questions (movement rounds 3 and 6), {agree}/{total} movement answers where "
          f"the bots stood, no snapshot in button questions; the database equals the mirror on {n_q} questions and "
          f"{n_a} answers (boss {g['hp']}/{g['hp_max']}, phase {g['phase']}); stomp "
          f"{', '.join(f'{x:.0f}' for x in stomp_after)} ms after zero; tick work p99 {stats['work_ms']['p99']} ms; "
          f"room writes {runner.mode.writes}, polls {runner.mode.polls}")
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
    ap.add_argument("--db", required=True)
    ap.add_argument("--players", type=int, default=30)
    sys.exit(asyncio.run(asyncio.wait_for(main(ap.parse_args()), 240)))
