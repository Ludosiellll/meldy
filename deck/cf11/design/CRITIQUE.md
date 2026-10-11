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
