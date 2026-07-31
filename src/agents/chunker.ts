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

export interface ChunkOptions {
  /** Maximum characters per chunk. Default: 2000. */
  maxChunkChars?: number;
  /** Minimum characters per chunk; smaller fragments are merged. Default: 100. */
  minChunkChars?: number;
}

const DEFAULT_MAX_CHUNK_CHARS = 2000;
const DEFAULT_MIN_CHUNK_CHARS = 0; // disabled by default; set explicitly to enable merging

/** Compute a stable chunk ID from material ID + index. */
function chunkId(materialId: string, index: number): string {
  return `chk_${materialId}_${String(index + 1).padStart(3, '0')}`;
}

interface RawSection {
  title: string;
  lines: string[];
  /** Header level (1-3) for hierarchy tracking. 0 = preamble/no header. */
  level: number;
}

/**
 * Split a large section into sub-chunks at paragraph boundaries.
 * Each part stays under maxChars.
 */
function splitOversized(title: string, lines: string[], maxChars: number): { title: string; lines: string[] }[] {
  const fullText = lines.join('\n');
  if (fullText.length <= maxChars) {
    return [{ title, lines }];
  }

  const parts: { title: string; lines: string[] }[] = [];
  let current: string[] = [];
  let currentLen = 0;
  let partNum = 1;

  // Split by paragraphs (double newline or single newline if very long)
  const paragraphs = fullText.split(/\n\n+/);
  for (const para of paragraphs) {
    const paraLen = para.length + 2; // account for newlines
    if (currentLen + paraLen > maxChars && current.length > 0) {
      parts.push({ title: `${title} (part ${partNum})`, lines: current });
      partNum++;
      current = [];
      currentLen = 0;
    }
    current.push(para);
    currentLen += paraLen;
  }
  if (current.length > 0) {
    parts.push({ title: parts.length > 0 ? `${title} (part ${partNum})` : title, lines: current });
  }

  return parts;
}

/**
 * Merge tiny fragments into their neighbor.
 * A fragment below minChars is appended to the previous chunk (or next if first).
 */
function mergeTinyFragments(
  sections: { title: string; lines: string[] }[],
  minChars: number
): { title: string; lines: string[] }[] {
  if (sections.length <= 1) return sections;

  const result: { title: string; lines: string[] }[] = [];
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const textLen = section.lines.join('\n').trim().length;

    if (textLen < minChars) {
      if (result.length > 0) {
        // Merge into previous
        const prev = result[result.length - 1];
        prev.lines.push('', ...section.lines);
      } else if (i + 1 < sections.length) {
        // Merge into next
        sections[i + 1].lines = [...section.lines, '', ...sections[i + 1].lines];
      } else {
        // Last item and tiny, merge into previous if possible
        if (result.length > 0) {
          result[result.length - 1].lines.push('', ...section.lines);
        } else {
          result.push(section);
        }
      }
    } else {
      result.push(section);
    }
  }
  return result;
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
  workspaceRoot?: string,
  options?: ChunkOptions
): Promise<Chunk[]> {
  const maxChars = options?.maxChunkChars ?? DEFAULT_MAX_CHUNK_CHARS;
  const minChars = options?.minChunkChars ?? DEFAULT_MIN_CHUNK_CHARS;
  const chunksDir = workspaceRoot ? path.join(workspaceRoot, 'chunks') : Paths.chunks;
  const content = await fs.readFile(material.contentPath, 'utf-8');
  const lines = content.split('\n');
  const rawSections: RawSection[] = [];
  let currentSection: RawSection | null = null;
  let preambleLines: string[] = [];

  // Track header hierarchy for chapter paths
  const headerStack: { level: number; index: number; title: string }[] = [];
  const headerCounters: number[] = [0, 0, 0]; // counters for h1, h2, h3

  const flushSection = () => {
    if (!currentSection) return;
    // Skip empty sections: only header line, no real body content
    const body = currentSection.lines.slice(1).join('\n').trim();
    if (body.length === 0) return;
    rawSections.push(currentSection);
  };

  for (const line of lines) {
    const headerMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headerMatch) {
      // If no section has been started yet, capture preamble
      if (rawSections.length === 0 && !currentSection) {
        const preambleContent = preambleLines.join('\n').trim();
        if (preambleContent.length > 0) {
          rawSections.push({
            title: `${material.title} — preamble`,
            lines: preambleLines,
            level: 0,
          });
        }
      }
      flushSection();

      const level = headerMatch[1].length; // 1, 2, or 3
      const title = headerMatch[2];

      // Update header counters for hierarchical path
      headerCounters[level - 1]++;
      // Reset deeper counters
      for (let d = level; d < 3; d++) headerCounters[d] = 0;
      // Update stack
      while (headerStack.length > 0 && headerStack[headerStack.length - 1].level >= level) {
        headerStack.pop();
      }
      headerStack.push({ level, index: headerCounters[level - 1], title });

      currentSection = { title, lines: [line], level };
    } else if (currentSection) {
      currentSection.lines.push(line);
    } else {
      preambleLines.push(line);
    }
  }
  flushSection();

  // If no headers were found at all, treat entire content as one chunk
  if (rawSections.length === 0 && preambleLines.length > 0) {
    const body = preambleLines.join('\n').trim();
    if (body.length > 0) {
      rawSections.push({ title: material.title, lines: preambleLines, level: 0 });
    }
  }

  // Post-process: split oversized sections
  let processedSections: { title: string; lines: string[]; chapterPath?: string }[] = [];
  // Rebuild chapter paths by re-tracking hierarchy
  const pathStack: string[] = [];
  const pathCounters: number[] = [0, 0, 0];

  for (const section of rawSections) {
    if (section.level > 0) {
      pathCounters[section.level - 1]++;
      for (let d = section.level; d < 3; d++) pathCounters[d] = 0;
      while (pathStack.length >= section.level) pathStack.pop();
      pathStack.push(String(pathCounters[section.level - 1]));
    }
    const chapterPath = section.level > 0 ? pathStack.join(' > ') : '0';

    const parts = splitOversized(section.title, section.lines, maxChars);
    for (const part of parts) {
      processedSections.push({ ...part, chapterPath });
    }
  }

  // Post-process: merge tiny fragments
  processedSections = mergeTinyFragments(processedSections, minChars);

  // Deduplicate titles: if same title appears multiple times, append counter
  const titleCounts = new Map<string, number>();
  const chunks: Chunk[] = [];
  for (let i = 0; i < processedSections.length; i++) {
    const section = processedSections[i];
    const baseTitle = section.title;
    const count = titleCounts.get(baseTitle) ?? 0;
    titleCounts.set(baseTitle, count + 1);
    const dedupedTitle = count > 0 ? `${baseTitle} (${count + 1})` : baseTitle;

    chunks.push({
      id: chunkId(material.id, i),
      materialId: material.id,
      title: dedupedTitle,
      content: section.lines.join('\n').trim(),
      chapterPath: section.chapterPath ?? `${i + 1}`,
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
