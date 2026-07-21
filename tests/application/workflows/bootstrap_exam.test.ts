import { describe, it, expect, beforeEach } from 'vitest';
import {
  bootstrapExam,
  loadExamProject,
  saveExamProject,
} from '../../../src/application/workflows/bootstrap_exam.js';
import { createExamProject } from '../../../src/domain/exam.js';
import fs from 'fs/promises';
import path from 'path';

const TEST_DIR = path.join(process.cwd(), 'workspace_test_bootstrap');
const TEST_LOG = path.join(TEST_DIR, 'event_log', 'events.jsonl');

describe('bootstrap_exam workflow', () => {
  beforeEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(TEST_DIR, { recursive: true });
  });

  it('should create and persist an exam project', async () => {
    // Use a future date
    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 1);
    const dateStr = futureDate.toISOString().split('T')[0];

    const project = await bootstrapExam(
      {
        name: '2026初级会计',
        examDate: dateStr,
        subjects: ['经济法基础', '初级会计实务'],
        baseline: 'beginner',
        dailyMinutes: 60,
      },
      TEST_LOG,
      TEST_DIR
    );

    expect(project.id).toMatch(/^exam_/);
    expect(project.name).toBe('2026初级会计');
    expect(project.status).toBe('draft');

    // Verify file was written
    const persisted = JSON.parse(
      await fs.readFile(path.join(TEST_DIR, 'exam.json'), 'utf-8')
    );
    expect(persisted.id).toBe(project.id);
    expect(persisted.name).toBe('2026初级会计');
  });

  it('should reject past exam dates', async () => {
    await expect(
      bootstrapExam(
        {
          name: 'Old Exam',
          examDate: '2020-01-01',
          subjects: ['A'],
          baseline: 'beginner',
          dailyMinutes: 30,
        },
        TEST_LOG,
        TEST_DIR
      )
    ).rejects.toThrow(/future/);
  });

  it('should reject invalid daily minutes', async () => {
    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 1);
    const dateStr = futureDate.toISOString().split('T')[0];

    await expect(
      bootstrapExam(
        {
          name: 'Test',
          examDate: dateStr,
          subjects: ['A'],
          baseline: 'beginner',
          dailyMinutes: 0,
        },
        TEST_LOG,
        TEST_DIR
      )
    ).rejects.toThrow(/dailyMinutes/);

    await expect(
      bootstrapExam(
        {
          name: 'Test',
          examDate: dateStr,
          subjects: ['A'],
          baseline: 'beginner',
          dailyMinutes: 500,
        },
        TEST_LOG,
        TEST_DIR
      )
    ).rejects.toThrow(/dailyMinutes/);
  });

  it('should load a persisted exam project', async () => {
    const project = createExamProject({
      name: 'LoadTest',
      examDate: '2026-12-01',
      subjects: ['X'],
      baseline: 'advanced',
      dailyMinutes: 45,
    });
    await fs.mkdir(TEST_DIR, { recursive: true });
    await fs.writeFile(
      path.join(TEST_DIR, 'exam.json'),
      JSON.stringify(project, null, 2),
      'utf-8'
    );

    const loaded = await loadExamProject(TEST_DIR);
    expect(loaded).not.toBeNull();
    expect(loaded!.name).toBe('LoadTest');
  });

  it('should return null when no exam project exists', async () => {
    const loaded = await loadExamProject(TEST_DIR);
    expect(loaded).toBeNull();
  });

  it('should save an updated exam project', async () => {
    const project = createExamProject({
      name: 'SaveTest',
      examDate: '2026-12-01',
      subjects: ['Y'],
      baseline: 'intermediate',
      dailyMinutes: 90,
    });

    await saveExamProject(project, TEST_DIR);
    const persisted = JSON.parse(
      await fs.readFile(path.join(TEST_DIR, 'exam.json'), 'utf-8')
    );
    expect(persisted.name).toBe('SaveTest');
    expect(persisted.id).toBe(project.id);
  });
});
