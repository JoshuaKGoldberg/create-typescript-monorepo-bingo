#!/usr/bin/env node
import { runTemplateCLI } from 'bingo';

import { getCLITemplate } from './getCLITemplate.ts';

process.exitCode = await runTemplateCLI(await getCLITemplate(process.argv.slice(2)));
