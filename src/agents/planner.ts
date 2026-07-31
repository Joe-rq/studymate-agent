import fs from 'fs/promises';
import path from 'path';
import type { ConceptMap } from './concept_mapper.js';
import type { Event } from '../core/types.js';
import { createEventId, appendEvent } from '../core/event_log.js';
import { Paths } from '../core/paths.js';

export interface PlanConfig {
  examDate: string;
  dailyMinutes: number;
  /** Dates the learner is unavailable (YYYY-MM-DD). */
  unavailableDates?: string[];
}

export interface DailyTask {
  type: 'learn' | 'review' | 'sprint';
  nodeId: string;
  duration: number;
}

export interface DailyPlan {
  date: string;
  tasks: DailyTask[];
  /** True if this day is a rest/buffer day (no tasks). */
  isRest?: boolean;
}

export interface StudyPlan {
  id: string;
  examDate: string;
  dailyMinutes: number;
  schedule: DailyPlan[];
}

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

export function generatePlan(conceptMap: ConceptMap, config: PlanConfig): StudyPlan {
  validateConfig(config);

  const { concepts, learningOrder } = conceptMap;
  const examDate = new Date(config.examDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const totalDays = Math.max(1, Math.ceil((examDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));

  const unavailableSet = new Set(config.unavailableDates ?? []);
  const reviewIntervals = [1, 3, 7, 15, 30];

  // Sprint phase: last 3 days before exam are review-only sprint
  const sprintDays = Math.min(3, Math.max(0, totalDays - 1));
  const learnPhaseEnd = totalDays - sprintDays; // day index where learning stops

  // Distribute learning tasks evenly across the learn phase
  const availableLearnDays = Math.max(1, learnPhaseEnd);
  const conceptsPerDay = Math.ceil(learningOrder.length / availableLearnDays);

  // Map each concept to the day it should be learned
  const learnDayMap = new Map<string, number>();
  for (let i = 0; i < learningOrder.length; i++) {
    const day = Math.floor(i / conceptsPerDay);
    learnDayMap.set(learningOrder[i], Math.min(day, availableLearnDays - 1));
  }

  const schedule: DailyPlan[] = [];

  for (let d = 0; d < totalDays; d++) {
    const date = new Date(today);
    date.setDate(today.getDate() + d);
    const dateStr = date.toISOString().split('T')[0];

    // Skip unavailable dates
    if (unavailableSet.has(dateStr)) {
      schedule.push({ date: dateStr, tasks: [], isRest: true });
      continue;
    }

    const isSprint = d >= learnPhaseEnd;
    const tasks: DailyTask[] = [];

    if (!isSprint) {
      // Learning tasks for this day
      for (const nodeId of learningOrder) {
        if (learnDayMap.get(nodeId) === d) {
          tasks.push({ type: 'learn', nodeId, duration: 30 });
        }
      }
    }

    // Review tasks: based on intervals from learn day
    for (const interval of reviewIntervals) {
      const reviewDay = d - interval;
      if (reviewDay < 0) continue;
      for (const nodeId of learningOrder) {
        if (learnDayMap.get(nodeId) === reviewDay) {
          const taskType: DailyTask['type'] = isSprint ? 'sprint' : 'review';
          tasks.push({ type: taskType, nodeId, duration: 15 });
        }
      }
    }

    // Capacity limit: fill tasks up to dailyMinutes, prioritize by type
    // learn/sprint tasks first, then review
    tasks.sort((a, b) => {
      const priority = { learn: 0, sprint: 0, review: 1 };
      return priority[a.type] - priority[b.type];
    });

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

  return {
    id: `plan_${Date.now()}`,
    examDate: config.examDate,
    dailyMinutes: config.dailyMinutes,
    schedule,
  };
}

export async function savePlan(plan: StudyPlan, eventLogFile: string): Promise<void> {
  await fs.mkdir(Paths.plan, { recursive: true });
  await fs.mkdir(path.join(Paths.plan, 'plan_daily'), { recursive: true });

  await fs.writeFile(path.join(Paths.plan, 'plan_master.json'), JSON.stringify(plan, null, 2), 'utf-8');

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
    agent: 'planner',
    action: 'plan_generated',
    input: { examDate: plan.examDate, dailyMinutes: plan.dailyMinutes },
    output: { planId: plan.id, totalDays: plan.schedule.length },
  };
  await appendEvent(eventLogFile, event);
}
