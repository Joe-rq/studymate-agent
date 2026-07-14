import fs from 'fs/promises';
import path from 'path';
import type { StudyPlan } from './planner.js';
import type { ConceptMap } from './concept_mapper.js';
import type { Event } from '../core/types.js';
import { createEventId, appendEvent } from '../core/event_log.js';
import { Paths } from '../core/paths.js';

/**
 * 单次计划调整的最大额外时长（分钟）。
 *
 * 掌握度越低的复习任务加得越多：extra = round((1 − mastery) × MAX_EXTRA_MINUTES)。
 * mastery=0 时加满 15 分钟，mastery=1 时不加时。
 */
const MAX_EXTRA_MINUTES = 15;

/** 默认的每日时长溢出上限倍数：调整后当天总时长不超过 dailyMinutes × 1.2。 */
const DEFAULT_MAX_OVERFLOW = 1.2;

/** 单条计划调整记录，用于事件日志与控制台反馈。 */
export interface PlanAdjustment {
  date: string;
  nodeId: string;
  /** 本次为该任务增加的复习时长（分钟）。 */
  addedMinutes: number;
  /** 调整时该概念的掌握度，便于追溯加时依据。 */
  mastery: number;
}

/** adjustPlan 的返回值：调整后的计划 + 逐条调整记录。 */
export interface AdjustPlanResult {
  plan: StudyPlan;
  adjustments: PlanAdjustment[];
}

export interface AdjustPlanOptions {
  /** 只调整该日期（含）之后的计划，默认从"明天"开始。 */
  fromDate?: string;
  /** 每日时长溢出上限倍数，默认 1.2。 */
  maxOverflow?: number;
}

/**
 * 根据掌握度，温和地为未来复习任务增加时长。
 *
 * 设计原则（渐进式，不打乱节奏）：
 * 1. 只调整 fromDate 及之后的 review 任务，今天的不动（今天可能已在进行）。
 * 2. 加时额度与掌握度反相关：mastery 越低加得越多，最多 MAX_EXTRA_MINUTES。
 * 3. 当天任务按掌握度从低到高排序，优先给最薄弱的概念加时。
 * 4. 软上限：调整后当天总时长 ≤ dailyMinutes × maxOverflow，超过则跳过该任务。
 * 5. learn 任务不调整（新学内容不应被拉长）。
 *
 * @param plan 当前主计划（会被深拷贝后修改，原对象不变）
 * @param conceptMap 含最新 mastery 的概念图
 */
export function adjustPlan(
  plan: StudyPlan,
  conceptMap: ConceptMap,
  options: AdjustPlanOptions = {}
): AdjustPlanResult {
  const { fromDate, maxOverflow = DEFAULT_MAX_OVERFLOW } = options;

  // 默认从明天开始调整：今天可能已在执行，不干预
  const today = new Date().toISOString().split('T')[0];
  const threshold = fromDate ?? today;

  // 建立 nodeId → mastery 的查找表，O(1) 取值
  const masteryById = new Map<string, number>();
  for (const concept of conceptMap.concepts) {
    masteryById.set(concept.id, concept.mastery);
  }

  const adjusted: StudyPlan = JSON.parse(JSON.stringify(plan));
  const adjustments: PlanAdjustment[] = [];
  const dailyCap = plan.dailyMinutes * maxOverflow;

  for (const day of adjusted.schedule) {
    // 跳过 threshold 之前的天（默认跳过今天及更早）
    if (day.date < threshold) continue;

    // 当天复习任务按掌握度从低到高排序，优先补最薄弱的
    const reviewTasks = day.tasks.filter((t) => t.type === 'review');
    reviewTasks.sort((a, b) => {
      const ma = masteryById.get(a.nodeId) ?? 1;
      const mb = masteryById.get(b.nodeId) ?? 1;
      return ma - mb;
    });

    for (const task of reviewTasks) {
      const mastery = masteryById.get(task.nodeId);
      // 该概念不在概念图中（可能已删除），不调整
      if (mastery === undefined) continue;
      // 完全掌握则不加时
      if (mastery >= 1) continue;

      const extra = Math.round((1 - mastery) * MAX_EXTRA_MINUTES);
      if (extra <= 0) continue;

      const currentTotal = day.tasks.reduce((sum, t) => sum + t.duration, 0);
      // 软上限：加时后不能超过当天上限，否则跳过该任务
      if (currentTotal + extra > dailyCap) continue;

      task.duration += extra;
      adjustments.push({
        date: day.date,
        nodeId: task.nodeId,
        addedMinutes: extra,
        mastery,
      });
    }
  }

  return { plan: adjusted, adjustments };
}

/**
 * 将调整后的计划写回 plan_master.json 和受影响的 plan_daily/*.json，
 * 并追加事件日志。
 *
 * 注意：plan_daily 下未被调整的天也会被重写（内容不变），保证主计划与
 * 每日文件一致。这是现有 savePlan 的行为，这里保持同步。
 */
export async function saveAdjustedPlan(
  plan: StudyPlan,
  adjustments: PlanAdjustment[],
  eventLogFile: string
): Promise<void> {
  await fs.mkdir(path.join(Paths.plan, 'plan_daily'), { recursive: true });

  await fs.writeFile(
    path.join(Paths.plan, 'plan_master.json'),
    JSON.stringify(plan, null, 2),
    'utf-8'
  );

  for (const day of plan.schedule) {
    await fs.writeFile(
      path.join(Paths.plan, 'plan_daily', `${day.date}.json`),
      JSON.stringify(day, null, 2),
      'utf-8'
    );
  }

  const event: Event = {
    id: createEventId(),
    timestamp: new Date().toISOString(),
    agent: 'plan_adjuster',
    action: 'plan_adjusted',
    input: { planId: plan.id, examDate: plan.examDate },
    output: {
      adjustmentCount: adjustments.length,
      adjustments: adjustments.map((a) => ({
        date: a.date,
        nodeId: a.nodeId,
        addedMinutes: a.addedMinutes,
      })),
    },
  };
  await appendEvent(eventLogFile, event);
}
