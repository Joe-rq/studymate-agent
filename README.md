# StudyMate Agent

AI-powered personal exam preparation agent.

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

Without `OPENAI_API_KEY`, the CLI uses a mock LLM so the demo loop runs offline.

## 拟人化备考搭子 (Personified Study Buddy)

Pick a study companion who talks to you in character, reacts to your quiz scores, and stays in persona across `chat`:

```bash
./dist/cli.js character list          # 查看可选搭子
./dist/cli.js character select shen_ye  # 选择一个（默认陆星野）
./dist/cli.js chat                    # 和搭子多轮对话
```

The buddy also drops a one-liner at the end of `today`, `quiz`, and `grade` — its tone adapts to your latest score, mastery trend, and days-to-exam.

Built-in characters:

| 头像 | 名字 | 定位 |
|------|------|------|
| ☀️ | 陆星野 | 温柔阳光学长，鼓励型 |
| 🌙 | 沈夜 | 高冷学霸，毒舌但用心 |
| 🌸 | 苏念 | 元气少女，活力搭档 |
| 🍡 | 团子 | 治愈萌系小吉祥物 |


## Docs

- `docs/PRD_v1.0.md` — original product requirements
- `docs/PRD_MVP_v0.1.md` — MVP scope PRD
- `docs/review_summary.md` — design review and reference projects
- `docs/plans/2026-07-09-hackathon-mvp.md` — detailed implementation plan
- `docs/hackathon-pitch.md` — pitch deck script
- `docs/demo-script.md` — 3-minute demo script
- `AGENTS.md` — contributor guide for AI agents
