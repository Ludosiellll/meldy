# Hugging Face releases

Each change to this file on `claude/relaxed-hypatia-1tpmq5` runs `.github/workflows/deploy-hf.yml`:
the live Space `main` is tagged `hf-backup-<UTC>-pre-push`, then the released tree (without `qa-screens/`)
is pushed on top of it, and the job waits for `RUNNING` and checks `/` and `/api/health`.

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
