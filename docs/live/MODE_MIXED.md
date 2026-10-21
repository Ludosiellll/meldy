# The battle with movement rounds — contract

The owner, 21.10: «игру эту сделать как вариант … чтобы каждые три вопроса например, или каждые 10 вопросов включалась
миниигра, в общем как в кахуте». On setup the teacher picks «Мини-игра с движением»: «Нет», «Каждые 3 вопроса»,
«Каждые 5 вопросов» (offered first), «Каждые 10 вопросов» or «Все вопросы». A mixed game is a battle «Битва с монстром»
(`CONTRACT.md`) in which every Nth question is played as a movement round of «Встань на ответ» (`MODE_STAND.md`): the
question in the arena, the zones, the stomp and the falls; the class still fights «Дедлайн», and the round's right
zone hits the boss like a right tap.

This file is the contract between the database (`supabase/migrations/20261024090000_live_mixed.sql`), the room server
(`backend/live_move_mixed.py` on top of `live_move_stand.py`), the projector and the phone. It builds on `CONTRACT.md`
(the battle), `MOVE.md` (the socket) and `MODE_STAND.md` (the arena, the messages, the zone rules). TypeScript:
`frontend/src/lib/live/types.ts` (`StandEvery`, `Mixed`, `miniGameSettings`, `miniGameOf`, `mixedOf`, `isStandRound`,
`untilStandRound`), `rules.ts` `standRounds`, `move/protocol.ts` (`F_ICE`, `isIced`, `arenaLive`, the mixed fields of
the `Stand*` messages). The room's messages are shared in `contracts/live/mixed_messages.json` (written and checked by
pytest, parsed by Vitest). Where this file and the code disagree, fix one of them in the same commit.

## 1. The setting

| the teacher picks | `p_settings` | what it is |
|---|---|---|
| «Нет» | `{"mode": "boss"}` or `"stand_every": 0` | today's battle |
| «Каждые 3 вопроса» | `{"mode": "boss", "stand_every": 3}` | a mixed game |
| «Каждые 5 вопросов» (the setup's default) | `{"mode": "boss", "stand_every": 5}` | a mixed game |
| «Каждые 10 вопросов» | `{"mode": "boss", "stand_every": 10}` | a mixed game |
| «Все вопросы» | `{"mode": "stand"}` | today's stand game (`MODE_STAND.md`) |

- `stand_every`: a JSON number 0, 3, 5 or 10; left out = 0. Anything else (a string, `null`, 4, 3.5) and a non-zero
  value with `mode: "stand"` → `22023 stand_every`. The database's default is 0, so a screen that does not know the key
  keeps the plain battle; the setup's default pick is 5 (`DEFAULT_STAND_EVERY`; `miniGameSettings(pick)` gives the
  settings of a pick, `miniGameOf(settings)` the pick back).
- `time_s` is the battle's: 10, 20 or 30 (default 20) for every question, movement rounds too. Players may run during
  the 3 s countdown, so a 10 s round still leaves 13 s to cross the arena (~6 s corner to corner).
- `boss` (`clock` | `skeleton`, default `clock`) is the arena's boss; `speed`, `who`, `chat_names` are the battle's.
- `live_games.stand_every` keeps it (check: 0, 3, 5, 10 and non-zero only with `mode = 'boss'`).

## 2. What stays the battle

Everything but the way a movement round is answered: `mode` is `"boss"`; the state machine and `live_next`; the boss's
HP (`players × questions × 55` at the first countdown, `+55 × questions not yet opened` for a late joiner while it is
alive), phases, the phase-2 heal; the podium when the boss falls (also right after a movement round) or after the last
question; `won`, accuracy (`right answers / (players × questions asked)`), ranking by damage, the wardrobe and its
unlocks (three thaws in a game open `horns`, movement thaws count), `live_review`, the Realtime hints, and the bot's
texts: its facts say `mode: "boss"`, so the group sees the battle's post «Битва с монстром · N вопросов» and the edits
«Идёт игра · вопрос i из N / Играют n · у Дедлайна X %», which stay true in a mixed game.

## 3. Which question is a movement round

**Rule** (`meldy_private.live_stand_round(stand_every, q_count, qi)`, the only place it lives): question `qi` (0-based)
is a movement round when `qi + 1` is a multiple of N; when the game has fewer than N questions, its last question is
the movement round (the teacher who picked a mini-game gets one). No other question is.

| N | questions | movement rounds (1-based) | `mixed.rounds` (qi) |
|---|---|---|---|
| 3 | 6 | 3, 6 | `[2, 5]` |
| 3 | 7 | 3, 6 (the 7th is a button question) | `[2, 5]` |
| 5 | 12 | 5, 10 | `[4, 9]` |
| 10 | 30 | 10, 20, 30 | `[9, 19, 29]` |
| 10 | 6 | 6 (shorter than N: the last) | `[5]` |
| 3 | 1 | 1 | `[0]` |

**How everyone knows.** The database computes it; nobody else does.
- `live_state` and `live_host_state` of a mixed game carry `"mixed": {"every": 3, "rounds": [2, 5]}` from the lobby on
  (`mixedOf(state)`; `untilStandRound(mixed, qi)` gives «мини-игра через k вопросов»), and `question.stand` (true or
  false) whenever there is a question (`isStandRound(state)`).
- The room reads `question.stand` from its `live_host_state` polls and `mixed` from the one at its opening. It never
  computes the rule. The mirrors (`rules.ts` `standRounds` for a preview before the game exists, `live_move_mixed.py`
  `stand_round` for the tests) are rehearsed against the SQL on every N of 0, 3, 5, 10 and 1–30 questions.

## 4. What the phone and the projector get, phase by phase

Both open the room's socket (`MoveClient`, `MOVE.md`) when they enter a mixed game (the projector from the lobby, the
phone right after the join) and keep it for the whole game. The room is opened by the projector's socket, as in a stand
game; a phone that comes first gets 4404 and retries.

| DB state | the database (`live_state` / `live_host_state`) | the room's socket |
|---|---|---|
| `lobby` | the battle's lobby + `mixed` | `hello` (with `mixed`), `state` `{phase: "lobby", round: null}`; **no snapshots** |
| a button question: `countdown`, `open`, `reveal` | the battle's (`question.stand: false`; taps by `live_answer`) | `state` `{round: "tap", q: null, opens: null, res: null}` once per change; **no snapshots, no zone checks** |
| a movement round: `countdown` (3 s) | `question.stand: true`, text, options, times; `live_answer` → `ML004 stand` | `state` `{round: "stand", phase: "countdown", q, opens, closes}` ~0.2–1 s after the click (the host's `sync`); snapshots at 10 Hz from now on; **everyone lines up** in two rows along the corridor between the zones (nobody keeps a zone from an earlier round) |
| `open` (`time_s`) | `answered` stays 0 | `state` open; players run; zone flags in snapshots |
| (the room at `closes + 250 ms`) | the room's `live_stand_close` closes the round with the battle's close | — |
| `reveal` | the battle's `result` + `stand: true`, `void: false`; `me`: the battle's numbers | `state` reveal with `res` (§4.2); `me` to each phone; the fallen float as ghosts until the floor returns (4 s), then **nobody is a ghost**; the battle's freeze is drawn as ice (`F_ICE`) |
| `leaderboard`, `podium` | the battle's | `state` `{phase, round}`; no snapshots (the battle's screens show these) |
| `ended` | — | the sockets close with 4410 one second later |

The arena is on screen only while `round` is `"stand"` and `phase` is countdown, open or reveal: `arenaLive(state)`
(a stand room always: its lobby is a run-around too). Between movement rounds the socket carries pings, pongs and the
rare `state`: `MoveClient`'s stale check (4 s without any message) is kept alive by the pongs of its 2 s pings.

### 4.1 The database's JSON, only in a mixed game (a battle's and a stand game's stay as they were)

```jsonc
// PlayerState and HostState
"mixed": {"every": 3, "rounds": [2, 5]},
"question": {…, "stand": true},                        // whenever there is a question
"boss": {"hp": 1013, "hp_max": 1320, "phase": 0, "defeated": false, "kind": "skeleton"},
"result": {…, "stand": true, "void": false},          // from reveal on; void: the room never wrote this round
// HostState
"settings": {"mode": "boss", "time_s": 20, "speed": true, "who": "pin", "chat_names": true, "boss": "skeleton", "stand_every": 3},
// Review
"items": [{…, "stand": true}]                          // choice: the zone stood in, null for none
```

### 4.2 The room's messages in a mixed room (`"t": "stand"`, `MODE_STAND.md` §4 plus these fields)

- `hello`: + `"mixed": {"every": 3, "rounds": [2, 5]}`; `time_s` is the game's.
- `state`: + `"round": "stand" | "tap" | null`; `q`, `opens`, `closes`, `res` only in a movement round; `top` and
  `acc` are always null (the battle's leaderboard and podium come from the database).
- `res` of a movement round:
  - `fell`: every character not on the right zone (where they stand decides, as the stomp shows it); `back` is the
    same list: everyone comes back when the floor returns;
  - `stood`: the right answers (hits and thaws); `of`: the players of the question; `fastest`: the first hit;
  - `thawed` (frozen before, on the right zone: the ice breaks), `froze` (frozen now: a wrong zone or none);
  - the boss after the round: `hp`, `hp_max`, `phase`, `defeated`, and `healed`, `phase_changed`;
  - `void`: the room never wrote the round (`fell` and `back` empty, the floor stays up);
  - host only: `pts` `[[entity id, damage]]` and `hits` `[[entity id, damage, the boss's HP after it]]` in the order
    the hits land.
- `me` (phones, after each movement round only): `pts` = the battle's points (damage) in total, `streak`, `best`,
  `right`, `place`, `of`, `frozen` (the battle's freeze), `ghost` always false; `last`: `qi`, `choice` (the zone or
  null), `ok`, `pts` (this round's damage; 0 for a thaw), `ms`, `fell`, `late`, `thawed`, `froze`, `void`.
- Snapshot flag `F_ICE = 1 << 6`: the character is frozen in the battle (bit 5 `F_GHOST` is this round's fall only).
- Host commands as in a stand room (`sync` after every `live_next`, `live_kick`, `live_end`; `map` and `npc` refused).

### 4.3 The room's write: `live_stand_close` in a mixed game

The same call as in a stand game (`MODE_STAND.md` §6: host token, `p_answers = [{"p", "c", "e"}]`, at most 300, players
kicked or joined after the opening left out, `again` on a retry, `ML004 early`, `22023 answers`), now also for a mixed
game's movement round; a mixed game's button question → `ML004 tap`; a battle without movement rounds → `22023 mode`.
It writes the answers, marks the round as the room's (`live_questions.room_at`) and closes it through
`meldy_private.live_close`, the battle's own close. Its answer in a mixed game (`meldy_private.live_mixed_result`):

```jsonc
{"qi": 2, "key": 1, "counts": [1, 2, 0, 0], "right": 2, "active": 4, "again": false, "void": false, "now": "…",
 "healed": 0, "phase_changed": 1, "hits": [{"player_id": "…", "dmg": 141, "hp_after": 872}], "frozen_now": ["…"], "thawed": ["…"],
 "boss": {"hp": 872, "hp_max": 1320, "phase": 1, "defeated": false},
 "rows": [{"p", "c", "ok", "dmg", "ms", "thawed", "froze", "frozen", "out", "total", "streak", "best", "right", "place"}]}
```

## 5. Scoring and damage

A movement round is closed by the battle's close; only the source of the answers differs:

- **The answer** is the zone the character's centre stands in at `closes + 250 ms`; its **elapsed** is the moment it
  entered that zone − `opens`, clamped to 0…T (in it before `opens`: 0, the full early bonus). As `MODE_STAND.md` §6.
- **Right zone, not frozen: a hit.** `dmg = round(100 × speed × mult)`, `speed = 0.5 + 0.5 × max(0, 1 − elapsed / T)`
  (setting `speed` off: 1), `mult = 1 + 0.25 × min(streak_after − 1, 4)`: 50…200 (`CONTRACT.md` §3). Streak + 1, the
  points (`dmg`) are the damage, `right + 1`.
- **Right zone, frozen: a thaw.** No damage, streak 1, `thaws + 1`.
- **Wrong zone: wrong.** Streak 0, frozen.
- **No zone** (a corridor, a closed zone, a phone not connected): no answer, streak 0, and **frozen in any phase** —
  the floor fell from under them like from under a wrong zone. (A button question's no-answer freezes from phase 1.)
- Hits land in order of elapsed, then player id; HP never below 0; a right answer counts after the hit that kills.
- **Heal** (the question opened in phase 2): fewer right answers than ⌈⅔ × active players⌉ and the boss alive → +5 % of
  `hp_max`. Phases only grow; a question keeps the phase it opened with.
- A late joiner (joined after the round opened) counts nothing and loses nothing; a kicked player is left out.

**Worked example A** (rehearsed: `live_mixed_behaviour.sql` §4, `test_live_mixed.py`). 4 players, 6 questions, every 3rd
a movement round, T = 20 s, speed on; `hp_max = 4 × 6 × 55 = 1320`. After two button questions the boss has 1013 HP,
phase 0. The movement round (question 3, key Б):

| player | before | at the deadline | outcome | damage |
|---|---|---|---|---|
| Дима | streak 2 | on Б since 2500 ms | hit: `speed = 0.5 + 0.5 × (1 − 2500/20000) = 0.9375`, `mult = 1 + 0.25 × 2 = 1.5`, `100 × 0.9375 × 1.5 = 140.625` | **141** (hp 1013 → **872**) |
| Лена | streak 1 | on А since 1200 ms | wrong: frozen, streak 0 | 0 |
| Боря | frozen | on Б since 4000 ms | thaw: streak 1, thaws 1 | 0 |
| Аня | streak 0 | in the corridor | no zone: **frozen** (in phase 0 a button question's no-answer would not freeze her) | 0 |

Right 2, counts `[1, 2, 0, 0]`, `frozen_now` [Лена, Аня], `thawed` [Боря]. `872 × 3 = 2616 ≤ 2 × 1320`: phase 0 → **1**
(`phase_changed: 1`). No heal (the round opened in phase 0). With `speed` off Дима would deal `100 × 1.5 =` 150.

**Worked example B** (the same game, question 6, opened in phase 2 with 372 HP; key Г): Дима (streak 5) on Г since 0 ms
→ `mult = 1 + 0.25 × 4 = 2`, **200** (372 → 172); Лена (frozen) on Г → thaws; Боря (frozen) on В → stays frozen; Аня
(frozen) nowhere → stays frozen. Right 2 < ⌈⅔ × 4⌉ = 3 and the boss alive → heal `round(0.05 × 1320) =` **66** → **238**.
The last question: podium, `won: false`, accuracy 13 right of 24 asked = 54 %.

**Example C, void** (rehearsed: §6): 2 players, every 10 of 3 questions, so question 3 is the movement round; the room
writes nothing. 8 s after the deadline the database closes it: no hits, nobody froze, Дима keeps his streak 2, no heal
although the round opened in phase 2 with nobody right; `result.void: true`, counts `[0, 0, 0, 0]`.

## 6. Edge cases

- **The last question.** A movement round may be the last question (3 of 6): its reveal leads to the podium as any last
  question. When N does not divide the count, the questions after the last movement round are button questions.
- **A game shorter than N:** its last question is the one movement round (10 of 6 → the 6th). A one-question game with
  N > 1 plays that question in the arena.
- **The boss falls** in a movement round: the podium right after its reveal (`won: true`); later rounds never come.
- **Players who join mid-game:** HP as the battle (`+55 ×` questions not yet opened). Joined after a movement round
  opened: their zone does not count (`out` / `late`), they fall with the others if off the right zone and come back with
  the floor. A character that comes into the room during a movement round's countdown or open lines up first.
- **The room is down during a movement round** (a release, the Space asleep, a crash): nobody writes it, and the
  database closes it by time at `closes_at + 8 s` (a button question: 1.5 s) as **void**: nobody hits, nobody freezes,
  no streak is lost, no heal, the phase stays (`result.void`, `res.void`). The screens say the round did not count
  («Мини-игра не засчитана: арена не ответила»). A room that comes back reads the stored result (`again`, `void`) and
  shows it without a stomp. A room that is up but cannot reach the database retries the write until `closes_at + 7 s`;
  if it never lands, the round is void the same way.
- **A phone without the socket** (WebSockets blocked on its network): it cannot stand anywhere, so each movement round
  freezes it (no zone); its next right tap thaws it. The phone should say «Нет связи с ареной» when its `MoveClient`
  is not `open` during a movement round.
- **A reconnect** gets the same character back, then `hello`, `state` and, during a movement round's reveal, `me`.
- **Kicks** as the battle (`live_kick` and the room's `kick`); the kicked one's zone is left out.
- **Refusals:** a tap on a movement round `ML004 stand` (also in its countdown); the room's write on a button question
  `ML004 tap`, too early `ML004 early`; a stand setting on a stand game `22023 stand_every`.
- **The rollback** (`supabase/rollback/20261024090000_live_mixed_down.sql`) ends every open mixed game (`expired`) and
  drops the column; finished ones stay as battles with their reviews.

## 7. Server budget

- Between movement rounds the room does no zone check and sends no snapshot: 0 bytes a second of positions; its tick is
  the command queue and housekeeping. Phones send no commands there (the stick is hidden, `MoveClient` sends nothing
  while it rests); even with 40 players still steering, the tick's CPU is p50 0.26 / p99 0.34 ms against 0.40 / 0.58 ms
  in a movement round (`test_live_mixed.py`, 21.10, a shared 4-core machine).
- In a movement round it is a stand room: p99 ≤ 3 ms of tick CPU with 40 players (asserted); over the socket with 30
  bots through a whole game p99 0.6–0.9 ms wall (`test_live_mixed_api.py`, the end to end through PostgREST).
- Database: one `live_host_state` a second per room for the whole game (mostly `unchanged`; full in `lobby` and
  `open`), one `live_stand_close` per movement round. The phones keep the battle's polling (`CONTRACT.md` §6).

## 8. What each screen shows (as built, 21.10)

**Setup** (`pages/live/LiveSetupPage.tsx`, the card «Игра»)
1. One card for the game with the picker «Мини-игра с движением»: «Нет», «Каждые 3 вопроса», «Каждые 5 вопросов» (the
   default, `DEFAULT_STAND_EVERY`), «Каждые 10 вопросов», «Все вопросы»; `?mode=stand` opens it on «Все вопросы», `?mini=N`
   on N («Ещё раз» keeps the pick). The card's picture and line follow the pick: the battle's, the stand game's, or the
   battle's with the arena's boss and «На вопросах 3 и 6 ученики бегут на верный ответ» (`SETUP.mixedAbout`, the
   questions from `standRounds(N, count)`; past four of them «На каждом 3-м вопросе»).
2. «Все вопросы»: the stand game's form (time 15/20/30, the boss). The others: the battle's time 10/20/30; with N > 0
   also the boss pick. The settings are `miniGameSettings(pick)` plus time, speed, who, chat_names and the boss.
3. `22023 stand_every` shows the generic error.

**Projector** (`components/live/stand/MixedHost.tsx`, lazy; `LiveHostPage` picks it for `mixedOf(state)` or
`settings.stand_every > 0`)
1. The battle's screens (`HostScreen`) with the room opened from the lobby (`useStandRoom`) and `{op: "sync"}` after
   every «Дальше», kick and end. The lobby's line names the movement rounds («мини-игра на вопросах 3 и 6»); the bar
   says «Мини-игра через 2 вопроса» / «Следующий вопрос с мини-игрой» on a reveal and the leaderboard.
2. A movement round (`arenaOn` in `stand/mixed.ts`: the room's state when it knows the question, else
   `question.stand`): the stand game's 3D arena (`StandScene` with `mixed: true`, loaded once in the lobby and paused
   between rounds) under the battle's stage, the battle's bar and HP bar on top, the question, the zones' live counts,
   the timer and «Заморожены N» under it. The battle's body stays mounted and hidden, so nothing reloads.
3. Its reveal (`revealPlan`): the stomp and falls, then the hits one by one about 1.1 s later (each one moves the HP
   bar, a short shake and `land`), the blow (`hit`, the boss's stagger), then the news (phase, heal, defeat, the
   battle's banners and cues); ice forms on `res.froze` and breaks on `res.thawed` after the blow (`Player.setIce`);
   «Попали N из M», «Быстрее всех Алина, −141», the three who hit hardest as chips. `res.void`: «Мини-игра не
   засчитана», nothing played. A reveal seen late (a reload) shows the end state at once.
4. «Дальше»: the battle's leaderboard; a defeat in a movement round ends on the battle's podium as usual.
5. `?bench` exposes the arena (`__stand`) as in the stand game (`scripts/stand-local.mjs`, `scripts/mixed-local.mjs`).

**Phone** (`components/live/stand/phone/MixedPhone.tsx`, lazy; `PlayerApp` wraps the game screens in it when
`mixedOf(state)`)
1. The room's socket from the join on, for the whole game (`StandSession`); the battle's polling as in any battle. The
   lobby says «На вопросах 3 и 6 будет мини-игра. Там вы бегаете по арене».
2. Button questions, leaderboard, podium: the battle's screens (`children`); a tap on a movement round is never sent.
3. A movement round: the stand phone's screen (`StandPlay`: arena in 3D or the light view, stick, small map, question
   card; no answer buttons). Until the room speaks for the question its card and times come from `live_state`.
4. Its result (`mixedOutcome`, from the room's `me` or else `live_state.result`): «Верно. −141 урона Дедлайну»,
   «Лёд растаял», «Мимо. Вы заморожены», «Вы не встали ни на один ответ. Вы всё ещё заморожены», «Вы зашли позже»,
   «Мини-игра не засчитана»; a frozen player sees «Вы заморожены. Встаньте на верный ответ, и лёд растает» during the
   round, and the ice on their character (others' from `F_ICE`). On the leaderboard after the round the battle's sheet
   repeats it in the same words («Не встали на ответ», «Мимо», «Мини-игра не засчитана»; `missWords` in `Battle.tsx`).
5. «Нет связи с ареной» while the socket is not open during a movement round; «Связь пропала. Подключаемся» while it
   reconnects. The review marks the movement rounds («Мини-игра», «вы стояли тут», «Не встали на ответ»).

**Both:** equal points share the place number on every list (`rules.ts` `sharedPlaces`, `shownPlace`): the order stays
the server's, the place shown is «1, 2, 2, 4». The phone's own place past the five best stays the server's (it does not
see the others' points there).

**Sounds:** only the cues that exist (`tick`, `roll`, `hit`, `land`, `freeze`, `heal`, `growl`, `fanfare`; the stomp plays `roll`).
Wanted: ice breaking (thaw), a short start of the mini-game, the fall into the floor.

**Fake server** (`lib/live/fake.ts`): mixed games with `question.stand` by `standRounds`, `ML004 stand` on a tap there,
bots that skip those rounds, and the round closed as void after the room's grace (no room in the fake).

**On this machine:** `frontend/scripts/mixed-local.mjs open | shots <dir> | video <dir>` plays a whole mixed game: the
rehearsal's database, a real PostgREST, the real room with bots (`supabase/tests/local/live_mixed_local.sh`,
`backend/scripts/live_mixed_local.py`), the site, the projector and one phone in Chromium.

## 9. Release order

1. Apply `20261024090000_live_mixed.sql` after `20261022090000_live_stand.sql` and
   `20261023090000_live_stand_phone.sql` (they touch different functions, so the order of the last two does not
   matter), then run `supabase/tests/live_mixed.sql`, `live_stand.sql`, `live_stand_phone.sql` and `live_game.sql`. The
   rehearsal (`supabase/tests/local/live_game_run.sh`) applies them in this order. The old `live_create` ignores an unknown `stand_every` (it makes a plain
   battle), so the setup must not offer the picker before the migration is live.
2. Release the Space (the room: `live_move_mixed.py`). A mixed game whose room is not there plays its movement rounds as
   void rounds (closed by time, nothing counts).
3. The setup, projector and phone screens (§8).
