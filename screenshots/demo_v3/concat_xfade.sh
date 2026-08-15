#!/bin/bash
set -e
FPS=30
XFADE=0.8

declare -a SEGS=(home tasks studio quiz growth chat plan settings home_dark)
declare -A DUR=( [home]=20 [tasks]=16 [studio]=20 [quiz]=22 [growth]=16 [chat]=20 [plan]=16 [settings]=20 [home_dark]=21 )

args=""
for s in "${SEGS[@]}"; do args+=" -i seg/${s}.mp4"; done

fc=""
prev="0:v"
offset=0
n=${#SEGS[@]}
for i in $(seq 0 $((n-1))); do
  s=${SEGS[$i]}
  d=${DUR[$s]}
  if [ $i -eq 0 ]; then
    fc+="[0:v]setpts=PTS-STARTPTS,format=yuv420p[v0]"
    prev="[v0]"
    offset=$(awk "BEGIN{printf \"%f\", $offset + $d - $XFADE}")
  else
    fc+=";${prev}[${i}:v]xfade=transition=fade:duration=${XFADE}:offset=${offset}[v${i}]"
    prev="[v${i}]"
    if [ $i -lt $((n-1)) ]; then
      offset=$(awk "BEGIN{printf \"%f\", $offset + $d - $XFADE}")
    fi
  fi
done
total=0
for s in "${SEGS[@]}"; do total=$(awk "BEGIN{printf \"%f\", $total + ${DUR[$s]}}"); done
total=$(awk "BEGIN{printf \"%f\", $total - ($n-1)*$XFADE}")
echo "总时长约: ${total}s, 共 ${n} 段, ${n-1} 个转场"

# 满宽拼接中间产物
ffmpeg -hide_banner -loglevel error $args -filter_complex "$fc" -map "$prev" -c:v libx264 -preset ultrafast -pix_fmt yuv420p -r $FPS -y merged_v3.mp4
echo "拼接完成"
# 收窄至 1080 宽 + 两侧浅灰填充（与 v2 成片风格一致）
ffmpeg -hide_banner -loglevel error -i merged_v3.mp4 -vf "scale=1080:720,pad=1280:720:(ow-iw)/2:0:color=0xEDEDF0" -c:v libx264 -preset ultrafast -crf 20 -pix_fmt yuv420p -r $FPS -an -y studymate_demo_silent.mp4
echo "收窄版静音成片完成"
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 studymate_demo_silent.mp4
