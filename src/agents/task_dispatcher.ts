import fs from 'fs/promises';
import path from 'path';
import type { DailyPlan, DailyTask } from './planner.js';
import type { Event } from '../core/types.js';
import { createEventId, appendEvent } from '../core/event_log.js';
import { Paths } from '../core/paths.js';
import { atomicWriteFile, atomicWriteJSON } from '../core/atomic_file.js';
import { createInitialSRState } from './spaced_repetition.js';

export interface TodoTask {
  id: string;
  type: 'learn' | 'review' | 'quiz' | 'buffer' | 'sprint';
  nodeId: string;
  nodeName: string;
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

/** 渲染当日 todo Markdown（计划事实源的快照）。 */
export function renderTodoMarkdown(date: string, tasks: TodoTask[]): string {
  const tags = ['#studymate', '#daily-task'];
  const taskTags = tasks.map((t) => (t.type === 'learn' ? '#learn' : t.type === 'quiz' ? '#quiz' : '#review'));
  const allTags = [...new Set([...tags, ...taskTags])].join(' ');

  const typeLabels: Record<string, string> = { learn: '学习', review: '复习', quiz: '测验', sprint: '冲刺', buffer: '缓冲' };
  const lines = [
    '---',
    `date: ${date}`,
    `tags: ${allTags}`,
    '---',
    '',
    '<!-- 本文件由计划与任务进度生成，JSON 数据（plan_daily/*.json）为事实源。 -->',
    '',
    `# ${date} 学习任务`,
    '',
  ];
  for (const t of tasks) {
    const typeLabel = typeLabels[t.type] ?? t.type;
    const checked = t.status === 'done' || t.status === 'skipped';
    const name = t.nodeName ?? t.nodeId;
    lines.push(`- [${checked ? 'x' : ' '}] **${typeLabel}** ${name}（${t.duration} 分钟）`);
  }
  return lines.join('\n');
}

/** 合并完成进度（done/skipped）与概念名，供 Markdown 快照渲染（与 loadTasksForDate 一致）。 */
async function enrichTaskStatuses(
  date: string,
  tasks: TodoTask[],
  workspaceRoot?: string
): Promise<TodoTask[]> {
  const tasksDir = workspaceRoot ? path.join(workspaceRoot, 'tasks') : Paths.tasks;
  const graphDir = workspaceRoot ? path.join(workspaceRoot, 'graph') : Paths.graph;

  let completionByTask = new Map<string, 'done' | 'skipped'>();
  try {
    const progress = JSON.parse(
      await fs.readFile(path.join(tasksDir, `${date}_progress.json`), 'utf-8')
    ) as DayProgress;
    completionByTask = new Map(progress.completions.map((c) => [c.taskId, c.status]));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  let names = new Map<string, string>();
  try {
    const conceptMap = JSON.parse(
      await fs.readFile(path.join(graphDir, 'concepts.json'), 'utf-8')
    ) as { concepts?: Array<{ id: string; name: string }> };
    names = new Map((conceptMap.concepts ?? []).map((c) => [c.id, c.name]));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  return tasks.map((t) => ({
    ...t,
    nodeName: names.get(t.nodeId) ?? t.nodeId,
    status: completionByTask.get(t.id) ?? 'pending',
  }));
}

export async function dispatchToday(
  plan: DailyPlan,
  eventLogFile: string,
  options?: { rolloverTasks?: DailyTask[]; workspaceRoot?: string }
): Promise<TodoTask[]> {
  const allTasks = [...plan.tasks, ...(options?.rolloverTasks ?? [])];
  const tasks: TodoTask[] = allTasks.map((t, idx) => ({
    id: `task_${plan.date}_${idx}`,
    ...t,
    nodeName: t.nodeId,
    status: 'pending',
  }));

  // 合并完成状态与概念名：Markdown 快照与 Web/CLI 的 loadTasksForDate 一致
  const enriched = await enrichTaskStatuses(plan.date, tasks, options?.workspaceRoot);
  const markdown = renderTodoMarkdown(plan.date, enriched);

  const tasksDir = options?.workspaceRoot ? path.join(options.workspaceRoot, 'tasks') : Paths.tasks;
  await fs.mkdir(tasksDir, { recursive: true });
  const todoPath = path.join(tasksDir, `${plan.date}_todo.md`);

  // 内容比对写入：计划被调整后 Markdown 快照随之重建；未变化时不重复写、不刷事件。
  // 这保证 plan_daily/*.json（事实源）与 tasks/*.md（快照）始终一致。
  let existing: string | null = null;
  try {
    existing = await fs.readFile(todoPath, 'utf-8');
  } catch {
    // 尚未生成
  }
  if (existing !== markdown) {
    await atomicWriteFile(todoPath, markdown, 'utf-8');
    const event: Event = {
      id: createEventId(),
      timestamp: new Date().toISOString(),
      agent: 'task_dispatcher',
      action: 'tasks_dispatched',
      input: { date: plan.date },
      output: { taskCount: tasks.length, rolloverCount: options?.rolloverTasks?.length ?? 0 },
    };
    await appendEvent(eventLogFile, event);
  }

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
): Promise<boolean> {
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
    if (existing.status === status) {
      return false;
    }
    existing.status = status;
    existing.completedAt = new Date().toISOString();
  } else {
    progress.completions.push({ taskId, status, completedAt: new Date().toISOString() });
  }

  await atomicWriteJSON(progressPath, progress);

  // 首次真实完成 learn 任务 → 创建初始 SM-2 状态（下次复习 = 明天）。
  // srState 只在真实学习/复习后写入，静态计划生成不再触碰它。
  let srBootstrapped = false;
  if (status === 'done') {
    srBootstrapped = await bootstrapSRStateForLearnTask(date, taskId, workspaceRoot);
  }

  const event: Event = {
    id: createEventId(),
    timestamp: new Date().toISOString(),
    agent: 'task_dispatcher',
    action: 'task_completed',
    input: { date, taskId, status },
    output: srBootstrapped ? { srStateBootstrapped: true } : {},
  };
  await appendEvent(eventLogFile, event);
  return true;
}

/** 查找当天计划中的 learn 任务并为其概念创建初始 SR 状态（已存在则跳过）。 */
async function bootstrapSRStateForLearnTask(
  date: string,
  taskId: string,
  workspaceRoot?: string
): Promise<boolean> {
  const planRoot = workspaceRoot ? path.join(workspaceRoot, 'plan') : Paths.plan;
  const graphDir = workspaceRoot ? path.join(workspaceRoot, 'graph') : Paths.graph;
  try {
    const idxMatch = taskId.match(/^task_\d{4}-\d{2}-\d{2}_(\d+)$/);
    if (!idxMatch) return false;
    const plan: DailyPlan = JSON.parse(
      await fs.readFile(path.join(planRoot, 'plan_daily', `${date}.json`), 'utf-8')
    );
    const task = plan.tasks[Number(idxMatch[1])];
    if (!task || task.type !== 'learn') return false;

    const conceptMap = JSON.parse(
      await fs.readFile(path.join(graphDir, 'concepts.json'), 'utf-8')
    ) as { concepts?: Array<{ id: string; srState?: unknown }> };
    const concept = (conceptMap.concepts ?? []).find((c) => c.id === task.nodeId);
    if (!concept || concept.srState) return false;

    concept.srState = createInitialSRState(date);
    await atomicWriteJSON(path.join(graphDir, 'concepts.json'), conceptMap);
    return true;
  } catch {
    // 计划或概念图缺失时静默降级：srState 会在真实批改时懒初始化
    return false;
  }
}

/**
 * Build the task view consumed by the CLI/Web UI by combining the immutable
 * daily plan with persisted completion state and concept display names.
 */
export async function loadTasksForDate(
  date: string,
  workspaceRoot?: string
): Promise<{ date: string; tasks: TodoTask[] }> {
  const planDir = workspaceRoot
    ? path.join(workspaceRoot, 'plan', 'plan_daily')
    : path.join(Paths.plan, 'plan_daily');
  const tasksDir = workspaceRoot ? path.join(workspaceRoot, 'tasks') : Paths.tasks;
  const graphDir = workspaceRoot ? path.join(workspaceRoot, 'graph') : Paths.graph;

  let plan: DailyPlan;
  try {
    plan = JSON.parse(await fs.readFile(path.join(planDir, `${date}.json`), 'utf-8'));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { date, tasks: [] };
    throw err;
  }

  let progress: DayProgress = { date, completions: [] };
  try {
    progress = JSON.parse(
      await fs.readFile(path.join(tasksDir, `${date}_progress.json`), 'utf-8')
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  let names = new Map<string, string>();
  try {
    const conceptMap = JSON.parse(
      await fs.readFile(path.join(graphDir, 'concepts.json'), 'utf-8')
    ) as { concepts?: Array<{ id: string; name: string }> };
    names = new Map((conceptMap.concepts ?? []).map((concept) => [concept.id, concept.name]));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  const completionByTask = new Map(
    progress.completions.map((completion) => [completion.taskId, completion.status])
  );
  const tasks = plan.tasks.map((task, index): TodoTask => {
    const id = `task_${date}_${index}`;
    return {
      id,
      ...task,
      nodeName: names.get(task.nodeId) ?? task.nodeId,
      status: completionByTask.get(id) ?? 'pending',
    };
  });

  return { date, tasks };
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
  const planDir = workspaceRoot
    ? path.join(workspaceRoot, 'plan', 'plan_daily')
    : path.join(Paths.plan, 'plan_daily');
  const today = todayPlan.date;

  let taskFiles: string[] = [];
  try {
    taskFiles = await fs.readdir(tasksDir);
  } catch {
    // A fresh workspace may not have progress files yet.
  }

  let planFiles: string[];
  try {
    planFiles = (await fs.readdir(planDir)).filter((file) => file.endsWith('.json'));
  } catch {
    return [];
  }

  const progressFiles = taskFiles.filter((file) => file.endsWith('_progress.json'));

  const rollover: DailyTask[] = [];
  const currentTotal = todayPlan.tasks.reduce((s, t) => s + t.duration, 0);
  const cap = dailyMinutes * ROLLOVER_OVERFLOW;
  let available = cap - currentTotal;

  const alreadyMigrated = new Set<string>();
  for (const planFile of planFiles) {
    try {
      const plan: DailyPlan = JSON.parse(await fs.readFile(path.join(planDir, planFile), 'utf-8'));
      for (const task of plan.tasks) {
        if (task.rolloverFrom) alreadyMigrated.add(task.rolloverFrom);
      }
    } catch {
      // A corrupt plan is handled by its normal reader; skip it here.
    }
  }

  for (const planFile of planFiles.sort()) {
    const date = planFile.replace('.json', '');
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
      if (alreadyMigrated.has(taskId)) continue;
      const orig = dayPlan.tasks[i];
      // Rollover as review (shorter duration)
      const reviewDuration = Math.min(orig.duration, 15);
      if (available - reviewDuration < 0) break;
      rollover.push({
        type: 'review',
        nodeId: orig.nodeId,
        duration: reviewDuration,
        rolloverFrom: taskId,
      });
      available -= reviewDuration;
    }
  }

  return rollover;
}

/**
 * Persist missed tasks into today's plan. Repeated calls are idempotent because
 * every migrated task keeps the source task ID in rolloverFrom.
 */
export async function migrateIncompleteTasks(
  todayPlan: DailyPlan,
  dailyMinutes: number,
  eventLogFile: string,
  workspaceRoot?: string
): Promise<DailyPlan> {
  const rollover = await rolloverIncomplete(todayPlan, dailyMinutes, workspaceRoot);
  if (rollover.length === 0) return todayPlan;

  const migrated: DailyPlan = {
    ...todayPlan,
    tasks: [...todayPlan.tasks, ...rollover],
  };
  const planRoot = workspaceRoot ? path.join(workspaceRoot, 'plan') : Paths.plan;
  await atomicWriteJSON(
    path.join(planRoot, 'plan_daily', `${todayPlan.date}.json`),
    migrated
  );

  const masterPath = path.join(planRoot, 'plan_master.json');
  try {
    const master = JSON.parse(await fs.readFile(masterPath, 'utf-8')) as {
      schedule?: DailyPlan[];
    };
    if (Array.isArray(master.schedule)) {
      const index = master.schedule.findIndex((day) => day.date === todayPlan.date);
      if (index >= 0) {
        master.schedule[index] = migrated;
        await atomicWriteJSON(masterPath, master);
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  const event: Event = {
    id: createEventId(),
    timestamp: new Date().toISOString(),
    agent: 'task_dispatcher',
    action: 'tasks_rolled_over',
    input: {
      date: todayPlan.date,
      sourceTaskIds: rollover.map((task) => task.rolloverFrom),
    },
    output: { migratedCount: rollover.length },
  };
  await appendEvent(eventLogFile, event);
  return migrated;
}

export async function prepareTasksForDate(
  date: string,
  eventLogFile: string,
  workspaceRoot?: string
): Promise<{ date: string; tasks: TodoTask[] }> {
  const planRoot = workspaceRoot ? path.join(workspaceRoot, 'plan') : Paths.plan;
  let plan: DailyPlan;
  try {
    plan = JSON.parse(
      await fs.readFile(path.join(planRoot, 'plan_daily', `${date}.json`), 'utf-8')
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { date, tasks: [] };
    throw err;
  }

  let dailyMinutes = plan.tasks.reduce((sum, task) => sum + task.duration, 0);
  try {
    const master = JSON.parse(
      await fs.readFile(path.join(planRoot, 'plan_master.json'), 'utf-8')
    ) as { dailyMinutes?: number };
    if (typeof master.dailyMinutes === 'number') dailyMinutes = master.dailyMinutes;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  const migrated = await migrateIncompleteTasks(plan, dailyMinutes, eventLogFile, workspaceRoot);
  // dispatchToday 幂等（内容不变不重写），每次读取都校准 Markdown 快照与计划事实源一致
  await dispatchToday(migrated, eventLogFile, { workspaceRoot });
  return loadTasksForDate(date, workspaceRoot);
}
