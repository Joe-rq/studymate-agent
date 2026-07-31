# StudyMate Agent

AI-powered personal exam preparation agent with a personified study buddy, web dashboard, and adaptive learning loop.

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

## Docs

- `docs/PRODUCT_INTRO.md` — **product introduction (current stage)**
- `docs/PRD_v1.0.md` — original product requirements
- `docs/PRD_MVP_v0.1.md` — MVP scope PRD
- `docs/review_summary.md` — design review and reference projects
- `docs/plans/` — implementation plans by phase
- `docs/hackathon-pitch.md` — pitch deck script
- `docs/demo-script.md` — 3-minute demo script
- `AGENTS.md` — contributor guide for AI agents
