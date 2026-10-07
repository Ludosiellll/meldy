-- Цифры пилота по ссылке группы (план 2026-10-07: ворота В2 на 3–4-й день, цифры для заявки и pptx).
-- Только чтение. Запускать в SQL Editor проекта (роль postgres) или через коннектор агента.
--
-- Что считается. Участник — тот, кто вошёл по ссылке группы (exam_share_members) и получил копию экзамена.
-- Ответ — событие exam_answer в журнале (learning_events) по копии участника. Голос/текст — поле input ответа.
-- «Вернулся в другой день» — ответы участника хотя бы в два разных дня (по местной дате устройства).
-- «Стёрто» — приближение правила шпаргалки: пункт назван в основном ответе (status covered) в два разных дня.
-- Тестовые аккаунты агентов исключены (список ниже). Автор ссылки в участники не входит.
--
-- Чтобы посмотреть одну группу, впишите id экзамена автора в only_exam (иначе — все ссылки).

with params as (
  select null::uuid as only_exam  -- например: '2b56c75a-…'::uuid
),
test_accounts(id) as (
  values ('45a99c1b-5d38-49b5-af80-612ecc01c837'::uuid),  -- meldy-e2e-20261007@example.com (автор, демо)
         ('947ff228-dc6f-40b0-8b0a-7a27973cfabc'::uuid)   -- meldy-e2e2-20261007@example.com (участник)
),
shares as (
  select s.id, s.exam_id, s.created_at, s.revoked_at
    from public.exam_shares s, params p
   where (p.only_exam is null or s.exam_id = p.only_exam)
     and s.owner_id not in (select id from test_accounts)
),
members as (
  select m.share_id, m.user_id, m.member_exam_id, m.joined_at
    from public.exam_share_members m
    join shares s on s.id = m.share_id
   where m.user_id not in (select id from test_accounts)
),
answers as (
  select e.user_id, e.local_date, e.created_at, e.payload ->> 'input' as input
    from public.learning_events e
    join members m on m.user_id = e.user_id and e.payload ->> 'exam_id' = m.member_exam_id::text
   where e.kind = 'exam_answer'
),
points as (
  select e.user_id, e.local_date, e.payload ->> 'question_hash' as question_hash, e.payload ->> 'point_id' as point_id
    from public.learning_events e
    join members m on m.user_id = e.user_id
   where e.kind = 'oral_point' and e.payload ->> 'status' = 'covered'
     and e.created_at >= m.joined_at
),
erased as (
  select user_id, question_hash, point_id
    from points
   group by user_id, question_hash, point_id
  having count(distinct local_date) >= 2
),
per_member as (
  select m.user_id,
         count(a.*) as answers,
         count(distinct a.local_date) as days,
         min(a.created_at) as first_answer,
         (select count(*) from erased x where x.user_id = m.user_id) as erased_points
    from members m
    left join answers a on a.user_id = m.user_id
   group by m.user_id
)
select json_build_object(
  'links', (select count(*) from shares),
  'links_open', (select count(*) from shares where revoked_at is null),
  'joined', (select count(*) from members),
  'answered', (select count(*) from per_member where answers > 0),
  'answers', (select count(*) from answers),
  'by_voice', (select count(*) from answers where input = 'speech'),
  'by_text', (select count(*) from answers where input = 'text'),
  'mixed', (select count(*) from answers where input = 'mixed'),
  'returned_another_day', (select count(*) from per_member where days >= 2),
  'answers_per_answering_member_median', (select percentile_cont(0.5) within group (order by answers) from per_member where answers > 0),
  'members_with_erased_lines', (select count(*) from per_member where erased_points > 0),
  'erased_points', (select coalesce(sum(erased_points), 0) from per_member),
  'by_day', (select coalesce(json_agg(json_build_object('day', d.local_date, 'answers', d.n, 'members', d.u) order by d.local_date), '[]'::json)
               from (select local_date, count(*) as n, count(distinct user_id) as u from answers group by local_date) d)
) as pilot;
