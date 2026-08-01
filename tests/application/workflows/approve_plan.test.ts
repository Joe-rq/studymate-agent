import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { approvePlan } from '../../../src/application/workflows/approve_plan.js';
import { createExamProject, transitionStatus } from '../../../src/domain/exam.js';
import { saveExamProject } from '../../../src/application/workflows/bootstrap_exam.js';
import { loadEvents } from '../../../src/core/event_log.js';

const TEST_ROOT = path.join(process.cwd(), 'workspace_test_approve_plan');
const EVENT_LOG = path.join(TEST_ROOT, 'event_log', 'events.jsonl');

describe('approvePlan', () => {
  beforeEach(async () => {
    await fs.rm(TEST_ROOT, { recursive: true, force: true });
    await fs.mkdir(path.join(TEST_ROOT, 'plan'), { recursive: true });
    await fs.mkdir(path.dirname(EVENT_LOG), { recursive: true });
  });

  it('moves a planned exam to active and records formal approval once', async () => {
    let exam = createExamProject({
      name: '测试考试',
      examDate: '2027-07-30',
      subjects: ['科目'],
      baseline: 'beginner',
      dailyMinutes: 60,
    });
    exam = transitionStatus(exam, 'researched');
    exam = transitionStatus(exam, 'sources_approved');
    exam = transitionStatus(exam, 'materials_ready');
    exam = transitionStatus(exam, 'planned');
    await saveExamProject(exam, TEST_ROOT);
    await fs.writeFile(
      path.join(TEST_ROOT, 'plan', 'plan_master.json'),
      JSON.stringify({ id: 'plan_1', version: 1, schedule: [] }),
      'utf-8'
    );

    const approved = await approvePlan(EVENT_LOG, TEST_ROOT);
    const replayed = await approvePlan(EVENT_LOG, TEST_ROOT);

    expect(approved.status).toBe('active');
    expect(replayed.status).toBe('active');
    const events = await loadEvents(EVENT_LOG);
    expect(events.filter((event) => event.action === 'plan_approved')).toHaveLength(1);
  });
});
