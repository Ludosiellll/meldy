# CodingFest-11 deck compiler

HTML/CSS slides (`deck/cf11/slides/NN-*.html`, marked up per `../CONTRACT.md`) → a real PowerPoint file with live
Onest text, native shapes that Morph, pictures, video and entrance animations, then checked against the HTML.

```
slides/NN-*.html ──extract.mjs──▶ out/build/slides.json + img/NN/{bg,ref,eK-*}.png ──imgopt.py (called by extract)
  (+ private/fill.json)
                 ──build.py────▶ out/meldy-codingfest11.pptx + meldy-codingfest11.objects.json
                 ──check_pptx.py, render.sh (LibreOffice 26.8 → PDF → PNG), compare.py, lo_roundtrip.py
                 ──preview/preview.sh──▶ out/preview/motion/deck.mp4, NN-in.mp4, keyframes/, morph-log.txt
```

The motion preview (Morph, Fade, builds, video, as PowerPoint is expected to play the file) is described in
`preview/README.md`.

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
| extract | `node tools/extract.mjs [--slides DIR] [--out DIR] [--only 03,04] [--no-opt] [--fill FILE]` | `out/build/slides.json`, `out/build/img/NN/*.png` (incl. `eK-text.png`, the glyphs of each text box for the preview) |
| build | `python tools/build.py [--build DIR] [--out FILE.pptx] [--embed all\|used\|none] [--deck-rules]` | the PPTX, `FILE.objects.json` (shape id → element/layer), a size report, warnings (incl. a native shadow reaching past the slide edge); ERRORS (no file) for native objects across the slide edge |
| check | `python tools/check_pptx.py FILE.pptx out/build/slides.json [--deck-rules]` | re-opens the file with python-pptx and checks it against the HTML (incl. one well-formed `a:outerShdw` per native shadow); lint warnings for entrance animations on objects that morph in |
| render | `tools/render.sh FILE.pptx out/render out/build/slides.json` | PDF, `slide-N.png` at 1920 px, `contact-sheet.png`, pdffonts, size, the pptx skill's `validate.py` |
| compare | `python tools/compare.py out/build out/render` | `out/render/compare/side-NN.png`, `diff-NN.png`, per-text offsets, exit 1 above 2.5 px (plus LibreOffice's run-change spacing drift, listed); every native shadow's ring against the HTML, exit 1 above p99 10 grey levels |
| animations | `python tools/lo_roundtrip.py FILE.pptx out/build/slides.json` | how LibreOffice reads every effect, trigger, wipe direction, settle, easing, video play/loop |
| preview | `tools/preview/preview.sh [fixtures] [--only 06,07]` | `out/preview/motion/`: `deck.mp4`, `NN-in.mp4`, `keyframes/NN-in.png`, `morph-log.txt` (not part of `make.sh`: ≈ 3 min) |
| tests | `python -m pytest deck/cf11/tools/tests` | unit tests (geometry, runs, fonts, EOT, timing XML vs the ISO schema, transitions, crops, bleed, Morph pairing, fill, native shadows, travelling layers, preview scenes) and an integration build |

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
| `shape` | `rect` / `roundRect` / `ellipse` / `round2SameRect` / custom path from border-radius, fill and outline with alpha, the outline inset by half its width (CSS borders are inside the box); its `box-shadow` a native outer shadow (Shadows, below) |
| `image` | the element rendered at 2× as a transparent PNG (shadows included), or the `data-src` file (object-fit crop, rounded corners of the box or of a clipping parent, its `box-shadow` a native outer shadow); SVG files get an `svgBlip` with a PNG stand-in |
| `gif` | the GIF as a picture (PowerPoint 365 animates it in Normal view too) |
| `video` | MP4 with its poster, autoplay (`mediacall playFrom`) when it appears (`data-play`, below), loop (`repeatCount="indefinite"`), click toggles pause |
| `data-name="!!x"` | object name `!!x` (Morph pairs), its layer picture `!!x·layer` (travels with it); other objects get unique names like `Text 03.07`, `Shape 03.09:over` |
| `data-shadow="bake"` | the element's `box-shadow` is baked into its layer picture instead of a native shadow |
| `data-anim*` | entrance effect, see below |
| `data-morph="object\|word\|char"` on `main.slide` | the Morph option (`byObject` default, `byWord`, `byChar`) |
| `data-fill="key"` | at extract time the element's text becomes `key`'s value from `deck/cf11/private/fill.json` (git-ignored; `private/fill.example.json` shows the form) and the element gets `data-filled`, so CSS can drop placeholder styling. A missing file or key keeps the placeholder and warns once per key. Personal data reaches only the built PPTX (and `out/`, which git ignores) |
| notes template | speaker notes, one paragraph per blank-line block |

**Slide edge (bleed).** A picture, GIF or layer whose box crosses the slide edge is cropped to the slide (`a:srcRect`,
the rounded corners on a cut side become square); a video is re-encoded to its visible part (warned). A native shape
or live text whose box (text: its line boxes) crosses the edge is a build ERROR: PowerPoint's Normal view shows the
part outside the slide on the pasteboard. The text slack never takes a frame past the edge. A native shadow whose
visible part (its spread box plus 1.5 σ of the blur) reaches past the edge is a warning: the show clips it, Normal view
is expected to show it on the pasteboard; `data-shadow="bake"` bakes it into a cropped layer instead.

## Shadows

A `box-shadow` on a marked element becomes a native DrawingML outer shadow, `a:effectLst/a:outerShdw`, so it travels
and scales with its object under Morph instead of crossfading with the background. One layer is carried: PowerPoint
has one outer shadow per object, so a multi-layer CSS shadow is approximated by its most visible outer layer
(alpha × how far it reaches: blur + 2 × offset + spread; the deck's `--shadow` keeps `0 40px 80px -48px`, its
`0 1px 3px` contact layer at 5 % is dropped). The mapping (`deckpptx/shapes.py`):

| CSS | `a:outerShdw` |
|---|---|
| offset `dx dy` | `dist` = its length, `dir` = its angle (0 = right, 90° = down) |
| blur radius `b` | `blurRad` = 1.1 × b (`research/calibrate_shadow.py`: the factor that matches LibreOffice 26.8 best) |
| spread `s` | `sx` = (w + 2s) / w, `sy` = (h + 2s) / h, `algn="ctr"`: the silhouette shrinks or grows about its centre; both always written (LibreOffice ignores `sy` without `sx`) |
| colour | `srgbClr` + `alpha` (× the element's opacity) |
| rotation | `rotWithShape="1"`: a CSS shadow turns with its element |

CSS paints an outer shadow only outside the box; DrawingML draws it under the whole object. So a shadow is native only
where the object hides it: a shape, or a text with a box, with an opaque fill; a placed `data-src` picture, video or
GIF; opacity 1 and no clip-path. Otherwise, and with `data-shadow="bake"` or any `inset` layer, it is baked as before:
into the over-layer of a shape, the under-layer of a text (a text without a box always bakes: its CSS shadow is the
shadow of a box the PPTX does not draw). A placed file has no layer, so its unbakeable shadow is dropped with a
warning (mark the element `data-pptx="image"` to render it with its shadow). The layer render hides a native shadow.

Measured with LibreOffice 26.8.1.1, in each shadow's ring against the HTML: the deck's ten `.lift` shadows (cards
and the device, round 2) mean 0.2–0.9, p99 3–4 grey levels; the round-1 slides with all 22 cards carrying
`--shadow` themselves (a scratch variant) mean 0.2–1.0, p99 3–4. LibreOffice applies `sx`/`sy` to the blurred
shadow, so its blur shrinks with them; for the deck's cards (`sy` 0.67–0.82) the 1.1 factor absorbs it, but a strong
negative spread on a small box (the fixtures' 140 px card at `sy` 0.2) comes out as a hard band where CSS keeps a
soft one (p99 15): `compare.py` fails such a shadow (p99 above 10) and `data-shadow="bake"` is the per-element way
out (the fixtures' slide 2 card uses it).

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
* **Letter spacing at a run change** (not compensable): LibreOffice also drops *negative* spacing after the last
  character of a run whose attributes differ from the next one (editeng `impedit3.cxx` adds kerning behind a portion
  only when it is positive, "#i9050"). In LibreOffice and its PDF a condensed line with a word in another colour is
  therefore |spacing| px wider per change (measured: −2.16 px → +2.1 px, −10 px → +10.1 px per change; runs with
  equal attributes are merged and unaffected; `research/calibrate_spacing.py`). No run markup makes LibreOffice and
  a CSS-like renderer agree, so the file follows the HTML; `compare.py` allows that drift and lists the elements.
* **Layers**: what a native object cannot draw is rendered at 2× and placed next to it: the *over-layer* of a shape
  (its unmarked children, a shadow that cannot be native, background image) above it, the *under-layer* of a text
  (highlight marks, inline decorations) below it. A layer animates with its element. Marked descendants are never part
  of a layer. **Layers travel**: the layer of a `!!x` owner is named `!!x·layer`, so under Morph it pairs by name
  with the layer of `!!x` on the other slide (over- or under-layer alike) and moves, scales and crossfades with its
  owner instead of fading out in place; two different layer pictures stretch with the box like any paired picture.
  Layers of unnamed owners stay unique (`Shape 03.09:over`). The Morph lint folds a layer into its owner's warning.
* **Video**: LibreOffice ignores `srcRect` on video, so a clip whose aspect differs from its box is re-encoded to the
  visible part (H.264 CRF 20, BT.709, faststart, no audio) and its poster cropped; the build warns, render the clip
  at the box size instead.

Measured on the fixtures (LibreOffice 26.8.1.1): every live text within 1.06 px of the HTML (30 text elements),
1.9–2.7 % of pixels differing by more than 32 levels (anti-aliasing, the GIF frame, link underlines), four native
shadows (a card, a rotated shape, an ellipse, a placed GIF) within mean 0.1–1.1 / p99 1–4 grey levels, file 0.46 MB,
`validate.py` PASSED, 494 structural checks passed, every animation read back as intended.

## Entrance animations

| `data-anim` | PowerPoint effect (ru UI) | presetID / Subtype | Behaviours written |
|---|---|---|---|
| `appear` | Appear (Появление) | 1 / 0 | set `style.visibility` |
| `fade` | Fade (Выцветание) | 10 / 0 | set + `animEffect transition="in" filter="fade"` |
| `rise` | Float In, Up (Всплывание) | 42 / 0 | set + fade + `ppt_x` `#ppt_x→#ppt_x` + `ppt_y` `#ppt_y+.1→#ppt_y` (10 % of the slide height, PowerPoint's own value), the motion decelerating |
| `wipe` | Wipe (Появление сбоку), `data-anim-dir`: `left` (default) From Left, `right` From Right, `up` From Top, `down` From Bottom | 22 / 8, 2, 1, 4 | set + `animEffect filter="wipe(left\|right\|up\|down)"` |
| `zoom` | Zoom (Масштабирование, «Subtle» group), Object Center | 53 / 16 | set + `ppt_w`/`ppt_h` 0→full (decelerating) + fade |
| `settle` | Basic Zoom, In Slightly (Простое увеличение, слегка внутрь) — custom behaviours | 23 / 272 | set + `ppt_w`/`ppt_h` `#ppt_w*0.92→#ppt_w` (decelerating) + fade: the calm entrance, 92 % → 100 % around the centre |

`settle` has no stock preset: PowerPoint's own «In Slightly» scales from 2/3 without a fade (LibreOffice's copy of
the preset, `sd/xml/effects.xml`). The file keeps its id, so PowerPoint's Animation pane shows «Basic Zoom / In
Slightly» and plays the behaviours written; choosing another option there regenerates the stock ones.
**Easing.** PowerPoint writes no `accel`/`decel` for its own Fade, Float In and Zoom (the PowerPoint 2013/2016 samples
above): they are linear. Its eased presets put `decel="100000"` on the motion or scale behaviour (Rise Up: the
`ppt_y` anim; Magnify: the `animScale`), and so does the compiler for the motion of `rise` and the scale of `zoom` and
`settle` (SMIL decelerate 100 % = a quadratic ease-out to a stop); fades stay linear. PowerPoint's «Smooth start/end»
options are, as far as the samples show, the effect-level `accel`/`decel` (tdf111518: a motion path with 50 %/50 %);
those stay 0, so the options read 0 while the motion itself decelerates.

Triggers: `click` opens a click group (`clickEffect`), `after` a new sub-group that starts when the previous one ends
(`afterEffect`), `with` joins the current sub-group (`withEffect`). A first effect that is not `click` starts with the
slide (`onBegin`). `data-anim-delay` is the effect's own delay, `data-anim-dur` its duration; order = `data-anim-order`
when given, else DOM order. Text targets get a build entry (`bldP grpId="0"`, `animBg="1"` when the box has a fill).
**Media (`data-play` on the video).** `with` (the default) starts the clip the moment it appears. The play command
(`mediacall` presetID 1, `playFrom(0.0)`, lasting the clip) sits in the same sub-group as the video's entrance, as a
«With Previous» effect with the entrance's delay. A video without an entrance plays with the first effects of the
slide-start group (alone it is an «After Previous» play, as PowerPoint writes an automatic play). «With» effects with
delays that follow the video's entrance therefore run alongside the clip, for example a step list timed to the
recording's moments. `after` (round 1's placement) appends the play as the last sub-group of the click group, after
its builds. In both modes the delay written for a later «After Previous» sub-group counts the visual effects only,
never the clip's length.

Why the default is `with`: no slide wants its clip to wait on its poster while the texts build, and nothing
downstream depends on the old order. `lo_roundtrip.py` checks the placement (same sub-group and begin as the
entrance, or the first sub-group of the slide-start group) as LibreOffice reads it.

What PowerPoint is expected to do (not played here): its Animation Pane shows the command as «Play» with «Start:
With Previous» in the video's click group. The command begins with its par, so the clip starts with the entrance.
Slide-show playback follows the delays written in the timing tree. If someone re-times that slide in PowerPoint's
Animation Pane, a later «After Previous» effect may be moved to after the Play bar (the clip's length). Timing items
to a clip with «With Previous» and a delay avoids that.

Sources: preset ids/subtypes from LibreOffice's PowerPoint import table (`oox/source/ppt/commontimenodecontext.cxx`);
the behaviour XML of appear, fade, rise, zoom and the auto-play/loop video copied from slides saved by Microsoft
Office PowerPoint in LibreOffice's test corpus (`sd/qa/unit/data/pptx/tdf112089.pptx`, `tdf104788.pptx` slide 6,
`tdf112086.pptx`, `tdf124457.pptx`, `bnc591147.pptx`); wipe direction from `oox/source/ppt/pptfilterhelpers.cxx`
(`mbDirection` true = default direction, the filter names the side the wipe starts from); Morph and `p14:dur` from
[MS-PPTX] 2.2.1, 2.6.1.1, 3.1; hyperlink colour and decorative flag from [MS-ODRAWXML] 2.34, 2.35; embedded fonts
from LibreOffice's `vcl/source/font/EOTConverter.cxx`. Transitions: `morph` = `p159:morph option="byObject|byWord|
byChar"` ([MS-PPTX] 2.6.4.1, from `data-morph`) in an `mc:AlternateContent` with a Fade fallback (1500 ms by
default), `fade` = `p:fade` (700 ms), `none` = nothing.

**Morph lint** (`check_pptx.py`, warnings only). An object with an entrance animation that morphs in from the
previous slide by its `!!` name takes no part in the Morph: the old one fades out and this one builds in afterwards
(its `!!x·layer` builds in with it: one warning, «with its layer»).
This is the design lint's rule, now applied to the file, the compiler's own `!!title` included. Objects that build in
and look like an object of the previous slide (same shape type and text, same picture) are listed per slide as
possible automatic matches. Slide 1 is exempt (no previous slide). The pairing rules are in `deckpptx/morph.py`.

## slides.json

```jsonc
{ "format": "cf11-slides/1", "slide": {"w": 1920, "h": 1080},
  "slides": [{
    "nn": "01", "file": "01-titulny.html", "lang": "ru",
    "transition": {"type": "morph|fade|none", "durMs": null, "option": "object|word|char"},
    "filled": ["author1.name"],                     // data-fill keys that got their private value
    "background": "img/01/bg.opt.png", "backgroundInfo": {"mode": "png8-exact", "bytes": 312},
    "reference": "img/01/ref.png",                 // the HTML as authored, for compare.py
    "notes": ["paragraph", "..."], "warnings": ["..."], "fontsLoaded": ["Onest 600", "..."],
    "elements": [{                                  // DOM order = z-order
      "id": "e15", "type": "title|text|shape|image|video|gif", "domIndex": 14, "name": "!!dot" | null,
      "box": {"x","y","w","h"}, "bbox": {...}, "rot": 0, "scale": 1, "opacity": 1,
      "clip": {...} | null, "clipRadius": {"px", "box"} | null, "href": null, "alt": "aria-label",
      "anim": {"effect": "fade", "trigger": "after", "delayMs": 0, "durMs": 500, "order": null, "dir": "left"} | null,
      "style": {"fill": {"rgb": "F4C45B", "alpha": 1} | null, "line": {"w", "color", "dash"} | null,
                "lineUniform": true, "radii": [[rx, ry] x4], "bgImage": false,
                "shadow": true, "shadows": [{"dx", "dy", "blur", "spread", "color", "inset"}],   // every layer, slide px
                "shadowNative": {"dx": 0, "dy": 40, "blur": 80, "spread": -48, "color": {...}, "dropped": 1} | null,
                "shadowBaked": false},                       // native -> a:outerShdw; baked -> in the layer
      "text": {"insets": {"l","t","r","b"}, "wrapNone": false, "lang": "ru",
               "paragraphs": [{"align": "l|ctr|r", "lineHeightPx": 70.4, "indentPx": 0, "marLPx": 0, "marRPx": 0,
                 "lines": [{"baseline": 520.5, "left": 128, "right": 990, "maxSizePx": 64,
                   "runs": [{"text": "shown text", "raw": "authored text", "weight": 600, "sizePx": 64,
                             "color": {"rgb", "alpha"}, "letterSpacingPx": -1.92, "underline": false,
                             "strike": false, "transform": "none", "baselineShift": 0, "href": null,
                             "ascPx": 62.08, "descPx": 19.52, "gapPx": 7.68}]}]}]},
      "src": {"path": "/abs/file.mp4", "poster": "/abs/poster.png", "loop": true, "autoplay": true,
              "play": "with|after", "fit": "cover", "position": "50% 50%"},
      "render": {"mode": "image|svg|under|over", "png": "img/01/e15-under.opt.png", "rect": {...},
                 "scale": 2, "format": "png32", "bytes": 1700},
      "textLayer": {"png": "img/01/e15-text.png", "rect": {...}, "scale": 2}   // title/text: glyphs alone (preview)
    }]
  }]
}
```

## Needs real PowerPoint (could not be verified here)

* **Open and save once in desktop PowerPoint** before sending: a code-built file can open in Protected View, and a
  save also re-embeds the fonts natively.
* **Morph** playback and pairing by `!!name` (LibreOffice has no Morph and shows the Fade fallback). The motion
  preview (`preview/README.md`) emulates it from the file; its curve, automatic matching, and the handling of objects
  that also build in are assumptions listed there.
* **settle** plays custom behaviours under the «Basic Zoom / In Slightly» id; **easing** is `decel` on behaviour nodes
  (as PowerPoint's own Rise Up and Magnify write it). The Words/Characters Morph options (`data-morph`) are
  schema-checked but not seen in PowerPoint.
* **Timing XML** playback: the effects are byte-for-byte the structures PowerPoint wrote in the sample files, and
  LibreOffice reads every one as intended, but none was played in PowerPoint here; in particular video autoplay +
  loop with entrance effects on the same slide, the play command next to the video's entrance (`data-play="with"`),
  and the wipe direction.
* **Embedded fonts**: uncompressed EOT, byte-identical to what LibreOffice 26.8 itself embeds in PPTX; whether
  PowerPoint accepts this form (PowerPoint writes its own, possibly MTX-compressed) is unverified. If PowerPoint
  shows a substitute font, install Onest (design/fonts) on the PC, open and save with «Embed fonts».
* **Exact line spacing**: the first-line placement follows LibreOffice's PowerPoint emulation (1.2 em line,
  0.2 em descent); PowerPoint itself was not measured. Expect at most a few px.
* **Letter spacing**: PowerPoint is expected to add `spc` after every character, as CSS does (unverified). The
  line-end shift above is calibrated on LibreOffice, so in PowerPoint a right-aligned line may sit up to |spacing|
  (a centred one half of it) off; at a colour change inside a condensed line the file follows CSS.
* **Shadows**: `blurRad` = 1.1 × the CSS blur is calibrated on LibreOffice only; PowerPoint's blur radius, and
  whether it scales a shadow (`sx`/`sy`) before or after blurring it, were not measured. That Morph carries a shadow
  with its object follows from the shadow being part of the object; whether it interpolates two different shadows
  is undocumented (the preview interpolates them). A picture with transparent pixels may cast its shadow from its
  pixels rather than its frame (CSS uses the box); the deck's placed files are opaque.
* **Hyperlink colour**: inline links carry `ahyp:hlinkClr val="tx"` (keep the text colour) under the extension URI
  `{A12FA001-AC4F-418D-AE19-62706E023703}` from memory; if PowerPoint ignores it, the theme hyperlink colour (set
  to the label blue) applies. PowerPoint and LibreOffice underline run hyperlinks; `data-href` on a whole element is
  a shape click and adds no underline.

## Known limits

* Superscript/subscript: PowerPoint/LibreOffice shrink baseline-shifted runs again (LibreOffice to 58 %); use the
  characters ² ³ ₂. List markers (`::marker`) and generated `::before/::after` text are not live text (warned).
* Rotated text is measured in its rotated box (warned): mark it `image`. Scaled text (`transform: scale`) is fine.
* A transparent layer with a soft shadow stays PNG32 (Pillow's RGBA quantiser bands the shadow; no libimagequant).
* One outer shadow per object (the most visible CSS layer); inset shadows are always baked.
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
   background is `!!bg` and the title `!!title` on every slide, so both crossfade in place under Morph. The layer of
   a `!!x` owner is `!!x·layer` (it pairs with the owner's layer on the next slide); other layers are
   `<name>:over` / `<name>:under`, unique per slide.
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
14. `data-anim-dir` names the side a **wipe** starts from, as PowerPoint's «Direction» does: `left` (default),
    `right`, `up` (= From Top), `down` (= From Bottom). On other effects it is ignored with a warning.
15. `data-anim="settle"`: fade + 92 % → 100 % around the centre, decelerating, written under «Basic Zoom / In Slightly»
    (see Entrance animations). The design lint (`design/preview/lint.mjs`) has to accept `settle`, `data-anim-dir`,
    `data-morph`, `data-fill`, `data-play` and `data-shadow`.
16. `data-morph="object|word|char"` on `main.slide` sets the Morph option of the transition *into* that slide.
17. `data-fill="key"`: the private value replaces the element's whole text (its children too) before anything is
    measured, and the element gets `data-filled`. Values are plain text. The file lives next to `slides/`
    (`deck/cf11/private/fill.json`; `extract.mjs --fill` points elsewhere, the fixtures use `fixtures/fill.json`).
18. The slide edge is enforced on the PPTX objects, not the HTML: pictures and layers are cropped, native shapes and
    live text outside it fail the build (see Slide edge). Shadows and decoration baked into the background never move
    with a Morph; they crossfade with the background. A `box-shadow` on the marked element itself does move (note 21).
19. A Morph name on an object that also builds in is a lint warning, not an error. The compiler's own `!!title` and
    `!!bg` count, so an animated title is reported on every Morph slide.
20. `data-play="with|after"` on a `video` (default `with`): the clip starts with its entrance (or the slide's start) or
    after the builds of its click group. See Entrance animations, Media. Unknown values warn and use `with`.
21. `box-shadow` on a marked element is a native outer shadow where it looks like CSS (see Shadows), else baked into
    the element's layer. `data-shadow="bake"` forces the layer, `data-shadow="native"` is the default; other values
    warn. A shadow drawn by a separate unmarked element (deck.css `.shadow`) stays in the background
    picture: to let it travel, put the `box-shadow` on the card itself.
