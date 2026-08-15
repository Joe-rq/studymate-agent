import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { Paths, resolvePaths } from '../core/paths.js';
import { createLLMClient, type LLMClient } from '../core/llm.js';
import { createMockLLMClient } from '../core/mock_llm.js';
import { gatherStudyContext } from '../core/context_reader.js';
import { loadCharacter, listCharacters, getSelectedCharacter } from '../core/character.js';
import { loadBuddyState, saveBuddyState, updateStreak, increaseRelationship } from '../agents/buddy_state.js';
import { buddyChat, loadChatHistory } from '../agents/study_buddy.js';
import { shouldIntervene, generateIntervention, type InterventionMoment, STREAK_MILESTONES } from '../agents/buddy_interventions.js';
import { deriveCompanionActivity } from '../domain/buddy.js';
import { selectQuizScope, generateScopedQuiz, type QuizConfig } from '../agents/quiz_generator.js';
import { gradeAndAdapt } from '../application/workflows/grade_and_adapt.js';
import { computeMetrics } from '../agents/metrics.js';
import { completeTask, prepareTasksForDate } from '../agents/task_dispatcher.js';
import { bootstrapExam, loadExamProject, saveExamProject } from '../application/workflows/bootstrap_exam.js';
import { researchExamWorkflow, approveSources } from '../application/workflows/research_exam.js';
import { buildKnowledge } from '../application/workflows/build_knowledge.js';
import { uploadLocalMaterial, MAX_UPLOAD_BYTES } from '../application/workflows/upload_material.js';
import { loadMaterialIndex } from '../agents/material_collector.js';
import { createSearchProvider } from '../application/ports/search_provider.js';
import { WebContentFetcher } from '../infrastructure/fetch/web_fetcher.js';
import { generatePlan, savePlan } from '../agents/planner.js';
import { loadWeaknessProfilePublic, explainWeakness } from '../agents/mistake_analyzer.js';
import { loadLearnerModel, saveLearnerModel, initLearnerModel } from '../agents/learner_model.js';
import type { UserAnswer } from '../agents/grader.js';
import type { LearnerBaseline } from '../domain/exam.js';
import type { SourceRecord } from '../domain/source.js';
import { addDaysToDateKey, todayDateKey } from '../core/date.js';
import { approvePlan } from '../application/workflows/approve_plan.js';
import { loadSessionHistory, buildTrend, buildTotals } from '../application/workflows/session_history.js';

import {
  buildAggregate,
  startSession,
  advanceSession,
  completeSession,
  explainConcept,
  generateSessionQuiz,
  gradeStudioSession,
} from '../application/workflows/study_session.js';

function defaultLLM(): LLMClient {
  if (process.env.OPENAI_API_KEY) {
    return createLLMClient();
  }
  return createMockLLMClient();
}

export interface AppOptions {
  /** Optional workspace override for isolated integration tests. */
  workspaceRoot?: string;
  /** Date provider for deterministic daily-route behavior. */
  today?: () => string;
  /** LLM client override（测试注入 Mock，避免真实 API 调用）。 */
  llm?: LLMClient;
  /** 覆盖“搜索可用”判定（默认读 SERP_API_KEY）。测试注入 false 可离线复现降级路径。 */
  hasSearchApiKey?: boolean;
  /** 覆盖访问 Token（默认读 STUDYMATE_ACCESS_TOKEN）。测试注入后无需改动环境变量。 */
  accessToken?: string;
}

export function createApp(options: AppOptions = {}) {
  const app = express();
  const todayProvider = options.today ?? todayDateKey;
  // 所有路由经由 resolvePaths 取路径：传入 workspaceRoot 时不再误写默认 workspace
  const P = resolvePaths(options.workspaceRoot);
  const taskEventLog = P.eventLog;
  const createLLM = (): LLMClient => options.llm ?? defaultLLM();

  // ── 访问控制与基础加固（公网/VPS 部署防护）────────────────────────
  // CORS：默认同源（不下发 CORS 头）；配置 ALLOWED_ORIGINS（逗号分隔）后仅放行列表内来源
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowedOrigins.length > 0) {
    app.use(
      cors({
        origin(origin, callback) {
          if (!origin || allowedOrigins.includes(origin)) callback(null, true);
          else callback(new Error('Not allowed by CORS'));
        },
      })
    );
  }

  // 请求体大小限制：全局 1MB；上传接口单独放宽（base64 编码约放大 4/3 倍）
  app.use('/api/materials/upload', express.json({ limit: '30mb' }));
  app.use(express.json({ limit: '1mb' }));

  // 应用级访问 Token：设置 STUDYMATE_ACCESS_TOKEN 后，未认证请求无法读写任何 API
  const accessToken = options.accessToken ?? process.env.STUDYMATE_ACCESS_TOKEN;
  if (accessToken) {
    app.use('/api', (req, res, next) => {
      const header = req.header('authorization');
      const bearer = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
      const provided =
        bearer ?? (req.header('x-access-token') as string | undefined) ??
        (req.query.access_token as string | undefined) ??
        (req.headers.cookie ?? '')
          .split(';')
          .map((c) => c.trim())
          .find((c) => c.startsWith('studymate_token='))
          ?.slice('studymate_token='.length);
      // 常数时间比较，避免时序侧信道
      const a = Buffer.from(String(provided ?? ''));
      const b = Buffer.from(accessToken);
      const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
      if (!ok) {
        return res.status(401).json({ error: 'Unauthorized: access token required' });
      }
      next();
    });
  }

  // 基础速率限制：每 IP 每分钟 RATE_LIMIT_PER_MINUTE（默认 300）次请求
  const rateLimitPerMinute = Number(process.env.RATE_LIMIT_PER_MINUTE ?? 300);
  const rateBuckets = new Map<string, { count: number; resetAt: number }>();
  if (Number.isFinite(rateLimitPerMinute) && rateLimitPerMinute > 0) {
    app.use('/api', (req, res, next) => {
      const key = req.ip ?? 'unknown';
      const now = Date.now();
      let bucket = rateBuckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
        bucket = { count: 0, resetAt: now + 60_000 };
        rateBuckets.set(key, bucket);
      }
      bucket.count++;
      res.setHeader('X-RateLimit-Limit', String(rateLimitPerMinute));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, rateLimitPerMinute - bucket.count)));
      if (bucket.count > rateLimitPerMinute) {
        return res.status(429).json({ error: 'Too many requests' });
      }
      next();
    });
  }

  // ── Status ──────────────────────────────────────────────────────────
  app.get('/api/status', async (_req, res) => {
    try {
      const project = await loadExamProject(options.workspaceRoot);
      const ctx = await gatherStudyContext(options.workspaceRoot);
      const buddyState = await loadBuddyState(options.workspaceRoot);
      res.json({
        exam: project ? { name: project.name, date: project.examDate, status: project.status } : null,
        daysToExam: ctx.daysToExam,
        avgMastery: ctx.avgMastery,
        streakDays: buddyState.streakDays,
        tasksToday: ctx.tasksToday,
        recentScore: ctx.recentScore,
        latestPlanAdjustment: ctx.latestPlanAdjustment,
        topWeakNode: ctx.weakNodeNames[0] ?? null,
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Exam Project ─────────────────────────────────────────────────
  app.get('/api/exam', async (_req, res) => {
    try {
      const project = await loadExamProject(options.workspaceRoot);
      res.json(project);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post('/api/exam/create', async (req, res) => {
    try {
      const {
        name,
        examDate,
        subjects,
        dailyMinutes,
        baseline,
        target,
        unavailableDates,
      } = req.body;
      if (!name || !examDate || !subjects || !dailyMinutes) {
        return res.status(400).json({ error: 'name, examDate, subjects, dailyMinutes are required' });
      }
      const project = await bootstrapExam({
        name,
        examDate,
        subjects: Array.isArray(subjects) ? subjects : subjects.split(',').map((s: string) => s.trim()),
        baseline: (baseline as LearnerBaseline) ?? 'beginner',
        dailyMinutes: parseInt(dailyMinutes, 10),
        target,
        unavailableDates: Array.isArray(unavailableDates) ? unavailableDates : [],
      }, P.eventLog, options.workspaceRoot);
      res.json(project);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post('/api/exam/research', async (_req, res) => {
    try {
      const project = await loadExamProject(options.workspaceRoot);
      if (!project) return res.status(400).json({ error: 'No exam project. Create one first.' });
      if (project.status !== 'draft') {
        return res.status(400).json({ error: `Current status is ${project.status}. Research requires draft status.` });
      }
      // 无搜索 Key 时明确降级：不再返回“0 来源但要求选择至少一个”的死路，
      // 而是引导用户上传本地资料（Exam 状态保持 draft，不推进）。
      const searchEnabled = options.hasSearchApiKey ?? Boolean(process.env.SERP_API_KEY);
      if (!searchEnabled) {
        return res.json({
          skipped: true,
          reason: 'search_disabled',
          message: '未配置 SERP_API_KEY，在线调研不可用。请上传本地 PDF/Markdown 资料继续建档。',
          sources: [],
          summary: null,
          sourceCount: 0,
          queryCount: 0,
        });
      }
      const llm = createLLM();
      const searchProvider = createSearchProvider();
      const result = await researchExamWorkflow(project, searchProvider, llm, P.eventLog, options.workspaceRoot);
      res.json({
        sources: result.research.sources,
        summary: result.research.summary,
        sourceCount: result.research.sources.length,
        queryCount: result.research.queryCount,
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get('/api/exam/research', async (_req, res) => {
    try {
      const sourcesPath = path.join(P.research, 'sources.jsonl');
      const content = await fs.readFile(sourcesPath, 'utf-8');
      const sources: SourceRecord[] = content
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));

      let profile = null;
      try {
        profile = JSON.parse(await fs.readFile(path.join(P.research, 'exam_profile.json'), 'utf-8'));
      } catch { /* no profile */ }

      res.json({ sources, profile });
    } catch {
      res.json({ sources: [], profile: null });
    }
  });

  app.post('/api/exam/sources/approve', async (req, res) => {
    try {
      const { ids } = req.body as { ids: string[] };
      if (!ids || !Array.isArray(ids)) {
        return res.status(400).json({ error: 'ids array is required' });
      }
      const project = await loadExamProject(options.workspaceRoot);
      if (!project) return res.status(400).json({ error: 'No exam project.' });
      const sources = await approveSources(project, ids, P.eventLog, options.workspaceRoot);
      const approvedCount = sources.filter((s) => s.approved).length;
      res.json({ approvedCount, totalSources: sources.length });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Knowledge ─────────────────────────────────────────────────────
  app.post('/api/knowledge/build', async (_req, res) => {
    try {
      const llm = createLLM();
      const fetcher = new WebContentFetcher();
      const result = await buildKnowledge({ fetcher, llm, eventLogFile: P.eventLog, workspaceRoot: options.workspaceRoot });
      res.json(result);
    } catch (err) {
      // 零材料/零概念等可操作错误返回 400，Exam 状态未被推进
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/api/knowledge/status', async (_req, res) => {
    try {
      const conceptMap = JSON.parse(await fs.readFile(path.join(P.graph, 'concepts.json'), 'utf-8'));
      res.json({
        conceptCount: conceptMap.concepts.length,
        concepts: conceptMap.concepts.slice(0, 20).map((c: { id: string; name: string; mastery: number }) => ({
          id: c.id, name: c.name, mastery: c.mastery,
        })),
      });
    } catch {
      res.json({ conceptCount: 0, concepts: [] });
    }
  });

  // ── Local Materials（无搜索 Key 的本地资料闭环）────────────────────
  app.get('/api/materials', async (_req, res) => {
    try {
      const materials = await loadMaterialIndex(
        options.workspaceRoot ? path.join(options.workspaceRoot, 'materials') : Paths.materials
      );
      res.json({
        materials: materials.map((m) => ({
          id: m.id,
          title: m.title,
          type: m.type,
          wordCount: m.meta.wordCount,
          capturedAt: m.meta.capturedAt,
          version: m.version,
        })),
      });
    } catch {
      res.json({ materials: [] });
    }
  });

  app.post('/api/materials/upload', async (req, res) => {
    try {
      const { filename, contentBase64 } = req.body ?? {};
      if (!filename || typeof filename !== 'string') {
        return res.status(400).json({ error: 'filename is required' });
      }
      if (!contentBase64 || typeof contentBase64 !== 'string') {
        return res.status(400).json({ error: 'contentBase64 is required' });
      }
      const buffer = Buffer.from(contentBase64, 'base64');
      if (buffer.length > MAX_UPLOAD_BYTES) {
        return res.status(413).json({ error: `File too large. Limit: 20MB (decoded).` });
      }
      const { material, chunks } = await uploadLocalMaterial({
        filename,
        buffer,
        eventLogFile: P.eventLog,
        workspaceRoot: options.workspaceRoot,
      });
      res.json({
        material: {
          id: material.id,
          title: material.title,
          type: material.type,
          wordCount: material.meta.wordCount,
        },
        chunkCount: chunks.length,
      });
    } catch (err) {
      // 类型不支持 / 空文件等：材料与 Exam 状态均未改变
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── SM-2 Spaced Repetition State ──────────────────────────────────
  app.get('/api/concepts/sr-state', async (_req, res) => {
    try {
      const conceptMap = JSON.parse(await fs.readFile(path.join(P.graph, 'concepts.json'), 'utf-8'));
      const srStates = conceptMap.concepts.map((c: { id: string; name: string; mastery: number; srState?: unknown }) => ({
        id: c.id,
        name: c.name,
        mastery: c.mastery,
        srState: c.srState ?? null,
      }));
      res.json({ concepts: srStates });
    } catch {
      res.json({ concepts: [] });
    }
  });

  app.get('/api/concepts/:id/sr-state', async (req, res) => {
    try {
      const { id } = req.params;
      const conceptMap = JSON.parse(await fs.readFile(path.join(P.graph, 'concepts.json'), 'utf-8'));
      const concept = conceptMap.concepts.find((c: { id: string }) => c.id === id);
      if (!concept) {
        return res.status(404).json({ error: `Concept ${id} not found` });
      }
      res.json({
        id: concept.id,
        name: concept.name,
        mastery: concept.mastery,
        srState: concept.srState ?? null,
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Learner Model ────────────────────────────────────────────────
  app.get('/api/learner/profile', async (_req, res) => {
    try {
      const model = await loadLearnerModel(options.workspaceRoot);
      if (!model) {
        return res.json({ exists: false, profile: null });
      }
      res.json({ exists: true, profile: model });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get('/api/learner/insights', async (_req, res) => {
    try {
      const model = await loadLearnerModel(options.workspaceRoot);
      if (!model) {
        return res.json({ insights: [] });
      }
      res.json({ insights: model.insights });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get('/api/learner/performance', async (_req, res) => {
    try {
      const model = await loadLearnerModel(options.workspaceRoot);
      if (!model) {
        return res.json({ scoreHistory: [], masteryHistory: [] });
      }
      res.json({
        scoreHistory: model.performance.scoreHistory,
        masteryHistory: model.performance.masteryHistory,
        overallAccuracy: model.performance.overallAccuracy,
        totalSessions: model.performance.totalSessions,
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post('/api/learner/init', async (req, res) => {
    try {
      const { baseline, dailyMinutes } = req.body;
      const exam = await loadExamProject(options.workspaceRoot);
      const examId = exam?.id ?? 'default';
      const model = await initLearnerModel(
        examId,
        (baseline as LearnerBaseline) ?? 'intermediate',
        parseInt(dailyMinutes ?? '60', 10)
      );
      await saveLearnerModel(model, options.workspaceRoot);
      res.json({ success: true, profile: model });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Plan Generation ────────────────────────────────────────────────
  app.post('/api/plan/generate', async (req, res) => {
    try {
      const { examDate, dailyMinutes, unavailableDates } = req.body;
      const conceptMap = JSON.parse(await fs.readFile(path.join(P.graph, 'concepts.json'), 'utf-8'));
      if (!conceptMap.concepts.length) {
        return res.status(400).json({ error: 'No concepts found. Build knowledge first.' });
      }
      const exam = await loadExamProject(options.workspaceRoot);
      const plan = generatePlan(conceptMap, {
        examDate: examDate ?? exam?.examDate ?? addDaysToDateKey(todayProvider(), 30),
        dailyMinutes: parseInt(dailyMinutes ?? String(exam?.learnerProfile.dailyMinutes ?? 60), 10),
        unavailableDates: Array.isArray(unavailableDates)
          ? unavailableDates
          : exam?.learnerProfile.unavailableDates,
      });
      await savePlan(plan, P.eventLog, options.workspaceRoot);

      // Update exam status to 'planned' if applicable
      if (exam?.status === 'materials_ready') {
        const { transitionStatus } = await import('../domain/exam.js');
        const updated = transitionStatus(exam, 'planned');
        await saveExamProject(updated, options.workspaceRoot);
      }

      res.json(plan);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post('/api/plan/approve', async (_req, res) => {
    try {
      const exam = await approvePlan(P.eventLog, options.workspaceRoot);
      res.json({ ok: true, exam });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── Plan ────────────────────────────────────────────────────────────
  app.get('/api/plan/today', async (_req, res) => {
    try {
      const today = todayProvider();
      res.json(await prepareTasksForDate(today, taskEventLog, options.workspaceRoot));
    } catch {
      res.json({ date: todayProvider(), tasks: [] });
    }
  });

  app.get('/api/plan/master', async (_req, res) => {
    try {
      const plan = JSON.parse(await fs.readFile(path.join(P.plan, 'plan_master.json'), 'utf-8'));
      res.json(plan);
    } catch {
      res.json(null);
    }
  });

  // ── Concepts ────────────────────────────────────────────────────────
  app.get('/api/concepts', async (_req, res) => {
    try {
      const conceptMap = JSON.parse(await fs.readFile(path.join(P.graph, 'concepts.json'), 'utf-8'));
      res.json(conceptMap);
    } catch {
      res.json({ concepts: [], learningOrder: [] });
    }
  });

  // ── Quiz ────────────────────────────────────────────────────────────
  app.get('/api/quiz/today', async (_req, res) => {
    try {
      const today = todayProvider();
      const quiz = JSON.parse(await fs.readFile(path.join(P.quizzes, `${today}_quiz.json`), 'utf-8'));
      res.json(quiz);
    } catch {
      res.json(null);
    }
  });

  app.post('/api/quiz/generate', async (req, res) => {
    try {
      const { count = 5, allowMulti = true } = req.body ?? {};
      const llm = createLLM();
      const today = todayProvider();
      const conceptMap = JSON.parse(await fs.readFile(path.join(P.graph, 'concepts.json'), 'utf-8'));

      const config: QuizConfig = { questionCount: count, allowMultiChoice: allowMulti };

      let todayPlan;
      try {
        todayPlan = JSON.parse(await fs.readFile(path.join(P.plan, 'plan_daily', `${today}.json`), 'utf-8'));
      } catch { /* no plan */ }

      let weaknessProfile;
      try {
        weaknessProfile = JSON.parse(await fs.readFile(path.join(P.mistakes, 'weakness_profile.json'), 'utf-8'));
      } catch { /* no profile */ }

      const scope = selectQuizScope(todayPlan, conceptMap, weaknessProfile);
      const quiz = await generateScopedQuiz(scope, config, llm, today, P.eventLog, options.workspaceRoot);
      res.json(quiz);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Grade ───────────────────────────────────────────────────────────
  app.post('/api/grade', async (req, res) => {
    try {
      const { answers } = req.body as { answers: UserAnswer[] };
      const today = todayProvider();
      const quiz = JSON.parse(await fs.readFile(path.join(P.quizzes, `${today}_quiz.json`), 'utf-8'));

      const result = await gradeAndAdapt({
        quiz,
        answers,
        conceptsPath: path.join(P.graph, 'concepts.json'),
        planPath: path.join(P.plan, 'plan_master.json'),
        eventLogFile: P.eventLog,
        workspaceRoot: options.workspaceRoot,
      });
      res.json({
        ...result,
        score: result.result.totalScore,
        total: result.result.details.length,
        correct: result.result.details.filter((d) => d.isCorrect).length,
        results: result.result.details.map((d) => ({
          questionId: d.question.id,
          correct: d.isCorrect,
          score: d.score,
          errorType: result.mistakes.find((m) => m.questionId === d.question.id)?.errorType,
        })),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes('already been graded') ? 409 : 500;
      res.status(status).json({ error: message });
    }
  });

  // ── Metrics ─────────────────────────────────────────────────────────
  app.get('/api/metrics', async (_req, res) => {
    try {
      const metrics = await computeMetrics(options.workspaceRoot);
      res.json(metrics);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Weakness ────────────────────────────────────────────────────────
  app.get('/api/weakness', async (_req, res) => {
    try {
      const profile = await loadWeaknessProfilePublic(options.workspaceRoot);
      const explanations: Record<string, string> = {};
      for (const nodeId of Object.keys(profile.nodes)) {
        explanations[nodeId] = explainWeakness(nodeId, profile);
      }
      res.json({ profile, explanations });
    } catch {
      res.json({ profile: { lastUpdated: '', nodes: {} }, explanations: {} });
    }
  });

  // ── Tasks ───────────────────────────────────────────────────────────
  app.post('/api/task/:id/done', async (req, res) => {
    try {
      const taskId = req.params.id;
      const dateMatch = taskId.match(/task_(\d{4}-\d{2}-\d{2})_/);
      if (!dateMatch) return res.status(400).json({ error: 'Invalid task ID format' });
      await completeTask(dateMatch[1], taskId, 'done', taskEventLog, options.workspaceRoot);
      res.json({ ok: true, taskId, status: 'done' });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post('/api/task/:id/skip', async (req, res) => {
    try {
      const taskId = req.params.id;
      const dateMatch = taskId.match(/task_(\d{4}-\d{2}-\d{2})_/);
      if (!dateMatch) return res.status(400).json({ error: 'Invalid task ID format' });
      await completeTask(dateMatch[1], taskId, 'skipped', taskEventLog, options.workspaceRoot);
      res.json({ ok: true, taskId, status: 'skipped' });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Session History ────────────────────────────────────────────
  app.get('/api/sessions', async (_req, res) => {
    try {
      const history = await loadSessionHistory(options.workspaceRoot);
      res.json({
        sessions: history.slice().reverse(),
        trend: buildTrend(history),
        totals: buildTotals(history),
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Study Studio ───────────────────────────────────────────────
  app.get('/api/studio', async (_req, res) => {
    try {
      const aggregate = await buildAggregate({
        today: todayProvider(),
        taskEventLog,
        workspaceRoot: options.workspaceRoot,
      });
      res.json(aggregate);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post('/api/studio/start', async (req, res) => {
    try {
      const { taskId } = req.body ?? {};
      const aggregate = await startSession({
        today: todayProvider(),
        taskEventLog,
        workspaceRoot: options.workspaceRoot,
        taskId,
      });
      res.json(aggregate);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/studio/advance', async (req, res) => {
    try {
      const { fromStage } = req.body ?? {};
      // grade 阶段推进已迁移到 /api/studio/grade：advance 不再接受成绩/掌握度，
      // 服务端是唯一事实源，前端无法伪造分数。
      const aggregate = await advanceSession({
        today: todayProvider(),
        taskEventLog,
        workspaceRoot: options.workspaceRoot,
        fromStage,
      });
      res.json(aggregate);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Session 绑定出题：Quiz 范围 = 当前任务概念 + 历史薄弱点补充，绑定 sessionId
  app.post('/api/studio/quiz', async (_req, res) => {
    try {
      const quiz = await generateSessionQuiz({
        today: todayProvider(),
        taskEventLog,
        workspaceRoot: options.workspaceRoot,
        llm: createLLM(),
      });
      res.json(quiz);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // 服务端原子批改：批改 → 错题 → 掌握度 → 计划调整 → Session 推进
  app.post('/api/studio/grade', async (req, res) => {
    try {
      const { sessionId, quizId, answers } = req.body ?? {};
      if (!sessionId || !quizId || !Array.isArray(answers)) {
        return res.status(400).json({ error: 'sessionId, quizId, answers are required' });
      }
      const result = await gradeStudioSession({
        today: todayProvider(),
        taskEventLog,
        workspaceRoot: options.workspaceRoot,
        sessionId,
        quizId,
        answers,
      });
      res.json({ ...result.aggregate, grade: result.grade });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // 同一 Quiz 不同答案重试 → 409，不再修改掌握度
      const status = message.includes('already been graded') ? 409 : 400;
      res.status(status).json({ error: message });
    }
  });

  app.post('/api/studio/complete', async (_req, res) => {
    try {
      const aggregate = await completeSession({
        today: todayProvider(),
        taskEventLog,
        workspaceRoot: options.workspaceRoot,
      });
      // 完成学习 → 更新连续学习与关系（updateStreak 同天 no-op，幂等）
      const buddyState = await loadBuddyState(options.workspaceRoot);
      let updated = updateStreak(buddyState, todayProvider());
      updated = increaseRelationship(updated, 2);
      await saveBuddyState(updated, options.workspaceRoot);
      const activity = deriveCompanionActivity(
        updated.preferences.companionMode ?? 'companion',
        updated.streakDays
      );
      const milestoneHit = STREAK_MILESTONES.includes(updated.streakDays);
      res.json({ ...aggregate, buddy: { streakDays: updated.streakDays, activity, milestoneHit } });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/studio/explain', async (req, res) => {
    try {
      const { conceptId, chunkIds } = req.body ?? {};
      if (!conceptId) return res.status(400).json({ error: 'conceptId is required' });
      const result = await explainConcept({
        conceptId,
        chunkIds: Array.isArray(chunkIds) ? chunkIds : undefined,
        llm: createLLM(),
        workspaceRoot: options.workspaceRoot,
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Buddy ───────────────────────────────────────────────────────────
  app.get('/api/buddy/state', async (_req, res) => {
    try {
      const state = await loadBuddyState(options.workspaceRoot);
      const character = await loadCharacter(state.characterId).catch(() => getSelectedCharacter());
      const history = await loadChatHistory(P.buddyChatHistory);
      res.json({
      state,
      character,
      recentHistory: history.slice(-20),
      activity: deriveCompanionActivity(state.preferences.companionMode ?? 'companion', state.streakDays),
    });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post('/api/buddy/chat', async (req, res) => {
    try {
      const { message } = req.body as { message: string };
      if (!message || typeof message !== 'string') {
        return res.status(400).json({ error: 'message is required' });
      }
      const state = await loadBuddyState(options.workspaceRoot);
      const character = await loadCharacter(state.characterId).catch(() => getSelectedCharacter());
      const ctx = await gatherStudyContext(options.workspaceRoot);
      const llm = createLLM();

      const reply = await buddyChat(message, character, ctx, llm, P.eventLog, P.buddyChatHistory);

      // Update streak and relationship on chat
      const today = todayProvider();
      let updated = updateStreak(state, today);
      updated = increaseRelationship(updated, 1);
      await saveBuddyState(updated, options.workspaceRoot);

      res.json({ reply });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get('/api/buddy/intervene/:moment', async (req, res) => {
    try {
      const moment = req.params.moment as InterventionMoment;
      const state = await loadBuddyState(options.workspaceRoot);
      const character = await loadCharacter(state.characterId).catch(() => getSelectedCharacter());
      const ctx = await gatherStudyContext(options.workspaceRoot);
      const llm = createLLM();

      const extra = {
        score: req.query.score ? Number(req.query.score) : undefined,
        masteryDelta: req.query.masteryDelta ? Number(req.query.masteryDelta) : undefined,
      };

      if (!shouldIntervene(moment, state, ctx, extra)) {
        return res.json({ shouldIntervene: false, line: '' });
      }

      const line = await generateIntervention(moment, character, state, ctx, llm, extra);
      res.json({ shouldIntervene: true, line });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Characters ──────────────────────────────────────────────────────
  app.get('/api/characters', async (_req, res) => {
    try {
      const characters = await listCharacters();
      const state = await loadBuddyState(options.workspaceRoot);
      res.json({ characters, selectedId: state.characterId });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post('/api/characters/select', async (req, res) => {
    try {
      const { characterId } = req.body as { characterId: string };
      await loadCharacter(characterId); // validate exists
      const state = await loadBuddyState(options.workspaceRoot);
      state.characterId = characterId;
      await saveBuddyState(state, options.workspaceRoot);
      res.json({ ok: true, characterId });
    } catch (err) {
      res.status(400).json({ error: `Character not found: ${req.body?.characterId}` });
    }
  });

  app.post('/api/buddy/preferences', async (req, res) => {
    try {
      const { reminderIntensity, emotionalStyle, formOfAddress, companionMode } = req.body;
      const state = await loadBuddyState(options.workspaceRoot);
      if (reminderIntensity) state.preferences.reminderIntensity = reminderIntensity;
      if (emotionalStyle) state.preferences.emotionalStyle = emotionalStyle;
      if (formOfAddress !== undefined) state.preferences.formOfAddress = formOfAddress;
      if (companionMode) state.preferences.companionMode = companionMode;
      await saveBuddyState(state, options.workspaceRoot);
      res.json({ ok: true, preferences: state.preferences });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return app;
}
