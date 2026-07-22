const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
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
}

export interface Task {
  id: string;
  nodeId: string;
  nodeName: string;
  type: string;
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
  date: string;
  questions: QuizQuestion[];
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
}

export interface BuddyStateResponse {
  state: {
    characterId: string;
    relationshipLevel: number;
    preferences: {
      reminderIntensity: string;
      emotionalStyle: string;
      formOfAddress?: string;
    };
    memories: Array<{ id: string; date: string; type: string; content: string }>;
    commitments: Array<{ date: string; text: string; fulfilled?: boolean }>;
    streakDays: number;
    lastActiveDate: string;
  };
  character: {
    id: string;
    name: string;
    personality: string;
    speechStyle: string;
    formOfAddress: string;
    selfAddress: string;
    catchphrases: string[];
  } | null;
  recentHistory: Array<{ role: string; content: string; timestamp: string }>;
}

export interface CharacterInfo {
  id: string;
  name: string;
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
  questionDiscardRate: number;
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
