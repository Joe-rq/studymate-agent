#!/usr/bin/env node
import { program } from 'commander';
import { initWorkspace } from './core/workspace.js';
import { importPDF, importMarkdown } from './agents/material_collector.js';
import { chunkMaterial } from './agents/chunker.js';
import { Paths } from './core/paths.js';

program
  .name('studymate')
  .description('AI-powered personal exam preparation agent')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize workspace')
  .action(async () => {
    await initWorkspace();
    console.log('Workspace initialized at ./workspace');
  });

program
  .command('ingest')
  .description('Import a PDF or Markdown file')
  .argument('<file>', 'File path')
  .action(async (file: string) => {
    let material;
    if (file.endsWith('.pdf')) {
      material = await importPDF(file, Paths.eventLog);
    } else if (file.endsWith('.md')) {
      material = await importMarkdown(file, Paths.eventLog);
    } else {
      console.error('Unsupported file type. Use .pdf or .md');
      process.exit(1);
    }
    const chunks = await chunkMaterial(material, Paths.eventLog);
    console.log(`Imported: ${material.title}`);
    console.log(`Generated ${chunks.length} chunks`);
  });

program.parse();
