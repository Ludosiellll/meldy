"""Load test of the movement socket (backend/live_move_api.py): per room a projector and N phones that always move.

Each phone makes one command per server tick (20 Hz) and sends them in frames at --send-hz (15 Hz), pings every 2 s,
and reads every snapshot. Measured after --warmup seconds:
  - the server process's CPU % and RSS (and nginx's workers when --nginx-pid is given), from /proc;
  - the room's tick lateness and tick work time (p50/p99), from the host's `stats` command;
  - snapshot payload bytes a second per phone;
  - input → snapshot latency: from sending a command to the first snapshot whose ack covers it (p50/p95/p99).

Against the local load app (scripts/live_move_loadapp.py, token check mocked):
    python backend/scripts/live_move_load.py --url ws://127.0.0.1:17861/api/live/move/ws --players 40 --seconds 120 \
        --server-pid <uvicorn pid> --nginx-pid <nginx master pid>
Against a deployed Space it needs real tokens; use --probe there instead (one host token: connect, one stats call).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
import random
import sys
import time
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import live_move as lm  # noqa: E402
from websockets.asyncio.client import connect  # noqa: E402

HOST_TOKEN = "H" * 43
CLK = os.sysconf("SC_CLK_TCK")


def proc_cpu_seconds(pid: int) -> float:
    with open(f"/proc/{pid}/stat") as f:
        fields = f.read().rsplit(")", 1)[1].split()
    return (int(fields[11]) + int(fields[12])) / CLK


def proc_rss_kb(pid: int) -> int:
    with open(f"/proc/{pid}/status") as f:
        for line in f:
            if line.startswith("VmRSS:"):
                return int(line.split()[1])
    return 0


def children(pid: int) -> list[int]:
    out = []
    for name in os.listdir("/proc"):
        if name.isdigit():
            try:
                with open(f"/proc/{name}/stat") as f:
                    if int(f.read().rsplit(")", 1)[1].split()[1]) == pid:
                        out.append(int(name))
            except OSError:
                pass
    return out


def pct(values: list[float], q: float) -> float:
    if not values:
        return float("nan")
    s = sorted(values)
    return s[min(len(s) - 1, int(q * len(s)))]


class PhoneStats:
    def __init__(self) -> None:
        self.snap_bytes = 0
        self.text_bytes = 0
        self.snaps = 0
        self.frames_out = 0
        self.cmds_out = 0
        self.lat: list[float] = []
        self.gaps: list[float] = []
        self.closed: int | None = None


async def phone(url: str, game: str, token: str, a: argparse.Namespace, st: PhoneStats, t_measure: float, t_stop: float) -> None:
    ws = await connect(url, max_queue=None, open_timeout=15, compression=None if a.no_deflate else "deflate")
    await ws.send(json.dumps({"t": "hello", "v": 1, "game": game, "token": token, "role": "player"}))
    welcome = json.loads(await asyncio.wait_for(ws.recv(), 10))
    if welcome.get("t") != "welcome":
        raise RuntimeError(f"no welcome: {welcome}")
    tick_s = 1.0 / welcome["hz"]
    sent_at: dict[int, float] = {}
    state = {"ack": 0, "last_snap": None}

    async def reader() -> None:
        try:
            async for msg in ws:
                now = time.perf_counter()
                if isinstance(msg, bytes):
                    ack = int.from_bytes(msg[12:16], "little")
                    measuring = now >= t_measure
                    if measuring:
                        st.snap_bytes += len(msg)
                        st.snaps += 1
                        if state["last_snap"] is not None:
                            st.gaps.append((now - state["last_snap"]) * 1000)
                    state["last_snap"] = now
                    if ack > state["ack"]:
                        for s in range(state["ack"] + 1, ack + 1):
                            t = sent_at.pop(s, None)
                            if t is not None and measuring:
                                st.lat.append((now - t) * 1000)
                        state["ack"] = ack
                elif now >= t_measure:
                    st.text_bytes += len(msg.encode())
        except Exception:
            pass

    rtask = asyncio.create_task(reader())
    seq = 0
    angle = random.uniform(0, 2 * math.pi)
    turn_at = time.perf_counter() + random.uniform(0.5, 2.0)
    period = 1.0 / a.send_hz
    next_send = time.perf_counter()
    last_cmd = next_send
    next_ping = next_send + 2.0
    try:
        while True:
            next_send += period
            delay = next_send - time.perf_counter()
            if delay > 0:
                await asyncio.sleep(delay)
            now = time.perf_counter()
            if now >= t_stop:
                break
            n = int((now - last_cmd) / tick_s)
            if n <= 0:
                continue
            last_cmd += n * tick_s
            n = min(n, lm.MAX_CMDS_PER_MSG)
            if now >= turn_at:
                angle += random.uniform(-2.0, 2.0)
                turn_at = now + random.uniform(0.5, 2.0)
            jx, jy = int(127 * math.cos(angle)), int(127 * math.sin(angle))
            for i in range(n):
                sent_at[seq + 1 + i] = now
            await ws.send(lm.encode_input(seq + 1, [(jx, jy, 0)] * n))
            seq += n
            if now >= t_measure:
                st.frames_out += 1
                st.cmds_out += n
            if now >= next_ping:
                next_ping = now + 2.0
                await ws.send(json.dumps({"t": "ping", "c": now * 1000}))
    finally:
        await ws.close()
        rtask.cancel()
        st.closed = ws.close_code


async def host(url: str, game: str, a: argparse.Namespace, ready: asyncio.Event, reset_at: float, t_stop: float, out: dict) -> None:
    ws = await connect(url, max_queue=None, open_timeout=15, compression=None if a.no_deflate else "deflate")
    await ws.send(json.dumps({"t": "hello", "v": 1, "game": game, "token": HOST_TOKEN, "role": "host"}))
    welcome = json.loads(await asyncio.wait_for(ws.recv(), 10))
    assert welcome.get("t") == "welcome", welcome
    if a.npcs:
        await ws.send(json.dumps({"t": "cmd", "op": "npc", "on": True, "n": a.npcs}))
    ready.set()
    snap_bytes = 0
    stats = []

    async def reader() -> None:
        nonlocal snap_bytes
        async for msg in ws:
            if isinstance(msg, bytes):
                snap_bytes += len(msg)
            else:
                obj = json.loads(msg)
                if obj.get("t") == "stats":
                    stats.append(obj)

    rtask = asyncio.create_task(reader())
    await asyncio.sleep(max(0.0, reset_at - time.perf_counter()))
    await ws.send(json.dumps({"t": "cmd", "op": "stats", "reset": True}))
    while time.perf_counter() < t_stop:
        await asyncio.sleep(1.0)
        await ws.send(json.dumps({"t": "ping", "c": 0}))
    await ws.send(json.dumps({"t": "cmd", "op": "stats"}))
    for _ in range(50):
        if len(stats) >= 2:
            break
        await asyncio.sleep(0.1)
    out["stats"] = stats[-1] if stats else None
    out["host_snap_bytes"] = snap_bytes
    await ws.close()
    rtask.cancel()


async def sampler(pids: dict[str, list[int]], t_measure: float, t_stop: float, out: dict) -> None:
    rows = []
    while time.perf_counter() < t_stop + 0.5:
        row = {"t": time.perf_counter()}
        for name, plist in pids.items():
            cpu = 0.0
            rss = 0
            for pid in plist:
                try:
                    cpu += proc_cpu_seconds(pid)
                    rss += proc_rss_kb(pid)
                except OSError:
                    pass
            row[name] = (cpu, rss)
        rows.append(row)
        await asyncio.sleep(1.0)
    window = [r for r in rows if t_measure <= r["t"] <= t_stop + 0.5]
    res = {}
    for name in pids:
        if len(window) < 2:
            continue
        span = window[-1]["t"] - window[0]["t"]
        avg = (window[-1][name][0] - window[0][name][0]) / span * 100
        peaks = []
        for i in range(len(window) - 5):
            dt = window[i + 5]["t"] - window[i]["t"]
            peaks.append((window[i + 5][name][0] - window[i][name][0]) / dt * 100)
        res[name] = {"cpu_avg_pct": round(avg, 1), "cpu_peak5s_pct": round(max(peaks, default=avg), 1),
                     "rss_start_mb": round(window[0][name][1] / 1024, 1), "rss_end_mb": round(window[-1][name][1] / 1024, 1),
                     "rss_max_mb": round(max(r[name][1] for r in window) / 1024, 1)}
    out.update(res)


async def main_async(a: argparse.Namespace) -> dict:
    loop_start = time.perf_counter()
    t_measure = loop_start + a.warmup
    t_stop = t_measure + a.seconds
    pids: dict[str, list[int]] = {}
    if a.server_pid:
        pids["server"] = [a.server_pid]
    if a.nginx_pid:
        pids["nginx"] = children(a.nginx_pid) or [a.nginx_pid]
    pids["loadgen"] = [os.getpid()]
    usage: dict = {}
    sampler_task = asyncio.create_task(sampler(pids, t_measure, t_stop, usage))
    games = [str(uuid.uuid4()) for _ in range(a.rooms)]
    host_out = [dict() for _ in games]
    readies = [asyncio.Event() for _ in games]
    host_tasks = [asyncio.create_task(host(a.url, g, a, readies[i], t_measure, t_stop, host_out[i])) for i, g in enumerate(games)]
    for r in readies:
        await asyncio.wait_for(r.wait(), 15)
    phones: list[PhoneStats] = []
    tasks = []
    for i in range(a.players * a.rooms):
        game = games[i % a.rooms]
        token = ("L" + f"{i:05d}" + uuid.uuid4().hex)[:43].ljust(43, "x")
        st = PhoneStats()
        phones.append(st)
        tasks.append(asyncio.create_task(phone(a.url, game, token, a, st, t_measure, t_stop)))
        await asyncio.sleep(a.ramp / max(1, a.players * a.rooms))
    results = await asyncio.gather(*tasks, return_exceptions=True)
    errors = [repr(r) for r in results if isinstance(r, Exception)]
    await asyncio.gather(*host_tasks, return_exceptions=True)
    await sampler_task
    lat = [v for p in phones for v in p.lat]
    gaps = [v for p in phones for v in p.gaps]
    secs = a.seconds
    per_phone_bps = [p.snap_bytes / secs for p in phones]
    return {
        "config": {"rooms": a.rooms, "players_per_room": a.players, "send_hz": a.send_hz, "seconds": a.seconds,
                   "npcs": a.npcs, "deflate": not a.no_deflate, "url": a.url},
        "errors": errors[:5], "error_count": len(errors),
        "usage": usage,
        "server_rooms": [h.get("stats") for h in host_out],
        "phone": {
            "snap_payload_bytes_per_s_avg": round(sum(per_phone_bps) / len(per_phone_bps), 1) if phones else None,
            "snap_payload_bytes_avg": round(sum(p.snap_bytes for p in phones) / max(1, sum(p.snaps for p in phones)), 1),
            "snaps_per_s_avg": round(sum(p.snaps for p in phones) / secs / max(1, len(phones)), 2),
            "text_bytes_per_s_avg": round(sum(p.text_bytes for p in phones) / secs / max(1, len(phones)), 1),
            "frames_out_per_s_avg": round(sum(p.frames_out for p in phones) / secs / max(1, len(phones)), 2),
            "cmds_out_per_s_avg": round(sum(p.cmds_out for p in phones) / secs / max(1, len(phones)), 2),
            "input_to_snapshot_ms": {"p50": round(pct(lat, 0.5), 1), "p95": round(pct(lat, 0.95), 1),
                                     "p99": round(pct(lat, 0.99), 1), "n": len(lat)},
            "snapshot_gap_ms": {"p50": round(pct(gaps, 0.5), 1), "p99": round(pct(gaps, 0.99), 1),
                                "max": round(max(gaps, default=float("nan")), 1)},
        },
    }


async def probe(a: argparse.Namespace) -> dict:
    """A deployed Space: does the handshake pass the HF proxy, and does the socket stay up (host token from env)."""
    token = os.environ["LIVE_MOVE_PROBE_HOST_TOKEN"]
    ws = await connect(a.url, open_timeout=15)
    await ws.send(json.dumps({"t": "hello", "v": 1, "game": a.probe, "token": token, "role": "host"}))
    welcome = json.loads(await asyncio.wait_for(ws.recv(), 15))
    t0 = time.perf_counter()
    snaps = 0
    while time.perf_counter() - t0 < a.seconds:
        msg = await asyncio.wait_for(ws.recv(), 10)
        snaps += isinstance(msg, bytes)
    await ws.send(json.dumps({"t": "cmd", "op": "stats"}))
    await ws.close()
    return {"welcome": welcome.get("t"), "snapshots": snaps, "seconds": a.seconds}


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--url", required=True)
    p.add_argument("--rooms", type=int, default=1)
    p.add_argument("--players", type=int, default=40)
    p.add_argument("--send-hz", type=float, default=15.0)
    p.add_argument("--seconds", type=float, default=120.0)
    p.add_argument("--warmup", type=float, default=10.0)
    p.add_argument("--ramp", type=float, default=3.0)
    p.add_argument("--npcs", type=int, default=1)
    p.add_argument("--no-deflate", action="store_true")
    p.add_argument("--server-pid", type=int)
    p.add_argument("--nginx-pid", type=int)
    p.add_argument("--json")
    p.add_argument("--probe", help="a live game id: connect as its host (LIVE_MOVE_PROBE_HOST_TOKEN) and watch")
    a = p.parse_args()
    try:
        import uvloop
        factory = uvloop.new_event_loop
    except ImportError:
        factory = None
    result = asyncio.run(probe(a) if a.probe else main_async(a), loop_factory=factory)
    text = json.dumps(result, indent=1, ensure_ascii=False)
    print(text)
    if a.json:
        Path(a.json).write_text(text + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
