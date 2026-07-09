import fs from 'fs/promises';
import path from 'path';
import type { Quiz, Question } from './quiz_generator.js';
import type { Event } from '../core/types.js';
import { createEventId, appendEvent } from '../core/event_log.js';
import { Paths } from '../core/paths.js';

export interface UserAnswer {
  questionId: string;
  answer: number;
}

export interface GradedQuestion {
  question: Question;
  userAnswer: number;
  isCorrect: boolean;
  score: number;
}

export interface QuizResult {
  quizId: string;
  date: string;
  totalScore: number;
  mistakes: GradedQuestion[];
  details: GradedQuestion[];
}

export function gradeQuiz(quiz: Quiz, answers: UserAnswer[]): QuizResult {
  const details: GradedQuestion[] = quiz.questions.map((q) => {
    const userAnswer = answers.find((a) => a.questionId === q.id);
    const isCorrect = userAnswer !== undefined && userAnswer.answer === q.answer;
    return {
      question: q,
      userAnswer: userAnswer?.answer ?? -1,
      isCorrect,
      score: isCorrect ? 100 : 0,
    };
  });

  const correctCount = details.filter((d) => d.isCorrect).length;
  const totalScore = quiz.questions.length === 0 ? 0 : Math.round((correctCount / quiz.questions.length) * 100);
  const mistakes = details.filter((d) => !d.isCorrect);

  return {
    quizId: quiz.id,
    date: quiz.date,
    totalScore,
    mistakes,
    details,
  };
}

export async function saveResult(result: QuizResult, eventLogFile: string): Promise<void> {
  await fs.mkdir(Paths.results, { recursive: true });
  await fs.writeFile(
    path.join(Paths.results, `${result.date}_result.json`),
    JSON.stringify(result, null, 2),
    'utf-8'
  );

  const lines: string[] = [`# ${result.date} 测验报告`, '', `**总分：${result.totalScore}**`, '', '## 错题'];
  for (const m of result.mistakes) {
    lines.push(`- ${m.question.stem}`);
    lines.push(`  正确答案：${String.fromCharCode(65 + m.question.answer)}`);
    lines.push(`  解析：${m.question.explanation}`);
  }

  await fs.writeFile(path.join(Paths.results, `${result.date}_report.md`), lines.join('\n'), 'utf-8');

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
