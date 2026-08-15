import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createApp } from '../../src/server/app.js';
import http from 'http';
import type { AddressInfo } from 'net';
import fs from 'fs/promises';
import path from 'path';
import { loadEvents } from '../../src/core/event_log.js';
import { createMockLLMClient } from '../../src/core/mock_llm.js';
import type { UserAnswer } from '../../src/agents/grader.js';
import type { Quiz } from '../../src/agents/quiz_generator.js';
import type { StudioResponse } from '../../application/workflows/study_session.js';

const TODAY = '2026-08-11';
const TEST_DIR = path.join(process.cwd(), 'workspace_test_study_api');

interface SetupTask {
  type: 'learn' | 'review' | 'quiz';
  nodeId: string;
  duration: number;
}

async function setupWorkspace(tasks: SetupTask[] = [
  { type: 'learn', nodeId: 'node_1', duration: 30 },
  { type: 'quiz', nodeId: 'node_2', duration: 10 },
]): Promise<void> {
  const dir = TEST_DIR;
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(path.join(dir, 'plan', 'plan_daily'), { recursive: true });
  await fs.writeFile(
    path.join(dir, 'plan', 'plan_daily', `${TODAY}.json`),
    JSON.stringify({ date: TODAY, tasks })
  );
  await fs.writeFile(
    path.join(dir, 'plan', 'plan_master.json'),
    JSON.stringify({ dailyMinutes: 60 })
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
          relatedChunks: ['chk_1'],
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
}

async function correctAnswers(quiz: Quiz): Promise<UserAnswer[]> {
  return quiz.questions.map((q) => ({
    questionId: q.id,
    answer: Array.isArray(q.answer) ? q.answer : q.answer,
  }));
}

async function wrongAnswers(quiz: Quiz): Promise<UserAnswer[]> {
  return quiz.questions.map((q) => ({
    questionId: q.id,
    answer: Array.isArray(q.answer) ? [q.answer.length - 1] : (q.answer + 1) % q.options.length,
  }));
}

describe('Study Studio API', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    // 注入 Mock LLM：测试不依赖 OPENAI_API_KEY，出题/批改闭环全部走真实工作流
    const app = createApp({
      workspaceRoot: TEST_DIR,
      today: () => TODAY,
      llm: createMockLLMClient(),
    });
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address() as AddressInfo;
        baseUrl = `http://localhost:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  beforeEach(async () => {
    await setupWorkspace();
  });

  async function get(p: string) {
    return fetch(`${baseUrl}${p}`);
  }
  async function post(p: string, body?: unknown) {
    return fetch(`${baseUrl}${p}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  it('GET /api/studio 返回候选与 nextStage', async () => {
    const res = await get('/api/studio');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.candidates).toHaveLength(1);
    expect(data.candidates[0].nodeId).toBe('node_1');
    expect(data.nextStage).toBe('focus');
  });

  it('GET /api/sessions 初始为空', async () => {
    const res = await get('/api/sessions');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.sessions).toEqual([]);
    expect(data.totals.sessionCount).toBe(0);
  });

  it('POST /api/studio/start 创建 focus 会话，chunk 无 sourceLink', async () => {
    const res = await post('/api/studio/start', {});
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.session?.stage).toBe('focus');
    expect(data.focus?.concept?.name).toBe('需求曲线');
    expect(JSON.stringify(data.focus)).not.toContain('sourceLink');
  });

  it('POST /api/studio/explain 在 mock 分支返回解释', async () => {
    await post('/api/studio/start', {});
    const res = await post('/api/studio/explain', { conceptId: 'node_1' });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.degraded).toBe(false);
    expect(data.explanation).toContain('需求曲线');
    expect(data.refChunkIds).toContain('chk_1');
  });

  it('focus 完成不等于任务完成：阅读后任务仍为 pending', async () => {
    await post('/api/studio/start', {});
    await post('/api/studio/advance', { fromStage: 'focus' });

    const tasks = await (await get('/api/plan/today')).json();
    expect(tasks.tasks[0].status).toBe('pending');
  });

  it('完整黄金路径：服务端出题 → 服务端批改 → 复盘，重复提交幂等', async () => {
    await post('/api/studio/start', {});

    // focus → recall → quiz
    let res = await post('/api/studio/advance', { fromStage: 'focus' });
    expect((await res.json()).session?.stage).toBe('recall');
    res = await post('/api/studio/advance', { fromStage: 'recall' });
    expect((await res.json()).session?.stage).toBe('quiz');

    // Session 绑定出题（真实调用 quiz 生成工作流）
    res = await post('/api/studio/quiz', {});
    expect(res.status).toBe(200);
    const quiz: Quiz = await res.json();
    expect(quiz.sessionId).toBeTruthy();
    expect(quiz.questions.length).toBeGreaterThan(0);
    // Quiz 必须包含当前 Session 概念
    expect(quiz.questions.some((q) => q.nodeId === 'node_1')).toBe(true);

    // 重复出题幂等：返回同一份 Quiz
    const res2 = await post('/api/studio/quiz', {});
    const quiz2: Quiz = await res2.json();
    expect(quiz2.id).toBe(quiz.id);

    // 服务端批改（全对）
    res = await post('/api/studio/grade', {
      sessionId: quiz.sessionId,
      quizId: quiz.id,
      answers: await correctAnswers(quiz),
    });
    expect(res.status).toBe(200);
    const graded = await res.json();
    expect(graded.session?.stage).toBe('feedback');
    expect(graded.grade.score).toBe(100);
    expect(graded.grade.total).toBe(quiz.questions.length);
    expect(graded.grade.masteryChanges.length).toBeGreaterThan(0);
    // 掌握度变化来自服务端（node_1 全对 → mastery 提升）
    const n1 = graded.grade.masteryChanges.find((m: { nodeId: string }) => m.nodeId === 'node_1');
    expect(n1.newMastery).toBeGreaterThan(0);

    // feedback → reflect → complete
    res = await post('/api/studio/advance', { fromStage: 'feedback' });
    const reflect = await res.json();
    expect(reflect.session?.stage).toBe('reflect');
    expect(reflect.reflect?.summary.answeredQuestions).toBe(quiz.questions.length);
    expect(reflect.reflect?.summary.score).toBe(100);

    res = await post('/api/studio/complete', {});
    const done = await res.json();
    expect(done.session).toBeNull(); // 完成后不再有活动会话
    expect(done.completed?.summary.score).toBe(100);
    expect(done.completed?.summary.answeredQuestions).toBe(quiz.questions.length);

    // Session 完成才写入任务完成
    const tasks = await (await get('/api/plan/today')).json();
    expect(tasks.tasks[0].status).toBe('done');

    // 事件日志包含关键事件
    const events = await loadEvents(path.join(TEST_DIR, 'event_log', 'events.jsonl'));
    const actions = events.map((e) => e.action);
    expect(actions).toContain('study_session_started');
    expect(actions).toContain('studio_quiz_graded');
    expect(actions).toContain('study_session_completed');

    // session_history 有 1 条记录
    const sr = await get('/api/sessions');
    const sdata = await sr.json();
    expect(sdata.sessions).toHaveLength(1);
    expect(sdata.sessions[0].nodeName).toBe('需求曲线');
    expect(sdata.sessions[0].score).toBe(100);

    // complete 联动 streak
    expect(done.buddy?.streakDays).toBe(1);
    expect(done.buddy?.milestoneHit).toBe(false);
    expect(done.buddy?.activity).toBe('companion');
  });

  it('伪造成绩无效：advance 不再接受 grade 字段，分数只能来自服务端', async () => {
    await post('/api/studio/start', {});
    await post('/api/studio/advance', { fromStage: 'focus' });
    await post('/api/studio/advance', { fromStage: 'recall' });

    // 篡改请求体中的分数/mastery 提交 advance —— 应被拒绝
    const res = await post('/api/studio/advance', {
      fromStage: 'quiz',
      grade: { quizId: 'q1', score: 999, total: 5, correct: 5 },
      masteryChanges: [{ nodeId: 'node_1', oldMastery: 0, newMastery: 1 }],
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('studio/grade');

    const studio = (await (await get('/api/studio')).json()) as StudioResponse;
    expect(studio.session?.stage).toBe('quiz');
  });

  it('批改响应丢失后重试：相同答案返回同一回执，不再重复修改掌握度', async () => {
    await post('/api/studio/start', {});
    await post('/api/studio/advance', { fromStage: 'focus' });
    await post('/api/studio/advance', { fromStage: 'recall' });
    const quiz: Quiz = await (await post('/api/studio/quiz', {})).json();
    const answers = await correctAnswers(quiz);

    const first = await post('/api/studio/grade', {
      sessionId: quiz.sessionId,
      quizId: quiz.id,
      answers,
    });
    expect(first.status).toBe(200);
    const firstBody = await first.json();

    // 模拟网络中断后重试（相同答案）
    const retry = await post('/api/studio/grade', {
      sessionId: quiz.sessionId,
      quizId: quiz.id,
      answers,
    });
    expect(retry.status).toBe(200);
    const retryBody = await retry.json();
    expect(retryBody.grade.score).toBe(firstBody.grade.score);
    expect(retryBody.grade.correlationId).toBe(firstBody.grade.correlationId);
    expect(retryBody.session?.stage).toBe('feedback');

    // 掌握度只更新了一次：mastery_history 中 node_1 快照仅 1 条
    const history = await fs.readFile(
      path.join(TEST_DIR, 'progress', 'mastery_history.jsonl'),
      'utf-8'
    );
    const n1Snapshots = history
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l))
      .filter((s: { nodeId: string }) => s.nodeId === 'node_1');
    expect(n1Snapshots).toHaveLength(1);
  });

  it('批改后换答案重试返回 409，不再次修改掌握度', async () => {
    await post('/api/studio/start', {});
    await post('/api/studio/advance', { fromStage: 'focus' });
    await post('/api/studio/advance', { fromStage: 'recall' });
    const quiz: Quiz = await (await post('/api/studio/quiz', {})).json();

    await post('/api/studio/grade', {
      sessionId: quiz.sessionId,
      quizId: quiz.id,
      answers: await correctAnswers(quiz),
    });

    const res = await post('/api/studio/grade', {
      sessionId: quiz.sessionId,
      quizId: quiz.id,
      answers: await wrongAnswers(quiz),
    });
    expect(res.status).toBe(409);

    // 掌握度仍是第一次（全对）的结果
    const concepts = JSON.parse(
      await fs.readFile(path.join(TEST_DIR, 'graph', 'concepts.json'), 'utf-8')
    );
    const n1 = concepts.concepts.find((c: { id: string }) => c.id === 'node_1');
    expect(n1.mastery).toBeGreaterThan(0);
  });

  it('一天多任务：完成第一个 Session 后可立即开始第二个', async () => {
    await setupWorkspace([
      { type: 'learn', nodeId: 'node_1', duration: 30 },
      { type: 'learn', nodeId: 'node_2', duration: 30 },
    ]);

    // 第一项
    await post('/api/studio/start', {});
    await post('/api/studio/advance', { fromStage: 'focus' });
    await post('/api/studio/advance', { fromStage: 'recall' });
    const quiz: Quiz = await (await post('/api/studio/quiz', {})).json();
    await post('/api/studio/grade', {
      sessionId: quiz.sessionId,
      quizId: quiz.id,
      answers: await correctAnswers(quiz),
    });
    await post('/api/studio/advance', { fromStage: 'feedback' });
    const done1 = await (await post('/api/studio/complete', {})).json();
    expect(done1.completed?.nextTask?.nodeId).toBe('node_2'); // 建议继续下一项

    // 刷新：completed 不再是 active，候选仍有一项
    const refresh = (await (await get('/api/studio')).json()) as StudioResponse;
    expect(refresh.session).toBeNull();
    expect(refresh.candidates).toHaveLength(1);
    expect(refresh.candidates[0].nodeId).toBe('node_2');

    // 开始第二个 Session（不同任务、不同 Quiz、独立批改）
    const start2 = await (await post('/api/studio/start', {})).json();
    expect(start2.session?.stage).toBe('focus');
    expect(start2.currentTask?.nodeId).toBe('node_2');
    await post('/api/studio/advance', { fromStage: 'focus' });
    await post('/api/studio/advance', { fromStage: 'recall' });
    const quiz2: Quiz = await (await post('/api/studio/quiz', {})).json();
    expect(quiz2.sessionId).not.toBe(quiz.sessionId);
    expect(quiz2.questions.some((q) => q.nodeId === 'node_2')).toBe(true);
    const grade2 = await (
      await post('/api/studio/grade', {
        sessionId: quiz2.sessionId,
        quizId: quiz2.id,
        answers: await correctAnswers(quiz2),
      })
    ).json();
    expect(grade2.session?.stage).toBe('feedback');
    await post('/api/studio/advance', { fromStage: 'feedback' });
    const done2 = await (await post('/api/studio/complete', {})).json();

    // 两个 Session 都进入历史；第二个完成后当天任务全部完成
    const sdata = await (await get('/api/sessions')).json();
    expect(sdata.sessions).toHaveLength(2);
    expect(done2.completed?.nextTask).toBeNull();
    const final = (await (await get('/api/studio')).json()) as StudioResponse;
    expect(final.message).toBe('今日任务已完成');

    // 任务完成事件只对两个任务各写一次
    const events = await loadEvents(path.join(TEST_DIR, 'event_log', 'events.jsonl'));
    const completions = events.filter((e) => e.action === 'task_completed');
    expect(completions).toHaveLength(2);
  });

  it('无 pending 任务时 start 返回 400', async () => {
    // 把今天任务全部改为已完成状态再调用（进度文件）
    await fs.mkdir(path.join(TEST_DIR, 'tasks'), { recursive: true });
    await fs.writeFile(
      path.join(TEST_DIR, 'tasks', `${TODAY}_progress.json`),
      JSON.stringify({
        date: TODAY,
        completions: [
          { taskId: `task_${TODAY}_0`, status: 'done', completedAt: new Date().toISOString() },
          { taskId: `task_${TODAY}_1`, status: 'done', completedAt: new Date().toISOString() },
        ],
      })
    );
    const res = await post('/api/studio/start', {});
    expect(res.status).toBe(400);
  });
});
