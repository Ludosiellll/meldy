# CONTRACT_T7: the group chat's database («Вопрос дня», stage 3)

Owner: package T7. Source of truth: `supabase/migrations/20261010120004_telegram_bot_groups.sql`. Reader: package T8
(`_shared/bot/group.ts`, `GroupBotInvite.tsx`). Spec: `meldy-notes/10_Project/Telegram_Bot_Spec_2026-10-09.md` §4.6
(G0–G4), §6.2–§6.6, §8.2 «Беседа». Builds on `CONTRACT_T1.md` (read it first: the rules for every caller hold here too).
This file changes when a signature or a shape changes.

## Rules (on top of CONTRACT_T1)

- `public.bot_group_*` / `bot_claim_group_*`: the Edge Function only, `POST /rest/v1/rpc/<name>`, service-role key,
  named JSON arguments. Each starts with `meldy_private.require_service_role()` (anon/authenticated: `42501`). The
  Telegram user is always resolved through `bot.links`; the bot never passes a Meldy user id.
- Statuses, not errors: a bot function raises only `42501` and `22023` (a call the code could never mean: an unknown
  status or event, a `shown` that is not an order of the options, a migration without a new chat id).
- `p_now` parameters are for tests only. The function never passes them.
- Chat ids are JSON numbers (group ids are negative, ≤ 13 digits: safe in JS). Days `YYYY-MM-DD`, times ISO 8601.
- **The key never leaves the database before a press.** No group function returns `correct`, the accepted answers or the
  key's index, except `bot_group_answer` to the one who pressed, after the press is stored. Never put the key in a post,
  a counter or a close edit (spec §4.6 «Ключ в беседе не появляется никогда»).
- Hours of G0: `9 | 12 | 15 | 18` (default `12`). A post closes at 21:00 local (the group's `tz` = the author's zone
  at the binding).

## Site (`telegram_group_*`, authenticated, the exam's author)

Errors: `28000` not signed in; `42501` not the exam's author; `22023` an hour that is not 9/12/15/18; `P0002` Telegram
not linked (`telegram_group_code`: «Сначала подключите Telegram в профиле.») or no such group chat
(`telegram_group_set`); `MT001` more than 5 group codes in an hour; `MT002` the exam has no active group link.

| Function | Returns |
|---|---|
| `telegram_group_code(p_container_id uuid, p_post_hour int = 12)` | `{code: "G<32 hex>", expires_at, post_hour, bot_username}`. One hour, once. Deep link: `https://t.me/<bot_username ?? "Meldyteach_bot">?startgroup=<code>`. A new code ends the author's earlier unused code of this exam: request one only when «Подключить беседу» is pressed. |
| `telegram_groups(p_container_id uuid)` | `{telegram_linked: bool, link_active: bool, bot_username, hours: [9, 12, 15, 18], default_hour: 12, groups: [GROUP]}` — the chats the bot is in for this exam, oldest binding first. Read only (STABLE). |
| `telegram_group_set(p_chat_id bigint, p_post_hour int = null, p_on bool = null)` | `GROUP` after the change. Null keeps a value. `p_on: true` turns it on again (also after G4: the count of empty posts starts over); `false` → `off_reason: "author"`. |

GROUP = `{chat_id, title, post_hour, tz, on: bool, off_reason: null | "author" | "empty" | "link", bound_at, link_active}`.
`off_reason`: `author` (turned off on the site), `empty` (5 posts in a row without an answer: G4 went out), `link` (the
exam's group link was revoked or expired: no post until the chat is connected again with a new code). `title` = the
chat's title (may be null).

## Bot: binding the chat

| Function | Returns |
|---|---|
| `bot_group_claim(p_code, p_chat_id bigint, p_chat_type, p_title, p_from_tg_user_id bigint, p_message_date timestamptz = null)` | see below |
| `bot_group_event(p_chat_id bigint, p_event, p_new_chat_id bigint = null)` | `{status: "ok", changed: bool, chat_id}` |
| `bot_group_entry(p_tg_user_id bigint, p_chat_id bigint)` | `{linked: false}` \| `{linked: true, status: "unknown"}` \| `{linked: true, status: "ok", container_id, exam_title, role: "owner" \| "member" \| null}` |

**`bot_group_claim`** — for `/start@<bot> G<code>` (or `/start G<code>`) in a group: `p_chat_type` = `chat.type`,
`p_title` = `chat.title`, `p_from_tg_user_id` = `from.id`, `p_message_date` = `new Date(message.date * 1000).toISOString()`.
Every result has `sender_chat_id` (the sender's private chat if the sender's Telegram is linked, else `null`) and
`chat_bound` (this chat is bound to an exam right now).

| `status` | Meaning | What the function does (§4.6 G1) |
|---|---|---|
| `bound` | bound (or moved to this exam); `again: true` = the same code from the same Telegram for the same chat (a redelivery) | G1 in the chat (no sound, no buttons) with `exam_title`, `post_hour`; to `owner_chat_id` in private: «Беседа «<title>» подключена: вопрос дня — каждый день в <post_hour>:00. …» (no title → word it without one) |
| `foreign` | not the author's linked Telegram | leave the chat unless `chat_bound`; if `sender_chat_id`: «Подключить беседу может только автор экзамена.» |
| `expired` \| `used` \| `no_link` | older than an hour (by the message date) / used / the exam's group link is gone | leave unless `chat_bound`; if `sender_chat_id`: «Ссылка устарела. На сайте нажмите «Подключить беседу» ещё раз.» |
| `invalid` | not a `G` code or an unknown one (counts toward 10 failures an hour) | leave unless `chat_bound`, no message |
| `slow_down` | 10 failures in the last hour from this `from.id` | leave unless `chat_bound`, no message |
| `not_group` | not a `group`/`supergroup` (or no `from.id`) | nothing in a group; in a private chat answer as a bad link |

`bound` adds `{chat_id, container_id, exam_title, title, post_hour, tz, owner_chat_id, again}`. **Never leave a chat
whose `chat_bound` is true** (a refused code must not unbind a working group). A bot added without a code stays silent.

**`bot_group_event`** — `p_event`: `left` | `kicked` (`my_chat_member` of a group: the bot was removed → the chat is
unbound, no more posts) | `migrated` (`message.migrate_to_chat_id`, or an error's `parameters.migrate_to_chat_id`:
`p_chat_id` = the old id, `p_new_chat_id` = the new one; the group and its posts move). `changed: false` = nothing bound
there. Private chats go to T1's `bot_chat_event`, never here.

**`bot_group_entry`** — «Заниматься в Meldy» (`/start g<chat_id>` in private, e.g. `g-1001234567890`): `role` owner or
member → K1 (`bot_today`); `null` → «<b>Экзамен «<exam_title>»</b>» / «Он приходит по ссылке группы…»; `linked:
false` → M1; `unknown` → as M1 for a linked user (the chat is no longer bound). Read only.

## Bot: the tick (spec §6.6 steps 1, 2, 4)

Order inside a tick: **(1) closes, (2) posts, …, (4) counters.** Each claim is safe with two ticks at once.

### Step 1 — the 21:00 close

`bot_claim_group_closes(p_limit int = 50)` → rows `{post_id, chat_id, tg_message_id, answered, view: VIEW}`; each row
is leased for 10 minutes. For each: `editMessageText` of `tg_message_id` in `chat_id` with the G2 text (from VIEW) and
the last line «Вопрос закрыт. Ответили <answered>.» (`answered = 0` → «Вопрос закрыт.»), **no keyboard**; then
`bot_group_closed(p_post_id, p_status)`:

| `p_status` | When |
|---|---|
| `closed` | the edit went through, or «message is not modified» |
| `gone` | «message to edit not found» |
| `failed` | any other 400/403 |
| `retry` | a timeout, 5xx, 429: the post stays open and comes back after its lease (after 3 tries it is closed without an edit) |

`{status: "ok" | "ignored"}`. Posts that cannot be edited (no message id, the bot left, no question) are closed by the
claim itself and never returned. The claim also deletes presses two days after a close.

### Step 2 — the posts

`bot_claim_group_posts(p_limit int = 10)` → rows
`{kind, post_id, delivery_id, chat_id, group_chat_id, local_day, container_id, title, exam_title, candidates}`:

- **`kind: "post"`** — `chat_id` = `group_chat_id` = the group. Then, in order:
  1. `const pick = pickGroupQuestion(row.candidates)` (the copied `group.ts`; `candidates` is its `GroupInput` as is).
  2. `bot_group_pick(p_post_id, p_rev)` with `p_rev = pick?.rev ?? null` →
     - `{status: "picked", post_id, chat_id, local_day, question: VIEW}` (VIEW without `shown` yet);
     - `{status: "none", post_id}` (`p_rev` null: no post today);
     - `{status: "invalid", post_id}` (not such a question now: skip; the row comes back in 10 minutes);
     - `{status: "gone", post_id}` (another tick has it): skip.
  3. `shown = optionOrder(options.length, keep_order, pinnedLast(options), "g:" + post_id)` (copied `session.ts`).
  4. `bot_group_sending(p_post_id, p_shown int[])` → `true`: send now; `false`: do NOT send (skip). A `p_shown` that is
     not a permutation of `0..n−1` raises `22023`.
  5. `sendMessage` (G2: `disable_notification: true`, `protect_content: true`, no blue button; the buttons in `shown`
     order with `callback_data` `g|<post_id base36>|<i>`, `i` = the button's index in `shown`; long options as
     letters like Z2; last row `{Заниматься в Meldy}` → `t.me/<bot>?start=g<chat_id>`).
  6. `bot_group_posted(p_post_id, p_status, p_tg_message_id = null, p_error = null)`:

     | `p_status` | When |
     |---|---|
     | `sent` | + the message id |
     | `failed` | 400/403 (403 «bot was kicked» → also `bot_group_event(chat, 'kicked')`) |
     | `unknown` | a timeout or 5xx (it may be in the chat: never sent again) |
     | `retry` | 429, or `migrate_to_chat_id` (call `bot_group_event(old, 'migrated', new)` first): not posted, offered again in 10 minutes |

     `{status: "ok" | "ignored"}`.
- **`kind: "g4"`** — the group just turned off after 5 posts in a row without an answer. `delivery_id` (a
  `bot.deliveries` row, kind `notice`), `chat_id` = the author's private chat, `group_chat_id`, `title` (the chat's),
  `exam_title`, `container_id`. Send G4 once through T1: `bot_delivery_sending(delivery_id)` → `sendMessage` (no
  sound): «В беседе «<title>» пять дней подряд никто не ответил на вопрос дня — бот перестал его присылать. Включить
  снова можно на сайте, в «Пригласить группу».» `{Открыть в Meldy}` → `bot_delivery_done(delivery_id, 'sent', id)`
  (or `failed`).

No post is made (the claim returns nothing for that chat) on an exam day or after the last date, after the group link is
revoked or expired (the group turns off, `off_reason: "link"`), when the author turned it off, or after the 5-empty
stop. One post a day per chat even with two ticks at once; a post left in `sending` for 10 minutes becomes `unknown`
and is never sent again.

### Step 4 — «Ответили N»

`bot_group_counters(p_limit int = 50)` → rows `{post_id, chat_id, tg_message_id, answered, view: VIEW}`: open posts with
new presses whose last edit was a minute ago or more, before 21:00. Each row is leased: at most one edit a minute per
post. `editMessageText` with the G2 text, the last line «Ответили <answered>.» and the same keyboard; then
`bot_group_counter_done(p_post_id, p_answered int, p_status = 'shown')`: `shown` (done, or «message is not modified»),
`failed` (tried again next minute), `gone` («message to edit not found»: no more edits). `{status: "ok" | "ignored"}`.

### VIEW (a post as the function renders it, never with the key)

`{post_id, chat_id, local_day, subject, stem, options: [text…] (FILE order), kind: "single", code: bool, keep_order:
bool, shown: [file index…] | null}`. Buttons/letters in `shown` order: `shown.map(i => options[i])`. G2 header:
«<b>Вопрос дня · <subject></b>». `null` view = the question was deleted (close: just take the keyboard off).

### `candidates` (= `GroupInput` of `frontend/src/lib/containers/group.ts`)

`{day: "YYYY-MM-DD", items: [{rev, label, topic, members, confirmable, relearn, due, unseen, blocked}], recent: [{rev,
day}], minGapDays: 14}`. `rev` = the question's id (pass `pick.rev` back as is), `label` = its number in the file.
Counts over the exam's author and active members; no user ids, no names. Only questions that may be posted today
(one correct option, a key, 2–8 options, no lost image, nobody's open doubt, stem + options ≤ 1500 characters, its
subject's test date not today or past), plus the last post's question (`blocked: true` when it may not be posted).

### The saving mode

`bot.tick_due_groups(p_now)` (T1's hook in `bot.tick_due`) is true when one of the claims above has work: a post
due, a close due, a counter waiting, a claimed post or G4 to retake, a post left in `sending`.

## Bot: a press (`callback_data` `g|<post base36>|<i>`)

`bot_group_answer(p_post_id bigint, p_tg_user_id bigint, p_shown int, p_chat_id bigint, p_message_id bigint)` — always
pass `p_chat_id` = `callback_query.message.chat.id` and `p_message_id` = `callback_query.message.message_id`. One DB
call, then `answerCallbackQuery` (anything with the key: `show_alert`, ≤ 200 characters, a long option cut with «…»).

| `status` | Fields | G3 |
|---|---|---|
| `answered`, `who: "member"` | `correct`, `choice {shown, text}`, `key {shown, text}`, `answered`, `recorded`, `core`, `step`, `figure` | right: «Верно.» (toast); `step: "two_days"` → «Верно. Теперь <figure.two_days> из <figure.in_plan> — верно в два разных дня.»; wrong: alert «Неверно. В файле — <key.text>. Вопрос вернётся в ваших занятиях завтра.» |
| `answered`, `who: "unlinked"` | `correct`, `choice`, `key`, `answered` | «Верно.» / alert «Неверно. В файле — <key.text>. Чтобы такие ответы шли в план Meldy, подключите Telegram в профиле.» |
| `answered`, `who: "outsider"` | same | «Верно.» / alert «Неверно. В файле — <key.text>.» (linked, not in this exam: only «Ответили N») |
| `repeat` | `correct`, `choice` and `key` of the FIRST press, `answered` | alert «Вы уже ответили: <choice.text>. В файле — <key.text>.» |
| `closed` | `reason: time \| status \| stale \| gone` | toast «Вопрос закрыт.» (no key) |
| `invalid` | `reason: input \| chat \| shown` | toast «Вопрос закрыт.» (no key) |

`key.shown` / `choice.shown` are button indices (for letters: А, Б, … by index). A member's press is one
`test_answers` row: `source = 'bot_group'`, `client_event_id = tgq:<post_id>:<tg_user_id>`, graded by the server;
`recorded: false` with `core` ≠ saved/late/duplicate means the core refused it (shown as the plain toast). A press is
counted in `answered` for everyone; the counter edit is step 4's job, never the press's.

## Tables (schema `bot`; RLS on, no policy, no client grants)

`groups` (pk `chat_id`; `container_id` → containers cascade, `link_id` → container_links, `owner_id`, `title`,
`post_hour`, `tz`, `bound_at`, `on_at`, `off_at`, `off_reason`, `left_at`), `group_posts` (unique `(chat_id,
local_day)`; `item_id` → test_items **on delete set null** so the day's row survives a deleted question; status
`claimed|sending|open|closed|failed|unknown`; `shown`, `tg_message_id`, `answered`, `counter_shown`, `counter_at`,
`closed_at`), `group_answers` (pk `(post_id, tg_user_id)`; `shown`, `correct`, `at`; deleted two days after the close).
G codes live in T1's `bot.link_codes` (purpose `group`), G4 in T1's `bot.deliveries` (kind `notice`, ref
`g4:<group chat id>`).
