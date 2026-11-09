-- Run once after migration 20261109090100_bot_support.sql: the read-only check of that apply. A DO block that raises
-- nothing when every check holds (supabase/migrate.py); it raises the name of the first one that does not. Catalog only,
-- but for one fact of bot.config's row: that a username hash is set (64 hex) — the hash itself is not read out.
-- Checks: bot.config has support_username_hash, support_chat_id and support_tg_user_id with their two checks, and the
-- hash is set; bot.support_messages and public.account_deletion_requests exist with their columns, row security on, no
-- policy and no grant to a client role or service_role; the queue's kinds and its two unique keys (a Telegram message
-- once, one row per message in the owner's chat); a request row per account, tied to auth.users with ON DELETE CASCADE;
-- bot.support_cleanup is executable by no API role; the six bot_support_* functions are SECURITY DEFINER with an empty
-- search_path, check the service role first and are executable by service_role only; the three account_deletion_*
-- functions return jsonb, take nothing, are SECURITY DEFINER with an empty search_path, read auth.uid() and are
-- executable by authenticated only.
-- The behaviour is rehearsed locally: supabase/tests/local/bot_support_run.sh (bot_support_behaviour.sql); the bot's
-- side: supabase/functions/_shared/bot/support.test.ts.
DO $check$
DECLARE
  v_t text;
  v_col text;
  v_fn text;
  v_role text;
  v_src text;
BEGIN
  IF pg_catalog.to_regclass('bot.config') IS NULL THEN
    RAISE EXCEPTION 'bot_config_exists';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM information_schema.columns c
       WHERE c.table_schema = 'bot' AND c.table_name = 'config' AND c.is_nullable = 'YES'
         AND (c.column_name::text, c.data_type::text) IN (('support_username_hash', 'text'), ('support_chat_id', 'bigint'),
                                              ('support_tg_user_id', 'bigint'))) <> 3 THEN
    RAISE EXCEPTION 'config_support_columns';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint k
       WHERE k.conrelid = 'bot.config'::regclass AND k.contype = 'c'
         AND k.conname IN ('config_support_hash_check', 'config_support_ids_check')) <> 2 THEN
    RAISE EXCEPTION 'config_support_checks';
  END IF;
  IF NOT coalesce((SELECT c.support_username_hash ~ '^[0-9a-f]{64}$' FROM bot.config c WHERE c.id = 1), false) THEN
    RAISE EXCEPTION 'support_username_hash_set';
  END IF;

  FOREACH v_t IN ARRAY ARRAY['bot.support_messages', 'public.account_deletion_requests'] LOOP
    IF pg_catalog.to_regclass(v_t) IS NULL THEN
      RAISE EXCEPTION 'table_exists: %', v_t;
    END IF;
    IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = pg_catalog.to_regclass(v_t))
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_policies p WHERE p.schemaname || '.' || p.tablename = v_t) THEN
      RAISE EXCEPTION 'row_security_without_policy: %', v_t;
    END IF;
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF pg_catalog.has_table_privilege(v_role, v_t, 'SELECT') OR pg_catalog.has_table_privilege(v_role, v_t, 'INSERT')
         OR pg_catalog.has_table_privilege(v_role, v_t, 'UPDATE') OR pg_catalog.has_table_privilege(v_role, v_t, 'DELETE') THEN
        RAISE EXCEPTION 'table_no_grant: % %', v_t, v_role;
      END IF;
    END LOOP;
  END LOOP;

  FOREACH v_col IN ARRAY ARRAY['id', 'created_at', 'kind', 'user_id', 'chat_id', 'tg_message_id', 'tg_name', 'tg_username', 'text',
                               'claimed_at', 'sent_at', 'owner_chat_id', 'owner_message_id', 'error', 'answered_at'] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns c
                    WHERE c.table_schema = 'bot' AND c.table_name = 'support_messages' AND c.column_name = v_col) THEN
      RAISE EXCEPTION 'support_messages_column: %', v_col;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid = 'bot.support_messages'::regclass
                  AND k.conname = 'support_messages_kind_check'
                  AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%message%deletion%deletion_cancel%') THEN
    RAISE EXCEPTION 'support_messages_kinds';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid = 'bot.support_messages'::regclass
                  AND k.conname = 'support_messages_message_check'
                  AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%char_length(text) <= 2000%') THEN
    RAISE EXCEPTION 'support_messages_text_2000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_indexes WHERE schemaname = 'bot' AND indexname = 'support_messages_message_key'
                  AND indexdef LIKE 'CREATE UNIQUE INDEX%(chat_id, tg_message_id) WHERE (kind = ''message''::text)')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_indexes WHERE schemaname = 'bot' AND indexname = 'support_messages_owner_key'
                     AND indexdef LIKE 'CREATE UNIQUE INDEX%(owner_chat_id, owner_message_id) WHERE (owner_message_id IS NOT NULL)') THEN
    RAISE EXCEPTION 'support_messages_unique_keys';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid = 'bot.support_messages'::regclass AND k.contype = 'f'
                  AND k.confrelid = 'auth.users'::regclass AND k.confdeltype = 'c') THEN
    RAISE EXCEPTION 'support_messages_user_cascade';
  END IF;

  IF (SELECT pg_catalog.count(*) FROM information_schema.columns c
       WHERE c.table_schema = 'public' AND c.table_name = 'account_deletion_requests'
         AND (c.column_name::text, c.data_type::text, c.is_nullable::text) IN (('user_id', 'uuid', 'NO'),
              ('requested_at', 'timestamp with time zone', 'NO'), ('cancelled_at', 'timestamp with time zone', 'YES'))) <> 3
     OR (SELECT pg_catalog.count(*) FROM information_schema.columns c
          WHERE c.table_schema = 'public' AND c.table_name = 'account_deletion_requests') <> 3
     OR (SELECT c.column_default FROM information_schema.columns c
          WHERE c.table_schema = 'public' AND c.table_name = 'account_deletion_requests' AND c.column_name = 'requested_at')
        IS DISTINCT FROM 'now()' THEN
    RAISE EXCEPTION 'account_deletion_requests_columns';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid = 'public.account_deletion_requests'::regclass
                  AND k.contype = 'p' AND pg_catalog.pg_get_constraintdef(k.oid) = 'PRIMARY KEY (user_id)')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid = 'public.account_deletion_requests'::regclass
                     AND k.contype = 'f' AND k.confrelid = 'auth.users'::regclass AND k.confdeltype = 'c') THEN
    RAISE EXCEPTION 'account_deletion_requests_key_and_cascade';
  END IF;

  IF pg_catalog.to_regprocedure('bot.support_cleanup(timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'helper_exists: bot.support_cleanup(timestamptz)';
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF pg_catalog.has_function_privilege(v_role, 'bot.support_cleanup(timestamptz)', 'EXECUTE') THEN
      RAISE EXCEPTION 'helper_no_grant: bot.support_cleanup %', v_role;
    END IF;
  END LOOP;

  FOREACH v_fn IN ARRAY ARRAY['public.bot_support_add(bigint,bigint,bigint,text,text,text,timestamptz)',
                              'public.bot_support_owner(bigint,bigint,text)', 'public.bot_support_claim(integer,timestamptz)',
                              'public.bot_support_done(bigint,bigint,bigint,text,timestamptz)',
                              'public.bot_support_reply(bigint,bigint,bigint)', 'public.bot_support_answered(bigint,timestamptz)',
                              'public.account_deletion_request()', 'public.account_deletion_cancel()',
                              'public.account_deletion_status()'] LOOP
    IF pg_catalog.to_regprocedure(v_fn) IS NULL THEN
      RAISE EXCEPTION 'function_exists: %', v_fn;
    END IF;
    SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(v_fn);
    IF NOT (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(v_fn))
       OR NOT coalesce((SELECT p.proconfig @> ARRAY['search_path=""'] FROM pg_catalog.pg_proc p
                         WHERE p.oid = pg_catalog.to_regprocedure(v_fn)), false)
       OR (SELECT p.prorettype FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(v_fn)) <> 'jsonb'::regtype THEN
      RAISE EXCEPTION 'definer_empty_search_path_jsonb: %', v_fn;
    END IF;
    IF v_fn LIKE 'public.bot_%' THEN
      -- The service role is checked before anything else is read.
      IF v_src !~ '\mbegin\s+perform meldy_private\.require_service_role\(\);'
         OR NOT pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE')
         OR pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE') OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
        RAISE EXCEPTION 'bot_function_service_role_only: %', v_fn;
      END IF;
    ELSE
      IF pg_catalog.strpos(v_src, 'auth.uid()') = 0 OR pg_catalog.strpos(v_src, 'errcode = ''28000''') = 0
         OR NOT pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE')
         OR pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE') OR pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
        RAISE EXCEPTION 'account_function_authenticated_only: %', v_fn;
      END IF;
    END IF;
  END LOOP;
  -- The claim compares the hash itself; nothing else may bind the owner's chat.
  IF pg_catalog.strpos((SELECT p.prosrc FROM pg_catalog.pg_proc p
                         WHERE p.oid = pg_catalog.to_regprocedure('public.bot_support_owner(bigint,bigint,text)')),
                       'pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.lower(p_username), ''UTF8''))') = 0 THEN
    RAISE EXCEPTION 'owner_claim_compares_the_hash';
  END IF;
END
$check$;
