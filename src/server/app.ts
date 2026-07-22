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
import { completeTask } from '../agents/task_dispatcher.js';
import { loadExamProject } from '../application/workflows/bootstrap_exam.js';
import { loadWeaknessProfilePublic, explainWeakness } from '../agents/mistake_analyzer.js';
import type { UserAnswer } from '../agents/grader.js';

function createLLM() {
  if (process.env.OPENAI_API_KEY) {
    return createLLMClient();
  }
  return createMockLLMClient();
}

export function createApp() {
  const app = express();
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

  // ── Plan ────────────────────────────────────────────────────────────
  app.get('/api/plan/today', async (_req, res) => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const planPath = path.join(Paths.plan, 'plan_daily', `${today}.json`);
      const plan = JSON.parse(await fs.readFile(planPath, 'utf-8'));
      res.json(plan);
    } catch {
      res.json({ date: new Date().toISOString().split('T')[0], tasks: [] });
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
      const today = new Date().toISOString().split('T')[0];
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
      const today = new Date().toISOString().split('T')[0];
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
      const today = new Date().toISOString().split('T')[0];
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
      res.status(500).json({ error: String(err) });
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
      await completeTask(dateMatch[1], taskId, 'done', Paths.eventLog);
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
      await completeTask(dateMatch[1], taskId, 'skipped', Paths.eventLog);
      res.json({ ok: true, taskId, status: 'skipped' });
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
      const today = new Date().toISOString().split('T')[0];
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
      const { reminderIntensity, emotionalStyle, formOfAddress } = req.body;
      const state = await loadBuddyState();
      if (reminderIntensity) state.preferences.reminderIntensity = reminderIntensity;
      if (emotionalStyle) state.preferences.emotionalStyle = emotionalStyle;
      if (formOfAddress !== undefined) state.preferences.formOfAddress = formOfAddress;
      await saveBuddyState(state);
      res.json({ ok: true, preferences: state.preferences });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return app;
}
