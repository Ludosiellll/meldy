-- telegram_bot_groups
-- Repo file: supabase/migrations/20261010120004_telegram_bot_groups.sql (package T7 of the Telegram bot @Meldyteach_bot,
-- stage 3 «Вопрос дня», 2026-10-10). Spec: meldy-notes/10_Project/Telegram_Bot_Spec_2026-10-09.md (§2 decisions 7, 19,
-- 20, 24–26; §4.6 G0–G4; §6.2–§6.6; §8.2 «Беседа»). Stands on 20261010120000_telegram_bot.sql (package T1: schema bot,
-- bot.links, bot.link_codes, bot.deliveries, bot.claim_failures, bot.active_link, bot.local_day) and on the exam
-- container (20261009093500_containers.sql: containers, container_links, container_members, test_items,
-- test_item_states, test_key_doubts, meldy_private.record_test_answers_for / role_in / due_at / code_hash).
-- Rollback: supabase/rollback/20261010120004_telegram_bot_groups_down.sql. Contract lines for supabase/tests/telegram_bot.sql
-- (the T7 block) and the local rehearsal: supabase/tests/local/telegram_bot_groups.sql (+ _race.sql). Signatures and
-- JSON shapes for the function: supabase/functions/_shared/bot/CONTRACT_T7.md.
--
-- What it adds:
--   * bot.groups (one row per group chat: the exam, the author, the hour, on/off, left), bot.group_posts (one post a day
--     per chat: claimed → sending → open → closed, or failed | unknown), bot.group_answers (one press per Telegram user
--     and post; deleted two days after the close). Schema bot as T1 left it: no USAGE for clients, row security on, no
--     policy;
--   * public.telegram_group_code / telegram_groups / telegram_group_set: the author on the site (auth.uid());
--   * public.bot_group_*, bot_claim_group_*: the Edge Function with the service role; each one starts with
--     meldy_private.require_service_role(), the Telegram user is resolved through bot.links, never passed as a Meldy user;
--   * bot.group_candidates: the summary «Вопрос дня» is picked from by the container's group.ts (GroupInput): counts per
--     question across the exam's people — no user ids, no names;
--   * bot.tick_due_groups: T1's hook for the tick's saving mode;
--   * the revokes of these objects (section 6, at the end).
-- Nothing existing changes: no ALTER and no REPLACE of a container, oral or T1 object; rows of T1's tables are only
-- written as T1's contract allows (link_codes purpose 'group', deliveries kind 'notice' for G4, claim_failures).
-- Re-runnable (IF NOT EXISTS, OR REPLACE, ON CONFLICT).
-- Bot functions answer every input problem with a status; they raise only 42501 (not the service role) and 22023 (a call
-- the function could never mean). Site errors (SQLSTATE): 28000 not signed in; 42501 not the exam's author; 22023 bad
-- hour; P0002 Telegram not linked (telegram_group_code) or no such group (telegram_group_set); MT001 more than 5 group
-- codes in an hour; MT002 the exam has no active group link.
--
-- The rules this file holds (spec §4.6, §6.5, §8.2):
--   * a G code (G + 32 hex, one hour, once) is made only for the exam's author with an active group link and a linked
--     Telegram, and is accepted only from the author's linked Telegram, judged by the message's date;
--   * a post is not made on an exam day or after the last date, after the group link is revoked or has expired, when
--     the author turned it off, or after 5 posts in a row without an answer (then the group turns off and the claim
--     hands out G4 once, as a bot.deliveries 'notice');
--   * one post a day per chat: unique (chat_id, local_day); claimed → sending (right before sendMessage, with the shown
--     order) → open; a post left in sending for 10 minutes becomes unknown and is never sent again;
--   * no group function returns the key before an answer: the post's view has the stem and the options, never
--     correct; bot_group_answer returns the key only to the one who pressed, after the press is stored;
--   * an answer of a member of the exam goes through meldy_private.record_test_answers_for(…, 'bot_group') with
--     client_event_id tgq:<post_id>:<tg_user_id> (a repeat writes nothing and returns the first choice); a press of
--     someone without a link, or linked but not in the exam (the core says gone), only counts in «Ответили N»;
--   * «Ответили N» is handed to the function at most once a minute per post; the post closes at 21:00 local, once;
--   * migrate_to_chat_id moves the group (and its posts) to the new chat id; the bot removed from the chat unbinds it.

-- 1. Tables.
-- 1a. One row per group chat bound to an exam (spec §6.2). chat_id < 0 (Telegram group and supergroup ids); container_id =
--     the exam, link_id = the container's group link that was active at the binding (no post once it is revoked or has
--     expired); owner_id = the exam's author (G4 goes to the author's linked Telegram). title = the chat's title as
--     Telegram sent it with the claim (control characters dropped, ≤ 128) — for «Беседа «3-ПО» подключена…» and the
--     site's list; nothing else about the chat or its members is kept. post_hour = 9 | 12 | 15 | 18 (G0) in tz (the
--     author's zone from bot.links at the binding). on_at = when posting was last switched on (binding, or «включить»
--     on the site): the 5-empty rule counts posts from there. off_at/off_reason: author (the site), empty (5 posts in a row
--     without an answer, G4), link (the group link was revoked or expired). left_at: the bot was removed from the chat.
create table if not exists bot.groups (
  chat_id bigint primary key,
  container_id uuid not null references public.containers(id) on delete cascade,
  link_id uuid references public.container_links(id) on delete set null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text,
  post_hour smallint not null default 12,
  tz text not null default 'Europe/Minsk',
  bound_at timestamptz not null default now(),
  on_at timestamptz not null default now(),
  off_at timestamptz,
  off_reason text,
  left_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint groups_chat_check check (chat_id < 0),
  constraint groups_title_check check (title is null or char_length(title) between 1 and 128),
  constraint groups_post_hour_check check (post_hour in (9, 12, 15, 18)),
  constraint groups_tz_check check (tz ~ '^[A-Za-z0-9_+/-]{1,64}$'),
  constraint groups_off_check check ((off_at is null) = (off_reason is null)
                                     and (off_reason is null or off_reason in ('author', 'empty', 'link')))
);
create index if not exists groups_container_idx on bot.groups (container_id);
create index if not exists groups_owner_idx on bot.groups (owner_id);
create index if not exists groups_link_idx on bot.groups (link_id);
create index if not exists groups_left_idx on bot.groups (left_at) where left_at is not null;
comment on table bot.groups is 'Group chats bound to an exam for «Вопрос дня» (package T7): the exam, its group link, the author, the hour, on/off, left. No member data.';

-- 1b. One post a day per chat (spec §6.2, §6.5): unique (chat_id, local_day). status: claimed (the tick took the day) →
--     sending (bot_group_sending, right before sendMessage; shown = the order of the options on the buttons) → open
--     (bot_group_posted with the message id) → closed (21:00 local); failed (not sent: nothing to post, the exam day,
--     the window passed, a refused send — error says which); unknown (left in sending for 10 minutes: never sent again).
--     item_id goes null when the author deletes the question (the post then closes without it; on delete set null, not
--     cascade, so that the day's row — and «one post a day» — survives the deletion). answered = presses (everyone);
--     counter_shown / counter_at = the last «Ответили N» edit (at most once a minute); close_at / close_tries = the
--     close's lease; purged_at = the answers were deleted (two days after closed_at).
create table if not exists bot.group_posts (
  id bigint generated always as identity primary key,
  chat_id bigint not null references bot.groups(chat_id) on update cascade on delete cascade,
  local_day date not null,
  item_id uuid references public.test_items(id) on delete set null,
  item_rev integer,
  shown smallint[],
  status text not null default 'claimed',
  attempts smallint not null default 1,
  claimed_at timestamptz not null default now(),
  sending_at timestamptz,
  posted_at timestamptz,
  tg_message_id bigint,
  answered integer not null default 0,
  counter_shown integer not null default 0,
  counter_at timestamptz,
  close_at timestamptz,
  close_tries smallint not null default 0,
  closed_at timestamptz,
  purged_at timestamptz,
  error text,
  constraint group_posts_once unique (chat_id, local_day),
  constraint group_posts_status_check check (status in ('claimed', 'sending', 'open', 'closed', 'failed', 'unknown')),
  constraint group_posts_shown_check check (shown is null or cardinality(shown) between 2 and 8),
  constraint group_posts_counts_check check (answered >= 0 and counter_shown >= 0 and attempts >= 1 and close_tries >= 0),
  constraint group_posts_message_check check (tg_message_id is null or tg_message_id > 0),
  constraint group_posts_error_check check (error is null or char_length(error) <= 200)
);
create index if not exists group_posts_item_idx on bot.group_posts (item_id);
create index if not exists group_posts_live_idx on bot.group_posts (status, local_day)
  where status in ('claimed', 'sending', 'open', 'unknown');
create index if not exists group_posts_purge_idx on bot.group_posts (closed_at) where purged_at is null;
create index if not exists group_posts_day_idx on bot.group_posts (local_day);
comment on table bot.group_posts is 'One «Вопрос дня» a day per group chat: claimed → sending → open → closed (or failed | unknown). Never holds the key.';

-- 1c. One press per Telegram user and post (spec §6.2, §6.5): shown = the button index pressed, correct = graded from the
--     key at the press. Kept two days after the post closed (repeat presses, «Ответили N»), then deleted.
create table if not exists bot.group_answers (
  post_id bigint not null references bot.group_posts(id) on delete cascade,
  tg_user_id bigint not null,
  shown smallint not null,
  correct boolean not null,
  at timestamptz not null default now(),
  primary key (post_id, tg_user_id),
  constraint group_answers_user_check check (tg_user_id > 0),
  constraint group_answers_shown_check check (shown between 0 and 7)
);
comment on table bot.group_answers is 'Presses on a «Вопрос дня»: one per Telegram user and post; deleted two days after the close.';

alter table bot.groups enable row level security;
alter table bot.group_posts enable row level security;
alter table bot.group_answers enable row level security;

-- 2. Helpers (schema bot: not reachable by clients; they run inside the DEFINER functions, as the migration role).
-- 2a. The hours of G0: 9:00 · 12:00 · 15:00 · 18:00.
create or replace function bot.group_hour_ok(p_hour integer)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select p_hour is not null and p_hour in (9, 12, 15, 18)
$fn$;

-- 2b. A chat title as it is kept: control characters dropped, spaces collapsed, ≤ 128 characters; empty → null.
create or replace function bot.group_title(p_title text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select nullif(pg_catalog.btrim(pg_catalog.left(pg_catalog.btrim(pg_catalog.regexp_replace(
           pg_catalog.regexp_replace(coalesce(p_title, ''), '[[:cntrl:]]', ' ', 'g'), '\s+', ' ', 'g')), 128)), '')
$fn$;

-- 2c. The post window in local wall time: from the hour, at most 3 hours late, never at 20:00 or later (an hour before
--     the 21:00 close).
create or replace function bot.group_in_window(p_local timestamp, p_hour integer)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select p_local::time >= pg_catalog.make_time(p_hour, 0, 0)
     and p_local::time < least(pg_catalog.make_time(p_hour, 0, 0) + interval '3 hours', time '20:00')
$fn$;

-- 2d. A post closes at 21:00 of its local day.
create or replace function bot.group_close_at(p_day date, p_tz text)
returns timestamptz
language sql
stable
set search_path = ''
as $fn$
  select (p_day + time '21:00') at time zone p_tz
$fn$;

-- 2e. Is this group link of the container still open (not revoked, not expired)?
create or replace function bot.group_link_active(p_link_id uuid, p_now timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select p_link_id is not null
     and exists (select 1 from public.container_links l
                  where l.id = p_link_id and l.revoked_at is null and (l.expires_at is null or l.expires_at > p_now))
$fn$;

-- 2f. An exam's own dates (spec §4.6 «Поста нет в день экзамена и после даты»): after_date when the day is after the
--     last test date (a subject's own date, else the exam's), exam_day when it is one of them; null otherwise or without
--     a date.
create or replace function bot.group_day_stop(p_container uuid, p_day date)
returns text
language sql
stable
set search_path = ''
as $fn$
  with d as (
    select coalesce(s.exam_date, c.exam_date) as sd
      from public.containers c
      left join public.container_subjects s on s.container_id = c.id
     where c.id = p_container
  )
  select case when p_day > (select pg_catalog.max(d.sd) from d) then 'after_date'
              when exists (select 1 from d where d.sd = p_day) then 'exam_day' end
$fn$;

-- 2g. Why a group gets no post on this day (null = it may): left | off | link | exam_day | after_date.
create or replace function bot.group_stop(p_g bot.groups, p_day date, p_now timestamptz)
returns text
language sql
stable
set search_path = ''
as $fn$
  select case when p_g.chat_id is null or p_g.left_at is not null then 'left'
              when p_g.off_at is not null then 'off'
              when not bot.group_link_active(p_g.link_id, p_now) then 'link'
              else bot.group_day_stop(p_g.container_id, p_day) end
$fn$;

-- 2h. May this question be a «Вопрос дня» (spec decision 26; Concept 2 §3.15 «blocked»)? Only one-answer questions with
--     a key, 2–8 options, no lost image, no open doubt of anyone (set aside), and short enough for a chat: stem and
--     options together at most 1500 characters. Several correct options, short answers, set-aside and long questions
--     are never posted.
create or replace function bot.group_item_ok(p_i public.test_items)
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select p_i.id is not null and p_i.kind = 'single' and p_i.keyed and pg_catalog.cardinality(p_i.correct) = 1
     and not ('has_image' = any (p_i.flags))
     and pg_catalog.jsonb_array_length(p_i.options) between 2 and 8
     and pg_catalog.char_length(p_i.stem)
         + coalesce((select pg_catalog.sum(pg_catalog.char_length(o.value))
                       from pg_catalog.jsonb_array_elements_text(p_i.options) o), 0) <= 1500
     and not exists (select 1 from public.test_key_doubts d where d.item_id = p_i.id and d.resolved_at is null)
$fn$;

-- 2i. The summary «Вопрос дня» is picked from (bot.group_candidates; spec decision 26, Concept 2 §3.15): exactly the
--     GroupInput of frontend/src/lib/containers/group.ts — {day, items, recent, minGapDays: 14} — so the function hands
--     it to pickGroupQuestion() as it is. One entry per question that may be posted today (bot.group_item_ok, its
--     subject's test date not today or past), plus the question of the chat's last post (marked blocked when it may not
--     be posted, so group.ts still sees its topic). rev = the question's id (the identity group.ts compares; the bot
--     passes it back to bot_group_pick), label = its number in the file. Counts over the exam's people (the author and
--     the active members), current-rev states only: members; confirmable (a series started on another local day ≥ 20 h
--     ago and not counted yet, no peek today: it can turn into «верно в два разных дня» now); relearn (the last counted
--     answer was wrong or «Не знаю»); due (counted, its check is due); unseen (no answer under the current key). recent
--     = the chat's posts of the last 30 days before today that went out (open, closed, unknown). No user id, no name.
create or replace function bot.group_candidates(p_chat_id bigint, p_container uuid, p_day date, p_tz text,
                                                p_now timestamptz)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  with users as (
    select c.owner_id as user_id from public.containers c where c.id = p_container
    union
    select m.user_id from public.container_members m
     where m.container_id = p_container and m.left_at is null and m.removed_at is null
  ),
  people as (select pg_catalog.count(*)::integer as n from users),
  recent as (
    select p.item_id, p.local_day from bot.group_posts p
     where p.chat_id = p_chat_id and p.local_day < p_day and p.local_day >= p_day - 30
       and p.item_id is not null and p.status in ('open', 'closed', 'unknown')
  ),
  last_post as (select r.item_id from recent r order by r.local_day desc limit 1),
  items as (
    select i.id, i.rev, i.file_no, i.position, i.topic, s.position as s_pos, coalesce(s.exam_date, c.exam_date) as sd,
           bot.group_item_ok(i) and (coalesce(s.exam_date, c.exam_date) is null or coalesce(s.exam_date, c.exam_date) > p_day)
             as ok
      from public.test_items i
      join public.container_subjects s on s.id = i.subject_id
      join public.containers c on c.id = i.container_id
     where i.container_id = p_container
  ),
  pool as (
    select it.* from items it where it.ok or it.id in (select lp.item_id from last_post lp)
  ),
  agg as (
    select st.item_id,
           pg_catalog.count(*) filter (where st.streak_at is not null and st.two_days_at is null
                                         and st.peek_day is distinct from p_day
                                         and p_now >= greatest(st.streak_at + interval '20 hours',
                                                               ((st.streak_day + 1)::timestamp at time zone p_tz)))::integer
             as confirmable,
           pg_catalog.count(*) filter (where st.last_result in ('wrong', 'dont_know'))::integer as relearn,
           pg_catalog.count(*) filter (where st.two_days_at is not null
                                         and p_now >= meldy_private.due_at(st.named_at, st.checks, p_day,
                                                                           coalesce(s.exam_date, c.exam_date)))::integer
             as due,
           pg_catalog.count(*) filter (where st.first_seen_day is not null)::integer as seen
      from public.test_items i
      join public.test_item_states st on st.item_id = i.id and st.item_rev = i.rev
      join public.container_subjects s on s.id = i.subject_id
      join public.containers c on c.id = i.container_id
     where i.container_id = p_container
       and st.user_id in (select u.user_id from users u)
     group by st.item_id
  )
  select pg_catalog.jsonb_build_object(
    'day', p_day,
    'items', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                'rev', pl.id::text, 'label', coalesce(nullif(pl.file_no, ''), pl.position::text),
                                'topic', pl.topic, 'members', pe.n,
                                'confirmable', coalesce(a.confirmable, 0), 'relearn', coalesce(a.relearn, 0),
                                'due', coalesce(a.due, 0), 'unseen', greatest(pe.n - coalesce(a.seen, 0), 0),
                                'blocked', not pl.ok)
                              order by pl.s_pos, pl.position, pl.id)
                         from pool pl cross join people pe left join agg a on a.item_id = pl.id), '[]'::jsonb),
    'recent', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('rev', r.item_id::text, 'day', r.local_day)
                                                    order by r.local_day, r.item_id)
                          from recent r), '[]'::jsonb),
    'minGapDays', 14)
$fn$;

-- 2j. A post as the function renders it (G2, the counter and the close edits): the subject, the stem, the options IN
--     FILE ORDER and shown (the order on the buttons, null until bot_group_sending). Never correct, never the accepted
--     answers. Null when the question is gone.
create or replace function bot.group_post_view(p_post_id bigint)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  select pg_catalog.jsonb_build_object(
           'post_id', p.id, 'chat_id', p.chat_id, 'local_day', p.local_day, 'subject', s.title,
           'stem', i.stem, 'options', i.options, 'kind', i.kind, 'code', i.code, 'keep_order', i.keep_order,
           'shown', pg_catalog.to_jsonb(p.shown))
    from bot.group_posts p
    join public.test_items i on i.id = p.item_id
    join public.container_subjects s on s.id = i.subject_id
   where p.id = p_post_id
$fn$;

-- 2k. «Теперь 144 из 960 — верно в два разных дня» after a member's answer (G3, step two_days): the exam's figure as the
--     plan counts it from plan_inputs_for — keyed questions not set aside by this user, and those of them counted.
create or replace function bot.group_figure(p_user uuid, p_container uuid)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  select pg_catalog.jsonb_build_object(
           'two_days', pg_catalog.count(*) filter (where st.two_days_at is not null),
           'in_plan', pg_catalog.count(*))
    from public.test_items i
    left join public.test_item_states st on st.user_id = p_user and st.item_id = i.id and st.item_rev = i.rev
   where i.container_id = p_container and i.keyed
     and not exists (select 1 from public.test_key_doubts d
                      where d.item_id = i.id and d.user_id = p_user and d.resolved_at is null)
$fn$;

-- 2l. 5 posts in a row without an answer (spec §4.6): the chat's last five posts before this day that went out since
--     posting was last switched on (an unknown post counts only when someone answered it) all have answered = 0.
create or replace function bot.group_five_empty(p_chat_id bigint, p_on_at timestamptz, p_day date)
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select pg_catalog.count(*) = 5 and coalesce(pg_catalog.bool_and(x.answered = 0), false)
    from (select p.answered from bot.group_posts p
           where p.chat_id = p_chat_id and p.local_day < p_day and p.claimed_at >= p_on_at
             and (p.status in ('open', 'closed') or (p.status = 'unknown' and p.answered > 0))
           order by p.local_day desc
           limit 5) x
$fn$;

-- 2m. One group as the site shows it (telegram_groups, telegram_group_set).
create or replace function bot.group_json(p_g bot.groups, p_now timestamptz)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  select pg_catalog.jsonb_build_object(
           'chat_id', p_g.chat_id, 'title', p_g.title, 'post_hour', p_g.post_hour, 'tz', p_g.tz,
           'on', p_g.off_at is null, 'off_reason', p_g.off_reason, 'bound_at', p_g.bound_at,
           'link_active', bot.group_link_active(p_g.link_id, p_now))
$fn$;

-- 2n. The sweep before every claim (spec decision 7): a post left in sending for 10 minutes becomes unknown and is never
--     sent again; a post claimed and never sent for 3 hours is failed. The same for this package's G4 notices
--     (bot.deliveries kind notice, ref g4:<chat>), as T1's bot.sweep does for its kinds. Rows another session holds are
--     skipped (SKIP LOCKED): two ticks never wait for each other here; the next sweep takes them.
create or replace function bot.group_sweep(p_now timestamptz)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
begin
  update bot.group_posts p set status = 'unknown', error = 'died while sending'
   where p.id in (select x.id from bot.group_posts x
                   where x.status = 'sending' and x.sending_at < p_now - interval '10 minutes'
                     for update skip locked);
  update bot.group_posts p set status = 'failed', error = 'abandoned'
   where p.id in (select x.id from bot.group_posts x
                   where x.status = 'claimed' and x.claimed_at < p_now - interval '3 hours'
                     for update skip locked);
  update bot.deliveries d set status = 'unknown', error = 'died while sending'
   where d.id in (select x.id from bot.deliveries x
                   where x.kind = 'notice' and x.ref like 'g4:%' and x.status = 'sending'
                     and x.claimed_at < p_now - interval '10 minutes'
                     for update skip locked);
  update bot.deliveries d set status = 'failed', error = 'abandoned'
   where d.id in (select x.id from bot.deliveries x
                   where x.kind = 'notice' and x.ref like 'g4:%' and x.status = 'claimed'
                     and x.claimed_at < p_now - interval '3 hours'
                     for update skip locked);
end;
$fn$;

-- 2o. Housekeeping, from every bot_claim_group_closes (bounded, index-backed): the presses of posts closed more than two
--     days ago (spec §6.2), groups the bot left more than 30 days ago (their posts with them), posts older than 90 days.
create or replace function bot.group_cleanup(p_now timestamptz)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_answers integer;
  v_groups integer;
  v_posts integer;
begin
  with done as (
    select p.id from bot.group_posts p
     where p.purged_at is null and p.closed_at < p_now - interval '2 days'
     order by p.closed_at
     limit 500
       for update skip locked
  ),
  gone as (
    delete from bot.group_answers a using done where a.post_id = done.id returning a.post_id
  ),
  marked as (
    update bot.group_posts p set purged_at = p_now from done where p.id = done.id returning p.id
  )
  select (select pg_catalog.count(*) from gone)::integer into v_answers;
  delete from bot.groups g
   where g.chat_id in (select x.chat_id from bot.groups x where x.left_at < p_now - interval '30 days'
                        limit 100 for update skip locked);
  get diagnostics v_groups = row_count;
  delete from bot.group_posts p
   where p.id in (select x.id from bot.group_posts x
                   where x.local_day < (p_now at time zone 'utc')::date - 90
                   limit 1000 for update skip locked);
  get diagnostics v_posts = row_count;
  return pg_catalog.jsonb_build_object('answers', v_answers, 'groups', v_groups, 'posts', v_posts);
end;
$fn$;

-- 2p. T1's hook for the tick's saving mode (bot.tick_due, CONTRACT_T1.md): may a group step have work this minute?
--     Each EXISTS mirrors a claim below, so «due» means that claim would act: a post due (its window open, no post of
--     today), a claimed post or G4 notice to take again, a post left in sending (the sweep), a close due (21:00 local,
--     still open or unknown), an «Ответили N» waiting (new presses, the last edit a minute ago or more). Read only.
create or replace function bot.tick_due_groups(p_now timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select exists (select 1 from bot.groups g
                  where g.left_at is null and g.off_at is null
                    and bot.group_in_window(p_now at time zone g.tz, g.post_hour)
                    and not exists (select 1 from bot.group_posts p
                                     where p.chat_id = g.chat_id and p.local_day = (p_now at time zone g.tz)::date))
      or exists (select 1 from bot.group_posts p join bot.groups g on g.chat_id = p.chat_id
                  where p.status = 'claimed' and p.attempts < 3 and p.claimed_at < p_now - interval '10 minutes'
                    and g.left_at is null and g.off_at is null
                    and p.local_day = (p_now at time zone g.tz)::date
                    and bot.group_in_window(p_now at time zone g.tz, g.post_hour))
      or exists (select 1 from bot.group_posts p
                  where p.status = 'sending' and p.sending_at < p_now - interval '10 minutes')
      or exists (select 1 from bot.group_posts p join bot.groups g on g.chat_id = p.chat_id
                  where p.status in ('open', 'unknown')
                    and ((p_now >= bot.group_close_at(p.local_day, g.tz)
                          and (p.status = 'unknown' or p.close_at is null or p.close_at <= p_now - interval '10 minutes'))
                         or (p.status = 'open' and p.answered > p.counter_shown and p.tg_message_id is not null
                             and p.item_id is not null and g.left_at is null
                             and (p.counter_at is null or p.counter_at <= p_now - interval '1 minute')
                             and p_now < bot.group_close_at(p.local_day, g.tz))))
      or exists (select 1 from bot.deliveries d join bot.links l on l.id = d.link_id
                  where d.kind = 'notice' and d.ref like 'g4:%' and d.status = 'claimed' and d.attempts < 3
                    and d.claimed_at < p_now - interval '10 minutes' and l.unlinked_at is null and l.blocked_at is null)
$fn$;

-- 3. The site (spec §6.3 «Сайт», §4.6 G0): the exam's author in «Пригласить группу» (component GroupBotInvite).
-- 3a. «Подключить беседу»: a fresh G code, shown once, one hour, once; the deep link is
--     t.me/<bot_username>?startgroup=<code>. Only the exam's author (42501), with a linked Telegram (P0002: «Сначала
--     подключите Telegram в профиле.») and an active group link of the exam (MT002). p_post_hour = 9 | 12 | 15 | 18
--     (22023). At most 5 group codes an hour (MT001); a new code ends the author's earlier unused code of this exam.
--     Stored as sha256 only (bot.link_codes, purpose group, with the exam, the hour and the author's zone).
create or replace function public.telegram_group_code(p_container_id uuid, p_post_hour integer default 12)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := pg_catalog.now();
  v_expires timestamptz := pg_catalog.now() + interval '1 hour';
  v_link bot.links%rowtype;
  v_code text;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if not bot.group_hour_ok(p_post_hour) then
    raise exception 'the hour must be 9, 12, 15 or 18' using errcode = '22023';
  end if;
  if p_container_id is null or meldy_private.role_in(v_uid, p_container_id) is distinct from 'owner' then
    raise exception 'only the exam''s author connects a group chat' using errcode = '42501';
  end if;
  select l.* into v_link from bot.links l where l.user_id = v_uid and l.unlinked_at is null;
  if v_link.id is null then
    raise exception 'telegram is not linked' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.container_links cl
                  where cl.container_id = p_container_id and cl.revoked_at is null
                    and (cl.expires_at is null or cl.expires_at > v_now)) then
    raise exception 'the exam has no active group link' using errcode = 'MT002';
  end if;
  -- One author's requests in turn, so the limit and «the older code stops working» hold under concurrency.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bot.group_codes:' || v_uid::text, 0));
  if (select pg_catalog.count(*) from bot.link_codes c
       where c.user_id = v_uid and c.purpose = 'group' and c.created_at > v_now - interval '1 hour') >= 5 then
    raise exception 'too many group codes: try again in an hour' using errcode = 'MT001';
  end if;
  update bot.link_codes c set expires_at = v_now - interval '1 microsecond'
   where c.user_id = v_uid and c.purpose = 'group' and c.container_id = p_container_id and c.used_at is null
     and c.expires_at >= v_now;
  v_code := 'G' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');   -- 122 random bits
  insert into bot.link_codes (code_hash, user_id, purpose, container_id, tz, post_hour, created_at, expires_at)
  values (meldy_private.code_hash(v_code), v_uid, 'group', p_container_id, v_link.tz, p_post_hour, v_now, v_expires);
  return pg_catalog.jsonb_build_object('code', v_code, 'expires_at', v_expires, 'post_hour', p_post_hour,
                                       'bot_username', (select c.bot_username from bot.config c where c.id = 1));
end;
$fn$;

-- 3b. The exam's group chats for its author: whether Telegram is linked and the group link is active (what «Подключить
--     беседу» needs), the hours of G0, and every chat the bot is in for this exam (bot.group_json). Read only.
create or replace function public.telegram_groups(p_container_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := pg_catalog.now();
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if p_container_id is null or meldy_private.role_in(v_uid, p_container_id) is distinct from 'owner' then
    raise exception 'only the exam''s author sees its group chats' using errcode = '42501';
  end if;
  return pg_catalog.jsonb_build_object(
    'telegram_linked', exists (select 1 from bot.links l where l.user_id = v_uid and l.unlinked_at is null),
    'link_active', exists (select 1 from public.container_links cl
                            where cl.container_id = p_container_id and cl.revoked_at is null
                              and (cl.expires_at is null or cl.expires_at > v_now)),
    'bot_username', (select c.bot_username from bot.config c where c.id = 1),
    'hours', '[9, 12, 15, 18]'::jsonb, 'default_hour', 12,
    'groups', coalesce((select pg_catalog.jsonb_agg(bot.group_json(g, v_now) order by g.bound_at, g.chat_id)
                          from bot.groups g
                         where g.container_id = p_container_id and g.left_at is null), '[]'::jsonb));
end;
$fn$;

-- 3c. The author changes a chat's hour and/or turns its question on or off. Null keeps a value. Turning it on (again)
--     restarts the count of the 5-empty rule (on_at); turning it off sets off_reason author. A chat the bot left, or of
--     an exam the caller does not own → P0002. Returns the chat as telegram_groups lists it.
create or replace function public.telegram_group_set(p_chat_id bigint, p_post_hour integer default null,
                                                     p_on boolean default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := pg_catalog.now();
  v_g bot.groups%rowtype;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if p_post_hour is not null and not bot.group_hour_ok(p_post_hour) then
    raise exception 'the hour must be 9, 12, 15 or 18' using errcode = '22023';
  end if;
  select g.* into v_g from bot.groups g where g.chat_id = p_chat_id and g.left_at is null for update;
  if v_g.chat_id is null or meldy_private.role_in(v_uid, v_g.container_id) is distinct from 'owner' then
    raise exception 'no such group chat' using errcode = 'P0002';
  end if;
  update bot.groups g
     set post_hour = coalesce(p_post_hour, g.post_hour),
         off_at = case when p_on is null then g.off_at when p_on then null else coalesce(g.off_at, v_now) end,
         off_reason = case when p_on is null then g.off_reason when p_on then null else 'author' end,
         on_at = case when p_on and g.off_at is not null then v_now else g.on_at end,
         updated_at = v_now
   where g.chat_id = v_g.chat_id
  returning g.* into v_g;
  return bot.group_json(v_g, v_now);
end;
$fn$;

-- 4. The bot: service role only (spec §6.3 «Бот», «беседа»).
-- 4a. /start@bot G<code> in a group chat (spec §4.6 G1, §6.4 «Беседа»). The code is accepted only from the author's
--     linked Telegram (from.id = the active bot.links row of the code's author, who still owns the exam), while it is
--     fresh (judged by the message's date) and unused, in a group or supergroup, while the exam has an active group link.
--     status:
--       bound      the chat is bound (rebinding a chat bound before moves it to this exam, with this hour); again = the
--                  same code from the same Telegram for the same chat (a redelivery: nothing changes);
--       foreign    not the author's linked Telegram («Подключить беседу может только автор экзамена.»);
--       used | expired | no_link   (the code was used, is older than an hour, or the exam has no active group link
--                  any more: «Ссылка устарела. На сайте нажмите «Подключить беседу» ещё раз.»);
--       invalid    not a G code or an unknown one (counts toward 10 failures an hour, as T1's link codes);
--       slow_down  10 failures in the last hour from this Telegram user;
--       not_group  not a group or supergroup chat.
--     Every result has sender_chat_id (the sender's private chat when the sender has a linked Telegram, else null: the
--     only one the bot may write to about the refusal) and chat_bound (this chat is bound to an exam now: then the bot
--     stays in it even after a refusal). bound adds chat_id, container_id, exam_title, title, post_hour, tz,
--     owner_chat_id (= sender_chat_id) and again.
create or replace function public.bot_group_claim(p_code text, p_chat_id bigint, p_chat_type text, p_title text,
                                                  p_from_tg_user_id bigint, p_message_date timestamptz default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := pg_catalog.now();
  v_code bot.link_codes%rowtype;
  v_sender bot.links%rowtype;
  v_owner bot.links%rowtype;
  v_g bot.groups%rowtype;
  v_bound boolean := false;
  v_link uuid;
  v_hour smallint;
  v_refuse jsonb;
begin
  perform meldy_private.require_service_role();
  if p_from_tg_user_id is not null and p_from_tg_user_id > 0 then
    v_sender := bot.active_link(p_from_tg_user_id);
  end if;
  if p_chat_id is not null then
    select g.* into v_g from bot.groups g where g.chat_id = p_chat_id;
    v_bound := v_g.chat_id is not null and v_g.left_at is null;
  end if;
  v_refuse := pg_catalog.jsonb_build_object('sender_chat_id', v_sender.chat_id, 'chat_bound', v_bound);
  if p_chat_id is null or p_chat_id >= 0 or p_chat_type is null or p_chat_type not in ('group', 'supergroup')
     or p_from_tg_user_id is null or p_from_tg_user_id <= 0 then
    return v_refuse || pg_catalog.jsonb_build_object('status', 'not_group');
  end if;
  if (select pg_catalog.count(*) from bot.claim_failures f
       where f.tg_user_id = p_from_tg_user_id and f.failed_at > v_now - interval '1 hour') >= 10 then
    return v_refuse || pg_catalog.jsonb_build_object('status', 'slow_down');
  end if;
  if p_code is null or p_code !~ '^G[0-9a-f]{32}$' then
    insert into bot.claim_failures (tg_user_id, failed_at) values (p_from_tg_user_id, v_now);
    return v_refuse || pg_catalog.jsonb_build_object('status', 'invalid');
  end if;
  -- The code row is locked: two claims of one code (two chats, a redelivery) run one after the other. The chat is read
  -- again after the lock: the claim this one waited for may just have bound it.
  select c.* into v_code from bot.link_codes c
   where c.code_hash = meldy_private.code_hash(p_code) and c.purpose = 'group'
     for update;
  if v_code.code_hash is null then
    insert into bot.claim_failures (tg_user_id, failed_at) values (p_from_tg_user_id, v_now);
    return v_refuse || pg_catalog.jsonb_build_object('status', 'invalid');
  end if;
  v_g := null;
  select g.* into v_g from bot.groups g where g.chat_id = p_chat_id;
  v_bound := v_g.chat_id is not null and v_g.left_at is null;
  v_refuse := pg_catalog.jsonb_build_object('sender_chat_id', v_sender.chat_id, 'chat_bound', v_bound);
  select l.* into v_owner from bot.links l where l.user_id = v_code.user_id and l.unlinked_at is null;
  if v_owner.id is null or v_owner.tg_user_id <> p_from_tg_user_id
     or meldy_private.role_in(v_code.user_id, v_code.container_id) is distinct from 'owner' then
    return v_refuse || pg_catalog.jsonb_build_object('status', 'foreign');
  end if;
  if v_code.used_at is not null then
    if v_code.used_by_tg = p_from_tg_user_id and v_bound and v_g.container_id = v_code.container_id
       and v_g.bound_at = v_code.used_at then
      return pg_catalog.jsonb_build_object(
        'status', 'bound', 'again', true, 'chat_id', v_g.chat_id, 'container_id', v_g.container_id,
        'exam_title', (select c.title from public.containers c where c.id = v_g.container_id),
        'title', v_g.title, 'post_hour', v_g.post_hour, 'tz', v_g.tz,
        'owner_chat_id', v_owner.chat_id, 'sender_chat_id', v_owner.chat_id, 'chat_bound', true);
    end if;
    return v_refuse || pg_catalog.jsonb_build_object('status', 'used');
  end if;
  if least(coalesce(p_message_date, v_now), v_now) > v_code.expires_at then
    return v_refuse || pg_catalog.jsonb_build_object('status', 'expired');
  end if;
  select cl.id into v_link from public.container_links cl
   where cl.container_id = v_code.container_id and cl.revoked_at is null and (cl.expires_at is null or cl.expires_at > v_now)
   order by cl.created_at desc, cl.id
   limit 1;
  if v_link is null then
    return v_refuse || pg_catalog.jsonb_build_object('status', 'no_link');
  end if;
  v_hour := case when bot.group_hour_ok(v_code.post_hour) then v_code.post_hour else 12 end;
  update bot.link_codes c set used_at = v_now, used_by_tg = p_from_tg_user_id where c.code_hash = v_code.code_hash;
  insert into bot.groups as g (chat_id, container_id, link_id, owner_id, title, post_hour, tz, bound_at, on_at,
                               off_at, off_reason, left_at, updated_at)
  values (p_chat_id, v_code.container_id, v_link, v_code.user_id, bot.group_title(p_title), v_hour, v_owner.tz,
          v_now, v_now, null, null, null, v_now)
  on conflict (chat_id) do update
     set container_id = excluded.container_id, link_id = excluded.link_id, owner_id = excluded.owner_id,
         title = coalesce(excluded.title, g.title), post_hour = excluded.post_hour, tz = excluded.tz,
         bound_at = excluded.bound_at, on_at = excluded.on_at, off_at = null, off_reason = null, left_at = null,
         updated_at = excluded.updated_at
  returning g.* into v_g;
  return pg_catalog.jsonb_build_object(
    'status', 'bound', 'again', false, 'chat_id', v_g.chat_id, 'container_id', v_g.container_id,
    'exam_title', (select c.title from public.containers c where c.id = v_g.container_id),
    'title', v_g.title, 'post_hour', v_g.post_hour, 'tz', v_g.tz,
    'owner_chat_id', v_owner.chat_id, 'sender_chat_id', v_owner.chat_id, 'chat_bound', true);
end;
$fn$;

-- 4b. my_chat_member and migrations of a group chat (spec §4.6, §6.7): left | kicked → the chat is unbound (left_at;
--     no more posts, no close edits); migrated (migrate_to_chat_id: the group became a supergroup) → the group and its
--     posts move to p_new_chat_id (when that chat is already bound itself, it keeps its binding and the old one ends).
--     status ok, changed = a bound chat was there to change; chat_id = where the group is now. A chat that is not bound
--     → changed false. Raises 22023 for an unknown event or a migration without a new group chat id.
create or replace function public.bot_group_event(p_chat_id bigint, p_event text, p_new_chat_id bigint default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := pg_catalog.now();
  v_old bot.groups%rowtype;
  v_new bot.groups%rowtype;
begin
  perform meldy_private.require_service_role();
  if p_event is null or p_event not in ('left', 'kicked', 'migrated') then
    raise exception 'unknown group event' using errcode = '22023';
  end if;
  if p_event in ('left', 'kicked') then
    update bot.groups g set left_at = v_now, updated_at = v_now where g.chat_id = p_chat_id and g.left_at is null;
    return pg_catalog.jsonb_build_object('status', 'ok', 'changed', found, 'chat_id', p_chat_id);
  end if;
  if p_new_chat_id is null or p_new_chat_id >= 0 or p_new_chat_id = p_chat_id then
    raise exception 'a migration needs the new group chat id' using errcode = '22023';
  end if;
  select g.* into v_old from bot.groups g where g.chat_id = p_chat_id for update;
  if v_old.chat_id is null or v_old.left_at is not null then
    return pg_catalog.jsonb_build_object('status', 'ok', 'changed', false, 'chat_id', p_chat_id);
  end if;
  select g.* into v_new from bot.groups g where g.chat_id = p_new_chat_id for update;
  if v_new.chat_id is not null and v_new.left_at is null then
    update bot.groups g set left_at = v_now, updated_at = v_now where g.chat_id = p_chat_id;
    return pg_catalog.jsonb_build_object('status', 'ok', 'changed', true, 'chat_id', p_new_chat_id);
  end if;
  if v_new.chat_id is not null then
    delete from bot.groups g where g.chat_id = p_new_chat_id;   -- an old unbound row of the new chat (its posts with it)
  end if;
  update bot.groups g set chat_id = p_new_chat_id, updated_at = v_now where g.chat_id = p_chat_id;   -- posts follow
  return pg_catalog.jsonb_build_object('status', 'ok', 'changed', true, 'chat_id', p_new_chat_id);
end;
$fn$;

-- 4c. «Заниматься в Meldy» (/start g<chat id> in the private chat, spec §4.6): which exam that group chat is bound to and
--     the user's place in it. {linked: false} (M1) | {linked: true, status: unknown} (no bound group with this id) |
--     {linked: true, status: ok, container_id, exam_title, role: owner | member | null} (null = linked, not in this exam:
--     «Экзамен «…»» / «Он приходит по ссылке группы…»; owner or member → K1). Read only.
create or replace function public.bot_group_entry(p_tg_user_id bigint, p_chat_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_l bot.links%rowtype;
  v_g bot.groups%rowtype;
begin
  perform meldy_private.require_service_role();
  v_l := bot.active_link(p_tg_user_id);
  if v_l.id is null then
    return pg_catalog.jsonb_build_object('linked', false);
  end if;
  select g.* into v_g from bot.groups g where g.chat_id = p_chat_id and g.left_at is null;
  if v_g.chat_id is null then
    return pg_catalog.jsonb_build_object('linked', true, 'status', 'unknown');
  end if;
  return pg_catalog.jsonb_build_object(
    'linked', true, 'status', 'ok', 'container_id', v_g.container_id,
    'exam_title', (select c.title from public.containers c where c.id = v_g.container_id),
    'role', meldy_private.role_in(v_l.user_id, v_g.container_id));
end;
$fn$;

-- 4d. The tick's step 2 (spec §6.6): posts to send, at most p_limit new ones (default 10, ≤ 100). Each row is one of:
--       kind post: post_id, chat_id (the group chat), local_day, container_id, title, exam_title and candidates (the
--                  GroupInput of group.ts, bot.group_candidates). Then: pickGroupQuestion(candidates) →
--                  bot_group_pick(post_id, pick.rev | null) → bot_group_sending(post_id, shown) → sendMessage →
--                  bot_group_posted(post_id, …).
--       kind g4:   delivery_id, chat_id (the author's private chat), group_chat_id, local_day, container_id, title (the
--                  chat's), exam_title: the group just turned off after 5 posts in a row without an answer — send G4
--                  once through T1's bot_delivery_sending(delivery_id) → sendMessage → bot_delivery_done(delivery_id, …).
--     A group is due when its window is open (bot.group_in_window: the hour, ≤ 3 hours late, before 20:00 local), it is
--     bound and on, and it has no post row today. Then: a revoked or expired group link turns it off (off_reason link);
--     an exam day or a day after the last date leaves a failed row for the day (error exam_day | after_date: no post,
--     nothing to retry); 5 empty posts in a row turn it off (off_reason empty) and hand out G4 (bot.deliveries kind
--     notice, ref g4:<chat>, unique per author's chat and day) when the author's Telegram is linked and not blocked;
--     otherwise the day's row is claimed. Concurrency: due groups are locked with SKIP LOCKED and the day's row is
--     unique, so two ticks at once claim one post per chat. First the sweep (bot.group_sweep); a post claimed and never
--     sent is offered again after 10 minutes (at most 3 tries, still in its window), so is a G4 notice. p_now is for
--     tests.
create or replace function public.bot_claim_group_posts(p_limit integer default 10, p_now timestamptz default null)
returns table (kind text, post_id bigint, delivery_id bigint, chat_id bigint, group_chat_id bigint, local_day date,
               container_id uuid, title text, exam_title text, candidates jsonb)
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
#variable_conflict use_column
declare
  v_now timestamptz := coalesce(p_now, pg_catalog.now());
  v_limit integer := greatest(1, least(coalesce(p_limit, 10), 100));
  v_r record;
  v_g bot.groups%rowtype;
  v_day date;
  v_stop text;
  v_post bigint;
  v_owner bot.links%rowtype;
  v_delivery bigint;
begin
  perform meldy_private.require_service_role();
  perform bot.group_sweep(v_now);

  -- G4 notices claimed and never tried (the function died after the claim): again after 10 minutes, at most 3 tries.
  for v_r in
    update bot.deliveries d set claimed_at = v_now, attempts = d.attempts + 1
     where d.id in (select x.id from bot.deliveries x join bot.links l on l.id = x.link_id
                     where l.unlinked_at is null and l.blocked_at is null
                       and x.kind = 'notice' and x.ref like 'g4:%' and x.status = 'claimed' and x.attempts < 3
                       and x.claimed_at < v_now - interval '10 minutes'
                       for update of x skip locked)
    returning d.id, d.chat_id, d.local_day, pg_catalog.substr(d.ref, 4)::bigint as gchat
  loop
    kind := 'g4'; post_id := null; delivery_id := v_r.id; chat_id := v_r.chat_id; group_chat_id := v_r.gchat;
    local_day := v_r.local_day; candidates := null;
    select g.container_id, g.title, c.title into container_id, title, exam_title
      from bot.groups g join public.containers c on c.id = g.container_id where g.chat_id = v_r.gchat;
    return next;
  end loop;

  -- Posts claimed and never sent (the function died before bot_group_sending): again after 10 minutes, at most 3 tries,
  -- while their window is still open.
  for v_r in
    update bot.group_posts p set claimed_at = v_now, attempts = p.attempts + 1, error = null
      from bot.groups g
     where g.chat_id = p.chat_id
       and p.id in (select x.id from bot.group_posts x join bot.groups y on y.chat_id = x.chat_id
                     where x.status = 'claimed' and x.attempts < 3 and x.claimed_at < v_now - interval '10 minutes'
                       and y.left_at is null and y.off_at is null
                       and x.local_day = (v_now at time zone y.tz)::date
                       and bot.group_in_window(v_now at time zone y.tz, y.post_hour)
                       for update of x skip locked)
    returning p.id, p.chat_id, p.local_day, g.container_id as cid, g.title as gtitle, g.tz as gtz
  loop
    kind := 'post'; post_id := v_r.id; delivery_id := null; chat_id := v_r.chat_id; group_chat_id := v_r.chat_id;
    local_day := v_r.local_day; container_id := v_r.cid; title := v_r.gtitle;
    exam_title := (select c.title from public.containers c where c.id = v_r.cid);
    candidates := bot.group_candidates(v_r.chat_id, v_r.cid, v_r.local_day, v_r.gtz, v_now);
    return next;
  end loop;

  -- New posts.
  for v_g in
    select g.* from bot.groups g
     where g.left_at is null and g.off_at is null
       and bot.group_in_window(v_now at time zone g.tz, g.post_hour)
       and not exists (select 1 from bot.group_posts p
                        where p.chat_id = g.chat_id and p.local_day = (v_now at time zone g.tz)::date)
     order by g.post_hour, g.chat_id
     limit v_limit
       for update of g skip locked
  loop
    v_day := (v_now at time zone v_g.tz)::date;
    v_stop := bot.group_stop(v_g, v_day, v_now);
    if v_stop = 'link' then
      update bot.groups g set off_at = v_now, off_reason = 'link', updated_at = v_now where g.chat_id = v_g.chat_id;
      continue;
    elsif v_stop is not null then
      insert into bot.group_posts (chat_id, local_day, status, claimed_at, error)
      values (v_g.chat_id, v_day, 'failed', v_now, v_stop)
      on conflict on constraint group_posts_once do nothing;
      continue;
    end if;
    if bot.group_five_empty(v_g.chat_id, v_g.on_at, v_day) then
      update bot.groups g set off_at = v_now, off_reason = 'empty', updated_at = v_now where g.chat_id = v_g.chat_id;
      v_owner := null;
      v_delivery := null;
      select l.* into v_owner from bot.links l
       where l.user_id = v_g.owner_id and l.unlinked_at is null and l.blocked_at is null;
      if v_owner.id is not null then
        insert into bot.deliveries (kind, chat_id, link_id, local_day, ref, claimed_at)
        values ('notice', v_owner.chat_id, v_owner.id, v_day, 'g4:' || v_g.chat_id::text, v_now)
        on conflict do nothing
        returning bot.deliveries.id into v_delivery;
      end if;
      if v_delivery is not null then
        kind := 'g4'; post_id := null; delivery_id := v_delivery; chat_id := v_owner.chat_id;
        group_chat_id := v_g.chat_id; local_day := v_day; container_id := v_g.container_id; title := v_g.title;
        exam_title := (select c.title from public.containers c where c.id = v_g.container_id);
        candidates := null;
        return next;
      end if;
      continue;
    end if;
    v_post := null;
    insert into bot.group_posts (chat_id, local_day, status, claimed_at)
    values (v_g.chat_id, v_day, 'claimed', v_now)
    on conflict on constraint group_posts_once do nothing
    returning bot.group_posts.id into v_post;
    if v_post is not null then
      kind := 'post'; post_id := v_post; delivery_id := null; chat_id := v_g.chat_id; group_chat_id := v_g.chat_id;
      local_day := v_day; container_id := v_g.container_id; title := v_g.title;
      exam_title := (select c.title from public.containers c where c.id = v_g.container_id);
      candidates := bot.group_candidates(v_g.chat_id, v_g.container_id, v_day, v_g.tz, v_now);
      return next;
    end if;
  end loop;
end;
$fn$;

-- 4e. The pick (spec decision 26): p_rev = pickGroupQuestion(candidates).rev, or null when it returned null. The
--     question must be one the summary offers (bot.group_item_ok, its subject's date not reached) of the chat's exam.
--     status: picked + question (bot.group_post_view: subject, stem, options in FILE order, keep_order, code — no key;
--     shown is still null: compute the order with the copied session.ts optionOrder(n, keep_order,
--     pinnedLast(options), seed) and pass it to bot_group_sending) | none (p_rev null: no post today, the row is failed
--     'none') | invalid (not such a question now: the row stays claimed and comes back after 10 minutes with a fresh
--     summary) | gone (the row is not claimed any more: another tick has it, or it was closed).
create or replace function public.bot_group_pick(p_post_id bigint, p_rev text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_p bot.group_posts%rowtype;
  v_g bot.groups%rowtype;
  v_i public.test_items%rowtype;
  v_sd date;
begin
  perform meldy_private.require_service_role();
  select p.* into v_p from bot.group_posts p where p.id = p_post_id for update;
  if v_p.id is null or v_p.status <> 'claimed' then
    return pg_catalog.jsonb_build_object('status', 'gone', 'post_id', p_post_id);
  end if;
  if p_rev is null then
    update bot.group_posts p set status = 'failed', error = 'none' where p.id = v_p.id;
    return pg_catalog.jsonb_build_object('status', 'none', 'post_id', v_p.id);
  end if;
  select g.* into v_g from bot.groups g where g.chat_id = v_p.chat_id;
  if p_rev ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select i.* into v_i from public.test_items i where i.id = p_rev::uuid and i.container_id = v_g.container_id;
  end if;
  if v_i.id is not null then
    select coalesce(s.exam_date, c.exam_date) into v_sd
      from public.container_subjects s join public.containers c on c.id = s.container_id
     where s.id = v_i.subject_id;
  end if;
  if v_i.id is null or not bot.group_item_ok(v_i) or v_sd <= v_p.local_day then
    return pg_catalog.jsonb_build_object('status', 'invalid', 'post_id', v_p.id);
  end if;
  update bot.group_posts p set item_id = v_i.id, item_rev = v_i.rev, shown = null where p.id = v_p.id;
  return pg_catalog.jsonb_build_object('status', 'picked', 'post_id', v_p.id, 'chat_id', v_p.chat_id,
                                       'local_day', v_p.local_day, 'question', bot.group_post_view(v_p.id));
end;
$fn$;

-- 4f. Right before sendMessage (spec decision 7, §6.5): claimed → sending, with the order of the options on the buttons
--     (p_shown: a permutation of 0..n−1 of the file indices; anything else raises 22023). true → send now; false → do
--     NOT send: the row is not claimed or picked any more (another tick), or the post may not go out: the group left or
--     was turned off, its link ended, an exam day or after the date, the day or its window (before 20:00) passed (the
--     row is then failed with that reason), or the question changed since the pick (the row stays claimed and comes
--     back after 10 minutes). p_now is for tests.
create or replace function public.bot_group_sending(p_post_id bigint, p_shown integer[], p_now timestamptz default null)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := coalesce(p_now, pg_catalog.now());
  v_p bot.group_posts%rowtype;
  v_g bot.groups%rowtype;
  v_i public.test_items%rowtype;
  v_n integer;
  v_local timestamp;
  v_stop text;
begin
  perform meldy_private.require_service_role();
  select p.* into v_p from bot.group_posts p where p.id = p_post_id for update;
  if v_p.id is null or v_p.status <> 'claimed' or v_p.item_id is null then
    return false;
  end if;
  select i.* into v_i from public.test_items i where i.id = v_p.item_id;
  v_n := pg_catalog.jsonb_array_length(v_i.options);
  if p_shown is null or pg_catalog.cardinality(p_shown) <> v_n
     or (select pg_catalog.count(distinct x) from pg_catalog.unnest(p_shown) x where x between 0 and v_n - 1) <> v_n then
    raise exception 'shown must be an order of the % options', v_n using errcode = '22023';
  end if;
  if v_i.rev <> v_p.item_rev or not bot.group_item_ok(v_i) then
    return false;
  end if;
  select g.* into v_g from bot.groups g where g.chat_id = v_p.chat_id;
  v_local := v_now at time zone v_g.tz;
  v_stop := case when v_local::date <> v_p.local_day or v_local::time >= time '20:00' then 'late'
                 else bot.group_stop(v_g, v_p.local_day, v_now) end;
  if v_stop is not null then
    update bot.group_posts p set status = 'failed', error = v_stop where p.id = v_p.id;
    return false;
  end if;
  update bot.group_posts p set shown = p_shown::smallint[], status = 'sending', sending_at = v_now where p.id = v_p.id;
  return true;
end;
$fn$;

-- 4g. The outcome of sendMessage: sent (+ the message id) → open; failed (+ an error name: 400, 403 — nothing was posted)
--     → failed; unknown (a timeout or 5xx: maybe posted) → unknown; retry (429, migrate_to_chat_id: certainly not
--     posted) → claimed again (offered after 10 minutes, at most 3 tries, in its window). From sending only (sent also
--     from unknown: a late answer). status ok | ignored. Raises 22023 for an unknown status or sent without a message id.
create or replace function public.bot_group_posted(p_post_id bigint, p_status text, p_tg_message_id bigint default null,
                                                   p_error text default null, p_now timestamptz default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := coalesce(p_now, pg_catalog.now());
begin
  perform meldy_private.require_service_role();
  if p_status is null or p_status not in ('sent', 'failed', 'unknown', 'retry')
     or (p_status = 'sent' and (p_tg_message_id is null or p_tg_message_id <= 0)) then
    raise exception 'invalid post status' using errcode = '22023';
  end if;
  update bot.group_posts p
     set status = case p_status when 'sent' then 'open' when 'retry' then 'claimed' else p_status end,
         tg_message_id = case when p_status = 'sent' then p_tg_message_id else p.tg_message_id end,
         posted_at = case when p_status = 'sent' then v_now else p.posted_at end,
         claimed_at = case when p_status = 'retry' then v_now else p.claimed_at end,
         error = case when p_status = 'sent' then null else pg_catalog.left(p_error, 200) end
   where p.id = p_post_id
     and (p.status = 'sending' or (p_status = 'sent' and p.status = 'unknown'));
  if found then
    return pg_catalog.jsonb_build_object('status', 'ok');
  end if;
  if p_status = 'sent' and exists (select 1 from bot.group_posts p
                                    where p.id = p_post_id and p.status = 'open' and p.tg_message_id = p_tg_message_id) then
    return pg_catalog.jsonb_build_object('status', 'ok');   -- the same outcome again
  end if;
  return pg_catalog.jsonb_build_object('status', 'ignored');
end;
$fn$;

-- 4h. A press on a post (callback g|<post base36>|<i>, spec §4.6 G3, decision 25): p_shown = the button index i; p_chat_id
--     and p_message_id = the callback message's chat and id (always pass them: a press must come from the post's own
--     chat, and a post that died while sending gets its message id back from the first press). The first press of a
--     Telegram user is stored (bot.group_answers) and counted («Ответили N»); then, for a linked Telegram, it goes
--     through meldy_private.record_test_answers_for(user, …, 'bot_group') with client_event_id tgq:<post_id>:<tg_user_id>,
--     the shown order and the user's local day: a member (or the author) gets a test_answers row; linked but not in the
--     exam → the core says gone and nothing is written. status:
--       answered  who member | unlinked | outsider; correct; choice {shown, text}; key {shown, text} (the key, for this
--                 user's toast only); answered (the count now); for a member also recorded (the core wrote or had the
--                 tgq row), core (its status), step (the rule's verdict) and figure {two_days, in_plan} on step two_days;
--       repeat    the user pressed before: correct, choice and key of the FIRST press, answered (nothing written);
--       closed    reason time (21:00 local passed) | status (not posted, or closed) | stale (the question changed its
--                 options or kind since the post) | gone (no such post): «Вопрос закрыт.» — no key;
--       invalid   reason input | chat (not this post's chat) | shown (no such button): no key.
create or replace function public.bot_group_answer(p_post_id bigint, p_tg_user_id bigint, p_shown integer,
                                                   p_chat_id bigint default null, p_message_id bigint default null,
                                                   p_now timestamptz default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := coalesce(p_now, pg_catalog.now());
  v_p bot.group_posts%rowtype;
  v_g bot.groups%rowtype;
  v_i public.test_items%rowtype;
  v_file smallint;
  v_key smallint;
  v_correct boolean;
  v_keyj jsonb;
  v_first bot.group_answers%rowtype;
  v_count integer;
  v_l bot.links%rowtype;
  v_res jsonb;
  v_core text;
  v_step text;
  v_who text;
  v_figure jsonb;
begin
  perform meldy_private.require_service_role();
  if p_post_id is null or p_tg_user_id is null or p_tg_user_id <= 0 or p_shown is null or p_shown not between 0 and 7 then
    return pg_catalog.jsonb_build_object('status', 'invalid', 'reason', 'input');
  end if;
  -- The post's row is locked: presses of one post, its counter and its close run one after the other.
  select p.* into v_p from bot.group_posts p where p.id = p_post_id for update;
  if v_p.id is null then
    return pg_catalog.jsonb_build_object('status', 'closed', 'reason', 'gone');
  end if;
  if p_chat_id is not null and p_chat_id <> v_p.chat_id then
    return pg_catalog.jsonb_build_object('status', 'invalid', 'reason', 'chat');
  end if;
  select g.* into v_g from bot.groups g where g.chat_id = v_p.chat_id;
  if v_p.status not in ('open', 'sending', 'unknown') or v_p.shown is null or v_p.item_id is null then
    return pg_catalog.jsonb_build_object('status', 'closed', 'reason', 'status');
  end if;
  if v_now >= bot.group_close_at(v_p.local_day, v_g.tz) then
    return pg_catalog.jsonb_build_object('status', 'closed', 'reason', 'time');
  end if;
  if p_shown >= pg_catalog.cardinality(v_p.shown) then
    return pg_catalog.jsonb_build_object('status', 'invalid', 'reason', 'shown');
  end if;
  select i.* into v_i from public.test_items i where i.id = v_p.item_id;
  if v_i.id is null or v_i.kind <> 'single' or pg_catalog.cardinality(v_i.correct) <> 1
     or pg_catalog.jsonb_array_length(v_i.options) <> pg_catalog.cardinality(v_p.shown) then
    return pg_catalog.jsonb_build_object('status', 'closed', 'reason', 'stale');
  end if;
  -- A post that died while sending is on the chat after all (this press came from it): keep its message id, so the
  -- counter and the close can edit it. Message ids grow within a chat: never one of an earlier post.
  if v_p.tg_message_id is null and v_p.status in ('sending', 'unknown') and p_chat_id = v_p.chat_id
     and p_message_id is not null and p_message_id > 0
     and p_message_id > coalesce((select pg_catalog.max(x.tg_message_id) from bot.group_posts x
                                   where x.chat_id = v_p.chat_id and x.id <> v_p.id), 0) then
    update bot.group_posts p set tg_message_id = p_message_id, status = 'open', posted_at = coalesce(p.posted_at, v_now),
                                 error = null
     where p.id = v_p.id;
  end if;
  v_file := v_p.shown[p_shown + 1];
  v_key := v_i.correct[1];
  v_correct := v_file = v_key;
  v_keyj := pg_catalog.jsonb_build_object('shown', pg_catalog.array_position(v_p.shown, v_key) - 1,
                                          'text', v_i.options ->> v_key::integer);
  insert into bot.group_answers (post_id, tg_user_id, shown, correct, at)
  values (v_p.id, p_tg_user_id, p_shown, v_correct, v_now)
  on conflict (post_id, tg_user_id) do nothing;
  if not found then
    select a.* into v_first from bot.group_answers a where a.post_id = v_p.id and a.tg_user_id = p_tg_user_id;
    return pg_catalog.jsonb_build_object(
      'status', 'repeat', 'correct', v_first.correct,
      'choice', pg_catalog.jsonb_build_object('shown', v_first.shown,
                                              'text', v_i.options ->> (v_p.shown[v_first.shown + 1])::integer),
      'key', v_keyj, 'answered', v_p.answered);
  end if;
  update bot.group_posts p set answered = p.answered + 1 where p.id = v_p.id returning p.answered into v_count;
  v_l := bot.active_link(p_tg_user_id);
  if v_l.id is null then
    v_who := 'unlinked';
  else
    v_res := meldy_private.record_test_answers_for(
               v_l.user_id,
               pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
                 'client_event_id', 'tgq:' || v_p.id::text || ':' || p_tg_user_id::text,
                 'item_id', v_i.id, 'chosen', v_file, 'rev', v_i.rev, 'shown_order', pg_catalog.to_jsonb(v_p.shown),
                 'local_date', pg_catalog.to_char(bot.local_day(v_l.tz, v_now), 'YYYY-MM-DD'))),
               'bot_group', 1);
    v_core := v_res -> 'results' -> 0 ->> 'status';
    v_step := v_res -> 'results' -> 0 ->> 'step';
    v_who := case when v_core = 'gone' then 'outsider' else 'member' end;
    if v_step = 'two_days' then
      v_figure := bot.group_figure(v_l.user_id, v_i.container_id);
    end if;
  end if;
  return pg_catalog.jsonb_build_object(
    'status', 'answered', 'who', v_who, 'correct', v_correct,
    'choice', pg_catalog.jsonb_build_object('shown', p_shown, 'text', v_i.options ->> v_file::integer),
    'key', v_keyj, 'answered', v_count)
    || case when v_who = 'member'
            then pg_catalog.jsonb_build_object('recorded', v_core in ('saved', 'late', 'duplicate'), 'core', v_core,
                                               'step', v_step, 'figure', v_figure)
            else '{}'::jsonb end;
end;
$fn$;

-- 4i. The tick's step 4 (spec §6.6, §4.6 G2): «Ответили N» edits due — open posts with presses since the last edit,
--     the last edit a minute ago or more, before 21:00 local, the message known and the bot still in the chat. Each row
--     is leased (counter_at = now), so two ticks never edit one post twice in a minute. view = bot.group_post_view
--     (re-render G2 with «Ответили N.»), answered = N. Then bot_group_counter_done. p_now is for tests.
create or replace function public.bot_group_counters(p_limit integer default 50, p_now timestamptz default null)
returns table (post_id bigint, chat_id bigint, tg_message_id bigint, answered integer, view jsonb)
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
#variable_conflict use_column
declare
  v_now timestamptz := coalesce(p_now, pg_catalog.now());
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 500));
begin
  perform meldy_private.require_service_role();
  return query
  with due as (
    select p.id from bot.group_posts p join bot.groups g on g.chat_id = p.chat_id
     where p.status = 'open' and p.tg_message_id is not null and p.item_id is not null and g.left_at is null
       and p.answered > p.counter_shown
       and (p.counter_at is null or p.counter_at <= v_now - interval '1 minute')
       and v_now < bot.group_close_at(p.local_day, g.tz)
     order by p.id
     limit v_limit
       for update of p skip locked
  ),
  leased as (
    update bot.group_posts p set counter_at = v_now from due where p.id = due.id
    returning p.id, p.chat_id, p.tg_message_id, p.answered
  )
  select l.id, l.chat_id, l.tg_message_id, l.answered, bot.group_post_view(l.id) from leased l order by l.id;
end;
$fn$;

-- 4j. After a counter edit: shown (the edit went through, or «message is not modified») → counter_shown = p_answered;
--     failed → nothing (tried again a minute later); gone («message to edit not found»: the post was deleted in the chat)
--     → its message id is dropped, no more edits (the close then closes it without one). status ok | ignored.
create or replace function public.bot_group_counter_done(p_post_id bigint, p_answered integer, p_status text default 'shown')
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  perform meldy_private.require_service_role();
  if p_status is null or p_status not in ('shown', 'failed', 'gone') then
    raise exception 'invalid counter status' using errcode = '22023';
  end if;
  if p_status = 'shown' then
    update bot.group_posts p set counter_shown = greatest(p.counter_shown, least(coalesce(p_answered, 0), p.answered))
     where p.id = p_post_id and p.status = 'open';
  elsif p_status = 'gone' then
    update bot.group_posts p set tg_message_id = null where p.id = p_post_id and p.status = 'open';
  else
    perform 1 from bot.group_posts p where p.id = p_post_id and p.status = 'open';
  end if;
  return pg_catalog.jsonb_build_object('status', case when found then 'ok' else 'ignored' end);
end;
$fn$;

-- 4k. The tick's step 1 (spec §6.6, §4.6 G2): posts to close at 21:00 local, once. A post that cannot be edited (no
--     message id: unknown, or deleted in the chat; no question; the bot left the chat; 3 tries) is closed right here,
--     silently. The others are leased for 10 minutes (close_at, close_tries + 1) and returned: edit the post — no
--     keyboard, last line «Вопрос закрыт. Ответили N.» or «Вопрос закрыт.» (answered = 0) — then bot_group_closed. The
--     sweep runs first; the housekeeping (bot.group_cleanup: presses two days after the close) runs last. p_now is for
--     tests.
create or replace function public.bot_claim_group_closes(p_limit integer default 50, p_now timestamptz default null)
returns table (post_id bigint, chat_id bigint, tg_message_id bigint, answered integer, view jsonb)
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
#variable_conflict use_column
declare
  v_now timestamptz := coalesce(p_now, pg_catalog.now());
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 500));
begin
  perform meldy_private.require_service_role();
  perform bot.group_sweep(v_now);
  update bot.group_posts p
     set status = 'closed', closed_at = v_now,
         error = coalesce(p.error, case when p.status = 'unknown' then 'unknown'
                                        when g.left_at is not null then 'left'
                                        when p.tg_message_id is null then 'no message'
                                        when p.item_id is null then 'no question'
                                        else 'close failed' end)
    from bot.groups g
   where g.chat_id = p.chat_id
     and p.id in (select x.id from bot.group_posts x join bot.groups y on y.chat_id = x.chat_id
                   where x.status in ('open', 'unknown')
                     and v_now >= bot.group_close_at(x.local_day, y.tz)
                     and (x.status = 'unknown' or x.tg_message_id is null or x.item_id is null or y.left_at is not null
                          or x.close_tries >= 3)
                     for update of x skip locked);
  return query
  with due as (
    select p.id from bot.group_posts p join bot.groups g on g.chat_id = p.chat_id
     where p.status = 'open' and p.tg_message_id is not null and p.item_id is not null and g.left_at is null
       and v_now >= bot.group_close_at(p.local_day, g.tz)
       and (p.close_at is null or p.close_at <= v_now - interval '10 minutes')
     order by p.id
     limit v_limit
       for update of p skip locked
  ),
  leased as (
    update bot.group_posts p set close_at = v_now, close_tries = p.close_tries + 1 from due where p.id = due.id
    returning p.id, p.chat_id, p.tg_message_id, p.answered
  )
  select l.id, l.chat_id, l.tg_message_id, l.answered, bot.group_post_view(l.id) from leased l order by l.id;
  perform bot.group_cleanup(v_now);
end;
$fn$;

-- 4l. After the close edit: closed (the edit went through, or «message is not modified»), gone («message to edit not
--     found») or failed (any other refusal) → the post is closed for good; retry (a timeout, 5xx, 429) → it stays open and
--     comes back when its lease ends (10 minutes; after 3 tries it is closed without an edit). status ok | ignored.
create or replace function public.bot_group_closed(p_post_id bigint, p_status text default 'closed',
                                                   p_now timestamptz default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := coalesce(p_now, pg_catalog.now());
begin
  perform meldy_private.require_service_role();
  if p_status is null or p_status not in ('closed', 'gone', 'failed', 'retry') then
    raise exception 'invalid close status' using errcode = '22023';
  end if;
  if p_status = 'retry' then
    perform 1 from bot.group_posts p where p.id = p_post_id and p.status = 'open';
  else
    update bot.group_posts p
       set status = 'closed', closed_at = v_now, error = case when p_status = 'closed' then p.error else p_status end
     where p.id = p_post_id and p.status = 'open';
  end if;
  return pg_catalog.jsonb_build_object('status', case when found then 'ok' else 'ignored' end);
end;
$fn$;

-- 5. Grants of this file: the API roles run what is theirs (each function checks its caller itself).
grant execute on function public.telegram_group_code(uuid, integer), public.telegram_groups(uuid),
  public.telegram_group_set(bigint, integer, boolean) to authenticated;
grant execute on function public.bot_group_claim(text, bigint, text, text, bigint, timestamptz),
  public.bot_group_event(bigint, text, bigint), public.bot_group_entry(bigint, bigint),
  public.bot_claim_group_posts(integer, timestamptz), public.bot_group_pick(bigint, text),
  public.bot_group_sending(bigint, integer[], timestamptz), public.bot_group_posted(bigint, text, bigint, text, timestamptz),
  public.bot_group_answer(bigint, bigint, integer, bigint, bigint, timestamptz),
  public.bot_group_counters(integer, timestamptz), public.bot_group_counter_done(bigint, integer, text),
  public.bot_claim_group_closes(integer, timestamptz), public.bot_group_closed(bigint, text, timestamptz)
  to service_role;

-- 6. Revokes (as 20261010120002_telegram_bot_revokes.sql does for T1's objects; T1's schema-wide statements ran before
--    these objects existed): take back what PostgreSQL gives PUBLIC on every new function and what Supabase's default
--    privileges give anon and authenticated in schema public. Safety does not depend on them: every bot_* checks the
--    service role first, every telegram_* checks auth.uid(), schema bot has no USAGE for clients. Self-contained and
--    re-runnable: this section can run on its own (it re-grants what section 5 grants). After it,
--    supabase/tests/telegram_bot.sql (with the T7 lines) reports contract_ok: true.
revoke all on table bot.groups, bot.group_posts, bot.group_answers from public, anon, authenticated;
revoke all on sequence bot.group_posts_id_seq from public, anon, authenticated;
revoke all on function bot.group_hour_ok(integer), bot.group_title(text), bot.group_in_window(timestamp, integer),
  bot.group_close_at(date, text), bot.group_link_active(uuid, timestamptz), bot.group_day_stop(uuid, date),
  bot.group_stop(bot.groups, date, timestamptz), bot.group_item_ok(public.test_items),
  bot.group_candidates(bigint, uuid, date, text, timestamptz), bot.group_post_view(bigint), bot.group_figure(uuid, uuid),
  bot.group_five_empty(bigint, timestamptz, date), bot.group_json(bot.groups, timestamptz), bot.group_sweep(timestamptz),
  bot.group_cleanup(timestamptz), bot.tick_due_groups(timestamptz)
  from public, anon, authenticated;
revoke all on function public.bot_group_claim(text, bigint, text, text, bigint, timestamptz),
  public.bot_group_event(bigint, text, bigint), public.bot_group_entry(bigint, bigint),
  public.bot_claim_group_posts(integer, timestamptz), public.bot_group_pick(bigint, text),
  public.bot_group_sending(bigint, integer[], timestamptz), public.bot_group_posted(bigint, text, bigint, text, timestamptz),
  public.bot_group_answer(bigint, bigint, integer, bigint, bigint, timestamptz),
  public.bot_group_counters(integer, timestamptz), public.bot_group_counter_done(bigint, integer, text),
  public.bot_claim_group_closes(integer, timestamptz), public.bot_group_closed(bigint, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.bot_group_claim(text, bigint, text, text, bigint, timestamptz),
  public.bot_group_event(bigint, text, bigint), public.bot_group_entry(bigint, bigint),
  public.bot_claim_group_posts(integer, timestamptz), public.bot_group_pick(bigint, text),
  public.bot_group_sending(bigint, integer[], timestamptz), public.bot_group_posted(bigint, text, bigint, text, timestamptz),
  public.bot_group_answer(bigint, bigint, integer, bigint, bigint, timestamptz),
  public.bot_group_counters(integer, timestamptz), public.bot_group_counter_done(bigint, integer, text),
  public.bot_claim_group_closes(integer, timestamptz), public.bot_group_closed(bigint, text, timestamptz)
  to service_role;
revoke all on function public.telegram_group_code(uuid, integer), public.telegram_groups(uuid),
  public.telegram_group_set(bigint, integer, boolean) from public, anon;
grant execute on function public.telegram_group_code(uuid, integer), public.telegram_groups(uuid),
  public.telegram_group_set(bigint, integer, boolean) to authenticated;
