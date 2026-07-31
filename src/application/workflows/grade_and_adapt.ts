/**
 * Grade and Adapt Workflow
 *
 * Encapsulates the full post-quiz pipeline:
 * 1. Grade the quiz
 * 2. Analyze mistakes
 * 3. Update mastery (EMA)
 * 4. Adjust the study plan based on weak concepts
 *
 * This is extracted from cli.ts grade command to be reusable by Web UI
 * and other interfaces.
 */

import fs from 'fs/promises';
import path from 'path';
import { gradeQuiz, saveResult, type UserAnswer, type QuizResult } from '../../agents/grader.js';
import { analyzeMistakes, saveMistakes } from '../../agents/mistake_analyzer.js';
import { updateMastery, saveMastery, type MasteryChange } from '../../agents/mastery_tracker.js';
import { adjustPlan, saveAdjustedPlan, type PlanAdjustment } from '../../agents/plan_adjuster.js';
import type { Quiz } from '../../agents/quiz_generator.js';
import type { ConceptMap } from '../../agents/concept_mapper.js';
import type { StudyPlan } from '../../agents/planner.js';
import { createCorrelationId } from '../../core/event_log.js';

export interface GradeAndAdaptInput {
  quiz: Quiz;
  answers: UserAnswer[];
  /** Path to concepts.json */
  conceptsPath: string;
  /** Path to plan_master.json (optional — plan adjustment skipped if missing) */
  planPath?: string;
  /** Event log file path */
  eventLogFile: string;
  /** Optional workspace root for test isolation */
  workspaceRoot?: string;
}

export interface GradeAndAdaptResult {
  /** The graded quiz result. */
  result: QuizResult;
  /** Mistakes extracted from this session. */
  mistakeNodeIds: string[];
  /** Mastery changes for concepts tested in this session. */
  masteryChanges: MasteryChange[];
  /** Plan adjustments made based on weak concepts. */
  adjustments: PlanAdjustment[];
  /** Correlation ID linking all events from this session. */
  correlationId: string;
}

export async function gradeAndAdapt(input: GradeAndAdaptInput): Promise<GradeAndAdaptResult> {
  const { quiz, answers, conceptsPath, planPath, eventLogFile, workspaceRoot } = input;
  const correlationId = createCorrelationId();
  const date = quiz.date;

  // 1. Grade the quiz
  const result = gradeQuiz(quiz, answers);
  await saveResult(result, eventLogFile, workspaceRoot);

  // 2. Analyze mistakes and save cumulatively
  const mistakes = analyzeMistakes(result);
  await saveMistakes(mistakes, date, eventLogFile, workspaceRoot);
  const mistakeNodeIds = [...new Set(mistakes.map((m) => m.nodeId))];

  // 3. Update mastery via EMA
  const conceptMap: ConceptMap = JSON.parse(await fs.readFile(conceptsPath, 'utf-8'));
  const masteryUpdate = updateMastery(conceptMap, result);
  await saveMastery(masteryUpdate, eventLogFile, workspaceRoot);

  // 4. Adjust plan if one exists
  let adjustments: PlanAdjustment[] = [];
  if (planPath) {
    try {
      const plan: StudyPlan = JSON.parse(await fs.readFile(planPath, 'utf-8'));
      const adjusted = adjustPlan(plan, masteryUpdate.conceptMap);
      await saveAdjustedPlan(adjusted.plan, adjusted.adjustments, eventLogFile, workspaceRoot);
      adjustments = adjusted.adjustments;
    } catch {
      // plan_master.json doesn't exist — skip plan adjustment
    }
  }

  return {
    result,
    mistakeNodeIds,
    masteryChanges: masteryUpdate.changes,
    adjustments,
    correlationId,
  };
}
