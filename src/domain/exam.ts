/**
 * ExamProject domain model.
 *
 * Represents a single exam preparation project. Each project has a lifecycle
 * status that progresses from 'draft' through research, planning, and active study.
 */

export type ExamProjectStatus =
  | 'draft'
  | 'researched'
  | 'sources_approved'
  | 'materials_ready'
  | 'planned'
  | 'active'
  | 'completed';

export type LearnerBaseline = 'beginner' | 'intermediate' | 'advanced';

export interface LearnerProfile {
  baseline: LearnerBaseline;
  dailyMinutes: number;
  unavailableDates: string[];
}

export interface ExamProject {
  id: string;
  name: string;
  examDate: string;
  subjects: string[];
  target?: string;
  learnerProfile: LearnerProfile;
  status: ExamProjectStatus;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
}

/** Valid status transitions. */
const VALID_TRANSITIONS: Record<ExamProjectStatus, ExamProjectStatus[]> = {
  draft: ['researched'],
  researched: ['sources_approved'],
  sources_approved: ['materials_ready'],
  materials_ready: ['planned'],
  planned: ['active'],
  active: ['completed'],
  completed: [],
};

export function canTransition(from: ExamProjectStatus, to: ExamProjectStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function transitionStatus(
  project: ExamProject,
  newStatus: ExamProjectStatus
): ExamProject {
  if (!canTransition(project.status, newStatus)) {
    throw new Error(
      `Invalid status transition: ${project.status} -> ${newStatus}`
    );
  }
  return {
    ...project,
    status: newStatus,
    updatedAt: new Date().toISOString(),
  };
}

export function createExamProject(config: {
  name: string;
  examDate: string;
  subjects: string[];
  baseline: LearnerBaseline;
  dailyMinutes: number;
  unavailableDates?: string[];
  target?: string;
}): ExamProject {
  const now = new Date().toISOString();
  return {
    id: `exam_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: config.name,
    examDate: config.examDate,
    subjects: config.subjects,
    target: config.target,
    learnerProfile: {
      baseline: config.baseline,
      dailyMinutes: config.dailyMinutes,
      unavailableDates: config.unavailableDates ?? [],
    },
    status: 'draft',
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
  };
}
