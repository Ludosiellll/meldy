# «Соревнование в своё время» — contract (release 50, phase 2)

Spec: meldy-notes `10_Project/Test_Builder_Spec_2026-10-18.md`, «Режимы — что решено», item 3. Migration
`supabase/migrations/20261106090100_live_challenge.sql`; rollback `supabase/rollback/20261106090100_live_challenge_down.sql`;
contract check `supabase/tests/live_challenge.sql`; behaviour `supabase/tests/local/live_challenge_behaviour.sql`, rehearsed
in `supabase/tests/local/live_game_run.sh` (the challenge stage). The TypeScript mirror is `frontend/src/lib/challenge/`
(`types.ts` the shapes, `rules.ts` the numbers; the rehearsal checks `rules.ts` against the SQL on a grid of 5184 answers
and a table of 120 runs). Where this file and the code disagree, fix one of them in the same commit.

The author makes a link with a deadline from a test or an exam. Each person plays the same questions alone, whenever it
suits them, with no host and no account. Each answer is graded by the server's time; after each question the person sees
the key and the explanation; at the end their place, their review and «Тренировать ошибки». The table opens by the same
link and fills as people finish. The author closes it early and sees the results on «Игры» and the test's page.

## 1. Why new tables

- `quiz_attempts` keeps no server time per question: no points for speed and no fair table are possible.
- `live_games` is one host-driven state machine with one current question for everybody. A challenge has a current
  question **per person**, each with its own server times.

## 2. Tables (public, row security on, no policy, nothing granted to the API roles)

| table | one row is | key columns |
|---|---|---|
| `live_challenges` | a challenge | owner, container (+ quiz), title, `code` (12 chars of `meldy_private.random_code`, unique), `time_s` 10/20/30, `speed`, `calm` (calm ⇒ not speed), `q_count` 1–30, `skipped`, `deadline` (≤ 31 days after create), `closed_at`, `swept_at` |
| `live_challenge_questions` | a question, frozen at create | as `live_questions`: kind `single`/`multiple`/`short`/`number`, text, options (shown order), shown, key, keys, forms, tolerance, unit, explanation |
| `live_runs` | one person's run | `token_hash` (sha256 hex; unique per challenge), `user_id` (one run per account), name 1–24, look, `qi` (-1 before the first), the battle's numbers (dmg, right_n, streak, best, frozen, thaws), the own boss (hp, hp_max = 55 × questions, phase), `time_ms`, `finished_at`, `removed_at` |
| `live_run_answers` | a question of a run | `opened_at` (the server sent it), `opens_at` = opened + 3 s, `closes_at` = opens + time_s, `phase` (the boss's at open), the answer (choice / picks / typed, `at`, `elapsed_ms`), `settled_at` and the result (correct, share, dmg, thawed, frozen, healed, hp_after, phase_changed) |
| `meldy_private.live_challenge_hits` | a start from an address | HMAC of the address (`quiz_ip_hash`), two minutes kept |

## 3. The numbers (the battle's for one player, `meldy_private.live_run_score`)

- Grading (`meldy_private.live_challenge_share`): ticks by `meldy_private.live_share` against the keys; a number by
  `public.meldy_number_right`; a text by `public.meldy_short_norm` against the accepted forms; a tap by the keys.
- Share 1: `dmg = live_damage(elapsed, time_s, streak + 1, speed)` («Без спешки»: 100), streak + 1; a frozen person
  thaws instead (no damage, streak 1). Share between 0 and 1: `round(dmg × share)` (0 when frozen), streak 0, no freeze.
  Share 0: streak 0, frozen. No answer by the end of the time: streak 0, frozen only when the question opened in phase ≥ 1.
  «Без спешки»: nobody freezes.
- The boss: hp_max = 55 × questions; phase 1 at ⅔, 2 at ⅓ (only up); in phase 2 a miss (not exactly right) heals
  `round(0.05 × hp_max)` while the boss is alive. A defeated boss stays down; the remaining questions still score.
- `elapsed_ms = clamp(now − opens_at, 0, time_s × 1000)`; `time_ms` adds it, or the whole time for no answer.
- **The table**: points desc, right answers desc, `time_ms` asc (equal on all three share a place: `rank()`), then who
  finished first. `live_runs_board_idx` serves it.

## 4. Who sees what

| data | the person (own token) | anyone with the link | the author |
|---|---|---|---|
| the challenge's title, count, time, deadline, state, finished / playing counts | yes | yes (`challenge_info`, `challenge_board`) | yes |
| a question's text and options | from `challenge_next` of that question | never | the texts in the results |
| a question's key, forms, explanation | only once that question of that run is graded (answered, or past `closes_at + 1.5 s` by the server's clock) | never | never (the results have counts only) |
| keys of questions the run never opened | never | never | never |
| names, looks, points, right, time of finished runs | the table (top 50) + own row | the table (top 50) | every run, with its id (to take it off) |
| tokens | the device keeps its own; the server keeps the sha256 and never sends either back | — | — |

## 5. RPC (PostgREST `rpc/…`; SECURITY DEFINER, `search_path = ''`, refusals by `meldy_private.live_fail`)

The public functions are `challenge_*`, not `live_*`: the older contracts count the public `live_*` functions and want
each for anon, while the author's here are for `authenticated` only.

**The author** (granted to `authenticated` only; the caller is `auth.uid()`):
- `challenge_create(p_source jsonb, p_settings jsonb) → {challenge_id, code, path, url, q_count, skipped, deadline}` —
  the source as `live_create`'s; settings `time_s` (20), `speed` (true), `calm` (false), `deadline` (an ISO time 5 min to
  30 days ahead, `22023 deadline`). 20 creates an hour (`ML005 create`), 20 open (`ML009`), none playable (`ML008`).
- `challenge_close(p_challenge) → info + {closed: true, closed_at}`; twice is fine.
- `challenge_remove(p_challenge, p_run) → {ok}` — off the table; its token stops working (`42501 removed`).
- `challenge_results(p_challenge) → info + {challenge_id, container_id, quiz_id, skipped, path, url, created_at,
  closed_at, runs: [{run_id, place, name, look, dmg, right, time_ms, answered, joined_at, finished_at, removed}],
  questions: [{qi, text, kind, answered, right, partial}]}`.
- `challenges_mine(p_container uuid default null) → {items: [info + {challenge_id, container_id, path, created_at,
  leader: {name, look, dmg} | null}]}` — the newest 50.

**Anyone with the link** (granted to `anon` and `authenticated`; the code plus the own token):
- `challenge_info(p_code) → {code, title, q_count, time_s, speed, deadline, state: open|over, over: closed|deadline|null,
  finished, playing, now}` (+ `calm: true`).
- `challenge_join(p_code, p_name, p_token, p_look) → RunState` — the token is made on the device (43 base64url chars).
  The same token (or the same account, whose new token replaces the old hash) gets its run back. New: not after the end
  (`ML002 closed|deadline`), 120 a minute per address and per link (`ML005 join`, 429 + Retry-After), 300 runs (`ML001`),
  the name (`ML006`), the look (`ML007`).
- `challenge_state(p_code, p_token) → RunState` — grades a question left past its time.
- `challenge_next(p_code, p_token, p_qi) → RunState` — opens question `p_qi` = current + 1 once the current is graded
  (`ML004 not_done`; another number `ML004 bad_qi`; the current one again is the same answer). After the end a run under
  way ends; one never started gets `ML002`.
- `challenge_answer(p_code, p_token, p_qi, p_answer) → RunState` — `live_submit`'s shapes (`{choice}`, `{picks}`,
  `{text}`); `ML004 early|late|twice|bad_qi|kind`, `22023 answer`. A question opened before the end may be answered in its
  time after the end.
- `challenge_board(p_code, p_token default null) → {now, challenge: info, top: [{place, name, look, dmg, right, time_ms,
  me?}], me: {place, name, look, dmg, right, time_ms, finished} | null}`.
- `challenge_review(p_code, p_token) → {items}` — a finished run only (`ML004 not_done`); `live_review`'s item shape, for
  the run's graded questions.
- `challenge_practice(p_code, p_token) → {container_id, joined, saved, mistakes}` — as `live_practice` (CONTRACT §14):
  the session's account (`28000`); the exam's author or an active member, else a quiz that offers practice with no quiz
  of the exam open joins the person (`ML012 practice|open|removed|full`); wrong, partial and unanswered questions go
  through `meldy_private.record_test_answers_for` (source `web`, `client_event_id = lc:<run>:<qi>`: once).

```jsonc
// RunState
{ "now": "…", "challenge": {…info},
  "run": { "name", "look", "qi", "dmg", "right", "streak", "best", "frozen", "time_ms",
           "boss": { "hp", "hp_max", "phase", "defeated" }, "finished": false, "place": null },
  "question": null | { "qi", "text", "options", "opens_at", "closes_at", "phase" }   // + kind/multi | kind | kind/unit
  "answer": null | { "choice" | "picks" | "typed", "elapsed_ms" },
  "result": null | { "qi", "key", "correct", "none", "dmg", "thawed", "frozen", "healed", "phase_changed", "elapsed_ms" }
           // + keys/share | forms | forms/tolerance/unit; + explanation
}
```

## 6. The end

Closed early or past the deadline: no new run and no next question; a question already open may be answered in its time.
35 s after the end (the longest question's 33 s and the grace) the first read sweeps once: every run under way has its open
question graded as none and ends (`swept_at`). Runs that never opened a question are on no table. Challenges go 90 days
after their end.

## 7. Screens

- **Player** `/s/<code>` (`pages/challenge/ChallengePage.tsx`, `components/challenge/`): the intro (title, count, time,
  deadline, the rules, who has played), the live player's character builder, «Готовы?», each question with the timer bar,
  the own boss and its HP, the own points, the battle's A–Е buttons / ticks / text field / keypad; the result sheet (the
  verdict, points, the key, the explanation, «Дальше»); the final (won or not, the place, points, right, time), the table,
  the review with «Тренировать ошибки» (a guest signs in and comes back to `/s/<code>?practice=1`). The token is kept in
  localStorage `meldy.challenge.<code>`.
- **Author**: «Соревнование по ссылке» beside «Начать игру» on `/games` (the same picker), beside «Провести игру» on the
  test's page and on `/live/new`; the setup `/live/challenge?c=<test>` (deadline, time, «Без спешки» or points for speed,
  count); the challenge's page `/live/challenge/<id>` (link, QR, copy, open as a participant, «Закрыть досрочно», the
  results every 5 s, «Убрать», each question's right share and the hardest); the lists on `/games` and the test's page.
- Not played: questions with a picture (the pictures function reads a game's or a quiz attempt's only), order, match,
  cloze, essay. The setup names each.

## 8. Release order

The site first (its pages call `challenge_*`; before the migration they say «не получилось» and the lists stay hidden),
then the migration. The Space has nothing to change (the `/sb` proxy passes every `rest/v1` call). No Edge Function.
