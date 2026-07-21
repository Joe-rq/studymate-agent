import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import pdfParse from 'pdf-parse';
import type { Event } from '../core/types.js';
import { createEventId, appendEvent } from '../core/event_log.js';
import { Paths } from '../core/paths.js';

export interface Material {
  id: string;
  source: string;
  type: 'pdf' | 'webpage';
  title: string;
  contentPath: string;
  meta: {
    capturedAt: string;
    wordCount: number;
    contentHash: string;
  };
}

/** Compute a stable SHA-256 hash (first 8 hex chars) from content. */
function contentHash(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex').slice(0, 8);
}

async function updateMaterialIndex(material: Material): Promise<void> {
  const indexPath = path.join(Paths.materials, 'index.json');
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
  eventLogFile: string
): Promise<Material> {
  const buffer = await fs.readFile(pdfPath);
  const parsed = await pdfParse(buffer);
  const title = path.basename(pdfPath, path.extname(pdfPath));
  const hash = contentHash(parsed.text);
  const safeTitle = `${new Date().toISOString().split('T')[0]}_${title}.md`;
  const contentPath = path.join(Paths.materials, safeTitle);

  await fs.mkdir(Paths.materials, { recursive: true });
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
  };

  await updateMaterialIndex(material);
  await writeMaterialEvent(eventLogFile, material, { pdfPath });
  return material;
}

export async function importMarkdown(
  mdPath: string,
  eventLogFile: string
): Promise<Material> {
  const content = await fs.readFile(mdPath, 'utf-8');
  const title = path.basename(mdPath, path.extname(mdPath));
  const hash = contentHash(content);
  const safeTitle = `${new Date().toISOString().split('T')[0]}_${title}.md`;
  const contentPath = path.join(Paths.materials, safeTitle);

  await fs.mkdir(Paths.materials, { recursive: true });
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
  };

  await updateMaterialIndex(material);
  await writeMaterialEvent(eventLogFile, material, { mdPath });
  return material;
}
