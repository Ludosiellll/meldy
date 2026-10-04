-- Behavioural rollback of ai_quota_server. NOT applied by any package or agent; the owner runs it by
-- hand only if the server-side daily limit misbehaves on the live project.
-- After it: the five functions are gone, so the backend's limit check fails open (every AI action is
-- allowed, one log line per failure kind) and the model-call log stops; the browser shows the
-- counter from today's ai_usage row (its fallback). Signed-in clients may again insert and update
-- their own ai_usage rows, as the client before 2026-10-04 did (anon gets nothing back: it never
-- needed it). Kept: the rows, the (user_id, date) unique index, and the ai_charges and ai_calls
-- tables with their data (no client access to ai_charges; own-row reads of ai_calls), so
-- re-applying the migration restores everything removed here.
begin;

DROP FUNCTION IF EXISTS public.consume_ai_units(integer, text);
DROP FUNCTION IF EXISTS public.refund_ai_units(integer, text, uuid);
DROP FUNCTION IF EXISTS public.ai_quota_status();
DROP FUNCTION IF EXISTS public.log_ai_call(text, integer, text, text, boolean, integer);
DROP FUNCTION IF EXISTS public.ai_daily_limit(boolean);

GRANT SELECT, INSERT, UPDATE ON TABLE public.ai_usage TO authenticated;

DO $policies$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies
                  WHERE schemaname = 'public' AND tablename = 'ai_usage' AND cmd = 'INSERT') THEN
    CREATE POLICY "Users can insert own usage" ON public.ai_usage
      FOR INSERT TO public WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies
                  WHERE schemaname = 'public' AND tablename = 'ai_usage' AND cmd = 'UPDATE') THEN
    CREATE POLICY "Users can update own usage" ON public.ai_usage
      FOR UPDATE TO public USING (auth.uid() = user_id);
  END IF;
END
$policies$;

commit;
