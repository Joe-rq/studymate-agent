/**
 * Build Knowledge Workflow.
 *
 * Orchestrates the full pipeline from approved sources to validated knowledge graph:
 * 1. Read approved sources
 * 2. Fetch content from URLs
 * 3. Import as materials (with deduplication)
 * 4. Chunk materials
 * 5. Extract concepts in batches
 * 6. Update exam project status
 */

import fs from 'fs/promises';
import path from 'path';
import type { LLMClient } from '../../core/llm.js';
import type { Event } from '../../core/types.js';
import { createEventId, appendEvent } from '../../core/event_log.js';
import { Paths } from '../../core/paths.js';
import type { ContentFetcher } from '../../application/ports/content_fetcher.js';
import type { SourceRecord } from '../../domain/source.js';
import { importFromContent } from '../../agents/material_collector.js';
import { chunkMaterial, type Chunk, type ChunkOptions } from '../../agents/chunker.js';
import { mapConcepts, type ConceptMapperOptions } from '../../agents/concept_mapper.js';
import { loadExamProject, saveExamProject } from './bootstrap_exam.js';
import { transitionStatus } from '../../domain/exam.js';

export interface BuildKnowledgeInput {
  fetcher: ContentFetcher;
  llm: LLMClient;
  eventLogFile?: string;
  workspaceRoot?: string;
  chunkOptions?: ChunkOptions;
  conceptOptions?: ConceptMapperOptions;
}

export interface BuildKnowledgeResult {
  materialsImported: number;
  chunksGenerated: number;
  conceptsExtracted: number;
  unverifiedConcepts: number;
  skippedDuplicates: number;
  fetchErrors: string[];
}

/**
 * Run the full knowledge building pipeline.
 */
export async function buildKnowledge(input: BuildKnowledgeInput): Promise<BuildKnowledgeResult> {
  const {
    fetcher,
    llm,
    eventLogFile = Paths.eventLog,
    workspaceRoot,
    chunkOptions,
    conceptOptions,
  } = input;

  const researchDir = workspaceRoot
    ? path.join(workspaceRoot, 'research')
    : Paths.research;

  // 1. Read approved sources
  const approvedPath = path.join(researchDir, 'approved_sources.json');
  let approvedSources: SourceRecord[];
  try {
    approvedSources = JSON.parse(await fs.readFile(approvedPath, 'utf-8'));
  } catch {
    throw new Error(`No approved sources found at ${approvedPath}. Run source approval first.`);
  }

  const sourcesWithUrl = approvedSources.filter((s) => s.url && s.url.startsWith('http'));

  const result: BuildKnowledgeResult = {
    materialsImported: 0,
    chunksGenerated: 0,
    conceptsExtracted: 0,
    unverifiedConcepts: 0,
    skippedDuplicates: 0,
    fetchErrors: [],
  };

  const allChunks: Chunk[] = [];

  // 2-4. For each approved source with URL: fetch, import, chunk
  for (const source of sourcesWithUrl) {
    try {
      const content = await fetcher.fetch(source.url!);
      const importResult = await importFromContent(content, source, eventLogFile, workspaceRoot);

      if (importResult.skipped) {
        result.skippedDuplicates++;
        continue;
      }

      result.materialsImported++;

      // Chunk the material
      if (importResult.material) {
        const chunks = await chunkMaterial(
          importResult.material,
          eventLogFile,
          workspaceRoot,
          chunkOptions
        );
        allChunks.push(...chunks);
        result.chunksGenerated += chunks.length;
      }
    } catch (err: unknown) {
      const msg = `Failed to process ${source.url}: ${err instanceof Error ? err.message : String(err)}`;
      result.fetchErrors.push(msg);
    }
  }

  // 5. Extract concepts from all chunks
  if (allChunks.length > 0) {
    const conceptMap = await mapConcepts(allChunks, llm, eventLogFile, {
      ...conceptOptions,
      workspaceRoot,
    });
    result.conceptsExtracted = conceptMap.concepts.length;
    result.unverifiedConcepts = conceptMap.concepts.filter((c) => c.unverified).length;
  }

  // 6. Update exam project status: sources_approved -> materials_ready
  const exam = await loadExamProject(workspaceRoot);
  if (exam && exam.status === 'sources_approved') {
    const updated = transitionStatus(exam, 'materials_ready');
    await saveExamProject(updated, workspaceRoot);
  }

  // Log workflow event
  const event: Event = {
    id: createEventId(),
    timestamp: new Date().toISOString(),
    agent: 'build_knowledge_workflow',
    action: 'knowledge_built',
    input: { approvedSourceCount: sourcesWithUrl.length },
    output: {
      materialsImported: result.materialsImported,
      chunksGenerated: result.chunksGenerated,
      conceptsExtracted: result.conceptsExtracted,
      unverifiedConcepts: result.unverifiedConcepts,
      skippedDuplicates: result.skippedDuplicates,
      fetchErrorCount: result.fetchErrors.length,
    },
    examProjectId: exam?.id,
  };
  await appendEvent(eventLogFile, event);

  return result;
}
