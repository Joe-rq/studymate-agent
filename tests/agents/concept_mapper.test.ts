import { describe, it, expect, beforeEach } from 'vitest';
import { mapConcepts } from '../../src/agents/concept_mapper.js';
import fs from 'fs/promises';
import path from 'path';

const TEST_DIR = path.join(process.cwd(), 'workspace_test_concept');
const TEST_LOG = path.join(TEST_DIR, 'event_log', 'events.jsonl');

const mockLLM = {
  complete: async () => '',
  completeJSON: async () => ({
    concepts: [
      { id: 'node_1', name: 'Supply', definition: 'Amount of goods', prerequisiteIds: [] },
      { id: 'node_2', name: 'Demand', definition: 'Desire for goods', prerequisiteIds: [] },
      { id: 'node_3', name: 'Equilibrium', definition: 'Balance point', prerequisiteIds: ['node_1', 'node_2'] },
    ],
  }),
};

describe('concept_mapper', () => {
  beforeEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it('should map concepts and produce learning order', async () => {
    const chunks = [
      { id: 'chunk_1', materialId: 'mat_1', title: 'Supply', content: 'Supply is...', chapterPath: '1', concepts: [], sourceLink: '' },
      { id: 'chunk_2', materialId: 'mat_1', title: 'Demand', content: 'Demand is...', chapterPath: '2', concepts: [], sourceLink: '' },
    ];
    const result = await mapConcepts(chunks, mockLLM as any, TEST_LOG, { workspaceRoot: TEST_DIR });
    expect(result.concepts).toHaveLength(3);
    expect(result.learningOrder.length).toBeGreaterThan(0);
  });

  it('should detect cyclic prerequisites and throw', async () => {
    const cyclicLLM = {
      complete: async () => '',
      completeJSON: async () => ({
        concepts: [
          { id: 'node_a', name: 'A', definition: '...', prerequisiteIds: ['node_b'] },
          { id: 'node_b', name: 'B', definition: '...', prerequisiteIds: ['node_a'] },
        ],
      }),
    };
    const chunks = [
      { id: 'c1', materialId: 'm1', title: 'A', content: 'A content', chapterPath: '1', concepts: [], sourceLink: '' },
      { id: 'c2', materialId: 'm1', title: 'B', content: 'B content', chapterPath: '2', concepts: [], sourceLink: '' },
    ];
    await expect(mapConcepts(chunks, cyclicLLM as any, TEST_LOG, { workspaceRoot: TEST_DIR })).rejects.toThrow(/[Cc]ycle/);
  });

  it('should deduplicate concepts across batches by name', async () => {
    // LLM returns same concept name in each batch
    let callCount = 0;
    const batchLLM = {
      complete: async () => '',
      completeJSON: async () => {
        callCount++;
        return {
          concepts: [
            { id: `n_${callCount}`, name: 'Tax Law', definition: `Def from batch ${callCount}`, prerequisiteIds: [] },
            { id: `m_${callCount}`, name: `Unique ${callCount}`, definition: 'Unique concept', prerequisiteIds: [] },
          ],
        };
      },
    };

    // 4 chunks with batchSize 2 = 2 batches
    const chunks = [
      { id: 'c1', materialId: 'm1', title: 'Tax Law', content: 'Tax Law content', chapterPath: '1', concepts: [], sourceLink: '' },
      { id: 'c2', materialId: 'm1', title: 'Unique 1', content: 'Unique 1 content', chapterPath: '2', concepts: [], sourceLink: '' },
      { id: 'c3', materialId: 'm1', title: 'Tax Law again', content: 'Tax Law more', chapterPath: '3', concepts: [], sourceLink: '' },
      { id: 'c4', materialId: 'm1', title: 'Unique 2', content: 'Unique 2 content', chapterPath: '4', concepts: [], sourceLink: '' },
    ];

    const result = await mapConcepts(chunks, batchLLM as any, TEST_LOG, {
      batchSize: 2,
      workspaceRoot: TEST_DIR,
    });

    // "Tax Law" should be deduplicated to 1 concept
    const taxLawConcepts = result.concepts.filter((c) => c.name === 'Tax Law');
    expect(taxLawConcepts).toHaveLength(1);
    // Total: 1 Tax Law + 2 Unique = 3
    expect(result.concepts).toHaveLength(3);
  });

  it('should mark concepts without evidence as unverified', async () => {
    const llmWithGhost = {
      complete: async () => '',
      completeJSON: async () => ({
        concepts: [
          { id: 'n1', name: 'RealConcept', definition: 'Has evidence', prerequisiteIds: [] },
          { id: 'n2', name: 'GhostConcept', definition: 'No evidence in chunks', prerequisiteIds: [] },
        ],
      }),
    };

    const chunks = [
      { id: 'c1', materialId: 'm1', title: 'RealConcept', content: 'RealConcept is here', chapterPath: '1', concepts: [], sourceLink: '' },
    ];

    const result = await mapConcepts(chunks, llmWithGhost as any, TEST_LOG, { workspaceRoot: TEST_DIR });

    const real = result.concepts.find((c) => c.name === 'RealConcept');
    const ghost = result.concepts.find((c) => c.name === 'GhostConcept');

    expect(real?.unverified).toBe(false);
    expect(ghost?.unverified).toBe(true);
    // Ghost should NOT be in learning order
    expect(result.learningOrder).not.toContain(ghost?.id);
    // Real should be in learning order
    expect(result.learningOrder).toContain(real?.id);
  });
});
