import fs from 'fs/promises';
import path from 'path';
import type { Chunk } from './chunker.js';
import type { LLMClient } from '../core/llm.js';
import type { Event } from '../core/types.js';
import { createEventId, appendEvent } from '../core/event_log.js';
import { Paths, PROMPTS_SOURCE } from '../core/paths.js';

export interface Concept {
  id: string;
  name: string;
  definition: string;
  prerequisiteIds: string[];
  relatedChunks: string[];
  mastery: number;
  /** True if no evidence chunks could be linked to this concept. */
  unverified?: boolean;
}

export interface ConceptMap {
  concepts: Concept[];
  learningOrder: string[];
}

export interface ConceptMapperOptions {
  /** Number of chunks per LLM batch call. Default: 8. */
  batchSize?: number;
  /** Workspace root for test isolation. */
  workspaceRoot?: string;
}

const DEFAULT_BATCH_SIZE = 8;

/** Normalize a concept name for deduplication comparison. */
function normalizeName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

interface RawConcept {
  id: string;
  name: string;
  definition: string;
  prerequisiteIds: string[];
}

/**
 * Extract concepts from a batch of chunks via LLM.
 */
async function extractBatch(
  chunks: Chunk[],
  llm: LLMClient,
  system: string
): Promise<RawConcept[]> {
  const user = chunks.map((c) => `## ${c.title}\n${c.content.slice(0, 800)}`).join('\n\n');

  const raw = await llm.completeJSON<{ concepts: RawConcept[] }>(system, user, {
    temperature: 0.3,
    retries: 3,
  });

  if (!Array.isArray(raw.concepts)) return [];
  return raw.concepts.filter(
    (c) => c.id && typeof c.name === 'string' && typeof c.definition === 'string'
  );
}

/**
 * Merge concepts from multiple batches: deduplicate by normalized name,
 * merge relatedChunks, and reconcile prerequisite references.
 */
function mergeConcepts(
  batchResults: RawConcept[][],
  chunks: Chunk[]
): Concept[] {
  const nameMap = new Map<string, Concept>();
  // Map from batch-local id to canonical id
  const idRemap = new Map<string, string>();
  let nextId = 1;

  for (const batch of batchResults) {
    for (const raw of batch) {
      const normName = normalizeName(raw.name);
      const existing = nameMap.get(normName);

      if (existing) {
        // Merge: keep existing, remap id
        idRemap.set(raw.id, existing.id);
      } else {
        const canonicalId = `node_${nextId++}`;
        idRemap.set(raw.id, canonicalId);
        const concept: Concept = {
          id: canonicalId,
          name: raw.name,
          definition: raw.definition,
          prerequisiteIds: [],
          relatedChunks: [],
          mastery: 0,
        };
        nameMap.set(normName, concept);
      }
    }
  }

  // Second pass: resolve prerequisites and link evidence chunks
  for (const batch of batchResults) {
    for (const raw of batch) {
      const canonicalId = idRemap.get(raw.id)!;
      const concept = [...nameMap.values()].find((c) => c.id === canonicalId)!;

      // Resolve prerequisites
      for (const preId of raw.prerequisiteIds ?? []) {
        const resolvedPre = idRemap.get(preId);
        if (resolvedPre && resolvedPre !== canonicalId && !concept.prerequisiteIds.includes(resolvedPre)) {
          concept.prerequisiteIds.push(resolvedPre);
        }
      }
    }
  }

  // Link evidence chunks: match concept name in chunk title or content
  const concepts = [...nameMap.values()];
  for (const concept of concepts) {
    concept.relatedChunks = chunks
      .filter((ch) => ch.title.includes(concept.name) || ch.content.includes(concept.name))
      .map((ch) => ch.id);
    concept.unverified = concept.relatedChunks.length === 0;
  }

  return concepts;
}

export async function mapConcepts(
  chunks: Chunk[],
  llm: LLMClient,
  eventLogFile: string,
  options?: ConceptMapperOptions
): Promise<ConceptMap> {
  const batchSize = options?.batchSize ?? DEFAULT_BATCH_SIZE;
  const graphDir = options?.workspaceRoot
    ? path.join(options.workspaceRoot, 'graph')
    : Paths.graph;

  const promptPath = path.join(PROMPTS_SOURCE, 'concept_mapper.txt');
  let system: string;
  try {
    system = await fs.readFile(promptPath, 'utf-8');
  } catch {
    system = `You are an educational content analyzer. Given study chunks, extract core concepts and prerequisite relationships. Respond with JSON only. Format: { "concepts": [{ "id": "node_1", "name": "...", "definition": "...", "prerequisiteIds": [] }] }`;
  }

  // Split chunks into batches
  const batches: Chunk[][] = [];
  for (let i = 0; i < chunks.length; i += batchSize) {
    batches.push(chunks.slice(i, i + batchSize));
  }

  // Extract concepts from each batch
  const batchResults: RawConcept[][] = [];
  for (const batch of batches) {
    const result = await extractBatch(batch, llm, system);
    batchResults.push(result);
  }

  // Merge and deduplicate
  const concepts = mergeConcepts(batchResults, chunks);

  if (concepts.length === 0) {
    throw new Error('Concept mapper returned no concepts');
  }

  // Validate: check prerequisite references exist
  const conceptIds = new Set(concepts.map((c) => c.id));
  for (const c of concepts) {
    c.prerequisiteIds = c.prerequisiteIds.filter((pre) => conceptIds.has(pre));
  }

  // Three-color DFS topological sort with cycle detection.
  // Only verified concepts (with evidence) enter the learning order.
  const verifiedConcepts = concepts.filter((c) => !c.unverified);
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const c of verifiedConcepts) color.set(c.id, WHITE);
  const order: string[] = [];

  const visit = (id: string, dfsPath: string[]): void => {
    const c = color.get(id);
    if (c === BLACK) return;
    if (c === GRAY) {
      const cycleStart = dfsPath.indexOf(id);
      const cyclePath = [...dfsPath.slice(cycleStart), id].join(' -> ');
      throw new Error(`Cycle detected in concept prerequisites: ${cyclePath}`);
    }
    color.set(id, GRAY);
    const concept = verifiedConcepts.find((co) => co.id === id);
    if (!concept) return;
    for (const pre of concept.prerequisiteIds) {
      if (color.has(pre)) {
        visit(pre, [...dfsPath, id]);
      }
    }
    color.set(id, BLACK);
    order.push(id);
  };
  for (const c of verifiedConcepts) visit(c.id, []);

  const conceptMap: ConceptMap = { concepts, learningOrder: order };

  await fs.mkdir(graphDir, { recursive: true });
  await fs.writeFile(
    path.join(graphDir, 'concepts.json'),
    JSON.stringify(conceptMap, null, 2),
    'utf-8'
  );

  const event: Event = {
    id: createEventId(),
    timestamp: new Date().toISOString(),
    agent: 'concept_mapper',
    action: 'concepts_mapped',
    input: { chunkCount: chunks.length, batchCount: batches.length },
    output: {
      conceptCount: concepts.length,
      unverifiedCount: concepts.filter((c) => c.unverified).length,
      learningOrderCount: order.length,
    },
  };
  await appendEvent(eventLogFile, event);

  return conceptMap;
}
