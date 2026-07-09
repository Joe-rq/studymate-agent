import fs from 'fs/promises';
import path from 'path';
import type { ConceptMap } from './concept_mapper.js';
import type { Event } from '../core/types.js';
import { createEventId, appendEvent } from '../core/event_log.js';
import { Paths } from '../core/paths.js';

export interface PlanConfig {
  examDate: string;
  dailyMinutes: number;
}

export interface DailyTask {
  type: 'learn' | 'review';
  nodeId: string;
  duration: number;
}

export interface DailyPlan {
  date: string;
  tasks: DailyTask[];
}

export interface StudyPlan {
  id: string;
  examDate: string;
  dailyMinutes: number;
  schedule: DailyPlan[];
}

export function generatePlan(conceptMap: ConceptMap, config: PlanConfig): StudyPlan {
  const { concepts, learningOrder } = conceptMap;
  const examDate = new Date(config.examDate);
  const today = new Date();
  const totalDays = Math.max(1, Math.ceil((examDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));

  const schedule: DailyPlan[] = [];
  const reviewIntervals = [1, 3, 7, 15];

  const learnDayMap = new Map<string, number>();
  for (let i = 0; i < learningOrder.length; i++) {
    const day = Math.min(i, totalDays - 1);
    learnDayMap.set(learningOrder[i], day);
  }

  for (let d = 0; d < Math.min(totalDays, 14); d++) {
    const date = new Date(today);
    date.setDate(today.getDate() + d);
    const dateStr = date.toISOString().split('T')[0];
    const tasks: DailyTask[] = [];

    for (const nodeId of learningOrder) {
      if (learnDayMap.get(nodeId) === d) {
        tasks.push({ type: 'learn', nodeId, duration: 30 });
      }
    }

    for (const interval of reviewIntervals) {
      const reviewDay = d - interval;
      if (reviewDay < 0) continue;
      for (const nodeId of learningOrder) {
        if (learnDayMap.get(nodeId) === reviewDay) {
          tasks.push({ type: 'review', nodeId, duration: 15 });
        }
      }
    }

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
