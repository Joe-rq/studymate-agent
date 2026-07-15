import fs from 'fs/promises';
import path from 'path';
import { Paths } from './paths.js';
import type { ConceptMap } from '../agents/concept_mapper.js';
import type { StudyPlan } from '../agents/planner.js';

/**
 * 备考搭子做"情境感知"所需的聚合状态。
 * 全部字段都允许空值——搭子可能在任何阶段（还没 ingest/plan/grade）被调用，
 * 缺失的数据不应阻塞对话，只是搭子"知道得少一点"。
 */
export interface StudyContext {
  /** 距考试天数；无计划或已过期则为 null。 */
  daysToExam: number | null;
  /** 全概念平均掌握度 0..1；无概念图则为 0。 */
  avgMastery: number;
  /** 薄弱知识点名（来自 weakness_profile.json）。 */
  weakNodeNames: string[];
  /** 最近一次测验总分 0..100；无记录则为 null。 */
  recentScore: number | null;
  /** 最近掌握度变化方向。 */
  masteryTrend: 'up' | 'down' | 'flat' | 'unknown';
  /** 今日任务数；无计划则为 0。 */
  tasksToday: number;
}

const EMPTY_CONTEXT: StudyContext = {
  daysToExam: null,
  avgMastery: 0,
  weakNodeNames: [],
  recentScore: null,
  masteryTrend: 'unknown',
  tasksToday: 0,
};

async function readJSON<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function daysBetween(from: Date, to: Date): number {
  return Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * 从 workspace 各数据文件聚合成搭子可读的 StudyContext。
 *
 * 读取顺序与容错：每一项独立 try/catch，任意文件缺失都不影响其它字段。
 * 这保证了搭子在 init 后（空 workspace）也能正常工作。
 *
 * @param workspaceRoot 默认 Paths.workspace，测试时可重定向到临时目录。
 */
export async function gatherStudyContext(
  workspaceRoot: string = Paths.workspace
): Promise<StudyContext> {
  const ctx: StudyContext = { ...EMPTY_CONTEXT };
  const graphDir = path.join(workspaceRoot, 'graph');
  const planDir = path.join(workspaceRoot, 'plan');
  const mistakesDir = path.join(workspaceRoot, 'mistakes');
  const resultsDir = path.join(workspaceRoot, 'results');

  // 1. 概念图 → 平均掌握度 + 趋势
  const conceptMap = await readJSON<ConceptMap>(path.join(graphDir, 'concepts.json'));
  if (conceptMap?.concepts?.length) {
    const masteries = conceptMap.concepts.map((c) => c.mastery ?? 0);
    ctx.avgMastery = masteries.reduce((a, b) => a + b, 0) / masteries.length;
    // 趋势：掌握度整体水平粗略映射——这里无法拿到历史，用平均水平近似档位
    // 真正的 up/down 需要对比历史 mastery，事件日志里有记录，此处取保守策略
    const allZero = masteries.every((m) => m === 0);
    const allHigh = ctx.avgMastery >= 0.8;
    ctx.masteryTrend = allZero ? 'unknown' : allHigh ? 'up' : 'flat';
  }

  // 2. 学习计划 → 距考天数 + 今日任务数
  const masterPlan = await readJSON<StudyPlan>(path.join(planDir, 'plan_master.json'));
  if (masterPlan?.examDate) {
    const examDate = new Date(masterPlan.examDate);
    const today = new Date();
    ctx.daysToExam = daysBetween(today, examDate);
  }
  const today = new Date().toISOString().split('T')[0];
  const dailyPlan = await readJSON<{ tasks: unknown[] }>(
    path.join(planDir, 'plan_daily', `${today}.json`)
  );
  if (dailyPlan?.tasks) {
    ctx.tasksToday = dailyPlan.tasks.length;
  }

  // 3. 薄弱知识点
  const weakness = await readJSON<{ weakNodes: string[] } & { concepts?: never }>(
    path.join(mistakesDir, 'weakness_profile.json')
  );
  if (weakness?.weakNodes?.length && conceptMap?.concepts) {
    const nameById = new Map(conceptMap.concepts.map((c) => [c.id, c.name]));
    ctx.weakNodeNames = weakness.weakNodes
      .map((id) => nameById.get(id))
      .filter((n): n is string => Boolean(n));
  }

  // 4. 最近一次测验分数（扫 results 目录取最新）
  try {
    const files = (await fs.readdir(resultsDir))
      .filter((f) => f.endsWith('_result.json'))
      .sort();
    if (files.length > 0) {
      const latest = await readJSON<{ totalScore: number }>(
        path.join(resultsDir, files[files.length - 1])
      );
      if (latest && typeof latest.totalScore === 'number') {
        ctx.recentScore = latest.totalScore;
        // 有成绩记录时，趋势可以更准：高分=up，低分=down
        ctx.masteryTrend = latest.totalScore >= 70 ? 'up' : 'down';
      }
    }
  } catch {
    // results 目录不存在
  }

  return ctx;
}
