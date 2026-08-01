import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { initWorkspace } from '../../src/core/workspace.js';
import { importMarkdown } from '../../src/agents/material_collector.js';
import { chunkMaterial } from '../../src/agents/chunker.js';
import { mapConcepts } from '../../src/agents/concept_mapper.js';
import { generatePlan, savePlan } from '../../src/agents/planner.js';
import { selectQuizScope, generateScopedQuiz, type QuizConfig } from '../../src/agents/quiz_generator.js';
import { gradeAndAdapt } from '../../src/application/workflows/grade_and_adapt.js';
import { completeTask } from '../../src/agents/task_dispatcher.js';
import { loadEvents } from '../../src/core/event_log.js';
import { createMockLLMClient } from '../../src/core/mock_llm.js';

const MATERIAL = `# Test Material

## Topic A
Content about topic A.

## Topic B
Content about topic B.
`;

describe('Idempotency e2e', () => {
  let tmpDir: string;
  const llm = createMockLLMClient();

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sm-idemp-'));
    await initWorkspace(path.join(tmpDir, 'workspace'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function ws(subpath: string): string {
    return path.join(tmpDir, 'workspace', subpath);
  }

  it('ingest twice does not duplicate chunks', async () => {
    const eventLog = ws('event_log/events.jsonl');
    const fixturePath = path.join(tmpDir, 'test.md');
    await fs.writeFile(fixturePath, MATERIAL, 'utf-8');

    // First ingest
    const mat1 = await importMarkdown(fixturePath, eventLog, ws(''));
    const chunks1 = await chunkMaterial(mat1, eventLog, ws(''));

    // Second ingest (same file)
    const mat2 = await importMarkdown(fixturePath, eventLog, ws(''));
    const chunks2 = await chunkMaterial(mat2, eventLog, ws(''));

    // Chunk counts should be the same (not doubled)
    expect(chunks2.length).toBe(chunks1.length);
  });

  it('quiz generation replaces quiz for same date', async () => {
    const eventLog = ws('event_log/events.jsonl');

    // Set up concepts
    const conceptMap = {
      concepts: [
        { id: 'node_1', name: 'A', definition: '', prerequisiteIds: [], relatedChunks: ['chunk_1'], mastery: 0.5 },
        { id: 'node_2', name: 'B', definition: '', prerequisiteIds: [], relatedChunks: ['chunk_2'], mastery: 0.5 },
      ],
      learningOrder: ['node_1', 'node_2'],
    };
    await fs.writeFile(ws('graph/concepts.json'), JSON.stringify(conceptMap), 'utf-8');

    const today = new Date().toISOString().split('T')[0];
    const config: QuizConfig = { questionCount: 2, allowMultiChoice: true };
    // Provide a todayPlan with learn tasks so selectQuizScope picks up concepts
    const todayPlan = {
      date: today,
      tasks: [
        { id: 't1', nodeId: 'node_1', type: 'learn' as const, duration: 15, status: 'pending' as const },
        { id: 't2', nodeId: 'node_2', type: 'review' as const, duration: 15, status: 'pending' as const },
      ],
    };
    const scope = selectQuizScope(todayPlan, conceptMap, undefined);

    // Generate quiz twice
    await generateScopedQuiz(scope, config, llm, today, eventLog, ws(''));
    const quiz1Path = ws(`quizzes/${today}_quiz.json`);
    const quiz1 = JSON.parse(await fs.readFile(quiz1Path, 'utf-8'));

    await generateScopedQuiz(scope, config, llm, today, eventLog, ws(''));
    const quiz2 = JSON.parse(await fs.readFile(quiz1Path, 'utf-8'));

    // Second quiz replaces first (same date, same number of questions)
    expect(quiz2.questions.length).toBe(quiz1.questions.length);
    expect(quiz2.date).toBe(today);
  });

  it('grade twice does not double-apply mastery changes', async () => {
    const eventLog = ws('event_log/events.jsonl');

    const conceptMap = {
      concepts: [
        { id: 'node_1', name: 'A', definition: '', prerequisiteIds: [], relatedChunks: [], mastery: 0.5 },
      ],
      learningOrder: ['node_1'],
    };
    await fs.writeFile(ws('graph/concepts.json'), JSON.stringify(conceptMap), 'utf-8');

    const quiz = {
      id: 'quiz_test',
      date: '2026-07-10',
      questions: [
        { id: 'q_1', type: 'single_choice' as const, stem: 'Q', options: ['A', 'B'], answer: 0, explanation: '', nodeId: 'node_1' },
      ],
    };
    await fs.mkdir(ws('quizzes'), { recursive: true });
    await fs.writeFile(ws('quizzes/2026-07-10_quiz.json'), JSON.stringify(quiz), 'utf-8');

    const answers = [{ questionId: 'q_1', answer: 1 }]; // wrong answer

    // Grade once
    const r1 = await gradeAndAdapt({
      quiz, answers,
      conceptsPath: ws('graph/concepts.json'),
      eventLogFile: eventLog,
      workspaceRoot: ws(''),
    });
    const mastery1 = JSON.parse(await fs.readFile(ws('graph/concepts.json'), 'utf-8'));

    // Grade again with same inputs
    const r2 = await gradeAndAdapt({
      quiz, answers,
      conceptsPath: ws('graph/concepts.json'),
      eventLogFile: eventLog,
      workspaceRoot: ws(''),
    });
    const mastery2 = JSON.parse(await fs.readFile(ws('graph/concepts.json'), 'utf-8'));

    expect(mastery2).toEqual(mastery1);
    expect(r2).toEqual(r1);

    const events = await loadEvents(eventLog);
    expect(events.filter((event) => event.action === 'quiz_graded')).toHaveLength(1);
    expect(events.filter((event) => event.action === 'mastery_updated')).toHaveLength(1);
  });

  it('task done twice does not create duplicate event entries', async () => {
    const eventLog = ws('event_log/events.jsonl');
    const today = new Date().toISOString().split('T')[0];
    const taskId = `task_${today}_0`;

    // Set up daily plan
    const plan = {
      date: today,
      tasks: [{ id: taskId, nodeId: 'node_1', type: 'review', duration: 15, status: 'pending' }],
    };
    await fs.mkdir(ws('plan/plan_daily'), { recursive: true });
    await fs.writeFile(ws(`plan/plan_daily/${today}.json`), JSON.stringify(plan), 'utf-8');

    // Mark done twice
    await completeTask(today, taskId, 'done', eventLog, ws(''));
    await completeTask(today, taskId, 'done', eventLog, ws(''));

    // Count events — should not have more than expected
    const events = await loadEvents(eventLog);
    const taskDoneEvents = events.filter(
      (e) => e.action === 'task_completed' && (e.input as Record<string, unknown>).taskId === taskId
    );
    expect(taskDoneEvents).toHaveLength(1);
  });
});
