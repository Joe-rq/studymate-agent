import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import { Paths } from '../core/paths.js';
import { createLLMClient } from '../core/llm.js';
import { createMockLLMClient } from '../core/mock_llm.js';
import { gatherStudyContext } from '../core/context_reader.js';
import { loadCharacter, listCharacters, getSelectedCharacter } from '../core/character.js';
import { loadBuddyState, saveBuddyState, updateStreak, increaseRelationship } from '../agents/buddy_state.js';
import { buddyChat, loadChatHistory } from '../agents/study_buddy.js';
import { shouldIntervene, generateIntervention, type InterventionMoment } from '../agents/buddy_interventions.js';
import { selectQuizScope, generateScopedQuiz, type QuizConfig } from '../agents/quiz_generator.js';
import { gradeAndAdapt } from '../application/workflows/grade_and_adapt.js';
import { computeMetrics } from '../agents/metrics.js';
import { completeTask, prepareTasksForDate } from '../agents/task_dispatcher.js';
import { bootstrapExam, loadExamProject, saveExamProject } from '../application/workflows/bootstrap_exam.js';
import { researchExamWorkflow, approveSources } from '../application/workflows/research_exam.js';
import { buildKnowledge } from '../application/workflows/build_knowledge.js';
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

import {
  buildAggregate,
  startSession,
  advanceSession,
  completeSession,
  explainConcept,
} from '../application/workflows/study_session.js';

function createLLM() {
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
}

export function createApp(options: AppOptions = {}) {
  const app = express();
  const todayProvider = options.today ?? todayDateKey;
  const taskEventLog = options.workspaceRoot
    ? path.join(options.workspaceRoot, 'event_log', 'events.jsonl')
    : Paths.eventLog;
  app.use(cors());
  app.use(express.json());

  // ── Status ──────────────────────────────────────────────────────────
  app.get('/api/status', async (_req, res) => {
    try {
      const project = await loadExamProject();
      const ctx = await gatherStudyContext();
      const buddyState = await loadBuddyState();
      res.json({
        exam: project ? { name: project.name, date: project.examDate, status: project.status } : null,
        daysToExam: ctx.daysToExam,
        avgMastery: ctx.avgMastery,
        streakDays: buddyState.streakDays,
        tasksToday: ctx.tasksToday,
        recentScore: ctx.recentScore,
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Exam Project ─────────────────────────────────────────────────
  app.get('/api/exam', async (_req, res) => {
    try {
      const project = await loadExamProject();
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
      });
      res.json(project);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post('/api/exam/research', async (_req, res) => {
    try {
      const project = await loadExamProject();
      if (!project) return res.status(400).json({ error: 'No exam project. Create one first.' });
      if (project.status !== 'draft') {
        return res.status(400).json({ error: `Current status is ${project.status}. Research requires draft status.` });
      }
      const llm = createLLM();
      const searchProvider = createSearchProvider();
      const result = await researchExamWorkflow(project, searchProvider, llm, Paths.eventLog);
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
      const sourcesPath = path.join(Paths.research, 'sources.jsonl');
      const content = await fs.readFile(sourcesPath, 'utf-8');
      const sources: SourceRecord[] = content
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));

      let profile = null;
      try {
        profile = JSON.parse(await fs.readFile(path.join(Paths.research, 'exam_profile.json'), 'utf-8'));
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
      const project = await loadExamProject();
      if (!project) return res.status(400).json({ error: 'No exam project.' });
      const sources = await approveSources(project, ids, Paths.eventLog);
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
      const result = await buildKnowledge({ fetcher, llm });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get('/api/knowledge/status', async (_req, res) => {
    try {
      const conceptMap = JSON.parse(await fs.readFile(path.join(Paths.graph, 'concepts.json'), 'utf-8'));
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

  // ── SM-2 Spaced Repetition State ──────────────────────────────────
  app.get('/api/concepts/sr-state', async (_req, res) => {
    try {
      const conceptMap = JSON.parse(await fs.readFile(path.join(Paths.graph, 'concepts.json'), 'utf-8'));
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
      const conceptMap = JSON.parse(await fs.readFile(path.join(Paths.graph, 'concepts.json'), 'utf-8'));
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
      const model = await loadLearnerModel();
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
      const model = await loadLearnerModel();
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
      const model = await loadLearnerModel();
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
      const exam = await loadExamProject();
      const examId = exam?.id ?? 'default';
      const model = await initLearnerModel(
        examId,
        (baseline as LearnerBaseline) ?? 'intermediate',
        parseInt(dailyMinutes ?? '60', 10)
      );
      await saveLearnerModel(model);
      res.json({ success: true, profile: model });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Plan Generation ────────────────────────────────────────────────
  app.post('/api/plan/generate', async (req, res) => {
    try {
      const { examDate, dailyMinutes, unavailableDates } = req.body;
      const conceptMap = JSON.parse(await fs.readFile(path.join(Paths.graph, 'concepts.json'), 'utf-8'));
      if (!conceptMap.concepts.length) {
        return res.status(400).json({ error: 'No concepts found. Build knowledge first.' });
      }
      const exam = await loadExamProject();
      const plan = generatePlan(conceptMap, {
        examDate: examDate ?? exam?.examDate ?? addDaysToDateKey(todayProvider(), 30),
        dailyMinutes: parseInt(dailyMinutes ?? String(exam?.learnerProfile.dailyMinutes ?? 60), 10),
        unavailableDates: Array.isArray(unavailableDates)
          ? unavailableDates
          : exam?.learnerProfile.unavailableDates,
      });
      await savePlan(plan, Paths.eventLog);

      // Update exam status to 'planned' if applicable
      if (exam?.status === 'materials_ready') {
        const { transitionStatus } = await import('../domain/exam.js');
        const updated = transitionStatus(exam, 'planned');
        await saveExamProject(updated);
      }

      res.json(plan);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post('/api/plan/approve', async (_req, res) => {
    try {
      const exam = await approvePlan(Paths.eventLog);
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
      const plan = JSON.parse(await fs.readFile(path.join(Paths.plan, 'plan_master.json'), 'utf-8'));
      res.json(plan);
    } catch {
      res.json(null);
    }
  });

  // ── Concepts ────────────────────────────────────────────────────────
  app.get('/api/concepts', async (_req, res) => {
    try {
      const conceptMap = JSON.parse(await fs.readFile(path.join(Paths.graph, 'concepts.json'), 'utf-8'));
      res.json(conceptMap);
    } catch {
      res.json({ concepts: [], learningOrder: [] });
    }
  });

  // ── Quiz ────────────────────────────────────────────────────────────
  app.get('/api/quiz/today', async (_req, res) => {
    try {
      const today = todayProvider();
      const quiz = JSON.parse(await fs.readFile(path.join(Paths.quizzes, `${today}_quiz.json`), 'utf-8'));
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
      const conceptMap = JSON.parse(await fs.readFile(path.join(Paths.graph, 'concepts.json'), 'utf-8'));

      const config: QuizConfig = { questionCount: count, allowMultiChoice: allowMulti };

      let todayPlan;
      try {
        todayPlan = JSON.parse(await fs.readFile(path.join(Paths.plan, 'plan_daily', `${today}.json`), 'utf-8'));
      } catch { /* no plan */ }

      let weaknessProfile;
      try {
        weaknessProfile = JSON.parse(await fs.readFile(path.join(Paths.mistakes, 'weakness_profile.json'), 'utf-8'));
      } catch { /* no profile */ }

      const scope = selectQuizScope(todayPlan, conceptMap, weaknessProfile);
      const quiz = await generateScopedQuiz(scope, config, llm, today, Paths.eventLog);
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
      const quiz = JSON.parse(await fs.readFile(path.join(Paths.quizzes, `${today}_quiz.json`), 'utf-8'));

      const result = await gradeAndAdapt({
        quiz,
        answers,
        conceptsPath: path.join(Paths.graph, 'concepts.json'),
        planPath: path.join(Paths.plan, 'plan_master.json'),
        eventLogFile: Paths.eventLog,
      });
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes('already been graded') ? 409 : 500;
      res.status(status).json({ error: message });
    }
  });

  // ── Metrics ─────────────────────────────────────────────────────────
  app.get('/api/metrics', async (_req, res) => {
    try {
      const metrics = await computeMetrics();
      res.json(metrics);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Weakness ────────────────────────────────────────────────────────
  app.get('/api/weakness', async (_req, res) => {
    try {
      const profile = await loadWeaknessProfilePublic();
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
      const { fromStage, grade, masteryChanges } = req.body ?? {};
      const aggregate = await advanceSession({
        today: todayProvider(),
        taskEventLog,
        workspaceRoot: options.workspaceRoot,
        fromStage,
        grade,
        masteryChanges,
      });
      res.json(aggregate);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/studio/complete', async (_req, res) => {
    try {
      const aggregate = await completeSession({
        today: todayProvider(),
        taskEventLog,
        workspaceRoot: options.workspaceRoot,
      });
      res.json(aggregate);
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
      const state = await loadBuddyState();
      const character = await loadCharacter(state.characterId).catch(() => getSelectedCharacter());
      const history = await loadChatHistory();
      res.json({ state, character, recentHistory: history.slice(-20) });
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
      const state = await loadBuddyState();
      const character = await loadCharacter(state.characterId).catch(() => getSelectedCharacter());
      const ctx = await gatherStudyContext();
      const llm = createLLM();

      const reply = await buddyChat(message, character, ctx, llm, Paths.eventLog);

      // Update streak and relationship on chat
      const today = todayProvider();
      let updated = updateStreak(state, today);
      updated = increaseRelationship(updated, 1);
      await saveBuddyState(updated);

      res.json({ reply });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get('/api/buddy/intervene/:moment', async (req, res) => {
    try {
      const moment = req.params.moment as InterventionMoment;
      const state = await loadBuddyState();
      const character = await loadCharacter(state.characterId).catch(() => getSelectedCharacter());
      const ctx = await gatherStudyContext();
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
      const state = await loadBuddyState();
      res.json({ characters, selectedId: state.characterId });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post('/api/characters/select', async (req, res) => {
    try {
      const { characterId } = req.body as { characterId: string };
      await loadCharacter(characterId); // validate exists
      const state = await loadBuddyState();
      state.characterId = characterId;
      await saveBuddyState(state);
      res.json({ ok: true, characterId });
    } catch (err) {
      res.status(400).json({ error: `Character not found: ${req.body?.characterId}` });
    }
  });

  app.post('/api/buddy/preferences', async (req, res) => {
    try {
      const { reminderIntensity, emotionalStyle, formOfAddress, companionMode } = req.body;
      const state = await loadBuddyState();
      if (reminderIntensity) state.preferences.reminderIntensity = reminderIntensity;
      if (emotionalStyle) state.preferences.emotionalStyle = emotionalStyle;
      if (formOfAddress !== undefined) state.preferences.formOfAddress = formOfAddress;
      if (companionMode) state.preferences.companionMode = companionMode;
      await saveBuddyState(state);
      res.json({ ok: true, preferences: state.preferences });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return app;
}
