# CodingFest-11 deck: how a slide is made

The deck is authored as HTML/CSS slides and compiled into a real PPTX. The HTML is the design; the compiler turns
marked elements into native PowerPoint objects (live text, shapes that Morph, pictures, video) and bakes everything
else into the slide's background picture. Direction and reasons: meldy-notes `40_Decisions/2026-10-10_deck-direction.md`
(rounds 1–8) and, since 19.10.2026, deck v2: direction A «Сцена» with B's rule (every number with its denominator and
a way to check it), since 21.10 four parts (lectures, exams, the test constructor, tests in class «Контрольные»); slide
texts and the talk: meldy-notes
`10_Project/CodingFest_11_Deck_Script.md`.

## Hard limits (from the contest and the jury research)

- 16:9, **15 slides at most**, the 10 mandatory names of Приложение 2 verbatim, in this order: «Титульный», «Автор
  проекта», «Актуальность», «Цель, задачи», «Новизна и инновационность», «Содержание», «Представление блоков проекта»
  (may span several slides), «Используемые источники», «Технические требования», «Заключение». Own slides may sit
  between the blocks and «Используемые источники»; deck v2 has none: the six block slides are 07–08 lectures,
  09–10 exams, 11 the test constructor and 12 «Контрольные» (the test by link and the game in class); testing moves
  to 14 and promotion and scale to 15.
- **No hidden slides** in the submitted file. File **≤ 9.5 MB** (decimal), Latin file name, a PDF copy next to it.
- **No speaker notes and no hidden data in the files the jury gets** (owner, 21.10): `tools/make.sh` builds the PPTX
  without notes (`DECK_NOTES=1` keeps them for a speaker's copy), and `tools/clean.py` leaves only neutral properties
  (title «Meldy»), media without metadata and a PDF without attachments; its check fails the build otherwise. The
  notes stay in the slide sources as the talk text, handed to the speaker separately.
- **No version numbers, dates or measurement footnotes on the slides** (owner, 21.10: «надписи сложные ненужные»):
  the method behind a number goes to the notes' «Если спросят».
- **The static frame is the master copy.** Normal view, the PDF and LibreOffice show every object at its final place;
  animations only add (entrance effects only, no exits, no motion paths that end elsewhere). Nothing essential lives
  only in motion or only in the notes.
- Onest only (static TTFs in `design/fonts/`, embedded in the PPTX). **Deck v2: every slide is the dark stage**
  (`<main class="slide dark">`, `design/stage.css` over `design/deck.css`), the app's own dark theme
  (`frontend/src/index.css` `.dark`): canvas `#0B0F16`, surface `#141A24`, surface-soft `#1B2230`, ink `#F3F3F0`,
  muted `#A7ADB7`, line `#262E3B`, labels `#8DB2F5`, yellow `#F4C45B`. The light Meldy tokens (canvas `#F3F3F0`,
  ink `#0B121C`, …) appear only inside the product: screenshots of the live site, the QR cards, the table column of
  Meldy on 05, the documentation tiles on 13. One real Meldy moment per slide, large; yellow numbered marks (`.mk`)
  tie a line of text to a place on a still screen; never over a video (owner, 21.10: on the constructor's clip «очень
  сильно мешают эти 1 2 3»), a video slide lists its points as plain lines. No gradients, glow, glass, particles, emoji, generated pictures, paper
  or handwriting. **No AI look** (owner, 19.10): no hand-drawn or wavy underline (the app's own marks of the cheat
  sheet stay; frames that show the site's swoosh under a heading are not used), no eyebrow labels (tracked capitals
  over a heading), no «не X — а Y» contrasts, no headings built on an em dash, no slogans, no reassurance captions,
  no «ИИ не придумывает» disclaimers. Plain sentences with real numbers. **Plain words** (owner, 21.10): a juror reads
  a line once from the back of the hall and gets it; one idea per line, no sentences chained through «—», «:» or «·»,
  no own terms (say what happens, not our rule for it). The deck does not show the cheat sheet and puts no law on a
  content slide; the counting rule («верно в два разных дня») lives in the notes only.
- Every number carries its denominator or its parts and where it comes from (a 28 px line under it, or the notes'
  «Если спросят»); a number the notes or the code do not confirm keeps a visible `[…]` slot (`.ph`, yellow) until the
  owner fills it.
- Type on a 1920×1080 slide: the mandatory name 40 px 600 in sentence case, muted, top left (y 48; it is the title
  placeholder, not a label over the claim); the parts «Лекции · Экзамены · Конструктор · Контрольные» or the small
  wordmark top right;
  claim 64–72 px (32–36 pt) 600, two lines at most; the wordmark on 01 and 15 280 px; hero numbers 112–360 px; marked
  lines and lists 32–40 px; sources and «как считается» 28 px (14 pt); nothing under 28 px. One hero per slide; about
  35 words at most outside the reading layer (the list and table slides 02, 04, 05, 06, 13, 14, 15 excepted).

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

- **The header** (deck v2): the mandatory name top left (the title placeholder, `!!title`); top right the small
  wordmark «Meldy» with its yellow dot (`!!dot`) on 02–05, 13, 14, «CodingFest-11» on 01, nothing on 15 (the big
  wordmark), and the four parts «Лекции · Экзамены · Конструктор · Контрольные» (`!!nav`) on 06–12, the current part
  in ink, with «1/2» or «2/2» on the two parts that have two slides. The ten squares of rounds 2–8 («шпаргалка этой защиты») are gone: without their caption the jury could not
  read them.
- **Morph pairs**: `!!word` and `!!dot` (01 → 02 the wordmark's dot shrinks into the corner; 14 → 15 it grows back);
  the three phones of 01 (`!!p1`…`!!p3`, screens `!!s1`…`!!s3`); the part screens of 06 (`!!s1` lectures, `!!s2`
  exams, `!!s3` the constructor, `!!s4` «Контрольные») share names with the hero of the part's first slide (07, 09,
  11; only 06 → 07 is consecutive, so only `!!s1` morphs); `!!nav` stays in place on 06–12.
- **The jury test** (12): the QR opens a real test built in the studio on account A, «Эластичность спроса за
  минуту», open to guests without an account, no time limit, unlimited attempts:
  https://ludosiel-studyforge.hf.space/k/kb0dxmwb21fb (`design/v2/qr-jury.svg`). It must stay published.
