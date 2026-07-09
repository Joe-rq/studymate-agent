export interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMClient {
  complete(system: string, user: string, options?: LLMOptions): Promise<string>;
  completeJSON<T>(system: string, user: string, options?: LLMOptions): Promise<T>;
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
      const content = await complete(
        `${system}\n\nYou must respond with valid JSON only. No markdown, no explanation.`,
        user,
        options
      );
      const cleaned = content.replace(/```json\s*|\s*```/g, '').trim();
      return JSON.parse(cleaned) as T;
    },
  };
}
