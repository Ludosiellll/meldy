-- Цифры Telegram-бота @Meldyteach_bot: привязки, напоминания, занятия в чате, ответы по источникам, K2, паузы и
-- блокировки, вызовы функции. Спецификация — meldy-notes 10_Project/Telegram_Bot_Spec_2026-10-09.md (§6.2 — таблицы
-- схемы bot, §6.5 — ключи ответов); как запускать и что делать с цифрами — docs/telegram-bot.md.
--
-- Только чтение. Запускать в SQL Editor проекта (роль postgres) или через коннектор агента (execute_sql). Ничего не
-- пишет; проверено в транзакции только для чтения. Результат — строки «что · значение (jsonb)», как у
-- docs/container-numbers.sql; у каждой цифры есть знаменатель.
--
-- Кто не считается. Аккаунты из analytics.excluded_accounts (команда, тестовые учётки агентов) не входят никуда; их
-- число — в первой строке (excluded_accounts). Добавить аккаунт:
--   insert into analytics.excluded_accounts (user_id, reason) values ('<uuid>', 'team');
-- Что не выводится никогда: id пользователей, Telegram и чатов, коды, тексты сообщений, токены. Только счётчики, дни
-- и время напоминаний. Ошибки — без цифр (в тексте ошибки Telegram могло оказаться число).
--
-- Дни — местные дни студента: bot.deliveries.local_day, bot.days.local_day, bot.sessions.local_day,
-- test_answers.local_date. Время привязки, отключения и блокировки переводится в пояс ссылки (bot.links.tz; пояс,
-- которого нет в pg_timezone_names, считается Europe/Minsk).
--
-- Колонки. Таблицы и поля — по §6.2 спецификации (файл проверен и на миграции T1 от 2026-10-10). Чего в §6.2
-- нет или что выведено из неё, помечено [допущение]:
--   1) bot.deliveries.answer — ответ на K2 у строки kind 'ask': 'yes' | 'pause' | 'stop'. Читается через
--      to_jsonb(строка) ->> 'answer': если поля нет, запрос не падает, а ответы показываются как null (не 0).
--      Состояние после K2 (now_*) от этого поля не зависит;
--   2) у пропущенного напоминания (status 'skipped') причина лежит в bot.deliveries.error: done / nothing /
--      exam_today / silent (тишина после K2) (§6.6);
--   3) код привязки живёт 15 минут (§2, решение 9), поэтому день выдачи кода = expires_at − 15 минут;
--   4) bot.links.asked_at — когда ушёл последний K2, last_seen_at — последнее действие студента в боте. K2 ждёт
--      ответа («тишина», §4.2), пока после asked_at не было ни действия в боте, ни ответа на вопрос (сайт или бот);
--   5) ответ занятия в чате — строка test_answers с source 'bot' и client_event_id 'tg:<sid>:<позиция>' (§6.5);
--      повтор ошибки внутри занятия — retry = true.
-- Уборка. База сама убирает старые строки бота (T1, раз в час). За окно длиннее срока хранения цифры меньше
-- настоящих: коды хранятся 30 дней после срока и окно в 14 дней покрывают, неудачные попытки — сутки, журнал
-- обновлений — 3 дня. Поэтому вызовы функции считаются по темпу последних 3 дней.
-- Нужны: схема bot (T1: supabase/migrations/20261010120000_telegram_bot.sql), bot.sessions (T5:
-- 20261010120003_telegram_bot_sessions.sql) и контейнер (20261009093500_containers.sql). Без любой из этих таблиц
-- запрос падает на разборе, ничего не прочитав.
-- Параметры: окно [d0, d1] (местные дни).
with params as (
  select (current_date - 13)::date as d0, current_date::date as d1
),
excluded as (select user_id from analytics.excluded_accounts),
-- Пояса один раз: представление pg_timezone_names читает базу поясов при каждом обращении.
tzs as materialized (select name from pg_timezone_names),
-- Ссылки (привязки) без исключённых аккаунтов; пояс — проверенный. k2_silent — тишина после K2 [допущение 4]: ни
-- действия в боте, ни ответа на вопрос (сайт или бот) после asked_at; такому студенту напоминания не идут.
lk as (
  select l.id, l.user_id, l.tg_user_id, l.linked_at, l.unlinked_at, l.blocked_at, l.remind_on, l.remind_at,
         l.paused_until, l.asked_at, l.last_seen_at, coalesce(z.name, 'Europe/Minsk') as tz,
         (now() at time zone coalesce(z.name, 'Europe/Minsk'))::date as today_local,
         (l.asked_at is not null
          and coalesce(l.last_seen_at, '-infinity'::timestamptz) <= l.asked_at
          and not exists (select 1 from public.test_answers a
                           where a.user_id = l.user_id and a.local_date >= (l.asked_at at time zone 'utc')::date - 2
                             and a.created_at > l.asked_at)) as k2_silent
    from bot.links l
    left join tzs z on z.name = l.tz
   where l.user_id not in (select user_id from excluded)
),
-- Коды «Подключить Telegram» (purpose 'link'), выданные в окне, по поясу браузера из кода. [допущение 3]
codes as (
  select c.user_id, c.used_at, c.expires_at
    from bot.link_codes c
    left join tzs z on z.name = c.tz, params p
   where c.purpose = 'link'
     and c.user_id not in (select user_id from excluded)
     and ((c.expires_at - interval '15 minutes') at time zone coalesce(z.name, 'Europe/Minsk'))::date
         between p.d0 and p.d1
),
-- Сообщения, которые бот шлёт сам (§6.2 deliveries), в окне. answer — [допущение 1].
dl as (
  select d.id, d.kind, d.link_id, d.local_day, d.status, d.attempts, d.sent_at,
         regexp_replace(left(coalesce(d.error, '—'), 60), '[0-9]+', 'N', 'g') as error_class,
         to_jsonb(d) ->> 'answer' as answer,
         lk.user_id, lk.tz, lk.remind_at
    from bot.deliveries d
    join lk on lk.id = d.link_id, params p
   where d.local_day between p.d0 and p.d1
),
rem as (select * from dl where kind = 'reminder'),
-- Карточка дня: «Начать» нажали (card_used) — из напоминания или из /today.
dy as (
  select y.link_id, y.local_day, y.card_used
    from bot.days y
    join lk on lk.id = y.link_id, params p
   where y.local_day between p.d0 and p.d1
),
-- Занятия в чате (T5), начатые в окне.
ss as (
  select s.sid, s.user_id, s.kind, s.status, s.local_day
    from bot.sessions s, params p
   where s.local_day between p.d0 and p.d1
     and s.user_id not in (select user_id from excluded)
),
-- Ответы журнала в окне, все источники и режимы, без «late» (старый день, присланный после нового: журнал его
-- хранит, правило нет) — как в docs/container-numbers.sql.
ans as (
  select a.user_id, a.source, a.local_date, a.correct, a.misclick, a.step, a.ms, a.item_id, a.retry,
         a.client_event_id
    from public.test_answers a, params p
   where a.local_date between p.d0 and p.d1
     and a.step <> 'late'
     and a.user_id not in (select user_id from excluded)
),
-- Ответы занятий в чате, по занятию (sid из client_event_id 'tg:<sid>:<позиция>'). [допущение 5]
-- Минуты: ms на ответ не больше 180 с, 30 с, если ms нет (как в docs/container-numbers.sql).
per_sid as (
  select split_part(client_event_id, ':', 2) as sid,
         count(*) as answers,
         count(distinct item_id) filter (where not retry) as base_items,
         sum(least(coalesce(ms, 30000), 180000)) / 60000.0 as minutes
    from ans
   where source = 'bot' and client_event_id like 'tg:%'
   group by 1
),
bot_days as (
  select user_id, count(distinct local_date) as days from ans where source = 'bot' group by user_id
),
reach as (
  select (select count(*) from excluded) as excluded_accounts,
         (select count(distinct user_id) from lk) as linked_ever,
         (select count(distinct user_id) from lk where unlinked_at is null) as linked_now,
         (select count(distinct user_id) from lk
           where unlinked_at is null and blocked_at is null and remind_on and not k2_silent
             and (paused_until is null or paused_until <= today_local)) as getting_plan_now,
         (select count(distinct user_id) from rem where status = 'sent') as got_reminder,
         (select count(distinct lk.user_id) from dy join lk on lk.id = dy.link_id where dy.card_used) as pressed_start,
         (select count(*) from bot_days) as answered_in_bot,
         (select count(*) from bot_days where days >= 2) as bot_days_2_plus,
         (select count(*) from bot_days where days >= 4) as bot_days_4_plus
),
linking as (
  select (select count(*) from codes) as codes_issued,
         (select count(distinct user_id) from codes) as code_people,
         (select count(*) from codes where used_at is not null) as codes_used,
         (select count(*) from codes where used_at is null and expires_at < now()) as codes_expired_unused,
         count(*) filter (where (lk.linked_at at time zone lk.tz)::date between p.d0 and p.d1) as links_made,
         count(distinct lk.user_id) filter (where (lk.linked_at at time zone lk.tz)::date between p.d0 and p.d1)
           as linked_people,
         -- Отключили сами (/stop, «Отключить Telegram» или профиль): более новой ссылки нет ни у аккаунта, ни у
         -- этого Telegram.
         count(*) filter (where (lk.unlinked_at at time zone lk.tz)::date between p.d0 and p.d1
                            and not exists (select 1 from bot.links n
                                             where n.linked_at > lk.linked_at
                                               and (n.user_id = lk.user_id or n.tg_user_id = lk.tg_user_id)))
           as stopped,
         -- Ушли в другой Telegram или на другой аккаунт (M6): новая ссылка победила.
         count(*) filter (where (lk.unlinked_at at time zone lk.tz)::date between p.d0 and p.d1
                            and exists (select 1 from bot.links n
                                         where n.linked_at > lk.linked_at
                                           and (n.user_id = lk.user_id or n.tg_user_id = lk.tg_user_id))) as replaced,
         -- Неудачные попытки кода (тормоз 10 в час), день — по Минску; таблица может чиститься, тогда цифра меньше.
         (select count(*) from bot.claim_failures f, params pp
           where (f.failed_at at time zone 'Europe/Minsk')::date between pp.d0 and pp.d1) as claim_failures
    from lk, params p
),
-- Время по часам студента, когда ушло напоминание, против выбранного — насколько поздно (≤ 3 ч по правилу §6.6;
-- 30 минут ожидания после последнего ответа тоже попадают сюда). Если время сменили после отправки, цифра неточна.
rem_late as (
  select extract(epoch from ((sent_at at time zone tz)::time - remind_at)) / 60.0 as late_min
    from rem where status = 'sent' and sent_at is not null
),
reminders as (
  select count(*) as rows_total,
         count(*) filter (where status = 'sent') as sent,
         count(*) filter (where status = 'skipped') as skipped,
         count(*) filter (where status = 'unknown') as unknown,
         count(*) filter (where status = 'failed') as failed,
         count(*) filter (where status in ('claimed', 'sending')) as in_progress,
         count(*) filter (where attempts > 1) as retaken,
         count(distinct user_id) filter (where status = 'sent') as people,
         count(*) filter (where status = 'sent'
                            and exists (select 1 from dy where dy.link_id = rem.link_id and dy.local_day = rem.local_day
                                                         and dy.card_used)) as sent_then_start,
         count(*) filter (where status = 'sent'
                            and exists (select 1 from ans where ans.user_id = rem.user_id
                                                          and ans.local_date = rem.local_day)) as sent_then_studied
    from rem
),
skipped_why as (  -- [допущение 2]
  select coalesce(jsonb_object_agg(error_class, n), '{}'::jsonb) as v
    from (select error_class, count(*) as n from rem where status = 'skipped' group by 1 order by 2 desc limit 8) x
),
failed_why as (
  select coalesce(jsonb_object_agg(error_class, n), '{}'::jsonb) as v
    from (select error_class, count(*) as n from rem where status in ('failed', 'unknown') group by 1 order by 2 desc
           limit 8) x
),
by_day as (
  select r.local_day, count(*) filter (where r.status = 'sent') as sent,
         count(*) filter (where r.status = 'skipped') as skipped,
         count(*) filter (where r.status in ('failed', 'unknown')) as lost,
         count(*) filter (where r.status = 'sent'
                            and exists (select 1 from dy where dy.link_id = r.link_id and dy.local_day = r.local_day
                                                         and dy.card_used)) as started
    from rem r group by r.local_day
),
answer_col as (  -- есть ли поле ответа на K2 [допущение 1]
  select exists (select 1 from pg_attribute where attrelid = to_regclass('bot.deliveries')
                   and attname = 'answer' and not attisdropped) as present
),
k2 as (  -- K2 «Присылать план дальше?» (kind 'ask'); ответы — [допущение 1], null, если поля нет
  select count(*) filter (where status = 'sent') as sent,
         count(distinct link_id) filter (where status = 'sent') as people,
         case when (select present from answer_col)
              then count(*) filter (where status = 'sent' and answer = 'yes') end as answered_yes,
         case when (select present from answer_col)
              then count(*) filter (where status = 'sent' and answer = 'pause') end as answered_pause,
         case when (select present from answer_col)
              then count(*) filter (where status = 'sent' and answer = 'stop') end as answered_stop,
         case when (select present from answer_col)
              then count(*) filter (where status = 'sent' and answer is null) end as no_answer_recorded,
         count(*) filter (where status in ('failed', 'unknown')) as lost
    from dl where kind = 'ask'
),
-- Что сейчас у тех, кому в окне ушёл K2 (подключённые), — одно состояние на ссылку, по порядку: план выключен
-- («Не присылать»), пауза, тишина (ни действия в боте, ни ответа после K2 [допущение 4]), план снова приходит.
k2_state as (
  select case when not k.remind_on then 'plan_off'
              when coalesce(k.paused_until > k.today_local, false) then 'paused'
              when k.k2_silent then 'silent'
              else 'back' end as state
    from lk k
   where k.unlinked_at is null
     and exists (select 1 from dl where dl.link_id = k.id and dl.kind = 'ask' and dl.status = 'sent')
),
k2_now as (
  select count(*) as links,
         count(*) filter (where state = 'plan_off') as plan_off,
         count(*) filter (where state = 'paused') as paused,
         count(*) filter (where state = 'silent') as silent,
         count(*) filter (where state = 'back') as back
    from k2_state
),
other_kinds as (
  select coalesce(jsonb_object_agg(kind, v), '{}'::jsonb) as v
    from (select kind, jsonb_build_object('rows', count(*), 'sent', count(*) filter (where status = 'sent'),
                                          'skipped', count(*) filter (where status = 'skipped'),
                                          'lost', count(*) filter (where status in ('failed', 'unknown'))) as v
            from dl where kind not in ('reminder', 'ask') group by kind) x
),
sessions as (
  select count(*) as started,
         count(distinct user_id) as people,
         count(distinct (user_id, local_day)) as user_days,
         count(*) filter (where status = 'finished') as finished,
         count(*) filter (where status = 'abandoned') as abandoned,
         count(*) filter (where status = 'open') as open_now,
         count(*) filter (where kind = 'plan') as kind_plan,
         count(*) filter (where kind = 'errors') as kind_errors,
         count(*) filter (where kind = 'extra') as kind_extra
    from ss
),
session_answers as (
  select count(*) as with_answers,
         percentile_cont(0.5) within group (order by base_items) as questions_median,
         count(*) filter (where base_items >= 20) as reached_20,
         percentile_cont(0.5) within group (order by answers) as answers_median,
         round(percentile_cont(0.5) within group (order by minutes)::numeric, 1) as minutes_median
    from per_sid
),
by_source as (
  select coalesce(jsonb_object_agg(source, v), '{}'::jsonb) as v
    from (select source,
                 jsonb_build_object('answers', count(*), 'people', count(distinct user_id),
                                    'user_days', count(distinct (user_id, local_date)),
                                    'correct', count(*) filter (where correct),
                                    'misclicks', count(*) filter (where misclick),
                                    'into_count_two_days', count(*) filter (where step = 'two_days'),
                                    'ms_median', percentile_cont(0.5) within group (order by ms)
                                                   filter (where ms is not null)) as v
            from ans group by source) x
),
-- Те, у кого есть ссылка на бота (сейчас или раньше): какая доля их ответов пришла из чата.
linked_mix as (
  select count(*) as answers,
         count(*) filter (where source = 'bot') as bot,
         count(*) filter (where source = 'bot_group') as bot_group,
         count(*) filter (where source = 'web') as web,
         count(distinct user_id) as people
    from ans where user_id in (select user_id from lk)
),
pauses_blocks as (
  select count(*) filter (where unlinked_at is null) as linked_now,
         count(*) filter (where unlinked_at is null and paused_until > today_local) as paused_now,
         percentile_cont(0.5) within group (order by paused_until - today_local)
           filter (where unlinked_at is null and paused_until > today_local) as pause_days_left_median,
         count(*) filter (where unlinked_at is null and blocked_at is not null) as blocked_now,
         count(*) filter (where blocked_at is not null and (blocked_at at time zone tz)::date between p.d0 and p.d1)
           as blocked_in_window,
         count(*) filter (where unlinked_at is null and not remind_on) as plan_off_now
    from lk, params p
),
remind_times as (  -- выбранное время у подключённых сейчас (без поясов и людей)
  select coalesce(jsonb_object_agg(t, n), '{}'::jsonb) as v
    from (select to_char(remind_at, 'HH24:MI') as t, count(*) as n from lk where unlinked_at is null
           group by 1 order by 2 desc limit 8) x
),
-- Вызовы функции на 30 дней — нижняя оценка по темпу последних 3 дней (журнал обновлений хранится 3 дня): обновления
-- (одно на сообщение или нажатие; повторы доставки того же update_id — одна строка) + тик. Тик в обычном режиме —
-- вызов в минуту, в экономном — каждая 15-я минута и минуты, когда есть дело. Экономный режим включается сам на
-- 300 000 вызовах за месяц (его видно в /status, tick_mode) или флагом bot.config.flags ->> 'tick' = 'when_due'.
-- Не видны: /status, /setup, чужие запросы без заголовка (401 тоже считается вызовом). Если бот работает меньше
-- 3 дней, темп занижен. Точное число — Usage организации (docs/telegram-bot.md, «Лимиты»).
calls as (
  select count(*) as updates_3d,
         count(*) filter (where status = 'failed') as failed_3d,
         count(*) filter (where status = 'started' and started_at < now() - interval '5 minutes') as unfinished_3d,
         round(count(*) / 3.0, 1) as updates_per_day,
         round(count(*) / 3.0 * 30) as updates_30d_at_this_pace
    from bot.updates where started_at > now() - interval '3 days'
),
calls_err as (
  select coalesce(jsonb_object_agg(e, n), '{}'::jsonb) as v
    from (select coalesce(error_name, '—') as e, count(*) as n from bot.updates
           where status = 'failed' and started_at > now() - interval '3 days' group by 1 order by 2 desc limit 8) x
)
select 'охват' as what, jsonb_build_object(
         'excluded_accounts', r.excluded_accounts,
         'linked_ever', r.linked_ever, 'linked_now', r.linked_now, 'getting_plan_now', r.getting_plan_now,
         'got_reminder', r.got_reminder, 'pressed_start', r.pressed_start, 'answered_in_bot', r.answered_in_bot,
         'bot_days_2_plus', r.bot_days_2_plus, 'bot_days_4_plus', r.bot_days_4_plus,
         'note', 'люди; окно — для got_reminder и дальше, linked_* и getting_plan_now — сейчас') as value
  from reach r
union all
select 'привязка', jsonb_build_object(
         'codes_issued', g.codes_issued, 'code_people', g.code_people, 'codes_used', g.codes_used,
         'codes_expired_unused', g.codes_expired_unused, 'links_made', g.links_made, 'linked_people', g.linked_people,
         'stopped', g.stopped, 'replaced', g.replaced, 'claim_failures', g.claim_failures,
         'note', 'коды — «Подключить Telegram» в профиле или «Напоминать в Telegram»; stopped — отключили сами, '
                 || 'replaced — новая ссылка победила (M6)')
  from linking g
union all
select 'напоминания (K1)', jsonb_build_object(
         'rows', m.rows_total, 'sent', m.sent, 'skipped', m.skipped, 'unknown', m.unknown, 'failed', m.failed,
         'in_progress', m.in_progress, 'retaken', m.retaken, 'people', m.people,
         'sent_then_start', m.sent_then_start, 'sent_then_studied', m.sent_then_studied,
         'late_minutes_median', (select round(percentile_cont(0.5) within group (order by late_min)::numeric, 1)
                                   from rem_late),
         'late_over_30_min', (select count(*) from rem_late where late_min > 30),
         'skipped_why', (select v from skipped_why), 'lost_why', (select v from failed_why),
         'note', 'строка = ссылка × местный день; unknown — упал между отправкой и отметкой, второй раз не шлётся')
  from reminders m
union all
select 'напоминания по дням', coalesce(jsonb_agg(jsonb_build_object('day', b.local_day, 'sent', b.sent,
         'skipped', b.skipped, 'lost', b.lost, 'started', b.started) order by b.local_day), '[]'::jsonb)
  from by_day b
union all
select 'K2 «Присылать план дальше?»', jsonb_build_object(
         'sent', k.sent, 'people', k.people, 'answered_yes', k.answered_yes, 'answered_pause', k.answered_pause,
         'answered_stop', k.answered_stop, 'no_answer_recorded', k.no_answer_recorded, 'lost', k.lost,
         'now_links', n.links, 'now_plan_off', n.plan_off, 'now_paused', n.paused, 'now_silent', n.silent,
         'now_back', n.back, 'answer_column', (select present from answer_col),
         'note', 'answered_* — bot.deliveries.answer [допущение], null без поля; now_* — у тех, кому ушёл K2: '
                 || 'plan_off «Не присылать», paused, silent — тишина, back — план снова приходит')
  from k2 k, k2_now n
union all
select 'другие сообщения бота', (select v from other_kinds)
union all
select 'занятия в чате', jsonb_build_object(
         'started', s.started, 'people', s.people, 'user_days', s.user_days, 'finished', s.finished,
         'abandoned', s.abandoned, 'open_now', s.open_now,
         'kind_plan', s.kind_plan, 'kind_errors', s.kind_errors, 'kind_extra', s.kind_extra,
         'with_answers', a.with_answers, 'questions_median', a.questions_median, 'reached_20', a.reached_20,
         'answers_median', a.answers_median, 'minutes_median', a.minutes_median,
         'note', 'started — строки bot.sessions с днём в окне; questions — разные вопросы без повторов ошибок, '
                 || 'answers — с повторами')
  from sessions s, session_answers a
union all
select 'ответы по источникам', (select v from by_source)
union all
select 'ответы подключённых: доля чата', jsonb_build_object(
         'people', x.people, 'answers', x.answers, 'bot', x.bot, 'bot_group', x.bot_group, 'web', x.web)
  from linked_mix x
union all
select 'паузы и блокировки', jsonb_build_object(
         'linked_now', q.linked_now, 'paused_now', q.paused_now, 'pause_days_left_median', q.pause_days_left_median,
         'blocked_now', q.blocked_now, 'blocked_in_window', q.blocked_in_window, 'plan_off_now', q.plan_off_now,
         'remind_at_now', (select v from remind_times),
         'note', 'paused_now — paused_until позже сегодняшнего дня студента; '
                 || 'plan_off — «Не присылать» или выключено на сайте')
  from pauses_blocks q
union all
select 'вызовы функции на 30 дней (нижняя оценка)', jsonb_build_object(
         'updates_3d', c.updates_3d, 'updates_per_day', c.updates_per_day, 'failed_3d', c.failed_3d,
         'unfinished_3d', c.unfinished_3d, 'failed_why', (select v from calls_err),
         'updates_30d_at_this_pace', c.updates_30d_at_this_pace,
         'tick_per_30d_if_every_minute', 43200,
         'tick_per_30d_when_due_at_least', 2880,
         'estimate_30d', c.updates_30d_at_this_pace + 43200,
         'estimate_30d_when_due_at_least', c.updates_30d_at_this_pace + 2880,
         'share_of_free_500k', round((c.updates_30d_at_this_pace + 43200) / 500000.0, 3),
         'tick_flag', (select flags ->> 'tick' from bot.config where id = 1),
         'last_tick_minutes_ago', (select round(extract(epoch from now() - last_tick_at)::numeric / 60, 1)
                                     from bot.config where id = 1),
         'note', 'estimate_30d — при минутном тике; на 300 000 за месяц тик сам становится экономным (tick_mode в '
                 || '/status); docs/telegram-bot.md, «Лимиты»; точное число — Usage организации')
  from calls c
union all
select 'проверка допущений', jsonb_build_object(
         'deliveries_answer_column', (select present from answer_col),
         'skipped_without_reason', (select count(*) from rem where status = 'skipped' and error_class = '—'),
         'bot_answers_tg_key', (select count(*) from ans where source = 'bot' and client_event_id like 'tg:%'),
         'bot_answers_other_key', (select count(*) from ans where source = 'bot' and client_event_id not like 'tg:%'),
         'window', (select jsonb_build_object('d0', d0, 'd1', d1) from params),
         'note', 'false / не 0 — допущение 1, 2 или 5 из шапки файла не совпало с базой: поправить файл');
