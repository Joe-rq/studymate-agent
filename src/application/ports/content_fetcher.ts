/**
 * Content Fetcher Port.
 *
 * Defines the interface for fetching web page content from approved source URLs.
 * Adapters handle the actual HTTP retrieval and HTML-to-text extraction.
 */

export interface FetchedContent {
  url: string;
  title: string;
  /** Extracted text content (HTML tags stripped). */
  body: string;
  fetchedAt: string;
  contentHash: string;
}

export interface ContentFetcher {
  fetch(url: string): Promise<FetchedContent>;
}
