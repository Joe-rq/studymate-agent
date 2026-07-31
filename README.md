# StudyMate Agent

AI-powered personal exam preparation agent with a personified study buddy, web dashboard, and adaptive learning loop.

---

## Why StudyMate?

考证党、考研党、在职学习者常遇到这样的问题：

- 教材、笔记、PDF 堆在电脑里，不知道从何开始
- 传统 App 只提供固定题库，无法处理你自己的资料
- 学了后面忘前面，没有基于遗忘曲线的动态复习
- 错题散落各处，无法自动回流到后续计划

**StudyMate Agent = 本地文件驱动的个人备考 Agent**。资料是自己的，计划也是自己的。

---

## Quick Start

```bash
npm install
npm run build

# Create an exam project
studymate init
studymate exam create --name "2026年初级会计资格考试" --date 2026-09-15 --subjects "经济学基础,会计学" --daily 60

# Import study materials
studymate ingest ./materials/micro-economics.md

# Generate a study plan
studymate plan --exam 2026-09-15 --daily 60 --unavailable "2026-08-01,2026-08-08"

# Daily study loop
studymate today          # See today's tasks
studymate quiz           # Generate a daily quiz
studymate grade --answers answers.json  # Grade and adapt
```

Without `OPENAI_API_KEY`, the CLI uses a mock LLM so the full loop runs offline.

## Web UI

A React dashboard served alongside the REST API:

```bash
npm run serve    # Build + start API server and serve web UI (production)
npm run web      # Start Vite dev server for web UI (development)
```

The server exposes a REST API at `/api/*` and serves the static web app at `/`.
The onboarding flow keeps a generated plan in `planned` state until the user
explicitly confirms it.

## Metrics

Track your study progress with four key metrics:

```bash
studymate metrics
```

Outputs: plan completion rate (last 7 days), post-review accuracy, knowledge retention, and question discard rate.

## Knowledge Base

Build and review a persistent knowledge graph from your study materials:

```bash
studymate knowledge build   # Extract concepts and build knowledge base
studymate knowledge status  # Show knowledge base statistics
studymate knowledge review  # Review concepts and confirm understanding
```

## 拟人化备考搭子 (Personified Study Buddy)

Pick a study companion who talks to you in character, reacts to your quiz scores, and stays in persona across `chat`:

```bash
studymate character list            # 查看可选搭子
studymate character select shen_ye  # 选择一个（默认陆星野）
studymate chat                      # 和搭子多轮对话
```

The buddy drops a one-liner at the end of `today`, `quiz`, and `grade` — its tone adapts to your latest score, mastery trend, and days-to-exam. Buddy state (memories, commitments, streak, relationship level) persists across sessions.

Built-in characters:

| 头像 | 名字 | 定位 |
|------|------|------|
| ☀️ | 陆星野 | 温柔阳光学长，鼓励型 |
| 🌙 | 沈夜 | 高冷学霸，毒舌但用心 |
| 🌸 | 苏念 | 元气少女，活力搭档 |
| 🍡 | 团子 | 治愈萌系小吉祥物 |

## Architecture

- **CLI** (`src/cli.ts`): Commander.js commands delegating to agent functions
- **Agents** (`src/agents/`): Focused modules for each step of the study loop
- **API Server** (`src/server/`): Express 5 REST API + static web serving
- **Web UI** (`web/`): React 18 + Vite 5 dashboard
- **Buddy System** (`src/agents/study_buddy.ts`, `buddy_state.ts`, `buddy_interventions.ts`): Personified companion with persistent state, memory, and rule-based interventions
- **Core** (`src/core/`): LLM client, event log (schema v2 with model/token tracking), workspace management, character schema

All state is stored locally in the `workspace/` directory.

## Current Limitations

- **Single-user / single-exam**: Workspace supports one active exam project at a time
- **No voice or animation**: Text-only interaction; no TTS/STT or animated avatars yet
- **Mock LLM**: Without an API key, the mock LLM returns fixed responses for demo purposes
- **Search**: Requires `SERP_API_KEY` for real search; falls back to mock data otherwise
- **Real-world validation pending**: The automated suite uses mock search/LLM;
  a three-day run with real search and a real model is still a release gate

---

## Features

- **考试项目建档**：从考试名称、日期、科目开始，生成完整备考项目（而非先准备资料）
- **备考调研**：搜索官方/经验/资料来源，保留引用与采集时间，用户确认后才入库
- **任意资料导入**：支持 PDF 与 Markdown，按标题层级语义切片，稳定 ID 防覆盖
- **概念抽取**：LLM 提取核心概念与前置依赖，三色 DFS 检测循环，生成学习顺序
- **动态复习计划**：学习期 / 巩固期 / 冲刺期三阶段，SM-2 间隔重复调度复习
- **每日任务推送**：生成 Markdown 今日任务，未完成自动顺延（保留原任务 ID，幂等）
- **自动出题**：基于当日知识点与到期薄弱点生成单选/多选题，附解析与回链
- **即时批改**：客观题自动判分，错误分类与薄弱知识点定位
- **错题回流**：累积式错题画像，掌握度历史，自动插入复习任务
- **学习指标**：计划完成率、复习后正确率、知识保留率、题目弃用率
- **拟人化备考搭子**：4 个可选角色，跨会话记忆，关键时刻介入
- **CLI + Web 双界面**：Commander CLI 与 React 仪表盘，Express REST API
- **全链路可审计**：每次 Agent 操作追加到 `workspace/event_log/events.jsonl`
- **本地优先 + 离线可用**：所有数据存本地，Mock LLM/Mock 搜索支持无网络 Demo

---

## Development

```bash
npm install        # install dependencies
npm run build      # compile TypeScript to dist/
npm run dev        # watch mode
npm test           # run Vitest suite
npm run smoke      # build CLI and print help
```

---

## Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `OPENAI_API_KEY` | Required for real LLM calls | — |
| `OPENAI_BASE_URL` | OpenAI-compatible API base URL | `https://api.openai.com/v1` |
| `LLM_MODEL` | Model name | `gpt-4o-mini` |
| `SERP_API_KEY` | SerpAPI key for exam research search | — (falls back to mock) |

Without an `OPENAI_API_KEY`, the CLI loads variables from `.env.local` if present (see `.env.example`).

---

## Documentation

- [`docs/PRODUCT_INTRO.md`](docs/PRODUCT_INTRO.md) — **product introduction (current stage)**
- [`docs/PRD_v1.0.md`](docs/PRD_v1.0.md) — original product requirements
- [`docs/PRD_MVP_v0.1.md`](docs/PRD_MVP_v0.1.md) — MVP scope PRD
- [`docs/review_summary.md`](docs/review_summary.md) — design review and reference projects
- [`docs/plans/`](docs/plans/) — implementation plans by phase
- [`docs/hackathon-pitch.md`](docs/hackathon-pitch.md) — pitch deck script
- [`docs/demo-script.md`](docs/demo-script.md) — 3-minute demo script
- [`AGENTS.md`](AGENTS.md) — contributor guide for AI agents

---

## License

MIT
