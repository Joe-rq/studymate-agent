/**
 * Web Content Fetcher Adapter.
 *
 * Uses Node.js native fetch() to download HTML pages and extract text content.
 * Strips HTML tags, extracts <title>, and computes a content hash.
 */

import crypto from 'crypto';
import type { ContentFetcher, FetchedContent } from '../../application/ports/content_fetcher.js';

/** Strip HTML tags and decode common entities to produce readable text. */
export function stripHtml(html: string): string {
  return html
    // Remove script and style blocks entirely
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    // Remove HTML comments
    .replace(/<!--[\s\S]*?-->/g, '')
    // Replace block-level tags with newlines
    .replace(/<\/(p|div|h[1-6]|li|tr|br|section|article|header|footer)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    // Remove all remaining tags
    .replace(/<[^>]+>/g, '')
    // Decode common HTML entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // Collapse excessive whitespace
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Extract the <title> content from HTML. */
export function extractTitle(html: string, fallback: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (match && match[1].trim()) {
    return match[1].trim();
  }
  return fallback;
}

/** Compute SHA-256 hash (first 8 hex chars) of content. */
function contentHash(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex').slice(0, 8);
}

export interface WebFetcherOptions {
  /** Request timeout in milliseconds. Default: 15000. */
  timeoutMs?: number;
  /** User-Agent header. */
  userAgent?: string;
}

export class WebContentFetcher implements ContentFetcher {
  private readonly timeoutMs: number;
  private readonly userAgent: string;

  constructor(options?: WebFetcherOptions) {
    this.timeoutMs = options?.timeoutMs ?? 15000;
    this.userAgent = options?.userAgent ?? 'StudyMate/0.1 (exam-prep-agent)';
  }

  async fetch(url: string): Promise<FetchedContent> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': this.userAgent },
        redirect: 'follow',
      });
    } catch (err: unknown) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`Fetch timeout after ${this.timeoutMs}ms: ${url}`);
      }
      throw new Error(`Fetch failed for ${url}: ${err instanceof Error ? err.message : String(err)}`);
    }
    clearTimeout(timer);

    if (!response.ok) {
      throw new Error(`Fetch returned HTTP ${response.status} for ${url}`);
    }

    const html = await response.text();
    if (!html || html.trim().length === 0) {
      throw new Error(`Empty response body from ${url}`);
    }

    const title = extractTitle(html, new URL(url).hostname);
    const body = stripHtml(html);

    if (body.length === 0) {
      throw new Error(`No text content extracted from ${url}`);
    }

    return {
      url,
      title,
      body,
      fetchedAt: new Date().toISOString(),
      contentHash: contentHash(body),
    };
  }
}
