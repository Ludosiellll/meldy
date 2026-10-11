# Meldy · CodingFest-11 — the deck's design plan (v2)

The deck is one argument told in Meldy's own interface language. That language is a warm canvas, white cards, ink
type, one blue action and the yellow dot. The deck has to work twice. First an expert reads the PPTX alone, then it
runs behind a 7-minute talk. So **every slide is complete as a still** (PDF, Normal view, LibreOffice), and motion
only adds.

Round 2 moved the deck from «good PowerPoint» to a stage:
* one hero per slide at a size nothing else on it comes near;
* two dark stage slides in the app's own dark theme;
* long, choreographed Morph moments;
* builds that repeat the product's own mechanics.

Sources of truth:
* `CONTRACT.md` — the markup, the tokens and the scale;
* meldy-notes `10_Project/CodingFest_11_Deck_Script.md` — the words and the talk;
* meldy-notes `40_Decisions/2026-10-10_deck-direction.md` — B + A + C, and round 2;
* `reference/board.html` — the approved look.

## 1. Grid, scale and light

- **Slide** 1920 × 1080 px.
  * Margins: 128 left and right; the header band at y 56; the bottom margin 56.
  * 12 columns of 102 px with 40 px gutters; column *k* starts at x = 128 + 142·k.
  * Rows: header y 56, label y 128, claim y 192 (two lines end at 352; a statement ends at 400), evidence y 424–952,
    reading layer y 984.
  * Product devices run from y 392 to 1008; the phone from y 112.
- **One hero per slide** (Onest static 400/500/600/700, embedded):

  | Element | Size |
  |---|---|
  | wordmark «Meldy.» (01, 15) | 300 px |
  | hero numbers («229 тыс.» on 03, the «0» on 04) | 360–420 px |
  | the statement on 05 | 96 px |
  | claims (two lines at most, explicit `<br>`) | 72 px |
  | the title's line on 01 (makes room for the larger cover card) | 64 px |
  | steps and lists | 44–48 px |
  | labels (caps, +0.12 em) | 40 px |
  | reading layer | 32 px |
  | sources | 28 px |

  **Nothing under 28 px.** At most about 35 words outside the reading layer, except on the list slides 02, 13 and
  14. The lint checks all of it.
- **Light and dark.**
  * Every slide is the light paper: canvas `#F3F3F0`, white cards, ink `#0B121C`.
  * Two stage slides, `<main class="slide dark">`, use the app's dark theme token for token: 05 «Новизна» (the
    manifesto) and 12 «Тестирование, продвижение и масштабируемость» (the jury's criteria; round 7 merged the old 11
    and 12 and dropped the night field). The tokens are canvas `#0B0F16`, surface `#141A24`,
    surface-soft `#1B2230`, ink `#F3F3F0`, muted `#A7ADB7`, line `#262E3B`, labels `#8DB2F5`, and the same yellow.
  * The tokens switch in `deck.css`, so the strip, the corner wordmark, the rules and the panels follow.
  * Every bake is one flat canvas. A Morph between a light and a dark slide crossfades the two, and the strip and
    the wordmark change colour with it: the lights go down and come back up.
- **Surfaces.**
  * Cards are empty native rounded rectangles: radius 48, devices 36–52.
  * A card that builds or travels carries its own shadow (`.lift`). The compiler writes it as the object's native
    PowerPoint shadow, so it builds with the card and travels and scales with it under Morph: no shadow ever waits
    alone or stays behind. `data-shadow="bake"` keeps a shadow in the object's layer picture instead (for a small
    box with a strong negative spread, which LibreOffice draws as a hard band).
  * The devices on 07–11 are ink bezels (`#0B121C`). The screen is the video inside them, its corners painted ink.

## 2. The deck-wide system

- **The strip, «шпаргалка этой защиты»** (B).
  * Ten 22 px squares `!!s01…!!s10`, written by `design/stamp.mjs` from `design/deck.mjs`. No counter (the owner,
    draft 3): the squares say it.
  * The current section is yellow, a passed one an outline, a coming one ink (light on the dark slides): the
    cheat sheet's three states.
  * **01 has no strip.** The ten squares are *seeds*: invisible 8 px rounds in a row inside the wordmark's dot,
    already in their colour on 02 at 1 % alpha.
  * On 02 the strip **unrolls out of the dot**: each seed only moves, grows and comes up to colour, so Morph mixes
    nothing. The speaker explains it once (02's notes); no line on the slide.
  * «Представление блоков проекта» is one square (07) for its five slides, 07–11. The own slide 12 shows a small
    yellow dot `!!sx` in the gap after square 07.
  * On 15 the strip **collapses** back into the dot: the squares fly into it and fade away as seeds. Then one line
    builds in under the wordmark: «Шпаргалка этой защиты пуста».
  * The header band (strip, corner) is the **last layer** of every slide, so in a Morph its squares and the
    dot fly over everything.
- **The dot** `!!dot` (C) travels the whole deck:

  | Slide | What the dot is |
  |---|---|
  | 01 | the big wordmark's dot (84 px) |
  | 02–05 | the corner wordmark's dot |
  | 06 | the first bullet of the lecture's five materials («Конспект», the left half since round 7), in ink like the others: it came down from the corner |
  | 07 | the laptop's ink bezel, 1184 × 600 (the lectures) |
  | 08 | the same laptop, the same box: it holds still and only the screen changes (the exam and the plan) |
  | 09 | the phone, 424 × 880 |
  | 10 | the laptop again |
  | 11 | the chat, 704 × 704 |
  | 12 | — the chain ends on 11: the chat fades out while its «Пригласить группу» button travels into 12's path (`!!pill`), under «Группа»; the lights go down; the corner dot is `!!x12dot` |
  | 13–14 | the corner dot (it fades in in place as the lights come up) |
  | 15 | the big dot, with the strip collapsing into it |

  The chain is **ink from 06 to 11**, so the dot never turns olive while it grows into a bezel or shrinks back: the
  only yellow ↔ ink change is a small dot, 05→06 (the corner dot lands as the first material's bullet). Every
  morphing dot has a radius of half its size less one pixel. It looks like a circle, but the compiler writes a
  rounded rectangle at both ends of the Morph, never an ellipse (a radius within half a pixel of the half becomes an
  ellipse). The corner wordmark `!!word` shrinks out of the big one on 02, leaves on 06–11, fades back in on 12 and
  grows back on 15.
- **The screens** on 07–11 are `!!clip`: they ride with the bezel and crossfade their content. 07's clip has an
  entrance: the dot grows into a dark bezel, then the screen turns on. 07→08 keeps the frame, so the lecture's
  screen crossfades into the exam's in place.
- **Titles** are all `!!title` (the compiler's name), so the label crossfades in place from slide to slide. Labels
  never have an entrance of their own after 01.
- **Other pairs**: `!!num` turns «229 тыс.» into the «0» (03→04); `!!c1`/`!!c2` name the author cards and the QR
  card; `!!pill`/`!!pillt` carry the «Пригласить группу» button from 11 into 12's path.
- **No automatic Morph matches.** Built objects that PowerPoint could pair with an object of the previous slide
  (identical bullets, numbers, arrows, chips) carry unique `!!x…` names. The morph-log shows 0 automatic pairs.

## 3. Motion

**Transitions** (`data-transition-dur`):

| Change | Moment | Duration |
|---|---|---|
| → 01 | Fade from black | 1.0 s |
| 01→02 | **M1** the cheat sheet of this defence is born from the dot | 1.5 s |
| 02→03 | Morph | 0.9 s |
| 03→04 | **M2** «229 тыс.» becomes «0» | 1.4 s |
| 04→05, 05→06 | **M3** lights down, lights up (06: the corner dot lands on the lecture's first material) | 1.5 s |
| 06→07 | **M4** the dot grows into the laptop, then the lecture's screen turns on | 1.5 s |
| 07→08 | the same laptop holds still; only its screen crossfades, lecture → exam | 1.3 s |
| 08→09→10→11 | the device chain: laptop → phone → laptop → chat | 1.3 s |
| 11→12 | **M5** lights down: the chat fades out, its «Пригласить группу» button travels into 12's path | 1.5 s |
| 12→13 | **M5** lights up | 1.5 s |
| 13→14 | Morph | 0.9 s |
| 14→15 | **M6** the strip collapses into the dot, then «Шпаргалка этой защиты пуста» builds in | 1.6 s |

**Builds.**
* Each slide's entrances run as one automatic group of 1.4–2.9 s: the first effect starts it, every other comes
  «with» it at its beat (`design/preview/timeline.mjs` prints the schedule and flags anything over 3.5 s).
* The slides with a clip (07–10) are the exception: their steps come in on the clip's own moments, so the build
  is as long as the story. The clips loop; the steps meet their moments on the first pass, then stay.
* Clicks: only 03's punchline («229 тыс.» settles in).
* Effects: `settle` (fade + 92 → 100 %) for things that land, `rise` for claims and titles, `wipe` from the left for
  lines being written, rows and strikes, `fade` for small type. Entrance effects only; objects that morph never build.

**The product's mechanics, with native objects:**

| Slide | Build |
|---|---|
| 01 | the dot and its hidden squares settle together |
| 04 | the erased map sweeps in from the left; five tasks rise one after another, the lectures first |
| 05 | rows wipe in one by one, then Meldy's yellow ticks cascade |
| 06 | the lecture first: its tabs settle like the app's, then its tree is drawn down from «Лекция» and each branch shoots out to a material as it passes (the last, blue branch is the answer aloud); the exam's five blocks are written in like cheat-sheet lines as the tree finishes |
| 11 | six copies of one exam settle one after another |
| 12 | the number settles, its parts fade in; the path is written left to right, each step wiping in after its arrow (a rise would pass through the pill that is already there) |
| 15 | the QR card settles in last |

**Clips** are pure functions of time (`window.__clip = { T, seek }`), rendered frame by frame (`motion/render.mjs`):
H.264 High, yuv420p, BT.709 tags, `+faststart`, no audio, posters at 2×.

| Clip | Slide | What it shows | Poster | File |
|---|---|---|---|---|
| `title-cover` | 01 | The cheat sheet of «Рыночное равновесие» answers itself. Monday names the lines (yellow dots), Tuesday erases them (strike left to right), the counter rolls 6 → 0, the lines come back. 9.6 s loop. **The GIF carries its own card and shadow** (720 × 896 card in an 832 × 984 frame, 1:1), so it settles in. | first frame | GIF 388 KB (10 fps, 64 colours) |
| `scale` | — | **Unused since round 7** (the old 12's night field; the merged 12 keeps its numbers as text). The night field, one pull-back: a line → its question → an exam of 400 → a group of 25 → 9 160 dots, one per group, «ваша группа» in yellow. 11 s. | the field | MP4 ≈ 1.05 MB (x264 zones) |
| `telegram` | 11 | The app's own Telegram tip clip from the harness: the day card, «Начать», a question, «Верно.», the menu button «Открыть Meldy» (release 43). The loop begins on the poster's moment. | the day card | MP4 ≈ 280 KB, 672 × 672 |

**Recordings** of the live site (`tools/record`: a take is a real session in Chromium, `edit.py` cuts it into a
master, `fit.py` fits the master to a screen). They are committed in `media/product/`, with the masters and their
moments in `media/product/masters/` (they cannot be regenerated).

| Clip | Slide | What it shows | Poster | File |
|---|---|---|---|---|
| `lecture-placeholder` | 07 | **PLACEHOLDER** until `lecture-materials` lands: a still of the live site's «Разобрать лекцию» (step 1 «Что разобрать», the four tabs with «Аудио и видео» chosen, MP4 · MP3 · WAV · MPEG · M4A, «до 15 МБ»), captured by the recording agent on 2026-10-11, as a 6 s static clip. | the still | MP4 33 KB + JPEG 138 KB (an upscale), 1152 × 568 |
| `lecture-materials` | 07 | (coming) A lecture video («Рыночное равновесие», our text, synthetic voice) → «Аудио и видео» → the five materials ticked → конспект, карточки, тест, выжимка, подкаст. Its moments come in `lecture-moments.json`. | — | 1152 × 568, the same screen as 08 |
| `07-exam-plan` | 08 | «Новый экзамен», the file «Программирование на C#.docx», «Нашли 240 вопросов · ключ жирным», 2 ноября and 45 minutes a day, «Сохранить»; the exam's page with «Сегодня 52 вопроса», «План по дням». 19.8 s loop. | the exam's page | MP4 433 KB + JPEG 227 KB, 1152 × 568 |
| `08-oral-answer` | 09 | On the phone: a ticket of «Базы данных», an answer aloud to question 18, the examiner's question about the missed point, the protocol with the lecture's quotes. 18.9 s loop, begun on the poster's moment (16.2 s): the tap on the missed point first, the story from 2.7 s. | the protocol | MP4 903 KB + JPEG 223 KB, 392 × 848 |
| `09-sheet-erase` | 10 | The site's example exam «Микроэкономика», where «yesterday's» answers are part of the example: the answer to question 5, the protocol, the sheet strikes three lines out, 47 → 44. 13.8 s loop, begun on the poster's moment (13.2 s): the story from 0.63 s. | the sheet after the erase | MP4 1.16 MB + JPEG 366 KB, 1152 × 568 |

Honest by construction: a real session, the pointer drawn where it was, waiting cut out (the cuts are visible: the
timer jumps), nothing sped up. 08's voice is synthetic speech fed to the browser's microphone, and the clip has no
sound. The talk claims only what the clips show (each slide's notes end with «О записи»).

The recordings keep the numbers of the slides they were first made for (`07-exam-plan` is on slide 08 since round 7,
`08-oral-answer` on 09, `09-sheet-erase` on 10): they are names of takes, and the recording tools refer to them.

A screen that rides into its slide under Morph (08, 09, 10, 11) shows its poster during the transition, and the
video takes over from its first frame when the slide lands. So those loops begin on their posters' moments
(`fit.py --start`, `loopmask.py --start`): no jump when the clip starts. 08's loop has begun on its poster since
the re-cut (its first frame is the poster: mean difference 2.7 grey levels), so it lost its entrance in round 7 and
its steps are timed in plain clip seconds. 07's screen fades in with the clip playing from its first frame, so
`lecture-materials` needs no `--start`; its poster is only the still (PDF, Normal view, LibreOffice), so it should be
the most telling moment: the five materials ticked, or the finished lecture.

The drawn clip `motion/sheet.html` is **unused** since the recordings (kept as 09's fallback, not rendered for the
deck); the placeholders `ph-07`/`ph-08` are gone.

## 4. The slides

Eye order is what the eye takes first, second and third in the still.

| # | Label | Hero | Eye order | Build (after the transition) |
|---|---|---|---|---|
| 01 | Титульный | «Meldy.» 300 px | wordmark → «ИИ не отвечает за студента — он его спрашивает» → the cover card (GIF) → «Тренажёр экзамена по вопросам кафедры» → nomination, QR, «CodingFest-11» | label · wordmark rises · dot and squares settle · thesis · tagline · card settles · nomination and QR (2.25 s); «F5» is a note to the presenter |
| 02 | Автор проекта | two author cards | initials avatars → names → roles → institution → region | cards · avatars, names · institution · region (2.0 s); the strip is explained in the notes |
| 03 | Актуальность | «229 тыс.» | claim → the № 319 card (the attestation rules of higher education, by full name) → on a click «229 тыс.» | claim · card · № 319 · title; *click* 229 тыс. (1.4 + 0.9 s) |
| 04 | Цель, задачи | «0» 420 px | «0 строк осталось» → the erased map → five tasks, the lectures first («Лекции → конспект, карточки, тест», «Экзамен из перечня», «План по дням», «Проверка ответов», «Видно, что осталось») | caption · map sweeps · tasks 1–5 (2.1 s) |
| 05 | Новизна (dark) | the statement | statement → the table, Meldy's column raised with yellow ticks | the lights are down; the statement rises · header · five rows · ticks cascade (2.8 s); what «частично» means and the review's date are in the notes |
| 06 | Содержание | the two halves, the lecture first | claim («Meldy делает из лекций конспект, карточки и тест, а из перечня вопросов — экзамен») → the format line (web app for a phone and a computer, bot in Telegram) → «Лекция» (left, «слайд 7»): the four tabs of «Разобрать лекцию» with the app's icons; PDF, DOCX, PPTX, photo, MP4, MP3, a link to a page; a tree into the five materials of «Что сделать из лекции», in the app's words; its sixth, blue line: the answer aloud, checked against the lectures (slide 9) → «Экзамен» (right): Word, Excel, TXT, PDF; up to 2000 questions, test and oral; the five blocks as cheat-sheet lines with the slides of each (8; 8; 8 и 11; 9 и 10; 11) | claim · format line · the lecture's head and tabs · its tree drawn down, its lines written in as it passes · the exam's head and chips · its lines written in (2.74 s) |
| 07 | Представление блоков проекта | the laptop | claim («Лекция — файл, фото, ссылка или видео — становится конспектом, карточками и тестом») → the recording (PLACEHOLDER: the live «Разобрать лекцию» with «Аудио и видео» chosen) → what it shows, large: «Аудио и видео» — «Запись лекции — файлом до 15 МБ»; «Что сделать из лекции» — «Конспект, карточки, тест, выжимка, подкаст»; then, in the answer aloud's blue, «Ответ вслух» — «Из этих же лекций — пункты ответа и цитаты для проверки, слайд 9» | the screen turns on · claim · each moment as the clip reaches it (PLACEHOLDER moments 2.0, 6.0, 12.0 s + the entrance's 150 ms; set from `lecture-moments.json`) |
| 08 | Представление блоков проекта | the laptop (07's frame) | claim → the recording → what it shows, large: «Нашли 240 вопросов и ключ — жирным в файле», «2 ноября, 45 минут в день», «Сегодня 52 вопроса, около 45 минут» | the screen crossfades in place · claim · each moment as the clip reaches it (found 9.0, date 13.5 and 15.4, 45 minutes 19.2, plan 22.3 s: clip seconds, no entrance since round 7) |
| 09 | Представление блоков проекта | the phone | claim → the recording → what it shows, large: the answer becomes text, the examiner's question «В чём разница между неповторяющимся и фантомным чтением?», «Сами назвали 2 из 3 главных пунктов», the lecture's quote | the screen rides in with the bezel · claim · each moment as the clip reaches it (speak 8.8, asked 17.4, protocol 19.6, quote 23.0 s) · the reading line (23.7 s) |
| 10 | Представление блоков проекта | the laptop with the sheet | claim → the recording → «47 → 44», «3 строки стёрты: названы в разные дни» → the sheet's own key (осталось · названо один раз · стёрто) | claim · the key as the clip reaches the sheet (2.2 s; «стёрто» 18.2 s) · the counter and the erased lines with the erase (20.0 s) |
| 11 | Представление блоков проекта | the chat | claim → the chat → «Пригласить группу» → six copies → Telegram | claim · group · copies cascade · Telegram (2.35 s) |
| 12 | Тестирование, продвижение и масштабируемость (dark) | «6 566» 180 px | claim («Каждый выпуск проверяют автотесты, потом — живой сайт») → «6 566 автотестов» and its parts (4 415 сайт · Vitest, 1 832 сервер · pytest, 319 бот) → «≈ 229 тыс.» студентов вузов — 9 160 групп по 25, «Тестовые вопросы проверяются без ИИ и ничего не стоят», the source → the path: Группа («Пригласить группу», from 11) → Кафедра (отчёт для преподавателя) → Колледжи и вузы (лицензия для учреждения) → the reading line: release № 43, the open example | the lights are down; the claim rises · the number settles · its parts · the scale · the path left to right · the reading line (2.75 s) |
| 13 | Используемые источники | — | the formal list (normative documents and statistics; research), typography only → «Документация» as tiles: each resource's own mark in ink (simple-icons; Groq a wordmark), its name, its short address | claim · entries fade · tiles one by one (2.1 s) |
| 14 | Технические требования | — | the requirements → the stack by layer | claim · two columns · reading line (2.1 s) |
| 15 | Заключение | «Meldy.» 300 px | the wordmark with the strip collapsed into its dot → «Шпаргалка этой защиты пуста» → recommendations (students: the whole semester — конспект, карточки, тест; before the session — the exam; teachers: the exam for the whole group) → monetisation → the QR card | the line · lists written in · QR card settles last (3.0 s) |

## 5. Placeholders (to fill or replace before the file is sent)

* 02: names, initials and groups come from `deck/cf11/private/fill.json` (git-ignored): `author1.name`,
  `author1.role`, `author1.initials`, the same for `author2`.
* 07: the recording. Until `lecture-materials.mp4` lands the screen is `lecture-placeholder` (a still of the live page as
  a static clip); the swap is one edit in `07-lectures.html` («lecture-placeholder» → «lecture-materials» in the
  video's line, and its aria-label), then the placeholder files go. The three moments (2.0, 6.0, 12.0 s) are
  placeholders to set from `lecture-moments.json`, and the captions are to be checked against what the clip shows;
  the notes' «О записи» is marked «[сверить с роликом…]».
* 12: the test counts are recounted on the freeze day (6 566 = 4 415 + 1 832 + 319, the full runs of 2026-10-11);
  «перед каждым выпуском» only once a CI gate runs all three suites. The pilot — only if real numbers arrive by 21.10;
  nothing on the slide or in the notes until then.
* 13: the BELTA note's address and the access date.
* In the notes: «[Имена называет докладчик.]» (02), «[сверить с роликом, когда он будет готов]» (07), the conditional
  last sentence of 15.

Placeholders in the sources are faint, in brackets and framed with a dashed outline. The private fill replaces its
own text at build time.

## 6. Notes for the compiler (what this markup relies on)

- `settle`, `data-anim-dir`, `data-morph`, `data-fill`, bleed cropping and the Morph lint come from the compiler of
  round 2.
- `data-play`: `with` (the compiler's default since round 2) starts a clip with its entrance, or with the slide
  when it has none, so «with» builds at the clip's moments run alongside it (07–10's steps; first checked frame by
  frame on round 2's ladder).
- Cards that build or move carry `box-shadow` on the marked shape (`.lift`). The compiler writes it as a native
  outer shadow (one layer: `0 40px 80px -48px`), which builds, travels and scales with the shape (tools/README.md,
  Shadows and note 21); `compare.py` measures each one against the HTML. Static cards keep a separate `.shadow`
  element, baked into the background.
- The bake of every slide is a flat canvas (`shoot.mjs --bg`); everything visible is a native object or a picture.

## 7. Tools

```
node deck/cf11/design/stamp.mjs                      # the header band (strip, corner; 15's line) into every slide
node deck/cf11/design/preview/shoot.mjs [NN…] [--build] [--bg] [--morph]   # stills, contact sheet, build strips, bakes, Morph maps
node deck/cf11/design/preview/lint.mjs               # the contract, the scale, tokens per slide, typography
node deck/cf11/design/preview/timeline.mjs [NN…]     # each slide's build as PowerPoint schedules it
deck/cf11/tools/make.sh                              # the PPTX, checks, LibreOffice renders, comparison
deck/cf11/tools/preview/preview.sh                   # the motion preview: deck.mp4, keyframe sheets, morph-log.txt
node deck/cf11/motion/render.mjs title-cover --gif --gif-fps 10 --gif-colors 64 --no-mp4
node deck/cf11/motion/render.mjs scale --fps 25 --crf 24 --tune animation --zones "22,55,b=0.45/75,113,b=0.45/132,165,b=0.45/185,242,b=0.45"   # unused since round 7
node deck/cf11/motion/telegram.mjs                   # needs the app harness (Vite on 127.0.0.1:5199)
# 07: the lecture recording arrives as media/product/lecture-materials.mp4 + .jpg (1152 × 568, radius 22, corners in ink)
python3 -I deck/cf11/tools/record/fit.py deck/cf11/media/product/masters/07-master.json --box 1152 568 --radius 22 --bg '#0b121c'
python3 -I deck/cf11/tools/record/fit.py deck/cf11/media/product/masters/09-master.json --box 1152 568 --radius 22 --bg '#0b121c' --start 13.2
python3 -I deck/cf11/tools/record/fit.py deck/cf11/media/product/masters/08-master.json --box 392 848 --radius 36 --bg '#0b121c' --start 16.2
```

`fit.py` renders at ×1.2 of the box (never above the master) and paints the corners in the bezel's ink (`--bg`).
The masters' json holds each clip's moments (clip seconds); the builds of 07–10 are timed to them (07's from
`lecture-moments.json`). The screens are:

| Slide | Screen | Radius, corners in ink |
|---|---|---|
| 07, 08, 10 | 1152 × 568 | 22 |
| 09 | 392 × 848 | 36 (the bezel 52: concentric, so the screen's painted corners stay inside it) |
| 11 | 672 × 672 | 24 |
