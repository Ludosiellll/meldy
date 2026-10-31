# Live game «Битва с монстром» — contract (MVP, 24.10)

Spec and prototype: meldy-notes `10_Project/Telegram_Live_Game_Spec_2026-10-20.md`. This file is the contract between the three
workstreams: **W1** database + `telegram` function, **W2** teacher's screen (`/live/:id`), **W3** player (`/play`, `/tg/play`) + bot.
The TypeScript mirror is `frontend/src/lib/live/types.ts`; the numbers are `frontend/src/lib/live/rules.ts` (the SQL must give the
same results — `rules.test.ts` holds the reference cases). Where this file and code disagree, fix one of them in the same commit.

Names: game = `live_games` row; host = the exam's author running it; player = anyone who joined; key = the correct option.

## 1. States

```
lobby ──next──▶ countdown ──(q_opens_at)──▶ open ──(q_closes_at + grace, or all answered)──▶ reveal
                    ▲                                                                         │ next (or 30 s)
                    └───────────── next (or 30 s) ── leaderboard ◀────────────────────────────┘
reveal (boss defeated or last question) ──next──▶ podium ──next / 3 h──▶ ended
```

| state | what it means | who moves it on |
|---|---|---|
| `lobby` | joining; host sees roster | host `live_next` (needs ≥ 1 player) |
| `countdown` | question `qi` announced: text + options visible, answers refused; lasts `COUNTDOWN_MS` = 3000 | time (server, lazily) |
| `open` | answers accepted until `q_closes_at + GRACE_MS` | time, or the last active player's answer |
| `reveal` | question closed: key, counts, hits, freezes, heal are public to this game | host `live_next`; server itself after 30 s |
| `leaderboard` | top five by damage | host `live_next`; server itself after 30 s |
| `podium` | final; boss defeated or questions over | host `live_next` (→ ended); server after 3 h |
| `ended` | no joins, no answers; `live_review` works for 7 days | — |

- From `reveal`: `live_next` goes to `podium` when the boss is defeated or `qi` was the last question, else to `leaderboard`.
- From `leaderboard`: to `countdown` of `qi + 1`.
- Time-driven moves are applied lazily by `meldy_private.live_settle(game)` at the start of every live function (like
  `quiz_settle`). The 30 s / 3 h moves keep a game from stalling when the host's laptop sleeps.
- `rev` (bigint) increases by 1 on every state change and on roster change in `lobby` (a kick moves it in any state).
  Answers do **not** change `rev` (they would flood Realtime); the host polls the answered count (§6).
- `live_next(p_expect)` takes the state the host is showing; a different current state → `ML011` (409). Double clicks and two
  host tabs cannot skip a question.

## 2. Timing (server clock only)

- On `countdown` of question `qi`: `q_ready_at = now()`, `q_opens_at = now() + 3000 ms`, `q_closes_at = q_opens_at + time_s`.
- An answer counts if the server receives it with `q_opens_at ≤ now() ≤ q_closes_at + 1500 ms` and the state is `open`
  after settling. Earlier → `ML004/early`; later → `ML004/late`.
- `elapsed_ms = clamp(now() − q_opens_at, 0, time_s × 1000)`.
- Early close: when every active player (not kicked, joined before `q_opens_at`) has an answer, the question closes at once.
- Every response carries `now` (server time, ISO with ms). Clients estimate `offset = now − (sent + rtt / 2)`, keep the median of
  the last 5, and unlock the buttons at `opens_at − offset`; the server still decides.
- `time_s ∈ {10, 20, 30}`, default 20.

## 3. Scoring, freeze, boss (numbers)

- **Damage** of a right answer by a player who is not frozen:
  `dmg = round(100 × speed × mult)`,
  `speed = 0.5 + 0.5 × max(0, 1 − elapsed_ms / (time_s × 1000))` (setting `speed = false` → `speed = 1`),
  `mult = 1 + 0.25 × min(streak_after − 1, 4)`, where `streak_after = streak + 1`. Range 50…200 (100…200 without speed).
  Rounding: `Math.round` of the JavaScript double, computed in the order of `rules.ts`. The SQL does the same in
  `float8` and rounds with `floor(x + 0.5)`; an exact `round(numeric)` would differ in 73 of the 300 015 cases of
  10/20/30 s × every millisecond × streak 1–5 (e.g. 8500 ms of 10 s: the double is 57.4999… → 57, the fraction 57.5 → 58).
  The rehearsal checks all 600 030 cases (with and without speed) against `rules.ts`.
- **Streak:** right → +1 (a thaw sets it to 1); wrong or no answer → 0. `best = max(best, streak)`.
- **Freeze:** a wrong answer freezes the player. A frozen player's right answer thaws them: `dmg = 0`, `streak = 1`,
  `thaws += 1`. A frozen player's wrong answer: stays frozen. No answer: freezes only when the question's phase ≥ 1.
- **Boss HP:** at the first `countdown`: `hp_max = players × q_count × 55`; a player joining later adds
  `55 × questions not yet opened` to `hp_max` and `hp` — only while the boss is alive (`hp > 0`; a defeated boss
  stays defeated).
- **Phase** (only goes up): `0` while `hp > ⅔ hp_max`, `1` when `hp ≤ ⅔`, `2` when `hp ≤ ⅓`. Each question keeps the phase it
  opened with (`q_phase`) — the rules shown at countdown apply to it.
  - phase 1 «Дедлайн злится»: no answer also freezes;
  - phase 2 «Последняя минута»: after the hits, if `right < ceil(⅔ × active players)` and the boss is alive, it heals
    `round(0.05 × hp_max)` (never above `hp_max`; the phase stays 2).
- **Close order:** answers sorted by `elapsed_ms`, then `player_id`. Each hit lowers `hp` (floor 0) and records `hp_after`.
  Every right answer counts for the player even after the hit that kills; the host stops the animation at the first `hp_after = 0`.
- **Defeat:** `hp = 0` at close → `defeated = true`, `won = true` → podium after reveal. Questions over with `hp > 0` → `won = false`.
- **Ranking:** `dmg desc, right desc, best desc, joined_at asc`. `move` in the top five = previous place − current place
  (previous = after the last question; 0 for a new entry). Kicked players are not ranked (not in `top`, `place`, the
  podium or the accuracy); their damage stays in the boss's HP.
- **Accuracy** on the podium: `round(100 × right answers / (players × questions asked))`.

Reference cases (also in `rules.test.ts`): `T = 20 s`, `elapsed 900 ms`, streak 0 → 98; `elapsed 0`, streak 4 → 200
(`mult 2`); `elapsed 20000`, streak 0 → 50; speed off, streak 1 → 125.

**Several right answers and text answers** (migration `20261102090000_live_kinds_teams.sql`, the one close
`meldy_private.live_close`):
- A button question of several right answers is answered with the options ticked (`picks`). Its **share** is
  `max(0, right ticked − wrong ticked) / right count` (`meldy_private.live_share`, `rules.ts` `liveShare`,
  `live_move_mixed.py` `share`; doubles): 1 only for the exact set. Share 1 is a right answer as above (damage, streak,
  a frozen player thaws). Share between 0 and 1 is a **partial hit**: `round(damage × share)` with the damage a right
  answer would deal now (`floor(x + 0.5)`, `rules.ts` `partialDamage`), by a player not frozen (a frozen one deals 0
  and stays frozen); streak 0; nobody freezes; it is not a right answer (`right`, `right_n`, accuracy and the phase-2
  heal count exact sets only); it lands among the hits in the order of time. Share 0 is wrong (streak 0, frozen).
  `counts`: every tick counts for its option. An old phone's tap is one tick.
- A movement round of several right answers (a mixed game's or «Встань на ответ»): the room writes the zone; a zone on
  **any** right option is right (full damage or points). Every right zone stays up at the stomp.
- A text answer (`typed`) is right when `public.meldy_short_norm(typed)` is the normal form of one of the accepted forms
  (the study's own rule: case, ё, spaces and one trailing dot do not matter); then as a right tap. `counts` is `[]`.
  The close keeps the question's **tops**: the three normal forms typed most often (by count, then the text), rude
  ones left out (`meldy_private.live_name_rude`), each with `n` and `ok`.
- A number answer (`typed`, since `20261102090100_live_numbers.sql`) is right when
  `public.meldy_number_right(typed, forms, tolerance, unit)` (docs/kinds/CONTRACT.md §1.1: spaces, a comma, «−», the
  unit after it do not matter; within the tolerance of an accepted number); then as a right tap; no partial credit.
  `counts` is `[]`. The close keeps the question's **tops** — the three numbers typed nearest a right value (by
  distance, then count, then value), each `{text, n, ok}` with `text` the value as a plain decimal without trailing
  zeros — and its **spread**, up to 60 values typed (the most typed) with their counts `[[text, n], …]` by value, for
  the projector's number line. A typed number is read by `meldy_private.live_number_value` (the rule's own reading:
  the rehearsal checks it on contracts/kinds/number_vectors.json); what is no number counts as wrong and is never
  shown, so no word reaches the projector from a number question.
- A number **played as ranges** (since `20261102090200_live_ranges.sql`, on a movement round's place) is a zone
  question: the zone stood on is right when it is a right range (`key`, or `keys` when another accepted number falls
  in another range), as any zone; no tops, no spread.
- Worked example (rehearsed in `live_kinds_teams_behaviour.sql` and `test_live_kinds.py`): keys `[0, 2]`, T = 20 s;
  Дима ticks 0 and 2 at 1000 ms (streak 0) → 98 (right); Лена ticks 2 at 2000 ms → share 0.5, `round(95 × 0.5) = 48`
  (streak 0, not frozen); Боря ticks 0 and 1 → share 0, wrong, frozen.

## 4. Questions

- Since `20261102090000_live_kinds_teams.sql` a game also plays an item of **two right options or more** (2–6 options;
  `live_questions.kind = 'multiple'`, `keys` = every right option's shown index, ascending, `key = keys[1]`) and a
  **text answer** (`kind = 'short'`: no options, `key = -1`, `forms` = the item's accepted forms). A text answer is
  only ever a button question: «Встань на ответ» skips it, a battle with movement rounds puts choice questions on the
  rounds' places (`meldy_private.live_arrange`: each round's place holding a text answer swaps with the nearest choice
  question on a button place, the later one on a tie; while the choice questions are fewer than the rounds, the last
  text answer is dropped and counted in `skipped`). The item's explanation is copied (`explanation`) for the review.
- Since `20261102090100_live_numbers.sql` a **number** item (release 48, docs/kinds/CONTRACT.md: 1–10 accepted
  numbers, a tolerance, a unit) plays wherever a text answer may (`kind = 'number'`: no options, `key = -1`, `forms` =
  the accepted numbers, `tolerance` and `unit` copied, the unit trimmed): only ever a button question, never on a
  movement round's place, never in «Встань на ответ» — until `20261102090200_live_ranges.sql`: a number on a movement
  round's place (a battle's round, every question of «Встань на ответ») is played as **ranges**. `meldy_private.live_ranges`
  makes four (the floor's corners А, Б above, В, Г below read like a line, left to right; a fifth would sit in the
  middle zones Д or Е and break that order, so none is drawn): the width is the first round one (1, 2, 2.5, 5 × 10^k)
  of at least the tolerance band, a quarter of the value and one step of its last digit whose grid (or the grid moved
  by half a width) holds the band strictly inside one range; that range is put at a random place; the ends are open;
  the labels say «меньше 300», «300–400», «от −15 до −10», «больше 500» (a decimal comma, «−», a no-break space between
  thousands from five digits on). The row: options = the labels, `shown` 0–3, `key` (and `keys`), `bounds` (the three
  limits), and the accepted numbers, tolerance and unit kept. `live_arrange` keeps only text answers off the rounds.
  Order, match, cloze and essay items never play (the setup names
  each: «Нужно расставить по порядку.», «Нужно сопоставить пары.», «Пропуски в тексте.», «Развёрнутый ответ.»).
- Before it: plays items with exactly one correct option of 2–6, pictures allowed, in every game: a battle, a battle with movement
  rounds and «Встань на ответ» (20261030090000_live_pictures.sql for the battle, 30.10; 20261031090000_live_wide_rounds.sql
  for the rest: the arena has six zones and its boards show the pictures; the room's write `live_stand_close` takes the
  zones 0–5, still below the question's option count). The rest are skipped and counted in `skipped` at create: for a
  контрольная, of its draw; for subjects, of the subjects' keyed questions. At most 30 are played.
- Pictures: `question.pictures` = `{"stem": [path…], "options": [[path…] per shown option]}`, present only when the
  question has any (`question.picture` stays `null`). Paths in the private bucket test-item-images; the screens read
  them through the `quiz-media` Edge Function with `{game_id, token, path}` (the host's or a player's token), which asks
  `public.quiz_live_media_paths` (service_role only): a picture of a question shown so far (from its countdown; none in
  the lobby), for the host or a player not kicked, until 7 days after the end. The review's items carry their pictures
  the same way. The projector shows the question's picture big over the arena during the countdown, then beside the
  tiles (a click shows it big again); the phone shows it under the question (a tap opens it full screen); an option's
  picture sits in its tile and button. Letters А–Е, colours and shapes for options 5 and 6: orange pentagon, violet hexagon.
- Option order: shuffled once per game per question unless the item keeps its order (`keep_order`), same for everyone
  (the letters on the projector are the letters on the phones). Stored as `shown smallint[]` (file indexes in shown order).
  Every index on the wire is a **shown** index.
- Source: a контрольная (`quiz_id`: its fixed set or a draw by its settings) or an exam's subjects (`container_id`,
  `subject_ids`, `count` 3–30, drawn at create).

## 5. Who sees what, when (the key never leaves before close)

| Data | Player (`live_state`) | Host (`live_host_state`) | Realtime hint | Bot in the group |
|---|---|---|---|---|
| question text, options | from `countdown` of that question | same | never | never |
| key of question `qi` | only when `qi` is closed (`reveal` and later) | **same — the projector is public** | never | never |
| counts per option, right count | when closed | when closed | never | never |
| who answered (no choice) | count only | ids, during `open` | never | never |
| own choice | own only | — | never | never |
| hits, freezes, heal | own result + boss HP | all | never | HP % only |
| names and looks | top five; lobby crowd (looks only) | roster | never | top three at the end if `chat_names` |
| keys of unplayed questions | never | never | never | never |

`live_review` (podium/ended): the player's own answers + keys of this game's closed questions. Guests therefore see only the keys
of the questions played; the exam's other keys never. With `who = "members"`, only exam members (account, or Telegram linked to
a member) can join.

## 6. Realtime and polling

- Channel `live:<topic>` (topic = 22 random base64url chars, returned to joined players and the host only), **public**
  (`private => false`): guests have no JWT. The DB sends `realtime.send(jsonb_build_object('rev', rev, 'state', state), 'hint',
  'live:' || topic, false)` once per transaction that changed `rev` (a deferred constraint trigger,
  `meldy_private.live_hint`: a cascade countdown → open → reveal in one read is one hint with the last `rev`).
  Public channels need Realtime's «Allow public access» on (Dashboard → Realtime → Settings; on by default).
- The payload is only a hint. Clients never trust it: on a hint they call `live_state` / `live_host_state` with `since_rev`
  (after a random 0–300 ms delay). A forged hint costs one read.
- `since_rev` equal to the current `rev` → the answer is `{"rev": n, "now": "…", "unchanged": true}` only (no question body). Never in `lobby` or `open` (the roster and the answered count move without `rev`).
- Polling, phones: every 5 s while the channel is joined; every 1 s when it is not (the `/sb` proxy carries no WebSocket) or when
  the game has more than 80 players (Free plan: 100 events/s; one hint to 150 phones is already over).
- Polling, host: every 1000 ms in `lobby` and `open` (roster, answered count); otherwise on hints + every 5 s.
- Budget per question with 30 players: ~4 hints × 31 clients ≈ 124 events over ~25 s.

## 7. Tokens and identity

- **Host token:** 32 random bytes, base64url (43 chars), returned once by `live_create`; DB keeps `sha256` hex. The host screen
  also needs the author's session for `live_create`; every later host call needs only `p_game` + `p_host_token` (the projector
  PC may be another device). Kept in `sessionStorage` `meldy.live.host.<game_id>`.
- **Player token:** same format. Web: made on the device (like `lib/quizzes/guestToken.ts`), sent in `live_join`, kept in
  `sessionStorage` `meldy.live.player.<game_id>`. Telegram: made by the function in `/telegram/game/join`, returned once, kept in
  `Telegram.WebApp.SecureStorage` key `live_<game_id_without_dashes>` (fallback `sessionStorage`).
- Identity of a player: exactly one of `user_id` (signed-in site user), `tg_user_id` (Telegram via the function; a linked
  Telegram also fills `user_id` from `bot.links`), `guest_hash` (web guest: the sha256 of their first token). One player per
  identity per game: joining again returns the same player (new token replaces the old hash; a signed-in user and their
  linked Telegram are the same player). A kicked identity cannot join again (`42501/kicked`).
- Tokens die with the game: answers stop at `ended`; `live_review` accepts the token for 7 days.

## 8. RPC (PostgREST `rpc/…`; all SECURITY DEFINER, `search_path = ''`, RLS on the tables with no policies)

Errors: every refusal of a `live_*` function uses the PostgREST status override (Codebase_Map, release 47):
`raise sqlstate 'PGRST' using message = '{"code":"…","message":"…","details":"…"}', detail = '{"status":…,"headers":{}}'`
(`meldy_private.live_fail`), so the body's `code` and `details` are always ours and the status is the table's. A 429 also
carries `Retry-After` (seconds until the oldest counted call leaves the window: at most 60 for joins). The `bot_live_*`
functions answer statuses and raise only 42501 (not the service role) and 22023 (a call the function never means).

| code | HTTP | meaning (`details`) |
|---|---|---|
| `28000` | 401 | not signed in (host create, `live_tg_post`, wardrobe) |
| `42501` | 403 | not the exam's author (`author`) / wrong host token (`host`) / kicked (`kicked`) |
| `P0002` | 404 | not found: `game`, `pin`, `token`, `player` (kick), `quiz`, `container` (create), `group` (`live_tg_post`) |
| `22023` | 400 | bad input; `details` names the field |
| `ML001` | 400 | game full (300 players) |
| `ML002` | 400 | game not joinable (`ended`, `expired`) |
| `ML003` | 403 | members only |
| `ML004` | 400 | answer refused: `early`, `late`, `not_open`, `twice`, `bad_qi`, `not_joined_yet`, `stand` (a movement game, or a mixed game's movement round: answers come from the room, MODE_STAND.md, MODE_MIXED.md), `tap` (the room's write on a mixed game's button question) |
| `ML005` | 429 | rate limit (`join`, `create`, `post`), with `Retry-After` |
| `ML006` | 400 | name refused (`length`, `rude`) |
| `ML007` | 400 | look refused (`unknown_part`, `locked`) |
| `ML008` | 400 | no playable questions (`details` = how many were skipped) |
| `ML009` | 400 | too many open games (3 per author; podium and ended do not count) |
| `ML010` | 503 | the bot is not set up (`bot`: no function URL or live token yet — `live_tg_post`) |
| `ML011` | 409 | state is not `p_expect` (`details` = current state; `empty` for a lobby without players) |
| `ML012` | 403 | «Тренировать ошибки» refused (`live_practice`): `practice` (not a member and the game's quiz offers no practice), `open` (a quiz of the exam is open: a member reads every answer), `removed` (by the author), `full` (200 members) |

`ML004` also says `kind`: a text on a choice question, a choice on a text question (`live_submit`; a tap on a text
question, `live_answer`). `22023 answer`: a `live_submit` answer of a wrong shape; `22023 teams`: `settings.teams`.

### Host (signed in for create; token afterwards)

`live_create(p_source jsonb, p_settings jsonb) → CreateResult`
```jsonc
// p_source: {"quiz_id": "uuid"}  or  {"container_id": "uuid", "subject_ids": ["uuid"], "count": 6}
// p_settings: {"mode": "boss", "time_s": 20, "speed": true, "who": "pin" | "members", "chat_names": true}
// mode "stand" («Встань на ответ», docs/live/MODE_STAND.md): + "boss": "clock" | "skeleton", time_s 15 | 20 | 30
// mode "boss" + "stand_every": 3 | 5 | 10 (default 0): a battle whose every Nth question is a movement round
// (docs/live/MODE_MIXED.md; + "boss" for the arena; 22023 stand_every)
{ "game_id": "uuid", "pin": "482913", "topic": "Q2xz…22", "host_token": "43 chars", "q_count": 6, "skipped": 0,
  "join_url": "https://ludosiel-studyforge.hf.space/play?pin=482913",
  "tg_url": "https://t.me/Meldyteach_bot/play?startapp=482913" }
// tg_url follows bot.config.flags.live_direct: false (until @BotFather /newapp) → "https://t.me/Meldyteach_bot?start=play_482913"
// quiz source: its draw (all of it, at most 30 played); subjects: `count` 3–30 drawn now, in exam order
```
`live_host_state(p_game uuid, p_host_token text, p_since_rev bigint) → HostState | {rev, now, unchanged: true}`
`live_next(p_game uuid, p_host_token text, p_expect text) → HostState`
`live_kick(p_game uuid, p_host_token text, p_player uuid) → {"ok": true}`
`live_end(p_game uuid, p_host_token text) → {"ok": true}`
`live_tg_post(p_game uuid, p_chat_id bigint) → {"status": "posting"}` — the author's session (the JWT is checked by
PostgREST, never by the bot's function); `p_chat_id` = a group bound to this exam (`telegram_groups(p_container_id)` lists
them). The database then has the bot send the post (§9); the host gets no message id back.

### Player

`live_join(p_pin text, p_name text, p_token text, p_look jsonb) → JoinResult` (anon or signed in)
```jsonc
{ "game_id": "uuid", "player_id": "uuid", "topic": "…", "state": "lobby", "rev": 3, "now": "…",
  "name": "Дима", "look": {"body": "cloud", "colour": "orange", "eyes": "round", "hat": "phones"},
  "wardrobe": {"unlocked": ["crown"], "games": 4, "wins": 2} }   // wardrobe: null for a web guest
```
`live_pin(p_pin text, p_token text) → PinResult` (anon or signed in; migration `20261025090000_live_pin.sql`) — the
phone's PIN step, before the character: `live_join(p_pin, '', p_token, null)` run inside the database with its refusal
returned as data, so every expected answer is HTTP 200. The same checks in the same order (the token, the PIN, the
game's state and its 3 hours, the limits, members only, 300 players, kicked) and nothing written but a take-back:
```jsonc
{ "status": "open", "mode": "boss" }               // a game this caller may join (the empty name was the first refusal)
{ "status": "joined", …JoinResult }                 // this token or this account was in the game: taken back with this token
{ "status": "refused", "code": "P0002", "detail": "pin", "http": 404, "retry_after": null }   // live_join's refusal
```
The client turns `refused` into the LiveError the same refusal of `live_join` gives (`types.ts` `pinRefusal`), so the words
and the step are those of the join; while the server has no `live_pin` (404 `PGRST202`) `real.ts` falls back to the old
check through `live_join`.
`live_set_look(p_game uuid, p_token text, p_look jsonb) → {"look": Look}` — lobby only (`ML004/not_open` otherwise).
`live_answer(p_game uuid, p_token text, p_qi int, p_choice int) → {"accepted": true, "answered": 18, "now": "…"}`
(on a question of several right answers: that one option ticked)
`live_submit(p_game uuid, p_token text, p_qi int, p_answer jsonb) → {"accepted": true, "answered": 18, "now": "…"}`
— an answer of any kind with `live_answer`'s checks in its order: `{"choice": n}`, `{"picks": [n, …]}` (1–6 different
shown indexes; one pick on a single answer is that choice) or `{"text": "…"}` (trimmed 1–200 characters, not empty
once normalised; a text answers a text or a number question — a text that is no number is taken there and is
wrong). `ML004 kind`, `22023 answer` as above.
`live_practice(p_game uuid, p_token text) → {"container_id", "joined", "saved", "mistakes"}` — §14.
`live_state(p_game uuid, p_token text, p_since_rev bigint) → PlayerState | {rev, now, unchanged: true}`
`live_review(p_game uuid, p_token text) → Review` — podium/ended.
`live_wardrobe() → Wardrobe`, `live_wardrobe_set(p_look jsonb) → Wardrobe` — signed-in site users.

### Shapes

```jsonc
// Look: ids from §10
{"body": "round|square|drop|bean|cloud", "colour": "blue|…", "eyes": "round|dots|one|sleepy|glasses", "hat": "none|…"}

// PlayerState
{ "rev": 12, "now": "2026-10-21T10:00:00.123Z", "state": "open", "mode": "boss",
  "qi": 1, "q_count": 6, "time_s": 20, "speed": true, "players": 24, "answered": 18,
  "question": { "qi": 1, "text": "Какая команда отменяет транзакцию?", "options": ["ROLLBACK", "COMMIT", "SAVEPOINT", "GRANT"],
                "opens_at": "…", "closes_at": "…", "phase": 1, "picture": null },          // null in lobby/podium; + "pictures" when it has any (§4)
  "boss": { "hp": 4992, "hp_max": 7920, "phase": 1, "defeated": false },
  "me": { "player_id": "uuid", "name": "Дима", "look": Look, "dmg": 221, "streak": 2, "best": 2, "frozen": false,
          "place": 4, "choice": 0 },                                                         // choice: this question, or null
  "result": null,        // from reveal: { "qi", "key", "counts": [17,3,3,1], "right": 17, "correct": true, "none": false,
                         //   "dmg": 123, "thawed": false, "frozen": false, "healed": 0, "phase_changed": null | 1 | 2 }
  "top": null,           // leaderboard/podium: [{ "player_id", "name", "look", "dmg", "move" }] (5)
  "final": null,         // podium: { "won": true, "place": 2, "dmg": 724, "best": 5, "right": 6, "accuracy_pct": 69,
                         //   "unlocked_now": ["crown"] }
  "crowd": null }        // lobby: [Look] of up to 40 other players (no names)

// HostState = PlayerState without "me"/"crowd", plus:
{ "pin": "482913", "topic": "…", "settings": {…}, "skipped": 0,
  "roster": [{ "player_id", "name", "look", "dmg", "right", "streak", "frozen", "joined_at", "answered": true }],
  "answered_ids": ["uuid"],                           // during open
  "final": { "won": true, "accuracy_pct": 69 },     // podium
  "result": { …PlayerState.result without own fields (correct, none, dmg, thawed, frozen)…,
              "hits": [{ "player_id", "dmg", "hp_after" }], "frozen_now": ["uuid"], "thawed": ["uuid"] } }

// Review
{ "items": [{ "qi": 0, "text": "…", "options": ["…"], "key": 2, "choice": 1, "correct": false }] }

// Only where a question is of a new kind or the game has teams (every other answer is exactly as before):
"question": {…, "kind": "multiple", "multi": 2}  |  {…, "kind": "short", "options": []}
"result":   {…, "keys": [0, 2]}  |  {…, "forms": ["Москва"], "tops": [{"text": "питер", "n": 2, "ok": false}]}   // closed only
            // + PlayerState: "picks": [2], "share": 0.5  |  "typed": "Питер"
"me":       {…, "picks": [2]}  |  {…, "typed": "Питер"};  {…, "team": 1}
"teams":    [{"team": 2, "players": 3, "dmg": 912, "avg": 304.0, "place": 1}, …]      // by place, from the lobby on
"roster": [{…, "team": 1}], "top": [{…, "team": 1}], "settings": {…, "teams": 2}
// A number question (20261102090100_live_numbers.sql):
"question": {…, "kind": "number", "unit": "м", "options": []}                     // unit null: none
"result":   {…, "forms": ["42"], "tolerance": 0.5, "unit": "м", "tops": [{"text": "41.6", "n": 1, "ok": true}]}
            // + HostState: "spread": [["41.6", 1], ["42", 3], ["43", 1]]   + PlayerState: "typed": "41,6 м"
"me":       {…, "typed": "41,6 м"}
// A number played as ranges (20261102090200_live_ranges.sql), a movement round's question:
"question": {…, "kind": "number", "unit": "м/с", "ranges": true, "options": ["меньше 300", "300–400", "400–500", "больше 500"]}
"result":   {…, "key": 1, "counts": [3, 17, 2, 1], "ranges": true, "forms": ["343"], "tolerance": 10, "unit": "м/с"}  // + "keys"
// the room: q {…, "ranges": true, "unit": "м/с"}; res {…, "num": {"forms": ["343"], "tolerance": 10, "unit": "м/с"}}
// Review items: + "kind", "keys", "picks", "share" | "kind", "forms", "typed" | "kind", "forms", "tolerance", "unit",
// "typed" (+ "ranges", "keys" for ranges; "choice" is the range stood on); + "explanation" when the item has one
// (correct: the close's verdict — the exact set, a right zone, a right text)
```

## 9. Telegram (function `telegram`)

`POST /telegram/game/join` — body `{"init_data": "<raw>", "pin": "482913", "look": Look | null, "name"?: "…"}` (also
through the site's `/sb/`; `name` = what the player typed, else the Telegram first name). Same checks as `/webapp/session`:
HMAC, `auth_date` ≤ 1 h, CORS, limits 120/min per address and 20/min per Telegram user. Then the function makes the player
token and calls `bot_live_join(p_pin, p_tg_user_id, p_name, p_look, p_token_hash, p_init_hash, p_auth_date)` (service role):
one use per launch (`bot.webapp_uses.purpose = 'game'`) — spent only by a join that worked, and the same launch may rejoin the
game it joined (a lost answer can be retried); 30 joins an hour per Telegram user. 200 with `status`:
`joined` (+ JoinResult fields + `"token"`, given once), `invalid`, `stale`, `replayed`, `slow_down`, `not_found`, `full`,
`ended`, `members_only`, `kicked`, `name_refused` / `look_refused` (+ `"reason"`: `length` | `rude` / `unknown_part` |
`locked`). Protocol errors: 400, 403 (Origin), 405, 413, 429, 5xx.

`POST /telegram/game/post` and `POST /telegram/game/sync` — called by the DB only (`pg_net`, header `x-meldy-live` =
HMAC-SHA256(bot token, `meldy:live:v1`), which `POST /telegram/setup` stores with `bot_live_setup`), body `{"game_id"}`; 202
at once, the work after the response. `post` follows the author's `live_tg_post`: `bot_live_post` → the post (sound on) →
`bot_live_posted(game, chat, message_id)`. `sync` follows the game's state changes: `bot_live_sync` → an edit of that
message (+ the final post once at the podium). Neither route is on the `/sb/` allowlist.

Mini App: `t.me/Meldyteach_bot/play?startapp=<PIN>` → `/tg/play`; `start_param` = 6 digits → join; `r_<game uuid without
dashes>` → review. Needs @BotFather `/newapp`, short name `play`, URL `https://ludosiel-studyforge.hf.space/tg/play` (owner).
`bot.config.flags.live_direct = false` until then.

**Bot texts** (HTML, `protect_content: true`, link previews off):
- Post (sound on):
  `<b>Игра по тесту «{title}»</b>` / `Битва с монстром · {q_count} вопросов` / `Ведёт {host} · PIN {pin}` / `Играют {n}`;
  one URL button `Играть` (`style: "primary"`) → `https://t.me/Meldyteach_bot/play?startapp={pin}`; with `live_direct = false`
  → `https://t.me/Meldyteach_bot?start=play_{pin}` (private chat answers with a `web_app` button «Играть» → `/tg/play?pin={pin}`).
  `{host}` = the author's profile name; without one the line is `PIN {pin}`.
- Edits of the same message (silent): lobby — last line `Играют {n}`; question — `Идёт игра · вопрос {i} из {q_count}` /
  `Играют {n} · у Дедлайна {hp_pct} %`; end — `Игра закончилась`, keyboard removed.
- Final post (new message, silent): `<b>Дедлайн повержен</b>` or `<b>Дедлайн победил</b>`; with `chat_names` the top three
  `1. {name} — {dmg}`; then `Верных ответов {pct} %. Свой разбор — у каждого в игре.`; URL buttons `Разбор` →
  `…/play?startapp=r_{game}` and `Ещё игра` → the exam page on the site.
- «Встань на ответ» (`mode: "stand"` in the facts, migration `20261023090000_live_stand_phone.sql`; without it the
  battle's lines): post `<b>Встань на ответ</b>` / `Игра по тесту «{title}». {q_count} вопросов.` / `Заходите по PIN
  {pin}.` / `Ведёт {host}.` / `Играют {n}`; a question's edit `Идёт вопрос {i} из {q_count}.` (no HP); the end `Игра
  окончена.`; the final `<b>Игра окончена. На первом месте {name}</b>`, with `chat_names` the top three
  `1. {name}, {pts} очков`, then `Верных ответов {pct} %. Свои ответы каждый посмотрит в игре.`; the same buttons.
- Cadence (kept by the database): the DB calls `/game/sync` on `countdown`, `reveal`, `podium` and `ended` (once per state
  and question) and on lobby count changes at most every 5 s; `bot_live_sync` allows one edit per 3 s per message (lobby
  5 s; the end after 1 s); ≈ 2–3 calls per question — under 20 per minute per group and 1 per second per chat. A 429
  skips that edit (no wait); the next state's edit carries the latest text. Keys and per-question correctness are never
  in the chat.
- The texts are W3's `supabase/functions/_shared/bot/live.ts`, implementing `LiveTexts` of `game.ts`:
  `post(facts: LivePost, links)`, `edit(facts: LiveNow, links)`, `final(facts: LiveFinal, links)`, each returning `Out`
  (`{text, keyboard}` of `tg.ts`); `game.ts` holds `liveTextsStub` with the lines above until then
  (`supabase/functions/telegram/index.ts` passes the texts to `createGame`).

## 10. Characters and wardrobe

- Parts (ids are stable; Russian names in `components/live/art/parts.ts`):
  - body: `round` Круглый, `square` Кубик, `drop` Капля, `bean` Боб, `cloud` Облачко;
  - colour: `blue` `yellow` `green` `pink` `sky` `orange` `violet` `teal`, locked: `graphite` (best streak ≥ 5 in a game),
    `snow` (5 games won);
  - eyes: `round` `dots` `one` `sleepy` `glasses`;
  - hat: `none` `cap` `beanie` `phones` `flower` `antenna` `bow`, locked: `crown` (place ≤ 3 with damage > 0), `grad`
    (10 games played), `horns` (3 thaws in one game).
- Expressions (client only): `idle`, `happy`, `hurt`, `frozen`.
- First look: deterministic from the name (`rules.defaultLook`). Validation server-side: unknown id → `ML007/unknown_part`;
  locked and not unlocked → `ML007/locked`.
- Wardrobe table `live_wardrobe (owner_kind 'user'|'tg', owner_key text, look jsonb, unlocked text[], games int, wins int)`.
  Signed-in or linked players: `user`; Telegram guests: `tg`; web guests: none (free parts only, nothing saved).
  Unlocks are computed at `podium` and listed in `final.unlocked_now`.

## 11. Limits and caps

- 300 players a game (`ML001`); 3 open games per author (`ML009`; podium and ended do not count); 3–30 questions; names
  1–24 chars after trim, rude words matched per word (`ML006`; the rule and its cases: `rules.ts` `checkName` and
  `contracts/live/name_cases.json`, the same in SQL); one answer per player per question (pk; second → `ML004/twice`).
- `live_join`: 120 a minute per address (`meldy_private.quiz_ip_hash()`: a class behind one school NAT, a hall on mobile
  data), 120 a minute per game → `ML005/join`, 429 with `Retry-After`. `live_pin` reports the same limits as data
  (`refused`, `http` 429, `retry_after`) and counts nothing itself; a wrong PIN is refused before any limit, as by `live_join`.
- `live_create`: 10 an hour per author → `ML005/create`. `live_tg_post`: one post a minute per game → `ML005/post`.
- PIN: 6 digits, unique among games not `ended`; joins refused 3 h after create (`ML002/expired`).
- `/telegram/game/join`: as `/webapp/session` (120/min/address, 20/min/Telegram user, 30 joins/hour/Telegram user in the DB).
- The server's numbers are rehearsed in `supabase/tests/local/live_game_run.sh` (migration `20261021090000_live_game.sql`);
  `real.ts` runs end to end against it through PostgREST (`frontend/src/lib/live/real.e2e.test.ts`).
- Host can kick (`live_kick`): the player's token stops working (`42501/kicked`); their damage stays in the total.

## 12. Client flag

`frontend/src/lib/live/api.ts` `liveApi()` returns the fake in-memory server when `import.meta.env.VITE_LIVE_FAKE === '1'` or
`localStorage['meldy.live.fake'] === '1'` or the URL has `?fake=1`; otherwise the real client. Both implement `LiveApi`
(`types.ts`). The fake fills the game with bots and can act as its own host (`autoHost`), so the player screens work alone.
It also plays a mixed battle (`stand_every`, `MODE_MIXED.md` §8): its movement rounds close as void, since the fake has
no room.

## 13. Teams (20261102090000_live_kinds_teams.sql)

- `settings.teams`: 0 (none, the default), 2, 3 or 4 (`live_games.teams`; anything else `22023 teams`). The setup
  offers «Команды: нет / 2 / 3 / 4» for a battle (with or without movement rounds).
- A player gets a team on join (`live_players.team`, the trigger `live_players_team`): the team with the fewest players
  not kicked, the lower number on a tie; one game's joins take their teams in turn. A rejoin keeps the team; nobody is
  moved later (a kick leaves a gap the next join fills).
- A team's score is the **average** points (damage) of its players not kicked, so a team of 3 and a team of 4 compare
  fairly; the place is by the exact average, then the points, then the number. `teams` in every state of a game with
  teams (§8), the average with one decimal.
- Screens: the names and colours «Красные» `#ef5b4c`, «Синие» `#2f74e8`, «Жёлтые» `#f2b928`, «Зелёные» `#2fa866`
  (`stand/copy.ts` `TEAM_NAMES`, `TEAM_COLOURS`). The projector: a ring of the team's colour round each character's
  feet and its name tag in it, the teams' counts in the lobby, the teams with their best player on the leaderboard,
  the teams on the podium blocks and the game's best player. The phone: «Ваша команда: Синие» in the lobby, the
  teams over the five best on the leaderboard, «Синие победили. В среднем 312 урона на игрока.» at the end. Ranking,
  the five best and the wardrobe stay per player.

## 14. «Тренировать ошибки» (`live_practice`)

- The phone's review (podium, ended; 7 days) ends with «Тренировать ошибки». `live_practice(game, token)` needs the
  session (`28000` otherwise) and the token of a player of the game (`P0002 token`, `42501 kicked`).
- Who: the exam's author or an active member; else, when the game was made from a quiz whose author offers practice
  (`quizzes.offer_practice`, release 47's «Повторить эти вопросы») and no quiz of the exam is open, the player joins
  the exam as `quiz_practice_join` makes a member; anyone else `ML012 practice`.
- What: every closed question of the game drawn from an item still in the exam that the player got wrong or partly, or
  left without an answer while playing it (not a void movement round), is recorded once as this user's answer of today
  through the study core (`meldy_private.record_test_answers_for`, source `web`): the same row and rule step as a
  wrong answer on the site, so «Повторить ошибки» brings them back. `client_event_id` = `live:<game>:<qi>`: a second
  press records nothing twice (`saved` counts both). The answer goes as the player gave it: the options (file
  indexes), the text of a text or a number question, or none (`dont_know`). A number played as ranges and missed goes
  as «не знаю» (`text: null`): the player stood on a range and typed no number, and the study core grades a number item
  by a typed text only — inventing one (the range's middle) would record an answer the player never gave.
- The phone: «Готово: 3 вопроса в тренировке экзамена.» and «Открыть экзамен»; a guest (no session) is asked to sign
  in («Войти и тренировать») and comes back to `/play?r=<game>&practice=1` — the token stays in the tab — where it runs
  by itself; in Telegram there is no site session: the line says to play from the site with an account.

## 15. Screens of several right answers, text answers and numbers

- **Phone, several right answers** (`player/Battle.tsx`): «Верных: 2 — отметьте все» over the options; a tap ticks or
  unticks an option (a check on white, `aria-pressed`); «Ответить» sends the set (`live_submit` `picks`) once; at the
  phone's own zero what is ticked goes by itself. The sheet: «Верно», «Частично верно» with the damage and «Верных
  отмечено: 1 из 2, лишних: 0», or «Неверно» with «Верные ответы: А · …, В · …»; every right option is marked.
- **Phone, a text answer**: a field and «Ответить» where the options would be (`live_submit` `text`, trimmed; at zero
  what is typed goes by itself); the sheet says what was typed, «Верный ответ: …» and «Чаще писали: «питер» 2 раза, …».
- **Projector** (`stand/BattleHost.tsx` TapBoard): «Верных: 2 — отметьте все» on the board; the reveal names every
  right option («Верные ответы») and marks each with its count; a text question shows «Напишите ответ на телефоне»,
  then the accepted answer big and «Чаще писали» with the three answers and their counts (the right ones ringed in
  green). The flat screen (no WebGL) and the teacher's «Разбор» mark every right option and the accepted forms.
- **Review on the phone** (`player/ReviewScreen.tsx`): each question with the own answer (ticks, text), every right
  option or the accepted forms, «Частично» for a share, the author's explanation («Пояснение»), then «Тренировать
  ошибки» (§14).
- **Setup** (`pages/live/LiveSetupPage.tsx`): its preview counts questions of several right answers and text answers as
  played (a text answer not in «Встань на ответ»: `source.ts` `kindSkip`), and offers «Команды».
- **Phone, a number** (`player/NumberPad.tsx`): a keypad where the options would be — the number as typed with the
  question's unit after it, 0–9, «,» (a first comma writes «0,»), «−» (turns the sign over), «⌫», «Ответить»
  (`live_submit` `text`, only when it reads as a number); the phone's own keyboard never opens; at the phone's zero a
  number typed goes by itself. The sheet: «Вы ввели: 41 м», «Верный ответ: 42 ± 0,5 м», «Ближе всех: 42 м — 2 раза,
  …». Numbers are said the Russian way (`lib/live/numbers.ts`: «3,14», «−12», «12 500»).
- **Projector, a number** (`stand/BattleHost.tsx`, `stand/NumberLine.tsx`): «Введите число на телефоне» and «Ответ в м»
  on the board; at the reveal the right number with its tolerance and unit, and under it «Ответы класса»: a number
  line with the right value's green pin and its tolerance band, a stem per value typed (its height the count, green
  inside the band, coral outside; the wild answers counted at the ends, «← 2»), then «Ближе всех» with the three
  nearest and their counts. The line covers the bands and the middle 80 % of the answers. The flat screen
  (`host/Panel.tsx`) shows the key and the same line; the teacher's «Разбор» says «Верный ответ: 42 ± 0,5 м».
- **Review on the phone**: «Вы ввели: …» and «Верный ответ: …» with the tolerance and unit; «Тренировать ошибки» sends a
  number mistake with the own text (the study core grades it by the same rule).
- **Ranges** (`20261102090200_live_ranges.sql`): the round's board and the phone's card say «Встаньте на промежуток с
  ответом» over the four ranges; at the reveal the right range is named with the true value under it («Ответ: 343 ±
  10 м/с»: the room's `num`, else the database's result), and on the phone beside the right range. The flat
  projector shows the ranges as tiles and the value under them. The phone's review: «Вы стояли на 400–500 · верный
  ответ 343 ± 10 м/с» and «Верный промежуток: 300–400» when missed.
- Release order: the site and the Space first (they read the new keys and run without them), then the migration.
  For the ranges: 20261102090100, then the site and the Space (the room forwards `ranges`, `unit`, `num`), then
  20261102090200. For the numbers: 20261101090000 (live) and 20261102090000 first, then the site, then 20261102090100.
