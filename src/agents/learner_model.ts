/**
 * LearnerModel Agent
 *
 * Manages the learner profile: updates performance metrics from quiz results,
 * computes adaptive difficulty, analyzes study patterns, and generates insights.
 */

import fs from 'fs/promises';
import path from 'path';
import { Paths } from '../core/paths.js';
import type { QuizResult } from './grader.js';
import type { MasteryChange } from './mastery_tracker.js';
import {
  type LearnerModel,
  type LearnerInsight,
  type ScoreSnapshot,
  type MasterySnapshot,
  type DifficultyTrend,
  createLearnerModel,
} from '../domain/learner.js';
import type { LearnerBaseline } from '../domain/exam.js';
import { addDaysToDateKey } from '../core/date.js';
import { atomicWriteJSON } from '../core/atomic_file.js';

// ── Constants ──────────────────────────────────────────────────────

const MAX_HISTORY = 30;
const MAX_INSIGHTS = 20;

/** Difficulty adjustment thresholds. */
const HIGH_ACCURACY_THRESHOLD = 0.85;
const LOW_ACCURACY_THRESHOLD = 0.5;
const DIFFICULTY_INCREMENT = 0.05;
const DIFFICULTY_DECREMENT = 0.1;
const MAX_DIFFICULTY = 0.9;
const MIN_DIFFICULTY = 0.2;

// ── Persistence ────────────────────────────────────────────────────

function learnerFilePath(workspaceRoot?: string): string {
  const base = workspaceRoot ?? Paths.workspace;
  return path.join(base, 'progress', 'learner_model.json');
}

/**
 * Load learner model from disk. Returns null if not found.
 */
export async function loadLearnerModel(workspaceRoot?: string): Promise<LearnerModel | null> {
  try {
    const raw = JSON.parse(await fs.readFile(learnerFilePath(workspaceRoot), 'utf-8'));
    return raw as LearnerModel;
  } catch {
    return null;
  }
}

/**
 * Save learner model to disk.
 */
export async function saveLearnerModel(model: LearnerModel, workspaceRoot?: string): Promise<void> {
  const filePath = learnerFilePath(workspaceRoot);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await atomicWriteJSON(filePath, model);
}

/**
 * Initialize a new learner model for an exam project.
 */
export async function initLearnerModel(
  examProjectId: string,
  baseline: LearnerBaseline,
  dailyMinutes: number,
  workspaceRoot?: string
): Promise<LearnerModel> {
  const model = createLearnerModel(examProjectId, baseline, dailyMinutes);
  await saveLearnerModel(model, workspaceRoot);
  return model;
}

// ── Performance Updates ────────────────────────────────────────────

/**
 * Update learner model from a quiz result.
 * Updates: totalSessions, totalQuestions, overallAccuracy, scoreHistory, streak.
 */
export function updateFromQuizResult(
  model: LearnerModel,
  result: QuizResult,
  masteryChanges?: MasteryChange[]
): LearnerModel {
  const now = new Date().toISOString();
  const today = now.split('T')[0];

  // Calculate session accuracy
  const totalQuestions = result.details.length;
  const correctCount = result.details.filter((d) => d.isCorrect).length;
  const sessionAccuracy = totalQuestions > 0 ? correctCount / totalQuestions : 0;

  // Update performance metrics
  const newTotalSessions = model.performance.totalSessions + 1;
  const newTotalQuestions = model.performance.totalQuestions + totalQuestions;

  // Recalculate overall accuracy (weighted average)
  const oldTotalCorrect = model.performance.overallAccuracy * model.performance.totalQuestions;
  const newOverallAccuracy = (oldTotalCorrect + correctCount) / newTotalQuestions;

  // Add score snapshot
  const scoreSnapshot: ScoreSnapshot = {
    date: today,
    score: result.totalScore,
    questionCount: totalQuestions,
  };
  const scoreHistory = [...model.performance.scoreHistory, scoreSnapshot].slice(-MAX_HISTORY);

  // Add mastery snapshot if mastery changes provided
  let masteryHistory = model.performance.masteryHistory;
  if (masteryChanges && masteryChanges.length > 0) {
    const avgMastery = masteryChanges.reduce((sum, c) => sum + c.newMastery, 0) / masteryChanges.length;
    const masterySnapshot: MasterySnapshot = {
      date: today,
      avgMastery,
      conceptsUpdated: masteryChanges.length,
    };
    masteryHistory = [...masteryHistory, masterySnapshot].slice(-MAX_HISTORY);
  }

  // Update streak
  const lastDate = model.performance.scoreHistory.length > 0
    ? model.performance.scoreHistory[model.performance.scoreHistory.length - 1].date
    : '';
  let currentStreak = model.performance.currentStreak;
  let bestStreak = model.performance.bestStreak;

  if (lastDate !== today) {
    const yesterdayStr = addDaysToDateKey(today, -1);

    if (lastDate === yesterdayStr) {
      currentStreak += 1;
    } else if (lastDate !== today) {
      currentStreak = 1;
    }
    bestStreak = Math.max(bestStreak, currentStreak);
  }

  // Compute adaptive difficulty
  const recentAccuracy = computeRecentAccuracy(scoreHistory);
  const { difficulty, trend } = computeAdaptiveDifficulty(
    model.adaptive.currentDifficulty,
    recentAccuracy
  );

  // Generate insights
  const newInsights = generateInsights({
    ...model,
    performance: {
      ...model.performance,
      totalSessions: newTotalSessions,
      overallAccuracy: newOverallAccuracy,
      scoreHistory,
    },
  });
  const insights = [...model.insights, ...newInsights].slice(-MAX_INSIGHTS);

  return {
    ...model,
    performance: {
      totalSessions: newTotalSessions,
      totalQuestions: newTotalQuestions,
      overallAccuracy: newOverallAccuracy,
      scoreHistory,
      masteryHistory,
      bestStreak,
      currentStreak,
    },
    adaptive: {
      ...model.adaptive,
      currentDifficulty: difficulty,
      difficultyTrend: trend,
      lastAdjustedAt: now,
    },
    insights,
    updatedAt: now,
  };
}

/**
 * Update learner model from task completion.
 */
export function updateFromTaskCompletion(
  model: LearnerModel,
  completed: number,
  total: number,
  date: string
): LearnerModel {
  const completionRate = total > 0 ? completed / total : 0;

  // Rolling average for completion rate
  const oldRate = model.patterns.completionRate;
  const newRate = oldRate === 0 ? completionRate : oldRate * 0.7 + completionRate * 0.3;

  return {
    ...model,
    patterns: {
      ...model.patterns,
      completionRate: newRate,
    },
    updatedAt: new Date().toISOString(),
  };
}

// ── Adaptive Difficulty ────────────────────────────────────────────

/**
 * Compute recent accuracy from score history (last 5 sessions).
 */
function computeRecentAccuracy(scoreHistory: ScoreSnapshot[]): number {
  if (scoreHistory.length === 0) return 0.5;
  const recent = scoreHistory.slice(-5);
  const avgScore = recent.reduce((sum, s) => sum + s.score, 0) / recent.length;
  return avgScore / 100;
}

/**
 * Compute adaptive difficulty based on recent accuracy.
 *
 * Algorithm:
 * - If recentAccuracy > 0.85 and difficulty < 0.9: increase by 0.05
 * - If recentAccuracy < 0.5 and difficulty > 0.2: decrease by 0.1
 * - Otherwise: stable
 */
export function computeAdaptiveDifficulty(
  currentDifficulty: number,
  recentAccuracy: number
): { difficulty: number; trend: DifficultyTrend } {
  if (recentAccuracy > HIGH_ACCURACY_THRESHOLD && currentDifficulty < MAX_DIFFICULTY) {
    return {
      difficulty: Math.min(MAX_DIFFICULTY, currentDifficulty + DIFFICULTY_INCREMENT),
      trend: 'increasing',
    };
  }
  if (recentAccuracy < LOW_ACCURACY_THRESHOLD && currentDifficulty > MIN_DIFFICULTY) {
    return {
      difficulty: Math.max(MIN_DIFFICULTY, currentDifficulty - DIFFICULTY_DECREMENT),
      trend: 'decreasing',
    };
  }
  return { difficulty: currentDifficulty, trend: 'stable' };
}

// ── Insight Generation ─────────────────────────────────────────────

/**
 * Generate insights based on learner performance patterns.
 */
export function generateInsights(model: LearnerModel): LearnerInsight[] {
  const insights: LearnerInsight[] = [];
  const now = new Date().toISOString();
  const today = now.split('T')[0];

  // Insight: High performance streak
  if (model.performance.currentStreak >= 5) {
    insights.push({
      id: `insight_streak_${Date.now()}`,
      date: today,
      type: 'pattern',
      content: `连续学习 ${model.performance.currentStreak} 天，保持良好习惯！`,
      confidence: 0.9,
    });
  }

  // Insight: High accuracy
  if (model.performance.overallAccuracy >= 0.8 && model.performance.totalQuestions >= 20) {
    insights.push({
      id: `insight_high_acc_${Date.now()}`,
      date: today,
      type: 'strength',
      content: `整体正确率达到 ${(model.performance.overallAccuracy * 100).toFixed(0)}%，可以考虑提升难度挑战自己。`,
      confidence: 0.85,
    });
  }

  // Insight: Low accuracy warning
  if (model.performance.overallAccuracy < 0.5 && model.performance.totalQuestions >= 10) {
    insights.push({
      id: `insight_low_acc_${Date.now()}`,
      date: today,
      type: 'weakness',
      content: `正确率偏低 (${(model.performance.overallAccuracy * 100).toFixed(0)}%)，建议回顾基础概念。`,
      confidence: 0.8,
    });
  }

  // Insight: Difficulty adjustment
  if (model.adaptive.difficultyTrend === 'increasing') {
    insights.push({
      id: `insight_diff_up_${Date.now()}`,
      date: today,
      type: 'recommendation',
      content: '表现优秀，已自动提升题目难度。',
      confidence: 0.75,
    });
  } else if (model.adaptive.difficultyTrend === 'decreasing') {
    insights.push({
      id: `insight_diff_down_${Date.now()}`,
      date: today,
      type: 'recommendation',
      content: '已降低题目难度，帮助巩固基础。',
      confidence: 0.75,
    });
  }

  // Insight: Score improvement trend
  const history = model.performance.scoreHistory;
  if (history.length >= 3) {
    const recent3 = history.slice(-3);
    const improving = recent3[2].score > recent3[1].score && recent3[1].score > recent3[0].score;
    if (improving) {
      insights.push({
        id: `insight_improving_${Date.now()}`,
        date: today,
        type: 'pattern',
        content: '成绩持续提升，学习方法有效！',
        confidence: 0.7,
      });
    }
  }

  return insights;
}

// ── Summary Formatting ─────────────────────────────────────────────

/**
 * Format learner profile for CLI display.
 */
export function formatLearnerProfile(model: LearnerModel): string {
  const lines: string[] = [];
  lines.push('═══ 学习者画像 ═══');
  lines.push('');
  lines.push(`基线水平: ${model.baseline}`);
  lines.push(`学习节奏: ${model.learningStyle.pacePreference}`);
  lines.push('');
  lines.push('── 性能统计 ──');
  lines.push(`累计答题: ${model.performance.totalQuestions} 道`);
  lines.push(`测验次数: ${model.performance.totalSessions} 次`);
  lines.push(`整体正确率: ${(model.performance.overallAccuracy * 100).toFixed(1)}%`);
  lines.push(`连续学习: ${model.performance.currentStreak} 天 (最佳: ${model.performance.bestStreak} 天)`);
  lines.push('');
  lines.push('── 自适应状态 ──');
  lines.push(`当前难度: ${model.adaptive.currentDifficulty.toFixed(2)}`);
  lines.push(`难度趋势: ${model.adaptive.difficultyTrend === 'increasing' ? '上升' : model.adaptive.difficultyTrend === 'decreasing' ? '下降' : '稳定'}`);
  lines.push(`建议每日时长: ${model.adaptive.recommendedDailyMinutes} 分钟`);
  lines.push('');
  lines.push('── 学习模式 ──');
  lines.push(`任务完成率: ${(model.patterns.completionRate * 100).toFixed(0)}%`);
  if (model.patterns.weakCategories.length > 0) {
    lines.push(`薄弱类别: ${model.patterns.weakCategories.join(', ')}`);
  }
  if (model.patterns.strongCategories.length > 0) {
    lines.push(`强势类别: ${model.patterns.strongCategories.join(', ')}`);
  }

  return lines.join('\n');
}

/**
 * Format insights for CLI display.
 */
export function formatInsights(model: LearnerModel): string {
  if (model.insights.length === 0) {
    return '暂无洞察。完成更多测验后将生成个性化建议。';
  }

  const lines: string[] = [];
  lines.push('═══ 学习洞察 ═══');
  lines.push('');

  const typeLabels: Record<string, string> = {
    strength: '💪 优势',
    weakness: '⚠️ 薄弱',
    pattern: '📊 模式',
    recommendation: '💡 建议',
  };

  for (const insight of model.insights.slice(-10)) {
    const label = typeLabels[insight.type] ?? insight.type;
    lines.push(`${label}: ${insight.content}`);
    lines.push(`  (${insight.date}, 置信度 ${(insight.confidence * 100).toFixed(0)}%)`);
    lines.push('');
  }

  return lines.join('\n');
}
