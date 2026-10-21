# Hugging Face releases

Each change to this file on `claude/relaxed-hypatia-1tpmq5` runs `.github/workflows/deploy-hf.yml`:
the live Space `main` is tagged `hf-backup-<UTC>-pre-push`, then the released tree (without `qa-screens/`)
is pushed on top of it, and the job waits for `RUNNING` and checks `/` and `/api/health`.

## 2026-10-21 — Release 47.11: the live game after its check on the real database, still closed; the Supabase route (from the commit of this entry)

- **«Битва с монстром», after the live check on the real database** (4 games, a class of 23–24, Realtime, reconnects):
  the phones no longer wait forever when the teacher ends a game early («Игра закончилась», the review, «Войти по
  PIN»); the teacher's podium says «Игра закончена · N вопросов из M» instead of «Дедлайн победил»; a late joiner sees
  the buttons shut with one line instead of a failing tap; the PIN is checked before the character builder; the
  reveal is one moment — one damage number flies into the HP bar, the question's top three under it; «Время вышло»
  at zero instead of a frozen «0»; names a room can read, seats that stay put after a removal; a lobby for the
  room; sound made on the device (lobby, ticks, the hit, the fanfare) with a switch; on the phone «Илья впереди на
  150 урона», «Ваш ответ пришёл 4-м», a full final screen and a share text with the result.
- **The Supabase route:** a short failure (a reload during a request, a few seconds without network) no longer sends
  a browser through the site for 12 hours without Realtime; a move to the site after a failure lasts 10 minutes, then
  the direct way is probed again.
- **Still closed:** «Провести игру» stays hidden (`lib/live/open.ts`), `?live=1` for the second live check.
- Gate on 61d951b: pytest 2316, bot 387, sync ok, Vitest 370 files / 6338 tests, Docker-layout build ok.

## 2026-10-21 — Release 47.10: the live game's players' side, still closed (from the commit of this entry)

- **«Битва с монстром», the students' side:** `/play` (PIN or link, name, a character from parts, lobby, big colour and
  shape answers with haptics, «Ответ принят», hit or freeze, place after each question, the boss's phases, the
  podium, review, «Поделиться»; reconnect after a reload, «Нет связи. Переподключаемся…», a removed player is told)
  and `/tg/play` in Telegram (full screen, safe areas, haptics, BackButton, the name from Telegram, its own
  wardrobe). The bot posts the game into the exam's group and edits the post as the game goes, then posts the
  result; `/start play_<PIN>` answers with an «Играть» button (function deployed before this release). An answer tap
  paints in 51–68 ms at CPU ×4.
- **Still closed:** «Провести игру» stays hidden (`lib/live/open.ts`); `?live=1` opens it in one browser for the live
  check on the real database before the game opens for everyone.
- Gate on fc2fb95: pytest 2316, bot 386, sync ok, Vitest 365 files / 6276 tests, Docker-layout build ok.

## 2026-10-21 — Release 47.9: smoothness outside the studio, the 47.8 live check's fixes, the live game's base (from the commit of this entry)

- **Smoothness** (owner, 20.10: «никаких пролагиваний… нигде»), phone 390×844 with CPU ×4: typing in the question
  editor — one layout per key (forced layouts 26 → 12 for 12 keys); opening a lecture — longest task 419 → 185 ms, the
  summary's Markdown parsed once, non-composited animations 14 → 0; «Подкаст» — layouts 27 → 4; the exam sheet and
  «Сегодня» — no forced layout; the guide's ring and cut-out move by transform (Layerize 39 → 4 ms); the cards come in
  on the compositor; one shared size observer (`lib/observeSize.ts`). Guards in every test run: render budgets
  (`src/test/renderBudget.test.tsx`) and a CSS smoothness lint whose baseline only shrinks.
- **The studio on a phone without lag** (owner: «в конструкторе тоже пролагивание с телефона идет»), 30 blocks, CPU ×4:
  a typed key re-renders 10 components instead of 489 (one commit, no forced layout from our code, 43 → 59 fps); a tap
  to edit 292 → 152 ms; a drag 57–60 fps, a slot change redraws two gaps and the handle; a 12 MP photo is prepared in a
  worker (no long task). Toolbar buttons 44×44; in landscape the canvas gets 214 px instead of 179. Screenshots of
  every view are pixel-identical before and after.
- **The 47.8 live check's fixes:** «Отсюда новый вопрос» in «Сомнительные места» no longer marks a glued question
  checked — each part keeps a doubt while it still looks glued, and a key the file gave the whole glued block is
  dropped with «Отметьте верный вариант»; after the model pass the questions are numbered by their place, show their
  file lines, «Другая версия» says when only the key differs, and a saved question no longer takes the model's line
  number as its label; the AI-limit ring updates after the pass; the training clips' styles no longer leak into the
  lecture «Тест» tab and the «Перенести экзамен» dialog; the landing's static first screen leaves the page once the app
  is drawn; the landing mini studio scrolls a new block into view; «вопрос 2» keeps its number on a phone; no focus
  frame on the question after reloading a session.
- **Live game «Битва с монстром» — the base, not open yet:** database and Telegram routes (migration
  `20261021090000_live_game` applied before this release, run 39514709631; `telegram` deployed, `/setup` ok) and the
  teacher's screen (`/live/new`, `/live/:id`). «Провести игру» stays hidden until the students' side is out
  (`lib/live/open.ts`).
- Gate on 7567e0a: pytest 2316, bot 376, sync ok, Vitest 360 files / 6236 tests, Docker-layout build ok.

## 2026-10-21 — Release 47.8: the new main page, «Защита от списывания», the studio on a phone (from the commit of this entry)

- **Main page v3 «Один вопрос»** (owner, 19.10: «переделать основную страницу… видео, так как там нет ничего про
  функции… особенно про конструктор не забудь»): one lecture and one ticket question through lectures, the department
  file, the plan, a session, the ticket aloud, the cheat sheet, the group and Telegram, and the test constructor as the
  longest chapter (76 s reel); a small studio to touch on the page; «Пройти тест без входа» opens the jury's public test.
  Headline «Готовьтесь к экзамену и собирайте свои тесты», one face «Meldy — подготовка к экзамену и конструктор
  тестов», preview `og-image-4.jpg`. The first screen is static HTML; a guest on «/» no longer loads the Supabase client
  and nothing is prefetched at idle. Phone ×4 (local build): LCP 7.8 → 0.8 s, reel 40 → 56–58 fps, JS before the first
  action 255 → 143 KB, 10 composited layers.
- **«Защита от списывания»** for a контрольная (owner, 20.10): off / normal / strict. The question is covered the moment
  the page loses focus or visibility, shrinks to split screen or leaves fullscreen; every time away is recorded once
  with its kind, length and question; strict adds fullscreen on Android, no selection or copy, a watermark with the
  name, and the attempt ends itself after N times away (checked by the server too). The author sees each attempt's
  record, marks in the stats and the CSV, a filter «только с нарушениями». Migration `20261020120000_quiz_protection`
  applied before this release (run 39506621429, checks green). A web page cannot see a second phone or a photo of the
  screen; the page says so.
- **The studio on a phone and a tablet:** the bottom bar up to 1023 px, a new block scrolled into view, no bar over the
  keyboard, 44 px targets, names «Настройки блока / Копия / Удалить», «Вернуть» after a removal, the sheet steps away
  during a drag, «Отправить» under 400 px, hints in two lines, hover only where there is hover, «Проверка теста» in its
  own sheet; the 47.4 live check's media items (one-screen background, 16 px video field, «Загрузить другую», status
  order, HEIC words, bad-link error in view, `allow` only, cover upload with upsert).
- Gate on 2d102ab: pytest 2313, bot 359, sync ok, Vitest 343 files / 6165 tests, Docker-layout build ok.

## 2026-10-20 — Release 47.7: question files of any layout — CSV, HTML, Moodle XML, PDF, doubtful places for the model, a review screen (from the commit of this entry)

- **The owner, 19.10:** «наш парсер не универсален… он должен идеально под всевозможные варианты подстраиваться». The
  rule parse now reads CSV, HTML, Moodle XML and PDF (text layer via PyPDF2; a scan goes to the existing OCR path) and
  scores every question's confidence. Wild corpus: right keys 1026 → 1074 of 1080 (tuned set), 60 → 102 of 122 and
  54 → 129 of 152 on the two later sets (tuned during this stage too, so a fresh held-out set comes next).
- **«Разобрать сложные места»** (`POST /api/exams/parse-bank/ai`): only the doubtful chunks go to the model on a press
  (5 units per started 100 questions, in the AI limit and the heavy-call slot); the model cites line ids, the server
  rebuilds text from the file and accepts a key only with a mark it finds there — a stand-in model sending fake keys
  had every one refused. A real model has not been run yet (no provider keys in the build machine).
- **«Сомнительные места»**: each doubtful question beside its lines of the file, one-press fixes («это ключ», merge,
  split, «не вопрос», «это вариант вопроса выше», take the model's or the rules' version); phone-safe at 375 px.
- The live game's contract, fake server and art are in the tree (`docs/live/`, `lib/live/`, `components/live/art/`),
  not reachable yet except a development-only preview.
- Gate on df62de1: pytest 2313, bot 359, sync ok, Vitest 338 files / 6108 tests, Docker-layout build ok.

## 2026-10-20 — Release 47.6: the owner's three session bugs, plain words without the hand-drawn line, phone fixes (from the commit of this entry)

- **The owner, 20.10, three bugs in a study session.** (1) After a right answer the session moves on by itself and
  the phone kept `:hover` on the reused option button, so the same place lit up on the next question, which could be
  the right answer when a bank keeps keys in one place: options and the short-answer field are now keyed by question,
  and the tint is for devices that hover. (2) «Только ошибки: N» counted every open mistake while its session skipped
  today's answers: the mistakes session no longer skips them (a right answer still counts only by the day rule).
  (3) A reload started a new session from question 1: the session is kept from its start with `?sid=` in the address,
  so a reload or a killed browser returns to the same question; an answer on screen is sent once when the page closes.
- **Plain words** (owner, 19.10: «убрать иишные надписи и это подчеркивание волной»): no eyebrow, h1 «Тренажёр экзамена
  по вопросам вашей кафедры», no «X — Y» headings or kicker chips, no «ИИ не придумывает» captions; the hand-drawn yellow
  line is gone from the landing, the reel, the plan card, the session end, «Как на экзамене», «Сегодня», «Разобрать
  лекцию» and the clips. One face: title, meta, manifest, README, link preview `og-image-3.jpg`.
- **Phone fixes outside the studio:** a way back on quiz pages, 16 px code and link fields, the run turned sideways,
  the guide's buttons at the bottom of its card, a sticky «Сохранить» in the keys editor, sign-in without the banner on
  short phones, «Нажали не туда?» clear of the bar, 13 px badges, sheet numbers at 5:1 contrast, lecture tabs in one
  scrolling row, hover looks only where there is hover; a refused picture's message where it was picked; the cover hint
  as it is now; deleting a test or exam removes its pictures from storage first.
- Gate on 85a2921: pytest 2242, bot 359, sync ok, Docker-layout build ok, Vitest 6065/6066 — the one failure
  (`mapDraw.test.ts`, 5.2 s against a 5 s limit at load 15) passes alone 4/4.

## 2026-10-20 — Release 47.5: the main page no longer lags on a phone (from the commit of this entry)

- **The owner, 19.10:** «на телефоне вроде подлагивает главная страница». Measured on a 390×844 phone profile with the
  CPU slowed ×4: finger scroll 30 → 45 fps (×6: 27 → 45), the reel 31 → 44 fps (the cheat sheet chapter 19 → 38),
  tasks over 50 ms in 50 s of the reel 217 → 64; on the landing without a press, JS 322 → 156 KB at most, no app chunks.
  Both sides were measured interleaved under the same machine load, so the absolute numbers are lower than a phone's.
- The mic's pulse is two rings animated by scale and opacity, only while the mic is on screen (was an endless box-shadow
  animation); the reel's particle canvases hold as many pixels as the screen shows; the cheat sheet's map redraws only
  the squares that changed; on a phone or a slow connection Login/Register/TryExample load on the first press, not in
  advance; the «→» in the sheet's lines is an inline SVG, so the 19 KB symbols font is not fetched. The look is the same.
- Gate on c23db9e + this change: pytest 2242, bot 359, sync ok, Vitest 331 files / 6019 tests, Docker-layout build ok.

## 2026-10-19 — Release 47.4: own pictures, own background and a video block in the studio; question import from wild layouts (from the commit of this entry)

- **The owner, 19.10:** «почему нельзя добавлять свои картинки и тому подобное, на фон тоже почему нельзя своё».
  Every picture field starts with «Загрузить свою картинку», then the ready pictures; a file can be dropped on the field
  or pasted with Ctrl+V; pasting anywhere in the studio, or dropping files on the page, makes picture blocks. Phone
  photos are made to fit (up to 2400 px, turned by EXIF; HEIC gets a plain message) in the studio, the question editor
  and the quiz cover. «Картинка» as a background starts with the upload, and the participant's result screen shows it.
- **«Видео» block:** a YouTube, RuTube or VK Видео link with a caption; the page keeps only the link, the player is
  drawn by the client; nginx allows these three player hosts in `frame-src`. Migration `20261019110000_doc_video`
  (applied before this release, run 39237042672, checks green); parity corpus 173 cases.
- **Question import** (`bank_parse`): question numbering, one-line options, marks before options, keys per variant,
  page furniture, tables, Word text boxes, Kahoot/Quizizz sheets, Markdown headings, Google Forms copies; a question
  number the key gives two different answers gets no key and a flag. Wild corpus of 149 files with ground truth:
  right keys 73.7 % → 95.0 % on the tuned set, 30 % → 49 % on the held-out set, no invented keys.
- Gate on 573a48d: pytest 2242, bot 359, sync ok, Vitest 329 files / 6008 tests, Docker-layout build ok.

## 2026-10-18 — Release 47.3: how-to videos for the new features; the 47.2 live check's findings (from the commit of this entry)

- **The owner, 18.10:** «для новых функций тоже нужно сделать обучение с видео». Four clips in Meldy's own look (10–14 s,
  a line of plain text per step, reduced motion as still frames): «Свой тест» (studio), «Тест по ссылке» (how a student
  without an account sees it), «Перенести экзамен», «Экзамены в Telegram». The guide «?» gets a chapter «Тесты» after
  «Экзамены», and «Экзамены» gets its own row of clips; the studio tour's first step plays «Свой тест»; the move dialog
  shows «Перенести экзамен» once (`components/clips/*`, `components/guide/*`, `components/tips/*`).
- **From the 47.2 live check:** a new block's default word («Заметка», «Заголовок», «Текст», the cover title) is selected
  on first edit, so typing replaces it; the preview's last button and the templates say «Завершить», as the real run;
  the preview scrolls to the first missing required question; a test's pages say «тест» (the quiz list, practice and
  members-only options) and deleting a test's quiz lands on the test's page; the run's top line is opaque; a request cut
  off by leaving the page no longer logs a console error.
- Gate on 72e45e0: pytest 2069, bot 359, sync ok, Vitest 326 files / 5868 tests, Docker-layout build ok.

## 2026-10-18 — Release 47.2: «Студия теста», a test's own page, actions in place (from the commit of this entry)

- **The owner, 18.10:** «как будто ты сайт создаёшь… перетаскивать, расставлять как захочешь + подсказки»; then, on the
  release 47 test page: «не слишком ли перегружен… Почему конструктор не по центру… кнопки перекидывают в настройки…
  нужно чтобы они сразу давали возможность сделать то, чего ты хочешь».
- **«Студия теста»** (`/exams/c/:id/studio`): a test as a page of blocks — cover, heading, text, picture, note, divider,
  new page, questions — dragged from the palette or added with «+», moved by mouse or keyboard, edited in place; three
  views «Холст / Список / Текст» (the whole test as text and back); «Оформление»: six colours or your own (nudged for
  readability), background, font, corners, density, answers as a list or tiles, four ready themes and six covers;
  «Результат»: up to six bands by percent with a picture and a «Ссылка дальше»; «Проверка теста» with one-press fixes;
  «Посмотреть как участник»; points and «обязательный» per question; undo/redo; autosave with a guard for two tabs; a
  first-visit tour and four templates. Database `20261019100000_test_docs` (applied 18.10 before this release).
- **The participant sees the page:** a quiz sent from the studio («как в студии») shows the studio's cover and theme on
  the start, the run (one by one with notes above questions, one page, or pages with «Дальше») and the result (the band,
  «9 баллов из 12 · 75 %», the link); required questions are checked before «Завершить»; the author's table and CSV
  count points.
- **A test is its own kind** (`20261019090000_container_kind`, applied 18.10): its page has «Открыть студию», «Отправить
  по ссылке», its контрольные and «Ещё» — no study plan; the author's own tests stay out of «Сегодня» and the Telegram
  plan; «Это тест / Это экзамен» in settings.
- **Actions in place:** «Удалить», «Время в день», «Пригласить группу» (with «Показать QR») open right on the exam page
  instead of sending to «Настройки»; at most three buttons plus «Ещё» on a computer, as on a phone. The constructor list
  is centred.
- Gate on 17fde9d: pytest 2069, bot 359, sync ok, Vitest 322 files / 5813 tests, Docker-layout build ok.

## 2026-10-18 — Release 47.1: the release 47 live check's findings (from the commit of this entry)

- **Phone:** the quiz setup's «Отмена / Создать» (and «Сохранить», «Новая контрольная») sit above the bottom tab bar, not
  under it. **Laptop 734 px:** «Ещё настройки» stands at the top of the right column, in view without scrolling.
- **The clock:** the 5-minute warning only for attempts longer than 5 minutes (a 5-minute test no longer starts red);
  the 1-minute warning for anything longer than a minute.
- **Words:** the guest page drops «экзамен «…»» when it repeats the test's name; «После сдачи предложить тренировать эти
  вопросы в Meldy»; the author on their own /k sees «Имя и фамилия»; stats hide «Попытки» for one-attempt tests and say
  «меньше минуты»; «Вопрос N добавлен.» is announced once; the two lines under «Новый экзамен» / «Новый тест» wrap alike.
- Gate on b686771: pytest 2069, bot 359, sync ok, Vitest 312 files / 5660 tests, Docker-layout build ok.

## 2026-10-18 — Release 47: tests without sign-in, «Новый тест», explanations, the test's look, «Перенести экзамен» (from the commit of this entry)

- **The owner, 18.10:** «давай добавим все и обойдем даже то, в чем они сильнее»; «все новые функции должны быть на
  огромном уровне». Spec: meldy-notes `10_Project/Test_Builder_Spec_2026-10-18.md` (§47.1–47.5).
- **A test by link without an account.** A guest types a name and writes; the attempt lives under a random token in this
  browser (the server keeps its sha256). Answers, the timer, the review and the pictures (Edge Function `quiz-media`) work
  as for a signed-in taker. On a shared computer the page asks «Это я / Это не я» before moving a guest attempt into an
  account, and «Я другой человек» starts fresh.
- **«Новый тест» and the constructor** (`/tests/new`, `/exams/c/:id/build`): questions from scratch, the editor under the
  list with «Сохранить и следующий», compact options (Enter for the next one), a live line about how many answers are
  right, a guard for unsaved edits; explanations for every question (shown with the right answer).
- **The test's page:** a cover and one of six colours; the start screen fits a laptop and a phone with «Начать» in view;
  «осталось 19:58» with 5- and 1-minute warnings; the result marks a right answer you missed; the pass mark as a bar.
  The author's setup from the constructor is short («Ещё настройки» folds the rest), the title is the test's name, the
  link has «Показать QR», «Поделиться», «Открыть как ученик».
- **«Тренировать эти вопросы»** after a test — only once no test of the exam is open (training shows every answer).
- **«Перенести экзамен»** on the exam page, a subject's page and «Сегодня» (a passed exam stays there for 14 days with
  «Перенести»); a member's own date in settings; «Экзамены в плане» in the profile with a switch per exam. The bot's
  part went live on 18.10 (migration `20261018120000_exam_move_bot_exams`, function `telegram`).
- **Security (before this release):** `20261018130000_quiz_guards` and `20261018140000_quiz_practice_grace` — training
  waits for the closing (+20 s), the address throttle under a secret HMAC; the `/sb/` proxy keys anonymous callers by the
  visitor and forwards only the visitor's address. CSV cells starting with = + - @ get an apostrophe.

## 2026-10-16 — Release 46.1: the review in the attempt's order; the author's page says what it means (from the commit of this entry)

- **From the release 46 live check (account B as author and participant).** The review listed a question's options in the
  file's order, so «Ни в одном» picked as А showed up as Д. The order is not stored — the attempt derives it from the
  attempt and the question — so the review now derives the same one (`quizOrder` moves to `lib/quizzes/quizModel.ts` and
  serves both) and shows the same letters.
- **Database (applied 16.10 before this release):** `20261016140000_quiz_result_order` — `quiz_result` also gives the
  quiz's `shuffle_options` and each question's `keep_order`; nothing else changes, the key stays behind the review.
  Rehearsed with `quizzes_run.sh` (32/32, its own rollback included), contract `supabase/tests/quiz_result_order.sql` ok live.
- **The author's page:** with only the author's own try it said «Пока никто не писал» above that very row — now «Пока
  писали только вы — ваши попытки в итоги не идут…»; «Контрольная создана» no longer comes back after a reload; «сдал(а)»
  is «сдано»; the empty «Вопросы» tab says the author's own tries do not count there.

## 2026-10-16 — Release 46: «Контрольная» — a test sent by link, with the author's settings and live results (from the commit of this entry)

- **The owner, 16.10:** «если ты хочешь кинуть кому-то тест, то ты выставляешь сам как будет (например таймер) и можешь
  смотреть постоянно статистику как отвечают»; then «стоит добавить возможность попыток выбора и тд». Spec: meldy-notes
  `10_Project/Quiz_and_Editor_Spec_2026-10-16.md`, part 2; plan `docs/superpowers/plans/2026-10-16-quiz.md`.
- **The exam menu has «Контрольные».** The author picks the subjects, how many questions (one set for everyone or a
  different draw each), shuffling of questions and options, a timer (or none), when it opens and closes, attempts (1, 2,
  3, 5, any) and which counts (best or last), going back to a question, a pass mark, what the participant sees after
  («балл», «ошибки», «ответы», or answers once it closes) and «только участники экзамена». Once somebody has started,
  the set, the count, shuffling and the timer stay as they are.
- **The participant opens `/k/<code>`** (no account needed only to read the card; writing needs a sign-in), is told
  before the start that the author will see their name, answers and result, and writes against the server's clock: a
  reload or a second tab goes on with the same attempt, answers are saved as they are given, the time ends the attempt
  on the server too.
- **The author's page** of a quiz: who is writing now and who has finished (one row a person, the attempt that counts),
  the average and how many passed, the questions hardest first with what was chosen, any attempt's answers, «Сбросить
  попытку», «Закрыть сейчас» and the table for Excel. It refreshes every 5 s while somebody writes, every 30 s otherwise.
  The ordinary shared exam stays private as before.
- **Database (applied 16.10 before this release, `supabase-migrate.yml`):** `20261016120000_quizzes` — tables
  `quizzes`, `quiz_attempts`, `quiz_answers` reachable only through the `quiz_*` functions; the key leaves the server only
  in a result whose review allows it; question pictures are readable by people with an attempt. Rehearsed locally
  (22/22, two tabs racing), contract `supabase/tests/quizzes.sql` ok live.

## 2026-10-16 — Release 45: the author edits questions — «Вопросы и ключи» (from the commit of this entry)

- **The owner, 16.10:** «не хватает возможности самому менять вопросы, редактировать, картинки вставлять». Spec:
  meldy-notes `10_Project/Quiz_and_Editor_Spec_2026-10-16.md`, part 1; plan `docs/superpowers/plans/2026-10-16-question-editor.md`.
- **«Ключи» is now «Вопросы и ключи».** Every question has «Изменить»: the text (ticked as code — shown as typed), the
  pictures of the question and of each option (a file or Ctrl+V into the field; a photo over 3 MB or 2000 px is redrawn
  as JPEG first), the options (add up to 8, remove down to 2; the key moves with them), «верный» ticks (two or more
  make a question with several answers), «Не перемешивать варианты», or the accepted forms of a short answer. Only what
  changed is sent; a typo keeps everyone's count, a new key or option count restarts the question — said before saving.
- **«Добавить вопрос»** in the chosen subject, numbered after its last one; **the find field takes words** too («грюнвальд
  битва»: every word, any case, ё = е; 30 at a time).
- **Database (applied 16.10 before this release):** `20261016100000_item_update_images` — `container_item_update` takes
  `images`; the table CHECK keeps every path in the exam's folder; more option picture lists than options → 22023.
  Rehearsed locally (16/16), live body checked by md5 before and after, contract `supabase/tests/item_update_images.sql` ok.

## 2026-10-14 — Release 44.20: «пометка не перенеслась» instead of «картинка не перенеслась» (from the commit of this entry)

- **The owner's screenshot (Ключи → Проверить, «Вариант 2 · № 117»):** the picture is shown, yet the line said «Картинка
  из файла не перенеслась». In those 13 questions (IDEF0 «выделенная стрелка», DFD «этот блок») the picture did come; what
  did not is a Word shape drawn over it — a red ring round the asked arrow, a filled box over the block's label (without
  it the label gives the answer away). Such a question still stays out of sessions until the author decides; the line now
  says so: «Картинка перенеслась, а пометка поверх неё (стрелка, рамка, заливка из Word) — нет.» (import check queue and
  «Ключи»).

## 2026-10-14 — Release 44.19: a key file with a column per variant (from the commit of this entry)

- **The owner's files:** «Вариант 1/2/3» (160 questions each, no marks) and their key as one table
  «№ | В1 | В2 | В3 | № | В1 | …». The key-file reader took each row as pairs «номер | ответ», so every variant got the
  first column (В1): variants 2 and 3 would have saved 110 and 113 wrong answers of 160 without a word. Found before
  anyone imported with it (no `key_text` items in the database).
- **Fix (`backend/bank_parse.py` `variant_columns`):** a table whose header has «№» followed by variant labels («В1»,
  «Вар. 2», «Вариант 3», «1 вар.») gives one key section per variant; each test takes the section of its own variant
  (as with «КЛЮЧ ОТВЕТОВ — ВАРИАНТ 4» headings), and a test without a variant number gets none silently. On the
  owner's files: variant 1, 2, 3 → 160/160 each, equal to their own column, no conflicts.
- **One key for several variants on the import page:** once a test file has taken its section of a key file, the same
  key file goes to the other files of this import that have no key and whose variant it holds — each its own section.
  A file with its own key (bold, a pasted list, another key file) keeps it.

## 2026-10-14 — Release 44.18: «Как можно быстрее» and a whole variant in «Как на экзамене» (from the commit of this entry)

- **The owner's question:** «можешь добавить вариант "выучить побыстрее" а не по дате, чтобы учить как можно быстрее?».
  «Время в день» (the exam's «Настройки» and the import form) gets a second choice under it, «Новые вопросы»:
  «Равномерно до даты» (as before) or «Как можно быстрее». Fast: every new question as soon as it fits — the minutes a
  day are the only bound (no even spread to the date, no 15 a day without one); mistakes and the second check on
  another day still come first, so nothing counts sooner than the rule allows. No date is needed: the line under the
  minutes says «При 60 минутах в день все 960 вопросов вы увидите к 9 ноября — за 27 дней занятий.» (on «Все вопросы»:
  «Все 960 вопросов — сегодня: около 16 часов. На следующий день — повтор …»). The forecast counts each question's
  answers as the minutes estimate does (a mistake comes back more than once); a simulated learner sees six variants of
  160 within two days of it. The «Без даты — по 15 новых в день» note is not shown in fast mode.
- **Where it is kept:** `container_plans.tempo` ('date' | 'fast', default 'date'; each member has their own, like the
  minutes), handed out in `settings` by `plan_inputs_for` and `container_summary_for`. Migration 20261014170000_plan_tempo,
  rehearsed locally (`supabase/tests/local/plan_tempo_run.sh`: twice, behaviour, the containers contract and behaviour,
  rollback byte for byte) and applied live through the Supabase connector; the live bodies matched the repository before
  (67e108db…) and after (9f2f64b6…). The bot computes with the same plan copy (synced), so its sessions follow the tempo.
- **«Как на экзамене» for a whole variant** (the owner: «почему нельзя 160 вопросов сделать?»): the setup offered at
  most 100 questions; now 120, 150, 200 and the subject's whole count up to 200 — the database's own bound
  (`test_mock_runs.items`, `container_mock_finish`). Times add 150, 180 and 240 minutes (a minute a question by default).
  An exam itself holds up to 2000 questions; 6 × 160 = 960 was always fine.

## 2026-10-14 — Release 44.17: pictures of questions and options (from the commit of this entry)

- **The owner's question:** «картинки он не ест, а если вопрос является картинкой, что делать?». The import page now asks
  the importer for a DOCX's pictures (`pictures=1`, only with a file) and saves them with the questions: before a
  subject's questions, each picture goes once into the container's folder of the private bucket `test-item-images`
  (`<container>/<sha256>.<ext>`), then the questions carry their paths (`test_items.images`, migration 20261014120000,
  applied live earlier today). A question that is only a picture is saved as «Вопрос на картинке», an option that is only
  a picture as «Рисунок Б» (the database keeps text); the pages show the picture and keep those words for screen readers.
- **Where they show:** the study card (under the stem; small cards inside the options), «Ключи», and the import page's
  check queue (the file's own pictures before saving). A picture sits on white in both themes (diagrams are black lines on
  a transparent page). A picture that does not load says «Картинка не загрузилась.» with «Загрузить ещё раз».
- **When a picture does not reach storage:** a network failure stops the save like any other step (the next try puts
  only what is missing); a picture storage refuses is a lost image as before — the question is saved without its key and
  with has_image, so no session asks it unseen. Pictures Word draws as shapes (the IDEF0 diagrams of «Вариант 1») and
  EMF/WMF are still not carried: those questions stay in the check as before.
- **The same words under another picture** («Что означает выделенная стрелка?» ×3) are different questions for the
  repeat check and for «Обновить из файла».
- **Telegram:** the bot writes text only, so it does not ask a question with pictures (private sessions and «Вопрос
  дня»); those are studied on the site and in the Mini App. Migration 20261014150000_bot_skips_pictures, rehearsed locally
  (`supabase/tests/local/bot_skips_pictures_run.sh`: every bot package, the migration twice, behaviour, rollback byte for
  byte, the bot's contract) and applied live through the Supabase connector (the migration workflow's access token is
  refused: «Invalid access token», the owner renews it); the live bodies matched the repository before and after.
- **Variant names** (the owner: «экзамен где будет 6 вариантов»): a file «Вариант_1.docx» no longer loses its number
  (it was «Вариант» for all six); a one-subject file whose name has no number but whose questions sit under «ТЕСТОВЫЙ
  ВАРИАНТ 4» is named «…, вариант 4».
- **Verified before release:** vitest (full run), tsc -b, bot tests 343 after the plan copy sync; the owner's files on
  the live importer (44.16): variant 4 + its key 160/160 keyed, f4 240 questions with 25 pictures carried.

## 2026-10-14 — Release 44.16: college test files with the question across the table; the key in another file (from the commit of this entry)

- **The owner's files:** «ТЕСТОВЫЙ ВАРИАНТ 4» and «Вариант 1» keep each question in one cell merged across the table and
  the five options in the cells of the next row. Meldy read the merged row as a topic and the options row as a question:
  160 «questions» of one option, no key. The importer now reads that layout (`table_stem_rows`): variant 4 — 160
  questions × 5 options, the bold key on all 160; variant 1 — 160 × 5 (that file marks no answers). A stale second number
  («86.17. Какое свойство…») takes the one that continues the numbering; «Вариант N» above the table is not a topic.
- **The key in another file** («КЛЮЧ ОТВЕТОВ — ВАРИАНТ 4 / 5 / 6», tables «1 | А | 2 | Г…»): «Ключ в другом файле» next to
  «Вставить ключ списком», and «Ключ отдельным файлом» in «Как в файле отмечен ответ?». The key file (DOCX, XLSX, TXT, MD)
  goes with the questions; Meldy takes the section of the test's own variant. It stands above the file's marks like a
  typed key, so a disagreement with the bold is flagged for the check. When no section fits (variant 1 against a key of 4,
  5, 6), nothing is taken silently: «В файле ключа нет варианта 1, есть: 4, 5, 6. Выберите нужный.» and a button per
  section. The owner's pair: variant 4 + its key — all 160 answers agree with the bold in the file.
- **Pictures** in these files still stay out of the sessions until checked (20 questions in each variant): carrying them
  over is the next release.
- **Verified before release:** pytest 2048 (the two audio-cut tests fail in this container on the base commit too: its
  ffmpeg), vitest 4566, tsc -b; the owner's four files through the importer.
- **Second run:** the first gate (run 84) stopped on «The bot's plan copy is stale: container.ts» (the parse result's
  new types); the copy is synced (`node scripts/sync_bot_plan.mjs`, bot tests 343). The importer can now also carry the
  pictures of a DOCX, but only when the page asks with `pictures=1`; this release's page does not, so a question with a
  picture is still held for the check («has_image») until the pictures release.

## 2026-10-14 — Release 44.15: a subject's row names its numbers (from the commit of this entry)

- **The owner's report:** after 40 answers in ТРПО the exam page's row read «0 из 373 · сегодня 147». The 0 was the
  questions in the count (right on two different days; the first count tomorrow), but bare it read as «nothing seen».
  The rows of the exam page (with variants and oral) and of a subject's topics now say «видели 40 из 373 · сегодня 147»,
  and «· в счёте 12» once a question counts; a row not started still says «373 вопроса». Each part keeps together on a
  phone: the line wraps only after « · ». The landing's example exam reads the same (its 410 seen split per subject).
- **Verified before release:** vitest 4564 (the full run, then the one topic-row test it caught, updated), tsc -b; the landing rows at 1440, 390 and 320 px.

## 2026-10-14 — Release 44.14: the link preview under a new address (from the commit of this entry)

- **The owner's report:** an invite link (`/g/<code>`) sent in Telegram showed the old paper cheat sheet. The site has
  served the new picture (list + map of lines) since 2026-10-10, but Telegram keeps a preview picture by its address,
  and the address `og-image.jpg` never changed. The picture is now `og-image-2.jpg` (the same file, renamed), so every
  new preview fetches it; `render.mjs` names the file in one place and says why a new look takes a new name.
- **Already sent previews** keep the old picture in Telegram's cache: a new invite link, or the old one refreshed
  through @WebpageBot, shows the new one.

## 2026-10-14 — Release 44.13: «Все вопросы» — the choice after 90 minutes (from the commit of this entry)

- **The owner's case:** three subjects, 1120 questions, a test in three days. At 90 minutes the plan saw «около 150 из
  1120» and the line ended there. Now «Время в день» has one more choice, «Все вопросы» (`minutes_per_day` 300, the
  database's top value, no migration): the day has no minutes cap, every new question is spread evenly over the days
  before the final window (561 a day here), a day goes mistakes → new → the second check of what was answered right,
  and the final window has no extra pass. The line under the choice says the count, the new ones a day and the hours a
  day («около 7,5 часа в день»); «Даже при 90 минутах…» now ends with «Чтобы увидеть все, выберите «Все вопросы».»
- **Everywhere the plan is:** the exam's «Настройки» (each member of a group chooses for themselves), the import form,
  «План по дням», the end of a занятие (never «cut by minutes»), and the Telegram bot (the same plan code, synced:
  «Сегодня около 5,5 часа: 276 новых и 267 знакомых»). Times from 3 hours read in hours everywhere.
- **Verified before release:** vitest 4563 (new: the three-day simulation of 1120 questions — all seen by the 15th,
  per subject mistakes → new → second check, the 16th exactly what is not yet counted), tsc -b, the bot's node tests
  343. The release gate runs every check again on this commit.
- **Live check after release:** «Настройки» of a QA exam: the choice, its line, the save; the exam page's card in hours.

## 2026-10-12 — Release 44.12: overstating adverbs go when the lecture never says them (from the commit of this entry)

- **Lecture materials** (`668e54c`, `overstatement.py`). Every fact recheck found the same overstatement: «грозил
  втянуть» retold as «неизбежно втягивал» (44.9) or «неминуемо втягивало» (44.5), «моментально» / «мгновенно
  перерос» (44.10, 44.7), four empires that fell «сразу» (44.5, 44.7); three of them would teach a false fact.
  «неизбежно», «неминуемо», «неотвратимо», «непременно», «мгновенно», «моментально», «немедленно», «тотчас», «сразу
  (же)» now go from every section of the analysis and from the Выжимка and podcast made later, when the lecture never
  uses the word in any form. The word stays after «не»/«ни», in formulas and code, in quiz options, and when the
  lecture text is missing.
- **No model call, no cost.** The cached answers go through it too.
- **Verified before release:** pytest 2041. The release gate runs every check again on this commit.
- **Live check after release:** the three lectures once more: every section arrives, the adverbs the lecture lacks are gone.

## 2026-10-12 — Release 44.11: the second reading of the конспект is off again (from the commit of this entry)

- **The live check of 44.10** (cell, Ohm, WW1 × 3 runs; every change in `checks` read against the lecture): the check
  took 0.7–2.1 s (once 16.6 s) and the whole analysis stayed at 7.5–9.4 s, but its 11 fixes were one useful
  (Germany's «новые территории» → «место под солнцем»), two harmless, three that removed facts the lecture states
  (the mitochondria's own ribosomes, «все организмы состоят из клеток» twice) and two that copied speech-recognition
  errors of the Ohm transcript into the конспект («1 вулт», «обратное сопротивлением»). It missed «моментально
  перерос», «сербского национализма, усиленного…» and a merged cause.
- **Off by default** (`AI_NOTES_CHECK` unset): the конспект is again what the model wrote after the usual checks.
  The code stays; `AI_NOTES_CHECK=on` brings the check back.
- **Verified before release:** pytest 2034. The release gate runs every check again on this commit.
- **Live check after release:** one analysis — no `checks` in the results, the конспект arrives with the other sections.

## 2026-10-12 — Release 44.10: the конспект is read against the lecture once more (from the commit of this entry)

- **The recheck of 44.9** (the history lecture three times): its three narrow rules held 3/3 — years in digits in the
  podcast, 45 wrong quiz options all false, «Тройственный союз» with the 1915 switch. The конспект still made the
  serious ones, three in 221 statements, each in a new form: «3 августа — Франция» (France declares war on Russia),
  «неизбежно втягивал» for «грозил втянуть», the armistice «привело к крушению» four empires.
- **A second reading of the конспект** (`83c8f5a`, `notes_check.py`): one more model call gets the numbered sentences
  of the конспект and the term definitions, then the lecture, and returns the smallest fix for a sentence that says
  something other than the lecture or more than it. A fix is applied only when it stays the same sentence; a checker
  that wants to change more than a third of the конспект changes nothing; busy, timeout or an unreadable answer leave
  the конспект as it was. The results event carries what was changed as `checks` (the page does not read it).
- **Cost:** one call per analysis (and per «Создать заново» of the конспект), cached with the конспект; the конспект
  arrives a few seconds later than before. `AI_NOTES_CHECK=off` turns it off.
- **Verified before release:** pytest 2033. The release gate runs every check again on this commit.
- **Live check after release:** three lectures × three runs; every change in `checks` read against the lecture, the
  checked конспект counted again.

## 2026-10-12 — Release 44.9: three narrow rules from the nine-run recheck of 44.8 (from the commit of this entry)

- **The recheck of 44.8** (three lectures × three runs, all five materials, against their scripts): 2.5 problems per
  100 statements (44.7: 4.0, 44.5: 2.8), one serious in 723; no resistance-from-connection claim, no «распалось
  сразу», no credits, no «неминуемо» in any run; cards and quiz keys clean.
- **Three narrow rules** (`4309bbd`), for what still repeated (all minor):
  - the podcast writes years, dates and numbers in digits (it garbled spelled-out years in 2 of 3 history runs);
  - a wrong quiz option is false in fact, not only absent from the lecture;
  - a term's definition keeps the lecture's exceptions and changes over time with their dates.
- **One-time cost:** the prompts change every cache key again.
- **Verified before release:** pytest 2013. The release gate runs every check again on this commit.
- **Live check after release:** the history lecture three more times: the podcast's years, the quiz's wrong options,
  the term definitions.

## 2026-10-12 — Release 44.8: what the fact recheck of 44.7 found (from the commit of this entry)

- **Lecture materials** (`1e6c087`). The recheck of 44.7 (three lectures, all five materials, against their scripts):
  cards, quiz and Выжимка had no problem in 128 statements (cards 3 → 0), and the old distortions (the vacuole, the
  ATP merge, «миллиардов клеток», «неминуемо») did not come back; the remaining ones sat in the конспект's theses and
  «Выводы» and in the podcast's last lines, the history lecture lost dates and names, and 3 of 5 explanations of the
  recording's test opened with a credit.
  - **The retell rule** no longer says «убирай лишние предложения»: dates, numbers and names are kept by name; time and
    order of events only from the lecture.
  - **«Выводы»** retell the lecture's own conclusions, not «что следует из лекции в целом»; the theses have no
    generalisations beyond the lecture.
  - **The podcast's last line** keeps to the lecture's thoughts, with no new facts, dates or generalisations.
  - **More credit forms go** from the start of a sentence: «В тексте лекции отмечается, что…», «Лекция гласит, что…»,
    «В источнике указано, что…», «Согласно источнику, …».
- **One-time cost:** the prompts change every cache key again.
- **Verified before release:** pytest 2013 (backend only changed since 44.7, whose gate passed Vitest 277/4552, the
  bot 337 and the Docker-layout build). The release gate runs them all again on this commit.
- **Live checks after release:** three lectures × three runs each (text variants, so no cache), audited against the
  scripts as before.

## 2026-10-12 — Release 44.7: long recordings in pieces, materials that keep the lecture's qualifiers (from the commit of this entry)

- **Recordings in pieces** (`b5a7435`, `1258d1a`):
  - **Why:** Whisper skips passages of a long recording, the same ones run after run. Measured on the live
    transcription (Groq whisper-large-v3-turbo, language ru, no prompt):
    - a 2:50 MP3: whole 84–85 % of the script's words, the same 25-word passage lost in 3 runs; in pieces of
      15–30 s cut at pauses 92–93 %, nothing lost;
    - a 19:25 m4a with room noise and long pauses: whole (release 44.6) 86.4 %, four passages lost (91 words); in
      pieces of 15–30 s 91.9 %, nothing lost; 60 s pieces still lost two.
  - **What:** a recording longer than 32 s is cut by ffmpeg (from `imageio-ffmpeg==0.6.0`, a static build) at the
    longest pause in the second half of each 30 s window into mono 16 kHz WAV pieces; they go to Whisper at most 4
    at a time and 20 a minute (Groq's free plan); a long «busy» sends a piece to Gemini instead of waiting. The page
    shows «Распознаём запись: N из M мин». A shorter recording, a missing ffmpeg or a file ffmpeg cannot read go
    whole, as before.
  - **Time budget:** the transcription may take up to 8 min (MEDIA_TRANSCRIBE_TIMEOUT_SECONDS 240 → 480); the page
    waits up to 10.
  - **New variables (all optional):** GROQ_AUDIO_RPM (20), GROQ_AUDIO_CONCURRENCY (4), AUDIO_MAX_PIECES (120),
    FFMPEG_BINARY.
- **Lecture materials keep the lecture's qualifiers** (`097c6bc`), after a fact audit of 942 statements of 11
  material sets (numbers, dates, formulas and all 70 quiz keys right; 8 of 17 problems, and all 3 that would teach
  something false, came from shortening that widened a claim):
  - every material prompt: drop sentences, not qualifiers; never merge two claims into a wider one or make one
    stronger; causes, effects and timing only from the lecture;
  - cards: 1–3 sentences of what the lecture says; «почему» only when the lecture gives the reason;
  - the podcast's hook brings no numbers of its own;
  - «(в лекции ошибочно назван «Вт метром»)» goes like the other source remarks;
  - the /try lecture example: «готовы и могут купить» in the конспект and the Выжимка, as in the lecture.
- **One-time cost:** the prompts change every cache key, so the first request for each material after release is a
  real, charged call.
- **Verified before release:** pytest 2012, bot 337 and its plan copy, Vitest 277 files / 4552 tests, the build in the Docker
  layout. The release gate runs them again on this commit.
- **Live checks after release:**
  - the 19:25 m4a again: recall, lost passages, time, the progress statuses;
  - the cell PDF, the Ohm MP3 and the WW1 DOCX with all five materials, audited against their scripts as before;
  - the /try lecture example shows the new definition.

## 2026-10-12 — Release 44.6: what the live re-check of 44.5 found (from the commit of this entry)

- **Lecture materials** (`53addce`):
  - **Sentence-initial credits.** A sentence that opens with «По лекции, X» or «Из лекции следует, что X» now states the fact alone, as «Согласно лекции, X» already did.
  - **A credit with a phrase about the lecture stays.** In «Согласно лекции, прочитанной профессором, …» the credit is kept. 44.5 removed it and left a sentence that began with the participle. No live material had this form.
  - **«в тексте» → «в лекции» in more verbs.** «в тексте называют / называется / описывается / приводится…» now becomes «в лекции …». A test made again had asked «Какой регион в тексте называют…?».
- **The lecture example** (`0526d55`): the last four credits found by the live check are gone. Card 3 was edited by hand. Podcast line 8 was voiced again. `CHANGES.md` records it all.
- **The podcast on a phone** (`e336e51`): the line now keeps the room of the conversation's tallest line, so the scene and the player no longer move when the line changes.
  - Over 45 s of playback, the layout shift fell from 0.14 to 0 at 390×844 and from 0.18 to 0 at 360×800.
  - Computers are unchanged.
- **Outage monitor** (`b46d8e7`): a step of the bot's minute tick.
  - **What it checks:** `/api/health` and `/try` every 5 minutes, `/api/health/deep` every 30.
  - **Status:** it went live through the migration and function workflows (`23f07a0`, `523c6a4`) and is off until the owner's chat is set. It does not touch the Space.
- **Verified before release:** pytest 1977 (Python 3.12, pinned tree), bot 337 and its plan copy, Vitest 277 files / 4552 tests, the build in the Docker layout. The release gate runs them again on this commit.
- **Live checks after release:**
  - the `/try/lecture` podcast on a 390 px phone: no layout shift between lines;
  - the example has no credits left;
  - a new lecture's materials still have no credits.

## 2026-10-12 — Release 44.5: what the live re-check of 44.3 found, and a lecture example without an account (from the commit of this entry)

- **Lecture materials:**
  - **One more remark form** (`99a14f0`): «вольтметр (в тексте назван вольтметром)» now goes.
    - **Removed:** a bracket that opens with «в тексте», «в записи», «в расшифровке» or «в лекции», continues with назван / упомянут / указан / записан / обозначен, and ends in 1–3 words that echo the word before it.
    - **Kept:** «Сила тока (в лекции обозначена I)» and quotes.
  - **The facts, not «согласно лекции»** (`9c5f7f4`, `4b11561`, `c520eef`). 44.3's prompt rule offered «согласно лекции» as the phrase to use, so the materials credited the lecture in nearly every quiz explanation: 12 and 17 times in two lectures.
    - **Prompt:** the rule now asks for the facts themselves.
    - **Removed:** a credit that opens a sentence («Согласно лекции, X», «В лекции указано / отмечено / говорится / объясняется, что X», «Как указано в лекции, X», «Лекция говорит, что X» → «X»), and «согласно лекции» before a question mark.
    - **Kept:** «по лекции?» («Есть вопросы по лекции?») and credits inside a sentence.
- **Lecture page:**
  - **The ring after «Создать … заново»** (`9c0b045`, `7a716d7`): the ring re-reads the limit as soon as the server answers, on the lecture page and on the analysis screen, even if saving then fails.
  - **«Создать выжимку» on a phone** (`78aa330`): the button sat under the sticky «Повторить карточки» bar, so a tap waited for it; the re-check counted 11 s, while the server answered in about 1 s. While the Выжимка tab offers the button, the bar steps aside, as it does on «Подкаст».
  - **A Выжимка later** (`42018f2`): the author's lecture always has the «Выжимка» tab. Without a Выжимка, the tab says «Выжимка ещё не создана» and offers «Создать выжимку».
  - **The placeholder while a lecture loads** (`56b4d85`): on a phone it keeps the tab rows. When this device's «Лекции» list already has the lecture, it also keeps the exact tabs and the «Текст распознан…» line. Locally the first card's jump went from 46, 104 and 34 px to 0.
- **A lecture example without an account** (`cdf8709`, `7ddfaf8`, `b3ebc55`): `/try/lecture` shows what Meldy made of the example exam's lecture «Спрос и предложение».
  - **What it shows:** one real analysis from 12.10 on the result screen itself: the конспект, 6 cards, a 5-question test, the Выжимка, and a 16-line podcast whose voice plays from files beside the page.
  - **No server calls:** no model, no `/api/tts`, no Supabase; only the telemetry of opening the page.
  - **Ways in:** «Лекции примера» on `/try`, and a line under the landing's final buttons.
  - **Edits:** the frozen analysis went through 44.5's clean-up (23 strings), and three questions were edited by hand. Six podcast lines were voiced again, all listed in `frontend/src/data/exampleLecture/CHANGES.md`.
- **Verified before release:** pytest 1977 (Python 3.12, pinned tree), bot 319 and its plan copy, Vitest 277 files / 4549 tests, the build in the Docker layout. The release gate runs them again on this commit.
- **One-time cost:** the new prompt rule changes every cache key, so the first request for each material after release is a real, charged call.
- **Live checks after release:**
  - `/try/lecture` on a phone and a laptop: five tabs; the podcast plays from its files; no calls to `/api/tts` or a model;
  - a new lecture's materials have no credit at the start of a sentence;
  - «Создать тест заново» moves the ring at once;
  - a lecture without a Выжимка has the tab with «Создать выжимку».

## 2026-10-12 — Release 44.4: the voices are back (from the commit of this entry)

- **What broke.** From about 02:51 UTC every new line from `/api/tts` answered 502. The podcast and the lecture conversation had no voice for new lines: lines saved earlier still played, and the podcast kept the line on screen with «Звук не загрузился». The examiner on a ticket switched to the browser's own voice. `/api/health/deep` reported `tts` `network`. Microsoft is moving Edge's read-aloud voices to a new host region by region (edge-tts issue #490, since 2026-10-10). Where the move has happened, the old host refuses the stream with 403, and edge-tts 7.2.8 knows only the old host.
- **The fix** (`1101dfb`, `backend/edge_voice.py`):
  - a stream goes to `api.msedgeservices.com` first, with the same client token;
  - a host that refuses or cannot be reached hands this stream and the following ones to the other host, so either host can go away without a release;
  - an error in the middle of a stream keeps the host, and the usual three attempts handle it.
- **Checked from the container against the real service:** the old host refused with 403, and both Russian voices came from the new host in 1.4–1.8 s.
- **Verified before release:** pytest 1971, including 15 new tests for the host choice. The release gate runs every check again on this commit.
- **Live checks after release:**
  - `/api/health/deep` shows `tts` ok;
  - a new podcast line and the examiner's question play.

## 2026-10-12 — Release 44.3: what the live re-check of 44.2 found (from the commit of this entry)

- **Remarks about the source in the forms 44.2 missed** (`34b1504`, `f44ad89`):
  - **Bracket remarks.** «вольтметром (в тексте — вольтметром)» and «1 вольт (в тексте — 1 Вт)» now go. A bracket with a dash or a colon is removed only when its 1–3 words echo the word just before it. Quotes like «(в тексте — «буря мглою небо кроет»)» and expansions like «НДС (в расшифровке — налог на добавленную стоимость)» stay.
  - **«текст» → «лекция».** Fixed phrases that stand on their own are rewritten with case and capitals kept: «согласно тексту?» → «согласно лекции?», «в тексте указано…» → «в лекции указано…». They stay when a genitive or an agreeing word follows: «согласно тексту закона», «в тексте романа», «согласно тексту, приведённому выше».
  - **Prompts.** Every lecture prompt now calls the source «лекция».
- **Materials made after the analysis know a recording** (`34b1504`): a section made again, the Выжимка, the podcast and its pictures now send the lecture's `summary_json.recognized`, and a recording's prompts get the recording rule there too.
- **A cached answer costs nothing on every lecture route** (`d931aa7`): 44.2 covered the analysis routes; now also `/api/analyze/section`, quick-prep, podcast generate and visuals. Units go back before the response is sent when no real model call was made.
- **Screens:**
  - **Laptop status line** (`30a51e7`): at 1532×734 the podcast player's status line, cut 14 px by the window's bottom edge, now brings the page up by exactly that much, as on a phone.
  - **Lecture page while it loads** (`9fc6198`): the placeholder now stands in the lecture's own boxes. A fresh `/library/:id` load scored a layout shift of 0.447 at 1532×734 and 0.142 at 390×844; locally it now scores 0.0004 and 0.
- **Verified before release:** pytest 1956 (Python 3.12, pinned tree), bot 319 and its plan copy, Vitest 275 files / 4518 tests, the build in the Docker layout. The release gate runs them again on this commit.
- **One-time cost:** the new prompt rule changes every cache key, so the first request for each material after release is a real, charged call.
- **Live checks after release:**
  - a recorded lecture's конспект and test without «(в тексте — …)» and «согласно тексту»;
  - a repeated Выжимка or «Создать заново» with the meter unchanged;
  - the laptop's «Повторить» in view;
  - a fresh lecture page below 0.1.

## 2026-10-12 — Release 44.2: what the live re-check of 44.1 found, on a pinned server (from the commit of this entry)

- **Lecture materials** (`5c21a9a`):
  - **Other scripts.** Letters of other scripts inside Russian text, such as podcast line 15 «Чем植物 клетки…», are caught like a broken Latin word: the material is asked again once, then the sentences that still have them go. This covers all five materials, quick-prep and the podcast routes, answers from the server's cache included. Greek letters, formulas, code and any script the lecture itself uses are left alone.
  - **Recordings.** A recorded lecture's prompts now say its text is speech recognition: write names and terms correctly when sure, and never mention the text or the recording. A bracket remark like «(в тексте упомянут как Вт метр)» is removed.
  - **Mnemonics.** The Выжимка gives a mnemonic only when it really helps.
- **A repeated analysis served from the cache costs nothing** (`d4729e5`):
  - The re-check saw 4.2 s and −20 units for a cached re-analysis. When no real model or transcription call was made, the units now go back before the results are sent.
  - A recording is transcribed again each time, so it is still charged.
  - A scan keeps the units of its page recognition.
- **Phone screens** (`a9c921b`):
  - At the top of the page, the podcast player's status line and «Повторить» now stand above the bottom bar: 686–776 against the bar at 782 on a 390×844 phone, where they were at 770–860.
  - The lecture page's tabs wrap into two rows instead of scrolling sideways, so «Подкаст» is no longer cut off.
- **Also in this release:**
  - **Pinned server** (`2759062`): `requirements.txt` with `==`, `backend/constraints.txt` with the whole tree 44.1 was built with, and both base images by digest.
  - **No browser push row in «Профиль»** (`3cfa6af`): its subscriptions lived in a file every release erased.
- **Verified before release:** pytest 1940 (Python 3.12, pinned tree), bot 319 and its plan copy, Vitest 275 files / 4509 tests, the build in the Docker layout. The release gate runs them again on this commit.
- **Live checks after release:**
  - a cached re-analysis on account B with the meter unchanged;
  - the phone screens;
  - a recorded lecture's конспект without remarks about the source.

## 2026-10-11 — Release 44.1: what the live re-check of 44 found (from the commit of this entry)

- **Recordings back to the measured-best setup** (`edf8859`): release 44's Whisper large-v3 with a topic prompt from the file name scored 32–76 % of the source words on the QA MP3 (84.6 % before 44), invented sentences and once ended with «Лекция физика закон Ома… Субтитры создавал DimaTorzok». Now `whisper-large-v3-turbo` first, no prompt, Russian kept; known Russian Whisper credit lines and end loops are cleaned; an empty result goes on to Gemini.
- **The конспект retells, not copies:** 44's «keep the sections» made the medium конспект repeat the lecture word for word and drop «Ключевые тезисы»/«Выводы»; the prompts now keep the sections in order but retell each about three times shorter, with the two blocks back.
- **Podcast voice on the result screen** (`b362369`): the first ▶ waited for a fresh edge-tts synthesis that started only when the player came into view, and line 2 raced line 1's retry; now the first two lines are prepared as the result appears, the queue waits for the line being played, the 502 carries `Retry-After: 1`, each attempt is logged, and the status says the voice server failed instead of «Медленный интернет».
- **Screens:** the result tabs wrap on phones (all five visible at 390 px), the Выжимка card at full width, the «Текст распознан…» note on the lecture page too (`summary_json.recognized`), «Ссылку на видео не открыть» on the disabled start, formulas drawn in fragments (KaTeX).
- **Verified before release:** pytest 1922, bot 319 and its plan copy, Vitest 275 files / 4506 tests, the build in the Docker layout; the release gate runs them again on this commit. Live, after release: the same MP3 twice against the 84.6 % baseline, the biology PDF's конспект, the first ▶ on the result screen, the phone tabs.

## 2026-10-11 — Release 44: lectures, as a live run found them (from the commit of this entry)

- **Why:** the owner calls the lecture toolkit more important than the exam; a live run on account B (11.10, seven ways in, `scratchpad/lecture-qa/`) found every way in working (4–21 s) but four serious faults and a dozen small ones.
- **Server** (`35f09fb`): a link to a video (YouTube, RuTube, VK video, Dzen video, Vimeo, TikTok…) is refused before any charge with «Ссылку на видео Meldy пока не открывает…» (it used to be scraped as a page and cost 20 units); recordings go to Whisper large-v3 with Russian set and a topic prompt, video too, with a «Текст распознан из записи — сверьте термины, числа и имена» note; a Latin look-alike inside a Russian word is fixed and a real Latin chunk makes the section write again once; the prompts take formulas, dates, numbers and names only from the lecture (the Выжимка no longer invents «формулы для симулятора»), and the конспект keeps the lecture's sections; page links come as clean text (no markdown, addresses or reference lists); a new PDF reader keeps words and sections whole; less than 200 letters makes nothing and charges nothing; .doc and voice/video formats get clear advice.
- **Screens** (`f069424`): the video-link message shows as the link is typed, the start stays off and one tap opens «Аудио и видео»; .doc and recording formats are refused when chosen; the «too big» refusal is in view; the result screen gets the «Выжимка» tab (one name everywhere, it was «Кратко» on the lecture page); no «[S01]» in terms, the map, the podcast or exports; on a phone the podcast line sits above the player; ▶ in the first screen; the newest lecture on top of «Лекции»; small words name only the materials that exist; a deleted lecture's address shows «Лекция не найдена» without console errors.
- **First run stopped by the new release gate** (run 38166494591, nothing was pushed to the Space): ten ticket tests timed out on the CI runner. A race in the tests: the ticket warms the examiner's «Так…» as it opens, and on the slower runner it was ready before «Готово», so the examiner waited up to 2.5 s for the filler while the test waited 1 s for «Не знаю». Reproduced locally with a 0.6 s pause before «Готово»; those two groups now keep the filler out (`ExamTicket.test.tsx`), no product change.
- **Verified before release:** pytest 1891 (58 new), bot 319 and its plan copy, Vitest 273 files / 4476 tests (61 new), the build in the Docker layout; and the new release gate runs all of them again on this commit before anything is pushed. Live, after release: the QA cases on account B (YouTube refused at no cost, the biology PDF's sections and Выжимка, «[S01]» gone, the recording note).

## 2026-10-11 — Release 43.6: «Разобрать лекцию» — the start no longer stands out of step 3 (from the commit of this entry)

- **Owner's bug:** on a wide screen (two columns, step 3 in the 340 px right column) the quiet start pill of the link tab, «Введите ссылку на страницу», was 290 px wide and stood 22 px out of its card (live at 1100–1532 px, both themes). The link tab now asks «Вставьте ссылку» (like the text tab's «Вставьте текст»), and a quiet pill wraps a long reason inside its card instead of pushing past it (`min-width: 0`, wrapping text in the disabled state).
- **Verified before release:** Vitest 268 files / 4415 tests (new: the link tab's short label), `tsc -b`, the build in the Docker layout. Live, after release: the pill measured inside the card at 1532, 1180 and 1100 px.

## 2026-10-11 — Release 43.5: the end of a session speaks once (from the commit of this entry)

- **The headline holds too:** the live re-check saw «Теперь 5 из 960 — верно в два разных дня» turn into «Теперь 6 из 960» half a second after it appeared (the last answer's server result came after the end screen opened). The headline and the paragraph under it now wait until every answer of the session has come back (at most 1.5 s, in their place, invisible), then appear once with the server's figure and never change; the headline takes focus when it is shown (unless the student has moved focus meanwhile). After 1.5 s without the results, what is known locally, as before. The self-check's end screen has no such race and shows at once.
- **Cheat sheet:** the scroll's fallback timer is cleared when the scroll ends and touches no window that is gone (it could throw after a test had finished).
- **Verified before release:** Vitest 268 files / 4414 tests (new: a result inside the hold is shown, a late one changes nothing, focus on the shown headline), `tsc -b`, the build in the Docker layout, the bot's plan copy unchanged.

## 2026-10-11 — Release 43.4: the example exam for the jury — fair examiner, the strike in view, a lighter first screen (from the commit of this entry)

From a live walk of `/try` as a juror would take it (QR on the slides; phones, laptop, both themes, Slow 4G):
- **The examiner judges by what was asked.** A short right reply («Совершенно неэластичный и совершенно эластичный спрос.» to «Какие крайние случаи ценовой эластичности спроса бывают?») was judged «не назван»: for `/try` the model saw neither the examiner's question nor the expected answer. The example's server copy now carries each point's follow-up question and expected answer, and the follow-up prompt (real tickets too) says: judge by the question; the expected answer is a sample; don't demand details the question doesn't ask for — half an answer, vague words, the question repeated back and mix-ups still don't count.
- **The strike-out in view on phones:** «К шпаргалке» now lands question 5 in the band between the bars from the first frame (390×844: struck lines at 225–294 px; before: off-screen at y≈1900–2290), the count steps with each strike (46 → 45 → 44), and a chip over the bottom bar shows it on phones; no flash of the old scroll.
- **One story in the protocol** after a reply to the examiner: «Пункт N назван только после вопроса экзаменатора», «…один назван после вопроса экзаменатора», the first check's comment marked «В ответе: …» (counting rules unchanged).
- **The examiner's question above the bottom bar** on phones (360×800: question and field now in view; real tickets too).
- **One number for «есть в лекциях»:** «11 вопросов примера: 9 есть в лекциях, 2 — частично».
- **A lighter first screen:** the example no longer pulls the Supabase client, the draw and the answer room are separate files prefetched after the sheet, background work waits for the sheet on `/try` — Slow 4G (400 kbit/s, 400 ms RTT, local build): the first button at 7.9 s instead of 11.5 s, 210 KB of JS before it instead of 364 KB.
- **Polish:** «Вставить ответ примера» is a visible secondary button (voice stays the main action); the inserted answer is labelled «Ответ примера»; `/register` says «Почта» (placeholder `student@example.com`) and offers «Вернуться к примеру» to a visitor from `/try`.
- **Verified before release:** Vitest 268 files / 4412 tests, pytest 1832, the bot's 319 tests and its plan copy (re-synced: `cheatSheet.ts`), `tsc -b`, the build in the Docker layout. Not verified before release: the new examiner prompt against the live model — checked right after.

## 2026-10-11 — Release 43.3: a gone exam reads calmly, the invite window holds still, the sheet's highlighter at night (from the commit of this entry)

- **An exam that is not the user's any more** (deleted, left, removed): its page's two reads now accept the database's calm «not found» (null, HTTP 200) as well as the old P0002 (HTTP 500), and a malformed address is «gone» without a request. The database side is migration `20261011100000_containers_not_found_null.sql`, applied right after this release (the site reads both answers, so the order is safe this way round).
- **«Пригласить группу»:** pressing «Создать ссылку» shows the link's place at once («Создаём ссылку…»), and the window keeps its height while the server answers, so nothing jumps (layout shift over the whole flow: phone 0.97 → 0, laptop 0.22 → 0.01); «Скопировать» / «Скопировано» share one width.
- **Cheat sheet, dark theme:** the highlighter under the last answer's question is an opaque deep yellow (#906509) instead of a translucent yellow that read olive on the dark card; light theme unchanged.
- **Verified before release:** Vitest 265 files / 4378 tests (new: not-found reads, invite layout, sheet colours), `tsc -b`, the build in the Docker layout, the bot's 319 tests and its plan copy (`sync_bot_plan --check`). The bot's press wording (the day a mistake comes back) ships with the `telegram` function deploy that follows.

## 2026-10-11 — Release 43.2: the end of a session promises the first count as the exam page does (from the commit of this entry)

- **While the figure is 0:** the end screen's «Первые войдут в счёт …» is now the exam page's own figure line, from the plan read after the session — a confirmation of the plan can count later today («сегодня после 14:35»), where the screen used to promise «завтра» from the session's own answers. Held in place and frozen with «Сегодня осталось …» (at most 1.5 s); the old wording only when that reading does not come. The first-session reminder under it is held with it, so nothing seen moves.
- **Verified before release:** Vitest 264 files / 4371 tests (three new: the wording against the page on the old and new code, held and frozen, the late fallback), `tsc -b`, the build in the Docker layout. Not verified before release: the live backend — checked right after.

## 2026-10-11 — Release 43.1: the end of a session says what the exam page says; a day off stays on «Сегодня» (from the commit of this entry)

- **End of a session (live check, day 2: D2 and N1):** «Сегодня осталось N вопросов, около M минут» is now the exam page's own count. The plan is read again once the session's answers have left the device, and the end screen takes its numbers from that reading (the same `planDay` on the same `plan_inputs`), so questions that count later today («Ещё 4 вопроса — после 14:35») are counted as on the page. Live, the screen had said 75 and the page then 79. The line and the pill appear once — held in place, invisible, for at most 1.5 s — and never change under the finger; without that reading (offline, slow network) they come from the plan as the session ended, less its answers, never fewer than the page will show.
- **Nothing ready now, more later today:** the end screen says the plan's own «Ещё 4 вопроса — после 14:35.» instead of the line from before the session.
- **The pill names what it opens (D3):** «Ещё 13 вопросов» opened 18; every variant now counts the very session its link builds.
- **«Сегодня» (D1):** an exam on its day off, or with nothing to do today, is a quiet row («… · сегодня выходной») beside the exam that leads, instead of leaving the page.
- **Verified before release:** Vitest 264 files / 4368 tests (new tests replay the live day: 86/60 → 79/55 → 73/55 → 68/50, «Ещё 20 вопросов» opens «1 из 20»), `tsc -b`, the build in the Docker layout, the bot's plan copy unchanged (`scripts/sync_bot_plan.mjs --check`). Not verified before release: the live backend — checked right after.

## 2026-10-11 — Release 43: Meldy inside Telegram — «Открыть Meldy» opens today's session, signed in through Telegram (from the commit of this entry)

- **The Mini App (`/tg`):** the bot's menu button «Открыть Meldy», and «Открыть занятие» under the day's card and under the record after a batch, open Meldy inside Telegram. A student whose Telegram is linked is signed in through Telegram (the bot's function checks the launch data's signature with the bot's token and mints a one-time sign-in) and lands on «Сегодня», or straight on the exam's session of today when the button names the exam. Inside Telegram the page takes Telegram's colours and safe areas, and links to other sites open outside.
- **Not linked yet:** a calm screen with the student's Telegram name and one button, «Открыть профиль в браузере»: the Telegram is connected only from the profile («Подключить Telegram» → the bot's /start), never from inside the Mini App.
- **Security (two independent reviews before release):** Telegram mode runs only inside a Telegram client (its bridge: the native proxy, Windows' notify or Telegram Web's frame). A link to /tg with Telegram's data opened in an ordinary browser is just the site: no Telegram sign-in, no Telegram mode. The launch data is used once and is at most an hour old; another Meldy account already open in Telegram is never switched silently («В Meldy уже открыт другой аккаунт»).
- **Headers:** the page's CSP allows exactly `telegram.org/js/telegram-web-app.js` and lets only `web.telegram.org` frame the site (`frame-ancestors`); `X-Frame-Options` is dropped in favour of it.
- **The Telegram tip's clip** shows the bot's new menu button «Открыть Meldy».
- Database and bot, already done before this entry: migration `20261010150000_telegram_webapp.sql` (`bot.webapp_uses`, `bot_webapp_session`, service role only). The `telegram` function and `/setup` (the menu button) follow this release.
- Verified before release: Vitest 262 files, 4357 tests — one tip test expected the old «Меню» button and was updated (tips 37/37); the bot's function tests 318/318; the `/sb/` proxy tests 10/10; `tsc -b` and `vite build` in the Docker layout; the Mini App's screens at 390×844 light and dark in a harness with the real CSP (no CSP violations, no sideways scroll); the security review's crafted-link checks with Telegram's own script.

## 2026-10-11 — Release 42.1: the sheet's switches one tap away on a phone (from the commit of this entry)

- **Phone, the exam page's sheet:** a «⋯» at the right of the count opens the app's own menu with «Скрыть строки, стёртые совсем» (only once something is erased), «Спрятать строки» («и проверить, что помните их»), «Показать последний ответ» and «История шпаргалки» (or «Закрыть историю шпаргалки»). A switch keeps the menu open so its new state is visible; the links close it and give focus back to «⋯». The header is no taller and the list starts where it did; nothing is repeated under the card any more. With «Спрятать строки» on, what a tap on a hidden line does is said under the map. Desktop, tablets and /try are unchanged. The shared menu gained switch items and a second line under an item, read as its description.
- **Words:** on a phone the status card under «Шпаргалка написана не полностью» said «Допишите его» (its question was cut off with the first sentence); it now names what to write: «Допишите 4 вопроса. Это стоит 4 единицы ИИ.»
- **Tests:** the answer screen's prefetch wait gets 5 s, so a full parallel run no longer times it out.
- Verified before release: Vitest 257 files, 4264 tests passed in one full run; `tsc -b` and `vite build` in the Docker layout; the menu at 390×844 light and dark and 360×780 (mocked exam page): no page errors, no sideways scroll, focus back on «⋯» after Escape. No backend, database or bot function change.

## 2026-10-11 — Release 42: the cheat sheet in Meldy's own look, the landing and its reel tell the exam as it is now (from the commit of this entry)

- **The cheat sheet without paper** (owner: «лист бумаги не вписывается в приложение… выглядит иишным», decision `2026-10-10_cheat-sheet-native-look`): on the exam page, /try and the history the sheet is a white card in Onest — questions as headings with a faint number, a main point with an ink dot, a detail with a dash, a line named once with the yellow dot and muted words, an erased line faint and struck through — and a map of the whole sheet's lines next to the count (`SheetMap`). Erasing draws a strike left to right while the words fade; the map changes in step. Mechanics, data and words are unchanged; a line named once is readable now (the self-test hides it). On a phone the switches, «Последний ответ» and «История» sit under the card for now.
- **Landing:** the paper-sheet section becomes «Сотни вопросов — один план»: the example exam's page (today's plan, «143 из 960 — верно в два разных дня», the subjects) and the sheet in the new look, where one answer plays when the section comes into view. The steps, the group block and «Подход» tell the same story; each step opens its chapter of the reel.
- **The reel «Meldy за 48 секунд»:** files of questions with the key from the file → the plan by days to the exam → a «занятие» with a right and a wrong answer → the oral answer that strikes the sheet's lines on two different days while its map empties → one link for the group and the plan in Telegram. No stamp, no confetti, no paper.
- **Sign-in and sign-up reels** tell the exam as it is now; the **PRO reel** shows the protocol's verdict («Сами назвали N из 4 главных пунктов») instead of the «Проверено» stamp; **review cards** type «завтра» / «через N дней» instead of writing it in pencil; the **link preview** is re-rendered without squared paper and handwriting.
- **One face:** «Тренажёр экзамена по вопросам кафедры» replaces the oral-only «Тренажёр устного экзамена по билетам кафедры» on the landing, in the page title, the link preview, the manifest, the sign-in reels and the READMEs.
- **Removed:** the old reel's paper sheet, the pencil ink, `SheetText`, `sheetFont` and the «Meldy Hand» (Caveat) font.
- **Small:** the guide's «Экзамены» text is five lines, so «Назад / Дальше» stay inside the card on a 1532×734 laptop; the PRO window's dash keeps to the number before it on a phone.
- Verified before release: Vitest 257 files, 4263 tests — 4262 passed in the full run; one timing test of the answer screen (`ExamTicket` «…listens to the follow-up only after its audio») failed while another suite ran in parallel and passes alone (95/95), the code it tests is unchanged; `tsc -b` and `vite build` in the Docker layout; a local build signed out at 1532×734 and 390×844 (landing, the reel, /try, sign-in): no sideways scroll, no console errors. No backend, database or bot function change.

## 2026-10-10 — Release 41: training clips for the exam and the Telegram bot; invitations without the cheat sheet (from the commit of this entry)

- **Guide «Экзамены»:** the chapter's clip showed an oral ticket with a «Проверено» stamp. It now shows the exam as a new student meets it: «Новый экзамен», a file of questions dropped, the questions and the key found, the date and the minutes, the exam's page with today's plan and «План по дням», «Начать», a question answered and the screen's own «Верно.». The clip uses the screens' own words; there is no stamp, no particles and no grade.
- **A tip about the Telegram bot on the exam page:** «План на день в Telegram» appears once under the plan card. It shows after the student has a plan and has answered in it, and only when the bot exists, the account is not linked, the guide is behind and the page is not /try. «Подключить Telegram» opens the link window in place; «Не сейчас» puts the tip away for good. Its clip is the bot's chat drawn as Telegram for Android draws it: yesterday's «Готово», the day's card at 20:00, «Начать», an option pressed, the bot's «Верно.», the next question. The chat uses Telegram's day or night colours to match the site's theme, and the play button sits in the header's corner (no «⋮» under it).
- **Invitations and the reminder, per the owner («везде упоминания вот такие убрать»):** the group message, «Пригласить группу» and /join say what each classmate gets: their own copy with the questions and the lecture text, and answers that stay private. The daily calendar reminder explains the two-different-days rule without the cheat sheet.
- Verified before release: clip frames in a harness on the app's own modules (`scratchpad/clips/`); Vitest 255 files, 4219 tests; `tsc -b` and `vite build` in the Docker layout. No backend, database or bot function change.

## 2026-10-10 — Release 40: the theme in one press — a sun right of the avatar (from the commit of this entry)

- **The owner's request:** the «Тема: Светлая / Тёмная / Системная» row in the account menu was not found there. The top line now has a button right of the account button, on every width (phone, tablet, computer): the sun on the light page, the moon on the dark one, turning into each other; its name and tooltip say what a press does («Включить тёмную тему» / «Включить светлую тему»). The page fades into the new colours where the browser can (not with reduced motion). The choice is kept on the device as before (`studyforge-theme`); until the first press the page follows the device, now also when the device switches with the page open.
- **Around it:** the account menu opens under the avatar (on a 320 px phone it moves just enough to stay on the screen) and no longer has the theme row; the «Сегодня» tab on a phone is a calendar, so the sun on the screen means only the theme.
- Verified before release: a local build with the test account's real data at 320, 360, 390, 768, 1024 and 1532 — the line fits with no sideways scroll, the sun's press area is 2 px clear of the avatar's and its glyph sits on the page's right edge, both directions switch and survive a reload, the menu sits under the avatar (`scratchpad/theme/`); Vitest 253 files, 4179 tests; `tsc -b` and `vite build` in the Docker layout. No backend or database change.

## 2026-10-10 — Release 39.1: long choices in a select stay inside the screen (from the commit of this entry)

- **Found by the live check of release 39:** «Куда добавить» tells two oral exams of one name apart after the name («К «Базы данных» · 21 октября · 20 вопросов · создан 7 октября в 19:33»), but the list cut that part off, and once one was chosen the import page grew to 608 px on a 390 px phone and the fixed «Сохранить» left the screen.
- **Fix (`components/ui/paperSelect.css`):** a select never widens its field (the value ends in «…» inside it); long options wrap onto a second line instead of losing their end. Every select of the app gets it; short ones look as before.
- Live check of release 39 otherwise: 15 of 16 fixes pass on 390 and 1532 (`scratchpad/container/usability/qa3/`).
- Verified before release: the layout in a harness with the app's own rules (the pill 614 → 358 px at 390, no sideways scroll, both long options whole); Vitest of the select, import and settings screens 85/85; `tsc -b` and `vite build` in the Docker layout.

## 2026-10-10 — Release 39: the second live check of the exam container — a group's links and members, an exam that is gone, an oral part inside an exam, one size on every screen (from the commit of this entry)

- **Group links (M2):** one link is open at a time. «Создать новую ссылку» says first that the new link replaces the open one and closes it before making the new one; «Закрыть ссылку» closes every open link of the exam; after closing, the window says «Ссылка закрыта. По ней больше никто не войдёт.» and offers «Создать ссылку». A full link says «Мест по этой ссылке больше нет: заняты все 60.» with the way to a new one. A Telegram chat bound to a closed link stops its «Вопрос дня» until the author connects it again (its card in the window says so).
- **Members (M1, m3, m8):** «Кто вошёл» stays while anyone ever joined, so a removed student can be returned even when nobody is left; one line says who is in («В экзамене N участников», «Сейчас в экзамене никого», «Пока никто не вошёл» only before anyone came); a delete refused because members are in turns the confirm into the members' one.
- **Leaving and a gone exam (m1, m2, m10):** «Выйти из экзамена» in a member's «⋯»; an exam that is no longer the student's (deleted, left, removed) says so with the way to «Экзамены» and no «Повторить» (exam page, «Настройки», «Ключи»); a deleted exam's link says «Ссылка не работает: экзамен удалили или она пришла не целиком.»
- **Focus (m9):** every inline confirm (leave, delete, remove a subject, a member's «Убрать», «Закрыть ссылку») focuses «Отмена» when it opens and gives the focus back when it closes (a rename focuses its name field); refusals are announced.
- **An oral part inside an exam (m4–m7):** same-named oral exams are told apart in «Куда добавить» by date, size and, if needed, the day they were made; the new exam takes the oral exam's name; «Добавить предмет» offers the student's oral exams that are in no exam yet; a new exam no longer says «2 дня без занятий» because of the oral exam's earlier answers; the oral row says «устный ·»; «План по дням» marks the days «с устными» and gives today the card's minutes; the exam's size is one number on every screen, and the minutes line says «в плане» when it counts fewer.
- **Small:** «⋯» near the bottom of the screen opens upwards; a renamed subject keeps its new name on screen while the exam is read again; «пропадут» in both subject-removal confirms.
- **The Telegram bot** runs the same plan (no false skipped days); its function goes out with this release.
- Verified before release: Vitest 252 files, 4166 tests; `tsc -b` and `vite build` in the Docker layout; the bot's function tests 294/294 with strict `tsc`; the bot's plan copy in sync. No backend or database change.

## 2026-10-10 — Release 38: what comes back after a day off, the minutes line follows the days, small touch fixes (from the commit of this entry)

- **The next study day, not «завтра»** (the study days of release 37): a wrong answer, «Не знаю», a misclick, the end of a «занятие» and of «Как на экзамене» say when the question comes back as the plan brings it back — «Вернётся в понедельник.» when tomorrow is a day off. With every day on (127) every text reads exactly as before. The Telegram bot's record of a session says the same; its verdict on a press still says «завтра» (a press reads no exam settings).
- **«Настройки»:** the line under «Время в день» follows the Пн–Вс row before «Сохранить» (it read the saved days).
- **Touch:** a day just turned off no longer keeps the hover's dark ink on a phone; «У предметов разные даты» is 44 px to tap at its old height.
- **«Сегодня»:** a row of an exam on its day off with nothing answered says «сегодня выходной» (today's layout lists no such row yet; it is ready for when it does).
- **The bot's «Вопрос дня»:** options are judged as code exactly as in a session (a multi-line option line by line); the function goes out with this release.
- Verified before release: Vitest 247 files, 4103 tests; `tsc -b` and `vite build` in the Docker layout; the bot's function tests 294/294 with strict `tsc`; the bot's plan copy in sync. No backend or database change.

## 2026-10-10 — Release 37: the exam container after the live usability check — the day's plan only shrinks, study days of the week, selects that open in sheets, code that reads as code (from the commit of this entry)

- **The day is frozen** (finding M1; migration `20261010130000_containers_frozen_pace.sql`, live since 13:39 UTC): the plan of a day is the plan of its first answer, rebuilt from `plan_inputs.day_start` and `pace_day`; «осталось N, около M минут» only goes down, spare minutes go to «Ещё 20 новых». Items answered before the migration keep the old fill for today; the frozen day starts tomorrow for them.
- **Study days of the week** (m6): «Настройки» has a Пн–Вс row; the plan counts only study days to the date (daily share, final window, minutes needed, missed days, «План по дням»). A day off has no plan: «Сегодня выходной. Следующие вопросы — в понедельник.», «Ещё 20 новых» stays. Every day (127) plans exactly as before (10 670 comparisons, 0 differences).
- **Selects in sheets** (M2): the list opens in a portal fixed to the window and flips up when there is no room; «Как на экзамене» can now pick 60/80 questions and 45/60 minutes and «без времени» on a phone (8/8 and 11/11 reachable).
- **Code** (m1, m8): the import also flags code from the question's own monospace and from SQL/shell lines; the screen shows later lines that clearly read as code as code even without the flag; wrapped code lines hang under their own indent.
- **Words of a session** (m2, m3, n2, n4): a wrong answer names the key by its text in the file; the blue button names the subject when two or more subjects have work (exam page and «Сегодня»); one rounding of times («после 9:55» everywhere); the key links by role; the end screen keeps what it said when it opened; one plan note on a phone.
- **Targets and offline** (m4, m5): every quiet link of the container screens is 44 px tall without growing its block; offline «Сегодня» and «Экзамены» draw the exam from the device's copy at once (0.3–0.45 s instead of 7.5 s), and an expired session offline no longer waits 52 s.
- **«Прогресс»** (m7): each exam with its figure and a way to its page; the week, the days, the streak and the bars count the exam's answers too (a day counts once); no layout shift (CLS 0.01 on a phone).
- **The Telegram bot**, deployed with this release: the same plan (frozen day, study days; no reminder on a day when every exam is off), a question's code split by the site's own module, code blocks as plain `<pre>`.
- Verified before release: Vitest 247 files, 4098 tests; pytest 1815 passed; `tsc -b` and `vite build` in the Docker layout; the container's SQL rehearsal ALL CONTAINER CHECKS GREEN (with the frozen day); the bot's SQL runner 77 ok and its function tests 290/290 with strict `tsc`.

## 2026-10-10 — Release 36: the site's side of the Telegram bot @Meldyteach_bot — connect it in «Профиль», reminders after a session, «Вопрос дня» for a group, a file sent to the bot (from the commit of this entry)

- **The bot itself is already live** in Supabase, not in this Space: the Edge Function `telegram` (region `eu-central-1`), the schema `bot` (migrations `20261010120000…120005`, contract checks green), the minute tick (pg_cron → pg_net), `/setup` done (webhook, name, commands, avatar). This release adds the site's parts.
- **«Профиль» → «Уведомления» → «Подключить Telegram»** (`components/telegram/TelegramCard.tsx`): a one-time link to the bot (a QR on a computer, a button on a phone), the state read every 3 s until the bot confirms, then the reminder time, the pause and «Отключить».
- **«Напоминать в Telegram»** at the end of a session of the exam container; without a linked Telegram it stays the daily reminder as before.
- **«Вопрос дня в Telegram»** in «Пригласить группу» (`GroupBotInvite.tsx`): the author connects a group chat and picks the hour (9, 12, 15 or 18).
- **A file sent to the bot** opens on the import page (`/exams/import?tg=<ticket>`, single use); the `/sb` route passes `GET functions/v1/telegram/file` for students who reach Supabase only through the site.
- **The Space:** `POST /api/bot/voice` (`backend/bot_bridge.py`) for the bot's voice stage. The stage is OFF (`bot.config.flags.voice` false, its migration is not applied yet): without a valid single-use ticket every request is refused.
- Verified before release: Vitest 240 files, 3935 tests; pytest 1763 passed; `tsc -b` and `vite build` in the Docker layout (`frontend` + `contracts` from `git archive`); the bot's function tests 280/280 and strict `tsc`; the bot's SQL rehearsal on PostgreSQL 16 (57 ok).

## 2026-10-10 — Release 35, second push: the Space build failed on the first one; also «Обновить из файла» and the minutes line (from the commit of this entry)

- **Why the first push failed:** the Space stopped at `BUILD_ERROR` after 40 s and answered 503.
  - `npm run build` type-checks every file under `src`, tests included (`tsc -b`). The container's tests read the shared samples in `contracts/container/*.json`.
  - The Dockerfile copied only `frontend/`, so 41 imports were missing and `tsc` failed.
  - Reproduced locally in the Docker layout: 52 errors without `contracts/`, none with it.
  - **Fix:** the Dockerfile copies `contracts/` beside `frontend/`, as in the repository. The tree of this push builds in that layout: `tsc -b` exit 0 and `vite build`.
- **Also in this push (D3a's follow-up, merged after the first push):**
  - «Обновить из файла» on a subject (`/exams/import?from=c:<id>&subject=<sid>`): only new questions are added. A different key is listed by number and changes only in «Ключи». Saved questions stay.
  - The minutes line in «Настройки».
  - 21 new tests; the package's full run passed: 232 files, 3807 tests.

## 2026-10-10 — Release 35: one exam for the whole session — several subjects and hundreds of questions, a plan for each day, «верно в два разных дня» (from the commit of this entry)

- **The exam holds a whole session** (spec `meldy-notes/10_Project/Exam_Container_Spec_2026-10-09.md`, decisions 1–65). The owner's words: one container for 4+ subjects and hundreds of questions instead of four separate exams. Students do not need confirmations or teacher checks.
- **Import** `/exams/import` (one door: `/exams/new` leads here).
  - Files of every subject at once, or one file with all of them, in DOCX/TXT. The key is taken from bold, underline, colour, «+», or a separate key list.
  - The preview reads «Нашли 4 предмета и 960 вопросов». Problem questions wait in a queue. Oral lists over 150 questions are split into parts.
  - Saving resumes after a failure. The server reads the file with `POST /api/exams/parse-bank` (about 1 s per 480 questions).
- **The exam and subject pages** `/exams/c/:id`, `/s/:subjectId`:
  - the plan of the day with one blue button «Начать: 20 вопросов», then the figure «N из M — верно в два разных дня»;
  - the subjects as rows;
  - «План по дням», «Ключи», «Настройки», «Пригласить группу».
- **«Занятие»** `/study`:
  - 20 questions of one subject; «7 из 20» on a phone; the verdict in the pinned bar;
  - «Нажали не туда?», «Сомневаюсь в ключе», and «Ключ неверный?» for the author;
  - several correct answers, short answers, code wrapped on a phone;
  - a mistake comes back after a few questions and tomorrow;
  - the end: «Теперь 147 из 960 — верно в два разных дня» or «20 вопросов за 11 минут».
- **«Как на экзамене»** `/mock`: the attempt is kept on the device and sent through the answer queue.
- **The rule and the plan** (`lib/containers/*`, pure TS, also for the bot):
  - a question counts after correct answers on two different days, at least 20 hours apart, checked at +5/12/25/50 days;
  - the minute budget per day is hard (30/45/60/90);
  - the day's plan is frozen at its first answer;
  - the last days before the date have no new questions.
- **The group:** one link `/g/<код>` gives the whole exam. Oral subjects arrive as copies through `POST /api/containers/{id}/oral-sync`. The author sees «Кто вошёл» and can remove a member.
- **«Сегодня» and «Экзамены»:**
  - the lead is the nearest date with something today;
  - an account without such an exam sees exactly the old screens (57 DOM snapshots and pixel pairs), also when the database functions are missing, on errors or after a 2.5 s wait.
- **Offline:** «Сегодня», «Экзамены» and the exam pages open from the device. Answers wait in a queue. A student whose token expired offline stays signed in.
- **Database:** `20261009093500_containers.sql` + `…093501_containers_revokes.sql` + `20261010074500_containers_fk_indexes.sql` were applied on 10.10 through the new workflow `supabase-migrate.yml`; 7 of 7 contract checks pass. The live API smoke as the test account passed 14 of 14.
- **Verified before release:**
  - Vitest: 230 files, 3786 tests; pytest: 1737; `tsc -b`; production build.
  - Browser with the live database and the test account, 390×844 light and dark and 1532×734, against an exam of 960 synthetic questions in 4 subjects: import → exam page → a full session to the end screen → «Сегодня», «Экзамены», subject, «Как на экзамене», «Ключи», «Настройки».
  - No sideways scroll and no page errors.

## 2026-10-08 — Release 34.1: the exam page's bar on a phone no longer shows «Тянуть билет» for a moment before its real action (from the commit of this entry)

- **The bar waits for the first status.** The live check of release 34 (the video and a watch of the bar every 40 ms) showed, on every opening of an exam on a phone, «Тянуть билет» with «Как на экзамене · изменить» for 40–250 ms (0.7 s in the video), then «Тянуть билет из 4 вопросов» without the line. The page drew its status before the sheet and the answers were read (that loading state dates from release 30). Now the bar keeps its room and stays empty while the first status is read (`pages/ExamDetail.tsx: BAR_WAIT_MS`, `.ex-cta[data-wait]`), and shows «Тянуть билет» after 2 s if the read is slow; a later read (after a run, a retry) leaves the bar in place. Phones and tablets only (the bar); the computer's status block is unchanged.
- No migrations, frontend only. Verified before release: Vitest 187 files, 3099 tests (two new: the bar waits, the bar shows after 2 s); `tsc -b`; production build; the bar watched on the build with the live data, three openings: «Тянуть билет из 4 вопросов» comes straight after an empty bar of about 0.4 s (on release 34: «Тянуть билет» + the line first, in 3 of 3).

## 2026-10-08 — Release 34: the app on a phone, decluttered — three things in the top bar, one main action per screen, the rest one tap away (from the commit of this entry)

The owner: «на телефоне очень перегружен интерфейс именно в самом приложении почти везде, надо что-то с этим делать». The 13 main screens were measured on the live site at 390×844 and 360×780 (both themes) with the test account, then five area agents, three critics on the after-shots and two fix rounds. Phones only (`max-width: 639px`; `usePhone()` where the structure differs); the computer and the tablet stay as they were except the list below. Spec: meldy-notes `10_Project/Phone_Declutter_2026-10-08.md`.
- **Top bar: 5 items → 3** on every screen: the wordmark (or the back link), the AI limit, the account. «+ Лекция» → a white «Разобрать лекцию +» at the top of «Лекции» and the «Разобрать лекцию» link in the lectures' head on «Сегодня»; «?» → the account menu («Как пользоваться Meldy»). The limit stays in sight: a thin open ring with the number, «Лимит ИИ» beside it from 360 px.
- **One blue per screen.** Secondary actions of the exam and the lecture sit in a round «⋯» at the top right; elsewhere they are quiet links (ink for a step, grey for a detail). Counts are text («В лекциях: есть 15 · частично 3 · нет 2»), not pills; lists are rows of one card; one meta line («21 октября, через 13 дней · 20 вопросов, в билете два»); one text-tab look; an empty block is not shown.
- **«Сегодня»** 3.1 → 1.6 screens: the exam card keeps its next step and «Тянуть билет из них»; «Лист экзамена» is a link; the dots, the legend, the explanations, the done first steps and the empty chart moved to the exam page or wait until there is something to show; «Повторение» is a line; lectures are rows.
- **Exam page**: above the list only «Пора проверить», the rest in «Как считается»; tabs with zero questions are hidden; the marks' key behind «Обозначения»; the bar «Тянуть билет из 4 вопросов». **Editor**: plain headings instead of caps labels, one-line hints with «Подробнее», one choice link («Выбрать все» ↔ «Снять все»). **/analyze**: one frame with «Выбрать файл», formats as a line, text tabs.
- **Lecture**: one tab row «Конспект · Карточки 6 · Тест 5 · Подкаст»; «Экспорт» and «Поделиться» in «⋯»; fragment pills → «фрагменты 2, 3»; terms as a plain list. **«Лекции»**: rows in one card, the date in the meta.
- **«Повторение»**: «Вопрос экзаменатора» as words, «Дневник ошибок: 17 открытых →». **«Прогресс»**: one «Сводка» card with the page's only blue «Повторить», day bars only from five days, «Что подтянуть» as links. **«Дневник ошибок»**: text tabs with counts, «Работать над ошибками», no «Обновить» (the diary re-reads when the app comes back). **«Профиль»**: counters as one line, white «Включить». **«Карта знаний»**: «Экзамен · Карта / Список · поиск» in one row, the key behind «Обозначения», rows in one card.
- **Shared parts**: `lib/usePhone.ts` (one MediaQueryList for every component), `components/ui/MoreMenu` (arrows, Home/End, Escape gives the focus back, Tab closes, 44 px rows on phones). The diary's and the lecture's `md-*` classes are scoped with `:where()` (visiting the diary hid the lecture's «⋯»).
- **Also on the computer, on purpose**: the editor's headings plain; the profile's counters as one line; the progress page's screen-reader table no longer adds blank scroll; «Показать вопросы» on the progress page opens the exam on the questions without material; the exam's bar names the ticket's size; the guide's kicker plain and its «Сегодня» text matches the page; the account button's name; the knowledge map asks the window for «phone» (640–655 px with a scrollbar keeps the computer map); the diary drops a read that a fix or a delete overtook.
- **Measured** (390×844, first screen: buttons and links · pills · boxes · words · page height in screens; the live site before, the merged build on the same live data after): «Сегодня» 4·4·2·60·3.1 → 5·1·2·58·1.6; «Экзамены» 3·7·1·28·1 → 3·4·1·22·1; exam questions 5·3·2·79·6.1 → 12·6·2·88·3.9; exam sheet 8·3·2·82·7 → 14·5·1·105·5.8; editor 11·8·2·95·2.7 → 13·2·2·103·2.3; «Лекции» 4·2·3·90·1 → 5·2·1·60·1; lecture 11·9·2·63·5 → 7·4·1·82·4.5; /analyze 7·13·3·51·1.7 → 9·2·3·55·1.2; «Повторение» 3·3·5·59·1.1 → 3·1·4·42·1; «Прогресс» 2·2·2·38·5.9 → 4·1·2·59·2.8; «Дневник ошибок» 6·6·2·62·3.7 → 4·1·3·56·3.6; «Профиль» 1·6·2·31·1.9 → 3·4·3·36·1.5; «Карта знаний» 15·14·2·90·2.4 → 8·4·1·87·2.1. Where the first-screen counts rose, the list moved up into it.
- No migrations, frontend only. Verified before release: Vitest 187 files, 3097 tests; `tsc -b`; production build; the 13 screens at 390×844 and 360×780 (light) and 390×844 (dark) on the merged build with the live data: no horizontal scroll, no page errors, three items in the top bar.

## 2026-10-08 — Release 33: the whole site re-checked through a newcomer's eyes — the next step on the first screen, narrow blocks widened, clear names, honest numbers (from the commit of this entry)

The owner: «просмотри полностью заново весь проект, исправь все ошибки… обдумай как каждая страница будет выглядеть для людей с разных сторон… проверь со стороны человека который не знает что к чему». Three read-only audits of the live site (1532×734, 1912×920, 1024×768, 390×844, 320×640, both themes) found ~90 problems; all are fixed except a privacy-policy page (the owner's text).
- **Main actions in view.** «Сегодня»: «Тянуть билет» right under the exam's name (was 1049 px down). Editor: its main button in a bar on every width. Exam page: «Почему» shows «Ответить на этот вопрос» under the verdict. Answer room: the side column with «Готово» and the protocol's buttons follows the reader; Ctrl/⌘+Enter finishes. «Повторение» on a phone: the grades stay above the tab bar after «Перевернуть» (they were under it or off-screen). «Разобрать лекцию»: the start on the first screen (was 1,218 px below the file field).
- **Using the width.** The exam's question list 760 → 836 px with the text 438 → 706 px (the status pill sits inside the question); the lecture header's title on its own row (the lecture text starts at 449 px instead of 761 at 1532×734, no jump between tabs); the landing's cheat sheet section in two columns with a key; /try's lectures beside their heading.
- **Names a newcomer understands.** The two-host audio is «Подкаст» again (next to «Поговорить о лекции» it read as the same thing); the phone's «+» is «+ Лекция»; the sheet's switches say what they do; rubbed lines carry a pencil note; «Как на экзамене» says the points come only in the protocol instead of grey bars; the protocol: one status per point and «Сами назвали 3 из 4 главных пунктов, ещё 1 — после вопроса экзаменатора».
- **Honest numbers and states.** Card counts say where cards come from («6 карточек · ещё 4 из ответов на билеты», «24 ждут сейчас · ещё 2 — позже сегодня»); the profile counts lectures, answers and days live (it showed 0 for every account); study days count ticket answers; empty screens for a new student say where things come from and give one action; the mistakes diary groups missed points under their question; deleting a mistake asks first; the limit window lists every priced action and what works without units.
- **Correctness.** Formulas: the server keeps LaTeX backslashes (`\text` became a TAB: «extCOUNT»), stored lectures are repaired when shown. /try: the reply to the examiner is checked by the AI (a correct reply could never count); the privacy line is true. The follow-up question asks about the point's own thought and its reply is judged against the expected answer. Sign-up never refuses a real address (mail.com, inbox.lv…) or name («Гарик Сукачёв», «O’Neil»); the new-password page uses the sign-up rules. Answer points are not prefetched for questions without them (the 422s). The eraser strip no longer runs over the next column. Lecture order is the same in «Лекции» and the knowledge map.
- **Phones and small screens.** «Войти» on the landing; delete and folders in the lecture's «⋯»; the reel's chapters 44 px tall with a caption; nothing hidden under the bottom bars at 320 px; tab badge with the cards due.
- **The landing video** fits the laptop window whole (capped by the window's height; the film itself unchanged); its frame draws through one surface, so no corner is left unpainted at 1532×734.
- Page titles name each page («Вход — Meldy», «Сегодня — Meldy», the exam's and the lecture's own titles).
- No migrations. Backend: `utils.repair_latex_escapes`, `/api/try/evaluate` with `point_id`, `/api/oral/check` with `followup_expected`, the answer-points prompt. Verified before release: Vitest 184 files, 2955 tests; `tsc -b`; production build; pytest 1530; the six areas' browser checks on the merged build at 1532×734, 1912×920, 1024×768, 390×844 and 320×640 (light, dark at 1532 and 390): no horizontal scroll, no page errors, main actions in view; no «Засчитано», «удовлетворительно», «оценки по пунктам» or «ПРОВЕРЕНО» in the bundle.

## 2026-10-08 — Release 32: the previous reel, better in its own style — a lecture quote in the ticket chapter, the group and the example at the end; the video starts under the buttons (from the commit of this entry)

- **The reel, same look and motion** (the owner: «переработать прошлое видео, но получше, с такими же красивыми анимациями и в том же стиле»). In the ticket chapter the cursor stops on question 36 «Экономический рост» and its lecture quote opens under the row — «Экономический рост — увеличение реального ВВП за длительный период», «Лекция «Экономический рост» · фрагмент 4» — as the exam page shows it (the landing's «Ответы — цитатами из ваших лекций»); then «Тянуть билет» as before. The chapter is a second longer: «Meldy за 36 секунд».
- **The end card** names four things instead of three — «Группа · копия экзамена у каждого» joins «Билеты», «Ответ вслух», «Шпаргалка» — and its button says the hero's «Попробовать на примере» and opens `/try` (it said «Начать подготовку» and opened the sign-up).
- **The landing's first screen.** The reel's heading row («Meldy за … секунд» and its note) is no longer drawn in the hero — screen readers and the «Ролик» link keep it — so on a 1532×734 laptop the video's top shows under the buttons instead of starting below the first screen.
- No migrations, no backend change. Verified before release: Vitest 168 files, 2703 tests; `tsc -b`; production build; frames of the ticket chapter at 14.3–16.8 s and of the end at 35.4 s; first screens at 1532, 1024 and 390 px without horizontal scroll or page errors.

## 2026-10-08 — Release 31.1: the previous landing reel back, without the corner frame and the corner labels (from the commit of this entry)

- **The reel.** The owner preferred the previous film («нет, верни видео которое было… мне нравилось прошлое больше»): the 35-second reel of release 30.2 is back as it was, and the one-sheet film of release 31 is reverted (`Landing.tsx` is the 30.2 one again: «Meldy за 35 секунд», the end card leads to the sign-up).
- **The corners.** The four corner brackets (the frame over the blue opening), the chapter label, the timecode and the chapter dots are gone; only the small «MELDY» mark stays (the owner: «не нравилась только рамка по бокам вначале и надписи по углам, кроме Meldy»).
- No migrations, no backend change. Verified before release: Vitest 168 files, 2701 tests; `tsc -b`; production build; frames at 1.6, 4.2, 5.4, 9.5, 13, 19, 24.5 and 33.5 s show the scenes of release 30.2 with «MELDY» as the only corner mark.

## 2026-10-08 — Release 31: the landing film rebuilt — one sheet of paper, one camera, 48 seconds, an end card that opens the example (from the commit of this entry)

- **The film.** One sheet of squared paper and one camera over it, with no cuts. Every step is the app's own: the department's list is typed; the lecture slip and the fit count come from the lecture check; the four points of the answer are written by hand as the examiner's words name them; the answer's words are typed in the transcript; the lines are rubbed after the answer and erased on another day; a line forgotten comes back in ink with the note «была стёрта · пункт не назван». Then the copy for the group, and the end card.
- **The data.** The example of /try (12 questions, question 7 with four points), not the earlier sample. The fit counts come from the app's lecture check on that example.
- **The end card** «Попробовать на примере» opens /try (it used to open the sign-up).
- **The heading** «Meldy за 48 секунд»; the chapter bar's second label is «Лекции» (it was cut at laptop width).
- **The lecture slip.** Its «Отметить подходящие (4)» wraps under the text instead of sticking out of the white card, and the camera centres the focus column, so the slip, the ticket and the points stay whole.
- **Not changed.** No migrations, no backend change, nothing in the app's own cheat sheet.
- Verified before release: Vitest 169 files; `tsc -b`; production build; no «Засчитано», «удовлетворительно», «оценки по пунктам» or «ПРОВЕРЕНО» in the bundle. In the browser (the merged build): the heading, seven chapters, no horizontal scroll at 1532 and 390 px, the end card opens /try, no page errors; the focus column checked at 14, 23 and 37 s.

## 2026-10-08 — Release 30.2: the video in the landing's first screen, bigger and under the headline; the cheat sheet below the steps (from the commit of this entry)

- **The first screen.** The headline and the lead run across the full width; the video (the motion reel) is under them at full width, on every screen size. On a phone the text is shorter, so the video starts on the first screen.
- **Order of the page.** The first screen, then «Как это работает», then the cheat sheet itself (the /try example) in its own section. The sheet used to sit in the first screen on a phone.
- **Not changed yet.** The reel's content and its heading «Meldy за 35 секунд» stay until the rebuilt reel is merged (its own release).
- No migrations. Verified before release: landing tests 21/21 after the last change, the full Vitest run 2702/2702 (168 files) before the last style changes, `tsc -b`, production build; no «Засчитано», «удовлетворительно», «оценки по пунктам» or «ПРОВЕРЕНО» in the bundle.

## 2026-10-07 — Release 30.1: what the live check of release 30 found (from the commit of this entry)

- **A token «from the future».** Right after sign-in, «Сегодня» failed once with 401 PGRST303 («JWT issued at
  future»): the auth server's clock ran ahead of PostgREST's. Such a request did not run, so the browser sends it
  again after 1 and 2 s (reads and writes alike); any other 401 is left to the auth client.
- **Nothing found means no ticket.** An exam whose lectures answer none of its questions no longer offers «Тянуть
  билет» even as a quiet link: there are no points to check an answer against.
- **The invite dialog** promises «Пункты уже записаны…» only when a link can be made.
- **The editor** keeps «К вопросам списка подходят N лекций» on screen after the questions ticked the lectures.
- **Sheet short lines:** 30 s with Gemini's share 22 s, then the fast Groq (4 of 29 calls on 07.10 stopped at the old
  20 s cap with no fallback; the sheet then showed the full point titles).
- **`aria-controls`** names a panel only while it is shown (lecture fragments, the conversation's slip, the first
  steps on «Сегодня»).

The first release after the new update flow: open pages of release 30 show «Есть новая версия Meldy · Обновить»
instead of reloading. No migrations. Verified before release: pytest 1490, tsc -b, Vitest 2702/2702 (168 files),
production build (no «Засчитано», «удовлетворительно» or «оценки по пунктам» in the bundle).

## 2026-10-07 — Release 30: the exam page says what happened and what to do, lectures that fit the questions, no surprise reloads (from the commit of this entry)

What the owner found on 07.10 in his own use and on a classmate's copy, and the rest of plan v2's week 2.

- **No surprise reloads after a release.** A release used to reload every open page a second after the new worker
  was found (the owner: «через секунду у меня обновляется сайт как будто нажали f5»): `sw.js` skipped waiting on
  install and the plugin's auto mode reloaded on activation. Now the new worker waits. A page of the older release
  shows «Есть новая версия Meldy · Обновить» and moves to the new one only while hidden (never on a ticket, the draw,
  a talk, an analysis or the list editor, and never with typed text) or on «Обновить». The new worker takes over when
  every open window agrees (`SKIP_WAITING` → `MAY_ACTIVATE`). Tabs still on release 29.1 keep working and are not
  reloaded; they get release 30 when reopened.
- **The exam page says what happened and what to do.** One status block above the tabs: what Meldy did, what it
  found, one action (18 states, a classmate's copy included). When the lectures answer (almost) nothing — 70 % of the
  questions or more «нет» — it says «В лекции «…» нет ответов на эти вопросы», hides the shares that say nothing,
  and names the student's other lectures that fit the questions, or says that none do. «Сегодня» offers the same
  next step. The sheet's first-use card is gone: it repeated the status and pointed elsewhere.
- **Which lectures fit the questions.** `POST /api/exams/lecture-fit` — shared words over each lecture's three best
  fragments, no AI, no units, nothing saved, 20 a minute. The editor shows «подходит к N вопросам», «Отметить
  подходящие (N)» and the questions no lecture fits; a new exam ticks lectures by its questions.
- **Group link.** No new link for an exam whose lectures answer nothing (409 `nothing_found`); a warning when less
  than half is found. The invite dialog fits a laptop screen in two columns; «Вопрос дня» gives the group chat a
  question a day (the link stays on the device that made it; the server keeps only its hash). Release 29.1's
  «Google refuses it in those browsers» was too broad: Telegram opens links in Chrome Custom Tabs or Safari, where
  Google works. The note and the hidden Google button now come only in a real WebView, and the chat text makes no
  claim about Google.
- **Daily reminder.** «Напоминать каждый день» on «Сегодня» and in «Профиль»: a calendar file, 20:00 by default
  (`TZID` Europe/Minsk for Belarus).
- **Reels.** Sign-in, sign-up and the landing's chapters 03–04 tell the new story: the department's list → answers
  from the lectures → a ticket aloud → the sheet that only answers erase. New headings over them.
- **Smaller:** the lecture page's export menu stays on a phone screen; the profile's reminder window is narrow;
  darker dimming behind dialogs in the dark theme.

No migrations. Verified before release: pytest 1490, tsc -b, Vitest 2697/2697 (168 files), production build (no
«Засчитано», «удовлетворительно» or «оценки по пунктам» in the bundle); the built `sw.js` calls `skipWaiting` only
on `SKIP_WAITING` after every open window agrees.

## 2026-10-07 — Release 29.1: a quick check that survives a slow Gemini, a report for the department, fixes from the second live run (from the commit of this entry)

- **Quick check:** Gemini gets `ORAL_CHECK_GEMINI_SECONDS` (2.5 s) of the 4.5 s budget while Groq can answer, then
  `GROQ_FAST_MODEL`; only then 504. In the live run of release 28, 17 of 18 checks in a slow-Gemini window failed at
  4.5 s while Groq answered health checks in 0.38 s. Same validation for both; one `ai_calls` row per check.
- **Report for the teacher:** `/exams/:id/report` — the exam's mapping as an A4 document (question → verdict → the
  lecture's own fragment → answer points, boxes «верно / неполно / ошибка», signature lines), print and CSV.
- **Sign-in inside Telegram or Viber:** `/login` and `/register` say to open Chrome or Safari and drop the Google
  button there (Google refuses it in those browsers); e-mail sign-in stays.
- **Group link:** the author on their own closed or expired link sees that it is closed and where to make a new one.
- **Sign-up:** an empty form is stopped on the page (it reached Supabase as an anonymous sign-up).
- **Sheet:** questions whose points failed the quote check twice no longer count as «to write» (they are shown as
  gaps with the reason); a group copy re-checks against lectures without asking for units it would not spend.
- **Smaller:** «Разобрать лекцию» for the 20-unit analysis, «Добавить лекцию» stays for the free step; «10-балльной»
  never breaks; the list editor shows exactly the lines the server skipped; the profile switch; the paste hint
  scrolls into view; `aria-controls` only when the panel exists; «добавлена 1 лекция»; the past answer shows its time;
  the date on `/join` keeps «21 октября» together.

No migrations. Verified before release: pytest 1422, tsc -b, Vitest 2430/2430, production build (no «Засчитано»,
«удовлетворительно» or «оценки по пунктам» in the bundle).

## 2026-10-07 — Release 29: a check the jury can try, a mapping that cannot borrow a quote, one face before sign-in (from the commit of this entry)

Plan v2, week 2 items brought forward, and what the browser QA and the second live run of release 28 found.

- **`/try` checks the answer with the AI.** `POST /api/try/evaluate` (no sign-in) judges the example's answer with the
  same evaluation as a real ticket; the server holds the example's questions and points itself (`try_example.json`,
  a test fails on drift), so the route cannot be used as a free model. Own key `TRY_GEMINI_API_KEY` (cap
  `TRY_AI_DAILY_CAP`, 400 a day); until the owner adds it, the main keys within `TRY_AI_DAILY_CAP_SHARED` (60 a day).
  Per visitor `TRY_AI_CLIENT_LIMIT` (12 per 10 minutes, 40 a day). No key, cap, timeout or error → the key-word
  check, and the protocol says so and why. No units, nothing saved; the privacy line says the text goes to Google.
  `/api/health/deep` shows `try: {key, day, calls, cap}`.
- **Mapping guard (the wrong-lecture quote of the first live run).** Judge labels are numbered through the whole batch
  (a fragment shared by two questions keeps one label), so a label from a neighbour's list is never one of the
  question's own. For «есть» / «частично» the judge copies 5–15 words of the fragment; the server finds them there
  (or moves the support to the one own fragment that has them, or drops it). A question left without a verified
  support is retried, then «проверено только по словам» — never a false «нет». A lecture plan no longer takes the
  places of real text in the candidates. `MAP_VERSION` unchanged (a bump would re-charge everyone and stop group links).
- **Why panel** says why a question was checked only by words (busy service, no answer, quote not confirmed).
- **Landing, link preview, icons.** «Тренажёр устного экзамена по билетам кафедры. ИИ не отвечает за вас — он вас
  спрашивает»; the hero is the vanishing sheet playing one answer; four steps (the department's list → quotes from
  your lectures → aloud with a follow-up → lines erased only by answers on different days); the honest result; the
  group link. Open Graph image 1200×630, PNG icons 192/512/maskable and apple-touch-icon, manifest and READMEs say
  the same; no «Конспекты, карточки и тесты» left in the bundle.
- **Browser QA of release 28 screens:** the consent card, the result's lines on phones, the profile rows.
- **Blind labeling kit** (`backend/scripts/blind_labeling.py`, `docs/blind-labeling.md`): sheets for two labelers
  without Meldy's verdicts, then agreement (kappa) and Meldy's accuracy with intervals.

Database: `20261007112314_security_advisor` applied on 2026-10-07 (trigger functions and unused legacy RPCs closed to
API roles; sign-up checked live after it).

Verified before release: pytest 1396, tsc -b, Vitest 2336/2336, production build. Not verified yet: a real Gemini
call on the `/try` route and the visitor address behind the HF proxy (after this release), real Telegram and VK
previews of the new image.

Second push (from a2097e0): the first, run 36, was refused by the Space — «Your push was rejected because it contains
binary files» — for a 143 KB `og-image.png`. The preview is now `og-image.jpg` (92 KB); `test_space_binaries.py`
fails on any binary file over 100 KB that the workflow would push. pytest 1397.

## 2026-10-07 — Release 28: an honest result, the group link and the fixes from the first live run (from the commit of this entry)

Plan v2 for CodingFest-11 (notes: `10_Project/CodingFest_11_Improvement_Plan_2026-10-07`). The first live run of the
core (a «Базы данных» course on a test account) found it working end to end — 41 of 42 point verdicts right — but the
quick check never in time, a point with a factual error counted as named, and the first step costing 60 of 100 units.

- **Result without grades.** «Назвали сами N из M главных · после вопроса K · ошибок: E», what the answer did to the
  sheet, and one line: the teacher marks on the 10-point scale, Meldy only checks the points of the student's lectures.
  No «5 · отлично» and no «Засчитано» anywhere (ticket, sheet, `/try`, «Сегодня», landing, reels).
- **A ready text cannot be pasted** into an answer (more than 8 words), on the ticket and in `/try`.
- **«Сегодня»:** «Можно стереть: N вопросов → Ответить», counted by the sheet; «Ждут подтверждения» draws from it.
- **Group link.** «Пригласить группу» (after the author's consent) makes a secret link; a classmate gets their own copy
  of the finished exam — questions, mapping, lectures as text, answer points, sheet — with no model call and no units.
  `/join/<code>` works signed out, Google first, back to the link after sign-in or the email; inside a Telegram or Viber
  browser it asks to open Chrome or Safari. A copy cannot be shared on.
- **AI quota.** A (model, key) pair that answered 429 rests (Retry-After, or until the daily reset) and the next one is
  tried at once; heavy calls wait in one queue (`AI_HEAVY_CONCURRENCY`, 6); `AI_COOLDOWN=0` turns it off.
- **Quick check in time:** 3.5 Flash-Lite first, 4.5 s on the server, 5.5 s in the browser. A point with a factual
  error is «wrong» (the sheet keeps its line); «не знаю» costs no units and no model call.
- **Question lists:** section headings are sections, «по учебной дисциплине» names the exam; DOCX keeps paragraphs
  and tables whole (new lectures only).
- **First steps** lead to the free core («Новый экзамен» with lectures as text) instead of the 20-unit analysis.
- **Sign-up** says what went wrong and where the letter went.
- **Answer texts with consent** for the blind accuracy check (question on the exam page, switch in «Профиль»).

Database: `20261007103621_oral_answer_texts`, `20261007110403_exam_shares` and `20261007110457_exam_shares_revokes`
applied on 2026-10-07 (additive; contract checks 20/20 and 12/12; the group functions match the repository).

Verified before release: pytest 1228, tsc -b, Vitest 2276/2276, production build (no «Засчитано» or
«удовлетворительно» in the bundle), local Postgres behaviour tests of both migrations. Not verified yet: the new
screens in a browser (QA running), the group link with two live accounts (gate В1), live latency of the quick check.

## 2026-10-07 — Push notifications: the key only from the server, ready for a new pair (from the commit of this entry)

Adds to release 27.1. The old VAPID private key was in the Git history; the owner does not handle keys, so a new pair
is put on the Space by `.github/workflows/rotate-vapid.yml` right after this release. This release prepares it:

- `GET /api/push/key` is open without a session (the key is public by design), so the rotation can check what the
  site serves; it says `configured: true` only when both halves are set.
- No public key is built in any more: not in `push_router.py`, not in `frontend/.env`. Turning notifications on in
  «Профиль» takes the key from the server only; when the server has none it says «уведомления на сервере пока не
  настроены» instead of subscribing with a key nothing can sign. The other messages there are in Russian too.
- The two old scripts that appended keys to `.env` files are gone.

No migrations. Verified before release: pytest 1078, tsc -b, Vitest 2137/2137 (`push.test.ts` new).

## 2026-10-07 — Cheat sheet: a short line keeps the minus of every number (from 4b27f5a)

Adds to release 27 (tree of c482e08). Found while closing the list of what the server's check of short lines still
let through: numbers were compared without their sign, so «эл. = 2» passed for «Эластичность спроса равна −2».

- A minus right before a number (−, - or – not after a letter or digit) or the word «минус» before it is part of the
  number: a line that drops or adds it is rejected, and the sheet shows the point's own words instead. «минус 2»,
  «-2» and «−2» are one number; ranges («2–3», «2-3») and hyphens («COVID-19») are unchanged.
- Such a minus is no longer taken for a subtraction sign; the prompt asks to keep each number with its minus.
- Lines already saved are checked again when read, so a stored line that lost a minus is not given out.

Server only, no migrations. Verified before release: pytest 1075 (the sheet's file 172, nine new cases).
 unreadable rubbed lines, honest shows, keyboard and screen readers (from 9c363f9)

Adds to release 26 (tree of 3f571e3). The owner, 2026-10-07: «Продолжи, доработай что нужно». Four critics (words,
visual and motion, accessibility, edge cases) went over the released sheet; every finding was checked in code.

- Rubbed lines could be read on a phone or a 2× laptop: the eraser's two passes beat into a moiré. Both now share one
  period; at 1×, 1.25× and 3× only scraps of letters are left.
- A check passes only when the line was due (naming it earlier only starts its wait again: five days in a row are no
  three checks). An answer is replayed as of its own moment («После ответа 4 окт.: …»); both questions of a ticket are
  played in turn where they are, both marked; named too soon and peeked are said together; a history with lines that
  went and came back says «1 → 0 → 1», shows at most 50 days and always ends today.
- A peek that could not be saved waits on the device and is sent before the next answer is saved; still not saved,
  the panel says so with «Повторить». A tab coming back reads the journal again.
- Short lines that change the meaning are rejected on the server (a reversed cause, a dropped «не-», swapped sides
  of = − < >, similar long words); lines saved under the older check are not given out; the server's own daily cap
  is said as such.
- Words: one plain sentence after an answer and a quieter reason under it; one paragraph per line state in the panel;
  «Спрятать строки», «Вся шпаргалка», «Показать, что изменилось»; the whole rule on every size.
- Phones: the paper's lines on the first screen (the count and one switch above it, the rest and the page's links
  under it), the history played in view with its day over the bottom bar, every line a 24 px target. The projector's
  button stands in the column or over the bottom bar, never on «Тянуть билет». No layout shift when the paper comes.
- Keyboard and screen readers: focus follows the history, the write and «Показать», never hides under the bars; one
  status line says what changed; a readable line is named by its visible words; a peeked line stays open while its
  details are; a printed question says its «почему» is open; Windows High Contrast keeps the switches' state.

No migrations. New journal-free device key `studyforge_sheet_peeks_pending` (peeks waiting to be sent).
Verified before release: tsc -b, Vitest 2132/2132, pytest 1066, production build; on mocked Supabase/API the sheet at
1532×734, 1024×700 and 390×844 in both themes, the after-answer show of a two-question ticket frame by frame, the
projector's wait, reduced motion, the phone's history, keyboard focus through the history and the skip button, the
phone's bottom sheet inert behind; 300 questions: 60 fps scroll, layout shift 0 on a phone and 0.0004 at 1532×734,
no CSP violations, no console errors. Not verified: a real sheet written by the live AI providers under the stricter
check — check right after the release.

## 2026-10-06 — «Шпаргалка, которая исчезает» on the exam page (from 3f571e3)

Adds to release 25 (tree of 4fe73ec). The owner, 2026-10-05, on the idea: «со шпаргалкой звучит неплохо, реально
неплохо, но это нужно идеально реализовать и продумать до мелочей». Spec v2 after five critics, then a second round of
five critics on the built screens.

- The exam page has two views, «Шпаргалка · Вопросы». The sheet is squared paper: the department's questions printed,
  under each the answer points from the student's lectures written by hand — the same points the ticket's answer is
  checked against. Where the lectures lack a question, a pencil note says so.
- Only answers erase it: a point named in an answer rubs its line half-way (the words are no longer readable,
  «Подсмотреть» opens them and is logged, and a naming the same day after a peek does not count); named again on
  another day, at least 20 hours later, the line is erased; not named later, it comes back with a wave; erased lines
  come back for a check after 5/12/25/50 days and in the last days before the exam date. Reading erases nothing.
- «Написать шпаргалку» writes the missing questions on the server (one AI unit a question, the same price and cache as
  the ticket's answer points; the run finishes without the page, «Остановить» starts no new questions); the price is
  said before the button.
- Back from an answer the sheet plays what it changed (marker, eraser, the count rolling) and says it in words,
  including lines named again too soon; «Показать последний ответ», «История шпаргалки» (the sheet day by day),
  «Только то, что осталось», «Закрыть строки» (a self-test), «Весь лист». On a projector (stage mode) the show waits
  for «Показать» and goes slower. Phones: the count above the paper, line details in a bottom sheet, the change in
  a chip.
- The protocol of an answer says «На шпаргалке: …» with a link; «Сегодня» shows the sheet's line under the exam;
  a first-use tip with a short clip; the guide's words.
- /try: the example's sheet is written from the start, yesterday's answers to questions 1, 5 and 9 are rubbed in,
  «Ответьте на вопрос 5» and «Вставить ответ примера» erase lines for real; «Начать пример заново».
- The lecture's own summary is called «Выжимка» everywhere a person reads it (the sheet is the exam's).

Database: migration `20261005143420_cheat_sheet` was applied on 2026-10-05 (additive: `oral_rubrics.sheet`, the
journal kind `sheet_peek`; the old client keeps working). Statistics: `sheet_view`, `sheet_write_started`,
`sheet_write_done`, `sheet_peek`, `sheet_replay`, `sheet_history` (counts in buckets).
Verified before release: tsc -b, Vitest 2102/2102, pytest 1025, production build; on mocked Supabase/API the sheet at
1532×734, 1024×700 and 390×844 in both themes (rubbed and erased also at 2×), the line panel and bottom sheet, peek,
the switches, the history with its date, the after-answer show frame by frame, the empty sheet, the tip, «Сегодня»
and /try — no horizontal overflow, no console errors. Not verified: writing a real sheet with the live AI providers —
check right after the release.

## 2026-10-05 — The PRO window and «Дневной лимит ИИ»: wide and compact, no demo line (from 4fe73ec)

Adds to release 24 (tree of c42b383). The owner, 2026-10-05: «не все вмещается, размер слишком большой у всего, нужно
компактнее сделать», the limit window «компактнее … в ширину больше», and the line «Демо: оплата не подключена — PRO
включится бесплатно и сразу.» — «убрать».

- PRO window: on a computer two columns — the reel on the left; PRO, what it gives, the plan and «Купить PRO» on the
  right, everything a size smaller. 960 px wide and about 350 px tall: it fits a 1532×734 laptop screen without
  scrolling. Phones keep one column, with smaller type.
- The line under «Купить PRO» is gone. Signed out the window says «PRO включается после входа.». The purchase still
  takes no money: no price, no card form.
- «Дневной лимит ИИ»: 860 px wide — what is left, when it renews and the buttons on the left, the prices on the right;
  one column on a phone.

No migrations.
Verified before release: tsc -b, Vitest 1940/1940, production build; both windows on mocked Supabase/API at 1532×734,
1440×900, 1024×700 and 390×844, both themes — every card fits without inner scroll, before and after «Купить PRO».

## 2026-10-05 — First-use tips: «Поговорить о лекции» shows itself the first time (from f6c147c)

Adds to release 23 (tree of 3416d8e). The owner, 2026-10-05: «загрузили, нас перекинуло на лекцию и потом сразу (для
первого раза) появляется обучение с указанием на кнопку … и показывает видео маленькое в том стиле который у нас есть».

- A tip system (`components/tips/`): one tip at a time, shown only after the first-run guide, never while the guide or a
  menu is open, gone for good after «Не сейчас» or after the feature is used (remembered on the device and in the
  profile, `onboarding_status.tip_<id>`). Statistics: `tip_shown`, `tip_action`.
- The first tip, on your own lecture with cards: a ring around «Поговорить о лекции» and a card under it with a 6 s clip
  in the guide's film style (Meldy asks, the answer fills in, «Вот как сказано в лекции» with «Из лекции, фрагмент 3»),
  «Поговорить о лекции», «Meldy задаст вопросы по карточкам этой лекции, подскажет и покажет нужный фрагмент. Отвечайте
  голосом или текстом.», «Попробовать» / «Не сейчас». It takes no focus; Esc closes it; reduced motion — a still frame.
- After an analysis the button under the results is «Открыть лекцию» — straight to the saved lecture, where the tip is.

No migrations.
Verified before release: tsc -b, Vitest 1940/1940, pytest 901, production build; the tip's flows on the merged build
26/26 on mocked Supabase/API (dismiss and reload, a second device, «Попробовать», the pill itself, focus and Esc,
reduced motion, the guide's gates, a lecture without cards); screenshots 1024–1920 and phones 360/390, both themes.

## 2026-10-05 — The AI limit in the top line, «Лимит ИИ» in the guide, «Купить PRO» as a free demo (from 260ac20)

Adds to release 22.1 (tree of 1666b52). The owner's points of 2026-10-05: «лимит ИИ нужно вынести чтобы его было
видно и рассказать про него в обучении тоже», «почему у меня сразу про подписка, хотя я не покупал ее», «нажимаешь на
купить и тебе ее выдаст просто бесплатно».

- Top line: «Лимит ИИ» with a ring and the units left (on phones and at 1024–1179 px the ring with the number); yellow
  at 20 % or less, empty at zero — then a click opens the PRO window. A click otherwise opens «Дневной лимит ИИ»:
  what is left, when it renews, the prices from `lib/plans.ts` (now with «Поговорить о лекции» — 1 per answer), and
  what PRO gives. The meter follows every AI action and the purchase.
- Guide: a 7th chapter «Лимит ИИ» with a clip («−20», «−4» flying into the meter, «обновится ночью», «С PRO — 1000»);
  it lights the meter.
- PRO window: «Купить PRO» switches PRO on at once and for free, and says so under the button («Демо: оплата не
  подключена — PRO включится бесплатно и сразу.»); no price, no card form. «Отключить PRO» switches it off so the demo
  can be repeated. The reel stays and jumps to its PRO beat after the purchase.

Database: migration `20261005092819_pro_demo_purchase` applied on 2026-10-05 before this release (`profiles.pro_since`,
`start_pro_demo()` / `stop_pro_demo()`; PRO flags left from the old self-service toggle were switched off — nobody
paid; contract check green). For the owner, optional: `supabase/pending/2026-10-05_pro_demo_anon_execute.sql`.
Verified before release: tsc -b, Vitest 1906/1906, pytest 901, production build; the package's browser checks
147/147 on mocked Supabase/API (top line from 1536 to 320 px, meter states, purchase and cancel, kill switch, guide
chapter, phones); «Разговор» arithmetic unchanged at 1532×734 and 1024×700. Not verified: a purchase on the live site
— try «Купить PRO» right after the release.

## 2026-10-05 — Gemini answers quick calls again; a restricted Groq account is left alone (from 4baa64c)

Adds to release 22 (tree of 3186b3e). Found by the live `/api/health/deep` right after release 22: every Gemini
model answered INVALID_ARGUMENT to the 8 s probe, Groq answered every model with `organization_restricted`.

- Gemini: the SDK sends the call's budget as `X-Server-Timeout`, and the API refuses a deadline under 10 s. The
  header now never asks for less than 10 s (the shorter budget is still kept by the wait around the call), so the
  quick answer check (2.5 s), the evaluate retry and the health probe reach Gemini again (`base.py`, `ocr.py`).
- Groq: `organization_restricted` is an account-level refusal — treated like a rejected key (models skipped for a
  while, the tutor's chain rests Groq instead of asking it twice per turn); `/check` says «аккаунт у провайдера
  ограничен». The account itself has to be restored in the Groq console by the owner.

No migrations.
Verified before release: pytest 901, tsc -b, Vitest for the changed `/check` files (30/30; the rest of the tree is
release 22's, Vitest 1889/1889). Not verified: a live Gemini call through the new header — check `/api/health/deep`
right after the release.

## 2026-10-05 — «Поговорить о лекции», a roomier «Разговор», model checks that say why (from 900031f)

Adds to 2a05f95 (tree of 626ad98). The owner's points of 2026-10-05: the friend's idea «как с человеком разговаривать
по нужной лекции» (turn by turn, free), «компоновка текста вместе с кнопками … как будто очень сжаты» on «Разговор»,
and «ты проверил и выбрал самую дешевую по соотношению лимитов и качества?» about the Gemini models.

- «Поговорить о лекции» (`/library/:id/talk`, a pill in the header of your own lecture): Meldy asks the lecture's
  cards one by one, by voice («Отвечать» → «Готово», Space) or in writing; a hint, then the lecture's own words with
  the fragment number, then an explanation; «Не знаю», «Спросить» (an answer only with a verified quote, else «В
  лекции об этом не сказано»), «Закончить», a summary and «Продолжить разговор». One unit of the daily limit per
  turn the model answered.
- «Разговор» on a laptop window (≥1024 wide, ≤780 high): 14–16 px between the sheet, the voice, the player and the
  panel's edge instead of 4–6; «Добавить схемы» in the row of the host's name; a long line fits three lines at
  21 px; a dash never starts a line. With the new pill the header keeps one row.
- `/api/health/deep` says why: every Gemini model tried with its error code, a quick probe with the app's own
  settings, Groq's main and quick models; `/check` shows the reasons.
- Gemini: two Flash-Lite models, each with its own free daily quota — 3.5 Flash-Lite first for analysis and checks of
  lists, 3.1 Flash-Lite first for quick checks and the tutor (a `GEMINI_MODELS` variable on the Space overrides it).

No migrations.
Verified before release: tsc -b, Vitest 1889/1889, pytest 898, production build; browser on mocked Supabase/API:
the tutor at 1532×734 dark and 390 light (pill, start, a hint, a confirmation, a question, end; no console errors,
no sideways scroll), «Разговор» at 1024×700, 1280×720, 1532×734, 1440×900, 390, 360. Not verified: a real
microphone and voice on phones (Safari may need «Повторить звук»), the live model chain for the tutor.

## 2026-10-05 — Limits closed, hidden sections gone, a faster first load, a way round blocked Supabase, statistics, demo insurance (from 96024ef)

Adds to e1cbba3 (tree of d65bab3). The owner's points of 2026-10-05: «Закрой теперь дыры лимита, ускорь первую
загрузку, доделай учет ошибок и аналитику как хотел и страховку демо», «убирай скрытые разделы, дорабатывай это все»,
and «нормально что снизу пустое место?» on «Сегодня».

- AI limit: every model call is charged on the server — section re-runs, scans (per started 15 pages), the old
  priced routes; free checks and transcription have daily caps. A section that failed in your own analysis is
  repaired free only with the analysis's signed receipt; an analysis cut halfway keeps only the share it gave out.
- Hidden sections are removed from the build and the server: career with HH, social network, messages, teacher
  groups, AI chat, courses, missions, the old professor exam, mood, shorts, study room and session, the pricing page,
  XP, levels, quests. Their addresses lead to «Сегодня»; database rows stay. JS 3.57 → 2.54 MB.
- First load: the shell, dialogs, reels and the Supabase client load after the first screen; idle prefetch fetches
  the next sections. Entry JS 673 KB → 267 KB (208 → 89 KB gzip); throttled phone, first paint 1.6–1.9 s → 1.26–1.33 s.
- Network: when `*.supabase.co` does not answer, the browser goes through the site (`/sb/…`, FastAPI passthrough
  limited to auth, rest and storage); the choice is probed once and kept 12 h, a hanging read is repeated there.
- Security: a share link shows the title and the summary only (`shared_material()`), never the lecture text; the push
  public key comes from the server (`/api/push/key`).
- Statistics and error reports go to our own Supabase (`/api/telemetry` → `app_events`, views in `analytics`).
- Demo insurance: `/check` preflight page, `/api/health/deep` (models, voice, database; cached 10 min).
- «Сегодня»: the lectures sit under a short exam card instead of leaving a hole; with a tall exam card they stay
  across the page as before (measured before paint).
- Voice tutor, server side only (no screen yet): `/api/tutor/session`, `/api/tutor/turn` over a chain of free model
  providers (Cerebras and Mistral when their keys are set, then Groq and Gemini).

Migrations applied before this release: `20261005042323_app_telemetry`, `20261005043821_shared_material_read`.
For the owner after this release: `supabase/pending/2026-10-05_drop_public_material_reads.sql`; new VAPID keys in the
Space settings; `keepalive.yml` on `main`.
Verified before release: tsc -b, Vitest 1784/1784, pytest 895, production build; browser pass on mocked Supabase/API
50/50 (kept screens 1440 light, removed addresses, Supabase way, statistics, share link, /check, /try, phone 390);
first-load measurements and 31 visual states unchanged against 126f700. Not verified: live providers and the live
network in Russia.

## 2026-10-04 — Voice that is heard, a mandatory first-run guide, the AI limit on the server, PRO window, /try, PPTX and scans (from 13afb7d)

Adds to 243f7c3 (tree of b9eab06). The owner's seven points of 2026-10-04: «Ответ голосом не работает (голос не
считывается)», «обучение сделать обязательным в первый раз», «странно очень вопрос первый в разговоре + почему-то не
сразу запускается разговор», «Проверь существует ли лимит на использование ИИ … как работает покупка про подписки …
рассчитай лимит», «не знаю к какой модели идет запрос», «кнопка попробовать на примере, добавь PPTX и распознавание
сканов, … первый запуск вокруг ядра».

- Voice: when the browser does not recognise speech (an error, or 7 s without a word — Chromium without Google keys stays
  silent), the answer is recorded in pieces cut at pauses and transcribed by the server (`POST /api/oral/transcribe`:
  Groq whisper-large-v3-turbo, Gemini as fallback; Whisper's phantom phrases are dropped). Text appears after each
  pause, «Готово» waits for the last piece, a level meter shows the microphone works. The privacy note says so.
- First run: a 5-item menu (Сегодня, Экзамены, Лекции, Повторение, Прогресс) with «+», «Первые шаги» on «Сегодня»,
  and the guide (6 chapters, spotlight) is mandatory on the first visit. Plain words: «Лекции», «Сверить с лекциями»,
  «Пункты ответа».
- Conversation: an opening plan of the lecture's topics instead of captions of later pictures; the sheet is the size
  of its picture; ▶ answers at once («Готовим голос…», a note when it is slow) and repeated presses do not cancel.
- AI limit on the server: units are charged before each model call with the user's token, FREE 100 / PRO 1000 a
  day, refunded when the model gives no result; a spent day answers 429 `ai_limit` and opens one dialog with «Что
  даёт PRO». `/api/health` names the last model that answered; every call is logged in `ai_calls`.
- Models: Gemini `gemini-2.5-flash-lite, gemini-3.1-flash-lite, gemini-2.5-flash`; Groq `openai/gpt-oss-120b` /
  `openai/gpt-oss-20b` (Llama 3.3 70B is retired). Space variables still win.
- PRO window: a film-style reel of what PRO changes, an honest «payment is not available yet», «Сообщить, когда
  появится» (`pro_interest`).
- «Попробовать на примере»: `/try`, a ready microeconomics exam without sign-up or API calls.
- Lectures: PPTX slide by slide; scanned PDFs (up to 60 pages) and photos recognised by Gemini.
- Also: gzip and a year of cache for hashed assets (nginx); the analysis screen no longer stays on «Готовим конспект…»;
  sign-in/sign-up reels show their first line on every loop; the review session has its page heading.

Migrations applied before this release: `20261004204007_pro_interest`, `20261004205613_ai_quota_server` (part 1).
Part 2, `supabase/pending/ai_quota_lockdown.sql` (client writes off `ai_usage`), waits for the owner.
Verified before release: tsc -b, Vitest 1736/1736, pytest 816, production build; browser QA on mocked Supabase/API:
64 route loads at 1440/390 in both themes (no page errors, no overflow, no «Библиотека/Разметить/эталон»), the limit
dialog and the PRO window, the PRO meter, the mandatory guide, voice through the server with and without Web Speech,
0 of 40 analysis stalls, the sign-in reel loop, the conversation sheet and loading, /try to the examiner.

## 2026-10-04 — Ticket: always a way to answer, by voice or text (from 91ba451)

Adds to 6a1339a (tree of e558107). The owner, with a screenshot of a ticket that said «Эталона нет — В лекциях этого
экзамена нет текста» and nothing else: «и что тут делать? ничего не появилось чтобы отвечать … а вдруг я захочу
отвечать вручную, а не голосом? продумай все».

- Voice and text are two equal choices on every ticket; the one used last time comes first.
- Without a reference (the question is not in the lectures, the exam has no lectures or no lecture text, the
  reference did not come together or did not come back) or with the day's checks spent, the student still answers —
  by voice or text — and is told first that there is nothing to check against. After «Готово»: «Ответ не
  проверялся», the reason, the answer itself and «Как вы ответили? знаю · плаваю · не знаю» (saved to the journal
  like the sheet's self-rating). No model, no grade, no charge. With the checks spent the reference's points open for
  comparison; for a question the lectures do not cover, their nearest fragments come back after the answer.
- «Добавить лекции» / «Выбрать лекции» right there lead to the exam's lectures.
- Backend: an exam without lectures says so («К экзамену не выбраны лекции», `no_lectures`), apart from lectures
  without text (`no_text`).

No migration. Verified before release: tsc -b, Vitest 1518/1518, pytest 703, production build; the ticket in
Chromium on mocked Supabase/API at 1440×900 and 390×844 in both themes — with a reference (the choice), without
lecture text (answer by text → «Ответ не проверялся» → «плаваю» saved), no horizontal overflow.

## 2026-10-04 — «Новый экзамен»: nothing pinned to the window (from 7ad65fe)

Adds to 091bd4e (tree of 4efc0fc). The owner, with a screenshot of the pinned foot over the lecture checklist:
«а блок который снизу он должен всегда быть привязан к экрану? Как-то неудобно». The form card now scrolls with the
page and ends with «Разметить по лекциям» after «Билеты»; scrolling over the lecture list goes on to the page at its
end. The phone's bottom bar stays. CSS only. Verified before release: Vitest of the exam pages and components,
production build; in Chromium at 1536×730, 1366×768 and 1911×912 — the first lecture row is not covered, the wheel
over the list reaches the button.

## 2026-10-04 — «Изменить экзамен» opened at the lectures shows their label (from c87a560)

Adds to 1146f1c (tree of 6a43ce0). From the exam sheet («9 лекций», «Добавить материал к вопросу») the editor
scrolled the lecture block under the fixed top bar, hiding «Лекции» and «Все 9 лекций»; a scroll margin keeps them in
sight. CSS only. Verified before release: Vitest of the exam pages and components (161/161), production build, the
editor at `#lectures` in Chromium at 1366×768 and 390×844.

## 2026-10-04 — «Новый экзамен»: the lecture checklist in sight (from 8228be2)

Adds to 4215c84 (tree of 1e9e039). The owner: «но выбрать лекцию как-будто тоже возможность должна быть, или как
ты считаешь? подумай». The choice existed, but as a folded line «Все 9 лекций · изменить» at the bottom of the
form — under the sticky button on a 1366×768 laptop, so it was not seen.

- «Лекции» right after the exam's title; the checklist is always open (subjects, search, «Выбрать все / Снять
  все»). Until the student changes the ticks, a line says why these are ticked.
- The note by «Разметить по лекциям» names how many lectures: «Meldy сверит каждый вопрос с 9 выбранными
  лекциями…».
- Step 1 says how many lectures the library has and that they are chosen on the next step.

No migration, no backend change. Verified before release: tsc -b, Vitest 1513/1513, production build; the editor
in Chromium on mocked Supabase/API with the real list parser at 1911×912, 1366×768 and 390×844 — the lectures
block under the title, the checklist reachable, the main button in view, no horizontal overflow.

## 2026-10-04 — «Новый экзамен»: the list first, a main button that always answers (from 3b990ea)

Adds to 26b932c (tree of 6f2826d). The owner, with a screenshot of «Новый экзамен» from release 14: «может
придумаешь как перестроить компоновку страницы получше? а то как-то не очень.» The first screen was an empty field
beside the whole form (title, tickets, lectures) with a switched-off blue button at the bottom of that form.

- Step 1 is the list alone: one wide card «Вставьте список вопросов» — a field that shows what a department's list
  looks like, «Распознать вопросы» and «Выбрать файл» right under it; on the side, quietly, what Meldy makes of the
  list and where to find it. Title, tickets and lectures come with step 2, filled from the list where it can be.
- No main button is dead: «Распознать вопросы» on an empty field puts the cursor into it and says what to do;
  «Разметить по лекциям» without a title takes the cursor to the title field (on a phone it is brought out from
  under the bottom bar), and with a line to fix it opens the list and goes to that line.
- The title's example reads «Например, Микроэкономика»; «Добавить лекции» is one line.

No migration, no backend change. Verified before release: tsc -b, Vitest 1514/1514, production build; the editor in
Chromium on mocked Supabase/API with the real list parser at 1911×912, 1366×768, 1024×768 and 390×844 — the main
button in view and answering in every state, no horizontal overflow; exam scenarios s24 (text and DOCX through
«Выбрать файл») and s28 (department tickets) pass, s25 maps 24/7/9 (its old 276/780 expectation is outdated).

## 2026-10-04 — «Экзамены»: the main button always works, one list field, exam cards (from 62f2d65)

Adds to 415c6f2 (tree of f67e6aa). The owner, with a screenshot of «Новый экзамен»: «кнопка не работает … как бы
ты улучшил расположение всего». The blue «Разметить по лекциям» stayed off until the list was recognised and said
nothing; the step it waited for was a grey button under the field, and on a 891 px window the card ran below the fold.

- «Новый экзамен»: steps «Список вопросов · Проверка и лекции · Разметка по лекциям». Before the list is recognised
  the main button is «Распознать вопросы»; with nothing to recognise the line under it says what to do. One field for
  the list — paste the text or drop the file (or «выберите файл») — instead of two tabs. On a computer the button
  sticks to the bottom of the window.
- «Экзамены»: a bar of the questions by their marks on each card and «Тянуть билет» right on it.
- Exam sheet: the struck «60 %» is labelled «вопросов».

No migration, no backend change. Verified before release: tsc -b, Vitest 1512/1512, production build; the exam
browser scenarios on mocked Supabase/API with the real list parser (text and DOCX, mapping, saved and failed mapping,
department tickets, «почему», self-rating); the editor at 1906×891, 1366×768, 1024×768 and 390×844 — the main
button in view in every state.

## 2026-10-04 — the landing reel without the stutter; sign-up reel labels (from c608015)

Adds to 7946413 (tree of 5a79743). Two remarks of the owner:

- «на главном экране там где основное видео, в момент перехода со 2 на 3-ю секунду видеоролика … подлагивает».
  Measured frame by frame in Chromium with traces. The burst scene redrew all its cards every frame (a blur that
  followed each card's speed, a scale that never stopped changing), the «≡» file mark fetched one more font file
  as the scene mounted and laid it out again mid-motion, the flash and the intro's rushing stack were repainted
  every frame, and the scene's mount fell on the intro's push-in. Now: cards, flash, camera and title are their own
  layers drawn once, the mark is an SVG, the scene mounts with the intro. Raster per frame in the scene 20–47 ms →
  0.5–7 ms, render passes 12–19 → 2–5; at 4× CPU throttling eleven long tasks in 2.6–3.6 s became one of 50 ms.
  The look is the same, except that the flying cards are no longer smeared by speed (the drain at the end still is).
- «на странице регистрации в видеоролике … вылазит текст в самом ролике "эластичность"». The week's blocks are
  152 px wide; a topic is now one short word and the count of cards goes on its own line.

No migration, no backend change. Verified before release: tsc -b, Vitest 1509/1509, production build; a sweep of
every reel and guide clip every 100 ms for text outside its plate (red on «Эластичность» before, green now); frames
of the burst before and after.

## 2026-10-04 — the guide: a clip detail (from 0e07701)

Adds to f234023 (tree of 97aa909). In the guide's «Сегодня» clip the drawn ticket «Билет 12 · вопросы 2 и 31» rose
over the row of dots; it now slides in beside «Тянуть билет». CSS and one line of the clip; no migration, no
backend change. Verified: frames of the clip, production build.

## 2026-10-04 — the guide, and every reel in the film style (from e66577f)

Adds to 59f805f (tree of 0801357). Two requests of the owner:

- «сделал помощника, который будет очень красиво с анимациями (точнее с суперкороткими видео …) обьяснять
  пользователю как и что работает, перебирая по вкладкам … (адаптируй это так, чтобы под телефоны тоже подошло)».
  The guide has eight chapters, one per section (Сегодня, Добавить лекцию, Библиотека, Повторение, Экзамены,
  Дневник ошибок, Карта знаний, Прогресс), each with a 6.4 s clip and a line or two in the screens' own words. A card
  in the corner on a computer, a sheet above the tabs on a phone. «Дальше» moves the app to the next section and
  lights it up in the top line or the tabs, but never away from a page with work in progress. It opens by itself once
  on «Сегодня» (remembered on the device and in the profile), then from «?» next to the account button and «Как
  пользоваться Meldy» in the account menu.
- With a reference promo: «мне не нравятся эти надписи по углам, только Meldy можно оставить, а также менее иишно …
  делай все видосы в вот таком стиле (я про регистрацию, логин и про будущие ролики)». The sign-in and sign-up reels
  are rebuilt in that style: real screens of Meldy in monochrome, heavy two-line statements, a slow camera with tilt,
  depth of field and motion blur, the yellow dot of the wordmark opening and closing each loop. No corner labels
  (only a small «Meldy»), no particles, rings, halftone or gradients. The guide's clips use the same kit.

No migration, no backend change (the guide writes `onboarding_status.guide` in the user's own profile row, a column
the client could already write).

Verified before release: tsc -b, Vitest 1509/1509 (new: the guide's chapters, auto-open, «Дальше», «?», focus and
Esc), production build; the guide end to end in Chromium at 1440×900, 1366×657, 1024×768 and 390×844 in both themes
(opens by itself, eight chapters, the right section lit up, no overflow, no console errors); the top line measured
at 1024–1440 px with «?»; frames of both reels and all eight clips; MP4s of both reels and of the clips.

## 2026-10-04 — sign-in and sign-up: a short reel under the panel heading (from f1b01b9)

Adds to 570163b (tree of e35de71). The owner, on the release-9 panels: «мне не нравится что карточка эта сама по
себе не по центру, слишком большое расстояние от нее до текста, да и в целом анимацию покруче можно было сделать и в
виде видоса (как ты делал для главного экрана) но похожий но чуть другой».

- The window of the panel is now a 16-second silent reel on the engine of the landing reel (headlines that type and
  blur in, the corner labels with the chapter and the timecode, a cursor, particles, circle and rising wipes).
  Sign-in, «Как работает Meldy»: a lecture uploads → a marker finds the main line and a note with «фрагмент 3»
  slides out → on blue, a card flips, gets «Помню» and its next dates → on dark, «Вспоминайте, а не
  перечитывайте.» and the wordmark. Sign-up: the materials of a course fall into one dot → the dot opens into the
  plan and its four parts tick to «План готов» → the days up to next Monday, a card hopping to tomorrow and then a
  week ahead → a ticket and «К экзамену — с планом.». The repeat dates are the real schedule of «Помню» (SM-2 in
  `review_flashcard`: 1 day, then 6 more, then about 16 more): «завтра · через неделю · через 3 недели».
- The frame takes the room under the heading in 16:9 and stands right under it; the heading and the frame are
  centred together in the panel.
- A pause button; with reduced motion a still frame and «Смотреть ролик»; a hidden tab pauses it; below 1024 px
  (the panel is a banner) there is no reel. Screen readers get a caption and the steps as a list.

No migration, no backend change.

Verified before release: tsc -b, Vitest 1502/1502, production build; screenshots of sign-in and sign-up at
1534×732, 1440×800, 1366×657, 1280×720, 1920×1080, 1024×768 and 390×844 in both themes (the form fits as in
release 9, no overflow, no console errors, contrast ≥ 4.5:1); reduced-motion still frames; both loops exported
frame by frame to MP4 and the scene seams checked.

Retry: the first run stopped at fetching the Space (the HF git server broke the fetch negotiation in both protocol
versions; reproduced outside GitHub). The workflow now fetches with `fetch.negotiationAlgorithm=noop`.

## 2026-10-04 — sign-in and sign-up fit the screen and stay alive (from e538623)

Adds to 0c13253 (tree of 972453b). The owner, on /login and /register at ~1534×732: «не все помещается, да и
анимаций нет никаких постоянных во время нахождения на этой странице, регистрация тем более».

- Fit: spacing follows the screen height; «Забыли пароль?» sits on the password label row; the password and its
  repeat stand side by side; the panel follows the card. The whole form fits at 1534×732, 1440×800, 1366×657,
  1280×720, 1024×768 (before: 931 px of sign-in and 1043 px of sign-up on a 732 px screen).
- Motion: the sign-in panel loops three scenes (a lecture uploads; a marker underlines the main line and a note with
  «фрагмент 3» slides out; a card flips and gets «Помню») with the matching step lit; the sign-up panel ticks the
  four parts of the plan up to «План готов». The halftone of every sign-in panel drifts slowly. Reduced motion keeps
  everything still.

No migration, no backend change.

Verified before release: tsc -b, Vitest 1496/1496, production build; screenshots of sign-in, sign-up and password
reset at several sizes in both themes (no overflow, no console errors, contrast ≥ 4.5:1); frames over a cycle.

## 2026-10-04 — blocks centred everywhere, the start page always fresh (from 790bc66)

Adds to 3059a5c (tree of 4bdfffa). Two answers to the owner:

- «нет ли таких проблем с другими разделами?» — the same left-hugging column (1040 px inside the 1304 px page
  column) was on the library, the exams list (a single exam took half a row), the profile, the pricing plans, the
  knowledge map as a list, and the empty states of «Кратко», «Разговор» and «Экзамены». Blocks now span the page
  column like the top bar; a single or odd last exam takes the whole row; the study deck is centred.
- «почему не обновился основной экран?» — the service worker answered «/» from its precached copy of index.html
  (the precache route was registered first), so the start page showed the release the browser had cached while inner
  pages were new. Pages now come from the network first; offline shows «Нет подключения». Browsers that still run
  the old worker get the new one on their next visit; one more reload (or Ctrl+F5) shows the new start page.

No migration, no backend change.

Verified before release: Vitest 1492/1492, production build; width audit of 24 states at 1532/1920 px; sweep of the
changed screens at 1440/1024/390 in both themes (no overflow, no console errors, contrast ≥ 4.5:1); two releases on
one origin in Chromium — «/» shows the new one on the first visit, offline shows «Нет подключения».

## 2026-10-04 — «Прогресс»: blocks centred (from 1f3a4d8)

Adds to c1ba79e (tree of 0bee6cf). The owner, on the live page: the blocks hugged the left with an empty strip on the
right — «надписи оставить как есть, а блоки и снизу то что под ними центрировать». The tiles, sections and «Как
считается» now span the page column like the top bar: their left edge meets the logo and the title, their right edge
the account button and «Оценки из зачётки». Headings, phone and tablet layouts are unchanged. CSS only; no
migration, no backend change.

Verified before release: production build; Playwright screenshots at 1024, 1440, 1532 and 1920 px — no overflow,
no console errors, text contrast ≥ 4.5:1.

## 2026-10-04 — «Прогресс» reworked (from 1d4fff5)

Adds to 6cd8316 (tree of 4ea342b). The owner: «может стоит переработать этот раздел "Прогресс" … читать тяжело и не
сильно понятно, да и не функционально» and «я разрешаю полностью переработать эту страницу». The page now answers three
questions, and every block has one action:

- Three tiles at the top:
  - «Карточки»: закреплены / учатся / новые;
  - «Вспомнили»: the share of «Помню» and «С трудом» answers from the journal, shown from 10 answers;
  - «Повторения на неделю»: by the cards' schedule, with «Повторить».
- «Что подтянуть», each line with one button:
  - lectures recalled under 70 %;
  - open mistakes;
  - cards that never reached review («Добавить»);
  - exam questions found in no lecture;
  - untaken tests, as one line.
- Exams as before. Each lecture is a row: test and mistakes, card states, its recall, and one next step («Повторить N»,
  «В повторение», «Пройти тест», or the date of the next review). Text-only lectures are folded away.
- New links: `/review?material=<id>` and `/library/<id>?section=quiz` (the material opens on its test tab).
- The answer journal starts on 2026-10-03, so until 30 days fit after it the share says «с 3 октября», and
  «Как считается» explains it.

No migration and no backend change; the page reads the same tables as before.

Verified before release: tsc -b and Vitest 1492/1492, production build, Playwright screenshots of «Прогресс» on
three data sets (like the owner's account, a rich one, an empty one) at 1440/390 in both themes — no overflow, no
console errors, text contrast ≥ 4.5:1 — and the «Пройти тест» and «Повторить N» links in the browser. Not verified:
the owner's live data on this page.

## 2026-10-04 — the whole site in the new language (from bc3e70b)

Adds to 0a11c46 (tree of 31e3694). The owner approved the new visual language («адаптируй полностью весь сайт
далее под нужный дизайн»), and every screen now uses it: light canvas, deep ink, one blue accent with yellow, green
and pink, Onest only, large rounded cards, pill buttons with a circle arrow, status pills, halftone panels, and a
dark theme.

- New landing around the reel (hero with the exam/credit/colloquium toggle, ticker, «how it works» cards that
  jump to the reel's chapters, method, final call).
- «Сегодня», «Добавить лекцию», library, material page (summary, cards, test, «Разговор»), shared material,
  exams, the draw and the oral answer with its protocol, review, mistakes, progress, gradebook, the knowledge map
  (now set in Onest), sign-in, profile and pricing. Hidden secondary screens are restyled through a scoped
  stylesheet.
- Shared pieces: browser bar colour, app icon, update toast, «Нет подключения» page.
- Fixes found on the way:
  - the offline page never opened (wrong cache key) and its button was blocked by the CSP;
  - phone tabs were cut off;
  - the top bar overlapped at 1024 px;
  - focus rings squared off rounded elements;
  - dark-theme blue text was 3.2–3.8:1;
  - «Удалить предмет» did nothing in a subject's view;
  - the shorts player showed a made-up like counter.

No data or behaviour changes beyond these fixes; no migration; backend unchanged since 31e3694.

Verified before release on bc3e70b:
- tsc -b, Vitest 1471/1471 (95 files);
- production build (no Literata font files left in the assets);
- browser sweep of 30 routes at 1440 and 390 in both themes on mocked Supabase/API: no horizontal overflow, no
  text below 4.5:1 (3:1 for large text). The only console errors are /career's mock 406/404 on an empty career
  profile.
- Offline fallback checked in Chromium with the built service worker.

## 2026-10-04 — the motion reel on the landing (from d1b7c8e)

Adds to b07ade9: «Meldy за 35 секунд» under the hero — a code-built motion reel in the new style (chapters
Билеты, Ответ вслух, Повторение, Готовность), muted, plays only while on screen, chapter bar under it, still frame
under reduced motion. Lazy chunk, no new dependencies, no data read.

Verified before release: tsc -b, Vitest 1545/1545 (100 files), production build; the landing at 1440 and 390 in
both themes without horizontal overflow; 175 frames of the reel reviewed (5 per second).

## 2026-10-04 — knowledge map back in the menu (from ce131a8)

Adds to 827588d: «Карта знаний» returns — lecture cards in course order with the concepts they share, readiness
marks on question numbers, a paper panel with fragments and mistakes, a list view (default on phones). In the top bar
from 1280 px, otherwise in the account menu.

Verified before release: tsc -b and Vitest 1525/1525 on the release tree; map screenshots at 1440 and 390 in both
themes on mocked Supabase (no overflow, no console errors). Data is read only: no migration.

## 2026-10-04 — owner fixes and jury fixes (from 7f6ab03 + review leftovers)

First attempt (run 4) stopped before pushing: `git fetch` from the Space failed on the runner's git 2.55 protocol v2
("expected 'acknowledgments'"); the workflow now fetches with protocol v1. The live Space was not touched.
Also in this release: a spoken «не знаю» keeps the grade cap, the protocol stamp lands only after the save, the why
panel keeps a fragment's heading on its own line (Vitest 1485/1485 and tsc -b on the exact tree).

Replaces 77d43d8 (tree of e366fa7). Includes the jury fixes `1c1bd10` (confirmation rule, grade cap, honest
sheet, «Сегодня», landing) and the owner's six live-site issues except the knowledge map, which follows separately:

- Readable lecture titles instead of file names (review card no longer overflows).
- Paper dropdowns and subject suggestions instead of native `<select>`/`<datalist>`.
- Lecture picker: select all / none, search, subject groups, scrolling list.
- Material summary uses the width: the lecture fragment of the section being read on the right margin, outline;
  `[S01, S02]` marks become fragment links.
- «Разговор» audio: server retries and clip cache, Max's voice never switches to the browser voice, no markdown
  in lines.

Database: migration `20261004054539_jury_trust_reads` was applied on 2026-10-04 (restrictive reads; the old client
keeps working).

Verified before release: tsc -b and Vitest 1482/1482 on the exact release tree, pytest 703, production build,
browser smoke of the main pages at 1440 dark and 390 light on mocked Supabase/API, screenshots of the changed
screens. Not verified: live edge-tts timing and live AI providers — check right after the release.

## 2026-10-04 — Meldy for the hackathon (from e366fa7)

Replaces the live version f3b94ba (2026-09-24, still branded StudyForge).

- Meldy name everywhere, secondary features out of the menu, dead code removed.
- New landing «Строчка → карточка»; paper-desk top bar and screens.
- «Разговор»: two hosts with synced diagrams, charts and terms.
- Analysis always ends (full, partial with «Создать заново», or a readable error); nothing is saved or charged
  without a core section; paste-text input; no made-up grades; models and timeouts from env.
- Answer journal (`learning_events`), quiz results and mistakes saved, honest «Прогресс».
- «Билеты»: question list mapped to the student's lectures, share of tickets, «Тянуть билет».
- «Ответ вслух»: spoken answer, code-verified quotes, follow-up on the missed point, protocol.

Database: migration `20261003083154_hackathon_journal_exams_oral` was applied on 2026-10-03 (additive; the old
client keeps working).

Verified before release: tsc -b, Vitest 1169/1169, pytest 681, production build, isolated frontend build as in
the Docker image, three rounds of browser QA on mocked Supabase/API. Not verified: live AI providers and real
speech recognition (no keys in the build environment) — check right after the release.
