import { describe, it, expect } from 'vitest';
import { stripHtml, extractTitle } from '../../../src/infrastructure/fetch/web_fetcher.js';
import { MockContentFetcher } from '../../../src/infrastructure/fetch/mock_fetcher.js';

describe('web_fetcher', () => {
  describe('stripHtml', () => {
    it('should remove script and style blocks', () => {
      const html = '<p>Hello</p><script>alert("x")</script><style>.a{}</style><p>World</p>';
      const text = stripHtml(html);
      expect(text).toContain('Hello');
      expect(text).toContain('World');
      expect(text).not.toContain('alert');
      expect(text).not.toContain('.a{}');
    });

    it('should remove HTML tags', () => {
      const html = '<h1>Title</h1><p>Some <strong>bold</strong> text</p>';
      const text = stripHtml(html);
      expect(text).toContain('Title');
      expect(text).toContain('Some bold text');
      expect(text).not.toContain('<');
    });

    it('should decode HTML entities', () => {
      const html = '<p>&amp; &lt; &gt; &quot; &#39; &nbsp;</p>';
      const text = stripHtml(html);
      expect(text).toContain('&');
      expect(text).toContain('<');
      expect(text).toContain('>');
      expect(text).toContain('"');
      expect(text).toContain("'");
    });

    it('should collapse excessive whitespace', () => {
      const html = '<p>A</p>\n\n\n\n\n<p>B</p>';
      const text = stripHtml(html);
      expect(text).not.toContain('\n\n\n');
    });

    it('should handle empty input', () => {
      expect(stripHtml('')).toBe('');
    });
  });

  describe('extractTitle', () => {
    it('should extract title from HTML', () => {
      const html = '<html><head><title>My Page</title></head><body></body></html>';
      expect(extractTitle(html, 'fallback')).toBe('My Page');
    });

    it('should return fallback when no title', () => {
      const html = '<html><body>No title here</body></html>';
      expect(extractTitle(html, 'example.com')).toBe('example.com');
    });

    it('should return fallback for empty title', () => {
      const html = '<html><head><title>  </title></head></html>';
      expect(extractTitle(html, 'fallback')).toBe('fallback');
    });
  });
});

describe('MockContentFetcher', () => {
  it('should return canned content for known URLs', async () => {
    const fetcher = new MockContentFetcher({
      'https://example.com/page': {
        title: 'Example Page',
        body: '# Chapter 1\n\nSome content here.',
      },
    });

    const result = await fetcher.fetch('https://example.com/page');
    expect(result.title).toBe('Example Page');
    expect(result.body).toContain('Chapter 1');
    expect(result.url).toBe('https://example.com/page');
    expect(result.contentHash).toHaveLength(8);
    expect(result.fetchedAt).toBeTruthy();
  });

  it('should throw for unknown URLs', async () => {
    const fetcher = new MockContentFetcher({});
    await expect(fetcher.fetch('https://unknown.com')).rejects.toThrow(/no entry/);
  });

  it('should produce consistent hashes for same content', async () => {
    const fetcher = new MockContentFetcher({
      'https://a.com': { title: 'A', body: 'same content' },
      'https://b.com': { title: 'B', body: 'same content' },
    });

    const a = await fetcher.fetch('https://a.com');
    const b = await fetcher.fetch('https://b.com');
    expect(a.contentHash).toBe(b.contentHash);
  });
});
