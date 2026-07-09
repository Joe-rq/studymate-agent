export interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  retries?: number;
}

export interface LLMClient {
  complete(system: string, user: string, options?: LLMOptions): Promise<string>;
  completeJSON<T>(system: string, user: string, options?: LLMOptions): Promise<T>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanJSON(content: string): string {
  let cleaned = content.replace(/```json\s*|\s*```/g, '').trim();
  cleaned = cleaned.replace(/^\s*`|\s*`$/g, '').trim();
  const firstBrace = cleaned.indexOf('{');
  const firstBracket = cleaned.indexOf('[');
  if (firstBrace === -1 && firstBracket === -1) {
    throw new Error('No JSON object or array found in response');
  }
  const start = Math.min(
    firstBrace === -1 ? Infinity : firstBrace,
    firstBracket === -1 ? Infinity : firstBracket
  );
  let end = cleaned.length;
  let depth = 0;
  let inString = false;
  let escape = false;
  let opened: '{' | '[' | null = null;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{' || ch === '[') {
      if (depth === 0) opened = ch;
      depth++;
    } else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  return cleaned.slice(start, end);
}

export function createLLMClient(): LLMClient {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseURL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const model = process.env.LLM_MODEL || 'gpt-4o-mini';

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is required');
  }

  const complete = async (system: string, user: string, options: LLMOptions = {}): Promise<string> => {
    const res = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: options.model || model,
        temperature: options.temperature ?? 0.5,
        max_tokens: options.maxTokens ?? 2048,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`LLM API error: ${res.status} ${text}`);
    }

    const data = await res.json();
    return data.choices[0].message.content;
  };

  return {
    complete,
    async completeJSON<T>(system: string, user: string, options: LLMOptions = {}) {
      const maxRetries = options.retries ?? 3;
      let lastError: Error | undefined;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          const content = await complete(
            `${system}\n\nYou must respond with valid JSON only. No markdown, no explanation outside the JSON.`,
            user,
            options
          );
          const cleaned = cleanJSON(content);
          return JSON.parse(cleaned) as T;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          if (attempt < maxRetries - 1) {
            await sleep(1000 * 2 ** attempt);
          }
        }
      }
      throw lastError ?? new Error('LLM JSON completion failed after retries');
    },
  };
}
