/**
 * ExamResearcher agent.
 *
 * Performs structured research for an exam project by searching across three
 * source tiers (official, community experience, material recommendations),
 * classifying results, and producing a research report.
 */

import type { LLMClient } from '../core/llm.js';
import type { Event } from '../core/types.js';
import { createEventId, appendEvent } from '../core/event_log.js';
import type { SearchProvider, SearchResult } from '../application/ports/search_provider.js';
import type { ExamProject } from '../domain/exam.js';
import {
  createSourceRecord,
  type SourceRecord,
  type SourceType,
  type ConfidenceLevel,
} from '../domain/source.js';

/** Search query templates for each source tier. */
const QUERY_TEMPLATES: Record<string, string[]> = {
  official: ['{exam} 考试大纲', '{exam} 报名 考试科目'],
  community: ['{exam} 备考经验', '{exam} 怎么准备 方法'],
  materials: ['{exam} 教材推荐', '{exam} 真题 练习题'],
};

/** Generate search queries for all three tiers. */
export function generateSearchQueries(examName: string): { tier: string; query: string }[] {
  const queries: { tier: string; query: string }[] = [];
  for (const [tier, templates] of Object.entries(QUERY_TEMPLATES)) {
    for (const template of templates) {
      queries.push({ tier, query: template.replace('{exam}', examName) });
    }
  }
  return queries;
}

/** Deduplicate search results by URL, preserving tier info. */
export function deduplicateResults(results: (SearchResult & { tier: string })[]): (SearchResult & { tier: string })[] {
  const seen = new Set<string>();
  return results.filter((r) => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });
}

/**
 * Classify a search result's source type based on URL and snippet heuristics.
 * Official sites, government domains, and known publishers are prioritized.
 */
export function classifySourceType(result: SearchResult & { tier?: string }, tier?: string): SourceType {
  // If search provider already suggested a type, use it
  if (result.sourceType) return result.sourceType;

  const effectiveTier = tier ?? result.tier ?? 'community';

  const url = result.url.toLowerCase();
  // Official indicators
  if (
    url.includes('.gov.cn') ||
    url.includes('mof.gov') ||
    url.includes('neea.edu') ||
    url.includes('官方') ||
    result.title.includes('官方') ||
    result.title.includes('财政')
  ) {
    return 'official';
  }
  // Commercial indicators
  if (
    url.includes('jd.com') ||
    url.includes('taobao') ||
    url.includes('dangdang') ||
    result.title.includes('购买') ||
    result.title.includes('教材')
  ) {
    return 'commercial';
  }
  // Default: community (experience posts, forums, blogs)
  if (effectiveTier === 'official') return 'official';
  if (effectiveTier === 'materials') return 'commercial';
  return 'community';
}

/** Assign confidence level based on source type and content signals. */
export function assignConfidence(
  sourceType: SourceType,
  _result: SearchResult
): { level: ConfidenceLevel; reason: string } {
  switch (sourceType) {
    case 'official':
      return { level: 'verified', reason: 'Official government or examination authority source' };
    case 'community':
      return { level: 'consensus', reason: 'Community experience post; verify against official sources' };
    case 'commercial':
      return {
        level: 'insufficient',
        reason: 'Commercial source; requires independent verification',
      };
    case 'user_file':
      return { level: 'insufficient', reason: 'User-provided file; not yet verified' };
  }
}

/** LLM-synthesized research summary. */
export interface ResearchSummary {
  examFacts: string;
  experienceConsensus: string;
  disputedAdvice: string;
  materialRecommendations: string;
  gapsInEvidence: string;
}

/**
 * Use LLM to synthesize raw search results into structured research output.
 * Separates official facts, experience consensus, disputed advice, and gaps.
 */
async function synthesizeResearch(
  examName: string,
  sources: SourceRecord[],
  llm: LLMClient
): Promise<ResearchSummary> {
  const system = `You are an exam research analyst. Given search results about an exam, synthesize them into structured categories. Respond with JSON only. No markdown fences.
Format: {
  "examFacts": "Verified official facts about the exam",
  "experienceConsensus": "Common advice from multiple experience posts",
  "disputedAdvice": "Conflicting or minority opinions that need user judgment",
  "materialRecommendations": "Recommended textbooks and practice materials",
  "gapsInEvidence": "Questions that could not be answered from available sources"
}`;

  const sourcesText = sources
    .map(
      (s) =>
        `[${s.sourceType}|${s.confidenceLevel}] ${s.title}\n${s.summary}\nURL: ${s.url ?? 'N/A'}`
    )
    .join('\n\n');

  const user = `Exam: ${examName}\n\nDiscovered sources:\n${sourcesText}`;

  try {
    return await llm.completeJSON<ResearchSummary>(system, user, {
      temperature: 0.3,
      retries: 2,
    });
  } catch {
    return {
      examFacts: 'Unable to synthesize — LLM unavailable',
      experienceConsensus: '',
      disputedAdvice: '',
      materialRecommendations: '',
      gapsInEvidence: 'All evidence gaps unknown due to synthesis failure',
    };
  }
}

export interface ResearchResult {
  sources: SourceRecord[];
  summary: ResearchSummary;
  queryCount: number;
  rawResultCount: number;
}

/**
 * Main research function: searches across tiers, classifies sources,
 * synthesizes a structured report.
 */
export async function researchExam(
  exam: ExamProject,
  searchProvider: SearchProvider,
  llm: LLMClient,
  eventLogFile: string
): Promise<ResearchResult> {
  const queries = generateSearchQueries(exam.name);
  let allResults: (SearchResult & { tier: string })[] = [];

  // Execute all search queries
  for (const { tier, query } of queries) {
    const results = await searchProvider.search(query, { maxResults: 10 });
    allResults.push(...results.map((r) => ({ ...r, tier })));
  }

  const rawResultCount = allResults.length;

  // Deduplicate by URL
  const uniqueResults = deduplicateResults(allResults);

  // Classify and create source records
  const sources: SourceRecord[] = uniqueResults.map((result) => {
    const sourceType = classifySourceType(result);
    const { level, reason } = assignConfidence(sourceType, result);
    return createSourceRecord({
      url: result.url,
      title: result.title,
      sourceType,
      publisher: result.publishedDate ? new Date(result.publishedDate).getFullYear().toString() : undefined,
      examVersion: exam.examDate.split('-')[0],
      summary: result.snippet,
      confidenceReason: reason,
      confidenceLevel: level,
    });
  });

  // Synthesize with LLM
  const summary = await synthesizeResearch(exam.name, sources, llm);

  // Log event
  const event: Event = {
    id: createEventId(),
    timestamp: new Date().toISOString(),
    agent: 'exam_researcher',
    action: 'research_completed',
    input: { examName: exam.name, examDate: exam.examDate },
    output: {
      sourceCount: sources.length,
      queryCount: queries.length,
      rawResultCount,
    },
    examProjectId: exam.id,
  };
  await appendEvent(eventLogFile, event);

  return { sources, summary, queryCount: queries.length, rawResultCount };
}
