import { describe, it, expect, beforeEach } from 'vitest';
import { initWorkspace } from '../../src/core/workspace.js';
import { Paths } from '../../src/core/paths.js';
import fs from 'fs/promises';

describe('workspace', () => {
  beforeEach(async () => {
    await fs.rm(Paths.workspace, { recursive: true, force: true });
  });

  it('should create all workspace directories', async () => {
    await initWorkspace();
    for (const p of Object.values(Paths)) {
      if (p.endsWith('.jsonl')) continue;
      const stat = await fs.stat(p);
      expect(stat.isDirectory()).toBe(true);
    }
  });
});
