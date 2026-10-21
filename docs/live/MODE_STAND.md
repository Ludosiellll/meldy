# Mode A «Встань на ответ» — contract

A question is on the projector's board and on every phone. Four answer zones А, Б, В, Г lie on the floor. Players run
their characters onto the zone they think is right. At zero the boss «Дедлайн» stomps and every tile except the right
zone drops: whoever is not on it falls and becomes a ghost. Ghosts keep running and answering; a ghost on the right zone
gets half the points and comes back to life when the floor returns.

This file is the contract between the room server (`backend/live_move_stand.py`, `live_move_modes.py`), the database
(`supabase/migrations/20261022090000_live_stand.sql`), the projector and the phone. It builds on `CONTRACT.md` (the live
game: states, tokens, RPCs, errors) and `MOVE.md` (the socket, snapshots, prediction). TypeScript:
`frontend/src/lib/live/move/protocol.ts` (`Stand*` types, `parseStand`, `STAND_ARENA`, `STAND_LETTERS`, `standPoints`,
`zoneOption`, `isGhost`), `sim.ts` `zoneIndexAt`, and `MoveClient` (`stand.hello/state/me`, `onStand`, `serverNow()`,
`holding()`). The arena and the worked points are shared in `contracts/live/stand_arena.json` (checked by pytest and
Vitest; the SQL is rehearsed against the Python mirror for every millisecond). Where this file and the code disagree,
fix one of them in the same commit.

## 1. Settings

`live_create(p_source, p_settings)` takes two more keys (CONTRACT §8):

| key | values | default | refusal |
|---|---|---|---|
| `mode` | `"boss"` («Битва с монстром», the existing value) · `"stand"` (this mode) | `"boss"` | `22023 mode` |
| `boss` | `"clock"` (our alarm-clock brute) · `"skeleton"` (the KayKit skeleton with an alarm clock) | `"clock"` | `22023 boss` |
| `time_s` | battle: 10 · 20 · 30 (default 20); **stand: 15 · 20 · 30 (default 15)** | | `22023 time_s` |

- The brief called the battle value `battle`; it is `boss` on the wire, in the live database and in ten client call
  sites already, so it stays `boss`. There is no `battle` value.
- `speed` works as in battle (off: everyone gets the early bonus in full). `who`, `chat_names` unchanged.
- In a stand game HostState `settings` has `"boss"` and PlayerState / HostState `boss` has `"kind": "clock" |
  "skeleton"` (a battle game's JSON is unchanged).
- In a stand game `live_answer` is refused with `ML004 stand`: answers come only from the room (§6).
- No boss HP in a stand game: `boss.hp = hp_max = 0`, `phase` stays 0, no freezes or heals. Podium after the last
  question; `final.won` is always `false` (nobody beats the boss; places matter).

## 2. Phases: the live state machine, unchanged

The database stays the judge of the game's state (`CONTRACT.md` §1). The host screen drives it with `live_next` as in
battle. The room follows the database; it never moves the state itself, except by closing the open question (§6).

| DB state | room `phase` | what happens |
|---|---|---|
| `lobby` | `lobby` | players join (`live_join`), connect the socket, run around freely |
| `countdown` (3 s) | `countdown` | the question, its options and the live zones are shown; running allowed |
| `open` (`time_s`) | `open` | run to an answer; the last 3 s the alarm shakes (client side) |
| → closed by the room | `reveal` | the stomp, the floor drops, results; the floor returns after 4 s |
| `leaderboard` | `leaderboard` | top five |
| `podium` | `podium` | top five (the first three on the podium), class accuracy, own place |
| `ended` | `ended` | the room closes the sockets with 4410 one second later |

**How the room learns the state (the simplest robust way).** The room polls `live_host_state(p_game, p_host_token,
p_since_rev)` once a second with the host token it already holds (outside `lobby` and `open` the answer is the tiny
`unchanged`). The host screen sends `{"t":"cmd","op":"sync"}` on the socket right after every `live_next`, `live_kick`
and `live_end`; the room then polls at once. So a phase reaches the phones ~0.2–0.5 s after the click, and within ~1 s
when the poke is lost. Countdown → open needs no poll: the room switches at `opens` by its own clock. Polls and the
answer write are asyncio tasks off the tick; a slow or failed call never delays a tick. A room restart (release, Space
sleep) loses only the question in flight.

## 3. The arena

The map comes in the `welcome` (`MOVE.md` §4, unchanged format). Units: 1600 × 900, the projector's 16:9.

```jsonc
{"w": 1600, "h": 900,
 "solids": [{"rect": [0, 0, 1600, 160]},        // the back wall under the question board
            {"rect": [0, 160, 20, 740]}, {"rect": [1580, 160, 20, 740]}, {"rect": [0, 880, 1600, 20]},
            {"circle": [800, 520, 80]}],         // the stage, where «Дедлайн» stands (solid)
 "zones": [{"id": "А", "rect": [80, 220, 600, 240]},  {"id": "Б", "rect": [920, 220, 600, 240]},
           {"id": "В", "rect": [80, 580, 600, 240]},  {"id": "Г", "rect": [920, 580, 600, 240]}],
 "spawns": [[560, 520], [1040, 520], [800, 360], [800, 680]],
 "npc_spawns": [[800, 520]]}
```

- **Zone index = option index.** Zone 0 (А) is option 0, zone 1 (Б) option 1, … in the shown order (CONTRACT §4).
  The ids are Cyrillic letters for display only: match zones by index, never by id (Latin «A» looks the same).
  A question with n options has the first n zones live; the others are closed (standing there is no answer).
- The floor that drops: tiles of 60 from (20, 160), 26 columns × 12 rows. Zone tiles: А columns 1–10 rows 1–4,
  Б 15–24 / 1–4, В 1–10 / 7–10, Г 15–24 / 7–10. At the stomp every tile outside the right zone drops (corridors too).
- The boss is not an entity (no snapshot entry): it stands on the stage and acts from the phase and the clock.
- Snapshot flags gain `F_GHOST = 1 << 5` (bits 5–7 belong to the mode; bits 6–7 are free for mode B).

## 4. Messages

Positions stay in the binary snapshots only. Mode messages are JSON text, `"t": "stand"`, sent on changes only: about
seven per question per socket, each under 2 KB. Times are **room ms**: the snapshot clock `t` (`MOVE.md` §4), which
`MoveClient.serverNow()` gives on the device. Entity ids are the snapshot ids.

### 4.1 `hello` — once after every `welcome` (a reconnect too)

```jsonc
{"t": "stand", "k": "hello", "v": 1, "boss": "clock", "q_count": 6, "time_s": 15, "speed": true,
 "stage": [800, 520, 80], "floor": {"x": 20, "y": 160, "tile": 60, "cols": 26, "rows": 12},
 "letters": ["А", "Б", "В", "Г"], "alarm_ms": 3000, "fall_ms": 900, "floor_ms": 4000}
```

### 4.2 `state` — the whole picture, after `hello` and on every change

```jsonc
{"t": "stand", "k": "state",
 "phase": "lobby" | "countdown" | "open" | "reveal" | "leaderboard" | "podium" | "ended",
 "qi": 2, "q_count": 6, "players": 24,                // qi: -1 in the lobby
 "q": {"text": "…", "options": ["…", "…", "…"]},      // countdown, open, reveal; else null
 "opens": 81250, "closes": 96250,                     // room ms of this question; null when q is null
 "floor": "up" | "down",                              // down from the stomp until res.back
 "res": null | {                                      // reveal only
   "qi": 2, "key": 1, "counts": [3, 17, 2],           // key: the right option = the zone that stays
   "stood": 15, "of": 24,                             // «Устояли 15 из 24»: alive players on the right zone / players
   "fastest": {"id": 12, "pts": 980, "ms": 1450} | null,  // the alive one who got onto the right zone first
   "fell": [3, 9, 31],                                // characters that fall at this stomp
   "back": [5, 7],                                    // characters that come back to life when the floor returns
   "at": 96620, "back_at": 100620,                    // room ms of the stomp and of the floor's return
   "pts": [[12, 980], [5, 380]] },                    // HOST ONLY: every point scorer
 "top": null | [{"id": 12 | null, "name": "Дима", "look": {…}, "pts": 2450, "move": 1}],  // leaderboard, podium (5)
 "acc": null | 69}                                    // podium: right answers in % of all asked
```

- A client animates by **transitions**: `open` → `reveal` plays the stomp and the fall of `res.fell`; `floor`
  `down` → `up` plays the return of `res.back`. A `state` received after a reconnect is drawn as it is now: no stomp
  when `res.at` is more than ~1 s in the past, no return when `back_at` has passed.
- `top[].id` is the character's entity id when it is in the room (null when its phone never connected). Phones get
  names only here (CONTRACT §5: top five); the projector has every name in its roster.
- `counts` are by zone over every answer (ghosts too). `stood` counts alive players only.

### 4.3 `me` — phones only, after `hello` and whenever their numbers change

```jsonc
{"t": "stand", "k": "me", "ghost": false, "pts": 2450, "streak": 2, "best": 3, "right": 4, "place": 4, "of": 24,
 "last": null | {"qi": 2, "choice": 1 | null, "ok": true, "pts": 620, "ms": 4210 | null,
                 "fell": false, "revived": false, "late": false}}
```

`choice` is the zone the player stood in at the moment (null: none). `late`: joined after the question opened, so it
did not count (§6). `place`/`of` are among players not kicked.

### 4.4 Client → server

- Host: `{"t": "cmd", "op": "sync"}` after every `live_next`, `live_kick`, `live_end`. Other host commands as in
  `MOVE.md`; `map` and `npc` are refused in a stand room (`{"t": "err", "code": "op"}`): the arena is the mode's.
- Phones send nothing new: only the joystick (binary) and pings.

## 5. One question, step by step (room ms; T = `time_s` × 1000)

| when | what |
|---|---|
| host `live_next` | DB: `countdown`, `opens_at = now + 3 s`, `closes_at = opens_at + T` |
| +0.2…1 s | `state` countdown with `q`, `opens`, `closes` |
| `opens` | `state` open |
| `closes − 3000` | clients start the alarm (shake, ticking); nothing is sent |
| `closes` | phones stop moving: `MoveClient` sends a still stick from its own `closes` on; the boss jumps |
| `closes + 250` | the room reads every zone (commands sent before zero have arrived), freezes everyone, writes the answers (one call) |
| + the call (≈ 0.2–0.6 s) | `state` reveal with `res` (`floor: down`), `me` to each phone. Fallen: frozen for `fall_ms`, then they move as ghosts. Alive on the right zone and ghosts on it: frozen until `back_at` |
| `res.at + 4000` | `state` with `floor: up`; `F_GHOST` cleared for `res.back`; everyone moves |
| host `live_next` | `state` leaderboard with `top`; then the next countdown, … |
| after the last reveal | `live_next` → `state` podium with `top`, `acc`; `me` with the final numbers |

If the room cannot write (Supabase down, the room restarted): it retries with backoff until `closes_at + 7 s`. The
database itself closes an open stand question at `closes_at + 8 s` with no answers (everyone gives none).

## 6. Rules the server applies

- **Which zone.** The character's centre at `closes + 250 ms`. A zone is a closed rectangle: a centre exactly on its
  edge is inside. Zones never touch (corridors 120–240 wide), so a border is only zone versus floor.
- **Elapsed** = the moment the character entered the zone it ended in (the tick its centre crossed in, after the last
  time it left) − `opens`, clamped to 0…T. In the zone before `opens` (or standing there from the last question):
  0 ms, the full early bonus.
- **Who answers:** connected players (`F_AWAY` clear) in a live zone. A disconnected phone gives no answer, wherever its
  character stands. A player who joined the game after `opens_at` (late joiner) gives no answer and loses nothing: if
  not on the right zone they fall with the others and come back with the floor (in `res.back`).
- **Ghosts.** An alive player with a wrong answer or none falls and becomes a ghost (`frozen` in `live_players`,
  `F_GHOST` in snapshots). A ghost moves like everyone (same speed, same walls). A ghost on the right zone gets half
  points (no streak bonus) and comes back to life when the floor returns; a ghost elsewhere stays a ghost.
- **Points** (alive and right): `early = speed ? max(0, 1 − elapsed / T) : 1`, `base = 500 + 500 × early`,
  `streak_after = streak + 1`, `mult = 1 + 0.1 × min(streak_after − 1, 4)`, `pts = 10 × round(base × mult / 10)`.
  Ghost and right: `pts = 10 × round(base / 2 / 10)`, streak becomes 0, revives + 1. Wrong or none: 0, streak 0.
  Rounding: `floor(x + 0.5)` on doubles (as `Math.round`). Range: alive 500…1400, ghost 250…500.

  | T | elapsed | streak before | who | early | base | mult | pts |
  |---|---|---|---|---|---|---|---|
  | 15 s | 3000 ms | 0 | alive | 0.8 | 900 | 1.0 | **900** |
  | 15 s | 6000 ms | 2 | alive | 0.6 | 800 | 1.2 | **960** |
  | 15 s | 4321 ms | 1 | alive | 0.711933… | 855.97 | 1.1 | 941.56 → **940** |
  | 15 s | 0 ms | 4 or more | alive | 1 | 1000 | 1.4 | **1400** |
  | 15 s | 15000 ms | 0 | alive | 0 | 500 | 1.0 | **500** |
  | 15 s | 7500 ms | any | ghost | 0.5 | 750 | — | 37.5 → **380** |
  | 15 s | 3000 ms | any | ghost | 0.8 | 900 | — | **450** |
  | any | any | 0 | alive, speed off | 1 | 1000 | 1.0 | **1000** |

- **Stored** as in battle so stats, review and the podium keep working: `live_answers` (`choice` = zone index,
  `elapsed_ms`, `correct`, `dmg` = points), `live_players` (`dmg` = total points, `streak`, `best`, `right_n`,
  `frozen` = ghost, `thaws` = revives: three in a game open the `horns`), `live_questions` (`counts`, `right_n`,
  `hits` = `[{player_id, dmg: pts, hp_after: 0}]`, `frozen_now` = fell, `thawed` = revived). Ranking, `top`, `final`,
  `live_review` and the wardrobe are the battle's (`dmg` means points in a stand game).
- **The write.** `public.live_stand_close(p_game uuid, p_host_token text, p_qi int, p_answers jsonb) → jsonb`:
  SECURITY DEFINER, `search_path = ''`, executable by anon and authenticated, authorised by the **host token** like
  `live_next` (the Space holds no service-role key: Codebase_Map, `supabase_rest.py`, `bot_bridge.py`; the room already
  holds the host token). `p_answers = [{"p": "<live_players.id>", "c": 0…n−1, "e": 0…T}]` (≤ 300, one per player).
  It locks the game, writes the answers, closes the question and returns
  `{"qi", "key", "counts", "right", "active", "again", "now", "rows": [{"p", "c", "ok", "pts", "ms", "fell",
  "revived", "ghost", "out", "total", "streak", "best", "right", "place"}]}` (every player not kicked). Called again
  for a closed question (a retry after a lost answer), it writes nothing and returns the same with `"again": true`.
  Refusals: `42501 host`, `P0002 game`, `22023 mode` (not a stand game), `22023 answers`, `ML004 bad_qi`,
  `ML004 early` (countdown, or more than 1 s before `closes_at`).

## 7. The key never leaves before the close (CONTRACT §5)

The room learns the key only from `live_stand_close`'s answer, which exists only because that call closed the
question; `live_host_state` gives it only from `reveal` on. Before the stomp nothing on the wire tells the zones apart:
`q` has text and options only, zone ids are letters, no message or flag marks the right zone. `res` exists only in
`reveal`. The phone learns other players' choices only as `counts` after the close.

## 8. What each screen shows

Texts follow the plain-words rules (short, no exclamation marks, numbers first). Suggested lines, not final copy.

| phase | phone | projector |
|---|---|---|
| lobby | own character, stick; «Ждём начала» | PIN, QR, the crowd running; «Начать» |
| countdown | question and options with letters; «Бегите к ответу» | the board: question, options А–Г; zones light up (closed ones dim); 3-2-1 |
| open | big timer, own zone letter («Вы на Б»), the stick | the board, timer, live counts per zone (from snapshot flags) |
| last 3 s | timer shakes, short vibration each second | alarm shakes, the boss winds up |
| reveal | «Верно. +620» / «Мимо. Теперь вы призрак» / «Призрак на верном ответе. +380. Скоро вернётесь» / «Вы зашли позже. Этот вопрос не считаем»; streak «3 подряд» | the stomp, the floor drops, falls; «Устояли 15 из 24»; «Быстрее всех — Дима, +980» |
| floor up | «Вы снова в игре» for the revived | ghosts on the right zone come back |
| leaderboard | own place «4 место из 24», points | top five with moves |
| podium | own place, points, best streak; parts opened (one `live_state` call: `final.unlocked_now`) | top three on the podium, «Верных ответов 69 %» |

Ghosts are drawn translucent and floating on both screens; a character with `F_AWAY` is drawn faded.

The phone (`components/live/stand/phone`): during countdown, open and reveal its own 3D view of the arena (the kit,
camera on the own character; KIT_3D.md), the question card on top with the four answers in the floor's layout, the
stick bottom left, a small map and «Вы на ответе Б» bottom right, the result cards over the arena; the lobby, the
leaderboard and the podium are pages with the 2D map. Others carry no name tag on a phone (§5 of CONTRACT.md). The
database is read at the join, at the podium (`final.unlocked_now`) and when the room is gone, never while it works.
The hero picker shows the kit's pictures before the join when the link says `mode=stand` (else after the join, in the
lobby).

## 9. Smooth movement on a 150 ms phone (rules for both clients)

- **Own character: prediction.** Draw `frame().me` every animation frame; never wait for a snapshot. The predictor
  replays unacked commands after each snapshot and fades corrections over ~100 ms (a jump over 120 units is shown at
  once: a respawn).
- **Others: interpolation.** Draw `frame().others` (the past, between two snapshots). Use `delayMs: 150` on phones
  (mobile jitter) and the default 100 on the projector. Past the newest snapshot they glide ≤ 100 ms, then hold.
- **A lost or late snapshot** (a TCP retransmit stalls ~1 RTT, then a burst): do nothing special. Do not snap others to
  the newest one, do not speed up time; the buffer fills again.
- **Reconnect:** `MoveClient` reconnects with backoff and the server gives the same character back (`resumed: true`),
  then `hello`, `state`, `me`. Keep drawing the last picture; after 1 s without snapshots show «Связь пропала.
  Подключаемся». The phone never calls the database for the game's state while the socket works.
- **Timers** from `closes − client.serverNow()`, never from the device clock or from message arrival.
- **At zero** `MoveClient` holds the stick by itself (still commands from its `closes` until the next `state`); the
  UI lets the stick go.
- **Render loop:** `requestAnimationFrame` only, positions straight into the scene (no React state per frame); create
  meshes on `add`/`welcome`, not per frame. Phase changes come about seven times per question: rebuild the overlay
  then, not per frame.
- **Never send per frame:** the stick goes through `setJoystick` (batched at 15 Hz by the client).

## 10. Server budget

- Tick work with 40 players in a stand room: p99 ≤ 3 ms. Asserted on the tick's own CPU time by `test_live_stand.py`
  (40 players running in an open question, snapshots framed for 41 sockets: p50 0.32, p99 0.60 ms on 21.10). The wall
  time under a whole game of 40 bots over the socket (`test_live_stand_api.py`, `stats`): p50 0.3, p99 1.4–2.0 ms on a
  machine at load 14–17 on 4 cores; the end to end through PostgREST with 30 bots: p99 0.66 ms. Mode work per tick: one
  zone check per player during `countdown` and `open`, nothing otherwise.
- Every socket must ping (`MoveClient` does, every 2 s): the server drops one silent for 15 s, longer than a question.
- No JSON per tick. Per question per socket: ~7 messages (countdown, open, reveal, floor up, leaderboard, `me` × 1–2).
- Database: one `live_host_state` a second per room (mostly `unchanged`), one `live_stand_close` per question.

## 11. Release order

1. Apply `20261022090000_live_stand.sql` (after `20261021090000_live_game.sql`), then run `supabase/tests/live_stand.sql`
   and `supabase/tests/live_game.sql`. Until then `live_create` refuses `mode: "stand"` (`22023 mode`), so nothing
   half-works. Rollback: `supabase/rollback/20261022090000_live_stand_down.sql` (drops stand games only).
2. Release the Space (the room). A stand game whose room is not there closes each question by time (`closes_at + 8 s`,
   no answers).
3. The projector and the phone screens.

## 12. Mode B «Убеги от Дедлайна» (later)

`backend/live_move_modes.make_mode` picks the mode from the game's settings; a new value (`"run"`) gets its own module
and `RoomHooks` there. Snapshot flag bits 6–7 and `"t": "run"` messages are free for it. Nothing of B exists yet.
