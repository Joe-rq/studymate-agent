/**
 * Study Session 工作流
 *
 * 把「学习材料 → Recall → Quiz → Feedback → Reflect」串成连续闭环。
 * 活动会话持久化在 workspace/progress/study_session.json，支持刷新恢复；
 * 一天允许多个 Session：完成的 Session 进入历史（session_history.jsonl），
 * 不再阻塞当天启动新的 Session。
 *
 * 服务端是唯一事实源：
 * - Quiz 由 /studio/quiz 按当前 Session 任务范围生成并绑定 sessionId；
 * - Grade 由 /studio/grade 在服务端原子执行（批改→错题→掌握度→计划调整→推进），
 *   前端只提交 sessionId、quizId 和答案，不能伪造成绩；
 * - 任务完成（done）只在 Session 完成时写入，中途退出不计入完成率。
 */

import fs from 'fs/promises';
import path from 'path';
import { Paths } from '../../core/paths.js';
import { appendEvent, createEventId } from '../../core/event_log.js';
import { completeTask, prepareTasksForDate, type TodoTask } from '../../agents/task_dispatcher.js';
import type { Event } from '../../core/types.js';
import type { LLMClient } from '../../core/llm.js';
import { atomicWriteJSON } from '../../core/atomic_file.js';
import { addDaysToDateKey } from '../../core/date.js';
import { appendSessionHistory } from './session_history.js';
import { generateQuiz, type Quiz, type QuizConfig } from '../../agents/quiz_generator.js';
import { gradeAndAdapt, type GradeAndAdaptResult } from './grade_and_adapt.js';
import type { UserAnswer } from '../../agents/grader.js';

export type StudyStage = 'focus' | 'recall' | 'quiz' | 'feedback' | 'reflect' | 'completed';

export interface SessionTaskRef {
  id: string;
  type: 'learn' | 'review' | 'quiz';
  nodeId: string;
  nodeName: string;
  duration: number;
}

export interface StudySession {
  id: string;
  date: string;
  status: 'active' | 'completed';
  stage: StudyStage;
  startedAt: string;
  updatedAt: string;
  endedAt?: string;
  /** 当前任务快照（nodeName 已解析），刷新恢复不依赖当天计划是否迁移。 */
  currentTask: SessionTaskRef | null;
  /** 已学习/复习的概念 nodeId（知识点数统计）。 */
  focusNodeIds: string[];
  /** 本 session 内经 completeTask 完成的任务 id。 */
  completedTaskIds: string[];
  grade: {
    quizId: string;
    score: number;
    total: number;
    correct: number;
    accuracy: number;
    correlationId: string;
  } | null;
  masteryChanges: Array<{ nodeId: string; nodeName?: string; oldMastery: number; newMastery: number }>;
}

/** 返回给前端的 chunk：白名单字段，绝不暴露 sourceLink/materialId。 */
export interface PublicChunk {
  id: string;
  title: string;
  content: string;
  chapterPath: string;
}

export interface FocusData {
  concept: {
    id: string;
    name: string;
    definition: string;
    mastery: number;
    unverified?: boolean;
  } | null;
  chunks: PublicChunk[];
}

export interface ReflectSummary {
  durationSeconds: number;
  knowledgePoints: number;
  answeredQuestions: number;
  correct: number;
  accuracy: number;
  score: number;
  masteryDeltaSum: number;
  masteryChanges: Array<{ nodeId: string; nodeName?: string; oldMastery: number; newMastery: number }>;
}

export interface ReflectData {
  summary: ReflectSummary;
  nextFirstTask: SessionTaskRef | null;
}

/** completeSession 响应携带：刚完成 Session 的复盘 + 下一个待办（刷新后不保留）。 */
export interface CompletedData {
  summary: ReflectSummary;
  nextTask: SessionTaskRef | null;
}

export interface StudioAggregate {
  /** 仅活动会话；已完成/过期会话不在此出现（刷新只恢复 active）。 */
  session: {
    id: string;
    date: string;
    status: 'active' | 'completed';
    stage: StudyStage;
    startedAt: string;
    updatedAt: string;
    endedAt?: string;
  } | null;
  candidates: SessionTaskRef[];
  quizOnly: boolean;
  currentTask: SessionTaskRef | null;
  focus: FocusData | null;
  nextStage: StudyStage | null;
  reflect: ReflectData | null;
  message: string;
  completed?: CompletedData;
  /** 服务端批改结果（仅 /studio/grade 响应携带），形状与 /api/grade 一致。 */
  grade?: Record<string, unknown>;
}

export interface ExplainResult {
  explanation: string | null;
  refChunkIds: string[];
  degraded: boolean;
}

// ── 内部类型与工具 ────────────────────────────────────────────────

interface Chunk {
  id: string;
  materialId: string;
  title: string;
  content: string;
  chapterPath: string;
  sourceLink?: string;
}

interface ConceptNode {
  id: string;
  name: string;
  definition: string;
  prerequisiteIds: string[];
  relatedChunks: string[];
  mastery: number;
  unverified?: boolean;
}

interface ConceptMap {
  concepts: ConceptNode[];
  learningOrder: string[];
}

function sessionFilePath(workspaceRoot?: string): string {
  return workspaceRoot
    ? path.join(workspaceRoot, 'progress', 'study_session.json')
    : Paths.studySession;
}

export async function loadSession(workspaceRoot?: string): Promise<StudySession | null> {
  try {
    const raw = await fs.readFile(sessionFilePath(workspaceRoot), 'utf-8');
    return JSON.parse(raw) as StudySession;
  } catch {
    return null;
  }
}

export async function saveSession(session: StudySession, workspaceRoot?: string): Promise<void> {
  await atomicWriteJSON(sessionFilePath(workspaceRoot), session);
}

async function loadConceptMap(workspaceRoot?: string): Promise<ConceptMap | null> {
  try {
    const graphDir = workspaceRoot ? path.join(workspaceRoot, 'graph') : Paths.graph;
    const raw = JSON.parse(await fs.readFile(path.join(graphDir, 'concepts.json'), 'utf-8'));
    return raw as ConceptMap;
  } catch {
    return null;
  }
}

async function loadChunkMap(workspaceRoot?: string): Promise<Map<string, Chunk>> {
  try {
    const chunksDir = workspaceRoot ? path.join(workspaceRoot, 'chunks') : Paths.chunks;
    const raw = JSON.parse(await fs.readFile(path.join(chunksDir, 'index.json'), 'utf-8')) as Chunk[];
    return new Map(raw.map((c) => [c.id, c]));
  } catch {
    return new Map();
  }
}

function toTaskRef(t: TodoTask): SessionTaskRef {
  const type = t.type === 'review' ? 'review' : t.type === 'quiz' ? 'quiz' : 'learn';
  return { id: t.id, type, nodeId: t.nodeId, nodeName: t.nodeName, duration: t.duration };
}

function toPublicChunk(c: Chunk): PublicChunk {
  return { id: c.id, title: c.title, content: c.content, chapterPath: c.chapterPath };
}

function deriveCandidates(tasks: TodoTask[]): SessionTaskRef[] {
  return tasks
    .filter((t) => t.status === 'pending' && (t.type === 'learn' || t.type === 'review'))
    .map(toTaskRef);
}

function quizOnly(tasks: TodoTask[]): boolean {
  const pending = tasks.filter((t) => t.status === 'pending');
  return pending.length > 0 && pending.every((t) => t.type === 'quiz');
}

function nextStageOf(stage: StudyStage): StudyStage | null {
  switch (stage) {
    case 'focus': return 'recall';
    case 'recall': return 'quiz';
    case 'quiz': return 'feedback';
    case 'feedback': return 'reflect';
    case 'reflect': return 'completed';
    case 'completed': return null;
  }
}

async function buildFocus(nodeId: string, workspaceRoot?: string): Promise<FocusData | null> {
  if (!nodeId) return null;
  const conceptMap = await loadConceptMap(workspaceRoot);
  if (!conceptMap) return { concept: null, chunks: [] };
  const concept = conceptMap.concepts.find((c) => c.id === nodeId) ?? null;
  const chunkMap = await loadChunkMap(workspaceRoot);
  const chunks = (concept?.relatedChunks ?? [])
    .map((cid) => chunkMap.get(cid))
    .filter((c): c is Chunk => Boolean(c))
    .map(toPublicChunk);
  return {
    concept: concept
      ? {
          id: concept.id,
          name: concept.name,
          definition: concept.definition,
          mastery: concept.mastery,
          unverified: concept.unverified,
        }
      : null,
    chunks,
  };
}

function computeReflect(session: StudySession): ReflectSummary {
  const ended = session.endedAt ? new Date(session.endedAt).getTime() : Date.now();
  const started = new Date(session.startedAt).getTime();
  const durationSeconds = Math.max(0, Math.round((ended - started) / 1000));
  const knowledgePoints = new Set([
    ...session.focusNodeIds,
    ...session.masteryChanges.map((m) => m.nodeId),
  ]).size;
  const masteryDeltaSum = session.masteryChanges.reduce(
    (s, m) => s + (m.newMastery - m.oldMastery),
    0
  );
  return {
    durationSeconds,
    knowledgePoints,
    answeredQuestions: session.grade?.total ?? 0,
    correct: session.grade?.correct ?? 0,
    accuracy: session.grade?.accuracy ?? 0,
    score: session.grade?.score ?? 0,
    masteryDeltaSum,
    masteryChanges: session.masteryChanges,
  };
}

/** 明日首项任务：只读 plan_daily/{明日}.json，不触发迁移/dispatch。 */
async function nextFirstTask(
  workspaceRoot: string | undefined,
  today: string
): Promise<SessionTaskRef | null> {
  const planDir = workspaceRoot
    ? path.join(workspaceRoot, 'plan', 'plan_daily')
    : path.join(Paths.plan, 'plan_daily');
  const tomorrow = addDaysToDateKey(today, 1);
  let daily: { tasks?: TodoTask[] } | null = null;
  try {
    daily = JSON.parse(await fs.readFile(path.join(planDir, `${tomorrow}.json`), 'utf-8'));
  } catch {
    return null;
  }
  const tasks = daily?.tasks ?? [];
  if (tasks.length === 0) return null;
  const first = tasks.find((t) => t.type === 'learn' || t.type === 'review') ?? tasks[0];
  let nodeName = first.nodeId;
  try {
    const conceptMap = await loadConceptMap(workspaceRoot);
    const c = conceptMap?.concepts.find((x) => x.id === first.nodeId);
    if (c) nodeName = c.name;
  } catch {
    // 概念缺失时用 nodeId
  }
  return toTaskRef({ ...first, nodeName });
}

// ── 聚合 ──────────────────────────────────────────────────────────

export interface BuildAggregateOpts {
  today: string;
  taskEventLog: string;
  workspaceRoot?: string;
  /** completeSession 响应注入：刚完成 Session 的复盘数据。 */
  completed?: CompletedData;
}

export async function buildAggregate(opts: BuildAggregateOpts): Promise<StudioAggregate> {
  const { today, taskEventLog, workspaceRoot } = opts;
  const session = await loadSession(workspaceRoot);
  // 只把「今天的活动会话」当作当前 Session；completed 属于历史，不阻塞新会话
  const activeSession = session && session.date === today && session.status === 'active' ? session : null;

  let tasks: TodoTask[] = [];
  try {
    tasks = (await prepareTasksForDate(today, taskEventLog, workspaceRoot)).tasks ?? [];
  } catch {
    tasks = [];
  }

  const candidates = deriveCandidates(tasks);
  const onlyQuiz = quizOnly(tasks);
  const message =
    tasks.length === 0
      ? '今日无待办任务'
      : candidates.length > 0
        ? `今日有 ${tasks.filter((t) => t.status === 'pending').length} 项任务待完成`
        : onlyQuiz
          ? '今日只剩测验'
          : '今日任务已完成';

  if (!activeSession) {
    return {
      session: null,
      candidates,
      quizOnly: onlyQuiz,
      currentTask: null,
      focus: null,
      nextStage: candidates.length > 0 ? 'focus' : onlyQuiz ? 'quiz' : null,
      reflect: null,
      message,
      ...(opts.completed ? { completed: opts.completed } : {}),
    };
  }

  const currentTask = activeSession.currentTask;
  const focus = currentTask ? await buildFocus(currentTask.nodeId, workspaceRoot) : null;
  const reflect =
    activeSession.stage === 'reflect' || activeSession.stage === 'completed'
      ? {
          summary: computeReflect(activeSession),
          nextFirstTask: await nextFirstTask(workspaceRoot, today),
        }
      : null;

  return {
    session: {
      id: activeSession.id,
      date: activeSession.date,
      status: activeSession.status,
      stage: activeSession.stage,
      startedAt: activeSession.startedAt,
      updatedAt: activeSession.updatedAt,
      endedAt: activeSession.endedAt,
    },
    candidates,
    quizOnly: onlyQuiz,
    currentTask,
    focus,
    nextStage: nextStageOf(activeSession.stage),
    reflect,
    message,
    ...(opts.completed ? { completed: opts.completed } : {}),
  };
}

// ── 会话操作 ──────────────────────────────────────────────────────

export interface StartSessionOpts extends BuildAggregateOpts {
  taskId?: string;
}

export async function startSession(opts: StartSessionOpts): Promise<StudioAggregate> {
  const { today, taskEventLog, workspaceRoot, taskId } = opts;
  // 幂等：今天已有活动会话则直接返回（刷新/重复点击不新建）
  const existing = await loadSession(workspaceRoot);
  if (existing && existing.date === today && existing.status === 'active') {
    return buildAggregate(opts);
  }
  // 已完成的当日会话属于历史，允许开始下一个 Session

  let tasks: TodoTask[] = [];
  try {
    tasks = (await prepareTasksForDate(today, taskEventLog, workspaceRoot)).tasks ?? [];
  } catch {
    tasks = [];
  }

  let selected: SessionTaskRef | null = null;
  if (taskId) {
    const t = tasks.find((x) => x.id === taskId && x.status === 'pending');
    if (!t) throw new Error('Task not found or not pending');
    selected = toTaskRef(t);
  } else {
    const candidates = deriveCandidates(tasks);
    if (candidates.length > 0) {
      selected = candidates[0];
    } else if (quizOnly(tasks)) {
      const firstQuiz = tasks.find((t) => t.status === 'pending' && t.type === 'quiz');
      if (firstQuiz) selected = toTaskRef(firstQuiz);
    }
  }
  if (!selected) throw new Error('今日无可用学习任务');

  const now = new Date().toISOString();
  const session: StudySession = {
    id: `ss_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    date: today,
    status: 'active',
    stage: selected.type === 'quiz' ? 'quiz' : 'focus',
    startedAt: now,
    updatedAt: now,
    currentTask: selected,
    focusNodeIds: [],
    completedTaskIds: [],
    grade: null,
    masteryChanges: [],
  };
  await saveSession(session, workspaceRoot);

  const event: Event = {
    id: createEventId(),
    timestamp: now,
    agent: 'study_session',
    action: 'study_session_started',
    input: { sessionId: session.id, date: today, taskId: selected.id, stage: session.stage },
    output: {
      focusConceptId: selected.type === 'quiz' ? null : selected.nodeId,
      taskType: selected.type,
    },
  };
  await appendEvent(taskEventLog, event);

  return buildAggregate(opts);
}

export interface AdvanceSessionOpts extends BuildAggregateOpts {
  fromStage: StudyStage;
}

/**
 * 阶段推进（focus→recall、recall→quiz、feedback→reflect）。
 * Quiz 阶段的推进与批改由 gradeStudioSession 原子完成，此处不再接受成绩。
 * focus 完成（阅读完毕）不等于任务完成——done 只在 Session 完成时写入。
 */
export async function advanceSession(opts: AdvanceSessionOpts): Promise<StudioAggregate> {
  const { today, taskEventLog, workspaceRoot, fromStage } = opts;
  const session = await loadSession(workspaceRoot);
  if (!session || session.date !== today || session.status !== 'active') {
    throw new Error('No active session');
  }
  // 幂等：阶段不匹配视为已推进（no-op 返回当前）
  if (session.stage !== fromStage) {
    return buildAggregate(opts);
  }

  const taskId = session.currentTask?.id;
  let toStage: StudyStage;

  switch (fromStage) {
    case 'focus': {
      // 阅读完成 ≠ 任务完成：只记录学到的概念，done 延迟到 Session 完成
      toStage = 'recall';
      const nodeId = session.currentTask?.nodeId;
      if (nodeId && !session.focusNodeIds.includes(nodeId)) session.focusNodeIds.push(nodeId);
      break;
    }
    case 'recall':
      toStage = 'quiz';
      break;
    case 'quiz':
      throw new Error('Quiz stage is advanced by POST /api/studio/grade, not /advance');
    case 'feedback':
      toStage = 'reflect';
      break;
    default:
      throw new Error(`Invalid fromStage: ${fromStage}`);
  }

  session.stage = toStage;
  session.updatedAt = new Date().toISOString();
  await saveSession(session, workspaceRoot);

  const event: Event = {
    id: createEventId(),
    timestamp: session.updatedAt,
    agent: 'study_session',
    action: 'study_stage_completed',
    input: { sessionId: session.id, fromStage, toStage },
    output: {
      taskId: fromStage === 'focus' ? taskId : undefined,
      focusNodeIds: session.focusNodeIds,
    },
  };
  await appendEvent(taskEventLog, event);

  return buildAggregate(opts);
}

/**
 * 完成 Session：
 * - 此时才把当前任务标记为 done（completeTask 幂等，只写一次 task_completed）；
 * - 追加 session_history（一次）；
 * - 响应携带 completed 复盘 + nextTask（继续下一项）。
 */
export async function completeSession(opts: BuildAggregateOpts): Promise<StudioAggregate> {
  const { today, taskEventLog, workspaceRoot } = opts;
  const session = await loadSession(workspaceRoot);
  if (!session || session.date !== today) {
    throw new Error('No active session');
  }
  if (session.status === 'completed') {
    return buildAggregate(opts); // 幂等
  }

  // 任务完成点：Session 完成时写入（且仅一次）
  const taskId = session.currentTask?.id;
  if (taskId && !session.completedTaskIds.includes(taskId)) {
    await completeTask(session.date, taskId, 'done', taskEventLog, workspaceRoot);
    session.completedTaskIds.push(taskId);
  }

  session.status = 'completed';
  session.stage = 'completed';
  session.endedAt = new Date().toISOString();
  session.updatedAt = session.endedAt;
  await saveSession(session, workspaceRoot);

  const summary = computeReflect(session);
  await appendSessionHistory(
    {
      sessionId: session.id,
      date: session.date,
      startedAt: session.startedAt,
      endedAt: session.endedAt!,
      taskType: session.currentTask?.type ?? 'learn',
      nodeId: session.currentTask?.nodeId ?? '',
      nodeName: session.currentTask?.nodeName ?? '',
      durationSeconds: summary.durationSeconds,
      knowledgePoints: summary.knowledgePoints,
      answeredQuestions: summary.answeredQuestions,
      correct: summary.correct,
      accuracy: summary.accuracy,
      score: summary.score,
      masteryDeltaSum: summary.masteryDeltaSum,
      masteryChanges: summary.masteryChanges,
    },
    workspaceRoot
  );

  const event: Event = {
    id: createEventId(),
    timestamp: session.endedAt,
    agent: 'study_session',
    action: 'study_session_completed',
    input: { sessionId: session.id, date: today },
    output: {
      durationSeconds: summary.durationSeconds,
      knowledgePoints: summary.knowledgePoints,
      answeredQuestions: summary.answeredQuestions,
      accuracy: summary.accuracy,
      masteryDeltaSum: summary.masteryDeltaSum,
      endedAt: session.endedAt,
    },
  };
  await appendEvent(taskEventLog, event);

  // 复盘 + 下一个待办任务（当天连续学习）
  const aggregate = await buildAggregate(opts);
  const nextTask = aggregate.candidates[0] ?? null;
  return { ...aggregate, completed: { summary, nextTask } };
}

// ── Session 绑定的 Quiz ──────────────────────────────────────────

function sessionQuizPath(session: StudySession, workspaceRoot?: string): string {
  const quizzesDir = workspaceRoot ? path.join(workspaceRoot, 'quizzes') : Paths.quizzes;
  return path.join(quizzesDir, `${session.date}_${session.id}.json`);
}

export interface SessionQuizOpts extends BuildAggregateOpts {
  llm: LLMClient;
  config?: QuizConfig;
}

/**
 * 为当前活动 Session 生成（或返回已生成的）Quiz。
 * - Quiz 绑定 sessionId，一个 Session 的 Quiz 不会被另一个 Session 复用；
 * - 出题范围 = 当前任务概念 + 历史薄弱点补充（薄弱点不能完全替代当前学习目标）；
 * - 重复调用幂等：文件已存在直接返回。
 */
export async function generateSessionQuiz(opts: SessionQuizOpts): Promise<Quiz> {
  const { today, taskEventLog, workspaceRoot, llm, config } = opts;
  const session = await loadSession(workspaceRoot);
  if (!session || session.date !== today || session.status !== 'active') {
    throw new Error('No active session');
  }

  const quizFile = sessionQuizPath(session, workspaceRoot);
  try {
    return JSON.parse(await fs.readFile(quizFile, 'utf-8')) as Quiz;
  } catch {
    // 尚未生成
  }

  const nodeId = session.currentTask?.nodeId;
  if (!nodeId) throw new Error('Session has no current task');
  const conceptMap = await loadConceptMap(workspaceRoot);
  const concept = conceptMap?.concepts.find((c) => c.id === nodeId);
  if (!concept) throw new Error(`Concept ${nodeId} not found`);
  if (concept.unverified || concept.relatedChunks.length === 0) {
    throw new Error(`Concept ${nodeId} has no source-backed chunks for quiz`);
  }

  // 历史薄弱点补充（最多 2 个，不能喧宾夺主）
  const supplements: ConceptNode[] = [];
  try {
    const profilePath = workspaceRoot
      ? path.join(workspaceRoot, 'mistakes', 'weakness_profile.json')
      : path.join(Paths.mistakes, 'weakness_profile.json');
    const profile = JSON.parse(await fs.readFile(profilePath, 'utf-8')) as {
      nodes?: Record<string, { mistakeCount: number }>;
    };
    const weakIds = Object.entries(profile.nodes ?? {})
      .sort((a, b) => b[1].mistakeCount - a[1].mistakeCount)
      .map(([id]) => id)
      .filter((id) => id !== nodeId);
    for (const id of weakIds) {
      const c = conceptMap?.concepts.find((x) => x.id === id);
      if (c && !c.unverified && c.relatedChunks.length > 0 && supplements.length < 2) {
        supplements.push(c);
      }
    }
  } catch {
    // 无薄弱画像时只考当前概念
  }

  const concepts = [concept, ...supplements];
  const quiz = await generateQuiz(
    concepts,
    llm,
    session.date,
    taskEventLog,
    supplements.map((c) => c.id),
    config ?? { questionCount: 3, allowMultiChoice: true },
    workspaceRoot,
    { sessionId: session.id, focusNodeIds: [nodeId] }
  );
  return quiz;
}

/** 读取指定 Session 的 Quiz（供批改时校验）。 */
export async function loadSessionQuiz(
  sessionId: string,
  date: string,
  quizId: string,
  workspaceRoot?: string
): Promise<Quiz> {
  const quizzesDir = workspaceRoot ? path.join(workspaceRoot, 'quizzes') : Paths.quizzes;
  const file = path.join(quizzesDir, `${date}_${sessionId}.json`);
  const quiz = JSON.parse(await fs.readFile(file, 'utf-8')) as Quiz;
  if (quiz.id !== quizId) {
    throw new Error(`Quiz id mismatch: expected ${quizId}, found ${quiz.id}`);
  }
  return quiz;
}

// ── 服务端原子批改 ────────────────────────────────────────────────

export interface GradeStudioOpts extends BuildAggregateOpts {
  sessionId: string;
  quizId: string;
  answers: UserAnswer[];
}

export interface GradeStudioResult {
  aggregate: StudioAggregate;
  grade: Record<string, unknown>;
}

/** 与 /api/grade 响应同构的批改回执（前端 GradeSummary 直接消费）。 */
export function toGradePayload(gnr: GradeAndAdaptResult): Record<string, unknown> {
  return {
    score: gnr.result.totalScore,
    total: gnr.result.details.length,
    correct: gnr.result.details.filter((d) => d.isCorrect).length,
    results: gnr.result.details.map((d) => ({
      questionId: d.question.id,
      correct: d.isCorrect,
      score: d.score,
      errorType: gnr.mistakes.find((m) => m.questionId === d.question.id)?.errorType,
    })),
    mistakes: gnr.mistakes,
    weaknessExplanations: gnr.weaknessExplanations,
    correlationId: gnr.correlationId,
    masteryChanges: gnr.masteryChanges.map((m) => ({
      nodeId: m.nodeId,
      nodeName: m.nodeName,
      oldMastery: m.oldMastery,
      newMastery: m.newMastery,
    })),
    adjustments: gnr.adjustments,
    latestInsight: gnr.latestInsight,
  };
}

/**
 * Studio 原子批改：服务端执行 批改 → 错题 → 掌握度 → 计划调整 → Session 推进。
 * 前端只提交 sessionId、quizId 与答案；成绩与掌握度变化一律来自服务端回执。
 *
 * 幂等与恢复：
 * - 批改成功后响应丢失 → 相同答案重试返回同一回执（grade receipt）并给出当前聚合；
 * - 不同答案重试 → gradeAndAdapt 抛错（路由映射 409），不再修改掌握度。
 */
export async function gradeStudioSession(opts: GradeStudioOpts): Promise<GradeStudioResult> {
  const { today, taskEventLog, workspaceRoot, sessionId, quizId, answers } = opts;
  const session = await loadSession(workspaceRoot);
  if (!session || session.id !== sessionId || session.date !== today) {
    throw new Error('No active session for this sessionId');
  }
  if (session.status !== 'active') {
    throw new Error('Session already completed');
  }

  // Quiz 必须属于当前 Session（防止复用其他 Session 的题目与批改状态）
  const quiz = await loadSessionQuiz(sessionId, today, quizId, workspaceRoot);

  const alreadyGraded = session.grade !== null && session.stage !== 'quiz';
  if (session.stage !== 'quiz' && !alreadyGraded) {
    throw new Error(`Session stage is ${session.stage}, not quiz`);
  }

  const graphDir = workspaceRoot ? path.join(workspaceRoot, 'graph') : Paths.graph;
  const planDir = workspaceRoot ? path.join(workspaceRoot, 'plan') : Paths.plan;
  const gnr = await gradeAndAdapt({
    quiz,
    answers,
    conceptsPath: path.join(graphDir, 'concepts.json'),
    planPath: path.join(planDir, 'plan_master.json'),
    eventLogFile: taskEventLog,
    workspaceRoot,
  });
  const gradePayload = toGradePayload(gnr);

  if (!alreadyGraded) {
    // 首次批改：记录服务端成绩并推进到 feedback（重复提交时不再写这些字段）
    session.grade = {
      quizId,
      score: gnr.result.totalScore,
      total: gnr.result.details.length,
      correct: gnr.result.details.filter((d) => d.isCorrect).length,
      accuracy:
        gnr.result.details.length > 0
          ? gnr.result.details.filter((d) => d.isCorrect).length / gnr.result.details.length
          : 0,
      correlationId: gnr.correlationId,
    };
    session.masteryChanges = gnr.masteryChanges.map((m) => ({
      nodeId: m.nodeId,
      nodeName: m.nodeName,
      oldMastery: m.oldMastery,
      newMastery: m.newMastery,
    }));
    session.stage = 'feedback';
    session.updatedAt = new Date().toISOString();
    await saveSession(session, workspaceRoot);

    const event: Event = {
      id: createEventId(),
      timestamp: session.updatedAt,
      agent: 'study_session',
      action: 'studio_quiz_graded',
      input: { sessionId: session.id, quizId, questionCount: quiz.questions.length },
      output: {
        score: session.grade.score,
        total: session.grade.total,
        correct: session.grade.correct,
        correlationId: gnr.correlationId,
      },
    };
    await appendEvent(taskEventLog, event);
  }

  const aggregate = await buildAggregate(opts);
  return { aggregate: { ...aggregate, grade: gradePayload }, grade: gradePayload };
}

// ── AI 解释 ───────────────────────────────────────────────────────

export interface ExplainConceptOpts {
  conceptId: string;
  chunkIds?: string[];
  llm: LLMClient;
  workspaceRoot?: string;
}

export async function explainConcept(opts: ExplainConceptOpts): Promise<ExplainResult> {
  const { conceptId, chunkIds, llm, workspaceRoot } = opts;
  const conceptMap = await loadConceptMap(workspaceRoot);
  const concept = conceptMap?.concepts.find((c) => c.id === conceptId);
  if (!concept) throw new Error(`Concept ${conceptId} not found`);

  const chunkMap = await loadChunkMap(workspaceRoot);
  const selectedIds = chunkIds ?? concept.relatedChunks;
  const chunks = selectedIds
    .map((cid) => chunkMap.get(cid))
    .filter((c): c is Chunk => Boolean(c));
  if (chunks.length === 0) {
    return { explanation: null, refChunkIds: [], degraded: true };
  }

  const fragment = chunks
    .map((c) => `[${c.id}]（标题：${c.title}）\n${c.content.slice(0, 4000)}`)
    .join('\n\n');

  const system =
    '你是备考搭子的讲解助手（概念讲解）。根据给定的概念定义和教材原文片段，用通俗中文解释该概念。只引用给出的片段，不要编造。仅输出 JSON：{ "explanation": "解释正文", "refChunkIds": ["chk_..."] }。';
  const user = `## ${concept.name} [${concept.id}]\n定义：${concept.definition}\n原文片段：\n${fragment}`;

  try {
    const raw = await llm.completeJSON<{ explanation?: unknown; refChunkIds?: unknown }>(system, user, {
      temperature: 0.3,
      retries: 2,
    });
    const explanation =
      typeof raw?.explanation === 'string' && raw.explanation.trim() ? raw.explanation : null;
    const refs = Array.isArray(raw?.refChunkIds)
      ? raw.refChunkIds.filter((x): x is string => typeof x === 'string')
      : [];
    const validRefs = refs.filter((id) => chunks.some((c) => c.id === id));
    if (!explanation || validRefs.length === 0) {
      return { explanation: null, refChunkIds: [], degraded: true };
    }
    return { explanation, refChunkIds: validRefs, degraded: false };
  } catch {
    return { explanation: null, refChunkIds: [], degraded: true };
  }
}
