import fs from 'fs/promises';
import path from 'path';
import type { DailyPlan } from './planner.js';
import type { Event } from '../core/types.js';
import { createEventId, appendEvent } from '../core/event_log.js';
import { Paths } from '../core/paths.js';

export interface TodoTask {
  id: string;
  type: 'learn' | 'review';
  nodeId: string;
  duration: number;
  status: 'pending' | 'done' | 'skipped';
}

export async function dispatchToday(plan: DailyPlan, eventLogFile: string): Promise<TodoTask[]> {
  const tasks: TodoTask[] = plan.tasks.map((t, idx) => ({
    id: `task_${plan.date}_${idx}`,
    ...t,
    status: 'pending',
  }));

  const markdown =
    `# ${plan.date} 学习任务\n\n` +
    tasks
      .map((t) => `- [ ] **${t.type === 'learn' ? '学习' : '复习'}** ${t.nodeId}（${t.duration} 分钟）`)
      .join('\n');

  await fs.mkdir(Paths.tasks, { recursive: true });
  await fs.writeFile(path.join(Paths.tasks, `${plan.date}_todo.md`), markdown, 'utf-8');

  const event: Event = {
    id: createEventId(),
    timestamp: new Date().toISOString(),
    agent: 'task_dispatcher',
    action: 'tasks_dispatched',
    input: { date: plan.date },
    output: { taskCount: tasks.length },
  };
  await appendEvent(eventLogFile, event);

  return tasks;
}
