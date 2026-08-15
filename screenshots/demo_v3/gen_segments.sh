#!/bin/bash
set -e
FPS=30
mkdir -p seg
FONT='C\:/Windows/Fonts/msyh.ttc'

# 每段：文件名 宽 高 持续秒 字幕文本 镜头类型(长图下移，短图轻微缩放)
# v3 加长版：总时长 171s（拼接后约 164.6s ≈ 2:45）
gen() {
  local f="$1" w="$2" h="$3" dur="$4" sub="$5"
  local base="${f%.png}"
  local nh=$(awk "BEGIN{printf \"%d\", $h*1280/$w}")
  if [ "$nh" -gt 720 ]; then
    local yexpr="(${nh}-720)*on/(${dur}*${FPS}-1)"
    vf="scale=1280:${nh},zoompan=z=1.0:x=0:y='${yexpr}':d=1:s=1280x720:fps=${FPS}"
  else
    vf="scale=1280:${nh},pad=1280:720:0:(720-${nh})/2:color=white,zoompan=z='1+0.06*on/(${dur}*${FPS})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1280x720:fps=${FPS}"
  fi
  echo -n "$sub" > "seg/_sub_${base}.txt"
  vf="${vf},drawtext=fontfile='${FONT}':textfile='seg/_sub_${base}.txt':fontcolor=white:fontsize=28:x=(w-text_w)/2:y=h-70:box=1:boxcolor=black@0.6:boxborderw=10:borderw=1:bordercolor=black@0.7"
  ffmpeg -hide_banner -loglevel error -y -loop 1 -i "pages/${f}" -t "$dur" -vf "$vf" -c:v libx264 -preset ultrafast -pix_fmt yuv420p "seg/${base}.mp4"
  echo "  生成 ${base}.mp4 (${dur}s, 源${w}x${h}->缩放1280x${nh})"
}

echo "生成各段视频..."
gen home.png      1280 1008 20 "StudyMate Agent — 你的 AI 备考搭子"
gen tasks.png     1280  800 16 "今日任务 · 专注模式 · 未完成自动顺延"
gen studio.png    1280  800 20 "学习闭环：材料 → 回忆 → 测验 → 反馈"
gen quiz.png      1280 1318 22 "自动出题 · 实时判分 · 解析回链"
gen growth.png    1280 1602 16 "成长数据：Session · 正确率 · 专注时长"
gen chat.png      1280  877 20 "拟人化搭子 · 跨会话记忆 · 关键时刻介入"
gen plan.png      1280  800 16 "三阶段计划：学习 → 巩固 → 冲刺"
gen settings.png  1280 1477 20 "4 个角色 · 提醒强度 · 桌宠模式"
gen home_dark.png 1280 1008 21 "深浅双主题 · 数据本地 · 让备考有人陪"
echo "全部段生成完成"
