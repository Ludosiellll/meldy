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
- `rev` (bigint) increases by 1 on every state change and on roster change in `lobby`. Answers do **not** change `rev`
  (they would flood Realtime); the host polls the answered count (§6).
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
  Rounding: half up (all values are positive; SQL `round(numeric)` = JS `Math.round`).
- **Streak:** right → +1 (a thaw sets it to 1); wrong or no answer → 0. `best = max(best, streak)`.
- **Freeze:** a wrong answer freezes the player. A frozen player's right answer thaws them: `dmg = 0`, `streak = 1`,
  `thaws += 1`. A frozen player's wrong answer: stays frozen. No answer: freezes only when the question's phase ≥ 1.
- **Boss HP:** at the first `countdown`: `hp_max = players × q_count × 55`; a player joining later adds
  `55 × questions not yet opened` to `hp_max` and `hp`.
- **Phase** (only goes up): `0` while `hp > ⅔ hp_max`, `1` when `hp ≤ ⅔`, `2` when `hp ≤ ⅓`. Each question keeps the phase it
  opened with (`q_phase`) — the rules shown at countdown apply to it.
  - phase 1 «Дедлайн злится»: no answer also freezes;
  - phase 2 «Последняя минута»: after the hits, if `right < ceil(⅔ × active players)` and the boss is alive, it heals
    `round(0.05 × hp_max)` (never above `hp_max`; the phase stays 2).
- **Close order:** answers sorted by `elapsed_ms`, then `player_id`. Each hit lowers `hp` (floor 0) and records `hp_after`.
  Every right answer counts for the player even after the hit that kills; the host stops the animation at the first `hp_after = 0`.
- **Defeat:** `hp = 0` at close → `defeated = true`, `won = true` → podium after reveal. Questions over with `hp > 0` → `won = false`.
- **Ranking:** `dmg desc, right desc, best desc, joined_at asc`. `move` in the top five = previous place − current place
  (previous = after the last question; 0 for a new entry).
- **Accuracy** on the podium: `round(100 × right answers / (players × questions asked))`.

Reference cases (also in `rules.test.ts`): `T = 20 s`, `elapsed 900 ms`, streak 0 → 98; `elapsed 0`, streak 4 → 200
(`mult 2`); `elapsed 20000`, streak 0 → 50; speed off, streak 1 → 125.

## 4. Questions

- MVP plays only items with exactly one correct option and 2–4 options (text or code; pictures shown as in the quiz page).
  The rest are skipped and counted in `skipped` at create.
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
  'live:' || topic, false)` on every `rev` change (function `meldy_private.live_bump`).
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
  Telegram also fills `user_id` from `bot.links`), `guest_hash` (web guest). One player per identity per game: joining again
  returns the same player (new token replaces the old hash).
- Tokens die with the game: answers stop at `ended`; `live_review` accepts the token for 7 days.

## 8. RPC (PostgREST `rpc/…`; all SECURITY DEFINER, `search_path = ''`, RLS on the tables with no policies)

Errors: SQLSTATE in the body's `code`. Our refusals `ML0xx` → HTTP 400. «Not found» uses the PostgREST status override
(Codebase_Map, release 47): `raise sqlstate 'PGRST' using message = '{"code":"P0002","message":"<what>"}', detail =
'{"status":404,"headers":{}}'` → **HTTP 404**, body `code: "P0002"`. The same pattern gives 409 (`ML011`) and 429 (`ML005`).

| code | HTTP | meaning (`details`) |
|---|---|---|
| `28000` | 401 | not signed in (host create, wardrobe) |
| `42501` | 403 | not the exam's author / wrong host token (`host`) / kicked (`kicked`) |
| `P0002` | 404 | game, PIN or token not found (`game`, `pin`, `token`) |
| `22023` | 400 | bad input; `details` names the field |
| `ML001` | 400 | game full (300 players) |
| `ML002` | 400 | game not joinable (`ended`, `expired`) |
| `ML003` | 403 | members only |
| `ML004` | 400 | answer refused: `early`, `late`, `not_open`, `twice`, `bad_qi`, `not_joined_yet` |
| `ML005` | 429 | rate limit (`join`, `create`) |
| `ML006` | 400 | name refused (`length`, `rude`) |
| `ML007` | 400 | look refused (`unknown_part`, `locked`) |
| `ML008` | 400 | no playable questions (`details` = how many were skipped) |
| `ML009` | 400 | too many open games (3 per author) |
| `ML011` | 409 | state is not `p_expect` (`details` = current state) |

### Host (signed in for create; token afterwards)

`live_create(p_source jsonb, p_settings jsonb) → CreateResult`
```jsonc
// p_source: {"quiz_id": "uuid"}  or  {"container_id": "uuid", "subject_ids": ["uuid"], "count": 6}
// p_settings: {"mode": "boss", "time_s": 20, "speed": true, "who": "pin" | "members", "chat_names": true}
{ "game_id": "uuid", "pin": "482913", "topic": "Q2xz…22", "host_token": "43 chars", "q_count": 6, "skipped": 0,
  "join_url": "https://ludosiel-studyforge.hf.space/play?pin=482913",
  "tg_url": "https://t.me/Meldyteach_bot/play?startapp=482913" }
```
`live_host_state(p_game uuid, p_host_token text, p_since_rev bigint) → HostState | {rev, now, unchanged: true}`
`live_next(p_game uuid, p_host_token text, p_expect text) → HostState`
`live_kick(p_game uuid, p_host_token text, p_player uuid) → {"ok": true}`
`live_end(p_game uuid, p_host_token text) → {"ok": true}`

### Player

`live_join(p_pin text, p_name text, p_token text, p_look jsonb) → JoinResult` (anon or signed in)
```jsonc
{ "game_id": "uuid", "player_id": "uuid", "topic": "…", "state": "lobby", "rev": 3, "now": "…",
  "name": "Дима", "look": {"body": "cloud", "colour": "orange", "eyes": "round", "hat": "phones"},
  "wardrobe": {"unlocked": ["crown"], "games": 4, "wins": 2} }   // wardrobe: null for a web guest
```
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
                "opens_at": "…", "closes_at": "…", "phase": 1, "picture": null },          // null in lobby/podium
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

`POST /telegram/game/join` — body `{"init_data": "<raw>", "pin": "482913", "look": Look | null}`. Same checks as
`/webapp/session`: HMAC, `auth_date` ≤ 1 h, one use per launch (`bot.webapp_uses.purpose = 'game'`, migration adds it), CORS,
limits 120/min per address and 20/min per Telegram user. Then `bot_live_join(p_pin, p_tg_user_id, p_name, p_look,
p_token_hash)` (service role). 200 with `status`:
`joined` (+ JoinResult fields + `"token"`), `invalid`, `stale`, `replayed`, `slow_down`, `not_found`, `full`, `ended`,
`members_only`. Protocol errors: 400, 403 (Origin), 405, 413, 429, 5xx.

`POST /telegram/game/post` — `Authorization: Bearer <author JWT>`, body `{"game_id": "uuid", "chat_id": -100…}`; the chat must be
a group bound to this exam (`bot.groups`). 200 `{"status": "posted", "message_id": 123}`; 403 not the author; 404 group not
bound; 429 more than 1 post a minute per game.

`POST /telegram/game/sync` — called by the DB (`pg_net`, header `x-meldy-live` = HMAC-SHA256(token, `meldy:live:v1`)) on state
changes of a game with a chat message; 202; edits per the cadence below.

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
- Cadence: at most one edit per 3 s per message and only on `countdown`, `reveal` and lobby count changes (lobby: at most every
  5 s); ≈ 2–3 calls per question — under 20 per minute per group and 1 per second per chat. A 429 skips that edit; the next
  state's edit carries the latest text. Keys and per-question correctness are never in the chat.

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

- 300 players a game (`ML001`); 3 open games per author (`ML009`); 3–30 questions; names 1–24 chars after trim, rude-word list
  (`ML006`); one answer per player per question (pk; second → `ML004/twice`).
- `live_join`: 30 a minute per address (`meldy_private.quiz_ip_hash()`), 120 a minute per game → `ML005/join`.
- `live_create`: 10 an hour per author → `ML005/create`.
- PIN: 6 digits, unique among games not `ended`; joins refused 3 h after create (`ML002/expired`).
- `/telegram/game/join`: as `/webapp/session` (120/min/address, 20/min/Telegram user, 30 joins/hour/Telegram user in the DB).
- Host can kick (`live_kick`): the player's token stops working (`42501/kicked`); their damage stays in the total.

## 12. Client flag

`frontend/src/lib/live/api.ts` `liveApi()` returns the fake in-memory server when `import.meta.env.VITE_LIVE_FAKE === '1'` or
`localStorage['meldy.live.fake'] === '1'` or the URL has `?fake=1`; otherwise the real client. Both implement `LiveApi`
(`types.ts`). The fake fills the game with bots and can act as its own host (`autoHost`), so the player screens work alone.
