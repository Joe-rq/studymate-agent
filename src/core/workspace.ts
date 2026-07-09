import fs from 'fs/promises';
import { Paths } from './paths.js';

export async function initWorkspace(): Promise<void> {
  const dirs = Object.values(Paths).filter((p) => !p.endsWith('.jsonl'));
  for (const dir of dirs) {
    await fs.mkdir(dir, { recursive: true });
  }
}
