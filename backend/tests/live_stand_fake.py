"""A stand game's database in memory, as the SQL behaves (supabase/migrations/20261022090000_live_stand.sql, rehearsed
by supabase/tests/local/live_stand_behaviour.sql): the state machine by time, live_host_state, live_stand_close (the
room's write: points, ghosts, revives, late joiners, again), the close by time 8 s after the deadline. For the room's
tests (test_live_stand.py, test_live_stand_api.py); the durations can be shortened."""

from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone
from typing import Any

import live_move_stand as stand


class FakeRefusal(Exception):
    def __init__(self, status: int, code: str, details: str = "") -> None:
        super().__init__(f"{code}/{details}@{status}")
        self.status = status
        self.code = code
        self.details = details


def iso(t: float) -> str:
    return datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{int(t * 1000) % 1000:03d}Z"


class FakeLiveDb:
    def __init__(self, game_id: str, host_token: str, questions: list[tuple[int, int]], *, time_s: int = 15,
                 speed: bool = True, boss: str = "clock", countdown_s: float = 3.0, open_s: float | None = None,
                 grace_s: float = 8.0, clock=time.time) -> None:
        self.game_id = game_id
        self.host_token = host_token
        self.time_s = time_s
        self.speed = speed
        self.boss = boss
        self.countdown_s = countdown_s
        self.open_s = float(time_s) if open_s is None else open_s
        self.grace_s = grace_s
        self.clock = clock
        self.questions = [{"n": n, "key": key, "text": f"Вопрос {i + 1}", "options": [f"Ответ {j + 1}" for j in range(n)],
                           "opens": None, "closes": None, "closed": None, "counts": None, "right": 0,
                           "fell": [], "revived": [], "hits": []} for i, (n, key) in enumerate(questions)]
        self.players: dict[str, dict[str, Any]] = {}
        self.answers: dict[tuple[int, str], dict[str, Any]] = {}
        self.state = "lobby"
        self.qi = -1
        self.rev = 1
        self.state_at = clock()
        self.calls = {"host_state": 0, "stand_close": 0}
        self.fail_close = 0            # the next n stand_close calls fail with 503
        self.latency = 0.0             # seconds each call takes

    # ── the host and the players (the RPCs the screens call) ──

    def join(self, pid: str, name: str = "", look: Any = None) -> None:
        self.players[pid] = {"name": name or pid[-4:], "look": look, "joined": self.clock(), "kicked": False, "dmg": 0,
                             "streak": 0, "best": 0, "right": 0, "frozen": False, "thaws": 0}
        if self.state == "lobby":
            self.rev += 1

    def kick(self, pid: str) -> None:
        self.players[pid]["kicked"] = True
        self.rev += 1

    def next(self) -> None:
        self.settle()
        if self.state == "lobby":
            self._countdown(0)
        elif self.state == "reveal":
            if self.qi >= len(self.questions) - 1:
                self._move("podium")
            else:
                self._move("leaderboard")
        elif self.state == "leaderboard":
            self._countdown(self.qi + 1)
        elif self.state == "podium":
            self._move("ended")

    def end(self) -> None:
        self._move("ended")

    # ── time ──

    def settle(self) -> None:
        now = self.clock()
        q = self.questions[self.qi] if self.qi >= 0 else None
        if self.state == "countdown" and now >= q["opens"]:
            self._move("open")
        if self.state == "open" and now > q["closes"] + self.grace_s:
            self._close()

    def _move(self, state: str) -> None:
        self.state = state
        self.state_at = self.clock()
        self.rev += 1

    def _countdown(self, qi: int) -> None:
        now = self.clock()
        q = self.questions[qi]
        q["opens"] = now + self.countdown_s
        q["closes"] = q["opens"] + self.open_s
        self.qi = qi
        self._move("countdown")

    def active(self, q: dict[str, Any]) -> list[str]:
        return [pid for pid, p in self.players.items() if not p["kicked"] and p["joined"] <= q["opens"]]

    def rank(self) -> list[str]:
        live = [(pid, p) for pid, p in self.players.items() if not p["kicked"]]
        live.sort(key=lambda x: (-x[1]["dmg"], -x[1]["right"], -x[1]["best"], x[1]["joined"], x[0]))
        return [pid for pid, _ in live]

    def _close(self) -> None:
        """meldy_private.live_close_stand."""
        q = self.questions[self.qi]
        if self.state != "open" or q["closed"] is not None:
            return
        counts = [0] * q["n"]
        right = 0
        fell: list[str] = []
        revived: list[str] = []
        hits = []
        mine = sorted(((a["e"], pid) for (qi, pid), a in self.answers.items() if qi == self.qi and not self.players[pid]["kicked"]))
        for e, pid in mine:
            a = self.answers[(self.qi, pid)]
            p = self.players[pid]
            counts[a["c"]] += 1
            if a["c"] == q["key"]:
                right += 1
                pts = stand.stand_points(e, self.time_s, p["streak"] + 1, self.speed, p["frozen"])
                if p["frozen"]:
                    p.update(frozen=False, streak=0, thaws=p["thaws"] + 1)
                    revived.append(pid)
                else:
                    p["streak"] += 1
                    p["best"] = max(p["best"], p["streak"])
                p["dmg"] += pts
                p["right"] += 1
                a.update(ok=True, pts=pts)
                hits.append({"player_id": pid, "dmg": pts, "hp_after": 0})
            else:
                if not p["frozen"]:
                    fell.append(pid)
                p.update(streak=0, frozen=True)
                a.update(ok=False, pts=0)
        for pid in self.active(q):
            if (self.qi, pid) not in self.answers:
                p = self.players[pid]
                if not p["frozen"]:
                    fell.append(pid)
                p.update(streak=0, frozen=True)
        q.update(closed=self.clock(), counts=counts, right=right, fell=fell, revived=revived, hits=hits)
        self._move("reveal")

    # ── the room's calls ──

    def result(self, qi: int, again: bool) -> dict[str, Any]:
        """meldy_private.live_stand_result."""
        q = self.questions[qi]
        rows = []
        for place, pid in enumerate(self.rank(), 1):
            p = self.players[pid]
            a = self.answers.get((qi, pid))
            rows.append({"p": pid, "c": a["c"] if a else None, "ok": bool(a and a.get("ok")), "pts": a.get("pts", 0) if a else 0,
                         "ms": a["e"] if a else None, "fell": pid in q["fell"], "revived": pid in q["revived"],
                         "ghost": p["frozen"], "out": p["joined"] > q["opens"], "total": p["dmg"], "streak": p["streak"],
                         "best": p["best"], "right": p["right"], "place": place})
        return {"qi": qi, "key": q["key"], "counts": q["counts"], "right": q["right"], "active": len(self.active(q)),
                "again": again, "now": iso(self.clock()), "rows": rows}

    def stand_close_sync(self, qi: int, answers: list[dict[str, Any]], token: str | None = None) -> dict[str, Any]:
        """public.live_stand_close."""
        if (token or self.host_token) != self.host_token:
            raise FakeRefusal(403, "42501", "host")
        self.settle()
        if qi < 0 or qi > self.qi:
            raise FakeRefusal(400, "ML004", "bad_qi")
        q = self.questions[qi]
        if q["closed"] is not None:
            return self.result(qi, True)
        if qi != self.qi:
            raise FakeRefusal(400, "ML004", "bad_qi")
        if self.state != "open" or self.clock() < q["closes"] - 1.0:
            raise FakeRefusal(400, "ML004", "early")
        seen = set()
        for a in answers:
            if a["p"].lower() in seen or not 0 <= a["c"] < q["n"] or not 0 <= a["e"] <= self.time_s * 1000:
                raise FakeRefusal(400, "22023", "answers")
            seen.add(a["p"].lower())
        for a in answers:
            p = self.players.get(a["p"])
            if p is None or p["kicked"] or p["joined"] > q["opens"]:
                continue
            self.answers.setdefault((qi, a["p"]), {"c": a["c"], "e": a["e"]})
        self._close()
        return self.result(qi, False)

    def host_state_sync(self, since_rev: int | None = None) -> dict[str, Any]:
        """public.live_host_state (the parts the room reads)."""
        self.settle()
        now = self.clock()
        if since_rev is not None and since_rev == self.rev and self.state not in ("lobby", "open"):
            return {"rev": self.rev, "now": iso(now), "unchanged": True}
        q = self.questions[self.qi] if self.qi >= 0 else None
        question = None
        if q is not None and self.state in ("countdown", "open", "reveal", "leaderboard"):
            question = {"qi": self.qi, "text": q["text"], "options": q["options"], "opens_at": iso(q["opens"]),
                        "closes_at": iso(q["closes"]), "phase": 0, "picture": None}
        top = None
        if self.state in ("leaderboard", "podium"):
            top = [{"player_id": pid, "name": self.players[pid]["name"], "look": self.players[pid]["look"],
                    "dmg": self.players[pid]["dmg"], "move": 0} for pid in self.rank()[:5]]
        result = None
        if q is not None and q["closed"] is not None and self.state in ("reveal", "leaderboard", "podium", "ended"):
            result = {"qi": self.qi, "key": q["key"], "counts": q["counts"], "right": q["right"], "healed": 0,
                      "phase_changed": None, "hits": q["hits"], "frozen_now": q["fell"], "thawed": q["revived"]}
        live = [p for p in self.players.values() if not p["kicked"]]
        final = None
        if self.state in ("podium", "ended") and self.qi >= 0:
            asked = (self.qi + 1) * len(live)
            final = {"won": False, "accuracy_pct": int(100 * sum(p["right"] for p in live) / asked + 0.5) if asked else 0}
        return {
            "rev": self.rev, "now": iso(now), "state": self.state, "mode": "stand", "qi": self.qi,
            "q_count": len(self.questions), "time_s": self.time_s, "speed": self.speed, "players": len(live),
            "answered": 0, "question": question,
            "boss": {"hp": 0, "hp_max": 0, "phase": 0, "defeated": False, "kind": self.boss}, "top": top,
            "pin": "123456", "topic": "t" * 22,
            "settings": {"mode": "stand", "time_s": self.time_s, "speed": self.speed, "who": "pin", "chat_names": True,
                         "boss": self.boss},
            "skipped": 0,
            "roster": [{"player_id": pid, "name": p["name"], "look": p["look"], "dmg": p["dmg"], "right": p["right"],
                        "streak": p["streak"], "frozen": p["frozen"], "joined_at": iso(p["joined"]), "answered": False}
                       for pid, p in self.players.items() if not p["kicked"]],
            "answered_ids": [], "result": result, "final": final,
        }

    # ── as the room calls them (live_move_modes.GameSource) ──

    async def host_state(self, game_id: str, host_token: str, since_rev: int | None) -> dict[str, Any]:
        self.calls["host_state"] += 1
        if self.latency:
            await asyncio.sleep(self.latency)
        if game_id != self.game_id or host_token != self.host_token:
            raise FakeRefusal(403, "42501", "host")
        return self.host_state_sync(since_rev)

    async def stand_close(self, game_id: str, host_token: str, qi: int, answers: list[dict[str, Any]]) -> dict[str, Any]:
        self.calls["stand_close"] += 1
        if self.latency:
            await asyncio.sleep(self.latency)
        if self.fail_close > 0:
            self.fail_close -= 1
            raise FakeRefusal(503, "network")
        if game_id != self.game_id:
            raise FakeRefusal(404, "P0002", "game")
        return self.stand_close_sync(qi, answers, host_token)
