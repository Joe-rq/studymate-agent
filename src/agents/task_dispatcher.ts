import fs from 'fs/promises';
import path from 'path';
import type { DailyPlan, DailyTask } from './planner.js';
import type { Event } from '../core/types.js';
import { createEventId, appendEvent } from '../core/event_log.js';
import { Paths } from '../core/paths.js';

export interface TodoTask {
  id: string;
  type: 'learn' | 'review' | 'quiz' | 'buffer' | 'sprint';
  nodeId: string;
  duration: number;
  status: 'pending' | 'done' | 'skipped';
}

export interface TaskCompletion {
  taskId: string;
  status: 'done' | 'skipped';
  completedAt: string;
}

interface DayProgress {
  date: string;
  completions: TaskCompletion[];
}

/** Overflow cap for rollover: today's total <= dailyMinutes * 1.2 */
const ROLLOVER_OVERFLOW = 1.2;

export async function dispatchToday(
  plan: DailyPlan,
  eventLogFile: string,
  options?: { rolloverTasks?: DailyTask[]; workspaceRoot?: string }
): Promise<TodoTask[]> {
  const allTasks = [...plan.tasks, ...(options?.rolloverTasks ?? [])];
  const tasks: TodoTask[] = allTasks.map((t, idx) => ({
    id: `task_${plan.date}_${idx}`,
    ...t,
    status: 'pending',
  }));

  const tags = ['#studymate', '#daily-task'];
  const taskTags = tasks.map((t) => (t.type === 'learn' ? '#learn' : t.type === 'quiz' ? '#quiz' : '#review'));
  const allTags = [...new Set([...tags, ...taskTags])].join(' ');

  const typeLabels: Record<string, string> = { learn: '学习', review: '复习', quiz: '测验', sprint: '冲刺', buffer: '缓冲' };
  const markdown =
    `---\ndate: ${plan.date}\ntags: ${allTags}\n---\n\n` +
    `# ${plan.date} 学习任务\n\n` +
    tasks
      .map((t) => {
        const typeLabel = typeLabels[t.type] ?? t.type;
        return `- [ ] **${typeLabel}** ${t.nodeId}（${t.duration} 分钟）`;
      })
      .join('\n');

  const tasksDir = options?.workspaceRoot ? path.join(options.workspaceRoot, 'tasks') : Paths.tasks;
  await fs.mkdir(tasksDir, { recursive: true });
  await fs.writeFile(path.join(tasksDir, `${plan.date}_todo.md`), markdown, 'utf-8');

  const event: Event = {
    id: createEventId(),
    timestamp: new Date().toISOString(),
    agent: 'task_dispatcher',
    action: 'tasks_dispatched',
    input: { date: plan.date },
    output: { taskCount: tasks.length, rolloverCount: options?.rolloverTasks?.length ?? 0 },
  };
  await appendEvent(eventLogFile, event);

  return tasks;
}

/**
 * Mark a task as done or skipped. Writes to workspace/tasks/{date}_progress.json.
 */
export async function completeTask(
  date: string,
  taskId: string,
  status: 'done' | 'skipped',
  eventLogFile: string,
  workspaceRoot?: string
): Promise<void> {
  const tasksDir = workspaceRoot ? path.join(workspaceRoot, 'tasks') : Paths.tasks;
  await fs.mkdir(tasksDir, { recursive: true });
  const progressPath = path.join(tasksDir, `${date}_progress.json`);

  let progress: DayProgress = { date, completions: [] };
  try {
    progress = JSON.parse(await fs.readFile(progressPath, 'utf-8'));
  } catch {
    // First completion for this day
  }

  // Avoid duplicate entries
  const existing = progress.completions.find((c) => c.taskId === taskId);
  if (existing) {
    existing.status = status;
    existing.completedAt = new Date().toISOString();
  } else {
    progress.completions.push({ taskId, status, completedAt: new Date().toISOString() });
  }

  await fs.writeFile(progressPath, JSON.stringify(progress, null, 2), 'utf-8');

  const event: Event = {
    id: createEventId(),
    timestamp: new Date().toISOString(),
    agent: 'task_dispatcher',
    action: 'task_completed',
    input: { date, taskId, status },
    output: {},
  };
  await appendEvent(eventLogFile, event);
}

/**
 * Find incomplete tasks from past days and return them as review tasks
 * to be inserted into today's plan.
 */
export async function rolloverIncomplete(
  todayPlan: DailyPlan,
  dailyMinutes: number,
  workspaceRoot?: string
): Promise<DailyTask[]> {
  const tasksDir = workspaceRoot ? path.join(workspaceRoot, 'tasks') : Paths.tasks;
  const today = todayPlan.date;

  // Read all progress files for dates before today
  let files: string[];
  try {
    files = await fs.readdir(tasksDir);
  } catch {
    return [];
  }

  const progressFiles = files.filter((f) => f.endsWith('_progress.json'));
  const todoFiles = files.filter((f) => f.endsWith('_todo.md'));

  const rollover: DailyTask[] = [];
  const currentTotal = todayPlan.tasks.reduce((s, t) => s + t.duration, 0);
  const cap = dailyMinutes * ROLLOVER_OVERFLOW;
  let available = cap - currentTotal;

  // Check all past days that have a todo file (with or without progress)
  for (const tf of todoFiles) {
    const date = tf.replace('_todo.md', '');
    if (date >= today) continue; // Only past days

    // Load progress if exists
    let completedIds = new Set<string>();
    const progressFile = `${date}_progress.json`;
    if (progressFiles.includes(progressFile)) {
      try {
        const progress: DayProgress = JSON.parse(await fs.readFile(path.join(tasksDir, progressFile), 'utf-8'));
        completedIds = new Set(progress.completions.map((c) => c.taskId));
      } catch {
        // Ignore parse errors
      }
    }

    // Read the plan_daily for that date to get original tasks
    const planDir = workspaceRoot ? path.join(workspaceRoot, 'plan', 'plan_daily') : path.join(Paths.plan, 'plan_daily');
    let dayPlan: DailyPlan;
    try {
      dayPlan = JSON.parse(await fs.readFile(path.join(planDir, `${date}.json`), 'utf-8'));
    } catch {
      continue;
    }

    // Find tasks not marked done/skipped
    for (let i = 0; i < dayPlan.tasks.length; i++) {
      const taskId = `task_${date}_${i}`;
      if (completedIds.has(taskId)) continue;
      const orig = dayPlan.tasks[i];
      // Rollover as review (shorter duration)
      const reviewDuration = Math.min(orig.duration, 15);
      if (available - reviewDuration < 0) break;
      rollover.push({ type: 'review', nodeId: orig.nodeId, duration: reviewDuration });
      available -= reviewDuration;
    }
  }

  return rollover;
}
