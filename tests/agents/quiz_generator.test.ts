import { describe, it, expect } from 'vitest';
import { selectQuizScope, generateScopedQuiz, type QuizScope, type QuizConfig } from '../../src/agents/quiz_generator.js';
import type { ConceptMap, Concept } from '../../src/agents/concept_mapper.js';
import type { DailyPlan } from '../../src/agents/planner.js';
import type { WeaknessProfile } from '../../src/agents/mistake_analyzer.js';
import { createMockLLMClient } from '../../src/core/mock_llm.js';
import fs from 'fs/promises';
import path from 'path';

const TEST_DIR = path.join(process.cwd(), 'workspace_test_quiz_gen');
const TEST_LOG = path.join(TEST_DIR, 'event_log', 'events.jsonl');

function makeConcept(id: string, mastery = 0.5): Concept {
  return {
    id,
    name: `Concept ${id}`,
    definition: `Definition of ${id}`,
    prerequisiteIds: [],
    relatedChunks: [`chunk_${id}`],
    mastery,
  };
}

function makeConceptMap(ids: string[]): ConceptMap {
  const concepts = ids.map((id) => makeConcept(id));
  return { concepts, learningOrder: ids };
}

function makeDailyPlan(tasks: Array<{ nodeId: string; type: string }>): DailyPlan {
  return {
    date: '2026-07-10',
    tasks: tasks.map((t, i) => ({
      id: `task_2026-07-10_${i}`,
      nodeId: t.nodeId,
      type: t.type as any,
      duration: 20,
    })),
  };
}

function makeWeaknessProfile(nodeIds: string[]): WeaknessProfile {
  const nodes: WeaknessProfile['nodes'] = {};
  for (const id of nodeIds) {
    nodes[id] = {
      mistakeCount: 3,
      lastSeen: '2026-07-09',
      errorTypes: ['memory_fuzzy'],
      consecutiveCorrect: 0,
      firstSeen: '2026-07-01',
      reason: `累计错误 3 次`,
    };
  }
  return { lastUpdated: '2026-07-09', nodes };
}

describe('selectQuizScope', () => {
  it('should select today concepts from learn tasks', () => {
    const conceptMap = makeConceptMap(['c1', 'c2', 'c3']);
    const plan = makeDailyPlan([
      { nodeId: 'c1', type: 'learn' },
      { nodeId: 'c2', type: 'review' },
    ]);

    const scope = selectQuizScope(plan, conceptMap);
    expect(scope.todayConcepts.map((c) => c.id)).toEqual(['c1']);
    expect(scope.dueReviewConcepts.map((c) => c.id)).toEqual(['c2']);
    expect(scope.weakConcepts).toHaveLength(0);
  });

  it('should select weak concepts from weakness profile (top 3)', () => {
    const conceptMap = makeConceptMap(['c1', 'c2', 'c3', 'c4', 'c5']);
    const profile = makeWeaknessProfile(['c5', 'c3', 'c1', 'c4']);

    const scope = selectQuizScope(undefined, conceptMap, profile);
    // Top 3 by mistakeCount (all equal, so insertion order)
    expect(scope.weakConcepts).toHaveLength(3);
  });

  it('should handle missing plan gracefully', () => {
    const conceptMap = makeConceptMap(['c1', 'c2']);
    const scope = selectQuizScope(undefined, conceptMap);
    expect(scope.todayConcepts).toHaveLength(0);
    expect(scope.dueReviewConcepts).toHaveLength(0);
  });

  it('should include sprint tasks as review concepts', () => {
    const conceptMap = makeConceptMap(['c1', 'c2']);
    const plan = makeDailyPlan([{ nodeId: 'c1', type: 'sprint' }]);

    const scope = selectQuizScope(plan, conceptMap);
    expect(scope.dueReviewConcepts.map((c) => c.id)).toEqual(['c1']);
  });
});

describe('generateScopedQuiz', () => {
  it('should generate quiz with mock LLM and respect config', async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(TEST_DIR, { recursive: true });

    const scope: QuizScope = {
      todayConcepts: [makeConcept('c1')],
      dueReviewConcepts: [makeConcept('c2')],
      weakConcepts: [],
    };
    const config: QuizConfig = { questionCount: 3, allowMultiChoice: true };
    const llm = createMockLLMClient();
    // Override to return questions referencing valid concept IDs
    llm.completeJSON = async () => ({
      questions: [
        { id: 'q_1', type: 'single_choice', stem: 'Q1?', options: ['A', 'B', 'C'], answer: 0, explanation: 'exp', nodeId: 'c1', difficulty: 'easy' },
        { id: 'q_2', type: 'single_choice', stem: 'Q2?', options: ['A', 'B', 'C'], answer: 1, explanation: 'exp', nodeId: 'c2', difficulty: 'medium' },
        { id: 'q_3', type: 'multi_choice', stem: 'Q3?', options: ['A', 'B', 'C', 'D'], answer: [0, 2], explanation: 'exp', nodeId: 'c1', difficulty: 'hard' },
      ],
    });

    const quiz = await generateScopedQuiz(scope, config, llm, '2026-07-10', TEST_LOG, TEST_DIR);
    expect(quiz.questions.length).toBe(3);
    expect(quiz.date).toBe('2026-07-10');

    // Verify file was written
    const saved = JSON.parse(await fs.readFile(path.join(TEST_DIR, 'quizzes', '2026-07-10_quiz.json'), 'utf-8'));
    expect(saved.id).toBe('quiz_2026-07-10');
  });

  it('should link sourceChunkId from concept relatedChunks', async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(TEST_DIR, { recursive: true });

    const concept = makeConcept('c1');
    concept.relatedChunks = ['chunk_abc'];
    const scope: QuizScope = {
      todayConcepts: [concept],
      dueReviewConcepts: [],
      weakConcepts: [],
    };
    const config: QuizConfig = { questionCount: 2 };
    const llm = createMockLLMClient();
    llm.completeJSON = async () => ({
      questions: [
        { id: 'q_1', type: 'single_choice', stem: 'Q1?', options: ['A', 'B'], answer: 0, explanation: 'exp', nodeId: 'c1', difficulty: 'easy' },
        { id: 'q_2', type: 'single_choice', stem: 'Q2?', options: ['A', 'B'], answer: 1, explanation: 'exp', nodeId: 'c1', difficulty: 'medium' },
      ],
    });

    const quiz = await generateScopedQuiz(scope, config, llm, '2026-07-11', TEST_LOG, TEST_DIR);
    for (const q of quiz.questions) {
      expect(q.sourceChunkId).toBe('chunk_abc');
    }
  });
});

describe('multi-choice validation', () => {
  it('should reject multi_choice with fewer than 2 correct answers', async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(TEST_DIR, { recursive: true });

    const llm = createMockLLMClient();
    // Override completeJSON to return invalid multi-choice
    llm.completeJSON = async () => ({
      questions: [{
        id: 'q_1',
        type: 'multi_choice',
        stem: 'Test?',
        options: ['A', 'B', 'C', 'D'],
        answer: [1], // Only 1 correct — invalid
        explanation: 'test',
        nodeId: 'c1',
        difficulty: 'medium',
      }],
    });

    const scope: QuizScope = {
      todayConcepts: [makeConcept('c1')],
      dueReviewConcepts: [],
      weakConcepts: [],
    };

    await expect(
      generateScopedQuiz(scope, { questionCount: 1 }, llm, '2026-07-12', TEST_LOG, TEST_DIR)
    ).rejects.toThrow('at least 2 correct answers');
  });

  it('should reject multi_choice with fewer than 4 options', async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(TEST_DIR, { recursive: true });

    const llm = createMockLLMClient();
    llm.completeJSON = async () => ({
      questions: [{
        id: 'q_1',
        type: 'multi_choice',
        stem: 'Test?',
        options: ['A', 'B', 'C'], // Only 3 options — invalid
        answer: [0, 1],
        explanation: 'test',
        nodeId: 'c1',
        difficulty: 'medium',
      }],
    });

    const scope: QuizScope = {
      todayConcepts: [makeConcept('c1')],
      dueReviewConcepts: [],
      weakConcepts: [],
    };

    await expect(
      generateScopedQuiz(scope, { questionCount: 1 }, llm, '2026-07-12', TEST_LOG, TEST_DIR)
    ).rejects.toThrow('at least 4 options');
  });

  it('should sort multi-choice answer indices', async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(TEST_DIR, { recursive: true });

    const llm = createMockLLMClient();
    llm.completeJSON = async () => ({
      questions: [{
        id: 'q_1',
        type: 'multi_choice',
        stem: 'Test?',
        options: ['A', 'B', 'C', 'D'],
        answer: [2, 0], // Unsorted
        explanation: 'test',
        nodeId: 'c1',
        difficulty: 'medium',
      }],
    });

    const scope: QuizScope = {
      todayConcepts: [makeConcept('c1')],
      dueReviewConcepts: [],
      weakConcepts: [],
    };

    const quiz = await generateScopedQuiz(scope, { questionCount: 1 }, llm, '2026-07-12', TEST_LOG, TEST_DIR);
    expect(quiz.questions[0].answer).toEqual([0, 2]);
  });
});
