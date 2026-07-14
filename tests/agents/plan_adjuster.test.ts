import { describe, it, expect } from 'vitest';
import { adjustPlan } from '../../src/agents/plan_adjuster.js';
import type { StudyPlan, DailyPlan } from '../../src/agents/planner.js';
import type { ConceptMap } from '../../src/agents/concept_mapper.js';

function makeConceptMap(masteries: Record<string, number>): ConceptMap {
  const concepts = Object.entries(masteries).map(([id, mastery]) => ({
    id,
    name: id,
    definition: '',
    prerequisiteIds: [],
    relatedChunks: [],
    mastery,
  }));
  return { concepts, learningOrder: Object.keys(masteries) };
}

function makePlan(dailyMinutes: number, days: DailyPlan[]): StudyPlan {
  return {
    id: 'plan_test',
    examDate: '2026-12-31',
    dailyMinutes,
    schedule: days,
  };
}

function makeDay(date: string, tasks: { type: 'learn' | 'review'; nodeId: string; duration: number }[]): DailyPlan {
  return { date, tasks };
}

describe('plan_adjuster', () => {
  it('mastery=0 的 review 任务获得最大加时（~15min）', () => {
    const plan = makePlan(60, [
      makeDay('2026-07-12', [{ type: 'review', nodeId: 'weak_node', duration: 15 }]),
    ]);
    const map = makeConceptMap({ weak_node: 0 });
    const { adjustments } = adjustPlan(plan, map, { fromDate: '2026-07-12' });
    const adj = adjustments.find((a) => a.nodeId === 'weak_node');
    expect(adj).toBeDefined();
    expect(adj!.addedMinutes).toBe(15);
  });

  it('mastery=1 的 review 任务不加时', () => {
    const plan = makePlan(60, [
      makeDay('2026-07-12', [{ type: 'review', nodeId: 'mastered', duration: 15 }]),
    ]);
    const map = makeConceptMap({ mastered: 1 });
    const { adjustments } = adjustPlan(plan, map, { fromDate: '2026-07-12' });
    expect(adjustments.find((a) => a.nodeId === 'mastered')).toBeUndefined();
  });

  it('加时额度与掌握度反相关', () => {
    // mastery=0.5 → extra = round(0.5 × 15) = 8
    const plan = makePlan(120, [
      makeDay('2026-07-12', [
        { type: 'review', nodeId: 'mid', duration: 15 },
      ]),
    ]);
    const map = makeConceptMap({ mid: 0.5 });
    const { adjustments } = adjustPlan(plan, map, { fromDate: '2026-07-12' });
    expect(adjustments[0].addedMinutes).toBe(8);
  });

  it('当天总时长不超过 dailyMinutes × maxOverflow', () => {
    // dailyMinutes=20, maxOverflow=1.2 → 上限 24
    // 已有 learn 20min，review 15min(mastery=0, 要加 15min)
    // 20+15=35 已超 24，review 不能再加时
    const plan = makePlan(20, [
      makeDay('2026-07-12', [
        { type: 'learn', nodeId: 'a', duration: 20 },
        { type: 'review', nodeId: 'weak', duration: 15 },
      ]),
    ]);
    const map = makeConceptMap({ a: 0, weak: 0 });
    const { adjustments } = adjustPlan(plan, map, { fromDate: '2026-07-12' });
    // weak 任务因软上限被跳过
    expect(adjustments.find((a) => a.nodeId === 'weak')).toBeUndefined();
  });

  it('fromDate 之前的日期不被调整', () => {
    const plan = makePlan(60, [
      makeDay('2026-07-10', [{ type: 'review', nodeId: 'weak', duration: 15 }]),
      makeDay('2026-07-12', [{ type: 'review', nodeId: 'weak', duration: 15 }]),
    ]);
    const map = makeConceptMap({ weak: 0 });
    const { adjustments } = adjustPlan(plan, map, { fromDate: '2026-07-12' });
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0].date).toBe('2026-07-12');
  });

  it('learn 任务不被调整', () => {
    const plan = makePlan(120, [
      makeDay('2026-07-12', [{ type: 'learn', nodeId: 'weak', duration: 30 }]),
    ]);
    const map = makeConceptMap({ weak: 0 });
    const { adjustments } = adjustPlan(plan, map, { fromDate: '2026-07-12' });
    expect(adjustments).toHaveLength(0);
  });

  it('原计划对象不被修改（深拷贝）', () => {
    const plan = makePlan(60, [
      makeDay('2026-07-12', [{ type: 'review', nodeId: 'weak', duration: 15 }]),
    ]);
    const map = makeConceptMap({ weak: 0 });
    adjustPlan(plan, map, { fromDate: '2026-07-12' });
    // 原 plan 中任务时长不变
    expect(plan.schedule[0].tasks[0].duration).toBe(15);
  });

  it('概念图中不存在的 nodeId 不调整', () => {
    const plan = makePlan(60, [
      makeDay('2026-07-12', [{ type: 'review', nodeId: 'ghost', duration: 15 }]),
    ]);
    const map = makeConceptMap({ other: 0 });
    const { adjustments } = adjustPlan(plan, map, { fromDate: '2026-07-12' });
    expect(adjustments).toHaveLength(0);
  });
});
