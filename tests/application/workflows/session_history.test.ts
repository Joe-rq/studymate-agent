import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import {
  appendSessionHistory,
  loadSessionHistory,
  buildTrend,
  buildTotals,
  type SessionHistoryRecord,
} from '../../../src/application/workflows/session_history.js';

const TEST_DIR = path.join(process.cwd(), 'workspace_test_session_history');

function record(date: string, over: Partial<SessionHistoryRecord> = {}): SessionHistoryRecord {
  return {
    sessionId: 'ss_1',
    date,
    startedAt: '2026-08-11T00:00:00.000Z',
    endedAt: '2026-08-11T00:10:00.000Z',
    taskType: 'learn',
    nodeId: 'node_1',
    nodeName: '需求曲线',
    durationSeconds: 600,
    knowledgePoints: 1,
    answeredQuestions: 5,
    correct: 4,
    accuracy: 0.8,
    score: 80,
    masteryDeltaSum: 0.4,
    masteryChanges: [{ nodeId: 'node_1', nodeName: '需求曲线', oldMastery: 0, newMastery: 0.4 }],
    ...over,
  };
}

describe('session_history', () => {
  beforeEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it('append + load 往返', async () => {
    await appendSessionHistory(record('2026-08-11'), TEST_DIR);
    await appendSessionHistory(
      record('2026-08-12', { sessionId: 'ss_2', nodeId: 'node_2', nodeName: '供给曲线' }),
      TEST_DIR
    );
    const history = await loadSessionHistory(TEST_DIR);
    expect(history).toHaveLength(2);
    expect(history[0].date).toBe('2026-08-11');
    expect(history[1].nodeName).toBe('供给曲线');
  });

  it('文件不存在时返回空数组', async () => {
    const history = await loadSessionHistory(TEST_DIR);
    expect(history).toEqual([]);
  });

  it('buildTrend 按日期聚合且升序', async () => {
    const history = [
      record('2026-08-12', { durationSeconds: 300, accuracy: 0.6, score: 60 }),
      record('2026-08-11', { durationSeconds: 600, accuracy: 0.8, score: 80 }),
      record('2026-08-11', { sessionId: 'ss_x', durationSeconds: 300, accuracy: 1, score: 100 }),
    ];
    const trend = buildTrend(history);
    expect(trend).toHaveLength(2);
    expect(trend[0].date).toBe('2026-08-11');
    expect(trend[0].sessions).toBe(2);
    expect(trend[0].avgAccuracy).toBeCloseTo(0.9);
    expect(trend[0].avgScore).toBe(90);
    expect(trend[0].totalMinutes).toBe(15);
    expect(trend[1].date).toBe('2026-08-12');
  });

  it('buildTotals 空数组安全', async () => {
    expect(buildTotals([])).toEqual({ sessionCount: 0, totalMinutes: 0, avgAccuracy: 0, avgScore: 0 });
  });

  it('buildTotals 汇总', async () => {
    const history = [
      record('2026-08-11', { durationSeconds: 600, accuracy: 0.8, score: 80 }),
      record('2026-08-12', { durationSeconds: 300, accuracy: 0.6, score: 60 }),
    ];
    const totals = buildTotals(history);
    expect(totals.sessionCount).toBe(2);
    expect(totals.totalMinutes).toBe(15);
    expect(totals.avgAccuracy).toBeCloseTo(0.7);
    expect(totals.avgScore).toBe(70);
  });
});
