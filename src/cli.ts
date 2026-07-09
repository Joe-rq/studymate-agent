#!/usr/bin/env node
import { program } from 'commander';
import { initWorkspace } from './core/workspace.js';

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

program.parse();
