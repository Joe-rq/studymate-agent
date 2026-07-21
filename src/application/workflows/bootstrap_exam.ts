/**
 * Bootstrap Exam Workflow.
 *
 * Creates a new ExamProject, persists it to workspace/exam.json,
 * and logs the creation event.
 */

import fs from 'fs/promises';
import path from 'path';
import {
  createExamProject,
  type ExamProject,
  type LearnerBaseline,
} from '../../domain/exam.js';
import type { Event } from '../../core/types.js';
import { createEventId, appendEvent } from '../../core/event_log.js';
import { Paths } from '../../core/paths.js';

export interface BootstrapExamConfig {
  name: string;
  examDate: string;
  subjects: string[];
  baseline: LearnerBaseline;
  dailyMinutes: number;
  unavailableDates?: string[];
  target?: string;
}

/**
 * Create a new exam project and persist it to the workspace.
 *
 * @param config Exam configuration
 * @param eventLogFile Event log path
 * @param workspaceRoot Optional workspace root for test isolation
 * @returns The created ExamProject
 */
export async function bootstrapExam(
  config: BootstrapExamConfig,
  eventLogFile: string = Paths.eventLog,
  workspaceRoot?: string
): Promise<ExamProject> {
  // Validate exam date is in the future
  const examDate = new Date(config.examDate);
  if (isNaN(examDate.getTime())) {
    throw new Error(`Invalid exam date: ${config.examDate}`);
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (examDate <= today) {
    throw new Error(`Exam date must be in the future: ${config.examDate}`);
  }

  // Validate daily minutes
  if (config.dailyMinutes <= 0 || config.dailyMinutes > 480) {
    throw new Error(`dailyMinutes must be between 1 and 480, got: ${config.dailyMinutes}`);
  }

  const project = createExamProject(config);

  // Persist to workspace
  const configPath = workspaceRoot
    ? path.join(workspaceRoot, 'exam.json')
    : Paths.examConfig;
  const dir = path.dirname(configPath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(project, null, 2), 'utf-8');

  // Log event
  const event: Event = {
    id: createEventId(),
    timestamp: new Date().toISOString(),
    agent: 'bootstrap_exam',
    action: 'exam_project_created',
    input: {
      name: config.name,
      examDate: config.examDate,
      subjects: config.subjects,
    },
    output: { projectId: project.id, status: project.status },
    examProjectId: project.id,
  };
  await appendEvent(eventLogFile, event);

  return project;
}

/**
 * Load the current exam project from the workspace.
 *
 * @param workspaceRoot Optional workspace root for test isolation
 * @returns The ExamProject, or null if none exists
 */
export async function loadExamProject(
  workspaceRoot?: string
): Promise<ExamProject | null> {
  const configPath = workspaceRoot
    ? path.join(workspaceRoot, 'exam.json')
    : Paths.examConfig;
  try {
    return JSON.parse(await fs.readFile(configPath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Persist an updated exam project to the workspace.
 *
 * @param project The updated ExamProject
 * @param workspaceRoot Optional workspace root for test isolation
 */
export async function saveExamProject(
  project: ExamProject,
  workspaceRoot?: string
): Promise<void> {
  const configPath = workspaceRoot
    ? path.join(workspaceRoot, 'exam.json')
    : Paths.examConfig;
  const dir = path.dirname(configPath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(project, null, 2), 'utf-8');
}
