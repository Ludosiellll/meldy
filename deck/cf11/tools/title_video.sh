#!/usr/bin/env bash
# The title slide's video: the whole slide's ground with the dot's arrival (motion/dot-intro.html) and, over it, the
# answer card of the right side (media/motion/title-cover.mp4, 752 × 880 at 1040, 136). The card stands still on its
# first frame, the whole answer, while the dot comes in (6.2 s), then plays its loop for three minutes; after that the
# video holds its last frame. One video, not two: both lie in the same picture, so nothing has to match between them,
# and PowerPoint plays one clip on the slide.
#   bash deck/cf11/tools/title_video.sh        (after: node motion/render.mjs dot-intro --fps 30 --blur 4 --crf 16)
set -euo pipefail
cd "$(dirname "$0")/.."
LEN=180
ffmpeg -hide_banner -loglevel error -y -i media/gen/dot-intro.mp4 -stream_loop 13 -i media/motion/title-cover.mp4 \
  -filter_complex "[0:v]tpad=stop_mode=clone:stop_duration=${LEN}[b];[1:v]tpad=start_mode=clone:start_duration=6.2[c];[b][c]overlay=1040:136:shortest=1" \
  -t "${LEN}" -r 30 -c:v libx264 -preset slow -crf 18 -profile:v high -pix_fmt yuv420p \
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv -movflags +faststart -an media/motion/title-intro.mp4
ffmpeg -hide_banner -loglevel error -y -i media/motion/title-intro.mp4 -frames:v 1 -q:v 2 media/motion/title-intro.jpg
ls -la media/motion/title-intro.mp4 media/motion/title-intro.jpg
