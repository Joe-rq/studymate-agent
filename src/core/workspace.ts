import fs from 'fs/promises';
import path from 'path';
import { Paths, WORKSPACE_ROOT } from './paths.js';

export async function initWorkspace(rootDir: string = WORKSPACE_ROOT): Promise<void> {
  // Paths 里既包含目录也包含带扩展名的文件路径（events.jsonl / config.json 等）。
  // 只对目录执行 mkdir：通过「路径是否带扩展名」来区分。
  const dirs = Object.values(Paths)
    .map((p) => p.replace(WORKSPACE_ROOT, rootDir))
    .filter((p) => path.extname(p) === '');
  for (const dir of dirs) {
    await fs.mkdir(dir, { recursive: true });
  }
}
