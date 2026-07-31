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

/** Per-node weakness record in the cumulative profile. */
export interface WeaknessNodeRecord {
  mistakeCount: number;
  lastSeen: string;
  errorTypes: string[];
}

/** Cumulative weakness profile persisted to weakness_profile.json. */
export interface WeaknessProfile {
  lastUpdated: string;
  nodes: Record<string, WeaknessNodeRecord>;
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

/** Read existing weakness profile or return empty. */
async function loadWeaknessProfile(mistakesDir: string): Promise<WeaknessProfile> {
  try {
    return JSON.parse(
      await fs.readFile(path.join(mistakesDir, 'weakness_profile.json'), 'utf-8')
    );
  } catch {
    return { lastUpdated: '', nodes: {} };
  }
}

/** Merge new mistakes into the cumulative weakness profile. */
function mergeWeaknesses(
  profile: WeaknessProfile,
  mistakes: Mistake[],
  date: string
): WeaknessProfile {
  for (const m of mistakes) {
    const existing = profile.nodes[m.nodeId];
    if (existing) {
      existing.mistakeCount += 1;
      existing.lastSeen = date;
      if (!existing.errorTypes.includes(m.errorType)) {
        existing.errorTypes.push(m.errorType);
      }
    } else {
      profile.nodes[m.nodeId] = {
        mistakeCount: 1,
        lastSeen: date,
        errorTypes: [m.errorType],
      };
    }
  }
  profile.lastUpdated = date;
  return profile;
}

/** Derive weakNodes array (sorted by mistakeCount descending) for backward compat. */
function deriveWeakNodes(profile: WeaknessProfile): string[] {
  return Object.entries(profile.nodes)
    .sort((a, b) => b[1].mistakeCount - a[1].mistakeCount)
    .map(([nodeId]) => nodeId);
}

export async function saveMistakes(
  mistakes: Mistake[],
  date: string,
  eventLogFile: string,
  workspaceRoot?: string
): Promise<void> {
  const mistakesDir = workspaceRoot ? path.join(workspaceRoot, 'mistakes') : Paths.mistakes;
  await fs.mkdir(mistakesDir, { recursive: true });

  for (const mistake of mistakes) {
    await fs.appendFile(
      path.join(mistakesDir, 'mistake_log.jsonl'),
      JSON.stringify(mistake) + '\n',
      'utf-8'
    );
  }

  // Cumulative weakness profile: merge with existing data
  const profile = await loadWeaknessProfile(mistakesDir);
  const updated = mergeWeaknesses(profile, mistakes, date);
  const weakNodes = deriveWeakNodes(updated);

  // Write the new schema (with nodes map)
  await fs.writeFile(
    path.join(mistakesDir, 'weakness_profile.json'),
    JSON.stringify(updated, null, 2),
    'utf-8'
  );

  if (mistakes.length > 0) {
    const lines: string[] = [
      '---',
      `date: ${date}`,
      'tags: #studymate #mistake #weakness',
      '---',
      '',
      `# ${date} 错题本`,
      '',
      `**薄弱知识点**：${weakNodes.join(', ')}`,
      '',
    ];
    for (const m of mistakes) {
      lines.push(`- [[${m.nodeId}]] — 错误类型：${m.errorType} — 下次复习：${m.nextReview}`);
    }
    await fs.writeFile(path.join(mistakesDir, `${date}_wrong.md`), lines.join('\n'), 'utf-8');
  }

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
