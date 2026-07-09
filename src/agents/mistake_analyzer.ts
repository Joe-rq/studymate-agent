import fs from 'fs/promises';
import path from 'path';
import type { QuizResult } from './grader.js';
import type { Event } from '../core/types.js';
import { createEventId, appendEvent } from '../core/event_log.js';
import { Paths } from '../core/paths.js';

export interface Mistake {
  id: string;
  questionId: string;
  nodeId: string;
  errorType: 'concept_unclear' | 'careless' | 'memory_fuzzy';
  nextReview: string;
}

export function analyzeMistakes(result: QuizResult): Mistake[] {
  const today = new Date(result.date);
  return result.mistakes.map((m, idx) => {
    const nextReview = new Date(today);
    nextReview.setDate(today.getDate() + 1);
    return {
      id: `mist_${result.date}_${idx}`,
      questionId: m.question.id,
      nodeId: m.question.nodeId,
      errorType: 'concept_unclear',
      nextReview: nextReview.toISOString().split('T')[0],
    };
  });
}

export async function saveMistakes(
  mistakes: Mistake[],
  date: string,
  eventLogFile: string
): Promise<void> {
  await fs.mkdir(Paths.mistakes, { recursive: true });

  for (const mistake of mistakes) {
    await fs.appendFile(
      path.join(Paths.mistakes, 'mistake_log.jsonl'),
      JSON.stringify(mistake) + '\n',
      'utf-8'
    );
  }

  const weakNodes = [...new Set(mistakes.map((m) => m.nodeId))];
  const profile = { date, weakNodes, mistakeCount: mistakes.length };
  await fs.writeFile(path.join(Paths.mistakes, 'weakness_profile.json'), JSON.stringify(profile, null, 2), 'utf-8');

  const event: Event = {
    id: createEventId(),
    timestamp: new Date().toISOString(),
    agent: 'mistake_analyzer',
    action: 'mistakes_analyzed',
    input: { date },
    output: { mistakeCount: mistakes.length, weakNodes },
  };
  await appendEvent(eventLogFile, event);
}
