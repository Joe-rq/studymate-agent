/**
 * SM-2 Spaced Repetition Algorithm
 *
 * Core implementation of the SuperMemo-2 algorithm for adaptive review scheduling.
 * Each concept maintains its own SR state that evolves based on recall quality.
 *
 * @see https://www.supermemo.com/en/archives1990-2015/english/ol/sm2
 */
import { addDaysToDateKey, daysBetweenDateKeys } from '../core/date.js';

/** SM-2 state for a single concept. */
export interface SRState {
  /** Current review interval in days. */
  interval: number;
  /** Ease factor (difficulty multiplier). Starts at 2.5, min 1.3. */
  easeFactor: number;
  /** Number of consecutive successful reviews. */
  repetitions: number;
  /** Next scheduled review date (YYYY-MM-DD). */
  dueDate: string;
}

/** Quality grades for SM-2 recall assessment (0-5 scale). */
export const enum Quality {
  FORGOT = 0,        // Complete blackout
  VERY_HARD = 1,     // Almost forgot, struggled greatly
  HARD = 2,          // Vague memory, had to think hard
  CORRECT_HARD = 3,  // Correct but with significant effort
  CORRECT = 4,       // Correct with minor hesitation
  PERFECT = 5,       // Perfect, instant recall
}

/** Minimum ease factor to prevent intervals from shrinking too much. */
export const MIN_EASE_FACTOR = 1.3;

/** Default initial ease factor for new concepts. */
export const DEFAULT_EASE_FACTOR = 2.5;

/** Initial interval after first successful review (days). */
export const INITIAL_INTERVAL = 1;

/** Second interval after second successful review (days). */
export const SECOND_INTERVAL = 6;

/**
 * Create initial SR state for a newly learned concept.
 * First review is scheduled 1 day after learning.
 */
export function createInitialSRState(learnDate: string): SRState {
  const dueDate = addDays(learnDate, INITIAL_INTERVAL);
  return {
    interval: INITIAL_INTERVAL,
    easeFactor: DEFAULT_EASE_FACTOR,
    repetitions: 0,
    dueDate,
  };
}

/**
 * Map a quiz session score (0-1) to SM-2 quality grade (0-5).
 *
 * Mapping:
 * - 0.0-0.2 → q=0 (完全忘记)
 * - 0.2-0.4 → q=1 (困难)
 * - 0.4-0.6 → q=2 (模糊)
 * - 0.6-0.8 → q=3 (正确但费力)
 * - 0.8-0.9 → q=4 (正确)
 * - 0.9-1.0 → q=5 (完美)
 */
export function scoreToQuality(score: number): number {
  if (score >= 0.9) return Quality.PERFECT;
  if (score >= 0.8) return Quality.CORRECT;
  if (score >= 0.6) return Quality.CORRECT_HARD;
  if (score >= 0.4) return Quality.HARD;
  if (score >= 0.2) return Quality.VERY_HARD;
  return Quality.FORGOT;
}

/**
 * Get a human-readable label for a quality grade.
 */
export function qualityLabel(quality: number): string {
  switch (quality) {
    case Quality.FORGOT: return '完全忘记';
    case Quality.VERY_HARD: return '困难';
    case Quality.HARD: return '模糊';
    case Quality.CORRECT_HARD: return '正确但费力';
    case Quality.CORRECT: return '正确';
    case Quality.PERFECT: return '完美';
    default: return `q=${quality}`;
  }
}

/**
 * Process a review and return updated SR state.
 *
 * SM-2 Algorithm:
 * - If quality >= 3 (correct):
 *   - First review: interval = 1
 *   - Second review: interval = 6
 *   - Subsequent: interval = interval * easeFactor
 *   - easeFactor adjusted by: EF' = EF + (0.1 - (5-q) * (0.08 + (5-q) * 0.02))
 * - If quality < 3 (forgot):
 *   - interval = 1 (reset)
 *   - repetitions = 0 (reset)
 *   - easeFactor -= 0.2 (penalize difficulty)
 *
 * @param state Current SR state
 * @param quality Recall quality (0-5)
 * @param reviewDate Date of this review (YYYY-MM-DD)
 * @returns New SR state with updated interval, easeFactor, repetitions, dueDate
 */
export function processReview(
  state: SRState,
  quality: number,
  reviewDate: string
): SRState {
  // Clamp quality to valid range
  const q = Math.max(0, Math.min(5, Math.round(quality)));

  let newInterval: number;
  let newEaseFactor: number;
  let newRepetitions: number;

  if (q >= 3) {
    // Successful recall
    newRepetitions = state.repetitions + 1;

    if (state.repetitions === 0) {
      // First successful review
      newInterval = INITIAL_INTERVAL;
    } else if (state.repetitions === 1) {
      // Second successful review
      newInterval = SECOND_INTERVAL;
    } else {
      // Subsequent reviews: multiply by ease factor
      newInterval = Math.round(state.interval * state.easeFactor);
    }

    // Adjust ease factor based on quality
    // Formula: EF' = EF + (0.1 - (5-q) * (0.08 + (5-q) * 0.02))
    const qualityDiff = 5 - q;
    const easeModifier = 0.1 - qualityDiff * (0.08 + qualityDiff * 0.02);
    newEaseFactor = Math.max(MIN_EASE_FACTOR, state.easeFactor + easeModifier);
  } else {
    // Failed recall: reset progress
    newRepetitions = 0;
    newInterval = INITIAL_INTERVAL;
    // Penalize ease factor for difficult concepts
    newEaseFactor = Math.max(MIN_EASE_FACTOR, state.easeFactor - 0.2);
  }

  // Calculate next due date
  const newDueDate = addDays(reviewDate, newInterval);

  return {
    interval: newInterval,
    easeFactor: newEaseFactor,
    repetitions: newRepetitions,
    dueDate: newDueDate,
  };
}

/**
 * Check if a concept is due for review on a given date.
 */
export function isDue(state: SRState | undefined, date: string): boolean {
  if (!state) return false;
  return state.dueDate <= date;
}

/**
 * Get days until next review (negative if overdue).
 */
export function daysUntilDue(state: SRState | undefined, currentDate: string): number {
  if (!state) return 0;
  return daysBetweenDateKeys(currentDate, state.dueDate);
}

// ── Helpers ─────────────────────────────────────────────────────────

function addDays(dateStr: string, days: number): string {
  return addDaysToDateKey(dateStr, days);
}
