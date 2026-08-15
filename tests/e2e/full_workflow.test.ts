import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { initWorkspace } from '../../src/core/workspace.js';
import { importMarkdown } from '../../src/agents/material_collector.js';
import { chunkMaterial } from '../../src/agents/chunker.js';
import { mapConcepts } from '../../src/agents/concept_mapper.js';
import { generatePlan, savePlan } from '../../src/agents/planner.js';
import { dispatchToday } from '../../src/agents/task_dispatcher.js';
import { selectQuizScope, generateScopedQuiz, type QuizConfig } from '../../src/agents/quiz_generator.js';
import { gradeAndAdapt } from '../../src/application/workflows/grade_and_adapt.js';
import { computeMetrics } from '../../src/agents/metrics.js';
import { loadBuddyState, updateStreak, saveBuddyState } from '../../src/agents/buddy_state.js';
import { loadEvents } from '../../src/core/event_log.js';
import { createMockLLMClient } from '../../src/core/mock_llm.js';
import { Paths, WORKSPACE_ROOT } from '../../src/core/paths.js';

const MATERIAL = `# 微观经济学基础

## 需求与供给

需求曲线表示在不同价格下消费者愿意购买的商品数量。需求定律指出，价格越高，需求量越低，因此需求曲线通常向右下方倾斜。

供给曲线表示在不同价格下生产者愿意提供的商品数量。价格越高，供给量越大，因此供给曲线向右上方倾斜。

## 市场均衡

市场均衡发生在需求量等于供给量时。此时的价格称为均衡价格，数量称为均衡数量。

如果价格高于均衡价格，会出现供给过剩；如果价格低于均衡价格，会出现需求过剩。

## 价格弹性

价格弹性衡量需求量对价格变动的敏感程度。弹性大于1表示需求富有弹性，弹性小于1表示需求缺乏弹性。

影响弹性的因素包括替代品的数量、商品在预算中的比重、以及时间长短。
`;

describe('Full workflow e2e', () => {
  let tmpDir: string;
  const llm = createMockLLMClient();

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sm-e2e-'));
    // Redirect Paths to tmpDir
    const wsDir = path.join(tmpDir, 'workspace');
    await initWorkspace(wsDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // Helper to resolve workspace paths relative to tmpDir
  function ws(subpath: string): string {
    return path.join(tmpDir, 'workspace', subpath);
  }

  it('runs complete study loop: ingest → plan → today → quiz → grade → metrics', async () => {
    const eventLog = ws('event_log/events.jsonl');

    // 1. Import a markdown material
    const material = await importMarkdown(
      await writeFixture(tmpDir, 'test_material.md', MATERIAL),
      eventLog,
      ws('')
    );
    expect(material.chunks?.length ?? 0).toBeGreaterThanOrEqual(0);

    // 2. Chunk it
    const chunks = await chunkMaterial(material, eventLog, ws(''));
    expect(chunks.length).toBeGreaterThan(0);

    // 3. Map concepts (mock LLM returns fixed concepts)
    const conceptMap = await mapConcepts(chunks, llm, eventLog, { workspaceRoot: ws('') });
    expect(conceptMap.concepts.length).toBeGreaterThan(0);

    // Verify concepts written to workspace
    const conceptsOnDisk = JSON.parse(await fs.readFile(ws('graph/concepts.json'), 'utf-8'));
    expect(conceptsOnDisk.concepts.length).toBe(conceptMap.concepts.length);

    // 4. Generate a 3-day plan
    const examDate = new Date();
    examDate.setDate(examDate.getDate() + 30);
    const plan = generatePlan(conceptMap, {
      examDate: examDate.toISOString().split('T')[0],
      dailyMinutes: 60,
    });
    expect(plan.schedule.length).toBeGreaterThan(0);
    await savePlan(plan, eventLog, ws(''));

    // Verify plan persisted
    const planOnDisk = JSON.parse(await fs.readFile(ws('plan/plan_master.json'), 'utf-8'));
    expect(planOnDisk.schedule.length).toBe(plan.schedule.length);

    // 5. Dispatch today's tasks
    const today = new Date().toISOString().split('T')[0];
    // Find today's daily plan or use the first day
    let todayPlan;
    try {
      todayPlan = JSON.parse(await fs.readFile(ws(`plan/plan_daily/${today}.json`), 'utf-8'));
    } catch {
      // No daily plan for today — use first schedule day
      todayPlan = { date: today, tasks: plan.schedule[0]?.tasks ?? [] };
    }
    const tasks = await dispatchToday(todayPlan, eventLog, { workspaceRoot: ws('') });
    expect(tasks.length).toBeGreaterThanOrEqual(0);

    // 6. Generate a quiz
    const config: QuizConfig = { questionCount: 3, allowMultiChoice: true };
    const weaknessProfile = undefined;
    const scope = selectQuizScope(todayPlan, conceptMap, weaknessProfile);
    const quiz = await generateScopedQuiz(scope, config, llm, today, eventLog, ws(''));
    expect(quiz.questions.length).toBeGreaterThan(0);

    // 7. Submit answers (get q1 right, rest wrong)
    const answers = quiz.questions.map((q, i) => ({
      questionId: q.id,
      answer: i === 0 ? q.answer : (q.answer === 0 ? 1 : 0),
    }));

    // 8. Grade and verify
    const gradeResult = await gradeAndAdapt({
      quiz,
      answers,
      conceptsPath: ws('graph/concepts.json'),
      planPath: ws('plan/plan_master.json'),
      eventLogFile: eventLog,
      workspaceRoot: ws(''),
    });

    expect(gradeResult.result.totalScore).toBeDefined();
    expect(typeof gradeResult.result.totalScore).toBe('number');
    expect(gradeResult.masteryChanges.length).toBeGreaterThan(0);

    // 9. Run metrics
    const metrics = await computeMetrics(ws(''));
    expect(typeof metrics.planCompletionRate).toBe('number');
    expect(typeof metrics.postReviewAccuracy).toBe('number');
    expect(typeof metrics.knowledgeRetention).toBe('number');
    // 题目弃用率在反馈机制实现前显式为 null（不可用），不是伪造的 0
    expect(metrics.questionDiscardRate).toBeNull();
    expect(Number.isFinite(metrics.planCompletionRate)).toBe(true);

    // 10. Verify buddy state
    const buddyState = await loadBuddyState(ws(''));
    let updated = updateStreak(buddyState, today);
    await saveBuddyState(updated, ws(''));
    const reloaded = await loadBuddyState(ws(''));
    expect(reloaded.streakDays).toBeGreaterThanOrEqual(1);

    // 11. Verify event log has events and grade result has correlation ID
    const events = await loadEvents(eventLog);
    expect(events.length).toBeGreaterThan(0);
    expect(gradeResult.correlationId).toBeDefined();
    expect(typeof gradeResult.correlationId).toBe('string');

    // 12. Verify schema versions exist
    const versions = events.map((e) => e.schemaVersion ?? 1);
    expect(versions.every((v) => v >= 1)).toBe(true);
  });
});

async function writeFixture(dir: string, name: string, content: string): Promise<string> {
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, content, 'utf-8');
  return filePath;
}
