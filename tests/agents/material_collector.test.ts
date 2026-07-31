import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { importMarkdown, loadMaterialIndex } from '../../src/agents/material_collector.js';

const TEST_ROOT = path.join(process.cwd(), 'workspace_test_material_collector');
const EVENT_LOG = path.join(TEST_ROOT, 'event_log', 'events.jsonl');

describe('material_collector', () => {
  beforeEach(async () => {
    await fs.rm(TEST_ROOT, { recursive: true, force: true });
    await fs.mkdir(path.join(TEST_ROOT, 'inputs', 'a'), { recursive: true });
    await fs.mkdir(path.join(TEST_ROOT, 'inputs', 'b'), { recursive: true });
    await fs.mkdir(path.dirname(EVENT_LOG), { recursive: true });
  });

  it('keeps same-day files with the same basename but different content separate', async () => {
    const firstPath = path.join(TEST_ROOT, 'inputs', 'a', 'notes.md');
    const secondPath = path.join(TEST_ROOT, 'inputs', 'b', 'notes.md');
    await fs.writeFile(firstPath, '# 第一份\n\n供给内容', 'utf-8');
    await fs.writeFile(secondPath, '# 第二份\n\n需求内容', 'utf-8');

    const first = await importMarkdown(firstPath, EVENT_LOG, TEST_ROOT);
    const second = await importMarkdown(secondPath, EVENT_LOG, TEST_ROOT);

    expect(first.id).not.toBe(second.id);
    expect(first.contentPath).not.toBe(second.contentPath);
    await expect(fs.readFile(first.contentPath, 'utf-8')).resolves.toContain('供给内容');
    await expect(fs.readFile(second.contentPath, 'utf-8')).resolves.toContain('需求内容');

    const index = await loadMaterialIndex(path.join(TEST_ROOT, 'materials'));
    expect(index).toHaveLength(2);
  });
});
