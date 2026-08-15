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
  /** 学习会话状态。文件，非目录。 */
  studySession: path.join(WORKSPACE_ROOT, 'progress', 'study_session.json'),
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

export type ResolvedPaths = typeof Paths;

/**
 * 解析实际使用的路径集合。传入 workspaceRoot（隔离测试 / 自定义数据目录）时，
 * 返回以该目录为根的完整路径副本；否则返回默认 Paths。
 * API 路由必须经由本函数取路径，避免测试或自定义部署误写默认 workspace。
 */
export function resolvePaths(workspaceRoot?: string): ResolvedPaths {
  if (!workspaceRoot) return Paths;
  const root = path.isAbsolute(workspaceRoot)
    ? workspaceRoot
    : path.join(process.cwd(), workspaceRoot);
  const shift = (p: string) => path.join(root, path.relative(WORKSPACE_ROOT, p));
  return {
    workspace: root,
    materials: shift(Paths.materials),
    chunks: shift(Paths.chunks),
    graph: shift(Paths.graph),
    plan: shift(Paths.plan),
    tasks: shift(Paths.tasks),
    quizzes: shift(Paths.quizzes),
    results: shift(Paths.results),
    mistakes: shift(Paths.mistakes),
    progress: shift(Paths.progress),
    eventLog: shift(Paths.eventLog),
    studySession: shift(Paths.studySession),
    prompts: shift(Paths.prompts),
    config: shift(Paths.config),
    buddy: shift(Paths.buddy),
    buddyChatHistory: shift(Paths.buddyChatHistory),
    research: shift(Paths.research),
    examConfig: shift(Paths.examConfig),
  };
}
