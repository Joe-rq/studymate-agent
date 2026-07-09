import fs from 'fs/promises';
import path from 'path';
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
  };
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
  const safeTitle = `${new Date().toISOString().split('T')[0]}_${title}.md`;
  const contentPath = path.join(Paths.materials, safeTitle);

  await fs.mkdir(Paths.materials, { recursive: true });
  await fs.writeFile(contentPath, `# ${title}\n\n${parsed.text}`, 'utf-8');

  const material: Material = {
    id: `mat_${Date.now()}`,
    source: pdfPath,
    type: 'pdf',
    title,
    contentPath,
    meta: {
      capturedAt: new Date().toISOString(),
      wordCount: parsed.text.split(/\s+/).length,
    },
  };

  await writeMaterialEvent(eventLogFile, material, { pdfPath });
  return material;
}

export async function importMarkdown(
  mdPath: string,
  eventLogFile: string
): Promise<Material> {
  const content = await fs.readFile(mdPath, 'utf-8');
  const title = path.basename(mdPath, path.extname(mdPath));
  const safeTitle = `${new Date().toISOString().split('T')[0]}_${title}.md`;
  const contentPath = path.join(Paths.materials, safeTitle);

  await fs.mkdir(Paths.materials, { recursive: true });
  await fs.writeFile(contentPath, content, 'utf-8');

  const material: Material = {
    id: `mat_${Date.now()}`,
    source: mdPath,
    type: 'webpage',
    title,
    contentPath,
    meta: {
      capturedAt: new Date().toISOString(),
      wordCount: content.split(/\s+/).length,
    },
  };

  await writeMaterialEvent(eventLogFile, material, { mdPath });
  return material;
}
