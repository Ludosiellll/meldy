# Hugging Face releases

Each change to this file on `claude/relaxed-hypatia-1tpmq5` runs `.github/workflows/deploy-hf.yml`:
the live Space `main` is tagged `hf-backup-<UTC>-pre-push`, then the released tree (without `qa-screens/`)
is pushed on top of it, and the job waits for `RUNNING` and checks `/` and `/api/health`.

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
