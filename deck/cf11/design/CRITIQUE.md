# Self-critique — three hard readers

Round 1, on the renders of 2026-10-10/11 (`out/preview/`: stills, contact sheet, build-ups, bakes, Morph maps).
Status: **fixed** (changed and re-rendered), **kept** (considered, with the reason), **open** (needs the owner or
a later step).

## 1. A jury expert, alone with the file for three minutes (PDF / Normal view, no talk)

| # | Finding | Status |
|---|---|---|
| 1.1 | Three slides would have *lost content in PowerPoint*: decorations drawn on top of cards (05's table rules and Meldy's column, 02's dashed name frames) are baked into the background, which lies under every native shape — the white card would cover them. | **fixed** — rules and panel are native shapes, dashed frames are pictures; the lint now fails on any baked layer above a native object. |
| 1.2 | 05: the comparison names no brands and marks other types «частично» — an expert may ask «на каком основании». | **kept** — the reading line says it is by type of service, from the market review of 04.10.2026, and what «частично» means; names stay out on purpose (the script). |
| 1.3 | 01–05 carry the strip before it is explained (on 06). | **kept** — the brief allows 01 or 06; 01 has no room left, and «осталось 9 из 10» already reads as progress through the ten sections. |
| 1.4 | 01: in the still, the right card is a cheat sheet with no caption. | **kept** — it is the product's own screen (tag «Шпаргалка», a question, its lines, «6 строк осталось», «Ответ вслух»); 09 explains the rule; a caption would crowd the cover. |
| 1.5 | 03: «№ 319» is a document number, not a quantity, shown as a big number. | **kept** — it is the norm the claim rests on, captioned in full and sourced; the jury knows the regulation by its number. |
| 1.6 | 06: «до 2000» set as one 120 px string made «до» shout. | **fixed** — «до» is 48 px on the number's baseline. |
| 1.7 | 11 and 02, 13: placeholders ([N], [M], the pilot's result, names, group, the gs.by address, access dates). | **open** — marked faint and framed; fill by 21.10 (the script's checklist) or replace the pilot line by «Пилот идёт с [даты]». |
| 1.8 | 07, 08: the product recordings are placeholders; the step lists keep the slides readable without them. | **open** — record the live site after the new cheat sheet ships (decision of 10.10); fit with `motion/loopmask.py`. |
| 1.9 | 13: the statistics entry is a description, not the article's title. | **open** — open the gs.by article and Belstat's source, replace entry 2 (in the script's checklist). |

## 2. A motion designer

| # | Finding | Status |
|---|---|---|
| 2.1 | Morph pairs crossed the slide: 01's right-hand cover card would fly left into the first author card; 14's right card had no partner on 15. | **fixed** — surfaces pair by position: the right-hand card is `!!c2` from 01 through 06 and from 13 to 15 (the QR card). `--morph` maps checked for every change. |
| 2.2 | The dot changes preset (ellipse → rounded rectangle) when it opens into a window: the riskiest interpolation in Morph. | **fixed** — every dot that morphs is a rounded rectangle with radius = half its size (it looks the same), so Morph only grows the box and the corner. Same for the gathered squares on 15. |
| 2.3 | 04's «0» had its own zoom-in, so it would not morph from 03's «229 тыс.». | **fixed** — objects that morph never carry an entrance (lint rule). |
| 2.4 | The cover GIF caught mid-frames where ink blended into yellow (a muddy brown marker and square). | **fixed** — a «named» change is now a pop: the marker dips and flips colour at its smallest; same in the sheet clip. |
| 2.5 | The pull-back cost 2.7 MB: thousands of moving dots; middle levels drawn below 4 px turned to grain. | **fixed** — level of detail never draws a mark under ~4 px; neighbours stay quiet while the camera moves and come up to full contrast only when the field is still; x264 zones spend fewer bits during moves: 978 KB, clean frames. |
| 2.6 | Stop 1 of the pull-back cut the line at the edge. | **fixed** — the camera holds the measured centre of the line's words. |
| 2.7 | PowerPoint's default Morph is 2 s — floaty for a deck of fifteen changes. | **open, for the compiler** — recommended 0.9–1.0 s Morph, 0.6 s fade on 01 (PLAN.md §6). |
| 2.8 | The «229 тыс.» → «0» morph joins two different quantities. | **kept** — read as «from the size of the problem to the goal»; it is one slot (the slide's big number) and lasts under a second. |
| 2.9 | Builds of 6–9 steps (05, 13) could drag. | **kept** — all `after` with 80–200 ms offsets, about 2–2.5 s in total, readable while the speaker starts; only 03 waits for a click (the punchline). |

## 3. A Russian-language editor

| # | Finding | Status |
|---|---|---|
| 3.1 | Non-breaking spaces: «из 10» in the counter, «от 13.10.2023» (03, 13). | **fixed** — the counter is generated with a non-breaking space; the lint warns on any short word followed by a plain space (the mandatory names keep their plain spaces). |
| 3.2 | 13: lines of the bibliography began with a dash («— URL», «— Vol.»). | **fixed** — every break comes after the dash. |
| 3.3 | 12: a comma splice «без ИИ, ИИ работает…». | **fixed** — a semicolon. |
| 3.4 | 05: «Засчитывает после двух разных дней» — what is counted is missing; «Сверяет ответ с лекциями, с цитатой» — two «с» in a row. | **fixed** — «Засчитывает вопрос в два разных дня», «Сверяет с лекциями, даёт цитату». |
| 3.5 | 15: «преподавателям — видеть, как готовится группа» — the purpose is implied. | **fixed** — «преподавателям — чтобы видеть, как готовится группа». |
| 3.6 | 08: «Ответ вслух сверяется с лекциями, о пропущенном Meldy переспросит» shortens the script's claim. | **kept** — the phone needs the right third of the slide; the full claim runs to three lines at 72 px. A dash would be more expressive than the comma but costs the last 40 px of the line. |
| 3.7 | Plural agreement in the clips («2 строки осталось», «41 строка осталась»). | **fixed** — the counters choose the form by the number. |
| 3.8 | Headings end without a full stop; «ёлочки» throughout; dashes with a non-breaking space before them. | **checked** by the lint on every live text. |

## Round 2 (after the fixes)

| # | Finding | Status |
|---|---|---|
| R2.1 | 01: the small QR card faded in, but its shadow is baked — a lone shadow would sit there for a second before the card. | **fixed** — the card is static, its QR and caption build; the lint fails on any animated shape over a baked shadow. |
| R2.2 | 13: the dashed frame of the access date touched the colon of «обращения:». | **fixed** — the frame hugs the bracketed date, inside the right margin. |
| R2.3 | Bakes (`--bg`) of every slide hold only the canvas and the cards' shadows: everything visible is a live or native object. | **checked** |

`node design/preview/lint.mjs` — no errors, no warnings. Contact sheet, build-ups and Morph maps re-rendered and
read slide by slide; the remaining items are the **open** ones above.

## Round 3 — the round-2 deck: stills, the motion preview, the words

Read on 2026-10-11 from:
* the contact sheet (`out/preview/contact.png`);
* the compiler's motion preview: `out/preview/motion/deck.mp4`, `NN-in.mp4`, the keyframe sheets
  `keyframes/NN-in.png` (0/25/50/75/100 % of every transition plus its pair map) and `morph-log.txt`;
* the build strips (`out/preview/build/`) and `timeline.mjs`.

### A jury expert (Normal view / PDF, no talk)

| # | Finding | Status |
|---|---|---|
| R3.1 | 01: the cover card is the product's first impression and was still medium. | **fixed** — a third larger (720 × 896), taller, inside the slide. The GIF carries its own card and shadow, 1:1, 388 KB. The thesis is set at 64 px so its first line clears the card; the wordmark keeps 300 px. |
| R3.2 | 03: the regulation's full title on the «№ 319» card looks small on the contact sheet. | **kept** — it is 28 px, the reading layer (lint). The full name is what shows that № 319 is the higher-education attestation rules; the card's headline is «№ 319 от 13.10.2023». |
| R3.3 | 12: why dots? The unit of the field has to be read, not guessed. | **fixed** — every rung of the ladder has a picture of its level in the clip's own marks; the last rung reads «≈ 229 тыс. / студентов: 9 160 групп»; «ваша группа» labels the yellow dot. |
| R3.4 | 01–02: the strip has to be explained where it first appears. | **fixed** — 02's reading line, and one sentence in 02's notes. |
| R3.5 | 10: the bot's menu button changed with release 43. | **fixed** — the tip clip re-rendered from the merged app: «Открыть Meldy». |
| R3.6 | 11, 13 and the names on 02. | **open** — the pilot's numbers and result, the BELTA note's address and the access date. The names come from the private fill at the final build. |
| R3.7 | 07, 08: the product recordings are still placeholders. | **open** — the clips from the recording agent are not merged yet. Fit them to the new screens (07/09 1152 × 568, 08 392 × 848, corners in ink) with `motion/loopmask.py`; re-time the steps to their moments. |

### A motion designer (deck.mp4, keyframes, morph-log)

| # | Finding | Status |
|---|---|---|
| M3.1 | 01→02: the ten squares travelled as one clump and turned olive half-way (yellow mixing into ink). | **fixed** — they are seeds: ten invisible 8 px rounds in a row inside the wordmark's dot, already in their colour on 02 at 1 % alpha. The strip unrolls out of the dot as a line and only comes up to colour. On 15 the squares fly back into the dot and fade into it. |
| M3.2 | 06→07 and 10→11: the dot turned into an olive rectangle as it grew into the ink bezel, and again as the chat shrank back to the corner. | **fixed** — the chain is ink: 06's first bullet is ink like the others, and the chat closes into the first step of 11's path («Группа», an ink dot). The yellow returns on 12, as a small dot flying to the corner while the lights go down. 11's corner dot is `!!x11dot`, so it pairs with nothing. |
| M3.3 | 06→07: the clip faded in at its final place while the bezel was still growing; frame and picture came apart. | **fixed** — the dot grows into an empty dark bezel, then the screen turns on (07's clip has an entrance). The clips are `!!clip` and ride with the bezel 07→08→09→10. |
| M3.4 | 10→11: the chat's picture fades in place for half the transition while its bezel leaves. | **kept** — only an exit effect would take it away first, and the deck uses entrances only. The bezel closing into the group's dot is what the eye follows. |
| M3.5 | 04→05: the claim and the statement crossfaded over each other in mid-transition. | **fixed** — the lights go down first; the statement rises in the dark (05). The same for 12's claim, with the clip and its ladder 300 ms later. |
| M3.6 | Builds ran 3.5–6.7 s, step after step. | **fixed** — every slide builds as one automatic group of 1.4–2.9 s, the steps overlapping in beats; only 03 waits for a click; 12 follows its clip (10.6 s). |
| M3.7 | Automatic Morph matches: identical bullets, numbers, arrows, chips would pair across slides. | **fixed** — 38 built objects carry unique `!!x…` names; morph-log: 0 automatic pairs on all 14 transitions. |
| M3.8 | The strip, the counter and the corner were the bottom layer: in a Morph the flying squares and the dot could pass under cards. | **fixed** — the header band is the last layer of every slide. |
| M3.9 | 12: does the ladder land on the clip's stops? | **checked** — frames at 2.4, 4.6, 6.9, 9.0, 11.4 and 13.4 s of `12-in.mp4`: each rung arrives as the camera settles on its level; «ваша группа» after the field holds. |
| M3.10 | 03→04: half-way, the «0» shows inside the shrinking «229». | **kept** — one slot, under a second: the number drops to zero. |
| M3.11 | Two small colour changes remain: 05→06 (the yellow corner dot lands as 06's ink bullet) and 11→12 (the group's ink dot flies up as the yellow corner dot). | **kept** — dots of 10–36 px, half a second; nothing large changes colour. |
| M3.12 | The cover GIF went from 12.5 to 10 fps to stay under 0.4 MB at its new size. | **kept** — the voice bars move five times a second; a named line takes 3–4 frames. |

### A Russian-language editor

| # | Finding | Status |
|---|---|---|
| E3.1 | 05: the script's claim does not fit two lines at 96 px. | **fixed** — «ИИ не отвечает за студента: он спрашивает и сверяет с лекциями» (accepted by the coordinator). |
| E3.2 | Non-breaking spaces: «9 160 групп» (12), «120 стран» (13). | **fixed** |
| E3.3 | 14: «Chrome, Edge, Firefox или Safari» shared a paragraph with a 44 px line; LibreOffice could not set the negative spacing. | **fixed** — its own line, 32 px. |
| E3.4 | 04: «строк осталось» sat above the zero's baseline. | **fixed** — on the baseline. |

### A viewer at the back of the room (projector)

| # | Finding | Status |
|---|---|---|
| S3.1 | 12: a weak projector may wash the night field out. | **kept** — the dots are 50–75 % of the muted token (round 1: about 40 %); the yellow ring, the label and the ladder carry the meaning without the field. |
| S3.2 | 05: «частично» at 28 px is quiet on the dark stage. | **kept** — by design: the eye goes to Meldy's yellow ticks. |

After the fixes:
* `node design/preview/lint.mjs`: no errors.
* `tools/make.sh`: ALL GREEN, 3.23 MB.
* The motion preview was re-rendered and the keyframes read again.
* The open items: R3.6, R3.7.

## Round 4 — the live recordings in the device chain (06→11), native shadows

Read on 2026-10-11 from the stills of 06–11, the recordings frame by frame against their masters' moments, and the
motion preview after the compiler's native shadows: `07-in.mp4` … `11-in.mp4` (frames every 0.3 s through each
transition, then at every step), the keyframe sheets and `morph-log.txt`. R3.7 is closed: 07–09 show the live site.

### Stills and words

| # | Finding | Status |
|---|---|---|
| R4.1 | 08: the screen's square corners (an opaque video, its corners painted ink) stuck out of the phone's bezel at radius 64: a 4 px notch at each corner. | **fixed** — the bezel is 52 and the clip is re-fitted with a 36 px screen radius: concentric, the painted corners stay inside the bezel. |
| R4.2 | 06: the chips «PDF, DOCX, PPTX, фото» mixed the two imports. | **fixed** — two lines: «вопросы — Word, Excel, TXT или PDF», «лекции — PDF, DOCX, PPTX или фото». |
| R4.3 | 07: the notes said «перетаскивает файл»; the clip chooses it with «Выбрать файлы». | **fixed** — «загружает». |
| R4.4 | 08: «как на экзамене» names a separate mode (no live marks) that the clip does not show, and the steps ran in another order than the clip. | **fixed** — «вслух; Meldy записывает сказанное текстом»; Переспрос before Названо и пропущено. |
| R4.5 | 07–09: nothing told the speaker how the clips were made. | **fixed** — each slide's notes end with «О записи»: the live site, waiting cut out, nothing sped up; 08's voice synthetic and without sound; 09 the site's example, where «yesterday» is part of the example. |
| R4.6 | 09: the legend's «Забыта — строка вернулась» is the product's rule (the cheat sheet's «returned» state, also on the landing page), but the clip does not show a line coming back. | **kept** — it is the key of the rule the claim states; the clip's own key («осталось · названо один раз · стёрто») matches the other three. |

### A motion designer (06→11: the device chain with the real clips riding as `!!clip`)

| # | Finding | Status |
|---|---|---|
| M4.1 | 06→07: the ink bullet grows into the laptop over the fading list; the bezel lands dark and the screen turns on 150 ms later, the recording playing from its first frame. The shadow now grows with the bezel as its own native shadow. | **checked** — 07-in at 0.4, 0.75, 1.1, 1.45, 1.8 s. |
| M4.2 | Every morphing dot (the seeds, the corner dot, 06's first bullet, 11's «Группа» dot, the big dot) was written as an ellipse: the compiler makes an ellipse of a radius within half a pixel of the half, so 06→07 and 10→11 (and 01→02, 14→15) morphed an ellipse into a rounded rectangle, against the plan. | **fixed** — half the size less one pixel: every pair is a rounded rectangle at both ends (morph-log: no geometry change in the deck). |
| M4.3 | 07→08, 08→09, 09→10: a screen that rides in shows its poster during the Morph, and the video takes over from its first frame when the slide lands. The posters (the protocol; the sheet after the erase, 44; the day card) were not the first frames (the exam page; the example's start, 47; a question mid-chat): a jump at every landing, and on 09 the counter went back from 44 to 47. | **fixed** — those loops begin on their posters' moments (`fit.py --start`, `loopmask.py --start`): 08 at 16.2 s (the tap on the missed point and the examiner's question come first, the story from 2.7 s), 09 at 13.2 s (the story from 0.63 s, out of the loop's own dissolve), 10 on its poster frame. 08's steps re-timed to 6.73 / 11.10 / 13.33 s, the reading line 14.63; 09's legend to 9.43 / 9.83 / 12.63 / 13.03. |
| M4.4 | The screens change shape along the chain (1152 × 568 → 392 × 848 → 1152 × 568 → 672 × 672): mid-Morph the two crossfading pictures are stretched for about half a second. | **kept** — both ends are right and the content is mid-crossfade; a fixed-shape screen would need a mask that Morph does not carry. |
| M4.5 | The native shadow travels and scales with the bezel through laptop → phone → laptop → chat and goes as the chat closes into the «Группа» dot. | **checked** — morph-log («shadow appears» 06→07, kept to 10, «shadow goes» 10→11); in LibreOffice the device shadows are within p99 2–3 grey levels of the HTML. |
| M4.6 | 10→11: the screen fades out in place while the bezel closes into the dot, so for about 0.3 s the bezel's edge shows beside the fading screen. | **kept** — a partner for the clip on 11 would have to be a hidden video; under half a second. |
| M4.7 | The steps wait for the clip's moments: 07's first at 4.25 s (the file), 08's at 6.73 s (the voice), 09's legend at 9.43 s (the sheet). The claim carries the first seconds alone. | **kept** — by design: the words land with what the screen shows. The stills and the PDF show every step. |

After the fixes:
* `node design/preview/lint.mjs`: no errors; `timeline.mjs`: no warnings.
* `tools/make.sh`: ALL GREEN, 5.95 MB (1416 checks; the ten native shadows within p99 4 grey levels of the HTML).
* The motion preview re-rendered: morph-log with 0 automatic pairs and 0 geometry changes; 08, 09 and 10 land on
  their posters without a jump (frames at 1.2 and 1.35 s of each).
* Open: R3.6 (the pilot's numbers, the BELTA note's address; the names come from the private fill).

## Round 5 — the owner's notes on draft 3

The owner looked at draft 3 (the PPTX and the preview); the direction stays. Their notes, and what changed:

| # | Note | Status |
|---|---|---|
| O5.1 | «Мне не нравятся эти надписи "осталось 8 из 10"». | **fixed** — no counter on any slide; the ten squares stay. 15 keeps one line under the dot, «Шпаргалка этой защиты пуста», which builds in after the strip has collapsed (no partner on 14, so 15 morphs by object again). |
| O5.2 | «Не нравится снизу надпись в начале» (02's strip line, 05's comparison note). | **fixed** — both lines and 01's F5 hint are gone from the slides; their content is in the notes (02: the strip; 05: by type, no brands, the 04.10.2026 review, what «частично» means; 01: F5 for the presenter). 03's and 12's sources and 08's and 14's content lines stay. |
| O5.3 | «11-ый слайд хер пойми что происходит». | **fixed** — redesigned with real facts only: the claim (every release: autotests and a live check on a phone and a computer), «6 492» with its parts (4 357 site, 1 817 server, 318 bot), release № 43 and the open example; the promotion path in plain words with arrows. The «Пригласить группу» button travels in from 10. No placeholders. |
| O5.4 | 13: pictures of the resources, as last year? | **fixed** — the formal list stays on the left, calmer (no rules); «Документация» is seven tiles: each resource's own mark in ink (simple-icons 16.34.0, CC0; Groq has none, so its tile is a wordmark in Onest), its name, its short address (the full one is the link). |
| O5.5 | 07–09 «резко и непонятно». | **prepared** — the clips are being re-cut at the same boxes. The lists next to them now carry the clips' own concrete moments in large type under small labels (07: «Нашли 240 вопросов и ключ — жирным в файле», «2 ноября, 45 минут в день», «Сегодня 52 вопроса, около 45 минут»; 08: the examiner's question, «Сами назвали 3 из 3 главных пунктов», the lecture's quote; 09: «47 → 44», «3 строки стёрты: названы в разные дни», and the sheet's own key). Timings wait for the new clips. |

### Self-critique: 01, 02, 05, 11, 13, 15

| # | Finding | Status |
|---|---|---|
| S5.1 | 01: without the hint the bottom edge is quiet. The cover card's «6 строк осталось» is the product's own sheet, not the deck's counter. | **kept** — it is what the product shows; the GIF's counter rolls to 0. |
| S5.2 | 02: the strip unrolls without a word on the slide; a reader of the PDF alone may not know what the squares are. | **kept** — the owner's call; the speaker says it once (notes), and 15's «Шпаргалка этой защиты пуста» closes it. |
| S5.3 | 05: a reader of the PDF alone loses «по типам сервисов, без брендов» and the date of the review. | **kept** — the column heads are types of service already («Чат-боты», «Карточки», «Конспекты по файлам»); the rest is in the notes. |
| S5.4 | 11: the department's report «какие вопросы группа знает хуже» is a next step: the product's «Отчёт для преподавателя» today is one student's questions and what the lectures cover, not a group's weak questions. | **watch** — it stands under «Продвижение» (the path ahead) and the notes say «дальше»; no product button is drawn for it, only for the group, which works today. |
| S5.5 | 11: «6 492 автотеста» is true today; the number moves with every release. | **watch** — re-count before the defence (the notes give the parts). |
| S5.6 | 13: the left list is still dense (five entries, 28 px), and its caps headings are loud next to the calm tiles. | **kept** — the jury requires the formal list; the rules are gone. The BELTA address and the access date are still open (R3.6). |
| S5.7 | 15: «Лицензия для колледжа» while 11 now says «лицензия для учреждения». | **open** — one wording for both, the coordinator's call. |

### Motion (the preview after round 5)

| # | Finding | Status |
|---|---|---|
| M5.1 | 01→02: the strip unrolls out of the dot with nothing else in the band; the cards build after. | **checked** — 02-in at 0.4–3.5 s. |
| M5.2 | 10→11: the chat and its screen fade while the «Пригласить группу» button travels into 11's path; 11 lands on the button alone, then the claim, the number and the path build (2.0 s). | **checked** — 11-in at 0.33–3.5 s; morph-log pairs `!!pill`, `!!pillt`. |
| M5.3 | 14→15, by object now: the strip collapses into the dot and the wordmark grows; «Шпаргалка этой защиты пуста» builds first, then the lists, the QR card last. | **checked** — 15-in at 0.5–4.6 s. |
| M5.4 | 07–09: the large lines come in as the clips reach them (07 at 5.08, 7.85, 15.12 s; 08 at 6.73, 11.10, 13.33 s; 09 at 9.43 and 12.63 s). 08's lecture quote came before the protocol scrolled to it. | **fixed** — 08's quote at 16.5 s, the reading line at 17.2 s. All of it is re-timed when the re-cut clips land. |
| M5.5 | 12→13: the tiles come in one by one, 80 ms apart, after the formal list. | **checked** — 13-in at 2.4–4.5 s. |

After the fixes:
* `node design/preview/lint.mjs`: no errors, no warnings; `timeline.mjs`: no warnings.
* `tools/make.sh`: ALL GREEN, 5.96 MB (1387 checks; the ten native shadows within p99 4 grey levels).
* morph-log: 0 automatic pairs, 0 geometry changes.

## Round 6 — the owner's note on 06: the lectures

The owner, 2026-10-11: «почему нет информации о лекциях обычных, о карточках и тд (ну в целом об этом всем) о том что
через видео, ссылку и тд это можно сделать?» The deck told the exam path (07–10) and said almost nothing about the
lecture toolkit: 06 had one line, «лекции — PDF, DOCX, PPTX или фото». Still 15 slides; 06 now shows both halves.

| # | Finding | Status |
|---|---|---|
| O6.1 | The lectures were missing: how a lecture gets in, what Meldy makes of it. | **fixed** — 06 is two halves under ink heads. «Экзамен»: Word, Excel, TXT, PDF; «до 2000 вопросов, тестовые и устные»; the five blocks with the slide of each. «Лекция»: the four tabs of «Разобрать лекцию» with the app's icons (Файл, Текст, Ссылка, Аудио и видео); a tree into the five materials of «Что сделать из лекции», in the app's words; its sixth, blue branch is «Ответ вслух — сверка с лекциями и цитаты, слайд 8» (the exam's «Ответ вслух» has a blue dot too). Claim: «Meldy делает из перечня вопросов экзамен, а из лекций — конспект, карточки и тест»; under it the format line. |
| O6.2 | «Ссылка» beside «Аудио и видео» could read as a link to a video, which Meldy does not open. | **fixed** — the line under the tabs: «PDF, DOCX, PPTX, фото, MP4, MP3; ссылка на страницу»; the notes say aloud that a video comes as a file (up to 15 MB, about 15–30 minutes of sound). |
| O6.3 | The big «до 2000» of the old card is gone. | **kept** — the claim and the two heads carry the slide; 2000 is the line under «Экзамен». |
| O6.4 | The lists are 36 px (the plan's lists are 44–48), the descriptions, chips and slide numbers 28 px. | **kept** — twice the content of the old 06 on one slide; nothing under the lint's 28 px. |
| M6.1 | 05→06 and 06→07: the corner dot lands as the exam's first bullet (134, 670) and grows into the laptop. | **checked** — keyframes 06-in, 07-in; morph-log 0 automatic pairs. |
| M6.2 | The build: the heads and chips settle, the exam's lines are written in, the lecture's spine is drawn down (900 ms) and each branch shoots out as its front passes, the line written in after it; one automatic group of 2.8 s, 58 effects. | **checked** — `06-in.mp4` at 1.5–4.5 s. |
| E6.1 | «сверка с лекциями, с цитатами»: two «с» (cf. 3.4); «… компьютера и бот в Telegram»: two «и». | **fixed** — «сверка с лекциями и цитаты»; «Веб-приложение для телефона и компьютера, бот в Telegram». |
| T6.1 | The notes for 06 grew from about 45 to about 175 words (the script gave 06 twenty seconds). | **open** — the script's timing (meldy-notes `CodingFest_11_Deck_Script.md`); the speaker can drop the details of the formats. |
