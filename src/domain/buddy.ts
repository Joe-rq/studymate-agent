/**
 * BuddyState domain model.
 *
 * Represents the persistent state of the study companion across sessions:
 * relationship progression, user preferences, cross-session memories,
 * commitments, and study streak tracking.
 */

export type BuddyMemoryType = 'achievement' | 'struggle' | 'milestone' | 'preference';

export interface BuddyMemory {
  id: string;
  date: string;
  type: BuddyMemoryType;
  content: string;
}

export interface BuddyCommitment {
  date: string;
  text: string;
  fulfilled?: boolean;
}

export interface BuddyPreferences {
  reminderIntensity: 'gentle' | 'normal' | 'strict';
  emotionalStyle: 'warm' | 'neutral' | 'playful';
  /** Override character's default form of address. */
  formOfAddress?: string;
  /** 桌宠呈现模式：陪伴（默认）/ 安静 / 关闭。 */
  companionMode?: 'companion' | 'quiet' | 'off';
}

export interface BuddyState {
  characterId: string;
  /** Relationship progression: 0-100. */
  relationshipLevel: number;
  /** User preferences for interaction. */
  preferences: BuddyPreferences;
  /** Cross-session important memories (max 20, FIFO). */
  memories: BuddyMemory[];
  /** Recent commitments the buddy made (e.g. "明天复习 node_3"). */
  commitments: BuddyCommitment[];
  /** Consecutive study days streak. */
  streakDays: number;
  lastActiveDate: string;
}

/** Default state for a fresh buddy. */
export function createDefaultBuddyState(characterId: string): BuddyState {
  return {
    characterId,
    relationshipLevel: 0,
    preferences: {
      reminderIntensity: 'normal',
      emotionalStyle: 'warm',
      companionMode: 'companion',
    },
    memories: [],
    commitments: [],
    streakDays: 0,
    lastActiveDate: '',
  };
}
