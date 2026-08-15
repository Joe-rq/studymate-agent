import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../src/server/app.js';
import http from 'http';
import type { AddressInfo } from 'net';
import fs from 'fs/promises';
import path from 'path';

describe('API server', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = createApp();
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

  async function get(path: string) {
    const res = await fetch(`${baseUrl}${path}`);
    return res;
  }

  async function post(path: string, body?: unknown) {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return res;
  }

  it('GET /api/status returns status object', async () => {
    const res = await get('/api/status');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('daysToExam');
    expect(data).toHaveProperty('avgMastery');
    expect(data).toHaveProperty('streakDays');
  });

  it('GET /api/plan/today returns plan object', async () => {
    const res = await get('/api/plan/today');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('date');
    expect(data).toHaveProperty('tasks');
  });

  it('GET /api/concepts returns concept map', async () => {
    const res = await get('/api/concepts');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('concepts');
    expect(data).toHaveProperty('learningOrder');
  });

  it('GET /api/buddy/state returns buddy state', async () => {
    const res = await get('/api/buddy/state');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('state');
    expect(data.state).toHaveProperty('characterId');
    expect(data.state).toHaveProperty('streakDays');
    expect(data).toHaveProperty('activity');
  });

  it('GET /api/characters returns character list', async () => {
    const res = await get('/api/characters');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('characters');
    expect(Array.isArray(data.characters)).toBe(true);
  });

  it('GET /api/metrics returns metrics object', async () => {
    const res = await get('/api/metrics');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('planCompletionRate');
    expect(data).toHaveProperty('knowledgeRetention');
  });

  it('GET /api/weakness returns weakness profile', async () => {
    const res = await get('/api/weakness');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('profile');
    expect(data).toHaveProperty('explanations');
  });

  it('POST /api/buddy/chat with empty message returns 400', async () => {
    const res = await post('/api/buddy/chat', { message: '' });
    expect(res.status).toBe(400);
  });

  it('POST /api/buddy/preferences updates prefs', async () => {
    const res = await post('/api/buddy/preferences', {
      reminderIntensity: 'gentle',
      emotionalStyle: 'playful',
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.preferences.reminderIntensity).toBe('gentle');
    expect(data.preferences.emotionalStyle).toBe('playful');
  });
});

describe('API daily task contract', () => {
  const testRoot = path.join(process.cwd(), 'workspace_test_api_tasks');
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    await fs.rm(testRoot, { recursive: true, force: true });
    await fs.mkdir(path.join(testRoot, 'plan', 'plan_daily'), { recursive: true });
    await fs.mkdir(path.join(testRoot, 'graph'), { recursive: true });
    await fs.writeFile(
      path.join(testRoot, 'plan', 'plan_daily', '2026-07-22.json'),
      JSON.stringify({
        date: '2026-07-22',
        tasks: [{ type: 'learn', nodeId: 'node_1', duration: 30 }],
      }),
      'utf-8'
    );
    await fs.writeFile(
      path.join(testRoot, 'graph', 'concepts.json'),
      JSON.stringify({ concepts: [{ id: 'node_1', name: '供给' }] }),
      'utf-8'
    );

    const app = createApp({
      workspaceRoot: testRoot,
      today: () => '2026-07-22',
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
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  it('returns actionable task IDs and reflects completion after refresh', async () => {
    const initial = await fetch(`${baseUrl}/api/plan/today`);
    const initialBody = await initial.json();
    expect(initialBody.tasks).toEqual([
      {
        id: 'task_2026-07-22_0',
        type: 'learn',
        nodeId: 'node_1',
        nodeName: '供给',
        duration: 30,
        status: 'pending',
      },
    ]);

    const completed = await fetch(`${baseUrl}/api/task/task_2026-07-22_0/done`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(completed.status).toBe(200);

    const refreshed = await fetch(`${baseUrl}/api/plan/today`);
    const refreshedBody = await refreshed.json();
    expect(refreshedBody.tasks[0].status).toBe('done');
  });
});

describe('API plan generation contract', () => {
  const testRoot = path.join(process.cwd(), 'workspace_test_api_plan');
  let server: http.Server;
  let baseUrl: string;
  const today = new Date().toISOString().split('T')[0];

  function futureDate(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
  }

  beforeAll(async () => {
    await fs.rm(testRoot, { recursive: true, force: true });
    await fs.mkdir(path.join(testRoot, 'graph'), { recursive: true });
    // 40 个概念、每天 60 分钟、14 天 —— 容量必然不足，缺口必须被结构化返回
    const concepts = Array.from({ length: 40 }, (_, i) => ({
      id: `node_${i + 1}`,
      name: `概念 ${i + 1}`,
      definition: '',
      prerequisiteIds: [],
      relatedChunks: ['chunk_001'],
      mastery: 0,
    }));
    await fs.writeFile(
      path.join(testRoot, 'graph', 'concepts.json'),
      JSON.stringify({ concepts, learningOrder: concepts.map((c) => c.id) }),
      'utf-8'
    );

    const app = createApp({ workspaceRoot: testRoot, today: () => today });
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
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  it('POST /api/plan/generate 返回 capacity 缺口报告', async () => {
    const res = await fetch(`${baseUrl}/api/plan/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ examDate: futureDate(14), dailyMinutes: 60 }),
    });
    expect(res.status).toBe(200);
    const plan = await res.json();

    expect(plan.capacity).toBeDefined();
    expect(plan.capacity.scheduledConceptCount).toBeGreaterThan(0);
    expect(plan.capacity.unscheduledConceptIds.length).toBeGreaterThan(0);

    // 排入的概念 + 未排入的概念 = 全部 40 个，无静默丢失
    const learnIds = new Set(
      plan.schedule.flatMap((d: { tasks: Array<{ type: string; nodeId: string }> }) =>
        d.tasks.filter((t) => t.type === 'learn').map((t) => t.nodeId)
      )
    );
    expect(learnIds.size + plan.capacity.unscheduledConceptIds.length).toBe(40);
  });
});
