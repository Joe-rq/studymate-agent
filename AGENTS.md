# StudyMate Agent — Agent Guide

This file is intended for AI coding agents working on the `studymate-agent` project. It summarizes the project’s purpose, architecture, conventions, build/test workflow, and security considerations based on the actual source code.

---

## Project Overview

StudyMate Agent is an AI-powered personal exam preparation agent. It is a terminal CLI application that guides a user through a study loop:

1. **Initialize** a local workspace.
2. **Ingest** study materials (PDF or Markdown).
3. **Chunk** materials by Markdown headers.
4. **Map** core concepts and prerequisite relationships using an LLM.
5. **Generate** a spaced-repetition study plan up to an exam date.
6. **Dispatch** today’s tasks.
7. **Generate** daily multiple-choice quizzes.
8. **Grade** quiz answers and **analyze** mistakes.

The project follows a 12-Factor Agents style: LLMs produce structured JSON decisions, and TypeScript controls the routing and state. All state is stored locally in the `workspace/` directory, with `workspace/event_log/events.jsonl` acting as the append-only event log.

---

## Technology Stack

- **Runtime:** Node.js >= 20.0.0
- **Language:** TypeScript 5.5 (ES2022, NodeNext module resolution)
- **CLI framework:** Commander.js
- **Testing:** Vitest 1.6 with Node environment and globals enabled
- **PDF parsing:** `pdf-parse`
- **LLM access:** OpenAI-compatible chat completions API via `fetch`
- **State storage:** Local Markdown, JSON, and JSONL files under `workspace/`

---

## Project Structure

```
.
├── src/
│   ├── cli.ts                    # CLI entry point (Commander commands)
│   ├── index.ts                  # Library entry point (currently empty)
│   ├── core/                     # Shared infrastructure
│   │   ├── types.ts              # Event and AppState interfaces
│   │   ├── paths.ts              # Workspace path constants
│   │   ├── workspace.ts          # initWorkspace()
│   │   ├── event_log.ts          # appendEvent(), loadEvents()
│   │   ├── llm.ts                # OpenAI-compatible LLM client
│   │   ├── mock_llm.ts           # Mock LLM client for demo without API key
│   │   ├── character.ts          # Study buddy character schema + load/select/persist
│   │   └── context_reader.ts     # gatherStudyContext(): aggregates mastery/score/weakness
│   ├── characters/               # Built-in buddy personas (JSON)
│   │   ├── lu_xingye.json        # 温柔阳光学长
│   │   ├── shen_ye.json          # 高冷学霸
│   │   ├── su_nian.json          # 元气少女
│   │   └── tuanzi.json           # 治愈萌系吉祥物
│   ├── agents/                   # Domain agents
│   │   ├── material_collector.ts # PDF / Markdown import
│   │   ├── chunker.ts            # Header-based chunking
│   │   ├── concept_mapper.ts     # LLM concept extraction
│   │   ├── planner.ts            # Study plan generation
│   │   ├── task_dispatcher.ts    # Today’s task dispatch
│   │   ├── quiz_generator.ts     # LLM quiz generation
│   │   ├── grader.ts             # Quiz grading
│   │   ├── mistake_analyzer.ts   # Mistake extraction
│   │   ├── mastery_tracker.ts    # EMA mastery update from quiz results
│   │   ├── plan_adjuster.ts      # Plan adjustment based on mistakes
│   │   └── study_buddy.ts        # Personified buddy: chat + key-moment interjections
│   └── prompts/                  # LLM system prompts
│       ├── concept_mapper.txt
│       ├── quiz_generator.txt
│       └── buddy_dialogue.txt    # Study buddy persona/conversation prompt
├── tests/                        # Vitest tests mirroring src/ structure
│   ├── core/
│   └── agents/
├── workspace/                    # Default runtime data directory (gitignored)
├── docs/                         # Project documentation
│   └── plans/
├── dist/                         # Compiled JavaScript output (gitignored)
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

---

## Build and Test Commands

All commands run from the project root.

| Command              | Description                                       |
|----------------------|---------------------------------------------------|
| `npm install`        | Install dependencies                              |
| `npm run build`      | Compile TypeScript (`tsc`) to `dist/`             |
| `npm run dev`        | Run TypeScript compiler in watch mode             |
| `npm run test`       | Run all tests once (`vitest run`)                 |
| `npm run test:watch` | Run tests in watch mode                           |
| `npm run smoke`      | Build CLI and print help (`node dist/cli.js --help`) |

The CLI binary is emitted at `dist/cli.js` and declared in `package.json` as the `studymate` command.

---

## Runtime Architecture and Data Flow

### Workspace Layout

`src/core/paths.ts` defines the default workspace root as `./workspace`. `initWorkspace()` creates:

```
workspace/
├── materials/          # Imported Markdown copies of source files
├── chunks/             # Chunked Markdown files (chunk_001.md, ...)
├── graph/
│   └── concepts.json   # Concept map + topological learning order
├── plan/
│   ├── plan_master.json
│   └── plan_daily/     # Per-day JSON plans (YYYY-MM-DD.json)
├── tasks/              # Daily todo Markdown files
├── quizzes/            # Generated quizzes (JSON + Markdown)
├── results/            # Graded results (JSON + Markdown reports)
├── mistakes/
│   ├── mistake_log.jsonl
│   └── weakness_profile.json
├── progress/
├── buddy/
│   └── chat_history.jsonl  # Study buddy conversation history (JSONL)
├── config.json         # User config (selected buddy character id)
├── prompts/            # Copied/used prompt templates (reserved)
└── event_log/
    └── events.jsonl    # Append-only event log
```

### Event Log

Every agent action appends a JSON line to `workspace/event_log/events.jsonl` with this shape:

```ts
interface Event {
  id: string;
  timestamp: string;
  agent: string;
  action: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
}
```

Use `createEventId()`, `appendEvent()`, and `loadEvents()` from `src/core/event_log.ts` when adding new agents.

### LLM Usage

- `src/core/llm.ts` exposes `createLLMClient()`, which reads `OPENAI_API_KEY`, optional `OPENAI_BASE_URL`, and optional `LLM_MODEL`.
- `completeJSON()` forces JSON-only output and strips Markdown fences before parsing.
- If `OPENAI_API_KEY` is missing, `src/cli.ts` falls back to `createMockLLMClient()` and prints a warning so the demo loop can run offline.

### Command Flow

```
init → ingest (pdf|md) → plan --exam YYYY-MM-DD --daily N → today → quiz → grade --answers file.json
```

- `ingest` imports the file, writes it to `workspace/materials/`, and immediately chunks it into `workspace/chunks/`.
- `plan` reads chunk files, calls `mapConcepts()` with the LLM, topologically sorts concepts, and writes daily plans.
- `today` reads today’s daily plan, dispatches tasks, and writes a Markdown todo file.
- `quiz` reads `workspace/graph/concepts.json`, generates questions with the LLM, and writes quiz files.
- `grade` compares user answers against today’s quiz, writes results, and updates the weakness profile.

### Personified Study Buddy (备考搭子)

A separate interaction layer layered on top of the study loop:

```
character list → character select <id> → chat          # one-time selection + ongoing chat
today / quiz / grade → buddy interjects a one-liner    # automatic, at command end
```

- `character list` scans `src/characters/*.json` and prints each buddy’s name, tagline, and form of address.
- `character select <id>` persists the choice to `workspace/config.json` (`selectedCharacterId`); defaults to `lu_xingye`.
- `chat` opens a REPL that calls `buddyChat()` — each turn reads the persona + `StudyContext` + recent history and appends to `workspace/buddy/chat_history.jsonl`.
- The `today`/`quiz`/`grade` commands call `buddyInterject()` at their end; the one-liner adapts to score, mastery trend, and days-to-exam. Interjections fail silently (never block the main command).
- `src/core/context_reader.ts` (`gatherStudyContext()`) aggregates `concepts.json` (avg mastery), `weakness_profile.json` (weak nodes), `plan_master.json` (days-to-exam), and the latest `results/*_result.json` (score). Every field degrades gracefully to empty/null when files are missing, so the buddy works even on a fresh workspace.

---

## Code Organization and Conventions

- **Agents** live under `src/agents/` and are named after their responsibility (e.g., `chunker.ts`). Each agent typically exports a primary function, an output interface, and writes artifacts + an event log entry.
- **Core infrastructure** lives under `src/core/` and is shared across agents.
- **Prompts** live under `src/prompts/` as plain text files and are loaded at runtime by `concept_mapper.ts` and `quiz_generator.ts`. Fallback strings are hard-coded in case the files are missing.
- **Imports** use `.js` extensions even for TypeScript source files because `tsconfig.json` uses `"module": "NodeNext"`.
- **TypeScript style:** `strict: true`, explicit return types on exported functions, interfaces for domain models.
- **String literals for Chinese UI:** CLI output uses Chinese strings such as `学习` (learn) and `复习` (review) in `today` and task dispatcher output. Keep these consistent when modifying CLI messaging.

---

## Testing Instructions

- Tests are in `tests/` and mirror the `src/` directory layout.
- Vitest is configured with `globals: true`, so `describe`, `it`, `expect`, etc. do not need explicit imports (the tests still import them for clarity).
- Tests create temporary directories under `workspace_test*/` and clean them in `beforeEach` blocks. These directories are gitignored.
- When adding a new agent or core module, add a corresponding test file under `tests/`.
- Mock the LLM client in tests rather than making real API calls. See `tests/agents/concept_mapper.test.ts` for an example.

---

## Configuration and Environment

| Variable            | Purpose                                            | Default                        |
|---------------------|----------------------------------------------------|--------------------------------|
| `OPENAI_API_KEY`    | Required for real LLM calls                        | —                              |
| `OPENAI_BASE_URL`   | OpenAI-compatible API base URL                     | `https://api.openai.com/v1`    |
| `LLM_MODEL`         | Model name passed to the completions endpoint      | `gpt-4o-mini`                  |

No `.env` file is loaded automatically. Set environment variables before running the CLI, or the code falls back to the mock LLM.

---

## Security Considerations

- **API keys:** `OPENAI_API_KEY` is read from the environment only. Never commit keys; `.gitignore` excludes `.env` and `.env.*.local`.
- **Local data:** The `workspace/` directory contains personal study materials and is gitignored. Do not add real user data to the repository.
- **User data boundaries:** The CLI reads files from paths supplied by the user (`ingest`, `grade --answers`). Keep file I/O scoped to the provided paths and the workspace directory.
- **LLM output parsing:** `completeJSON()` strips Markdown fences before `JSON.parse()`, but any new agent that parses LLM output should validate the shape defensively.

---

## Common Development Tasks

- **Add a new CLI command:** Register it in `src/cli.ts` and delegate to an agent function. Prefer keeping command logic thin.
- **Add a new agent:** Create `src/agents/<agent>.ts`, export the primary function and interfaces, append an event log entry, and add tests.
- **Change workspace paths:** Edit `src/core/paths.ts`. `initWorkspace()` dynamically creates directories from all non-file paths in `Paths`.
- **Run the full demo loop locally:**
  ```bash
  npm run build
  node dist/cli.js init
  node dist/cli.js ingest ./demo/materials/sample.pdf
  node dist/cli.js plan --exam 2026-09-15 --daily 60
  node dist/cli.js today
  node dist/cli.js quiz
  node dist/cli.js grade --answers ./demo/answers/answers.json
  ```

---

## Notes for AI Agents

- This is a hackathon MVP. Scope is intentionally narrow: the six CLI commands above form the complete user loop.
- Avoid speculative abstractions. Prefer small, focused changes that match the existing agent pattern.
- Keep LLM prompts as plain text files under `src/prompts/` when they need to be editable; otherwise use a hard-coded fallback inside the agent.
- When modifying event logging, maintain the existing `Event` schema so downstream event consumers remain compatible.
