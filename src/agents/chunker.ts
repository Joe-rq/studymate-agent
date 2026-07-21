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

/** Compute a stable chunk ID from material ID + index. */
function chunkId(materialId: string, index: number): string {
  return `chk_${materialId}_${String(index + 1).padStart(3, '0')}`;
}

/** Update the chunk index registry (chunks/index.json). */
async function updateChunkIndex(chunks: Chunk[], chunksDir: string): Promise<void> {
  const indexPath = path.join(chunksDir, 'index.json');
  let index: Chunk[] = [];
  try {
    index = JSON.parse(await fs.readFile(indexPath, 'utf-8'));
  } catch {
    // index doesn't exist yet
  }

  // Merge: replace chunks with same id, append new ones
  for (const chunk of chunks) {
    const existingIdx = index.findIndex((c) => c.id === chunk.id);
    if (existingIdx >= 0) {
      index[existingIdx] = chunk;
    } else {
      index.push(chunk);
    }
  }
  await fs.writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8');
}

export async function chunkMaterial(
  material: Pick<Material, 'id' | 'contentPath' | 'title'>,
  eventLogFile: string,
  workspaceRoot?: string
): Promise<Chunk[]> {
  const chunksDir = workspaceRoot ? path.join(workspaceRoot, 'chunks') : Paths.chunks;
  const content = await fs.readFile(material.contentPath, 'utf-8');
  const lines = content.split('\n');
  const rawChunks: { title: string; lines: string[] }[] = [];
  let currentChunk: { title: string; lines: string[] } | null = null;
  let preambleLines: string[] = [];

  const flushChunk = () => {
    if (!currentChunk) return;
    // Skip empty chunks: only header line, no real body content
    const body = currentChunk.lines.slice(1).join('\n').trim();
    if (body.length === 0) return;
    rawChunks.push({ title: currentChunk.title, lines: currentChunk.lines });
  };

  for (const line of lines) {
    const headerMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headerMatch) {
      // If no chunk has been started yet, capture preamble
      if (rawChunks.length === 0 && !currentChunk) {
        const preambleContent = preambleLines.join('\n').trim();
        if (preambleContent.length > 0) {
          rawChunks.push({
            title: `${material.title} — preamble`,
            lines: preambleLines,
          });
        }
      }
      flushChunk();
      currentChunk = { title: headerMatch[2], lines: [line] };
    } else if (currentChunk) {
      currentChunk.lines.push(line);
    } else {
      preambleLines.push(line);
    }
  }
  flushChunk();

  // If no headers were found at all, treat entire content as one chunk
  if (rawChunks.length === 0 && preambleLines.length > 0) {
    const body = preambleLines.join('\n').trim();
    if (body.length > 0) {
      rawChunks.push({ title: material.title, lines: preambleLines });
    }
  }

  // Deduplicate titles: if same title appears multiple times, append counter
  const titleCounts = new Map<string, number>();
  const chunks: Chunk[] = [];
  for (let i = 0; i < rawChunks.length; i++) {
    const raw = rawChunks[i];
    const baseTitle = raw.title;
    const count = titleCounts.get(baseTitle) ?? 0;
    titleCounts.set(baseTitle, count + 1);
    const dedupedTitle = count > 0 ? `${baseTitle} (${count + 1})` : baseTitle;

    chunks.push({
      id: chunkId(material.id, i),
      materialId: material.id,
      title: dedupedTitle,
      content: raw.lines.join('\n').trim(),
      chapterPath: `${i + 1}`,
      concepts: [],
      sourceLink: material.contentPath,
    });
  }

  await fs.mkdir(chunksDir, { recursive: true });

  // Remove old chunk files belonging to this material before writing new ones
  try {
    const existingFiles = await fs.readdir(chunksDir);
    for (const f of existingFiles) {
      if (f.startsWith(`chk_${material.id}_`) && f.endsWith('.md')) {
        await fs.unlink(path.join(chunksDir, f));
      }
    }
  } catch {
    // directory may not exist yet
  }

  for (const chunk of chunks) {
    const chunkPath = path.join(chunksDir, `${chunk.id}.md`);
    await fs.writeFile(chunkPath, `# ${chunk.title}\n\n${chunk.content}`, 'utf-8');
  }

  await updateChunkIndex(chunks, chunksDir);

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
