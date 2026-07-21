/**
 * SearchProvider port interface.
 *
 * Defines the contract for external search adapters used during exam research.
 * Implementations may use web search APIs, scraping, or mock data for testing.
 */

import type { SourceType } from '../../domain/source.js';

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
