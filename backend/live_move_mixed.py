"""A battle with movement rounds on top of a movement room (contract: docs/live/MODE_MIXED.md).

The live game is the battle «Битва с монстром»: phones answer with buttons, the class fights «Дедлайн» (HP, freezes,
heals). In a mixed game (``settings.stand_every`` 3, 5 or 10) every Nth question is a movement round of «Встань на
ответ»: the question is played in the arena, the room reads the zones at the deadline and writes them with
``live_stand_close``, and the database closes the round with the battle's own close (the same damage, freezes, thaws,
heal and phases). The database says which question is a movement round (``question.stand`` in ``live_host_state``);
the room never computes the rule.

The room runs the stand rules only while a movement round is on screen (its countdown, open and reveal): zone
tracking each tick, the decision at ``closes + 250 ms``, the write, the stomp, 10 snapshots a second. Between movement
rounds the room stays connected and cheap: no zone checks and no snapshots; the sockets carry pings, pongs and a
``state`` message when the round changes. Nobody stays a ghost: whoever fell comes back when the floor returns, and
the battle's freeze (``live_players.frozen``) is drawn as ice (``F_ICE``), not as a ghost.

The mirror of the battle's numbers (``damage``, ``close_round``) serves the tests and the end-to-end check against
the database (``backend/scripts/live_mixed_e2e.py``); the database is the judge.
"""

from __future__ import annotations

import asyncio
import math
from dataclasses import dataclass, field
from typing import Any, Iterable

import live_move as lm
import live_move_stand as stand

# A character frozen in the battle (a wrong answer, or none from phase 1): drawn with ice. A right zone thaws it.
# Bits 5-7 belong to the room's mode; F_GHOST (bit 5) is the fall of this round only.
F_ICE = 1 << 6

# Where everyone stands when a movement round is announced: two rows along the corridor between the zones (y 490 and
# 550 are outside every zone), clear of the stage, the nearest to the stage first. Every character starts as far from
# every zone as the others: nobody keeps a zone from an earlier round.
LINE_ROWS = (490.0, 550.0)
LINE_STEP = 40.0
LINE_CLEAR = 100.0           # |x − stage x| below this is the stage (radius 80 + a character's 18)


def line_spots() -> list[tuple[float, float]]:
    xs = [60.0 + LINE_STEP * k for k in range(int((1540.0 - 60.0) / LINE_STEP) + 1)]
    xs = [x for x in xs if abs(x - stand.STAGE[0]) >= LINE_CLEAR]
    spots = [(x, y) for x in xs for y in LINE_ROWS]
    spots.sort(key=lambda s: (abs(s[0] - stand.STAGE[0]), s[0], s[1]))
    return spots


LINE = line_spots()


# ─────────────────────────────────────────── The battle's numbers (mirror) ───────────────────────────────────────────


def damage(elapsed_ms: int, time_s: int, streak_after: int, speed: bool) -> int:
    """meldy_private.live_damage / rules.ts damage: round(100 × speed × mult) in doubles, rounded as Math.round."""
    limit = time_s * 1000
    share = 0.5 + 0.5 * max(0.0, 1.0 - float(min(max(elapsed_ms, 0), limit)) / float(limit)) if speed else 1.0
    mult = 1.0 + 0.25 * float(min(max(streak_after - 1, 0), 4))
    return int(math.floor(100.0 * share * mult + 0.5))


def phase_for(hp: int, hp_max: int) -> int:
    return 2 if hp * 3 <= hp_max else 1 if hp * 3 <= hp_max * 2 else 0


def heal(hp_max: int) -> int:
    return int(math.floor(hp_max * 0.05 + 0.5))


def right_needed(active: int) -> int:
    return (2 * active + 2) // 3


def share(picks: Iterable[int], keys: Iterable[int]) -> float:
    """meldy_private.live_share / rules.ts liveShare: a button answer to a question of several right answers is worth
    (right ticked − wrong ticked) / right count, never below 0 (1 only for the exact set)."""
    ks = set(keys)
    ps = set(picks)
    return float(max(0, len(ps & ks) - len(ps - ks))) / float(max(1, len(ks)))


#: «Без спешки» (20261106090000_live_calm.sql): a right answer is this many points, whenever and however often in a row.
CALM_DAMAGE = 100


def partial(elapsed_ms: int, time_s: int, streak_after: int, speed: bool, part: float) -> int:
    """A partial hit (several right answers, some of them ticked): round(damage × share), as live_close."""
    return int(math.floor(float(damage(elapsed_ms, time_s, streak_after, speed)) * part + 0.5))


def stand_round(every: int, q_count: int, qi: int) -> bool:
    """meldy_private.live_stand_round: every Nth question, and the last one when the game is shorter than N."""
    if not every or every <= 0 or not 0 <= qi < q_count:
        return False
    return (qi + 1) % every == 0 or (q_count < every and qi == q_count - 1)


@dataclass
class Closed:
    """One question closed by the mirror (meldy_private.live_close)."""

    hp: int
    phase: int
    healed: int = 0
    phase_changed: int | None = None
    right: int = 0
    counts: list[int] = field(default_factory=list)
    hits: list[tuple[str, int, int]] = field(default_factory=list)     # (player, dmg, hp_after)
    frozen_now: list[str] = field(default_factory=list)
    thawed: list[str] = field(default_factory=list)
    outcome: dict[str, tuple[bool, int]] = field(default_factory=dict)  # player → (correct, dmg)


def close_round(players: dict[str, dict[str, Any]], answers: Iterable[tuple[str, Any, int]], active: list[str], *,
                key: int, n_options: int, time_s: int, speed: bool, hp: int, hp_max: int, q_phase: int, phase: int,
                stand_round: bool = False, void: bool = False, keys: Iterable[int] | None = None, calm: bool = False) -> Closed:
    """meldy_private.live_close for one question, changing ``players`` in place ({dmg, streak, best, right, frozen,
    thaws} per id; kicked players are left out by the caller). ``answers``: (player, choice, elapsed ms), the choice an
    option (a tap or the room's zone) or a list of options ticked (a button question of several right answers);
    ``active``: players not kicked who joined by the question's opening, in the order they joined. ``keys``: every right
    option of a question of several (a zone on any of them is right; ticks score their ``share``). A movement round
    (``stand_round``) freezes «no zone» in any phase; a ``void`` one (the room never wrote it) changes nobody.
    ``calm`` («Без спешки», live_games.calm): a right answer is CALM_DAMAGE (its share for ticks), no speed, no streak
    bonus, and nobody freezes — the points say only how much was right."""
    out = Closed(hp=hp, phase=phase, counts=[0] * n_options)
    right_keys = list(keys) if keys is not None else [key]
    answered = set()
    for pid, choice, elapsed in sorted(answers, key=lambda a: (a[2], a[0])):
        p = players[pid]
        answered.add(pid)
        if isinstance(choice, (list, tuple)):
            for c in choice:
                if 0 <= c < n_options:
                    out.counts[c] += 1
            part = share(choice, right_keys)
        else:
            out.counts[choice] += 1
            part = 1.0 if choice in right_keys else 0.0
        if 0.0 < part < 1.0:
            d = 0 if p["frozen"] else (int(math.floor(CALM_DAMAGE * part + 0.5)) if calm else partial(elapsed, time_s, p["streak"] + 1, speed, part))
            p.update(streak=0, dmg=p["dmg"] + d)
            if d > 0:
                out.hp = max(0, out.hp - d)
                out.hits.append((pid, d, out.hp))
            out.outcome[pid] = (False, d)
            continue
        if part >= 1.0:
            out.right += 1
            if p["frozen"]:
                p.update(frozen=False, streak=1, thaws=p["thaws"] + 1, best=max(p["best"], 1), right=p["right"] + 1)
                out.thawed.append(pid)
                out.outcome[pid] = (True, 0)
            else:
                d = CALM_DAMAGE if calm else damage(elapsed, time_s, p["streak"] + 1, speed)
                out.hp = max(0, out.hp - d)
                p.update(streak=p["streak"] + 1, dmg=p["dmg"] + d, right=p["right"] + 1)
                p["best"] = max(p["best"], p["streak"])
                out.hits.append((pid, d, out.hp))
                out.outcome[pid] = (True, d)
        else:
            if not p["frozen"] and not calm:
                out.frozen_now.append(pid)
            p.update(streak=0, frozen=p["frozen"] or not calm)
            out.outcome[pid] = (False, 0)
    if not void:
        freeze = not calm and (q_phase >= 1 or stand_round)
        for pid in active:
            if pid in answered:
                continue
            p = players[pid]
            if freeze and not p["frozen"]:
                out.frozen_now.append(pid)
            p.update(streak=0, frozen=p["frozen"] or freeze)
        if q_phase == 2 and out.hp > 0 and out.right < right_needed(len(active)):
            out.healed = min(heal(hp_max), hp_max - out.hp)
            out.hp += out.healed
    new_phase = max(phase, phase_for(out.hp, hp_max))
    out.phase_changed = new_phase if new_phase > phase else None
    out.phase = new_phase
    return out


# ─────────────────────────────────────────── The rules in the room ───────────────────────────────────────────


class MixedGame(stand.StandGame):
    """The room's side of a mixed game. ``round`` is the kind of the current question ("stand" | "tap", None in the
    lobby); ``live`` says whether the arena is on (a movement round's countdown, open or reveal)."""

    def __init__(self, *, time_s: int = 20, speed: bool = True, q_count: int = 0, boss: str = "clock", every: int = 0,
                 rounds: Iterable[int] = ()) -> None:
        super().__init__(time_s=time_s, speed=speed, q_count=q_count, boss=boss)
        self.every = every
        self.rounds = [int(r) for r in rounds]
        self.round: str | None = None
        self.iced: set[str] = set()                    # live_players.id frozen in the battle (the database's word)
        self.placed: set[int] = set()                  # entity ids lined up for this movement round

    @property
    def live(self) -> bool:
        return self.round == "stand" and self.phase in ("countdown", "open", "reveal")

    # ── the game's state (from the database) ──

    def begin(self, qi: int, q: dict[str, Any], opens_ms: float, closes_ms: float, now_ms: float) -> None:
        """A movement round is announced (or found running: the room learned it late): the arena is on and everyone
        lines up, so nobody starts on a zone kept from an earlier round. A round found already closed (the reveal of a
        room that came late) moves nobody."""
        self.round = "stand"
        self.ghosts = set()
        self.placed = set()
        super().begin(qi, q, opens_ms, closes_ms, now_ms)
        if self.room is not None:
            for p in self.room.players.values():
                if now_ms < closes_ms:
                    self._line_up(p)
                self._ice(p)

    def chase_round(self, qi: int) -> bool:
        """The second, fourth, … movement round of the game is a chase («Убеги от Дедлайна», MODE_RUN.md)."""
        return qi in self.rounds and self.rounds.index(qi) % 2 == 1

    def tap(self, qi: int, phase: str) -> None:
        """A button question (countdown, open or reveal): the arena is off; nothing is tracked."""
        if self.floor == "down":
            self.ghosts = set()
            self._floor_up()
        self._release()
        self._call_off()
        self.chase = False
        self.round = "tap"
        self.qi = qi
        self.q = None
        self.res = None
        self.res_pts = []
        self.track = {}
        self.at_decision = {}
        self.decided = False
        self.phase = phase

    def set_phase(self, phase: str, *, top: list[dict[str, Any]] | None = None, acc: int | None = None) -> None:
        """lobby, leaderboard, podium or ended: the arena is off (the battle's screens show these)."""
        self.ghosts = set()
        super().set_phase(phase)
        if phase == "lobby":
            self.round = None

    def sync_ice(self, frozen: dict[str, bool]) -> None:
        """Ice as the database has it (the host roster's «frozen»); repainted unless a stomp is on screen."""
        self.iced = {pid for pid, f in frozen.items() if f}
        if self.room is not None and self.floor == "up":
            for p in self.room.players.values():
                self._ice(p)

    def on_player(self, p: lm.Player) -> None:
        """A (re)joining character: no ghost, its ice; one that arrives while a movement round runs lines up."""
        if self.floor == "up":
            self._paint(p, False)
        self._ice(p)
        if self.round == "stand" and self.phase in ("countdown", "open") and not self.decided and p.id not in self.placed:
            self._line_up(p)

    # ── each tick ──

    def on_tick(self, room: lm.Room) -> None:
        if self.round == "stand":
            super().on_tick(room)

    # ── the result ──

    def apply(self, res: dict[str, Any], now_ms: float) -> bool:
        """live_stand_close's answer for a movement round → the stomp. Who falls is where they stand: every character
        not on the right zone (a void round drops nobody); all of them come back when the floor returns."""
        room = self.room
        qi = res.get("qi")
        if room is None or qi != self.qi or self.applied_qi == qi or not isinstance(res.get("rows"), list):
            return False
        key = int(res.get("key", -1))
        keys = stand.keys_of(res)
        void = bool(res.get("void"))
        rows = [r for r in res["rows"] if isinstance(r, dict) and isinstance(r.get("p"), str)]
        fall_ticks = max(1, math.ceil(stand.FALL_MS * room.tick_hz / 1000))
        fell: list[int] = []
        for p in room.players.values():
            on_island = self.at_decision.get(p.id, room.map.zone_index(p.x, p.y)) - 1 in keys
            if void or on_island:
                self._paint(p, False)
                p.frozen_until = stand.HOLD if not void else 0
            else:
                fell.append(p.id)
                self._paint(p, True)
                p.frozen_until = room.tick + fall_ticks
        fell_set = set(fell)
        iced: set[str] = set()
        thawed: list[int] = []
        froze: list[int] = []
        hits = [h for h in res.get("hits") or [] if isinstance(h, dict)]
        # «Быстрее всех» is the first hit in the order the database stored them (time, then player id), the order the
        # projector lands them in: on a tie in time it names the hit that lands first (docs/live/MODE_MIXED.md §4.2)
        hit_at: dict[Any, int] = {}
        for i, h in enumerate(hits):
            hit_at.setdefault(h.get("player_id"), i)
        fastest: tuple[float, float, int, int | None, int | None] | None = None   # (hit no, ms, −dmg, id, ms)
        for r in rows:
            pid = r["p"]
            p = room.by_pid.get(pid)
            eid = p.id if p is not None else None
            ok = bool(r.get("ok"))
            dmg = int(r.get("dmg") or 0)
            if r.get("frozen"):
                iced.add(pid)
            if eid is not None and r.get("thawed"):
                thawed.append(eid)
            if eid is not None and r.get("froze"):
                froze.append(eid)
            if ok and dmg > 0 and eid is not None:
                ms = r.get("ms")
                timed = isinstance(ms, (int, float))
                cand = (float(hit_at.get(pid, math.inf)), float(ms) if timed else math.inf, -dmg, eid, int(ms) if timed else None)
                if fastest is None or cand[:3] < fastest[:3]:
                    fastest = cand
            self.me[pid] = {
                "ghost": False, "pts": int(r.get("total") or 0), "streak": int(r.get("streak") or 0),
                "best": int(r.get("best") or 0), "right": int(r.get("right") or 0), "place": r.get("place"),
                "of": len(rows), "frozen": bool(r.get("frozen")),
                "last": {"qi": qi, "choice": r.get("c"), "ok": ok, "pts": dmg, "ms": r.get("ms"),
                         "fell": eid in fell_set, "revived": False, "late": bool(r.get("out")),
                         "thawed": bool(r.get("thawed")), "froze": bool(r.get("froze")), "void": void},
            }
        self.iced = iced
        for p in room.players.values():
            self._ice(p)
        self.ghosts = set()                       # nobody stays a ghost: the floor brings everyone back
        self.applied_qi = qi
        self.phase = "reveal"
        self.floor = "up" if void else "down"
        self.back_at = now_ms if void else now_ms + stand.FLOOR_MS
        by_pid = {pid: p.id for pid, p in room.by_pid.items()}
        boss = res.get("boss") if isinstance(res.get("boss"), dict) else {}
        self.res = {
            "qi": qi, "key": key, **({"keys": keys} if len(keys) > 1 else {}), **stand.number_of(res),
            "counts": res.get("counts") if isinstance(res.get("counts"), list) else [],
            "stood": int(res.get("right") or 0), "of": int(res.get("active") or 0),
            "fastest": None if fastest is None else {"id": fastest[3], "pts": -fastest[2], "ms": fastest[4]},
            "fell": fell, "back": list(fell), "at": int(now_ms), "back_at": int(self.back_at),
            "thawed": thawed, "froze": froze, "hp": boss.get("hp"), "hp_max": boss.get("hp_max"),
            "phase": boss.get("phase"), "defeated": bool(boss.get("defeated")), "healed": int(res.get("healed") or 0),
            "phase_changed": res.get("phase_changed"), "void": void,
        }
        self.res_pts = [[by_pid[h["player_id"]], int(h.get("dmg") or 0), int(h.get("hp_after") or 0)]
                        for h in hits if h.get("player_id") in by_pid]
        return True

    # ── what the clients get ──

    def hello(self) -> dict[str, Any]:
        return dict(super().hello(), mixed={"every": self.every, "rounds": self.rounds})

    def state(self, host: bool) -> dict[str, Any]:
        st = super().state(False)
        st["round"] = self.round
        st["top"] = None
        st["acc"] = None
        if host and st["res"] is not None:
            st["res"] = dict(st["res"], pts=[h[:2] for h in self.res_pts], hits=self.res_pts)
        return st

    # ── inside ──

    def _ice(self, p: lm.Player) -> None:
        p.mode_flags = (p.mode_flags | F_ICE) if p.pid in self.iced else (p.mode_flags & ~F_ICE)

    def _line_up(self, p: lm.Player) -> None:
        room = self.room
        if room is None:
            return
        k = len(self.placed) % len(LINE)
        x, y = LINE[k]
        p.x, p.y = lm.move_circle(room.map, x, y, 0.0, 0.0, lm.PLAYER_R)
        self.placed.add(p.id)


# ─────────────────────────────────────────── The glue ───────────────────────────────────────────


class MixedMode(stand.StandMode):
    """The stand glue (polling, the clock, the write with retries, the messages) with the mixed game's rules."""

    kind = "mixed"

    def __init__(self, runner: Any, host_state: dict[str, Any], source: Any) -> None:
        super().__init__(runner, host_state, source)
        settings = host_state.get("settings") or {}
        mixed = host_state.get("mixed") if isinstance(host_state.get("mixed"), dict) else {}
        self.game = MixedGame(time_s=int(settings.get("time_s") or 20), speed=bool(settings.get("speed", True)),
                              q_count=int(host_state.get("q_count") or 0), boss=str(settings.get("boss") or "clock"),
                              every=int(mixed.get("every") or settings.get("stand_every") or 0),
                              rounds=[r for r in mixed.get("rounds") or [] if isinstance(r, int)])
        self.game.players = int(host_state.get("players") or 0)
        self.game.on_decide = self._on_decide
        self.game.on_change = self.broadcast
        self.hooks = self.game

    def snapshots(self) -> bool:
        return self.game.live

    def on_join(self, conn: Any) -> None:
        if conn.player is not None:
            self.game.on_player(conn.player)
        conn.send_text(stand._dumps(self.game.hello()))
        conn.send_text(stand._dumps(self.game.state(conn.role == "host")))
        if conn.player is not None and self.game.live and self.game.applied_qi == self.game.qi:
            me = self.game.me_of(conn.player.pid)
            if me is not None:
                conn.send_text(stand._dumps(me))

    def apply_state(self, st: dict[str, Any]) -> None:
        g = self.game
        state = st.get("state")
        qi = st.get("qi") if isinstance(st.get("qi"), int) else -1
        q = st.get("question") if isinstance(st.get("question"), dict) else {}
        movement = bool(q.get("stand")) and q.get("qi") == qi
        changed = False
        players = st.get("players")
        if isinstance(players, int) and players != g.players:
            g.players = players
        if isinstance(st.get("q_count"), int):
            g.q_count = st["q_count"]
        roster = {r["player_id"]: bool(r.get("frozen")) for r in st.get("roster") or []
                  if isinstance(r, dict) and isinstance(r.get("player_id"), str)}
        if roster and not (g.live and g.applied_qi == g.qi):
            g.sync_ice(roster)
        if state == "lobby":
            if g.phase != "lobby":
                g.set_phase("lobby")
                changed = True
        elif state in ("countdown", "open") and movement:
            # a stale poll (sent before the room's write, answered after it) never opens the shown round again
            if (g.qi != qi or g.round != "stand" or g.phase not in ("countdown", "open")) and g.applied_qi != qi and self.clock.ready:
                opens, closes = stand.iso_ms(q.get("opens_at")), stand.iso_ms(q.get("closes_at"))
                if opens is not None and closes is not None:
                    g.begin(qi, q, self.clock.to_room(opens), self.clock.to_room(closes), self.room_now())
                    changed = True
        elif state == "reveal" and movement:
            if g.applied_qi != qi and self.writing is None:
                # The room did not close this round (it came late, restarted, or its write gave up): read the stored
                # result (live_stand_close of a closed question writes nothing) and show it.
                if g.qi != qi or g.round != "stand":
                    g.begin(qi, q, self.room_now(), self.room_now(), self.room_now())
                g.decided = True
                self._spawn(self._write(qi, []))
        elif state in ("countdown", "open", "reveal"):
            if g.round != "tap" or g.qi != qi or g.phase != state:
                g.tap(qi, state)
                changed = True
        elif state in ("leaderboard", "podium"):
            if g.phase != state:
                g.set_phase(state)
                changed = True
        elif state == "ended":
            if g.phase != "ended":
                g.set_phase("ended")
                changed = True
                asyncio.get_running_loop().call_later(1.0, self.runner.close, 4410, "ended")
        if changed:
            self.broadcast()
