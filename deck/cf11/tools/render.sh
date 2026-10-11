#!/usr/bin/env bash
# Render a built PPTX the way a reader without PowerPoint sees it, and check the file.
#
#   tools/render.sh [deck.pptx] [out dir] [slides.json for titles]
#
#   1. LibreOffice 26.8 (headless, throwaway profile) -> PDF next to the renders
#   2. pdftoppm -> slide-N.png at 1920 px wide, plus a labelled contact sheet
#   3. pdffonts: Onest must be embedded and used; any other font is reported
#   4. size in MB (decimal) and MiB against the 9.5 MB budget
#   5. the pptx skill's validator (schema, relationships, content types)
#
# Environment: SOFFICE (LibreOffice 26.8 soffice; the system 24.2 has no Impress), PYTHON (tools venv),
#              VALIDATE (validate.py of the pptx skill).
set -uo pipefail
TOOLS="$(cd "$(dirname "$0")" && pwd)"
DECK="$(dirname "$TOOLS")"
PPTX="$(realpath "${1:-$DECK/out/meldy-codingfest11.pptx}")"
OUT="${2:-$DECK/out/render}"
TITLES="${3:-$DECK/out/build/slides.json}"
SOFFICE="${SOFFICE:-/tmp/claude-0/-home-user/bdd6a3db-98b1-55d9-a278-b6d3039b029b/scratchpad/deck-refs/tech/lo268/root/opt/libreoffice26.8/program/soffice}"
PYTHON="${PYTHON:-$TOOLS/.venv/bin/python}"
VALIDATE="${VALIDATE:-/mnt/skills/public/pptx/scripts/office/validate.py}"
status=0

[ -f "$PPTX" ] || { echo "no such file: $PPTX"; exit 2; }
[ -x "$SOFFICE" ] || { echo "LibreOffice not found: set SOFFICE to a LibreOffice 26.x soffice"; exit 2; }
mkdir -p "$OUT"
OUT="$(realpath "$OUT")"
rm -f "$OUT"/slide-*.png
base="$(basename "${PPTX%.*}")"

echo "== LibreOffice $("$SOFFICE" --version 2>/dev/null | awk '{print $2}') -> PDF"
PROFILE="$(mktemp -d "${TMPDIR:-/tmp}/cf11-lo-XXXXXX")"
SAL_USE_VCLPLUGIN=svp timeout 300 "$SOFFICE" -env:UserInstallation="file://$PROFILE" --headless --norestore \
  --convert-to pdf --outdir "$OUT" "$PPTX" >/dev/null 2>"$OUT/soffice.log"
rc=$?
rm -rf "$PROFILE"
PDF="$OUT/$base.pdf"
if [ $rc -ne 0 ] || [ ! -s "$PDF" ]; then echo "LibreOffice failed (rc $rc), see $OUT/soffice.log"; exit 1; fi
pages=$(pdfinfo "$PDF" 2>/dev/null | awk '/^Pages:/{print $2}')
echo "   $PDF ($pages pages)"

echo "== renders (1920 px)"
pdftoppm -png -scale-to-x 1920 -scale-to-y 1080 "$PDF" "$OUT/slide"
for f in "$OUT"/slide-*.png; do                       # slide-01.png -> slide-1.png, stable names for compare.py
  n="$(basename "$f" .png | sed 's/^slide-0*//')"; [ "$f" != "$OUT/slide-$n.png" ] && mv "$f" "$OUT/slide-$n.png"
done
if [ -f "$TITLES" ]; then
  "$PYTHON" "$TOOLS/contact_sheet.py" "$OUT" "$OUT/contact-sheet.png" --titles "$TITLES"
else
  "$PYTHON" "$TOOLS/contact_sheet.py" "$OUT" "$OUT/contact-sheet.png"
fi

echo "== fonts in the PDF (pdffonts)"
pdffonts "$PDF" | tee "$OUT/pdffonts.txt" | sed 's/^/   /'
if ! grep -q 'Onest' "$OUT/pdffonts.txt"; then echo "   ✗ Onest is not used"; status=1; fi
if awk 'NR>2 && $0 ~ /Onest/ && $(NF-4) != "yes"' "$OUT/pdffonts.txt" | grep -q .; then echo "   ✗ an Onest face is not embedded"; status=1; fi
others=$(awk 'NR>2 && $1 !~ /Onest/ {print $1}' "$OUT/pdffonts.txt" | sort -u | tr '\n' ' ')
[ -n "$others" ] && echo "   · other fonts in the PDF: $others(fallbacks for glyphs Onest lacks, or pictures' text)"

echo "== size"
bytes=$(stat -c %s "$PPTX")
"$PYTHON" - "$bytes" "$PPTX" <<'EOF'
import sys, zipfile
b = int(sys.argv[1]); z = zipfile.ZipFile(sys.argv[2])
groups = {}
for i in z.infolist():
    k = 'media' if i.filename.startswith('ppt/media/') else 'fonts' if i.filename.startswith('ppt/fonts/') else 'xml+other'
    groups[k] = groups.get(k, 0) + i.compress_size
print(f"   {b/1e6:.3f} MB  = {b/2**20:.3f} MiB   (budget 9.5 MB: {'OK' if b <= 9_500_000 else 'OVER'}, "
      f"headroom {(9_500_000-b)/1e6:.3f} MB)")
print('   ' + ', '.join(f'{k} {v/1e6:.3f} MB' for k, v in sorted(groups.items(), key=lambda kv: -kv[1])))
EOF
[ "$bytes" -le 9500000 ] || status=1

echo "== validate.py (pptx skill)"
if [ -f "$VALIDATE" ]; then
  (cd "$(dirname "$VALIDATE")" && "$PYTHON" "$VALIDATE" "$PPTX") | sed 's/^/   /'
  [ "${PIPESTATUS[0]}" -eq 0 ] || status=1
else
  echo "   validate.py not found (set VALIDATE)"
fi
exit $status
