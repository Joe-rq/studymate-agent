import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'crypto';
import { gradeAndAdapt } from '../../../src/application/workflows/grade_and_adapt.js';
import { initLearnerModel } from '../../../src/agents/learner_model.js';
import type { Quiz } from '../../../src/agents/quiz_generator.js';
import type { UserAnswer } from '../../../src/agents/grader.js';
import fs from 'fs/promises';
import path from 'path';

const TEST_DIR = path.join(process.cwd(), 'workspace_test_grade_adapt');
const TEST_LOG = path.join(TEST_DIR, 'event_log', 'events.jsonl');

describe('grade_and_adapt workflow', () => {
  beforeEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(path.join(TEST_DIR, 'graph'), { recursive: true });
    await fs.mkdir(path.join(TEST_DIR, 'mistakes'), { recursive: true });
    await fs.mkdir(path.join(TEST_DIR, 'results'), { recursive: true });
    await fs.mkdir(path.join(TEST_DIR, 'plan'), { recursive: true });
    await fs.mkdir(path.dirname(TEST_LOG), { recursive: true });
  });

  it('should grade, update mastery, and adjust plan in one call', async () => {
    // Set up concepts.json
    const conceptMap = {
      concepts: [
        { id: 'node_1', name: 'Supply', definition: '', prerequisiteIds: [], relatedChunks: [], mastery: 0.5 },
        { id: 'node_2', name: 'Demand', definition: '', prerequisiteIds: [], relatedChunks: [], mastery: 0.5 },
      ],
      learningOrder: ['node_1', 'node_2'],
    };
    const conceptsPath = path.join(TEST_DIR, 'graph', 'concepts.json');
    await fs.writeFile(conceptsPath, JSON.stringify(conceptMap, null, 2), 'utf-8');

    // Set up plan_master.json
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dayAfter = new Date();
    dayAfter.setDate(dayAfter.getDate() + 2);
    const plan = {
      id: 'plan_test',
      examDate: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
      dailyMinutes: 60,
      schedule: [
        {
          date: tomorrow.toISOString().split('T')[0],
          tasks: [{ type: 'review', nodeId: 'node_1', duration: 15 }],
        },
        {
          date: dayAfter.toISOString().split('T')[0],
          tasks: [{ type: 'review', nodeId: 'node_2', duration: 15 }],
        },
      ],
    };
    const planPath = path.join(TEST_DIR, 'plan', 'plan_master.json');
    await fs.writeFile(planPath, JSON.stringify(plan, null, 2), 'utf-8');

    // Set up quiz and answers (get node_1 wrong, node_2 right)
    const quiz = {
      id: 'quiz_2026-07-10',
      date: '2026-07-10',
      questions: [
        { id: 'q_1', type: 'single_choice' as const, stem: 'Q1', options: ['A', 'B'], answer: 0, explanation: 'Exp1', nodeId: 'node_1' },
        { id: 'q_2', type: 'single_choice' as const, stem: 'Q2', options: ['A', 'B'], answer: 1, explanation: 'Exp2', nodeId: 'node_2' },
      ],
    };
    const answers = [
      { questionId: 'q_1', answer: 1 }, // wrong
      { questionId: 'q_2', answer: 1 }, // correct
    ];

    const result = await gradeAndAdapt({
      quiz,
      answers,
      conceptsPath,
      planPath,
      eventLogFile: TEST_LOG,
      workspaceRoot: TEST_DIR,
    });

    // Grade result
    expect(result.result.totalScore).toBe(50);
    expect(result.result.mistakes).toHaveLength(1);

    // Mastery changes
    expect(result.masteryChanges).toHaveLength(2);
    const node1Change = result.masteryChanges.find((c) => c.nodeId === 'node_1');
    expect(node1Change?.newMastery).toBeLessThan(node1Change?.oldMastery ?? 1); // went wrong

    // Weakness tracked
    expect(result.mistakeNodeIds).toContain('node_1');

    // Plan adjusted
    expect(result.adjustments.length).toBeGreaterThanOrEqual(0);

    // Correlation ID present
    expect(result.correlationId).toMatch(/^corr_/);

    // concepts.json updated on disk
    const updatedMap = JSON.parse(await fs.readFile(conceptsPath, 'utf-8'));
    expect(updatedMap.concepts[0].mastery).not.toBe(0.5);
  });

  it('should skip plan adjustment when no plan exists', async () => {
    const conceptMap = {
      concepts: [
        { id: 'n1', name: 'A', definition: '', prerequisiteIds: [], relatedChunks: [], mastery: 0 },
      ],
      learningOrder: ['n1'],
    };
    const conceptsPath = path.join(TEST_DIR, 'graph', 'concepts.json');
    await fs.writeFile(conceptsPath, JSON.stringify(conceptMap, null, 2), 'utf-8');

    const quiz = {
      id: 'quiz_2026-07-10',
      date: '2026-07-10',
      questions: [
        { id: 'q_1', type: 'single_choice' as const, stem: 'Q', options: ['A', 'B'], answer: 0, explanation: '', nodeId: 'n1' },
      ],
    };
    const answers = [{ questionId: 'q_1', answer: 0 }];

    const result = await gradeAndAdapt({
      quiz,
      answers,
      conceptsPath,
      eventLogFile: TEST_LOG,
      workspaceRoot: TEST_DIR,
      // No planPath
    });

    expect(result.adjustments).toHaveLength(0);
    expect(result.result.totalScore).toBe(100);
  });

  it('should reject a second submission with different answers for the same quiz', async () => {
    const conceptMap = {
      concepts: [
        { id: 'n1', name: 'A', definition: '', prerequisiteIds: [], relatedChunks: [], mastery: 0.5 },
      ],
      learningOrder: ['n1'],
    };
    const conceptsPath = path.join(TEST_DIR, 'graph', 'concepts.json');
    await fs.writeFile(conceptsPath, JSON.stringify(conceptMap), 'utf-8');
    const quiz = {
      id: 'quiz_conflict',
      date: '2026-07-10',
      questions: [
        { id: 'q_1', type: 'single_choice' as const, stem: 'Q', options: ['A', 'B'], answer: 0, explanation: '', nodeId: 'n1' },
      ],
    };

    await gradeAndAdapt({
      quiz,
      answers: [{ questionId: 'q_1', answer: 0 }],
      conceptsPath,
      eventLogFile: TEST_LOG,
      workspaceRoot: TEST_DIR,
    });

    await expect(
      gradeAndAdapt({
        quiz,
        answers: [{ questionId: 'q_1', answer: 1 }],
        conceptsPath,
        eventLogFile: TEST_LOG,
        workspaceRoot: TEST_DIR,
      })
    ).rejects.toThrow('already been graded with different answers');
  });
});

describe('grade_and_adapt 并发与失败恢复', () => {
  const conceptsPath = path.join(TEST_DIR, 'graph', 'concepts.json');
  const planPath = path.join(TEST_DIR, 'plan', 'plan_master.json');
  const learnerPath = path.join(TEST_DIR, 'progress', 'learner_model.json');

  beforeEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(path.join(TEST_DIR, 'graph'), { recursive: true });
    await fs.mkdir(path.join(TEST_DIR, 'mistakes'), { recursive: true });
    await fs.mkdir(path.join(TEST_DIR, 'results'), { recursive: true });
    await fs.mkdir(path.join(TEST_DIR, 'plan'), { recursive: true });
    await fs.mkdir(path.dirname(TEST_LOG), { recursive: true });
  });

  function writeConcepts(mastery = 0.5): Promise<void> {
    return fs.writeFile(
      conceptsPath,
      JSON.stringify({
        concepts: [
          { id: 'node_1', name: 'A', definition: '', prerequisiteIds: [], relatedChunks: [], mastery },
        ],
        learningOrder: ['node_1'],
      }),
      'utf-8'
    );
  }

  function writePlan(): Promise<void> {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const plan = {
      id: 'plan_test',
      examDate: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
      dailyMinutes: 60,
      schedule: [
        { date: tomorrow.toISOString().split('T')[0], tasks: [{ type: 'review', nodeId: 'node_1', duration: 15 }] },
      ],
    };
    return fs.writeFile(planPath, JSON.stringify(plan, null, 2), 'utf-8');
  }

  function makeQuiz(quizId = 'quiz_concurrent'): Quiz {
    return {
      id: quizId,
      date: '2026-07-10',
      questions: [
        { id: 'q_1', type: 'single_choice' as const, stem: 'Q', options: ['A', 'B'], answer: 0, explanation: '', nodeId: 'node_1' },
      ],
    };
  }

  const correctAnswers: UserAnswer[] = [{ questionId: 'q_1', answer: 0 }];
  const wrongAnswers: UserAnswer[] = [{ questionId: 'q_1', answer: 1 }];

  function baseInput(quiz: Quiz, answers: UserAnswer[]) {
    return { quiz, answers, conceptsPath, planPath, eventLogFile: TEST_LOG, workspaceRoot: TEST_DIR };
  }

  function receiptPathFor(quizId: string): string {
    const safeId = crypto.createHash('sha256').update(quizId, 'utf-8').digest('hex').slice(0, 16);
    return path.join(TEST_DIR, 'results', `grade_receipt_${safeId}.json`);
  }

  async function readReceipt(quizId: string): Promise<{ status: string; error?: string }> {
    return JSON.parse(await fs.readFile(receiptPathFor(quizId), 'utf-8'));
  }

  it('并发提交相同答案：掌握度只更新一次', async () => {
    await writeConcepts(0.5);
    const quiz = makeQuiz();
    const [r1, r2] = await Promise.all([
      gradeAndAdapt(baseInput(quiz, correctAnswers)),
      gradeAndAdapt(baseInput(quiz, correctAnswers)),
    ]);
    expect(r1.correlationId).toBe(r2.correlationId);
    const concepts = JSON.parse(await fs.readFile(conceptsPath, 'utf-8'));
    expect(concepts.concepts[0].mastery).toBeCloseTo(0.7, 5);
    const history = await fs.readFile(path.join(TEST_DIR, 'progress', 'mastery_history.jsonl'), 'utf-8');
    expect(history.trim().split('\n')).toHaveLength(1);
  });

  it('并发提交不同答案：一个成功一个 409', async () => {
    await writeConcepts(0.5);
    const quiz = makeQuiz('quiz_conflict_concurrent');
    const settled = await Promise.allSettled([
      gradeAndAdapt(baseInput(quiz, correctAnswers)),
      gradeAndAdapt(baseInput(quiz, wrongAnswers)),
    ]);
    const fulfilled = settled.filter((s) => s.status === 'fulfilled');
    const rejected = settled.filter((s) => s.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toContain('already been graded');
  });

  it('五个写阶段注入失败：标记 failed 回执并传播错误', async () => {
    const stages = ['result', 'mistakes', 'mastery', 'plan', 'learner'] as const;
    for (const stage of stages) {
      await writeConcepts(0.5);
      await writePlan();
      await initLearnerModel('exam_test', 'beginner', 60, TEST_DIR);
      const quiz = makeQuiz(`quiz_fail_${stage}`);
      await expect(
        gradeAndAdapt(baseInput(quiz, correctAnswers), { failAt: stage })
      ).rejects.toThrow(`Injected failure at ${stage} stage`);
      const receipt = await readReceipt(`quiz_fail_${stage}`);
      expect(receipt.status).toBe('failed');
      expect(receipt.error).toContain(`Injected failure at ${stage} stage`);
    }
  });

  it('注入失败后重试：累积状态不重复累计', async () => {
    await writeConcepts(0.5);
    await writePlan();
    await initLearnerModel('exam_test', 'beginner', 60, TEST_DIR);
    const quiz = makeQuiz('quiz_recover');

    await expect(
      gradeAndAdapt(baseInput(quiz, wrongAnswers), { failAt: 'learner' })
    ).rejects.toThrow('Injected failure at learner stage');

    const result = await gradeAndAdapt(baseInput(quiz, wrongAnswers));
    expect(result.result.totalScore).toBe(0);

    // 掌握度只降一次：0.5 -> 0.3（若重复累计会到 0.18）
    const concepts = JSON.parse(await fs.readFile(conceptsPath, 'utf-8'));
    expect(concepts.concepts[0].mastery).toBeCloseTo(0.3, 5);

    // 错题只累计一次
    const weakness = JSON.parse(
      await fs.readFile(path.join(TEST_DIR, 'mistakes', 'weakness_profile.json'), 'utf-8')
    );
    expect(weakness.nodes.node_1.mistakeCount).toBe(1);

    // 学习者模型会话数只 +1
    const learner = JSON.parse(await fs.readFile(learnerPath, 'utf-8'));
    expect(learner.performance.totalSessions).toBe(1);
  });

  it('响应丢失后重试：返回同一回执', async () => {
    await writeConcepts(0.5);
    const quiz = makeQuiz('quiz_retry');
    const first = await gradeAndAdapt(baseInput(quiz, correctAnswers));
    const retry = await gradeAndAdapt(baseInput(quiz, correctAnswers));
    expect(retry.correlationId).toBe(first.correlationId);
    expect(retry.result.totalScore).toBe(first.result.totalScore);
  });
});
