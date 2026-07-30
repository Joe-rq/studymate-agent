import fs from 'fs/promises';
import path from 'path';
import { loadExamProject, saveExamProject } from './bootstrap_exam.js';
import { transitionStatus, type ExamProject } from '../../domain/exam.js';
import { Paths } from '../../core/paths.js';
import { appendEvent, createEventId } from '../../core/event_log.js';
import type { Event } from '../../core/types.js';

export async function approvePlan(
  eventLogFile: string = Paths.eventLog,
  workspaceRoot?: string
): Promise<ExamProject> {
  const exam = await loadExamProject(workspaceRoot);
  if (!exam) throw new Error('No exam project found');
  if (exam.status === 'active') return exam;
  if (exam.status !== 'planned') {
    throw new Error(`Plan approval requires planned status, got: ${exam.status}`);
  }

  const planPath = workspaceRoot
    ? path.join(workspaceRoot, 'plan', 'plan_master.json')
    : path.join(Paths.plan, 'plan_master.json');
  let plan: { id?: string; version?: number };
  try {
    plan = JSON.parse(await fs.readFile(planPath, 'utf-8'));
  } catch {
    throw new Error('No generated plan found to approve');
  }

  const activeExam = transitionStatus(exam, 'active');
  await saveExamProject(activeExam, workspaceRoot);

  const event: Event = {
    id: createEventId(),
    timestamp: new Date().toISOString(),
    agent: 'approve_plan_workflow',
    action: 'plan_approved',
    input: { planId: plan.id, planVersion: plan.version },
    output: { examStatus: activeExam.status },
    examProjectId: activeExam.id,
  };
  await appendEvent(eventLogFile, event);
  return activeExam;
}
