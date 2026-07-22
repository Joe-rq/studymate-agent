import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../src/server/app.js';
import http from 'http';
import type { AddressInfo } from 'net';

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
