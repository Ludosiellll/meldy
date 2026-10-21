"""A mixed game's database in memory, as the SQL behaves (supabase/migrations/20261024090000_live_mixed.sql, rehearsed by
supabase/tests/local/live_mixed_behaviour.sql): the battle's state machine by time, taps (live_answer), the boss's HP,
phases and heals through the mirror of live_close (live_move_mixed.close_round), the movement rounds the room writes
with live_stand_close, a void round closed by time 8 s after the deadline, live_host_state as the room reads it. For
the room's tests (test_live_mixed.py, test_live_mixed_api.py); the durations can be shortened."""

from __future__ import annotations

import asyncio
import time
from typing import Any

import live_move_mixed as mixed
from live_stand_fake import FakeRefusal, iso


class FakeMixedDb:
    def __init__(self, game_id: str, host_token: str, questions: list[tuple[int, int]], *, every: int = 3,
                 time_s: int = 20, speed: bool = True, boss: str = "clock", countdown_s: float = 3.0,
                 open_s: float | None = None, tap_grace_s: float = 1.5, room_grace_s: float = 8.0, clock=time.time) -> None:
        self.game_id = game_id
        self.host_token = host_token
        self.every = every
        self.time_s = time_s
        self.speed = speed
        self.boss = boss
        self.countdown_s = countdown_s
        self.open_s = float(time_s) if open_s is None else open_s
        self.tap_grace_s = tap_grace_s
        self.room_grace_s = room_grace_s
        self.clock = clock
        n = len(questions)
        self.questions = [{"n": k, "key": key, "text": f"Вопрос {i + 1}", "options": [f"Ответ {j + 1}" for j in range(k)],
                           "stand": mixed.stand_round(every, n, i), "opens": None, "closes": None, "closed": None,
                           "phase": None, "room_at": None, "closed_as": None} for i, (k, key) in enumerate(questions)]
        self.players: dict[str, dict[str, Any]] = {}
        self.answers: dict[tuple[int, str], dict[str, Any]] = {}
        self.state = "lobby"
        self.qi = -1
        self.rev = 1
        self.hp = 0
        self.hp_max = 0
        self.phase = 0
        self.won: bool | None = None
        self.calls = {"host_state": 0, "stand_close": 0}
        self.fail_close = 0            # the next n stand_close calls fail with 503 (-1: all of them)
        self.latency = 0.0

    # ── the host and the players ──

    def join(self, pid: str, name: str = "", look: Any = None) -> None:
        self.players[pid] = {"name": name or pid[-4:], "look": look, "joined": self.clock(), "kicked": False, "dmg": 0,
                             "streak": 0, "best": 0, "right": 0, "frozen": False, "thaws": 0}
        if self.hp_max > 0 and self.hp > 0 and self.state in ("countdown", "open", "reveal", "leaderboard"):
            add = 55 * max(0, len(self.questions) - self.qi - (0 if self.state == "countdown" else 1))
            self.hp_max += add
            self.hp += add
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
            if self.hp == 0 or self.qi >= len(self.questions) - 1:
                self.won = self.hp_max > 0 and self.hp == 0
                self._move("podium")
            else:
                self._move("leaderboard")
        elif self.state == "leaderboard":
            self._countdown(self.qi + 1)
        elif self.state == "podium":
            self._move("ended")

    def end(self) -> None:
        self._move("ended")

    def answer(self, pid: str, choice: int) -> dict[str, Any]:
        """public.live_answer (the battle's tap)."""
        self.settle()
        q = self.questions[self.qi] if self.qi >= 0 else None
        p = self.players[pid]
        if q is None:
            raise FakeRefusal(400, "ML004", "bad_qi")
        if q["stand"]:
            raise FakeRefusal(400, "ML004", "stand")
        if self.state != "open":
            raise FakeRefusal(400, "ML004", "not_open")
        if p["joined"] > q["opens"]:
            raise FakeRefusal(400, "ML004", "not_joined_yet")
        if (self.qi, pid) in self.answers:
            raise FakeRefusal(400, "ML004", "twice")
        e = int(min(max((self.clock() - q["opens"]) * 1000, 0), self.time_s * 1000))
        self.answers[(self.qi, pid)] = {"c": choice, "e": e}
        if all((self.qi, a) in self.answers for a in self.active(q)):
            self._close()
        return {"accepted": True}

    # ── time ──

    def settle(self) -> None:
        now = self.clock()
        q = self.questions[self.qi] if self.qi >= 0 else None
        if self.state == "countdown" and now >= q["opens"]:
            self._move("open")
        if self.state == "open" and now > q["closes"] + (self.room_grace_s if q["stand"] else self.tap_grace_s):
            self._close()

    def _move(self, state: str) -> None:
        self.state = state
        self.rev += 1

    def _countdown(self, qi: int) -> None:
        now = self.clock()
        if qi == 0:
            self.hp_max = self.hp = len([p for p in self.players.values() if not p["kicked"]]) * len(self.questions) * 55
        q = self.questions[qi]
        q["opens"] = now + self.countdown_s
        q["closes"] = q["opens"] + self.open_s
        q["phase"] = self.phase
        self.qi = qi
        self._move("countdown")

    def active(self, q: dict[str, Any]) -> list[str]:
        live = [(p["joined"], pid) for pid, p in self.players.items() if not p["kicked"] and p["joined"] <= q["opens"]]
        return [pid for _, pid in sorted(live)]

    def rank(self) -> list[str]:
        live = [(pid, p) for pid, p in self.players.items() if not p["kicked"]]
        live.sort(key=lambda x: (-x[1]["dmg"], -x[1]["right"], -x[1]["best"], x[1]["joined"], x[0]))
        return [pid for pid, _ in live]

    def _close(self) -> None:
        q = self.questions[self.qi]
        if self.state != "open" or q["closed"] is not None:
            return
        answers = [(pid, a["c"], a["e"]) for (qi, pid), a in self.answers.items()
                   if qi == self.qi and not self.players[pid]["kicked"]]
        out = mixed.close_round(self.players, answers, self.active(q), key=q["key"], n_options=q["n"], time_s=self.time_s,
                                speed=self.speed, hp=self.hp, hp_max=self.hp_max, q_phase=q["phase"], phase=self.phase,
                                stand_round=q["stand"], void=q["stand"] and q["room_at"] is None)
        for pid, (ok, dmg) in out.outcome.items():
            self.answers[(self.qi, pid)].update(ok=ok, dmg=dmg)
        self.hp, self.phase = out.hp, out.phase
        q.update(closed=self.clock(), closed_as=out)
        self._move("reveal")

    # ── the room's calls ──

    def result(self, qi: int, again: bool) -> dict[str, Any]:
        """meldy_private.live_mixed_result."""
        q = self.questions[qi]
        out: mixed.Closed = q["closed_as"]
        rows = []
        for place, pid in enumerate(self.rank(), 1):
            p = self.players[pid]
            a = self.answers.get((qi, pid))
            rows.append({"p": pid, "c": a["c"] if a else None, "ok": bool(a and a.get("ok")), "dmg": a.get("dmg", 0) if a else 0,
                         "ms": a["e"] if a else None, "thawed": pid in out.thawed, "froze": pid in out.frozen_now,
                         "frozen": p["frozen"], "out": p["joined"] > q["opens"], "total": p["dmg"], "streak": p["streak"],
                         "best": p["best"], "right": p["right"], "place": place})
        return {"qi": qi, "key": q["key"], "counts": out.counts, "right": out.right, "active": len(self.active(q)),
                "again": again, "now": iso(self.clock()), "void": q["room_at"] is None, "healed": out.healed,
                "phase_changed": out.phase_changed,
                "hits": [{"player_id": pid, "dmg": d, "hp_after": h} for pid, d, h in out.hits],
                "frozen_now": out.frozen_now, "thawed": out.thawed,
                "boss": {"hp": self.hp, "hp_max": self.hp_max, "phase": self.phase, "defeated": self.hp_max > 0 and self.hp == 0},
                "rows": rows}

    def stand_close_sync(self, qi: int, answers: list[dict[str, Any]], token: str | None = None) -> dict[str, Any]:
        """public.live_stand_close in a mixed game."""
        if (token or self.host_token) != self.host_token:
            raise FakeRefusal(403, "42501", "host")
        self.settle()
        if qi < 0 or qi > self.qi:
            raise FakeRefusal(400, "ML004", "bad_qi")
        q = self.questions[qi]
        if not q["stand"]:
            raise FakeRefusal(400, "ML004", "tap")
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
        q["room_at"] = self.clock()
        self._close()
        return self.result(qi, False)

    def host_state_sync(self, since_rev: int | None = None) -> dict[str, Any]:
        """public.live_host_state of a mixed game (the parts the room reads)."""
        self.settle()
        now = self.clock()
        if since_rev is not None and since_rev == self.rev and self.state not in ("lobby", "open"):
            return {"rev": self.rev, "now": iso(now), "unchanged": True}
        q = self.questions[self.qi] if self.qi >= 0 else None
        question = None
        if q is not None and self.state in ("countdown", "open", "reveal", "leaderboard"):
            question = {"qi": self.qi, "text": q["text"], "options": q["options"], "opens_at": iso(q["opens"]),
                        "closes_at": iso(q["closes"]), "phase": q["phase"], "picture": None, "stand": q["stand"]}
        live = [p for p in self.players.values() if not p["kicked"]]
        return {
            "rev": self.rev, "now": iso(now), "state": self.state, "mode": "boss", "qi": self.qi,
            "q_count": len(self.questions), "time_s": self.time_s, "speed": self.speed, "players": len(live),
            "answered": 0, "question": question,
            "boss": {"hp": self.hp, "hp_max": self.hp_max, "phase": self.phase, "defeated": self.hp_max > 0 and self.hp == 0,
                     "kind": self.boss},
            "top": None,
            "mixed": {"every": self.every, "rounds": [i for i, x in enumerate(self.questions) if x["stand"]]},
            "pin": "123456", "topic": "t" * 22,
            "settings": {"mode": "boss", "time_s": self.time_s, "speed": self.speed, "who": "pin", "chat_names": True,
                         "boss": self.boss, "stand_every": self.every},
            "skipped": 0,
            "roster": [{"player_id": pid, "name": p["name"], "look": p["look"], "dmg": p["dmg"], "right": p["right"],
                        "streak": p["streak"], "frozen": p["frozen"], "joined_at": iso(p["joined"]), "answered": False}
                       for pid, p in self.players.items() if not p["kicked"]],
            "answered_ids": [], "result": None,
            "final": {"won": self.won, "accuracy_pct": 0} if self.state in ("podium", "ended") else None,
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
        if self.fail_close:
            self.fail_close -= 1
            raise FakeRefusal(503, "network")
        if game_id != self.game_id:
            raise FakeRefusal(404, "P0002", "game")
        return self.stand_close_sync(qi, answers, host_token)
