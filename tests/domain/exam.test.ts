import { describe, it, expect } from 'vitest';
import {
  createExamProject,
  canTransition,
  transitionStatus,
  type ExamProject,
} from '../../src/domain/exam.js';

describe('ExamProject', () => {
  it('should create a project with correct defaults', () => {
    const project = createExamProject({
      name: '2026初级会计',
      examDate: '2026-09-15',
      subjects: ['经济法基础', '初级会计实务'],
      baseline: 'beginner',
      dailyMinutes: 60,
    });

    expect(project.id).toMatch(/^exam_/);
    expect(project.name).toBe('2026初级会计');
    expect(project.status).toBe('draft');
    expect(project.schemaVersion).toBe(1);
    expect(project.subjects).toHaveLength(2);
    expect(project.learnerProfile.baseline).toBe('beginner');
    expect(project.learnerProfile.dailyMinutes).toBe(60);
    expect(project.learnerProfile.unavailableDates).toEqual([]);
  });

  it('should allow valid status transitions', () => {
    expect(canTransition('draft', 'researched')).toBe(true);
    expect(canTransition('researched', 'sources_approved')).toBe(true);
    expect(canTransition('sources_approved', 'materials_ready')).toBe(true);
    expect(canTransition('materials_ready', 'planned')).toBe(true);
    expect(canTransition('planned', 'active')).toBe(true);
    expect(canTransition('active', 'completed')).toBe(true);
  });

  it('should reject invalid status transitions', () => {
    expect(canTransition('draft', 'active')).toBe(false);
    expect(canTransition('completed', 'draft')).toBe(false);
    expect(canTransition('active', 'draft')).toBe(false);
  });

  it('should transition status and update timestamp', async () => {
    const project = createExamProject({
      name: 'Test',
      examDate: '2026-09-15',
      subjects: ['A'],
      baseline: 'intermediate',
      dailyMinutes: 30,
    });

    // Small delay to ensure updatedAt timestamp differs from createdAt
    await new Promise((r) => setTimeout(r, 10));
    const updated = transitionStatus(project, 'researched');
    expect(updated.status).toBe('researched');
    expect(updated.updatedAt).not.toBe(project.updatedAt);
  });

  it('should throw on invalid transition', () => {
    const project = createExamProject({
      name: 'Test',
      examDate: '2026-09-15',
      subjects: ['A'],
      baseline: 'beginner',
      dailyMinutes: 30,
    });

    expect(() => transitionStatus(project, 'active')).toThrow(/Invalid/);
  });
});
