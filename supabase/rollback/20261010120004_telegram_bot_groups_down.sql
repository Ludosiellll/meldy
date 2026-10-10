-- telegram_bot_groups rollback (20261010120004_telegram_bot_groups.sql, package T7). The owner runs it by hand in the SQL
-- Editor, never an agent: it deletes the group chats' state (the bindings, the posts, the presses). Nothing of the exam
-- container, the oral path or package T1 changes, except this package's own rows in T1's tables: the G codes
-- (bot.link_codes purpose 'group') and the G4 notices (bot.deliveries kind 'notice', ref g4:…). Test answers made in a
-- group chat stay (they are the container's: source 'bot_group'). In order: the public functions, the helpers of schema
-- bot, the rows in T1's tables, the tables. Run it before T1's rollback (that one drops schema bot without CASCADE).
-- Re-runnable. Locally (telegram_bot_run.sh) the catalog fingerprint after it equals the one before the migration.
begin;
drop function if exists public.bot_group_claim(text, bigint, text, text, bigint, timestamptz),
  public.bot_group_event(bigint, text, bigint), public.bot_group_entry(bigint, bigint),
  public.bot_claim_group_posts(integer, timestamptz), public.bot_group_pick(bigint, text),
  public.bot_group_sending(bigint, integer[], timestamptz), public.bot_group_posted(bigint, text, bigint, text, timestamptz),
  public.bot_group_answer(bigint, bigint, integer, bigint, bigint, timestamptz),
  public.bot_group_counters(integer, timestamptz), public.bot_group_counter_done(bigint, integer, text),
  public.bot_claim_group_closes(integer, timestamptz), public.bot_group_closed(bigint, text, timestamptz);
drop function if exists public.telegram_group_code(uuid, integer), public.telegram_groups(uuid),
  public.telegram_group_set(bigint, integer, boolean);
do $do$
begin
  if pg_catalog.to_regnamespace('bot') is null then
    return;
  end if;
  drop function if exists bot.tick_due_groups(timestamptz), bot.group_cleanup(timestamptz), bot.group_sweep(timestamptz),
    bot.group_five_empty(bigint, timestamptz, date), bot.group_figure(uuid, uuid), bot.group_post_view(bigint),
    bot.group_candidates(bigint, uuid, date, text, timestamptz), bot.group_day_stop(uuid, date),
    bot.group_link_active(uuid, timestamptz), bot.group_close_at(date, text), bot.group_in_window(timestamp, integer),
    bot.group_title(text), bot.group_hour_ok(integer);
  -- These take row types: they go before bot.groups, and while public.test_items is there.
  if pg_catalog.to_regclass('bot.groups') is not null then
    drop function if exists bot.group_stop(bot.groups, date, timestamptz), bot.group_json(bot.groups, timestamptz);
  end if;
  if pg_catalog.to_regclass('public.test_items') is not null then
    drop function if exists bot.group_item_ok(public.test_items);
  end if;
  -- This package's rows in T1's tables.
  if pg_catalog.to_regclass('bot.deliveries') is not null then
    delete from bot.deliveries d where d.kind = 'notice' and d.ref like 'g4:%';
  end if;
  if pg_catalog.to_regclass('bot.link_codes') is not null then
    delete from bot.link_codes c where c.purpose = 'group';
  end if;
  drop table if exists bot.group_answers, bot.group_posts, bot.groups;
end
$do$;
commit;
