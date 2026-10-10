# CONTRACT_T1: the bot's database core

Owner: package T1. Source of truth: `supabase/migrations/20261010120000_telegram_bot.sql` (functions, schema `bot`),
`20261010120001_telegram_bot_cron.sql` (the tick) and `20261010120002_telegram_bot_revokes.sql` (grants).
Spec: `meldy-notes/10_Project/Telegram_Bot_Spec_2026-10-09.md` §6.2–§6.6. This file changes when a signature changes.

## Rules for every caller

- `public.bot_*`: the Edge Function only, `POST /rest/v1/rpc/<name>` with the service-role key and named JSON
  arguments. Each one is SECURITY DEFINER with `search_path = ''` and starts with `meldy_private.require_service_role()`:
  anon and authenticated get `42501`. The bot never passes a user id: the user is the active `bot.links` row of the
  Telegram user id (or of a row the tick claimed).
- `public.telegram_*`: the site, as the signed-in user (`auth.uid()`). Authenticated only.
- Times are ISO 8601 strings (`timestamptz`), days `YYYY-MM-DD`, clock times `HH:MM`. Telegram ids are JSON numbers
  (≤ 52 bits, safe in JS).
- Bot functions answer every input problem with a status, never an error (an error would turn a message into 503 and a
  24-hour retry loop). They raise only `42501` (not the service role) and `22023` (a call the code could never mean:
  unknown event or delivery status, bad setup values, negative update id).
- `p_now` parameters exist for tests. The function never passes them.
- Read-only functions (`bot_status`, `telegram_link_state`) are STABLE; PostgREST runs them read-only.

## Site (`telegram_*`, authenticated)

Errors: `28000` not signed in; `22023` bad input (unknown zone, time outside 07:00–22:59); `P0002` Telegram not linked
(`telegram_settings`); `MT001` more than 5 link codes in an hour.

| Function | Returns |
|---|---|
| `telegram_link_start(p_tz text = null)` | `{code: "L<32 hex>", expires_at, bot_username}`. 15 minutes. `p_tz` = `Intl.DateTimeFormat().resolvedOptions().timeZone`, checked against `pg_timezone_names`, applied when the code is claimed. A new code ends the user's earlier unused codes: request one only when the user presses «Подключить Telegram». `bot_username` is null until `/setup` ran: use `Meldyteach_bot` then. |
| `telegram_link_state()` | `{linked: false, bot_username}` or `{linked: true, linked_at, blocked, remind_on, remind_at: "20:00", tz, paused_until: "YYYY-MM-DD" \| null, bot_username}`. Cheap: poll it every 3 s; «linked now» = `linked_at` after the moment the code was requested. |
| `telegram_settings(p_remind_on bool = null, p_remind_at time = null, p_tz text = null)` | the state above. Null keeps a value. Counts as the user's action (ends the K2 silence). |
| `telegram_unlink()` | the state above (`linked: false`). Idempotent. |

## Bot: service functions

| Function | Returns |
|---|---|
| `bot_setup(p_bot_username, p_bot_id bigint, p_tick_token, p_function_url)` | `{status: "ok", bot_username, last_tick_at, flags}` or `{status: "slow_down", retry_after}` (within 60 s of the last setup: nothing changes). `p_tick_token` = base64url HMAC(`TELEGRAM_BOT_TOKEN`, `meldy:tick:v1`) (`^[A-Za-z0-9_-]{32,128}$`); `p_function_url` = `https://<ref>.supabase.co/functions/v1/telegram` exactly. Bad values → `22023`. |
| `bot_update_begin(p_update_id bigint)` | `"new"` \| `"retry"` (an earlier attempt failed, or its 30 s lease ran out) \| `"done"` \| `"busy"` (another worker holds the lease). `new`/`retry` → handle; `done`/`busy` → answer 200. Every call is counted for `/status`. |
| `bot_update_done(p_update_id)` | void. Only after the handler succeeded. |
| `bot_update_failed(p_update_id, p_error text = null)` | void. `p_error` = an error NAME (`TypeError`, `TelegramError:429`); anything else is stored as `Error`. |
| `bot_tick_beat(p_stats jsonb = null)` | `{status: "ok", calls: {month: "YYYY-MM", updates, ticks, total}, cleanup: {…} \| null}`. The tick's last step; `p_stats` ≤ 2000 bytes (else stored as `{truncated: true}`). Runs the hourly housekeeping. |
| `bot_status()` | `{configured, bot_username, last_setup_at, last_tick_at, last_tick, flags, calls: {month, updates, ticks, total}, ledger: {started, failed, done}}` (ledger = last 24 h). No token, no URL, no user counts: safe for the public `/status`. |

## Bot: linking and the user

| Function | Returns |
|---|---|
| `bot_link_claim(p_code, p_tg_user_id bigint, p_chat_id bigint, p_lang text = null, p_message_date timestamptz = null)` | `{status, replaced_chat_id}`; status `linked` \| `used` \| `expired` \| `invalid` \| `slow_down` \| `private_only`. `p_message_date` = `new Date(message.date * 1000).toISOString()` (a code is judged by the message date). The same code from the same Telegram again → `linked` (nothing changes). The new link wins on both sides; `replaced_chat_id` = the earlier chat of this Meldy account (send M6 there once), else null. `invalid` counts toward 10 failures an hour → `slow_down`. `private_only` when `chat_id ≠ from.id`. |
| `bot_chat_event(p_tg_user_id, p_event)` | `{status: "ok", changed: bool}`. `p_event`: `stop` (/stop, S4: the link ends), `blocked` (403, `my_chat_member` kicked), `unblocked` (`my_chat_member` member). |
| `bot_whoami(p_tg_user_id)` | `{linked: false}` or LINK + `{exams: [{id, title, exam_date, last_date, role: "owner"\|"member"}], reminder_today: {kind: "reminder"\|"ask", status} \| null}`. Marks the user as seen: call it only for updates the user sent, never from the tick. |
| `bot_settings(p_tg_user_id, p_patch jsonb)` | `{status: "ok", link: LINK, hint?: bool}` \| `{status: "invalid", field, reason: "unknown"\|"format"\|"range"\|"past"\|"far"}` \| `{status: "unlinked"}`. All or nothing. Patch keys: `remind_at` `"7:45"`/`"19:30"` (07:00–22:59; choosing a time also turns the plan on unless `remind_on` is given); `remind_on` bool («Не присылать» = false); `tz`; `paused_until` `"YYYY-MM-DD"` = the first day the card comes again (after today, within 366 days) or `null` (end the pause); `prompt` object ≤ 1 KB or null (the function's pending ForceReply of M4/S3: store what you need, e.g. `{kind: "time", prompt_id, target_id}`); `hint: true` → `hint` = may S6 be sent now (true at most once an hour, stamped). An empty patch `{}` only marks the user as seen (K2 «Да»). Marks the user as seen. |

LINK (`bot.link_json`): `{linked: true, chat_id, tg_lang, linked_at, blocked, remind_on, remind_at: "HH:MM", tz,
paused_until (only while it is after today), asked_at, last_seen_at, prompt, local_day, local_time: "HH:MM", now (epoch
s)}`. No e-mail, no names (decision 32).

## Bot: the day

| Function | Returns |
|---|---|
| `bot_today(p_tg_user_id)` | `{linked: false}` or `{linked: true, link: LINK, local_day, plan, overview, session, day}`. `plan` = `plan_inputs_for(user, local_day)` over every exam (`PlanInputsWire` of `frontend/src/types/container.ts`; ask PostgREST for gzip). `overview` = `containers_overview_for` (`ContainersOverview`: per-subject `stale`, `doubted`, `has_oral`, …). `session` = the user's open row of `bot.sessions` (package T5) as JSON without `user_id`, null while there is none. `day` = `{local_day, card_message_id, card_used, last_message_id, closed_at}` \| null. Marks the user as seen. |
| `bot_card_sent(p_tg_user_id, p_message_id bigint, p_event = 'card')` | `{status: "ok", local_day, prev_message_id}` \| `{status: "ok", local_day, updated}` (`used`) \| `{status: "invalid"}` \| `{status: "unlinked"}`. `card`: a K1 sent by /today → `prev_message_id` = an earlier UNUSED card of today: delete it. `used`: «Начать»/«Продолжить» turned the card with this message id into a session — call it first, or the night's close may delete that message. `last`: a summary with a keyboard (I1/I2) → `prev_message_id` = the earlier summary: take its keyboard off now. |

## Bot: the tick (spec §6.6)

Every claim first sweeps its kinds: a row in `sending` for 10 minutes becomes `unknown` and is never sent again; a row
`claimed` and never tried is taken again after 10 minutes (at most 3 tries, still due), and becomes `failed` after
3 hours. Rows claimed by one tick are not returned to another (unique keys, `on conflict do nothing`).

| Function | Returns |
|---|---|
| `bot_claim_reminders(p_limit int = 50)` | rows `{delivery_id, chat_id, local_day, tz}`. Due = local time in [remind_at, remind_at + 3 h) and before 23:00, plan on, not paused, not blocked, no answer (site or bot) and no action in the bot in the last 30 minutes, no day card claimed for this chat today. |
| `bot_reminder_context(p_delivery_id)` | `{status: "ok", delivery_id, card: "skip", reason}` (the row is already closed as skipped: `unlinked`, `blocked`, `off`, `paused`, `silent` = K2 went out and nothing happened since) \| `{status: "gone", delivery_id, card: "skip", reason: "not_claimed"}` \| `{status: "ok", delivery_id, card: "K1"\|"K2", kind: "reminder"\|"ask", reason: null, chat_id, local_day, tz, link: LINK, plan, overview}`. `K2` = three cards sent in a row with no answer and no action since the first of them: send «Присылать план дальше?» instead (no sound). If the copied plan says `done`/`nothing`/`exam_today` → `bot_delivery_done(id, 'skipped', null, '<word>')`. |
| `bot_delivery_sending(p_delivery_id)` | `true` → send now; `false` → do NOT send (taken, given up, or the link ended or was blocked). Call it right before `sendMessage` (or the day close's calls). |
| `bot_delivery_done(p_delivery_id, p_status, p_tg_message_id = null, p_error = null)` | `{status: "ok", kind, prev_card_message_id}` \| `{status: "ignored"}`. `p_status`: `sent` (+ message id) \| `failed` \| `skipped` (+ a short reason, ≤ 200 chars, no text of the user). A sent K1 becomes today's card (`prev_card_message_id` = an unused /today card of that day: delete it); a sent K2 sets `asked_at`; a `day_close` closes its day. 429 → leave the rest `claimed` (no call). 403 → `bot_chat_event(…, 'blocked')` + `failed`. |
| `bot_claim_day_close(p_limit int = 50)` | rows `{delivery_id, chat_id, local_day, card_message_id, last_message_id}`: for a day of the last two local days, delete `card_message_id` (when not null: unused and not a session), take the keyboard off `last_message_id` (when not null); then `bot_delivery_done(id, 'sent'\|'failed')`. Once per chat and day. |
| `bot_claim_after_date(p_limit int = 50)` | rows `{delivery_id, chat_id, local_day, tz, container_id, exam}`, `exam` = `{container_id, title, exam_date, last_date, first_plan_day, active_days, answers, two_days, keyed}` for K3 (no sound): the day after the exam's last test date (or 2 more days to catch up), at the usual time, under the reminder's rules, once per user and exam. «За N дней» = `last_date − first_plan_day + 1`. |

## Helpers for the packages after T1 (schema `bot`, not callable by clients)

- `bot.active_link(p_tg_user_id bigint) returns bot.links` — the only way to find a user (null row when not linked).
- `bot.local_day(p_tz text, p_at timestamptz) returns date` — date answers and sessions by the link's zone.
- `bot.session_message(p_chat_id, p_message_id) returns boolean` reads `bot.sessions(chat_id, message_id)`;
  `bot_today` reads `bot.sessions(user_id, status = 'open')`. T5: keep these spec §6.2 column names.
- `bot.deliveries.kind = 'notice'` is reserved for one-off messages (at most once by the same unique key).

## Tables (schema `bot`; RLS on, no policy, no client grants)

`config` (one row), `link_codes`, `links`, `updates`, `claim_failures`, `deliveries`, `days`, `usage` (calls per UTC
day). Uniqueness: one active link per `user_id` and per `tg_user_id`; `deliveries` unique `(kind, chat_id, local_day,
ref)` nulls not distinct, plus one day card (`reminder`/`ask`) per chat and day; `updates` pk `update_id`; `days` pk
`(link_id, local_day)`. Housekeeping (hourly, from `bot_tick_beat`): updates > 3 days, claim failures > 1 day, codes
expired > 7 days, deliveries > 90 days, days > 30 days, unlinked links > 30 days, the tick job's cron history > 7 days.
