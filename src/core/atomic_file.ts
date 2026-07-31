import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';

export interface AtomicFileOps {
  mkdir(target: string, options: { recursive: true }): Promise<unknown>;
  writeFile(target: string, data: string | Uint8Array, encoding?: BufferEncoding): Promise<unknown>;
  rename(source: string, target: string): Promise<unknown>;
  unlink(target: string): Promise<unknown>;
}

const defaultOps: AtomicFileOps = {
  mkdir: (target, options) => fs.mkdir(target, options),
  writeFile: (target, data, encoding) => fs.writeFile(target, data, encoding),
  rename: (source, target) => fs.rename(source, target),
  unlink: (target) => fs.unlink(target),
};

/**
 * Write a file through a temporary sibling and atomically replace the target.
 * If replacement fails, the previous target remains untouched.
 */
export async function atomicWriteFile(
  target: string,
  data: string | Uint8Array,
  encoding: BufferEncoding = 'utf-8',
  ops: AtomicFileOps = defaultOps
): Promise<void> {
  const dir = path.dirname(target);
  const tempPath = path.join(dir, `.${path.basename(target)}.tmp-${randomUUID()}`);
  await ops.mkdir(dir, { recursive: true });

  try {
    await ops.writeFile(tempPath, data, encoding);
    await ops.rename(tempPath, target);
  } catch (err) {
    try {
      await ops.unlink(tempPath);
    } catch {
      // The temporary file may not exist if writing failed before creation.
    }
    throw err;
  }
}

export async function atomicWriteJSON(target: string, value: unknown): Promise<void> {
  await atomicWriteFile(target, JSON.stringify(value, null, 2), 'utf-8');
}
