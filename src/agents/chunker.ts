import fs from 'fs/promises';
import path from 'path';
import type { Material } from './material_collector.js';
import type { Event } from '../core/types.js';
import { createEventId, appendEvent } from '../core/event_log.js';
import { Paths } from '../core/paths.js';

export interface Chunk {
  id: string;
  materialId: string;
  title: string;
  content: string;
  chapterPath: string;
  concepts: string[];
  sourceLink: string;
}

export async function chunkMaterial(
  material: Pick<Material, 'id' | 'contentPath' | 'title'>,
  eventLogFile: string
): Promise<Chunk[]> {
  const content = await fs.readFile(material.contentPath, 'utf-8');
  const lines = content.split('\n');
  const chunks: Chunk[] = [];
  let currentChunk: { title: string; lines: string[]; level: number } | null = null;

  const flushChunk = () => {
    if (!currentChunk || currentChunk.lines.length === 0) return;
    chunks.push({
      id: `chunk_${String(chunks.length + 1).padStart(3, '0')}`,
      materialId: material.id,
      title: currentChunk.title,
      content: currentChunk.lines.join('\n').trim(),
      chapterPath: `${chunks.length}`,
      concepts: [],
      sourceLink: material.contentPath,
    });
  };

  for (const line of lines) {
    const headerMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headerMatch) {
      flushChunk();
      currentChunk = { title: headerMatch[2], lines: [line], level: headerMatch[1].length };
    } else if (currentChunk) {
      currentChunk.lines.push(line);
    }
  }
  flushChunk();

  await fs.mkdir(Paths.chunks, { recursive: true });
  for (const chunk of chunks) {
    const chunkPath = path.join(Paths.chunks, `${chunk.id}.md`);
    await fs.writeFile(chunkPath, `# ${chunk.title}\n\n${chunk.content}`, 'utf-8');
  }

  const event: Event = {
    id: createEventId(),
    timestamp: new Date().toISOString(),
    agent: 'chunker',
    action: 'chunks_generated',
    input: { materialId: material.id },
    output: { chunkCount: chunks.length, chunkIds: chunks.map((c) => c.id) },
  };
  await appendEvent(eventLogFile, event);

  return chunks;
}
