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
