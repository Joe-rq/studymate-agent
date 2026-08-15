import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../src/server/app.js';
import http from 'http';
import type { AddressInfo } from 'net';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { createMockLLMClient } from '../../src/core/mock_llm.js';
import { todayDateKey } from '../../src/core/date.js';
import type { UserAnswer } from '../../src/agents/grader.js';
import type { Quiz } from '../../src/agents/quiz_generator.js';

const TEST_DIR = path.join(process.cwd(), 'workspace_test_isolation');
const DEFAULT_DIR = path.join(process.cwd(), 'workspace');

// 五个写 API 的数据落盘目标。若 workspaceRoot 漏传，污染的正是默认 workspace 的这些路径。
// 注意：不含 event_log —— 事件日志路径始终显式传 P.eventLog（已随 workspaceRoot 解析），
// 不是漏写向量；且其他使用默认 root 的测试（如 api.test.ts）会并发追加默认 event_log，纳入会引入竞态。
const WATCH_PATHS = [
  'research',
  'plan',
  'quizzes',
  'results',
  'mistakes',
  'progress',
  'exam.json',
];

function futureDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function examJSON(status: string): unknown {
  return {
    id: 'exam_isolation',
    name: '隔离测试考试',
    examDate: futureDate(30),
    subjects: ['经济学基础'],
    learnerProfile: { baseline: 'intermediate', dailyMinutes: 60, unavailableDates: [] },
    status,
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

const CONCEPTS = {
  concepts: [
    { id: 'node_1', name: '需求曲线', definition: '价格与需求量的关系曲线', prerequisiteIds: [], relatedChunks: ['chk_1'], mastery: 0 },
    { id: 'node_2', name: '供给曲线', definition: '价格与供给量的关系曲线', prerequisiteIds: [], relatedChunks: ['chk_1'], mastery: 0 },
  ],
  learningOrder: ['node_1', 'node_2'],
};

const SOURCES = JSON.stringify({ id: 'src_1', title: '官方考纲', sourceType: 'official' }) + '\n';

/** 递归收集目录树下每个文件的相对路径 → 内容 sha256。路径不存在时返回空 map。 */
async function walkFiles(abs: string, rel = ''): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let st;
  try {
    st = await fs.stat(abs);
  } catch {
    return map;
  }
  if (st.isFile()) {
    const content = await fs.readFile(abs);
    map.set(rel, crypto.createHash('sha256').update(content).digest('hex'));
  } else if (st.isDirectory()) {
    for (const name of await fs.readdir(abs)) {
      const sub = await walkFiles(path.join(abs, name), rel ? `${rel}/${name}` : name);
      for (const [k, v] of sub) map.set(k, v);
    }
  }
  return map;
}

async function snapshotFiles(root: string, relPaths: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const rel of relPaths) {
    const files = await walkFiles(path.join(root, rel));
    for (const [sub, hash] of files) {
      out[sub ? `${rel}/${sub}` : rel] = hash;
    }
  }
  return out;
}

describe('Workspace 隔离：写 API 不得污染默认 workspace', () => {
  let server: http.Server;
  let baseUrl: string;
  let before: Record<string, string>;

  beforeAll(async () => {
    // 记录默认 workspace 关键写路径的初始哈希
    before = await snapshotFiles(DEFAULT_DIR, WATCH_PATHS);

    // 准备临时 workspace：概念 + 来源 + exam（researched 状态）
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(path.join(TEST_DIR, 'graph'), { recursive: true });
    await fs.mkdir(path.join(TEST_DIR, 'research'), { recursive: true });
    await fs.writeFile(path.join(TEST_DIR, 'graph', 'concepts.json'), JSON.stringify(CONCEPTS), 'utf-8');
    await fs.writeFile(path.join(TEST_DIR, 'research', 'sources.jsonl'), SOURCES, 'utf-8');
    await fs.writeFile(path.join(TEST_DIR, 'exam.json'), JSON.stringify(examJSON('researched')), 'utf-8');

    const app = createApp({
      workspaceRoot: TEST_DIR,
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
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  async function post(p: string, body?: unknown) {
    return fetch(`${baseUrl}${p}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  it('五个写 API 全部落到临时目录，默认 workspace 哈希不变', async () => {
    // 1) 来源确认（researched → sources_approved）
    const approve = await post('/api/exam/sources/approve', { ids: ['src_1'] });
    expect(approve.status).toBe(200);

    // 2) 计划生成（需 materials_ready 才推进到 planned）
    await fs.writeFile(path.join(TEST_DIR, 'exam.json'), JSON.stringify(examJSON('materials_ready')), 'utf-8');
    const planRes = await post('/api/plan/generate', { examDate: futureDate(30), dailyMinutes: 60 });
    expect(planRes.status).toBe(200);

    // 3) 计划确认（planned → active）
    const approvePlanRes = await post('/api/plan/approve');
    expect(approvePlanRes.status).toBe(200);

    // 4) 测验生成
    const quizRes = await post('/api/quiz/generate');
    expect(quizRes.status).toBe(200);
    const quiz = (await quizRes.json()) as Quiz;

    // 5) 普通批改（正确作答）
    const answers: UserAnswer[] = quiz.questions.map((q) => ({ questionId: q.id, answer: q.answer }));
    const gradeRes = await post('/api/grade', { answers });
    expect(gradeRes.status).toBe(200);

    // 产物只出现在临时目录
    const today = todayDateKey();
    for (const rel of [
      'research/approved_sources.json',
      'plan/plan_master.json',
      `quizzes/${today}_quiz.json`,
      'progress/mastery_history.jsonl',
    ]) {
      await expect(fs.readFile(path.join(TEST_DIR, rel), 'utf-8')).resolves.toBeTruthy();
    }
    const resultsFiles = await fs.readdir(path.join(TEST_DIR, 'results'));
    expect(resultsFiles.length).toBeGreaterThan(0);

    // 默认 workspace 关键写目标路径前后一致（无新增、无删除、内容未变）
    const after = await snapshotFiles(DEFAULT_DIR, WATCH_PATHS);
    expect(after).toEqual(before);
  });
});
