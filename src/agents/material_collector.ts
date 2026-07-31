import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import pdfParse from 'pdf-parse';
import type { Event } from '../core/types.js';
import { createEventId, appendEvent } from '../core/event_log.js';
import { Paths } from '../core/paths.js';
import type { FetchedContent } from '../application/ports/content_fetcher.js';
import type { SourceRecord } from '../domain/source.js';

export interface Material {
  id: string;
  source: string;
  type: 'pdf' | 'webpage' | 'url';
  title: string;
  contentPath: string;
  meta: {
    capturedAt: string;
    wordCount: number;
    contentHash: string;
  };
  /** Links back to the SourceRecord that led to this material. */
  sourceRecordId?: string;
  /** Original URL if fetched from web. */
  sourceUrl?: string;
  /** Version number; increments on re-import of same content hash. */
  version: number;
  /** Hierarchical chapter path, e.g. "经济法基础 > 第一章". */
  chapterPath?: string;
}

/** Compute a stable SHA-256 hash (first 8 hex chars) from content. */
function contentHash(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex').slice(0, 8);
}

async function updateMaterialIndex(material: Material, materialsDir?: string): Promise<void> {
  const dir = materialsDir ?? Paths.materials;
  const indexPath = path.join(dir, 'index.json');
  let index: Material[] = [];
  try {
    index = JSON.parse(await fs.readFile(indexPath, 'utf-8'));
  } catch {
    // index doesn't exist yet
  }
  // Replace if same id exists, otherwise append
  const existingIdx = index.findIndex((m) => m.id === material.id);
  if (existingIdx >= 0) {
    index[existingIdx] = material;
  } else {
    index.push(material);
  }
  await fs.writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8');
}

/** Load the material index. Returns empty array if not found. */
export async function loadMaterialIndex(materialsDir?: string): Promise<Material[]> {
  const dir = materialsDir ?? Paths.materials;
  const indexPath = path.join(dir, 'index.json');
  try {
    return JSON.parse(await fs.readFile(indexPath, 'utf-8'));
  } catch {
    return [];
  }
}

async function writeMaterialEvent(
  eventLogFile: string,
  material: Material,
  input: Record<string, unknown>
): Promise<void> {
  const event: Event = {
    id: createEventId(),
    timestamp: new Date().toISOString(),
    agent: 'material_collector',
    action: 'material_imported',
    input,
    output: { materialId: material.id, contentPath: material.contentPath },
  };
  await appendEvent(eventLogFile, event);
}

export async function importPDF(
  pdfPath: string,
  eventLogFile: string,
  workspaceRoot?: string
): Promise<Material> {
  const materialsDir = workspaceRoot ? path.join(workspaceRoot, 'materials') : Paths.materials;
  const buffer = await fs.readFile(pdfPath);
  const parsed = await pdfParse(buffer);
  const title = path.basename(pdfPath, path.extname(pdfPath));
  const hash = contentHash(parsed.text);
  const safeTitle = `${new Date().toISOString().split('T')[0]}_${title}.md`;
  const contentPath = path.join(materialsDir, safeTitle);

  await fs.mkdir(materialsDir, { recursive: true });
  await fs.writeFile(contentPath, `# ${title}\n\n${parsed.text}`, 'utf-8');

  const material: Material = {
    id: `mat_${hash}`,
    source: pdfPath,
    type: 'pdf',
    title,
    contentPath,
    meta: {
      capturedAt: new Date().toISOString(),
      wordCount: parsed.text.split(/\s+/).length,
      contentHash: hash,
    },
    version: 1,
  };

  await updateMaterialIndex(material, materialsDir);
  await writeMaterialEvent(eventLogFile, material, { pdfPath });
  return material;
}

export async function importMarkdown(
  mdPath: string,
  eventLogFile: string,
  workspaceRoot?: string
): Promise<Material> {
  const materialsDir = workspaceRoot ? path.join(workspaceRoot, 'materials') : Paths.materials;
  const content = await fs.readFile(mdPath, 'utf-8');
  const title = path.basename(mdPath, path.extname(mdPath));
  const hash = contentHash(content);
  const safeTitle = `${new Date().toISOString().split('T')[0]}_${title}.md`;
  const contentPath = path.join(materialsDir, safeTitle);

  await fs.mkdir(materialsDir, { recursive: true });
  await fs.writeFile(contentPath, content, 'utf-8');

  const material: Material = {
    id: `mat_${hash}`,
    source: mdPath,
    type: 'webpage',
    title,
    contentPath,
    meta: {
      capturedAt: new Date().toISOString(),
      wordCount: content.split(/\s+/).length,
      contentHash: hash,
    },
    version: 1,
  };

  await updateMaterialIndex(material, materialsDir);
  await writeMaterialEvent(eventLogFile, material, { mdPath });
  return material;
}

export interface ImportFromContentResult {
  material: Material | null;
  skipped: boolean;
  reason?: string;
}

/**
 * Import fetched web content as a Material, linked to its SourceRecord.
 * Deduplicates by content hash: if the same hash exists, bumps version instead of creating a new entry.
 */
export async function importFromContent(
  content: FetchedContent,
  sourceRecord: SourceRecord,
  eventLogFile: string,
  workspaceRoot?: string
): Promise<ImportFromContentResult> {
  const materialsDir = workspaceRoot ? path.join(workspaceRoot, 'materials') : Paths.materials;
  await fs.mkdir(materialsDir, { recursive: true });

  // Check for existing material with same content hash (deduplication)
  const existingIndex = await loadMaterialIndex(materialsDir);
  const existing = existingIndex.find((m) => m.meta.contentHash === content.contentHash);
  if (existing) {
    // Bump version
    existing.version += 1;
    existing.sourceRecordId = sourceRecord.id;
    existing.sourceUrl = content.url;
    await updateMaterialIndex(existing, materialsDir);
    return { material: existing, skipped: true, reason: 'duplicate_content_hash' };
  }

  const title = content.title || sourceRecord.title;
  const safeTitle = `${new Date().toISOString().split('T')[0]}_${title.replace(/[^\w\u4e00-\u9fff-]/g, '_').slice(0, 60)}.md`;
  const contentPath = path.join(materialsDir, safeTitle);

  // Write content as markdown
  const mdContent = `# ${title}\n\n> Source: ${content.url}\n> Fetched: ${content.fetchedAt}\n\n${content.body}`;
  await fs.writeFile(contentPath, mdContent, 'utf-8');

  const material: Material = {
    id: `mat_${content.contentHash}`,
    source: content.url,
    type: 'url',
    title,
    contentPath,
    meta: {
      capturedAt: content.fetchedAt,
      wordCount: content.body.split(/\s+/).length,
      contentHash: content.contentHash,
    },
    sourceRecordId: sourceRecord.id,
    sourceUrl: content.url,
    version: 1,
  };

  await updateMaterialIndex(material, materialsDir);
  await writeMaterialEvent(eventLogFile, material, {
    url: content.url,
    sourceRecordId: sourceRecord.id,
  });

  return { material, skipped: false };
}
