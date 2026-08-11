/**
 * Study Session 工作流
 *
 * 把「学习材料 → Recall → Quiz → Feedback → Reflect」串成连续闭环。
 * 维护单个进行中的学习会话（workspace/progress/study_session.json），
 * 支持刷新恢复与重复提交幂等。
 *
 * 复用：prepareTasksForDate（今日任务+迁移）、completeTask（任务完成）、
 * gradeAndAdapt（批改，前端走 /api/grade）、appendEvent（事件日志）。
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

export interface ReflectData {
  summary: {
    durationSeconds: number;
    knowledgePoints: number;
    answeredQuestions: number;
    correct: number;
    accuracy: number;
    score: number;
    masteryDeltaSum: number;
    masteryChanges: Array<{ nodeId: string; nodeName?: string; oldMastery: number; newMastery: number }>;
  };
  nextFirstTask: SessionTaskRef | null;
}

export interface StudioAggregate {
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

function computeReflect(session: StudySession): ReflectData['summary'] {
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
}

export async function buildAggregate(opts: BuildAggregateOpts): Promise<StudioAggregate> {
  const { today, taskEventLog, workspaceRoot } = opts;
  const session = await loadSession(workspaceRoot);
  const activeSession = session && session.date === today ? session : null;

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

  const publicSession = activeSession
    ? {
        id: activeSession.id,
        date: activeSession.date,
        status: activeSession.status,
        stage: activeSession.stage,
        startedAt: activeSession.startedAt,
        updatedAt: activeSession.updatedAt,
        endedAt: activeSession.endedAt,
      }
    : null;

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
    session: publicSession,
    candidates,
    quizOnly: onlyQuiz,
    currentTask,
    focus,
    nextStage: nextStageOf(activeSession.stage),
    reflect,
    message,
  };
}

// ── 会话操作 ──────────────────────────────────────────────────────

export interface StartSessionOpts extends BuildAggregateOpts {
  taskId?: string;
}

export async function startSession(opts: StartSessionOpts): Promise<StudioAggregate> {
  const { today, taskEventLog, workspaceRoot, taskId } = opts;
  const existing = await loadSession(workspaceRoot);
  if (existing && existing.date === today && existing.status === 'active') {
    return buildAggregate(opts); // 幂等：已有进行中会话
  }

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

export interface AdvanceGradeInput {
  quizId?: string;
  score: number;
  total: number;
  correct: number;
  correlationId?: string;
}

export interface AdvanceSessionOpts extends BuildAggregateOpts {
  fromStage: StudyStage;
  grade?: AdvanceGradeInput;
  masteryChanges?: Array<{ nodeId: string; nodeName?: string; oldMastery: number; newMastery: number }>;
}

export async function advanceSession(opts: AdvanceSessionOpts): Promise<StudioAggregate> {
  const { today, taskEventLog, workspaceRoot, fromStage, grade, masteryChanges } = opts;
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
      toStage = 'recall';
      if (taskId) {
        await completeTask(session.date, taskId, 'done', taskEventLog, workspaceRoot);
        if (!session.completedTaskIds.includes(taskId)) session.completedTaskIds.push(taskId);
        const nodeId = session.currentTask?.nodeId;
        if (nodeId && !session.focusNodeIds.includes(nodeId)) session.focusNodeIds.push(nodeId);
      }
      break;
    }
    case 'recall':
      toStage = 'quiz';
      break;
    case 'quiz': {
      if (!grade) throw new Error('grade is required');
      const accuracy = grade.total > 0 ? grade.correct / grade.total : 0;
      session.grade = {
        quizId: grade.quizId ?? '',
        score: grade.score,
        total: grade.total,
        correct: grade.correct,
        accuracy,
        correlationId: grade.correlationId ?? '',
      };
      if (masteryChanges && masteryChanges.length > 0) session.masteryChanges = masteryChanges;
      toStage = 'feedback';
      break;
    }
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
      completedTaskIds: session.completedTaskIds,
    },
  };
  await appendEvent(taskEventLog, event);

  return buildAggregate(opts);
}

export async function completeSession(opts: BuildAggregateOpts): Promise<StudioAggregate> {
  const { today, taskEventLog, workspaceRoot } = opts;
  const session = await loadSession(workspaceRoot);
  if (!session || session.date !== today) {
    throw new Error('No active session');
  }
  if (session.status === 'completed') {
    return buildAggregate(opts); // 幂等
  }

  session.status = 'completed';
  session.stage = 'completed';
  session.endedAt = new Date().toISOString();
  session.updatedAt = session.endedAt;
  await saveSession(session, workspaceRoot);

  const summary = computeReflect(session);
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

  return buildAggregate(opts);
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
