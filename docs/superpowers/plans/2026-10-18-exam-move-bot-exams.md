# Release 47 (with it): «Перенести экзамен» and per-exam Telegram plans

> For agentic workers: agent D owns the database and the bot, agent E owns the site. The contract below is fixed; if it
> cannot be met, stop and say so.

**Owner, 2026-10-18:** «проблемы с уведомлениями от бота по поводу вопросов, тяжело понять как выключить их от
определенного экзамена или как переключить на другой экзамен или как сразу на несколько экзаменов. Плюс при окончании
экзамена (например запланировано на 17.10) нельзя продлить кнопкой и выбрать до какого, нужно через настройки это делать.
Я зашел, а мне нельзя было проходить, оказывается потому что уже 17 число».

**Facts (code map 18.10):**
- `bot.links` has no exam. The day card picks a lead exam each day (`card.ts` `dayView`); «Другой экзамен» only redraws
  one message. An exam whose date is today leads the card and then the card is not sent at all (`send` only for `study`),
  even when another exam has work.
- On D = 0 the plan is `exam_today` (no «Начать»); on D < 0 `after`: the exam leaves «Сегодня», its page says «Экзамен
  прошёл.» with a link to settings. Only the author can change the date there; a member is sent to a page where they
  cannot. No «продлить» anywhere.

## Global constraints

- Plain Russian words, Meldy design language, both themes, 1532×734 and 390 without sideways scroll.
- The plan engine (`lib/containers/plan.ts` and its bot copy) stays unchanged: dates change on the server inputs.
- A member's own date never changes the author's date or other members' plans.
- Every existing bot and site test keeps passing or is updated with a reason in the commit message.
- Commits end with the session's trailer lines; never `git add -A`; do not push.

## Data contract (agent D)

Migration `supabase/migrations/20261018120000_exam_move_bot_exams.sql` (re-runnable), rollback
`supabase/rollback/20261018120000_exam_move_bot_exams_down.sql`, contract `supabase/tests/exam_move_bot_exams.sql`,
rehearsal `supabase/tests/local/exam_move_bot_exams_behaviour.sql` + `exam_move_bot_exams_run.sh` (base as the
containers + telegram bot rehearsals build it; forward twice, contract, behaviour, the existing containers and telegram
bot local tests still green, rollback twice, forward again).

1. `container_plans`: `own_exam_date date` (null — none; 2000-01-01..2100-12-31) and `tg_remind boolean not null default
   true`. Rows are written the way the existing plan settings write them (upsert with defaults when missing).
2. **Effective date.** For a user with `own_exam_date`, every subject of that exam uses it (it overrides subject and
   container dates) in `plan_inputs_for`, `container_summary` and every other function that gives this user dates of
   this exam (overview lists, `bot_today`, reminder context, K3). `container_summary` adds `own_exam_date` (date or null)
   and `author_exam_date` (the container's own date) at the top level.
3. `exam_date_move(p_container_id uuid, p_date date, p_for text default 'all', p_subject_id uuid default null) returns
   jsonb` — authenticated, SECURITY DEFINER, `search_path ''`.
   - `p_date` between current_date and current_date + 730 (else 22023 `date`); null only with `p_for = 'me'` (clears).
   - `'all'`: the owner only (42501). With `p_subject_id`: that subject's date (and the linked oral exam's date the way the
     site's `updateSubject` writes it). Without: the container's date, and every subject whose own date is set and
     already passed (≤ current_date) gets `p_date` too; future subject dates stay.
   - `'me'`: the owner or an active member; sets `own_exam_date` (upsert).
   - Returns `{for, container_id, exam_date, own_exam_date, subjects: [{id, exam_date}]}` (dates as `YYYY-MM-DD`).
4. `exam_remind_set(p_container_id uuid, p_on boolean) returns jsonb {container_id, tg_remind}` (owner or active member)
   and `telegram_exams() returns jsonb` — the caller's exams (owned + active member):
   `[{container_id, title, exam_date, state: 'study'|'exam_today'|'after'|'no_date', tg_remind}]`, nearest first.
5. Bot functions in the existing bot style (service role, `p_tg_user_id`, the linked user): `bot_exams(p_tg_user_id)`
   (same list), `bot_exam_remind(p_tg_user_id, p_container_id, p_on)`, `bot_exam_move(p_tg_user_id, p_container_id,
   p_date, p_for)` (same rules as `exam_date_move`).
6. Reminder claim/context/today and K3 leave out exams with `tg_remind = false`; when all are off, no card (skip reason
   `off`).

## Bot (agent D, `supabase/functions/_shared/bot/*`, `supabase/functions/telegram/*`)

- **Lead exam:** among enabled exams the nearest `study` exam leads; an `exam_today` exam becomes a line «Сегодня
  экзамен: «…».»; the card is sent when any enabled exam has work. Only `exam_today` exams: the card «Сегодня экзамен.»
  is sent (once) with [«Пройтись по ошибкам: N»] (when there are errors) and [«Перенести экзамен»].
- **Which exams:** S1 «Настройки» shows «Экзамены в плане: «A», «B».» and a button «Экзамены» → «<b>Какие экзамены
  присылать</b>\nОтметьте экзамены, по которым приходит план на день. Можно несколько.» with a row per exam «✓ Осенняя
  сессия · 3 ноября» / «— Зимняя сессия · 20 декабря» (press toggles) and «‹ Назад». The day card with two or more exams
  gets the same «Экзамены» button. «Другой экзамен» stays as it is.
- **Move:** K3 («Экзамен прошёл …») and the exam-day card get [«Перенести на неделю», «На 2 недели»], [«Другая дата»]
  (typed date, like «Пауза» → «Другая дата»). The owner of an exam with active members then chooses [«Для всех
  участников»] / [«Только для меня»]; without members — for all; a member — for themselves. Reply: «Экзамен «…»
  перенесён на 25 октября. План пересчитан.» K3 text loses «По этому экзамену бот больше не напишет» when a move is
  offered: «Если экзамен перенесли — нажмите, план пересчитается.»
- Callback data ≤ 64 bytes. Update router/settings/card/tick tests and snapshots; add tests for each new screen.

## Site (agent E)

- API (`api/containers.ts`, append only): `moveExamDate(containerId, date | null, forWhom: 'all' | 'me', subjectId?)`,
  `setExamRemind(containerId, on)`, `telegramExams()`; types in `types/container.ts` (append; then run
  `node scripts/sync_bot_plan.mjs`): `ExamMoved`, `TelegramExam`, `ContainerSummary.own_exam_date?`,
  `author_exam_date?`.
- `components/containers/MoveExamDialog.tsx`: «Перенести экзамен» — «Через неделю», «Через 2 недели», «Через месяц»,
  «Своя дата» (date input, min today); the owner of an exam with active members chooses «Для всех участников» / «Только
  для меня»; a member sees «Это ваша дата. У автора остаётся 17 октября.»; a subject page passes its subject. After
  saving the page reloads its data; the line «Экзамен перенесён на 25 октября.».
- Entry points: exam page `after` → blue pill «Перенести экзамен»; `exam_today` → pill «Пройтись по ошибкам: N» (when
  there are errors) and «Перенести экзамен»; subject page passed → «Перенести экзамен»; «Сегодня»: an exam passed in the
  last 14 days stays as a quiet row «Экзамен «…» прошёл 17 октября · Перенести» instead of disappearing; the exam-today
  card gets «Перенести».
- Settings page: a member gets «Моя дата экзамена» (date, «Убрать»; note «Только для вас. У автора — 17 октября.»);
  both get «План в Telegram по этому экзамену» when Telegram is linked.
- Profile «Уведомления» → TelegramCard: «Экзамены в плане» — a row per exam with a switch (telegramExams /
  setExamRemind) instead of the one «Экзамен — …» line; «Ни один экзамен не выбран — план не приходит.» when all are off.
- Tests for the dialog, every entry point, settings and TelegramCard.

## Verification

- D: the local rehearsal green; `node --experimental-strip-types --test supabase/functions/_shared/bot/*.test.ts` green.
- E: `npx vitest run` on touched areas and the whole suite once; `tsc -b` clean; `node scripts/sync_bot_plan.mjs --check`.
- Me: merge with release 47, full gate, migrations through the workflow, bot deploy, site release, live check (move for
  all / for me, the bot's exams screen on the test account's Telegram if linked, «Сегодня» row).
