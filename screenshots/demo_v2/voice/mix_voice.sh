#!/bin/bash
set -e
# 语音起始时刻（毫秒）
declare -A START_MS
START_MS[home]=600
START_MS[tasks]=11800
START_MS[studio]=19000
START_MS[quiz]=27200
START_MS[plan]=37400
START_MS[growth]=44600
START_MS[chat]=51800
START_MS[settings]=60000
START_MS[dark]=69200

ORDER="home tasks studio quiz plan growth chat settings dark"

# 构造 ffmpeg 命令：每段输入加 adelay，最后 amix=9 合并
inputs=""
fc=""
i=0
for s in $ORDER; do
  inputs+=" -i voice/${s}.mp3"
  ms=${START_MS[$s]}
  if [ $i -eq 0 ]; then
    fc+="[${i}:a]adelay=${ms}|${ms}[a${i}]"
  else
    fc+=";[${i}:a]adelay=${ms}|${ms}[a${i}]"
  fi
  i=$((i+1))
done
# amix 合并所有
mix=""
for j in $(seq 0 $((i-1))); do mix+="[a${j}]"; done
fc+=";${mix}amix=inputs=${i}:duration=longest:normalize=0,volume=1.5[aout]"

ffmpeg -hide_banner -loglevel error $inputs -filter_complex "$fc" -map "[aout]" -c:a aac -b:a 128k -y voice/voiceover.m4a
echo "音轨合成完成"
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 voice/voiceover.m4a
