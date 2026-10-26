-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour of 20261026090000_recording_usage.sql on baseline.sql +
-- ai_quota_baseline.sql (A free, B PRO): the day's total of A up to 2 hours and B up to 5, a refusal that charges
-- nothing, refunds of the caller's own charge only and once, a refunded charge freeing the day, argument checks, no
-- client access to the table, anon refused. Everything rolls back; success prints RECORDING USAGE CHECKS PASSED.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
do $t$
declare
  r jsonb;
  charge_a uuid;
  charge_b uuid;
  denied boolean;
begin
  -- 1. A (free): 90 min, then 30 min (the day is full at 2 hours), then 1 s more is refused and charges nothing.
  r := public.consume_recording_seconds(5400);
  charge_a := (r->>'charge_id')::uuid;
  if r->>'allowed' <> 'true' or (r->>'used')::int <> 5400 or (r->>'limit')::int <> 7200 or r->>'pro' <> 'false'
     or charge_a is null then
    raise exception 'consume A 90 min: %', r;
  end if;
  r := public.consume_recording_seconds(1800);
  if r->>'allowed' <> 'true' or (r->>'used')::int <> 7200 then raise exception 'consume A 30 min: %', r; end if;
  r := public.consume_recording_seconds(1);
  if r->>'allowed' <> 'false' or (r->>'used')::int <> 7200 or r->'charge_id' <> 'null'::jsonb
     or r->>'resets_at' <> to_char((now() at time zone 'utc')::date + 1, 'YYYY-MM-DD') || 'T00:00:00Z' then
    raise exception 'refusal A: %', r;
  end if;

  -- 2. A refund of A's own first charge frees 90 min, once.
  r := public.refund_recording_seconds(charge_a);
  if (r->>'refunded')::int <> 5400 then raise exception 'refund A: %', r; end if;
  r := public.refund_recording_seconds(charge_a);
  if (r->>'refunded')::int <> 0 then raise exception 'second refund A: %', r; end if;
  r := public.consume_recording_seconds(5400);
  if r->>'allowed' <> 'true' or (r->>'used')::int <> 7200 then raise exception 'after refund A: %', r; end if;

  -- 3. Arguments.
  begin
    perform public.consume_recording_seconds(0);
    denied := false;
  exception when sqlstate '22023' then denied := true;
  end;
  if not denied then raise exception 'zero seconds accepted'; end if;
  begin
    perform public.consume_recording_seconds(7201);
    denied := false;
  exception when sqlstate '22023' then denied := true;
  end;
  if not denied then raise exception 'over 2 hours accepted'; end if;

  -- 4. No client access to the receipts.
  begin
    perform 1 from public.recording_charges limit 1;
    denied := false;
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'authenticated reads recording_charges'; end if;

  -- 5. B (PRO): 5 hours; B cannot give back A's charge.
  perform set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', true);
  r := public.consume_recording_seconds(7200);
  charge_b := (r->>'charge_id')::uuid;
  if r->>'allowed' <> 'true' or (r->>'limit')::int <> 18000 or r->>'pro' <> 'true' then raise exception 'consume B: %', r; end if;
  r := public.consume_recording_seconds(7200);
  if r->>'allowed' <> 'true' or (r->>'used')::int <> 14400 then raise exception 'consume B twice: %', r; end if;
  r := public.consume_recording_seconds(3601);
  if r->>'allowed' <> 'false' or (r->>'used')::int <> 14400 then raise exception 'refusal B: %', r; end if;
  r := public.consume_recording_seconds(3600);
  if r->>'allowed' <> 'true' or (r->>'used')::int <> 18000 then raise exception 'B to 5 hours: %', r; end if;
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
  r := public.refund_recording_seconds(charge_b);
  if (r->>'refunded')::int <> 0 then raise exception 'A refunded B''s charge: %', r; end if;
  raise notice 'RECORDING USAGE CHECKS PASSED';
end
$t$;
rollback;

begin;
set local role anon;
do $t$
declare denied boolean;
begin
  begin
    perform public.consume_recording_seconds(60);
    denied := false;
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'anon may consume'; end if;
  raise notice 'ANON RECORDING USAGE CHECKS PASSED';
end
$t$;
rollback;
