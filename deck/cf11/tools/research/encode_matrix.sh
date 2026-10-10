#!/usr/bin/env bash
# Encode a PNG frame sequence (f0000.png..) into PowerPoint-safe H.264 MP4s at several settings
# and measure size, KB/s and SSIM/PSNR against the lossless source (same scaling, yuv420p).
# Usage: encode_matrix.sh <framesDir> <outDir> <nFrames> <fps> <label>
set -euo pipefail
FR="$1"; OUTD="$2"; N="$3"; FPS="$4"; LABEL="$5"
mkdir -p "$OUTD"
CSV="$OUTD/results.csv"
[ -f "$CSV" ] || echo "label,res,mode,setting,tune,bytes,seconds,kbps,KBps,ssim_all,ssim_min,psnr_avg" > "$CSV"
DUR=$(python3 -c "print($N/$FPS)")

measure () { # $1=file $2=W $3=H
  local f="$1" W="$2" H="$3"
  local s
  s=$(ffmpeg -hide_banner -nostats -i "$f" -framerate "$FPS" -i "$FR/f%04d.png" -frames:v "$N" \
      -lavfi "[1:v]scale=${W}:${H}:flags=lanczos,format=yuv420p[ref];[0:v]format=yuv420p[d];[d][ref]ssim=stats_file=$OUTD/ssim.log" \
      -f null - 2>&1 | grep -o "All:[0-9.]*" | tail -1 | cut -d: -f2)
  local smin
  smin=$(grep -o "All:[0-9.]*" "$OUTD/ssim.log" | cut -d: -f2 | sort -n | head -1)
  local p
  p=$(ffmpeg -hide_banner -nostats -i "$f" -framerate "$FPS" -i "$FR/f%04d.png" -frames:v "$N" \
      -lavfi "[1:v]scale=${W}:${H}:flags=lanczos,format=yuv420p[ref];[0:v]format=yuv420p[d];[d][ref]psnr" \
      -f null - 2>&1 | grep -o "average:[0-9.inf]*" | tail -1 | cut -d: -f2)
  echo "$s,$smin,$p"
}

common=(-c:v libx264 -pix_fmt yuv420p -profile:v high -level:v 4.0 -movflags +faststart -an -preset slow)

for RES in ${RESLIST:-1920x1080 1280x720}; do
  W=${RES%x*}; H=${RES#*x}
  VF="scale=${W}:${H}:flags=lanczos"
  for TUNE in ${TUNES:-none animation}; do
    T=(); [ "$TUNE" != none ] && T=(-tune "$TUNE")
    for CRF in ${CRFS:-18 23 26 28 32}; do
      f="$OUTD/${LABEL}_${H}p_crf${CRF}_${TUNE}.mp4"
      ffmpeg -hide_banner -loglevel error -y -framerate "$FPS" -i "$FR/f%04d.png" -frames:v "$N" -vf "$VF" "${common[@]}" "${T[@]}" -crf "$CRF" "$f"
      B=$(stat -c %s "$f"); KBPS=$(python3 -c "print(round($B*8/1000/$DUR,1))"); KBS=$(python3 -c "print(round($B/1024/$DUR,1))")
      echo "$LABEL,${H}p,crf,$CRF,$TUNE,$B,$DUR,$KBPS,$KBS,$(measure "$f" "$W" "$H")" >> "$CSV"
    done
  done
  # two-pass fixed bitrates (no tune) for budgeting by size
  for BR in ${BRS:-100 200 400 800}; do
    f="$OUTD/${LABEL}_${H}p_2pass${BR}k.mp4"
    ffmpeg -hide_banner -loglevel error -y -framerate "$FPS" -i "$FR/f%04d.png" -frames:v "$N" -vf "$VF" "${common[@]}" -b:v "${BR}k" -pass 1 -passlogfile "$OUTD/x264pass" -f mp4 /dev/null
    ffmpeg -hide_banner -loglevel error -y -framerate "$FPS" -i "$FR/f%04d.png" -frames:v "$N" -vf "$VF" "${common[@]}" -b:v "${BR}k" -pass 2 -passlogfile "$OUTD/x264pass" "$f"
    B=$(stat -c %s "$f"); KBPS=$(python3 -c "print(round($B*8/1000/$DUR,1))"); KBS=$(python3 -c "print(round($B/1024/$DUR,1))")
    echo "$LABEL,${H}p,2pass,${BR}k,none,$B,$DUR,$KBPS,$KBS,$(measure "$f" "$W" "$H")" >> "$CSV"
  done
done
rm -f "$OUTD"/x264pass* "$OUTD/ssim.log"
cat "$CSV" | tail -n +2 | wc -l
