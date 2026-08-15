#!/bin/bash
set -e
# 语音起始时刻（毫秒），对齐 xfade 转场后的画面时间轴
declare -A START_MS
START_MS[home]=600
START_MS[tasks]=19900
START_MS[studio]=35300
START_MS[quiz]=54500
START_MS[growth]=75700
START_MS[chat]=90900
START_MS[plan]=110100
START_MS[settings]=125300
START_MS[dark]=144500

ORDER="home tasks studio quiz growth chat plan settings dark"

inputs=""
fc=""
i=0
for s in $ORDER; do
  inputs+=" -i voice/${s}.mp3"
  ms=${START_MS[$s]}
  fc+="[${i}:a]adelay=${ms}|${ms}[a${i}]"
  [ $i -gt 0 ] || fc="${fc}"
  i=$((i+1))
  # 分号分隔
  last=$s
done
# 重新构建带分号的 filter_complex
fc=""
i=0
for s in $ORDER; do
  ms=${START_MS[$s]}
  if [ $i -eq 0 ]; then
    fc+="[${i}:a]adelay=${ms}|${ms}[a${i}]"
  else
    fc+=";[${i}:a]adelay=${ms}|${ms}[a${i}]"
  fi
  i=$((i+1))
done
mix=""
for j in $(seq 0 $((i-1))); do mix+="[a${j}]"; done
fc+=";${mix}amix=inputs=${i}:duration=longest:normalize=0,volume=1.5[aout]"

ffmpeg -hide_banner -loglevel error $inputs -filter_complex "$fc" -map "[aout]" -c:a aac -b:a 128k -t 164.6 -y voice/voiceover.m4a
echo "音轨合成完成"
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 voice/voiceover.m4a
