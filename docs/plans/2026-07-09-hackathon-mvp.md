# 智能备考 Agent 黑客松 MVP 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在两天内实现一个可演示的终端 CLI 版智能备考 Agent，支持 `init → ingest → plan → today → quiz → grade` 核心闭环，所有状态通过事件日志管理。

**架构：** 采用 12-Factor Agents 风格，LLM 输出结构化决策 JSON，代码控制流路由；所有状态存储在本地 Markdown/JSON 文件中，以 `workspace/event_log/events.jsonl` 为单一事实来源。

**Tech Stack：** TypeScript + Node.js 20 + Commander.js（CLI）+ pdf-parse（PDF 解析）+ Vitest（测试）+ OpenAI-compatible API（LLM）。

---

## 开发原则

- **YAGNI**：只做黑客松 Demo 必需的 6 个命令
- **TDD**：每个核心函数先写测试再实现
- **频繁提交**：每个 Task 完成后 `git commit`
- **本地优先**：所有数据存在 `workspace/`，不上传 Git

---

## Task 1: 初始化项目骨架

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/cli.ts`
- Create: `src/index.ts`
- Create: `README.md`

**Step 1: 创建 package.json**

```json
{
  "name": "studymate-agent",
  "version": "0.1.0",
  "description": "AI-powered personal exam preparation agent",
  "type": "module",
  "main": "dist/index.js",
  "bin": {
    "studymate": "dist/cli.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "smoke": "npm run build && node dist/cli.js --help"
  },
  "dependencies": {
    "commander": "^12.1.0",
    "pdf-parse": "^1.1.1"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "@types/pdf-parse": "^1.1.4",
    "typescript": "^5.5.0",
    "vitest": "^1.6.0"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

**Step 2: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "workspace"]
}
```

**Step 3: 创建 vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
});
```

**Step 4: 创建 src/cli.ts（CLI 入口）**

```typescript
#!/usr/bin/env node
import { program } from 'commander';

program
  .name('studymate')
  .description('AI-powered personal exam preparation agent')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize workspace')
  .action(() => {
    console.log('init: TODO');
  });

program.parse();
```

**Step 5: 创建 src/index.ts（库入口，空）**

```typescript
export {};
```

**Step 6: 创建 README.md（简要说明）**

```markdown
# StudyMate Agent

AI-powered personal exam preparation agent.

## Quick Start

```bash
npm install
npm run build
./dist/cli.js init
./dist/cli.js ingest ./materials/sample.pdf
./dist/cli.js plan --exam 2026-09-15 --daily 60
./dist/cli.js today
./dist/cli.js quiz
./dist/cli.js grade --answers answers.json
```
```

**Step 7: 安装依赖**

Run: `npm install`
Expected: `node_modules/` created, no errors.

**Step 8: 构建并测试 CLI**

Run: `npm run smoke`
Expected: 输出 CLI help 信息。

**Step 9: 提交**

```bash
git add .
git commit -m "chore: initialize project skeleton with TypeScript, Commander, Vitest"
```

---

## Task 2: 实现事件日志基础设施

**Files:**
- Create: `src/core/event_log.ts`
- Create: `src/core/types.ts`
- Test: `tests/core/event_log.test.ts`

**Step 1: 创建 src/core/types.ts**

```typescript
export interface Event {
  id: string;
  timestamp: string;
  agent: string;
  action: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
}

export interface AppState {
  materials: Record<string, unknown>;
  chunks: Record<string, unknown>;
  concepts: Record<string, unknown>;
  plan: Record<string, unknown>;
  tasks: Record<string, unknown>;
  quizzes: Record<string, unknown>;
  results: Record<string, unknown>;
  mistakes: Record<string, unknown>;
  progress: Record<string, unknown>;
}
```

**Step 2: 写失败测试 tests/core/event_log.test.ts**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { appendEvent, loadEvents, createEventId } from '../../src/core/event_log.js';
import fs from 'fs/promises';
import path from 'path';

const TEST_LOG_DIR = path.join(process.cwd(), 'workspace_test');
const TEST_LOG_FILE = path.join(TEST_LOG_DIR, 'event_log', 'events.jsonl');

describe('event_log', () => {
  beforeEach(async () => {
    await fs.rm(TEST_LOG_DIR, { recursive: true, force: true });
  });

  it('should create event log directory and file', async () => {
    await appendEvent(TEST_LOG_FILE, {
      id: createEventId(),
      timestamp: new Date().toISOString(),
      agent: 'test',
      action: 'test_action',
      input: {},
      output: { ok: true },
    });
    const events = await loadEvents(TEST_LOG_FILE);
    expect(events).toHaveLength(1);
    expect(events[0].output).toEqual({ ok: true });
  });
});
```

Run: `npx vitest run tests/core/event_log.test.ts`
Expected: FAIL，函数未定义。

**Step 3: 实现 src/core/event_log.ts**

```typescript
import fs from 'fs/promises';
import path from 'path';
import type { Event } from './types.js';

export function createEventId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function appendEvent(logFile: string, event: Event): Promise<void> {
  const dir = path.dirname(logFile);
  await fs.mkdir(dir, { recursive: true });
  const line = JSON.stringify(event) + '\n';
  await fs.appendFile(logFile, line, 'utf-8');
}

export async function loadEvents(logFile: string): Promise<Event[]> {
  try {
    const content = await fs.readFile(logFile, 'utf-8');
    return content
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return [];
    throw err;
  }
}
```

**Step 4: 运行测试**

Run: `npx vitest run tests/core/event_log.test.ts`
Expected: PASS。

**Step 5: 提交**

```bash
git add .
git commit -m "feat(core): add event log append/load with tests"
```

---

## Task 3: 实现 workspace 初始化和路径工具

**Files:**
- Create: `src/core/paths.ts`
- Create: `src/core/workspace.ts`
- Test: `tests/core/workspace.test.ts`

**Step 1: 创建 src/core/paths.ts**

```typescript
import path from 'path';

export const WORKSPACE_ROOT = path.join(process.cwd(), 'workspace');

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
} as const;
```

**Step 2: 创建 src/core/workspace.ts**

```typescript
import fs from 'fs/promises';
import { Paths } from './paths.js';

export async function initWorkspace(): Promise<void> {
  const dirs = Object.values(Paths).filter((p) => !p.endsWith('.jsonl'));
  for (const dir of dirs) {
    await fs.mkdir(dir, { recursive: true });
  }
}
```

**Step 3: 写测试 tests/core/workspace.test.ts**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { initWorkspace } from '../../src/core/workspace.js';
import { Paths } from '../../src/core/paths.js';
import fs from 'fs/promises';
import path from 'path';

describe('workspace', () => {
  beforeEach(async () => {
    await fs.rm(Paths.workspace, { recursive: true, force: true });
  });

  it('should create all workspace directories', async () => {
    await initWorkspace();
    for (const p of Object.values(Paths)) {
      if (p.endsWith('.jsonl')) continue;
      const stat = await fs.stat(p);
      expect(stat.isDirectory()).toBe(true);
    }
  });
});
```

Run: `npx vitest run tests/core/workspace.test.ts`
Expected: PASS。

**Step 4: 绑定 init 命令到 CLI**

修改 `src/cli.ts`：

```typescript
import { initWorkspace } from './core/workspace.js';

program
  .command('init')
  .description('Initialize workspace')
  .action(async () => {
    await initWorkspace();
    console.log('Workspace initialized at ./workspace');
  });
```

Run: `npm run build && node dist/cli.js init`
Expected: 输出 `Workspace initialized at ./workspace`。

**Step 5: 提交**

```bash
git add .
git commit -m "feat(cli): add init command and workspace directory structure"
```

---

## Task 4: 实现 LLM 客户端

**Files:**
- Create: `src/core/llm.ts`
- Test: `tests/core/llm.test.ts`

**Step 1: 创建 src/core/llm.ts**

```typescript
export interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMClient {
  complete(system: string, user: string, options?: LLMOptions): Promise<string>;
  completeJSON<T>(system: string, user: string, options?: LLMOptions): Promise<T>;
}

export function createLLMClient(): LLMClient {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseURL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const model = process.env.LLM_MODEL || 'gpt-4o-mini';

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is required');
  }

  return {
    async complete(system, user, options = {}) {
      const res = await fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: options.model || model,
          temperature: options.temperature ?? 0.5,
          max_tokens: options.maxTokens ?? 2048,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`LLM API error: ${res.status} ${text}`);
      }

      const data = await res.json();
      return data.choices[0].message.content;
    },

    async completeJSON<T>(system, user, options = {}) {
      const content = await this.complete(
        `${system}\n\nYou must respond with valid JSON only. No markdown, no explanation.`,
        user,
        options
      );
      const cleaned = content.replace(/```json\s*|\s*```/g, '').trim();
      return JSON.parse(cleaned) as T;
    },
  };
}
```

**Step 2: 写测试（mock fetch）**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLLMClient } from '../../src/core/llm.js';

describe('llm', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.OPENAI_BASE_URL = 'https://test.local/v1';
    vi.stubGlobal('fetch', vi.fn());
  });

  it('should call API and return content', async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'hello' } }],
      }),
    });

    const client = createLLMClient();
    const result = await client.complete('system', 'user');
    expect(result).toBe('hello');
    expect(mockFetch).toHaveBeenCalledOnce();
  });
});
```

Run: `npx vitest run tests/core/llm.test.ts`
Expected: PASS。

**Step 3: 提交**

```bash
git add .
git commit -m "feat(core): add OpenAI-compatible LLM client with tests"
```

---

## Task 5: 实现 MaterialCollector Agent（PDF 导入）

**Files:**
- Create: `src/agents/material_collector.ts`
- Test: `tests/agents/material_collector.test.ts`
- 需要示例 PDF：`workspace/materials/sample.pdf`（可先用一个占位文本文件模拟）

**Step 1: 创建 src/agents/material_collector.ts**

```typescript
import fs from 'fs/promises';
import path from 'path';
import pdfParse from 'pdf-parse';
import type { Event } from '../core/types.js';
import { createEventId, appendEvent } from '../core/event_log.js';
import { Paths } from '../core/paths.js';

export interface Material {
  id: string;
  source: string;
  type: 'pdf' | 'webpage';
  title: string;
  contentPath: string;
  meta: {
    capturedAt: string;
    wordCount: number;
  };
}

export async function importPDF(
  pdfPath: string,
  eventLogFile: string
): Promise<Material> {
  const buffer = await fs.readFile(pdfPath);
  const parsed = await pdfParse(buffer);
  const title = path.basename(pdfPath, path.extname(pdfPath));
  const safeTitle = `${new Date().toISOString().split('T')[0]}_${title}.md`;
  const contentPath = path.join(Paths.materials, safeTitle);

  await fs.mkdir(Paths.materials, { recursive: true });
  await fs.writeFile(contentPath, `# ${title}\n\n${parsed.text}`, 'utf-8');

  const material: Material = {
    id: `mat_${Date.now()}`,
    source: pdfPath,
    type: 'pdf',
    title,
    contentPath,
    meta: {
      capturedAt: new Date().toISOString(),
      wordCount: parsed.text.split(/\s+/).length,
    },
  };

  const event: Event = {
    id: createEventId(),
    timestamp: new Date().toISOString(),
    agent: 'material_collector',
    action: 'material_imported',
    input: { pdfPath },
    output: { materialId: material.id, contentPath },
  };

  await appendEvent(eventLogFile, event);
  return material;
}
```

**Step 2: 写测试**

由于 pdf-parse 需要真实 PDF，测试时创建一个临时文本文件并用 `importPDF` 的变体或跳过 PDF 解析。更简单：测试文件写入和事件记录。

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { importPDF } from '../../src/agents/material_collector.js';
import fs from 'fs/promises';
import path from 'path';

const TEST_DIR = path.join(process.cwd(), 'workspace_test_material');
const TEST_PDF = path.join(TEST_DIR, 'sample.pdf');
const TEST_LOG = path.join(TEST_DIR, 'event_log', 'events.jsonl');

describe('material_collector', () => {
  beforeEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(TEST_DIR, { recursive: true });
  });

  it('should reject non-existent file', async () => {
    await expect(importPDF('/nonexistent.pdf', TEST_LOG)).rejects.toThrow();
  });
});
```

Run: `npx vitest run tests/agents/material_collector.test.ts`
Expected: PASS。

**Step 3: 绑定 ingest 命令**

修改 `src/cli.ts`：

```typescript
import { importPDF } from './agents/material_collector.js';
import { Paths } from './core/paths.js';

program
  .command('ingest')
  .description('Import a PDF file')
  .argument('<file>', 'PDF file path')
  .action(async (file: string) => {
    const material = await importPDF(file, Paths.eventLog);
    console.log(`Imported: ${material.title}`);
    console.log(`Saved to: ${material.contentPath}`);
  });
```

**Step 4: 提交**

```bash
git add .
git commit -m "feat(agent): add material_collector PDF import with CLI binding"
```

---

## Task 6: 实现 Chunker Agent（语义切片）

**Files:**
- Create: `src/agents/chunker.ts`
- Test: `tests/agents/chunker.test.ts`

**Step 1: 创建 src/agents/chunker.ts**

```typescript
import fs from 'fs/promises';
import path from 'path';
import type { Event } from '../core/types.js';
import { createEventId, appendEvent } from '../core/event_log.js';
import { Paths } from '../core/paths.js';

export interface Chunk {
  id: string;
  materialId: string;
  title: string;
  content: string;
  chapterPath: string;
  concepts: string[];
  sourceLink: string;
}

export async function chunkMaterial(
  material: { id: string; contentPath: string; title: string },
  eventLogFile: string
): Promise<Chunk[]> {
  const content = await fs.readFile(material.contentPath, 'utf-8');
  const lines = content.split('\n');
  const chunks: Chunk[] = [];
  let currentChunk: { title: string; lines: string[]; level: number } | null = null;

  const flushChunk = () => {
    if (!currentChunk || currentChunk.lines.length === 0) return;
    chunks.push({
      id: `chunk_${chunks.length + 1}`,
      materialId: material.id,
      title: currentChunk.title,
      content: currentChunk.lines.join('\n').trim(),
      chapterPath: `${chunks.length}`,
      concepts: [],
      sourceLink: `${material.contentPath}`,
    });
  };

  for (const line of lines) {
    const headerMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headerMatch) {
      flushChunk();
      currentChunk = { title: headerMatch[2], lines: [line], level: headerMatch[1].length };
    } else if (currentChunk) {
      currentChunk.lines.push(line);
    }
  }
  flushChunk();

  await fs.mkdir(Paths.chunks, { recursive: true });
  for (const chunk of chunks) {
    const chunkPath = path.join(Paths.chunks, `${chunk.id}.md`);
    await fs.writeFile(chunkPath, `# ${chunk.title}\n\n${chunk.content}`, 'utf-8');
  }

  const event: Event = {
    id: createEventId(),
    timestamp: new Date().toISOString(),
    agent: 'chunker',
    action: 'chunks_generated',
    input: { materialId: material.id },
    output: { chunkCount: chunks.length, chunkIds: chunks.map((c) => c.id) },
  };
  await appendEvent(eventLogFile, event);

  return chunks;
}
```

**Step 2: 写测试**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { chunkMaterial } from '../../src/agents/chunker.js';
import fs from 'fs/promises';
import path from 'path';

const TEST_DIR = path.join(process.cwd(), 'workspace_test_chunker');
const TEST_LOG = path.join(TEST_DIR, 'event_log', 'events.jsonl');

describe('chunker', () => {
  beforeEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(TEST_DIR, { recursive: true });
  });

  it('should split markdown by headers', async () => {
    const materialPath = path.join(TEST_DIR, 'test.md');
    await fs.writeFile(
      materialPath,
      '# Title\n\nIntro\n\n## Section 1\n\nContent 1\n\n## Section 2\n\nContent 2',
      'utf-8'
    );

    const chunks = await chunkMaterial(
      { id: 'mat_1', contentPath: materialPath, title: 'Test' },
      TEST_LOG
    );
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].title).toBeDefined();
  });
});
```

Run: `npx vitest run tests/agents/chunker.test.ts`
Expected: PASS。

**Step 3: 绑定 ingest 命令自动 chunk（可选）**

修改 `src/cli.ts` 的 `ingest` 命令，导入后自动 chunk：

```typescript
import { chunkMaterial } from './agents/chunker.js';

program
  .command('ingest')
  .description('Import a PDF file and chunk it')
  .argument('<file>', 'PDF file path')
  .action(async (file: string) => {
    const material = await importPDF(file, Paths.eventLog);
    console.log(`Imported: ${material.title}`);
    const chunks = await chunkMaterial(material, Paths.eventLog);
    console.log(`Generated ${chunks.length} chunks`);
  });
```

**Step 4: 提交**

```bash
git add .
git commit -m "feat(agent): add chunker with header-based splitting"
```

---

## Task 7: 实现 ConceptMapper Agent（概念抽取）

**Files:**
- Create: `src/agents/concept_mapper.ts`
- Create: `src/prompts/concept_mapper.txt`
- Test: `tests/agents/concept_mapper.test.ts`

**Step 1: 创建 prompts 目录和提示词**

```text
You are an educational content analyzer. Given a list of study chunks, extract core concepts and their prerequisite relationships.

Return JSON in this exact format:
{
  "concepts": [
    {
      "id": "node_1",
      "name": "概念名称",
      "definition": "简短定义",
      "prerequisiteIds": []
    }
  ]
}

Rules:
- Extract 3-10 core concepts total
- Use ids like node_1, node_2
- A concept should have 0-2 prerequisites
- Keep definitions under 50 words
- Respond with JSON only
```

**Step 2: 创建 src/agents/concept_mapper.ts**

```typescript
import fs from 'fs/promises';
import path from 'path';
import type { Chunk } from './chunker.js';
import type { LLMClient } from '../core/llm.js';
import type { Event } from '../core/types.js';
import { createEventId, appendEvent } from '../core/event_log.js';
import { Paths } from '../core/paths.js';

export interface Concept {
  id: string;
  name: string;
  definition: string;
  prerequisiteIds: string[];
  relatedChunks: string[];
  mastery: number;
}

export interface ConceptMap {
  concepts: Concept[];
  learningOrder: string[];
}

export async function mapConcepts(
  chunks: Chunk[],
  llm: LLMClient,
  eventLogFile: string
): Promise<ConceptMap> {
  const promptPath = path.join(Paths.prompts, 'concept_mapper.txt');
  const system = await fs.readFile(promptPath, 'utf-8');
  const user = chunks.map((c) => `## ${c.title}\n${c.content.slice(0, 800)}`).join('\n\n');

  const raw = await llm.completeJSON<{ concepts: Array<{ id: string; name: string; definition: string; prerequisiteIds: string[] }> }>(
    system,
    user,
    { temperature: 0.3 }
  );

  const concepts: Concept[] = raw.concepts.map((c) => ({
    ...c,
    relatedChunks: chunks.filter((ch) => ch.title.includes(c.name) || ch.content.includes(c.name)).map((ch) => ch.id),
    mastery: 0,
  }));

  // Simple topological sort for learning order
  const visited = new Set<string>();
  const order: string[] = [];
  const visit = (id: string) => {
    if (visited.has(id)) return;
    const concept = concepts.find((c) => c.id === id);
    if (!concept) return;
    for (const pre of concept.prerequisiteIds) visit(pre);
    visited.add(id);
    order.push(id);
  };
  for (const c of concepts) visit(c.id);

  const conceptMap: ConceptMap = { concepts, learningOrder: order };

  await fs.mkdir(Paths.graph, { recursive: true });
  await fs.writeFile(path.join(Paths.graph, 'concepts.json'), JSON.stringify(conceptMap, null, 2), 'utf-8');

  const event: Event = {
    id: createEventId(),
    timestamp: new Date().toISOString(),
    agent: 'concept_mapper',
    action: 'concepts_mapped',
    input: { chunkCount: chunks.length },
    output: { conceptCount: concepts.length, learningOrder: order },
  };
  await appendEvent(eventLogFile, event);

  return conceptMap;
}
```

**Step 3: 写测试（使用 mock LLM）**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { mapConcepts } from '../../src/agents/concept_mapper.js';
import fs from 'fs/promises';
import path from 'path';

const TEST_DIR = path.join(process.cwd(), 'workspace_test_concept');
const TEST_LOG = path.join(TEST_DIR, 'event_log', 'events.jsonl');

const mockLLM = {
  complete: async () => '',
  completeJSON: async () => ({
    concepts: [
      { id: 'node_1', name: 'Supply', definition: 'Amount of goods', prerequisiteIds: [] },
      { id: 'node_2', name: 'Demand', definition: 'Desire for goods', prerequisiteIds: [] },
      { id: 'node_3', name: 'Equilibrium', definition: 'Balance point', prerequisiteIds: ['node_1', 'node_2'] },
    ],
  }),
};

describe('concept_mapper', () => {
  beforeEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it('should map concepts and produce learning order', async () => {
    const chunks = [
      { id: 'chunk_1', materialId: 'mat_1', title: 'Supply', content: 'Supply is...', chapterPath: '1', concepts: [], sourceLink: '' },
      { id: 'chunk_2', materialId: 'mat_1', title: 'Demand', content: 'Demand is...', chapterPath: '2', concepts: [], sourceLink: '' },
    ];
    const result = await mapConcepts(chunks, mockLLM as any, TEST_LOG);
    expect(result.concepts).toHaveLength(3);
    expect(result.learningOrder).toContain('node_3');
  });
});
```

Run: `npx vitest run tests/agents/concept_mapper.test.ts`
Expected: PASS。

**Step 4: 提交**

```bash
git add .
git commit -m "feat(agent): add concept mapper with LLM extraction"
```

---

## Task 8: 实现 Planner Agent（生成计划）

**Files:**
- Create: `src/agents/planner.ts`
- Test: `tests/agents/planner.test.ts`

**Step 1: 创建 src/agents/planner.ts**

```typescript
import fs from 'fs/promises';
import path from 'path';
import type { ConceptMap, Concept } from './concept_mapper.js';
import type { Event } from '../core/types.js';
import { createEventId, appendEvent } from '../core/event_log.js';
import { Paths } from '../core/paths.js';

export interface PlanConfig {
  examDate: string;
  dailyMinutes: number;
}

export interface DailyTask {
  type: 'learn' | 'review';
  nodeId: string;
  duration: number;
}

export interface DailyPlan {
  date: string;
  tasks: DailyTask[];
}

export interface StudyPlan {
  id: string;
  examDate: string;
  dailyMinutes: number;
  schedule: DailyPlan[];
}

export function generatePlan(
  conceptMap: ConceptMap,
  config: PlanConfig
): StudyPlan {
  const { concepts, learningOrder } = conceptMap;
  const examDate = new Date(config.examDate);
  const today = new Date();
  const totalDays = Math.max(1, Math.ceil((examDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));

  const schedule: DailyPlan[] = [];
  const reviewIntervals = [1, 3, 7, 15];

  // Assign each concept to a learn day
  const learnDayMap = new Map<string, number>();
  for (let i = 0; i < learningOrder.length; i++) {
    const day = Math.min(i, totalDays - 1);
    learnDayMap.set(learningOrder[i], day);
  }

  // Build daily tasks
  for (let d = 0; d < Math.min(totalDays, 14); d++) {
    const date = new Date(today);
    date.setDate(today.getDate() + d);
    const dateStr = date.toISOString().split('T')[0];
    const tasks: DailyTask[] = [];

    // Learn new concepts assigned to this day
    for (const nodeId of learningOrder) {
      if (learnDayMap.get(nodeId) === d) {
        tasks.push({ type: 'learn', nodeId, duration: 30 });
      }
    }

    // Review concepts from previous days
    for (const interval of reviewIntervals) {
      const reviewDay = d - interval;
      if (reviewDay < 0) continue;
      for (const nodeId of learningOrder) {
        if (learnDayMap.get(nodeId) === reviewDay) {
          tasks.push({ type: 'review', nodeId, duration: 15 });
        }
      }
    }

    // Limit by daily minutes
    let used = 0;
    const limitedTasks: DailyTask[] = [];
    for (const task of tasks) {
      if (used + task.duration <= config.dailyMinutes) {
        limitedTasks.push(task);
        used += task.duration;
      }
    }

    schedule.push({ date: dateStr, tasks: limitedTasks });
  }

  return {
    id: `plan_${Date.now()}`,
    examDate: config.examDate,
    dailyMinutes: config.dailyMinutes,
    schedule,
  };
}

export async function savePlan(
  plan: StudyPlan,
  eventLogFile: string
): Promise<void> {
  await fs.mkdir(Paths.plan, { recursive: true });
  await fs.mkdir(path.join(Paths.plan, 'plan_daily'), { recursive: true });

  await fs.writeFile(path.join(Paths.plan, 'plan_master.json'), JSON.stringify(plan, null, 2), 'utf-8');

  for (const day of plan.schedule) {
    await fs.writeFile(
      path.join(Paths.plan, 'plan_daily', `${day.date}.json`),
      JSON.stringify(day, null, 2),
      'utf-8'
    );
  }

  const event: Event = {
    id: createEventId(),
    timestamp: new Date().toISOString(),
    agent: 'planner',
    action: 'plan_generated',
    input: { examDate: plan.examDate, dailyMinutes: plan.dailyMinutes },
    output: { planId: plan.id, totalDays: plan.schedule.length },
  };
  await appendEvent(eventLogFile, event);
}
```

**Step 2: 写测试**

```typescript
import { describe, it, expect } from 'vitest';
import { generatePlan } from '../../src/agents/planner.js';

describe('planner', () => {
  it('should generate a schedule within daily minutes', () => {
    const conceptMap = {
      concepts: [
        { id: 'node_1', name: 'A', definition: '', prerequisiteIds: [], relatedChunks: [], mastery: 0 },
        { id: 'node_2', name: 'B', definition: '', prerequisiteIds: ['node_1'], relatedChunks: [], mastery: 0 },
      ],
      learningOrder: ['node_1', 'node_2'],
    };

    const examDate = new Date();
    examDate.setDate(examDate.getDate() + 7);
    const plan = generatePlan(conceptMap, { examDate: examDate.toISOString().split('T')[0], dailyMinutes: 60 });

    expect(plan.schedule.length).toBeGreaterThan(0);
    for (const day of plan.schedule) {
      const total = day.tasks.reduce((sum, t) => sum + t.duration, 0);
      expect(total).toBeLessThanOrEqual(60);
    }
  });
});
```

Run: `npx vitest run tests/agents/planner.test.ts`
Expected: PASS。

**Step 3: 绑定 plan 命令**

修改 `src/cli.ts`：

```typescript
import { generatePlan, savePlan } from './agents/planner.js';
import { mapConcepts } from './agents/concept_mapper.js';
import { chunkMaterial } from './agents/chunker.js';
import { importPDF } from './agents/material_collector.js';
import { createLLMClient } from './core/llm.js';

program
  .command('plan')
  .description('Generate study plan from imported materials')
  .requiredOption('--exam <date>', 'Exam date (YYYY-MM-DD)')
  .requiredOption('--daily <minutes>', 'Daily available minutes')
  .action(async (options: { exam: string; daily: string }) => {
    // For hackathon demo, assume last imported material
    const llm = createLLMClient();
    // This is simplified - in real code load material from event log
    console.log(`Generating plan for exam ${options.exam}, ${options.daily} min/day`);
  });
```

（注意：CLI 的 plan 命令完整实现放在后面 Task 11，这里先保证函数测试通过。）

**Step 4: 提交**

```bash
git add .
git commit -m "feat(agent): add Ebbinghaus-based planner with tests"
```

---

## Task 9: 实现 TaskDispatcher Agent（生成今日任务）

**Files:**
- Create: `src/agents/task_dispatcher.ts`
- Test: `tests/agents/task_dispatcher.test.ts`

**Step 1: 创建 src/agents/task_dispatcher.ts**

```typescript
import fs from 'fs/promises';
import path from 'path';
import type { DailyPlan } from './planner.js';
import type { Event } from '../core/types.js';
import { createEventId, appendEvent } from '../core/event_log.js';
import { Paths } from '../core/paths.js';

export interface TodoTask {
  id: string;
  type: 'learn' | 'review';
  nodeId: string;
  duration: number;
  status: 'pending' | 'done' | 'skipped';
}

export async function dispatchToday(
  plan: DailyPlan,
  eventLogFile: string
): Promise<TodoTask[]> {
  const tasks: TodoTask[] = plan.tasks.map((t, idx) => ({
    id: `task_${plan.date}_${idx}`,
    ...t,
    status: 'pending',
  }));

  const markdown = `# ${plan.date} 学习任务\n\n` +
    tasks.map((t) => `- [ ] **${t.type === 'learn' ? '学习' : '复习'}** ${t.nodeId}（${t.duration} 分钟）`).join('\n');

  await fs.mkdir(Paths.tasks, { recursive: true });
  await fs.writeFile(path.join(Paths.tasks, `${plan.date}_todo.md`), markdown, 'utf-8');

  const event: Event = {
    id: createEventId(),
    timestamp: new Date().toISOString(),
    agent: 'task_dispatcher',
    action: 'tasks_dispatched',
    input: { date: plan.date },
    output: { taskCount: tasks.length },
  };
  await appendEvent(eventLogFile, event);

  return tasks;
}
```

**Step 2: 写测试**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { dispatchToday } from '../../src/agents/task_dispatcher.js';
import fs from 'fs/promises';
import path from 'path';

const TEST_DIR = path.join(process.cwd(), 'workspace_test_tasks');
const TEST_LOG = path.join(TEST_DIR, 'event_log', 'events.jsonl');

describe('task_dispatcher', () => {
  beforeEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it('should create todo markdown', async () => {
    const plan = {
      date: '2026-07-10',
      tasks: [
        { type: 'learn' as const, nodeId: 'node_1', duration: 30 },
        { type: 'review' as const, nodeId: 'node_2', duration: 15 },
      ],
    };
    const tasks = await dispatchToday(plan, TEST_LOG);
    expect(tasks).toHaveLength(2);
    const content = await fs.readFile(path.join(TEST_DIR, 'tasks', '2026-07-10_todo.md'), 'utf-8');
    expect(content).toContain('node_1');
  });
});
```

Run: `npx vitest run tests/agents/task_dispatcher.test.ts`
Expected: PASS。

**Step 3: 提交**

```bash
git add .
git commit -m "feat(agent): add task dispatcher for daily todos"
```

---

## Task 10: 实现 QuizGenerator 和 Grader Agent

**Files:**
- Create: `src/agents/quiz_generator.ts`
- Create: `src/agents/grader.ts`
- Create: `src/prompts/quiz_generator.txt`
- Test: `tests/agents/quiz_generator.test.ts`
- Test: `tests/agents/grader.test.ts`

**Step 1: 创建 prompts/quiz_generator.txt**

```text
You are an exam question generator. Given study content, create multiple-choice questions.

Return JSON:
{
  "questions": [
    {
      "id": "q_1",
      "type": "single_choice",
      "stem": "问题题干",
      "options": ["选项A", "选项B", "选项C", "选项D"],
      "answer": 0,
      "explanation": "解析",
      "nodeId": "node_1"
    }
  ]
}

Rules:
- Generate 3-5 questions
- Each question tests one concept
- Answer is 0-based index
- Provide clear explanations
- Respond with JSON only
```

**Step 2: 创建 src/agents/quiz_generator.ts**

```typescript
import fs from 'fs/promises';
import path from 'path';
import type { LLMClient } from '../core/llm.js';
import type { Concept } from './concept_mapper.js';
import type { Event } from '../core/types.js';
import { createEventId, appendEvent } from '../core/event_log.js';
import { Paths } from '../core/paths.js';

export interface Question {
  id: string;
  type: 'single_choice';
  stem: string;
  options: string[];
  answer: number;
  explanation: string;
  nodeId: string;
}

export interface Quiz {
  id: string;
  date: string;
  questions: Question[];
}

export async function generateQuiz(
  concepts: Concept[],
  llm: LLMClient,
  date: string,
  eventLogFile: string
): Promise<Quiz> {
  const promptPath = path.join(Paths.prompts, 'quiz_generator.txt');
  const system = await fs.readFile(promptPath, 'utf-8');
  const user = concepts.map((c) => `## ${c.name}\n${c.definition}`).join('\n\n');

  const raw = await llm.completeJSON<{ questions: Question[] }>(system, user, { temperature: 0.7 });

  const quiz: Quiz = {
    id: `quiz_${date}`,
    date,
    questions: raw.questions.map((q, idx) => ({
      ...q,
      id: `q_${date}_${idx}`,
    })),
  };

  await fs.mkdir(Paths.quizzes, { recursive: true });
  await fs.writeFile(path.join(Paths.quizzes, `${date}_quiz.json`), JSON.stringify(quiz, null, 2), 'utf-8');

  const markdown = `# ${date} 每日测验\n\n` +
    quiz.questions.map((q, idx) =>
      `${idx + 1}. ${q.stem}\n` +
      q.options.map((opt, i) => `   ${String.fromCharCode(65 + i)}. ${opt}`).join('\n')
    ).join('\n\n');
  await fs.writeFile(path.join(Paths.quizzes, `${date}_quiz.md`), markdown, 'utf-8');

  const event: Event = {
    id: createEventId(),
    timestamp: new Date().toISOString(),
    agent: 'quiz_generator',
    action: 'quiz_generated',
    input: { date, conceptCount: concepts.length },
    output: { quizId: quiz.id, questionCount: quiz.questions.length },
  };
  await appendEvent(eventLogFile, event);

  return quiz;
}
```

**Step 3: 创建 src/agents/grader.ts**

```typescript
import fs from 'fs/promises';
import path from 'path';
import type { Quiz, Question } from './quiz_generator.js';
import type { Event } from '../core/types.js';
import { createEventId, appendEvent } from '../core/event_log.js';
import { Paths } from '../core/paths.js';

export interface UserAnswer {
  questionId: string;
  answer: number;
}

export interface GradedQuestion {
  question: Question;
  userAnswer: number;
  isCorrect: boolean;
  score: number;
}

export interface QuizResult {
  quizId: string;
  date: string;
  totalScore: number;
  mistakes: GradedQuestion[];
  details: GradedQuestion[];
}

export function gradeQuiz(quiz: Quiz, answers: UserAnswer[]): QuizResult {
  const details: GradedQuestion[] = quiz.questions.map((q) => {
    const userAnswer = answers.find((a) => a.questionId === q.id);
    const isCorrect = userAnswer !== undefined && userAnswer.answer === q.answer;
    return {
      question: q,
      userAnswer: userAnswer?.answer ?? -1,
      isCorrect,
      score: isCorrect ? 100 : 0,
    };
  });

  const correctCount = details.filter((d) => d.isCorrect).length;
  const totalScore = Math.round((correctCount / quiz.questions.length) * 100);
  const mistakes = details.filter((d) => !d.isCorrect);

  return {
    quizId: quiz.id,
    date: quiz.date,
    totalScore,
    mistakes,
    details,
  };
}

export async function saveResult(
  result: QuizResult,
  eventLogFile: string
): Promise<void> {
  await fs.mkdir(Paths.results, { recursive: true });
  await fs.writeFile(
    path.join(Paths.results, `${result.date}_result.json`),
    JSON.stringify(result, null, 2),
    'utf-8'
  );

  const markdown = `# ${result.date} 测验报告\n\n` +
    `**总分：${result.totalScore}**\n\n` +
    `## 错题\n\n` +
    result.mistakes.map((m) =>
      `- ${m.question.stem}\n  正确答案：${String.fromCharCode(65 + m.question.answer)}\n  解析：${m.question.explanation}`
    ).join('\n\n');

  await fs.writeFile(path.join(Paths.results, `${result.date}_report.md`), markdown, 'utf-8');

  const event: Event = {
    id: createEventId(),
    timestamp: new Date().toISOString(),
    agent: 'grader',
    action: 'quiz_graded',
    input: { quizId: result.quizId },
    output: { totalScore: result.totalScore, mistakeCount: result.mistakes.length },
  };
  await appendEvent(eventLogFile, event);
}
```

**Step 4: 写测试**

```typescript
import { describe, it, expect } from 'vitest';
import { gradeQuiz } from '../../src/agents/grader.js';

describe('grader', () => {
  it('should grade quiz correctly', () => {
    const quiz = {
      id: 'quiz_1',
      date: '2026-07-10',
      questions: [
        { id: 'q_1', type: 'single_choice' as const, stem: 'Q1', options: ['A', 'B'], answer: 0, explanation: '', nodeId: 'node_1' },
        { id: 'q_2', type: 'single_choice' as const, stem: 'Q2', options: ['A', 'B'], answer: 1, explanation: '', nodeId: 'node_2' },
      ],
    };
    const answers = [
      { questionId: 'q_1', answer: 0 },
      { questionId: 'q_2', answer: 0 },
    ];
    const result = gradeQuiz(quiz, answers);
    expect(result.totalScore).toBe(50);
    expect(result.mistakes).toHaveLength(1);
  });
});
```

Run: `npx vitest run tests/agents/grader.test.ts`
Expected: PASS。

**Step 5: 提交**

```bash
git add .
git commit -m "feat(agent): add quiz generator and grader"
```

---

## Task 11: 实现 MistakeAnalyzer 和 PlanAdjuster

**Files:**
- Create: `src/agents/mistake_analyzer.ts`
- Create: `src/agents/plan_adjuster.ts`
- Test: `tests/agents/mistake_analyzer.test.ts`

**Step 1: 创建 src/agents/mistake_analyzer.ts**

```typescript
import fs from 'fs/promises';
import path from 'path';
import type { QuizResult } from './grader.js';
import type { Event } from '../core/types.js';
import { createEventId, appendEvent } from '../core/event_log.js';
import { Paths } from '../core/paths.js';

export interface Mistake {
  id: string;
  questionId: string;
  nodeId: string;
  errorType: 'concept_unclear' | 'careless' | 'memory_fuzzy';
  nextReview: string;
}

export function analyzeMistakes(result: QuizResult): Mistake[] {
  const today = new Date(result.date);
  return result.mistakes.map((m, idx) => {
    const nextReview = new Date(today);
    nextReview.setDate(today.getDate() + 1);
    return {
      id: `mist_${result.date}_${idx}`,
      questionId: m.question.id,
      nodeId: m.question.nodeId,
      errorType: 'concept_unclear',
      nextReview: nextReview.toISOString().split('T')[0],
    };
  });
}

export async function saveMistakes(
  mistakes: Mistake[],
  date: string,
  eventLogFile: string
): Promise<void> {
  await fs.mkdir(Paths.mistakes, { recursive: true });

  for (const mistake of mistakes) {
    await fs.appendFile(
      path.join(Paths.mistakes, 'mistake_log.jsonl'),
      JSON.stringify(mistake) + '\n',
      'utf-8'
    );
  }

  const weakNodes = [...new Set(mistakes.map((m) => m.nodeId))];
  const profile = { date, weakNodes, mistakeCount: mistakes.length };
  await fs.writeFile(path.join(Paths.mistakes, 'weakness_profile.json'), JSON.stringify(profile, null, 2), 'utf-8');

  const event: Event = {
    id: createEventId(),
    timestamp: new Date().toISOString(),
    agent: 'mistake_analyzer',
    action: 'mistakes_analyzed',
    input: { date },
    output: { mistakeCount: mistakes.length, weakNodes },
  };
  await appendEvent(eventLogFile, event);
}
```

**Step 2: 创建 src/agents/plan_adjuster.ts**

```typescript
import type { StudyPlan } from './planner.js';
import type { Mistake } from './mistake_analyzer.js';

export function adjustPlan(plan: StudyPlan, mistakes: Mistake[]): StudyPlan {
  const weakNodes = [...new Set(mistakes.map((m) => m.nodeId))];
  const adjusted: StudyPlan = JSON.parse(JSON.stringify(plan));

  for (const day of adjusted.schedule) {
    for (const task of day.tasks) {
      if (weakNodes.includes(task.nodeId) && task.type === 'review') {
        task.duration += 10;
      }
    }
  }

  return adjusted;
}
```

**Step 3: 写测试**

```typescript
import { describe, it, expect } from 'vitest';
import { analyzeMistakes } from '../../src/agents/mistake_analyzer.js';

describe('mistake_analyzer', () => {
  it('should extract weak nodes from result', () => {
    const result = {
      quizId: 'q1',
      date: '2026-07-10',
      totalScore: 50,
      details: [],
      mistakes: [
        {
          question: { id: 'q_1', type: 'single_choice' as const, stem: '', options: [], answer: 0, explanation: '', nodeId: 'node_1' },
          userAnswer: 1,
          isCorrect: false,
          score: 0,
        },
      ],
    };
    const mistakes = analyzeMistakes(result);
    expect(mistakes[0].nodeId).toBe('node_1');
    expect(mistakes[0].nextReview).toBe('2026-07-11');
  });
});
```

Run: `npx vitest run tests/agents/mistake_analyzer.test.ts`
Expected: PASS。

**Step 4: 提交**

```bash
git add .
git commit -m "feat(agent): add mistake analyzer and plan adjuster"
```

---

## Task 12: 完善 CLI 命令（串联完整闭环）

**Files:**
- Modify: `src/cli.ts`

实现完整的 CLI 命令：

```typescript
import { program } from 'commander';
import { initWorkspace } from './core/workspace.js';
import { Paths } from './core/paths.js';
import { importPDF } from './agents/material_collector.js';
import { chunkMaterial } from './agents/chunker.js';
import { mapConcepts } from './agents/concept_mapper.js';
import { generatePlan, savePlan } from './agents/planner.js';
import { dispatchToday } from './agents/task_dispatcher.js';
import { generateQuiz } from './agents/quiz_generator.js';
import { gradeQuiz, saveResult } from './agents/grader.js';
import { analyzeMistakes, saveMistakes } from './agents/mistake_analyzer.js';
import { createLLMClient } from './core/llm.js';
import fs from 'fs/promises';

program.name('studymate').description('AI-powered personal exam preparation agent').version('0.1.0');

program
  .command('init')
  .description('Initialize workspace')
  .action(async () => {
    await initWorkspace();
    console.log('Workspace initialized at ./workspace');
  });

program
  .command('ingest')
  .description('Import a PDF file')
  .argument('<file>', 'PDF file path')
  .action(async (file: string) => {
    const material = await importPDF(file, Paths.eventLog);
    const chunks = await chunkMaterial(material, Paths.eventLog);
    console.log(`Imported: ${material.title}`);
    console.log(`Generated ${chunks.length} chunks`);
  });

program
  .command('plan')
  .description('Generate study plan')
  .requiredOption('--exam <date>', 'Exam date YYYY-MM-DD')
  .requiredOption('--daily <minutes>', 'Daily minutes')
  .action(async (options: { exam: string; daily: string }) => {
    const llm = createLLMClient();
    // Load last chunks
    const chunkFiles = await fs.readdir(Paths.chunks).catch(() => []);
    if (chunkFiles.length === 0) {
      console.error('No chunks found. Run: studymate ingest <pdf>');
      process.exit(1);
    }
    const chunks = await Promise.all(
      chunkFiles
        .filter((f) => f.endsWith('.md'))
        .map(async (f, i) => ({
          id: `chunk_${i + 1}`,
          materialId: 'mat_1',
          title: f.replace('.md', ''),
          content: await fs.readFile(path.join(Paths.chunks, f), 'utf-8'),
          chapterPath: `${i + 1}`,
          concepts: [],
          sourceLink: path.join(Paths.chunks, f),
        }))
    );
    const conceptMap = await mapConcepts(chunks, llm, Paths.eventLog);
    const plan = generatePlan(conceptMap, { examDate: options.exam, dailyMinutes: parseInt(options.daily, 10) });
    await savePlan(plan, Paths.eventLog);
    console.log(`Plan generated: ${plan.schedule.length} days`);
  });

program
  .command('today')
  .description('Show today tasks')
  .action(async () => {
    const today = new Date().toISOString().split('T')[0];
    const planPath = path.join(Paths.plan, 'plan_daily', `${today}.json`);
    try {
      const plan = JSON.parse(await fs.readFile(planPath, 'utf-8'));
      const tasks = await dispatchToday(plan, Paths.eventLog);
      console.log(`Today's tasks (${today}): ${tasks.length}`);
      for (const t of tasks) {
        console.log(`- ${t.type === 'learn' ? '学习' : '复习'} ${t.nodeId} (${t.duration}min)`);
      }
    } catch {
      console.error(`No plan found for ${today}`);
    }
  });

program
  .command('quiz')
  .description('Generate quiz for today')
  .action(async () => {
    const llm = createLLMClient();
    const today = new Date().toISOString().split('T')[0];
    const conceptsPath = path.join(Paths.graph, 'concepts.json');
    const concepts = JSON.parse(await fs.readFile(conceptsPath, 'utf-8')).concepts;
    const quiz = await generateQuiz(concepts, llm, today, Paths.eventLog);
    console.log(`Generated quiz: ${quiz.questions.length} questions`);
    console.log(`See: ${path.join(Paths.quizzes, `${today}_quiz.md`)}`);
  });

program
  .command('grade')
  .description('Grade quiz from answers JSON')
  .requiredOption('--answers <file>', 'Answers JSON file')
  .action(async (options: { answers: string }) => {
    const today = new Date().toISOString().split('T')[0];
    const quiz = JSON.parse(await fs.readFile(path.join(Paths.quizzes, `${today}_quiz.json`), 'utf-8'));
    const answers = JSON.parse(await fs.readFile(options.answers, 'utf-8'));
    const result = gradeQuiz(quiz, answers);
    await saveResult(result, Paths.eventLog);
    const mistakes = analyzeMistakes(result);
    await saveMistakes(mistakes, today, Paths.eventLog);
    console.log(`Score: ${result.totalScore}`);
    console.log(`Mistakes: ${result.mistakes.length}`);
  });

program.parse();
```

注意：需要在文件顶部添加 `import path from 'path';`。

Run: `npm run build`
Expected: 构建成功。

**Step 5: 提交**

```bash
git add .
git commit -m "feat(cli): wire all agents into CLI commands"
```

---

## Task 13: 准备 Demo 数据集

**Files:**
- Create: `demo/materials/sample-economics.pdf`（或 Markdown 占位）
- Create: `demo/answers/2026-07-10_answers.json`

**Step 1: 创建 demo 示例资料**

由于 PDF 创建麻烦，先用 Markdown 占位，通过 `ingest` 命令支持读取 Markdown 作为快速 fallback。

修改 `src/agents/material_collector.ts` 增加 `importMarkdown`：

```typescript
export async function importMarkdown(
  mdPath: string,
  eventLogFile: string
): Promise<Material> {
  const content = await fs.readFile(mdPath, 'utf-8');
  const title = path.basename(mdPath, path.extname(mdPath));
  const safeTitle = `${new Date().toISOString().split('T')[0]}_${title}.md`;
  const contentPath = path.join(Paths.materials, safeTitle);

  await fs.mkdir(Paths.materials, { recursive: true });
  await fs.writeFile(contentPath, content, 'utf-8');

  const material: Material = {
    id: `mat_${Date.now()}`,
    source: mdPath,
    type: 'webpage',
    title,
    contentPath,
    meta: {
      capturedAt: new Date().toISOString(),
      wordCount: content.split(/\s+/).length,
    },
  };

  const event: Event = {
    id: createEventId(),
    timestamp: new Date().toISOString(),
    agent: 'material_collector',
    action: 'material_imported',
    input: { mdPath },
    output: { materialId: material.id, contentPath },
  };
  await appendEvent(eventLogFile, event);
  return material;
}
```

修改 CLI 的 `ingest` 支持 `.md`：

```typescript
program
  .command('ingest')
  .description('Import a PDF or Markdown file')
  .argument('<file>', 'File path')
  .action(async (file: string) => {
    let material;
    if (file.endsWith('.pdf')) {
      material = await importPDF(file, Paths.eventLog);
    } else if (file.endsWith('.md')) {
      material = await importMarkdown(file, Paths.eventLog);
    } else {
      console.error('Unsupported file type. Use .pdf or .md');
      process.exit(1);
    }
    const chunks = await chunkMaterial(material, Paths.eventLog);
    console.log(`Imported: ${material.title}`);
    console.log(`Generated ${chunks.length} chunks`);
  });
```

**Step 2: 创建 demo Markdown**

`demo/materials/micro-economics.md`:

```markdown
# 微观经济学基础

## 需求曲线

需求曲线表示在其他条件不变的情况下，商品价格与需求量之间的关系。

## 供给曲线

供给曲线表示在其他条件不变的情况下，商品价格与供给量之间的关系。

## 市场均衡

当需求量等于供给量时，市场达到均衡，此时的价格称为均衡价格。

## 价格弹性

价格弹性衡量需求量对价格变动的敏感程度。当弹性大于 1 时，价格上升会导致总收入减少。
```

**Step 3: 创建示例答案**

`demo/answers/2026-07-10_answers.json`:

```json
[
  { "questionId": "q_2026-07-10_0", "answer": 1 },
  { "questionId": "q_2026-07-10_1", "answer": 0 },
  { "questionId": "q_2026-07-10_2", "answer": 2 }
]
```

**Step 4: 提交**

```bash
git add .
git commit -m "chore: add demo materials and markdown ingestion support"
```

---

## Task 14: 端到端冒烟测试

**Step 1: 清理并初始化**

```bash
rm -rf workspace
npm run build
node dist/cli.js init
```

**Step 2: 导入 demo 资料**

```bash
node dist/cli.js ingest demo/materials/micro-economics.md
```

Expected: 显示生成的 chunks 数量。

**Step 3: 生成计划**

```bash
node dist/cli.js plan --exam 2026-09-15 --daily 60
```

Expected: 显示计划天数。

**Step 4: 查看今日任务**

```bash
node dist/cli.js today
```

Expected: 显示今日学习任务。

**Step 5: 生成测验**

```bash
node dist/cli.js quiz
```

Expected: 显示题目数量，并生成 `workspace/quizzes/YYYY-MM-DD_quiz.md`。

**Step 6: 批改**

```bash
node dist/cli.js grade --answers demo/answers/2026-07-10_answers.json
```

Expected: 显示得分和错题数。

**Step 7: 检查事件日志**

```bash
wc -l workspace/event_log/events.jsonl
cat workspace/event_log/events.jsonl | tail -5
```

Expected: 事件日志追加多条记录。

**Step 8: 提交**

```bash
git add .
git commit -m "test: verify end-to-end CLI workflow"
```

---

## Task 15: 准备路演材料

**Files:**
- Create: `docs/hackathon-pitch.md`
- Create: `docs/demo-script.md`

**Step 1: 创建 docs/hackathon-pitch.md**

包含：
- 问题场景
- 解决方案
- 技术路线
- 商业化路径
- 竞争优势

**Step 2: 创建 docs/demo-script.md**

3-5 分钟 Demo 脚本，包含每个命令和预期输出。

**Step 3: 提交**

```bash
git add .
git commit -m "docs: add hackathon pitch and demo script"
```

---

## Task 16: 最终整理与推送

**Step 1: 运行全部测试**

```bash
npm test
```

Expected: 全部 PASS。

**Step 2: 确保构建通过**

```bash
npm run build
```

Expected: 无错误。

**Step 3: 推送到 GitHub**

```bash
git push origin main
```

Expected: 代码已同步到 https://github.com/Joe-rq/studymate-agent。

---

## 附录：环境变量

```bash
export OPENAI_API_KEY="your-key"
export OPENAI_BASE_URL="https://api.openai.com/v1"  # 或中转地址
export LLM_MODEL="gpt-4o-mini"  # 成本较低，适合 Demo
```

---

## 附录：命令速查

```bash
npm install
npm run build
npm test
node dist/cli.js init
node dist/cli.js ingest demo/materials/micro-economics.md
node dist/cli.js plan --exam 2026-09-15 --daily 60
node dist/cli.js today
node dist/cli.js quiz
node dist/cli.js grade --answers demo/answers/2026-07-10_answers.json
```
