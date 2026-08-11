# StudyMate Agent — Demo 视频（v2，纯净画面版）

> **成片**：`studymate_demo.mp4`（1280×720 · 30fps · 78.6 秒 · H.264+AAC · 4.2MB）
> 内容宽度收窄至 1080（高度 720 不压缩），两侧浅灰（#EDEDF0）填充
> **中文配音**（晓伊女声 XiaoyiNeural），各段旁白与画面同步

## 与旧版的区别

旧版用「录整个桌面」的方式录制，画面里全是 VSCode 边框、文件树、终端，StudyMate 界面只占一小块。

**本版换用「纯净截图 + ffmpeg 镜头编排」方案**：
1. 用浏览器自动化对每个页面做 **fullPage 高清截图**（画面只有网页，无任何 IDE 边框）
2. 用 ffmpeg **zoompan** 给每页做缓慢下移/轻微缩放（模拟滚动浏览的镜头感）
3. 用 **xfade** 在页面间做交叉淡入淡出转场
4. 用 **drawtext** 在底部烧录中文字幕（微软雅黑，半透明黑底框）

## 视频内容（9 个分镜）

| 时间 | 页面 | 字幕 |
|---|---|---|
| 0:00 | 首页（浅色，下移镜头） | StudyMate Agent — 你的 AI 备考搭子 |
| 0:11 | 今日任务 | 每日任务自动推送，未完成自动顺延 |
| 0:19 | 学习 Studio | 学习闭环：材料 → 回忆 → 测验 → 反馈 |
| 0:28 | 测验（下移镜头展示题目） | 基于今日知识点自动出题，含解析回链 |
| 0:39 | 计划 | 三阶段计划：学习期 → 巩固期 → 冲刺期 |
| 0:47 | 成长 | 成长数据：正确率与学习时长趋势 |
| 0:55 | 搭子对话 | 拟人化搭子 · 跨会话记忆 · 关键时刻介入 |
| 1:04 | 设置（下移镜头） | 设置：4 个角色 · 提醒强度 · 桌宠模式 |
| 1:14 | 首页（深色主题） | 深浅双主题 · 治愈系空间氛围 |

## 文件说明

| 文件 | 说明 |
|---|---|
| `studymate_demo.mp4` | **最终成片**（带配音：1080 收窄 + 晓伊女声旁白 + 字幕 + 转场） |
| `studymate_demo_silent.mp4` | 静音版（同画面，无配音，适合需现场解说的场合） |
| `studymate_demo_full.mp4` | 满宽原版（内容铺满 1280×720，收窄前的源） |
| `merged_v2.mp4` | 满宽拼接中间产物 |
| `voice/*.mp3` | 各段配音原音频；`voiceover.m4a` 为合成音轨 |
| `pages/*.png` | 各页面 fullPage 高清原图（素材） |
| `seg/*.mp4` | 每个页面的单段视频（带镜头运动+字幕） |
| `gen_segments.sh` | 生成各段的脚本（zoompan + drawtext） |
| `concat_xfade.sh` | xfade 拼接脚本 |

## 如何修改后重新生成

改字幕：编辑 `gen_segments.sh` 里每行的字幕文本，重跑 `bash gen_segments.sh && bash concat_xfade.sh`。
改节奏：编辑 `gen_segments.sh` 里每段的时长数字（第 4 个参数）。

## 配音（edge-tts）

旁白用微软神经网络语音 `zh-CN-XiaoyiNeural`（晓伊，温柔女声）生成，按 xfade 转场后的真实时间轴对齐。

- 文案：`voice/script.txt`（每行 `段名|文案`）
- 各段原音频：`voice/{段名}.mp3`
- 合成音轨：`voice/voiceover.m4a`（`voice/mix_voice.sh` 按时间轴混成）

改文案：编辑 `voice/script.txt`，重跑：
```bash
while IFS='|' read -r name text; do
  python -m edge_tts -v zh-CN-XiaoyiNeural -t "$text" --write-media "voice/${name}.mp3"
done < voice/script.txt
bash voice/mix_voice.sh
# 再混入视频
ffmpeg -i studymate_demo_silent.mp4 -i voice/voiceover.m4a -c:v copy -c:a aac -map 0:v -map 1:a studymate_demo.mp4
```
换音色：把 `XiaoyiNeural` 改成 `YunxiNeural`（云希男声）等即可。
