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
    const result = await mapConcepts(chunks, mockLLM as any, TEST_LOG);
    expect(result.concepts).toHaveLength(3);
    expect(result.learningOrder).toContain('node_3');
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
    ];
    await expect(mapConcepts(chunks, cyclicLLM as any, TEST_LOG)).rejects.toThrow(/[Cc]ycle/);
  });
});
