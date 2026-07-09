import { describe, it, expect, beforeEach } from 'vitest';
import { chunkMaterial } from '../../src/agents/chunker.js';
import fs from 'fs/promises';
import path from 'path';

const TEST_DIR = path.join(process.cwd(), 'workspace_test_chunker');
const TEST_LOG = path.join(TEST_DIR, 'event_log', 'events.jsonl');

describe('chunker', () => {
  beforeEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(TEST_DIR, { recursive: true });
  });

  it('should split markdown by headers', async () => {
    const materialPath = path.join(TEST_DIR, 'test.md');
    await fs.writeFile(
      materialPath,
      '# Title\n\nIntro\n\n## Section 1\n\nContent 1\n\n## Section 2\n\nContent 2',
      'utf-8'
    );

    const chunks = await chunkMaterial(
      { id: 'mat_1', contentPath: materialPath, title: 'Test' },
      TEST_LOG
    );
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].title).toBeDefined();
  });
});
