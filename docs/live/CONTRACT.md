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

## 4. Questions

- Plays items with exactly one correct option. A battle without movement rounds (`mode = 'boss'`, `stand_every = 0`)
  takes 2–6 options and pictures (since 20261030090000_live_pictures.sql, 30.10: real tests have five options and
  pictures); a stand game and a mixed game take 2–4 options without pictures (the arena has four zones and draws no
  pictures). The rest are skipped and counted in `skipped` at create: for a контрольная, of its draw; for subjects, of
  the subjects' keyed questions. At most 30 are played. The setup screen switches the mini-game off by itself for a test
  that is mostly such questions and says why (LiveSetupPage).
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
