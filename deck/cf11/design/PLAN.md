# Meldy · CodingFest-11 — the deck's design plan

The deck is one argument told in Meldy's own interface language: a warm canvas, white cards, ink type, one blue
action, the yellow dot. It works twice — an expert reads the PPTX alone, then it runs behind a 7-minute talk —
so **every slide is complete as a still** (PDF, Normal view, LibreOffice) and motion only adds. Sources of truth:
`CONTRACT.md` (markup), meldy-notes `10_Project/CodingFest_11_Deck_Script.md` (words, talk),
`40_Decisions/2026-10-10_deck-direction.md` (B + A + C), `reference/board.html` (the approved look).

## 1. Grid and type

- **Slide** 1920 × 1080 px. **Margins** 128 left/right, header band at y 56, bottom margin 56.
- **12 columns** of 102 px, 40 px gutters: column *k* starts at x = 128 + 142·k; the last ends at 1792.
  Splits used: 6/6 (128–940 | 980–1792), 7/5 (128–1082 | 1122–1792), 3 × 4 with 88 px arrow gaps (11).
- **Rows**: header y 56 (22 px squares, centre line 67) · label y 128 · claim y 192 (two lines end at 352) ·
  evidence y 424–952 (product windows to 1000; one-line claims start the evidence at 304–344) · reading layer y 984.
- **Type** (Onest static 400/500/600/700, embedded): 240 wordmark · 200/176 big number · 120 number in a card ·
  **72 claim** (600, −0.03 em, two lines at most, explicit `<br>` so PowerPoint never re-wraps) · 64 the title's line ·
  56–48 card titles · 48 body · 40 label (caps, +0.12 em, #1F5BC6) and secondary body · 32 reading layer ·
  28 sources, captions, counter. **Nothing under 28 px** (lint). Claims are 72 px everywhere because the longest
  line («Перечень вопросов за минуту превращается») measures 1515 px at 72 and would not fit at 80 with slack.
- **Surfaces**: cards are empty native rounded rectangles (radius 48, windows 40, phone 64) — they morph; their
  soft shadow is a separate baked layer under them; their content is sibling layers on top. Panels inside cards
  are canvas #F3F3F0. Colours: the CONTRACT tokens only (lint), alpha variants allowed.

## 2. The deck-wide system

- **The strip — «шпаргалка этой защиты»** (B). Ten 22 px squares `!!s01…!!s10` and the counter `!!left` on every
  slide, written by `design/stamp.mjs` from `design/deck.mjs`. Current section yellow, passed an outline, coming ink —
  the same three states as the cheat sheet's map (named once / erased / remains). 07–10 share square 07. The own
  slides 11–12 have no current square: a small yellow dot `!!sx` sits in the gap after square 07 («между разделами»),
  and the counter reads «осталось 3 из 10». Explained once, on 06: «Наверху — шпаргалка этой защиты: 10 разделов;
  пройденный гаснет». On 15 the squares gather into the wordmark's dot and the counter comes down under it:
  «Шпаргалка этой защиты пуста: осталось 0 из 10».
- **The dot** `!!dot` (C) travels the whole deck: 01 the big wordmark's dot → 02–05 the corner wordmark's dot →
  06 the yellow bullet of block 1 in the contents → 07 the laptop window → 08 the phone → 09 the window of the cheat
  sheet → 10 the square window of the Telegram chat → 11–14 back home in the corner → 15 the big dot again, the strip
  collapsing into it. The corner wordmark `!!word` (32 px) leaves with the dot on 06–10 and grows back into the
  big wordmark on 15.
- **Cards** pair by position, so slide changes feel like one camera: the right-hand surface `!!c2` runs 01→06
  (the cover card → the second author → «229 тыс.» → the zero card → the comparison table → «Число и формат») and
  13→15 (the documentation → the stack → the QR card); `!!c1` is the left-hand one (02→03, 11→14); the big number
  `!!num` turns «229 тыс.» into «0» (03→04). Every morphing dot is a rounded rectangle with radius = half its size,
  so it grows into windows without changing preset.
- **The label** of 07–10 is `!!t07` and does not move or re-animate across the four «Представление блоков проекта».

## 3. Motion rules

- Transition **Morph** on every slide (01: fade from black). Objects that morph carry no entrance animation (lint).
- Entrance builds only, in reading order **label → claim → evidence → reading layer**; mostly `after` with 80–200 ms,
  `with` inside a group; `click` only where the speaker reveals a punchline (03: «229 тыс.»). Effects: fade, rise,
  zoom for big numbers, wipe for the map rows. No exits, no spins, no bounces, no motion paths.
- Clips are pure functions of time (`window.__clip = { T, seek }`), rendered frame by frame (`motion/render.mjs`):
  H.264 High, yuv420p, BT.709 tags, `+faststart`, no audio; posters at 2×.

| Clip | Slide | What it shows | Poster | File |
|---|---|---|---|---|
| `title-cover` | 01 | The cheat sheet of «Рыночное равновесие»: Monday's answer aloud names the lines (yellow dots), Tuesday's erases them (strike left to right), the counter rolls 6 → 0, then the lines come back. 9.6 s loop. | first frame, lines visible | GIF 300 KB (12.5 fps, 64 colours — what PowerPoint 365 plays in Normal view), MP4 256 KB |
| `sheet` | 09 | The exam page's cheat sheet in the new look over two days: named once, erased, a forgotten line returning with «не названа 13 окт.»; map and counter follow. 10.4 s loop, dissolves into its first frame. | the end state (all three states visible) | MP4 233 KB |
| `scale` | 12 | One pull-back on one centre, four orders of magnitude: одна строка → один вопрос → экзамен на 400 вопросов → группа из 25 человек → около 229 тыс. студентов вузов (a dot = a group of 25). The labelled ladder highlights each stop. Plays once and stays on its last frame. | the last frame, all stops labelled | MP4 978 KB (x264 zones: fewer bits while the camera moves) |
| `telegram` | 10 | The app's own Telegram tip clip from the harness (the bot's day card, «Начать», a question, «Верно.»), trimmed to the sharp chat, corners rounded onto the window, loop by crossfade. | the day card with «Начать: 20 вопросов» (JPEG, 222 KB) | MP4 252 KB |
| `ph-07`, `ph-08` | 07, 08 | **Placeholders** — a calm frame «Ролик с сайта: …» in the faint colour, dashed — until the live site is recorded (`media/product/`). | the same | MP4 ≈ 17 KB each |

## 4. The slides

Eye order = what the eye takes first, second, third in the still. Build = the entrance order in the show.

| # | Label (title placeholder) | Claim / headline | Eye order and evidence | Build | Morph names | Criterion |
|---|---|---|---|---|---|---|
| 01 | Титульный | «Meldy.» · «ИИ не отвечает за студента — он его спрашивает» | wordmark → the line → the moving cheat-sheet card (GIF) → nomination «Образование, культура», small QR «Пример экзамена без регистрации», «Нажмите F5…» | label · line · lead · nomination · QR · F5 hint | `!!word` `!!dot` `!!c2` (card) | 5 visual design · 7 presentation |
| 02 | Автор проекта | — (the authors are the content) | two author cards (placeholders «[Фамилия Имя Отчество]», «учащийся группы [группа]») → institution, full name → region, district, town | label · names · institution · region | `!!c1` `!!c2` | completeness (Приложение 2) |
| 03 | Актуальность | «Экзамены по билетам — норма, а к сотням вопросов готовятся без плана и проверки» | «№ 319» (Минобразования, 13.10.2023) → «229 тыс.» students (gs.by, 2026), each with its source | label · claim · № 319 · *click* 229 тыс. | `!!c1` `!!c2` `!!num` | 3 value / need |
| 04 | Цель, задачи | «Цель: к утру экзамена в шпаргалке не остаётся строк» | the product's own cheat-sheet card at zero («0 строк осталось», all squares erased) → four tasks | label · claim · card · tasks 1–4 | `!!c2`, `!!num` («229 тыс.» → «0») | 1 completeness · 3 |
| 05 | Новизна и инновационность | «ИИ не отвечает за студента: он спрашивает и сверяет ответ с его лекциями» | the comparison by type of service (no brands): five features, Meldy the only column of ✓; «частично» explained in the reading line | label · claim · header · five rows · note | `!!c2` | 2 innovation · 3 novelty |
| 06 | Содержание | «Один экзамен: перечень вопросов, лекции, план до даты и шпаргалка» | five blocks as cheat-sheet lines with the slide that shows each; the first bullet is the yellow dot → «Число и формат»: до 2000 вопросов, PDF/DOCX/PPTX/фото, tests and oral, web + Telegram bot → the strip explained | label · claim · blocks · card · note | `!!dot` (bullet), `!!c2` | 1 completeness (число и формат) |
| 07 | Представление блоков проекта | «Перечень вопросов за минуту превращается в план до даты экзамена» | the laptop window (recording to come) → four steps that say what it shows | label · claim · window clip · steps | `!!t07`, `!!dot` (dot → window) | 4 technical · 5 design |
| 08 | Представление блоков проекта | «Ответ вслух сверяется с лекциями, о пропущенном Meldy переспросит» | the phone (recording to come) → three steps → «Оценок нет…» | claim · phone clip · steps · note | `!!t07`, `!!dot` (window → phone) | 2 complexity · 3 |
| 09 | Представление блоков проекта | «Строка исчезает, только когда её назвали в два разных дня» | the sheet clip in the window → the legend in the map's own squares | claim · clip · legend | `!!t07`, `!!dot` | 2 · 3 · 5 |
| 10 | Представление блоков проекта | «Одна ссылка — вся группа; план на день — в Telegram» | the Telegram chat → «Пригласить группу» → six copies of one exam (same grid, own progress) → the daily plan | claim · clip · group · Telegram | `!!t07`, `!!dot` | 1 adoption · 6 spread |
| 11 | Тестирование и продвижение | «Пилот: [N] студентов, [M] дней» (placeholders, dashed) | Продвижение: group → department (teacher's report) → colleges and universities (licence) · Проверка: [pilot result] placeholder, the open example | label · claim · steps · Проверка | `!!c1–3`, `!!dot` back in the corner, `!!sx` | 1 testing and promotion |
| 12 | Масштабируемость | «Тот же цикл подходит для любого экзамена и любого числа студентов» | the pull-back clip, poster = all five stops → why it is cheap to grow (tests without AI) and the source | label · claim · clip · note | `!!c1` | 6 scalability |
| 13 | Используемые источники | «Литература и электронные ресурсы» | normative and statistics → research on testing and spacing (Roediger & Karpicke 2006; Cepeda et al. 2008; Dunlosky et al. 2013) → documentation; access date a placeholder | label · claim · lists | `!!c1` `!!c2` | 7 presentation |
| 14 | Технические требования | «Браузер на телефоне или компьютере, без установки» | minimum requirements → the stack by layer (interface, server, database, models and bot) → site and bot | label · claim · cards · note | `!!c1` `!!c2` | 4 technical quality |
| 15 | Заключение | «Meldy.» · «Шпаргалка этой защиты пуста: осталось 0 из 10» | the big wordmark (the strip has collapsed into its dot) → recommendations → monetisation (100 / 1000 units a day, licence) → the large QR, its address, the blue pill «Открыть пример» | label · lists · QR card | `!!word` `!!dot` `!!left` `!!s01–10` (gather) `!!c2` | 1 monetisation · 7 |

## 5. Placeholders (must be filled or replaced before the file is sent)

Names and group on 02 · pilot numbers and result on 11 · the gs.by address and the access dates on 13 ·
the recordings of 07 and 08 (and the real recording for 10, if it replaces the tip clip) · in the notes:
«[Имена называет докладчик.]» (02), «[Результат пилота одной фразой.]» (11), «[меньше копейки — сверить 21.10]» (12),
the conditional last sentence of 15. Placeholders are faint, in brackets, and framed with a dashed outline.

## 6. Notes for the compiler (assumptions this markup makes)

- **Layering**: the baked background is under every native object, so nothing baked is drawn above a marked shape
  (lint checks it). Decorations that sit on cards are native shapes (05's table rules and Meldy's column) or
  pictures (the dashed placeholder frames — a dashed outline is not a native shape here).
- **Cards** carry no border; their shadow is the unmarked `.shadow` layer under them (baked, at the end position).
- **Video**: `data-loop` on the looping clips; `scale` has none (plays once and stays on its last frame).
  Each video has an entrance `fade` after the Morph, so it appears inside its window once the window has settled.
- **Inline runs** differ only in colour and weight; line breaks are `<br>` everywhere a claim or entry wraps.
- **Non-breaking spaces** are U+00A0 in the text (`&nbsp;`); the mandatory names keep plain spaces.
- **The finale**: on 15 all ten squares are yellow circles of the dot's size at the dot's place (`data-gather`).
- **Transition timing** (not in the contract yet): Morph 0.9–1.0 s on 02–15 (PowerPoint's default 2 s floats),
  a 0.6 s fade on 01.

## 7. Tools

```
node deck/cf11/design/stamp.mjs                      # write the header band into every slide
node deck/cf11/design/preview/shoot.mjs [NN…] [--build] [--bg]   # stills, contact sheet, build-ups, bakes
node deck/cf11/design/preview/lint.mjs               # the contract and typography checks
node deck/cf11/motion/render.mjs title-cover --gif --gif-fps 12.5 --gif-colors 64
node deck/cf11/motion/render.mjs sheet
node deck/cf11/motion/render.mjs scale --fps 25 --crf 24 --tune animation --zones "27,61,b=0.45/82,123,b=0.45/145,178,b=0.45/200,247,b=0.45"
node deck/cf11/motion/render.mjs ph-07 ; node deck/cf11/motion/render.mjs ph-08
node deck/cf11/motion/telegram.mjs                   # needs the app harness (Vite on 127.0.0.1:5199)
python3 -I deck/cf11/motion/loopmask.py <frames> <out> <w> <h> --radius 24 --xfade 15   # fit a recording to a window
```

A real recording replaces a placeholder by changing `data-src`/`data-poster` on its `<img data-pptx="video">`
(07: 1080 × 544 inside the window, corners radius 24 on white; 08: 360 × 792, radius 44; 10: 640 × 640, radius 24) —
`loopmask.py` crops, rounds the corners onto white and makes the loop seamless.
