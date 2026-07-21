import fs from 'fs/promises';
import path from 'path';
import type { Event } from './types.js';

export function createEventId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Generate a correlation ID for linking related events in a workflow session. */
export function createCorrelationId(): string {
  return `corr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function appendEvent(logFile: string, event: Event): Promise<void> {
  const dir = path.dirname(logFile);
  await fs.mkdir(dir, { recursive: true });
  // Ensure schemaVersion defaults to 1
  const normalized: Event = { schemaVersion: 1, ...event };
  const line = JSON.stringify(normalized) + '\n';
  await fs.appendFile(logFile, line, 'utf-8');
}

export async function loadEvents(logFile: string): Promise<Event[]> {
  try {
    const content = await fs.readFile(logFile, 'utf-8');
    return content
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return [];
    throw err;
  }
}
