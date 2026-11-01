# «Дуэль» — contract (release 50, phase 3)

Migration `supabase/migrations/20261106090200_live_duel.sql`; rollback `supabase/rollback/20261106090200_live_duel_down.sql`;
contract check `supabase/tests/live_duel.sql`; behaviour `supabase/tests/local/live_duel_behaviour.sql`, rehearsed in
`supabase/tests/local/live_game_run.sh` (the duel stage, after the challenge's). The TypeScript mirror is `frontend/src/lib/duel/`
(`types.ts` the shapes, `rules.ts` the numbers and the polls; the rehearsal checks `rules.ts` against the duel's close and
against the challenge's `live_run_score` in phase 0 on a grid of 576 answers, and the winner on 144). Where this file and
the code disagree, fix one of them in the same commit.

Two people play the same questions at the same time, each from their own phone or computer, by an invite link
`/d/<code>` with a QR code. The invited one needs no account: a name and a character, as in the challenge. One server
clock for both; the battle's points for each seat; no boss — head to head. After each question both see the key and
both answers; at the end «Победа», «Поражение» or «Ничья», the review with both answers, «Тренировать ошибки», and
«Ещё раз» for another round.

## 1. Why new tables

- A live game is a host-driven room for a class; a challenge run is one person alone on their own clock. A duel has
  two seats on one clock, settled lazily by whichever seat calls (§4).

## 2. Tables (public, row security on, no policy, nothing granted to anyone — service_role included)

| table | one row is | key columns |
|---|---|---|
| `live_duels` | a duel (a round of a match) | `code` (12 chars of `meldy_private.random_code`, unique), `owner_id` (the signed-in creator, null for a guest), container (+ quiz), `source` `container`/`quiz`/`challenge`/`game` with `source_id` (the challenge or the game) and `source_ref` (the run or the player whose token made it), `subject_ids` (a container source: a rematch draws again), title, `time_s` 10/20/30, `speed`, `calm` (calm ⇒ not speed), `q_count` 1–30, `stage` `lobby`/`play`/`wait`/`final`, `qi`, `rev`, `started_at`, `wait_from`, `ended_at`, `end_reason` `done`/`left`/`gone`/`expired`, `winner` (the seat or null), `round` 1–20, `parent_id`/`next_id` (the match), `draws` |
| `live_duel_seats` | a seat (1 the creator, 2 the invited) | `id` (never sent: each seat's order of the options is drawn from it), `token_hash` (sha256 hex; unique per duel), `user_id` (one seat an account in a duel), name 1–24, look, `seen_at` (the last call: presence), `ready_at`, `next_qi`/`next_at` («Дальше»), `rematch_at`, the battle's numbers (dmg, right_n, streak, best, frozen, thaws, time_ms), `wins` (the match's before this round) |
| `live_duel_questions` | a question, frozen at create | `live_challenge_questions`' columns in its order (kind `single`/`multiple`/`short`/`number`, text, options, shown, key, keys, forms, tolerance, unit, explanation, keep_order, item_rev), then `shown_at`, `opens_at` = shown + 3 s, `closes_at` = opens + time_s, `closed_at` |
| `live_duel_answers` | a seat's answer of a question | primary key (seat, qi); `at`, the answer in the question's order (choice / picks / typed), `elapsed_ms` by the server's clock; at the close `settled_at` and the result (correct, share, dmg, thawed, frozen). A seat without an answer gets its row at the close (none) |
| `meldy_private.live_duel_hits` | a guest's create or a join from an address | HMAC of the address (`quiz_ip_hash`), kind, a day kept |

Where the questions come from (the server builds the list; the client never sends an item id):

- the signed-in author's own test or exam (`{container_id, subject_ids, count 3–30}`) or quiz (`{quiz_id}`), owner checked;
- `{challenge: <code>, token: <the run's token>}` — the questions that run was shown, copied from the challenge's frozen
  `live_challenge_questions` (never the item as it is now), once the challenge is over (`live_challenge_over`, else
  `ML004 not_over`) and until 7 days after `live_challenge_end_at` (`ML002 expired`); the run finished (`ML004 not_done`)
  and not taken off (`42501 removed`);
- `{game: <id>, token: <the player's token>}` — the game's closed questions, copied from its frozen `live_questions` rows,
  at its podium or after its end (`ML004 not_over`), until 7 days after (`ML002 expired`), the player not kicked
  (`42501 kicked`). An item edited after the game was made gets `item_rev` 0: «Тренировать ошибки» calls it stale.

Not played (as the challenge): a question with a picture, order, match, cloze, essay.

## 3. The numbers (the battle's phase 0 for each seat: `meldy_private.live_duel_points`)

- Grading: the challenge's `meldy_private.live_challenge_share` (ticks by `live_share`, a number by
  `meldy_number_right`, a text by the normal forms, a tap by the key).
- Share 1: `live_damage(elapsed, time_s, streak + 1, speed)` («Без спешки»: 100), streak + 1; a frozen seat thaws
  instead (no points, streak 1). Share between 0 and 1: `round(points × share)` (0 while frozen), streak 0, no freeze.
  Share 0: streak 0, frozen (not in «Без спешки»). No answer: streak 0, nobody freezes for it (the battle's phase 0).
- `elapsed_ms = clamp(at − opens_at, 0, time_s × 1000)` by the server's clock; `time_ms` adds it, or the whole time.
- **The winner**: more points, then more right answers; otherwise a draw. Time decides nothing beyond the points.
  The disconnect rules (§4) can decide instead.

## 4. The timeline and the disconnect rules (`meldy_private.live_duel_settle`)

Every call of a seat locks the duel's row and settles it lazily: a bounded loop of what is due, at most one question
shown a call. Decisions at this moment count the calling seat as here; the end of a wait is judged by the seats'
calls before this one. **Presence**: a seat is here when its last call is at most **20 s** old (the slowest poll is 3 s,
5 s after the end, and its back-off on a 429 at most 9 s: polling alone never reaches 20 s).

1. **Lobby.** Both seats press «Готов» while both are here → the first question shows **2 s** later. The invited seat is
   freed after **2 minutes** away (never the seat that is calling). An unstarted duel expires a **day** after its
   create (`expired`, no winner).
2. **A question.** Its text comes at `shown_at` (until then the state has only the times); 3 · 2 · 1; the answers open at
   `opens_at`. It closes when both answered (at the second answer), or at `closes_at` + **1.5 s**. The clock never stops
   inside a question: a seat away answers none.
3. **The reveal** lasts **7 s**, **14 s** with an explanation; when both press «Дальше» it ends at once. Then the last
   question ends the duel (`done`); the next shows when both are here.
4. **The wait.** A seat away when the next question is due: the duel waits up to **60 s** (from that moment). Back in
   time: the next question shows. Still away: the one who stayed wins whatever the score (`left`); both gone: no winner
   (`gone`).

## 5. Who sees what

| data | the seat (own token) | anyone with the link |
|---|---|---|
| the title, the settings, the stage, the names and looks of the seats, whether the invited seat is free | yes | yes (`duel_info`) |
| a question's text and options | from its `shown_at`, in the seat's own order | never |
| the own answer | yes (no verdict before the close) | never |
| the other seat's answer to an open question | only «answered» | never |
| a question's key, forms, explanation, both answers and points | only once that question closed; the other seat's typed text masked when the live game's filter of names (`live_name_rude`) would not show it — the writer's own view keeps it | never |
| the review (both answers of every closed question) | once the duel is over | never |
| tokens, hashes, seat ids | never | never |

Each seat sees the options in its own order (`meldy_private.live_run_perm` of the seat's id, which is never sent): the
question's options, the own answer, the other seat's picks, the key and the review are all mapped into it; answers come
back to the question's order before they are kept.

## 6. RPC (PostgREST `rpc/…`; SECURITY DEFINER, `search_path = ''`, for `anon` and `authenticated`; refusals by `meldy_private.live_fail`)

The public functions are `duel_*`, not `live_*` (the older contracts count the public `live_*`); the private helpers are
`live_duel_*`, revoked from everyone. The token (43 base64url characters, 256 bits of `crypto.getRandomValues`, made on
the device and kept in localStorage `meldy.duel.<code>`) goes in the POST body, never in an address; the server keeps its
sha256 and never returns either. Every seat's call checks the token's shape first (`P0002 token`), finds its seat
before it locks the duel (a wrong token never holds the lock), then settles.

- `duel_create(p_source, p_settings, p_name, p_token, p_look) → DuelState` — the sources of §2; settings `time_s`, `speed`,
  `calm` (a challenge's or a game's own by default). The name (`ML006`), the look (`ML007`), no playable question
  (`ML008`, details the skipped), the limits (§8) — all checked before old duels are cleaned up (90 days after create)
  and before anything is written.
- `duel_info(p_code) → {code, title, q_count, time_s, speed, stage, round, players: [{seat, name, look}], full, now}` (+ `calm`).
- `duel_join(p_code, p_name, p_token, p_look) → DuelState` — the own seat back by this token, or by the signed-in account
  (the same account on another device takes the same seat over: its new token replaces the hash, the old device gets
  `P0002 token`). A new seat: only the invited one, refused before any lock or write while it is taken (`ML001 full`; a
  seat away 2 minutes in the lobby counts as free) or the duel is over (`ML002 over`); the joins' limits (§8).
- `duel_state(p_code, p_token, p_rev) → DuelState | {unchanged: true, rev, now, stage, other: {present} | null}` — the poll.
  The rev is twice the duel's rev, plus one once the current question's text is out (it appears by the clock).
- `duel_ready(p_code, p_token)`, `duel_next(p_code, p_token, p_qi)` («Дальше»; an older question's press changes nothing,
  one not closed is `ML004 bad_qi`), `duel_rematch(p_code, p_token)` (§9) → DuelState.
- `duel_answer(p_code, p_token, p_qi, p_answer) → DuelState` — `live_submit`'s shapes; `ML004 early|late|twice|bad_qi|kind`,
  `22023 answer`; once a seat and question (the primary key and the check under the lock). No verdict of its own: the
  second answer closes the question, so the state it returns is the reveal.
- `duel_review(p_code, p_token) → {items}` — a finished duel only (`ML004 not_done`): `live_review`'s item shape for the own
  answer, `other` for the other seat's.
- `duel_practice(p_code, p_token) → {container_id, joined, saved, mistakes}` — §10.

```jsonc
// DuelState
{ "now": "…", "rev": 17,
  "duel": { "code", "title", "q_count", "time_s", "speed", "stage", "qi", "round", "path", "url", "expires_at", "wait_until" }, // + calm
  "me": { "seat", "name", "look", "dmg", "right", "streak", "best", "frozen", "ready", "next", "rematch" },
  "other": null | { "seat", "name", "look", "dmg", "right", "streak", "frozen", "ready", "present", "answered", "next", "rematch" },
  "question": null | { "qi", "soon": true, "shown_at", "opens_at", "closes_at" }
                   | { "qi", "text", "options", "shown_at", "opens_at", "closes_at" /* + kind/multi | kind | kind/unit; + closed_at, reveal_until */ },
  "answer": null | { "choice" | "picks" | "typed", "elapsed_ms" },
  "result": null | { "qi", "key" /* + keys | forms | forms/tolerance/unit; + explanation */,
                     "me": Side, "other": Side },   // Side: correct, none, dmg, thawed, frozen, elapsed_ms, share, choice | picks | typed | masked
  "track": [{ "qi", "me": "right|part|wrong|none", "other": "…", "me_dmg", "other_dmg" }],
  "final": null | { "reason": "done|left|gone|expired", "ended_at", "winner": "me" | "other" | null },
  "rematch": null | { "me", "other", "code", "round", "possible" },
  "match": { "round", "me", "other", "draws" } }
```

## 7. The polls (the site, `components/duel/controller.ts`; `lib/duel/rules.ts`)

- Every **1 s** while something is timed (a question, its reveal, a wait), **1.5 s** in the lobby, **3 s** after the end;
  plus a call exactly when the server's clock says something is due (the text, the end of the time and its grace, the
  reveal's end, the wait's end).
- On the `/sb` route (`lib/supabaseRoute.ts`: the browser reaches Supabase through the site) the proxy lets **600
  anonymous calls a minute per address** through (`backend/supabase_proxy.py`, unchanged), shared by everyone behind one
  NAT: there a device polls about every **3 s** while timed and in the lobby and **5 s** after the end, the due calls
  still on top, and backs off on a 429 by 3 s more each time, at most 9 s.
- Honest numbers: a guest's duel on the `/sb` route costs about 20–25 calls a minute (the polls, the due calls, the
  presses). One classroom address therefore carries about **24 guests in duels at once** (12 duels) within the 600; more
  get 429s, slow down, and still count as here (20 s). Signed-in players are counted by their session, not the address.
  On the direct route the polls are about 60 calls a minute a device and Supabase's own limits apply.
- Both pressed «Ещё раз»: the device moves to the next duel — after every state and on the start, so a reload after both
  pressed lands there; the final shows a plain link to it.

## 8. Limits

- Creates: **20 an hour** and **20 unfinished** duels an account (`ML005 create` 429 + Retry-After; `ML009`). A guest:
  **120 an hour per address** (a class behind one NAT creates with room to spare); a signed-in person is never refused
  because of other people on their address. A rematch counts against the hourly limits (the account that made the
  match, else the address of the press). Unfinished: a lobby, or a duel a seat called in the last 2 minutes.
- Joins of the invited seat: **120 a minute** per address (the live game's join throttle) and **300 a day**
  (`ML005 join` 429 + Retry-After). Taking a seat back counts nothing.

## 9. «Ещё раз»

Both must press it; the second press makes the next round: the same seats with new ids (the same tokens, names, looks;
`wins` carried), the same settings and source. An author's test or quiz draws again with the questions no round of the
match played first; a fixed set (a challenge's or a game's questions) is the same set reshuffled. At most **20 rounds**
(`ML004 rounds`). The final and the next lobby show the match's score.

## 10. «Тренировать ошибки» (`duel_practice`)

As `challenge_practice` (CHALLENGE.md §5): the session's account (`28000`); a finished duel (`ML004 not_done`), never one
that expired unplayed and never more than 7 days after its end (`ML002 expired`); a seat with a closed question. The
exam's author or an active member records at once. Anyone else is made a member — which lets them read every key of the
exam — **only** with a standing of their own:

- (a) the duel is the exam author's own (its owner owns the exam), or
- (b) in the source, within its window: their own finished, not removed run of that challenge until 7 days after its
  end; their own player in that game, not kicked, until 7 days after it; or their own finished attempt of the quiz (as
  `quiz_practice_join` asks). «Own» is by the account, or the run or player whose token made this duel when the caller
  holds its first seat;

and then only through a quiz that offers practice with no quiz of the exam open (`ML012 practice|open|removed|full`).
Without that right nothing is written to `container_members` (`ML012 practice`). The behaviour file plays the attack the
review found: a guest makes a duel from an old run, a stranger signs in and takes the second seat, the lobby expires,
the stranger asks for practice — refused, no membership.

Wrong, partial and unanswered questions go through `meldy_private.record_test_answers_for` (source `web`,
`client_event_id = ld:<duel>:<seat>:<qi>`: once) with the frozen `item_rev`: an item whose key changed since is `stale`,
never graded by the new key.

## 11. Screens

- **The duel** `/d/<code>` (`pages/duel/DuelPage.tsx`, `components/duel/`): the invite (who calls, the rules, «Принять
  вызов»), the live player's character builder, «Места заняты» for a third device, the lobby (the link, the QR,
  «Скопировать ссылку», «Готов», who is ready and here), the question (the board with both characters facing each other,
  both names, scores and a track per question; the timer bar; the A–Е buttons, ticks, text field or keypad; «ответил»),
  the reveal under the question (both verdicts and points, the marks of who picked what, the key, the explanation,
  «Дальше», the seconds left), the wait, the final («Победа» / «Поражение» / «Ничья», the cards, the match, «Разбор и
  ошибки», «Ещё раз», «Выйти»), the review (both answers, «Тренировать ошибки»; a guest signs in and comes back to
  `/d/<code>?practice=1`). Dark and light themes; checked at 1532×734, 1024 and 390 wide.
- **The setup** `/live/duel?c=<test>` | `?ch=<challenge code>` | `?g=<game>`: the time, «Без спешки», how many (a test),
  then the name and the character, «Создать дуэль» → `/d/<code>`.
- **Entries**: «Дуэль» on `/games` (the same picker as the game's) and on the test's page beside «Соревнование по
  ссылке»; «Дуэль на этих вопросах» on a challenge's final once the challenge is over, and under a finished live game's
  personal review.

## 12. Release order

The migration first: it only adds (four tables, the throttle, `duel_*` and `live_duel_*`), and nothing calls it yet.
Then the site. The Space has nothing to change (the `/sb` proxy passes every `rest/v1` call). No Edge Function. The
migration and the rollback set `lock_timeout` to **2 s** for their transaction: a lock held by a busy game makes the
apply fail and be tried again, never queue the site's queries behind it.
