import { describe, it, expect } from 'vitest';
import { generatePlan } from '../../src/agents/planner.js';

describe('planner', () => {
  it('should generate a schedule within daily minutes', () => {
    const conceptMap = {
      concepts: [
        { id: 'node_1', name: 'A', definition: '', prerequisiteIds: [], relatedChunks: [], mastery: 0 },
        { id: 'node_2', name: 'B', definition: '', prerequisiteIds: ['node_1'], relatedChunks: [], mastery: 0 },
      ],
      learningOrder: ['node_1', 'node_2'],
    };

    const examDate = new Date();
    examDate.setDate(examDate.getDate() + 7);
    const plan = generatePlan(conceptMap, { examDate: examDate.toISOString().split('T')[0], dailyMinutes: 60 });

    expect(plan.schedule.length).toBeGreaterThan(0);
    for (const day of plan.schedule) {
      const total = day.tasks.reduce((sum, t) => sum + t.duration, 0);
      expect(total).toBeLessThanOrEqual(60);
    }
  });
});
