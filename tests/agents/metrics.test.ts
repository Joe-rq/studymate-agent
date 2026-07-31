import { describe, it, expect, beforeEach } from 'vitest';
import { computeMetrics } from '../../src/agents/metrics.js';
import fs from 'fs/promises';
import path from 'path';

const TEST_DIR = path.join(process.cwd(), 'workspace_test_metrics');

describe('computeMetrics', () => {
  beforeEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(TEST_DIR, { recursive: true });
  });

  it('should return zeros when no data exists', async () => {
    const metrics = await computeMetrics(TEST_DIR);
    expect(metrics.planCompletionRate).toBe(0);
    expect(metrics.postReviewAccuracy).toBe(0);
    expect(metrics.knowledgeRetention).toBe(0);
    expect(metrics.questionDiscardRate).toBe(0);
  });

  it('should compute plan completion rate from tasks', async () => {
    const tasksDir = path.join(TEST_DIR, 'tasks');
    await fs.mkdir(tasksDir, { recursive: true });

    // Create a todo file with 4 tasks
    await fs.writeFile(
      path.join(tasksDir, '2026-07-10_todo.md'),
      '- [ ] task_0\n- [ ] task_1\n- [ ] task_2\n- [ ] task_3\n',
      'utf-8'
    );

    // Create progress file with 2 done
    await fs.writeFile(
      path.join(tasksDir, '2026-07-10_progress.json'),
      JSON.stringify({
        completions: [
          { taskId: 'task_0', status: 'done' },
          { taskId: 'task_1', status: 'done' },
          { taskId: 'task_2', status: 'skipped' },
        ],
      }),
      'utf-8'
    );

    const metrics = await computeMetrics(TEST_DIR);
    // 2 done / 4 dispatched = 0.5
    expect(metrics.planCompletionRate).toBe(0.5);
  });

  it('should compute post-review accuracy and retention from mastery history', async () => {
    const progressDir = path.join(TEST_DIR, 'progress');
    await fs.mkdir(progressDir, { recursive: true });

    // Node tested twice: first session 0.4, second session 0.9
    const snapshots = [
      { nodeId: 'n1', date: '2026-07-01', mastery: 0.4, sessionScore: 0.4, consecutiveCorrect: 0 },
      { nodeId: 'n1', date: '2026-07-05', mastery: 0.7, sessionScore: 0.9, consecutiveCorrect: 1 },
      // Node tested only once — should NOT count
      { nodeId: 'n2', date: '2026-07-01', mastery: 0.5, sessionScore: 0.5, consecutiveCorrect: 0 },
    ];
    const content = snapshots.map((s) => JSON.stringify(s)).join('\n') + '\n';
    await fs.writeFile(path.join(progressDir, 'mastery_history.jsonl'), content, 'utf-8');

    const metrics = await computeMetrics(TEST_DIR);
    // Only n1 has 2+ snapshots. Latest sessionScore = 0.9, latest mastery = 0.7
    expect(metrics.postReviewAccuracy).toBe(0.9);
    expect(metrics.knowledgeRetention).toBe(0.7);
  });

  it('should handle multiple nodes with 2+ attempts', async () => {
    const progressDir = path.join(TEST_DIR, 'progress');
    await fs.mkdir(progressDir, { recursive: true });

    const snapshots = [
      { nodeId: 'n1', date: '2026-07-01', mastery: 0.3, sessionScore: 0.3, consecutiveCorrect: 0 },
      { nodeId: 'n1', date: '2026-07-05', mastery: 0.6, sessionScore: 0.8, consecutiveCorrect: 1 },
      { nodeId: 'n2', date: '2026-07-01', mastery: 0.4, sessionScore: 0.4, consecutiveCorrect: 0 },
      { nodeId: 'n2', date: '2026-07-05', mastery: 0.8, sessionScore: 1.0, consecutiveCorrect: 1 },
    ];
    const content = snapshots.map((s) => JSON.stringify(s)).join('\n') + '\n';
    await fs.writeFile(path.join(progressDir, 'mastery_history.jsonl'), content, 'utf-8');

    const metrics = await computeMetrics(TEST_DIR);
    // avg of latest sessionScores: (0.8 + 1.0) / 2 = 0.9
    expect(metrics.postReviewAccuracy).toBe(0.9);
    // avg of latest masteries: (0.6 + 0.8) / 2 = 0.7
    expect(metrics.knowledgeRetention).toBe(0.7);
  });
});
