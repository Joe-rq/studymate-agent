#!/usr/bin/env node
import { config } from 'dotenv';
import { existsSync } from 'fs';
import path from 'path';

// Load environment variables from .env.local if it exists
const envLocalPath = path.join(process.cwd(), '.env.local');
if (existsSync(envLocalPath)) {
  config({ path: envLocalPath });
}

import { program } from 'commander';
import fs from 'fs/promises';
import readline from 'readline';
import { initWorkspace } from './core/workspace.js';
import { Paths } from './core/paths.js';
import { importPDF, importMarkdown } from './agents/material_collector.js';
import { chunkMaterial } from './agents/chunker.js';
import { mapConcepts } from './agents/concept_mapper.js';
import { generatePlan, savePlan, formatPlanSummary } from './agents/planner.js';
import { completeTask, prepareTasksForDate } from './agents/task_dispatcher.js';
import { generateQuiz, selectQuizScope, generateScopedQuiz, type QuizConfig } from './agents/quiz_generator.js';
import { gradeAndAdapt } from './application/workflows/grade_and_adapt.js';
import { qualityLabel, daysUntilDue } from './agents/spaced_repetition.js';
import { computeMetrics } from './agents/metrics.js';
import {
  bootstrapExam,
  loadExamProject,
  saveExamProject,
} from './application/workflows/bootstrap_exam.js';
import { researchExamWorkflow, approveSources } from './application/workflows/research_exam.js';
import { MockSearchProvider, createSearchProvider } from './application/ports/search_provider.js';
import { buildKnowledge } from './application/workflows/build_knowledge.js';
import { WebContentFetcher } from './infrastructure/fetch/web_fetcher.js';
import { loadMaterialIndex } from './agents/material_collector.js';
import { transitionStatus, type LearnerBaseline } from './domain/exam.js';
import type { SourceRecord } from './domain/source.js';
import { createLLMClient } from './core/llm.js';
import { createMockLLMClient } from './core/mock_llm.js';
import {
  listCharacters,
  loadCharacter,
  getSelectedCharacter,
  saveSelectedCharacter,
} from './core/character.js';
import { gatherStudyContext } from './core/context_reader.js';
import { buddyChat, buddyInterject, loadChatHistory } from './agents/study_buddy.js';
import {
  shouldIntervene,
  generateIntervention,
  type InterventionMoment,
  type InterventionContext,
} from './agents/buddy_interventions.js';
import {
  loadBuddyState,
  saveBuddyState,
  updateStreak,
  addMemory,
  increaseRelationship,
} from './agents/buddy_state.js';
import {
  loadLearnerModel,
  saveLearnerModel,
  initLearnerModel,
  formatLearnerProfile,
  formatInsights,
} from './agents/learner_model.js';
import { todayDateKey } from './core/date.js';
import { approvePlan } from './application/workflows/approve_plan.js';

function createLLM() {
  if (process.env.OPENAI_API_KEY) {
    return createLLMClient();
  }
  console.warn('Warning: OPENAI_API_KEY not set, using mock LLM for demo');
  return createMockLLMClient();
}

/**
 * 在 today/quiz/grade 等命令末尾植入一句搭子台词。
 * 静默失败：任何错误（无角色文件、LLM 失败）都不阻塞主流程。
 */
async function buddyLine(
  event: 'today' | 'quiz' | 'grade',
  extra?: { score?: number }
): Promise<void> {
  try {
    const character = await getSelectedCharacter();
    const ctx = await gatherStudyContext();
    const llm = createLLM();
    const line = await buddyInterject(event, character, ctx, llm, extra);
    if (line) {
      console.log(`\n${character.avatar} ${character.name}：${line}`);
    }
  } catch {
    // 搭子台词是锦上添花，失败不影响主命令
  }
}

/**
 * Trigger new intervention system at key moments.
 * Uses BuddyState for cross-session memory.
 */
async function triggerIntervention(
  moment: InterventionMoment,
  extra?: InterventionContext
): Promise<void> {
  try {
    const state = await loadBuddyState();
    const character = await loadCharacter(state.characterId).catch(() => getSelectedCharacter());
    const ctx = await gatherStudyContext();
    if (!shouldIntervene(moment, state, ctx, extra)) return;
    const llm = createLLM();
    const line = await generateIntervention(moment, character, state, ctx, llm, extra);
    if (line) {
      console.log(`\n${character.avatar} ${character.name}：${line}`);
    }
    // Update streak + relationship on intervention
    const today = todayDateKey();
    let updated = updateStreak(state, today);
    updated = increaseRelationship(updated, 1);
    await saveBuddyState(updated);
  } catch {
    // Intervention failure is non-fatal
  }
}

program
  .name('studymate')
  .description('AI-powered personal exam preparation agent')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize workspace')
  .action(async () => {
    await initWorkspace();
    console.log('Workspace initialized at ./workspace');
  });

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

program
  .command('plan')
  .description('Generate study plan')
  .requiredOption('--exam <date>', 'Exam date YYYY-MM-DD')
  .requiredOption('--daily <minutes>', 'Daily minutes')
  .option('--unavailable <dates>', 'Comma-separated unavailable dates')
  .option('--yes', 'Skip confirmation prompt')
  .action(async (options: { exam: string; daily: string; unavailable?: string; yes?: boolean }) => {
    const llm = createLLM();
    const chunkFiles = await fs.readdir(Paths.chunks).catch(() => []);
    if (chunkFiles.length === 0) {
      console.error('No chunks found. Run: studymate ingest <pdf|md>');
      process.exit(1);
    }

    const chunks = await Promise.all(
      chunkFiles
        .filter((f) => f.endsWith('.md'))
        .map(async (f, i) => ({
          id: `chunk_${String(i + 1).padStart(3, '0')}`,
          materialId: 'mat_1',
          title: f.replace('.md', ''),
          content: await fs.readFile(path.join(Paths.chunks, f), 'utf-8'),
          chapterPath: `${i + 1}`,
          concepts: [],
          sourceLink: path.join(Paths.chunks, f),
        }))
    );

    const conceptMap = await mapConcepts(chunks, llm, Paths.eventLog);
    const examProject = await loadExamProject();
    const unavailableDates = options.unavailable
      ? options.unavailable.split(',').map((date) => date.trim()).filter(Boolean)
      : examProject?.learnerProfile.unavailableDates;
    const plan = generatePlan(conceptMap, {
      examDate: options.exam,
      dailyMinutes: parseInt(options.daily, 10),
      unavailableDates,
    });

    // Show summary
    console.log('\n' + formatPlanSummary(plan, conceptMap) + '\n');

    if (!options.yes) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise<string>((resolve) => rl.question('确认生成此计划？(y/N) ', resolve));
      rl.close();
      if (answer.trim().toLowerCase() !== 'y') {
        console.log('已取消。');
        return;
      }
    }

    await savePlan(plan, Paths.eventLog);
    if (examProject?.status === 'materials_ready') {
      await saveExamProject(transitionStatus(examProject, 'planned'));
      await approvePlan(Paths.eventLog);
    } else if (examProject?.status === 'planned') {
      await approvePlan(Paths.eventLog);
    }
    console.log(`\n计划已生成：${plan.schedule.length} 天，版本 ${plan.version}`);
    console.log(`概念: ${conceptMap.concepts.map((c) => c.name).join(', ')}`);
    await triggerIntervention('plan_confirmed', { planDays: plan.schedule.length });
  });

program
  .command('today')
  .description('Show today tasks')
  .action(async () => {
    const today = todayDateKey();
    try {
      const { tasks } = await prepareTasksForDate(today, Paths.eventLog);
      console.log(`Today's tasks (${today}): ${tasks.length}`);
      const typeLabels: Record<string, string> = { learn: '学习', review: '复习', quiz: '测验', sprint: '冲刺', buffer: '缓冲' };
      for (const t of tasks) {
        const typeLabel = typeLabels[t.type] ?? t.type;
        console.log(`- [${t.id}] ${typeLabel} ${t.nodeId} (${t.duration}min)`);
      }
      await buddyLine('today');
    } catch {
      console.error(`No plan found for ${today}`);
      process.exit(1);
    }
  });

// ── 任务管理 ────────────────────────────────────────────────────────
const taskCmd = program.command('task').description('Manage daily tasks (任务管理)');

taskCmd
  .command('done')
  .description('Mark a task as completed')
  .argument('<taskId>', 'Task ID (e.g. task_2026-07-22_0)')
  .action(async (taskId: string) => {
    const dateMatch = taskId.match(/task_(\d{4}-\d{2}-\d{2})_/);
    if (!dateMatch) {
      console.error('无效的任务 ID 格式。示例: task_2026-07-22_0');
      process.exit(1);
    }
    const date = dateMatch[1];
    await completeTask(date, taskId, 'done', Paths.eventLog);
    console.log(`✓ 已完成: ${taskId}`);
    await triggerIntervention('task_start', { taskId });
  });

taskCmd
  .command('skip')
  .description('Mark a task as skipped')
  .argument('<taskId>', 'Task ID (e.g. task_2026-07-22_0)')
  .action(async (taskId: string) => {
    const dateMatch = taskId.match(/task_(\d{4}-\d{2}-\d{2})_/);
    if (!dateMatch) {
      console.error('无效的任务 ID 格式。示例: task_2026-07-22_0');
      process.exit(1);
    }
    const date = dateMatch[1];
    await completeTask(date, taskId, 'skipped', Paths.eventLog);
    console.log(`⏭ 已跳过: ${taskId}`);
    await triggerIntervention('task_skipped', { taskId });
  });

taskCmd
  .command('rollover')
  .description('Roll over incomplete tasks from past days to today')
  .action(async () => {
    const today = todayDateKey();
    const planPath = path.join(Paths.plan, 'plan_daily', `${today}.json`);
    try {
      const before = JSON.parse(await fs.readFile(planPath, 'utf-8'));
      const prepared = await prepareTasksForDate(today, Paths.eventLog);
      const migratedCount = prepared.tasks.length - before.tasks.length;
      if (migratedCount === 0) {
        console.log('没有未完成的任务需要滚动。');
        return;
      }
      console.log(`滚动 ${migratedCount} 项未完成任务到今天：`);
      for (const t of prepared.tasks.slice(before.tasks.length)) {
        console.log(`  - 复习 ${t.nodeId} (${t.duration}min)`);
      }
      console.log('\n运行 studymate today 查看更新后的任务列表。');
    } catch {
      console.error(`找不到今天的计划 (${today})。`);
      process.exit(1);
    }
  });

program
  .command('quiz')
  .description('Generate quiz for today')
  .option('--count <n>', 'Number of questions', '5')
  .option('--no-multi', 'Disable multi-choice questions')
  .action(async (options: { count: string; multi: boolean }) => {
    const llm = createLLM();
    const today = todayDateKey();
    const conceptsPath = path.join(Paths.graph, 'concepts.json');
    const conceptMap = JSON.parse(await fs.readFile(conceptsPath, 'utf-8'));

    const config: QuizConfig = {
      questionCount: parseInt(options.count, 10),
      allowMultiChoice: options.multi,
    };

    // Read today's plan for scope selection
    let todayPlan;
    try {
      const planPath = path.join(Paths.plan, 'plan_daily', `${today}.json`);
      todayPlan = JSON.parse(await fs.readFile(planPath, 'utf-8'));
    } catch {
      // No plan for today — scope will fall back to weakness profile or empty
    }

    // Read weakness profile
    let weaknessProfile;
    try {
      const profilePath = path.join(Paths.mistakes, 'weakness_profile.json');
      weaknessProfile = JSON.parse(await fs.readFile(profilePath, 'utf-8'));
    } catch {
      // No weakness profile yet
    }

    const scope = selectQuizScope(todayPlan, conceptMap, weaknessProfile);
    const scopeInfo = [
      scope.todayConcepts.length > 0 ? `今日学习 ${scope.todayConcepts.length} 个` : null,
      scope.dueReviewConcepts.length > 0 ? `复习 ${scope.dueReviewConcepts.length} 个` : null,
      scope.weakConcepts.length > 0 ? `薄弱 ${scope.weakConcepts.length} 个` : null,
    ].filter(Boolean);
    if (scopeInfo.length > 0) {
      console.log(`出题范围：${scopeInfo.join('，')}`);
    }

    const quiz = await generateScopedQuiz(scope, config, llm, today, Paths.eventLog);
    console.log(`Generated quiz: ${quiz.questions.length} questions`);
    const multiCount = quiz.questions.filter((q) => q.type === 'multi_choice').length;
    if (multiCount > 0) {
      console.log(`  单选题 ${quiz.questions.length - multiCount} 道，多选题 ${multiCount} 道`);
    }
    console.log(`See: ${path.join(Paths.quizzes, `${today}_quiz.md`)}`);
    await buddyLine('quiz');
  });

program
  .command('grade')
  .description('Grade quiz from answers JSON')
  .requiredOption('--answers <file>', 'Answers JSON file')
  .action(async (options: { answers: string }) => {
    const today = todayDateKey();
    const quiz = JSON.parse(await fs.readFile(path.join(Paths.quizzes, `${today}_quiz.json`), 'utf-8'));
    const answers = JSON.parse(await fs.readFile(options.answers, 'utf-8'));

    const workflowResult = await gradeAndAdapt({
      quiz,
      answers,
      conceptsPath: path.join(Paths.graph, 'concepts.json'),
      planPath: path.join(Paths.plan, 'plan_master.json'),
      eventLogFile: Paths.eventLog,
    });

    const { result, mistakes, mistakeNodeIds, masteryChanges, adjustments, weaknessExplanations } = workflowResult;

    console.log(`Score: ${result.totalScore}`);
    console.log(`Mistakes: ${result.mistakes.length}`);

    if (mistakes.length > 0) {
      console.log('\n错误分类：');
      for (const m of mistakes) {
        const typeLabels: Record<string, string> = {
          concept_unclear: '概念不清',
          memory_fuzzy: '记忆模糊',
          careless: '粗心',
          multi_partial: '多选部分正确',
        };
        console.log(`  ${m.nodeId} — ${typeLabels[m.errorType] ?? m.errorType}`);
      }
    }

    if (mistakeNodeIds.length > 0) {
      console.log(`\n薄弱知识点分析：`);
      for (const nodeId of mistakeNodeIds) {
        const explanation = weaknessExplanations[nodeId];
        if (explanation) {
          console.log(`  ${nodeId}: ${explanation}`);
        }
      }
    }

    if (masteryChanges.length > 0) {
      console.log('\n掌握度更新：');
      for (const c of masteryChanges) {
        const arrow = c.newMastery >= c.oldMastery ? '↑' : '↓';
        console.log(`  ${c.nodeName}: ${c.oldMastery.toFixed(2)} ${arrow} ${c.newMastery.toFixed(2)}（本次正确率 ${(c.sessionScore * 100).toFixed(0)}%）`);
        // SM-2 status
        if (c.srQuality !== undefined && c.srState) {
          const today = todayDateKey();
          const daysUntil = daysUntilDue(c.srState, today);
          const intervalStr = daysUntil > 0 ? `+${daysUntil} 天` : '今天';
          console.log(`    SM-2: 质量 ${c.srQuality}/5 (${qualityLabel(c.srQuality)}), 下次复习 ${c.srState.dueDate} (${intervalStr}), EF=${c.srState.easeFactor.toFixed(2)}`);
        }
      }
    }

    if (adjustments.length > 0) {
      console.log(`\n已为 ${adjustments.length} 项复习任务加时（明日及以后）：`);
      for (const a of adjustments) {
        console.log(`  ${a.date} — ${a.nodeId} +${a.addedMinutes}分钟（掌握度 ${a.mastery.toFixed(2)}）`);
      }
    } else {
      console.log('\n暂无需调整的计划项。');
    }

    await buddyLine('grade', { score: result.totalScore });
    await triggerIntervention('low_score', { score: result.totalScore });

    // Display learner insight if available
    if (workflowResult.latestInsight) {
      console.log(`\n💡 学习洞察: ${workflowResult.latestInsight}`);
    }
  });

// ── 学习者画像 ────────────────────────────────────────────────
const learnerCmd = program.command('learner').description('Manage your learner profile (学习者画像)');

learnerCmd
  .command('profile')
  .description('View your learner profile')
  .action(async () => {
    const model = await loadLearnerModel();
    if (!model) {
      console.log('尚未创建学习者画像。完成一次测验后将自动生成。');
      return;
    }
    console.log(formatLearnerProfile(model));
  });

learnerCmd
  .command('insights')
  .description('View personalized insights and recommendations')
  .action(async () => {
    const model = await loadLearnerModel();
    if (!model) {
      console.log('尚未创建学习者画像。完成一次测验后将自动生成。');
      return;
    }
    console.log(formatInsights(model));
  });

learnerCmd
  .command('init')
  .description('Initialize learner profile for current exam')
  .option('--baseline <level>', 'Baseline level (beginner/intermediate/advanced)', 'intermediate')
  .option('--daily <minutes>', 'Daily study minutes', '60')
  .action(async (options: { baseline: string; daily: string }) => {
    const exam = await loadExamProject();
    const examId = exam?.id ?? 'default';
    const baseline = options.baseline as LearnerBaseline;
    const dailyMinutes = parseInt(options.daily, 10);

    const model = await initLearnerModel(examId, baseline, dailyMinutes);
    await saveLearnerModel(model);
    console.log(`学习者画像已创建！`);
    console.log(`  基线水平: ${baseline}`);
    console.log(`  每日时长: ${dailyMinutes} 分钟`);
    console.log(`  初始难度: ${model.adaptive.currentDifficulty.toFixed(2)}`);
  });

learnerCmd
  .command('reset')
  .description('Reset learner profile (keeps exam project)')
  .action(async () => {
    const exam = await loadExamProject();
    const examId = exam?.id ?? 'default';
    const baseline = exam?.learnerProfile.baseline ?? 'intermediate';
    const dailyMinutes = exam?.learnerProfile.dailyMinutes ?? 60;

    const model = await initLearnerModel(examId, baseline, dailyMinutes);
    await saveLearnerModel(model);
    console.log('学习者画像已重置。');
  });

// ── 点③：拟人化备考搭子 ──────────────────────────────────────────
const characterCmd = program.command('character').description('Manage your study buddy (备考搭子)');

characterCmd
  .command('list')
  .description('List available characters')
  .action(async () => {
    const characters = await listCharacters();
    if (characters.length === 0) {
      console.log('暂无可用角色。');
      return;
    }
    const selectedId = await getSelectedCharacter().then((c) => c.id).catch(() => '');
    console.log('可选备考搭子：\n');
    for (const c of characters) {
      const mark = c.id === selectedId ? ' ✓（当前）' : '';
      console.log(`${c.avatar} ${c.name} [${c.id}]${mark}`);
      console.log(`   ${c.tagline}`);
      console.log(`   称呼你「${c.formOfAddress}」· 自称「${c.selfAddress}」\n`);
    }
  });

characterCmd
  .command('select')
  .description('Select a character as your buddy')
  .argument('<id>', 'Character id (e.g. lu_xingye)')
  .action(async (id: string) => {
    try {
      const c = await loadCharacter(id);
      await saveSelectedCharacter(id);
      console.log(`已选择 ${c.avatar} ${c.name} 作为你的备考搭子。`);
      console.log(`${c.name}：${c.greetingTemplates[0]?.replace('{user_task}', '欢迎') ?? '你好'}`);
    } catch {
      console.error(`未找到角色「${id}」。运行 studymate character list 查看可选角色。`);
      process.exit(1);
    }
  });

program
  .command('chat')
  .description('Chat with your study buddy')
  .action(async () => {
    const character = await getSelectedCharacter();
    const ctx = await gatherStudyContext();
    const llm = createLLM();
    const history = await loadChatHistory();

    console.log(`${character.avatar} ${character.name} 已上线。输入「exit」或「退出」结束对话。\n`);
    if (history.length === 0) {
      const greet = character.greetingTemplates[0]?.replace('{user_task}', '今天') ?? '你好呀';
      console.log(`${character.avatar} ${character.name}：${greet}\n`);
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '你 > ',
    });
    let closed = false;
    rl.prompt();

    rl.on('line', async (input: string) => {
      const trimmed = input.trim();
      if (trimmed === 'exit' || trimmed === '退出' || trimmed === 'quit') {
        console.log(`${character.avatar} ${character.name}：下次见，${character.formOfAddress}！`);
        closed = true;
        rl.close();
        return;
      }
      if (!trimmed) {
        if (!closed) rl.prompt();
        return;
      }
      try {
        const reply = await buddyChat(trimmed, character, ctx, llm, Paths.eventLog);
        console.log(`\n${character.avatar} ${character.name}：${reply}\n`);
      } catch (err) {
        console.error('搭子走神了，请重试。', err instanceof Error ? err.message : '');
      }
      if (!closed) rl.prompt();
    });
  });

// ── 考试项目建档与调研 ──────────────────────────────────────────
const examCmd = program.command('exam').description('Manage exam project (考试项目)');

examCmd
  .command('create')
  .description('Create a new exam project')
  .requiredOption('--name <name>', 'Exam name (e.g. "2026年初级会计资格考试")')
  .requiredOption('--date <date>', 'Exam date YYYY-MM-DD')
  .requiredOption('--subjects <subjects>', 'Comma-separated subject list')
  .requiredOption('--daily <minutes>', 'Daily study minutes')
  .option('--baseline <level>', 'Learner baseline: beginner|intermediate|advanced', 'beginner')
  .option('--target <target>', 'Target score or goal description')
  .option('--unavailable <dates>', 'Comma-separated unavailable dates')
  .action(async (opts: {
    name: string;
    date: string;
    subjects: string;
    daily: string;
    baseline: string;
    target?: string;
    unavailable?: string;
  }) => {
    try {
      const project = await bootstrapExam({
        name: opts.name,
        examDate: opts.date,
        subjects: opts.subjects.split(',').map((s) => s.trim()),
        baseline: opts.baseline as LearnerBaseline,
        dailyMinutes: parseInt(opts.daily, 10),
        target: opts.target,
        unavailableDates: opts.unavailable
          ? opts.unavailable.split(',').map((date) => date.trim()).filter(Boolean)
          : [],
      });
      console.log(`考试项目已创建：${project.name}`);
      console.log(`  ID: ${project.id}`);
      console.log(`  考试日期: ${project.examDate}`);
      console.log(`  科目: ${project.subjects.join(', ')}`);
      console.log(`  每日时长: ${project.learnerProfile.dailyMinutes} 分钟`);
      await triggerIntervention('exam_created', { examName: project.name });
    } catch (err) {
      console.error('创建失败:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

examCmd
  .command('status')
  .description('Show current exam project status')
  .action(async () => {
    const project = await loadExamProject();
    if (!project) {
      console.log('暂无考试项目。请先运行: studymate exam create');
      return;
    }
    console.log(`考试项目：${project.name}`);
    console.log(`  ID: ${project.id}`);
    console.log(`  状态: ${project.status}`);
    console.log(`  考试日期: ${project.examDate}`);
    console.log(`  科目: ${project.subjects.join(', ')}`);
    console.log(`  每日时长: ${project.learnerProfile.dailyMinutes} 分钟`);
    console.log(`  基础水平: ${project.learnerProfile.baseline}`);
  });

examCmd
  .command('research')
  .description('Run exam research (search + classify + synthesize)')
  .action(async () => {
    const project = await loadExamProject();
    if (!project) {
      console.error('暂无考试项目。请先运行: studymate exam create');
      process.exit(1);
    }
    if (project.status !== 'draft') {
      console.error(`当前状态为 ${project.status}，调研只能在 draft 状态执行。`);
      process.exit(1);
    }

    const llm = createLLM();
    const searchProvider = createSearchProvider();
    if (!process.env.SERP_API_KEY) {
      console.log('提示: 未设置 SERP_API_KEY，使用 Mock 搜索（搜索结果为空）。设置后可获取真实搜索结果。');
    }
    console.log(`正在调研「${project.name}」...`);

    try {
      const result = await researchExamWorkflow(
        project,
        searchProvider,
        llm,
        Paths.eventLog
      );
      console.log(`\n调研完成！`);
      console.log(`  发现来源: ${result.research.sources.length} 个`);
      console.log(`  搜索查询: ${result.research.queryCount} 个`);
      console.log(`\n考试画像: ${result.profilePath}`);
      console.log(`经验洞察: ${result.insightsPath}`);
      console.log(`资料推荐: ${result.materialsPath}`);
      console.log(`\n下一步: studymate exam sources (查看并确认来源)`);
    } catch (err) {
      console.error('调研失败:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

examCmd
  .command('sources')
  .description('List discovered sources and approve them')
  .option('--approve <ids>', 'Comma-separated source IDs to approve')
  .action(async (opts: { approve?: string }) => {
    const project = await loadExamProject();
    if (!project) {
      console.error('暂无考试项目。');
      process.exit(1);
    }

    // Load sources from research directory
    const sourcesPath = path.join(Paths.research, 'sources.jsonl');
    let sources: SourceRecord[] = [];
    try {
      const content = await fs.readFile(sourcesPath, 'utf-8');
      sources = content
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));
    } catch {
      console.error('暂无调研结果。请先运行: studymate exam research');
      process.exit(1);
    }

    if (opts.approve) {
      const ids = opts.approve.split(',').map((s) => s.trim());
      const updated = await approveSources(project, ids, Paths.eventLog);
      const approvedCount = updated.filter((s) => s.approved).length;
      console.log(`已批准 ${ids.length} 个来源（总计 ${approvedCount} 个已批准）。`);
      return;
    }

    // List all sources
    console.log(`发现来源 (${sources.length} 个)：\n`);
    for (const s of sources) {
      const mark = s.approved ? ' [已批准]' : '';
      console.log(`  ${s.id} [${s.sourceType}|${s.confidenceLevel}]${mark}`);
      console.log(`    ${s.title}`);
      console.log(`    ${s.summary.slice(0, 80)}${s.summary.length > 80 ? '...' : ''}`);
      if (s.url) console.log(`    URL: ${s.url}`);
      console.log();
    }
    console.log('批准来源: studymate exam sources --approve <id1,id2,...>');
  });

// ── 知识构建 ──────────────────────────────────────────────────────
const knowledgeCmd = program.command('knowledge').description('Build and manage knowledge base (知识构建)');

knowledgeCmd
  .command('build')
  .description('Fetch approved sources, import materials, chunk, and extract concepts')
  .action(async () => {
    const project = await loadExamProject();
    if (!project) {
      console.error('暂无考试项目。请先运行: studymate exam create');
      process.exit(1);
    }
    if (project.status !== 'sources_approved') {
      console.error(`当前状态为 ${project.status}，知识构建只能在 sources_approved 状态执行。`);
      console.error('请先运行: studymate exam sources --approve <ids>');
      process.exit(1);
    }

    const llm = createLLM();
    const fetcher = new WebContentFetcher();
    console.log(`正在构建知识库...`);

    try {
      const result = await buildKnowledge({ fetcher, llm });
      console.log(`\n知识构建完成！`);
      console.log(`  导入资料: ${result.materialsImported} 份`);
      console.log(`  生成切片: ${result.chunksGenerated} 个`);
      console.log(`  抽取概念: ${result.conceptsExtracted} 个`);
      console.log(`  未验证概念: ${result.unverifiedConcepts} 个`);
      console.log(`  跳过重复: ${result.skippedDuplicates} 份`);
      if (result.fetchErrors.length > 0) {
        console.log(`  拓取失败: ${result.fetchErrors.length} 个`);
        for (const e of result.fetchErrors) {
          console.log(`    - ${e}`);
        }
      }
      console.log(`\n下一步: studymate knowledge review (查看概念并确认)`);
    } catch (err) {
      console.error('知识构建失败:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

knowledgeCmd
  .command('status')
  .description('Show knowledge base statistics')
  .action(async () => {
    // Materials
    const materials = await loadMaterialIndex();
    console.log(`资料: ${materials.length} 份`);

    // Chunks
    try {
      const chunkIndex = JSON.parse(await fs.readFile(path.join(Paths.chunks, 'index.json'), 'utf-8'));
      console.log(`切片: ${chunkIndex.length} 个`);
    } catch {
      console.log(`切片: 0 个`);
    }

    // Concepts
    try {
      const conceptMap = JSON.parse(await fs.readFile(path.join(Paths.graph, 'concepts.json'), 'utf-8'));
      const total = conceptMap.concepts.length;
      const unverified = conceptMap.concepts.filter((c: { unverified?: boolean }) => c.unverified).length;
      const inOrder = conceptMap.learningOrder.length;
      console.log(`概念: ${total} 个 (已验证 ${inOrder}, 未验证 ${unverified})`);
    } catch {
      console.log(`概念: 0 个`);
    }
  });

knowledgeCmd
  .command('review')
  .description('Review extracted concepts and their evidence status')
  .action(async () => {
    let conceptMap: { concepts: Array<{ id: string; name: string; definition: string; relatedChunks: string[]; unverified?: boolean }>; learningOrder: string[] };
    try {
      conceptMap = JSON.parse(await fs.readFile(path.join(Paths.graph, 'concepts.json'), 'utf-8'));
    } catch {
      console.error('暂无概念图谱。请先运行: studymate knowledge build');
      process.exit(1);
    }

    const verified = conceptMap.concepts.filter((c) => !c.unverified);
    const unverified = conceptMap.concepts.filter((c) => c.unverified);

    console.log(`\n已验证概念 (${verified.length})：\n`);
    for (const c of verified) {
      console.log(`  ${c.id} ${c.name}`);
      console.log(`    ${c.definition.slice(0, 80)}${c.definition.length > 80 ? '...' : ''}`);
      console.log(`    证据切片: ${c.relatedChunks.length} 个`);
    }

    if (unverified.length > 0) {
      console.log(`\n未验证概念 (${unverified.length})：\n`);
      for (const c of unverified) {
        console.log(`  ${c.id} ${c.name} [无证据切片]`);
        console.log(`    ${c.definition.slice(0, 80)}${c.definition.length > 80 ? '...' : ''}`);
      }
      console.log(`\n提示: 未验证概念不会进入学习顺序。可重新导入更多资料以提供证据。`);
    }
  });

// ── 策略指标 ──────────────────────────────────────────────────────
program
  .command('metrics')
  .description('Show strategy metrics (学习策略指标)')
  .action(async () => {
    const m = await computeMetrics();
    console.log('\n学习策略指标\n');
    console.log(`  计划完成率：${(m.planCompletionRate * 100).toFixed(0)}%`);
    console.log(`  复习后正确率：${(m.postReviewAccuracy * 100).toFixed(0)}%`);
    console.log(`  知识保持率：${(m.knowledgeRetention * 100).toFixed(0)}%`);
    console.log('  题目弃用率：暂不可用（题目跳过/弃用反馈机制未实现）');
    console.log('');
  });

program.parse();
