# StudyMate Agent — Demo 视频（v3，加长版 2:45，新 UI 重录）

> **成片**：`studymate_demo.mp4`（1280×720 · 30fps · 164.6 秒 · H.264+AAC · 7.7MB）
> 画面与 v2 同风格：内容收窄至 1080 宽，两侧浅灰（#EDEDF0）填充
> **中文配音**（晓伊女声 XiaoyiNeural），旁白按 xfade 转场后的真实时间轴对齐

## 本次重录（2026-08-15）

项目合并了 web-ui-redesign（PR #5）等多项更新，本片全部画面按最新 UI 重新截图录制：

- **重新截图**：`scripts/capture-demo-pages.mjs`（playwright-core + 系统 Edge headless，
  fullPage 1280 宽，深色页通过 `localStorage['studymate-theme']='dark'` 注入）
- **演示数据**：`npm run demo` 重新种 CPA 会计基础数据，并补充
  `workspace/progress/session_history.jsonl` 6 天学习闭环记录（正确率 60%→100% 爬升），
  让 Growth 页趋势图与首页「今日学习时长」有真实数据
- **文案对齐新 UI**：首页提「学习图谱」、任务页提「专注模式」、测验页改为
  「知识点标注 + 掌握度同步更新」、成长页对齐 Session 统计口径、搭子页提
  「一句话减轻明日任务」

## 视频内容（9 个分镜）

| 时间 | 页面 | 字幕 | 旁白要点 |
|---|---|---|---|
| 0:00 | 首页（浅色，下移镜头） | StudyMate Agent — 你的 AI 备考搭子 | 开场 + 学习图谱 |
| 0:19 | 今日任务 | 今日任务 · 专注模式 · 未完成自动顺延 | 任务 + 专注模式 + 顺延 |
| 0:34 | 学习 Studio | 学习闭环：材料 → 回忆 → 测验 → 反馈 | 四步闭环 + 掌握度实时更新 |
| 0:53 | 测验（下移镜头） | 自动出题 · 实时判分 · 解析回链 | 知识点标注、解析回链、掌握度更新 |
| 1:14 | 成长（下移镜头） | 成长数据：Session · 正确率 · 专注时长 | 趋势曲线 + 历史记录 |
| 1:30 | 搭子对话 | 拟人化搭子 · 跨会话记忆 · 关键时刻介入 | 记忆、调整任务、关键时机介入 |
| 1:49 | 计划 | 三阶段计划：学习 → 巩固 → 冲刺 | 三阶段 + 动态调整 |
| 2:04 | 设置（下移镜头） | 4 个角色 · 提醒强度 · 桌宠模式 | 四种人格角色与定制 |
| 2:23 | 首页（深色主题） | 深浅双主题 · 数据本地 · 让备考有人陪 | 数据本地 + 收尾口号 |

## 文件说明

| 文件 | 说明 |
|---|---|
| `studymate_demo.mp4` | **最终成片**（配音 + 字幕 + 转场 + 结尾 3s 余韵） |
| `studymate_demo_silent.mp4` | 静音版（同画面，适合现场解说） |
| `merged_v3.mp4` | 满宽拼接中间产物 |
| `voice/script.txt` | 旁白文案（`段名|文案`） |
| `voice/{段名}.mp3` · `voice/voiceover.m4a` | 各段配音与合成音轨 |
| `pages/*.png` | 各页面 fullPage 高清截图（最新 UI） |
| `seg/*.mp4` | 每个页面的单段视频（镜头运动 + 字幕） |
| `gen_segments.sh` / `concat_xfade.sh` / `voice/mix_voice.sh` | 生成脚本 |

## 如何重新截图 + 重新生成

```bash
npm run build && npm run demo          # 构建并种演示数据
node scripts/seed-extra-sessions.mjs   # （可选）补 session 历史让成长页有曲线
node dist/server/index.js              # 启动服务（另一终端）
node scripts/capture-demo-pages.mjs    # 重截全部页面（--only growth,home 可过滤）
cd screenshots/demo_v3
bash gen_segments.sh && bash concat_xfade.sh
# 改旁白：编辑 voice/script.txt 后重跑 TTS
while IFS='|' read -r name text; do
  python -m edge_tts -v zh-CN-XiaoyiNeural -t "$text" --write-media "voice/${name}.mp3"
done < voice/script.txt
bash voice/mix_voice.sh
ffmpeg -i studymate_demo_silent.mp4 -i voice/voiceover.m4a -c:v copy -c:a aac -b:a 128k \
  -map 0:v -map 1:a -af apad -t 164.6 -y studymate_demo.mp4
```

改时长需同步改：`gen_segments.sh` 每段秒数 → `concat_xfade.sh` 的 `DUR` → `voice/mix_voice.sh` 的 `START_MS`。
