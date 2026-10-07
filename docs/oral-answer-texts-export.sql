-- Выгрузка ответов для слепой разметки точности Meldy (план 2026-10-07, «Текст ответа с согласия»).
-- Для владельца: SQL Editor проекта Supabase, роль postgres. Только чтение: ничего не меняет.
-- Нужна миграция supabase/migrations/20261007095841_oral_answer_texts.sql.
--
-- Что выгружается. Одна строка — один пункт ответа: текст ответа целиком (oral_answer_texts.text), вопрос,
-- пункт (название, главный ли, цитата из лекции) и что решил Meldy: вердикт по пункту протокола
-- (covered — назван, partial — частично, missing — не назван, wrong — ошибка, unrated — не оценён), его
-- отрывок из ответа и вердикт переспроса, если переспрашивали этот пункт. Вердикты берутся из строки
-- exam_sessions этой попытки (то, что сохранил record_oral_attempt).
--
-- Без людей. Вместо id аккаунта и id ответа — хэш с солью (12 знаков): student одинаков у всех ответов одного
-- студента, answer — у всех пунктов одного ответа. Имени, почты и id в выгрузке нет. СОЛЬ ЗАМЕНИТЕ на свою
-- случайную строку и храните у себя: с ней (и только с ней) разметку можно сопоставить с базой.
-- Выгружаются только ответы студентов, чьё согласие включено сейчас: выключил — его тексты не берём.
--
-- Слепая разметка: разметчик не должен видеть решения Meldy. Отдавайте ему первый запрос (без колонок
-- meldy_*), второй (ключ с вердиктами) оставьте себе и сравните по паре (answer, point_id).

-- 1. Для разметчиков: ответ, пункт, цитата лекции. Без вердиктов Meldy.
with params as (
  select 'ЗАМЕНИТЕ-НА-СВОЮ-СЛУЧАЙНУЮ-СТРОКУ'::text as salt
),
answers as (
  select t.id, t.user_id, t.text, t.input, t.created_at, s.questions_json -> 0 as attempt
    from public.oral_answer_texts t
    join public.oral_answer_consent c on c.user_id = t.user_id and c.granted
    join public.exam_sessions s
      on s.id = coalesce(t.session_id, (select e.session_id from public.learning_events e
                                         where e.user_id = t.user_id and e.client_event_id = t.attempt_id || ':answer'))
)
select left(md5(p.salt || a.user_id::text), 12) as student,
       left(md5(p.salt || a.id::text), 12) as answer,
       a.created_at::date as day,
       a.input,
       a.attempt ->> 'question' as question,
       a.text as answer_text,
       point ->> 'id' as point_id,
       (point ->> 'essential')::boolean as essential,
       point ->> 'title' as point_title,
       point ->> 'source_quote' as lecture_quote
  from answers a
  cross join params p
  cross join lateral jsonb_array_elements(coalesce(a.attempt -> 'points', '[]'::jsonb)) as point
 order by student, day, answer, point_id;

-- 2. Ключ (только для владельца): что решил Meldy по тем же парам (answer, point_id).
with params as (
  select 'ЗАМЕНИТЕ-НА-СВОЮ-СЛУЧАЙНУЮ-СТРОКУ'::text as salt
),
answers as (
  select t.id, t.user_id, s.questions_json -> 0 as attempt
    from public.oral_answer_texts t
    join public.oral_answer_consent c on c.user_id = t.user_id and c.granted
    join public.exam_sessions s
      on s.id = coalesce(t.session_id, (select e.session_id from public.learning_events e
                                         where e.user_id = t.user_id and e.client_event_id = t.attempt_id || ':answer'))
)
select left(md5(p.salt || a.id::text), 12) as answer,
       point ->> 'id' as point_id,
       point ->> 'status' as meldy_verdict,
       point ->> 'student_quote' as meldy_quote,
       case when a.attempt -> 'followup' ->> 'point_id' = point ->> 'id'
            then a.attempt -> 'followup' ->> 'status' end as meldy_followup_verdict,
       case when a.attempt -> 'followup' ->> 'point_id' = point ->> 'id'
            then a.attempt -> 'followup' ->> 'student_quote' end as followup_answer
  from answers a
  cross join params p
  cross join lateral jsonb_array_elements(coalesce(a.attempt -> 'points', '[]'::jsonb)) as point
 order by answer, point_id;

-- 3. Сколько есть: ответов с текстом и студентов (для плана разметки 25–50 ответов, около 150 вердиктов).
select count(*) as answers,
       count(distinct t.user_id) as students,
       min(t.created_at)::date as first_day,
       max(t.created_at)::date as last_day
  from public.oral_answer_texts t
  join public.oral_answer_consent c on c.user_id = t.user_id and c.granted;
