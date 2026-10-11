-- Run once after migration *_containers_not_found_null.sql: the read-only check of that apply. A DO block that raises
-- nothing when every check holds (supabase/migrate.py); it raises the name of the first one that does not. It calls the
-- two reads of an exam's page as a user who exists nowhere (a fresh random id in request.jwt.claim.sub, for this
-- transaction only) about an exam that exists nowhere: nothing is written, and the only rows looked up are none.
-- Checks (what frontend/src/api/containers.ts fetchSummary / fetchPlanInputs read as «not found»):
--   * without a signed-in user both reads still raise 28000;
--   * container_summary(<an exam that is not the caller's>) answers null (HTTP 200), not P0002 (HTTP 500);
--   * plan_inputs(…, <an exam that is not the caller's>) answers null;
--   * plan_inputs without an exam still answers the whole wire (a user without exams: no containers).
-- The behaviour around it (a member who left or was removed, the author, anon) is rehearsed locally:
-- supabase/tests/local/containers_behaviour.sql through containers_run_all.sh.
DO $check$
DECLARE
  v_exam uuid := gen_random_uuid();
  v_wire jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    PERFORM public.container_summary(v_exam, NULL);
    RAISE EXCEPTION 'summary_without_user_raises_28000';
  EXCEPTION WHEN sqlstate '28000' THEN NULL;
  END;
  BEGIN
    PERFORM public.plan_inputs(NULL, v_exam);
    RAISE EXCEPTION 'plan_inputs_without_user_raises_28000';
  EXCEPTION WHEN sqlstate '28000' THEN NULL;
  END;

  PERFORM set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  BEGIN
    IF public.container_summary(v_exam, NULL) IS NOT NULL THEN
      RAISE EXCEPTION 'summary_of_no_exam_is_null';
    END IF;
  EXCEPTION WHEN sqlstate 'P0002' THEN
    RAISE EXCEPTION 'summary_of_no_exam_is_null: P0002 (HTTP 500)';
  END;
  BEGIN
    IF public.plan_inputs(NULL, v_exam) IS NOT NULL THEN
      RAISE EXCEPTION 'plan_inputs_of_no_exam_is_null';
    END IF;
  EXCEPTION WHEN sqlstate 'P0002' THEN
    RAISE EXCEPTION 'plan_inputs_of_no_exam_is_null: P0002 (HTTP 500)';
  END;
  v_wire := public.plan_inputs(NULL, NULL);
  IF v_wire IS NULL OR pg_catalog.jsonb_typeof(v_wire -> 'containers') IS DISTINCT FROM 'array'
     OR pg_catalog.jsonb_array_length(v_wire -> 'containers') <> 0 THEN
    RAISE EXCEPTION 'plan_inputs_without_exam_is_the_wire';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', '', true);
END
$check$;
