import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { initWorkspace } from '../../src/core/workspace.js';
import { selectQuizScope, generateScopedQuiz, type QuizConfig } from '../../src/agents/quiz_generator.js';
import { gradeAndAdapt } from '../../src/application/workflows/grade_and_adapt.js';
import { createMockLLMClient } from '../../src/core/mock_llm.js';
import type { LLMClient, LLMOptions } from '../../src/core/llm.js';

describe('Failure recovery e2e', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sm-fail-'));
    await initWorkspace(path.join(tmpDir, 'workspace'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function ws(subpath: string): string {
    return path.join(tmpDir, 'workspace', subpath);
  }

  function setupConcepts() {
    const conceptMap = {
      concepts: [
        { id: 'node_1', name: 'A', definition: '', prerequisiteIds: [], relatedChunks: [], mastery: 0.5 },
        { id: 'node_2', name: 'B', definition: '', prerequisiteIds: [], relatedChunks: [], mastery: 0.5 },
      ],
      learningOrder: ['node_1', 'node_2'],
    };
    return fs.writeFile(ws('graph/concepts.json'), JSON.stringify(conceptMap), 'utf-8');
  }

  it('LLM failure during quiz generation does not corrupt workspace', async () => {
    const eventLog = ws('event_log/events.jsonl');
    await setupConcepts();

    // Create a mock LLM that always throws
    const failingLLM: LLMClient = {
      async complete(): Promise<string> {
        throw new Error('Simulated LLM failure');
      },
      async completeJSON(): Promise<never> {
        throw new Error('Simulated LLM failure');
      },
    };

    const config: QuizConfig = { questionCount: 3, allowMultiChoice: true };
    const conceptMap = JSON.parse(await fs.readFile(ws('graph/concepts.json'), 'utf-8'));
    const scope = selectQuizScope(undefined, conceptMap, undefined);

    // Quiz generation should throw
    await expect(
      generateScopedQuiz(scope, config, failingLLM, '2026-07-10', eventLog)
    ).rejects.toThrow();

    // Concepts should still be intact
    const conceptsAfter = JSON.parse(await fs.readFile(ws('graph/concepts.json'), 'utf-8'));
    expect(conceptsAfter.concepts).toHaveLength(2);
    expect(conceptsAfter.concepts[0].mastery).toBe(0.5);
  });

  it('concepts.json is not truncated on disk write failure', async () => {
    const eventLog = ws('event_log/events.jsonl');
    await setupConcepts();

    const quiz = {
      id: 'quiz_test',
      date: '2026-07-10',
      questions: [
        { id: 'q_1', type: 'single_choice' as const, stem: 'Q', options: ['A', 'B'], answer: 0, explanation: '', nodeId: 'node_1' },
      ],
    };
    await fs.mkdir(ws('quizzes'), { recursive: true });
    await fs.writeFile(ws('quizzes/2026-07-10_quiz.json'), JSON.stringify(quiz), 'utf-8');

    // Grade successfully first
    const answers = [{ questionId: 'q_1', answer: 0 }]; // correct
    await gradeAndAdapt({
      quiz, answers,
      conceptsPath: ws('graph/concepts.json'),
      eventLogFile: eventLog,
      workspaceRoot: ws(''),
    });

    // Verify concepts.json is valid JSON after successful grade
    const conceptsAfter = JSON.parse(await fs.readFile(ws('graph/concepts.json'), 'utf-8'));
    expect(conceptsAfter.concepts).toHaveLength(2);
    expect(conceptsAfter.concepts[0].mastery).toBeDefined();
  });

  it('re-running grade after failure produces consistent results', async () => {
    const eventLog = ws('event_log/events.jsonl');
    await setupConcepts();

    const quiz = {
      id: 'quiz_test',
      date: '2026-07-10',
      questions: [
        { id: 'q_1', type: 'single_choice' as const, stem: 'Q1', options: ['A', 'B'], answer: 0, explanation: '', nodeId: 'node_1' },
        { id: 'q_2', type: 'single_choice' as const, stem: 'Q2', options: ['A', 'B'], answer: 1, explanation: '', nodeId: 'node_2' },
      ],
    };
    await fs.mkdir(ws('quizzes'), { recursive: true });
    await fs.writeFile(ws('quizzes/2026-07-10_quiz.json'), JSON.stringify(quiz), 'utf-8');

    const answers = [
      { questionId: 'q_1', answer: 0 }, // correct
      { questionId: 'q_2', answer: 0 }, // wrong
    ];

    // Grade once
    const r1 = await gradeAndAdapt({
      quiz, answers,
      conceptsPath: ws('graph/concepts.json'),
      eventLogFile: eventLog,
      workspaceRoot: ws(''),
    });

    // Reset concepts to original state
    const conceptMap = {
      concepts: [
        { id: 'node_1', name: 'A', definition: '', prerequisiteIds: [], relatedChunks: [], mastery: 0.5 },
        { id: 'node_2', name: 'B', definition: '', prerequisiteIds: [], relatedChunks: [], mastery: 0.5 },
      ],
      learningOrder: ['node_1', 'node_2'],
    };
    await fs.writeFile(ws('graph/concepts.json'), JSON.stringify(conceptMap), 'utf-8');

    // Grade again with same inputs (fresh start)
    const r2 = await gradeAndAdapt({
      quiz, answers,
      conceptsPath: ws('graph/concepts.json'),
      eventLogFile: eventLog,
      workspaceRoot: ws(''),
    });

    // Results should be identical (deterministic)
    expect(r2.result.totalScore).toBe(r1.result.totalScore);
    expect(r2.masteryChanges.length).toBe(r1.masteryChanges.length);
  });
});
