import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { dispatchToday, completeTask, rolloverIncomplete } from '../../src/agents/task_dispatcher.js';
import type { DailyPlan } from '../../src/agents/planner.js';

const TEST_ROOT = 'workspace_test_dispatcher';
const EVENT_LOG = path.join(TEST_ROOT, 'event_log', 'events.jsonl');

async function setup() {
  await fs.rm(TEST_ROOT, { recursive: true, force: true });
  await fs.mkdir(path.join(TEST_ROOT, 'event_log'), { recursive: true });
  await fs.mkdir(path.join(TEST_ROOT, 'tasks'), { recursive: true });
  await fs.mkdir(path.join(TEST_ROOT, 'plan', 'plan_daily'), { recursive: true });
}

describe('task_dispatcher', () => {
  beforeEach(async () => {
    await setup();
  });

  describe('dispatchToday', () => {
    it('should create todo markdown and return tasks', async () => {
      const plan: DailyPlan = {
        date: '2026-07-22',
        tasks: [
          { type: 'learn', nodeId: 'node_1', duration: 30 },
          { type: 'review', nodeId: 'node_2', duration: 15 },
        ],
      };

      const tasks = await dispatchToday(plan, EVENT_LOG, { workspaceRoot: TEST_ROOT });
      expect(tasks).toHaveLength(2);
      expect(tasks[0].id).toBe('task_2026-07-22_0');
      expect(tasks[0].status).toBe('pending');
      expect(tasks[1].type).toBe('review');

      // Check markdown file was written
      const md = await fs.readFile(path.join(TEST_ROOT, 'tasks', '2026-07-22_todo.md'), 'utf-8');
      expect(md).toContain('学习');
      expect(md).toContain('复习');
      expect(md).toContain('node_1');
    });

    it('should include rollover tasks', async () => {
      const plan: DailyPlan = {
        date: '2026-07-22',
        tasks: [{ type: 'learn', nodeId: 'node_1', duration: 30 }],
      };
      const rollover = [{ type: 'review' as const, nodeId: 'node_old', duration: 15 }];

      const tasks = await dispatchToday(plan, EVENT_LOG, { workspaceRoot: TEST_ROOT, rolloverTasks: rollover });
      expect(tasks).toHaveLength(2);
      expect(tasks[1].nodeId).toBe('node_old');
    });

    it('should handle quiz task type label', async () => {
      const plan: DailyPlan = {
        date: '2026-07-22',
        tasks: [{ type: 'quiz', nodeId: 'node_1', duration: 15 }],
      };

      await dispatchToday(plan, EVENT_LOG, { workspaceRoot: TEST_ROOT });
      const md = await fs.readFile(path.join(TEST_ROOT, 'tasks', '2026-07-22_todo.md'), 'utf-8');
      expect(md).toContain('测验');
    });
  });

  describe('completeTask', () => {
    it('should write progress file', async () => {
      await completeTask('2026-07-22', 'task_2026-07-22_0', 'done', EVENT_LOG, TEST_ROOT);

      const progress = JSON.parse(
        await fs.readFile(path.join(TEST_ROOT, 'tasks', '2026-07-22_progress.json'), 'utf-8')
      );
      expect(progress.date).toBe('2026-07-22');
      expect(progress.completions).toHaveLength(1);
      expect(progress.completions[0].taskId).toBe('task_2026-07-22_0');
      expect(progress.completions[0].status).toBe('done');
    });

    it('should update existing entry instead of duplicating', async () => {
      await completeTask('2026-07-22', 'task_2026-07-22_0', 'done', EVENT_LOG, TEST_ROOT);
      await completeTask('2026-07-22', 'task_2026-07-22_0', 'skipped', EVENT_LOG, TEST_ROOT);

      const progress = JSON.parse(
        await fs.readFile(path.join(TEST_ROOT, 'tasks', '2026-07-22_progress.json'), 'utf-8')
      );
      expect(progress.completions).toHaveLength(1);
      expect(progress.completions[0].status).toBe('skipped');
    });
  });

  describe('rolloverIncomplete', () => {
    it('should return incomplete tasks from past days as review', async () => {
      // Set up a past day with tasks
      const pastPlan: DailyPlan = {
        date: '2026-07-20',
        tasks: [
          { type: 'learn', nodeId: 'node_1', duration: 30 },
          { type: 'review', nodeId: 'node_2', duration: 20 },
        ],
      };
      await fs.writeFile(
        path.join(TEST_ROOT, 'plan', 'plan_daily', '2026-07-20.json'),
        JSON.stringify(pastPlan)
      );

      // Create todo file for past day
      await fs.writeFile(path.join(TEST_ROOT, 'tasks', '2026-07-20_todo.md'), '# tasks');

      // Mark only first task as done
      await completeTask('2026-07-20', 'task_2026-07-20_0', 'done', EVENT_LOG, TEST_ROOT);

      // Today's plan
      const todayPlan: DailyPlan = {
        date: '2026-07-22',
        tasks: [{ type: 'learn', nodeId: 'node_3', duration: 30 }],
      };

      const rollover = await rolloverIncomplete(todayPlan, 60, TEST_ROOT);
      // node_2 was not completed → should rollover
      expect(rollover.length).toBe(1);
      expect(rollover[0].nodeId).toBe('node_2');
      expect(rollover[0].type).toBe('review');
      expect(rollover[0].duration).toBeLessThanOrEqual(15);
    });

    it('should return empty when all tasks completed', async () => {
      const pastPlan: DailyPlan = {
        date: '2026-07-20',
        tasks: [{ type: 'learn', nodeId: 'node_1', duration: 30 }],
      };
      await fs.writeFile(
        path.join(TEST_ROOT, 'plan', 'plan_daily', '2026-07-20.json'),
        JSON.stringify(pastPlan)
      );
      await fs.writeFile(path.join(TEST_ROOT, 'tasks', '2026-07-20_todo.md'), '# tasks');
      await completeTask('2026-07-20', 'task_2026-07-20_0', 'done', EVENT_LOG, TEST_ROOT);

      const todayPlan: DailyPlan = { date: '2026-07-22', tasks: [] };
      const rollover = await rolloverIncomplete(todayPlan, 60, TEST_ROOT);
      expect(rollover).toHaveLength(0);
    });

    it('should respect overflow cap', async () => {
      // Past day with many tasks
      const pastPlan: DailyPlan = {
        date: '2026-07-20',
        tasks: [
          { type: 'learn', nodeId: 'node_1', duration: 30 },
          { type: 'learn', nodeId: 'node_2', duration: 30 },
          { type: 'learn', nodeId: 'node_3', duration: 30 },
        ],
      };
      await fs.writeFile(
        path.join(TEST_ROOT, 'plan', 'plan_daily', '2026-07-20.json'),
        JSON.stringify(pastPlan)
      );
      await fs.writeFile(path.join(TEST_ROOT, 'tasks', '2026-07-20_todo.md'), '# tasks');
      // None completed

      // Today already has 55 min of tasks, dailyMinutes=60, cap=72
      const todayPlan: DailyPlan = {
        date: '2026-07-22',
        tasks: [{ type: 'learn', nodeId: 'node_x', duration: 55 }],
      };

      const rollover = await rolloverIncomplete(todayPlan, 60, TEST_ROOT);
      // Available = 72 - 55 = 17, each rollover is 15 min → only 1 fits
      expect(rollover.length).toBe(1);
    });

    it('should return empty when no tasks dir exists', async () => {
      await fs.rm(path.join(TEST_ROOT, 'tasks'), { recursive: true, force: true });
      const todayPlan: DailyPlan = { date: '2026-07-22', tasks: [] };
      const rollover = await rolloverIncomplete(todayPlan, 60, TEST_ROOT);
      expect(rollover).toHaveLength(0);
    });
  });
});
