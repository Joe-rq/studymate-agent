import { describe, it, expect } from 'vitest';
import { shouldIntervene, type InterventionContext } from '../../src/agents/buddy_interventions.js';
import { createDefaultBuddyState } from '../../src/domain/buddy.js';
import type { StudyContext } from '../../src/core/context_reader.js';

function makeCtx(overrides?: Partial<StudyContext>): StudyContext {
  return {
    daysToExam: 30,
    avgMastery: 0.5,
    weakNodeNames: ['node_1'],
    recentScore: null,
    tasksToday: 3,
    ...overrides,
  };
}

describe('buddy_interventions', () => {
  describe('shouldIntervene', () => {
    it('always returns true for exam_created', () => {
      const state = createDefaultBuddyState('c1');
      expect(shouldIntervene('exam_created', state, makeCtx())).toBe(true);
    });

    it('always returns true for plan_confirmed', () => {
      const state = createDefaultBuddyState('c1');
      expect(shouldIntervene('plan_confirmed', state, makeCtx())).toBe(true);
    });

    it('returns true for task_start when streak is 0', () => {
      const state = createDefaultBuddyState('c1');
      state.streakDays = 0;
      expect(shouldIntervene('task_start', state, makeCtx())).toBe(true);
    });

    it('returns true for task_start at milestone streak (3)', () => {
      const state = createDefaultBuddyState('c1');
      state.streakDays = 3;
      expect(shouldIntervene('task_start', state, makeCtx())).toBe(true);
    });

    it('returns false for task_start at non-milestone streak', () => {
      const state = createDefaultBuddyState('c1');
      state.streakDays = 5;
      expect(shouldIntervene('task_start', state, makeCtx())).toBe(false);
    });

    it('returns true for task_skipped when reminderIntensity is strict', () => {
      const state = createDefaultBuddyState('c1');
      state.preferences.reminderIntensity = 'strict';
      expect(shouldIntervene('task_skipped', state, makeCtx())).toBe(true);
    });

    it('returns true for task_skipped when reminderIntensity is normal', () => {
      const state = createDefaultBuddyState('c1');
      state.preferences.reminderIntensity = 'normal';
      expect(shouldIntervene('task_skipped', state, makeCtx())).toBe(true);
    });

    it('returns false for task_skipped when reminderIntensity is gentle', () => {
      const state = createDefaultBuddyState('c1');
      state.preferences.reminderIntensity = 'gentle';
      expect(shouldIntervene('task_skipped', state, makeCtx())).toBe(false);
    });

    it('returns true for streak_milestone at 7 days', () => {
      const state = createDefaultBuddyState('c1');
      state.streakDays = 7;
      expect(shouldIntervene('streak_milestone', state, makeCtx())).toBe(true);
    });

    it('returns false for streak_milestone at non-milestone', () => {
      const state = createDefaultBuddyState('c1');
      state.streakDays = 4;
      expect(shouldIntervene('streak_milestone', state, makeCtx())).toBe(false);
    });

    it('returns true for low_score when score < 50', () => {
      const state = createDefaultBuddyState('c1');
      const extra: InterventionContext = { score: 40 };
      expect(shouldIntervene('low_score', state, makeCtx(), extra)).toBe(true);
    });

    it('returns false for low_score when score >= 50', () => {
      const state = createDefaultBuddyState('c1');
      const extra: InterventionContext = { score: 60 };
      expect(shouldIntervene('low_score', state, makeCtx(), extra)).toBe(false);
    });

    it('returns false for low_score when no score provided', () => {
      const state = createDefaultBuddyState('c1');
      expect(shouldIntervene('low_score', state, makeCtx())).toBe(false);
    });

    it('returns true for improvement when masteryDelta >= 0.1', () => {
      const state = createDefaultBuddyState('c1');
      const extra: InterventionContext = { masteryDelta: 0.15 };
      expect(shouldIntervene('improvement', state, makeCtx(), extra)).toBe(true);
    });

    it('returns false for improvement when masteryDelta < 0.1', () => {
      const state = createDefaultBuddyState('c1');
      const extra: InterventionContext = { masteryDelta: 0.05 };
      expect(shouldIntervene('improvement', state, makeCtx(), extra)).toBe(false);
    });

    it('returns true for exam_approaching when days <= 7 and > 0', () => {
      const state = createDefaultBuddyState('c1');
      expect(shouldIntervene('exam_approaching', state, makeCtx({ daysToExam: 5 }))).toBe(true);
    });

    it('returns false for exam_approaching when days > 7', () => {
      const state = createDefaultBuddyState('c1');
      expect(shouldIntervene('exam_approaching', state, makeCtx({ daysToExam: 10 }))).toBe(false);
    });

    it('returns false for exam_approaching when days is 0 or null', () => {
      const state = createDefaultBuddyState('c1');
      expect(shouldIntervene('exam_approaching', state, makeCtx({ daysToExam: 0 }))).toBe(false);
      expect(shouldIntervene('exam_approaching', state, makeCtx({ daysToExam: null }))).toBe(false);
    });
  });
});
