# Hugging Face releases

Each change to this file on `claude/relaxed-hypatia-1tpmq5` runs `.github/workflows/deploy-hf.yml`:
the live Space `main` is tagged `hf-backup-<UTC>-pre-push`, then the released tree (without `qa-screens/`)
is pushed on top of it, and the job waits for `RUNNING` and checks `/` and `/api/health`.

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
