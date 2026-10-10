# CONTRACT_T5: the database of the «занятие» in the chat

Owner: package T5. Source of truth: `supabase/migrations/20261010120003_telegram_bot_sessions.sql` (table
`bot.sessions`, the functions below, the tick's hook `bot.tick_due_sessions`). Spec:
`meldy-notes/10_Project/Telegram_Bot_Spec_2026-10-09.md` §4.3–§4.4, §4.8, §6.2, §6.3, §6.5. For package T6 (the
function side). This file changes when a signature or a shape changes.

## Rules

- `POST /rest/v1/rpc/<name>` with the service-role key and named JSON arguments, like every `bot_*` (CONTRACT_T1.md).
  Anon and authenticated get `42501`. The bot never passes a user id: the user is the active `bot.links` row of
  `p_tg_user_id`, and the session must be that user's.
- Every function answers with one JSON object and a `status`; input problems are statuses, never errors.
- Positions are 0-based queue indices (`pos` of `s|<sid>|<pos>|…`). A position never changes meaning: repeats are
  inserted after the current question only. Option indices in `view.options`, `review.choice`, `review.key` and in
  `p_choice` are SHOWN indices (the order on screen); `view.order[k]` = the file index shown k-th.
- The key never comes before an answer: `view.review` (with the key) exists only for an answered question.
- What TypeScript computes (the copied `session.ts`): the queue (`buildSession`, seed = sid), each question's option
  order (`optionOrder(n, keep_order, pinnedLast(options), seed)`; the site seeds with `<id>:<pos>`, use
  `<sid>:<pos>`), the class of each question, and `afterAnswer` after a miss. SQL stores them and checks them.
- Idempotency (spec §6.5): an answer is `client_event_id = tg:<sid>:<pos>`; `test_answers.session_id =
  md5('tg:' || sid)::uuid` (= `bot.sessions.session_uuid`); `source = 'bot'`; `local_date` = the link's local day;
  `ms` = server time from the question's first show to the tap, ≤ 180 000; `cls`, `retry` from the queue.
- Every call that finds the session marks the user as seen (`bot.links.last_seen_at`, as `bot_whoami` does: it ends
  K2's silence; the day card waits only after answers, which the recorded ones are).

## Statuses

| status | when | spec §4.8 line |
|---|---|---|
| `ok` | done | — |
| `repeat` | the question at `pos` is answered already (double tap, a second typed message): the first answer stands, nothing changes | answer the callback silently |
| `old` | `pos` is not the current question (an older button, the second tap after the first moved on, «Повторить» after a lost reply). Carries `answer` = what was recorded at that `pos` (`{status: "duplicate", correct, dont_know, misclick, step}`) or null, plus the current `session`/`view` | «Этот вопрос уже закрыт — занятие в последнем сообщении.» (or re-render the current view when `answer` is not null) |
| `not_found` | no session with this sid for this user (unknown, cleaned up after 30 days, someone else's, malformed sid) | «Этот вопрос уже закрыт — занятие в последнем сообщении.» |
| `ended` | finished or abandoned; a session whose local day has passed and that was idle 30 minutes is closed by this call (its waiting answer recorded as given). Carries `session` (view null) and, from `bot_session_answer` with a `p_pos`, `answer` = what was recorded there | «Это занятие уже закончено.» (or the summary when `answer` is not null: the press was the last answer) |
| `unavailable` | the user no longer has the exam (left, removed, deleted): the session is closed, nothing recorded. Carries `exam_title`, `session` | «Экзамен «<exam_title>» больше недоступен — занятие закрыто.» |
| `unlinked` | no active link for this Telegram user | «Telegram отключён от Meldy. Подключить снова можно в профиле.» |
| `invalid` | the call does not fit the state; `reason` says why (below). Carries `session`/`view` when the session was found | «Этот вопрос уже закрыт — занятие в последнем сообщении.» |
| `no_question` | `bot_session_answer` with a typed message, but no short question waits for one | S6 «Здесь отвечают кнопками…» |
| `conflict` | `bot_session_start`: the sid is taken | draw another sid, call again |
| `empty` | `bot_session_start`: none of the queue's questions can be shown | the card's «Начать» state is stale: re-read `bot_today` |

`answer.status` (the outcome of the press) is the core's: `saved` \| `late` \| `duplicate` (recorded) \| `stale`
(the author changed the key after the question was shown: not recorded — «Автор исправил ключ в этом вопросе. Ответ
не записан — вопрос начнётся заново.» and the next question) \| `gone` (deleted: «Этого вопроса больше нет в экзамене.
Вот следующий.») \| `no_key` \| `conflict` — or `pending` (wrong / «Не знаю», waiting for «Дальше»).

## Shapes

SESSION (every reply once the session is found):
```
{ sid, kind: "plan"|"errors"|"extra", status: "open"|"finished"|"abandoned",
  container_id, subject_id, exam_title, subject_title, role: "owner"|"member", local_day: "YYYY-MM-DD",
  position, length, queue: [{id, retry: 0|1|2}],   // session.ts QueueEntry[]; counter(queue, position) = «7 из 20»
  answered: bool,                                 // the current question has an answer awaiting «Дальше»
  chat_id, message_id, created_at, active_at, finished_at, now,
  counts: {questions, right, wrong, dont_know, misclick, retries, skipped, gone, stale, doubted},
  figure: {in_plan, two_days, now, gained, dropped, started, too_early,
           too_early_states: [{streak_at, streak_day, peek_day}]} }
```
- `counts.questions` = planned questions answered (first answers); `right` / `wrong` / `dont_know` / `misclick` split
  them; `retries` = answers to repeats; `skipped` = your `skip`s (over 4096: «1 вопрос — только на сайте…»);
  `gone`/`stale` = not recorded; `doubted` = «Отметить».
- `figure.in_plan` / `two_days` = what you passed at the start (the plan's «N из M»); `now` = two_days + gained −
  dropped (null without a start figure). gained = step `two_days`; dropped = in the figure before and missed;
  `too_early_states` feed `rule.ts countableFrom` («…войдут в счёт, если ответите после 19:00»); started = step `start`.
- Summary: `status = "finished"` (queue done: I1) or `"open"` after `bot_session_finish` (I2, «Продолжить: n из m»
  with `counter(queue, position)`); minutes = `now − created_at`.

VIEW (the current question; null when there is none — finished, ended):
```
{ pos, item_id, rev, kind: "single"|"multiple"|"short", code: bool, keep_order: bool,
  stem, options: [text, … in the shown order],     // [] for short
  order: [file indices in the shown order],        // invert it to get the options in file order (pinnedLast, optionOrder)
  file_no, number (position in the file, when file_no is ""), topic, topic_title, retry: 0|1|2,
  review: null | { correct, dont_know, choice: [shown indices], text, key: [shown indices], answers: [accepted forms],
                   recorded, misclick, doubt, status, step, key_source, key_changed_at } }
```
- `review.recorded` false = the answer still waits: «Нажали не туда?» is possible (not for a typed short answer).
- A view always shows the question's current version: showing an unanswered question again (move, view) takes its
  current rev, and a press is checked against the rev last shown (`stale` when the author changed the key in between).
- `review.misclick` → Z9; `review.doubt` → «Отложено. Когда автор ответит, вопрос вернётся в занятия.»;
  `key_changed_at` → «Ключ исправлен автором <date>.»; `key_source` (`manual`, `first_option`, …) for «В файле ответ не
  был выделен — ключ поставил автор.».
- Repeats: `retry > 0` → «… · повтор — не в счёт». «Вернётся через пару вопросов» while `retry < 2`.

ANSWER (`answer` of `bot_session_answer`; others carry the recorded outcome when they recorded one, else null):
`{status, correct, dont_know, step, misclick?, figure?: {in_plan, two_days, now, gained, dropped, started, too_early}}`.
Step `two_days` → «Верно. Теперь <figure.now> из <figure.in_plan> — верно в два разных дня.»

## Functions

| Function | Does | Returns |
|---|---|---|
| `bot_session_items(p_tg_user_id, p_container_id uuid, p_item_ids uuid[])` | before «Начать»: what `optionOrder` needs, 1..60 ids, never the key; only this exam's items with a key | `{status: "ok", items: [{id, subject_id, kind, keep_order, code, rev, options: [file order]}]}` \| `unlinked` \| `unavailable` \| `invalid` |
| `bot_session_start(p_tg_user_id, p_sid text, p_container_id, p_subject_id, p_kind, p_queue jsonb, p_message_id bigint = null, p_figure jsonb = null)` | a new session. `p_sid` `^[0-9a-z]{8}$` drawn by you (the seed). `p_queue` = `[{id, cls?, shown}]`, 1..20, `shown` = file indices in display order (`[]` for short). `p_message_id` = the card that turns into the session (null for a new message: then `bot_session_move`). `p_figure` = `{in_plan, two_days}`. Questions gone since the plan are left out. The previous open session is closed and its waiting answer recorded as given while that session's link is still active (`replaced`). The same card or the same sid again → that session (`resumed: true`) | `{status: "ok", resumed, replaced: {sid, chat_id, message_id} \| null, session, view}` \| `unlinked` \| `unavailable` (+ `exam_title`) \| `invalid` (`arguments`, `subject`, `queue`, `shown`) \| `conflict` \| `empty` |
| `bot_session_view(p_tg_user_id, p_sid, p_pos int = null)` | the current state again (before «Дальше», «Сомневаюсь в ключе» `d`, «Отмена» `b`, a deleted message) | `{status: "ok"\|"old", answer?, session, view}` or a refusal |
| `bot_session_answer(p_tg_user_id, p_sid, p_pos, p_choice jsonb)` | `p_choice`: `{"i": k}` (single), `{"mask": m}` (multiple, bit k = shown option k, `a<mask>`), `{"text": "…"}` (short, typed: pass `p_sid` and `p_pos` null), `{"dont_know": true}` (`x`). Right → recorded, the reply's `view` is the NEXT question (single/multiple) or the same short question with its review (until «Дальше»). Wrong / «Не знаю» → pending, `view.review` has the key | `{status: "ok", answer, session, view}` \| `repeat` \| `old` \| `invalid` (`choice`) \| `no_question` \| refusals |
| `bot_session_resolve(p_tg_user_id, p_sid, p_pos, p_action, p_queue jsonb = null)` | `next` («Дальше»): the waiting answer recorded as given, the next question. `misclick` (`m`): recorded with misclick, the question stays (Z9). `skip`: you cannot show the current question (> 4096): the next one, counted | `{status: "ok", answer, session, view}` \| `old` \| `invalid` (`action`, `no_answer`, `answered`, `recorded`, `correct`, `typed`, `queue`) \| refusals |
| `bot_session_finish(p_tg_user_id, p_sid)` | «Закончить» (`f`): the waiting answer recorded as given and stepped over. Stays `open` for «Продолжить» today; `finished` when the queue is done; `abandoned` when nothing was answered. Again → ok | `{status: "ok", answer, session, view}` \| refusals |
| `bot_session_move(p_tg_user_id, p_sid, p_message_id bigint)` | the session now lives in this message: «Продолжить» `c` (on today's card I3, or on the summary — the same message), a new message after «Ещё 20 вопросов», a message to edit that was deleted. Only on the session's own day. The waiting answer stays | `{status: "ok", prev_message_id \| null, session, view}` \| `invalid` (`message`) \| `ended` \| refusals |
| `bot_key_doubt(p_tg_user_id, p_sid, p_pos)` | «Отметить» (`D`): the answer recorded as given, `test_key_doubt_for` (proposed = the chosen options); the question stays with `review.doubt` until «Дальше», which gives it no repeat (a repeat in `p_queue` is left out). Again → ok | `{status: "ok", answer, session, view}` \| `old` \| `invalid` (`no_answer`) \| refusals |
| `bot_flush_pending(p_now timestamptz = null)` | the tick's step 7, every tick, called with NO arguments (`{}`: `p_now` defaults to the server's clock; it exists only for tests): pending answers older than 30 minutes recorded as given; open sessions idle 30 minutes whose day passed (or whose link ended) closed; closed sessions deleted after 30 days. Bounded (200 / 200 / 500 a call) | `{status: "ok", flushed: n, closed: n, deleted: n}` (`flushed` = pending answers handled this call) |

## The presses (`s|<sid>|<pos>|<act>`, spec §6.5)

| act | call |
|---|---|
| `<i>` option | `bot_session_answer(…, {"i": i})` → `answerCallbackQuery` («Верно.» / the two_days line) → one edit to `view` |
| `x` «Не знаю» | `bot_session_answer(…, {"dont_know": true})` |
| `t<mask>` | no database call: `editMessageReplyMarkup` |
| `a<mask>` | mask 0 → «Отметьте хотя бы один вариант.» (no call); else `bot_session_answer(…, {"mask": m})` |
| typed text | `bot_session_answer(p_tg_user_id, null, null, {"text": t})`; `no_question` → S6 |
| `n` «Дальше» | `bot_session_resolve(…, 'next')`. If it answers `invalid` / `queue` (a miss that comes back), compute `afterAnswer(session.queue, pos, {id: view.item_id, correct: false}, seed)` with `seed = "<sid>:<pos>"` (as the site seeds it), give the inserted entry `shown` = a new `optionOrder` (seed `<sid>:<its pos>`; options in file order from `view.order`), and call `bot_session_resolve(…, 'next', queue)`. Or call `bot_session_view` first and decide from `view.review` (correct, misclick, doubt, `retry` = 2: no queue needed) |
| `m` | `bot_session_resolve(…, 'misclick')` |
| `d` | `bot_session_view` → Z11 under the review |
| `D` | `bot_key_doubt` |
| `b` | `bot_session_view` → Z7 again |
| `f` | `bot_session_finish` → I2 (or I1 when `session.status = "finished"`); the day line from `bot_today` |
| `c` | `bot_session_move(…, the pressed message's id)`; delete `prev_message_id` (fallback: edit «Занятие продолжено ниже.») |
| `g` | no database call: remove the keyboard |
| «Повторить» | the same call with the same data: a reply `old` (or `ended`) with `answer` ≠ null means the first attempt was recorded |

After a reply whose `session.status` is `finished`, render I1 (call `bot_card_sent(…, 'last')` for its keyboard). The
last summary of the day keeps its keyboard until the night's close.

## Notes for T1's readers

- `bot_today.session` is the raw open row (`to_jsonb(row) - user_id`): `sid, session_uuid, link_id, chat_id,
  message_id, container_id, subject_id, kind, local_day, items, retry, cls, shown, shown_at, position, pending,
  pending_at, counts, figure, status, exam_title, created_at, active_at, finished_at`. Offer «Продолжить: n из m» only
  when `local_day` is today (`bot_session_move` refuses another day) and `position < cardinality(items)`.
- The night's close keeps a message that is a session's (`bot.session_message`: `chat_id`, `message_id`).
- `bot.tick_due_sessions(p_now)` (the saving mode's hook) = a pending answer older than 30 minutes exists.
