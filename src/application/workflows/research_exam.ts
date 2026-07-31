/**
 * Research Exam Workflow.
 *
 * Orchestrates the full research pipeline for an exam project:
 * 1. Search across three source tiers
 * 2. Classify and deduplicate sources
 * 3. Synthesize structured research output
 * 4. Persist research artifacts to workspace
 * 5. Update exam project status
 */

import fs from 'fs/promises';
import path from 'path';
import type { LLMClient } from '../../core/llm.js';
import type { Event } from '../../core/types.js';
import { createEventId, appendEvent } from '../../core/event_log.js';
import { Paths } from '../../core/paths.js';
import type { SearchProvider } from '../../application/ports/search_provider.js';
import type { ExamProject } from '../../domain/exam.js';
import { transitionStatus } from '../../domain/exam.js';
import type { SourceRecord } from '../../domain/source.js';
import {
  researchExam,
  type ResearchResult,
} from '../../agents/exam_researcher.js';
import { saveExamProject } from './bootstrap_exam.js';

export interface ResearchExamResult {
  research: ResearchResult;
  sourcesPath: string;
  profilePath: string;
  insightsPath: string;
  materialsPath: string;
}

/**
 * Run the full research pipeline for an exam project.
 *
 * @param exam The exam project to research
 * @param searchProvider Search adapter to use
 * @param llm LLM client for synthesis
 * @param eventLogFile Event log path
 * @param workspaceRoot Optional workspace root for test isolation
 */
export async function researchExamWorkflow(
  exam: ExamProject,
  searchProvider: SearchProvider,
  llm: LLMClient,
  eventLogFile: string = Paths.eventLog,
  workspaceRoot?: string
): Promise<ResearchExamResult> {
  const researchDir = workspaceRoot
    ? path.join(workspaceRoot, 'research')
    : Paths.research;
  await fs.mkdir(researchDir, { recursive: true });

  // Run the research agent
  const research = await researchExam(exam, searchProvider, llm, eventLogFile);

  // Persist research artifacts
  const sourcesPath = path.join(researchDir, 'sources.jsonl');
  const sourcesContent = research.sources.map((s) => JSON.stringify(s)).join('\n') + '\n';
  await fs.writeFile(sourcesPath, sourcesContent, 'utf-8');

  const profilePath = path.join(researchDir, 'exam_profile.json');
  const profile = {
    examName: exam.name,
    examDate: exam.examDate,
    subjects: exam.subjects,
    researchedAt: new Date().toISOString(),
    facts: research.summary.examFacts,
    sourceCount: research.sources.length,
    officialSources: research.sources.filter((s) => s.sourceType === 'official').length,
    communitySources: research.sources.filter((s) => s.sourceType === 'community').length,
    commercialSources: research.sources.filter((s) => s.sourceType === 'commercial').length,
  };
  await fs.writeFile(profilePath, JSON.stringify(profile, null, 2), 'utf-8');

  const insightsPath = path.join(researchDir, 'experience_insights.md');
  const insights = [
    `# ${exam.name} 备考经验洞察`,
    '',
    `> 调研时间：${new Date().toISOString().split('T')[0]}`,
    `> 来源数量：${research.sources.length}`,
    '',
    '## 考试事实（官方来源）',
    '',
    research.summary.examFacts,
    '',
    '## 备考经验共识',
    '',
    research.summary.experienceConsensus,
    '',
    '## 存在争议的建议',
    '',
    research.summary.disputedAdvice,
    '',
    '## 证据不足的问题',
    '',
    research.summary.gapsInEvidence,
    '',
  ].join('\n');
  await fs.writeFile(insightsPath, insights, 'utf-8');

  const materialsPath = path.join(researchDir, 'material_recommendations.md');
  const materials = [
    `# ${exam.name} 资料推荐`,
    '',
    `> 调研时间：${new Date().toISOString().split('T')[0]}`,
    '',
    research.summary.materialRecommendations,
    '',
    '## 候选资料清单',
    '',
    ...research.sources
      .filter((s) => s.sourceType === 'commercial' || s.sourceType === 'official')
      .map(
        (s) =>
          `- **${s.title}** [${s.sourceType}|${s.confidenceLevel}] — ${s.summary}${s.url ? `\n  URL: ${s.url}` : ''}`
      ),
    '',
  ].join('\n');
  await fs.writeFile(materialsPath, materials, 'utf-8');

  // Update exam project status to 'researched'
  const updatedExam = transitionStatus(exam, 'researched');
  await saveExamProject(updatedExam, workspaceRoot);

  // Log workflow event
  const event: Event = {
    id: createEventId(),
    timestamp: new Date().toISOString(),
    agent: 'research_exam_workflow',
    action: 'research_completed',
    input: { examId: exam.id, examName: exam.name },
    output: {
      sourceCount: research.sources.length,
      queryCount: research.queryCount,
    },
    examProjectId: exam.id,
  };
  await appendEvent(eventLogFile, event);

  return {
    research,
    sourcesPath,
    profilePath,
    insightsPath,
    materialsPath,
  };
}

/**
 * Approve selected sources for use in the knowledge base.
 *
 * @param exam The exam project
 * @param approvedIds IDs of sources to approve
 * @param workspaceRoot Optional workspace root for test isolation
 * @returns Updated source records
 */
export async function approveSources(
  exam: ExamProject,
  approvedIds: string[],
  eventLogFile: string = Paths.eventLog,
  workspaceRoot?: string
): Promise<SourceRecord[]> {
  const researchDir = workspaceRoot
    ? path.join(workspaceRoot, 'research')
    : Paths.research;
  const sourcesPath = path.join(researchDir, 'sources.jsonl');

  // Load existing sources
  const content = await fs.readFile(sourcesPath, 'utf-8');
  const sources: SourceRecord[] = content
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));

  // Mark approved sources
  const approvedSet = new Set(approvedIds);
  const now = new Date().toISOString();
  for (const source of sources) {
    if (approvedSet.has(source.id)) {
      source.approved = true;
      source.approvedAt = now;
    }
  }

  // Write back
  const updatedContent = sources.map((s) => JSON.stringify(s)).join('\n') + '\n';
  await fs.writeFile(sourcesPath, updatedContent, 'utf-8');

  // Also write approved_sources.json for quick lookup
  const approvedPath = path.join(researchDir, 'approved_sources.json');
  const approved = sources.filter((s) => s.approved);
  await fs.writeFile(approvedPath, JSON.stringify(approved, null, 2), 'utf-8');

  // Update exam status if transitioning
  if (exam.status === 'researched') {
    const updatedExam = transitionStatus(exam, 'sources_approved');
    await saveExamProject(updatedExam, workspaceRoot);
  }

  // Log event
  const event: Event = {
    id: createEventId(),
    timestamp: new Date().toISOString(),
    agent: 'research_exam_workflow',
    action: 'sources_approved',
    input: { examId: exam.id },
    output: { approvedCount: approvedIds.length },
    examProjectId: exam.id,
  };
  await appendEvent(eventLogFile, event);

  return sources;
}
