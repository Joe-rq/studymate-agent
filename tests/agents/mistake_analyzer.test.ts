import { describe, it, expect, beforeEach } from 'vitest';
import { analyzeMistakes, saveMistakes, type WeaknessProfile } from '../../src/agents/mistake_analyzer.js';
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
});
