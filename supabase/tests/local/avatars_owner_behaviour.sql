-- LOCAL ONLY. Behaviour of supabase/migrations/20261107090800_avatars_owner.sql (security audit 07.11, SEC-4): in the
-- «avatars» bucket an account lists, writes, replaces and deletes only «<its id>-…» names; another account's avatar is
-- out of its reach. Each step runs as `authenticated` with the account's id in the JWT claims, as PostgREST/Storage do.
-- Prints AVATARS OWNER PASSED as its last line when every step holds.
\set ON_ERROR_STOP 1
begin;
create or replace function pg_temp.as_user(p_sub uuid) returns void language plpgsql as $fn$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', p_sub::text, true);
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', p_sub)::text, true);
  execute 'set local role authenticated';
end;
$fn$;
do $t$
declare
  a constant uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  b constant uuid := 'bbbbbbbb-0000-4000-8000-00000000000b';
  n int;
begin
  perform pg_temp.as_user(a);
  select count(*) into n from storage.objects where bucket_id = 'avatars';
  if n <> 1 then raise exception 'FAILED: A lists % avatars, expected only its own 1', n; end if;
  insert into storage.objects (bucket_id, name) values ('avatars', a::text || '-2.jpg');
  begin
    insert into storage.objects (bucket_id, name) values ('avatars', b::text || '-9.jpg');
    raise exception 'FAILED: A wrote a name of B';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into storage.objects (bucket_id, name) values ('avatars', 'free-hosting.bin');
    raise exception 'FAILED: A wrote a name of nobody';
  exception when insufficient_privilege then null;
  end;
  update storage.objects set metadata = '{"x":1}' where bucket_id = 'avatars' and name = b::text || '-1.jpg';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAILED: A replaced B''s avatar'; end if;
  delete from storage.objects where bucket_id = 'avatars' and name = b::text || '-1.jpg';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAILED: A deleted B''s avatar'; end if;
  update storage.objects set metadata = '{"x":1}' where bucket_id = 'avatars' and name = a::text || '-1.jpg';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAILED: A could not replace its own avatar'; end if;
  begin
    update storage.objects set name = b::text || '-7.jpg' where bucket_id = 'avatars' and name = a::text || '-1.jpg';
    raise exception 'FAILED: A renamed its avatar into B''s name';
  exception when insufficient_privilege then null;
  end;
  delete from storage.objects where bucket_id = 'avatars' and name = a::text || '-2.jpg';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAILED: A could not delete its own avatar'; end if;
  -- the other buckets keep their own rules: A reaches nothing of the questions' pictures through this policy
  select count(*) into n from storage.objects where bucket_id = 'test-item-images';
  if n <> 0 then raise exception 'FAILED: A lists question pictures'; end if;
  execute 'reset role';
  select count(*) into n from storage.objects where bucket_id = 'avatars' and name = b::text || '-1.jpg';
  if n <> 1 then raise exception 'FAILED: B''s avatar is gone'; end if;
end
$t$;
rollback;
select 'AVATARS OWNER PASSED';
