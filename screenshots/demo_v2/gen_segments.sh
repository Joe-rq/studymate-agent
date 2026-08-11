#!/bin/bash
set -e
OUT=1280x720
FPS=30
mkdir -p seg
FONT='C\:/Windows/Fonts/msyh.ttc'

# 每段：文件名 宽 高 持续秒 字幕文本 镜头类型(d=下移down, z=轻微zoom)
# 对长页面(h>900)用下移，短页面用轻微缩放推进
gen() {
  local f="$1" w="$2" h="$3" dur="$4" sub="$5"
  local base="${f%.png}"
  # 先把图缩放到宽1280（保持比例），高度按比例
  local nh=$(awk "BEGIN{printf \"%d\", $h*1280/$w}")
  # 输出高720。zoompan: 视窗1280x720，在缩放后的图上移动
  # 镜头：从顶部开始，缓慢下移到底部（若图高于720），否则居中轻微zoom
  if [ "$nh" -gt 720 ]; then
    # 下移镜头：y 从 0 到 (nh-720)
    local yexpr="(${nh}-720)*on/(${dur}*${FPS}-1)"
    vf="scale=1280:${nh},zoompan=z=1.0:x=0:y='${yexpr}':d=1:s=1280x720:fps=${FPS}"
  else
    # 短图：轻微缩放呼吸 (1.0->1.06) 制造动感，居中
    vf="scale=1280:${nh},pad=1280:720:0:(720-${nh})/2:color=white,zoompan=z='1+0.06*on/(${dur}*${FPS})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1280x720:fps=${FPS}"
  fi
  # 写字幕到临时文件（避免命令行转义）
  echo -n "$sub" > "seg/_sub_${base}.txt"
  # 加字幕 drawtext（底部黑底框）
  vf="${vf},drawtext=fontfile='${FONT}':textfile='seg/_sub_${base}.txt':fontcolor=white:fontsize=28:x=(w-text_w)/2:y=h-70:box=1:boxcolor=black@0.6:boxborderw=10:borderw=1:bordercolor=black@0.7"
  ffmpeg -hide_banner -loglevel error -loop 1 -i "pages/${f}" -t "$dur" -vf "$vf" -c:v libx264 -preset ultrafast -pix_fmt yuv420p "seg/${base}.mp4"
  echo "  生成 ${base}.mp4 (${dur}s, 源${w}x${h}->缩放1280x${nh})"
}

echo "生成各段视频..."
gen home.png 1265 1010 12 "StudyMate Agent — 你的 AI 备考搭子"
gen tasks.png 1280 800 8 "每日任务自动推送，未完成自动顺延"
gen studio.png 1280 800 9 "学习闭环：材料 → 回忆 → 测验 → 反馈"
gen quiz.png 1265 1331 11 "基于今日知识点自动出题，含解析回链"
gen plan.png 1280 800 8 "三阶段计划：学习期 → 巩固期 → 冲刺期"
gen growth.png 1280 800 8 "成长数据：正确率与学习时长趋势"
gen chat.png 1265 877 9 "拟人化搭子 · 跨会话记忆 · 关键时刻介入"
gen settings.png 1265 1280 10 "设置：4 个角色 · 提醒强度 · 桌宠模式"
gen home_dark.png 1440 900 10 "深浅双主题 · 治愈系空间氛围"
echo "全部段生成完成"
