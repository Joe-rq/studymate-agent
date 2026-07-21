import path from 'path';

export const WORKSPACE_ROOT = path.join(process.cwd(), 'workspace');

export const PROMPTS_SOURCE = path.join(process.cwd(), 'src', 'prompts');

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
  /** 用户级配置（当前选中的备考搭子等）。文件，非目录。 */
  config: path.join(WORKSPACE_ROOT, 'config.json'),
  /** 备考搭子对话历史目录。 */
  buddy: path.join(WORKSPACE_ROOT, 'buddy'),
  /** 备考搭子对话历史。文件，非目录。 */
  buddyChatHistory: path.join(WORKSPACE_ROOT, 'buddy', 'chat_history.jsonl'),
  /** 考试调研产物目录。 */
  research: path.join(WORKSPACE_ROOT, 'research'),
  /** 当前考试项目配置。文件，非目录。 */
  examConfig: path.join(WORKSPACE_ROOT, 'exam.json'),
} as const;
