# StudyMate Agent — 项目现状与界面截图

> 截图日期：2026-08-11（demo 视频：2026-08-11）
> 数据来源：本地启动 `npm run serve`（后端 3456 + 内置 Web 前端），示例 workspace（初级会计资格考试）
> 截图分辨率：1440 × 900（静态截图）；demo 视频 1280 × 720

---

## 一、项目当前状态（工程体检）

| 维度 | 现状 |
|---|---|
| **分支** | `main`（领先 upstream/main 50 个提交，工作区干净） |
| **测试** | ✅ **297 / 297 全部通过**（40 个测试文件，Vitest） |
| **后端覆盖率** | 📊 **行覆盖 79.36%**（分支 80.37%，函数 90%） |
| **构建** | ✅ `tsc` 编译通过，`web/dist` 前端构建产物存在 |
| **部署** | ✅ Dockerfile（多阶段）+ docker-compose.yml + GitHub Actions CI |
| **离线可用** | ✅ 无 API Key 时自动降级 Mock LLM / Mock 搜索，全流程可演示 |

### 覆盖率明细（按模块）

| 模块 | 行覆盖 | 说明 |
|---|---|---|
| `src/domain` | **96%** | 领域模型（Exam/Buddy/Learner/Source） |
| `src/agents`（核心逻辑） | **~93%** | 出题/批改/掌握度/计划/搭子/SM-2 |
| `src/core` | **~92%** | LLM 客户端、事件日志、工作区、角色 |
| `src/application/workflows` | **~95%** | 学习闭环编排 |
| `src/infrastructure` | **~60%** | SerpAPI/WebFetcher（需真实 Key，单测覆盖有限） |
| `src/server` | **~46%** | Express 路由层（有 API 测试，但分支较多） |

> 基础设施和服务层拉低了整体数字；核心业务逻辑（agents / domain / core / workflows）覆盖率在 92% 以上。

---

## 二、界面截图清单

所有截图为本仓库 Web UI（React 18 + Vite 5）的真实渲染结果，启动方式：

```bash
npm install && npm run demo   # 生成示例数据
npm run serve                 # 启动 http://localhost:3456
```

| 文件 | 页面 | 路由 | 说明 |
|---|---|---|---|
| `01_dashboard.png` | 首页 Dashboard（浅色/暖米色） | `/` | Today Focus 大卡 + 统计 + 今日任务 + 搭子观察 + 浮动桌宠 |
| `02_tasks.png` | 今日任务 | `/tasks` | 每日学习/复习任务清单 |
| `03_studio.png` | 学习闭环 Studio | `/studio` | 材料 → 回忆 → 测验 → 反馈 → 复盘 |
| `04_quiz.png` | 测验 | `/quiz` | 单选/多选题作答界面 + 解析 |
| `05_plan.png` | 复习计划 | `/plan` | 三阶段计划 + 日历视图 |
| `06_growth.png` | 成长数据 | `/growth` | Session 历史 + 正确率/时长趋势（recharts） |
| `07_chat.png` | 搭子对话 | `/chat` | 与拟人化备考搭子多轮对话 |
| `08_settings.png` | 设置 | `/settings` | 角色选择、偏好、主题 |
| `09_dashboard_dark.png` | 首页 Dashboard（深色/深蓝） | `/` | 深色主题呈现 |

> 注：测验/批改/成长页的图表与错题数据取决于 workspace 中是否有批改结果。
> 当前示例 workspace 已含考试项目、4 个概念、今日计划与测验；如需完整错题回流演示，可运行：
> `node dist/cli.js grade --answers demo/answers/2026-07-13_answers.json`

---

## 二·5、Demo 视频（含中文配音）

**成片**：[`demo_v2/studymate_demo.mp4`](demo_v2/studymate_demo.mp4)（1280×720 · 30fps · 78.6 秒 · 带旁白）

一段覆盖全部页面的产品演示视频，**画面纯净**（只有 StudyMate 界面，无任何 IDE 边框），配晓伊女声中文旁白，底部同步字幕。

| 分镜 | 页面 | 旁白 |
|---|---|---|
| 1 | 首页（浅色） | StudyMate Agent，你的 AI 备考搭子。教材进，成绩出，整个学习闭环交给 AI |
| 2 | 今日任务 | 每日任务自动推送，当天没学完的会自动顺延到明天 |
| 3 | 学习 Studio | 学习闭环：从材料、主动回忆，到测验、反馈和复盘，一站完成 |
| 4 | 测验 | 基于今天学的知识点自动出题，每道题都带回链和解析 |
| 5 | 计划 | 三阶段复习计划：学习期、巩固期、冲刺期，科学分配 |
| 6 | 成长 | 成长数据一目了然：正确率和学习时长的趋势曲线 |
| 7 | 搭子对话 | 拟人化备考搭子，跨会话记住你的进度，关键时刻主动鼓励 |
| 8 | 设置 | 四个角色任选，提醒强度、桌宠模式都能自由设置 |
| 9 | 首页（深色） | 深浅双主题切换，治愈系的空间氛围，陪你专注每一刻 |

**制作方式**（不同于「录整个桌面」）：浏览器 fullPage 高清截图 → ffmpeg `zoompan` 镜头运动 + `xfade` 转场 + `drawtext` 字幕 → edge-tts（晓伊女声）配音混音。详见 [`demo_v2/README.md`](demo_v2/README.md)。

可选版本：`demo_v2/studymate_demo_silent.mp4`（静音版，适合现场口头解说）。

---

## 三、产品能力一句话

一个「教材进、成绩出」的本地优先 AI 备考 Agent：上传 PDF/Markdown → 概念抽取 → 三阶段计划 → 每日任务 → 自动出题 → 即时批改 → 错题回流 → SM-2 间隔复习，外加 4 个拟人化备考搭子（跨会话记忆 / 连续打卡 / 关键时刻介入）。

### 完整学习闭环

```
学习材料 → 概念抽取 → 知识图谱 → 计划生成 → 每日任务 → 测验 → 批改 → 错题回流 → 掌握度更新 → 计划调整（回到计划）
```

---

## 四、技术栈

- **后端**：Node.js ≥ 20 + TypeScript 5.5（ES2022 / NodeNext）
- **CLI**：Commander.js
- **API**：Express 5（REST，`/api/*`）
- **前端**：React 18 + Vite 5 + react-router-dom 6 + recharts
- **LLM**：OpenAI 兼容 Chat Completions（`fetch`），无 Key 走 Mock
- **数据**：本地文件驱动（`workspace/` 下的 JSON / JSONL / Markdown）
- **测试**：Vitest 1.6（globals + node 环境）

---

## 五、代码规模

| 类别 | 数量 |
|---|---|
| 后端源文件（`src/**/*.ts`） | 50+ |
| 前端源文件（`web/src/**/*.{ts,tsx}`） | 28 |
| 测试文件（`tests/**`） | 40 |
| 内置搭子角色 | 4（晴川 / 凛川 / 柚宁 / 芽团） |
| Agent 模块 | 17（含 buddy_state / buddy_interventions） |

---

## 六、已知限制

- 单用户 / 单考试项目
- 真实搜索依赖 `SERP_API_KEY`、真实 LLM 依赖 `OPENAI_API_KEY`（否则 Mock）
- 前端暂无单测，以 `tsc -b && vite build` + 手动验收为主
- 尚未保存一份真实搜索 + 真实 LLM 的连续三日金样本验收记录

更多细节见根目录 [`README.md`](../README.md) 与 [`docs/PRODUCT_INTRO.md`](../docs/PRODUCT_INTRO.md)。
