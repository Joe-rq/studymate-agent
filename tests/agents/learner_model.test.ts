import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  createLearnerModel,
  type LearnerModel,
} from '../../src/domain/learner.js';
import {
  loadLearnerModel,
  saveLearnerModel,
  initLearnerModel,
  updateFromQuizResult,
  updateFromTaskCompletion,
  computeAdaptiveDifficulty,
  generateInsights,
  formatLearnerProfile,
  formatInsights,
} from '../../src/agents/learner_model.js';
import type { QuizResult } from '../../src/agents/grader.js';

describe('learner_model', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'learner_test_'));
    await fs.mkdir(path.join(tmpDir, 'progress'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('createLearnerModel', () => {
    it('should create model with beginner defaults', () => {
      const model = createLearnerModel('exam_1', 'beginner', 30);
      expect(model.baseline).toBe('beginner');
      expect(model.learningStyle.pacePreference).toBe('slow');
      expect(model.learningStyle.difficultyTolerance).toBe(0.3);
      expect(model.adaptive.currentDifficulty).toBe(0.3);
      expect(model.performance.totalSessions).toBe(0);
    });

    it('should create model with intermediate defaults', () => {
      const model = createLearnerModel('exam_1', 'intermediate', 60);
      expect(model.baseline).toBe('intermediate');
      expect(model.learningStyle.pacePreference).toBe('moderate');
      expect(model.adaptive.currentDifficulty).toBe(0.5);
    });

    it('should create model with advanced defaults', () => {
      const model = createLearnerModel('exam_1', 'advanced', 90);
      expect(model.baseline).toBe('advanced');
      expect(model.learningStyle.pacePreference).toBe('fast');
      expect(model.adaptive.currentDifficulty).toBe(0.7);
    });
  });

  describe('persistence', () => {
    it('should save and load learner model', async () => {
      const model = createLearnerModel('exam_1', 'intermediate', 60);
      await saveLearnerModel(model, tmpDir);

      const loaded = await loadLearnerModel(tmpDir);
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe(model.id);
      expect(loaded!.baseline).toBe('intermediate');
    });

    it('should return null when no model exists', async () => {
      const loaded = await loadLearnerModel(tmpDir);
      expect(loaded).toBeNull();
    });

    it('should initialize model via initLearnerModel', async () => {
      const model = await initLearnerModel('exam_1', 'beginner', 45, tmpDir);
      expect(model.baseline).toBe('beginner');

      const loaded = await loadLearnerModel(tmpDir);
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe(model.id);
    });
  });

  describe('updateFromQuizResult', () => {
    function createMockQuizResult(score: number, correct: number, total: number): QuizResult {
      return {
        quizId: 'quiz_1',
        date: '2026-07-23',
        totalScore: score,
        details: Array.from({ length: total }, (_, i) => ({
          question: {
            id: `q_${i}`,
            type: 'single_choice' as const,
            nodeId: `node_${i % 3}`,
            stem: 'test',
            options: ['a', 'b', 'c', 'd'],
            answer: 0,
            explanation: 'test',
          },
          userAnswer: i < correct ? 0 : 1,
          isCorrect: i < correct,
          score: i < correct ? 100 / total : 0,
        })),
      };
    }

    it('should update performance metrics', () => {
      const model = createLearnerModel('exam_1', 'intermediate', 60);
      const result = createMockQuizResult(80, 8, 10);

      const updated = updateFromQuizResult(model, result);

      expect(updated.performance.totalSessions).toBe(1);
      expect(updated.performance.totalQuestions).toBe(10);
      expect(updated.performance.overallAccuracy).toBeCloseTo(0.8, 1);
      expect(updated.performance.scoreHistory).toHaveLength(1);
      expect(updated.performance.scoreHistory[0].score).toBe(80);
    });

    it('should accumulate accuracy over multiple sessions', () => {
      let model = createLearnerModel('exam_1', 'intermediate', 60);

      // First session: 80%
      model = updateFromQuizResult(model, createMockQuizResult(80, 8, 10));
      expect(model.performance.overallAccuracy).toBeCloseTo(0.8, 1);

      // Second session: 60%
      model = updateFromQuizResult(model, createMockQuizResult(60, 6, 10));
      // Overall: (8 + 6) / 20 = 0.7
      expect(model.performance.overallAccuracy).toBeCloseTo(0.7, 1);
      expect(model.performance.totalSessions).toBe(2);
    });

    it('should update streak correctly', () => {
      let model = createLearnerModel('exam_1', 'intermediate', 60);
      const result = createMockQuizResult(80, 8, 10);

      model = updateFromQuizResult(model, result);
      expect(model.performance.currentStreak).toBe(1);
      expect(model.performance.bestStreak).toBe(1);
    });
  });

  describe('computeAdaptiveDifficulty', () => {
    it('should increase difficulty when accuracy is high', () => {
      const { difficulty, trend } = computeAdaptiveDifficulty(0.5, 0.9);
      expect(difficulty).toBe(0.55);
      expect(trend).toBe('increasing');
    });

    it('should decrease difficulty when accuracy is low', () => {
      const { difficulty, trend } = computeAdaptiveDifficulty(0.5, 0.4);
      expect(difficulty).toBe(0.4);
      expect(trend).toBe('decreasing');
    });

    it('should keep difficulty stable for moderate accuracy', () => {
      const { difficulty, trend } = computeAdaptiveDifficulty(0.5, 0.7);
      expect(difficulty).toBe(0.5);
      expect(trend).toBe('stable');
    });

    it('should not exceed max difficulty', () => {
      const { difficulty } = computeAdaptiveDifficulty(0.88, 0.95);
      expect(difficulty).toBe(0.9);
    });

    it('should not go below min difficulty', () => {
      const { difficulty } = computeAdaptiveDifficulty(0.25, 0.3);
      expect(difficulty).toBe(0.2);
    });
  });

  describe('updateFromTaskCompletion', () => {
    it('should update completion rate', () => {
      const model = createLearnerModel('exam_1', 'intermediate', 60);
      const updated = updateFromTaskCompletion(model, 8, 10, '2026-07-23');
      expect(updated.patterns.completionRate).toBeCloseTo(0.8, 1);
    });

    it('should use rolling average for completion rate', () => {
      let model = createLearnerModel('exam_1', 'intermediate', 60);
      model = updateFromTaskCompletion(model, 10, 10, '2026-07-23');
      expect(model.patterns.completionRate).toBeCloseTo(1.0, 1);

      model = updateFromTaskCompletion(model, 5, 10, '2026-07-24');
      // Rolling: 1.0 * 0.7 + 0.5 * 0.3 = 0.85
      expect(model.patterns.completionRate).toBeCloseTo(0.85, 1);
    });
  });

  describe('generateInsights', () => {
    it('should generate streak insight for long streaks', () => {
      const model = createLearnerModel('exam_1', 'intermediate', 60);
      model.performance.currentStreak = 7;

      const insights = generateInsights(model);
      const streakInsight = insights.find((i) => i.type === 'pattern');
      expect(streakInsight).toBeDefined();
      expect(streakInsight!.content).toContain('7');
    });

    it('should generate high accuracy insight', () => {
      const model = createLearnerModel('exam_1', 'intermediate', 60);
      model.performance.overallAccuracy = 0.85;
      model.performance.totalQuestions = 50;

      const insights = generateInsights(model);
      const strengthInsight = insights.find((i) => i.type === 'strength');
      expect(strengthInsight).toBeDefined();
    });

    it('should generate low accuracy warning', () => {
      const model = createLearnerModel('exam_1', 'intermediate', 60);
      model.performance.overallAccuracy = 0.4;
      model.performance.totalQuestions = 20;

      const insights = generateInsights(model);
      const weakInsight = insights.find((i) => i.type === 'weakness');
      expect(weakInsight).toBeDefined();
    });

    it('should return empty array for new model', () => {
      const model = createLearnerModel('exam_1', 'intermediate', 60);
      const insights = generateInsights(model);
      expect(insights).toHaveLength(0);
    });
  });

  describe('formatLearnerProfile', () => {
    it('should format profile for display', () => {
      const model = createLearnerModel('exam_1', 'intermediate', 60);
      model.performance.totalQuestions = 100;
      model.performance.overallAccuracy = 0.75;

      const output = formatLearnerProfile(model);
      expect(output).toContain('学习者画像');
      expect(output).toContain('intermediate');
      expect(output).toContain('100');
      expect(output).toContain('75.0%');
    });
  });

  describe('formatInsights', () => {
    it('should format insights for display', () => {
      const model = createLearnerModel('exam_1', 'intermediate', 60);
      model.insights = [
        {
          id: 'insight_1',
          date: '2026-07-23',
          type: 'strength',
          content: '测试洞察',
          confidence: 0.8,
        },
      ];

      const output = formatInsights(model);
      expect(output).toContain('学习洞察');
      expect(output).toContain('测试洞察');
    });

    it('should show message when no insights', () => {
      const model = createLearnerModel('exam_1', 'intermediate', 60);
      const output = formatInsights(model);
      expect(output).toContain('暂无洞察');
    });
  });
});
