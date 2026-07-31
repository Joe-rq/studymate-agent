/**
 * SearchProvider port interface.
 *
 * Defines the contract for external search adapters used during exam research.
 * Implementations may use web search APIs, scraping, or mock data for testing.
 */

import type { SourceType } from '../../domain/source.js';
import { SerpApiSearchProvider } from '../../infrastructure/search/serp_search_provider.js';

export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
  /** Hint about the source type; the researcher may override after classification. */
  sourceType?: SourceType;
  publishedDate?: string;
}

export interface SearchOptions {
  maxResults?: number;
  sourceTypeFilter?: SourceType[];
}

export interface SearchProvider {
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
}

/**
 * Factory function: returns SerpApiSearchProvider if SERP_API_KEY is set,
 * otherwise falls back to MockSearchProvider with empty results.
 */
export function createSearchProvider(): SearchProvider {
  const apiKey = process.env.SERP_API_KEY;
  if (apiKey) {
    return new SerpApiSearchProvider(apiKey);
  }
  return new MockSearchProvider({});
}

/**
 * Mock search provider for testing and offline development.
 * Returns pre-configured results for known queries.
 */
export class MockSearchProvider implements SearchProvider {
  private results: Map<string, SearchResult[]>;

  constructor(results: Record<string, SearchResult[]> = {}) {
    this.results = new Map(Object.entries(results));
  }

  async search(query: string, _options?: SearchOptions): Promise<SearchResult[]> {
    // Try exact match first
    const exact = this.results.get(query);
    if (exact) return exact;

    // Try partial match
    for (const [key, value] of this.results) {
      if (query.includes(key) || key.includes(query)) return value;
    }

    return [];
  }
}
