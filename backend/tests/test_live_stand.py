"""Mode A «Встань на ответ» inside the room (live_move_stand.StandGame), with the database in memory
(live_stand_fake.FakeLiveDb, the SQL's rules): the zone at the deadline, elapsed, a zone's border, a disconnected
phone, ghosts, revives, half points, the streak, a late joiner, the floor, the messages and the key's secrecy."""
import json
import math
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import live_move as lm  # noqa: E402
import live_move_stand as stand  # noqa: E402
from live_stand_fake import FakeLiveDb  # noqa: E402

GAME = "11111111-2222-4333-8444-555555555555"
HOST = "H" * 43
CENTRE = {0: (380.0, 340.0), 1: (1220.0, 340.0), 2: (380.0, 700.0), 3: (1220.0, 700.0)}   # А Б В Г
CORRIDOR = (800.0, 330.0)


def pid(i: int) -> str:
    return f"00000000-0000-4000-8000-{i:012d}"


class World:
    """A stand room of n players beside its database; the database's clock is moved by hand."""

    def __init__(self, n: int = 4, questions=((4, 1), (3, 2), (2, 0)), time_s: int = 15) -> None:
        self.t = [1000.0]
        self.time_s = time_s
        self.db = FakeLiveDb(GAME, HOST, list(questions), time_s=time_s, clock=lambda: self.t[0])
        self.game = stand.StandGame(time_s=time_s, q_count=len(questions))
        self.room = lm.Room(GAME, stand.arena_map(), hooks=self.game)
        self.game.room = self.room
        self.decided: list[tuple[int, list]] = []
        self.changes = 0
        self.game.on_decide = lambda qi, answers: self.decided.append((qi, answers))
        self.game.on_change = self._changed
        self.ps: list[lm.Player] = []
        for i in range(n):
            self.add(i)

    def _changed(self) -> None:
        self.changes += 1

    def add(self, i: int) -> lm.Player:
        self.db.join(pid(i), f"p{i}")
        p, _ = self.room.add_player(pid(i), f"p{i}", None)
        self.game.on_player(p)
        p.x, p.y = CORRIDOR
        self.ps.append(p)
        return p

    def start(self) -> None:
        """The host's «Дальше» into the next countdown; the room learns it at once."""
        self.db.next()
        q = self.db.questions[self.db.qi]
        now = self.room.t_ms()
        self.opens = now + 3000
        self.closes = self.opens + self.time_s * 1000
        self.game.begin(self.db.qi, q, self.opens, self.closes, now)

    def at(self, ms: float) -> None:
        while self.room.t_ms() < ms:
            self.room.step()

    def run(self, ms: float) -> None:
        self.at(self.room.t_ms() + ms)

    def to_deadline(self) -> tuple[int, list]:
        n = len(self.decided)
        for _ in range(2000):
            if len(self.decided) > n:
                return self.decided[-1]
            self.room.step()
        raise AssertionError("no decision")

    def close(self) -> dict:
        qi, answers = self.decided[-1]
        self.t[0] = self.db.questions[qi]["closes"] + 0.3
        res = self.db.stand_close_sync(qi, answers)
        assert self.game.apply(res, self.room.t_ms())
        return res

    def next(self) -> None:
        self.db.next()

    def put(self, p: lm.Player, zone: int | None = None, xy: tuple[float, float] | None = None) -> None:
        p.x, p.y = CENTRE[zone] if zone is not None else (xy or CORRIDOR)


def ghost(room: lm.Room, p: lm.Player) -> bool:
    return bool(room.flags(p) & lm.F_GHOST)


def frozen(room: lm.Room, p: lm.Player) -> bool:
    return bool(room.flags(p) & lm.F_FROZEN)


# ─────────────── the arena and the numbers ───────────────


def test_the_arena_zones_are_the_options_in_order():
    m = stand.arena_map()
    assert [z.id for z in m.zones] == ["А", "Б", "В", "Г"]
    for i, (x, y) in CENTRE.items():
        assert m.zone_index(x, y) == i + 1
    assert m.zone_index(*CORRIDOR) == 0
    # the stage is solid: a character is pushed off it
    x, y = lm.move_circle(m, 800, 520, 0, 0, lm.PLAYER_R)
    assert (x - 800) ** 2 + (y - 520) ** 2 >= (80 + lm.PLAYER_R) ** 2 - 1e-6
    for sx, sy in m.spawns:
        assert m.zone_index(sx, sy) == 0


@pytest.mark.parametrize("args, pts", [
    ((3000, 15, 1, True, False), 900), ((6000, 15, 3, True, False), 960), ((4321, 15, 2, True, False), 940),
    ((0, 15, 5, True, False), 1400), ((0, 15, 12, True, False), 1400), ((15000, 15, 1, True, False), 500),
    ((7500, 15, 3, True, True), 380), ((3000, 15, 1, True, True), 450), ((15000, 15, 1, True, True), 250),
    ((14000, 15, 1, False, False), 1000), ((99999, 20, 1, True, False), 500), ((-40, 20, 1, True, False), 1000),
])
def test_points_are_the_contracts_worked_numbers(args, pts):
    assert stand.stand_points(*args) == pts


def test_the_shared_arena_and_points_of_contracts_live():
    """contracts/live/stand_arena.json: the same arena and points as protocol.ts (stand.test.ts) and the SQL."""
    shared = json.loads((Path(__file__).resolve().parents[2] / "contracts" / "live" / "stand_arena.json").read_text(encoding="utf-8"))
    assert shared["map"] == stand.ARENA and shared["stage"] == stand.STAGE
    assert shared["floor"] == stand.FLOOR and shared["letters"] == stand.LETTERS
    for c in shared["points"]:
        assert stand.stand_points(c["elapsed_ms"], c["time_s"], c["streak_after"], c["speed"], c["ghost"]) == c["pts"], c


def test_database_times_map_onto_the_room_clock():
    c = stand.OffsetClock()
    assert not c.ready
    c.sample(1_000_500.0, 400.0, 600.0)          # 200 ms round trip
    c.sample(1_000_600.0, 580.0, 600.0)          # 20 ms: trusted
    assert c.to_room(1_001_000.0) == pytest.approx(1_001_000.0 - (1_000_600.0 - 590.0))
    assert stand.iso_ms("1970-01-01T00:00:01.250Z") == 1250.0
    assert stand.iso_ms("nope") is None and stand.iso_ms(None) is None


# ─────────────── the answer: the zone at the deadline ───────────────


def test_the_answer_is_the_zone_at_the_deadline_with_the_time_of_entering_it():
    w = World(5)
    p0, p1, p2, p3, p4 = w.ps
    w.put(p0, 0)                                   # in А before the question: 0 ms
    w.start()
    assert w.game.phase == "countdown"
    w.at(w.opens)
    assert w.game.phase == "open" and w.changes == 1
    w.at(w.opens + 2000)
    w.put(p1, 1)                                   # into Б 2 s after opening
    w.room.step()
    entered = w.room.t_ms()
    w.put(p2, 2)
    w.at(w.closes - 500)
    w.put(p2)                                      # leaves В before the end: no answer
    w.put(p4, 3)                                   # Г, then back out and in again later
    w.run(100)
    w.put(p4)
    w.run(100)
    w.put(p4, 3)
    w.room.step()
    p4_entered = w.room.t_ms()
    w.at(w.closes + 100)
    w.put(p3, 3)                                   # within the 250 ms after zero (a late command): it counts
    qi, answers = w.to_deadline()
    decided_at = w.room.t_ms()
    assert qi == 0 and w.closes + stand.DECIDE_LAG_MS <= decided_at < w.closes + stand.DECIDE_LAG_MS + 50
    by = {a["p"]: (a["c"], a["e"]) for a in answers}
    assert by == {pid(0): (0, 0), pid(1): (1, entered - w.opens), pid(3): (3, 15000), pid(4): (3, p4_entered - w.opens)}
    assert all(frozen(w.room, p) for p in w.ps)    # everyone stands still until the result
    w.put(p2, 1)
    w.run(1000)
    assert len(w.decided) == 1                     # one decision per question


def test_a_border_counts_as_inside_and_only_live_zones_answer():
    w = World(4, questions=((2, 0),))
    p0, p1, p2, p3 = w.ps
    w.start()
    w.put(p0, xy=(80.0, 340.0))                    # exactly on А's left edge
    w.put(p1, xy=(79.9, 340.0))                    # a tenth outside
    w.put(p2, xy=(680.0, 460.0))                   # А's far corner
    w.put(p3, 2)                                   # В: closed for a two-option question
    _, answers = w.to_deadline()
    assert sorted(a["p"] for a in answers) == [pid(0), pid(2)]
    assert {a["c"] for a in answers} == {0}


def test_a_disconnected_phone_gives_no_answer_and_falls():
    w = World(3)
    p0, p1, p2 = w.ps
    w.start()
    for p in w.ps:
        w.put(p, 1)                                # all on the right zone Б
    w.room.set_connected(p2, False)
    _, answers = w.to_deadline()
    assert pid(2) not in {a["p"] for a in answers}
    w.close()
    assert w.game.res["fell"] == [p2.id] and ghost(w.room, p2)
    assert w.game.res["stood"] == 2 and w.game.res["of"] == 3


# ─────────────── ghosts, revives, half points, the streak ───────────────


def test_ghosts_fall_float_and_come_back_on_the_right_zone_with_half_points():
    w = World(4)
    p0, p1, p2, p3 = w.ps
    w.start()                                      # question 0: four options, key 1 (Б)
    w.put(p0, 1)
    w.put(p1, 0)
    w.at(w.opens + 3000)
    w.put(p2, 1)
    w.room.step()
    p2_ms = w.room.t_ms() - w.opens
    w.to_deadline()
    res = w.close()
    rows = {r["p"]: r for r in res["rows"]}
    assert rows[pid(0)]["pts"] == 1000 and rows[pid(2)]["pts"] == stand.stand_points(p2_ms, 15, 1, True, False)
    g = w.game
    assert g.phase == "reveal" and g.floor == "down"
    assert g.res["key"] == 1 and sorted(g.res["fell"]) == sorted([p1.id, p3.id]) and g.res["back"] == []
    assert g.res["stood"] == 2 and g.res["fastest"] == {"id": p0.id, "pts": 1000, "ms": 0}
    assert ghost(w.room, p1) and ghost(w.room, p3) and not ghost(w.room, p0)
    assert frozen(w.room, p1) and frozen(w.room, p0)            # the fall; the island
    w.run(stand.FALL_MS + 50)
    assert not frozen(w.room, p1) and frozen(w.room, p0)        # ghosts float at once, survivors wait for the floor
    me0 = g.me_of(pid(0))
    assert me0["pts"] == 1000 and me0["streak"] == 1 and me0["place"] == 1 and me0["last"]["ok"] and not me0["ghost"]
    assert g.me_of(pid(1))["ghost"] and g.me_of(pid(1))["last"]["fell"] and g.me_of(pid(3))["last"]["choice"] is None
    w.run(stand.FLOOR_MS)
    assert g.floor == "up" and not frozen(w.room, p0) and ghost(w.room, p1)
    # question 1: three options, key 2 (В). P0 again (streak 2: × 1.1), ghost P1 on В (half, revived), ghost P3 on А
    # (stays a ghost, does not fall again), P2 on Г (closed): falls.
    w.next()
    w.next()
    w.start()
    w.put(p0, 2)
    w.put(p3, 0)
    w.put(p2, 3)
    w.at(w.opens + 7500)
    w.put(p1, 2)
    w.room.step()
    p1_ms = w.room.t_ms() - w.opens
    w.to_deadline()
    res = w.close()
    rows = {r["p"]: r for r in res["rows"]}
    assert rows[pid(0)]["pts"] == 1100 and rows[pid(0)]["streak"] == 2 and rows[pid(0)]["total"] == 2100
    assert rows[pid(1)]["pts"] == stand.stand_points(p1_ms, 15, 1, True, True) and rows[pid(1)]["revived"]
    assert rows[pid(1)]["pts"] in (370, 380) and rows[pid(1)]["streak"] == 0
    assert g.res["fell"] == [p2.id] and g.res["back"] == [p1.id]
    assert ghost(w.room, p1) and frozen(w.room, p1)             # a ghost on the island until the floor returns
    assert ghost(w.room, p3) and not frozen(w.room, p3)         # still a ghost, floating
    assert g.me_of(pid(1))["last"]["revived"] and not g.me_of(pid(1))["ghost"]
    w.run(stand.FLOOR_MS + 50)
    assert not ghost(w.room, p1) and ghost(w.room, p3) and ghost(w.room, p2)


def test_a_late_joiner_does_not_count_falls_and_comes_back():
    w = World(2)
    p0, p1 = w.ps
    w.start()
    w.t[0] = w.db.questions[0]["opens"] + 1        # joins after the question opened
    late = w.add(2)
    w.put(p0, 1)
    w.put(p1, 1)
    w.put(late, 0)
    _, answers = w.to_deadline()
    assert pid(2) in {a["p"] for a in answers}     # the room sends it; the database leaves it out
    res = w.close()
    row = {r["p"]: r for r in res["rows"]}[pid(2)]
    assert row["out"] and row["c"] is None and not row["ghost"] and row["pts"] == 0
    assert w.game.res["fell"] == [late.id] and w.game.res["back"] == [late.id] and ghost(w.room, late)
    assert w.game.me_of(pid(2))["last"]["late"] and w.game.res["of"] == 2
    w.run(stand.FLOOR_MS + 50)
    assert not ghost(w.room, late)


def test_a_late_joiner_on_the_right_zone_just_stays():
    w = World(1)
    w.start()
    w.t[0] = w.db.questions[0]["opens"] + 1
    late = w.add(1)
    w.put(w.ps[0], 1)
    w.put(late, 1)
    w.to_deadline()
    w.close()
    assert w.game.res["fell"] == [] and not ghost(w.room, late)


# ─────────────── the messages ───────────────


def test_messages_never_carry_the_key_before_the_close_and_phones_get_no_points_of_others():
    w = World(3)
    p0, p1, p2 = w.ps
    hello = w.game.hello()
    assert hello["letters"] == ["А", "Б", "В", "Г"] and hello["stage"] == [800, 520, 80] and hello["floor_ms"] == stand.FLOOR_MS
    w.start()
    st = w.game.state(True)
    assert st["phase"] == "countdown" and st["q"]["options"] == ["Ответ 1", "Ответ 2", "Ответ 3", "Ответ 4"]
    assert st["res"] is None and "key" not in json.dumps(st) and st["closes"] - st["opens"] == 15000
    w.put(p0, 1)
    w.put(p1, 2)
    w.to_deadline()
    assert "key" not in json.dumps(w.game.state(True))
    w.close()
    host, phone = w.game.state(True), w.game.state(False)
    assert host["res"]["pts"] == [[p0.id, 1000]] and "pts" not in phone["res"]
    assert phone["res"]["key"] == 1 and phone["res"]["counts"] == [0, 1, 1, 0] and phone["floor"] == "down"
    assert len(json.dumps(host, ensure_ascii=False).encode()) < 2048
    me = w.game.me_of(pid(0))
    assert me["t"] == "stand" and me["k"] == "me" and set(me) == {"t", "k", "ghost", "pts", "streak", "best", "right", "place", "of", "last"}
    assert w.game.me_of(pid(9)) is None


def test_a_tick_with_40_players_running_in_a_question_stays_well_under_3_ms():
    """The room's own work per tick (CPU time of this thread, so a busy machine's preemption does not count): 40
    players each applying a command, the mode tracking zones, and every 2nd tick the snapshot framed for 41 sockets,
    as RoomRunner.tick does. Budget: p99 ≤ 3 ms (MODE_STAND.md §10)."""
    import time

    w = World(40, questions=((4, 1),), time_s=30)
    w.start()
    cost = []
    for t in range(1, 501):                       # countdown and 22 s of the open question
        for i, p in enumerate(w.ps):
            ang = (i * 0.7 + t * 0.02) % 6.283
            w.room.push_commands(p, t, [(round(127 * math.cos(ang)), round(127 * math.sin(ang)), 0)])
        c0 = time.thread_time()
        w.room.step()
        if w.room.tick % lm.SNAP_EVERY == 0:
            head, body = w.room.snapshot_parts()
            frames = [b"".join((head, lm.pack_ack(p.ack), body)) for p in w.ps]
            frames.append(b"".join((head, lm.pack_ack(0), body)))
        cost.append((time.thread_time() - c0) * 1000)
    assert w.game.phase == "open" and not w.decided and len(w.game.track) == 40
    cost.sort()
    p50, p99 = cost[len(cost) // 2], cost[int(len(cost) * 0.99)]
    print(f"\nstand tick with 40 players (CPU): p50 {p50:.3f} ms, p99 {p99:.3f} ms, max {cost[-1]:.3f} ms")
    assert p99 <= 3.0


def test_leaderboard_and_podium_clear_the_floor_and_the_holds():
    w = World(2)
    w.start()
    w.put(w.ps[0], 1)
    w.to_deadline()
    w.close()
    assert w.game.floor == "down"
    w.game.set_phase("leaderboard", top=[{"id": w.ps[0].id, "name": "p0", "look": None, "pts": 1000, "move": 0}])
    st = w.game.state(False)
    assert st["phase"] == "leaderboard" and st["floor"] == "up" and st["q"] is None and st["top"][0]["pts"] == 1000
    assert not any(frozen(w.room, p) for p in w.ps) and ghost(w.room, w.ps[1])
    w.game.set_phase("podium", top=[], acc=50)
    assert w.game.state(False)["acc"] == 50
