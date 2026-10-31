-- question_kinds_bot (release 48, part 4: the new question kinds in the Telegram bot)
-- Repo file: supabase/migrations/20261101090300_question_kinds_bot.sql. Contract: docs/kinds/CONTRACT.md §4 (the bot's
-- row). Base: 20261101090200_question_kinds_quiz.sql on the live order. Each function redefined here is its newest
-- earlier body with this file's changes: public.bot_session_items (20261014150000_bot_skips_pictures.sql), public.bot_session_answer (20261010120003_telegram_bot_sessions.sql), bot.session_view_json (20261010120003_telegram_bot_sessions.sql).
-- Check after the apply: supabase/tests/question_kinds_bot.sql. Local rehearsal (never live):
-- supabase/tests/local/question_kinds_run.sh. Rollback: supabase/rollback/20261101090300_question_kinds_bot_down.sql.
--
-- The bot asks number and a cloze of one gap as a typed answer (as short): bot_session_items gives them, the typed
-- answer is taken for them and graded by meldy_private.grade_item (a one-gap cloze takes the text as its gap), the
-- pending answer is a short one for the rest of the session's flow (record, resolve), and the view's review gives a
-- number's accepted values with the unit and a cloze gap's forms. Order, match and a cloze of several gaps stay on the
-- site: bot_session_items leaves them out and says how many it left out (in_app, only when there are some). After an
-- answer the view's review carries the author's explanation (only when there is one). The old kinds' items, answers and
-- views are as before.
-- Re-runnable: OR REPLACE keeps the grants and comments.

-- 1. The questions the bot asks (public.bot_session_items (20261014150000_bot_skips_pictures.sql)) + number and a one-gap cloze; in_app.
create or replace function public.bot_session_items(p_tg_user_id bigint, p_container_id uuid, p_item_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_l bot.links%rowtype;
begin
  perform meldy_private.require_service_role();
  select * into v_l from bot.active_link(p_tg_user_id);
  if v_l.id is null then
    return pg_catalog.jsonb_build_object('status', 'unlinked');
  end if;
  if p_container_id is null or p_item_ids is null or pg_catalog.array_ndims(p_item_ids) is distinct from 1
     or pg_catalog.cardinality(p_item_ids) not between 1 and 60 then
    return pg_catalog.jsonb_build_object('status', 'invalid', 'reason', 'arguments');
  end if;
  if meldy_private.role_in(v_l.user_id, p_container_id) is null then
    return pg_catalog.jsonb_build_object('status', 'unavailable');
  end if;
  return pg_catalog.jsonb_build_object('status', 'ok', 'items', (
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'id', i.id, 'subject_id', i.subject_id, 'kind', i.kind, 'keep_order', i.keep_order, 'code', i.code,
             'rev', i.rev, 'options', i.options) order by x.o), '[]'::jsonb)
      from pg_catalog.unnest(p_item_ids) with ordinality x(id, o)
      join public.test_items i on i.id = x.id
     where i.container_id = p_container_id and i.keyed
       and i.images = '{}'::jsonb
       and (i.kind in ('single', 'multiple', 'short', 'number')
            or (i.kind = 'cloze' and pg_catalog.cardinality(i.answers) = 1))))
    -- release 48: the keyed questions of a kind the bot does not ask (order, match, a cloze of several gaps)
    || coalesce((select case when pg_catalog.count(*) > 0 then pg_catalog.jsonb_build_object('in_app', pg_catalog.count(*)) end
                   from public.test_items i
                  where i.id = any (p_item_ids) and i.container_id = p_container_id and i.keyed
                    and (i.kind in ('order', 'match') or (i.kind = 'cloze' and pg_catalog.cardinality(i.answers) > 1))),
                '{}'::jsonb);
end;
$fn$;

-- 2. The answer (public.bot_session_answer (20261010120003_telegram_bot_sessions.sql)) + a typed number or one-gap cloze, graded by grade_item.
create or replace function public.bot_session_answer(p_tg_user_id bigint, p_sid text, p_pos integer, p_choice jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := pg_catalog.now();
  v_l bot.links%rowtype;
  v_t record;
  v_s bot.sessions%rowtype;
  v_sid text := p_sid;
  v_pos integer;
  v_item public.test_items%rowtype;
  v_n integer;
  v_order jsonb;
  v_rev integer;
  v_keys text[];
  v_choice integer[];
  v_chosen integer[];
  v_text text;
  v_dont boolean := false;
  v_mask integer;
  v_el jsonb;
  v_g record;
  v_ms integer;
  v_answer jsonb;
begin
  perform meldy_private.require_service_role();
  if p_sid is null then
    -- a typed message: the open session of this Telegram user's account, if any
    select * into v_l from bot.active_link(p_tg_user_id);
    if v_l.id is null then
      return pg_catalog.jsonb_build_object('status', 'unlinked');
    end if;
    select s.sid into v_sid from bot.sessions s where s.user_id = v_l.user_id and s.status = 'open';
    if v_sid is null then
      return pg_catalog.jsonb_build_object('status', 'no_question');
    end if;
  end if;
  select * into v_t from bot.session_take(p_tg_user_id, v_sid, v_now, false);
  if v_t.o_status <> 'ok' then
    if p_sid is null and v_t.o_status = 'ended' then
      return pg_catalog.jsonb_build_object('status', 'no_question');
    end if;
    return bot.session_refusal(v_t.o_status, v_t.o_s, v_t.o_role, v_now,
      case when v_t.o_status = 'ended' and p_pos is not null
           then pg_catalog.jsonb_build_object('answer', bot.session_logged((v_t.o_s).user_id, v_sid, p_pos))
           else '{}'::jsonb end);
  end if;
  v_s := v_t.o_s;
  v_pos := case when p_sid is null then v_s.position else p_pos end;
  if v_pos is null or v_pos <> v_s.position then
    v_s := bot.session_stamp(v_s, v_now);
    v_s.active_at := v_now;
    perform bot.session_save(v_s);
    return bot.session_reply('old', v_s, v_t.o_role, v_now,
                             pg_catalog.jsonb_build_object('answer', bot.session_logged(v_s.user_id, v_s.sid, v_pos)));
  end if;
  v_item := null;
  select i.* into v_item from public.test_items i where i.id = v_s.items[v_pos + 1];
  -- A typed message counts only while the current question is a short one.
  if p_sid is null and (v_item.id is null or v_item.kind not in ('short', 'number', 'cloze')) then
    return pg_catalog.jsonb_build_object('status', 'no_question');
  end if;
  -- This question is answered already (a double tap, a second message): the first answer stands.
  if v_s.pending is not null and (v_s.pending ->> 'pos')::integer = v_pos then
    return bot.session_reply('repeat', v_s, v_t.o_role, v_now);
  end if;
  v_s.active_at := v_now;
  -- Gone (deleted, without a key) or changed since it was shown (stale): not recorded, the next question comes.
  v_rev := coalesce((v_s.shown -> v_pos ->> 'r')::integer, v_item.rev);
  if v_item.id is null or v_item.container_id <> v_s.container_id or not v_item.keyed or v_rev <> v_item.rev then
    v_answer := pg_catalog.jsonb_build_object('status',
      case when v_item.id is not null and v_item.container_id = v_s.container_id and v_item.keyed then 'stale'
           else 'gone' end);
    v_s.counts := bot.session_count(v_s.counts, v_answer ->> 'status');
    v_s.position := v_pos + 1;
    v_s := bot.session_stamp(v_s, v_now);
    perform bot.session_save(v_s);
    return bot.session_reply('ok', v_s, v_t.o_role, v_now, pg_catalog.jsonb_build_object('answer', v_answer));
  end if;
  -- The choice in shown indices, mapped through the order the question was shown in.
  v_n := case when v_item.kind = 'short' then 0 else pg_catalog.jsonb_array_length(v_item.options) end;
  v_order := v_s.shown -> v_pos -> 'o';
  if not bot.session_order_ok(v_order, v_n) then
    v_order := bot.session_identity(v_n);
  end if;
  if p_choice is null or pg_catalog.jsonb_typeof(p_choice) <> 'object' then
    return bot.session_reply('invalid', v_s, v_t.o_role, v_now, pg_catalog.jsonb_build_object('reason', 'choice'));
  end if;
  select pg_catalog.array_agg(k) into v_keys from pg_catalog.jsonb_object_keys(p_choice) k;
  if coalesce(pg_catalog.cardinality(v_keys), 0) <> 1 then
    return bot.session_reply('invalid', v_s, v_t.o_role, v_now, pg_catalog.jsonb_build_object('reason', 'choice'));
  end if;
  if v_keys[1] = 'dont_know' and p_choice -> 'dont_know' = 'true'::jsonb then
    v_dont := true;
    v_choice := '{}'::integer[];
    v_chosen := '{}'::integer[];
  elsif v_keys[1] = 'i' and v_item.kind = 'single' and pg_catalog.jsonb_typeof(p_choice -> 'i') = 'number'
        and (p_choice ->> 'i') ~ '^[0-7]$' and (p_choice ->> 'i')::integer < v_n then
    v_choice := array[(p_choice ->> 'i')::integer];
    v_chosen := array[(v_order ->> (p_choice ->> 'i')::integer)::integer];
  elsif v_keys[1] = 'mask' and v_item.kind = 'multiple' and pg_catalog.jsonb_typeof(p_choice -> 'mask') = 'number'
        and (p_choice ->> 'mask') ~ '^[0-9]{1,3}$'
        and (p_choice ->> 'mask')::integer between 1 and (1 << v_n) - 1 then
    v_mask := (p_choice ->> 'mask')::integer;
    select pg_catalog.array_agg(k order by k),
           pg_catalog.array_agg((v_order ->> k)::integer order by (v_order ->> k)::integer)
      into v_choice, v_chosen
      from pg_catalog.generate_series(0, v_n - 1) k
     where (v_mask >> k) & 1 = 1;
  elsif v_keys[1] = 'text' and v_item.kind in ('short', 'number', 'cloze') and pg_catalog.jsonb_typeof(p_choice -> 'text') = 'string'
        and pg_catalog.char_length(p_choice ->> 'text') <= 1000
        and public.meldy_short_norm(p_choice ->> 'text') <> '' then
    v_text := p_choice ->> 'text';
    v_choice := '{}'::integer[];
    v_chosen := '{}'::integer[];
  else
    return bot.session_reply('invalid', v_s, v_t.o_role, v_now, pg_catalog.jsonb_build_object('reason', 'choice'));
  end if;
  -- The verdict: the container's own grading against the key in file order.
  v_el := case when v_item.kind in ('short', 'number', 'cloze')
                 then pg_catalog.jsonb_build_object('text', case when v_dont then 'null'::jsonb
                                                                 else pg_catalog.to_jsonb(v_text) end)
               when v_dont then pg_catalog.jsonb_build_object('chosen', 'null'::jsonb, 'shown_order', v_order)
               when v_item.kind = 'single'
                 then pg_catalog.jsonb_build_object('chosen', v_chosen[1], 'shown_order', v_order)
               else pg_catalog.jsonb_build_object('chosen', pg_catalog.to_jsonb(v_chosen), 'shown_order', v_order) end;
  select * into v_g from meldy_private.grade_item(v_item, v_el);
  if not v_g.o_valid then
    return bot.session_reply('invalid', v_s, v_t.o_role, v_now, pg_catalog.jsonb_build_object('reason', 'choice'));
  end if;
  v_ms := case when v_s.shown_at[v_pos + 1] is not null
               then least(180000, greatest(0, pg_catalog.floor(
                      extract(epoch from (v_now - v_s.shown_at[v_pos + 1])) * 1000)))::integer end;
  v_s.pending := pg_catalog.jsonb_build_object(
    'pos', v_pos, 'item_id', v_item.id, 'rev', v_item.rev,
    'kind', case when v_item.kind in ('number', 'cloze') then 'short' else v_item.kind end,
    'choice', pg_catalog.to_jsonb(v_choice), 'chosen', pg_catalog.to_jsonb(v_chosen), 'text', v_text,
    'dont_know', v_dont, 'correct', v_g.o_correct, 'at', v_now,
    'local_date', pg_catalog.to_char(bot.local_day((v_t.o_l).tz, v_now), 'YYYY-MM-DD'), 'ms', v_ms,
    'cls', v_s.cls[v_pos + 1], 'retry', v_s.retry[v_pos + 1], 'order', v_order,
    'recorded', false, 'misclick', false, 'doubt', false);
  if v_g.o_correct then
    -- Right: to the core at once.
    v_s := bot.session_record(v_s, false);
    v_answer := pg_catalog.jsonb_build_object('status', v_s.pending -> 'status', 'correct', true, 'dont_know', false,
                                              'step', v_s.pending -> 'step');
    if (v_s.pending ->> 'status') not in ('saved', 'late', 'duplicate') or v_item.kind not in ('short', 'number', 'cloze') then
      -- «Верно.» and the next question in the same edit (or the question changed under the press: the next one)
      v_s.pending := null;
      v_s.position := v_pos + 1;
    end if;                             -- a short answer stays with «Верно: …» until «Дальше»
    v_s := bot.session_stamp(v_s, v_now);
  else
    -- Wrong or «Не знаю»: waits for «Дальше» / «Нажали не туда?» / the doubt (spec decision 16).
    v_s.pending_at := v_now;
    v_answer := pg_catalog.jsonb_build_object('status', 'pending', 'correct', false, 'dont_know', v_dont,
                                              'step', null);
  end if;
  perform bot.session_save(v_s);
  return bot.session_reply('ok', v_s, v_t.o_role, v_now, pg_catalog.jsonb_build_object('answer',
    v_answer || pg_catalog.jsonb_build_object('figure', bot.session_figure_json(v_s.figure) - 'too_early_states')));
end;
$fn$;

-- 3. The view (bot.session_view_json (20261010120003_telegram_bot_sessions.sql)) + the new kinds' forms in the review and the explanation.
create or replace function bot.session_view_json(p_s bot.sessions)
returns jsonb
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_item public.test_items%rowtype;
  v_topics jsonb;
  v_pos integer := p_s.position;
  v_cell jsonb;
  v_order jsonb;
  v_p jsonb := p_s.pending;
  v_review jsonb;
begin
  if p_s.sid is null or p_s.status <> 'open' or v_pos >= pg_catalog.cardinality(p_s.items) then
    return null;
  end if;
  select i.* into v_item from public.test_items i where i.id = p_s.items[v_pos + 1];
  if v_item.id is null then
    return null;
  end if;
  select s.topics into v_topics from public.container_subjects s where s.id = v_item.subject_id;
  v_cell := coalesce(p_s.shown -> v_pos, '{}'::jsonb);
  v_order := case when v_item.kind in ('short', 'number', 'cloze') then '[]'::jsonb else coalesce(v_cell -> 'o', '[]'::jsonb) end;
  if v_p is not null and (v_p ->> 'pos')::integer = v_pos then
    v_review := pg_catalog.jsonb_build_object(
      'correct', coalesce((v_p ->> 'correct')::boolean, false),
      'dont_know', coalesce((v_p ->> 'dont_know')::boolean, false),
      'choice', coalesce(v_p -> 'choice', '[]'::jsonb),
      'text', v_p -> 'text',
      'key', (select coalesce(pg_catalog.jsonb_agg(o.ord - 1 order by o.ord), '[]'::jsonb)
                from pg_catalog.jsonb_array_elements_text(v_order) with ordinality o(f, ord)
               where o.f::smallint = any (v_item.correct)),
      'answers', case when v_item.kind = 'cloze'
                      then pg_catalog.to_jsonb(pg_catalog.string_to_array(v_item.answers[1], E'\n'))
                      when v_item.kind = 'number' and v_item.unit is not null
                      then (select pg_catalog.jsonb_agg(a || ' ' || v_item.unit order by o)
                              from pg_catalog.unnest(v_item.answers) with ordinality as x(a, o))
                      else pg_catalog.to_jsonb(v_item.answers) end,
      'recorded', coalesce((v_p ->> 'recorded')::boolean, false),
      'misclick', coalesce((v_p ->> 'misclick')::boolean, false),
      'doubt', coalesce((v_p ->> 'doubt')::boolean, false),
      'status', v_p -> 'status', 'step', v_p -> 'step',
      'key_source', v_item.key_source,
      'key_changed_at', (select pg_catalog.max(k.changed_at) from public.test_item_key_changes k
                          where k.item_id = v_item.id and k.rev = v_item.rev))
      -- release 48: the author's explanation after the answer, when there is one
      || case when v_item.explanation <> '' then pg_catalog.jsonb_build_object('explanation', v_item.explanation)
              else '{}'::jsonb end;
  end if;
  return pg_catalog.jsonb_build_object(
    'pos', v_pos, 'item_id', v_item.id, 'rev', coalesce(v_cell -> 'r', pg_catalog.to_jsonb(v_item.rev)),
    'kind', v_item.kind, 'code', v_item.code, 'keep_order', v_item.keep_order, 'stem', v_item.stem,
    'options', (select coalesce(pg_catalog.jsonb_agg(v_item.options -> (o.f::integer) order by o.ord), '[]'::jsonb)
                  from pg_catalog.jsonb_array_elements_text(v_order) with ordinality o(f, ord)),
    'order', v_order, 'file_no', v_item.file_no, 'number', v_item.position, 'topic', v_item.topic,
    'topic_title', case when v_item.topic is not null then v_topics ->> (v_item.topic - 1) end,
    'retry', p_s.retry[v_pos + 1], 'review', v_review);
end;
$fn$;
