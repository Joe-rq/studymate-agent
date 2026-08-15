import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import {
  buildAggregate,
  startSession,
  advanceSession,
  completeSession,
  explainConcept,
  generateSessionQuiz,
  gradeStudioSession,
  type StudySession,
} from '../../../src/application/workflows/study_session.js';
import { createMockLLMClient } from '../../../src/core/mock_llm.js';
import { loadEvents } from '../../../src/core/event_log.js';
import { loadSessionHistory } from '../../../src/application/workflows/session_history.js';
import type { UserAnswer } from '../../../src/agents/grader.js';

const TODAY = '2026-08-11';
const TEST_DIR = path.join(process.cwd(), 'workspace_test_study');

async function setupWorkspace(): Promise<string> {
  const dir = TEST_DIR;
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(path.join(dir, 'plan', 'plan_daily'), { recursive: true });
  await fs.writeFile(
    path.join(dir, 'plan', 'plan_daily', `${TODAY}.json`),
    JSON.stringify({
      date: TODAY,
      tasks: [
        { type: 'learn', nodeId: 'node_1', duration: 30 },
        { type: 'review', nodeId: 'node_2', duration: 15 },
      ],
    })
  );
  await fs.writeFile(
    path.join(dir, 'plan', 'plan_master.json'),
    JSON.stringify({ dailyMinutes: 60, schedule: [] })
  );
  await fs.mkdir(path.join(dir, 'graph'), { recursive: true });
  await fs.writeFile(
    path.join(dir, 'graph', 'concepts.json'),
    JSON.stringify({
      concepts: [
        {
          id: 'node_1',
          name: '需求曲线',
          definition: '价格与需求量的关系曲线',
          prerequisiteIds: [],
          relatedChunks: ['chk_1'],
          mastery: 0,
        },
        {
          id: 'node_2',
          name: '供给曲线',
          definition: '价格与供给量的关系曲线',
          prerequisiteIds: [],
          relatedChunks: [],
          mastery: 0,
        },
      ],
      learningOrder: ['node_1', 'node_2'],
    })
  );
  await fs.mkdir(path.join(dir, 'chunks'), { recursive: true });
  await fs.writeFile(
    path.join(dir, 'chunks', 'index.json'),
    JSON.stringify([
      {
        id: 'chk_1',
        materialId: 'mat_1',
        title: '需求与供给',
        content: '需求曲线向右下方倾斜。',
        chapterPath: '1',
        sourceLink: 'D:/secret/path.md',
      },
    ])
  );
  return dir;
}

function opts(dir: string) {
  return { today: TODAY, taskEventLog: path.join(dir, 'event_log', 'events.jsonl'), workspaceRoot: dir };
}

async function loadSavedSession(dir: string): Promise<StudySession | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(dir, 'progress', 'study_session.json'), 'utf-8'));
  } catch {
    return null;
  }
}

describe('study_session: 聚合与候选', () => {
  beforeEach(async () => {
    await setupWorkspace();
  });

  it('无 session 时返回候选任务与 nextStage=focus', async () => {
    const agg = await buildAggregate(opts(TEST_DIR));
    expect(agg.session).toBeNull();
    expect(agg.candidates).toHaveLength(2);
    expect(agg.candidates[0]).toMatchObject({ type: 'learn', nodeId: 'node_1' });
    expect(agg.candidates[1]).toMatchObject({ type: 'review', nodeId: 'node_2' });
    expect(agg.nextStage).toBe('focus');
    expect(agg.quizOnly).toBe(false);
  });

  it('chunk 内容经白名单脱敏，不含 sourceLink', async () => {
    const agg = await startSession({ ...opts(TEST_DIR) });
    const chunk = agg.focus?.chunks[0];
    expect(chunk).toBeDefined();
    expect(chunk?.content).toContain('需求曲线');
    expect(JSON.stringify(chunk)).not.toContain('sourceLink');
    expect(JSON.stringify(chunk)).not.toContain('D:/secret');
  });
});

describe('study_session: 会话操作与幂等', () => {
  beforeEach(async () => {
    await setupWorkspace();
  });

  it('start 创建会话并进入 focus，重复 start 幂等', async () => {
    const a = await startSession({ ...opts(TEST_DIR) });
    expect(a.session?.stage).toBe('focus');
    expect(a.currentTask?.nodeId).toBe('node_1');
    expect(a.focus?.concept?.name).toBe('需求曲线');
    const sessionA = await loadSavedSession(TEST_DIR);
    expect(sessionA?.stage).toBe('focus');

    const b = await startSession({ ...opts(TEST_DIR) });
    expect(b.session?.id).toBe(a.session?.id);
  });

  it('focus→recall 只记录概念，不标记任务完成', async () => {
    const started = await startSession({ ...opts(TEST_DIR) });
    const agg = await advanceSession({ ...opts(TEST_DIR), fromStage: 'focus' });
    expect(agg.session?.stage).toBe('recall');
    const saved = await loadSavedSession(TEST_DIR);
    expect(saved?.focusNodeIds).toContain('node_1');
    // 阅读完成 ≠ 任务完成：中途退出不应虚增完成率
    expect(saved?.completedTaskIds).not.toContain(started.currentTask!.id);
    let progress: { completions?: unknown[] } | null = null;
    try {
      progress = JSON.parse(
        await fs.readFile(path.join(TEST_DIR, 'tasks', `${TODAY}_progress.json`), 'utf-8')
      );
    } catch {
      progress = null;
    }
    expect(progress?.completions ?? []).toHaveLength(0);
  });

  it('advance 幂等：阶段不匹配时为 no-op', async () => {
    await startSession({ ...opts(TEST_DIR) });
    // 直接推进到 recall
    const r1 = await advanceSession({ ...opts(TEST_DIR), fromStage: 'focus' });
    expect(r1.session?.stage).toBe('recall');
    // 再以 focus 提交：不匹配，no-op 保持 recall
    const r2 = await advanceSession({ ...opts(TEST_DIR), fromStage: 'focus' });
    expect(r2.session?.stage).toBe('recall');
    // 事件只记录一次 focus→recall
    const events = await loadEvents(path.join(TEST_DIR, 'event_log', 'events.jsonl'));
    const stageEvents = events.filter((e) => e.action === 'study_stage_completed');
    expect(stageEvents).toHaveLength(1);
  });

  it('quiz 阶段由 /studio/grade 原子推进：advance 拒绝并指向新接口', async () => {
    await startSession({ ...opts(TEST_DIR) });
    await advanceSession({ ...opts(TEST_DIR), fromStage: 'focus' });
    await advanceSession({ ...opts(TEST_DIR), fromStage: 'recall' });
    await expect(
      advanceSession({ ...opts(TEST_DIR), fromStage: 'quiz' })
    ).rejects.toThrow('studio/grade');
  });

  it('generateSessionQuiz 绑定 sessionId 且包含当前概念，重复生成幂等', async () => {
    const started = await startSession({ ...opts(TEST_DIR) });
    await advanceSession({ ...opts(TEST_DIR), fromStage: 'focus' });
    await advanceSession({ ...opts(TEST_DIR), fromStage: 'recall' });

    const quiz = await generateSessionQuiz({ ...opts(TEST_DIR), llm: createMockLLMClient() });
    expect(quiz.sessionId).toBe(started.session?.id);
    expect(quiz.questions.length).toBeGreaterThan(0);
    expect(quiz.questions.every((q) => q.nodeId === 'node_1' || quiz.focusNodeIds?.includes(q.nodeId))).toBe(true);

    const again = await generateSessionQuiz({ ...opts(TEST_DIR), llm: createMockLLMClient() });
    expect(again.id).toBe(quiz.id);
  });

  it('gradeStudioSession：服务端批改推进到 feedback，成绩/掌握度来自回执', async () => {
    const started = await startSession({ ...opts(TEST_DIR) });
    await advanceSession({ ...opts(TEST_DIR), fromStage: 'focus' });
    await advanceSession({ ...opts(TEST_DIR), fromStage: 'recall' });
    const quiz = await generateSessionQuiz({ ...opts(TEST_DIR), llm: createMockLLMClient() });

    const answers: UserAnswer[] = quiz.questions.map((q) => ({
      questionId: q.id,
      answer: q.answer,
    }));
    const { aggregate, grade } = await gradeStudioSession({
      ...opts(TEST_DIR),
      sessionId: started.session!.id,
      quizId: quiz.id,
      answers,
    });
    expect(aggregate.session?.stage).toBe('feedback');
    expect(grade.score).toBe(100);

    const saved = await loadSavedSession(TEST_DIR);
    expect(saved?.grade?.score).toBe(100);
    expect(saved?.grade?.quizId).toBe(quiz.id);
    expect(saved?.masteryChanges.length).toBeGreaterThan(0);
  });

  it('feedback→reflect 附带 Reflect 汇总（数据来自服务端批改）', async () => {
    const started = await startSession({ ...opts(TEST_DIR) });
    await advanceSession({ ...opts(TEST_DIR), fromStage: 'focus' });
    await advanceSession({ ...opts(TEST_DIR), fromStage: 'recall' });
    const quiz = await generateSessionQuiz({ ...opts(TEST_DIR), llm: createMockLLMClient() });
    await gradeStudioSession({
      ...opts(TEST_DIR),
      sessionId: started.session!.id,
      quizId: quiz.id,
      answers: quiz.questions.map((q) => ({ questionId: q.id, answer: q.answer })),
    });
    const agg = await advanceSession({ ...opts(TEST_DIR), fromStage: 'feedback' });
    expect(agg.session?.stage).toBe('reflect');
    expect(agg.reflect?.summary.answeredQuestions).toBe(quiz.questions.length);
    expect(agg.reflect?.summary.correct).toBe(quiz.questions.length);
    expect(agg.reflect?.summary.score).toBe(100);
  });

  it('complete 时才写入任务完成，且幂等只写一次', async () => {
    const started = await startSession({ ...opts(TEST_DIR) });
    const a = await completeSession({ ...opts(TEST_DIR) });
    expect(a.session).toBeNull(); // 完成后无活动会话
    expect(a.completed?.summary).toBeDefined();
    expect(a.completed?.nextTask?.nodeId).toBe('node_2'); // 还有下一项

    // 任务完成恰好在 Session 完成时写入
    const progress = JSON.parse(
      await fs.readFile(path.join(TEST_DIR, 'tasks', `${TODAY}_progress.json`), 'utf-8')
    );
    expect(
      progress.completions.some(
        (c: { taskId: string; status: string }) => c.taskId === started.currentTask!.id && c.status === 'done'
      )
    ).toBe(true);

    const b = await completeSession({ ...opts(TEST_DIR) });
    expect(b.session).toBeNull();
    const events = await loadEvents(path.join(TEST_DIR, 'event_log', 'events.jsonl'));
    expect(events.filter((e) => e.action === 'study_session_completed')).toHaveLength(1);
    expect(events.filter((e) => e.action === 'task_completed')).toHaveLength(1);

    // session_history 应只有一条记录（幂等只写一次）
    const history = await loadSessionHistory(TEST_DIR);
    expect(history).toHaveLength(1);
    expect(history[0].nodeName).toBe('需求曲线');
  });

  it('completed Session 不阻塞当天新 Session', async () => {
    await startSession({ ...opts(TEST_DIR) });
    await completeSession({ ...opts(TEST_DIR) });

    // 已完成的会话不再是 active：聚合返回 null，可开始第二个
    const agg = await buildAggregate(opts(TEST_DIR));
    expect(agg.session).toBeNull();
    expect(agg.candidates).toHaveLength(1);

    const second = await startSession({ ...opts(TEST_DIR) });
    expect(second.session?.stage).toBe('focus');
    expect(second.currentTask?.nodeId).toBe('node_2');
    const saved = await loadSavedSession(TEST_DIR);
    expect(saved?.id).toBe(second.session?.id);

    const history = await loadSessionHistory(TEST_DIR);
    expect(history).toHaveLength(1); // 新会话未完成，不重复入历史
  });
});

describe('study_session: AI 解释', () => {
  beforeEach(async () => {
    await setupWorkspace();
  });

  it('有 chunk 时走 mock 分支返回解释与引用', async () => {
    const result = await explainConcept({
      conceptId: 'node_1',
      llm: createMockLLMClient(),
      workspaceRoot: TEST_DIR,
    });
    expect(result.degraded).toBe(false);
    expect(result.explanation).toContain('需求曲线');
    expect(result.refChunkIds).toContain('chk_1');
  });

  it('无关联 chunk 时降级', async () => {
    const result = await explainConcept({
      conceptId: 'node_2',
      llm: createMockLLMClient(),
      workspaceRoot: TEST_DIR,
    });
    expect(result.degraded).toBe(true);
    expect(result.explanation).toBeNull();
  });

  it('未知概念抛错', async () => {
    await expect(
      explainConcept({ conceptId: 'ghost', llm: createMockLLMClient(), workspaceRoot: TEST_DIR })
    ).rejects.toThrow('not found');
  });
});
