-- LOCAL ONLY. The part of Supabase's storage schema that 20261014120000_test_item_images.sql meets live: the buckets and
-- objects tables (RLS on objects, as live), storage.foldername as Supabase defines it (the path's folders, without the
-- file), the grants the API roles have.
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key, name text not null, owner uuid, public boolean default false, file_size_limit bigint,
  allowed_mime_types text[], created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid,
  metadata jsonb, created_at timestamptz default now(), unique (bucket_id, name));
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language plpgsql immutable as $fn$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end
$fn$;
grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;
