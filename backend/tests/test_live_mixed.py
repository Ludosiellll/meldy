"""The battle with movement rounds inside the room (live_move_mixed.MixedGame) with the database in memory
(live_mixed_fake.FakeMixedDb, the SQL's rules), and the mirror of the battle's numbers: which question is a movement
round, the worked examples of docs/live/MODE_MIXED.md §5, the line-up, the stomp (who falls is where they stand),
nobody a ghost after the floor returns, the ice, a void round, no zone checks between movement rounds, the tick's cost."""
import json
import math
import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import live_move as lm  # noqa: E402
import live_move_mixed as mixed  # noqa: E402
import live_move_stand as stand  # noqa: E402
from live_mixed_fake import FakeMixedDb  # noqa: E402

GAME = "11111111-2222-4333-8444-555555555555"
HOST = "H" * 43
CENTRE = {0: (380.0, 340.0), 1: (1220.0, 340.0), 2: (380.0, 700.0), 3: (1220.0, 700.0)}   # А Б В Г
CORRIDOR = (800.0, 330.0)


def pid(i: int) -> str:
    return f"00000000-0000-4000-8000-{i:012d}"


# ─────────────── the rule and the numbers ───────────────


@pytest.mark.parametrize("every, q_count, rounds", [
    (3, 6, [2, 5]), (3, 7, [2, 5]), (5, 12, [4, 9]), (10, 30, [9, 19, 29]), (10, 6, [5]), (5, 4, [3]), (3, 1, [0]),
    (3, 3, [2]), (0, 6, []), (5, 5, [4]),
])
def test_which_question_is_a_movement_round(every, q_count, rounds):
    assert [qi for qi in range(q_count) if mixed.stand_round(every, q_count, qi)] == rounds
    assert not mixed.stand_round(every, q_count, -1) and not mixed.stand_round(every, q_count, q_count)


@pytest.mark.parametrize("args, dmg", [
    ((900, 20, 1, True), 98), ((0, 20, 5, True), 200), ((20000, 20, 1, True), 50), ((0, 20, 2, False), 125),
    ((2500, 20, 3, True), 141), ((2500, 20, 3, False), 150), ((8500, 10, 1, True), 57), ((500, 10, 1, True), 98),
])
def test_damage_is_the_battles(args, dmg):
    assert mixed.damage(*args) == dmg


def players(**kw):
    return {name: dict(dmg=v[0], streak=v[1], best=v[2], right=v[3], frozen=v[4], thaws=v[5]) for name, v in kw.items()}


def test_worked_example_a_a_movement_round_in_phase_0():
    """MODE_MIXED.md §5 A: T 20 s, hp 1013 of 1320, phase 0; Дима on Б since 2500 ms with streak 2, Лена on А, Боря
    frozen on Б since 4000 ms, Аня in no zone."""
    ps = players(dima=(207, 2, 2, 2, False, 0), lena=(0, 1, 1, 1, False, 1), borya=(100, 0, 1, 1, True, 0), anya=(0, 0, 0, 0, False, 0))
    out = mixed.close_round(ps, [("lena", 0, 1200), ("dima", 1, 2500), ("borya", 1, 4000)], ["dima", "lena", "borya", "anya"],
                            key=1, n_options=4, time_s=20, speed=True, hp=1013, hp_max=1320, q_phase=0, phase=0, stand_round=True)
    assert out.hits == [("dima", 141, 872)] and out.hp == 872 and out.phase == 1 and out.phase_changed == 1
    assert out.frozen_now == ["lena", "anya"] and out.thawed == ["borya"] and out.right == 2 and out.counts == [1, 2, 0, 0]
    assert ps["dima"] == dict(dmg=348, streak=3, best=3, right=3, frozen=False, thaws=0)
    assert ps["anya"]["frozen"] and ps["borya"] == dict(dmg=100, streak=1, best=1, right=2, frozen=False, thaws=1)
    # The same «no answer» on a button question in phase 0 would not freeze Аня.
    ps2 = players(anya=(0, 0, 0, 0, False, 0))
    assert not mixed.close_round(ps2, [], ["anya"], key=1, n_options=4, time_s=20, speed=True, hp=1013, hp_max=1320,
                                 q_phase=0, phase=0).frozen_now and not ps2["anya"]["frozen"]


def test_worked_example_b_the_heal_after_a_movement_round_in_phase_2():
    ps = players(dima=(723, 5, 5, 5, False, 0), lena=(0, 0, 1, 2, True, 2), borya=(225, 0, 2, 3, True, 1), anya=(0, 0, 1, 1, True, 1))
    out = mixed.close_round(ps, [("dima", 3, 0), ("lena", 3, 3000), ("borya", 2, 500)], ["dima", "lena", "borya", "anya"],
                            key=3, n_options=4, time_s=20, speed=True, hp=372, hp_max=1320, q_phase=2, phase=2, stand_round=True)
    assert out.hits == [("dima", 200, 172)] and out.healed == 66 and out.hp == 238 and out.phase == 2 and out.phase_changed is None
    assert out.frozen_now == [] and out.thawed == ["lena"] and ps["dima"]["dmg"] == 923


def test_a_void_round_changes_nobody():
    ps = players(dima=(225, 2, 2, 2, False, 0), lena=(0, 0, 0, 0, True, 0))
    out = mixed.close_round(ps, [], ["dima", "lena"], key=1, n_options=4, time_s=20, speed=True, hp=105, hp_max=330,
                            q_phase=2, phase=2, stand_round=True, void=True)
    assert (out.hp, out.healed, out.frozen_now, out.right) == (105, 0, [], 0)
    assert ps["dima"]["streak"] == 2 and not ps["dima"]["frozen"]


def test_the_line_up_is_out_of_every_zone_and_off_the_stage():
    m = stand.arena_map()
    assert len(mixed.LINE) >= lm.MAX_PLAYERS and len(set(mixed.LINE)) == len(mixed.LINE)
    for x, y in mixed.LINE:
        assert m.zone_index(x, y) == 0
        assert lm.move_circle(m, x, y, 0.0, 0.0, lm.PLAYER_R) == (x, y)       # free: no wall, no stage
        assert math.hypot(x - stand.STAGE[0], y - stand.STAGE[1]) >= stand.STAGE[2] + lm.PLAYER_R


# ─────────────── the room ───────────────


class World:
    """A mixed room of n players beside its database (every 3rd question a movement round); the clock by hand."""

    def __init__(self, n: int = 4, questions=((4, 1), (3, 2), (4, 1), (2, 0), (3, 0), (4, 3)), time_s: int = 20) -> None:
        self.t = [1000.0]
        self.time_s = time_s
        self.db = FakeMixedDb(GAME, HOST, list(questions), every=3, time_s=time_s, clock=lambda: self.t[0])
        st = self.db.host_state_sync()
        self.game = mixed.MixedGame(time_s=time_s, q_count=len(questions), every=3, rounds=st["mixed"]["rounds"])
        self.room = lm.Room(GAME, stand.arena_map(), hooks=self.game)
        self.game.room = self.room
        self.decided: list[tuple[int, list]] = []
        self.game.on_decide = lambda qi, answers: self.decided.append((qi, answers))
        self.ps: list[lm.Player] = []
        for i in range(n):
            self.db.join(pid(i), f"p{i}")
            p, _ = self.room.add_player(pid(i), f"p{i}", None)
            self.game.on_player(p)
            p.x, p.y = CORRIDOR
            self.ps.append(p)

    def start(self) -> None:
        """«Дальше» into the next countdown; the room learns it at once."""
        self.db.next()
        q = self.db.questions[self.db.qi]
        now = self.room.t_ms()
        self.opens = now + 3000
        self.closes = self.opens + self.time_s * 1000
        if q["stand"]:
            self.game.begin(self.db.qi, q, self.opens, self.closes, now)
        else:
            self.game.tap(self.db.qi, "countdown")

    def taps(self, choices: dict[int, int]) -> None:
        q = self.db.questions[self.db.qi]
        self.t[0] = q["opens"] + 0.5
        for i, c in choices.items():
            self.db.answer(pid(i), c)
        self.t[0] = q["closes"] + 2
        self.db.settle()
        self.game.tap(self.db.qi, "reveal")

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
        if self.db.state in ("leaderboard", "podium"):
            self.game.set_phase(self.db.state)

    def run_ms(self, ms: float) -> None:
        end = self.room.t_ms() + ms
        while self.room.t_ms() < end:
            self.room.step()


def flags(room: lm.Room, p: lm.Player) -> int:
    return room.flags(p)


def test_button_questions_track_nothing_and_send_no_arena():
    w = World()
    w.start()
    assert w.game.round == "tap" and not w.game.live
    w.run_ms(5000)
    assert w.game.track == {} and not w.decided
    st = w.game.state(False)
    assert st["round"] == "tap" and st["q"] is None and st["opens"] is None and st["res"] is None
    w.taps({0: 1, 1: 0})
    assert w.db.hp == 1320 - mixed.damage(500, 20, 1, True) and w.db.players[pid(1)]["frozen"]


def test_a_movement_round_lines_up_tracks_and_stomps_and_the_floor_brings_everyone_back():
    w = World()
    w.start(); w.taps({0: 1, 1: 0, 2: 1}); w.next()           # q0: p1 freezes
    w.start(); w.taps({0: 2, 1: 2, 2: 0}); w.next()           # q1: p1 thaws, p2 freezes
    w.start()                                                  # q2: a movement round (key Б)
    assert w.game.round == "stand" and w.game.live and w.game.phase == "countdown"
    spots = {(p.x, p.y) for p in w.ps}
    assert len(spots) == 4 and all(w.room.map.zone_index(x, y) == 0 for x, y in spots)
    w.game.sync_ice({pid(i): w.db.players[pid(i)]["frozen"] for i in range(4)})
    assert flags(w.room, w.ps[2]) & mixed.F_ICE and not flags(w.room, w.ps[0]) & mixed.F_ICE
    w.ps[0].x, w.ps[0].y = CENTRE[1]                           # right
    w.ps[1].x, w.ps[1].y = CENTRE[0]                           # wrong
    w.ps[2].x, w.ps[2].y = CENTRE[1]                           # frozen on the right zone: thaws
    w.room.set_connected(w.ps[3], True)                        # stays on the line: no zone
    qi, answers = w.to_deadline()
    assert qi == 2 and sorted(a["p"] for a in answers) == [pid(0), pid(1), pid(2)]
    res = w.close()
    st = w.game.state(True)
    r = st["res"]
    ids = [p.id for p in w.ps]
    assert st["round"] == "stand" and st["floor"] == "down" and r["key"] == 1
    assert sorted(r["fell"]) == sorted([ids[1], ids[3]]) and r["back"] == r["fell"]
    assert r["thawed"] == [ids[2]] and sorted(r["froze"]) == sorted([ids[1], ids[3]]) and r["stood"] == 2
    assert r["hp"] == w.db.hp and r["pts"] == [[ids[0], res["hits"][0]["dmg"]]] and r["hits"][0][2] == w.db.hp
    assert "pts" not in w.game.state(False)["res"] and "hits" not in w.game.state(False)["res"]
    assert flags(w.room, w.ps[1]) & lm.F_GHOST and flags(w.room, w.ps[1]) & mixed.F_ICE
    assert not flags(w.room, w.ps[2]) & mixed.F_ICE                         # thawed
    me = w.game.me_of(pid(3))
    assert me["frozen"] and me["last"]["froze"] and me["last"]["fell"] and me["last"]["choice"] is None and not me["ghost"]
    me = w.game.me_of(pid(0))
    assert me["last"]["ok"] and me["last"]["pts"] == res["hits"][0]["dmg"] and not me["last"]["fell"] and me["pts"] == w.db.players[pid(0)]["dmg"]
    w.run_ms(stand.FLOOR_MS + 100)
    assert w.game.floor == "up" and not any(flags(w.room, p) & lm.F_GHOST for p in w.ps)    # nobody stays a ghost
    assert flags(w.room, w.ps[1]) & mixed.F_ICE and flags(w.room, w.ps[3]) & mixed.F_ICE   # the battle's freeze stays
    w.next()
    assert w.game.phase == "leaderboard" and not w.game.live
    w.start()
    assert w.game.round == "tap" and w.game.res is None and not w.game.live


class StubRunner:
    """What the glue (MixedMode / StandMode) reads of its room runner, with nobody connected."""

    game_id = GAME
    _host_token = HOST
    hosts: list = []
    conns: dict = {}

    def __init__(self, room: lm.Room) -> None:
        self.room = room
        self.tick_at = time.perf_counter()


def test_a_poll_answered_after_the_rooms_write_does_not_open_the_round_again():
    """The poll went out while the round was open and came back after the room's write and reveal (seen on a loaded
    machine, 21.10): the reveal stays, nobody is lined up again and the room does not decide a second time."""
    w = World()
    w.start(); w.taps({0: 1, 1: 1, 2: 1, 3: 1}); w.next()
    w.start(); w.taps({0: 2, 1: 2, 2: 2, 3: 2}); w.next()
    w.start()
    mode = mixed.MixedMode(StubRunner(w.room), w.db.host_state_sync(), w.db)
    mode.game = mode.hooks = w.game
    mode.clock.sample(0.0, 0.0, 0.0)
    w.t[0] = w.db.questions[2]["opens"] + 1
    stale = w.db.host_state_sync()
    assert stale["state"] == "open" and stale["question"]["stand"]
    for p in w.ps:
        p.x, p.y = CENTRE[1]
    w.to_deadline()
    w.close()
    assert w.game.phase == "reveal" and w.game.res is not None and w.game.floor == "down"
    mode.apply_state(stale)
    assert w.game.phase == "reveal" and w.game.res is not None and w.game.floor == "down"
    assert all(w.room.map.zone_index(p.x, p.y) == 2 for p in w.ps)          # still on Б, not lined up
    n = len(w.decided)
    w.run_ms(3000)
    assert len(w.decided) == n


def test_a_room_that_learns_of_a_round_late_still_lines_everyone_up_and_a_closed_one_moves_nobody():
    w = World(3)
    for i, p in enumerate(w.ps):
        p.x, p.y = CENTRE[i]                                    # standing on zones since an earlier round
    now = w.room.t_ms()
    w.game.begin(2, {"text": "x", "options": ["a", "b", "c", "d"]}, now - 4000, now + 16000, now)   # found open
    assert w.game.phase == "open" and all(w.room.map.zone_index(p.x, p.y) == 0 for p in w.ps)
    for i, p in enumerate(w.ps):
        p.x, p.y = CENTRE[i]
    w.game.begin(5, {"text": "y", "options": ["a", "b"]}, now, now, now)                            # found closed
    assert [w.room.map.zone_index(p.x, p.y) for p in w.ps] == [1, 2, 3]


def test_the_fastest_is_the_first_hit_the_projector_lands_when_hits_tie_in_time():
    """Live check 47.23: hits tied at 0 ms; «Быстрее всех» named the first right player in the result's rows (the
    place order) while the HP animation lands the stored hits (time, then player id) — two different names."""
    w = World()
    w.start()                                                  # q0: p1 taps first (more damage, placed higher)
    q = w.db.questions[w.db.qi]
    w.t[0] = q["opens"] + 0.5
    w.db.answer(pid(1), 1)
    w.t[0] = q["opens"] + 9.0
    w.db.answer(pid(0), 1)
    w.t[0] = q["closes"] + 2
    w.db.settle()
    w.game.tap(w.db.qi, "reveal")
    w.next()
    w.start(); w.taps({0: 2, 1: 2}); w.next()                 # q1: both right again, streak 2 each
    w.start()                                                  # q2: a movement round (key Б)
    for i in (0, 1):
        w.ps[i].x, w.ps[i].y = CENTRE[1]                       # there before the open: both 0 ms
    w.ps[2].x, w.ps[2].y = CENTRE[0]
    w.to_deadline()
    res = w.close()
    ids = {p.pid: p.id for p in w.ps}
    tied = [r for r in res["rows"] if r["ok"] and r["dmg"] > 0]
    assert {r["p"] for r in tied} == {pid(0), pid(1)} and {r["ms"] for r in tied} == {0} and len({r["dmg"] for r in tied}) == 1
    assert res["rows"][0]["p"] == pid(1)                       # the rows put p1 first (more damage in total) …
    assert res["hits"][0]["player_id"] == pid(0)               # … the stored hits p0 (a tie in time: the player id)
    r = w.game.state(True)["res"]
    assert r["hits"][0][0] == ids[pid(0)]
    assert r["fastest"] == {"id": ids[pid(0)], "pts": r["hits"][0][1], "ms": 0}


def test_without_stored_hits_the_fastest_is_the_quickest_right_row():
    w = World()
    w.start(); w.taps({0: 1, 1: 1}); w.next()
    w.start(); w.taps({0: 2, 1: 2}); w.next()
    w.start()
    w.ps[0].x, w.ps[0].y = CENTRE[1]
    w.ps[1].x, w.ps[1].y = CENTRE[1]
    qi, answers = w.to_deadline()
    w.t[0] = w.db.questions[qi]["closes"] + 0.3
    res = w.db.stand_close_sync(qi, answers)
    res = dict(res, hits=[], rows=[dict(r, ms=900) if r["p"] == pid(0) else dict(r, ms=400) if r["p"] == pid(1) else r for r in res["rows"]])
    assert w.game.apply(res, w.room.t_ms())
    assert w.game.state(True)["res"]["fastest"]["id"] == w.ps[1].id


def test_a_void_round_drops_nobody():
    w = World(2)
    w.start(); w.taps({0: 1}); w.next()
    w.start(); w.taps({0: 2}); w.next()
    w.start()
    w.ps[0].x, w.ps[0].y = CENTRE[1]
    w.to_deadline()
    hp = w.db.hp
    w.t[0] = w.db.questions[2]["closes"] + 8.5                 # the room's write never came: closed by time
    w.db.settle()
    res = w.db.stand_close_sync(2, [{"p": pid(0), "c": 1, "e": 10}])
    assert res["void"] and res["again"] and w.db.hp == hp and res["right"] == 0
    assert w.game.apply(res, w.room.t_ms())
    st = w.game.state(False)
    assert st["floor"] == "up" and st["res"]["void"] and st["res"]["fell"] == [] and not any(p.frozen_until for p in w.ps)
    assert w.game.me_of(pid(0))["last"]["void"] and w.db.players[pid(0)]["streak"] == 2


def test_the_messages_carry_the_plan_and_never_the_key_early():
    w = World()
    hello = w.game.hello()
    assert hello["mixed"] == {"every": 3, "rounds": [2, 5]} and hello["time_s"] == 20
    for _ in range(2):
        w.start(); w.taps({}); w.next()
    w.start()
    st = w.game.state(True)
    assert st["phase"] == "countdown" and st["round"] == "stand" and st["q"]["text"] == "Вопрос 3"
    assert "key" not in str(st) and st["res"] is None


def test_a_tick_between_movement_rounds_is_nothing_and_in_one_stays_well_under_3_ms():
    """The room's own work per tick (CPU time of this thread): 40 players each applying a command, the mode, and the
    snapshot every 2nd tick only while the arena is on (RoomRunner.tick asks MixedMode.snapshots)."""
    w = World(40, questions=((4, 1), (4, 1), (4, 1)), time_s=30)

    def cost_of(ticks: int) -> list[float]:
        out = []
        for t in range(1, ticks + 1):
            for i, p in enumerate(w.ps):
                ang = (i * 0.7 + t * 0.02) % 6.283
                w.room.push_commands(p, p.last_rx + 1, [(round(127 * math.cos(ang)), round(127 * math.sin(ang)), 0)])
            c0 = time.thread_time()
            w.room.step()
            if w.room.tick % lm.SNAP_EVERY == 0 and w.game.live:
                head, body = w.room.snapshot_parts()
                frames = [b"".join((head, lm.pack_ack(p.ack), body)) for p in w.ps]
                frames.append(b"".join((head, lm.pack_ack(0), body)))
            out.append((time.thread_time() - c0) * 1000)
        return sorted(out)

    w.start()                                       # a button question: no zone checks, no snapshots
    calm = cost_of(300)
    assert w.game.track == {}
    w.taps({}); w.next(); w.start(); w.taps({}); w.next(); w.start()     # the movement round
    busy = cost_of(500)
    assert w.game.phase == "open" and len(w.game.track) == 40
    p99_calm, p99_busy = calm[int(len(calm) * 0.99)], busy[int(len(busy) * 0.99)]
    print(f"\nmixed tick with 40 players (CPU): between rounds p50 {calm[len(calm) // 2]:.3f} ms p99 {p99_calm:.3f} ms; "
          f"in a movement round p50 {busy[len(busy) // 2]:.3f} ms p99 {p99_busy:.3f} ms")
    assert p99_busy <= 3.0 and calm[len(calm) // 2] < busy[len(busy) // 2]


# ─────────────── the messages, shared with the browser (contracts/live/mixed_messages.json) ───────────────

CASES_PATH = Path(__file__).resolve().parents[2] / "contracts" / "live" / "mixed_messages.json"


def build_messages() -> dict:
    """The mixed room's messages of one scripted game (deterministic: the clock moves by hand), as the phones and the
    projector get them. Vitest parses the same file (frontend/src/lib/live/move/mixed.test.ts)."""
    w = World()
    w.start(); w.taps({0: 1, 1: 0, 2: 1}); w.next()
    w.start()
    tap = w.game.state(False)
    w.taps({0: 2, 1: 2, 2: 0}); w.next()
    w.start()
    countdown = w.game.state(False)
    w.ps[0].x, w.ps[0].y = CENTRE[1]
    w.ps[1].x, w.ps[1].y = CENTRE[0]
    w.ps[2].x, w.ps[2].y = CENTRE[1]
    w.to_deadline()
    w.close()
    return {
        "note": "The messages of a mixed room (docs/live/MODE_MIXED.md §4) in one scripted game: 4 players, 6 questions, "
                "every 3rd a movement round. Written by backend/tests/test_live_mixed.py --write-cases.",
        "hello": w.game.hello(), "tap": tap, "countdown": countdown, "reveal": w.game.state(False),
        "reveal_host": w.game.state(True), "me_right": w.game.me_of(pid(0)), "me_none": w.game.me_of(pid(3)),
    }


def test_the_shared_messages_match_the_room():
    saved = json.loads(CASES_PATH.read_text(encoding="utf-8"))
    assert saved == json.loads(json.dumps(build_messages()))


if __name__ == "__main__" and "--write-cases" in sys.argv:
    CASES_PATH.write_text(json.dumps(build_messages(), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {CASES_PATH}")
