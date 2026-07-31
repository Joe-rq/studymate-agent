import { describe, it, expect, beforeEach } from 'vitest';
import { analyzeMistakes, saveMistakes, classifyError, explainWeakness, type WeaknessProfile } from '../../src/agents/mistake_analyzer.js';
import type { GradedQuestion } from '../../src/agents/grader.js';
import type { Concept } from '../../src/agents/concept_mapper.js';
import fs from 'fs/promises';
import path from 'path';

const TEST_DIR = path.join(process.cwd(), 'workspace_test_mistake');
const TEST_LOG = path.join(TEST_DIR, 'event_log', 'events.jsonl');

function makeResult(date: string, nodeIds: string[]) {
  return {
    quizId: `quiz_${date}`,
    date,
    totalScore: 0,
    details: [],
    mistakes: nodeIds.map((nodeId, i) => ({
      question: {
        id: `q_${i}`,
        type: 'single_choice' as const,
        stem: '',
        options: [],
        answer: 0,
        explanation: '',
        nodeId,
      },
      userAnswer: 1,
      isCorrect: false,
      score: 0,
    })),
  };
}

describe('mistake_analyzer', () => {
  beforeEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(TEST_DIR, { recursive: true });
  });

  it('should extract weak nodes from result', () => {
    const result = {
      quizId: 'q1',
      date: '2026-07-10',
      totalScore: 50,
      details: [],
      mistakes: [
        {
          question: { id: 'q_1', type: 'single_choice' as const, stem: '', options: [], answer: 0, explanation: '', nodeId: 'node_1' },
          userAnswer: 1,
          isCorrect: false,
          score: 0,
        },
      ],
    };
    const mistakes = analyzeMistakes(result);
    expect(mistakes[0].nodeId).toBe('node_1');
    expect(mistakes[0].nextReview).toBe('2026-07-11');
  });

  it('should accumulate weakness across 3 sessions', async () => {
    // Session 1: node_1 wrong
    const r1 = makeResult('2026-07-10', ['node_1']);
    const m1 = analyzeMistakes(r1);
    await saveMistakes(m1, '2026-07-10', TEST_LOG, TEST_DIR);

    // Session 2: node_2 wrong
    const r2 = makeResult('2026-07-11', ['node_2']);
    const m2 = analyzeMistakes(r2);
    await saveMistakes(m2, '2026-07-11', TEST_LOG, TEST_DIR);

    // Session 3: node_1 wrong again
    const r3 = makeResult('2026-07-12', ['node_1']);
    const m3 = analyzeMistakes(r3);
    await saveMistakes(m3, '2026-07-12', TEST_LOG, TEST_DIR);

    // Read the cumulative profile
    const profile: WeaknessProfile = JSON.parse(
      await fs.readFile(path.join(TEST_DIR, 'mistakes', 'weakness_profile.json'), 'utf-8')
    );

    // Both node_1 and node_2 should be tracked
    expect(Object.keys(profile.nodes)).toContain('node_1');
    expect(Object.keys(profile.nodes)).toContain('node_2');

    // node_1 has 2 mistakes, node_2 has 1
    expect(profile.nodes['node_1'].mistakeCount).toBe(2);
    expect(profile.nodes['node_2'].mistakeCount).toBe(1);

    // node_1 was last seen on session 3
    expect(profile.nodes['node_1'].lastSeen).toBe('2026-07-12');
  });

  it('should track firstSeen and consecutiveCorrect in profile', async () => {
    const r1 = makeResult('2026-07-10', ['node_1']);
    const m1 = analyzeMistakes(r1);
    await saveMistakes(m1, '2026-07-10', TEST_LOG, TEST_DIR);

    const profile: WeaknessProfile = JSON.parse(
      await fs.readFile(path.join(TEST_DIR, 'mistakes', 'weakness_profile.json'), 'utf-8')
    );
    expect(profile.nodes['node_1'].firstSeen).toBe('2026-07-10');
    expect(profile.nodes['node_1'].consecutiveCorrect).toBe(0);
    expect(profile.nodes['node_1'].reason).toContain('首次错误');
  });
});

describe('classifyError', () => {
  function makeGraded(score: number, type: 'single_choice' | 'multi_choice' = 'single_choice'): GradedQuestion {
    return {
      question: {
        id: 'q_1',
        type,
        stem: '',
        options: ['A', 'B', 'C', 'D'],
        answer: type === 'multi_choice' ? [0, 1] : 0,
        explanation: '',
        nodeId: 'node_1',
        difficulty: 'medium',
      },
      userAnswer: 1,
      isCorrect: false,
      score,
    };
  }

  function makeConceptWithMastery(mastery: number): Concept {
    return {
      id: 'node_1',
      name: 'Test',
      definition: '',
      prerequisiteIds: [],
      relatedChunks: [],
      mastery,
    };
  }

  it('Rule 1: multi_choice with partial credit (score=50) → multi_partial', () => {
    const graded = makeGraded(50, 'multi_choice');
    expect(classifyError(graded)).toBe('multi_partial');
  });

  it('Rule 2: mastery < 0.3 → concept_unclear', () => {
    const graded = makeGraded(0);
    const concept = makeConceptWithMastery(0.2);
    expect(classifyError(graded, concept)).toBe('concept_unclear');
  });

  it('Rule 3: mastery >= 0.7 but wrong → careless', () => {
    const graded = makeGraded(0);
    const concept = makeConceptWithMastery(0.8);
    expect(classifyError(graded, concept)).toBe('careless');
  });

  it('Rule 4: otherwise → memory_fuzzy', () => {
    const graded = makeGraded(0);
    const concept = makeConceptWithMastery(0.5);
    expect(classifyError(graded, concept)).toBe('memory_fuzzy');
  });

  it('should default mastery to 0.5 when no concept provided', () => {
    const graded = makeGraded(0);
    expect(classifyError(graded)).toBe('memory_fuzzy');
  });
});

describe('explainWeakness', () => {
  it('should generate explanation for existing node', () => {
    const profile: WeaknessProfile = {
      lastUpdated: '2026-07-10',
      nodes: {
        node_1: {
          mistakeCount: 3,
          lastSeen: '2026-07-10',
          errorTypes: ['memory_fuzzy', 'careless'],
          consecutiveCorrect: 1,
          firstSeen: '2026-07-01',
          reason: '累计错误 3 次',
        },
      },
    };
    const explanation = explainWeakness('node_1', profile);
    expect(explanation).toContain('累计错误 3 次');
    expect(explanation).toContain('2026-07-01');
    expect(explanation).toContain('memory_fuzzy');
    expect(explanation).toContain('连续正确 1 次');
  });

  it('should return fallback for unknown node', () => {
    const profile: WeaknessProfile = { lastUpdated: '', nodes: {} };
    const explanation = explainWeakness('unknown', profile);
    expect(explanation).toContain('不在薄弱点列表中');
  });
});
