# Mode B «Убеги от Дедлайна» — contract

The owner, 21.10: «бегаешь, или убегаешь от монстра, в это время отвечаешь на вопросы». Mode A («Встань на ответ»,
MODE_STAND.md) is a movement round where the class runs to the right zone before «Дедлайн» stomps. Mode B is the same
round with the boss loose: it jumps off its stage and hunts the class while the question runs. The answer is still the
zone a character stands in at zero; the database, its write (`live_stand_close`) and the points do not change.

## 1. Which rounds

- A battle with movement rounds (MODE_MIXED.md): the second, fourth, … movement round of the game is a chase
  (`MixedGame.chase_round`: the round's index in the plan is odd). Every 3rd of 6 questions: question 3 is mode A,
  question 6 mode B, so a short demo shows both.
- «Встань на ответ» (every question a round): the second, fourth, … question is a chase (`StandGame.chase_round`).
- The room decides from the game's plan; nothing is stored. The room's `state` says it: `chase: true` on a chase round
  (false outside a question), `caught`: the catches of this round so far.

## 2. The hunt (backend/live_move_stand.py, `StandGame`)

- At `opens` the hunters come down in front of the stage (800, 630): one, a second past 12 connected players, a third
  past 24 (`hunters_for`). They are the room's NPC entities (kind 1 in snapshots, `[id, 1, null, "hunter", null]` in the
  roster), speed 215 (a player runs 260: escapable, not by standing still).
- They chase the nearest character that is connected, not a ghost, not held and not just caught (`can_chase`).
- A catch (`on_catch`): the character is thrown away from the hunter — at least 180 units and on until it is off every
  zone, in small steps (no wall or the stage is crossed; a wall turns it towards the stage) — held 1.5 s, safe from a
  new catch for 2 s; the hunter rests 1 s. Event `{"t": "ev", "k": "caught", "id": <player>, "by": <hunter>}`; the
  `state` goes out again with the new `caught`.
- 2 s before zero the hunters are called back (`HUNT_STOP_MS`): no catch in the last 2 s; the stomp is from the stage.
  The decision at `closes + 250 ms` is mode A's.

## 3. Screens

- Projector (scene.ts `huntFrame`): the boss model runs where the first hunter is, smaller copies (0.62 of its height)
  where the others are; with none out it runs back to its stage. Cues `hunt` (it leaves: a roar) and `caught` (a
  slam; the caught character plays its hit pose). The board says «Убегайте от Дедлайна и встаньте на верный ответ.»
  and a pill «Поймал N».
- Phone: the 3D view draws the boss the same way (scene3d.ts `hunt`), the small map a red dot; the question card
  carries «Дедлайн гонится!»; a catch vibrates and the line says «Дедлайн поймал вас. Бегите обратно».

## 4. Tests

backend/tests/test_live_run.py (the rounds, the hunters' time and count, the catch's throw and hold, walls and the
stage, ghosts, the decision); the e2e scripts accept a chase round losing at most as many answers as it had catches;
frontend: mixed.test.ts (the state's fields), MixedHost.test.tsx (the board's line and pill).
