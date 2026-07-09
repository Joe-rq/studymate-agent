import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLLMClient } from '../../src/core/llm.js';

describe('llm', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.OPENAI_BASE_URL = 'https://test.local/v1';
    vi.stubGlobal('fetch', vi.fn());
  });

  it('should call API and return content', async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'hello' } }],
      }),
    });

    const client = createLLMClient();
    const result = await client.complete('system', 'user');
    expect(result).toBe('hello');
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('should parse JSON response', async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"ok": true}' } }],
      }),
    });

    const client = createLLMClient();
    const result = await client.completeJSON<{ ok: boolean }>('system', 'user');
    expect(result.ok).toBe(true);
  });
});
