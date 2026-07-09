#!/usr/bin/env node
import { program } from 'commander';

program
  .name('studymate')
  .description('AI-powered personal exam preparation agent')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize workspace')
  .action(() => {
    console.log('init: TODO');
  });

program.parse();
