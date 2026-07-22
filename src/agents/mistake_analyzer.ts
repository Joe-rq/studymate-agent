import fs from 'fs/promises';
import path from 'path';
import type { QuizResult, GradedQuestion } from './grader.js';
import type { Concept } from './concept_mapper.js';
import type { Event } from '../core/types.js';
import { createEventId, appendEvent } from '../core/event_log.js';
import { Paths } from '../core/paths.js';

// ── Types ────────────────────────────────────────────────────────────

export type ErrorType = 'concept_unclear' | 'memory_fuzzy' | 'careless' | 'multi_partial';

export interface Mistake {
  id: string;
  questionId: string;
  nodeId: string;
  errorType: ErrorType;
  nextReview: string;
}

/** Per-node weakness record in the cumulative profile. */
export interface WeaknessNodeRecord {
  mistakeCount: number;
  lastSeen: string;
  errorTypes: ErrorType[];
  /** Consecutive correct count since last mistake (reset on new mistake). */
  consecutiveCorrect: number;
  firstSeen: string;
  /** Why this node is considered weak (explainability). */
  reason: string;
}

/** Cumulative weakness profile persisted to weakness_profile.json. */
export interface WeaknessProfile {
  lastUpdated: string;
  nodes: Record<string, WeaknessNodeRecord>;
}

// ── Error Classification ────────────────────────────────────────────

/**
 * Rule-based error classification (no LLM attribution).
 * Rule 1: multi_choice with partial credit → 'multi_partial'
 * Rule 2: concept mastery < 0.3 → 'concept_unclear'
 * Rule 3: concept mastery >= 0.7 but got wrong → 'careless'
 * Rule 4: otherwise → 'memory_fuzzy'
 */
export function classifyError(graded: GradedQuestion, concept?: Concept): ErrorType {
  // Rule 1: partial credit on multi-choice
  if (graded.score === 50 && graded.question.type === 'multi_choice') {
    return 'multi_partial';
  }
  const mastery = concept?.mastery ?? 0.5;
  // Rule 2: low mastery
  if (mastery < 0.3) {
    return 'concept_unclear';
  }
  // Rule 3: high mastery but wrong
  if (mastery >= 0.7) {
    return 'careless';
  }
  // Rule 4: default
  return 'memory_fuzzy';
}

// ── Analysis ────────────────────────────────────────────────────────

export function analyzeMistakes(result: QuizResult, concepts?: Concept[]): Mistake[] {
  const today = new Date(result.date);
  const conceptById = new Map((concepts ?? []).map((c) => [c.id, c]));

  return result.mistakes.map((m, idx) => {
    const nextReview = new Date(today);
    nextReview.setDate(today.getDate() + 1);
    const concept = conceptById.get(m.question.nodeId);
    return {
      id: `mist_${result.date}_${idx}`,
      questionId: m.question.id,
      nodeId: m.question.nodeId,
      errorType: classifyError(m, concept),
      nextReview: nextReview.toISOString().split('T')[0],
    };
  });
}

// ── Weakness Profile ────────────────────────────────────────────────

/** Read existing weakness profile or return empty. */
async function loadWeaknessProfile(mistakesDir: string): Promise<WeaknessProfile> {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(mistakesDir, 'weakness_profile.json'), 'utf-8'));
    // Migrate old schema if needed
    if (raw.nodes) {
      for (const node of Object.values(raw.nodes) as WeaknessNodeRecord[]) {
        if (!node.firstSeen) node.firstSeen = node.lastSeen;
        if (node.consecutiveCorrect === undefined) node.consecutiveCorrect = 0;
        if (!node.reason) node.reason = `累计错误 ${node.mistakeCount} 次`;
      }
    }
    return raw;
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
      existing.consecutiveCorrect = 0; // Reset on new mistake
      if (!existing.errorTypes.includes(m.errorType)) {
        existing.errorTypes.push(m.errorType);
      }
      existing.reason = `累计错误 ${existing.mistakeCount} 次，最近错误类型: ${m.errorType}`;
    } else {
      profile.nodes[m.nodeId] = {
        mistakeCount: 1,
        lastSeen: date,
        errorTypes: [m.errorType],
        consecutiveCorrect: 0,
        firstSeen: date,
        reason: `首次错误，类型: ${m.errorType}`,
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

// ── Explainability ──────────────────────────────────────────────────

/**
 * Generate a human-readable explanation of why a concept is weak.
 */
export function explainWeakness(nodeId: string, profile: WeaknessProfile): string {
  const node = profile.nodes[nodeId];
  if (!node) return `概念 ${nodeId} 不在薄弱点列表中。`;

  const parts: string[] = [];
  parts.push(`累计错误 ${node.mistakeCount} 次`);
  parts.push(`首次出现: ${node.firstSeen}`);
  parts.push(`最近错误: ${node.lastSeen}`);
  parts.push(`错误类型: ${node.errorTypes.join(', ')}`);
  if (node.consecutiveCorrect > 0) {
    parts.push(`近期连续正确 ${node.consecutiveCorrect} 次（正在恢复）`);
  }
  return parts.join('；');
}

// ── Persistence ─────────────────────────────────────────────────────

/** Public accessor for weakness profile (used by grade_and_adapt workflow). */
export async function loadWeaknessProfilePublic(workspaceRoot?: string): Promise<WeaknessProfile> {
  const mistakesDir = workspaceRoot ? path.join(workspaceRoot, 'mistakes') : Paths.mistakes;
  return loadWeaknessProfile(mistakesDir);
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
