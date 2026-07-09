import fs from 'fs/promises';
import { Paths, WORKSPACE_ROOT } from './paths.js';

export async function initWorkspace(rootDir: string = WORKSPACE_ROOT): Promise<void> {
  const dirs = Object.values(Paths).map((p) => p.replace(WORKSPACE_ROOT, rootDir)).filter((p) => !p.endsWith('.jsonl'));
  for (const dir of dirs) {
    await fs.mkdir(dir, { recursive: true });
  }
}
