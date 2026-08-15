import { describe, it, expect } from 'vitest';
import { generatePlan, estimateDuration, formatPlanSummary, type DailyPlan } from '../../src/agents/planner.js';
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

function futureDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

/** 所有 learn 任务总数与涉及概念集合。 */
function learnStats(schedule: DailyPlan[]) {
  const learnTasks = schedule.flatMap((d) => d.tasks.filter((t) => t.type === 'learn'));
  return {
    learnIds: learnTasks.map((t) => t.nodeId),
    uniqueLearnIds: new Set(learnTasks.map((t) => t.nodeId)),
  };
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

  it('should reject invalid unavailable dates', () => {
    const conceptMap = makeConceptMap(1);
    const examDate = new Date();
    examDate.setDate(examDate.getDate() + 30);
    expect(() =>
      generatePlan(conceptMap, {
        examDate: examDate.toISOString().split('T')[0],
        dailyMinutes: 60,
        unavailableDates: ['2026-02-30'],
      })
    ).toThrow(/Invalid unavailable date/);
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

  // ── 容量完整性：概念不得静默丢失 ────────────────────────────────────

  it('容量充足时所有概念至少出现一次 learn 任务', () => {
    const conceptMap = makeConceptMap(20);
    const plan = generatePlan(conceptMap, { examDate: futureDate(60), dailyMinutes: 90 });

    const { uniqueLearnIds } = learnStats(plan.schedule);
    for (const id of conceptMap.learningOrder) {
      expect(uniqueLearnIds.has(id)).toBe(true);
    }
    expect(plan.capacity?.unscheduledConceptIds).toEqual([]);
    expect(plan.capacity?.scheduledConceptCount).toBe(20);
  });

  it('容量不足时 40 概念 / 14 天 / 60 分钟不静默丢概念，返回准确缺口', () => {
    const conceptMap = makeConceptMap(40);
    const plan = generatePlan(conceptMap, { examDate: futureDate(14), dailyMinutes: 60 });

    // 每个概念要么被排入 learn，要么出现在 unscheduledConceptIds —— 不允许第三种下场
    const { uniqueLearnIds } = learnStats(plan.schedule);
    const unscheduled = new Set(plan.capacity?.unscheduledConceptIds ?? []);
    for (const id of conceptMap.learningOrder) {
      expect(uniqueLearnIds.has(id) || unscheduled.has(id)).toBe(true);
    }
    // 二者不相交且并集等于全体概念
    for (const id of uniqueLearnIds) expect(unscheduled.has(id)).toBe(false);
    expect(uniqueLearnIds.size + unscheduled.size).toBe(40);
    expect(plan.capacity?.scheduledConceptCount).toBe(uniqueLearnIds.size);
    expect(plan.capacity?.requiredMinutes).toBeGreaterThan(0);
    expect(plan.capacity?.availableMinutes).toBeGreaterThan(0);
  });

  it('容量不足时概要输出包含警告', () => {
    const conceptMap = makeConceptMap(40);
    const plan = generatePlan(conceptMap, { examDate: futureDate(14), dailyMinutes: 60 });
    const summary = formatPlanSummary(plan, conceptMap);
    expect(summary).toContain('容量不足');
    expect(summary).toContain('无法在考试前排入');
  });

  it('被顺延的 learn 任务不落在休息日或测验日', () => {
    const conceptMap = makeConceptMap(12);
    const plan = generatePlan(conceptMap, {
      examDate: futureDate(30),
      dailyMinutes: 60,
      unavailableDates: [futureDate(1), futureDate(2)],
    });

    for (const day of plan.schedule) {
      if (day.isRest) expect(day.tasks).toHaveLength(0);
      const learnCount = day.tasks.filter((t) => t.type === 'learn').length;
      const quizCount = day.tasks.filter((t) => t.type === 'quiz').length;
      // 学习日只放 learn（可叠复习），测验日只放 quiz —— 由日分类预先决定
      if (learnCount > 0) expect(quizCount).toBe(0);
    }
  });

  // ── 固定复习间隔：初始计划与运行时 SM-2 分离 ────────────────────────

  it('复习任务出现在学习日后的固定间隔（1/3 天），而非到期后每天重复', () => {
    const conceptMap = makeConceptMap(1); // 单概念：学习日 = 今天（第 0 天）
    const plan = generatePlan(conceptMap, { examDate: futureDate(10), dailyMinutes: 60 });

    const reviewDays = plan.schedule
      .map((day, idx) => ({ idx, has: day.tasks.some((t) => t.type === 'review' && t.nodeId === 'node_1') }))
      .filter((d) => d.has)
      .map((d) => d.idx);

    // 间隔 1 和 3 必须精确命中（第 1、3 天无休息日冲突）
    expect(reviewDays).toContain(1);
    expect(reviewDays).toContain(3);
    // 关键回归：不允许“到期后每天都是复习日”
    expect(reviewDays.length).toBeLessThanOrEqual(5); // 最多 REVIEW_INTERVALS 数量
    for (const idx of reviewDays) {
      expect([1, 3, 4, 7, 8, 9]).toContain(idx); // 只允许间隔日或休息日顺延后的位置
    }
  });

  it('计划生成不修改概念的 srState', () => {
    const conceptMap = makeConceptMap(5);
    generatePlan(conceptMap, { examDate: futureDate(30), dailyMinutes: 60 });
    for (const c of conceptMap.concepts) {
      expect(c.srState).toBeUndefined();
    }
  });

  it('同一概念的 review 每天最多一条', () => {
    const conceptMap = makeConceptMap(8);
    const plan = generatePlan(conceptMap, { examDate: futureDate(45), dailyMinutes: 120 });
    for (const day of plan.schedule) {
      const byNode = new Map<string, number>();
      for (const t of day.tasks.filter((x) => x.type === 'review')) {
        byNode.set(t.nodeId, (byNode.get(t.nodeId) ?? 0) + 1);
      }
      for (const count of byNode.values()) expect(count).toBe(1);
    }
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
