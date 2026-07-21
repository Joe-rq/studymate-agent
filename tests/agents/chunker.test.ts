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
      TEST_LOG,
      TEST_DIR
    );
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].title).toBeDefined();
  });

  it('should not overwrite chunks from different materials', async () => {
    const mat1Path = path.join(TEST_DIR, 'mat1.md');
    const mat2Path = path.join(TEST_DIR, 'mat2.md');
    await fs.writeFile(mat1Path, '# Topic A\n\nContent A', 'utf-8');
    await fs.writeFile(mat2Path, '# Topic B\n\nContent B', 'utf-8');

    const chunks1 = await chunkMaterial(
      { id: 'mat_abc12345', contentPath: mat1Path, title: 'Material 1' },
      TEST_LOG,
      TEST_DIR
    );
    const chunks2 = await chunkMaterial(
      { id: 'mat_def67890', contentPath: mat2Path, title: 'Material 2' },
      TEST_LOG,
      TEST_DIR
    );

    // Chunks from both materials should coexist
    const files = await fs.readdir(path.join(TEST_DIR, 'chunks'));
    const mdFiles = files.filter((f) => f.endsWith('.md'));
    expect(mdFiles.length).toBeGreaterThanOrEqual(2);

    // IDs should be prefixed with material ID
    expect(chunks1[0].id).toContain('mat_abc12345');
    expect(chunks2[0].id).toContain('mat_def67890');
  });

  it('should capture preamble content before first header', async () => {
    const materialPath = path.join(TEST_DIR, 'preamble.md');
    await fs.writeFile(
      materialPath,
      'This is preamble text.\nIt has no header.\n\n# First Section\n\nContent here.',
      'utf-8'
    );

    const chunks = await chunkMaterial(
      { id: 'mat_pre', contentPath: materialPath, title: 'PreambleTest' },
      TEST_LOG,
      TEST_DIR
    );

    // Should have preamble chunk + header chunk
    expect(chunks.length).toBe(2);
    expect(chunks[0].title).toContain('preamble');
    expect(chunks[0].content).toContain('preamble text');
  });

  it('should skip empty (header-only) chunks', async () => {
    const materialPath = path.join(TEST_DIR, 'empty.md');
    await fs.writeFile(
      materialPath,
      '# Real Section\n\nSome content.\n\n# Empty Section\n\n# Another Real\n\nMore content.',
      'utf-8'
    );

    const chunks = await chunkMaterial(
      { id: 'mat_empty', contentPath: materialPath, title: 'EmptyTest' },
      TEST_LOG,
      TEST_DIR
    );

    // Empty section should be skipped
    expect(chunks.length).toBe(2);
    expect(chunks.map((c) => c.title)).not.toContain('Empty Section');
  });

  it('should handle content with no headers at all', async () => {
    const materialPath = path.join(TEST_DIR, 'noheaders.md');
    await fs.writeFile(materialPath, 'Just plain text.\nNo headers here.', 'utf-8');

    const chunks = await chunkMaterial(
      { id: 'mat_nh', contentPath: materialPath, title: 'NoHeaders' },
      TEST_LOG,
      TEST_DIR
    );

    expect(chunks.length).toBe(1);
    expect(chunks[0].title).toBe('NoHeaders');
    expect(chunks[0].content).toContain('plain text');
  });

  it('should deduplicate duplicate chunk titles', async () => {
    const materialPath = path.join(TEST_DIR, 'dupes.md');
    await fs.writeFile(
      materialPath,
      '# Summary\n\nFirst summary.\n\n# Details\n\nSome details.\n\n# Summary\n\nSecond summary.',
      'utf-8'
    );

    const chunks = await chunkMaterial(
      { id: 'mat_dup', contentPath: materialPath, title: 'DupeTest' },
      TEST_LOG,
      TEST_DIR
    );

    expect(chunks.length).toBe(3);
    // Second "Summary" should be deduplicated
    const titles = chunks.map((c) => c.title);
    expect(titles).toContain('Summary');
    expect(titles).toContain('Summary (2)');
  });

  it('should split oversized chunks at paragraph boundaries', async () => {
    // Create a section with content exceeding 2000 chars
    const longContent = Array.from({ length: 30 }, (_, i) => `Paragraph ${i + 1} with enough text to fill space. `.repeat(3)).join('\n\n');
    const materialPath = path.join(TEST_DIR, 'oversized.md');
    await fs.writeFile(
      materialPath,
      `# Big Section\n\n${longContent}`,
      'utf-8'
    );

    const chunks = await chunkMaterial(
      { id: 'mat_big', contentPath: materialPath, title: 'OversizedTest' },
      TEST_LOG,
      TEST_DIR,
      { maxChunkChars: 500 }
    );

    // Should be split into multiple parts
    expect(chunks.length).toBeGreaterThan(1);
    // Each chunk should be roughly under the limit (some overhead from headers)
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThan(700); // allow some margin
    }
    // Titles should have part suffixes
    expect(chunks[0].title).toContain('part');
  });

  it('should merge tiny fragments into neighbors', async () => {
    const materialPath = path.join(TEST_DIR, 'tiny.md');
    await fs.writeFile(
      materialPath,
      '# Big Section\n\nThis is a substantial section with plenty of content that exceeds the minimum threshold easily.\n\n# Tiny\n\nHi.\n\n# Another Big\n\nAnother substantial section with enough content to be above the minimum character threshold for sure.',
      'utf-8'
    );

    const chunks = await chunkMaterial(
      { id: 'mat_tiny', contentPath: materialPath, title: 'TinyTest' },
      TEST_LOG,
      TEST_DIR,
      { minChunkChars: 50 }
    );

    // The tiny "Hi." section should be merged into a neighbor
    const titles = chunks.map((c) => c.title);
    expect(titles).not.toContain('Tiny');
    expect(chunks.length).toBe(2); // Big + Another Big (Tiny merged)
  });

  it('should produce hierarchical chapter paths', async () => {
    const materialPath = path.join(TEST_DIR, 'hierarchy.md');
    await fs.writeFile(
      materialPath,
      '# Chapter 1\n\nIntro to ch1.\n\n## Section 1.1\n\nDetails of 1.1.\n\n## Section 1.2\n\nDetails of 1.2.\n\n# Chapter 2\n\nIntro to ch2.\n\n## Section 2.1\n\nDetails of 2.1.',
      'utf-8'
    );

    const chunks = await chunkMaterial(
      { id: 'mat_hier', contentPath: materialPath, title: 'HierTest' },
      TEST_LOG,
      TEST_DIR
    );

    expect(chunks.length).toBe(5);
    // Chapter 1 -> path "1"
    expect(chunks[0].chapterPath).toBe('1');
    // Section 1.1 -> path "1 > 1"
    expect(chunks[1].chapterPath).toBe('1 > 1');
    // Section 1.2 -> path "1 > 2"
    expect(chunks[2].chapterPath).toBe('1 > 2');
    // Chapter 2 -> path "2"
    expect(chunks[3].chapterPath).toBe('2');
    // Section 2.1 -> path "2 > 1"
    expect(chunks[4].chapterPath).toBe('2 > 1');
  });
});
