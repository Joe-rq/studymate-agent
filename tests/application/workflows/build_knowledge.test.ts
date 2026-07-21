import { describe, it, expect, beforeEach } from 'vitest';
import { buildKnowledge } from '../../../src/application/workflows/build_knowledge.js';
import { MockContentFetcher } from '../../../src/infrastructure/fetch/mock_fetcher.js';
import { createExamProject, transitionStatus } from '../../../src/domain/exam.js';
import type { SourceRecord } from '../../../src/domain/source.js';
import fs from 'fs/promises';
import path from 'path';

const TEST_DIR = path.join(process.cwd(), 'workspace_test_build_knowledge');
const TEST_LOG = path.join(TEST_DIR, 'event_log', 'events.jsonl');

const mockLLM = {
  complete: async () => '',
  completeJSON: async () => ({
    concepts: [
      { id: 'n1', name: 'Tax Law', definition: 'Rules about taxation', prerequisiteIds: [] },
      { id: 'n2', name: 'Accounting', definition: 'Recording transactions', prerequisiteIds: [] },
    ],
  }),
};

function makeApprovedSources(): SourceRecord[] {
  return [
    {
      id: 'src_001',
      url: 'https://example.com/tax-law',
      title: 'Tax Law Overview',
      sourceType: 'official',
      confidenceLevel: 'verified',
      capturedAt: new Date().toISOString(),
      summary: 'Official tax law content',
      confidenceReason: 'Government website',
      approved: true,
      approvedAt: new Date().toISOString(),
    },
    {
      id: 'src_002',
      url: 'https://example.com/accounting',
      title: 'Accounting Basics',
      sourceType: 'commercial',
      confidenceLevel: 'consensus',
      capturedAt: new Date().toISOString(),
      summary: 'Accounting fundamentals',
      confidenceReason: 'Multiple sources agree',
      approved: true,
      approvedAt: new Date().toISOString(),
    },
  ];
}

describe('build_knowledge workflow', () => {
  beforeEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(path.join(TEST_DIR, 'research'), { recursive: true });
  });

  it('should run full pipeline: fetch, import, chunk, extract concepts', async () => {
    // Setup: write approved sources
    const sources = makeApprovedSources();
    await fs.writeFile(
      path.join(TEST_DIR, 'research', 'approved_sources.json'),
      JSON.stringify(sources, null, 2),
      'utf-8'
    );

    // Setup: write exam project in sources_approved state
    let exam = createExamProject({
      name: 'Test Exam',
      examDate: '2026-12-01',
      subjects: ['Tax Law'],
      baseline: 'beginner',
      dailyMinutes: 60,
    });
    exam = transitionStatus(exam, 'researched');
    exam = transitionStatus(exam, 'sources_approved');
    await fs.writeFile(path.join(TEST_DIR, 'exam.json'), JSON.stringify(exam, null, 2), 'utf-8');

    const fetcher = new MockContentFetcher({
      'https://example.com/tax-law': {
        title: 'Tax Law Overview',
        body: '# Tax Law\n\nTax law governs taxation.\n\n## Income Tax\n\nIncome tax applies to earnings.\n\n## Sales Tax\n\nSales tax applies to purchases.',
      },
      'https://example.com/accounting': {
        title: 'Accounting Basics',
        body: '# Accounting\n\nAccounting records transactions.\n\n## Debits and Credits\n\nDouble-entry bookkeeping uses debits and credits.',
      },
    });

    const result = await buildKnowledge({
      fetcher,
      llm: mockLLM as any,
      eventLogFile: TEST_LOG,
      workspaceRoot: TEST_DIR,
    });

    expect(result.materialsImported).toBe(2);
    expect(result.chunksGenerated).toBeGreaterThan(0);
    expect(result.conceptsExtracted).toBeGreaterThan(0);
    expect(result.skippedDuplicates).toBe(0);
    expect(result.fetchErrors).toHaveLength(0);

    // Verify exam status updated to materials_ready
    const savedExam = JSON.parse(await fs.readFile(path.join(TEST_DIR, 'exam.json'), 'utf-8'));
    expect(savedExam.status).toBe('materials_ready');

    // Verify materials index was written
    const materials = JSON.parse(await fs.readFile(path.join(TEST_DIR, 'materials', 'index.json'), 'utf-8'));
    expect(materials).toHaveLength(2);
    expect(materials[0].sourceRecordId).toBeDefined();

    // Verify concepts were written
    const conceptMap = JSON.parse(await fs.readFile(path.join(TEST_DIR, 'graph', 'concepts.json'), 'utf-8'));
    expect(conceptMap.concepts.length).toBeGreaterThan(0);
  });

  it('should skip duplicate content on re-import', async () => {
    const sources = makeApprovedSources().slice(0, 1); // just one source
    await fs.writeFile(
      path.join(TEST_DIR, 'research', 'approved_sources.json'),
      JSON.stringify(sources, null, 2),
      'utf-8'
    );

    const fetcher = new MockContentFetcher({
      'https://example.com/tax-law': {
        title: 'Tax Law',
        body: '# Tax Law\n\nContent about tax.',
      },
    });

    // First run
    const result1 = await buildKnowledge({
      fetcher,
      llm: mockLLM as any,
      eventLogFile: TEST_LOG,
      workspaceRoot: TEST_DIR,
    });
    expect(result1.materialsImported).toBe(1);
    expect(result1.skippedDuplicates).toBe(0);

    // Second run with same content - should be skipped
    const result2 = await buildKnowledge({
      fetcher,
      llm: mockLLM as any,
      eventLogFile: TEST_LOG,
      workspaceRoot: TEST_DIR,
    });
    expect(result2.materialsImported).toBe(0);
    expect(result2.skippedDuplicates).toBe(1);
  });

  it('should handle fetch errors gracefully', async () => {
    const sources = makeApprovedSources();
    await fs.writeFile(
      path.join(TEST_DIR, 'research', 'approved_sources.json'),
      JSON.stringify(sources, null, 2),
      'utf-8'
    );

    // Only one URL is known to the fetcher
    const fetcher = new MockContentFetcher({
      'https://example.com/tax-law': {
        title: 'Tax Law',
        body: '# Tax Law\n\nContent.',
      },
    });

    const result = await buildKnowledge({
      fetcher,
      llm: mockLLM as any,
      eventLogFile: TEST_LOG,
      workspaceRoot: TEST_DIR,
    });

    expect(result.materialsImported).toBe(1);
    expect(result.fetchErrors).toHaveLength(1);
    expect(result.fetchErrors[0]).toContain('accounting');
  });

  it('should throw when no approved sources exist', async () => {
    await expect(
      buildKnowledge({
        fetcher: new MockContentFetcher({}),
        llm: mockLLM as any,
        eventLogFile: TEST_LOG,
        workspaceRoot: TEST_DIR,
      })
    ).rejects.toThrow(/approved sources/);
  });
});
