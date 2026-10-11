#!/usr/bin/env bash
# The whole chain: HTML slides -> PPTX -> checks -> LibreOffice renders -> comparison with the HTML.
#
#   tools/make.sh            the deck: slides/ -> out/meldy-codingfest11.pptx (+ out/render/, PDF copy)
#   tools/make.sh fixtures   the compiler's own fixtures: tools/fixtures/ -> out/fixtures/
#
# Steps: [fixture media] -> extract.mjs -> build.py -> check_pptx.py -> render.sh -> compare.py -> lo_roundtrip.py
# Every step runs even when an earlier check fails; the exit status is non-zero if any of them failed.
# Environment: SOFFICE (LibreOffice 26.x), PYTHON (default tools/.venv/bin/python).
set -uo pipefail
TOOLS="$(cd "$(dirname "$0")" && pwd)"
DECK="$(dirname "$TOOLS")"
PYTHON="${PYTHON:-$TOOLS/.venv/bin/python}"
export PYTHON
mode="${1:-deck}"
if [ "$mode" = fixtures ]; then
  SLIDES="$TOOLS/fixtures"; OUT="$DECK/out/fixtures"; PPTX="$OUT/cf11-fixtures.pptx"; RULES=""
  FILL="$TOOLS/fixtures/fill.json"          # fake values; the deck reads deck/cf11/private/fill.json (git-ignored)
  node "$TOOLS/fixtures/make_media.mjs" || exit 1
else
  SLIDES="$DECK/slides"; OUT="$DECK/out"; PPTX="$OUT/meldy-codingfest11.pptx"; RULES="--deck-rules"
  FILL="$DECK/private/fill.json"
fi
BUILD="$OUT/build"
fail=0
step() { echo; echo "=== $*"; }

step "extract ($SLIDES)"
node "$TOOLS/extract.mjs" --slides "$SLIDES" --out "$BUILD" --fill "$FILL" || exit 1
step "build"
"$PYTHON" "$TOOLS/build.py" --build "$BUILD" --out "$PPTX" $RULES || fail=1
[ -f "$PPTX" ] || { echo; echo "BUILD FAILED: no $PPTX (see the errors above)"; exit 1; }
step "check the saved file"
"$PYTHON" "$TOOLS/check_pptx.py" "$PPTX" "$BUILD/slides.json" $RULES || fail=1
step "render with LibreOffice"
"$TOOLS/render.sh" "$PPTX" "$OUT/render" "$BUILD/slides.json" || fail=1
PDF="$OUT/render/$(basename "${PPTX%.*}").pdf"
# the contest wants a PDF copy next to the file; this one is LibreOffice's (static frames, posters, Fade for Morph)
[ -s "$PDF" ] && cp "$PDF" "${PPTX%.*}.pdf" && echo "PDF copy: ${PPTX%.*}.pdf"
step "compare with the HTML"
"$PYTHON" "$TOOLS/compare.py" "$BUILD" "$OUT/render" || fail=1
step "animations as LibreOffice reads them"
"$PYTHON" "$TOOLS/lo_roundtrip.py" "$PPTX" "$BUILD/slides.json" || fail=1
echo
[ $fail -eq 0 ] && echo "ALL GREEN: $PPTX" || echo "SOME CHECKS FAILED (see above): $PPTX"
exit $fail
