import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import {
  loadCharacter,
  listCharacters,
  getSelectedCharacterId,
  getSelectedCharacter,
  saveSelectedCharacter,
  DEFAULT_CHARACTER_ID,
} from '../../src/core/character.js';

const TEST_DIR = path.join(process.cwd(), 'workspace_test_character');
const TEST_CONFIG = path.join(TEST_DIR, 'config.json');

beforeEach(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

describe('loadCharacter', () => {
  it('loads a built-in character with all fields', async () => {
    const c = await loadCharacter('lu_xingye');
    expect(c.id).toBe('lu_xingye');
    expect(c.name).toBe('陆星野');
    expect(c.gender).toBe('male');
    expect(c.personality).toBeTruthy();
    expect(c.formOfAddress).toBeTruthy();
    expect(c.catchphrases.length).toBeGreaterThan(0);
  });

  it('throws on unknown id', async () => {
    await expect(loadCharacter('nonexistent')).rejects.toThrow();
  });
});

describe('listCharacters', () => {
  it('returns all 4 built-in characters', async () => {
    const list = await listCharacters();
    expect(list.length).toBe(4);
    const ids = list.map((c) => c.id).sort();
    expect(ids).toEqual(['lu_xingye', 'shen_ye', 'su_nian', 'tuanzi']);
  });
});

describe('character selection persistence', () => {
  it('returns default when no config exists', async () => {
    const id = await getSelectedCharacterId(TEST_CONFIG);
    expect(id).toBe(DEFAULT_CHARACTER_ID);
  });

  it('persists and reads back selected id', async () => {
    await saveSelectedCharacter('shen_ye', TEST_CONFIG);
    expect(await getSelectedCharacterId(TEST_CONFIG)).toBe('shen_ye');
  });

  it('getSelectedCharacter returns the full character object', async () => {
    await saveSelectedCharacter('su_nian', TEST_CONFIG);
    const c = await getSelectedCharacter(TEST_CONFIG);
    expect(c.id).toBe('su_nian');
    expect(c.name).toBe('苏念');
  });

  it('falls back to default when selected id is invalid', async () => {
    await saveSelectedCharacter('ghost_id', TEST_CONFIG);
    const c = await getSelectedCharacter(TEST_CONFIG);
    expect(c.id).toBe(DEFAULT_CHARACTER_ID);
  });

  it('preserves existing config keys when writing', async () => {
    await fs.mkdir(TEST_DIR, { recursive: true });
    await fs.writeFile(
      TEST_CONFIG,
      JSON.stringify({ otherKey: 'keep-me', selectedCharacterId: 'lu_xingye' }),
      'utf-8'
    );
    await saveSelectedCharacter('tuanzi', TEST_CONFIG);
    const raw = JSON.parse(await fs.readFile(TEST_CONFIG, 'utf-8'));
    expect(raw.otherKey).toBe('keep-me');
    expect(raw.selectedCharacterId).toBe('tuanzi');
  });
});
