"""Mode B «Убеги от Дедлайна» inside the room (live_move_stand.StandGame's hunt, docs/live/MODE_RUN.md): every second
movement round «Дедлайн» leaves its stage and hunts the class while the question runs; a catch throws the character off
the zone it held and holds it a moment; the hunters go back before zero, and the round is decided as in mode A."""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import live_move as lm  # noqa: E402
import live_move_mixed as mixed  # noqa: E402
import live_move_stand as stand  # noqa: E402
from test_live_stand import CENTRE, World, pid  # noqa: E402


def to_chase(w: World) -> None:
    """Question 0 played and closed with everyone right (no ghosts), question 1 (a chase) announced."""
    for p in w.ps:
        w.put(p, 1)                                         # the key of question 0 is Б
    w.start()
    w.to_deadline()
    w.close()
    w.next()
    w.start()


def frozen(room: lm.Room, p: lm.Player) -> bool:
    return bool(room.flags(p) & lm.F_FROZEN)


def test_every_second_question_is_a_chase_and_the_state_says_so():
    w = World(4, chase=True)
    w.start()
    assert w.game.state(False)["chase"] is False
    w.at(w.opens + 1000)
    assert not w.room.npcs                                  # question 0: mode A, nobody hunts
    w.to_deadline()
    w.close()
    w.next()
    w.start()
    st = w.game.state(False)
    assert st["chase"] is True and st["caught"] == 0
    assert not w.room.npcs                                  # not in the countdown
    w.at(w.opens + 50)
    assert len(w.room.npcs) == 1                            # out at the open: one hunter for four players
    hunter = next(iter(w.room.npcs.values()))
    assert hunter.speed == stand.HUNT_SPEED and hunter.kind == "hunter"
    assert any(e.get("t") == "add" and e["e"][1] == lm.KIND_NPC for e in w.room.events)
    w.at(w.closes - stand.HUNT_STOP_MS + 100)
    assert not w.room.npcs                                  # called back before zero
    assert any(e.get("t") == "del" and e["id"] == hunter.id for e in w.room.events)
    w.to_deadline()
    assert not w.room.npcs
    w.close()
    w.next()
    w.start()
    assert w.game.state(False)["chase"] is False            # question 2: mode A again


def test_more_hunters_for_a_bigger_class():
    g = stand.StandGame()
    assert [g.hunters_for(n) for n in (1, 12, 13, 24, 25, 60)] == [1, 1, 2, 2, 3, 3]


def test_a_catch_throws_the_character_off_its_zone_and_holds_it():
    w = World(4, chase=True)
    to_chase(w)
    p0 = w.ps[0]
    w.put(p0, 0)                                            # holds А
    for p in w.ps[1:]:
        w.put(p, 3)
    w.at(w.opens + 50)
    hunter = next(iter(w.room.npcs.values()))
    hunter.x, hunter.y = p0.x + 30, p0.y                    # right beside it
    for p in w.ps[1:]:
        p.caught_until = 1 << 40                            # only p0 can be caught here
    before = (p0.x, p0.y)
    w.room.step()
    assert math.hypot(p0.x - before[0], p0.y - before[1]) > 100     # thrown away from the hunter
    assert p0.x < before[0]                                         # (the hunter stood to its right)
    assert w.room.map.zone_index(p0.x, p0.y) == 0                   # off А and off every zone
    assert frozen(w.room, p0) and w.room.flags(p0) & lm.F_CAUGHT
    assert w.game.catches == 1 and w.game.state(False)["caught"] == 1
    assert {"t": "ev", "k": "caught", "id": p0.id, "by": hunter.id} in w.room.events
    w.run(stand.CAUGHT_MS + 100)
    assert not frozen(w.room, p0)                           # it can run back
    assert w.room.tick < p0.caught_until                    # and is not caught again at once


def test_the_thrown_character_never_crosses_a_wall_or_the_stage():
    w = World(1, chase=True)
    to_chase(w)
    p0 = w.ps[0]
    w.at(w.opens + 50)
    hunter = next(iter(w.room.npcs.values()))
    p0.x, p0.y = 40.0, 400.0                                # against the left wall
    hunter.x, hunter.y = 80.0, 400.0
    w.room.step()
    assert p0.x >= lm.PLAYER_R and p0.y > 160 and w.room.map.zone_index(p0.x, p0.y) == 0
    sx, sy, sr = stand.STAGE
    p0.caught_until = 0
    p0.frozen_until = 0
    p0.x, p0.y = sx, sy + sr + lm.PLAYER_R + 2             # just below the stage, the hunter under it
    hunter.x, hunter.y = sx, sy + sr + lm.PLAYER_R + 30
    hunter.paused_until = 0
    w.room.step()
    assert math.hypot(p0.x - sx, p0.y - sy) >= sr + lm.PLAYER_R - 0.5   # pushed along the stage, not into it


def test_a_catch_against_a_wall_throws_towards_the_stage_and_off_the_zone():
    w = World(1, chase=True)
    to_chase(w)
    p0 = w.ps[0]
    w.at(w.opens + 50)
    hunter = next(iter(w.room.npcs.values()))
    p0.x, p0.y = 110.0, 300.0                               # in А, by the left wall
    hunter.x, hunter.y = 150.0, 300.0                       # pushing it into the wall
    w.room.step()
    assert w.room.map.zone_index(p0.x, p0.y) == 0
    assert p0.x > 110.0                                     # it went round, towards the stage


def test_ghosts_and_held_characters_are_not_hunted():
    w = World(2, chase=True)
    to_chase(w)
    w.at(w.opens + 50)
    p0, p1 = w.ps
    hunter = next(iter(w.room.npcs.values()))
    p0.mode_flags |= lm.F_GHOST
    assert not w.game.can_chase(w.room, hunter, p0)
    p1.frozen_until = w.room.tick + 10
    assert not w.game.can_chase(w.room, hunter, p1)
    p1.frozen_until = 0
    assert w.game.can_chase(w.room, hunter, p1)


def test_the_decision_is_mode_as_and_counts_where_they_stand_at_zero():
    w = World(3, chase=True)
    to_chase(w)
    p0, p1, p2 = w.ps
    w.at(w.opens + 1000)
    w.put(p0, 2)                                            # the key of question 1 is В
    w.put(p1, 0)
    w.at(w.closes - 500)
    qi, answers = w.to_deadline()
    assert qi == 1
    assert {a["p"]: a["c"] for a in answers} == {pid(0): 2, pid(1): 0}
    res = w.close()
    assert {r["p"]: r["ok"] for r in res["rows"]}[pid(0)] is True


def test_a_mixed_game_hunts_in_its_second_fourth_movement_round():
    g = mixed.MixedGame(every=3, q_count=12, rounds=[2, 5, 8, 11])
    assert [g.chase_round(qi) for qi in range(12)] == [qi in (5, 11) for qi in range(12)]


def test_centres_of_the_zones_used_here_are_inside_them():
    m = stand.arena_map()
    assert [m.zone_index(*CENTRE[i]) for i in range(4)] == [1, 2, 3, 4]
