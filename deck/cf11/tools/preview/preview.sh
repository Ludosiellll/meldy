#!/usr/bin/env bash
# Motion preview of the built PPTX: how PowerPoint is expected to play it (Morph, Fade, builds, video, GIF).
#
#   tools/preview/preview.sh                 the deck: out/meldy-codingfest11.pptx -> out/preview/motion/
#   tools/preview/preview.sh fixtures        the compiler's fixtures -> out/fixtures/preview/motion/
#   options after the mode: --only 06,07  --size 1920x1080  --gap 1.2  --hold 3  --no-label
#
# Needs a build first (tools/make.sh): the PPTX, its <name>.objects.json and the build folder's text layers.
# Output: deck.mp4, NN-in.mp4, keyframes/NN-in.png, morph-log.txt (see tools/preview/README.md).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TOOLS="$(dirname "$HERE")"
DECK="$(dirname "$TOOLS")"
PYTHON="${PYTHON:-$TOOLS/.venv/bin/python}"
export PYTHON
mode="${1:-deck}"
[ $# -gt 0 ] && shift
if [ "$mode" = fixtures ]; then
  PPTX="$DECK/out/fixtures/cf11-fixtures.pptx"; OUT="$DECK/out/fixtures/preview/motion"; CLICKS="$TOOLS/fixtures/preview-clicks.json"
else
  PPTX="$DECK/out/meldy-codingfest11.pptx"; OUT="$DECK/out/preview/motion"; CLICKS="$DECK/slides/preview-clicks.json"
fi
scene_args=(); render_args=()
while [ $# -gt 0 ]; do
  case "$1" in
    --only) scene_args+=(--only "$2"); render_args+=(--only "$2"); shift 2 ;;
    --size|--gap|--hold|--fps) scene_args+=("$1" "$2"); shift 2 ;;
    --no-label) render_args+=(--no-label); shift ;;
    *) echo "unknown option $1"; exit 2 ;;
  esac
done
"$PYTHON" "$HERE/scene.py" --pptx "$PPTX" --out "$OUT" --clicks "$CLICKS" "${scene_args[@]}"
node "$HERE/render.mjs" --motion "$OUT" "${render_args[@]}"
echo "preview: $OUT/deck.mp4, $OUT/keyframes/, $OUT/morph-log.txt"
