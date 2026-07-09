import { describe, it, expect, beforeEach } from 'vitest';
import { initWorkspace } from '../../src/core/workspace.js';
import fs from 'fs/promises';
import path from 'path';

const TEST_WORKSPACE = path.join(process.cwd(), 'workspace_test_workspace');

describe('workspace', () => {
  beforeEach(async () => {
    await fs.rm(TEST_WORKSPACE, { recursive: true, force: true });
  });

  it('should create all workspace directories', async () => {
    await initWorkspace(TEST_WORKSPACE);
    for (const relative of ['materials', 'chunks', 'graph', 'plan', 'tasks', 'quizzes', 'results', 'mistakes', 'progress', 'prompts']) {
      const p = path.join(TEST_WORKSPACE, relative);
      const stat = await fs.stat(p);
      expect(stat.isDirectory()).toBe(true);
    }
  });
});
