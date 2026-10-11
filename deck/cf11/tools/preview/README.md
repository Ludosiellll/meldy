# Motion preview: the PPTX as PowerPoint is expected to play it

LibreOffice cannot play Morph, and there is no PowerPoint here, so nobody could see the motion before the owner opens
the file. This preview renders the **built PPTX** into video. Most of it comes from the file itself, so it shows what
is in the file, not what the HTML meant. The exceptions are the glyphs of live text, which come from extract's text
layers.

```sh
tools/make.sh                          # build first: the PPTX, <name>.objects.json and the text layers
tools/preview/preview.sh               # the deck   -> out/preview/motion/
tools/preview/preview.sh fixtures      # fixtures   -> out/fixtures/preview/motion/
tools/preview/preview.sh --only 06,07 --size 1920x1080 --gap 1.5 --hold 4 --no-label
```

The deck at 1280×720 takes about 3 minutes (≈ 22 frames/s). Output:

| file | what |
|---|---|
| `deck.mp4` | the whole deck: fade from black, every transition, every build with its trigger, delay and duration, 3 s hold after each slide's last build. H.264, 30 fps, BT.709, ≈ 2 min |
| `NN-in.mp4` | the transition into slide NN, its builds and the hold, alone |
| `keyframes/NN-in.png` | the transition at 0, 25, 50, 75 and 100 % (100 % = the slide's start state, before its builds), plus a **pair map** for a Morph. In the map, blue boxes are pairs forced by a `!!` name and orange boxes are automatic pairs; both carry an arrow where the object travels. Teal dotted boxes are layers travelling with their `!!` owner («layer of !!x»). Red boxes fade out, green boxes fade in, and purple boxes wait for their build. The sheet's header counts the travelling layers |
| `morph-log.txt` | every Morph pair and every unpaired object per transition, with what changes (box, geometry, fill, text, picture, shadow) and the warnings; the header of a transition names the owners whose layers travel with them, and a layer reads `!!x·layer [layer of !!x]` |
| `scenes/NN.json`, `assets/`, `keys/` | the player's input (objects, effects with absolute times) and the pictures, GIF frames and video frames taken out of the PPTX |

A small label at the bottom right of the video shows the slide, the time, the phase and the click count (`--no-label`
turns it off).

## How it works

1. `scene.py` reads the PPTX with `deckpptx/morph.py`. The same reader drives the lint in `check_pptx.py`. It takes:
   * the objects in z-order, with box, rotation, flips, preset or custom geometry (radii from `adj`), fill, outline,
     outer shadow (`a:outerShdw`), picture and `srcRect`, `alphaModFix`, video and poster, and GIF;
   * the transition from the `mc:Choice` (`p159:morph` and its option, `p:fade`) and its `p14:dur`;
   * the main sequence: every click group, sub-group, effect and behaviour node (`set`, `anim` with its `tavLst`
     formulas, `animEffect` filters, `animScale`, `cmd playFrom`), with delays, durations, `accel` and `decel`;
   * the media nodes (`repeatCount`).

   Live text has no pixels in the PPTX. They come from the 2× text layer extract renders for every text box, matched
   through `<name>.objects.json`, which build.py writes next to the PPTX.
2. `player.html` / `player.js` draws a scene on a canvas at any time t. `window.__seek(t)` has no clock, so every
   frame can be reproduced. Shapes are vector paths, re-drawn every frame. Pictures, text layers and video frames are
   bitmaps.
3. `render.mjs` steps through the frames in Chromium (Playwright) and pipes JPEG frames into ffmpeg. `sheet.py`
   builds the keyframe sheets.

## What is emulated

* **Morph pairing.** These rules come from Microsoft's «Morph transition: Tips and tricks»:
  * Two objects of the same type with the same `!!name` morph, whatever their shape, text or picture. A `!!` object
    never pairs with a non-`!!` one.
  * Other objects are matched automatically by type and content: the same preset shape with the same text, or the
    same picture (same bytes).
  * When several identical candidates exist, they are paired in z-order and flagged *ambiguous*. Practitioners
    report PowerPoint's own choice as unpredictable.
* **Paired objects** interpolate box, rotation, fill colour and alpha, outline and corner radius.
  * Rounded rectangles interpolate their radii in px. A circle counts as a rounded rectangle, so the dot can open into
    the window.
  * Any other pair of geometries morphs as an outline sampled around the centre.
  * When the content differs (other text, another picture), the box moves and the two contents crossfade. This is a
    true crossfade: identical content does not dip.
  * The same picture keeps its pixels and interpolates its crop.
  * A layer named `!!x·layer` (the over- or under-layer of a `!!x` owner, see the compiler README) pairs by name like
    any picture, so it moves and scales with its owner; two different layer pictures crossfade in the moving box.
* **Unpaired objects** fade out (old slide) and fade in (new slide) over the whole transition.
* **Shadows.** An `a:outerShdw` is drawn under its object as calibrated against LibreOffice: the silhouette scaled by
  `sx`/`sy` about its centre, moved by `dist` along `dir` (turning with the shape), blurred with σ = `blurRad` / 2.2
  (the build writes 1.1 × the CSS blur, whose σ is half of it), so it looks like the HTML's `box-shadow`. It moves,
  scales, fades and wipes with its object; a pair interpolates two shadows (blur, offset, scale, colour) and fades
  one in or out when only one side has a shadow. An object that fades (unpaired, or a fade build) fades as one
  picture, so its shadow never shows through its own fill.
* **Curve.** Morph uses a symmetric cubic ease-in-out over `p14:dur`. Fade is linear.
* **Z-order during a Morph** follows the new slide. An object that leaves without a partner is drawn just above the
  partner of the nearest paired object that was below it.
* **Builds.** Objects with an entrance effect are hidden until their `set style.visibility` runs; on a Morph slide they
  take no part in the transition (see the assumptions below). Each behaviour node is then evaluated:
  * fade is opacity;
  * `wipe(left|right|up|down)` is a clip that grows from that side across the object's frame (for a text box, its PPTX
    frame including the slack);
  * `ppt_x`/`ppt_y`/`ppt_w`/`ppt_h` formulas are evaluated with `#ppt_*` = the object's final centre and size;
  * `animScale` is applied;
  * easing follows SMIL `accel`/`decel`, on the behaviour and on the effect.
* **Clicks.** The script lives in `slides/preview-clicks.json` (or `--clicks`). Without one, a click comes 1.2 s after
  the previous build ends, a group that starts with the slide starts when the transition ends, and the slide holds
  3 s after its last build. Example:
  `{"gap": 1.2, "hold": 3, "slides": {"07": {"clicks": [0.5, 2.0], "hold": 5}}}` (seconds after the previous build).
* **Video and GIF.** A video shows its poster until its `playFrom` command, then plays from its frames and loops when
  `repeatCount="indefinite"`. During the next transition it freezes on the frame it had reached. The GIF runs from the
  moment the slide appears, with its own frame delays. Slide 1 fades in from black.

## What may differ in real PowerPoint

* **Morph's curve and per-object timing** are not documented. PowerPoint may stagger, ease or fade objects
  differently, for example fading unpaired objects in only half of the transition.
* **Text morph.** Paired text with different content crossfades inside the moving box, and the glyphs scale with the
  box height. PowerPoint re-lays out the text at interpolated font sizes. **Words / Characters** (`data-morph`) also
  match single words or characters between text objects in PowerPoint; the preview matches whole objects only and says
  so in the log.
* **Automatic matching** for objects without `!!` names is an inference from the documentation. PowerPoint may also
  use internal identities (duplicated slides keep them; this file has none) or other criteria. Treat the log's AUTO
  pairs and ambiguous groups as risks.
* **Objects with an entrance effect** are assumed to stay out of the Morph: the old partner fades out and the new one
  builds in afterwards. If PowerPoint morphs them first and then hides them for their build, these objects will
  flicker. The lint in `check_pptx.py` lists every such case.
* **Z-order mid-Morph**, morphing between unlike shapes (PowerPoint morphs vertices) and 3-D effects (none in this
  file) are approximations.
* **Shadows.** PowerPoint's blur radius and the order of scaling and blurring were not measured (LibreOffice scales
  the blurred shadow, which the preview does not copy: it shows the CSS-like result the build aims at). That Morph
  carries a shadow with its object follows from the shadow being part of the object; whether PowerPoint interpolates
  two different shadows, or fades a fading object's shadow as one picture with it, is not documented.
* **Media.** The freeze during a transition and media in a Morph pair (two clips named alike) are untested. Every clip
  in this file is unpaired.
* **Pixels.** Live text is drawn from Chromium's rendering of the HTML (the same Onest), not from PowerPoint's text
  engine, so expect up to a couple of px of difference, as in `compare.py`.
