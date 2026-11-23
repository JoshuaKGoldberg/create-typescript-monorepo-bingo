#!/usr/bin/env node
import { runTemplateCLI } from 'bingo';

import { template } from '../template.ts';

process.exitCode = await runTemplateCLI(template, {
  name: 'create-typescript-monorepo-bingo',
  version: '0.0.0',
});
