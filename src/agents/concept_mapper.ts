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
}

export interface ConceptMap {
  concepts: Concept[];
  learningOrder: string[];
}

export async function mapConcepts(
  chunks: Chunk[],
  llm: LLMClient,
  eventLogFile: string
): Promise<ConceptMap> {
  const promptPath = path.join(PROMPTS_SOURCE, 'concept_mapper.txt');
  let system: string;
  try {
    system = await fs.readFile(promptPath, 'utf-8');
  } catch {
    system = `You are an educational content analyzer. Given study chunks, extract core concepts and prerequisite relationships. Respond with JSON only. Format: { "concepts": [{ "id": "node_1", "name": "...", "definition": "...", "prerequisiteIds": [] }] }`;
  }

  const user = chunks.map((c) => `## ${c.title}\n${c.content.slice(0, 800)}`).join('\n\n');

  const raw = await llm.completeJSON<{
    concepts: Array<{ id: string; name: string; definition: string; prerequisiteIds: string[] }>;
  }>(system, user, { temperature: 0.3, retries: 3 });

  if (!Array.isArray(raw.concepts) || raw.concepts.length === 0) {
    throw new Error('Concept mapper returned no concepts');
  }

  const conceptIds = new Set(raw.concepts.map((c) => c.id));
  for (const c of raw.concepts) {
    if (!c.id || typeof c.id !== 'string') throw new Error(`Invalid concept id: ${JSON.stringify(c.id)}`);
    if (!c.name || typeof c.name !== 'string') throw new Error(`Concept ${c.id} missing name`);
    if (typeof c.definition !== 'string') throw new Error(`Concept ${c.id} missing definition`);
    if (!Array.isArray(c.prerequisiteIds)) throw new Error(`Concept ${c.id} prerequisiteIds must be array`);
    for (const pre of c.prerequisiteIds) {
      if (!conceptIds.has(pre)) {
        throw new Error(`Concept ${c.id} references unknown prerequisite ${pre}`);
      }
    }
  }

  const concepts: Concept[] = raw.concepts.map((c) => ({
    ...c,
    relatedChunks: chunks
      .filter((ch) => ch.title.includes(c.name) || ch.content.includes(c.name))
      .map((ch) => ch.id),
    mastery: 0,
  }));

  // Three-color DFS topological sort with cycle detection.
  // white = unvisited, gray = in current DFS path, black = finished.
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const c of concepts) color.set(c.id, WHITE);
  const order: string[] = [];

  const visit = (id: string, path: string[]): void => {
    const c = color.get(id);
    if (c === BLACK) return;
    if (c === GRAY) {
      const cycleStart = path.indexOf(id);
      const cyclePath = [...path.slice(cycleStart), id].join(' -> ');
      throw new Error(`Cycle detected in concept prerequisites: ${cyclePath}`);
    }
    color.set(id, GRAY);
    const concept = concepts.find((co) => co.id === id);
    if (!concept) return;
    for (const pre of concept.prerequisiteIds) {
      visit(pre, [...path, id]);
    }
    color.set(id, BLACK);
    order.push(id);
  };
  for (const c of concepts) visit(c.id, []);

  const conceptMap: ConceptMap = { concepts, learningOrder: order };

  await fs.mkdir(Paths.graph, { recursive: true });
  await fs.writeFile(
    path.join(Paths.graph, 'concepts.json'),
    JSON.stringify(conceptMap, null, 2),
    'utf-8'
  );

  const event: Event = {
    id: createEventId(),
    timestamp: new Date().toISOString(),
    agent: 'concept_mapper',
    action: 'concepts_mapped',
    input: { chunkCount: chunks.length },
    output: { conceptCount: concepts.length, learningOrder: order },
  };
  await appendEvent(eventLogFile, event);

  return conceptMap;
}
