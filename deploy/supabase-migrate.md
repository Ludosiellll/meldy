# Supabase migrations

Each new line here runs `.github/workflows/supabase-migrate.yml` (`supabase/migrate.py`) with the owner's token
(repository secret `SUPABASE_ACCESS_TOKEN`): the migration files after «apply:» go to the live project one by one, each
whole in one request, and each version is recorded in `supabase_migrations.schema_migrations` (a version already there
is skipped); then the read-only checks after «check:» run, and the job fails unless each reports `contract_ok: true` (or,
for a DO block, raises nothing). Only the newest line is read. The job prints file names, statuses and the names of
failed checks, never row data.

- 2026-10-10 — apply: supabase/migrations/20261009093500_containers.sql, supabase/migrations/20261009093501_containers_revokes.sql; check: supabase/tests/containers.sql, supabase/tests/cheat_sheet.sql, supabase/tests/exam_shares.sql, supabase/tests/journal_exams_rls.sql, supabase/tests/ai_quota_server.sql, supabase/tests/app_telemetry.sql, supabase/tests/oral_answer_texts.sql
- 2026-10-10 — apply: supabase/migrations/20261009093500_containers.sql, supabase/migrations/20261009093501_containers_revokes.sql, supabase/migrations/20261010074500_containers_fk_indexes.sql; check: supabase/tests/containers.sql
- 2026-10-10 — apply: supabase/migrations/20261009093500_containers.sql, supabase/migrations/20261009093501_containers_revokes.sql, supabase/migrations/20261010074500_containers_fk_indexes.sql, supabase/migrations/20261010110000_containers_oral_codes_closed.sql; check: supabase/tests/containers.sql, supabase/tests/exam_shares.sql
- 2026-10-10 — apply: supabase/migrations/20261010120000_telegram_bot.sql, supabase/migrations/20261010120001_telegram_bot_cron.sql, supabase/migrations/20261010120002_telegram_bot_revokes.sql, supabase/migrations/20261010120003_telegram_bot_sessions.sql, supabase/migrations/20261010120004_telegram_bot_groups.sql, supabase/migrations/20261010120005_telegram_bot_files.sql; check: supabase/tests/telegram_bot.sql, supabase/tests/containers.sql
- 2026-10-10 — apply: supabase/migrations/20261010120006_telegram_bot_voice.sql; check: supabase/tests/telegram_bot.sql, supabase/tests/containers.sql, supabase/tests/ai_quota_server.sql
- 2026-10-10 — apply: supabase/migrations/20261010120007_oral_plan_inputs.sql; check: supabase/tests/telegram_bot.sql, supabase/tests/containers.sql, supabase/tests/cheat_sheet.sql
- 2026-10-10 — apply: supabase/migrations/20261010130000_containers_frozen_pace.sql; check: supabase/tests/containers.sql, supabase/tests/telegram_bot.sql
- 2026-10-11 — apply: supabase/migrations/20261010150000_telegram_webapp.sql; check: supabase/tests/telegram_bot.sql, supabase/tests/containers.sql
- 2026-10-11 — apply: supabase/migrations/20261011100000_containers_not_found_null.sql; check: supabase/tests/containers_not_found.sql, supabase/tests/containers.sql
- 2026-10-12 — apply: supabase/migrations/20261012100000_telegram_bot_monitor.sql; check: supabase/tests/telegram_bot.sql, supabase/tests/containers.sql
- 2026-10-14 — apply: supabase/migrations/20261014120000_test_item_images.sql; check: supabase/tests/test_item_images.sql, supabase/tests/containers.sql
- 2026-10-16 — apply: supabase/migrations/20261016120000_quizzes.sql; check: supabase/tests/quizzes.sql, supabase/tests/item_update_images.sql, supabase/tests/containers.sql
- 2026-10-16 — apply: supabase/migrations/20261016140000_quiz_result_order.sql; check: supabase/tests/quiz_result_order.sql, supabase/tests/quizzes.sql
- 2026-10-18 — apply: supabase/migrations/20261018100000_test_builder.sql; check: supabase/tests/test_builder.sql, supabase/tests/quizzes.sql, supabase/tests/quiz_result_order.sql, supabase/tests/item_update_images.sql, supabase/tests/test_item_images.sql, supabase/tests/containers.sql
- 2026-10-18 — apply: supabase/migrations/20261018120000_exam_move_bot_exams.sql; check: supabase/tests/exam_move_bot_exams.sql, supabase/tests/containers.sql, supabase/tests/telegram_bot.sql, supabase/tests/test_builder.sql
- 2026-10-18 — apply: supabase/migrations/20261018130000_quiz_guards.sql; check: supabase/tests/quiz_guards.sql, supabase/tests/test_builder.sql, supabase/tests/quizzes.sql, supabase/tests/quiz_result_order.sql
- 2026-10-18 — apply: supabase/migrations/20261018140000_quiz_practice_grace.sql; check: supabase/tests/quiz_practice_grace.sql, supabase/tests/quiz_guards.sql, supabase/tests/test_builder.sql, supabase/tests/quizzes.sql
