-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT (supabase/tests/local/live_game_run.sh, the challenge stage). The numbers
-- of «Соревнование в своё время» as the database counts them, on the grid of live_challenge_mirror.mjs: every case is a
-- run in the state the case gives and one answer graded by meldy_private.live_run_score (mode × streak × frozen × the
-- question's phase × the outcome × the time × the boss's HP: 5184 cases), then the table of 120 finished runs by
-- meldy_private.live_challenge_board_json. Prints «score <cases>:<md5>» and «board <rows>:<md5>». One transaction,
-- rolled back.
\set ON_ERROR_STOP 1
begin;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true) is null \g /dev/null
set local role authenticated;
select set_config('mirror.c', public.container_create('Зеркало соревнования', null, '[{"title":"Всё"}]') ->> 'container_id', true) is null \g /dev/null
reset role;
create temp table mirror_out (n integer primary key, line text);
do $m$
declare
  v_c uuid;
  v_ch uuid;
  v_run uuid;
  v_n integer := 0;
  v_mode record;
  v_streak integer;
  v_frozen boolean;
  v_phase integer;
  v_out record;
  v_elapsed integer;
  v_hp integer;
  v_qi integer;
  v_picks smallint[];
begin
  v_c := current_setting('mirror.c')::uuid;
  for v_mode in select * from (values (1, 20, true, false), (2, 10, false, false), (3, 30, false, true)) as m(o, t, speed, calm) order by o loop
    insert into public.live_challenges (owner_id, container_id, title, code, time_s, speed, calm, q_count, deadline)
    values ('aaaaaaaa-0000-0000-0000-000000000001', v_c, 'Зеркало', meldy_private.random_code(), v_mode.t, v_mode.speed, v_mode.calm, 2,
            now() + interval '1 day')
    returning id into v_ch;
    -- q0: keys {0, 1} of four (the set, half of it, a wrong one); q1: keys {0, 1, 2} of four (a third, two thirds)
    insert into public.live_challenge_questions (challenge_id, qi, kind, text, options, shown, key, keys)
    values (v_ch, 0, 'multiple', 'Два верных', '["a","b","c","d"]', '{0,1,2,3}', 0, '{0,1}'),
           (v_ch, 1, 'multiple', 'Три верных', '["a","b","c","d"]', '{0,1,2,3}', 0, '{0,1,2}');
    foreach v_streak in array array[0, 1, 3, 5] loop
      foreach v_frozen in array array[false, true] loop
        foreach v_phase in array array[0, 1, 2] loop
          for v_out in select * from (values (1, 'right', 0, '{0,1}'::smallint[]), (2, 'half', 0, '{0}'), (3, 'third', 1, '{0}'),
                                             (4, 'twothirds', 1, '{0,1}'), (5, 'wrong', 0, '{2}'), (6, 'none', 0, null)) as o(o, name, qi, picks)
                        order by o loop
            foreach v_elapsed in array array[0, 999, 7333, 19999] loop
              foreach v_hp in array array[550, 120, 5] loop
                v_n := v_n + 1;
                insert into public.live_runs (challenge_id, token_hash, name, look, qi, right_n, streak, best, frozen, hp, hp_max, phase)
                values (v_ch, pg_catalog.md5(v_n::text) || pg_catalog.md5('m' || v_n), 'М', '{"body": "round", "colour": "blue", "eyes": "round", "hat": "none"}',
                        v_out.qi, v_streak, v_streak, v_streak, v_frozen, v_hp, 550, v_phase)
                returning id into v_run;
                insert into public.live_run_answers (run_id, qi, challenge_id, opened_at, opens_at, closes_at, phase)
                values (v_run, v_out.qi, v_ch, now() - make_interval(secs => v_elapsed / 1000.0 + 3),
                        now() - make_interval(secs => v_elapsed / 1000.0), now() - make_interval(secs => v_elapsed / 1000.0) + make_interval(secs => v_mode.t),
                        v_phase);
                perform meldy_private.live_run_score(v_run, v_out.qi, null, v_out.picks, null, case when v_out.picks is null then null else now() end);
                insert into mirror_out
                select v_n, a.dmg || ':' || a.correct || ':' || a.thawed || ':' || r.frozen || ':' || a.healed || ':' || r.hp || ':' || r.phase
                            || ':' || r.streak || ':' || r.best || ':' || r.thaws || ':' || r.right_n || ':' || r.time_ms || ':' || coalesce(a.phase_changed::text, '')
                  from public.live_run_answers a join public.live_runs r on r.id = a.run_id
                 where a.run_id = v_run and a.qi = v_out.qi;
              end loop;
            end loop;
          end loop;
        end loop;
      end loop;
    end loop;
  end loop;
end
$m$;
select 'score ' || count(*) || ':' || md5(string_agg(line, ',' order by n)) from mirror_out;
-- the table: 120 finished runs with many ties
do $m$
declare v_ch uuid;
begin
  insert into public.live_challenges (owner_id, container_id, title, code, q_count, deadline)
  values ('aaaaaaaa-0000-0000-0000-000000000001', current_setting('mirror.c')::uuid, 'Таблица', meldy_private.random_code(), 4, now() + interval '1 day')
  returning id into v_ch;
  insert into public.live_runs (challenge_id, token_hash, name, look, qi, dmg, right_n, time_ms, hp, hp_max, finished_at)
  select v_ch, md5('b' || i) || md5('t' || i), 'Р' || i, '{"body": "round", "colour": "blue", "eyes": "round", "hat": "none"}', 3,
         100 * (i % 7), i % 4, 1000 * (i % 5), 220, 220, now() - make_interval(secs => i)
    from generate_series(1, 120) i;
  perform set_config('mirror.b', v_ch::text, true);
end
$m$;
select 'board ' || jsonb_array_length(b -> 'top') || ':' ||
       md5((select string_agg((x ->> 'place') || ':' || (x ->> 'dmg') || ':' || (x ->> 'right') || ':' || (x ->> 'time_ms'), ',' order by o)
              from jsonb_array_elements(b -> 'top') with ordinality t(x, o)))
  from (select meldy_private.live_challenge_board_json(c, null) as b from public.live_challenges c where c.id = current_setting('mirror.b')::uuid) y;
rollback;
