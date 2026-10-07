-- Rollback of 20261007103621_oral_answer_texts.sql. NOT applied by any package or agent; the owner runs it by hand
-- only if the stored answer texts have to go. It drops both tables with their policies, grants and the trigger, and
-- with them every stored answer text and every consent (export them first if the accuracy check still needs them:
-- docs/oral-answer-texts-export.sql). The client then answers «Не удалось сохранить выбор» on the consent question
-- and in «Профиль»; saving answers is not affected (a failed text write never breaks it).
begin;
drop table if exists public.oral_answer_texts;
drop table if exists public.oral_answer_consent;
drop function if exists public.oral_answer_consent_set_updated_at();
commit;
