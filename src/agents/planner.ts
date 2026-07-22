import fs from 'fs/promises';
import path from 'path';
import type { Concept, ConceptMap } from './concept_mapper.js';
import type { Event } from '../core/types.js';
import { createEventId, appendEvent } from '../core/event_log.js';
import { Paths } from '../core/paths.js';

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

export interface StudyPlan {
  id: string;
  examDate: string;
  dailyMinutes: number;
  schedule: DailyPlan[];
  phases: PlanPhase[];
  version: number;
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
  const examDate = new Date(config.examDate);
  if (isNaN(examDate.getTime())) {
    throw new Error(`Invalid exam date: ${config.examDate}`);
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (examDate <= today) {
    throw new Error(`Exam date must be in the future: ${config.examDate}`);
  }
  if (!Number.isFinite(config.dailyMinutes) || config.dailyMinutes <= 0) {
    throw new Error(`dailyMinutes must be > 0, got: ${config.dailyMinutes}`);
  }
  if (config.dailyMinutes > 480) {
    throw new Error(`dailyMinutes must be <= 480 (8h), got: ${config.dailyMinutes}`);
  }
}

// ── Plan Generation ─────────────────────────────────────────────────

/** Spaced-repetition review intervals (days after learn day). */
const REVIEW_INTERVALS = [1, 3, 7, 15, 30];

/** Insert a quiz day after every N learn days. */
const QUIZ_EVERY_N_DAYS = 4;

/** Insert a buffer/rest day after every N active days. */
const BUFFER_EVERY_N_DAYS = 7;

export function generatePlan(conceptMap: ConceptMap, config: PlanConfig): StudyPlan {
  validateConfig(config);

  const { concepts, learningOrder } = conceptMap;
  const conceptById = new Map(concepts.map((c) => [c.id, c]));
  const examDate = new Date(config.examDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const totalDays = Math.max(1, Math.ceil((examDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));
  const unavailableSet = new Set(config.unavailableDates ?? []);

  // Phase boundaries
  const sprintDays = Math.min(5, Math.max(3, Math.floor(totalDays * 0.08)));
  const learnPhaseDays = Math.max(1, Math.floor((totalDays - sprintDays) * 0.65));
  const consolidationPhaseDays = totalDays - sprintDays - learnPhaseDays;

  // Distribute concepts across learn phase (accounting for quiz/buffer days)
  const activeLearnDays: number[] = [];
  let activeCount = 0;
  for (let d = 0; d < learnPhaseDays; d++) {
    const dateStr = getDateStr(today, d);
    if (unavailableSet.has(dateStr)) continue;
    // Skip quiz days and buffer days within learn phase
    if (activeCount > 0 && activeCount % QUIZ_EVERY_N_DAYS === 0) { activeCount++; continue; }
    if (activeCount > 0 && activeCount % BUFFER_EVERY_N_DAYS === 0) { activeCount++; continue; }
    activeLearnDays.push(d);
    activeCount++;
  }

  const conceptsPerDay = Math.max(1, Math.ceil(learningOrder.length / Math.max(1, activeLearnDays.length)));
  const learnDayMap = new Map<string, number>();
  for (let i = 0; i < learningOrder.length; i++) {
    const slotIdx = Math.min(Math.floor(i / conceptsPerDay), activeLearnDays.length - 1);
    learnDayMap.set(learningOrder[i], activeLearnDays[slotIdx]);
  }

  // Build schedule
  const schedule: DailyPlan[] = [];
  const phases: PlanPhase[] = [];
  let consecutiveActive = 0;

  for (let d = 0; d < totalDays; d++) {
    const dateStr = getDateStr(today, d);
    const isSprint = d >= totalDays - sprintDays;
    const isConsolidation = !isSprint && d >= learnPhaseDays;

    // Unavailable → rest
    if (unavailableSet.has(dateStr)) {
      schedule.push({ date: dateStr, tasks: [], isRest: true });
      consecutiveActive = 0;
      continue;
    }

    // Buffer day: every BUFFER_EVERY_N_DAYS active days (not in sprint)
    if (!isSprint && consecutiveActive > 0 && consecutiveActive % BUFFER_EVERY_N_DAYS === 0) {
      schedule.push({ date: dateStr, tasks: [], isRest: true });
      consecutiveActive = 0;
      continue;
    }

    const tasks: DailyTask[] = [];

    if (isSprint) {
      // Sprint: review all concepts with low mastery
      for (const nodeId of learningOrder) {
        const concept = conceptById.get(nodeId);
        if (!concept) continue;
        tasks.push({ type: 'sprint', nodeId, duration: estimateDuration(concept, 'sprint') });
      }
    } else if (isConsolidation) {
      // Consolidation: quiz on recently learned + review
      const quizNodes = learningOrder.slice(0, Math.min(learningOrder.length, conceptsPerDay * 5));
      for (const nodeId of quizNodes) {
        const concept = conceptById.get(nodeId);
        if (!concept) continue;
        tasks.push({ type: 'quiz', nodeId, duration: estimateDuration(concept, 'quiz') });
      }
      // Add review tasks from intervals
      addReviewTasks(tasks, d, learnDayMap, conceptById, learningOrder, 'review');
    } else {
      // Learn phase
      // Quiz day?
      if (consecutiveActive > 0 && (consecutiveActive + 1) % QUIZ_EVERY_N_DAYS === 0) {
        const recentNodes = learningOrder.filter((id) => {
          const ld = learnDayMap.get(id);
          return ld !== undefined && d - ld <= QUIZ_EVERY_N_DAYS && d - ld >= 0;
        });
        for (const nodeId of recentNodes) {
          const concept = conceptById.get(nodeId);
          if (!concept) continue;
          tasks.push({ type: 'quiz', nodeId, duration: estimateDuration(concept, 'quiz') });
        }
      } else {
        // New learn tasks
        for (const nodeId of learningOrder) {
          if (learnDayMap.get(nodeId) === d) {
            const concept = conceptById.get(nodeId);
            if (!concept) continue;
            tasks.push({ type: 'learn', nodeId, duration: estimateDuration(concept, 'learn') });
          }
        }
      }
      // Review tasks from intervals
      addReviewTasks(tasks, d, learnDayMap, conceptById, learningOrder, 'review');
    }

    // Capacity limit: prioritize learn/sprint > quiz > review
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
    consecutiveActive++;
  }

  // Compute phase boundaries
  phases.push({ name: 'learn', startDay: 0, endDay: learnPhaseDays - 1 });
  if (consolidationPhaseDays > 0) {
    phases.push({ name: 'consolidation', startDay: learnPhaseDays, endDay: totalDays - sprintDays - 1 });
  }
  phases.push({ name: 'sprint', startDay: totalDays - sprintDays, endDay: totalDays - 1 });

  return {
    id: `plan_${Date.now()}`,
    examDate: config.examDate,
    dailyMinutes: config.dailyMinutes,
    schedule,
    phases,
    version: 1,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────

function getDateStr(base: Date, offsetDays: number): string {
  const d = new Date(base);
  d.setDate(base.getDate() + offsetDays);
  return d.toISOString().split('T')[0];
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

function addReviewTasks(
  tasks: DailyTask[],
  currentDay: number,
  learnDayMap: Map<string, number>,
  conceptById: Map<string, Concept>,
  learningOrder: string[],
  type: 'review' | 'sprint'
): void {
  for (const interval of REVIEW_INTERVALS) {
    const reviewDay = currentDay - interval;
    if (reviewDay < 0) continue;
    for (const nodeId of learningOrder) {
      if (learnDayMap.get(nodeId) === reviewDay) {
        const concept = conceptById.get(nodeId);
        if (!concept) continue;
        tasks.push({ type, nodeId, duration: estimateDuration(concept, type) });
      }
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

  await fs.writeFile(path.join(planDir, 'plan_master.json'), JSON.stringify(plan, null, 2), 'utf-8');

  for (const day of plan.schedule) {
    await fs.writeFile(
      path.join(planDir, 'plan_daily', `${day.date}.json`),
      JSON.stringify(day, null, 2),
      'utf-8'
    );
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
