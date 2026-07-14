import fs from 'fs/promises';
import path from 'path';
import type { LLMClient } from '../core/llm.js';
import type { Concept } from './concept_mapper.js';
import type { Event } from '../core/types.js';
import { createEventId, appendEvent } from '../core/event_log.js';
import { Paths, PROMPTS_SOURCE } from '../core/paths.js';

export interface Question {
  id: string;
  type: 'single_choice';
  stem: string;
  options: string[];
  answer: number;
  explanation: string;
  nodeId: string;
}

export interface Quiz {
  id: string;
  date: string;
  questions: Question[];
}

export async function generateQuiz(
  concepts: Concept[],
  llm: LLMClient,
  date: string,
  eventLogFile: string,
  /** 历史薄弱知识点 ID，用于引导 LLM 优先出题。来自 weakness_profile.json。 */
  focusNodeIds?: string[]
): Promise<Quiz> {
  const promptPath = path.join(PROMPTS_SOURCE, 'quiz_generator.txt');
  let system: string;
  try {
    system = await fs.readFile(promptPath, 'utf-8');
  } catch {
    system = `You are an exam question generator. Given study concepts, create multiple-choice questions. Respond with JSON only. Format: { "questions": [{ "id": "q_1", "type": "single_choice", "stem": "...", "options": ["..."], "answer": 0, "explanation": "...", "nodeId": "node_1" }] }`;
  }

  // 若存在薄弱点，在 user 消息开头标注，引导 LLM 优先针对这些出题（断点③）
  const conceptById = new Map(concepts.map((c) => [c.id, c]));
  const focusLines: string[] = [];
  if (focusNodeIds && focusNodeIds.length > 0) {
    const focusNames = focusNodeIds
      .map((id) => conceptById.get(id)?.name)
      .filter((n): n is string => Boolean(n));
    if (focusNames.length > 0) {
      focusLines.push('学生薄弱知识点（请优先针对这些出题）：' + focusNames.join(', '));
      focusLines.push('');
    }
  }

  const user =
    focusLines.join('\n') + concepts.map((c) => `## ${c.name}\n${c.definition}`).join('\n\n');
  const raw = await llm.completeJSON<{ questions: Question[] }>(system, user, { temperature: 0.7, retries: 3 });

  if (!Array.isArray(raw.questions) || raw.questions.length === 0) {
    throw new Error('Quiz generator returned no questions');
  }

  const validNodeIds = new Set(concepts.map((c) => c.id));
  for (const q of raw.questions) {
    if (!q.stem || typeof q.stem !== 'string') throw new Error('Question missing stem');
    if (!Array.isArray(q.options) || q.options.length < 2) {
      throw new Error('Question must have at least 2 options');
    }
    if (typeof q.answer !== 'number' || q.answer < 0 || q.answer >= q.options.length) {
      throw new Error(`Question answer index out of range: ${q.answer}`);
    }
    if (!q.explanation || typeof q.explanation !== 'string') throw new Error('Question missing explanation');
    if (!q.nodeId || !validNodeIds.has(q.nodeId)) {
      throw new Error(`Question references unknown concept: ${q.nodeId}`);
    }
    if (q.type !== 'single_choice') throw new Error(`Unsupported question type: ${q.type}`);
  }

  const quiz: Quiz = {
    id: `quiz_${date}`,
    date,
    questions: raw.questions.map((q, idx) => ({
      ...q,
      id: `q_${date}_${idx}`,
    })),
  };

  await fs.mkdir(Paths.quizzes, { recursive: true });
  await fs.writeFile(path.join(Paths.quizzes, `${date}_quiz.json`), JSON.stringify(quiz, null, 2), 'utf-8');

  const lines: string[] = ['---', `date: ${date}`, 'tags: #studymate #quiz #daily-quiz', '---', '', `# ${date} 每日测验\n`];
  for (let i = 0; i < quiz.questions.length; i++) {
    const q = quiz.questions[i];
    lines.push(`${i + 1}. ${q.stem}`);
    for (let j = 0; j < q.options.length; j++) {
      lines.push(`   ${String.fromCharCode(65 + j)}. ${q.options[j]}`);
    }
  }
  const markdown = lines.join('\n');
  await fs.writeFile(path.join(Paths.quizzes, `${date}_quiz.md`), markdown, 'utf-8');

  const event: Event = {
    id: createEventId(),
    timestamp: new Date().toISOString(),
    agent: 'quiz_generator',
    action: 'quiz_generated',
    input: { date, conceptCount: concepts.length },
    output: { quizId: quiz.id, questionCount: quiz.questions.length },
  };
  await appendEvent(eventLogFile, event);

  return quiz;
}
