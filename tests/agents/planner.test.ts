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

  it('should generate a 60-day plan without the 14-day cap', () => {
    const concepts = Array.from({ length: 20 }, (_, i) => ({
      id: `node_${i + 1}`,
      name: `Concept ${i + 1}`,
      definition: '',
      prerequisiteIds: [],
      relatedChunks: [],
      mastery: 0,
    }));
    const conceptMap = {
      concepts,
      learningOrder: concepts.map((c) => c.id),
    };

    const examDate = new Date();
    examDate.setDate(examDate.getDate() + 60);
    const plan = generatePlan(conceptMap, {
      examDate: examDate.toISOString().split('T')[0],
      dailyMinutes: 90,
    });

    // Should have ~60 days, not capped at 14
    expect(plan.schedule.length).toBeGreaterThan(14);
    // Each day should respect daily minutes
    for (const day of plan.schedule) {
      const total = day.tasks.reduce((sum, t) => sum + t.duration, 0);
      expect(total).toBeLessThanOrEqual(90);
    }
  });

  it('should reject past exam dates', () => {
    const conceptMap = {
      concepts: [{ id: 'n1', name: 'A', definition: '', prerequisiteIds: [], relatedChunks: [], mastery: 0 }],
      learningOrder: ['n1'],
    };
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 5);
    expect(() =>
      generatePlan(conceptMap, { examDate: pastDate.toISOString().split('T')[0], dailyMinutes: 60 })
    ).toThrow(/future/);
  });

  it('should reject zero or negative daily minutes', () => {
    const conceptMap = {
      concepts: [{ id: 'n1', name: 'A', definition: '', prerequisiteIds: [], relatedChunks: [], mastery: 0 }],
      learningOrder: ['n1'],
    };
    const examDate = new Date();
    examDate.setDate(examDate.getDate() + 30);
    expect(() =>
      generatePlan(conceptMap, { examDate: examDate.toISOString().split('T')[0], dailyMinutes: 0 })
    ).toThrow(/dailyMinutes/);
  });

  it('should reject daily minutes over 480 (8h)', () => {
    const conceptMap = {
      concepts: [{ id: 'n1', name: 'A', definition: '', prerequisiteIds: [], relatedChunks: [], mastery: 0 }],
      learningOrder: ['n1'],
    };
    const examDate = new Date();
    examDate.setDate(examDate.getDate() + 30);
    expect(() =>
      generatePlan(conceptMap, { examDate: examDate.toISOString().split('T')[0], dailyMinutes: 500 })
    ).toThrow(/480/);
  });

  it('should respect unavailable dates as rest days', () => {
    const conceptMap = {
      concepts: [
        { id: 'n1', name: 'A', definition: '', prerequisiteIds: [], relatedChunks: [], mastery: 0 },
        { id: 'n2', name: 'B', definition: '', prerequisiteIds: [], relatedChunks: [], mastery: 0 },
      ],
      learningOrder: ['n1', 'n2'],
    };
    const examDate = new Date();
    examDate.setDate(examDate.getDate() + 10);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const restDate = tomorrow.toISOString().split('T')[0];

    const plan = generatePlan(conceptMap, {
      examDate: examDate.toISOString().split('T')[0],
      dailyMinutes: 60,
      unavailableDates: [restDate],
    });

    const restDay = plan.schedule.find((d) => d.date === restDate);
    expect(restDay).toBeDefined();
    expect(restDay?.isRest).toBe(true);
    expect(restDay?.tasks).toHaveLength(0);
  });
});
