/**
 * Local Material Upload Workflow.
 *
 * Web 端本地资料入口：上传 PDF/Markdown → 导入 Material（与 CLI ingest 同一 schema）
 * → 立即切片。无搜索 Key 时可走「上传 → 构建 → 计划」的离线闭环。
 *
 * 安全约束：
 * - 只接受 .pdf / .md / .markdown 扩展名；
 * - 文件名经服务端净化，不接受任意输出路径；
 * - 产物只写入 workspace/materials 与 workspace/chunks。
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { importPDF, importMarkdown, type Material } from '../../agents/material_collector.js';
import { chunkMaterial, type Chunk } from '../../agents/chunker.js';

/** 允许上传的扩展名。 */
const ALLOWED_EXTENSIONS = new Set(['.pdf', '.md', '.markdown']);

/** 解码后的大小上限（PDF 文本抽取前）。 */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export interface UploadMaterialInput {
  /** 原始文件名（仅用于标题与扩展名判断，服务端另行净化）。 */
  filename: string;
  /** 文件内容。 */
  buffer: Buffer;
  eventLogFile: string;
  workspaceRoot?: string;
}

export interface UploadMaterialResult {
  material: Material;
  chunks: Chunk[];
}

/** 净化文件名：去路径、去非法字符、限长。 */
export function sanitizeFilename(filename: string): string {
  const base = path.basename(filename).replace(/[^\w\u4e00-\u9fff.-]/g, '_').slice(0, 80);
  return base || 'upload';
}

export async function uploadLocalMaterial(
  input: UploadMaterialInput
): Promise<UploadMaterialResult> {
  const { filename, buffer, eventLogFile, workspaceRoot } = input;

  const ext = path.extname(filename).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported file type: ${ext || '(none)'}. Allowed: .pdf, .md, .markdown`);
  }
  if (buffer.length === 0) {
    throw new Error('Uploaded file is empty');
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new Error(`File too large (${Math.round(buffer.length / 1024 / 1024)}MB). Limit: 20MB.`);
  }

  // 写临时文件复用既有 importPDF/importMarkdown（与 CLI 导入完全同构），完成后删除
  const safeName = sanitizeFilename(filename);
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'studymate-upload-'));
  const tmpFile = path.join(tmpDir, safeName);
  try {
    await fs.writeFile(tmpFile, buffer);

    const material =
      ext === '.pdf'
        ? await importPDF(tmpFile, eventLogFile, workspaceRoot)
        : await importMarkdown(tmpFile, eventLogFile, workspaceRoot);

    const chunks = await chunkMaterial(material, eventLogFile, workspaceRoot);
    return { material, chunks };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
