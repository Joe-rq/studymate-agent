import fs from 'fs/promises';
import path from 'path';
import { Paths } from '../core/paths.js';
import {
  type BuddyState,
  type BuddyMemory,
  createDefaultBuddyState,
} from '../domain/buddy.js';
import { getSelectedCharacterId, DEFAULT_CHARACTER_ID } from '../core/character.js';

const MAX_MEMORIES = 20;

/** Resolve the buddy state file path. */
function stateFilePath(workspaceRoot?: string): string {
  const base = workspaceRoot ?? '.';
  const buddyDir = workspaceRoot ? path.join(base, 'buddy') : path.join(Paths.workspace, 'buddy');
  return path.join(buddyDir, 'state.json');
}

/**
 * Load buddy state from disk. Falls back to default state if file missing.
 * Migrates selectedCharacterId from workspace/config.json on first load.
 */
export async function loadBuddyState(workspaceRoot?: string): Promise<BuddyState> {
  const filePath = stateFilePath(workspaceRoot);
  try {
    const raw = JSON.parse(await fs.readFile(filePath, 'utf-8'));
    // Ensure required fields exist (forward compat)
    if (!raw.preferences) raw.preferences = { reminderIntensity: 'normal', emotionalStyle: 'warm' };
    if (!raw.memories) raw.memories = [];
    if (!raw.commitments) raw.commitments = [];
    if (raw.streakDays === undefined) raw.streakDays = 0;
    if (!raw.lastActiveDate) raw.lastActiveDate = '';
    if (raw.relationshipLevel === undefined) raw.relationshipLevel = 0;
    return raw as BuddyState;
  } catch {
    // First run: migrate character selection from config.json
    let characterId = DEFAULT_CHARACTER_ID;
    try {
      characterId = await getSelectedCharacterId(
        workspaceRoot ? path.join(workspaceRoot, 'config.json') : Paths.config
      );
    } catch {
      // config.json doesn't exist either
    }
    return createDefaultBuddyState(characterId);
  }
}

/** Persist buddy state to disk. */
export async function saveBuddyState(state: BuddyState, workspaceRoot?: string): Promise<void> {
  const filePath = stateFilePath(workspaceRoot);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * Add a memory to buddy state. Caps at MAX_MEMORIES (FIFO — oldest removed).
 * Returns a new state object (does not mutate input).
 */
export function addMemory(state: BuddyState, memory: BuddyMemory): BuddyState {
  const memories = [...state.memories, memory];
  while (memories.length > MAX_MEMORIES) {
    memories.shift();
  }
  return { ...state, memories };
}

/**
 * Update study streak based on today's date.
 * - If lastActiveDate is yesterday: increment streak.
 * - If lastActiveDate is today: no change (already counted).
 * - If gap > 1 day: reset streak to 1.
 * - If never active: set streak to 1.
 */
export function updateStreak(state: BuddyState, today: string): BuddyState {
  if (state.lastActiveDate === today) {
    return state; // Already active today
  }

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  let streakDays: number;
  if (state.lastActiveDate === yesterdayStr) {
    streakDays = state.streakDays + 1;
  } else if (!state.lastActiveDate) {
    streakDays = 1;
  } else {
    streakDays = 1; // Gap > 1 day, reset
  }

  return { ...state, streakDays, lastActiveDate: today };
}

/**
 * Mark commitments whose date has passed as fulfilled.
 * Returns new state (does not mutate input).
 */
export function fulfillCommitments(state: BuddyState, today: string): BuddyState {
  const commitments = state.commitments.map((c) => {
    if (c.date <= today && !c.fulfilled) {
      return { ...c, fulfilled: true };
    }
    return c;
  });
  return { ...state, commitments };
}

/**
 * Add a commitment the buddy makes to the user.
 */
export function addCommitment(state: BuddyState, date: string, text: string): BuddyState {
  const commitments = [...state.commitments, { date, text }];
  // Keep only last 10 commitments
  const trimmed = commitments.slice(-10);
  return { ...state, commitments: trimmed };
}

/**
 * Increase relationship level (capped at 100).
 */
export function increaseRelationship(state: BuddyState, amount: number): BuddyState {
  const relationshipLevel = Math.min(100, state.relationshipLevel + amount);
  return { ...state, relationshipLevel };
}
