import { beginRequest, endRequest } from './lib/requestState';

const BASE = '/api';
const TOKEN_KEY = 'studymate_access_token';
/** 服务端返回 401 时触发（App 层监听后弹出令牌输入门禁）。 */
export const AUTH_REQUIRED_EVENT = 'studymate:auth-required';

/** 访问令牌只存 sessionStorage：关闭标签页即失效，不写入 localStorage/URL/Cookie。 */
export function getAccessToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setAccessToken(token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearAccessToken(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}

export class UnauthorizedError extends Error {
  constructor() {
    super('访问未授权：需要访问令牌');
    this.name = 'UnauthorizedError';
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  beginRequest();
  try {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    const token = getAccessToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const res = await fetch(`${BASE}${path}`, { ...options, headers });
    if (res.status === 401) {
      window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
      throw new UnauthorizedError();
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    endRequest(true);
    return res.json();
  } catch (err) {
    endRequest(false);
    throw err;
  }
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
};

// ── Types ────────────────────────────────────────────────────────────

export interface StatusResponse {
  exam: { name: string; date: string; status: string } | null;
  daysToExam: number | null;
  avgMastery: number;
  streakDays: number;
  tasksToday: number;
  recentScore: number | null;
  latestPlanAdjustment?: {
    adjustedAt: string;
    reason: string;
    tasksAdded: number;
    minutesAdded: number;
    daysAffected: number;
    affectedConcepts: string[];
  } | null;
  topWeakNode?: string | null;
}

export interface Task {
  id: string;
  nodeId: string;
  nodeName: string;
  type: string;
  duration: number;
  status: 'pending' | 'done' | 'skipped';
}

export interface TodayPlan {
  date: string;
  tasks: Task[];
}

export interface QuizQuestion {
  id: string;
  nodeId: string;
  type: 'single_choice' | 'multi_choice';
  stem: string;
  options: string[];
  answer: number[];
  explanation?: string;
}

export interface Quiz {
  id: string;
  date: string;
  questions: QuizQuestion[];
  /** 非空时 Quiz 绑定到 Study Session。 */
  sessionId?: string;
  focusNodeIds?: string[];
}

export interface GradeResult {
  score: number;
  total: number;
  correct: number;
  results: Array<{
    questionId: string;
    correct: boolean;
    score: number;
    errorType?: string;
  }>;
  mistakes?: unknown[];
  weaknessExplanations?: Record<string, string>;
  correlationId?: string;
  masteryChanges?: MasteryChange[];
  adjustments?: unknown[];
  latestInsight?: string;
}

export interface BuddyStateResponse {
  state: {
    characterId: string;
    relationshipLevel: number;
    preferences: {
      reminderIntensity: string;
      emotionalStyle: string;
      formOfAddress?: string;
      companionMode?: 'companion' | 'quiet' | 'off' | 'active';
    };
    memories: Array<{ id: string; date: string; type: string; content: string }>;
    commitments: Array<{ date: string; text: string; fulfilled?: boolean }>;
    streakDays: number;
    lastActiveDate: string;
  };
  character: {
    id: string;
    name: string;
    tagline?: string;
    personality: string;
    speechStyle: string;
    formOfAddress: string;
    selfAddress: string;
    catchphrases: string[];
  } | null;
  recentHistory: Array<{ role: string; content: string; timestamp: string }>;
  activity?: 'off' | 'quiet' | 'companion' | 'active';
}

export interface CharacterInfo {
  id: string;
  name: string;
  tagline?: string;
  personality: string;
  speechStyle: string;
  formOfAddress: string;
  selfAddress: string;
  catchphrases: string[];
}

export interface MetricsResponse {
  planCompletionRate: number;
  postReviewAccuracy: number;
  knowledgeRetention: number;
  /** null = 指标不可用（题目跳过/弃用反馈机制尚未实现）。 */
  questionDiscardRate: number | null;
}

export interface ConceptNode {
  id: string;
  name: string;
  mastery: number;
  prerequisites: string[];
}

export interface ConceptMap {
  concepts: ConceptNode[];
  learningOrder: string[];
}

// ── Onboarding types ──────────────────────────────────────────────

export interface ExamProject {
  id: string;
  name: string;
  examDate: string;
  subjects: string[];
  status: string;
  learnerProfile: {
    baseline: string;
    dailyMinutes: number;
    unavailableDates: string[];
  };
}

export interface PlanCapacitySummary {
  requiredMinutes: number;
  availableMinutes: number;
  scheduledConceptCount: number;
  unscheduledConceptIds: string[];
}

export interface StudyPlan {
  id: string;
  examDate: string;
  dailyMinutes: number;
  schedule: Array<{ date: string; tasks: unknown[]; isRest?: boolean }>;
  version: number;
  capacity?: PlanCapacitySummary;
}

export interface SourceRecord {
  id: string;
  url: string;
  title: string;
  sourceType: 'official' | 'community' | 'commercial' | 'user_file';
  confidenceLevel: string;
  summary: string;
  approved?: boolean;
}

export interface ResearchResult {
  skipped?: boolean;
  reason?: string;
  message?: string;
  sources: SourceRecord[];
  summary: {
    examFacts: string;
    experienceConsensus: string;
    disputedAdvice: string;
    materialRecommendations: string;
    gapsInEvidence: string;
    citations: {
      examFacts: string[];
      experienceConsensus: string[];
      disputedAdvice: string[];
      materialRecommendations: string[];
    };
  } | null;
  sourceCount: number;
  queryCount: number;
}

export interface KnowledgeStatus {
  conceptCount: number;
  concepts: Array<{ id: string; name: string; mastery: number }>;
}

export interface MaterialSummary {
  id: string;
  title: string;
  type: string;
  wordCount: number;
  capturedAt: string;
  version: number;
}

export interface UploadResult {
  material: { id: string; title: string; type: string; wordCount: number };
  chunkCount: number;
}

// ── Onboarding API calls ──────────────────────────────────────────

export const onboarding = {
  createExam: (data: {
    name: string;
    examDate: string;
    subjects: string;
    dailyMinutes: number;
    baseline?: string;
    target?: string;
    unavailableDates?: string[];
  }) => api.post<ExamProject>('/exam/create', data),

  getExam: () => api.get<ExamProject | null>('/exam'),

  runResearch: () => api.post<ResearchResult>('/exam/research'),

  getResearch: () => api.get<{ sources: SourceRecord[]; profile: unknown }>('/exam/research'),

  approveSources: (ids: string[]) =>
    api.post<{ approvedCount: number; totalSources: number }>('/exam/sources/approve', { ids }),

  buildKnowledge: () => api.post<{
    materialsImported: number;
    chunksGenerated: number;
    conceptsExtracted: number;
    fetchErrors: string[];
  }>('/knowledge/build'),

  getKnowledgeStatus: () => api.get<KnowledgeStatus>('/knowledge/status'),

  generatePlan: (examDate?: string, dailyMinutes?: number, unavailableDates?: string[]) =>
    api.post<StudyPlan>('/plan/generate', { examDate, dailyMinutes, unavailableDates }),

  approvePlan: () =>
    api.post<{ ok: true; exam: ExamProject }>('/plan/approve'),

  listMaterials: () => api.get<{ materials: MaterialSummary[] }>('/materials'),

  uploadMaterial: async (file: File): Promise<UploadResult> => {
    const contentBase64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result);
        resolve(result.slice(result.indexOf(',') + 1)); // strip data:...;base64,
      };
      reader.onerror = () => reject(new Error('读取文件失败'));
      reader.readAsDataURL(file);
    });
    return api.post<UploadResult>('/materials/upload', { filename: file.name, contentBase64 });
  },
};

// ── Study Studio types ─────────────────────────────────────────

export interface MasteryChange {
  nodeId: string;
  nodeName?: string;
  oldMastery: number;
  newMastery: number;
}

export interface StudioTaskRef {
  id: string;
  type: 'learn' | 'review' | 'quiz';
  nodeId: string;
  nodeName: string;
  duration: number;
}

export type StudioStage = 'focus' | 'recall' | 'quiz' | 'feedback' | 'reflect' | 'completed';

export interface StudioFocusChunk {
  id: string;
  title: string;
  content: string;
  chapterPath: string;
}

export interface StudioFocus {
  concept: {
    id: string;
    name: string;
    definition: string;
    mastery: number;
    unverified?: boolean;
  } | null;
  chunks: StudioFocusChunk[];
}

export interface StudioSession {
  id: string;
  date: string;
  status: 'active' | 'completed';
  stage: StudioStage;
  startedAt: string;
  updatedAt: string;
  endedAt?: string;
}

export interface StudioReflect {
  summary: {
    durationSeconds: number;
    knowledgePoints: number;
    answeredQuestions: number;
    correct: number;
    accuracy: number;
    score: number;
    masteryDeltaSum: number;
    masteryChanges: MasteryChange[];
  };
  nextFirstTask: StudioTaskRef | null;
}

/** completeSession 响应携带：刚完成 Session 的复盘 + 下一个待办（刷新后不保留）。 */
export interface StudioCompleted {
  summary: StudioReflect['summary'];
  nextTask: StudioTaskRef | null;
}

export interface StudioResponse {
  session: StudioSession | null;
  candidates: StudioTaskRef[];
  quizOnly: boolean;
  currentTask: StudioTaskRef | null;
  focus: StudioFocus | null;
  nextStage: StudioStage | null;
  reflect: StudioReflect | null;
  message: string;
  buddy?: { streakDays: number; activity: string; milestoneHit: boolean };
  completed?: StudioCompleted;
  /** 服务端批改结果（仅 /studio/grade 响应携带），形状与 /api/grade 一致。 */
  grade?: GradeResult;
}

export interface ExplainResult {
  explanation: string | null;
  refChunkIds: string[];
  degraded: boolean;
}

// ── Session history (Growth) types ─────────────────────────────

export interface SessionHistoryItem {
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
  masteryChanges: MasteryChange[];
}

export interface SessionsResponse {
  sessions: SessionHistoryItem[];
  trend: Array<{ date: string; sessions: number; avgAccuracy: number; avgScore: number; totalMinutes: number }>;
  totals: { sessionCount: number; totalMinutes: number; avgAccuracy: number; avgScore: number };
}
