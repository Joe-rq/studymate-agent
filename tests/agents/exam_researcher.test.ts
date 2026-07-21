import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateSearchQueries,
  deduplicateResults,
  classifySourceType,
  researchExam,
} from '../../src/agents/exam_researcher.js';
import { MockSearchProvider } from '../../src/application/ports/search_provider.js';
import type { ExamProject } from '../../src/domain/exam.js';
import fs from 'fs/promises';
import path from 'path';

const TEST_DIR = path.join(process.cwd(), 'workspace_test_researcher');
const TEST_LOG = path.join(TEST_DIR, 'event_log', 'events.jsonl');

const mockExam: ExamProject = {
  id: 'exam_test',
  name: '2026年初级会计资格考试',
  examDate: '2026-09-15',
  subjects: ['经济法基础', '初级会计实务'],
  learnerProfile: { baseline: 'beginner', dailyMinutes: 60, unavailableDates: [] },
  status: 'draft',
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockLLM = {
  complete: async () => '',
  completeJSON: async () => ({
    examFacts: '初级会计考试包含两个科目',
    experienceConsensus: '建议先学经济法基础',
    disputedAdvice: '是否需要报班因人而异',
    materialRecommendations: '推荐使用官方教材',
    gapsInEvidence: '无法确认具体报名时间',
  }),
};

describe('exam_researcher', () => {
  beforeEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(TEST_DIR, { recursive: true });
  });

  it('should generate search queries for all three tiers', () => {
    const queries = generateSearchQueries('初级会计考试');
    expect(queries.length).toBe(6); // 2 queries per tier × 3 tiers
    expect(queries.map((q) => q.tier)).toContain('official');
    expect(queries.map((q) => q.tier)).toContain('community');
    expect(queries.map((q) => q.tier)).toContain('materials');
  });

  it('should deduplicate results by URL', () => {
    const results = [
      { url: 'https://a.com', title: 'A', snippet: '...', tier: 'official' },
      { url: 'https://a.com', title: 'A duplicate', snippet: '...', tier: 'official' },
      { url: 'https://b.com', title: 'B', snippet: '...', tier: 'community' },
    ];
    const deduped = deduplicateResults(results);
    expect(deduped).toHaveLength(2);
  });

  it('should classify official sources by URL pattern', () => {
    const result = { url: 'https://www.mof.gov.cn/exam', title: '考试大纲', snippet: '' };
    expect(classifySourceType(result, 'official')).toBe('official');
  });

  it('should classify community sources by default', () => {
    const result = { url: 'https://blog.example.com/post', title: '我的备考经验', snippet: '' };
    expect(classifySourceType(result, 'community')).toBe('community');
  });

  it('should run full research pipeline with mock search', async () => {
    const searchProvider = new MockSearchProvider({
      '考试大纲': [
        { url: 'https://mof.gov.cn/exam', title: '2026初级会计考试大纲', snippet: 'Official syllabus', sourceType: 'official' as const },
      ],
      '备考经验': [
        { url: 'https://blog.example.com/exp', title: '我的备考心得', snippet: '先学经济法' },
      ],
    });

    const result = await researchExam(mockExam, searchProvider, mockLLM as any, TEST_LOG);

    expect(result.sources.length).toBeGreaterThanOrEqual(1);
    expect(result.queryCount).toBe(6);
    expect(result.summary.examFacts).toContain('初级会计');
  });

  it('should handle empty search results gracefully', async () => {
    const emptyProvider = new MockSearchProvider({});
    const result = await researchExam(mockExam, emptyProvider, mockLLM as any, TEST_LOG);

    expect(result.sources).toHaveLength(0);
    expect(result.rawResultCount).toBe(0);
  });
});
