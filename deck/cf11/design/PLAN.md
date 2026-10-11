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
  | sources, counter | 28 px |

  **Nothing under 28 px.** At most about 35 words outside the reading layer, except on the list slides 02, 13 and
  14. The lint checks all of it.
- **Light and dark.**
  * Every slide is the light paper: canvas `#F3F3F0`, white cards, ink `#0B121C`.
  * Two stage slides, `<main class="slide dark">`, use the app's dark theme token for token: 05 «Новизна» (the
    manifesto) and 12 «Масштабируемость» (the night field). The tokens are canvas `#0B0F16`, surface `#141A24`,
    surface-soft `#1B2230`, ink `#F3F3F0`, muted `#A7ADB7`, line `#262E3B`, labels `#8DB2F5`, and the same yellow.
  * The tokens switch in `deck.css`, so the strip, the corner wordmark, the rules and the panels follow.
  * Every bake is one flat canvas. A Morph between a light and a dark slide crossfades the two, and the strip and
    the wordmark change colour with it: the lights go down and come back up.
- **Surfaces.**
  * Cards are empty native rounded rectangles: radius 48, devices 36–64.
  * A card that builds or travels carries its own shadow (`.lift`). The compiler places that shadow as a picture
    that builds and morphs with the card, so no shadow ever waits alone or stays behind.
  * The devices on 07–10 are ink bezels (`#0B121C`). The screen is the video inside them, its corners painted ink.

## 2. The deck-wide system

- **The strip, «шпаргалка этой защиты»** (B).
  * Ten 22 px squares `!!s01…!!s10` and the counter `!!left`, written by `design/stamp.mjs` from `design/deck.mjs`.
  * The current section is yellow, a passed one an outline, a coming one ink (light on the dark slides): the
    cheat sheet's three states.
  * **01 has no strip.** The ten squares are *seeds*: invisible 8 px rounds in a row inside the wordmark's dot,
    already in their colour on 02 at 1 % alpha.
  * On 02 the strip **unrolls out of the dot**: each seed only moves, grows and comes up to colour, so Morph mixes
    nothing. The counter fades in, and the reading line explains the strip once: «Наверху — шпаргалка этой защиты:
    10 обязательных разделов; пройденный гаснет, как строка в Meldy».
  * The own slides 11–12 show a small yellow dot `!!sx` in the gap after square 07.
  * On 15 the strip **collapses** back into the dot: the squares fly into it and fade away as seeds. The counter
    comes down under the wordmark: «Шпаргалка этой защиты пуста: осталось 0 из 10».
  * The header band (strip, counter, corner) is the **last layer** of every slide, so in a Morph its squares and the
    dot fly over everything.
- **The dot** `!!dot` (C) travels the whole deck:

  | Slide | What the dot is |
  |---|---|
  | 01 | the big wordmark's dot (84 px) |
  | 02–05 | the corner wordmark's dot |
  | 06 | the first bullet of the contents, in ink like the others: it came down from the corner |
  | 07 | the laptop's ink bezel, 1184 × 600 |
  | 08 | the phone, 424 × 880 |
  | 09 | the laptop again |
  | 10 | the chat, 704 × 704 |
  | 11 | the first step of the path, «Группа»: the chat closes into this ink dot (the corner dot is `!!x11dot`) |
  | 12 | the corner dot again, flying up from 11 as the lights go down |
  | 13–14 | the corner dot |
  | 15 | the big dot, with the strip collapsing into it |

  The chain is **ink from 06 to 11**, so the dot never turns olive while it grows into a bezel or shrinks back: the
  yellow ↔ ink changes happen only on small dots (05→06, 11→12). Every morphing dot has a radius of half its size
  less half a pixel. It looks like a circle, but the compiler writes a rounded rectangle at both ends of the Morph,
  never an ellipse. The corner wordmark `!!word` shrinks out of the big one on 02, leaves on 06–10 and grows back on
  15.
- **The screens** on 07–10 are `!!clip`: they ride with the bezel and crossfade their content. 07's clip has an
  entrance: the dot grows into a dark bezel, then the screen turns on.
- **Titles** are all `!!title` (the compiler's name), so the label crossfades in place from slide to slide. Labels
  never have an entrance of their own after 01.
- **Other pairs**: `!!num` turns «229 тыс.» into the «0» (03→04); `!!c1`/`!!c2` name the author cards and the QR
  card.
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
| 04→05, 05→06 | **M3** lights down, lights up | 1.5 s |
| 06→07 | **M4** the dot grows into the laptop | 1.5 s |
| 07→08→09→10→11 | the device chain: laptop → phone → laptop → chat → the first step's dot on 11 | 1.3 s |
| 11→12, 12→13 | **M5** lights down into the night field, and up | 1.5 s |
| 13→14 | Morph | 0.9 s |
| 14→15 | **M6** the strip collapses into the dot (Morph by words: «осталось», «из», «10» travel) | 1.6 s |

**Builds.**
* Each slide's entrances run as one automatic group of 1.4–2.7 s: the first effect starts it, every other comes
  «with» it at its beat (`design/preview/timeline.mjs` prints the schedule and flags anything over 3.5 s).
* Clicks: only 03's punchline («229 тыс.» settles in).
* Effects: `settle` (fade + 92 → 100 %) for things that land, `rise` for claims and titles, `wipe` from the left for
  lines being written, rows and strikes, `fade` for small type. Entrance effects only; objects that morph never build.

**The product's mechanics, with native objects:**

| Slide | Build |
|---|---|
| 01 | the dot and its hidden squares settle together |
| 04 | the erased map sweeps in from the left |
| 05 | rows wipe in one by one, then Meldy's yellow ticks cascade |
| 06 | the five blocks are written in like cheat-sheet lines |
| 10 | six copies of one exam settle one after another |
| 11 | the path's dots settle from one group to a field |
| 12 | the ladder of stops builds on the clip's stops |
| 15 | the QR card settles in last |

**Clips** are pure functions of time (`window.__clip = { T, seek }`), rendered frame by frame (`motion/render.mjs`):
H.264 High, yuv420p, BT.709 tags, `+faststart`, no audio, posters at 2×.

| Clip | Slide | What it shows | Poster | File |
|---|---|---|---|---|
| `title-cover` | 01 | The cheat sheet of «Рыночное равновесие» answers itself. Monday names the lines (yellow dots), Tuesday erases them (strike left to right), the counter rolls 6 → 0, the lines come back. 9.6 s loop. **The GIF carries its own card and shadow** (720 × 896 card in an 832 × 984 frame, 1:1), so it settles in. | first frame | GIF 388 KB (10 fps, 64 colours) |
| `sheet` | 09 | The exam page's cheat sheet over two days: named once, erased, a forgotten line returning. 10.4 s loop. | the end state | MP4 ≈ 270 KB, 1152 × 568 |
| `scale` | 12 | The night field, one pull-back: a line → its question → an exam of 400 → a group of 25 → 9 160 dots, one per group, «ваша группа» in yellow. 11 s, plays once, holds. Fades in with its first frame in the show; its poster is its last frame. | the field | MP4 ≈ 1.05 MB (x264 zones) |
| `telegram` | 10 | The app's own Telegram tip clip from the harness: the day card, «Начать», a question, «Верно.», the menu button «Открыть Meldy» (release 43). | the day card | MP4 ≈ 274 KB, 672 × 672 |
| `ph-07`, `ph-08` | 07, 08 | **Placeholders** until the live site is recorded (`media/product/`). | the same | MP4 ≈ 15 KB |

## 4. The slides

Eye order is what the eye takes first, second and third in the still.

| # | Label | Hero | Eye order | Build (after the transition) |
|---|---|---|---|---|
| 01 | Титульный | «Meldy.» 300 px | wordmark → «ИИ не отвечает за студента — он его спрашивает» → the cover card (GIF) → «Тренажёр экзамена по вопросам кафедры» → nomination, QR, «CodingFest-11», F5 hint | label · wordmark rises · dot and squares settle · thesis · tagline · card settles · nomination and QR · hint (2.6 s) |
| 02 | Автор проекта | two author cards | initials avatars → names → roles → institution → region → the strip, explained | counter · cards · avatars, names · institution · region · reading line (2.4 s) |
| 03 | Актуальность | «229 тыс.» | claim → the № 319 card (the attestation rules of higher education, by full name) → on a click «229 тыс.» | claim · card · № 319 · title; *click* 229 тыс. (1.4 + 0.9 s) |
| 04 | Цель, задачи | «0» 420 px | «0 строк осталось» → the erased map → four tasks | caption · map sweeps · tasks 1–4 (2.0 s) |
| 05 | Новизна (dark) | the statement | statement → the table, Meldy's column raised with yellow ticks | the lights are down; the statement rises · header · five rows · ticks cascade · reading line (2.85 s) |
| 06 | Содержание | the five blocks | the blocks as cheat-sheet lines, with the slide of each → «Число и формат» | claim · lines written in · card · chips · note (2.3 s) |
| 07 | Представление блоков проекта | the laptop | claim → the recording → four steps | the screen turns on · claim · steps (1.6 s) |
| 08 | Представление блоков проекта | the phone | claim → the recording → three steps with details | the screen rides in with the bezel · claim · steps · note (2.0 s) |
| 09 | Представление блоков проекта | the laptop with the sheet | claim → the clip → the legend in the map's squares | claim · legend (1.75 s) |
| 10 | Представление блоков проекта | the chat | claim → the chat → «Пригласить группу» → six copies → Telegram | claim · group · copies cascade · Telegram (2.35 s) |
| 11 | Тестирование и продвижение | the path | «Пилот: [N] студентов, [M] дней» → group → department → colleges and universities → the open site | claim · result · three steps · site (2.45 s) |
| 12 | Масштабируемость (dark) | the night field | claim → the field, «ваша группа» → the ladder 1 → 1 → 400 → 25 → ≈ 229 тыс. | the lights are down; the claim rises; 300 ms later the clip fades in and plays; each rung on its stop; «ваша группа» when the field holds (10.6 s, by design) |
| 13 | Используемые источники | — | three groups of sources, typography only | claim · rules wipe, entries fade (2.1 s) |
| 14 | Технические требования | — | the requirements → the stack by layer | claim · two columns · reading line (2.1 s) |
| 15 | Заключение | «Meldy.» 300 px | the wordmark with the strip collapsed into its dot → «пуста: 0 из 10» → recommendations → monetisation → the QR card | lists written in · QR card settles last (2.3 s) |

## 5. Placeholders (to fill or replace before the file is sent)

* 02: names, initials and groups come from `deck/cf11/private/fill.json` (git-ignored): `author1.name`,
  `author1.role`, `author1.initials`, the same for `author2`.
* 11: the pilot's numbers and result.
* 13: the BELTA note's address and the access date.
* The recordings of 07 and 08 (and 09 and 10, if the live recordings replace the clips).
* In the notes: «[Имена называет докладчик.]» (02), «[Результат пилота одной фразой.]» (11), «[меньше копейки —
  сверить 21.10]» (12), the conditional last sentence of 15.

Placeholders in the sources are faint, in brackets and framed with a dashed outline. The private fill replaces its
own text at build time.

## 6. Notes for the compiler (what this markup relies on)

- `settle`, `data-anim-dir`, `data-morph`, `data-fill`, bleed cropping and the Morph lint come from the compiler of
  round 2.
- `data-play`: `with` (the compiler's default since round 2) starts a clip with its entrance, or with the slide
  when it has none, so «with» builds at the clip's moments run alongside it (12's ladder; checked frame by frame in
  `12-in.mp4`).
- Cards that build or move carry `box-shadow` on the marked shape (`.lift`). The shadow becomes the shape's over-layer
  picture and builds and morphs with it.
- The bake of every slide is a flat canvas (`shoot.mjs --bg`); everything visible is a native object or a picture.

## 7. Tools

```
node deck/cf11/design/stamp.mjs                      # the header band (strip, counter, corner) into every slide
node deck/cf11/design/preview/shoot.mjs [NN…] [--build] [--bg] [--morph]   # stills, contact sheet, build strips, bakes, Morph maps
node deck/cf11/design/preview/lint.mjs               # the contract, the scale, tokens per slide, typography
node deck/cf11/design/preview/timeline.mjs [NN…]     # each slide's build as PowerPoint schedules it
deck/cf11/tools/make.sh                              # the PPTX, checks, LibreOffice renders, comparison
deck/cf11/tools/preview/preview.sh                   # the motion preview: deck.mp4, keyframe sheets, morph-log.txt
node deck/cf11/motion/render.mjs title-cover --gif --gif-fps 10 --gif-colors 64 --no-mp4
node deck/cf11/motion/render.mjs sheet
node deck/cf11/motion/render.mjs scale --fps 25 --crf 24 --tune animation --zones "22,55,b=0.45/75,113,b=0.45/132,165,b=0.45/185,242,b=0.45"
node deck/cf11/motion/render.mjs ph-07 --fps 10 ; node deck/cf11/motion/render.mjs ph-08 --fps 10
node deck/cf11/motion/telegram.mjs                   # needs the app harness (Vite on 127.0.0.1:5199)
python3 -I deck/cf11/motion/loopmask.py <frames> <out> <w> <h> --radius 22 --bg '#0b121c' --xfade 15   # fit a recording to a screen
```

A real recording replaces a placeholder by changing `data-src` and `data-poster` on its `<img data-pptx="video">`.
The screens are:

| Slide | Screen | Radius, corners in ink |
|---|---|---|
| 07, 09 | 1152 × 568 | 22 |
| 08 | 392 × 848 | 50 |
| 10 | 672 × 672 | 24 |
