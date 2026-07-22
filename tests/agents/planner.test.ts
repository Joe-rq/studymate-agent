import { describe, it, expect } from 'vitest';
import { generatePlan, estimateDuration, formatPlanSummary } from '../../src/agents/planner.js';
import type { ConceptMap, Concept } from '../../src/agents/concept_mapper.js';

function makeConcepts(count: number): Concept[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `node_${i + 1}`,
    name: `Concept ${i + 1}`,
    definition: '',
    prerequisiteIds: [],
    relatedChunks: ['chunk_001'],
    mastery: 0,
  }));
}

function makeConceptMap(count: number): ConceptMap {
  const concepts = makeConcepts(count);
  return { concepts, learningOrder: concepts.map((c) => c.id) };
}

describe('planner', () => {
  it('should generate a schedule within daily minutes', () => {
    const conceptMap = makeConceptMap(2);
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
    const conceptMap = makeConceptMap(20);
    const examDate = new Date();
    examDate.setDate(examDate.getDate() + 60);
    const plan = generatePlan(conceptMap, {
      examDate: examDate.toISOString().split('T')[0],
      dailyMinutes: 90,
    });

    expect(plan.schedule.length).toBeGreaterThan(14);
    for (const day of plan.schedule) {
      const total = day.tasks.reduce((sum, t) => sum + t.duration, 0);
      expect(total).toBeLessThanOrEqual(90);
    }
  });

  it('should reject past exam dates', () => {
    const conceptMap = makeConceptMap(1);
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 5);
    expect(() =>
      generatePlan(conceptMap, { examDate: pastDate.toISOString().split('T')[0], dailyMinutes: 60 })
    ).toThrow(/future/);
  });

  it('should reject zero or negative daily minutes', () => {
    const conceptMap = makeConceptMap(1);
    const examDate = new Date();
    examDate.setDate(examDate.getDate() + 30);
    expect(() =>
      generatePlan(conceptMap, { examDate: examDate.toISOString().split('T')[0], dailyMinutes: 0 })
    ).toThrow(/dailyMinutes/);
  });

  it('should reject daily minutes over 480 (8h)', () => {
    const conceptMap = makeConceptMap(1);
    const examDate = new Date();
    examDate.setDate(examDate.getDate() + 30);
    expect(() =>
      generatePlan(conceptMap, { examDate: examDate.toISOString().split('T')[0], dailyMinutes: 500 })
    ).toThrow(/480/);
  });

  it('should respect unavailable dates as rest days', () => {
    const conceptMap = makeConceptMap(2);
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

  // ── Phase 3 new tests ──────────────────────────────────────────────

  it('should include phases metadata', () => {
    const conceptMap = makeConceptMap(5);
    const examDate = new Date();
    examDate.setDate(examDate.getDate() + 30);
    const plan = generatePlan(conceptMap, { examDate: examDate.toISOString().split('T')[0], dailyMinutes: 60 });

    expect(plan.phases.length).toBeGreaterThanOrEqual(2);
    expect(plan.phases[0].name).toBe('learn');
    expect(plan.phases[plan.phases.length - 1].name).toBe('sprint');
    expect(plan.version).toBe(1);
  });

  it('should include quiz tasks in the schedule', () => {
    const conceptMap = makeConceptMap(10);
    const examDate = new Date();
    examDate.setDate(examDate.getDate() + 30);
    const plan = generatePlan(conceptMap, { examDate: examDate.toISOString().split('T')[0], dailyMinutes: 90 });

    const allTasks = plan.schedule.flatMap((d) => d.tasks);
    const quizTasks = allTasks.filter((t) => t.type === 'quiz');
    expect(quizTasks.length).toBeGreaterThan(0);
  });

  it('should include sprint tasks in last days', () => {
    const conceptMap = makeConceptMap(5);
    const examDate = new Date();
    examDate.setDate(examDate.getDate() + 20);
    const plan = generatePlan(conceptMap, { examDate: examDate.toISOString().split('T')[0], dailyMinutes: 90 });

    const lastDays = plan.schedule.slice(-3);
    const sprintTasks = lastDays.flatMap((d) => d.tasks).filter((t) => t.type === 'sprint');
    expect(sprintTasks.length).toBeGreaterThan(0);
  });

  it('should include buffer/rest days', () => {
    const conceptMap = makeConceptMap(10);
    const examDate = new Date();
    examDate.setDate(examDate.getDate() + 30);
    const plan = generatePlan(conceptMap, { examDate: examDate.toISOString().split('T')[0], dailyMinutes: 60 });

    const restDays = plan.schedule.filter((d) => d.isRest);
    expect(restDays.length).toBeGreaterThan(0);
  });
});

describe('estimateDuration', () => {
  const baseConcept: Concept = {
    id: 'n1', name: 'Test', definition: '', prerequisiteIds: [], relatedChunks: [], mastery: 0,
  };

  it('learn: 20 + difficulty * 20', () => {
    expect(estimateDuration({ ...baseConcept, difficulty: 0 }, 'learn')).toBe(20);
    expect(estimateDuration({ ...baseConcept, difficulty: 1 }, 'learn')).toBe(40);
    expect(estimateDuration({ ...baseConcept, difficulty: 0.5 }, 'learn')).toBe(30);
    // default difficulty 0.5
    expect(estimateDuration(baseConcept, 'learn')).toBe(30);
  });

  it('review: 10 + (1 - mastery) * 10', () => {
    expect(estimateDuration({ ...baseConcept, mastery: 0 }, 'review')).toBe(20);
    expect(estimateDuration({ ...baseConcept, mastery: 1 }, 'review')).toBe(10);
    expect(estimateDuration({ ...baseConcept, mastery: 0.5 }, 'review')).toBe(15);
  });

  it('quiz: always 15', () => {
    expect(estimateDuration(baseConcept, 'quiz')).toBe(15);
  });

  it('sprint: always 10', () => {
    expect(estimateDuration(baseConcept, 'sprint')).toBe(10);
  });

  it('buffer: always 0', () => {
    expect(estimateDuration(baseConcept, 'buffer')).toBe(0);
  });
});

describe('formatPlanSummary', () => {
  it('should produce a readable summary', () => {
    const conceptMap = makeConceptMap(5);
    const examDate = new Date();
    examDate.setDate(examDate.getDate() + 20);
    const plan = generatePlan(conceptMap, { examDate: examDate.toISOString().split('T')[0], dailyMinutes: 60 });

    const summary = formatPlanSummary(plan, conceptMap);
    expect(summary).toContain('学习计划概览');
    expect(summary).toContain('总天数');
    expect(summary).toContain('学习阶段');
    expect(summary).toContain('冲刺阶段');
    expect(summary).toContain('任务分布');
  });
});
