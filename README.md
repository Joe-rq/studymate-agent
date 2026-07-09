# StudyMate Agent

> AI-powered personal exam preparation agent.  
> Upload your PDF/Markdown materials, set the exam date, and get a daily study plan with auto-generated quizzes and mistake feedback.

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
./dist/cli.js init
./dist/cli.js ingest ./demo/materials/micro-economics.md
./dist/cli.js plan --exam 2026-09-15 --daily 60
./dist/cli.js today
./dist/cli.js quiz
./dist/cli.js grade --answers ./demo/answers/2026-07-09_answers.json
```

Without `OPENAI_API_KEY`, the CLI automatically falls back to a mock LLM so the demo loop runs offline.

---

## Features

- **任意资料导入**：支持 PDF 与 Markdown，按标题层级语义切片
- **概念抽取**：LLM 自动提取核心概念与前置依赖，生成学习顺序
- **动态复习计划**：基于艾宾浩斯间隔，分配到考试前的每一天
- **每日任务推送**：生成 Markdown 格式今日任务，可直接在 Obsidian 中查看
- **自动出题**：基于当日知识点生成单选题，附解析与回链
- **即时批改**：客观题自动判分，统计薄弱知识点
- **错题回流**：错题本自动归档，次日计划增加相关复习权重
- **全链路可审计**：每次 Agent 操作追加到 `workspace/event_log/events.jsonl`
- **本地优先 + 离线可用**：所有数据存本地，Mock LLM 支持无网络 Demo

---

## Architecture

```
┌─────────────────────────────────────┐
|  Obsidian / Markdown UI (optional)  |
├─────────────────────────────────────┤
|  CLI (Commander.js)                 |
├─────────────────────────────────────┤
|  Agent 编排层                        |
|  init → ingest → plan → today → quiz → grade
├─────────────────────────────────────┤
|  微 Agent 层                         |
|  MaterialCollector → Chunker        |
|  ConceptMapper → Planner            |
|  TaskDispatcher → QuizGenerator     |
|  Grader → MistakeAnalyzer           |
|  PlanAdjuster                       |
├─────────────────────────────────────┤
|  LLM Layer                          |
|  OpenAI-compatible API / Mock LLM   |
├─────────────────────────────────────┤
|  Local File State                   |
|  workspace/ materials/ chunks/ ...  |
└─────────────────────────────────────┘
```

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

---

## Documentation

- [`docs/PRD_v1.0.md`](docs/PRD_v1.0.md) — original product requirements
- [`docs/PRD_MVP_v0.1.md`](docs/PRD_MVP_v0.1.md) — MVP scope PRD
- [`docs/review_summary.md`](docs/review_summary.md) — design review and reference projects
- [`docs/plans/hackathon-2day-plan.md`](docs/plans/hackathon-2day-plan.md) — 48-hour hackathon battle plan
- [`docs/hackathon-pitch.md`](docs/hackathon-pitch.md) — pitch deck script
- [`docs/demo-script.md`](docs/demo-script.md) — 3-minute demo script
- [`AGENTS.md`](AGENTS.md) — contributor guide for AI agents

---

## License

MIT
