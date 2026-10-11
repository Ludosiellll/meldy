# CodingFest-11 deck: how a slide is made

The deck is authored as HTML/CSS slides and compiled into a real PPTX. The HTML is the design; the compiler turns
marked elements into native PowerPoint objects (live text, shapes that Morph, pictures, video) and bakes everything
else into the slide's background picture. Direction and reasons: meldy-notes `40_Decisions/2026-10-10_deck-direction.md`;
slide texts and the talk: meldy-notes `10_Project/CodingFest_11_Deck_Script.md`; the look and the three motion ideas:
`reference/board.html`.

## Hard limits (from the contest and the jury research)

- 16:9, **15 slides at most**, the 10 mandatory names of Приложение 2 verbatim, in this order: «Титульный», «Автор
  проекта», «Актуальность», «Цель, задачи», «Новизна и инновационность», «Содержание», «Представление блоков проекта»
  (may span several slides), «Используемые источники», «Технические требования», «Заключение». Own slides
  («Тестирование и продвижение», «Масштабируемость») sit between the blocks and «Используемые источники».
- **No hidden slides** in the submitted file. File **≤ 9.5 MB** (decimal), Latin file name, a PDF copy next to it.
- **The static frame is the master copy.** Normal view, the PDF and LibreOffice show every object at its final place;
  animations only add (entrance effects only, no exits, no motion paths that end elsewhere). Nothing essential lives
  only in motion or only in the notes.
- Onest only (static TTFs in `design/fonts/`, embedded in the PPTX). Meldy tokens only: canvas `#F3F3F0`, surface
  `#FFFFFF`, ink `#0B121C`, muted `#4B515B`, faint `#8A8F97`, line `#E3E3DD`, blue `#2869DD` (pill) / `#1F5BC6` (labels),
  blue-soft `#E8EFFC` (an avatar's round), yellow dot `#F4C45B`, named-once `#E9B13C`, pink tag `#F5B6CD`.
  **Dark stage slides** (05 «Новизна», 12 «Масштабируемость»; `<main class="slide dark">`) use the app's own dark
  theme (`frontend/src/index.css` `.dark`) instead: canvas `#0B0F16`, surface `#141A24`, surface-soft `#1B2230`, ink
  `#F3F3F0`, muted `#A7ADB7`, line `#262E3B`, labels `#8DB2F5`, yellow `#F4C45B`; Morph into and out of them is the
  lights going down and up. No gradients, glow, glass, particles, emoji, generated pictures, paper or handwriting.
- Type on a 1920×1080 slide: mandatory label 40–48 px (20–24 pt) caps 600 blue; claim 72–80 px (36–40 pt) 600, two
  lines at most; a manifesto's statement (05) 96–112 px; the wordmark on 01 and 15 280–320 px; hero numbers 360–440 px;
  steps and lists 44–48 px; sources and «как считается» 28–32 px (14–16 pt); nothing under 28 px. One hero per slide;
  about 35 words at most outside the reading layer (the list slides 02, 13, 14 excepted).

## Geometry

One slide = **1920 × 1080 CSS px = 13.333 × 7.5 in. 1 px = 6350 EMU, 2 px = 1 pt.** The compiler renders each slide
in Chromium at exactly 1920×1080 (device scale 1 for geometry, 2 for pictures).

## Folder

- `slides/NN-slug.html` — one page per slide, `NN` = 01…15 in deck order. Each loads `../design/deck.css`.
- `design/` — `deck.css` (tokens, Onest from `fonts/`), shared parts; `fonts/` — static Onest 400/500/600/700 + `OFL.txt`.
- `motion/` — sources of the moving clips: HTML pages with a deterministic timeline `window.__clip = { T, seek(ms) }`
  (no clock-driven animation), rendered frame by frame to `media/gen/*.mp4|gif|png`.
- `media/product/` — real recordings of the live site (committed: they cannot be regenerated). `media/gen/` is generated
  and ignored by git.
- `tools/` — the compiler and renderers; `tools/research/` — the tested experiments it grew from (Morph XML, video
  autoplay/loop timing, EOT font embedding, frame rendering, encoding).
- `out/` — build output (ignored): `meldy-codingfest11.pptx`, the PDF, slide renders.

## Markup inside a slide

The slide root is `<main class="slide" data-transition="morph|fade|none">` (default `morph`).

| Attribute | Becomes |
|---|---|
| `data-pptx="title"` | The slide's **title placeholder**, text = the mandatory name (the outline and the jury's slide list show it). Exactly one per slide; styled as the small label. |
| `data-pptx="text"` | A **live text box** at the element's box. Read from computed style: font size, weight (400 Onest · 500 Onest Medium · 600 Onest SemiBold · 700 Onest Bold), colour, line height, letter spacing, alignment, `text-transform`. Inline children with another colour/weight become separate runs; block children or `<br>` become paragraphs. The box gets ≥ 10% width slack in PPTX so a substituted font does not wrap differently. |
| `data-pptx="shape"` | A **native shape**: rectangle, rounded rectangle (`border-radius`), ellipse (`border-radius: 50%`), with fill (incl. alpha) and border. Its `box-shadow` becomes the shape's native shadow, which builds and travels with it (`data-shadow="bake"` keeps it in a picture instead; tools/README.md, Shadows). A radius within half a pixel of half the size makes an ellipse. |
| `data-pptx="image"` | The element rendered as a **transparent PNG** at 2× and placed as a picture; or `data-src="../media/…"` to place a file. `alt` from `aria-label`. |
| `data-pptx="video"` + `data-src`, `data-poster`, optional `data-loop`, `data-autoplay` (default on) | An **MP4** with that poster (the poster is what the PDF and a reader see — make it the meaningful frame). |
| `data-pptx="gif"` + `data-src` | An animated GIF (one at most, ≤ 0.4 MB: the title; PowerPoint 365 plays it even in Normal view). |
| `data-name="!!name"` | The **Morph pair name** (any element type). The same name on consecutive slides morphs. |
| `data-href="https://…"` | A hyperlink on the text box or picture. |
| `data-anim="fade|rise|wipe|zoom|appear"`, `data-anim-trigger="after|with|click"` (default `after`), `data-anim-delay` (ms), `data-anim-dur` (ms, default 500), `data-anim-order` (int, default DOM order) | An **entrance** animation. |
| `<template data-pptx="notes">…</template>` | The slide's **speaker notes** (plain text; blank line = new paragraph). |

Everything without `data-pptx` is baked into the slide's background PNG (rendered with the marked elements hidden).
Keep text live wherever it carries meaning (titles, claims, numbers, sources); bake only decoration and complex UI.

## The deck-wide parts

- **The strip** («шпаргалка этой защиты»): 10 squares at the top-left of every slide (x 128, y 56, 22 px squares, 12 px
  gap), one per mandatory section, named `!!s01`…`!!s10`, plus a live counter «осталось N из 10» named `!!left`.
  The current section's square is yellow `#F4C45B`; passed ones are an empty outline (`#8A8F97` at 55%, 2 px); coming
  ones ink. «Представление блоков проекта» keeps one square for all its slides. On «Заключение» the squares gather and
  become the yellow dot of the wordmark «Meldy.» (`!!dot`).
- **The dot** `!!dot`: the wordmark's yellow dot; on the first product slide it grows into the window of the product clip
  (rounded rectangle, same name), and closes back at the end.
