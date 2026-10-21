"""The movement room's core (live_move.py): tick math, clamping, collision, commands, npcs, snapshots, the shared
cases with the browser's prediction (contracts/live/move_cases.json; regenerate with
``python backend/tests/test_live_move.py --write-cases`` after a deliberate change of the movement rules)."""
import json
import math
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import live_move as lm  # noqa: E402

CASES_PATH = Path(__file__).resolve().parents[2] / "contracts" / "live" / "move_cases.json"
PID = "00000000-0000-4000-8000-0000000000{:02d}"


def open_map(w=1600, h=900, **extra):
    return lm.parse_map({"w": w, "h": h, **extra})


# ─────────────── joystick and one step ───────────────


def test_axis_vector_is_clamped_to_length_one():
    vx, vy = lm.axis_vector(127, 127)
    assert math.hypot(vx, vy) == pytest.approx(1.0)
    assert vx == pytest.approx(vy)
    assert lm.axis_vector(-128, 0) == (-1.0, 0.0)          # -128 counts as -127
    assert lm.axis_vector(0, 0) == (0.0, 0.0)
    vx, vy = lm.axis_vector(64, 0)                          # a half push stays a half push
    assert vx == pytest.approx(64 / 127)


def test_one_command_moves_one_tick_at_max_speed():
    m = open_map()
    x, y = lm.apply_command(m, 800.0, 450.0, 127, 0)
    assert (x, y) == (800.0 + lm.PLAYER_SPEED / lm.TICK_HZ, 450.0)
    x, y = lm.apply_command(m, 800.0, 450.0, 127, 127)
    assert math.hypot(x - 800, y - 450) == pytest.approx(13.0)


def test_still_joystick_does_not_move_or_push():
    m = open_map(solids=[{"rect": [790, 440, 20, 20]}])
    assert lm.apply_command(m, 800.0, 450.0, 0, 0) == (800.0, 450.0)


def test_tick_time_is_exact_milliseconds():
    room = lm.Room("g")
    for _ in range(7):
        room.step()
    assert room.tick == 7
    assert room.t_ms() == 350


# ─────────────── collision ───────────────


def test_wall_stops_a_player_at_its_face():
    m = open_map(solids=[{"rect": [400, 0, 40, 900]}])
    x, y = 300.0, 450.0
    for _ in range(30):
        x, y = lm.apply_command(m, x, y, 127, 0)
    assert x == pytest.approx(400 - lm.PLAYER_R)
    assert y == 450.0


def test_a_diagonal_into_a_wall_slides_along_it():
    m = open_map(solids=[{"rect": [400, 0, 40, 900]}])
    x, y = 382.0, 450.0
    for _ in range(10):
        x, y = lm.apply_command(m, x, y, 127, 127)
    assert x == pytest.approx(400 - lm.PLAYER_R)
    assert y > 450 + 80


def test_circle_pillar_pushes_out_along_the_normal():
    m = open_map(solids=[{"circle": [800, 450, 50]}])
    x, y = lm.move_circle(m, 740.0, 450.0, 10.0, 0.0, lm.PLAYER_R)
    assert math.hypot(x - 800, y - 450) == pytest.approx(50 + lm.PLAYER_R)


def test_map_edges_clamp():
    m = open_map()
    x, y = 20.0, 20.0
    for _ in range(5):
        x, y = lm.apply_command(m, x, y, -127, -127)
    assert (x, y) == (lm.PLAYER_R, lm.PLAYER_R)


def test_a_centre_inside_a_rect_leaves_by_the_nearest_side():
    m = open_map(solids=[{"rect": [400, 400, 200, 100]}])
    assert lm.move_circle(m, 410.0, 450.0, 0.0, 0.0, 18.0) == (400 - 18.0, 450.0)
    assert lm.move_circle(m, 500.0, 495.0, 0.0, 0.0, 18.0) == (500.0, 500 + 18.0)


def test_a_thin_wall_cannot_be_tunnelled():
    m = open_map(solids=[{"rect": [500, 0, 2, 900]}])
    x, y = 450.0, 300.0
    for _ in range(200):
        x, y = lm.apply_command(m, x, y, 127, 3)
        assert x < 500


# ─────────────── map JSON ───────────────


def test_map_json_round_trips():
    m = lm.default_map()
    assert lm.parse_map(json.loads(json.dumps(m.to_json()))) == m


@pytest.mark.parametrize("bad, field", [
    ({"h": 900}, "w"),
    ({"w": 100, "h": 900}, "w"),
    ({"w": 7000, "h": 900}, "w"),
    ({"w": 1600, "h": float("nan")}, "h"),
    ({"w": 1600, "h": 900, "solids": [{"rect": [1, 2, 3]}]}, "solids[0]"),
    ({"w": 1600, "h": 900, "solids": [{"square": 1}]}, "solids[0]"),
    ({"w": 1600, "h": 900, "solids": [{"rect": [0, 0, 10, 10]}] * 65}, "solids"),
    ({"w": 1600, "h": 900, "zones": [{"id": "", "rect": [0, 0, 10, 10]}]}, "zones[0]"),
    ({"w": 1600, "h": 900, "spawns": [[1700, 10]]}, "spawns"),
    ("map", "map"),
])
def test_bad_maps_are_refused_naming_the_field(bad, field):
    with pytest.raises(lm.MapError) as exc:
        lm.parse_map(bad)
    assert str(exc.value).startswith(field)


def test_zone_index_and_zones():
    m = lm.default_map()
    assert m.zone_index(50, 50) == 1
    assert m.zone_index(1550, 850) == 4
    assert m.zone_index(800, 300) == 0


# ─────────────── wire ───────────────


def test_quantise_rounds_half_up_and_clamps():
    assert lm.quantise(12.34) == 123
    assert lm.quantise(12.35) == 124
    assert lm.quantise(-3) == 0
    assert lm.quantise(10_000) == 65535


def test_input_frame_round_trip_and_refusals():
    frame = lm.encode_input(7, [(127, -5, 1), (0, 0, 0)])
    assert len(frame) == 12
    assert lm.decode_input(frame) == (7, [(127, -5, 1), (0, 0, 0)])
    for bad in (b"", frame[:-1], frame + b"\0", lm.encode_input(0, [(1, 1, 0)]),
                bytes([lm.MSG_SNAPSHOT]) + frame[1:], lm.encode_input(1, [(0, 0, 0)] * 5)):
        with pytest.raises(lm.ProtocolError):
            lm.decode_input(bad)


def test_snapshot_frame_carries_tick_time_ack_and_quantised_entities():
    room = lm.Room("g")
    p, _ = room.add_player(PID.format(1), "Дима", {"body": "round"})
    p.x, p.y = 612.34, 356.78                  # outside every zone
    room.step()
    room.step()
    head, body = room.snapshot_parts()
    snap = lm.decode_snapshot(head + lm.pack_ack(42) + body)
    assert snap["tick"] == 2 and snap["t"] == 100 and snap["ack"] == 42
    assert snap["ents"] == [(p.id, 6123, 3568, lm.KIND_PLAYER)]
    assert len(head + lm.pack_ack(42) + body) == 16 + 8 * 1


def test_snapshot_flags_kind_away_frozen_zone():
    room = lm.Room("g")
    p, _ = room.add_player(PID.format(1), "a", None)
    p.x, p.y = 50.0, 50.0                      # zone A (index 0 → 1)
    room.set_connected(p, False)
    room.frozen_all = True
    n = room.add_npc()
    head, body = room.snapshot_parts()
    ents = {e[0]: e for e in lm.decode_snapshot(head + lm.pack_ack(0) + body)["ents"]}
    f = ents[p.id][3]
    assert f & 3 == lm.KIND_PLAYER and f & lm.F_AWAY and f & lm.F_FROZEN and f >> lm.ZONE_SHIFT == 1
    assert ents[n.id][3] & 3 == lm.KIND_NPC


def test_sixty_players_make_a_small_snapshot():
    room = lm.Room("g")
    for i in range(60):
        room.add_player(f"00000000-0000-4000-8000-{i:012d}", f"p{i}", None)
    room.add_npc()
    head, body = room.snapshot_parts()
    assert len(head) + 4 + len(body) == 16 + 8 * 61     # 504 bytes; 10 Hz ≈ 5 KB/s a phone


# ─────────────── rate limit ───────────────


def test_bucket_allows_a_burst_then_the_rate():
    b = lm.Bucket(rate=20, burst=5, now=0.0)
    assert all(b.take(0.0) for _ in range(5))
    assert not b.take(0.0)
    assert b.take(0.05)            # one token back after 50 ms
    assert not b.take(0.05)
    assert b.level(10.0) == 5      # never more than the burst


# ─────────────── room: players and commands ───────────────


def test_players_spawn_apart_and_a_reconnect_resumes_the_same_entity():
    room = lm.Room("g")
    a, resumed_a = room.add_player(PID.format(1), "a", None)
    b, _ = room.add_player(PID.format(2), "b", None)
    many = [room.add_player(PID.format(i), str(i), None)[0] for i in range(3, 20)]
    points = {(round(p.x), round(p.y)) for p in [a, b, *many]}
    assert len(points) == 19 and not resumed_a
    a.x = 999.0
    again, resumed = room.add_player(PID.format(1), "a2", None)
    assert again is a and resumed and again.x == 999.0 and again.name == "a2"


def test_room_refuses_the_61st_player():
    room = lm.Room("g", max_players=3)
    for i in range(3):
        room.add_player(PID.format(i), "x", None)
    with pytest.raises(OverflowError):
        room.add_player(PID.format(9), "x", None)
    room.add_player(PID.format(1), "back", None)    # a known player still comes back


def test_one_command_per_tick_and_ack():
    room = lm.Room("g")
    p, _ = room.add_player(PID.format(1), "a", None)
    x0 = p.x
    assert room.push_commands(p, 1, [(127, 0, 0), (127, 0, 0)]) == 2
    room.step()
    assert p.ack == 1 and p.x == pytest.approx(x0 + 13)
    room.step()
    assert p.ack == 2 and p.x == pytest.approx(x0 + 26)
    room.step()                                       # nothing queued: stays
    assert p.ack == 2 and p.x == pytest.approx(x0 + 26)


def test_old_and_repeated_seqs_are_skipped():
    room = lm.Room("g")
    p, _ = room.add_player(PID.format(1), "a", None)
    room.push_commands(p, 1, [(1, 0, 0), (1, 0, 0)])
    assert room.push_commands(p, 2, [(1, 0, 0), (1, 0, 0)]) == 1    # seq 2 seen, seq 3 new
    assert [c[0] for c in p.queue] == [1, 2, 3]


def test_a_long_queue_catches_up_two_a_tick_and_a_full_one_drops_the_oldest():
    room = lm.Room("g")
    p, _ = room.add_player(PID.format(1), "a", None)
    room.push_commands(p, 1, [(0, 0, 0)] * 4)
    room.push_commands(p, 5, [(0, 0, 0)] * 4)
    room.push_commands(p, 9, [(0, 0, 0)] * 2)       # 10 queued: 2 dropped (8 kept), ack = 2
    assert len(p.queue) == lm.CMD_QUEUE_MAX and p.ack == 2 and p.dropped == 2
    room.step()                                     # 8 > 4: two
    assert p.ack == 4 and len(p.queue) == 6
    room.step()                                     # 6 > 4: two
    assert p.ack == 6 and len(p.queue) == 4
    room.step()                                     # 4: one a tick from here
    assert p.ack == 7 and len(p.queue) == 3
    room.step()
    assert p.ack == 8


def test_a_standing_backlog_drains_one_command_a_second():
    """A phone whose queue never empties (three commands stand in it) loses that latency one command a second;
    a queue that empties now and then (jitter absorbed) is left alone."""
    room = lm.Room("g")
    p, _ = room.add_player(PID.format(1), "a", None)
    seq = 1
    room.push_commands(p, seq, [(1, 0, 0)] * 3)
    seq += 3
    left = []
    for _ in range(4 * lm.TICK_HZ):
        room.push_commands(p, seq, [(1, 0, 0)])
        seq += 1
        room.step()
        left.append(len(p.queue))
    assert left[0] == 3 and left[-1] == 0 and p.ack == seq - 1
    assert left[lm.TICK_HZ] == 2 and left[2 * lm.TICK_HZ] == 1 and left.index(0) == 3 * lm.TICK_HZ

    jittery = lm.Room("g")
    p, _ = jittery.add_player(PID.format(1), "a", None)
    seq = 1
    for k in range(3 * lm.TICK_HZ):            # two commands every other tick: the queue empties every second tick
        if k % 2 == 0:
            jittery.push_commands(p, seq, [(1, 0, 0)] * 2)
            seq += 2
        jittery.step()
        assert len(p.queue) == (1 if k % 2 == 0 else 0)


def test_server_path_equals_the_prediction_path():
    """What the phone predicts (apply_command per command) is what the room computes, command by command."""
    room = lm.Room("g")
    p, _ = room.add_player(PID.format(1), "a", None)
    cmds = [(127, 0, 0)] * 15 + [(90, 90, 0)] * 10 + [(-30, 127, 0)] * 25 + [(0, 0, 0)] * 3 + [(-127, -127, 0)] * 30
    x, y = p.x, p.y
    seq = 1
    for i in range(0, len(cmds), 3):
        batch = cmds[i:i + 3]
        room.push_commands(p, seq, batch)
        seq += len(batch)
        for _ in batch:
            room.step()
    for jx, jy, _ in cmds:
        x, y = lm.apply_command(room.map, x, y, jx, jy)
    assert (p.x, p.y) == (x, y)
    assert p.ack == len(cmds)


def test_a_new_connection_restarts_seqs_and_clears_the_queue():
    room = lm.Room("g")
    p, _ = room.add_player(PID.format(1), "a", None)
    room.push_commands(p, 50, [(1, 0, 0)])
    room.step()
    room.push_commands(p, 51, [(1, 0, 0)])
    room.add_player(PID.format(1), "a", None)
    assert p.ack == 0 and not p.queue
    assert room.push_commands(p, 1, [(1, 0, 0)]) == 1


def test_freeze_acks_but_does_not_move():
    room = lm.Room("g")
    p, _ = room.add_player(PID.format(1), "a", None)
    x0 = p.x
    room.frozen_all = True
    room.push_commands(p, 1, [(127, 0, 0)])
    room.step()
    assert p.ack == 1 and p.x == x0


def test_kick_removes_the_entity_and_tells_everyone():
    room = lm.Room("g")
    p, _ = room.add_player(PID.format(1), "a", None)
    room.events.clear()
    assert room.remove_player(PID.format(1)) is p
    assert room.events == [{"t": "del", "id": p.id}]
    assert not room.players and room.remove_player(PID.format(1)) is None


# ─────────────── npcs ───────────────


def test_monster_chases_the_nearest_connected_player_and_catches():
    room = lm.Room("g", open_map())
    near, _ = room.add_player(PID.format(1), "near", None)
    far, _ = room.add_player(PID.format(2), "far", None)
    away, _ = room.add_player(PID.format(3), "away", None)
    near.x, near.y = 400.0, 450.0
    far.x, far.y = 1500.0, 450.0
    away.x, away.y = 260.0, 450.0
    room.set_connected(away, False)
    n = room.add_npc()
    n.x, n.y = 200.0, 450.0
    room.events.clear()
    room.step()
    assert n.target == near.id and n.x == pytest.approx(200 + lm.NPC_SPEED / lm.TICK_HZ)
    for _ in range(40):
        room.step()
        if room.events:
            break
    assert room.events[0] == {"t": "ev", "k": "caught", "id": near.id, "by": n.id}
    assert room.flags(near) & lm.F_CAUGHT and room.frozen(near)
    for _ in range(lm.CATCH_TICKS + 1):
        room.step()
    assert not room.flags(near) & lm.F_CAUGHT


def test_hooks_let_a_mode_change_the_catch():
    caught = []

    class Tag(lm.RoomHooks):
        def on_catch(self, room, npc, p):
            caught.append(p.pid)
            p.x, p.y = room.spawn_point(0)

    room = lm.Room("g", open_map(), hooks=Tag())
    p, _ = room.add_player(PID.format(1), "a", None)
    n = room.add_npc()
    n.x, n.y = p.x + 10, p.y
    room.step()
    assert caught == [PID.format(1)]


def test_zones_lists_connected_players_per_zone():
    room = lm.Room("g")
    a, _ = room.add_player(PID.format(1), "a", None)
    b, _ = room.add_player(PID.format(2), "b", None)
    c, _ = room.add_player(PID.format(3), "c", None)
    a.x, a.y = 100.0, 100.0
    b.x, b.y = 1500.0, 800.0
    c.x, c.y = 120.0, 100.0
    room.set_connected(c, False)
    assert room.zones() == {"A": [a.id], "B": [], "C": [], "D": [b.id]}


def test_set_map_respawns_everyone_inside_it():
    room = lm.Room("g")
    p, _ = room.add_player(PID.format(1), "a", None)
    p.x = 1500.0
    room.events.clear()
    room.set_map(open_map(w=600, h=400, spawns=[[100, 100]]))
    assert room.events[0]["t"] == "map"
    assert (p.x, p.y) == (100.0, 100.0)


# ─────────────── shared cases with sim.ts ───────────────


def build_cases() -> dict:
    ref = lm.default_map()
    thin = open_map(w=800, h=400, solids=[{"rect": [400, 0, 2, 400]}, {"circle": [200, 300, 30]}])
    maps = {"ref": ref, "thin": thin}
    plans = [
        ("open right", "ref", [800, 330], [[127, 0]] * 8),
        ("open diagonal", "ref", [800, 330], [[127, 127]] * 8),
        ("half push", "ref", [800, 330], [[40, -90]] * 8),
        ("minus 128", "ref", [800, 330], [[-128, 0]] * 3),
        ("into a wall", "ref", [300, 450], [[127, 0]] * 10),
        ("slide along a wall", "ref", [345, 450], [[127, 64]] * 12),
        ("round the pillar", "ref", [700, 452], [[127, 0]] * 14),
        ("corner clamp", "ref", [30, 30], [[-127, -127]] * 5),
        ("stop and go", "ref", [800, 570], [[0, 0], [60, 0], [0, 0], [0, -127]] * 3),
        ("thin wall", "thin", [370, 200], [[127, 5]] * 20),
        ("circle from below", "thin", [205, 360], [[0, -127]] * 10),
        ("start inside a rect", "ref", [400, 300], [[3, 0]] * 2),
    ]
    cases = []
    for name, mid, start, cmds in plans:
        m = maps[mid]
        x, y = float(start[0]), float(start[1])
        path = []
        for jx, jy in cmds:
            x, y = lm.apply_command(m, x, y, jx, jy)
            path.append([x, y])
        cases.append({"name": name, "map": mid, "start": start, "cmds": cmds, "path": path,
                      "wire": [[lm.quantise(px), lm.quantise(py)] for px, py in path]})
    return {
        "about": "Movement cases shared by backend/live_move.py and frontend/src/lib/live/move/sim.ts: the same "
                 "commands must give the same doubles. Written by backend/tests/test_live_move.py --write-cases.",
        "tick_hz": lm.TICK_HZ, "speed": lm.PLAYER_SPEED, "r": lm.PLAYER_R, "q": lm.Q,
        "maps": {k: v.to_json() for k, v in maps.items()},
        "cases": cases,
    }


def test_shared_cases_match_the_server():
    saved = json.loads(CASES_PATH.read_text(encoding="utf-8"))
    assert saved == json.loads(json.dumps(build_cases()))


if __name__ == "__main__" and "--write-cases" in sys.argv:
    CASES_PATH.write_text(json.dumps(build_cases(), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {CASES_PATH}")
