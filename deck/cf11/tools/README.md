# CodingFest-11 deck compiler

HTML/CSS slides (`deck/cf11/slides/NN-*.html`, marked up per `../CONTRACT.md`) → a real PowerPoint file with live
Onest text, native shapes that Morph, pictures, video and entrance animations, then checked against the HTML.

```
slides/NN-*.html ──extract.mjs──▶ out/build/slides.json + img/NN/{bg,ref,eK-*}.png ──imgopt.py (called by extract)
                 ──build.py────▶ out/meldy-codingfest11.pptx
                 ──check_pptx.py, render.sh (LibreOffice 26.8 → PDF → PNG), compare.py, lo_roundtrip.py
```

## Run it

One-time setup (from `deck/cf11/tools/`):

```sh
python3 -m venv .venv && .venv/bin/python -m pip install -r requirements.txt
```

Node 22 with Playwright is needed (`PLAYWRIGHT_MODULE` can point at its `index.mjs`; the default finds
`/opt/node22/lib/node_modules/playwright`), plus ffmpeg/ffprobe, poppler (`pdftoppm`, `pdffonts`) and
LibreOffice 26.x for the renders (`SOFFICE=/path/to/soffice`; the system LibreOffice 24.2 here has no Impress).

The whole chain:

```sh
tools/make.sh            # the deck: slides/ -> out/meldy-codingfest11.pptx (+ PDF copy, renders, comparison)
tools/make.sh fixtures   # the compiler's fixtures: tools/fixtures/ -> out/fixtures/cf11-fixtures.pptx
```

It ends with `ALL GREEN` or lists what failed. Step by step:

| Step | Command | Output |
|---|---|---|
| extract | `node tools/extract.mjs [--slides DIR] [--out DIR] [--only 03,04] [--no-opt]` | `out/build/slides.json`, `out/build/img/NN/*.png` |
| build | `python tools/build.py [--build DIR] [--out FILE.pptx] [--embed all\|used\|none] [--deck-rules]` | the PPTX, a size report, warnings |
| check | `python tools/check_pptx.py FILE.pptx out/build/slides.json [--deck-rules]` | re-opens the file with python-pptx and checks it against the HTML |
| render | `tools/render.sh FILE.pptx out/render out/build/slides.json` | PDF, `slide-N.png` at 1920 px, `contact-sheet.png`, pdffonts, size, the pptx skill's `validate.py` |
| compare | `python tools/compare.py out/build out/render` | `out/render/compare/side-NN.png`, `diff-NN.png`, per-text offsets, exit 1 above 2.5 px |
| animations | `python tools/lo_roundtrip.py FILE.pptx out/build/slides.json` | how LibreOffice reads every effect, trigger, wipe direction, video play/loop |
| tests | `python -m pytest deck/cf11/tools/tests` | unit tests (geometry, runs, fonts, EOT, timing XML vs the ISO schema, transitions, crops) and an integration build |

`--deck-rules` enforces the contest rules: the 10 mandatory names of Приложение 2 in order («Представление блоков
проекта» may repeat on consecutive slides, own slides only between the blocks and «Используемые источники»), at
most 15 slides, ≤ 9.5 MB. The file name must stay Latin; `make.sh` puts LibreOffice's PDF next to the PPTX as the
PDF copy (static frames: posters, Fade instead of Morph). The final step stays with the owner: open the file once
in desktop PowerPoint, check it, and save (see «Needs real PowerPoint»).

## What becomes what

| Marked element | In the PPTX |
|---|---|
| slide | 13.333 × 7.5 in (1 px = 6350 EMU, 2 px = 1 pt), layout «Meldy» (one master, one layout) |
| everything unmarked | one full-bleed background picture `!!bg` (decorative), bottom of the z-order, PNG8 when it shows no banding |
| `title` | the slide's title placeholder (the outline and slide list show the mandatory name as authored; `text-transform: uppercase` becomes `cap="all"`), named `!!title` so the label stays in place under Morph |
| `text` | a text box: runs per colour/weight/size/spacing/underline/strike/link, Onest face per weight (400 `Onest`, 500 `Onest Medium`, 600 `Onest SemiBold`, 700 `Onest` + bold), size px/2 pt, `spc` from letter-spacing, exact line spacing from line-height, `lang` from `<html lang>`, no autofit, zero insets + measured offsets, ≥ 10 % width slack, every soft wrap of the browser as `<a:br/>` |
| `shape` | `rect` / `roundRect` / `ellipse` / `round2SameRect` / custom path from border-radius, fill and outline with alpha, the outline inset by half its width (CSS borders are inside the box) |
| `image` | the element rendered at 2× as a transparent PNG (shadows included), or the `data-src` file (object-fit crop, rounded corners of the box or of a clipping parent); SVG files get an `svgBlip` with a PNG stand-in |
| `gif` | the GIF as a picture (PowerPoint 365 animates it in Normal view too) |
| `video` | MP4 with its poster, autoplay (`mediacall playFrom`), loop (`repeatCount="indefinite"`), click toggles pause |
| `data-name="!!x"` | object name `!!x` (Morph pairs); other objects get unique names like `Text 03.07` |
| `data-anim*` | entrance effect, see below |
| notes template | speaker notes, one paragraph per blank-line block |

## Fidelity measures (and why)

* **Line breaks**: the browser's soft wraps become hard breaks, so slack cannot reflow lines. Slack is 10 % of the
  text width (min 24 px) on the side the alignment allows, so a substituted font ~10 % wider still does not wrap.
* **Vertical metrics**: Impress formats slide text with a font-independent line (1.2 em, baseline 1.0 em below the
  line top: its emulation of PowerPoint, `editeng/impedit3.cxx` "fixed cell height"); an exact line spacing L puts
  the baseline at line top + L − 0.2 em. `research/calibrate_lines.py` measured 0.205 em in LibreOffice 26.8. Frame
  tops and `spcBef` are solved so every first baseline lands on Chromium's.
* **Preset text rectangles**: text in a rounded box is laid out inside the preset's text rectangle (roundRect inset
  r × 0.29289), so the CSS padding is reduced by it.
* **Inline padding/margins, justified text**: the gap between consecutive glyph boxes becomes extra spacing on the
  character before it; justified lines carry their widened spaces explicitly (the paragraph becomes left-aligned).
* **Letter spacing at line end**: CSS keeps the spacing after the last character, LibreOffice drops it; right-aligned
  and centred lines are shifted by that amount through the margins.
* **Layers**: what a native object cannot draw is rendered at 2× and placed next to it: the *over-layer* of a shape
  (its unmarked children, shadow, background image) above it, the *under-layer* of a text (highlight marks, inline
  decorations) below it. A layer animates with its element. Marked descendants are never part of a layer.
* **Video**: LibreOffice ignores `srcRect` on video, so a clip whose aspect differs from its box is re-encoded to the
  visible part (H.264 CRF 20, BT.709, faststart, no audio) and its poster cropped; the build warns, render the clip
  at the box size instead.

Measured on the fixtures (LibreOffice 26.8.1.1): every live text within 1.06 px of the HTML (30 text elements),
2.0–2.7 % of pixels differing by more than 32 levels (anti-aliasing, the GIF frame, link underlines), file 0.46 MB,
`validate.py` PASSED, 483 structural checks passed, every animation read back as intended.

## Entrance animations

| `data-anim` | PowerPoint effect (ru UI) | presetID / Subtype | Behaviours written |
|---|---|---|---|
| `appear` | Appear (Появление) | 1 / 0 | set `style.visibility` |
| `fade` | Fade (Выцветание) | 10 / 0 | set + `animEffect transition="in" filter="fade"` |
| `rise` | Float In, Up (Всплывание) | 42 / 0 | set + fade + `ppt_x` `#ppt_x→#ppt_x` + `ppt_y` `#ppt_y+.1→#ppt_y` (10 % of the slide height, PowerPoint's own value) |
| `wipe` | Wipe, From Left (Появление сбоку, слева) | 22 / 8 | set + `animEffect filter="wipe(left)"` |
| `zoom` | Zoom (Масштабирование, «Subtle» group), Object Center | 53 / 16 | set + `ppt_w`/`ppt_h` 0→full + fade |

Triggers: `click` opens a click group (`clickEffect`), `after` a new sub-group that starts when the previous one ends
(`afterEffect`), `with` joins the current sub-group (`withEffect`). A first effect that is not `click` starts with the
slide (`onBegin`). `data-anim-delay` is the effect's own delay, `data-anim-dur` its duration; order = `data-anim-order`
when given, else DOM order. Text targets get a build entry (`bldP grpId="0"`, `animBg="1"` when the box has a fill).
Media: a video's play command is the last sub-group of the click group in which the video appears (slide start when
it has no entrance), so no «after previous» effect waits for the clip.

Sources: preset ids/subtypes from LibreOffice's PowerPoint import table (`oox/source/ppt/commontimenodecontext.cxx`);
the behaviour XML of appear, fade, rise, zoom and the auto-play/loop video copied from slides saved by Microsoft
Office PowerPoint in LibreOffice's test corpus (`sd/qa/unit/data/pptx/tdf112089.pptx`, `tdf104788.pptx` slide 6,
`tdf112086.pptx`, `tdf124457.pptx`, `bnc591147.pptx`); wipe direction from `oox/source/ppt/pptfilterhelpers.cxx`
(`mbDirection` true = default direction, the filter names the side the wipe starts from); Morph and `p14:dur` from
[MS-PPTX] 2.2.1, 2.6.1.1, 3.1; hyperlink colour and decorative flag from [MS-ODRAWXML] 2.34, 2.35; embedded fonts
from LibreOffice's `vcl/source/font/EOTConverter.cxx`. Transitions: `morph` = `p159:morph option="byObject"` in an
`mc:AlternateContent` with a Fade fallback (1500 ms by default), `fade` = `p:fade` (700 ms), `none` = nothing.

## slides.json

```jsonc
{ "format": "cf11-slides/1", "slide": {"w": 1920, "h": 1080},
  "slides": [{
    "nn": "01", "file": "01-titulny.html", "lang": "ru",
    "transition": {"type": "morph|fade|none", "durMs": null},
    "background": "img/01/bg.opt.png", "backgroundInfo": {"mode": "png8-exact", "bytes": 312},
    "reference": "img/01/ref.png",                 // the HTML as authored, for compare.py
    "notes": ["paragraph", "..."], "warnings": ["..."], "fontsLoaded": ["Onest 600", "..."],
    "elements": [{                                  // DOM order = z-order
      "id": "e15", "type": "title|text|shape|image|video|gif", "domIndex": 14, "name": "!!dot" | null,
      "box": {"x","y","w","h"}, "bbox": {...}, "rot": 0, "scale": 1, "opacity": 1,
      "clip": {...} | null, "clipRadius": {"px", "box"} | null, "href": null, "alt": "aria-label",
      "anim": {"effect": "fade", "trigger": "after", "delayMs": 0, "durMs": 500, "order": null} | null,
      "style": {"fill": {"rgb": "F4C45B", "alpha": 1} | null, "line": {"w", "color", "dash"} | null,
                "lineUniform": true, "radii": [[rx, ry] x4], "shadow": false, "bgImage": false},
      "text": {"insets": {"l","t","r","b"}, "wrapNone": false, "lang": "ru",
               "paragraphs": [{"align": "l|ctr|r", "lineHeightPx": 70.4, "indentPx": 0, "marLPx": 0, "marRPx": 0,
                 "lines": [{"baseline": 520.5, "left": 128, "right": 990, "maxSizePx": 64,
                   "runs": [{"text": "shown text", "raw": "authored text", "weight": 600, "sizePx": 64,
                             "color": {"rgb", "alpha"}, "letterSpacingPx": -1.92, "underline": false,
                             "strike": false, "transform": "none", "baselineShift": 0, "href": null,
                             "ascPx": 62.08, "descPx": 19.52, "gapPx": 7.68}]}]}]},
      "src": {"path": "/abs/file.mp4", "poster": "/abs/poster.png", "loop": true, "autoplay": true,
              "fit": "cover", "position": "50% 50%"},
      "render": {"mode": "image|svg|under|over", "png": "img/01/e15-under.opt.png", "rect": {...},
                 "scale": 2, "format": "png32", "bytes": 1700}
    }]
  }]
}
```

## Needs real PowerPoint (could not be verified here)

* **Open and save once in desktop PowerPoint** before sending: a code-built file can open in Protected View, and a
  save also re-embeds the fonts natively.
* **Morph** playback and pairing by `!!name` (LibreOffice has no Morph and shows the Fade fallback).
* **Timing XML** playback: the effects are byte-for-byte the structures PowerPoint wrote in the sample files, and
  LibreOffice reads every one as intended, but none was played in PowerPoint here; in particular video autoplay +
  loop with entrance effects on the same slide, and the wipe direction.
* **Embedded fonts**: uncompressed EOT, byte-identical to what LibreOffice 26.8 itself embeds in PPTX; whether
  PowerPoint accepts this form (PowerPoint writes its own, possibly MTX-compressed) is unverified. If PowerPoint
  shows a substitute font, install Onest (design/fonts) on the PC, open and save with «Embed fonts».
* **Exact line spacing**: the first-line placement follows LibreOffice's PowerPoint emulation (1.2 em line,
  0.2 em descent); PowerPoint itself was not measured. Expect at most a few px.
* **Hyperlink colour**: inline links carry `ahyp:hlinkClr val="tx"` (keep the text colour) under the extension URI
  `{A12FA001-AC4F-418D-AE19-62706E023703}` from memory; if PowerPoint ignores it, the theme hyperlink colour (set
  to the label blue) applies. PowerPoint and LibreOffice underline run hyperlinks; `data-href` on a whole element is
  a shape click and adds no underline.

## Known limits

* Superscript/subscript: PowerPoint/LibreOffice shrink baseline-shifted runs again (LibreOffice to 58 %); use the
  characters ² ³ ₂. List markers (`::marker`) and generated `::before/::after` text are not live text (warned).
* Rotated text is measured in its rotated box (warned): mark it `image`. Scaled text (`transform: scale`) is fine.
* A transparent layer with a soft shadow stays PNG32 (Pillow's RGBA quantiser bands the shadow; no libimagequant).
* Video crop is a re-encode (warned); a GIF is placed as authored (warned above 0.4 MB).
* Text inside a clipping parent is not clipped (warned); pictures and video are cropped to the clip.

## Contract notes (decisions on gaps in CONTRACT.md)

1. A marked **shape with unmarked content** (a card with UI inside) gets an over-layer picture of that content above
   it; a marked **text with inline decoration** (a `<mark>` highlight, an inline icon) gets an under-layer picture
   below it. Marked descendants are separate objects, after their ancestor in the z-order.
2. A **text element with its own background or border** (a pill) is one native shape with the text inside, at its
   exact box: `wrap="none"` instead of slack, because its box is visible.
3. **Title text** stays as authored (the outline shows «Титульный», not «ТИТУЛЬНЫЙ»); uppercase is `cap="all"`.
   Other text gets `text-transform` applied to the characters.
4. `<br>` and block children start paragraphs (as the contract says); the browser's soft wraps are `<a:br/>` inside
   a paragraph.
5. **Names**: `data-name` is used as given (Morph needs it to start with `!!` and be unique per slide, warned). The
   background is `!!bg` and the title `!!title` on every slide, so both crossfade in place under Morph. Layers are
   named `<name>:over` / `<name>:under`.
6. `data-transition-dur` (ms) on `main.slide` sets the transition length (defaults: Morph 1500 ms, Fade 700 ms).
7. `data-loop` / `data-autoplay` accept `false|0|no|off`. A video without `data-poster` gets frame 0 (warned).
8. `data-src` on an `image` places the file (object-fit/position honoured); an `.svg` is normalised (namespace,
   size) and embedded as SVG with a 2× PNG stand-in, so inline-style SVGs like `reference/qr-try.svg` work.
9. `data-href` on any element is a click action on the whole object; `<a href>` inside a text is a run link.
10. `zoom` is PowerPoint's «Zoom» from the Subtle group (fade + scale from 0); `rise` is «Float In» with PowerPoint's
    10 % rise. Both use PowerPoint's own values so the effect options stay editable.
11. While extracting, `html[data-export="pptx"]` and `window.__PPTX_EXPORT__` are set (CSS can hide preview-only
    bits); finite CSS animations are finished (end state), infinite ones paused at 0, videos paused on the poster.
12. Opacity of an element and its ancestors multiplies into fill/text alpha (rendered pictures already contain it).
13. Elements that are `display:none`, `visibility:hidden` or zero-sized are skipped with a warning.
