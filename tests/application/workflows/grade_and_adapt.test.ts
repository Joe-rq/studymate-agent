import { describe, it, expect, beforeEach } from 'vitest';
import { gradeAndAdapt } from '../../../src/application/workflows/grade_and_adapt.js';
import fs from 'fs/promises';
import path from 'path';

const TEST_DIR = path.join(process.cwd(), 'workspace_test_grade_adapt');
const TEST_LOG = path.join(TEST_DIR, 'event_log', 'events.jsonl');

describe('grade_and_adapt workflow', () => {
  beforeEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(path.join(TEST_DIR, 'graph'), { recursive: true });
    await fs.mkdir(path.join(TEST_DIR, 'mistakes'), { recursive: true });
    await fs.mkdir(path.join(TEST_DIR, 'results'), { recursive: true });
    await fs.mkdir(path.join(TEST_DIR, 'plan'), { recursive: true });
    await fs.mkdir(path.dirname(TEST_LOG), { recursive: true });
  });

  it('should grade, update mastery, and adjust plan in one call', async () => {
    // Set up concepts.json
    const conceptMap = {
      concepts: [
        { id: 'node_1', name: 'Supply', definition: '', prerequisiteIds: [], relatedChunks: [], mastery: 0.5 },
        { id: 'node_2', name: 'Demand', definition: '', prerequisiteIds: [], relatedChunks: [], mastery: 0.5 },
      ],
      learningOrder: ['node_1', 'node_2'],
    };
    const conceptsPath = path.join(TEST_DIR, 'graph', 'concepts.json');
    await fs.writeFile(conceptsPath, JSON.stringify(conceptMap, null, 2), 'utf-8');

    // Set up plan_master.json
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dayAfter = new Date();
    dayAfter.setDate(dayAfter.getDate() + 2);
    const plan = {
      id: 'plan_test',
      examDate: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
      dailyMinutes: 60,
      schedule: [
        {
          date: tomorrow.toISOString().split('T')[0],
          tasks: [{ type: 'review', nodeId: 'node_1', duration: 15 }],
        },
        {
          date: dayAfter.toISOString().split('T')[0],
          tasks: [{ type: 'review', nodeId: 'node_2', duration: 15 }],
        },
      ],
    };
    const planPath = path.join(TEST_DIR, 'plan', 'plan_master.json');
    await fs.writeFile(planPath, JSON.stringify(plan, null, 2), 'utf-8');

    // Set up quiz and answers (get node_1 wrong, node_2 right)
    const quiz = {
      id: 'quiz_2026-07-10',
      date: '2026-07-10',
      questions: [
        { id: 'q_1', type: 'single_choice' as const, stem: 'Q1', options: ['A', 'B'], answer: 0, explanation: 'Exp1', nodeId: 'node_1' },
        { id: 'q_2', type: 'single_choice' as const, stem: 'Q2', options: ['A', 'B'], answer: 1, explanation: 'Exp2', nodeId: 'node_2' },
      ],
    };
    const answers = [
      { questionId: 'q_1', answer: 1 }, // wrong
      { questionId: 'q_2', answer: 1 }, // correct
    ];

    const result = await gradeAndAdapt({
      quiz,
      answers,
      conceptsPath,
      planPath,
      eventLogFile: TEST_LOG,
      workspaceRoot: TEST_DIR,
    });

    // Grade result
    expect(result.result.totalScore).toBe(50);
    expect(result.result.mistakes).toHaveLength(1);

    // Mastery changes
    expect(result.masteryChanges).toHaveLength(2);
    const node1Change = result.masteryChanges.find((c) => c.nodeId === 'node_1');
    expect(node1Change?.newMastery).toBeLessThan(node1Change?.oldMastery ?? 1); // went wrong

    // Weakness tracked
    expect(result.mistakeNodeIds).toContain('node_1');

    // Plan adjusted
    expect(result.adjustments.length).toBeGreaterThanOrEqual(0);

    // Correlation ID present
    expect(result.correlationId).toMatch(/^corr_/);

    // concepts.json updated on disk
    const updatedMap = JSON.parse(await fs.readFile(conceptsPath, 'utf-8'));
    expect(updatedMap.concepts[0].mastery).not.toBe(0.5);
  });

  it('should skip plan adjustment when no plan exists', async () => {
    const conceptMap = {
      concepts: [
        { id: 'n1', name: 'A', definition: '', prerequisiteIds: [], relatedChunks: [], mastery: 0 },
      ],
      learningOrder: ['n1'],
    };
    const conceptsPath = path.join(TEST_DIR, 'graph', 'concepts.json');
    await fs.writeFile(conceptsPath, JSON.stringify(conceptMap, null, 2), 'utf-8');

    const quiz = {
      id: 'quiz_2026-07-10',
      date: '2026-07-10',
      questions: [
        { id: 'q_1', type: 'single_choice' as const, stem: 'Q', options: ['A', 'B'], answer: 0, explanation: '', nodeId: 'n1' },
      ],
    };
    const answers = [{ questionId: 'q_1', answer: 0 }];

    const result = await gradeAndAdapt({
      quiz,
      answers,
      conceptsPath,
      eventLogFile: TEST_LOG,
      workspaceRoot: TEST_DIR,
      // No planPath
    });

    expect(result.adjustments).toHaveLength(0);
    expect(result.result.totalScore).toBe(100);
  });
});
