"""Several right answers in the live game (migration 20261102090000_live_kinds_teams.sql, docs/live/CONTRACT.md §3):
the mirror of the share and of a partial hit (the rehearsal compares every tick of six options with the SQL), the
battle's close with ticks (exact, partial, wrong, frozen), a movement round of several right answers in the mixed room
(a zone on any right option stays up and is right) and in «Встань на ответ» (a late joiner on any right zone keeps its
floor), and that a round of one right answer sends no ``keys`` (its messages are as before)."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import live_move_mixed as mixed  # noqa: E402
import live_move_stand as stand  # noqa: E402
from test_live_mixed import CENTRE, World, pid  # noqa: E402


@pytest.mark.parametrize("picks,keys,want", [
    ([0, 2], [0, 2], 1.0),
    ([2], [0, 2], 0.5),
    ([0, 1], [0, 2], 0.0),
    ([1, 3, 4], [0, 2], 0.0),
    ([1, 3, 0], [1, 3, 5], 1.0 / 3),
    ([0, 1, 2, 3, 4, 5], [1, 3, 5], 0.0),
    ([3, 1], [1, 3, 5], 2.0 / 3),
    ([1, 1], [1, 3], 0.5),
])
def test_the_share_of_ticks(picks, keys, want):
    assert mixed.share(picks, keys) == want


def test_a_partial_hit_is_the_damage_times_the_share_rounded():
    assert mixed.partial(1000, 20, 1, True, 0.5) == 49          # damage 98 → 49
    assert mixed.partial(0, 20, 3, True, 1.0 / 3) == 50          # damage 150 → 50
    assert mixed.partial(20000, 20, 1, True, 0.5) == 25          # damage 50 → 25
    assert mixed.partial(0, 10, 1, False, 2.0 / 3) == 67         # damage 100 → 66.67 → 67


def fresh(*names):
    return {n: {"dmg": 0, "streak": 0, "best": 0, "right": 0, "frozen": False, "thaws": 0} for n in names}


def test_the_close_with_ticks_exact_partial_wrong_and_frozen():
    ps = fresh("dima", "lena", "borya", "anya", "yura")
    ps["anya"]["frozen"] = True
    answers = [("dima", [0, 2], 1000), ("lena", [2], 2000), ("borya", [0, 1], 3000), ("anya", [0], 1500), ("yura", 2, 2500)]
    out = mixed.close_round(ps, answers, list(ps), key=0, keys=[0, 2], n_options=5, time_s=20, speed=True, hp=1000,
                            hp_max=1000, q_phase=0, phase=0)
    assert out.counts == [3, 1, 3, 0, 0]
    assert out.right == 2                                         # the exact set, and a tap on a right option
    d_dima = mixed.damage(1000, 20, 1, True)
    d_lena = mixed.partial(2000, 20, 1, True, 0.5)
    d_yura = mixed.damage(2500, 20, 1, True)
    assert [h[:2] for h in out.hits] == [("dima", d_dima), ("lena", d_lena), ("yura", d_yura)]
    assert ps["lena"]["streak"] == 0 and not ps["lena"]["frozen"] and ps["lena"]["right"] == 0
    assert ps["borya"]["frozen"] and out.frozen_now == ["borya"]
    assert ps["anya"]["frozen"] and ps["anya"]["dmg"] == 0 and "anya" not in out.thawed   # a frozen partial: no thaw
    assert out.hp == 1000 - d_dima - d_lena - d_yura


def test_a_movement_round_of_several_right_answers_any_right_zone_is_right():
    ps = fresh("dima", "lena", "borya")
    out = mixed.close_round(ps, [("dima", 1, 1000), ("lena", 3, 2000), ("borya", 0, 500)], list(ps), key=1, keys=[1, 3],
                            n_options=4, time_s=20, speed=True, hp=500, hp_max=500, q_phase=0, phase=0, stand_round=True)
    assert out.right == 2 and [h[0] for h in out.hits] == ["dima", "lena"] and out.frozen_now == ["borya"]


def test_one_right_answer_closes_as_before():
    a, b = fresh("dima", "lena"), fresh("dima", "lena")
    args = dict(n_options=4, time_s=20, speed=True, hp=500, hp_max=500, q_phase=0, phase=0)
    one = mixed.close_round(a, [("dima", 1, 1000), ("lena", 2, 900)], ["dima", "lena"], key=1, **args)
    same = mixed.close_round(b, [("dima", 1, 1000), ("lena", 2, 900)], ["dima", "lena"], key=1, keys=[1], **args)
    assert one == same and a == b


def test_keys_of_a_result():
    assert stand.keys_of({"key": 2}) == [2]
    assert stand.keys_of({"key": 1, "keys": [3, 1]}) == [1, 3]
    assert stand.keys_of({"key": 1, "keys": []}) == [1]
    assert stand.keys_of({"key": 1, "keys": ["a"]}) == [1]


def test_the_mixed_room_keeps_every_right_zone_up():
    w = World()
    w.start(); w.taps({0: 1, 1: 1, 2: 1, 3: 1}); w.next()
    w.start(); w.taps({0: 2, 1: 2, 2: 2, 3: 2}); w.next()
    w.start()                                                  # q2: the movement round
    w.ps[0].x, w.ps[0].y = CENTRE[1]                           # Б: right
    w.ps[1].x, w.ps[1].y = CENTRE[3]                           # Г: right too
    w.ps[2].x, w.ps[2].y = CENTRE[0]                           # А: wrong
    qi, answers = w.to_deadline()
    w.t[0] = w.db.questions[qi]["closes"] + 0.3
    res = w.db.stand_close_sync(qi, answers)
    res["keys"] = [1, 3]                                       # the database's word for a question of two right options
    assert w.game.apply(res, w.room.t_ms())
    st = w.game.state(False)
    fell = set(st["res"]["fell"])
    assert w.ps[0].id not in fell and w.ps[1].id not in fell and w.ps[2].id in fell
    assert st["res"]["keys"] == [1, 3] and st["res"]["key"] == res["key"]


def test_a_round_of_one_right_answer_sends_no_keys():
    w = World()
    w.start(); w.taps({0: 1}); w.next()
    w.start(); w.taps({0: 2}); w.next()
    w.start()
    w.ps[0].x, w.ps[0].y = CENTRE[1]
    w.to_deadline()
    w.close()
    assert "keys" not in w.game.state(True)["res"]


def test_stand_a_late_joiner_on_any_right_zone_keeps_its_floor():
    g = stand.StandGame(time_s=15, q_count=2)
    import live_move as lm
    room = lm.Room("g", stand.arena_map(), hooks=g)
    g.room = room
    a, _ = room.add_player(pid(1), "a", None)
    b, _ = room.add_player(pid(2), "b", None)
    g.begin(0, {"text": "?", "options": ["1", "2", "3", "4"]}, 100.0, 200.0, 0.0)
    a.x, a.y = CENTRE[3]
    b.x, b.y = CENTRE[0]
    g.at_decision = {a.id: room.map.zone_index(a.x, a.y), b.id: room.map.zone_index(b.x, b.y)}
    rows = [{"p": pid(1), "c": None, "ok": False, "pts": 0, "out": True, "ghost": False},
            {"p": pid(2), "c": None, "ok": False, "pts": 0, "out": True, "ghost": False}]
    assert g.apply({"qi": 0, "key": 1, "keys": [1, 3], "counts": [0, 0, 0, 0], "rows": rows}, 300.0)
    assert g.res["fell"] == [b.id] and g.res["keys"] == [1, 3]
