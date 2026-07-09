import fs from 'fs/promises';
import path from 'path';
import type { Chunk } from './chunker.js';
import type { LLMClient } from '../core/llm.js';
import type { Event } from '../core/types.js';
import { createEventId, appendEvent } from '../core/event_log.js';
import { Paths } from '../core/paths.js';

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
  const promptPath = path.join(Paths.prompts, 'concept_mapper.txt');
  let system: string;
  try {
    system = await fs.readFile(promptPath, 'utf-8');
  } catch {
    system = `You are an educational content analyzer. Given study chunks, extract core concepts and prerequisite relationships. Respond with JSON only. Format: { "concepts": [{ "id": "node_1", "name": "...", "definition": "...", "prerequisiteIds": [] }] }`;
  }

  const user = chunks.map((c) => `## ${c.title}\n${c.content.slice(0, 800)}`).join('\n\n');

  const raw = await llm.completeJSON<{
    concepts: Array<{ id: string; name: string; definition: string; prerequisiteIds: string[] }>;
  }>(system, user, { temperature: 0.3 });

  const concepts: Concept[] = raw.concepts.map((c) => ({
    ...c,
    relatedChunks: chunks
      .filter((ch) => ch.title.includes(c.name) || ch.content.includes(c.name))
      .map((ch) => ch.id),
    mastery: 0,
  }));

  const visited = new Set<string>();
  const order: string[] = [];
  const visit = (id: string) => {
    if (visited.has(id)) return;
    const concept = concepts.find((c) => c.id === id);
    if (!concept) return;
    for (const pre of concept.prerequisiteIds) visit(pre);
    visited.add(id);
    order.push(id);
  };
  for (const c of concepts) visit(c.id);

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
