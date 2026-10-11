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
