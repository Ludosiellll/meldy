"""A number question played as ranges on the arena (20261102090200_live_ranges.sql, MODE_STAND.md, MODE_MIXED.md): the
room grades nothing new (a range is a zone, right by key / keys as any), it only passes on what the screens say — the
question is a range question (ranges, unit: «Встаньте на промежуток с ответом») and, at the reveal, the true value
(num: the accepted numbers, the tolerance, the unit) that the boards show inside the right range. Every other
question's messages are as before, key for key."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import live_move as lm  # noqa: E402
import live_move_stand as stand  # noqa: E402
from test_live_mixed import CENTRE, World, pid  # noqa: E402

RANGES = ["меньше 300", "300–400", "400–500", "больше 500"]


def test_a_range_round_says_so_and_its_unit():
    g = stand.StandGame(time_s=15, q_count=2)
    g.begin(0, {"text": "Скорость звука?", "options": RANGES, "kind": "number", "ranges": True, "unit": "м/с"}, 100.0, 200.0, 0.0)
    assert g.q == {"text": "Скорость звука?", "options": RANGES, "ranges": True, "unit": "м/с"}
    g.begin(1, {"text": "?", "options": RANGES, "kind": "number", "ranges": True, "unit": None}, 300.0, 400.0, 0.0)
    assert g.q == {"text": "?", "options": RANGES, "ranges": True}
    # a typed number never stands on a round; a kind without ranges says nothing more
    g.begin(1, {"text": "?", "options": ["1", "2"], "kind": "number"}, 300.0, 400.0, 0.0)
    assert g.q == {"text": "?", "options": ["1", "2"]}
    g.begin(1, {"text": "?", "options": ["1", "2"], "ranges": True}, 300.0, 400.0, 0.0)
    assert g.q == {"text": "?", "options": ["1", "2"]}


def test_the_true_value_of_a_result():
    assert stand.number_of({"key": 1}) == {}
    assert stand.number_of({"key": 1, "num": "343"}) == {}
    assert stand.number_of({"key": 1, "num": {"forms": ["343"], "tolerance": 10, "unit": "м/с"}}) == {
        "num": {"forms": ["343"], "tolerance": 10, "unit": "м/с"}}
    assert stand.number_of({"key": 1, "num": {"forms": ["1024", "1000"], "tolerance": None, "unit": None}}) == {
        "num": {"forms": ["1024", "1000"], "tolerance": None, "unit": None}}
    assert stand.number_of({"key": 1, "num": {"forms": ["1"], "tolerance": True, "unit": 5}}) == {
        "num": {"forms": ["1"], "tolerance": None, "unit": None}}


def test_stand_a_range_reveal_carries_the_true_value_and_one_answer_none():
    g = stand.StandGame(time_s=15, q_count=2)
    room = lm.Room("g", stand.arena_map(), hooks=g)
    g.room = room
    a, _ = room.add_player(pid(1), "a", None)
    g.begin(0, {"text": "?", "options": RANGES, "kind": "number", "ranges": True, "unit": "м/с"}, 100.0, 200.0, 0.0)
    a.x, a.y = CENTRE[1]
    g.at_decision = {a.id: room.map.zone_index(a.x, a.y)}
    rows = [{"p": pid(1), "c": 1, "ok": True, "pts": 500, "out": False, "ghost": False}]
    num = {"forms": ["343"], "tolerance": 10, "unit": "м/с"}
    assert g.apply({"qi": 0, "key": 1, "counts": [0, 1, 0, 0], "rows": rows, "num": num}, 300.0)
    assert g.res["num"] == num and g.res["key"] == 1 and "keys" not in g.res and g.res["fell"] == []
    g2 = stand.StandGame(time_s=15, q_count=2)
    room2 = lm.Room("g", stand.arena_map(), hooks=g2)
    g2.room = room2
    room2.add_player(pid(1), "a", None)
    g2.begin(0, {"text": "?", "options": ["1", "2", "3", "4"]}, 100.0, 200.0, 0.0)
    assert g2.apply({"qi": 0, "key": 1, "counts": [0, 1, 0, 0], "rows": rows}, 300.0)
    assert "num" not in g2.res


def test_the_mixed_room_reveals_a_range_round_with_its_value():
    w = World()
    w.start(); w.taps({0: 1, 1: 1, 2: 1, 3: 1}); w.next()
    w.start(); w.taps({0: 2, 1: 2, 2: 2, 3: 2}); w.next()
    w.start()                                                  # q2: the movement round
    w.ps[0].x, w.ps[0].y = CENTRE[1]
    w.ps[1].x, w.ps[1].y = CENTRE[0]
    qi, answers = w.to_deadline()
    w.t[0] = w.db.questions[qi]["closes"] + 0.3
    res = w.db.stand_close_sync(qi, answers)
    res["num"] = {"forms": ["343"], "tolerance": 10, "unit": "м/с"}   # the database's word for a range question
    assert w.game.apply(res, w.room.t_ms())
    st = w.game.state(False)
    assert st["res"]["num"] == {"forms": ["343"], "tolerance": 10, "unit": "м/с"}
    assert w.ps[1].id in set(st["res"]["fell"]) or res["key"] == 0
