/**
 * Session 历史
 *
 * 每次完成的 Study Session 追加一条 jsonl 记录（workspace/progress/session_history.jsonl），
 * 为 Growth 页提供历史列表与趋势数据。完整保留 reflect 汇总字段——
 * 事件日志的 study_session_completed 缺 score/correct/masteryChanges 明细，故用独立文件补齐。
 */

import fs from 'fs/promises';
import path from 'path';
import { Paths } from '../../core/paths.js';

export interface MasteryChangeRecord {
  nodeId: string;
  nodeName?: string;
  oldMastery: number;
  newMastery: number;
}

export interface SessionHistoryRecord {
  sessionId: string;
  date: string;
  startedAt: string;
  endedAt: string;
  taskType: 'learn' | 'review' | 'quiz';
  nodeId: string;
  nodeName: string;
  durationSeconds: number;
  knowledgePoints: number;
  answeredQuestions: number;
  correct: number;
  accuracy: number;
  score: number;
  masteryDeltaSum: number;
  masteryChanges: MasteryChangeRecord[];
}

export interface TrendPoint {
  date: string;
  sessions: number;
  avgAccuracy: number;
  avgScore: number;
  totalMinutes: number;
}

export interface SessionTotals {
  sessionCount: number;
  totalMinutes: number;
  avgAccuracy: number;
  avgScore: number;
}

function historyFilePath(workspaceRoot?: string): string {
  return workspaceRoot
    ? path.join(workspaceRoot, 'progress', 'session_history.jsonl')
    : path.join(Paths.progress, 'session_history.jsonl');
}

export async function appendSessionHistory(
  record: SessionHistoryRecord,
  workspaceRoot?: string
): Promise<void> {
  const file = historyFilePath(workspaceRoot);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, JSON.stringify(record) + '\n', 'utf-8');
}

export async function loadSessionHistory(
  workspaceRoot?: string
): Promise<SessionHistoryRecord[]> {
  try {
    const content = await fs.readFile(historyFilePath(workspaceRoot), 'utf-8');
    return content
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as SessionHistoryRecord);
  } catch {
    return [];
  }
}

/** 按日期聚合趋势（日期升序）。 */
export function buildTrend(history: SessionHistoryRecord[]): TrendPoint[] {
  const byDate = new Map<string, SessionHistoryRecord[]>();
  for (const r of history) {
    const list = byDate.get(r.date) ?? [];
    list.push(r);
    byDate.set(r.date, list);
  }
  return [...byDate.entries()]
    .map(([date, list]) => ({
      date,
      sessions: list.length,
      avgAccuracy: list.reduce((s, r) => s + r.accuracy, 0) / list.length,
      avgScore: list.reduce((s, r) => s + r.score, 0) / list.length,
      totalMinutes: Math.round(list.reduce((s, r) => s + r.durationSeconds, 0) / 60),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function buildTotals(history: SessionHistoryRecord[]): SessionTotals {
  if (history.length === 0) {
    return { sessionCount: 0, totalMinutes: 0, avgAccuracy: 0, avgScore: 0 };
  }
  return {
    sessionCount: history.length,
    totalMinutes: Math.round(history.reduce((s, r) => s + r.durationSeconds, 0) / 60),
    avgAccuracy: history.reduce((s, r) => s + r.accuracy, 0) / history.length,
    avgScore: history.reduce((s, r) => s + r.score, 0) / history.length,
  };
}
