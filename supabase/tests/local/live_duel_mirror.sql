-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT (supabase/tests/local/live_game_run.sh, the duel stage). The numbers of
-- «Дуэль» as the database counts them, on the grid of live_duel_mirror.mjs (mode × streak × frozen × the outcome × the
-- time: 576 cases): every case is a duel whose first seat is in the state the case gives, its answer (or none) closed by
-- meldy_private.live_duel_close; the same case as a challenge run in phase 0 graded by meldy_private.live_run_score; then
-- the winner of a grid of points and right answers by meldy_private.live_duel_winner. Prints «points <cases>:<md5>»
-- (the duel's close), «phase0 <cases>:<md5>» (the challenge's) and «winner <cases>:<md5>». One transaction, rolled back.
\set ON_ERROR_STOP 1
begin;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true) is null \g /dev/null
set local role authenticated;
select set_config('mirror.c', public.container_create('Зеркало дуэли', null, '[{"title":"Всё"}]') ->> 'container_id', true) is null \g /dev/null
reset role;
create temp table mirror_duel (n integer primary key, line text);
create temp table mirror_run (n integer primary key, line text);
do $m$
declare
  v_c uuid := current_setting('mirror.c')::uuid;
  v_n integer := 0;
  v_mode record;
  v_streak integer;
  v_frozen boolean;
  v_out record;
  v_elapsed integer;
  v_d uuid;
  v_s uuid;
  v_ch uuid;
  v_run uuid;
begin
  for v_mode in select * from (values (1, 20, true, false), (2, 10, false, false), (3, 30, false, true)) as m(o, t, speed, calm) order by o loop
    -- the challenge of the mode: q0 keys {0, 1} of four (the set, half of it, a wrong one); q1 keys {0, 1, 2} of four (a third, two thirds)
    insert into public.live_challenges (owner_id, container_id, title, code, time_s, speed, calm, q_count, deadline)
    values ('aaaaaaaa-0000-0000-0000-000000000001', v_c, 'Зеркало', meldy_private.random_code(), v_mode.t, v_mode.speed, v_mode.calm, 2, now() + interval '1 day')
    returning id into v_ch;
    insert into public.live_challenge_questions (challenge_id, qi, kind, text, options, shown, key, keys)
    values (v_ch, 0, 'multiple', 'Два верных', '["a","b","c","d"]', '{0,1,2,3}', 0, '{0,1}'),
           (v_ch, 1, 'multiple', 'Три верных', '["a","b","c","d"]', '{0,1,2,3}', 0, '{0,1,2}');
    foreach v_streak in array array[0, 1, 3, 5] loop
      foreach v_frozen in array array[false, true] loop
        for v_out in select * from (values (1, 0, '{0,1}'::smallint[]), (2, 0, '{0}'), (3, 1, '{0}'), (4, 1, '{0,1}'), (5, 0, '{2}'), (6, 0, null)) as o(o, qi, picks)
                      order by o loop
          foreach v_elapsed in array array[0, 999, 7333, 9999] loop
            v_n := v_n + 1;
            -- the duel: its first seat in the case's state answers (or not); the second seat says nothing
            insert into public.live_duels (code, owner_id, container_id, source, title, time_s, speed, calm, q_count, stage, qi)
            values (meldy_private.random_code(), 'aaaaaaaa-0000-0000-0000-000000000001', v_c, 'container', 'Зеркало', v_mode.t, v_mode.speed, v_mode.calm, 2,
                    'play', v_out.qi)
            returning id into v_d;
            insert into public.live_duel_questions (duel_id, qi, kind, text, options, shown, key, keys, shown_at, opens_at, closes_at)
            values (v_d, 0, 'multiple', 'Два верных', '["a","b","c","d"]', '{0,1,2,3}', 0, '{0,1}', now() - interval '20 seconds', now() - interval '17 seconds', now() + interval '1 minute'),
                   (v_d, 1, 'multiple', 'Три верных', '["a","b","c","d"]', '{0,1,2,3}', 0, '{0,1,2}', now() - interval '20 seconds', now() - interval '17 seconds', now() + interval '1 minute');
            insert into public.live_duel_seats (duel_id, seat, token_hash, name, look, right_n, streak, best, frozen)
            values (v_d, 1, md5('d' || v_n) || md5('e' || v_n), 'М', '{"body": "round", "colour": "blue", "eyes": "round", "hat": "none"}', v_streak, v_streak, v_streak, v_frozen)
            returning id into v_s;
            insert into public.live_duel_seats (duel_id, seat, token_hash, name, look)
            values (v_d, 2, md5('f' || v_n) || md5('g' || v_n), 'Н', '{"body": "round", "colour": "blue", "eyes": "round", "hat": "none"}');
            if v_out.picks is not null then
              insert into public.live_duel_answers (seat_id, qi, duel_id, at, picks, elapsed_ms)
              values (v_s, v_out.qi, v_d, now(), v_out.picks, v_elapsed);
            end if;
            perform meldy_private.live_duel_close(v_d, now());
            insert into mirror_duel
            select v_n, a.dmg || ':' || a.correct || ':' || a.thawed || ':' || s.frozen || ':' || s.streak || ':' || s.best || ':' || s.right_n || ':' || s.thaws
                        || ':' || s.time_ms
              from public.live_duel_answers a join public.live_duel_seats s on s.id = a.seat_id
             where a.seat_id = v_s and a.qi = v_out.qi;
            -- the same case as a challenge run whose question opened in phase 0 (a boss far from its phases)
            insert into public.live_runs (challenge_id, token_hash, name, look, qi, right_n, streak, best, frozen, hp, hp_max, phase)
            values (v_ch, md5(v_n::text) || md5('m' || v_n), 'М', '{"body": "round", "colour": "blue", "eyes": "round", "hat": "none"}',
                    v_out.qi, v_streak, v_streak, v_streak, v_frozen, 100000, 100000, 0)
            returning id into v_run;
            insert into public.live_run_answers (run_id, qi, challenge_id, opened_at, opens_at, closes_at, phase)
            values (v_run, v_out.qi, v_ch, now() - make_interval(secs => v_elapsed / 1000.0 + 3),
                    now() - make_interval(secs => v_elapsed / 1000.0), now() - make_interval(secs => v_elapsed / 1000.0) + make_interval(secs => v_mode.t), 0);
            perform meldy_private.live_run_score(v_run, v_out.qi, null, v_out.picks, null, case when v_out.picks is null then null else now() end);
            insert into mirror_run
            select v_n, a.dmg || ':' || a.correct || ':' || a.thawed || ':' || r.frozen || ':' || r.streak || ':' || r.best || ':' || r.right_n || ':' || r.thaws
                        || ':' || r.time_ms
              from public.live_run_answers a join public.live_runs r on r.id = a.run_id
             where a.run_id = v_run and a.qi = v_out.qi;
          end loop;
        end loop;
      end loop;
    end loop;
  end loop;
end
$m$;
select 'points ' || count(*) || ':' || md5(string_agg(line, ',' order by n)) from mirror_duel;
select 'phase0 ' || count(*) || ':' || md5(string_agg(line, ',' order by n)) from mirror_run;
select 'winner ' || count(*) || ':' || md5(string_agg(coalesce(w::text, ''), ',' order by o))
  from (select row_number() over (order by i1, i2, i3, i4) as o, meldy_private.live_duel_winner(d1, r1, d2, r2) as w
          from unnest(array[0, 50, 98, 100]) with ordinality a(d1, i1), unnest(array[0, 50, 98, 100]) with ordinality b(d2, i2),
               unnest(array[0, 1, 2]) with ordinality c(r1, i3), unnest(array[0, 1, 2]) with ordinality e(r2, i4)
         order by i1, i2, i3, i4) x;
rollback;
