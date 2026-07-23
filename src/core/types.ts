export interface Event {
  id: string;
  timestamp: string;
  agent: string;
  action: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  /** Schema version for forward compatibility. Defaults to 1. */
  schemaVersion?: number;
  /** Correlation ID linking related events (e.g. all events from one grade session). */
  correlationId?: string;
  /** Exam project ID for multi-project support. */
  examProjectId?: string;
  /** LLM model used for this event. */
  model?: string;
  /** Prompt version identifier (e.g. 'quiz_v2'). */
  promptVersion?: string;
  /** Wall-clock duration of the LLM call in milliseconds. */
  durationMs?: number;
  /** Token usage breakdown from LLM response. */
  tokenUsage?: { prompt: number; completion: number; total: number };
}

export interface AppState {
  materials: Record<string, unknown>;
  chunks: Record<string, unknown>;
  concepts: Record<string, unknown>;
  plan: Record<string, unknown>;
  tasks: Record<string, unknown>;
  quizzes: Record<string, unknown>;
  results: Record<string, unknown>;
  mistakes: Record<string, unknown>;
  progress: Record<string, unknown>;
}
