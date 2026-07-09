import fs from 'fs/promises';
import path from 'path';
import type { LLMClient } from '../core/llm.js';
import type { Concept } from './concept_mapper.js';
import type { Event } from '../core/types.js';
import { createEventId, appendEvent } from '../core/event_log.js';
import { Paths } from '../core/paths.js';

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
  eventLogFile: string
): Promise<Quiz> {
  const promptPath = path.join(Paths.prompts, 'quiz_generator.txt');
  let system: string;
  try {
    system = await fs.readFile(promptPath, 'utf-8');
  } catch {
    system = `You are an exam question generator. Given study concepts, create multiple-choice questions. Respond with JSON only. Format: { "questions": [{ "id": "q_1", "type": "single_choice", "stem": "...", "options": ["..."], "answer": 0, "explanation": "...", "nodeId": "node_1" }] }`;
  }

  const user = concepts.map((c) => `## ${c.name}\n${c.definition}`).join('\n\n');
  const raw = await llm.completeJSON<{ questions: Question[] }>(system, user, { temperature: 0.7 });

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

  const lines: string[] = [];
  for (let i = 0; i < quiz.questions.length; i++) {
    const q = quiz.questions[i];
    lines.push(`${i + 1}. ${q.stem}`);
    for (let j = 0; j < q.options.length; j++) {
      lines.push(`   ${String.fromCharCode(65 + j)}. ${q.options[j]}`);
    }
  }
  const markdown = `# ${date} 每日测验\n\n${lines.join('\n')}`;
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
