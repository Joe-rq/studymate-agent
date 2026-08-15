/**
 * LearnerModel domain model.
 *
 * Represents a comprehensive, cross-session learner profile that tracks
 * performance history, study patterns, adaptive difficulty state, and
 * generated insights for personalized learning experiences.
 */

import type { LearnerBaseline } from './exam.js';

// ── Learning Style ─────────────────────────────────────────────────

export type PacePreference = 'slow' | 'moderate' | 'fast';

export interface LearningStyle {
  /** Preferred learning pace. */
  pacePreference: PacePreference;
  /** Tolerance for difficult questions (0-1, higher = more tolerant). */
  difficultyTolerance: number;
  /** Preferred study session length in minutes. */
  preferredSessionLength: number;
}

// ── Performance Metrics ────────────────────────────────────────────

export interface ScoreSnapshot {
  date: string;
  score: number;  // 0-100
  questionCount: number;
}

export interface MasterySnapshot {
  date: string;
  avgMastery: number;  // 0-1
  conceptsUpdated: number;
}

export interface PerformanceMetrics {
  /** Total quiz sessions completed. */
  totalSessions: number;
  /** Total questions answered. */
  totalQuestions: number;
  /** Overall accuracy across all sessions (0-1). */
  overallAccuracy: number;
  /** Recent score history (max 30 entries). */
  scoreHistory: ScoreSnapshot[];
  /** Recent mastery history (max 30 entries). */
  masteryHistory: MasterySnapshot[];
  /** Best consecutive study days streak. */
  bestStreak: number;
  /** Current consecutive study days streak. */
  currentStreak: number;
}

// ── Study Patterns ─────────────────────────────────────────────────

export interface StudyPatterns {
  /** Average daily study minutes (rolling 7-day average). */
  avgDailyMinutes: number;
  /** Task completion rate (0-1). */
  completionRate: number;
  /** Hour of day with best performance (0-23), null if unknown. */
  bestPerformanceHour: number | null;
  /** Knowledge categories where learner struggles. */
  weakCategories: string[];
  /** Knowledge categories where learner excels. */
  strongCategories: string[];
}

// ── Adaptive State ─────────────────────────────────────────────────

export type DifficultyTrend = 'increasing' | 'stable' | 'decreasing';

export interface AdaptiveState {
  /** Current target difficulty for quiz generation (0-1). */
  currentDifficulty: number;
  /** Recent difficulty adjustment trend. */
  difficultyTrend: DifficultyTrend;
  /** Recommended daily study minutes based on patterns. */
  recommendedDailyMinutes: number;
  /** When difficulty was last adjusted. */
  lastAdjustedAt: string;
}

// ── Insights ───────────────────────────────────────────────────────

export type InsightType = 'strength' | 'weakness' | 'pattern' | 'recommendation';

export interface LearnerInsight {
  id: string;
  date: string;
  type: InsightType;
  content: string;
  /** Confidence in this insight (0-1). */
  confidence: number;
}

// ── Main LearnerModel ──────────────────────────────────────────────

export interface LearnerModel {
  id: string;
  examProjectId: string;

  // Static profile
  baseline: LearnerBaseline;
  learningStyle: LearningStyle;

  // Dynamic performance metrics
  performance: PerformanceMetrics;

  // Study patterns
  patterns: StudyPatterns;

  // Adaptive state
  adaptive: AdaptiveState;

  // Generated insights (max 20, FIFO)
  insights: LearnerInsight[];

  createdAt: string;
  updatedAt: string;
}

// ── Factory ────────────────────────────────────────────────────────

/** Default learning style based on baseline level. */
function defaultLearningStyle(baseline: LearnerBaseline): LearningStyle {
  switch (baseline) {
    case 'beginner':
      return { pacePreference: 'slow', difficultyTolerance: 0.3, preferredSessionLength: 30 };
    case 'intermediate':
      return { pacePreference: 'moderate', difficultyTolerance: 0.5, preferredSessionLength: 45 };
    case 'advanced':
      return { pacePreference: 'fast', difficultyTolerance: 0.7, preferredSessionLength: 60 };
  }
}

/** Initial difficulty based on baseline. */
function initialDifficulty(baseline: LearnerBaseline): number {
  switch (baseline) {
    case 'beginner': return 0.3;
    case 'intermediate': return 0.5;
    case 'advanced': return 0.7;
  }
}

/**
 * Create a new LearnerModel for an exam project.
 */
export function createLearnerModel(
  examProjectId: string,
  baseline: LearnerBaseline,
  dailyMinutes: number = 60
): LearnerModel {
  const now = new Date().toISOString();
  return {
    id: `learner_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    examProjectId,
    baseline,
    learningStyle: defaultLearningStyle(baseline),
    performance: {
      totalSessions: 0,
      totalQuestions: 0,
      overallAccuracy: 0,
      scoreHistory: [],
      masteryHistory: [],
      bestStreak: 0,
      currentStreak: 0,
    },
    patterns: {
      avgDailyMinutes: dailyMinutes,
      completionRate: 0,
      bestPerformanceHour: null,
      weakCategories: [],
      strongCategories: [],
    },
    adaptive: {
      currentDifficulty: initialDifficulty(baseline),
      difficultyTrend: 'stable',
      recommendedDailyMinutes: dailyMinutes,
      lastAdjustedAt: now,
    },
    insights: [],
    createdAt: now,
    updatedAt: now,
  };
}
