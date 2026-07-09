import { describe, it, expect, beforeEach } from 'vitest';
import { appendEvent, loadEvents, createEventId } from '../../src/core/event_log.js';
import fs from 'fs/promises';
import path from 'path';

const TEST_LOG_DIR = path.join(process.cwd(), 'workspace_test');
const TEST_LOG_FILE = path.join(TEST_LOG_DIR, 'event_log', 'events.jsonl');

describe('event_log', () => {
  beforeEach(async () => {
    await fs.rm(TEST_LOG_DIR, { recursive: true, force: true });
  });

  it('should create event log directory and file', async () => {
    await appendEvent(TEST_LOG_FILE, {
      id: createEventId(),
      timestamp: new Date().toISOString(),
      agent: 'test',
      action: 'test_action',
      input: {},
      output: { ok: true },
    });
    const events = await loadEvents(TEST_LOG_FILE);
    expect(events).toHaveLength(1);
    expect(events[0].output).toEqual({ ok: true });
  });
});
