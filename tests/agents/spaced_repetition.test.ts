import { describe, it, expect } from 'vitest';
import {
  createInitialSRState,
  processReview,
  scoreToQuality,
  isDue,
  daysUntilDue,
  qualityLabel,
  DEFAULT_EASE_FACTOR,
  INITIAL_INTERVAL,
  SECOND_INTERVAL,
  MIN_EASE_FACTOR,
} from '../../src/agents/spaced_repetition.js';

describe('spaced_repetition', () => {
  describe('createInitialSRState', () => {
    it('should create state with interval=1 and default easeFactor', () => {
      const state = createInitialSRState('2026-07-22');
      expect(state.interval).toBe(INITIAL_INTERVAL);
      expect(state.easeFactor).toBe(DEFAULT_EASE_FACTOR);
      expect(state.repetitions).toBe(0);
      expect(state.dueDate).toBe('2026-07-23');
    });
  });

  describe('scoreToQuality', () => {
    it('should map scores to correct quality grades', () => {
      expect(scoreToQuality(0.0)).toBe(0);
      expect(scoreToQuality(0.1)).toBe(0);
      expect(scoreToQuality(0.2)).toBe(1);
      expect(scoreToQuality(0.3)).toBe(1);
      expect(scoreToQuality(0.4)).toBe(2);
      expect(scoreToQuality(0.5)).toBe(2);
      expect(scoreToQuality(0.6)).toBe(3);
      expect(scoreToQuality(0.7)).toBe(3);
      expect(scoreToQuality(0.8)).toBe(4);
      expect(scoreToQuality(0.85)).toBe(4);
      expect(scoreToQuality(0.9)).toBe(5);
      expect(scoreToQuality(1.0)).toBe(5);
    });
  });

  describe('qualityLabel', () => {
    it('should return correct Chinese labels', () => {
      expect(qualityLabel(0)).toBe('完全忘记');
      expect(qualityLabel(3)).toBe('正确但费力');
      expect(qualityLabel(5)).toBe('完美');
    });

    it('should handle invalid quality', () => {
      expect(qualityLabel(10)).toBe('q=10');
    });
  });

  describe('processReview', () => {
    describe('successful recall (q >= 3)', () => {
      it('should set interval=1 on first successful review', () => {
        const initial = createInitialSRState('2026-07-22');
        const result = processReview(initial, 4, '2026-07-23');
        expect(result.repetitions).toBe(1);
        expect(result.interval).toBe(INITIAL_INTERVAL);
        expect(result.dueDate).toBe('2026-07-24');
      });

      it('should set interval=6 on second successful review', () => {
        const initial = createInitialSRState('2026-07-22');
        const afterFirst = processReview(initial, 4, '2026-07-23');
        const afterSecond = processReview(afterFirst, 4, '2026-07-24');
        expect(afterSecond.repetitions).toBe(2);
        expect(afterSecond.interval).toBe(SECOND_INTERVAL);
        expect(afterSecond.dueDate).toBe('2026-07-30');
      });

      it('should multiply interval by easeFactor on subsequent reviews', () => {
        const initial = createInitialSRState('2026-07-22');
        let state = processReview(initial, 5, '2026-07-23');
        state = processReview(state, 5, '2026-07-24');
        state = processReview(state, 5, '2026-07-30');
        // interval should be 6 * easeFactor (~2.6) = ~15-16 days
        expect(state.interval).toBeGreaterThan(14);
        expect(state.interval).toBeLessThan(20);
        expect(state.repetitions).toBe(3);
      });

      it('should increase easeFactor for perfect recall (q=5)', () => {
        const initial = createInitialSRState('2026-07-22');
        const result = processReview(initial, 5, '2026-07-23');
        expect(result.easeFactor).toBeGreaterThan(DEFAULT_EASE_FACTOR);
      });

      it('should decrease easeFactor slightly for hard recall (q=3)', () => {
        const initial = createInitialSRState('2026-07-22');
        const result = processReview(initial, 3, '2026-07-23');
        // q=3: easeModifier = 0.1 - 2*(0.08 + 2*0.02) = 0.1 - 2*0.12 = -0.14
        expect(result.easeFactor).toBeLessThan(DEFAULT_EASE_FACTOR);
        expect(result.easeFactor).toBeGreaterThan(MIN_EASE_FACTOR);
      });
    });

    describe('failed recall (q < 3)', () => {
      it('should reset interval to 1 and repetitions to 0', () => {
        const initial = createInitialSRState('2026-07-22');
        let state = processReview(initial, 4, '2026-07-23');
        state = processReview(state, 4, '2026-07-24');
        expect(state.repetitions).toBe(2);

        // Now fail
        state = processReview(state, 1, '2026-07-30');
        expect(state.repetitions).toBe(0);
        expect(state.interval).toBe(INITIAL_INTERVAL);
        expect(state.dueDate).toBe('2026-07-31');
      });

      it('should decrease easeFactor for failed recall', () => {
        const initial = createInitialSRState('2026-07-22');
        const result = processReview(initial, 0, '2026-07-23');
        expect(result.easeFactor).toBe(DEFAULT_EASE_FACTOR - 0.2);
      });

      it('should not decrease easeFactor below minimum', () => {
        const initial = createInitialSRState('2026-07-22');
        let state = { ...initial, easeFactor: MIN_EASE_FACTOR };
        state = processReview(state, 0, '2026-07-23');
        expect(state.easeFactor).toBe(MIN_EASE_FACTOR);
      });
    });

    describe('edge cases', () => {
      it('should clamp quality to valid range', () => {
        const initial = createInitialSRState('2026-07-22');
        const resultHigh = processReview(initial, 10, '2026-07-23');
        expect(resultHigh.repetitions).toBe(1);

        const resultLow = processReview(initial, -5, '2026-07-23');
        expect(resultLow.repetitions).toBe(0);
        expect(resultLow.interval).toBe(INITIAL_INTERVAL);
      });
    });
  });

  describe('isDue', () => {
    it('should return true when dueDate <= currentDate', () => {
      const state = createInitialSRState('2026-07-22');
      expect(isDue(state, '2026-07-23')).toBe(true);
      expect(isDue(state, '2026-07-24')).toBe(true);
    });

    it('should return false when dueDate > currentDate', () => {
      const state = createInitialSRState('2026-07-22');
      expect(isDue(state, '2026-07-22')).toBe(false);
    });

    it('should return false for undefined state', () => {
      expect(isDue(undefined, '2026-07-23')).toBe(false);
    });
  });

  describe('daysUntilDue', () => {
    it('should return positive days when not yet due', () => {
      const state = createInitialSRState('2026-07-22');
      expect(daysUntilDue(state, '2026-07-22')).toBe(1);
    });

    it('should return 0 when due today', () => {
      const state = createInitialSRState('2026-07-22');
      expect(daysUntilDue(state, '2026-07-23')).toBe(0);
    });

    it('should return negative days when overdue', () => {
      const state = createInitialSRState('2026-07-22');
      expect(daysUntilDue(state, '2026-07-25')).toBe(-2);
    });

    it('should return 0 for undefined state', () => {
      expect(daysUntilDue(undefined, '2026-07-23')).toBe(0);
    });
  });

  describe('full scenario: learning progression', () => {
    it('should demonstrate typical SM-2 progression', () => {
      // Day 1: Learn concept
      let state = createInitialSRState('2026-07-01');
      expect(state.dueDate).toBe('2026-07-02');

      // Day 2: First review - perfect recall (q=5)
      state = processReview(state, 5, '2026-07-02');
      expect(state.repetitions).toBe(1);
      expect(state.interval).toBe(1);
      expect(state.dueDate).toBe('2026-07-03');

      // Day 3: Second review - good recall (q=4)
      state = processReview(state, 4, '2026-07-03');
      expect(state.repetitions).toBe(2);
      expect(state.interval).toBe(6);
      expect(state.dueDate).toBe('2026-07-09');

      // Day 9: Third review - good recall (q=4)
      state = processReview(state, 4, '2026-07-09');
      expect(state.repetitions).toBe(3);
      // interval should be ~6 * 2.6 = 15-16
      expect(state.interval).toBeGreaterThanOrEqual(14);
      expect(state.dueDate).toBe('2026-07-25');

      // Day 25: Fourth review - forgot! (q=1)
      state = processReview(state, 1, '2026-07-25');
      expect(state.repetitions).toBe(0);
      expect(state.interval).toBe(1);
      expect(state.dueDate).toBe('2026-07-26');
    });
  });
});
