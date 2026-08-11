import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import {
  buildAggregate,
  startSession,
  advanceSession,
  completeSession,
  explainConcept,
  type StudySession,
} from '../../../src/application/workflows/study_session.js';
import { createMockLLMClient } from '../../../src/core/mock_llm.js';
import { loadEvents } from '../../../src/core/event_log.js';

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

  it('focus→recall 完成任务，阶段推进', async () => {
    const started = await startSession({ ...opts(TEST_DIR) });
    const agg = await advanceSession({ ...opts(TEST_DIR), fromStage: 'focus' });
    expect(agg.session?.stage).toBe('recall');
    const saved = await loadSavedSession(TEST_DIR);
    expect(saved?.focusNodeIds).toContain('node_1');
    expect(saved?.completedTaskIds).toContain(started.currentTask!.id);
    // 任务应已标记 done
    const progress = JSON.parse(
      await fs.readFile(path.join(TEST_DIR, 'tasks', `${TODAY}_progress.json`), 'utf-8')
    );
    expect(progress.completions.some((c: { taskId: string; status: string }) => c.taskId === started.currentTask!.id && c.status === 'done')).toBe(true);
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

  it('quiz→feedback 需要 grade，缺失抛错', async () => {
    await startSession({ ...opts(TEST_DIR) });
    await advanceSession({ ...opts(TEST_DIR), fromStage: 'focus' });
    await advanceSession({ ...opts(TEST_DIR), fromStage: 'recall' });
    await expect(
      advanceSession({ ...opts(TEST_DIR), fromStage: 'quiz' })
    ).rejects.toThrow('grade is required');
    const agg = await advanceSession({
      ...opts(TEST_DIR),
      fromStage: 'quiz',
      grade: { quizId: 'q1', score: 80, total: 5, correct: 4, correlationId: 'corr_1' },
      masteryChanges: [{ nodeId: 'node_1', oldMastery: 0, newMastery: 0.4 }],
    });
    expect(agg.session?.stage).toBe('feedback');
    const saved = await loadSavedSession(TEST_DIR);
    expect(saved?.grade?.score).toBe(80);
    expect(saved?.masteryChanges).toHaveLength(1);
  });

  it('feedback→reflect 附带 Reflect 汇总与明日首项', async () => {
    await startSession({ ...opts(TEST_DIR) });
    await advanceSession({ ...opts(TEST_DIR), fromStage: 'focus' });
    await advanceSession({ ...opts(TEST_DIR), fromStage: 'recall' });
    await advanceSession({
      ...opts(TEST_DIR),
      fromStage: 'quiz',
      grade: { quizId: 'q1', score: 80, total: 5, correct: 4, correlationId: 'corr_1' },
      masteryChanges: [{ nodeId: 'node_1', oldMastery: 0, newMastery: 0.4 }],
    });
    const agg = await advanceSession({ ...opts(TEST_DIR), fromStage: 'feedback' });
    expect(agg.session?.stage).toBe('reflect');
    expect(agg.reflect?.summary.answeredQuestions).toBe(5);
    expect(agg.reflect?.summary.correct).toBe(4);
    expect(agg.reflect?.summary.masteryDeltaSum).toBe(0.4);
  });

  it('complete 结束会话且幂等', async () => {
    await startSession({ ...opts(TEST_DIR) });
    const a = await completeSession({ ...opts(TEST_DIR) });
    expect(a.session?.status).toBe('completed');
    expect(a.session?.stage).toBe('completed');
    const b = await completeSession({ ...opts(TEST_DIR) });
    expect(b.session?.status).toBe('completed');
    const events = await loadEvents(path.join(TEST_DIR, 'event_log', 'events.jsonl'));
    expect(events.filter((e) => e.action === 'study_session_completed')).toHaveLength(1);
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
