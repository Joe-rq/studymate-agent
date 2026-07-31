import fs from 'fs/promises';
import path from 'path';
import { Paths } from '../core/paths.js';
import type { MasterySnapshot } from './mastery_tracker.js';

export interface StrategyMetrics {
  /** Tasks done / tasks dispatched (last 7 days). */
  planCompletionRate: number;
  /** Accuracy on concepts after review vs first attempt. */
  postReviewAccuracy: number;
  /** Avg mastery of concepts tested 2+ times. */
  knowledgeRetention: number;
  /** Questions skipped / total (future: user feedback). */
  questionDiscardRate: number;
}

/**
 * Compute strategy metrics from workspace data.
 * Reads from progress files, mastery history, and task dispatches.
 */
export async function computeMetrics(workspaceRoot?: string): Promise<StrategyMetrics> {
  const baseDir = workspaceRoot ?? '.';
  const tasksDir = path.join(baseDir, workspaceRoot ? 'tasks' : Paths.tasks);
  const progressDir = path.join(baseDir, workspaceRoot ? 'progress' : Paths.progress);

  // 1. Plan completion rate (last 7 days)
  let totalDispatched = 0;
  let totalDone = 0;
  try {
    const files = await fs.readdir(tasksDir);
    const progressFiles = files.filter((f) => f.endsWith('_progress.json'));
    const todoFiles = files.filter((f) => f.endsWith('_todo.md'));

    // Count dispatched from todo files (each task line = 1 dispatched)
    for (const tf of todoFiles.slice(-7)) {
      try {
        const content = await fs.readFile(path.join(tasksDir, tf), 'utf-8');
        const taskLines = content.split('\n').filter((l) => l.startsWith('- ['));
        totalDispatched += taskLines.length;
      } catch { /* skip */ }
    }

    // Count done from progress files
    for (const pf of progressFiles.slice(-7)) {
      try {
        const progress = JSON.parse(await fs.readFile(path.join(tasksDir, pf), 'utf-8'));
        const done = (progress.completions ?? []).filter(
          (c: { status: string }) => c.status === 'done'
        ).length;
        totalDone += done;
      } catch { /* skip */ }
    }
  } catch { /* tasks dir doesn't exist */ }

  const planCompletionRate = totalDispatched > 0 ? totalDone / totalDispatched : 0;

  // 2. Post-review accuracy & knowledge retention from mastery history
  let postReviewAccuracy = 0;
  let knowledgeRetention = 0;
  try {
    const historyPath = path.join(progressDir, 'mastery_history.jsonl');
    const content = await fs.readFile(historyPath, 'utf-8');
    const snapshots: MasterySnapshot[] = content
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));

    // Group by nodeId
    const byNode = new Map<string, MasterySnapshot[]>();
    for (const s of snapshots) {
      const arr = byNode.get(s.nodeId) ?? [];
      arr.push(s);
      byNode.set(s.nodeId, arr);
    }

    // Post-review accuracy: avg sessionScore for nodes with 2+ attempts
    let reviewScores: number[] = [];
    let retentionMasteries: number[] = [];
    for (const [, snaps] of byNode) {
      if (snaps.length >= 2) {
        // Use the latest sessionScore as post-review accuracy
        reviewScores.push(snaps[snaps.length - 1].sessionScore);
        retentionMasteries.push(snaps[snaps.length - 1].mastery);
      }
    }

    if (reviewScores.length > 0) {
      postReviewAccuracy = reviewScores.reduce((s, v) => s + v, 0) / reviewScores.length;
    }
    if (retentionMasteries.length > 0) {
      knowledgeRetention = retentionMasteries.reduce((s, v) => s + v, 0) / retentionMasteries.length;
    }
  } catch { /* no mastery history yet */ }

  // 3. Question discard rate (placeholder - requires user feedback mechanism)
  const questionDiscardRate = 0;

  return {
    planCompletionRate: Math.round(planCompletionRate * 100) / 100,
    postReviewAccuracy: Math.round(postReviewAccuracy * 100) / 100,
    knowledgeRetention: Math.round(knowledgeRetention * 100) / 100,
    questionDiscardRate,
  };
}
