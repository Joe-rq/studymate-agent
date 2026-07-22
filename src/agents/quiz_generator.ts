import fs from 'fs/promises';
import path from 'path';
import type { LLMClient } from '../core/llm.js';
import type { Concept, ConceptMap } from './concept_mapper.js';
import type { DailyPlan } from './planner.js';
import type { WeaknessProfile } from './mistake_analyzer.js';
import type { Event } from '../core/types.js';
import { createEventId, appendEvent } from '../core/event_log.js';
import { Paths, PROMPTS_SOURCE } from '../core/paths.js';

// ── Types ────────────────────────────────────────────────────────────

export type QuestionType = 'single_choice' | 'multi_choice';
export type QuestionDifficulty = 'easy' | 'medium' | 'hard';

export interface Question {
  id: string;
  type: QuestionType;
  stem: string;
  options: string[];
  /** For single_choice: index. For multi_choice: sorted array of indices. */
  answer: number | number[];
  explanation: string;
  nodeId: string;
  /** Source chunk this question relates to. */
  sourceChunkId?: string;
  difficulty: QuestionDifficulty;
}

export interface Quiz {
  id: string;
  date: string;
  questions: Question[];
}

// ── Scope & Config ──────────────────────────────────────────────────

export interface QuizScope {
  /** Concepts learned today (from today's plan tasks type='learn'). */
  todayConcepts: Concept[];
  /** Concepts due for spaced-repetition review today. */
  dueReviewConcepts: Concept[];
  /** Historical weak concepts (from weakness_profile, limited to top 3). */
  weakConcepts: Concept[];
}

export interface QuizConfig {
  /** Total question count. Default: 5. */
  questionCount?: number;
  /** Ratio: today / review / weak. Default: [0.5, 0.3, 0.2]. */
  ratio?: [number, number, number];
  /** Include multi-choice questions. Default: true. */
  allowMultiChoice?: boolean;
}

const DEFAULT_QUESTION_COUNT = 5;
const DEFAULT_RATIO: [number, number, number] = [0.5, 0.3, 0.2];

// ── Scope Selection ─────────────────────────────────────────────────

/**
 * Select quiz scope from today's plan, concept map, and weakness profile.
 */
export function selectQuizScope(
  todayPlan: DailyPlan | undefined,
  conceptMap: ConceptMap,
  weaknessProfile?: WeaknessProfile
): QuizScope {
  const conceptById = new Map(conceptMap.concepts.map((c) => [c.id, c]));

  // Today's learned concepts
  const todayIds = new Set(
    (todayPlan?.tasks ?? [])
      .filter((t) => t.type === 'learn')
      .map((t) => t.nodeId)
  );
  const todayConcepts = [...todayIds]
    .map((id) => conceptById.get(id))
    .filter((c): c is Concept => c !== undefined);

  // Due review concepts (from today's review/sprint tasks)
  const reviewIds = new Set(
    (todayPlan?.tasks ?? [])
      .filter((t) => t.type === 'review' || t.type === 'sprint')
      .map((t) => t.nodeId)
  );
  const dueReviewConcepts = [...reviewIds]
    .map((id) => conceptById.get(id))
    .filter((c): c is Concept => c !== undefined);

  // Weak concepts (top 3 from weakness profile)
  let weakConcepts: Concept[] = [];
  if (weaknessProfile && weaknessProfile.nodes) {
    const weakIds = Object.entries(weaknessProfile.nodes)
      .sort((a, b) => b[1].mistakeCount - a[1].mistakeCount)
      .slice(0, 3)
      .map(([id]) => id);
    weakConcepts = weakIds
      .map((id) => conceptById.get(id))
      .filter((c): c is Concept => c !== undefined);
  }

  return { todayConcepts, dueReviewConcepts, weakConcepts };
}

/**
 * Merge scope into a flat concept list with ratio-based allocation.
 */
function mergeScopeToConcepts(scope: QuizScope, config: QuizConfig): Concept[] {
  const count = config.questionCount ?? DEFAULT_QUESTION_COUNT;
  const ratio = config.ratio ?? DEFAULT_RATIO;

  const todayCount = Math.max(1, Math.round(count * ratio[0]));
  const reviewCount = Math.max(0, Math.round(count * ratio[1]));

  const selected: Concept[] = [];
  const seen = new Set<string>();

  // Add today's concepts
  for (const c of scope.todayConcepts.slice(0, todayCount)) {
    if (!seen.has(c.id)) { selected.push(c); seen.add(c.id); }
  }
  // Add review concepts
  for (const c of scope.dueReviewConcepts.slice(0, reviewCount)) {
    if (!seen.has(c.id)) { selected.push(c); seen.add(c.id); }
  }
  // Add weak concepts
  for (const c of scope.weakConcepts) {
    if (!seen.has(c.id)) { selected.push(c); seen.add(c.id); }
  }

  // Fallback: if scope is empty, use all concepts from learningOrder
  if (selected.length === 0) {
    return [];
  }
  return selected;
}

// ── Quiz Generation ─────────────────────────────────────────────────

export async function generateQuiz(
  concepts: Concept[],
  llm: LLMClient,
  date: string,
  eventLogFile: string,
  focusNodeIds?: string[],
  config?: QuizConfig,
  workspaceRoot?: string
): Promise<Quiz> {
  const quizConfig = config ?? {};
  const allowMulti = quizConfig.allowMultiChoice ?? true;

  const promptPath = path.join(PROMPTS_SOURCE, 'quiz_generator.txt');
  let system: string;
  try {
    system = await fs.readFile(promptPath, 'utf-8');
  } catch {
    system = `You are an exam question generator. Given study concepts, create multiple-choice questions. Respond with JSON only. Format: { "questions": [{ "id": "q_1", "type": "single_choice", "stem": "...", "options": ["..."], "answer": 0, "explanation": "...", "nodeId": "node_1", "difficulty": "medium" }] }`;
  }

  // Build user prompt with focus and multi-choice instructions
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

  if (allowMulti) {
    focusLines.push('要求：请混合出单选题(single_choice)和多选题(multi_choice)。多选题的 answer 为正确选项索引数组（如 [0,2]），至少 2 个正确答案，至少 4 个选项。');
    focusLines.push('');
  }

  const targetCount = quizConfig.questionCount ?? DEFAULT_QUESTION_COUNT;
  focusLines.push(`请出 ${targetCount} 道题。每道题包含 difficulty 字段（easy/medium/hard）。`);
  focusLines.push('');

  const user =
    focusLines.join('\n') + concepts.map((c) => `## ${c.name} [${c.id}]\n${c.definition}`).join('\n\n');
  const raw = await llm.completeJSON<{ questions: Question[] }>(system, user, { temperature: 0.7, retries: 3 });

  if (!Array.isArray(raw.questions) || raw.questions.length === 0) {
    throw new Error('Quiz generator returned no questions');
  }

  // Validate and normalize questions
  const validNodeIds = new Set(concepts.map((c) => c.id));
  for (const q of raw.questions) {
    if (!q.stem || typeof q.stem !== 'string') throw new Error('Question missing stem');
    if (!Array.isArray(q.options) || q.options.length < 2) {
      throw new Error('Question must have at least 2 options');
    }
    if (!q.explanation || typeof q.explanation !== 'string') throw new Error('Question missing explanation');
    if (!q.nodeId || !validNodeIds.has(q.nodeId)) {
      throw new Error(`Question references unknown concept: ${q.nodeId}`);
    }

    // Type-specific validation
    if (q.type === 'multi_choice') {
      if (!Array.isArray(q.answer) || q.answer.length < 2) {
        throw new Error('Multi-choice must have at least 2 correct answers');
      }
      if (q.options.length < 4) {
        throw new Error('Multi-choice must have at least 4 options');
      }
      for (const idx of q.answer) {
        if (typeof idx !== 'number' || idx < 0 || idx >= q.options.length) {
          throw new Error(`Multi-choice answer index out of range: ${idx}`);
        }
      }
      // Normalize: sort answer indices
      q.answer = [...q.answer].sort((a, b) => a - b);
    } else if (q.type === 'single_choice') {
      if (typeof q.answer !== 'number' || q.answer < 0 || q.answer >= q.options.length) {
        throw new Error(`Question answer index out of range: ${q.answer}`);
      }
    } else {
      throw new Error(`Unsupported question type: ${q.type}`);
    }

    // Normalize difficulty
    if (!q.difficulty || !['easy', 'medium', 'hard'].includes(q.difficulty)) {
      q.difficulty = 'medium';
    }
  }

  // Filter out multi_choice questions if not allowed
  if (!allowMulti) {
    raw.questions = raw.questions.filter((q) => q.type !== 'multi_choice');
    if (raw.questions.length === 0) {
      throw new Error('No questions remaining after filtering multi-choice');
    }
  }

  // Link source chunks from concept's relatedChunks
  const questions: Question[] = raw.questions.map((q, idx) => {
    const concept = conceptById.get(q.nodeId);
    return {
      ...q,
      id: `q_${date}_${idx}`,
      sourceChunkId: q.sourceChunkId ?? concept?.relatedChunks[0],
    };
  });

  const quiz: Quiz = { id: `quiz_${date}`, date, questions };

  const quizzesDir = workspaceRoot ? path.join(workspaceRoot, 'quizzes') : Paths.quizzes;
  await fs.mkdir(quizzesDir, { recursive: true });
  await fs.writeFile(path.join(quizzesDir, `${date}_quiz.json`), JSON.stringify(quiz, null, 2), 'utf-8');

  // Markdown output
  const lines: string[] = ['---', `date: ${date}`, 'tags: #studymate #quiz #daily-quiz', '---', '', `# ${date} 每日测验\n`];
  for (let i = 0; i < quiz.questions.length; i++) {
    const q = quiz.questions[i];
    const typeTag = q.type === 'multi_choice' ? '【多选】' : '';
    lines.push(`${i + 1}. ${typeTag}${q.stem}`);
    for (let j = 0; j < q.options.length; j++) {
      lines.push(`   ${String.fromCharCode(65 + j)}. ${q.options[j]}`);
    }
  }
  const markdown = lines.join('\n');
  await fs.writeFile(path.join(quizzesDir, `${date}_quiz.md`), markdown, 'utf-8');

  const event: Event = {
    id: createEventId(),
    timestamp: new Date().toISOString(),
    agent: 'quiz_generator',
    action: 'quiz_generated',
    input: { date, conceptCount: concepts.length, questionCount: targetCount },
    output: {
      quizId: quiz.id,
      questionCount: quiz.questions.length,
      multiChoiceCount: quiz.questions.filter((q) => q.type === 'multi_choice').length,
    },
  };
  await appendEvent(eventLogFile, event);

  return quiz;
}

/**
 * Generate a scoped quiz from today's plan and weakness profile.
 * This is the preferred entry point for the CLI.
 */
export async function generateScopedQuiz(
  scope: QuizScope,
  config: QuizConfig,
  llm: LLMClient,
  date: string,
  eventLogFile: string,
  workspaceRoot?: string
): Promise<Quiz> {
  const concepts = mergeScopeToConcepts(scope, config);
  const weakIds = scope.weakConcepts.map((c) => c.id);
  return generateQuiz(concepts, llm, date, eventLogFile, weakIds, config, workspaceRoot);
}
