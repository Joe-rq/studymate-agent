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

## Docs

- `docs/PRD_v1.0.md` — original product requirements
- `docs/PRD_MVP_v0.1.md` — MVP scope PRD
- `docs/review_summary.md` — design review and reference projects
- `docs/plans/2026-07-09-hackathon-mvp.md` — detailed implementation plan
- `docs/hackathon-pitch.md` — pitch deck script
- `docs/demo-script.md` — 3-minute demo script
- `AGENTS.md` — contributor guide for AI agents
