import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { atomicWriteFile } from '../../src/core/atomic_file.js';

const TEST_ROOT = path.join(process.cwd(), 'workspace_test_atomic_file');

describe('atomicWriteFile', () => {
  beforeEach(async () => {
    await fs.rm(TEST_ROOT, { recursive: true, force: true });
    await fs.mkdir(TEST_ROOT, { recursive: true });
  });

  it('leaves the previous file intact when replacement fails', async () => {
    const target = path.join(TEST_ROOT, 'state.json');
    await fs.writeFile(target, '{"version":1}', 'utf-8');

    await expect(
      atomicWriteFile(target, '{"version":2}', 'utf-8', {
        mkdir: fs.mkdir,
        writeFile: fs.writeFile,
        rename: async () => {
          throw new Error('simulated replacement failure');
        },
        unlink: fs.unlink,
      })
    ).rejects.toThrow('simulated replacement failure');

    await expect(fs.readFile(target, 'utf-8')).resolves.toBe('{"version":1}');
    const leftovers = (await fs.readdir(TEST_ROOT)).filter((name) => name.includes('.tmp-'));
    expect(leftovers).toHaveLength(0);
  });
});
