import fs from 'fs/promises';
import path from 'path';
import type { Concept, ConceptMap } from './concept_mapper.js';
import type { Event } from '../core/types.js';
import { createEventId, appendEvent } from '../core/event_log.js';
import { Paths } from '../core/paths.js';
import {
  addDaysToDateKey,
  daysBetweenDateKeys,
  isDateKey,
  todayDateKey,
} from '../core/date.js';
import { atomicWriteJSON } from '../core/atomic_file.js';

export const PROMPT_VERSION = 'plan_v2';

export interface PlanConfig {
  examDate: string;
  dailyMinutes: number;
  /** Dates the learner is unavailable (YYYY-MM-DD). */
  unavailableDates?: string[];
}

export type TaskType = 'learn' | 'review' | 'quiz' | 'buffer' | 'sprint';

export interface DailyTask {
  type: TaskType;
  nodeId: string;
  duration: number;
  /** Original task ID when this task was migrated from a missed day. */
  rolloverFrom?: string;
}

export interface DailyPlan {
  date: string;
  tasks: DailyTask[];
  /** True if this day is a rest/buffer day (no tasks). */
  isRest?: boolean;
}

export interface PlanPhase {
  name: 'learn' | 'consolidation' | 'buffer' | 'sprint';
  startDay: number; // 0-based index into schedule
  endDay: number;
}

/** 容量缺口结构化报告：计划不再静默丢失概念。 */
export interface PlanCapacitySummary {
  /** 全部待学概念所需的学习时长（分钟）。 */
  requiredMinutes: number;
  /** 计划期内可用于学习新概念的总时长（分钟）。 */
  availableMinutes: number;
  /** 已成功排入 learn 任务的概念数。 */
  scheduledConceptCount: number;
  /** 容量不足、未能排入计划的概念 ID。 */
  unscheduledConceptIds: string[];
}

export interface StudyPlan {
  id: string;
  examDate: string;
  dailyMinutes: number;
  schedule: DailyPlan[];
  phases: PlanPhase[];
  version: number;
  /** 容量缺口报告。旧版本计划文件可能缺失此字段。 */
  capacity?: PlanCapacitySummary;
}

// ── Capacity Estimation ─────────────────────────────────────────────

/**
 * Estimate task duration based on concept difficulty/mastery and task type.
 * - learn: 20 + difficulty * 20 (20-40 min)
 * - review: 10 + (1 - mastery) * 10 (10-20 min)
 * - quiz: 15 fixed per concept batch
 * - sprint: 10 fixed
 * - buffer: 0 (rest day marker)
 */
export function estimateDuration(concept: Concept, taskType: TaskType): number {
  const difficulty = concept.difficulty ?? 0.5;
  switch (taskType) {
    case 'learn':
      return Math.round(20 + difficulty * 20);
    case 'review':
      return Math.round(10 + (1 - concept.mastery) * 10);
    case 'quiz':
      return 15;
    case 'sprint':
      return 10;
    case 'buffer':
      return 0;
  }
}

// ── Validation ──────────────────────────────────────────────────────

/** Validate plan config before generating. */
function validateConfig(config: PlanConfig): void {
  if (!isDateKey(config.examDate)) {
    throw new Error(`Invalid exam date: ${config.examDate}`);
  }
  if (daysBetweenDateKeys(todayDateKey(), config.examDate) <= 0) {
    throw new Error(`Exam date must be in the future: ${config.examDate}`);
  }
  if (!Number.isFinite(config.dailyMinutes) || config.dailyMinutes <= 0) {
    throw new Error(`dailyMinutes must be > 0, got: ${config.dailyMinutes}`);
  }
  if (config.dailyMinutes > 480) {
    throw new Error(`dailyMinutes must be <= 480 (8h), got: ${config.dailyMinutes}`);
  }
  for (const date of config.unavailableDates ?? []) {
    if (!isDateKey(date)) {
      throw new Error(`Invalid unavailable date: ${date}`);
    }
  }
}

// ── Plan Generation ─────────────────────────────────────────────────

/** 初始计划的固定复习间隔（学习日之后第 N 天）。运行时复习由 SM-2（srState）接管。 */
const REVIEW_INTERVALS = [1, 3, 7, 15, 30];

/** Insert a quiz day after every N learn days. */
const QUIZ_EVERY_N_DAYS = 4;

/** Insert a buffer/rest day after every N active days. */
const BUFFER_EVERY_N_DAYS = 7;

/** 日分类：决定主循环如何生成任务，保证容量打包与排程一致。 */
type DayKind = 'rest' | 'learn' | 'quizday' | 'consolidation' | 'sprint';

/**
 * Generate a study plan.
 *
 * 保证：learningOrder 中每个概念要么被排入一次 learn 任务，要么出现在
 * capacity.unscheduledConceptIds（容量缺口被显式报告，绝不静默丢弃）。
 * 计划生成不修改 Concept.srState；初始复习使用固定间隔，
 * 真实作答后的下一次复习日期由 mastery_tracker 通过 SM-2 更新。
 */
export function generatePlan(conceptMap: ConceptMap, config: PlanConfig): StudyPlan {
  validateConfig(config);

  const { concepts, learningOrder } = conceptMap;
  const conceptById = new Map(concepts.map((c) => [c.id, c]));
  const today = todayDateKey();

  const totalDays = Math.max(1, daysBetweenDateKeys(today, config.examDate));
  const unavailableSet = new Set(config.unavailableDates ?? []);

  // Phase boundaries
  const sprintDays = Math.min(5, Math.max(3, Math.floor(totalDays * 0.08)));
  const learnPhaseDays = Math.max(1, Math.floor((totalDays - sprintDays) * 0.65));
  const consolidationPhaseDays = totalDays - sprintDays - learnPhaseDays;

  // 1) 预先分类每一天（休息/学习/测验/巩固/冲刺）。
  //    一次性分类保证后续容量打包与主循环对“哪些天可学”的判断一致。
  const dayKinds: DayKind[] = [];
  {
    let activeRun = 0;
    for (let d = 0; d < totalDays; d++) {
      const dateStr = getDateStr(today, d);
      const isSprint = d >= totalDays - sprintDays;
      if (unavailableSet.has(dateStr)) {
        dayKinds.push('rest');
        activeRun = 0;
        continue;
      }
      if (!isSprint && activeRun > 0 && activeRun % BUFFER_EVERY_N_DAYS === 0) {
        dayKinds.push('rest');
        activeRun = 0;
        continue;
      }
      if (isSprint) {
        dayKinds.push('sprint');
      } else if (d < learnPhaseDays) {
        dayKinds.push(
          activeRun > 0 && (activeRun + 1) % QUIZ_EVERY_N_DAYS === 0 ? 'quizday' : 'learn'
        );
      } else {
        dayKinds.push('consolidation');
      }
      activeRun++;
    }
  }

  // 2) 按容量把 learn 任务贪心打包进可学习日（learn + consolidation，不含冲刺）。
  //    装不下时顺延到下一天；仍装不下的概念进入 unscheduledConceptIds。
  const learnableDays: number[] = [];
  for (let d = 0; d < totalDays; d++) {
    if (dayKinds[d] === 'learn' || dayKinds[d] === 'consolidation') learnableDays.push(d);
  }

  const learnDayMap = new Map<string, number>();
  const unscheduledConceptIds: string[] = [];
  {
    let dayPtr = 0;
    let used = 0;
    for (const nodeId of learningOrder) {
      const concept = conceptById.get(nodeId);
      if (!concept) continue;
      const duration = estimateDuration(concept, 'learn');
      while (dayPtr < learnableDays.length && used + duration > config.dailyMinutes) {
        dayPtr++;
        used = 0;
      }
      if (dayPtr >= learnableDays.length) {
        unscheduledConceptIds.push(nodeId);
        continue;
      }
      learnDayMap.set(nodeId, learnableDays[dayPtr]);
      used += duration;
    }
  }

  // 3) Build schedule from the precomputed day classification.
  const schedule: DailyPlan[] = [];
  const learnPhaseLearnDays = dayKinds.filter((k) => k === 'learn').length;
  const scheduledCount = learnDayMap.size;
  const avgPerDay = learnPhaseLearnDays > 0 ? Math.ceil(scheduledCount / learnPhaseLearnDays) : scheduledCount;

  for (let d = 0; d < totalDays; d++) {
    const dateStr = getDateStr(today, d);
    const kind = dayKinds[d];
    const tasks: DailyTask[] = [];

    if (kind === 'rest') {
      schedule.push({ date: dateStr, tasks: [], isRest: true });
      continue;
    }

    if (kind === 'sprint') {
      // Sprint: review all concepts with low mastery
      for (const nodeId of learningOrder) {
        const concept = conceptById.get(nodeId);
        if (!concept) continue;
        tasks.push({ type: 'sprint', nodeId, duration: estimateDuration(concept, 'sprint') });
      }
    } else if (kind === 'quizday') {
      const recentNodes = learningOrder.filter((id) => {
        const ld = learnDayMap.get(id);
        return ld !== undefined && d - ld <= QUIZ_EVERY_N_DAYS && d - ld >= 0;
      });
      for (const nodeId of recentNodes) {
        const concept = conceptById.get(nodeId);
        if (!concept) continue;
        tasks.push({ type: 'quiz', nodeId, duration: estimateDuration(concept, 'quiz') });
      }
      appendFixedIntervalReviews(tasks, dayKinds, d, learnDayMap, conceptById, learningOrder);
    } else {
      // learn / consolidation：新学任务 + 固定间隔复习（巩固期 quiz 复习近期概念）
      for (const nodeId of learningOrder) {
        if (learnDayMap.get(nodeId) === d) {
          const concept = conceptById.get(nodeId);
          if (!concept) continue;
          tasks.push({ type: 'learn', nodeId, duration: estimateDuration(concept, 'learn') });
        }
      }
      if (kind === 'consolidation' && tasks.length === 0) {
        const quizNodes = learningOrder
          .filter((id) => learnDayMap.has(id))
          .slice(-Math.min(learningOrder.length, avgPerDay * 5));
        for (const nodeId of quizNodes) {
          const concept = conceptById.get(nodeId);
          if (!concept) continue;
          tasks.push({ type: 'quiz', nodeId, duration: estimateDuration(concept, 'quiz') });
        }
      }
      appendFixedIntervalReviews(tasks, dayKinds, d, learnDayMap, conceptById, learningOrder);
    }

    // Capacity limit: prioritize learn/sprint > quiz > review。
    // learn 任务在打包阶段已保证当天装得下，这里只会裁剪 quiz/review/sprint 溢出。
    tasks.sort((a, b) => taskPriority(a.type) - taskPriority(b.type));
    let used = 0;
    const limitedTasks: DailyTask[] = [];
    for (const task of tasks) {
      if (used + task.duration <= config.dailyMinutes) {
        limitedTasks.push(task);
        used += task.duration;
      }
    }

    schedule.push({ date: dateStr, tasks: limitedTasks });
  }

  // Compute phase boundaries
  const phases: PlanPhase[] = [];
  phases.push({ name: 'learn', startDay: 0, endDay: learnPhaseDays - 1 });
  if (consolidationPhaseDays > 0) {
    phases.push({ name: 'consolidation', startDay: learnPhaseDays, endDay: totalDays - sprintDays - 1 });
  }
  phases.push({ name: 'sprint', startDay: totalDays - sprintDays, endDay: totalDays - 1 });

  // 4) 容量报告
  const requiredMinutes = learningOrder.reduce((sum, id) => {
    const c = conceptById.get(id);
    return c ? sum + estimateDuration(c, 'learn') : sum;
  }, 0);
  const capacity: PlanCapacitySummary = {
    requiredMinutes,
    availableMinutes: config.dailyMinutes * learnableDays.length,
    scheduledConceptCount: learnDayMap.size,
    unscheduledConceptIds,
  };

  return {
    id: `plan_${Date.now()}`,
    examDate: config.examDate,
    dailyMinutes: config.dailyMinutes,
    schedule,
    phases,
    version: 1,
    capacity,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────

function getDateStr(base: string, offsetDays: number): string {
  return addDaysToDateKey(base, offsetDays);
}

function taskPriority(type: TaskType): number {
  switch (type) {
    case 'learn': return 0;
    case 'sprint': return 0;
    case 'quiz': return 1;
    case 'review': return 2;
    case 'buffer': return 3;
  }
}

/**
 * 初始计划的固定间隔复习：概念在学习日后第 1/3/7/15/30 天复习一次。
 * 目标日是休息日时顺延到下一个非休息日；每天每概念最多一条 review。
 * 刻意不读取 srState —— 静态未来计划不得用运行时 SM-2 状态判定到期。
 */
function appendFixedIntervalReviews(
  tasks: DailyTask[],
  dayKinds: DayKind[],
  currentDay: number,
  learnDayMap: Map<string, number>,
  conceptById: Map<string, Concept>,
  learningOrder: string[]
): void {
  const scheduled = new Set(tasks.map((t) => `${t.nodeId}:${t.type}`));
  for (const nodeId of learningOrder) {
    const learnDay = learnDayMap.get(nodeId);
    if (learnDay === undefined) continue;
    const concept = conceptById.get(nodeId);
    if (!concept) continue;
    for (const interval of REVIEW_INTERVALS) {
      let target = learnDay + interval;
      while (target < dayKinds.length && dayKinds[target] === 'rest') target++;
      if (target > currentDay) break; // 该间隔及后续间隔都在未来
      if (target < currentDay) continue; // 该间隔已落在更早的日期
      // target === currentDay
      const key = `${nodeId}:review`;
      if (!scheduled.has(key)) {
        tasks.push({ type: 'review', nodeId, duration: estimateDuration(concept, 'review') });
        scheduled.add(key);
      }
      break;
    }
  }
}

// ── Plan Summary ────────────────────────────────────────────────────

export function formatPlanSummary(plan: StudyPlan, conceptMap: ConceptMap): string {
  const lines: string[] = [];
  lines.push(`═══ 学习计划概览 ═══`);
  lines.push(`总天数: ${plan.schedule.length} 天`);
  lines.push(`每日时长: ${plan.dailyMinutes} 分钟`);
  lines.push(`概念总数: ${conceptMap.learningOrder.length} 个`);
  lines.push('');

  // Phase breakdown
  lines.push('阶段划分:');
  for (const phase of plan.phases) {
    const startDate = plan.schedule[phase.startDay]?.date ?? '?';
    const endDate = plan.schedule[phase.endDay]?.date ?? '?';
    const days = phase.endDay - phase.startDay + 1;
    const label = phase.name === 'learn' ? '学习' : phase.name === 'consolidation' ? '巩固' : phase.name === 'sprint' ? '冲刺' : '缓冲';
    lines.push(`  ${label}阶段: ${startDate} ~ ${endDate} (${days} 天)`);
  }
  lines.push('');

  // Task distribution
  const taskCounts: Record<string, number> = { learn: 0, review: 0, quiz: 0, sprint: 0, buffer: 0 };
  let totalMinutes = 0;
  for (const day of plan.schedule) {
    for (const t of day.tasks) {
      taskCounts[t.type] = (taskCounts[t.type] ?? 0) + 1;
      totalMinutes += t.duration;
    }
  }
  const restDays = plan.schedule.filter((d) => d.isRest).length;

  lines.push('任务分布:');
  lines.push(`  学习: ${taskCounts['learn']} 项`);
  lines.push(`  复习: ${taskCounts['review']} 项`);
  lines.push(`  测验: ${taskCounts['quiz']} 项`);
  lines.push(`  冲刺: ${taskCounts['sprint']} 项`);
  lines.push(`  休息/缓冲: ${restDays} 天`);
  lines.push(`  总学习时长: ${totalMinutes} 分钟 (${(totalMinutes / 60).toFixed(1)} 小时)`);
  lines.push('');

  // 容量缺口报告：有概念未被排入时必须显式提示，不得静默丢失
  if (plan.capacity && plan.capacity.unscheduledConceptIds.length > 0) {
    const cap = plan.capacity;
    lines.push('⚠️ 容量不足警告:');
    lines.push(
      `  共需 ${cap.requiredMinutes} 分钟学习时间，计划期内容量约 ${cap.availableMinutes} 分钟。`
    );
    lines.push(
      `  ${cap.unscheduledConceptIds.length} 个概念无法在考试前排入：${cap.unscheduledConceptIds.join(', ')}`
    );
    lines.push('  建议：增加每日学习时长、延后考试日期，或确认后接受部分概念不进入本轮计划。');
    lines.push('');
  }

  // Concepts per day
  const activeDays = plan.schedule.filter((d) => !d.isRest && d.tasks.length > 0).length;
  const avgPerDay = activeDays > 0 ? (conceptMap.learningOrder.length / activeDays).toFixed(1) : '0';
  lines.push(`平均每日概念: ${avgPerDay} 个`);

  return lines.join('\n');
}

// ── Persistence ─────────────────────────────────────────────────────

export async function savePlan(plan: StudyPlan, eventLogFile: string, workspaceRoot?: string): Promise<void> {
  const planDir = workspaceRoot ? path.join(workspaceRoot, 'plan') : Paths.plan;
  await fs.mkdir(planDir, { recursive: true });
  await fs.mkdir(path.join(planDir, 'plan_daily'), { recursive: true });

  await atomicWriteJSON(path.join(planDir, 'plan_master.json'), plan);

  for (const day of plan.schedule) {
    await atomicWriteJSON(path.join(planDir, 'plan_daily', `${day.date}.json`), day);
  }

  const event: Event = {
    id: createEventId(),
    timestamp: new Date().toISOString(),
    agent: 'planner',
    action: 'plan_generated',
    input: { examDate: plan.examDate, dailyMinutes: plan.dailyMinutes },
    output: { planId: plan.id, totalDays: plan.schedule.length, version: plan.version },
  };
  await appendEvent(eventLogFile, event);
}
