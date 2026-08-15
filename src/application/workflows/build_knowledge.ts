/**
 * Build Knowledge Workflow.
 *
 * Orchestrates the full pipeline from approved sources to validated knowledge graph:
 * 1. Read approved sources（搜索路径）或已导入的本地材料（本地路径）
 * 2. Fetch content from URLs（仅搜索路径）
 * 3. Import as materials (with deduplication)
 * 4. Chunk materials
 * 5. Extract concepts in batches
 * 6. Update exam project status
 *
 * 状态推进保护（PRD 5.3）：
 * - 所有抓取失败 / 零材料 / 零切片 / 零概念时抛出可操作错误，保持 Exam 状态不变；
 * - 只有「至少一份材料 + 至少一个有效概念」才允许推进到 materials_ready；
 * - 部分成功时返回成功数、失败数与未覆盖来源。
 */

import fs from 'fs/promises';
import path from 'path';
import type { LLMClient } from '../../core/llm.js';
import type { Event } from '../../core/types.js';
import { createEventId, appendEvent } from '../../core/event_log.js';
import { Paths } from '../../core/paths.js';
import type { ContentFetcher } from '../../application/ports/content_fetcher.js';
import type { SourceRecord } from '../../domain/source.js';
import { importFromContent, loadMaterialIndex, type Material } from '../../agents/material_collector.js';
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
  /** 抓取失败的已批准来源（部分成功时的未覆盖来源）。 */
  failedSources: string[];
  /** 本次构建使用的输入模式。 */
  mode: 'approved_sources' | 'local_materials';
}

/** 从 chunks/index.json 读取已切片的 chunk（本地路径复用已切片产物）。 */
async function loadExistingChunks(workspaceRoot?: string): Promise<Chunk[]> {
  const chunksDir = workspaceRoot ? path.join(workspaceRoot, 'chunks') : Paths.chunks;
  try {
    return JSON.parse(await fs.readFile(path.join(chunksDir, 'index.json'), 'utf-8')) as Chunk[];
  } catch {
    return [];
  }
}

/** 为尚未切片的 Material 补切片（幂等：已有 chunk 的材料跳过）。 */
async function chunkUnchunkedMaterials(
  materials: Material[],
  existingChunks: Chunk[],
  eventLogFile: string,
  workspaceRoot?: string,
  chunkOptions?: ChunkOptions
): Promise<Chunk[]> {
  const chunkedMaterialIds = new Set(existingChunks.map((c) => c.materialId));
  const chunks = [...existingChunks];
  for (const material of materials) {
    if (chunkedMaterialIds.has(material.id)) continue;
    const generated = await chunkMaterial(material, eventLogFile, workspaceRoot, chunkOptions);
    chunks.push(...generated);
  }
  return chunks;
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

  // 1. Read approved sources（缺失时进入本地材料模式，而非直接失败）
  const approvedPath = path.join(researchDir, 'approved_sources.json');
  let approvedSources: SourceRecord[] = [];
  try {
    approvedSources = JSON.parse(await fs.readFile(approvedPath, 'utf-8'));
  } catch {
    approvedSources = [];
  }
  const sourcesWithUrl = approvedSources.filter((s) => s.url && s.url.startsWith('http'));

  const result: BuildKnowledgeResult = {
    materialsImported: 0,
    chunksGenerated: 0,
    conceptsExtracted: 0,
    unverifiedConcepts: 0,
    skippedDuplicates: 0,
    fetchErrors: [],
    failedSources: [],
    mode: sourcesWithUrl.length > 0 ? 'approved_sources' : 'local_materials',
  };

  let allChunks: Chunk[] = [];

  if (result.mode === 'approved_sources') {
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
        result.failedSources.push(source.title || source.url!);
      }
    }

    // 抓取全部失败时，回退到本地已导入材料（仍可能有救）
    if (allChunks.length === 0) {
      const materials = await loadMaterialIndex(
        workspaceRoot ? path.join(workspaceRoot, 'materials') : Paths.materials
      );
      if (materials.length > 0) {
        const existing = await loadExistingChunks(workspaceRoot);
        allChunks = await chunkUnchunkedMaterials(
          materials,
          existing,
          eventLogFile,
          workspaceRoot,
          chunkOptions
        );
        result.mode = 'local_materials';
      }
    }
  } else {
    // 本地材料路径：上传/CLI 导入的材料已就位，补齐缺失切片
    const materials = await loadMaterialIndex(
      workspaceRoot ? path.join(workspaceRoot, 'materials') : Paths.materials
    );
    const existing = await loadExistingChunks(workspaceRoot);
    allChunks = await chunkUnchunkedMaterials(
      materials,
      existing,
      eventLogFile,
      workspaceRoot,
      chunkOptions
    );
    result.chunksGenerated = allChunks.length - existing.length;
  }

  // ── 状态推进保护：零切片 → 报错并保持原状态 ──
  if (allChunks.length === 0) {
    const reason =
      result.mode === 'approved_sources'
        ? `所有来源抓取失败（${result.fetchErrors.length} 个错误），且没有可用的本地材料。请检查网络/来源，或上传本地 PDF/Markdown。`
        : '没有可用的学习材料。请先上传本地 PDF/Markdown（或通过搜索来源构建）。';
    const event: Event = {
      id: createEventId(),
      timestamp: new Date().toISOString(),
      agent: 'build_knowledge_workflow',
      action: 'knowledge_build_failed',
      input: { approvedSourceCount: sourcesWithUrl.length },
      output: { reason, fetchErrorCount: result.fetchErrors.length },
    };
    await appendEvent(eventLogFile, event);
    throw new Error(reason);
  }

  // 5. Extract concepts from all chunks
  const conceptMap = await mapConcepts(allChunks, llm, eventLogFile, {
    ...conceptOptions,
    workspaceRoot,
  });
  result.conceptsExtracted = conceptMap.concepts.length;
  result.unverifiedConcepts = conceptMap.concepts.filter((c) => c.unverified).length;

  // ── 状态推进保护：零有效概念 → 报错并保持原状态 ──
  if (result.conceptsExtracted === 0) {
    const event: Event = {
      id: createEventId(),
      timestamp: new Date().toISOString(),
      agent: 'build_knowledge_workflow',
      action: 'knowledge_build_failed',
      input: { chunkCount: allChunks.length },
      output: { reason: 'concept_extraction_empty' },
    };
    await appendEvent(eventLogFile, event);
    throw new Error(`概念提取结果为空（${allChunks.length} 个切片均未产出有效概念），已保持原状态。请检查材料内容是否适合提取知识点。`);
  }

  // 6. Update exam project status: sources_approved/draft -> materials_ready
  const exam = await loadExamProject(workspaceRoot);
  if (exam && (exam.status === 'sources_approved' || exam.status === 'draft')) {
    const updated = transitionStatus(exam, 'materials_ready');
    await saveExamProject(updated, workspaceRoot);
  }

  // Log workflow event
  const event: Event = {
    id: createEventId(),
    timestamp: new Date().toISOString(),
    agent: 'build_knowledge_workflow',
    action: 'knowledge_built',
    input: { approvedSourceCount: sourcesWithUrl.length, mode: result.mode },
    output: {
      materialsImported: result.materialsImported,
      chunksGenerated: result.chunksGenerated,
      conceptsExtracted: result.conceptsExtracted,
      unverifiedConcepts: result.unverifiedConcepts,
      skippedDuplicates: result.skippedDuplicates,
      fetchErrorCount: result.fetchErrors.length,
      failedSourceCount: result.failedSources.length,
    },
    examProjectId: exam?.id,
  };
  await appendEvent(eventLogFile, event);

  return result;
}
