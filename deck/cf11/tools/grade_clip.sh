#!/bin/bash
# The stage deck's clips with a dark ground, graded to the deck's charcoal (design/stage.css, 18.11).
#   tools/grade_clip.sh <in.mp4> <out.mp4> [padX padY]      CRF=16 by default
# Lifts only the darkest tones: the clip's ground 11, 15, 21 becomes 19, 23, 29 and nothing above 100 changes (the
# text, the yellow, the app's screens stay as they are). With padX padY the clip is first put on a 1920 × 1080 frame
# of its own ground colour at that place, so it can be the slide's whole ground (padded in RGB, before the grade:
# the pad and the clip's ground then decode to the same value). Writes <out>.jpg, the first frame, as the poster.
#   dot-intro, dot-finale, title-cover        from media/gen/<name>.mp4
#   oral-film-full, game-film-full            from media/gen/<name>.mp4 with 40 236
#   relevance-zoom-full                       from media/motion/relevance-zoom.mp4 with 672 336
set -e
IN=$1; OUT=$2
LUT="lutrgb=r='clip(val+10.11*max(0\,1-val/100)\,0\,255)':g='clip(val+9.41*max(0\,1-val/100)\,0\,255)':b='clip(val+10.13*max(0\,1-val/100)\,0\,255)'"
PAD=""; [ -n "$3" ] && PAD="pad=1920:1080:$3:$4:color=0x0b0f15,"
ffmpeg -v error -y -i "$IN" -vf "scale=in_color_matrix=bt709:in_range=tv:out_range=pc:flags=neighbor,format=gbrp,${PAD}${LUT},scale=out_color_matrix=bt709:out_range=tv:flags=neighbor,format=yuv420p" \
  -c:v libx264 -preset slow -crf ${CRF:-16} -color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv -movflags +faststart -an "$OUT"
ffmpeg -v error -y -i "$OUT" -frames:v 1 -q:v 1 "${OUT%.mp4}.jpg"
