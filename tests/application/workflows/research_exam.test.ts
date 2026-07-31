import { describe, it, expect, beforeEach } from 'vitest';
import {
  researchExamWorkflow,
  approveSources,
} from '../../../src/application/workflows/research_exam.js';
import { MockSearchProvider } from '../../../src/application/ports/search_provider.js';
import { createExamProject, transitionStatus } from '../../../src/domain/exam.js';
import type { ExamProject } from '../../../src/domain/exam.js';
import type { SourceRecord } from '../../../src/domain/source.js';
import fs from 'fs/promises';
import path from 'path';

const TEST_DIR = path.join(process.cwd(), 'workspace_test_research_wf');
const TEST_LOG = path.join(TEST_DIR, 'event_log', 'events.jsonl');

const mockLLM = {
  complete: async () => '',
  completeJSON: async () => ({
    examFacts: '初级会计考试包含两个科目',
    experienceConsensus: '建议先学经济法基础',
    disputedAdvice: '报班与否因人而异',
    materialRecommendations: '推荐官方教材',
    gapsInEvidence: '报名时间待确认',
  }),
};

function makeExam(): ExamProject {
  return createExamProject({
    name: '2026初级会计',
    examDate: '2026-09-15',
    subjects: ['经济法基础', '初级会计实务'],
    baseline: 'beginner',
    dailyMinutes: 60,
  });
}

describe('research_exam workflow', () => {
  beforeEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(TEST_DIR, { recursive: true });
  });

  it('should produce all research artifacts', async () => {
    const exam = makeExam();
    const searchProvider = new MockSearchProvider({
      '考试大纲': [
        {
          url: 'https://mof.gov.cn/exam',
          title: '2026初级会计考试大纲',
          snippet: 'Official syllabus',
          sourceType: 'official' as const,
        },
      ],
      '备考经验': [
        {
          url: 'https://blog.example.com/exp',
          title: '我的备考心得',
          snippet: '先学经济法',
        },
      ],
    });

    const result = await researchExamWorkflow(
      exam,
      searchProvider,
      mockLLM as any,
      TEST_LOG,
      TEST_DIR
    );

    // Check artifact paths exist
    expect(result.sourcesPath).toContain('sources.jsonl');
    expect(result.profilePath).toContain('exam_profile.json');
    expect(result.insightsPath).toContain('experience_insights.md');
    expect(result.materialsPath).toContain('material_recommendations.md');

    // Check files were written
    const sourcesContent = await fs.readFile(result.sourcesPath, 'utf-8');
    expect(sourcesContent.trim().length).toBeGreaterThan(0);

    const profile = JSON.parse(await fs.readFile(result.profilePath, 'utf-8'));
    expect(profile.examName).toBe('2026初级会计');
    expect(profile.sourceCount).toBeGreaterThanOrEqual(1);

    const insights = await fs.readFile(result.insightsPath, 'utf-8');
    expect(insights).toContain('备考经验洞察');
    expect(insights).toContain('初级会计考试包含两个科目');

    const materials = await fs.readFile(result.materialsPath, 'utf-8');
    expect(materials).toContain('资料推荐');
  });

  it('should update exam status to researched', async () => {
    const exam = makeExam();
    const searchProvider = new MockSearchProvider({
      '考试大纲': [
        { url: 'https://mof.gov.cn/exam', title: 'Syllabus', snippet: '' },
      ],
    });

    await researchExamWorkflow(exam, searchProvider, mockLLM as any, TEST_LOG, TEST_DIR);

    // Check saved exam.json has status 'researched'
    const saved = JSON.parse(
      await fs.readFile(path.join(TEST_DIR, 'exam.json'), 'utf-8')
    );
    expect(saved.status).toBe('researched');
  });

  it('should handle empty search results', async () => {
    const exam = makeExam();
    const emptyProvider = new MockSearchProvider({});

    const result = await researchExamWorkflow(
      exam,
      emptyProvider,
      mockLLM as any,
      TEST_LOG,
      TEST_DIR
    );

    expect(result.research.sources).toHaveLength(0);
    // Files should still be written (with empty/minimal content)
    const profile = JSON.parse(await fs.readFile(result.profilePath, 'utf-8'));
    expect(profile.sourceCount).toBe(0);
  });
});

describe('approveSources', () => {
  beforeEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(path.join(TEST_DIR, 'research'), { recursive: true });
  });

  it('should mark selected sources as approved', async () => {
    // Write some sources first
    const sources: SourceRecord[] = [
      {
        id: 'src_001',
        title: 'Official Syllabus',
        sourceType: 'official',
        confidenceLevel: 'verified',
        capturedAt: new Date().toISOString(),
        summary: 'Official exam syllabus',
        confidenceReason: 'Government website',
        approved: false,
      },
      {
        id: 'src_002',
        title: 'Blog Post',
        sourceType: 'community',
        confidenceLevel: 'single_case',
        capturedAt: new Date().toISOString(),
        summary: 'Personal experience',
        confidenceReason: 'Single blog post',
        approved: false,
      },
    ];
    const sourcesPath = path.join(TEST_DIR, 'research', 'sources.jsonl');
    await fs.writeFile(
      sourcesPath,
      sources.map((s) => JSON.stringify(s)).join('\n') + '\n',
      'utf-8'
    );

    const exam = transitionStatus(makeExam(), 'researched');
    const updated = await approveSources(exam, ['src_001'], TEST_LOG, TEST_DIR);

    expect(updated).toHaveLength(2);
    const approved = updated.find((s) => s.id === 'src_001');
    const notApproved = updated.find((s) => s.id === 'src_002');
    expect(approved!.approved).toBe(true);
    expect(approved!.approvedAt).toBeDefined();
    expect(notApproved!.approved).toBe(false);

    // Check approved_sources.json was written
    const approvedFile = JSON.parse(
      await fs.readFile(path.join(TEST_DIR, 'research', 'approved_sources.json'), 'utf-8')
    );
    expect(approvedFile).toHaveLength(1);
    expect(approvedFile[0].id).toBe('src_001');

    // Check exam status updated to sources_approved
    const saved = JSON.parse(
      await fs.readFile(path.join(TEST_DIR, 'exam.json'), 'utf-8')
    );
    expect(saved.status).toBe('sources_approved');
  });
});
