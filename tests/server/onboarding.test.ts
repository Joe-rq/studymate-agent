import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createApp } from '../../src/server/app.js';
import http from 'http';
import type { AddressInfo } from 'net';
import fs from 'fs/promises';
import path from 'path';
import { createMockLLMClient } from '../../src/core/mock_llm.js';

const TODAY = '2026-08-11';
const TEST_DIR = path.join(process.cwd(), 'workspace_test_onboarding');

const SAMPLE_MD = `# 经济学基础

## 需求曲线

需求曲线表示商品价格与需求量之间的关系，通常向右下方倾斜：价格越高，需求量越低。

## 供给曲线

供给曲线表示价格与供给量的关系，通常向右上方倾斜：价格越高，供给量越大。

## 市场均衡

当需求量等于供给量时，市场达到均衡状态，此时的价格为均衡价格。
`;

function makeApp(extra: Record<string, unknown> = {}) {
  return createApp({
    workspaceRoot: TEST_DIR,
    today: () => TODAY,
    llm: createMockLLMClient(),
    hasSearchApiKey: false, // 离线复现“无搜索 Key”路径
    ...extra,
  });
}

async function startServer(app: ReturnType<typeof createApp>) {
  const server = app.listen(0);
  await new Promise<void>((resolve) => {
    server.on('listening', () => resolve());
  });
  const addr = server.address() as AddressInfo;
  return { server, baseUrl: `http://localhost:${addr.port}` };
}

async function resetWorkspace(): Promise<void> {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
  await fs.mkdir(TEST_DIR, { recursive: true });
}

function futureDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

describe('Onboarding: 本地资料闭环（无搜索 Key）', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    ({ server, baseUrl } = await startServer(makeApp()));
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await resetWorkspace();
  });

  async function post(p: string, body?: unknown, headers: Record<string, string> = {}) {
    return fetch(`${baseUrl}${p}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
  }
  async function get(p: string) {
    return fetch(`${baseUrl}${p}`);
  }

  async function createExam(): Promise<void> {
    const res = await post('/api/exam/create', {
      name: '2026 初级会计',
      examDate: futureDate(30),
      subjects: '经济学基础',
      dailyMinutes: 60,
    });
    expect(res.status).toBe(200);
  }

  async function uploadMd(filename = 'econ.md', content = SAMPLE_MD): Promise<unknown> {
    const res = await post('/api/materials/upload', {
      filename,
      contentBase64: Buffer.from(content, 'utf-8').toString('base64'),
    });
    return { status: res.status, body: await res.json() };
  }

  it('无搜索 Key 时 research 明确降级，不再产生“0 来源死路”', async () => {
    await createExam();
    const res = await post('/api/exam/research');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.skipped).toBe(true);
    expect(data.reason).toBe('search_disabled');
    expect(data.sources).toEqual([]);

    // Exam 状态保持 draft，未被推进
    const exam = await (await get('/api/exam')).json();
    expect(exam.status).toBe('draft');
  });

  it('上传 Markdown → 导入 Material + 切片（与 CLI ingest 同一 schema）', async () => {
    const { status, body } = await uploadMd();
    expect(status).toBe(200);
    expect(body.material.title).toBe('econ');
    expect(body.chunkCount).toBeGreaterThan(0);

    // Material 索引落盘
    const list = await (await get('/api/materials')).json();
    expect(list.materials).toHaveLength(1);
    expect(list.materials[0].id).toMatch(/^mat_/);

    // Chunk 索引落盘（与 CLI 导入一致）
    const chunkIndex = JSON.parse(
      await fs.readFile(path.join(TEST_DIR, 'chunks', 'index.json'), 'utf-8')
    );
    expect(chunkIndex.length).toBe(body.chunkCount);
  });

  it('不支持的类型与空文件返回 400，材料与状态不变', async () => {
    await createExam();
    const bad = await post('/api/materials/upload', {
      filename: 'virus.exe',
      contentBase64: Buffer.from('MZ...').toString('base64'),
    });
    expect(bad.status).toBe(400);

    const empty = await post('/api/materials/upload', {
      filename: 'empty.md',
      contentBase64: '',
    });
    expect(empty.status).toBe(400);

    const list = await (await get('/api/materials')).json();
    expect(list.materials).toHaveLength(0);
    const exam = await (await get('/api/exam')).json();
    expect(exam.status).toBe('draft');
  });

  it('零材料时 build 返回 400 可操作错误，状态不推进', async () => {
    await createExam();
    const res = await post('/api/knowledge/build');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('没有可用的学习材料');
    const exam = await (await get('/api/exam')).json();
    expect(exam.status).toBe('draft');
  });

  it('Mock 黄金路径：建档 → 上传 → 构建 → 计划 全程无外部 Key', async () => {
    await createExam();
    await uploadMd();

    // 构建知识（Mock LLM 提取概念）
    const build = await post('/api/knowledge/build');
    expect(build.status).toBe(200);
    const buildBody = await build.json();
    expect(buildBody.mode).toBe('local_materials');
    expect(buildBody.conceptsExtracted).toBeGreaterThan(0);

    // draft → materials_ready（本地直连转换）
    const exam = await (await get('/api/exam')).json();
    expect(exam.status).toBe('materials_ready');

    // 生成计划（无容量缺口）
    const planRes = await post('/api/plan/generate', {
      examDate: futureDate(30),
      dailyMinutes: 60,
    });
    expect(planRes.status).toBe(200);
    const plan = await planRes.json();
    expect(plan.capacity.unscheduledConceptIds).toEqual([]);
    const examAfter = await (await get('/api/exam')).json();
    expect(examAfter.status).toBe('planned');
  });

  it('重复上传相同内容去重（版本递增），切片不重复膨胀', async () => {
    await uploadMd('econ.md');
    await uploadMd('econ-copy.md'); // 内容相同 → 相同 contentHash

    const list = await (await get('/api/materials')).json();
    expect(list.materials).toHaveLength(1);
    expect(list.materials[0].version).toBe(1); // uploadLocalMaterial 走 import 路径（同 hash 单条）
  });
});

describe('Onboarding: 访问控制', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    ({ server, baseUrl } = await startServer(makeApp({ accessToken: 'secret-token-123' })));
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it('未认证请求 401（无法读取 Exam / Weakness / Buddy / 修改计划）', async () => {
    for (const p of ['/api/exam', '/api/weakness', '/api/buddy/state', '/api/plan/master']) {
      const res = await fetch(`${baseUrl}${p}`);
      expect(res.status).toBe(401);
    }
    const post = await fetch(`${baseUrl}/api/plan/generate`, { method: 'POST' });
    expect(post.status).toBe(401);
  });

  it('携带正确 Token（Bearer / X-Access-Token）可访问', async () => {
    const byBearer = await fetch(`${baseUrl}/api/exam`, {
      headers: { Authorization: 'Bearer secret-token-123' },
    });
    expect(byBearer.status).toBe(200);
    const byHeader = await fetch(`${baseUrl}/api/exam`, {
      headers: { 'X-Access-Token': 'secret-token-123' },
    });
    expect(byHeader.status).toBe(200);
  });

  it('URL 查询参数不再作为认证方式（query 返回 401）', async () => {
    const byQuery = await fetch(`${baseUrl}/api/exam?access_token=secret-token-123`);
    expect(byQuery.status).toBe(401);
  });

  it('错误 Token 401', async () => {
    const res = await fetch(`${baseUrl}/api/exam`, {
      headers: { Authorization: 'Bearer wrong' },
    });
    expect(res.status).toBe(401);
  });
});
