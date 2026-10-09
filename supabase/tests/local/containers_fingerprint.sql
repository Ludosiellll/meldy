-- LOCAL ONLY. Catalog fingerprint of every user schema (all but pg_catalog, information_schema and the toast / temp
-- schemas): schemas (owner, ACL), functions (body, flags, settings, ACL), columns (type, nullability, default,
-- generation), constraints, policies, user triggers, relations (ACL, row security), indexes, user types, sequences,
-- default ACLs and extensions. One line per object, sorted, so two databases can be compared with comm / diff:
-- containers_run_all.sh takes it before the migration, after it (no line of the base may change or go) and after the
-- rollback (identical to the base).
with nsp as (
  select n.oid, n.nspname from pg_namespace n
   where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
     and n.nspname not like 'pg_temp_%' and n.nspname not like 'pg_toast_temp_%'
)
select 'nsp ' || n.nspname || ' owner=' || pg_get_userbyid(x.nspowner) || ' acl=' || coalesce(x.nspacl::text, 'default')
  from nsp n join pg_namespace x on x.oid = n.oid
union all
select 'fn ' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') '
       || md5(p.prosrc) || ' ret=' || pg_get_function_result(p.oid) || ' def=' || p.prosecdef || ' vol=' || p.provolatile::text
       || ' strict=' || p.proisstrict || ' cfg=' || coalesce(array_to_string(p.proconfig, ','), '')
       || ' acl=' || coalesce(p.proacl::text, 'default')
  from pg_proc p join nsp n on n.oid = p.pronamespace
union all
select 'col ' || c.table_schema || '.' || c.table_name || '.' || c.column_name || ' ' || c.data_type || ' null=' || c.is_nullable
       || ' default=' || coalesce(c.column_default, '') || ' gen=' || coalesce(c.generation_expression, '')
  from information_schema.columns c where c.table_schema in (select nspname from nsp)
union all
select 'con ' || n.nspname || '.' || t.relname || '.' || k.conname || ' ' || md5(pg_get_constraintdef(k.oid)) || ' valid=' || k.convalidated
  from pg_constraint k join pg_class t on t.oid = k.conrelid join nsp n on n.oid = t.relnamespace
union all
select 'pol ' || schemaname || '.' || tablename || '.' || policyname || ' ' || cmd || ' ' || permissive || ' '
       || md5(coalesce(qual, '') || '|' || coalesce(with_check, '')) || ' ' || roles::text
  from pg_policies where schemaname in (select nspname from nsp)
union all
select 'trg ' || n.nspname || '.' || c.relname || '.' || t.tgname || ' ' || md5(pg_get_triggerdef(t.oid)) || ' enabled=' || t.tgenabled::text
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join nsp n on n.oid = c.relnamespace
 where not t.tgisinternal
union all
select 'rel ' || n.nspname || '.' || c.relname || ' kind=' || c.relkind::text || ' acl=' || coalesce(c.relacl::text, 'default')
       || ' rls=' || c.relrowsecurity || ' force=' || c.relforcerowsecurity
  from pg_class c join nsp n on n.oid = c.relnamespace
 where c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
union all
select 'idx ' || i.schemaname || '.' || i.indexname || ' ' || md5(i.indexdef)
  from pg_indexes i where i.schemaname in (select nspname from nsp)
union all
select 'typ ' || n.nspname || '.' || t.typname || ' ' || t.typtype::text
  from pg_type t join nsp n on n.oid = t.typnamespace
 where t.typtype in ('c', 'd', 'e', 'r', 'm') and (t.typrelid = 0 or (select c.relkind from pg_class c where c.oid = t.typrelid) = 'c')
union all
select 'dac ' || pg_get_userbyid(d.defaclrole) || ' ' || coalesce(n.nspname, '*') || ' ' || d.defaclobjtype::text || ' ' || d.defaclacl::text
  from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace
union all
select 'ext ' || e.extname || ' ' || e.extversion from pg_extension e
order by 1;
