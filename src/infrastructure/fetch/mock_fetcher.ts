/**
 * Mock Content Fetcher for testing.
 *
 * Returns canned content keyed by URL. Throws for unknown URLs.
 */

import crypto from 'crypto';
import type { ContentFetcher, FetchedContent } from '../../application/ports/content_fetcher.js';

export interface MockFetchEntry {
  title: string;
  body: string;
}

export class MockContentFetcher implements ContentFetcher {
  private readonly entries: Map<string, MockFetchEntry>;

  constructor(entries: Record<string, MockFetchEntry>) {
    this.entries = new Map(Object.entries(entries));
  }

  async fetch(url: string): Promise<FetchedContent> {
    const entry = this.entries.get(url);
    if (!entry) {
      throw new Error(`MockContentFetcher: no entry for URL ${url}`);
    }

    const hash = crypto
      .createHash('sha256')
      .update(entry.body, 'utf-8')
      .digest('hex')
      .slice(0, 8);

    return {
      url,
      title: entry.title,
      body: entry.body,
      fetchedAt: new Date().toISOString(),
      contentHash: hash,
    };
  }
}
