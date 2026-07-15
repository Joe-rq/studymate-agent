#!/usr/bin/env node
import { program } from 'commander';
import fs from 'fs/promises';
import path from 'path';
import readline from 'readline';
import { initWorkspace } from './core/workspace.js';
import { Paths } from './core/paths.js';
import { importPDF, importMarkdown } from './agents/material_collector.js';
import { chunkMaterial } from './agents/chunker.js';
import { mapConcepts } from './agents/concept_mapper.js';
import { generatePlan, savePlan } from './agents/planner.js';
import { dispatchToday } from './agents/task_dispatcher.js';
import { generateQuiz } from './agents/quiz_generator.js';
import { gradeQuiz, saveResult } from './agents/grader.js';
import { analyzeMistakes, saveMistakes } from './agents/mistake_analyzer.js';
import { updateMastery, saveMastery } from './agents/mastery_tracker.js';
import { adjustPlan, saveAdjustedPlan } from './agents/plan_adjuster.js';
import type { ConceptMap } from './agents/concept_mapper.js';
import type { StudyPlan } from './agents/planner.js';
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
  .action(async (options: { exam: string; daily: string }) => {
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
    const plan = generatePlan(conceptMap, { examDate: options.exam, dailyMinutes: parseInt(options.daily, 10) });
    await savePlan(plan, Paths.eventLog);
    console.log(`Plan generated: ${plan.schedule.length} days`);
    console.log(`Concepts: ${conceptMap.concepts.map((c) => c.name).join(', ')}`);
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
      await buddyLine('today');
    } catch {
      console.error(`No plan found for ${today}`);
      process.exit(1);
    }
  });

program
  .command('quiz')
  .description('Generate quiz for today')
  .action(async () => {
    const llm = createLLM();
    const today = new Date().toISOString().split('T')[0];
    const conceptsPath = path.join(Paths.graph, 'concepts.json');
    const concepts = JSON.parse(await fs.readFile(conceptsPath, 'utf-8')).concepts;

    // 断点③：读取薄弱知识点，引导出题优先覆盖薄弱点
    let focusNodeIds: string[] | undefined;
    try {
      const profilePath = path.join(Paths.mistakes, 'weakness_profile.json');
      const profile = JSON.parse(await fs.readFile(profilePath, 'utf-8'));
      const weakNodes: unknown = profile.weakNodes;
      if (Array.isArray(weakNodes) && weakNodes.length > 0) {
        focusNodeIds = weakNodes as string[];
        console.log(`检测到薄弱知识点 ${focusNodeIds.length} 个，将优先出题`);
      }
    } catch {
      // weakness_profile.json 不存在（首次答题前），正常跳过
    }

    const quiz = await generateQuiz(concepts, llm, today, Paths.eventLog, focusNodeIds);
    console.log(`Generated quiz: ${quiz.questions.length} questions`);
    console.log(`See: ${path.join(Paths.quizzes, `${today}_quiz.md`)}`);
    await buddyLine('quiz');
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
    if (mistakes.length > 0) {
      console.log(`Weak nodes: ${mistakes.map((m) => m.nodeId).join(', ')}`);
    }

    // 断点①：用本次批改结果更新各概念掌握度，写回 concepts.json
    const conceptMap: ConceptMap = JSON.parse(
      await fs.readFile(path.join(Paths.graph, 'concepts.json'), 'utf-8')
    );
    const masteryUpdate = updateMastery(conceptMap, result);
    await saveMastery(masteryUpdate, Paths.eventLog);
    if (masteryUpdate.changes.length > 0) {
      console.log('\n掌握度更新：');
      for (const c of masteryUpdate.changes) {
        const arrow = c.newMastery >= c.oldMastery ? '↑' : '↓';
        console.log(`  ${c.nodeName}: ${c.oldMastery.toFixed(2)} ${arrow} ${c.newMastery.toFixed(2)}（本次正确率 ${(c.sessionScore * 100).toFixed(0)}%）`);
      }
    }

    // 断点②：根据最新掌握度调整明天及以后的计划
    try {
      const plan: StudyPlan = JSON.parse(
        await fs.readFile(path.join(Paths.plan, 'plan_master.json'), 'utf-8')
      );
      const { plan: adjustedPlan, adjustments } = adjustPlan(plan, masteryUpdate.conceptMap);
      await saveAdjustedPlan(adjustedPlan, adjustments, Paths.eventLog);
      if (adjustments.length > 0) {
        console.log(`\n已为 ${adjustments.length} 项复习任务加时（明日及以后）：`);
        for (const a of adjustments) {
          console.log(`  ${a.date} — ${a.nodeId} +${a.addedMinutes}分钟（掌握度 ${a.mastery.toFixed(2)}）`);
        }
      } else {
        console.log('\n暂无需调整的计划项。');
      }
    } catch {
      // plan_master.json 不存在（未生成计划），跳过调整
      console.log('\n未找到学习计划，跳过计划调整。');
    }

    // 点③：搭子对本次成绩的一句点评（情境感知：分数驱动语气）
    await buddyLine('grade', { score: result.totalScore });
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

program.parse();
