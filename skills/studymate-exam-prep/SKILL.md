---
name: studymate-exam-prep
description: "Turn a user's own PDF or Markdown study materials, exam date, subjects, and daily time budget into a local-first adaptive exam-preparation loop: ingest materials, extract concepts, generate a capacity-checked plan, dispatch daily tasks, create source-grounded quizzes, grade answers, identify weaknesses, and schedule SM-2 reviews. Use for certification exams, postgraduate entrance exams, workplace learning, or other structured study requests that should be grounded in the user's materials."
---

# StudyMate Adaptive Exam Prep

Build and operate a verifiable study loop from the learner's own materials. Keep study data local by default, use the Mock path when no model key is available, and distinguish generated guidance from verified learning results.

## Required inputs

Collect or infer these values before creating the plan:

- Exam name and exam date in `YYYY-MM-DD`
- Subject list
- Daily study minutes
- Learner baseline: `beginner`, `intermediate`, or `advanced`
- One or more `.pdf` or `.md` study-material paths supplied by the user
- Optional target score and unavailable dates

Reject unsupported file types. Do not discover or ingest unrelated local files.

## Protect existing data

1. Locate the StudyMate project root by finding `package.json` with `name: studymate-agent`.
2. Inspect `workspace/` before any write.
3. Preserve an existing study workspace unless the user explicitly asks to replace it.
4. Do not run `npm run demo` on an existing workspace without confirmation; it replaces the active demo data after creating a backup.
5. Never include `.env*`, API keys, access tokens, private study materials, or `workspace/` contents in shared artifacts.

## Choose the operating surface

- Prefer the Web flow for a learner who wants to upload materials, study interactively, and view progress.
- Prefer the CLI flow for reproducible automation, terminal demos, or artifact verification.
- Use the Mock LLM automatically when `OPENAI_API_KEY` is absent. State that Mock results prove workflow execution, not real-model quality.
- Skip online exam research when `SERP_API_KEY` is absent; continue with user-provided local materials.

## Preflight

Run from the project root:

```powershell
node --version
npm run build
node dist/cli.js --help
```

Require Node.js 20 or newer. If dependencies are missing, ask before a networked install, then use the repository's existing package manager and lockfile.

## Web workflow

1. Start the application:

   ```powershell
   npm run serve
   ```

2. Open `http://127.0.0.1:3456`.
3. Create the exam project with the confirmed name, date, subjects, baseline, target, daily minutes, and unavailable dates.
4. Upload only the user's `.pdf` or `.md` files. The server accepts allowlisted files up to 20 MiB and deletes its temporary upload after import.
5. Build the knowledge base. Stop if zero materials, zero chunks, or zero concepts are produced.
6. Generate and approve the plan. Surface `capacity.unscheduledConceptIds`; never claim complete coverage when this list is non-empty.
7. Use `/studio` for the daily loop: focus → recall → quiz → feedback → reflection.
8. Complete grading through `/api/studio/grade`. Treat the server result as authoritative; never calculate or submit a fabricated score from the client.
9. Review `/growth`, weaknesses, mastery changes, and the next SM-2 review date.

## CLI workflow

Initialize the workspace and create the exam:

```powershell
node dist/cli.js init
node dist/cli.js exam create --name "<exam-name>" --date <YYYY-MM-DD> --subjects "<subject-1>,<subject-2>" --daily <minutes> --baseline <beginner|intermediate|advanced>
```

Import every user-approved material, then generate the plan:

```powershell
node dist/cli.js ingest "<path-to-material.pdf>"
node dist/cli.js ingest "<path-to-material.md>"
node dist/cli.js plan --exam <YYYY-MM-DD> --daily <minutes> --yes
node dist/cli.js today
```

Generate a quiz only after concepts and today's plan exist:

```powershell
node dist/cli.js quiz --count 5
```

Read `workspace/quizzes/<date>_quiz.md` for the learner-facing questions. Record the learner's actual answers in JSON; use zero-based option indices:

```json
[
  { "questionId": "q_1", "answer": 0 },
  { "questionId": "q_2", "answer": [0, 2] }
]
```

Do not infer or fabricate learner answers. Grade only after the learner provides them:

```powershell
node dist/cli.js grade --answers "<answers.json>"
node dist/cli.js learner insights
node dist/cli.js metrics
```

## Output contract

Report these outputs after a successful run:

| Output | Evidence |
| --- | --- |
| Imported materials and chunks | `workspace/materials/`, `workspace/chunks/` |
| Concepts and learning order | `workspace/graph/concepts.json` |
| Master and daily plans | `workspace/plan/` |
| Today's tasks | CLI output and `workspace/tasks/` |
| Quiz | `workspace/quizzes/` |
| Grade, mistakes, and mastery changes | `workspace/results/`, `workspace/mistakes/`, concept state |
| Audit trail | `workspace/event_log/events.jsonl` |

Include the exam date, daily time budget, concept count, scheduled coverage, today's tasks, quiz count, actual score when available, weak concepts, and next recommended action. Mark missing evidence as `unknown` or `not verified`.

## Failure handling

- No materials or chunks: stop and request a valid `.pdf` or `.md` file.
- Zero concepts: keep the exam status unchanged and report that knowledge construction failed.
- Plan capacity shortfall: return the unscheduled concept IDs and propose a larger daily budget or narrower scope.
- Missing model key: continue with Mock and label all generated content accordingly.
- Missing search key: skip research; do not invent sources.
- Duplicate grading with changed answers: preserve the original receipt and report the conflict instead of overwriting it.
- Server exposed beyond localhost: require `STUDYMATE_ACCESS_TOKEN` and an explicit `ALLOWED_ORIGINS` allowlist.

## Completion criteria

Treat the workflow as complete only when:

1. At least one approved material produced chunks and concepts.
2. A plan exists and any capacity shortfall is explicitly reported.
3. Today's task or Studio session is available.
4. A quiz is grounded in the current concept/task scope.
5. If answers were provided, grading persisted results, mistakes, mastery changes, and review scheduling exactly once.
6. The final report separates code presence, local checks, Mock behavior, real-model behavior, and learner outcomes.
