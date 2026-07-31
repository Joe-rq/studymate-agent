import { describe, it, expect } from 'vitest';
import {
  addDaysToDateKey,
  dateKeyInTimeZone,
  daysBetweenDateKeys,
  isDateKey,
} from '../../src/core/date.js';

describe('date helpers', () => {
  it('uses the learner timezone instead of UTC for daily boundaries', () => {
    const instant = new Date('2026-07-30T16:30:00.000Z');
    expect(dateKeyInTimeZone(instant, 'Asia/Shanghai')).toBe('2026-07-31');
    expect(dateKeyInTimeZone(instant, 'UTC')).toBe('2026-07-30');
  });

  it('adds and compares logical dates without timezone drift', () => {
    expect(addDaysToDateKey('2026-07-30', 2)).toBe('2026-08-01');
    expect(daysBetweenDateKeys('2026-07-30', '2026-08-01')).toBe(2);
  });

  it('rejects impossible or non-canonical date keys', () => {
    expect(isDateKey('2026-02-29')).toBe(false);
    expect(isDateKey('2026-2-3')).toBe(false);
    expect(isDateKey('2028-02-29')).toBe(true);
  });
});
