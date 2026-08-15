import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  loadBuddyState,
  saveBuddyState,
  addMemory,
  updateStreak,
  fulfillCommitments,
  addCommitment,
  increaseRelationship,
} from '../../src/agents/buddy_state.js';
import { createDefaultBuddyState, type BuddyMemory } from '../../src/domain/buddy.js';

describe('buddy_state', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'buddy-state-'));
    // Create config.json so migration picks up character id
    await fs.writeFile(
      path.join(tmpDir, 'config.json'),
      JSON.stringify({ selectedCharacterId: 'test_char' }),
      'utf-8'
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('loadBuddyState', () => {
    it('returns default state when file does not exist', async () => {
      const state = await loadBuddyState(tmpDir);
      expect(state.characterId).toBe('test_char');
      expect(state.relationshipLevel).toBe(0);
      expect(state.memories).toEqual([]);
      expect(state.commitments).toEqual([]);
      expect(state.streakDays).toBe(0);
    });

    it('loads persisted state from disk', async () => {
      const saved = createDefaultBuddyState('saved_char');
      saved.streakDays = 5;
      saved.relationshipLevel = 30;
      await saveBuddyState(saved, tmpDir);

      const loaded = await loadBuddyState(tmpDir);
      expect(loaded.characterId).toBe('saved_char');
      expect(loaded.streakDays).toBe(5);
      expect(loaded.relationshipLevel).toBe(30);
    });
  });

  describe('saveBuddyState', () => {
    it('persists state and round-trips', async () => {
      const state = createDefaultBuddyState('round_trip');
      state.memories = [{ id: 'm1', date: '2026-01-01', type: 'achievement', content: 'test' }];
      await saveBuddyState(state, tmpDir);

      const raw = JSON.parse(
        await fs.readFile(path.join(tmpDir, 'buddy', 'state.json'), 'utf-8')
      );
      expect(raw.characterId).toBe('round_trip');
      expect(raw.memories).toHaveLength(1);
    });
  });

  describe('addMemory', () => {
    it('appends memory to state', () => {
      const state = createDefaultBuddyState('c1');
      const memory: BuddyMemory = { id: 'm1', date: '2026-01-01', type: 'achievement', content: 'first' };
      const updated = addMemory(state, memory);
      expect(updated.memories).toHaveLength(1);
      expect(updated.memories[0].id).toBe('m1');
    });

    it('caps memories at 20 (FIFO)', () => {
      let state = createDefaultBuddyState('c1');
      for (let i = 0; i < 25; i++) {
        state = addMemory(state, {
          id: `m${i}`,
          date: `2026-01-${String(i + 1).padStart(2, '0')}`,
          type: 'achievement',
          content: `memory ${i}`,
        });
      }
      expect(state.memories).toHaveLength(20);
      // First 5 should be removed
      expect(state.memories[0].id).toBe('m5');
      expect(state.memories[19].id).toBe('m24');
    });
  });

  describe('updateStreak', () => {
    it('sets streak to 1 on first active day', () => {
      const state = createDefaultBuddyState('c1');
      const updated = updateStreak(state, '2026-01-15');
      expect(updated.streakDays).toBe(1);
      expect(updated.lastActiveDate).toBe('2026-01-15');
    });

    it('increments streak on consecutive day', () => {
      let state = createDefaultBuddyState('c1');
      state = updateStreak(state, '2026-01-15');
      state = updateStreak(state, '2026-01-16');
      expect(state.streakDays).toBe(2);
    });

    it('does not change streak if already active today', () => {
      let state = createDefaultBuddyState('c1');
      state = updateStreak(state, '2026-01-15');
      state = updateStreak(state, '2026-01-15'); // same day
      expect(state.streakDays).toBe(1);
    });

    it('resets streak when gap > 1 day', () => {
      let state = createDefaultBuddyState('c1');
      state = updateStreak(state, '2026-01-15');
      state = updateStreak(state, '2026-01-16'); // streak = 2
      state = updateStreak(state, '2026-01-18'); // skip a day
      expect(state.streakDays).toBe(1);
    });
  });

  describe('fulfillCommitments', () => {
    it('marks past commitments as fulfilled', () => {
      let state = createDefaultBuddyState('c1');
      state = addCommitment(state, '2026-01-10', 'review node_1');
      state = addCommitment(state, '2026-01-20', 'review node_2');
      const updated = fulfillCommitments(state, '2026-01-15');
      expect(updated.commitments[0].fulfilled).toBe(true);
      expect(updated.commitments[1].fulfilled).toBeUndefined();
    });
  });

  describe('addCommitment', () => {
    it('appends commitment and caps at 10', () => {
      let state = createDefaultBuddyState('c1');
      for (let i = 0; i < 12; i++) {
        state = addCommitment(state, `2026-01-${i + 1}`, `commit ${i}`);
      }
      expect(state.commitments).toHaveLength(10);
      expect(state.commitments[0].text).toBe('commit 2');
    });
  });

  describe('increaseRelationship', () => {
    it('increases relationship level', () => {
      const state = createDefaultBuddyState('c1');
      const updated = increaseRelationship(state, 5);
      expect(updated.relationshipLevel).toBe(5);
    });

    it('caps at 100', () => {
      let state = createDefaultBuddyState('c1');
      state.relationshipLevel = 95;
      const updated = increaseRelationship(state, 10);
      expect(updated.relationshipLevel).toBe(100);
    });
  });
});
