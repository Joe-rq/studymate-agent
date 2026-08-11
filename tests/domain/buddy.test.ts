import { describe, it, expect } from 'vitest';
import { deriveCompanionActivity, ACTIVE_AFTER_DAYS } from '../../src/domain/buddy.js';

describe('deriveCompanionActivity', () => {
  it('手动 off/quiet 始终覆盖自动档', () => {
    expect(deriveCompanionActivity('off', 5)).toBe('off');
    expect(deriveCompanionActivity('quiet', 5)).toBe('quiet');
    expect(deriveCompanionActivity('off', 0)).toBe('off');
  });

  it('companion 档按连续天数升级为 active', () => {
    expect(deriveCompanionActivity('companion', 0)).toBe('companion');
    expect(deriveCompanionActivity('companion', 2)).toBe('companion');
    expect(deriveCompanionActivity('companion', 3)).toBe('active');
    expect(deriveCompanionActivity('companion', 7)).toBe('active');
  });

  it('active 档在连续不足时自动回落', () => {
    expect(deriveCompanionActivity('active', 2)).toBe('companion');
    expect(deriveCompanionActivity('active', 3)).toBe('active');
  });

  it('缺省按 companion 处理', () => {
    expect(deriveCompanionActivity(undefined, 5)).toBe('active');
    expect(deriveCompanionActivity(undefined, 0)).toBe('companion');
  });

  it('ACTIVE_AFTER_DAYS 与连续学习里程碑对齐', () => {
    expect(ACTIVE_AFTER_DAYS).toBe(3);
  });
});
