/**
 * Grade and Adapt Workflow
 *
 * Encapsulates the full post-quiz pipeline:
 * 1. Grade the quiz
 * 2. Analyze mistakes
 * 3. Update mastery (EMA)
 * 4. Adjust the study plan based on weak concepts
 *
 * This is extracted from cli.ts grade command to be reusable by Web UI
 * and other interfaces.
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { gradeQuiz, saveResult, type UserAnswer, type QuizResult } from '../../agents/grader.js';
import { analyzeMistakes, saveMistakes, explainWeakness, loadWeaknessProfilePublic, type Mistake, type WeaknessProfile } from '../../agents/mistake_analyzer.js';
import { updateMastery, saveMastery, type MasteryChange } from '../../agents/mastery_tracker.js';
import { adjustPlan, saveAdjustedPlan, type PlanAdjustment } from '../../agents/plan_adjuster.js';
import { loadLearnerModel, saveLearnerModel, updateFromQuizResult } from '../../agents/learner_model.js';
import type { LearnerModel } from '../../domain/learner.js';
import type { Quiz } from '../../agents/quiz_generator.js';
import type { ConceptMap } from '../../agents/concept_mapper.js';
import type { StudyPlan } from '../../agents/planner.js';
import { createCorrelationId } from '../../core/event_log.js';
import { Paths } from '../../core/paths.js';
import { atomicWriteJSON } from '../../core/atomic_file.js';

export interface GradeAndAdaptInput {
  quiz: Quiz;
  answers: UserAnswer[];
  /** Path to concepts.json */
  conceptsPath: string;
  /** Path to plan_master.json (optional — plan adjustment skipped if missing) */
  planPath?: string;
  /** Event log file path */
  eventLogFile: string;
  /** Optional workspace root for test isolation */
  workspaceRoot?: string;
}

export interface GradeAndAdaptResult {
  /** The graded quiz result. */
  result: QuizResult;
  /** Mistakes extracted from this session (with error type classification). */
  mistakes: Mistake[];
  /** Unique node IDs that had mistakes. */
  mistakeNodeIds: string[];
  /** Mastery changes for concepts tested in this session. */
  masteryChanges: MasteryChange[];
  /** Plan adjustments made based on weak concepts. */
  adjustments: PlanAdjustment[];
  /** Correlation ID linking all events from this session. */
  correlationId: string;
  /** Human-readable weakness explanations for mistake nodes. */
  weaknessExplanations: Record<string, string>;
  /** Latest learner insight (if learner model exists). */
  latestInsight?: string;
}

type GradeReceiptStatus = 'processing' | 'completed' | 'failed';

/** 失败恢复用的原始累积状态快照：覆盖写回即可回到批改前状态。 */
interface GradeSnapshot {
  conceptMap: ConceptMap;
  weaknessProfile: WeaknessProfile;
  learnerModel: LearnerModel | null;
  plan: StudyPlan | null;
}

interface GradeReceipt {
  quizId: string;
  quizHash: string;
  answerHash: string;
  status: GradeReceiptStatus;
  correlationId?: string;
  result?: GradeAndAdaptResult;
  error?: string;
  snapshot?: GradeSnapshot;
}

function stableHash(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value), 'utf-8').digest('hex');
}

function normalizeAnswers(answers: UserAnswer[]): UserAnswer[] {
  return [...answers]
    .map((answer) => ({
      questionId: answer.questionId,
      answer: Array.isArray(answer.answer)
        ? [...answer.answer].sort((a, b) => a - b)
        : answer.answer,
    }))
    .sort((a, b) => a.questionId.localeCompare(b.questionId));
}

function receiptPathFor(quizId: string, workspaceRoot?: string): string {
  const resultsDir = workspaceRoot ? path.join(workspaceRoot, 'results') : Paths.results;
  const safeId = crypto.createHash('sha256').update(quizId, 'utf-8').digest('hex').slice(0, 16);
  return path.join(resultsDir, `grade_receipt_${safeId}.json`);
}

async function loadReceipt(receiptPath: string): Promise<GradeReceipt | null> {
  try {
    const raw = JSON.parse(await fs.readFile(receiptPath, 'utf-8')) as GradeReceipt;
    // 旧格式回执（无 status 字段）仅在完成后写入，视为 completed
    return { ...raw, status: raw.status ?? 'completed' };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

// ── 并发互斥（按 quizId，进程内）─────────────────────────────────
// Node 单线程，但 async 写盘会在 await 处交错；同一 quiz 的并发批改必须串行，
// 否则两次都会读到「无回执」并重复累计错题/掌握度/学习者模型。
const gradeLocks = new Map<string, Promise<unknown>>();

function withGradeLock<T>(quizId: string, body: () => Promise<T>): Promise<T> {
  const tail = gradeLocks.get(quizId) ?? Promise.resolve();
  const run = tail.then(body, body);
  gradeLocks.set(quizId, run.then(() => undefined, () => undefined));
  return run;
}

/** 覆盖写回批改前的原始累积状态（失败恢复，保证重试不重复累计掌握度/错题/学习者模型/计划）。 */
async function restoreSnapshot(snapshot: GradeSnapshot, workspaceRoot?: string): Promise<void> {
  const graphDir = workspaceRoot ? path.join(workspaceRoot, 'graph') : Paths.graph;
  const mistakesDir = workspaceRoot ? path.join(workspaceRoot, 'mistakes') : Paths.mistakes;
  const progressDir = workspaceRoot ? path.join(workspaceRoot, 'progress') : Paths.progress;
  const planDir = workspaceRoot ? path.join(workspaceRoot, 'plan') : Paths.plan;

  await atomicWriteJSON(path.join(graphDir, 'concepts.json'), snapshot.conceptMap);
  await atomicWriteJSON(path.join(mistakesDir, 'weakness_profile.json'), snapshot.weaknessProfile);

  if (snapshot.learnerModel) {
    await atomicWriteJSON(path.join(progressDir, 'learner_model.json'), snapshot.learnerModel);
  } else {
    await fs.rm(path.join(progressDir, 'learner_model.json'), { force: true }).catch(() => {});
  }

  if (snapshot.plan) {
    await atomicWriteJSON(path.join(planDir, 'plan_master.json'), snapshot.plan);
  } else {
    await fs.rm(path.join(planDir, 'plan_master.json'), { force: true }).catch(() => {});
  }
}

/** 依赖注入点：测试注入 failAt 在对应写盘阶段前抛错，模拟中途失败。 */
export interface GradeAndAdaptDeps {
  failAt?: 'result' | 'mistakes' | 'mastery' | 'plan' | 'learner';
}

export async function gradeAndAdapt(
  input: GradeAndAdaptInput,
  deps: GradeAndAdaptDeps = {}
): Promise<GradeAndAdaptResult> {
  return withGradeLock(input.quiz.id, () => runGradeAndAdapt(input, deps));
}

async function runGradeAndAdapt(
  input: GradeAndAdaptInput,
  deps: GradeAndAdaptDeps
): Promise<GradeAndAdaptResult> {
  const { quiz, answers, conceptsPath, planPath, eventLogFile, workspaceRoot } = input;
  const receiptPath = receiptPathFor(quiz.id, workspaceRoot);
  const quizHash = stableHash(quiz);
  const answerHash = stableHash(normalizeAnswers(answers));
  const correlationId = createCorrelationId();
  const date = quiz.date;

  const existing = await loadReceipt(receiptPath);
  if (existing?.status === 'completed') {
    if (existing.quizHash !== quizHash) {
      throw new Error(`Quiz ${quiz.id} has already been graded with different quiz content`);
    }
    if (existing.answerHash !== answerHash) {
      throw new Error(`Quiz ${quiz.id} has already been graded with different answers`);
    }
    return existing.result!;
  }

  // 上次执行中途失败：先回滚到原始状态，再重新执行，避免重复累计累积状态
  if (existing?.snapshot) {
    await restoreSnapshot(existing.snapshot, workspaceRoot);
  }

  // 读取批改前的原始累积状态（同时作为失败恢复快照）
  const conceptMap: ConceptMap = JSON.parse(await fs.readFile(conceptsPath, 'utf-8'));
  const weaknessProfile = await loadWeaknessProfilePublic(workspaceRoot);
  const learnerModel = await loadLearnerModel(workspaceRoot);
  const plan: StudyPlan | null = planPath
    ? await (async () => {
        try {
          return JSON.parse(await fs.readFile(planPath, 'utf-8')) as StudyPlan;
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
          throw err;
        }
      })()
    : null;

  // updateMastery 会原地修改 conceptMap，快照必须是独立深拷贝，否则失败回滚拿到的是已更新值
  const snapshot: GradeSnapshot = {
    conceptMap: JSON.parse(JSON.stringify(conceptMap)),
    weaknessProfile,
    learnerModel,
    plan,
  };
  await atomicWriteJSON(receiptPath, {
    quizId: quiz.id,
    quizHash,
    answerHash,
    status: 'processing',
    correlationId,
    snapshot,
  });

  try {
    // 1. Grade the quiz
    if (deps.failAt === 'result') throw new Error('Injected failure at result stage');
    const result = gradeQuiz(quiz, answers);
    await saveResult(result, eventLogFile, workspaceRoot);

    // 2. Analyze mistakes and save cumulatively
    if (deps.failAt === 'mistakes') throw new Error('Injected failure at mistakes stage');
    const mistakes = analyzeMistakes(result, conceptMap.concepts);
    await saveMistakes(mistakes, date, eventLogFile, workspaceRoot);
    const mistakeNodeIds = [...new Set(mistakes.map((m) => m.nodeId))];

    // Generate weakness explanations（saveMistakes 后的最新画像，反映本次错题）
    const weaknessExplanations: Record<string, string> = {};
    if (mistakeNodeIds.length > 0) {
      const profile = await loadWeaknessProfilePublic(workspaceRoot);
      for (const nodeId of mistakeNodeIds) {
        weaknessExplanations[nodeId] = explainWeakness(nodeId, profile);
      }
    }

    // 3. Update mastery via EMA
    if (deps.failAt === 'mastery') throw new Error('Injected failure at mastery stage');
    const masteryUpdate = updateMastery(conceptMap, result);
    await saveMastery(masteryUpdate, eventLogFile, workspaceRoot);

    // 4. Adjust plan if one exists
    let adjustments: PlanAdjustment[] = [];
    if (plan) {
      if (deps.failAt === 'plan') throw new Error('Injected failure at plan stage');
      const adjusted = adjustPlan(plan, masteryUpdate.conceptMap, {
        reason: `Post-quiz adaptation: ${mistakeNodeIds.length} weak nodes detected`,
        quizNodeIds: mistakeNodeIds.filter((id) => {
          const c = masteryUpdate.conceptMap.concepts.find((co) => co.id === id);
          return c !== undefined && c.mastery < 0.3;
        }),
      });
      await saveAdjustedPlan(adjusted.plan, adjusted.record, eventLogFile, workspaceRoot);
      adjustments = adjusted.adjustments;
    }

    // 5. Update learner model if it exists
    let latestInsight: string | undefined;
    if (learnerModel) {
      if (deps.failAt === 'learner') throw new Error('Injected failure at learner stage');
      const updatedModel = updateFromQuizResult(learnerModel, result, masteryUpdate.changes);
      await saveLearnerModel(updatedModel, workspaceRoot);
      if (updatedModel.insights.length > learnerModel.insights.length) {
        const newInsight = updatedModel.insights[updatedModel.insights.length - 1];
        latestInsight = newInsight.content;
      }
    }

    const workflowResult: GradeAndAdaptResult = {
      result,
      mistakes,
      mistakeNodeIds,
      masteryChanges: masteryUpdate.changes,
      adjustments,
      correlationId,
      weaknessExplanations,
      latestInsight,
    };

    await atomicWriteJSON(receiptPath, {
      quizId: quiz.id,
      quizHash,
      answerHash,
      status: 'completed',
      correlationId,
      result: workflowResult,
    });

    return workflowResult;
  } catch (err) {
    // 回滚累积状态；写入 failed 回执（保留快照供下次重试恢复）
    await restoreSnapshot(snapshot, workspaceRoot).catch(() => {});
    try {
      await atomicWriteJSON(receiptPath, {
        quizId: quiz.id,
        quizHash,
        answerHash,
        status: 'failed',
        correlationId,
        error: err instanceof Error ? err.message : String(err),
        snapshot,
      });
    } catch {
      // failed 回执写失败也不吞掉原始错误
    }
    throw err;
  }
}
