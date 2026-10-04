-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour test of *_ai_quota_server.sql on
-- supabase/tests/local/baseline.sql + ai_quota_baseline.sql: the merged day row, consume / refund /
-- status / log as users A (free) and B (PRO) through their own tokens, the guard at the limit,
-- refunds only of the caller's own receipts (once, never below zero, the receipt's own day), no
-- client writes to ai_usage, no client access to ai_charges, own rows only in ai_calls, argument
-- checks, and anon. Everything runs in transactions that roll back; a failure raises, success
-- prints ALL AI QUOTA CHECKS PASSED and ANON AI QUOTA CHECKS PASSED.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);

do $t$
declare
  A uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  B uuid := 'bbbbbbbb-0000-0000-0000-000000000002';
  today date := (now() at time zone 'utc')::date;
  r jsonb;
  r2 jsonb;
  charge_a uuid;
  charge_b uuid;
  n integer;
  denied boolean;
begin
  -- 1. The two rows of today were merged by summing (7 + 5); yesterday's row is untouched.
  select count(*) into n from public.ai_usage where user_id = A and date = today;
  if n <> 1 then raise exception 'merge: % rows of today', n; end if;
  r := public.ai_quota_status();
  if r->>'pro' <> 'false' or (r->>'used')::int <> 12 or (r->>'limit')::int <> 100
     or r->>'day' <> today::text or r->>'resets_at' <> to_char(today + 1, 'YYYY-MM-DD') || 'T00:00:00Z' then
    raise exception 'status: %', r;
  end if;
  if public.ai_daily_limit(false) <> 100 or public.ai_daily_limit(true) <> 1000 or public.ai_daily_limit(null) <> 100 then
    raise exception 'ai_daily_limit';
  end if;

  -- 2. A charge within the limit: allowed, counted, a receipt id.
  r := public.consume_ai_units(20, 'lecture');
  charge_a := (r->>'charge_id')::uuid;
  if r->>'allowed' <> 'true' or (r->>'used')::int <> 32 or charge_a is null then raise exception 'consume: %', r; end if;

  -- 3. Over the limit: refused, nothing counted, no receipt.
  r := public.consume_ai_units(80, 'lecture');
  if r->>'allowed' <> 'false' or (r->>'used')::int <> 32 or r->'charge_id' <> 'null'::jsonb then
    raise exception 'guard: %', r;
  end if;
  r := public.consume_ai_units(68, 'chatMessage');
  if r->>'allowed' <> 'true' or (r->>'used')::int <> 100 then raise exception 'exactly at the limit: %', r; end if;
  r := public.consume_ai_units(1, 'chatMessage');
  if r->>'allowed' <> 'false' then raise exception 'past the limit: %', r; end if;
  r := public.consume_ai_units(0, 'check');
  if r->>'allowed' <> 'true' or r->'charge_id' <> 'null'::jsonb then raise exception 'zero units: %', r; end if;

  -- 4. Refund: only that receipt, once, only of its kind, never more than it spent.
  r := public.refund_ai_units(20, 'chatMessage', charge_a);
  if (r->>'refunded')::int <> 0 then raise exception 'refund of another kind: %', r; end if;
  r := public.refund_ai_units(50, 'lecture', charge_a);
  if (r->>'refunded')::int <> 20 or (r->>'used')::int <> 80 then raise exception 'refund: %', r; end if;
  r := public.refund_ai_units(20, 'lecture', charge_a);
  if (r->>'refunded')::int <> 0 or (r->>'used')::int <> 80 then raise exception 'second refund: %', r; end if;
  r := public.refund_ai_units(5, 'lecture', gen_random_uuid());
  if (r->>'refunded')::int <> 0 then raise exception 'unknown receipt: %', r; end if;

  -- 5. A receipt from an hour ago is no longer refundable (the table is not writable by clients:
  --    age it as the owner would).
  r := public.consume_ai_units(10, 'examMapping');
  charge_a := (r->>'charge_id')::uuid;
  reset role;
  update public.ai_charges set created_at = now() - interval '61 minutes' where id = charge_a;
  set local role authenticated;
  r := public.refund_ai_units(10, 'examMapping', charge_a);
  if (r->>'refunded')::int <> 0 then raise exception 'stale receipt refunded: %', r; end if;

  -- 6. A refund after midnight goes to the receipt's own day.
  r := public.consume_ai_units(5, 'conversation');
  charge_a := (r->>'charge_id')::uuid;
  reset role;
  update public.ai_charges set day = today - 1 where id = charge_a;
  set local role authenticated;
  r := public.refund_ai_units(5, 'conversation', charge_a);
  if (r->>'refunded')::int <> 5 or (r->>'used')::int <> 95 then raise exception 'refund day: %', r; end if;
  reset role;
  select requests_count into n from public.ai_usage where user_id = A and date = today - 1;
  if n <> 35 then raise exception 'yesterday after the refund: %', n; end if;
  set local role authenticated;

  -- 7. Clients write nothing to ai_usage and cannot touch ai_charges.
  denied := false;
  begin insert into public.ai_usage(user_id, date, requests_count) values (A, today + 1, 0);
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'client insert into ai_usage allowed'; end if;
  denied := false;
  begin update public.ai_usage set requests_count = 0 where user_id = A;
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'client update of ai_usage allowed'; end if;
  denied := false;
  begin delete from public.ai_usage where user_id = A;
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'client delete from ai_usage allowed'; end if;
  denied := false;
  begin perform 1 from public.ai_charges;
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'client read of ai_charges allowed'; end if;
  select count(*) into n from public.ai_usage;
  if n <> 2 then raise exception 'A reads % ai_usage rows (own today and yesterday expected)', n; end if;

  -- 8. The call log: own rows only, arguments checked.
  perform public.log_ai_call('chatMessage', 1, 'gemini', 'gemini-2.5-flash-lite', true, 812);
  perform public.log_ai_call('oral_check', 0, null, null, false, null);
  select count(*) into n from public.ai_calls where user_id = A and kind = 'chatMessage' and provider = 'gemini' and ok;
  if n <> 1 then raise exception 'log row: %', n; end if;
  denied := false;
  begin perform public.log_ai_call('bad kind!', 1, 'gemini', 'x', true, 1);
  exception when invalid_parameter_value then denied := true; end;
  if not denied then raise exception 'bad kind logged'; end if;
  denied := false;
  begin perform public.consume_ai_units(1001, 'lecture');
  exception when invalid_parameter_value then denied := true; end;
  if not denied then raise exception '1001 units accepted'; end if;
  denied := false;
  begin perform public.consume_ai_units(-1, 'lecture');
  exception when invalid_parameter_value then denied := true; end;
  if not denied then raise exception 'negative units accepted'; end if;
  denied := false;
  begin perform public.refund_ai_units(1, 'lecture', null);
  exception when invalid_parameter_value then denied := true; end;
  if not denied then raise exception 'refund without a receipt accepted'; end if;
  denied := false;
  begin insert into public.ai_calls(user_id, kind, ok) values (A, 'x', true);
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'client insert into ai_calls allowed'; end if;

  -- 9. B (PRO): 1000 a day; A cannot refund B's receipt, B cannot see A's log.
  perform set_config('request.jwt.claim.sub', B::text, true);
  r := public.ai_quota_status();
  if r->>'pro' <> 'true' or (r->>'limit')::int <> 1000 or (r->>'used')::int <> 990 then raise exception 'B status: %', r; end if;
  r := public.consume_ai_units(10, 'answer');
  charge_b := (r->>'charge_id')::uuid;
  if r->>'allowed' <> 'true' or (r->>'used')::int <> 1000 then raise exception 'B consume: %', r; end if;
  r := public.consume_ai_units(1, 'answer');
  if r->>'allowed' <> 'false' or r->>'pro' <> 'true' then raise exception 'B at the PRO limit: %', r; end if;
  select count(*) into n from public.ai_calls;
  if n <> 0 then raise exception 'B reads A''s call log'; end if;
  perform set_config('request.jwt.claim.sub', A::text, true);
  r := public.refund_ai_units(10, 'answer', charge_b);
  if (r->>'refunded')::int <> 0 then raise exception 'A refunded B''s receipt: %', r; end if;
  perform set_config('request.jwt.claim.sub', B::text, true);
  r2 := public.ai_quota_status();
  if (r2->>'used')::int <> 1000 then raise exception 'B after A''s attempt: %', r2; end if;

  -- 10. Without a signed-in user nothing works.
  perform set_config('request.jwt.claim.sub', '', true);
  denied := false;
  begin perform public.consume_ai_units(1, 'lecture');
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'consume without a user'; end if;

  raise notice 'ALL AI QUOTA CHECKS PASSED';
end
$t$;
rollback;

begin;
set local role anon;
do $t$
declare
  denied boolean;
begin
  denied := false;
  begin perform public.consume_ai_units(1, 'lecture');
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'anon executes consume_ai_units'; end if;
  denied := false;
  begin perform public.ai_quota_status();
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'anon executes ai_quota_status'; end if;
  denied := false;
  begin perform 1 from public.ai_usage;
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'anon reads ai_usage'; end if;
  denied := false;
  begin insert into public.ai_usage(user_id, date) values (null, current_date);
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'anon writes ai_usage'; end if;
  raise notice 'ANON AI QUOTA CHECKS PASSED';
end
$t$;
rollback;
