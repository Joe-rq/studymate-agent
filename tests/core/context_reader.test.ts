import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { gatherStudyContext } from '../../src/core/context_reader.js';
import type { ConceptMap } from '../../src/agents/concept_mapper.js';

const TEST_DIR = path.join(process.cwd(), 'workspace_test_context');

beforeEach(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

async function writeJSON(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data), 'utf-8');
}

describe('gatherStudyContext', () => {
  it('returns empty context on a fresh workspace', async () => {
    await fs.mkdir(TEST_DIR, { recursive: true });
    const ctx = await gatherStudyContext(TEST_DIR);
    expect(ctx.daysToExam).toBeNull();
    expect(ctx.avgMastery).toBe(0);
    expect(ctx.weakNodeNames).toEqual([]);
    expect(ctx.recentScore).toBeNull();
    expect(ctx.tasksToday).toBe(0);
  });

  it('computes avgMastery from concepts.json', async () => {
    const conceptMap: ConceptMap = {
      concepts: [
        { id: 'node_1', name: '需求曲线', definition: 'd', prerequisiteIds: [], relatedChunks: [], mastery: 0.8 },
        { id: 'node_2', name: '供给曲线', definition: 'd', prerequisiteIds: [], relatedChunks: [], mastery: 0.4 },
      ],
      learningOrder: ['node_1', 'node_2'],
    };
    await writeJSON(path.join(TEST_DIR, 'graph', 'concepts.json'), conceptMap);
    const ctx = await gatherStudyContext(TEST_DIR);
    expect(ctx.avgMastery).toBeCloseTo(0.6, 5);
  });

  it('reads daysToExam and tasksToday from plan files', async () => {
    const future = new Date();
    future.setDate(future.getDate() + 30);
    await writeJSON(path.join(TEST_DIR, 'plan', 'plan_master.json'), {
      id: 'p1',
      examDate: future.toISOString().split('T')[0],
      dailyMinutes: 60,
      schedule: [],
    });
    const today = new Date().toISOString().split('T')[0];
    await writeJSON(path.join(TEST_DIR, 'plan', 'plan_daily', `${today}.json`), {
      date: today,
      tasks: [{ type: 'learn', nodeId: 'n1', duration: 30 }, { type: 'review', nodeId: 'n2', duration: 20 }],
    });
    const ctx = await gatherStudyContext(TEST_DIR);
    expect(ctx.daysToExam).toBeGreaterThanOrEqual(29);
    expect(ctx.tasksToday).toBe(2);
  });

  it('maps weak node ids to names', async () => {
    const conceptMap: ConceptMap = {
      concepts: [
        { id: 'node_1', name: '需求曲线', definition: 'd', prerequisiteIds: [], relatedChunks: [], mastery: 0.3 },
        { id: 'node_2', name: '供给曲线', definition: 'd', prerequisiteIds: [], relatedChunks: [], mastery: 0.9 },
      ],
      learningOrder: ['node_1', 'node_2'],
    };
    await writeJSON(path.join(TEST_DIR, 'graph', 'concepts.json'), conceptMap);
    await writeJSON(path.join(TEST_DIR, 'mistakes', 'weakness_profile.json'), {
      weakNodes: ['node_1'],
    });
    const ctx = await gatherStudyContext(TEST_DIR);
    expect(ctx.weakNodeNames).toEqual(['需求曲线']);
  });

  it('reads recent score from results dir and sets trend', async () => {
    await writeJSON(path.join(TEST_DIR, 'results', '2026-07-10_result.json'), {
      totalScore: 85,
    });
    const ctx = await gatherStudyContext(TEST_DIR);
    expect(ctx.recentScore).toBe(85);
    expect(ctx.masteryTrend).toBe('up');
  });

  it('low score sets trend to down', async () => {
    await writeJSON(path.join(TEST_DIR, 'results', '2026-07-10_result.json'), {
      totalScore: 45,
    });
    const ctx = await gatherStudyContext(TEST_DIR);
    expect(ctx.masteryTrend).toBe('down');
  });
});
