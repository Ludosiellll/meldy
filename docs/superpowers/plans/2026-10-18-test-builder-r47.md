# Release 47 — guests, «Новый тест», explanations, cover and colour, «тренироваться дальше»

> For agentic workers: each agent owns the files listed for it and nothing else. The data contract below is fixed; if
> it cannot be met, stop and say so instead of inventing another shape.

**Spec:** meldy-notes `10_Project/Test_Builder_Spec_2026-10-18.md` §47 (owner 2026-10-18: «давай добавим все и
обойдем даже то, в чем они сильнее»). Base: release 46 (`docs/superpowers/plans/2026-10-16-quiz.md`,
`supabase/migrations/20261016120000_quizzes.sql`, `20261016140000_quiz_result_order.sql`).

**Foundation (already on the branch):** `types/quiz.ts` (QuizAccent, QUIZ_ACCENTS, new QuizSettings/QuizRow/QuizPreview/
QuizAttemptRow/QuizResult fields), `types/container.ts` (`TestItem.explanation`, `ItemInput.explanation`,
`ItemPatch` 'explanation', `EXPLANATION_MAX`, `TEST_ITEM_COLUMNS` with `explanation`, RPC `container_items_reorder`),
`api/containers.ts` (`reorderItems`, `normalizeItem` reads explanation), `api/quizzes.ts` (token-aware `previewQuiz`,
`startQuiz`, `sendAnswers`, `finishQuiz`, `quizResult`; `claimGuestAttempts`, `joinPractice`; MC016–MC018),
`api/itemPictures.ts` (`COVER_BUCKET`, `uploadPicture(path, picture, bucket)`, `coverUrl(path)`),
`lib/quizzes/guestToken.ts` (`guestToken`, `ensureGuestToken`, `dropGuestToken`, `TOKEN_RE`), `copyQuiz.ts` errors.

## Global constraints

- Russian UI words: plain, no AI tells; Meldy design language (Onest, white cards, blue pill primary, both themes,
  1532×734 laptop, 390 phone, no horizontal scroll).
- The author always signs in. A guest never becomes a Supabase user; a guest holds a token, the server keeps sha256.
- The key and the explanation never reach a taker before the review allows it.
- Everything old keeps working: quizzes, sessions, the bot, imports. Tests: Vitest for the front, the local
  PostgreSQL rehearsal for the database.
- Commits end with the session's trailer lines; never `git add -A`.

## Data contract (database — agent A)

Migration `supabase/migrations/20261018100000_test_builder.sql` (re-runnable; second apply changes nothing), rollback
`supabase/rollback/20261018100000_test_builder_down.sql`, catalog contract `supabase/tests/test_builder.sql` (DO block
raising the first failed check), rehearsal `supabase/tests/local/test_builder_behaviour.sql` + `test_builder_run.sh`
(base as `quizzes_run.sh` builds it, then 20261016120000 + 20261016140000 + this; forward twice, contract, behaviour,
the quizzes and containers behaviours still green, rollback twice, forward again).

1. **`test_items.explanation`** `text not null default ''`, CHECK `test_items_explanation_check` (≤ 2000 chars).
   `container_items_add` takes `explanation` (string, btrim; longer than 2000 or not a string → 22023 detail
   `explanation`); `container_item_update` takes patch key `explanation` with the same rule. `test_items_guard` does not
   bump `rev` for it. Members read it through the existing select (like the key).
2. **`container_items_reorder(p_subject_id uuid, p_item_ids uuid[]) returns void`** — SECURITY DEFINER, `search_path ''`;
   only the container's owner (else 42501; a missing subject → P0002 detail `subject`); the ids must be exactly all the
   subject's items, no duplicates (else 22023 detail `items`); positions become 1..n in that order. Granted to
   authenticated.
3. **`quizzes`**: `guests boolean not null default true`, `cover_path text` (null, or `^[0-9a-f-]{36}/[0-9a-f]{64}\.(png|jpg|gif|webp)$`
   whose first folder is the quiz's container id), `accent text not null default 'blue'` in
   (blue, green, orange, violet, pink, graphite), `offer_practice boolean not null default false`; CHECK
   `not (members_only and guests)` (rows with members_only get guests = false before it). `quiz_apply` takes the keys
   `guests`, `cover_path`, `accent`, `offer_practice` (none locked after start; a bad value → 22023 detail = the key);
   members_only true without `guests` given ⇒ guests false; members_only true with guests true → 22023 `guests`.
   `quiz_row` (and so QuizRow / QuizListRow) gains `guests`, `cover_path`, `accent`, `offer_practice`.
4. **`quiz_attempts`**: `user_id` nullable, `guest_hash text` (`^[0-9a-f]{64}$`), CHECK exactly one of the two;
   unique `(quiz_id, guest_hash, n)` where guest_hash is not null; index `(quiz_id, guest_hash)`.
5. **Person-aware helpers** in `meldy_private` so the user and guest paths share one logic (start, answer, finish,
   result, «me» of the preview, attempt limits). Existing public functions keep their behaviour and output.
6. **Anon + authenticated functions** (SECURITY DEFINER, `search_path ''`):
   - `quiz_preview(p_code text, p_token text default null)` — replaces `quiz_preview(text)` (drop the old one). Signed in:
     as before (token ignored). Signed out and `guests`: `me` = `{name_hint: null, is_author: false, is_member: false,
     guest: true, attempts_used, open_attempt, can_start, reason, results}` by the token's hash (no token → zero
     attempts). Signed out and not `guests`: `me` null (the page asks to sign in). Top level gains `guests`,
     `cover_path`, `accent`, `offer_practice`.
   - `quiz_guest_start(p_code, p_name, p_token)` → the same JSON as `quiz_start` (resumes an open attempt of that hash).
     Errors: token not `^[A-Za-z0-9_-]{43}$` → 22023 `token`; quiz not found → P0002 `quiz`; not `guests` → MC017
     `guests`; then as `quiz_start` (MC013, MC014, 22023 `name`); too many → MC016 `busy` (≤ 30 guest starts a minute
     from one IP — first `x-forwarded-for` of `request.headers`, hashed; ≤ 120 guest starts a minute per quiz) and MC014
     `full` past 2000 guest attempts in a quiz.
   - `quiz_guest_answer(p_attempt_id uuid, p_token text, p_answers jsonb)`, `quiz_guest_finish(p_attempt_id, p_token)`,
     `quiz_guest_result(p_attempt_id, p_token)` — as `quiz_answer` / `quiz_finish` / `quiz_result`; a token that is not
     the attempt's → P0002 `attempt` (nothing told about the attempt).
7. **Authenticated only:**
   - `quiz_guest_claim(p_code, p_token) returns jsonb {claimed}` — when the caller has no attempt in that quiz, the
     guest attempts of that hash become the caller's (user_id set, guest_hash null); else `{claimed: 0}`.
   - `quiz_practice_join(p_code) returns jsonb {container_id}` — needs `offer_practice` and a finished attempt of the
     caller in that quiz (else MC018 `practice`); the author → their container id, nothing written; removed by the
     author → MC018 `removed`; 200 active members → MC018 `full`; left before → back (left_at null); else a new
     `container_members` row, written the way `container_join` writes one (same side effects).
8. **Results:** `quiz_result_json` — each item gains `explanation` (only when the review shows answers, '' → null);
   top level gains `practice` = `{exam_title, member}` when `offer_practice` and the taker is not the author (guests
   too, member false), else null; and `accent`. `quiz_results` attempt rows gain `guest boolean`; a guest's `person` =
   first 16 hex of md5(guest_hash || quiz id). The attempt JSON of a taker never carries keys or explanations.
9. **Storage:** public bucket `quiz-covers` (3 MB; png, jpeg, gif, webp); authenticated insert/update/delete only in a
   folder named after a container the caller owns. Policy «Test item images: quiz guests read» for `anon` on
   `test-item-images`: `name in (select public.guest_quiz_picture_paths())` — the stem and option picture paths of the
   items in the subjects of quizzes with `guests` (any state, so a review after closing still shows them).
10. Grants: guest functions and `guest_quiz_picture_paths()` to anon and authenticated; claim and practice to
    authenticated; helpers private. Update `quizzes_behaviour.sql` key pins to the new shapes.

## Front — agent B (participant): `pages/quiz/QuizTakePage.tsx`, `components/quiz/QuizRun.tsx`, `components/quiz/QuizResult.tsx`, `components/quiz/copyTake.ts`, `components/quiz/quizTake.css` (+ their tests)

- Signed out and `preview.guests`: name field and «Начать» without signing in; the token is `ensureGuestToken(code)`
  at start and passed to every call (`QuizRun` gets `token: string | null`). Signed out, not guests: as now.
- Guest privacy line: «Автор увидит имя, которое вы укажете, ваши ответы и результат. Попытки сохраняются в этом
  браузере.» plus a quiet «Войти» for those with an account.
- Signed in on `/k/<code>` with a stored token: `claimGuestAttempts` once, `dropGuestToken` when `claimed > 0`.
- Cover (`coverUrl(cover_path)`) above the card, `data-accent` on the page root; accent tokens for the primary button,
  the timer bar and links, readable in light and dark (contrast ≥ 4.5 for text).
- Review: the explanation under a question when present. Result: `practice` → signed in: «Тренировать эти вопросы в
  Meldy» (note: «Вы станете участником экзамена «…»: автор увидит вас в списке участников, ваш прогресс — нет.») →
  `joinPractice` → `/exams/c/<id>`; member already → «Открыть экзамен»; guest → «Создать аккаунт и тренироваться» →
  sign-up with return to `/k/<code>?practice=1`, which after sign-in claims, then joins.
- MC016 / MC017 shown in the page's words.

## Front — agent C1 (constructor): `pages/test/NewTestPage.tsx`, `pages/test/BuildPage.tsx`, `components/test/*`, `pages/Exams.tsx` (the «Новый тест» entry only), `components/containers/actions.tsx` (menu item «Конструктор»), `App.tsx` (routes `tests/new`, `exams/c/:id/build`) (+ tests)

- «Новый тест» next to «Новый экзамен»: title → `createContainer(title, null, [{ title: 'Вопросы' }])` → `/exams/c/:id/build`.
- Build page: the subject's questions as cards (stem, options with the key, explanation when present); «Добавить
  вопрос» with a type choice — один ответ, несколько ответов, короткий ответ, «верно / неверно» (single with options
  «Верно», «Неверно», `keep_order: true`); add and edit through the existing `QuestionEditor` (do not change it);
  copy, delete (the way KeysPage deletes), up / down (`reorderItems`); an exam with several subjects shows a subject
  choice. Bottom: «Отправить по ссылке» → `/exams/c/:id/quizzes/new?all=1`.
- Menu «Конструктор» for the author, next to «Вопросы и ключи».

## Front — agent C2 (explanations and settings): `components/containers/keys/QuestionEditor.tsx`, `components/containers/keys/editorModel.ts`, `components/containers/StudyRun.tsx` (the explanation only), `components/containers/keys/KeyQuestion.tsx`, `pages/quiz/QuizSetupPage.tsx`, `components/quiz/setupModel.ts`, `components/quiz/QuizPeople.tsx`, `components/quiz/copyAuthor.ts`, `components/containers/import/copyImport.ts` (EDITOR words) (+ tests)

- Editor: «Пояснение — видно после ответа» (textarea, ≤ 2000, counter near the limit); `Draft.explanation`,
  `patchOf`/`inputOf` carry it; it never resets progress.
- StudyRun: after an answer in learn mode, the explanation under the verdict when present. KeyQuestion shows it.
- Setup: «Кто может писать» — «все по ссылке, без входа» / «все по ссылке, со входом» / «только участники этого
  экзамена» (guests / members_only); «Оформление» — cover upload (`pictureFromFile` → `picturePath(containerId, id,
  type)` → `uploadPicture(path, picture, COVER_BUCKET)`, preview `coverUrl`, «Убрать»), colour swatches with names
  (Синий, Зелёный, Оранжевый, Фиолетовый, Розовый, Графит); «После сдачи предложить тренироваться по этому экзамену»
  with its note. `?all=1`: every subject with keyed questions, all their questions, one set for everyone, questions in
  order.
- People table: «без входа» next to a guest's name, and the hint that a guest's attempts are counted per browser.

## Verification

- Agent A: `TMPDIR=<scratchpad> bash supabase/tests/local/test_builder_run.sh` all green; `quizzes_run.sh` still green.
- Agents B, C1, C2: `npx vitest run` on their files, `node_modules/.bin/tsc -b` clean.
- Integration (me): full gate, the migration through `supabase-migrate.yml`, release, live check with a guest in a
  separate browser without signing in, the constructor from an empty account.
