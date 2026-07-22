import fs from 'fs/promises';
import path from 'path';
import type { ConceptMap, Concept } from './concept_mapper.js';
import type { QuizResult } from './grader.js';
import type { Event } from '../core/types.js';
import { createEventId, appendEvent } from '../core/event_log.js';
import { Paths } from '../core/paths.js';

/**
 * 默认 EMA 平滑系数 α。
 *
 * mastery 更新公式：newMastery = oldMastery × (1 − α) + sessionScore × α
 *
 * α 越大，本次表现权重越高、收敛越快，但历史信息丢失越多。
 * α = 0.4 表示本次答题贡献 40%，历史掌握度保留 60%，
 * 收敛平稳且对最新表现足够敏感。
 */
export const DEFAULT_MASTERY_ALPHA = 0.4;

/** 单个概念在一次批改后的掌握度变化。 */
export interface MasteryChange {
  nodeId: string;
  nodeName: string;
  oldMastery: number;
  newMastery: number;
  /** 本次该概念的答题正确率（0~1）。 */
  sessionScore: number;
  /** 本次该概念的题目总数。 */
  questionCount: number;
}

/** Mastery history snapshot appended to mastery_history.jsonl. */
export interface MasterySnapshot {
  nodeId: string;
  date: string;
  mastery: number;
  sessionScore: number;
  consecutiveCorrect: number;
}

/** updateMastery 的返回值，包含更新后的概念图与逐条变化记录。 */
export interface MasteryUpdate {
  conceptMap: ConceptMap;
  changes: MasteryChange[];
  snapshots: MasterySnapshot[];
}

/**
 * 按概念归集本次测验的答题情况，计算每个被考概念的 sessionScore。
 */
function collectPerConceptStats(
  result: QuizResult
): Map<string, { correct: number; total: number }> {
  const stats = new Map<string, { correct: number; total: number }>();
  for (const detail of result.details) {
    const nodeId = detail.question.nodeId;
    const entry = stats.get(nodeId) ?? { correct: 0, total: 0 };
    entry.total += 1;
    if (detail.isCorrect) entry.correct += 1;
    stats.set(nodeId, entry);
  }
  return stats;
}

/**
 * 根据批改结果，用指数移动平均（EMA）更新概念图中每个概念的掌握度。
 * 同时追踪连续正确次数和证据计数。
 */
export function updateMastery(
  conceptMap: ConceptMap,
  result: QuizResult,
  alpha: number = DEFAULT_MASTERY_ALPHA
): MasteryUpdate {
  const stats = collectPerConceptStats(result);
  const changes: MasteryChange[] = [];
  const snapshots: MasterySnapshot[] = [];

  for (const concept of conceptMap.concepts) {
    const entry = stats.get(concept.id);
    if (!entry || entry.total === 0) continue;

    const sessionScore = entry.correct / entry.total;
    const oldMastery = concept.mastery;
    const newMastery = oldMastery * (1 - alpha) + sessionScore * alpha;

    concept.mastery = Math.min(1, Math.max(0, newMastery));

    // Consecutive correct tracking
    if (sessionScore >= 0.8) {
      concept.consecutiveCorrect = (concept.consecutiveCorrect ?? 0) + 1;
    } else if (sessionScore < 0.5) {
      concept.consecutiveCorrect = 0;
    }
    // else: between 0.5 and 0.8, keep unchanged

    // Evidence count
    concept.evidenceCount = (concept.evidenceCount ?? 0) + entry.total;

    changes.push({
      nodeId: concept.id,
      nodeName: concept.name,
      oldMastery,
      newMastery: concept.mastery,
      sessionScore,
      questionCount: entry.total,
    });

    snapshots.push({
      nodeId: concept.id,
      date: result.date,
      mastery: concept.mastery,
      sessionScore,
      consecutiveCorrect: concept.consecutiveCorrect ?? 0,
    });
  }

  return { conceptMap, changes, snapshots };
}

/**
 * 将更新后的掌握度写回 graph/concepts.json，追加快照到 mastery_history.jsonl，
 * 并追加事件日志。
 */
export async function saveMastery(
  update: MasteryUpdate,
  eventLogFile: string,
  workspaceRoot?: string
): Promise<void> {
  const graphDir = workspaceRoot ? path.join(workspaceRoot, 'graph') : Paths.graph;
  await fs.mkdir(graphDir, { recursive: true });
  await fs.writeFile(
    path.join(graphDir, 'concepts.json'),
    JSON.stringify(update.conceptMap, null, 2),
    'utf-8'
  );

  // Append mastery history snapshots
  if (update.snapshots.length > 0) {
    const progressDir = workspaceRoot ? path.join(workspaceRoot, 'progress') : Paths.progress;
    await fs.mkdir(progressDir, { recursive: true });
    const historyPath = path.join(progressDir, 'mastery_history.jsonl');
    const lines = update.snapshots.map((s) => JSON.stringify(s)).join('\n') + '\n';
    await fs.appendFile(historyPath, lines, 'utf-8');
  }

  const event: Event = {
    id: createEventId(),
    timestamp: new Date().toISOString(),
    agent: 'mastery_tracker',
    action: 'mastery_updated',
    input: { changeCount: update.changes.length },
    output: {
      changes: update.changes.map((c) => ({
        nodeId: c.nodeId,
        oldMastery: c.oldMastery,
        newMastery: c.newMastery,
      })),
    },
  };
  await appendEvent(eventLogFile, event);
}
