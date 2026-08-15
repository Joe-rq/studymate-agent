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
    relatedChunks: ['chunk_001'],
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
    phases: [{ name: 'learn', startDay: 0, endDay: days.length - 1 }],
    version: 1,
  };
}

function makeDay(date: string, tasks: { type: 'learn' | 'review' | 'quiz' | 'sprint'; nodeId: string; duration: number }[]): DailyPlan {
  return { date, tasks };
}

const TEST_REASON = 'test adjustment';

describe('plan_adjuster', () => {
  it('mastery=0 的 review 任务获得最大加时（~15min）', () => {
    const plan = makePlan(60, [
      makeDay('2026-07-12', [{ type: 'review', nodeId: 'weak_node', duration: 15 }]),
    ]);
    const map = makeConceptMap({ weak_node: 0 });
    const { adjustments } = adjustPlan(plan, map, { fromDate: '2026-07-12', reason: TEST_REASON });
    const adj = adjustments.find((a) => a.nodeId === 'weak_node' && a.type === 'extend');
    expect(adj).toBeDefined();
    expect(adj!.addedMinutes).toBe(15);
  });

  it('mastery=1 的 review 任务不加时', () => {
    const plan = makePlan(60, [
      makeDay('2026-07-12', [{ type: 'review', nodeId: 'mastered', duration: 15 }]),
    ]);
    const map = makeConceptMap({ mastered: 1 });
    const { adjustments } = adjustPlan(plan, map, { fromDate: '2026-07-12', reason: TEST_REASON });
    expect(adjustments.find((a) => a.nodeId === 'mastered' && a.type === 'extend')).toBeUndefined();
  });

  it('加时额度与掌握度反相关', () => {
    const plan = makePlan(120, [
      makeDay('2026-07-12', [{ type: 'review', nodeId: 'mid', duration: 15 }]),
    ]);
    const map = makeConceptMap({ mid: 0.5 });
    const { adjustments } = adjustPlan(plan, map, { fromDate: '2026-07-12', reason: TEST_REASON });
    const adj = adjustments.find((a) => a.type === 'extend');
    expect(adj!.addedMinutes).toBe(8);
  });

  it('当天总时长不超过 dailyMinutes × maxOverflow', () => {
    const plan = makePlan(20, [
      makeDay('2026-07-12', [
        { type: 'learn', nodeId: 'a', duration: 20 },
        { type: 'review', nodeId: 'weak', duration: 15 },
      ]),
    ]);
    const map = makeConceptMap({ a: 0, weak: 0 });
    const { adjustments } = adjustPlan(plan, map, { fromDate: '2026-07-12', reason: TEST_REASON });
    expect(adjustments.find((a) => a.nodeId === 'weak' && a.type === 'extend')).toBeUndefined();
  });

  it('fromDate 之前的日期不被调整', () => {
    const plan = makePlan(60, [
      makeDay('2026-07-10', [{ type: 'review', nodeId: 'weak', duration: 15 }]),
      makeDay('2026-07-12', [{ type: 'review', nodeId: 'weak', duration: 15 }]),
    ]);
    const map = makeConceptMap({ weak: 0 });
    const { adjustments } = adjustPlan(plan, map, { fromDate: '2026-07-12', reason: TEST_REASON });
    const extendAdj = adjustments.filter((a) => a.type === 'extend');
    expect(extendAdj).toHaveLength(1);
    expect(extendAdj[0].date).toBe('2026-07-12');
  });

  it('learn 任务不被调整', () => {
    const plan = makePlan(120, [
      makeDay('2026-07-12', [{ type: 'learn', nodeId: 'weak', duration: 30 }]),
    ]);
    const map = makeConceptMap({ weak: 0 });
    const { adjustments } = adjustPlan(plan, map, { fromDate: '2026-07-12', reason: TEST_REASON });
    expect(adjustments.filter((a) => a.type === 'extend')).toHaveLength(0);
  });

  it('原计划对象不被修改（深拷贝）', () => {
    const plan = makePlan(60, [
      makeDay('2026-07-12', [{ type: 'review', nodeId: 'weak', duration: 15 }]),
    ]);
    const map = makeConceptMap({ weak: 0 });
    adjustPlan(plan, map, { fromDate: '2026-07-12', reason: TEST_REASON });
    expect(plan.schedule[0].tasks[0].duration).toBe(15);
  });

  it('概念图中不存在的 nodeId 不调整', () => {
    const plan = makePlan(60, [
      makeDay('2026-07-12', [{ type: 'review', nodeId: 'ghost', duration: 15 }]),
    ]);
    const map = makeConceptMap({ other: 0 });
    const { adjustments } = adjustPlan(plan, map, { fromDate: '2026-07-12', reason: TEST_REASON });
    expect(adjustments.filter((a) => a.type === 'extend')).toHaveLength(0);
  });

  // ── New Phase 3 tests ──────────────────────────────────────────────

  it('inserts new review tasks for mastery < 0.3 concepts not already scheduled', () => {
    const plan = makePlan(120, [
      makeDay('2026-07-12', [{ type: 'learn', nodeId: 'a', duration: 30 }]),
    ]);
    // 'very_weak' has mastery 0.2 and is not in today's tasks
    const map = makeConceptMap({ a: 0.8, very_weak: 0.2 });
    const { adjustments, plan: adjusted } = adjustPlan(plan, map, { fromDate: '2026-07-12', reason: TEST_REASON });
    const inserted = adjustments.find((a) => a.type === 'insert_review' && a.nodeId === 'very_weak');
    expect(inserted).toBeDefined();
    expect(inserted!.mastery).toBe(0.2);
    // Verify it's in the adjusted plan
    const dayTasks = adjusted.schedule[0].tasks;
    expect(dayTasks.some((t) => t.nodeId === 'very_weak' && t.type === 'review')).toBe(true);
  });

  it('inserts quiz tasks for quizNodeIds', () => {
    const plan = makePlan(120, [
      makeDay('2026-07-12', [{ type: 'learn', nodeId: 'a', duration: 30 }]),
    ]);
    const map = makeConceptMap({ a: 0.8, quiz_target: 0.4 });
    const { adjustments, plan: adjusted } = adjustPlan(plan, map, {
      fromDate: '2026-07-12',
      reason: TEST_REASON,
      quizNodeIds: ['quiz_target'],
    });
    const quizAdj = adjustments.find((a) => a.type === 'insert_quiz' && a.nodeId === 'quiz_target');
    expect(quizAdj).toBeDefined();
    expect(adjusted.schedule[0].tasks.some((t) => t.nodeId === 'quiz_target' && t.type === 'quiz')).toBe(true);
  });

  it('returns AdjustmentRecord with correct summary', () => {
    const plan = makePlan(120, [
      makeDay('2026-07-12', [{ type: 'review', nodeId: 'weak', duration: 15 }]),
      makeDay('2026-07-13', [{ type: 'review', nodeId: 'weak', duration: 15 }]),
    ]);
    const map = makeConceptMap({ weak: 0 });
    const { record } = adjustPlan(plan, map, { fromDate: '2026-07-12', reason: 'quiz failed' });
    expect(record.reason).toBe('quiz failed');
    expect(record.version).toBe(2);
    expect(record.summary.daysAffected).toBe(2);
    expect(record.summary.minutesAdded).toBeGreaterThan(0);
    expect(record.adjustedAt).toBeTruthy();
  });

  it('increments plan version on adjustment', () => {
    const plan = makePlan(60, [
      makeDay('2026-07-12', [{ type: 'review', nodeId: 'weak', duration: 15 }]),
    ]);
    const map = makeConceptMap({ weak: 0 });
    const { plan: adjusted } = adjustPlan(plan, map, { fromDate: '2026-07-12', reason: TEST_REASON });
    expect(adjusted.version).toBe(2);
  });

  it('skips rest days', () => {
    const plan = makePlan(60, [
      { date: '2026-07-12', tasks: [], isRest: true },
    ]);
    const map = makeConceptMap({ weak: 0 });
    const { adjustments } = adjustPlan(plan, map, { fromDate: '2026-07-12', reason: TEST_REASON });
    expect(adjustments).toHaveLength(0);
  });

  // ── 默认从次日调整 + SM-2 dueDate 幂等插入 ──────────────────────────

  it('未传 fromDate 时默认从明天开始调整，今天不被插入新任务', () => {
    // 计划含“今天”（测试运行日）与之后两天
    const today = new Date().toISOString().split('T')[0];
    const d = (offset: number) => {
      const dt = new Date();
      dt.setDate(dt.getDate() + offset);
      return dt.toISOString().split('T')[0];
    };
    const plan = makePlan(120, [
      makeDay(today, [{ type: 'learn', nodeId: 'a', duration: 30 }]),
      makeDay(d(1), [{ type: 'learn', nodeId: 'b', duration: 30 }]),
      makeDay(d(2), [{ type: 'learn', nodeId: 'c', duration: 30 }]),
    ]);
    const map = makeConceptMap({ a: 0.8, b: 0.8, very_weak: 0.1 });
    const { adjustments, plan: adjusted } = adjustPlan(plan, map, { reason: TEST_REASON });

    // 今天（第一个日程日）不应有任何插入
    const todayAdj = adjustments.filter((a) => a.date === today);
    expect(todayAdj).toHaveLength(0);
    expect(adjusted.schedule[0].tasks).toHaveLength(1);
    // 明天插入弱概念复习一次
    const insertAdj = adjustments.find((a) => a.type === 'insert_review' && a.nodeId === 'very_weak');
    expect(insertAdj?.date).toBe(d(1));
  });

  it('SM-2 dueDate 当天插入一条 review，且只插入一次', () => {
    const plan = makePlan(120, [
      makeDay('2026-07-12', [{ type: 'learn', nodeId: 'a', duration: 30 }]),
      makeDay('2026-07-13', [{ type: 'learn', nodeId: 'b', duration: 30 }]),
      makeDay('2026-07-14', [{ type: 'learn', nodeId: 'c', duration: 30 }]),
      makeDay('2026-07-15', [{ type: 'learn', nodeId: 'd', duration: 30 }]),
    ]);
    const map = makeConceptMap({ a: 0.8, b: 0.8, c: 0.8, d: 0.8, reviewed: 0.5 });
    map.concepts.find((x) => x.id === 'reviewed')!.srState = {
      interval: 3,
      easeFactor: 2.5,
      repetitions: 2,
      dueDate: '2026-07-14',
    };
    const { adjustments, plan: adjusted } = adjustPlan(plan, map, { fromDate: '2026-07-12', reason: TEST_REASON });

    const inserts = adjustments.filter((a) => a.type === 'insert_review' && a.nodeId === 'reviewed');
    expect(inserts).toHaveLength(1);
    expect(inserts[0].date).toBe('2026-07-14'); // 正好落在 dueDate 当天
    expect(adjusted.schedule[2].tasks.some((t) => t.nodeId === 'reviewed' && t.type === 'review')).toBe(true);
    expect(adjusted.schedule[0].tasks.some((t) => t.nodeId === 'reviewed')).toBe(false);
    expect(adjusted.schedule[1].tasks.some((t) => t.nodeId === 'reviewed')).toBe(false);
  });

  it('重复调整不会重复插入同一概念同一日期的复习任务', () => {
    const plan = makePlan(120, [
      makeDay('2026-07-12', [{ type: 'learn', nodeId: 'a', duration: 30 }]),
      makeDay('2026-07-13', [{ type: 'learn', nodeId: 'b', duration: 30 }]),
    ]);
    const map = makeConceptMap({ a: 0.8, b: 0.8, very_weak: 0.1 });
    const first = adjustPlan(plan, map, { fromDate: '2026-07-12', reason: 'pass 1' });
    const second = adjustPlan(first.plan, map, { fromDate: '2026-07-12', reason: 'pass 2' });

    const secondInserts = second.adjustments.filter((a) => a.type === 'insert_review' && a.nodeId === 'very_weak');
    expect(secondInserts).toHaveLength(0); // 已存在于计划中 → 幂等跳过
    const day = second.plan.schedule.find((d) => d.date === '2026-07-12')!;
    expect(day.tasks.filter((t) => t.nodeId === 'very_weak' && t.type === 'review')).toHaveLength(1);
  });

  it('弱概念插入只发生在首个可调整日，不会每天铺满', () => {
    const plan = makePlan(120, [
      makeDay('2026-07-12', [{ type: 'learn', nodeId: 'a', duration: 30 }]),
      makeDay('2026-07-13', [{ type: 'learn', nodeId: 'b', duration: 30 }]),
      makeDay('2026-07-14', [{ type: 'learn', nodeId: 'c', duration: 30 }]),
      makeDay('2026-07-15', [{ type: 'learn', nodeId: 'd', duration: 30 }]),
    ]);
    const map = makeConceptMap({ a: 0.8, b: 0.8, c: 0.8, d: 0.8, very_weak: 0.1 });
    const { adjustments } = adjustPlan(plan, map, { fromDate: '2026-07-12', reason: TEST_REASON });

    const weakInserts = adjustments.filter((a) => a.type === 'insert_review' && a.nodeId === 'very_weak');
    expect(weakInserts).toHaveLength(1);
    expect(weakInserts[0].date).toBe('2026-07-12');
  });
});
