/**
 * SerpAPI Search Provider.
 *
 * Implements the SearchProvider interface using SerpAPI (https://serpapi.com)
 * for real Google search results. Requires SERP_API_KEY environment variable.
 *
 * Falls back gracefully if the API key is missing or the request fails.
 */

import type { SearchProvider, SearchResult, SearchOptions } from '../../application/ports/search_provider.js';

const SERPAPI_BASE = 'https://serpapi.com/search.json';

export class SerpApiSearchProvider implements SearchProvider {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    const maxResults = options?.maxResults ?? 10;

    const params = new URLSearchParams({
      engine: 'google',
      q: query,
      api_key: this.apiKey,
      num: String(maxResults),
      hl: 'zh-cn',
      gl: 'cn',
    });

    const url = `${SERPAPI_BASE}?${params.toString()}`;

    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`SerpAPI returned HTTP ${res.status}: ${text.slice(0, 200)}`);
      }

      const data = await res.json() as {
        organic_results?: Array<{
          title?: string;
          link?: string;
          snippet?: string;
          date?: string;
        }>;
      };

      const results: SearchResult[] = [];
      for (const item of data.organic_results ?? []) {
        if (!item.title || !item.link) continue;
        results.push({
          url: item.link,
          title: item.title,
          snippet: item.snippet ?? '',
          publishedDate: item.date,
        });
      }

      return results.slice(0, maxResults);
    } catch (err) {
      // Log but don't crash — caller can handle empty results
      console.error(`[SerpAPI] Search failed for "${query}":`, err instanceof Error ? err.message : String(err));
      return [];
    }
  }
}
