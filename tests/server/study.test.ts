import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createApp } from '../../src/server/app.js';
import http from 'http';
import type { AddressInfo } from 'net';
import fs from 'fs/promises';
import path from 'path';
import { loadEvents } from '../../src/core/event_log.js';

const TODAY = '2026-08-11';
const TEST_DIR = path.join(process.cwd(), 'workspace_test_study_api');

async function setupWorkspace(): Promise<void> {
  const dir = TEST_DIR;
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(path.join(dir, 'plan', 'plan_daily'), { recursive: true });
  await fs.writeFile(
    path.join(dir, 'plan', 'plan_daily', `${TODAY}.json`),
    JSON.stringify({
      date: TODAY,
      tasks: [
        { type: 'learn', nodeId: 'node_1', duration: 30 },
        { type: 'quiz', nodeId: 'node_2', duration: 10 },
      ],
    })
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
      ],
      learningOrder: ['node_1'],
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

describe('Study Studio API', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = createApp({ workspaceRoot: TEST_DIR, today: () => TODAY });
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

  it('完整黄金路径：advance 到 reflect，重复提交幂等', async () => {
    await post('/api/studio/start', {});

    // focus → recall
    let res = await post('/api/studio/advance', { fromStage: 'focus' });
    expect((await res.json()).session?.stage).toBe('recall');
    // 重复 focus 提交 no-op
    res = await post('/api/studio/advance', { fromStage: 'focus' });
    expect((await res.json()).session?.stage).toBe('recall');

    // recall → quiz
    res = await post('/api/studio/advance', { fromStage: 'recall' });
    expect((await res.json()).session?.stage).toBe('quiz');

    // quiz → feedback（带 grade）
    res = await post('/api/studio/advance', {
      fromStage: 'quiz',
      grade: { quizId: 'q1', score: 80, total: 5, correct: 4, correlationId: 'corr_1' },
    });
    const feedback = await res.json();
    expect(feedback.session?.stage).toBe('feedback');

    // feedback → reflect
    res = await post('/api/studio/advance', { fromStage: 'feedback' });
    const reflect = await res.json();
    expect(reflect.session?.stage).toBe('reflect');
    expect(reflect.reflect?.summary.answeredQuestions).toBe(5);

    // complete
    res = await post('/api/studio/complete', {});
    const done = await res.json();
    expect(done.session?.status).toBe('completed');

    // 事件日志包含 3 类 study_session 事件
    const events = await loadEvents(path.join(TEST_DIR, 'event_log', 'events.jsonl'));
    const actions = events.map((e) => e.action);
    expect(actions).toContain('study_session_started');
    expect(actions).toContain('study_stage_completed');
    expect(actions).toContain('study_session_completed');

    // session_history 有 1 条记录，GET /api/sessions 返回
    const sr = await get('/api/sessions');
    const sdata = await sr.json();
    expect(sdata.sessions).toHaveLength(1);
    expect(sdata.totals.sessionCount).toBe(1);
    expect(sdata.sessions[0].nodeName).toBe('需求曲线');

    // complete 联动 streak：连续 1 天、未到里程碑、companion 档
    expect(done.buddy?.streakDays).toBe(1);
    expect(done.buddy?.milestoneHit).toBe(false);
    expect(done.buddy?.activity).toBe('companion');
  });

  it('无 pending 任务时 start 返回 400', async () => {
    // 把今天任务全部改为已完成状态再调用（进度文件）
    await fs.mkdir(path.join(TEST_DIR, 'tasks'), { recursive: true });
    await fs.writeFile(
      path.join(TEST_DIR, 'tasks', `${TODAY}_progress.json`),
      JSON.stringify({
        date: TODAY,
        completions: [
          { taskId: 'task_2026-08-11_0', status: 'done', completedAt: new Date().toISOString() },
          { taskId: 'task_2026-08-11_1', status: 'done', completedAt: new Date().toISOString() },
        ],
      })
    );
    const res = await post('/api/studio/start', {});
    expect(res.status).toBe(400);
  });
});
