import fs from 'fs/promises';
import path from 'path';
import type { StudyPlan, DailyTask } from './planner.js';
import { estimateDuration } from './planner.js';
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

/** Mastery threshold below which a NEW review task is inserted. */
const INSERT_REVIEW_THRESHOLD = 0.3;

/** 单条计划调整记录，用于事件日志与控制台反馈。 */
export interface PlanAdjustment {
  date: string;
  nodeId: string;
  type: 'extend' | 'insert_review' | 'insert_quiz';
  /** 本次为该任务增加的复习时长（分钟）。 */
  addedMinutes: number;
  /** 调整时该概念的掌握度，便于追溯加时依据。 */
  mastery: number;
  /** 调整原因。 */
  reason: string;
}

/** 每次调整的完整记录，写入 adjustment_log.jsonl。 */
export interface AdjustmentRecord {
  adjustedAt: string;
  reason: string;
  version: number;
  changes: PlanAdjustment[];
  summary: { tasksAdded: number; minutesAdded: number; daysAffected: number };
}

/** adjustPlan 的返回值：调整后的计划 + 调整记录。 */
export interface AdjustPlanResult {
  plan: StudyPlan;
  adjustments: PlanAdjustment[];
  record: AdjustmentRecord;
}

export interface AdjustPlanOptions {
  /** 只调整该日期（含）之后的计划，默认从“明天”开始。 */
  fromDate?: string;
  /** 每日时长溢出上限倍数，默认 1.2。 */
  maxOverflow?: number;
  /** 调整原因（必填）。 */
  reason: string;
  /** 需要插入测验的概念 ID（如从 weakness_profile 中获取）。 */
  quizNodeIds?: string[];
}

/**
 * 根据掌握度调整计划：
 * 1. 为现有 review 任务加时（mastery < 1）
 * 2. 为 mastery < 0.3 的概念插入新的 review 任务
 * 3. 为 quizNodeIds 中的概念插入 quiz 任务
 * 4. 每次调整保留原因和调整前后差异
 */
export function adjustPlan(
  plan: StudyPlan,
  conceptMap: ConceptMap,
  options: AdjustPlanOptions
): AdjustPlanResult {
  const { fromDate, maxOverflow = DEFAULT_MAX_OVERFLOW, reason, quizNodeIds = [] } = options;

  // 默认从明天开始调整：今天可能已在执行，不干预
  const today = new Date().toISOString().split('T')[0];
  const threshold = fromDate ?? today;

  // 建立 nodeId → concept 的查找表
  const conceptById = new Map(conceptMap.concepts.map((c) => [c.id, c]));

  const adjusted: StudyPlan = JSON.parse(JSON.stringify(plan));
  adjusted.version = (plan.version ?? 1) + 1;
  const adjustments: PlanAdjustment[] = [];
  const dailyCap = plan.dailyMinutes * maxOverflow;

  // Track which nodes already have tasks on each day (for insert logic)
  const quizSet = new Set(quizNodeIds);

  for (const day of adjusted.schedule) {
    if (day.date < threshold) continue;
    if (day.isRest) continue;

    const currentTotal = () => day.tasks.reduce((sum, t) => sum + t.duration, 0);

    // 1. Extend existing review tasks
    const reviewTasks = day.tasks.filter((t) => t.type === 'review');
    reviewTasks.sort((a, b) => {
      const ma = conceptById.get(a.nodeId)?.mastery ?? 1;
      const mb = conceptById.get(b.nodeId)?.mastery ?? 1;
      return ma - mb;
    });

    for (const task of reviewTasks) {
      const concept = conceptById.get(task.nodeId);
      if (!concept || concept.mastery >= 1) continue;

      const extra = Math.round((1 - concept.mastery) * MAX_EXTRA_MINUTES);
      if (extra <= 0) continue;
      if (currentTotal() + extra > dailyCap) continue;

      task.duration += extra;
      adjustments.push({
        date: day.date,
        nodeId: task.nodeId,
        type: 'extend',
        addedMinutes: extra,
        mastery: concept.mastery,
        reason,
      });
    }

    // 2. Insert NEW review tasks for very weak concepts not already scheduled today
    const todayNodeIds = new Set(day.tasks.map((t) => t.nodeId));
    for (const concept of conceptMap.concepts) {
      if (concept.mastery >= INSERT_REVIEW_THRESHOLD) continue;
      if (todayNodeIds.has(concept.id)) continue;
      if (concept.unverified) continue;

      const duration = estimateDuration(concept, 'review');
      if (currentTotal() + duration > dailyCap) continue;

      day.tasks.push({ type: 'review', nodeId: concept.id, duration });
      todayNodeIds.add(concept.id);
      adjustments.push({
        date: day.date,
        nodeId: concept.id,
        type: 'insert_review',
        addedMinutes: duration,
        mastery: concept.mastery,
        reason: `mastery ${concept.mastery.toFixed(2)} < ${INSERT_REVIEW_THRESHOLD}`,
      });
    }

    // 3. Insert quiz tasks for concepts that need re-testing
    for (const nodeId of quizNodeIds) {
      if (todayNodeIds.has(nodeId)) continue;
      const concept = conceptById.get(nodeId);
      if (!concept) continue;

      const duration = estimateDuration(concept, 'quiz');
      if (currentTotal() + duration > dailyCap) continue;

      day.tasks.push({ type: 'quiz', nodeId, duration });
      todayNodeIds.add(nodeId);
      adjustments.push({
        date: day.date,
        nodeId,
        type: 'insert_quiz',
        addedMinutes: duration,
        mastery: concept.mastery,
        reason: 're-test after repeated failures',
      });
    }
  }

  // Build adjustment record
  const daysAffected = new Set(adjustments.map((a) => a.date)).size;
  const tasksAdded = adjustments.filter((a) => a.type !== 'extend').length;
  const minutesAdded = adjustments.reduce((s, a) => s + a.addedMinutes, 0);

  const record: AdjustmentRecord = {
    adjustedAt: new Date().toISOString(),
    reason,
    version: adjusted.version,
    changes: adjustments,
    summary: { tasksAdded, minutesAdded, daysAffected },
  };

  return { plan: adjusted, adjustments, record };
}

/**
 * 将调整后的计划写回 plan_master.json 和 plan_daily/*.json，
 * 并追加事件日志和调整历史。
 */
export async function saveAdjustedPlan(
  plan: StudyPlan,
  record: AdjustmentRecord,
  eventLogFile: string,
  workspaceRoot?: string
): Promise<void> {
  const planDir = workspaceRoot ? path.join(workspaceRoot, 'plan') : Paths.plan;
  await fs.mkdir(path.join(planDir, 'plan_daily'), { recursive: true });

  await fs.writeFile(
    path.join(planDir, 'plan_master.json'),
    JSON.stringify(plan, null, 2),
    'utf-8'
  );

  for (const day of plan.schedule) {
    await fs.writeFile(
      path.join(planDir, 'plan_daily', `${day.date}.json`),
      JSON.stringify(day, null, 2),
      'utf-8'
    );
  }

  // Append to adjustment history log
  const logPath = path.join(planDir, 'adjustment_log.jsonl');
  await fs.appendFile(logPath, JSON.stringify(record) + '\n', 'utf-8');

  const event: Event = {
    id: createEventId(),
    timestamp: new Date().toISOString(),
    agent: 'plan_adjuster',
    action: 'plan_adjusted',
    input: { planId: plan.id, examDate: plan.examDate, reason: record.reason },
    output: {
      version: plan.version,
      adjustmentCount: record.changes.length,
      ...record.summary,
    },
  };
  await appendEvent(eventLogFile, event);
}
