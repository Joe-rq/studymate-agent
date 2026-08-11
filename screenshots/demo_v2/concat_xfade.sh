#!/bin/bash
set -e
FPS=30
XFADE=0.8   # 转场秒数

# 段顺序与各自时长
declare -a SEGS=(home tasks studio quiz plan growth chat settings home_dark)
declare -A DUR=( [home]=12 [tasks]=8 [studio]=9 [quiz]=11 [plan]=8 [growth]=8 [chat]=9 [settings]=10 [home_dark]=10 )

# 构建 ffmpeg 命令：逐段输入，用 xfade 串联
# 累计偏移 = 之前所有段时长之和 - 之前转场数*XFADE
args=""
for s in "${SEGS[@]}"; do args+=" -i seg/${s}.mp4"; done

# 构建 filter_complex
fc=""
prev="0:v"
offset=0
n=${#SEGS[@]}
for i in $(seq 0 $((n-1))); do
  s=${SEGS[$i]}
  d=${DUR[$s]}
  if [ $i -eq 0 ]; then
    # 第一段：加 setsar/格式统一，作为 v0
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
# 总时长
total=0
for s in "${SEGS[@]}"; do total=$(awk "BEGIN{printf \"%f\", $total + ${DUR[$s]}}"); done
total=$(awk "BEGIN{printf \"%f\", $total - ($n-1)*$XFADE}")
echo "总时长约: ${total}s, 共 ${n} 段, ${n-1} 个转场"

ffmpeg -hide_banner -loglevel error $args -filter_complex "$fc" -map "$prev" -c:v libx264 -preset ultrafast -pix_fmt yuv420p -r $FPS -y merged_v2.mp4
echo "拼接完成"
ffprobe -v error -show_entries format=duration -show_entries stream=nb_frames,r_frame_rate -of default=noprint_wrappers=1 merged_v2.mp4
