#!/usr/bin/env node
import { program } from 'commander';
import fs from 'fs/promises';
import path from 'path';
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
import { createLLMClient } from './core/llm.js';

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
    const llm = createLLMClient();
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
    } catch {
      console.error(`No plan found for ${today}`);
      process.exit(1);
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
    if (mistakes.length > 0) {
      console.log(`Weak nodes: ${mistakes.map((m) => m.nodeId).join(', ')}`);
    }
  });

program.parse();
