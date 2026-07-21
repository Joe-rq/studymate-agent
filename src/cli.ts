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
import { gradeAndAdapt } from './application/workflows/grade_and_adapt.js';
import { bootstrapExam, loadExamProject } from './application/workflows/bootstrap_exam.js';
import { researchExamWorkflow, approveSources } from './application/workflows/research_exam.js';
import { MockSearchProvider } from './application/ports/search_provider.js';
import { buildKnowledge } from './application/workflows/build_knowledge.js';
import { WebContentFetcher } from './infrastructure/fetch/web_fetcher.js';
import { loadMaterialIndex } from './agents/material_collector.js';
import type { LearnerBaseline } from './domain/exam.js';
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
        const typeLabel = t.type === 'learn' ? '学习' : t.type === 'review' ? '复习' : '冲刺';
        console.log(`- ${typeLabel} ${t.nodeId} (${t.duration}min)`);
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
      // Support both new cumulative schema (nodes map) and legacy (weakNodes array)
      let weakNodes: string[] = [];
      if (profile.nodes && typeof profile.nodes === 'object') {
        weakNodes = Object.entries(profile.nodes as Record<string, { mistakeCount: number }>)
          .sort((a, b) => b[1].mistakeCount - a[1].mistakeCount)
          .map(([id]) => id);
      } else if (Array.isArray(profile.weakNodes)) {
        weakNodes = profile.weakNodes;
      }
      if (weakNodes.length > 0) {
        focusNodeIds = weakNodes;
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

    const workflowResult = await gradeAndAdapt({
      quiz,
      answers,
      conceptsPath: path.join(Paths.graph, 'concepts.json'),
      planPath: path.join(Paths.plan, 'plan_master.json'),
      eventLogFile: Paths.eventLog,
    });

    const { result, mistakeNodeIds, masteryChanges, adjustments } = workflowResult;

    console.log(`Score: ${result.totalScore}`);
    console.log(`Mistakes: ${result.mistakes.length}`);
    if (mistakeNodeIds.length > 0) {
      console.log(`Weak nodes: ${mistakeNodeIds.join(', ')}`);
    }

    if (masteryChanges.length > 0) {
      console.log('\n掌握度更新：');
      for (const c of masteryChanges) {
        const arrow = c.newMastery >= c.oldMastery ? '↑' : '↓';
        console.log(`  ${c.nodeName}: ${c.oldMastery.toFixed(2)} ${arrow} ${c.newMastery.toFixed(2)}（本次正确率 ${(c.sessionScore * 100).toFixed(0)}%）`);
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
  .action(async (opts: {
    name: string;
    date: string;
    subjects: string;
    daily: string;
    baseline: string;
    target?: string;
  }) => {
    try {
      const project = await bootstrapExam({
        name: opts.name,
        examDate: opts.date,
        subjects: opts.subjects.split(',').map((s) => s.trim()),
        baseline: opts.baseline as LearnerBaseline,
        dailyMinutes: parseInt(opts.daily, 10),
        target: opts.target,
      });
      console.log(`考试项目已创建：${project.name}`);
      console.log(`  ID: ${project.id}`);
      console.log(`  考试日期: ${project.examDate}`);
      console.log(`  科目: ${project.subjects.join(', ')}`);
      console.log(`  每日时长: ${project.learnerProfile.dailyMinutes} 分钟`);
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
    // Use mock search provider for now; real provider will be added later
    const searchProvider = new MockSearchProvider({});
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

program.parse();
