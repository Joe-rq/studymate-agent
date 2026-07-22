import fs from 'fs/promises';
import path from 'path';
import type { Quiz, Question } from './quiz_generator.js';
import type { Event } from '../core/types.js';
import { createEventId, appendEvent } from '../core/event_log.js';
import { Paths } from '../core/paths.js';

export interface UserAnswer {
  questionId: string;
  /** For single_choice: number. For multi_choice: sorted array of indices. */
  answer: number | number[];
}

export interface GradedQuestion {
  question: Question;
  userAnswer: number | number[];
  isCorrect: boolean;
  /** 0-100. Multi-choice partial credit = 50. */
  score: number;
  sourceChunkId?: string;
}

export interface QuizResult {
  quizId: string;
  date: string;
  totalScore: number;
  mistakes: GradedQuestion[];
  details: GradedQuestion[];
  /** Per-concept score aggregation. */
  perConceptScore: Record<string, { correct: number; total: number }>;
}

/** Check if two arrays are equal (same elements, same order). */
function arraysEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

/** Check if user's answer is a subset of correct answers with no wrong selections. */
function isPartialCorrect(userArr: number[], correctArr: number[]): boolean {
  const correctSet = new Set(correctArr);
  // All user selections must be in correct set
  if (!userArr.every((v) => correctSet.has(v))) return false;
  // Must be a proper subset (not full match, which is handled separately)
  return userArr.length > 0 && userArr.length < correctArr.length;
}

export function gradeQuiz(quiz: Quiz, answers: UserAnswer[]): QuizResult {
  const details: GradedQuestion[] = quiz.questions.map((q) => {
    const userAnswer = answers.find((a) => a.questionId === q.id);
    let isCorrect = false;
    let score = 0;

    if (q.type === 'multi_choice') {
      const correctArr = Array.isArray(q.answer) ? q.answer : [q.answer];
      const userArr = userAnswer
        ? (Array.isArray(userAnswer.answer) ? userAnswer.answer : [userAnswer.answer])
        : [];
      const sortedUser = [...userArr].sort((a, b) => a - b);

      if (arraysEqual(sortedUser, correctArr)) {
        isCorrect = true;
        score = 100;
      } else if (isPartialCorrect(sortedUser, correctArr)) {
        // Partial credit: subset with no wrong selections
        score = 50;
      }
    } else {
      // single_choice
      const correctIdx = typeof q.answer === 'number' ? q.answer : q.answer[0];
      const userIdx = userAnswer
        ? (typeof userAnswer.answer === 'number' ? userAnswer.answer : userAnswer.answer[0])
        : -1;
      isCorrect = userIdx === correctIdx;
      score = isCorrect ? 100 : 0;
    }

    return {
      question: q,
      userAnswer: userAnswer?.answer ?? -1,
      isCorrect,
      score,
      sourceChunkId: q.sourceChunkId,
    };
  });

  const totalScore = details.length === 0
    ? 0
    : Math.round(details.reduce((s, d) => s + d.score, 0) / details.length);
  const mistakes = details.filter((d) => !d.isCorrect);

  // Per-concept aggregation
  const perConceptScore: Record<string, { correct: number; total: number }> = {};
  for (const d of details) {
    const nodeId = d.question.nodeId;
    if (!perConceptScore[nodeId]) perConceptScore[nodeId] = { correct: 0, total: 0 };
    perConceptScore[nodeId].total += 1;
    if (d.isCorrect) perConceptScore[nodeId].correct += 1;
  }

  return { quizId: quiz.id, date: quiz.date, totalScore, mistakes, details, perConceptScore };
}

export async function saveResult(
  result: QuizResult,
  eventLogFile: string,
  workspaceRoot?: string
): Promise<void> {
  const resultsDir = workspaceRoot ? path.join(workspaceRoot, 'results') : Paths.results;
  await fs.mkdir(resultsDir, { recursive: true });
  await fs.writeFile(
    path.join(resultsDir, `${result.date}_result.json`),
    JSON.stringify(result, null, 2),
    'utf-8'
  );

  const lines: string[] = [`# ${result.date} 测验报告`, '', `**总分：${result.totalScore}**`, '', '## 错题'];
  for (const m of result.mistakes) {
    const typeTag = m.question.type === 'multi_choice' ? '【多选】' : '';
    lines.push(`- ${typeTag}${m.question.stem}`);
    const correctDisplay = Array.isArray(m.question.answer)
      ? m.question.answer.map((i) => String.fromCharCode(65 + i)).join(', ')
      : String.fromCharCode(65 + m.question.answer);
    lines.push(`  正确答案：${correctDisplay}`);
    lines.push(`  解析：${m.question.explanation}`);
    if (m.score === 50) lines.push(`  （部分正确 +50分）`);
  }

  await fs.writeFile(path.join(resultsDir, `${result.date}_report.md`), lines.join('\n'), 'utf-8');

  const event: Event = {
    id: createEventId(),
    timestamp: new Date().toISOString(),
    agent: 'grader',
    action: 'quiz_graded',
    input: { quizId: result.quizId },
    output: { totalScore: result.totalScore, mistakeCount: result.mistakes.length },
  };
  await appendEvent(eventLogFile, event);
}
