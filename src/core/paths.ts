import path from 'path';

export const WORKSPACE_ROOT = path.join(process.cwd(), 'workspace');

export const Paths = {
  workspace: WORKSPACE_ROOT,
  materials: path.join(WORKSPACE_ROOT, 'materials'),
  chunks: path.join(WORKSPACE_ROOT, 'chunks'),
  graph: path.join(WORKSPACE_ROOT, 'graph'),
  plan: path.join(WORKSPACE_ROOT, 'plan'),
  tasks: path.join(WORKSPACE_ROOT, 'tasks'),
  quizzes: path.join(WORKSPACE_ROOT, 'quizzes'),
  results: path.join(WORKSPACE_ROOT, 'results'),
  mistakes: path.join(WORKSPACE_ROOT, 'mistakes'),
  progress: path.join(WORKSPACE_ROOT, 'progress'),
  eventLog: path.join(WORKSPACE_ROOT, 'event_log', 'events.jsonl'),
  prompts: path.join(WORKSPACE_ROOT, 'prompts'),
} as const;
