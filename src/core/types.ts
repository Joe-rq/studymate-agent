export interface Event {
  id: string;
  timestamp: string;
  agent: string;
  action: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
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
